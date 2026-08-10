import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenTimeReport } from "@/src/screenTime";

// v2 invalidates aggregate UsageStats results that could double-count
// overlapping foreground intervals. Current reports replay usage events.
const PREFIX = "habhub:screen-time-report:v2:";

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
