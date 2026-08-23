import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { NativeModules, Platform } from "react-native";

import { createManagedLocalNotificationGate } from "@/src/domain/notificationScheduling";
import {
  workoutNotificationElapsedSeconds,
  workoutWebNotificationBody,
  workoutWebNotificationSignature,
} from "@/src/domain/workoutNotifications";
import { enhanceAndroidTimerNotification } from "@/src/notifications/liveTimer";

export const WORKOUT_TIMER_CATEGORY = "metricrally-workout-timer";
const WORKOUT_TIMER_LAST_CATEGORY = "metricrally-workout-timer-last";
export const WORKOUT_TIMER_NOTIFICATION = "metricrally-workout-timer-live";
export const WORKOUT_TIMER_NEXT = "workout-next";
export const WORKOUT_TIMER_PAUSE = "workout-pause";
export const WORKOUT_TIMER_RESUME = "workout-resume";
export const WORKOUT_TIMER_FINISH = "workout-finish";
const WEB_WORKOUT_ACTION_MESSAGE = "habhub:web-workout-notification-action";
const WEB_WORKOUT_ACTION_AVAILABLE_MESSAGE =
  "habhub:web-workout-notification-action-available";
const WEB_WORKOUT_ACTION_CONTROL_MESSAGE =
  "habhub:web-workout-notification-action-control";
const WEB_WORKOUT_ACTION_IDENTITY_KEY =
  "metricrally-web-workout-action-identity-v1";
const WEB_WORKOUT_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WEB_WORKOUT_ACTION_MAX_BATCH = 30;

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
    | typeof WORKOUT_TIMER_RESUME
    | typeof WORKOUT_TIMER_FINISH;
  occurredAt: number;
  ownerId: string;
  generation: string;
  /** Durable Web queue identity; absent for native notification actions. */
  webActionId?: string;
};

type QueuedWebWorkoutTimerAction = QueuedWorkoutTimerAction & {
  webActionId: string;
};

type StoredWebWorkoutActionIdentity = {
  ownerId: string;
  actionToken: string;
};

type StoredWorkoutFlow = {
  ownerId: string;
  generation: string;
  steps: WorkoutNotificationStep[];
  index: number;
  paused: boolean;
  phaseStartedAt: number;
  phaseElapsedMs: number;
};

type AndroidWorkoutNotificationBridge = {
  nativeWorkoutActions?: boolean;
  syncWorkoutTimerNotificationFlow?: (flow: string) => Promise<boolean>;
  suspendWorkoutTimerNotificationPersistence?: () => Promise<boolean>;
  reconcileWorkoutTimerNotification?: (
    identifier: string,
  ) => Promise<boolean>;
  consumeWorkoutTimerNotificationActions?: (
    ownerId: string,
    generation: string,
  ) => Promise<string>;
  clearWorkoutTimerNotificationFlow?: () => Promise<boolean>;
};

let configured = false;
let pendingFlowAction = Promise.resolve();
let workoutNotificationRevision = 0;
let workoutNotificationOwnerId: string | undefined;
let workoutNotificationGeneration: string | undefined;
let workoutNotificationGenerationCounter = 0;
let webWorkoutNotificationOwnerId: string | undefined;
let webWorkoutNotificationSignature: string | undefined;
let webWorkoutNotificationAlertSignature: string | undefined;
let webWorkoutNotificationRevision = 0;
let webWorkoutNotificationQueue = Promise.resolve();
let webWorkoutActionOwnerId: string | undefined;
let webWorkoutActionToken: string | undefined;
let webWorkoutActionListenerInstalled = false;
let webWorkoutActionIdentityQueue = Promise.resolve();
let webWorkoutActionDrainRetry: number | undefined;
let queuedWebWorkoutActions: QueuedWebWorkoutTimerAction[] = [];
const webWorkoutActionDrainRequests = new Map<string, string>();
const webWorkoutActionDrainTimeouts = new Map<string, number>();
const webWorkoutActionSubscribers = new Set<{
  ownerId: string;
  listener: (actions: QueuedWorkoutTimerAction[]) => void;
}>();
const workoutNotificationGate = createManagedLocalNotificationGate();

const androidWorkoutBridge = () =>
  NativeModules.HabHubAndroid as AndroidWorkoutNotificationBridge | undefined;

export function nativeWorkoutActionsEnabled() {
  return (
    Platform.OS === "android" &&
    androidWorkoutBridge()?.nativeWorkoutActions === true
  );
}

