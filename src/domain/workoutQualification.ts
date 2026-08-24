import type {
  WorkoutQualification,
  WorkoutQualificationActivity,
} from "@/src/types";

import { catalogExercise } from "./exerciseCatalog";

const WALKING_KEYS = new Set(["walking", "hiking"]);
const RUNNING_KEYS = new Set([
  "running",
  "track_running",
  "treadmill_running",
]);
const STRENGTH_KEYS = new Set([
  "strength_training",
  "functional_strength_training",
  "weightlifting",
  "weight_machine",
]);

/** Sensible defaults prevent a very short walk from completing Workout. */
export const DEFAULT_WORKOUT_QUALIFICATION: WorkoutQualification = {
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

export const ANY_RECORDED_WORKOUT_QUALIFICATION: WorkoutQualification = {
  rules: [{ activity: "any", thresholdMode: "any" }],
};

export type WorkoutQualificationSample = {
  activityKey?: string;
  /** Local gym sessions can supply their known family without inventing a key. */
  activity?: WorkoutQualificationActivity;
  durationMinutes?: number;
  distanceKm?: number;
  activeCalories?: number;
};

export function workoutActivityFamily(
  activityKey?: string,
): Exclude<WorkoutQualificationActivity, "any"> {
  const key = activityKey?.trim().toLowerCase();
  if (!key) return "other";
  if (WALKING_KEYS.has(key)) return "walking";
  if (RUNNING_KEYS.has(key)) return "running";
  if (STRENGTH_KEYS.has(key)) return "strength";
  const catalog = catalogExercise(key);
  if (catalog?.category === "strength") return "strength";
  return "other";
}

function finiteNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

export function workoutQualifies(
  sample: WorkoutQualificationSample,
  qualification: WorkoutQualification | undefined = DEFAULT_WORKOUT_QUALIFICATION,
) {
  const rules = qualification?.rules?.length
    ? qualification.rules
    : DEFAULT_WORKOUT_QUALIFICATION.rules;
  const family =
    sample.activity && sample.activity !== "any"
      ? sample.activity
      : workoutActivityFamily(sample.activityKey);
  return rules.some((rule) => {
    if (rule.activity !== "any" && rule.activity !== family) return false;
    const checks: boolean[] = [];
    if (finiteNonNegative(rule.minimumDurationMinutes) > 0)
      checks.push(
        finiteNonNegative(sample.durationMinutes) >=
          finiteNonNegative(rule.minimumDurationMinutes),
      );
    if (finiteNonNegative(rule.minimumDistanceKm) > 0)
      checks.push(
        finiteNonNegative(sample.distanceKm) >=
          finiteNonNegative(rule.minimumDistanceKm),
      );
    if (finiteNonNegative(rule.minimumActiveCalories) > 0)
      checks.push(
        finiteNonNegative(sample.activeCalories) >=
          finiteNonNegative(rule.minimumActiveCalories),
      );
    if (!checks.length) return true;
    return rule.thresholdMode === "any"
      ? checks.some(Boolean)
      : checks.every(Boolean);
  });
}

export function isDefaultWorkoutQualification(
  value: WorkoutQualification | undefined,
) {
  return (
    !value ||
    JSON.stringify(value) === JSON.stringify(DEFAULT_WORKOUT_QUALIFICATION)
  );
}

export function isAnyRecordedWorkoutQualification(
  value: WorkoutQualification | undefined,
) {
  return (
    JSON.stringify(value) ===
    JSON.stringify(ANY_RECORDED_WORKOUT_QUALIFICATION)
  );
}
