import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildGoogleHealthStepCheckpoint,
  GOOGLE_HEALTH_STEP_CHECKPOINT_TTL_MS,
  mergeGoogleHealthStepCheckpoint,
  parseGoogleHealthStepCheckpoint,
} from "../src/domain/googleHealthStepCheckpoint.ts";

const now = new Date("2026-08-23T12:00:00.000Z");
const userId = "11111111-1111-4111-8111-111111111111";
const state = {
  currentUserId: userId,
  metrics: [
    {
      id: "steps",
      healthMapping: { dataType: "steps", field: "value" },
    },
    {
      id: "food",
      healthMapping: { dataType: "nutrition", field: "value" },
    },
  ],
  entries: [],
  settings: { healthSync: {} },
};
const googleStep = {
  id: "google-health:aggregate:steps:2026-08-23:steps",
  metricId: "steps",
  userId,
  value: 4321,
  localDate: "2026-08-23",
  recordedAt: "2026-08-23T11:59:00.000Z",
  visibility: "group",
  source: "imported",
  sourceProvider: "google_health",
  sourceRecordId: "aggregate:steps:2026-08-23",
  sourceUpdatedAt: "2026-08-23T11:59:30.000Z",
};
const googleFood = {
  ...googleStep,
  id: "google-health:nutrition:meal:food",
  metricId: "food",
  value: 700,
};

const checkpoint = buildGoogleHealthStepCheckpoint(
  { ...state, entries: [...state.entries, googleStep, googleFood] },
  now,
);
assert.ok(checkpoint);
assert.equal(checkpoint.entries.length, 1);
assert.equal(checkpoint.entries[0].id, googleStep.id);
assert.equal(checkpoint.entries[0].nutrition, undefined);
assert.equal(
  Date.parse(checkpoint.expiresAt) - Date.parse(checkpoint.createdAt),
  GOOGLE_HEALTH_STEP_CHECKPOINT_TTL_MS,
);

assert.equal(
  parseGoogleHealthStepCheckpoint(
    { ...checkpoint, accountId: "another-account" },
    state,
    now,
  ),
  undefined,
  "a checkpoint must never cross accounts",
);
assert.equal(
  parseGoogleHealthStepCheckpoint(
    { ...checkpoint, expiresAt: "2026-08-23T11:00:00.000Z" },
    state,
    now,
  ),
  undefined,
  "expired health data must not be restored",
);

const sanitized = { ...state, entries: [] };
assert.equal(
  buildGoogleHealthStepCheckpoint(sanitized, now),
  undefined,
  "a transient clean hydration state has no authoritative checkpoint candidate",
);
const restored = mergeGoogleHealthStepCheckpoint(sanitized, checkpoint, now);
assert.equal(restored.entries.length, 1);
assert.equal(restored.entries[0].value, 4321);

const authoritativeZero = {
  ...googleStep,
  value: 0,
  sourceUpdatedAt: "2026-08-23T12:00:30.000Z",
};
const zeroCheckpoint = buildGoogleHealthStepCheckpoint(
  { ...state, entries: [authoritativeZero] },
  now,
);
assert.ok(zeroCheckpoint, "an authoritative zero must remain a writable checkpoint");
assert.equal(zeroCheckpoint.entries[0].value, 0);
const keptAuthoritative = mergeGoogleHealthStepCheckpoint(
  { ...state, entries: [authoritativeZero] },
  checkpoint,
  now,
);
assert.equal(keptAuthoritative.entries.length, 1);
assert.equal(keptAuthoritative.entries[0].value, 0);

const webStorage = fs.readFileSync(
  "src/storage/googleHealthStepCheckpoint.web.ts",
  "utf8",
);
const appProvider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
assert.match(webStorage, /AES-GCM/);
assert.match(webStorage, /generateKey\([\s\S]{0,100}false,[\s\S]{0,80}\["encrypt", "decrypt"\]/);
assert.doesNotMatch(webStorage, /AsyncStorage|localStorage/);
assert.match(webStorage, /additionalData: additionalData\(accountId\)/);
assert.match(appProvider, /mergeGoogleHealthStepCheckpoint\(upgraded, checkpoint\)/);
assert.match(
  appProvider,
  /writeGoogleHealthStepCheckpoint\(googleHealthStepCheckpointSource\)/,
);
assert.match(webStorage, /latestRequestedSignature/);
assert.match(webStorage, /operationByAccount/);
assert.match(webStorage, /keyCreationPromise/);
assert.match(webStorage, /if \(keyCreationPromise\) return keyCreationPromise/);
assert.match(
  webStorage,
  /latestRequestedSignature\.get\(accountId\) !== signature/,
);
assert.match(
  webStorage,
  /const checkpoint = buildGoogleHealthStepCheckpoint\(state\);[\s\S]{0,400}if \(!checkpoint\) return;[\s\S]{0,200}const signature = JSON\.stringify\(checkpoint\.entries\)/,
  "transient empty state must leave the last confirmed checkpoint and signature maps untouched",
);
assert.doesNotMatch(
  webStorage,
  /if \(!checkpoint\)[\s\S]{0,200}deleteRecord/,
  "missing candidates must only be deleted by explicit lifecycle operations",
);

const authProvider = fs.readFileSync("src/auth/AuthProvider.tsx", "utf8");
const cloudProvider = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
assert.match(authProvider, /deleteGoogleHealthStepCheckpoint\(userId\)/);
assert.match(
  appProvider,
  /commitReducedState\(next, true, "local"\)\.then\(\(\) =>[\s\S]{0,100}deleteGoogleHealthStepCheckpoint/,
);
const entryPurgeWiring = appProvider.match(
  /const purgeGoogleHealthEntryAction[\s\S]+?const value = useMemo/,
)?.[0];
assert.ok(entryPurgeWiring, "per-entry Google Health purge wiring must exist");
assert.match(
  entryPurgeWiring,
  /const previous = persistenceStateRef\.current;[\s\S]+?commitReducedState\(next, true, "local"\)\.then\(async \(\) => \{[\s\S]{0,160}await deleteGoogleHealthStepCheckpoint\(previous\.currentUserId\);[\s\S]{0,100}await writeGoogleHealthStepCheckpoint\(next\)/,
  "an explicitly dismissed Google Health entry must be removed before the encrypted Steps checkpoint is rebuilt from remaining confirmed rows",
);
assert.match(cloudProvider, /deleteGoogleHealthStepCheckpoint\(accountId\)/);

console.log(
  "Google Health Steps restore from an encrypted, account-scoped and expiring PWA checkpoint.",
);
