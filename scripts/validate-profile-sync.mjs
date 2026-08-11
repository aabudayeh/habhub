import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  accountMemberProfile,
  applyAccountMemberProfile,
  mergeAccountMemberProfile,
  profileProjectionLagsSnapshot,
} from "../src/domain/accountProfile.ts";

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

console.log(
  "Profile sync validation passed: clean/dirty rename, concurrent avatar edits, and multi-group shells.",
);
