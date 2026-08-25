import assert from "node:assert/strict";
import fs from "node:fs";

import {
  checkpointChunks,
  joinCheckpointChunks,
  NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
  NATIVE_GOOGLE_GROUP_MAX_STATUSES,
  nativeGoogleHealthCheckpointContentSignature,
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

const serialized = serializeNativeGoogleHealthGroupCheckpoint(
  {
    currentUserId: accountId,
    groupId,
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
assert.doesNotMatch(serialized, /provider-record-must-not-persist|private note|private meal/);

const restored = parseNativeGoogleHealthGroupCheckpoint(
  serialized,
  accountId,
  groupId,
  now,
);
assert.ok(restored);
assert.deepEqual(
  restored.dailyMetricStatuses.map((item) => item.metricId),
  ["steps", "sleep"],
);
assert.equal(restored.dailyMetricStatuses[0].exactValue, 6_258);
assert.equal(restored.dailyMetricStatuses[0].sourceRevision, 8);
assert.equal(
  restored.dailyMetricStatuses[1].exactValue,
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
assert.notEqual(
  nativeGoogleHealthCheckpointContentSignature(serialized),
  nativeGoogleHealthCheckpointContentSignature(
    serialized.replace("2026-08-25T12:00:00.000Z", "2026-08-26T00:00:00.000Z"),
  ),
  "an unchanged checkpoint may refresh its expiry once on a new day",
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

const adapter = fs.readFileSync(
  "src/storage/googleHealthGroupCheckpoint.native.ts",
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
assert.match(sharedCache, /withoutGoogleHealthDerivedStatuses/);
assert.match(sharedCache, /withoutGoogleHealthEntries/);
assert.match(cloudProvider, /readGoogleHealthGroupCheckpoint/);
assert.match(cloudProvider, /scopeCachedGroupActivity/);
assert.match(appJson, /"expo-secure-store"/);
assert.equal(packageJson.dependencies["expo-secure-store"], "~15.0.8");

console.log(
  "Native Google Health cache validation passed: compact authorized projections, latest-key deduplication, conservative chunks, fixed-slot atomicity, corruption/partial failure, privacy-empty deletion, account scoping, and encrypted native storage wiring.",
);
