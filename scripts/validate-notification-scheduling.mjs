import assert from "node:assert/strict";
import fs from "node:fs";

import {
  goalReminderNotificationId,
  goalReminderSemanticKey,
} from "../src/domain/notificationScheduling.ts";
import { createLatestAsyncDrain } from "../src/domain/latestAsyncDrain.ts";

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

const source = fs.readFileSync("src/notifications/push.ts", "utf8");
assert.match(source, /createLatestAsyncDrain<AppState>/);
assert.match(source, /identifier,\s*content:/);
assert.match(source, /notificationKind: 'goal-reminder'/);
assert.match(source, /scheduledSemantics\.has\(semanticKey\)/);
assert.match(source, /getAllScheduledNotificationsAsync\(\)/);
assert.match(source, /GOAL_LEGACY_CLEANUP/);
assert.match(source, /legacyMetric !== 'menstrual_cycle'/);
assert.match(
  source,
  /cleanup = cancelLegacyGoalReminderNotifications\(state\)\.finally/,
);
assert.match(source, /await ensureLegacyGoalReminderCleanup\(state\)/);
assert.match(
  source,
  /export async function syncProductivityNotifications[\s\S]{0,700}await ensureLegacyGoalReminderCleanup\(state\)/,
);
assert.doesNotMatch(
  source,
  /for \(const reminder of configured\.filter\(\(item\) => item\.enabled\)\)/,
);

console.log("Goal reminder scheduling is serialized and idempotent.");
