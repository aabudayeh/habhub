import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  authoritativeHealthConnectStepGroups,
  authoritativeStepEntries,
  aggregateRangeThroughLocalDate,
  combineDisjointStepWindows,
  currentDayStepFloorsForEmptyReplacement,
  deduplicateHealthImportRecords,
  healthSourceId,
  historicalStepRepairStart,
  isCanonicalHealthConnectStepAggregate,
  isDailyStepReplacementCandidate,
  localCalendarAggregateRange,
  manualStepEntriesEligibleForReplacement,
  mergeLocalCurrentDayDeviceStepEntries,
  partitionStepAggregateRange,
  preserveCurrentDayStepFloor,
  preserveCurrentDayStepReplacementFloor,
  preserveUnchangedDailyAggregateRevision,
  preserveUnchangedStepFallback,
  preferredHealthSourceOrigin,
  reconcileCurrentDayStepTotal,
  replaceCanonicalStepAggregateForDay,
  resolveCurrentDeviceStepOrigins,
  selectCanonicalHealthConnectStepAggregate,
  stepRepairRangeCovered,
} from "../src/domain/healthDedup.ts";
import { reconcileGoogleHealthNativeMirrors } from "../src/domain/health.ts";
import {
  HEALTH_PHYSICAL_ACTIVITY_MIGRATION_VERSION,
  healthPhysicalActivityMigrationKey,
} from "../src/health/constants.ts";

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
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.equal(
  packageManifest.dependencies?.["react-native-health-connect"],
  "4.1.3",
  "Android health reads must use the production-stable Health Connect client wrapper",
);
assert.notEqual(
  healthPhysicalActivityMigrationKey("account-a"),
  healthPhysicalActivityMigrationKey("account-b"),
  "the Physical Activity migration marker must be scoped per account",
);
assert.match(
  healthPhysicalActivityMigrationKey("account-a"),
  new RegExp(`:v${HEALTH_PHYSICAL_ACTIVITY_MIGRATION_VERSION}:account-a$`),
  "the Physical Activity migration marker must be versioned for future native changes",
);

const platformPriorityAggregate = [
  { localDate: "2026-08-13", count: 3_435, origin: "Health Connect" },
];
const laggingSamsungExport = [
  { localDate: "2026-08-13", count: 2_917, origin: "Samsung Health" },
];
assert.equal(
  authoritativeHealthConnectStepGroups(
    platformPriorityAggregate,
    laggingSamsungExport,
  )[0].count,
  3_435,
  "a lower Samsung-filtered export must not replace Health Connect's priority-aware total",
);
assert.equal(
  authoritativeHealthConnectStepGroups(platformPriorityAggregate)[0].count,
  3_435,
  "the unfiltered platform aggregate must remain authoritative without vendor metadata",
);
const refreshedCurrentDay = replaceCanonicalStepAggregateForDay(
  [
    record({ id: "yesterday", localDate: "2026-08-12", value: 8_000 }),
    record({
      id: "period-today",
      localDate: "2026-08-13",
      value: 2_917,
    }),
  ],
  "2026-08-13",
  record({ id: "direct-today", localDate: "2026-08-13", value: 3_435 }),
);
assert.deepEqual(
  refreshedCurrentDay.map(({ id, value }) => [id, value]),
  [
    ["yesterday", 8_000],
    ["direct-today", 3_435],
  ],
  "the fresh direct aggregate must replace, never add to, today's period bucket",
);
assert.deepEqual(
  combineDisjointStepWindows(5_000, 140),
  5_140,
  "a first-day subscription must combine only the pre-subscription Health Connect prefix and local-phone suffix",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(5_000, 5_140),
  { count: 5_000, usedLocalPhone: false, usedAndroidDevice: false },
  "a positive priority-aware Health Connect aggregate must not be overridden by a phone-only total",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(6_200, 5_140),
  { count: 6_200, usedLocalPhone: false, usedAndroidDevice: false },
  "a larger priority-aware phone/watch/app aggregate must remain canonical",
);
assert.equal(
  reconcileCurrentDayStepTotal(5_000, 5_140).count,
  5_000,
  "overlapping Health Connect and phone totals must never be summed",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(27, 27, 54),
  { count: 27, usedLocalPhone: false, usedAndroidDevice: false },
  "a source-filtered Android-device aggregate must not bypass Health Connect Activity priority",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(2_887, 3_072, 3_072),
  { count: 2_887, usedLocalPhone: false, usedAndroidDevice: false },
  "the authoritative 2,887 total must correct a larger 3,072 phone-local candidate",
);
const scopedPhoneOrigin =
  "com.android.healthconnect.phone.a1b2c3d4e5f607182930";
assert.deepEqual(
  resolveCurrentDeviceStepOrigins(
    ["android"],
    ["com.sec.android.app.shealth", scopedPhoneOrigin],
  ),
  ["android", scopedPhoneOrigin],
  "an SPN exposed by the current aggregate must repair native discovery that returned only the legacy android origin",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(0, null, 54),
  { count: 54, usedLocalPhone: false, usedAndroidDevice: true },
  "the aggregate-discovered SPN candidate may recover an empty unfiltered read",
);
assert.deepEqual(
  reconcileCurrentDayStepTotal(0, 54, null),
  { count: 54, usedLocalPhone: true, usedAndroidDevice: false },
  "Local Recording may recover an empty unfiltered read",
);
const authoritativeAggregateWithDisabledContributor =
  deduplicateHealthImportRecords(
    [
      record({
        id: "aggregate:steps:2026-08-13",
        localDate: "2026-08-13",
        value: 3_435,
      }),
    ],
    {
      "samsung-health": {
        origin: "com.sec.android.app.shealth",
        enabled: false,
      },
    },
  );
