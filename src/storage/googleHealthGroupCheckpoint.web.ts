import {
  buildGoogleHealthGroupCheckpoint,
  parseGoogleHealthGroupCheckpoint,
  type GoogleHealthGroupCheckpoint,
  type GoogleHealthGroupCheckpointSource,
} from "@/src/domain/googleHealthGroupCheckpoint";

const DATABASE_NAME = "habhub-private-group-health-v1";
const STORE_NAME = "encrypted-checkpoints";
const DATABASE_VERSION = 1;
const KEY_ID = "device-key";
const CHECKPOINT_PREFIX = "group-status:";
const ACCOUNT_BOUNDARY_PREFIX = "account-boundary:";
const AAD_PREFIX = "habhub-google-group-status-v1:";

type KeyRecord = { id: typeof KEY_ID; kind: "key"; value: CryptoKey };
type CipherRecord = {
  id: string;
  kind: "cipher";
  accountGeneration?: number;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};
type AccountBoundaryRecord = {
  id: string;
  kind: "account-boundary";
  generation: number;
};

let databasePromise: Promise<IDBDatabase> | undefined;
let keyCreationPromise: Promise<CryptoKey> | undefined;
const lastWrittenSignature = new Map<string, string>();
const latestRequestedSignature = new Map<string, string>();
const operationByRecord = new Map<string, Promise<void>>();
const operationByAccount = new Map<string, Promise<unknown>>();
const accountMutationGeneration = new Map<string, number>();
const accountsBeingPurged = new Set<string>();

function enqueueAccountOperation<T>(
  accountId: string,
  operation: () => Promise<T>,
) {
  const previous = operationByAccount.get(accountId) ?? Promise.resolve();
  let queued: Promise<T>;
  queued = previous
    .catch(() => undefined)
    .then(operation)
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

function supported() {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    Boolean(crypto.subtle)
  );
}

function database() {
  if (!supported())
    return Promise.reject(new Error("encrypted_storage_unavailable"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("encrypted_storage_open_failed"));
    request.onblocked = () => reject(new Error("encrypted_storage_blocked"));
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

async function readRecord<T>(id: string): Promise<T | undefined> {
  const db = await database();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error("encrypted_storage_read_failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("encrypted_storage_read_aborted"));
  });
}

async function writeRecord(
  value: KeyRecord | CipherRecord | AccountBoundaryRecord,
) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("encrypted_storage_write_failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("encrypted_storage_write_aborted"));
  });
}

async function deleteRecord(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("encrypted_storage_delete_failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("encrypted_storage_delete_aborted"));
  });
}

async function deleteRecordsWithPrefix(prefix: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && cursor.key.startsWith(prefix))
        cursor.delete();
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("encrypted_storage_scan_failed"));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("encrypted_storage_delete_failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("encrypted_storage_delete_aborted"));
  });
}

async function encryptionKey(create: boolean) {
  const existing = await readRecord<KeyRecord>(KEY_ID);
  if (existing?.kind === "key" && existing.value) return existing.value;
  if (!create) return undefined;
  if (keyCreationPromise) return keyCreationPromise;
  let creation: Promise<CryptoKey>;
  creation = (async () => {
    const current = await readRecord<KeyRecord>(KEY_ID);
    if (current?.kind === "key" && current.value) return current.value;
    const value = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await writeRecord({ id: KEY_ID, kind: "key", value });
    return value;
  })().finally(() => {
    if (keyCreationPromise === creation) keyCreationPromise = undefined;
  });
  keyCreationPromise = creation;
  return creation;
}

function recordId(accountId: string, groupId: string) {
  return `${CHECKPOINT_PREFIX}${accountId}:${groupId}`;
}

function accountBoundaryId(accountId: string) {
  return `${ACCOUNT_BOUNDARY_PREFIX}${encodeURIComponent(accountId)}`;
}

function parseAccountGenerationRecord(record: unknown) {
  if (record === undefined) return 0;
  if (
    !record ||
    typeof record !== "object" ||
    (record as AccountBoundaryRecord).kind !== "account-boundary" ||
    typeof (record as AccountBoundaryRecord).generation !== "number" ||
    !Number.isSafeInteger((record as AccountBoundaryRecord).generation) ||
    (record as AccountBoundaryRecord).generation < 0
  )
    throw new Error("invalid_google_health_account_generation");
  return (record as AccountBoundaryRecord).generation;
}

