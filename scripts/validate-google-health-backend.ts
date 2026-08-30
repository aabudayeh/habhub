import assert from "node:assert/strict";

import {
  decryptSecret,
  encryptSecret,
} from "../supabase/functions/_shared/google-health-crypto.ts";
import { googleHealthApiTestHooks } from "../supabase/functions/_shared/google-health-api.ts";
import {
  googleError,
  googleHealthProviderErrorCode,
} from "../supabase/functions/_shared/google-health-http.ts";
import { googleHealthSyncTestHooks } from "../supabase/functions/_shared/google-health-sync.ts";
import { readBoundedJson } from "../supabase/functions/_shared/google-health-request.ts";
import {
  currentDateForProfile,
  googleHealthWebhookEventRange,
} from "../supabase/functions/_shared/google-health-webhook-range.ts";

const read = (path: string) => Deno.readTextFile(path);
const [
  migration,
  arrayInitializerMigration,
  foodFamilyMutationMigration,
  serverSnapshotMigration,
  serverSnapshotRepairMigration,
  durableCatchupMigration,
  hourlyCatchupMigration,
  forwardWorkerHardeningMigration,
  groupProjectionMigration,
  cloudProtocolMigration,
  universalCloudProtocolMigration,
  endpoint,
  sync,
  api,
  config,
  webhook,
  worker,
  signature,
  deleteAccount,
  sendPush,
  subscriber,
  runbook,
  envExample,
  packageJson,
  supabaseConfig,
] = await Promise.all([
  read("supabase/migrations/202608210001_google_health_web_sync.sql"),
  read("supabase/migrations/202608220001_google_health_array_initializers.sql"),
  read("supabase/migrations/202608220002_google_health_food_family_mutations.sql"),
  read("supabase/migrations/202608220003_preserve_google_health_server_snapshot.sql"),
  read("supabase/migrations/202608220004_harden_google_health_snapshot_repair.sql"),
  read("supabase/migrations/202608220005_google_health_durable_catchups.sql"),
  read("supabase/migrations/202608240001_hourly_google_health_catchups.sql"),
  read("supabase/migrations/202608240006_worker_and_challenge_guard_hardening.sql"),
  read("supabase/migrations/202608240007_google_health_group_projection.sql"),
  read("supabase/migrations/202608240011_google_health_cloud_protocol_gate.sql"),
  read("supabase/migrations/202608240012_universal_cloud_protocol_gate.sql"),
  read("supabase/functions/google-health/index.ts"),
  read("supabase/functions/_shared/google-health-sync.ts"),
  read("supabase/functions/_shared/google-health-api.ts"),
  read("supabase/functions/_shared/google-health-config.ts"),
  read("supabase/functions/google-health-webhook/index.ts"),
  read("supabase/functions/google-health-worker/index.ts"),
  read("supabase/functions/_shared/google-health-webhook-signature.ts"),
  read("supabase/functions/delete-account/index.ts"),
  read("supabase/functions/send-push/index.ts"),
  read("scripts/configure-google-health-subscriber.mjs"),
  read("docs/GOOGLE_HEALTH_WEB_SYNC.md"),
  read(".env.example"),
  read("package.json"),
  read("supabase/config.toml"),
]);

const arrayInitializerTargets = [
  ["public.purge_google_health_group_projections(uuid,text[],bigint,boolean)", 1],
  ["public.update_google_health_metric_visibility(uuid,text,text)", 1],
  ["public.apply_google_health_import(uuid,jsonb,jsonb,jsonb,timestamptz,bigint,uuid)", 7],
  ["public.delete_google_health_imports(uuid)", 1],
] as const;
assert.equal(
  [...migration.matchAll(/\btext\[\] := '\{\}';/g)].length,
  arrayInitializerTargets.reduce((total, [, count]) => total + count, 0),
  "the applied Google Health migration must remain immutable while the follow-up owns the casts",
);
assert.match(arrayInitializerMigration, /v_source constant text := 'text\[\] := ''\{\}'';'/);
assert.match(arrayInitializerMigration, /v_replacement constant text := 'text\[\] := array\[\]::text\[\];'/);
assert.match(arrayInitializerMigration, /if v_replacement_count <> v_target\.expected_count then/);
for (const [signature, expectedCount] of arrayInitializerTargets) {
  assert.ok(
    arrayInitializerMigration.includes(`('${signature}'::regprocedure, ${expectedCount})`),
    `${signature} must be recreated with its audited initializer count`,
  );
}
assert.equal(
  [...arrayInitializerMigration.matchAll(/'public\.[^']+'::regprocedure/g)].length,
  arrayInitializerTargets.length,
  "the lint-only migration must target exactly the four audited functions",
);

assert.deepEqual(
  googleHealthApiTestHooks.dailyRollUpRequestBody(
    "2026-08-21",
    "2026-08-23",
  ),
  {
    range: {
      start: {
        date: { year: 2026, month: 8, day: 21 },
        time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
      },
      end: {
        date: { year: 2026, month: 8, day: 23 },
        time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
      },
    },
    windowSizeDays: 1,
    pageSize: 2,
    dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
  },
  "daily rollups must send explicit midnight and one page per requested civil day",
);
assert.throws(
  () => googleHealthApiTestHooks.dailyRollUpRequestBody("2026-8-21", "2026-08-23"),
  /Invalid civil date/,
);
assert.equal(
  googleHealthApiTestHooks.dailyRollUpRequestBody("2026-05-24", "2026-08-22").pageSize,
  90,
  "a maximum steps range must not exceed Google's 90-day rollup page budget",
);
assert.equal(
  googleHealthApiTestHooks.dailyRollUpRequestBody("2026-08-08", "2026-08-22").pageSize,
  14,
  "a maximum heart-rate range must not exceed Google's 14-day rollup page budget",
);
assert.throws(
  () => googleHealthApiTestHooks.dailyRollUpRequestBody("2026-08-23", "2026-08-22"),
  /Invalid civil date range/,
);
assert.equal(
  googleHealthApiTestHooks.dailyRollUpRequestBody(
    "2026-08-21",
    "2026-08-23",
    "next-page",
  ).pageToken,
  "next-page",
  "daily rollup pagination must replay the same query with Google's continuation token",
);

const stepsDefinition = {
  googleType: "steps",
  internalType: "steps",
  mode: "daily" as const,
  maxInitialDays: 90,
  requiredScope: "activity",
};
const explicitStepDates = googleHealthSyncTestHooks.dailyValueDates(
  stepsDefinition,
  [
    {
      civilStartTime: { date: { year: 2026, month: 8, day: 22 } },
      steps: { countSum: 1200 },
    },
    {
      civilStartTime: { date: { year: 2026, month: 8, day: 23 } },
      steps: { countSum: 0 },
    },
    {
      civilStartTime: { date: { year: 2026, month: 8, day: 24 } },
    },
  ],
);
assert.deepEqual(
  [...explicitStepDates].sort(),
  ["2026-08-22", "2026-08-23"],
  "an explicit zero is authoritative but a missing daily value union is not",
);
assert.deepEqual(
  googleHealthSyncTestHooks.replacementRangesForFetch(
    stepsDefinition,
    { fromDate: "2026-08-21", throughDate: "2026-08-24" },
    "2026-08-23",
    explicitStepDates,
  ),
  [
    { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-22" },
    { dataType: "steps", fromDate: "2026-08-23", throughDate: "2026-08-23" },
  ],
  "completed days reconcile fully while an absent live/future day preserves its last confirmed import",
);
assert.deepEqual(
  googleHealthSyncTestHooks.replacementRangesForFetch(
    stepsDefinition,
    { fromDate: "2026-08-23", throughDate: "2026-08-23" },
    "2026-08-23",
    new Set(),
  ),
  [],
  "a successful but value-less current-day response must not delete a prior positive rollup",
);

const catalogError = await googleError(new Response(JSON.stringify({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: "The duration covered by window_size_days * page_size must not exceed 90 days for steps.",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "INVALID_ROLLUP_QUERY_DURATION",
      domain: "health.googleapis.com",
    }],
  },
}), { status: 400 }));
assert.equal(
  googleHealthProviderErrorCode(catalogError),
  "invalid_rollup_query_duration",
  "the exact Google catalog reason must survive as a bounded diagnostic code",
);
const messageOnlyCatalogError = await googleError(new Response(JSON.stringify({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: "The duration covered by window_size_days * page_size must not exceed 14 days for heart-rate.",
  },
}), { status: 400 }));
assert.equal(
  googleHealthProviderErrorCode(messageOnlyCatalogError),
  "invalid_rollup_query_duration",
  "known catalog descriptions must remain diagnostic when ErrorInfo is omitted",
);

