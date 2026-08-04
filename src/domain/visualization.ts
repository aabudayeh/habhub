import {
  MetricChartStyle,
  HealthMetricMapping,
  GoalProgressMode,
  MetricVisualization,
} from "@/src/types";

type VisualizableMetric = {
  id: string;
  goalProgressMode?: GoalProgressMode;
  healthMapping?: HealthMetricMapping;
  visualization?: MetricVisualization;
};

function automaticVisualization(
  metric: VisualizableMetric,
): Required<MetricVisualization> {
  const isPressure =
    metric.id === "blood_pressure_systolic" ||
    metric.healthMapping?.dataType === "blood_pressure";
  const isJourney =
    metric.id === "weight" || metric.goalProgressMode === "journey";
  if (isPressure)
    return {
      detailDay: "completion",
      detailRange: "line",
      progressOverview: "bar",
      progressGrid: "completion",
    };
  if (isJourney)
    return {
      detailDay: "progress",
      detailRange: "line",
      progressOverview: "bar",
      progressGrid: "completion",
    };
  return {
    detailDay: "progress",
    detailRange: "bar",
    progressOverview: "bar",
    progressGrid: "intensity",
  };
}

export function metricVisualization(
  metric: VisualizableMetric,
): Required<MetricVisualization> {
  const defaults = automaticVisualization(metric);
  const configured = metric.visualization ?? {};
  const resolve = (value: MetricChartStyle | undefined, fallback: MetricChartStyle) =>
    !value || value === "auto" ? fallback : value;
  return {
    detailDay: configured.detailDay ?? defaults.detailDay,
    detailRange: resolve(
      configured.detailRange,
      defaults.detailRange,
    ),
    // Progress compares each calendar day with that day's effective target.
    // Keep this view consistent and inexpensive; line charts belong in detail.
    progressOverview: defaults.progressOverview,
    progressGrid: configured.progressGrid ?? defaults.progressGrid,
  };
}
