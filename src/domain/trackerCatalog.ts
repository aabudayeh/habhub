import { DEFAULT_METRICS } from '@/src/data/seed';
import { recommendedDailyDeficit, recommendedDailyIntakeForDirection } from '@/src/domain/energy';
import { AppState, MuscleGroup, NewMetric } from '@/src/types';
import { defaultReminderTimes } from '@/src/domain/reminders';
import {
  EXERCISE_CATALOG,
  EXERCISE_CATEGORY_LABELS,
  MUSCLE_LABELS,
} from '@/src/domain/exerciseCatalog';

export type TrackerPreset = NewMetric & { templateId: string; description: string };

export function trackerGroupLabel(metric: {
  grouping?: string;
  category?: NewMetric["category"];
}) {
  if (metric.grouping?.trim()) return metric.grouping.trim();
  const labels: Record<NonNullable<NewMetric["category"]>, string> = {
    goals: "Goals",
    activity: "Activity",
    nutrition: "Food & nutrition",
    body: "Body composition",
    health: "Health readings",
    gym: "Workout",
    mind: "Mind & focus",
    photos: "Photos",
    other: "Other",
  };
  return metric.category ? labels[metric.category] : "Other";
}

export function isBloodPressureSystolic(metric: {
  id?: string;
  templateId?: string;
  healthMapping?: NewMetric["healthMapping"];
}) {
  return (
    metric.id === "blood_pressure_systolic" ||
    metric.templateId === "blood_pressure_systolic" ||
    (metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "systolic")
  );
}

export function isBloodPressureDiastolic(metric: {
  id?: string;
  templateId?: string;
  healthMapping?: NewMetric["healthMapping"];
}) {
  return (
    metric.id === "blood_pressure_diastolic" ||
    metric.templateId === "blood_pressure_diastolic" ||
    (metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "diastolic")
  );
}

export function isInternalTracker(metric: {
  id: string;
  healthMapping?: NewMetric["healthMapping"];
}) {
  return (
    isBloodPressureDiastolic(metric)
  );
}

