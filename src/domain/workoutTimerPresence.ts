export const WORKOUT_DRAFT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Fail-closed check used before a lazily mounted Workout tab restores its draft. */
export function storedWorkoutDraftHasActiveTimer(
  raw: string | null,
  now = Date.now(),
) {
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as {
      savedAt?: unknown;
      timer?: unknown;
      exercises?: unknown;
    };
    return (
      typeof draft.savedAt === "number" &&
      Number.isFinite(draft.savedAt) &&
      draft.savedAt <= now + 60_000 &&
      now - draft.savedAt <= WORKOUT_DRAFT_MAX_AGE_MS &&
      Boolean(draft.timer) &&
      typeof draft.timer === "object" &&
      Array.isArray(draft.exercises)
    );
  } catch {
    return false;
  }
}
