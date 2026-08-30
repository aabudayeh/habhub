import * as SecureStore from "expo-secure-store";

import {
  checkpointChunks,
  joinCheckpointChunks,
  NATIVE_GOOGLE_GROUP_MAX_CHUNKS,
  nativeGoogleHealthCheckpointContentSignature,
  nativeGoogleHealthStableHash,
  parseNativeGoogleHealthGroupCheckpoint,
  parseNativeGoogleHealthManifest,
  serializeNativeGoogleHealthGroupCheckpoint,
  type NativeGoogleHealthGroupManifest,
  type NativeGoogleHealthGroupSlot,
} from "@/src/domain/nativeGoogleHealthGroupCache";
import type {
  GoogleHealthGroupCheckpoint,
  GoogleHealthGroupCheckpointSource,
} from "@/src/domain/googleHealthGroupCheckpoint";

const KEYCHAIN_SERVICE = "habhub.google-health.group-cache.v1";
const RECORD_PREFIX = "habhub.google-group.v1";
const SLOTS = ["slot-a", "slot-b"] as const;
const SECURE_STORE_BATCH_SIZE = 8;
const ACCOUNT_SCOPE_INDEX_VERSION = 1 as const;
// Each scope is stored in its own small SecureStore value. This high ceiling
// rejects pathological/corrupt indexes before publication instead of silently
// dropping older scopes as the former 64-item list did.
const NATIVE_GOOGLE_GROUP_ACCOUNT_SCOPE_LIMIT = 100_000;

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: KEYCHAIN_SERVICE,
};

const operationByScope = new Map<string, Promise<void>>();
const operationByAccount = new Map<string, Promise<unknown>>();
const accountMutationGeneration = new Map<string, number>();
const accountsBeingPurged = new Set<string>();
const latestRequestedSignature = new Map<string, string>();
const lastWrittenSignature = new Map<string, string>();
let deleteSequence = 0;

type AccountScopeIndexHeader = {
  version: typeof ACCOUNT_SCOPE_INDEX_VERSION;
  nextOrdinal: number;
};

type AccountScopeIndexSlot = {
  version: typeof ACCOUNT_SCOPE_INDEX_VERSION;
  scope: string;
  generation: number;
};

type AccountScopeIndexReference = {
  version: typeof ACCOUNT_SCOPE_INDEX_VERSION;
  ordinal: number;
  generation: number;
};

type AccountScopeReservation = {
  scope: string;
  ordinal: number;
  generation: number;
  alreadyPublished: boolean;
};

function storageScope(accountId: string, groupId: string) {
  return `${RECORD_PREFIX}.${nativeGoogleHealthStableHash(
    `${accountId}\u0000${groupId}`,
  )}`;
}

function manifestKey(scope: string) {
  return `${scope}.manifest`;
}

function accountStoragePrefix(accountId: string) {
  return `${RECORD_PREFIX}.account.${nativeGoogleHealthStableHash(accountId)}`;
}

function legacyAccountIndexKey(accountId: string) {
  return `${accountStoragePrefix(accountId)}.groups`;
}

function accountGenerationKey(accountId: string) {
  return `${accountStoragePrefix(accountId)}.generation`;
}

function accountScopeIndexHeaderKey(accountId: string) {
  return `${accountStoragePrefix(accountId)}.scope-index-v1`;
}

function accountScopeIndexSlotKey(accountId: string, ordinal: number) {
  return `${accountStoragePrefix(accountId)}.scope-slot.${ordinal}`;
}

function accountScopeIndexReferenceKey(accountId: string, scope: string) {
  return `${accountStoragePrefix(accountId)}.scope-ref.${scope.slice(
    `${RECORD_PREFIX}.`.length,
  )}`;
}

function isStorageScope(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const prefix = `${RECORD_PREFIX}.`;
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  return Boolean(suffix) && !suffix.includes(".") && /^[a-z0-9]+$/.test(suffix);
}

function parseLegacyAccountScopes(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? [...new Set(value.filter(isStorageScope))]
      : [];
  } catch {
    return [];
  }
}

function enqueueAccountOperation<T>(
  accountId: string,
  task: () => Promise<T>,
) {
  const previous = operationByAccount.get(accountId) ?? Promise.resolve();
  let queued: Promise<T>;
  queued = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (operationByAccount.get(accountId) === queued)
        operationByAccount.delete(accountId);
    });
  operationByAccount.set(accountId, queued);
  return queued;
}

