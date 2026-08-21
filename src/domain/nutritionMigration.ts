import type { AppState } from "@/src/types";

export const NUTRITION_V26_METRIC_IDS = [
  "sugar_alcohol",
  "alcohol",
  "trans_fat",
  "monounsaturated_fat",
  "polyunsaturated_fat",
  "omega_3",
  "omega_6",
  "starch",
  "phosphorus",
  "zinc",
  "copper",
  "manganese",
  "selenium",
  "iodine",
  "vitamin_a",
  "vitamin_e",
  "vitamin_k",
  "vitamin_b1",
  "vitamin_b2",
  "vitamin_b3",
  "vitamin_b5",
  "vitamin_b6",
  "vitamin_b9",
  "folic_acid",
  "caffeine",
  "biotin",
  "chloride",
  "chromium",
  "molybdenum",
] as const;

/**
 * Adds the v26 nutrient presets once without replacing any customized metric,
 * submetric, order, visibility, goal, or setting.
 */
export function upgradeNutritionStateV26(
  state: AppState,
  defaults: AppState,
  sourceVersion = Number(state.version ?? 1),
): AppState {
  if (sourceVersion >= 26) return state;
  const presetFood = defaults.metrics.find((metric) => metric.id === "food");
  const metrics = state.metrics.map((metric) => {
    if (metric.id !== "food" || !presetFood?.submetrics?.length) return metric;
    const existingIds = new Set((metric.submetrics ?? []).map((item) => item.id));
    const missing = presetFood.submetrics.filter(
      (item) =>
        NUTRITION_V26_METRIC_IDS.includes(
          item.id as (typeof NUTRITION_V26_METRIC_IDS)[number],
        ) && !existingIds.has(item.id),
    );
    return missing.length
      ? { ...metric, submetrics: [...(metric.submetrics ?? []), ...missing] }
      : metric;
  });
  const existingIds = new Set(metrics.map((metric) => metric.id));
  const activeFrom = new Date().toISOString().slice(0, 10);
  const nextOrder = Math.max(-1, ...metrics.map((metric) => metric.order)) + 1;
  const missingMetrics = defaults.metrics
    .filter(
      (metric) =>
        NUTRITION_V26_METRIC_IDS.includes(
          metric.id as (typeof NUTRITION_V26_METRIC_IDS)[number],
        ) && !existingIds.has(metric.id),
    )
    .map((metric, index) => ({
      ...metric,
      activeFrom,
      order: nextOrder + index,
    }));
  return {
    ...state,
    // v26 is the nutrient data migration; v27 is the current append-only
    // privacy-capability boundary and performs no additional data mutation.
    version: 27,
    metrics: [...metrics, ...missingMetrics],
  };
}
