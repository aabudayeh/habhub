import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertPushDeliveryComplete,
  dispatchPushWithBoundedRetry,
  isRetryablePushDeliveryError,
} from "../src/domain/pushDelivery.ts";

const read = (file) => fs.readFileSync(file, "utf8");
const push = read("src/notifications/push.ts");
const webPush = read("src/notifications/webPush.ts");
const webWorker = read("public/habhub-sw.js");
const webManifest = JSON.parse(read("public/manifest.webmanifest"));
const layout = read("app/_layout.tsx");
const notifications = read("app/notifications.tsx");
const auth = read("src/auth/AuthProvider.tsx");
const cloud = read("src/cloud/groupCloud.ts");
const edge = read("supabase/functions/send-push/index.ts");
const expand = read(
  "supabase/migrations/202608140001_group_notification_events.sql",
);
const activate = read(
  "supabase/migrations/202608140002_activate_group_notification_events.sql",
);
const webPushMigration = read(
  "supabase/migrations/202608200001_web_push_subscriptions.sql",
);
const alerts = read("app/alerts.tsx");
const group = read("app/(tabs)/group.tsx");
const alertDomain = read("src/domain/alerts.ts");
const inAppChatBanner = read("src/components/InAppChatBanner.tsx");
const chatScreen = read("app/(tabs)/chat.tsx");
const groupNotificationHook = read("src/cloud/useGroupNotificationEvents.ts");
const allAcceptedMigration = read(
  "supabase/migrations/202608230004_challenge_all_accepted_notification.sql",
);

assert.doesNotThrow(() => assertPushDeliveryComplete({ sent: 2 }));
assert.doesNotThrow(() =>
  assertPushDeliveryComplete({ sent: 0, deduplicated: true }),
);
assert.throws(
  () => assertPushDeliveryComplete({ sent: 0, retryable: true }),
  /temporarily unavailable/,
);

let attempts = 0;
const retries = [];
await dispatchPushWithBoundedRetry(
  async () => {
    attempts += 1;
    if (attempts === 1)
      assertPushDeliveryComplete({ sent: 0, retryable: true });
  },
  {
    retryDelaysMs: [7],
    schedule: (callback, delayMs) => retries.push({ callback, delayMs }),
  },
);
assert.deepEqual(retries.map((item) => item.delayMs), [7]);
retries[0].callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(attempts, 2);
for (const error of [
  { name: "FunctionsFetchError" },
  { name: "FunctionsRelayError" },
  { name: "FunctionsHttpError", context: { status: 503 } },
])
  assert.equal(isRetryablePushDeliveryError(error), true);
assert.equal(
  isRetryablePushDeliveryError({
    name: "FunctionsHttpError",
    context: { status: 403 },
  }),
  false,
);

