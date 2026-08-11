import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  deduplicateHealthImportRecords,
  healthSourceId,
} from "../src/domain/healthDedup.ts";

const record = (overrides = {}) => ({
  id: "record",
  provider: "health_connect",
  type: "steps",
  startTime: "2026-08-10T00:00:00.000Z",
  endTime: "2026-08-10T23:59:00.000Z",
  value: 1,
  unit: "",
  origin: "com.sec.android.app.shealth",
  ...overrides,
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const mirroredSteps = deduplicateHealthImportRecords([
  record({ id: "samsung", value: 1254 }),
  record({
    id: "provider-copy",
    value: 1250,
    endTime: "2026-08-10T22:45:00.000Z",
    origin: "com.android.healthconnect.phone.jfc80621ae64c3742bec04fb03489f134",
  }),
]);
assert.equal(mirroredSteps.length, 1);
assert.equal(mirroredSteps[0].value, 1254);
assert.equal(healthSourceId(mirroredSteps[0].origin), "samsung-health");

const meals = deduplicateHealthImportRecords([
  record({
    id: "mfp-breakfast",
    type: "nutrition",
    startTime: "2026-08-10T08:00:00.000Z",
    endTime: "2026-08-10T08:00:00.000Z",
    value: 420,
    unit: "kcal",
    origin: "com.myfitnesspal.android",
    label: "Oats and yogurt",
    nutrition: { proteinG: 24, carbsG: 55, fatG: 10 },
  }),
  record({
    id: "samsung-breakfast-mirror",
    type: "nutrition",
    startTime: "2026-08-10T08:01:00.000Z",
    endTime: "2026-08-10T08:01:00.000Z",
    value: 421,
    unit: "kcal",
    origin: "com.sec.android.app.shealth",
    label: "Oats and yogurt",
    nutrition: { proteinG: 24, carbsG: 55, fatG: 10 },
  }),
  record({
    id: "mfp-lunch",
    type: "nutrition",
    startTime: "2026-08-10T13:00:00.000Z",
    endTime: "2026-08-10T13:00:00.000Z",
    value: 650,
    unit: "kcal",
    origin: "com.myfitnesspal.android",
    label: "Chicken and rice",
    nutrition: { proteinG: 42, carbsG: 75, fatG: 18 },
  }),
]);
assert.deepEqual(
  meals.map((item) => item.id).sort(),
  ["mfp-breakfast", "mfp-lunch"],
);

const weights = deduplicateHealthImportRecords([
  record({ id: "scale", type: "weight", startTime: "2026-08-10T07:00:00.000Z", endTime: "2026-08-10T07:00:00.000Z", value: 80.1, unit: "kg", origin: "com.vendor.scale" }),
  record({ id: "system-mirror", type: "weight", startTime: "2026-08-10T07:02:00.000Z", endTime: "2026-08-10T07:02:00.000Z", value: 80.1, unit: "kg", origin: "com.android.healthconnect.phone.random" }),
  record({ id: "evening-weight", type: "weight", startTime: "2026-08-10T20:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z", value: 81, unit: "kg", origin: "com.vendor.scale" }),
]);
assert.deepEqual(weights.map((item) => item.id).sort(), ["evening-weight", "scale"]);

const composition = deduplicateHealthImportRecords([
  record({ id: "scale-water", type: "body_water_mass", startTime: "2026-08-10T07:00:00.000Z", endTime: "2026-08-10T07:00:00.000Z", value: 45.2, unit: "kg", origin: "com.vendor.scale" }),
  record({ id: "water-mirror", type: "body_water_mass", startTime: "2026-08-10T07:02:00.000Z", endTime: "2026-08-10T07:02:00.000Z", value: 45.2, unit: "kg", origin: "com.android.healthconnect.phone.random" }),
  record({ id: "scale-bone", type: "bone_mass", startTime: "2026-08-10T07:00:00.000Z", endTime: "2026-08-10T07:00:00.000Z", value: 3.4, unit: "kg", origin: "com.vendor.scale" }),
  record({ id: "bone-mirror", type: "bone_mass", startTime: "2026-08-10T07:02:00.000Z", endTime: "2026-08-10T07:02:00.000Z", value: 3.4, unit: "kg", origin: "com.android.healthconnect.phone.random" }),
]);
assert.deepEqual(
  composition.map((item) => item.id).sort(),
  ["scale-bone", "scale-water"],
  "mirrored body-water and bone measurements must deduplicate independently",
);

const androidHealthSource = fs.readFileSync(
  path.join(root, "src", "health", "healthConnect.android.ts"),
  "utf8",
);
const appleHealthSource = fs.readFileSync(
  path.join(root, "src", "health", "appleHealth.ios.ts"),
  "utf8",
);
const seedSource = fs.readFileSync(
  path.join(root, "src", "data", "seed.ts"),
  "utf8",
);
const settingsSource = fs.readFileSync(
  path.join(root, "app", "settings.tsx"),
  "utf8",
);
const metricEditorSource = fs.readFileSync(
  path.join(root, "app", "metric-editor.tsx"),
  "utf8",
);
const healthMappingSource = fs.readFileSync(
  path.join(root, "src", "domain", "health.ts"),
  "utf8",
);
const appConfig = fs.readFileSync(path.join(root, "app.json"), "utf8");
for (const [dataType, recordType, permission] of [
  ["body_water_mass", "BodyWaterMass", "READ_BODY_WATER_MASS"],
  ["bone_mass", "BoneMass", "READ_BONE_MASS"],
]) {
  assert.match(
    androidHealthSource,
    new RegExp(`${dataType}: "${recordType}"`),
    `${recordType} must be requested and read from Health Connect`,
  );
  assert.match(
    androidHealthSource,
    new RegExp(`type === "${dataType}"|type === "body_water_mass" \\|\\| type === "bone_mass"`),
    `${recordType} must convert native mass to kilograms`,
  );
  assert.match(
    appConfig,
    new RegExp(`android\\.permission\\.health\\.${permission}`),
    `${recordType} must declare its Android read permission`,
  );
  assert.match(
    seedSource,
    new RegExp(`${dataType}: \\{ dataType: "${dataType}", field: "value" \\}`),
    `${dataType} must be available as a default mapped metric`,
  );
  assert.match(
    healthMappingSource,
    new RegExp(`record\\.type === '${dataType}'[\\s\\S]{0,180}'${dataType}'`),
    `${dataType} records must produce their canonical tracker entries`,
  );
}
assert.doesNotMatch(
  appleHealthSource,
  /BodyWaterMass|BoneMass/,
  "unsupported body-water and bone identifiers must not be requested from HealthKit",
);
assert.match(
  settingsSource,
  /id: "body_water_mass"[\s\S]{0,260}platforms: \["android"\][\s\S]{0,260}id: "bone_mass"[\s\S]{0,260}platforms: \["android"\]/,
  "HealthKit must not offer Android-only body-composition permissions",
);
assert.match(
  metricEditorSource,
  /id: "body_water_mass"[\s\S]{0,220}platforms: \["android"\][\s\S]{0,220}id: "bone_mass"[\s\S]{0,220}platforms: \["android"\][\s\S]*const AVAILABLE_SOURCES = SOURCES\.filter/,
  "custom tracker mappings must expose the new records only on Android",
);

const phoneOnly = deduplicateHealthImportRecords(
  [
    record({ id: "samsung", value: 1254 }),
    record({ id: "phone", value: 1250, origin: "com.android.healthconnect.phone.random" }),
  ],
  {
    "samsung-health": { origin: "com.sec.android.app.shealth", enabled: false },
    "health-connect-device": { origin: "com.android.healthconnect.phone.random", enabled: true },
  },
);
assert.equal(phoneOnly.length, 1);
assert.equal(phoneOnly[0].value, 1250);

const year = [];
for (let day = 0; day < 365; day += 1) {
  const key = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
  year.push(
    record({ id: `samsung-${key}`, startTime: `${key}T00:00:00.000Z`, endTime: `${key}T23:59:00.000Z`, value: 7000 + day }),
    record({ id: `mirror-${key}`, startTime: `${key}T00:00:00.000Z`, endTime: `${key}T23:58:00.000Z`, value: 6998 + day, origin: "com.android.healthconnect.phone.install-hash" }),
  );
}
const started = performance.now();
const normalizedYear = deduplicateHealthImportRecords(year);
const elapsed = performance.now() - started;
assert.equal(normalizedYear.length, 365);
assert.ok(elapsed < 1000, `Year dedupe took ${elapsed.toFixed(1)}ms`);

console.log(
  `Health import validation passed: mirrored steps/body composition, source controls, platform support, and 365-day fixture (${elapsed.toFixed(1)}ms).`,
);
