import assert from "node:assert/strict";
import fs from "node:fs";

import {
  checkpointChunks,
  joinCheckpointChunks,
  NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
  NATIVE_GOOGLE_GROUP_MANIFEST_VERSION,
  NATIVE_GOOGLE_GROUP_MAX_STATUSES,
  nativeGoogleHealthCheckpointContentSignature,
  nativeGoogleHealthStableHash,
  parseNativeGoogleHealthGroupCheckpoint,
  parseNativeGoogleHealthManifest,
  serializeNativeGoogleHealthGroupCheckpoint,
} from "../src/domain/nativeGoogleHealthGroupCache.ts";

const now = new Date("2026-08-25T12:00:00.000Z");
const accountId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const peerId = "33333333-3333-4333-8333-333333333333";
const status = {
  groupId,
  metricId: "steps",
  userId: peerId,
  localDate: "2026-08-25",
  goalReached: false,
  scoreContribution: 62,
  goalProgress: 62,
  goalKind: "at_least",
  goalTarget: 10_000,
  visibility: "group",
  goalEligible: true,
  exactValue: 6_258,
  privacyProjectionVersion: 2,
  hasData: true,
  sourceProvider: "google_health",
  syncedAt: "2026-08-25T11:00:00.000Z",
  sourceRevision: 8,
  // Deliberately hostile extras prove that provider ids/details do not cross
  // the existing minimal projection builder into secure local storage.
  sourceRecordId: "provider-record-must-not-persist",
  notes: "private note must not persist",
  nutrition: { meal: "private meal must not persist" },
};
const peerMeal = {
  id: "peer-google-meal",
  cloudId: "6bbafc87-832d-4f85-95ea-d56cdd424e11",
  metricId: "food",
  userId: peerId,
  value: 540,
  localDate: "2026-08-25",
  recordedAt: "2026-08-25T11:30:00.000Z",
  visibility: "group",
  source: "imported",
  sourceProvider: "google_health",
  sourceRecordId: "provider-meal",
  label: "Lunch",
  nutrition: { proteinG: 34, fiberG: 8 },
  imageUri: "https://signed.example/token-must-not-persist",
  imageStoragePath: `${groupId}/${peerId}/meal.jpg`,
};
const olderPeerMeal = {
  ...peerMeal,
  id: "peer-google-meal-old",
  cloudId: "7ccafc87-832d-4f85-95ea-d56cdd424e22",
  localDate: "2026-08-10",
  recordedAt: "2026-08-10T11:30:00.000Z",
};

const serialized = serializeNativeGoogleHealthGroupCheckpoint(
  {
    currentUserId: accountId,
    groupId,
    entries: [
      olderPeerMeal,
      peerMeal,
      { ...peerMeal, id: "own-meal", userId: accountId },
    ],
    dailyMetricStatuses: [
      { ...status, exactValue: 6_000, sourceRevision: 7 },
      status,
      {
        ...status,
        metricId: "sleep",
        visibility: "status",
        exactValue: undefined,
      },
      { ...status, metricId: "private", visibility: "private" },
      { ...status, metricId: "native", sourceProvider: "health_connect" },
      { ...status, metricId: "other-group", groupId: "another-group" },
      { ...status, metricId: "old", localDate: "2026-08-10" },
    ],
  },
  now,
);
assert.ok(serialized);
assert.ok(serialized.length > 0);
assert.doesNotMatch(
  serialized,
  /provider-record-must-not-persist|private note|private meal|token-must-not-persist/,
);

const restored = parseNativeGoogleHealthGroupCheckpoint(
  serialized,
  accountId,
  groupId,
  now,
);
assert.ok(restored);
assert.deepEqual(
  restored.entries.map((entry) => entry.id),
  [olderPeerMeal.id, peerMeal.id],
  "native secure storage must retain authorized item detail beyond the former seven-day window",
);
assert.equal(
  restored.entries[1].cloudId,
  peerMeal.cloudId,
  "the canonical social identity must survive native secure persistence",
);
assert.equal(restored.entries[1].nutrition?.fiberG, 8);
assert.equal(restored.entries[1].imageUri, undefined);
assert.deepEqual(
  restored.dailyMetricStatuses.map((item) => item.metricId),
  ["old", "steps", "sleep"],
  "native secure storage must retain authorized history beyond the former seven-day window",
);
assert.equal(restored.dailyMetricStatuses[1].exactValue, 6_258);
assert.equal(restored.dailyMetricStatuses[1].sourceRevision, 8);
assert.equal(
  restored.dailyMetricStatuses[2].exactValue,
  undefined,
  "status-only sharing must never persist an exact health value",
);
assert.equal(
  parseNativeGoogleHealthGroupCheckpoint(
    serialized,
    "another-account",
    groupId,
    now,
  ),
  undefined,
  "a checkpoint is account scoped",
);

