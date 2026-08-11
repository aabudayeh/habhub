import { useEffect, useRef } from "react";
import { Image, InteractionManager } from "react-native";

import { dateKey } from "@/src/domain/date";
import {
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  hasMetricData,
  isMetricTrackedOnDate,
  safeMetricValue,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import { localizeMetricName, localizeMetricUnit } from "@/src/i18n/domain";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import {
  ALL_GOALS_COMPLETE_COLOR,
  GOAL_COMPLETE_COLOR,
} from "@/src/domain/colors";
import { completionIndicatorFillMode } from "@/src/domain/completionIndicators";
import {
  statusBodyAppearance,
  statusBodyCompositionForSource,
} from "@/src/domain/statusAvatar";
import { statusAvatarAtlasBlend } from "@/src/domain/statusAvatarAtlas";
import {
  statusAvatarProgression,
  statusRangeRollup,
} from "@/src/domain/status";
import { STATUS_AVATAR_SPRITES } from "@/src/generated/statusAvatarSprites";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { AppState, MetricDefinition } from "@/src/types";
import {
  areHomeScreenWidgetsSupported,
  getHomeScreenWidgetConfigurations,
  updateHomeScreenWidgets,
  WidgetSnapshot,
  WidgetAvatarSnapshot,
  WidgetTrackerSnapshot,
} from "@/src/widgets";

function trackerSnapshot(
  state: AppState,
  metric: MetricDefinition,
  today: string,
  language: AppState["settings"]["language"],
  locale: string,
  t: (source: string) => string,
  backgroundColor: string,
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
  const progress = available
    ? displayGoalProgress(metric, value, target)
    : 0;
  const remaining = Math.max(0, target - value);
  return {
    id: metric.id,
    eyebrow: localizedMetric.name,
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
    backgroundColor,
    progressColor: GOAL_COMPLETE_COLOR,
    deepLink: `paceboard://metric-detail?metric=${encodeURIComponent(metric.id)}&date=${today}`,
  };
}

function featuredSnapshot(
  state: AppState,
  today: string,
  language: AppState["settings"]["language"],
  locale: string,
  t: (source: string) => string,
  backgroundColor: string,
  completedBackgroundColor: string,
): WidgetTrackerSnapshot {
  const tracked = state.metrics.filter(
    (metric) =>
      metric.goalEnabled !== false &&
      metric.dataType !== "text" &&
      isMetricTrackedOnDate(state, metric, today),
  );
  const metToday = tracked.filter(
    (metric) =>
      hasMetricData(state, metric, state.currentUserId, today) &&
      scheduledGoalReached(state, metric, state.currentUserId, today),
  ).length;
  const allComplete = tracked.length > 0 && metToday === tracked.length;
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
      met:
        available &&
        scheduledGoalReached(state, metric, state.currentUserId, today),
    };
  });
  return {
    id: "__featured__",
    eyebrow: t(allComplete ? "DAY COMPLETE" : "TODAY'S FOCUS"),
    title: "HabHub",
    value: `${metToday} ${t("of")} ${tracked.length}`,
    subtitle: allComplete
      ? t("Every goal reached")
      : tracked.length
        ? `${tracked.length - metToday} ${t("remaining")}`
        : t("Choose your first goal"),
    progress: tracked.length ? metToday / tracked.length : 0,
    color: allComplete ? ALL_GOALS_COMPLETE_COLOR : GOAL_COMPLETE_COLOR,
    backgroundColor: allComplete ? completedBackgroundColor : backgroundColor,
    progressColor: allComplete
      ? ALL_GOALS_COMPLETE_COLOR
      : GOAL_COMPLETE_COLOR,
    allComplete,
    fillMode: completionIndicatorFillMode(
      state.settings.completionIndicatorIcon,
      state.settings.completionIndicatorFillMode ?? "auto",
    ),
    deepLink: "paceboard://",
    goals: goalRows,
  };
}

