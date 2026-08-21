import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  accountMemberProfile,
  applyAccountMemberProfile,
  mergeAccountMemberProfile,
  profileProjectionLagsSnapshot,
} from "../src/domain/accountProfile.ts";
import {
  excludeAlreadyPublishedDailyStatusRows,
} from "../src/domain/cloudSyncProjection.ts";
import { cloudAccountEnergyProjection } from "../src/domain/energy.ts";
import {
  CLOUD_CONFLICT_MAX_RETRY_MS,
  cloudConflictBackoffActive,
  confirmedCloudPublishRevision,
  nextCloudConflictGate,
} from "../src/domain/cloudConflict.ts";

const base = {
  name: "Ahmad",
  initials: "A",
  avatarStoragePath: "avatars/old.png",
};

assert.deepEqual(
  mergeAccountMemberProfile(
    { ...base, name: "Ahmad Abu Dayeh", initials: "AA" },
    base,
    base,
  ),
  {
    ...base,
    name: "Ahmad Abu Dayeh",
    initials: "AA",
    avatarUri: undefined,
  },
  "a clean device must accept a remote rename",
);

assert.deepEqual(
  mergeAccountMemberProfile(
    base,
    { ...base, name: "Local edit", initials: "LE" },
    base,
  ),
  {
    ...base,
    name: "Local edit",
    initials: "LE",
    avatarUri: undefined,
  },
  "an offline local rename must survive a stale pull",
);

assert.deepEqual(
  mergeAccountMemberProfile(
    { ...base, name: "Remote rename", initials: "RR" },
    { ...base, avatarStoragePath: "avatars/local.png" },
    base,
  ),
  {
    name: "Remote rename",
    initials: "RR",
    avatarStoragePath: "avatars/local.png",
    avatarUri: undefined,
  },
  "a remote rename and local avatar edit must both survive",
);

assert.deepEqual(
  mergeAccountMemberProfile(
    { ...base, avatarStoragePath: "avatars/remote.png" },
    { ...base, name: "Local rename", initials: "LR" },
    base,
  ),
  {
    name: "Local rename",
    initials: "LR",
    avatarStoragePath: "avatars/remote.png",
    avatarUri: undefined,
  },
  "a local rename and remote avatar edit must both survive",
);

assert.equal(profileProjectionLagsSnapshot(8, 9), true);
assert.equal(profileProjectionLagsSnapshot(9, 9), false);
assert.equal(profileProjectionLagsSnapshot(undefined, 9), true);
assert.equal(profileProjectionLagsSnapshot(Number.NaN, 9), true);
assert.equal(profileProjectionLagsSnapshot(undefined, 0), false);

const firstConflict = nextCloudConflictGate(null, "user-1", 1_000, 7);
assert.deepEqual(firstConflict, {
  userId: "user-1",
  attempt: 1,
  retryAt: 6_000,
  observedRevision: 7,
});
const secondConflict = nextCloudConflictGate(
  firstConflict,
  "user-1",
  2_000,
  8,
);
assert.equal(secondConflict.attempt, 2);
assert.equal(secondConflict.retryAt, 12_000);
assert.equal(secondConflict.observedRevision, 8);
assert.equal(
  nextCloudConflictGate(secondConflict, "user-1", 3_000).observedRevision,
  8,
  "a retry must retain the last revision learned by its conflict refresh",
);
let cappedConflict = secondConflict;
for (let attempt = 0; attempt < 20; attempt += 1)
  cappedConflict = nextCloudConflictGate(
    cappedConflict,
    "user-1",
    10_000,
  );
