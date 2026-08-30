import { isFoodNutrientTrackerId } from "@/src/domain/food";
import type { MetricDefinition } from "@/src/types";

export type MetricLoggingDestination =
  | "direct"
  | "food"
  | "weight"
  | "workout"
  | "none";

const WORKOUT_DERIVED_IDS = new Set([
  "workout",
  "workout_duration",
  "workout_distance",
  "exercise",
  "energy_burned",
]);

const MANUAL_WORKOUT_LOGGER_IDS = new Set([
  "workout",
  "workout_duration",
  "workout_distance",
  "exercise",
]);

const BODY_COMPOSITION_IDS = new Set([
  "body_fat",
  "lean_body_mass",
  "body_water_mass",
  "bone_mass",
]);

const NON_DIRECT_IDS = new Set([
  "blood_pressure_diastolic",
  "deficit",
  "overall_score",
  "screen_time",
  "todo_completion",
  "weekly_deficit",
  "weekly_deficit_balance",
]);

/**
 * One pure routing boundary for entry creation. Derived trackers never receive
 * a generic manual row: users are sent to the source workflow that owns the
 * data instead.
 */
export function metricLoggingDestination(
  metric: Pick<
    MetricDefinition,
    | "id"
    | "category"
    | "dataType"
    | "fastingSettings"
    | "gymMapping"
    | "healthMapping"
    | "manualEntry"
    | "stepFallback"
  >,
): MetricLoggingDestination {
  if (metric.id === "food") return "food";
  if (
    isFoodNutrientTrackerId(metric.id) ||
    metric.healthMapping?.dataType === "nutrition"
  )
    return "food";

  if (metric.id === "weight" || metric.healthMapping?.dataType === "weight")
    return "weight";
  if (
    BODY_COMPOSITION_IDS.has(metric.id) ||
    ["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"].includes(
      metric.healthMapping?.dataType ?? "",
    )
  )
    return "weight";

  if (
    WORKOUT_DERIVED_IDS.has(metric.id) ||
    metric.category === "gym" ||
    Boolean(metric.gymMapping) ||
    metric.healthMapping?.dataType === "workouts" ||
    metric.healthMapping?.dataType === "active_energy" ||
    metric.stepFallback === true
  )
    return "workout";

  if (
    NON_DIRECT_IDS.has(metric.id) ||
    metric.healthMapping?.dataType === "total_energy" ||
    metric.dataType === "calculated" ||
    Boolean(metric.fastingSettings) ||
    (metric.manualEntry === false && metric.id !== "steps")
  )
    return "none";

  return "direct";
}

/** The canonical logger selection for a source-specific metric detail. */
export function metricLoggingTargetId(
  metric: Parameters<typeof metricLoggingDestination>[0],
) {
  const destination = metricLoggingDestination(metric);
  if (destination === "food") return "food";
  if (destination === "weight") return "weight";
  if (destination === "workout" && MANUAL_WORKOUT_LOGGER_IDS.has(metric.id))
    return "workout";
  return destination === "direct" ? metric.id : undefined;
}

/**
 * The generic Log picker contains only true entry points. Nutrient and body
 * composition details remain discoverable, but open their parent logger.
 */
export function metricAppearsInLogPicker(
  metric: Parameters<typeof metricLoggingDestination>[0],
  allMetrics: readonly Pick<MetricDefinition, "id">[] = [],
) {
  const destination = metricLoggingDestination(metric);
  if (destination === "direct") {
    // Blood pressure already captures an optional pulse in the same reading;
    // avoid presenting a duplicate default choice while preserving direct
    // pulse logging from its own detail page.
    if (
      metric.id === "pulse" &&
      allMetrics.some((candidate) => candidate.id === "blood_pressure_systolic")
    )
      return false;
    return true;
  }
  return (
    (destination === "food" && metric.id === "food") ||
    (destination === "weight" && metric.id === "weight") ||
    (destination === "workout" && metric.id === "workout")
  );
}

export function isBodyCompositionMetric(
  metric: Parameters<typeof metricLoggingDestination>[0],
) {
  return metricLoggingDestination(metric) === "weight" && metric.id !== "weight";
}
