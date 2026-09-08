import type { MetricEntry, NutritionDetails } from "../types";

/** Illustrative meal fixtures, not food-database records or dietary advice. */
const MEALS = [
  { mealType: "breakfast", clock: "07:30", label: "Berry oat breakfast", note: "Oats, yoghurt, berries, banana, and chia seeds", calories: 520,
    nutrition: { proteinG: 27, carbsG: 67, fatG: 16, fiberG: 11, sodiumMg: 120, sugarG: 22, saturatedFatG: 3, potassiumMg: 620, calciumMg: 340, ironMg: 4.2, magnesiumMg: 135, vitaminCMg: 32, vitaminDMcg: 2, vitaminB12Mcg: 1.1 } },
  { mealType: "lunch", clock: "12:30", label: "Chicken and quinoa bowl", note: "Chicken, quinoa, chickpeas, spinach, peppers, and olive oil", calories: 640,
    nutrition: { proteinG: 43, carbsG: 72, fatG: 20, fiberG: 9, sodiumMg: 620, sugarG: 9, saturatedFatG: 3.5, potassiumMg: 950, calciumMg: 160, ironMg: 5.5, magnesiumMg: 150, vitaminCMg: 68, vitaminDMcg: 0.5, vitaminB12Mcg: 0.6 } },
  { mealType: "dinner", clock: "18:30", label: "Salmon and roasted vegetables", note: "Salmon, potatoes, broccoli, carrots, and yoghurt dressing", calories: 560,
    nutrition: { proteinG: 38, carbsG: 48, fatG: 24, fiberG: 9, sodiumMg: 610, sugarG: 11, saturatedFatG: 4.5, potassiumMg: 1020, calciumMg: 200, ironMg: 3.1, magnesiumMg: 125, vitaminCMg: 74, vitaminDMcg: 13, vitaminB12Mcg: 4.2 } },
] as const;

export const DEMO_LINKED_NUTRIENTS = [
  ["protein", "proteinG"], ["carbs", "carbsG"], ["fat", "fatG"],
  ["fiber", "fiberG"], ["sodium", "sodiumMg"],
] as const;

/** Keep existing daily calorie totals while giving each meal real detail. */
export function demoNutritionEntries(parent: MetricEntry): MetricEntry[] {
  const total = Math.max(0, Math.round(Number(parent.value)));
  if (!Number.isFinite(total) || total === 0) return [parent];
  const scale = total / 1720;
  let remaining = total;
  return MEALS.flatMap((fixture, index) => {
    const calories = index === MEALS.length - 1
      ? remaining : Math.round(fixture.calories * scale);
    remaining -= calories;
    const nutrition: NutritionDetails = {
      ...Object.fromEntries(Object.entries(fixture.nutrition).map(([key, value]) =>
        [key, Math.round(value * scale * 10) / 10],
      )),
      mealType: fixture.mealType,
    };
    const meal: MetricEntry = {
      ...parent,
      id: index === 0 ? parent.id : `${parent.id}:${fixture.mealType}`,
      value: calories,
      recordedAt: new Date(`${parent.localDate}T${fixture.clock}:00`).toISOString(),
      label: fixture.label,
      note: fixture.note,
      nutrition,
    };
    return [meal, ...DEMO_LINKED_NUTRIENTS.map(([metricId, field]) => ({
      ...meal,
      id: `${meal.id}:nutrient:${metricId}`,
      metricId,
      value: nutrition[field]!,
      nutrition: undefined,
    }))];
  });
}