assert.equal(
  authoritativeAggregateWithDisabledContributor[0]?.value,
  3_435,
  "a shared disabled-source preference must not discard the platform Steps aggregate",
);
const mappedCanonicalAggregate = deduplicateHealthImportRecords([
  record({
    id: "aggregate:steps:2026-08-13",
    localDate: "2026-08-13",
    value: 3_435,
    updatedAt: "2026-08-13T12:00:00.000Z",
  }),
]);
assert.equal(
  mappedCanonicalAggregate[0]?.id,
  "aggregate:steps:2026-08-13",
  "canonical Health Connect aggregate identity must survive normalization",
);
assert.equal(
  isCanonicalHealthConnectStepAggregate(mappedCanonicalAggregate[0]?.id),
  true,
  "the shared canonical identity helper must recognize the normalized aggregate",
);
const selectedMappedAggregate = selectCanonicalHealthConnectStepAggregate([
  {
    sourceRecordId: "daily:2026-08-13:samsung-health",
    recordedAt: "2026-08-13T12:00:00.000Z",
    value: 2_917,
  },
  {
    sourceRecordId: mappedCanonicalAggregate[0]?.id,
    recordedAt: "2026-08-13T12:00:00.000Z",
    value: 3_435,
  },
]);
assert.equal(
  selectedMappedAggregate?.value,
  3_435,
  "runtime canonical selection must ignore a lower legacy writer total",
);
const nativeAndGoogleCanonicalSteps = [
  {
    id: "native-54",
    metricId: "steps",
    userId: "owner",
    localDate: "2026-08-13",
    source: "imported",
    sourceProvider: "health_connect",
    sourceRecordId: "aggregate:steps:2026-08-13",
    recordedAt: "2026-08-13T08:00:00.000Z",
    sourceUpdatedAt: "2026-08-13T08:00:00.000Z",
    value: 54,
  },
  {
    id: "google-27",
    metricId: "steps",
    userId: "owner",
    localDate: "2026-08-13",
    source: "imported",
    sourceProvider: "google_health",
    sourceRecordId: "aggregate:steps:2026-08-13",
    recordedAt: "2026-08-13T08:05:00.000Z",
    sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
    value: 27,
  },
];
assert.equal(
  selectCanonicalHealthConnectStepAggregate(nativeAndGoogleCanonicalSteps)
    ?.value,
  54,
  "a later lower Google rollup must not replace the native canonical Steps total",
);
assert.equal(
  authoritativeStepEntries(nativeAndGoogleCanonicalSteps)[0]?.value,
  54,
  "rendered Steps must prefer Health Connect over a later lower Google rollup",
);
const stepMetric = {
  id: "steps",
  healthMapping: { dataType: "steps", field: "value" },
};
for (const coexistenceOrder of [
  nativeAndGoogleCanonicalSteps,
  [...nativeAndGoogleCanonicalSteps].reverse(),
]) {
  const reconciled = reconcileGoogleHealthNativeMirrors(
    coexistenceOrder,
    [stepMetric],
    undefined,
    "owner",
  );
  assert.deepEqual(
    reconciled.map((entry) => [entry.sourceProvider, entry.value]),
    [["health_connect", 54]],
    "native Steps ownership must remove a mirrored Google fallback in either arrival order",
  );
}

const foodMetric = {
  id: "food",
  healthMapping: { dataType: "nutrition", field: "value" },
};
const googleMeal = {
  id: "google-meal",
  metricId: "food",
  userId: "owner",
  localDate: "2026-08-13",
  recordedAt: "2026-08-13T12:00:00.000Z",
  value: 500,
  label: "Lunch",
  nutrition: { proteinG: 30, carbsG: 55, fatG: 18 },
  visibility: "group",
  source: "imported",
  sourceProvider: "google_health",
  sourceRecordId: "google-health:nutrition:meal",
  sourceOrigin: "Google Health API",
};
const nativeMeal = {
  ...googleMeal,
  id: "native-meal",
  sourceProvider: "health_connect",
  sourceRecordId: "health-connect:nutrition:meal",
  sourceOrigin: "Health Connect",
};
const separateMeal = {
  ...googleMeal,
  id: "google-dinner",
  recordedAt: "2026-08-13T18:00:00.000Z",
  value: 300,
  label: "Dinner",
  sourceRecordId: "google-health:nutrition:dinner",
};
const manualMeal = {
  ...googleMeal,
  id: "manual-snack",
  recordedAt: "2026-08-13T15:00:00.000Z",
  value: 100,
  label: "Snack",
  source: "manual",
  sourceProvider: undefined,
  sourceRecordId: undefined,
  sourceOrigin: undefined,
};
for (const coexistenceOrder of [
  [googleMeal, nativeMeal, separateMeal, manualMeal],
  [nativeMeal, googleMeal, separateMeal, manualMeal],
]) {
  const reconciled = reconcileGoogleHealthNativeMirrors(
    coexistenceOrder,
    [foodMetric],
    undefined,
    "owner",
  );
  assert.deepEqual(
    new Set(reconciled.map((entry) => entry.id)),
    new Set(["native-meal", "google-dinner", "manual-snack"]),
    "native ownership must remove only the mirrored Google meal and preserve disjoint/manual rows",
  );
  assert.equal(
    reconciled.reduce((sum, entry) => sum + Number(entry.value || 0), 0),
    900,
    "coexisting native and Google imports must not double the mirrored meal total",
  );
}

const requiredHistoricalStart = new Date(2025, 7, 13, 0, 0);
const rangeCoverageNow = new Date(2026, 7, 13, 12, 0);
assert.equal(
  stepRepairRangeCovered(
    requiredHistoricalStart,
    new Date(2026, 4, 15, 0, 0),
    rangeCoverageNow,
    rangeCoverageNow,
  ),
  false,
  "a shorter generic history backfill must not claim older Steps are repaired",
);
assert.equal(
  stepRepairRangeCovered(
    requiredHistoricalStart,
    new Date(2025, 7, 13, 0, 0),
    rangeCoverageNow,
    rangeCoverageNow,
  ),
  true,
  "a generic history backfill may claim the repair only after covering both bounds",
);

const manualFallbackAndPhoneTotal = authoritativeStepEntries([
  { id: "manual", value: 8_000 },
  { id: "phone", value: 8_350, sourceProvider: "health_connect" },
]);
assert.deepEqual(
  manualFallbackAndPhoneTotal.map((entry) => entry.id),
  ["phone"],
  "legacy rows without revisions must prefer the device aggregate, never add both",
);
assert.deepEqual(
  authoritativeStepEntries([{ id: "manual", value: 8_000 }]).map(
    (entry) => entry.id,
  ),
  ["manual"],
  "a manual daily total must remain usable when no device aggregate exists",
);

const importedBeforeOverride = {
  id: "phone-before-override",
  value: 8_350,
  sourceProvider: "health_connect",
  sourceUpdatedAt: "2026-08-13T08:00:00.000Z",
};
const manualOverride = {
  id: "manual-override",
  value: 8_100,
  source: "manual",
  sourceUpdatedAt: "2026-08-13T09:00:00.000Z",
};
assert.deepEqual(
  authoritativeStepEntries([importedBeforeOverride, manualOverride]).map(
    (entry) => entry.id,
  ),
  ["manual-override"],
  "a newer manual APK/web entry must immediately override the daily device total",
);
assert.deepEqual(
  authoritativeStepEntries([
    importedBeforeOverride,
    manualOverride,
    {
      ...importedBeforeOverride,
      id: "phone-after-override",
      value: 8_420,
      sourceUpdatedAt: "2026-08-13T09:05:00.000Z",
    },
  ]).map((entry) => entry.id),
  ["phone-after-override"],
  "a later device sync must reclaim authority without adding the manual total",
);

