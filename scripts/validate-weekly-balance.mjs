import assert from "node:assert/strict";
import fs from "node:fs";

import { dateKey, dateWithOffsetFrom } from "../src/domain/date.ts";
import {
  calculateBmr,
  calculateDailyEnergy,
  recommendedDailyDeficit,
  recommendedDailyIntake,
} from "../src/domain/energy.ts";
import { increasingGoalLiquidAnimationStarts } from "../src/domain/goalLiquid.ts";
import { unrecordedStepActivity } from "../src/domain/health.ts";
import {
  metricValue,
  metricVisualProgress,
  effectiveGoalTarget,
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
assert.deepEqual(
  selectedDay.dailyBalances.map((entry) => entry.startDate),
  ["2026-08-17", "2026-08-18", "2026-08-20"],
  "a selected day must expose each completed, food-logged day in its week-to-date Entries range",
);
assert.deepEqual(
  selectedDay.dailyBalances.map((entry) => entry.balance),
  [50, -50, 100],
  "each Weekly balance entry must preserve that day's end-of-day balance",
);
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
assert.equal(week.dailyBalances.length, 4);

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
assert.equal(month.dailyBalances.length, 4);
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
assert.equal(year.dailyBalances.length, 4);

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
assert.equal(overall.dailyBalances.length, 4);
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
assert.deepEqual(emptyReport.dailyBalances, []);
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
const baseline = calculateBmr(profile);
const plannedEnergy = calculateDailyEnergy(profile);
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
  "the fallback total combines resting energy and active energy without double-counting the activity-level estimate",
);
assert.equal(
  metricValue(energyState, dailyDeficitMetric, energyUserId, energyDate),
  plannedEnergy + 300 - 2_000,
  "Daily deficit must use the same full-day profile baseline as Food allowance",
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
  "a complete provider total replaces rather than adds to the fallback",
);
assert.equal(
  metricValue(providerEnergyState, dailyDeficitMetric, energyUserId, energyDate),
  Math.max(2_500, plannedEnergy + 300) - 2_000,
  "Daily deficit must retain its planned baseline while accepting a larger provider total",
);
assert.equal(
  metricVisualProgress(providerEnergyState, foodMetric, energyUserId, energyDate, 500, 2_000),
  0.25,
  "Food's featured/status progress must fill with intake instead of completing after one entry",
);
assert.equal(
  metricVisualProgress(providerEnergyState, foodMetric, energyUserId, energyDate, 2_500, 2_000),
  0.75,
  "Food progress must drain after the allowance is exceeded",
);
assert.equal(
  metricVisualProgress(providerEnergyState, foodMetric, energyUserId, energyDate, 4_000, 2_000),
  0,
  "Food progress must reach zero at twice the allowance",
);
assert.equal(
  metricVisualProgress(providerEnergyState, dailyDeficitMetric, energyUserId, energyDate, 750, 500),
  0.5,
  "Daily-deficit progress must use the same target-peak shape",
);
const staleProviderEnergyState = {
  ...energyState,
  entries: [
    ...energyState.entries,
    {
      id: "stale-provider-total-energy-test",
      metricId: "energy_burned",
      userId: energyUserId,
      value: baseline,
      localDate: energyDate,
      recordedAt: `${energyDate}T23:59:00.000Z`,
      visibility: "private",
      source: "imported",
      sourceProvider: "health_connect",
    },
  ],
};
assert.equal(
  metricValue(staleProviderEnergyState, energyMetric, energyUserId, energyDate),
  baseline + 300,
  "a stale rest-only provider total must not hide workout and uncovered-step activity",
);

