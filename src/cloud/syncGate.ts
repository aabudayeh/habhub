const pauseReasons = new Set<string>();

export function setCloudSyncPaused(reason: string, paused: boolean) {
  if (paused) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
}

export function isCloudSyncPaused() {
  return pauseReasons.size > 0;
}
