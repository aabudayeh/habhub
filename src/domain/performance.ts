import {
  calendarWeekRange,
  dateKey,
  dateWithOffsetFrom,
  monthDateRange,
} from "@/src/domain/date";
import {
  metricPeriodStats,
  metricStreakStats,
} from "@/src/domain/metrics";
import { AppState, MetricDefinition } from "@/src/types";

export type PerformanceRange = "day" | "week" | "month";

export type PerformancePeriod = {
  range: PerformanceRange;
  currentDates: string[];
  previousDates: string[];
  currentLabel: string;
  previousLabel: string;
};

export type TrackerPerformance = {
  metric: MetricDefinition;
  current: number;
  previous: number;
  currentTotal: number;
  previousTotal: number;
  currentScore: number;
  previousScore: number;
  changePercent: number;
  direction: "up" | "down" | "steady" | "new" | "missing";
  improving: boolean;
  currentGoalRate: number;
  previousGoalRate: number;
  currentGoalDays: number;
  previousGoalDays: number;
  currentLoggedDays: number;
  previousLoggedDays: number;
  currentStreak: number;
  bestStreak: number;
  attentionScore: number;
};

function compactPeriodLabel(dates: string[]) {
  if (!dates.length) return "";
  const first = new Date(`${dates[0]}T12:00:00`);
  const last = new Date(`${dates[dates.length - 1]}T12:00:00`);
  if (dates.length === 1)
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(first);
  const firstLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(first);
  const lastLabel = new Intl.DateTimeFormat(undefined, {
    month: first.getMonth() === last.getMonth() ? undefined : "short",
    day: "numeric",
  }).format(last);
  return `${firstLabel}–${lastLabel}`;
}

export function performancePeriod(
  range: PerformanceRange,
  throughDate = dateKey(),
  weekStartsOn: 0 | 1 | 6 = 1,
): PerformancePeriod {
  if (range === "day") {
    const previous = dateWithOffsetFrom(throughDate, -1);
    return {
      range,
      currentDates: [throughDate],
      previousDates: [previous],
      currentLabel: "Today",
      previousLabel: "Yesterday",
    };
  }
  if (range === "week") {
    const currentDates = calendarWeekRange(throughDate, weekStartsOn).filter(
      (date) => date <= throughDate,
    );
    const previousAnchor = dateWithOffsetFrom(throughDate, -7);
    const previousDates = calendarWeekRange(
      previousAnchor,
      weekStartsOn,
    ).slice(0, currentDates.length);
    return {
      range,
      currentDates,
      previousDates,
      currentLabel: compactPeriodLabel(currentDates),
      previousLabel: compactPeriodLabel(previousDates),
    };
  }
  const currentDates = monthDateRange(throughDate).filter(
    (date) => date <= throughDate,
  );
  const anchor = new Date(`${throughDate}T12:00:00`);
  anchor.setDate(1);
  anchor.setMonth(anchor.getMonth() - 1);
  const previousMonthDates = monthDateRange(dateKey(anchor));
  const previousDates = previousMonthDates.slice(
    0,
    Math.min(currentDates.length, previousMonthDates.length),
  );
  return {
    range,
    currentDates,
    previousDates,
    currentLabel: new Intl.DateTimeFormat(undefined, {
      month: "long",
    }).format(new Date(`${throughDate}T12:00:00`)),
    previousLabel: new Intl.DateTimeFormat(undefined, {
      month: "long",
    }).format(anchor),
  };
}

function successScore(metric: MetricDefinition, value: number, target: number) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return 0;
  if (metric.goalEnabled === false) return 0;
  if (metric.goalRange) {
    if (value >= metric.goalRange.min && value <= metric.goalRange.max) return 1;
    const distance =
      value < metric.goalRange.min
        ? metric.goalRange.min - value
        : value - metric.goalRange.max;
    return Math.max(
      0,
      1 - distance / Math.max(1, metric.goalRange.max - metric.goalRange.min),
    );
  }
  if (metric.goal.kind === "at_most")
    return value <= target
      ? 1
      : Math.max(0, target / Math.max(1, Math.abs(value)));
  if (metric.goal.kind === "exact")
    return Math.max(
      0,
      1 - Math.abs(value - target) / Math.max(1, Math.abs(target)),
    );
  return target > 0 ? Math.min(1.5, value / target) : value > 0 ? 1 : 0;
}

function rawDirectionScore(
  metric: MetricDefinition,
  current: number,
  previous: number,
) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (metric.rankingDirection === "lower") return previous - current;
  if (metric.rankingDirection === "closest") {
    const target = metric.goal.target;
    return Math.abs(previous - target) - Math.abs(current - target);
  }
  return current - previous;
}

