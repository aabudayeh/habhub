import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  authoritativeStepEntries,
  deduplicateHealthImportRecords,
  healthSourceId,
  localCalendarAggregateRange,
  manualStepEntriesEligibleForReplacement,
  preferredHealthSourceOrigin,
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

const webFallbackAndPhoneTotal = authoritativeStepEntries([
  { id: "web", value: 8_000 },
  { id: "phone", value: 8_350, sourceProvider: "health_connect" },
]);
assert.deepEqual(
  webFallbackAndPhoneTotal.map((entry) => entry.id),
  ["phone"],
  "a later device aggregate must replace, not add to, the web fallback",
);
assert.deepEqual(
  authoritativeStepEntries([{ id: "web", value: 8_000 }]).map(
    (entry) => entry.id,
  ),
  ["web"],
  "the web total must remain usable when no phone aggregate exists",
);

const existingImportedStep = {
  id: "phone-existing",
  value: 8_350,
  source: "imported",
  sourceProvider: "health_connect",
  sourceRecordId: "daily:2026-08-13",
};
const existingManualStep = {
  id: "web-old",
  value: 8_000,
  source: "manual",
};
const replacementCandidates = [existingImportedStep, existingManualStep];
const replacedManualRows = manualStepEntriesEligibleForReplacement(
  replacementCandidates,
);
const replacementTombstones = replacedManualRows.map((entry) => entry.id);
const replacedRows = new Set(replacedManualRows);
const afterWebReplacement = [
  ...replacementCandidates.filter((entry) => !replacedRows.has(entry)),
  { id: "web-new", value: 8_100, source: "manual" },
];
assert.deepEqual(replacementTombstones, ["web-old"]);
assert.ok(
  afterWebReplacement.some((entry) => entry.id === "phone-existing"),
  "manual web replacement must retain the imported Steps row",
);
assert.ok(
  !replacementTombstones.includes("phone-existing"),
  "manual web replacement must not tombstone the imported Steps row",
);
assert.deepEqual(
  authoritativeStepEntries(afterWebReplacement).map((entry) => entry.id),
  ["phone-existing"],
  "the imported phone total must remain the displayed authoritative Steps value",
);

const historicalChunk = localCalendarAggregateRange(
  new Date(2026, 7, 1, 14, 37),
  new Date(2026, 7, 8, 14, 37),
  new Date(2026, 7, 13, 12, 0),
);
assert.equal(historicalChunk.from.getHours(), 0);
assert.equal(historicalChunk.from.getDate(), 1);
assert.equal(historicalChunk.to.getHours(), 0);
assert.equal(
  historicalChunk.to.getDate(),
  9,
  "a midday backfill boundary must include the complete local calendar day",
);
const currentChunkEnd = new Date(2026, 7, 13, 12, 0);
assert.equal(
  localCalendarAggregateRange(
    new Date(2026, 7, 12, 8, 0),
    currentChunkEnd,
    currentChunkEnd,
  ).to.getTime(),
  currentChunkEnd.getTime(),
  "today's step aggregate must remain partial at the current instant",
);

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