export function trackerPresets(state: AppState, includeInternal = false): TrackerPreset[] {
  const profile = state.settings.energyProfile;
  const direction = state.settings.weightDirection ?? 'lose';
  const adjustment = recommendedDailyDeficit(profile);
  const builtIns = DEFAULT_METRICS
    .filter(
      (item) =>
        includeInternal || !isInternalTracker(item),
    )
    .map((item): TrackerPreset => {
      const preset: TrackerPreset = {
        templateId: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
        unit: item.unit,
        dataType: item.dataType,
        aggregation: item.aggregation,
        goal: { ...item.goal },
        adaptiveGoalTarget: item.adaptiveGoalTarget
          ? { ...item.adaptiveGoalTarget }
          : undefined,
        goalEnabled: item.goalEnabled,
        goalRange: item.goalRange ? { ...item.goalRange } : undefined,
        goalProgressMode: item.goalProgressMode,
        category: item.category,
        healthMapping: item.healthMapping ? { ...item.healthMapping } : undefined,
        gymMapping: item.gymMapping,
        gymMuscleGroups: item.gymMuscleGroups,
        stepFallback: item.stepFallback,
        manualEntry: item.manualEntry,
        timerEnabled: item.timerEnabled,
        fastingSettings: item.fastingSettings
          ? { ...item.fastingSettings }
          : undefined,
        submetrics: item.submetrics?.map((submetric) => ({
          ...submetric,
          goal: { ...submetric.goal },
          goalRange: submetric.goalRange
            ? { ...submetric.goalRange }
            : undefined,
          healthMapping: submetric.healthMapping
            ? { ...submetric.healthMapping }
            : undefined,
        })),
        submetricDisplay: item.submetricDisplay
          ? { ...item.submetricDisplay }
          : undefined,
        rankingDirection: item.rankingDirection,
        defaultVisibility: item.defaultVisibility,
        formula: item.formula,
        reminders: (item.reminders?.length
          ? item.reminders
          : defaultReminderTimes(item).map((time) => ({ enabled: false, time }))),
        description: presetDescription(item.id),
      };
      if (item.id === 'food') {
        preset.goal = {
          kind:
            direction === 'gain'
              ? 'at_least'
              : direction === 'maintain'
                ? 'exact'
                : 'at_most',
          target: recommendedDailyIntakeForDirection(profile, direction),
        };
        preset.goalRange = undefined;
      }
      if (item.id === 'weight') preset.goal.target = profile.targetWeightKg;
      if (item.id === 'deficit') {
        preset.name = direction === 'gain' ? 'Daily surplus' : direction === 'maintain' ? 'Energy balance' : 'Daily deficit';
        preset.goal = direction === 'maintain' ? { kind: 'exact', target: 0 } : { kind: 'at_least', target: adjustment };
        preset.goalRange = direction === 'maintain' ? { min: -150, max: 150 } : undefined;
        preset.formula = direction === 'lose' ? 'energy_burned - food' : 'food - energy_burned';
      }
      if (item.id === 'blood_glucose') {
        preset.goalEnabled = false;
        preset.goalRange = undefined;
      }
      if (item.id === 'pulse') {
        preset.goalEnabled = true;
        preset.goal = { kind: 'exact', target: 75 };
        preset.goalRange = {
          min: profile.activityLevel === 'athlete' ? 45 : 60,
          max: profile.age < 18 ? 110 : 100,
        };
      }
      if (item.id === 'blood_pressure_systolic') {
        preset.name = 'Blood pressure';
        preset.goalEnabled = true;
        preset.goal = { kind: 'exact', target: 120 };
        preset.goalRange = { min: 90, max: 120 };
      }
      return preset;
    });
  const catalogKeys = new Set(EXERCISE_CATALOG.map((item) => item.key));
  const groupExercisePresets = [
    ...new Map(
      (state.group.gymPlans ?? [])
        .flatMap((plan) => plan.exercises)
        .filter(
          (exercise) =>
            exercise.exerciseKey &&
            !catalogKeys.has(exercise.exerciseKey),
        )
        .map((exercise) => [exercise.exerciseKey!, exercise]),
    ).values(),
  ].map((exercise) =>
    gymPreset({
      templateId: `gym_${exercise.exerciseKey!.replace(/[^a-z0-9]+/gi, "_")}_strength`,
      name: `${exercise.name} strength`,
      unit: "kg e1RM",
      goal: { kind: "at_least", target: 1 },
      gymMapping: {
        kind: "exercise_one_rep_max",
        exerciseKey: exercise.exerciseKey!,
      },
      gymMuscleGroups: exercise.muscleGroups,
      description:
        "Workout · shared group exercise using one stable comparison key.",
    }),
  );
  return [...builtIns, ...GYM_TRACKER_PRESETS, ...groupExercisePresets];
}

const gymPreset = (
  preset: Pick<
    TrackerPreset,
    | "templateId"
    | "name"
    | "unit"
    | "goal"
    | "gymMapping"
    | "description"
  > &
    Partial<
      Pick<
        TrackerPreset,
        | "dataType"
        | "aggregation"
        | "goalEnabled"
        | "rankingDirection"
        | "gymMuscleGroups"
        | "healthMapping"
        | "grouping"
      >
    >,
): TrackerPreset => ({
  ...preset,
  icon: "barbell-outline",
  color: "#8B5CF6",
  dataType: preset.dataType ?? "number",
  aggregation: preset.aggregation ?? "latest",
  goalEnabled: preset.goalEnabled ?? false,
  category: "gym",
  manualEntry: false,
  rankingDirection: preset.rankingDirection ?? "higher",
  defaultVisibility: "group",
});

