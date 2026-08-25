import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import {
  cloudEntryNeedsItemDetail,
  HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS,
  shouldAuditHistoricalSummary,
} from "../src/domain/cloudMaintenance.ts";
import { localPersistenceChanged } from "../src/domain/localPersistence.ts";
import { advanceAuthoritativeStateFromRender } from "../src/domain/authoritativeState.ts";
import {
  canBootstrapCloudSnapshotCursor,
  cloudSnapshotCursorForAcknowledgement,
  cloudSnapshotCursorMatches,
} from "../src/domain/cloudSnapshotCursor.ts";

const cloudProvider = fs.readFileSync(
  "src/cloud/CloudSyncProvider.tsx",
  "utf8",
);
const groupCloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const appProvider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const snapshotPrivacy = fs.readFileSync("src/cloud/snapshotPrivacy.ts", "utf8");

assert.match(
  appProvider,
  /if \(next === previous\)[\s\S]{0,160}persistImmediately[\s\S]{0,100}persistLatestState\(true\)/,
  "an unchanged ACKing replacement must still drain an earlier pending device-cache write",
);
assert.match(
  appProvider,
  /if \(!durableChange\)[\s\S]{0,160}persistImmediately[\s\S]{0,100}persistLatestState\(true\)/,
  "a transient-only ACKing replacement must still drain an earlier pending durable write",
);

