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
        preset.formula = direction === 'lose' ? 'bmr + daily_activity + exercise - food' : 'food - bmr - daily_activity - exercise';
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
    templateId: "gym_completed",
    name: "Workout completed",
    unit: "",
    dataType: "boolean",
    goal: { kind: "complete", target: 1 },
    goalEnabled: true,
    gymMapping: { kind: "session_completed" },
    description: "Workout · completed at least one set in this session.",
  }),
  gymPreset({
    templateId: "gym_duration",
    name: "Workout duration",
    unit: "min",
    aggregation: "sum",
    goal: { kind: "at_least", target: 45 },
    gymMapping: { kind: "session_duration" },
    description: "Workout · total saved session duration for the day.",
  }),
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

function presetDescription(id: string) {
  if (id === 'steps') return 'Automatic daily steps from your connected health source.';
  if (id === 'food') return 'Meals, calories, macros, vitamins, minerals, search and barcode scan.';
  if (id === 'deficit') return 'Profile-aware energy result; unavailable until food is recorded.';
  if (id === 'exercise') return 'One activity-calorie total from health data, workouts and step estimates.';
  if (id === 'workout') return 'Workout sessions with type, duration, distance and calories.';
  if (id === 'pulse') return 'Daily average pulse; no target until you choose a personal range.';
  if (id.startsWith('blood_pressure')) return 'One combined systolic/diastolic reading with editable preferred ranges.';
  if (id === 'sleep') return 'Sleep duration with a ready-made 7–9 hour target range.';
  if (id === 'screen_time') return 'Private Android screen and app usage from system Usage Access.';
  if (id === 'intermittent_fasting') return 'A configurable fasting/eating window with manual or optional first-food completion.';
  return 'Ready-made logging, goals, sharing and health mapping.';
}
