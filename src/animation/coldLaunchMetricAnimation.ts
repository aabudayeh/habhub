export type ColdLaunchMetricAnimationPhase =
  | "pending"
  | "armed"
  | "consumed";

let phase: ColdLaunchMetricAnimationPhase = "pending";
const listeners = new Set<() => void>();

function publish(next: ColdLaunchMetricAnimationPhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((listener) => listener());
}

/**
 * Makes one launch-only decision after hydration and initial routing settle.
 * The decision intentionally lives in memory: a real process restart creates
 * a fresh module, while tab remounts and foreground resumes cannot replay it.
 */
export function configureColdLaunchMetricAnimation(startsOnToday: boolean) {
  if (phase !== "pending") return phase;
  publish(startsOnToday ? "armed" : "consumed");
  return phase;
}

export function isTodayPathname(pathname: string) {
  return pathname === "/" || pathname === "/index";
}

/** Closes an armed window when initial navigation leaves Today. */
export function sealColdLaunchMetricAnimation() {
  if (phase !== "consumed") publish("consumed");
}

/** Atomically spends this process's one animation on the initial Today view. */
export function claimColdLaunchMetricAnimation(surface: string) {
  if (surface !== "today" || phase !== "armed") return false;
  publish("consumed");
  return true;
}

export function coldLaunchMetricAnimationSnapshot() {
  return phase;
}

export function subscribeColdLaunchMetricAnimation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
