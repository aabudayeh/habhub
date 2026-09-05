type InitializeHealthConnect = () => Promise<boolean>;

/**
 * Health Connect's native client is process-local. Android can start a
 * TaskManager job in a fresh process where no React provider effect has run,
 * so every adapter operation must pass through the same initialization gate.
 */
export function createHealthConnectInitializationGate(
  initializeClient: InitializeHealthConnect,
) {
  let initialization: Promise<void> | undefined;

  return () => {
    if (initialization) return initialization;

    const attempt = Promise.resolve()
      .then(initializeClient)
      .then((initialized) => {
        if (!initialized)
          throw new Error("Health Connect could not be initialized.");
      });
    initialization = attempt;
    void attempt.catch(() => {
      // A provider install/update or transient native startup failure may be
      // repaired before the next foreground or WorkManager attempt.
      if (initialization === attempt) initialization = undefined;
    });
    return attempt;
  };
}
