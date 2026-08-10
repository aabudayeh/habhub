import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { enhanceAndroidTimerNotification } from "@/src/notifications/liveTimer";

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
  phaseStartedAt: number;
  phaseElapsedMs: number;
};

let configured = false;
let pendingFlowAction = Promise.resolve();

async function readFlow() {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_FLOW_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredWorkoutFlow>;
    return parsed.steps?.length
      ? {
          steps: parsed.steps,
          index: parsed.index ?? 0,
          paused: parsed.paused ?? false,
          phaseStartedAt: parsed.phaseStartedAt ?? Date.now(),
          phaseElapsedMs: parsed.phaseElapsedMs ?? 0,
        }
      : null;
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
  // Reusing the same identifier updates the phone notification in place. Do
  // not dismiss/repost: that introduces visible gaps and delays Wear OS
  // notification bridging.
  const identifier = await Notifications.scheduleNotificationAsync({
    identifier: WORKOUT_TIMER_NOTIFICATION,
    content: {
      title: `${phaseLabel} · ${step.title}`,
      body: flow.paused
        ? `Paused at ${formatElapsedMs(flow.phaseElapsedMs)} · ${step.body}`
        : step.body,
      data: { route: "/gym", workoutTimer: true },
      categoryIdentifier: hasNext
        ? WORKOUT_TIMER_CATEGORY
        : WORKOUT_TIMER_LAST_CATEGORY,
      // Ongoing/sticky phone notifications are not bridged to paired Wear OS
      // devices. A normal notification preserves the standard action bridge.
      sticky: false,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color:
        phase === "work"
          ? "#A7F432"
          : phase === "paused"
            ? "#D95852"
            : "#E9A23B",
    },
    trigger: Platform.OS === "android" ? { channelId: "workout-timer" } : null,
  });
  if (Platform.OS === "android") {
    const phaseOrigin = flow.phaseStartedAt - flow.phaseElapsedMs;
    await enhanceAndroidTimerNotification(
      identifier,
      flow.paused ? "paused" : "elapsed",
      phaseOrigin,
    );
  }
}

function formatElapsedMs(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function sameSteps(
  left: WorkoutNotificationStep[],
  right: WorkoutNotificationStep[],
) {
  return (
    left.length === right.length &&
    left.every(
      (step, index) =>
        step.title === right[index]?.title &&
        step.body === right[index]?.body &&
        step.phase === right[index]?.phase,
    )
  );
}

async function applyFlowAction(action: QueuedWorkoutTimerAction["action"]) {
  const flow = await readFlow();
  if (!flow) return;
  const occurredAt = Date.now();
  if (action === WORKOUT_TIMER_FINISH) {
    await queueAction(action);
    return;
  }
  if (action === WORKOUT_TIMER_PAUSE) {
    if (flow.paused) {
      flow.paused = false;
      flow.phaseStartedAt = occurredAt;
    } else {
      flow.phaseElapsedMs += Math.max(0, occurredAt - flow.phaseStartedAt);
      flow.paused = true;
      flow.phaseStartedAt = occurredAt;
    }
  } else if (!flow.paused && flow.index < flow.steps.length - 1) {
    flow.index += 1;
    flow.phaseStartedAt = occurredAt;
    flow.phaseElapsedMs = 0;
  }

  // Commit before rendering so the lock-screen notification and replay queue
  // always describe the same transition, including the first background tap.
  await saveFlow(flow);
  await queueAction(action);
  await presentFlow(flow);
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
    if (
      action !== WORKOUT_TIMER_NEXT &&
      action !== WORKOUT_TIMER_PAUSE &&
      action !== WORKOUT_TIMER_FINISH
    )
      return;
    const actionRun = pendingFlowAction.then(() => applyFlowAction(action));
    // Keep rapid lock-screen actions ordered even if one notification update
    // fails, so the next tap still starts from the committed flow.
    pendingFlowAction = actionRun.catch(() => undefined);
    await actionRun;
  });
}

export async function configureWorkoutTimerNotification() {
  if (Platform.OS === "web" || configured) return;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("workout-timer", {
      name: "Live workout timer",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0],
      sound: null,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
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
  phaseStartedAt,
  phaseElapsedSeconds = 0,
}: {
  title: string;
  body: string;
  phase: "work" | "rest" | "paused";
  steps?: WorkoutNotificationStep[];
  phaseStartedAt?: number;
  phaseElapsedSeconds?: number;
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
    phaseStartedAt: phaseStartedAt ?? Date.now(),
    phaseElapsedMs: Math.max(0, phaseElapsedSeconds * 1000),
  };
  const storedFlow = await readFlow();
  // Android can emit inactive and background in quick succession. A late
  // duplicate must not reset a flow already advanced by a headless action.
  const nextFlow =
    storedFlow && sameSteps(storedFlow.steps, flow.steps) ? storedFlow : flow;
  await saveFlow(nextFlow);
  await presentFlow(nextFlow);
}

export async function consumeWorkoutTimerActions() {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_ACTIONS_KEY);
  // Once the foreground workout has replayed the queued actions, its own
  // timestamped state is authoritative. Clear the background flow so a later
  // app pause/resume cannot resurrect an older notification phase.
  await AsyncStorage.multiRemove([
    WORKOUT_TIMER_ACTIONS_KEY,
    WORKOUT_TIMER_FLOW_KEY,
  ]);
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
