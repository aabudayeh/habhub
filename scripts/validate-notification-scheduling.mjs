import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import {
  activityTimerAlertCandidates,
  createManagedLocalNotificationGate,
  earliestLocalNotificationSchedules,
  executeLocalNotificationReconciliation,
  goalReminderNotificationId,
  goalReminderSemanticKey,
  localNotificationIdentifier,
  LOCAL_NOTIFICATION_BUDGETS,
  MAX_PENDING_LOCAL_NOTIFICATIONS,
  notificationFallsAfterFastingTarget,
  planLocalNotificationReconciliation,
  quietHoursAdjustedDateTime,
  WEB_REMINDER_LATE_GRACE_MS,
  webReminderTriggerCanStillPublish,
  workoutActionMatchesActiveGeneration,
} from "../src/domain/notificationScheduling.ts";
import { createLatestAsyncDrain } from "../src/domain/latestAsyncDrain.ts";
import {
  acknowledgeWorkoutActionsAfterPersistence,
  formatWorkoutNotificationElapsed,
  WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS,
  WEB_WORKOUT_NOTIFICATION_REFRESH_MS,
  webWorkoutActionAckRetryDelay,
  workoutNotificationElapsedSeconds,
  workoutWebNotificationBody,
  workoutWebNotificationSignature,
} from "../src/domain/workoutNotifications.ts";

const base = {
  localDate: "2026-08-11",
  metricId: "steps",
  reminderIndex: 0,
  time: "18:30",
  userId: "user-a",
};

const first = goalReminderNotificationId(base);
assert.equal(first, goalReminderNotificationId({ ...base }));
assert.notEqual(
  first,
  goalReminderNotificationId({ ...base, reminderIndex: 1 }),
);
assert.notEqual(
  first,
  goalReminderNotificationId({ ...base, localDate: "2026-08-12" }),
);
assert.match(first, /^habhub-goal-v2:/);

const semanticBase = {
  userId: "user-a",
  metricId: "steps",
  localDate: "2026-08-11",
  time: "18:30",
  title: "Steps reminder",
  body: "2,000 steps remaining.",
  route: "/metric-detail",
};
const identicalReminderRows = [
  { ...semanticBase, reminderIndex: 0 },
  { ...semanticBase, reminderIndex: 1 },
];
assert.equal(
  new Set(identicalReminderRows.map(goalReminderSemanticKey)).size,
  1,
  "identical configured rows must collapse to one semantic alarm",
);
assert.notEqual(
  goalReminderSemanticKey(semanticBase),
  goalReminderSemanticKey({
    ...semanticBase,
    body: "Begin your planned 60 minute walk.",
    route: "/timer?metric=steps&date=2026-08-11&duration=60",
  }),
  "a genuinely different payload/destination must remain distinct",
);

const processed = [];
let releaseFirst;
const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
const drain = createLatestAsyncDrain(async (value) => {
  processed.push(`start:${value}`);
  if (value === 1) await firstGate;
  processed.push(`end:${value}`);
});
const firstDrain = drain(1);
const coalescedDrain = drain(2);
const latestDrain = drain(3);
releaseFirst();
await Promise.all([firstDrain, coalescedDrain, latestDrain]);
assert.deepEqual(
  processed,
  ["start:1", "end:1", "start:3", "end:3"],
  "the active value must finish and queued values must coalesce to the latest",
);
assert.equal(
  notificationFallsAfterFastingTarget({
    startedAt: "2026-08-14T00:00:00.000Z",
    targetMinutes: 16 * 60,
    triggerAt: Date.parse("2026-08-14T18:00:00.000Z"),
  }),
  true,
  "a closed app must not retain a reminder after a known fasting target",
);
assert.equal(
  notificationFallsAfterFastingTarget({
    startedAt: "2026-08-14T00:00:00.000Z",
    targetMinutes: 16 * 60,
    triggerAt: Date.parse("2026-08-14T16:00:00.000Z"),
  }),
  false,
  "a reminder exactly at fasting completion remains valid",
);

const gateEvents = [];
let releaseAccountA;
const accountAGate = new Promise((resolve) => {
  releaseAccountA = resolve;
});
const accountA = createManagedLocalNotificationGate();
accountA.resume("account-a");
const accountAWork = accountA.run("account-a", async () => {
  gateEvents.push("schedule:a:start");
  await accountAGate;
  gateEvents.push("schedule:a:end");
});
await Promise.resolve();
const cleanup = accountA.suspendAndRun(async () => {
  gateEvents.push("cleanup:a");
});
const staleWork = await accountA.run("account-a", async () => {
  gateEvents.push("stale:a");
});
assert.equal(staleWork, undefined);
releaseAccountA();
await Promise.all([accountAWork, cleanup]);
accountA.resume("account-b");
const lateAccountAWork = await accountA.run("account-a", async () => {
  gateEvents.push("late:a");
});
assert.equal(lateAccountAWork, undefined);
await accountA.run("account-b", async () => {
  gateEvents.push("schedule:b");
});
assert.deepEqual(gateEvents, [
  "schedule:a:start",
  "schedule:a:end",
  "cleanup:a",
  "schedule:b",
]);

const nativeWorkoutState = {
  activeOwnerId: "account-a",
  activeGeneration: "generation-a",
  disabled: false,
  actions: [],
};
const delayedWorkoutAction = {
  actionOwnerId: "account-a",
  actionGeneration: "generation-a",
};
// Master-off/sign-out commits its tombstone before a delivered broadcast can
// acquire the native store lock.
nativeWorkoutState.disabled = true;
nativeWorkoutState.activeOwnerId = undefined;
nativeWorkoutState.activeGeneration = undefined;
nativeWorkoutState.actions = [];
if (
  workoutActionMatchesActiveGeneration({
    ...nativeWorkoutState,
    ...delayedWorkoutAction,
  })
)
  nativeWorkoutState.actions.push("workout-next");