function exerciseTrackerPresets(): TrackerPreset[] {
  return EXERCISE_CATALOG.filter((exercise) => exercise.key !== "custom").flatMap(
    (exercise) => {
      const grouping = `Workout · ${EXERCISE_CATEGORY_LABELS[exercise.category]}`;
      const common = { gymMuscleGroups: exercise.muscles, grouping };

      if (exercise.trackingMode === "duration") {
        return [
          gymPreset({
            ...common,
            templateId: `workout_${exercise.key}_duration`,
            name: exercise.name,
            unit: "min",
            aggregation: "sum",
            goal: { kind: "at_least", target: 30 },
            gymMapping: { kind: "exercise_duration", exerciseKey: exercise.key },
            healthMapping: exercise.health
              ? {
                  dataType: "workouts",
                  field: "duration_minutes",
                  activityKeys: [exercise.key],
                  workoutRecordKind:
                    exercise.health.healthConnectSessionTypes?.length ||
                    exercise.health.appleWorkoutTypes?.length
                      ? "session"
                      : exercise.health.healthConnectSegmentTypes?.length
                        ? "segment"
                        : "session",
                }
              : undefined,
            description: `Workout · ${EXERCISE_CATEGORY_LABELS[exercise.category]} duration from saved or compatible connected-health sessions.`,
          }),
        ];
      }

      if (exercise.trackingMode === "reps") {
        return [
          gymPreset({
            ...common,
            // Preserve the previous id so existing installs do not receive a
            // second copy when this preset becomes repetition-based.
            templateId: `gym_${exercise.key}_strength`,
            name: `${exercise.name} reps`,
            unit: "reps",
            aggregation: "sum",
            goal: { kind: "at_least", target: 1 },
            gymMapping: { kind: "exercise_reps", exerciseKey: exercise.key },
            healthMapping: exercise.health?.healthConnectSegmentTypes?.length
              ? {
                  dataType: "workouts",
                  field: "value",
                  activityKeys: [exercise.key],
                  workoutRecordKind: "segment",
                }
              : undefined,
            description:
              "Workout · completed repetitions; compatible native exercise segments sync when exposed.",
          }),
        ];
      }

      const presets = [
        gymPreset({
          ...common,
          templateId: `gym_${exercise.key}_strength`,
          name: `${exercise.name} strength`,
          unit: "kg e1RM",
          goal: { kind: "at_least", target: 1 },
          gymMapping: {
            kind: "exercise_one_rep_max",
            exerciseKey: exercise.key,
          },
          description:
            "Workout · estimated one-rep max from HabHub sets; connected health does not expose lifted weight.",
        }),
      ];
      if (exercise.health?.healthConnectSegmentTypes?.length) {
        presets.push(
          gymPreset({
            ...common,
            templateId: `workout_${exercise.key}_reps`,
            name: `${exercise.name} reps`,
            unit: "reps",
            aggregation: "sum",
            goal: { kind: "at_least", target: 1 },
            gymMapping: { kind: "exercise_reps", exerciseKey: exercise.key },
            healthMapping: {
              dataType: "workouts",
              field: "value",
              activityKeys: [exercise.key],
              workoutRecordKind: "segment",
            },
            description:
              "Workout · native repetition segments when exposed; lifted weight remains an in-app log.",
          }),
        );
      }
      return presets;
    },
  );
}

