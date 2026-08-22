import AsyncStorage from "@react-native-async-storage/async-storage";

export class LargeStorageReadError extends Error {}

export function migrateLegacyLargeStorage() {
  return Promise.resolve();
}

export function getLargeStorageItem(key: string) {
  return AsyncStorage.getItem(key);
}

export function setLargeStorageItem(key: string, value: string) {
  return AsyncStorage.setItem(key, value);
}

/** Native AsyncStorage has one durable copy, so its ordinary write is strict. */
export function setLargeStorageItemStrict(key: string, value: string) {
  return AsyncStorage.setItem(key, value);
}

export function multiGetLargeStorage(keys: readonly string[]) {
  return AsyncStorage.multiGet([...keys]);
}

export function multiSetLargeStorage(
  entries: readonly (readonly [string, string])[],
) {
  return AsyncStorage.multiSet(entries.map(([key, value]) => [key, value]));
}

export function getAllLargeStorageKeys() {
  return AsyncStorage.getAllKeys();
}

export function removeLargeStorageItem(key: string) {
  return AsyncStorage.removeItem(key);
}

export function multiRemoveLargeStorage(keys: readonly string[]) {
  return AsyncStorage.multiRemove([...keys]);
}
