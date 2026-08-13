import { NativeModules, Platform } from "react-native";

export type ScreenTimeAppUsage = {
  packageName: string;
  appName: string;
  foregroundMs: number;
  lastTimeUsed: number;
  category: string;
  isSystemApp: boolean;
};

export type ScreenTimeReport = {
  supported: boolean;
  accessGranted: boolean;
  from: number;
  to: number;
  /** Android app-foreground totals are the closest public proxy for screen use. */
  screenTimeMs: number;
  approximate: true;
  calculationMethod?:
    | "foreground_events"
    | "aggregate_fallback"
    | "mixed";
  apps: ScreenTimeAppUsage[];
  /** Exact local-day samples used by tracker charts and Entries. */
  days?: ScreenTimeDailyUsage[];
};

export type ScreenTimeDailyUsage = {
  localDate: string;
  from: number;
  to: number;
  screenTimeMs: number;
  calculationMethod: "foreground_events" | "aggregate_fallback";
};

type HabHubAndroidModule = {
  isUsageAccessGranted(): Promise<boolean>;
  openUsageAccessSettings(): Promise<boolean>;
  queryUsageStats(
    from: number,
    to: number,
    limit: number,
  ): Promise<ScreenTimeReport>;
};

const androidModule = NativeModules.HabHubAndroid as
  | HabHubAndroidModule
  | undefined;

export function isScreenTimeSupported() {
  return Platform.OS === "android" && Boolean(androidModule);
}

export async function hasScreenTimeAccess() {
  if (!isScreenTimeSupported()) return false;
  return androidModule!.isUsageAccessGranted();
}

/**
 * Opens Android's special Usage Access page. This is not a runtime permission,
 * so callers should check `hasScreenTimeAccess()` again when the app resumes.
 */
export async function requestScreenTimeAccess() {
  if (!isScreenTimeSupported()) return false;
  return androidModule!.openUsageAccessSettings();
}

export async function queryScreenTime(
  from: Date | number,
  to: Date | number = Date.now(),
  limit = 100,
): Promise<ScreenTimeReport> {
  const fromMs = typeof from === "number" ? from : from.getTime();
  const toMs = typeof to === "number" ? to : to.getTime();
  if (!isScreenTimeSupported()) {
    return {
      supported: false,
      accessGranted: false,
      from: fromMs,
      to: toMs,
      screenTimeMs: 0,
      approximate: true,
      apps: [],
    };
  }
  return androidModule!.queryUsageStats(
    fromMs,
    toMs,
    Math.max(1, Math.min(500, Math.round(limit))),
  );
}

export function queryTodayScreenTime(limit = 100) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return queryScreenTime(start, now, limit);
}
