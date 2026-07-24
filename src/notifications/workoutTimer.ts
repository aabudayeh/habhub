import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

export const WORKOUT_TIMER_CATEGORY = "metricrally-workout-timer";
const WORKOUT_TIMER_LAST_CATEGORY = "metricrally-workout-timer-last";
export const WORKOUT_TIMER_NOTIFICATION = "metricrally-workout-timer-live";
export const WORKOUT_TIMER_NEXT = "workout-next";
export const WORKOUT_TIMER_PAUSE = "workout-pause";
export const WORKOUT_TIMER_FINISH = "workout-finish";

const WORKOUT_TIMER_TASK = "metricrally-workout-notification-actions";
const WORKOUT_TIMER_FLOW_KEY = "metricrally-workout-notification-flow-v1";
const WORKOUT_TIMER_ACTIONS_KEY = "metricrally-workout-notification-actions-v1";

export type WorkoutNotificationStep = {
  title: string;
  body: string;
  phase: "work" | "rest";
};

export type QueuedWorkoutTimerAction = {
  action:
    | typeof WORKOUT_TIMER_NEXT
    | typeof WORKOUT_TIMER_PAUSE
    | typeof WORKOUT_TIMER_FINISH;
  occurredAt: number;
};

type StoredWorkoutFlow = {
  steps: WorkoutNotificationStep[];
  index: number;
  paused: boolean;
};

let configured = false;

async function readFlow() {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_FLOW_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as StoredWorkoutFlow;
    return parsed.steps?.length ? parsed : null;
  } catch {
    return null;
  }
}

async function saveFlow(flow: StoredWorkoutFlow) {
  await AsyncStorage.setItem(WORKOUT_TIMER_FLOW_KEY, JSON.stringify(flow));
}

async function queueAction(action: QueuedWorkoutTimerAction["action"]) {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_ACTIONS_KEY);
  let current: QueuedWorkoutTimerAction[] = [];
  try {
    current = stored ? (JSON.parse(stored) as QueuedWorkoutTimerAction[]) : [];
  } catch {
    current = [];
  }
  current.push({ action, occurredAt: Date.now() });
  await AsyncStorage.setItem(
    WORKOUT_TIMER_ACTIONS_KEY,
    JSON.stringify(current.slice(-30)),
  );
}

async function presentFlow(flow: StoredWorkoutFlow) {
  const step = flow.steps[Math.min(flow.index, flow.steps.length - 1)];
  if (!step) return;
  const phase = flow.paused ? "paused" : step.phase;
  const phaseLabel =
    phase === "paused" ? "PAUSED" : phase === "work" ? "WORK" : "REST";
  const hasNext = !flow.paused && flow.index < flow.steps.length - 1;
  await Notifications.dismissNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: WORKOUT_TIMER_NOTIFICATION,
    content: {
      title: `${phaseLabel} · ${step.title}`,
      body: step.body,
      data: { route: "/gym", workoutTimer: true },
      categoryIdentifier: hasNext
        ? WORKOUT_TIMER_CATEGORY
        : WORKOUT_TIMER_LAST_CATEGORY,
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

if (
  Platform.OS === "android" &&
  !TaskManager.isTaskDefined(WORKOUT_TIMER_TASK)
) {
  TaskManager.defineTask(WORKOUT_TIMER_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const payload = data as Record<string, unknown>;
    const nested =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : payload;
    const action = nested.actionIdentifier;
    if (action !== WORKOUT_TIMER_NEXT && action !== WORKOUT_TIMER_PAUSE)
      return;
    const flow = await readFlow();
    if (!flow) return;
    await queueAction(action);
    if (action === WORKOUT_TIMER_PAUSE) flow.paused = !flow.paused;
    else if (!flow.paused && flow.index < flow.steps.length - 1)
      flow.index += 1;
    await saveFlow(flow);
    await presentFlow(flow);
  });
}

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
      options: { opensAppToForeground: false },
    },
    {
      identifier: WORKOUT_TIMER_PAUSE,
      buttonTitle: "Pause / resume",
      options: { opensAppToForeground: false },
    },
  ]);
  await Notifications.setNotificationCategoryAsync(
    WORKOUT_TIMER_LAST_CATEGORY,
    [
      {
        identifier: WORKOUT_TIMER_FINISH,
        buttonTitle: "Finish workout",
        options: { opensAppToForeground: true },
      },
      {
        identifier: WORKOUT_TIMER_PAUSE,
        buttonTitle: "Pause / resume",
        options: { opensAppToForeground: false },
      },
    ],
  );
  if (Platform.OS === "android")
    await Notifications.registerTaskAsync(WORKOUT_TIMER_TASK).catch(
      () => undefined,
    );
  configured = true;
}

export async function showWorkoutTimerNotification({
  title,
  body,
  phase,
  steps,
}: {
  title: string;
  body: string;
  phase: "work" | "rest" | "paused";
  steps?: WorkoutNotificationStep[];
}) {
  if (Platform.OS === "web") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await configureWorkoutTimerNotification();
  const flow: StoredWorkoutFlow = {
    steps:
      steps?.length
        ? steps
        : [{ title, body, phase: phase === "work" ? "work" : "rest" }],
    index: 0,
    paused: phase === "paused",
  };
  await saveFlow(flow);
  await presentFlow(flow);
}

export async function consumeWorkoutTimerActions() {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_ACTIONS_KEY);
  await AsyncStorage.removeItem(WORKOUT_TIMER_ACTIONS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as QueuedWorkoutTimerAction[];
  } catch {
    return [];
  }
}

export async function dismissWorkoutTimerNotification(clearState = false) {
  if (Platform.OS === "web") return;
  await Notifications.dismissNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(
    WORKOUT_TIMER_NOTIFICATION,
  ).catch(() => undefined);
  if (clearState) {
    await AsyncStorage.multiRemove([
      WORKOUT_TIMER_FLOW_KEY,
      WORKOUT_TIMER_ACTIONS_KEY,
    ]);
  }
}