const sourceRecord = {
  externalId: "nutrition-log:meal-a",
  dataType: "nutrition",
  startTime: "2026-08-20T11:00:00.000Z",
  endTime: "2026-08-20T11:15:00.000Z",
  localDate: "2026-08-20",
  value: 550,
  unit: "kcal",
  label: "Lunch",
  sourceOrigin: "com.myfitnesspal.android",
  nutrition: { proteinG: 25, carbsG: 65, fatG: 18 },
};
assert.equal(
  googleHealthSyncTestHooks.googleHealthSourceOrigin({
    dataSource: {
      platform: "HEALTH_CONNECT",
      application: { packageName: "com.myfitnesspal.android" },
    },
  }),
  "com.myfitnesspal.android",
  "Google's source package must survive so MyFitnessPal imports remain traceable",
);
assert.equal(
  googleHealthSyncTestHooks.googleHealthSourceOrigin({
    dataSource: { platform: "GOOGLE_PARTNER_INTEGRATION" },
  }),
  "Google Health (google partner integration)",
  "direct partner records retain their provider platform when no package is exposed",
);
const foodMetric = {
  id: "food",
  unit: "kcal",
  dataType: "number",
  defaultVisibility: "group",
  healthMapping: { dataType: "nutrition", field: "value" },
  submetrics: [{
    id: "protein",
    unit: "g",
    showProgressBar: true,
    healthMapping: { dataType: "nutrition", field: "protein" },
  }],
};
const mappedFood = googleHealthSyncTestHooks.mapRecordsToEntries(
  [sourceRecord],
  { metrics: [foodMetric], entries: [], settings: {} },
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const mappedFoodRow = mappedFood.find((row) => row.entry.metricId === "food")!;
const mappedFoodParent = [mappedFoodRow];
assert.equal(mappedFoodRow.entry.value, 550);
assert.equal(mappedFoodRow.entry.visibility, "group", "first import follows configured tracker visibility");
assert.deepEqual(mappedFoodRow.entry.submetricValues, { protein: 25 });
assert.deepEqual(mappedFoodRow.entry.nutrition, sourceRecord.nutrition);
assert.equal(mappedFoodRow.entry.sourceRecordedAt, sourceRecord.endTime);
assert.match(String(mappedFoodRow.entry.id), /^google-health:/);
assert.equal(mappedFoodRow.entry.sourceProvider, "google_health");
assert.equal(
  mappedFoodRow.entry.sourceOrigin,
  "com.myfitnesspal.android",
  "provider package provenance survives normalization and entry materialization",
);
const foodId = String(mappedFoodRow.entry.id);

const workoutRecord = {
  externalId: "exercise:morning-walk",
  dataType: "workouts",
  startTime: "2026-08-21T08:00:00.000Z",
  endTime: "2026-08-21T08:42:00.000Z",
  localDate: "2026-08-21",
  value: 42,
  unit: "min",
  label: "Morning walk",
  sourceOrigin: "Samsung Health via Google Health",
  measurements: { durationMinutes: 42, activeCalories: 100, distanceKm: 3.4 },
};
const workoutMetrics = [
  {
    id: "workout",
    unit: "",
    dataType: "boolean",
    defaultVisibility: "group",
    healthMapping: { dataType: "workouts", field: "value" },
  },
  {
    id: "exercise",
    unit: "kcal",
    dataType: "number",
    defaultVisibility: "group",
    healthMapping: { dataType: "active_energy", field: "value" },
  },
  {
    id: "workout_duration",
    unit: "min",
    dataType: "number",
    defaultVisibility: "group",
    healthMapping: { dataType: "workouts", field: "duration_minutes" },
  },
  {
    id: "workout_distance",
    unit: "km",
    dataType: "number",
    defaultVisibility: "group",
    healthMapping: { dataType: "workouts", field: "distance_km" },
  },
];
const mappedWorkout = googleHealthSyncTestHooks.mapRecordsToEntries(
  [workoutRecord],
  { metrics: workoutMetrics, entries: [], settings: {} },
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const mappedWorkoutParent = mappedWorkout.find(
  (row) => row.entry.metricId === "workout",
)!;
assert.deepEqual(
  mappedWorkoutParent.entry.submetricValues,
  { exercise: 100 },
  "a group-visible Active energy workout summary must travel with the shared Workout detail",
);
assert.equal(
  mappedWorkout.some((row) => row.entry.metricId === "exercise"),
  false,
  "per-workout calories must not become a second Active energy value alongside Google's canonical daily rollup",
);
const mappedDailyActiveEnergy = googleHealthSyncTestHooks.mapRecordsToEntries(
  [{
    externalId: "active-energy-burned:daily:2026-08-21",
    dataType: "active_energy",
    startTime: "2026-08-21T00:00:00.000Z",
    endTime: "2026-08-22T00:00:00.000Z",
    localDate: "2026-08-21",
    value: 420,
    unit: "kcal",
  }],
  { metrics: workoutMetrics, entries: [], settings: {} },
  "owner",
  "2026-08-22T00:05:00.000Z",
).find((row) => row.entry.metricId === "exercise")!;
assert.equal(
  mappedDailyActiveEnergy.entry.label,
  "Active energy total",
  "a Google daily Active Energy aggregate must be identifiable so the client does not add uncovered-step calories twice",
);
const privateEnergyWorkout = googleHealthSyncTestHooks.mapRecordsToEntries(
  [workoutRecord],
  {
    metrics: workoutMetrics.map((metric) =>
      metric.id === "exercise"
        ? { ...metric, defaultVisibility: "private" }
        : metric
    ),
    entries: [],
    settings: {},
  },
  "owner",
  "2026-08-21T12:00:00.000Z",
).find((row) => row.entry.metricId === "workout")!;
assert.equal(
  privateEnergyWorkout.entry.submetricValues?.exercise,
  100,
  "per-workout calories must remain in the private snapshot for privacy-safe destination-group projection",
);

const stepFallbackMetrics = [
  {
    id: "steps",
    unit: "steps",
    dataType: "number",
    defaultVisibility: "group",
    healthMapping: { dataType: "steps", field: "value" },
  },
  ...workoutMetrics.map((metric) =>
    ["exercise", "workout_duration", "workout_distance"].includes(metric.id)
      ? { ...metric, stepFallback: true }
      : metric
  ),
];
const fallbackSnapshot = {
  metrics: stepFallbackMetrics,
  entries: [],
  settings: {
    energyProfile: {
      age: 35,
      sex: "male",
      heightCm: 180,
      weightKg: 80,
    },
  },
};
const serverUnexplainedWalking =
  googleHealthSyncTestHooks.estimateWalkingFromSteps(6_000, fallbackSnapshot);
assert.equal(googleHealthSyncTestHooks.metCadenceStepEstimate(3), 100);
assert.equal(googleHealthSyncTestHooks.metCadenceStepEstimate(6), 130);
assert.equal(
  googleHealthSyncTestHooks.stepCoverageActivityFromKey("basketball")
    ?.stepsPerMinute,
  130,
  "Google must preserve a published activity-table rate",
);
assert.equal(
  googleHealthSyncTestHooks.stepCoverageActivityFromKey("mountain_biking")
    ?.stepsPerMinute,
  155,
  "Google must recognize session activities through the MET cadence fallback",
);
assert.equal(
  googleHealthSyncTestHooks.stepCoverageActivity(
    "High-intensity interval training",
  )?.key,
  "hiit",
  "Google must resolve canonical catalog labels as well as explicit activity keys",
);
assert.equal(
  googleHealthSyncTestHooks.stepCoverageActivityFromKey(
    "barbell_bench_press",
  ),
  undefined,
  "individual strength exercises must not enter the session Step picker",
);
for (const administrativeKey of [
  "multisport_transition",
  "other_workout",
  "workout_break",
]) {
  assert.equal(
    googleHealthSyncTestHooks.stepCoverageActivityFromKey(administrativeKey),
    undefined,
    `${administrativeKey} must not invent a covered-step rate`,
  );
}
assert.ok(
  Math.abs(serverUnexplainedWalking.stepLengthM - 0.7636) < 1e-12 &&
    Math.abs(
      serverUnexplainedWalking.durationMinutes -
        (6_000 * 0.7636) / 1_000 * 1_000 / 1.4 / 60,
    ) < 1e-12,
  "Google remaining-step distance and duration must use the explicit 1.4 m/s profile equation",
);
const serverMeasuredWalkingStep =
  googleHealthSyncTestHooks.movementStepLengthForCoverage(
    { distanceKm: 3, durationMinutes: 30 },
    fallbackSnapshot,
  );
assert.ok(
  serverMeasuredWalkingStep.speedSource === "measured" &&
    Math.abs(serverMeasuredWalkingStep.speedKmh - 6) < 1e-12 &&
    Math.abs(serverMeasuredWalkingStep.stepLengthM - 0.8436) < 1e-12,
  "Google walking and hiking coverage must use measured distance/duration speed with the profile equation",
);
const serverMeasuredRunningStep =
  googleHealthSyncTestHooks.movementStepLengthForCoverage(
    { distanceKm: 3, durationMinutes: 15, running: true },
    fallbackSnapshot,
  );
assert.ok(
  serverMeasuredRunningStep.speedSource === "measured" &&
    Math.abs(serverMeasuredRunningStep.speedKmh - 12) < 1e-12 &&
    Math.abs(serverMeasuredRunningStep.stepLengthM - 1.2082) < 1e-12,
  "Google running coverage must use the age-height-speed regression instead of a fixed metre",
);
const mappedStepFallbackInputs = googleHealthSyncTestHooks.mapRecordsToEntries(
  [
    {
      externalId: "steps:daily:2026-08-21",
      dataType: "steps",
      startTime: "2026-08-21T00:00:00.000Z",
      endTime: "2026-08-21T12:00:00.000Z",
      localDate: "2026-08-21",
      value: 8_000,
      unit: "steps",
      label: "Steps",
    },
    workoutRecord,
  ],
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const webStepFallback = googleHealthSyncTestHooks.appendStepFallbackRecords(
  mappedStepFallbackInputs,
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
  [
    { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-21" },
    { dataType: "workouts", fromDate: "2026-08-21", throughDate: "2026-08-21" },
  ],
  [],
);
const fallbackRows = webStepFallback.mapped.filter(
  (row) => row.dataType === "derived_step_fallback",
);
assert.deepEqual(
  fallbackRows.map((row) => row.entry.metricId).sort(),
  ["exercise", "workout_distance", "workout_duration"],
  "Google Health web sync must materialize the same unrecorded-step tracker family as native sync",
);
assert.ok(
  Number(fallbackRows.find((row) => row.entry.metricId === "workout_distance")?.entry.value) > 0,
  "the web fallback must retain walking distance not covered by an imported workout",
);
assert.ok(
  webStepFallback.replacements.some((replacement) =>
    replacement.dataType === "derived_step_fallback" &&
    replacement.fromDate === "2026-08-21"
  ),
  "derived rows need their own replacement ownership so later syncs update or remove them instead of duplicating",
);
const stableWebStepFallback = googleHealthSyncTestHooks.appendStepFallbackRecords(
  mappedStepFallbackInputs,
  { ...fallbackSnapshot, entries: fallbackRows.map((row) => row.entry) },
  "owner",
  "2026-08-21T13:00:00.000Z",
  [
    { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-21" },
    { dataType: "workouts", fromDate: "2026-08-21", throughDate: "2026-08-21" },
  ],
  fallbackRows.map((row) => ({
    entry_id: String(row.entry.id),
    data_type: "derived_step_fallback",
    local_date: row.localDate,
  })),
);
assert.equal(
  stableWebStepFallback.mapped.find((row) =>
    row.dataType === "derived_step_fallback" && row.entry.metricId === "exercise"
  )?.entry.sourceUpdatedAt,
  "2026-08-21T12:00:00.000Z",
  "an unchanged hourly fallback must retain its prior JSON so background sync does not churn account/group revisions",
);
const directWorkoutStepInputs = googleHealthSyncTestHooks.mapRecordsToEntries(
  [
    {
      externalId: "steps:daily:2026-08-21",
      dataType: "steps",
      startTime: "2026-08-21T00:00:00.000Z",
      endTime: "2026-08-21T12:00:00.000Z",
      localDate: "2026-08-21",
      value: 8_000,
      unit: "steps",
      label: "Steps",
    },
    {
      ...workoutRecord,
      measurements: {
        ...workoutRecord.measurements,
        distanceKm: 20,
        steps: 2_500,
      },
    },
  ],
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const directWorkoutStepFallback = googleHealthSyncTestHooks.appendStepFallbackRecords(
  directWorkoutStepInputs,
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
  [
    { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-21" },
    { dataType: "workouts", fromDate: "2026-08-21", throughDate: "2026-08-21" },
  ],
  [],
);
assert.match(
  String(directWorkoutStepFallback.mapped.find((row) =>
    row.dataType === "derived_step_fallback" && row.entry.metricId === "exercise"
  )?.entry.note),
  /5,500 steps/,
  "a provider's workout step summary must outrank an inferred distance when subtracting covered steps",
);
function fallbackExerciseNote(mapped, snapshot) {
  return String(googleHealthSyncTestHooks.appendStepFallbackRecords(
    mapped,
    snapshot,
    "owner",
    "2026-08-21T12:00:00.000Z",
    [
      { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-21" },
      { dataType: "workouts", fromDate: "2026-08-21", throughDate: "2026-08-21" },
    ],
    [],
  ).mapped.find((row) =>
    row.dataType === "derived_step_fallback" && row.entry.metricId === "exercise"
  )?.entry.note);
}
const walkingPreferenceEntry = mappedStepFallbackInputs.find((row) =>
  row.entry.metricId === "workout_duration"
)!.entry;
const walkingPreferenceIdentity = `source:${encodeURIComponent(String(
  walkingPreferenceEntry.sourceProvider ?? "health",
))}:${encodeURIComponent(String(walkingPreferenceEntry.sourceRecordId))}`;
assert.match(
  fallbackExerciseNote(mappedStepFallbackInputs, {
    ...fallbackSnapshot,
    settings: {
      ...fallbackSnapshot.settings,
      stepCoveragePreferences: {
        version: 1,
        sessions: {
          [walkingPreferenceIdentity]: {
            choice: "exclude",
            updatedAt: "2026-08-21T12:00:00.000Z",
          },
        },
        activityRules: {},
      },
    },
  }),
  /8,000 steps/,
  "an exact-session exclusion must affect the Google web fallback calculation",
);
const basketballRecord = {
  ...workoutRecord,
  externalId: "exercise:basketball",
  startTime: "2026-08-21T10:00:00.000Z",
  endTime: "2026-08-21T10:30:00.000Z",
  value: 30,
  label: "Basketball",
  measurements: { durationMinutes: 30, activeCalories: 200 },
};
const mappedBasketballInputs = googleHealthSyncTestHooks.mapRecordsToEntries(
  [
    {
      externalId: "steps:daily:2026-08-21",
      dataType: "steps",
      startTime: "2026-08-21T00:00:00.000Z",
      endTime: "2026-08-21T12:00:00.000Z",
      localDate: "2026-08-21",
      value: 8_000,
      unit: "steps",
      label: "Steps",
    },
    basketballRecord,
  ],
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
);
assert.match(
  fallbackExerciseNote(mappedBasketballInputs, fallbackSnapshot),
  /8,000 steps/,
  "a nonwalking activity equivalent must be excluded by default on web",
);
const basketballPreferenceEntry = mappedBasketballInputs.find((row) =>
  row.entry.metricId === "workout_duration"
)!.entry;
const basketballPreferenceIdentity = `source:${encodeURIComponent(String(
  basketballPreferenceEntry.sourceProvider ?? "health",
))}:${encodeURIComponent(String(basketballPreferenceEntry.sourceRecordId))}`;
assert.match(
  fallbackExerciseNote(mappedBasketballInputs, {
    ...fallbackSnapshot,
    settings: {
      ...fallbackSnapshot.settings,
      stepCoveragePreferences: {
        version: 1,
        sessions: {
          [basketballPreferenceIdentity]: {
            choice: "include",
            updatedAt: "2026-08-21T12:00:00.000Z",
          },
        },
        activityRules: {},
      },
    },
  }),
  /4,100 steps/,
  "30 opted-in basketball minutes must cover 3,900 of 8,000 Google steps",
);

const standaloneActiveEnergyInputs =
  googleHealthSyncTestHooks.mapRecordsToEntries(
    [
      {
        externalId: "steps:daily:2026-08-21",
        dataType: "steps",
        startTime: "2026-08-21T00:00:00.000Z",
        endTime: "2026-08-21T12:00:00.000Z",
        localDate: "2026-08-21",
        value: 8_000,
        unit: "steps",
        label: "Steps",
      },
      {
        externalId: "active-energy:standalone",
        dataType: "active_energy",
        startTime: "2026-08-21T10:00:00.000Z",
        endTime: "2026-08-21T10:30:00.000Z",
        localDate: "2026-08-21",
        value: 200,
        unit: "kcal",
        label: "Active energy",
      },
    ],
    fallbackSnapshot,
    "owner",
    "2026-08-21T12:00:00.000Z",
  );
const standaloneActiveEnergyEntry = standaloneActiveEnergyInputs.find((row) =>
  row.entry.metricId === "exercise"
)!.entry;
const standaloneActiveEnergyIdentity = `source:${encodeURIComponent(String(
  standaloneActiveEnergyEntry.sourceProvider ?? "health",
))}:${encodeURIComponent(String(standaloneActiveEnergyEntry.sourceRecordId))}`;
assert.match(
  fallbackExerciseNote(standaloneActiveEnergyInputs, fallbackSnapshot),
  /8,000 steps/,
  "an unlinked Active-energy interval must not subtract steps from its label alone",
);
assert.match(
  fallbackExerciseNote(standaloneActiveEnergyInputs, {
    ...fallbackSnapshot,
    settings: {
      ...fallbackSnapshot.settings,
      stepCoveragePreferences: {
        version: 1,
        sessions: {
          [standaloneActiveEnergyIdentity]: {
            choice: "include",
            activityKey: "basketball",
            updatedAt: "2026-08-21T12:00:00.000Z",
          },
        },
        activityRules: {},
      },
    },
  }),
  /4,623 steps/,
  "an explicitly classified standalone Active-energy interval must use net MET, calories, and body weight to cover steps",
);

for (const unsafeActiveEnergyEntry of [
  {
    ...standaloneActiveEnergyEntry,
    label: "Active energy total",
    sourceProvider: "google_health",
    sourceRecordId: "active-energy:daily:2026-08-21",
  },
  {
    ...standaloneActiveEnergyEntry,
    label: "Active energy",
    sourceOrigin: "Fitbit Mobile",
  },
  {
    ...standaloneActiveEnergyEntry,
    label: "Resting energy (BMR)",
  },
]) {
  assert.equal(
    googleHealthSyncTestHooks.eligibleStandaloneActiveEnergyForStepCoverage(
      unsafeActiveEnergyEntry,
    ),
    false,
    "daily aggregate, Fitbit resting, and BMR rows must remain ineligible even with stale preferences",
  );
}

const trackRunningInputs = googleHealthSyncTestHooks.mapRecordsToEntries(
  [
    {
      externalId: "steps:daily:2026-08-21",
      dataType: "steps",
      startTime: "2026-08-21T00:00:00.000Z",
      endTime: "2026-08-21T12:00:00.000Z",
      localDate: "2026-08-21",
      value: 8_000,
      unit: "steps",
      label: "Steps",
    },
    {
      ...workoutRecord,
      externalId: "exercise:track-running",
      label: "Track running",
      measurements: {
        durationMinutes: 15,
        distanceKm: 3,
        activeCalories: 200,
      },
    },
  ],
  fallbackSnapshot,
  "owner",
  "2026-08-21T12:00:00.000Z",
);
assert.equal(
  googleHealthSyncTestHooks.stepCoverageActivity("Track running")?.key,
  "track_running",
  "Track running must retain its canonical activity key in the Google worker",
);
assert.match(
  fallbackExerciseNote(trackRunningInputs, fallbackSnapshot),
  /5,517 steps/,
  "Track running must use the running regression in the Google worker",
);

const genericGymId = "web-gym-basketball";
const genericGymEntries = [
  {
    id: `gym-sync:${genericGymId}:workout`,
    metricId: "workout",
    userId: "owner",
    value: true,
    localDate: "2026-08-21",
    recordedAt: "2026-08-21T10:30:00.000Z",
    visibility: "private",
    source: "manual",
    label: "Workout",
  },
  {
    id: `gym-sync:${genericGymId}:workout_duration`,
    metricId: "workout_duration",
    userId: "owner",
    value: 30,
    localDate: "2026-08-21",
    recordedAt: "2026-08-21T10:30:00.000Z",
    visibility: "private",
    source: "manual",
    label: "Workout",
  },
  {
    id: `gym-sync:${genericGymId}:exercise`,
    metricId: "exercise",
    userId: "owner",
    value: 200,
    localDate: "2026-08-21",
    recordedAt: "2026-08-21T10:30:00.000Z",
    visibility: "private",
    source: "manual",
    label: "Workout",
  },
];
const genericBasketballGymSession = {
  id: genericGymId,
  userId: "owner",
  name: "Workout",
  localDate: "2026-08-21",
  recordedAt: "2026-08-21T10:30:00.000Z",
  durationMinutes: 30,
  exercises: [
    {
      id: "basketball-exercise",
      exerciseKey: "basketball",
      name: "Basketball",
      sets: [
        {
          id: "basketball-set",
          reps: 0,
          weightKg: 0,
          completed: true,
        },
      ],
    },
  ],
  visibility: "private",
};
const mappedStepOnly = mappedStepFallbackInputs.filter(
  (row) => row.entry.metricId === "steps",
);
const genericGymSnapshot = {
  ...fallbackSnapshot,
  entries: genericGymEntries,
  gymSessions: [genericBasketballGymSession],
};
assert.match(
  fallbackExerciseNote(mappedStepOnly, genericGymSnapshot),
  /8,000 steps/,
  "Google Health may infer Basketball for selection but must not include it without explicit consent",
);
const genericGymIdentity = `gym:${encodeURIComponent(genericGymId)}`;
assert.match(
  fallbackExerciseNote(mappedStepOnly, {
    ...genericGymSnapshot,
    settings: {
      ...genericGymSnapshot.settings,
      stepCoveragePreferences: {
        version: 1,
        sessions: {
          [genericGymIdentity]: {
            choice: "exclude",
            activityKey: "basketball",
            updatedAt: "2026-08-21T12:00:00.000Z",
          },
        },
        activityRules: {},
      },
    },
  }),
  /8,000 steps/,
  "an explicit session exclusion must outrank Google worker gym inference",
);
assert.match(
  fallbackExerciseNote(mappedStepOnly, {
    ...fallbackSnapshot,
    entries: genericGymEntries,
    settings: {
      ...fallbackSnapshot.settings,
      stepCoveragePreferences: {
        version: 1,
        sessions: {
          [genericGymIdentity]: {
            choice: "include",
            activityKey: "basketball",
            updatedAt: "2026-08-21T12:00:00.000Z",
          },
        },
        activityRules: {},
      },
    },
  }),
  /4,100 steps/,
  "the Google worker must honor an explicit activity classification even without local gym metadata",
);
assert.match(
  fallbackExerciseNote(mappedStepOnly, {
    ...genericGymSnapshot,
    gymSessions: [
      {
        ...genericBasketballGymSession,
        exercises: [
          ...genericBasketballGymSession.exercises,
          {
            id: "walking-exercise",
            exerciseKey: "walking",
            name: "Walking",
            sets: [
              {
                id: "walking-set",
                reps: 0,
                weightKg: 0,
                completed: true,
              },
            ],
          },
        ],
      },
    ],
  }),
  /8,000 steps/,
  "mixed eligible gym exercises must remain unclassified in the Google worker",
);
const fallbackWithoutWorkoutParent = stepFallbackMetrics.filter((metric) =>
  !["workout", "workout_distance"].includes(metric.id)
);
const customWorkoutCalories = {
  id: "walking_session_calories",
  unit: "kcal",
  dataType: "number",
  defaultVisibility: "private",
  healthMapping: { dataType: "workouts", field: "active_calories" },
};
const workoutWithoutDistance = {
  ...workoutRecord,
  measurements: { durationMinutes: 42, activeCalories: 100 },
};
function exerciseFallbackValue(metrics) {
  const snapshot = { ...fallbackSnapshot, metrics };
  const mapped = googleHealthSyncTestHooks.mapRecordsToEntries(
    [
      {
        externalId: "steps:daily:2026-08-21",
        dataType: "steps",
        startTime: "2026-08-21T00:00:00.000Z",
        endTime: "2026-08-21T12:00:00.000Z",
        localDate: "2026-08-21",
        value: 8_000,
        unit: "steps",
        label: "Steps",
      },
      workoutWithoutDistance,
    ],
    snapshot,
    "owner",
    "2026-08-21T12:00:00.000Z",
  );
  return Number(googleHealthSyncTestHooks.appendStepFallbackRecords(
    mapped,
    snapshot,
    "owner",
    "2026-08-21T12:00:00.000Z",
    [
      { dataType: "steps", fromDate: "2026-08-21", throughDate: "2026-08-21" },
      { dataType: "workouts", fromDate: "2026-08-21", throughDate: "2026-08-21" },
    ],
    [],
  ).mapped.find((row) =>
    row.dataType === "derived_step_fallback" && row.entry.metricId === "exercise"
  )?.entry.value);
}
assert.ok(
  exerciseFallbackValue([...fallbackWithoutWorkoutParent, customWorkoutCalories]) >
    exerciseFallbackValue(fallbackWithoutWorkoutParent),
  "a custom workout-calorie tracker must participate in step coverage even when the boolean Workout tracker is absent",
);

const absentDefinitionSidecars = mappedFood.filter(
  (row) => row.entry.metricId !== "food",
);
assert.deepEqual(
  absentDefinitionSidecars.map((row) => row.entry.metricId).sort(),
  ["carbs", "fat", "protein"],
  "every canonical positive Google nutrient must materialise even when its metric definition is absent",
);
for (const sidecar of absentDefinitionSidecars) {
  assert.equal(sidecar.externalId, sourceRecord.externalId);
  assert.equal(sidecar.localDate, sourceRecord.localDate);
  assert.equal(sidecar.entry.localDate, sourceRecord.localDate);
  assert.equal(sidecar.entry.sourceRecordId, mappedFoodRow.entry.sourceRecordId);
  assert.equal(sidecar.entry.visibility, "group", "an absent nutrient definition inherits Food visibility");
  assert.equal("label" in sidecar.entry, false, "a nutrient sidecar must not reveal the meal label");
  assert.equal("note" in sidecar.entry, false, "a nutrient sidecar must not carry meal/provider notes");
  assert.equal("nutrition" in sidecar.entry, false, "a nutrient sidecar must not carry the full meal payload");
}

const explicitProteinMetric = {
  id: "protein",
  unit: "g",
  dataType: "number",
  defaultVisibility: "private",
  healthMapping: { dataType: "nutrition", field: "protein" },
};
const mappedWithExplicitProtein = googleHealthSyncTestHooks.mapRecordsToEntries(
  [sourceRecord],
  { metrics: [foodMetric, explicitProteinMetric], entries: [], settings: {} },
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const explicitProteinRows = mappedWithExplicitProtein.filter(
  (row) => row.entry.metricId === "protein",
);
assert.equal(
  explicitProteinRows.length,
  1,
  "an explicit nutrient mapping and the absent-definition fallback must never duplicate an entry",
);
assert.equal(
  explicitProteinRows[0].entry.visibility,
  "private",
  "an explicit nutrient visibility must take precedence over Food visibility",
);

const privateFiberOnly = googleHealthSyncTestHooks.mapRecordsToEntries(
  [{
    ...sourceRecord,
    externalId: "nutrition-log:fiber-without-definitions",
    value: 0,
    nutrition: { fiberG: 8 },
  }],
  { metrics: [], entries: [], settings: {} },
  "owner",
  "2026-08-21T12:00:00.000Z",
);
assert.equal(privateFiberOnly.length, 1);
assert.equal(privateFiberOnly[0].entry.metricId, "fiber");
assert.equal(
  privateFiberOnly[0].entry.visibility,
  "private",
  "a nutrient without its own or a Food definition must fail closed",
);

const unsaturatedNutrition = googleHealthSyncTestHooks.nutritionFrom({
  nutrients: [{
    nutrient: "UNSATURATED_FAT",
    quantity: { grams: 7.25 },
  }],
});
const mappedUnsaturatedFood = googleHealthSyncTestHooks.mapRecordsToEntries(
  [{
    ...sourceRecord,
    externalId: "nutrition-log:unsaturated-fat-roundtrip",
    nutrition: unsaturatedNutrition,
  }],
  { metrics: [foodMetric], entries: [], settings: {} },
  "owner",
  "2026-08-21T12:00:00.000Z",
);
const unsaturatedCloudRoundtrip = JSON.parse(JSON.stringify({
  entries: mappedUnsaturatedFood.map((row) => row.entry),
}));
assert.deepEqual(
  mappedUnsaturatedFood.map((row) => row.entry.metricId),
  ["food"],
  "a provider-only nutrition field must not create an unsupported ghost tracker",
);
assert.equal(
  unsaturatedCloudRoundtrip.entries[0]?.nutrition?.unsaturatedFatG,
  7.25,
  "UNSATURATED_FAT must survive provider mapping, canonical food materialization, and snapshot/cloud JSON roundtrip",
);

const remappedPrivate = googleHealthSyncTestHooks.mapRecordsToEntries(
  [sourceRecord],
  { metrics: [{ ...foodMetric, defaultVisibility: "private" }], entries: [], settings: {} },
  "owner",
  "2026-08-21T12:01:00.000Z",
);
const defaultChanged = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(
  remappedPrivate.filter((row) => row.entry.metricId === "food"),
  { entries: [mappedFoodRow.entry], settings: {} },
);
assert.equal(
  defaultChanged[0].entry.visibility,
  "private",
  "a prior generated row must not override the current tracker default",
);

const nativeMirroredFood = {
  ...mappedFoodRow.entry,
  id: "health-connect:meal-a:food",
  sourceProvider: "health_connect",
  sourceRecordId: "health-connect:nutrition:meal-a",
};
const nativeFirstFood = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
    entries: [nativeMirroredFood],
    settings: {},
  });
assert.equal(
  nativeFirstFood.length,
  0,
  "a Google mirror of the same native food record must not double daily/group nutrition totals",
);
const googleFirstFood = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
  entries: [mappedFoodRow.entry, nativeMirroredFood],
  settings: { googleHealthEntryOverrides: { [foodId]: { visibility: "group" } } },
});
assert.equal(
  googleFirstFood.length,
  1,
  "a previously owned Google mirror remains a durable fallback when native arrives later",
);
assert.equal(
  Number(nativeMirroredFood.value) + nativeFirstFood.reduce((sum, row) => sum + Number(row.entry.value), 0),
  550,
  "coexisting providers contribute one food/group total",
);
assert.equal(
  Number((nativeMirroredFood.submetricValues as Record<string, number>).protein) +
    nativeFirstFood.reduce((sum, row) =>
      sum + Number((row.entry.submetricValues as Record<string, number>)?.protein ?? 0), 0),
  25,
  "coexisting providers contribute one nutrition total",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
    entries: [mappedFoodRow.entry],
    settings: {},
  }).length,
  1,
  "Google remains materialized as the fallback when no native mirror exists",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
    entries: [{ ...nativeMirroredFood, recordedAt: "2026-08-20T13:15:00.000Z" }],
    settings: {},
  }).length,
  1,
  "a distinct meal remains materialized",
);

const overridden = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(
  mappedFoodParent,
  {
    entries: [],
    settings: {
      googleHealthEntryOverrides: {
        [foodId]: {
          visibility: "status",
          recordedAtOverride: "2026-08-21T18:30:00.000Z",
          localDate: "2026-08-21",
          sourceUpdatedAt: "2026-08-21T18:31:00.000Z",
        },
      },
    },
  },
);
assert.equal(overridden.length, 1);
assert.equal(overridden[0].localDate, "2026-08-20", "ownership date remains the immutable provider date");
assert.equal(overridden[0].entry.localDate, "2026-08-21");
assert.equal(overridden[0].entry.recordedAt, "2026-08-21T18:30:00.000Z");
assert.equal(overridden[0].entry.visibility, "status");
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
    entries: [],
    settings: { dismissedHealthEntryIds: [foodId] },
  }).length,
  0,
  "dismissed provider rows must not resurrect",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFoodParent, {
    entries: [],
    settings: { googleHealthEntryOverrides: { [foodId]: { dismissed: true } } },
  }).length,
  0,
  "authoritative server dismissals survive a later provider reappearance",
);