function avatarSnapshot(
  state: AppState,
  today: string,
  locale: string,
  t: (source: string) => string,
  backgroundColor: string,
  completedBackgroundColor: string,
): WidgetAvatarSnapshot {
  const profile =
    state.energyProfiles?.[state.currentUserId] ?? state.settings.energyProfile;
  const progression = statusAvatarProgression(
    state,
    state.currentUserId,
    today,
  );
  const summary = statusRangeRollup(state, state.currentUserId, [today]);
  const progress = Math.max(0, Math.min(1, summary.progress));
  const allComplete =
    summary.opportunities > 0 && summary.completed === summary.opportunities;
  const calculationSource =
    state.settings.statusAvatarCalculationSource ?? "bmi";
  const appearance = statusBodyAppearance(
    profile.heightCm,
    progression.currentWeightKg,
    progression.muscleProgress,
    statusBodyCompositionForSource(calculationSource, {
      bodyFatPercent: progression.currentBodyFatPercent,
      leanBodyMassKg: progression.currentLeanBodyMassKg,
      sex: profile.sex,
    }),
  );
  const blend = statusAvatarAtlasBlend(
    profile.sex,
    appearance.adiposity,
    appearance.muscleProgress,
  );
  const selected = blend.samples[0];
  const sprite = STATUS_AVATAR_SPRITES[blend.variant][selected.row][
    selected.column
  ];
  const resolved = Image.resolveAssetSource(sprite);
  const number = (value: number) =>
    Number(value.toFixed(1)).toLocaleString(locale);
  const bodyCompositionLabel =
    typeof progression.currentBodyFatPercent === "number"
      ? `${t("Body fat")} ${number(progression.currentBodyFatPercent)}%`
      : typeof progression.currentLeanBodyMassKg === "number"
        ? `${t("Lean body mass")} ${number(progression.currentLeanBodyMassKg)} kg`
        : undefined;

  return {
    id: "__avatar__",
    eyebrow: t("Status"),
    title: t("Status"),
    value: `${Math.round(progress * 100)}%`,
    subtitle: t("Tracked goals"),
    progress,
    color: allComplete ? ALL_GOALS_COMPLETE_COLOR : GOAL_COMPLETE_COLOR,
    backgroundColor: allComplete ? completedBackgroundColor : backgroundColor,
    progressColor: allComplete
      ? ALL_GOALS_COMPLETE_COLOR
      : GOAL_COMPLETE_COLOR,
    allComplete,
    fillMode: "bottom_up",
    deepLink: "paceboard://status",
    avatarUri: resolved?.uri,
    avatarStyle: state.settings.statusAvatarStyle ?? "silhouette",
    heightScale: appearance.heightScale,
    weightLabel: `${t("Weight")} ${number(progression.currentWeightKg)} kg`,
    bodyCompositionLabel,
  };
}

/** Keeps Android widgets current without blocking navigation or app startup. */
export function WidgetSnapshotBridge() {
  const { state, hydrated } = useApp();
  const { locale, t } = useLocalization();
  const accent = useGroupAccent();
  const colors = useAppColors();
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
            .filter((id) => id !== "__featured__" && id !== "__avatar__"),
        );
        const needsAvatar =
          initial ||
          configurations.some(
            (configuration) => configuration.trackerId === "__avatar__",
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
            accent,
            colors.isDark ? "#806018" : "#B98212",
          ),
          avatar: needsAvatar
            ? avatarSnapshot(
                currentState,
                today,
                locale,
                t,
                accent,
                colors.isDark ? "#806018" : "#B98212",
              )
            : undefined,
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
              accent,
            ),
          ),
        };
        const payload = JSON.stringify({
          featured: snapshot.featured,
          avatar: snapshot.avatar,
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
    accent,
    colors.isDark,
    hydrated,
    locale,
    state.currentUserId,
    state.energyProfiles,
    state.entries,
    state.gymSessions,
    state.metrics,
    state.settings,
    state.trackedGoalPeriods,
    t,
  ]);

  return null;
}
