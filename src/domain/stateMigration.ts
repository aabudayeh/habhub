import { AppState, MetricDefinition } from "@/src/types";
import { reconcileImportedHealthEntries } from "@/src/domain/health";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";

function upgradeMetric(
  metric: MetricDefinition,
  defaults: AppState,
): MetricDefinition {
  const preset = defaults.metrics.find((item) => item.id === metric.id);
  const next = preset
    ? {
        ...metric,
        healthMapping: metric.healthMapping ?? preset.healthMapping,
        gymMapping: metric.gymMapping ?? preset.gymMapping,
        gymMuscleGroups:
          metric.gymMuscleGroups ?? preset.gymMuscleGroups,
        stepFallback: metric.stepFallback ?? preset.stepFallback,
        category: metric.category ?? preset.category,
        manualEntry: metric.manualEntry ?? preset.manualEntry,
        timerEnabled: metric.timerEnabled ?? preset.timerEnabled,
        submetrics:
          metric.id === "blood_pressure_systolic" &&
          !metric.submetrics?.length
            ? preset.submetrics
            : (metric.submetrics ?? preset.submetrics),
        submetricDisplay: metric.submetricDisplay ?? preset.submetricDisplay,
        goalProgressMode:
          metric.goalProgressMode ?? preset.goalProgressMode,
      }
    : metric;
  return next.id === "blood_pressure_systolic"
    ? { ...next, name: "Blood pressure" }
    : next;
}

function upgradeMetricList(
  metrics: MetricDefinition[],
  defaults: AppState,
) {
  const filtered = metrics.map((metric) => upgradeMetric(metric, defaults));
  const companionIds = [
    ...(filtered.some((metric) => metric.id === "workout")
      ? ["workout_duration", "workout_calories", "workout_distance"]
      : []),
    ...(filtered.some((metric) => metric.id === "blood_pressure_systolic")
      ? ["blood_pressure_diastolic"]
      : []),
  ];
  if (!companionIds.length) return filtered;
  return [
    ...filtered,
    ...defaults.metrics
      .filter(
        (metric) =>
          companionIds.includes(metric.id) &&
          !filtered.some((existing) => existing.id === metric.id),
      )
      .map((metric, index) => ({
        ...metric,
        order: filtered.length + index,
        activeFrom: new Date().toISOString().slice(0, 10),
      })),
  ];
}

function pruneOrphanedInternalMetrics(metrics: MetricDefinition[]) {
  return metrics.some(isBloodPressureSystolic)
    ? metrics
    : metrics.filter((metric) => !isBloodPressureDiastolic(metric));
}

function repairKnownMetricDefaults(metric: MetricDefinition) {
  if (metric.id === "todo_completion")
    return {
      ...metric,
      name: "To-Dos",
      dataType: "number" as const,
      aggregation: "latest" as const,
      manualEntry: false,
      formula: undefined,
      goalEnabled: true,
      goal: { kind: "at_least" as const, target: 100 },
    };
  if (
    ["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"].includes(
      metric.id,
    )
  )
    return {
      ...metric,
      goalEnabled: metric.goalEnabled ?? false,
      goalProgressMode: metric.goalProgressMode ?? "journey",
    };
  if (metric.id === "screen_time")
    return {
      ...metric,
      // Preserve automatic Android imports while offering a functional iOS
      // fallback until the Apple Family Controls entitlement is provisioned.
      manualEntry: true,
    };
  if (
    ["exercise", "workout_duration", "workout_distance"].includes(metric.id)
  )
    return {
      ...metric,
      stepFallback: true,
      ...(metric.id === "workout_duration"
        ? { timerEnabled: metric.timerEnabled ?? true }
        : {}),
    };
  return metric;
}

function repairedMetricList(metrics: MetricDefinition[]) {
  return pruneOrphanedInternalMetrics(metrics).map(repairKnownMetricDefaults);
}

