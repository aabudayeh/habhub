import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenTimeReport } from "@/src/screenTime";

// v3 invalidates reports produced before the activity-transition fix. Some
// Android builds emit a delayed ACTIVITY_STOPPED after the next Activity in
// the same app resumes; treating that event as background undercounted usage.
const PREFIX = "habhub:screen-time-report:v3:";

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
