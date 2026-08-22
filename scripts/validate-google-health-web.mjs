import assert from "node:assert/strict";
import fs from "node:fs";

import {
  GOOGLE_HEALTH_ANDROID_HELP_URL,
  GOOGLE_HEALTH_ANDROID_STORE_URL,
  GOOGLE_HEALTH_IOS_HELP_URL,
  GOOGLE_HEALTH_IOS_STORE_URL,
  googleHealthSetupAcknowledgementKey,
  googleHealthDisclosureAcknowledgementKey,
  googleHealthNormalUseDisclosureKey,
  googleHealthSetupPlatform,
} from "../src/domain/googleHealthSetup.ts";
import {
  isGoogleHealthCompletionToken,
  parseGoogleHealthCompletionFragment,
} from "../src/domain/googleHealthCallback.ts";
import {
  captureGoogleHealthCompletionFromBrowserUrl,
  clearCapturedGoogleHealthCompletion,
} from "../src/health/googleHealthCompletionBrowser.ts";
import {
  createPostgrestPrivacySchemaFetch,
  getPrivacyAwareUserSnapshot,
  getPrivacyAwareUserSnapshotMetadata,
  GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR,
  HABHUB_PRIVACY_SCHEMA_HEADER,
  HABHUB_PRIVACY_SCHEMA_VERSION,
  isGoogleHealthPrivacyUpgradeError,
  privacyAwareSnapshotTopic,
  syncPrivacyAwareUserSnapshot,
} from "../src/cloud/snapshotPrivacy.ts";
import {
  applyGoogleHealthEntryOverrides,
  applyInheritedTrackerVisibility,
  purgeGoogleHealthAccountData,
  purgeGoogleHealthEntryFromMemory,
  rememberGoogleHealthEntryOverrides,
  stateWithoutGoogleHealthLocalData,
  withoutGoogleHealthDerivedStatuses,
  withoutGoogleHealthEntries,
} from "../src/domain/googleHealthLocalPrivacy.ts";

const sampleCompletionToken = "a".repeat(64);
assert.deepEqual(
  parseGoogleHealthCompletionFragment(
    `#google_health=pending&completion=${sampleCompletionToken}`,
  ),
  { present: true, token: sampleCompletionToken },
);
assert.deepEqual(parseGoogleHealthCompletionFragment("#google_health=connected"), {
  present: false,
  token: null,
});
assert.equal(isGoogleHealthCompletionToken(sampleCompletionToken), true);
assert.equal(isGoogleHealthCompletionToken("short"), false);

let replacedCompletionUrl = null;
const capturedCompletion = captureGoogleHealthCompletionFromBrowserUrl({
  history: {
    state: { preserved: true },
    replaceState(_state, _unused, url) {
      replacedCompletionUrl = url;
    },
  },
  location: {
    hash: `#google_health=pending&completion=${sampleCompletionToken}`,
    pathname: "/settings",
    search: "?from=google",
  },
});
assert.deepEqual(capturedCompletion, { present: true, token: sampleCompletionToken });
assert.equal(
  replacedCompletionUrl,
  "/settings?from=google",
  "the root capture must remove the bearer fragment while preserving the route",
);
assert.deepEqual(
  captureGoogleHealthCompletionFromBrowserUrl({
    history: { state: null, replaceState() {} },
    location: { hash: "", pathname: "/settings", search: "" },
  }),
  capturedCompletion,
  "the in-memory completion must survive auth restoration after the URL is clean",
);
clearCapturedGoogleHealthCompletion();

assert.equal(HABHUB_PRIVACY_SCHEMA_VERSION, 27);
assert.equal(HABHUB_PRIVACY_SCHEMA_HEADER, "x-habhub-privacy-schema");
assert.equal(
  privacyAwareSnapshotTopic("owner-a"),
  "account:owner-a:snapshot:v27",
  "current clients must listen on a topic unknown to released schema-26 clients",
);
const privacyFetchCalls = [];
const privacyFetch = createPostgrestPrivacySchemaFetch(
  async (input, init) => {
    const url = typeof input === "string" ? input : input.url ?? input.href;
    const inherited =
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined;
    const headers = new Headers(inherited);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    privacyFetchCalls.push({ url, headers });
    return new Response(null, { status: 204 });
  },
);
await privacyFetch(
  "https://paceboard.supabase.co/rest/v1/metric_entries?select=id",
);
await privacyFetch(
  new Request("https://paceboard.supabase.co/rest/v1/rpc/get_user_snapshot", {
    headers: { authorization: "Bearer fixture" },
  }),
);
for (const url of [
  "https://paceboard.supabase.co/functions/v1/google-health",
  "https://paceboard.supabase.co/auth/v1/token",
  "https://paceboard.supabase.co/storage/v1/object/avatar.png",
  "wss://paceboard.supabase.co/realtime/v1/websocket",
])
  await privacyFetch(url);