export function trackerPerformance(
  state: AppState,
  metric: MetricDefinition,
  periodOrDays: PerformancePeriod | 7 | 30,
  throughDate = dateKey(),
): TrackerPerformance {
  const period =
    typeof periodOrDays === "number"
      ? performancePeriod(
          periodOrDays === 7 ? "week" : "month",
          throughDate,
          state.settings.weekStartsOn ?? 1,
        )
      : periodOrDays;
  const currentStats = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    period.currentDates,
  );
  const previousStats = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    period.previousDates,
  );
  const currentScore = currentStats.loggedDates.length
    ? successScore(
        metric,
        currentStats.average,
        currentStats.averageTarget,
      )
    : 0;
  const previousScore = previousStats.loggedDates.length
    ? successScore(
        metric,
        previousStats.average,
        previousStats.averageTarget,
      )
    : 0;
  const goalAware = metric.goalEnabled !== false;
  const scoreDelta = goalAware
    ? currentScore - previousScore
    : rawDirectionScore(metric, currentStats.average, previousStats.average);
  const normalizedDelta = goalAware
    ? previousScore > 0
      ? (scoreDelta / previousScore) * 100
      : currentScore > 0
        ? 100
        : 0
    : (scoreDelta / Math.max(1, Math.abs(previousStats.average))) * 100;
  const currentGoalOpportunities = Math.max(
    currentStats.loggedDates.length,
    currentStats.goalsReached,
  );
  const previousGoalOpportunities = Math.max(
    previousStats.loggedDates.length,
    previousStats.goalsReached,
  );
  const streaks = metricStreakStats(
    state,
    metric,
    state.currentUserId,
    throughDate,
  );
  const hasPrevious = previousStats.loggedDates.length > 0;
  const steadyThreshold = goalAware
    ? 0.015
    : Math.max(0.01, Math.abs(previousStats.average) * 0.01);
  return {
    metric,
    current: currentStats.average,
    previous: previousStats.average,
    currentTotal: currentStats.total,
    previousTotal: previousStats.total,
    currentScore,
    previousScore,
    changePercent: normalizedDelta,
    direction: !currentStats.loggedDates.length
      ? "missing"
      : !hasPrevious
      ? "new"
      : Math.abs(scoreDelta) < steadyThreshold
        ? "steady"
        : scoreDelta > 0
          ? "up"
          : "down",
    improving:
      currentStats.loggedDates.length > 0 && (!hasPrevious || scoreDelta >= 0),
    currentGoalRate: currentGoalOpportunities
      ? currentStats.goalsReached / currentGoalOpportunities
      : 0,
    previousGoalRate: previousGoalOpportunities
      ? previousStats.goalsReached / previousGoalOpportunities
      : 0,
    currentGoalDays: currentStats.goalsReached,
    previousGoalDays: previousStats.goalsReached,
    currentLoggedDays: currentStats.loggedDates.length,
    previousLoggedDays: previousStats.loggedDates.length,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    attentionScore:
      (goalAware ? currentScore - 1 : 0) +
      Math.max(-1, Math.min(1, normalizedDelta / 100)),
  };
}

export function performanceOverview(
  state: AppState,
  rangeOrDays: PerformanceRange | 7 | 30 = "week",
  metricIds?: string[],
  throughDate = dateKey(),
) {
  const range: PerformanceRange =
    typeof rangeOrDays === "number"
      ? rangeOrDays === 7
        ? "week"
        : "month"
      : rangeOrDays;
  const period = performancePeriod(
    range,
    throughDate,
    state.settings.weekStartsOn ?? 1,
  );
  const selected =
    metricIds !== undefined
      ? new Set(metricIds)
      : state.settings.progressMetricIds.length
        ? new Set(state.settings.progressMetricIds)
        : undefined;
  const rows = state.metrics
    .filter(
      (metric) =>
        metric.dataType !== "text" &&
        metric.dataType !== "photo" &&
        metric.id !== "tracked_goals" &&
        (!selected || selected.has(metric.id)),
    )
    .map((metric) => trackerPerformance(state, metric, period));
  return {
    period,
    rows,
    strengths: [...rows]
      .filter((row) => row.currentLoggedDays > 0)
      .sort(
        (a, b) =>
          b.attentionScore - a.attentionScore ||
          b.currentGoalRate - a.currentGoalRate,
      )
      .slice(0, 3),
    opportunities: [...rows]
      .filter((row) => row.currentLoggedDays > 0)
      .sort(
        (a, b) =>
          a.attentionScore - b.attentionScore ||
          a.currentGoalRate - b.currentGoalRate,
      )
      .slice(0, 3),
  };
}
