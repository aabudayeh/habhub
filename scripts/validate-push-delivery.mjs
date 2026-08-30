import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertPushDeliveryComplete,
  dispatchPushWithBoundedRetry,
  isRetryablePushDeliveryError,
} from "../src/domain/pushDelivery.ts";

// Metro supplies require() for bundled demo assets reached by the alert-domain
// fixture. Install the focused validator stub before loading that graph.
globalThis.require = (source) => source;
const { buildAlerts } = await import("../src/domain/alerts.ts");
const {
  stageChatShareImage,
  stagedChatShareImage,
} = await import("../src/storage/chatShareImageStaging.ts");

const read = (file) => fs.readFileSync(file, "utf8");
const push = read("src/notifications/push.ts");
const webPush = read("src/notifications/webPush.ts");
const webWorker = read("public/habhub-sw.js");
const webManifest = JSON.parse(read("public/manifest.webmanifest"));
const layout = read("app/_layout.tsx");
const notifications = read("app/notifications.tsx");
const groupSettings = read("app/group-settings.tsx");
const auth = read("src/auth/AuthProvider.tsx");
const cloud = read("src/cloud/groupCloud.ts");
const cloudSyncProvider = read("src/cloud/CloudSyncProvider.tsx");
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
const chatShareDomain = read("src/domain/social.ts");
const chatShareImageStaging = read("src/storage/chatShareImageStaging.ts");
const recapScreen = read("app/recap.tsx");
const leaderboardDetail = read("app/leaderboard-detail.tsx");
const groupNotificationHook = read("src/cloud/useGroupNotificationEvents.ts");
const accountNotificationHook = read("src/cloud/useAccountNotificationEvents.ts");
const groupSocialHook = read("src/cloud/useGroupSocialEngagement.ts");
const groupChallengesHook = read("src/cloud/useGroupChallenges.ts");
const settledChallengeResultsHook = read(
  "src/cloud/useSettledChallengeResults.ts",
);
const groupSocialClient = read("src/cloud/groupSocial.ts");
const allAcceptedMigration = read(
  "supabase/migrations/202608230004_challenge_all_accepted_notification.sql",
);
const socialEngagementMigration = read(
  "supabase/migrations/202608270001_group_social_engagement.sql",
);
const socialReactionRpcMigration = read(
  "supabase/migrations/202608280001_durable_group_log_social_identity.sql",
);
const socialCheerMigration = read(
  "supabase/migrations/202608300001_social_cheers.sql",
);
const challengeRankMigration = read(
  "supabase/migrations/202608270005_challenge_rank_rewards.sql",
);

