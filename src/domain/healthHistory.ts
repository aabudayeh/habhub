import type { HealthHistoryDays } from "@/src/types";

export const HEALTH_HISTORY_DAY_OPTIONS = [0, 30, 90, 365, 730] as const;

export function normalizeHealthHistoryDays(
  value: unknown,
  fallback: HealthHistoryDays = 90,
): HealthHistoryDays {
  return HEALTH_HISTORY_DAY_OPTIONS.includes(value as HealthHistoryDays)
    ? (value as HealthHistoryDays)
    : fallback;
}

function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Calculate a native-read boundary without weakening Today-only. Positive
 * windows keep the ordinary overlap that repairs missed provider hand-offs;
 * zero always begins at today's local midnight, even after a long app closure.
 */
export function healthImportStart({
  now = new Date(),
  lastSyncedAt,
  fullRefresh = false,
  historyDays,
  initialDays = 30,
  routineOverlapDays = 7,
}: {
  now?: Date;
  lastSyncedAt: string | null;
  fullRefresh?: boolean;
  historyDays: HealthHistoryDays;
  initialDays?: number;
  routineOverlapDays?: number;
}) {
  const today = startOfLocalDay(now);
  if (!Number.isFinite(today.getTime()))
    throw new Error("A valid health-sync time is required.");
  if (historyDays === 0) return today;

  const parsedLastSync = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const hasValidLastSync = Boolean(
    parsedLastSync && Number.isFinite(parsedLastSync.getTime()),
  );
  const from = hasValidLastSync
    ? startOfLocalDay(parsedLastSync!)
    : new Date(today);
  const daysToSubtract = fullRefresh
    ? historyDays
    : hasValidLastSync
      ? Math.max(0, Math.floor(routineOverlapDays))
      : Math.min(historyDays, Math.max(0, Math.floor(initialDays)));
  from.setDate(from.getDate() - daysToSubtract);
  if (from > today) from.setTime(today.getTime());

  return from;
}

/** Detect an in-flight read whose privacy window changed before it committed. */
export function healthHistorySelectionKey(
  historyDays: HealthHistoryDays,
) {
  return String(historyDays);
}
