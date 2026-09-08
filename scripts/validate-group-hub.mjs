import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./validate-group-schedule.mjs";

import {
  canonicalGroupScheduleAllDayInstant,
  DEFAULT_GROUP_HUB_ACTION_ORDER,
  groupScheduleAllDayDateKey,
  moveGroupHubAction,
  normalizeGroupHubActionOrder,
  visibleGroupHubActions,
} from "../src/domain/groupHub.ts";
import {
  groupRecapSocialTarget,
  groupRecapStoryIdFromShareHighlight,
  groupRecapStoryShareHighlight,
} from "../src/domain/groupSocialTarget.ts";
import {
  recapStoryAutoplayEnabled,
  remainingRecapStoryDurationMs,
} from "../src/domain/recapStoryPlayback.ts";

assert.deepEqual(groupRecapSocialTarget("2026-09-08", "group-champion"), {
  type: "group_recap",
  id: "v1:week:2026-09-08:group-champion",
});
assert.equal(
  groupRecapStoryIdFromShareHighlight(
    groupRecapStoryShareHighlight("group-water"),
  ),
  "group-water",
);
assert.equal(groupRecapStoryShareHighlight("../../not-a-story"), undefined);
assert.equal(
  recapStoryAutoplayEnabled({
    storyCount: 2,
    gestureActive: false,
    socialInteractionActive: false,
    reportOpen: false,
  }),
  true,
);
for (const paused of [
  { gestureActive: true, socialInteractionActive: false, reportOpen: false },
  { gestureActive: false, socialInteractionActive: true, reportOpen: false },
  { gestureActive: false, socialInteractionActive: false, reportOpen: true },
])
  assert.equal(
    recapStoryAutoplayEnabled({ storyCount: 2, ...paused }),
    false,
    "recap autoplay must pause for every interactive story state",
  );
assert.equal(
  recapStoryAutoplayEnabled({
    storyCount: 0,
    gestureActive: false,
    socialInteractionActive: false,
    reportOpen: false,
  }),
  false,
);
assert.equal(remainingRecapStoryDurationMs(0), 6_500);
assert.equal(remainingRecapStoryDurationMs(0.5), 3_250);
assert.equal(remainingRecapStoryDurationMs(1), 0);
assert.equal(remainingRecapStoryDurationMs(-2), 6_500);
assert.equal(remainingRecapStoryDurationMs(4), 0);

