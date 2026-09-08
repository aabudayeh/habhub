import assert from "node:assert/strict";
import { demoNutritionEntries, DEMO_LINKED_NUTRIENTS } from "../src/domain/demoNutrition.ts";
import { foodNutrientDetailEntries } from "../src/domain/food.ts";

for (const calories of [1550, 1720, 1840, 2130, 2600]) {
  const parent = { id: "demo-food", metricId: "food", userId: "demo", value: calories,
    localDate: "2026-09-08", recordedAt: "2026-09-08T18:00:00.000Z", visibility: "group", source: "manual" };
  const entries = demoNutritionEntries(parent);
  const meals = entries.filter((entry) => entry.metricId === "food");
  assert.equal(meals.length, 3);
  assert.equal(meals.reduce((sum, meal) => sum + meal.value, 0), calories);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const meal of meals) {
    const nutrition = meal.nutrition;
    const approximateCalories = nutrition.proteinG * 4 + nutrition.carbsG * 4 + nutrition.fatG * 9;
    assert.ok(Math.abs(approximateCalories - meal.value) < 2, "macros should agree with meal energy within rounding");
    assert.ok(nutrition.fiberG <= nutrition.carbsG && nutrition.sugarG <= nutrition.carbsG);
    assert.ok(nutrition.saturatedFatG <= nutrition.fatG);
  }
  for (const [metricId, field] of DEMO_LINKED_NUTRIENTS) {
    const details = foodNutrientDetailEntries(entries, "demo", metricId).filter((entry) => entry.metricId === metricId);
    assert.equal(details.length, 3, "linked nutrient sidecars must not duplicate intake");
    assert.equal(details.reduce((sum, entry) => sum + entry.value, 0), meals.reduce((sum, meal) => sum + meal.nutrition[field], 0));
  }
  if (calories === 1720) assert.equal(meals[0].value, 520);
}
console.log("Demo nutrition: calorie totals, realistic meal portions, macro consistency and nonduplicating nutrient details passed.");
