import { MetricDefinition } from "@/src/types";

type ProgressReminderMetric = Pick<
  MetricDefinition,
  "goal" | "goalRange" | "goalProgressMode"
> &
  Partial<Pick<MetricDefinition, "id">>;

/**
 * Quiet presets for the built-in catalog. Custom trackers still use the
 * goal-kind fallback below, and any percentages explicitly saved by a user
 * continue to take precedence.
 */
const DEFAULT_TRACKER_PROGRESS_PRESETS: Record<string, readonly number[]> = {
  // Daily limits: warn near the limit instead of celebrating early use.
  food: [75, 90, 100],
  carbs: [75, 90, 100],
  sodium: [75, 90, 100],
  sugar: [75, 90, 100],
  saturated_fat: [75, 90, 100],
  cholesterol: [75, 90, 100],
  screen_time: [50, 75, 90, 100],

  // Frequently updated goals: useful encouragement without a 25% alert.
  steps: [50, 75, 90, 100],
  exercise: [50, 75, 100],
  workout_duration: [50, 75, 100],
  workout_calories: [50, 75, 100],
  workout_distance: [50, 75, 100],
  protein: [50, 75, 100],
  fiber: [50, 75, 100],
  potassium: [50, 75, 100],
  calcium: [50, 75, 100],
  iron: [50, 75, 100],
  magnesium: [50, 75, 100],
  vitamin_c: [50, 75, 100],
  vitamin_d: [50, 75, 100],
  vitamin_b12: [50, 75, 100],
  todo_completion: [50, 100],

  // Deliberately paced activities benefit from quarter-way encouragement.
  water: [25, 50, 75, 100],
  reading: [25, 50, 75, 100],
  study: [25, 50, 75, 100],
  work: [25, 50, 75, 100],
  intermittent_fasting: [50, 75, 90, 100],

  // Sparse readings and completion trackers should only alert on success.
  workout: [100],
  progress_photo: [100],
  fat: [100],
  sleep: [100],
  blood_pressure_systolic: [100],
  blood_pressure_diastolic: [100],
  pulse: [100],

  // Long-term journeys progress slowly enough for quarter milestones.
  weight: [25, 50, 75, 100],
  body_fat: [25, 50, 75, 100],
  lean_body_mass: [25, 50, 75, 100],
  body_water_mass: [25, 50, 75, 100],
  bone_mass: [25, 50, 75, 100],
};

export function defaultReminderTimes(metric: Pick<MetricDefinition, "id" | "category">) {
  if (metric.id === "food") return ["08:30", "13:30", "19:30"];
  if (metric.id === "steps") return ["10:00", "13:00", "17:00", "20:00"];
  if (["exercise", "workout", "workout_duration"].includes(metric.id))
    return ["17:30"];
  if (metric.id === "water") return ["10:00", "14:00", "18:00"];
  if (metric.id === "sleep") return ["21:30"];
  if (metric.category === "mind") return ["19:00"];
  return ["19:00"];
}

/** Sensible opt-in progress milestones; time reminders remain independent. */
export function defaultProgressReminderPercentages(
  metric: ProgressReminderMetric,
) {
  const preset = metric.id
    ? DEFAULT_TRACKER_PROGRESS_PRESETS[metric.id]
    : undefined;
  if (preset) return [...preset];
  if (metric.goalRange || metric.goal.kind === "complete" || metric.goal.kind === "exact")
    return [100];
  if (metric.goal.kind === "at_most") return [50, 75, 90, 100];
  if (metric.goalProgressMode === "journey") return [25, 50, 75, 100];
  return [25, 50, 75, 100];
}
