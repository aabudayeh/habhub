import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  acknowledgeGroupPublication,
  backgroundGroupPublicationBatch,
  cloudPublicationGroups,
  groupProjectionId,
  groupProjectionSourceId,
  groupPublicationDigest,
  MAX_ADDITIONAL_GROUP_PUBLICATIONS_PER_PASS,
  MAX_BACKGROUND_GROUP_PUBLICATIONS_PER_PASS,
  mergeGroupProjectionRepairGeneration,
  pendingGroupPublications,
  repeatedGroupProjectionRepair,
  stateForGroupPublication,
  trackerVisibilityWithdrawsAccess,
} from "../src/domain/groupPublication.ts";
import { stableValueHash } from "../src/domain/cloudHash.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const metric = (slug) => ({ id: slug, defaultVisibility: "group" });
const group = (n, metricIds = ["steps"], owner = "owner") => ({
  id: id(n), members: [{ id: owner }],
  metricConfiguration: metricIds.map(metric),
});
const a = group(1, ["steps", "water"]);
const b = group(2, ["steps"]);
const privateSetup = { id: "account-starter-owner", members: [{ id: "owner" }] };
const state = {
  currentUserId: "owner", group: a,
  groups: [a, b, privateSetup, group(3, ["steps"], "someone-else")],
  entries: [{ id: "log-1", userId: "owner", metricId: "steps", value: 1234, visibility: "private" }],
  photos: [], messages: [], dailyMetricStatuses: [], trackedGoalPeriods: {},
  metrics: [{ ...metric("steps"), defaultVisibility: "private" }, metric("water")],
  settings: {
    groupNotificationPreferencesByGroup: { [a.id]: { chat: false }, [b.id]: { chat: true } },
    pendingMetricPrivacyFenceIdsByGroup: {},
  },
};
const digest = (current) => stableValueHash({
  groupId: current.group.id, metrics: current.group.metricConfiguration,
  entries: current.entries, personalMetrics: current.metrics,
  pending: current.settings.pendingMetricPrivacyFenceIdsByGroup[current.group.id] ?? [],
});

assert.deepEqual(cloudPublicationGroups(state).map((g) => g.id), [a.id, b.id]);
const destination = stateForGroupPublication(state, b);
assert.equal(destination.group, b);
assert.equal(destination.metrics, state.metrics, "another group's defaults never override personal tracker privacy");
assert.equal(destination.entries, state.entries, "publication must not copy or relabel source data");
assert.equal(destination.settings, state.settings, "destination projection preserves independent group preferences");
assert.equal(destination.entries[0].visibility, "private");
assert.deepEqual(destination.group.metricConfiguration.map((m) => m.id), ["steps"]);
assert.equal(state.group, a, "background publication never navigates the UI");
assert.equal(stateForGroupPublication(state, a), state, "already selected projection preserves identity");
assert.deepEqual(cloudPublicationGroups({ ...state, group: privateSetup }).map((g) => g.id), [a.id, b.id]);

for (const source of ["manual-1", "health-connect:provider:record:steps", "a/b:ü %?#", "id\nwith-line"]) {
  const left = groupProjectionId(a.id, source);
  const right = groupProjectionId(b.id, source);
  assert.notEqual(left, right, "same source has different durable destinations");
  assert.equal(groupProjectionId(a.id, left), left, "same-destination encoding is idempotent");
  assert.equal(groupProjectionSourceId(a.id, left), source);
  assert.equal(groupProjectionSourceId(b.id, left), left, "foreign identities cannot become owner source IDs");
  assert.throws(() => groupProjectionId(b.id, left), /cannot be rebound/, "foreign scoped identities must not be nested or moved into another destination");
  assert.equal(groupProjectionSourceId(a.id, source), source);
}
assert.throws(() => groupProjectionId(privateSetup.id, "log"));
assert.throws(() => groupProjectionId(a.id, ""));
assert.equal(groupProjectionSourceId(a.id, "habhub-group:invalid:log"), "habhub-group:invalid:log");
assert.equal(groupProjectionSourceId(a.id, "google-health-group:untouched"), "google-health-group:untouched");
assert.equal(groupProjectionId(a.id, `HABHUB-GROUP:${a.id.toUpperCase()}:MiXeD`), `habhub-group:${a.id}:MiXeD`);

