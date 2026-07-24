import { AppState, MetricDefinition } from "@/src/types";

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
        stepFallback: metric.stepFallback ?? preset.stepFallback,
        category: metric.category ?? preset.category,
        manualEntry: metric.manualEntry ?? preset.manualEntry,
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

/** One-time local/cloud snapshot repair for the unified activity model. */
export function upgradeStateV21(
  state: AppState,
  defaults: AppState,
  sourceVersion = Number(state.version ?? 1),
): AppState {
  if (sourceVersion >= 21) return state;
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
  return {
    ...state,
    version: 21,
    metrics,
    groups: groups.map((item) => (item.id === group.id ? group : item)),
    group,
    settings: {
      ...state.settings,
      fontScale: 1.12,
      showAllTodayTiles: true,
    },
  };
}
