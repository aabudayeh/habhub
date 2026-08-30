import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE,
  historicalCloudActivityDateBatches,
  MAX_CLOUD_STATUS_UPSERT_ROWS,
  MAX_ROUTINE_CLOUD_ACTIVITY_DATES,
  routineCloudActivityDates,
} from "../src/domain/cloudMaintenance.ts";
import { createKeyedLatestAsyncDrain } from "../src/domain/latestAsyncDrain.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const cloud = read("src/cloud/groupCloud.ts");
const appProvider = read("src/state/AppProvider.tsx");
const backgroundHealth = read("src/health/background.native.ts");
const migration = read(
  "supabase/migrations/202608240003_batch_daily_status_revision_fence.sql",
);

const today = "2026-08-24";
const routineDates = routineCloudActivityDates(today, [
  "2026-08-17",
  "2026-08-23",
  "2026-08-22",
  "2026-08-21",
]);
assert.deepEqual(
  routineDates,
  ["2026-08-17", today],
  "today plus the highest-priority changed date must win over fallback overlap",
);
assert.equal(routineDates.length, MAX_ROUTINE_CLOUD_ACTIVITY_DATES);
assert.deepEqual(
  routineCloudActivityDates(today, [today, "invalid", "2026-08-25", "2026-08-23"]),
  ["2026-08-23", today],
  "duplicates, invalid dates, and future dates must not widen routine publication",
);

const configuredMetricCount = 48;
const routineStatusRowUpperBound = routineDates.length * configuredMetricCount;
assert.equal(routineStatusRowUpperBound, 96);
assert.ok(
  routineStatusRowUpperBound <=
    MAX_ROUTINE_CLOUD_ACTIVITY_DATES * configuredMetricCount,
  "routine status rows must remain bounded by two dates times configured metrics",
);

const repairDates = Array.from({ length: 37 }, (_, index) =>
  `2026-07-${String(index + 1).padStart(2, "0")}`,
);
const repairBatches = historicalCloudActivityDateBatches(
  [...repairDates, ...routineDates, repairDates[0]],
  routineDates,
);
assert.ok(repairBatches.length > 1);
assert.ok(
  repairBatches.every(
    (batch) => batch.length <= HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE,
  ),
  "historical projection work must yield between bounded date slices",
);
assert.equal(new Set(repairBatches.flat()).size, repairDates.length);
assert.ok(
  repairBatches.flat().every((localDate) => !routineDates.includes(localDate)),
);

const processed = [];
let releaseFirst;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
const drain = createKeyedLatestAsyncDrain(async (key, value) => {
  processed.push(`start:${key}:${value}`);
  if (key === "account-a" && value === 1) await firstGate;
  processed.push(`end:${key}:${value}`);
  return `${key}:${value}`;
});
const first = drain("account-a", 1);
const superseded = drain("account-a", 2);
const latest = drain("account-a", 3);
const independent = drain("account-b", 9);
releaseFirst();
assert.deepEqual(await Promise.all([first, superseded, latest, independent]), [
  "account-a:1",
  "account-a:3",
  "account-a:3",
  "account-b:9",
]);
assert.deepEqual(
  processed.filter((event) => event.startsWith("start:account-a")),
  ["start:account-a:1", "start:account-a:3"],
  "an active recent publish must run once and coalesce queued state to the latest",
);

const failedAttempts = [];
let releaseFailure;
const failureGate = new Promise((resolve) => {
  releaseFailure = resolve;
});
const failingDrain = createKeyedLatestAsyncDrain(async (_key, value) => {
  failedAttempts.push(value);
  await failureGate;
  throw new Error("offline");
});
const failedFirst = failingDrain("account-c", 1);
const failedQueued = failingDrain("account-c", 2);
releaseFailure();
const failedResults = await Promise.allSettled([failedFirst, failedQueued]);
assert.ok(failedResults.every((result) => result.status === "rejected"));
assert.deepEqual(
  failedAttempts,
  [1],
  "a failed active publication must reject queued work instead of retry-looping",
);

assert.match(cloud, /createKeyedLatestAsyncDrain<[\s\S]{0,260}pushCloudRecentActivityNow/);
assert.match(
  cloud,
  /routineCloudActivityDates\([\s\S]{0,180}dateRangeEnding\(today, 2\)\.reverse\(\)/,
);
assert.doesNotMatch(
  cloud,
  /fastRecentDates\s*=\s*dateRangeEnding\([^\n]*30\)/,
  "workspace saves must never republish a 30-day all-metric matrix",
);
assert.doesNotMatch(
  cloud,
  /const boundedRecentActivityDates\s*=\s*\[/,
  "routine saves must not re-add every locally cached date from a 30-day window",
);
assert.match(
  cloud,
  /batches\(rows, MAX_CLOUD_STATUS_UPSERT_ROWS\)/,
  "each REST status upsert must have a hard row bound",
);
assert.match(
  cloud,
  /for \(const localDates of supplementalDateBatches\)[\s\S]{0,500}await yieldMaintenance\(\)[\s\S]{0,1200}supplementalDateBatches\.length > 0\s*\|\|\s*entriesToUpsert\.length > 0[\s\S]{0,120}await commitActivity/,
  "historical slices and exact detail rows must finish before their one durable activity acknowledgement",
);
assert.match(
  backgroundHealth,
  /revisionSafeEntriesWithFloors\.map\(\(entry\) => entry\.localDate\)[\s\S]{0,260}pushCloudRecentActivity\([\s\S]{0,120}changedDates/,
  "native background publication must prioritize dates actually changed by its import",
);
assert.match(
  appProvider,
  /if \(source === "local"\)[\s\S]{0,80}setLocalMutationRevision/,
  "cloud-origin hydration must not enqueue another autosave",
);

const rowGuard =
  migration.match(
    /create or replace function public\.enforce_daily_metric_status_revision_row\(\)[\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
assert.match(rowGuard, /new\.user_id <> caller_id/);
assert.match(rowGuard, /new\.account_revision is null/);
assert.match(
  rowGuard,
  /new\.account_revision < old\.account_revision[\s\S]{0,100}stale_group_publish/,
);
assert.doesNotMatch(
  rowGuard,
  /assert_account_snapshot_revision/,
  "the per-row guard must never scan user_snapshots",
);
assert.match(
  migration,
  /after insert on public\.daily_metric_status\s+referencing new table as inserted_status_rows\s+for each statement/,
);
assert.match(
  migration,
  /after update on public\.daily_metric_status\s+referencing new table as updated_status_rows\s+for each statement/,
);
assert.match(
  migration,
  /select distinct status\.user_id, status\.account_revision[\s\S]{0,180}assert_account_snapshot_revision/g,
  "statement guards must check once per distinct owner/revision",
);

console.log(
  `Cloud status containment validation passed: routine upper bound ${routineStatusRowUpperBound} rows for ${configuredMetricCount} metrics; REST batches <= ${MAX_CLOUD_STATUS_UPSERT_ROWS} rows; historical date slices <= ${HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE}; queued publish loop coalesced.`,
);
