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
