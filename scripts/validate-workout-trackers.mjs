import assert from "node:assert/strict";
import fs from "node:fs";

import {
  canonicalWorkoutTrackerId,
  consolidateWorkoutTrackers,
} from "../src/domain/workoutTrackers.ts";
import {
  ANY_RECORDED_WORKOUT_QUALIFICATION,
  DEFAULT_WORKOUT_QUALIFICATION,
  workoutQualifies,
} from "../src/domain/workoutQualification.ts";

assert.equal(
  workoutQualifies(
    { activityKey: "walking", durationMinutes: 8 },
    DEFAULT_WORKOUT_QUALIFICATION,
  ),
  false,
  "an incidental walk must not complete Workout",
);
assert.equal(
  workoutQualifies(
    { activityKey: "walking", durationMinutes: 30 },
    DEFAULT_WORKOUT_QUALIFICATION,
  ),
  true,
);
assert.equal(
  workoutQualifies(
    { activityKey: "running", durationMinutes: 20 },
    DEFAULT_WORKOUT_QUALIFICATION,
  ),
  true,
);
assert.equal(
  workoutQualifies(
    { activityKey: "walking", durationMinutes: 1 },
    ANY_RECORDED_WORKOUT_QUALIFICATION,
  ),
  true,
);
assert.equal(
  workoutQualifies(
    { activityKey: "running", durationMinutes: 35, distanceKm: 3 },
    {
      rules: [
        {
          activity: "running",
          thresholdMode: "all",
          minimumDurationMinutes: 30,
          minimumDistanceKm: 5,
        },
      ],
    },
  ),
  false,
  "all-mode must enforce every configured minimum",
);

const metric = (id, overrides = {}) => ({
  id,
  name: id,
  icon: "barbell-outline",
  color: "#000000",
  unit: "",
  dataType: "boolean",
  aggregation: "max",
  rankingDirection: "higher",
  goal: { kind: "complete", target: 1 },
  scoreWeight: 0,
  defaultVisibility: "group",
  sections: { today: false, group: false, insights: true },
  order: 0,
  activeFrom: "2026-08-01",
  ...overrides,
});

const canonicalWorkout = metric("workout", {
  name: "Workout",
  healthMapping: { dataType: "workouts", field: "value" },
  gymMapping: { kind: "session_completed" },
});
const canonicalDuration = metric("workout_duration", {
  name: "Workout duration",
  unit: "min",
  dataType: "number",
  aggregation: "sum",
  goal: { kind: "at_least", target: 30 },
  healthMapping: { dataType: "workouts", field: "duration_minutes" },
  gymMapping: { kind: "session_duration" },
  order: 1,
});

const settings = {
  progressMetricIds: ["gym_completed", "workout", "gym_duration"],
  progressMetricOrderIds: ["gym_completed"],
  progressPinnedMetricIds: ["gym_duration"],
  performanceMetricIds: ["gym_completed"],
  leaderboardMetricIdsByGroup: { group: ["gym_duration"] },
  comparisonMetricIdsByGroup: { group: ["gym_completed"] },
  leaderboardCardOrderByGroup: { group: ["gym_completed", "challenge:one"] },
  trackerViewFilters: [{ id: "all", name: "All", metricIds: ["gym_completed"] }],
  scheduleViewFilters: [{ id: "all", name: "All", includeTodos: true, includeReminders: true, logMetricIds: ["gym_duration"] }],
  todayHistoryByMetric: { gym_duration: "month" },
  notifications: { metricIds: ["gym_completed"] },
};
const legacyWorkout = metric("gym_completed", {
  name: "Workout completed",
  sections: { today: true, group: true, insights: true },
  activeFrom: "2026-07-01",
  reminders: [{ enabled: true, time: "18:00" }],
});
const legacyDuration = metric("gym_duration", {
  name: "Workout duration",
  unit: "min",
  dataType: "number",
  aggregation: "sum",
  goal: { kind: "at_least", target: 45 },
  order: 2,
});
const volume = metric("gym_total_volume", {
  name: "Workout volume",
  dataType: "number",
  gymMapping: { kind: "session_volume" },
  order: 3,
});
const group = {
  id: "group",
  metricConfiguration: [legacyWorkout, canonicalWorkout, legacyDuration, volume],
};
const defaults = {
  metrics: [canonicalWorkout, canonicalDuration, volume],
  group: { ...group, metricConfiguration: [canonicalWorkout, canonicalDuration, volume] },
};
const state = {
  metrics: [legacyWorkout, canonicalWorkout, legacyDuration, volume],
  settings,
  trackedGoalPeriods: {
    workout: [{ from: "2026-08-01" }],
    gym_completed: [{ from: "2026-07-01", to: "2026-07-31" }],
    gym_duration: [{ from: "2026-07-15" }],
  },
  entries: [
    { id: "old-complete", metricId: "gym_completed", userId: "u" },
    { id: "old-duration", metricId: "gym_duration", userId: "u" },
  ],
  dailyMetricStatuses: [
    { groupId: "group", metricId: "gym_completed", userId: "u", localDate: "2026-08-01" },
    { groupId: "group", metricId: "workout", userId: "u", localDate: "2026-08-01", goalReached: true },
  ],
  journalNotes: [{ id: "note", metricId: "gym_completed", metricIds: ["gym_duration"] }],
  calendarReminders: [{ id: "reminder", metricId: "gym_duration" }],
  activityTimers: [{ id: "timer", metricId: "gym_duration" }],
  activeTimer: { id: "active", metricId: "gym_duration" },
  group,
  groups: [group],
  selectedGroupMetricId: "gym_completed",
};

