import {
  calendarWeekRange,
  dateKey,
  dateWithOffsetFrom,
  monthDateRange,
  yearDateRange,
} from "@/src/domain/date";
import {
  metricPeriodStats,
  metricStreakStats,
} from "@/src/domain/metrics";
import { AppState, MetricDefinition } from "@/src/types";

export type PerformanceRange = "day" | "week" | "month" | "year";

export type PerformancePeriod = {
  range: PerformanceRange;
  currentDates: string[];
  previousDates: string[];
  currentLabel: string;
  previousLabel: string;
  /** The current range includes today and is not yet a fair completed period. */
  inProgress?: boolean;
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
  /** A negative comparison is withheld until today's partial range closes. */
  provisional: boolean;
};

function compactPeriodLabel(dates: string[], locale = "en-US") {
  if (!dates.length) return "";
  const first = new Date(`${dates[0]}T12:00:00`);
  const last = new Date(`${dates[dates.length - 1]}T12:00:00`);
  if (dates.length === 1)
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(first);
  const firstLabel = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(first);
  const lastLabel = new Intl.DateTimeFormat(locale, {
    month: first.getMonth() === last.getMonth() ? undefined : "short",
    day: "numeric",
  }).format(last);
  return `${firstLabel}–${lastLabel}`;
}

export function inclusiveDateRange(start: string, end: string) {
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates: string[] = [];
  for (
    let value = first;
    value <= last && dates.length < 3660;
    value = dateWithOffsetFrom(value, 1)
  )
    dates.push(value);
  return dates;
}

export function customPerformancePeriod(
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string,
  locale = "en-US",
): PerformancePeriod {
  const currentDates = inclusiveDateRange(currentStart, currentEnd);
  const previousDates = inclusiveDateRange(previousStart, previousEnd);
  return {
    range:
      currentDates.length <= 1
        ? "day"
        : currentDates.length <= 7
          ? "week"
          : currentDates.length <= 62
            ? "month"
            : "year",
    currentDates,
    previousDates,
    currentLabel: compactPeriodLabel(currentDates, locale),
    previousLabel: compactPeriodLabel(previousDates, locale),
    inProgress: currentDates.includes(dateKey()),
  };
}

export function overallPerformancePeriod(
  state: AppState,
  current: PerformancePeriod,
): PerformancePeriod {
  const firstCurrent = current.currentDates[0] ?? dateKey();
  const candidates = [
    ...state.entries
      .filter((entry) => entry.userId === state.currentUserId)
      .map((entry) => entry.localDate),
    ...(state.gymSessions ?? [])
      .filter((session) => session.userId === state.currentUserId)
      .map((session) => session.localDate),
    ...(state.todos ?? []).map((todo) => todo.createdAt.slice(0, 10)),
  ].filter((date) => date < firstCurrent);
  const first = candidates.sort()[0];
  const previousDates = first
    ? inclusiveDateRange(first, dateWithOffsetFrom(firstCurrent, -1))
    : current.previousDates;
  return {
    ...current,
    previousDates,
    previousLabel: first ? "Overall average" : current.previousLabel,
  };
}

export function performancePeriod(
  range: PerformanceRange,
  throughDate = dateKey(),
  weekStartsOn: 0 | 1 | 6 = 1,
  locale = "en-US",
): PerformancePeriod {
  if (range === "day") {
    const current =
      throughDate >= dateKey()
        ? dateWithOffsetFrom(dateKey(), -1)
        : throughDate;
    const previous = dateWithOffsetFrom(current, -1);
    return {
      range,
      currentDates: [current],
      previousDates: [previous],
      currentLabel: current === dateWithOffsetFrom(dateKey(), -1)
        ? "Yesterday"
        : compactPeriodLabel([current], locale),
      previousLabel: compactPeriodLabel([previous], locale),
      inProgress: false,
    };
  }
  if (range === "week") {
    let currentDates = calendarWeekRange(throughDate, weekStartsOn);
    if (currentDates.at(-1)! >= dateKey())
      currentDates = calendarWeekRange(
        dateWithOffsetFrom(currentDates[0], -7),
        weekStartsOn,
      );
    const previousDates = calendarWeekRange(
      dateWithOffsetFrom(currentDates[0], -7),
      weekStartsOn,
    );
    return {
      range,
      currentDates,
      previousDates,
      currentLabel: compactPeriodLabel(currentDates, locale),
      previousLabel: compactPeriodLabel(previousDates, locale),
      inProgress: false,
    };
  }
  if (range === "year") {
    const selectedYear = Number(throughDate.slice(0, 4));
    const currentYear =
      selectedYear >= Number(dateKey().slice(0, 4))
        ? selectedYear - 1
        : selectedYear;
    const currentAnchor = `${currentYear}-01-01`;
    const previousAnchor = `${currentYear - 1}-01-01`;
    return {
      range,
      currentDates: yearDateRange(currentAnchor),
      previousDates: yearDateRange(previousAnchor),
      currentLabel: String(currentYear),
      previousLabel: String(currentYear - 1),
      inProgress: false,
    };
  }
  let monthAnchor = new Date(`${throughDate}T12:00:00`);
  monthAnchor.setDate(1);
  if (throughDate.slice(0, 7) >= dateKey().slice(0, 7))
    monthAnchor.setMonth(monthAnchor.getMonth() - 1);
  const currentDates = monthDateRange(dateKey(monthAnchor));
  const anchor = new Date(`${throughDate}T12:00:00`);
  anchor.setTime(monthAnchor.getTime());
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
    currentLabel: new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(monthAnchor),
    previousLabel: new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(anchor),
    inProgress: false,
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
  const provisionalDrop = Boolean(period.inProgress && scoreDelta < 0);
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
    changePercent: provisionalDrop ? 0 : normalizedDelta,
    direction: !currentStats.loggedDates.length
      ? "missing"
      : !hasPrevious
      ? "new"
      : provisionalDrop
        ? "steady"
      : Math.abs(scoreDelta) < steadyThreshold
        ? "steady"
        : scoreDelta > 0
          ? "up"
          : "down",
    improving:
      currentStats.loggedDates.length > 0 &&
      (!hasPrevious || scoreDelta >= 0 || provisionalDrop),
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
    provisional: provisionalDrop,
  };
}

export function performanceOverview(
  state: AppState,
  rangeOrDays: PerformanceRange | 7 | 30 = "week",
  metricIds?: string[],
  throughDate = dateKey(),
  periodOverride?: PerformancePeriod,
) {
  const range: PerformanceRange =
    typeof rangeOrDays === "number"
      ? rangeOrDays === 7
        ? "week"
        : "month"
      : rangeOrDays;
  const period =
    periodOverride ??
    performancePeriod(
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
