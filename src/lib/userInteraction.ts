let lastUserInteractionAt = 0;
const listeners = new Set<() => void>();

/**
 * Records real touch activity at the root of the native app. React Native's
 * InteractionManager covers navigation animations, but it does not reliably
 * treat a discrete tap as an interaction. Cloud maintenance uses this pulse
 * to avoid starting a large JSON/merge/render turn immediately after a press.
 */
export function markUserInteraction(at = Date.now()) {
  lastUserInteractionAt = Math.max(lastUserInteractionAt, at);
  listeners.forEach((listener) => listener());
}

export function millisecondsSinceUserInteraction(now = Date.now()) {
  if (!lastUserInteractionAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - lastUserInteractionAt);
}

export function subscribeUserInteraction(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