async function readAccountGeneration(accountId: string) {
  return parseAccountGenerationRecord(
    await readRecord<unknown>(accountBoundaryId(accountId)),
  );
}

function assertStableAccountGeneration(generation: number) {
  if (generation % 2 !== 0)
    throw new Error("google_health_account_purge_in_progress");
}

function nextPurgeStartGeneration(generation: number) {
  if (generation > Number.MAX_SAFE_INTEGER - 3)
    throw new Error("google_health_account_generation_exhausted");
  return generation + (generation % 2 === 0 ? 1 : 2);
}

async function updateAccountGenerationAtomically(
  accountId: string,
  update: (generation: number) => number | undefined,
) {
  const db = await database();
  return new Promise<number | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const id = accountBoundaryId(accountId);
    const request = store.get(id);
    let nextGeneration: number | undefined;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const next = update(parseAccountGenerationRecord(request.result));
        if (next === undefined) return;
        if (!Number.isSafeInteger(next) || next < 0)
          throw new Error("invalid_google_health_account_generation");
        nextGeneration = next;
        store.put({
          id,
          kind: "account-boundary",
          generation: next,
        } satisfies AccountBoundaryRecord);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    request.onerror = () => {
      failure = request.error;
    };
    transaction.oncomplete = () => resolve(nextGeneration);
    transaction.onerror = () => {
      failure ??= transaction.error;
    };
    transaction.onabort = () =>
      reject(
        failure instanceof Error
          ? failure
          : transaction.error ??
              new Error("encrypted_storage_generation_update_aborted"),
      );
  });
}

async function beginPersistentAccountPurge(accountId: string) {
  const generation = await updateAccountGenerationAtomically(
    accountId,
    nextPurgeStartGeneration,
  );
  if (generation === undefined)
    throw new Error("encrypted_storage_generation_start_failed");
  return generation;
}

function finishPersistentAccountPurge(
  accountId: string,
  purgeGeneration: number,
) {
  if (purgeGeneration % 2 === 0)
    return Promise.reject(
      new Error("invalid_google_health_account_purge_generation"),
    );
  // A newer tab may already own a later odd generation. Never replace that
  // active fence with this older purge's even completion value.
  return updateAccountGenerationAtomically(accountId, (current) =>
    current === purgeGeneration ? purgeGeneration + 1 : undefined,
  );
}