assert.equal(
  canonicalGroupScheduleAllDayInstant("2026-09-08"),
  "2026-09-08T12:00:00.000Z",
  "all-day events must use a timezone-stable canonical instant",
);
assert.equal(canonicalGroupScheduleAllDayInstant("2026-02-30"), undefined);
assert.equal(
  groupScheduleAllDayDateKey("2026-09-08T12:00:00.000Z"),
  "2026-09-08",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

assert.deepEqual(normalizeGroupHubActionOrder(undefined), [
  ...DEFAULT_GROUP_HUB_ACTION_ORDER,
]);
assert.deepEqual(
  normalizeGroupHubActionOrder(["notes", "notes", "unknown", "recap"]),
  ["notes", "recap", "notifications", "challenges", "schedule"],
  "saved action orders must dedupe, discard unknown values, and add new defaults",
);
assert.deepEqual(
  visibleGroupHubActions(undefined, {
    challenges: true,
    schedule: false,
    notes: true,
  }),
  ["notifications", "recap", "challenges", "notes"],
);
assert.deepEqual(moveGroupHubAction(undefined, "challenges", -1), [
  "notifications",
  "challenges",
  "recap",
  "schedule",
  "notes",
]);

const leaderboard = read("app/(tabs)/group.tsx");
const toolbar = read("src/components/GroupHubToolbar.tsx");
const todos = read("src/components/GroupTodoLeaderboardSection.tsx");
const notes = read("app/group-notes.tsx");
const schedule = read("app/group-schedule.tsx");
const recap = read("app/recap.tsx");
const chat = read("app/(tabs)/chat.tsx");
const socialBar = read("src/components/GroupSocialActionBar.tsx");
const socialHook = read("src/cloud/useGroupSocialEngagement.ts");
const hubHook = read("src/cloud/useGroupHubContent.ts");
const notificationHook = read("src/cloud/useGroupNotificationEvents.ts");
const accountNotificationHook = read("src/cloud/useAccountNotificationEvents.ts");
const hubCloud = read("src/cloud/groupHubContent.ts");
const settings = read("app/display-settings.tsx");
const groupSettings = read("app/group-settings.tsx");
const alerts = read("app/alerts.tsx");
const push = read("supabase/functions/send-push/index.ts");
const groupTodosCloud = read("src/cloud/groupTodos.ts");
const groupSocialCloud = read("src/cloud/groupSocial.ts");
const groupSocialTarget = read("src/domain/groupSocialTarget.ts");
const recapDomain = read("src/domain/recaps.ts");
const migration = read(
  "supabase/migrations/202609080003_group_hub_social_productivity.sql",
);

for (const rpc of [
  "save_group_note",
  "delete_group_note",
  "save_group_schedule_item",
  "delete_group_schedule_item",
]) {
  const functionSql = migration.match(
    new RegExp(
      `create or replace function public\\.${rpc}\\([\\s\\S]*?\\n\\$\\$;`,
    ),
  )?.[0];
  assert.ok(functionSql, `${rpc} must be defined in the group migration`);
  assert.match(
    functionSql,
    /habhub_message_visible_to_current_user/,
    `${rpc} must not bypass a blocked creator's content boundary`,
  );
}

assert.match(leaderboard, /editing \? \([\s\S]*settings-outline[\s\S]*GroupHubToolbar/);
assert.match(leaderboard, /id="leaderboard-create-challenge"/);
for (const page of [
  "notifications",
  "recap",
  "challenges",
  "schedule",
  "notes",
])
  assert.match(toolbar, new RegExp(`${page}:\\s*\\{`));
assert.match(toolbar, /const pinned = actions\.slice\(0, 2\)/);
assert.match(toolbar, /const overflow = actions\.slice\(2\)/);
assert.match(settings, /showGroupScheduleByGroup/);
assert.match(settings, /showGroupNotesByGroup/);
assert.match(settings, /moveGroupHubAction/);

assert.match(todos, /editing[\s\S]*pathname: "\/group-todo-editor"[\s\S]*setCompletionTodoId\(todo\.id\)/);
assert.match(todos, /COMPLETION DETAILS/);
assert.match(todos, /completionTodo\.completedBy/);
assert.match(
  todos,
  /const sharedCompletionAt =[^;]*completionTodo\.recurrence[^;]*dateKey\(new Date\(completionTodo\.completedAt\)\) === today/s,
  "shared recurring completion details must only use the current occurrence",
);
assert.match(todos, /sharedCompletionAt \? \(/);
assert.match(todos, /completedAt=\{sharedCompletionAt\}/);

assert.match(notes, /useGroupNotes/);
assert.match(notes, /GroupSocialActionBar/);
assert.match(notes, /useLocalSearchParams/);
assert.match(notes, /focusedNoteId/);
assert.match(notes, /Opened from your updates/);
assert.match(schedule, /useGroupSchedule/);
assert.match(schedule, /canonicalGroupScheduleAllDayInstant/);
assert.match(schedule, /friendlyDate\(slot\.date, locale\)/);
assert.match(schedule, /GroupScheduleCalendar/);
assert.match(schedule, /focusedItemId/);
assert.match(schedule, /Opened from your updates/);
assert.match(recap, /story\.socialTarget/);
assert.match(recap, /GroupSocialActionBar/);
assert.match(recap, /key=\{storySocialKey\}/);
assert.match(
  recap,
  /onInteractionChange=\{setStorySocialInteractionActive\}/,
  "story comments must hold autoplay while the composer is active",
);
assert.match(recap, /reportOpen: Boolean\(storyCommentReport\)/);
assert.match(recap, /remainingRecapStoryDurationMs\(currentProgress\)/);
assert.match(recap, /storyCommentReport[\s\S]*safety[\s\S]*\.reportComment\(/);
assert.match(notes, /commentReport[\s\S]*SafetyReportSheet[\s\S]*\.reportComment\(/);
assert.match(socialBar, /onReportComment\?: \(comment: GroupSocialComment\) => void/);
assert.match(
  socialBar,
  /comment\.userId !== currentUserId && onReportComment/,
  "other members' comments must expose reporting while own comments keep delete",
);
assert.match(
  socialBar,
  /const interactionActive = commentsOpen \|\| posting \|\| pressing/,
  "open or actively pressed social controls must pause story playback",
);
assert.match(recap, /story\.feedItemId \?\? groupRecapStoryShareHighlight/);
assert.match(recap, /groupRecapStoryIdFromShareHighlight/);
assert.match(recapDomain, /socialTarget: groupRecapSocialTarget\(anchor, story\.id\)/);
assert.match(groupSocialTarget, /type: "group_recap"/);
assert.match(chat, /storyId[\s\S]*pathname: "\/recap"[\s\S]*story: storyId/);
assert.match(chat, /chatMessageSocialTarget/);
assert.match(chat, /allowedReactions=\{\["thumbs_up", "thumbs_down"\]\}/);
assert.doesNotMatch(
  chat,
  /<GroupSocialActionBar[\s\S]{0,120}inverse=\{mine\}/,
  "chat reaction controls sit outside the colored bubble and need page contrast",
);
assert.match(chat, /"chat",\s*false/);
assert.match(groupSocialCloud, /new Map<GroupSocialTargetType, Set<string>>/);
assert.doesNotMatch(
  groupSocialCloud,
  /new Set\(\[\.\.\.\(result\.get\(target\.type\)/,
  "social target grouping must remain linear for long chat histories",
);

assert.match(hubHook, /group:\$\{groupId\}:workspace/);
assert.match(hubHook, /group_hub_updated/);
assert.match(
  hubHook,
  /accountGroupScopeKey\(state\.currentUserId, groupId\)/,
  "group content caches must be isolated by both account and group",
);
assert.match(hubHook, /requestsByScope\[kind\]\.get\(scopeKey\)/);
assert.match(hubHook, /listenersByScope[\s\S]*map\.get\(scopeKey\)/);
assert.match(hubHook, /rows\.filter\(\(row\) => row\.groupId === groupId\)/);
assert.match(hubHook, /useUserSafety/);
assert.match(
  hubHook,
  /safety\.hydrated[\s\S]*!safety\.blockedUserIds\.has\(row\.creatorId\)/,
  "cached note and schedule rows must immediately enforce block access rules",
);
assert.match(socialHook, /group:\$\{groupId\}:social/);
assert.match(socialHook, /const scopeKey = `\$\{state\.currentUserId\}\\u0000\$\{groupId\}\\u0000\$\{tutorial\.active\}/);
assert.match(socialHook, /activeScopeRef\.current !== operationScopeKey/);
assert.match(socialHook, /reactionWriteQueueRef\.current\.clear\(\)/);
assert.match(socialHook, /safety\.hydrated \? blockedUsersKey : "safety-pending"/);
assert.match(socialHook, /function demoGroupNoteEngagement\(/);
assert.match(
  socialHook,
  /actors\.slice\(0, Math\.min\(2, actors\.length\)\)/,
  "credential-free group notes should show more than one member reacting",
);
assert.match(
  socialHook,
  /comments\.push\(\{[\s\S]*targetType: "group_note"[\s\S]*content: commentCopy/,
  "credential-free group notes should include realistic linked discussion",
);
assert.match(
  notificationHook,
  /const scopeKey = `\$\{accountId \?\? "signed-out"\}\\u0000\$\{groupId\}`/,
);
assert.match(notificationHook, /requestRef\.current\?\.scopeKey === scopeKey/);
assert.match(notificationHook, /scopeRef\.current !== scopeKey/);
assert.match(notificationHook, /preferences\?\.workspaceUpdates === false/);
assert.match(notificationHook, /allEvents: privacyScopedEvents/);
assert.match(accountNotificationHook, /const scopeKey = accountId \?\? "signed-out"/);
assert.match(accountNotificationHook, /requestRef\.current\?\.scopeKey === scopeKey/);
assert.match(accountNotificationHook, /scopeRef\.current !== scopeKey/);
assert.doesNotMatch(
  `${hubHook}\n${socialHook}`,
  /postgres_changes/,
  "group hub/social hooks must stay on compact private Broadcast invalidation",
);
assert.match(push, /event\.eventType === "group_todo_completed"/);
assert.match(push, /groupPreference\.todoUpdates === false/);
assert.match(push, /workspaceEvent && groupPreference\.workspaceUpdates === false/);
assert.match(push, /event\.eventType === "group_note_created"/);
assert.match(groupSettings, /groupNotificationPreferences\.workspaceUpdates/);
assert.match(alerts, /filter === "workspace"/);
assert.match(alerts, /pathname: "\/group-schedule"/);
assert.match(alerts, /noteFocusAt: String\(Date\.now\(\)\)/);
assert.match(alerts, /scheduleFocusAt: String\(Date\.now\(\)\)/);
assert.match(hubCloud, /dispatchWorkspaceUpdate\("group-note"/);
assert.match(hubCloud, /dispatchWorkspaceUpdate\("group-schedule"/);
assert.match(
  push,
  /event\.category === "metric" &&\s*!socialEvent &&\s*!groupTodoEvent &&\s*!workspaceEvent/,
  "tracker-update preferences must not suppress enabled social or group to-do events",
);
assert.match(
  groupTodosCloud,
  /setGroupTodoCompletion[\s\S]*set_group_todo_completion[\s\S]*flushPendingGroupPushEvents/,
  "the completion RPC must promptly dispatch its trigger-owned durable push rows",
);
assert.match(
  migration,
  /delete from public\.group_social_comments[\s\S]*target_type = 'group_note'[\s\S]*delete from public\.group_social_reactions[\s\S]*delete from public\.group_notification_events[\s\S]*delete from public\.push_dispatch_events[\s\S]*delete from public\.group_notes/,
  "group note deletion must transactionally remove polymorphic social and notification targets",
);
assert.match(
  migration,
  /p_target_type = 'group_recap'[\s\S]*\^v1:week:[\s\S]*v_occurrence_date::text[\s\S]*group_row\.created_at[\s\S]*v_occurrence_date < \(v_group_created_at at time zone 'UTC'\)::date - 1[\s\S]*v_occurrence_date > \(now\(\) at time zone 'UTC'\)::date \+ 1/,
  "aggregate recap identities must use one bounded, viewer-independent global date window",
);
assert.match(
  migration,
  /v_story_id in \([\s\S]*'group-champion'[\s\S]*'group-distance'[\s\S]*'group-comeback'[\s\S]*'group-finish'[\s\S]*definition\.group_id = p_group_id[\s\S]*definition\.slug = substring\(v_story_id from 7\)/,
  "aggregate recap stories must resolve to a fixed renderer story or an actual metric in that group",
);
assert.match(
  migration,
  /resolve_group_social_notification_target[\s\S]*p_target_type = 'group_recap'[\s\S]*return;/,
  "ownerless aggregate stories must never manufacture a notification recipient",
);
assert.match(migration, /create or replace function public\.emit_group_workspace_notification/);
assert.match(migration, /member\.user_id <> v_actor_id/);
assert.match(migration, /habhub_users_blocked_either_way/);
assert.match(
  migration,
  /p_target_type = 'chat_message'[\s\S]*p_reaction not in \('thumbs_up', 'thumbs_down'\)/,
  "chat social writes must enforce the same like/dislike contract as the UI",
);
assert.match(
  migration,
  /create policy group_notification_events_recipient_read[\s\S]*event_type not in \([\s\S]*'group_note_created'[\s\S]*'group_schedule_updated'[\s\S]*habhub_users_blocked_either_way/,
  "workspace notification metadata must obey the same block boundary as its content",
);
for (const eventType of [
  "group_note_created",
  "group_note_updated",
  "group_schedule_created",
  "group_schedule_updated",
])
  assert.match(migration, new RegExp(`'${eventType}'`));

for (const fixture of [
  "demo-group-note-meals-",
  "demo-group-note-challenge-",
  "demo-group-event-prep-",
  "demo-group-event-strength-",
])
  assert.match(hubHook, new RegExp(fixture));
assert.match(hubHook, /creatorId: creatorAt\(2\)/);
assert.match(
  hubHook,
  /canonicalGroupScheduleAllDayInstant\(\s*dateKeyWithOffset\(3\),?\s*\)/,
);

const migrationDirectory = path.join(root, "supabase", "migrations");
const migrationFiles = fs
  .readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const groupMigrationName = "202609080003_group_hub_social_productivity.sql";
const resetMigrationName = "202609080004_reset_account_private_data.sql";
const groupMigrationIndex = migrationFiles.indexOf(groupMigrationName);
const resetMigrationIndex = migrationFiles.indexOf(resetMigrationName);
assert.ok(groupMigrationIndex >= 0, "group hub migration must be present");
assert.ok(
  resetMigrationIndex > groupMigrationIndex,
  "account reset must run after the group hub migration on a fresh schema",
);
const schemaBeforeGroup = migrationFiles
  .slice(0, groupMigrationIndex)
  .map((name) => read(path.join("supabase", "migrations", name)))
  .join("\n");
const schemaBeforeReset = migrationFiles
  .slice(0, resetMigrationIndex)
  .map((name) => read(path.join("supabase", "migrations", name)))
  .join("\n");
function assertTablePrecedes(sql, table, consumer) {
  assert.match(
    sql,
    new RegExp(
      `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${table}\\b`,
      "i",
    ),
    `${table} must exist before ${consumer} on a fresh schema`,
  );
}
function assertFunctionPrecedes(sql, fn, consumer) {
  assert.match(
    sql,
    new RegExp(
      `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${fn}\\b`,
      "i",
    ),
    `${fn} must exist before ${consumer} on a fresh schema`,
  );
}
for (const table of [
  "groups",
  "profiles",
  "group_members",
  "group_todos",
  "group_todo_completions",
  "messages",
  "group_social_reactions",
  "group_social_comments",
  "group_notification_events",
  "push_dispatch_events",
  "group_challenges",
  "group_challenge_result_placements",
  "metric_entries",
  "metric_definitions",
  "photo_updates",
  "daily_metric_status",
])
  assertTablePrecedes(schemaBeforeGroup, table, groupMigrationName);
for (const fn of [
  "is_group_member",
  "is_group_admin",
  "habhub_has_current_terms_acceptance",
  "habhub_message_content_allowed",
  "habhub_message_visible_to_current_user",
  "habhub_users_blocked_either_way",
  "group_challenge_occurs_on",
  "resolve_group_social_metric_entry_id",
  "resolve_group_social_daily_leader",
])
  assertFunctionPrecedes(schemaBeforeGroup, fn, groupMigrationName);
for (const table of [
  "account_devices",
  "daily_metric_status",
  "dashboard_layouts",
  "device_push_tokens",
  "energy_profiles",
  "expo_push_receipts",
  "google_health_account_deletion_guards",
  "group_challenge_user_preferences",
  "group_member_aliases",
  "group_notification_events",
  "group_social_comments",
  "group_social_reactions",
  "health_connections",
  "health_sync_cursors",
  "media_assets",
  "member_aliases",
  "metric_definitions",
  "metric_entries",
  "metric_entry_tombstones",
  "metric_goals",
  "notification_preferences",
  "photo_updates",
  "public_challenge_projection_cursors",
  "public_challenge_snapshot_cache_state",
  "public_challenge_snapshot_daily_cache",
  "push_token_dispatch_acceptances",
  "tracked_goal_periods",
  "user_blocks",
  "user_snapshots",
  "web_personal_notification_schedule",
  "web_push_subscriptions",
])
  assertTablePrecedes(schemaBeforeReset, table, resetMigrationName);

console.log("Group hub toolbar, completion UX, social linking, and sync validation passed.");
