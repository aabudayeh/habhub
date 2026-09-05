const EXACT_WEB_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

function hostnameInSuffix(hostname: string, suffix: string) {
  return hostname.endsWith(`.${suffix}`);
}

/**
 * PushSubscription endpoints are bearer capabilities, but they are still
 * untrusted URLs supplied by a client. Restrict server-side delivery to the
 * browser push services HabHub supports so the Edge worker cannot be used as
 * an authenticated SSRF proxy.
 */
export function isAllowedWebPushEndpoint(value: string) {
  if (!value || value !== value.trim() || /\s/.test(value)) return false;
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      (endpoint.port && endpoint.port !== "443") ||
      hostname.endsWith(".")
    )
      return false;
    return (
      EXACT_WEB_PUSH_HOSTS.has(hostname) ||
      hostnameInSuffix(hostname, "push.apple.com") ||
      hostname === "notify.windows.com" ||
      hostnameInSuffix(hostname, "notify.windows.com")
    );
  } catch {
    return false;
  }
}