function currentAccountMutationGeneration(accountId: string) {
  return accountMutationGeneration.get(accountId) ?? 0;
}

function advanceAccountMutationGeneration(accountId: string) {
  const generation = currentAccountMutationGeneration(accountId) + 1;
  accountMutationGeneration.set(accountId, generation);
  return generation;
}

function beginAccountPurge(accountId: string) {
  accountsBeingPurged.add(accountId);
  return advanceAccountMutationGeneration(accountId);
}

function completeAccountPurge(accountId: string, startedAt: number) {
  if (currentAccountMutationGeneration(accountId) !== startedAt) return;
  advanceAccountMutationGeneration(accountId);
  accountsBeingPurged.delete(accountId);
}

function accountRequestIsCurrent(accountId: string, requestedAt: number) {
  return (
    !accountsBeingPurged.has(accountId) &&
    currentAccountMutationGeneration(accountId) === requestedAt
  );
}

function parseAccountGeneration(raw: string | null) {
  if (raw === null) return 0;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  )
    throw new Error("invalid_google_health_account_generation");
  return value;
}

async function readAccountGeneration(accountId: string) {
  return parseAccountGeneration(
    await SecureStore.getItemAsync(
      accountGenerationKey(accountId),
      secureStoreOptions,
    ),
  );
}

function assertStableAccountGeneration(generation: number) {
  if (generation % 2 !== 0)
    throw new Error("google_health_account_purge_in_progress");
}

function generationBoundSignature(generation: number, signature: string) {
  return `${generation}:${signature}`;
}

function nextPurgeStartGeneration(generation: number) {
  if (generation > Number.MAX_SAFE_INTEGER - 3)
    throw new Error("google_health_account_generation_exhausted");
  return generation + (generation % 2 === 0 ? 1 : 2);
}

function parseAccountScopeIndexHeader(raw: string | null) {
  if (!raw) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      (value as AccountScopeIndexHeader).version !==
        ACCOUNT_SCOPE_INDEX_VERSION ||
      !Number.isSafeInteger((value as AccountScopeIndexHeader).nextOrdinal) ||
      (value as AccountScopeIndexHeader).nextOrdinal < 0 ||
      (value as AccountScopeIndexHeader).nextOrdinal >
        NATIVE_GOOGLE_GROUP_ACCOUNT_SCOPE_LIMIT
    )
      return;
    return value as AccountScopeIndexHeader;
  } catch {
    return;
  }
}

function parseAccountScopeIndexSlot(raw: string | null) {
  if (!raw) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      (value as AccountScopeIndexSlot).version !==
        ACCOUNT_SCOPE_INDEX_VERSION ||
      !isStorageScope((value as AccountScopeIndexSlot).scope) ||
      !Number.isSafeInteger((value as AccountScopeIndexSlot).generation) ||
      (value as AccountScopeIndexSlot).generation < 0
    )
      return;
    return value as AccountScopeIndexSlot;
  } catch {
    return;
  }
}

function parseAccountScopeIndexReference(raw: string | null) {
  if (!raw) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      (value as AccountScopeIndexReference).version !==
        ACCOUNT_SCOPE_INDEX_VERSION ||
      !Number.isSafeInteger((value as AccountScopeIndexReference).ordinal) ||
      (value as AccountScopeIndexReference).ordinal < 0 ||
      (value as AccountScopeIndexReference).ordinal >=
        NATIVE_GOOGLE_GROUP_ACCOUNT_SCOPE_LIMIT ||
      !Number.isSafeInteger((value as AccountScopeIndexReference).generation) ||
      (value as AccountScopeIndexReference).generation < 0
    )
      return;
    return value as AccountScopeIndexReference;
  } catch {
    return;
  }
}

async function isAccountScopePublished(
  accountId: string,
  scope: string,
  generation: number,
) {
  const reference = parseAccountScopeIndexReference(
    await SecureStore.getItemAsync(
      accountScopeIndexReferenceKey(accountId, scope),
      secureStoreOptions,
    ),
  );
  if (!reference || reference.generation !== generation) return false;
  const slot = parseAccountScopeIndexSlot(
    await SecureStore.getItemAsync(
      accountScopeIndexSlotKey(accountId, reference.ordinal),
      secureStoreOptions,
    ),
  );
  return (
    slot?.scope === scope &&
    slot.generation === generation
  );
}