assert.deepEqual(
  nativeWorkoutState.actions,
  [],
  "clear-before-apply must not recreate a native workout action for the next account",
);
assert.equal(
  workoutActionMatchesActiveGeneration({
    disabled: false,
    activeOwnerId: "account-b",
    activeGeneration: "generation-b",
    ...delayedWorkoutAction,
  }),
  false,
  "an old notification action must not enter a newly active account generation",
);

assert.equal(formatWorkoutNotificationElapsed(3_661), "61:01");
assert.equal(
  workoutNotificationElapsedSeconds({
    phase: "work",
    phaseStartedAt: 1_000,
    phaseElapsedSeconds: 7,
    now: 16_999,
  }),
  22,
  "a running web notification must include the saved and live phase time",
);
assert.equal(
  workoutNotificationElapsedSeconds({
    phase: "paused",
    phaseStartedAt: 1_000,
    phaseElapsedSeconds: 7,
    now: 16_999,
  }),
  7,
  "a paused web notification must not keep accruing elapsed time",
);
assert.equal(
  workoutWebNotificationBody("0:07 elapsed · Finish set", 67),
  "1:07 elapsed · Finish set",
  "web refreshes must replace, rather than duplicate, the elapsed prefix",
);
const workoutSignatureInput = {
  ownerId: "account-a",
  title: "Bench press · Set 2/4",
  body: "1:00 elapsed · Finish set",
  phase: "work",
};

assert.equal(
  webReminderTriggerCanStillPublish(1_000_000 - WEB_REMINDER_LATE_GRACE_MS, 1_000_000),
  true,
  "a just-due Web reminder must survive client publication delay",
);
assert.equal(
  webReminderTriggerCanStillPublish(
    1_000_000 - WEB_REMINDER_LATE_GRACE_MS - 1,
    1_000_000,
  ),
  false,
  "the late-publication grace must remain bounded",
);
assert.equal(
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    elapsedSeconds: 60,
  }),
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    elapsedSeconds: 60 + WEB_WORKOUT_NOTIFICATION_REFRESH_MS / 1000 - 1,
  }),
  "same refresh-window notification work must coalesce",
);
assert.notEqual(
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    elapsedSeconds: 60,
  }),
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    elapsedSeconds: 60 + WEB_WORKOUT_NOTIFICATION_REFRESH_MS / 1000,
  }),
  "the next refresh window must update the live elapsed display",
);
assert.equal(webWorkoutActionAckRetryDelay(0), 500);
assert.equal(webWorkoutActionAckRetryDelay(99), WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS);
let retryPersistenceAttempts = 0;
let retryAcknowledgements = 0;
const retryPersistence = () => {
  retryPersistenceAttempts += 1;
  return retryPersistenceAttempts === 1
    ? Promise.reject(new Error("first persistence failed"))
    : Promise.resolve();
};
const retryAcknowledge = async () => {
  retryAcknowledgements += 1;
};
await assert.rejects(
  acknowledgeWorkoutActionsAfterPersistence(
    retryPersistence(),
    retryAcknowledge,
  ),
);
assert.equal(retryAcknowledgements, 0);
await acknowledgeWorkoutActionsAfterPersistence(
  retryPersistence(),
  retryAcknowledge,
);
assert.equal(retryPersistenceAttempts, 2);
assert.equal(retryAcknowledgements, 1);
let retryAckPostAttempts = 0;
const retryAckPost = async () => {
  retryAckPostAttempts += 1;
  if (retryAckPostAttempts === 1) throw new Error("first ACK post failed");
};
await assert.rejects(
  acknowledgeWorkoutActionsAfterPersistence(Promise.resolve(), retryAckPost),
);
await acknowledgeWorkoutActionsAfterPersistence(
  Promise.resolve(),
  retryAckPost,
);
assert.equal(retryAckPostAttempts, 2);
const queuedAccountAActions = [
  {
    action: "workout-next",
    occurredAt: Date.now(),
    ownerId: "account-a",
    generation: "generation-a",
  },
];
const accountBConsumesBeforeAccountAClear = queuedAccountAActions.filter(
  (action) =>
    workoutActionMatchesActiveGeneration({
      disabled: false,
      activeOwnerId: "account-b",
      activeGeneration: "generation-b",
      actionOwnerId: action.ownerId,
      actionGeneration: action.generation,
    }),
);
assert.deepEqual(
  accountBConsumesBeforeAccountAClear,
  [],
  "B consuming before A cleanup must never replay A's already queued action",
);

const localId = localNotificationIdentifier({
  userId: "user-a",
  kind: "todo-reminder",
  sourceId: "todo-a:reminder-a",
  localDate: "2026-08-14",
  time: "18:00",
});
assert.equal(
  localId,
  localNotificationIdentifier({
    userId: "user-a",
    kind: "todo-reminder",
    sourceId: "todo-a:reminder-a",
    localDate: "2026-08-14",
    time: "18:00",
  }),
);
const unchanged = planLocalNotificationReconciliation({
  desired: [{ identifier: localId, scheduleKey: "exact:1" }],
  existing: [{ identifier: localId, scheduleKey: "exact:1" }],
  previousIds: [localId, "stale"],
});
assert.deepEqual(unchanged.toSchedule, []);
assert.deepEqual(unchanged.toCancel, ["stale"]);
assert.equal(
  Object.values(LOCAL_NOTIFICATION_BUDGETS).reduce(
    (total, value) => total + value,
    0,
  ),
  MAX_PENDING_LOCAL_NOTIFICATIONS,
  "category reservations must stay within iOS's app-wide pending limit",
);
assert.deepEqual(
  earliestLocalNotificationSchedules(
    [
      { identifier: "late", scheduledAt: 300 },
      { identifier: "first-b", scheduledAt: 100 },
      { identifier: "first-a", scheduledAt: 100 },
      { identifier: "middle", scheduledAt: 200 },
    ],
    3,
  ).map((item) => item.identifier),
  ["first-a", "first-b", "middle"],
  "each category must retain its nearest alarms with a stable tie-break",
);
const exactAccessChanged = planLocalNotificationReconciliation({
  desired: [{ identifier: localId, scheduleKey: "payload:exact" }],
  existing: [{ identifier: localId, scheduleKey: "payload:inexact" }],
  previousIds: [localId],
});
assert.deepEqual(
  exactAccessChanged.toSchedule.map((item) => item.identifier),
  [localId],
  "an exact-alarm capability revision must re-upsert an existing alarm",
);