async function syncNativeFlow(flow: StoredWorkoutFlow) {
  if (!nativeWorkoutActionsEnabled()) return false;
  return (
    (await androidWorkoutBridge()
      ?.syncWorkoutTimerNotificationFlow?.(JSON.stringify(flow))
      .catch(() => false)) ?? false
  );
}

async function reconcileNativeNotification(identifier: string) {
  if (!nativeWorkoutActionsEnabled()) return false;
  return (
    (await androidWorkoutBridge()
      ?.reconcileWorkoutTimerNotification?.(identifier)
      .catch(() => false)) ?? false
  );
}

function webWorkoutNotificationsSupported() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "Notification" in window
  );
}

function webWorkoutDocumentHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState !== "visible"
  );
}

function newWebWorkoutActionToken() {
  const bytes = new Uint32Array(4);
  window.crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("-");
}

function validWebWorkoutActionToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validWebWorkoutActionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function newWebWorkoutRequestId() {
  const bytes = new Uint32Array(3);
  window.crypto.getRandomValues(bytes);
  return [
    "drain",
    ...[...bytes].map((value) => value.toString(16).padStart(8, "0")),
  ].join("-");
}

function storedWebWorkoutActionIdentity(
  raw: string | null,
): StoredWebWorkoutActionIdentity | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredWebWorkoutActionIdentity>;
    return typeof parsed.ownerId === "string" &&
      parsed.ownerId.length > 0 &&
      parsed.ownerId.length <= 256 &&
      validWebWorkoutActionToken(parsed.actionToken)
      ? { ownerId: parsed.ownerId, actionToken: parsed.actionToken }
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeWebWorkoutActionIdentity<T>(operation: () => Promise<T>) {
  const result = webWorkoutActionIdentityQueue.then(operation, operation);
  webWorkoutActionIdentityQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function postWebWorkoutActionControl(
  message: Record<string, unknown>,
) {
  const registration = await webWorkoutServiceWorker();
  const worker =
    navigator.serviceWorker.controller ??
    registration?.active ??
    registration?.waiting ??
    registration?.installing;
  if (!worker) throw new Error("The workout service worker is not active.");
  worker.postMessage({ type: WEB_WORKOUT_ACTION_CONTROL_MESSAGE, ...message });
}

function acknowledgeWebWorkoutActions(actionToken: string, actionIds: string[]) {
  if (!actionIds.length) return Promise.resolve();
  return postWebWorkoutActionControl({
    operation: "ack",
    actionToken,
    actionIds: actionIds.slice(0, WEB_WORKOUT_ACTION_MAX_BATCH),
  });
}

function flushQueuedWebWorkoutActions() {
  if (!queuedWebWorkoutActions.length || !webWorkoutActionOwnerId) return;
  const subscriber = [...webWorkoutActionSubscribers].find(
    (candidate) => candidate.ownerId === webWorkoutActionOwnerId,
  );
  if (!subscriber) return;
  const actions = queuedWebWorkoutActions;
  try {
    subscriber.listener(actions);
  } catch {
    return;
  }
  const deliveredIds = new Set(actions.map((action) => action.webActionId));
  queuedWebWorkoutActions = queuedWebWorkoutActions.filter(
    (action) => !deliveredIds.has(action.webActionId),
  );
}

function scheduleWebWorkoutActionDrain(actionToken: string, delayMs: number) {
  if (webWorkoutActionDrainRetry !== undefined)
    window.clearTimeout(webWorkoutActionDrainRetry);
  webWorkoutActionDrainRetry = window.setTimeout(() => {
    webWorkoutActionDrainRetry = undefined;
    if (
      actionToken === webWorkoutActionToken &&
      webWorkoutActionOwnerId &&
      webWorkoutActionSubscribers.size
    )
      requestWebWorkoutActionDrain(actionToken);
  }, Math.max(250, Math.min(delayMs, 20_000)));
}

function requestWebWorkoutActionDrain(actionToken: string) {
  if (
    actionToken !== webWorkoutActionToken ||
    !webWorkoutActionOwnerId ||
    !webWorkoutActionSubscribers.size ||
    [...webWorkoutActionDrainRequests.values()].includes(actionToken)
  )
    return;
  const requestId = newWebWorkoutRequestId();
  webWorkoutActionDrainRequests.set(requestId, actionToken);
  webWorkoutActionDrainTimeouts.set(
    requestId,
    window.setTimeout(() => {
      webWorkoutActionDrainTimeouts.delete(requestId);
      if (webWorkoutActionDrainRequests.delete(requestId))
        scheduleWebWorkoutActionDrain(actionToken, 250);
    }, 5_000),
  );
  while (webWorkoutActionDrainRequests.size > 8) {
    const oldest = webWorkoutActionDrainRequests.keys().next().value;
    if (typeof oldest !== "string") break;
    webWorkoutActionDrainRequests.delete(oldest);
    const timeout = webWorkoutActionDrainTimeouts.get(oldest);
    if (timeout !== undefined) window.clearTimeout(timeout);
    webWorkoutActionDrainTimeouts.delete(oldest);
  }
  void postWebWorkoutActionControl({
    operation: "drain",
    actionToken,
    requestId,
  }).catch(() => {
    webWorkoutActionDrainRequests.delete(requestId);
    const timeout = webWorkoutActionDrainTimeouts.get(requestId);
    if (timeout !== undefined) window.clearTimeout(timeout);
    webWorkoutActionDrainTimeouts.delete(requestId);
  });
}

function ensureWebWorkoutActionListener() {
  if (
    webWorkoutActionListenerInstalled ||
    !webWorkoutNotificationsSupported()
  )
    return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as
      | {
          type?: unknown;
          actionToken?: unknown;
          requestId?: unknown;
          actions?: unknown;
          retryAfterMs?: unknown;
        }
      | undefined;
    if (
      message?.type === WEB_WORKOUT_ACTION_AVAILABLE_MESSAGE &&
      message.actionToken === webWorkoutActionToken &&
      typeof webWorkoutActionToken === "string" &&
      webWorkoutActionOwnerId &&
      webWorkoutActionSubscribers.size
    ) {
      requestWebWorkoutActionDrain(webWorkoutActionToken);
      return;
    }
    const now = Date.now();
    if (
      message?.type !== WEB_WORKOUT_ACTION_MESSAGE ||
      !validWebWorkoutActionToken(message.actionToken) ||
      message.actionToken !== webWorkoutActionToken ||
      !webWorkoutActionOwnerId ||
      !validWebWorkoutActionId(message.requestId) ||
      webWorkoutActionDrainRequests.get(message.requestId) !==
        message.actionToken
    )
      return;
    webWorkoutActionDrainRequests.delete(message.requestId);
    const drainTimeout = webWorkoutActionDrainTimeouts.get(message.requestId);
    if (drainTimeout !== undefined) window.clearTimeout(drainTimeout);
    webWorkoutActionDrainTimeouts.delete(message.requestId);
    const known = new Set(
      queuedWebWorkoutActions.map((action) => action.webActionId),
    );
    const received = Array.isArray(message.actions)
      ? message.actions.slice(0, WEB_WORKOUT_ACTION_MAX_BATCH)
      : [];
    for (const candidate of received) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as {
        id?: unknown;
        action?: unknown;
        occurredAt?: unknown;
      };
      if (
        !validWebWorkoutActionId(item.id) ||
        known.has(item.id) ||
        (item.action !== WORKOUT_TIMER_NEXT &&
          item.action !== WORKOUT_TIMER_PAUSE &&
          item.action !== WORKOUT_TIMER_RESUME) ||
        typeof item.occurredAt !== "number" ||
        !Number.isFinite(item.occurredAt) ||
        item.occurredAt < now - WEB_WORKOUT_ACTION_MAX_AGE_MS ||
        item.occurredAt > now + 60_000
      )
        continue;
      known.add(item.id);
      queuedWebWorkoutActions.push({
        action: item.action,
        occurredAt: item.occurredAt,
        ownerId: webWorkoutActionOwnerId,
        generation: message.actionToken,
        webActionId: item.id,
      });
    }
    queuedWebWorkoutActions = queuedWebWorkoutActions.slice(
      -WEB_WORKOUT_ACTION_MAX_BATCH,
    );
    flushQueuedWebWorkoutActions();
    if (
      typeof message.retryAfterMs === "number" &&
      Number.isFinite(message.retryAfterMs)
    )
      scheduleWebWorkoutActionDrain(
        message.actionToken,
        message.retryAfterMs,
      );
  });
  webWorkoutActionListenerInstalled = true;
}

