import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  capturedFoodNutrients,
  editFoodEntryClockTime,
  FOOD_MACROS,
  FOOD_NUTRIENTS,
  foodNutrientDetailEntries,
  foodNutritionReport,
  hasFoodNutrientTracker,
  isFoodNutrientDetailEntry,
  isFoodNutrientTrackerId,
  nextFoodNutrientTrackerOrder,
  parsePositiveFoodNutrientAmount,
  preserveFoodEntryClockOverride,
} from "../src/domain/food.ts";
import { reconcileAutomaticFasting } from "../src/domain/fasting.ts";
import { mapHealthRecordsToEntries } from "../src/domain/health.ts";
import { upgradeNutritionStateV26 } from "../src/domain/nutritionMigration.ts";
import {
  usdaCalories,
  usdaTotalSugarsG,
} from "../src/domain/usdaNutrition.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");

const importedMeal = {
  id: "health:meal-1:food",
  metricId: "food",
  userId: "user-a",
  value: 620,
  localDate: "2026-01-12",
  recordedAt: new Date(2026, 0, 12, 12, 30).toISOString(),
  visibility: "group",
  source: "imported",
  label: "Rice bowl",
  note: "Synced from Samsung Health",
  nutrition: { proteinG: 35, carbsG: 72, fatG: 18 },
  sourceProvider: "health_connect",
  sourceRecordId: "meal-1",
  sourceOrigin: "Samsung Health",
  sourceUpdatedAt: "2026-01-12T13:00:00.000Z",
};

const staleLinkedProtein = {
  ...importedMeal,
  id: "health:meal-1:protein",
  metricId: "protein",
  value: 17,
  label: undefined,
  note: undefined,
  nutrition: undefined,
};
const standaloneAppleProtein = {
  ...staleLinkedProtein,
  id: "healthkit:dietary-protein:standalone",
  value: 9,
  sourceProvider: "healthkit",
  sourceRecordId: "dietary-protein:standalone",
  sourceOrigin: "Apple Health",
};
const nutrientDetailEntries = foodNutrientDetailEntries(
  [
    importedMeal,
    staleLinkedProtein,
    standaloneAppleProtein,
    { ...staleLinkedProtein, userId: "user-b", value: 99 },
  ],
  "user-a",
  "protein",
);
const linkedProteinView = nutrientDetailEntries.find(
  (entry) => isFoodNutrientDetailEntry(entry),
);
assert.ok(linkedProteinView, "Food nutrition must project into a nutrient detail view");
assert.equal(linkedProteinView.value, 35, "the canonical Food payload replaces a stale sidecar");
assert.equal(linkedProteinView.label, "Rice bowl", "the nutrient entry identifies its meal");
assert.equal(linkedProteinView.source, "calculated", "a view projection must be read-only");
assert.equal(linkedProteinView.visibility, importedMeal.visibility);
assert.equal(linkedProteinView.note, undefined, "a projection must not copy a private meal note");
assert.equal(linkedProteinView.nutrition, undefined, "a projection must not carry the full meal payload");
assert.ok(
  !nutrientDetailEntries.some(
    (entry) => entry.id === staleLinkedProtein.id && entry.userId === "user-a",
  ),
  "a linked persisted sidecar must not double count its Food parent",
);
assert.ok(
  nutrientDetailEntries.some((entry) => entry.id === standaloneAppleProtein.id),
  "a standalone provider nutrient record must remain visible",
);
assert.ok(
  nutrientDetailEntries.some(
    (entry) => entry.id === staleLinkedProtein.id && entry.userId === "user-b",
  ),
  "projecting one account must not remove another account's same-id row",
);
assert.equal(staleLinkedProtein.value, 17, "the read-only projection must not mutate persisted rows");
const zeroNutrientDetailEntries = foodNutrientDetailEntries(
  [
    { ...importedMeal, nutrition: { ...importedMeal.nutrition, proteinG: 0 } },
    staleLinkedProtein,
  ],
  "user-a",
  "protein",
);
assert.ok(
  !zeroNutrientDetailEntries.some(
    (entry) => entry.userId === "user-a" && entry.metricId === "protein",
  ),
  "a canonical zero or removed nutrient must clear its stale linked sidecar",
);
const fiberDetailEntries = foodNutrientDetailEntries(
  [{ ...importedMeal, nutrition: { ...importedMeal.nutrition, fiberG: 8 } }],
  "user-a",
  "fiber",
);
assert.equal(
  fiberDetailEntries.find((entry) => isFoodNutrientDetailEntry(entry))?.value,
  8,
  "a nutrient detail works even when no persisted tracker or sidecar exists",
);