function repairOrphanedGroupMetrics(state: AppState): AppState {
  const trackedIds = new Set(
    Object.entries(state.trackedGoalPeriods ?? {})
      .filter(([, periods]) => periods.some((period) => !period.to))
      .map(([metricId]) => metricId),
  );
  const personalSetupMetrics = repairedMetricList(state.metrics)
    .filter((metric) => trackedIds.has(metric.id))
    .map((metric, order) => ({
      ...metric,
      sections: { ...metric.sections, group: true },
      order,
    }));
  const repairGroup = (group: AppState["group"]) => ({
    ...group,
    metricConfiguration: isPersonalSetupGroup(group)
      ? personalSetupMetrics
      : group.metricConfiguration
        ? repairedMetricList(group.metricConfiguration)
        : group.metricConfiguration,
  });
  const groups = state.groups.map(repairGroup);
  const group = repairGroup(state.group);
  const repairedSettings: AppState["settings"] = {
    ...state.settings,
    language: state.settings.language ?? "en",
    scheduleStartHour: state.settings.scheduleStartHour ?? 7,
    timeFormat: state.settings.timeFormat ?? "24h",
    showGym: state.settings.showGym !== false,
    showCalendar: state.settings.showCalendar !== false,
    showJournal: state.settings.showJournal !== false,
    showPerformance: state.settings.showPerformance !== false,
    healthHistoryDays: state.settings.healthHistoryDays ?? 90,
    todayHistoryCollapsed: state.settings.todayHistoryCollapsed ?? true,
    tabOrder: state.settings.tabOrder?.includes("performance")
      ? state.settings.tabOrder
      : [...(state.settings.tabOrder ?? []), "performance"],
  };
  return {
    ...state,
    metrics: repairedMetricList(state.metrics),
    settings: repairedSettings,
    group,
    groups: groups.map((item) => (item.id === group.id ? group : item)),
  };
}

/** One-time local/cloud snapshot repair for the unified activity model. */
export function upgradeStateV21(
  state: AppState,
  defaults: AppState,
  sourceVersion = Number(state.version ?? 1),
): AppState {
  // Preset-backed repairs are deliberately idempotent. Earlier v23 builds
  // could persist the BP parent without its compound SYS/DIA definition, so
  // version alone is not proof that the repair is present.
  if (sourceVersion >= 23) {
    const metrics = upgradeMetricList(state.metrics, defaults);
    const groups = state.groups.map((group) => ({
      ...group,
      metricConfiguration: group.metricConfiguration
        ? upgradeMetricList(group.metricConfiguration, defaults)
        : group.metricConfiguration,
    }));
    const group = {
      ...state.group,
      metricConfiguration: state.group.metricConfiguration
        ? upgradeMetricList(state.group.metricConfiguration, defaults)
        : state.group.metricConfiguration,
    };
    const repaired = repairOrphanedGroupMetrics({
      ...state,
      metrics,
      groups: groups.map((item) => (item.id === group.id ? group : item)),
      group,
    });
    return sourceVersion >= 24
      ? repaired
      : {
          ...repaired,
          version: 24,
          entries: reconcileImportedHealthEntries(
            repaired.entries,
            repaired.metrics,
            repaired.settings.healthSync.sourcePreferences,
            repaired.currentUserId,
          ),
        };
  }
  const metrics = upgradeMetricList(state.metrics, defaults);
  const withTodo =
    sourceVersion < 22 &&
    !metrics.some((metric) => metric.id === "todo_completion")
      ? [
          ...metrics,
          {
            ...defaults.metrics.find(
              (metric) => metric.id === "todo_completion",
            )!,
            order: metrics.length,
          },
        ]
      : metrics;
  const groups = state.groups.map((group) => ({
    ...group,
    metricConfiguration: group.metricConfiguration
      ? upgradeMetricList(group.metricConfiguration, defaults)
      : group.metricConfiguration,
  }));
  const group = {
    ...state.group,
    metricConfiguration: state.group.metricConfiguration
      ? upgradeMetricList(state.group.metricConfiguration, defaults)
      : state.group.metricConfiguration,
  };
  const repaired = repairOrphanedGroupMetrics({
    ...state,
    version: 24,
    metrics: withTodo,
    groups: groups.map((item) => (item.id === group.id ? group : item)),
    group,
    settings: {
      ...state.settings,
      ...(sourceVersion < 22
        ? { fontScale: 1.12, showAllTodayTiles: true }
        : {}),
    },
  });
  return {
    ...repaired,
    entries: reconcileImportedHealthEntries(
      repaired.entries,
      repaired.metrics,
      repaired.settings.healthSync.sourcePreferences,
      repaired.currentUserId,
    ),
  };
}