const existingImportedStep = {
  id: "phone-existing",
  value: 8_350,
  source: "imported",
  sourceProvider: "health_connect",
  sourceRecordId: "daily:2026-08-13",
  sourceUpdatedAt: "2026-08-13T08:00:00.000Z",
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
  {
    id: "manual-new",
    value: 8_100,
    source: "manual",
    sourceUpdatedAt: "2026-08-13T09:00:00.000Z",
  },
];
assert.deepEqual(replacementTombstones, ["web-old"]);
assert.ok(
  afterWebReplacement.some((entry) => entry.id === "phone-existing"),
  "manual replacement must retain the imported Steps row in storage",
);
assert.ok(
  !replacementTombstones.includes("phone-existing"),
  "manual replacement must not tombstone the imported Steps row",
);
assert.deepEqual(
  authoritativeStepEntries(afterWebReplacement).map((entry) => entry.id),
  ["manual-new"],
  "the newer manual daily total must display without deleting the imported row",
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
const partitionedStepRange = partitionStepAggregateRange(
  {
    from: new Date(2026, 7, 12, 0, 0),
    to: currentChunkEnd,
  },
  currentChunkEnd,
);
assert.equal(
  partitionedStepRange.historical?.to.getTime(),
  new Date(2026, 7, 13, 0, 0).getTime(),
  "completed step buckets must end at today's local midnight",
);
assert.equal(
  partitionedStepRange.current?.from.getTime(),
  new Date(2026, 7, 13, 0, 0).getTime(),
  "today's direct aggregate must start at local midnight",
);
assert.equal(
  partitionedStepRange.current?.to.getTime(),
  currentChunkEnd.getTime(),
  "today's direct aggregate must never read beyond the captured current time",
);
assert.equal(partitionedStepRange.current?.localDate, "2026-08-13");
const midnightPartition = partitionStepAggregateRange(
  {
    from: new Date(2026, 7, 12, 0, 0),
    to: new Date(2026, 7, 13, 0, 0),
  },
  new Date(2026, 7, 13, 0, 0),
);
assert.equal(
  midnightPartition.current,
  undefined,
  "an exclusive midnight range must not synthesize a zero row for the new day",
);
const exclusiveMidnight = new Date(2026, 7, 13, 0, 0, 0, 0);
assert.equal(
  aggregateRangeThroughLocalDate(exclusiveMidnight),
  "2026-08-12",
  "an exclusive local-midnight end must replace only the preceding day",
);
assert.equal(
  aggregateRangeThroughLocalDate(currentChunkEnd),
  "2026-08-13",
  "a partial current-day aggregate must replace today's local bucket",
);

const replacementWindow = {
  userId: "owner",
  provider: "health_connect",
  stepMetricIds: new Set(["steps"]),
  fromDate: "2026-08-10",
  throughDate: "2026-08-13",
  includeFallbacks: true,
};
assert.equal(
  isDailyStepReplacementCandidate(
    {
      userId: "owner",
      metricId: "steps",
      localDate: "2026-08-13",
      sourceProvider: "health_connect",
    },
    replacementWindow,
  ),
  true,
);
assert.equal(
  isDailyStepReplacementCandidate(
    {
      userId: "owner",
      metricId: "steps",
      localDate: "2026-08-13",
      source: "imported",
      sourceRecordId: "aggregate:steps:2026-08-13",
    },
    replacementWindow,
  ),
  true,
  "providerless legacy imported aggregates must be repaired",
);
assert.equal(
  isDailyStepReplacementCandidate(
    {
      userId: "owner",
      metricId: "steps",
      localDate: "2026-08-13",
      source: "manual",
      sourceRecordId: "daily:2026-08-13:samsung-health",
    },
    replacementWindow,
  ),
  false,
  "an explicit manual row must survive even if a legacy id resembles an import",
);
assert.equal(
  isDailyStepReplacementCandidate(
    {
      userId: "owner",
      metricId: "exercise",
      localDate: "2026-08-13",
      sourceProvider: "health_connect",
      sourceRecordId: "step-fallback:2026-08-13",
    },
    replacementWindow,
  ),
  true,
  "a refreshed zero-step day must clear its stale calculated fallback",
);
assert.equal(
  isDailyStepReplacementCandidate(
    {
      userId: "owner",
      metricId: "steps",
      localDate: "2026-08-13",
    },
    replacementWindow,
  ),
  false,
  "manual daily Steps must survive native aggregate replacement",
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

const timezoneSafeSteps = deduplicateHealthImportRecords([
  record({
    id: "late-samsung",
    localDate: "2026-08-10",
    startTime: "2026-08-10T22:30:00.000Z",
    endTime: "2026-08-10T23:30:00.000Z",
    value: 900,
  }),
  record({
    id: "post-midnight-mirror",
    localDate: "2026-08-10",
    startTime: "2026-08-11T00:00:00.000+02:00",
    endTime: "2026-08-11T01:30:00.000+02:00",
    value: 898,
    origin: "com.android.healthconnect.phone.random",
  }),
]);
assert.equal(
  timezoneSafeSteps.length,
  1,
  "the Health Connect local bucket date must win over UTC string slicing",
);
assert.equal(timezoneSafeSteps[0].localDate, "2026-08-10");

const stableAggregate = {
  id: "health:health_connect:steps:aggregate:steps:2026-08-13:steps",
  metricId: "steps",
  userId: "owner",
  localDate: "2026-08-13",
  sourceProvider: "health_connect",
  sourceRecordId: "aggregate:steps:2026-08-13",
  sourceUpdatedAt: "2026-08-13T08:00:00.000Z",
  value: 3_435,
};
assert.equal(
  preserveUnchangedDailyAggregateRevision(stableAggregate, {
    ...stableAggregate,
    sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
  }),
  stableAggregate,
  "an unchanged re-read must retain object identity and not trigger a render",
);
assert.equal(
  preserveUnchangedDailyAggregateRevision(stableAggregate, {
    ...stableAggregate,
    sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
    value: 3_512,
  }).sourceUpdatedAt,
  "2026-08-13T08:05:00.000Z",
  "a changed partial-day aggregate must receive the latest sync revision",
);
const correctedLiveAggregate = preserveCurrentDayStepFloor(
  { ...stableAggregate, value: 3_072 },
  {
    ...stableAggregate,
    sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
    value: 2_887,
  },
  "2026-08-13",
);
assert.equal(
  correctedLiveAggregate.value,
  2_887,
  "a positive unfiltered Health Connect correction must update today's 3,072 display to 2,887",
);
assert.equal(
  correctedLiveAggregate.sourceUpdatedAt,
  "2026-08-13T08:05:00.000Z",
  "a positive downward correction must retain its new authoritative revision",
);
assert.equal(
  preserveCurrentDayStepFloor(
    stableAggregate,
    {
      ...stableAggregate,
      sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
      value: 0,
    },
    "2026-08-13",
  ),
  stableAggregate,
  "a transient zero read must not erase today's confirmed aggregate",
);
assert.equal(
  preserveCurrentDayStepFloor(
    stableAggregate,
    {
      ...stableAggregate,
      sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
      value: 3_600,
    },
    "2026-08-13",
  ).value,
  3_600,
  "a higher current-day refresh must remain publishable",
);
assert.equal(
  preserveCurrentDayStepFloor(
    stableAggregate,
    {
      ...stableAggregate,
      sourceUpdatedAt: "2026-08-14T00:05:00.000Z",
      value: 1_700,
    },
    "2026-08-14",
  ).value,
  1_700,
  "after day rollover Health Connect must be allowed to correct a historical total downward",
);
const legacyAndroidDeviceTotal = {
  ...stableAggregate,
  id: "health:health_connect:steps:legacy-device-row:steps",
  source: "imported",
  sourceRecordId: "legacy-device-row",
  sourceOrigin: "com.android.healthconnect.phone.scoped",
  recordedAt: "2026-08-13T08:00:00.000Z",
  value: 27,
};
const migratedCurrentDayTotal = preserveCurrentDayStepReplacementFloor(
  [
    legacyAndroidDeviceTotal,
    {
      ...legacyAndroidDeviceTotal,
      id: "health:health_connect:steps:legacy-device-row-2:steps",
      sourceRecordId: "legacy-device-row-2",
      recordedAt: "2026-08-13T08:01:00.000Z",
    },
  ],
  {
    ...stableAggregate,
    source: "imported",
    sourceOrigin: "Health Connect",
    sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
    value: 27,
  },
  "2026-08-13",
);
assert.equal(
  migratedCurrentDayTotal.value,
  27,
  "a positive canonical aggregate must replace summed legacy source rows",
);
assert.equal(
  migratedCurrentDayTotal.sourceRecordId,
  "aggregate:steps:2026-08-13",
  "the migration floor must adopt canonical identity so later refreshes converge",
);
assert.equal(
  migratedCurrentDayTotal.sourceOrigin,
  "Health Connect",
  "the canonical migration must retain authoritative Health Connect attribution",
);
const emptyLiveReadFloor = currentDayStepFloorsForEmptyReplacement(
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Android phone (live)",
      value: 54,
    },
  ],
  [],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
assert.equal(
  emptyLiveReadFloor[0]?.value,
  54,
  "a transiently empty successful live read must not erase today's confirmed 54 steps",
);
assert.equal(
  currentDayStepFloorsForEmptyReplacement(
    [
      {
        ...stableAggregate,
        localDate: "2026-08-12",
        sourceRecordId: "aggregate:steps:2026-08-12",
        source: "imported",
        value: 54,
      },
    ],
    [],
    {
      userId: "owner",
      currentLocalDate: "2026-08-13",
      stepMetricIds: new Set(["steps"]),
    },
  ).length,
  0,
  "an empty read must not floor a completed day so historical corrections remain possible",
);
assert.equal(
  currentDayStepFloorsForEmptyReplacement(
    [
      {
        ...stableAggregate,
        source: "calculated",
        sourceRecordId: "step-fallback:2026-08-13",
        value: 54,
      },
    ],
    [],
    {
      userId: "owner",
      currentLocalDate: "2026-08-13",
      stepMetricIds: new Set(["steps"]),
    },
  ).length,
  0,
  "calculated step fallbacks must still be cleared by an empty aggregate refresh",
);
const cloudRestartEntries = mergeLocalCurrentDayDeviceStepEntries(
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Health Connect",
      value: 27,
    },
    {
      id: "remote-manual",
      metricId: "steps",
      userId: "owner",
      localDate: "2026-08-13",
      source: "manual",
      value: 60,
    },
    {
      ...stableAggregate,
      id: "remote-history",
      localDate: "2026-08-12",
      sourceRecordId: "aggregate:steps:2026-08-12",
      source: "imported",
      sourceOrigin: "Health Connect",
      value: 90,
    },
  ],
  [
    legacyAndroidDeviceTotal,
    {
      ...legacyAndroidDeviceTotal,
      id: "health:health_connect:steps:legacy-device-row-2:steps",
      sourceRecordId: "legacy-device-row-2",
      recordedAt: "2026-08-13T08:01:00.000Z",
    },
    {
      ...stableAggregate,
      id: "local-history",
      localDate: "2026-08-12",
      sourceRecordId: "aggregate:steps:2026-08-12",
      source: "imported",
      sourceOrigin: "Android phone (live)",
      value: 120,
    },
  ],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
