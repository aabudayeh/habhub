import assert from "node:assert/strict";
import fs from "node:fs";

import {
  equivalentStepEstimate,
  entriesShareStepCoverageSession,
  inferStepCoverageActivityFromGymSession,
  listStepCoverageActivities,
  mergeStepCoveragePreferences,
  normalizeStepCoveragePreferences,
  resolveNormalizedStepCoverageActivity,
  resolveNormalizedStepCoverageChoice,
  stepCoverageActivity,
  stepCoverageProjectionSource,
  stepCoverageSessionIdentity,
  stepCoverageWorkoutRecordId,
  STEP_COVERAGE_ALL_HISTORY_DATE,
  withInferredGymStepCoverageEntries,
  withStepCoverageActivitySelection,
  withStepCoverageActivityOverride,
  withStepCoverageChoice,
} from "../src/domain/stepCoveragePreferences.ts";
import {
  isEligibleStandaloneActiveEnergyForStepCoverage,
  movementStepLengthForCoverage,
  unrecordedStepActivity,
} from "../src/domain/health.ts";
import { SESSION_ACTIVITY_EXERCISES } from "../src/domain/exerciseCatalog.ts";

const profile = {
  age: 31,
  sex: "male",
  heightCm: 178,
  weightKg: 88,
};
const metrics = [
  {
    id: "steps",
    healthMapping: { dataType: "steps", field: "value" },
  },
  {
    id: "workout_duration",
    healthMapping: { dataType: "workouts", field: "duration_minutes" },
  },
  {
    id: "workout_distance",
    healthMapping: { dataType: "workouts", field: "distance_km" },
  },
  {
    id: "exercise",
    healthMapping: { dataType: "active_energy", field: "value" },
  },
];
const linked = (metricId, value, id = metricId, label = "Walking") => ({
  id: `health:health_connect:workout-1:${id}`,
  metricId,
  userId: "owner",
  value,
  localDate: "2026-08-28",
  recordedAt: "2026-08-28T10:30:00.000Z",
  visibility: "private",
  source: "imported",
  label,
  sourceProvider: "health_connect",
  sourceRecordId: "workout-1",
  sourceOrigin: "Samsung Health",
});
const walkingRows = [
  linked("workout_duration", 30),
  linked("workout_distance", 3),
  linked("exercise", 200),
];

assert.ok(entriesShareStepCoverageSession(walkingRows[0], walkingRows[2]));
assert.equal(
  stepCoverageSessionIdentity(walkingRows[0]),
  "source:health_connect:workout-1",
  "persisted source identities must remain JSONB-safe and deterministic",
);
assert.doesNotMatch(
  stepCoverageSessionIdentity({
    ...walkingRows[0],
    sourceProvider: "provider:one",
    sourceRecordId: "record:one/two",
  }),
  /\u0000/,
  "preference keys must never contain PostgreSQL-incompatible null characters",
);
const walkingActivity = stepCoverageActivity("Walking");
assert.equal(walkingActivity?.mode, "direct");
const measuredLength = movementStepLengthForCoverage(
  { distanceKm: 3, durationMinutes: 30, running: false },
  profile,
).stepLengthM;
const walking = unrecordedStepActivity(
  walkingRows,
  metrics,
  6_000,
  profile,
);
assert.ok(
  Math.abs(walking.coveredSteps - 3_000 / measuredLength) < 0.001,
  "one linked walking workout must be covered once from measured distance",
);

const excludedPreferences = withStepCoverageChoice(
  undefined,
  walkingRows[0],
  "exclude",
  "session",
  "2026-08-28T11:00:00.000Z",
);
const excluded = unrecordedStepActivity(
  walkingRows,
  metrics,
  6_000,
  profile,
  excludedPreferences,
);
assert.equal(excluded.coveredSteps, 0);
assert.equal(excluded.uncoveredSteps, 6_000);

