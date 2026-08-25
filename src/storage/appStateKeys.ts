export const APP_STORAGE_KEY = "paceboard-state-v1";

const APP_ACCOUNT_STORAGE_KEY_PREFIX = "habhub-account-state-v1:";

export function appAccountStorageKey(accountId: string) {
  return `${APP_ACCOUNT_STORAGE_KEY_PREFIX}${accountId}`;
}

export function isAppAccountStorageKey(key: string) {
  return key.startsWith(APP_ACCOUNT_STORAGE_KEY_PREFIX);
}