function webWorkoutActionIdentity(ownerId: string) {
  ensureWebWorkoutActionListener();
  return serializeWebWorkoutActionIdentity(async () => {
    if (webWorkoutActionOwnerId === ownerId && webWorkoutActionToken)
      return webWorkoutActionToken;
    const obsoleteTokens = new Set<string>();
    if (webWorkoutActionToken) obsoleteTokens.add(webWorkoutActionToken);
    const raw = await AsyncStorage.getItem(
      WEB_WORKOUT_ACTION_IDENTITY_KEY,
    ).catch(() => null);
    const stored = storedWebWorkoutActionIdentity(raw);
    if (stored?.ownerId === ownerId) {
      webWorkoutActionOwnerId = ownerId;
      webWorkoutActionToken = stored.actionToken;
      queuedWebWorkoutActions = [];
      return stored.actionToken;
    }
    if (stored) obsoleteTokens.add(stored.actionToken);
    const actionToken = newWebWorkoutActionToken();
    const identity: StoredWebWorkoutActionIdentity = { ownerId, actionToken };
    try {
      await AsyncStorage.setItem(
        WEB_WORKOUT_ACTION_IDENTITY_KEY,
        JSON.stringify(identity),
      );
    } catch {
      webWorkoutActionOwnerId = undefined;
      webWorkoutActionToken = undefined;
      queuedWebWorkoutActions = [];
      return undefined;
    }
    webWorkoutActionOwnerId = ownerId;
    webWorkoutActionToken = actionToken;
    queuedWebWorkoutActions = [];
    for (const obsoleteToken of obsoleteTokens)
      if (obsoleteToken !== actionToken)
        void postWebWorkoutActionControl({
          operation: "clear",
          actionToken: obsoleteToken,
        }).catch(() => undefined);
    return actionToken;
  });
}

