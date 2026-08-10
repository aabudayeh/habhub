type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type QueuedFetch = {
  run: () => void;
  cancel: () => void;
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return "url" in input ? input.url : input.href;
}

function abortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Bound only the matching HTTP surface while preserving the underlying
 * fetch implementation, headers, response and in-flight AbortSignal behavior.
 * A request aborted while queued is removed before it consumes a slot.
 */
export function createPathBoundedFetch(
  fetchImpl: FetchLike,
  maximum: number,
  pathFragment: string,
): FetchLike {
  const maxConcurrent = Math.max(1, Math.floor(maximum));
  const queue: QueuedFetch[] = [];
  let active = 0;

  const drain = () => {
    while (active < maxConcurrent && queue.length) queue.shift()!.run();
  };

  return (input, init) => {
    if (!requestUrl(input).includes(pathFragment))
      return fetchImpl(input, init);
    const inputSignal =
      typeof Request !== "undefined" && input instanceof Request
        ? input.signal
        : undefined;
    const signal = init?.signal ?? inputSignal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<Response>((resolve, reject) => {
      let queued = true;
      const job: QueuedFetch = {
        run: () => {
          if (!queued) return;
          queued = false;
          signal?.removeEventListener("abort", job.cancel);
          active += 1;
          Promise.resolve()
            .then(() => fetchImpl(input, init))
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              drain();
            });
        },
        cancel: () => {
          if (!queued) return;
          queued = false;
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          signal?.removeEventListener("abort", job.cancel);
          reject(abortError());
        },
      };
      signal?.addEventListener("abort", job.cancel, { once: true });
      queue.push(job);
      drain();
    });
  };
}