assert.deepEqual(
  privacyFetchCalls.map(({ headers }) =>
    headers.get(HABHUB_PRIVACY_SCHEMA_HEADER),
  ),
  ["27", "27", null, null, null, null],
  "the privacy schema header must be scoped to PostgREST table/RPC requests",
);
assert.equal(
  privacyFetchCalls[1].headers.get("authorization"),
  "Bearer fixture",
  "injecting the schema header must preserve request authentication",
);
assert.equal(
  isGoogleHealthPrivacyUpgradeError({
    code: "55000",
    message: GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR,
  }),
  true,
);
const snapshotRpcCalls = [];
const snapshotRpcClient = {
  async rpc(name, args) {
    snapshotRpcCalls.push({ name, args });
    if (name === "get_user_snapshot")
      return {
        data: [{
          payload: { version: 27, marker: "private-owner-snapshot" },
          revision: 8,
          updated_at: "2026-08-21T12:00:00.000Z",
          device_id: "device-a",
          schema_version: 27,
        }],
        error: null,
      };
    if (name === "get_user_snapshot_metadata")
      return {
        data: [{
          revision: 8,
          updated_at: "2026-08-21T12:00:00.000Z",
          device_id: "device-a",
          schema_version: 27,
        }],
        error: null,
      };
    return {
      data: [{ revision: 9, updated_at: "2026-08-21T12:01:00.000Z" }],
      error: null,
    };
  },
};
const privacyAwareSnapshot = await getPrivacyAwareUserSnapshot(snapshotRpcClient);
const privacyAwareMetadata = await getPrivacyAwareUserSnapshotMetadata(
  snapshotRpcClient,
);
const privacyAwareWrite = await syncPrivacyAwareUserSnapshot(
  snapshotRpcClient,
  privacyAwareSnapshot.payload,
  privacyAwareMetadata.revision,
  "device-a",
);
assert.equal(privacyAwareSnapshot.payload.version, 27);
assert.equal(privacyAwareWrite.revision, 9);
assert.deepEqual(
  snapshotRpcCalls.map(({ name }) => name),
  ["get_user_snapshot", "get_user_snapshot_metadata", "sync_user_snapshot"],
);
assert.equal(
  snapshotRpcCalls[0].args.p_client_schema_version,
  27,
  "every payload read must identify the privacy-aware schema",
);
assert.equal(snapshotRpcCalls[1].args.p_client_schema_version, 27);
assert.equal(snapshotRpcCalls[2].args.client_schema_version, 27);
let downgradeReadCalls = 0;
await assert.rejects(
  getPrivacyAwareUserSnapshot({
    async rpc() {
      downgradeReadCalls += 1;
      return {
        data: null,
        error: {
          code: "55000",
          message: GOOGLE_HEALTH_PRIVACY_UPGRADE_ERROR,
        },
      };
    },
  }),
  (error) => isGoogleHealthPrivacyUpgradeError(error),
);
assert.equal(
  downgradeReadCalls,
  1,
  "a privacy upgrade rejection must fail closed without a legacy table retry",
);

assert.equal(
  googleHealthSetupPlatform("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5),
  "android",
);
assert.equal(
  googleHealthSetupPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6)", "iPhone", 5),
  "ios",
);
assert.equal(
  googleHealthSetupPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5),
  "ios",
  "iPad desktop-mode detection must not offer the Android setup",
);
assert.equal(
  googleHealthSetupPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0),
  "desktop",
);
assert.notEqual(
  googleHealthSetupAcknowledgementKey("owner-a"),
  googleHealthSetupAcknowledgementKey("owner-b"),
  "phone readiness must be account scoped",
);
assert.notEqual(
  googleHealthDisclosureAcknowledgementKey("owner-a"),
  googleHealthDisclosureAcknowledgementKey("owner-b"),
  "data-use disclosure consent must be account scoped",
);
assert.notEqual(
  googleHealthNormalUseDisclosureKey("owner-a"),
  googleHealthNormalUseDisclosureKey("owner-b"),
  "the normal-use disclosure dismissal must be account scoped",
);
assert.notEqual(
  googleHealthNormalUseDisclosureKey("owner-a"),
  googleHealthDisclosureAcknowledgementKey("owner-a"),
  "seeing the Today notice must never count as affirmative connection consent",
);

