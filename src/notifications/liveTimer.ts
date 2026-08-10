import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { NativeModules, Platform } from "react-native";

const ACTIVITY_TIMER_CHANNEL = "activity-timer";
const ACTIVITY_TIMER_IDS_KEY = "habhub-live-activity-notification-ids-v1";

type AndroidTimerEnhancer = {
  enhanceTimerNotification?: (
    identifier: string,
    mode: "elapsed" | "countdown" | "paused",
    referenceTime: number,
    timeoutAt: number,
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

const enhancer = () =>
  NativeModules.HabHubAndroid as AndroidTimerEnhancer | undefined;

export async function enhanceAndroidTimerNotification(
  identifier: string,
  mode: LiveTimerMode,
  referenceTime: number,
  timeoutAt = 0,
) {
  if (Platform.OS !== "android") return false;
  return (
    (await enhancer()
      ?.enhanceTimerNotification?.(
        identifier,
        mode,
        referenceTime,
        timeoutAt,
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
 * shade. On iOS this intentionally does nothing: a genuinely ticking surface
 * requires an ActivityKit Live Activity extension and Apple provisioning;
 * the existing completion and elapsed-time alerts remain in place.
 */
async function syncLiveActivityTimerNotificationsNow(
  timers: LiveActivityTimerNotification[],
) {
  if (Platform.OS !== "android") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureActivityTimerChannel();

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

  await Promise.all(
    timers.map(async (timer) => {
      const identifier = notificationId(timer.id);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: timer.title,
          body: timer.body,
          data: { route: timer.route, activityTimer: true, timerId: timer.id },
          sticky: false,
          autoDismiss: false,
          priority: Notifications.AndroidNotificationPriority.LOW,
          color: timer.color,
        },
        trigger: { channelId: ACTIVITY_TIMER_CHANNEL },
      });
      await enhanceAndroidTimerNotification(
        identifier,
        timer.mode,
        timer.referenceTime,
        timer.timeoutAt,
      );
    }),
  );
  await AsyncStorage.setItem(ACTIVITY_TIMER_IDS_KEY, JSON.stringify(nextIds));
}

export function syncLiveActivityTimerNotifications(
  timers: LiveActivityTimerNotification[],
) {
  const update = activityNotificationUpdate.then(() =>
    syncLiveActivityTimerNotificationsNow(timers),
  );
  activityNotificationUpdate = update.catch(() => undefined);
  return update;
}

async function dismissLiveActivityTimerNotificationsNow() {
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

export function dismissLiveActivityTimerNotifications() {
  const update = activityNotificationUpdate.then(() =>
    dismissLiveActivityTimerNotificationsNow(),
  );
  activityNotificationUpdate = update.catch(() => undefined);
  return update;
}