const edited = editFoodEntryClockTime(
  importedMeal,
  "user-a",
  "07:15",
  "2026-01-13T09:00:00.000Z",
);
assert.ok(edited, "an owned imported food row must allow a clock-time edit");
assert.equal(new Date(edited.recordedAt).getHours(), 7);
assert.equal(new Date(edited.recordedAt).getMinutes(), 15);
assert.equal(edited.localDate, importedMeal.localDate);
assert.equal(edited.recordedAtOverride, edited.recordedAt);
for (const field of [
  "id",
  "metricId",
  "userId",
  "value",
  "visibility",
  "source",
  "label",
  "note",
  "nutrition",
  "sourceProvider",
  "sourceRecordId",
  "sourceOrigin",
])
  assert.deepEqual(
    edited[field],
    importedMeal[field],
    `${field} must survive a time-only edit`,
  );
assert.ok(edited.sourceUpdatedAt > importedMeal.sourceUpdatedAt);
assert.equal(
  editFoodEntryClockTime(importedMeal, "user-b", "07:15", new Date().toISOString()),
  undefined,
  "a different account must not edit the row",
);
assert.equal(
  editFoodEntryClockTime(importedMeal, "user-a", "29:80", new Date().toISOString()),
  undefined,
  "invalid clock values must be rejected",
);
assert.equal(
  editFoodEntryClockTime(
    { ...importedMeal, metricId: "protein" },
    "user-a",
    "07:15",
    new Date().toISOString(),
  ),
  undefined,
  "the time-only path is food-specific",
);

const refreshed = preserveFoodEntryClockOverride(edited, {
  ...importedMeal,
  value: 640,
  nutrition: { proteinG: 42, carbsG: 70, fatG: 19 },
  sourceUpdatedAt: "2026-01-14T09:00:00.000Z",
});
assert.equal(refreshed.recordedAt, edited.recordedAt);
assert.equal(refreshed.recordedAtOverride, edited.recordedAtOverride);
assert.equal(refreshed.value, 640, "source nutrition updates must still be accepted");
assert.equal(refreshed.nutrition.proteinG, 42);

const fastingMetric = {
  id: "intermittent_fasting",
  defaultVisibility: "private",
  fastingSettings: {
    automaticFoodBreak: true,
    startTime: "20:00",
    fastingMinutes: 16 * 60,
  },
};
const oldMealTime = new Date(2026, 0, 12, 12, 30).toISOString();
const fastStart = new Date(2026, 0, 11, 20, 0).toISOString();
const fastingState = {
  currentUserId: "user-a",
  metrics: [fastingMetric],
  entries: [edited],
  settings: {
    fastingRuntimeByMetric: {
      [fastingMetric.id]: {
        startedAt: fastStart,
        startedManually: true,
        endedAt: oldMealTime,
        endedBy: "food",
        endedByFoodEntryId: edited.id,
      },
    },
  },
};
const fastingReconciled = reconcileAutomaticFasting(fastingState, [edited]);
assert.equal(
  fastingReconciled.settings.fastingRuntimeByMetric?.[fastingMetric.id]?.endedAt,
  edited.recordedAt,
  "a time edit must rebuild a food-ended fasting boundary",
);