assert.doesNotThrow(() => assertPushDeliveryComplete({ sent: 2 }));
const stagedMetricAttachment = {
  kind: "metric_log",
  entryId: "entry-1",
  metricId: "food",
  localDate: "2026-08-30",
  memberId: "member-2",
};
stageChatShareImage(
  "account-1",
  "group-1",
  stagedMetricAttachment,
  "https://private.example/signed-photo",
);
assert.equal(
  stagedChatShareImage("account-1", "group-1", stagedMetricAttachment),
  "https://private.example/signed-photo",
);
assert.equal(
  stagedChatShareImage("account-2", "group-1", stagedMetricAttachment),
  undefined,
  "staged attachment media must not cross account boundaries",
);
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
assert.match(alertDomain, /challengeId: event\.challengeId/);
assert.match(alertDomain, /challengeOccurrenceDate: event\.occurrenceDate/);
assert.match(alertDomain, /groupId: event\.groupId/);
assert.match(alertDomain, /unread: !event\.readAt/);
assert.match(alerts, /latestUnread = allAlerts\.find/);
assert.match(alerts, /setFilter\(latestUnread\?\.category \?\? "all"\)/);
assert.match(alerts, /unreadCategories\.has\("challenge"\)/);
assert.match(
  alerts,
  /pathname: "\/challenges"[\s\S]{0,300}challengeId: alert\.challengeId[\s\S]{0,300}challengeOccurrenceDate/,
  "an in-app challenge alert must preserve the exact challenge and occurrence route",
);
assert.match(alerts, /groupId: alert\.groupId/);
assert.match(groupNotificationHook, /loaded,[\s\S]{0,80}markRead/);

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
assert.match(
  chatScreen,
  /`Message \$\{memberDisplayName\(state, recipient\)\}…`/,
  "the direct-message composer must use the viewer's group nickname",
);
assert.ok(
  (chatScreen.match(/memberDisplayName\(state, sender\)/g) ?? []).length >= 1,
  "message sender labels must use the shared group nickname resolver",
);
assert.equal(
  (edge.match(/\.from\("group_member_aliases"\)/g) ?? []).length,
  1,
  "recipient nicknames must be loaded in one bounded query rather than once per push target",
);
const recipientAliasResolver = edge.slice(
  edge.indexOf("async function recipientChatNicknames"),
  edge.indexOf("function eventForPushRecipient"),
);
assert.match(
  recipientAliasResolver,
  /\.eq\("group_id", event\.groupId\)[\s\S]{0,180}\.eq\("subject_user_id", senderId\)[\s\S]{0,180}\.in\("owner_user_id", recipientIds\)/,
  "chat pushes must resolve each recipient's private group-scoped alias",
);
assert.match(edge, /\.select\("user_id, token, preferences, platform"\)/);
assert.match(
  edge,
  /\.select\("user_id, endpoint, p256dh, auth, expiration_time, preferences"\)/,
);
const expoChatPersonalization = edge.slice(
  edge.indexOf("const messages = expoEligible.map"),
  edge.indexOf("let acceptedTicketCount"),
);
assert.match(
  expoChatPersonalization,
  /eventForPushRecipient\([\s\S]{0,100}item\.userId/,
  "Expo pushes must personalize sender identity for their recipient",
);
assert.match(expoChatPersonalization, /data: recipientEvent\.data/);
const webChatPersonalization = edge.slice(
  edge.indexOf("if (webEligible.length)"),
  edge.indexOf("// `sent` is retained for old clients"),
);
assert.match(
  webChatPersonalization,
  /sendWebPushTarget\([\s\S]{0,120}eventForPushRecipient\([\s\S]{0,100}target\.userId/,
  "Web pushes must personalize sender identity for their recipient",
);
assert.match(edge, /data: \{ \.\.\.event\.data, senderName: nickname \}/);
assert.match(cloud, /`Group message in \$\{state\.group\.name\}`/);
assert.match(cloud, /`\$\{sender\.name\}: \$\{visibleCopy\}`/);
assert.match(alertDomain, /`Group message in \$\{state\.group\.name\}`/);
assert.match(alertDomain, /"A group member"\}: \$\{messagePreview\}/);
assert.match(inAppChatBanner, /`Group message in \$\{state\.group\.name\}`/);
assert.match(inAppChatBanner, /`\$\{senderName\}: \$\{preview\}`/);
assert.match(inAppChatBanner, /chatSharePreview\(message\.text\)/);
assert.match(inAppChatBanner, /hasAttachment \? " · Attachment" : ""/);
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
assert.match(chatScreen, /useLocalSearchParams<\{\s*recipient\?/);
assert.match(edge, /legacyMembershipCanonicalEvent/);
assert.match(edge, /legacyCommittedCanonicalEvent/);
assert.match(edge, /legacyCompetitionCanonicalEvent/);
assert.match(
  edge,
  /category: "challenge"[\s\S]{0,700}route: "\/challenges"/,
  "legacy challenge pushes must open the dedicated Challenges screen",
);
assert.match(
  challengeRankMigration,
  /'\{route\}'[\s\S]{0,200}'\/challenges'[\s\S]{0,260}category = 'challenge'/,
  "queued challenge pushes must be upgraded before dispatch",
);
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

assert.match(
  socialEngagementMigration,
  /create index if not exists metric_entries_shared_client_target_idx[\s\S]{0,180}where visibility = 'group'/i,
  "shared-log reaction lookup must use a group-visible client-id index",
);
assert.match(
  socialEngagementMigration,
  /create index if not exists photo_updates_shared_client_target_idx[\s\S]{0,220}where visibility = 'group'/i,
  "shared-photo reaction lookup must use a group-visible client-id index",
);
assert.match(
  socialEngagementMigration,
  /create or replace function public\.valid_group_social_target[\s\S]{0,400}public\.is_group_member\(p_group_id\)/i,
  "the callable social-target validator must enforce active group membership itself",
);
assert.match(
  socialEngagementMigration,
  /group_social_reactions_member_read[\s\S]{0,240}valid_group_social_target\(group_id, target_type, target_id\)/i,
  "reaction reads must stop when their underlying shared target is revoked",
);
assert.match(
  socialEngagementMigration,
  /group_social_comments_member_read[\s\S]{0,240}valid_group_social_target\(group_id, target_type, target_id\)/i,
  "comment reads must stop when their underlying shared target is revoked",
);
assert.match(
  socialEngagementMigration,
  /create policy metrally_group_broadcast_read[\s\S]{0,900}split_part[\s\S]{0,500}'social'/i,
  "the compact group topic policy must authorize the private social stream",
);
assert.doesNotMatch(
  socialEngagementMigration,
  /realtime\.topic\(\)\)\s*(?:!~|~\*?)/i,
  "group Broadcast authorization must not depend on SQL regular expressions",
);
assert.match(
  socialEngagementMigration,
  /create or replace function public\.broadcast_group_social_change[\s\S]{0,900}realtime\.send\([\s\S]{0,500}'social_updated'[\s\S]{0,300}':social'[\s\S]{0,100}true/i,
  "social mutations must emit one private database-owned invalidation",
);
assert.match(
  groupSocialHook,
  /subscribePrivateBroadcast\([\s\S]{0,100}`group:\$\{groupId\}:social`[\s\S]{0,100}"social_updated"/,
  "social consumers must use the shared private Broadcast helper",
);
assert.doesNotMatch(groupSocialHook, /\.channel\(`group-social:/);
assert.doesNotMatch(groupSocialHook, /realtimeRef|\.send\(\{/);
const optimisticReactionPaint = groupSocialHook.indexOf(
  "reactionsRef.current = optimistic",
);
const reactionTargetRepair = groupSocialHook.indexOf(
  "let resolvedTarget = await mutationTarget(target)",
);
assert.ok(
  optimisticReactionPaint >= 0 &&
    reactionTargetRepair > optimisticReactionPaint,
  "reaction controls must paint before target repair or network work",
);
assert.match(recapScreen, /const FEED_PAGE_SIZE = 30/);
assert.match(recapScreen, /const feedState = useDeferredValue\(state\)/);
assert.match(recapScreen, /visibleFeed\.slice\(0, renderLimit\)/);
assert.match(recapScreen, /const MemoFeedCard = React\.memo/);
assert.match(
  recapScreen,
  /const stories =\s*storyDeck\?\.key === storySourceKey \? storyDeck\.stories : \[\]/,
  "an old recap deck must render as empty after its account, group, scope, or date changes",
);
assert.match(
  recapScreen,
  /if \(storyDeck\?\.key === storySourceKey\) return[\s\S]{0,260}!challengeCloud\.initialLoadComplete[\s\S]{0,100}!settledChallengeResults\.initialLoadComplete[\s\S]{0,360}setIndex\(0\)[\s\S]{0,120}setStoryDeck\(\{ key: storySourceKey, stories: sourceStories \}\)/,
  "the story screen must wait for both first cloud reads and then freeze one coherent page-one deck",
);
assert.match(
  groupChallengesHook,
  /\.finally\(\(\) => \{[\s\S]{0,600}setInitiallyLoadedGroupId\(groupId\)/,
  "challenge readiness must be tied to the group whose first read completed, not a transient loading flag",
);
assert.match(
  groupChallengesHook,
  /initialLoadComplete: initiallyLoadedGroupId === groupId/,
);
assert.match(
  settledChallengeResultsHook,
  /\.finally\(\(\) => \{[\s\S]{0,300}setInitiallyLoadedGroupId\(groupId\)/,
  "settled-result readiness must be tied to the group whose first read completed",
);
assert.match(
  settledChallengeResultsHook,
  /initialLoadComplete: initiallyLoadedGroupId === groupId/,
);
assert.match(
  socialReactionRpcMigration,
  /create or replace function public\.set_group_social_reaction[\s\S]*?v_actor_id uuid := auth\.uid\(\)/i,
  "reaction writes must derive the actor on the server",
);
assert.match(
  socialReactionRpcMigration,
  /create or replace function public\.set_group_social_reaction[\s\S]*?public\.valid_group_social_target\(\s*p_group_id,\s*p_target_type,\s*p_target_id\s*\)/i,
  "reaction writes must revalidate the shared target on the server",
);
assert.match(
  socialReactionRpcMigration,
  /grant execute on function public\.set_group_social_reaction\(uuid, text, text, text\)[\s\S]{0,80}authenticated/i,
  "only authenticated clients may call the reaction mutation boundary",
);
assert.match(
  groupSocialClient,
  /\.rpc\("set_group_social_reaction"[\s\S]{0,300}p_reaction:/,
  "the client must use the server-owned reaction mutation instead of a direct RLS upsert",
);
assert.doesNotMatch(
  groupSocialClient,
  /from\("group_social_reactions"\)[\s\S]{0,160}\.upsert\(/,
  "the client must not fall back to the failing direct reaction upsert",
);

assert.match(group, /groupFeedUnreadCount/);
assert.match(group, /router\.navigate\("\/alerts\?scope=group"/);

const clientChatPayload = cloud.slice(
  cloud.indexOf("function chatPushPayload"),
  cloud.indexOf("type CloudRecentActivityResult"),
);
assert.match(chatShareDomain, /parseChatShareMessage/);
assert.match(chatShareDomain, /chatSharePreview/);
assert.match(chatShareDomain, /buildChatShareMessage/);
assert.match(chatShareDomain, /habhub:\/\/recap/);
assert.match(chatShareDomain, /habhub:\/\/challenge/);
assert.match(chatShareDomain, /habhub:\/\/metric-log/);
assert.match(chatScreen, /recapShareAt/);
assert.match(chatScreen, /challengeShareAt/);
assert.match(chatScreen, /metricLogShareAt/);
assert.doesNotMatch(
  chatScreen,
  /sharedAttachmentImageUri/,
  "signed or private image URLs must not be transported through navigation",
);
assert.match(chatShareImageStaging, /attachmentIdentity/);
assert.match(
  chatShareImageStaging,
  /\$\{accountId\}\\u0000\$\{groupId\}/,
);
assert.match(chatScreen, /stagedChatShareImage/);
assert.match(chatScreen, /sharedAttachmentThumbnail/);
assert.match(recapScreen, /stageChatShareImage/);
assert.match(leaderboardDetail, /stageChatShareImage/);
assert.doesNotMatch(recapScreen, /sharedAttachmentImageUri/);
assert.doesNotMatch(leaderboardDetail, /sharedAttachmentImageUri/);
assert.match(chatScreen, /pathname: "\/\(tabs\)\/recapfeed"/);
assert.match(cloudSyncProvider, /isUploadableSharedAttachmentUri\(message\)/);
assert.match(
  cloudSyncProvider,
  /chatSharePreview\(message\.text\)\.hasAttachment/,
  "an authorized staged image must be copied into the sender-owned chat path before publication",
);
const ownedChatMediaUpload = cloudSyncProvider.slice(
  cloudSyncProvider.indexOf("async function uploadOwnedChatMessageMedia"),
  cloudSyncProvider.indexOf("function snapshotPayload"),
);
assert.match(
  ownedChatMediaUpload,
  /message\.senderId === userId[\s\S]{0,160}message\.groupId === state\.group\.id[\s\S]{0,160}message\.conversationId === `group:\$\{state\.group\.id\}`[\s\S]{0,320}\.slice\(-CHAT_OUTBOX_RECOVERY_LIMIT\)/,
  "chat image recovery must apply the active-account/group predicate before its bounded media window",
);
const targetedChatOutbox = cloudSyncProvider.slice(
  cloudSyncProvider.indexOf("const flushChatOutbox = useCallback"),
  cloudSyncProvider.indexOf("const recoverChatOutbox = useCallback"),
);
assert.match(
  targetedChatOutbox,
  /prepareChatMessageMedia\(messageId\)[\s\S]{0,140}pushCloudMessagesNow\(prepared, messageId\)/,
  "a shared image must become durable before the lightweight message outbox acknowledges it",
);
assert.match(
  cloud,
  /missingOrMediaRepair[\s\S]{0,260}message\.imageStoragePath[\s\S]{0,120}remote\.image_path !== message\.imageStoragePath[\s\S]{0,900}image_path: message\.imageStoragePath/,
  "chat recovery must repair an already-published relational row that is missing its durable image path",
);
assert.match(clientChatPayload, /chatSharePreview\(message\.text\)/);
assert.match(clientChatPayload, /Shared an attachment/);
assert.match(clientChatPayload, /visibleCopy/);
assert.match(clientChatPayload, /hasAttachment \? " · Attachment" : ""/);
assert.doesNotMatch(
  clientChatPayload,
  /message\.text \|\| fallback/,
  "client chat pushes must never expose attachment transport links",
);

const canonicalChat = edge.slice(
  edge.indexOf("async function canonicalChatEvent"),
  edge.indexOf("async function legacyMembershipCanonicalEvent"),
);
const canonicalChatPreview = edge.slice(
  edge.indexOf("function canonicalChatPreview"),
  edge.indexOf("function normalizedUuid"),
);
assert.match(canonicalChat, /image_path, metadata, push_dispatched_at/);
assert.match(canonicalChat, /canonicalChatPreview\(stored\.content, stored\.metadata\)/);
assert.doesNotMatch(canonicalChat, /stored\.content\?\.trim\(\)/);
assert.match(canonicalChatPreview, /\(\?:recap\|challenge\|metric-log\)/);
assert.match(canonicalChatPreview, /Shared an attachment/);
assert.match(canonicalChatPreview, /localizedChatFallback/);
assert.match(canonicalChatPreview, /hasAttachment \? " · Attachment" : ""/);
assert.match(edge, /event\.eventType === "social_reaction"[\s\S]{0,180}socialReactions/);
assert.match(notifications, /title="Reactions to your updates"/);
assert.match(groupSettings, /groupNotificationPreferences\.socialReactions/);
assert.match(groupNotificationHook, /event\.kind === "social_reaction"[\s\S]{0,100}preferences\?\.socialReactions === false/);
const effectiveGroupPreferencesStart = group.indexOf(
  "const effectiveGroupNotificationPreferences",
);
const groupNotificationHookCall = group.indexOf(
  "useGroupNotificationEvents(",
  effectiveGroupPreferencesStart,
);
const effectiveGroupPreferencesBlock = group.slice(
  effectiveGroupPreferencesStart,
  groupNotificationHookCall + 180,
);
assert.ok(
  effectiveGroupPreferencesStart >= 0 &&
    groupNotificationHookCall > effectiveGroupPreferencesStart,
  "the Leaderboard must build effective preferences before reading its notification feed",
);
assert.match(
  effectiveGroupPreferencesBlock,
  /groupPreferences\?\.socialReactions \?\?[\s\S]{0,120}state\.settings\.notifications\.socialReactions \?\?[\s\S]{0,80}true/,
  "the Leaderboard bell must apply the same per-group then global reaction preference fallback as push and Alerts",
);
assert.match(
  effectiveGroupPreferencesBlock,
  /useGroupNotificationEvents\([\s\S]{0,120}effectiveGroupNotificationPreferences/,
  "the Leaderboard unread count must consume the effective preferences",
);
assert.match(alertDomain, /socialReactionsEnabled/);
assert.match(
  alertDomain,
  /const groupEventsEnabled = groupPreferences\?\.enabled !== false[\s\S]{0,180}groupEventsEnabled &&[\s\S]{0,180}groupPreferences\?\.socialReactions \?\?[\s\S]{0,100}notifications\.socialReactions/,
  "the account-wide Alerts feed must honor both the group master switch and the effective reaction preference",
);
for (const challengePreference of [
  "challengeUpdates",
  "challengeStandings",
  "challengeReminders",
  "challengeResults",
])
  assert.match(
    alertDomain,
    new RegExp(`groupPreferences\\?\\.${challengePreference} === false`),
    `the Alerts feed must honor ${challengePreference}`,
  );
assert.match(socialCheerMigration, /'thumbs_down', 'cheer'/);
assert.match(socialCheerMigration, /when 'cheer' then 'cheered'/);
const photoReactionPushPayload = socialCheerMigration.slice(
  socialCheerMigration.indexOf("else\n    jsonb_build_object", socialCheerMigration.indexOf("v_data := case")),
  socialCheerMigration.indexOf("end;", socialCheerMigration.indexOf("v_data := case")),
);
assert.match(
  photoReactionPushPayload,
  /'route', '\/\(tabs\)\/recapfeed'[\s\S]{0,220}'highlight', 'photo:' \|\| new\.target_id/,
  "a photo-reaction push must open and highlight the interactive group feed rather than the paged story",
);
assert.doesNotMatch(photoReactionPushPayload, /'route', '\/recap'/);
assert.match(alertDomain, /chatSharePreview\(message\.text\)/);
assert.match(
  chatShareDomain,
  /text\.replace\(chatShareTransportPattern, ''\)/,
  "malformed or legacy attachment links must still be stripped from visible notification copy",
);
assert.match(alertDomain, /hasAttachment \? " · Attachment" : ""/);
assert.match(alertDomain, /hasAttachment[\s\S]{0,80}"Sent an attachment"/);
assert.match(
  alertDomain,
  /systemCategory: AlertCategory = groupConversation \? "lead" : "today"/,
  "system goal updates must be filed under Leaderboard or Today rather than Messages",
);
assert.match(alertDomain, /category: systemUpdate\s*\? systemCategory/);
assert.doesNotMatch(
  alertDomain,
  /detail:[\s\S]{0,180}message\.text \|\|/,
  "the notification feed must never render raw attachment transport links",
);
const attachmentAlertState = {
  currentUserId: "member-1",
  entries: [],
  metrics: [],
  photos: [],
  todos: [],
  group: {
    id: "group-1",
    name: "Goal Getters",
    members: [
      {
        id: "member-1",
        name: "Ahmad",
        initials: "A",
        color: "#ff6655",
      },
    ],
    metricConfiguration: [],
  },
  settings: {
    notifications: {
      groupPreferencesByGroup: {},
      leadChanges: false,
      metricIds: [],
      reminders: false,
      todoReminders: false,
      groupMetricActivity: false,
      chatReadAtByConversation: {},
    },
  },
  messages: [
  {
    id: "attachment-alert-fixture",
    groupId: "group-1",
    senderId: "member-1",
    conversationId: "group:group-1",
    kind: "message",
    text: "Check this out\nhabhub://metric-log?entryId=entry-1&metricId=food&localDate=2026-08-28",
    createdAt: "2026-08-28T14:35:00.000Z",
  },
  {
    id: "system-alert-fixture",
    groupId: "group-1",
    senderId: "system",
    conversationId: "group:group-1",
    kind: "cheer",
    text: "A group member reached a goal.",
    createdAt: "2026-08-28T14:36:00.000Z",
  },
  {
    id: "legacy-attachment-alert-fixture",
    groupId: "group-1",
    senderId: "member-1",
    conversationId: "group:group-1",
    kind: "message",
    text: "habhub://metric-log?entryId=legacy-entry&metricId=food&localDate=invalid",
    createdAt: "2026-08-28T14:37:00.000Z",
  },
  {
    id: "personal-system-alert-fixture",
    groupId: "group-1",
    senderId: "system",
    recipientId: "member-1",
    conversationId: "direct:system:member-1",
    kind: "reminder",
    text: "Your tracker is almost complete.",
    createdAt: "2026-08-28T14:38:00.000Z",
  },
  ],
};
const renderedAttachmentAlert = buildAlerts(attachmentAlertState).find(
  (alert) => alert.id === "message-attachment-alert-fixture",
);
assert.ok(renderedAttachmentAlert);
assert.equal(renderedAttachmentAlert.category, "message");
assert.equal(renderedAttachmentAlert.detail.includes("habhub://"), false);
assert.match(renderedAttachmentAlert.detail, /Check this out · Attachment/);
const renderedLegacyAttachmentAlert = buildAlerts(attachmentAlertState).find(
  (alert) => alert.id === "message-legacy-attachment-alert-fixture",
);
assert.ok(renderedLegacyAttachmentAlert);
assert.equal(renderedLegacyAttachmentAlert.detail.includes("habhub://"), false);
assert.match(renderedLegacyAttachmentAlert.detail, /Sent an attachment/);
const renderedSystemAlert = buildAlerts(attachmentAlertState).find(
  (alert) => alert.id === "message-system-alert-fixture",
);
assert.equal(renderedSystemAlert?.category, "lead");
assert.equal(renderedSystemAlert?.detail, "A group member reached a goal.");
assert.equal(renderedSystemAlert?.unread, true);
assert.equal(renderedSystemAlert?.readCursorKey, "group-1:lead");
const renderedPersonalSystemAlert = buildAlerts(attachmentAlertState).find(
  (alert) => alert.id === "message-personal-system-alert-fixture",
);
assert.equal(renderedPersonalSystemAlert?.category, "today");
assert.equal(renderedPersonalSystemAlert?.scope, "personal");
assert.equal(renderedPersonalSystemAlert?.unread, true);
assert.equal(renderedPersonalSystemAlert?.readCursorKey, "group-1:today");
const readSystemAlertState = {
  ...attachmentAlertState,
  settings: {
    ...attachmentAlertState.settings,
    notifications: {
      ...attachmentAlertState.settings.notifications,
      activityReadAtByCategory: {
        "group-1:lead": "2026-08-28T14:36:00.000Z",
        "group-1:today": "2026-08-28T14:38:00.000Z",
      },
    },
  },
};
const readSystemAlerts = buildAlerts(readSystemAlertState);
assert.equal(
  readSystemAlerts.find(
    (alert) => alert.id === "message-system-alert-fixture",
  )?.unread,
  false,
);
assert.equal(
  readSystemAlerts.find(
    (alert) => alert.id === "message-personal-system-alert-fixture",
  )?.unread,
  false,
);
assert.match(alerts, /markGroupFeedRead\(visibleUnreadEventIds\)/);
assert.match(alerts, /activityReadAtByCategory/);
assert.match(alerts, /visibleActivityReadCursors/);
assert.match(
  alerts,
  /if \(filter === "all"\) return unreadEventIds/,
  "the All tab must still mark every visible unread group event",
);
assert.match(alerts, /filter === "challenge"/);
assert.match(
  alerts,
  /const feedKey = `\$\{alertScope\}:\$\{state\.currentUserId\}:\$\{state\.group\.id\}`/,
  "the newest-unread tab initializer must be scoped to the alert feed, account, and active group",
);
assert.match(
  alerts,
  /!groupFeedLoaded[\s\S]{0,80}groupFeedLoading/,
  "a reused Alerts route must wait for its account notification feed before selecting its tab",
);
assert.match(groupNotificationHook, /loadedGroupId/);
assert.match(accountNotificationHook, /loadAccountNotificationEvents/);
assert.match(accountNotificationHook, /account:\$\{auth\.user\.id\}:group-notifications/);

console.log(
  "Push validation passed: native and Web Push account lifecycle, PWA service worker, staged canonical outbox, private challenge feed, cursor drain, and per-target retry checkpoints.",
);
