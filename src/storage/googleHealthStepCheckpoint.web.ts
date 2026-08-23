import {
  buildGoogleHealthStepCheckpoint,
  type GoogleHealthStepCheckpoint,
  type GoogleHealthStepCheckpointSource,
} from "@/src/domain/googleHealthStepCheckpoint";

const DATABASE_NAME = "habhub-private-health-v1";
const STORE_NAME = "encrypted-checkpoints";
const DATABASE_VERSION = 1;
const KEY_ID = "device-key";
const CHECKPOINT_PREFIX = "google-steps:";
const AAD_PREFIX = "habhub-google-steps-v1:";

type KeyRecord = { id: typeof KEY_ID; kind: "key"; value: CryptoKey };
type CipherRecord = {
  id: string;
  kind: "cipher";
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  updatedAt: number;
};

let databasePromise: Promise<IDBDatabase> | undefined;
let keyCreationPromise: Promise<CryptoKey> | undefined;
let lastWrittenSignature = new Map<string, string>();
const latestRequestedSignature = new Map<string, string>();
const operationByAccount = new Map<string, Promise<void>>();

function supported() {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    Boolean(crypto.subtle)
  );
}

function database() {
  if (!supported()) return Promise.reject(new Error("encrypted_storage_unavailable"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("encrypted_storage_open_failed"));
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
    request.onerror = () => reject(request.error ?? new Error("encrypted_storage_read_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("encrypted_storage_read_aborted"));
  });
}

async function writeRecord(value: KeyRecord | CipherRecord) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("encrypted_storage_write_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("encrypted_storage_write_aborted"));
  });
}

async function deleteRecord(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("encrypted_storage_delete_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("encrypted_storage_delete_aborted"));
  });
}

async function encryptionKey(create: boolean) {
  const existing = await readRecord<KeyRecord>(KEY_ID);
  if (existing?.kind === "key" && existing.value) return existing.value;
  if (!create) return undefined;
  if (keyCreationPromise) return keyCreationPromise;
  let creation: Promise<CryptoKey>;
  creation = (async () => {
    // Another account may begin its first checkpoint during the same browser
    // turn. Re-read after entering the shared gate, then create exactly one
    // non-extractable origin key so no ciphertext is stranded under an
    // overwritten KEY_ID.
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

function recordId(accountId: string) {
  return `${CHECKPOINT_PREFIX}${accountId}`;
}

function additionalData(accountId: string) {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}`);
}

export async function readGoogleHealthStepCheckpoint(
  accountId: string,
): Promise<GoogleHealthStepCheckpoint | undefined> {
  if (!supported() || !accountId) return;
  try {
    const [key, record] = await Promise.all([
      encryptionKey(false),
      readRecord<CipherRecord>(recordId(accountId)),
    ]);
    if (!key || record?.kind !== "cipher") return;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(record.iv),
        additionalData: additionalData(accountId),
      },
      key,
      record.ciphertext,
    );
    return JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as GoogleHealthStepCheckpoint;
  } catch {
    await deleteRecord(recordId(accountId)).catch(() => undefined);
    return;
  }
}

export async function writeGoogleHealthStepCheckpoint(
  state: GoogleHealthStepCheckpointSource,
) {
  if (!supported() || !state.currentUserId) return;
  const checkpoint = buildGoogleHealthStepCheckpoint(state);
  // A clean/transient account state is staged while cloud hydration and
  // boundary recovery run. Absence here therefore is not authoritative
  // removal and must not erase the last confirmed Steps checkpoint. Explicit
  // disconnect, sign-out, purge, and account deletion use the delete API.
  if (!checkpoint) return;
  const signature = JSON.stringify(checkpoint.entries);
  if (lastWrittenSignature.get(state.currentUserId) === signature) return;
  const accountId = state.currentUserId;
  latestRequestedSignature.set(accountId, signature);
  const prior = operationByAccount.get(accountId) ?? Promise.resolve();
  const operation = prior
    .catch(() => undefined)
    .then(async () => {
      if (latestRequestedSignature.get(accountId) !== signature) return;
      const key = await encryptionKey(true);
      if (!key || latestRequestedSignature.get(accountId) !== signature) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: additionalData(accountId),
        },
        key,
        new TextEncoder().encode(JSON.stringify(checkpoint)),
      );
      if (latestRequestedSignature.get(accountId) !== signature) return;
      await writeRecord({
        id: recordId(accountId),
        kind: "cipher",
        iv: iv.slice().buffer as ArrayBuffer,
        ciphertext,
        updatedAt: Date.now(),
      });
      if (latestRequestedSignature.get(accountId) === signature)
        lastWrittenSignature.set(accountId, signature);
    })
    .finally(() => {
      if (operationByAccount.get(accountId) === operation)
        operationByAccount.delete(accountId);
    });
  operationByAccount.set(accountId, operation);
  return operation;
}

export async function deleteGoogleHealthStepCheckpoint(accountId: string) {
  if (!supported() || !accountId) return;
  const signature = `delete:${Date.now()}:${Math.random()}`;
  latestRequestedSignature.set(accountId, signature);
  const prior = operationByAccount.get(accountId) ?? Promise.resolve();
  const operation = prior
    .catch(() => undefined)
    .then(async () => {
      if (latestRequestedSignature.get(accountId) !== signature) return;
      await deleteRecord(recordId(accountId)).catch(() => undefined);
      if (latestRequestedSignature.get(accountId) === signature)
        lastWrittenSignature.delete(accountId);
    })
    .finally(() => {
      if (operationByAccount.get(accountId) === operation)
        operationByAccount.delete(accountId);
    });
  operationByAccount.set(accountId, operation);
  return operation;
}
