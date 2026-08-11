import { useCallback, useEffect, useRef } from "react";
import {
  AppState as NativeAppState,
  InteractionManager,
  Platform,
} from "react-native";

import { dateKey } from "@/src/domain/date";
import { notifyScreenTimeAppLimits } from "@/src/notifications/push";
import { cacheScreenTimeReport } from "@/src/screenTime/cache";
import {
  hasScreenTimeAccess,
  isScreenTimeSupported,
  queryTodayScreenTime,
} from "@/src/screenTime";
import { useApp } from "@/src/state/AppProvider";

const FOREGROUND_REFRESH_MS = 5 * 60 * 1000;

/**
 * Imports only the private daily total into app state. The per-app breakdown
 * remains in device-only storage and is available through `queryScreenTime`.
 */
export function ScreenTimeSyncBridge() {
  const { state, hydrated, setDeviceScreenTime } = useApp();
  const stateRef = useRef(state);
  const setDeviceScreenTimeRef = useRef(setDeviceScreenTime);
  const syncingRef = useRef(false);
  stateRef.current = state;
  setDeviceScreenTimeRef.current = setDeviceScreenTime;

  const sync = useCallback(async () => {
    if (
      Platform.OS !== "android" ||
      NativeAppState.currentState !== "active" ||
      !hydrated ||
      syncingRef.current ||
      !stateRef.current.metrics.some((metric) => metric.id === "screen_time") ||
      !isScreenTimeSupported()
    )
      return;
    syncingRef.current = true;
    try {
      if (!(await hasScreenTimeAccess())) return;
      const report = await queryTodayScreenTime(150);
      if (!report.accessGranted) return;
      const localDate = dateKey();
      await cacheScreenTimeReport(localDate, report);
      await notifyScreenTimeAppLimits(
        stateRef.current,
        report,
        localDate,
      ).catch(() => undefined);
      const minutes = Math.round((report.screenTimeMs / 60000) * 10) / 10;
      const existing = stateRef.current.entries.find(
        (entry) =>
          entry.userId === stateRef.current.currentUserId &&
          entry.metricId === "screen_time" &&
          entry.localDate === localDate &&
          entry.sourceOrigin === "android_usage_stats",
      );
      if (Math.abs(Number(existing?.value ?? -1) - minutes) >= 0.5) {
        setDeviceScreenTimeRef.current(
          localDate,
          minutes,
          new Date(report.to).toISOString(),
        );
      }
    } catch {
      // Usage access can be revoked at any time; settings owns the user-facing state.
    } finally {
      syncingRef.current = false;
    }
  }, [hydrated]);

  useEffect(() => {
    let queued = false;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null =
      null;
    const cancelQueued = () => {
      queued = false;
      if (delayTimer) clearTimeout(delayTimer);
      delayTimer = null;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = null;
      idleTask?.cancel();
      idleTask = null;
    };
    const schedule = (delayMs: number) => {
      if (NativeAppState.currentState !== "active" || queued) return;
      queued = true;
      delayTimer = setTimeout(() => {
        delayTimer = null;
        let completed = false;
        const run = () => {
          if (completed) return;
          completed = true;
          queued = false;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = null;
          idleTask?.cancel();
          idleTask = null;
          void sync();
        };
        // UsageStats queries and limit evaluation can touch every installed
        // app. Keep that work away from startup/resume navigation frames, with
        // a bounded fallback so screen-time data still refreshes reliably.
        const task = InteractionManager.runAfterInteractions(run);
        if (completed) task.cancel();
        else {
          idleTask = task;
          fallbackTimer = setTimeout(run, 1_500);
        }
      }, delayMs);
    };
    schedule(1_200);
    const interval = setInterval(() => schedule(0), FOREGROUND_REFRESH_MS);
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next === "active") schedule(900);
      else cancelQueued();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      cancelQueued();
    };
  }, [sync]);

  return null;
}
