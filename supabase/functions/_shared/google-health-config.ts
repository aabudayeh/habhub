export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
] as const;

export type GoogleHealthConfig = {
  clientId: string;
  clientSecret: string;
  oauthRedirectUri: string;
  webOrigin: string;
  allowedRedirectOrigins: Set<string>;
};

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function httpsOrigin(raw: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error(`${name} must use HTTPS without embedded credentials`);
  return parsed.origin;
}

export function googleHealthConfig(): GoogleHealthConfig {
  const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
  const oauthRedirectUri =
    Deno.env.get("GOOGLE_HEALTH_OAUTH_REDIRECT_URI")?.trim() ||
    `${supabaseUrl}/functions/v1/google-health/oauth/callback`;
  const redirect = new URL(oauthRedirectUri);
  const expectedRedirectUri = `${supabaseUrl}/functions/v1/google-health/oauth/callback`;
  if (
    redirect.protocol !== "https:" ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.toString() !== expectedRedirectUri
  ) throw new Error(
    "GOOGLE_HEALTH_OAUTH_REDIRECT_URI must exactly match the Supabase google-health callback",
  );
  const webOrigin = httpsOrigin(
    Deno.env.get("GOOGLE_HEALTH_WEB_ORIGIN")?.trim() || "https://habhub.expo.app",
    "GOOGLE_HEALTH_WEB_ORIGIN",
  );
  const configuredOrigins =
    Deno.env.get("GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS")
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  return {
    clientId: required("GOOGLE_HEALTH_CLIENT_ID"),
    clientSecret: required("GOOGLE_HEALTH_CLIENT_SECRET"),
    oauthRedirectUri,
    webOrigin,
    allowedRedirectOrigins: new Set([
      webOrigin,
      ...configuredOrigins.map((origin) => httpsOrigin(origin, "GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS")),
    ]),
  };
}

export function safeReturnTo(requested: unknown, config: GoogleHealthConfig) {
  const fallback = `${config.webOrigin}/settings`;
  if (typeof requested !== "string" || requested.length > 2048) return fallback;
  try {
    const parsed = new URL(requested);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !config.allowedRedirectOrigins.has(parsed.origin) ||
      !["/settings", "/settings/"].includes(parsed.pathname)
    )
      return fallback;
    // OAuth completion is allowed to return only to the Settings screen. Do
    // not preserve caller-controlled path, query, or fragment material.
    return `${parsed.origin}/settings`;
  } catch {
    return fallback;
  }
}

export function callbackLocation(
  returnTo: string,
  result: "connected" | "error",
  reason?: string,
) {
  const url = new URL(returnTo);
  url.searchParams.set("google_health", result);
  if (reason) url.searchParams.set("reason", reason);
  else url.searchParams.delete("reason");
  return url.toString();
}
