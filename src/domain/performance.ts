import { dateKey, dateRangeEnding, dateWithOffsetFrom } from "@/src/domain/date";
import { metricPeriodStats } from "@/src/domain/metrics";
import { AppState, MetricDefinition } from "@/src/types";

export type TrackerPerformance = {
  metric: MetricDefinition;
  current: number;
  previous: number;
  currentScore: number;
  previousScore: number;
  changePercent: number;
  direction: "up" | "down" | "steady";
  improving: boolean;
  currentGoalRate: number;
};

function successScore(metric: MetricDefinition, value: number, target: number) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return 0;
  if (metric.goalRange) {
    if (value >= metric.goalRange.min && value <= metric.goalRange.max) return 1;
    const distance =
      value < metric.goalRange.min
        ? metric.goalRange.min - value
        : value - metric.goalRange.max;
    return Math.max(0, 1 - distance / Math.max(1, metric.goalRange.max));
  }
  if (metric.goal.kind === "at_most")
    return value <= target ? 1 + (target - value) / Math.max(1, target) : target / Math.max(1, value);
  if (metric.goal.kind === "exact")
    return Math.max(0, 1 - Math.abs(value - target) / Math.max(1, Math.abs(target)));
  return target > 0 ? value / target : value > 0 ? 1 : 0;
}

export function trackerPerformance(
  state: AppState,
  metric: MetricDefinition,
  days: 7 | 30,
  throughDate = dateKey(),
): TrackerPerformance {
  const currentDates = dateRangeEnding(throughDate, days);
  const previousDates = dateRangeEnding(dateWithOffsetFrom(throughDate, -days), days);
  const currentStats = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    currentDates,
  );
  const previousStats = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    previousDates,
  );
  const currentScore = successScore(
    metric,
    currentStats.average,
    currentStats.averageTarget,
  );
  const previousScore = successScore(
    metric,
    previousStats.average,
    previousStats.averageTarget,
  );
  const scoreDelta = currentScore - previousScore;
  const changePercent =
    previousScore > 0
      ? (scoreDelta / previousScore) * 100
      : currentScore > 0
        ? 100
        : 0;
  return {
    metric,
    current: currentStats.average,
    previous: previousStats.average,
    currentScore,
    previousScore,
    changePercent,
    direction:
      Math.abs(scoreDelta) < 0.015 ? "steady" : scoreDelta > 0 ? "up" : "down",
    improving: scoreDelta >= 0,
    currentGoalRate: currentStats.applicableDates.length
      ? currentStats.goalsReached / currentStats.applicableDates.length
      : 0,
  };
}

export function performanceOverview(
  state: AppState,
  days: 7 | 30 = 7,
) {
  const selected = state.settings.progressMetricIds.length
    ? new Set(state.settings.progressMetricIds)
    : undefined;
  const rows = state.metrics
    .filter(
      (metric) =>
        metric.dataType !== "text" &&
        metric.dataType !== "photo" &&
        (!selected || selected.has(metric.id)),
    )
    .map((metric) => trackerPerformance(state, metric, days))
    .filter(
      (row) =>
        Number.isFinite(row.current) &&
        (row.current !== 0 || row.previous !== 0),
    );
  return {
    rows,
    strengths: [...rows]
      .sort((a, b) => b.currentScore - a.currentScore)
      .slice(0, 3),
    opportunities: [...rows]
      .sort((a, b) => a.currentScore - b.currentScore)
      .slice(0, 3),
  };
}
