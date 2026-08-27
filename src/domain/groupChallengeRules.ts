import type { GoalSchedule, GroupChallenge } from "@/src/types";

function challengeDateWithOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const CHALLENGE_CARD_PREFIX = "challenge:";

export type GroupChallengeParticipation =
  | "creator"
  | "accepted"
  | "invited"
  | "declined"
  | "not_invited";

export type GroupChallengeAvailability =
  | "upcoming"
  | "active"
  | "finished";

/** Old rows predate invitations and therefore remain accepted for compatibility. */
export function acceptedChallengeParticipantIds(challenge: GroupChallenge) {
  return [
    ...new Set(
      challenge.acceptedParticipantIds ?? challenge.participantIds,
    ),
  ].filter((id) => challenge.participantIds.includes(id));
}

export function declinedChallengeParticipantIds(challenge: GroupChallenge) {
  return [...new Set(challenge.declinedParticipantIds ?? [])].filter((id) =>
    challenge.participantIds.includes(id),
  );
}

export function groupChallengeParticipation(
  challenge: GroupChallenge,
  userId: string,
): GroupChallengeParticipation {
  if (challenge.creatorId === userId) return "creator";
  if (!challenge.participantIds.includes(userId)) return "not_invited";
  if (acceptedChallengeParticipantIds(challenge).includes(userId))
    return "accepted";
  if (declinedChallengeParticipantIds(challenge).includes(userId))
    return "declined";
  return "invited";
}

export function groupChallengeSourceId(challenge: GroupChallenge) {
  return challenge.sourceChallengeId ?? challenge.id;
}

export function groupChallengeOccurrenceId(id: string, localDate: string) {
  return `${id}@${localDate}`;
}

export function groupChallengeResponseDeadline(challenge: GroupChallenge) {
  return challenge.recurrence?.anchorDate ?? challenge.localDate;
}

/**
 * The final day on which a group member may opt into the persisted challenge.
 * Recurring challenges stay open for the series, while date-range challenges
 * use their inclusive scoring end. This stays independent from Leaderboard
 * occurrence expansion and pagination.
 */
export function groupChallengeJoinDeadline(challenge: GroupChallenge) {
  return challenge.recurrence?.endDate ?? groupChallengeEndDate(challenge);
}

export function groupChallengeAvailability(
  challenge: GroupChallenge,
  today: string,
): GroupChallengeAvailability {
  if (groupChallengeJoinDeadline(challenge) < today) return "finished";
  if (challenge.localDate > today) return "upcoming";
  return "active";
}

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
  target: number | undefined,
  direction: ChallengeRankingDirection,
) {
  if (rows.some((row) => row.mode === "private")) return [];
  const exact = rows.filter((row) => row.mode === "exact");
  if (exact.length < 2) return [];
  // An open challenge has no completion threshold: once the period closes,
  // every exact participant is eligible and the highest aggregate wins.
  const resolvedDirection = target === undefined ? "higher" : direction;
  const resolvedTarget = target ?? 0;
  const completed = target === undefined
    ? exact
    : exact.filter((row) => row.complete);
  if (!completed.length) return [];
  const best = [...completed].sort((left, right) =>
    compareChallengeValues(
      left.value,
      right.value,
      resolvedTarget,
      resolvedDirection,
    ),
  )[0];
  if (!best) return [];
  return completed
    .filter(
      (row) =>
        compareChallengeValues(
          row.value,
          best.value,
          resolvedTarget,
          resolvedDirection,
        ) === 0,
    )
    .map((row) => row.member.id);
}

/** Goal-relative bar for open competitions; ranking still uses raw values. */
export function openChallengeGoalProgress(
  displayProgress?: number,
  normalizedProgress?: number,
) {
  const progress = displayProgress ?? normalizedProgress ?? 0;
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
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

export function groupChallengeEndDate(challenge: GroupChallenge) {
  return challenge.endDate ?? challenge.localDate;
}

export function challengePeriodDates(
  localDate: string,
  endDate = localDate,
) {
  if (
    !validChallengeDate(localDate) ||
    !validChallengeDate(endDate) ||
    endDate < localDate
  )
    return [];
  const dates: string[] = [];
  for (
    let current = localDate, guard = 0;
    current <= endDate && guard <= 366;
    current = challengeDateWithOffset(current, 1), guard += 1
  )
    dates.push(current);
  return dates;
}

export type ChallengeDurationPreset =
  | "day"
  | "week"
  | "month"
  | "year"
  | "custom";

function clampedAnniversary(startDate: string, months: number) {
  const start = new Date(`${startDate}T12:00:00Z`);
  const first = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1, 12),
  );
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  first.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return {
    date: first.toISOString().slice(0, 10),
    clipped: start.getUTCDate() > lastDay,
  };
}

