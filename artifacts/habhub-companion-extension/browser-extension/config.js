export const DEFAULT_APP_URL = "https://habhub.expo.app";

export async function getAppUrl() {
  const saved = await chrome.storage.local.get("appUrl");
  return String(saved.appUrl || DEFAULT_APP_URL).replace(/\/$/, "");
}