const acknowledged = new Map();
const required = new Set();
let pending = pendingGroupPublications(state, acknowledged, required, digest);
assert.deepEqual(pending.map((item) => item.group.id), [a.id, b.id]);
acknowledged.set(a.id, pending[0].hash);
pending = pendingGroupPublications(state, acknowledged, required, digest);
assert.deepEqual(pending.map((item) => item.group.id), [b.id], "A success cannot ACK B");
// A failed B publish changes no ACK: it remains pending across normal sync checks.
assert.deepEqual(pendingGroupPublications(state, acknowledged, required, digest), pending);
acknowledged.set(b.id, pending[0].hash);
assert.equal(pendingGroupPublications(state, acknowledged, required, digest).length, 0);
const changed = { ...state, entries: [{ ...state.entries[0], value: 2345 }] };
assert.equal(pendingGroupPublications(changed, acknowledged, required, digest).length, 2, "one health/manual update dirties all eligible destinations");
assert.equal(pendingGroupPublications({ ...changed, group: privateSetup }, acknowledged, required, digest).length, 2, "private setup does not suspend joined groups");
const removed = { ...changed, groups: [a], group: a };
assert.deepEqual(pendingGroupPublications(removed, acknowledged, required, digest).map((item) => item.group.id), [a.id], "a membership removed in flight leaves no eligible destination");
required.add(a.id);
assert.deepEqual(pendingGroupPublications(state, acknowledged, required, digest).map((item) => item.group.id), [a.id]);
required.clear();
const withdrawal = {
  ...state,
  settings: { ...state.settings, pendingMetricPrivacyFenceIdsByGroup: { [b.id]: ["steps"] } },
};
assert.equal(pendingGroupPublications(withdrawal, acknowledged, required, digest)[0].group.id, b.id, "privacy withdrawal outranks normal activity");
for (const [before, after, expected] of [
  ["group", "private", true], ["group", "status", true], ["status", "private", true],
  ["private", "group", false], ["private", "status", false], ["status", "group", false],
  ["group", "group", false], ["private", "private", false],
]) assert.equal(trackerVisibilityWithdrawsAccess(before, after), expected);

const many = { ...state, group: privateSetup, groups: Array.from({ length: 23 }, (_, n) => group(n + 1)) };
const seen = new Set();
let cursor = 0;
for (let pass = 0; pass < 3; pass++) {
  const batch = backgroundGroupPublicationBatch(many, cursor);
  assert.ok(batch.groups.length <= MAX_BACKGROUND_GROUP_PUBLICATIONS_PER_PASS);
  batch.groups.forEach((g) => seen.add(g.id));
  cursor = batch.nextCursor;
}
assert.equal(seen.size, 23, "bounded native background rounds eventually cover every membership");
assert.equal(backgroundGroupPublicationBatch({ ...many, groups: [] }).groups.length, 0);
assert.equal(backgroundGroupPublicationBatch(many, Number.NaN).groups[0].id, id(1));
assert.equal(MAX_ADDITIONAL_GROUP_PUBLICATIONS_PER_PASS, 2);

const deleteState = {
  ...withdrawal,
  settings: {
    ...withdrawal.settings,
    pendingDeletedEntryIds: ["first", "newer-edit"],
    pendingDeletedPhotoIds: ["photo"],
  },
};
const ack = {
  deletedEntryIds: ["first"], deletedPhotoIds: ["photo"],
  acknowledgedPrivacyFenceMetricIds: ["steps"],
};
const completed = acknowledgeGroupPublication(deleteState, b.id, ack, true);
assert.deepEqual(completed.settings.pendingDeletedEntryIds, ["newer-edit"]);
assert.deepEqual(completed.settings.deletedEntryIds, ["first"]);
assert.deepEqual(completed.settings.deletedPhotoIds, ["photo"]);
assert.equal(completed.settings.pendingMetricPrivacyFenceIdsByGroup[b.id], undefined);
const stalePrivacyAck = acknowledgeGroupPublication(deleteState, b.id, ack, false);
assert.deepEqual(stalePrivacyAck.settings.pendingMetricPrivacyFenceIdsByGroup[b.id], ["steps"], "stale in-flight ACK cannot erase a newer privacy request");
assert.equal(acknowledgeGroupPublication(state, b.id, { deletedEntryIds: [], deletedPhotoIds: [], acknowledgedPrivacyFenceMetricIds: [] }, true), state);

