import assert from "node:assert/strict";
import fs from "node:fs";

import { FOOD_NUTRIENTS } from "../src/domain/food.ts";
import {
  metricAppearsInLogPicker,
  metricLoggingDestination,
  metricLoggingTargetId,
} from "../src/domain/metricLogging.ts";
import { manualWorkoutEntries } from "../src/domain/manualWorkout.ts";
import {
  registerLogDraftExitHandler,
  requestLogDraftExit,
} from "../src/components/logDraftNavigationGuard.ts";

const seed = fs.readFileSync("src/data/seed.ts", "utf8");
const baseMetric = (id, overrides = {}) => ({
  id,
  category: "other",
  dataType: "number",
  manualEntry: true,
  ...overrides,
});
const calculatedIds = new Set([
  "deficit",
  "weekly_deficit_balance",
  "cycle_day",
  "days_until_period",
  "overall_score",
]);
const metric = (id) => {
  assert.match(seed, new RegExp(`id: "${id}"`), `missing seeded metric ${id}`);
  if (calculatedIds.has(id)) return baseMetric(id, { dataType: "calculated" });
  if (id === "intermittent_fasting")
    return baseMetric(id, {
      fastingSettings: {
        startTime: "20:00",
        fastingMinutes: 960,
        automaticFoodBreak: true,
      },
    });
  if (["workout", "workout_duration", "workout_distance"].includes(id))
    return baseMetric(id, { healthMapping: { dataType: "workouts", field: "value" } });
  if (id === "exercise") return baseMetric(id, { category: "activity" });
  if (FOOD_NUTRIENTS.some((nutrient) => nutrient.id === id))
    return baseMetric(id, { category: "nutrition", healthMapping: { dataType: "nutrition", field: id } });
  if (["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"].includes(id))
    return baseMetric(id, { category: "body", healthMapping: { dataType: id, field: "value" } });
  if (id === "todo_completion") return baseMetric(id, { manualEntry: false });
  return baseMetric(id);
};
const allMetrics = [...seed.matchAll(/\bid: "([a-z0-9_]+)"/g)].map((match) => ({
  id: match[1],
}));

let guardedLeaveCalls = 0;
const unregisterLogGuard = registerLogDraftExitHandler((leave) => {
  leave();
  return true;
});
assert.equal(
  requestLogDraftExit(() => {
    guardedLeaveCalls += 1;
  }),
  true,
  "a mounted dirty Log editor must synchronously consume tab navigation",
);
assert.equal(guardedLeaveCalls, 1);
unregisterLogGuard();
assert.equal(
  requestLogDraftExit(() => {
    guardedLeaveCalls += 1;
  }),
  false,
  "an unmounted Log editor must not block unrelated tab navigation",
);
assert.equal(guardedLeaveCalls, 1);

for (const id of [
  "deficit",
  "weekly_deficit_balance",
  "todo_completion",
  "cycle_day",
  "days_until_period",
  "overall_score",
  "screen_time",
  "intermittent_fasting",
])
  assert.equal(metricLoggingDestination(metric(id)), "none", `${id} is derived`);

for (const id of [
  "workout",
  "workout_duration",
  "workout_distance",
  "exercise",
  "energy_burned",
])
  assert.equal(
    metricLoggingDestination(metric(id)),
    "workout",
    `${id} must open Workout`,
  );

for (const nutrient of FOOD_NUTRIENTS) {
  assert.equal(
    metricLoggingDestination(metric(nutrient.id)),
    "food",
    `${nutrient.id} must open Food logging`,
  );
  assert.equal(
    metricAppearsInLogPicker(metric(nutrient.id), allMetrics),
    false,
    `${nutrient.id} must not duplicate Food in the Log picker`,
  );
}

for (const id of ["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"])
  assert.equal(
    metricLoggingDestination(metric(id)),
    "weight",
    `${id} must open the Weight logger`,
  );

