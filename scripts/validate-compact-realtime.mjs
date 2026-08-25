import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

const migration = read(
  "supabase/migrations/202608250001_compact_group_realtime.sql",
);
const provider = read("src/cloud/CloudSyncProvider.tsx");
const challenges = read("src/cloud/useGroupChallenges.ts");
const notifications = read("src/cloud/useGroupNotificationEvents.ts");
const sharedBroadcast = read("src/cloud/privateBroadcast.ts");
const clientSource = ["app", "src"]
  .flatMap((directory) => sourceFiles(path.join(root, directory)))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

assert.doesNotMatch(
  clientSource,
  /["']postgres_changes["']/,
  "the client must not reopen a continuously-polled Postgres Changes stream",
);
assert.match(
  migration,
  /\^group:\[0-9a-fA-F-\]\{36\}:\(activity\|chat\|workspace\|challenges\)\$/,
);
for (const suffix of ["memberships", "chat", "group-notifications"])
  assert.match(migration, new RegExp(`account:.*:${suffix.replace("-", "\\-")}`));
for (const event of [
  "workspace_updated",
  "membership_updated",
  "message_committed",
  "challenges_updated",
  "notifications_updated",
])
  assert.match(migration, new RegExp(`'${event}'`));
for (const table of [
  "messages",
  "group_members",
  "metric_definitions",
  "photo_updates",
  "group_activity_versions",
  "group_challenges",
  "group_notification_events",
])
  assert.match(migration, new RegExp(`'${table}'`));
assert.match(migration, /alter publication supabase_realtime drop table/);
assert.match(migration, /membership\.status = 'active'/);
assert.doesNotMatch(
  migration,
  /jsonb_build_object\([^)]*(?:content|value|note|caption|payload)/i,
  "broadcast invalidations must not carry chat, health, photo, or entry values",
);

assert.match(provider, /account:\$\{auth\.user\.id\}:memberships/);
assert.match(provider, /group:\$\{state\.group\.id\}:workspace/);
assert.match(provider, /account:\$\{auth\.user\.id\}:chat/);
assert.match(challenges, /subscribePrivateBroadcast/);
assert.match(challenges, /group:\$\{groupId\}:challenges/);
assert.match(notifications, /account:\$\{auth\.user\.id\}:group-notifications/);
assert.match(sharedBroadcast, /const subscriptions = new Map/);
assert.match(sharedBroadcast, /config: \{ private: true, broadcast: \{ self: false \} \}/);

console.log("Compact private Realtime Broadcast cutover validation passed.");