async function reserveAccountScope(
  accountId: string,
  scope: string,
  generation: number,
): Promise<AccountScopeReservation> {
  if (await isAccountScopePublished(accountId, scope, generation))
    return { scope, ordinal: -1, generation, alreadyPublished: true };

  const headerKey = accountScopeIndexHeaderKey(accountId);
  const rawHeader = await SecureStore.getItemAsync(
    headerKey,
    secureStoreOptions,
  );
  const header = rawHeader
    ? parseAccountScopeIndexHeader(rawHeader)
    : { version: ACCOUNT_SCOPE_INDEX_VERSION, nextOrdinal: 0 };
  if (!header) throw new Error("invalid_google_health_account_scope_index");
  if (header.nextOrdinal >= NATIVE_GOOGLE_GROUP_ACCOUNT_SCOPE_LIMIT)
    throw new Error("google_health_account_scope_limit_reached");

  const ordinal = header.nextOrdinal;
  // Reserve the ordinal before writing its slot. A crash can leave a harmless
  // gap, but a checkpoint is never published without a discoverable slot.
  await SecureStore.setItemAsync(
    headerKey,
    JSON.stringify({ ...header, nextOrdinal: ordinal + 1 }),
    secureStoreOptions,
  );
  await SecureStore.setItemAsync(
    accountScopeIndexSlotKey(accountId, ordinal),
    JSON.stringify({
      version: ACCOUNT_SCOPE_INDEX_VERSION,
      scope,
      generation,
    } satisfies AccountScopeIndexSlot),
    secureStoreOptions,
  );
  return { scope, ordinal, generation, alreadyPublished: false };
}

async function publishAccountScope(
  accountId: string,
  reservation: AccountScopeReservation,
) {
  if (reservation.alreadyPublished) return;
  await SecureStore.setItemAsync(
    accountScopeIndexReferenceKey(accountId, reservation.scope),
    JSON.stringify({
      version: ACCOUNT_SCOPE_INDEX_VERSION,
      ordinal: reservation.ordinal,
      generation: reservation.generation,
    } satisfies AccountScopeIndexReference),
    secureStoreOptions,
  );
}

function slotManifestKey(scope: string, slot: NativeGoogleHealthGroupSlot) {
  return `${scope}.${slot}.manifest`;
}

function chunkKey(
  scope: string,
  generation: NativeGoogleHealthGroupSlot,
  index: number,
) {
  return `${scope}.${generation}.${index}`;
}

async function mapInBatches<T>(
  items: readonly T[],
  operation: (item: T, index: number) => Promise<void>,
) {
  for (let start = 0; start < items.length; start += SECURE_STORE_BATCH_SIZE) {
    const batch = items.slice(start, start + SECURE_STORE_BATCH_SIZE);
    await Promise.all(
      batch.map((item, offset) => operation(item, start + offset)),
    );
  }
}

async function readInBatches<T>(
  items: readonly T[],
  operation: (item: T, index: number) => Promise<string | null>,
) {
  const results: (string | null)[] = [];
  for (let start = 0; start < items.length; start += SECURE_STORE_BATCH_SIZE) {
    const batch = items.slice(start, start + SECURE_STORE_BATCH_SIZE);
    results.push(
      ...(await Promise.all(
        batch.map((item, offset) => operation(item, start + offset)),
      )),
    );
  }
  return results;
}

async function clearSlot(
  scope: string,
  slot: NativeGoogleHealthGroupSlot,
) {
  const key = slotManifestKey(scope, slot);
  const raw = await SecureStore.getItemAsync(key, secureStoreOptions).catch(
    () => null,
  );
  const slotManifest = parseNativeGoogleHealthManifest(raw);
  const chunkCount =
    slotManifest?.generation === slot
      ? slotManifest.chunkCount
      : raw
        ? NATIVE_GOOGLE_GROUP_MAX_CHUNKS
        : 0;
  await mapInBatches(
    Array.from({ length: chunkCount }, (_, index) => index),
    (index) =>
      SecureStore.deleteItemAsync(
        chunkKey(scope, slot, index),
        secureStoreOptions,
      ).catch(() => undefined),
  );
  await SecureStore.deleteItemAsync(key, secureStoreOptions).catch(
    () => undefined,
  );
}