const chunked = checkpointChunks(
  "x".repeat(NATIVE_GOOGLE_GROUP_CHUNK_LENGTH * 2 + 7),
  "slot-a",
);
assert.ok(chunked);
assert.equal(chunked.chunks.length, 3);
assert.ok(
  chunked.chunks.every(
    (chunk) => chunk.length <= NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
  ),
);
assert.equal(
  joinCheckpointChunks(chunked.manifest, chunked.chunks),
  chunked.chunks.join(""),
);
assert.equal(
  nativeGoogleHealthCheckpointContentSignature(serialized),
  nativeGoogleHealthCheckpointContentSignature(
    serialized.replace("2026-08-25T12:00:00.000Z", "2026-08-25T23:59:59.000Z"),
  ),
  "unchanged summaries on the same day must not churn SecureStore writes",
);
assert.equal(
  nativeGoogleHealthCheckpointContentSignature(serialized),
  nativeGoogleHealthCheckpointContentSignature(
    serialized.replace("2026-08-25T12:00:00.000Z", "2026-08-26T00:00:00.000Z"),
  ),
  "non-expiring checkpoints must not churn SecureStore writes on a new day",
);
assert.notEqual(
  nativeGoogleHealthCheckpointContentSignature(serialized),
  nativeGoogleHealthCheckpointContentSignature(
    JSON.stringify({ ...JSON.parse(serialized), version: 2 }),
  ),
  "the payload version must force a real v2-to-v3 at-rest rewrite",
);

function legacyAsciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const currentPayload = JSON.parse(serialized);
const legacyV2Payload = {
  version: 2,
  accountId: currentPayload.accountId,
  groupId: currentPayload.groupId,
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  entries: currentPayload.entries
    .filter((entry) => entry.localDate >= "2026-08-19")
    .map(({ cloudId: _cloudId, ...entry }) => entry),
  dailyMetricStatuses: currentPayload.dailyMetricStatuses.filter(
    (item) => item.localDate >= "2026-08-19",
  ),
};
const legacyV2Serialized = legacyAsciiJson(legacyV2Payload);
const legacyV2Chunks = Array.from(
  {
    length: Math.ceil(
      legacyV2Serialized.length / NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
    ),
  },
  (_, index) =>
    legacyV2Serialized.slice(
      index * NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
      (index + 1) * NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
    ),
);
const legacyV2ContentSignature = nativeGoogleHealthStableHash(
  legacyAsciiJson({
    accountId: legacyV2Payload.accountId,
    groupId: legacyV2Payload.groupId,
    refreshDate: legacyV2Payload.createdAt.slice(0, 10),
    entries: legacyV2Payload.entries,
    dailyMetricStatuses: legacyV2Payload.dailyMetricStatuses,
  }),
);
const legacyV2Manifest = {
  version: NATIVE_GOOGLE_GROUP_MANIFEST_VERSION,
  generation: "slot-b",
  chunkCount: legacyV2Chunks.length,
  signature: nativeGoogleHealthStableHash(legacyV2Serialized),
  contentSignature: legacyV2ContentSignature,
};
assert.equal(
  joinCheckpointChunks(legacyV2Manifest, legacyV2Chunks),
  legacyV2Serialized,
  "the exact pre-v3 manifest signature must still admit its intact v2 chunks",
);
const migratedLegacyV2 = parseNativeGoogleHealthGroupCheckpoint(
  legacyV2Serialized,
  accountId,
  groupId,
  new Date("2027-01-01T12:00:00.000Z"),
);
assert.equal(
  migratedLegacyV2?.version,
  3,
  "an expired native v2 payload must migrate to v3 after legacy manifest verification",
);
assert.equal(migratedLegacyV2?.entries[0].id, peerMeal.id);
assert.equal(
  migratedLegacyV2?.entries[0].cloudId,
  undefined,
  "v2 entries without the later canonical cloud id remain readable",
);
assert.equal(
  joinCheckpointChunks(chunked.manifest, chunked.chunks.slice(0, -1)),
  undefined,
  "a partial slot must fail closed",
);
assert.equal(
  joinCheckpointChunks(chunked.manifest, [
    `${chunked.chunks[0]}corrupt`,
    ...chunked.chunks.slice(1),
  ]),
  undefined,
  "an integrity mismatch must fail closed",
);
assert.equal(
  joinCheckpointChunks(
    { ...chunked.manifest, contentSignature: "tampered" },
    chunked.chunks,
  ),
  undefined,
  "a mismatched write-coalescing signature must also fail closed",
);
assert.equal(parseNativeGoogleHealthManifest("not-json"), undefined);
assert.equal(
  parseNativeGoogleHealthManifest(
    JSON.stringify({ ...chunked.manifest, generation: "unbounded-random" }),
  ),
  undefined,
  "only the two bounded slots are addressable",
);

