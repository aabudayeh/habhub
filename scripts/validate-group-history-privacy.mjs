import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateVisibleMetricEntries,
  applySharedMetricPrivacyFences,
  authoritativeSharedExactValue,
  canUseCachedSharedRaw,
  projectionSurvivesSharedMetricPrivacyFences,
} from "../src/domain/sharedMetricPrivacy.ts";
import {
  sharedLeaderboardLogEntries,
  sharedWorkoutBreakdownEntries,
  withoutSharedWorkoutParentDetails,
} from "../src/domain/sharedLeaderboardLogs.ts";
import { accountOwnedCollections } from "../src/domain/accountCollections.ts";
import { scopeCachedGroupActivity } from "../src/domain/groupActivityCacheScope.ts";
import { memberDisplayName } from "../src/domain/members.ts";
import {
  buildMetricLogShareMessage,
  parseChatShareMessage,
} from "../src/domain/social.ts";
import {
  beginSocialReactionBurst,
  canonicalizeLegacyMetricSocialTargets,
  confirmSocialReactionBurst,
  finishSocialReactionBurst,
  groupSocialTargetKey,
  metricEntrySocialTarget,
} from "../src/domain/groupSocialTarget.ts";
import {
  forcedGroupActivityRequestCrossedGroupBoundary,
  groupActivityFallbackMembershipIsActive,
  groupActivitySnapshotProvesMembershipLoss,
  groupActivityRangeAlreadyLoaded,
  shouldRequeueSupersededGroupActivity,
  shouldCommitGroupActivityResponse,
} from "../src/domain/groupActivityRefresh.ts";
import { periodDates } from "../src/domain/leaderboard.ts";
import { recapFeedItemIdForSocialTarget } from "../src/domain/recaps.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const reactionBurst = new Map();
const mutationKey = "group\0metric-entry\0member";
const optimisticHeart = { reaction: "heart" };
const confirmedCheer = { reaction: "cheer" };
beginSocialReactionBurst(reactionBurst, mutationKey, undefined);
beginSocialReactionBurst(reactionBurst, mutationKey, optimisticHeart);
assert.equal(
  reactionBurst.has(mutationKey),
  true,
  "a confirmed removal must remain distinguishable from no reaction burst",
);
assert.equal(
  reactionBurst.get(mutationKey),
  undefined,
  "a rapid second tap must not replace the server-confirmed burst baseline",
);
confirmSocialReactionBurst(reactionBurst, mutationKey, confirmedCheer);
beginSocialReactionBurst(reactionBurst, mutationKey, optimisticHeart);
assert.equal(
  reactionBurst.get(mutationKey),
  confirmedCheer,
  "a later failed tap must roll back to the latest confirmed write",
);
finishSocialReactionBurst(reactionBurst, mutationKey);
assert.equal(
  reactionBurst.has(mutationKey),
  false,
  "the confirmed reaction baseline must be released after the serialized burst",
);

assert.equal(
  groupActivityRangeAlreadyLoaded({
    requestedSince: "2026-08-01",
    loadedSince: "2026-07-01",
    force: false,
  }),
  true,
  "an ordinary covered range should remain an idempotent no-op",
);
assert.equal(
  groupActivityRangeAlreadyLoaded({
    requestedSince: "2026-08-01",
    loadedSince: "2026-07-01",
    force: true,
  }),
  false,
  "a detail rehydration must bypass cached coverage",
);
assert.equal(
  shouldCommitGroupActivityResponse({
    responseVersion: 7,
    lastVersion: 7,
    extendsCoverage: false,
    force: false,
  }),
  false,
  "an ordinary same-version response should not repaint the app",
);
assert.equal(
  shouldCommitGroupActivityResponse({
    responseVersion: 7,
    lastVersion: 7,
    extendsCoverage: false,
    force: true,
  }),
  true,
  "a forced same-version response must restore cloud-only item rows",
);
assert.equal(
  groupActivitySnapshotProvesMembershipLoss({
    snapshotRpcMissing: false,
    snapshotPresent: false,
  }),
  true,
  "an installed activity RPC returning no row is definitive membership loss",
);
assert.equal(
  groupActivitySnapshotProvesMembershipLoss({
    snapshotRpcMissing: true,
    snapshotPresent: false,
  }),
  false,
  "a rolling migration fallback must not be mistaken for membership loss",
);
assert.equal(
  groupActivityFallbackMembershipIsActive("active"),
  true,
  "the compatibility reader must accept a proved active membership",
);
assert.equal(
  groupActivityFallbackMembershipIsActive("pending"),
  false,
  "a pending membership must not authorize compatibility activity reads",
);
assert.equal(
  groupActivityFallbackMembershipIsActive(undefined),
  false,
  "an absent membership must fail closed on the compatibility reader",
);
assert.equal(
  forcedGroupActivityRequestCrossedGroupBoundary({
    force: true,
    sameGroup: false,
  }),
  true,
  "a forced detail request must be cancelled when its group changes",
);
assert.equal(
  forcedGroupActivityRequestCrossedGroupBoundary({
    force: false,
    sameGroup: false,
  }),
  false,
  "an ordinary stale refresh can be discarded without surfacing a detail failure",
);
assert.equal(
  shouldRequeueSupersededGroupActivity({ force: true, sameGroup: true }),
  true,
  "a same-group forced response must retry when a concurrent hydration supersedes it",
);
assert.equal(
  shouldRequeueSupersededGroupActivity({ force: true, sameGroup: false }),
  false,
  "a forced response must never cross a group boundary",
);
const boundedOverallHistory = periodDates("overall", "2026-08-28", 1);
assert.equal(
  boundedOverallHistory.length,
  730,
  "an explicit cold Overall detail request must reuse the existing 730-day history bound",
);
assert.equal(
  recapFeedItemIdForSocialTarget(
    [
      {
        id: "entry:local-food",
        socialTarget: { type: "metric_entry", id: "cloud-food" },
      },
    ],
    "metric_entry",
    "cloud-food",
  ),
  "entry:local-food",
  "a notification's canonical target must resolve to the exact rendered feed card",
);
assert.equal(
  boundedOverallHistory.at(-1),
  "2026-08-28",
  "the bounded Overall detail request must end on its selected anchor",
);

const cloud = read("src/cloud/groupCloud.ts");
const provider = read("src/cloud/CloudSyncProvider.tsx");
const group = read("app/(tabs)/group.tsx");
const leaderboardDetail = read("app/leaderboard-detail.tsx");
const chat = read("app/(tabs)/chat.tsx");
const recapScreen = read("app/recap.tsx");
const recapFeed = read("src/domain/recaps.ts");
const groupSocial = read("src/cloud/groupSocial.ts");
const socialHook = read("src/cloud/useGroupSocialEngagement.ts");
const log = read("app/(tabs)/log.tsx");
const appProvider = read("src/state/AppProvider.tsx");
const accountCollections = read("src/domain/accountCollections.ts");
const groupActivityCacheTypes = read(
  "src/storage/groupActivityCache.types.ts",
);
const groupActivityCacheNative = read(
  "src/storage/groupActivityCache.native.ts",
);
const health = read("src/domain/health.ts");
const foregroundHealth = read("src/health/HealthSyncProvider.tsx");
const backgroundHealth = read("src/health/background.native.ts");
const challenge = read("src/components/GroupChallengeEditor.tsx");
const names = read("src/domain/groupNames.ts");
const createGroup = read("app/create-group.tsx");
const privacyMigration = read(
  "supabase/migrations/202608130003_harden_status_projection_privacy.sql",
);
const compactProjectionMigration = read(
  "supabase/migrations/202608130004_preserve_verified_compact_exact.sql",
);
const explicitProjectionMigration = read(
  "supabase/migrations/202608130005_require_explicit_projection_v2.sql",
);
const cacheFenceMigration = read(
  "supabase/migrations/202608130006_metric_privacy_cache_fences.sql",
);
const passiveWalkingPushMigration = read(
  "supabase/migrations/202608260001_suppress_passive_walking_push.sql",
);
const googleWorkoutDetailMigration = read(
  "supabase/migrations/202608260002_google_health_workout_detail_projection.sql",
);
const durableSocialMigration = read(
  "supabase/migrations/202608280001_durable_group_log_social_identity.sql",
);
const socialNotificationMigration = read(
  "supabase/migrations/202608300002_group_feed_interaction_notifications.sql",
);
const pushWorker = read("supabase/functions/send-push/index.ts");
const alertsScreen = read("app/alerts.tsx");
const groupNotificationHook = read("src/cloud/useGroupNotificationEvents.ts");
const appRoot = read("app/_layout.tsx");
const webPushWorker = read("public/habhub-sw.js");
const cachedGroupActivityBlock = provider.slice(
  provider.indexOf("function cachedGroupActivity("),
  provider.indexOf("function mergeWorkspaceWithoutRegression("),
);
const passiveWalkingLeadFunction = passiveWalkingPushMigration.slice(
  passiveWalkingPushMigration.indexOf(
    "create or replace function public.enqueue_group_lead_push_event",
  ),
);
const compactedImportedDetailFence = cloud.slice(
  cloud.indexOf("const compactedImportedDetailFences"),
  cloud.indexOf("const oldEntries:", cloud.indexOf("const compactedImportedDetailFences")),
);
assert.ok(
  passiveWalkingLeadFunction.startsWith("create or replace function"),
  "the passive walking migration must replace the lead-event RPC",
);

