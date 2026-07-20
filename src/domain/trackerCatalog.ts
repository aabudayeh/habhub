import { DEFAULT_METRICS } from '@/src/data/seed';
import { recommendedDailyDeficit, recommendedDailyIntakeForDirection } from '@/src/domain/energy';
import { AppState, NewMetric } from '@/src/types';

export type TrackerPreset = NewMetric & { templateId: string; description: string };

export function trackerPresets(state: AppState): TrackerPreset[] {
  const profile = state.settings.energyProfile;
  const direction = state.settings.weightDirection ?? 'lose';
  const adjustment = recommendedDailyDeficit(profile);
  return DEFAULT_METRICS
    .filter((item) => item.id !== 'workout_calories')
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
      if (['pulse', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose'].includes(item.id)) {
        preset.goalEnabled = false;
        preset.goalRange = undefined;
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
  if (id.startsWith('blood_pressure')) return 'Daily average blood-pressure reading; observational by default.';
  if (id === 'sleep') return 'Sleep duration with a ready-made 7–9 hour target range.';
  return 'Ready-made logging, goals, sharing and health mapping.';
}
