import type { MetricEntry, Visibility } from "../types";
import { gymSessionVisibilityForMetric } from "./gym";

export const MANUAL_WORKOUT_DETAIL_METRIC_IDS = [
  "workout_duration",
  "workout_distance",
  "exercise",
] as const;

export type ManualWorkoutDetailMetricId =
  (typeof MANUAL_WORKOUT_DETAIL_METRIC_IDS)[number];

export type ManualWorkoutLog = {
  activeCalories?: number;
  /** Canonical activity chosen from HabHub's workout menu. Free text leaves this unset. */
  activityKey?: string;
  distanceKm?: number;
  durationMinutes?: number;
  imageUri?: string;
  /** A menu choice is an explicit request to use this session for Step coverage. */
  includeInStepCoverage?: boolean;
  label?: string;
  localDate: string;
  note?: string;
  recordedAt: string;
  visibility: Visibility;
};

type ManualWorkoutEntryInput = ManualWorkoutLog & {
  eventId: string;
  metricVisibilities: ReadonlyMap<string, Visibility>;
  savedAt: string;
  userId: string;
};

function positive(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

/**
 * Build one manual workout event and its independently private detail rows.
 * Every row shares sourceRecordId, so duration, distance, and active energy can
 * be associated later without copying those values onto the Workout parent.
 */
export function manualWorkoutEntries({
  activeCalories,
  activityKey,
  distanceKm,
  durationMinutes,
  eventId,
  imageUri,
  label,
  localDate,
  metricVisibilities,
  note,
  recordedAt,
  savedAt,
  userId,
  visibility,
}: ManualWorkoutEntryInput): MetricEntry[] {
  if (!metricVisibilities.has("workout")) return [];

  const sourceRecordId = `manual-workout:${eventId}`;
  const workoutLabel = label?.trim() || "Workout";
  const normalizedActivityKey = activityKey?.trim() || undefined;
  const shared = {
    userId,
    localDate,
    recordedAt,
    source: "manual" as const,
    sourceRecordId,
    sourceUpdatedAt: savedAt,
    label: workoutLabel,
    note: note?.trim() || undefined,
    ...(normalizedActivityKey
      ? { stepCoverageActivityKey: normalizedActivityKey }
      : {}),
  };
  const values: Partial<Record<ManualWorkoutDetailMetricId, number>> = {
    workout_duration: positive(durationMinutes),
    workout_distance: positive(distanceKm),
    exercise: positive(activeCalories),
  };

  const parent: MetricEntry = {
    ...shared,
    id: `${sourceRecordId}:workout`,
    metricId: "workout",
    value: true,
    visibility: gymSessionVisibilityForMetric(
      visibility,
      metricVisibilities.get("workout") ?? "private",
    ),
    imageUri,
  };
  const details = MANUAL_WORKOUT_DETAIL_METRIC_IDS.flatMap((metricId) => {
    const value = values[metricId];
    const metricVisibility = metricVisibilities.get(metricId);
    if (value === undefined || metricVisibility === undefined) return [];
    return [
      {
        ...shared,
        id: `${sourceRecordId}:${metricId}`,
        metricId,
        value,
        visibility: gymSessionVisibilityForMetric(
          visibility,
          metricVisibility,
        ),
      } satisfies MetricEntry,
    ];
  });
  return [parent, ...details];
}
