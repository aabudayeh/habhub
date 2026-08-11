import {
  formatMetricValue,
  hasMetricData,
  sharedMetricResult,
} from "@/src/domain/metrics";
import { statusForDay } from "@/src/domain/dataIndex";
import {
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
} from "@/src/domain/groupChallengeRules";
import {
  AppState,
  GroupChallenge,
  Member,
  MetricDefinition,
} from "@/src/types";
export {
  challengeCardId,
  challengeIdFromCard,
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
  isChallengeMetric,
  mergedLeaderboardCardOrder,
  validChallengeDate,
  validateGroupChallenge,
} from "@/src/domain/groupChallengeRules";

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
  const invited = new Set(challenge.participantIds);
  return state.group.members
    .filter((member) => invited.has(member.id))
    .map((member): ChallengeMemberProgress => {
      const result = sharedMetricResult(
        state,
        metric,
        member.id,
        state.currentUserId,
        challenge.localDate,
      );
      const sharedStatus = statusForDay(
        state.dailyMetricStatuses,
        state.group.id,
        metric.id,
        member.id,
        challenge.localDate,
      );
      const hasData =
        hasMetricData(
          state,
          metric,
          member.id,
          challenge.localDate,
        ) ||
        sharedStatus?.exactValue !== undefined ||
        sharedStatus?.hasData === true;
      if (result.mode === "exact" && hasData) {
        const value = result.value;
        const outcome = challengeValueOutcome(
          value,
          challenge.target,
          metric.rankingDirection,
        );
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
        (result.mode === "private" || result.mode === "status");
      return {
        member,
        mode: privateValue ? "private" : "missing",
        value: 0,
        progress: 0,
        complete: false,
        valueLabel: privateValue ? "Exact value not shared" : "No data yet",
      };
    })
    .sort((left, right) => {
      if (left.mode !== right.mode) return left.mode === "exact" ? -1 : 1;
      if (left.mode !== "exact") return 0;
      return compareChallengeValues(
        left.value,
        right.value,
        challenge.target,
        metric.rankingDirection,
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
  for (const challenge of challenges) {
    if (
      seen.has(challenge.id) ||
      challenge.groupId !== state.group.id ||
      challenge.localDate > throughDate ||
      challenge.localDate >= today
    )
      continue;
    seen.add(challenge.id);
    const metric = (state.group.metricConfiguration ?? state.metrics).find(
      (candidate) => candidate.id === challenge.metricId,
    );
    if (!metric) continue;
    const rows = groupChallengeProgress(state, challenge, metric);
    if (rows.length !== new Set(challenge.participantIds).size) continue;
    const winnerIds = challengeWinnerIds(
      rows,
      challenge.target,
      metric.rankingDirection,
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