assert.equal(
  serializeNativeGoogleHealthGroupCheckpoint(
    {
      currentUserId: accountId,
      groupId,
      dailyMetricStatuses: [{ ...status, visibility: "private" }],
    },
    now,
  ),
  undefined,
  "privacy-empty state must drive secure-checkpoint deletion",
);

const capped = serializeNativeGoogleHealthGroupCheckpoint(
  {
    currentUserId: accountId,
    groupId,
    dailyMetricStatuses: [
      ...Array.from(
        { length: NATIVE_GOOGLE_GROUP_MAX_STATUSES },
        (_, index) => ({
          ...status,
          metricId: `older-${index}`,
          localDate: "2026-08-24",
        }),
      ),
      { ...status, metricId: "today-survives-cap" },
    ],
  },
  now,
);
assert.ok(capped);
const cappedCheckpoint = parseNativeGoogleHealthGroupCheckpoint(
  capped,
  accountId,
  groupId,
  now,
);
assert.ok(
  Number(cappedCheckpoint?.dailyMetricStatuses.length) > 0 &&
    Number(cappedCheckpoint?.dailyMetricStatuses.length) <=
      NATIVE_GOOGLE_GROUP_MAX_STATUSES,
  "the row and serialized-size caps must both remain bounded",
);
assert.ok(
  cappedCheckpoint?.dailyMetricStatuses.some(
    (item) => item.metricId === "today-survives-cap",
  ),
  "today's latest peer projection must survive the bounded cap",
);

const detailUnderStatusPressure = serializeNativeGoogleHealthGroupCheckpoint(
  {
    currentUserId: accountId,
    groupId,
    entries: [olderPeerMeal],
    dailyMetricStatuses: Array.from(
      { length: NATIVE_GOOGLE_GROUP_MAX_STATUSES },
      (_, index) => ({
        ...status,
        metricId: `pressure-${index}`,
        localDate: index === 0 ? "2026-08-10" : "2026-08-25",
      }),
    ),
  },
  now,
);
assert.ok(detailUnderStatusPressure);
assert.ok(
  parseNativeGoogleHealthGroupCheckpoint(
    detailUnderStatusPressure,
    accountId,
    groupId,
    now,
  )?.entries.some((entry) => entry.id === olderPeerMeal.id),
  "compact status pressure must not evict an authorized historical item before old totals",
);

