import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  descendantTodoIds,
  extractTodoLabels,
  flattenTodoHierarchy,
  groupTodoReminderFeatureEnabled,
  normalizeTodoItems,
} from "../src/domain/todos.ts";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.deepEqual(
  extractTodoLabels("Write #Work plan #work", "Review #Body-health and #研究"),
  ["work", "body-health", "研究"],
  "quick labels should be normalized, de-duplicated, and Unicode-safe",
);

const baseTodo = {
  title: "Task",
  createdAt: "2026-08-24T10:00:00.000Z",
  priority: "normal",
  reminders: [],
  completedDates: [],
};
const repaired = normalizeTodoItems([
  { ...baseTodo, id: "a", parentId: "c", title: "#Work root" },
  { ...baseTodo, id: "b", parentId: "a" },
  { ...baseTodo, id: "c", parentId: "b" },
  { ...baseTodo, id: "orphan", parentId: "missing" },
]);
assert.equal(
  repaired.find((todo) => todo.id === "a")?.parentId,
  undefined,
  "cyclic adjacency should be repaired to a visible root",
);
assert.equal(
  repaired.find((todo) => todo.id === "orphan")?.parentId,
  undefined,
  "missing parents should not hide legacy tasks",
);
assert.deepEqual(repaired.find((todo) => todo.id === "a")?.labels, ["work"]);

const tree = [
  { id: "root" },
  { id: "child", parentId: "root" },
  { id: "grandchild", parentId: "child" },
  { id: "other" },
];
assert.deepEqual([...descendantTodoIds(tree, "root")].sort(), ["child", "grandchild"]);
assert.deepEqual(
  flattenTodoHierarchy(tree).map(({ item, depth }) => [item.id, depth]),
  [["root", 0], ["child", 1], ["grandchild", 2], ["other", 0]],
  "arbitrary nesting should stay ordered and visibly indented",
);

const reminderFeatureState = {
  group: { id: "active", groupTodosEnabled: true },
  groups: [
    { id: "active", groupTodosEnabled: true },
    { id: "disabled", groupTodosEnabled: false },
  ],
};
assert.equal(
  groupTodoReminderFeatureEnabled(reminderFeatureState, {
    groupId: "active",
    groupTodoId: "todo-1",
  }),
  true,
);
assert.equal(
  groupTodoReminderFeatureEnabled(reminderFeatureState, {
    groupId: "disabled",
    groupTodoId: "todo-2",
  }),
  false,
  "private reminders must stop when that group's Group To-Do feature is disabled",
);
assert.equal(
  groupTodoReminderFeatureEnabled(reminderFeatureState, {
    groupId: "missing",
    groupTodoId: "todo-3",
  }),
  false,
  "a missing group must fail closed for a Group To-Do reminder",
);

const migration = read("supabase/migrations/202608240002_group_todos.sql");
for (const required of [
  "alter table public.group_todos enable row level security",
  "group_todos_parent_same_group",
  "on delete cascade",
  "groupTodosEnabled",
  "public.is_group_member",
  "public.is_group_admin",
  "public.save_group_todo",
  "public.set_group_todo_completion",
  "public.delete_group_todo",
  "validate_group_todo_message_attachment",
  "before insert or update of metadata, group_id on public.messages",
  "messages_content_image_or_group_todo_check",
  "revoke all on public.group_todos from public, anon, authenticated",
  "revoke all on public.group_todo_completions from public, anon, authenticated",
  "group_todo_completions_member_fk",
  "public.preserve_group_todos_setting",
  "pg_catalog.pg_advisory_xact_lock",
  "if p_completed is null",
]) {
  assert.ok(migration.includes(required), `group to-do migration is missing: ${required}`);
}
assert.match(
  migration,
  /not \(coalesce\(new\.metadata, '\{\}'::jsonb\) \? 'todoAttachment'\)[\s\S]{0,260}old\.metadata -> 'todoAttachment'/,
  "legacy message upserts must not silently strip validated task attachments",
);
assert.match(
  migration,
  /Group to-do attachment not found[\s\S]{0,500}Group to-dos are disabled/,
  "the message trigger must reject new task attachments while the feature is disabled",
);
assert.match(
  migration,
  /drop constraint if exists messages_content_image_or_group_todo_check/,
  "the replacement message constraint should be repeat-safe",
);
assert.doesNotMatch(
  migration,
  /with recursive descendants\(id\)[\s\S]{0,300}union all/i,
  "server-side hierarchy validation must terminate even if legacy data is cyclic",
);
assert.ok(
  !/alter publication\s+supabase_realtime[\s\S]*group_todos/i.test(migration),
  "group tasks must not add another permanent Postgres Changes feed",
);