const entries = [
  {
    ...importedMeal,
    id: "meal-a",
    localDate: "2026-01-01",
    nutrition: {
      proteinG: 25,
      carbsG: 50,
      fatG: 10,
      fiberG: 8,
      sodiumMg: 640,
      vitaminCMg: 12,
      sugarAlcoholG: 6,
      monounsaturatedFatG: 5,
      phosphorusMg: 300,
      vitaminAMcg: 450,
      caffeineMg: 80,
    },
  },
  {
    ...importedMeal,
    id: "meal-b",
    localDate: "2026-01-02",
    nutrition: {
      proteinG: 75,
      carbsG: 100,
      fatG: 20,
      fiberG: 12,
      sodiumMg: 860,
      vitaminB12Mcg: 2.4,
      alcoholG: 14,
      transFatG: 0.2,
      seleniumMcg: 55,
      folateMcg: 200,
    },
  },
  {
    ...importedMeal,
    id: "other-user",
    userId: "user-b",
    localDate: "2026-01-02",
    nutrition: { proteinG: 999, carbsG: 999, fatG: 999 },
  },
  {
    ...importedMeal,
    id: "apple-vitamin-k",
    metricId: "vitamin_k",
    value: 90,
    localDate: "2026-01-02",
    sourceProvider: "apple_health",
    sourceRecordId: "dietary-vitamin-k:2026-01-02",
    nutrition: { vitaminKMcg: 90 },
  },
  {
    ...importedMeal,
    id: "health-companion-protein",
    metricId: "protein",
    value: 25,
    localDate: "2026-01-01",
    sourceProvider: "health_connect",
    sourceRecordId: "meal-1",
    nutrition: { proteinG: 25 },
  },
];
const report = foodNutritionReport({
  entries,
  userId: "user-a",
  range: "week",
  dates: ["2026-01-01", "2026-01-02", "2026-01-03"],
  anchorDate: "2026-01-03",
  goals: {
    protein: 120,
    carbs: 220,
    fat: 65,
    fiber: 30,
    sodium: 2300,
    vitamin_b12: 2.4,
  },
  locale: "en",
});
assert.equal(report.hasData, true);
assert.equal(report.bucketUnit, "day");
assert.equal(report.buckets.length, 3);
assert.equal(report.buckets[0].values.protein, 25);
assert.equal(report.buckets[2].values.protein, null);
assert.equal(report.macroSlices.find((slice) => slice.id === "protein")?.value, 100);
assert.equal(report.macroSlices.find((slice) => slice.id === "carbs")?.value, 150);
assert.equal(report.macroSlices.find((slice) => slice.id === "fat")?.value, 30);
assert.equal(
  Math.round(report.macroSlices.reduce((sum, slice) => sum + slice.percent, 0)),
  100,
  "the always-three-slice pie must represent macro-calorie share",
);
assert.deepEqual(
  report.macroSlices.map((slice) => slice.id),
  ["protein", "carbs", "fat"],
  "the pie is independent of the nutrient filter",
);
for (const id of [
  "protein",
  "fiber",
  "sodium",
  "vitamin_c",
  "vitamin_b12",
  "sugar_alcohol",
  "alcohol",
  "trans_fat",
  "monounsaturated_fat",
  "phosphorus",
  "selenium",
  "vitamin_a",
  "vitamin_k",
  "vitamin_b9",
  "caffeine",
])
  assert.ok(report.availableIds.includes(id), `${id} must appear when logged`);
assert.equal(
  report.availableIds.includes("omega_6"),
  false,
  "a supported but absent nutrient must stay out of the range filter",
);
assert.equal(report.recordedDayCount, 2);
assert.equal(report.averageValues.protein, 50);
assert.equal(report.averageValues.fiber, 10);
assert.equal(
  report.averageValues.vitamin_c,
  12,
  "missing optional nutrient data must remain unknown instead of counting as zero",
);
assert.equal(report.averageValues.sugar_alcohol, 6);
assert.equal(report.averageValues.alcohol, 14);
assert.equal(report.averageValues.vitamin_k, 90);
assert.equal(
  report.averageValues.protein,
  50,
  "a linked imported sidecar must not duplicate its full food record",
);
assert.equal(
  report.nutrients.find((nutrient) => nutrient.id === "vitamin_b12")?.unit,
  "mcg",
  "nutrient metadata retains its own unit",
);
assert.equal(
  report.nutrients.find((nutrient) => nutrient.id === "sodium")?.unit,
  "mg",
);
assert.equal(FOOD_NUTRIENTS.length, 44, "every normalized food nutrient is registered");
assert.equal(isFoodNutrientTrackerId("vitamin_k"), true);
assert.equal(isFoodNutrientTrackerId("food"), false);
assert.equal(FOOD_MACROS.length, 3);
assert.equal(parsePositiveFoodNutrientAmount("1,5"), 1.5);
assert.equal(parsePositiveFoodNutrientAmount("0"), undefined);
assert.equal(parsePositiveFoodNutrientAmount("not-a-number"), undefined);
assert.deepEqual(
  capturedFoodNutrients({
    proteinG: 30,
    fiberG: 8,
    sodiumMg: 0,
    vitaminKMcg: 90,
  }),
  [
    { metricId: "protein", value: 30 },
    { metricId: "fiber", value: 8 },
    { metricId: "vitamin_k", value: 90 },
  ],
);
const germanCommaReport = foodNutritionReport({
  entries: [
    {
      ...importedMeal,
      id: "manual-german-comma",
      source: "manual",
      sourceProvider: undefined,
      sourceRecordId: undefined,
      localDate: "2026-01-04",
      nutrition: {
        proteinG: parsePositiveFoodNutrientAmount("1,5"),
        vitaminCMg: parsePositiveFoodNutrientAmount("12,75"),
      },
    },
  ],
  userId: "user-a",
  range: "custom",
  dates: ["2026-01-04"],
  anchorDate: "2026-01-04",
  locale: "de-DE",
});
assert.equal(germanCommaReport.dayValues?.protein, 1.5);
assert.equal(germanCommaReport.dayValues?.vitamin_c, 12.8);