const googleEntry = {
  id: "google-health:steps-row:steps",
  metricId: "steps",
  userId: "owner",
  localDate: "2026-08-21",
  recordedAt: "2026-08-21T10:00:00.000Z",
  visibility: "group",
  source: "imported",
  sourceProvider: "google_health",
  nutrition: { proteinG: 22 },
  value: 5400,
};
const healthConnectEntry = {
  ...googleEntry,
  id: "health-connect-row",
  localDate: "2026-08-20",
  sourceProvider: "health_connect",
};
const appleHealthEntry = {
  ...googleEntry,
  id: "apple-health-row",
  localDate: "2026-08-19",
  sourceProvider: "apple_health",
};
const manualEquivalentEntry = {
  ...googleEntry,
  id: "manual-steps-row",
  source: "manual",
  sourceProvider: undefined,
  value: 54,
};
const cacheEntries = [googleEntry, healthConnectEntry, appleHealthEntry];
assert.deepEqual(
  withoutGoogleHealthEntries(cacheEntries).map((entry) => entry.id),
  ["health-connect-row", "apple-health-row"],
  "Google raw/nutrition rows must be absent while native health rows stay cacheable",
);
assert.deepEqual(
  withoutGoogleHealthEntries([
    googleEntry,
    healthConnectEntry,
    appleHealthEntry,
    manualEquivalentEntry,
  ]).map((entry) => entry.id),
  ["health-connect-row", "apple-health-row", "manual-steps-row"],
  "Google sanitization must preserve native and manual equivalents for the same tracker",
);
const cacheStatuses = [
  {
    groupId: "group",
    metricId: "mood",
    userId: "owner",
    localDate: "2026-08-21",
    goalReached: true,
    scoreContribution: 100,
  },
  {
    groupId: "group",
    metricId: "steps",
    userId: "owner",
    localDate: "2026-08-21",
    goalReached: true,
    scoreContribution: 100,
    exactValue: 5400,
  },
  {
    groupId: "group",
    metricId: "steps",
    userId: "peer",
    localDate: "2026-08-18",
    goalReached: true,
    scoreContribution: 100,
    sourceProvider: "google_health",
  },
  {
    groupId: "group",
    metricId: "steps",
    userId: "owner",
    localDate: "2026-08-20",
    goalReached: false,
    scoreContribution: 40,
    sourceProvider: "health_connect",
  },
];
assert.deepEqual(
  withoutGoogleHealthDerivedStatuses(cacheEntries, cacheStatuses).map(
    (status) => `${status.userId}:${status.metricId}:${status.localDate}`,
  ),
  ["owner:mood:2026-08-21", "owner:steps:2026-08-20"],
  "Google projections stay memory-only without dropping unrelated statuses from the same day",
);
const editedGoogleEntry = {
  ...googleEntry,
  localDate: "2026-08-20",
  recordedAt: "2026-08-20T18:30:00.000Z",
  recordedAtOverride: "2026-08-20T18:30:00.000Z",
  visibility: "status",
  sourceUpdatedAt: "2026-08-21T12:00:00.000Z",
};
const googleHealthEntryOverrides = rememberGoogleHealthEntryOverrides(
  undefined,
  [editedGoogleEntry],
);
assert.deepEqual(Object.keys(googleHealthEntryOverrides ?? {}), [googleEntry.id]);
assert.ok(!("value" in googleHealthEntryOverrides[googleEntry.id]));
assert.ok(!("nutrition" in googleHealthEntryOverrides[googleEntry.id]));
assert.ok(
  !("visibility" in googleHealthEntryOverrides[googleEntry.id]),
  "editing time must not freeze an inherited tracker visibility as an explicit entry preference",
);
const sensitiveSettings = {
  pendingDeletedEntryIds: [googleEntry.id, healthConnectEntry.id],
  deletedEntryIds: [googleEntry.id],
  dismissedHealthEntryIds: [googleEntry.id],
  googleHealthEntryOverrides,
};
const localProjection = stateWithoutGoogleHealthLocalData({
  entries: cacheEntries,
  dailyMetricStatuses: cacheStatuses,
  settings: sensitiveSettings,
});
const serializedLocalProjection = JSON.stringify(localProjection);
assert.deepEqual(
  localProjection.entries.map((entry) => entry.id),
  ["health-connect-row", "apple-health-row"],
);
assert.deepEqual(
  localProjection.dailyMetricStatuses.map(
    (status) => `${status.userId}:${status.metricId}:${status.localDate}`,
  ),
  ["owner:mood:2026-08-21", "owner:steps:2026-08-20"],
);
assert.deepEqual(localProjection.settings.pendingDeletedEntryIds, [
  healthConnectEntry.id,
]);
assert.deepEqual(localProjection.settings.deletedEntryIds, []);
assert.deepEqual(localProjection.settings.dismissedHealthEntryIds, []);
assert.equal(localProjection.settings.googleHealthEntryOverrides, undefined);
assert.ok(!serializedLocalProjection.includes('"google_health"'));
assert.ok(!serializedLocalProjection.includes(googleEntry.id));
assert.ok(!serializedLocalProjection.includes("googleHealthEntryOverrides"));
assert.ok(!serializedLocalProjection.includes("2026-08-20T18:30:00.000Z"));
assert.ok(serializedLocalProjection.includes("health_connect"));
assert.ok(serializedLocalProjection.includes("apple_health"));
const [replayedGoogleEntry] = applyGoogleHealthEntryOverrides(
  [googleEntry],
  googleHealthEntryOverrides,
  "owner",
);
assert.equal(replayedGoogleEntry.value, 5400);
assert.equal(replayedGoogleEntry.recordedAt, "2026-08-20T18:30:00.000Z");
assert.equal(replayedGoogleEntry.recordedAtOverride, "2026-08-20T18:30:00.000Z");
assert.equal(replayedGoogleEntry.localDate, "2026-08-20");
assert.equal(replayedGoogleEntry.visibility, "group");
const [coldReconnectVisibility] = applyGoogleHealthEntryOverrides(
  [googleEntry],
  undefined,
  "owner",
  [{ id: "steps", defaultVisibility: "private" }],
);
assert.equal(
  coldReconnectVisibility.visibility,
  "private",
  "a cold-offline tracker visibility edit must normalize a cloud-only Google row on reconnect",
);
const [explicitVisibilityWins] = applyGoogleHealthEntryOverrides(
  [googleEntry],
  {
    ...googleHealthEntryOverrides,
    [googleEntry.id]: {
      ...googleHealthEntryOverrides[googleEntry.id],
      visibility: "status",
    },
  },
  "owner",
  [{ id: "steps", defaultVisibility: "private" }],
);
assert.equal(
  explicitVisibilityWins.visibility,
  "status",
  "an explicit server-side entry preference must win over the inherited tracker default",
);

