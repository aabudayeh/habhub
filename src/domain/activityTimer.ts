import { ActivityTimer } from "@/src/types";

export function activityTimerElapsedSeconds(
  timer: ActivityTimer,
  now = Date.now(),
) {
  return (
    timer.accumulatedSeconds +
    (timer.status === "running"
      ? Math.max(0, (now - new Date(timer.startedAt).getTime()) / 1000)
      : 0)
  );
}

export function activityTimerDisplaySeconds(
  timer: ActivityTimer,
  now = Date.now(),
) {
  const elapsed = activityTimerElapsedSeconds(timer, now);
  return timer.mode === "countdown"
    ? Math.max(0, (timer.targetSeconds ?? 0) - elapsed)
    : elapsed;
}

export function formatActivityTimer(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
