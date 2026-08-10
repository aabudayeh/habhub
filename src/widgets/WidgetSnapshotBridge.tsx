import { useEffect, useRef } from "react";
import { InteractionManager } from "react-native";

import { dateKey, dateWithOffsetFrom, monthDateRange, yearDateRange } from "@/src/domain/date";
import {
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  hasMetricData,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  safeMetricValue,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import { localizeMetricName, localizeMetricUnit } from "@/src/i18n/domain";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { AppState, MetricDefinition } from "@/src/types";
import {
  areHomeScreenWidgetsSupported,
  getHomeScreenWidgetConfigurations,
  updateHomeScreenWidgets,
  WidgetHistoryPoint,
  WidgetSnapshot,
  WidgetTrackerSnapshot,
} from "@/src/widgets";

const GOAL_COMPLETE_COLOR = "#A7F432";

function pointForDate(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
): WidgetHistoryPoint {
  const userId = state.currentUserId;
  if (
    !metricApplicableOnDate(state, metric, userId, localDate) ||
    !hasMetricData(state, metric, userId, localDate)
  ) {
    return { progress: 0, status: "not_logged" };
  }
  const value = safeMetricValue(state, metric, userId, localDate);
  return {
    progress: Math.max(
      0,
      Math.min(
        1,
        displayGoalProgress(
          metric,
          value,
          effectiveGoalTarget(state, metric, userId, localDate),
        ),
      ),
    ),
    status: scheduledGoalReached(state, metric, userId, localDate)
      ? "met"
      : "missed",
  };
}

function monthSummary(
  state: AppState,
  metric: MetricDefinition,
  monthAnchor: string,
  throughDate: string,
): WidgetHistoryPoint {
  const points = monthDateRange(monthAnchor)
    .filter((day) => day <= throughDate)
    .map((day) => pointForDate(state, metric, day))
    .filter((point) => point.status !== "not_logged");
  if (!points.length) return { progress: 0, status: "not_logged" };
  return {
    progress:
      points.reduce((sum, point) => sum + point.progress, 0) / points.length,
    status: points.every((point) => point.status === "met") ? "met" : "missed",
  };
}

function trackerSnapshot(
  state: AppState,
  metric: MetricDefinition,
  today: string,
  language: AppState["settings"]["language"],
  locale: string,
  t: (source: string) => string,
): WidgetTrackerSnapshot {
  const value = safeMetricValue(state, metric, state.currentUserId, today);
  const available = hasMetricData(state, metric, state.currentUserId, today);
  const target = effectiveGoalTarget(
    state,
    metric,
    state.currentUserId,
    today,
  );
  const localizedMetric = {
    ...metric,
    name: localizeMetricName(language, metric),
    unit: localizeMetricUnit(language, metric),
  };
  const week = Array.from({ length: 7 }, (_, offset) =>
    pointForDate(state, metric, dateWithOffsetFrom(today, offset - 6)),
  );
  const month = monthDateRange(today).map((day) =>
    day <= today
      ? pointForDate(state, metric, day)
      : { progress: 0, status: "not_logged" as const },
  );
  const yearMonths = Array.from({ length: 12 }, (_, monthIndex) => {
    const year = Number(today.slice(0, 4));
    const anchor = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
    return anchor <= today
      ? monthSummary(state, metric, anchor, today)
      : { progress: 0, status: "not_logged" as const };
  });
  const progress = available
    ? displayGoalProgress(metric, value, target)
    : 0;
  const remaining = Math.max(0, target - value);
  return {
    id: metric.id,
    title: localizedMetric.name,
    value: available
      ? formatMetricValue(localizedMetric, value, locale)
      : t("Not yet available"),
    subtitle:
      available && metric.goalEnabled !== false
        ? `${formatMetricValue(localizedMetric, remaining, locale)} ${t("remaining")}`
        : t("Tap to open HabHub"),
    progress: Math.max(0, Math.min(3, progress)),
    color: metric.color,
    deepLink: `paceboard://metric-detail?metric=${encodeURIComponent(metric.id)}&date=${today}`,
    history: { week, month, year: yearMonths },
  };
}

function featuredSnapshot(
  state: AppState,
  today: string,
  language: AppState["settings"]["language"],
  locale: string,
  t: (source: string) => string,
): WidgetTrackerSnapshot {
  const tracked = state.metrics.filter(
    (metric) =>
      metric.goalEnabled !== false &&
      metric.dataType !== "text" &&
      isMetricTrackedOnDate(state, metric, today),
  );
  const pointsFor = (localDate: string): WidgetHistoryPoint => {
    const applicable = tracked.filter((metric) =>
      metricApplicableOnDate(state, metric, state.currentUserId, localDate),
    );
    const logged = applicable.filter((metric) =>
      hasMetricData(state, metric, state.currentUserId, localDate),
    );
    if (!logged.length) return { progress: 0, status: "not_logged" };
    const met = logged.filter((metric) =>
      scheduledGoalReached(state, metric, state.currentUserId, localDate),
    ).length;
    return {
      progress: applicable.length ? met / applicable.length : 0,
      status:
        applicable.length > 0 && met === applicable.length ? "met" : "missed",
    };
  };
  const todayPoint = pointsFor(today);
  const metToday = tracked.filter(
    (metric) =>
      hasMetricData(state, metric, state.currentUserId, today) &&
      scheduledGoalReached(state, metric, state.currentUserId, today),
  ).length;
  const yearDays = yearDateRange(today).filter((day) => day <= today);
  const year = Array.from({ length: 12 }, (_, monthIndex) => {
    const prefix = `${today.slice(0, 4)}-${String(monthIndex + 1).padStart(2, "0")}`;
    const points = yearDays
      .filter((day) => day.startsWith(prefix))
      .map(pointsFor)
      .filter((point) => point.status !== "not_logged");
    if (!points.length) return { progress: 0, status: "not_logged" as const };
    return {
      progress:
        points.reduce((sum, point) => sum + point.progress, 0) / points.length,
      status: points.every((point) => point.status === "met")
        ? ("met" as const)
        : ("missed" as const),
    };
  });
  const goalRows = tracked.slice(0, 3).map((metric) => {
    const available = hasMetricData(state, metric, state.currentUserId, today);
    const value = available
      ? safeMetricValue(state, metric, state.currentUserId, today)
      : 0;
    const target = effectiveGoalTarget(
      state,
      metric,
      state.currentUserId,
      today,
    );
    const localizedMetric = {
      ...metric,
      name: localizeMetricName(language, metric),
      unit: localizeMetricUnit(language, metric),
    };
    return {
      title: localizedMetric.name,
      value: available
        ? `${formatMetricValue(localizedMetric, value, locale)} / ${formatMetricValue(localizedMetric, target, locale)}`
        : t("Not yet available"),
      progress: available
        ? Math.max(0, Math.min(1, displayGoalProgress(metric, value, target)))
        : 0,
    };
  });
  return {
    id: "__featured__",
    title: "HabHub",
    value: `${Math.round(todayPoint.progress * 100)}%`,
    subtitle: `${metToday}/${tracked.length} ${t("goals complete")}`,
    progress: todayPoint.progress,
    color: todayPoint.status === "met" ? GOAL_COMPLETE_COLOR : "#58E1D4",
    deepLink: "paceboard://",
    goals: goalRows,
    history: {
      week: Array.from({ length: 7 }, (_, offset) =>
        pointsFor(dateWithOffsetFrom(today, offset - 6)),
      ),
      month: monthDateRange(today).map((day) =>
        day <= today
          ? pointsFor(day)
          : { progress: 0, status: "not_logged" as const },
      ),
      year,
    },
  };
}

/** Keeps Android widgets current without blocking navigation or app startup. */
export function WidgetSnapshotBridge() {
  const { state, hydrated } = useApp();
  const { locale, t } = useLocalization();
  const lastPayloadRef = useRef("");
  const initialSnapshotPublishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    // Native widgets do not exist in Expo Go, iOS, or web. Check before doing
    // any historical calculations so ordinary navigation stays inexpensive.
    if (!hydrated || !areHomeScreenWidgetsSupported()) return;
    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        void (async () => {
        const currentState = stateRef.current;
        const today = dateKey();
        const selectableMetrics = currentState.metrics.filter(
          (metric) =>
            metric.activeFrom <= today &&
            (metric.sections.today ||
              isMetricTrackedOnDate(currentState, metric, today)),
        );
        const initial = !initialSnapshotPublishedRef.current;
        const configurations = await getHomeScreenWidgetConfigurations().catch(
          () => [],
        );
        // With no launcher widgets, one process-local seed is enough to give
        // the native configuration picker localized choices.
        if (!initial && configurations.length === 0) return;
        const configuredIds = new Set(
          configurations
            .map((configuration) => configuration.trackerId)
            .filter((id) => id !== "__featured__"),
        );
        const metricsToCalculate =
          initial && configurations.length === 0
            ? selectableMetrics
            : selectableMetrics.filter((metric) => configuredIds.has(metric.id));
        const snapshot: WidgetSnapshot = {
          updatedAt: new Date().toISOString(),
          featured: featuredSnapshot(
            currentState,
            today,
            currentState.settings.language,
            locale,
            t,
          ),
          catalog: selectableMetrics.map((metric) => ({
            id: metric.id,
            title: localizeMetricName(currentState.settings.language, metric),
          })),
          trackers: metricsToCalculate.map((metric) =>
            trackerSnapshot(
              currentState,
              metric,
              today,
              currentState.settings.language,
              locale,
              t,
            ),
          ),
        };
        const payload = JSON.stringify({
          featured: snapshot.featured,
          catalog: snapshot.catalog,
          trackers: snapshot.trackers,
        });
        if (payload === lastPayloadRef.current) {
          initialSnapshotPublishedRef.current = true;
          return;
        }
        const updated = await updateHomeScreenWidgets(snapshot).catch(() => false);
        if (updated) {
          lastPayloadRef.current = payload;
          initialSnapshotPublishedRef.current = true;
        }
        })();
      });
    }, 1_200);
    return () => {
      clearTimeout(timer);
      interactionTask?.cancel();
    };
  }, [
    hydrated,
    locale,
    state.currentUserId,
    state.energyProfiles,
    state.entries,
    state.metrics,
    state.settings,
    state.trackedGoalPeriods,
    t,
  ]);

  return null;
}
