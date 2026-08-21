import assert from "node:assert/strict";

import {
  decryptSecret,
  encryptSecret,
} from "../supabase/functions/_shared/google-health-crypto.ts";
import { googleHealthSyncTestHooks } from "../supabase/functions/_shared/google-health-sync.ts";
import { readBoundedJson } from "../supabase/functions/_shared/google-health-request.ts";
import {
  currentDateForProfile,
  googleHealthWebhookEventRange,
} from "../supabase/functions/_shared/google-health-webhook-range.ts";

const read = (path: string) => Deno.readTextFile(path);
const [
  migration,
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

const sourceRecord = {
  externalId: "nutrition-log:meal-a",
  dataType: "nutrition",
  startTime: "2026-08-20T11:00:00.000Z",
  endTime: "2026-08-20T11:15:00.000Z",
  localDate: "2026-08-20",
  value: 550,
  unit: "kcal",
  label: "Lunch",
  nutrition: { proteinG: 25, carbsG: 65, fatG: 18 },
};
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
assert.equal(mappedFood.length, 1, "direct food + nutrient mappings must merge into one stable row");
assert.equal(mappedFood[0].entry.value, 550);
assert.equal(mappedFood[0].entry.visibility, "group", "first import follows configured tracker visibility");
assert.deepEqual(mappedFood[0].entry.submetricValues, { protein: 25 });
assert.deepEqual(mappedFood[0].entry.nutrition, sourceRecord.nutrition);
assert.equal(mappedFood[0].entry.sourceRecordedAt, sourceRecord.endTime);
assert.match(String(mappedFood[0].entry.id), /^google-health:/);
assert.equal(mappedFood[0].entry.sourceProvider, "google_health");
const foodId = String(mappedFood[0].entry.id);

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
  remappedPrivate,
  { entries: [mappedFood[0].entry], settings: {} },
);
assert.equal(
  defaultChanged[0].entry.visibility,
  "private",
  "a prior generated row must not override the current tracker default",
);

const nativeMirroredFood = {
  ...mappedFood[0].entry,
  id: "health-connect:meal-a:food",
  sourceProvider: "health_connect",
  sourceRecordId: "health-connect:nutrition:meal-a",
};
const nativeFirstFood = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
    entries: [nativeMirroredFood],
    settings: {},
  });
assert.equal(
  nativeFirstFood.length,
  0,
  "a Google mirror of the same native food record must not double daily/group nutrition totals",
);
const googleFirstFood = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
  entries: [mappedFood[0].entry, nativeMirroredFood],
  settings: { googleHealthEntryOverrides: { [foodId]: { visibility: "group" } } },
});
assert.equal(
  googleFirstFood.length,
  0,
  "native ownership must win when the Google mirror arrived first and has an explicit preference",
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
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
    entries: [mappedFood[0].entry],
    settings: {},
  }).length,
  1,
  "Google remains materialized as the fallback when no native mirror exists",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
    entries: [{ ...nativeMirroredFood, recordedAt: "2026-08-20T13:15:00.000Z" }],
    settings: {},
  }).length,
  1,
  "a distinct meal remains materialized",
);

const overridden = googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(
  mappedFood,
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
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
    entries: [],
    settings: { dismissedHealthEntryIds: [foodId] },
  }).length,
  0,
  "dismissed provider rows must not resurrect",
);
assert.equal(
  googleHealthSyncTestHooks.preserveUserIntentAndDeduplicate(mappedFood, {
    entries: [],
    settings: { googleHealthEntryOverrides: { [foodId]: { dismissed: true } } },
  }).length,
  0,
  "authoritative server dismissals survive a later provider reappearance",
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
  0,
  "Google-first mirrored workouts collapse to the native owner",
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
  0,
  "Google-first mirrored weight contributes only the native value",
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
assert.match(migration, /create extension if not exists pg_cron/);
assert.match(migration, /vault\.decrypted_secrets/);
assert.match(migration, /create or replace function public\.persist_google_health_refresh_replacement/);
assert.match(migration, /refresh_replacement_nonce = p_replacement_nonce/);
assert.match(migration, /connection_generation = connection\.connection_generation \+ 1/);
assert.match(migration, /create or replace function public\.purge_expired_google_health_oauth_states/);
assert.match(migration, /interval '1 hour'/);
assert.match(endpoint, /stage_google_health_pending_grant/);
assert.match(endpoint, /delete_google_health_connection_data/);
assert.match(endpoint, /mutate_google_health_entry/);
assert.match(endpoint, /update_google_health_metric_visibility/);
assert.match(endpoint, /readBoundedJson/);
assert.match(endpoint, /manual: true/);
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
assert.match(endpoint, /sync,\s*\n\s*\}/);
assert.match(signature, /publicKeys\(true\)/);
assert.match(signature, /base64UrlEncode\(coordinates\.x\)/);
assert.match(subscriber, /awaitOperation/);
assert.match(subscriber, /activeSubscriber/);
assert.match(subscriber, /subscriptionCreatePolicy: "AUTOMATIC"/);
assert.ok(!subscriber.includes("active-energy-burned"));
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
