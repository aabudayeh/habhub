import { formatMetricValue } from "@/src/domain/metrics";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { statusForDay } from "@/src/domain/dataIndex";
import {
  acceptedChallengeParticipantIds,
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
  groupChallengeOccurrenceId,
  groupChallengeEndDate,
  challengePeriodDates,
  groupChallengeSourceId,
} from "@/src/domain/groupChallengeRules";
import { scheduleAppliesOnDate } from "@/src/domain/schedule";
import { periodMetricResult } from "@/src/domain/leaderboard";
import {
  AppState,
  GroupChallenge,
  Member,
  MetricDefinition,
} from "@/src/types";
export {
  type ChallengeDurationPreset,
  acceptedChallengeParticipantIds,
  challengeCardId,
  challengeIdFromCard,
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
  declinedChallengeParticipantIds,
  challengePeriodDates,
  groupChallengeEndDate,
  groupChallengeOccurrenceId,
  groupChallengeResponseDeadline,
  groupChallengeParticipation,
  groupChallengeSourceId,
  isChallengeMetric,
  mergedLeaderboardCardOrder,
  validChallengeDate,
  validChallengePeriod,
  validChallengeRecurrence,
  challengePresetEndDate,
  challengeReminderIntervalDays,
  validateGroupChallenge,
} from "@/src/domain/groupChallengeRules";

/**
 * Recurrence remains one private/RLS-safe cloud row. Screens derive bounded
 * dated occurrences locally, so an invitation response applies to the series
 * without multiplying realtime subscriptions or writes.
 */
