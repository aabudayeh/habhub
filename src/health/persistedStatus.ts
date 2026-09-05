import type { PersistedHealthStatus } from "@/src/health/types";

/**
 * A foreground operation starts from React state that may predate a headless
 * Health Connect pass. Rebase ordinary foreground fields on the durable row,
 * but never let that stale snapshot rewind the background history cursor.
 */
export function rebaseForegroundHealthStatus(
  stored: PersistedHealthStatus | null,
  requested: PersistedHealthStatus,
): PersistedHealthStatus {
  if (!stored) return requested;
  const {
    backgroundReconciliation: requestedBackgroundReconciliation,
    ...foregroundFields
  } = requested;
  const result: PersistedHealthStatus = { ...stored, ...foregroundFields };
  if (Object.hasOwn(stored, "backgroundReconciliation"))
    result.backgroundReconciliation = stored.backgroundReconciliation;
  else if (requestedBackgroundReconciliation !== undefined)
    result.backgroundReconciliation = requestedBackgroundReconciliation;
  return result;
}

export function parsePersistedHealthStatus(
  raw: string | null,
): PersistedHealthStatus | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as PersistedHealthStatus)
      : null;
  } catch {
    return null;
  }
}

export function reconcilePersistedHealthConnection(
  latest: PersistedHealthStatus,
  granted: { connected: boolean; backgroundAccess: boolean } | null,
) {
  if (latest.connectionEnabled === true && granted?.connected === false)
    return {
      status: {
        ...latest,
        connectionEnabled: false,
        backgroundAccess: false,
      } satisfies PersistedHealthStatus,
      disconnectRevokedGrant: true,
    };
  if (latest.connectionEnabled === undefined && granted?.connected)
    return {
      status: {
        ...latest,
        connectionEnabled: true,
        backgroundAccess: granted.backgroundAccess,
      } satisfies PersistedHealthStatus,
      disconnectRevokedGrant: false,
    };
  return { status: latest, disconnectRevokedGrant: false };
}