const basketballRows = walkingRows.map((entry) => ({
  ...entry,
  id: entry.id.replace("workout-1", "workout-2"),
  sourceRecordId: "workout-2",
  label: "Basketball",
}));
const defaultBasketball = unrecordedStepActivity(
  basketballRows,
  metrics,
  6_000,
  profile,
);
assert.equal(
  defaultBasketball.coveredSteps,
  0,
  "non-walking equivalents must remain opt-in",
);
const includedBasketball = withStepCoverageChoice(
  undefined,
  basketballRows[0],
  "include",
  "session",
  "2026-08-28T11:00:00.000Z",
);
assert.equal(
  unrecordedStepActivity(
    basketballRows,
    metrics,
    6_000,
    profile,
    includedBasketball,
  ).coveredSteps,
  3_900,
  "30 minutes of opted-in basketball must use the cited 130 steps/min equivalent once",
);
const basketballWithoutMeasuredCalories = basketballRows.filter(
  (entry) => entry.metricId === "workout_duration",
);
const estimatedBasketball = unrecordedStepActivity(
  basketballWithoutMeasuredCalories,
  metrics,
  6_000,
  profile,
  withStepCoverageChoice(
    undefined,
    basketballWithoutMeasuredCalories[0],
    "include",
    "session",
    "2026-08-28T11:00:00.000Z",
  ),
);
assert.ok(
  Math.abs(
    estimatedBasketball.estimatedWorkoutCalories -
      ((6.5 - 1) * 3.5 * profile.weightKg * 30) / 200,
  ) < 1e-9,
  "equivalent workout fallback must add net active energy, not resting energy",
);
assert.equal(
  equivalentStepEstimate(
    stepCoverageActivity("Basketball"),
    { durationMinutes: 30, activeCalories: 200 },
    profile,
  )?.steps,
  3_900,
);
const basketballFromActiveCalories = equivalentStepEstimate(
  stepCoverageActivity("Basketball"),
  { activeCalories: 200 },
  profile,
);
assert.ok(
  Math.abs(
    basketballFromActiveCalories.steps -
      (200 / (((6.5 - 1) * 3.5 * profile.weightKg) / 200)) * 130,
  ) < 1e-9,
  "Active-calorie duration inference must use net (MET - 1) intensity",
);

const futureBasketball = withStepCoverageChoice(
  undefined,
  basketballRows[0],
  "include",
  "future_activity",
  "2026-08-28T11:00:00.000Z",
);
const tomorrow = {
  ...basketballRows[0],
  id: basketballRows[0].id.replace("workout-2", "workout-3"),
  sourceRecordId: "workout-3",
  localDate: "2026-08-29",
};
assert.equal(
  resolveNormalizedStepCoverageChoice(
    tomorrow,
    normalizeStepCoveragePreferences(futureBasketball),
  )?.included,
  true,
);
const yesterday = { ...tomorrow, localDate: "2026-08-27" };
assert.equal(
  resolveNormalizedStepCoverageChoice(
    yesterday,
    normalizeStepCoveragePreferences(futureBasketball),
  )?.included,
  false,
);
const allBasketball = withStepCoverageActivitySelection(
  undefined,
  basketballRows[0],
  "basketball",
  "all_activity",
  "include",
  "2026-08-28T11:05:00.000Z",
);
assert.equal(
  allBasketball.activityRules.basketball.effectiveFrom,
  STEP_COVERAGE_ALL_HISTORY_DATE,
  "all-activity scope must use an explicit all-history boundary",
);
assert.equal(
  resolveNormalizedStepCoverageChoice(
    yesterday,
    normalizeStepCoveragePreferences(allBasketball),
  )?.included,
  true,
  "all-activity scope must cover matching historical workouts",
);

const projection = {
  ...walkingRows[2],
  id: `energy-breakdown:activity:${walkingRows[2].id}`,
  metricId: "energy_burned",
  source: "calculated",
};
assert.equal(
  stepCoverageProjectionSource(projection, walkingRows)?.id,
  walkingRows[2].id,
  "Energy burned controls must resolve to the canonical Active energy row",
);

const samsungPromotedWorkoutEnergy = {
  ...walkingRows[2],
  id: "health:health_connect:active-energy-segment:exercise",
  sourceRecordId:
    "samsung-total-workout:active-energy-segment:workout-1:workout-energy",
};
assert.equal(
  stepCoverageWorkoutRecordId(samsungPromotedWorkoutEnergy),
  "workout-1",
  "Samsung workout-calorie rows must recover their linked ExerciseSession id",
);
assert.ok(
  entriesShareStepCoverageSession(
    samsungPromotedWorkoutEnergy,
    walkingRows[0],
  ),
  "promoted Samsung Active energy must share one Step-control choice with duration and distance",
);
assert.equal(
  resolveNormalizedStepCoverageChoice(
    samsungPromotedWorkoutEnergy,
    normalizeStepCoveragePreferences(excludedPreferences),
  )?.included,
  false,
  "a linked Samsung Active-energy row must resolve the session preference",
);

