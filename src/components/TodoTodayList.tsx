import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { todoAppearsOnDate } from "@/src/domain/schedule";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { TodoItem } from "@/src/types";

const priorityColors = {
  low: "#6C8AA6",
  normal: "#8A8F98",
  high: "#F59E0B",
  urgent: "#D24B4B",
};

export function TodoTodayList({ localDate }: { localDate: string }) {
  const { state, toggleTodo } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const items = (state.todos ?? [])
    .filter((todo) => todoAppearsOnDate(todo, localDate))
    .sort(
      (a, b) =>
        Number(a.completedDates.includes(localDate)) -
          Number(b.completedDates.includes(localDate)) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
    );
  if (!state.settings.showTodosToday) return null;
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.ink }]}>To-dos</Text>
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          style={styles.add}
        >
          <Ionicons name="add-circle-outline" size={16} color={accent} />
          <Text style={[styles.addText, { color: accent }]}>Add</Text>
        </Pressable>
      </View>
      {items.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          localDate={localDate}
          onToggle={() => toggleTodo(todo.id, localDate)}
        />
      ))}
      {!items.length ? (
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
  onToggle,
}: {
  todo: TodoItem;
  localDate: string;
  onToggle: () => void;
}) {
  const colors = useAppColors();
  const complete = todo.completedDates.includes(localDate);
  const deadline = todo.dueAt?.slice(0, 10) === localDate;
  return (
    <Pressable
      onPress={() =>
        router.navigate({
          pathname: "/todo-editor",
          params: { id: todo.id },
        } as never)
      }
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: deadline && !complete ? "#D24B4B66" : colors.border,
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
        <Text
          numberOfLines={1}
          style={[
            styles.name,
            { color: colors.ink },
            complete && styles.complete,
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
          {deadline ? (
            <Text style={[styles.deadline, { color: "#D24B4B" }]}>
              Deadline {todo.dueAt?.slice(11, 16)}
            </Text>
          ) : todo.reminders.length ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              Reminder {todo.reminders[0].time}
            </Text>
          ) : (
            <Text style={[styles.meta, { color: colors.muted }]}>
              {todo.recurrence ? "Repeats" : "No deadline"}
            </Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.faint} />
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
  },
  title: { fontSize: 12, fontWeight: "900" },
  add: { flexDirection: "row", alignItems: "center", gap: 4 },
  addText: { fontSize: 8, fontWeight: "900" },
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
