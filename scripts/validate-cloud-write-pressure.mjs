import assert from "node:assert/strict";
import fs from "node:fs";

import { accountOwnedCollections } from "../src/domain/accountCollections.ts";
import {
  orderedValueHash,
  stableValueHash,
} from "../src/domain/cloudHash.ts";
import { cloudSourceTimestampIsNewer } from "../src/domain/cloudMaintenance.ts";

const cloudProvider = fs.readFileSync(
  "src/cloud/CloudSyncProvider.tsx",
  "utf8",
);
const groupCloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/202608240008_conditional_daily_status_upserts.sql",
  "utf8",
);
const idempotentDeletionMigration = fs.readFileSync(
  "supabase/migrations/202608280004_idempotent_group_entry_deletion_ack.sql",
  "utf8",
);

assert.equal(
  cloudSourceTimestampIsNewer(
    "2026-08-24T14:30:00.000Z",
    "2026-08-24 14:30:00+00:00",
  ),
  false,
  "equivalent device/Postgres timestamp formats must not rewrite a detailed Health row",
);
assert.equal(
  cloudSourceTimestampIsNewer(
    "2026-08-24T14:30:00.001Z",
    "2026-08-24 14:30:00+00:00",
  ),
  true,
);
assert.equal(
  cloudSourceTimestampIsNewer(
    "2026-08-24T14:29:59.999Z",
    "2026-08-24 14:30:00+00:00",
  ),
  false,
);
assert.match(
  groupCloud,
  /cloudSourceTimestampIsNewer\(\s*entry\.sourceUpdatedAt,\s*remote\.source_updated_at,?\s*\)/,
  "detailed entry diffs must compare source revisions as instants",
);
assert.doesNotMatch(
  groupCloud,
  /entry\.sourceUpdatedAt\s*>\s*remote\.source_updated_at/,
);

assert.match(
  cloudProvider,
  /workspaceSessionAckHashesRef\.current\.set\(\s*pushedGroupId,\s*pushedWorkspaceHash,?\s*\)[\s\S]{0,400}workspaceAckMayPersist\(candidate\)/,
  "every successful workspace publish needs an in-session ACK even when privacy forbids durable hash storage",
);
const workspaceHashStart = cloudProvider.indexOf(
  "function workspaceHash(state: AppState)",
);
const workspaceHashEnd = cloudProvider.indexOf(
  "async function resolvePrivateMedia",
  workspaceHashStart,
);
const workspaceHashBlock = cloudProvider.slice(
  workspaceHashStart,
  workspaceHashEnd,
);
assert.ok(workspaceHashStart >= 0 && workspaceHashEnd > workspaceHashStart);
assert.match(workspaceHashBlock, /accountOwnedCollections\(state\)/);
assert.match(workspaceHashBlock, /orderedValueHash\(owned\.entries\)/);
assert.match(workspaceHashBlock, /orderedValueHash\(owned\.photos\)/);
assert.doesNotMatch(workspaceHashBlock, /orderedValueHash\(state\.entries\)/);
assert.doesNotMatch(workspaceHashBlock, /orderedValueHash\(state\.photos\)/);
assert.doesNotMatch(workspaceHashBlock, /signedUrl|avatarUrl|imageUri/);
assert.match(
  cloudProvider,
  /workspaceHashRef\.current\s*=\s*workspaceSessionAckHashesRef\.current\.get\(groupId\)\s*\?\?\s*null/,
  "activity refresh must retain the volatile Google Health workspace ACK",
);
assert.doesNotMatch(
  cloudProvider,
  /needsFollowUpSync\s*\?\s*Date\.now\(\)\s*\+\s*500/,
  "an ACK mismatch must not retry a full workspace twice per second",
);

const workspaceDigest = (state) => {
  const owned = accountOwnedCollections(state);
  return stableValueHash({
    entries: orderedValueHash(owned.entries),
    photos: orderedValueHash(owned.photos),
  });
};
const base = {
  currentUserId: "owner",
  entries: [
    { id: "owned-entry", userId: "owner", value: 1 },
    { id: "peer-entry", userId: "peer", value: 2 },
  ],
  photos: [
    { id: "owned-photo", userId: "owner", uri: "owned" },
    { id: "peer-photo", userId: "peer", uri: "peer-old" },
  ],
  messages: [],
  dailyMetricStatuses: [],
};
assert.equal(
  workspaceDigest(base),
  workspaceDigest({
    ...base,
    entries: [base.entries[0], { ...base.entries[1], value: 3 }],
    photos: [base.photos[0], { ...base.photos[1], uri: "peer-new" }],
  }),
  "foreign member activity/photo refreshes must not reopen this account's workspace outbox",
);
assert.notEqual(
  workspaceDigest(base),
  workspaceDigest({
    ...base,
    entries: [{ ...base.entries[0], value: 4 }, base.entries[1]],
  }),
  "an owned entry change must still reopen the workspace outbox",
);

assert.match(
  groupCloud,
  /acknowledgedSupersededStepFallbackIdsByGroup\s*=\s*new Map/,
  "superseded private Steps fallbacks need a process-scoped server acknowledgement",
);
assert.match(
  groupCloud,
  /supersededSharedStepFallbackIds[\s\S]{0,900}!acknowledgedSupersededFallbackIds\.has\(entryId\)/,
  "an acknowledged absent Steps fallback must not reopen the delete outbox on every autosave",
);
assert.match(
  groupCloud,
  /if \(deleted\.error\)[\s\S]{0,320}acknowledgedSupersededFallbackIds\.add\(entryId\)/,
  "a Steps fallback deletion may only be acknowledged after the server RPC succeeds",
);
assert.match(
  idempotentDeletionMigration,
  /create or replace function public\.delete_group_metric_entries\([\s\S]{0,260}security definer/,
);
assert.match(
  idempotentDeletionMigration,
  /perform public\.assert_account_snapshot_revision\([\s\S]{0,150}p_expected_revision[\s\S]{0,900}public\.delete_group_metric_entries\(/,
  "idempotent deletion acknowledgement must retain the account revision/privacy fence before canonical deletion",
);
assert.match(
  idempotentDeletionMigration,
  /left join removed[\s\S]{0,500}grant execute[\s\S]{0,120}to authenticated/,
  "already-absent requested ids must be acknowledged without widening RPC access",
);

assert.match(
  migration,
  /create or replace function public\.upsert_daily_metric_status_rows_if_changed\([\s\S]{0,160}security invoker/,
  "conditional status writes must remain governed by existing RLS",
);
assert.match(
  migration,
  /on conflict \(group_id, metric_id, user_id, local_date\) do update[\s\S]{0,1400}is distinct from[\s\S]{0,900}metric_privacy_cache_fences/,
  "no-op suppression must retain the privacy-fence re-share revision path",
);
assert.match(
  migration,
  /create or replace function public\.touch_group_member_data_freshness\([\s\S]{0,420}auth\.uid\(\)[\s\S]{0,500}status = 'active'[\s\S]{0,500}interval '1 minute'/,
  "no-change freshness must be caller-owned, active-membership-only, and rate limited",
);
assert.match(
  groupCloud,
  /changedStatusRows === 0[\s\S]{0,500}touch_group_member_data_freshness/,
  "an unchanged projection must use the freshness-only path",
);
assert.match(
  groupCloud,
  /touch_group_member_data_freshness[\s\S]{0,500}published: true/,
  "a successful unchanged publish must refresh the member timestamp without version churn",
);

console.log(
  "Cloud write-pressure validation passed (volatile ACK retention, owned projection, idempotent deletion ACK, timestamp canonicalization, conditional status writes, and bounded freshness).",
);