const pendingAdmin = { ...state, group: b, settings: { ...state.settings, pendingGroupConfigurationIds: [a.id] } };
assert.ok(pendingGroupPublications(pendingAdmin, acknowledged, required, digest).some((item) => item.group.id === a.id), "switching to B must not strand an explicit admin edit for A");
const adminAck = { deletedEntryIds: [], deletedPhotoIds: [], acknowledgedPrivacyFenceMetricIds: [], groupConfigurationPushed: true, groupConfigurationRevision: 7 };
const acknowledgedAdmin = acknowledgeGroupPublication(pendingAdmin, a.id, adminAck, true);
assert.equal(acknowledgedAdmin.group, b, "A's admin ACK never navigates back from B");
assert.equal(acknowledgedAdmin.groups.find((g) => g.id === a.id).configurationRevision, 7);
assert.deepEqual(acknowledgedAdmin.settings.pendingGroupConfigurationIds, []);
assert.deepEqual(acknowledgeGroupPublication(pendingAdmin, a.id, adminAck, false).settings.pendingGroupConfigurationIds, [a.id], "a newer edit cannot be ACKed by old configuration");
const repairAck = { deletedEntryIds: [], deletedPhotoIds: [], acknowledgedPrivacyFenceMetricIds: [], projectionRepairEntryIds: [`metric:${id(90)}`] };
const repair = acknowledgeGroupPublication(state, b.id, repairAck, true);
assert.deepEqual(repair.settings.pendingGroupProjectionRepairIdsByGroup[b.id], repairAck.projectionRepairEntryIds);
assert.equal(repair.settings.groupProjectionRepairGeneration, 1);
const snapshotSafeSettings = (current) => {
  const { pendingGroupProjectionRepairIdsByGroup: _repairIds, pendingMetricPrivacyFenceIdsByGroup: _privacyIds, pendingGroupConfigurationIds: _configurationIds, ...safe } = current.settings;
  return safe;
};
assert.notEqual(stableValueHash(snapshotSafeSettings(repair)), stableValueHash(snapshotSafeSettings(state)), "repair advances the ordinary private snapshot even though all device-local outbox IDs are stripped");
const sameSnapshotWithoutAdvance = { ...repair, settings: { ...repair.settings, groupProjectionRepairGeneration: 0 } };
assert.notEqual(stableValueHash(snapshotSafeSettings(repair)), stableValueHash(snapshotSafeSettings(sameSnapshotWithoutAdvance)), "generation alone changes the snapshot, independently of normalized deletion arrays or any local outbox");
assert.ok(!JSON.stringify(snapshotSafeSettings(repair)).includes(id(90)), "the durable commit marker contains no metric/group repair identity");
assert.equal(acknowledgeGroupPublication(repair, b.id, repairAck, true), repair, "identical response does not manufacture another revision");
assert.equal(acknowledgeGroupPublication(state, b.id, repairAck, false), state, "a superseded request cannot queue a repair or advance generation");
assert.equal(repeatedGroupProjectionRepair(repair, b.id, repairAck.projectionRepairEntryIds), true);
assert.equal(repeatedGroupProjectionRepair(repair, b.id, []), false);
assert.equal(repeatedGroupProjectionRepair(repair, a.id, repairAck.projectionRepairEntryIds), false);
assert.ok(pendingGroupPublications(repair, acknowledged, required, groupPublicationDigest).some((item) => item.group.id === b.id));
const repaired = acknowledgeGroupPublication(repair, b.id, { ...repairAck, projectionRepairEntryIds: [] }, true);
assert.equal(repaired.settings.pendingGroupProjectionRepairIdsByGroup[b.id], undefined);
assert.equal(repaired.settings.groupProjectionRepairGeneration, 1, "successful ACK clears local work without inventing a second snapshot revision");
assert.equal(stableValueHash(snapshotSafeSettings(repaired)), stableValueHash(snapshotSafeSettings(repair)));
assert.equal(acknowledgeGroupPublication(repaired, b.id, { ...repairAck, projectionRepairEntryIds: [] }, true), repaired, "successful repair reaches a stable fixed point");
const nextRepair = acknowledgeGroupPublication(repaired, a.id, { ...repairAck, projectionRepairEntryIds: [`metric:${id(91)}`] }, true);
assert.equal(nextRepair.settings.groupProjectionRepairGeneration, 2, "a later independent restriction can request one newer committed revision");
for (const [values, expected] of [
  [[undefined, Number.NaN, -1, 1.5, Infinity, "4"], 0],
  [[1, 7], 7], [[7, 1], 7], [[7, 7], 7], [[Number.MAX_SAFE_INTEGER], Number.MAX_SAFE_INTEGER],
]) assert.equal(mergeGroupProjectionRepairGeneration(...values), expected);
// Two devices may discover the same fence from generation zero. Max merging
// keeps their monotonic marker without doubling retries; a genuinely later
// fence encountered after that merge advances from the shared generation.
const deviceA = acknowledgeGroupPublication(state, a.id, repairAck, true);
const deviceB = acknowledgeGroupPublication(state, b.id, repairAck, true);
const mergedGeneration = mergeGroupProjectionRepairGeneration(deviceA.settings.groupProjectionRepairGeneration, deviceB.settings.groupProjectionRepairGeneration);
assert.equal(mergedGeneration, 1);
const laterDevice = { ...repaired, settings: { ...repaired.settings, groupProjectionRepairGeneration: mergedGeneration } };
assert.equal(acknowledgeGroupPublication(laterDevice, b.id, repairAck, true).settings.groupProjectionRepairGeneration, 2);
assert.throws(() => acknowledgeGroupPublication({ ...state, settings: { ...state.settings, groupProjectionRepairGeneration: Number.MAX_SAFE_INTEGER } }, a.id, repairAck, true), /account recovery/);