export function expandGroupChallengeOccurrences(
  challenges: readonly GroupChallenge[],
  fromDate: string,
  throughDate: string,
  limit = 200,
) {
  if (fromDate > throughDate) return [];
  const expanded: GroupChallenge[] = [];
  for (const challenge of challenges) {
    if (!challenge.recurrence || challenge.recurrence.mode === "once") {
      if (
        challenge.localDate <= throughDate &&
        groupChallengeEndDate(challenge) >= fromDate
      )
        expanded.push(challenge);
      continue;
    }
    const first = challenge.localDate > fromDate ? challenge.localDate : fromDate;
    const last = challenge.recurrence.endDate && challenge.recurrence.endDate < throughDate
      ? challenge.recurrence.endDate
      : throughDate;
    for (
      let date = first, guard = 0;
      date <= last && guard <= 366;
      date = dateWithOffsetFrom(date, 1), guard += 1
    ) {
      if (
        !scheduleAppliesOnDate(
          challenge.recurrence,
          challenge.localDate,
          date,
        )
      )
        continue;
      expanded.push(
        date === challenge.localDate
          ? challenge
          : {
              ...challenge,
              id: groupChallengeOccurrenceId(challenge.id, date),
              sourceChallengeId: groupChallengeSourceId(challenge),
              localDate: date,
              endDate: date,
            },
      );
    }
  }
  return expanded
    .sort(
      (left, right) =>
        right.localDate.localeCompare(left.localDate) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function canManageGroupChallenge(
  challenge: GroupChallenge,
  currentUserId: string,
  currentMember?: Member,
) {
  return (
    challenge.creatorId === currentUserId ||
    currentMember?.role === "owner" ||
    currentMember?.role === "admin"
  );
}

export type ChallengeMemberProgress = {
  member: Member;
  mode: "exact" | "private" | "missing";
  value: number;
  progress: number;
  complete: boolean;
  valueLabel: string;
};

export type ResolvedChallengeWin = {
  challengeId: string;
  localDate: string;
  winnerIds: string[];
};

/**
 * A custom challenge target may only use an exact value the viewer is already
 * allowed to read. Status-only rows never reveal or infer the private value.
 */
export function groupChallengeProgress(
  state: AppState,
  challenge: GroupChallenge,
  metric: MetricDefinition,
): ChallengeMemberProgress[] {
  const invited = new Set(acceptedChallengeParticipantIds(challenge));
  const dates = challengePeriodDates(
    challenge.localDate,
    groupChallengeEndDate(challenge),
  );
  const target = challenge.target;
  const rows = state.group.members
    .filter((member) => invited.has(member.id))
    .map((member): ChallengeMemberProgress => {
      const result = periodMetricResult(
        state,
        metric,
        member.id,
        state.currentUserId,
        dates,
      );
      const hasStatusOnlyPeriodData =
        member.id !== state.currentUserId &&
        dates.some((date) => {
          const status = statusForDay(
            state.dailyMetricStatuses,
            state.group.id,
            metric.id,
            member.id,
            date,
          );
          return (
            status?.hasData === true && status.visibility !== "group"
          );
        });
      if (hasStatusOnlyPeriodData)
        return {
          member,
          mode: "private",
          value: 0,
          progress: 0,
          complete: false,
          valueLabel: "Exact value not shared",
        };
      if (result.mode === "exact" && result.visibleDays > 0) {
        const value = result.total;
        const outcome = target === undefined
          ? { progress: 0, complete: false }
          : challengeValueOutcome(value, target, metric.rankingDirection);
        return {
          member,
          mode: "exact",
          value,
          progress: outcome.progress,
          complete: outcome.complete,
          valueLabel: formatMetricValue(metric, value),
        };
      }
      const privateValue =
        member.id !== state.currentUserId &&
        result.label !== "No data";
      return {
        member,
        mode: privateValue ? "private" : "missing",
        value: 0,
        progress: 0,
        complete: false,
        valueLabel: privateValue ? "Exact value not shared" : "No data yet",
      };
    });
  if (target === undefined) {
    const exact = rows.filter((row) => row.mode === "exact");
    const best = Math.max(0, ...exact.map((row) => row.value));
    const final = groupChallengeEndDate(challenge) < dateKey();
    for (const row of exact) {
      row.progress = best > 0 ? Math.max(0, row.value / best) : 0;
      row.complete = final && row.value === best;
    }
  }
  return rows.sort((left, right) => {
      if (left.mode !== right.mode) return left.mode === "exact" ? -1 : 1;
      if (left.mode !== "exact") return 0;
      return compareChallengeValues(
        left.value,
        right.value,
        target ?? 0,
        target === undefined ? "higher" : metric.rankingDirection,
      );
    });
}

/**
 * Finalized, viewer-authorized outcomes only. Challenges dated today or later
 * remain live, and duplicate realtime rows cannot inflate a member's count.
 */
export function resolvedGroupChallengeWins(
  state: AppState,
  challenges: readonly GroupChallenge[],
  throughDate: string,
  today: string,
): ResolvedChallengeWin[] {
  const seen = new Set<string>();
  const resolved: ResolvedChallengeWin[] = [];
  const earliest = challenges
    .map((challenge) => challenge.localDate)
    .sort()[0];
  const occurrences = earliest
    ? expandGroupChallengeOccurrences(challenges, earliest, throughDate, 5_000)
    : [];
  for (const challenge of occurrences) {
    if (
      seen.has(challenge.id) ||
      challenge.groupId !== state.group.id ||
      groupChallengeEndDate(challenge) > throughDate ||
      groupChallengeEndDate(challenge) >= today
    )
      continue;
    seen.add(challenge.id);
    const metric = (state.group.metricConfiguration ?? state.metrics).find(
      (candidate) => candidate.id === challenge.metricId,
    );
    if (!metric) continue;
    const rows = groupChallengeProgress(state, challenge, metric);
    if (
      rows.length !== new Set(acceptedChallengeParticipantIds(challenge)).size
    )
      continue;
    const winnerIds = challengeWinnerIds(
      rows,
      challenge.target,
      challenge.target === undefined ? "higher" : metric.rankingDirection,
    );
    if (winnerIds.length)
      resolved.push({
        challengeId: challenge.id,
        localDate: challenge.localDate,
        winnerIds: [...new Set(winnerIds)],
      });
  }
  return resolved.sort(
    (left, right) =>
      right.localDate.localeCompare(left.localDate) ||
      left.challengeId.localeCompare(right.challengeId),
  );
}