function clearWebWorkoutActionIdentity(ownerId?: string) {
  const memoryMatches =
    !ownerId || !webWorkoutActionOwnerId || webWorkoutActionOwnerId === ownerId;
  const memoryActionToken = memoryMatches ? webWorkoutActionToken : undefined;
  if (memoryMatches) {
    webWorkoutActionOwnerId = undefined;
    webWorkoutActionToken = undefined;
    queuedWebWorkoutActions = [];
    webWorkoutActionDrainRequests.clear();
    for (const timeout of webWorkoutActionDrainTimeouts.values())
      window.clearTimeout(timeout);
    webWorkoutActionDrainTimeouts.clear();
    if (webWorkoutActionDrainRetry !== undefined) {
      window.clearTimeout(webWorkoutActionDrainRetry);
      webWorkoutActionDrainRetry = undefined;
    }
  }
  return serializeWebWorkoutActionIdentity(async () => {
    const raw = await AsyncStorage.getItem(
      WEB_WORKOUT_ACTION_IDENTITY_KEY,
    ).catch(() => null);
    const stored = storedWebWorkoutActionIdentity(raw);
    const storedMatches = !ownerId || !stored || stored.ownerId === ownerId;
    if (storedMatches)
      await AsyncStorage.removeItem(WEB_WORKOUT_ACTION_IDENTITY_KEY).catch(
        () => undefined,
      );
    if (memoryMatches) {
      webWorkoutActionOwnerId = undefined;
      webWorkoutActionToken = undefined;
      queuedWebWorkoutActions = [];
    }
    const actionTokens = new Set(
      [memoryActionToken, storedMatches ? stored?.actionToken : undefined].filter(
        (value): value is string => Boolean(value),
      ),
    );
    for (const actionToken of actionTokens)
      await postWebWorkoutActionControl({
        operation: "clear",
        actionToken,
      }).catch(() => undefined);
  });
}

/**
 * Delivers privacy-scoped Web notification controls to the live workout.
 * The service worker never navigates or focuses the PWA for an action button.
 */
export function subscribeWebWorkoutTimerActions(
  ownerId: string,
  listener: (actions: QueuedWorkoutTimerAction[]) => void,
) {
  if (Platform.OS !== "web" || !webWorkoutNotificationsSupported())
    return () => undefined;
  ensureWebWorkoutActionListener();
  const subscriber = { ownerId, listener };
  webWorkoutActionSubscribers.add(subscriber);
  let active = true;
  void webWorkoutActionIdentity(ownerId).then((actionToken) => {
    if (!active || !actionToken) return;
    flushQueuedWebWorkoutActions();
    requestWebWorkoutActionDrain(actionToken);
  });
  return () => {
    active = false;
    webWorkoutActionSubscribers.delete(subscriber);
  };
}

/** ACK only after the gym has committed and durably saved these transitions. */
export async function acknowledgeWebWorkoutTimerActions(
  ownerId: string,
  actions: readonly QueuedWorkoutTimerAction[],
) {
  if (
    Platform.OS !== "web" ||
    webWorkoutActionOwnerId !== ownerId ||
    !webWorkoutActionToken
  )
    return;
  const actionIds = [
    ...new Set(
      actions
        .filter(
          (action) =>
            action.ownerId === ownerId &&
            action.generation === webWorkoutActionToken &&
            validWebWorkoutActionId(action.webActionId),
        )
        .map((action) => action.webActionId as string),
    ),
  ];
  await acknowledgeWebWorkoutActions(webWorkoutActionToken, actionIds);
}