assert.equal(
  cloudRestartEntries.find(
    (entry) =>
      entry.localDate === "2026-08-13" &&
      entry.sourceRecordId === "aggregate:steps:2026-08-13",
  )?.value,
  27,
  "a positive native canonical cloud row may correct a higher legacy local source sum",
);
assert.equal(
  cloudRestartEntries.find((entry) => entry.id === "remote-manual")?.value,
  60,
  "cloud acceptance must not replace a manual current-day override",
);
assert.equal(
  cloudRestartEntries.find((entry) => entry.id === "remote-history")?.value,
  90,
  "cloud acceptance must not retain local device floors for completed days",
);
const dirtyCloudSteps = mergeLocalCurrentDayDeviceStepEntries(
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Health Connect",
      value: 27,
    },
  ],
  [
    legacyAndroidDeviceTotal,
    {
      ...legacyAndroidDeviceTotal,
      id: "health:health_connect:steps:legacy-device-row-2:steps",
      sourceRecordId: "legacy-device-row-2",
      recordedAt: "2026-08-13T08:01:00.000Z",
    },
  ],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
const dirtyCloudRenderedSteps = authoritativeStepEntries(dirtyCloudSteps);
assert.equal(
  dirtyCloudRenderedSteps[0]?.value,
  27,
  "a positive remote native canonical total must replace two higher local legacy rows",
);
assert.equal(
  dirtyCloudSteps.filter(
    (entry) => entry.source !== "manual" && entry.localDate === "2026-08-13",
  ).length,
  1,
  "the authoritative native cloud snapshot must not re-add competing local legacy rows",
);
const missingRemoteSteps = mergeLocalCurrentDayDeviceStepEntries(
  [],
  [
    legacyAndroidDeviceTotal,
    {
      ...legacyAndroidDeviceTotal,
      id: "health:health_connect:steps:legacy-device-row-2:steps",
      sourceRecordId: "legacy-device-row-2",
      recordedAt: "2026-08-13T08:01:00.000Z",
    },
  ],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
assert.equal(
  authoritativeStepEntries(missingRemoteSteps)[0]?.value,
  54,
  "a clean snapshot missing Steps entirely must retain the local 54 display total",
);
assert.equal(
  missingRemoteSteps.length,
  1,
  "a missing clean snapshot must converge legacy intervals to one imported row",
);
assert.equal(
  missingRemoteSteps[0]?.sourceRecordId,
  "aggregate:steps:2026-08-13",
  "the retained 54 floor must converge on canonical aggregate identity",
);
const cloudRestartMultiSource = mergeLocalCurrentDayDeviceStepEntries(
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Health Connect",
      value: 27,
    },
  ],
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Health Connect",
      value: 54,
    },
  ],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