const stepsMetric = {
  id: "steps",
  name: "Steps",
  unit: "steps",
  dataType: "number",
  aggregation: "sum",
  healthMapping: { dataType: "steps", field: "value" },
};
const stepAwareExerciseMetric = {
  ...exerciseMetric,
  stepFallback: true,
  healthMapping: { dataType: "active_energy", field: "value" },
};
const stepAwareEntries = [
  ...energyState.entries,
  {
    id: "energy-steps-test",
    metricId: "steps",
    userId: energyUserId,
    value: 6_000,
    localDate: energyDate,
    recordedAt: `${energyDate}T12:02:00.000Z`,
    visibility: "private",
    source: "imported",
  },
  {
    id: "stale-materialized-step-fallback",
    metricId: "exercise",
    userId: energyUserId,
    value: 1,
    localDate: energyDate,
    recordedAt: `${energyDate}T12:03:00.000Z`,
    visibility: "private",
    source: "calculated",
    sourceRecordId: `step-fallback:${energyDate}`,
  },
];
const stepAwareMetrics = [
  energyMetric,
  stepAwareExerciseMetric,
  stepsMetric,
  foodMetric,
  dailyDeficitMetric,
];
const stepAwareState = {
  ...energyState,
  metrics: stepAwareMetrics,
  entries: stepAwareEntries,
};
const uncovered = unrecordedStepActivity(
  stepAwareEntries,
  stepAwareMetrics,
  6_000,
  profile,
);
const expectedActiveEnergy = Math.round(300 + uncovered.estimatedCalories);
assert.equal(
  metricValue(
    stepAwareState,
    stepAwareExerciseMetric,
    energyUserId,
    energyDate,
  ),
  expectedActiveEnergy,
  "active energy must combine measured workout calories with a fresh uncovered-step estimate without reusing a stale materialized fallback",
);
assert.equal(
  metricValue(stepAwareState, energyMetric, energyUserId, energyDate),
  baseline + expectedActiveEnergy,
  "total energy must combine BMR, measured workout calories, and uncovered-step activity",
);

const coldStartProfile = {
  age: 61,
  sex: "male",
  heightCm: 175,
  weightKg: 80,
  targetWeightKg: 75,
  activityLevel: "moderate",
  dailyActivityCaloriesOverride: 903,
  desiredWeeklyLossKg: 2,
};
const coldStartFoodTarget = recommendedDailyIntake(coldStartProfile);
const coldStartDeficitTarget = recommendedDailyDeficit(coldStartProfile);
const coldStartFoodMetric = {
  ...foodMetric,
  goal: { kind: "at_most", target: coldStartFoodTarget },
};
const coldStartDeficitMetric = {
  ...dailyDeficitMetric,
  goal: { kind: "at_least", target: coldStartDeficitTarget },
};
const coldStartState = {
  ...defaults,
  metrics: [
    energyMetric,
    exerciseMetric,
    coldStartFoodMetric,
    coldStartDeficitMetric,
  ],
  entries: [],
  energyProfiles: { [energyUserId]: coldStartProfile },
  settings: {
    ...defaults.settings,
    energyProfile: coldStartProfile,
    foodGoalMode: "activity_adjusted",
  },
};
const coldStartNow = new Date("2026-08-25T10:00:00.000Z");
const coldStartDate = "2026-08-25";
const accruedEnergy = metricValue(
  coldStartState,
  energyMetric,
  energyUserId,
  coldStartDate,
  [],
  coldStartNow,
);
assert.equal(
  Math.round(accruedEnergy),
  797,
  "standalone Total energy must remain the BMR accrued through noon",
);
assert.equal(coldStartFoodTarget, 297);
assert.equal(coldStartDeficitTarget, 2_200);
assert.equal(
  effectiveGoalTarget(
    coldStartState,
    coldStartFoodMetric,
    energyUserId,
    coldStartDate,
  ),
  297,
  "the cold-start case must retain its reported Food allowance",
);
assert.equal(
  Math.round(
    metricValue(
      coldStartState,
      coldStartDeficitMetric,
      energyUserId,
      coldStartDate,
      [],
      coldStartNow,
    ),
  ),
  2_497,
  "Daily deficit must paint the projected 2497 kcal immediately instead of the accrued BMR",
);
const providerAheadState = {
  ...coldStartState,
  entries: [
    {
      id: "cold-start-provider-total",
      metricId: "energy_burned",
      userId: energyUserId,
      value: 3_000,
      localDate: coldStartDate,
      recordedAt: "2026-08-25T09:30:00.000Z",
      visibility: "private",
      source: "imported",
      sourceProvider: "health_connect",
    },
  ],
};
assert.equal(
  metricValue(
    providerAheadState,
    coldStartDeficitMetric,
    energyUserId,
    coldStartDate,
    [],
    coldStartNow,
  ),
  3_000,
  "a connected-health total above the full-day projection must still improve Daily deficit",
);
const allowanceConsumedState = {
  ...coldStartState,
  entries: [
    {
      id: "cold-start-food",
      metricId: "food",
      userId: energyUserId,
      value: coldStartFoodTarget,
      localDate: coldStartDate,
      recordedAt: "2026-08-25T09:00:00.000Z",
      visibility: "private",
      source: "manual",
    },
  ],
};
assert.equal(
  Math.round(
    metricValue(
      allowanceConsumedState,
      coldStartDeficitMetric,
      energyUserId,
      coldStartDate,
      [],
      coldStartNow,
    ),
  ),
  coldStartDeficitTarget,
  "consuming the Food allowance must land on the configured Daily deficit target",
);

