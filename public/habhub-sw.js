/* HabHub's service worker handles standards-based Web Push only. The app's
 * offline data model remains authoritative; this worker deliberately avoids a
 * second, stale-prone application-shell cache. */

const DEFAULT_ROUTE = "/";
const ICON_PATH = "/pwa-icon-192.png";
// Android renders a Web Push badge as a monochrome alpha mask. Reusing the
// opaque app icon turns that mask into a featureless square.
const BADGE_PATH = "/habhub-notification-badge-96.png";
const WORKOUT_ACTIONS = new Set([
  "workout-next",
  "workout-pause",
  "workout-resume",
]);
const WORKOUT_ACTION_MESSAGE = "habhub:web-workout-notification-action";
const WORKOUT_ACTION_AVAILABLE_MESSAGE =
  "habhub:web-workout-notification-action-available";
const WORKOUT_ACTION_CONTROL_MESSAGE =
  "habhub:web-workout-notification-action-control";
const WORKOUT_ACTION_DATABASE = "habhub-web-workout-actions-v1";
const WORKOUT_ACTION_STORE = "actions";
const WORKOUT_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WORKOUT_ACTION_MAX_ITEMS = 30;
const WORKOUT_ACTION_MAX_DRAIN = 30;
const WORKOUT_ACTION_CLAIM_MS = 15_000;
let workoutActionDatabasePromise;

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

function validWorkoutActionToken(value) {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validWorkoutActionId(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function newWorkoutActionId(occurredAt) {
  if (typeof self.crypto?.randomUUID === "function")
    return `${occurredAt.toString(36)}-${self.crypto.randomUUID()}`;
  const bytes = new Uint32Array(2);
  self.crypto.getRandomValues(bytes);
  return `${occurredAt.toString(36)}-${[...bytes]
    .map((value) => value.toString(36))
    .join("-")}`;
}

function openWorkoutActionDatabase() {
  if (workoutActionDatabasePromise) return workoutActionDatabasePromise;
  workoutActionDatabasePromise = new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      reject(new Error("IndexedDB is unavailable in the service worker."));
      return;
    }
    let request;
    try {
      request = self.indexedDB.open(WORKOUT_ACTION_DATABASE, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WORKOUT_ACTION_STORE))
        request.result.createObjectStore(WORKOUT_ACTION_STORE, {
          keyPath: "id",
        });
    };
    request.onerror = () => {
      workoutActionDatabasePromise = undefined;
      reject(request.error ?? new Error("Workout action storage failed to open."));
    };
    request.onblocked = () => {
      workoutActionDatabasePromise = undefined;
      reject(new Error("Workout action storage is blocked."));
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        workoutActionDatabasePromise = undefined;
      };
      resolve(database);
    };
  });
  return workoutActionDatabasePromise;
}

function validStoredWorkoutAction(item, now) {
  return (
    item &&
    typeof item === "object" &&
    validWorkoutActionId(item.id) &&
    validWorkoutActionToken(item.actionToken) &&
    WORKOUT_ACTIONS.has(item.action) &&
    typeof item.occurredAt === "number" &&
    Number.isFinite(item.occurredAt) &&
    item.occurredAt >= now - WORKOUT_ACTION_MAX_AGE_MS &&
    item.occurredAt <= now + 60_000
  );
}

async function updateStoredWorkoutActions(update) {
  const database = await openWorkoutActionDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORKOUT_ACTION_STORE, "readwrite");
    const store = transaction.objectStore(WORKOUT_ACTION_STORE);
    const request = store.getAll();
    let result;
    request.onsuccess = () => {
      const now = Date.now();
      const current = request.result.filter((item) =>
        validStoredWorkoutAction(item, now),
      );
      const next = update(current, now);
      result = next.result;
      store.clear();
      for (const item of next.items.slice(-WORKOUT_ACTION_MAX_ITEMS))
        store.put(item);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Workout action storage was aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Workout action storage failed."));
  });
}

function storeWorkoutAction(item) {
  return updateStoredWorkoutActions((items) => ({
    items: [...items.filter((current) => current.id !== item.id), item].sort(
      (left, right) => left.occurredAt - right.occurredAt,
    ),
    result: undefined,
  }));
}

