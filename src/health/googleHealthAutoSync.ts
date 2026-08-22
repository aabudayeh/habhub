import { Platform } from "react-native";

import { invokeGoogleHealth } from "@/src/health/googleHealthWeb";

/**
 * Foreground checks are intentionally less frequent than ordinary cloud
 * snapshot pulls. The server applies a separate 30-minute freshness gate, so
 * reopening several tabs cannot turn into repeated provider imports.
 */
export const GOOGLE_HEALTH_FOREGROUND_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const GOOGLE_HEALTH_FOREGROUND_REFRESH_MIN_AGE_MS = 30 * 60 * 1000;

const lastAttemptByAccount = new Map<string, number>();

export async function requestGoogleHealthForegroundRefresh(
  accountId: string,
  now = Date.now(),
) {
  if (Platform.OS !== "web" || !accountId) return false;
  const prior = lastAttemptByAccount.get(accountId) ?? 0;
  if (now - prior < GOOGLE_HEALTH_FOREGROUND_CHECK_INTERVAL_MS) return false;
  lastAttemptByAccount.set(accountId, now);
  try {
    await invokeGoogleHealth("refresh");
    return true;
  } catch (error) {
    // Permit a normal retry after one minute when the browser briefly reports
    // online while its network path is still recovering.
    lastAttemptByAccount.set(
      accountId,
      now - GOOGLE_HEALTH_FOREGROUND_CHECK_INTERVAL_MS + 60_000,
    );
    throw error;
  }
}