assert.equal(metricLoggingTargetId(metric("protein")), "food");
assert.equal(metricLoggingTargetId(metric("body_fat")), "weight");
assert.equal(metricLoggingTargetId(metric("workout")), "workout");
assert.equal(metricLoggingTargetId(metric("workout_duration")), "workout");
assert.equal(metricLoggingTargetId(metric("workout_distance")), "workout");
assert.equal(
  metricLoggingTargetId(metric("exercise")),
  "workout",
  "Active energy must open the compound workout logger rather than accepting an orphan calorie row",
);
assert.equal(metricAppearsInLogPicker(metric("food"), allMetrics), true);
assert.equal(metricAppearsInLogPicker(metric("weight"), allMetrics), true);
assert.equal(metricAppearsInLogPicker(metric("workout"), allMetrics), true);
assert.equal(metricAppearsInLogPicker(metric("workout_duration"), allMetrics), false);
assert.equal(metricAppearsInLogPicker(metric("workout_distance"), allMetrics), false);
assert.equal(metricAppearsInLogPicker(metric("exercise"), allMetrics), false);
assert.equal(metricAppearsInLogPicker(metric("energy_burned"), allMetrics), false);
assert.equal(metricAppearsInLogPicker(metric("pulse"), allMetrics), false);
for (const id of [
  "steps",
  "water",
  "progress_photo",
  "blood_pressure_systolic",
  "sleep",
  "blood_glucose",
  "menstrual_cycle",
  "menstrual_flow",
  "cycle_symptoms",
  "reading",
  "study",
  "work",
])
  assert.equal(
    metricLoggingDestination(metric(id)),
    "direct",
    `${id} must remain directly loggable`,
  );

