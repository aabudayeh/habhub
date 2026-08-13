import assert from "node:assert/strict";
import fs from "node:fs";

import {
  estimateWeightPlan,
  weightManagementEnabled,
  weightManagementSummaryVisible,
} from "../src/domain/weightPlan.ts";

const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
const trackerCatalog = fs.readFileSync(
  "src/domain/trackerCatalog.ts",
  "utf8",
);
const metrics = fs.readFileSync("src/domain/metrics.ts", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const metricEditor = fs.readFileSync("app/metric-editor.tsx", "utf8");
const status = fs.readFileSync("app/(tabs)/status.tsx", "utf8");
const today = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
const display = fs.readFileSync("app/display-settings.tsx", "utf8");
const log = fs.readFileSync("app/(tabs)/log.tsx", "utf8");

assert.deepEqual(
  estimateWeightPlan({
    anchorDate: "2026-01-01",
    currentWeightKg: 90,
    direction: "lose",
    targetWeightKg: 80,
    weeklyChangeKg: 0.5,
  }),
  {
    direction: "lose",
    currentWeightKg: 90,
    targetWeightKg: 80,
    weeklyChangeKg: 0.5,
    remainingKg: 10,
    expectedGoalDate: "2026-05-21",
    reached: false,
  },
  "the plan ETA must use the chosen weekly pace deterministically",
);
assert.equal(
  estimateWeightPlan({
    anchorDate: "2026-01-01",
    currentWeightKg: 80,
    direction: "gain",
    targetWeightKg: 86,
    weeklyChangeKg: 0.3,
  })?.expectedGoalDate,
  "2026-05-21",
);
assert.equal(
  estimateWeightPlan({
    anchorDate: "2026-01-01",
    currentWeightKg: 80,
    direction: "lose",
    targetWeightKg: 86,
    weeklyChangeKg: 0.5,
  }),
  undefined,
  "a target in the wrong direction cannot produce a misleading ETA",
);
assert.deepEqual(
  estimateWeightPlan({
    anchorDate: "2026-01-01",
    currentWeightKg: 80,
    direction: "maintain",
    targetWeightKg: 80,
    weeklyChangeKg: 0.5,
  }),
  {
    direction: "maintain",
    currentWeightKg: 80,
    targetWeightKg: 80,
    weeklyChangeKg: 0,
    remainingKg: 0,
    reached: true,
  },
);

assert.equal(weightManagementEnabled({ selectedGoals: ["weight"] }), true);
assert.equal(
  weightManagementEnabled({
    selectedGoals: ["weight"],
    weightManagementEnabled: false,
  }),
  false,
  "an explicit opt-out must override the legacy selected-goal fallback",
);
assert.equal(
  weightManagementSummaryVisible({
    selectedGoals: ["weight"],
    weightManagementEnabled: true,
    showWeightManagementSummary: false,
  }),
  false,
);

const onboardingTrackerIds = [
  "steps",
  "food",
  "exercise",
  "deficit",
  "water",
  "workout",
  "weight",
  "weekly_deficit_balance",
  "todo_completion",
  "workout_duration",
  "workout_distance",
  "reading",
  "study",
  "work",
  "screen_time",
  "intermittent_fasting",
  "sleep",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "pulse",
  "blood_glucose",
  "menstrual_cycle",
  "body_fat",
  "lean_body_mass",
  "body_water_mass",
  "bone_mass",
];
for (const id of onboardingTrackerIds) {
  assert.match(
    trackerCatalog,
    new RegExp(`\\b${id}: "[^"\\n]{35,}"`),
    `${id} needs a meaningful onboarding description`,
  );
}
assert.match(
  onboarding,
  /Trackers keep useful history\. Tracked goals are the few daily goals you care about; for example, Workout duration can stay visible without counting toward your day\./,
);
assert.match(onboarding, /Tap a tracker to learn what it records/);
assert.match(onboarding, /<Modal[\s\S]*?infoTracker\.description/);
assert.doesNotMatch(
  onboarding,
  /numberOfLines=\{1\}[\s\S]{0,160}styles\.metricName/,
  "onboarding tracker names must wrap instead of truncating",
);
assert.match(onboarding, /\? "Desired gain per week"[\s\S]{0,100}: "Desired loss per week"/);
assert.match(onboarding, /target around \$\{expectedWeightDate\}/);

assert.match(metrics, /if \(metric\.id === "weight"\) return false/);
assert.match(metrics, /metric\.id !== "weight" && metric\.dataType !== "text"/);
assert.match(provider, /if \(action\.value && !canBeTrackedGoal\(metric\)\) return state/);
assert.match(metricEditor, /trackGoal:[\s\S]{0,120}canTrackDailyGoal && trackGoal/);

assert.match(status, /showProgressLabel=\{false\}/);
assert.match(
  status,
  /showWeightSummary \? \([\s\S]{0,650}label="Weight"[\s\S]{0,1100}styles\.completionFact[\s\S]{0,1000}label=\{bodyCompositionStat\.label\}/,
  "Status must show Weight | completion percent | Body fat only for weight management",
);
assert.match(status, /weightManagementSummaryVisible\(state\.settings\)/);
assert.match(today, /weightManagementSummaryVisible\(state\.settings\)/);
assert.match(today, /habhub-all-goals-dismissed-v1:/);
assert.match(today, /accessibilityLabel="Dismiss all goals complete"/);
assert.match(display, /showWeightManagementSummary/);

assert.match(log, /selected\?\.id === "water" \? "0\.25" : ""/);
assert.match(log, /function adjustWaterCups\(change: -1 \| 1\)/);
assert.match(log, /accessibilityLabel="Remove 250 millilitres"/);
assert.match(log, /accessibilityLabel="Add 250 millilitres"/);
assert.match(log, /250 ml · 1 cup/);

console.log(
  "Weight planning, directional weight tracking, dismissible completion, onboarding descriptions, and 250 ml water controls validated.",
);
