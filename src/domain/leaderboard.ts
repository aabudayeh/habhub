import { dateKey, dateKeyWithOffset, dateRangeEnding, monthDateRange } from '@/src/domain/date';
import { dailyScore, effectiveGoalTarget, formatMetricValue, goalProgress, goalReached, sharedMetricResult } from '@/src/domain/metrics';
import { AppState, Member, MetricDefinition } from '@/src/types';

export type LeaderboardPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export function periodDates(period: LeaderboardPeriod, anchorDate = dateKey()): string[] {
  if (period === 'today') return [dateKey()];
  if (period === 'yesterday') return [dateKeyWithOffset(-1)];
  if (period === 'week') return dateRangeEnding(anchorDate, 7);
  if (period === 'month') return monthDateRange(anchorDate).filter((date) => date <= anchorDate);
  return [anchorDate];
}

export function periodTitle(period: LeaderboardPeriod, anchorDate: string): string {
  if (period === 'today') return 'Today';
  if (period === 'yesterday') return 'Yesterday';
  if (period === 'week') return 'Last 7 days';
  if (period === 'month') return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    .format(new Date(`${anchorDate}T12:00:00`));
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${anchorDate}T12:00:00`));
}

export type PeriodMetricResult = {
  mode: 'exact' | 'status' | 'private';
  total: number;
  average: number;
  completedDays: number;
  visibleDays: number;
  label: string;
  averageLabel?: string;
};

export function periodMetricResult(
  state: AppState,
  metric: MetricDefinition,
  subjectUserId: string,
  viewerUserId: string,
  dates: string[],
): PeriodMetricResult {
  const results = dates
    .filter((date) => metric.activeFrom <= date)
    .map((date) => ({ date, result: sharedMetricResult(state, metric, subjectUserId, viewerUserId, date) }));
  const exact = results.filter(({ result }) => result.mode === 'exact');
  const statuses = results.filter(({ result }) => result.mode === 'status');
  if (!exact.length && !statuses.length) {
    return { mode: 'private', total: 0, average: 0, completedDays: 0, visibleDays: 0, label: 'Private' };
  }
  const completedDays = results.filter(({ date, result }) =>
    result.mode === 'status'
      ? result.label === 'Goal met'
      : result.mode === 'exact' && goalReached(metric, result.value, effectiveGoalTarget(state, metric, subjectUserId, date)),
  ).length;
  if (!exact.length) {
    return {
      mode: 'status', total: 0, average: 0, completedDays, visibleDays: statuses.length,
      label: `${completedDays}/${results.length} goal days`,
      averageLabel: `${statuses.length}/${results.length} days shared as status`,
    };
  }
  const total = exact.reduce((sum, { result }) => sum + result.value, 0);
  const average = total / exact.length;
  if (metric.dataType === 'boolean') {
    const done = exact.filter(({ result }) => result.value > 0).length;
    return {
      mode: 'exact', total: done, average: exact.length ? done / exact.length : 0,
      completedDays: done, visibleDays: exact.length, label: `${done}/${results.length} days met`,
      averageLabel: `${Math.round((done / Math.max(results.length, 1)) * 100)}% of period`,
    };
  }
  const multipleDays = dates.length > 1;
  return {
    mode: 'exact', total, average, completedDays, visibleDays: exact.length,
    label: formatMetricValue(metric, multipleDays ? average : total),
    averageLabel: multipleDays
      ? `Daily average · ${completedDays}/${results.length} goal days · ${formatMetricValue(metric, total)} total`
      : undefined,
  };
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
      .filter(({ result }) => result.mode !== 'private')
      .map(({ metric, result }) => result.mode === 'status'
        ? result.completedDays / Math.max(result.visibleDays, 1)
        : goalProgress(metric, result.average));
    const configuredScore = dates.reduce((sum, date) => sum + dailyScore(state, member.id, date), 0) / Math.max(dates.length, 1);
    const score = includeScore
      ? configuredScore
      : (metricScores.reduce((sum, value) => sum + Math.min(value, 1), 0) / Math.max(metricScores.length, 1)) * 100;
    return { member, score, metrics: results };
  });
  if (!includeScore && metrics.length === 1) {
    const metric = metrics[0];
    return rows.sort((a, b) => {
      const left = a.metrics[0].result;
      const right = b.metrics[0].result;
      if (left.mode === 'private' && right.mode !== 'private') return 1;
      if (right.mode === 'private' && left.mode !== 'private') return -1;
      const leftValue = left.average;
      const rightValue = right.average;
      if (metric.rankingDirection === 'lower') return leftValue - rightValue;
      if (metric.rankingDirection === 'closest') {
        const leftTarget = dates.reduce((sum, day) => sum + effectiveGoalTarget(state, metric, a.member.id, day), 0) / Math.max(dates.length, 1);
        const rightTarget = dates.reduce((sum, day) => sum + effectiveGoalTarget(state, metric, b.member.id, day), 0) / Math.max(dates.length, 1);
        return Math.abs(left.average - leftTarget) - Math.abs(right.average - rightTarget);
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
  return periodMetricResult(state, metric, userId, viewerUserId, dateRangeEnding(anchorDate, days));
}
