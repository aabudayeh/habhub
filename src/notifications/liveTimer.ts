import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { NativeModules, Platform } from "react-native";

const ACTIVITY_TIMER_CHANNEL = "activity-timer";
const ACTIVITY_TIMER_IDS_KEY = "habhub-live-activity-notification-ids-v1";
const WEB_ACTIVITY_TIMER_TAG_PREFIX = "habhub-activity-timer-live-";

type AndroidTimerEnhancer = {
  enhanceTimerNotification?: (
    identifier: string,
    mode: "elapsed" | "countdown" | "paused",
    referenceTime: number,
    timeoutAt: number,
    expectedTitle: string,
  ) => Promise<boolean>;
};

type LiveTimerMode = "elapsed" | "countdown" | "paused";

export type LiveActivityTimerNotification = {
  id: string;
  title: string;
  body: string;
  mode: LiveTimerMode;
  /** Timer origin for elapsed, target end for countdown. */
  referenceTime: number;
  /** Optional countdown end; Android removes the live row at zero. */
  timeoutAt?: number;
  route: string;
  color?: string;
};

let activityChannelReady = false;
let activityNotificationUpdate = Promise.resolve();
let activityNotificationRevision = 0;
let activityNotificationsSuspended = true;
let activityNotificationOwnerId: string | undefined;

const enhancer = () =>
  NativeModules.HabHubAndroid as AndroidTimerEnhancer | undefined;

export async function enhanceAndroidTimerNotification(
  identifier: string,
  mode: LiveTimerMode,
  referenceTime: number,
  timeoutAt = 0,
  expectedTitle = "",
) {
  if (Platform.OS !== "android") return false;
  return (
    (await enhancer()
      ?.enhanceTimerNotification?.(
        identifier,
        mode,
        referenceTime,
        timeoutAt,
        expectedTitle,
      )
      .catch(() => false)) ?? false
  );
}

async function ensureActivityTimerChannel() {
  if (Platform.OS !== "android" || activityChannelReady) return;
  await Notifications.setNotificationChannelAsync(ACTIVITY_TIMER_CHANNEL, {
    name: "Live activity timers",
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: [0],
    sound: null,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  activityChannelReady = true;
}

const notificationId = (timerId: string) =>
  `habhub-activity-timer-live-${timerId}`;

function webActivityTimerNotificationsSupported() {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "Notification" in window
  );
}

function webActivityTimerDocumentHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState !== "visible"
  );
}

async function webActivityTimerServiceWorker(create: boolean) {
  if (!webActivityTimerNotificationsSupported()) return undefined;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active || !create) return existing;
  const registration =
    existing ??
    (await navigator.serviceWorker.register("/habhub-sw.js", {
      scope: "/",
      updateViaCache: "none",
    }));
  return registration.active ? registration : navigator.serviceWorker.ready;
}

function isWebActivityTimerNotification(notification: Notification) {
  return (
    notification.tag.startsWith(WEB_ACTIVITY_TIMER_TAG_PREFIX) ||
    notification.data?.activityTimer === true
  );
}

async function syncWebActivityTimerNotificationsNow(
  timers: LiveActivityTimerNotification[],
  ownerId: string,
  shouldContinue: () => boolean,
) {
  if (!webActivityTimerNotificationsSupported() || !shouldContinue()) return;
  const canPresent =
    window.Notification.permission === "granted" &&
    webActivityTimerDocumentHidden();
  const nextTimers = canPresent ? timers : [];
  const registration = await webActivityTimerServiceWorker(
    nextTimers.length > 0,
  );
  if (!registration || !shouldContinue()) return;

  const nextTags = new Set(nextTimers.map((timer) => notificationId(timer.id)));
  const presented = (await registration.getNotifications()).filter(
    isWebActivityTimerNotification,
  );
  if (!shouldContinue()) return;
  presented
    .filter((notification) => !nextTags.has(notification.tag))
    .forEach((notification) => notification.close());

  const installedTags: string[] = [];
  for (const timer of nextTimers) {
    if (!shouldContinue()) break;
    const tag = notificationId(timer.id);
    const options: NotificationOptions & {
      renotify: boolean;
      timestamp: number;
    } = {
      body: timer.body,
      icon: "/pwa-icon-192.png",
      badge: "/habhub-notification-badge-96.png",
      tag,
      timestamp: timer.referenceTime,
      requireInteraction: true,
      renotify: false,
      data: {
        route: timer.route,
        activityTimer: true,
        timerId: timer.id,
        ownerId,
      },
    };
    try {
      await registration.showNotification(timer.title, options);
      installedTags.push(tag);
    } catch {
      // A browser may revoke permission while this hidden-page update is in
      // flight. Other timers and the serialized cleanup fence must continue.
    }
  }
  if (shouldContinue()) return;
  const lateNotifications = await registration.getNotifications();
  lateNotifications
    .filter((notification) => installedTags.includes(notification.tag))
    .forEach((notification) => notification.close());
}

async function dismissWebActivityTimerNotificationsNow() {
  if (!webActivityTimerNotificationsSupported()) return;
  const registration = await webActivityTimerServiceWorker(false);
  if (!registration) return;
  const notifications = await registration.getNotifications();
  notifications
    .filter(isWebActivityTimerNotification)
    .forEach((notification) => notification.close());
}

