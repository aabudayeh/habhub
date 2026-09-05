export const HEALTH_RECONCILIATION_CHUNK_DAYS = 30;
export const HEALTH_RECONCILIATION_CHUNK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const HEALTH_RECONCILIATION_CYCLE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type BackgroundHealthReconciliationState = {
  cursorEnd?: string | null;
  lastChunkAt?: string | null;
  lastCompletedAt?: string | null;
};

export type BackgroundHealthReconciliationWindow = {
  from: Date;
  to: Date;
  nextState: BackgroundHealthReconciliationState;
};

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Walk a bounded Health Connect correction window backwards through the user's
 * selected history. This supplements the inexpensive recent overlap so a
 * Samsung watch upload or edit that reaches the phone days late is eventually
 * imported even when HabHub was never opened in the meantime.
 */
export function backgroundHealthReconciliationWindow({
  historyDays,
  now,
  recentFrom,
  state,
}: {
  historyDays: number;
  now: Date;
  recentFrom: Date;
  state?: BackgroundHealthReconciliationState | null;
}): BackgroundHealthReconciliationWindow | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  // Today-only is an access boundary, not a one-day deep-repair window. The
  // routine read may still correct the current day on each later sync.
  if (historyDays <= 0) return null;

  const lastChunk = validDate(state?.lastChunkAt);
  if (
    lastChunk &&
    nowMs - lastChunk.getTime() < HEALTH_RECONCILIATION_CHUNK_INTERVAL_MS
  )
    return null;

  const selectedDays = Math.max(30, Math.min(730, Math.round(historyDays)));
  const horizon = startOfLocalDay(now);
  horizon.setDate(horizon.getDate() - selectedDays);
  const newestDeepEnd = new Date(startOfLocalDay(recentFrom).getTime() - 1);
  if (newestDeepEnd <= horizon) return null;

  let cursorEnd = validDate(state?.cursorEnd);
  if (!cursorEnd || cursorEnd > newestDeepEnd || cursorEnd <= horizon) {
    const completed = validDate(state?.lastCompletedAt);
    if (
      completed &&
      nowMs - completed.getTime() < HEALTH_RECONCILIATION_CYCLE_INTERVAL_MS
    )
      return null;
    cursorEnd = newestDeepEnd;
  }

  const from = startOfLocalDay(cursorEnd);
  from.setDate(from.getDate() - (HEALTH_RECONCILIATION_CHUNK_DAYS - 1));
  if (from < horizon) from.setTime(horizon.getTime());
  if (from > cursorEnd) return null;

  const completedCycle = from.getTime() <= horizon.getTime();
  return {
    from,
    to: cursorEnd,
    nextState: {
      cursorEnd: completedCycle
        ? null
        : new Date(from.getTime() - 1).toISOString(),
      lastChunkAt: now.toISOString(),
      lastCompletedAt: completedCycle
        ? now.toISOString()
        : (state?.lastCompletedAt ?? null),
    },
  };
}
