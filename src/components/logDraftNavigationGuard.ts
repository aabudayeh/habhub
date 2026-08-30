type LogDraftExitHandler = (leave: () => void) => boolean;

let activeHandler: LogDraftExitHandler | null = null;

/**
 * Lets the mounted Log tab guard tab-bar navigation before the tab loses
 * focus. React Navigation's beforeRemove event does not run when a tab route
 * stays mounted and only its selected index changes.
 */
export function registerLogDraftExitHandler(handler: LogDraftExitHandler) {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** Returns true when Log consumed the navigation attempt to show its prompt. */
export function requestLogDraftExit(leave: () => void) {
  return activeHandler?.(leave) ?? false;
}