const afterNutrientDeletion = [
  { id: "food", order: 1 },
  { id: "protein", order: 18 },
];
assert.equal(
  hasFoodNutrientTracker(afterNutrientDeletion, "vitamin_k"),
  false,
  "deleting a nutrient tracker must fence its manual scalar sidecar",
);
const restoredVitaminK = {
  id: "vitamin_k",
  order: nextFoodNutrientTrackerOrder(afterNutrientDeletion),
};
assert.equal(restoredVitaminK.order, 19);
assert.equal(
  hasFoodNutrientTracker([...afterNutrientDeletion, restoredVitaminK], "vitamin_k"),
  true,
  "an explicit nutrient click can restore exactly that linked tracker",
);

const currentFoundationNutrients = [
  {
    nutrientId: 2047,
    nutrientName: "Energy (Atwater General Factors)",
    unitName: "KCAL",
    value: 121,
  },
  {
    nutrientId: 2000,
    nutrientName: "Total Sugars",
    unitName: "G",
    value: 4.25,
  },
];
assert.equal(
  usdaCalories(currentFoundationNutrients),
  121,
  "current USDA Foundation energy id 2047 must keep the product eligible",
);
assert.equal(usdaTotalSugarsG(currentFoundationNutrients), 4.25);
assert.equal(
  usdaCalories([
    ...currentFoundationNutrients,
    { nutrientId: 2048, unitName: "KCAL", value: 118 },
    { nutrientId: 1008, unitName: "KCAL", value: 110 },
  ]),
  118,
  "specific Atwater energy 2048 takes priority over 2047 and legacy 1008",
);
assert.equal(
  usdaCalories([{ nutrientId: 2048, unitName: "kJ", value: 500 }]),
  undefined,
  "energy with a non-kcal unit must never be treated as calories",
);