function additionalData(accountId: string, groupId: string) {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}:${groupId}`);
}

export async function readGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
): Promise<GoogleHealthGroupCheckpoint | undefined> {
  if (!supported() || !accountId || !groupId) return;
  const requestedAt = currentAccountMutationGeneration(accountId);
  return enqueueAccountOperation(accountId, async () => {
    const id = recordId(accountId, groupId);
    try {
      if (!accountRequestIsCurrent(accountId, requestedAt)) return;
      const accountGeneration = await readAccountGeneration(accountId);
      assertStableAccountGeneration(accountGeneration);
      const [key, record] = await Promise.all([
        encryptionKey(false),
        readRecord<CipherRecord>(id),
      ]);
      if (!key || record?.kind !== "cipher") return;
      const recordGeneration = record.accountGeneration;
      const generationMatches =
        accountGeneration === 0
          ? recordGeneration === undefined || recordGeneration === 0
          : recordGeneration === accountGeneration;
      if (!generationMatches) {
        await deleteRecord(id).catch(() => undefined);
        return;
      }
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(record.iv),
          additionalData: additionalData(accountId, groupId),
        },
        key,
        record.ciphertext,
      );
      const checkpoint = parseGoogleHealthGroupCheckpoint(
        JSON.parse(new TextDecoder().decode(plaintext)),
        accountId,
        groupId,
      );
      if (!accountRequestIsCurrent(accountId, requestedAt)) return;
      const finalAccountGeneration = await readAccountGeneration(accountId);
      if (finalAccountGeneration !== accountGeneration) return;
      assertStableAccountGeneration(finalAccountGeneration);
      return checkpoint;
    } catch {
      await deleteRecord(id).catch(() => undefined);
      return;
    }
  });
}

export async function writeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
) {
  if (!supported() || !source.currentUserId || !source.groupId) return;
  const checkpoint = buildGoogleHealthGroupCheckpoint(source);
  const id = recordId(source.currentUserId, source.groupId);
  // Absence is authoritative too. If a friend withdraws group/status access,
  // remove the previous encrypted projection instead of letting a stale exact
  // value reappear on the viewer's next offline launch.
  if (!checkpoint)
    return deleteGoogleHealthGroupCheckpoint(
      source.currentUserId,
      source.groupId,
    );
  const requestedAt = currentAccountMutationGeneration(source.currentUserId);
  return enqueueAccountOperation(source.currentUserId, async () => {
    if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
    const accountGeneration = await readAccountGeneration(
      source.currentUserId,
    );
    assertStableAccountGeneration(accountGeneration);
    const signature = JSON.stringify({
      accountGeneration,
      entries: checkpoint.entries,
      dailyMetricStatuses: checkpoint.dailyMetricStatuses,
    });
    if (lastWrittenSignature.get(id) === signature) return;
    latestRequestedSignature.set(id, signature);
    const prior = operationByRecord.get(id) ?? Promise.resolve();
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
        if (latestRequestedSignature.get(id) !== signature) return;
        const key = await encryptionKey(true);
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
        if (!key || latestRequestedSignature.get(id) !== signature) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: additionalData(
              source.currentUserId,
              source.groupId,
            ),
          },
          key,
          new TextEncoder().encode(JSON.stringify(checkpoint)),
        );
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) return;
        if (latestRequestedSignature.get(id) !== signature) return;
        await writeRecord({
          id,
          kind: "cipher",
          accountGeneration,
          iv: iv.slice().buffer as ArrayBuffer,
          ciphertext,
        });
        if (!accountRequestIsCurrent(source.currentUserId, requestedAt)) {
          await deleteRecord(id).catch(() => undefined);
          return;
        }
        if (latestRequestedSignature.get(id) === signature)
          lastWrittenSignature.set(id, signature);
      })
      .finally(() => {
        if (operationByRecord.get(id) === operation)
          operationByRecord.delete(id);
      });
    operationByRecord.set(id, operation);
    return operation;
  });
}

export async function deleteGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
) {
  if (!supported() || !accountId || !groupId) return;
  return enqueueAccountOperation(accountId, async () => {
    const id = recordId(accountId, groupId);
    const signature = `delete:${Date.now()}:${Math.random()}`;
    latestRequestedSignature.set(id, signature);
    const prior = operationByRecord.get(id) ?? Promise.resolve();
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        if (latestRequestedSignature.get(id) !== signature) return;
        await deleteRecord(id).catch(() => undefined);
        if (latestRequestedSignature.get(id) === signature)
          lastWrittenSignature.delete(id);
      })
      .finally(() => {
        if (operationByRecord.get(id) === operation)
          operationByRecord.delete(id);
      });
    operationByRecord.set(id, operation);
    return operation;
  });
}

export async function deleteGoogleHealthGroupCheckpointsForAccount(
  accountId: string,
) {
  if (!supported() || !accountId) return;
  const startedAt = beginAccountPurge(accountId);
  return enqueueAccountOperation(accountId, async () => {
    // The read-modify-write transaction allocates a unique odd generation
    // across tabs before any ciphertext cleanup starts.
    const purgeGeneration = await beginPersistentAccountPurge(accountId);
    const prefix = `${CHECKPOINT_PREFIX}${accountId}:`;
    const inFlight = [...operationByRecord.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([, operation]) => operation.catch(() => undefined));
    await Promise.all(inFlight);
    await deleteRecordsWithPrefix(prefix);
    for (const key of [...lastWrittenSignature.keys()])
      if (key.startsWith(prefix)) lastWrittenSignature.delete(key);
    for (const key of [...latestRequestedSignature.keys()])
      if (key.startsWith(prefix)) latestRequestedSignature.delete(key);
    await finishPersistentAccountPurge(accountId, purgeGeneration);
    completeAccountPurge(accountId, startedAt);
  });
}
