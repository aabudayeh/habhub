import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { scheduleEventsForDate } from "../src/domain/calendar.ts";
import {
  orderedValueHash,
  stableValueHash,
} from "../src/domain/cloudHash.ts";
import { reconcileAutomaticFasting } from "../src/domain/fasting.ts";
import { networkReachability } from "../src/domain/network.ts";
import { accountOwnedCollections } from "../src/domain/accountCollections.ts";
import "./validate-responsive-work.mjs";
import "./validate-native-sync-performance.mjs";

const ui = fs.readFileSync("src/components/ui.tsx", "utf8");
const calendar = fs.readFileSync("src/domain/calendar.ts", "utf8");
const appProvider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const healthProvider = fs.readFileSync(
  "src/health/HealthSyncProvider.tsx",
  "utf8",
);
const cloudProvider = fs.readFileSync(
  "src/cloud/CloudSyncProvider.tsx",
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
  /localPersistenceProjectionCache = new WeakMap<AppState, AppState>/,
  "local persistence must reuse privacy-scoped projections for unchanged state",
);
assert.match(
  cloudProvider,
  /snapshotPayloadCache = new WeakMap<AppState, AppState>/,
  "cloud hashing and persistence must share one sanitized state projection",
);
assert.match(
  cloudProvider,
  /await waitForUi\(280, 1_200\)[\s\S]{0,500}fetchSnapshot/,
  "cached native accounts must yield their first interaction frames before online restore",
);
assert.match(
  appProvider,
  /persistenceResumeReadTaskRef\.current = scheduleResponsiveWork\([\s\S]{0,5000}minimumDelayMs: 320,[\s\S]{0,100}maximumDelayMs: 1_800/,
  "foreground cache reconciliation must not parse a full snapshot on the resume tap frame",
);
assert.equal(networkReachability(null, null), "unknown");
assert.equal(networkReachability(false, null), "offline");
assert.equal(networkReachability(true, null), "unknown");
assert.equal(networkReachability(true, true), "online");
assert.match(
  cloudProvider,
  /const reachability = networkReachability\([\s\S]{0,800}Platform\.OS === "web" && reachability === "unknown"/,
  "native startup must not treat nullable NetInfo fields as an online connection",
);
assert.match(
  cloudProvider,
  /const networkAvailable =\s*Boolean\(auth\.session\)/,
  "a cached display identity must not authorize cloud traffic before Supabase restores a real session",
);
assert.match(
  cloudProvider,
  /const startingOffline = !networkAvailableRef\.current;[\s\S]{0,800}setStatus\("offline"\)[\s\S]{0,3000}Promise\.all\(/,
  "the cached signed-in UI must enter offline mode before local metadata/network initialization",
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
const hashRows = entries.map((entry) => ({ ...entry }));
const firstHashStartedAt = performance.now();
const firstRowsHash = orderedValueHash(hashRows);
const firstHashMs = performance.now() - firstHashStartedAt;
const cachedHashStartedAt = performance.now();
const cachedRowsHash = orderedValueHash(hashRows);
const cachedHashMs = performance.now() - cachedHashStartedAt;
const changedRows = [...hashRows];
changedRows[changedRows.length - 1] = {
  ...changedRows[changedRows.length - 1],
  value: 999_999,
};
const changedHashStartedAt = performance.now();
const changedRowsHash = orderedValueHash(changedRows);
const changedHashMs = performance.now() - changedHashStartedAt;
assert.equal(firstRowsHash, cachedRowsHash);
assert.notEqual(changedRowsHash, cachedRowsHash);
assert.equal(stableValueHash({ b: 2, a: 1 }), stableValueHash({ a: 1, b: 2 }));
assert.ok(firstHashMs < 2_000, `First 50k-row hash took ${firstHashMs.toFixed(1)}ms`);
assert.ok(cachedHashMs < 150, `Cached 50k-row hash took ${cachedHashMs.toFixed(1)}ms`);
assert.ok(changedHashMs < 150, `One-row delta hash took ${changedHashMs.toFixed(1)}ms`);

const projectionRows = Array.from({ length: 50_000 }, (_, index) => ({
  id: `projection-${index}`,
  userId: index % 5 === 0 ? "peer" : "owner",
  senderId: index % 5 === 0 ? "peer" : "owner",
}));
const projectionState = {
  currentUserId: "owner",
  entries: projectionRows,
  photos: projectionRows,
  messages: projectionRows,
  dailyMetricStatuses: projectionRows,
};
const firstProjectionStartedAt = performance.now();
const firstProjection = accountOwnedCollections(projectionState);
const firstProjectionMs = performance.now() - firstProjectionStartedAt;
const wrappedProjectionState = {
  ...projectionState,
  settings: { darkMode: true },
};
const cachedProjectionStartedAt = performance.now();
const cachedProjection = accountOwnedCollections(wrappedProjectionState);
const cachedProjectionMs = performance.now() - cachedProjectionStartedAt;
assert.equal(firstProjection.entries.length, 40_000);
assert.equal(firstProjection.messages.length, 40_000);
assert.equal(cachedProjection.entries, firstProjection.entries);
assert.equal(cachedProjection.photos, firstProjection.photos);
assert.equal(cachedProjection.messages, firstProjection.messages);
assert.equal(
  cachedProjection.dailyMetricStatuses,
  firstProjection.dailyMetricStatuses,
);
const peerProjection = accountOwnedCollections({
  ...projectionState,
  currentUserId: "peer",
});
assert.equal(peerProjection.entries.length, 10_000);
assert.equal(peerProjection.messages.length, 10_000);
assert.notEqual(peerProjection.entries, firstProjection.entries);
const ownerOnlyRows = projectionRows.filter((row) => row.userId === "owner");
const ownerOnlyProjection = accountOwnedCollections({
  currentUserId: "owner",
  entries: ownerOnlyRows,
  photos: ownerOnlyRows,
  messages: ownerOnlyRows,
  dailyMetricStatuses: ownerOnlyRows,
});
assert.equal(ownerOnlyProjection.entries, ownerOnlyRows);
assert.equal(ownerOnlyProjection.messages, ownerOnlyRows);
assert.ok(
  firstProjectionMs < 500,
  `First four-collection 50k-row privacy projection took ${firstProjectionMs.toFixed(1)}ms`,
);
assert.ok(
  cachedProjectionMs < 25,
  `Cached privacy projection took ${cachedProjectionMs.toFixed(2)}ms`,
);
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
  `Interaction performance validation passed (50,000-row Schedule: ${firstPassMs.toFixed(1)} ms first, ${cachedPassMs.toFixed(1)} ms cached; hashes: ${firstHashMs.toFixed(1)} ms first, ${cachedHashMs.toFixed(1)} ms cached, ${changedHashMs.toFixed(1)} ms one-row delta; four privacy projections: ${firstProjectionMs.toFixed(1)} ms first, ${cachedProjectionMs.toFixed(2)} ms cached; non-food fasting bypass: ${nonFoodFastingPassMs.toFixed(3)} ms).`,
);
