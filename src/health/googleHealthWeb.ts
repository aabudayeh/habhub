import { Platform } from "react-native";

import { cloudConfigured, supabase } from "@/src/lib/supabase";
import { isGoogleHealthCompletionToken } from "@/src/domain/googleHealthCallback";

export type GoogleHealthConnectionState =
  | "disconnected"
  | "pending"
  | "connected"
  | "error";

export type GoogleHealthConnection = {
  state: GoogleHealthConnectionState;
  provider: "google_health";
  email: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  importedCount: number;
  syncing: boolean;
};

export type GoogleHealthSyncResult = {
  imported: number;
  deleted: number;
  dataTypes: string[];
  errors: GoogleHealthSyncError[];
};

export type GoogleHealthSyncError = {
  dataType: string;
  code: string;
};

export type GoogleHealthResponse = {
  connection: GoogleHealthConnection;
  authorizationUrl?: string;
  sync?: GoogleHealthSyncResult;
  entryId?: string;
  dismissedEntryId?: string;
  metricId?: string;
  visibility?: "private" | "status" | "group";
  updatedCount?: number;
};

export type GoogleHealthEntryPatch = {
  visibility?: "private" | "status" | "group";
  recordedAtOverride?: string | null;
  localDate?: string | null;
};

export type GoogleHealthAction =
  | "status"
  | "connect"
  | "complete"
  | "sync"
  | "refresh"
  | "disconnect"
  | "delete"
  | "updateEntry"
  | "dismissEntry"
  | "updateMetricVisibility";

export class GoogleHealthClientError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "GoogleHealthClientError";
    this.code = code;
    this.status = status;
  }
}

