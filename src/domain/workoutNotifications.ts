// Hidden web pages are commonly timer-throttled, so five-second reposts are
// both unreliable and unnecessarily battery-heavy. Ten seconds is the compact
// refresh cadence browsers can usually sustain while the OS notification's
// timestamp remains the authoritative phase clock between updates.
export const WEB_WORKOUT_NOTIFICATION_REFRESH_MS = 10_000;
export const WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS = 30_000;

export type WorkoutSystemNotificationPhase = "work" | "rest" | "paused";

export function workoutNotificationElapsedSeconds({
  phase,
  phaseStartedAt,
  phaseElapsedSeconds,
  now = Date.now(),
}: {
  phase: WorkoutSystemNotificationPhase;
  phaseStartedAt: number;
  phaseElapsedSeconds: number;
  now?: number;
}) {
  const runningSeconds =
    phase === "paused"
      ? 0
      : Math.max(0, Math.floor((now - phaseStartedAt) / 1000));
  return Math.max(0, Math.floor(phaseElapsedSeconds)) + runningSeconds;
}

export function formatWorkoutNotificationElapsed(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function workoutWebNotificationBody(body: string, elapsedSeconds: number) {
  const action = body.replace(/^\d+:\d{2}\s+elapsed\s+·\s+/i, "").trim();
  const elapsed = `${formatWorkoutNotificationElapsed(elapsedSeconds)} elapsed`;
  return action ? `${elapsed} · ${action}` : elapsed;
}

export function workoutWebNotificationSignature({
  ownerId,
  title,
  body,
  phase,
  elapsedSeconds,
}: {
  ownerId: string;
  title: string;
  body: string;
  phase: WorkoutSystemNotificationPhase;
  elapsedSeconds: number;
}) {
  return JSON.stringify([
    ownerId,
    title,
    body,
    phase,
    Math.floor(elapsedSeconds / (WEB_WORKOUT_NOTIFICATION_REFRESH_MS / 1000)),
  ]);
}

export function webWorkoutActionAckRetryDelay(attempt: number) {
  const boundedAttempt = Math.max(0, Math.min(8, Math.floor(attempt)));
  return Math.min(
    WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS,
    500 * 2 ** boundedAttempt,
  );
}

export async function acknowledgeWorkoutActionsAfterPersistence(
  persistence: Promise<void>,
  acknowledge: () => Promise<void>,
) {
  await persistence;
  await acknowledge();
}
