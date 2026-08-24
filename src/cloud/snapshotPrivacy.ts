import type { SupabaseClient } from "@supabase/supabase-js";

export const HABHUB_PRIVACY_SCHEMA_VERSION = 27 as const;
export const HABHUB_PRIVACY_SCHEMA_HEADER = "x-habhub-privacy-schema";
export const HABHUB_CLOUD_PROTOCOL_VERSION = 2 as const;
export const HABHUB_CLOUD_PROTOCOL_HEADER = "x-habhub-cloud-protocol";
export const GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR =
  "google_health_privacy_client_upgrade_required";

/**
 * Capability-bearing Realtime topic. Released schema-26 clients only know the
 * legacy `account:<id>:snapshot` topic, so a Google-sensitive account can stop
 * broadcasting revision/device metadata there without breaking schema-27
 * invalidation delivery.
 */
export function privacyAwareSnapshotTopic(accountId: string) {
  return `account:${accountId}:snapshot:v${HABHUB_PRIVACY_SCHEMA_VERSION}`;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return "url" in input ? input.url : input.href;
}

function isPostgrestRequest(input: RequestInfo | URL) {
  try {
    const pathname = new URL(requestUrl(input)).pathname;
    return pathname === "/rest/v1" || pathname.startsWith("/rest/v1/");
  } catch {
    return false;
  }
}

/**
 * Advertise the privacy-safe snapshot schema and current cloud protocol only
 * to PostgREST. Supabase's global headers are also inherited by Auth, Storage
 * and Edge Functions; sending these custom headers there would add unrelated
 * browser CORS preflights.
 */
export function createPostgrestPrivacySchemaFetch(
  fetchImpl: FetchLike,
): FetchLike {
  return (input, init) => {
    if (!isPostgrestRequest(input)) return fetchImpl(input, init);
    const requestHeaders =
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined;
    const headers = new Headers(requestHeaders);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(
      HABHUB_PRIVACY_SCHEMA_HEADER,
      String(HABHUB_PRIVACY_SCHEMA_VERSION),
    );
    headers.set(
      HABHUB_CLOUD_PROTOCOL_HEADER,
      String(HABHUB_CLOUD_PROTOCOL_VERSION),
    );
    return fetchImpl(input, { ...init, headers });
  };
}

export type PrivacyAwareSnapshotRow<T> = {
  payload: T;
  revision: number;
  updated_at: string;
  device_id: string | null;
  schema_version: number;
};

export type PrivacyAwareSnapshotMetadata = Omit<
  PrivacyAwareSnapshotRow<never>,
  "payload"
>;

function firstRpcRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function metadataFromRpcRow(
  row: Record<string, unknown>,
): PrivacyAwareSnapshotMetadata {
  return {
    revision: Number(row.revision ?? 0),
    updated_at: String(row.updated_at ?? ""),
    device_id: typeof row.device_id === "string" ? row.device_id : null,
    schema_version: Number(row.schema_version ?? HABHUB_PRIVACY_SCHEMA_VERSION),
  };
}

export function isGoogleHealthPrivacyUpgradeError(error: unknown) {
  if (typeof error === "string")
    return error.includes(GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR);
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return [record.code, record.message, record.details, record.hint].some(
    (value) =>
      typeof value === "string" &&
      value.includes(GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR),
  );
}

export async function getPrivacyAwareUserSnapshot<T>(
  client: SupabaseClient,
  signal?: AbortSignal,
): Promise<PrivacyAwareSnapshotRow<T> | null> {
  let request = client.rpc("get_user_snapshot", {
    p_client_schema_version: HABHUB_PRIVACY_SCHEMA_VERSION,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const row = firstRpcRow(data);
  if (!row) return null;
  return {
    ...metadataFromRpcRow(row),
    payload: row.payload as T,
  };
}

export async function getPrivacyAwareUserSnapshotMetadata(
  client: SupabaseClient,
): Promise<PrivacyAwareSnapshotMetadata | null> {
  const { data, error } = await client.rpc("get_user_snapshot_metadata", {
    p_client_schema_version: HABHUB_PRIVACY_SCHEMA_VERSION,
  });
  if (error) throw error;
  const row = firstRpcRow(data);
  return row ? metadataFromRpcRow(row) : null;
}

export async function syncPrivacyAwareUserSnapshot<T>(
  client: SupabaseClient,
  payload: T,
  expectedRevision: number,
  deviceId: string,
) {
  const { data, error } = await client.rpc("sync_user_snapshot", {
    expected_revision: expectedRevision,
    new_payload: payload,
    client_device_id: deviceId,
    client_schema_version: HABHUB_PRIVACY_SCHEMA_VERSION,
  });
  if (error) throw error;
  const row = firstRpcRow(data);
  return {
    revision: Number(row?.revision ?? expectedRevision + 1),
    updatedAt: String(row?.updated_at ?? new Date().toISOString()),
  };
}