const connectionStates = new Set<GoogleHealthConnectionState>([
  "disconnected",
  "pending",
  "connected",
  "error",
]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown, maximumLength = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function validTimestamp(value: unknown) {
  const normalized = optionalString(value, 64);
  if (!normalized || !Number.isFinite(Date.parse(normalized))) return null;
  return normalized;
}

function parseConnection(value: unknown): GoogleHealthConnection {
  const input = objectValue(value);
  const state = input?.state;
  if (
    !input ||
    input.provider !== "google_health" ||
    typeof state !== "string" ||
    !connectionStates.has(state as GoogleHealthConnectionState) ||
    !Array.isArray(input.scopes)
  ) {
    throw new GoogleHealthClientError("invalid_response");
  }

  const scopes = [
    ...new Set(
      input.scopes
        .filter((scope): scope is string => typeof scope === "string")
        .map((scope) => scope.trim())
        .filter(Boolean)
        .map((scope) => scope.slice(0, 240)),
    ),
  ];

  return {
    state: state as GoogleHealthConnectionState,
    provider: "google_health",
    email: optionalString(input.email, 320),
    scopes,
    lastSyncedAt: validTimestamp(input.lastSyncedAt),
    lastError: optionalString(input.lastError),
    importedCount: parseCount(input.importedCount),
    syncing: input.syncing === true,
  };
}

function parseCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function parseGoogleHealthSyncErrors(
  value: unknown,
): GoogleHealthSyncError[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new GoogleHealthClientError("invalid_response");
  const parsed: GoogleHealthSyncError[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    const input = objectValue(row);
    const dataType = optionalString(input?.dataType, 80);
    const code = optionalString(input?.code, 80);
    if (
      !dataType ||
      !code ||
      !/^[a-z0-9_-]+$/i.test(dataType) ||
      !/^[a-z0-9_-]+$/i.test(code)
    )
      throw new GoogleHealthClientError("invalid_response");
    const key = `${dataType}\u0000${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ dataType, code });
  }
  return parsed;
}

function parseResponse(
  action: GoogleHealthAction,
  value: unknown,
  expectedEntryId?: string,
  expectedMetricId?: string,
  expectedVisibility?: "private" | "status" | "group",
) {
  const input = objectValue(value);
  if (!input) throw new GoogleHealthClientError("invalid_response");
  const response: GoogleHealthResponse = {
    connection: parseConnection(input.connection),
  };

  if (action === "connect") {
    const authorizationUrl = optionalString(input.authorizationUrl, 2048);
    if (!authorizationUrl) throw new GoogleHealthClientError("invalid_response");
    let parsed: URL;
    try {
      parsed = new URL(authorizationUrl);
    } catch {
      throw new GoogleHealthClientError("invalid_response");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") {
      throw new GoogleHealthClientError("invalid_authorization_url");
    }
    response.authorizationUrl = parsed.toString();
  }

  const sync = objectValue(input.sync);
  if (sync) {
    response.sync = {
      imported: parseCount(sync.imported),
      deleted: parseCount(sync.deleted),
      dataTypes: Array.isArray(sync.dataTypes)
        ? [
            ...new Set(
              sync.dataTypes
                .filter((type): type is string => typeof type === "string")
                .map((type) => type.trim().slice(0, 120))
                .filter(Boolean),
            ),
          ]
        : [],
      errors: parseGoogleHealthSyncErrors(sync.errors),
    };
  }
  if (action === "updateEntry") {
    const entry = objectValue(input.entry);
    const entryId = optionalString(entry?.id, 360);
    if (!entryId || entryId !== expectedEntryId)
      throw new GoogleHealthClientError("invalid_response");
    response.entryId = entryId;
  }
  if (action === "dismissEntry") {
    const dismissedEntryId = optionalString(input.dismissedEntryId, 360);
    if (!dismissedEntryId || dismissedEntryId !== expectedEntryId)
      throw new GoogleHealthClientError("invalid_response");
    response.dismissedEntryId = dismissedEntryId;
  }
  if (action === "updateMetricVisibility") {
    const metricId = optionalString(input.metricId, 160);
    const visibility = optionalString(input.visibility, 16);
    if (
      !metricId ||
      metricId !== expectedMetricId ||
      visibility !== expectedVisibility
    )
      throw new GoogleHealthClientError("invalid_response");
    response.metricId = metricId;
    response.visibility = visibility as "private" | "status" | "group";
    response.updatedCount = parseCount(input.updatedCount);
  }
  return response;
}

async function errorCodeFromResponse(response: Response | undefined) {
  if (!response) return null;
  try {
    const payload = objectValue(await response.clone().json());
    const nestedError = objectValue(payload?.error);
    return (
      optionalString(nestedError?.code, 80) ??
      optionalString(payload?.code, 80) ??
      (typeof payload?.error === "string"
        ? optionalString(payload.error, 80)
        : null)
    );
  } catch {
    return null;
  }
}

export async function invokeGoogleHealth(
  action: GoogleHealthAction,
  options: {
    redirectUri?: string;
    completionToken?: string;
    entryId?: string;
    patch?: GoogleHealthEntryPatch;
    metricId?: string;
    visibility?: "private" | "status" | "group";
  } = {},
): Promise<GoogleHealthResponse> {
  const isDataMutation =
    action === "updateEntry" ||
    action === "dismissEntry" ||
    action === "updateMetricVisibility";
  const isEntryMutation = action === "updateEntry" || action === "dismissEntry";
  if (Platform.OS !== "web" && !isDataMutation)
    throw new GoogleHealthClientError("web_only");
  if (!cloudConfigured || !supabase)
    throw new GoogleHealthClientError("cloud_not_configured");

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new GoogleHealthClientError("sign_in_required", 401);

  const body: {
    action: GoogleHealthAction;
    redirectUri?: string;
    completionToken?: string;
    entryId?: string;
    patch?: GoogleHealthEntryPatch;
    metricId?: string;
    visibility?: "private" | "status" | "group";
  } = { action };
  if (action === "connect" && options.redirectUri) {
    let redirect: URL;
    try {
      redirect = new URL(options.redirectUri);
    } catch {
      throw new GoogleHealthClientError("invalid_redirect_uri");
    }
    const localDevelopmentHost = ["localhost", "127.0.0.1", "[::1]"].includes(
      redirect.hostname,
    );
    if (
      redirect.protocol !== "https:" &&
      !(redirect.protocol === "http:" && localDevelopmentHost)
    )
      throw new GoogleHealthClientError("invalid_redirect_uri");
    body.redirectUri = redirect.toString();
  }
  if (action === "complete") {
    const completionToken = options.completionToken?.trim();
    if (!isGoogleHealthCompletionToken(completionToken))
      throw new GoogleHealthClientError("invalid_completion");
    body.completionToken = completionToken;
  }
  if (isEntryMutation) {
    const entryId = options.entryId?.trim();
    if (!entryId || entryId.length > 360)
      throw new GoogleHealthClientError("invalid_entry");
    body.entryId = entryId;
  }
  if (action === "updateEntry") {
    const patch = options.patch;
    const keys = Object.keys(patch ?? {});
    if (
      !patch ||
      !keys.length ||
      keys.some(
        (key) =>
          !["visibility", "recordedAtOverride", "localDate"].includes(key),
      )
    )
      throw new GoogleHealthClientError("invalid_entry_patch");
    if (
      patch.visibility !== undefined &&
      !["private", "status", "group"].includes(patch.visibility)
    )
      throw new GoogleHealthClientError("invalid_entry_patch");
    const hasTime = patch.recordedAtOverride !== undefined;
    const hasDate = patch.localDate !== undefined;
    if (hasTime !== hasDate)
      throw new GoogleHealthClientError("invalid_entry_patch");
    if (
      patch.recordedAtOverride !== undefined &&
      patch.recordedAtOverride !== null &&
      !validTimestamp(patch.recordedAtOverride)
    )
      throw new GoogleHealthClientError("invalid_entry_patch");
    if (
      patch.localDate !== undefined &&
      patch.localDate !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(patch.localDate)
    )
      throw new GoogleHealthClientError("invalid_entry_patch");
    body.patch = patch;
  }
  if (action === "updateMetricVisibility") {
    const metricId = options.metricId?.trim();
    if (!metricId || metricId.length > 160 || !/^[A-Za-z0-9:._-]+$/.test(metricId))
      throw new GoogleHealthClientError("invalid_metric_visibility");
    if (
      !options.visibility ||
      !["private", "status", "group"].includes(options.visibility)
    )
      throw new GoogleHealthClientError("invalid_metric_visibility");
    body.metricId = metricId;
    body.visibility = options.visibility;
  }

  const { data, error, response } = await supabase.functions.invoke(
    "google-health",
    {
      body,
      timeout: action === "sync" ? 90_000 : 20_000,
    },
  );
  if (error) {
    const status = response?.status ?? null;
    const code =
      (await errorCodeFromResponse(response)) ??
      (status === 401
        ? "sign_in_required"
        : status === 404
          ? "not_configured"
          : status === 429
            ? "rate_limited"
            : error.name === "FunctionsFetchError"
              ? "network_error"
              : "request_failed");
    throw new GoogleHealthClientError(code, status);
  }
  return parseResponse(
    action,
    data,
    body.entryId,
    body.metricId,
    body.visibility,
  );
}

export function googleHealthScopeLabel(scope: string) {
  const suffix = scope.split("/").pop()?.toLowerCase() ?? scope.toLowerCase();
  if (suffix === "googlehealth.activity_and_fitness.readonly")
    return "Activity & fitness";
  if (suffix === "googlehealth.health_metrics_and_measurements.readonly")
    return "Health measurements";
  if (suffix === "googlehealth.sleep.readonly") return "Sleep";
  if (suffix === "googlehealth.nutrition.readonly") return "Nutrition";
  return null;
}
