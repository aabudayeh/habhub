import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertPushDeliveryComplete,
  dispatchPushWithBoundedRetry,
  isRetryablePushDeliveryError,
} from "../src/domain/pushDelivery.ts";
import { isAllowedWebPushEndpoint } from "../supabase/functions/_shared/web-push-endpoint.ts";

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
const receiptWorker = read("supabase/functions/push-receipts/index.ts");
const receiptMigration = read(
  "supabase/migrations/202609040001_expo_push_receipts.sql",
);
const trustedWebPushMigration = read(
  "supabase/migrations/202609040004_trusted_web_push_endpoints.sql",
);
const supabaseConfig = read("supabase/config.toml");
const deploymentRunbook = read("docs/DEPLOYMENT.md");
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
const socialOriginMigration = read(
  "supabase/migrations/202608300003_social_notification_origin.sql",
);
const promptSocialMigration = read(
  "supabase/migrations/202608300004_prompt_social_push_dispatch.sql",
);
const challengeRankMigration = read(
  "supabase/migrations/202608270005_challenge_rank_rewards.sql",
);
const durablePushWorker = read(
  "supabase/functions/challenge-notifications/index.ts",
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
  layout.indexOf(
    "const queue = (response: Notifications.NotificationResponse)",
    layout.indexOf("const pushRegistrationUserId"),
  ),
);
assert.doesNotMatch(remoteLifecycle, /tutorialActive/);
assert.match(remoteLifecycle, /NativeAppState\.addEventListener/);
assert.match(layout, /addNotificationResponseReceivedListener/);
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
assert.match(
  alerts,
  /latestUnread\?\.category === "achievement"[\s\S]{0,180}unreadBadgeRef\.current \? "badges" : "all"/,
);
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
assert.match(
  edge,
  /\.select\("user_id, token, preferences, platform, updated_at"\)/,
  "native delivery must retain the exact registration version selected before the provider request",
);
assert.match(
  edge,
  /\.select\([\s\S]{0,40}"user_id, endpoint, p256dh, auth, expiration_time, preferences, updated_at"[\s\S]{0,20}\)/,
  "Web Push delivery must retain the owner, key material, and registration version selected before the provider request",
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
assert.match(
  expoChatPersonalization,
  /data: \{ \.\.\.recipientEvent\.data, accountId: item\.userId \}/,
  "native push routes must remain scoped to the receiving account",
);
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
const acceptanceHardening = receiptMigration.slice(
  0,
  receiptMigration.indexOf("create table if not exists public.expo_push_receipts"),
);
assert.match(
  acceptanceHardening,
  /alter table public\.push_token_dispatch_acceptances[\s\S]{0,100}add column if not exists user_id uuid/,
);
assert.match(
  acceptanceHardening,
  /registration_owners[\s\S]{0,300}public\.device_push_tokens[\s\S]{0,300}public\.web_push_subscriptions/,
  "legacy checkpoints must consider both native and browser registration owners",
);
assert.match(
  acceptanceHardening,
  /owner\.updated_at <= acceptance\.accepted_at/,
  "legacy ownership may be backfilled only from a registration that is no newer than its checkpoint",
);
assert.match(
  acceptanceHardening,
  /delete from public\.push_token_dispatch_acceptances acceptance[\s\S]{0,100}acceptance\.user_id is null/,
  "unprovable legacy ownership must be discarded before enforcing the owner",
);
assert.match(acceptanceHardening, /alter column user_id set not null/);
assert.match(
  acceptanceHardening,
  /foreign key \(user_id\) references public\.profiles\(id\) on delete cascade/,
);
assert.match(
  acceptanceHardening,
  /primary key \(event_key, user_id, token\)/,
);
assert.match(edge, /priorAcceptances/);
assert.match(edge, /alreadyAccepted/);
assert.match(edge, /acceptedTickets/);
const acceptanceRead = edge.slice(
  edge.indexOf("const { data: priorAcceptances"),
  edge.indexOf("const expoEligible"),
);
assert.match(acceptanceRead, /\.select\("user_id, token"\)/);
assert.match(acceptanceRead, /\.in\([\s\S]{0,40}"user_id"/);
assert.match(acceptanceRead, /\.in\([\s\S]{0,40}"token"/);
assert.match(
  acceptanceRead,
  /`\$\{item\.user_id as string\}:\$\{item\.token as string\}`[\s\S]{0,160}`\$\{item\.userId\}:\$\{item\.token\}`/,
  "retry suppression must be scoped to both registration owner and token",
);
assert.match(
  edge,
  /terminalExpoTicketErrors = new Set\(\[[\s\S]{0,240}"MessageTooBig"[\s\S]{0,160}"InvalidCredentials"/,
  "non-retryable Expo ticket errors must be classified explicitly",
);
assert.match(edge, /expoTicketDisposition\(ticket\) !== "terminal"/);
assert.doesNotMatch(
  edge,
  /terminalCheckpointTokens|staleTokens/,
  "stale registrations must not be checkpointed separately from their exact SQL delete",
);
assert.ok(
  (edge.match(/onConflict: "event_key,user_id,token"/g) ?? []).length >= 2,
  "every direct acceptance writer must include the registration owner in its conflict key",
);
assert.match(edge, /gateway_terminal:/);
assert.match(
  edge,
  /const transient = tickets\.find\([\s\S]{0,160}expoTicketDisposition\(ticket\) === "retry"/,
  "only retryable Expo ticket errors may release the canonical event claim",
);
assert.match(edge, /record_expo_push_ticket_acceptances/);
assert.ok(
  edge.indexOf("record_expo_push_ticket_acceptances") <
    edge.indexOf("const transient = tickets.find"),
  "accepted ticket IDs and per-token acceptance must commit before a later ticket failure throws",
);
assert.match(
  edge,
  /expoTicketDisposition\(ticket\) !== "accepted"[\s\S]{0,240}normalizedString\(ticket\.id, 200\)[\s\S]{0,300}ticketId,\s*token: batch\[index\]\.to,\s*userId: expoEligible\[offset \+ index\]\.userId/,
  "every Expo-accepted message must retain its matching receipt ID and token",
);

assert.match(
  receiptMigration,
  /create table if not exists public\.expo_push_receipts/,
);
assert.match(
  receiptMigration,
  /registration_updated_at timestamptz not null/,
  "delayed receipts must retain the registration version originally selected",
);
assert.match(
  receiptMigration,
  /user_id uuid not null references public\.profiles\(id\) on delete cascade/,
  "receipt diagnostics must be deleted with their owning account",
);
assert.match(
  receiptMigration,
  /alter table public\.expo_push_receipts enable row level security[\s\S]{0,180}revoke all on table public\.expo_push_receipts[\s\S]{0,180}grant select, insert, update, delete[\s\S]{0,120}service_role/,
  "receipt tickets and tokens must remain service-only behind RLS",
);
assert.match(
  receiptMigration,
  /record_expo_push_ticket_acceptances[\s\S]{0,5200}insert into public\.expo_push_receipts[\s\S]{0,2400}insert into public\.push_token_dispatch_acceptances/,
  "ticket and dispatch-acceptance writes must share one atomic RPC",
);
assert.match(
  edge,
  /ticketId,[\s\S]{0,180}userId: expoEligible\[offset \+ index\]\.userId,[\s\S]{0,100}updatedAt: expoEligible\[offset \+ index\]\.updatedAt/,
  "every accepted Expo ticket must checkpoint its observed owner and registration version",
);
assert.match(
  receiptMigration,
  /v_registration_updated_at := \(v_item ->> 'updatedAt'\)::timestamptz[\s\S]{0,1600}registration_updated_at[\s\S]{0,500}v_registration_updated_at/,
);
assert.match(
  receiptMigration,
  /if v_inserted = 1 then[\s\S]{0,600}on conflict \(event_key, user_id, token\) do update[\s\S]{0,220}greatest\([\s\S]{0,180}accepted_at/,
  "a distinct newer ticket must advance the owner-scoped acceptance checkpoint",
);
assert.match(
  receiptMigration,
  /ambiguous network retry with the same Expo ticket[\s\S]{0,700}on conflict \(event_key, user_id, token\) do nothing/,
  "replaying the same ticket write must not supersede its own receipt identity",
);
assert.match(receiptMigration, /v_now \+ interval '15 minutes'/);
assert.match(receiptMigration, /v_now \+ interval '24 hours'/);
assert.match(receiptMigration, /for update skip locked/);
assert.match(receiptMigration, /least\(coalesce\(p_limit, 500\), 1000\)/);
assert.match(receiptMigration, /lease_until = clock_timestamp\(\) \+ interval '3 minutes'/);
assert.match(
  receiptMigration,
  /v_status = 'retry'[\s\S]{0,1200}3600[\s\S]{0,300}power\(/,
  "unavailable receipts must use bounded exponential backoff",
);
assert.match(receiptMigration, /delivery_action in \('poll', 'resend'\)/);
assert.match(receiptMigration, /'resend_complete'/);
assert.match(
  receiptMigration,
  /v_status = 'resend'[\s\S]{0,260}v_error_code <> 'MessageRateExceeded'/,
  "only the retryable Expo provider rate-limit receipt may enter resend",
);
assert.match(
  receiptMigration,
  /acceptance\.accepted_at into v_acceptance_at[\s\S]{0,380}v_acceptance_at = v_receipt\.accepted_at/,
  "a delayed receipt may reopen delivery only while its exact acceptance is still current",
);
assert.match(
  receiptMigration,
  /token\.token = v_receipt\.token[\s\S]{0,120}token\.user_id = v_receipt\.user_id[\s\S]{0,120}token\.updated_at = v_receipt\.registration_updated_at[\s\S]{0,1800}delete from public\.push_token_dispatch_acceptances/,
  "rate-limit recovery must preserve the owner and observed registration-version fence before deleting acceptance",
);
assert.match(
  receiptMigration,
  /update public\.push_dispatch_events event[\s\S]{0,160}dispatched_at = null[\s\S]{0,300}delete from public\.push_events claim/,
  "a safe resend transition must reopen the canonical outbox and its global claim",
);
assert.match(
  receiptMigration,
  /v_outbox_category = 'chat'[\s\S]{0,300}update public\.messages message[\s\S]{0,120}push_dispatched_at = null/,
  "chat receipt recovery must reopen the relational message marker in the same SQL transaction",
);
assert.match(
  receiptMigration,
  /A resend expiry must close its per-target hole[\s\S]{0,900}insert into public\.push_token_dispatch_acceptances[\s\S]{0,700}delivery_action = 'resend'[\s\S]{0,500}on conflict on constraint push_token_dispatch_acceptances_pkey do nothing/,
  "an exhausted resend must be checkpointed before its reopened outbox can return to the ordinary drain",
);
assert.match(
  receiptMigration,
  /v_error_code = 'DeviceNotRegistered'[\s\S]{0,300}delete from public\.device_push_tokens[\s\S]{0,260}token\.user_id = v_receipt\.user_id[\s\S]{0,120}token\.updated_at = v_receipt\.registration_updated_at/,
  "a stale receipt may delete only the exact owner and version selected for send",
);
const exactStaleCleanup = receiptMigration.slice(
  receiptMigration.indexOf(
    "create or replace function public.delete_exact_stale_push_registrations",
  ),
  receiptMigration.indexOf("-- One RPC makes an Expo ticket"),
);
assert.match(exactStaleCleanup, /language plpgsql[\s\S]{0,80}security definer/);
assert.match(
  exactStaleCleanup,
  /delete from public\.device_push_tokens token[\s\S]{0,220}token\.token = v_token[\s\S]{0,100}token\.user_id = v_user_id[\s\S]{0,100}token\.updated_at = v_updated_at/,
);
assert.match(
  exactStaleCleanup,
  /delete from public\.web_push_subscriptions subscription[\s\S]{0,320}subscription\.endpoint = v_endpoint[\s\S]{0,100}subscription\.user_id = v_user_id[\s\S]{0,100}subscription\.updated_at = v_updated_at[\s\S]{0,100}subscription\.p256dh = v_p256dh[\s\S]{0,100}subscription\.auth = v_auth/,
  "Web Push cleanup must compare owner, version, and both observed key values",
);
assert.ok(
  (exactStaleCleanup.match(/if v_deleted = 1 then[\s\S]{0,220}insert into public\.push_token_dispatch_acceptances/g) ?? []).length === 2,
  "stale checkpoints must be inserted only after the matching native or Web registration was deleted",
);
assert.ok(
  (exactStaleCleanup.match(/on conflict \(event_key, user_id, token\) do nothing/g) ?? []).length === 2,
);
assert.match(exactStaleCleanup, /'changedRegistrations', v_changed/);
assert.match(
  receiptMigration,
  /revoke all on function public\.delete_exact_stale_push_registrations\(text, jsonb\)[\s\S]{0,100}from public, anon, authenticated[\s\S]{0,120}grant execute[\s\S]{0,100}to service_role/,
  "only the service worker may invoke exact stale-registration cleanup",
);
const expoStaleDelivery = edge.slice(
  edge.indexOf("const staleTargets = tickets.flatMap"),
  edge.indexOf("const transient = tickets.find"),
);
assert.match(
  expoStaleDelivery,
  /delete_exact_stale_push_registrations[\s\S]{0,300}kind: "expo"[\s\S]{0,80}userId: target\.userId[\s\S]{0,80}token: target\.token[\s\S]{0,80}updatedAt: target\.updatedAt/,
);
assert.match(
  expoStaleDelivery,
  /changedStaleRegistrationCount\(staleCleanup\.data\) > 0[\s\S]{0,100}Push registration changed during delivery/,
);
const webStaleDelivery = edge.slice(
  edge.indexOf("const staleTargets = outcomes.flatMap"),
  edge.indexOf("const transient = outcomes.find"),
);
assert.match(
  webStaleDelivery,
  /delete_exact_stale_push_registrations[\s\S]{0,360}kind: "web"[\s\S]{0,80}userId: target\.userId[\s\S]{0,80}endpoint: target\.endpoint[\s\S]{0,80}p256dh: target\.p256dh[\s\S]{0,80}auth: target\.auth[\s\S]{0,80}updatedAt: target\.updatedAt/,
);
assert.match(
  webStaleDelivery,
  /changedStaleRegistrationCount\(staleCleanup\.data\) > 0[\s\S]{0,100}Push registration changed during delivery/,
);
assert.doesNotMatch(
  edge,
  /\.from\("device_push_tokens"\)\s*\.delete\(\)|\.from\("web_push_subscriptions"\)\s*\.delete\(\)/,
  "provider responses must never trigger a broad client-side registration delete",
);
assert.match(receiptMigration, /interval '7 days'/);
assert.match(
  receiptMigration,
  /web_personal_notification_worker_url[\s\S]{0,1800}regexp_replace\([\s\S]{0,240}'\/push-receipts'/,
  "the receipt worker URL must derive from the validated deployed Web worker URL",
);
assert.match(receiptMigration, /web_personal_notification_worker_secret/);
assert.match(receiptMigration, /expo-push-receipts-every-five-minutes/);
assert.match(receiptMigration, /'\*\/5 \* \* \* \*'/);
assert.doesNotMatch(
  receiptMigration,
  /'40001'/,
  "deterministic receipt lease conflicts must not masquerade as serialization failures",
);

assert.match(receiptWorker, /PERSONAL_NOTIFICATION_WORKER_SECRET/);
assert.match(receiptWorker, /constantTimeEqual/);
assert.match(receiptWorker, /claim_due_expo_push_receipts/);
assert.match(
  receiptWorker,
  /https:\/\/exp\.host\/--\/api\/v2\/push\/getReceipts/,
);
assert.match(receiptWorker, /ids: pollRows\.map\(\(item\) => item\.ticket_id\)/);
assert.match(receiptWorker, /AbortSignal\.timeout\(20_000\)/);
assert.match(receiptWorker, /Object\.hasOwn\(receipts, item\.ticket_id\)/);
assert.match(receiptWorker, /settle_expo_push_receipts/);
assert.match(receiptWorker, /DeviceNotRegistered|terminal_error/);
assert.match(
  receiptWorker,
  /errorCode === "MessageRateExceeded"[\s\S]{0,120}rateLimitedOutcome/,
  "MessageRateExceeded must become a resend action rather than a terminal receipt",
);
assert.match(
  receiptWorker,
  /new Set\(resendRows\.map\(\(item\) => item\.event_key\)\)[\s\S]{0,300}resendCanonicalEvent/,
  "resends must be grouped and invoked only by durable canonical event key",
);
assert.match(
  receiptWorker,
  /body: JSON\.stringify\(\{ eventKey, receiptLeaseOwner \}\)[\s\S]{0,160}AbortSignal\.timeout\(20_000\)/,
  "the receipt worker must authenticate each canonical resend with its exact durable lease",
);
assert.match(
  receiptWorker,
  /resendCanonicalEvent\(sendPushUrl, service, leaseOwner, eventKey\)/,
);
assert.match(
  receiptWorker,
  /const safelyComplete =[\s\S]{0,120}payload\.accepted === true \|\| payload\.stale === true/,
  "only an accepted/deduplicated or expiry-suppressed canonical response is a completed resend",
);
const resendWorkerBlock = receiptWorker.slice(
  receiptWorker.indexOf("if (resendRows.length)"),
  receiptWorker.indexOf("const { data: settlementData"),
);
assert.match(
  resendWorkerBlock,
  /result\?\.complete[\s\S]{0,160}status: "resend_complete"[\s\S]{0,260}CanonicalResendFailed/,
  "failed or in-flight canonical resends must remain retryable",
);
assert.doesNotMatch(
  receiptWorker,
  /console\.(?:log|error|warn)\([^\n]*(?:token|claimed|receipt)/i,
  "receipt workers must not log private ticket or token payloads",
);
assert.match(
  supabaseConfig,
  /\[functions\.push-receipts\][\s\S]{0,160}verify_jwt = false/,
);
assert.match(deploymentRunbook, /functions deploy push-receipts --no-verify-jwt/);
assert.match(deploymentRunbook, /202609040001_expo_push_receipts\.sql/);
assert.match(
  deploymentRunbook,
  /Quiesce group push dispatch[\s\S]{0,500}emitters_active = false/,
  "the incompatible acceptance-writer upgrade must have an explicit coordinated rollout fence",
);
assert.match(
  deploymentRunbook,
  /202609040001_expo_push_receipts\.sql[\s\S]{0,800}202609040004_trusted_web_push_endpoints\.sql/,
  "the coordinated rollout must apply every coupled migration through the trusted Web Push endpoint contract",
);
assert.match(
  deploymentRunbook,
  /old `send-push` revision is not[\s\S]{0,180}migration `202609040001`[\s\S]{0,360}Keep dispatch quiesced/,
  "the runbook must identify the incompatible old acceptance writer",
);
assert.match(
  deploymentRunbook,
  /resume group push dispatch[\s\S]{0,120}emitters_active = true/,
  "dispatch may resume only after the matching workers are deployed and smoke-tested",
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
assert.equal(
  isAllowedWebPushEndpoint(
    "https://fcm.googleapis.com/wp/registration/accepted",
  ),
  true,
);
assert.equal(
  isAllowedWebPushEndpoint(
    "https://updates.push.services.mozilla.com/wpush/v2/accepted",
  ),
  true,
);
assert.equal(
  isAllowedWebPushEndpoint(
    "https://web.push.apple.com/QHaccepted",
  ),
  true,
);
assert.equal(
  isAllowedWebPushEndpoint(
    "https://wns2-am3p.notify.windows.com/w/?token=accepted",
  ),
  true,
);
for (const endpoint of [
  "https://fcm.googleapis.com.evil.example/steal",
  "https://updates.push.services.mozilla.com@evil.example/steal",
  "https://web.push.apple.com:8443/steal",
  "https://push.apple.com/unsupported-apex",
  "https://127.0.0.1/internal",
  "https://[::1]/internal",
]) {
  assert.equal(
    isAllowedWebPushEndpoint(endpoint),
    false,
    `untrusted Web Push endpoint must be rejected: ${endpoint}`,
  );
}
assert.match(edge, /isAllowedWebPushEndpoint\(target\.endpoint\)/);
assert.doesNotMatch(edge, /const nonPublicHostname/);
assert.match(
  trustedWebPushMigration,
  /web_push_subscriptions_trusted_endpoint_check[\s\S]{0,900}fcm\\\.googleapis\\\.com[\s\S]{0,300}push\\\.apple\\\.com[\s\S]{0,300}notify\\\.windows\\\.com/,
  "the database must enforce the same bounded browser-provider endpoint allowlist",
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
assert.match(edge, /isAllowedWebPushEndpoint/);
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
assert.match(
  recapScreen,
  /const FEED_PAGE_SIZE = Platform\.OS === "web" \? 30 : 12/,
  "the native feed must mount a smaller first batch without reducing the web feed",
);
assert.match(
  recapScreen,
  /useResponsiveRecapFeed\(\s*feedScopeKey,\s*deriveFeed,\s*feedAuthority,?\s*\)/,
  "native feed state must use the responsive privacy-authorized cached derivation path",
);
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
  /const args = \{[\s\S]{0,260}p_reaction:[\s\S]{0,100}p_surface:[\s\S]{0,160}\.rpc\("set_group_social_reaction_v2", args\)/,
  "the client must use the server-owned reaction mutation instead of a direct RLS upsert",
);
assert.doesNotMatch(
  groupSocialClient,
  /from\("group_social_reactions"\)[\s\S]{0,160}\.upsert\(/,
  "the client must not fall back to the failing direct reaction upsert",
);
assert.match(
  promptSocialMigration,
  /create or replace function public\.set_group_social_reaction_v2[\s\S]{0,600}public\.set_group_social_reaction\(/i,
  "the prompt reaction boundary must preserve the authoritative social mutation",
);
assert.match(
  promptSocialMigration,
  /'social-reaction:'[\s\S]{0,360}from public\.push_dispatch_events[\s\S]{0,180}event\.dispatcher_id = auth\.uid\(\)/i,
  "the prompt reaction result must expose only the actor-owned canonical outbox key",
);
assert.match(
  promptSocialMigration,
  /create or replace function public\.add_group_social_comment_v2[\s\S]{0,220}security invoker[\s\S]{0,500}v_actor_id uuid := auth\.uid\(\)[\s\S]{0,1000}insert into public\.group_social_comments/i,
  "prompt comments must derive their actor on the server and retain table RLS",
);
assert.match(
  promptSocialMigration,
  /grant execute on function public\.set_group_social_reaction_v2[\s\S]{0,120}authenticated/i,
);
assert.match(
  promptSocialMigration,
  /grant execute on function public\.add_group_social_comment_v2[\s\S]{0,120}authenticated/i,
);
assert.match(
  promptSocialMigration,
  /after insert or update of reaction, source_surface on public\.group_social_reactions/i,
  "a destination-surface change must create the same canonical notification path",
);
assert.match(groupSocialClient, /\.rpc\("set_group_social_reaction_v2"/);
assert.match(groupSocialClient, /\.rpc\("add_group_social_comment_v2"/);
assert.match(groupSocialClient, /promptSocialRpcUnavailable/);
const exactSocialDispatch = cloud.slice(
  cloud.indexOf("export function dispatchCommittedGroupPushEvent"),
  cloud.indexOf("export async function approveCloudGroupMember"),
);
assert.match(exactSocialDispatch, /dispatchPushWithBoundedRetry/);
assert.match(exactSocialDispatch, /functions\.invoke\("send-push"/);
assert.match(exactSocialDispatch, /body: \{ eventKey: stableEventKey \}/);
assert.doesNotMatch(
  exactSocialDispatch,
  /recipient|title|copy|reaction/,
  "the client may dispatch only the committed event key, never recipient or copy",
);
assert.match(
  groupSocialHook,
  /saved\.pushEventKey[\s\S]{0,120}dispatchCommittedGroupPushEvent\(saved\.pushEventKey\)[\s\S]{0,160}flushPendingGroupPushEvents/,
  "social mutations must request their exact committed push immediately and retain the durable-drain fallback",
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
assert.match(
  receiptMigration,
  /push_dispatch_events_category_check[\s\S]{0,240}category in \('chat', 'metric', 'lead', 'winner', 'membership', 'challenge'\)/,
  "chat must be a first-class durable canonical outbox category",
);
assert.match(
  canonicalChat,
  /from\("push_dispatch_events"\)[\s\S]{0,220}upsert\(outboxInput[\s\S]{0,120}onConflict: "event_key"/,
  "authenticated chat dispatch must materialize only its server-derived committed message into the outbox",
);
assert.match(
  canonicalChat,
  /outbox\.group_id !== groupId[\s\S]{0,400}outboxData\.messageId !== clientMessageId[\s\S]{0,100}outboxData\.senderId !== senderId/,
  "a colliding chat key must never adopt another message or sender's canonical row",
);
assert.match(
  edge,
  /internalServiceRequest[\s\S]{0,2200}from\("expo_push_receipts"\)[\s\S]{0,400}delivery_action", "resend"/,
  "the service resend path must derive its target set from durable receipt state",
);
assert.match(
  edge,
  /receiptLeaseOwner && !internalServiceRequest[\s\S]{0,120}Receipt resend lease is service-only/,
  "clients must never be able to select an internal receipt lease",
);
const exactReceiptLeaseBlock = edge.slice(
  edge.indexOf("const pendingResendRead"),
  edge.indexOf("if (stored.id)", edge.indexOf("const pendingResendRead")),
);
assert.match(
  exactReceiptLeaseBlock,
  /pendingResendRead\.data\?\.length && !receiptLeaseOwner[\s\S]{0,240}Canonical resend requires its durable lease/,
  "a generic internal drain must not consume receipt-owned resend work",
);
assert.match(
  exactReceiptLeaseBlock,
  /\.eq\("lease_owner", receiptLeaseOwner\)[\s\S]{0,100}\.gt\("lease_until", new Date\(\)\.toISOString\(\)\)/,
  "each resend invocation must select only rows currently leased by its caller",
);
assert.match(
  exactReceiptLeaseBlock,
  /pendingResends[\s\S]{0,700}registrationVersionKey[\s\S]{0,160}registration_updated_at/,
  "canonical resend target identity must come only from the caller's actively leased durable rows",
);
assert.match(
  edge.slice(
    edge.indexOf("const discoveredTargets"),
    edge.indexOf("if (!targets.length)", edge.indexOf("const discoveredTargets")),
  ),
  /discoveredTargets\.filter[\s\S]{0,500}registrationVersionKey[\s\S]{0,200}target\.updatedAt/,
  "canonical resend delivery must be limited to exact owner/token/registration versions",
);
assert.match(edge, /event\.eventType === "social_reaction"[\s\S]{0,180}socialReactions/);
assert.match(socialOriginMigration, /source_surface in \('feed', 'leaderboard_log'\)/);
assert.match(
  socialOriginMigration,
  /create or replace function public\.set_group_social_reaction\([\s\S]{0,180}p_surface text/,
);
assert.match(durablePushWorker, /from\("push_dispatch_events"\)/);
assert.doesNotMatch(
  durablePushWorker,
  /\.eq\("category", "challenge"\)/,
  "the server retry pass must not strand social interaction outbox rows",
);
assert.match(
  socialOriginMigration,
  /v_surface = 'leaderboard_log'[\s\S]{0,1200}'route', '\/leaderboard-detail'/,
);
assert.match(
  socialOriginMigration,
  /insert into public\.push_dispatch_events[\s\S]{0,600}'social_reaction'/,
  "social reactions must enter the canonical closed-app push outbox",
);
assert.match(
  socialOriginMigration,
  /insert into public\.push_dispatch_events[\s\S]{0,600}'social_comment'/,
  "social comments must enter the canonical closed-app push outbox",
);
assert.match(notifications, /title="Feed interactions"/);
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
assert.match(alerts, /commitVisibleTabRef\.current\(filterRef\.current\)/);
assert.match(alerts, /activityReadAtByCategory/);
assert.match(alerts, /activityReadCursorsForFilter/);
assert.match(
  alerts,
  /if \(targetFilter === "all"\) return/,
  "the All tab must not clear category tabs the user never opened",
);
assert.match(alerts, /badgeNotificationReadSignatureByScope/);
assert.match(alerts, /hasUnreadBadges \? <View style=\{styles\.filterUnreadDot\}/);
assert.match(
  alerts,
  /interactionSurface === "leaderboard_log"[\s\S]{0,550}pathname: "\/leaderboard-detail"/,
);
assert.match(alerts, /pathname: "\/\(tabs\)\/recapfeed"/);
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
