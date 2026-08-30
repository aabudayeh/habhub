import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  challengeCardId,
  challengeIdFromCard,
  acceptedChallengeParticipantIds,
  challengePeriodDates,
  challengePresetEndDate,
  challengeReminderIntervalDays,
  challengeStandingPosition,
  groupChallengeAvailability,
  groupChallengeJoinDeadline,
  groupChallengeResponseDeadline,
  groupChallengeParticipation,
  validChallengeRecurrence,
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
  isChallengeMetric,
  mergedLeaderboardCardOrder,
  openChallengeGoalProgress,
  validChallengeDate,
  validChallengePeriod,
  validateGroupChallenge,
} from "../src/domain/groupChallengeRules.ts";

const numericalMetric = { dataType: "number", sections: { group: true } };
assert.equal(isChallengeMetric(numericalMetric), true);
assert.equal(
  isChallengeMetric({ dataType: "boolean", sections: { group: true } }),
  false,
);
assert.equal(
  isChallengeMetric({ dataType: "number", sections: { group: false } }),
  false,
);
assert.equal(validChallengeDate("2028-02-29"), true);
assert.equal(validChallengeDate("2027-02-29"), false);
assert.equal(challengePresetEndDate("2026-08-22", "week"), "2026-08-28");
assert.equal(challengePresetEndDate("2028-02-29", "year"), "2029-02-28");
assert.equal(challengePeriodDates("2026-08-22", "2026-08-24").length, 3);
assert.equal(validChallengePeriod("2026-08-22", "2027-08-22"), true);
assert.equal(validChallengePeriod("2026-08-22", "2027-08-24"), false);
assert.equal(challengeReminderIntervalDays("2026-08-22", "2026-08-28"), 1);
assert.equal(challengeReminderIntervalDays("2026-08-22", "2026-09-21"), 2);
assert.equal(openChallengeGoalProgress(0.72, 0.4), 0.72);
assert.equal(openChallengeGoalProgress(1.4, 0.4), 1);
assert.equal(openChallengeGoalProgress(undefined, 0.4), 0.4);
assert.equal(
  validChallengeRecurrence(
    {
      mode: "selected_days",
      anchorDate: "2026-08-13",
      endDate: "2026-09-13",
      daysOfWeek: [4],
    },
    "2026-08-13",
  ),
  true,
);
assert.equal(
  validChallengeRecurrence(
    {
      mode: "daily",
      anchorDate: "2026-08-13",
      endDate: "2028-08-13",
    },
    "2026-08-13",
  ),
  false,
  "recurrence must stay bounded to one year",
);
assert.equal(challengeIdFromCard(challengeCardId("abc")), "abc");
assert.deepEqual(challengeValueOutcome(0, 80, "lower"), {
  complete: true,
  progress: 1,
});
assert.deepEqual(challengeValueOutcome(80, 80, "lower"), {
  complete: true,
  progress: 1,
});
assert.deepEqual(challengeValueOutcome(100, 80, "lower"), {
  complete: false,
  progress: 0.8,
});
assert.equal(compareChallengeValues(70, 90, 80, "lower") < 0, true);
assert.equal(compareChallengeValues(79, 90, 80, "closest") < 0, true);
assert.equal(compareChallengeValues(12_000, 9_000, 10_000, "higher") < 0, true);
assert.equal(challengeStandingPosition(100, [100, 100, 90], 0, "higher"), 1);
assert.equal(
  challengeStandingPosition(90, [100, 100, 90], 0, "higher"),
  3,
  "challenge ranks must share first across ties and skip second",
);
assert.deepEqual(challengeValueOutcome(100.5, 100, "closest"), {
  complete: true,
  progress: 1,
});
assert.deepEqual(challengeValueOutcome(120, 100, "closest"), {
  complete: false,
  progress: 0.8,
});
const exactRow = (id, value, complete = true) => ({
  member: { id },
  mode: "exact",
  value,
  progress: complete ? 1 : 0.5,
  complete,
  valueLabel: String(value),
});
assert.deepEqual(
  challengeWinnerIds(
    [exactRow("a", 12_000), exactRow("b", 11_000)],
    10_000,
    "higher",
  ),
  ["a"],
  "meeting the target alone is not a win when somebody ranks higher",
);
assert.deepEqual(
  challengeWinnerIds(
    [exactRow("a", 12_000), exactRow("b", 12_000), exactRow("c", 11_000)],
    10_000,
    "higher",
  ),
  ["a", "b"],
  "an exact first-place tie creates one co-win for each tied member",
);
assert.deepEqual(
  challengeWinnerIds(
    [exactRow("a", 90), exactRow("b", 110), exactRow("c", 120, false)],
    100,
    "closest",
  ),
  ["a", "b"],
  "equal distance from a closest target is a real tie",
);
assert.deepEqual(
  challengeWinnerIds(
    [
      exactRow("a", 12_000),
      exactRow("b", 11_000),
      {
        member: { id: "private" },
        mode: "private",
        value: 0,
        progress: 0,
        complete: false,
        valueLabel: "Exact value not shared",
      },
    ],
    10_000,
    "higher",
  ),
  [],
  "a hidden invited value keeps the outcome unresolved",
);
assert.deepEqual(
  challengeWinnerIds([exactRow("a", 12_000)], 10_000, "higher"),
  [],
  "one exact participant cannot win an uncontested challenge",
);
assert.deepEqual(
  challengeWinnerIds(
    [exactRow("a", 9_000, false), exactRow("b", 12_000, false)],
    undefined,
    "lower",
  ),
  ["b"],
  "an open challenge ignores target completion and always awards the highest total",
);
assert.deepEqual(
  mergedLeaderboardCardOrder(
    ["steps", challengeCardId("old"), "removed"],
    ["steps", "water"],
    [{ id: "old" }, { id: "new" }],
  ),
  ["steps", challengeCardId("old"), challengeCardId("new"), "water"],
  "saved cross-card order must survive while stale cards are removed and new cards appear",
);

const valid = {
  title: "20k sprint",
  target: 20_000,
  localDate: "2026-08-11",
  metric: numericalMetric,
  participantIds: ["friend"],
  creatorId: "creator",
};
assert.equal(validateGroupChallenge(valid), undefined);
assert.equal(
  validateGroupChallenge({
    ...valid,
    target: undefined,
    endDate: "2026-08-17",
  }),
  undefined,
  "a bounded open date-range challenge is valid",
);
assert.match(
  validateGroupChallenge({ ...valid, endDate: "2026-08-10" }),
  /end date within one year/i,
);
assert.match(
  validateGroupChallenge({ ...valid, target: 0 }),
  /greater than zero/i,
);
const invitationChallenge = {
  id: "series",
  groupId: "group",
  creatorId: "creator",
  metricId: "steps",
  target: 10_000,
  localDate: "2026-08-13",
  participantIds: ["creator", "friend", "declined"],
  acceptedParticipantIds: ["creator"],
  declinedParticipantIds: ["declined"],
  recurrence: {
    mode: "daily",
    anchorDate: "2026-08-13",
    endDate: "2026-08-15",
  },
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};
assert.deepEqual(acceptedChallengeParticipantIds(invitationChallenge), ["creator"]);
assert.equal(groupChallengeParticipation(invitationChallenge, "friend"), "invited");
assert.equal(groupChallengeParticipation(invitationChallenge, "declined"), "declined");
assert.equal(groupChallengeResponseDeadline(invitationChallenge), "2026-08-13");
assert.equal(groupChallengeJoinDeadline(invitationChallenge), "2026-08-15");
assert.equal(
  groupChallengeAvailability(invitationChallenge, "2026-08-14"),
  "active",
);
assert.equal(
  groupChallengeAvailability(invitationChallenge, "2026-08-16"),
  "finished",
);
assert.equal(
  groupChallengeAvailability(
    { ...invitationChallenge, localDate: "2026-08-20" },
    "2026-08-14",
  ),
  "upcoming",
);
assert.match(
  validateGroupChallenge({ ...valid, today: "2026-08-12", localDate: "2026-08-11" }),
  /today or a future date/i,
);
assert.match(
  validateGroupChallenge({ ...valid, participantIds: ["creator"] }),
  /at least one friend/i,
);
assert.equal(
  validateGroupChallenge({
    ...valid,
    audience: "public",
    participantIds: ["creator"],
  }),
  undefined,
  "a public challenge starts with its creator and allows instant self-join",
);
assert.match(
  validateGroupChallenge({
    ...valid,
    audience: "public",
    participantIds: ["creator"],
    participantLimit: 1,
  }),
  /limit from 2 to 5,000/i,
);
assert.match(
  validateGroupChallenge({
    ...valid,
    audience: "public",
    participantIds: ["creator"],
    participantLimit: 5_001,
  }),
  /limit from 2 to 5,000/i,
  "creator-unlimited challenges still need an operational row-size ceiling",
);

