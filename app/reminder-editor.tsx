import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TimeInput } from "@/src/components/TimeInput";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import {
  isInternalTracker,
  trackerGroupLabel,
} from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { CalendarReminder, GoalSchedule } from "@/src/types";

const FREQUENCIES: {
  id: GoalSchedule["mode"];
  label: string;
  sublabel: string;
}[] = [
  { id: "once", label: "Once", sublabel: "Only on the selected date" },
  { id: "daily", label: "Every day", sublabel: "Repeats daily" },
  {
    id: "selected_days",
    label: "Selected weekdays",
    sublabel: "Choose one or several weekdays",
  },
  {
    id: "every_other_day",
    label: "Every other day",
    sublabel: "Repeats from the selected date",
  },
  {
    id: "interval_days",
    label: "Custom interval",
    sublabel: "Repeat every chosen number of days",
  },
  {
    id: "days_of_month",
    label: "Dates each month",
    sublabel: "For example, the 1st and 15th",
  },
];

export default function ReminderEditor() {
  const { id, date, time: routeTime } = useLocalSearchParams<{
    id?: string;
    date?: string;
    time?: string;
  }>();
  const {
    state,
    saveCalendarReminder,
    deleteCalendarReminder,
    updateMetric,
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
  const [time, setTime] = useState(existing?.time ?? routeTime ?? "19:00");
  const [scheduledDate, setScheduledDate] = useState(
    existing?.schedule.anchorDate ?? date ?? dateKey(),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mode, setMode] = useState<GoalSchedule["mode"]>(
    existing?.schedule.mode ?? "once",
  );
  const [days, setDays] = useState(
    existing?.schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
  );
  const [interval, setInterval] = useState(
    String(existing?.schedule.intervalDays ?? 7),
  );
  const [monthDays, setMonthDays] = useState(
    (existing?.schedule.daysOfMonth ?? [1]).join(", "),
  );

  const save = () => {
    const selectedTracker = trackers.find((metric) => metric.id === metricId);
    const selectedTodo = todos.find((todo) => todo.id === todoId);
    if (kind === "tracker" && !selectedTracker)
      return Alert.alert("Choose a tracker");
    if (kind === "todo" && !selectedTodo)
      return Alert.alert("Choose a to-do");
    const resolvedTitle =
      title.trim() ||
      (kind === "tracker" && selectedTracker
        ? selectedTracker.name
        : kind === "todo" && selectedTodo
          ? selectedTodo.title
          : "Reminder");
    const schedule: GoalSchedule = {
      mode,
      daysOfWeek: mode === "selected_days" ? days : undefined,
      intervalDays:
        mode === "interval_days"
          ? Math.max(1, Math.round(Number(interval) || 1))
          : undefined,
      daysOfMonth:
        mode === "days_of_month"
          ? [
              ...new Set(
                monthDays
                  .split(",")
                  .map((item) => Number(item.trim()))
                  .filter(
                    (item) =>
                      Number.isInteger(item) && item >= 1 && item <= 31,
                  ),
              ),
            ].sort((a, b) => a - b)
          : undefined,
      anchorDate: scheduledDate,
    };
    if (kind === "tracker" && selectedTracker) {
      const reminder = { enabled: true, time, schedule };
      const previous = selectedTracker.reminders ?? [];
      const reminders = [
        ...previous.filter(
          (item) =>
            !(
              item.time === reminder.time &&
              JSON.stringify(item.schedule ?? {}) === JSON.stringify(schedule)
            ),
        ),
        reminder,
      ];
      updateMetric(selectedTracker.id, {
        reminder,
        reminders,
      });
      if (existing) deleteCalendarReminder(existing.id);
      router.back();
      return;
    }
    saveCalendarReminder({
      id: existing?.id ?? `calendar-${Date.now().toString(36)}`,
      title: resolvedTitle,
      kind,
      metricId: kind === "tracker" ? metricId : undefined,
      todoId: kind === "todo" ? todoId : undefined,
      time,
      enabled: true,
      schedule,
    });
    router.back();
  };

  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit reminder" : "New reminder"}
        subtitle="Choose what, when, and how often."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.card}>
        <SelectionMenu
          title="Reminder for"
          items={[
            {
              id: "tracker",
              label: "A tracker",
              icon: "analytics-outline",
              sublabel: "A goal or tracked activity",
            },
            {
              id: "todo",
              label: "An existing to-do",
              icon: "checkbox-outline",
              sublabel: "Choose from your to-do list",
            },
            {
              id: "general",
              label: "Something else",
              icon: "notifications-outline",
              sublabel: "A standalone reminder",
            },
          ]}
          selectedIds={[kind]}
          onChange={(ids) =>
            ids[0] && setKind(ids[0] as CalendarReminder["kind"])
          }
          multiple={false}
        />
        {kind === "tracker" ? (
          <SelectionMenu
            title="Choose tracker"
            items={trackers.map((metric) => ({
              id: metric.id,
              label: metric.name,
              icon: metric.icon as keyof typeof Ionicons.glyphMap,
              color: metric.color,
              group: trackerGroupLabel(metric),
            }))}
            selectedIds={metricId ? [metricId] : []}
            onChange={(ids) => ids[0] && setMetricId(ids[0])}
            multiple={false}
          />
        ) : null}
        {kind === "todo" ? (
          <SelectionMenu
            title="Choose to-do"
            items={todos.map((todo) => ({
              id: todo.id,
              label: todo.title,
              icon: "checkbox-outline",
              sublabel: todo.dueAt
                ? `Due ${todo.dueAt.slice(0, 10)}`
                : "No deadline",
            }))}
            selectedIds={todoId ? [todoId] : []}
            onChange={(ids) => ids[0] && setTodoId(ids[0])}
            multiple={false}
            emptyLabel="No to-dos available"
          />
        ) : null}
        <View>
          <Text style={[styles.label, { color: colors.ink }]}>
            Message (optional)
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Use the selected item's name"
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <Pressable
          onPress={() => setCalendarOpen((open) => !open)}
          style={[styles.dateButton, { borderColor: colors.border }]}
        >
          <Ionicons name="calendar-outline" size={17} color={accent} />
          <View style={styles.grow}>
            <Text style={[styles.label, { color: colors.muted }]}>Date</Text>
            <Text style={[styles.dateText, { color: colors.ink }]}>
              {scheduledDate}
            </Text>
          </View>
          <Ionicons
            name={calendarOpen ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.muted}
          />
        </Pressable>
        {calendarOpen ? (
          <MonthCalendar
            monthDate={scheduledDate}
            selectedDate={scheduledDate}
            onMonthChange={setScheduledDate}
            onSelect={(next) => {
              setScheduledDate(next);
              setCalendarOpen(false);
            }}
          />
        ) : null}
        <TimeInput value={time} onChange={setTime} label="Time" />
        <SelectionMenu
          title="Frequency"
          items={FREQUENCIES.map((item) => ({
            ...item,
            icon: "repeat-outline" as const,
          }))}
          selectedIds={[mode]}
          onChange={(ids) =>
            ids[0] && setMode(ids[0] as GoalSchedule["mode"])
          }
          multiple={false}
        />
        {mode === "selected_days" ? (
          <SelectionMenu
            title="Weekdays"
            items={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (label, day) => ({
                id: String(day),
                label,
                icon: "calendar-outline" as const,
              }),
            )}
            selectedIds={days.map(String)}
            onChange={(ids) => setDays(ids.map(Number))}
          />
        ) : null}
        {mode === "interval_days" ? (
          <View>
            <Text style={[styles.label, { color: colors.ink }]}>
              Repeat every
            </Text>
            <View style={styles.inline}>
              <TextInput
                value={interval}
                onChangeText={setInterval}
                keyboardType="number-pad"
                placeholder="7"
                placeholderTextColor={colors.faint}
                style={[
                  styles.shortInput,
                  { color: colors.ink, borderColor: colors.border },
                ]}
              />
              <Text style={[styles.suffix, { color: colors.muted }]}>days</Text>
            </View>
          </View>
        ) : null}
        {mode === "days_of_month" ? (
          <View>
            <Text style={[styles.label, { color: colors.ink }]}>
              Dates each month
            </Text>
            <TextInput
              value={monthDays}
              onChangeText={setMonthDays}
              keyboardType="numbers-and-punctuation"
              placeholder="1, 15"
              placeholderTextColor={colors.faint}
              style={[
                styles.input,
                { color: colors.ink, borderColor: colors.border },
              ]}
            />
          </View>
        ) : null}
      </Card>
      <Pressable
        onPress={save}
        style={[styles.save, { backgroundColor: accent }]}
      >
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
  grow: { flex: 1 },
  label: { fontSize: 9, fontWeight: "900", marginBottom: 5 },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    fontSize: 10,
    fontWeight: "800",
  },
  dateButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateText: { fontSize: 10, fontWeight: "900" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  shortInput: {
    width: 76,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
  },
  suffix: { fontSize: 9, fontWeight: "800" },
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
