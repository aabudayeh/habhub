import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";

import { AppText as Text } from "@/src/components/AppText";
import { useTodoSubtaskExpansion } from "@/src/components/useTodoSubtaskExpansion";
import { useTodoCardPress } from "@/src/components/useTodoDoubleTap";
import { useTodoItemVisibility } from "@/src/components/useTodoItemVisibility";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import {
  todoAppearsOnDate,
  todoCompletedOnDate,
  todoSkippedOnDate,
} from "@/src/domain/schedule";
import {
  flattenTodoHierarchy,
  formatTodoLabel,
  formatTodoLabelText,
  todoLabels as labelsForTodo,
  todoMatchesViewFilter,
} from "@/src/domain/todos";
import { LocalizedAlert as Alert, useTranslation } from "@/src/i18n";
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
  visibleOverride = true,
  todoIds,
  todoLabels,
}: {
  localDate: string;
  onComplete?: (todoId: string) => void;
  editing?: boolean;
  onRequestEdit?: () => void;
  visibleOverride?: boolean;
  /** Undefined keeps every To-Do; an empty list intentionally shows none. */
  todoIds?: string[];
  /** Normalized labels further narrow the saved Today view. */
  todoLabels?: string[];
}) {
  const {
    state,
    toggleTodo,
    deleteTodo,
    reorderTodo,
    saveTodo,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const subtaskExpansion = useTodoSubtaskExpansion(
    `personal:${state.currentUserId}`,
  );
  const itemVisibility = useTodoItemVisibility(
    `personal:${state.currentUserId}`,
  );
  const visible = state.settings.showTodosToday !== false;
  const [activeLabel, setActiveLabel] = useState<string>();
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const todoCardPress = useTodoCardPress<TodoItem>({
    onOpen: (todo) =>
      router.navigate({
        pathname: "/todo-editor",
        params: { id: todo.id },
      } as never),
    onComplete: (todo) => {
      toggleTodo(todo.id, localDate);
      onComplete?.(todo.id);
    },
  });
  const baseItems = (state.todos ?? [])
    .filter((todo) => todoMatchesViewFilter(todo, { todoIds, todoLabels }))
    .filter((todo) => todoAppearsOnDate(todo, localDate))
    .filter((todo) => editing || itemVisibility.isVisible(todo.id))
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
        baseItems.flatMap((todo) => labelsForTodo(todo)),
      )].sort((a, b) => a.localeCompare(b)),
    [baseItems],
  );
  useEffect(() => {
    if (activeLabel && !allLabels.includes(activeLabel))
      setActiveLabel(undefined);
    if (!allLabels.length) setLabelsExpanded(false);
  }, [activeLabel, allLabels]);
  const items = activeLabel
    ? baseItems.filter((todo) => labelsForTodo(todo).includes(activeLabel))
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
  if (visibleOverride === false || (!visible && !editing)) return null;

  const moveTodoBeside = (todo: TodoItem, targetTodo?: TodoItem) => {
    if (!targetTodo || targetTodo.id === todo.id) return;
    const globalTargetIndex = [...(state.todos ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .findIndex((item) => item.id === targetTodo.id);
    if (globalTargetIndex >= 0) reorderTodo(todo.id, globalTargetIndex);
  };
  const shownById = new Map(shownItems.map((node) => [node.item.id, node]));
  const childNodes = new Map<string, typeof shownItems>();
  const rootNodes = shownItems.filter(({ item }) => {
    if (!item.parentId || !shownById.has(item.parentId)) return true;
    const children = childNodes.get(item.parentId) ?? [];
    children.push(shownById.get(item.id)!);
    childNodes.set(item.parentId, children);
    return false;
  });
  const renderTodoBranch = (
    node: (typeof shownItems)[number],
    depth: number,
  ): React.ReactNode => {
    const todo = node.item;
    const flatIndex = shownItems.findIndex((item) => item.item.id === todo.id);
    const children = childNodes.get(todo.id) ?? [];
    const childrenExpanded = subtaskExpansion.isExpanded(todo.id);
    return (
      <View key={todo.id} style={depth ? styles.subtaskBranch : undefined}>
        <TodoRow
          todo={todo}
          localDate={localDate}
          editing={editing}
          index={flatIndex}
          count={shownItems.length}
          depth={depth}
          childCount={children.length}
          childrenExpanded={childrenExpanded}
          onToggleChildren={() => subtaskExpansion.toggle(todo.id)}
          visible={itemVisibility.isVisible(todo.id)}
          onToggleVisibility={() => itemVisibility.toggle(todo.id)}
          onAddChild={() =>
            router.navigate({
              pathname: "/todo-editor",
              params: { parentId: todo.id },
            } as never)
          }
          onPin={() =>
            saveTodo({
              ...todo,
              pinnedAt: todo.pinnedAt ? undefined : new Date().toISOString(),
            })
          }
          onDelete={() =>
            Alert.alert(
              "Delete to-do?",
              children.length
                ? "Its nested sub-to-dos will also be deleted."
                : "This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteTodo(todo.id),
                },
              ],
            )
          }
          onMove={(targetIndex) => {
            moveTodoBeside(todo, shownItems[targetIndex]?.item);
          }}
          onLongPress={() => {
            todoCardPress.onLongPress(todo, () => {
              if (!editing) onRequestEdit?.();
            });
          }}
          onPressIn={() => todoCardPress.onPressIn(todo)}
          onPress={(alreadyComplete) =>
            todoCardPress.onPress(todo, alreadyComplete, !editing)
          }
          onToggle={() => {
            const completing = !todoCompletedOnDate(todo, localDate);
            toggleTodo(todo.id, localDate);
            if (completing) onComplete?.(todo.id);
          }}
        />
        {children.length && childrenExpanded ? (
          <View style={[styles.subtaskSection, { borderLeftColor: colors.border }] }>
            {children.map((child) => renderTodoBranch(child, depth + 1))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={styles.titleCluster}>
          <Pressable
            accessibilityHint="Opens the To-Do tracker"
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
          </Pressable>
          {visible && allLabels.length ? (
            <Pressable
              accessibilityLabel={
                labelsExpanded ? "Collapse To-Do labels" : "Expand To-Do labels"
              }
              accessibilityState={{ expanded: labelsExpanded }}
              hitSlop={8}
              onPress={() => {
                setLabelsExpanded((expanded) => {
                  if (expanded) setActiveLabel(undefined);
                  return !expanded;
                });
              }}
              style={styles.labelToggle}
            >
              <Ionicons
                name={labelsExpanded ? "chevron-down" : "chevron-forward"}
                size={13}
                color={colors.faint}
              />
            </Pressable>
          ) : null}
        </View>
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
      {visible && labelsExpanded && allLabels.length ? (
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
              <Text
                translate={false}
                style={[
                  styles.labelChipText,
                  { color: activeLabel === label ? accent : colors.muted },
                ]}
              >
                {formatTodoLabel(label)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {visible ? rootNodes.map((node) => renderTodoBranch(node, 0)) : null}
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
  onDelete,
  onMove,
  onPressIn,
  onPress,
  onToggle,
  onLongPress,
  onAddChild,
  childCount,
  childrenExpanded,
  onToggleChildren,
  visible,
  onToggleVisibility,
  depth,
}: {
  todo: TodoItem;
  localDate: string;
  editing: boolean;
  index: number;
  count: number;
  onPin: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
  onPressIn: () => void;
  onPress: (alreadyComplete: boolean) => void;
  onToggle: () => void;
  onLongPress: () => void;
  onAddChild: () => void;
  childCount: number;
  childrenExpanded: boolean;
  onToggleChildren: () => void;
  visible: boolean;
  onToggleVisibility: () => void;
  depth: number;
}) {
  const colors = useAppColors();
  const t = useTranslation();
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
      accessibilityHint="Tap once to edit. Double-tap quickly to complete."
      onPressIn={onPressIn}
      onPress={() => onPress(complete)}
      onLongPress={onLongPress}
      style={[
        styles.row,
        depth > 0 && styles.subtaskRow,
        {
          backgroundColor: colors.card,
          opacity: visible ? 1 : 0.56,
          borderColor:
            deadline && !complete && !skipped ? "#D24B4B66" : colors.border,
        },
      ]}
    >
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        hitSlop={8}
      >
        <Ionicons
          name={
            skipped
              ? "play-skip-forward-circle"
              : complete
                ? "checkmark-circle"
                : "ellipse-outline"
          }
          size={depth > 0 ? 18 : 21}
          color={skipped ? "#E783B5" : complete ? "#B8E45C" : colors.faint}
        />
      </Pressable>
      <View style={styles.copy}>
        <Text
          translate={false}
          numberOfLines={1}
          style={[
            styles.name,
            depth > 0 && styles.subtaskName,
            { color: colors.ink },
            (complete || skipped) && styles.complete,
          ]}
        >
          {formatTodoLabelText(todo.title)}
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
        {editing ? (
          <Pressable
            accessibilityLabel={visible ? "Hide to-do" : "Show to-do"}
            hitSlop={7}
            onPress={(event) => {
              event.stopPropagation();
              onToggleVisibility();
            }}
            style={styles.smallAction}
          >
            <Ionicons
              name={visible ? "eye-outline" : "eye-off-outline"}
              size={14}
              color={visible ? colors.faint : "#E9A23B"}
            />
          </Pressable>
        ) : null}
        {childCount ? (
          <Pressable
            accessibilityLabel={
              childrenExpanded ? "Collapse sub-to-dos" : "Expand sub-to-dos"
            }
            accessibilityState={{ expanded: childrenExpanded }}
            hitSlop={7}
            onPress={(event) => {
              event.stopPropagation();
              onToggleChildren();
            }}
            style={styles.smallAction}
          >
            <Ionicons
              name={childrenExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.faint}
            />
          </Pressable>
        ) : null}
        {!editing ? (
          <Pressable
            accessibilityLabel="Add subtask"
            hitSlop={7}
            onPress={(event) => {
              event.stopPropagation();
              onAddChild();
            }}
            style={styles.smallAction}
          >
            <Ionicons name="return-down-forward-outline" size={14} color={colors.faint} />
          </Pressable>
        ) : null}
        {editing ? (
          <Pressable
            accessibilityLabel={todo.pinnedAt ? "Unpin to-do" : "Pin to-do"}
            hitSlop={7}
            onPress={(event) => {
              event.stopPropagation();
              onPin();
            }}
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
          <Pressable
            accessibilityLabel={t("Delete")}
            hitSlop={7}
            onPress={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            style={styles.smallAction}
          >
            <Ionicons name="trash-outline" size={14} color="#C44949" />
          </Pressable>
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
  titleCluster: { flex: 1, flexDirection: "row", alignItems: "center", gap: 1 },
  titleButton: { flexDirection: "row", alignItems: "center" },
  labelToggle: {
    minWidth: 22,
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
  },
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
  subtaskRow: {
    minHeight: 38,
    borderRadius: 11,
    paddingHorizontal: 8,
    gap: 6,
  },
  subtaskBranch: { marginTop: 4 },
  subtaskSection: {
    marginLeft: 16,
    paddingLeft: 8,
    borderLeftWidth: 1,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 9, fontWeight: "900" },
  subtaskName: { fontSize: 8, lineHeight: 11 },
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