async function webWorkoutServiceWorker() {
  if (!webWorkoutNotificationsSupported()) return undefined;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active) return existing;
  const registration =
    existing ??
    (await navigator.serviceWorker.register("/habhub-sw.js", {
      scope: "/",
      updateViaCache: "none",
    }));
  return registration.active ? registration : navigator.serviceWorker.ready;
}

async function closeWebWorkoutNotification(ownerId?: string) {
  if (
    ownerId &&
    webWorkoutNotificationOwnerId &&
    ownerId !== webWorkoutNotificationOwnerId
  )
    return;
  const revision = ++webWorkoutNotificationRevision;
  webWorkoutNotificationOwnerId = undefined;
  webWorkoutNotificationSignature = undefined;
  webWorkoutNotificationAlertSignature = undefined;
  if (!webWorkoutNotificationsSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration || revision !== webWorkoutNotificationRevision) return;
  const notifications = await registration.getNotifications({
    tag: WORKOUT_TIMER_NOTIFICATION,
  });
  if (revision !== webWorkoutNotificationRevision) return;
  notifications.forEach((notification) => notification.close());
}

async function presentWebWorkoutNotification({
  title,
  body,
  phase,
  phaseStartedAt,
  phaseElapsedSeconds,
  ownerId,
}: {
  title: string;
  body: string;
  phase: "work" | "rest" | "paused";
  phaseStartedAt?: number;
  phaseElapsedSeconds: number;
  ownerId: string;
}) {
  if (
    !webWorkoutNotificationsSupported() ||
    window.Notification.permission !== "granted" ||
    !webWorkoutDocumentHidden()
  ) {
    await closeWebWorkoutNotification(ownerId);
    return;
  }
  const elapsedSeconds = workoutNotificationElapsedSeconds({
    phase,
    phaseStartedAt: phaseStartedAt ?? Date.now(),
    phaseElapsedSeconds,
  });
  const notificationBody = workoutWebNotificationBody(body, elapsedSeconds);
  const signature = workoutWebNotificationSignature({
    ownerId,
    title,
    body: notificationBody,
    phase,
    elapsedSeconds,
  });
  if (
    webWorkoutNotificationOwnerId === ownerId &&
    webWorkoutNotificationSignature === signature
  )
    return;
  const alertSignature = JSON.stringify([
    ownerId,
    title,
    phase,
    phaseStartedAt ?? 0,
  ]);
  const shouldAlert = webWorkoutNotificationAlertSignature !== alertSignature;
  const replacesLiveNotification =
    webWorkoutNotificationOwnerId === ownerId &&
    webWorkoutNotificationSignature !== undefined;
  const revision = ++webWorkoutNotificationRevision;
  webWorkoutNotificationOwnerId = ownerId;
  webWorkoutNotificationSignature = signature;
  const registration = await webWorkoutServiceWorker();
  if (
    !registration ||
    revision !== webWorkoutNotificationRevision ||
    webWorkoutNotificationOwnerId !== ownerId ||
    !webWorkoutDocumentHidden()
  )
    return;
  const phaseLabel =
    phase === "paused" ? "PAUSED" : phase === "work" ? "WORK" : "REST";
  const phaseOrigin = Math.max(
    0,
    (phaseStartedAt ?? Date.now()) - Math.max(0, phaseElapsedSeconds) * 1000,
  );
  const maxActions = Math.max(
    0,
    Number(
      (window.Notification as typeof window.Notification & {
        maxActions?: number;
      }).maxActions ?? 0,
    ),
  );
  const actionToken = await webWorkoutActionIdentity(ownerId);
  if (
    revision !== webWorkoutNotificationRevision ||
    webWorkoutNotificationOwnerId !== ownerId ||
    !webWorkoutDocumentHidden()
  )
    return;
  const actions = actionToken
    ? [
        {
          action:
            phase === "paused" ? WORKOUT_TIMER_RESUME : WORKOUT_TIMER_PAUSE,
          title: phase === "paused" ? "Resume" : "Pause",
        },
        ...(phase === "paused"
          ? []
          : [{ action: WORKOUT_TIMER_NEXT, title: "Next" }]),
      ].slice(0, maxActions)
    : [];
  // `timestamp` is part of the Notifications API standard and lets a browser
  // keep showing the phase origin even after it throttles the hidden page.
  // React Native's bundled DOM declaration currently omits that member.
  const options: NotificationOptions & {
    timestamp: number;
    actions: { action: string; title: string }[];
    renotify: boolean;
  } = {
    body: notificationBody,
    icon: "/pwa-icon-192.png",
    badge: "/habhub-notification-badge-96.png",
    tag: WORKOUT_TIMER_NOTIFICATION,
    timestamp: phaseOrigin,
    actions,
    requireInteraction: true,
    // Alert once when the timer first appears and on a real phase transition.
    // Ten-second elapsed-time replacements keep the same alert signature and
    // stay silent, avoiding a sound/vibration loop.
    silent: !shouldAlert,
    renotify: shouldAlert && replacesLiveNotification,
    data: {
      route: "/gym",
      workoutTimer: true,
      ...(actionToken ? { workoutActionToken: actionToken } : {}),
    },
  };
  await registration.showNotification(`${phaseLabel} · ${title}`, options);
  if (
    revision === webWorkoutNotificationRevision &&
    webWorkoutNotificationOwnerId === ownerId
  )
    webWorkoutNotificationAlertSignature = alertSignature;
}

