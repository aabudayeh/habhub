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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const cloud = read("src/cloud/groupCloud.ts");
const provider = read("src/cloud/CloudSyncProvider.tsx");
const group = read("app/(tabs)/group.tsx");
const leaderboardDetail = read("app/leaderboard-detail.tsx");
const log = read("app/(tabs)/log.tsx");
const appProvider = read("src/state/AppProvider.tsx");
const groupActivityCacheTypes = read(
  "src/storage/groupActivityCache.types.ts",
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

assert.match(cloud, /remoteStatusCount < expectedStatusCount/);
assert.match(cloud, /select\("metric_id", \{ count: "exact", head: true \}\)/);
assert.match(cloud, /expectedCoverageDates[\s\S]*fastRecentDates/);
assert.match(provider, /refreshActivity: \(sinceDate\?: string\)/);
assert.match(provider, /refreshGroupActivity\([\s\S]*sinceDate/);
assert.match(group, /cloud\.refreshActivity\(targetedActivitySince\)/);
assert.match(
  group,
  /period === "overall"[\s\S]*SHARED_LEADERBOARD_SUMMARY_START/,
);
assert.match(group, /calendarPeriodRange\(anchor, gridRange, weekStartsOn\)/);
assert.match(group, /\["week", "month", "year"\]/);
assert.match(group, /Expand all/);
assert.match(group, /Collapse all/);
assert.match(group, /useState<string\[]>\(\[\]\)/);
assert.match(group, /sharedLeaderboardHeatmapModel/);
assert.match(group, /const LeaderboardMemberGrid = React\.memo/);
assert.match(group, /const gridModel = useMemo/);
assert.doesNotMatch(group, /rows\.slice\(0, 4\)\.map/);
assert.match(group, /pathname: "\/day\/\[date\]"/);
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
assert.match(cloud, /if \(entry\.visibility !== "group"\) return/);
assert.match(
  cloud,
  /entry\.userId !== source\.currentUserId \|\|[\s\S]*entry\.visibility === "group"/,
);
assert.match(
  read("src/domain/metrics.ts"),
  /const verifiedProjectionValue =[\s\S]*privacyProjectionVersion === 2[\s\S]*const localExactValue = canUseCachedSharedRaw\([\s\S]*authoritativeSharedExactValue\([\s\S]*visibility === "status"[\s\S]*authoritativeExactValue !== undefined/,
  "an authoritative status/private projection must override stale cached raw entries",
);
assert.match(
  leaderboardDetail,
  /statusForDay\([\s\S]{0,500}const verifiedExactValue =[\s\S]{0,300}canUseCachedSharedRaw\([\s\S]{0,180}verifiedExactValue/,
  "leaderboard detail history must apply the same per-day cache privacy fence",
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
  /GROUP_ACTIVITY_CACHE_SCHEMA_VERSION = 2/,
  "the privacy release must invalidate pre-fence scoped activity caches",
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
assert.match(
  appProvider,
  /function stateForLocalPersistence[\s\S]{0,650}entries: state\.entries\.filter\([\s\S]{0,160}currentUserId[\s\S]{0,350}photos: state\.photos\.filter\([\s\S]{0,160}currentUserId/,
  "account persistence must never retain foreign activity or signed photo URLs, including after a group switch",
);
assert.match(
  provider,
  /function purgeDepartedGroupData[\s\S]{0,400}entries: state\.entries\.filter\([\s\S]{0,120}entry\.userId === state\.currentUserId[\s\S]{0,650}messageBelongsToCloudGroup/,
  "definitive membership loss must purge all peer activity and that group's chat/media",
);
assert.match(
  provider,
  /leaveCloudGroup\(groupId\)[\s\S]{0,350}purgeDepartedGroupData[\s\S]{0,250}removeGroupActivityCache\(groupId\)/,
  "a successful explicit leave must purge in-memory and scoped group caches",
);
assert.match(
  provider,
  /isDefinitiveGroupMembershipLoss\(error\)[\s\S]{0,120}evictUnavailableGroup\(groupId\)/,
  "a definitive server-side membership loss must evict the unavailable group without treating transient failures as revocation",
);
assert.match(
  provider,
  /removed\.user_id === auth\.user\?\.id[\s\S]{0,300}evictUnavailableGroup\(removed\.group_id\)/,
  "an unfilterable membership DELETE event must never evict the viewer for another member's deletion",
);
assert.match(
  provider,
  /verifyActiveGroupMembership[\s\S]{0,500}hasActiveCloudGroupMembership[\s\S]{0,250}evictUnavailableGroup/,
  "resume and reconnect must authoritatively verify membership instead of relying on DELETE delivery",
);
assert.match(
  provider,
  /const removed = event\.old as \{ group_id\?: string \}[\s\S]{0,150}removed\.group_id === stateRef\.current\.group\.id[\s\S]{0,100}queueRefresh/,
  "an unfilterable group-members DELETE must be scoped explicitly before refreshing",
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
assert.match(health, /importedMetricVisibility\(visibility,metric\.id\)/);
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