const adapterEvents = [];
await executeLocalNotificationReconciliation({
  toSchedule: exactAccessChanged.toSchedule,
  toCancel: ["stale-a", "stale-b"],
  schedule: async ({ identifier }) => adapterEvents.push(`schedule:${identifier}`),
  cancel: async (identifier) => adapterEvents.push(`cancel:${identifier}`),
});
assert.deepEqual(adapterEvents, [
  `schedule:${localId}`,
  "cancel:stale-a",
  "cancel:stale-b",
]);
const failureEvents = [];
await assert.rejects(
  executeLocalNotificationReconciliation({
    toSchedule: [{ identifier: "new", scheduleKey: "new-key" }],
    toCancel: ["still-valid"],
    schedule: async () => {
      failureEvents.push("schedule");
      throw new Error("mock native scheduling failure");
    },
    cancel: async () => failureEvents.push("cancel"),
  }),
);
assert.deepEqual(
  failureEvents,
  ["schedule"],
  "a failed native upsert must never cancel the prior alarm",
);
assert.deepEqual(
  quietHoursAdjustedDateTime({
    enabled: true,
    start: "22:00",
    end: "08:00",
    localDate: "2026-08-14",
    time: "23:00",
  }),
  { localDate: "2026-08-15", time: "08:00" },
  "an overnight quiet-hours reminder must roll into the following date",
);
const reopenedBeforeQuietHoursRollover = new Date("2026-08-15T07:30:00");
const quietHoursRollover = quietHoursAdjustedDateTime({
  enabled: true,
  start: "22:00",
  end: "08:00",
  localDate: "2026-08-14",
  time: "23:00",
});
assert.ok(
  new Date(`${quietHoursRollover.localDate}T${quietHoursRollover.time}:00`) >
    reopenedBeforeQuietHoursRollover,
  "a reminder rolled from yesterday must remain pending when the PWA reopens before quiet hours end",
);
const recoveredTimerAlerts = activityTimerAlertCandidates({
  alertMinutes: [10, 30, 60],
  elapsedSeconds: 15 * 60,
  mode: "countdown",
  ownerId: "account-a",
  targetSeconds: 60 * 60,
  timerId: "timer-a",
});
assert.deepEqual(
  recoveredTimerAlerts.map((item) => [
    item.completion,
    item.thresholdSeconds,
    item.triggerSeconds,
  ]),
  [
    [false, 30 * 60, 15 * 60],
    [true, 60 * 60, 45 * 60],
  ],
  "master-on recovery must rebuild only future threshold/completion alerts",
);
assert.deepEqual(
  recoveredTimerAlerts.map((item) => item.identifier),
  activityTimerAlertCandidates({
    alertMinutes: [10, 30, 60],
    elapsedSeconds: 15 * 60,
    mode: "countdown",
    ownerId: "account-a",
    targetSeconds: 60 * 60,
    timerId: "timer-a",
  }).map((item) => item.identifier),
  "recovery must use stable identifiers and never duplicate surviving alarms",
);
assert.notDeepEqual(
  recoveredTimerAlerts.map((item) => item.identifier),
  activityTimerAlertCandidates({
    alertMinutes: [10, 30, 60],
    elapsedSeconds: 15 * 60,
    mode: "countdown",
    ownerId: "account-b",
    targetSeconds: 60 * 60,
    timerId: "timer-a",
  }).map((item) => item.identifier),
  "timer alert identities must be private to the active account",
);

