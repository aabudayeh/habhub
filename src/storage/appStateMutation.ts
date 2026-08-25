let appStateMutationQueue: Promise<unknown> = Promise.resolve();

/** Serializes foreground and headless-JS writes within the Android JS runtime. */
export function runAppStateStorageMutation<T>(task: () => Promise<T>) {
  const run = appStateMutationQueue.then(task, task);
  appStateMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