const adapter = fs.readFileSync(
  "src/storage/googleHealthGroupCheckpoint.native.ts",
  "utf8",
);
const webAdapter = fs.readFileSync(
  "src/storage/googleHealthGroupCheckpoint.web.ts",
  "utf8",
);
const sharedCache = fs.readFileSync(
  "src/storage/groupActivityCache.shared.ts",
  "utf8",
);
const cloudProvider = fs.readFileSync(
  "src/cloud/CloudSyncProvider.tsx",
  "utf8",
);
const appJson = fs.readFileSync("app.json", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.match(adapter, /from "expo-secure-store"/);
assert.match(adapter, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
assert.doesNotMatch(adapter, /AsyncStorage|expo-sqlite|SQLite/);
assert.match(adapter, /\["slot-a", "slot-b"\]/);
assert.ok(
  adapter.indexOf("slotManifestKey(scope, generation)") <
    adapter.indexOf("chunkKey(scope, generation, index)"),
  "the bounded staging manifest must precede chunk writes",
);
assert.ok(
  adapter.lastIndexOf("manifestKey(scope)") >
    adapter.lastIndexOf("chunkKey(scope, generation, index)"),
  "the published manifest must be written only after every chunk",
);
assert.match(
  adapter,
  /if \(!serialized\)[\s\S]{0,120}deleteGoogleHealthGroupCheckpoint/,
);
assert.match(adapter, /invalidateCheckpoint\(scope\)/);
assert.match(adapter, /clearAllSlots\(scope\)/);
assert.doesNotMatch(
  adapter,
  /\.slice\(-64\)/,
  "native account purge must never silently orphan the oldest indexed scopes",
);
assert.match(adapter, /NATIVE_GOOGLE_GROUP_ACCOUNT_SCOPE_LIMIT = 100_000/);
assert.match(adapter, /\.scope-index-v1/);
assert.match(adapter, /\.scope-slot\.\$\{ordinal\}/);
assert.match(adapter, /\.scope-ref\.\$\{scope\.slice/);
const nativeReservation = adapter.slice(
  adapter.indexOf("async function reserveAccountScope"),
  adapter.indexOf("async function publishAccountScope"),
);
assert.ok(
  nativeReservation.indexOf("JSON.stringify({ ...header, nextOrdinal") <
    nativeReservation.indexOf("accountScopeIndexSlotKey(accountId, ordinal)"),
  "the small ordinal header must reserve every slot before checkpoint publication",
);
const nativeWrite = adapter.slice(
  adapter.indexOf("export async function writeGoogleHealthGroupCheckpoint"),
  adapter.indexOf("export async function deleteGoogleHealthGroupCheckpoint"),
);
assert.ok(
  nativeWrite.indexOf("const requestedAt = currentAccountMutationGeneration") <
    nativeWrite.indexOf("return enqueueAccountOperation"),
  "native writes must capture their mutation fence before entering the account queue",
);
assert.match(nativeWrite, /accountRequestIsCurrent[\s\S]*manifestKey\(scope\)/);
const nativePurge = adapter.slice(
  adapter.indexOf(
    "export async function deleteGoogleHealthGroupCheckpointsForAccount",
  ),
);
assert.ok(
  nativePurge.indexOf("const startedAt = beginAccountPurge(accountId)") <
    nativePurge.indexOf("return enqueueAccountOperation"),
  "native account purge must fence new requests synchronously",
);
assert.ok(
  nativePurge.indexOf("JSON.stringify(purgeGeneration)") <
    nativePurge.indexOf("parseLegacyAccountScopes"),
  "native account purge must persist its odd generation before cleanup",
);
assert.ok(
  nativePurge.indexOf("JSON.stringify(purgeGeneration + 1)") >
    nativePurge.indexOf("invalidateCheckpoint(scope)"),
  "native account purge must persist its even generation only after cleanup",
);
assert.match(
  adapter,
  /accountGeneration > 0 && !scopeIsPublished[\s\S]{0,180}invalidateCheckpoint\(scope\)/,
  "pre-index native records must fail closed after the first account purge",
);
assert.match(
  adapter,
  /finalAccountGeneration = await readAccountGeneration\(accountId\)/,
  "native reads must detect a cross-runtime purge that starts during chunk hydration",
);

const largestIndexValue = JSON.stringify({
  version: 1,
  scope: `habhub.google-group.v1.${"z".repeat(14)}`,
  generation: Number.MAX_SAFE_INTEGER,
});
assert.ok(
  Buffer.byteLength(largestIndexValue, "utf8") < NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
  "every native scope-index value must stay well below the conservative SecureStore value budget",
);

assert.match(webAdapter, /kind: "account-boundary"/);
assert.match(webAdapter, /accountGeneration\?: number/);
const webGenerationTransaction = webAdapter.slice(
  webAdapter.indexOf("async function updateAccountGenerationAtomically"),
  webAdapter.indexOf("async function beginPersistentAccountPurge"),
);
assert.match(
  webGenerationTransaction,
  /db\.transaction\(STORE_NAME, "readwrite"\)/,
  "web purge generation allocation must hold an IndexedDB write lock",
);
assert.ok(
  webGenerationTransaction.indexOf("store.get(id)") <
    webGenerationTransaction.indexOf("store.put({"),
  "web purge generation must be read and replaced in the same transaction",
);
assert.match(
  webAdapter,
  /beginPersistentAccountPurge[\s\S]{0,220}updateAccountGenerationAtomically\([\s\S]{0,100}nextPurgeStartGeneration/,
  "each tab must atomically allocate its own odd purge generation",
);
assert.match(
  webAdapter,
  /finishPersistentAccountPurge[\s\S]{0,500}current === purgeGeneration \? purgeGeneration \+ 1 : undefined/,
  "an older tab must not overwrite a newer tab's odd purge fence",
);
assert.doesNotMatch(webAdapter, /function writeAccountGeneration/);
const firstTabPurgeGeneration = 1;
const secondTabPurgeGeneration = 3;
const generationAfterObsoleteFinish =
  secondTabPurgeGeneration === firstTabPurgeGeneration
    ? firstTabPurgeGeneration + 1
    : secondTabPurgeGeneration;
assert.equal(
  generationAfterObsoleteFinish,
  secondTabPurgeGeneration,
  "an older tab's completion must preserve the newer tab's odd fence",
);
assert.equal(
  secondTabPurgeGeneration + 1,
  4,
  "the newest purge owner must be able to close its own odd generation",
);
const webWrite = webAdapter.slice(
  webAdapter.indexOf("export async function writeGoogleHealthGroupCheckpoint"),
  webAdapter.indexOf("export async function deleteGoogleHealthGroupCheckpoint"),
);
assert.ok(
  webWrite.indexOf("const requestedAt = currentAccountMutationGeneration") <
    webWrite.indexOf("return enqueueAccountOperation"),
  "web writes must capture their mutation fence before entering the account queue",
);
assert.match(webWrite, /accountGeneration,[\s\S]{0,100}iv:/);
const webPurge = webAdapter.slice(
  webAdapter.indexOf(
    "export async function deleteGoogleHealthGroupCheckpointsForAccount",
  ),
);
assert.ok(
  webPurge.indexOf("const startedAt = beginAccountPurge(accountId)") <
    webPurge.indexOf("return enqueueAccountOperation"),
  "web account purge must fence new requests synchronously",
);
assert.ok(
  webPurge.indexOf("beginPersistentAccountPurge(accountId)") <
    webPurge.indexOf("deleteRecordsWithPrefix(prefix)"),
  "web purge must atomically own an odd IndexedDB boundary before deleting ciphertext",
);
assert.ok(
  webPurge.indexOf("finishPersistentAccountPurge(accountId, purgeGeneration)") >
    webPurge.indexOf("deleteRecordsWithPrefix(prefix)"),
  "web purge must conditionally finish its owned boundary only after deletion",
);
assert.match(
  webAdapter,
  /finalAccountGeneration = await readAccountGeneration\(accountId\)/,
  "web reads must detect another tab purging during decryption",
);
assert.match(sharedCache, /withoutGoogleHealthDerivedStatuses/);
assert.match(sharedCache, /withoutGoogleHealthEntries/);
assert.match(cloudProvider, /readGoogleHealthGroupCheckpoint/);
assert.match(cloudProvider, /scopeCachedGroupActivity/);
assert.match(appJson, /"expo-secure-store"/);
assert.equal(packageJson.dependencies["expo-secure-store"], "~15.0.8");

console.log(
  "Native Google Health cache validation passed: compact authorized projections, legacy-v2 compatibility, conservative chunks, fixed-slot atomicity, bounded scope-index values, durable account-purge generations, stale-request fencing, cross-context read rejection, privacy-empty deletion, and encrypted storage wiring.",
);
