import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  todoAppearsOnDate,
  todoCompletedOnDate,
  todoSkippedOnDate,
} from "@/src/domain/schedule";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { TodoItem } from "@/src/types";

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
}: {
  localDate: string;
  onComplete?: (todoId: string) => void;
  editing?: boolean;
  onRequestEdit?: () => void;
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
  const items = (state.todos ?? [])
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
  const shownItems =
    !editing && state.settings.completedTodayBehavior === "hide"
      ? items.filter(
          (todo) =>
            !todoCompletedOnDate(todo, localDate) &&
            !todoSkippedOnDate(todo, localDate),
        )
      : items;
  if (!visible && !editing) return null;

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
      {visible
        ? shownItems.map((todo, index) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              localDate={localDate}
              editing={editing}
              index={index}
              count={shownItems.length}
              onPin={() =>
                saveTodo({
                  ...todo,
                  pinnedAt: todo.pinnedAt
                    ? undefined
                    : new Date().toISOString(),
                })
              }
              onMove={(targetIndex) => {
                moveTodoBeside(todo, shownItems[targetIndex]);
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
      {visible && !items.length ? (
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          style={[styles.empty, { borderColor: colors.border }]}
        >
          <Ionicons name="checkmark-circle-outline" size={16} color={accent} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            Nothing due. Add a quick to-do
          </Text>
        </Pressable>
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
}) {
  const colors = useAppColors();
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const targetRef = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        onPanResponderGrant: () => {
          targetRef.current = indexRef.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(gesture.dy);
          targetRef.current = Math.max(
            0,
            Math.min(
              countRef.current - 1,
              indexRef.current + Math.round(gesture.dy / 54),
            ),
          );
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderRelease: () => {
          const target = targetRef.current;
          setDragging(false);
          dragY.setValue(0);
          if (target !== indexRef.current) onMoveRef.current(target);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          dragY.setValue(0);
        },
      }),
    [dragY, editing],
  );
  const complete = todoCompletedOnDate(todo, localDate);
  const skipped = todoSkippedOnDate(todo, localDate);
  const deadline = Boolean(
    todo.dueAt && todo.dueAt.slice(0, 10) <= localDate,
  );
  const reminder = todo.reminders.find(
    (item) => item.at?.slice(0, 10) === localDate,
  );
  return (
    <Animated.View
      style={{
        zIndex: dragging ? 20 : 0,
        elevation: dragging ? 10 : 0,
        transform: [
          { translateY: dragY },
          { scale: dragging ? 1.015 : 1 },
        ],
      }}
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
          <View
            accessibilityLabel="Drag to reorder to-do"
            collapsable={false}
            style={styles.dragHandle}
            {...responder.panHandlers}
          >
            <Ionicons
              name="reorder-three-outline"
              size={20}
              color={colors.muted}
            />
          </View>
        ) : (
          <Ionicons
            name="ellipsis-horizontal"
            size={14}
            color={colors.faint}
          />
        )}
      </View>
    </Pressable>
    </Animated.View>
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
});
