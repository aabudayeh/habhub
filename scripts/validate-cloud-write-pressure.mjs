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
assert.match(
  cloudProvider,
  /function workspaceHash\(state: AppState\)[\s\S]{0,180}snapshotPayload\(state\)[\s\S]{0,450}orderedValueHash\(payload\.entries\)[\s\S]{0,120}orderedValueHash\(payload\.photos\)/,
  "the workspace hash must use the account-owned, signed-URL-free snapshot projection",
);
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
  "Cloud write-pressure validation passed (volatile ACK retention, owned projection, timestamp canonicalization, conditional status writes, and bounded freshness).",
);