const privateNutritionRecord = {
  id: "private-meal-native-id",
  provider: "health_connect",
  type: "nutrition",
  startTime: "2026-01-02T12:00:00.000Z",
  endTime: "2026-01-02T12:15:00.000Z",
  value: 510,
  unit: "kcal",
  label: "Private meal name",
  note: "Private meal note",
  origin: "com.samsung.android.wear.shealth",
  nutrition: { proteinG: 32, vitaminKMcg: 90 },
};
const importedNutrition = mapHealthRecordsToEntries(
  [privateNutritionRecord],
  "user-a",
  { food: "private", protein: "group", vitamin_k: "status" },
  [
    {
      id: "food",
      dataType: "number",
      unit: "kcal",
      healthMapping: { dataType: "nutrition", field: "value" },
    },
    {
      id: "protein",
      dataType: "number",
      unit: "g",
      healthMapping: { dataType: "nutrition", field: "protein" },
    },
    {
      id: "vitamin_k",
      dataType: "number",
      unit: "mcg",
      healthMapping: { dataType: "nutrition", field: "vitamin_k" },
    },
  ],
);
assert.equal(new Set(importedNutrition.map((entry) => entry.id)).size, 3);
const privateFood = importedNutrition.find((entry) => entry.metricId === "food");
assert.equal(privateFood?.visibility, "private");
assert.deepEqual(privateFood?.nutrition, privateNutritionRecord.nutrition);
assert.equal(privateFood?.label, "Private meal name");
for (const metricId of ["protein", "vitamin_k"]) {
  const sidecar = importedNutrition.find((entry) => entry.metricId === metricId);
  assert.ok(sidecar, `${metricId} sidecar must be imported`);
  assert.equal(
    sidecar.visibility,
    "private",
    "linked nutrient sidecars inherit the canonical Food visibility",
  );
  assert.equal(sidecar.nutrition, undefined);
  assert.equal(sidecar.label, undefined);
  assert.equal(sidecar.note, undefined);
  assert.equal(sidecar.sourceRecordId, privateNutritionRecord.id);
}
const noFoodTrackerMetrics = [
  {
    id: "protein",
    dataType: "number",
    unit: "g",
    healthMapping: { dataType: "nutrition", field: "protein" },
  },
];
const noFoodPrivateSidecar = mapHealthRecordsToEntries(
  [privateNutritionRecord],
  "user-a",
  { protein: "private" },
  noFoodTrackerMetrics,
).find((entry) => entry.metricId === "protein");
assert.equal(
  noFoodPrivateSidecar?.visibility,
  "private",
  "without a Food tracker, a nutrient sidecar uses its own configured privacy",
);
const noFoodUnknownSidecar = mapHealthRecordsToEntries(
  [privateNutritionRecord],
  "user-a",
  {},
  noFoodTrackerMetrics,
).find((entry) => entry.metricId === "protein");
assert.equal(
  noFoodUnknownSidecar?.visibility,
  "private",
  "missing Food and nutrient visibility must fail closed",
);
assert.equal(noFoodUnknownSidecar?.nutrition, undefined);
assert.equal(noFoodUnknownSidecar?.label, undefined);
assert.equal(noFoodUnknownSidecar?.note, undefined);
const unconfiguredVitaminSidecar = mapHealthRecordsToEntries(
  [privateNutritionRecord],
  "user-a",
  { food: "private" },
  [
    {
      id: "food",
      dataType: "number",
      unit: "kcal",
      healthMapping: { dataType: "nutrition", field: "value" },
    },
  ],
).find((entry) => entry.metricId === "vitamin_k");
assert.ok(
  unconfiguredVitaminSidecar,
  "provider nutrients must retain history before their tracker is explicitly added",
);
assert.equal(unconfiguredVitaminSidecar.visibility, "private");
assert.equal(unconfiguredVitaminSidecar.nutrition, undefined);
assert.equal(unconfiguredVitaminSidecar.label, undefined);

const migrationSettings = { sentinel: "preserve-settings" };
const existingFood = {
  id: "food",
  order: 4,
  defaultVisibility: "private",
  submetrics: [
    {
      id: "protein",
      name: "My protein",
      unit: "g",
      goalEnabled: true,
      goal: { kind: "at_least", target: 155 },
    },
  ],
};
const oldState = {
  version: 25,
  settings: migrationSettings,
  metrics: [existingFood, { id: "custom", order: 1, defaultVisibility: "status" }],
};
const migrationDefaults = {
  metrics: [
    {
      ...existingFood,
      defaultVisibility: "group",
      submetrics: [
        { id: "protein", name: "Protein", unit: "g" },
        { id: "fiber", name: "Fiber", unit: "g" },
        { id: "sugar_alcohol", name: "Sugar alcohol", unit: "g" },
      ],
    },
    { id: "sugar_alcohol", order: 70, defaultVisibility: "group" },
    { id: "alcohol", order: 71, defaultVisibility: "private" },
  ],
};
const migratedNutrition = upgradeNutritionStateV26(
  oldState,
  migrationDefaults,
  25,
);
assert.equal(migratedNutrition.version, 27);
assert.equal(migratedNutrition.settings, migrationSettings);
assert.equal(migratedNutrition.metrics[0].defaultVisibility, "private");
assert.equal(migratedNutrition.metrics[0].order, 4);
assert.equal(migratedNutrition.metrics[0].submetrics[0].name, "My protein");
assert.deepEqual(
  migratedNutrition.metrics[0].submetrics.map((field) => field.id),
  ["protein", "sugar_alcohol"],
  "migration adds only new v26 Food submetrics and preserves removed legacy fields",
);
assert.deepEqual(
  migratedNutrition.metrics.slice(-2).map((metric) => metric.id),
  ["sugar_alcohol", "alcohol"],
  "migration appends only missing v26 nutrient trackers",
);
assert.equal(
  upgradeNutritionStateV26(migratedNutrition, migrationDefaults),
  migratedNutrition,
  "the v26 migration is a one-time idempotent boundary",
);