const gymWorkout = {
  ...walkingRows[0],
  id: "gym-sync:gym-session-1:workout",
  sourceProvider: undefined,
  sourceRecordId: undefined,
  source: "manual",
};
const gymDuration = {
  ...gymWorkout,
  id: "gym-sync:gym-session-1:workout_duration",
  metricId: "workout_duration",
};
assert.ok(
  entriesShareStepCoverageSession(gymWorkout, gymDuration),
  "saved-gym Workout and duration rows must share one Step-control identity",
);

const activities = listStepCoverageActivities();
assert.ok(activities.some((activity) => activity.key === "basketball"));
const administrativeActivities = new Set([
  "multisport_transition",
  "other_workout",
  "workout_break",
]);
for (const sessionActivity of SESSION_ACTIVITY_EXERCISES) {
  if (administrativeActivities.has(sessionActivity.key)) continue;
  assert.ok(
    activities.some((activity) => activity.key === sessionActivity.key),
    `the canonical Step picker must include ${sessionActivity.key}`,
  );
}
for (const key of administrativeActivities) {
  assert.ok(
    !activities.some((activity) => activity.key === key),
    `${key} must not invent a covered-step estimate`,
  );
}
assert.ok(
  !activities.some((activity) => activity.key === "barbell_bench_press"),
  "individual strength exercises must not flood the session-activity picker",
);
assert.equal(
  activities.find((activity) => activity.key === "basketball")
    ?.stepsPerMinute,
  130,
  "published conversion-table rates must outrank MET-derived estimates",
);
assert.equal(
  activities.find((activity) => activity.key === "mountain_biking")
    ?.stepsPerMinute,
  155,
  "remaining session activities must use the conservative MET cadence formula",
);
assert.deepEqual(
  activities.map((activity) => activity.label),
  activities
    .map((activity) => activity.label)
    .slice()
    .sort((left, right) =>
      left.toLowerCase() < right.toLowerCase()
        ? -1
        : left.toLowerCase() > right.toLowerCase()
          ? 1
          : 0,
    ),
  "the classification menu must remain stable and alphabetized",
);

const genericBasketballSession = {
  id: "gym-session-1",
  userId: "owner",
  name: "Workout",
  localDate: "2026-08-28",
  recordedAt: "2026-08-28T10:30:00.000Z",
  durationMinutes: 30,
  exercises: [
    {
      id: "exercise-1",
      exerciseKey: "basketball",
      name: "Basketball",
      sets: [{ id: "set-1", reps: 0, weightKg: 0, completed: true }],
    },
  ],
  visibility: "private",
};
assert.equal(
  inferStepCoverageActivityFromGymSession(genericBasketballSession)?.key,
  "basketball",
  "a generic Workout session must infer its one completed eligible exercise",
);
assert.equal(
  inferStepCoverageActivityFromGymSession({
    ...genericBasketballSession,
    exercises: [
      ...genericBasketballSession.exercises,
      {
        id: "exercise-2",
        exerciseKey: "walking",
        name: "Walking",
        sets: [{ id: "set-2", reps: 0, weightKg: 0, completed: true }],
      },
    ],
  }),
  undefined,
  "mixed eligible exercises must ask the user instead of guessing",
);

