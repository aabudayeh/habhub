/**
 * Serializes asynchronous work while coalescing queued values to the newest
 * one. Finalization adopts a late-arriving value, so a caller can never strand
 * work in the narrow window between the drain observing empty and settling.
 */
export function createLatestAsyncDrain<T>(worker: (value: T) => Promise<void>) {
  let pending: T | undefined;
  let active: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const operation = (async () => {
      while (pending !== undefined) {
        const next = pending;
        pending = undefined;
        await worker(next);
      }
    })();
    let finalized: Promise<void>;
    finalized = operation.finally(() => {
      if (active === finalized) active = null;
      if (pending !== undefined) return start();
    });
    active = finalized;
    return finalized;
  };

  return (value: T) => {
    pending = value;
    return active ?? start();
  };
}

type KeyedDrainWaiter<R> = {
  resolve: (value: R | PromiseLike<R>) => void;
  reject: (reason?: unknown) => void;
};

type KeyedDrainRequest<T, R> = {
  value: T;
  waiters: KeyedDrainWaiter<R>[];
};

/**
 * A keyed single-flight drain for network work that returns a result. While a
 * key is active, queued values collapse to the newest immutable value and all
 * coalesced callers receive that newest run's result. Different keys can run
 * independently. A failed run rejects and clears its queued work so an outage
 * cannot turn into an immediate retry loop.
 */
export function createKeyedLatestAsyncDrain<K, T, R>(
  worker: (key: K, value: T) => Promise<R>,
) {
  const drains = new Map<
    K,
    {
      active: boolean;
      pending?: KeyedDrainRequest<T, R>;
    }
  >();

  const run = async (
    key: K,
    drain: { active: boolean; pending?: KeyedDrainRequest<T, R> },
  ) => {
    const takePending = () => {
      const request = drain.pending;
      drain.pending = undefined;
      return request;
    };
    drain.active = true;
    while (drain.pending) {
      const request = takePending();
      if (!request) break;
      try {
        const result = await worker(key, request.value);
        request.waiters.forEach((waiter) => waiter.resolve(result));
      } catch (error) {
        const queued = takePending();
        request.waiters.forEach((waiter) => waiter.reject(error));
        queued?.waiters.forEach((waiter) => waiter.reject(error));
        break;
      }
    }
    drain.active = false;
    if (drain.pending) void run(key, drain);
    else if (drains.get(key) === drain) drains.delete(key);
  };

  return (key: K, value: T) =>
    new Promise<R>((resolve, reject) => {
      let drain = drains.get(key);
      if (!drain) {
        drain = { active: false };
        drains.set(key, drain);
      }
      const waiter = { resolve, reject };
      if (drain.pending) {
        drain.pending.value = value;
        drain.pending.waiters.push(waiter);
      } else {
        drain.pending = { value, waiters: [waiter] };
      }
      if (!drain.active) void run(key, drain);
    });
}