async function clearAllSlots(scope: string) {
  for (const slot of SLOTS) await clearSlot(scope, slot);
}

async function readManifest(
  scope: string,
): Promise<NativeGoogleHealthGroupManifest | undefined> {
  const raw = await SecureStore.getItemAsync(
    manifestKey(scope),
    secureStoreOptions,
  );
  if (!raw) {
    await clearAllSlots(scope);
    return;
  }
  const parsed = parseNativeGoogleHealthManifest(raw);
  if (parsed) return parsed;
  await SecureStore.deleteItemAsync(
    manifestKey(scope),
    secureStoreOptions,
  ).catch(() => undefined);
  await clearAllSlots(scope);
  return;
}

async function invalidateCheckpoint(scope: string) {
  await SecureStore.deleteItemAsync(
    manifestKey(scope),
    secureStoreOptions,
  ).catch(() => undefined);
  await clearAllSlots(scope);
  lastWrittenSignature.delete(scope);
}

function enqueue(scope: string, operation: () => Promise<void>) {
  const previous = operationByScope.get(scope) ?? Promise.resolve();
  let queued: Promise<void>;
  queued = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (operationByScope.get(scope) === queued)
        operationByScope.delete(scope);
    });
  operationByScope.set(scope, queued);
  return queued;
}

export async function readGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
): Promise<GoogleHealthGroupCheckpoint | undefined> {
  if (!accountId || !groupId) return;
  const requestedAt = currentAccountMutationGeneration(accountId);
  return enqueueAccountOperation(accountId, async () => {
    const scope = storageScope(accountId, groupId);
    try {
      if (!accountRequestIsCurrent(accountId, requestedAt)) return;
      if (!(await SecureStore.isAvailableAsync())) return;
      const accountGeneration = await readAccountGeneration(accountId);
      assertStableAccountGeneration(accountGeneration);
      const scopeIsPublished = await isAccountScopePublished(
        accountId,
        scope,
        accountGeneration,
      );
      // Generation zero is the one-time upgrade window for records created
      // before the scope index existed. Once an account has crossed any purge
      // boundary, an unindexed or older-generation record is never readable.
      if (accountGeneration > 0 && !scopeIsPublished) {
        await enqueue(scope, () => invalidateCheckpoint(scope));
        latestRequestedSignature.delete(scope);
        return;
      }

      await operationByScope.get(scope)?.catch(() => undefined);
      const manifest = await readManifest(scope);
      if (!manifest) return;
      const chunks = await readInBatches(
        Array.from({ length: manifest.chunkCount }, (_, index) => index),
        (index) =>
          SecureStore.getItemAsync(
            chunkKey(scope, manifest.generation, index),
            secureStoreOptions,
          ),
      );
      if (chunks.some((chunk) => chunk === null)) {
        await invalidateCheckpoint(scope);
        return;
      }
      const serialized = joinCheckpointChunks(manifest, chunks);
      if (!serialized) {
        await invalidateCheckpoint(scope);
        return;
      }
      const checkpoint = parseNativeGoogleHealthGroupCheckpoint(
        serialized,
        accountId,
        groupId,
      );
      if (!checkpoint) {
        await invalidateCheckpoint(scope);
        return;
      }
      if (!scopeIsPublished) {
        const reservation = await reserveAccountScope(
          accountId,
          scope,
          accountGeneration,
        );
        await publishAccountScope(accountId, reservation);
      }
      if (!accountRequestIsCurrent(accountId, requestedAt)) return;
      const finalAccountGeneration = await readAccountGeneration(accountId);
      if (finalAccountGeneration !== accountGeneration) return;
      assertStableAccountGeneration(finalAccountGeneration);
      lastWrittenSignature.set(
        scope,
        generationBoundSignature(accountGeneration, manifest.contentSignature),
      );
      return checkpoint;
    } catch {
      // SecureStore failures and interrupted account purges are presentation-
      // cache misses. Cloud hydration remains authoritative.
      return;
    }
  });
}