const source = fs.readFileSync("src/notifications/push.ts", "utf8");
const adapterSource = fs.readFileSync("src/notifications/localScheduling.ts", "utf8");
const channelSource = fs.readFileSync("src/notifications/localChannels.ts", "utf8");
const timerSource = fs.readFileSync("app/timer.tsx", "utf8");
const activityAlertSource = fs.readFileSync(
  "src/notifications/activityTimerAlerts.ts",
  "utf8",
);
const liveTimerSource = fs.readFileSync(
  "src/notifications/liveTimer.ts",
  "utf8",
);
const workoutTimerSource = fs.readFileSync(
  "src/notifications/workoutTimer.ts",
  "utf8",
);
const layoutSource = fs.readFileSync("app/_layout.tsx", "utf8");
const authSource = fs.readFileSync("src/auth/AuthProvider.tsx", "utf8");
const settingsSource = fs.readFileSync("app/notifications.tsx", "utf8");
const seedSource = fs.readFileSync("src/data/seed.ts", "utf8");
const appConfigSource = fs.readFileSync("app.json", "utf8");
const androidPluginSource = fs.readFileSync(
  "plugins/withHabHubAndroid.js",
  "utf8",
);
const androidNativeSource = fs.readFileSync(
  "plugins/habhub-android/java/HabHubNativeModule.kt",
  "utf8",
);
const androidNotificationServiceSource = fs.readFileSync(
  "plugins/habhub-android/java/HabHubNotificationsService.kt",
  "utf8",
);
const gymSource = fs.readFileSync("app/(tabs)/gym.tsx", "utf8");
const webWorker = fs.readFileSync("public/habhub-sw.js", "utf8");
const webManifest = fs.readFileSync("public/manifest.webmanifest", "utf8");
const webBadge = fs.readFileSync("public/habhub-notification-badge-96.png");
const webScheduleSource = fs.readFileSync(
  "src/notifications/webReminderSchedule.ts",
  "utf8",
);
const webScheduleSyncSource = fs.readFileSync(
  "src/notifications/webReminderSync.ts",
  "utf8",
);
const webPushSource = fs.readFileSync("src/notifications/webPush.ts", "utf8");
const webScheduleMigration = fs.readFileSync(
  "supabase/migrations/202608220007_web_personal_reminder_delivery.sql",
  "utf8",
);
const webScheduleWorker = fs.readFileSync(
  "supabase/functions/web-personal-notifications/index.ts",
  "utf8",
);
const groupSettingsSource = fs.readFileSync("app/group-settings.tsx", "utf8");
const useGroupNotificationEventsSource = fs.readFileSync(
  "src/cloud/useGroupNotificationEvents.ts",
  "utf8",
);
const sendPushSource = fs.readFileSync(
  "supabase/functions/send-push/index.ts",
  "utf8",
);
assert.match(source, /createLatestAsyncDrain<AppState>/);
assert.match(
  source,
  /reconcileLocalNotifications\([\s\S]{0,80}GOAL_IDS,[\s\S]{0,160}LOCAL_NOTIFICATION_BUDGETS\.goals/,
);
assert.match(source, /notificationKind: 'goal-reminder'/);
assert.match(source, /scheduledSemantics\.has\(semanticKey\)/);
assert.match(source, /for \(let offset = 0; offset < 367; offset \+= 1\)/);
assert.match(
  source,
  /plans\.length >= LOCAL_NOTIFICATION_BUDGETS\.goals/,
);
assert.match(
  source,
  /plans\.length >= LOCAL_NOTIFICATION_BUDGETS\.productivity/,
);
assert.match(adapterSource, /getAllScheduledNotificationsAsync\(\)/);
assert.match(adapterSource, /executeLocalNotificationReconciliation/);
assert.match(adapterSource, /deliveryMode = await getExactAlarmStatus\(\)/);
assert.match(adapterSource, /plan\.scheduleKey,[\s\S]{0,40}deliveryMode/);
assert.match(adapterSource, /sound: content\.sound === undefined \? "default"/);
assert.match(adapterSource, /cancelAllScheduledNotificationsAsync\(\)/);
assert.match(adapterSource, /dismissAllNotificationsAsync\(\)/);
assert.match(adapterSource, /createManagedLocalNotificationGate/);
assert.match(adapterSource, /scheduleImmediateManagedLocalNotification/);
assert.match(channelSource, /LOCAL_REMINDERS_CHANNEL_ID/);
assert.match(channelSource, /LOCAL_TIMER_ALERTS_CHANNEL_ID/);
assert.match(timerSource, /syncActivityTimerAlerts/);
assert.match(timerSource, /cancelActivityTimerAlerts/);
assert.match(activityAlertSource, /ensureLocalNotificationChannels/);
assert.match(activityAlertSource, /intervalLocalNotificationTrigger/);
assert.match(activityAlertSource, /LOCAL_NOTIFICATION_BUDGETS\.activityTimers/);
assert.match(activityAlertSource, /notificationKind: "activity-timer-alert"/);
assert.match(activityAlertSource, /reconcileLocalNotifications/);
assert.match(activityAlertSource, /ACTIVITY_TIMER_ALERT_IDS/);
assert.match(activityAlertSource, /localNotificationScheduleKey/);
assert.match(activityAlertSource, /notificationOwnerId: state\.currentUserId/);
assert.match(activityAlertSource, /activityTimerId: plan\.timerId/);
assert.match(
  activityAlertSource,
  /Platform\.OS === "web" \|\| !state\.settings\.notifications\.pushEnabled[\s\S]{0,220}requestPermissionsAsync/,
  "starting an activity timer with the master off must not prompt for OS permission",
);
assert.match(
  source,
  /syncAllLocalNotifications[\s\S]{0,350}syncActivityTimerAlerts\(state\)/,
  "foreground/master-on reconciliation must include persisted activity timers",
);
assert.match(layoutSource, /activityTimerNotificationKey/);
assert.match(layoutSource, /syncActivityTimerAlerts\(cycleStateRef\.current\)/);
assert.match(liveTimerSource, /activityNotificationRevision/);
assert.match(liveTimerSource, /activityNotificationsSuspended/);
assert.match(
  liveTimerSource,
  /if \(!shouldContinue\(\)\) \{[\s\S]{0,500}installedIds\.map[\s\S]{0,180}dismissNotificationAsync/,
  "a live-timer schedule finishing after account cleanup must dismiss its unpersisted row",
);
assert.match(liveTimerSource, /clearLiveActivityTimerNotifications/);
assert.match(source, /clearLiveActivityTimerNotifications\(\)/);
assert.match(workoutTimerSource, /\+\+workoutNotificationRevision/);
assert.match(workoutTimerSource, /clearWorkoutTimerNotificationFlow/);
assert.match(workoutTimerSource, /createManagedLocalNotificationGate/);
assert.match(workoutTimerSource, /resumeWorkoutTimerNotifications/);
assert.match(workoutTimerSource, /clearWorkoutTimerNotifications/);
assert.match(workoutTimerSource, /ownerId: string/);
assert.match(workoutTimerSource, /workoutGeneration: flow\.generation/);
assert.match(workoutTimerSource, /window\.Notification\.permission !== "granted"/);
assert.match(workoutTimerSource, /registration\.getNotifications\(\{[\s\S]{0,80}tag: WORKOUT_TIMER_NOTIFICATION/);
assert.match(workoutTimerSource, /registration\.showNotification/);
assert.match(workoutTimerSource, /silent: true/);
assert.match(workoutTimerSource, /route: "\/gym"/);
assert.match(workoutTimerSource, /maxActions/);
assert.match(workoutTimerSource, /timestamp: phaseOrigin/);
assert.match(workoutTimerSource, /action: WORKOUT_TIMER_PAUSE/);
assert.match(workoutTimerSource, /action: WORKOUT_TIMER_NEXT/);
assert.match(workoutTimerSource, /suspendWorkoutTimerNotificationPersistence/);
assert.match(gymSource, /document\.visibilityState === "visible"/);
assert.match(gymSource, /WEB_WORKOUT_NOTIFICATION_REFRESH_MS/);
assert.match(gymSource, /state\.settings\.notifications\.pushEnabled/);
assert.match(gymSource, /useLocalSearchParams/);
assert.match(gymSource, /handledWebTimerAction/);
assert.match(gymSource, /router\.replace\("\/gym" as never\)/);
assert.match(gymSource, /subscribeWebWorkoutTimerActions/);
assert.match(webWorker, /WORKOUT_ACTIONS/);
assert.match(webWorker, /WORKOUT_ACTION_MESSAGE/);
assert.match(webWorker, /client\.postMessage\(\{/);
assert.match(webWorker, /self\.indexedDB\.open\(WORKOUT_ACTION_DATABASE, 1\)/);
assert.match(webWorker, /WORKOUT_ACTION_MAX_ITEMS = 30/);
assert.match(webWorker, /WORKOUT_ACTION_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/);
assert.match(webWorker, /self\.clients\.openWindow\(target\.href\)/);
const workoutActionBranch = webWorker.slice(
  webWorker.indexOf('self.addEventListener("notificationclick"'),
  webWorker.indexOf("// A notification-body click"),
);
assert.match(workoutActionBranch, /event\.waitUntil\([\s\S]*storeWorkoutAction\(queuedAction\)/);
assert.match(workoutActionBranch, /return;\s*\}/);
assert.doesNotMatch(
  workoutActionBranch,
  /\.focus\(|\.navigate\(|openWindow\(/,
  "workout action buttons must never open, navigate, or focus the PWA",
);
function createFakeWorkoutActionIndexedDb() {
  const rows = new Map();
  let storeCreated = false;
  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore() {
      storeCreated = true;
    },
    close() {},
    transaction() {
      let aborted = false;
      const transaction = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        abort() {
          aborted = true;
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore() {
          return {
            getAll() {
              const request = { result: [], error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (aborted) return;
                request.result = Array.from(rows.values(), (item) => ({ ...item }));
                request.onsuccess?.();
                queueMicrotask(() => {
                  if (!aborted) transaction.oncomplete?.();
                });
              });
              return request;
            },
            clear() {
              rows.clear();
            },
            put(item) {
              rows.set(item.id, { ...item });
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    rows,
    indexedDB: {
      open() {
        const request = {
          result: database,
          error: null,
          onupgradeneeded: null,
          onerror: null,
          onblocked: null,
          onsuccess: null,
        };
        queueMicrotask(() => {
          if (!storeCreated) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}
const workerHandlers = new Map();
const workerEffects = { focused: 0, navigated: 0, opened: 0, messages: [] };
const fakeWorkoutActionDb = createFakeWorkoutActionIndexedDb();
let workerWindows = [];
let randomId = 0;
const fixedWorkoutActionTime = 1_800_000_000_000;
class FixedWorkoutActionDate extends Date {
  static now() {
    return fixedWorkoutActionTime;
  }
}
const workerClient = {
  url: "https://habhub.example/today",
  postMessage(message) {
    workerEffects.messages.push(message);
  },
  async navigate() {
    workerEffects.navigated += 1;
    return workerClient;
  },
  async focus() {
    workerEffects.focused += 1;
    return workerClient;
  },
};
vm.runInNewContext(webWorker, {
  Date: FixedWorkoutActionDate,
  URL,
  self: {
    location: { origin: "https://habhub.example" },
    indexedDB: fakeWorkoutActionDb.indexedDB,
    crypto: {
      randomUUID() {
        randomId += 1;
        return `00000000-0000-4000-8000-${String(randomId).padStart(12, "0")}`;
      },
    },
    registration: { showNotification: async () => undefined },
    clients: {
      claim: async () => undefined,
      matchAll: async () => workerWindows,
      openWindow: async () => {
        workerEffects.opened += 1;
        return workerClient;
      },
    },
    skipWaiting: async () => undefined,
    addEventListener(type, handler) {
      workerHandlers.set(type, handler);
    },
  },
});
const notificationClick = workerHandlers.get("notificationclick");
const workerMessage = workerHandlers.get("message");
async function clickWorkoutAction(action, actionToken = "opaque-session-token") {
  let actionWork;
  notificationClick({
    action,
    notification: {
      close() {},
      data: {
        route: "/gym",
        workoutTimer: true,
        workoutActionToken: actionToken,
      },
    },
    waitUntil(work) {
      actionWork = work;
    },
  });
  await actionWork;
}
await clickWorkoutAction("workout-pause");
await clickWorkoutAction("workout-pause");
await clickWorkoutAction("workout-next");
await clickWorkoutAction("workout-pause", "second-opaque-session-token");
assert.equal(workerEffects.messages.length, 0);
assert.equal(fakeWorkoutActionDb.rows.size, 4);
assert.equal(workerEffects.focused, 0);
assert.equal(workerEffects.navigated, 0);
assert.equal(workerEffects.opened, 0);
workerWindows = [workerClient];
let drainWork;
workerMessage({
  data: {
    type: "habhub:web-workout-notification-action-control",
    operation: "drain",
    actionToken: "opaque-session-token",
    requestId: "drain-request-0001",
  },
  source: workerClient,
  waitUntil(work) {
    drainWork = work;
  },
});
await drainWork;
assert.equal(workerEffects.messages.length, 1);
const drained = workerEffects.messages[0];
assert.deepEqual(
  Array.from(drained.actions, (item) => item.action),
  ["workout-pause", "workout-pause", "workout-next"],
);
assert.equal(
  new Set(Array.from(drained.actions, (item) => item.id)).size,
  3,
  "durable IDs must distinguish same-action taps with identical occurredAt",
);
const storedOccurredAt = Array.from(fakeWorkoutActionDb.rows.values())
  .filter((item) => item.actionToken === "opaque-session-token")
  .map((item) => item.occurredAt)
  .sort((left, right) => left - right);
assert.deepEqual(
  Array.from(drained.actions, (item) => item.occurredAt),
  storedOccurredAt,
  "drain must preserve each notification click's exact occurredAt",
);
let ackWork;
workerMessage({
  data: {
    type: "habhub:web-workout-notification-action-control",
    operation: "ack",
    actionToken: "opaque-session-token",
    actionIds: Array.from(drained.actions, (item) => item.id),
  },
  source: workerClient,
  waitUntil(work) {
    ackWork = work;
  },
});
await ackWork;
assert.equal(
  fakeWorkoutActionDb.rows.size,
  1,
  "ACK must not remove another account token's queued action",
);
let clearWork;
workerMessage({
  data: {
    type: "habhub:web-workout-notification-action-control",
    operation: "clear",
    actionToken: "second-opaque-session-token",
  },
  source: workerClient,
  waitUntil(work) {
    clearWork = work;
  },
});
await clearWork;
assert.equal(fakeWorkoutActionDb.rows.size, 0);
assert.equal(workerEffects.focused, 0);
assert.equal(workerEffects.navigated, 0);
assert.equal(workerEffects.opened, 0);
notificationClick({
  action: "stale-workout-action",
  notification: {
    close() {},
    data: { route: "/gym", workoutTimer: true },
  },
  waitUntil() {
    throw new Error("an unknown workout action must remain silent");
  },
});
assert.equal(workerEffects.focused, 0);
assert.equal(workerEffects.navigated, 0);
assert.equal(workerEffects.opened, 0);
let bodyWork;
notificationClick({
  action: "",
  notification: { close() {}, data: { route: "/gym", workoutTimer: true } },
  waitUntil(work) {
    bodyWork = work;
  },
});
await bodyWork;
assert.equal(workerEffects.navigated, 1);
assert.equal(workerEffects.focused, 1);
assert.equal(workerEffects.opened, 0);
assert.match(workoutTimerSource, /workoutActionToken: actionToken/);
assert.match(workoutTimerSource, /message\.actionToken !== webWorkoutActionToken/);
assert.match(workoutTimerSource, /WEB_WORKOUT_ACTION_IDENTITY_KEY/);
assert.match(workoutTimerSource, /stored\?\.ownerId === ownerId/);
assert.match(workoutTimerSource, /operation: "ack"/);
assert.match(workoutTimerSource, /operation: "clear"/);
const webActionFlush = workoutTimerSource.slice(
  workoutTimerSource.indexOf("function flushQueuedWebWorkoutActions"),
  workoutTimerSource.indexOf("function scheduleWebWorkoutActionDrain"),
);
assert.doesNotMatch(
  webActionFlush,
  /acknowledgeWebWorkoutActions/,
  "delivering into React state must not ACK before Gym processes the action",
);
assert.match(gymSource, /queuedWorkoutTimerActionId[\s\S]{0,120}webActionId/);
assert.match(gymSource, /processedWebWorkoutActionIds/);
assert.match(
  gymSource,
  /acknowledgeWorkoutActionsAfterPersistence\(\s*workoutDraftPersistenceRef\.current[\s\S]{0,300}acknowledgeWebWorkoutTimerActions/,
  "Web action ACK must wait for the processed workout draft write",
);
assert.match(
  gymSource,
  /workoutDraftPersistenceRef\.current = persistence[\s\S]{0,600}webTimerActionAckRetry/,
  "a retry trigger must rerun failed workout draft persistence",
);
assert.match(gymSource, /window\.addEventListener\("online", retryNow\)/);
assert.match(
  gymSource,
  /document\.addEventListener\("visibilitychange", retryWhenVisible\)/,
);
assert.match(gymSource, /retryTimer = window\.setTimeout\(retryNow, delay\)/);
assert.match(gymSource, /tutorialSandbox \|\| !workoutDraftReady/);
assert.match(webWorker, /badge: BADGE_PATH/);
assert.match(webWorker, /habhub-notification-badge-96\.png/);
assert.match(webManifest, /habhub-notification-badge-96\.png/);
assert.match(webManifest, /"purpose": "monochrome"/);
assert.equal(webBadge.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(webBadge.readUInt32BE(16), 96);
assert.equal(webBadge.readUInt32BE(20), 96);
assert.match(workoutTimerSource, /badge: "\/habhub-notification-badge-96\.png"/);
assert.match(webPushSource, /badge: "\/habhub-notification-badge-96\.png"/);
assert.match(
  workoutTimerSource,
  /consumeWorkoutTimerActions\(ownerId: string\)[\s\S]{0,1800}item\.ownerId === ownerId && item\.generation === generation/,
  "workout action consumption must be gated and filtered to the active account generation",
);
assert.match(androidNotificationServiceSource, /DISABLED_KEY/);
assert.match(androidNotificationServiceSource, /ACTIVE_OWNER_KEY/);
assert.match(androidNotificationServiceSource, /GENERATION_KEY/);
assert.match(androidNotificationServiceSource, /HabHubWorkoutNotificationPersistenceReceiver/);
assert.match(androidNotificationServiceSource, /PRESENTATION_ENABLED_KEY/);
assert.match(androidNotificationServiceSource, /REPOST_TOKEN_KEY/);
assert.match(androidNotificationServiceSource, /repostDelaysMs/);
assert.match(androidNotificationServiceSource, /flow\.finished/);
assert.match(androidNotificationServiceSource, /setDeleteIntent\(dismissedPendingIntent/);
assert.match(androidNotificationServiceSource, /manager\.activeNotifications\.any \{ it\.tag == NOTIFICATION_ID \}/);
assert.match(androidNotificationServiceSource, /setOngoing\(false\)/);
assert.doesNotMatch(androidNotificationServiceSource, /startForegroundService/);
assert.match(androidPluginSource, /HabHubWorkoutNotificationPersistenceReceiver/);
assert.match(
  androidNotificationServiceSource,
  /fun consumeActions\([\s\S]{0,350}ACTIVE_OWNER_KEY[\s\S]{0,200}GENERATION_KEY[\s\S]{0,600}item\.optString\("ownerId"\) == ownerId[\s\S]{0,120}item\.optString\("generation"\) == generation/,
  "native queued actions must remain private to their owner and generation",
);
assert.match(
  androidNotificationServiceSource,
  /fun clear\([\s\S]{0,450}putBoolean\(DISABLED_KEY, true\)[\s\S]{0,250}remove\(ACTIONS_KEY\)[\s\S]{0,80}commit\(\)/,
  "native cleanup must synchronously commit a disabled tombstone and erase queued actions",
);
assert.match(
  androidNotificationServiceSource,
  /fun clear\([\s\S]{0,1400}manager\.cancel\(it\.tag, it\.id\)/,
  "native cleanup must remove a row recreated immediately before the tombstone won the receiver lock",
);
assert.match(
  androidNotificationServiceSource,
  /prefs\.getBoolean\(DISABLED_KEY, true\)[\s\S]{0,3000}else if \(flow == null\)/,
  "flow-null action recovery is valid only after the active native generation check",
);
assert.match(
  layoutSource,
  /resumeLiveActivityTimerNotifications\(state\.currentUserId\)/,
);
assert.match(
  layoutSource,
  /resumeWorkoutTimerNotifications\(state\.currentUserId\)/,
);
assert.match(layoutSource, /subscribeLocalNotificationRefresh/);
assert.match(layoutSource, /syncAllLocalNotifications/);
assert.match(layoutSource, /InteractionManager\.runAfterInteractions/);
assert.match(layoutSource, /localNotificationsReady/);
assert.match(layoutSource, /localNotificationSchedulingEnabled/);
assert.match(
  layoutSource,
  /resumeManagedLocalNotifications\(state\.currentUserId\)/,
);
assert.match(layoutSource, /automaticFastProgress/);
assert.match(layoutSource, /fastingCompletionTimer/);
assert.match(layoutSource, /auth\.status === "signedIn"/);
assert.match(layoutSource, /auth\.status === "demo"/);
assert.match(layoutSource, /auth\.user\?\.id === state\.currentUserId/);
assert.match(layoutSource, /metrics: state\.metrics/);
assert.match(layoutSource, /notifications: state\.settings\.notifications/);
assert.match(layoutSource, /recentCompletionInputs/);
assert.match(layoutSource, /fastingRuntimeByMetric: state\.settings\.fastingRuntimeByMetric/);
assert.doesNotMatch(
  settingsSource,
  /await enablePushNotifications[\s\S]{0,500}await notificationSetupComplete/,
  "a successful registration must not be rolled back by an immediate verification read",
);
assert.match(appConfigSource, /android\.permission\.SCHEDULE_EXACT_ALARM/);
assert.match(androidPluginSource, /android\.permission\.SCHEDULE_EXACT_ALARM/);
assert.match(androidNativeSource, /canScheduleExactAlarms/);
assert.match(androidNativeSource, /ACTION_REQUEST_SCHEDULE_EXACT_ALARM/);
assert.match(settingsSource, /notificationSetupComplete/);
assert.match(settingsSource, /displayedPushEnabled/);
assert.match(seedSource, /notifications:\s*\{\s*pushEnabled: false/);
assert.match(source, /cancelAllManagedLocalNotifications/);
assert.match(source, /scheduleImmediateManagedLocalNotification/);
assert.match(
  source,
  /cancelAllManagedLocalNotifications[\s\S]{0,1000}clearWorkoutTimerNotifications\(\)/,
);
assert.match(
  source,
  /todoResolvedOnDate\(todo, localDate\)/,
  "a skipped recurring to-do occurrence must be excluded from its native plan",
);
assert.match(
  authSource,
  /cancelAllManagedLocalNotifications\([\s\S]{0,500}client\.auth\.signOut\(\)/,
  "account-scoped alarms must be removed before the authenticated session ends",
);
assert.match(source, /GOAL_LEGACY_CLEANUP/);
assert.match(source, /legacyMetric !== 'menstrual_cycle'/);
assert.match(
  source,
  /cleanup = cancelLegacyGoalReminderNotifications\(state\)\.finally/,
);
assert.match(source, /await ensureLegacyGoalReminderCleanup\(state\)/);
assert.match(
  source,
  /async function syncProductivityNotificationsNow[\s\S]{0,700}await ensureLegacyGoalReminderCleanup\(state\)/,
);
assert.doesNotMatch(
  source,
  /for \(const reminder of configured\.filter\(\(item\) => item\.enabled\)\)/,
);
assert.doesNotMatch(source, /notificationKind: 'goal-recovery'/);
assert.doesNotMatch(settingsSource, /title="Goal recovery nudges"/);
assert.match(settingsSource, /title="Logged tracker streaks"/);
assert.match(settingsSource, /title="Leaderboard winners"/);
assert.match(layoutSource, /syncWebReminderSchedule\(cycleStateRef\.current\)/);
assert.match(layoutSource, /webReminderScheduleKey/);
assert.match(layoutSource, /auth\.session\?\.user\.id !== auth\.user\.id/);
assert.match(layoutSource, /Math\.min\(5 \* 60_000, 3_000 \* 2 \*\* attempt\)/);
assert.match(layoutSource, /Publish immediately after a reminder\/to-do state commit/);
assert.doesNotMatch(layoutSource, /setTimeout\(\(\) => void sync\(\), 2200\)/);
assert.match(layoutSource, /const repairTimer = setInterval\(retryNow, 12 \* 60_000\)/);
assert.match(layoutSource, /clearInterval\(repairTimer\)/);
assert.match(layoutSource, /window\.addEventListener\("online", retryNow\)/);
assert.match(
  layoutSource,
  /document\.addEventListener\("visibilitychange", retryNow\)/,
);
assert.match(layoutSource, /document\.hidden \|\| !navigator\.onLine/);
assert.match(webScheduleSource, /planWebReminderSchedule/);
for (const category of [
  "tracker",
  "todo",
  "calendar",
  "cycle",
  "gym",
  "timer",
  "fasting",
])
  assert.match(webScheduleSource, new RegExp(`category: "${category}"`));
assert.match(webScheduleSource, /quietHoursAdjustedDateTime/);
assert.equal(WEB_REMINDER_LATE_GRACE_MS, 4 * 60 * 1000);
assert.match(webScheduleSource, /triggerCanStillPublish/);
assert.equal(
  (webScheduleSource.match(/for \(let offset = -1; offset < 367; offset \+= 1\)/g) ?? [])
    .length,
  2,
  "web tracker and productivity planning must retain yesterday's quiet-hours rollovers",
);
assert.match(webScheduleSource, /todoReminderAppliesOnDate/);
assert.match(webScheduleSource, /activityTimerAlertCandidates/);
assert.match(webScheduleSyncSource, /replace_own_web_notification_schedule/);
assert.match(webScheduleSyncSource, /data\.session\?\.user\.id !== state\.currentUserId/);
assert.match(webScheduleSyncSource, /Number\(acceptedCount\) !== events\.length/);
assert.match(webScheduleSyncSource, /WEB_REMINDER_SCHEDULE_REPAIR_MS/);
assert.match(webScheduleSyncSource, /acceptedAt: Date\.now\(\)/);
assert.match(webPushSource, /showImmediateWebNotification/);
assert.match(source, /deliverImmediatePersonalNotification/);
assert.doesNotMatch(
  source.slice(
    source.indexOf("export async function notifyProgressMilestones"),
    source.indexOf("async function syncGoalNotificationsNow"),
  ),
  /Platform\.OS === 'web' \|\|/,
  "PWA progress and streak updates must not be silently disabled",
);
assert.match(
  webScheduleMigration,
  /create table if not exists public\.web_personal_notification_schedule/,
);
assert.match(webScheduleMigration, /enable row level security/g);
assert.match(
  webScheduleMigration,
  /revoke all on table public\.web_personal_notification_schedule[\s\S]{0,120}authenticated/,
);
assert.match(
  webScheduleMigration,
  /v_user_id is null or v_user_id <> p_expected_user_id/,
);
assert.match(webScheduleMigration, /jsonb_array_length[\s\S]{0,100}> 68/);
assert.match(webScheduleMigration, /for update skip locked/);
assert.match(webScheduleMigration, /web-personal-notifications-every-minute/);
assert.match(webScheduleMigration, /web_personal_notification_worker_secret/);
assert.match(webScheduleMigration, /delete from public\.web_personal_notification_schedule/);
assert.match(webScheduleWorker, /PERSONAL_NOTIFICATION_WORKER_SECRET/);
assert.match(webScheduleWorker, /constantTimeEqual/);
assert.match(webScheduleWorker, /web_personal_notification_acceptances/);
assert.match(webScheduleWorker, /status === 404 \|\| status === 410/);
assert.match(webScheduleWorker, /preferenceAllowed/);
assert.match(groupSettingsSource, /Personal alerts for this group/);
assert.match(groupSettingsSource, /groupPreferencesByGroup/);
assert.match(groupSettingsSource, /challengeCadence/);
assert.match(groupSettingsSource, /notificationMemberIds/);
assert.match(groupSettingsSource, /notificationMetricIds/);
assert.match(
  groupSettingsSource,
  /availableNotificationMemberIds\.has\(memberId\)/,
);
assert.match(groupSettingsSource, /availableNotificationMetricIds\.has\(metricId\)/);
assert.match(sendPushSource, /groupPreference\.trackerUpdates/);
assert.match(sendPushSource, /groupPreference\.progressUpdates/);
assert.match(
  groupSettingsSource,
  /trackerUpdates \?\?[\s\S]{0,100}progressUpdates \?\?/
);
assert.match(sendPushSource, /groupPreference\.leadChanges/);
assert.match(
  sendPushSource,
  /"challenge_started",[\s\S]{0,120}"challenge_invitation",[\s\S]{0,120}"challenge_accepted"/,
);
assert.match(
  useGroupNotificationEventsSource,
  /event\.kind === "challenge_invitation"[\s\S]{0,120}event\.kind === "challenge_accepted"/,
);
assert.doesNotMatch(groupSettingsSource, /title="Progress updates"/);
assert.match(groupSettingsSource, /title="Shared tracker progress"/);
assert.match(groupSettingsSource, /title="Lead changes"/);
assert.match(sendPushSource, /groupPreference\.memberIds/);
assert.match(sendPushSource, /groupPreference\.metricIds/);
assert.match(
  sendPushSource,
  /event\.category !== "metric" && event\.category !== "lead"/,
);

console.log(
  "Native and Web reminder scheduling are private, bounded, serialized and idempotent.",
);
