import assert from "node:assert/strict";
import fs from "node:fs";

import { dateKey, dateWithOffsetFrom } from "../src/domain/date.ts";
import { energyFormulaVariables } from "../src/domain/energy.ts";
import {
  metricValue,
  metricVisualProgress,
  weeklyBalancePeriodReport,
} from "../src/domain/metrics.ts";

process.env.TZ = "Europe/Berlin";

const userId = "weekly-balance-user";
const deficitMetric = {
  id: "deficit",
  name: "Daily deficit",
  icon: "trending-down-outline",
  color: "#7756D9",
  unit: "kcal",
  dataType: "number",
  aggregation: "latest",
  rankingDirection: "higher",
  goal: { kind: "at_least", target: 500 },
  goalEnabled: true,
  scoreWeight: 0,
  defaultVisibility: "private",
  sections: { today: true, group: false, insights: true },
  order: 0,
  activeFrom: "2026-01-01",
};
const loggedDates = ["2026-08-17", "2026-08-18", "2026-08-20", "2026-08-23"];
function balanceEntries(dates, deficits) {
  return dates.flatMap((localDate, index) => [
    {
      id: `food-${localDate}`,
      metricId: "food",
      userId,
      value: 1_900 + index * 25,
      localDate,
      recordedAt: `${localDate}T12:00:00.000Z`,
      visibility: "private",
      source: "manual",
    },
    {
      id: `deficit-${localDate}`,
      metricId: "deficit",
      userId,
      value: deficits[index],
      localDate,
      recordedAt: `${localDate}T12:01:00.000Z`,
      visibility: "private",
      source: "manual",
    },
  ]);
}
const state = {
  currentUserId: userId,
  metrics: [deficitMetric],
  entries: balanceEntries(loggedDates, [550, 450, 600, 500]),
  settings: { weekStartsOn: 1 },
};

const selectedDay = weeklyBalancePeriodReport(
  state,
  userId,
  "custom",
  "2026-08-20",
);
assert.equal(selectedDay.startDate, "2026-08-17");
assert.equal(selectedDay.endDate, "2026-08-20");
assert.equal(selectedDay.bucketKind, "day");
assert.equal(selectedDay.buckets.length, 4);
assert.equal(selectedDay.days, 3);
assert.equal(selectedDay.actual, 1_600);
assert.equal(selectedDay.target, 1_500);
assert.equal(selectedDay.balance, 100);
assert.equal(selectedDay.onPlanBuckets, 2);
assert.equal(selectedDay.countedBuckets, 3);
assert.equal(selectedDay.bestBucket?.balance, 100);
assert.equal(selectedDay.worstBucket?.balance, -50);

const saturdayWeek = weeklyBalancePeriodReport(
  state,
  userId,
  "custom",
  "2026-08-20",
  6,
);
assert.equal(saturdayWeek.startDate, "2026-08-15");
assert.equal(saturdayWeek.endDate, "2026-08-20");
assert.equal(saturdayWeek.buckets.length, 6);

const week = weeklyBalancePeriodReport(
  state,
  userId,
  "week",
  "2026-08-18",
);
assert.equal(week.startDate, "2026-08-17");
assert.equal(week.endDate, "2026-08-23");
assert.equal(week.buckets.length, 7);
assert.equal(week.days, 4);
assert.equal(week.actual, 2_100);
assert.equal(week.target, 2_000);
assert.equal(week.balance, 100);
assert.equal(week.onPlanBuckets, 3);
assert.equal(week.countedBuckets, 4);

const month = weeklyBalancePeriodReport(
  state,
  userId,
  "month",
  "2026-08-18",
);
assert.equal(month.startDate, "2026-08-01");
assert.equal(month.endDate, dateKey());
assert.equal(month.bucketKind, "week");
assert.equal(month.days, 4);
assert.ok(month.buckets.length >= 4);

const year = weeklyBalancePeriodReport(
  state,
  userId,
  "year",
  "2026-08-18",
);
assert.equal(year.startDate, "2026-01-01");
assert.equal(year.endDate, dateKey());
assert.equal(year.bucketKind, "month");
assert.equal(year.days, 4);

const overall = weeklyBalancePeriodReport(
  state,
  userId,
  "overall",
  "2026-08-18",
);
assert.equal(overall.startDate, "2026-08-17");
assert.equal(overall.endDate, dateKey());
assert.equal(overall.days, 4);
assert.equal(overall.balance, 100);
assert.ok(overall.bestBucket);
assert.ok(overall.worstBucket);

const oldStart = dateWithOffsetFrom(dateKey(), -800);
const longState = {
  ...state,
  entries: balanceEntries([oldStart, dateKey()], [450, 650]),
};
const longOverall = weeklyBalancePeriodReport(
  longState,
  userId,
  "overall",
  oldStart,
);
assert.equal(longOverall.startDate, oldStart);
assert.equal(longOverall.endDate, dateKey());
assert.equal(longOverall.bucketKind, "year");
assert.equal(longOverall.days, 1);
assert.equal(longOverall.balance, -50);
assert.ok(longOverall.buckets.length >= 3);

