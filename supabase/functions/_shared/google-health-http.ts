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

export async function googleError(response: Response) {
  let reason = "";
  try {
    const payload = await response.json() as {
      error?: { status?: unknown; message?: unknown } | unknown;
      error_description?: unknown;
    };
    if (payload.error && typeof payload.error === "object") {
      const providerError = payload.error as { message?: unknown; status?: unknown };
      reason = String(providerError.message ?? providerError.status ?? "");
    }
    else reason = String(payload.error_description ?? payload.error ?? "");
  } catch {
    reason = "";
  }
  const safeReason = reason.replace(/[\r\n]+/g, " ").slice(0, 240);
  return new Error(`Google Health request failed (${response.status})${safeReason ? `: ${safeReason}` : ""}`);
}