export async function writeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
) {
  if (!source.currentUserId || !source.groupId) return;
  const serialized = serializeNativeGoogleHealthGroupCheckpoint(source);
  if (!serialized)
    return deleteGoogleHealthGroupCheckpoint(
      source.currentUserId,
      source.groupId,
    );

  const scope = storageScope(source.currentUserId, source.groupId);
  const requestedAt = currentAccountMutationGeneration(source.currentUserId);
  return enqueueAccountOperation(source.currentUserId, async () => {
    if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
    if (!(await SecureStore.isAvailableAsync())) return;
    const accountGeneration = await readAccountGeneration(
      source.currentUserId,
    );
    assertStableAccountGeneration(accountGeneration);
    const reservation = await reserveAccountScope(
      source.currentUserId,
      scope,
      accountGeneration,
    );
    if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
    const signature = nativeGoogleHealthCheckpointContentSignature(serialized);
    const inMemorySignature = generationBoundSignature(
      accountGeneration,
      signature,
    );
    if (lastWrittenSignature.get(scope) === inMemorySignature) {
      await publishAccountScope(source.currentUserId, reservation);
      const finalAccountGeneration = await readAccountGeneration(
        source.currentUserId,
      );
      if (
        !accountRequestIsCurrent(source.currentUserId, requestedAt) ||
        finalAccountGeneration !== accountGeneration
      ) {
        await SecureStore.deleteItemAsync(
          accountScopeIndexReferenceKey(source.currentUserId, scope),
          secureStoreOptions,
        ).catch(() => undefined);
        await invalidateCheckpoint(scope);
      }
      return;
    }
    latestRequestedSignature.set(scope, signature);

    return enqueue(scope, async () => {
      if (latestRequestedSignature.get(scope) !== signature) return;
      const oldManifest = await readManifest(scope);
      if (
        oldManifest?.contentSignature === signature &&
        latestRequestedSignature.get(scope) === signature
      ) {
        await publishAccountScope(source.currentUserId, reservation);
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) {
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
          await invalidateCheckpoint(scope);
          return;
        }
        const finalAccountGeneration = await readAccountGeneration(
          source.currentUserId,
        );
        if (finalAccountGeneration !== accountGeneration) {
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
          await invalidateCheckpoint(scope);
          return;
        }
        assertStableAccountGeneration(finalAccountGeneration);
        lastWrittenSignature.set(scope, inMemorySignature);
        return;
      }
      const generation: NativeGoogleHealthGroupSlot =
        oldManifest?.generation === "slot-a" ? "slot-b" : "slot-a";
      const chunked = checkpointChunks(serialized, generation);
      if (!chunked) return;
      const { chunks, manifest: nextManifest } = chunked;
      try {
        // The inactive slot is cleared and described before its chunks are
        // written. A crash therefore leaves a bounded, discoverable staging set.
        await clearSlot(scope, generation);
        await SecureStore.setItemAsync(
          slotManifestKey(scope, generation),
          JSON.stringify(nextManifest),
          secureStoreOptions,
        );
        await mapInBatches(chunks, (chunk, index) =>
          SecureStore.setItemAsync(
            chunkKey(scope, generation, index),
            chunk,
            secureStoreOptions,
          ),
        );
        if (latestRequestedSignature.get(scope) !== signature) {
          await clearSlot(scope, generation);
          return;
        }
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) {
          await clearSlot(scope, generation);
          return;
        }
        // Publish the checkpoint pointer before its account reference. A crash
        // between them leaves a discoverable but unreadable cache miss, never
        // an authorized-looking record outside the account index.
        await SecureStore.setItemAsync(
          manifestKey(scope),
          JSON.stringify(nextManifest),
          secureStoreOptions,
        );
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) {
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
          await invalidateCheckpoint(scope);
          return;
        }
        await publishAccountScope(source.currentUserId, reservation);
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) {
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
          await invalidateCheckpoint(scope);
          return;
        }
        const finalAccountGeneration = await readAccountGeneration(
          source.currentUserId,
        );
        if (finalAccountGeneration !== accountGeneration) {
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
          await invalidateCheckpoint(scope);
          return;
        }
        assertStableAccountGeneration(finalAccountGeneration);
        lastWrittenSignature.set(scope, inMemorySignature);
        if (oldManifest?.generation !== generation)
          await clearSlot(scope, oldManifest!.generation);
      } catch {
        if (!reservation.alreadyPublished)
          await SecureStore.deleteItemAsync(
            accountScopeIndexReferenceKey(source.currentUserId, scope),
            secureStoreOptions,
          ).catch(() => undefined);
        await clearSlot(scope, generation);
      }
    });
  });
}

