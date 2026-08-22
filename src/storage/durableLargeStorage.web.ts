import AsyncStorage from "@react-native-async-storage/async-storage";

const DATABASE_NAME = "habhub-durable-state-v1";
const STORE_NAME = "large-state";
const DATABASE_VERSION = 1;
const MIGRATION_MARKER = "habhub-large-state-indexeddb-migration-v1";
const LARGE_STORAGE_KEYS = new Set([
  "paceboard-state-v1",
  "metric-rally:group-activity-cache-index:v1",
]);
const LARGE_STORAGE_PREFIXES = [
  "habhub-account-state-v1:",
  "metric-rally:group-activity-cache:v1:",
  "habhub-cloud-merge-base-v4:",
];

export class LargeStorageReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LargeStorageReadError";
  }
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

function invalidateDatabase() {
  const stale = databasePromise;
  databasePromise = null;
  void stale?.then((database) => database?.close()).catch(() => undefined);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase | null>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (cause) {
      reject(
        new LargeStorageReadError("Browser durable storage could not open.", {
          cause,
        }),
      );
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME);
    };
    request.onerror = () => {
      invalidateDatabase();
      reject(
        new LargeStorageReadError("Browser durable storage could not open.", {
          cause: request.error,
        }),
      );
    };
    request.onblocked = () => {
      invalidateDatabase();
      reject(
        new LargeStorageReadError(
          "Browser durable storage is temporarily blocked by another HabHub tab.",
        ),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
  });
  return databasePromise;
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Browser storage write was aborted."),
      );
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Browser storage write failed."));
  });
}

async function indexedDbGetOnce(key: string) {
  const database = await openDatabase();
  if (!database) return { available: false as const, value: null };
  return new Promise<{ available: true; value: string | null }>(
    (resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () =>
        resolve({
          available: true,
          value: typeof request.result === "string" ? request.result : null,
        });
      request.onerror = () =>
        reject(request.error ?? new Error("Browser storage read failed."));
    },
  );
}

async function indexedDbGet(key: string) {
  let cause: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await indexedDbGetOnce(key);
    } catch (error) {
      cause = error;
      invalidateDatabase();
    }
  }
  throw new LargeStorageReadError("Browser durable storage could not be read.", {
    cause,
  });
}

async function indexedDbSet(entries: readonly (readonly [string, string])[]) {
  const database = await openDatabase();
  if (!database) return false;
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  for (const [key, value] of entries) store.put(value, key);
  await transactionComplete(transaction);
  return true;
}

async function indexedDbKeysOnce() {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise<string[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () =>
      resolve(
        request.result.filter(
          (key): key is string => typeof key === "string",
        ),
      );
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage key read failed."));
  });
}

async function indexedDbKeys() {
  let cause: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await indexedDbKeysOnce();
    } catch (error) {
      cause = error;
      invalidateDatabase();
    }
  }
  throw new LargeStorageReadError(
    "Browser durable storage keys could not be read.",
    { cause },
  );
}

async function indexedDbRemove(keys: readonly string[]) {
  const database = await openDatabase();
  if (!database) return false;
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  for (const key of keys) store.delete(key);
  await transactionComplete(transaction);
  return true;
}

async function removeLegacyCopies(keys: readonly string[]) {
  await AsyncStorage.multiRemove([...keys]).catch(() => undefined);
}

function persistedAt(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    const candidates: string[] = [];
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["lastSavedAt", "writtenAt", "updatedAt"]) {
        if (typeof record[key] === "string") candidates.push(record[key]);
      }
    } else if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).writtenAt === "string"
        )
          candidates.push(
            String((item as Record<string, unknown>).writtenAt),
          );
      }
    }
    return Math.max(
      ...candidates.map((candidate) => new Date(candidate).getTime()),
      Number.NEGATIVE_INFINITY,
    );
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

function legacyIsNewer(key: string, indexed: string, legacy: string) {
  if (indexed === legacy) return false;
  const indexedAt = persistedAt(indexed);
  const legacyAt = persistedAt(legacy);
  if (Number.isFinite(indexedAt) || Number.isFinite(legacyAt)) {
    if (!Number.isFinite(legacyAt)) return false;
    if (!Number.isFinite(indexedAt)) return true;
    // Equal revisions can contain a privacy scrub or another repair that did
    // not intentionally mutate the user's lastSavedAt timestamp.
    return legacyAt >= indexedAt;
  }
  // Merge bases are disposable derived caches. If both copies predate storage
  // revisions, prefer IndexedDB so an old open tab cannot resurrect a stale
  // localStorage merge base and misclassify a later cloud conflict.
  if (key.startsWith("habhub-cloud-merge-base-v4:")) return false;
  // A localStorage value that reappears after migration comes from an older
  // still-running HabHub tab. Preserve it when neither format has a revision.
  return true;
}

