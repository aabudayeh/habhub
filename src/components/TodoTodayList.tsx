import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";

import { AppText as Text } from "@/src/components/AppText";
import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import {
  todoAppearsOnDate,
  todoCompletedOnDate,
  todoSkippedOnDate,
} from "@/src/domain/schedule";
import { flattenTodoHierarchy, todoLabels } from "@/src/domain/todos";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GroupTodoItem, TodoItem } from "@/src/types";

const priorityColors = {
  low: "#6C8AA6",
  normal: "#8A8F98",
  high: "#F59E0B",
  urgent: "#D24B4B",
};

export function TodoTodayList({
  localDate,
  onComplete,
  editing = false,
  onRequestEdit,
  visibleOverride = true,
  todoIds,
}: {
  localDate: string;
  onComplete?: (todoId: string) => void;
  editing?: boolean;
  onRequestEdit?: () => void;
  visibleOverride?: boolean;
  /** Undefined keeps every To-Do; an empty list intentionally shows none. */
  todoIds?: string[];
}) {
  const {
    state,
    toggleTodo,
    reorderTodo,
    saveTodo,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const visible = state.settings.showTodosToday !== false;
  const groupEnabled = state.group.groupTodosEnabled === true;
  const groupTodos = useGroupTodos(state.group.id, groupEnabled);
  const [activeLabel, setActiveLabel] = useState<string>();
  const allowedIds = todoIds ? new Set(todoIds) : undefined;
  const baseItems = (state.todos ?? [])
    .filter((todo) => !allowedIds || allowedIds.has(todo.id))
    .filter((todo) => todoAppearsOnDate(todo, localDate))
    .sort(
      (a, b) =>
        Number(Boolean(b.pinnedAt)) -
          Number(Boolean(a.pinnedAt)) ||
        (state.settings.completedTodayBehavior === "bottom"
          ? Number(
              todoCompletedOnDate(a, localDate) ||
                todoSkippedOnDate(a, localDate),
            ) -
            Number(
              todoCompletedOnDate(b, localDate) ||
                todoSkippedOnDate(b, localDate),
            )
          : 0) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
    );
  const allLabels = useMemo(
    () =>
      [...new Set(
        [...baseItems, ...(groupEnabled ? groupTodos.todos : [])].flatMap(
          (todo) => todoLabels(todo),
        ),
      )].sort((a, b) => a.localeCompare(b)),
    [baseItems, groupEnabled, groupTodos.todos],
  );
  useEffect(() => {
    if (activeLabel && !allLabels.includes(activeLabel)) setActiveLabel(undefined);
  }, [activeLabel, allLabels]);
  const items = activeLabel
    ? baseItems.filter((todo) => todoLabels(todo).includes(activeLabel))
    : baseItems;
  const visiblePersonalItems =
    !editing && state.settings.completedTodayBehavior === "hide"
      ? items.filter(
          (todo) =>
            !todoCompletedOnDate(todo, localDate) &&
            !todoSkippedOnDate(todo, localDate),
        )
      : items;
  const shownItems = flattenTodoHierarchy(visiblePersonalItems);
  const groupItems = [
    ...(activeLabel
      ? groupTodos.todos.filter((todo) => todoLabels(todo).includes(activeLabel))
      : groupTodos.todos),
  ].sort((a, b) => {
    const aComplete =
      a.completionMode === "shared"
        ? Boolean(a.completedAt)
        : a.completedByIds.includes(state.currentUserId);
    const bComplete =
      b.completionMode === "shared"
        ? Boolean(b.completedAt)
        : b.completedByIds.includes(state.currentUserId);
    return (
      (state.settings.completedTodayBehavior === "bottom"
        ? Number(aComplete) - Number(bComplete)
        : 0) || a.createdAt.localeCompare(b.createdAt)
    );
  });
  const visibleGroupItems =
    !editing && state.settings.completedTodayBehavior === "hide"
      ? groupItems.filter((todo) =>
          todo.completionMode === "shared"
            ? !todo.completedAt
            : !todo.completedByIds.includes(state.currentUserId),
        )
      : groupItems;
  const shownGroupItems = flattenTodoHierarchy(visibleGroupItems);
  if (visibleOverride === false || (!visible && !editing)) return null;

  const moveTodoBeside = (todo: TodoItem, targetTodo?: TodoItem) => {
    if (!targetTodo || targetTodo.id === todo.id) return;
    const globalTargetIndex = [...(state.todos ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .findIndex((item) => item.id === targetTodo.id);
    if (globalTargetIndex >= 0) reorderTodo(todo.id, globalTargetIndex);
  };

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Pressable
          onPress={() =>
            router.navigate({
              pathname: "/metric-detail",
              params: { metric: "todo_completion", date: localDate },
            } as never)
          }
          delayLongPress={325}
          onLongPress={() => {
            if (!editing) onRequestEdit?.();
          }}
          style={styles.titleButton}
        >
          <Text style={[styles.title, { color: colors.ink }]}>To-Dos</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.faint} />
        </Pressable>
        {editing ? (
          <Pressable
            onPress={() => updateSettings({ showTodosToday: !visible })}
            hitSlop={8}
          >
            <Ionicons
              name={visible ? "eye-outline" : "eye-off-outline"}
              size={16}
              color={visible ? accent : colors.faint}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          style={styles.add}
        >
          <Ionicons name="add-circle-outline" size={16} color={accent} />
          <Text style={[styles.addText, { color: accent }]}>New</Text>
        </Pressable>
      </View>
      {!visible && editing ? (
        <Text style={[styles.hidden, { color: colors.muted }]}>
          Hidden from Today. Tap the eye to show it.
        </Text>
      ) : null}
      {visible && allLabels.length ? (
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
      {visible
        ? shownItems.map(({ item: todo, depth }, index) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              localDate={localDate}
              editing={editing}
              index={index}
              count={shownItems.length}
              depth={depth}
              onAddChild={() =>
                router.navigate({
                  pathname: "/todo-editor",
                  params: { parentId: todo.id },
                } as never)
              }
              onPin={() =>
                saveTodo({
                  ...todo,
                  pinnedAt: todo.pinnedAt
                    ? undefined
                    : new Date().toISOString(),
                })
              }
              onMove={(targetIndex) => {
                moveTodoBeside(todo, shownItems[targetIndex]?.item);
              }}
              onLongPress={() => {
                if (!editing) onRequestEdit?.();
              }}
              onToggle={() => {
                const completing = !todoCompletedOnDate(todo, localDate);
                toggleTodo(todo.id, localDate);
                if (completing) onComplete?.(todo.id);
              }}
            />
          ))
        : null}
      {visible && !baseItems.length && !activeLabel ? (
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          delayLongPress={325}
          onLongPress={() => {
            if (!editing) onRequestEdit?.();
          }}
          style={[styles.empty, { borderColor: colors.border }]}
        >
          <Ionicons name="checkmark-circle-outline" size={16} color={accent} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            Nothing due. Add a quick to-do
          </Text>
        </Pressable>
      ) : null}
      {visible && groupEnabled ? (
        <View style={styles.groupSection}>
          <View style={styles.groupHeading}>
            <View style={styles.groupTitleRow}>
              <Ionicons name="people-outline" size={13} color={accent} />
              <Text style={[styles.groupTitle, { color: colors.ink }]}>Group To-Dos</Text>
            </View>
            <Pressable
              onPress={() => router.navigate("/group-todo-editor" as never)}
              style={styles.add}
            >
              <Ionicons name="add-circle-outline" size={16} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>New</Text>
            </Pressable>
          </View>
          {shownGroupItems.map(({ item: todo, depth }) => (
            <GroupTodoRow
              key={todo.id}
              todo={todo}
              depth={depth}
              currentUserId={state.currentUserId}
              memberCount={state.group.members.length}
              onToggle={() => void groupTodos.toggle(todo)}
              onAddChild={() =>
                router.navigate({
                  pathname: "/group-todo-editor",
                  params: { parentId: todo.id },
                } as never)
              }
            />
          ))}
          {!groupTodos.loading && !groupTodos.todos.length && !activeLabel ? (
            <Pressable
              onPress={() => router.navigate("/group-todo-editor" as never)}
              style={[styles.empty, { borderColor: colors.border }]}
            >
              <Ionicons name="people-circle-outline" size={16} color={accent} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>Add the first shared task</Text>
            </Pressable>
          ) : null}
          {groupTodos.loading ? (
            <Text style={[styles.groupMeta, { color: colors.muted }]}>Refreshing group tasks…</Text>
          ) : groupTodos.error ? (
            <Pressable onPress={() => void groupTodos.refresh()}>
              <Text translate={false} style={[styles.groupMeta, { color: "#D24B4B" }]}>{groupTodos.error} · Tap to retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TodoRow({
  todo,
  localDate,
  editing,
  index,
  count,
  onPin,
  onMove,
  onToggle,
  onLongPress,
  onAddChild,
  depth,
}: {
  todo: TodoItem;
  localDate: string;
  editing: boolean;
  index: number;
  count: number;
  onPin: () => void;
  onMove: (targetIndex: number) => void;
  onToggle: () => void;
  onLongPress: () => void;
  onAddChild: () => void;
  depth: number;
}) {
  const colors = useAppColors();
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: 54,
    onMove,
  });
  const complete = todoCompletedOnDate(todo, localDate);
  const skipped = todoSkippedOnDate(todo, localDate);
  const deadline = Boolean(
    todo.dueAt && todo.dueAt.slice(0, 10) <= localDate,
  );
  const reminder = todo.reminders.find(
    (item) => item.at?.slice(0, 10) === localDate,
  );
  const repeats = Boolean(
    todo.recurrence ||
      todo.reminders.some((item) => item.repeatDailyUntilDue),
  );
  return (
    <Reanimated.View
      onLayout={(event) =>
        smoothDrag.setStep(event.nativeEvent.layout.height + 6)
      }
      style={[
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 20 : 0,
          elevation: smoothDrag.dragging ? 10 : 0,
        },
      ]}
    >
    <Pressable
      onPress={() =>
        router.navigate({
          pathname: "/todo-editor",
          params: { id: todo.id },
        } as never)
      }
      onLongPress={onLongPress}
      style={[
        styles.row,
        { marginLeft: Math.min(depth, 8) * 10 },
        {
          backgroundColor: colors.card,
          borderColor:
            deadline && !complete && !skipped ? "#D24B4B66" : colors.border,
        },
      ]}
    >
      <Pressable onPress={onToggle} hitSlop={8}>
        <Ionicons
          name={
            skipped
              ? "play-skip-forward-circle"
              : complete
                ? "checkmark-circle"
                : "ellipse-outline"
          }
          size={21}
          color={skipped ? "#E783B5" : complete ? "#B8E45C" : colors.faint}
        />
      </Pressable>
      <View style={styles.copy}>
        <Text
          translate={false}
          numberOfLines={1}
          style={[
            styles.name,
            { color: colors.ink },
            (complete || skipped) && styles.complete,
          ]}
        >
          {todo.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons
            name="flag"
            size={10}
            color={priorityColors[todo.priority]}
          />
          {repeats ? (
            <Ionicons
              name="repeat-outline"
              size={10}
              color={colors.muted}
              accessibilityLabel="Repeating to-do"
            />
          ) : null}
          {skipped ? (
            <Text style={[styles.deadline, { color: "#E783B5" }]}>Skipped</Text>
          ) : deadline ? (
            <Text style={[styles.deadline, { color: "#D24B4B" }]}>
              {todo.dueAt?.slice(0, 10) === localDate
                ? "Deadline"
                : "Overdue"}{" "}
              {todo.dueAt?.slice(11, 16)}
            </Text>
          ) : reminder ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              Reminder {reminder.time ?? reminder.at?.slice(11, 16)}
            </Text>
          ) : (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {todo.recurrence ? "Repeats" : "No deadline"}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.rowActions}>
        {!editing ? (
          <Pressable accessibilityLabel="Add subtask" hitSlop={7} onPress={onAddChild} style={styles.smallAction}>
            <Ionicons name="return-down-forward-outline" size={14} color={colors.faint} />
          </Pressable>
        ) : null}
        {editing ? (
          <Pressable
            accessibilityLabel={todo.pinnedAt ? "Unpin to-do" : "Pin to-do"}
            hitSlop={7}
            onPress={onPin}
            style={styles.smallAction}
          >
            <Ionicons
              name={todo.pinnedAt ? "pin" : "pin-outline"}
              size={14}
              color={todo.pinnedAt ? "#E9A23B" : colors.faint}
            />
          </Pressable>
        ) : todo.pinnedAt ? (
          <Ionicons name="pin" size={12} color="#E9A23B" />
        ) : null}
        {editing ? (
          <GestureDetector gesture={smoothDrag.gesture}>
          <View
            accessibilityLabel="Drag to reorder to-do"
            collapsable={false}
            style={styles.dragHandle}
          >
            <Ionicons
              name="reorder-three-outline"
              size={20}
              color={colors.muted}
            />
          </View>
          </GestureDetector>
        ) : (
          <Ionicons
            name="ellipsis-horizontal"
            size={14}
            color={colors.faint}
          />
        )}
      </View>
    </Pressable>
    </Reanimated.View>
  );
}

function GroupTodoRow({
  todo,
  depth,
  currentUserId,
  memberCount,
  onToggle,
  onAddChild,
}: {
  todo: GroupTodoItem;
  depth: number;
  currentUserId: string;
  memberCount: number;
  onToggle: () => void;
  onAddChild: () => void;
}) {
  const colors = useAppColors();
  const complete =
    todo.completionMode === "shared"
      ? Boolean(todo.completedAt)
      : todo.completedByIds.includes(currentUserId);
  const overdue = Boolean(
    todo.dueAt && todo.dueAt < new Date().toISOString() && !complete,
  );
  return (
    <Pressable
      onPress={() =>
        router.navigate({
          pathname: "/group-todo-editor",
          params: { id: todo.id },
        } as never)
      }
      style={[
        styles.row,
        { marginLeft: Math.min(depth, 8) * 10 },
        {
          backgroundColor: colors.card,
          borderColor: overdue ? "#D24B4B66" : colors.border,
        },
      ]}
    >
      <Pressable onPress={onToggle} hitSlop={8}>
        <Ionicons
          name={complete ? "checkmark-circle" : "ellipse-outline"}
          size={21}
          color={complete ? "#B8E45C" : colors.faint}
        />
      </Pressable>
      <View style={styles.copy}>
        <Text translate={false} numberOfLines={1} style={[styles.name, { color: colors.ink }, complete && styles.complete]}>{todo.title}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="flag" size={10} color={priorityColors[todo.priority]} />
          <Text style={[styles.meta, { color: overdue ? "#D24B4B" : colors.muted }]}>
            {todo.completionMode === "shared"
              ? complete ? "Done for group" : "Shared completion"
              : `${todo.completedByIds.length}/${memberCount} completed`}
            {todo.dueAt ? ` · due ${todo.dueAt.slice(0, 10)}` : ""}
          </Text>
        </View>
      </View>
      <Pressable accessibilityLabel="Add group subtask" hitSlop={7} onPress={onAddChild} style={styles.smallAction}>
        <Ionicons name="return-down-forward-outline" size={14} color={colors.faint} />
      </Pressable>
      <Ionicons name="ellipsis-horizontal" size={14} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 5, marginTop: 9 },
  heading: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  title: { fontSize: 12, fontWeight: "900" },
  titleButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 3 },
  add: { flexDirection: "row", alignItems: "center", gap: 4 },
  addText: { fontSize: 8, fontWeight: "900" },
  labelFilters: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 2 },
  labelChip: { minHeight: 25, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  labelChipText: { fontSize: 7, fontWeight: "900" },
  hidden: { fontSize: 8, fontWeight: "800", paddingVertical: 5 },
  row: {
    minHeight: 49,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 9, fontWeight: "900" },
  complete: { textDecorationLine: "line-through", opacity: 0.58 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  meta: { fontSize: 7, fontWeight: "700" },
  deadline: { fontSize: 7, fontWeight: "900" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  smallAction: {
    width: 26,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandle: {
    width: 30,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyText: { fontSize: 8, fontWeight: "800" },
  groupSection: { gap: 5, marginTop: 8 },
  groupHeading: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  groupTitle: { fontSize: 10, fontWeight: "900" },
  groupMeta: { fontSize: 7, fontWeight: "700", paddingVertical: 5 },
});
