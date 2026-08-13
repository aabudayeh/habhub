import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { scheduleEventsForDate } from "../src/domain/calendar.ts";
import { reconcileAutomaticFasting } from "../src/domain/fasting.ts";

const ui = fs.readFileSync("src/components/ui.tsx", "utf8");
const calendar = fs.readFileSync("src/domain/calendar.ts", "utf8");
const appProvider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const healthProvider = fs.readFileSync(
  "src/health/HealthSyncProvider.tsx",
  "utf8",
);
const fasting = fs.readFileSync("src/domain/fasting.ts", "utf8");

assert.match(
  ui,
  /onScroll=\{[\s\S]{0,100}?tutorialActive \|\| onScroll[\s\S]{0,500}?: undefined/,
  "ordinary Screens must not subscribe the JS thread to every native scroll frame",
);
assert.match(
  ui,
  /scrollEventThrottle=\{[\s\S]{0,100}?tutorialActive \|\| onScroll[\s\S]{0,250}?: undefined/,
  "16 ms scroll delivery must be limited to real consumers and the live tutorial",
);
assert.match(calendar, /entriesForUserDay\(state\.entries/);
assert.match(calendar, /hasEntryAtRecordedTime\(/);
assert.doesNotMatch(
  calendar,
  /const entryLogs:[\s\S]{0,100}?state\.entries\.flatMap/,
  "Schedule must not rescan all historical entries for each visible day",
);
assert.match(
  fasting,
  /changedEntries !== undefined[\s\S]{0,180}metricId === undefined[\s\S]{0,180}!changedEntries\.some/,
  "non-food Health imports must bypass full automatic-fasting reconciliation",
);
assert.match(
  appProvider,
  /commitReducedState\(next, !deferPersistence\)/,
  "device-owned foreground imports must be able to defer monolithic JSON persistence",
);
assert.match(
  appProvider,
  /const changed = next !== previous;[\s\S]{0,180}ephemeral \|\| !changed/,
  "an unchanged health re-read must not rescan progress notifications",
);
const repairStart = healthProvider.indexOf(
  "const runStepsRepair = useCallback",
);
const fullSyncStart = healthProvider.indexOf(
  "const runSync = useCallback",
  repairStart,
);
assert.ok(repairStart >= 0 && fullSyncStart > repairStart);
const repair = healthProvider.slice(repairStart, fullSyncStart);
assert.equal(
  repair.match(/await importHealthEntries\(/g)?.length ?? 0,
  1,
  "one repair batch must cause one reducer/render pass, not one per native slice",
);
assert.match(repair, /batchRecords\.push\(\.\.\.records\)/);
const firstRepairPause = repair.indexOf(
  "setCloudSyncPaused('health-steps-repair', true)",
);
const firstRepairRead = repair.indexOf("await nativeHealthAdapter.read");
assert.ok(
  firstRepairRead >= 0 && firstRepairPause > firstRepairRead,
  "history reads must not block chat/outbox cloud recovery",
);
assert.match(
  repair,
  /setCloudSyncPaused\('health-steps-repair', true\)[\s\S]{0,300}await importHealthEntries\(/,
  "the cloud gate must remain open during native history reads",
);

const metric = (id, name, unit = "", timerEnabled = false) => ({
  id,
  name,
  unit,
  timerEnabled,
  dataType: "number",
  color: "#123456",
  goal: { kind: "at_least", target: 1 },
});
const targetDate = "2099-01-02";
const entries = Array.from({ length: 50_000 }, (_, index) => ({
  id: `history-${index}`,
  metricId: "steps",
  userId: "owner",
  localDate: "2000-01-01",
  recordedAt: `2000-01-01T00:${String(index % 60).padStart(2, "0")}:00.000`,
  value: index,
  visibility: "group",
}));
entries.push(
  {
    id: "food",
    metricId: "food",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T12:00:00.000`,
    value: 500,
    visibility: "group",
  },
  {
    id: "protein",
    metricId: "protein",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T12:00:00.000`,
    value: 30,
    visibility: "group",
  },
  {
    id: "systolic",
    metricId: "blood_pressure_systolic",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T13:00:00.000`,
    value: 120,
    visibility: "group",
  },
  {
    id: "diastolic",
    metricId: "blood_pressure_diastolic",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T13:00:00.000`,
    value: 75,
    visibility: "group",
  },
  {
    id: "pulse",
    metricId: "pulse",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T13:00:00.000`,
    value: 62,
    visibility: "group",
  },
  {
    id: "timer",
    metricId: "reading",
    userId: "owner",
    localDate: "2099-01-01",
    recordedAt: `${targetDate}T00:15:00.000`,
    value: 30,
    visibility: "group",
  },
  {
    id: "today-steps",
    metricId: "steps",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T14:00:00.000`,
    value: 1234,
    visibility: "group",
  },
  {
    id: "other-user",
    metricId: "steps",
    userId: "peer",
    localDate: targetDate,
    recordedAt: `${targetDate}T15:00:00.000`,
    value: 999,
    visibility: "group",
  },
);

const state = {
  currentUserId: "owner",
  metrics: [
    metric("steps", "Steps", "steps"),
    metric("food", "Food", "kcal"),
    metric("protein", "Protein", "g"),
    metric("blood_pressure_systolic", "Blood pressure", "mmHg"),
    metric("blood_pressure_diastolic", "Diastolic", "mmHg"),
    metric("pulse", "Pulse", "bpm"),
    metric("reading", "Reading", "min", true),
  ],
  entries,
  todos: [],
  calendarReminders: [],
  gymSessions: [],
  settings: { calendarEventOrder: [] },
};

const startedAt = performance.now();
const events = scheduleEventsForDate(state, targetDate);
const firstPassMs = performance.now() - startedAt;
const eventIds = events.map((event) => event.id);

assert.ok(eventIds.includes("log:food"));
assert.ok(!eventIds.includes("log:protein"));
assert.ok(eventIds.includes("log:systolic"));
assert.ok(!eventIds.includes("log:diastolic"));
assert.ok(!eventIds.includes("log:pulse"));
assert.ok(eventIds.includes(`log:timer:${targetDate}`));
assert.ok(eventIds.includes("log:today-steps"));
assert.ok(!eventIds.includes("log:other-user"));

const cachedStartedAt = performance.now();
const repeated = scheduleEventsForDate(state, targetDate);
const cachedPassMs = performance.now() - cachedStartedAt;
assert.deepEqual(repeated, events, "indexed Schedule results must stay deterministic");

const fastingState = {
  currentUserId: "owner",
  metrics: [
    {
      ...metric("intermittent_fasting", "Intermittent fasting", "h"),
      fastingSettings: {
        automaticFoodBreak: true,
        startTime: "20:00",
        fastingMinutes: 16 * 60,
      },
    },
  ],
  entries: Array.from({ length: 50_000 }, (_, index) => ({
    id: `food-${index}`,
    metricId: "food",
    userId: "owner",
    localDate: "2000-01-01",
    recordedAt: `2000-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    value: 1,
    visibility: "private",
  })),
};
const fastingStartedAt = performance.now();
const unchangedFastingState = reconcileAutomaticFasting(fastingState, [
  {
    id: "today-steps-refresh",
    metricId: "steps",
    userId: "owner",
    localDate: targetDate,
    recordedAt: `${targetDate}T14:00:00.000Z`,
    value: 1234,
    visibility: "group",
  },
]);
const nonFoodFastingPassMs = performance.now() - fastingStartedAt;
assert.equal(
  unchangedFastingState,
  fastingState,
  "a Steps refresh must preserve state identity when fasting is unaffected",
);

console.log(
  `Interaction performance validation passed (50,000-row Schedule: ${firstPassMs.toFixed(1)} ms first, ${cachedPassMs.toFixed(1)} ms cached; non-food fasting bypass: ${nonFoodFastingPassMs.toFixed(3)} ms).`,
);
