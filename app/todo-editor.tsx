import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GoalSchedule, TodoPriority } from "@/src/types";

type RepeatMode = "none" | GoalSchedule["mode"];
type ReminderDraft = {
  id: string;
  date: string;
  time: string;
  daysBeforeDue?: number;
};

export default function TodoEditor() {
  const { id, date, time } = useLocalSearchParams<{
    id?: string;
    date?: string;
    time?: string;
  }>();
  const { state, saveTodo, deleteTodo } = useApp();
  const navigation = useNavigation();
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
    existing?.dueAt?.slice(0, 10) ?? date ?? dateKey(),
  );
  const [dueTime, setDueTime] = useState(
    existing?.dueAt?.slice(11, 16) ?? time ?? "18:00",
  );
  const [hasDeadline, setHasDeadline] = useState(
    Boolean(existing?.dueAt || date || time),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>(
    existing?.recurrence?.mode ?? "none",
  );
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [days, setDays] = useState<number[]>(
    existing?.recurrence?.daysOfWeek ?? [1, 2, 3, 4, 5],
  );
  const [interval, setInterval] = useState(
    String(existing?.recurrence?.intervalDays ?? 7),
  );
  const [monthDays, setMonthDays] = useState(
    (existing?.recurrence?.daysOfMonth ?? [1]).join(", "),
  );
  const [reminders, setReminders] = useState<ReminderDraft[]>(
    existing?.reminders.map((reminder, index) => ({
      id: reminder.id ?? `reminder-${index}`,
      date:
        reminder.at?.slice(0, 10) ??
        (reminder.daysBeforeDue !== undefined && existing.dueAt
          ? dateWithOffsetFrom(
              existing.dueAt.slice(0, 10),
              -reminder.daysBeforeDue,
            )
          : existing.dueAt?.slice(0, 10) ?? dateKey()),
      time:
        reminder.time ??
        reminder.at?.slice(11, 16) ??
        existing.dueAt?.slice(11, 16) ??
        "09:00",
      daysBeforeDue: reminder.daysBeforeDue,
    })) ?? [],
  );
  const [reminderCalendarIndex, setReminderCalendarIndex] = useState<
    number | null
  >(null);
  const signature = useMemo(
    () =>
      JSON.stringify({
        title,
        description,
        priority,
        dueDate,
        dueTime,
        hasDeadline,
        repeat,
        days,
        interval,
        monthDays,
        reminders,
      }),
    [
      days,
      description,
      dueDate,
      dueTime,
      hasDeadline,
      interval,
      monthDays,
      priority,
      reminders,
      repeat,
      title,
    ],
  );
  const initialSignature = useRef(signature);
  const allowExit = useRef(false);
  const dirty = signature !== initialSignature.current;
  const addReminder = (daysBeforeDue?: number) => {
    const date =
      daysBeforeDue !== undefined
        ? dateWithOffsetFrom(dueDate, -daysBeforeDue)
        : dueDate;
    if (
      reminders.some(
        (item) => item.date === date && item.daysBeforeDue === daysBeforeDue,
      )
    )
      return;
    setReminders((current) => [
      ...current,
      {
        id: `reminder-${Date.now().toString(36)}`,
        date,
        time: daysBeforeDue === 0 ? dueTime : "09:00",
        daysBeforeDue,
      },
    ]);
  };
  const addWeeklyBeforeDeadline = () => {
    const created = existing?.createdAt.slice(0, 10) ?? dateKey();
    const additions: ReminderDraft[] = [];
    for (let offset = 7; offset <= 365; offset += 7) {
      const date = dateWithOffsetFrom(dueDate, -offset);
      if (date < created) break;
      additions.push({
        id: `reminder-weekly-${Date.now()}-${offset}`,
        date,
        time: "09:00",
        daysBeforeDue: offset,
      });
    }
    setReminders((current) => [
      ...current,
      ...additions.filter(
        (next) => !current.some((item) => item.date === next.date),
      ),
    ]);
  };
  const save = (exit: () => void = () => router.back()) => {
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
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        at: `${reminder.date}T${reminder.time}:00`,
        time: reminder.time,
        daysBeforeDue: reminder.daysBeforeDue,
      })),
      completedDates: existing?.completedDates ?? [],
      skippedDates: existing?.skippedDates ?? [],
      completedAt: existing?.completedAt,
      order: existing?.order,
    });
    allowExit.current = true;
    exit();
  };
  const requestClose = (exit: () => void = () => router.back()) => {
    if (!dirty) {
      allowExit.current = true;
      exit();
      return;
    }
    Alert.alert("Save your changes?", "This to-do has unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          allowExit.current = true;
          exit();
        },
      },
      { text: "Save", onPress: () => save(exit) },
    ]);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (allowExit.current || !dirty) return;
        event.preventDefault();
        requestCloseRef.current(() => navigation.dispatch(event.data.action));
      }),
    [dirty, navigation],
  );
  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit to-do" : "New to-do"}
        subtitle="A task, not a tracker."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => requestClose()} />}
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
        <Pressable
          onPress={() => setRepeatOpen((open) => !open)}
          style={styles.collapseHeading}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Repeat</Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              {repeat === "none" ? "Once" : repeat.replaceAll("_", " ")}
            </Text>
          </View>
          <Ionicons
            name={repeatOpen ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.muted}
          />
        </Pressable>
        {repeatOpen ? <>
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
        </> : null}
      </Card>
      <Card style={styles.form}>
        <Pressable
          onPress={() => setRemindersOpen((open) => !open)}
          style={styles.switchLine}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Reminders</Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              {reminders.length
                ? `${reminders.length} scheduled`
                : "Optional dates and times"}
            </Text>
          </View>
          <Ionicons
            name={remindersOpen ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.muted}
          />
        </Pressable>
        {remindersOpen ? <>
        {hasDeadline ? (
          <View style={styles.wrap}>
            {[0, 1, 3, 7].map((offset) => (
              <Chip
                key={offset}
                label={
                  offset === 0
                    ? "At deadline"
                    : offset === 1
                      ? "1 day before"
                      : `${offset} days before`
                }
                selected={reminders.some(
                  (item) => item.daysBeforeDue === offset,
                )}
                onPress={() => addReminder(offset)}
              />
            ))}
            <Chip
              label="Weekly before"
              selected={false}
              onPress={addWeeklyBeforeDeadline}
            />
          </View>
        ) : null}
        {reminders.map((reminder, index) => (
          <View key={reminder.id} style={styles.reminderBlock}>
            <View style={styles.reminder}>
            <Pressable
              onPress={() =>
                setReminderCalendarIndex(
                  reminderCalendarIndex === index ? null : index,
                )
              }
              style={[
                styles.reminderDate,
                { borderColor: colors.border },
              ]}
            >
              <Ionicons name="calendar-outline" size={15} color={accent} />
              <Text style={[styles.reminderDateText, { color: colors.ink }]}>
                {reminder.date}
              </Text>
            </Pressable>
            <TextInput
              value={reminder.time}
              onChangeText={(value) =>
                setReminders((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, time: value } : item,
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
            {reminderCalendarIndex === index ? (
              <MonthCalendar
                monthDate={reminder.date}
                selectedDate={reminder.date}
                onSelect={(date) => {
                  setReminders((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, date, daysBeforeDue: undefined }
                        : item,
                    ),
                  );
                  setReminderCalendarIndex(null);
                }}
              />
            ) : null}
          </View>
        ))}
        <Pressable
          onPress={() => addReminder()}
          style={[styles.addReminder, { borderColor: accent }]}
        >
          <Ionicons name="add" size={16} color={accent} />
          <Text style={[styles.addReminderText, { color: accent }]}>
            Add custom reminder
          </Text>
        </Pressable>
        </> : null}
      </Card>
      <Pressable onPress={() => save()} style={[styles.save, { backgroundColor: accent }]}>
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
                  allowExit.current = true;
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
  collapseHeading: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
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
  reminderBlock: { gap: 6 },
  reminderDate: {
    flex: 1.35,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reminderDateText: { flex: 1, fontSize: 9, fontWeight: "800" },
  reminderInput: { flex: 1 },
  addReminder: {
    minHeight: 38,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  addReminderText: { fontSize: 9, fontWeight: "900" },
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