const genericGymRows = [
  { ...gymWorkout, label: "Workout" },
  { ...gymDuration, label: "Workout", value: 30 },
  {
    ...gymWorkout,
    id: "gym-sync:gym-session-1:workout_distance",
    metricId: "workout_distance",
    value: 3,
    label: "Workout",
  },
  {
    ...gymWorkout,
    id: "gym-sync:gym-session-1:exercise",
    metricId: "exercise",
    value: 200,
    label: "Workout",
  },
];
const inferredGymRows = withInferredGymStepCoverageEntries(
  genericGymRows,
  [
    genericBasketballSession,
    {
      ...genericBasketballSession,
      userId: "friend",
      exercises: [
        {
          id: "friend-exercise",
          exerciseKey: "walking",
          name: "Walking",
          sets: [
            { id: "friend-set", reps: 0, weightKg: 0, completed: true },
          ],
        },
      ],
    },
  ],
);
assert.ok(
  inferredGymRows.every(
    (entry) => entry.stepCoverageActivityKey === "basketball",
  ),
  "legacy Workout-page rows must be enriched across all linked tracker views",
);
assert.equal(
  resolveNormalizedStepCoverageActivity(
    inferredGymRows[0],
    normalizeStepCoveragePreferences(),
  ).key,
  "basketball",
);
assert.equal(
  unrecordedStepActivity(
    inferredGymRows,
    metrics,
    6_000,
    profile,
  ).coveredSteps,
  0,
  "an inferred nonwalking Workout-page activity must still require explicit consent",
);
const genericWalkingSession = {
  ...genericBasketballSession,
  exercises: [
    {
      ...genericBasketballSession.exercises[0],
      exerciseKey: "walking",
      name: "Walking",
    },
  ],
};
const inferredWalkingRows = withInferredGymStepCoverageEntries(
  genericGymRows,
  [genericWalkingSession],
);
assert.equal(
  resolveNormalizedStepCoverageChoice(
    inferredWalkingRows[0],
    normalizeStepCoveragePreferences(),
  )?.included,
  true,
  "an inferred direct walking activity must remain automatic",
);
const classifiedGymPreferences = withStepCoverageActivityOverride(
  undefined,
  genericGymRows[0],
  "basketball",
  "include",
  "2026-08-28T12:00:00.000Z",
);
assert.equal(
  unrecordedStepActivity(
    genericGymRows,
    metrics,
    6_000,
    profile,
    classifiedGymPreferences,
  ).coveredSteps,
  3_900,
  "an explicit session classification must cover generic linked Workout rows",
);

const standaloneActiveEnergy = {
  ...linked("exercise", 200, "exercise", "Active energy"),
  id: "health:health_connect:standalone-active-energy:exercise",
  sourceRecordId: "standalone-active-energy",
};
assert.equal(
  unrecordedStepActivity(
    [standaloneActiveEnergy],
    metrics,
    6_000,
    profile,
  ).coveredSteps,
  0,
  "standalone Active energy must never subtract steps without an explicit classification",
);
const standaloneActiveEnergyPreference = withStepCoverageActivityOverride(
  undefined,
  standaloneActiveEnergy,
  "basketball",
  "include",
  "2026-08-28T12:10:00.000Z",
);
assert.ok(
  unrecordedStepActivity(
    [standaloneActiveEnergy],
    metrics,
    6_000,
    profile,
    standaloneActiveEnergyPreference,
  ).coveredSteps > 0,
  "an explicitly classified standalone Active-energy session must participate in Step coverage",
);
for (const unsafeActiveEnergy of [
  { ...standaloneActiveEnergy, label: "Active energy total" },
  {
    ...standaloneActiveEnergy,
    label: "Active energy",
    sourceOrigin: "Fitbit Mobile",
  },
  { ...standaloneActiveEnergy, label: "Resting energy (BMR)" },
]) {
  assert.equal(
    isEligibleStandaloneActiveEnergyForStepCoverage(unsafeActiveEnergy),
    false,
  );
  assert.equal(
    unrecordedStepActivity(
      [unsafeActiveEnergy],
      metrics,
      6_000,
      profile,
      standaloneActiveEnergyPreference,
    ).coveredSteps,
    0,
    "stale preferences must never turn an aggregate/resting calorie row into covered steps",
  );
}
assert.equal(
  resolveNormalizedStepCoverageActivity(
    genericGymRows[2],
    normalizeStepCoveragePreferences(classifiedGymPreferences),
  ).key,
  "basketball",
  "one session override must resolve through Workout distance and energy rows",
);
assert.equal(
  withStepCoverageActivityOverride(
    withStepCoverageActivityOverride(
      classifiedGymPreferences,
      genericGymRows[0],
      "basketball",
      "exclude",
      "2026-08-28T12:01:00.000Z",
    ),
    genericGymRows[0],
    "walking",
  ).sessions[stepCoverageSessionIdentity(genericGymRows[0])].choice,
  "include",
  "selecting another activity must include it even after an old exclusion",
);
assert.match(
  stepCoverageSessionIdentity({
    ...gymWorkout,
    id: "legacy-manual-workout",
    metricId: "workout",
    sourceRecordId: undefined,
  }),
  /^manual:/,
  "legacy standalone manual Workout rows must remain classifiable",
);

const merged = mergeStepCoveragePreferences(
  includedBasketball,
  excludedPreferences,
);
assert.equal(Object.keys(merged.sessions).length, 2);

