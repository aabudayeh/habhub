import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { CalendarReminder, GoalSchedule } from "@/src/types";

export default function ReminderEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const {
    state,
    saveCalendarReminder,
    deleteCalendarReminder,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const existing = (state.calendarReminders ?? []).find(
    (reminder) => reminder.id === id,
  );
  const trackers = state.metrics.filter((metric) => !isInternalTracker(metric));
  const todos = state.todos ?? [];
  const [kind, setKind] = useState<CalendarReminder["kind"]>(
    existing?.kind ?? "tracker",
  );
  const [metricId, setMetricId] = useState(
    existing?.metricId ?? trackers[0]?.id ?? "",
  );
  const [todoId, setTodoId] = useState(
    existing?.todoId ?? todos[0]?.id ?? "",
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [time, setTime] = useState(existing?.time ?? "19:00");
  const [mode, setMode] = useState<GoalSchedule["mode"]>(
    existing?.schedule.mode ?? "daily",
  );
  const [days, setDays] = useState(
    existing?.schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
  );
  const [interval, setInterval] = useState(
    String(existing?.schedule.intervalDays ?? 7),
  );
  const save = () => {
    const selectedTracker = trackers.find((metric) => metric.id === metricId);
    const selectedTodo = todos.find((todo) => todo.id === todoId);
    const resolvedTitle =
      title.trim() ||
      (kind === "tracker" && selectedTracker
        ? `Work on ${selectedTracker.name}`
        : kind === "todo" && selectedTodo
          ? selectedTodo.title
          : "Reminder");
    saveCalendarReminder({
      id: existing?.id ?? `calendar-${Date.now().toString(36)}`,
      title: resolvedTitle,
      kind,
      metricId: kind === "tracker" ? metricId : undefined,
      todoId: kind === "todo" ? todoId : undefined,
      time,
      enabled: true,
      schedule: {
        mode,
        daysOfWeek: mode === "selected_days" ? days : undefined,
        intervalDays:
          mode === "interval_days"
            ? Math.max(1, Math.round(Number(interval) || 1))
            : undefined,
        anchorDate: dateKey(),
      },
    });
    router.back();
  };
  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit reminder" : "New reminder"}
        subtitle="Schedule a tracker, to-do, or general prompt."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      <Card style={styles.card}>
        <View style={styles.wrap}>
          {(
            [
              ["tracker", "Tracker"],
              ["todo", "To-do"],
              ["general", "General"],
            ] as const
          ).map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={kind === value}
              onPress={() => setKind(value)}
            />
          ))}
        </View>
        {kind === "tracker" ? (
          <View style={styles.choices}>
            {trackers.map((metric) => (
              <Chip
                key={metric.id}
                label={metric.name}
                selected={metricId === metric.id}
                onPress={() => setMetricId(metric.id)}
              />
            ))}
          </View>
        ) : null}
        {kind === "todo" ? (
          <View style={styles.choices}>
            {todos.map((todo) => (
              <Chip
                key={todo.id}
                label={todo.title}
                selected={todoId === todo.id}
                onPress={() => setTodoId(todo.id)}
              />
            ))}
          </View>
        ) : null}
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Custom message (optional)"
          placeholderTextColor={colors.faint}
          style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
        />
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="19:00"
          placeholderTextColor={colors.faint}
          style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
        />
      </Card>
      <Card style={styles.card}>
        <Text style={[styles.label, { color: colors.ink }]}>How often?</Text>
        <View style={styles.wrap}>
          {(
            [
              ["daily", "Daily"],
              ["selected_days", "Chosen days"],
              ["every_other_day", "Every other day"],
              ["interval_days", "Every N days"],
            ] as const
          ).map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={mode === value}
              onPress={() => setMode(value)}
            />
          ))}
        </View>
        {mode === "selected_days" ? (
          <View style={styles.wrap}>
            {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => (
              <Chip
                key={`${label}-${day}`}
                label={label}
                selected={days.includes(day)}
                onPress={() =>
                  setDays((current) =>
                    current.includes(day)
                      ? current.filter((item) => item !== day)
                      : [...current, day],
                  )
                }
              />
            ))}
          </View>
        ) : null}
        {mode === "interval_days" ? (
          <TextInput
            value={interval}
            onChangeText={setInterval}
            keyboardType="number-pad"
            placeholder="Every N days"
            placeholderTextColor={colors.faint}
            style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
          />
        ) : null}
      </Card>
      <Pressable onPress={save} style={[styles.save, { backgroundColor: accent }]}>
        <Text style={styles.saveText}>Save reminder</Text>
      </Pressable>
      {existing ? (
        <Pressable
          onPress={() =>
            Alert.alert("Delete reminder?", undefined, [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  deleteCalendarReminder(existing.id);
                  router.back();
                },
              },
            ])
          }
          style={styles.delete}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, marginBottom: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choices: { maxHeight: 145, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  label: { fontSize: 10, fontWeight: "900" },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    fontSize: 10,
    fontWeight: "800",
  },
  save: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  delete: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#C44949", fontSize: 9, fontWeight: "900" },
});
