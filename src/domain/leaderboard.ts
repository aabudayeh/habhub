import {
  dateKey,
  dateKeyWithOffset,
  dateRangeEnding,
  monthDateRange,
} from "@/src/domain/date";
import {
  dailyScore,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  metricApplicableOnDate,
  sharedMetricResult,
} from "@/src/domain/metrics";
import { longestStreakWithRest } from "@/src/domain/streaks";
import { AppState, Member, MetricDefinition } from "@/src/types";

export type LeaderboardPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "custom";

export function periodDates(
  period: LeaderboardPeriod,
  anchorDate = dateKey(),
): string[] {
  if (period === "today") return [dateKey()];
  if (period === "yesterday") return [dateKeyWithOffset(-1)];
  if (period === "week") return dateRangeEnding(anchorDate, 7);
  if (period === "month")
    return monthDateRange(anchorDate).filter((date) => date <= anchorDate);
  return [anchorDate];
}

export function periodTitle(
  period: LeaderboardPeriod,
  anchorDate: string,
): string {
  if (period === "today") return "Today";
  if (period === "yesterday") return "Yesterday";
  if (period === "week") return "Last 7 days";
  if (period === "month")
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(new Date(`${anchorDate}T12:00:00`));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${anchorDate}T12:00:00`));
}

export type PeriodMetricResult = {
  mode: "exact" | "status" | "private";
  total: number;
  average: number;
  completedDays: number;
  visibleDays: number;
  label: string;
  averageLabel?: string;
  /** Normalized against this member's own private goal when available. */
  averageGoalProgress?: number;
  streak?: number;
  lastRecordedAt?: string;
};

function metGoalOnDate(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  date: string,
): boolean {
  const status = state.dailyMetricStatuses?.find(
    (item) =>
      item.groupId === state.group.id &&
      item.metricId === metric.id &&
      item.userId === userId &&
      item.localDate === date,
  );
  if (status) return status.goalReached;
  const goalMetric =
    userId === state.currentUserId
      ? (state.metrics.find((item) => item.id === metric.id) ?? metric)
      : metric;
  const result = sharedMetricResult(state, metric, userId, userId, date);
  if (result.mode === "status") return result.label === "Goal met";
  if (result.mode === "exact")
    return goalReached(
      goalMetric,
      result.value,
      effectiveGoalTarget(state, goalMetric, userId, date),
    );
  return false;
}

export function periodMetricResult(
  state: AppState,
  metric: MetricDefinition,
  subjectUserId: string,
  viewerUserId: string,
  dates: string[],
): PeriodMetricResult {
  const results = dates
    .filter((date) => metric.activeFrom <= date)
    .map((date) => ({
      date,
      result: sharedMetricResult(
        state,
        metric,
        subjectUserId,
        viewerUserId,
        date,
      ),
    }));
  const exact = results.filter(
    ({ date, result }) =>
      result.mode === "exact" &&
      hasPeriodData(state, metric, subjectUserId, date),
  );
  const statuses = results.filter(({ result }) => result.mode === "status");
  const goalMetric =
    subjectUserId === state.currentUserId
      ? (state.metrics.find((item) => item.id === metric.id) ?? metric)
      : metric;
  const statusForDate = (date: string) =>
    state.dailyMetricStatuses?.find(
      (status) =>
        status.groupId === state.group.id &&
        status.metricId === metric.id &&
        status.userId === subjectUserId &&
        status.localDate === date,
    );
  const progressValues = results.flatMap(({ date, result }) => {
    const status = statusForDate(date);
    if (status)
      return [Math.min(1, Math.max(0, status.scoreContribution / 100))];
    if (result.mode === "status")
      return [result.label === "Goal met" ? 1 : 0];
    if (result.mode !== "exact") return [];
    return [
      Math.min(
        1,
        goalProgress(
          goalMetric,
          result.value,
          effectiveGoalTarget(state, goalMetric, subjectUserId, date),
        ),
      ),
    ];
  });
  const averageGoalProgress = progressValues.length
    ? progressValues.reduce((sum, value) => sum + value, 0) /
      progressValues.length
    : undefined;
  if (!exact.length && !statuses.length) {
    return {
      mode: "private",
      total: 0,
      average: 0,
      completedDays: 0,
      visibleDays: 0,
      label: subjectUserId === viewerUserId ? "No data" : "Private",
    };
  }
  const completedDays = results.filter(({ date, result }) => {
    const status = statusForDate(date);
    if (status) return status.goalReached;
    return result.mode === "status"
      ? result.label === "Goal met"
      : result.mode === "exact" &&
        goalReached(
          goalMetric,
          result.value,
          effectiveGoalTarget(state, goalMetric, subjectUserId, date),
        );
  }).length;
  const streak = longestStreakWithRest(state, dates, (d) =>
    metGoalOnDate(state, metric, subjectUserId, d),
  );
  const matchingEntries = state.entries.filter(
    (entry) =>
      entry.userId === subjectUserId &&
      entry.metricId === metric.id &&
      results.some((r) => r.date === entry.localDate),
  );
  const latestEntry = matchingEntries.sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  )[0];
  const lastRecordedAt = latestEntry?.recordedAt;
  if (!exact.length) {
    return {
      mode: "status",
      total: 0,
      average: 0,
      completedDays,
      visibleDays: statuses.length,
      streak,
      lastRecordedAt,
      label: `${completedDays}/${results.length} goal days`,
      averageLabel: `${statuses.length}/${results.length} days shared as status`,
      averageGoalProgress,
    };
  }
  if (metric.id === "weight") {
    const ordered = [...exact].sort((a, b) => a.date.localeCompare(b.date));
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const previous = state.entries
      .filter(
        (entry) =>
          entry.userId === subjectUserId &&
          entry.metricId === metric.id &&
          entry.localDate < first.date &&
          (subjectUserId === viewerUserId || entry.visibility === "group"),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    const baseline = previous ? Number(previous.value) : first.result.value;
    const current = latest.result.value;
    const raw = current - baseline;
    const progress =
      metric.rankingDirection === "lower"
        ? -raw
        : metric.rankingDirection === "higher"
          ? raw
          : Math.abs(raw);
    return {
      mode: "exact",
      total: progress,
      average: progress,
      completedDays,
      visibleDays: ordered.length,
      streak,
      lastRecordedAt,
      averageGoalProgress,
      label: `${raw > 0 ? "+" : ""}${raw.toFixed(1)} ${metric.unit}`,
      averageLabel: `${baseline.toFixed(1)} → ${current.toFixed(1)} ${metric.unit}`,
    };
  }
  const total = exact.reduce((sum, { result }) => sum + result.value, 0);
  const average = total / exact.length;
  if (metric.dataType === "boolean") {
    const done = exact.filter(({ result }) => result.value > 0).length;
    return {
      mode: "exact",
      total: done,
      average: exact.length ? done / exact.length : 0,
      completedDays: done,
      visibleDays: exact.length,
      streak,
      lastRecordedAt,
      averageGoalProgress,
      label: `${done}/${results.length}`,
      averageLabel: `${Math.round((done / Math.max(results.length, 1)) * 100)}% of period`,
    };
  }
  const multipleDays = dates.length > 1;
  return {
    mode: "exact",
    total,
    average,
    completedDays,
    visibleDays: exact.length,
    streak,
    lastRecordedAt,
    averageGoalProgress,
    label: formatMetricValue(metric, multipleDays ? average : total),
    averageLabel: multipleDays
      ? `${completedDays}/${results.length} goal days · ${formatMetricValue(metric, total)} total`
      : undefined,
  };
}

function hasPeriodData(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  date: string,
) {
  if (metric.dataType === "boolean") return true;
  if (metric.dataType === "photo")
    return state.photos.some(
      (photo) => photo.userId === userId && photo.localDate === date,
    );
  if (metric.dataType === "calculated") {
    return metricApplicableOnDate(state, metric, userId, date);
  }
  return state.entries.some(
    (entry) =>
      entry.userId === userId &&
      entry.metricId === metric.id &&
      entry.localDate === date,
  );
}

export type LeaderboardRow = {
  member: Member;
  score: number;
  metrics: { metric: MetricDefinition; result: PeriodMetricResult }[];
};

export function leaderboardRows(
  state: AppState,
  metrics: MetricDefinition[],
  dates: string[],
  viewerUserId: string,
  includeScore: boolean,
): LeaderboardRow[] {
  const rows = state.group.members.map((member) => {
    const results = metrics.map((metric) => ({
      metric,
      result: periodMetricResult(state, metric, member.id, viewerUserId, dates),
    }));
    const metricScores = results
      .filter(({ result }) => result.mode !== "private")
      .map(({ metric, result }) =>
        result.mode === "status"
          ? result.completedDays / Math.max(result.visibleDays, 1)
          : (result.averageGoalProgress ??
            goalProgress(metric, result.average)),
      );
    const configuredScore =
      dates.reduce((sum, date) => sum + dailyScore(state, member.id, date), 0) /
      Math.max(dates.length, 1);
    const score = includeScore
      ? configuredScore
      : (metricScores.reduce((sum, value) => sum + Math.min(value, 1), 0) /
          Math.max(metricScores.length, 1)) *
        100;
    return { member, score, metrics: results };
  });
  if (!includeScore && metrics.length === 1) {
    const metric = metrics[0];
    return rows.sort((a, b) => {
      const left = a.metrics[0].result;
      const right = b.metrics[0].result;
      if (left.mode === "private" && right.mode !== "private") return 1;
      if (right.mode === "private" && left.mode !== "private") return -1;
      const leftValue = left.average;
      const rightValue = right.average;
      if (metric.id === "weight") return rightValue - leftValue;
      if (metric.rankingDirection === "lower") return leftValue - rightValue;
      if (metric.rankingDirection === "closest") {
        if (
          left.averageGoalProgress !== undefined ||
          right.averageGoalProgress !== undefined
        )
          return (
            (right.averageGoalProgress ?? 0) -
            (left.averageGoalProgress ?? 0)
          );
        const leftTarget =
          dates.reduce(
            (sum, day) =>
              sum + effectiveGoalTarget(state, metric, a.member.id, day),
            0,
          ) / Math.max(dates.length, 1);
        const rightTarget =
          dates.reduce(
            (sum, day) =>
              sum + effectiveGoalTarget(state, metric, b.member.id, day),
            0,
          ) / Math.max(dates.length, 1);
        return (
          Math.abs(left.average - leftTarget) -
          Math.abs(right.average - rightTarget)
        );
      }
      return rightValue - leftValue;
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

export function averageAtDate(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  viewerUserId: string,
  anchorDate: string,
  days: 7 | 30,
): PeriodMetricResult {
  return periodMetricResult(
    state,
    metric,
    userId,
    viewerUserId,
    dateRangeEnding(anchorDate, days),
  );
}
