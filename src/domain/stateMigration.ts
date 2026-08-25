import { AppState, MetricDefinition } from "@/src/types";
import { reconcileImportedHealthEntries } from "@/src/domain/health";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";
import { consolidateWorkoutTrackers } from "@/src/domain/workoutTrackers";
import { repairLegacyScreenTimeEntries } from "@/src/domain/screenTime";
import {
  navigationDefaultsForVersion,
  normalizeTabOrder,
} from "@/src/domain/navigation";
import { upgradeNutritionStateV26 } from "@/src/domain/nutritionMigration";
import {
  DEFAULT_LIVE_STEP_SOURCES,
  normalizeLiveStepSources,
  LIVE_STEP_STRATEGY_VERSION,
} from "@/src/domain/healthDedup";
import { normalizeTodoItems } from "@/src/domain/todos";
import { DEFAULT_WORKOUT_QUALIFICATION } from "@/src/domain/workoutQualification";

const WORKOUT_CALORIES_METRIC_ID = "workout_calories";

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
        workoutQualification:
          metric.workoutQualification ?? preset.workoutQualification,
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
      ? ["workout_duration", "workout_distance"]
      : []),
    ...(filtered.some((metric) => metric.id === "deficit")
      ? ["energy_burned"]
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

function repairKnownMetricDefaults(
  metric: MetricDefinition,
  enableTodoToday = false,
) {
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
      sections: enableTodoToday
        ? { ...metric.sections, today: true }
        : metric.sections,
    };
  if (metric.id === "workout")
    return {
      ...metric,
      aggregation: "sum" as const,
      workoutQualification:
        metric.workoutQualification ?? DEFAULT_WORKOUT_QUALIFICATION,
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

function repairedMetricList(
  metrics: MetricDefinition[],
  enableTodoToday = false,
) {
  return pruneOrphanedInternalMetrics(
    metrics,
  ).map((metric) => repairKnownMetricDefaults(metric, enableTodoToday));
}

function isWorkoutCaloriesEntryId(entryId: string) {
  return (
    entryId.endsWith(`:${WORKOUT_CALORIES_METRIC_ID}`) ||
    entryId.includes(`:${WORKOUT_CALORIES_METRIC_ID}:`)
  );
}

function restoreWorkoutCaloriesMetricList(
  metrics: MetricDefinition[] | undefined,
  defaults: AppState,
) {
  if (
    !metrics ||
    !metrics.some((metric) => metric.id === "workout") ||
    metrics.some((metric) => metric.id === WORKOUT_CALORIES_METRIC_ID)
  )
    return metrics;
  const preset = defaults.metrics.find(
    (metric) => metric.id === WORKOUT_CALORIES_METRIC_ID,
  );
  if (!preset) return metrics;
  const activeFrom =
    metrics.find((metric) => metric.id === "workout_duration")?.activeFrom ??
    metrics.find((metric) => metric.id === "workout")?.activeFrom ??
    preset.activeFrom;
  return [...metrics, { ...preset, activeFrom }];
}

/**
 * Builds that retired Workout calories also wrote deletion tombstones for its
 * native and gym rows. Clear only those generated tombstones so the next
 * health read can restore the source sessions; user-deleted rows for every
 * other tracker remain untouched.
 */
function restoreWorkoutCalories(state: AppState, defaults: AppState): AppState {
  if (state.settings.workoutCaloriesRestored === true)
    return state;
  const shouldRestorePersonalMetric =
    !state.metrics.some(
      (metric) => metric.id === WORKOUT_CALORIES_METRIC_ID,
    ) && state.metrics.some((metric) => metric.id === "workout");
  const keep = (entryId: string) => !isWorkoutCaloriesEntryId(entryId);
  const groups = shouldRestorePersonalMetric
    ? state.groups.map((group) => ({
        ...group,
        metricConfiguration: restoreWorkoutCaloriesMetricList(
          group.metricConfiguration,
          defaults,
        ),
      }))
    : state.groups;
  const group = shouldRestorePersonalMetric
    ? {
        ...state.group,
        metricConfiguration: restoreWorkoutCaloriesMetricList(
          state.group.metricConfiguration,
          defaults,
        ),
      }
    : state.group;
  return {
    ...state,
    metrics:
      restoreWorkoutCaloriesMetricList(state.metrics, defaults) ??
      state.metrics,
    group,
    groups: groups.map((candidate) =>
      candidate.id === group.id ? group : candidate,
    ),
    settings: {
      ...state.settings,
      workoutCaloriesRestored: true,
      pendingDeletedEntryIds:
        shouldRestorePersonalMetric
          ? state.settings.pendingDeletedEntryIds?.filter(keep)
          : state.settings.pendingDeletedEntryIds,
      deletedEntryIds: shouldRestorePersonalMetric
        ? state.settings.deletedEntryIds?.filter(keep)
        : state.settings.deletedEntryIds,
      dismissedHealthEntryIds:
        shouldRestorePersonalMetric
          ? state.settings.dismissedHealthEntryIds?.filter(keep)
          : state.settings.dismissedHealthEntryIds,
      googleHealthEntryOverrides: shouldRestorePersonalMetric
        ? Object.fromEntries(
            Object.entries(
              state.settings.googleHealthEntryOverrides ?? {},
            ).filter(([entryId]) => keep(entryId)),
          )
        : state.settings.googleHealthEntryOverrides,
    },
  };
}

function repairEnergyFormula(state: AppState): AppState {
  const direction = state.settings.weightDirection ?? "lose";
  return {
    ...state,
    metrics: state.metrics.map((metric) =>
      metric.id === "deficit"
        ? {
            ...metric,
            formula:
              direction === "lose"
                ? "energy_burned - food"
                : "food - energy_burned",
          }
        : metric,
    ),
  };
}

function repairOrphanedGroupMetrics(state: AppState): AppState {
  const enableTodoToday = state.settings.todoTodayDefaultApplied !== true;
  const personalMetrics = repairedMetricList(state.metrics, enableTodoToday);
  const trackedIds = new Set(
    Object.entries(state.trackedGoalPeriods ?? {})
      .filter(([, periods]) => periods.some((period) => !period.to))
      .map(([metricId]) => metricId),
  );
  const personalSetupMetrics = personalMetrics
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
  const normalizedLiveStepSources = normalizeLiveStepSources(
    state.settings.healthSync.liveStepSources,
  );
  const migrateLiveStepStrategy =
    (state.settings.healthSync.liveStepStrategyVersion ?? 0) <
      LIVE_STEP_STRATEGY_VERSION &&
    normalizedLiveStepSources.length === 1 &&
    normalizedLiveStepSources[0] === "android_device";
  const liveStepCombination = migrateLiveStepStrategy
    ? "priority"
    : state.settings.healthSync.liveStepCombination === "priority" ||
        state.settings.healthSync.liveStepCombination === "sum"
      ? state.settings.healthSync.liveStepCombination
      : "highest";
  const repairedSettings: AppState["settings"] = {
    ...state.settings,
    healthSync: {
      ...state.settings.healthSync,
      dataTypes: {
        ...state.settings.healthSync.dataTypes,
        total_energy:
          state.settings.healthSync.dataTypes.total_energy ?? true,
      },
      liveStepSources: migrateLiveStepStrategy
        ? [...DEFAULT_LIVE_STEP_SOURCES]
        : normalizedLiveStepSources.length
          ? normalizedLiveStepSources
          : [...DEFAULT_LIVE_STEP_SOURCES],
      liveStepCombination,
      liveStepStrategyVersion: LIVE_STEP_STRATEGY_VERSION,
    },
    language: state.settings.language ?? "en",
    scheduleStartHour: state.settings.scheduleStartHour ?? 7,
    timeFormat: state.settings.timeFormat ?? "24h",
    showGym: state.settings.showGym !== false,
    showCalendar: state.settings.showCalendar !== false,
    showJournal: state.settings.showJournal !== false,
    showPerformance: state.settings.showPerformance !== false,
    showStatus: state.settings.showStatus !== false,
    healthHistoryDays: state.settings.healthHistoryDays ?? 90,
    todayHistoryCollapsed: state.settings.todayHistoryCollapsed ?? true,
    showFeaturedTodoProgress:
      state.settings.showFeaturedTodoProgress ?? false,
    todoTodayDefaultApplied: true,
    tabOrder: normalizeTabOrder(state.settings.tabOrder),
  };
  return {
    ...state,
    metrics: personalMetrics,
    settings: repairedSettings,
    group,
    groups: groups.map((item) => (item.id === group.id ? group : item)),
  };
}

function upgradeNavigationDefaults(
  state: AppState,
  sourceVersion: number,
): AppState {
  return {
    ...state,
    version: 27,
    settings: {
      ...state.settings,
      ...navigationDefaultsForVersion(state.settings, sourceVersion),
    },
  };
}

/** One-time local/cloud snapshot repair for the unified activity model. */
export function upgradeStateV21(
  state: AppState,
  defaults: AppState,
  sourceVersion = Number(state.version ?? 1),
): AppState {
  // This alias repair is intentionally version-independent. An offline older
  // device can upload a v25-shaped snapshot that still contains the retired
  // gym summary ids, and it must converge on the same canonical trackers.
  state = consolidateWorkoutTrackers(state, defaults);
  state = restoreWorkoutCalories(state, defaults);
  state = repairEnergyFormula(state);
  state = { ...state, todos: normalizeTodoItems(state.todos ?? []) };
  state = upgradeNutritionStateV26(state, defaults, sourceVersion);
  const screenTimeEntries = repairLegacyScreenTimeEntries(state.entries);
  if (screenTimeEntries !== state.entries)
    state = { ...state, entries: screenTimeEntries };
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
    const navigationRepaired = upgradeNavigationDefaults(
      repaired,
      sourceVersion,
    );
    return sourceVersion >= 24
      ? navigationRepaired
      : {
          ...navigationRepaired,
          entries: reconcileImportedHealthEntries(
            navigationRepaired.entries,
            navigationRepaired.metrics,
            navigationRepaired.settings.healthSync.sourcePreferences,
            navigationRepaired.currentUserId,
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
    version: 27,
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
  const navigationRepaired = upgradeNavigationDefaults(repaired, sourceVersion);
  return {
    ...navigationRepaired,
    entries: reconcileImportedHealthEntries(
      navigationRepaired.entries,
      navigationRepaired.metrics,
      navigationRepaired.settings.healthSync.sourcePreferences,
      navigationRepaired.currentUserId,
    ),
  };
}
