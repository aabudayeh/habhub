export type PushDeliveryResult = {
  sent?: number;
  retryable?: boolean;
  deduplicated?: boolean;
  stale?: boolean;
};

export class RetryablePushDeliveryError extends Error {
  readonly retryable = true;

  constructor() {
    super("Push delivery is temporarily unavailable.");
    this.name = "RetryablePushDeliveryError";
  }
}

/**
 * The Edge Function deliberately returns HTTP 200 for an idempotent replay,
 * but `retryable: true` means no recipient token was available and the event
 * claim was released. Treat that response as incomplete so durable client
 * outboxes keep the exact event queued for a later registration/reconnect.
 */
export function assertPushDeliveryComplete(
  value: unknown,
): asserts value is PushDeliveryResult {
  if (!value || typeof value !== "object") return;
  const result = value as PushDeliveryResult;
  if (result.retryable === true)
    throw new RetryablePushDeliveryError();
}

export function isRetryablePushDeliveryError(
  error: unknown,
): error is RetryablePushDeliveryError {
  return (
    error instanceof RetryablePushDeliveryError ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { retryable?: unknown }).retryable === true)
  );
}

type PushRetryScheduler = (
  callback: () => void,
  delayMs: number,
) => unknown;

const DEFAULT_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const;

/**
 * Membership and challenge writes have already committed by the time their
 * optional push runs. Retry only the Edge Function's explicit no-token result,
 * in memory, without delaying the user action or persisting notification copy.
 * The caller must close over one stable event key; server-side push_events then
 * makes a late success safe if another invocation won the race.
 */
export async function dispatchPushWithBoundedRetry(
  dispatch: () => Promise<void>,
  options: {
    retryDelaysMs?: readonly number[];
    schedule?: PushRetryScheduler;
  } = {},
): Promise<void> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) =>
      setTimeout(callback, delayMs));

  const scheduleAttempt = (attempt: number) => {
    const delayMs = retryDelaysMs[attempt];
    if (delayMs === undefined) return;
    schedule(() => {
      void dispatch().catch((error) => {
        if (isRetryablePushDeliveryError(error))
          scheduleAttempt(attempt + 1);
      });
    }, delayMs);
  };

  try {
    await dispatch();
  } catch (error) {
    if (!isRetryablePushDeliveryError(error)) throw error;
    scheduleAttempt(0);
  }
}
