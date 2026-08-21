import { dateWithOffsetFrom } from "./date";

import type { UserSettings, WeightDirection } from "@/src/types";

export type WeightPlanEstimate = {
  direction: WeightDirection;
  currentWeightKg: number;
  targetWeightKg: number;
  weeklyChangeKg: number;
  remainingKg: number;
  expectedGoalDate?: string;
  reached: boolean;
};

type WeightPlanInput = {
  anchorDate: string;
  currentWeightKg: number;
  direction: WeightDirection;
  targetWeightKg: number;
  weeklyChangeKg: number;
};

/**
 * Weight management is an explicit personal preference. The selected-goal
 * fallback keeps accounts created before this setting was introduced working.
 */
export function weightManagementEnabled(
  settings: Pick<UserSettings, "selectedGoals" | "weightManagementEnabled">,
) {
  return (
    settings.weightManagementEnabled ?? settings.selectedGoals.includes("weight")
  );
}

export function weightManagementSummaryVisible(
  settings: Pick<
    UserSettings,
    | "selectedGoals"
    | "showWeightManagementSummary"
    | "weightManagementEnabled"
  >,
) {
  return (
    weightManagementEnabled(settings) &&
    settings.showWeightManagementSummary !== false
  );
}

/**
 * A deterministic planning estimate based only on the user's chosen pace.
 * It is intentionally separate from observed-trend analytics so onboarding,
 * Today, and Status always describe the same plan.
 */
export function estimateWeightPlan({
  anchorDate,
  currentWeightKg,
  direction,
  targetWeightKg,
  weeklyChangeKg,
}: WeightPlanInput): WeightPlanEstimate | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ||
    !Number.isFinite(currentWeightKg) ||
    !Number.isFinite(targetWeightKg) ||
    currentWeightKg <= 0 ||
    targetWeightKg <= 0
  )
    return undefined;

  if (direction === "maintain") {
    return {
      direction,
      currentWeightKg,
      targetWeightKg,
      weeklyChangeKg: 0,
      remainingKg: Math.abs(currentWeightKg - targetWeightKg),
      reached: Math.abs(currentWeightKg - targetWeightKg) <= 0.2,
    };
  }

  const directionIsValid =
    direction === "lose"
      ? targetWeightKg < currentWeightKg
      : targetWeightKg > currentWeightKg;
  if (!directionIsValid || !Number.isFinite(weeklyChangeKg) || weeklyChangeKg <= 0)
    return undefined;

  const remainingKg = Math.abs(targetWeightKg - currentWeightKg);
  const reached = remainingKg <= 0.05;
  const days = reached
    ? 0
    : Math.max(1, Math.ceil((remainingKg / weeklyChangeKg) * 7));
  return {
    direction,
    currentWeightKg,
    targetWeightKg,
    weeklyChangeKg,
    remainingKg,
    expectedGoalDate: dateWithOffsetFrom(anchorDate, days),
    reached,
  };
}
