import type {
  GroupSocialComment,
  GroupSocialReaction,
  GroupSocialReactionKind,
} from "../cloud/groupSocial";

export type GroupSocialSummary = {
  groupId: string;
  targetType: GroupSocialReaction["targetType"];
  targetId: string;
  reactionCounts: Record<GroupSocialReactionKind, number>;
  ownReaction?: GroupSocialReactionKind;
  commentCount: number;
};

export function socialRowTargetKey(row: {
  targetType: string;
  targetId: string;
}) {
  return `${row.targetType}\u0000${row.targetId}`;
}

/** Keep server totals while painting only this viewer's optimistic choice. */
export function socialSummaryWithReaction(
  summary: GroupSocialSummary,
  currentReaction: GroupSocialReactionKind | undefined,
): GroupSocialSummary {
  if (currentReaction === summary.ownReaction) return summary;
  const reactionCounts = { ...summary.reactionCounts };
  if (summary.ownReaction)
    reactionCounts[summary.ownReaction] = Math.max(
      0,
      reactionCounts[summary.ownReaction] - 1,
    );
  if (currentReaction) reactionCounts[currentReaction] += 1;
  return { ...summary, reactionCounts, ownReaction: currentReaction };
}

/** A page may overlap a realtime preview; ids, not timestamps, identify rows. */
export function mergeSocialComments(
  current: readonly GroupSocialComment[],
  incoming: readonly GroupSocialComment[],
) {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** A failed deletion restores that row only, preserving concurrent changes. */
export function restoreDeletedSocialComment(
  current: readonly GroupSocialComment[],
  deleted: GroupSocialComment,
) {
  return current.some((row) => row.id === deleted.id)
    ? [...current]
    : mergeSocialComments(current, [deleted]);
}

export function indexSocialRows<Row extends { targetType: string; targetId: string }>(
  rows: readonly Row[],
) {
  const result = new Map<string, Row[]>();
  for (const row of rows) {
    const key = socialRowTargetKey(row);
    const bucket = result.get(key);
    if (bucket) bucket.push(row);
    else result.set(key, [row]);
  }
  return result;
}