const ui = fs.readFileSync("app/metric-detail.tsx", "utf8");
const server = fs.readFileSync(
  "supabase/functions/_shared/google-health-sync.ts",
  "utf8",
);
const groupCloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const backgroundFinish = fs.readFileSync(
  "src/domain/backgroundWorkoutFinish.ts",
  "utf8",
);
const stateMigration = fs.readFileSync("src/domain/stateMigration.ts", "utf8");
assert.match(ui, /"workout",\s*\n\s*"workout_duration"/);
assert.match(ui, /STEP_COVERAGE_SESSION_METRICS/);
assert.doesNotMatch(
  ui,
  /accessibilityLabel=\{t\("Edit Step coverage"\)\}/,
  "Step control must not add an obvious Entries-header edit button",
);
assert.match(
  ui,
  /Double-tap to choose its Step activity; hold to delete/,
  "linked workout entries must document the subtle classifier/delete gestures",
);
assert.match(
  ui,
  /function handleStepCoverageEntryTap\([^)]*\)[\s\S]{0,700}openStepCoveragePicker\(entry\)/,
  "double-tapping a linked workout must open the Step activity menu",
);
assert.match(
  ui,
  /onLongPress=\{[\s\S]{0,500}promptStepCoverageEntryRemoval\(entry\)/,
  "holding a linked workout must preserve confirmed deletion",
);
assert.match(
  ui,
  /selectedStepCoverageActivity\?\.key === activity\.key/,
  "an inferred or explicitly matched activity must be selected when the menu opens",
);
assert.match(
  ui,
  /const \[stepActivityChoicesOpen, setStepActivityChoicesOpen\] = useState\(false\)/,
  "the full Step activity catalog must stay collapsed until the user asks for it",
);
assert.match(
  ui,
  /activity\.mode === "direct"[\s\S]{0,180}applyStepCoverageActivity\(activity\.key, "session"\)[\s\S]{0,650}"This workout"[\s\S]{0,260}"All matching"/,
  "equivalent activities must ask whether to classify only this workout or all matching history",
);
assert.match(
  ui,
  /standaloneSyncedActiveEnergy[\s\S]{0,260}stepCoverageActiveEnergyMetricIds\.has\(source\.metricId\)[\s\S]{0,260}!isDailyActiveEnergyAggregateEntry\(source\)/,
  "a durable standalone Active-energy interval must be classifiable without admitting daily aggregates",
);
assert.match(
  ui,
  /currentUserEntriesByDate[\s\S]{0,900}authoritativeStepEntries\([\s\S]{0,300}unrecordedStepActivity\(/,
  "live fallback rows must recalculate from authoritative Steps in one date-indexed pass",
);
assert.match(server, /resolvedStepCoverageActivity\(/);
assert.match(server, /stepCoverageIncluded\([\s\S]{0,180}inferredGymActivities/);
assert.match(server, /equivalentSteps\(/);
assert.match(
  server,
  /return activity\.mode === "direct"/,
  "the Google worker must not treat an inferred equivalent as consent",
);
assert.match(
  server,
  /stepCoverageActivityFromKey\(entry\.stepCoverageActivityKey\)/,
  "the Google Health worker must honor app-inferred activity metadata",
);
assert.match(
  server,
  /stepCoverageActivityFromKey\(session\.activityKey\)/,
  "the Google Health worker must honor the user's explicit session classification",
);
for (const workoutWriter of [provider, backgroundFinish]) {
  assert.match(
    workoutWriter,
    /inferredStepActivity\s*=\s*inferStepCoverageActivityFromGymSession\(session\)/,
    "foreground and background workout saves must infer the completed session activity",
  );
  assert.match(
    workoutWriter,
    /stepCoverageActivityKey:\s*inferredStepActivity\?\.key/,
    "foreground and background workout saves must project the same inferred activity metadata",
  );
}
assert.match(
  stateMigration,
  /withInferredGymStepCoverageEntries\([\s\S]{0,160}state\.gymSessions/,
  "restored historical Workout-page rows must be enriched without requiring the user to resave them",
);
assert.match(
  server,
  /sourceRecordId\.startsWith\("samsung-total-workout:"\)[\s\S]{0,500}body\.slice\(separator \+ 1\)/,
  "Google Health's mixed-account calculation must preserve Samsung workout linkage",
);
assert.doesNotMatch(
  groupCloud,
  /stepCoveragePreferences/,
  "private Step-coverage settings must never enter group projections",
);

console.log("Step-coverage preference checks passed.");
