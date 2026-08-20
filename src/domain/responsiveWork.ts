export type ResponsiveWorkOptions = {
  /** Do not start maintenance during the first navigation/tap frames. */
  minimumDelayMs?: number;
  /** Continuous animations cannot postpone durable work indefinitely. */
  maximumDelayMs?: number;
};

export type ResponsiveWorkDriver<TTimer> = {
  afterInteractions: (work: () => void) => { cancel: () => void };
  setTimer: (work: () => void, delayMs: number) => TTimer;
  clearTimer: (timer: TTimer) => void;
};

export type ResponsiveWorkTask = { cancel: () => void };

/**
 * Schedule maintenance outside the immediate interaction lane, with a hard
 * deadline for persistence/outbox correctness. The injected driver keeps the
 * single-run and cancellation rules independently executable in Node fixtures.
 */
export function scheduleResponsiveWork<TTimer>(
  driver: ResponsiveWorkDriver<TTimer>,
  work: () => void,
  options: ResponsiveWorkOptions = {},
): ResponsiveWorkTask {
  const minimumDelayMs = Math.max(0, options.minimumDelayMs ?? 0);
  const maximumDelayMs = Math.max(
    minimumDelayMs,
    options.maximumDelayMs ?? 2_000,
  );
  let finished = false;
  let minimumTimer: TTimer | null = null;
  let maximumTimer: TTimer | null = null;
  let interaction: { cancel: () => void } | null = null;

  const clear = () => {
    if (minimumTimer !== null) driver.clearTimer(minimumTimer);
    if (maximumTimer !== null) driver.clearTimer(maximumTimer);
    minimumTimer = null;
    maximumTimer = null;
    interaction?.cancel();
    interaction = null;
  };
  const run = () => {
    if (finished) return;
    finished = true;
    clear();
    work();
  };
  const armInteraction = () => {
    if (finished) return;
    minimumTimer = null;
    const next = driver.afterInteractions(run);
    if (finished) next.cancel();
    else interaction = next;
  };

  maximumTimer = driver.setTimer(run, maximumDelayMs);
  if (minimumDelayMs > 0)
    minimumTimer = driver.setTimer(armInteraction, minimumDelayMs);
  else armInteraction();

  return {
    cancel: () => {
      if (finished) return;
      finished = true;
      clear();
    },
  };
}
