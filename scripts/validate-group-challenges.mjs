import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  challengeCardId,
  challengeIdFromCard,
  acceptedChallengeParticipantIds,
  groupChallengeResponseDeadline,
  groupChallengeParticipation,
  validChallengeRecurrence,
  challengeWinnerIds,
  challengeValueOutcome,
  compareChallengeValues,
  isChallengeMetric,
  mergedLeaderboardCardOrder,
  validChallengeDate,
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
assert.match(
  validateGroupChallenge({ ...valid, today: "2026-08-12", localDate: "2026-08-11" }),
  /today or a future date/i,
);
assert.match(
  validateGroupChallenge({ ...valid, participantIds: ["creator"] }),
  /at least one friend/i,
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
const hook = fs.readFileSync(
  path.join(root, "src", "cloud", "useGroupChallenges.ts"),
  "utf8",
);
const cloud = fs.readFileSync(
  path.join(root, "src", "cloud", "groupChallenges.ts"),
  "utf8",
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
const memberComparison = fs.readFileSync(
  path.join(root, "app", "member", "[id].tsx"),
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
const cloudSync = fs.readFileSync(
  path.join(root, "src", "cloud", "CloudSyncProvider.tsx"),
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
assert.match(hook, /sendGroupChallengeStartedPush\(saved\)/);
assert.match(hook, /sendGroupChallengeAcceptedPush/);
assert.match(
  hook,
  /const subscriberId = useId\(\)/,
  "each mounted challenge hook must own a stable Realtime subscriber id",
);
assert.match(
  hook,
  /\.channel\(`group-challenges:\$\{groupId\}:\$\{subscriberId\}`\)/,
  "leaderboard and friend comparison must not reuse one subscribed Realtime channel",
);
assert.match(cloud, /\.limit\(200\)/, "challenge reads must stay bounded");
assert.match(cloud, /p_recurrence: input\.recurrence \?\? null/);
assert.match(cloud, /category: "challenge"/);
assert.match(cloud, /eventKey: `challenge-started:\$\{challenge\.id\}`/);
assert.doesNotMatch(
  cloud,
  /sendGroupChallengeStartedPush[\s\S]{0,450}Promise\.all/,
  "challenge-start notifications must use one server-side fan-out",
);
assert.match(sendPush, /payload\.category==='challenge'/);
assert.match(sendPush, /expectedEventKey/);
assert.match(sendPush, /accepted\.includes\(user\.id\)/);
assert.match(sendPush, /const copy=challengePushCopy\(challengeEvent/);
assert.match(sendPush, /payload\.titles=copy\.titles;payload\.bodies=copy\.bodies/);
assert.match(sendPush, /members\.in\('user_id',challengeRecipientIds\?\?\[\]\)/);
assert.match(sendPush, /payload\.category==='winner'\|\|payload\.category==='challenge'/);
assert.match(
  progress,
  /result\.mode === "exact" && hasData/,
  "custom-target progress must require an exact privacy-permitted value",
);
assert.match(
  progress,
  /result\.mode === "private" \|\| result\.mode === "status"/,
  "status-only data must not be reverse engineered for a custom target",
);
assert.match(progress, /challenge\.localDate >= today/);
assert.match(progress, /seen\.has\(challenge\.id\)/);
assert.match(progress, /expandGroupChallengeOccurrences/);
assert.match(progress, /limit = 200/);
assert.match(progress, /\.slice\(0, Math\.max\(0, Math\.floor\(limit\)\)\)/);
assert.match(progress, /expandGroupChallengeOccurrences\(challenges, earliest, throughDate, 5_000\)/);
assert.match(progress, /acceptedChallengeParticipantIds\(challenge\)/);
assert.match(badges, /id: `challenge-wins:\$\{member\.id\}`/);
assert.equal(
  (badges.match(/id: `challenge-wins:\$\{member\.id\}`/g) ?? []).length,
  1,
  "each member must have one general challenge-win badge, never one per milestone",
);
assert.match(badges, /`\$\{count\} challenge win`/);
assert.match(badges, /`\$\{count\} challenge wins`/);
assert.match(
  badgeScreen,
  /buildBadges\(state, anchor, challengeCloud\.challenges\)/,
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
assert.ok(
  memberComparison.indexOf("<Card style={styles.badgeShowcaseCard}") <
    memberComparison.indexOf('title="Choose up to 5 showcase badges"'),
  "the self-profile badge chooser belongs below the badge showcase card",
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
assert.match(challengeEditor, /\["every_other_day", "Every other"\]/);
assert.match(challengeEditor, /mode: repeatMode/);
assert.match(challengeEditor, /endDate: repeatUntil/);
assert.match(
  groupScreen,
  /challengeCloud[\s\S]*\.respond\(groupChallengeSourceId\(challenge\), response\)/,
);
assert.match(groupScreen, /expandGroupChallengeOccurrences/);
assert.match(groupScreen, /groupChallengeResponseDeadline\(challenge\) >= dateKey\(\)/);
assert.match(groupSettings, /accessibilityState=\{\{ expanded: groupColorOpen \}\}/);
assert.match(groupSettings, /setGroupTheme\(groupColorDraft\)/);
assert.doesNotMatch(
  groupSettings,
  /<ColorSpectrumPicker[\s\S]{0,180}onChange=\{setGroupTheme\}/,
  "dragging the palette must stay local until Apply to avoid repeated group writes",
);
assert.match(
  cloudSync,
  /membership-approved:\$\{groupId\}:\$\{userId\}:\$\{Date\.now\(\)\}[\s\S]*audience: "user"[\s\S]*recipientId: userId[\s\S]*Your request was approved/,
  "an accepted member must receive the existing targeted approval notification",
);

console.log(
  "Group challenge validation passed: domain rules, friend entry point, tie-safe win badges, exact-value privacy, bounded realtime, RPC permissions, and RLS.",
);
