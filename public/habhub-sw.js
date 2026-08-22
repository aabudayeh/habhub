/* HabHub's service worker handles standards-based Web Push only. The app's
 * offline data model remains authoritative; this worker deliberately avoids a
 * second, stale-prone application-shell cache. */

const DEFAULT_ROUTE = "/";
const ICON_PATH = "/pwa-icon-192.png";
const WORKOUT_ACTIONS = new Set(["workout-next", "workout-pause"]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function safePayload(event) {
  try {
    const value = event.data?.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function safeRoute(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_ROUTE;
  try {
    const target = new URL(value, self.location.origin);
    return target.origin === self.location.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : DEFAULT_ROUTE;
  } catch {
    return DEFAULT_ROUTE;
  }
}

function routeWithParameters(data) {
  const route = safeRoute(data?.route);
  const target = new URL(route, self.location.origin);
  if (!target.search) {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (
        key === "route" ||
        key.length > 80 ||
        !["string", "number", "boolean"].includes(typeof value)
      )
        continue;
      target.searchParams.set(key, String(value).slice(0, 500));
    }
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

self.addEventListener("push", (event) => {
  const payload = safePayload(event);
  const data =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim().slice(0, 120)
      : "HabHub";
  const body =
    typeof payload.body === "string" ? payload.body.trim().slice(0, 220) : "";
  const route = routeWithParameters(data);
  const tag =
    typeof payload.tag === "string" ? payload.tag.slice(0, 120) : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON_PATH,
      badge: ICON_PATH,
      tag,
      renotify: false,
      data: { ...data, route },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = safeRoute(event.notification.data?.route);
  const target = new URL(route, self.location.origin);
  if (
    event.notification.data?.workoutTimer === true &&
    WORKOUT_ACTIONS.has(event.action)
  ) {
    target.searchParams.set("workoutAction", event.action);
    target.searchParams.set("workoutActionAt", String(Date.now()));
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const sameOrigin = windows.filter((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });
        for (const current of sameOrigin) {
          try {
            const navigated =
              "navigate" in current
                ? await current.navigate(target.href)
                : current;
            if (navigated && "focus" in navigated)
              return await navigated.focus();
            if ("focus" in current) return await current.focus();
          } catch {
            // A suspended/stale PWA client can reject navigate/focus. Try the
            // next client and finally open a fresh window instead of turning a
            // notification tap into a no-op.
          }
        }
        return self.clients.openWindow(target.href);
      }),
  );
});

// Browsers can rotate a subscription independently of the app. An active
// client immediately repairs the private server row; a closed app repairs it
// during the next foreground/open without putting an auth session in the SW.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) =>
        Promise.all(
          windows.map((client) =>
            client.postMessage({
              type: "habhub:web-push-subscription-changed",
            }),
          ),
        ),
      ),
  );
});
