import { safeMetricValue } from "@/src/domain/metrics";
import {
  AppState,
  MetricDefinition,
  MetricSubmetric,
} from "@/src/types";

export function submetricValue(
  state: AppState,
  metric: MetricDefinition,
  submetric: MetricSubmetric,
  userId: string,
  localDate: string,
) {
  const captured = state.entries
    .filter(
      (entry) =>
        entry.metricId === metric.id &&
        entry.userId === userId &&
        entry.localDate === localDate &&
        Number.isFinite(Number(entry.submetricValues?.[submetric.id])),
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]
    ?.submetricValues?.[submetric.id];
  if (Number.isFinite(Number(captured))) return Number(captured);

  if (submetric.linkedMetricId) {
    const linked = state.metrics.find(
      (candidate) => candidate.id === submetric.linkedMetricId,
    );
    if (linked) return safeMetricValue(state, linked, userId, localDate);
  }

  const sameHealthField =
    Boolean(metric.healthMapping) &&
    metric.healthMapping?.dataType === submetric.healthMapping?.dataType &&
    metric.healthMapping?.field === submetric.healthMapping?.field;
  if (
    sameHealthField ||
    submetric.id === metric.id ||
    submetric.id === "value" ||
    (submetric.id === "systolic" &&
      metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "systolic")
  )
    return safeMetricValue(state, metric, userId, localDate);

  return 0;
}

export function compoundMetricValues(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  return Object.fromEntries(
    (metric.submetrics ?? []).map((submetric) => [
      submetric.id,
      submetricValue(state, metric, submetric, userId, localDate),
    ]),
  );
}

export function formatCompoundMetricValue(
  metric: MetricDefinition,
  values: Record<string, number>,
) {
  const template = metric.submetricDisplay?.template;
  if (metric.submetricDisplay?.mode !== "merged" || !template) return null;
  return template.replace(
    /\{([a-zA-Z0-9_-]+)(\.unit)?\}/g,
    (_token, id: string, unitToken?: string) => {
      const submetric = metric.submetrics?.find((item) => item.id === id);
      if (unitToken) return submetric?.unit ?? "";
      const value = values[id];
      return Number.isFinite(value) && value > 0
        ? String(Math.round(value * 10) / 10)
        : "—";
    },
  );
}

export function submetricAsMetric(
  parent: MetricDefinition,
  submetric: MetricSubmetric,
): MetricDefinition {
  return {
    ...parent,
    id: `${parent.id}:${submetric.id}`,
    name: submetric.name,
    unit: submetric.unit,
    goalEnabled: submetric.goalEnabled,
    goal: submetric.goal,
    goalRange: submetric.goalRange,
    submetrics: undefined,
    submetricDisplay: undefined,
  };
}
