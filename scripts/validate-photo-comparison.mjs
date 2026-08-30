import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chronologicalProgressPhotos,
  fullPhotoDate,
  nearestPhotoMeasurement,
  photoFrameDurationMs,
  photoIndexAtOffset,
  photoWeightLabel,
} from "../src/domain/photoProgress.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const photos = [
  { id: "later", localDate: "2026-08-30", createdAt: "2026-08-30T12:00:00Z" },
  { id: "earlier", localDate: "2026-08-01", createdAt: "2026-08-01T12:00:00Z" },
];
assert.deepEqual(
  chronologicalProgressPhotos(photos).map((photo) => photo.id),
  ["earlier", "later"],
  "Photo playback must remain chronological.",
);
assert.match(fullPhotoDate("2026-08-30", "en-GB"), /2026/);
assert.doesNotMatch(
  fullPhotoDate("2026-08-30", "en-GB"),
  /today/i,
  "Comparison dates must never become relative Today labels.",
);

const measurements = [
  {
    id: "weight-far",
    userId: "me",
    metricId: "weight",
    localDate: "2026-08-01",
    recordedAt: "2026-08-01T09:00:00Z",
    value: 80,
  },
  {
    id: "weight-near",
    userId: "me",
    metricId: "weight",
    localDate: "2026-08-20",
    recordedAt: "2026-08-20T09:00:00Z",
    value: 78,
  },
];
assert.equal(
  nearestPhotoMeasurement(measurements, "me", "2026-08-30", "weight")?.value,
  78,
  "A photo must use the nearest canonical weight measurement.",
);
assert.match(
  photoWeightLabel(measurements, "me", "2026-08-30", "en-GB") ?? "",
  /measured.*2026.*10d away/i,
  "A nearest measurement more than seven days away must disclose its date.",
);
assert.equal(photoFrameDurationMs(2), 500);
assert.equal(photoIndexAtOffset(50, 100, 5), 2);

const seed = read("src/data/seed.ts");
const migration = read("src/domain/stateMigration.ts");
const studio = read("src/components/PhotoComparisonStudio.tsx");
const metricDetail = read("app/metric-detail.tsx");
const logScreen = read("app/(tabs)/log.tsx");
const memberComparison = read("app/member/[id].tsx");
assert.match(seed, /id: "progress_photo",[\s\S]{0,80}name: "Photo progress"/);
assert.match(migration, /metric\.id === "progress_photo"[\s\S]{0,120}name: "Photo progress"/);
assert.match(metricDetail, /tracker\.id === "progress_photo"[\s\S]{0,180}<PhotoComparisonStudio/);
assert.match(
  logScreen,
  /selected\.dataType === "photo"[\s\S]{0,1800}bodyCompositionMetrics[\s\S]{0,1600}logMetric\(\s*measurement\.id/,
  "Photo progress logging must persist optional body measurements to their canonical trackers.",
);
assert.match(
  logScreen,
  /selected\.dataType === "photo"[\s\S]{0,500}Optional body measurements[\s\S]{0,1200}bodyCompositionMetrics/,
  "Photo progress logging must expose compact optional Weight, Body fat, and Lean mass inputs.",
);
assert.match(metricDetail, /entryRangeView = \["week", "month", "year", "overall"\]\.includes/);
assert.match(metricDetail, /entriesSectionOpen = entriesOpenOverride \?\? !entryRangeView/);
assert.match(metricDetail, /accessibilityState=\{\{ expanded: entriesSectionOpen \}\}/);
assert.match(metricDetail, /\{entriesSectionOpen \? <View style=\{styles\.entries\}>/);
assert.match(metricDetail, /function WeeklyDetail[\s\S]{0,1500}entriesOpen = entriesOpenOverride \?\? !entryRangeView/);
assert.match(studio, /MediaRecorder\.isTypeSupported/);
assert.match(studio, /mimeType\.startsWith\("video\/mp4"\) \? "mp4" : "webm"/);
assert.match(studio, /minimumSelected=\{2\}/);
assert.match(studio, /onDeletePhoto\(active\.id\)/);
assert.match(studio, /showBodyFat/);
assert.match(studio, /showLeanMass/);
assert.match(memberComparison, /photoComparisonSection: \{ gap: 8, marginTop: 12 \}/);
assert.match(memberComparison, /fullPhotoDate\(primary\.localDate, locale\)/);

console.log("Photo comparison checks passed.");