function claimStoredWorkoutActions(actionToken, claimId) {
  return updateStoredWorkoutActions((items, now) => {
    const available = items
      .filter(
        (item) =>
          item.actionToken === actionToken &&
          (!item.claimedUntil ||
            item.claimedUntil <= now ||
            item.claimedBy === claimId),
      )
      .slice(0, WORKOUT_ACTION_MAX_DRAIN);
    const claimedIds = new Set(available.map((item) => item.id));
    const claimedUntil = now + WORKOUT_ACTION_CLAIM_MS;
    const nextItems = items.map((item) =>
      claimedIds.has(item.id)
        ? { ...item, claimedBy: claimId, claimedUntil }
        : item,
    );
    const blockedUntil = items
      .filter(
        (item) =>
          item.actionToken === actionToken &&
          !claimedIds.has(item.id) &&
          typeof item.claimedUntil === "number" &&
          item.claimedUntil > now,
      )
      .reduce(
        (earliest, item) => Math.min(earliest, item.claimedUntil),
        Number.POSITIVE_INFINITY,
      );
    return {
      items: nextItems,
      result: {
        actions: available.map(({ id, action, occurredAt }) => ({
          id,
          action,
          occurredAt,
        })),
        retryAfterMs: Number.isFinite(blockedUntil)
          ? Math.max(250, blockedUntil - now + 50)
          : undefined,
      },
    };
  });
}

function acknowledgeStoredWorkoutActions(actionToken, actionIds) {
  const acknowledged = new Set(actionIds);
  return updateStoredWorkoutActions((items) => ({
    items: items.filter(
      (item) =>
        item.actionToken !== actionToken || !acknowledged.has(item.id),
    ),
    result: undefined,
  }));
}

function clearStoredWorkoutActions(actionToken) {
  return updateStoredWorkoutActions((items) => ({
    items: items.filter((item) => item.actionToken !== actionToken),
    result: undefined,
  }));
}

function sameOriginWindowClients() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windows) =>
      windows.filter((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      }),
    );
}

function notifyWorkoutActionAvailable(actionToken) {
  return sameOriginWindowClients().then((windows) => {
    for (const client of windows)
      client.postMessage({
        type: WORKOUT_ACTION_AVAILABLE_MESSAGE,
        actionToken,
      });
  });
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
      badge: BADGE_PATH,
      tag,
      renotify: false,
      data: { ...data, route },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification.data?.workoutTimer === true && event.action) {
    // A stale/unknown action is still an action-button click, so it must stay
    // silent too. Only the notification body (empty action) may navigate.
    if (!WORKOUT_ACTIONS.has(event.action)) return;
    const actionToken = event.notification.data?.workoutActionToken;
    // Action buttons are controls, not navigation. Persist before notifying a
    // client so a killed/evicted PWA can drain the exact tap during its next
    // workout hydration without ever opening or focusing a window here.
    if (!validWorkoutActionToken(actionToken)) return;
    const occurredAt = Date.now();
    const queuedAction = {
      id: newWorkoutActionId(occurredAt),
      action: event.action,
      occurredAt,
      actionToken,
    };
    event.waitUntil(
      storeWorkoutAction(queuedAction).then(() =>
        notifyWorkoutActionAvailable(actionToken),
      ),
    );
    return;
  }
  event.notification.close();
  // A notification-body click is navigation: open/focus the workout (or the
  // route supplied by another notification type) exactly as before.
  const route = safeRoute(event.notification.data?.route);
  const target = new URL(route, self.location.origin);
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

self.addEventListener("message", (event) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    message.type !== WORKOUT_ACTION_CONTROL_MESSAGE ||
    !validWorkoutActionToken(message.actionToken)
  )
    return;
  if (message.operation === "drain") {
    if (
      !validWorkoutActionId(message.requestId) ||
      !event.source ||
      typeof event.source.postMessage !== "function"
    )
      return;
    const source = event.source;
    event.waitUntil(
      claimStoredWorkoutActions(message.actionToken, message.requestId).then(
        ({ actions, retryAfterMs }) =>
          source.postMessage({
            type: WORKOUT_ACTION_MESSAGE,
            actionToken: message.actionToken,
            requestId: message.requestId,
            actions,
            retryAfterMs,
          }),
      ),
    );
    return;
  }
  if (message.operation === "ack") {
    const actionIds = Array.isArray(message.actionIds)
      ? [...new Set(message.actionIds.filter(validWorkoutActionId))].slice(
          0,
          WORKOUT_ACTION_MAX_DRAIN,
        )
      : [];
    if (!actionIds.length) return;
    event.waitUntil(
      acknowledgeStoredWorkoutActions(message.actionToken, actionIds),
    );
    return;
  }
  if (message.operation === "clear")
    event.waitUntil(clearStoredWorkoutActions(message.actionToken));
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
