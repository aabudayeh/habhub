import {
  dateKey,
  dateKeyWithOffset,
  dateRangeEnding,
  monthDateRange,
} from "@/src/domain/date";
import {
  dailyScore,
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  hasMetricData,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricPeriodStats,
  metricStreakStats,
  scheduledGoalReached,
  sharedMetricResult,
} from "@/src/domain/metrics";
import { currentStreakWithRest } from "@/src/domain/streaks";
import { AppState, GoalKind, Member, MetricDefinition } from "@/src/types";
import {
  entriesForDay,
  photosForDay,
  statusForDay,
} from "@/src/domain/dataIndex";

export type LeaderboardPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "overall"
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
  if (period === "overall") return dateRangeEnding(anchorDate, 730);
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
  if (period === "overall") return "All time";
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
  /** Average percent of the member's personal target reached/consumed. */
  averageDisplayProgress?: number;
  personalGoalKind?: GoalKind;
  streak?: number;
  lastRecordedAt?: string;
  lastSyncedAt?: string;
};

/** Whether the member's period average satisfies their own goal. */
export function periodAverageGoalReached(result: PeriodMetricResult): boolean {
  if (result.mode === "private" || result.visibleDays < 1) return false;
  const progress = result.averageDisplayProgress;
  if (progress === undefined) return false;
  switch (result.personalGoalKind) {
    case "at_most":
      return progress > 0 && progress <= 1;
    case "exact":
      return progress >= 0.95 && progress <= 1.05;
    case "complete":
      return result.completedDays >= result.visibleDays;
    default:
      return progress >= 1;
  }
}

