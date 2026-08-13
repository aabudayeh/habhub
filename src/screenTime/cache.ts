import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenTimeReport } from "@/src/screenTime";

// v5 prefers DAILY-granularity UsageStats buckets over incomplete OEM events.
const PREFIX = "habhub:screen-time-report:v5:";

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
