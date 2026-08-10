export const DEFAULT_APP_URL = "https://habhub.expo.app";

const LEGACY_APP_URLS = new Set(["https://sethypoo-habhub.expo.app"]);

function normalizeAppUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export async function getAppUrl() {
  const saved = await chrome.storage.local.get("appUrl");
  const savedUrl = normalizeAppUrl(saved.appUrl);
  if (LEGACY_APP_URLS.has(savedUrl)) {
    await chrome.storage.local.set({ appUrl: DEFAULT_APP_URL });
    return DEFAULT_APP_URL;
  }
  return savedUrl || DEFAULT_APP_URL;
}
