import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenTimeReport } from "@/src/screenTime";

// v6 prefers a fresher complete foreground-event total for today's partial
// bucket and keeps retained history on native DAILY UsageStats rows.
const PREFIX = "habhub:screen-time-report:v6:";

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