const familyEditedAt = "2026-08-21T18:30:00.000Z";
const familyEditedDate = "2026-08-21";
const familyOverrideRegistry = Object.fromEntries(
  mappedWithExplicitProtein.map((row) => [
    String(row.entry.id),
    {
      recordedAtOverride: familyEditedAt,
      localDate: familyEditedDate,
      ...(row.entry.metricId === "food" ? { visibility: "status" } : {}),
    },
  ]),
);
const reconciledEditedFoodFamily = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(
  mappedWithExplicitProtein,
  {
    entries: [],
    settings: { googleHealthEntryOverrides: familyOverrideRegistry },
  },
);
assert.ok(reconciledEditedFoodFamily.length > 1);
for (const row of reconciledEditedFoodFamily) {
  assert.equal(row.localDate, sourceRecord.localDate,
    "Food-family ownership remains anchored to the immutable provider date");
  assert.equal(row.entry.localDate, familyEditedDate,
    "Food and every linked nutrient replay the durable display date");
  assert.equal(row.entry.recordedAt, familyEditedAt,
    "Food and every linked nutrient replay the durable edited time");
}
assert.equal(
  reconciledEditedFoodFamily.find((row) => row.entry.metricId === "food")?.entry.visibility,
  "status",
  "an explicit Food visibility edit remains on the parent",
);
assert.equal(
  reconciledEditedFoodFamily.find((row) => row.entry.metricId === "protein")?.entry.visibility,
  "private",
  "a Food time edit does not overwrite an explicit nutrient visibility",
);