const inheritedGoogleFood = {
  ...googleEntry,
  id: "google-health:inherited-lunch:food",
  metricId: "food",
  value: 550,
  visibility: "group",
  localDate: "2026-08-20",
  recordedAt: "2026-08-20T12:00:00.000Z",
  sourceUpdatedAt: "2026-08-21T10:00:00.000Z",
};
const timeEditedInheritedFood = {
  ...inheritedGoogleFood,
  recordedAt: "2026-08-20T12:30:00.000Z",
  recordedAtOverride: "2026-08-20T12:30:00.000Z",
  sourceUpdatedAt: "2026-08-21T11:00:00.000Z",
};
const timeOnlyFoodPreference = rememberGoogleHealthEntryOverrides(
  undefined,
  [timeEditedInheritedFood],
);
assert.equal(
  timeOnlyFoodPreference[inheritedGoogleFood.id].visibility,
  undefined,
  "an inherited group food row must remain inherited after a time edit ACK",
);
const [foodAfterPullAndRestart] = applyGoogleHealthEntryOverrides(
  [inheritedGoogleFood],
  timeOnlyFoodPreference,
  "owner",
  [{ id: "food", defaultVisibility: "group" }],
);
assert.equal(foodAfterPullAndRestart.recordedAt, "2026-08-20T12:30:00.000Z");
const foodAfterTrackerPrivate = applyInheritedTrackerVisibility(
  foodAfterPullAndRestart,
  timeOnlyFoodPreference,
  "private",
  "2026-08-21T12:00:00.000Z",
);
const [foodAfterPrivateRestart] = applyGoogleHealthEntryOverrides(
  [foodAfterTrackerPrivate],
  timeOnlyFoodPreference,
  "owner",
  [{ id: "food", defaultVisibility: "private" }],
);
assert.equal(
  foodAfterPrivateRestart.visibility,
  "private",
  "inherited group food -> time edit -> pull/restart -> tracker private must stay private",
);
const explicitFoodPreference = rememberGoogleHealthEntryOverrides(
  {
    [inheritedGoogleFood.id]: {
      visibility: "status",
      sourceUpdatedAt: "2026-08-21T10:30:00.000Z",
    },
  },
  [{ ...timeEditedInheritedFood, visibility: "group" }],
);
assert.equal(
  explicitFoodPreference[inheritedGoogleFood.id].visibility,
  "status",
  "a time edit must preserve an already-explicit server visibility without copying the row value",
);
const [explicitFoodAfterPrivateDefault] = applyGoogleHealthEntryOverrides(
  [inheritedGoogleFood],
  explicitFoodPreference,
  "owner",
  [{ id: "food", defaultVisibility: "private" }],
);
assert.equal(
  explicitFoodAfterPrivateDefault.visibility,
  "status",
  "an explicit per-entry visibility remains authoritative through time edit and default changes",
);
const explicitPrivateGoogleEntry = {
  ...googleEntry,
  id: "google-health:explicit-private:steps",
  visibility: "private",
};
const inheritedGoogleEntry = {
  ...googleEntry,
  id: "google-health:inherited:steps",
  visibility: "status",
};
const explicitPrivatePreference = {
  [explicitPrivateGoogleEntry.id]: {
    visibility: "private",
    sourceUpdatedAt: "2026-08-21T13:00:00.000Z",
  },
};
const defaultChangedAt = "2026-08-21T14:00:00.000Z";
assert.equal(
  applyInheritedTrackerVisibility(
    explicitPrivateGoogleEntry,
    explicitPrivatePreference,
    "group",
    defaultChangedAt,
  ),
  explicitPrivateGoogleEntry,
  "a tracker editor save must not overwrite an explicit private Google row",
);
const inheritedAfterDefaultChange = applyInheritedTrackerVisibility(
  inheritedGoogleEntry,
  explicitPrivatePreference,
  "group",
  defaultChangedAt,
);
assert.equal(inheritedAfterDefaultChange.visibility, "group");
assert.equal(inheritedAfterDefaultChange.sourceUpdatedAt, defaultChangedAt);
const visibilityAfterRestart = applyGoogleHealthEntryOverrides(
  [explicitPrivateGoogleEntry, inheritedAfterDefaultChange],
  explicitPrivatePreference,
  "owner",
  [{ id: "steps", defaultVisibility: "group" }],
);
assert.deepEqual(
  visibilityAfterRestart.map((entry) => entry.visibility),
  ["private", "group"],
  "explicit and inherited Google visibility must survive restart/reconciliation with different authority",
);

