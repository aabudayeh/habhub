const pauseReasons = new Set<string>();
const pauseListeners = new Set<(paused: boolean) => void>();

export function setCloudSyncPaused(reason: string, paused: boolean) {
  const wasPaused = pauseReasons.size > 0;
  if (paused) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
  const isPaused = pauseReasons.size > 0;
  if (wasPaused !== isPaused)
    pauseListeners.forEach((listener) => listener(isPaused));
}

export function isCloudSyncPaused() {
  return pauseReasons.size > 0;
}

/** Wake a deferred outbox exactly when the final edit/import gate is released. */
export function subscribeCloudSyncPause(
  listener: (paused: boolean) => void,
) {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}