assert.equal(cappedConflict.attempt, 8);
assert.equal(
  cappedConflict.retryAt,
  10_000 + CLOUD_CONFLICT_MAX_RETRY_MS,
);
assert.equal(cloudConflictBackoffActive(firstConflict, "user-1", 5_999), true);
assert.equal(cloudConflictBackoffActive(firstConflict, "user-1", 6_000), false);
assert.equal(cloudConflictBackoffActive(firstConflict, "user-2", 5_999), false);
assert.equal(
  nextCloudConflictGate(cappedConflict, "user-2", 20_000).attempt,
  1,
  "another account must start a new conflict boundary",
);
assert.equal(confirmedCloudPublishRevision(9, 9), 9);
assert.throws(
  () => confirmedCloudPublishRevision(9, 10),
  /stale_group_publish: account revision advanced from 9 to 10/,
);
assert.throws(() => confirmedCloudPublishRevision(-1, 0), /not available/);

const member = (group, name = "Cached name") => ({
  id: "user-1",
  name,
  initials: "CN",
  color: group === "one" ? "#111111" : "#222222",
  role: group === "one" ? "owner" : "member",
});
const state = {
  currentUserId: "user-1",
  group: { id: "one", name: "One", members: [member("one")] },
  groups: [
    { id: "one", name: "One", members: [member("one")] },
    { id: "two", name: "Two", members: [member("two")] },
  ],
};
const applied = applyAccountMemberProfile(state, {
  name: "Canonical name",
  initials: "CN",
  avatarStoragePath: "avatars/new.png",
});
assert.equal(accountMemberProfile(applied)?.name, "Canonical name");
assert.deepEqual(
  applied.groups.map((group) => ({
    name: group.members[0].name,
    color: group.members[0].color,
    role: group.members[0].role,
  })),
  [
    { name: "Canonical name", color: "#111111", role: "owner" },
    { name: "Canonical name", color: "#222222", role: "member" },
  ],
  "account identity must update every shell without changing group role/color",
);

