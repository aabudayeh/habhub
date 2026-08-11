import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

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
  `Health import dedupe passed: mirrored steps, legitimate meals, source controls, and 365-day fixture (${elapsed.toFixed(1)}ms).`,
);