function isLargeStorageKey(key: string) {
  return (
    LARGE_STORAGE_KEYS.has(key) ||
    LARGE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/** Keep the newest IndexedDB/localStorage copy during a rolling deployment. */
export async function getLargeStorageItem(key: string) {
  const legacy = await AsyncStorage.getItem(key).catch(() => null);
  let indexed: Awaited<ReturnType<typeof indexedDbGet>>;
  try {
    indexed = await indexedDbGet(key);
  } catch (error) {
    if (legacy !== null) return legacy;
    throw error;
  }
  if (!indexed.available) return legacy;
  if (
    legacy !== null &&
    (indexed.value === null || legacyIsNewer(key, indexed.value, legacy))
  ) {
    try {
      await indexedDbSet([[key, legacy]]);
    } catch {
      invalidateDatabase();
      return legacy;
    }
    await removeLegacyCopies([key]);
    return legacy;
  }
  if (indexed.value !== null) {
    if (legacy !== null) await removeLegacyCopies([key]);
    return indexed.value;
  }
  return null;
}

/**
 * Move every legacy large value before cloud sync starts. A completed marker
 * avoids parsing on ordinary launches, while the key check still catches an
 * older open PWA tab that recreated a localStorage value after deployment.
 */
export async function migrateLegacyLargeStorage() {
  const legacyKeys = await AsyncStorage.getAllKeys().catch(() => []);
  const largeKeys = legacyKeys.filter(isLargeStorageKey);
  if (
    (await AsyncStorage.getItem(MIGRATION_MARKER).catch(() => null)) ===
      "done" &&
    largeKeys.length === 0
  )
    return;
  for (const key of largeKeys) await getLargeStorageItem(key);
  const remaining = (await AsyncStorage.getAllKeys().catch(() => [])).filter(
    isLargeStorageKey,
  );
  if (remaining.length === 0)
    await AsyncStorage.setItem(MIGRATION_MARKER, "done").catch(
      () => undefined,
    );
}

export async function setLargeStorageItem(key: string, value: string) {
  try {
    if (await indexedDbSet([[key, value]])) {
      await removeLegacyCopies([key]);
      return;
    }
  } catch {
    invalidateDatabase();
  }
  await AsyncStorage.setItem(key, value);
}

/**
 * Privacy migrations use this verified path: when IndexedDB exists, a legacy
 * localStorage fallback alone is not enough to declare an unsafe row scrubbed.
 */
export async function setLargeStorageItemStrict(key: string, value: string) {
  let durableAvailable: boolean;
  try {
    durableAvailable = await indexedDbSet([[key, value]]);
  } catch (cause) {
    invalidateDatabase();
    throw new Error("Browser durable storage could not be updated safely.", {
      cause,
    });
  }
  if (!durableAvailable) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  // Do not swallow this cleanup: a stale equal-revision plaintext fallback
  // could otherwise win the next rolling-deployment read and repopulate IDB.
  await AsyncStorage.removeItem(key);
}

export function multiGetLargeStorage(keys: readonly string[]) {
  return Promise.all(
    keys.map(
      async (key) =>
        [key, await getLargeStorageItem(key)] as [string, string | null],
    ),
  );
}

export async function multiSetLargeStorage(
  entries: readonly (readonly [string, string])[],
) {
  try {
    if (await indexedDbSet(entries)) {
      await removeLegacyCopies(entries.map(([key]) => key));
      return;
    }
  } catch {
    invalidateDatabase();
  }
  await AsyncStorage.multiSet(entries.map(([key, value]) => [key, value]));
}

export async function getAllLargeStorageKeys() {
  const [indexed, legacy] = await Promise.all([
    indexedDbKeys(),
    AsyncStorage.getAllKeys(),
  ]);
  return [...new Set([...(indexed ?? []), ...legacy])];
}

export async function removeLargeStorageItem(key: string) {
  await Promise.all([
    indexedDbRemove([key]).catch(() => false),
    AsyncStorage.removeItem(key).catch(() => undefined),
  ]);
}

export async function multiRemoveLargeStorage(keys: readonly string[]) {
  await Promise.all([
    indexedDbRemove(keys).catch(() => false),
    removeLegacyCopies(keys),
  ]);
}