async function readPresentedIds() {
  try {
    const stored = await AsyncStorage.getItem(ACTIVITY_TIMER_IDS_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Mirrors every running/paused activity timer into Android's notification
 * shade or a hidden PWA's persistent service-worker notifications. Native iOS
 * intentionally does nothing: a genuinely ticking surface requires an
 * ActivityKit Live Activity extension and Apple provisioning; the existing
 * completion and elapsed-time alerts remain in place.
 */
async function syncLiveActivityTimerNotificationsNow(
  timers: LiveActivityTimerNotification[],
  ownerId: string,
  shouldContinue: () => boolean,
) {
  if (Platform.OS === "web") {
    await syncWebActivityTimerNotificationsNow(
      timers,
      ownerId,
      shouldContinue,
    );
    return;
  }
  if (Platform.OS !== "android") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted || !shouldContinue()) return;
  await ensureActivityTimerChannel();
  if (!shouldContinue()) return;

  const nextIds = timers.map((timer) => notificationId(timer.id));
  const previousIds = await readPresentedIds();
  await Promise.all(
    previousIds
      .filter((identifier) => !nextIds.includes(identifier))
      .map((identifier) =>
        Notifications.dismissNotificationAsync(identifier).catch(
          () => undefined,
        ),
      ),
  );

  const installedIds = (
    await Promise.all(
      timers.map(async (timer) => {
        if (!shouldContinue()) return;
        const identifier = notificationId(timer.id);
        try {
          await Notifications.scheduleNotificationAsync({
            identifier,
            content: {
              title: timer.title,
              body: timer.body,
              data: {
                route: timer.route,
                accountId: ownerId,
                activityTimer: true,
                timerId: timer.id,
              },
              sticky: false,
              autoDismiss: false,
              priority: Notifications.AndroidNotificationPriority.LOW,
              color: timer.color,
            },
            trigger: { channelId: ACTIVITY_TIMER_CHANNEL },
          });
        } catch {
          return;
        }
        if (!shouldContinue()) {
          await Notifications.dismissNotificationAsync(identifier).catch(
            () => undefined,
          );
          return;
        }
        await enhanceAndroidTimerNotification(
          identifier,
          timer.mode,
          timer.referenceTime,
          timer.timeoutAt,
          timer.title,
        );
        if (!shouldContinue()) {
          await Notifications.dismissNotificationAsync(identifier).catch(
            () => undefined,
          );
          return;
        }
        return identifier;
      }),
    )
  ).filter((identifier): identifier is string => Boolean(identifier));
  if (!shouldContinue()) {
    // Cleanup can suspend this queue while an Expo scheduling promise is in
    // flight. Those late rows were never persisted, so dismiss them directly
    // before allowing the serialized cleanup operation to continue.
    await Promise.all(
      installedIds.map((identifier) =>
        Notifications.dismissNotificationAsync(identifier).catch(
          () => undefined,
        ),
      ),
    );
    return;
  }
  await AsyncStorage.setItem(ACTIVITY_TIMER_IDS_KEY, JSON.stringify(nextIds));
}

export function syncLiveActivityTimerNotifications(
  timers: LiveActivityTimerNotification[],
  ownerId: string,
) {
  if (
    activityNotificationsSuspended ||
    activityNotificationOwnerId !== ownerId
  )
    return Promise.resolve();
  const revision = ++activityNotificationRevision;
  const update = activityNotificationUpdate.then(() =>
    syncLiveActivityTimerNotificationsNow(
      timers,
      ownerId,
      () =>
        !activityNotificationsSuspended &&
        activityNotificationOwnerId === ownerId &&
        activityNotificationRevision === revision,
    ),
  );
  activityNotificationUpdate = update.catch(() => undefined);
  return update;
}

async function dismissLiveActivityTimerNotificationsNow() {
  if (Platform.OS === "web") {
    await dismissWebActivityTimerNotificationsNow();
    return;
  }
  if (Platform.OS !== "android") return;
  const identifiers = await readPresentedIds();
  await Promise.all(
    identifiers.map((identifier) =>
      Notifications.dismissNotificationAsync(identifier).catch(
        () => undefined,
      ),
    ),
  );
  await AsyncStorage.removeItem(ACTIVITY_TIMER_IDS_KEY);
}

export function dismissLiveActivityTimerNotifications(ownerId: string) {
  if (
    activityNotificationsSuspended ||
    activityNotificationOwnerId !== ownerId
  )
    return Promise.resolve();
  ++activityNotificationRevision;
  const update = activityNotificationUpdate.then(() =>
    dismissLiveActivityTimerNotificationsNow(),
  );
  activityNotificationUpdate = update.catch(() => undefined);
  return update;
}

export function resumeLiveActivityTimerNotifications(ownerId: string) {
  activityNotificationOwnerId = ownerId;
  activityNotificationsSuspended = false;
}

/** Sign-out/master-off fence for the separate Android live-timer queue. */
export function clearLiveActivityTimerNotifications() {
  activityNotificationsSuspended = true;
  activityNotificationOwnerId = undefined;
  ++activityNotificationRevision;
  const update = activityNotificationUpdate.then(() =>
    dismissLiveActivityTimerNotificationsNow(),
  );
  activityNotificationUpdate = update.catch(() => undefined);
  return update;
}
