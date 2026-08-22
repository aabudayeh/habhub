export const noStoreHeaders = {
  "cache-control": "no-store, private",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

export function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const configured = [
    Deno.env.get("GOOGLE_HEALTH_WEB_ORIGIN") || "https://habhub.expo.app",
    ...(Deno.env.get("GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS") || "").split(","),
  ];
  const allowed = new Set(configured.flatMap((value) => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === "https:" ? [parsed.origin] : [];
    } catch {
      return [];
    }
  }));
  return {
    ...(allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
    ...noStoreHeaders,
  };
}

export function jsonResponse(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type GoogleErrorPayload = {
  error?: {
    status?: unknown;
    message?: unknown;
    details?: unknown;
  } | unknown;
  error_description?: unknown;
};

const PROVIDER_REASON_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;

function normalizedProviderReason(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return PROVIDER_REASON_PATTERN.test(normalized) ? normalized : null;
}

function reasonFromDetails(details: unknown) {
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const reason = normalizedProviderReason((detail as { reason?: unknown }).reason);
    if (reason) return reason;
  }
  return null;
}

function reasonFromMessage(message: string) {
  // Some Google REST responses omit google.rpc.ErrorInfo and only include the
  // catalog description. Keep a small, reviewed mapping so durable sync state
  // remains actionable without storing arbitrary provider text.
  if (/window[_ ]size[_ ]days\s*\*\s*page[_ ]size|duration covered by .*page.?size/i.test(message))
    return "INVALID_ROLLUP_QUERY_DURATION";
  if (/invalid civil date time/i.test(message)) return "INVALID_CIVIL_DATE_TIME";
  if (/required oauth scope|oauth scope.*missing/i.test(message)) return "MISSING_OAUTH_SCOPE";
  if (/account is not linked/i.test(message)) return "ACCOUNT_NOT_LINKED";
  return null;
}

export class GoogleHealthProviderError extends Error {
  readonly httpStatus: number;
  readonly providerStatus: string | null;
  readonly providerReason: string | null;

  constructor(input: {
    httpStatus: number;
    providerStatus: string | null;
    providerReason: string | null;
    safeMessage: string;
  }) {
    super(
      `Google Health request failed (${input.httpStatus})${
        input.safeMessage ? `: ${input.safeMessage}` : ""
      }`,
    );
    this.name = "GoogleHealthProviderError";
    this.httpStatus = input.httpStatus;
    this.providerStatus = input.providerStatus;
    this.providerReason = input.providerReason;
  }
}

/** A bounded catalog code safe to persist and return; never provider text. */
export function googleHealthProviderErrorCode(error: unknown) {
  if (!(error instanceof GoogleHealthProviderError)) return null;
  if (error.providerReason) return error.providerReason.toLowerCase();
  if (error.providerStatus) return `google_${error.providerStatus.toLowerCase()}`;
  return `google_http_${error.httpStatus}`;
}

export async function googleError(response: Response) {
  let reason = "";
  let providerStatus: string | null = null;
  let providerReason: string | null = null;
  try {
    const payload = await response.json() as GoogleErrorPayload;
    if (payload.error && typeof payload.error === "object") {
      const providerError = payload.error as {
        message?: unknown;
        status?: unknown;
        details?: unknown;
      };
      reason = String(providerError.message ?? providerError.status ?? "");
      providerStatus = normalizedProviderReason(providerError.status);
      providerReason = reasonFromDetails(providerError.details);
    }
    else reason = String(payload.error_description ?? payload.error ?? "");
  } catch {
    reason = "";
  }
  const safeReason = reason.replace(/[\r\n]+/g, " ").slice(0, 240);
  providerReason ??= reasonFromMessage(safeReason);
  return new GoogleHealthProviderError({
    httpStatus: response.status,
    providerStatus,
    providerReason,
    safeMessage: safeReason,
  });
}

export const googleHealthHttpTestHooks = {
  normalizedProviderReason,
  reasonFromMessage,
};
