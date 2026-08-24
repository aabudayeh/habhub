import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";

import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { AppText as Text } from "@/src/components/AppText";
import { useTodoSubtaskExpansion } from "@/src/components/useTodoSubtaskExpansion";
import { useTodoItemVisibility } from "@/src/components/useTodoItemVisibility";
import { dateKey } from "@/src/domain/date";
import {
  groupTodoAppearsOnDate,
  groupTodoCompletedOnDate,
  descendantTodoIds,
  todoLabels,
} from "@/src/domain/todos";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GroupTodoItem } from "@/src/types";

const priorityColors = {
  low: "#6C8AA6",
  normal: "#8A8F98",
  high: "#F59E0B",
  urgent: "#D24B4B",
};

export function GroupTodoLeaderboardSection({
  editing,
  onRequestEdit,
  focusTodoId,
  onLayout,
}: {
  editing: boolean;
  onRequestEdit: () => void;
  focusTodoId?: string;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { state, updateSettings, deleteCalendarReminder } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const enabled = state.group.groupTodosEnabled === true;
  const visible =
    state.settings.showGroupTodosByGroup?.[state.group.id] === true;
  const groupTodos = useGroupTodos(state.group.id, enabled && (visible || editing));
  const subtaskExpansion = useTodoSubtaskExpansion(
    `group:${state.currentUserId}:${state.group.id}`,
  );
  const expandSubtaskBranch = subtaskExpansion.expand;
  const itemVisibility = useTodoItemVisibility(
    `group:${state.currentUserId}:${state.group.id}`,
  );
  const [activeLabel, setActiveLabel] = useState<string>();
  const today = dateKey();
  const reminders = useMemo(
    () =>
      (state.calendarReminders ?? []).filter(
        (reminder) =>
          reminder.groupId === state.group.id && Boolean(reminder.groupTodoId),
      ),
    [state.calendarReminders, state.group.id],
  );
  const allLabels = useMemo(
    () =>
      [...new Set(groupTodos.todos.flatMap((todo) => todoLabels(todo)))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [groupTodos.todos],
  );
  useEffect(() => {
    if (activeLabel && !allLabels.includes(activeLabel)) setActiveLabel(undefined);
  }, [activeLabel, allLabels]);
  useEffect(() => {
    if (
      !enabled ||
      (!visible && !editing) ||
      !groupTodos.ready ||
      groupTodos.error
    )
      return;
    const availableIds = new Set(groupTodos.todos.map((todo) => todo.id));
    for (const reminder of reminders)
      if (reminder.groupTodoId && !availableIds.has(reminder.groupTodoId))
        deleteCalendarReminder(reminder.id);
  }, [deleteCalendarReminder, editing, enabled, groupTodos.error, groupTodos.ready, groupTodos.todos, reminders, visible]);
  useEffect(() => {
    if (!focusTodoId) return;
    const byId = new Map(groupTodos.todos.map((todo) => [todo.id, todo]));
    const visited = new Set<string>();
    let parentId = byId.get(focusTodoId)?.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      expandSubtaskBranch(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }, [expandSubtaskBranch, focusTodoId, groupTodos.todos]);

  if (!enabled || (!visible && !editing)) return null;

  const toggleVisibility = () =>
    updateSettings({
      showGroupTodosByGroup: {
        ...(state.settings.showGroupTodosByGroup ?? {}),
        [state.group.id]: !visible,
      },
    });
  const eligible = groupTodos.todos
    .filter((todo) => groupTodoAppearsOnDate(todo, today))
    .filter(
      (todo) =>
        editing ||
        itemVisibility.isVisible(todo.id) ||
        focusTodoId === todo.id,
    )
    .filter(
      (todo) => !activeLabel || todoLabels(todo).includes(activeLabel),
    );
  const eligibleIds = new Set(eligible.map((todo) => todo.id));
  const roots = eligible.filter(
    (todo) => !todo.parentId || !eligibleIds.has(todo.parentId),
  );
  const children = new Map<string, GroupTodoItem[]>();
  for (const todo of eligible) {
    if (!todo.parentId || !eligibleIds.has(todo.parentId)) continue;
    const siblings = children.get(todo.parentId) ?? [];
    siblings.push(todo);
    children.set(todo.parentId, siblings);
  }
  const complete = (todo: GroupTodoItem) =>
    groupTodoCompletedOnDate(todo, state.currentUserId, today);
  const sort = (left: GroupTodoItem, right: GroupTodoItem) =>
    Number(complete(left)) - Number(complete(right)) ||
    (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999") ||
    left.createdAt.localeCompare(right.createdAt);
  roots.sort(sort);
  children.forEach((items) => items.sort(sort));

  const canDelete = (todo: GroupTodoItem) => {
    const me = state.group.members.find(
      (member) => member.id === state.currentUserId,
    );
    return (
      todo.creatorId === state.currentUserId ||
      me?.role === "owner" ||
      me?.role === "admin"
    );
  };
  const confirmDelete = (todo: GroupTodoItem) =>
    Alert.alert("Delete group to-do?", "Its nested subtasks will also be removed for everyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const removed = descendantTodoIds(groupTodos.todos, todo.id);
          removed.add(todo.id);
          for (const reminder of reminders)
            if (reminder.groupTodoId && removed.has(reminder.groupTodoId))
              deleteCalendarReminder(reminder.id);
          void groupTodos.remove(todo.id);
        },
      },
    ]);

  const renderBranch = (todo: GroupTodoItem, depth: number): React.ReactNode => {
    const nested = children.get(todo.id) ?? [];
    const nestedExpanded = subtaskExpansion.isExpanded(todo.id);
    const itemVisible = itemVisibility.isVisible(todo.id);
    const done = complete(todo);
    const overdue = Boolean(
      !todo.recurrence &&
        todo.dueAt &&
        todo.dueAt < new Date().toISOString() &&
        !done,
    );
    const reminderCount = reminders.filter(
      (reminder) => reminder.groupTodoId === todo.id && reminder.enabled,
    ).length;
    const completedMemberCount = todo.recurrence
      ? todo.completedBy.filter(
          (entry) => dateKey(new Date(entry.completedAt)) === today,
        ).length
      : todo.completedByIds.length;
    return (
      <View key={todo.id} style={depth ? styles.subtaskBranch : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit group to-do ${todo.title}`}
          onPress={() =>
            router.navigate({
              pathname: "/group-todo-editor",
              params: { id: todo.id },
            } as never)
          }
          onLongPress={onRequestEdit}
          delayLongPress={325}
          style={[
            styles.row,
            depth > 0 && styles.subtaskRow,
            {
              backgroundColor: colors.card,
              opacity: itemVisible ? 1 : 0.56,
              borderColor:
                focusTodoId === todo.id
                  ? accent
                  : overdue
                    ? "#D24B4B66"
                    : colors.border,
            },
          ]}
        >
          <Pressable
            accessibilityLabel={done ? "Mark incomplete" : "Mark complete"}
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              void groupTodos.toggle(todo);
            }}
          >
            <Ionicons
              name={done ? "checkmark-circle" : "ellipse-outline"}
              size={depth ? 18 : 21}
              color={done ? "#B8E45C" : colors.faint}
            />
          </Pressable>
          <View style={styles.copy}>
            <Text
              translate={false}
              numberOfLines={2}
              style={[
                styles.name,
                depth > 0 && styles.subtaskName,
                { color: colors.ink },
                done && styles.complete,
              ]}
            >
              {todo.title}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons
                name="flag"
                size={9}
                color={priorityColors[todo.priority]}
              />
              {todo.recurrence ? (
                <Ionicons name="repeat-outline" size={10} color={colors.muted} />
              ) : null}
              {reminderCount ? (
                <Ionicons name="notifications-outline" size={10} color={accent} />
              ) : null}
              <Text
                numberOfLines={1}
                style={[styles.meta, { color: overdue ? "#D24B4B" : colors.muted }]}
              >
                {todo.completionMode === "shared"
                  ? done
                    ? "Done for group"
                    : "Shared completion"
                  : `${completedMemberCount}/${state.group.members.length} completed`}
                {todo.recurrence
                  ? " · repeats"
                  : todo.dueAt
                    ? ` · due ${todo.dueAt.slice(0, 10)}`
                    : ""}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            {editing ? (
              <Pressable
                accessibilityLabel={itemVisible ? "Hide group to-do" : "Show group to-do"}
                hitSlop={7}
                onPress={(event) => {
                  event.stopPropagation();
                  itemVisibility.toggle(todo.id);
                }}
                style={styles.smallAction}
              >
                <Ionicons
                  name={itemVisible ? "eye-outline" : "eye-off-outline"}
                  size={13}
                  color={itemVisible ? colors.faint : "#E9A23B"}
                />
              </Pressable>
            ) : null}
            {nested.length ? (
              <Pressable
                accessibilityLabel={
                  nestedExpanded
                    ? "Collapse group sub-to-dos"
                    : "Expand group sub-to-dos"
                }
                accessibilityState={{ expanded: nestedExpanded }}
                hitSlop={7}
                onPress={(event) => {
                  event.stopPropagation();
                  subtaskExpansion.toggle(todo.id);
                }}
                style={styles.smallAction}
              >
                <Ionicons
                  name={nestedExpanded ? "chevron-up" : "chevron-down"}
                  size={13}
                  color={colors.faint}
                />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Add group subtask"
              hitSlop={7}
              onPress={(event) => {
                event.stopPropagation();
                router.navigate({
                  pathname: "/group-todo-editor",
                  params: { parentId: todo.id },
                } as never);
              }}
              style={styles.smallAction}
            >
              <Ionicons name="return-down-forward-outline" size={13} color={colors.faint} />
            </Pressable>
            {canDelete(todo) ? (
              <Pressable
                accessibilityLabel="Delete group to-do"
                hitSlop={7}
                onPress={(event) => {
                  event.stopPropagation();
                  confirmDelete(todo);
                }}
                style={styles.smallAction}
              >
                <Ionicons name="trash-outline" size={13} color={colors.faint} />
              </Pressable>
            ) : null}
            <Ionicons name="chevron-forward" size={13} color={colors.faint} />
          </View>
        </Pressable>
        {nested.length && nestedExpanded ? (
          <View style={[styles.subtaskSection, { borderLeftColor: colors.border }] }>
            {nested.map((child) => renderBranch(child, depth + 1))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View
      nativeID="group-todos"
      onLayout={onLayout}
      style={styles.root}
      testID="leaderboard-group-todos"
    >
      <View style={styles.heading}>
        <Pressable
          onLongPress={onRequestEdit}
          delayLongPress={325}
          style={styles.titleButton}
        >
          <Ionicons name="people-outline" size={15} color={accent} />
          <Text style={[styles.title, { color: colors.ink }]}>Group To-Dos</Text>
        </Pressable>
        {editing ? (
          <Pressable
            accessibilityLabel={visible ? "Hide group to-dos" : "Show group to-dos"}
            hitSlop={8}
            onPress={toggleVisibility}
          >
            <Ionicons
              name={visible ? "eye-outline" : "eye-off-outline"}
              size={17}
              color={visible ? accent : colors.faint}
            />
          </Pressable>
        ) : null}
        {visible ? (
          <Pressable
            onPress={() => router.navigate("/group-todo-editor" as never)}
            style={styles.add}
          >
            <Ionicons name="add-circle-outline" size={17} color={accent} />
            <Text style={[styles.addText, { color: accent }]}>New</Text>
          </Pressable>
        ) : null}
      </View>
      {!visible ? (
        <Pressable
          accessibilityLabel="Show group to-dos"
          onPress={toggleVisibility}
          style={[styles.hidden, { borderColor: colors.border }]}
        >
          <Ionicons name="eye-off-outline" size={15} color={colors.faint} />
          <Text style={[styles.hiddenText, { color: colors.muted }]}>Hidden from Leaderboard · tap the eye to show</Text>
        </Pressable>
      ) : (
        <>
          {allLabels.length ? (
            <View style={styles.labelFilters}>
              <Pressable
                onPress={() => setActiveLabel(undefined)}
                style={[
                  styles.labelChip,
                  {
                    backgroundColor: activeLabel ? colors.canvas : colors.primarySoft,
                    borderColor: activeLabel ? colors.border : accent,
                  },
                ]}
              >
                <Text style={[styles.labelChipText, { color: activeLabel ? colors.muted : accent }]}>All</Text>
              </Pressable>
              {allLabels.map((label) => (
                <Pressable
                  key={label}
                  onPress={() => setActiveLabel((current) => current === label ? undefined : label)}
                  style={[
                    styles.labelChip,
                    {
                      backgroundColor: activeLabel === label ? colors.primarySoft : colors.canvas,
                      borderColor: activeLabel === label ? accent : colors.border,
                    },
                  ]}
                >
                  <Text translate={false} style={[styles.labelChipText, { color: activeLabel === label ? accent : colors.muted }]}>#{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {roots.map((todo) => renderBranch(todo, 0))}
          {!groupTodos.loading && !eligible.length && !activeLabel ? (
            <Pressable
              onPress={() => router.navigate("/group-todo-editor" as never)}
              style={[styles.empty, { borderColor: colors.border }]}
            >
              <Ionicons name="people-circle-outline" size={17} color={accent} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>Add the first group task</Text>
            </Pressable>
          ) : null}
          {groupTodos.loading && !groupTodos.todos.length ? (
            <Text style={[styles.status, { color: colors.muted }]}>Refreshing group tasks…</Text>
          ) : groupTodos.error ? (
            <Pressable onPress={() => void groupTodos.refresh()}>
              <Text translate={false} style={[styles.status, { color: "#D24B4B" }]}>{groupTodos.error} · Tap to retry</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6, marginTop: 9, marginBottom: 5 },
  heading: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 9 },
  titleButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 14, fontWeight: "900" },
  add: { flexDirection: "row", alignItems: "center", gap: 4 },
  addText: { fontSize: 9, fontWeight: "900" },
  hidden: { minHeight: 46, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  hiddenText: { fontSize: 8, fontWeight: "800" },
  row: { minHeight: 54, borderWidth: 1, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 9 },
  subtaskRow: { minHeight: 39, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 5, gap: 7 },
  subtaskBranch: { marginTop: 4 },
  subtaskSection: { marginLeft: 16, paddingLeft: 8, borderLeftWidth: 1 },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 10, lineHeight: 14, fontWeight: "900" },
  subtaskName: { fontSize: 8.5, lineHeight: 11, fontWeight: "800" },
  complete: { textDecorationLine: "line-through", opacity: 0.62 },
  metaRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { flexShrink: 1, fontSize: 7, lineHeight: 10, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 3 },
  smallAction: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  empty: { minHeight: 52, borderWidth: 1, borderStyle: "dashed", borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  emptyText: { fontSize: 8, fontWeight: "800" },
  status: { fontSize: 8, lineHeight: 12, textAlign: "center" },
  labelFilters: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  labelChip: { minHeight: 24, paddingHorizontal: 8, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  labelChipText: { fontSize: 7, fontWeight: "900" },
});