const currentDeviceCleanup = push.slice(
  push.indexOf("async function removeCurrentDevicePushToken"),
  push.indexOf("export async function unregisterOrphanedDevicePushToken"),
);
assert.match(currentDeviceCleanup, /\.eq\('user_id', userId\)/);
assert.match(currentDeviceCleanup, /\.eq\('token', token\)/);
assert.match(currentDeviceCleanup, /\.eq\('platform', Platform\.OS\)/);
const accountDisable = push.slice(
  push.indexOf("export async function disablePushNotifications"),
  push.indexOf("const CYCLE_IDS"),
);
assert.match(accountDisable, /pendingPushDisableKey\(userId\)/);
assert.match(accountDisable, /cancelAllManagedLocalNotifications\(userId\)/);
assert.match(accountDisable, /clearNativePushIdentity\(userId, projectId\)/);
assert.match(
  accountDisable,
  /\.rpc\('delete_all_own_push_tokens', \{[\s\S]*p_expected_user_id: userId/,
);
assert.doesNotMatch(accountDisable, /\.eq\('token', token\)/);
assert.ok(
  accountDisable.indexOf("pushIdentityCleanupQueue = identityOperation") <
    accountDisable.indexOf("delete_all_own_push_tokens"),
  "the complete native disable lifecycle must fence a following account registration",
);
assert.ok(
  accountDisable.indexOf("delete_all_own_push_tokens") <
    accountDisable.indexOf("removeItem(pendingPushDisableKey(userId))"),
  "an auth-mismatched server delete must retain the durable disable marker",
);
assert.ok(
  accountDisable.indexOf("AsyncStorage.setItem") <
    accountDisable.indexOf("cancelAllManagedLocalNotifications"),
  "account-off intent must persist before any fallible cleanup",
);
assert.match(push, /Notifications\.unregisterForNotificationsAsync\(\)/);
assert.match(push, /export async function hasPendingPushDisable/);
assert.match(layout, /hasPendingPushDisable\(userId\)/);
assert.match(layout, /network\.isConnected/);
assert.match(layout, /network\.isInternetReachable/);
assert.match(layout, /!hydrated \|\|[\s\S]{0,100}Platform\.OS === "web"/);
assert.equal(
  (layout.match(/state\.settings\.notifications\.challenges/g) ?? []).length >= 2,
  true,
);
const remoteLifecycle = layout.slice(
  layout.indexOf("const pushRegistrationUserId"),
  layout.indexOf("const safeDefaultLandingPage"),
);
assert.doesNotMatch(remoteLifecycle, /tutorialActive/);
assert.match(remoteLifecycle, /addNotificationResponseReceivedListener/);
assert.match(remoteLifecycle, /NativeAppState\.addEventListener/);
assert.match(alertDomain, /groupPreferencesByGroup\?\.\[state\.group\.id\]/);
assert.match(alertDomain, /groupPreferences\?\.enabled !== false/);
assert.match(alertDomain, /groupPreferences\?\.leadChanges/);
assert.match(alertDomain, /allowedMetricIds\.includes\(metric\.id\)/);
assert.match(alertDomain, /allowedMemberIds\.includes\(current\.member\.id\)/);
assert.match(alertDomain, /if \(!changed\) return \[\]/);

const transitionFenceStart = auth.indexOf(
  "const beginIdentityTransitionCleanup",
);
const transitionFence = auth.slice(
  transitionFenceStart,
  auth.indexOf("const rememberSession", transitionFenceStart),
);
assert.ok(
  transitionFence.indexOf("unregisterCurrentDevicePushToken") <
    transitionFence.indexOf("cancelAllManagedLocalNotifications"),
  "A-to-B native identity fencing must be appended synchronously",
);
const rememberedSession = auth.slice(
  auth.indexOf("const rememberSession"),
  auth.indexOf("const confirmSignedOut"),
);
assert.ok(
  rememberedSession.indexOf("beginIdentityTransitionCleanup") <
    rememberedSession.indexOf("setSession(nextSession)"),
  "the previous identity cleanup fence must be appended before B is published",
);
assert.match(push, /let pushIdentityCleanupQueue: Promise<void>/);
assert.match(push, /const identityBarrier = pushIdentityCleanupQueue/);
assert.match(notifications, /Account-wide master switch/);
assert.match(notifications, /every account device registration/);

// Executed A-to-B ordering fixture: account B's registration must remain behind
// the cleanup fence that account A appended synchronously, even when A's local
// cleanup is blocked for an arbitrary amount of time.
let identityCleanupQueue = Promise.resolve();
const identityOrder = [];
let releaseAccountACleanup;
const accountACleanupBlocked = new Promise((resolve) => {
  releaseAccountACleanup = resolve;
});
const enqueueIdentityCleanup = (cleanup) => {
  const operation = identityCleanupQueue.then(cleanup, cleanup);
  identityCleanupQueue = operation.catch(() => undefined);
  return operation;
};
const accountACleanup = enqueueIdentityCleanup(async () => {
  identityOrder.push("A-cleanup-started");
  await accountACleanupBlocked;
  identityOrder.push("A-native-token-cleared");
});
const accountBRegistration = (async () => {
  const identityBarrier = identityCleanupQueue;
  await identityBarrier.catch(() => undefined);
  identityOrder.push("B-token-registered");
})();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(identityOrder, ["A-cleanup-started"]);
releaseAccountACleanup();
await Promise.all([accountACleanup, accountBRegistration]);
assert.deepEqual(identityOrder, [
  "A-cleanup-started",
  "A-native-token-cleared",
  "B-token-registered",
]);

assert.match(expand, /create table if not exists public\.push_dispatch_events/);
assert.match(expand, /create or replace function public\.delete_all_own_push_tokens/);
assert.match(expand, /v_user_id <> p_expected_user_id/);
assert.match(expand, /delete from public\.device_push_tokens/);
assert.match(expand, /create table if not exists public\.group_notification_events/);
assert.match(expand, /create table if not exists public\.group_membership_transitions/);
assert.match(expand, /create table if not exists public\.push_dispatch_configuration/);
assert.match(expand, /emitters_active boolean not null default false/);
assert.match(expand, /create trigger group_challenges_emit_feed_events/);
assert.doesNotMatch(expand, /create trigger group_members_emit_push_event/);
assert.doesNotMatch(expand, /create trigger metric_entries_emit_group_push_event/);
assert.match(activate, /create trigger group_members_emit_push_event/);
assert.match(activate, /create trigger metric_entries_emit_group_push_event/);
assert.match(activate, /create trigger group_challenges_emit_notification_events/);
assert.match(activate, /emitters_active = true/);
assert.match(activate, /updated_at = clock_timestamp\(\)/);
assert.match(expand, /old\.status = 'pending'[\s\S]*membership_request_withdrawn/);
assert.match(expand, /old\.status = 'pending'[\s\S]*membership_request_declined/);
assert.doesNotMatch(expand, /max\(entry\.id\)/i);
assert.match(
  expand,
  /floor\(extract\(epoch from v_latest\) \* 1000\)::bigint::text/,
);
assert.match(
  expand,
  /category = 'winner'[\s\S]*public\.is_group_member\(group_id\)/,
);

assert.match(edge, /canonicalChatEvent/);
assert.match(edge, /const expectedEventKey = `message:\$\{groupId\}:\$\{clientMessageId\}`/);
assert.match(edge, /pushPreview\(direct \? text :/);
assert.match(edge, /`Group message in \$\{groupName\}`/);
assert.match(edge, /`\$\{senderName\}: \$\{text\}`/);
assert.match(cloud, /`Group message in \$\{state\.group\.name\}`/);
assert.match(cloud, /`\$\{sender\.name\}: \$\{message\.text \|\| fallback\}`/);
assert.match(alertDomain, /`Group message in \$\{state\.group\.name\}`/);
assert.match(alertDomain, /"A group member"\}: \$\{message\.text/);
assert.match(inAppChatBanner, /`Group message in \$\{state\.group\.name\}`/);
assert.match(inAppChatBanner, /`\$\{senderName\}: \$\{preview\}`/);
assert.match(
  edge,
  /\.\.\.\(direct \? \{ recipient: senderId \} : \{\}\)/,
  "canonical direct-message Web pushes must name the sender as the DM route recipient",
);
assert.match(
  cloud,
  /message\.recipientId[\s\S]{0,80}\{ recipient: state\.currentUserId \}/,
  "legacy direct-message payloads must use the sender identity for the receiver's route",
);
assert.match(
  webWorker,
  /data\?\.conversationType === "direct"[\s\S]{0,180}target\.searchParams\.set\("recipient", data\.senderId/,
  "the service worker must upgrade older direct payloads from senderId to recipient",
);
assert.match(chatScreen, /useLocalSearchParams<\{ recipient\?/);
assert.match(edge, /legacyMembershipCanonicalEvent/);
assert.match(edge, /legacyCommittedCanonicalEvent/);
assert.match(edge, /legacyCompetitionCanonicalEvent/);
assert.match(edge, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
assert.match(edge, /group_membership_transitions/);
assert.match(edge, /dispatchConfiguration\?\.emitters_active === true/);
assert.match(edge, /transition\.created_at/);
assert.match(edge, /requestedLegacyEventKey/);
assert.match(edge, /legacy_claim_adopted/);
assert.match(edge, /legacyPreMutationMembershipEvents\.has\(canonical\.eventType\)/);
assert.match(edge, /outboxCreatedAt - legacyClaimAt <= legacyClaimAdoptionWindowMs/);
assert.match(edge, /const legacyNonMembershipClaim =/);
assert.match(edge, /canonical\.category !== "membership"/);
assert.match(edge, /legacyPreMutationClaim \|\| legacyNonMembershipClaim/);
assert.match(edge, /normalizedUuid\(triggerSuffix\) !== undefined/);
assert.match(edge, /\.like\("event_key", `\$\{legacyPrefix\}%`\)/);
assert.match(edge, /\.eq\("sender_id", canonical\.dispatcherId\)/);
assert.match(edge, /Math\.abs\(claimedEventAt - claimedAt\)/);
assert.match(edge, /canDispatchStoredEvent/);
assert.match(edge, /event\.category !== "winner"/);
assert.match(edge, /sourceAndTimeSuffix\.startsWith/);
assert.match(edge, /settings\.challenges \?\? settings\.badgesAndWinners \?\? true/);
assert.match(
  edge,
  /"challenge_accepted",[\s\S]{0,80}"challenge_all_accepted"[\s\S]{0,120}groupPreference\.challengeUpdates === false/,
  "all-accepted pushes must respect each recipient's challenge-update preference",
);
assert.match(
  groupNotificationHook,
  /event\.kind === "challenge_all_accepted"[\s\S]{0,100}preferences\?\.challengeUpdates === false/,
  "the private in-app feed must respect the same challenge-update preference",
);
assert.match(
  allAcceptedMigration,
  /on conflict \(event_key\) do nothing/i,
  "the trigger-owned all-accepted push must be idempotent",
);
assert.match(edge, /return !Array\.isArray\(ids\) \|\| ids\.includes\(event\.metricId\)/);
assert.match(edge, /!inQuietHours\(item\.preferences \?\? \{\}\)/);
assert.doesNotMatch(edge, /deferred\s*:/);
assert.match(edge, /\.select\("metric_id, local_date, recorded_at, visibility, source_provider"\)/);
assert.match(edge, /entry\.source_provider === "google_health"/);
assert.match(edge, /candidate\.source_provider === "google_health"/);
assert.match(edge, /entry\.recorded_at[\s\S]{0,120}15 \* 60 \* 1000/);
const phaseAMetricIsFresh = (recordedAt, now) =>
  Number.isFinite(new Date(recordedAt).getTime()) &&
  new Date(recordedAt).getTime() >= now - 15 * 60 * 1000;
assert.equal(
  phaseAMetricIsFresh("2026-08-01T09:00:00.000Z", Date.UTC(2026, 7, 14, 18)),
  false,
  "a newly uploaded historical Health Connect row must not emit a phase-A push",
);
assert.equal(
  phaseAMetricIsFresh("2026-08-14T17:50:00.000Z", Date.UTC(2026, 7, 14, 18)),
  true,
);

// Executed collision fixture: a reused same-day request key cannot consume a
// later trigger-owned invitation, while a tightly preceding legacy delete can
// adopt the matching trigger row that proves the post-mutation transition.
const shouldAdoptLegacyClaim = ({
  category,
  eventType,
  legacyClaimAt,
  outboxCreatedAt,
}) =>
  category === "membership" &&
  new Set([
    "membership_left",
    "membership_removed",
    "membership_request_withdrawn",
    "membership_request_declined",
  ]).has(eventType) &&
  legacyClaimAt <= outboxCreatedAt &&
  outboxCreatedAt - legacyClaimAt <= 2 * 60 * 1000;
assert.equal(
  shouldAdoptLegacyClaim({
    category: "membership",
    eventType: "membership_request",
    legacyClaimAt: Date.UTC(2026, 7, 14, 8, 0),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0),
  }),
  false,
);
const shouldAdoptRequestedLegacyClaim = ({
  category,
  eventType,
  legacyClaimAt,
  outboxCreatedAt,
}) =>
  shouldAdoptLegacyClaim({
    category,
    eventType,
    legacyClaimAt,
    outboxCreatedAt,
  }) ||
  (category !== "membership" && legacyClaimAt <= outboxCreatedAt);
assert.equal(
  shouldAdoptRequestedLegacyClaim({
    category: "lead",
    eventType: "leaderboard_activity",
    legacyClaimAt: Date.UTC(2026, 7, 14, 17, 59),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0),
  }),
  true,
  "an old-Edge lead claim must consume its later standardized canonical row",
);
const shouldAdoptReverseLegacyClaim = ({
  eventType,
  canonicalSuffix,
  legacySuffix,
  legacyClaimAt,
  outboxCreatedAt,
}) =>
  new Set([
    "membership_left",
    "membership_removed",
    "membership_request_withdrawn",
    "membership_request_declined",
  ]).has(eventType) &&
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(canonicalSuffix) &&
  /^\d{13}$/.test(legacySuffix) &&
  Math.abs(Number(legacySuffix) - legacyClaimAt) <= 2 * 60 * 1000 &&
  legacyClaimAt <= outboxCreatedAt &&
  outboxCreatedAt - legacyClaimAt <= 2 * 60 * 1000;
assert.equal(
  shouldAdoptReverseLegacyClaim({
    eventType: "membership_removed",
    canonicalSuffix: "26ba37ce-73e6-4fdb-88c1-34ff8e18f561",
    legacySuffix: String(Date.UTC(2026, 7, 14, 18, 0)),
    legacyClaimAt: Date.UTC(2026, 7, 14, 18, 0, 1),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0, 20),
  }),
  true,
);
assert.equal(
  shouldAdoptReverseLegacyClaim({
    eventType: "membership_approved",
    canonicalSuffix: "26ba37ce-73e6-4fdb-88c1-34ff8e18f561",
    legacySuffix: String(Date.UTC(2026, 7, 14, 18, 0)),
    legacyClaimAt: Date.UTC(2026, 7, 14, 18, 0, 1),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0, 20),
  }),
  false,
);
assert.equal(
  shouldAdoptLegacyClaim({
    category: "membership",
    eventType: "membership_removed",
    legacyClaimAt: Date.UTC(2026, 7, 14, 18, 0),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0, 45),
  }),
  true,
);
assert.equal(
  shouldAdoptLegacyClaim({
    category: "membership",
    eventType: "membership_removed",
    legacyClaimAt: Date.UTC(2026, 7, 14, 17, 55),
    outboxCreatedAt: Date.UTC(2026, 7, 14, 18, 0),
  }),
  false,
);

assert.match(expand, /create table if not exists public\.push_token_dispatch_acceptances/);
assert.match(expand, /left\(v_title, 120\)/);
assert.match(expand, /left\(v_body, 500\)/);
assert.match(edge, /title: pushPreview\(String\(input\.title/);
assert.match(edge, /body: pushPreview\([\s\S]{0,100}String\(input\.body/);
const acceptanceTable = expand.slice(
  expand.indexOf("create table if not exists public.push_token_dispatch_acceptances"),
  expand.indexOf("-- A service-private transition ledger"),
);
assert.doesNotMatch(acceptanceTable, /references public\.push_events|on delete cascade/);
assert.match(acceptanceTable, /accepted_at/);
assert.match(edge, /priorAcceptances/);
assert.match(edge, /alreadyAccepted/);
assert.match(edge, /terminalTokens/);
assert.ok(
  edge.indexOf("push_token_dispatch_acceptances", edge.indexOf("terminalTokens")) <
    edge.indexOf("const transient = tickets.find"),
  "accepted tickets must be checkpointed before a later ticket failure throws",
);

assert.match(push, /const identityBarrier = pushIdentityCleanupQueue/);
assert.match(
  push,
  /return enableWebPushNotifications\([\s\S]{0,240}identityBarrier[\s\S]{0,240}allowPushRegistrationForAccount\(userId\)/,
);
assert.match(push, /return webPushSetupComplete\(userId\)/);
assert.match(push, /unregisterCurrentWebPushSubscription\(userId\)/);
assert.match(layout, /registerHabHubServiceWorker\(\)/);
assert.match(layout, /subscribeWebPushSubscriptionChanges\(recover\)/);
assert.match(webPush, /window\.isSecureContext/);
assert.match(webPush, /navigator\.serviceWorker\.register/);
assert.match(webPush, /updateViaCache: "none"/);
assert.match(webPush, /userVisibleOnly: true/);
assert.match(webPush, /subscription\.options\.applicationServerKey/);
assert.match(webPush, /register_web_push_subscription/);
assert.match(webPush, /own_web_push_subscription_exists/);
assert.match(webPush, /delete_own_web_push_subscription/);
assert.doesNotMatch(webPush, /WEB_PUSH_VAPID_PRIVATE_KEY/);
const enableWebPush = webPush.slice(
  webPush.indexOf("export async function enableWebPushNotifications"),
  webPush.indexOf("export async function webPushPermissionGranted"),
);
assert.ok(
  enableWebPush.indexOf("Notification.requestPermission()") <
    enableWebPush.indexOf("await allowAccountRegistration()") &&
    enableWebPush.indexOf("await allowAccountRegistration()") <
      enableWebPush.indexOf("await ensureSubscription()"),
  "the iOS Web Push permission prompt must stay in the direct user gesture, then a deliberate re-enable must clear an older durable disable before subscribing",
);

assert.match(webPushMigration, /create table if not exists public\.web_push_subscriptions/);
assert.match(webPushMigration, /alter table public\.web_push_subscriptions enable row level security/);
assert.match(webPushMigration, /revoke all on table public\.web_push_subscriptions/);
assert.match(webPushMigration, /security definer/g);
assert.match(webPushMigration, /caller_id <> p_expected_user_id/);
assert.match(webPushMigration, /pg_catalog\.pg_column_size\(normalized_preferences\) > 16384/);
assert.match(
  webPushMigration,
  /from public\.profiles profile[\s\S]*profile\.id = caller_id[\s\S]*for update;/,
);
assert.match(
  webPushMigration,
  /delete from public\.web_push_subscriptions subscription[\s\S]*subscription\.user_id = caller_id[\s\S]*order by older\.updated_at desc, older\.endpoint[\s\S]*offset 20/,
);
assert.match(
  webPushMigration,
  /where public\.web_push_subscriptions\.user_id = caller_id[\s\S]*public\.web_push_subscriptions\.p256dh = excluded\.p256dh[\s\S]*public\.web_push_subscriptions\.auth = excluded\.auth/,
);
assert.match(
  webPushMigration,
  /get diagnostics affected_rows = row_count;[\s\S]*if affected_rows = 0 then[\s\S]*using errcode = '42501';/,
);
assert.match(
  webPushMigration,
  /delete from public\.device_push_tokens[\s\S]*delete from public\.web_push_subscriptions/,
);
assert.match(
  webPushMigration,
  /create or replace function public\.delete_all_own_push_tokens\([\s\S]*returns integer[\s\S]*get diagnostics v_device_deleted = row_count;[\s\S]*get diagnostics v_web_deleted = row_count;[\s\S]*return v_device_deleted \+ v_web_deleted;/,
);
assert.match(webPushMigration, /notify pgrst, 'reload schema';/);

assert.match(edge, /npm:web-push@3\.6\.7/);
assert.match(edge, /\.from\("web_push_subscriptions"\)/);
assert.match(edge, /WEB_PUSH_VAPID_PRIVATE_KEY/);
assert.match(edge, /statusCode === 404 \|\| statusCode === 410/);
assert.match(edge, /sendWebPushTarget/);
assert.match(edge, /webPushTopic/);
assert.match(edge, /title: "Lead changed"/);
assert.match(edge, /changed first place/);
assert.match(
  edge,
  /if \(event\.category === "challenge"\)[\s\S]{0,700}\.is\("deleted_at", null\)/,
);
assert.match(edge, /challengeParticipantIds\?\.has\(event\.recipientId\)/);
assert.match(edge, /!hostname\.includes\("\."\)/);
assert.match(
  edge,
  /\(\?:localhost\|local\|internal\|lan\|home\|corp\|test\|invalid\|example\)/,
);
assert.match(webWorker, /self\.addEventListener\("push"/);
assert.match(webWorker, /self\.registration\.showNotification/);
assert.match(webWorker, /self\.addEventListener\("notificationclick"/);
assert.match(webWorker, /target\.origin === self\.location\.origin/);
assert.match(webWorker, /pushsubscriptionchange/);
assert.equal(webManifest.id, "/");
assert.equal(webManifest.display, "standalone");
assert.equal(webManifest.prefer_related_applications, false);
assert.deepEqual(
  webManifest.icons.map((icon) => icon.sizes),
  ["192x192", "512x512", "96x96"],
);
assert.deepEqual(webManifest.icons.at(-1), {
  src: "/habhub-notification-badge-96.png",
  sizes: "96x96",
  type: "image/png",
  purpose: "monochrome",
});

// Executable ownership fixture for the SQL conflict policy: a current owner
// may rotate keys, while an account transfer must prove possession of both
// secrets already bound to the high-entropy endpoint.
const endpointConflictAuthorized = (existing, incoming) =>
  existing.userId === incoming.userId ||
  (existing.p256dh === incoming.p256dh && existing.auth === incoming.auth);
const storedWebEndpoint = {
  userId: "account-a",
  p256dh: "stored-public-key",
  auth: "stored-auth-secret",
};
assert.equal(
  endpointConflictAuthorized(storedWebEndpoint, {
    userId: "account-a",
    p256dh: "rotated-public-key",
    auth: "rotated-auth-secret",
  }),
  true,
);
assert.equal(
  endpointConflictAuthorized(storedWebEndpoint, {
    userId: "account-b",
    p256dh: "stored-public-key",
    auth: "stored-auth-secret",
  }),
  true,
);
assert.equal(
  endpointConflictAuthorized(storedWebEndpoint, {
    userId: "account-b",
    p256dh: "attacker-public-key",
    auth: "stored-auth-secret",
  }),
  false,
);
assert.equal(
  endpointConflictAuthorized(storedWebEndpoint, {
    userId: "account-b",
    p256dh: "stored-public-key",
    auth: "attacker-auth-secret",
  }),
  false,
);

// Executed 101-token retry fixture: the first accepted Expo batch survives the
// global claim release caused by a transient second batch. The retry sends only
// the one uncheckpointed token and then completes the canonical event.
const fanoutTokens = Array.from({ length: 101 }, (_, index) => `token-${index + 1}`);
const acceptedFanoutTokens = new Set();
const fanoutAttempts = [];
let fanoutClaimReleases = 0;
let fanoutEventCompleted = false;
let failSecondBatchOnce = true;
const runFanoutAttempt = async () => {
  const pendingTokens = fanoutTokens.filter(
    (token) => !acceptedFanoutTokens.has(token),
  );
  const batches = [];
  for (let offset = 0; offset < pendingTokens.length; offset += 100)
    batches.push(pendingTokens.slice(offset, offset + 100));
  fanoutAttempts.push(batches.map((batch) => [...batch]));
  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      if (batchIndex === 1 && failSecondBatchOnce) {
        failSecondBatchOnce = false;
        throw new Error("transient Expo gateway failure");
      }
      for (const token of batch) acceptedFanoutTokens.add(token);
    }
    fanoutEventCompleted = true;
  } catch (error) {
    fanoutClaimReleases += 1;
    throw error;
  }
};
await assert.rejects(runFanoutAttempt(), /transient Expo gateway failure/);
assert.equal(fanoutClaimReleases, 1);
assert.equal(fanoutEventCompleted, false);
assert.equal(acceptedFanoutTokens.size, 100);
assert.equal(fanoutAttempts[0].length, 2);
assert.equal(fanoutAttempts[0][0].length, 100);
assert.equal(fanoutAttempts[0][1].length, 1);
await runFanoutAttempt();
assert.equal(fanoutAttempts[1].length, 1);
assert.deepEqual(fanoutAttempts[1][0], ["token-101"]);
assert.equal(acceptedFanoutTokens.size, 101);
assert.equal(fanoutEventCompleted, true);

assert.match(cloud, /let groupPushDrainPromise/);
assert.match(cloud, /if \(groupPushDrainPromise\) return groupPushDrainPromise/);
assert.match(cloud, /for \(let page = 0; page < 10; page \+= 1\)/);
assert.match(cloud, /\.limit\(40\)/);
assert.match(cloud, /pending!\.slice\(offset, offset \+ 4\)/);
assert.match(cloud, /Promise\.allSettled/);
assert.match(cloud, /created_at\.lt\./);
assert.match(cloud, /id\.lt\./);
assert.ok(
  cloud.indexOf("if (firstFailure !== undefined) throw firstFailure") >
    cloud.indexOf("cursor = { createdAt: last.created_at, id: last.id }"),
  "all cursor pages must run before an individual event failure is surfaced",
);

// Executed 45-row cursor fixture: failures in the newest 40 cannot hide five
// older rows from the same bounded pass.
const fixture = Array.from({ length: 45 }, (_, index) => ({
  id: String(1000 - index).padStart(4, "0"),
  created_at: new Date(Date.UTC(2026, 7, 14, 12, 0, 45 - index)).toISOString(),
}));
const visited = [];
let cursor;
for (let page = 0; page < 10; page += 1) {
  const rows = fixture
    .filter(
      (row) =>
        !cursor ||
        row.created_at < cursor.createdAt ||
        (row.created_at === cursor.createdAt && row.id < cursor.id),
    )
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.id.localeCompare(left.id),
    )
    .slice(0, 40);
  if (!rows.length) break;
  visited.push(...rows);
  const last = rows.at(-1);
  cursor = { createdAt: last.created_at, id: last.id };
  if (rows.length < 40) break;
}
assert.equal(visited.length, 45);

assert.match(group, /groupFeedUnreadCount/);
assert.match(group, /router\.navigate\("\/alerts\?scope=group"/);
assert.match(alerts, /markGroupFeedRead\(unreadEventIds\)/);
assert.match(alerts, /filter === "challenge"/);

console.log(
  "Push validation passed: native and Web Push account lifecycle, PWA service worker, staged canonical outbox, private challenge feed, cursor drain, and per-target retry checkpoints.",
);