const consolidated = consolidateWorkoutTrackers(state, defaults);
assert.equal(canonicalWorkoutTrackerId("gym_completed"), "workout");
assert.equal(canonicalWorkoutTrackerId("gym_duration"), "workout_duration");
assert.equal(canonicalWorkoutTrackerId("gym_total_volume"), "gym_total_volume");
assert.deepEqual(
  consolidated.metrics.map((item) => item.id),
  ["workout", "workout_duration", "gym_total_volume"],
);
assert.equal(consolidated.metrics[0].gymMapping.kind, "session_completed");
assert.equal(consolidated.metrics[0].sections.today, true);
assert.equal(consolidated.metrics[0].activeFrom, "2026-07-01");
assert.equal(consolidated.metrics[1].gymMapping.kind, "session_duration");
assert.deepEqual(consolidated.settings.progressMetricIds, ["workout", "workout_duration"]);
assert.deepEqual(consolidated.entries.map((entry) => entry.metricId), ["workout", "workout_duration"]);
assert.equal(consolidated.dailyMetricStatuses.length, 1);
assert.equal(consolidated.dailyMetricStatuses[0].goalReached, true);
assert.equal(consolidated.journalNotes[0].metricId, "workout");
assert.deepEqual(consolidated.journalNotes[0].metricIds, ["workout_duration"]);
assert.equal(consolidated.calendarReminders[0].metricId, "workout_duration");
assert.equal(consolidated.activityTimers[0].metricId, "workout_duration");
assert.equal(consolidated.selectedGroupMetricId, "workout");
assert.deepEqual(
  consolidateWorkoutTrackers(consolidated, defaults),
  consolidated,
  "workout consolidation must be idempotent",
);

const seed = fs.readFileSync("src/data/seed.ts", "utf8");
const catalog = fs.readFileSync("src/domain/trackerCatalog.ts", "utf8");
const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const migration = fs.readFileSync("src/domain/stateMigration.ts", "utf8");
const editor = fs.readFileSync("app/metric-editor.tsx", "utf8");
const health = fs.readFileSync("src/domain/health.ts", "utf8");
const log = fs.readFileSync("app/(tabs)/log.tsx", "utf8");
assert.match(seed, /id: "workout"[\s\S]{0,500}gymMapping: \{ kind: "session_completed" \}/);
assert.match(seed, /id: "workout_duration"[\s\S]{0,500}gymMapping: \{ kind: "session_duration" \}/);
assert.match(seed, /id: "workout"[\s\S]{0,600}workoutQualification: DEFAULT_WORKOUT_QUALIFICATION/);
assert.doesNotMatch(seed, /id: "workout_calories"/);
assert.doesNotMatch(provider, /metricId: "workout_calories"/);
assert.match(provider, /workoutQualifies\(/);
assert.match(health, /workoutCompletionQualifies/);
assert.match(migration, /RETIRED_METRIC_IDS = new Set\(\["workout_calories"\]\)/);
assert.match(editor, /What counts as a workout/);
assert.doesNotMatch(catalog, /templateId: "gym_completed"/);
assert.doesNotMatch(catalog, /templateId: "gym_duration"/);
assert.doesNotMatch(onboarding.match(/gym: \[([^\]]+)\]/)?.[1] ?? "", /gym_completed|gym_duration|gym_total_volume/);
assert.match(provider, /historyMode: "today" \| "history"/);
assert.match(provider, /action\.historyMode === "history"[\s\S]{0,100}goalHistoryStart/);
assert.match(migration, /consolidateWorkoutTrackers\(state, defaults\)/);
assert.match(
  log,
  /selected\.dataType === "boolean" && selected\.id !== "workout"/,
  "Workout logging must use its detail/Add flow rather than a redundant Mark as complete toggle",
);

console.log("Canonical workout tracker merge, compatibility aliases, and onboarding recommendations validated.");