const recurrenceMigration = read(
  "supabase/migrations/202608240005_group_todo_recurrence.sql",
);
for (const required of [
  "public.valid_group_todo_recurrence",
  "add column if not exists recurrence jsonb",
  "group_todos_recurrence_shape",
  "public.save_group_todo_v2",
  "v_saved := public.save_group_todo",
  "set recurrence = p_recurrence",
  "to authenticated",
]) {
  assert.ok(
    recurrenceMigration.includes(required),
    `group to-do recurrence migration is missing: ${required}`,
  );
}
assert.match(
  recurrenceMigration,
  /\(value ->> 'anchorDate'\)::date[\s\S]{0,220}pg_catalog\.to_char\(v_anchor_date, 'YYYY-MM-DD'\)/,
  "recurrence anchors must reject calendar-impossible YYYY-MM-DD values",
);
assert.match(
  recurrenceMigration,
  /invalid_datetime_format[\s\S]{0,100}datetime_field_overflow/,
  "malformed recurrence dates must fail closed instead of aborting the RPC",
);
assert.match(
  recurrenceMigration,
  /revoke all on function public\.save_group_todo_v2\([\s\S]{0,180}from public, anon, authenticated/,
  "the v2 recurrence RPC must opt into authenticated execution explicitly",
);
assert.doesNotMatch(
  recurrenceMigration,
  /grant\s+(?:insert|update|delete|all)[\s\S]{0,80}on\s+(?:table\s+)?public\.group_todos/i,
  "recurrence support must not add direct table write grants",
);

const provider = read("src/state/AppProvider.tsx");
assert.match(provider, /descendantTodoIds\([\s\S]*removedIds\.add\(action\.todoId\)/);
assert.match(provider, /todoAttachment: action\.todoAttachment/);

const groupCloud = read("src/cloud/groupCloud.ts");
assert.match(groupCloud, /metadata: messageMetadata\(message\)/);
assert.match(groupCloud, /groupTodosEnabled: state\.group\.groupTodosEnabled \?\? false/);
const cloudProvider = read("src/cloud/CloudSyncProvider.tsx");
assert.match(cloudProvider, /groupTodosEnabled: state\.group\.groupTodosEnabled \?\? false/);
assert.match(cloudProvider, /localGroupConfiguration\.groupTodosEnabled/);

const groupTodoHook = read("src/cloud/useGroupTodos.ts");
assert.match(groupTodoHook, /groupTodoRealtimeByGroup/);
assert.match(groupTodoHook, /groupTodoLoadsByGroup/);
assert.match(groupTodoHook, /loadGroupTodosShared\(groupId\)/);
assert.match(groupTodoHook, /references: number/);
assert.match(groupTodoHook, /\.channel\(`group-todos:\$\{groupId\}`\)/);
assert.doesNotMatch(
  groupTodoHook,
  /\.channel\(`group-todos:\$\{groupId\}:\$\{/,
  "all devices must share one group broadcast topic",
);
const reminderReconciler = read(
  "src/components/GroupTodoReminderReconciler.tsx",
);
assert.match(reminderReconciler, /useGroupTodos\(state\.group\.id, shouldReconcile\)/);
assert.match(reminderReconciler, /deleteCalendarReminder\(reminder\.id\)/);
const rootLayout = read("app/_layout.tsx");
assert.match(rootLayout, /<GroupTodoReminderReconciler \/>/);
for (const planner of [
  read("src/notifications/push.ts"),
  read("src/notifications/webReminderSchedule.ts"),
  read("src/domain/calendar.ts"),
])
  assert.match(planner, /groupTodoReminderFeatureEnabled\(state, reminder\)/);

const today = read("src/components/TodoTodayList.tsx");
assert.match(today, /flattenTodoHierarchy\(visiblePersonalItems\)/);
assert.match(today, /return-down-forward-outline/);
assert.match(today, /subtaskSection/);
assert.doesNotMatch(
  today,
  /useGroupTodos|Group To-Dos|group-todo-editor/,
  "group tasks belong to Leaderboard and must not leak back into Today",
);

const leaderboardTodos = read("src/components/GroupTodoLeaderboardSection.tsx");
for (const required of [
  "Group To-Dos",
  "showGroupTodosByGroup",
  "groupTodoAppearsOnDate",
  "groupTodoCompletedOnDate",
  "subtaskSection",
  "Add group subtask",
  "Delete group to-do",
])
  assert.ok(
    leaderboardTodos.includes(required),
    `Leaderboard group to-dos are missing: ${required}`,
  );
const leaderboard = read("app/(tabs)/group.tsx");
assert.match(leaderboard, /GroupTodoLeaderboardSection/);
assert.match(leaderboard, /groupTodosBelowTrackers/);
assert.match(leaderboard, /focusGroupTodo/);

const chat = read("app/(tabs)/chat.tsx");
assert.match(chat, /Attached group to-do/);
assert.match(chat, /groupTodoId: attachedTodo\.id/);
assert.match(chat, /!draft\.trim\(\) && !imageUri && !attachedTodo/);
assert.match(chat, /pathname: "\/\(tabs\)\/group"/);
assert.match(chat, /groupTodosAvailable/);

const groupEditor = read("app/group-todo-editor.tsx");
assert.match(groupEditor, /repeatMode/);
assert.match(groupEditor, /groupTodoId: saved\.id/);
assert.match(groupEditor, /Private to you and synced only with your account/);

console.log("To-do hierarchy, labels, group RLS/RPCs, and chat attachment checks passed.");