const single = foodNutritionReport({
  entries,
  userId: "user-a",
  range: "custom",
  dates: ["2026-01-02"],
  anchorDate: "2026-01-02",
  goals: { protein: 120 },
});
assert.equal(single.dayValues?.protein, 75);
assert.equal(single.macroSlices.length, 3);
assert.equal(single.availableIds.includes("vitamin_c"), false);

const pastMonth = foodNutritionReport({
  entries: [
    {
      ...importedMeal,
      id: "meal-before-anchor",
      localDate: "2026-07-10",
      nutrition: { proteinG: 10, carbsG: 0, fatG: 0 },
    },
    {
      ...importedMeal,
      id: "meal-after-anchor",
      localDate: "2026-07-28",
      nutrition: { proteinG: 28, carbsG: 0, fatG: 0 },
    },
  ],
  userId: "user-a",
  range: "month",
  dates: ["2026-07-10", "2026-07-28"],
  // Navigation preserves the day-of-month in its anchor. A past calendar
  // month must still use every date supplied by the selected range.
  anchorDate: "2026-07-20",
});
assert.equal(
  pastMonth.macroSlices[0].value,
  38,
  "past month and year reports must not truncate at the anchor day",
);
assert.equal(
  pastMonth.availableIds.includes("carbs"),
  false,
  "provider-created zero defaults must not populate the nutrient selector",
);

const longerHistory = [
  ...entries,
  {
    ...importedMeal,
    id: "meal-old",
    localDate: "2023-03-02",
    nutrition: { proteinG: 50, carbsG: 60, fatG: 12 },
  },
  {
    ...importedMeal,
    id: "meal-feb",
    localDate: "2026-02-03",
    nutrition: { proteinG: 60, carbsG: 80, fatG: 16 },
  },
];
const year = foodNutritionReport({
  entries: longerHistory,
  userId: "user-a",
  range: "year",
  dates: ["2026-01-01", "2026-01-02", "2026-02-03"],
  anchorDate: "2026-12-31",
});
assert.equal(year.bucketUnit, "month");
assert.deepEqual(year.buckets.map((bucket) => bucket.key), ["2026-01", "2026-02"]);
assert.equal(year.buckets[0].values.protein, 50, "year bars use a daily average per month");

const allTime = foodNutritionReport({
  entries: longerHistory,
  userId: "user-a",
  range: "overall",
  // All-time must derive its real range from food history, not this UI hint.
  dates: ["2026-02-03"],
  anchorDate: "2026-02-03",
});
assert.equal(allTime.bucketUnit, "year");
assert.deepEqual(allTime.buckets.map((bucket) => bucket.key), ["2023", "2026"]);
assert.equal(allTime.macroSlices.find((slice) => slice.id === "fat")?.value, 58);

