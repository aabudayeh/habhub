import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const WORKOUT_TIMER_CATEGORY = "metricrally-workout-timer";
export const WORKOUT_TIMER_NOTIFICATION = "metricrally-workout-timer-live";
export const WORKOUT_TIMER_NEXT = "workout-next";
export const WORKOUT_TIMER_PAUSE = "workout-pause";
export const WORKOUT_TIMER_FINISH = "workout-finish";

let configured = false;

export async function configureWorkoutTimerNotification() {
  if (Platform.OS === "web" || configured) return;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("workout-timer", {
      name: "Live workout timer",
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      sound: null,
      showBadge: false,
    });
  await Notifications.setNotificationCategoryAsync(WORKOUT_TIMER_CATEGORY, [
    {
      identifier: WORKOUT_TIMER_NEXT,
      buttonTitle: "Next",
      options: { opensAppToForeground: true },
    },
    {
      identifier: WORKOUT_TIMER_PAUSE,
      buttonTitle: "Pause / resume",
      options: { opensAppToForeground: true },
    },
    {
      identifier: WORKOUT_TIMER_FINISH,
      buttonTitle: "Finish",
      options: { opensAppToForeground: true, isDestructive: true },
    },
  ]);
  configured = true;
}

export async function showWorkoutTimerNotification({
  title,
  body,
  phase,
}: {
  title: string;
  body: string;
  phase: "work" | "rest" | "paused";
}) {
  if (Platform.OS === "web") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await configureWorkoutTimerNotification();
  await Notifications.dismissNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: WORKOUT_TIMER_NOTIFICATION,
    content: {
      title,
      body,
      data: { route: "/gym", workoutTimer: true },
      categoryIdentifier: WORKOUT_TIMER_CATEGORY,
      sticky: Platform.OS === "android",
      autoDismiss: false,
      color:
        phase === "work"
          ? "#A7F432"
          : phase === "paused"
            ? "#D95852"
            : "#E9A23B",
    },
    trigger: null,
  });
}

export async function dismissWorkoutTimerNotification() {
  if (Platform.OS === "web") return;
  await Notifications.dismissNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
}