const root = path.resolve(import.meta.dirname, "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608110001_group_friend_challenges.sql",
  ),
  "utf8",
);
const responseMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608130001_group_challenge_responses_and_recurrence.sql",
  ),
  "utf8",
);
const notificationMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608140001_group_notification_events.sql",
  ),
  "utf8",
);
const notificationActivation = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608140002_activate_group_notification_events.sql",
  ),
  "utf8",
);
const periodMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608220006_group_challenge_periods_and_notifications.sql",
  ),
  "utf8",
);
const notificationAmbiguityRepair = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608240004_fix_challenge_notification_event_key_ambiguity.sql",
  ),
  "utf8",
);
const notificationGuardHardening = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608240006_worker_and_challenge_guard_hardening.sql",
  ),
  "utf8",
);
const notificationUuidHotfix = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608220008_challenge_notification_uuid_aggregate_fix.sql",
  ),
  "utf8",
);
const discoveryMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608230001_group_challenge_discovery_and_self_join.sql",
  ),
  "utf8",
);
const allAcceptedMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608230004_challenge_all_accepted_notification.sql",
  ),
  "utf8",
);
const publicChallengeMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608270002_public_challenges_and_sync_settlement.sql",
  ),
  "utf8",
);
const challengeRankMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608270005_challenge_rank_rewards.sql",
  ),
  "utf8",
);
const challengeVisualMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "202608280002_shared_challenge_visuals.sql",
  ),
  "utf8",
);
const challengeWorker = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "functions",
    "challenge-notifications",
    "index.ts",
  ),
  "utf8",
);
const publicChallengeProjectionBackend = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "functions",
    "_shared",
    "public-challenge-projection.ts",
  ),
  "utf8",
);
const publicChallengeProjectionClient = fs.readFileSync(
  path.join(root, "src", "cloud", "publicChallengeProjection.ts"),
  "utf8",
);
const supabaseConfig = fs.readFileSync(
  path.join(root, "supabase", "config.toml"),
  "utf8",
);
const hook = fs.readFileSync(
  path.join(root, "src", "cloud", "useGroupChallenges.ts"),
  "utf8",
);
const cloud = fs.readFileSync(
  path.join(root, "src", "cloud", "groupChallenges.ts"),
  "utf8",
);
const challengeSaveClient = cloud.slice(
  cloud.indexOf("export async function saveGroupChallenge"),
  cloud.indexOf("export async function respondToGroupChallenge"),
);
const progress = fs.readFileSync(
  path.join(root, "src", "domain", "groupChallenges.ts"),
  "utf8",
);
const badges = fs.readFileSync(
  path.join(root, "src", "domain", "badges.ts"),
  "utf8",
);
const badgeScreen = fs.readFileSync(path.join(root, "app", "badges.tsx"), "utf8");
const alertsScreen = fs.readFileSync(path.join(root, "app", "alerts.tsx"), "utf8");
const badgeChallengeInputs = fs.readFileSync(
  path.join(root, "src", "cloud", "useBadgeChallengeInputs.ts"),
  "utf8",
);
const memberComparison = fs.readFileSync(
  path.join(root, "app", "member", "[id].tsx"),
  "utf8",
);
const memberProfile = fs.readFileSync(
  path.join(root, "app", "member-profile", "[id].tsx"),
  "utf8",
);
const challengeEditor = fs.readFileSync(
  path.join(root, "src", "components", "GroupChallengeEditor.tsx"),
  "utf8",
);
const sendPush = fs.readFileSync(
  path.join(root, "supabase", "functions", "send-push", "index.ts"),
  "utf8",
);
const groupScreen = fs.readFileSync(
  path.join(root, "app", "(tabs)", "group.tsx"),
  "utf8",
);
const groupSettings = fs.readFileSync(
  path.join(root, "app", "group-settings.tsx"),
  "utf8",
);
const challengeVisual = fs.readFileSync(
  path.join(root, "src", "components", "ChallengeVisual.tsx"),
  "utf8",
);
const challengesScreen = fs.readFileSync(
  path.join(root, "app", "challenges.tsx"),
  "utf8",
);
const groupNotificationEvents = fs.readFileSync(
  path.join(root, "src", "cloud", "groupNotificationEvents.ts"),
  "utf8",
);
const publicProjectionBatchFunction = challengeRankMigration.slice(
  challengeRankMigration.indexOf(
    "create or replace function public.project_public_challenge_totals_batch",
  ),
  challengeRankMigration.indexOf(
    "revoke all on function public.project_public_challenge_totals_batch",
  ),
);
const publicProjectionCacheFunction = challengeRankMigration.slice(
  challengeRankMigration.indexOf(
    "create or replace function public.refresh_public_challenge_snapshot_cache",
  ),
  challengeRankMigration.indexOf(
    "revoke all on function public.refresh_public_challenge_snapshot_cache",
  ),
);
const legacyPublicProjectionFunction = challengeRankMigration.slice(
  challengeRankMigration.indexOf(
    "create or replace function public.publish_joined_public_challenge_totals",
  ),
  challengeRankMigration.indexOf(
    "revoke all on function public.publish_joined_public_challenge_totals",
  ),
);