const stepOrigins = [
  "com.google.android.apps.fitness",
  "com.android.healthconnect.phone.random",
  "com.sec.android.app.shealth",
];
assert.equal(
  preferredHealthSourceOrigin(stepOrigins, "steps"),
  "com.sec.android.app.shealth",
  "Samsung must be the canonical daily step source when it is enabled",
);
assert.equal(
  preferredHealthSourceOrigin(stepOrigins, "steps", {
    "samsung-health": {
      origin: "com.sec.android.app.shealth",
      enabled: false,
    },
  }),
  "com.google.android.apps.fitness",
  "a disabled Samsung source must fall through to the next enabled writer",
);

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
assert.match(
  androidHealthSource,
  /const stepRange = localCalendarAggregateRange\(from, to\)/,
  "daily step aggregation must align chunk reads to local calendar days",
);
assert.match(
  androidHealthSource,
  /const hasDisabledSource = preferences\.some/,
  "origin filtering must be reserved for an explicit user source opt-out",
);
assert.match(
  androidHealthSource,
  /hasDisabledSource && enabledOrigins\.length[\s\S]*dataOriginFilter: enabledOrigins/,
  "disabled writers must be excluded through Health Connect's inclusion filter",
);
assert.doesNotMatch(
  androidHealthSource,
  /dataOriginFilter: \[selectedOrigin\]/,
  "the default path must preserve Health Connect's Activity-priority dedupe",
);
assert.doesNotMatch(
  androidHealthSource,
  /readPages\("Steps",/,
  "step source discovery must not load thousands of granular records",
);
const logSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "log.tsx"),
  "utf8",
);
assert.match(
  logSource,
  /metric\.id !== "steps" \|\| Platform\.OS === "web"/,
  "web must expose Steps in the manual logger",
);
assert.match(
  logSource,
  /metric\.manualEntry !== false \|\|[\s\S]{0,100}metric\.id === "steps" && Platform\.OS === "web"/,
  "the device-owned Steps flag must not hide manual web entry",
);
const appProviderSource = fs.readFileSync(
  path.join(root, "src", "state", "AppProvider.tsx"),
  "utf8",
);
assert.match(
  appProviderSource,
  /const WEB_LOG_MANUAL_STEPS_CAPABILITY = Symbol\("web-log-manual-steps"\)/,
  "manual web Steps must use a private reducer capability",
);
assert.match(
  appProviderSource,
  /metric\?\.id === "steps"[\s\S]{0,300}action\.mode === "replace"[\s\S]{0,300}action\.manualDeviceEntryCapability ===[\s\S]{0,100}WEB_LOG_MANUAL_STEPS_CAPABILITY/,
  "the reducer must require the private capability for numeric replacement Steps",
);
assert.match(
  appProviderSource,
  /\(metric\?\.id === "steps" \|\| metric\?\.manualEntry === false\)[\s\S]{0,100}!authorizedWebSteps/,
  "all device-owned entries, including Steps, must be rejected without authorization",
);
assert.match(
  appProviderSource,
  /const entriesToReplace = authorizedWebSteps[\s\S]{0,100}manualStepEntriesEligibleForReplacement\(replacementCandidates\)[\s\S]{0,100}: replacementCandidates/,
  "authorized web Steps must replace only provenance-free manual candidates",
);
assert.match(
  appProviderSource,
  /const replacedEntryIds = entriesToReplace\.map\(\(entry\) => entry\.id\)/,
  "the deletion outbox must be derived from the protected replacement subset",
);
assert.match(
  appProviderSource,
  /Platform\.OS === "web"[\s\S]{0,200}metricId === "steps"[\s\S]{0,200}mode === "replace"[\s\S]{0,200}request\?\.source === "web-log-ui"[\s\S]{0,200}request\.deviceOwnedMetric === "steps"[\s\S]{0,200}\? WEB_LOG_MANUAL_STEPS_CAPABILITY/,
  "the provider must mint the reducer capability only for an explicit web Log Steps replacement",
);
assert.match(
  logSource,
  /selected\.id === "steps"[\s\S]{0,100}\{ source: "web-log-ui", deviceOwnedMetric: "steps" \}/,
  "the current Log save handler must explicitly request the manual web Steps capability",
);
const webLogCapabilityCallers = [];
for (const relativeRoot of ["app", "src"]) {
  const pending = [path.join(root, relativeRoot)];
  while (pending.length) {
    const current = pending.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) pending.push(absolute);
      else if (/\.[jt]sx?$/.test(item.name)) {
        if (absolute === path.join(root, "src", "state", "AppProvider.tsx"))
          continue;
        const source = fs.readFileSync(absolute, "utf8");
        if (source.includes('source: "web-log-ui"'))
          webLogCapabilityCallers.push(path.relative(root, absolute));
      }
    }
  }
}
assert.deepEqual(
  webLogCapabilityCallers,
  [path.join("app", "(tabs)", "log.tsx")],
  "no native, assistant, timer, or incidental caller may request the web Log Steps capability",
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
const healthProviderSource = fs.readFileSync(
  path.join(root, "src", "health", "HealthSyncProvider.tsx"),
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
assert.match(
  healthProviderSource,
  /restored\.connectionEnabled !== false[\s\S]{0,500}restored\.connectionEnabled === true[\s\S]{0,120}granted\?\.connected === false[\s\S]{0,260}connectionEnabled: false/,
  "startup must clear a cached Health connection after native permission revocation",
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
  `Health import validation passed: calendar-aligned platform step totals, web entry, source controls, body composition, and 365-day fixture (${elapsed.toFixed(1)}ms).`,
);
