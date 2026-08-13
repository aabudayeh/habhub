import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenTimeReport } from "@/src/screenTime";

// v4 invalidates expanded UsageStats buckets that could exceed 24 hours for a
// selected day and adds the exact daily samples used by charts and Entries.
const PREFIX = "habhub:screen-time-report:v4:";

export async function cacheScreenTimeReport(
  localDate: string,
  report: ScreenTimeReport,
) {
  await AsyncStorage.setItem(`${PREFIX}${localDate}`, JSON.stringify(report));
}

export async function readCachedScreenTimeReport(localDate: string) {
  const raw = await AsyncStorage.getItem(`${PREFIX}${localDate}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScreenTimeReport;
  } catch {
    return null;
  }
}
