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
const AAD_PREFIX = "habhub-google-group-status-v1:";

type KeyRecord = { id: typeof KEY_ID; kind: "key"; value: CryptoKey };
type CipherRecord = {
  id: string;
  kind: "cipher";
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

let databasePromise: Promise<IDBDatabase> | undefined;
let keyCreationPromise: Promise<CryptoKey> | undefined;
const lastWrittenSignature = new Map<string, string>();
const latestRequestedSignature = new Map<string, string>();
const operationByRecord = new Map<string, Promise<void>>();

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

async function writeRecord(value: KeyRecord | CipherRecord) {
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

function additionalData(accountId: string, groupId: string) {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}:${groupId}`);
}

export async function readGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
): Promise<GoogleHealthGroupCheckpoint | undefined> {
  if (!supported() || !accountId || !groupId) return;
  const id = recordId(accountId, groupId);
  try {
    const [key, record] = await Promise.all([
      encryptionKey(false),
      readRecord<CipherRecord>(id),
    ]);
    if (!key || record?.kind !== "cipher") return;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(record.iv),
        additionalData: additionalData(accountId, groupId),
      },
      key,
      record.ciphertext,
    );
    return parseGoogleHealthGroupCheckpoint(
      JSON.parse(new TextDecoder().decode(plaintext)),
      accountId,
      groupId,
    );
  } catch {
    await deleteRecord(id).catch(() => undefined);
    return;
  }
}

export async function writeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
) {
  if (!supported()) return;
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
  const signature = JSON.stringify(checkpoint.dailyMetricStatuses);
  if (lastWrittenSignature.get(id) === signature) return;
  latestRequestedSignature.set(id, signature);
  const prior = operationByRecord.get(id) ?? Promise.resolve();
  const operation = prior
    .catch(() => undefined)
    .then(async () => {
      if (latestRequestedSignature.get(id) !== signature) return;
      const key = await encryptionKey(true);
      if (!key || latestRequestedSignature.get(id) !== signature) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: additionalData(source.currentUserId, source.groupId),
        },
        key,
        new TextEncoder().encode(JSON.stringify(checkpoint)),
      );
      if (latestRequestedSignature.get(id) !== signature) return;
      await writeRecord({
        id,
        kind: "cipher",
        iv: iv.slice().buffer as ArrayBuffer,
        ciphertext,
      });
      if (latestRequestedSignature.get(id) === signature)
        lastWrittenSignature.set(id, signature);
    })
    .finally(() => {
      if (operationByRecord.get(id) === operation) operationByRecord.delete(id);
    });
  operationByRecord.set(id, operation);
  return operation;
}

export async function deleteGoogleHealthGroupCheckpoint(
  accountId: string,
  groupId: string,
) {
  if (!supported() || !accountId || !groupId) return;
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
      if (operationByRecord.get(id) === operation) operationByRecord.delete(id);
    });
  operationByRecord.set(id, operation);
  return operation;
}