let historyIndexReads = 0;
const history = new Proxy(Array.from({ length: 50_000 }, (_, n) => ({
  id: `log-${n}`, userId: "owner", metricId: "steps", value: n, visibility: "group",
})), {
  get(target, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) historyIndexReads++;
    return Reflect.get(target, property, receiver);
  },
});
const large = { ...many, entries: history };
const coldStart = performance.now();
const largeQueue = pendingGroupPublications(large, new Map(), new Set(), groupPublicationDigest);
const coldMs = performance.now() - coldStart;
assert.equal(largeQueue.length, 23);
assert.ok(historyIndexReads <= 100_000, "23 group digests may select/hash the shared 50k history only once");
const coldReads = historyIndexReads;
const warmStart = performance.now();
for (let n = 0; n < 100; n++) pendingGroupPublications(large, new Map(), new Set(), groupPublicationDigest);
const warmMs = performance.now() - warmStart;
assert.equal(historyIndexReads, coldReads, "unchanged scans must not read any historical row");
assert.ok(warmMs < 1000, "100 warm 23-group queue scans must remain bounded");
assert.equal(stateForGroupPublication(large, large.groups[1]), stateForGroupPublication(large, large.groups[1]));
const firstDigest = groupPublicationDigest(stateForGroupPublication(large, large.groups[0]));
const updatedHistory = [...history];
updatedHistory[0] = { ...updatedHistory[0], value: 50_001 };
assert.notEqual(groupPublicationDigest(stateForGroupPublication({ ...large, entries: updatedHistory }, large.groups[0])), firstDigest);
const configuredGroup = { ...large.groups[0], metricConfiguration: [metric("water")] };
assert.notEqual(groupPublicationDigest(stateForGroupPublication(large, configuredGroup)), firstDigest);
assert.notEqual(groupPublicationDigest(stateForGroupPublication({ ...large, metrics: large.metrics.map((item, n) => n === 0 ? { ...item, defaultVisibility: "status" } : item) }, large.groups[0])), firstDigest);
assert.notEqual(groupPublicationDigest(stateForGroupPublication({ ...large, settings: { ...large.settings, pendingMetricPrivacyFenceIdsByGroup: { [large.groups[0].id]: ["steps"] } } }, large.groups[0])), firstDigest);
console.log(`Production digest performance: 23 groups / 50k owner rows cold ${coldMs.toFixed(1)} ms; 100 warm scans ${warmMs.toFixed(1)} ms; ${coldReads} history index reads total, zero warm reads.`);