const providerSource = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "src",
    "cloud",
    "CloudSyncProvider.tsx",
  ),
  "utf8",
);
const groupCloudSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "cloud", "groupCloud.ts"),
  "utf8",
);
const statusNoopMigration = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "supabase",
    "migrations",
    "202608110002_skip_unchanged_daily_status_updates.sql",
  ),
  "utf8",
);
const metadataHashBody = providerSource.match(
  /function accountMetadataHash\(state: AppState\) \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(metadataHashBody, "account metadata hash helper must exist");
assert.doesNotMatch(
  metadataHashBody,
  /snapshotPayload/,
  "profile autosync hashing must stay O(1), independent of account history",
);
assert.match(providerSource, /pushCloudAccountMetadata\(candidate,/);

const baselineEnergy = {
  age: 31,
  sex: "male",
  heightCm: 178,
  startingWeightKg: 90,
  weightKg: 82,
  bodyFatPercent: 18,
  leanBodyMassKg: 67,
  targetWeightKg: 78,
  activityLevel: "moderate",
  dailyActivityCaloriesOverride: 500,
  desiredWeeklyLossKg: 0.5,
};
assert.deepEqual(
  cloudAccountEnergyProjection(baselineEnergy),
  cloudAccountEnergyProjection({
    ...baselineEnergy,
    startingWeightKg: 120,
    bodyFatPercent: 28,
    leanBodyMassKg: 59,
    dailyActivityCaloriesOverride: 900,
  }),
  "private-only body inputs must not churn the relational account projection",
);
assert.notDeepEqual(
  cloudAccountEnergyProjection(baselineEnergy),
  cloudAccountEnergyProjection({ ...baselineEnergy, weightKg: 83 }),
  "a relational body-profile field must still invalidate account metadata",
);

const recentStatuses = Array.from({ length: 30 * 17 }, (_, index) => ({
  group_id: "group",
  metric_id: `metric-${index % 17}`,
  user_id: "user",
  local_date: `day-${Math.floor(index / 17)}`,
  goal_reached: false,
}));
const olderStatus = {
  group_id: "group",
  metric_id: "metric-0",
  user_id: "user",
  local_date: "older-day",
  goal_reached: true,
};
assert.deepEqual(
  excludeAlreadyPublishedDailyStatusRows(recentStatuses, [
    ...recentStatuses,
    olderStatus,
  ]),
  [olderStatus],
  "the historical pass must not upsert an unchanged 510-row recent window twice",
);

const stableHashBody = providerSource.match(
  /function stableHash\(state: AppState\) \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(stableHashBody, "private snapshot hash projection must exist");
assert.match(
  stableHashBody,
  /dailyMetricStatuses: \[\]/,
  "server-owned daily status cache must not reopen the account snapshot outbox",
);
const workspaceHashBody = providerSource.match(
  /function workspaceHash\(state: AppState\) \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(workspaceHashBody, "workspace hash helper must exist");
assert.doesNotMatch(
  workspaceHashBody,
  /dailyMetricStatuses/,
  "server-hydrated daily statuses must not reopen the relational workspace outbox",
);
assert.match(
  providerSource,
  /const activeFreshness = leaderboardPublishPromiseRef\.current;[\s\S]{0,100}await activeFreshness/,
  "full workspace publication must serialize behind compact freshness publication",
);
assert.match(
  groupCloudSource,
  /const profile = cloudAccountEnergyProjection\([\s\S]{0,500}p_energy_profile: profile/,
  "account metadata hashing and publication must share one exact energy projection",
);
assert.match(
  groupCloudSource,
  /const aliasRevision = confirmedCloudPublishRevision\(\s*publishRevision,\s*await resolveAccountRevision\(client, state\.currentUserId\)/,
  "alias publication must confirm the account revision immediately before its guarded RPC",
);
assert.match(
  groupCloudSource,
  /publish_group_member_aliases[\s\S]{0,160}p_expected_revision: aliasRevision/,
  "alias publication must use the freshly confirmed account revision",
);
assert.match(
  providerSource,
  /workspaceConflictGateRef[\s\S]{0,500}conflictRefreshRef/,
  "workspace conflicts must have per-account backoff and single-flight refresh guards",
);
assert.match(
  providerSource,
  /const conflictGate = workspaceConflictGateRef\.current;[\s\S]{0,300}restoreWorkspaceConflictRetry\(operationUserId\)/,
  "a successful account pull must preserve an outstanding workspace conflict boundary",
);
assert.match(
  providerSource,
  /const restoreWorkspaceConflictRetry = useCallback[\s\S]{0,400}setNextRetryAt\(gate\.retryAt\)/,
  "restoring a conflict boundary must retain its attempt and retry timestamp",
);
assert.match(
  providerSource,
  /await performSync\(false, true, true\)/,
  "only an explicit manual sync may bypass the workspace conflict boundary",
);
assert.match(
  groupCloudSource,
  /const fastRecentDateSet = new Set\(fastRecentDates\);[\s\S]{0,220}const supplementalStatusDates = statusDates\.filter\([\s\S]{0,180}!fastRecentDateSet\.has\(localDate\)[\s\S]{0,260}buildCloudDailyStatusRows\([\s\S]{0,180}supplementalStatusDates/,
  "the detailed workspace pass must build only dates outside its already-published recent window",
);
assert.match(
  statusNoopMigration,
  /to_jsonb\(new\) - 'updated_at'[\s\S]*is not distinct from[\s\S]*to_jsonb\(old\) - 'updated_at'[\s\S]*return null/i,
  "the database must cancel exact status no-op updates before tuple churn",
);
assert.match(
  statusNoopMigration,
  /new\.updated_at = statement_timestamp\(\)[\s\S]*return new/i,
  "meaningful status updates must still receive a fresh server timestamp",
);
assert.match(
  statusNoopMigration,
  /revoke all on function public\.touch_daily_metric_status_updated_at\(\)[\s\S]*from public, anon, authenticated/i,
  "the internal trigger helper must not remain directly executable by clients",
);

console.log(
  "Profile/cloud validation passed: rename merges, revision-confirmed alias publication, bounded conflict retry, exact metadata projection, status-cache isolation, publication coalescing, and server-side no-op cancellation.",
);
