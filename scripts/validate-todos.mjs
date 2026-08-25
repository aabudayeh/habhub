import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  descendantTodoIds,
  extractTodoLabels,
  flattenTodoHierarchy,
  formatTodoLabel,
  formatTodoLabelText,
  groupTodoReminderFeatureEnabled,
  normalizeTodoItems,
  removeTodoLabelFromText,
  todoMatchesViewFilter,
} from "../src/domain/todos.ts";
import {
  clearTodoEditorDraftTree,
  getTodoEditorDraftNodes,
  orderTodoEditorDraftNodes,
  removeTodoEditorDraftSubtree,
  resolveTodoEditorDraftParentId,
  upsertTodoEditorDraft,
} from "../src/state/todoEditorDrafts.ts";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.deepEqual(
  extractTodoLabels("Write #Work plan #work", "Review #Body-health and #研究"),
  ["work", "body-health", "研究"],
  "quick labels should be normalized, de-duplicated, and Unicode-safe",
);
assert.equal(formatTodoLabel("#wORK"), "Work");
assert.equal(
  formatTodoLabelText("#work plan for #body-health"),
  "Work plan for Body-health",
  "Today copy should hide label hashes and capitalize each displayed label",
);
assert.equal(
  removeTodoLabelFromText("Plan #Work sprint with #team", "work"),
  "Plan sprint with #team",
  "removing a label must remove its token without leaving doubled spacing",
);
assert.equal(
  removeTodoLabelFromText("#work Start here\nKeep #body", "WORK"),
  "Start here\nKeep #body",
  "label removal must be normalized and preserve line boundaries",
);
assert.equal(
  removeTodoLabelFromText("Task #work.", "work"),
  "Task.",
  "removing an end label must not leave a space before punctuation",
);
assert.equal(
  removeTodoLabelFromText("Task #work", "work"),
  "Task",
  "removing a trailing label must not leave trailing whitespace",
);

