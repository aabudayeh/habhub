export const RECAP_STORY_DURATION_MS = 6_500;

export type RecapStoryPlaybackGate = {
  storyCount: number;
  gestureActive: boolean;
  socialInteractionActive: boolean;
  reportOpen: boolean;
};

/** Story progress may run only while the screen is genuinely idle. */
export function recapStoryAutoplayEnabled({
  storyCount,
  gestureActive,
  socialInteractionActive,
  reportOpen,
}: RecapStoryPlaybackGate) {
  return (
    storyCount > 0 &&
    !gestureActive &&
    !socialInteractionActive &&
    !reportOpen
  );
}

/** Continue a paused story from its visible progress instead of restarting it. */
export function remainingRecapStoryDurationMs(
  progress: number,
  durationMs = RECAP_STORY_DURATION_MS,
) {
  if (!Number.isFinite(progress)) return durationMs;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return Math.round(durationMs * (1 - clampedProgress));
}
