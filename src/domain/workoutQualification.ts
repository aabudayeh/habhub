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

const LEGACY_DEFAULT_WORKOUT_QUALIFICATION: WorkoutQualification = {
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

/**
 * Recommended defaults accept any one meaningful signal that a real session
 * occurred. This keeps short incidental movement out without penalizing
 * providers that report only duration, distance, or active calories.
 */
export const DEFAULT_WORKOUT_QUALIFICATION: WorkoutQualification = {
  rules: [
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
};

export const ANY_RECORDED_WORKOUT_QUALIFICATION: WorkoutQualification = {
  rules: [{ activity: "any", thresholdMode: "any" }],
};

const QUALIFICATION_RULE_FIELDS = [
  "activity",
  "thresholdMode",
  "minimumDurationMinutes",
  "minimumDistanceKm",
  "minimumActiveCalories",
] as const;

/**
 * PostgreSQL jsonb does not preserve object-key order, and callers may also
 * reorder independent activity rules. Compare the preset's actual semantics
 * while rejecting duplicate activities, unknown fields, and every changed
 * threshold so genuinely custom qualifications remain custom.
 */
function matchesWorkoutQualificationPreset(
  value: WorkoutQualification | undefined,
  preset: WorkoutQualification,
) {
  if (!value || !Array.isArray(value.rules)) return false;
  if (
    Object.keys(value).some((key) => key !== "rules") ||
    value.rules.length !== preset.rules.length
  )
    return false;

  const rulesByActivity = new Map(
    value.rules.map((rule) => [rule.activity, rule] as const),
  );
  if (rulesByActivity.size !== value.rules.length) return false;

  return preset.rules.every((expected) => {
    const candidate = rulesByActivity.get(expected.activity);
    if (!candidate) return false;
    if (
      Object.keys(candidate).some(
        (key) =>
          !QUALIFICATION_RULE_FIELDS.includes(
            key as (typeof QUALIFICATION_RULE_FIELDS)[number],
          ),
      )
    )
      return false;
    return QUALIFICATION_RULE_FIELDS.every(
      (field) => candidate[field] === expected[field],
    );
  });
}

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
  const configured = qualification?.rules?.length
    ? qualification
    : DEFAULT_WORKOUT_QUALIFICATION;
  // Existing trackers persisted the former duration-only recommended value.
  // Treat that exact preset as Recommended so they receive the improved
  // provider-tolerant defaults; every genuinely custom rule stays untouched.
  const rules =
    matchesWorkoutQualificationPreset(
      configured,
      LEGACY_DEFAULT_WORKOUT_QUALIFICATION,
    )
      ? DEFAULT_WORKOUT_QUALIFICATION.rules
      : configured.rules;
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
    matchesWorkoutQualificationPreset(value, DEFAULT_WORKOUT_QUALIFICATION) ||
    matchesWorkoutQualificationPreset(
      value,
      LEGACY_DEFAULT_WORKOUT_QUALIFICATION,
    )
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
