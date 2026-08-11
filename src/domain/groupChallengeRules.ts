export const CHALLENGE_CARD_PREFIX = "challenge:";

type ChallengeMetricShape = {
  dataType: string;
  sections: { group: boolean };
};

type ChallengeRankingDirection = "higher" | "lower" | "closest";
type ChallengeWinnerRow = {
  member: { id: string };
  mode: "exact" | "private" | "missing";
  value: number;
  complete: boolean;
};

export function challengeValueOutcome(
  value: number,
  target: number,
  direction: ChallengeRankingDirection,
) {
  const safeTarget = Math.max(target, 0.0001);
  if (direction === "lower") {
    const complete = value <= target;
    return {
      complete,
      progress: complete
        ? 1
        : Math.max(0, Math.min(1, safeTarget / Math.max(value, 0.0001))),
    };
  }
  if (direction === "closest") {
    const distance = Math.abs(value - target);
    const complete = distance <= Math.max(safeTarget * 0.01, 0.0001);
    return {
      complete,
      progress: complete
        ? 1
        : Math.max(0, Math.min(1, 1 - distance / safeTarget)),
    };
  }
  const complete = value >= target;
  return {
    complete,
    progress: complete
      ? 1
      : Math.max(0, Math.min(1, value / safeTarget)),
  };
}

export function compareChallengeValues(
  left: number,
  right: number,
  target: number,
  direction: ChallengeRankingDirection,
) {
  if (direction === "lower") return left - right;
  if (direction === "closest")
    return Math.abs(left - target) - Math.abs(right - target);
  return right - left;
}

/** Privacy-conservative first-place resolution for completed challenges. */
export function challengeWinnerIds(
  rows: readonly ChallengeWinnerRow[],
  target: number,
  direction: ChallengeRankingDirection,
) {
  if (rows.some((row) => row.mode === "private")) return [];
  const exact = rows.filter((row) => row.mode === "exact");
  if (exact.length < 2) return [];
  const completed = exact.filter((row) => row.complete);
  if (!completed.length) return [];
  const best = [...completed].sort((left, right) =>
    compareChallengeValues(left.value, right.value, target, direction),
  )[0];
  if (!best) return [];
  return completed
    .filter(
      (row) =>
        compareChallengeValues(row.value, best.value, target, direction) === 0,
    )
    .map((row) => row.member.id);
}

export function challengeCardId(id: string) {
  return `${CHALLENGE_CARD_PREFIX}${id}`;
}

export function challengeIdFromCard(cardId: string) {
  return cardId.startsWith(CHALLENGE_CARD_PREFIX)
    ? cardId.slice(CHALLENGE_CARD_PREFIX.length)
    : undefined;
}

export function isChallengeMetric(metric: ChallengeMetricShape) {
  return (
    (metric.dataType === "number" || metric.dataType === "calculated") &&
    metric.sections.group
  );
}

export function validChallengeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateGroupChallenge(input: {
  title?: string;
  target: number;
  localDate: string;
  metric?: ChallengeMetricShape;
  participantIds: string[];
  creatorId: string;
}) {
  if (!input.metric || !isChallengeMetric(input.metric))
    return "Choose a numerical group tracker.";
  if (!Number.isFinite(input.target) || input.target <= 0 || input.target > 1e12)
    return "Enter a target greater than zero.";
  if (!validChallengeDate(input.localDate)) return "Choose a valid date.";
  if ((input.title?.trim().length ?? 0) > 80)
    return "Keep the challenge title under 80 characters.";
  const participants = new Set([...input.participantIds, input.creatorId]);
  if (participants.size < 2) return "Choose at least one friend.";
  return undefined;
}

export function mergedLeaderboardCardOrder(
  saved: string[] | undefined,
  metricIds: string[],
  challenges: { id: string }[],
) {
  const available = new Set([
    ...challenges.map((challenge) => challengeCardId(challenge.id)),
    ...metricIds,
  ]);
  const ordered = (saved ?? []).filter((id) => available.has(id));
  for (const id of available) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}