export async function deleteGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
) {
  if (!accountId || !groupId) return;
  return enqueueAccountOperation(accountId, async () => {
    if (!(await SecureStore.isAvailableAsync())) return;
    const scope = storageScope(accountId, groupId);
    const signature = `delete-${++deleteSequence}`;
    latestRequestedSignature.set(scope, signature);
    return enqueue(scope, async () => {
      if (latestRequestedSignature.get(scope) !== signature) return;
      // Revoke the published pointer before deleting chunks so an interrupted
      // cleanup cannot make a stale authorized value visible again.
      await SecureStore.deleteItemAsync(
        manifestKey(scope),
        secureStoreOptions,
      ).catch(() => undefined);
      await clearAllSlots(scope);
      lastWrittenSignature.delete(scope);
    });
  });
}

export async function deleteGoogleHealthGroupCheckpointsForAccount(
  accountId: string,
) {
  if (!accountId) return;
  const startedAt = beginAccountPurge(accountId);
  return enqueueAccountOperation(accountId, async () => {
    if (!(await SecureStore.isAvailableAsync())) return;
    const priorGeneration = await readAccountGeneration(accountId);
    const purgeGeneration = nextPurgeStartGeneration(priorGeneration);
    // Odd generations are durable purge fences. If cleanup is interrupted,
    // every read/write remains fail-closed until a later purge resumes it.
    await SecureStore.setItemAsync(
      accountGenerationKey(accountId),
      JSON.stringify(purgeGeneration),
      secureStoreOptions,
    );

    const scopes = new Set(
      parseLegacyAccountScopes(
        await SecureStore.getItemAsync(
          legacyAccountIndexKey(accountId),
          secureStoreOptions,
        ).catch(() => null),
      ),
    );
    const header = parseAccountScopeIndexHeader(
      await SecureStore.getItemAsync(
        accountScopeIndexHeaderKey(accountId),
        secureStoreOptions,
      ).catch(() => null),
    );
    const indexedCount = header?.nextOrdinal ?? 0;
    for (
      let start = 0;
      start < indexedCount;
      start += SECURE_STORE_BATCH_SIZE
    ) {
      const ordinals = Array.from(
        { length: Math.min(SECURE_STORE_BATCH_SIZE, indexedCount - start) },
        (_, offset) => start + offset,
      );
      const slots = await Promise.all(
        ordinals.map((ordinal) =>
          SecureStore.getItemAsync(
            accountScopeIndexSlotKey(accountId, ordinal),
            secureStoreOptions,
          ).catch(() => null),
        ),
      );
      for (const raw of slots) {
        const slot = parseAccountScopeIndexSlot(raw);
        if (slot) scopes.add(slot.scope);
      }
    }

    await mapInBatches([...scopes], async (scope) => {
      await enqueue(scope, () => invalidateCheckpoint(scope));
      latestRequestedSignature.delete(scope);
      await SecureStore.deleteItemAsync(
        accountScopeIndexReferenceKey(accountId, scope),
        secureStoreOptions,
      ).catch(() => undefined);
    });
    for (
      let start = 0;
      start < indexedCount;
      start += SECURE_STORE_BATCH_SIZE
    ) {
      const ordinals = Array.from(
        { length: Math.min(SECURE_STORE_BATCH_SIZE, indexedCount - start) },
        (_, offset) => start + offset,
      );
      await Promise.all(
        ordinals.map((ordinal) =>
          SecureStore.deleteItemAsync(
            accountScopeIndexSlotKey(accountId, ordinal),
            secureStoreOptions,
          ).catch(() => undefined),
        ),
      );
    }
    await SecureStore.deleteItemAsync(
      accountScopeIndexHeaderKey(accountId),
      secureStoreOptions,
    ).catch(() => undefined);
    await SecureStore.deleteItemAsync(
      legacyAccountIndexKey(accountId),
      secureStoreOptions,
    ).catch(() => undefined);

    // The following even generation is the only successful completion marker.
    // New writes queued during this purge cannot run until this is durable.
    await SecureStore.setItemAsync(
      accountGenerationKey(accountId),
      JSON.stringify(purgeGeneration + 1),
      secureStoreOptions,
    );
    completeAccountPurge(accountId, startedAt);
  });
}
