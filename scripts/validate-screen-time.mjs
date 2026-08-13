import assert from "node:assert/strict";
import fs from "node:fs";

import {
  averageScreenTimeReport,
  boundedScreenTimeMs,
  formatMinuteDuration,
  repairLegacyScreenTimeEntries,
  screenTimeTrackerSamples,
  screenTimeSampledDayCount,
} from "../src/domain/screenTime.ts";
import { activeFastingHours } from "../src/domain/fasting.ts";

const report = {
  screenTimeMs: 9_000_000,
  apps: [
    { packageName: "one", foregroundMs: 5_400_000 },
    { packageName: "two", foregroundMs: 3_600_000 },
  ],
};
const average = averageScreenTimeReport(report, 5);
assert.equal(average.screenTimeMs, 1_800_000);
assert.equal(average.apps[0].foregroundMs, 1_080_000);
assert.equal(average.apps[1].foregroundMs, 720_000);
assert.equal(averageScreenTimeReport(report, 1), report);
assert.equal(formatMinuteDuration(125), "2 hr 5 min");
assert.equal(formatMinuteDuration(60), "1 hr");
assert.equal(formatMinuteDuration(42), "42 min");
assert.equal(
  boundedScreenTimeMs(44 * 60 * 60 * 1000),
  24 * 60 * 60 * 1000,
  "an expanded native bucket must never become a 44-hour day",
);

const dailySamples = screenTimeTrackerSamples([
  {
    localDate: "2026-08-01",
    from: new Date("2026-08-01T00:00:00Z").getTime(),
    to: new Date("2026-08-02T00:00:00Z").getTime(),
    screenTimeMs: 90 * 60_000,
  },
  {
    localDate: "2026-08-02",
    from: new Date("2026-08-02T00:00:00Z").getTime(),
    to: new Date("2026-08-03T00:00:00Z").getTime(),
    screenTimeMs: 150 * 60_000,
  },
]);
assert.deepEqual(
  dailySamples.map(({ localDate, minutes }) => ({ localDate, minutes })),
  [
    { localDate: "2026-08-01", minutes: 90 },
    { localDate: "2026-08-02", minutes: 150 },
  ],
  "charts and Entries must receive one tracker value per native day",
);
assert.equal(
  dailySamples[0].recordedAt,
  "2026-08-01T23:59:59.999Z",
  "an exclusive next-midnight boundary must remain on the represented day",
);

const legacy = [
  {
    metricId: "screen_time",
    sourceOrigin: "android_usage_stats",
    value: 2_640,
  },
  { metricId: "screen_time", sourceOrigin: "manual", value: 2_640 },
];
const repaired = repairLegacyScreenTimeEntries(legacy);
assert.deepEqual(
  repaired.map((entry) => entry.sourceOrigin),
  ["manual"],
  "a corrupted imported row is removed instead of being fabricated as 24h",
);
assert.equal(repaired[0].value, 2_640, "manual values are not migration-owned");

const fastNow = new Date(2026, 7, 13, 12, 0, 0);
const liveFastState = {
  currentUserId: "user-a",
  metrics: [
    {
      id: "intermittent_fasting",
      fastingSettings: {
        startTime: "20:00",
        fastingMinutes: 16 * 60,
        automaticFoodBreak: false,
      },
    },
  ],
  entries: [
    {
      id: "old-completed-fast",
      metricId: "intermittent_fasting",
      userId: "user-a",
      localDate: "2026-08-13",
      recordedAt: new Date(2026, 7, 13, 8).toISOString(),
      value: 17,
    },
  ],
  settings: {
    fastingRuntimeByMetric: {
      intermittent_fasting: {
        startedAt: new Date(fastNow.getTime() - 15 * 60 * 60 * 1000).toISOString(),
        startedManually: true,
      },
    },
  },
};
assert.equal(
  activeFastingHours(liveFastState, "user-a", fastNow),
  15,
  "a resumed active fast must override an older completed same-day entry",
);

const day = 86_400_000;
const allTimeDayStarts = Array.from(
  { length: 730 },
  (_, index) => index * day,
);
const boundedTo = 729 * day + day / 2;
const boundedFrom = boundedTo - 366 * day;
assert.equal(
  screenTimeSampledDayCount(allTimeDayStarts, boundedFrom, boundedTo),
  366,
  "a bounded UsageStats response must use only fully sampled selected starts",
);
assert.equal(
  screenTimeSampledDayCount(allTimeDayStarts.slice(0, 7), 0, 7 * day),
  7,
);

const native = fs.readFileSync(
  "plugins/habhub-android/java/HabHubNativeModule.kt",
  "utf8",
);
assert.match(native, /UsageEvents\.Event\.ACTIVITY_PAUSED ->/);
assert.match(native, /UsageEvents\.Event\.ACTIVITY_STOPPED -> Unit/);
assert.doesNotMatch(
  native,
  /UsageEvents\.Event\.ACTIVITY_PAUSED,\s*UsageEvents\.Event\.ACTIVITY_STOPPED/,
);
const screenOffBranch = native.match(
  /UsageEvents\.Event\.SCREEN_NON_INTERACTIVE -> \{([\s\S]*?)\n\s*\}/,
)?.[1];
assert.ok(screenOffBranch, "screen-off event branch must exist");
assert.doesNotMatch(
  screenOffBranch,
  /currentPackage = null/,
  "screen-off must retain the resumed app for Samsung unlocks without a new resume event",
);
assert.match(
  native,
  /UsageEvents\.Event\.DEVICE_SHUTDOWN -> \{[\s\S]*?currentPackage = null/,
  "device shutdown must still clear the resumed app",
);
assert.match(native, /UsageStatsManager\.INTERVAL_DAILY/);
assert.doesNotMatch(native, /manager\.queryAndAggregateUsageStats\(/);
assert.match(native, /putArray\("days", dailyReports\)/);
assert.match(native, /normalizedUsageRows\(sourceRows, window\.second - window\.first\)/);

const cache = fs.readFileSync("src/screenTime/cache.ts", "utf8");
assert.match(cache, /screen-time-report:v4:/);

const detail = fs.readFileSync("src/screenTime/ScreenTimeBreakdownCard.tsx", "utf8");
assert.match(detail, /screenTimeTrackerSamples\(next\.days\)/);
assert.match(detail, /setDeviceScreenTimeRange\(samples\)/);

const metrics = fs.readFileSync("src/domain/metrics.ts", "utf8");
assert.match(metrics, /const liveHours = activeFastingHours\(/);
assert.match(metrics, /if \(liveHours !== undefined\) return liveHours;/);

console.log("Screen-time daily range, bounded history, and live fasting checks passed.");