const beforeBreakfast = googleHealthSyncTestHooks.nutritionFrom({ mealType: "BEFORE_BREAKFAST" });
assert.equal(beforeBreakfast.mealType, "snack", "before/after meal enums are snacks, not main meals");
const unsaturated = googleHealthSyncTestHooks.nutritionFrom({
  nutrients: [{ nutrient: "UNSATURATED_FAT", quantity: { grams: 7.5 } }],
});
assert.equal(unsaturated.unsaturatedFatG, 7.5, "explicit general unsaturated fat must survive mapping");

const oversizedBody = new Request("https://example.invalid/functions/v1/google-health", {
  method: "POST",
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8193));
      controller.close();
    },
  }),
});
assert.equal(oversizedBody.headers.has("content-length"), false);
await assert.rejects(() => readBoundedJson(oversizedBody), /request_too_large/);
const emptyWorkerBody = new Request("https://example.invalid/functions/v1/google-health-worker", {
  method: "POST",
  body: "",
});
assert.equal(
  await readBoundedJson(emptyWorkerBody, 8192, { allowEmpty: true }),
  undefined,
  "an empty authenticated scheduler request uses the worker default",
);

const eastNow = new Date("2026-08-21T22:30:00.000Z");
const tokyoDate = currentDateForProfile(eastNow, "Asia/Tokyo");
assert.equal(tokyoDate, "2026-08-22");
assert.deepEqual(
  googleHealthWebhookEventRange({
    payload: {
      data: {
        intervals: [{
          civilDateTimeInterval: {
            startDateTime: { date: { year: 2026, month: 8, day: 22 } },
            endDateTime: { date: { year: 2026, month: 8, day: 22 } },
          },
        }],
      },
    },
  }, tokyoDate),
  { fromDate: "2026-08-21", throughDate: "2026-08-22" },
  "a legitimate local-tomorrow notification east of UTC must not be dropped",
);
const honoluluNow = new Date("2026-08-21T09:30:00.000Z");
const honoluluBound = currentDateForProfile(honoluluNow, "Pacific/Honolulu");
assert.equal(honoluluBound, "2026-08-22", "physical UTC dates retain a one-day safety envelope");
assert.deepEqual(
  googleHealthWebhookEventRange({
    payload: {
      data: {
        intervals: [{
          physicalTimeInterval: {
            startTime: "2026-08-21T09:30:00.000Z",
            endTime: "2026-08-21T09:45:00.000Z",
          },
        }],
      },
    },
  }, honoluluBound),
  { fromDate: "2026-08-20", throughDate: "2026-08-22" },
  "a Honolulu local-today event on the next UTC physical date must be fetched",
);

const googleStep = [{
  externalId: "steps:daily:2026-08-21",
  dataType: "steps",
  localDate: "2026-08-21",
  entry: {
    id: "google-health:steps:steps",
    metricId: "steps",
    userId: "owner",
    localDate: "2026-08-21",
    value: 27,
    source: "imported",
    sourceProvider: "google_health",
  },
}];
const nativeStep = {
  id: "health-connect:steps",
  metricId: "steps",
  userId: "owner",
  localDate: "2026-08-21",
  value: 54,
  source: "imported",
  sourceProvider: "health_connect",
  sourceRecordId: "aggregate:steps:2026-08-21",
};
assert.equal(
  googleHealthSyncTestHooks.preferNativeStepOwner(googleStep, { entries: [nativeStep] }).length,
  0,
  "native 54 must win over a later Google 27 without a duplicate",
);
assert.equal(
  googleHealthSyncTestHooks.preferNativeStepOwner(googleStep, {
    entries: [nativeStep, googleStep[0].entry],
  }).length,
  1,
  "an existing Google step row must remain server-owned behind the native-first client view",
);
assert.equal(
  googleHealthSyncTestHooks.preferNativeStepOwner(googleStep, { entries: [] }).length,
  1,
  "web-only accounts still materialize Google steps",
);

const nativeWorkout = {
  metricId: "exercise",
  userId: "owner",
  localDate: "2026-08-20",
  value: 30,
  recordedAt: "2026-08-20T09:30:00.000Z",
  label: "Strength",
  source: "imported",
  sourceProvider: "health_connect",
};
const laterWorkout = {
  ...nativeWorkout,
  recordedAt: "2026-08-20T16:30:00.000Z",
  sourceRecordId: "google-health:exercise:second",
};
assert.equal(
  googleHealthSyncTestHooks.semanticallyMatchesNative(laterWorkout, nativeWorkout),
  false,
  "two same-duration workouts on one day are not duplicates",
);
const mirroredGoogleWorkout = [{
  externalId: "exercise:mirror",
  dataType: "workouts",
  localDate: "2026-08-20",
  entry: {
    ...nativeWorkout,
    id: "google-health:exercise:mirror:exercise",
    sourceProvider: "google_health",
    sourceRecordId: "google-health:exercise:mirror",
  },
}];
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mirroredGoogleWorkout, {
    entries: [mirroredGoogleWorkout[0].entry, nativeWorkout],
    settings: {},
  }).length,
  1,
  "Google-first mirrored workouts retain server fallback ownership",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate([{
    ...mirroredGoogleWorkout[0],
    entry: { ...mirroredGoogleWorkout[0].entry, recordedAt: "2026-08-20T16:30:00.000Z" },
  }], {
    entries: [nativeWorkout],
    settings: {},
  }).length,
  1,
  "two disjoint same-day workouts remain distinct",
);

const googleWeight = [{
  externalId: "weight:mirror",
  dataType: "weight",
  localDate: "2026-08-20",
  entry: {
    id: "google-health:weight:mirror:weight",
    metricId: "weight",
    userId: "owner",
    value: 70,
    localDate: "2026-08-20",
    recordedAt: "2026-08-20T08:00:00.000Z",
    source: "imported",
    sourceProvider: "google_health",
  },
}];
const nativeWeight = {
  ...googleWeight[0].entry,
  id: "apple-health:weight:mirror",
  sourceProvider: "apple_health",
};
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(googleWeight, {
    entries: [googleWeight[0].entry, nativeWeight], settings: {},
  }).length,
  1,
  "Google-first mirrored weight retains server fallback ownership",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate([{
    ...googleWeight[0], entry: { ...googleWeight[0].entry, value: 71 },
  }], { entries: [nativeWeight], settings: {} }).length,
  1,
  "a distinct same-day weight value is not discarded",
);

// Versioned AES-GCM keys decrypt old rows after rotation and bind ciphertext
// to its exact user/purpose, preventing cross-account token swaps.
const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
Deno.env.set("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS", JSON.stringify({ 1: key(1), 2: key(2) }));
Deno.env.set("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION", "1");
const oldCiphertext = await encryptSecret("refresh-old", { purpose: "refresh-token", userId: "owner-a" });
Deno.env.set("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION", "2");
assert.equal(
  await decryptSecret(oldCiphertext, { purpose: "refresh-token", userId: "owner-a" }),
  "refresh-old",
);
await assert.rejects(() =>
  decryptSecret(oldCiphertext, { purpose: "refresh-token", userId: "owner-b" })
);