const detail = read("app/metric-detail.tsx");
const logScreen = read("app/(tabs)/log.tsx");
const todayScreen = read("app/(tabs)/index.tsx");
const foodSearchSource = read("src/food/openFoodFacts.ts");
const provider = read("src/state/AppProvider.tsx");
const selectionMenu = read("src/components/SelectionMenu.tsx");
const metricsSource = read("src/domain/metrics.ts");
const todayHeroSource = read("src/domain/todayHero.ts");
const statusSource = read("src/domain/status.ts");
assert.match(detail, /const \[open, setOpen\] = useState\(false\)/);
assert.match(
  detail,
  /const report = useMemo\([\s\S]{0,160}if \(!open\) return undefined/,
  "the collapsed nutrition subsection must not scan and bucket food history",
);
assert.match(foodSearchSource, /const calories = usdaCalories\(nutrients\)/);
assert.match(foodSearchSource, /sugarG: usdaTotalSugarsG\(nutrients\)/);
assert.match(detail, /title="Shown nutrients"[\s\S]{0,1400}foodNutrientIds/);
assert.match(detail, /foodNutritionRangeMode/);
assert.match(detail, /FOOD_NUTRIENTS\.filter[\s\S]{0,180}report\.availableIds/);
assert.match(detail, /now - previous\.at > 360/);
assert.match(detail, /accessibilityActions=\{[\s\S]{0,220}name: "activate"/);
assert.match(detail, /onAccessibilityTap=\{[\s\S]{0,180}openFoodTimeEditor/);
assert.match(detail, /updateFoodEntryTime\(editingFoodEntry\.id, foodTimeDraft\)/);
assert.match(detail, /<FoodMacroDonut[\s\S]{0,3800}<FoodNutrientProgress/);
assert.match(detail, /<FoodNutrientBars/);
assert.match(detail, /pathname: "\/metric-detail"[\s\S]{0,120}metric: id/);
assert.match(detail, /onPress=\{\(\) => openNutrient\(nutrient\.id\)\}/);
assert.match(detail, /accessibilityLabel=\{`\$\{bucket\.label\}, \$\{nutrient\.label\}/);
assert.match(detail, /displayNutrientUnit[\s\S]{0,100}µg/);
assert.match(detail, /Average on days each nutrient was recorded/);
assert.match(detail, /style=\{styles\.foodMacroChartViewport\}/);
assert.match(detail, /foodMacroBarSlot: \{[\s\S]{0,80}flex: 1,[\s\S]{0,80}minWidth: 0/);
assert.match(detail, /foodMacroBarTarget: \{[\s\S]{0,80}flex: 1,[\s\S]{0,80}minWidth: 0/);
assert.doesNotMatch(
  detail,
  /<ScrollView\s+horizontal[\s\S]{0,200}accessibilityLabel="Nutrient history chart"/,
  "the individual nutrition chart must fit the card without horizontal scrolling",
);
assert.match(detail, /foodMacroBarGoalTick/);
assert.match(detail, /foodMacroGoalTick,[\s\S]{0,120}backgroundColor: palette\.amber/);
assert.match(detail, /borderTopColor: palette\.amber/);
assert.match(detail, /Goal bars show percent of goal; no-goal bars show percent of range maximum/);
assert.doesNotMatch(detail, /styles\.foodMacroGoalLine/);
assert.match(
  logScreen,
  /proteinG: parsePositiveFoodNutrientAmount\(protein\)[\s\S]{0,900}vitaminB12Mcg: parsePositiveFoodNutrientAmount\(vitaminB12\)/,
);
assert.ok(
  [...logScreen.matchAll(/const amount = parsePositiveFoodNutrientAmount\(raw\)/g)]
    .length >= 1,
  "supplemental parent fields must use locale-tolerant positive parsing",
);
assert.match(
  provider,
  /const nutrientSidecars: MetricEntry\[\] = capturedFoodNutrients\([\s\S]{0,2600}primaryEntry,[\s\S]{0,120}\.\.\.nutrientSidecars/,
  "manual Food must atomically emit every positive nutrient sidecar",
);
assert.match(
  provider,
  /const directEntriesToReplace[\s\S]{0,1000}action\.metricId === "food"[\s\S]{0,500}entriesShareSourceRecord\(foodEntry, entry\)/,
  "replacing a Food row must also tombstone its source-linked nutrient sidecars",
);
assert.match(
  provider,
  /case "deleteEntry"[\s\S]{0,900}isFoodNutrientTrackerId\(target\.metricId\)[\s\S]{0,500}if \(linkedFoodParent\) return state/,
  "a linked nutrient sidecar cannot be deleted independently of its Food parent",
);
assert.doesNotMatch(
  logScreen,
  /hasFoodNutrientTracker/,
  "manual nutrient history must be emitted by the atomic Food reducer path",
);
assert.match(logScreen, /const EXTRA_NUTRITION_GROUPS = \[[\s\S]{0,1200}Minerals & electrolytes[\s\S]{0,500}Vitamins/);
assert.match(logScreen, /openNutritionGroups\.includes\(group\.id\)/);
assert.match(logScreen, /nutritionText: \{[\s\S]{0,80}minWidth: 0/);
assert.match(logScreen, /nutritionUnit: \{[\s\S]{0,80}flexShrink: 0/);
assert.match(
  detail,
  /const openNutrient = useCallback\([\s\S]{0,400}pathname: "\/metric-detail"[\s\S]{0,120}metric: id/,
  "a nutrition visual click routes directly to its read-only detail",
);
assert.doesNotMatch(
  detail,
  /const openNutrient = useCallback\([\s\S]{0,900}(?:addMetric|updateMetric|hasFoodNutrientTracker)/,
  "opening a nutrient detail must not create, restore, or configure a tracker",
);
assert.match(
  detail,
  /const virtualNutrientTracker = useMemo<[\s\S]{0,1700}foodNutrientDetailEntries\([\s\S]{0,500}metrics: virtualNutrientTracker/,
  "a missing nutrient tracker must exist only inside the detail page's derived state",
);
assert.match(
  detail,
  /const loggingDestination = metricLoggingDestination\(tracker\)[\s\S]{0,300}const canAddEntry = Boolean\(\s*loggingTargetId/,
  "a nutrient detail must expose its source Food logger without creating the nutrient tracker",
);
assert.match(
  detail,
  /pathname: "\/\(tabs\)\/log"[\s\S]{0,300}metric: loggingTargetId![\s\S]{0,300}focusMetric:/,
  "a nutrient detail add action must route to Food logging instead of a direct nutrient row",
);
assert.match(detail, /strokeDasharray=/);
assert.doesNotMatch(detail, /foodMacroBarGoalTick: \{[\s\S]{0,180}borderStyle: "dashed"/);
assert.match(
  detail,
  /const entryRangeView = \["week", "month", "year", "overall"\]\.includes\([\s\S]{0,120}const entriesSectionOpen = entriesOpenOverride \?\? !entryRangeView;[\s\S]{0,260}setCollapsedEntryDates\(entryRangeView \? dates : \[\]\)/,
  "the Entries section and its day groups must default collapsed only for the four date-range views",
);
assert.match(
  detail,
  /function promptEntryRemoval[\s\S]{0,1400}"Managed from Food"[\s\S]{0,800}metric: "food"/,
  "linked nutrient deletion must route to the canonical Food entry",
);
assert.match(todayScreen, /!isFoodNutrientTrackerId\(metric\.id\)[\s\S]{0,120}!metric\.sections\.today/);
const types = read("src/types.ts");
const seed = read("src/data/seed.ts");
assert.match(types, /foodNutrientIds\?: string\[\]/);
assert.match(types, /foodNutritionRangeMode\?: "average" \| "individual"/);
assert.match(seed, /foodNutrientIds: \["protein", "carbs", "fat"\]/);
assert.match(seed, /foodNutritionRangeMode: "average"/);
assert.match(selectionMenu, /minimumSelected = 0/);
assert.match(selectionMenu, /accessibilityRole=\{multiple \? "checkbox" : "radio"\}/);
assert.match(selectionMenu, /accessibilityState=\{\{ checked \}\}/);
assert.match(selectionMenu, /minimumSelected === 0 \? \(/);
assert.match(selectionMenu, /accessibilityRole="button"[\s\S]{0,120}setOpen\(false\)/);
assert.match(detail, /title="Shown nutrients"[\s\S]{0,1600}minimumSelected=\{1\}/);
assert.match(provider, /case "updateFoodEntryTime"[\s\S]{0,2400}reconcileAutomaticFasting/);
assert.match(provider, /preserveFoodEntryClockOverride/);
assert.match(
  metricsSource,
  /if \(metric\.id === "food" \|\| metric\.id === "deficit"\)[\s\S]{0,180}const ratio = Math\.max\(0, value\) \/ peak/,
  "Food and deficit visual progress must share the same target-relative ratio",
);
assert.match(
  metricsSource,
  /return Math\.max\(0, Math\.min\(1, ratio <= 1 \? ratio : 2 - ratio\)\)/,
  "Food and deficit visual progress must fill to target and drain beyond it",
);
assert.match(
  todayHeroSource,
  /met && metric\.id !== "deficit"/,
  "the featured square must promote an under-limit Food day only after its end-of-day goal is final",
);
assert.match(
  statusSource,
  /reached && metric\.id !== "deficit"/,
  "Status rings must promote an under-limit Food day only after its end-of-day goal is final",
);

console.log("Food metric validation passed.");
