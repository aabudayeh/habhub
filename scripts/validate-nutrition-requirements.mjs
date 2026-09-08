import assert from "node:assert/strict";

import { dailyNutrientReference } from "../src/domain/nutritionRequirements.ts";

const base = {
  age: 32,
  sex: "female",
  weightKg: 75,
};

assert.equal(dailyNutrientReference("protein", base, 2000)?.target, 60);
assert.equal(dailyNutrientReference("iron", base, 2000)?.target, 18);
assert.equal(
  dailyNutrientReference("iron", { ...base, sex: "male" }, 2000)?.target,
  8,
);
assert.deepEqual(
  dailyNutrientReference("iron", { ...base, sex: "unspecified" }, 2000),
  {
    kind: "target",
    min: 8,
    max: 18,
    basis: "age- and sex-based RDA",
  },
);
assert.deepEqual(dailyNutrientReference("fat", base, 1800), {
  kind: "range",
  min: 40,
  max: 70,
  basis: "20–35% of daily energy",
});
const youngerTeen = { ...base, age: 13, sex: "male", weightKg: 50 };
assert.equal(dailyNutrientReference("protein", youngerTeen, 2000)?.target, 47.5);
assert.deepEqual(dailyNutrientReference("fat", youngerTeen, 1800), {
  kind: "range",
  min: 50,
  max: 70,
  basis: "25–35% of daily energy",
});
assert.equal(dailyNutrientReference("iron", youngerTeen, 2000)?.target, 8);
assert.equal(dailyNutrientReference("magnesium", youngerTeen, 2000)?.target, 240);
assert.equal(dailyNutrientReference("vitamin_b9", youngerTeen, 2000)?.target, 300);
assert.equal(dailyNutrientReference("sodium", youngerTeen, 2000)?.max, 1800);
assert.equal(dailyNutrientReference("sodium", base, 2000)?.max, 2300);
assert.equal(dailyNutrientReference("trans_fat", base, 2000)?.kind, "minimize");
assert.equal(dailyNutrientReference("sugar", base, 2000), undefined);

console.log("Nutrition daily-reference checks passed.");
