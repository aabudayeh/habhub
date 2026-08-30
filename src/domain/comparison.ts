import {
  effectiveGoalTarget,
  hasMetricData,
  sharedMetricResult,
} from '@/src/domain/metrics';
import { AppState, MetricDefinition } from '@/src/types';
import { statusForDay } from '@/src/domain/dataIndex';

export type HeadToHeadStats = {
  subjectBest: { value: number; date: string };
  opponentBest: { value: number; date: string };
  subjectWins: number;
  opponentWins: number;
  ties: number;
  subjectLongestStreak: number;
  opponentLongestStreak: number;
  eligibleDays: number;
};

export function supportsHeadToHead(metric: MetricDefinition): boolean {
  return metric.dataType === 'number';
}

export function metricHeadToHeadStats(
  state: AppState,
  metric: MetricDefinition,
  subjectId: string,
  opponentId: string,
  dates: string[],
  authorizationViewerId: string,
): HeadToHeadStats | undefined {
  if (!supportsHeadToHead(metric) || subjectId === opponentId) return undefined;
  let subjectBest = { value: 0, date: '' };
  let opponentBest = { value: 0, date: '' };
  let subjectBestScore = Number.NEGATIVE_INFINITY;
  let opponentBestScore = Number.NEGATIVE_INFINITY;
  let subjectWins = 0;
  let opponentWins = 0;
  let ties = 0;
  let subjectRun = 0;
  let opponentRun = 0;
  let subjectLongestStreak = 0;
  let opponentLongestStreak = 0;
  let eligibleDays = 0;

  for (const date of [...dates].sort()) {
    const hasComparableData = (userId: string) =>
      statusForDay(
        state.dailyMetricStatuses,
        state.group.id,
        metric.id,
        userId,
        date,
      )?.exactValue !== undefined || hasMetricData(state, metric, userId, date);
    if (!hasComparableData(subjectId) || !hasComparableData(opponentId))
      continue;
    // The two competitors do not define the privacy boundary. A comparison may
    // be Friend A versus Friend B, while the signed-in viewer is a third member.
    // Always resolve both values through that actual viewer's authorization.
    const subject = sharedMetricResult(
      state,
      metric,
      subjectId,
      authorizationViewerId,
      date,
    );
    const opponent = sharedMetricResult(
      state,
      metric,
      opponentId,
      authorizationViewerId,
      date,
    );
    if (subject.mode !== 'exact' || opponent.mode !== 'exact') continue;
    eligibleDays += 1;
    const authorizedGoalTarget = (userId: string) => {
      if (userId === authorizationViewerId)
        return effectiveGoalTarget(state, metric, userId, date);
      const sharedStatus = statusForDay(
        state.dailyMetricStatuses,
        state.group.id,
        metric.id,
        userId,
        date,
      );
      const sharedTarget =
        sharedStatus?.visibility === 'group'
          ? Number(sharedStatus.goalTarget)
          : Number.NaN;
      return Number.isFinite(sharedTarget) ? sharedTarget : metric.goal.target;
    };
    const competitionScore = (value: number, userId: string) =>
      metric.rankingDirection === "lower"
        ? -value
        : metric.rankingDirection === "closest"
          ? -Math.abs(value - authorizedGoalTarget(userId))
          : value;
    const subjectScore = competitionScore(subject.value, subjectId);
    const opponentScore = competitionScore(opponent.value, opponentId);
    if (subjectScore > subjectBestScore) {
      subjectBestScore = subjectScore;
      subjectBest = { value: subject.value, date };
    }
    if (opponentScore > opponentBestScore) {
      opponentBestScore = opponentScore;
      opponentBest = { value: opponent.value, date };
    }
    if (subjectScore > opponentScore) {
      subjectWins += 1;
      subjectRun += 1;
      opponentRun = 0;
      subjectLongestStreak = Math.max(subjectLongestStreak, subjectRun);
    } else if (opponentScore > subjectScore) {
      opponentWins += 1;
      opponentRun += 1;
      subjectRun = 0;
      opponentLongestStreak = Math.max(opponentLongestStreak, opponentRun);
    } else {
      ties += 1;
      subjectRun = 0;
      opponentRun = 0;
    }
  }
  if (!eligibleDays) return undefined;
  return {
    subjectBest,
    opponentBest,
    subjectWins,
    opponentWins,
    ties,
    subjectLongestStreak,
    opponentLongestStreak,
    eligibleDays,
  };
}