assert.deepEqual(
  increasingGoalLiquidAnimationStarts(
    {
      steps: { progress: 0.4, signature: "old-steps" },
      water: { progress: 0.7, signature: "old-water" },
      food: { progress: 0.5, signature: "old-food" },
    },
    {
      steps: { progress: 0.65, signature: "new-steps" },
      water: { progress: 0.6, signature: "new-water" },
      food: { progress: 0.5, signature: "new-food-value" },
      exercise: { progress: 0.25, signature: "new-exercise" },
    },
  ),
  { steps: 0.4, exercise: 0 },
  "featured squares must animate increases from persisted progress, ignore regressions/equal fills, and start only new trackers at zero",
);

const detail = fs.readFileSync("app/metric-detail.tsx", "utf8");
const todayHero = fs.readFileSync("src/domain/todayHero.ts", "utf8");
const status = fs.readFileSync("src/domain/status.ts", "utf8");
assert.match(
  todayHero,
  /met && metric\.id !== "deficit"/,
  "a completed under-limit Food day must finish with a full Featured square while Deficit keeps its target-peak shape",
);
assert.match(
  status,
  /reached && metric\.id !== "deficit"/,
  "Status must finalize an under-limit Food day at 100% without flattening an excessive deficit",
);
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
assert.match(detail, /<InfoPopover/);
assert.doesNotMatch(
  detail,
  /title="Weekly balance"\s+subtitle=/,
  "Weekly balance explanation must live behind the info icon instead of an always-visible subtitle",
);
assert.match(detail, /report\.dailyBalances/);
assert.match(detail, /End-of-day balances from food-logged days/);
assert.match(detail, /"\{balance\} kcal ahead"/);
assert.match(detail, /"\{balance\} kcal behind"/);
assert.doesNotMatch(detail, /green ahead/);
const weeklyDetail = detail.slice(
  detail.indexOf("function WeeklyDetail"),
  detail.indexOf("function WeeklyBalanceChart"),
);
const weeklyReportIndex = weeklyDetail.indexOf("Balance report");
const weeklyEntriesIndex = weeklyDetail.indexOf("styles.logHeader");
assert.ok(
  weeklyReportIndex >= 0 && weeklyEntriesIndex > weeklyReportIndex,
  "Weekly balance Entries must be the final detail section after its report",
);
assert.match(
  weeklyDetail,
  /<Pressable[\s\S]{0,300}style=\{styles\.logHeader\}[\s\S]{0,180}>Entries<[\s\S]{0,420}\{entriesOpen \? <View style=\{styles\.entries\}>/,
  "Weekly balance must reuse the standard collapsible metric Entries heading and list",
);
assert.match(
  weeklyDetail,
  /report\.dailyBalances[\s\S]{0,260}<Card key=\{entry\.id\} style=\{styles\.entry\}>[\s\S]{0,800}\{actual\} kcal actual · \{target\} kcal target/,
  "each Weekly balance day must use the standard entry card while preserving actual and target semantics",
);
assert.doesNotMatch(
  weeklyDetail,
  /weeklyEntriesCard|weeklyEntryRow|weeklyEntryIcon|weeklyEntryValue/,
  "Weekly balance must not keep a bespoke Entries visual treatment",
);

console.log(
  "Weekly balance day, week, month, year, all-time chart and report validation passed.",
);
