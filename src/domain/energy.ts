import type {
  ActivityLevel,
  EnergyProfile,
  FoodGoalMode,
  WeightDirection,
} from '@/src/types';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly seated',
  light: 'Lightly active',
  moderate: 'Moderately active',
  very_active: 'Very active',
  athlete: 'Athlete / physical job',
};

function bounded(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

/** Keeps persisted/cloud energy data inside the database and formula ranges. */
export function normalizeEnergyProfile(profile: EnergyProfile): EnergyProfile {
  const weightKg = bounded(profile.weightKg, 70, 20, 500);
  const activityOverride = profile.dailyActivityCaloriesOverride;
  const bodyFatPercent = profile.bodyFatPercent;
  const leanBodyMassKg = profile.leanBodyMassKg;
  return {
    ...profile,
    age: Math.round(bounded(profile.age, 30, 13, 120)),
    heightCm: bounded(profile.heightCm, 170, 80, 260),
    weightKg,
    bodyFatPercent:
      bodyFatPercent === undefined
        ? undefined
        : bounded(bodyFatPercent, 20, 1, 75),
    leanBodyMassKg:
      leanBodyMassKg === undefined
        ? undefined
        : bounded(leanBodyMassKg, Math.min(55, weightKg), 10, weightKg),
    startingWeightKg:
      profile.startingWeightKg === undefined
        ? undefined
        : bounded(profile.startingWeightKg, weightKg, 20, 500),
    targetWeightKg: bounded(profile.targetWeightKg, weightKg, 20, 500),
    dailyActivityCaloriesOverride:
      activityOverride === undefined
        ? undefined
        : Math.round(bounded(activityOverride, 0, 0, 5000)),
    desiredWeeklyLossKg: bounded(profile.desiredWeeklyLossKg, 0.5, 0, 2),
  };
}

/**
 * Exact energy subset stored in the global relational profile projection.
 * Private body-composition inputs remain in the revisioned account snapshot.
 */
export function cloudAccountEnergyProjection(profile: EnergyProfile) {
  const normalized = normalizeEnergyProfile(profile);
  return {
    age: normalized.age,
    biological_sex: normalized.sex,
    height_cm: normalized.heightCm,
    weight_kg: normalized.weightKg,
    target_weight_kg: normalized.targetWeightKg,
    activity_level: normalized.activityLevel,
    desired_weekly_loss_kg: normalized.desiredWeeklyLossKg,
  };
}

/** Mifflin-St Jeor. The result is an estimate, not a medical measurement. */
export function calculateBmr(profile: EnergyProfile): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  if (profile.sex === 'male') return Math.max(0, base + 5);
  if (profile.sex === 'female') return Math.max(0, base - 161);
  return Math.max(0, base - 78);
}

export function calculateActivityFromLevel(profile: EnergyProfile): number {
  const bmr = calculateBmr(profile);
  return bmr * (ACTIVITY_FACTORS[profile.activityLevel] - 1);
}

export function calculateDailyActivity(profile: EnergyProfile): number {
  const override = profile.dailyActivityCaloriesOverride;
  return override !== undefined && Number.isFinite(override)
    ? Math.max(0, override)
    : calculateActivityFromLevel(profile);
}

export function calculateDailyEnergy(profile: EnergyProfile): number {
  return calculateBmr(profile) + calculateDailyActivity(profile);
}

/**
 * Full-day burn used by the planned Daily deficit/surplus calculation.
 *
 * Food allowance starts from the profile's full-day energy estimate and can
 * add today's active energy. Use the same baseline here so a cold start does
 * not temporarily compare that allowance with only the BMR accrued so far.
 * A larger connected-health total still wins when the provider has observed
 * more energy than the profile projection.
 */
export function projectedDailyEnergyBurned(
  profile: EnergyProfile,
  fallbackBaseline: number,
  activeEnergy: number,
  observedEnergyBurned: number,
): number {
  const plannedBaseline = energyFormulaVariables(
    profile,
    fallbackBaseline,
  ).daily_energy;
  const active = Number.isFinite(activeEnergy) ? Math.max(0, activeEnergy) : 0;
  const observed = Number.isFinite(observedEnergyBurned)
    ? Math.max(0, observedEnergyBurned)
    : 0;
  return Math.max(observed, plannedBaseline + active);
}

export const KCAL_PER_KG_ESTIMATE = 7700;

export function recommendedDailyDeficit(profile: EnergyProfile): number {
  // Preserve the user's exact preset or custom weekly rate. Safety guidance is
  // presented separately; silently capping this value made different custom
  // rates produce identical deficit/surplus and food targets.
  return Math.round(
    (Math.max(0, profile.desiredWeeklyLossKg) * KCAL_PER_KG_ESTIMATE) / 7,
  );
}

export function recommendedDailyIntake(profile: EnergyProfile): number {
  return Math.max(0, Math.round(calculateDailyEnergy(profile) - recommendedDailyDeficit(profile)));
}

export function recommendedDailyIntakeForDirection(profile:EnergyProfile,direction:WeightDirection){
  const adjustment=recommendedDailyDeficit(profile);
  if(direction==='gain')return Math.round(calculateDailyEnergy(profile)+adjustment);
  if(direction==='maintain')return Math.round(calculateDailyEnergy(profile));
  return recommendedDailyIntake(profile);
}

export function dailyFoodGoal(baseTarget: number, activeEnergy: number, mode: FoodGoalMode): number {
  return Math.max(0, Math.round(baseTarget + (mode === 'activity_adjusted' ? Math.max(0, activeEnergy) : 0)));
}

export function energyFormulaVariables(profile: EnergyProfile, fallbackBaseline: number) {
  const valid = profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0;
  if (!valid) {
    return { bmr: fallbackBaseline, daily_activity: 0, baseline: fallbackBaseline, daily_energy: fallbackBaseline };
  }
  const bmr = calculateBmr(profile);
  const dailyActivity = calculateDailyActivity(profile);
  return {
    bmr,
    daily_activity: dailyActivity,
    baseline: bmr + dailyActivity,
    daily_energy: bmr + dailyActivity,
  };
}
