import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  migration,
  edge,
  cloud,
  appProvider,
  healthProvider,
  backgroundHealth,
  settings,
  layout,
  menu,
  legal,
] =
  await Promise.all([
    read("supabase/migrations/202609080004_reset_account_private_data.sql"),
    read("supabase/functions/reset-account-data/index.ts"),
    read("src/cloud/CloudSyncProvider.tsx"),
    read("src/state/AppProvider.tsx"),
    read("src/health/HealthSyncProvider.tsx"),
    read("src/health/background.native.ts"),
    read("app/settings.tsx"),
    read("app/_layout.tsx"),
    read("app/menu.tsx"),
    read("app/legal-support.tsx"),
  ]);

const trigger = migration.match(
  /create or replace function public\.habhub_reject_guarded_snapshot_reference\(\)[\s\S]*?\$\$;/,
)?.[0];
assert.ok(trigger, "the guarded snapshot trigger must be replaced");
assert.doesNotMatch(
  trigger,
  /if\s+\(select auth\.role\(\)\)\s+is not distinct from 'service_role'\s+then\s+return new/i,
  "service_role must never receive a broad deletion-guard bypass",
);
assert.match(trigger, /habhub\.account_reset_user_id/);
assert.match(trigger, /habhub\.account_reset_attempt_id/);
assert.match(trigger, /guard\.user_id = new\.user_id/);
assert.match(trigger, /guard\.attempt_id::text = v_reset_attempt_id/);
assert.match(trigger, /guard\.lease_until > now\(\)/);
assert.match(trigger, /habhub_account_reset_stale[\s\S]*errcode = '40001'/);
assert.ok(
  trigger.indexOf("habhub_account_reset_stale") <
    trigger.indexOf("v_reset_user_id = new.user_id::text"),
  "the stale-reset fence must execute before the narrow reset exemption",
);

