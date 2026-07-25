import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GoalSchedule, TodoPriority } from "@/src/types";

type RepeatMode = "none" | GoalSchedule["mode"];

export default function TodoEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, saveTodo, deleteTodo } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const existing = (state.todos ?? []).find((todo) => todo.id === id);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(
    existing?.description ?? "",
  );
  const [priority, setPriority] = useState<TodoPriority>(
    existing?.priority ?? "normal",
  );
  const [dueDate, setDueDate] = useState(
    existing?.dueAt?.slice(0, 10) ?? dateKey(),
  );
  const [dueTime, setDueTime] = useState(
    existing?.dueAt?.slice(11, 16) ?? "18:00",
  );
  const [hasDeadline, setHasDeadline] = useState(Boolean(existing?.dueAt));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>(
    existing?.recurrence?.mode ?? "none",
  );
  const [days, setDays] = useState<number[]>(
    existing?.recurrence?.daysOfWeek ?? [1, 2, 3, 4, 5],
  );
  const [interval, setInterval] = useState(
    String(existing?.recurrence?.intervalDays ?? 7),
  );
  const [monthDays, setMonthDays] = useState(
    (existing?.recurrence?.daysOfMonth ?? [1]).join(", "),
  );
  const [reminders, setReminders] = useState<string[]>(
    existing?.reminders.map((reminder) => reminder.time ?? "09:00") ?? [],
  );
  const save = () => {
    if (!title.trim())
      return Alert.alert("Add a title", "What needs to be done?");
    const now = new Date().toISOString();
    const recurrence: GoalSchedule | undefined =
      repeat === "none"
        ? undefined
        : {
            mode: repeat,
            daysOfWeek: repeat === "selected_days" ? days : undefined,
            intervalDays:
              repeat === "interval_days"
                ? Math.max(1, Math.round(Number(interval) || 1))
                : undefined,
            daysOfMonth:
              repeat === "days_of_month"
                ? [...new Set(
                    monthDays
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter(
                        (day) =>
                          Number.isInteger(day) && day >= 1 && day <= 31,
                      ),
                  )].sort((a, b) => a - b)
                : undefined,
            anchorDate:
              repeat === "every_other_day" || repeat === "interval_days"
                ? dueDate
                : undefined,
          };
    saveTodo({
      id: existing?.id ?? `todo-${Date.now().toString(36)}`,
      title: title.trim(),
      description: description.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      dueAt: hasDeadline ? `${dueDate}T${dueTime}:00` : undefined,
      priority,
      recurrence,
      reminders: reminders.map((time, index) => ({
        id: existing?.reminders[index]?.id ?? `reminder-${Date.now()}-${index}`,
        time,
      })),
      completedDates: existing?.completedDates ?? [],
      completedAt: existing?.completedAt,
    });
    router.back();
  };
  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit to-do" : "New to-do"}
        subtitle="A task, not a tracker."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      <Card style={styles.form}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={colors.faint}
          style={[
            styles.titleInput,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description or note (optional)"
          placeholderTextColor={colors.faint}
          multiline
          style={[
            styles.noteInput,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <Text style={[styles.label, { color: colors.ink }]}>Priority</Text>
        <View style={styles.wrap}>
          {(
            [
              ["low", "Low"],
              ["normal", "Normal"],
              ["high", "High"],
              ["urgent", "Urgent"],
            ] as const
          ).map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={priority === value}
              onPress={() => setPriority(value)}
            />
          ))}
        </View>
      </Card>
      <Card style={styles.form}>
        <Pressable
          onPress={() => setHasDeadline((value) => !value)}
          style={styles.switchLine}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Deadline</Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              Without one, it stays on Today until complete.
            </Text>
          </View>
          <Ionicons
            name={hasDeadline ? "checkbox" : "square-outline"}
            size={21}
            color={hasDeadline ? accent : colors.faint}
          />
        </Pressable>
        {hasDeadline ? (
          <>
            <Pressable
              onPress={() => setCalendarOpen((open) => !open)}
              style={[styles.dateButton, { borderColor: colors.border }]}
            >
              <Ionicons name="calendar-outline" size={17} color={accent} />
              <Text style={[styles.dateText, { color: colors.ink }]}>
                {dueDate}
              </Text>
              <Ionicons
                name={calendarOpen ? "chevron-up" : "chevron-down"}
                size={15}
                color={colors.muted}
              />
            </Pressable>
            {calendarOpen ? (
              <MonthCalendar
                monthDate={dueDate}
                selectedDate={dueDate}
                onSelect={(date) => {
                  setDueDate(date);
                  setCalendarOpen(false);
                }}
              />
            ) : null}
            <TextInput
              value={dueTime}
              onChangeText={setDueTime}
              placeholder="18:00"
              placeholderTextColor={colors.faint}
              style={[
                styles.timeInput,
                { color: colors.ink, borderColor: colors.border },
              ]}
            />
          </>
        ) : null}
      </Card>
      <Card style={styles.form}>
        <Text style={[styles.label, { color: colors.ink }]}>Repeat</Text>
        <View style={styles.wrap}>
          {(
            [
              ["none", "Once"],
              ["daily", "Daily"],
              ["selected_days", "Chosen days"],
              ["every_other_day", "Every other day"],
              ["interval_days", "Every N days"],
              ["days_of_month", "Dates monthly"],
            ] as const
          ).map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={repeat === value}
              onPress={() => setRepeat(value)}
            />
          ))}
        </View>
        {repeat === "selected_days" ? (
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
        {repeat === "interval_days" ? (
          <TextInput
            value={interval}
            onChangeText={setInterval}
            keyboardType="number-pad"
            placeholder="Every N days"
            placeholderTextColor={colors.faint}
            style={[
              styles.timeInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        ) : null}
        {repeat === "days_of_month" ? (
          <TextInput
            value={monthDays}
            onChangeText={setMonthDays}
            placeholder="For example 10, 14"
            placeholderTextColor={colors.faint}
            style={[
              styles.timeInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        ) : null}
      </Card>
      <Card style={styles.form}>
        <View style={styles.switchLine}>
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Reminders</Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              Add as many local reminder times as needed.
            </Text>
          </View>
          <Pressable
            onPress={() =>
              setReminders((current) => [...current, "09:00"])
            }
          >
            <Ionicons name="add-circle" size={23} color={accent} />
          </Pressable>
        </View>
        {reminders.map((time, index) => (
          <View key={index} style={styles.reminder}>
            <TextInput
              value={time}
              onChangeText={(value) =>
                setReminders((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? value : item,
                  ),
                )
              }
              placeholder="09:00"
              placeholderTextColor={colors.faint}
              style={[
                styles.timeInput,
                styles.reminderInput,
                { color: colors.ink, borderColor: colors.border },
              ]}
            />
            <IconButton
              icon="trash-outline"
              label="Remove"
              onPress={() =>
                setReminders((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            />
          </View>
        ))}
      </Card>
      <Pressable onPress={save} style={[styles.save, { backgroundColor: accent }]}>
        <Text style={styles.saveText}>Save to-do</Text>
      </Pressable>
      {existing ? (
        <Pressable
          onPress={() =>
            Alert.alert("Delete to-do?", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  deleteTodo(existing.id);
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
  form: { gap: 9, marginBottom: 8 },
  titleInput: {
    minHeight: 45,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 12,
    fontWeight: "900",
  },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    fontSize: 10,
    textAlignVertical: "top",
  },
  label: { fontSize: 10, fontWeight: "900" },
  help: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  switchLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  copy: { flex: 1 },
  dateButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateText: { flex: 1, fontSize: 10, fontWeight: "800" },
  timeInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 10,
    fontWeight: "800",
  },
  reminder: { flexDirection: "row", alignItems: "center", gap: 7 },
  reminderInput: { flex: 1 },
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
