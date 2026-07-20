import { ActivityLevel, EnergyProfile, FoodGoalMode, WeightDirection } from '@/src/types';

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

/** Mifflin-St Jeor. The result is an estimate, not a medical measurement. */
export function calculateBmr(profile: EnergyProfile): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  if (profile.sex === 'male') return Math.max(0, base + 5);
  if (profile.sex === 'female') return Math.max(0, base - 161);
  return Math.max(0, base - 78);
}

export function calculateDailyActivity(profile: EnergyProfile): number {
  const bmr = calculateBmr(profile);
  return bmr * (ACTIVITY_FACTORS[profile.activityLevel] - 1);
}

export function calculateDailyEnergy(profile: EnergyProfile): number {
  return calculateBmr(profile) + calculateDailyActivity(profile);
}

export const KCAL_PER_KG_ESTIMATE = 7700;

export function recommendedDailyDeficit(profile: EnergyProfile): number {
  const requested = Math.max(0, profile.desiredWeeklyLossKg) * KCAL_PER_KG_ESTIMATE / 7;
  // A conservative product guardrail: never recommend more than ~1% body weight/week.
  const weightBasedCeiling = Math.max(0, profile.weightKg * 0.01) * KCAL_PER_KG_ESTIMATE / 7;
  return Math.round(Math.min(requested, weightBasedCeiling, 1100));
}

export function recommendedDailyIntake(profile: EnergyProfile): number {
  return Math.max(profile.sex === 'male' ? 1500 : 1200, Math.round(calculateDailyEnergy(profile) - recommendedDailyDeficit(profile)));
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