assert.match(migration, /reset_account_private_data\(/);
assert.match(migration, /auth\.role\(\)[\s\S]*service_role_required/);
assert.match(
  migration,
  /set_config\([\s\S]*habhub\.account_reset_user_id[\s\S]*p_user_id::text[\s\S]*true/,
);
assert.match(
  migration,
  /set_config\([\s\S]*habhub\.account_reset_attempt_id[\s\S]*p_attempt_id::text[\s\S]*true/,
);
assert.match(
  migration,
  /entry\.visibility = 'private'[\s\S]*entry\.source = 'imported'[\s\S]*entry\.source_provider is not null/,
);
const socialCommentCleanup = migration.match(
  /delete from public\.group_social_comments comment[\s\S]*?delete from public\.metric_entries entry/,
)?.[0];
assert.ok(socialCommentCleanup, "social comments must be cleared before private entries");
assert.match(socialCommentCleanup, /entry\.source = 'imported'/);
assert.match(migration, /photo\.visibility = 'private'/);
assert.match(migration, /delete from public\.health_connections/);
assert.match(migration, /delete from public\.health_sync_cursors/);
assert.match(migration, /delete from public\.device_push_tokens/);
assert.match(migration, /delete from public\.account_devices/);
assert.match(
  migration,
  /delete from public\.group_challenge_notification_state state[\s\S]*state\.recipient_id = p_user_id/,
);
assert.match(
  migration,
  /delete from public\.push_dispatch_events event[\s\S]*event\.recipient_id = p_user_id/,
);
assert.match(
  migration,
  /delete from public\.badge_showcases showcase[\s\S]*showcase\.user_id = p_user_id/,
);
for (const projectionTable of [
  "public_challenge_totals",
  "public_challenge_participant_syncs",
  "public_challenge_occurrence_syncs",
]) {
  assert.match(
    migration,
    new RegExp(`delete from public\\.${projectionTable} \\w+[\\s\\S]*?\\.user_id = p_user_id`),
    `${projectionTable} must not retain pre-reset challenge projections`,
  );
}
assert.match(
  migration,
  /delete from public\.templates template[\s\S]*template\.creator_user_id = p_user_id[\s\S]*template\.visibility <> 'public'/,
);
assert.match(
  migration,
  /delete from public\.push_token_dispatch_acceptances acceptance[\s\S]*acceptance\.user_id = p_user_id/,
);
assert.match(migration, /v_retained_media_paths/);
assert.match(migration, /coalesce\(snapshot\.revision, 0\) \+ 1/);
for (const retainedTable of [
  "auth.users",
  "profiles",
  "group_members",
  "messages",
  "group_todos",
  "group_challenges",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(`delete\\s+from\\s+(?:public\\.)?${retainedTable.replace(".", "\\.")}`, "i"),
    `${retainedTable} must survive account-data reset`,
  );
}
assert.doesNotMatch(
  migration,
  /delete from public\.group_challenge_result_placements/,
  "settled challenge history must survive account-data reset",
);

assert.match(edge, /auth\.getUser\(\)/);
assert.match(edge, /begin_google_health_account_deletion/);
assert.match(edge, /renew_google_health_account_deletion/);
assert.match(edge, /reset_account_private_data/);
assert.match(edge, /retainedMediaPaths/);
assert.match(edge, /account_reset_media_cleanup_incomplete/);
assert.match(edge, /cancel_google_health_account_deletion/);

assert.match(cloud, /resetAccountData: \(\) => Promise<void>/);
assert.match(cloud, /createResetAccountState/);
assert.match(cloud, /accountDataResetTimestamp\(remote\)/);
assert.match(cloud, /acceptAccountResetState\(remote, local\)/);
assert.match(cloud, /health\.disconnect\(\)/);
const resetImplementationStart = cloud.indexOf(
  "const resetAccountData = useCallback",
);
const resetHealthDisconnect = cloud.indexOf(
  "await health.disconnect();",
  resetImplementationStart,
);
const resetCloudWait = cloud.indexOf(
  "await Promise.allSettled(",
  resetImplementationStart,
);
assert.ok(
  resetImplementationStart >= 0 &&
    resetHealthDisconnect >= 0 &&
    resetCloudWait >= 0 &&
    resetHealthDisconnect < resetCloudWait,
  "account reset must establish the health disconnect fence before waiting for cloud outboxes",
);
assert.match(cloud, /preserveDeviceHealthSync: false/);
assert.match(cloud, /disablePushNotifications\(accountId\)/);
assert.match(cloud, /cancelAllManagedLocalNotifications\(accountId\)/);
assert.match(cloud, /deleteGoogleHealthGroupCheckpointsForAccount\(accountId\)/);
assert.match(cloud, /writeCloudSnapshotCursor\(accountId, remoteMetadata, resetHash\)/);
assert.match(appProvider, /preserveDeviceHealthSync\?: boolean/);
assert.match(appProvider, /preserveDeviceHealthEntries\?: boolean/);
assert.match(
  appProvider,
  /preserveDeviceHealthSync: options\?\.preserveDeviceHealthSync \?\? true/,
);
assert.match(
  appProvider,
  /preserveDeviceHealthEntries:\s*options\?\.preserveDeviceHealthEntries \?\?/,
);
assert.match(cloud, /preserveDeviceHealthEntries: false/);

const healthImportGuard = healthProvider.match(
  /const runCurrentHealthImport = useCallback\([\s\S]*?\n  \);/,
)?.[0];
assert.ok(healthImportGuard, "foreground health imports need one shared guard");
assert.match(
  healthImportGuard,
  /if \(!healthOperationIsCurrent\(operation\)\) return false;[\s\S]*?await task\(\);[\s\S]*?return healthOperationIsCurrent\(operation\);/,
  "the generation/enabled fence must be checked directly before and after every reducer import",
);
assert.equal(
  (healthProvider.match(/\(\) => importHealthEntries\(/g) ?? []).length,
  5,
  "all five foreground import sites must run through the guarded import helper",
);
assert.doesNotMatch(
  healthProvider,
  /await importHealthEntries\(/,
  "foreground import sites must not bypass the generation fence",
);

const statusGuard = healthProvider.match(
  /const saveStatus = useCallback\([\s\S]*?\n  \}, \[captureHealthOperation, healthOperationIsCurrent\]\);/,
)?.[0];
assert.ok(statusGuard, "persisted health status needs a shared generation guard");
assert.match(
  statusGuard,
  /if \(!healthOperationIsCurrent\(operation, requireEnabled\)\) return false;[\s\S]*?runAppStateStorageMutation[\s\S]*?if \(!healthOperationIsCurrent\(operation, requireEnabled\)\) return null;[\s\S]*?AsyncStorage\.setItem/,
  "a stale queued status write must be rejected again inside the storage gate",
);

const disconnectFence = healthProvider.match(
  /const disconnect = useCallback\([\s\S]*?\n  \}, \[availability, captureHealthOperation, healthOperationIsCurrent, saveStatus\]\);/,
)?.[0];
assert.ok(disconnectFence, "Health disconnect implementation must be present");
assert.match(disconnectFence, /healthOperationGenerationRef\.current \+= 1/);
assert.match(disconnectFence, /enabled: false/);
assert.match(disconnectFence, /await Promise\.allSettled\(/);
assert.ok(
  disconnectFence.indexOf("healthOperationGenerationRef.current += 1") <
    disconnectFence.indexOf("await Promise.allSettled("),
  "disconnect must invalidate the generation synchronously before awaiting the active read",
);
assert.ok(
  disconnectFence.indexOf("enabled: false") <
    disconnectFence.indexOf("await Promise.allSettled("),
  "disconnect must publish disabled state before yielding to native work",
);
assert.match(
  disconnectFence,
  /await Promise\.allSettled\([\s\S]*?pending[\s\S]*?saveStatus\([\s\S]*?connectionEnabled: false/,
  "disconnect must let the invalidated read settle before its final disabled status write",
);

// Regression model for the actual failure: Health Connect resolves after Reset
// invalidates the connection. The guarded continuation must skip both the
// reducer import and the stale connectionEnabled:true status write.
let generation = 0;
let enabled = true;
let connectionEnabled = true;
const importedEntries = [];
let releaseNativeRead;
const delayedNativeRead = new Promise((resolve) => {
  releaseNativeRead = resolve;
});
const operation = { accountId: "account-a", generation };
const isCurrent = () =>
  operation.generation === generation && enabled;
const delayedImport = (async () => {
  const records = await delayedNativeRead;
  if (!isCurrent()) return;
  importedEntries.push(...records);
  if (!isCurrent()) return;
  connectionEnabled = true;
})();

generation += 1;
enabled = false;
const disconnect = Promise.allSettled([delayedImport]).then(() => {
  connectionEnabled = false;
});
releaseNativeRead([{ id: "late-health-row" }]);
await disconnect;
assert.deepEqual(
  importedEntries,
  [],
  "a native read released after reset must not import health rows",
);
assert.equal(
  connectionEnabled,
  false,
  "a native read released after reset must not restore connectionEnabled",
);

const backgroundFailureHandler = backgroundHealth.slice(
  backgroundHealth.lastIndexOf("} catch (error) {"),
  backgroundHealth.indexOf(
    "return BackgroundTask.BackgroundTaskResult.Failed;",
    backgroundHealth.lastIndexOf("} catch (error) {"),
  ),
);
assert.doesNotMatch(
  backgroundHealth,
  /previousStatus/,
  "a failed headless read must never retain a pre-reset status fallback",
);
assert.match(
  backgroundFailureHandler,
  /parsePersistedHealthStatus\([\s\S]*?AsyncStorage\.getItem\(statusKey\)[\s\S]*?if \(!latestStatus \|\| latestStatus\.connectionEnabled === false\) return;/,
  "the background error path must abort when Reset has removed health status",
);
assert.match(
  backgroundFailureHandler,
  /getAppStateStorageItem\(APP_STORAGE_KEY\)[\s\S]*?activeState\?\.currentUserId !== statusUserId[\s\S]*?!activeState\.settings\.healthSync\.enabled[\s\S]*?!activeState\.settings\.healthSync\.backgroundAccess[\s\S]*?!activeSchedule\.requestsBackground/,
  "the background error path must revalidate the active account and live background-health configuration",
);
assert.match(
  backgroundFailureHandler,
  /healthHistorySelectionKey\([\s\S]*?activeState\.settings\.healthHistoryDays[\s\S]*?\) !== requestedHistorySelection/,
  "a delayed background failure must not write against a changed history boundary",
);

// Delayed headless failure regression: Reset removes the status key and
// disables the persisted health schedule while the native read is blocked.
// Releasing the failure afterward must leave the key absent.
let persistedBackgroundStatus = { connectionEnabled: true };
let persistedBackgroundState = {
  currentUserId: "account-a",
  healthEnabled: true,
  backgroundAccess: true,
  requestsBackground: true,
  historySelection: "90",
};
let backgroundStatusWrites = 0;
let rejectBackgroundRead;
const delayedBackgroundRead = new Promise((_, reject) => {
  rejectBackgroundRead = reject;
});
const delayedBackgroundTask = (async () => {
  try {
    await delayedBackgroundRead;
  } catch {
    const latestStatus = persistedBackgroundStatus;
    if (!latestStatus) return;
    const activeState = persistedBackgroundState;
    if (
      activeState.currentUserId !== "account-a" ||
      !activeState.healthEnabled ||
      !activeState.backgroundAccess ||
      !activeState.requestsBackground ||
      activeState.historySelection !== "90"
    )
      return;
    persistedBackgroundStatus = { ...latestStatus, error: "late failure" };
    backgroundStatusWrites += 1;
  }
})();
persistedBackgroundStatus = null;
persistedBackgroundState = {
  ...persistedBackgroundState,
  healthEnabled: false,
  backgroundAccess: false,
  requestsBackground: false,
};
rejectBackgroundRead(new Error("native read released after reset"));
await delayedBackgroundTask;
assert.equal(
  persistedBackgroundStatus,
  null,
  "a delayed background error must not recreate the reset health-status key",
);
assert.equal(
  backgroundStatusWrites,
  0,
  "a delayed background error must not perform any post-reset status write",
);

assert.match(settings, /Clear account data\?/);
assert.match(settings, /Review reset/);
assert.match(settings, /This cannot be undone/);
assert.match(settings, /Clear my data/);
assert.match(settings, /sign-in, group memberships/);
assert.match(settings, /content already shared with groups/);
assert.match(menu, /path: "\/legal-support"/);
assert.match(layout, /name="legal-support"/);
assert.match(legal, /title="Legal & support"/);
assert.doesNotMatch(
  settings,
  /<SectionHeader title="Legal & support"/,
  "legal/support must not remain embedded in Cloud & health sync",
);

console.log("Account-data reset validation passed.");