const peerGoogleEntry = {
  ...googleEntry,
  id: "google-health:peer-row:steps",
  userId: "peer",
};
const purgedAfterAuthoritativeDelete = purgeGoogleHealthAccountData(
  {
    currentUserId: "owner",
    entries: [...cacheEntries, peerGoogleEntry],
    dailyMetricStatuses: cacheStatuses,
    settings: sensitiveSettings,
  },
  "owner",
);
assert.deepEqual(
  purgedAfterAuthoritativeDelete.entries.map((entry) => entry.id),
  ["health-connect-row", "apple-health-row", peerGoogleEntry.id],
  "an authoritative delete must immediately remove only the signed-in account's Google rows",
);
assert.deepEqual(
  purgedAfterAuthoritativeDelete.dailyMetricStatuses.map(
    (status) => `${status.userId}:${status.metricId}:${status.localDate}`,
  ),
  [
    "owner:mood:2026-08-21",
    "peer:steps:2026-08-18",
    "owner:steps:2026-08-20",
  ],
  "an authoritative delete must remove owner projections without erasing peer in-memory activity",
);
assert.deepEqual(
  purgedAfterAuthoritativeDelete.settings.pendingDeletedEntryIds,
  [healthConnectEntry.id],
  "authoritative deletion clears Google intent ids only after the server succeeds",
);
assert.deepEqual(purgedAfterAuthoritativeDelete.settings.deletedEntryIds, []);
assert.deepEqual(
  purgedAfterAuthoritativeDelete.settings.dismissedHealthEntryIds,
  [],
);
assert.equal(
  purgedAfterAuthoritativeDelete.settings.googleHealthEntryOverrides,
  undefined,
);
const singleDismissed = purgeGoogleHealthEntryFromMemory(
  {
    currentUserId: "owner",
    entries: cacheEntries,
    dailyMetricStatuses: cacheStatuses,
    settings: sensitiveSettings,
  },
  googleEntry.id,
);
assert.deepEqual(
  singleDismissed.entries.map((entry) => entry.id),
  ["health-connect-row", "apple-health-row"],
  "a server-confirmed dismissal must remove the Google row immediately",
);
assert.ok(!singleDismissed.settings.pendingDeletedEntryIds.includes(googleEntry.id));
assert.ok(!singleDismissed.settings.dismissedHealthEntryIds?.includes(googleEntry.id));
const coexistenceAfterGoogleDelete = purgeGoogleHealthAccountData(
  {
    currentUserId: "owner",
    entries: [
      googleEntry,
      healthConnectEntry,
      appleHealthEntry,
      manualEquivalentEntry,
    ],
    dailyMetricStatuses: [],
    settings: {},
  },
  "owner",
);
assert.deepEqual(
  coexistenceAfterGoogleDelete.entries.map((entry) => entry.id),
  ["health-connect-row", "apple-health-row", "manual-steps-row"],
  "deleting Google imports must not remove Health Connect, Apple Health, or manual equivalents",
);

const allowedDestinations = [
  [GOOGLE_HEALTH_ANDROID_STORE_URL, "play.google.com", "com.fitbit.FitbitMobile"],
  [GOOGLE_HEALTH_IOS_STORE_URL, "apps.apple.com", "id462638897"],
  [GOOGLE_HEALTH_ANDROID_HELP_URL, "support.google.com", "/googlehealth/"],
  [GOOGLE_HEALTH_IOS_HELP_URL, "support.google.com", "/googlehealth/"],
];
for (const [rawUrl, hostname, requiredText] of allowedDestinations) {
  const url = new URL(rawUrl);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, hostname);
  assert.ok(rawUrl.includes(requiredText));
}

const client = fs.readFileSync("src/health/googleHealthWeb.ts", "utf8");
const card = fs.readFileSync("src/components/GoogleHealthWebCard.tsx", "utf8");
const todayDisclosure = fs.readFileSync(
  "src/components/GoogleHealthTodayDisclosure.tsx",
  "utf8",
);
const completionBrowser = fs.readFileSync(
  "src/health/googleHealthCompletionBrowser.ts",
  "utf8",
);
const settings = fs.readFileSync("app/settings.tsx", "utf8");
const signIn = fs.readFileSync("app/sign-in.tsx", "utf8");
const layout = fs.readFileSync("app/_layout.tsx", "utf8");
const privacy = fs.readFileSync("app/privacy.tsx", "utf8");
const appProvider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const cloudProvider = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
const groupCloud = fs.readFileSync("src/cloud/groupCloud.ts", "utf8");
const groupCache = fs.readFileSync("src/storage/groupActivityCache.shared.ts", "utf8");
const groupCacheTypes = fs.readFileSync("src/storage/groupActivityCache.types.ts", "utf8");
const groupCacheAsync = fs.readFileSync(
  "src/storage/groupActivityCache.asyncStorage.ts",
  "utf8",
);
const groupCacheNative = fs.readFileSync(
  "src/storage/groupActivityCache.native.ts",
  "utf8",
);
const localPersistence = fs.readFileSync(
  "src/domain/localPersistence.ts",
  "utf8",
);
const widgetBridge = fs.readFileSync(
  "src/widgets/WidgetSnapshotBridge.tsx",
  "utf8",
);
const notifications = fs.readFileSync("src/notifications/push.ts", "utf8");
const today = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
const metricDetail = fs.readFileSync("app/metric-detail.tsx", "utf8");
const metricEditor = fs.readFileSync("app/metric-editor.tsx", "utf8");
const googleHttp = fs.readFileSync(
  "supabase/functions/_shared/google-health-http.ts",
  "utf8",
);
const serviceWorker = fs.readFileSync("public/habhub-sw.js", "utf8");
const supabaseClient = fs.readFileSync("src/lib/supabase.ts", "utf8");
const snapshotPrivacy = fs.readFileSync("src/cloud/snapshotPrivacy.ts", "utf8");
const stateTypes = fs.readFileSync("src/types.ts", "utf8");
const seed = fs.readFileSync("src/data/seed.ts", "utf8");