assert.equal(
  cloudRestartMultiSource[0]?.value,
  27,
  "a positive native cloud correction must be accepted even when the local canonical total is higher",
);
const nativeAndGoogleSameAccountSteps = mergeLocalCurrentDayDeviceStepEntries(
  [
    {
      ...stableAggregate,
      id: "health:google_health:steps:aggregate:steps:2026-08-13:steps",
      source: "imported",
      sourceProvider: "google_health",
      sourceOrigin: "Google Health",
      sourceUpdatedAt: "2026-08-13T08:10:00.000Z",
      value: 4_000,
    },
  ],
  [
    {
      ...stableAggregate,
      source: "imported",
      sourceOrigin: "Health Connect",
      sourceUpdatedAt: "2026-08-13T08:05:00.000Z",
      value: 2_887,
    },
  ],
  {
    userId: "owner",
    currentLocalDate: "2026-08-13",
    stepMetricIds: new Set(["steps"]),
  },
);
assert.equal(
  nativeAndGoogleSameAccountSteps[0]?.sourceProvider,
  "health_connect",
  "an APK Health Connect total must outrank a Google web total for the same account",
);
assert.equal(
  nativeAndGoogleSameAccountSteps[0]?.value,
  2_887,
  "Google web sync must not add to or replace the native APK aggregate",
);
const unchangedCloudSteps = [
  {
    ...stableAggregate,
    source: "imported",
    sourceOrigin: "Health Connect",
    value: 54,
  },
];
assert.equal(
  mergeLocalCurrentDayDeviceStepEntries(
    unchangedCloudSteps,
    [
      {
        ...stableAggregate,
        source: "imported",
        sourceOrigin: "Health Connect",
        value: 27,
      },
    ],
    {
      userId: "owner",
      currentLocalDate: "2026-08-13",
      stepMetricIds: new Set(["steps"]),
    },
  ),
  unchangedCloudSteps,
  "a no-op cloud Steps guard must preserve entry-array identity",
);
const stableFallback = {
  id: "fallback",
  metricId: "exercise",
  userId: "owner",
  localDate: "2026-08-13",
  recordedAt: "2026-08-13T08:00:00.000Z",
  source: "calculated",
  sourceProvider: "health_connect",
  sourceRecordId: "step-fallback:2026-08-13",
  sourceOrigin: "Health Connect",
  visibility: "group",
  value: 123,
  label: "Estimated unrecorded walking from steps",
  note: "Uses 3,435 steps",
};
assert.equal(
  preserveUnchangedStepFallback(stableFallback, {
    ...stableFallback,
    recordedAt: "2026-08-13T08:05:00.000Z",
  }),
  stableFallback,
  "an unchanged derived Steps row must retain identity across refresh reads",
);
assert.notEqual(
  preserveUnchangedStepFallback(stableFallback, {
    ...stableFallback,
    value: 125,
  }),
  stableFallback,
  "a changed derived Steps value must remain publishable",
);

const repairNow = new Date(2026, 7, 13, 12);
assert.equal(
  historicalStepRepairStart(
    repairNow,
    90,
    ["2025-08-20", "2026-08-10"],
  ).getTime(),
  new Date(2025, 7, 20).getTime(),
  "repair must retain an older already-imported day when settings were shortened",
);
const boundedRepair = historicalStepRepairStart(
  repairNow,
  90,
  ["2020-01-01"],
);
const maximumRepairStart = new Date(repairNow);
maximumRepairStart.setHours(0, 0, 0, 0);
maximumRepairStart.setDate(maximumRepairStart.getDate() - 730);
assert.equal(
  boundedRepair.getTime(),
  maximumRepairStart.getTime(),
  "repair must remain inside the app's 730-day Health Connect history bound",
);

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
    nutrition: {
      proteinG: 24,
      carbsG: 55,
      fatG: 10,
      vitaminCMg: 120,
    },
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
assert.equal(
  meals.find((item) => item.id === "mfp-breakfast")?.nutrition?.vitaminCMg,
  120,
  "a canonical duplicate meal must retain complementary normalized nutrients",
);

