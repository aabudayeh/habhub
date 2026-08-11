export const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "The account service is temporarily unavailable. Please try again shortly.";

const AUTH_ATTEMPT_FALLBACK = "The sign-in attempt did not finish.";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (!error || typeof error !== "object") return AUTH_ATTEMPT_FALLBACK;
  const record = error as Record<string, unknown>;
  for (const key of ["message", "error_description", "description", "body"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return AUTH_ATTEMPT_FALLBACK;
}

function numericStatus(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== "object" || depth > 2) return null;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d{3}$/.test(value.trim()))
      return Number(value);
  }
  return numericStatus(record.cause, depth + 1);
}

/** Keeps gateway error pages and service codes out of account-facing UI. */
export function isAuthServiceUnavailableError(error: unknown): boolean {
  if (numericStatus(error) === 521) return true;
  const message = errorMessage(error);
  return (
    /<(?:!doctype|html|head|body)\b/i.test(message) ||
    /\b(?:error\s*(?:code)?|status)\s*:?\s*521\b/i.test(message) ||
    /\b521\s*:\s*web server is down\b/i.test(message) ||
    /\bweb server is down\b/i.test(message)
  );
}

/** Returns an English catalog key; the calling AppText/LocalizedAlert localizes it. */
export function readableAuthError(error: unknown): string {
  if (isAuthServiceUnavailableError(error))
    return AUTH_SERVICE_UNAVAILABLE_MESSAGE;
  const message = errorMessage(error);
  if (/network request failed|failed to fetch|networkerror/i.test(message))
    return "HabHub could not reach the account service. Check your connection and try again.";
  if (/code verifier|flow state|expired/i.test(message))
    return "This sign-in attempt expired. Start Google sign-in again.";
  if (/cancel/i.test(message))
    return "Google sign-in was cancelled before HabHub received your account.";
  return message;
}
