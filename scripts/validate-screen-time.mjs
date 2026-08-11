import assert from "node:assert/strict";
import fs from "node:fs";

import {
  averageScreenTimeReport,
  formatMinuteDuration,
  screenTimeSampledDayCount,
} from "../src/domain/screenTime.ts";

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

const cache = fs.readFileSync("src/screenTime/cache.ts", "utf8");
assert.match(cache, /screen-time-report:v3:/);

console.log("Screen-time event, range-average, duration, and cache checks passed.");