// Every provider state replacement is deliberately classified. This makes a
// newly-added optimistic/user mutation fail this gate instead of silently
// inheriting the cloud default and losing its automatic publication signal.
const replaceStateCalls = [
  ...cloudProvider.matchAll(/\breplaceState\([\s\S]*?\);/g),
].map((match) => match[0]);
assert.equal(
  replaceStateCalls.length,
  34,
  "update the source-classification fixture when replaceState calls change",
);
replaceStateCalls.forEach((call, index) =>
  assert.match(
    call,
    /source:\s*(?:"(?:cloud|local)"|[A-Za-z][\w]*\s*\?\s*"local"\s*:\s*"cloud")/,
    `replaceState call ${index + 1} must explicitly classify its source`,
  ),
);
assert.equal(
  (cloudProvider.match(/source:\s*"local"/g)?.length ?? 0) +
    (cloudProvider.match(/source:\s*[A-Za-z][\w]*\s*\?\s*"local"\s*:\s*"cloud"/g)?.length ?? 0),
  12,
  "local/hybrid outbox replacements must retain their publication signal",
);
assert.match(cloudProvider, /replaceState\(evicted, \{ source: "local" \}\)/);
assert.match(
  cloudProvider,
  /source:\s*preserveLocalAccount\s*\?\s*"local"\s*:\s*"cloud"/,
);
assert.match(
  cloudProvider,
  /readCloudResponsively[\s\S]{0,900}subscribeUserInteraction\(\(\) => controller\.abort\(\)\)/,
  "a touch must abort an in-flight native payload read before JSON projection",
);
assert.match(
  cloudProvider,
  /const result = await read\(controller\?\.signal\);[\s\S]{0,250}controller\?\.signal\.aborted[\s\S]{0,100}continue/,
  "even a non-abortable helper response must be discarded when a touch landed while it was pending",
);
assert.ok(
  (cloudProvider.match(/await yieldCloudMaintenanceToUi\(\);[\s\S]{0,160}await persistPrivateSnapshot\(\)/g)?.length ?? 0) >= 2,
  "full private snapshot serialization must re-enter a real touch-quiet lane immediately before each write",
);
assert.match(
  cloudProvider,
  /function waitForCloudCacheWriteTurn[\s\S]{0,400}minimumUserQuietMs: 1_600/,
  "merge-base JSON persistence must use the real-touch quiet gate",
);
assert.ok(
  (groupCloud.match(/abortSignal\(signal\)/g)?.length ?? 0) >= 17,
  "every account/group response branch must stop before parsing after a touch",
);
assert.ok(
  [
    ...cloudProvider.matchAll(
      /writeGroupActivityCache\([\s\S]{0,900}minimumUserQuietMs: 1_600/g,
    ),
  ].length >= 2,
  "large SQLite group-cache serialization must wait for real-touch quiet",
);
assert.match(
  cloudProvider,
  /replaceState\(merged, \{ source: "local" \}\)[\s\S]{0,180}setPendingChanges\(true\)/,
  "a three-way conflict rebase must remain a durable outbox",
);
for (const localTransition of [
  "replaceState(optimistic, { source: \"local\" })",
  "replaceState(markedComplete, { source: \"local\" })",
  "replaceState(purged, { source: \"local\" })",
  "replaceState(before, { source: \"local\" })",
])
  assert.ok(
    cloudProvider.includes(localTransition),
    `${localTransition} must wake autosync`,
  );

const autoSyncStart = cloudProvider.indexOf("const changedAt = Date.now();");
const autoSyncEnd = cloudProvider.indexOf("]);", autoSyncStart);
assert.ok(autoSyncStart >= 0 && autoSyncEnd > autoSyncStart);
const autoSyncEffect = cloudProvider.slice(autoSyncStart, autoSyncEnd);
assert.match(autoSyncEffect, /localMutationRevision/);
assert.doesNotMatch(
  autoSyncEffect,
  /\n\s*state,\s*\n/,
  "cloud hydration must not restart monolithic account hashing",
);
assert.match(
  appProvider,
  /if \(source === "local"\)[\s\S]{0,100}setLocalMutationRevision/,
);
assert.match(
  appProvider,
  /if \(!durableChange\)[\s\S]{0,180}return persistImmediately[\s\S]{0,80}\? persistLatestState\(true\)[\s\S]{0,80}: Promise\.resolve\(\)/,
  "presence/signed-URL wrappers must skip monolithic JSON persistence unless an ACK must drain an earlier durable write",
);
assert.match(
  appProvider,
  /if \(source === "cloud"\) \{[\s\S]{0,500}queueCloudRender\(\)/,
  "cloud hydration renders must enter the coalesced interaction-priority lane",
);
assert.match(
  appProvider,
  /cancelQueuedCloudRender\(\);[\s\S]{0,120}dispatch\(\{ type: "replaceLocal", state: committed \}\)/,
  "local edits must remain on the urgent render lane",
);
assert.match(
  appProvider,
  /minimumUserQuietMs: 1_500/,
  "cloud context publication must wait for a real-touch quiet window",
);
assert.match(
  snapshotPrivacy,
  /rpc\("get_user_snapshot_metadata",[\s\S]{0,120}p_client_schema_version/,
  "cold start must capability-gate a tiny revision RPC before downloading snapshot JSON",
);
const startupCursorBranch = cloudProvider.indexOf(
  "const cachedSnapshotIsCurrent =",
);
const startupPayloadSelectionStart = cloudProvider.indexOf(
  "const remote =",
  startupCursorBranch,
);
const startupPayloadSelectionEnd = cloudProvider.indexOf(
  ": null;",
  startupPayloadSelectionStart,
);
assert.ok(
  startupCursorBranch >= 0 &&
    startupPayloadSelectionStart >= 0 &&
    startupPayloadSelectionEnd > startupPayloadSelectionStart,
  "startup snapshot payload selection must remain identifiable",
);
const startupPayloadSelection = cloudProvider.slice(
  startupPayloadSelectionStart,
  startupPayloadSelectionEnd,
);
assert.match(
  startupPayloadSelection,
  /remoteMetadata && !cachedSnapshotIsCurrent/,
  "unchanged acknowledged revisions must not enter the payload read branch",
);
assert.match(
  startupPayloadSelection,
  /readCloudResponsively\(\(signal\)[\s\S]*fetchSnapshot\(user\.id, signal\)/,
  "changed snapshots must delay and abort their full payload read around touches",
);
assert.match(
  cloudProvider,
  /const renderedStateRef = useRef\(state\);[\s\S]{0,500}if \(renderedStateRef\.current !== state\)[\s\S]{0,500}stateRef\.current = state/,
  "an interim status render must not overwrite a transition-pending cloud ref",
);

// A parent render carrying the old React value must not overwrite a newer
// cloud-authoritative ref before its deferred transition commits.
const renderedA = { revision: 1 };
const cloudB = { revision: 2 };
assert.equal(
  advanceAuthoritativeStateFromRender(cloudB, renderedA, renderedA),
  cloudB,
);
assert.equal(
  canBootstrapCloudSnapshotCursor({
    hasCursor: false,
    metadata: { revision: 7, updated_at: "2026-08-21T11:59:00.000Z" },
    acknowledgedHash: "hash-7",
    currentHash: "hash-7",
    savedCheckpoint: "2026-08-21T11:59:00.000Z",
    accountIdentityMatches: true,
  }),
  true,
  "an exact pre-cursor ACK/checkpoint pair must avoid one upgrade full fetch",
);
assert.equal(
  canBootstrapCloudSnapshotCursor({
    hasCursor: false,
    metadata: { revision: 8, updated_at: "2026-08-21T12:01:00.000Z" },
    acknowledgedHash: "hash-7",
    currentHash: "hash-7",
    savedCheckpoint: "2026-08-21T11:59:00.000Z",
    accountIdentityMatches: true,
  }),
  false,
  "a newer server timestamp must still fetch and merge the payload",
);
assert.ok(
  (cloudProvider.match(/mergeLocalCurrentDayDeviceStepEntries\(/g)?.length ?? 0) >= 2,
  "clean and dirty cloud snapshot merges must preserve a newer phone-confirmed current-day Steps revision",
);
assert.equal(
  advanceAuthoritativeStateFromRender(cloudB, renderedA, cloudB),
  cloudB,
);

// A successful local upload stores the exact revision+hash cursor. The next
// cold start can use its lightweight metadata response; remote advancement or
// a mismatched ACK still forces a full merge.
const localUploadCursor = cloudSnapshotCursorForAcknowledgement(
  { revision: 8, updated_at: "2026-08-21T12:00:00.000Z" },
  "hash-8",
);
assert.equal(
  cloudSnapshotCursorMatches(
    localUploadCursor,
    { revision: 8, updated_at: "2026-08-21T12:00:00.000Z" },
    "hash-8",
    "hash-8",
    true,
  ),
  true,
);
assert.equal(
  cloudSnapshotCursorMatches(
    localUploadCursor,
    { revision: 9, updated_at: "2026-08-21T12:01:00.000Z" },
    "hash-8",
    "hash-8",
    true,
  ),
  false,
);
assert.equal(
  cloudSnapshotCursorMatches(
    localUploadCursor,
    { revision: 8, updated_at: "2026-08-21T12:00:00.000Z" },
    "older-hash",
    "older-hash",
    true,
  ),
  false,
);
assert.equal(
  cloudSnapshotCursorMatches(
    localUploadCursor,
    { revision: 8, updated_at: "2026-08-21T12:00:00.000Z" },
    "hash-8",
    "stale-local-cache",
    true,
  ),
  false,
  "a crash-before-local-persist must not let a matching cursor bless stale cached state",
);
assert.equal(
  cloudSnapshotCursorMatches(
    localUploadCursor,
    { revision: 8, updated_at: "2026-08-21T12:00:00.000Z" },
    "hash-8",
    "hash-8",
    false,
  ),
  false,
  "a cursor from another cached account must never skip the server payload",
);
assert.match(
  cloudProvider,
  /await waitForUi\(0, 1_200\);[\s\S]{0,800}currentSnapshotHash[\s\S]{0,500}cloudSnapshotCursorMatches\([\s\S]{0,300}currentSnapshotHash[\s\S]{0,200}accountIdentityMatches/,
  "startup must re-check the restored cache after a real touch-quiet turn before using its cursor",
);
const startupAccept = cloudProvider.slice(
  cloudProvider.indexOf("let resolved = correctedAccountState"),
  cloudProvider.indexOf("setStatus(\"synced\")", cloudProvider.indexOf("let resolved = correctedAccountState")),
);
assert.ok(
  startupAccept.indexOf("await replaceState(") >= 0 &&
    startupAccept.indexOf("persistImmediately: shouldAcknowledgeRemoteSnapshot") >
      startupAccept.indexOf("await replaceState(") &&
    startupAccept.indexOf("await writeCloudSnapshotAck") >
      startupAccept.indexOf("persistImmediately: shouldAcknowledgeRemoteSnapshot") &&
    startupAccept.indexOf("await writeCloudSnapshotCursor") >
      startupAccept.indexOf("persistImmediately: shouldAcknowledgeRemoteSnapshot") &&
    startupAccept.indexOf("await writeAccountMetadataAck") >
      startupAccept.indexOf("await replaceState("),
  "every startup state that acknowledges the remote snapshot must durably persist before its account/snapshot ACKs can make a later launch trust that revision",
);
assert.ok(
  startupAccept.indexOf("stateRef.current = resolved") <
      startupAccept.indexOf("await replaceState(") &&
    startupAccept.indexOf("stateRef.current = resolved", startupAccept.indexOf("await replaceState(") + 1) === -1,
  "a local edit during startup persistence must not be overwritten by a post-await stale ref assignment",
);
const ordinaryPull = cloudProvider.slice(
  cloudProvider.indexOf("const pullLatestOnce"),
  cloudProvider.indexOf("const scheduleRequiredPull"),
);
assert.ok(
  ordinaryPull.indexOf("stateRef.current = resolved") <
      ordinaryPull.indexOf("await replaceState(") &&
    ordinaryPull.indexOf("persistImmediately: shouldAcknowledgeRemoteSnapshot") >
      ordinaryPull.indexOf("await replaceState(") &&
    ordinaryPull.indexOf("await writeCloudSnapshotAck") >
      ordinaryPull.indexOf("await replaceState(") &&
    ordinaryPull.indexOf("stateRef.current = resolved", ordinaryPull.indexOf("await replaceState(") + 1) === -1,
  "ordinary pulls must persist before ACK and retain a local edit that lands during the awaited flush",
);
const uploadAck = cloudProvider.slice(
  cloudProvider.indexOf("await persistPrivateSnapshot();", cloudProvider.indexOf("const performSync")),
  cloudProvider.indexOf("if (workspaceSynced)", cloudProvider.indexOf("await persistPrivateSnapshot();", cloudProvider.indexOf("const performSync"))),
);
assert.ok(
  uploadAck.indexOf("await flushLocalPersistence()") >= 0 &&
    uploadAck.indexOf("await writeAccountMetadataAck") >
      uploadAck.indexOf("await flushLocalPersistence()") &&
    uploadAck.indexOf("await writeWorkspaceAcks") >
      uploadAck.indexOf("await flushLocalPersistence()") &&
    uploadAck.indexOf("await writeGroupConfigurationAcks") >
      uploadAck.indexOf("await flushLocalPersistence()") &&
    uploadAck.indexOf("await writeCloudSnapshotAck") >
      uploadAck.indexOf("await flushLocalPersistence()") &&
    uploadAck.indexOf("await writeCloudSnapshotCursor") >
      uploadAck.indexOf("await flushLocalPersistence()"),
  "successful uploads must flush the acknowledged-or-newer local cache before storing their ACK/cursor",
);
assert.match(
  cloudProvider,
  /const preserveLocalGroupConfiguration =\s*live\.group\.id === groupId && explicitlyPending/,
  "only the explicit durable group-configuration outbox may preserve local settings over a server hydration",
);
assert.match(
  cloudProvider,
  /const shouldPushGroupConfiguration = pendingGroupConfiguration/,
  "an ACK hash mismatch alone must never authorize republishing cached group settings",
);
assert.doesNotMatch(
  cloudProvider.slice(
    cloudProvider.indexOf("const mergeRemoteWorkspace"),
    cloudProvider.indexOf("const flushChatOutbox"),
  ),
  /writeGroupConfigurationAcks/,
  "remote workspace merging must not persist an ACK before its caller persists the accepted state",
);

const dirtyPull = cloudProvider.slice(
  cloudProvider.indexOf("const preserveLocalAccount"),
  cloudProvider.indexOf("recordServerSyncedAt(remote.updated_at)", cloudProvider.indexOf("const preserveLocalAccount")),
);
assert.ok(
  dirtyPull.indexOf("await ensureLatestCloudMergeBase(operationUserId)") <
    dirtyPull.indexOf("mergeStates("),
  "a dirty pull must await the latest acknowledged merge base before rebasing",
);
const conflictStart = cloudProvider.indexOf('if (/snapshot_conflict/i.test(syncErrorText))');
const conflictEnd = cloudProvider.indexOf("const offline =", conflictStart);
const conflictPath = cloudProvider.slice(conflictStart, conflictEnd);
assert.ok(conflictStart >= 0 && conflictEnd > conflictStart);
assert.ok(
  conflictPath.indexOf("await ensureLatestCloudMergeBase(operationUserId)") <
    conflictPath.indexOf("mergeStates("),
  "a revision conflict must await the latest acknowledged merge base",
);
const mergeBaseDrainStart = cloudProvider.indexOf(
  "const ensureLatestCloudMergeBase",
);
const mergeBaseDrainEnd = cloudProvider.indexOf(
  "const fetchConflictSnapshot",
  mergeBaseDrainStart,
);
const mergeBaseDrain = cloudProvider.slice(
  mergeBaseDrainStart,
  mergeBaseDrainEnd,
);
assert.match(mergeBaseDrain, /if \(active\) \{[\s\S]{0,100}await active/);
assert.match(mergeBaseDrain, /mergeBaseBuildTaskRef\.current\?\.cancel\(\)/);
assert.match(
  mergeBaseDrain,
  /createCloudMergeBaseResponsively[\s\S]{0,800}\.catch\(\(\) => undefined\)[\s\S]{0,120}\.finally/,
  "cancelled/coalesced merge-base builds must always settle their waiter",
);
assert.match(
  cloudProvider,
  /hashLargeCollectionResponsively[\s\S]{0,900}waitForResponsiveTurn\([\s\S]{0,180}await turn\.promise/,
  "large merge-base maps must yield between bounded chunks",
);

assert.match(
  groupCloud,
  /const auditKey = `\$\{state\.currentUserId\}:\$\{state\.group\.id\}`/,
  "historical maintenance cache keys must be account- and group-scoped",
);
assert.match(
  groupCloud,
  /remoteStatusCount: needsHistoricalSummaryRepair[\s\S]{0,1200}latestRemoteStatusUpdatedAt: activityCommit\.updatedAt/,
  "a repaired history audit must acknowledge its completed coverage",
);
assert.ok(
  (groupCloud.match(/await yieldMaintenance\(\)/g)?.length ?? 0) >= 5,
  "long relational publication phases must yield to native interactions",
);
assert.equal(
  cloudEntryNeedsItemDetail({
    metricId: "steps",
    source: "imported",
    sourceOrigin: "com.samsung.android.app.healthdata",
    note: "Synced from Samsung Health",
  }),
  false,
  "generated provider provenance must not upload an imported sensor row",
);
assert.equal(
  cloudEntryNeedsItemDetail({
    metricId: "steps",
    source: "imported",
    sourceOrigin: "com.samsung.android.app.healthdata",
    note: "Outdoor walk · Synced from Samsung Health",
  }),
  true,
  "a genuine source/user note must retain the detailed imported row",
);
assert.equal(
  cloudEntryNeedsItemDetail({
    metricId: "food",
    source: "imported",
    sourceOrigin: "com.example.food",
    label: "Lunch",
  }),
  true,
  "named meals must remain available in the shared item log",
);
assert.equal(
  cloudEntryNeedsItemDetail({
    metricId: "workout",
    source: "imported",
    sourceOrigin: "com.example.fitness",
    label: "Morning run",
  }),
  true,
  "named workouts must remain available in the shared item log",
);

const member = {
  id: "owner",
  name: "Owner",
  initials: "O",
  color: "#123456",
  role: "owner",
};
const group = {
  id: "group-1",
  name: "Group",
  inviteCode: "ABC123",
  templateName: "Custom",
  members: [member],
  streakRestDaysPerWeek: 1,
  themeColor: "#123456",
  metricConfiguration: [],
};
const entries = Array.from({ length: 50_000 }, (_, index) => ({
  id: `entry-${index}`,
  metricId: "steps",
  userId: index % 5 === 0 ? "peer" : "owner",
  localDate: "2026-08-20",
  recordedAt: "2026-08-20T12:00:00.000Z",
  value: index,
  visibility: "group",
}));
const base = {
  version: 1,
  currentUserId: "owner",
  group,
  groups: [group],
  energyProfiles: [],
  metrics: [],
  entries,
  photos: [],
  messages: [],
  dailyMetricStatuses: [],
  gymPlans: [],
  gymSessions: [],
  gymExerciseGoals: [],
  todos: [],
  journalNotes: [],
  calendarReminders: [],
  activityTimers: [],
  activeTimer: undefined,
  settings: { darkMode: false },
  trackedGoalPeriods: [],
  selectedGroupMetricId: undefined,
};
const presenceMember = {
  ...member,
  lastSeenAt: "2026-08-21T12:00:00.000Z",
  lastDataSyncedAt: "2026-08-21T11:59:00.000Z",
  profileRevision: 9,
};
const presenceGroup = { ...group, members: [presenceMember] };
const peerOnlyEntries = entries.map((entry) =>
  entry.userId === "owner" ? entry : { ...entry, value: entry.value + 1 },
);
const presence = {
  ...base,
  group: presenceGroup,
  groups: [presenceGroup],
  entries: peerOnlyEntries,
};
const presenceStartedAt = performance.now();
assert.equal(
  localPersistenceChanged(base, presence),
  false,
  "peer activity/presence must not dirty the private account cache",
);
const presenceMs = performance.now() - presenceStartedAt;
assert.ok(
  presenceMs < 750,
  `50k-row transient persistence classification took ${presenceMs.toFixed(1)}ms`,
);
assert.equal(
  localPersistenceChanged(base, {
    ...base,
    settings: { ...base.settings, darkMode: true },
  }),
  true,
);
const changedOwnedEntries = [...entries];
changedOwnedEntries[1] = { ...changedOwnedEntries[1], value: -1 };
assert.equal(
  localPersistenceChanged(base, { ...base, entries: changedOwnedEntries }),
  true,
  "an immutable owned-row edit must remain durable",
);
const storedAvatarMember = {
  ...member,
  avatarStoragePath: "owner/avatar.jpg",
  avatarUri: "https://signed.example/one",
};
const storedAvatarGroup = { ...group, members: [storedAvatarMember] };
const storedAvatarBase = {
  ...base,
  group: storedAvatarGroup,
  groups: [storedAvatarGroup],
};
const refreshedAvatarMember = {
  ...storedAvatarMember,
  avatarUri: "https://signed.example/two",
};
const refreshedAvatarGroup = { ...group, members: [refreshedAvatarMember] };
assert.equal(
  localPersistenceChanged(storedAvatarBase, {
    ...storedAvatarBase,
    group: refreshedAvatarGroup,
    groups: [refreshedAvatarGroup],
  }),
  false,
  "rotating signed URLs must not rewrite the offline snapshot",
);
const storedEntry = {
  ...entries[1],
  imageStoragePath: "owner/meal.jpg",
  imageUri: "https://signed.example/meal-one",
};
const storedPhoto = {
  id: "photo-1",
  userId: "owner",
  uri: "https://signed.example/photo-one",
  storagePath: "owner/photo.jpg",
  caption: "Progress",
  localDate: "2026-08-20",
  createdAt: "2026-08-20T12:00:00.000Z",
  visibility: "private",
};
const storedMessage = {
  id: "message-1",
  senderId: "owner",
  text: "Photo",
  createdAt: "2026-08-20T12:00:00.000Z",
  kind: "message",
  imageStoragePath: "owner/chat.jpg",
  imageUri: "https://signed.example/chat-one",
};
const mediaBase = {
  ...base,
  entries: [storedEntry],
  photos: [storedPhoto],
  messages: [storedMessage],
};
assert.equal(
  localPersistenceChanged(mediaBase, {
    ...mediaBase,
    entries: [
      { ...storedEntry, imageUri: "https://signed.example/meal-two" },
    ],
    photos: [
      { ...storedPhoto, uri: "https://signed.example/photo-two" },
    ],
    messages: [
      { ...storedMessage, imageUri: "https://signed.example/chat-two" },
    ],
  }),
  false,
  "rotating entry/photo/chat signed URLs must remain presentation-only",
);
assert.equal(
  localPersistenceChanged(mediaBase, {
    ...mediaBase,
    photos: [{ ...storedPhoto, caption: "Durable edit" }],
  }),
  true,
  "durable media metadata must still invalidate local persistence",
);
const localAvatarGroup = {
  ...group,
  members: [{ ...member, avatarUri: "file:///offline-avatar.jpg" }],
};
assert.equal(
  localPersistenceChanged(base, {
    ...base,
    group: localAvatarGroup,
    groups: [localAvatarGroup],
  }),
  true,
  "an offline avatar without a storage path must remain durable",
);

const auditedAt = 1_000_000;
const cachedAudit = {
  auditedAt,
  earliestLocalDate: "2024-01-01",
  distinctLocalDateCount: 365,
};
assert.equal(
  shouldAuditHistoricalSummary({
    now: auditedAt + HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS - 1,
    cached: cachedAudit,
    earliestLocalDate: "2024-01-01",
    distinctLocalDateCount: 365,
    groupMetricSetChanged: false,
    pendingPrivacyFenceCount: 0,
  }),
  false,
);
assert.equal(
  shouldAuditHistoricalSummary({
    now: auditedAt + HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS,
    cached: cachedAudit,
    earliestLocalDate: "2024-01-01",
    distinctLocalDateCount: 365,
    groupMetricSetChanged: false,
    pendingPrivacyFenceCount: 0,
  }),
  true,
);
for (const changed of [
  { earliestLocalDate: "2023-12-31" },
  { distinctLocalDateCount: 366 },
  { groupMetricSetChanged: true },
  { pendingPrivacyFenceCount: 1 },
])
  assert.equal(
    shouldAuditHistoricalSummary({
      now: auditedAt + 1,
      cached: cachedAudit,
      earliestLocalDate: "2024-01-01",
      distinctLocalDateCount: 365,
      groupMetricSetChanged: false,
      pendingPrivacyFenceCount: 0,
      ...changed,
    }),
    true,
  );

// Validate the memoization contract itself: AppProvider's reducer is immutable
// and does not directly assign to or mutate an AppState collection.
const reducerStart = appProvider.indexOf("function reducer(");
const reducerEnd = appProvider.indexOf("type AppContextValue", reducerStart);
const reducerSource = appProvider.slice(reducerStart, reducerEnd);
assert.ok(reducerStart >= 0 && reducerEnd > reducerStart);
assert.doesNotMatch(
  reducerSource,
  /\bstate\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\s*=(?!=)/,
  "AppState reducers must replace nested objects instead of mutating them",
);
assert.doesNotMatch(
  reducerSource,
  /\bstate\.[A-Za-z_$][\w$]*\.(?:push|splice|sort)\(/,
  "AppState collection reducers must preserve immutable references",
);

console.log(
  `Native sync performance validation passed (34 classified replacements; 50k-row transient check ${presenceMs.toFixed(1)} ms).`,
);