const disjointMicronutrients = deduplicateHealthImportRecords([
  record({
    id: "apple-vitamin-c",
    provider: "apple_health",
    type: "nutrition",
    startTime: "2026-08-10T09:00:00.000Z",
    endTime: "2026-08-10T09:00:00.000Z",
    value: 0,
    unit: "mg",
    origin: "com.vendor.food-a",
    nutrition: { vitaminCMg: 90 },
  }),
  record({
    id: "apple-iron",
    provider: "apple_health",
    type: "nutrition",
    startTime: "2026-08-10T09:02:00.000Z",
    endTime: "2026-08-10T09:02:00.000Z",
    value: 0,
    unit: "mg",
    origin: "com.vendor.food-b",
    nutrition: { ironMg: 12 },
  }),
]);
assert.deepEqual(
  disjointMicronutrients.map((item) => item.id).sort(),
  ["apple-iron", "apple-vitamin-c"],
  "nearby records with non-overlapping nutrient keys must both survive",
);
const mirroredVitaminC = deduplicateHealthImportRecords([
  record({
    id: "vitamin-c-primary",
    provider: "apple_health",
    type: "nutrition",
    startTime: "2026-08-10T10:00:00.000Z",
    endTime: "2026-08-10T10:00:00.000Z",
    value: 0,
    unit: "mg",
    origin: "com.myfitnesspal.ios",
    nutrition: { vitaminCMg: 90 },
  }),
  record({
    id: "vitamin-c-mirror",
    provider: "apple_health",
    type: "nutrition",
    startTime: "2026-08-10T10:01:00.000Z",
    endTime: "2026-08-10T10:01:00.000Z",
    value: 0,
    unit: "mg",
    origin: "com.vendor.food-b",
    nutrition: { vitaminCMg: 90.5 },
  }),
]);
assert.equal(
  mirroredVitaminC.length,
  1,
  "the same close nutrient from two writers is one mirrored dietary sample",
);
assert.deepEqual(
  new Set(mirroredVitaminC[0].sourceOrigins),
  new Set(["com.myfitnesspal.ios", "com.vendor.food-b"]),
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
  /const stepRange = localCalendarAggregateRange\(from, to, stepReadAt\)/,
  "daily step aggregation must align chunk reads to local calendar days",
);
assert.match(
  androidHealthSource,
  /partitionStepAggregateRange\([\s\S]{0,160}stepRange[\s\S]{0,160}stepReadAt/,
  "historical and current-day step reads must share one midnight-safe clock snapshot",
);
assert.match(
  androidHealthSource,
  /authoritativeHealthConnectStepGroups\(\s*unfilteredGroups,?\s*\)/,
  "Steps must preserve Health Connect's Activity-priority aggregate",
);
assert.match(
  androidHealthSource,
  /includesCurrentDay[\s\S]{0,1600}\? aggregateRecord\(\{[\s\S]{0,200}recordType: "Steps"/,
  "the partial current day must use a direct unfiltered aggregate",
);
assert.match(
  androidHealthSource,
  /readLocalPhoneSteps\(currentStart!, currentEnd!\)[\s\S]{0,9000}coverageStartEpochMs[\s\S]{0,1600}combineDisjointStepWindows\([\s\S]{0,300}reconcileCurrentDayStepTotal\([\s\S]{0,300}disjointPhoneCandidate[\s\S]{0,200}androidDeviceAggregate/,
  "today must retain empty-read fallbacks from Local Recording and the official Android-device aggregate",
);
assert.match(
  androidHealthSource,
  /authoritativeCurrentCount[\s\S]{0,240}needsPhoneFallback\s*=\s*[\s\S]{0,120}!\(authoritativeCurrentCount > 0\)[\s\S]{0,500}needsPhoneFallback\s*\?\s*await Promise\.all/,
  "phone-local reads must run only when the unfiltered current-day aggregate is empty",
);
assert.match(
  androidHealthSource,
  /LOCAL_PHONE_STEP_READ_TIMEOUT_MS = 1_500[\s\S]{0,1600}Promise\.race/,
  "the optional local recorder must never strand a Health Connect refresh",
);
assert.match(
  androidHealthSource,
  /return replaceCanonicalStepAggregateForDay\([\s\S]{0,200}historicalRecords[\s\S]{0,200}currentRecord/,
  "the current aggregate must replace rather than add to the historical period rows",
);
assert.match(
  androidHealthSource,
  /currentDeviceStepOrigins\(\)[\s\S]{0,2200}currentAggregate\?\.dataOrigins[\s\S]{0,2200}dataOriginFilter: androidDeviceOrigins/,
  "today must query Android's discovered phone-step origins rather than a hard-coded vendor",
);
assert.match(
  androidHealthSource,
  /discoverCurrentDeviceStepOriginsFromRaw[\s\S]{0,700}page < 3[\s\S]{0,500}pageSize: 500[\s\S]{0,500}hasCurrentDeviceStepSpn\(resolved\)/,
  "a bounded raw current-day read must recover the app-scoped SPN when the framework and aggregate omit it",
);
assert.match(
  androidHealthSource,
  /!hasCurrentDeviceStepSpn\(androidDeviceOrigins\)[\s\S]{0,900}discoverCurrentDeviceStepOriginsFromRaw/,
  "raw SPN discovery must run only when cheaper framework and aggregate discovery found no scoped phone origin",
);
assert.doesNotMatch(
  androidHealthSource,
  /dataOriginFilter:\s*\[[\s\S]{0,120}(?:samsung|shealth|com\.sec)/i,
  "Steps must never replace the platform total with a hard-coded third-party writer",
);
assert.match(
  androidHealthSource,
  /endTime: recordedAt,[\s\S]{0,500}localDate,[\s\S]{0,500}updatedAt: syncRevision/,
  "daily imports must preserve the local bucket date and sync revision",
);
assert.match(
  androidHealthSource,
  /if \(type === "steps"\) throw error/,
  "a failed cumulative aggregate must retain the previous confirmed value instead of guessing from raw writers",
);
const logSource = fs.readFileSync(
  path.join(root, "app", "(tabs)", "log.tsx"),
  "utf8",
);
assert.doesNotMatch(
  logSource,
  /metric\.id !== "steps" \|\| Platform\.OS === "web"/,
  "native Log must no longer hide manual Steps",
);
assert.match(
  logSource,
  /metric\.manualEntry !== false \|\| metric\.id === "steps"/,
  "the device-owned Steps flag must not hide manual APK or web entry",
);
const appProviderSource = fs.readFileSync(
  path.join(root, "src", "state", "AppProvider.tsx"),
  "utf8",
);
assert.match(
  appProviderSource,
  /const LOG_MANUAL_STEPS_CAPABILITY = Symbol\("log-manual-steps"\)/,
  "manual Steps must use a private reducer capability",
);
assert.match(
  appProviderSource,
  /metric\?\.id === "steps"[\s\S]{0,300}action\.mode === "replace"[\s\S]{0,300}action\.manualDeviceEntryCapability ===[\s\S]{0,100}LOG_MANUAL_STEPS_CAPABILITY/,
  "the reducer must require the private capability for numeric replacement Steps",
);
assert.match(
  appProviderSource,
  /\(metric\?\.id === "steps" \|\| metric\?\.manualEntry === false\)[\s\S]{0,100}!authorizedManualSteps/,
  "all device-owned entries, including Steps, must be rejected without authorization",
);
assert.match(
  appProviderSource,
  /const entriesToReplace = authorizedManualSteps[\s\S]{0,100}manualStepEntriesEligibleForReplacement\(replacementCandidates\)[\s\S]{0,100}: replacementCandidates/,
  "authorized manual Steps must replace only provenance-free manual candidates",
);
assert.match(
  appProviderSource,
  /const replacedEntryIds = entriesToReplace\.map\(\(entry\) => entry\.id\)/,
  "the deletion outbox must be derived from the protected replacement subset",
);
assert.match(
  appProviderSource,
  /metricId === "steps"[\s\S]{0,200}mode === "replace"[\s\S]{0,200}request\?\.source === "log-ui"[\s\S]{0,200}request\.deviceOwnedMetric === "steps"[\s\S]{0,200}\? LOG_MANUAL_STEPS_CAPABILITY/,
  "the provider must mint the reducer capability only for an explicit Log Steps replacement",
);
assert.match(
  logSource,
  /selected\.id === "steps"[\s\S]{0,100}\{ source: "log-ui", deviceOwnedMetric: "steps" \}/,
  "the current Log save handler must explicitly request the manual Steps capability",
);
const logCapabilityCallers = [];
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
        if (source.includes('source: "log-ui"'))
          logCapabilityCallers.push(path.relative(root, absolute));
      }
    }
  }
}
assert.deepEqual(
  logCapabilityCallers,
  [path.join("app", "(tabs)", "log.tsx")],
  "no assistant, timer, or incidental caller may request the Log Steps capability",
);
const localPersistenceChangedSource = fs.readFileSync(
  path.join(root, "src", "domain", "localPersistence.ts"),
  "utf8",
);
assert.doesNotMatch(localPersistenceChangedSource, /previous\.photos !== next\.photos/);
assert.doesNotMatch(localPersistenceChangedSource, /previous\.messages !== next\.messages/);
assert.match(
  localPersistenceChangedSource,
  /sameOwnedRowsByReference\([\s\S]{0,100}previous\.photos,[\s\S]{0,100}next\.photos/,
  "peer-only photo hydration must not serialize the monolithic local snapshot",
);
assert.match(
  localPersistenceChangedSource,
  /sameRowsByReference\([\s\S]{0,100}previous\.messages,[\s\S]{0,180}message\.senderId === next\.currentUserId/,
  "peer-only message hydration must not serialize the monolithic local snapshot",
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
const healthDedupSource = fs.readFileSync(
  path.join(root, "src", "domain", "healthDedup.ts"),
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
const backgroundHealthSource = fs.readFileSync(
  path.join(root, "src", "health", "background.native.ts"),
  "utf8",
);
const appConfig = fs.readFileSync(path.join(root, "app.json"), "utf8");
const androidNativeSource = fs.readFileSync(
  path.join(
    root,
    "plugins",
    "habhub-android",
    "java",
    "HabHubNativeModule.kt",
  ),
  "utf8",
);
const androidPluginSource = fs.readFileSync(
  path.join(root, "plugins", "withHabHubAndroid.js"),
  "utf8",
);
assert.match(
  appConfig,
  /android\.permission\.ACTIVITY_RECOGNITION/,
  "direct phone-step recording must declare Physical Activity access",
);
assert.match(
  androidHealthSource,
  /PermissionsAndroid\.request\(permission\)/,
  "Physical Activity access must be requested in the explicit health connection flow",
);
assert.match(
  androidHealthSource,
  /Number\(Platform\.Version\) >= 29[\s\S]{0,500}if \(!physicalActivityRuntimePermissionRequired\(\)\) return true/,
  "Android 8 and 9 must bypass the API-29-only Physical Activity runtime check",
);
assert.match(
  androidNativeSource,
  /LocalDataReadRequest\.Builder\(\)[\s\S]{0,300}\.read\(LocalDataType\.TYPE_STEP_COUNT_DELTA\)[\s\S]{0,700}getDataSet\(LocalDataType\.TYPE_STEP_COUNT_DELTA\)[\s\S]{0,900}getStartTime\(TimeUnit\.MILLISECONDS\)/,
  "the native bridge must read detailed accountless deltas and expose their first covered instant",
);
assert.match(
  androidNativeSource,
  /getCurrentDeviceStepOrigins[\s\S]{0,900}getMethod\("getDeviceDataOrigin"\)[\s\S]{0,300}getMethod\("getPackageName"\)[\s\S]{0,900}name == "getCurrentDeviceDataSource"/,
  "the native bridge must discover the app-scoped Health Connect phone SPN",
);
assert.match(
  androidNativeSource,
  /parameterCount == 0[\s\S]{0,1000}parameterCount == 2[\s\S]{0,500}OutcomeReceiver/,
  "SPN discovery must support both documented framework-extension method shapes",
);
assert.match(
  androidNativeSource,
  /SdkExtensions\.getExtensionVersion\(Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\) >= 11/,
  "the framework SPN API must be guarded by its documented SDK extension floor",
);
assert.match(
  androidNativeSource,
  /healthConnectOnDeviceSteps[\s\S]{0,500}SdkExtensions\.getExtensionVersion\(Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\) >= 20/,
  "raw SPN fallback reads must run only where Android's on-device step writer is available",
);
assert.match(
  androidNativeSource,
  /LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE/,
  "steps-only recording must accept the official lower Play services floor",
);
assert.match(
  androidNativeSource,
  /startLocalPhoneStepRecording[\s\S]{0,900}\.subscribe\(LocalDataType\.TYPE_STEP_COUNT_DELTA\)/,
  "an already-granted migration must start persistent local recording without waiting for a data read",
);
assert.match(
  androidHealthSource,
  /async function prepareLocalPhoneStepRecording\(\)[\s\S]{0,300}requestLocalPhoneStepPermission[\s\S]{0,300}startLocalPhoneStepRecording/,
  "the migration must subscribe immediately after the API-appropriate permission check",
);
assert.equal(
  (androidHealthSource.match(/await prepareLocalPhoneStepRecording\(\)/g) ?? [])
    .length,
  2,
  "both foreground and background Health permission paths must start local Steps recording immediately",
);
assert.match(
  androidHealthSource,
  /prepareCurrentDaySteps:\s*prepareLocalPhoneStepRecording/,
  "the one-time migration and manual retry must reuse the same permission-plus-subscription path",
);
assert.match(
  androidNativeSource,
  /getValue\(LocalField\.FIELD_STEPS\)[\s\S]{0,100}\.asInt\(\)/,
  "the integer step field must use LocalValue's typed accessor",
);
assert.doesNotMatch(
  androidNativeSource,
  /getValue\(LocalField\.FIELD_STEPS\)[\s\S]{0,100}\.toString\(\)/,
  "step parsing must not depend on LocalValue's display string",
);
assert.match(
  androidNativeSource,
  /stopLocalPhoneStepRecording[\s\S]{0,800}\.unsubscribe\(LocalDataType\.TYPE_STEP_COUNT_DELTA\)/,
  "disconnecting health must end the persistent phone-step subscription",
);
assert.match(
  healthProviderSource,
  /granted\?\.connected === false[\s\S]{0,700}nativeHealthAdapter\.disconnect\?\.\(\)/,
  "revoking Health Connect access must also end local phone recording",
);
assert.match(
  healthProviderSource,
  /reason === 'manual'[\s\S]{0,300}currentHealth\.dataTypes\.steps[\s\S]{0,700}nativeHealthAdapter\.prepareCurrentDaySteps\?\.\(\)/,
  "an existing connected user must get Physical Activity access from the deliberate manual health-sync action",
);
assert.match(
  healthProviderSource,
  /Platform\.OS === 'android' && auth\.status === 'signedIn'/,
  "the one-time migration must exclude web, iOS, demo, and signed-out sessions",
);
assert.match(
  healthProviderSource,
  /const markerKey =[\s\S]{0,700}!hydrated[\s\S]{0,300}status !== 'ready'[\s\S]{0,400}persisted\.connectionEnabled !== true[\s\S]{0,300}!state\.settings\.onboardingComplete/,
  "the one-time migration must wait for hydration, completed onboarding, ready status, and a connected device",
);
assert.match(
  healthProviderSource,
  /if \(syncingRef\.current\)[\s\S]{0,3000}InteractionManager\.runAfterInteractions[\s\S]{0,500}PHYSICAL_ACTIVITY_MIGRATION_DELAY_MS/,
  "the migration must yield to screen interactions and any first native sync",
);
assert.match(
  healthProviderSource,
  /AsyncStorage\.getItem\(markerKey\)[\s\S]{0,300}if \(existing\)[\s\S]{0,900}AsyncStorage\.setItem\(markerKey[\s\S]{0,500}void nativeHealthAdapter\.prepareCurrentDaySteps/,
  "the account/version attempt marker must be persisted before the one-shot permission request",
);
assert.match(
  androidPluginSource,
  /play-services-fitness:21\.3\.0/,
  "the config plugin must reproduce the official local Recording API dependency",
);
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
  appleHealthSource,
  /config\.type === 'nutrition'[\s\S]{0,700}queryQuantitySamples\(config\.identifier[\s\S]{0,900}sample\.uuid[\s\S]{0,500}sourceName\(sample\)/,
  "Apple dietary reads must retain sample UUID, time, and writer for semantic dedup",
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
assert.match(
  healthMappingSource,
  /healthType !== "steps" &&[\s\S]{0,120}!healthSourceEnabled/,
  "generic source preferences must never discard Health Connect's authoritative Steps aggregate",
);
assert.match(
  healthMappingSource,
  /healthType &&[\s\S]{0,100}entry\.source !== "manual" &&[\s\S]{0,100}hasHealthImportIdentity\(entry\)/,
  "providerless legacy cleanup must continue to preserve explicit manual rows",
);
assert.match(
  healthDedupSource,
  /record\.type !== "steps" &&[\s\S]{0,120}!healthSourceEnabled/,
  "record-level dedup must exempt the priority-aware platform Steps aggregate from shared source filters",
);
assert.match(
  healthMappingSource,
  /displayedImportedStepCandidate\(group\)[\s\S]{0,300}reconciled\.push/,
  "Steps reconciliation and migration must share one canonical-or-legacy displayed-total calculation",
);
assert.match(
  healthProviderSource,
  /lastStepSyncedAt[\s\S]{0,1800}dataTypes: \['steps'\][\s\S]{0,1800}lastStepSyncedAt: completedAt/,
  "today's foreground Steps refresh must have an independent checkpoint",
);
assert.match(
  healthProviderSource,
  /HEALTH_TODAY_STEPS_MIN_INTERVAL_MS[\s\S]{0,7000}FOREGROUND_STEPS_SETTLE_DELAY_MS/,
  "foreground refresh must be throttled and deferred until the UI settles",
);
assert.match(
  healthProviderSource,
  /todayStepsIntervalRef\.current = setInterval\([\s\S]{0,300}refreshTodayStepsAfterInteractions\(\)[\s\S]{0,300}HEALTH_TODAY_STEPS_ACTIVE_REFRESH_MS/,
  "an open foreground app must refresh the current Health Connect Steps total every minute",
);
assert.match(
  healthProviderSource,
  /FOREGROUND_STEPS_INTERACTION_MAX_WAIT_MS[\s\S]{0,7000}InteractionManager\.runAfterInteractions\(run\)[\s\S]{0,500}setTimeout\(/,
  "a continuous animation must not indefinitely strand today's user-visible Steps refresh",
);
const todayRefreshStart = healthProviderSource.indexOf(
  "const refreshTodaySteps = useCallback",
);
const repairStart = healthProviderSource.indexOf(
  "const runStepsRepair = useCallback",
);
const fullSyncStart = healthProviderSource.indexOf(
  "const runSync = useCallback",
  repairStart,
);
assert.ok(todayRefreshStart >= 0 && repairStart > todayRefreshStart);
assert.ok(fullSyncStart > repairStart);
const todayRefreshSource = healthProviderSource.slice(
  todayRefreshStart,
  repairStart,
);
const fullSyncSource = healthProviderSource.slice(fullSyncStart);
assert.match(
  todayRefreshSource,
  /activeOperation === 'steps-refresh'[\s\S]{0,300}await pending[\s\S]{0,300}refreshTodayStepsRef\.current\?\.\(true\)/,
  "a today-only refresh must queue behind a full sync instead of being silently consumed",
);
assert.match(
  fullSyncSource,
  /activeHealthOperationRef\.current === 'full'[\s\S]{0,300}await pending[\s\S]{0,300}runSyncRef\.current\?\.\(reason, forceEnabled\)/,
  "a full sync must queue behind a today-only refresh instead of being silently consumed",
);
assert.match(
  healthProviderSource,
  /historicalStepRepairStart[\s\S]{0,3500}STEPS_REPAIR_CHUNK_DAYS[\s\S]{0,5000}stepsImportVersion: nextRepair/,
  "historical Steps repair must be versioned, chunked, and resumable",
);
assert.match(
  fullSyncSource,
  /const completedStepsImportVersion =[\s\S]{0,700}stepRepairRangeCovered\(/,
  "a general history backfill may claim the repair version only after covering its calculated bounds",
);
assert.match(
  fullSyncSource,
  /stepsImportVersion: completedStepsImportVersion/,
  "the persisted generic-history version must use the bounded coverage result",
);
assert.match(
  healthProviderSource,
  /setCloudSyncPaused\('health-steps-repair', true\)[\s\S]{0,6500}setCloudSyncPaused\('health-steps-repair', false\)/,
  "each history repair batch must coalesce cloud publication and release its gate in finally",
);
assert.match(
  healthProviderSource,
  /STEPS_REPAIR_CHUNKS_PER_BATCH = 4[\s\S]{0,30000}batchIndex < STEPS_REPAIR_CHUNKS_PER_BATCH[\s\S]{0,5000}batchRecords\.push\(\.\.\.records\)[\s\S]{0,5000}scheduleStepsRepair\(STEPS_REPAIR_NEXT_CHUNK_DELAY_MS\)/,
  "historical repair must merge four native slices into one foreground-friendly batch",
);
assert.match(
  healthProviderSource,
  /batchThrough \?\?= aggregateRangeThroughLocalDate\(chunkEnd\)[\s\S]{0,2500}dateKey\(batchFrom\)[\s\S]{0,500}throughDate: batchThrough/,
  "a merged repair batch must replace the exact oldest-to-newest local-day window",
);
for (const source of [appProviderSource, backgroundHealthSource]) {
  assert.match(
    source,
    /isDailyStepReplacementCandidate/,
    "a zero-valued refreshed day must remove stale calculated step fallbacks",
  );
  assert.match(
    source,
    /preserveCurrentDayStepFloor/,
    "foreground and background imports must accept positive corrections while retaining transient non-positive reads",
  );
  assert.match(
    source,
    /preserveCurrentDayStepReplacementFloor/,
    "foreground and background canonical migration must reconcile differently identified current-day rows",
  );
  assert.match(
    source,
    /currentDayStepFloorsForEmptyReplacement/,
    "foreground and background empty live reads must retain today's confirmed imported Steps total",
  );
}
assert.match(
  healthDedupSource,
  /preserveCurrentDayStepFloor[\s\S]{0,700}preserveUnchangedDailyAggregateRevision/,
  "the current-day correction guard must retain unchanged revision/object reconciliation",
);
assert.match(
  appProviderSource,
  /isDailyStepReplacementCandidate\([\s\S]{0,500}includeFallbacks:\s*action\.aggregateReplacement\?\.removeStepFallbacks === true/,
  "foreground aggregate replacement must opt into stale fallback cleanup",
);
assert.match(
  appProviderSource,
  /preserveDeviceHealthEntries[\s\S]{0,700}mergeLocalCurrentDayDeviceStepEntries\([\s\S]{0,500}metricIdsForHealthDataTypes\([\s\S]{0,100}\["steps"\]/,
  "every cloud hydrate path must preserve native current-day Steps when no positive native cloud total exists",
);
assert.match(
  appProviderSource,
  /preserveDeviceHealthEntries:[\s\S]{0,160}\(options\?\.source \?\? "cloud"\) === "cloud"/,
  "the device Steps merge must apply to cloud acceptance without blocking intentional local replacements",
);
assert.match(
  backgroundHealthSource,
  /isDailyStepReplacementCandidate\([\s\S]{0,500}includeFallbacks:\s*true/,
  "background aggregate replacement must opt into stale fallback cleanup",
);
assert.match(
  healthDedupSource,
  /isDailyStepReplacementCandidate[\s\S]{0,900}sourceRecordId\?\.startsWith\("step-fallback:"\)/,
  "the shared replacement predicate must recognize calculated step fallback identity",
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
assert.equal(
  phoneOnly[0].value,
  1254,
  "shared source controls must not rebuild or filter the platform-owned Steps total",
);

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
  `Health import validation passed: calendar-aligned priority-aware platform Steps, manual daily overrides, repair/refresh contracts, body composition, and 365-day fixture (${elapsed.toFixed(1)}ms).`,
);
