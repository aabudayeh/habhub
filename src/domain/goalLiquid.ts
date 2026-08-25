export type GoalLiquidProgressSnapshot = Record<
  string,
  { progress: number; signature: string }
>;

function normalizedProgress(value: unknown) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

/**
 * Returns the prior fill for goals whose visible progress increased.
 * Regressions settle immediately because a bottom-anchored liquid layer cannot
 * reveal a larger prior fill from a smaller current layer without flashing.
 */
export function increasingGoalLiquidAnimationStarts(
  previous: GoalLiquidProgressSnapshot,
  current: GoalLiquidProgressSnapshot,
) {
  const starts: Record<string, number> = {};
  for (const [id, snapshot] of Object.entries(current)) {
    const next = normalizedProgress(snapshot.progress);
    const prior = normalizedProgress(previous[id]?.progress);
    if (next > prior) starts[id] = prior;
  }
  return starts;
}