assert.match(migration, /alter table public\.group_challenges enable row level security/i);
assert.match(
  migration,
  /auth\.uid\(\) = any\(participant_ids\)[\s\S]*public\.is_group_member\(group_id\)/i,
  "only involved active members may read a challenge",
);
assert.match(migration, /revoke all on table public\.group_challenges from public, anon, authenticated/i);
assert.match(migration, /grant select on table public\.group_challenges to authenticated/i);
assert.match(migration, /definition\.data_type in \('number', 'calculated'\)/i);
assert.match(migration, /member\.status = 'active'[\s\S]*member\.user_id = any\(v_participants\)/i);
assert.match(migration, /v_existing\.creator_id <> v_user_id[\s\S]*public\.is_group_admin/i);
assert.match(
  migration,
  /v_participants := v_existing\.participant_ids/,
  "an edit must not silently revoke realtime visibility from invited members",
);
assert.match(migration, /alter publication supabase_realtime add table public\.group_challenges/i);
assert.match(responseMigration, /accepted_participant_ids <@ participant_ids/i);
assert.match(responseMigration, /not \(accepted_participant_ids && declined_participant_ids\)/i);
assert.match(responseMigration, /creator_id = any\(accepted_participant_ids\)/i);
assert.match(responseMigration, /create or replace function public\.respond_group_challenge/i);
assert.match(responseMigration, /public\.is_group_member\(v_challenge\.group_id\)/i);
assert.match(responseMigration, /v_user_id = any\(v_challenge\.participant_ids\)/i);
assert.match(responseMigration, /v_end_date > p_local_date \+ 366/i);
assert.match(responseMigration, /v_existing\.local_date < current_date - 1/i);
assert.match(responseMigration, /v_challenge\.local_date < current_date - 1/i);
assert.match(
  responseMigration,
  /if v_mode = 'interval_days' and \(\s*case[\s\S]*?end\s*\) then/i,
  "the interval recurrence CASE expression must be parenthesized for PL/pgSQL",
);
assert.match(responseMigration, /grant execute on function public\.respond_group_challenge\(uuid, boolean\)/i);
assert.match(hook, /trailingRefreshRef\.current = true/);
assert.match(hook, /\}, 180\)/);
assert.match(hook, /respondToGroupChallenge\(sourceId, response\)/);
assert.match(hook, /discoverActive \? loadActiveGroupChallenges : loadGroupChallenges/);
assert.match(
  hook,
  /!discoverActive[\s\S]{0,100}!discoveryPollingEnabled/,
  "active discovery polling must require a focused route",
);
assert.match(
  hook,
  /document\.visibilityState !== "hidden"[\s\S]{0,180}NativeAppState\.currentState === "active"/,
  "active discovery polling must require a visible runtime",
);
assert.match(
  hook,
  /const resumePolling = \(\) => \{[\s\S]{0,300}void refresh\(\)[\s\S]{0,180}setInterval\(\(\) => \{/,
  "returning to active discovery must refresh once before restarting its bounded poll",
);
assert.match(
  hook,
  /NativeAppState\.addEventListener\([\s\S]{0,100}"change"[\s\S]{0,180}resumePolling\(\)[\s\S]{0,180}stopPolling\(\)/,
  "native discovery polling must stop in the background and resume on foreground",
);
assert.match(
  hook,
  /document\.addEventListener\("visibilitychange", onVisibilityChange\)[\s\S]{0,350}document\.removeEventListener\("visibilitychange", onVisibilityChange\)/,
  "web discovery polling must follow document visibility without leaking listeners",
);
assert.match(
  hook,
  /subscribePrivateBroadcast\([\s\S]{0,100}`group:\$\{groupId\}:challenges`/,
  "focus-gating discovery polling must preserve challenge realtime invalidation",
);
assert.match(
  hook,
  /participantIds:[\s\S]{0,180}challenge\.participantIds,[\s\S]{0,100}state\.currentUserId/,
  "tutorial self-join must keep participant and accepted membership consistent",
);
assert.match(hook, /sendGroupChallengeStartedPush\(saved\)/);
assert.match(hook, /sendGroupChallengeAcceptedPush/);
assert.match(
  hook,
  /subscribePrivateBroadcast\([\s\S]{0,100}`group:\$\{groupId\}:challenges`[\s\S]{0,80}"challenges_updated"/,
  "mounted challenge hooks must share the active group's private invalidation topic",
);
assert.doesNotMatch(
  hook,
  /postgres_changes|useId\(\)/,
  "challenge screens must not reopen per-hook Postgres Changes streams",
);
assert.match(cloud, /\.limit\(200\)/, "challenge reads must stay bounded");
assert.match(cloud, /rpc\("list_active_group_challenges"/);
assert.match(cloud, /participantCount: row\.participant_count/);
assert.match(cloud, /viewerParticipation: row\.viewer_participation/);
assert.match(cloud, /eligibleToJoin: row\.eligible_to_join/);
assert.match(cloud, /p_recurrence: input\.recurrence \?\? null/);
assert.match(cloud, /p_end_date: input\.endDate \?\? input\.localDate/);
assert.match(cloud, /rpc\("list_my_challenge_standings"/);
assert.match(cloud, /rpc\(\s*"list_challenge_standings"/);
assert.match(cloud, /rpc\("set_my_challenge_preference"/);
assert.match(cloud, /rpc\("withdraw_from_group_challenge"/);
assert.doesNotMatch(
  cloud,
  /body:\s*"A friend accepted your challenge\."/,
  "client acceptance fallback must carry the accepting account name",
);
assert.match(hook, /state\.groups[\s\S]{0,240}\.name \?\?[\s\S]{0,80}"A member"/);
assert.match(cloud, /category: "challenge"/);
assert.match(cloud, /eventKey: `challenge-started:\$\{challenge\.id\}`/);
assert.doesNotMatch(
  cloud,
  /sendGroupChallengeStartedPush[\s\S]{0,450}Promise\.all/,
  "challenge-start notifications must use one server-side fan-out",
);
assert.match(sendPush, /legacyCommittedCanonicalEvent/);
assert.match(sendPush, /challenge\.creator_id === dispatcherId/);
assert.match(sendPush, /acceptedIds\.includes\(dispatcherId\)/);
assert.match(sendPush, /canonical\.category === "challenge"/);
assert.match(sendPush, /challengePushCopy/);
assert.match(sendPush, /event\.audience === "challenge_participants"/);
assert.match(sendPush, /settings\.challenges \?\? settings\.badgesAndWinners \?\? true/);
assert.match(sendPush, /groupPreference\.challengeStandings === false/);
assert.match(sendPush, /groupPreference\.challengeReminders === false/);
assert.match(sendPush, /groupPreference\.challengeResults === false/);
assert.match(notificationMigration, /create table if not exists public\.group_notification_events/);
assert.match(notificationMigration, /create or replace function public\.emit_group_challenge_feed_events/);
assert.match(
  notificationMigration,
  /cross join lateral unnest\(challenge\.participant_ids\)[\s\S]{0,160}join public\.group_members membership[\s\S]{0,220}membership\.status = 'active'/,
  "the challenge-feed backfill must skip stale or inactive participant UUIDs",
);
assert.doesNotMatch(
  notificationMigration.slice(
    notificationMigration.indexOf("create or replace function public.emit_group_challenge_feed_events"),
    notificationMigration.indexOf("create or replace function public.emit_group_membership_push_event"),
  ),
  /push_dispatch_events/,
  "the expand-phase challenge feed trigger must never emit push rows",
);
assert.match(notificationActivation, /drop trigger if exists group_challenges_emit_feed_events/);
assert.match(notificationActivation, /execute function public\.emit_group_challenge_notification_events/);
assert.match(
  progress,
  /result\.mode === "exact" && result\.visibleDays > 0/,
  "custom-target progress must require an exact privacy-permitted value",
);
assert.match(
  progress,
  /hasStatusOnlyPeriodData[\s\S]{0,500}mode: "private"/,
  "status-only data must not be reverse engineered for a custom target",
);
assert.match(progress, /groupChallengeEndDate\(challenge\) >= today/);
assert.match(progress, /seen\.has\(challenge\.id\)/);
assert.match(progress, /expandGroupChallengeOccurrences/);
assert.match(progress, /limit = 200/);
assert.match(progress, /\.slice\(0, Math\.max\(0, Math\.floor\(limit\)\)\)/);
assert.match(progress, /expandGroupChallengeOccurrences\(challenges, earliest, throughDate, 5_000\)/);
assert.match(progress, /acceptedChallengeParticipantIds\(challenge\)/);
assert.match(progress, /challengeStandingPosition\(/);
assert.match(badges, /id: `challenge-wins:\$\{member\.id\}`/);
assert.equal(
  (badges.match(/id: `challenge-wins:\$\{member\.id\}`/g) ?? []).length,
  1,
  "each member must have one general challenge-win badge, never one per milestone",
);
assert.match(badges, /`\$\{count\} challenge win`/);
assert.match(badges, /`\$\{count\} challenge wins`/);
assert.match(badges, /"challenge-seconds:": 60/);
assert.match(badges, /"challenge-thirds:": 35/);
assert.match(badges, /"challenge-finishes:": 15/);
assert.match(badges, /id: `\$\{id\}:\$\{member\.id\}`/);
assert.match(
  challengeEditor,
  /<SelectionMenu[\s\S]{0,180}title="Choose tracker"[\s\S]{0,220}multiple=\{false\}/,
  "challenge tracker selection should use the accessible list menu",
);
assert.match(challengesScreen, /const handlePageChange = useCallback/);
assert.match(challengesScreen, /onPageSettled=\{handlePageChange\}/);
assert.match(challengesScreen, /Your rank · #\$\{standingPosition\} of/);
assert.match(challengesScreen, /setExpandedId/);
assert.match(
  challengesScreen,
  /loadChallengeStandings\(\s*groupChallengeSourceId\(challenge\),\s*challenge\.localDate/,
  "expanded recurring challenge cards must request their exact occurrence",
);
assert.match(challengesScreen, /discoverActive: true/);
assert.match(challengesScreen, /challengeSettlementKey\(/);
assert.match(
  challengesScreen,
  /RECENT_PAST_OCCURRENCE_LIMIT = 200[\s\S]{0,9000}expandGroupChallengeOccurrences\([\s\S]{0,220}RECENT_PAST_OCCURRENCE_LIMIT/,
  "the Challenges screen must bound ordinary Past rendering",
);
assert.match(
  challengesScreen,
  /requestedOccurrence[\s\S]{0,500}!rows\.some[\s\S]{0,220}rows\.push\(requestedOccurrence\)/,
  "an exact older notification occurrence must survive the recent-history cap",
);
assert.match(challengesScreen, /challengeShareAt: Date\.now\(\)\.toString\(\)/);
assert.match(challengesScreen, /onLongPress=\{\(\) => setEditingMode\(true\)\}/);
assert.match(groupScreen, /useChallengePreferences\(\)/);
assert.match(groupScreen, /preference\?\.hidden \|\| preference\?\.withdrawnAt/);
assert.match(groupScreen, /onRemove=\{\(\) => hideChallenge\(challenge\)\}/);
assert.match(
  badgeChallengeInputs,
  /useGroupChallenges\(groupId\)[\s\S]*useSettledChallengeResults\(groupId\)[\s\S]*usePublicChallenges\(loadPublicPlacements\)/,
  "shared badge inputs must combine live group challenges, durable settlements, and gated public challenges",
);
assert.match(
  badgeChallengeInputs,
  /localChallengeIds[\s\S]*!localChallengeIds\.has\(groupChallengeSourceId\(challenge\)\)[\s\S]*groupChallengeEndDate\(challenge\) < anchor/,
  "public badge placements must exclude group duplicates and unfinished occurrences",
);
assert.match(
  badgeChallengeInputs,
  /expandGroupChallengeOccurrences\(sources, earliest, anchor, 500\)/,
  "public badge occurrence expansion must remain bounded",
);
assert.match(
  badgeChallengeInputs,
  /loadChallengeViewerStandings\(publicPlacementRequests\)[\s\S]*\[publicPlacementChallengeKey\]/,
  "public badge standings must be loaded in one bounded request behind a stable occurrence key",
);
assert.match(
  badgeChallengeInputs,
  /\.\.\.\(settledChallengeResults\.placements \?\? \[\]\)[\s\S]*\.\.\.publicChallengePlacements/,
  "shared badge inputs must merge immutable group settlements with privacy-safe public placements",
);
assert.match(
  badgeChallengeInputs,
  /challenges: challengeCloud\.challenges[\s\S]*placements,[\s\S]*settledOccurrenceKeys: settledChallengeResults\.occurrenceKeys/,
  "the shared hook must expose the complete challenge badge contract",
);
assert.match(
  badgeScreen,
  /const badgeChallengeInputs = useBadgeChallengeInputs\([\s\S]*?state\.group\.id,[\s\S]*?state\.currentUserId,[\s\S]*?anchor,[\s\S]*?\);/,
  "the badge cabinet must obtain its challenge inputs from the shared hook",
);
assert.match(
  badgeScreen,
  /buildBadges\([\s\S]*?badgeChallengeInputs\.challenges,[\s\S]*?badgeChallengeInputs\.placements,[\s\S]*?badgeChallengeInputs\.settledOccurrenceKeys,[\s\S]*?\)/,
  "badge XP must consume every shared challenge input",
);
assert.match(
  alertsScreen,
  /const badgeChallengeInputs = useBadgeChallengeInputs\([\s\S]*?state\.group\.id,[\s\S]*?state\.currentUserId,[\s\S]*?badgeAnchor,[\s\S]*?filter === "badges",[\s\S]*?\);/,
  "badge alerts must share the same inputs and gate public placement reads to the badge tab",
);
assert.match(
  alertsScreen,
  /buildBadges\([\s\S]*?badgeChallengeInputs\.challenges,[\s\S]*?badgeChallengeInputs\.placements,[\s\S]*?badgeChallengeInputs\.settledOccurrenceKeys,[\s\S]*?\)/,
  "badge alerts must consume every shared challenge input",
);
assert.match(
  memberComparison,
  /label="Create challenge"[\s\S]*setChallengeEditorOpen\(true\)/,
  "friend comparison must expose a direct challenge action",
);
assert.match(
  memberComparison,
  /initialParticipantIds=\{challengeParticipantIds\}/,
  "friend comparison must preselect the viewed friend",
);
assert.match(
  memberComparison,
  /challengeCloud\.save\(input\)/,
  "friend-created challenges must update the shared read model immediately",
);
assert.match(memberProfile, /title="Badge showcase"/);
assert.match(memberProfile, /selectShowcase: "true"/);
assert.match(
  memberProfile,
  /accessibilityLabel=\{isSelf \? "Edit badge showcase" : "View all badges"\}/,
  "the profile must expose a compact, accessible showcase editor",
);
assert.match(
  challengeEditor,
  /challenge\?\.participantIds \?\?[\s\S]*initialParticipantIds \?\?/,
  "new challenges must honor the caller's initial participant selection",
);
assert.match(challengeEditor, /Invited members choose to accept or decline\./);
assert.match(challengeEditor, /recurrence\?\.mode === "daily"/);
assert.match(challengeEditor, /repeatMode === "selected_days"/);
assert.match(challengeEditor, /repeatMode === "interval_days"/);
assert.match(challengeEditor, /repeatMode === "days_of_month"/);
assert.match(challengeEditor, /import \{ SelectionMenu \}/);
assert.match(
  challengeEditor,
  /<SelectionMenu[\s\S]{0,120}title="Frequency"[\s\S]{0,180}multiple=\{false\}[\s\S]{0,180}items=\{CHALLENGE_REPEAT_OPTIONS\}/,
  "challenge frequency should use the same compact selection menu as reminders",
);
for (const label of [
  "Once",
  "Every day",
  "Selected weekdays",
  "Every other day",
  "Custom interval",
  "Dates each month",
])
  assert.match(challengeEditor, new RegExp(`label: "${label}"`));
assert.doesNotMatch(
  challengeEditor,
  /styles\.repeatChip|styles\.repeatRow/,
  "the legacy challenge frequency chip cloud must stay removed",
);
assert.match(challengeEditor, /mode: repeatMode/);
assert.match(challengeEditor, /endDate: repeatUntil/);
assert.match(challengeEditor, /label: "Most wins"/);
assert.match(
  challengeEditor,
  /styles\.ruleChoices, styles\.targetRuleChoices/,
  "target and most-wins controls must not touch the tracker picker",
);
assert.match(challengeEditor, /const \[visualOpen, setVisualOpen\] = useState\(false\)/);
assert.match(
  challengeEditor,
  /accessibilityState=\{\{ expanded: visualOpen \}\}/,
  "optional challenge art must begin collapsed and disclose an accessible icon picker",
);
assert.match(challengeEditor, /CHALLENGE_VISUAL_ICONS\.map\(\(icon\) =>/);
assert.match(challengeEditor, /ImagePicker\.launchImageLibraryAsync/);
assert.match(challengeEditor, /previousVisualImageStoragePath: challenge\?\.visualImageStoragePath/);
assert.match(challengeVisual, /imageUri \? \([\s\S]{0,180}<Image/);
assert.match(challengeVisual, /challenge\.audience === "public" \? "earth-outline" : "trophy-outline"/);
assert.match(challengeEditor, /items=\{CHALLENGE_DURATION_OPTIONS\}/);
assert.match(challengeEditor, /endDate: resolvedEndDate/);
assert.match(challengeEditor, /function recurringScheduleKey/);
assert.match(challengeEditor, /challenge\?\.recurrence\?\.anchorDate/);
assert.match(challengeEditor, /historicalRecurringRulesLocked/);
assert.match(
  challengeEditor,
  /recurrence\.endDate < recurringHistoryBoundary/,
);
assert.match(challengeEditor, /today: !challenge \|\| repeatingScheduleChanged \? dateKey\(\) : undefined/);
assert.match(
  groupScreen,
  /challengeCloud[\s\S]*\.respond\(groupChallengeSourceId\(challenge\), response\)/,
);
assert.match(groupScreen, /expandGroupChallengeOccurrences/);
assert.match(groupScreen, /groupChallengeResponseDeadline\(challenge\) >= dateKey\(\)/);
assert.match(groupScreen, /routeParams\.challengeId/);
assert.match(groupScreen, /routeParams\.groupId/);
assert.match(
  groupScreen,
  /state\.groups\.some\(\(group\) => group\.id === requestedChallengeGroupId\)[\s\S]{0,650}cloud\.switchGroup\(requestedChallengeGroupId\)/,
  "a challenge push must switch to its locally authorized group before resolving the card",
);
assert.match(
  groupScreen,
  /requestedChallengeGroupId &&[\s\S]{0,100}state\.group\.id !== requestedChallengeGroupId/,
  "challenge focus must wait until the requested group is active",
);
assert.match(
  groupScreen,
  /setPeriod\("custom"\)[\s\S]{0,100}setAnchor\(focusDate\)/,
  "challenge deep links must select the notification occurrence's date",
);
assert.match(
  groupScreen,
  /setPendingChallengeCardId\(cardId\)[\s\S]{0,120}armChallengeHighlight\(cardId\)/,
  "challenge deep links must select the containing page and highlight the exact card",
);
assert.match(
  groupScreen,
  /!scrollToChallengeCard\(cardId\)[\s\S]{0,220}handledChallengeFocus\.current = focusKey/,
  "a challenge focus must only be acknowledged after its card can be scrolled into view",
);
assert.ok(
  (groupScreen.match(/completePendingChallengeFocus\(/g) ?? []).length >= 5,
  "cold challenge cards must retry focus from body, section, card, and pager layout boundaries",
);
assert.match(
  groupScreen,
  /pendingChallengeFocusKey\.current\)[\s\S]{0,160}completePendingChallengeFocus\(pendingChallengeCardId\)/,
  "paged challenge focus must remain pending until the requested page/card is laid out",
);
assert.match(groupScreen, /styles\.challengeHighlightRing/);
assert.match(groupScreen, /<ChallengeVisual challenge=\{challenge\}/);
assert.match(
  challengesScreen,
  /function openChallengeInLeaderboard\(challenge: GroupChallenge\)[\s\S]{0,320}preference\?\.hidden[\s\S]{0,500}pathname: "\/\(tabs\)\/group"[\s\S]{0,300}challengeOccurrenceDate: challenge\.localDate/,
  "visible challenge icons and names must deep-link to the exact Leaderboard occurrence",
);
assert.ok(
  (challengesScreen.match(/accessibilityRole="link"/g) ?? []).length >= 2,
  "both the challenge image and name must expose the Leaderboard deep link",
);
assert.match(
  challengesScreen,
  /const canOpenInLeaderboard =[\s\S]{0,180}!preference\?\.hidden[\s\S]{0,180}state\.groups\.some/,
  "hidden or inaccessible challenges must keep their established non-navigation behavior",
);
assert.match(
  groupScreen,
  /leaderboardDateNavigatorCollapsedByGroup[\s\S]{0,180}\[state\.group\.id\]: dateNavigatorOpen/,
  "Leaderboard date disclosure must persist per group",
);
assert.match(
  progress,
  /target === undefined[\s\S]{0,300}openChallengeGoalProgress/,
  "open challenges must use each member's tracker-goal bar instead of a leader percentage",
);
assert.match(
  groupScreen,
  /row\.member\.lastDataSyncedAt[\s\S]{0,900}row\.mode === "exact" \? row\.valueLabel : "—"/,
  "challenge rows must put last-sync under the name and the scored value above the progress bar",
);
assert.doesNotMatch(
  groupScreen,
  /"Your goal"[\s\S]{0,80}"Their goal"/,
  "challenge cards no longer label the same progress bar as your/their goal",
);
assert.match(groupScreen, /<ChallengeCompletionCelebration/);
assert.match(groupScreen, /const CHALLENGE_CELEBRATION_SCAN_LIMIT = 500/);
assert.match(
  groupScreen,
  /\.slice\(\s*-CHALLENGE_CELEBRATION_SCAN_LIMIT,\s*\)/,
);
assert.match(periodMigration, /alter column target_value drop not null/i);
assert.match(periodMigration, /add column if not exists end_date date/i);
assert.match(periodMigration, /create or replace function public\.group_challenge_exact_standings/i);
assert.match(periodMigration, /create or replace function public\.stage_group_challenge_notifications/i);
assert.match(publicChallengeMigration, /create or replace function public\.list_public_challenges/i);
assert.match(publicChallengeMigration, /create or replace function public\.save_public_challenge/i);
assert.match(
  challengeVisualMigration,
  /add column if not exists visual_icon text,[\s\S]{0,100}add column if not exists visual_image_path text/i,
);
assert.match(
  challengeVisualMigration,
  /create unique index if not exists group_challenges_visual_image_path_uidx/i,
  "one private media object must not be attached to multiple challenges",
);
assert.match(
  challengeVisualMigration,
  /create or replace function public\.list_challenge_visuals[\s\S]{0,500}cardinality\(p_challenge_ids\) > 500[\s\S]{0,900}challenge\.audience = 'public'[\s\S]{0,180}public\.is_group_member\(challenge\.group_id\)/i,
  "visual discovery must stay bounded and reuse challenge authorization",
);
assert.match(
  challengeVisualMigration,
  /v_saved := public\.save_group_challenge\([\s\S]{0,1000}p_visual_image_path is distinct from v_saved\.visual_image_path[\s\S]{0,300}v_user_id::text \|\| '\/account\/challenge\/'[\s\S]{0,550}storage\.objects/i,
  "the compatible group-save overload must validate each new owner-scoped object",
);
assert.match(
  challengeVisualMigration,
  /v_saved := public\.save_public_challenge\([\s\S]{0,1000}p_visual_image_path is distinct from v_saved\.visual_image_path[\s\S]{0,700}storage\.objects/i,
  "the compatible public-save overload must enforce the same object validation",
);
assert.match(
  challengeVisualMigration,
  /create or replace function public\.can_read_challenge_media_object[\s\S]{0,600}google_health_account_deletion_guards[\s\S]{0,500}challenge\.visual_image_path = object_path[\s\S]{0,300}public\.is_group_member/i,
  "signed challenge image reads must fail closed for deleted accounts and former outsiders",
);
assert.match(
  challengeVisualMigration,
  /create policy media_storage_authorized_read[\s\S]{0,220}public\.can_read_media_object\(name\)[\s\S]{0,100}public\.can_read_challenge_media_object\(name\)/i,
  "challenge reads must extend rather than replace existing media authorization",
);
assert.match(
  cloud,
  /createSignedUrls\(paths, 60 \* 60\)[\s\S]*p_visual_icon: input\.visualIcon[\s\S]*p_visual_image_path: visualImagePath/,
  "the client must resolve short-lived display URLs while persisting only vetted metadata",
);
assert.match(
  cloud,
  /const path = `\$\{userId\}\/account\/challenge\/\$\{nonce\}/,
  "a new image must be uploaded privately before the atomic relational save",
);
assert.match(
  cloud,
  /if \(input\.visualImageUploadUri\)[\s\S]{0,180}uploadedPath = await uploadChallengeVisual\(input\.visualImageUploadUri\);[\s\S]{0,180}const row = await saveChallengeRow/,
  "the private upload must complete before the challenge row publishes its path",
);
assert.doesNotMatch(
  challengeSaveClient,
  /createdRow|delete_group_challenge/,
  "image upload failure must not leave a provisional visible challenge",
);
assert.match(
  challengeRankMigration,
  /create or replace function public\.list_my_challenge_standings/i,
  "viewer rank RPC must require accepted participation and expose no full standings",
);
assert.match(
  challengeRankMigration,
  /create table if not exists public\.group_challenge_result_settlements[\s\S]{0,500}primary key \(challenge_id, occurrence_date\)/i,
  "settlement truth must be occurrence-scoped and independent of inbox retention",
);
assert.match(
  challengeRankMigration,
  /create table if not exists public\.group_challenge_result_placements[\s\S]*primary key \(challenge_id, occurrence_date, user_id\)/i,
  "settled challenge placements must be immutable occurrence snapshots",
);
assert.match(
  challengeRankMigration,
  /snapshot_group_challenge_result[\s\S]{0,2600}pg_advisory_xact_lock[\s\S]{0,700}insert into public\.group_challenge_result_settlements[\s\S]{0,500}if not found then return/i,
  "only one serialized snapshot computation may claim an occurrence",
);
assert.match(
  challengeRankMigration,
  /create trigger group_notification_events_capture_result_snapshot[\s\S]{0,180}capture_group_challenge_result_snapshot/i,
  "the canonical result event must freeze standings in the same transaction",
);
assert.match(
  challengeRankMigration,
  /create or replace function public\.list_group_challenge_result_placements\([\s\S]{0,300}p_before_occurrence_date[\s\S]{0,180}p_page_size[\s\S]{0,1800}with occurrence_page[\s\S]{0,1000}limit p_page_size/i,
  "durable group history must be cursor-paged by complete occurrences",
);
assert.match(
  challengeRankMigration,
  /audience = 'group'[\s\S]{0,100}cardinality\(participant_ids\) between 1 and 50/i,
  "group challenge participation must retain the hard 50-person response bound",
);
assert.match(
  challengeRankMigration,
  /bounded_legacy_participants[\s\S]{0,1000}limit 50[\s\S]{0,1000}participant_ids = bounded\.participant_ids/i,
  "legacy public custom-metric rows must be bounded when reclassified as group challenges",
);
assert.match(
  challengeRankMigration,
  /p_page_size integer default 20[\s\S]{0,900}p_page_size not between 1 and 20/i,
  "each durable placement page must remain at or below 1,000 rows",
);
assert.match(
  cloud,
  /const pageSize = 20[\s\S]{0,250}for \(;;\)[\s\S]{0,500}p_before_occurrence_date[\s\S]{0,200}p_page_size: pageSize[\s\S]{0,900}occurrenceCount < pageSize[\s\S]{0,700}beforeChallengeId = last\.challenge_id/,
  "the client must consume every durable result page without a silent history cap",
);
assert.doesNotMatch(
  cloud,
  /\]\.slice\(0, 500\)/,
  "viewer and result occurrence requests must be chunked without silent truncation",
);
assert.match(
  challengeRankMigration,
  /create or replace function public\.compute_public_challenge_total[\s\S]*public\.daily_metric_status[\s\S]*public_challenge_snapshot_daily_cache/i,
  "public totals must prefer server status and use only the private daily cache as fallback",
);
assert.match(
  challengeRankMigration,
  /create table if not exists public\.group_challenge_user_preferences/i,
);
assert.match(
  challengeRankMigration,
  /enable row level security[\s\S]{0,520}user_id = \(select auth\.uid\(\)\)/i,
  "challenge preferences must be private account-owned rows",
);
assert.match(
  challengeRankMigration,
  /create or replace function public\.withdraw_from_group_challenge/i,
);
assert.match(
  challengeRankMigration,
  /withdrawn_from_date date[\s\S]{0,6000}group_challenge_occurrence_participant_ids[\s\S]{0,1500}withdrawn_from_date <= p_occurrence_date/i,
  "a recurring withdrawal must be scoped to this and future occurrences",
);
assert.match(
  challengeRankMigration,
  /v_challenge\.recurrence is null[\s\S]{0,180}mode', 'once'\) = 'once'[\s\S]{0,220}group_challenge_join_deadline\(v_challenge\) >= v_local_today[\s\S]{0,850}accepted_participant_ids = array_remove/i,
  "only a live one-off may rewrite the shared accepted roster",
);
assert.match(
  challengeRankMigration,
  /withdrawn_at is not null[\s\S]{0,220}accepted_participant_ids/i,
  "withdrawal must be server-enforced against later rejoin",
);
assert.match(
  challengeRankMigration,
  /create or replace function public\.list_challenge_standings[\s\S]*accepted_participant_ids[\s\S]*row_number\(\) over[\s\S]*display_row <= 100[\s\S]*ranked\.user_id = v_user_id[\s\S]*limit 101/i,
  "public standings must return a deterministic top 100 plus the viewer without PostgREST truncation",
);
assert.match(
  challengeRankMigration,
  /audience = 'group'[\s\S]{0,100}cardinality\(participant_ids\) between 1 and 50[\s\S]*where v_challenge\.audience = 'group'[\s\S]{0,160}limit 101/i,
  "the shared top-100 contract must still return every member of a bounded group challenge",
);
assert.match(
  challengeRankMigration,
  /rank\(\) over \(order by scored\.sort_value\)/i,
  "server challenge standings must share ranks across ties",
);
assert.match(
  challengeRankMigration,
  /v_user_id = any\(challenge\.accepted_participant_ids\)/i,
);
assert.match(
  challengeRankMigration,
  /grant execute on function public\.list_my_challenge_standings\(uuid\[\], date\[\]\)[\s\S]{0,80}to authenticated/i,
);
assert.match(
  challengeRankMigration,
  /parsed\.occurrence_date > v_local_today/i,
  "publication and live standings must share the caller profile's local day",
);
assert.match(challengeRankMigration, /eligible\.occurrence_end_date >= v_local_today/i);
assert.match(challengeRankMigration, /v_period_end < v_local_today/i);
assert.ok(
  (challengeRankMigration.match(/challenge_account_local_date\(v_user_id\)/g) ?? [])
    .length >= 4,
  "publisher, public editor, standings, and withdrawal must use profile-local dates",
);
assert.match(
  challengeRankMigration,
  /v_existing\.group_id <> p_group_id[\s\S]{0,180}cannot move between groups/i,
  "public challenge edits must validate the metric against their stored group",
);
assert.match(
  challengeRankMigration,
  /bounded_legacy_participants[\s\S]{0,2500}update public\.group_challenges challenge[\s\S]{0,180}set audience = 'group'/i,
  "legacy public custom-metric rows must be retained behind group membership",
);
assert.match(
  publicChallengeMigration,
  /using gin \(accepted_participant_ids\)[\s\S]{0,100}audience = 'public'/i,
  "background public challenge projection needs an accepted-participant GIN index",
);
assert.match(
  publicChallengeMigration,
  /\(select auth\.uid\(\)\) = any\(participant_ids\)[\s\S]{0,180}audience = 'public'/i,
  "public challenge metadata must use an RPC while participant detail remains opt-in and RLS protected",
);
assert.match(
  publicChallengeMigration,
  /last_data_synced_at/i,
  "challenge results must wait for post-deadline participant sync and name outstanding accounts",
);
assert.match(publicChallengeMigration, /Waiting for challenge results/i);
assert.match(publicChallengeMigration, /v_waiting_names/i);
assert.match(
  challengeRankMigration,
  /create table if not exists public\.public_challenge_occurrence_syncs[\s\S]{0,500}primary key \(challenge_id, occurrence_date, user_id\)/i,
  "public settlement checkpoints must identify one exact occurrence",
);
assert.match(
  challengeRankMigration,
  /left join public\.user_snapshots current_snapshot[\s\S]{0,250}current_snapshot\.user_id = accepted\.user_id/i,
  "public settlement must compare each projection checkpoint with its current account snapshot",
);
assert.match(
  challengeRankMigration,
  /challenge_projection\.synced_at[\s\S]{0,260}occurrence_end_date \+ 1[\s\S]{0,420}challenge_projection\.source_updated_at is not null[\s\S]{0,220}current_snapshot\.updated_at is not null[\s\S]{0,220}challenge_projection\.source_updated_at =[\s\S]{0,80}current_snapshot\.updated_at/i,
  "settlement must require a post-deadline attempt from the participant's current snapshot revision",
);
assert.match(
  challengeRankMigration,
  /v_old_waiting_projection[\s\S]{0,1200}v_new_waiting_projection[\s\S]{0,1600}not \([\s\S]{0,1100}challenge_projection\.source_updated_at =[\s\S]{0,80}current_snapshot\.updated_at/i,
  "waiting names must use the same current-revision readiness predicate as settlement",
);
assert.match(
  challengeRankMigration,
  /public\.public_challenge_occurrence_syncs[\s\S]{0,1800}challenge_projection\.occurrence_date = v_challenge\.occurrence_date/i,
  "the installed worker must wait for the exact occurrence checkpoint",
);
assert.match(
  challengeRankMigration,
  /jsonb_array_length\(p_rows\) > 500[\s\S]{0,5000}written as \([\s\S]{0,1800}returning challenge_id, occurrence_date[\s\S]{0,500}insert into public\.public_challenge_occurrence_syncs/i,
  "only a successfully computed aggregate may advance its occurrence checkpoint",
);
assert.match(
  publicProjectionBatchFunction,
  /p_limit integer default 500[\s\S]*refresh_public_challenge_snapshot_cache\([\s\S]*public_challenge_projection_pending/i,
  "durable public projection batches must page unsettled stale occurrences from server-owned state",
);
assert.match(
  publicProjectionBatchFunction,
  /if not exists \([\s\S]{0,500}challenge\.accepted_participant_ids @> array\[p_user_id\][\s\S]{0,100}return 0;[\s\S]{0,200}refresh_public_challenge_snapshot_cache\(/i,
  "accounts without an accepted public challenge must return before snapshot parsing",
);
assert.doesNotMatch(
  `${publicProjectionBatchFunction}\n${publicProjectionCacheFunction}`,
  /p_user_id = any\(challenge\.accepted_participant_ids\)/i,
  "projection discovery must use the accepted-roster GIN containment operator",
);
assert.match(publicProjectionBatchFunction, /group_challenge_result_settlements/i);
assert.match(publicProjectionBatchFunction, /marker\.source_updated_at < v_source_updated_at/i);
assert.match(
  publicProjectionBatchFunction,
  /insert into public\.public_challenge_occurrence_syncs/i,
);
assert.doesNotMatch(
  publicProjectionBatchFunction,
  /jsonb_array_elements|compute_public_challenge_total\(/i,
  "the batch path must neither reparse the snapshot nor invoke a scorer per occurrence",
);
assert.match(
  challengeRankMigration,
  /create table if not exists public\.public_challenge_snapshot_daily_cache[\s\S]{0,700}primary key \(user_id, metric_slug, local_date\)[\s\S]{0,400}enable row level security[\s\S]{0,180}revoke all/i,
  "the aggregate snapshot cache must be indexed and inaccessible to clients",
);
assert.match(
  publicProjectionCacheFunction,
  /for update[\s\S]*v_cached_updated_at is not distinct from v_source_updated_at[\s\S]*delete from public\.public_challenge_snapshot_daily_cache[\s\S]*jsonb_array_elements\(v_payload -> 'metrics'\)[\s\S]*jsonb_array_elements\(v_payload -> 'entries'\)[\s\S]*entry\.visibility = 'group'[\s\S]*entry\.visibility <> 'group'[\s\S]*source_updated_at = v_source_updated_at/i,
  "one serialized cache refresh must parse each snapshot revision once with strict visibility metadata",
);
assert.match(
  publicProjectionCacheFunction,
  /v_cached_metric_fingerprint is not distinct from v_metric_fingerprint[\s\S]*accepted_metrics as materialized[\s\S]*challenge\.audience = 'public'[\s\S]*challenge\.accepted_participant_ids @> array\[p_user_id\][\s\S]*accepted\.metric_slug = \(metric\.value ->> 'id'\)[\s\S]*metric_fingerprint = v_metric_fingerprint/i,
  "snapshot cache rebuilds must follow accepted public metric changes and retain only required metric slugs",
);
assert.match(
  legacyPublicProjectionFunction,
  /refresh_public_challenge_snapshot_cache\([\s\S]*compute_public_challenge_total\([\s\S]*source_updated_at/i,
  "the zero-downtime legacy publisher must refresh the shared cache once before per-row scoring",
);
assert.match(
  legacyPublicProjectionFunction,
  /cardinality\(v_ids\) = 0 then return 0; end if;[\s\S]*refresh_public_challenge_snapshot_cache\(/i,
  "an empty legacy request must return before snapshot cache work",
);
assert.equal(
  (challengeRankMigration.match(/jsonb_array_elements\(v_payload -> 'entries'\)/g) ?? [])
    .length,
  1,
  "snapshot entry JSON may be expanded only in the revision-keyed cache refresh",
);
assert.match(
  publicProjectionBatchFunction,
  /catalogue_fingerprint[\s\S]*projection_date[\s\S]*v_cursor_projection_date is distinct from v_local_today[\s\S]*before_occurrence_date[\s\S]*occurrence\.occurrence_date < v_before_occurrence_date/i,
  "the durable cursor must reset on catalogue/day changes and resume within a recurring series",
);
assert.match(
  publicProjectionBatchFunction,
  /select min\(pending\.occurrence_date\)[\s\S]*set before_occurrence_date = v_before_occurrence_date[\s\S]*v_has_more := true[\s\S]*return case when v_has_more then p_limit else v_written end/i,
  "a full occurrence page and every later challenge must return the continuation sentinel",
);
assert.match(
  publicProjectionBatchFunction,
  /preference\.challenge_id = occurrence\.challenge_id[\s\S]{0,220}preference\.user_id = p_user_id[\s\S]{0,220}withdrawn_from_date <= occurrence\.occurrence_date/i,
  "single-user projection eligibility must not unnest a 5,000-person roster per occurrence",
);
assert.doesNotMatch(
  publicProjectionBatchFunction,
  /group_challenge_occurrence_participant_ids\(/i,
  "batch eligibility must use the indexed account preference directly",
);
assert.match(
  publicProjectionBatchFunction,
  /marker\.synced_at < \([\s\S]{0,180}occurrence\.period_end \+ 1[\s\S]*v_synced_at,[\s\S]*v_source_updated_at[\s\S]*source_updated_at = excluded\.source_updated_at/i,
  "an unchanged snapshot must still publish a post-deadline attempt while retaining its source watermark",
);
assert.match(
  challengeRankMigration,
  /revoke all on function public\.project_public_challenge_totals_batch\(uuid, integer\)[\s\S]{0,100}authenticated[\s\S]{0,180}grant execute[\s\S]{0,120}service_role/i,
  "cross-account projection must remain service-role only",
);
assert.match(
  challengeRankMigration,
  /project_my_public_challenge_totals_batch[\s\S]{0,900}auth\.uid\(\)[\s\S]{0,900}grant execute[\s\S]{0,120}authenticated/i,
  "the client projection wrapper may only project the signed-in account",
);
assert.match(
  challengeRankMigration,
  /Public challenges may contain thousands[\s\S]{0,9000}challenge_worker_standings[\s\S]{0,4500}v_exact_calls <> 7/i,
  "the notification worker must replace every per-recipient scorer call with one materialized standing set",
);
assert.match(
  challengeRankMigration,
  /limit v_recipient_budget[\s\S]{0,180}v_recipient_budget := v_recipient_budget - 1[\s\S]{0,500}exit when v_recipient_budget <= 0/i,
  "one invocation must rotate through a bounded global recipient budget",
);
assert.match(
  challengeRankMigration,
  /v_waiting_continue_replacement[\s\S]{0,500}set last_reminder_at = clock_timestamp\(\)[\s\S]{0,100}updated_at = clock_timestamp\(\)[\s\S]{0,250}continue;/i,
  "waiting recipients must advance their rotation timestamp even when the push event already exists",
);
assert.match(
  challengeRankMigration,
  /group_challenge_notification_state_pending_idx[\s\S]{0,180}where result_notified_at is null/i,
  "the worker's durable pending-occurrence lookup must be indexed",
);
assert.match(
  challengeRankMigration,
  /v_retry_replacement[\s\S]{0,1000}min\(pending_state\.occurrence_date\)[\s\S]{0,260}pending_state\.result_notified_at is null/i,
  "unsettled occurrences older than 30 days must remain in the worker retry window",
);
assert.match(
  challengeRankMigration,
  /pg_catalog\.replace\([\s\S]{0,100}v_retry_anchor,[\s\S]{0,100}v_retry_replacement/i,
  "the installed worker must receive the durable retry-window replacement",
);
assert.match(
  periodMigration,
  /set last_leader_id = v_leader\.user_id[\s\S]{0,500}updated_at = clock_timestamp\(\)/i,
  "live recipients must advance rotation state even when no reminder is due",
);
assert.match(
  publicChallengeProjectionBackend,
  /from\("public_challenge_occurrence_syncs"\)[\s\S]{0,500}occurrence_date: row\.occurrence_date[\s\S]{0,300}challenge_id,occurrence_date,user_id/,
  "background Google Health projection must publish occurrence-scoped checkpoints",
);
for (const [source, rpcName, label] of [
  [
    publicChallengeProjectionClient,
    "project_my_public_challenge_totals_batch",
    "client",
  ],
  [
    publicChallengeProjectionBackend,
    "project_public_challenge_totals_batch",
    "Edge",
  ],
]) {
  assert.match(
    source,
    /for \(let batch = 0; batch < MAX_PROJECTION_BATCHES; batch \+= 1\)[\s\S]*\.rpc\([A-Z_]*BATCH_RPC,[\s\S]*batchWritten < PROJECTION_BATCH_SIZE/,
    `${label} projection must consume bounded server continuation pages`,
  );
  assert.match(
    source,
    /const MAX_PROJECTION_BATCHES = 20;[\s\S]*for \(let batch = 0; batch < MAX_PROJECTION_BATCHES; batch \+= 1\)[\s\S]*if \(batchWritten < PROJECTION_BATCH_SIZE\) return written;[\s\S]*return written;/,
    `${label} projection must cap PostgREST amplification and leave its durable cursor for a later sync`,
  );
  assert.doesNotMatch(
    source,
    /Public challenge projection did not converge/,
    `${label} projection must treat its per-sync budget as durable progress rather than a retryable failure`,
  );
  assert.match(
    source,
    new RegExp(`const [A-Z_]*BATCH_RPC = "${rpcName}"`),
    `${label} projection must call the intended server-owned batch RPC`,
  );
  assert.match(
    source,
    /batchProjectionRpcUnavailable[\s\S]{0,500}42883[\s\S]{0,120}PGRST202[\s\S]{0,800}batch === 0 && batchProjectionRpcUnavailable/i,
    `${label} may use its zero-downtime fallback only when the new RPC is unavailable`,
  );
  assert.match(
    source,
    /order\("id", \{ ascending: true \}\)[\s\S]{0,120}limit\(LEGACY_CATALOGUE_PAGE_SIZE\)[\s\S]{0,160}\.gt\("id", cursor\)/,
    `${label} fallback must cursor-page every accepted public challenge`,
  );
  assert.doesNotMatch(
    source,
    /\.slice\(0,\s*250\)|\.limit\(100\)/,
    `${label} fallback must not silently truncate accepted challenges`,
  );
}
assert.doesNotMatch(
  publicChallengeProjectionClient,
  /\bperiodMetricResult\b/,
  "the client fallback must not score public challenges from unrestricted local totals",
);
assert.match(
  publicChallengeProjectionClient,
  /select\("id, group_id, metric_slug, local_date, end_date, recurrence"\)[\s\S]*legacyProjectionResult\(state, challenge, metric, dates\)/,
  "the client fallback must carry group identity into its visibility-aware scorer",
);
assert.match(
  publicChallengeProjectionClient,
  /status\.visibility !== "group"[\s\S]*hasRestrictedDay[\s\S]*entry\.visibility === "group"/,
  "the client fallback must fail closed on restricted-only days and aggregate explicit group rows only",
);
assert.match(
  publicChallengeProjectionBackend,
  /entry\.visibility !== "group"[\s\S]{0,500}restrictedDates\.add\(localDate\)[\s\S]{0,500}hasRestrictedDay[\s\S]{0,500}daily\.has\(localDate\)/,
  "Edge fallback must fail closed for restricted-only dates while allowing an explicit group replacement",
);
assert.match(
  publicChallengeProjectionBackend,
  /42P01[\s\S]{0,200}PGRST204[\s\S]{0,200}PGRST205/,
  "the Edge rollout may fall back to the legacy marker only when the new table is not installed yet",
);
assert.match(
  publicChallengeProjectionBackend,
  /occurrenceSyncSchemaUnavailable\(markers\.error\)[\s\S]{0,900}public_challenge_participant_syncs/,
);
assert.match(
  publicChallengeMigration,
  /cardinality\(v_challenge\.participant_ids\) >= 5000/i,
  "creator-unlimited public challenges need an operational anti-row-bloat ceiling",
);
assert.match(
  publicChallengeMigration,
  /name_group_challenge_acceptance[\s\S]{0,1200}accepted your challenge/i,
  "acceptance events must name the accepting account",
);
assert.match(
  challengeRankMigration,
  /You finished #1[\s\S]{0,500}finished second[\s\S]{0,500}You placed #/i,
  "durable challenge results must summarize winner, second place, or the viewer's rank",
);
assert.match(
  notificationAmbiguityRepair,
  /on conflict on constraint group_notification_events_recipient_id_event_key_key do nothing/i,
  "recipient feed inserts must not confuse the event_key output parameter with a table column",
);
assert.match(
  notificationAmbiguityRepair,
  /on conflict on constraint push_dispatch_events_event_key_key do nothing returning push_dispatch_events\.event_key into v_inserted/i,
  "push inserts must use a named conflict constraint and a qualified RETURNING column",
);
assert.match(
  notificationAmbiguityRepair,
  /v_event_conflicts <> 2 or v_push_returns <> 2/i,
  "the forward repair must fail closed if the deployed function shape drifts",
);
assert.match(
  notificationGuardHardening,
  /v_event_conflicts = 0 and v_push_returns = 0/i,
  "the post-deploy guard must be repeat-safe after the first repair",
);
assert.match(
  notificationGuardHardening,
  /constraint_row\.conname =[\s\S]{0,120}group_notification_events_recipient_id_event_key_key[\s\S]{0,500}push_dispatch_events_event_key_key/i,
  "the repeat-safe guard must verify both named conflict constraints",
);
assert.match(
  notificationGuardHardening,
  /rewritten_definition is distinct from current_definition[\s\S]{0,80}execute rewritten_definition/i,
  "an already repaired function must not be replaced again",
);
assert.match(periodMigration, /occurrence_date date not null/i);
assert.match(
  periodMigration,
  /primary key \(challenge_id, occurrence_date, recipient_id\)/i,
);
assert.match(periodMigration, /create table if not exists public\.challenge_notification_runtime/i);
assert.match(periodMigration, /create or replace function public\.group_challenge_occurs_on/i);
assert.match(periodMigration, /cross join lateral generate_series/i);
assert.match(periodMigration, /base\.recurrence ->> 'mode' = 'once'/i);
assert.match(periodMigration, /challengeOccurrenceDate/);
assert.match(periodMigration, /v_existing\.recurrence ->> 'endDate'/i);
assert.match(periodMigration, /if v_mode is null or v_mode not in/i);
assert.match(
  periodMigration,
  /p_local_date < current_date - 1[\s\S]{0,260}v_recurrence - 'endDate'/i,
);
assert.match(
  periodMigration,
  /v_existing\.recurrence is not null[\s\S]{0,140}v_recurrence is null[\s\S]{0,140}v_existing\.local_date < current_date - 1/i,
  "old recurring series cannot be converted onto a stale notification-state key",
);
assert.match(
  periodMigration,
  /v_existing\.local_date < current_date - 1[\s\S]{0,220}p_metric_slug is distinct from v_existing\.metric_slug[\s\S]{0,180}p_target_value is distinct from v_existing\.target_value[\s\S]{0,360}v_recurrence_end < current_date - 1/i,
  "settled recurring rules stay immutable while safe future end-date edits remain possible",
);
assert.match(
  periodMigration,
  /coalesce\(recurrence ->> 'mode', ''\) in/i,
);
assert.match(
  periodMigration,
  /create or replace function public\.save_group_challenge\([\s\S]{0,260}p_recurrence jsonb[\s\S]{0,360}select public\.save_group_challenge\(/i,
);
assert.match(
  periodMigration,
  /challenge\.end_date = challenge\.local_date[\s\S]{0,80}then p_local_date/i,
  "the legacy overload must move one-day challenge end dates with their start date",
);
assert.match(
  periodMigration,
  /join public\.group_members member[\s\S]{0,180}member\.status = 'active'/i,
);
assert.match(periodMigration, /reset_group_challenge_notification_state/i);
assert.match(periodMigration, /delete from public\.group_challenge_notification_state/i);
assert.equal(
  (periodMigration.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length >= 2,
  true,
);
assert.match(
  periodMigration,
  /current_challenge\.updated_at = v_challenge\.updated_at/i,
);
assert.match(
  periodMigration,
  /if new\.deleted_at is not null then[\s\S]{0,500}delete from public\.push_dispatch_events/i,
);
assert.match(periodMigration, /recurrence, deleted_at[\s\S]{0,100}on public\.group_challenges/i);
assert.match(
  periodMigration,
  /left join public\.group_challenge_notification_state state[\s\S]{0,240}state\.result_notified_at is null/i,
);
assert.match(periodMigration, /date_trunc\('hour', statement_timestamp\(\)\)/i);
assert.match(periodMigration, /if v_leader\.user_id is not null/i);
assert.match(periodMigration, /pg_catalog\.pg_timezone_names valid_timezone/i);
assert.match(periodMigration, /coalesce\(valid_timezone\.name, 'UTC'\)/i);
assert.match(
  periodMigration,
  /bool_and\([\s\S]{0,260}v_challenge\.occurrence_end_date[\s\S]{0,500}v_all_participants_finished/i,
  "results must wait until every active accepted participant has finished in their own timezone",
);
assert.match(periodMigration, /'Lead changed'/);
assert.match(periodMigration, /challenge_standing/);
assert.match(periodMigration, /challenge_reminder/);
assert.match(periodMigration, /challenge_result/);
assert.doesNotMatch(periodMigration, /min\(standing\.user_id\)/);
assert.match(
  periodMigration,
  /\(array_agg\(standing\.user_id order by standing\.user_id\)\)\[1\]/,
);
assert.match(notificationUuidHotfix, /pg_get_functiondef/);
assert.match(notificationUuidHotfix, /min\(standing\.user_id\)/);
assert.match(notificationUuidHotfix, /array_agg\(standing\.user_id/);
assert.match(discoveryMigration, /create function public\.list_active_group_challenges/i);
assert.match(
  discoveryMigration,
  /not public\.is_group_member\(p_group_id\)[\s\S]{0,180}Active group membership required/i,
  "challenge discovery must be authorized by active group membership",
);
assert.match(
  discoveryMigration,
  /challenge\.deleted_at is null[\s\S]{0,500}>= v_local_today[\s\S]{0,220}limit 100/i,
  "discovery must exclude finished rows and remain bounded",
);
assert.equal(
  (discoveryMigration.match(/pg_catalog\.pg_timezone_names valid_timezone/g) ?? [])
    .length,
  2,
  "discovery and self-join must evaluate deadlines in the member profile timezone",
);
assert.doesNotMatch(
  discoveryMigration,
  /create policy|drop policy/i,
  "discovery must not widen participant-scoped Leaderboard RLS",
);
const discoveryFunction = discoveryMigration.slice(
  discoveryMigration.indexOf("create function public.list_active_group_challenges"),
  discoveryMigration.indexOf(
    "comment on function public.list_active_group_challenges",
  ),
);
assert.match(
  discoveryFunction,
  /returns table \([\s\S]*participant_count integer,[\s\S]*accepted_count integer,[\s\S]*viewer_participation text,[\s\S]*eligible_to_join boolean,[\s\S]*is_full boolean/i,
  "active discovery must return only counts and caller-specific membership state",
);
assert.doesNotMatch(
  discoveryFunction.slice(
    discoveryFunction.indexOf("returns table"),
    discoveryFunction.indexOf("language plpgsql"),
  ),
  /participant_ids|accepted_participant_ids|declined_participant_ids/i,
  "the discovery DTO must not expose another member's challenge roster UUIDs",
);
assert.doesNotMatch(
  discoveryFunction,
  /select challenge\.\*/i,
  "active discovery must never bypass participant RLS with the full challenge row",
);
assert.match(
  discoveryMigration,
  /from public\.group_members member[\s\S]{0,180}member\.status = 'active'[\s\S]{0,80}for update;[\s\S]{0,80}if not found then/i,
  "self-join must lock and recheck active membership through the update",
);
assert.match(
  discoveryMigration,
  /create or replace function public\.group_challenge_join_deadline[\s\S]{0,750}datetime_field_overflow or invalid_datetime_format/i,
  "corrupt recurrence dates must fail closed per row instead of aborting discovery",
);
assert.match(
  discoveryMigration,
  /cardinality\(v_challenge\.participant_ids\) >= 50/i,
  "self-join must retain the challenge participant cap",
);
assert.match(
  discoveryMigration,
  /set participant_ids = v_participants,[\s\S]{0,120}accepted_participant_ids = v_accepted/i,
  "self-join must atomically add the caller to both participant sets",
);
assert.match(
  discoveryMigration,
  /if not v_was_participant then[\s\S]{0,140}active invitation is required to decline/i,
  "non-invited members may self-join but may not synthesize declines",
);
assert.match(
  allAcceptedMigration,
  /not \(v_participants <@ v_accepted\)[\s\S]{0,220}v_old_participants <@ v_old_accepted/i,
  "the all-accepted event must be emitted only on the false-to-true transition",
);
assert.match(
  allAcceptedMigration,
  /join public\.group_members member[\s\S]{0,180}member\.status = 'active'/i,
  "the private feed must only materialize rows for active challenge members",
);
assert.match(
  allAcceptedMigration,
  /'challenge-all-accepted:' \|\| new\.id::text[\s\S]{0,500}on conflict \(recipient_id, event_key\) do nothing/i,
  "each participant feed event must have a stable idempotency key",
);
assert.match(
  allAcceptedMigration,
  /insert into public\.push_dispatch_events[\s\S]{0,650}'challenge_all_accepted'[\s\S]{0,100}'challenge_participants'/i,
  "the database transition must stage one canonical participant-scoped push",
);
assert.match(
  allAcceptedMigration,
  /pg_catalog\.to_char\(new\.local_date, 'FMMon FMDD, YYYY'\)/i,
  "all-accepted copy and route data must include the challenge start date",
);
assert.match(allAcceptedMigration, /'startDate', new\.local_date/i);
assert.match(
  allAcceptedMigration,
  /create trigger group_challenges_emit_all_accepted_notification[\s\S]{0,120}after update of accepted_participant_ids/i,
);
assert.match(
  cloud,
  /sendGroupChallengeAcceptedPush[\s\S]{0,700}flushPendingGroupPushEvents\(\)/,
  "the accepting client should drain the trigger-owned event immediately while the worker remains its fallback",
);

const transitionedToAllAccepted = (
  oldParticipants,
  oldAccepted,
  participants,
  accepted,
) =>
  participants.length > 0 &&
  participants.every((id) => accepted.includes(id)) &&
  !(
    oldParticipants.length > 0 &&
    oldParticipants.every((id) => oldAccepted.includes(id))
  );
assert.equal(
  transitionedToAllAccepted(["a", "b"], ["a"], ["a", "b"], ["a", "b"]),
  true,
);
assert.equal(
  transitionedToAllAccepted(
    ["a", "b"],
    ["a", "b"],
    ["a", "b"],
    ["a", "b"],
  ),
  false,
  "a repeated update must not emit the one-time event again",
);
assert.match(groupNotificationEvents, /occurrence_date/);
assert.match(groupNotificationEvents, /\.limit\(500\)/);
assert.match(groupScreen, /allEvents: groupFeedEvents/);
assert.match(groupScreen, /event\.kind === "challenge_result"/);
assert.match(groupScreen, /event\.occurrenceDate === challenge\.localDate/);
assert.match(
  groupScreen,
  /!cloudResultsRequireSettlement \|\| Boolean\(canonicalResult\)/,
  "cloud winner celebrations must wait for the canonical settled result event",
);
assert.match(
  periodMigration,
  /when raw_totals\.metric_slug = 'weight'[\s\S]{0,900}raw_totals\.latest_value[\s\S]{0,300}raw_totals\.previous_value/,
  "server standings must mirror the client weight baseline-to-latest period result",
);
assert.doesNotMatch(
  periodMigration,
  /if v_leader\.user_id is null then continue/,
  "challenge completion must still notify participants when no exact-value winner can be resolved",
);
assert.match(
  periodMigration,
  /v_challenge\.label \|\| ' complete'/,
  "a completed challenge without an eligible winner needs privacy-safe completion copy",
);
assert.match(periodMigration, /challengeCadence/);
assert.match(periodMigration, /group-challenge-notifications-hourly/);
assert.match(challengeWorker, /stage_group_challenge_notifications/);
assert.match(challengeWorker, /\.is\("dispatched_at", null\)/);
assert.match(challengeWorker, /\/functions\/v1/);
assert.match(
  cloud,
  /category: "challenge"[\s\S]{0,320}route: "\/challenges"/,
  "client challenge pushes must open the dedicated Challenges screen",
);
assert.match(
  challengeRankMigration,
  /emit_group_challenge_notification_events\(\)[\s\S]{0,220}emit_group_challenge_all_accepted_notification\(\)[\s\S]{0,220}stage_group_challenge_notifications\(integer\)[\s\S]{0,700}'\/challenges'/,
  "the forward migration must upgrade every installed challenge notification route",
);
assert.match(
  supabaseConfig,
  /\[functions\.challenge-notifications\][\s\S]{0,160}verify_jwt = false/,
);
assert.match(groupSettings, /accessibilityState=\{\{ expanded: groupColorOpen \}\}/);
assert.match(groupSettings, /setGroupTheme\(groupColorDraft\)/);
assert.match(groupSettings, /discoverActive: true/);
assert.match(
  groupSettings,
  /const routeFocused = useIsFocused\(\)[\s\S]{0,160}discoveryPollingEnabled: routeFocused/,
  "Group Settings must expose route focus to its discovery-only poll",
);
assert.match(groupSettings, /availability === "active" \? "LIVE" : "UPCOMING"/);
assert.match(groupSettings, /await challengeCloud\.respond\(sourceId, "accepted"\)/);
assert.match(groupSettings, />Joined<\/Text>/);
assert.match(groupSettings, /challenge\.viewerParticipation \?\?/);
assert.match(groupSettings, /challenge\.eligibleToJoin \?\?/);
assert.doesNotMatch(
  groupSettings,
  /<ColorSpectrumPicker[\s\S]{0,180}onChange=\{setGroupTheme\}/,
  "dragging the palette must stay local until Apply to avoid repeated group writes",
);
assert.match(
  notificationMigration,
  /if old\.status = 'pending' and new\.status = 'active'[\s\S]{0,120}v_actor_id <> new\.user_id then[\s\S]{0,120}v_event_type := 'membership_approved';[\s\S]{0,120}v_audience := 'user';[\s\S]{0,120}v_recipient_id := new\.user_id;[\s\S]{0,240}v_body := 'Your request was approved\./,
  "the canonical membership trigger must target the accepted member with approval copy",
);

console.log(
  "Group challenge validation passed: domain rules, private active discovery, atomic self-join, tie-safe win badges, bounded realtime, RPC permissions, and RLS.",
);
