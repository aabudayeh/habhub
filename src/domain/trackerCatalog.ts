import { DEFAULT_METRICS } from '@/src/data/seed';
import { recommendedDailyDeficit, recommendedDailyIntakeForDirection } from '@/src/domain/energy';
import { AppState, NewMetric } from '@/src/types';
import { defaultReminderTimes } from '@/src/domain/reminders';

export type TrackerPreset = NewMetric & { templateId: string; description: string };

export function isInternalTracker(metric: { id: string; healthMapping?: NewMetric["healthMapping"] }) {
  return (
    metric.id === "blood_pressure_diastolic" ||
    (metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "diastolic")
  );
}

export function trackerPresets(state: AppState, includeInternal = false): TrackerPreset[] {
  const profile = state.settings.energyProfile;
  const direction = state.settings.weightDirection ?? 'lose';
  const adjustment = recommendedDailyDeficit(profile);
  return DEFAULT_METRICS
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
        category: item.category,
        healthMapping: item.healthMapping ? { ...item.healthMapping } : undefined,
        stepFallback: item.stepFallback,
        manualEntry: item.manualEntry,
        rankingDirection: item.rankingDirection,
        defaultVisibility: item.defaultVisibility,
        formula: item.formula,
        reminders: (item.reminders?.length
          ? item.reminders
          : defaultReminderTimes(item).map((time) => ({ enabled: false, time }))),
        description: presetDescription(item.id),
      };
      if (item.id === 'food') preset.goal.target = recommendedDailyIntakeForDirection(profile, direction);
      if (item.id === 'weight') preset.goal.target = profile.targetWeightKg;
      if (item.id === 'deficit') {
        preset.name = direction === 'gain' ? 'Daily surplus' : direction === 'maintain' ? 'Energy balance' : 'Daily deficit';
        preset.goal = direction === 'maintain' ? { kind: 'exact', target: 0 } : { kind: 'at_least', target: adjustment };
        preset.goalRange = direction === 'maintain' ? { min: -150, max: 150 } : undefined;
        preset.formula = direction === 'lose' ? 'bmr + daily_activity + exercise - food' : 'food - bmr - daily_activity - exercise';
      }
      if (['pulse', 'blood_glucose'].includes(item.id)) {
        preset.goalEnabled = false;
        preset.goalRange = undefined;
      }
      if (item.id === 'blood_pressure_systolic') {
        preset.name = 'Blood pressure';
        preset.goalEnabled = true;
        preset.goal = { kind: 'exact', target: 120 };
        preset.goalRange = { min: 90, max: 120 };
      }
      return preset;
    });
}

function presetDescription(id: string) {
  if (id === 'steps') return 'Automatic daily steps from your connected health source.';
  if (id === 'food') return 'Meals, calories, macros, vitamins, minerals, search and barcode scan.';
  if (id === 'deficit') return 'Profile-aware energy result; unavailable until food is recorded.';
  if (id === 'exercise') return 'One activity-calorie total from health data, workouts and step estimates.';
  if (id === 'workout') return 'Workout sessions with type, duration, distance and calories.';
  if (id === 'pulse') return 'Daily average pulse; no target until you choose a personal range.';
  if (id.startsWith('blood_pressure')) return 'One combined systolic/diastolic reading with editable preferred ranges.';
  if (id === 'sleep') return 'Sleep duration with a ready-made 7–9 hour target range.';
  return 'Ready-made logging, goals, sharing and health mapping.';
}
