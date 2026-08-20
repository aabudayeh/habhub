import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  editFoodEntryClockTime,
  foodMacroReport,
  preserveFoodEntryClockOverride,
} from "../src/domain/food.ts";
import { reconcileAutomaticFasting } from "../src/domain/fasting.ts";

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
    nutrition: { proteinG: 25, carbsG: 50, fatG: 10 },
  },
  {
    ...importedMeal,
    id: "meal-b",
    localDate: "2026-01-02",
    nutrition: { proteinG: 75, carbsG: 100, fatG: 20 },
  },
  {
    ...importedMeal,
    id: "other-user",
    userId: "user-b",
    localDate: "2026-01-02",
    nutrition: { proteinG: 999, carbsG: 999, fatG: 999 },
  },
];
const report = foodMacroReport({
  entries,
  userId: "user-a",
  range: "week",
  dates: ["2026-01-01", "2026-01-02", "2026-01-03"],
  anchorDate: "2026-01-03",
  selectedIds: ["protein", "carbs", "fat"],
  goals: { protein: 120, carbs: 220, fat: 65 },
  locale: "en",
});
assert.equal(report.hasData, true);
assert.equal(report.bucketUnit, "day");
assert.equal(report.buckets.length, 3);
assert.equal(report.buckets[0].values.protein, 25);
assert.equal(report.buckets[2].values.protein, null);
assert.equal(report.slices.find((slice) => slice.id === "protein")?.grams, 100);
assert.equal(report.slices.find((slice) => slice.id === "carbs")?.grams, 150);
assert.equal(report.slices.find((slice) => slice.id === "fat")?.grams, 30);
assert.equal(
  Math.round(report.slices.reduce((sum, slice) => sum + slice.percent, 0)),
  100,
  "pie slices must represent macro-calorie share",
);

const single = foodMacroReport({
  entries,
  userId: "user-a",
  range: "custom",
  dates: ["2026-01-02"],
  anchorDate: "2026-01-02",
  selectedIds: ["protein"],
  goals: { protein: 120 },
});
assert.equal(single.dayValues?.protein, 75);
assert.equal(single.slices[0].percent, 100);

const pastMonth = foodMacroReport({
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
  selectedIds: ["protein"],
});
assert.equal(
  pastMonth.slices[0].grams,
  38,
  "past month and year reports must not truncate at the anchor day",
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
const year = foodMacroReport({
  entries: longerHistory,
  userId: "user-a",
  range: "year",
  dates: ["2026-01-01", "2026-01-02", "2026-02-03"],
  anchorDate: "2026-12-31",
  selectedIds: ["protein", "carbs"],
});
assert.equal(year.bucketUnit, "month");
assert.deepEqual(year.buckets.map((bucket) => bucket.key), ["2026-01", "2026-02"]);
assert.equal(year.buckets[0].values.protein, 50, "year bars use a daily average per month");

const allTime = foodMacroReport({
  entries: longerHistory,
  userId: "user-a",
  range: "overall",
  // All-time must derive its real range from food history, not this UI hint.
  dates: ["2026-02-03"],
  anchorDate: "2026-02-03",
  selectedIds: ["fat"],
});
assert.equal(allTime.bucketUnit, "year");
assert.deepEqual(allTime.buckets.map((bucket) => bucket.key), ["2023", "2026"]);
assert.equal(allTime.slices[0].grams, 58);

const detail = read("app/metric-detail.tsx");
const provider = read("src/state/AppProvider.tsx");
assert.match(detail, /const \[open, setOpen\] = useState\(false\)/);
assert.match(
  detail,
  /const report = useMemo\([\s\S]{0,120}if \(!open\) return undefined/,
  "the collapsed macro subsection must not scan and bucket food history",
);
assert.match(detail, /<SelectionMenu[\s\S]{0,700}multiple/);
assert.match(detail, /now - previous\.at > 360/);
assert.match(detail, /accessibilityActions=\{[\s\S]{0,220}name: "activate"/);
assert.match(detail, /onAccessibilityTap=\{[\s\S]{0,180}openFoodTimeEditor/);
assert.match(detail, /updateFoodEntryTime\(editingFoodEntry\.id, foodTimeDraft\)/);
assert.match(detail, /<FoodMacroDonut[\s\S]{0,1800}<FoodMacroProgress/);
assert.match(detail, /<FoodMacroBars/);
assert.match(detail, /strokeDasharray=/);
assert.match(detail, /borderStyle: "dashed"/);
assert.match(provider, /case "updateFoodEntryTime"[\s\S]{0,1200}reconcileAutomaticFasting/);
assert.match(provider, /preserveFoodEntryClockOverride/);

console.log("Food metric validation passed.");