for (const action of [
  "status",
  "connect",
  "complete",
  "sync",
  "disconnect",
  "delete",
  "updateEntry",
  "dismissEntry",
  "updateMetricVisibility",
]) {
  assert.ok(client.includes(`"${action}"`), `typed client must support ${action}`);
}
assert.match(client, /supabase\.functions\.invoke\(\r?\n\s+"google-health"/);
assert.ok(client.includes('parsed.hostname !== "accounts.google.com"'));
assert.ok(client.includes("completionToken"));
assert.ok(client.includes("isGoogleHealthCompletionToken"));
assert.ok(client.includes("parseGoogleHealthSyncErrors"));
assert.ok(client.includes("errors: parseGoogleHealthSyncErrors(sync.errors)"));
assert.ok(client.includes("!/^[a-z0-9_-]+$/i.test(dataType)"));
assert.ok(client.includes("!/^[a-z0-9_-]+$/i.test(code)"));
assert.ok(!/CLIENT_SECRET|GOOGLE_HEALTH_SECRET|EXPO_PUBLIC_GOOGLE/i.test(client));

const stepOne = card.indexOf("Install or open Google Health");
const stepTwo = card.indexOf("Connect your Google account");
assert.ok(stepOne >= 0 && stepTwo > stepOne, "the phone bridge must precede OAuth");
assert.ok(card.includes('accessibilityRole="checkbox"'));
assert.ok(card.includes('accessibilityRole="link"'));
assert.ok(card.includes('accessibilityLiveRegion="polite"'));
assert.ok(card.includes("event.origin !== window.location.origin"));
assert.ok(card.includes("event.source !== popupRef.current"));
assert.ok(card.includes("popupRef.current.close()"));
assert.ok(card.includes("HabHub cannot detect app installation from a browser"));
assert.ok(card.includes("Google Health requires Android 11 or newer"));
assert.ok(card.includes("Pilot limited to 100 Google accounts"));
assert.ok(card.includes("managed Workspace or Advanced Protection accounts"));
assert.ok(card.includes("contact support if access is denied"));
assert.ok(!card.includes("any Google account can connect"));
assert.ok(!card.includes("test user"));
assert.ok(!card.includes("adult Google account"));
assert.ok(card.includes("same Google Account as in the Google Health phone app"));
assert.ok(card.includes("supervised or managed accounts"));
assert.ok(card.includes("First sync imports up to 90 days"));
assert.ok(card.includes("heart-rate averages up to 14 days"));
assert.ok(!card.includes("allowlist"));
assert.ok(!card.includes("7 days"));
assert.ok(card.includes("When pilot webhooks are configured"));
assert.ok(card.includes("data reached HabHub cloud"));
assert.ok(card.includes("const partial = result.errors.length > 0"));
assert.ok(card.includes("one or more categories could not refresh"));
assert.ok(card.includes("try Sync now again later"));
assert.ok(!card.includes("result.errors.map"));
assert.ok(
  card.indexOf("await cloud.pullLatest();") <
    card.indexOf('"Google Health sync finished."'),
);
assert.ok(card.includes('"access_denied"'));
assert.ok(card.includes("HabHub collects the activity and fitness"));
assert.ok(card.includes("Google Health imports follow each tracker's current configured visibility"));
assert.ok(card.includes("Group, status, or leaderboard sharing"));
assert.ok(card.includes("You can change it in the tracker's settings"));
assert.ok(!card.includes("entry visibility choices"));
assert.ok(!card.includes('label="Update access"'));
assert.ok(card.indexOf("await purgeGoogleHealthData()") < card.indexOf(
  'setNotice("Google Health was disconnected and its imported HabHub entries were deleted.")',
));
assert.ok(card.includes("googleHealthDisclosureAcknowledgementKey"));
assert.ok(card.includes("window.localStorage.setItem"));
assert.ok(card.includes("window.location.assign(authorizationUrl)"));
assert.ok(card.includes("window.opener.postMessage"));
assert.ok(completionBrowser.includes("parseGoogleHealthCompletionFragment"));
assert.ok(completionBrowser.includes("browser.history.replaceState"));
assert.ok(
  card.indexOf("captureGoogleHealthCompletionFromBrowserUrl()") <
    card.indexOf("if (!hasLiveSession || !accountId) return;"),
  "the isolated-card fallback must capture before its session guard",
);
assert.ok(
  layout.indexOf("captureGoogleHealthCompletionFromBrowserUrl();") <
    layout.indexOf("export default function RootLayout()"),
  "OAuth completion tokens must leave the URL before RootLayout creates AuthProvider",
);
assert.ok(
  layout.indexOf("captureGoogleHealthCompletionFromBrowserUrl();") <
    layout.indexOf("if (auth.status === \"loading\"") &&
    layout.indexOf("captureGoogleHealthCompletionFromBrowserUrl();") <
      layout.indexOf("return <Redirect"),
  "OAuth completion capture must precede loading and signed-out route guards",
);
assert.ok(card.includes('invokeGoogleHealth("complete"'));
assert.ok(card.includes('{ type: oauthMessageType, outcome: "connected" }'));
assert.ok(
  settings.includes("isWebHealthBridge ? <GoogleHealthWebCard /> : <Card>"),
  "the web card must not replace native health settings",
);
assert.ok(card.includes('router.push("/privacy"'));
assert.ok(signIn.includes('router.push("/privacy"'));
assert.ok(layout.includes('rootSegment === "privacy"'));
assert.ok(layout.includes('<Stack.Screen name="privacy"'));
assert.ok(appProvider.includes("stateWithoutGoogleHealthLocalData"));
assert.ok(appProvider.includes("scrubLegacyGoogleHealthAppSnapshots"));
assert.ok(appProvider.includes("GOOGLE_HEALTH_CACHE_SCRUB_KEY"));
assert.ok(appProvider.includes("rememberGoogleHealthEntryOverrides"));
assert.ok(appProvider.includes("applyInheritedTrackerVisibility"));
assert.ok(appProvider.includes('commitReducedState(next, true, "local")'));
assert.ok(appProvider.includes("purgeGoogleHealthEntryFromMemory"));
assert.ok(appProvider.includes("reconcileGoogleHealthNativeMirrors"));
const updateMetricReducer = appProvider.slice(
  appProvider.indexOf('case "updateMetric"'),
  appProvider.indexOf('case "deleteMetric"'),
);
assert.ok(
  !updateMetricReducer.includes("rememberGoogleHealthEntryOverrides"),
  "tracker defaults must not become permanent per-entry Google preferences",
);
assert.ok(cloudProvider.includes('habhub-cloud-merge-base-v4:'));
assert.ok(cloudProvider.includes("mergeBaseForLocalPersistence"));
assert.ok(cloudProvider.includes("mergeEntriesFromBase"));
assert.ok(cloudProvider.includes("isGoogleHealthEntryId"));
assert.ok(cloudProvider.includes("applyGoogleHealthEntryOverrides"));
assert.ok(
  /settings\.googleHealthEntryOverrides =\r?\n\s+remote\.settings\.googleHealthEntryOverrides/.test(
    cloudProvider,
  ),
  "the protected remote registry must be authoritative on pull",
);
assert.ok(cloudProvider.includes("reconcileGoogleHealthNativeMirrors"));
assert.ok(
  cloudProvider.includes(".channel(privacyAwareSnapshotTopic(auth.user.id)"),
  "schema-27 clients must receive compact snapshot invalidations on the privacy topic",
);
assert.ok(
  !cloudProvider.includes(".channel(`account:${auth.user.id}:snapshot`"),
  "schema-27 clients must not subscribe to the metadata-leaking legacy topic",
);
const privacyBroadcastEffect = cloudProvider.slice(
  cloudProvider.indexOf("const handleInvalidation = (next:"),
  cloudProvider.indexOf("membership-approval:", cloudProvider.indexOf("const handleInvalidation = (next:")),
);
assert.ok(privacyBroadcastEffect.includes("payload?: { revision?: number }"));
assert.ok(!privacyBroadcastEffect.includes("device_id?: string"));
assert.ok(
  privacyBroadcastEffect.includes(
    "expectedRevision === snapshotWriteTargetRevisionRef.current",
  ),
  "revision-only self invalidations must not race the active optimistic write",
);
assert.ok(cloudProvider.includes("purgeLegacyGroupActivityCaches"));
assert.ok(cloudProvider.includes("purgeLegacyGoogleHealthCloudCaches"));
assert.ok(cloudProvider.includes("workspaceAckMayPersist"));
assert.ok(groupCache.includes("withoutGoogleHealthEntries"));
assert.ok(groupCache.includes("withoutGoogleHealthDerivedStatuses"));
assert.ok(groupCacheTypes.includes("GROUP_ACTIVITY_CACHE_SCHEMA_VERSION = 3"));
assert.ok(groupCacheAsync.includes("purgeLegacyGroupActivityCaches"));
assert.ok(
  groupCacheAsync.includes("if (sanitized !== raw)"),
  "browser/AsyncStorage cache reads must rewrite defense-in-depth sanitized payloads at rest",
);
assert.ok(
  groupCacheAsync.includes("if (current === raw)"),
  "browser/AsyncStorage rewrites must not clobber a newer group snapshot",
);
assert.ok(groupCacheNative.includes("GROUP_ACTIVITY_CACHE_SCHEMA_VERSION"));
assert.ok(
  groupCacheNative.includes("SELECT group_id, payload FROM group_activity_cache"),
  "Android cache cleanup must inspect current-schema SQLite payloads, not just legacy versions",
);
assert.ok(
  groupCacheNative.includes("if (sanitized !== row.payload)"),
  "Android cache reads must rewrite defense-in-depth sanitized payloads at rest",
);
assert.ok(
  groupCacheNative.includes("SET schema_version = ?, remote_version = ?, updated_at = ?, payload = ?"),
  "Android cache cleanup must replace a sensitive same-schema payload on disk",
);
assert.ok(localPersistence.includes("stateWithoutGoogleHealthLocalData"));
assert.ok(widgetBridge.includes("stateWithoutGoogleHealthLocalData"));
assert.ok(notifications.includes("stateWithoutGoogleHealthLocalData"));
assert.ok(notifications.includes("habhub-goal-reminder-cleanup-v3"));
assert.ok(
  notifications.includes(
    "drainGoalNotifications(stateWithoutGoogleHealthLocalData(state))",
  ),
);
assert.ok(today.includes("googleHealthTodayMemoryOnly"));
assert.ok(today.includes("<GoogleHealthTodayDisclosure"));
assert.ok(today.includes("Boolean(tutorial.activeSession)"));
assert.ok(todayDisclosure.includes('Platform.OS !== "web"'));
assert.ok(todayDisclosure.includes('auth.status !== "signedIn"'));
assert.ok(todayDisclosure.includes("googleHealthNormalUseDisclosureKey(accountId)"));
assert.ok(todayDisclosure.includes("window.localStorage.getItem"));
assert.ok(todayDisclosure.includes("window.localStorage.setItem"));
assert.ok(todayDisclosure.includes("Apple Health or Health Connect directly"));
assert.ok(todayDisclosure.includes("activity and fitness, health measurement, nutrition, and sleep"));
assert.ok(todayDisclosure.includes("populate your trackers, dashboards, and goals"));
assert.ok(todayDisclosure.includes("Group, status, or leaderboard sharing"));
assert.ok(todayDisclosure.includes("Google Health Limited Use requirements"));
assert.ok(todayDisclosure.includes('router.push("/settings"'));
assert.ok(todayDisclosure.includes('router.push("/privacy"'));
assert.ok(!todayDisclosure.includes("invokeGoogleHealth"));
for (const localizedKey of [
  "Google Health for web",
  "Review before connecting",
  "The HabHub web app cannot read Apple Health or Health Connect directly.",
  "HabHub collects the activity and fitness",
  "Google Health imports follow each tracker's current configured visibility",
  "HabHub's use follows Google Health Limited Use requirements.",
  "Review Google Health setup",
  "Privacy & Limited Use",
]) {
  const escaped = localizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    todayDisclosure,
    new RegExp(`t\\([\\s\\S]{0,40}${escaped}`),
    `the normal-use disclosure must localize: ${localizedKey}`,
  );
}
assert.ok(todayDisclosure.includes('accessibilityRole="summary"'));
assert.ok(todayDisclosure.includes('accessibilityLiveRegion="polite"'));
assert.ok(todayDisclosure.includes('accessibilityRole="button"'));
assert.ok(todayDisclosure.includes('accessibilityRole="link"'));
assert.ok(todayDisclosure.includes('t("Dismiss Google Health information")'));
assert.ok(metricDetail.includes('invokeGoogleHealth("updateEntry"'));
assert.ok(metricDetail.includes('invokeGoogleHealth("dismissEntry"'));
assert.ok(metricDetail.includes("must be confirmed by HabHub cloud"));
assert.ok(metricEditor.includes('invokeGoogleHealth("updateMetricVisibility"'));
assert.ok(metricEditor.includes("cold-offline change is applied when cloud sync reconnects"));
assert.ok(groupCloud.includes("const googleHealthProjectionAffected"));
assert.ok(groupCloud.includes("source_provider: googleHealthProjectionAffected"));
assert.ok(googleHttp.includes('"cache-control": "no-store, private"'));
assert.ok(supabaseClient.includes("cache: 'no-store'"));
assert.ok(supabaseClient.includes("createPostgrestPrivacySchemaFetch"));
assert.ok(supabaseClient.includes("fetch: boundedSupabaseFetch"));
assert.ok(!supabaseClient.includes("HABHUB_PRIVACY_SCHEMA_HEADER"));
assert.ok(!supabaseClient.includes("HABHUB_PRIVACY_SCHEMA_VERSION"));
assert.ok(snapshotPrivacy.includes('pathname.startsWith("/rest/v1/")'));
assert.ok(snapshotPrivacy.includes("new Headers(requestHeaders)"));
assert.ok(snapshotPrivacy.includes('client.rpc("get_user_snapshot"'));
assert.ok(snapshotPrivacy.includes('client.rpc("get_user_snapshot_metadata"'));
assert.ok(snapshotPrivacy.includes('client.rpc("sync_user_snapshot"'));
assert.ok(snapshotPrivacy.includes("p_client_schema_version: HABHUB_PRIVACY_SCHEMA_VERSION"));
assert.ok(snapshotPrivacy.includes("client_schema_version: HABHUB_PRIVACY_SCHEMA_VERSION"));
assert.ok(!cloudProvider.includes('.from("user_snapshots")'));
assert.ok(!groupCloud.includes('.from("user_snapshots")'));
assert.ok(!supabaseClient.includes(".from('user_snapshots')"));
assert.ok(stateTypes.includes("version: 27"));
assert.ok(seed.includes("version: 27"));
assert.ok(!serviceWorker.includes('addEventListener("fetch"'));
assert.ok(!serviceWorker.includes("caches.open"));
assert.ok(privacy.includes("activity and fitness, health measurements, nutrition, and sleep"));
assert.ok(privacy.includes("follow the current configured visibility"));
assert.ok(privacy.includes("operated by Ahmad Adayeh"));
assert.ok(privacy.includes("mailto:ahmad.adayeh@gmail.com"));
assert.ok(privacy.includes("cold offline launch cannot display Google Health imports"));
assert.ok(privacy.includes("change that visibility in the tracker&apos;s settings"));
assert.ok(privacy.includes("group views, including leaderboards"));
assert.ok(!privacy.includes("entry-level visibility choice"));
assert.ok(privacy.includes("provider-linked entry identifiers"));
assert.ok(privacy.includes("locally scheduled goal-notification projections"));
assert.ok(privacy.includes("requires an online, authenticated server confirmation"));
assert.ok(!privacy.includes("opaque deletion and dismissal identifiers"));
assert.ok(privacy.includes("Disconnect Google Health stops future access"));
assert.ok(privacy.includes("Delete imported data stops access"));
assert.ok(privacy.includes("account-detached encrypted revocation job is queued and retried"));
assert.ok(privacy.includes("removes active Google access first"));
assert.ok(privacy.includes("reports failure so the remaining work can be retried"));
assert.ok(!privacy.includes("atomically removes HabHub&apos;s active Google credential"));
assert.match(
  privacy,
  /EXPO_PUBLIC_SUPPORT_URL[\s\S]{0,160}"mailto:ahmad\.adayeh@gmail\.com"/,
  "the published policy must keep a visible mailto support fallback",
);
assert.ok(privacy.includes('<ExternalLink label="Contact HabHub support"'));
assert.ok(privacy.includes("does not sell health data"));
assert.ok(privacy.includes("Google Health API Developer and User Data Policy"));
assert.ok(privacy.includes("including the Limited Use requirements."));
assert.ok(privacy.includes(`${"https://developers.google.com/health/policies/health-api-developer-user-data-policy"}`));
assert.ok(privacy.includes("#limited-use"));

console.log("Google Health web setup validation passed.");
