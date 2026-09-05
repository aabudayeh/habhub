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
  notificationTitle,
  planLocalNotificationReconciliation,
  quietHoursAdjustedDateTime,
  streakProtectionReminderTime,
  WEB_REMINDER_LATE_GRACE_MS,
  webReminderTriggerCanStillPublish,
  workoutActionMatchesActiveGeneration,
} from "../src/domain/notificationScheduling.ts";
import { createLatestAsyncDrain } from "../src/domain/latestAsyncDrain.ts";
import { isAllowedWebPushEndpoint } from "../supabase/functions/_shared/web-push-endpoint.ts";
import {
  createNotificationResponseClaimGate,
  notificationResponseDisposition,
  notificationResponseOwnerId,
  scheduleGuardedDefaultLanding,
  shouldDeferWorkoutNotificationResponseClear,
  workoutNotificationActionDisposition,
} from "../src/domain/notificationResponses.ts";
import {
  acknowledgeWorkoutActionsAfterPersistence,
  formatWorkoutNotificationElapsed,
  WORKOUT_COMPLETION_NOTIFICATION_WINDOW_MS,
  WEB_WORKOUT_ACTION_ACK_RETRY_MAX_MS,
  webWorkoutActionAckRetryDelay,
  workoutCompletionCanNotify,
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

const claimNotificationResponse = createNotificationResponseClaimGate(2);
const notificationTap = {
  actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  notificationDate: Date.parse("2026-08-11T18:30:00.000Z"),
  notificationIdentifier: "notification-a",
};
assert.equal(claimNotificationResponse(notificationTap), true);
assert.equal(
  claimNotificationResponse(notificationTap),
  false,
  "a listener/getter race must navigate for the same response only once",
);
assert.equal(notificationResponseOwnerId({ accountId: "user-a" }), "user-a");
assert.equal(
  notificationResponseOwnerId({ workoutOwnerId: "legacy-user" }),
  "legacy-user",
);
const responseReady = {
  authConfigured: true,
  authStatus: "signedIn",
  authUserId: "user-a",
  hydrated: true,
  onboardingComplete: true,
  responseOwnerId: "user-a",
  stateUserId: "user-a",
  tutorialActive: false,
};
assert.equal(notificationResponseDisposition(responseReady), "open");
assert.equal(
  notificationResponseDisposition({ ...responseReady, hydrated: false }),
  "wait",
);
assert.equal(
  notificationResponseDisposition({ ...responseReady, onboardingComplete: false }),
  "wait",
);
assert.equal(
  notificationResponseDisposition({ ...responseReady, authStatus: "signedOut", authUserId: undefined }),
  "wait",
);
assert.equal(
  notificationResponseDisposition({ ...responseReady, responseOwnerId: "user-b" }),
  "discard",
);
assert.equal(
  notificationResponseDisposition({ ...responseReady, responseOwnerId: undefined }),
  "discard",
  "legacy unscoped responses must not cross an account switch",
);
assert.equal(
  notificationResponseDisposition({
    ...responseReady,
    authConfigured: false,
    authStatus: "demo",
    authUserId: undefined,
    responseOwnerId: "demo:user-a",
  }),
  "open",
);
assert.equal(
  notificationResponseDisposition({
    ...responseReady,
    authConfigured: true,
    authStatus: "demo",
    authUserId: undefined,
    responseOwnerId: "demo:user-a",
  }),
  "open",
  "a configured release build must open an exact demo-scoped response",
);
assert.equal(
  notificationResponseDisposition({
    ...responseReady,
    authConfigured: true,
    authStatus: "demo",
    authUserId: undefined,
    responseOwnerId: "user-a",
  }),
  "open",
  "local demo notifications scoped to the current state user remain valid",
);
for (const responseOwnerId of [undefined, "user-b", "demo:user-b"]) {
  assert.equal(
    notificationResponseDisposition({
      ...responseReady,
      authConfigured: true,
      authStatus: "demo",
      authUserId: undefined,
      responseOwnerId,
    }),
    "discard",
    "demo mode must discard unscoped and cross-account responses",
  );
}

const terminatedIosWorkoutResponse = {
  actionIdentifier: "workout-next",
  data: { accountId: "user-a", route: "/gym", workoutTimer: true },
  disposition: "open",
  platform: "ios",
};
assert.equal(
  shouldDeferWorkoutNotificationResponseClear(terminatedIosWorkoutResponse),
  true,
  "root must retain a terminated-iOS workout action for Gym",
);
assert.equal(
  shouldDeferWorkoutNotificationResponseClear({
    ...terminatedIosWorkoutResponse,
    platform: "android",
  }),
  false,
  "Android keeps its existing native-receiver ownership",
);
assert.equal(
  workoutNotificationActionDisposition({
    accountAuthorityReady: true,
    hydrated: true,
    draftReady: false,
    responseOwnerId: "user-a",
    stateUserId: "user-a",
    timerActive: false,
  }),
  "wait",
  "Gym must not consume the cached action before its durable draft restores",
);
assert.equal(
  workoutNotificationActionDisposition({
    accountAuthorityReady: true,
    hydrated: true,
    draftReady: true,
    responseOwnerId: "user-a",
    stateUserId: "user-a",
    timerActive: true,
  }),
  "apply",
  "the restored owner-scoped timer applies the retained action",
);
assert.equal(
  workoutNotificationActionDisposition({
    accountAuthorityReady: true,
    hydrated: true,
    draftReady: true,
    responseOwnerId: "user-b",
    stateUserId: "user-a",
    timerActive: true,
  }),
  "discard",
  "a cached workout response must never cross accounts",
);

let scheduledLandingCallback;
const cancelledLandingHandles = [];
let defaultLandingOwner = 1;
let defaultLandingNavigations = 0;
const cancelScheduledLanding = scheduleGuardedDefaultLanding({
  isStillPending: () => defaultLandingOwner === 1,
  navigate: () => {
    defaultLandingNavigations += 1;
  },
  schedule: (callback) => {
    scheduledLandingCallback = callback;
    return 41;
  },
  cancel: (handle) => cancelledLandingHandles.push(handle),
});
defaultLandingOwner = 2;
scheduledLandingCallback();
defaultLandingOwner = 1;
scheduledLandingCallback();
assert.equal(
  defaultLandingNavigations,
  0,
  "a timer that lost navigation ownership must stay inert even if invoked again",
);
cancelScheduledLanding();
assert.deepEqual(
  cancelledLandingHandles,
  [],
  "an already-fired timer does not need a redundant native cancellation",
);

let unmountedLandingCallback;
let unmountedLandingNavigations = 0;
const cancelUnmountedLanding = scheduleGuardedDefaultLanding({
  isStillPending: () => true,
  navigate: () => {
    unmountedLandingNavigations += 1;
  },
  schedule: (callback) => {
    unmountedLandingCallback = callback;
    return 42;
  },
  cancel: (handle) => cancelledLandingHandles.push(handle),
});
cancelUnmountedLanding();
unmountedLandingCallback();
assert.equal(
  unmountedLandingNavigations,
  0,
  "effect cleanup must make an already-queued landing callback inert",
);
assert.deepEqual(cancelledLandingHandles, [42]);

let readyLandingCallback;
let readyLandingNavigations = 0;
scheduleGuardedDefaultLanding({
  isStillPending: () => true,
  navigate: () => {
    readyLandingNavigations += 1;
  },
  schedule: (callback) => {
    readyLandingCallback = callback;
    return 43;
  },
});
readyLandingCallback();
readyLandingCallback();
assert.equal(
  readyLandingNavigations,
  1,
  "a valid scheduled landing navigates exactly once",
);
assert.equal(
  claimNotificationResponse({ ...notificationTap, actionIdentifier: "reply" }),
  true,
  "a distinct action on the same delivered notification remains actionable",
);
assert.equal(
  claimNotificationResponse({
    ...notificationTap,
    notificationDate: notificationTap.notificationDate + 1,
  }),
  true,
  "a later delivery may reuse an identifier without being suppressed",
);

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
const workoutCompletionNow = Date.parse("2026-08-30T12:00:00.000Z");
assert.equal(
  workoutCompletionCanNotify({
    localDate: "2026-08-30",
    recordedAt: "2026-08-30T11:59:00.000Z",
    completedAt: "2026-08-30T11:59:30.000Z",
    today: "2026-08-30",
    now: workoutCompletionNow,
  }),
  true,
  "a workout completed moments ago today may emit its one immediate acknowledgement",
);
assert.equal(
  workoutCompletionCanNotify({
    localDate: "2026-08-27",
    recordedAt: new Date(workoutCompletionNow).toISOString(),
    completedAt: new Date(workoutCompletionNow).toISOString(),
    today: "2026-08-30",
    now: workoutCompletionNow,
  }),
  false,
  "editing or hydrating an older-day workout must never replay a completion notification",
);
assert.equal(
  workoutCompletionCanNotify({
    localDate: "2026-08-30",
    recordedAt: new Date(
      workoutCompletionNow - WORKOUT_COMPLETION_NOTIFICATION_WINDOW_MS - 1,
    ).toISOString(),
    today: "2026-08-30",
    now: workoutCompletionNow,
  }),
  false,
  "sign-in and upgrade hydration must baseline a stale same-day workout silently",
);
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
  workoutWebNotificationBody("0:07 elapsed · Finish set", 67, "paused"),
  "1:07 elapsed · Finish set",
  "a paused Web notification must retain its exact frozen elapsed value",
);
assert.equal(
  workoutWebNotificationBody("0:07 elapsed · Finish set", 67, "work"),
  "Timer running · Finish set",
  "a running Web notification must not embed a value that freezes with its hidden page",
);
const workoutSignatureInput = {
  ownerId: "account-a",
  title: "Bench press · Set 2/4",
  body: "1:00 elapsed · Finish set",
  phase: "work",
};
assert.equal(streakProtectionReminderTime("00:00"), "20:00");
assert.equal(streakProtectionReminderTime("23:00"), "21:00");
assert.equal(streakProtectionReminderTime("06:30"), "20:00");

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
  notificationTitle("", "Steps reminder"),
  "Steps reminder",
  "an optional blank label must not invalidate the account's atomic Web schedule",
);
assert.equal(
  notificationTitle("  Custom nudge  ", "Steps reminder"),
  "Custom nudge",
  "a configured title remains supported and is normalized before publication",
);
assert.equal(
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    phaseTimestamp: 1_000,
  }),
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    phaseTimestamp: 1_000,
  }),
  "the same persistent phase notification must coalesce",
);
assert.notEqual(
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    phaseTimestamp: 1_000,
  }),
  workoutWebNotificationSignature({
    ...workoutSignatureInput,
    phaseTimestamp: 2_000,
  }),
  "a genuinely new phase origin must replace the persistent notification",
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
const activeTimerOverlaySource = fs.readFileSync(
  "src/components/ActiveTimerOverlay.tsx",
  "utf8",
);
const workoutTimerSource = fs.readFileSync(
  "src/notifications/workoutTimer.ts",
  "utf8",
);
const backgroundWorkoutFinishSource = fs.readFileSync(
  "src/storage/backgroundWorkoutFinish.ts",
  "utf8",
);
const appProviderSource = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const healthBackgroundSource = fs.readFileSync(
  "src/health/background.native.ts",
  "utf8",
);
const layoutSource = fs.readFileSync("app/_layout.tsx", "utf8");
const badgeChallengeInputsSource = fs.readFileSync(
  "src/cloud/useBadgeChallengeInputs.ts",
  "utf8",
);
const settledChallengeResultsSource = fs.readFileSync(
  "src/cloud/useSettledChallengeResults.ts",
  "utf8",
);
const publicChallengesSource = fs.readFileSync(
  "src/cloud/usePublicChallenges.ts",
  "utf8",
);
const authSource = fs.readFileSync("src/auth/AuthProvider.tsx", "utf8");
const settingsSource = fs.readFileSync("app/notifications.tsx", "utf8");
const metricEditorSource = fs.readFileSync("app/metric-editor.tsx", "utf8");
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
const webScheduleRepairMigration = fs.readFileSync(
  "supabase/migrations/202608230002_web_personal_notification_worker_reliability.sql",
  "utf8",
);
const webScheduleRouteValidationRepair = fs.readFileSync(
  "supabase/migrations/202608260003_fix_web_reminder_route_validation.sql",
  "utf8",
);
const webScheduleCpuGuardMigration = fs.readFileSync(
  "supabase/migrations/202608240001_hourly_google_health_catchups.sql",
  "utf8",
);
const webScheduleWorker = fs.readFileSync(
  "supabase/functions/web-personal-notifications/index.ts",
  "utf8",
);
const trustedWebPushMigration = fs.readFileSync(
  "supabase/migrations/202609040004_trusted_web_push_endpoints.sql",
  "utf8",
);
const trustedWebPushHelper = fs.readFileSync(
  "supabase/functions/_shared/web-push-endpoint.ts",
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
assert.match(source, /notificationKind: 'streak-guard'/);
assert.match(source, /streakProtectionReminderTime\(state\.settings\.dayEndTime\)/);
assert.match(source, /metricStreakStats\([\s\S]{0,180}previousDate/);
assert.match(source, /notificationKind: 'habhub-update'/);
assert.match(source, /notificationKind: 'badge-award'/);
assert.match(source, /buildBadges\(previousState[\s\S]{0,800}buildBadges\(nextState/);
assert.match(source, /badge\.category !== 'competition'/);
assert.doesNotMatch(
  source,
  /buildBadges\((?:previousState|nextState), localDate, \[\]/,
  "state-only logs must not pretend an empty challenge list is authoritative",
);
assert.match(
  source,
  /buildBadges\([\s\S]{0,180}inputs\.challenges,[\s\S]{0,120}inputs\.placements,[\s\S]{0,100}inputs\.settledOccurrenceKeys/,
  "challenge badge awards must use the immutable settlement inputs",
);
assert.match(source, /CHALLENGE_BADGE_OBSERVATIONS/);
assert.match(source, /Establish an authoritative baseline after this release/);
assert.match(source, /pendingChallengeBadgeAwards/);
assert.match(source, /syncChallengeBadgeAwardNotifications/);
assert.match(source, /const pendingBadgeAwards = new Map/);
assert.match(source, /InteractionManager\.runAfterInteractions\(finish\)/);
assert.match(source, /setTimeout\(finish, deadlineMs\)/);
assert.match(
  layoutSource,
  /ChallengeBadgeNotificationBridge[\s\S]{0,900}useBadgeChallengeInputs\([\s\S]{0,900}syncChallengeBadgeAwardNotifications/,
  "the root bridge must observe authoritative result refreshes without waiting for the badge screen",
);
assert.match(
  badgeChallengeInputsSource,
  /settledChallengeResults\.authoritativeLoadComplete/,
);
assert.match(
  badgeChallengeInputsSource,
  /loadedPublicPlacementKey === publicPlacementChallengeKey/,
);
assert.match(
  settledChallengeResultsSource,
  /authoritativeLoadComplete: authoritativelyLoadedGroupId === groupId/,
);
assert.match(publicChallengesSource, /initialLoadComplete/);
assert.match(
  source,
  /previousState: pending\?\.previousState \?\? candidate\.previousState[\s\S]{0,100}nextState: candidate\.nextState/,
  "rapid logs must preserve the pre-burst baseline while the newest badge state wins",
);
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
assert.match(
  adapterSource,
  /if \(Platform\.OS !== "web"\) \{[\s\S]{0,180}cancelAllScheduledNotificationsAsync\(\)[\s\S]{0,120}dismissAllNotificationsAsync\(\)/,
  "web sign-out must not call native-only Expo notification cancellation methods",
);
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
assert.match(
  liveTimerSource,
  /window\.Notification\.permission === "granted"[\s\S]{0,140}webActivityTimerDocumentHidden\(\)/,
  "Web activity timers must use an already-granted permission only while the PWA is hidden",
);
assert.match(
  liveTimerSource,
  /registration\.showNotification\(timer\.title, options\)/,
  "hidden Web activity timers must be presented through the persistent service worker",
);
assert.match(liveTimerSource, /icon: "\/pwa-icon-192\.png"/);
assert.match(
  liveTimerSource,
  /badge: "\/habhub-notification-badge-96\.png"/,
);
assert.match(liveTimerSource, /requireInteraction: true/);
assert.match(
  liveTimerSource,
  /route: timer\.route,[\s\S]{0,100}activityTimer: true/,
  "an activity-timer notification body tap must retain its timer route",
);
assert.match(
  activeTimerOverlaySource,
  /document\.addEventListener\("visibilitychange", reconcileVisibility\)/,
  "the PWA timer overlay must reconcile notifications at the browser visibility boundary",
);
assert.match(
  activeTimerOverlaySource,
  /window\.addEventListener\("pagehide", presentHiddenTimerNotifications\)/,
  "pagehide must force the hidden notification branch even before WebKit updates visibilityState",
);
assert.match(
  activeTimerOverlaySource,
  /window\.addEventListener\("pageshow", dismissVisibleTimerNotifications\)/,
  "pageshow must force cleanup of the persistent hidden-page timer notification",
);
assert.doesNotMatch(
  activeTimerOverlaySource,
  /window\.addEventListener\("page(?:hide|show)", reconcileVisibility\)/,
  "page lifecycle events must not depend on a potentially stale document.visibilityState",
);
assert.match(
  activeTimerOverlaySource,
  /resumeLiveActivityTimerNotifications\(ownerId\)/,
  "the Web timer queue must resume only for the active owner",
);
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
assert.match(workoutTimerSource, /silent: !shouldAlert/);
assert.match(workoutTimerSource, /renotify: shouldAlert && replacesLiveNotification/);
assert.match(workoutTimerSource, /webWorkoutNotificationAlertSignature/);
assert.match(workoutTimerSource, /route: "\/gym"/);
assert.match(workoutTimerSource, /maxActions/);
assert.match(workoutTimerSource, /timestamp: phaseTimestamp/);
assert.match(workoutTimerSource, /action: WORKOUT_TIMER_NEXT/);
assert.match(
  workoutTimerSource,
  /const hasNext = !flow\.paused && flow\.index < flow\.steps\.length - 1[\s\S]{0,1100}categoryIdentifier: hasNext[\s\S]{0,100}WORKOUT_TIMER_CATEGORY/,
  "native category selection must retain the proven pre-regression paused and final action layout",
);
assert.match(workoutTimerSource, /export const WORKOUT_TIMER_RESUME = "workout-resume"/);
assert.match(workoutTimerSource, /suspendWorkoutTimerNotificationPersistence/);
const webWorkoutTimestampComment = workoutTimerSource.indexOf("// `timestamp`");
const visibleWebWorkoutActions = workoutTimerSource.slice(
  workoutTimerSource.lastIndexOf("const actions =", webWorkoutTimestampComment),
  webWorkoutTimestampComment,
);
assert.match(visibleWebWorkoutActions, /WORKOUT_TIMER_NEXT/);
assert.match(
  visibleWebWorkoutActions,
  /phase === "paused" \? "Resume" : "Next"/,
);
assert.doesNotMatch(
  visibleWebWorkoutActions,
  /WORKOUT_TIMER_PAUSE|WORKOUT_TIMER_RESUME/,
  "the Web live notification must expose only Next",
);
const workoutFlowAction = workoutTimerSource.slice(
  workoutTimerSource.indexOf("async function applyFlowAction"),
  workoutTimerSource.indexOf("if (\n  Platform.OS === \"android\""),
);
assert.match(
  workoutFlowAction,
  /action === WORKOUT_TIMER_PAUSE[\s\S]{0,220}flow\.paused = true[\s\S]{0,500}!flow\.paused && flow\.index < flow\.steps\.length - 1/,
  "native fallback handling must retain independent Pause/resume and active Next transitions",
);
const nativeWorkoutCategories = workoutTimerSource.slice(
  workoutTimerSource.indexOf("setNotificationCategoryAsync(WORKOUT_TIMER_CATEGORY"),
  workoutTimerSource.indexOf("configured = true"),
);
assert.match(nativeWorkoutCategories, /identifier: WORKOUT_TIMER_NEXT/);
assert.match(
  nativeWorkoutCategories,
  /identifier: WORKOUT_TIMER_FINISH[\s\S]{0,140}opensAppToForeground: false/,
  "the final native action must finish in the background; only the notification body opens the app",
);
assert.equal(
  (nativeWorkoutCategories.match(/identifier: WORKOUT_TIMER_PAUSE/g) ?? [])
    .length,
  2,
  "both native workout categories must expose the restored Pause/resume control",
);
assert.doesNotMatch(
  nativeWorkoutCategories,
  /identifier: WORKOUT_TIMER_PAUSE[\s\S]{0,140}opensAppToForeground: true/,
  "native Pause/resume must stay a background action",
);
const nativeHeadlessActionBranch = workoutTimerSource.slice(
  workoutTimerSource.indexOf("if (nativeWorkoutActionsEnabled()) {"),
  workoutTimerSource.indexOf(
    "const ownerId = workoutNotificationOwnerId",
    workoutTimerSource.indexOf("if (nativeWorkoutActionsEnabled()) {"),
  ),
);
assert.match(
  nativeHeadlessActionBranch,
  /action === WORKOUT_TIMER_FINISH \|\|[\s\S]{0,80}action === WORKOUT_TIMER_NEXT[\s\S]{0,100}persistNativeFinishAction\(nested\)/,
  "explicit Finish and a potentially relabeled terminal Next must inspect the durable receipt queue",
);
assert.doesNotMatch(
  nativeHeadlessActionBranch,
  /action === WORKOUT_TIMER_PAUSE[\s\S]{0,100}persistNativeFinishAction/,
  "the proven native Pause path must remain unchanged",
);
assert.match(
  workoutTimerSource,
  /const finish = actions\.find\([\s\S]{0,120}WORKOUT_TIMER_FINISH[\s\S]{0,80}if \(!finish\) return false/,
  "an ordinary Next must stop after a read-only peek when Kotlin did not normalize it to Finish",
);
assert.match(
  workoutTimerSource,
  /peekWorkoutTimerNotificationActions[\s\S]{0,1600}persistBackgroundWorkoutFinish[\s\S]{0,500}acknowledgeWorkoutTimerNotificationActions/,
  "Finish must ACK its native receipt only after the durable background save",
);
const foregroundNativeDrain = workoutTimerSource.slice(
  workoutTimerSource.indexOf("export async function consumeWorkoutTimerActions"),
  workoutTimerSource.indexOf("export async function dismissWorkoutTimerNotification"),
);
assert.match(
  foregroundNativeDrain,
  /peekNativeActions[\s\S]{0,450}WORKOUT_TIMER_FINISH[\s\S]{0,500}persistBackgroundWorkoutFinish/,
  "foreground native replay must peek and durably persist Finish before ACK",
);
assert.doesNotMatch(
  foregroundNativeDrain,
  /consumeWorkoutTimerNotificationActions/,
  "foreground native replay must never destructively drain receipts before persistence",
);
assert.match(
  backgroundWorkoutFinishSource,
  /setItem\([\s\S]{0,180}backgroundWorkoutCompletionKey[\s\S]{0,500}multiSetAppStateStorage[\s\S]{0,300}removeItem\(workoutDraftKey/,
  "the recovery receipt must precede snapshot writes and draft removal",
);
assert.match(backgroundWorkoutFinishSource, /appAccountStorageKey\(ownerId\)/);
assert.match(
  backgroundWorkoutFinishSource,
  /sameFinish[\s\S]{0,1800}reconcileBackgroundWorkoutCompletion[\s\S]{0,700}multiSetAppStateStorage/,
  "a retry after receipt-first interruption must still repair both snapshots before ACK",
);
assert.match(
  backgroundWorkoutFinishSource,
  /removeBackgroundWorkoutCompletionExactUnlocked[\s\S]{0,300}sameFinish[\s\S]{0,180}removeItem/,
  "receipt retirement must compare owner, generation, and Finish timestamp",
);
const workoutOwnerFenceIndex = backgroundWorkoutFinishSource.indexOf(
  "if (activeState?.currentUserId !== ownerId) return null;",
);
const workoutReceiptWriteIndex = backgroundWorkoutFinishSource.indexOf(
  "await AsyncStorage.setItem(",
);
assert.ok(
  workoutOwnerFenceIndex >= 0 &&
    workoutOwnerFenceIndex < workoutReceiptWriteIndex,
  "background workout Finish must abort on an active-owner mismatch before writing its receipt or snapshots",
);
assert.match(
  appProviderSource,
  /readBackgroundWorkoutCompletion\(currentUserId\)[\s\S]{0,1300}reconcileBackgroundWorkoutCompletion/,
  "a still-alive provider must merge a headless Finish receipt on resume",
);
const foregroundPersistence = appProviderSource.slice(
  appProviderSource.indexOf("export function persistAppStateNow"),
  appProviderSource.indexOf("function mergeBackgroundHealthRows"),
);
assert.match(
  foregroundPersistence,
  /runAppStateStorageMutation\(async[\s\S]{0,700}getAppStateStorageItem\(APP_STORAGE_KEY\)[\s\S]{0,1800}mergeBackgroundHealthRows[\s\S]{0,1300}JSON\.stringify[\s\S]{0,400}multiSetAppStateStorage/,
  "foreground snapshots must re-read and rebase background state before serializing inside the mutation gate",
);
assert.match(
  foregroundPersistence,
  /multiSetAppStateStorage[\s\S]{0,400}return persistedState/,
  "foreground persistence must return the exact rebased state written to both snapshots",
);
assert.match(
  appProviderSource,
  /const persisted = await persistAppStateNow\(latest\)[\s\S]{0,700}persistenceStateRef\.current = persisted[\s\S]{0,500}retireBackgroundWorkoutCompletionIfResolved/,
  "memory must adopt the exact rebased snapshot before its workout receipt retires",
);
assert.match(
  backgroundWorkoutFinishSource,
  /retireBackgroundWorkoutCompletionIfResolved[\s\S]{0,900}getAppStateStorageItem\(APP_STORAGE_KEY\)[\s\S]{0,300}appAccountStorageKey\(ownerId\)[\s\S]{0,900}removeBackgroundWorkoutCompletionExactUnlocked/,
  "receipt retirement must verify both active and account recovery snapshots",
);
const healthNativeReadIndex = healthBackgroundSource.indexOf(
  "await nativeHealthAdapter.read",
);
const healthStateGateIndex = healthBackgroundSource.indexOf(
  "await runAppStateStorageMutation",
);
const healthCloudPublishIndex = healthBackgroundSource.indexOf(
  "await pushCloudRecentActivity",
);
assert.ok(
  healthNativeReadIndex >= 0 &&
    healthNativeReadIndex < healthStateGateIndex &&
    healthStateGateIndex < healthCloudPublishIndex,
  "Health Connect reads and cloud publishing must stay outside the shared local snapshot write gate",
);
assert.match(
  healthBackgroundSource,
  /runAppStateStorageMutation[\s\S]{0,900}getAppStateStorageItem\(APP_STORAGE_KEY\)[\s\S]{0,1800}applyBackgroundHealthRecords[\s\S]{0,1600}multiSetAppStateStorage/,
  "background health must rebase its records onto the newest account snapshot inside the same gate as workout Finish",
);
const healthMutationGate = healthBackgroundSource.slice(
  healthBackgroundSource.indexOf("await runAppStateStorageMutation"),
  healthBackgroundSource.indexOf("if (!applied)"),
);
assert.match(
  healthMutationGate,
  /multiSetAppStateStorage[\s\S]{0,1600}AsyncStorage\.setItem\(\s*statusKey/,
  "background health state and its replacement checkpoint must complete in the same local mutation gate",
);
assert.match(
  healthBackgroundSource,
  /getAppStateStorageItem\(APP_STORAGE_KEY\)[\s\S]{0,500}activeState\?\.currentUserId !== state\.currentUserId[\s\S]{0,500}healthSyncSchedule\([\s\S]{0,180}latest\.settings\.syncMode[\s\S]{0,180}latest\.settings\.healthSync\.backgroundIntervalHours[\s\S]{0,500}!latestSchedule\.requestsBackground/,
  "background health must abort after an account switch and re-check the latest background-sync schedule before writing",
);
assert.doesNotMatch(
  healthBackgroundSource,
  /AsyncStorage\.multiSet\(\[/,
  "background health must not bypass serialized app-state persistence",
);
assert.match(
  gymSource,
  /readBackgroundWorkoutCompletion\(state\.currentUserId\)[\s\S]{0,1800}setWorkoutTimer\(null\)/,
  "the Workout tab must clear its stale in-memory timer after a headless Finish",
);
assert.match(gymSource, /document\.visibilityState === "visible"/);
const webWorkoutLifecycle = gymSource.slice(
  gymSource.indexOf('if (Platform.OS !== "web" || tutorialSandbox) return;'),
  gymSource.indexOf("workoutTimer?.exerciseId", gymSource.indexOf('if (Platform.OS !== "web" || tutorialSandbox) return;')),
);
assert.doesNotMatch(
  webWorkoutLifecycle,
  /setInterval/,
  "the Web workout notification must not depend on a hidden-page interval",
);
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
  webWorker.indexOf(
    "  event.notification.close();",
    webWorker.indexOf('self.addEventListener("notificationclick"'),
  ),
);
assert.match(workoutActionBranch, /event\.waitUntil\([\s\S]*storeWorkoutAction\(queuedAction\)/);
assert.match(workoutActionBranch, /return;\s*\}/);
assert.doesNotMatch(
  workoutActionBranch,
  /\.focus\(|\.navigate\(|openWindow\(/,
  "workout action buttons must never open, navigate, or focus the PWA",
);
assert.match(
  webWorker,
  /event\.notification\.close\(\);\s*\/\/ A notification-body click/,
  "only a notification-body click should explicitly close the live row",
);
assert.doesNotMatch(
  workoutActionBranch,
  /notification\.close\(/,
  "workout controls must not explicitly dismiss the live notification row",
);
const timerActionMapping = gymSource.slice(
  gymSource.indexOf("timerActionRef.current ="),
  gymSource.indexOf("useEffect(() => {", gymSource.indexOf("timerActionRef.current =")),
);
assert.match(timerActionMapping, /WORKOUT_TIMER_PAUSE[\s\S]{0,160}pauseWorkout/);
assert.match(timerActionMapping, /WORKOUT_TIMER_RESUME[\s\S]{0,80}resumeWorkout/);
assert.match(timerActionMapping, /WORKOUT_TIMER_NEXT[\s\S]{0,80}advanceWorkoutTimer/);
const webPauseMapping = timerActionMapping.slice(
  timerActionMapping.indexOf("action === WORKOUT_TIMER_PAUSE"),
  timerActionMapping.indexOf("action === WORKOUT_TIMER_RESUME"),
);
assert.doesNotMatch(
  webPauseMapping,
  /advanceWorkoutTimer/,
  "the Web Pause action must never share the Next transition",
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
const workerEffects = {
  focused: 0,
  navigated: 0,
  opened: 0,
  closed: 0,
  messages: [],
};
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
      close() {
        workerEffects.closed += 1;
      },
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
await clickWorkoutAction("workout-resume");
await clickWorkoutAction("workout-pause");
await clickWorkoutAction("workout-next");
await clickWorkoutAction("workout-pause", "second-opaque-session-token");
assert.equal(workerEffects.messages.length, 0);
assert.equal(fakeWorkoutActionDb.rows.size, 5);
assert.equal(workerEffects.focused, 0);
assert.equal(workerEffects.navigated, 0);
assert.equal(workerEffects.opened, 0);
assert.equal(workerEffects.closed, 0);
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
  ["workout-pause", "workout-resume", "workout-pause", "workout-next"],
);
assert.equal(
  new Set(Array.from(drained.actions, (item) => item.id)).size,
  4,
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
assert.equal(workerEffects.closed, 0);
let bodyWork;
notificationClick({
  action: "",
  notification: {
    close() {
      workerEffects.closed += 1;
    },
    data: { route: "/gym", workoutTimer: true },
  },
  waitUntil(work) {
    bodyWork = work;
  },
});
await bodyWork;
assert.equal(workerEffects.navigated, 1);
assert.equal(workerEffects.focused, 1);
assert.equal(workerEffects.opened, 0);
assert.equal(workerEffects.closed, 1);
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
assert.match(gymSource, /processedNativeWorkoutActionIds/);
assert.match(
  gymSource,
  /pendingNativeTimerActionAcks[\s\S]{0,1800}workoutDraftPersistenceRef\.current[\s\S]{0,500}acknowledgeNativeWorkoutTimerAction/,
  "ordinary native receipts must ACK only after their processed draft is durable",
);
assert.match(
  gymSource,
  /next\.action === WORKOUT_TIMER_FINISH[\s\S]{0,120}flushLocalPersistence/,
  "foreground Finish must flush its saved session before the exact native ACK",
);
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
  /consumeWorkoutTimerActions\(ownerId: string\)[\s\S]{0,4200}item\.ownerId === ownerId && item\.generation === generation/,
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
const persistentWorkoutBuilder = androidNotificationServiceSource.slice(
  androidNotificationServiceSource.indexOf("private fun buildPersistentNotification"),
  androidNotificationServiceSource.indexOf("private fun dismissedPendingIntent"),
);
assert.match(persistentWorkoutBuilder, /NotificationAction\(NEXT_ACTION/);
assert.match(
  persistentWorkoutBuilder,
  /NotificationAction\(FINISH_ACTION, "Finish workout", false\)/,
  "the restored final action must not open the app",
);
assert.match(
  persistentWorkoutBuilder,
  /NotificationAction\(\s*PAUSE_ACTION,[\s\S]{0,100}if \(flow\.paused\) "Resume" else "Pause"[\s\S]{0,80}false/,
  "a restored persistent workout notification must recreate background Pause/resume",
);
assert.match(
  androidNotificationServiceSource,
  /flow\.paused -> previousActions\.mapIndexed[\s\S]{0,160}relabel\(action, "Resume"\)[\s\S]{0,260}relabel\(action, "Pause"\)/,
  "native in-place notification refreshes must retain both progression and Pause/resume controls",
);
assert.doesNotMatch(androidNotificationServiceSource, /startForegroundService/);
assert.match(androidPluginSource, /HabHubWorkoutNotificationPersistenceReceiver/);
assert.match(
  androidNotificationServiceSource,
  /fun consumeActions\([\s\S]{0,350}ACTIVE_OWNER_KEY[\s\S]{0,200}GENERATION_KEY[\s\S]{0,600}item\.optString\("ownerId"\) == ownerId[\s\S]{0,120}item\.optString\("generation"\) == generation/,
  "native queued actions must remain private to their owner and generation",
);
assert.match(
  androidNotificationServiceSource,
  /fun peekActions\([\s\S]{0,350}ACTIVE_OWNER_KEY[\s\S]{0,200}GENERATION_KEY/,
  "headless Finish may inspect only its active account generation",
);
assert.match(
  androidNotificationServiceSource,
  /fun acknowledgeActionsThrough\([\s\S]{0,900}occurredAt[\s\S]{0,250}putString\(ACTIONS_KEY, remaining\.toString\(\)\)/,
  "native receipts must remain queued until an explicit through-timestamp ACK",
);
assert.match(
  androidNotificationServiceSource,
  /NEXT_ACTION ->[\s\S]{0,700}flow\.index < flow\.steps\.lastIndex[\s\S]{0,300}flow\.finished = true[\s\S]{0,300}queuedAction = FINISH_ACTION/,
  "a relabeled final Next PendingIntent must be persisted as a Finish receipt",
);
assert.match(androidNativeSource, /peekWorkoutTimerNotificationActions/);
assert.match(androidNativeSource, /acknowledgeWorkoutTimerNotificationActions/);
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
assert.match(
  metricEditorSource,
  /tracker\?\.reminders\?\.some\(\(item\) => item\.enabled\)/,
  "the tracker editor must preserve enabled canonical multi-reminders",
);
assert.match(
  metricEditorSource,
  /onChange=\{\(value\) => \{\s*setReminderEnabled\(true\);\s*setReminderTimes/,
  "choosing a reminder time must also enable reminder delivery",
);
assert.match(
  metricEditorSource,
  /onPress=\{\(\) => \{\s*setReminderEnabled\(true\);\s*setReminderTimes\(\(current\) => \[\.\.\.current, "19:00"\]\)/,
  "adding a reminder time must not silently leave reminders disabled",
);
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
assert.match(layoutSource, /createNotificationResponseClaimGate\(\)/);
assert.match(
  layoutSource,
  /if \(!active\) return;[\s\S]{0,320}!claimNotificationResponse\(/,
  "unmounted and duplicate notification responses must be ignored before routing",
);
assert.match(
  layoutSource,
  /notificationResponseDisposition\([\s\S]{0,2400}router\.push[\s\S]{0,1200}clearLastNotificationResponseAsync/,
  "a native response must wait for account readiness and clear only after routing",
);
assert.match(
  layoutSource,
  /shouldDeferWorkoutNotificationResponseClear\([\s\S]{0,2400}router\.push[\s\S]{0,1400}if \(deferClearToGym\) return;[\s\S]{0,500}clearLastNotificationResponseAsync/,
  "root must route but retain an actionable iOS workout response for Gym",
);
assert.match(
  gymSource,
  /Platform\.OS !== "ios"[\s\S]{0,500}setPendingIosTimerResponses/,
  "Gym must queue an actionable iOS response instead of applying it during cold mount",
);
assert.match(
  gymSource,
  /workoutNotificationActionDisposition\([\s\S]{0,500}disposition === "wait"[\s\S]{0,900}timerActionRef\.current/,
  "Gym must wait for its restored draft before applying the iOS action",
);
assert.match(
  gymSource,
  /pendingIosTimerResponseAcks[\s\S]{0,9000}workoutDraftPersistenceRef\.current[\s\S]{0,800}flushLocalPersistence\(\)[\s\S]{0,900}clearLastNotificationResponseAsync/,
  "Gym must durably persist the applied action before clearing Expo's handoff",
);
assert.match(
  layoutSource,
  /landingApplied\.current = true;[\s\S]{0,260}cancelDefaultLanding\.current\?\.\(\);[\s\S]{0,500}router\.push/,
  "a notification tap must revoke a queued default landing before routing",
);
assert.match(
  layoutSource,
  /scheduleGuardedDefaultLanding\(\{[\s\S]{0,300}landingDecisionVersion\.current === decisionVersion/,
  "the delayed landing callback must retain the current navigation decision",
);
assert.match(layoutSource, /setPendingNotificationResponse\(response\)/);
assert.match(adapterSource, /accountId: ownerId/);
assert.match(workoutTimerSource, /accountId: flow\.ownerId/);
assert.match(liveTimerSource, /accountId: ownerId/);
assert.match(
  layoutSource,
  /getLastNotificationResponseAsync\(\)[\s\S]{0,180}\.catch\(\(\) => undefined\)/,
  "cold-start response lookup failures must not become unhandled rejections",
);
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
assert.match(webScheduleSource, /"streak-guard-v1"/);
assert.match(webScheduleSource, /notificationKind: "streak-guard"/);
assert.match(webScheduleSource, /notificationTitle\(\s*reminder\.label/);
assert.doesNotMatch(
  webScheduleSource,
  /const title = reminder\.label \?\? /,
  "blank optional tracker labels must fall back before the atomic Web schedule RPC",
);
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
assert.match(
  webScheduleSyncSource,
  /if \(!data\.session\)[\s\S]{0,120}throw new Error/,
  "a cached Web identity without a live session must retry instead of silently accepting an empty sync",
);
assert.doesNotMatch(
  layoutSource,
  /auth\.session\?\.user\.id !== auth\.user\.id \|\|[\s\S]{0,120}state\.currentUserId/,
  "the Web reminder effect must run and let the authoritative Supabase session check retry",
);
assert.match(webScheduleSyncSource, /data\.session\.user\.id !== state\.currentUserId/);
assert.match(webScheduleSyncSource, /Number\(acceptedCount\) !== events\.length/);
assert.match(webScheduleSyncSource, /WEB_REMINDER_SCHEDULE_REPAIR_MS/);
assert.match(webScheduleSyncSource, /acceptedAt: Date\.now\(\)/);
assert.match(webPushSource, /showImmediateWebNotification/);
assert.match(source, /deliverImmediatePersonalNotification/);
assert.match(
  source,
  /workoutCompletionCanNotify\(\{[\s\S]{0,260}localDate: latest\.localDate[\s\S]{0,260}today: dateKey\(\)/,
  "workout-save acknowledgements must be gated to a genuinely recent completion today",
);
assert.match(
  source,
  /if \(shouldNotify\) \{[\s\S]{0,4200}AsyncStorage\.setItem\(achievementKey, latest\.id\)/,
  "hydrated or quiet-hour workout history must still establish a silent notification baseline",
);
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
assert.doesNotMatch(
  webScheduleRouteValidationRepair,
  /\{\d+,\d{3,}\}/,
  "Web reminder validation must not use repetition counts unsupported by PostgreSQL",
);
assert.match(
  webScheduleRouteValidationRepair,
  /char_length\(v_route\) not between 1 and 1001/,
);
assert.match(webScheduleRouteValidationRepair, /left\(v_route, 1\) <> '\/'/);
assert.match(webScheduleRouteValidationRepair, /v_route ~ '\[\[:space:\]\]'/);
assert.match(
  webScheduleRepairMigration,
  /configure_web_personal_notification_worker/,
);
assert.match(webScheduleRepairMigration, /grant execute[\s\S]{0,160}to service_role/);
assert.match(
  webScheduleRepairMigration,
  /web_personal_notification_worker_url is not configured/,
);
assert.match(
  webScheduleRepairMigration,
  /web_personal_notification_worker_secret is not configured/,
);
assert.match(
  webScheduleRepairMigration,
  /web_personal_notification_reopen_retryable/,
);
assert.match(
  webScheduleRepairMigration,
  /old\.last_error = 'preference_suppressed'/,
);
assert.match(
  webScheduleRepairMigration,
  /web_push_subscription_wake_personal_notifications/,
);
assert.doesNotMatch(
  webScheduleRepairMigration,
  /nullif\([^;]{0,200}then return/,
);
assert.match(
  webScheduleCpuGuardMigration,
  /create or replace function public\.invoke_web_personal_notification_worker\(\)/,
);
assert.match(webScheduleCpuGuardMigration, /scheduled\.dispatched_at is null/);
assert.match(webScheduleCpuGuardMigration, /scheduled\.next_attempt_at <= clock_timestamp\(\)/);
assert.match(webScheduleCpuGuardMigration, /scheduled\.scheduled_for <= clock_timestamp\(\)/);
assert.ok(
  webScheduleCpuGuardMigration.indexOf("if not exists") <
    webScheduleCpuGuardMigration.lastIndexOf("from vault.decrypted_secrets"),
  "an idle reminder tick must return before Vault reads and pg_net",
);
assert.match(webScheduleWorker, /PERSONAL_NOTIFICATION_WORKER_SECRET/);
assert.match(webScheduleWorker, /constantTimeEqual/);
assert.match(webScheduleWorker, /web_personal_notification_acceptances/);
assert.match(webScheduleWorker, /payload\.action === "configure"/);
assert.match(webScheduleWorker, /No active Web Push subscription is registered/);
assert.match(webScheduleWorker, /gatewayAccepted === 0/);
assert.match(webScheduleWorker, /status === 404 \|\| status === 410/);
assert.match(webScheduleWorker, /preferenceAllowed/);
for (const endpoint of [
  "https://fcm.googleapis.com/fcm/send/example",
  "https://updates.push.services.mozilla.com/wpush/v2/example",
  "https://web.push.apple.com/example",
  "https://wns2-db5p.notify.windows.com/w/?token=example",
]) {
  assert.equal(
    isAllowedWebPushEndpoint(endpoint),
    true,
    `supported browser push endpoint was rejected: ${endpoint}`,
  );
}
for (const endpoint of [
  "http://fcm.googleapis.com/fcm/send/example",
  "https://fcm.googleapis.com.evil.example/fcm/send/example",
  "https://evilpush.apple.com/example",
  "https://user@fcm.googleapis.com/fcm/send/example",
  "https://fcm.googleapis.com:8443/fcm/send/example",
  "https://127.0.0.1/push",
  "https://[::1]/push",
  "https://updates.push.services.mozilla.com/wpush#fragment",
]) {
  assert.equal(
    isAllowedWebPushEndpoint(endpoint),
    false,
    `untrusted browser push endpoint was accepted: ${endpoint}`,
  );
}
assert.match(trustedWebPushHelper, /hostnameInSuffix/);
assert.match(trustedWebPushMigration, /web_push_subscriptions_trusted_endpoint_check/);
assert.match(trustedWebPushMigration, /delete_exact_stale_web_push_subscriptions/);
assert.match(trustedWebPushMigration, /registration_updated_at timestamptz/);
assert.match(webScheduleWorker, /isAllowedWebPushEndpoint/);
assert.match(webScheduleWorker, /registration_updated_at/);
assert.match(webScheduleWorker, /delete_exact_stale_web_push_subscriptions/);
assert.doesNotMatch(
  webScheduleWorker,
  /from\("web_push_subscriptions"\)[\s\S]{0,180}\.delete\(\)[\s\S]{0,120}\.in\("endpoint"/,
  "personal reminder cleanup must never broadly delete a refreshed or reassigned endpoint",
);
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
