/**
 * Wait for a short quiet window so a gesture, form save, or native import is
 * represented by one cloud write. Continuous changes still have a hard upper
 * bound, so an active timer or long editing session cannot postpone syncing
 * forever.
 */
export const AUTO_SYNC_SETTLE_MS = 800;
export const AUTO_SYNC_MAX_BURST_MS = 5_000;
export const AUTO_SYNC_MAX_INTERACTION_WAIT_MS = 500;

export function nextAutoSyncDelay(
  now: number,
  firstChangeAt: number,
  lastChangeAt: number,
) {
  const quietWindowRemaining = Math.max(
    0,
    AUTO_SYNC_SETTLE_MS - (now - lastChangeAt),
  );
  const burstWindowRemaining = Math.max(
    0,
    AUTO_SYNC_MAX_BURST_MS - (now - firstChangeAt),
  );
  return Math.min(quietWindowRemaining, burstWindowRemaining);
}
