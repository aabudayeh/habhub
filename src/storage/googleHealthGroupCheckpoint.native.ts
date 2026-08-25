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

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: KEYCHAIN_SERVICE,
};

const operationByScope = new Map<string, Promise<void>>();
const latestRequestedSignature = new Map<string, string>();
const lastWrittenSignature = new Map<string, string>();
let deleteSequence = 0;

function storageScope(accountId: string, groupId: string) {
  return `${RECORD_PREFIX}.${nativeGoogleHealthStableHash(
    `${accountId}\u0000${groupId}`,
  )}`;
}

function manifestKey(scope: string) {
  return `${scope}.manifest`;
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
  if (!accountId || !groupId || !(await SecureStore.isAvailableAsync()))
    return;
  const scope = storageScope(accountId, groupId);
  try {
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
    lastWrittenSignature.set(scope, manifest.contentSignature);
    return checkpoint;
  } catch {
    // SecureStore failures are presentation-cache misses. Cloud hydration
    // remains authoritative and is never blocked by this paint-ahead layer.
    return;
  }
}

export async function writeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
) {
  if (
    !source.currentUserId ||
    !source.groupId ||
    !(await SecureStore.isAvailableAsync())
  )
    return;
  const serialized = serializeNativeGoogleHealthGroupCheckpoint(source);
  if (!serialized)
    return deleteGoogleHealthGroupCheckpoint(
      source.currentUserId,
      source.groupId,
    );

  const scope = storageScope(source.currentUserId, source.groupId);
  const signature = nativeGoogleHealthCheckpointContentSignature(serialized);
  if (lastWrittenSignature.get(scope) === signature) return;
  latestRequestedSignature.set(scope, signature);

  return enqueue(scope, async () => {
    if (latestRequestedSignature.get(scope) !== signature) return;
    const oldManifest = await readManifest(scope);
    if (
      oldManifest?.contentSignature === signature &&
      latestRequestedSignature.get(scope) === signature
    ) {
      lastWrittenSignature.set(scope, signature);
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
      // Publish last: readers see either the complete prior generation or the
      // complete new generation, never a partially written checkpoint.
      await SecureStore.setItemAsync(
        manifestKey(scope),
        JSON.stringify(nextManifest),
        secureStoreOptions,
      );
      lastWrittenSignature.set(scope, signature);
      if (oldManifest?.generation !== generation)
        await clearSlot(scope, oldManifest!.generation);
    } catch {
      await clearSlot(scope, generation);
    }
  });
}

export async function deleteGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
) {
  if (!accountId || !groupId || !(await SecureStore.isAvailableAsync()))
    return;
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
}
