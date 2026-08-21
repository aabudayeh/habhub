export const CLOUD_CONFLICT_BASE_RETRY_MS = 5_000;
export const CLOUD_CONFLICT_MAX_RETRY_MS = 5 * 60 * 1000;
export const CLOUD_CONFLICT_MAX_ATTEMPTS = 8;

export type CloudConflictGate = {
  userId: string;
  attempt: number;
  retryAt: number;
  observedRevision?: number;
};

function validRevision(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function nextCloudConflictGate(
  previous: CloudConflictGate | null,
  userId: string,
  now: number,
  observedRevision?: number,
): CloudConflictGate {
  const attempt =
    previous?.userId === userId
      ? Math.min(CLOUD_CONFLICT_MAX_ATTEMPTS, previous.attempt + 1)
      : 1;
  const delay = Math.min(
    CLOUD_CONFLICT_MAX_RETRY_MS,
    CLOUD_CONFLICT_BASE_RETRY_MS * 2 ** (attempt - 1),
  );
  return {
    userId,
    attempt,
    retryAt: now + delay,
    observedRevision: validRevision(Number(observedRevision))
      ? Number(observedRevision)
      : previous?.userId === userId
        ? previous.observedRevision
        : undefined,
  };
}

export function cloudConflictBackoffActive(
  gate: CloudConflictGate | null,
  userId: string,
  now: number,
) {
  return gate?.userId === userId && gate.retryAt > now;
}

/**
 * A relational workspace projection must be derived from the exact private
 * account revision it publishes against. If another client advanced that
 * revision while the projection was being prepared, rebase before issuing the
 * guarded RPC rather than deliberately sending a stale token to Postgres.
 */
export function confirmedCloudPublishRevision(
  expectedRevision: number,
  observedRevision: number,
) {
  if (!validRevision(expectedRevision) || !validRevision(observedRevision))
    throw new Error("Account sync revision is not available yet.");
  if (expectedRevision !== observedRevision)
    throw new Error(
      `stale_group_publish: account revision advanced from ${expectedRevision} to ${observedRevision}`,
    );
  return observedRevision;
}