async function consumeNativeActions(ownerId: string, generation: string) {
  if (!nativeWorkoutActionsEnabled()) return [];
  const stored = await androidWorkoutBridge()
    ?.consumeWorkoutTimerNotificationActions?.(ownerId, generation)
    .catch(() => "[]");
  try {
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is QueuedWorkoutTimerAction =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as QueuedWorkoutTimerAction).occurredAt === "number" &&
            (item as QueuedWorkoutTimerAction).ownerId === ownerId &&
            (item as QueuedWorkoutTimerAction).generation === generation &&
            [WORKOUT_TIMER_NEXT, WORKOUT_TIMER_PAUSE, WORKOUT_TIMER_FINISH].includes(
              (item as QueuedWorkoutTimerAction).action,
            ),
        )
      : [];
  } catch {
    return [];
  }
}

async function readFlow() {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_FLOW_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredWorkoutFlow>;
    return parsed.steps?.length &&
      typeof parsed.ownerId === "string" &&
      typeof parsed.generation === "string"
      ? {
          ownerId: parsed.ownerId,
          generation: parsed.generation,
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

async function queueAction(
  action: QueuedWorkoutTimerAction["action"],
  flow: Pick<StoredWorkoutFlow, "ownerId" | "generation">,
) {
  const stored = await AsyncStorage.getItem(WORKOUT_TIMER_ACTIONS_KEY);
  let current: QueuedWorkoutTimerAction[] = [];
  try {
    current = stored ? (JSON.parse(stored) as QueuedWorkoutTimerAction[]) : [];
  } catch {
    current = [];
  }
  current.push({
    action,
    occurredAt: Date.now(),
    ownerId: flow.ownerId,
    generation: flow.generation,
  });
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
  const notificationTitle = `${phaseLabel} · ${step.title}`;
  const hasNext = !flow.paused && flow.index < flow.steps.length - 1;
  // Hand the complete remaining flow to Android before the notification can
  // be tapped. Its receiver can then update the row synchronously even if
  // TaskManager is deferred by a locked/dozing device.
  await syncNativeFlow(flow);
  // Reusing the same identifier updates the phone notification in place. Do
  // not dismiss/repost: that introduces visible gaps and delays Wear OS
  // notification bridging.
  const identifier = await Notifications.scheduleNotificationAsync({
    identifier: WORKOUT_TIMER_NOTIFICATION,
    content: {
      title: notificationTitle,
      body: flow.paused
        ? `Paused at ${formatElapsedMs(flow.phaseElapsedMs)} · ${step.body}`
        : step.body,
      data: {
        route: "/gym",
        workoutTimer: true,
        workoutOwnerId: flow.ownerId,
        workoutGeneration: flow.generation,
      },
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
    // The workout-specific native pass rereads the authoritative persisted
    // phase and rebuilds the same Expo row a few times. That closes the race
    // where Expo or an OEM rewrites a later exercise after the first native
    // chronometer frame. Older APKs fall back to the generic enhancer.
    const reconciled = await reconcileNativeNotification(identifier);
    if (!reconciled)
      await enhanceAndroidTimerNotification(
        identifier,
        flow.paused ? "paused" : "elapsed",
        phaseOrigin,
        0,
        notificationTitle,
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
    await queueAction(action, flow);
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
  } else if (action === WORKOUT_TIMER_RESUME) {
    // Web notifications use an explicit Resume action so a duplicated/stale
    // Pause tap can never toggle forward unexpectedly. Native still uses its
    // established Pause/resume toggle category above.
    if (flow.paused) {
      flow.paused = false;
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
  await queueAction(action, flow);
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
    // The custom Android receiver already committed, rendered, and queued
    // this action synchronously. Running the delayed TaskManager copy as well
    // would advance a second time and briefly restore an older phase.
    if (nativeWorkoutActionsEnabled()) return;
    const ownerId = workoutNotificationOwnerId;
    if (!ownerId) return;
    const revision = workoutNotificationRevision;
    const actionRun = workoutNotificationGate.run(ownerId, () => {
      const run = pendingFlowAction.then(() =>
        revision === workoutNotificationRevision
          ? applyFlowAction(action)
          : undefined,
      );
      pendingFlowAction = run.catch(() => undefined);
      return run;
    });
    // Keep rapid lock-screen actions ordered even if one notification update
    // fails, so the next tap still starts from the committed flow.
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
  ownerId,
}: {
  title: string;
  body: string;
  phase: "work" | "rest" | "paused";
  steps?: WorkoutNotificationStep[];
  phaseStartedAt?: number;
  phaseElapsedSeconds?: number;
  ownerId: string;
}) {
  if (Platform.OS === "web") {
    const operation = webWorkoutNotificationQueue.then(() =>
      presentWebWorkoutNotification({
        title,
        body,
        phase,
        phaseStartedAt,
        phaseElapsedSeconds,
        ownerId,
      }),
    );
    webWorkoutNotificationQueue = operation.catch(() => undefined);
    return operation;
  }
  const revision = ++workoutNotificationRevision;
  const generation = workoutNotificationGeneration;
  if (
    workoutNotificationOwnerId !== ownerId ||
    !generation
  )
    return;
  const flow: StoredWorkoutFlow = {
    ownerId,
    generation,
    steps:
      steps?.length
        ? steps
        : [{ title, body, phase: phase === "work" ? "work" : "rest" }],
    index: 0,
    paused: phase === "paused",
    phaseStartedAt: phaseStartedAt ?? Date.now(),
    phaseElapsedMs: Math.max(0, phaseElapsedSeconds * 1000),
  };
  await workoutNotificationGate.run(ownerId, async () => {
    // Locking Android commonly emits inactive and background back-to-back.
    // Coalesce those requests before touching Expo: two asynchronous posts
    // using the same identifier can otherwise leave the later row without the
    // chronometer installed by the earlier request.
    if (
      revision !== workoutNotificationRevision ||
      generation !== workoutNotificationGeneration
    )
      return;
    const permission = await Notifications.getPermissionsAsync();
    if (
      !permission.granted ||
      revision !== workoutNotificationRevision ||
      generation !== workoutNotificationGeneration
    )
      return;
    await configureWorkoutTimerNotification();
    if (
      revision !== workoutNotificationRevision ||
      generation !== workoutNotificationGeneration
    )
      return;
    const storedFlow = await readFlow();
    // A late duplicate must not reset a flow already advanced natively, but a
    // genuine foreground transition must replace the previous phase even when
    // the remaining step list is unchanged.
    const nextFlow =
      storedFlow &&
      storedFlow.ownerId === ownerId &&
      storedFlow.generation === generation &&
      sameSteps(storedFlow.steps, flow.steps) &&
      storedFlow.phaseStartedAt > flow.phaseStartedAt
        ? storedFlow
        : flow;
    await saveFlow(nextFlow);
    if (
      revision !== workoutNotificationRevision ||
      generation !== workoutNotificationGeneration
    )
      return;
    await presentFlow(nextFlow);
  });
}

export async function consumeWorkoutTimerActions(ownerId: string) {
  const generation = workoutNotificationGeneration;
  if (
    workoutNotificationOwnerId !== ownerId ||
    !generation
  )
    return [];
  const consumed = await workoutNotificationGate.run(ownerId, async () => {
    if (
      workoutNotificationOwnerId !== ownerId ||
      workoutNotificationGeneration !== generation
    )
      return [];
    const nativeActions = await consumeNativeActions(ownerId, generation);
    const stored = await AsyncStorage.getItem(WORKOUT_TIMER_ACTIONS_KEY);
    let storedActions: QueuedWorkoutTimerAction[] = [];
    try {
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      storedActions = Array.isArray(parsed)
        ? parsed.filter(
            (item): item is QueuedWorkoutTimerAction =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as QueuedWorkoutTimerAction).occurredAt === "number" &&
              typeof (item as QueuedWorkoutTimerAction).ownerId === "string" &&
              typeof (item as QueuedWorkoutTimerAction).generation === "string" &&
              [WORKOUT_TIMER_NEXT, WORKOUT_TIMER_PAUSE, WORKOUT_TIMER_FINISH].includes(
                (item as QueuedWorkoutTimerAction).action,
              ),
          )
        : [];
    } catch {
      storedActions = [];
    }
    if (
      workoutNotificationOwnerId !== ownerId ||
      workoutNotificationGeneration !== generation
    )
      return [];
    const matchingStored = storedActions.filter(
      (item) =>
        item.ownerId === ownerId && item.generation === generation,
    );
    const unmatchedStored = storedActions.filter(
      (item) =>
        item.ownerId !== ownerId || item.generation !== generation,
    );
    // Once this generation has replayed its actions, its foreground workout
    // state is authoritative. Preserve any nonmatching rows for the cleanup
    // operation that owns them; never expose them to the active account.
    await Promise.all([
      unmatchedStored.length
        ? AsyncStorage.setItem(
            WORKOUT_TIMER_ACTIONS_KEY,
            JSON.stringify(unmatchedStored),
          )
        : AsyncStorage.removeItem(WORKOUT_TIMER_ACTIONS_KEY),
      AsyncStorage.removeItem(WORKOUT_TIMER_FLOW_KEY),
    ]);
    if (
      workoutNotificationOwnerId !== ownerId ||
      workoutNotificationGeneration !== generation
    )
      return [];
    return nativeActions.length ? nativeActions : matchingStored;
  });
  return consumed ?? [];
}

export async function dismissWorkoutTimerNotification(
  ownerId: string,
  clearState = false,
) {
  if (Platform.OS === "web") {
    // Ending a workout invalidates every control still present in a browser's
    // notification tray before the asynchronous close completes.
    const identityClear = clearState
      ? clearWebWorkoutActionIdentity(ownerId)
      : Promise.resolve();
    const operation = webWorkoutNotificationQueue.then(() =>
      Promise.all([identityClear, closeWebWorkoutNotification(ownerId)]).then(
        () => undefined,
      ),
    );
    webWorkoutNotificationQueue = operation.catch(() => undefined);
    return operation;
  }
  ++workoutNotificationRevision;
  await workoutNotificationGate.run(ownerId, async () => {
    if (Platform.OS === "android")
      await androidWorkoutBridge()
        ?.suspendWorkoutTimerNotificationPersistence?.()
        .catch(() => false);
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
      await androidWorkoutBridge()
        ?.clearWorkoutTimerNotificationFlow?.()
        .catch(() => undefined);
    }
  });
}

/** Resume only after auth identity, hydration, onboarding, and master-on agree. */
export function resumeWorkoutTimerNotifications(ownerId: string) {
  if (
    workoutNotificationOwnerId !== ownerId ||
    !workoutNotificationGeneration
  ) {
    workoutNotificationGenerationCounter += 1;
    workoutNotificationGeneration = [
      ownerId,
      Date.now().toString(36),
      workoutNotificationGenerationCounter.toString(36),
    ].join(":");
  }
  workoutNotificationOwnerId = ownerId;
  workoutNotificationGate.resume(ownerId);
}

/**
 * Account/master cleanup fence for every queued Expo and native workout
 * update. Suspension is synchronous, so a background AppState callback that
 * arrives one tick later cannot recreate the old account's live row.
 */
export function clearWorkoutTimerNotifications() {
  if (Platform.OS === "web") {
    const identityClear = clearWebWorkoutActionIdentity();
    const operation = webWorkoutNotificationQueue.then(() =>
      Promise.all([identityClear, closeWebWorkoutNotification()]).then(
        () => undefined,
      ),
    );
    webWorkoutNotificationQueue = operation.catch(() => undefined);
    return operation;
  }
  workoutNotificationOwnerId = undefined;
  workoutNotificationGeneration = undefined;
  ++workoutNotificationRevision;
  return workoutNotificationGate.suspendAndRun(async () => {
    await pendingFlowAction.catch(() => undefined);
    await Notifications.dismissNotificationAsync(
      WORKOUT_TIMER_NOTIFICATION,
    ).catch(() => undefined);
    await Notifications.cancelScheduledNotificationAsync(
      WORKOUT_TIMER_NOTIFICATION,
    ).catch(() => undefined);
    await AsyncStorage.multiRemove([
      WORKOUT_TIMER_FLOW_KEY,
      WORKOUT_TIMER_ACTIONS_KEY,
    ]);
    await androidWorkoutBridge()
      ?.clearWorkoutTimerNotificationFlow?.()
      .catch(() => undefined);
  });
}