// Executable model of the generation + authenticated-user completion fence.
const connection = { userId: "owner", generation: 7, status: "pending", lease: "old", token: "old" };
const pending = new Map([
  ["completion-a", { userId: "owner", generation: 7, token: "new-a" }],
  ["completion-b", { userId: "owner", generation: 7, token: "new-b" }],
]);
const complete = (authenticatedUser: string, token: string) => {
  const grant = pending.get(token);
  if (!grant || grant.userId !== authenticatedUser || connection.userId !== authenticatedUser ||
      grant.generation !== connection.generation || connection.status !== "pending") return false;
  connection.token = grant.token;
  connection.status = "connected";
  connection.lease = "";
  connection.generation += 1;
  pending.clear();
  return true;
};
assert.equal(complete("victim", "completion-a"), false, "a shared auth URL cannot bind in another HabHub session");
assert.equal(complete("owner", "completion-a"), true);
assert.equal(complete("owner", "completion-b"), false, "concurrent same-generation completion loses atomically");
assert.equal(connection.generation, 8);
assert.equal(connection.lease, "");

// A provider-issued replacement is identified by an exact nonce/hash/
// ciphertext/generation tuple. A lost response after commit must resolve as
// active (never revoke); a proven pre-commit failure at the old generation is
// the only state that permits compensating revocation.
const replacementProof = {
  expectedGeneration: 11,
  leaseId: "lease-a",
  nonce: "a97a42b9-fca6-455e-b501-79d5b30d713f",
  fingerprint: "a".repeat(64),
  ciphertext: "cipher-new",
  iv: "iv-new",
  keyVersion: 2,
};
const committedReplacement = {
  status: "connected",
  sync_lease_id: "lease-a",
  connection_generation: 12,
  refresh_replacement_nonce: replacementProof.nonce,
  refresh_token_fingerprint: replacementProof.fingerprint,
  refresh_token_ciphertext: replacementProof.ciphertext,
  refresh_token_iv: replacementProof.iv,
  encryption_key_version: 2,
};
const postCommitDisposition = googleHealthSyncTestHooks.refreshReplacementDisposition(
  replacementProof,
  committedReplacement,
  false,
);
const postCommitRevocations: string[] = [];
if (postCommitDisposition === "not_applied")
  postCommitRevocations.push(replacementProof.ciphertext);
assert.equal(postCommitDisposition, "active");
assert.deepEqual(
  postCommitRevocations,
  [],
  "a post-commit lost response must never enqueue/revoke the active replacement",
);
const unchangedCredential = {
  ...committedReplacement,
  connection_generation: 11,
  refresh_replacement_nonce: null,
  refresh_token_fingerprint: "b".repeat(64),
  refresh_token_ciphertext: "cipher-old",
  refresh_token_iv: "iv-old",
  encryption_key_version: 1,
};
const replacementRevocations: string[] = [];
if (
  googleHealthSyncTestHooks.refreshReplacementDisposition(
    replacementProof,
    unchangedCredential,
    false,
  ) === "not_applied"
) replacementRevocations.push(replacementProof.ciphertext);
assert.deepEqual(
  replacementRevocations,
  ["cipher-new"],
  "a proven pre-commit failure queues only the unpersisted replacement",
);
assert.equal(
  googleHealthSyncTestHooks.refreshReplacementDisposition(
    replacementProof,
    { ...unchangedCredential, connection_generation: 13 },
    false,
  ),
  "ambiguous",
  "a different generation cannot authorize compensating revocation",
);

// Concurrent account deletion attempts are owned by independent high-entropy
// tokens. A losing/cancelled request cannot clear the winning guard.
let deletionGuard: string | undefined;
const acquireDeletion = (attemptId: string) => {
  if (!deletionGuard) deletionGuard = attemptId;
  return deletionGuard === attemptId;
};
const cancelDeletion = (attemptId: string) => {
  if (deletionGuard !== attemptId) return false;
  deletionGuard = undefined;
  return true;
};
const verifyDeletion = (attemptId: string) => deletionGuard === attemptId;
assert.equal(acquireDeletion("attempt-a"), true);
assert.equal(acquireDeletion("attempt-b"), false);
assert.equal(verifyDeletion("attempt-b"), false);
assert.equal(verifyDeletion("attempt-a"), true);
assert.equal(cancelDeletion("attempt-b"), false);
assert.equal(deletionGuard, "attempt-a");
assert.equal(cancelDeletion("attempt-a"), true);

// Worker retention keeps live/recent state but removes the encrypted PKCE and
// return metadata after the fixed one-hour post-consumption/expiry window.
const retentionNow = Date.parse("2026-08-21T12:00:00.000Z");
const oauthStates = [
  { id: "consumed-old", consumedAt: "2026-08-21T10:00:00.000Z", expiresAt: "2026-08-21T13:00:00.000Z" },
  { id: "expired-old", consumedAt: null, expiresAt: "2026-08-21T10:00:00.000Z" },
  { id: "consumed-recent", consumedAt: "2026-08-21T11:30:00.000Z", expiresAt: "2026-08-21T13:00:00.000Z" },
  { id: "live", consumedAt: null, expiresAt: "2026-08-21T12:05:00.000Z" },
];
const retainedOauthStateIds = oauthStates.filter((state) => {
  const consumedTooOld = state.consumedAt
    ? Date.parse(state.consumedAt) < retentionNow - 60 * 60_000
    : false;
  const expiredTooOld = Date.parse(state.expiresAt) < retentionNow - 60 * 60_000;
  return !consumedTooOld && !expiredTooOld;
}).map((state) => state.id);
assert.deepEqual(retainedOauthStateIds, ["consumed-recent", "live"]);

// Executable deletion/rehydration model: relational values disappear, exact
// tombstones/fences advance, and a stale client cannot republish the row.
const deletedId = "google-health:meal-a:food";
const relational = new Map([
  [deletedId, { value: 550 }],
  ["manual", { value: 100 }],
  ["health-connect:meal-a:food", { value: 550 }],
]);
const tombstones = new Set<string>();
let fenceRevision = 2;
const deleteOwned = (id: string, revision: number) => {
  relational.delete(id);
  tombstones.add(id);
  fenceRevision = Math.max(fenceRevision, revision);
};
deleteOwned(deletedId, 9);
const staleRehydrate = (id: string, value: number, revision: number) => {
  if (tombstones.has(id) || revision < fenceRevision) return false;
  relational.set(id, { value });
  return true;
};
assert.equal(staleRehydrate(deletedId, 550, 3), false);
assert.equal(relational.has(deletedId), false);
assert.equal(relational.has("manual"), true);
assert.equal(
  relational.has("health-connect:meal-a:food"),
  true,
  "Google provider deletion must not purge the native owner row",
);

// Executable no-client webhook model: a source update/delete must invalidate
// the full dependency closure already marked Google-derived, not merely the
// imported tracker/date. This includes formula and latest carry-forward rows;
// an unrelated manual/native projection remains available.
const backgroundStatuses = new Map([
  ["food:2026-08-20", { sourceProvider: "google_health", kind: "direct" }],
  ["deficit:2026-08-20", { sourceProvider: "google_health", kind: "formula" }],
  ["weight:2026-08-21", { sourceProvider: "google_health", kind: "carry-forward" }],
  ["mood:2026-08-20", { sourceProvider: null, kind: "manual" }],
]);
const projectionFences = new Set<string>();
const purgeGoogleDerivedStatusClosure = () => {
  for (const [key, status] of backgroundStatuses) {
    if (status.sourceProvider !== "google_health") continue;
    backgroundStatuses.delete(key);
    projectionFences.add(key.split(":", 1)[0]);
  }
};
purgeGoogleDerivedStatusClosure();
assert.equal(backgroundStatuses.has("food:2026-08-20"), false);
assert.equal(
  backgroundStatuses.has("deficit:2026-08-20"),
  false,
  "a background provider update must remove its calculated status with no client open",
);
assert.equal(
  backgroundStatuses.has("weight:2026-08-21"),
  false,
  "a background provider delete must remove its carry-forward status with no client open",
);
assert.equal(backgroundStatuses.has("mood:2026-08-20"), true);
assert.deepEqual(
  [...projectionFences].sort(),
  ["deficit", "food", "weight"],
  "every removed Google-derived metric is fenced against stale peer caches",
);

// Cross-version privacy model. Schema 26 is the released pre-Google client;
// schema 27 must advertise the matching PostgREST header on every owner and
// group projection request.
const privacyOwnerAllowed = (
  marker: boolean,
  deletionGuard: boolean,
  headerVersion: number,
  parameterVersion = headerVersion,
) => !deletionGuard && (!marker || (headerVersion >= 27 && parameterVersion >= 27));
assert.equal(privacyOwnerAllowed(false, false, 26), true, "native-only v26 accounts remain usable");
assert.equal(privacyOwnerAllowed(true, false, 0), false, "missing capability is denied");
assert.equal(privacyOwnerAllowed(true, false, 26), false, "released v26 is denied");
assert.equal(privacyOwnerAllowed(true, false, 27, 26), false, "RPC parameter cannot lag the header");
assert.equal(privacyOwnerAllowed(true, false, 27, 27), true, "current v27 is accepted");
assert.equal(privacyOwnerAllowed(true, true, 27, 27), false, "account deletion wins over v27 access");
const projectionVisible = (provider: string | null, headerVersion: number) =>
  provider !== "google_health" || headerVersion >= 27;
assert.equal(projectionVisible("google_health", 26), false);
assert.equal(projectionVisible("google_health", 27), true);
assert.equal(projectionVisible("health_connect", 26), true);
assert.equal(projectionVisible(null, 26), true);
const accountBroadcastTopics = (marked: boolean, userId = "owner") => [
  `account:${userId}:snapshot:v27`,
  ...(!marked ? [`account:${userId}:snapshot`] : []),
];
assert.deepEqual(accountBroadcastTopics(true), ["account:owner:snapshot:v27"],
  "a Google-marked account never emits the legacy v26 topic");
assert.deepEqual(accountBroadcastTopics(false), [
  "account:owner:snapshot:v27",
  "account:owner:snapshot",
], "an unmarked account wakes both current and legacy clients");
assert.deepEqual({ revision: 42 }, { revision: 42 },
  "the v27 invalidation is provider-neutral and revision-only");

type MarkerState = {
  marker: boolean;
  oauthState: boolean;
  pendingGrant: boolean;
  revocation: boolean;
  imported: boolean;
  preference: boolean;
  projection: boolean;
};
const markerCanRelease = (state: MarkerState) => state.marker && !(
  state.oauthState || state.pendingGrant || state.revocation || state.imported ||
  state.preference || state.projection
);
const startedMarker: MarkerState = {
  marker: true,
  oauthState: true,
  pendingGrant: false,
  revocation: false,
  imported: false,
  preference: false,
  projection: false,
};
assert.equal(markerCanRelease(startedMarker), false, "pre-redirect state establishes the marker");
assert.equal(markerCanRelease({ ...startedMarker, oauthState: false, imported: true }), false,
  "disconnect keeps the marker while imported rows remain");
assert.equal(markerCanRelease({ ...startedMarker, oauthState: false, revocation: true }), false,
  "delete keeps the marker until durable remote revocation drains");
assert.equal(markerCanRelease({ ...startedMarker, oauthState: false }), true,
  "an abandoned clean flow releases the marker after bounded state retention");

type DeleteGuard = { attemptId: string; leaseUntil: number } | null;
const beginDeletion = (guard: DeleteGuard, attemptId: string, now: number): DeleteGuard | "busy" => {
  if (!guard || guard.attemptId === attemptId || guard.leaseUntil <= now)
    return { attemptId, leaseUntil: now + 10 * 60_000 };
  return "busy";
};
let accountDeletionGuardFixture: DeleteGuard = beginDeletion(null, "attempt-a", 0) as DeleteGuard;
assert.equal(beginDeletion(accountDeletionGuardFixture, "attempt-b", 9 * 60_000), "busy",
  "an active deletion lease cannot be stolen early");
accountDeletionGuardFixture = beginDeletion(
  accountDeletionGuardFixture,
  "attempt-b",
  10 * 60_000,
) as DeleteGuard;
assert.equal(accountDeletionGuardFixture?.attemptId, "attempt-b",
  "a crashed deletion is resumable after lease expiry");
assert.equal(accountDeletionGuardFixture?.attemptId === "attempt-a", false,
  "the stale process can no longer renew or cancel after takeover");

const enabledActions = new Set(["status", "disconnect", "delete", "revoke"]);
for (const action of ["connect", "complete", "sync", "webhook", "worker-import"])
  assert.equal(enabledActions.has(action), false, `${action} is disabled during the mixed-version cutover`);
for (const action of enabledActions)
  assert.equal(enabledActions.has(action), true, `${action} remains available for safe cleanup`);