/** Inclusive preset range, e.g. Aug 22 through Aug 28 is one week. */
export function challengePresetEndDate(
  startDate: string,
  preset: Exclude<ChallengeDurationPreset, "custom">,
) {
  if (!validChallengeDate(startDate) || preset === "day") return startDate;
  if (preset === "week") return challengeDateWithOffset(startDate, 6);
  const anniversary = clampedAnniversary(
    startDate,
    preset === "month" ? 1 : 12,
  );
  // A clipped month-end (Jan 31 -> Feb 28, leap day -> Feb 28) remains the
  // inclusive end; otherwise end on the day before the next anniversary.
  return anniversary.clipped
    ? anniversary.date
    : challengeDateWithOffset(anniversary.date, -1);
}

export function validChallengePeriod(localDate: string, endDate?: string) {
  const resolvedEnd = endDate ?? localDate;
  if (!validChallengeDate(localDate) || !validChallengeDate(resolvedEnd))
    return false;
  const duration = Math.round(
    (new Date(`${resolvedEnd}T12:00:00Z`).getTime() -
      new Date(`${localDate}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  return duration >= 0 && duration <= 366;
}

/** Cadence for supportive standings notifications, scaled to duration. */
export function challengeReminderIntervalDays(
  localDate: string,
  endDate = localDate,
) {
  const duration = Math.max(1, challengePeriodDates(localDate, endDate).length);
  if (duration <= 7) return 1;
  if (duration <= 31) return 2;
  if (duration <= 92) return 7;
  return 14;
}

export function validChallengeRecurrence(
  recurrence: GoalSchedule | undefined,
  localDate: string,
) {
  if (!recurrence || recurrence.mode === "once") return true;
  if (
    ![
      "daily",
      "selected_days",
      "every_other_day",
      "interval_days",
      "days_of_month",
    ].includes(recurrence.mode)
  )
    return false;
  if (
    recurrence.anchorDate !== localDate ||
    !recurrence.endDate ||
    !validChallengeDate(recurrence.endDate) ||
    recurrence.endDate < localDate
  )
    return false;
  const durationDays = Math.round(
    (new Date(`${recurrence.endDate}T12:00:00Z`).getTime() -
      new Date(`${localDate}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  if (durationDays > 366) return false;
  if (recurrence.mode === "selected_days")
    return (
      (recurrence.daysOfWeek?.length ?? 0) > 0 &&
      recurrence.daysOfWeek!.every(
        (day, index, days) =>
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6 &&
          days.indexOf(day) === index,
      )
    );
  if (recurrence.mode === "days_of_month")
    return (
      (recurrence.daysOfMonth?.length ?? 0) > 0 &&
      recurrence.daysOfMonth!.every(
        (day, index, days) =>
          Number.isInteger(day) &&
          day >= 1 &&
          day <= 31 &&
          days.indexOf(day) === index,
      )
    );
  if (recurrence.mode === "interval_days")
    return (
      Number.isInteger(recurrence.intervalDays) &&
      (recurrence.intervalDays ?? 0) >= 2 &&
      (recurrence.intervalDays ?? 0) <= 31
    );
  return true;
}

export function validateGroupChallenge(input: {
  title?: string;
  target?: number;
  localDate: string;
  endDate?: string;
  metric?: ChallengeMetricShape;
  participantIds: string[];
  creatorId: string;
  audience?: "group" | "public";
  participantLimit?: number;
  recurrence?: GoalSchedule;
  today?: string;
}) {
  if (!input.metric || !isChallengeMetric(input.metric))
    return "Choose a numerical group tracker.";
  if (
    input.target !== undefined &&
    (!Number.isFinite(input.target) || input.target <= 0 || input.target > 1e12)
  )
    return "Enter a target greater than zero.";
  if (!validChallengeDate(input.localDate)) return "Choose a valid date.";
  if (!validChallengePeriod(input.localDate, input.endDate))
    return "Choose an end date within one year of the start date.";
  if (input.today && input.localDate < input.today)
    return "Choose today or a future date.";
  if (
    input.recurrence &&
    (input.endDate ?? input.localDate) !== input.localDate
  )
    return "Repeating challenges must use a one-day scoring period.";
  if (!validChallengeRecurrence(input.recurrence, input.localDate)) {
    if (input.recurrence?.mode === "selected_days")
      return "Choose at least one weekday to repeat on.";
    if (input.recurrence?.mode === "interval_days")
      return "Choose a repeat interval from 2 to 31 days.";
    if (input.recurrence?.mode === "days_of_month")
      return "Enter one or more month dates from 1 to 31.";
    return "Choose a repeat end date within one year.";
  }
  if ((input.title?.trim().length ?? 0) > 80)
    return "Keep the challenge title under 80 characters.";
  const participants = new Set([...input.participantIds, input.creatorId]);
  if (input.audience === "public") {
    if (
      input.participantLimit !== undefined &&
      (!Number.isInteger(input.participantLimit) ||
        input.participantLimit < 2 ||
        input.participantLimit > 5_000)
    )
      return "Enter a participant limit from 2 to 5,000, or leave it unlimited.";
    return undefined;
  }
  if (participants.size < 2) return "Choose at least one friend.";
  if (participants.size > 50) return "Choose no more than 49 friends.";
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