// Wiring assertions supplement the executable domain tests; SQL behavior is
// exercised separately by validate-group-publication-postgres.mjs.
const provider = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
const cloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const app = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const background = fs.readFileSync("src/health/background.native.ts", "utf8");
assert.match(provider, /pendingActivityPublications\(latestState\)\.length > 0/);
assert.match(provider, /pendingActivityPublications\(live\)\.length > 0/);
assert.match(provider, /activityOnly: true, operationIsCurrent: destinationIsCurrent/);
assert.match(provider, /workspaceHash\(projected\) === destination\.hash/);
assert.match(provider, /Some group updates will retry/);
assert.equal((provider.match(/repeatedGroupProjectionRepair\(/g) ?? []).length, 2, "both active and inactive repeated repair responses enter bounded error/backoff, not a success spin");
assert.equal((provider.match(/mergeGroupProjectionRepairGeneration\(/g) ?? []).length, 2, "both normal merge and device-setting preservation keep the highest generation");
assert.match(provider, /pendingGroupProjectionRepairIdsByGroup: undefined/);
assert.doesNotMatch(provider, /groupProjectionRepairGeneration: undefined/);
const stableHashBody = provider.slice(provider.indexOf("function stableHash(state:"), provider.indexOf("function accountMetadataHash(state:"));
assert.doesNotMatch(stableHashBody, /"groupProjectionRepairGeneration"/, "production snapshot hash must not strip the commit generation as a volatile view preference");
assert.match(provider, /await evictUnavailableGroup\(destination\.group\.id\)/);
assert.match(provider, /const acknowledgedHash = publicationStillCurrent[\s\S]{0,200}: destination\.hash/);
assert.match(cloud, /options\.activityOnly && !groupConfigurationPushed/);
assert.match(provider, /const pendingConfiguration = candidate\.settings\.pendingGroupConfigurationIds\?\.includes\(destination\.group\.id\) === true/);
assert.match(cloud, /client_generated_id: groupProjectionId\(state\.group\.id, entry\.id\)/);
assert.match(cloud, /client_generated_id: groupProjectionId\(state\.group\.id, photo\.id\)/);
assert.match(cloud, /explicitDeletedEntryIdSet\.has\(id\)\s*\? id : groupProjectionId\(state\.group\.id, id\)/, "only deliberate source deletion expands beyond this destination");
assert.match(cloud, /"clear_group_metric_entry_tombstones",[\s\S]{0,180}batch\.map\(\(id\) => groupProjectionId\(state\.group\.id, id\)\)/, "restoring one destination does not prematurely clear another's deletion fence");
assert.match(cloud, /rememberExactStatuses\(fastRecentStatuses\)/);
assert.match(cloud, /rememberExactStatuses\(rows\)/);
assert.match(cloud, /ownedPhotos\.some\(\(photo\) => photo\.visibility === "group"\)/);
assert.match(cloud, /for \(const metricIds of batches\(\[\.\.\.intendedExactMetricIds\], 100\)\)/);
assert.match(cloud, /from\("metric_privacy_cache_fences"\)[\s\S]{0,250}gte\("revision", publishRevision\)/, "post-write metadata check covers a no-op write that returns no row, including photo/status-only projections");
assert.ok(cloud.lastIndexOf('from("metric_privacy_cache_fences")') > cloud.lastIndexOf('from("photo_updates")'), "repair check follows photo writes too");
assert.match(cloud, /if \(isGoogleHealthEntry\(entry\)\) return false/);
assert.match(app, /const privacyGroupIds = cloudPublicationGroups\(state\)/);
assert.match(background, /backgroundGroupPublicationBatch\(nextState, cursor\)/);
assert.match(background, /session\.data\.session\?\.user\.id !== nextState\.currentUserId/);
console.log("Multi-group publication domain validation passed: destination identity, global privacy, independent configuration, dirty/failed ACKs, removal fences, private setup, and bounded background fairness.");
