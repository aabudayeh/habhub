// Native Modal renders in a separate window; a screen-root zIndex cannot put
// the tutorial above it. The most recently presented tutorial modal owns the
// single interactive spotlight until it closes.
const hosts: string[] = [];
const listeners = new Set<() => void>();

export function activeTutorialModalHost(): string | undefined {
  return hosts.at(-1);
}

export function subscribeTutorialModalHost(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function registerTutorialModalHost(id: string) {
  hosts.push(id);
  listeners.forEach((listener) => listener());
  return () => {
    const index = hosts.lastIndexOf(id);
    if (index >= 0) hosts.splice(index, 1);
    listeners.forEach((listener) => listener());
  };
}