const log = fs.readFileSync("app/(tabs)/log.tsx", "utf8");
const tabLayout = fs.readFileSync("app/(tabs)/_layout.tsx", "utf8");
const logDraftGuard = fs.readFileSync(
  "src/components/logDraftNavigationGuard.ts",
  "utf8",
);
const detail = fs.readFileSync("app/metric-detail.tsx", "utf8");
const metricSelector = fs.readFileSync("src/components/MetricSelector.tsx", "utf8");
assert.match(log, /title=\{selected \? "Log" : "What are you adding\?"\}/);
assert.match(
  log,
  /emptyLabel="Choose a tracker"[\s\S]*?openWhenEmpty/,
  "opening Log without a routed tracker must reveal the What are you adding chooser",
);
assert.match(
  metricSelector,
  /useState\(\s*\(\) => openWhenEmpty && selectedIds\.length === 0,?\s*\)/,
  "the empty Log chooser must render open on its first frame",
);
assert.match(
  metricSelector,
  /if \(openWhenEmpty\) setOpen\(selectedIds\.length === 0\)/,
  "an asynchronously routed tracker must close the initially empty chooser",
);
assert.match(
  log,
  /const required = \["body_fat", "lean_body_mass"\]/,
  "Weight logging must always expose Body fat and Lean body mass for older customized accounts",
);
assert.match(log, /id: "weight",\s*label: "Weight"/);
assert.doesNotMatch(
  log,
  /Weight is optional when you enter at least one composition value|Weight \(optional\)/,
  "the form inputs already communicate optionality without a duplicate disclaimer",
);
assert.match(log, /Enter weight or at least one body-composition value/);
assert.match(detail, /loggingDestination === "workout"/);
assert.match(detail, /loggingDestination === "food"[\s\S]{0,200}"Log food"/);
assert.match(detail, /loggingDestination === "weight"[\s\S]{0,200}"Weigh-in"/);
assert.match(
  detail,
  /metric\.manualEntry !== false \|\| metric\.id === "steps"/,
  "Steps must retain its Add action even when connected-health settings disable generic manual entry",
);
assert.match(
  detail,
  /const canSkipToday =\s*Boolean\(persistedTracker\) && tracker\.goalEnabled !== false/,
  "the normal Skip action must remain available when the selected detail date changes",
);
assert.doesNotMatch(
  detail,
  /const canSkipToday =[\s\S]{0,120}day === dateKey\(\)/,
  "Skip availability must not be coupled to the Today date view",
);
assert.match(
  detail,
  /typeof entry\.value === "number" \|\|\s*typeof entry\.value === "boolean"[\s\S]{0,100}formatMetricValue\(tracker, Number\(entry\.value\)\)/,
  "boolean Workout entries must use the normal Done label instead of rendering a literal true value",
);
assert.match(
  log,
  /visible=\{Boolean\(pendingExit\)\}[\s\S]*?>\s*Continue\s*<[\s\S]*?Discard[\s\S]*?Save/,
  "routed workout drafts must use the same three-action unsaved-change dialog",
);
assert.match(
  tabLayout,
  /tabPress:[\s\S]{0,420}requestLogDraftExit[\s\S]{0,180}event\.preventDefault\(\)/,
  "tab navigation must be prevented before a dirty Log tab loses focus",
);
assert.match(
  log,
  /registerLogDraftExitHandler[\s\S]{0,260}isFocusedRef\.current[\s\S]{0,180}requestDraftExitRef\.current/,
  "only the focused Log screen may consume a tab navigation attempt",
);
assert.match(
  log,
  /useWebBackNavigationGuard\([\s\S]{0,300}requestDraftExitRef\.current\(continueBack\)/,
  "browser Back must open the unsaved-log prompt before leaving",
);
assert.doesNotMatch(
  log,
  /navigation\.addListener\("blur"/,
  "a blur listener is too late because the user has already left the draft",
);
assert.doesNotMatch(
  log,
  /returnToEditor|router\.navigate\(\{[\s\S]{0,160}pathname:\s*"\/\(tabs\)\/log"/,
  "Continue must preserve the mounted editor instead of reconstructing a tracker picker route",
);
assert.match(
  logDraftGuard,
  /activeHandler\?\.\(leave\) \?\? false/,
  "the tab layout and mounted Log editor must share a synchronous navigation guard",
);
assert.match(
  log,
  /unsavedPromptActions:\s*\{[\s\S]{0,180}flexDirection:\s*"row"/,
  "the log exit actions must remain on one compact horizontal row",
);

const manualWorkout = manualWorkoutEntries({
  activeCalories: 240,
  activityKey: "walking",
  metricVisibilities: new Map([
    ["workout", "group"],
    ["workout_duration", "group"],
    ["workout_distance", "group"],
    ["exercise", "private"],
  ]),
  distanceKm: 4.2,
  durationMinutes: 35,
  eventId: "event-1",
  label: "Evening walk",
  localDate: "2026-08-28",
  note: "Easy pace",
  recordedAt: "2026-08-28T18:30:00.000Z",
  savedAt: "2026-08-28T18:31:00.000Z",
  userId: "user-1",
  visibility: "group",
});
assert.deepEqual(
  manualWorkout.map((entry) => entry.metricId),
  ["workout", "workout_duration", "workout_distance", "exercise"],
);
assert.equal(new Set(manualWorkout.map((entry) => entry.sourceRecordId)).size, 1);
assert.equal(new Set(manualWorkout.map((entry) => entry.recordedAt)).size, 1);
assert.deepEqual(
  manualWorkout.map((entry) => entry.stepCoverageActivityKey),
  ["walking", "walking", "walking", "walking"],
  "a canonical workout choice must reach every linked detail used by Step coverage",
);
assert.deepEqual(
  manualWorkout.map((entry) => entry.visibility),
  ["group", "group", "group", "private"],
  "optional details must retain stricter tracker-level privacy",
);
assert.equal(manualWorkout[0].submetricValues, undefined);
assert.equal(manualWorkout[0].imageUri, undefined);
assert.equal(manualWorkout[2].value, 4.2);
assert.deepEqual(
  manualWorkoutEntries({
    distanceKm: 5,
    durationMinutes: 0,
    eventId: "event-2",
    localDate: "2026-08-28",
    metricVisibilities: new Map([
      ["workout", "group"],
      ["workout_duration", "group"],
    ]),
    recordedAt: "2026-08-28T19:00:00.000Z",
    savedAt: "2026-08-28T19:00:01.000Z",
    userId: "user-1",
    visibility: "private",
  }).map((entry) => entry.metricId),
  ["workout"],
  "missing trackers and non-positive optional details must not create orphan rows",
);
assert.match(log, /logWorkout\(\{/);
assert.match(log, /Workout details \(optional\)/);
assert.match(
  log,
  /SESSION_ACTIVITY_EXERCISES\.flatMap/,
  "Workout logging must offer the canonical session-activity catalog",
);
assert.match(
  log,
  /<SelectionMenu[\s\S]{0,650}setWorkoutActivityKey\(activity\.key\)[\s\S]{0,100}setLabel\(activity\.label\)/,
  "Workout logging must preserve free typing while offering the canonical session-activity menu",
);
assert.match(
  log,
  /activityKey: workoutActivityKey \|\| undefined[\s\S]{0,260}includeInStepCoverage: Boolean\(workoutActivityKey\)/,
  "choosing a canonical workout must persist classification metadata and explicit Step opt-in",
);
assert.match(log, /metric\.id === "workout"[\s\S]{0,160}optional duration and distance/);

console.log("Log routing, compound check-ins, and linked manual workouts passed.");