const labeledTodo = {
  id: "labeled",
  title: "Plan #Work sprint",
  description: "Coordinate with #Team-a",
};
assert.equal(
  todoMatchesViewFilter(labeledTodo, { todoLabels: ["work"] }),
  true,
  "saved label rules should match normalized labels parsed from To-Do copy",
);
assert.equal(
  todoMatchesViewFilter(labeledTodo, { todoLabels: ["personal", "TEAM-A"] }),
  true,
  "multiple saved labels should use normalized any-label matching",
);
assert.equal(
  todoMatchesViewFilter(labeledTodo, {
    todoIds: ["another"],
    todoLabels: ["work"],
  }),
  false,
  "an explicit To-Do selection should further narrow a saved label rule",
);
assert.equal(
  todoMatchesViewFilter(labeledTodo, { todoLabels: ["future"] }),
  false,
  "unmatched saved labels must exclude the To-Do",
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

const editorTreeId = "validation-editor-drafts";
clearTodoEditorDraftTree(editorTreeId);
upsertTodoEditorDraft(editorTreeId, {
  id: "draft-root",
  title: "Unsaved parent",
  value: { title: "Unsaved parent" },
});
upsertTodoEditorDraft(editorTreeId, {
  id: "draft-child",
  parentId: "draft-root",
  title: "Child",
  value: { title: "Child" },
});
upsertTodoEditorDraft(editorTreeId, {
  id: "draft-grandchild",
  parentId: "draft-child",
  title: "Grandchild",
  value: { title: "Grandchild" },
});
upsertTodoEditorDraft(editorTreeId, {
  id: "draft-child",
  parentId: "draft-root",
  title: "Edited child",
  value: { title: "Edited child" },
});
assert.equal(
  getTodoEditorDraftNodes(editorTreeId).find(
    (node) => node.id === "draft-child",
  )?.title,
  "Edited child",
  "opening and saving a specific staged child should replace that child only",
);
const orderedDrafts = orderTodoEditorDraftNodes(
  [
    getTodoEditorDraftNodes(editorTreeId).find(
      (node) => node.id === "draft-grandchild",
    ),
    getTodoEditorDraftNodes(editorTreeId).find(
      (node) => node.id === "draft-child",
    ),
  ].filter(Boolean),
  ["draft-root"],
);
assert.deepEqual(
  orderedDrafts.map((node) => node.id),
  ["draft-child", "draft-grandchild"],
  "nested drafts must persist parent-first even when collected out of order",
);
const serverIds = new Map([["draft-root", "server-root"]]);
assert.equal(
  resolveTodoEditorDraftParentId(orderedDrafts[0].parentId, serverIds),
  "server-root",
  "a group child must use its parent's server-generated id",
);
serverIds.set("draft-child", "server-child");
assert.equal(
  resolveTodoEditorDraftParentId(orderedDrafts[1].parentId, serverIds),
  "server-child",
  "a nested group child must use the remapped server id at every depth",
);
assert.throws(
  () =>
    orderTodoEditorDraftNodes([
      { id: "cycle-a", parentId: "cycle-b", title: "A", value: {} },
      { id: "cycle-b", parentId: "cycle-a", title: "B", value: {} },
    ]),
  /unresolved cycle/,
  "corrupt draft cycles must fail instead of partially saving",
);
removeTodoEditorDraftSubtree(editorTreeId, "draft-child");
assert.deepEqual(
  getTodoEditorDraftNodes(editorTreeId).map((node) => node.id),
  ["draft-root"],
  "discarding a child draft must also discard its nested descendants",
);
clearTodoEditorDraftTree(editorTreeId);

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
assert.match(today, /useTodoSubtaskExpansion/);
assert.match(today, /useTodoItemVisibility/);
assert.match(today, /accessibilityLabel=\{visible \? "Hide to-do" : "Show to-do"\}/);
assert.match(today, /accessibilityLabel=\{t\("Delete"\)\}/);
assert.match(today, /onPress: \(\) => deleteTodo\(todo\.id\)/);
assert.match(today, /children\.length && childrenExpanded/);
assert.match(today, /formatTodoLabelText\(todo\.title\)/);
assert.match(today, /formatTodoLabel\(label\)/);
assert.match(today, /const \[labelsExpanded, setLabelsExpanded\] = useState\(false\)/);
assert.match(today, /accessibilityHint="Opens the To-Do tracker"/);
assert.match(
  today,
  /accessibilityHint="Opens the To-Do tracker"[\s\S]{0,300}pathname: "\/metric-detail"/,
  "the To-Dos title itself must retain tracker navigation",
);
assert.match(today, /labelsExpanded \? "Collapse To-Do labels" : "Expand To-Do labels"/);
assert.match(
  today,
  /setLabelsExpanded\(\(expanded\)[\s\S]{0,180}return !expanded/,
  "the adjacent arrow must toggle the collapsed label tray instead of navigating",
);
assert.match(today, /visible && labelsExpanded && allLabels\.length/);
assert.match(today, /useTodoCardPress<TodoItem>/);
assert.match(today, /todoCardPress\.onPress\(todo, alreadyComplete, !editing\)/);
assert.match(
  today,
  /todoMatchesViewFilter\(todo, \{ todoIds, todoLabels \}\)/,
);
assert.doesNotMatch(
  today,
  /useGroupTodos|Group To-Dos|group-todo-editor/,
  "group tasks belong to Leaderboard and must not leak back into Today",
);
const viewFilters = read("app/view-filters.tsx");
assert.match(viewFilters, /availableTodoLabels/);
assert.match(viewFilters, /setSelectedTodoLabels/);
assert.match(viewFilters, /todoLabels:[\s\S]{0,160}normalizedTodoLabels/);
assert.match(viewFilters, /formatTodoLabel\(label\)/);
const todayHero = read("src/domain/todayHero.ts");
assert.match(
  todayHero,
  /todoMatchesViewFilter\(todo, \{ todoIds, todoLabels \}\)/,
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
assert.match(leaderboardTodos, /useTodoSubtaskExpansion/);
assert.match(leaderboardTodos, /useTodoItemVisibility/);
assert.match(leaderboardTodos, /accessibilityLabel=\{itemVisible \? "Hide group to-do" : "Show group to-do"\}/);
assert.match(leaderboardTodos, /nested\.length && nestedExpanded/);
assert.match(leaderboardTodos, /useTodoCardPress<GroupTodoItem>/);
assert.match(leaderboardTodos, /todoCardPress\.onPress\(todo, done, !editing\)/);
assert.match(
  leaderboardTodos,
  /\{editing && canDelete\(todo\) \? \([\s\S]{0,500}accessibilityLabel="Delete group to-do"/,
  "group deletion must be destructive and visible only while Leaderboard edit mode is active",
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
assert.match(chat, /attachableGroupTodos/);
assert.match(chat, /groupTodoItemVisibility\.isVisible/);

const groupEditor = read("app/group-todo-editor.tsx");
assert.match(groupEditor, /repeatMode/);
assert.match(groupEditor, /groupTodoId: savedId/);
assert.match(groupEditor, /Private to you and synced only with your account/);
assert.match(groupEditor, /<TodoSubtaskEditorSection/);
assert.match(groupEditor, /draftTreeId: editorTreeId/);
assert.match(groupEditor, /resolveTodoEditorDraftParentId/);
assert.match(groupEditor, /rootPersistedId/);
assert.match(groupEditor, /persistedId: savedChild\.id/);
assert.match(groupEditor, /createdDuringDraft/);
assert.match(groupEditor, /cleanupCreatedDraftRows/);
assert.match(groupEditor, /canAdd/);
assert.match(groupEditor, /addingDisabled=\{saving\}/);
assert.match(groupEditor, /canManageItem=/);
assert.match(groupEditor, /<Ionicons name="trash-outline"[\s\S]{0,120}Delete for group/);
assert.match(groupEditor, /useWebBackNavigationGuard/);
const personalEditor = read("app/todo-editor.tsx");
assert.match(personalEditor, /<TodoSubtaskEditorSection/);
assert.match(personalEditor, /router\.push/);
assert.match(personalEditor, /draftTreeId: editorTreeId/);
assert.match(personalEditor, /useWebBackNavigationGuard/);
assert.match(personalEditor, /useTodoLabelDoubleTap/);
assert.match(personalEditor, /removeTodoLabelFromText/);
assert.doesNotMatch(
  personalEditor,
  /const parsedLabels = todoLabels\(\{[\s\S]{0,120}existing\?\.labels/,
  "removing the #label text must remove the saved label instead of restoring stale metadata",
);
assert.match(groupEditor, /useTodoLabelDoubleTap/);
assert.match(groupEditor, /removeTodoLabelFromText/);
assert.doesNotMatch(
  groupEditor,
  /const labels = todoLabels\(\{[\s\S]{0,120}existing\?\.labels/,
  "group labels must also disappear when their inline #label text is removed",
);
const todoDoubleTap = read("src/components/useTodoDoubleTap.ts");
assert.match(todoDoubleTap, /previous\?\.id === item\.id/);
assert.match(todoDoubleTap, /if \(!alreadyComplete\) callbacks\.current\.onComplete\(item\)/);
assert.match(todoDoubleTap, /callbacks\.current\.onOpen\(next\.item\)/);
assert.match(todoDoubleTap, /TODO_DOUBLE_TAP_WINDOW_MS = 220/);
assert.match(todoDoubleTap, /activePress\.current\.longPressTriggered/);
assert.match(todoDoubleTap, /onPressIn/);
assert.match(todoDoubleTap, /onLongPress/);
const editorSection = read("src/components/TodoSubtaskEditorSection.tsx");
assert.match(editorSection, /useState\(true\)/);
assert.match(editorSection, /flattenTodoHierarchy\(items\)/);
assert.match(editorSection, /Add sub-to-do/);
assert.match(editorSection, /canManageItem\?\.\(item\.id\)/);
assert.match(editorSection, /collapsed && canAdd/);
const expansionPreference = read("src/components/useTodoSubtaskExpansion.ts");
assert.match(expansionPreference, /AsyncStorage\.getItem/);
assert.match(expansionPreference, /AsyncStorage\.setItem/);
const visibilityPreference = read("src/components/useTodoItemVisibility.ts");
assert.match(visibilityPreference, /Local, account-scoped visibility/);
assert.match(visibilityPreference, /AsyncStorage\.setItem/);

console.log("To-do hierarchy, labels, group RLS/RPCs, and chat attachment checks passed.");