assert.match(cloud, /remoteStatusCount < expectedStatusCount/);
assert.match(provider, /const SHARED_ENTRY_DETAIL_PROJECTION_VERSION = 3/);
assert.match(
  provider,
  /sharedEntryDetailProjectionVersion:\s*SHARED_ENTRY_DETAIL_PROJECTION_VERSION/,
  "a client upgrade must force one bounded workspace backfill for previously omitted shared item details",
);
assert.match(
  cloud,
  /requestedSince < authoritativeEntrySinceDate[\s\S]{0,700}from\("metric_entries"\)[\s\S]{0,260}\.gte\("local_date", requestedSince\)[\s\S]{0,180}\.lt\("local_date", authoritativeEntrySinceDate!\)/,
  "an explicit older Leaderboard range must page its authorized individual logs instead of falling back permanently to a daily total",
);
assert.match(
  cloud,
  /missingSnapshotRpc[\s\S]{0,500}from\("group_members"\)[\s\S]{0,300}\.eq\("user_id", state\.currentUserId\)[\s\S]{0,500}groupActivityFallbackMembershipIsActive/,
  "the RPC compatibility path must independently prove the viewer's active membership before reading activity tables",
);
assert.match(
  cloud,
  /CLOUD_ACTIVITY_ENTRY_SELECT[\s\S]{0,500}client_generated_id[\s\S]{0,500}account_revision/,
  "historical item hydration must request only the detail columns used by the client",
);
assert.match(cloud, /select\("metric_id", \{ count: "exact", head: true \}\)/);
assert.match(cloud, /expectedCoverageDates[\s\S]*fastRecentDates/);
assert.match(provider, /refreshActivity:\s*\([\s\S]{0,120}options\?: RefreshActivityOptions/);
assert.match(
  provider,
  /queuedActivityForceRef[\s\S]{0,900}queuedForce[\s\S]{0,1800}shouldCommitGroupActivityResponse\([\s\S]{0,180}force: queuedForce/,
  "a forced detail request must survive serialized coalescing and bypass the same-version short circuit",
);
assert.match(
  provider,
  /sameGroupBeforeRead[\s\S]{0,350}forcedGroupActivityRequestCrossedGroupBoundary[\s\S]{0,250}Group activity detail refresh was cancelled[\s\S]{0,400}loadCloudGroupActivity/,
  "a forced detail read must reject a group switch before issuing its network request",
);
assert.match(
  provider,
  /queuedActivitySinceRef\.current = undefined;[\s\S]{0,100}queuedActivityForceRef\.current = false;/,
  "group or account cleanup must not leak a queued force bit across the authorization boundary",
);
assert.match(
  provider,
  /queuedActivityGroupIdRef\.current !== requestGroupId/,
  "a detail request queued during a group switch must remain scoped to the new group",
);
assert.match(
  provider,
  /activeOperation\.then\(drainThisGroup/,
  "a detail request queued during a group switch must drain after the old request settles",
);
assert.match(
  provider,
  /activityRefreshOperationGroupRef\.current === requestGroupId[\s\S]{0,120}return activityRefreshPromiseRef\.current/,
  "concurrent detail callers must join the new group's in-flight authorized read",
);
assert.match(provider, /refreshGroupActivity\([\s\S]*sinceDate/);
assert.match(group, /cloud\.refreshActivity\(targetedActivitySince\)/);
assert.match(
  leaderboardDetail,
  /refreshActivity\(targetedActivitySince, \{ force: true \}\)/,
  "Leaderboard detail must rehydrate cloud-only item rows after a restart",
);
assert.match(
  leaderboardDetail,
  /const targetedActivitySince =\s*period === "overall"/,
  "Overall item hydration must use its explicit bounded history start",
);
assert.doesNotMatch(
  leaderboardDetail,
  /SHARED_LEADERBOARD_SUMMARY_START|2000-01-01/,
  "Leaderboard detail must not page raw items from an artificial all-time sentinel",
);
assert.doesNotMatch(
  provider,
  /forcedActivityRangeKeysByGroupRef/,
  "a previous detail read must never authorize a later route visit without a fresh RLS-backed read",
);
assert.match(
  leaderboardDetail,
  /\.catch\(\(\) => \{[\s\S]{0,160}setDetailsRefreshFailed\(true\)/,
  "a failed authorized detail refresh must remain fail-closed",
);
assert.match(
  leaderboardDetail,
  /detailsRefreshFailed[\s\S]*Could not refresh individual logs[\s\S]{0,500}Retry individual logs[\s\S]{0,300}setDetailsRefreshAttempt/,
  "a failed authorized detail refresh must offer a visible retry",
);
assert.match(
  leaderboardDetail,
  /sharedWorkoutBreakdownEntries\([\s\S]{0,100}entry,[\s\S]{0,100}authorizedEntries/,
  "a selected Workout log must associate its independently authorized child rows",
);
assert.match(
  leaderboardDetail,
  /const workoutDetails = workoutBreakdown\.flatMap/,
  "shared workout rows must format their independently authorized child rows",
);
assert.match(
  leaderboardDetail,
  /workoutDetails\.join\(" · "\)/,
  "shared workout rows must render the authorized calorie, duration, and distance breakdown",
);
assert.doesNotMatch(
  leaderboardDetail,
  /entry\.submetricValues\?\.\[(?:metricId|"exercise"|"workout_duration"|"workout_distance")\]/,
  "the detail screen must not trust linked tracker values embedded in a shared Workout parent",
);
assert.match(
  cloud,
  /rawOwnedEntries[\s\S]{0,220}\.map\(withoutSharedWorkoutParentDetails\)/,
  "native relational publishing must strip independently private tracker values from Workout parents",
);
assert.match(
  cloud,
  /remoteEntries[\s\S]{0,160}applySharedMetricPrivacyFences\([\s\S]{0,220}withoutSharedWorkoutParentDetails/,
  "legacy cloud Workout parents must be sanitized again while hydrating group activity",
);
assert.match(
  googleWorkoutDetailMigration,
  /create or replace function public\.sanitize_group_workout_entry_details\(\)[\s\S]*?new\.submetric_values - 'exercise' - 'workout_duration' - 'workout_distance'/,
  "the database must enforce linked Workout privacy below every client",
);
assert.match(
  googleWorkoutDetailMigration,
  /before insert or update on public\.metric_entries[\s\S]{0,120}sanitize_group_workout_entry_details\(\)/,
  "the Workout sanitizer must protect all relational inserts and updates",
);
assert.match(
  googleWorkoutDetailMigration,
  /join public\.group_members membership[\s\S]{0,260}membership\.status = 'active'[\s\S]{0,260}detail_definition\.group_id = membership\.group_id[\s\S]{0,120}detail_definition\.slug = 'exercise'/,
  "Google workout calories must be projected only into an active destination group's configured Active energy tracker",
);
assert.match(
  googleWorkoutDetailMigration,
  /left join public\.google_health_entry_preferences preference[\s\S]*?case when preference\.dismissed then 'private' else preference\.visibility end[\s\S]{0,180}= 'group'/,
  "dismissed or explicitly private Active energy details must not resurrect from a Workout carrier",
);
assert.match(
  googleWorkoutDetailMigration,
  /create or replace function public\.mutate_google_health_food_family_and_project[\s\S]*?public\.mutate_google_health_food_family\([\s\S]*?public\.project_google_health_group_data\(/,
  "entry visibility and dismissal changes must project atomically",
);
assert.match(
  googleWorkoutDetailMigration,
  /create or replace function public\.update_google_health_metric_visibility_and_project[\s\S]*?public\.update_google_health_metric_visibility\([\s\S]*?public\.project_google_health_group_data\(/,
  "metric privacy changes must project atomically",
);
assert.match(
  googleWorkoutDetailMigration,
  /source\.entry ->> 'metricId' in \([\s\S]{0,180}'workout_duration',[\s\S]{0,80}'workout_distance'/,
  "duration and distance details must retain their own independently authorized relational rows",
);
assert.match(
  googleWorkoutDetailMigration,
  /update public\.google_health_connections[\s\S]*next_catchup_at = least[\s\S]*status = 'connected'[\s\S]*refresh_token_ciphertext is not null[\s\S]*health_user_id is not null/,
  "the projector upgrade must use the existing rate-limited catch-up path for connected accounts",
);
assert.match(
  group,
  /period === "overall"[\s\S]*SHARED_LEADERBOARD_SUMMARY_START/,
);
assert.match(group, /calendarPeriodRange\(anchor, gridRange, weekStartsOn\)/);
assert.match(group, /\["week", "Week", "Seven daily cells"\]/);
assert.match(group, /\["month", "Month", "Every day in the selected month"\]/);
assert.match(group, /\["year", "Year", "A compact full-year grid"\]/);
assert.match(group, /Expand all/);
assert.match(group, /Collapse all/);
assert.match(group, /const \[showHistoryOptions, setShowHistoryOptions\] = useState\(false\)/);
assert.match(group, /visible=\{showHistoryOptions\}/);
assert.match(group, /onPress=\{\(\) => setShowHistoryOptions\(true\)\}/);
assert.match(group, /setExpandedGridRows\(visibleGridKeys\)/);
assert.doesNotMatch(group, /styles\.gridRangeChoices|styles\.gridBulkBox/);
assert.match(group, /const cloudStatus = useCloudSyncStatus\(\)/);
assert.match(
  group,
  /cloudStatus === "initializing" && !result[\s\S]{0,8000}Loading saved data…/,
  "initial leaderboard hydration must label only absent results without hiding cached values",
);
assert.doesNotMatch(group, /ActivityIndicator/);
assert.match(group, /useState<string\[]>\(\[\]\)/);
assert.match(group, /sharedLeaderboardHeatmapModel/);
assert.match(group, /const LeaderboardMemberGrid = React\.memo/);
assert.match(group, /const gridModel = useMemo/);
assert.doesNotMatch(group, /rows\.slice\(0, 4\)\.map/);
assert.match(
  group,
  /onSelect=\{\(selectedDate\)[\s\S]{0,500}pathname: "\/leaderboard-detail"/,
  "leaderboard heatmap cells should open leaderboard detail rather than friend comparison",
);
assert.equal(
  (group.match(/pathname: "\/member\/\[id\]"/g) ?? []).length,
  1,
  "the leaderboard card should define one friend-comparison action",
);
assert.equal(
  (group.match(/onPress=\{openMemberComparison\}/g) ?? []).length,
  2,
  "only the member avatar and member name should invoke friend comparison",
);
assert.match(
  group,
  /onPress=\{openMemberComparison\}[\s\S]{0,180}style=\{styles\.memberAvatarLink\}/,
);
assert.match(
  group,
  /onPress=\{openMemberComparison\}[\s\S]{0,180}style=\{styles\.memberNameLink\}/,
);
assert.doesNotMatch(
  group,
  /memberOriginalLabel/,
  "Leaderboard cards should show the chosen nickname without repeating the profile name below it",
);
assert.doesNotMatch(
  leaderboardDetail,
  /memberOriginalLabel/,
  "Leaderboard details should preserve useful role and sync metadata without repeating the profile name",
);
const nicknameFixture = {
  group: { id: "group-a" },
  settings: {
    memberNicknamesByGroup: {
      "group-a": { friend: "Walking buddy" },
      "group-b": { friend: "Other group alias" },
    },
    memberNicknames: { friend: "Legacy alias" },
  },
};
assert.equal(
  memberDisplayName(nicknameFixture, { id: "friend", name: "Profile Name" }),
  "Walking buddy",
  "member names must use the viewer's nickname for the active group",
);
assert.equal(
  memberDisplayName(
    { ...nicknameFixture, group: { id: "group-c" } },
    { id: "friend", name: "Profile Name" },
  ),
  "Legacy alias",
  "legacy aliases remain a migration fallback when no group alias exists",
);
assert.doesNotMatch(
  group,
  /tap a shared day for details/i,
  "expanded calendars should not spend a row repeating the range and tap hint",
);
assert.match(
  group,
  /gridExpanded &&[\s\S]{0,120}row\.member\.id === state\.currentUserId[\s\S]{0,160}backgroundColor: colors\.primarySoft[\s\S]{0,80}borderRadius: 14/,
  "the current user's expanded row and calendar must share one clipped rounded surface",
);
const memberCalendarToggleStart = group.indexOf('style={styles.metricLink}');
const memberCalendarToggleEnd = group.indexOf(
  "{gridExpanded && metric ?",
  memberCalendarToggleStart,
);
const memberCalendarToggle = group.slice(
  memberCalendarToggleStart,
  memberCalendarToggleEnd,
);
assert.ok(
  memberCalendarToggleStart >= 0 &&
    memberCalendarToggleEnd > memberCalendarToggleStart,
);
assert.match(
  memberCalendarToggle,
  /accessibilityState=\{\{ expanded: gridExpanded \}\}/,
);
assert.match(
  memberCalendarToggle,
  /name=\{gridExpanded \? "chevron-up" : "chevron-down"\}/,
  "member calendars should use the same compact down/up disclosure as Today",
);
assert.doesNotMatch(
  memberCalendarToggle,
  /calendar-outline|chevron-forward/,
  "member rows should not spend width on redundant calendar and detail icons",
);
assert.match(group, /futureInvitations/);
assert.match(group, /participation === "invited"/);

const mixedEntries = [
  { id: "shared", metricId: "water", userId: "owner", value: 250, localDate: "2026-08-13", recordedAt: "2026-08-13T08:00:00.000Z", visibility: "group", source: "manual" },
  { id: "status", metricId: "water", userId: "owner", value: 500, localDate: "2026-08-13", recordedAt: "2026-08-13T09:00:00.000Z", visibility: "status", source: "manual" },
  { id: "private", metricId: "water", userId: "owner", value: 1_000, localDate: "2026-08-13", recordedAt: "2026-08-13T10:00:00.000Z", visibility: "private", source: "manual" },
];
assert.equal(
  aggregateVisibleMetricEntries(mixedEntries, "sum", new Set(["group"])),
  250,
  "an exact shared sum must exclude status-only and private contributions",
);
assert.equal(
  aggregateVisibleMetricEntries(mixedEntries, "sum", new Set(["group", "status"])),
  750,
  "status evaluation may include status rows but must exclude private data",
);
assert.equal(
  aggregateVisibleMetricEntries(mixedEntries, "latest", new Set(["group"])),
  250,
  "latest must be selected after filtering out later hidden rows",
);
assert.equal(
  aggregateVisibleMetricEntries(
    mixedEntries.filter((entry) => entry.visibility !== "group"),
    "sum",
    new Set(["group"]),
  ),
  undefined,
  "no visible contribution must fail closed",
);
assert.equal(
  aggregateVisibleMetricEntries(
    [
      { ...mixedEntries[0], metricId: "steps", value: 4_000 },
      {
        ...mixedEntries[2],
        metricId: "steps",
        value: 12_000,
        source: "imported",
        sourceProvider: "health_connect",
      },
    ],
    "sum",
    new Set(["group"]),
    true,
  ),
  4_000,
  "a private health aggregate must not suppress or replace the exact-visible web fallback",
);
assert.equal(
  authoritativeSharedExactValue(8_000, 5_000),
  8_000,
  "a verified compact Health total must override a stale cached web fallback",
);
assert.equal(
  authoritativeSharedExactValue(undefined, 5_000),
  5_000,
  "raw group rows remain the compatibility fallback before a v2 status arrives",
);
assert.equal(
  canUseCachedSharedRaw("owner", "peer", undefined),
  true,
  "a peer may use a legacy cached group row before an authoritative status arrives",
);
assert.equal(
  canUseCachedSharedRaw("owner", "peer", "group"),
  true,
  "an authoritative group projection keeps its raw compatibility fallback readable",
);
assert.equal(
  canUseCachedSharedRaw("owner", "peer", "group", 8_000),
  false,
  "a verified compact exact projection must replace its matching stale raw row",
);
assert.equal(
  canUseCachedSharedRaw("owner", "peer", "status"),
  false,
  "a status-only projection must immediately fence a stale cached group row",
);
assert.equal(
  canUseCachedSharedRaw("owner", "peer", "private"),
  false,
  "a private projection must immediately fence a stale cached group row",
);
assert.equal(
  canUseCachedSharedRaw("owner", "owner", "private", 8_000),
  true,
  "the privacy cache fence must not hide an owner's own local history",
);
const sharedLogDay = "2026-08-13";
const sharedLogStatuses = [
  {
    groupId: "group",
    metricId: "food",
    userId: "peer",
    localDate: sharedLogDay,
    goalReached: false,
    scoreContribution: 0,
    visibility: "group",
    privacyProjectionVersion: 2,
    exactValue: 610,
    sourceRevision: 12,
  },
  {
    groupId: "group",
    metricId: "steps",
    userId: "peer",
    localDate: sharedLogDay,
    goalReached: false,
    scoreContribution: 0,
    visibility: "group",
    privacyProjectionVersion: 2,
    exactValue: 8_200,
    sourceRevision: 12,
  },
  {
    groupId: "group",
    metricId: "water",
    userId: "peer",
    localDate: sharedLogDay,
    goalReached: false,
    scoreContribution: 0,
    visibility: "status",
    privacyProjectionVersion: 2,
    sourceRevision: 13,
  },
];
const sharedMeal = {
  id: "meal-lunch",
  metricId: "food",
  userId: "peer",
  value: 610,
  localDate: sharedLogDay,
  recordedAt: `${sharedLogDay}T12:30:00.000Z`,
  visibility: "group",
  source: "imported",
  label: "Chicken rice bowl",
  note: "Lunch after training",
  nutrition: {
    mealType: "lunch",
    calories: 610,
    proteinG: 42,
    carbsG: 71,
    fatG: 17,
  },
  imageStoragePath: "peer/entry/meal-lunch.jpg",
  imageUri: "https://signed.example/meal-lunch.jpg",
  sourceRevision: 12,
};
const selectedSharedLogs = sharedLeaderboardLogEntries({
  currentUserId: "viewer",
  dates: [sharedLogDay],
  entries: [
    sharedMeal,
    {
      ...sharedMeal,
      id: "status-only-water-cache",
      metricId: "water",
      value: 500,
      label: "Water bottle",
      nutrition: undefined,
      imageStoragePath: undefined,
      imageUri: undefined,
    },
    {
      ...sharedMeal,
      id: "peer-private-meal",
      visibility: "private",
    },
    {
      ...sharedMeal,
      id: "owner-private-meal",
      userId: "viewer",
      visibility: "private",
    },
  ],
  groupId: "group",
  statuses: sharedLogStatuses,
});
assert.deepEqual(
  selectedSharedLogs.map((entry) => entry.id),
  ["meal-lunch", "owner-private-meal"],
  "a detail view must preserve authorized item rows, fence status/private peer rows, and never fabricate compact daily totals",
);
assert.deepEqual(
  selectedSharedLogs[0].nutrition,
  sharedMeal.nutrition,
  "shared meal nutrition must survive the leaderboard detail projection",
);
assert.equal(
  selectedSharedLogs[0].imageUri,
  sharedMeal.imageUri,
  "the RLS-authorized signed meal attachment must survive the detail projection",
);
assert.equal(
  selectedSharedLogs.some((entry) => entry.id.startsWith("shared-total:")),
  false,
  "compact status rows must remain on the ranking card instead of masquerading as individual logs",
);
const canonicalMetricTarget = metricEntrySocialTarget({
  ...sharedMeal,
  cloudId: "6bbafc87-832d-4f85-95ea-d56cdd424e11",
});
assert.deepEqual(
  canonicalMetricTarget,
  {
    type: "metric_entry",
    id: "6bbafc87-832d-4f85-95ea-d56cdd424e11",
    ownerUserId: "peer",
    cloudPublished: true,
    clientGeneratedId: "meal-lunch",
    localDate: sharedLogDay,
  },
  "a fetched shared log must use its collision-free server UUID for engagement",
);
assert.notEqual(
  groupSocialTargetKey({
    type: "metric_entry",
    id: "legacy-collision",
    ownerUserId: "owner-a",
    cloudPublished: false,
  }),
  groupSocialTargetKey({
    type: "metric_entry",
    id: "legacy-collision",
    ownerUserId: "owner-b",
    cloudPublished: false,
  }),
  "unresolved client ids must remain collision-safe across owners in local social state",
);
assert.equal(
  groupSocialTargetKey(canonicalMetricTarget),
  "metric_entry\u00006bbafc87-832d-4f85-95ea-d56cdd424e11",
  "published targets must use the canonical server identity without an owner suffix",
);
const { cloudId: _omittedLegacyCloudId, ...legacyV3Meal } = sharedMeal;
const legacyV3MetricTarget = metricEntrySocialTarget(legacyV3Meal);
assert.equal(
  legacyV3MetricTarget?.cloudPublished,
  false,
  "a schema-v3 cached row with no cloudId must remain eligible for canonical resolution",
);
assert.deepEqual(
  canonicalizeLegacyMetricSocialTargets(
    [
      legacyV3MetricTarget,
      {
        ...legacyV3MetricTarget,
        ownerUserId: "another-owner",
      },
    ],
    [
      {
        cloudId: "6bbafc87-832d-4f85-95ea-d56cdd424e11",
        ownerUserId: sharedMeal.userId,
        clientGeneratedId: sharedMeal.id,
      },
      {
        cloudId: "108df92f-d956-4ce9-a25a-67b86fbf35d8",
        ownerUserId: "another-owner",
        clientGeneratedId: sharedMeal.id,
      },
    ],
  ).map((target) => target?.id),
  [
    "6bbafc87-832d-4f85-95ea-d56cdd424e11",
    "108df92f-d956-4ce9-a25a-67b86fbf35d8",
  ],
  "legacy cache targets must resolve by exact owner/client pairs even when two members reused one local id",
);
assert.equal(
  metricEntrySocialTarget({ ...sharedMeal, visibility: "private" }),
  undefined,
  "private log content must never become a social target",
);
const metricLogShare = buildMetricLogShareMessage(
  {
    kind: "metric_log",
    entryId: sharedMeal.id,
    metricId: sharedMeal.metricId,
    localDate: sharedMeal.localDate,
    memberId: sharedMeal.userId,
    title: sharedMeal.label,
  },
  "Look at lunch",
);
assert.deepEqual(
  parseChatShareMessage(metricLogShare),
  {
    attachment: {
      kind: "metric_log",
      entryId: "meal-lunch",
      metricId: "food",
      localDate: sharedLogDay,
      memberId: "peer",
      title: "Chicken rice bowl",
    },
    text: "Look at lunch",
  },
  "metric-log attachments must round-trip without leaking the transport URL into chat copy",
);
assert.equal(
  parseChatShareMessage(
    "habhub://metric-log?entryId=meal-lunch&metricId=food&localDate=2026-02-30",
  ),
  undefined,
  "malformed metric-log deep links must fail closed",
);
const sharedWorkout = {
  ...sharedMeal,
  id: "google-health:morning-walk:workout",
  metricId: "workout",
  value: true,
  label: "Morning walk",
  nutrition: undefined,
  imageStoragePath: undefined,
  imageUri: undefined,
  sourceRecordId: "google-health:exercise:morning-walk",
  submetricValues: {
    exercise: 100,
    workout_duration: 42,
    workout_distance: 3.4,
    rounds: 4,
  },
};
assert.deepEqual(
  withoutSharedWorkoutParentDetails(sharedWorkout).submetricValues,
  { rounds: 4 },
  "a relational Workout parent must retain unrelated fields while stripping independently private tracker details",
);
const sharedWorkoutChildren = [
  ["exercise", 100],
  ["workout_duration", 42],
  ["workout_distance", 3.4],
].map(([metricId, value]) => ({
  ...sharedWorkout,
  id: `google-health:morning-walk:${metricId}`,
  metricId,
  value,
  submetricValues: undefined,
}));
const authorizedWorkoutRows = sharedLeaderboardLogEntries({
  currentUserId: "viewer",
  dates: [sharedLogDay],
  entries: [sharedWorkout, ...sharedWorkoutChildren],
  groupId: "group",
  statuses: [
    ...["exercise", "workout_duration"].map((metricId) => ({
      groupId: "group",
      metricId,
      userId: "peer",
      localDate: sharedLogDay,
      goalReached: false,
      scoreContribution: 0,
      visibility: "group",
      privacyProjectionVersion: 2,
      exactValue: 200,
      sourceRevision: 12,
    })),
    {
      groupId: "group",
      metricId: "workout_distance",
      userId: "peer",
      localDate: sharedLogDay,
      goalReached: false,
      scoreContribution: 0,
      visibility: "private",
      privacyProjectionVersion: 2,
      sourceRevision: 12,
    },
  ],
});
assert.deepEqual(
  authorizedWorkoutRows.map((entry) => [entry.metricId, entry.value]),
  [
    ["workout", true],
    ["exercise", 100],
    ["workout_duration", 42],
  ],
  "shared logs must preserve authorized child rows while fencing a private sibling",
);
assert.deepEqual(
  sharedWorkoutBreakdownEntries(sharedWorkout, authorizedWorkoutRows).map(
    (entry) => [entry.metricId, entry.value],
  ),
  [
    ["exercise", 100],
    ["workout_duration", 42],
  ],
  "a Workout breakdown must use only same-source rows that survived independent privacy checks",
);
const legacyWorkout = {
  ...sharedWorkout,
  id: "gym-sync:session-1:workout",
  source: "manual",
  sourceProvider: undefined,
  sourceRecordId: undefined,
  recordedAt: `${sharedLogDay}T18:00:00.000Z`,
  label: "Evening gym",
  note: "Workout session · 9 sets",
};
const legacyExercise = {
  ...legacyWorkout,
  id: "gym-sync:session-1:exercise",
  metricId: "exercise",
  value: 260,
  submetricValues: undefined,
};
const legacyExerciseDuplicate = {
  ...legacyExercise,
  id: "legacy-copy-without-source-record-id",
};
assert.deepEqual(
  sharedWorkoutBreakdownEntries(legacyWorkout, [
    legacyWorkout,
    legacyExercise,
    legacyExerciseDuplicate,
  ]).map((entry) => entry.metricId),
  ["exercise"],
  "sourceRecordId-less legacy rows must associate by stable event identity without duplicate breakdown values",
);
assert.deepEqual(
  sharedLeaderboardLogEntries({
    currentUserId: "viewer",
    dates: [sharedLogDay],
    entries: [sharedMeal],
    groupId: "group",
    peerDetailsAuthorized: false,
    statuses: sharedLogStatuses,
  }).map((entry) => entry.id),
  [],
  "peer item details must fail closed without replacing them with synthetic daily totals",
);
const stalePeerRaw = 5_000;
const verifiedPeerExact = 8_000;
const peerGroupValues = [
  ...(canUseCachedSharedRaw("owner", "peer", "group", verifiedPeerExact)
    ? [stalePeerRaw]
    : []),
  verifiedPeerExact,
];
assert.deepEqual(
  peerGroupValues,
  [8_000],
  "leaderboard aggregation must contain only the compact exact projection when a stale peer raw row exists",
);
const peerStatusValues = canUseCachedSharedRaw(
  "owner",
  "peer",
  "status",
)
  ? [stalePeerRaw]
  : [];
assert.deepEqual(
  peerStatusValues,
  [],
  "leaderboard aggregation must contain no exact peer value after status-only publication",
);
const revisionFence = [{ userId: "owner", metricId: "water", revision: 7 }];
const cachedProjectionRows = [
  { id: "owner-legacy", userId: "viewer", metricId: "water" },
  { id: "peer-legacy", userId: "owner", metricId: "water" },
  { id: "peer-fenced", userId: "owner", metricId: "water", sourceRevision: 7 },
  { id: "peer-reshared", userId: "owner", metricId: "water", sourceRevision: 8 },
];
assert.deepEqual(
  applySharedMetricPrivacyFences(
    cachedProjectionRows,
    revisionFence,
    "viewer",
  ).map((row) => row.id),
  ["owner-legacy", "peer-reshared"],
  "a revision fence must preserve owner history, drop legacy/same-revision peer values, and retain a newer re-share",
);
const currentStatusProjection = {
  id: "status-at-fence",
  userId: "owner",
  metricId: "water",
  sourceRevision: 7,
  visibility: "status",
};
const rebuiltAfterSnapshot = [
  ...applySharedMetricPrivacyFences(
    cachedProjectionRows,
    revisionFence,
    "viewer",
  ),
  currentStatusProjection,
];
assert.equal(
  rebuiltAfterSnapshot.at(-1),
  currentStatusProjection,
  "the current authorized status row at fence revision N must be overlaid after cached exact rows are purged",
);
const racedRemoteProjections = [
  {
    id: "stale-exact-at-fence",
    userId: "owner",
    metricId: "water",
    sourceRevision: 7,
    visibility: "group",
  },
  currentStatusProjection,
].filter(
  (row) =>
    row.visibility === "status" ||
    projectionSurvivesSharedMetricPrivacyFences(
      row.userId,
      row.metricId,
      row.sourceRevision,
      revisionFence,
      row.visibility,
    ),
);
assert.deepEqual(
  racedRemoteProjections.map((row) => row.id),
  ["status-at-fence"],
  "a fence observed before the history rewrite must drop a raced exact row while retaining its authorized status-only projection",
);
assert.equal(
  projectionSurvivesSharedMetricPrivacyFences(
    "owner",
    "water",
    6,
    revisionFence,
    "status",
  ),
  false,
  "an older status-only row must be dropped when a later private transition advances the fence",
);
assert.equal(
  projectionSurvivesSharedMetricPrivacyFences(
    "owner",
    "water",
    8,
    revisionFence,
  ),
  true,
  "a later group re-share must survive an older privacy fence",
);
assert.match(cloud, /groupVisibleMetricValue/);
assert.match(cloud, /goal_target: statusOnly \? null : target/);
assert.match(cloud, /coarseSharedProgress\(rawGoalProgress, 300\)/);
assert.match(cloud, /privacy_projection_version: 2/);
assert.match(
  cloud,
  /entry\.visibility !== "group" \|\|[\s\S]{0,100}isPassiveCalculatedWalkingEntry\(entry\)/,
  "passive calculated walking rows must not drive client-side lead alerts",
);
assert.match(
  cloud,
  /const newSharedEntries[\s\S]{0,350}!isPassiveCalculatedWalkingEntry\(entry\)/,
  "passive calculated walking rows must not trigger a pending metric-push drain",
);
assert.match(
  cloud,
  /await Promise\.allSettled\(\[[\s\S]{0,160}dispatchCommittedEntryNotifications\(\)[\s\S]{0,120}dispatchCommittedLeadNotifications\(\)/,
  "post-commit push transport failures must not turn a durable group save into a retrying Bad Request",
);
assert.match(
  cloud,
  /Account\/group metadata: \$\{cloudErrorText\(metadataProjection\.error\)\}/,
  "metadata failures must identify the failed group-sync stage instead of surfacing only Bad Request",
);
const staleRetryStart = provider.indexOf("let workspaceResult;");
const staleRetryFirstPublish = provider.indexOf(
  "workspaceResult = await publishWorkspace();",
  staleRetryStart,
);
const staleRetryCatch = provider.indexOf(
  "stale_group_configuration",
  staleRetryFirstPublish,
);
const staleRetryHydrate = provider.indexOf(
  "loadCloudWorkspace(",
  staleRetryCatch,
);
const staleRetryMerge = provider.indexOf(
  "candidate = mergeRemoteWorkspace(loaded, stateRef.current);",
  staleRetryHydrate,
);
const staleRetrySecondPublish = provider.indexOf(
  "workspaceResult = await publishWorkspace();",
  staleRetryFirstPublish + 1,
);
const staleRetryEnd = provider.indexOf(
  "if (!workspaceResult.workspacePushed)",
  staleRetrySecondPublish,
);
assert.ok(
  staleRetryStart >= 0 &&
    staleRetryStart < staleRetryFirstPublish &&
    staleRetryFirstPublish < staleRetryCatch &&
    staleRetryCatch < staleRetryHydrate &&
    staleRetryHydrate < staleRetryMerge &&
    staleRetryMerge < staleRetrySecondPublish &&
    staleRetrySecondPublish < staleRetryEnd,
  "a stale group configuration must hydrate the server revision and retry once in the same serialized sync",
);
assert.equal(
  (
    provider
      .slice(staleRetryStart, staleRetryEnd)
      .match(/workspaceResult = await publishWorkspace\(\);/g) ?? []
  ).length,
  2,
  "the serialized stale-configuration repair must be bounded to one retry",
);
assert.match(
  provider,
  /if \(accountMetadataNeedsUpload && !accountMetadataSynced\) \{[\s\S]{0,160}pushCloudAccountMetadata\(candidate, revisionRef\.current\)/,
  "profile and avatar metadata must publish independently of a failing group workspace",
);
assert.doesNotMatch(
  provider,
  /accountMetadataNeedsUpload &&[\s\S]{0,100}\(!groupWorkspaceNeedsUpload \|\| deferGroupRetry\)/,
  "a group retry must never hold account profile metadata hostage",
);
assert.match(
  cloud,
  /cloudEntryProjectionDiffers\([\s\S]{0,180}idBySlug\.get\(entry\.metricId\)/,
  "existing item rows must self-heal missing labels, nutrition, notes, values, and media even without a newer provider timestamp",
);
assert.match(
  cloud,
  /function cloudTimestampEqual[\s\S]{0,500}leftMs === rightMs/,
  "equivalent Z and +00:00 timestamps must not reopen an endless detailed-entry upsert loop",
);
assert.match(
  cloud,
  /!cloudTimestampEqual\(remote\.recorded_at, entry\.recordedAt\)/,
);
assert.match(
  cloud,
  /!cloudTimestampEqual\(remote\.source_updated_at, entry\.sourceUpdatedAt\)/,
);
assert.match(
  cloud,
  /Preserve previously RLS-authorized exact rows[\s\S]{0,900}entry\.userId === state\.currentUserId \|\|[\s\S]{0,80}entry\.visibility === "group"[\s\S]{0,220}entry\.userId !== state\.currentUserId/,
  "a group-visible item-detail cache must survive omission until a tombstone or privacy fence revokes it",
);
assert.match(
  cloud,
  /list_owned_detailed_imported_metric_entry_ids/,
  "a cold process must bootstrap its previously published detailed imported row ids",
);
assert.match(
  compactedImportedDetailFence,
  /visibility: "private"[\s\S]{0,220}nutrition: undefined[\s\S]{0,220}imageStoragePath: undefined/,
  "removing the final imported note, nutrition payload, or photo must privacy-fence its previously shared raw projection",
);
assert.match(
  cloud,
  /if \(!entry \|\| entry\.source !== "imported"\) return \[\];/,
  "a bounded local cache omission must never be inferred as a remote entry deletion or privacy edit",
);
assert.match(
  passiveWalkingPushMigration,
  /create or replace function public\.list_owned_detailed_imported_metric_entry_ids[\s\S]*security invoker[\s\S]*entry\.user_id = \(select auth\.uid\(\)\)[\s\S]*entry\.visibility = 'group'/,
  "the detailed-entry bootstrap must return only the caller's own currently shared imported projections",
);
assert.match(
  passiveWalkingPushMigration,
  /revoke all on function public\.list_owned_detailed_imported_metric_entry_ids\(uuid\)[\s\S]*from public, anon;[\s\S]*grant execute[\s\S]*to authenticated/,
  "the projection bootstrap RPC must be authenticated-only",
);
assert.match(
  passiveWalkingPushMigration,
  /begin[\s\S]{0,500}new\.source = 'calculated'[\s\S]{0,100}new\.label = 'Estimated unrecorded walking from steps'[\s\S]{0,80}return new;[\s\S]{0,300}select definition\.group_id/,
  "the database metric emitter must suppress passive calculated walking updates before its metric lookup",
);
assert.match(
  passiveWalkingLeadFunction,
  /v_source = 'calculated'[\s\S]{0,100}v_label = 'Estimated unrecorded walking from steps'[\s\S]{0,80}return null/,
  "the server lead-event RPC must also reject passive calculated walking updates",
);
assert.match(
  passiveWalkingLeadFunction,
  /'Lead changed'[\s\S]{0,180}'New ' \|\| v_metric_name/,
  "the passive filter migration must preserve identity/value-free lead-alert copy",
);
assert.doesNotMatch(
  passiveWalkingLeadFunction,
  /v_member_name/,
  "the passive filter migration must not reintroduce member identity into lead-alert copy",
);
assert.match(
  passiveWalkingPushMigration,
  /event\.dispatched_at is null[\s\S]{0,220}event\.data ->> 'entryId' = entry\.client_generated_id/,
  "only pending passive metric alerts should be cleaned up",
);
assert.match(
  passiveWalkingPushMigration,
  /event\.category = 'lead'[\s\S]{0,500}entry\.source = 'calculated'[\s\S]{0,350}entry\.id::text \|\| ':%'/,
  "only pending lead alerts linked to a passive calculated entry should be cleaned up",
);
assert.match(
  cloud,
  /entry\.userId !== source\.currentUserId \|\|[\s\S]*entry\.visibility === "group"/,
);
assert.match(
  read("src/domain/metrics.ts"),
  /const verifiedProjectionValue =[\s\S]*privacyProjectionVersion === 2[\s\S]*const localExactValue = canUseCachedSharedRaw\([\s\S]*authoritativeSharedExactValue\([\s\S]*visibility === "status"[\s\S]*authoritativeExactValue !== undefined/,
  "an authoritative status/private projection must override stale cached raw entries",
);
assert.match(leaderboardDetail, /sharedLeaderboardLogEntries\(\{/);
assert.doesNotMatch(
  read("src/domain/sharedLeaderboardLogs.ts"),
  /shared-total:|Shared daily total/,
  "leaderboard details must never synthesize a per-item row from a compact daily status",
);
assert.match(
  leaderboardDetail,
  /\.refreshActivity\(targetedActivitySince, \{ force: true \}\)/,
  "direct leaderboard-detail navigation must hydrate its requested activity range",
);
assert.match(
  leaderboardDetail,
  /useEffect\(\(\) => \{[\s\S]{0,400}if \(requestedPeriod\) setPeriod\(requestedPeriod\);[\s\S]{0,120}if \(requestedAnchor\) setAnchor\(requestedAnchor\);[\s\S]{0,120}\[requestedAnchor, requestedPeriod\]/,
  "a mounted detail route must follow a later deep link's period and historical anchor",
);
assert.match(
  leaderboardDetail,
  /const targetedActivitySince =[\s\S]{0,180}period === "overall"[\s\S]{0,220}periodDates\([\s\S]{0,80}"overall",[\s\S]{0,80}anchor,[\s\S]{0,120}\)\[0\][\s\S]{0,40}: dates\[0\]/,
  "a cold Overall detail route must request the bounded 730-day period instead of only today",
);
assert.match(
  leaderboardDetail,
  /lastMetricsParamRef[\s\S]{0,1200}requestedAvailableKey\.split\("\\u0000"\)[\s\S]{0,900}current\.length === 1 && current\[0\] === SCORE_ID[\s\S]{0,160}loggedIdsKey\.split\("\\u0000"\)/,
  "same-route metric parameters and hydrated item metrics must replace only the provisional Score choice",
);
assert.match(
  leaderboardDetail,
  /metricSelectionEditedRef\.current = true;[\s\S]{0,100}setSelectedIds\(nextSelectedIds\)/,
  "manual metric selection must prevent a later cache hydration from overwriting the user",
);
assert.match(
  leaderboardDetail,
  /const targetMemberId =[\s\S]{0,260}state\.group\.members\.some[\s\S]{0,350}setOpenLogs\(\(current\)[\s\S]{0,220}\[targetMemberId\]: true/,
  "member-targeted alerts and shared logs must expand the intended member after route reuse",
);
assert.match(
  leaderboardDetail,
  /item\.id === params\.entryId \|\| item\.cloudId === params\.entryId/,
  "shared-log deep links must resolve both persisted client ids and canonical server ids",
);
assert.match(
  leaderboardDetail,
  /metricLogEntryId: entry\.id[\s\S]{0,240}metricLogLocalDate: entry\.localDate[\s\S]{0,240}metricLogShareAt:/,
  "an individual leaderboard log must enter chat through the typed attachment composer",
);
assert.match(
  chat,
  /kind: "metric_log"[\s\S]{0,220}entryId: requestedMetricLogEntryId[\s\S]{0,220}localDate: requestedMetricLogLocalDate/,
  "chat must build a real metric-log attachment from route parameters",
);
assert.match(
  chat,
  /document-text-outline[\s\S]{0,2500}"Shared log"[\s\S]{0,2500}"Open this leaderboard log"/,
  "chat must render the metric-log attachment kind",
);
assert.match(
  chat,
  /pathname: "\/leaderboard-detail"[\s\S]{0,300}anchor: attachment\.localDate[\s\S]{0,300}entryId: attachment\.entryId/,
  "opening a shared log must return to its authorized historical Leaderboard detail row",
);
assert.match(
  socialHook,
  /let resolvedTarget = await mutationTarget\(target\);[\s\S]{0,1800}setReactions/,
  "an unclouded social target must resolve before an optimistic reaction is painted",
);
assert.match(
  socialHook,
  /target\.ownerUserId === state\.currentUserId[\s\S]{0,180}!target\.cloudPublished \|\| forceRepair[\s\S]{0,180}cloud\.syncNow\(\)[\s\S]{0,180}cloud\.refreshActivity\(target\.localDate, \{ force: true \}\)/,
  "an owned unpublished or fenced log must publish and refresh before server identity resolution",
);
assert.match(
  groupSocial,
  /from\("metric_entries"\)[\s\S]{0,220}\.eq\("user_id", target\.ownerUserId\)[\s\S]{0,160}\.eq\("client_generated_id", clientGeneratedId\)[\s\S]{0,180}\.eq\("metric_definitions\.group_id", groupId\)/,
  "legacy client ids must be disambiguated by owner under RLS and scoped to the active group",
);
assert.match(
  groupSocial,
  /resolveGroupSocialTargets[\s\S]{0,1800}\.in\("user_id", ownerIds\)[\s\S]{0,120}\.in\("client_generated_id", clientGeneratedIds\)[\s\S]{0,220}metric_definitions\.group_id/,
  "legacy cached targets must be batch-resolved by owner/client id before canonical engagement reads",
);
assert.match(
  socialHook,
  /requestGenerationRef\.current !== generation[\s\S]{0,500}setReactions\(next\.reactions\)[\s\S]{0,700}requestGenerationRef\.current !== generation/,
  "an older group or target request must not overwrite the current engagement state",
);
const burstStart = socialHook.indexOf("beginSocialReactionBurst(", 100);
const burstConfirm = socialHook.indexOf("confirmSocialReactionBurst(", burstStart);
const burstRestore = socialHook.indexOf(
  "confirmedReactionByMutationRef.current.get(mutationKey)",
  burstConfirm,
);
const burstFinish = socialHook.indexOf("finishSocialReactionBurst(", burstRestore);
assert.ok(
  burstStart >= 0 &&
    burstConfirm > burstStart &&
    burstRestore > burstConfirm &&
    burstFinish > burstRestore,
  "rapid reaction writes must retain, advance, restore, and release a confirmed per-target baseline",
);
assert.match(
  socialHook,
  /targetAliases[\s\S]{0,1800}persistedTargetKey\(resolved\)/,
  "a legacy presentation key must point at the canonical persisted reaction key",
);
assert.match(
  recapFeed,
  /type: "metric_entry"[\s\S]{0,120}id: entry\.cloudId \?\? entry\.id/,
  "feed reactions must use the same canonical metric-entry identity as Leaderboard details",
);
assert.match(
  recapScreen,
  /commentDateTimeLabel\([\s\S]{0,500}new Intl\.DateTimeFormat\([\s\S]{0,350}hour: "2-digit"[\s\S]{0,100}minute: "2-digit"/,
  "group-feed comments must show a localized date and time",
);
assert.match(
  appRoot,
  /typeof route === "string" && route\.startsWith\("\/"\)[\s\S]{0,700}router\.push\(\{ pathname: route, params \}/,
  "native push taps must preserve the social target parameters",
);
assert.match(
  webPushWorker,
  /function routeWithParameters\(data\)[\s\S]{0,700}target\.searchParams\.set\(key, String\(value\)/,
  "web push taps must preserve the social target parameters",
);
assert.match(
  recapScreen,
  /commentDateTimeLabel\(\s*comment\.createdAt,[\s\S]{0,220}timeFormat/,
  "each rendered group-feed comment must use its persisted creation time",
);
assert.match(
  recapScreen,
  /styles\.commentDelete[\s\S]{0,500}trash-outline" size=\{13\}/,
  "each owned comment must use the compact delete control",
);
assert.doesNotMatch(
  recapScreen,
  /<IconButton icon="trash-outline" label="Delete comment"/,
  "feed comments must not use the full-size shared header IconButton for deletion",
);
for (const targetType of [
  "recap_feed",
  "metric_entry",
  "photo_update",
  "badge",
  "group_challenge",
  "group_todo",
])
  assert.match(
    durableSocialMigration,
    new RegExp(`'${targetType}'`),
    `the reaction RPC must continue accepting the ${targetType} feed target type`,
  );
assert.match(
  durableSocialMigration,
  /entry\.id = v_target_uuid[\s\S]{0,2200}entry\.client_generated_id = p_target_id[\s\S]{0,1200}v_match_count = 1/,
  "the server must prefer a canonical UUID but independently and unambiguously resolve UUID-shaped legacy client ids",
);
assert.match(
  durableSocialMigration,
  /owner_membership\.status = 'active'[\s\S]{0,800}entry\.visibility = 'group'[\s\S]{0,900}metric_privacy_cache_fences/,
  "server target resolution must preserve membership, entry visibility, and privacy-fence rules",
);
assert.match(
  durableSocialMigration,
  /canonicalize_group_social_metric_target[\s\S]{0,1200}group_social_comments_canonicalize_metric_target/,
  "mixed-version comments and reactions must be canonicalized before RLS stores their target identity",
);
assert.match(
  durableSocialMigration,
  /insert into public\.group_social_reactions[\s\S]{0,500}v_canonical_target_id/,
  "the reaction RPC must persist only the canonical server identity",
);
assert.match(
  socialNotificationMigration,
  /event_type in \([\s\S]{0,400}'social_reaction', 'social_comment'/,
  "feed comments and reactions must share the durable recipient bell feed",
);
assert.match(
  socialNotificationMigration,
  /resolve_group_social_notification_target[\s\S]{0,9000}v_recipient_id = new\.user_id[\s\S]{0,7000}emit_group_social_comment_notification/,
  "the backend must resolve the feed owner and suppress self-notifications for both interaction kinds",
);
for (const reaction of ["heart", "thumbs_up", "thumbs_down", "cheer"])
  assert.match(
    socialNotificationMigration,
    new RegExp(`when '${reaction}'`),
    `the ${reaction} interaction must receive explicit push copy`,
  );
assert.match(
  socialNotificationMigration,
  /'route', '\/recapfeed'[\s\S]{0,500}'targetType', new\.target_type[\s\S]{0,160}'targetId', new\.target_id/,
  "social pushes must carry the canonical target back to the group feed",
);
assert.match(
  socialNotificationMigration,
  /create trigger group_social_comments_emit_notification[\s\S]{0,180}after insert/,
  "a saved feed comment must emit exactly once on insertion",
);
assert.match(
  pushWorker,
  /event\.eventType === "social_reaction" \|\|[\s\S]{0,100}event\.eventType === "social_comment"/,
  "the push worker must apply the same social preference to reactions and comments",
);
assert.match(
  groupNotificationHook,
  /event\.kind === "social_reaction" \|\| event\.kind === "social_comment"/,
  "the in-app Leaderboard feed must apply the same social preference to comments",
);
assert.match(
  alertsScreen,
  /pathname: "\/\(tabs\)\/recapfeed"[\s\S]{0,350}targetType: alert\.targetType[\s\S]{0,120}targetId: alert\.entryId[\s\S]{0,180}groupId: alert\.groupId[\s\S]{0,150}feedFocusAt:/,
  "a stored Leaderboard interaction must focus its exact feed card",
);
assert.match(
  recapScreen,
  /const requestedGroupId = params\.groupId[\s\S]{0,850}cloud\.switchGroup\(requestedGroupId\)/,
  "an account-wide interaction alert must activate its authorized group before focusing the feed",
);
assert.match(
  recapScreen,
  /recapFeedItemIdForSocialTarget\([\s\S]{0,400}params\.targetId/,
  "the feed must resolve a canonical notification target to its rendered card",
);
assert.match(
  recapScreen,
  /setHighlightedItemId\(requestedHighlight\)[\s\S]{0,350}scrollRef\.current\?\.scrollTo\([\s\S]{0,350}setTimeout\([\s\S]{0,180}setHighlightedItemId\(undefined\)[\s\S]{0,100}FEED_HIGHLIGHT_MS/,
  "the feed must scroll to and highlight the requested card for five seconds",
);
assert.equal(
  (leaderboardDetail.match(/pathname: "\/member\/\[id\]"/g) ?? []).length,
  2,
  "leaderboard detail should link only the member avatar and name to comparison",
);
assert.doesNotMatch(
  leaderboardDetail,
  /canUseCachedSharedRaw/,
  "compact totals must not replace authorized item-level rows in the shared-log display",
);
assert.match(privacyMigration, /add column if not exists privacy_projection_version/);
assert.match(
  privacyMigration,
  /update public\.daily_metric_status[\s\S]{0,900}exact_value = null[\s\S]{0,900}where\s+exact_value is not null/,
  "legacy exact projections must be cleared fail-closed before v2 clients republish them",
);
assert.doesNotMatch(
  privacyMigration,
  /when visibility::text = 'group' and exists[\s\S]{0,500}then exact_value/,
  "a legacy exact aggregate must never be preserved merely because one group entry exists",
);
assert.match(
  privacyMigration,
  /coalesce\(new\.privacy_projection_version, 1\) < 2[\s\S]*new\.exact_value := null/,
);
assert.match(privacyMigration, /new\.goal_target := null/);
assert.match(privacyMigration, /floor\(greatest\(0, least\(300, new\.goal_progress\)\) \/ 25\) \* 25/);
assert.match(
  cloud,
  /groupHealthStepDates[\s\S]{0,900}supersededSharedStepFallbackIds[\s\S]{0,900}remoteEntryIdsToDelete/,
  "a phone Steps aggregate must supersede its web fallback in the shared raw projection",
);
assert.match(
  cloud,
  /if \(supersededSharedStepFallbackIds\.has\(entry\.id\)\) return false/,
  "a superseded web Steps fallback must not be uploaded again after deletion",
);
assert.match(
  compactProjectionMigration,
  /privacy_projection_version, 1\) >= 2[\s\S]{0,260}new\.exact_value := new\.exact_value[\s\S]*elsif shared_entry_exists/,
  "the database must preserve a verified v2 compact Health total before considering legacy raw fallback rows",
);
assert.match(
  explicitProjectionMigration,
  /daily_metric_status_a_reset_projection_version[\s\S]*before update on public\.daily_metric_status[\s\S]*daily_metric_status_b_accept_explicit_projection_v2[\s\S]*before update of privacy_projection_version/,
  "ordered triggers must reset inherited v2 trust and restore it only for an explicitly submitted marker",
);
assert.match(cacheFenceMigration, /create table if not exists public\.metric_privacy_cache_fences/);
assert.match(
  cacheFenceMigration,
  /revoke all on table public\.metric_privacy_cache_fences[\s\S]*from public, anon, authenticated;[\s\S]*grant select on table public\.metric_privacy_cache_fences[\s\S]*to authenticated;/,
  "privacy-fence metadata must expose RLS-filtered reads but no direct client writes",
);
assert.match(
  cacheFenceMigration,
  /metric_privacy_cache_fences_active_member_read[\s\S]*membership\.status = 'active'/,
  "only active group members may read date-free cache fences",
);
assert.match(
  cacheFenceMigration,
  /old_row\.visibility::text = 'group'[\s\S]*new_row\.visibility::text <> 'group'/,
  "group-to-status and group-to-private transitions must both revoke cached exact values",
);
assert.match(cacheFenceMigration, /definition\.slug = 'progress_photo'/);
assert.match(cacheFenceMigration, /'revision', fence\.revision/);
assert.doesNotMatch(
  cacheFenceMigration.match(/'privacy_fences',[\s\S]*?'\[\]'::jsonb/)?.[0] ?? "",
  /local_date|exact_value|has_data|goal_target|updated_at/,
  "privacy-fence metadata must disclose no dates, values, targets, or activity-presence fields",
);
const tombstoneSnapshot =
  cacheFenceMigration.match(/'tombstones',[\s\S]*?'privacy_fences'/)?.[0] ??
  "";
assert.match(
  tombstoneSnapshot,
  /'user_id', tombstone\.user_id[\s\S]*'client_generated_id', tombstone\.client_generated_id/,
  "entry tombstones must identify deleted cached rows across the full history",
);
assert.doesNotMatch(
  tombstoneSnapshot,
  /'local_date'|'deleted_at'|and tombstone\.local_date >=|greatest\(p_since_date/,
  "global deletion tombstones must be date-free and unbounded by the detail window",
);
assert.doesNotMatch(
  cacheFenceMigration,
  /metric_privacy_cache_fences[\s\S]{0,900}date '2000-01-01'/,
  "a date-free fence must not force an all-history refresh",
);
assert.match(
  cacheFenceMigration,
  /on conflict \(group_id\) do update[\s\S]{0,220}since_date = excluded\.since_date/,
  "a fence invalidation must replace stale historical coverage with current_date",
);
assert.match(
  cloud,
  /advance_metric_privacy_cache_fences[\s\S]*pendingPrivacyFenceMetricIds/,
  "the default-visibility outbox must call the revision-checked fence RPC",
);
assert.match(
  cloud,
  /const remoteEntries:[\s\S]{0,180}applySharedMetricPrivacyFences\([\s\S]{0,1800}privacyFences,[\s\S]{0,100}state\.currentUserId/,
  "the current server snapshot must also fence exact entries from the RPC/rewrite race",
);
assert.match(
  cloud,
  /projectionSurvivesSharedMetricPrivacyFences\([\s\S]{0,240}status\.visibility/,
  "server statuses must apply the projection-aware fence so revision N status survives but older status does not",
);
assert.match(
  cloud,
  /"progress_photo",[\s\S]{0,120}photo\.sourceRevision,[\s\S]{0,120}privacyFences/,
  "progress-photo server rows must obey the same revision fence",
);
assert.match(
  cloud,
  /pendingPrivacyFenceMetricIds\.length > 0[\s\S]*rebuildStatusHistory/,
  "a visibility fence must rebuild historical compact statuses before its outbox is acknowledged",
);
assert.match(
  provider,
  /acknowledgedPrivacyFenceMetricIds[\s\S]{0,900}pendingMetricPrivacyFenceIdsByGroup/,
  "a successful workspace push must clear only its acknowledged privacy-fence outbox ids",
);
assert.match(
  appProvider,
  /action\.changes\.defaultVisibility === "group"[\s\S]{0,500}metricId !== action\.metricId/,
  "a restrict-then-reshare edit before sync must cancel its unsent privacy fence",
);
assert.match(
  groupActivityCacheTypes,
  /GROUP_ACTIVITY_CACHE_SCHEMA_VERSION = 3/,
  "the privacy release must invalidate pre-fence scoped activity caches",
);
assert.match(
  groupActivityCacheNative,
  /SELECT group_id, payload FROM group_activity_cache[\s\S]*if \(sanitized === row\.payload\) continue;[\s\S]*UPDATE group_activity_cache[\s\S]*payload = \?/,
  "Android cleanup must rewrite sensitive same-schema SQLite payloads, not merely filter them at read time",
);
assert.match(
  provider,
  /const cachedEntries = live\.entries\.filter\([\s\S]{0,100}entry\.userId === live\.currentUserId/,
  "the full-workspace merge must not resurrect peer rows after the authoritative loader prunes them",
);
assert.match(
  provider,
  /const fenceFilteredEntries = applySharedMetricPrivacyFences\([\s\S]{0,450}const baseEntries/,
  "an activity refresh must fence out-of-window live rows before its range merge",
);
assert.match(
  cloud,
  /const deletedEntryKeys = new Set\(activity\.deletedEntryKeys \?\? \[\]\)[\s\S]{0,500}!deletedEntryKeys\.has\(metricEntryKey\(entry\.userId, entry\.id\)\)/,
  "a full-workspace merge must apply precise tombstones before preserving out-of-window cached entries",
);
const mixedAccountRows = [
  { id: "owned", userId: "owner", senderId: "owner" },
  { id: "foreign", userId: "peer", senderId: "peer" },
];
const ownedCollections = accountOwnedCollections({
  currentUserId: "owner",
  entries: mixedAccountRows,
  photos: mixedAccountRows,
  messages: mixedAccountRows,
  dailyMetricStatuses: mixedAccountRows,
});
for (const rows of Object.values(ownedCollections))
  assert.deepEqual(
    rows.map((row) => row.id),
    ["owned"],
    "the shared account projection must exclude every foreign account row",
  );
assert.match(
  appProvider,
  /function stateForLocalPersistence[\s\S]{0,900}accountOwnedCollections\(state\)[\s\S]{0,250}\.\.\.owned/,
  "account persistence must never retain foreign activity or signed photo URLs, including after a group switch",
);
assert.match(
  provider,
  /function snapshotPayload[\s\S]{0,300}const owned = accountOwnedCollections\(state\)/,
  "cloud snapshots must use the same account-owned privacy projection",
);
assert.match(provider, /entries: owned\.entries\.map/);
assert.match(provider, /photos: owned\.photos\.map/);
assert.match(provider, /messages: owned\.messages\.map/);
assert.match(provider, /dailyMetricStatuses: owned\.dailyMetricStatuses/);
assert.match(
  accountCollections,
  /const accountId = state\.currentUserId[\s\S]{0,500}accountEntries\(state\.entries, accountId\)[\s\S]{0,500}accountMessages\([\s\S]{0,120}accountId/,
  "the shared projection must key every cached collection by the active account",
);
assert.match(
  provider,
  /function purgeDepartedGroupData[\s\S]{0,400}entries: state\.entries\.filter\([\s\S]{0,120}entry\.userId === state\.currentUserId[\s\S]{0,650}messageBelongsToCloudGroup/,
  "definitive membership loss must purge all peer activity and that group's chat/media",
);
assert.match(
  provider,
  /leaveCloudGroup\(groupId\)[\s\S]{0,350}purgeDepartedGroupData[\s\S]{0,750}removeGroupActivityCache\(groupId\)/,
  "a successful explicit leave must purge in-memory and scoped group caches",
);
assert.match(
  provider,
  /isDefinitiveGroupMembershipLoss\(error\)[\s\S]{0,120}evictUnavailableGroup\(groupId\)/,
  "a definitive server-side membership loss must evict the unavailable group without treating transient failures as revocation",
);
assert.match(
  provider,
  /\.channel\(`account:\$\{auth\.user\.id\}:memberships`[\s\S]{0,450}membership\.user_id !== auth\.user\?\.id[\s\S]{0,450}membership\.operation === "DELETE"[\s\S]{0,650}evictUnavailableGroup\(membership\.group_id\)/,
  "a private account membership broadcast must still verify its recipient before evicting a deleted membership",
);
assert.match(
  provider,
  /verifyActiveGroupMembership[\s\S]{0,500}hasActiveCloudGroupMembership[\s\S]{0,250}evictUnavailableGroup/,
  "resume and reconnect must authoritatively verify membership instead of relying on DELETE delivery",
);
assert.match(
  provider,
  /\.channel\(`group:\$\{state\.group\.id\}:workspace`[\s\S]{0,250}\{ event: "workspace_updated" \}[\s\S]{0,100}queueRefresh/,
  "group membership and workspace invalidations must refresh only through the active group's private topic",
);
const scopedActivity = scopeCachedGroupActivity(
  {
    groupId: "group",
    version: 7,
    entries: [
      { ...mixedEntries[0], id: "shared-peer", userId: "peer" },
      { ...mixedEntries[0], id: "owned-account-row", userId: "viewer" },
      { ...mixedEntries[0], id: "private-peer", userId: "peer", visibility: "private" },
      { ...mixedEntries[0], id: "departed-peer", userId: "departed" },
      { ...mixedEntries[0], id: "removed-metric", userId: "peer", metricId: "old" },
    ],
    dailyMetricStatuses: [
      { ...sharedLogStatuses[0], metricId: "water" },
      { ...sharedLogStatuses[0], metricId: "water", visibility: "private" },
      { ...sharedLogStatuses[0], userId: "viewer", metricId: "water" },
      { ...sharedLogStatuses[0], userId: "departed", metricId: "water" },
      { ...sharedLogStatuses[0], metricId: "old" },
      { ...sharedLogStatuses[0], groupId: "other", metricId: "water" },
    ],
  },
  {
    currentUserId: "viewer",
    group: {
      id: "group",
      name: "Test",
      inviteCode: "TEST",
      templateName: "Test",
      streakRestDaysPerWeek: 0,
      members: [
        { id: "viewer", name: "Viewer", initials: "V", color: "#000", role: "member" },
        { id: "peer", name: "Peer", initials: "P", color: "#111", role: "member" },
      ],
      metricConfiguration: [
        { id: "water" },
      ],
    },
  },
  "viewer",
  "group",
);
assert.deepEqual(
  scopedActivity?.entries.map((entry) => entry.id),
  ["shared-peer"],
  "startup group cache hydration must retain only peer, active-member, configured-metric, exact-group rows",
);
assert.equal(
  scopedActivity?.dailyMetricStatuses.length,
  1,
  "cached compact statuses must be scoped to the current group shell",
);
assert.equal(
  scopeCachedGroupActivity(
    scopedActivity,
    {
      currentUserId: "other-account",
      group: {
        id: "group",
        name: "Test",
        inviteCode: "TEST",
        templateName: "Test",
        streakRestDaysPerWeek: 0,
        members: [],
      },
    },
    "viewer",
    "group",
  ),
  null,
  "a cached group snapshot must fail closed across an account or membership boundary",
);
assert.match(
  provider,
  /startupGroupCacheHydrationRef[\s\S]{0,1400}accountBoundaryReadyUserId !== auth\.user\.id[\s\S]{0,500}hydrateCachedGroupActivity/,
  "cold open must start scoped cache hydration as soon as the account boundary is ready",
);
assert.match(
  provider,
  /const shellsPromise = readCloudResponsively[\s\S]{0,350}const cachePromise = hydrateCachedGroupActivity[\s\S]{0,300}await Promise\.all\(\[shellsPromise, cachePromise\]\)[\s\S]{0,350}loadCloudWorkspace\(\s*stateRef\.current/,
  "a workspace refresh must merge its RLS snapshot from the hydrated durable cache, not an immutable pre-cache state",
);
assert.match(
  provider,
  /const observedVersion[\s\S]{0,120}const reusableCached = scopedCached;[\s\S]{0,120}const reusableGoogleActivity = scopedGoogleActivity;/,
  "unrelated live activity revisions must not erase already-authorized individual-log caches",
);
assert.match(
  provider,
  /stillAuthorized = scopeCachedGroupActivity[\s\S]{0,1500}replaceState\(next, \{ source: "cloud" \}\)/,
  "cache hydration must recheck authorization after async reads and remain presentation-only",
);
assert.match(
  provider,
  /groupActivityCacheHydrationRef[\s\S]{0,2400}startingActivitySequence !== activityLoadSequenceRef\.current[\s\S]{0,120}activityRefreshPromiseRef\.current/,
  "one scoped cache read must singleflight and yield to a newer tombstone/privacy response",
);
assert.match(
  provider,
  /groupActivityCacheWriteGenerationRef[\s\S]{0,8000}cacheWriteGeneration[\s\S]{0,1200}cacheWriteIsCurrent/,
  "delayed cache writes must carry a monotonic account/group generation fence",
);
assert.match(
  provider,
  /mustPersistBeforeSettle =[\s\S]{0,180}deletedEntryKeys\.size > 0[\s\S]{0,120}activity\.privacyFences/,
  "tombstone and privacy-fence responses must become durable before their refresh settles",
);
assert.doesNotMatch(
  cachedGroupActivityBlock,
  /cacheSinceDate|entry\.localDate >=/,
  "explicitly loaded historical individual logs must not be discarded from the durable group cache",
);
assert.match(
  cachedGroupActivityBlock,
  /entry\.visibility === "group"/,
  "the durable historical cache must still reject item-level private/status-only rows",
);
assert.match(
  provider,
  /entry\.visibility === "group" &&[\s\S]{0,100}entry\.userId !== state\.currentUserId/,
  "account-owned rows must stay in the account cache rather than a reusable group cache",
);
assert.match(
  provider,
  /status\.groupId === groupId &&[\s\S]{0,100}status\.visibility !== "private"/,
  "private compact statuses must never be written to the reusable group cache",
);
assert.match(
  cloud,
  /cloudId: entry\.id/,
  "every RLS-returned individual log must retain its canonical metric_entries UUID",
);
assert.match(
  cloud,
  /cached\.userId === state\.currentUserId[\s\S]{0,220}entry\.cloudId[\s\S]{0,400}\{ \.\.\.cached, cloudId: entry\.cloudId \}/,
  "a newer owned local log must still learn its server identity after publication",
);
assert.match(
  cloud,
  /from\("metric_privacy_cache_fences"\)[\s\S]{0,180}\.eq\("user_id", state\.currentUserId\)[\s\S]{0,100}\.eq\("group_id", state\.group\.id\)/,
  "a full projection must read the indexed owner fence set once instead of checking every detail row separately",
);
assert.match(
  cloud,
  /account_revision[\s\S]{0,4500}const needsPostFenceRepair = Boolean\([\s\S]{0,500}publishRevision > fenceRevision[\s\S]{0,180}remoteRevision <= fenceRevision[\s\S]{0,220}needsPostFenceRepair/,
  "still-shared item rows at or below a privacy fence must be republished only with a newer account revision",
);
assert.match(
  explicitProjectionMigration,
  /reset_daily_metric_projection_version[\s\S]{0,300}new\.privacy_projection_version := 1[\s\S]*accept_explicit_daily_metric_projection_v2[\s\S]{0,450}new\.privacy_projection_version := 2/,
  "legacy updates of existing v2 rows must be downgraded before the privacy trigger runs",
);

assert.match(log, /updateMetric\(selected\.id, \{[\s\S]*defaultVisibility: option\.value/);
assert.match(
  appProvider,
  /dailyMetricStatuses: next\.dailyMetricStatuses\.map\([\s\S]*visibility: action\.changes\.defaultVisibility/,
);
assert.match(health, /export function healthVisibilityByMetric/);
assert.match(health, /importedMetricVisibility\(visibility,\s*metric\.id\)/);
assert.match(foregroundHealth, /healthVisibilityByMetric\(current\.metrics\)/);
assert.match(backgroundHealth, /healthVisibilityByMetric\(state\.metrics\)/);

for (const mode of [
  "daily",
  "selected_days",
  "every_other_day",
  "interval_days",
  "days_of_month",
])
  assert.match(challenge, new RegExp(`"${mode}"`));
assert.match(challenge, /intervalDays:/);
assert.match(challenge, /daysOfWeek:/);
assert.match(challenge, /daysOfMonth:/);

assert.match(names, /randomGroupNameSuggestion\(random = Math\.random\)/);
assert.match(
  createGroup,
  /const \[name, setName\] = useState<string>\(\(\) =>[\s\S]{0,50}randomGroupNameSuggestion\(\)/,
  "a cute stable name must be the editable value, not a placeholder",
);
assert.match(createGroup, /value=\{name\}[\s\S]{0,220}selectTextOnFocus/);
assert.doesNotMatch(createGroup, /Use suggested group name|Try [“\"]\$\{nameSuggestion\}/);

console.log(
  "Group history/privacy validation passed: gap repair, bounded range hydration, collapsible calendars, durable visibility, rich challenge repeats, future invitations, and stable name suggestions.",
);
