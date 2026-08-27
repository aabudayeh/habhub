import assert from "node:assert/strict";
import fs from "node:fs";

import {
  canonicalWorkoutTrackerId,
  consolidateWorkoutTrackers,
} from "../src/domain/workoutTrackers.ts";
import {
  completeGymWorkout,
  gymSessionVisibilityForMetric,
  setGymExerciseCompletion,
} from "../src/domain/gym.ts";
import {
  applyBackgroundGymSession,
  finishStoredWorkoutDraft,
  nativeWorkoutActionReceiptId,
  parseStoredWorkoutDraft,
  reconcileBackgroundWorkoutCompletion,
  replayStoredWorkoutActions,
  validBackgroundWorkoutCompletion,
} from "../src/domain/backgroundWorkoutFinish.ts";
import { migrateRetiredWorkoutCaloriesEntries } from "../src/domain/workoutCaloriesMigration.ts";
import {
  ANY_RECORDED_WORKOUT_QUALIFICATION,
  DEFAULT_WORKOUT_QUALIFICATION,
  isDefaultWorkoutQualification,
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

const unfinishedWorkout = [
  {
    id: "exercise",
    name: "Bench press",
    completed: false,
    sets: [
      { id: "set-1", reps: 8, weightKg: 70, completed: false },
      { id: "set-2", reps: 8, weightKg: 70, completed: true },
    ],
  },
];
const fullyCompletedWorkout = completeGymWorkout(unfinishedWorkout);
assert.notEqual(fullyCompletedWorkout, unfinishedWorkout);
assert.equal(unfinishedWorkout[0].sets[0].completed, false);
assert.equal(fullyCompletedWorkout[0].completed, true);
assert.ok(
  fullyCompletedWorkout[0].sets.every((set) => set.completed),
  "Complete all must finish every set without mutating the workout draft",
);
const resetExercise = setGymExerciseCompletion(
  fullyCompletedWorkout[0],
  false,
);
assert.equal(resetExercise.completed, false);
assert.ok(
  resetExercise.sets.every((set) => !set.completed),
  "Undoing exercise completion must also uncheck every set",
);
assert.ok(
  setGymExerciseCompletion(unfinishedWorkout[0], true).sets.every(
    (set) => set.completed,
  ),
  "Finishing one exercise must complete all of its sets",
);
for (const [sessionVisibility, metricVisibility, expected] of [
  ["group", "group", "group"],
  ["group", "status", "status"],
  ["group", "private", "private"],
  ["status", "group", "status"],
  ["status", "status", "status"],
  ["status", "private", "private"],
  ["private", "group", "private"],
  ["private", "status", "private"],
  ["private", "private", "private"],
]) {
  assert.equal(
    gymSessionVisibilityForMetric(sessionVisibility, metricVisibility),
    expected,
    "Workout sharing must always use the stricter session or tracker privacy",
  );
}

const backgroundTimerBase = Date.now() - 60_000;
const backgroundWorkoutDraft = {
  savedAt: Date.now(),
  localDate: new Date().toISOString().slice(0, 10),
  sessionId: "background-session",
  sessionName: "Lock-screen workout",
  duration: "",
  calories: "",
  calorieCalculationMode: "session_met",
  intensity: "moderate",
  sessionNotes: "",
  visibility: "group",
  selectedPlanId: null,
  setStartDelaySeconds: 0,
  exercises: [
    {
      id: "background-exercise",
      name: "Bench press",
      sets: [
        { id: "background-set-1", reps: 8, weightKg: 70, completed: false },
        { id: "background-set-2", reps: 8, weightKg: 70, completed: false },
      ],
    },
  ],
  timer: {
    mode: "guided",
    phase: "work",
    startedAt: backgroundTimerBase,
    phaseStartedAt: backgroundTimerBase,
    phaseElapsedSeconds: 0,
    completedElapsedSeconds: 0,
    pausedSeconds: 0,
    exerciseId: "background-exercise",
    setId: "background-set-1",
  },
};
assert.ok(
  parseStoredWorkoutDraft(JSON.stringify(backgroundWorkoutDraft)),
  "the headless Finish path must accept the persisted active-workout draft",
);
const nativeBackgroundActions = [
  {
    action: "workout-next",
    occurredAt: backgroundTimerBase + 10_000,
    ownerId: "user-a",
    generation: "generation-a",
  },
  {
    action: "workout-pause",
    occurredAt: backgroundTimerBase + 15_000,
    ownerId: "user-a",
    generation: "generation-a",
  },
  {
    action: "workout-next",
    occurredAt: backgroundTimerBase + 20_000,
    ownerId: "user-a",
    generation: "generation-a",
  },
  {
    action: "workout-next",
    occurredAt: backgroundTimerBase + 24_000,
    ownerId: "user-a",
    generation: "generation-a",
  },
  {
    action: "workout-finish",
    occurredAt: backgroundTimerBase + 34_000,
    ownerId: "user-a",
    generation: "generation-a",
  },
];
const replayedBackgroundDraft = replayStoredWorkoutActions(
  backgroundWorkoutDraft,
  nativeBackgroundActions,
);
assert.equal(replayedBackgroundDraft.timer.phase, "work");
assert.equal(replayedBackgroundDraft.timer.setId, "background-set-2");
assert.equal(replayedBackgroundDraft.timer.pausedSeconds, 5);
assert.equal(replayedBackgroundDraft.exercises[0].sets[0].completed, true);
const firstNativeActionId = nativeWorkoutActionReceiptId(
  nativeBackgroundActions[0],
);
const draftAfterDurableFirstAction = replayStoredWorkoutActions(
  backgroundWorkoutDraft,
  nativeBackgroundActions.slice(0, 1),
);
const crashRecoveredDraft = replayStoredWorkoutActions(
  {
    ...draftAfterDurableFirstAction,
    processedNativeWorkoutActionIds: [firstNativeActionId],
  },
  nativeBackgroundActions,
);
assert.deepEqual(
  crashRecoveredDraft,
  {
    ...replayedBackgroundDraft,
    processedNativeWorkoutActionIds: [firstNativeActionId],
  },
  "a Next already committed to the durable draft must be skipped while later receipts still replay exactly once",
);
const backgroundState = {
  currentUserId: "user-a",
  entries: [],
  gymSessions: [],
  metrics: [
    { id: "workout", defaultVisibility: "group" },
    { id: "workout_duration", defaultVisibility: "group" },
    { id: "exercise", defaultVisibility: "group" },
  ],
  settings: {
    energyProfile: {
      age: 30,
      sex: "male",
      heightCm: 180,
      weightKg: 80,
      targetWeightKg: 75,
      activityLevel: "moderate",
      desiredWeeklyLossKg: 0.25,
    },
    pendingDeletedEntryIds: [],
    deletedEntryIds: [],
  },
};
const backgroundSession = finishStoredWorkoutDraft(
  replayedBackgroundDraft,
  backgroundState,
  nativeBackgroundActions.at(-1).occurredAt,
);
assert.equal(backgroundSession.exercises[0].sets[1].completed, true);
assert.equal(backgroundSession.pausedSeconds, 5);
assert.equal(backgroundSession.completedAt, new Date(backgroundTimerBase + 34_000).toISOString());
const backgroundApplied = applyBackgroundGymSession(
  backgroundState,
  backgroundSession,
);
assert.equal(backgroundApplied.gymSessions[0].id, "background-session");
assert.ok(
  backgroundApplied.entries.some(
    (entry) => entry.id === "gym-sync:background-session:workout_duration",
  ),
  "headless Finish must materialize the same Workout duration row as foreground save",
);
assert.equal(
  applyBackgroundGymSession(backgroundApplied, backgroundSession),
  backgroundApplied,
  "replayed/retried Finish receipts must be idempotent",
);
const completionReceipt = {
  ownerId: "user-a",
  generation: "generation-a",
  occurredAt: backgroundTimerBase + 34_000,
  baseSession: null,
  session: backgroundSession,
};
assert.equal(
  validBackgroundWorkoutCompletion(
    {
      ...completionReceipt,
      baseSession: { ...backgroundSession, id: "another-session" },
    },
    "user-a",
    completionReceipt.occurredAt,
  ),
  false,
  "a recovery receipt must not use an unrelated session as its edit/delete baseline",
);
const preFinishState = {
  ...backgroundState,
  lastSavedAt: new Date(backgroundTimerBase - 1_000).toISOString(),
};
assert.equal(
  reconcileBackgroundWorkoutCompletion(preFinishState, completionReceipt)
    .resolution,
  "applied",
  "a receipt may recover only a snapshot that predates Finish",
);
assert.equal(
  reconcileBackgroundWorkoutCompletion(
    { ...backgroundApplied, lastSavedAt: new Date().toISOString() },
    completionReceipt,
  ).resolution,
  "already_applied",
  "an exact durable session must consume its receipt idempotently",
);
const userEditedSession = { ...backgroundSession, name: "User-edited name" };
const editedAfterFinish = {
  ...backgroundApplied,
  gymSessions: [userEditedSession],
  lastSavedAt: new Date(completionReceipt.occurredAt + 5_000).toISOString(),
};
const editedResolution = reconcileBackgroundWorkoutCompletion(
  editedAfterFinish,
  completionReceipt,
);
assert.equal(editedResolution.resolution, "superseded");
assert.equal(
  editedResolution.state.gymSessions[0].name,
  "User-edited name",
  "a stale completion receipt must never overwrite a later workout edit",
);
const deletedAfterFinish = {
  ...backgroundApplied,
  gymSessions: [],
  entries: [],
  settings: {
    ...backgroundApplied.settings,
    pendingDeletedEntryIds: [
      "gym-sync:background-session:workout_duration",
    ],
  },
  lastSavedAt: new Date(completionReceipt.occurredAt + 10_000).toISOString(),
};
const deletedResolution = reconcileBackgroundWorkoutCompletion(
  deletedAfterFinish,
  completionReceipt,
);
assert.equal(deletedResolution.resolution, "superseded");
assert.equal(
  deletedResolution.state.gymSessions.length,
  0,
  "a stale completion receipt must never resurrect a deleted workout",
);
const unrelatedLaterSave = {
  ...preFinishState,
  lastSavedAt: new Date(completionReceipt.occurredAt + 20_000).toISOString(),
};
assert.equal(
  reconcileBackgroundWorkoutCompletion(unrelatedLaterSave, completionReceipt)
    .resolution,
  "applied",
  "an unrelated later save without same-session edit or deletion evidence must not drop a valid recovered workout",
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
assert.deepEqual(
  DEFAULT_WORKOUT_QUALIFICATION.rules,
  [
    {
      activity: "walking",
      thresholdMode: "any",
      minimumDurationMinutes: 30,
      minimumDistanceKm: 2,
      minimumActiveCalories: 100,
    },
    {
      activity: "running",
      thresholdMode: "any",
      minimumDurationMinutes: 20,
      minimumDistanceKm: 3,
      minimumActiveCalories: 150,
    },
    {
      activity: "strength",
      thresholdMode: "any",
      minimumDurationMinutes: 30,
      minimumActiveCalories: 120,
    },
    {
      activity: "other",
      thresholdMode: "any",
      minimumDurationMinutes: 20,
      minimumDistanceKm: 3,
      minimumActiveCalories: 100,
    },
  ],
  "recommended rules must use exercise-specific OR thresholds",
);
for (const [sample, message] of [
  [{ activityKey: "walking", distanceKm: 2 }, "walking distance"],
  [{ activityKey: "walking", activeCalories: 100 }, "walking calories"],
  [{ activityKey: "running", distanceKm: 3 }, "running distance"],
  [{ activityKey: "running", activeCalories: 150 }, "running calories"],
  [
    { activityKey: "strength_training", activeCalories: 120 },
    "strength calories",
  ],
  [{ activityKey: "cycling", distanceKm: 3 }, "other-activity distance"],
  [{ activityKey: "cycling", activeCalories: 100 }, "other-activity calories"],
]) {
  assert.equal(
    workoutQualifies(sample, DEFAULT_WORKOUT_QUALIFICATION),
    true,
    `${message} alone must satisfy its recommended OR rule`,
  );
}
assert.equal(
  workoutQualifies(
    {
      activityKey: "strength_training",
      durationMinutes: 12,
      distanceKm: 50,
      activeCalories: 40,
    },
    DEFAULT_WORKOUT_QUALIFICATION,
  ),
  false,
  "distance must not make a short strength session qualify",
);
assert.equal(
  workoutQualifies(
    {
      activityKey: "walking",
      durationMinutes: 29,
      distanceKm: 1.9,
      activeCalories: 99,
    },
    DEFAULT_WORKOUT_QUALIFICATION,
  ),
  false,
  "a session below every recommended threshold must remain incomplete",
);
const legacyRecommendedQualification = {
  rules: [
    {
      activity: "walking",
      thresholdMode: "all",
      minimumDurationMinutes: 30,
    },
    {
      activity: "running",
      thresholdMode: "all",
      minimumDurationMinutes: 20,
    },
    {
      activity: "strength",
      thresholdMode: "all",
      minimumDurationMinutes: 30,
    },
    {
      activity: "other",
      thresholdMode: "all",
      minimumDurationMinutes: 20,
    },
  ],
};
assert.equal(isDefaultWorkoutQualification(legacyRecommendedQualification), true);
assert.equal(
  workoutQualifies(
    { activityKey: "walking", distanceKm: 2 },
    legacyRecommendedQualification,
  ),
  true,
  "persisted duration-only Recommended rules must inherit the improved OR defaults",
);
const jsonbShapedLegacyRecommendedQualification = {
  rules: [
    {
      minimumDurationMinutes: 20,
      thresholdMode: "all",
      activity: "other",
    },
    {
      thresholdMode: "all",
      activity: "strength",
      minimumDurationMinutes: 30,
    },
    {
      minimumDurationMinutes: 20,
      activity: "running",
      thresholdMode: "all",
    },
    {
      thresholdMode: "all",
      minimumDurationMinutes: 30,
      activity: "walking",
    },
  ],
};
assert.equal(
  isDefaultWorkoutQualification(jsonbShapedLegacyRecommendedQualification),
  true,
  "JSONB key/rule ordering must not turn the legacy Recommended preset into Custom",
);
assert.equal(
  workoutQualifies(
    { activityKey: "walking", distanceKm: 2 },
    jsonbShapedLegacyRecommendedQualification,
  ),
  true,
  "a reordered JSONB legacy preset must inherit the improved OR defaults",
);
const jsonbShapedCurrentRecommendedQualification = {
  rules: [...DEFAULT_WORKOUT_QUALIFICATION.rules]
    .reverse()
    .map((rule) => ({
      minimumActiveCalories: rule.minimumActiveCalories,
      minimumDistanceKm: rule.minimumDistanceKm,
      minimumDurationMinutes: rule.minimumDurationMinutes,
      thresholdMode: rule.thresholdMode,
      activity: rule.activity,
    })),
};
assert.equal(
  isDefaultWorkoutQualification(jsonbShapedCurrentRecommendedQualification),
  true,
  "JSONB key/rule ordering must preserve the current Recommended preset",
);
const customizedLegacyLookalike = {
  rules: legacyRecommendedQualification.rules.map((rule) =>
    rule.activity === "walking"
      ? { ...rule, minimumDistanceKm: 2 }
      : rule,
  ),
};
assert.equal(
  isDefaultWorkoutQualification(customizedLegacyLookalike),
  false,
  "a changed threshold must remain Custom even when every other legacy field matches",
);
assert.equal(
  workoutQualifies(
    { activityKey: "walking", distanceKm: 2 },
    customizedLegacyLookalike,
  ),
  false,
  "a custom all-threshold rule must not be silently upgraded to Recommended OR semantics",
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

const activeEnergyMetric = metric("exercise", {
  name: "Active energy",
  icon: "flash-outline",
  unit: "kcal",
  dataType: "number",
  aggregation: "sum",
  healthMapping: { dataType: "active_energy", field: "value" },
  order: 2,
});
const legacyWorkoutCaloriesMetric = metric("workout_calories", {
  name: "Workout calories",
  icon: "flame-outline",
  unit: "kcal",
  dataType: "number",
  aggregation: "sum",
  goal: { kind: "at_least", target: 250 },
  defaultVisibility: "private",
  healthMapping: { dataType: "workouts", field: "active_calories" },
  order: 19,
});
const retiredEntryId =
  "health:health_connect:workouts:legacy-session:workout_calories";
const canonicalActiveEntryId =
  "health:health_connect:workouts:legacy-session:exercise:workout-energy";
const legacyCaloriesState = {
  currentUserId: "owner",
  metrics: [activeEnergyMetric, legacyWorkoutCaloriesMetric],
  entries: [
    {
      id: retiredEntryId,
      metricId: "workout_calories",
      userId: "owner",
      value: 184,
      localDate: "2026-08-24",
      recordedAt: "2026-08-24T18:45:00.000Z",
      visibility: "private",
      source: "imported",
      sourceProvider: "health_connect",
      sourceRecordId: "legacy-session",
      sourceOrigin: "com.sec.android.app.shealth",
      label: "Strength training",
    },
  ],
  group: {
    id: "group",
    metricConfiguration: [activeEnergyMetric, legacyWorkoutCaloriesMetric],
  },
  groups: [
    {
      id: "group",
      metricConfiguration: [activeEnergyMetric, legacyWorkoutCaloriesMetric],
    },
  ],
  dailyMetricStatuses: [],
  trackedGoalPeriods: { workout_calories: [{ from: "2026-08-01" }] },
  journalNotes: [],
  calendarReminders: [],
  activityTimers: [],
  selectedGroupMetricId: "workout_calories",
  settings: {
    selectedGoals: ["workout_calories"],
    progressMetricIds: ["workout_calories"],
    progressMetricOrderIds: ["workout_calories"],
    progressPinnedMetricIds: ["workout_calories"],
    performanceMetricIds: ["workout_calories"],
    performanceMetricOrderIds: ["workout_calories"],
    performancePinnedMetricIds: ["workout_calories"],
    leaderboardMetricIdsByGroup: { group: ["workout_calories"] },
    leaderboardPinnedMetricIdsByGroup: { group: ["workout_calories"] },
    leaderboardCardOrderByGroup: { group: ["workout_calories"] },
    comparisonMetricIdsByGroup: { group: ["workout_calories"] },
    todayHistoryByMetric: { workout_calories: "month" },
    trackerViewFilters: [
      { id: "all", name: "All", metricIds: ["workout_calories"] },
    ],
    scheduleViewFilters: [
      {
        id: "all",
        name: "All",
        includeTodos: true,
        includeReminders: true,
        logMetricIds: ["workout_calories"],
      },
    ],
    featuredTodayCard: "workout_calories",
    notifications: { metricIds: ["workout_calories"] },
  },
};
const retiredEntryMigration = migrateRetiredWorkoutCaloriesEntries(
  legacyCaloriesState.entries,
  legacyCaloriesState.currentUserId,
);
assert.equal(
  retiredEntryMigration.entries.some(
    (item) => item.metricId === "workout_calories",
  ),
  false,
  "Workout calories rows must be removed by the retirement migration",
);
const migratedActiveEntry = retiredEntryMigration.entries.find(
  (entry) => entry.id === canonicalActiveEntryId,
);
assert.equal(migratedActiveEntry?.metricId, "exercise");
assert.equal(migratedActiveEntry?.value, 184);
assert.equal(
  migratedActiveEntry?.visibility,
  "private",
  "retiring the duplicate tracker must preserve entry privacy exactly",
);
assert.equal(migratedActiveEntry?.sourceRecordId, "legacy-session");
assert.ok(
  retiredEntryMigration.removedOwnEntryIds.includes(retiredEntryId),
  "the state migration must receive every retired owner id for durable tombstones",
);
assert.equal(
  migrateRetiredWorkoutCaloriesEntries(
    retiredEntryMigration.entries,
    legacyCaloriesState.currentUserId,
  ).entries.filter((entry) => entry.id === canonicalActiveEntryId).length,
  1,
  "the retirement migration must remain idempotent",
);
const lateLegacyWalkingEntry = {
  id: "entry-old-walking-calories",
  metricId: "workout_calories",
  userId: "owner",
  value: 126,
  localDate: "2026-08-24",
  recordedAt: "2026-08-24T17:30:00.000Z",
  visibility: "group",
  source: "manual",
  label: "Walking",
};
const migratedLateWalking = migrateRetiredWorkoutCaloriesEntries(
  [lateLegacyWalkingEntry],
  "owner",
);
const migratedLateWalkingEntry = migratedLateWalking.entries.find(
  (entry) => entry.metricId === "exercise",
);
assert.ok(migratedLateWalkingEntry);
const repairedSamsungWalkingEntry = {
  id: "health:health_connect:total_energy:samsung-walk:exercise",
  metricId: "exercise",
  userId: "owner",
  value: 126,
  localDate: "2026-08-24",
  recordedAt: "2026-08-24T17:32:00.000Z",
  visibility: "group",
  source: "imported",
  sourceProvider: "health_connect",
  sourceRecordId: "samsung-walk",
  sourceOrigin: "com.sec.android.app.shealth",
  label: "Walking",
};
const repairedLateWalking = migrateRetiredWorkoutCaloriesEntries(
  [...migratedLateWalking.entries, repairedSamsungWalkingEntry],
  "owner",
);
assert.equal(
  repairedLateWalking.entries.some(
    (entry) => entry.id === migratedLateWalkingEntry.id,
  ),
  false,
  "a later Samsung repair must replace the strongly matching legacy manual Walking projection",
);
assert.ok(
  repairedLateWalking.entries.some(
    (entry) => entry.id === repairedSamsungWalkingEntry.id,
  ),
  "late repair reconciliation must retain the canonical Samsung workout row",
);
assert.ok(
  repairedLateWalking.removedOwnEntryIds.includes(
    migratedLateWalkingEntry.id,
  ),
  "the replaced legacy projection must receive a durable owner tombstone",
);
const ordinaryManualWalkingEntry = {
  ...lateLegacyWalkingEntry,
  id: "entry-current-manual-walking-calories",
  metricId: "exercise",
};
const ordinaryManualWalking = migrateRetiredWorkoutCaloriesEntries(
  [ordinaryManualWalkingEntry, repairedSamsungWalkingEntry],
  "owner",
);
assert.ok(
  ordinaryManualWalking.entries.some(
    (entry) => entry.id === ordinaryManualWalkingEntry.id,
  ),
  "an ordinary manual Active-energy entry must never be deleted by legacy cleanup",
);
const unrelatedManualWalking = migrateRetiredWorkoutCaloriesEntries(
  [
    ...migratedLateWalking.entries,
    {
      ...repairedSamsungWalkingEntry,
      id: `${repairedSamsungWalkingEntry.id}:different-session`,
      sourceRecordId: "samsung-different-walk",
      value: 220,
      recordedAt: "2026-08-24T21:00:00.000Z",
    },
  ],
  "owner",
);
assert.ok(
  unrelatedManualWalking.entries.some(
    (entry) => entry.id === migratedLateWalkingEntry.id,
  ),
  "a different synced walk must not delete an unrelated legacy manual entry",
);
const deletionWinsEntries = migrateRetiredWorkoutCaloriesEntries(
  legacyCaloriesState.entries,
  legacyCaloriesState.currentUserId,
  [canonicalActiveEntryId],
);
assert.equal(
  deletionWinsEntries.entries.some(
    (entry) => entry.id === canonicalActiveEntryId,
  ),
  false,
  "an explicit prior Active-energy deletion must not be resurrected by retirement",
);
const retiredDeletionWinsEntries = migrateRetiredWorkoutCaloriesEntries(
  legacyCaloriesState.entries,
  legacyCaloriesState.currentUserId,
  [retiredEntryId],
);
assert.equal(
  retiredDeletionWinsEntries.entries.some(
    (entry) => entry.id === canonicalActiveEntryId,
  ),
  false,
  "a deleted legacy Workout-calories row must not return as ghost Active energy",
);

const seed = fs.readFileSync("src/data/seed.ts", "utf8");
const catalog = fs.readFileSync("src/domain/trackerCatalog.ts", "utf8");
const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const migration = fs.readFileSync("src/domain/stateMigration.ts", "utf8");
const editor = fs.readFileSync("app/metric-editor.tsx", "utf8");
const health = fs.readFileSync("src/domain/health.ts", "utf8");
const log = fs.readFileSync("app/(tabs)/log.tsx", "utf8");
const gymScreen = fs.readFileSync("app/(tabs)/gym.tsx", "utf8");
const metricDetail = fs.readFileSync("app/metric-detail.tsx", "utf8");
const types = fs.readFileSync("src/types.ts", "utf8");
const workoutNotifications = fs.readFileSync(
  "src/notifications/workoutTimer.ts",
  "utf8",
);
const groupCloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const metricsDomain = fs.readFileSync("src/domain/metrics.ts", "utf8");
const backgroundFinish = fs.readFileSync(
  "src/domain/backgroundWorkoutFinish.ts",
  "utf8",
);
assert.match(seed, /id: "workout"[\s\S]{0,500}gymMapping: \{ kind: "session_completed" \}/);
assert.match(seed, /id: "workout_duration"[\s\S]{0,500}gymMapping: \{ kind: "session_duration" \}/);
assert.match(seed, /id: "workout"[\s\S]{0,600}workoutQualification: DEFAULT_WORKOUT_QUALIFICATION/);
assert.doesNotMatch(seed, /id: "workout_calories"/);
assert.doesNotMatch(seed, /workout_calories: \{ dataType: "workouts", field: "active_calories" \}/);
assert.doesNotMatch(provider, /metricId: "workout_calories"/);
assert.match(provider, /workoutQualifies\(/);
assert.match(health, /workoutCompletionQualifies/);
assert.match(
  migration,
  /retireWorkoutCalories\(state, defaults\)/,
  "every upgraded snapshot must converge on Active energy without the duplicate tracker",
);
assert.match(migration, /workoutCaloriesRestored: true/);
assert.match(migration, /RETIRED_METRIC_IDS/);
assert.match(editor, /What counts as a workout/);
assert.match(
  editor,
  /Recommended uses any one: walk 30 min, 2 km, or 100 kcal; run 20 min, 3 km, or 150 kcal; strength 30 min or 120 kcal; other activity 20 min, 3 km, or 100 kcal\./,
  "the editor must summarize every Recommended OR threshold compactly",
);
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
assert.match(
  log,
  /\["exercise", workoutCalories\]/,
  "a manually logged workout must save calories directly to Active energy",
);
assert.doesNotMatch(log, /\["workout_calories", workoutCalories\]/);
assert.match(types, /gymTimerMode\?: GymTimerMode/);
assert.match(
  gymScreen,
  /const configuredTimerMode: GymTimerMode =[\s\S]{0,120}state\.settings\.gymTimerMode === "whole_workout"[\s\S]{0,80}: "guided"/,
  "The existing set/rest timer must remain the default for old and new accounts",
);
assert.match(gymScreen, /setWorkoutTimer\(\{[\s\S]{0,120}\.\.\.draft\.timer,[\s\S]{0,180}: "guided"/);
assert.match(gymScreen, /setWorkoutTimer\(\{[\s\S]{0,100}mode: configuredTimerMode,[\s\S]{0,100}phase: "work"/);
assert.match(
  gymScreen,
  /function advanceWorkoutTimer[\s\S]{0,150}workoutTimer\.mode === "whole_workout"\) return/,
  "Whole-workout mode must not enter per-set or rest progression",
);
assert.match(
  gymScreen,
  /workoutTimer\.mode !== "whole_workout" \? \([\s\S]{0,180}advanceWorkoutTimer\(\)/,
  "The fixed Next control must exist only for the original guided timer",
);
assert.match(gymScreen, /updateSettings\(\{ gymTimerMode: "guided" \}\)/);
assert.match(gymScreen, /updateSettings\(\{ gymTimerMode: "whole_workout" \}\)/);
assert.match(gymScreen, /onPress=\{completeAllSets\}[\s\S]{0,500}>Complete all</);
assert.match(
  gymScreen,
  /plannedSetCount > 0 &&[\s\S]{0,180}!allWorkoutSetsComplete &&[\s\S]{0,180}workoutTimer\.mode === "whole_workout"/,
  "Complete all must stay hidden until the workout contains at least one planned set",
);
assert.match(gymScreen, /setExercises\(\(current\) => completeGymWorkout\(current\)\)/);
assert.match(
  gymScreen,
  /function completeAllSets\(\)[\s\S]{0,220}setOpenExerciseId\(null\)/,
  "Complete all must collapse every completed exercise after marking its sets",
);
assert.match(gymScreen, /setGymExerciseCompletion\(item, completed\)/);
assert.match(
  gymScreen,
  /accessibilityLabel=\{`Mark \$\{exercise\.name\} incomplete`\}[\s\S]{0,400}setExerciseCompletion\(exercise, false\)/,
  "The green exercise completion control must undo the exercise and all sets",
);
assert.match(
  gymScreen,
  /sets\.length > 0 && sets\.every\(\(item\) => item\.completed\)/,
  "Manually checking sets must keep exercise completion synchronized",
);
assert.match(gymScreen, />\s*Template options\s*</);
assert.match(gymScreen, /Save personal template/);
assert.match(gymScreen, /Save personal copy/);
assert.match(gymScreen, /Share template with group/);
assert.match(
  gymScreen,
  /canManageGroup && !isPersonalSetupGroup\(state\.group\)/,
  "Share template with group must stay hidden until the user has an active group",
);
for (const trackingMode of ["duration", "reps", "load_reps"]) {
  assert.match(
    gymScreen,
    new RegExp(`id: "${trackingMode}"`),
    `Custom exercise creation must expose ${trackingMode} tracking`,
  );
}
assert.match(
  gymScreen,
  /trackingMode: customExerciseTrackingMode/,
  "A custom exercise must retain the selected time, reps, or load/reps mode",
);
assert.match(
  gymScreen,
  /\{selectedPersonalPlan \? \([\s\S]{0,500}Save personal copy/,
  "Save copy must appear only for an existing personal template",
);
assert.doesNotMatch(gymScreen, /Share mapped workout results/);
assert.match(
  gymScreen,
  /setIntensity\("moderate"\)[\s\S]{0,240}setVisibility\("group"\)/,
  "New workouts must follow per-tracker visibility by default",
);
assert.match(
  gymScreen,
  /It does not share this workout log\./,
  "Sharing a template must explain that it does not publish the workout log",
);
for (const privacySource of [provider, groupCloud, metricsDomain, backgroundFinish]) {
  assert.match(
    privacySource,
    /gymSessionVisibilityForMetric/,
    "Every workout projection and cloud-sharing path must enforce tracker privacy",
  );
}
assert.match(
  metricDetail,
  /function promptGymSessionRemoval[\s\S]{0,500}deleteGymSession\(session\.id\)/,
  "Holding a derived gym entry must delete its source session rather than only one metric projection",
);
assert.match(
  metricDetail,
  /gymSourceSessions\.map[\s\S]{0,3200}onLongPress=\{\(\) => promptGymSessionRemoval\(session\)\}/,
  "Saved gym sessions must expose deletion from the workout tracker detail page",
);
assert.match(
  metricDetail,
  /accessibilityRole="button"[\s\S]{0,220}accessibilityLabel=\{t\(`Delete \$\{session\.name \|\| "Workout"\}`\)\}[\s\S]{0,220}onPress=\{\(\) => promptGymSessionRemoval\(session\)\}/,
  "Saved gym sessions must expose a keyboard-accessible delete button on web",
);
assert.match(
  provider,
  /case "deleteGymSession"[\s\S]{0,1400}gymSessions:[\s\S]{0,260}item\.id !== action\.sessionId[\s\S]{0,500}entries:[\s\S]{0,300}!entry\.id\.startsWith\(`gym-sync:\$\{action\.sessionId\}:`\)/,
  "Deleting a gym session must remove both the Workout-page source and all linked tracker rows",
);
assert.match(types, /gymLoggedTodayCollapsed\?: boolean/);
assert.match(seed, /gymLoggedTodayCollapsed: true/);
assert.match(gymScreen, />Logged today</);
assert.match(
  gymScreen,
  /state\.settings\.gymLoggedTodayCollapsed !== false/,
  "Logged today must remain collapsed by default for older and new accounts",
);
assert.match(
  gymScreen,
  /updateSettings\(\{[\s\S]{0,100}gymLoggedTodayCollapsed: !loggedTodayCollapsed/,
  "Workout must persist the user's Logged today disclosure choice",
);
assert.match(
  gymScreen,
  /!loggedTodayCollapsed \? \([\s\S]{0,100}<ScrollView/,
  "Saved workout cards must render only while Logged today is expanded",
);
assert.match(
  gymScreen,
  /const selectedSessionLogged = Boolean\([\s\S]{0,180}completedGymSets\(selectedSession\.exercises\) > 0/,
  "A saved zero-set plan must not be treated as a logged workout",
);
assert.match(
  gymScreen,
  /selectedSessionLogged \? "Workout logged" : "Plan & log workout"/,
  "Workout must distinguish a completed saved session from a draft plan",
);
assert.doesNotMatch(
  gymScreen,
  /styles\.workoutEditorHeading|selectedSession \? "Saved" : "Draft"/,
  "Workout must not repeat saved state in a second oversized summary card",
);
assert.match(
  gymScreen,
  /const workoutEditorTitle = selectedSessionLogged[\s\S]{0,180}"Logged exercises"[\s\S]{0,180}"Exercises to complete"/,
  "Exercise hierarchy must state whether the user is reviewing logged work or preparing a workout",
);
assert.match(
  gymScreen,
  /loggedSessionsForDate\.reduce\(/,
  "Logged Today totals must exclude incomplete saved plans",
);
assert.match(
  gymScreen,
  /const logged = completedGymSets\(session\.exercises\) > 0/,
  "Each saved workout row must derive its completion state from its sets",
);
assert.match(
  gymScreen,
  /\{loggedSessionsForDate\.length \? \(/,
  "Logged today must stay hidden when there are only saved drafts",
);
assert.match(
  gymScreen,
  /loggedSessionsForDate\.map\(\(session, index\) =>/,
  "Logged today must exclude saved drafts from its rows",
);
assert.match(
  gymScreen,
  /logged \? "Logged" : "Draft"/,
  "Incomplete saved plans must remain visibly marked as drafts",
);
assert.match(
  gymScreen,
  /label=\{selectedSession \? "Update workout" : "Save workout"\}/,
  "The primary action must distinguish updating a logged workout from saving a new one",
);
assert.match(
  gymScreen,
  /const loadedSavedSessionId = useRef<string \| null>\(null\)/,
  "Workout must retain the identity of the saved session currently being reviewed",
);
const externalDeletionReconciliation = gymScreen.slice(
  gymScreen.indexOf("const loadedId = loadedSavedSessionId.current"),
  gymScreen.indexOf("}, [hydrated, sessions]);") + "}, [hydrated, sessions]);".length,
);
assert.ok(externalDeletionReconciliation.length > 0);
assert.match(
  externalDeletionReconciliation,
  /sessions\.some\(\(session\) => session\.id === loadedId\)[\s\S]{0,360}loadedSavedSessionId\.current = null[\s\S]{0,120}setSessionId\(uniqueId\("gym"\)\)/,
  "An externally deleted saved workout must be detached before another save can recreate it",
);
assert.doesNotMatch(
  externalDeletionReconciliation,
  /seedNewSession|setWorkoutTimer|setSelectedPlanId|setExercises/,
  "External deletion reconciliation must preserve the visible draft, timer, and selected template",
);
const exercisePicker = gymScreen.slice(
  gymScreen.indexOf('visible={pickerOpen}'),
  gymScreen.indexOf('visible={recapOpen}'),
);
assert.ok(exercisePicker.length > 0);
assert.doesNotMatch(
  exercisePicker,
  /autoFocus/,
  "Add Exercise must show its menu without forcing Search or the keyboard open",
);
assert.match(
  gymScreen,
  /allowProgression: workoutTimer\.mode !== "whole_workout"/,
  "Whole-workout notifications must not expose a stale Next action",
);
assert.match(workoutNotifications, /allowProgression = true/);
assert.match(
  workoutNotifications,
  /allowProgression && actionToken && maxActions > 0/,
  "The notification API must preserve guided progression by default while allowing the whole timer to suppress Next",
);

console.log("Canonical workout tracker merge, compatibility aliases, and onboarding recommendations validated.");