const dstState = {
  ...state,
  entries: balanceEntries(["2026-03-28", "2026-03-30"], [500, 500]),
};
const dstOverall = weeklyBalancePeriodReport(
  dstState,
  userId,
  "overall",
  "2026-03-30",
);
assert.equal(dstOverall.startDate, "2026-03-28");
assert.equal(dstOverall.days, 2);

const empty = { ...state, entries: [] };
const emptyReport = weeklyBalancePeriodReport(
  empty,
  userId,
  "custom",
  "2026-08-20",
);
assert.equal(emptyReport.days, 0);
assert.equal(emptyReport.balance, 0);
assert.equal(emptyReport.bestBucket, undefined);

const energyUserId = "energy-user";
const energyProfile = {
  age: 32,
  sex: "male",
  heightCm: 178,
  weightKg: 80,
  targetWeightKg: 75,
  activityLevel: "moderate",
  desiredWeeklyLossKg: 0.5,
};
const energyMetric = {
  id: "energy_burned",
  name: "Energy burned",
  unit: "kcal",
  dataType: "number",
  aggregation: "latest",
};
const exerciseMetric = {
  id: "exercise",
  name: "Active energy",
  unit: "kcal",
  dataType: "number",
  aggregation: "sum",
};
const foodMetric = {
  id: "food",
  name: "Food",
  unit: "kcal",
  dataType: "number",
  aggregation: "sum",
  goal: { kind: "at_most", target: 2_000 },
};
const dailyDeficitMetric = {
  id: "deficit",
  name: "Daily deficit",
  unit: "kcal",
  dataType: "calculated",
  aggregation: "latest",
  formula: "energy_burned - food",
};
const defaults = {
  currentUserId: energyUserId,
  metrics: [energyMetric, exerciseMetric, foodMetric, dailyDeficitMetric],
  entries: [],
  gymSessions: [],
  photos: [],
  todos: [],
  energyProfiles: { [energyUserId]: energyProfile },
  settings: {
    baselineCalories: 2_000,
    energyProfile,
  },
};
const energyDate = "2026-08-20";
const profile = defaults.energyProfiles[energyUserId];
const baseline = energyFormulaVariables(
  profile,
  defaults.settings.baselineCalories,
).daily_energy;
const energyState = {
  ...defaults,
  entries: [
    {
      id: "exercise-energy-test",
      metricId: "exercise",
      userId: energyUserId,
      value: 300,
      localDate: energyDate,
      recordedAt: `${energyDate}T12:00:00.000Z`,
      visibility: "private",
      source: "manual",
    },
    {
      id: "food-energy-test",
      metricId: "food",
      userId: energyUserId,
      value: 2_000,
      localDate: energyDate,
      recordedAt: `${energyDate}T12:01:00.000Z`,
      visibility: "private",
      source: "manual",
    },
  ],
};
assert.equal(
  metricValue(energyState, energyMetric, energyUserId, energyDate),
  baseline + 300,
  "the fallback total combines profile daily energy and active energy",
);
assert.equal(
  metricValue(energyState, dailyDeficitMetric, energyUserId, energyDate),
  baseline + 300 - 2_000,
);
const providerEnergyState = {
  ...energyState,
  entries: [
    ...energyState.entries,
    {
      id: "provider-total-energy-test",
      metricId: "energy_burned",
      userId: energyUserId,
      value: 2_500,
      localDate: energyDate,
      recordedAt: `${energyDate}T23:59:00.000Z`,
      visibility: "private",
      source: "imported",
      sourceProvider: "health_connect",
    },
  ],
};
assert.equal(
  metricValue(providerEnergyState, energyMetric, energyUserId, energyDate),
  2_500,
  "a provider total replaces rather than adds to the fallback",
);
assert.equal(
  metricValue(providerEnergyState, dailyDeficitMetric, energyUserId, energyDate),
  500,
);
assert.equal(
  metricVisualProgress(providerEnergyState, foodMetric, energyUserId, energyDate, 500, 2_000),
  0.25,
  "Food's featured/status progress must fill with intake instead of completing after one entry",
);

const detail = fs.readFileSync("app/metric-detail.tsx", "utf8");
assert.match(detail, /weeklyBalancePeriodReport\(/);
assert.match(detail, /DETAIL_PERIODS\.map/);
assert.match(detail, /accessibilityLabel=\{t\("Energy balance chart"\)\}/);
assert.match(detail, /t\("Week-to-date result"\)/);
assert.match(detail, /label="Average per day"/);
assert.match(detail, /label="Periods on plan"/);
assert.match(detail, /Balance report/);
assert.match(detail, /Plan consistency/);
assert.match(detail, /above line = ahead · below = behind/);
assert.match(detail, /No food-logged days in this period/);
assert.match(detail, /"\{balance\} kcal ahead"/);
assert.match(detail, /"\{balance\} kcal behind"/);
assert.doesNotMatch(detail, /green ahead/);

console.log(
  "Weekly balance day, week, month, year, all-time chart and report validation passed.",
);
