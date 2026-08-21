export type GoogleHealthCompletionFragment = {
  present: boolean;
  token: string | null;
};

export function parseGoogleHealthCompletionFragment(
  hash: string,
): GoogleHealthCompletionFragment {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  if (params.get("google_health") !== "pending")
    return { present: false, token: null };
  return { present: true, token: params.get("completion") };
}

export function isGoogleHealthCompletionToken(
  value: string | null | undefined,
): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,512}$/.test(value));
}
