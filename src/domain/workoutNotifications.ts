export const WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS = 30_000;
export const WORKOUT_COMPLETION_NOTIFICATION_WINDOW_MS = 10 * 60_000;

export type WorkoutSystemNotificationPhase = "work" | "rest" | "paused";

/**
 * A workout achievement is an immediate completion acknowledgement, not a
 * digest. Hydrating cloud history, signing in, upgrading, or enabling alerts
 * must never replay an earlier workout as newly completed.
 */
export function workoutCompletionCanNotify({
  localDate,
  recordedAt,
  completedAt,
  today,
  now = Date.now(),
}: {
  localDate: string;
  recordedAt: string;
  completedAt?: string;
  today: string;
  now?: number;
}) {
  if (localDate !== today) return false;
  const completionTime = Date.parse(completedAt ?? recordedAt);
  if (!Number.isFinite(completionTime)) return false;
  const age = now - completionTime;
  return age >= -60_000 && age <= WORKOUT_COMPLETION_NOTIFICATION_WINDOW_MS;
}

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

export function workoutWebNotificationBody(
  body: string,
  elapsedSeconds: number,
  phase: WorkoutSystemNotificationPhase,
) {
  const action = body.replace(/^\d+:\d{2}\s+elapsed\s+·\s+/i, "").trim();
  if (phase === "paused") {
    const elapsed = `${formatWorkoutNotificationElapsed(elapsedSeconds)} elapsed`;
    return action ? `${elapsed} · ${action}` : elapsed;
  }
  // A hidden page can be frozen at any time, so embedding a ticking value here
  // eventually leaves a convincingly precise but stale timer. The persistent
  // notification timestamp carries the phase origin for browser/OS rendering;
  // this copy stays truthful even on platforms that display it as a clock time.
  return action ? `Timer running · ${action}` : "Timer running";
}

export function workoutWebNotificationSignature({
  ownerId,
  title,
  body,
  phase,
  phaseTimestamp,
}: {
  ownerId: string;
  title: string;
  body: string;
  phase: WorkoutSystemNotificationPhase;
  phaseTimestamp: number;
}) {
  return JSON.stringify([
    ownerId,
    title,
    body,
    phase,
    Math.floor(phaseTimestamp),
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
