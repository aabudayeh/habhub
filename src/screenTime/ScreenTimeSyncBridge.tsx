import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef } from "react";
import {
  AppState as NativeAppState,
  InteractionManager,
  Platform,
} from "react-native";

import { dateKey } from "@/src/domain/date";
import {
  boundedScreenTimeMs,
  changedScreenTimeTrackerSamples,
  screenTimeTrackerSamples,
} from "@/src/domain/screenTime";
import { notifyScreenTimeAppLimits } from "@/src/notifications/push";
import { cacheScreenTimeReport } from "@/src/screenTime/cache";
import {
  hasScreenTimeAccess,
  isScreenTimeSupported,
  queryScreenTime,
  queryTodayScreenTime,
} from "@/src/screenTime";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

const FOREGROUND_REFRESH_MS = 5 * 60 * 1000;
const AVAILABLE_HISTORY_DAYS = 730;
// v3 rehydrates dates once after removing proportional OEM bucket spreading.
const HISTORY_SYNC_PREFIX = "habhub:screen-time-history:v3:";

function waitForInteractionIdle(maxWaitMs = 1_500) {
  return new Promise<void>((resolve) => {
    let finished = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null =
      null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallback) clearTimeout(fallback);
      fallback = null;
      task?.cancel();
      resolve();
    };
    task = InteractionManager.runAfterInteractions(finish);
    if (finished) task.cancel();
    else fallback = setTimeout(finish, maxWaitMs);
  });
}

/**
 * Imports private daily totals into app state. Per-app usage remains in
 * device-only storage and is never included in the tracker/cloud entry.
 */
export function ScreenTimeSyncBridge() {
  const {
    state,
    hydrated,
    setDeviceScreenTime,
    setDeviceScreenTimeRange,
  } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const stateRef = useRef(state);
  const setDeviceScreenTimeRef = useRef(setDeviceScreenTime);
  const setDeviceScreenTimeRangeRef = useRef(setDeviceScreenTimeRange);
  const syncingRef = useRef(false);
  const historySyncingRef = useRef(false);
  stateRef.current = state;
  setDeviceScreenTimeRef.current = setDeviceScreenTime;
  setDeviceScreenTimeRangeRef.current = setDeviceScreenTimeRange;

  const syncAvailableHistory = useCallback(async () => {
    if (
      Platform.OS !== "android" ||
      tutorialSandbox ||
      NativeAppState.currentState !== "active" ||
      !hydrated ||
      historySyncingRef.current ||
      !stateRef.current.metrics.some((metric) => metric.id === "screen_time") ||
      !isScreenTimeSupported()
    )
      return;
    const userId = stateRef.current.currentUserId;
    const markerKey = `${HISTORY_SYNC_PREFIX}${userId}`;
    if ((await AsyncStorage.getItem(markerKey)) === dateKey()) return;
    historySyncingRef.current = true;
    try {
      if (!(await hasScreenTimeAccess())) return;
      const to = new Date();
      const from = new Date(to);
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - AVAILABLE_HISTORY_DAYS + 1);
      const report = await queryScreenTime(from, to, 150);
      if (!report.accessGranted) return;
      const samples = screenTimeTrackerSamples(report.days);
      // The native query is asynchronous, but its result may arrive during a
      // gesture. Apply retained history after interactions, once, and replace
      // only dates whose device-owned total actually changed.
      await waitForInteractionIdle();
      if (NativeAppState.currentState !== "active") return;
      const current = stateRef.current;
      const changed = changedScreenTimeTrackerSamples(
        samples,
        current.entries.filter(
          (entry) =>
            entry.userId === current.currentUserId &&
            entry.metricId === "screen_time" &&
            entry.sourceOrigin === "android_usage_stats",
        ),
      );
      if (changed.length) setDeviceScreenTimeRangeRef.current(changed);
      // OEM retention may be shorter than the requested two-year window. A
      // successful sparse response is still complete for what UsageStats made
      // available today, so do not repeat the expensive query every resume.
      await AsyncStorage.setItem(markerKey, dateKey());
    } catch {
      // Permission can be revoked or an OEM can temporarily reject a long read.
      // Leave the marker unset so a later foreground visit can retry.
    } finally {
      historySyncingRef.current = false;
    }
  }, [hydrated, tutorialSandbox]);

  const sync = useCallback(async () => {
    if (
      Platform.OS !== "android" ||
      tutorialSandbox ||
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
      const daily = screenTimeTrackerSamples(report.days).find(
        (sample) => sample.localDate === localDate,
      );
      const minutes = daily?.minutes ??
        Math.round(
          (boundedScreenTimeMs(report.screenTimeMs, report.to - report.from) /
            60000) *
            10,
        ) /
          10;
      const recordedAt = daily?.recordedAt ?? new Date(report.to).toISOString();
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
          recordedAt,
        );
      }
      // Start the larger, once-daily history hydration only after today's
      // lightweight refresh has completed. The native query runs off the JS
      // thread and no navigation frame waits for it.
      void syncAvailableHistory();
    } catch {
      // Usage access can be revoked at any time; settings owns the user-facing state.
    } finally {
      syncingRef.current = false;
    }
  }, [hydrated, syncAvailableHistory, tutorialSandbox]);

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
