import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { translateUiText } from "@/src/i18n";
import type { AppLanguage } from "@/src/types";

/**
 * Never rely on Expo's fallback Android channel for user-created alarms. A
 * fresh channel ID also escapes an OEM-muted fallback left by an older APK.
 */
export const LOCAL_REMINDERS_CHANNEL_ID = "habhub-reminders-v1";
export const LOCAL_TIMER_ALERTS_CHANNEL_ID = "habhub-timer-alerts-v1";

let localChannelsReady: Promise<void> | undefined;

export function ensureLocalNotificationChannels(
  language: AppLanguage = "en",
) {
  if (Platform.OS !== "android") return Promise.resolve();
  if (localChannelsReady) return localChannelsReady;
  localChannelsReady = Promise.all([
    Notifications.setNotificationChannelAsync(LOCAL_REMINDERS_CHANNEL_ID, {
      name: translateUiText(language, "Reminders and personal alerts"),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 200, 120, 200],
      sound: "default",
      showBadge: true,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
    Notifications.setNotificationChannelAsync(LOCAL_TIMER_ALERTS_CHANNEL_ID, {
      name: translateUiText(language, "Timer alerts"),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 120, 250],
      sound: "default",
      showBadge: false,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
  ]).then(() => undefined);
  localChannelsReady.catch(() => {
    localChannelsReady = undefined;
  });
  return localChannelsReady;
}

export function immediateLocalNotificationTrigger(
  channelId = LOCAL_REMINDERS_CHANNEL_ID,
): Notifications.NotificationTriggerInput {
  return Platform.OS === "android" ? { channelId } : null;
}

export function dateLocalNotificationTrigger(
  date: Date,
  channelId = LOCAL_REMINDERS_CHANNEL_ID,
): Notifications.DateTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date,
    ...(Platform.OS === "android" ? { channelId } : {}),
  };
}

export function intervalLocalNotificationTrigger(
  seconds: number,
  channelId = LOCAL_TIMER_ALERTS_CHANNEL_ID,
): Notifications.TimeIntervalTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds,
    ...(Platform.OS === "android" ? { channelId } : {}),
  };
}
