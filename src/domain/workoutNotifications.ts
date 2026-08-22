export const WEB_WORKOUT_NOTIFICATION_REFRESH_MS = 15_000;

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