function metGoalOnDate(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  date: string,
): boolean {
  const status =
    userId === state.currentUserId
      ? undefined
      : statusForDay(
          state.dailyMetricStatuses,
          state.group.id,
          metric.id,
          userId,
          date,
        );
  if (status) return sharedStatusGoalReached(status, metric);
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

function sharedStatusGoalReached(
  status: NonNullable<AppState["dailyMetricStatuses"]>[number],
  metric: MetricDefinition,
) {
  if (status.goalReached) return true;
  // Older/stale clients occasionally uploaded `goal_reached=false` while the
  // exact at-least progress was already complete. The normalized personal
  // progress lets every viewer recover the correct result without learning
  // the member's private target.
  const kind = status.goalKind ?? metric.goal.kind;
  if (kind === "at_least" && (status.goalProgress ?? 0) >= 100) return true;
  if (kind === "complete" && (status.exactValue ?? 0) > 0) return true;
  if (
    status.goalProgress === undefined &&
    status.exactValue !== undefined &&
    kind === "at_least"
  )
    return goalReached(metric, status.exactValue, metric.goal.target);
  return false;
}

export function periodMetricResult(
  state: AppState,
  metric: MetricDefinition,
  subjectUserId: string,
  viewerUserId: string,
  dates: string[],
): PeriodMetricResult {
  const goalMetric =
    subjectUserId === state.currentUserId
      ? (state.metrics.find((item) => item.id === metric.id) ?? metric)
      : metric;
  const results = dates
    .filter(
      (date) =>
        metricApplicableOnDate(state, goalMetric, subjectUserId, date),
    )
    .map((date) => ({
      date,
      // Backfilled measurements remain comparable before a goal started, but
      // those dates must not retroactively count as goal days.
      goalEligible:
        subjectUserId === state.currentUserId
          ? isMetricTrackedOnDate(state, goalMetric, date)
          : (statusForDay(
              state.dailyMetricStatuses,
              state.group.id,
              metric.id,
              subjectUserId,
              date,
            )?.goalEligible ?? goalMetric.activeFrom <= date),
      result: sharedMetricResult(
        state,
        goalMetric,
        subjectUserId,
        viewerUserId,
        date,
      ),
    }));
  const exact = results.filter(
    ({ date, result }) =>
      result.mode === "exact" &&
      hasPeriodData(state, goalMetric, subjectUserId, date),
  );
  const statuses = results.filter(({ result }) => result.mode === "status");
  const goalResults = results.filter(({ goalEligible }) => goalEligible);
  const statusForDate = (date: string) =>
    subjectUserId === state.currentUserId
      ? undefined
      : statusForDay(
          state.dailyMetricStatuses,
          state.group.id,
          metric.id,
          subjectUserId,
          date,
        );
  const progressValues = goalResults.flatMap(({ date, result }) => {
    const status = statusForDate(date);
    if (status)
      return [Math.min(1, Math.max(0, status.scoreContribution / 100))];
    if (result.mode === "status")
      return [result.label === "Goal met" ? 1 : 0];
    if (
      result.mode !== "exact" ||
      !hasPeriodData(state, goalMetric, subjectUserId, date)
    )
      return [];
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
  const displayProgressValues = goalResults.flatMap(({ date, result }) => {
    const status = statusForDate(date);
    if (status?.goalProgress !== undefined)
      return [Math.max(0, Math.min(3, status.goalProgress / 100))];
    if (
      result.mode !== "exact" ||
      !hasPeriodData(state, goalMetric, subjectUserId, date)
    )
      return [];
    return [
      displayGoalProgress(
        goalMetric,
        result.value,
        effectiveGoalTarget(state, goalMetric, subjectUserId, date),
      ),
    ];
  });
  const averageDisplayProgress = displayProgressValues.length
    ? displayProgressValues.reduce((sum, value) => sum + value, 0) /
      displayProgressValues.length
    : undefined;
  const personalGoalKind =
    goalResults
      .map(({ date }) => statusForDate(date)?.goalKind)
      .find((kind): kind is GoalKind => Boolean(kind)) ?? goalMetric.goal.kind;
  if (!exact.length && !statuses.length) {
    const hasUnsharedData = results.some(({ date }) =>
      hasPeriodData(state, goalMetric, subjectUserId, date),
    );
    return {
      mode: "private",
      total: 0,
      average: 0,
      completedDays: 0,
      visibleDays: 0,
      label:
        subjectUserId === viewerUserId || !hasUnsharedData
          ? "No data"
          : "Private",
    };
  }
  const completedDays = goalResults.filter(({ date, result }) => {
    if (subjectUserId === state.currentUserId)
      return (
        result.mode === "exact" &&
        hasPeriodData(state, goalMetric, subjectUserId, date) &&
        scheduledGoalReached(
          state,
          goalMetric,
          subjectUserId,
          date,
        )
      );
    const status = statusForDate(date);
    if (status) return sharedStatusGoalReached(status, goalMetric);
    return result.mode === "status"
      ? result.label === "Goal met"
      : result.mode === "exact" &&
        hasPeriodData(state, goalMetric, subjectUserId, date) &&
        goalReached(
          goalMetric,
          result.value,
          effectiveGoalTarget(state, goalMetric, subjectUserId, date),
        );
  }).length;
  // Keep the signed-in member's goal-day count identical to Progress. Shared
  // daily status remains authoritative for every other group member.
  const resolvedCompletedDays =
    subjectUserId === state.currentUserId
      ? metricPeriodStats(
          state,
          goalMetric,
          subjectUserId,
          dates,
        ).goalsReached
      : completedDays;
  const streak =
    subjectUserId === state.currentUserId
      ? metricStreakStats(
          state,
          goalMetric,
          subjectUserId,
          dateKey(),
        ).current
      : currentStreakWithRest(
          state,
          dateRangeEnding(dateKey(), 90),
          (date) => metGoalOnDate(state, metric, subjectUserId, date),
        );
  const matchingEntries = results.flatMap(({ date }) =>
    entriesForDay(state.entries, metric.id, subjectUserId, date),
  );
  const latestEntry = matchingEntries.sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  )[0];
  const lastRecordedAt = latestEntry?.recordedAt;
  const lastSyncedAt = results
    .map(({ date }) => statusForDate(date)?.syncedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];
  if (!exact.length) {
    return {
      mode: "status",
      total: 0,
      average: 0,
      completedDays: resolvedCompletedDays,
      visibleDays: statuses.length,
      streak,
      lastRecordedAt,
      lastSyncedAt,
      label: `${resolvedCompletedDays}/${goalResults.length} goal days`,
      averageLabel: `${statuses.length}/${results.length} days shared as status`,
      averageGoalProgress,
      averageDisplayProgress,
      personalGoalKind,
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
      completedDays: resolvedCompletedDays,
      visibleDays: ordered.length,
      streak,
      lastRecordedAt,
      lastSyncedAt,
      averageGoalProgress,
      averageDisplayProgress,
      personalGoalKind,
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
      completedDays: resolvedCompletedDays,
      visibleDays: exact.length,
      streak,
      lastRecordedAt,
      lastSyncedAt,
      averageGoalProgress,
      averageDisplayProgress,
      personalGoalKind,
      label: `${done}/${results.length}`,
      averageLabel: `${Math.round((done / Math.max(results.length, 1)) * 100)}% of period`,
    };
  }
  const multipleDays = dates.length > 1;
  return {
    mode: "exact",
    total,
    average,
    completedDays: resolvedCompletedDays,
    visibleDays: exact.length,
    streak,
    lastRecordedAt,
    lastSyncedAt,
    averageGoalProgress,
    averageDisplayProgress,
    personalGoalKind,
    label: formatMetricValue(metric, multipleDays ? average : total),
    averageLabel: multipleDays
      ? `${resolvedCompletedDays}/${results.length} goal days · ${formatMetricValue(metric, total)} total`
      : undefined,
  };
}

function hasPeriodData(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  date: string,
) {
  if (
    statusForDay(
      state.dailyMetricStatuses,
      state.group.id,
      metric.id,
      userId,
      date,
    )?.exactValue !== undefined
  )
    return true;
  if (metric.dataType === "boolean")
    return entriesForDay(state.entries, metric.id, userId, date).length > 0;
  if (metric.dataType === "photo")
    return photosForDay(state.photos, userId, date).length > 0;
  if (metric.gymMapping)
    return hasMetricData(state, metric, userId, date);
  if (metric.dataType === "calculated") {
    return metricApplicableOnDate(state, metric, userId, date);
  }
  return entriesForDay(state.entries, metric.id, userId, date).length > 0;
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