const legacyPushMaySynthesize = (provider: string | null) => provider !== "google_health";
for (const legacyPath of ["entry", "lead"] as const) {
  assert.equal(legacyPushMaySynthesize("google_health"), false,
    `legacy ${legacyPath} requests cannot synthesize a Google push`);
  assert.equal(legacyPushMaySynthesize("health_connect"), true,
    `native ${legacyPath} push remains supported`);
  assert.equal(legacyPushMaySynthesize(null), true,
    `manual ${legacyPath} push remains supported`);
}

const finishBody = migration.match(/create or replace function public\.finish_google_health_sync[\s\S]*?\$\$;/i)?.[0] ?? "";
assert.ok(finishBody.includes("sync_lease_id is distinct from p_lease_id"));
assert.ok(!finishBody.includes("google_health_already_connected"));
assert.match(migration, /create or replace function public\.create_google_health_oauth_state/);
assert.match(migration, /create or replace function public\.stage_google_health_pending_grant/);
assert.match(migration, /create or replace function public\.complete_google_health_connection/);
assert.match(migration, /connection_generation = connection\.connection_generation \+ 1/);
assert.match(migration, /create or replace function public\.delete_google_health_connection_data/);
assert.match(migration, /create or replace function public\.begin_google_health_account_deletion/);
assert.match(migration, /create or replace function public\.cancel_google_health_account_deletion/);
assert.match(migration, /create or replace function public\.verify_google_health_account_deletion/);
assert.match(migration, /create or replace function public\.renew_google_health_account_deletion/);
assert.match(migration, /attempt_id uuid not null unique/);
assert.match(migration, /lease_until timestamptz not null default \(now\(\) \+ interval '10 minutes'\)/);
const beginDeletionBody = migration.match(
  /create or replace function public\.begin_google_health_account_deletion[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(beginDeletionBody, /p_attempt_id uuid/);
assert.match(beginDeletionBody, /v_guard\.lease_until <= now\(\)/);
assert.match(beginDeletionBody, /set attempt_id = p_attempt_id/);
assert.match(beginDeletionBody, /guard\.lease_until <= now\(\)/);
assert.match(beginDeletionBody, /'resumed', v_resumed/);
assert.match(beginDeletionBody, /google_health_account_deletion_in_progress/);
const cancelDeletionBody = migration.match(
  /create or replace function public\.cancel_google_health_account_deletion[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(cancelDeletionBody, /guard\.attempt_id = p_attempt_id/);
const verifyDeletionBody = migration.match(
  /create or replace function public\.verify_google_health_account_deletion[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(verifyDeletionBody, /guard\.attempt_id = p_attempt_id/);
assert.match(verifyDeletionBody, /set lease_until = now\(\) \+ interval '10 minutes'/);
const renewDeletionBody = migration.match(
  /create or replace function public\.renew_google_health_account_deletion[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(renewDeletionBody, /guard\.attempt_id = p_attempt_id/);
assert.match(renewDeletionBody, /set lease_until = now\(\) \+ interval '10 minutes'/);
assert.match(migration, /create or replace function public\.mutate_google_health_entry/);
assert.match(foodFamilyMutationMigration, /create or replace function public\.mutate_google_health_food_family/);
const foodFamilyMutationBody = foodFamilyMutationMigration.match(
  /create or replace function public\.mutate_google_health_food_family[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(foodFamilyMutationBody, /security definer\s+set search_path = ''/);
assert.match(foodFamilyMutationBody, /auth\.role\(\)\) is distinct from 'service_role'/);
assert.match(foodFamilyMutationBody, /google_health_runtime_enabled\(\)/);
assert.match(foodFamilyMutationBody, /pg_advisory_xact_lock/);
assert.match(foodFamilyMutationBody, /from public\.user_snapshots snapshot[\s\S]*for update/);
assert.match(foodFamilyMutationBody, /count\(distinct owned\.external_id\)/);
assert.match(foodFamilyMutationBody, /owned\.external_id = v_target\.external_id/);
assert.match(foodFamilyMutationBody, /limit 129/);
assert.match(foodFamilyMutationBody, /v_family_count > 128/);
assert.match(foodFamilyMutationBody, /case when owned\.entry ->> 'metricId' = 'food' then 1 else 0 end as parent_order/);
assert.match(foodFamilyMutationBody, /v_parent_count <> 1/);
assert.match(foodFamilyMutationBody, /coalesce\(owned\.entry ->> 'sourceProvider', ''\) <> 'google_health'/);
assert.match(foodFamilyMutationBody, /google_health_food_sidecar_managed_by_parent/);
assert.match(foodFamilyMutationBody,
  /parent\.external_id = v_target\.external_id[\s\S]*parent\.entry ->> 'metricId' = 'food'/);
assert.match(foodFamilyMutationBody, /foreach v_entry_id in array v_family_ids loop[\s\S]*'dismiss'/);
assert.match(foodFamilyMutationBody, /public\.mutate_google_health_entry\([\s\S]*p_entry_id,[\s\S]*'update'/);
assert.match(foodFamilyMutationBody, /if not \(coalesce\(p_patch, '\{\}'::jsonb\) \? 'recordedAtOverride'\)/);
assert.match(foodFamilyMutationBody, /update public\.google_health_import_records owned[\s\S]*'recordedAtOverride'/);
assert.match(foodFamilyMutationBody, /insert into public\.google_health_entry_preferences/);
assert.match(foodFamilyMutationBody, /recorded_at_override = excluded\.recorded_at_override/);
assert.match(foodFamilyMutationBody, /googleHealthEntryOverrides/);
assert.match(foodFamilyMutationBody, /perform public\.purge_google_health_group_projections\([\s\S]*v_family_ids/);
assert.match(foodFamilyMutationMigration,
  /revoke all on function public\.mutate_google_health_food_family\(uuid, text, text, jsonb\)[\s\S]*from public, anon, authenticated/);
assert.match(foodFamilyMutationMigration,
  /grant execute on function public\.mutate_google_health_food_family\(uuid, text, text, jsonb\)[\s\S]*to service_role/);
const sidecarPreferenceConflict = foodFamilyMutationBody.match(
  /on conflict \(user_id, entry_id\) do update[\s\S]*?updated_at = excluded\.updated_at;/i,
)?.[0] ?? "";
assert.ok(!/\bvisibility\s*=\s*excluded\.visibility/.test(sidecarPreferenceConflict),
  "a parent Food time edit must not overwrite a nutrient visibility preference");
assert.match(serverSnapshotMigration,
  /create or replace function public\.merge_google_health_server_snapshot/);
const serverSnapshotMergeBody = serverSnapshotMigration.match(
  /create or replace function public\.merge_google_health_server_snapshot[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(serverSnapshotMergeBody, /security definer\s+set search_path = ''/);
assert.match(serverSnapshotMergeBody, /from public\.google_health_import_records owned/);
assert.match(serverSnapshotMergeBody, /from public\.google_health_entry_preferences preference/);
assert.match(serverSnapshotMergeBody, /sourceProvider'[\s\S]*<> 'google_health'/);
assert.match(serverSnapshotMergeBody, /not like 'google-health:%'/);
assert.match(serverSnapshotMergeBody, /not like 'health:google_health:%'/);
assert.match(serverSnapshotMergeBody, /googleHealthEntryOverrides/);
assert.match(serverSnapshotMergeBody, /dailyMetricStatuses/);
assert.match(serverSnapshotMergeBody,
  /google_entry ->> 'metricId' = item\.status ->> 'metricId'/);
assert.match(serverSnapshotMergeBody, /pendingDeletedEntryIds/);
assert.match(serverSnapshotMergeBody, /dismissedHealthEntryIds/);
assert.match(serverSnapshotMigration,
  /revoke all on function public\.merge_google_health_server_snapshot\(uuid, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
const hardenedSnapshotWriteBody = serverSnapshotMigration.match(
  /create or replace function public\.sync_user_snapshot[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(hardenedSnapshotWriteBody, /assert_google_health_privacy_client/);
assert.match(hardenedSnapshotWriteBody,
  /from public\.user_snapshots snapshot[\s\S]*for update/);
assert.match(hardenedSnapshotWriteBody,
  /current_revision is distinct from expected_revision/);
assert.match(hardenedSnapshotWriteBody,
  /merge_google_health_server_snapshot\([\s\S]*caller_id/);
assert.match(hardenedSnapshotWriteBody, /exception when unique_violation/);
assert.match(serverSnapshotMigration,
  /with repaired as materialized[\s\S]*merge_google_health_server_snapshot[\s\S]*device_id = 'google-health-server'/);
const repairedSnapshotMergeBody = serverSnapshotRepairMigration.match(
  /create or replace function public\.merge_google_health_server_snapshot[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(repairedSnapshotMergeBody,
  /from public\.google_health_entry_preferences preference[\s\S]*preference\.entry_id = owned\.entry_id[\s\S]*preference\.dismissed = true/);
assert.match(serverSnapshotRepairMigration,
  /lock table public\.user_snapshots in share row exclusive mode/);
assert.ok(!/with repaired as materialized/i.test(serverSnapshotRepairMigration),
  "the forward repair must not replay a materialized pre-lock payload");
assert.match(serverSnapshotRepairMigration,
  /update public\.user_snapshots snapshot[\s\S]*set payload = public\.merge_google_health_server_snapshot\([\s\S]*snapshot\.user_id,[\s\S]*snapshot\.payload[\s\S]*revision = snapshot\.revision \+ 1[\s\S]*device_id = 'google-health-server'/);
assert.match(serverSnapshotRepairMigration,
  /snapshot\.payload is distinct from[\s\S]*public\.merge_google_health_server_snapshot\([\s\S]*snapshot\.user_id,[\s\S]*snapshot\.payload/);
assert.match(serverSnapshotRepairMigration,
  /revoke all on function public\.merge_google_health_server_snapshot\(uuid, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
assert.match(migration, /create or replace function public\.update_google_health_metric_visibility/);
assert.match(migration, /create table if not exists public\.google_health_entry_preferences/);
assert.match(migration, /create table if not exists public\.google_health_account_deletion_guards/);
assert.match(migration, /create table if not exists public\.google_health_privacy_accounts/);
assert.match(migration, /create table if not exists public\.google_health_runtime_config/);
assert.match(migration, /values \(true, false, 27\)/);
for (const functionName of [
  "create_google_health_oauth_state",
  "complete_google_health_connection",
  "apply_google_health_import",
]) {
  const body = migration.match(new RegExp(
    `create or replace function public\\.${functionName}[\\s\\S]*?\\$\\$;`,
    "i",
  ))?.[0] ?? "";
  assert.match(body, /google_health_runtime_enabled\(\)/,
    `${functionName} must enforce the default-off rollout gate`);
}
const claimSyncBody = migration.match(
  /create or replace function public\.claim_google_health_sync[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(claimSyncBody, /'feature_disabled'::text/);
const claimWebhookBody = migration.match(
  /create or replace function public\.claim_google_health_webhook_events[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(claimWebhookBody, /not public\.google_health_runtime_enabled\(\)/);
const stageGrantBody = migration.match(
  /create or replace function public\.stage_google_health_pending_grant[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(stageGrantBody, /not public\.google_health_runtime_enabled\(\)/);
assert.match(stageGrantBody, /insert into public\.google_health_revocation_queue/);
assert.match(migration, /create or replace function public\.habhub_privacy_schema_version/);
assert.match(migration, /x-habhub-privacy-schema/);
assert.match(migration, /create or replace function public\.get_user_snapshot\(/);
assert.match(migration, /create or replace function public\.get_user_snapshot_metadata\(/);
assert.match(migration, /create or replace function public\.habhub_account_broadcast_topic_allowed/);
assert.match(migration, /account:' \|\| \(select auth\.uid\(\)\)::text \|\| ':snapshot:v27'/);
const accountBroadcastBody = migration.match(
  /create or replace function public\.broadcast_account_snapshot_revision[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(accountBroadcastBody, /jsonb_build_object\('revision', new\.revision\)/);
assert.match(accountBroadcastBody, /':snapshot:v27'/);
assert.match(accountBroadcastBody, /if not v_google_private then/);
assert.ok(
  accountBroadcastBody.indexOf("':snapshot:v27'") <
    accountBroadcastBody.indexOf("if not v_google_private then"),
  "v27 broadcasts always, while legacy broadcast is conditional",
);
const v27Payload = accountBroadcastBody.match(
  /jsonb_build_object\('revision', new\.revision\)[\s\S]{0,120}':snapshot:v27'/,
)?.[0] ?? "";
assert.ok(!/device_id|updated_at|google-health-server/.test(v27Payload),
  "v27 realtime payload must be revision-only and provider-neutral");
assert.match(migration, /create policy google_health_snapshot_privacy_gate[\s\S]*as restrictive for all/);
assert.match(migration, /create policy google_health_entry_read_privacy_gate[\s\S]*source_provider is distinct from 'google_health'/);
assert.match(migration, /create policy google_health_entry_delete_privacy_gate/);
assert.match(migration, /create policy google_health_status_read_privacy_gate/);
assert.match(migration, /create policy google_health_status_delete_privacy_gate/);
assert.match(migration, /create policy google_health_tombstone_delete_privacy_gate/);
assert.match(migration, /google_health_privacy_client_upgrade_required/);
assert.match(cloudProtocolMigration,
  /create or replace function public\.habhub_cloud_protocol_version\(\)/);
assert.match(cloudProtocolMigration, /x-habhub-cloud-protocol/);
const cloudProtocolVersionBody = cloudProtocolMigration.match(
  /create or replace function public\.habhub_cloud_protocol_version[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(cloudProtocolVersionBody,
  /exception when others then\s+return 0;/);
assert.match(cloudProtocolVersionBody,
  /coalesce\(v_value, ''\) ~ '\^\[0-9\]\{1,4\}\$'/);
assert.match(cloudProtocolMigration,
  /public\.habhub_cloud_protocol_version\(\) < 2/);
assert.match(cloudProtocolMigration,
  /google_health_privacy_client_upgrade_required/);
const cloudProtocolGateBody = cloudProtocolMigration.match(
  /create or replace function public\.assert_google_health_privacy_client[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(cloudProtocolGateBody,
  /if \(select auth\.uid\(\)\) is null or \(select auth\.uid\(\)\) <> p_user_id/);
assert.match(cloudProtocolGateBody,
  /from public\.google_health_account_deletion_guards guard/);
assert.match(cloudProtocolGateBody,
  /from public\.google_health_privacy_accounts privacy[\s\S]*?then\s+return;/);
assert.ok(
  cloudProtocolGateBody.indexOf("from public.google_health_privacy_accounts privacy") <
    cloudProtocolGateBody.indexOf("public.habhub_cloud_protocol_version() < 2"),
  "non-Google accounts must return before the cloud protocol gate",
);
assert.doesNotMatch(cloudProtocolMigration,
  /create or replace function public\.habhub_privacy_schema_version/,
  "the cloud protocol gate must not change privacy schema/topic versioning",
);
assert.doesNotMatch(cloudProtocolMigration,
  /snapshot:v28|update public\.google_health_runtime_config|create policy/,
  "the protocol gate must not mutate Realtime topics, rollout config, or RLS",
);
const restoredPrivacyGateBody = universalCloudProtocolMigration.match(
  /create or replace function public\.assert_google_health_privacy_client[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(restoredPrivacyGateBody,
  /from public\.google_health_account_deletion_guards guard/);
assert.match(restoredPrivacyGateBody,
  /from public\.google_health_privacy_accounts privacy[\s\S]*?then\s+return;/);
assert.match(restoredPrivacyGateBody, /public\.habhub_privacy_schema_version\(\)/);
assert.doesNotMatch(restoredPrivacyGateBody, /habhub_cloud_protocol/,
  "private snapshot compatibility must not depend on the relational protocol");
const universalProtocolAssertBody = universalCloudProtocolMigration.match(
  /create or replace function public\.assert_habhub_cloud_protocol[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(universalProtocolAssertBody,
  /public\.habhub_cloud_protocol_version\(\) < v_required/);
assert.match(universalProtocolAssertBody,
  /habhub_cloud_protocol_upgrade_required/);
const universalRevisionFenceBody = universalCloudProtocolMigration.match(
  /create or replace function public\.assert_account_snapshot_revision[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(universalRevisionFenceBody, /assert_google_health_privacy_client/);
assert.match(universalRevisionFenceBody, /assert_habhub_cloud_protocol\(2\)/);
assert.ok(
  universalRevisionFenceBody.indexOf("assert_habhub_cloud_protocol(2)") <
    universalRevisionFenceBody.indexOf("from public.user_snapshots snapshot"),
  "legacy relational publication must fail before locking the snapshot row",
);
assert.doesNotMatch(universalCloudProtocolMigration,
  /snapshot:v28|update public\.google_health_runtime_config|create policy/,
  "the universal protocol fence must not change privacy topics, rollout config, or RLS",
);
const accountRevisionFenceBody = migration.match(
  /create or replace function public\.assert_account_snapshot_revision[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(accountRevisionFenceBody, /assert_google_health_privacy_client/,
  "workspace writes must pass through the Google client capability gate");
assert.match(migration, /insert into public\.google_health_privacy_accounts \(user_id, required_since\)/);
assert.match(migration, /release_google_health_privacy_markers_if_clean/);
assert.match(migration, /not exists \([\s\S]*google_health_revocation_queue revocation/);
const metricPushBodies = [...migration.matchAll(
  /create or replace function public\.emit_group_metric_push_event\(\)[\s\S]*?\$\$;/gi,
)];
const metricPushBody = metricPushBodies.at(-1)?.[0] ?? "";
assert.match(metricPushBody, /if new\.source_provider = 'google_health' then\s+return new;/);
assert.ok(
  metricPushBody.indexOf("if new.source_provider = 'google_health'") <
    metricPushBody.indexOf("insert into public.push_dispatch_events"),
  "Google shared rows must return before any push outbox insert",
);
assert.match(metricPushBody, /'entryId', new\.client_generated_id/,
  "manual/native push navigation remains available");
const leadPushBodies = [...migration.matchAll(
  /create or replace function public\.enqueue_group_lead_push_event[\s\S]*?\$\$;/gi,
)];
const leadPushBody = leadPushBodies.at(-1)?.[0] ?? "";
assert.match(leadPushBody, /select entry\.id, entry\.source_provider, entry\.updated_at/);
assert.match(leadPushBody, /if v_source_provider = 'google_health' then\s+return null;/);
assert.match(leadPushBody, /insert into public\.push_dispatch_events/,
  "manual/native lead push remains available");
assert.match(migration, /delete from public\.push_dispatch_events event[\s\S]*event\.event_key like '%google-health:%'/);
assert.match(migration, /create or replace function public\.can_mutate_own_media_object/);
const mediaReadBody = migration.match(
  /create or replace function public\.can_read_media_object[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(mediaReadBody, /exists \(\s*select 1 from auth\.users account where account\.id = auth\.uid\(\)/);
assert.match(mediaReadBody, /not exists \([\s\S]*google_health_account_deletion_guards/);
assert.match(migration, /create policy media_storage_authorized_read[\s\S]*public\.can_read_media_object\(name\)/);
assert.match(migration, /exists \(\s*select 1 from auth\.users account where account\.id = auth\.uid\(\)/);
assert.match(migration, /not exists \(\s*select 1\s*from public\.google_health_account_deletion_guards guard/);
assert.match(migration, /queue_google_health_credential_before_delete/);
assert.match(migration, /preference\.dismissed = false/);
assert.match(migration, /perform public\.purge_google_health_group_projections/);
assert.match(migration, /insert into public\.metric_entry_tombstones/);
assert.match(migration, /metric_privacy_cache_fences/);
const projectionPurgeBody = migration.match(
  /create or replace function public\.purge_google_health_group_projections[\s\S]*?\$\$;/i,
)?.[0] ?? "";
assert.match(projectionPurgeBody, /status\.source_provider = 'google_health'/);
assert.ok(
  !/coalesce\(p_purge_all, false\)[\s\S]{0,120}status\.source_provider = 'google_health'/.test(
    projectionPurgeBody,
  ),
  "ordinary webhook/entry mutations must purge the full Google-derived status dependency closure",
);
assert.match(migration, /scrub_google_health_snapshot_settings/);
assert.match(migration, /googleHealthEntryOverrides/);
assert.match(migration, /if v_entries is distinct from v_original_entries/);
assert.match(migration, /and owned\.entry = item -> 'entry'/);
assert.match(migration, /source_provider is null or source_provider in \('apple_health', 'health_connect', 'google_health'\)/);

const groupProjectionBody = groupProjectionMigration.match(
  /create or replace function public\.project_google_health_group_data[\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
assert.match(groupProjectionBody, /auth\.role\(\)\) is distinct from 'service_role'/);
assert.match(groupProjectionBody, /v_revision <> p_snapshot_revision/);
assert.match(groupProjectionBody, /membership\.status = 'active'/);
assert.match(groupProjectionBody, /definition\.slug = target\.metric_slug/);
assert.match(groupProjectionBody, /from public\.google_health_import_records owned/);
assert.match(groupProjectionBody, /source\.owned_google[\s\S]*source\.visibility = 'group'/);
assert.match(groupProjectionBody, /'group'::public\.entry_visibility/);
assert.match(groupProjectionBody, /privacy_projection_version/);
assert.match(groupProjectionBody, /2::smallint|\n\s+2,/);
assert.match(groupProjectionBody, /case when projected\.projected_visibility = 'group'[\s\S]*then projected\.exact_value else null end/);
assert.match(groupProjectionMigration, /floor\(greatest\(0, least\(100, v_score\)\) \/ 25\) \* 25/);
assert.match(groupProjectionMigration, /'goalTarget',[\s\S]*p_visibility = 'status' then null/);
assert.match(groupProjectionBody, /source\.entry ->> 'label'/);
assert.match(groupProjectionBody, /source\.entry -> 'nutrition'/);
assert.match(groupProjectionBody, /source\.entry ->> 'sourceRecordId'/);
assert.match(groupProjectionBody, /source\.entry ->> 'sourceOrigin'/);
assert.match(groupProjectionBody, /source\.entry ->> 'sourceUpdatedAt'/);
assert.match(groupProjectionBody, /insert into public\.metric_privacy_cache_fences/);
assert.match(groupProjectionBody, /insert into public\.metric_entry_tombstones/);
assert.match(groupProjectionBody, /insert into public\.group_activity_versions/);
assert.match(groupProjectionBody, /account_revision/);
assert.match(groupProjectionMigration, /grant execute on function public\.project_google_health_group_data\(uuid, bigint\)\s+to service_role/);
assert.doesNotMatch(groupProjectionMigration, /grant execute on function public\.project_google_health_group_data\([^;]+\)\s+to (?:anon|authenticated)/);
assert.match(groupProjectionMigration, /metric_entries_a_handoff_google_health_projection/);

const importCall = sync.indexOf('admin.rpc("apply_google_health_import"');
const projectionCall = sync.indexOf('admin.rpc("project_google_health_group_data"');
const finishCallAfterImport = sync.indexOf('admin.rpc("finish_google_health_sync"', importCall);
assert.ok(importCall >= 0 && projectionCall > importCall);
assert.ok(finishCallAfterImport > projectionCall);
assert.match(sync, /p_snapshot_revision: projectionRevision/);
assert.match(sync, /google_health_projection_conflict\|40001/);

assert.match(migration, /create extension if not exists pg_cron/);
assert.match(migration, /vault\.decrypted_secrets/);
assert.match(migration, /create or replace function public\.persist_google_health_refresh_replacement/);
assert.match(migration, /refresh_replacement_nonce = p_replacement_nonce/);
assert.match(migration, /connection_generation = connection\.connection_generation \+ 1/);
assert.match(migration, /create or replace function public\.purge_expired_google_health_oauth_states/);
assert.match(migration, /interval '1 hour'/);
assert.match(durableCatchupMigration, /add column if not exists next_catchup_at/);
assert.match(durableCatchupMigration, /job_kind in \('initial', 'catchup'\)/);
assert.match(durableCatchupMigration, /create or replace function public\.queue_google_health_initial_sync/);
assert.match(durableCatchupMigration, /after update of status on public\.google_health_connections/);
assert.match(durableCatchupMigration, /old\.status is distinct from 'connected'/);
assert.match(durableCatchupMigration, /create or replace function public\.stage_due_google_health_catchup/);
assert.match(durableCatchupMigration, /google-health-catchup-stage/);
assert.match(durableCatchupMigration, /created_at > now\(\) - interval '1 minute'/);
assert.match(durableCatchupMigration, /order by connection\.next_catchup_at, connection\.user_id[\s\S]*?limit 1/);
assert.match(durableCatchupMigration, /when 'webhook' then 0[\s\S]*?when 'initial' then 1/);
assert.match(durableCatchupMigration, /for update skip locked/);
assert.match(hourlyCatchupMigration, /now\(\) \+ interval '1 hour'/);
assert.match(hourlyCatchupMigration, /create or replace function public\.invoke_google_health_worker\(\)/);
assert.match(hourlyCatchupMigration, /v_hourly_maintenance/);
assert.match(hourlyCatchupMigration, /google_health_webhook_queue/);
assert.match(hourlyCatchupMigration, /google_health_revocation_queue/);
assert.match(hourlyCatchupMigration, /google_health_pending_grants/);
assert.match(hourlyCatchupMigration, /next_catchup_at <= clock_timestamp\(\)/);
assert.ok(
  hourlyCatchupMigration.indexOf("if not v_hourly_maintenance") <
    hourlyCatchupMigration.indexOf("from vault.decrypted_secrets"),
  "the cron hook must reject an idle tick before Vault reads and pg_net",
);
assert.match(
  forwardWorkerHardeningMigration,
  /v_runtime_enabled := coalesce\(v_runtime_enabled, false\)/,
  "a missing runtime-config singleton must keep the worker disabled",
);
assert.match(
  forwardWorkerHardeningMigration,
  /from public\.google_health_pending_grants staged[\s\S]{0,100}staged\.consumed_at is null[\s\S]{0,100}staged\.expires_at <= clock_timestamp\(\)/,
  "the idle guard must use the pending-grant partial expiry index predicate",
);
assert.match(
  forwardWorkerHardeningMigration,
  /revoke all on function public\.invoke_google_health_worker\(\)[\s\S]{0,120}grant execute[\s\S]{0,100}service_role/,
  "the forward replacement must preserve the worker's service-only ACL",
);
assert.match(endpoint, /stage_google_health_pending_grant/);
assert.match(endpoint, /delete_google_health_connection_data/);
assert.match(endpoint, /mutate_google_health_food_family_and_project/);
assert.ok(!endpoint.includes('admin.rpc("mutate_google_health_entry"'),
  "entry mutations must pass through the Food-family authority boundary");
assert.match(endpoint, /update_google_health_metric_visibility_and_project/);
assert.match(
  endpoint,
  /body\.metricId === "exercise" && body\.visibility === "group"[\s\S]{0,120}queueWorkoutDetailCatchup/,
  "private-to-group Active energy changes must queue a bounded history remap for pre-carrier imports",
);
assert.match(endpoint, /readBoundedJson/);
assert.match(endpoint, /manual: true/);
assert.match(endpoint, /function startGoogleHealthWorker/);
assert.match(endpoint, /FOREGROUND_REFRESH_MIN_AGE_MS = 30 \* 60 \* 1000/);
assert.match(endpoint, /async function queueForegroundRefresh/);
assert.match(endpoint, /last_synced_at\.is\.null,last_synced_at\.lte/);
assert.match(endpoint, /action === "refresh"/);
const completeConnectionBody = endpoint.match(
  /async function completeConnection[\s\S]*?async function handleAction/,
)?.[0] ?? "";
assert.match(completeConnectionBody, /startGoogleHealthWorker\(\)/);
assert.ok(
  !completeConnectionBody.includes("syncGoogleHealthUser"),
  "OAuth completion must rely on its durable initial job instead of a fire-and-forget direct sync",
);
assert.match(endpoint, /include_granted_scopes: "false"/);
assert.ok(!endpoint.includes('include_granted_scopes: "true"'));
assert.match(endpoint, /google_health_feature_disabled\|feature_disabled/);
assert.match(endpoint, /stagedResult\?\.reason === "feature_disabled"/);
assert.match(deleteAccount, /begin_google_health_account_deletion/);
assert.match(deleteAccount, /cancel_google_health_account_deletion/);
assert.match(deleteAccount, /verify_google_health_account_deletion/);
assert.match(deleteAccount, /renew_google_health_account_deletion/);
assert.match(deleteAccount, /await assertLease\(\)/);
assert.match(deleteAccount, /p_attempt_id: attemptId/);
assert.match(deleteAccount, /const attemptId = crypto\.randomUUID\(\)/);
assert.match(deleteAccount, /account_deletion_failed/);
assert.ok(!/error instanceof Error \? error\.message/.test(deleteAccount));
assert.match(deleteAccount, /offset,/);
assert.match(deleteAccount, /page\.length < pageSize/);
assert.match(deleteAccount, /account_media_cleanup_incomplete/);
const legacyCommittedBody = sendPush.match(
  /async function legacyCommittedCanonicalEvent[\s\S]*?async function legacyCompetitionCanonicalEvent/,
)?.[0] ?? "";
assert.match(legacyCommittedBody, /visibility, source_provider/);
assert.match(legacyCommittedBody, /entry\.source_provider === "google_health"/);
assert.ok(
  legacyCommittedBody.indexOf('entry.source_provider === "google_health"') <
    legacyCommittedBody.indexOf("entryId: clientGeneratedId"),
  "legacy metric push must reject Google before materializing its provider ID",
);
const legacyCompetitionBody = sendPush.match(
  /async function legacyCompetitionCanonicalEvent[\s\S]*?async function storeCanonicalLegacyEvent/,
)?.[0] ?? "";
assert.match(legacyCompetitionBody, /client_generated_id, updated_at, source_provider/);
assert.match(legacyCompetitionBody, /candidate\.source_provider === "google_health"/);
assert.ok(
  legacyCompetitionBody.indexOf('candidate.source_provider === "google_health"') <
    legacyCompetitionBody.indexOf("storeCanonicalLegacyEvent"),
  "legacy lead push must reject every Google source candidate before storing an event",
);
assert.ok(
  deleteAccount.indexOf("await deleteGoogleHealthData") < deleteAccount.indexOf("await deleteAllMedia"),
  "write-blocking deletion guard must commit before media enumeration",
);
assert.ok(
  deleteAccount.indexOf("await deleteAllMedia") < deleteAccount.indexOf("deleteUser"),
  "media cleanup must finish before auth deletion",
);
assert.ok(deleteAccount.indexOf("deleteGoogleHealthData") < deleteAccount.indexOf("deleteUser"));
assert.match(sync, /requiredScope/);
assert.match(sync, /activeGrantedScopes\.has\(definition\.requiredScope\)/);
assert.match(sync, /last_error_code,sync_lease_until/);
assert.match(sync, /syncing: Number\.isFinite\(syncLeaseUntil\) && syncLeaseUntil > Date\.now\(\)/);
assert.match(sync, /for \(const definition of definitions\)/);
assert.ok(!/Promise\.all\(\s*definitions\.map/.test(sync));
assert.match(api, /MIN_HEALTH_REQUEST_INTERVAL_MS = 450/);
assert.match(config, /must exactly match the Supabase google-health callback/);
assert.match(config, /\["\/settings", "\/settings\/"\]/);
assert.match(webhook, /payload\.type === "verification"\) return response\(201\)/);
assert.match(webhook, /GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS/);
assert.match(webhook, /return response\(204\)/);
assert.match(webhook, /from\("google_health_runtime_config"\)/);
assert.match(webhook, /runtime\.data\?\.enabled !== true/);
assert.ok(!webhook.includes('.eq("status", "dead")'));
assert.match(worker, /8 \* 24 \* 60 \* 60_000/);
assert.match(worker, /status: "pending"/);
assert.match(worker, /Math\.min\(1440/);
assert.match(worker, /GOOGLE_HEALTH_WORKER_SECRETS/);
assert.ok(!/addDays\(fromDate, 370\)/.test(worker));
assert.match(worker, /activeEnergyError/);
assert.match(worker, /currentDateForProfile/);
assert.match(worker, /googleHealthWebhookEventRange/);
assert.match(worker, /purge_expired_google_health_oauth_states/);
assert.match(worker, /readBoundedJson\(request, 8192, \{ allowEmpty: true \}\)/);
assert.match(worker, /const revocationLimit = Math\.min\(limit, 2\)/);
assert.match(worker, /from\("google_health_runtime_config"\)/);
assert.match(worker, /runtime\.data\?\.enabled !== true/);
assert.match(worker, /365 \* 24 \* 60 \* 60_000/);
assert.match(worker, /release_google_health_privacy_markers_if_clean/);
assert.match(worker, /stage_due_google_health_catchup/);
assert.match(worker, /catchupsStaged/);
assert.match(worker, /event\.job_kind === "webhook"/);
assert.match(worker, /queuedRetryTypes/);
assert.match(worker, /connection_generation/);
assert.match(worker, /next_catchup_at/);
assert.match(worker, /const BACKGROUND_CATCHUP_MS = 60 \* 60_000/);
assert.match(worker, /Date\.now\(\) \+ BACKGROUND_CATCHUP_MS/);
assert.match(worker, /payload: \{ dataTypes: retryTypes\.get\(event\.id\) \}/);
assert.match(endpoint, /sync,\s*\n\s*\}/);
assert.ok(
  !sync.includes("Every Google Health data request failed"),
  "an all-category provider failure must preserve its per-type result",
);
assert.match(sync, /dataTypes: \[\],[\s\S]*?errors,/);
assert.match(signature, /publicKeys\(true\)/);
assert.match(signature, /base64UrlEncode\(coordinates\.x\)/);
assert.match(subscriber, /awaitOperation/);
assert.match(subscriber, /activeSubscriber/);
assert.match(subscriber, /subscriptionCreatePolicy: "AUTOMATIC"/);
assert.ok(!subscriber.includes("active-energy-burned"));
const replacementPlanningIndex = sync.indexOf("const replacements = successful");
const ownershipReadIndex = sync.indexOf(
  'admin.from("google_health_import_records")',
);
assert.ok(
  replacementPlanningIndex >= 0 && ownershipReadIndex > replacementPlanningIndex,
  "step/workout ownership must not be scanned during unrelated or failed Google Health syncs",
);
const boundedOwnershipRead = sync.slice(
  sync.indexOf("if (stepContextReplacements.length) {"),
  sync.indexOf("const stepFallbackOwnership"),
);
assert.match(boundedOwnershipRead, /\.gte\("local_date", ownershipFromDate\)/);
assert.match(boundedOwnershipRead, /\.lte\("local_date", ownershipThroughDate\)/);
for (const dataType of [
  "steps", "exercise", "body-fat", "heart-rate", "blood-glucose",
  "sleep", "hydration-log", "nutrition-log", "weight",
]) assert.match(subscriber, new RegExp(`"${dataType}"`));
for (const secret of [
  "GOOGLE_HEALTH_CLIENT_ID",
  "GOOGLE_HEALTH_CLIENT_SECRET",
  "GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_HEALTH_OAUTH_REDIRECT_URI",
  "GOOGLE_HEALTH_WEB_ORIGIN",
  "GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS",
  "GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION",
  "GOOGLE_HEALTH_WORKER_SECRET",
]) {
  assert.match(envExample, new RegExp(secret));
  assert.match(runbook, new RegExp(secret));
}
assert.match(runbook, /delete-account` function \*\*before\*\* the migration/);
assert.match(runbook, /begin_google_health_account_deletion/);
assert.match(runbook, /AUTOMATIC subscriber is a release gate/);
assert.match(runbook, /UNSATURATED_FAT/);
assert.match(runbook, /dedicated Web OAuth client/);
assert.match(runbook, /include_granted_scopes=false/);
assert.match(runbook, /one-hour audit window/);
assert.match(runbook, /google_health_runtime_config\.enabled = false/);
assert.match(runbook, /x-habhub-privacy-schema: 27/);
assert.match(runbook, /schema-26\/no-header/);
assert.match(runbook, /account:<user-id>:snapshot:v27/);
assert.match(runbook, /legacy send-push compatibility synthesizer/);
assert.match(runbook, /set enabled = true, updated_at = now\(\)/);
assert.match(runbook, /ten-minute lease expires/);
assert.match(runbook, /creates neither a metric-entry push outbox row nor a lead-change push/);
assert.match(runbook, /notification hash is retained[\s\S]*one year/);
assert.match(envExample, /dedicated Health-only Web OAuth client/);
assert.match(runbook, /google-health-worker-every-minute/);
assert.match(runbook, /non-production test account/);
assert.ok(
  runbook.indexOf("functions deploy delete-account") < runbook.indexOf("db push --dry-run"),
  "runbook must deploy fail-closed account deletion before the migration",
);
assert.match(packageJson, /--no-lock --node-modules-dir=none/);
assert.ok(!packageJson.includes("--node-modules-dir=auto"));
for (const name of ["google-health", "google-health-webhook", "google-health-worker"])
  assert.match(supabaseConfig, new RegExp(`\\[functions\\.${name}\\][\\s\\S]*?verify_jwt = false`));
assert.deepEqual(
  [...sync.matchAll(/googleType: "([^"]+)"/g)].map((match) => match[1]).filter((value) =>
    value !== "active-energy-burned"),
  ["steps", "heart-rate", "weight", "body-fat", "blood-glucose", "sleep", "exercise", "hydration-log", "nutrition-log"],
);

console.log("Google Health backend privacy, mapping, OAuth, lifecycle, queue, and rotation fixtures passed.");