const GYM_TRACKER_PRESETS: TrackerPreset[] = [
  gymPreset({
    templateId: "gym_total_volume",
    name: "Workout volume",
    unit: "kg",
    goal: { kind: "at_least", target: 5000 },
    gymMapping: { kind: "session_volume" },
    description: "Workout · total completed reps × external load for the day.",
  }),
  gymPreset({
    templateId: "gym_completed_sets",
    name: "Completed workout sets",
    unit: "sets",
    goal: { kind: "at_least", target: 12 },
    gymMapping: { kind: "completed_sets" },
    description: "Workout · completed sets across all exercises for the day.",
  }),
  ...exerciseTrackerPresets(),
  ...(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((muscleGroup) =>
    gymPreset({
      templateId: `gym_${muscleGroup}_volume`,
      name: `${MUSCLE_LABELS[muscleGroup]} volume`,
      unit: "kg",
      goal: { kind: "at_least", target: 1000 },
      gymMapping: { kind: "muscle_volume", muscleGroup },
      gymMuscleGroups: [muscleGroup],
      description:
        "Workout · standardized completed-set volume for this muscle group.",
    }),
  ),
];

export const TRACKER_PRESET_DESCRIPTIONS: Readonly<Record<string, string>> = {
  sugar_alcohol: "Ready-made logging, goals, sharing and health mapping.",
  starch: "Ready-made logging, goals, sharing and health mapping.",
  trans_fat: "Ready-made logging, goals, sharing and health mapping.",
  monounsaturated_fat: "Ready-made logging, goals, sharing and health mapping.",
  polyunsaturated_fat: "Ready-made logging, goals, sharing and health mapping.",
  omega_3: "Ready-made logging, goals, sharing and health mapping.",
  omega_6: "Ready-made logging, goals, sharing and health mapping.",
  phosphorus: "Ready-made logging, goals, sharing and health mapping.",
  zinc: "Ready-made logging, goals, sharing and health mapping.",
  copper: "Ready-made logging, goals, sharing and health mapping.",
  manganese: "Ready-made logging, goals, sharing and health mapping.",
  selenium: "Ready-made logging, goals, sharing and health mapping.",
  iodine: "Ready-made logging, goals, sharing and health mapping.",
  chloride: "Ready-made logging, goals, sharing and health mapping.",
  chromium: "Ready-made logging, goals, sharing and health mapping.",
  molybdenum: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_a: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_e: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_k: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b1: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b2: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b3: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b5: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b6: "Ready-made logging, goals, sharing and health mapping.",
  vitamin_b9: "Ready-made logging, goals, sharing and health mapping.",
  folic_acid: "Ready-made logging, goals, sharing and health mapping.",
  biotin: "Ready-made logging, goals, sharing and health mapping.",
  alcohol: "Ready-made logging, goals, sharing and health mapping.",
  caffeine: "Ready-made logging, goals, sharing and health mapping.",
  steps: "Your total steps for each day. A phone can import them from connected health; web users can enter the day's total manually.",
  food: "Calories and nutrients from meals, snacks, food search, or barcode scans. It also powers your energy balance.",
  exercise: "Active energy burned through movement. HabHub combines compatible health data and saved workouts without counting the same activity twice.",
  energy_burned: "Total calories burned, including resting energy and activity. Connected-health totals are preferred; HabHub otherwise estimates the day from your energy profile and recorded activity.",
  deficit: "Calories burned minus calories eaten for the day. It is calculated after food is logged and adapts to your weight direction.",
  water: "Drinks recorded in 250 ml cups. Daily entries add together toward your hydration target.",
  workout: "Whether you completed a workout that day. Saved HabHub sessions and compatible connected-health workouts can update it.",
  weight: "Your body-weight trend and progress toward a target. It is a long-term directional tracker, not a daily goal to complete.",
  protein: "Protein eaten across all logged food, shown in grams. It supports muscle repair and can have a personal daily target.",
  fat: "Dietary fat across logged food, shown in grams. Use it for reference or set a personal intake target.",
  carbs: "Carbohydrates across logged food, shown in grams. Use it to understand daily energy intake or follow a personal target.",
  fiber: "Fiber across logged food, shown in grams. It helps you monitor a nutrient linked with digestion and fullness.",
  sodium: "Sodium across logged food, shown in milligrams. It is useful for observing intake or following a clinician-informed limit.",
  progress_photo: "Private progress photos tied to a date, with an optional caption and weight. Sharing remains under your control.",
  workout_duration: "Minutes spent working out. Saved HabHub sessions and compatible connected-health workouts contribute to one daily total.",
  body_fat: "Measured body-fat percentage from a scale, connected health source, or manual reading. It describes body composition over time.",
  lean_body_mass: "Your measured non-fat body mass in kilograms. Compatible scales can import it, or you can record a reading manually.",
  body_water_mass: "Body-water mass in kilograms from compatible connected scales. It is a measurement trend, not a hydration log.",
  bone_mass: "Estimated bone mass in kilograms from compatible connected scales. Treat it as a device-reported trend rather than a diagnosis.",
  blood_pressure_systolic: "A paired systolic and diastolic blood-pressure reading. HabHub keeps both numbers together and lets you personalize the preferred range.",
  blood_pressure_diastolic: "The lower number in a blood-pressure reading. It is stored with the systolic value rather than shown as a separate tracker.",
  pulse: "Heart rate in beats per minute. Connected readings can be summarized for the day, with a personal preferred range if useful.",
  workout_calories: "Active calories attributed specifically to workout sessions. Compatible connected-health sessions can provide this value.",
  workout_distance: "Distance covered during compatible workouts such as walking, running, or cycling, combined into a daily total.",
  sugar: "Total sugar across logged food, shown in grams. Use it for reference or set a personal daily limit.",
  saturated_fat: "Saturated fat across logged food, shown in grams. It can be observed or compared with a personal limit.",
  cholesterol: "Dietary cholesterol across logged food, shown in milligrams. It is available for reference or a personal target.",
  potassium: "Potassium across logged food, shown in milligrams. It helps you review this nutrient across meals and days.",
  calcium: "Calcium across logged food, shown in milligrams. It helps you review intake from meals and supplements you record.",
  iron: "Iron across logged food, shown in milligrams. Use it to observe intake against a target that suits your needs.",
  magnesium: "Magnesium across logged food, shown in milligrams. It summarizes the nutrient from all food entries that day.",
  vitamin_c: "Vitamin C across logged food, shown in milligrams. It summarizes the nutrient from all food entries that day.",
  vitamin_d: "Vitamin D across logged food, shown in micrograms. It summarizes food and supplements you choose to record.",
  vitamin_b12: "Vitamin B12 across logged food, shown in micrograms. It summarizes food and supplements you choose to record.",
  weekly_deficit_balance: "Your accumulated energy deficit or surplus across the current week. It is a weekly reference, not another daily task.",
  sleep: "How long you slept each night. A phone can import compatible sleep sessions, or you can log the duration manually.",
  blood_glucose: "Blood-glucose readings in millimoles per litre. HabHub records the trend without assigning a universal target.",
  menstrual_cycle: "A private cycle overview built from period-start history. It supports cycle-day and next-period estimates on this device.",
  menstrual_flow: "A private record of period flow for a particular day. It contributes to your cycle history without being a completion goal.",
  cycle_symptoms: "Private notes about symptoms on a cycle day. Use them to notice patterns across your own history.",
  cycle_day: "The estimated day within your current menstrual cycle, calculated from your recorded period starts.",
  days_until_period: "An estimate of days until the next period, based on your own recorded cycle history rather than a fixed universal cycle.",
  overall_score: "A combined summary of the tracked goals you chose. It changes with your personal goal set and available daily data.",
  todo_completion: "The share of scheduled to-dos resolved that day. To-dos remain separate from tracker entries and their own reminders.",
  intermittent_fasting: "A fasting timer with a configurable fasting and eating window. You can end it manually or optionally with the first food entry.",
  reading: "Minutes spent reading. Log time manually or use the activity timer to build a daily and long-term record.",
  study: "Minutes spent studying or practising. Log time manually or use the activity timer to follow consistency.",
  work: "Minutes spent in focused work. Log time manually or use the activity timer to understand your routine.",
  screen_time: "Time spent using apps and the screen. Android can estimate it with Usage Access; web and unsupported devices can log it manually.",
};

export function presetDescription(id: string) {
  const description = TRACKER_PRESET_DESCRIPTIONS[id];
  if (description) return description;
  if (id === 'steps') return 'Automatic daily steps from your connected health source.';
  if (id === 'food') return 'Meals, calories, macros, vitamins, minerals, search and barcode scan.';
  if (id === 'deficit') return 'Profile-aware energy result; unavailable until food is recorded.';
  if (id === 'exercise') return 'One activity-calorie total from health data, workouts and step estimates.';
  if (id === 'workout') return 'One workout tracker completed by saved gym sessions or compatible connected-health workouts.';
  if (id === 'workout_duration') return 'One duration total from saved gym sessions and compatible connected-health workouts.';
  if (id === 'pulse') return 'Daily average pulse; no target until you choose a personal range.';
  if (id.startsWith('blood_pressure')) return 'One combined systolic/diastolic reading with editable preferred ranges.';
  if (id === 'sleep') return 'Sleep duration with a ready-made 7–9 hour target range.';
  if (id === 'screen_time') return 'Private device screen use. Android can import app usage; iOS supports manual logs until Family Controls is provisioned.';
  if (id === 'intermittent_fasting') return 'A configurable fasting/eating window with manual or optional first-food completion.';
  return 'Ready-made logging, goals, sharing and health mapping.';
}
