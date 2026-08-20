const listeners = new Set<() => void>();

/** Permission can become granted while `pushEnabled` was already true. */
export function requestLocalNotificationRefresh() {
  listeners.forEach((listener) => listener());
}

export function subscribeLocalNotificationRefresh(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
