import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TimeInput } from "@/src/components/TimeInput";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  useWebBackNavigationGuard,
  useWebBeforeUnload,
} from "@/src/components/useWebBeforeUnload";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { TodoSubtaskEditorSection } from "@/src/components/TodoSubtaskEditorSection";
import { useTodoLabelDoubleTap } from "@/src/components/useTodoDoubleTap";
import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  descendantTodoIds,
  removeTodoLabelFromText,
  todoLabels,
} from "@/src/domain/todos";
import { useApp } from "@/src/state/AppProvider";
import {
  clearTodoEditorDraftTree,
  getTodoEditorDraftNodes,
  newTodoEditorDraftId,
  orderTodoEditorDraftNodes,
  removeTodoEditorDraftSubtree,
  upsertTodoEditorDraft,
  useTodoEditorDraftTree,
} from "@/src/state/todoEditorDrafts";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GoalSchedule, TodoItem, TodoPriority } from "@/src/types";

type RepeatMode = "none" | GoalSchedule["mode"];
type ReminderDraft = {
  id: string;
  date: string;
  time: string;
  daysBeforeDue?: number;
  repeatDailyUntilDue?: boolean;
  schedule?: GoalSchedule;
  intervalText?: string;
};
type ReminderRepeatMode =
  | "once"
  | "daily"
  | "weekly"
  | "every_other_day"
  | "custom"
  | "monthly";

function reminderRepeatMode(reminder: Pick<ReminderDraft, "schedule">): ReminderRepeatMode {
  if (!reminder.schedule) return "once";
  if (reminder.schedule.mode === "daily") return "daily";
  if (reminder.schedule.mode === "selected_days") return "weekly";
  if (reminder.schedule.mode === "every_other_day") return "every_other_day";
  if (reminder.schedule.mode === "interval_days") return "custom";
  if (reminder.schedule.mode === "days_of_month") return "monthly";
  return "once";
}

function reminderSchedule(
  mode: ReminderRepeatMode,
  anchorDate: string,
): GoalSchedule | undefined {
  if (mode === "once") return undefined;
  if (mode === "daily") return { mode: "daily", anchorDate };
  if (mode === "every_other_day")
    return { mode: "every_other_day", anchorDate };
  if (mode === "custom")
    return { mode: "interval_days", anchorDate, intervalDays: 7 };
  if (mode === "weekly")
    return {
      mode: "selected_days",
      anchorDate,
      daysOfWeek: [new Date(`${anchorDate}T12:00:00`).getDay()],
    };
  return {
    mode: "days_of_month",
    anchorDate,
    daysOfMonth: [Number(anchorDate.slice(-2))],
  };
}

function plusMinutes(localDate: string, localTime: string, minutes: number) {
  const value = new Date(`${localDate}T${localTime}:00`);
  value.setMinutes(value.getMinutes() + minutes);
  return {
    date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
    time: `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`,
  };
}

export default function TodoEditor() {
  const {
    id,
    date,
    time,
    parentId,
    draftTreeId,
    draftId,
    draftParentId,
  } = useLocalSearchParams<{
    id?: string;
    date?: string;
    time?: string;
    parentId?: string;
    draftTreeId?: string;
    draftId?: string;
    draftParentId?: string;
  }>();
  const { state, saveTodo, deleteTodo } = useApp();
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const editorTreeId = useRef(
    draftTreeId ?? newTodoEditorDraftId("personal-todo-tree"),
  ).current;
  const draftTodoId = useRef(
    id ?? draftId ?? newTodoEditorDraftId("todo"),
  ).current;
  const stagedNodes = useTodoEditorDraftTree<TodoItem>(editorTreeId);
  const stagedNode = stagedNodes.find((node) => node.id === draftTodoId);
  const persistedTodo = (state.todos ?? []).find((todo) => todo.id === id);
  const existing = persistedTodo ?? stagedNode?.value;
  const editorTodos = useMemo(
    () => [
      ...(state.todos ?? []).filter(
        (todo) => !stagedNodes.some((node) => node.id === todo.id),
      ),
      ...stagedNodes.map((node) => node.value),
    ],
    [stagedNodes, state.todos],
  );
  const resolvedParentId =
    existing?.parentId ?? parentId ?? draftParentId;
  const parent = editorTodos.find((todo) => todo.id === resolvedParentId);
  const linkedScheduledReminders = existing
    ? (state.calendarReminders ?? []).filter(
        (reminder) =>
          reminder.kind === "todo" && reminder.todoId === existing.id,
      )
    : [];
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(
    existing?.description ?? "",
  );
  const parsedLabels = todoLabels({
    title,
    description,
  });
  const onLabelTap = useTodoLabelDoubleTap((label) => {
    setTitle((current) => removeTodoLabelFromText(current, label));
    setDescription((current) => removeTodoLabelFromText(current, label));
  });
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
  const initialBlockStartDate = existing?.scheduledStartAt?.slice(0, 10) ?? date ?? dateKey();
  const initialBlockStartTime = existing?.scheduledStartAt?.slice(11, 16) ?? time ?? "09:00";
  const initialBlockEnd = existing?.scheduledEndAt
    ? {
        date: existing.scheduledEndAt.slice(0, 10),
        time: existing.scheduledEndAt.slice(11, 16),
      }
    : plusMinutes(initialBlockStartDate, initialBlockStartTime, 60);
  const [hasTimeBlock, setHasTimeBlock] = useState(
    Boolean(existing?.scheduledStartAt || time),
  );
  const [blockStartDate, setBlockStartDate] = useState(initialBlockStartDate);
  const [blockStartTime, setBlockStartTime] = useState(initialBlockStartTime);
  const [blockEndDate, setBlockEndDate] = useState(initialBlockEnd.date);
  const [blockEndTime, setBlockEndTime] = useState(initialBlockEnd.time);
  const [blockCalendar, setBlockCalendar] = useState<"start" | "end" | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>(
    existing?.recurrence?.mode ?? "none",
  );
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [customDaysBefore, setCustomDaysBefore] = useState("2");
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
    existing
      ? existing.reminders.map((reminder, index) => ({
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
          repeatDailyUntilDue: reminder.repeatDailyUntilDue,
          schedule: reminder.schedule,
          intervalText:
            reminder.schedule?.mode === "interval_days"
              ? String(reminder.schedule.intervalDays ?? 7)
              : undefined,
        }))
      : date || time
        ? [
            {
              id: `reminder-daily-until-${Date.now().toString(36)}`,
              date: date ?? dateKey(),
              time: "09:00",
              repeatDailyUntilDue: true,
            },
          ]
        : [],
  );
  const dailyUntilDeadline = reminders.some(
    (reminder) => reminder.repeatDailyUntilDue,
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
        hasTimeBlock,
        blockStartDate,
        blockStartTime,
        blockEndDate,
        blockEndTime,
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
      hasTimeBlock,
      blockStartDate,
      blockStartTime,
      blockEndDate,
      blockEndTime,
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
  const promptOpen = useRef(false);
  const ownsDraftTree = !draftTreeId;
  const hasStagedDescendants =
    ownsDraftTree && stagedNodes.some((node) => node.id !== draftTodoId);
  const dirty =
    signature !== initialSignature.current || hasStagedDescendants;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useWebBeforeUnload(() => dirtyRef.current && !allowExit.current);
  const addReminder = (daysBeforeDue?: number) => {
    const date =
      daysBeforeDue !== undefined
        ? dateWithOffsetFrom(dueDate, -daysBeforeDue)
        : dueDate;
    if (
      reminders.some(
        (item) =>
          item.date === date &&
          item.daysBeforeDue === daysBeforeDue &&
          !item.id.startsWith("reminder-weekly-"),
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
  const setReminderRepeat = (index: number, mode: ReminderRepeatMode) =>
    setReminders((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              schedule: reminderSchedule(mode, item.date),
              intervalText: mode === "custom" ? item.intervalText ?? "7" : undefined,
            }
          : item,
      ),
    );
  const toggleDeadline = () => {
    if (hasDeadline) {
      setHasDeadline(false);
      setReminders((current) =>
        current.filter(
          (item) =>
            !item.repeatDailyUntilDue && item.daysBeforeDue === undefined,
        ),
      );
      return;
    }
    setHasDeadline(true);
    setRepeat("none");
    setReminders((current) =>
      current.some((item) => item.repeatDailyUntilDue)
        ? current
        : [
            ...current,
            {
              id: `reminder-daily-until-${Date.now().toString(36)}`,
              date: existing?.createdAt.slice(0, 10) ?? dateKey(),
              time: "09:00",
              repeatDailyUntilDue: true,
            },
          ],
    );
  };
  const isWeeklyReminder = (reminder: ReminderDraft) =>
    reminder.id.startsWith("reminder-weekly-");
  const relativeReminderSelected = (daysBeforeDue: number) =>
    reminders.some(
      (reminder) =>
        reminder.daysBeforeDue === daysBeforeDue &&
        !isWeeklyReminder(reminder),
    );
  const toggleRelativeReminder = (daysBeforeDue: number) => {
    if (relativeReminderSelected(daysBeforeDue)) {
      setReminders((current) =>
        current.filter(
          (reminder) =>
            reminder.daysBeforeDue !== daysBeforeDue ||
            isWeeklyReminder(reminder),
        ),
      );
      return;
    }
    addReminder(daysBeforeDue);
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
  const weeklyBeforeSelected = reminders.some(isWeeklyReminder);
  const toggleWeeklyBeforeDeadline = () => {
    if (weeklyBeforeSelected) {
      setReminders((current) =>
        current.filter((reminder) => !isWeeklyReminder(reminder)),
      );
      return;
    }
    addWeeklyBeforeDeadline();
  };
  const addCustomDaysBefore = () => {
    const daysBefore = Math.round(Number(customDaysBefore));
    if (!Number.isFinite(daysBefore) || daysBefore < 1 || daysBefore > 3650) {
      Alert.alert(
        "Choose a valid number",
        "Enter between 1 and 3,650 days before the deadline.",
      );
      return;
    }
    if (!relativeReminderSelected(daysBefore)) addReminder(daysBefore);
  };
  useEffect(() => {
    setReminders((current) =>
      current.map((reminder) =>
        reminder.daysBeforeDue === undefined
          ? reminder
          : {
              ...reminder,
              date: dateWithOffsetFrom(dueDate, -reminder.daysBeforeDue),
            },
      ),
    );
  }, [dueDate]);
  const buildTodo = (): TodoItem | undefined => {
    if (!title.trim()) {
      Alert.alert("Add a title", "What needs to be done?");
      return undefined;
    }
    const now = new Date().toISOString();
    if (hasTimeBlock) {
      const starts = new Date(`${blockStartDate}T${blockStartTime}:00`);
      const ends = new Date(`${blockEndDate}T${blockEndTime}:00`);
      if (
        Number.isNaN(starts.getTime()) ||
        Number.isNaN(ends.getTime()) ||
        ends <= starts
      ) {
        Alert.alert(
          "Check the planned time",
          "The end must be after the start. Overnight blocks can end on the next date.",
        );
        return undefined;
      }
    }
    const recurrenceAnchor = hasTimeBlock
      ? blockStartDate
      : hasDeadline
        ? dueDate
        : existing?.recurrence?.anchorDate ??
          existing?.createdAt.slice(0, 10) ??
          date ??
          dateKey();
    const recurrence: GoalSchedule | undefined =
      hasDeadline || repeat === "none"
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
            anchorDate: recurrenceAnchor,
          };
    const savedId = existing?.id ?? draftTodoId;
    return {
      id: savedId,
      title: title.trim(),
      description: description.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      dueAt: hasDeadline ? `${dueDate}T${dueTime}:00` : undefined,
      scheduledStartAt: hasTimeBlock
        ? `${blockStartDate}T${blockStartTime}:00`
        : undefined,
      scheduledEndAt: hasTimeBlock
        ? `${blockEndDate}T${blockEndTime}:00`
        : undefined,
      priority,
      recurrence,
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        at: `${reminder.date}T${reminder.time}:00`,
        time: reminder.time,
        daysBeforeDue: reminder.daysBeforeDue,
        repeatDailyUntilDue: reminder.repeatDailyUntilDue,
        schedule:
          reminder.schedule?.mode === "interval_days"
            ? {
                ...reminder.schedule,
                intervalDays: Math.max(
                  1,
                  Math.round(Number(reminder.intervalText) || 1),
                ),
              }
            : reminder.schedule,
      })),
      completedDates: existing?.completedDates ?? [],
      skippedDates: existing?.skippedDates ?? [],
      completedAt: existing?.completedAt,
      order: existing?.order,
      parentId: resolvedParentId,
      labels: parsedLabels,
    };
  };
  const stageCurrentTodo = () => {
    const todo = buildTodo();
    if (!todo) return undefined;
    upsertTodoEditorDraft(editorTreeId, {
      id: todo.id,
      parentId: todo.parentId,
      title: todo.title,
      value: todo,
    });
    return todo;
  };
  const persist = () => {
    const todo = stageCurrentTodo();
    if (!todo) return undefined;
    if (draftTreeId) {
      initialSignature.current = signature;
      return todo.id;
    }

    saveTodo(todo);
    const savedIds = new Set([
      ...(state.todos ?? []).map((item) => item.id),
      todo.id,
    ]);
    const pending = orderTodoEditorDraftNodes(
      getTodoEditorDraftNodes<TodoItem>(editorTreeId).filter(
        (node) => node.id !== todo.id,
      ),
      savedIds,
    );
    for (const next of pending) {
      saveTodo(next.value);
    }
    clearTodoEditorDraftTree(editorTreeId);
    initialSignature.current = signature;
    return todo.id;
  };
  const save = (exit: () => void = () => router.back()) => {
    const savedId = persist();
    if (!savedId) return;
    allowExit.current = true;
    exit();
  };
  const requestClose = (exit: () => void = () => router.back()) => {
    if (!dirtyRef.current) {
      if (!draftTreeId) clearTodoEditorDraftTree(editorTreeId);
      allowExit.current = true;
      exit();
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    Alert.alert("Save your changes?", "This to-do has unsaved changes.", [
      {
        text: "Keep editing",
        style: "cancel",
        onPress: () => {
          promptOpen.current = false;
        },
      },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          promptOpen.current = false;
          if (draftTreeId) {
            if (!draftId)
              removeTodoEditorDraftSubtree(editorTreeId, draftTodoId);
          } else clearTodoEditorDraftTree(editorTreeId);
          allowExit.current = true;
          exit();
        },
      },
      {
        text: "Save",
        onPress: () => {
          promptOpen.current = false;
          save(exit);
        },
      },
    ], {
      cancelable: true,
      onDismiss: () => {
        promptOpen.current = false;
      },
    });
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (allowExit.current || !dirtyRef.current) return;
        event.preventDefault();
        requestCloseRef.current(() => navigation.dispatch(event.data.action));
      }),
    [navigation],
  );
  useWebBackNavigationGuard(
    () => dirtyRef.current && !allowExit.current,
    (continueBack) => requestCloseRef.current(continueBack),
  );
  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit to-do" : parent ? "New subtask" : "New to-do"}
        subtitle={parent ? `Under ${parent.title}` : "A task, not a tracker."}
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
        {parsedLabels.length ? (
          <>
            <View style={styles.wrap}>
              {parsedLabels.map((label) => (
                <Chip
                  key={label}
                  label={`#${label}`}
                  selected
                  onPress={() => onLabelTap(label)}
                />
              ))}
            </View>
            <Text style={[styles.help, { color: colors.muted }]}>Double-tap a label to remove it, or delete its #label text.</Text>
          </>
        ) : (
          <Text style={[styles.help, { color: colors.muted }]}>Add #labels in the title or note to group and filter tasks quickly.</Text>
        )}
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
      <TutorialTarget id="todo-timing">
      <Card style={styles.form}>
        <Pressable
          onPress={toggleDeadline}
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
            <TimeInput
              value={dueTime}
              onChange={setDueTime}
              label="Time"
              wheelPicker
            />
          </>
        ) : null}
      </Card>
      </TutorialTarget>
      <Card style={styles.form}>
        <Pressable
          onPress={() => setHasTimeBlock((value) => !value)}
          style={styles.switchLine}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Planned time</Text>
            <Text style={[styles.help, { color: colors.muted }]}>Optional start and end; the deadline stays separate.</Text>
          </View>
          <Ionicons
            name={hasTimeBlock ? "checkbox" : "square-outline"}
            size={21}
            color={hasTimeBlock ? accent : colors.faint}
          />
        </Pressable>
        {hasTimeBlock ? (
          <>
            <View style={styles.blockRow}>
              <Pressable
                onPress={() => setBlockCalendar(blockCalendar === "start" ? null : "start")}
                style={[styles.blockDate, { borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={15} color={accent} />
                <Text style={[styles.reminderDateText, { color: colors.ink }]}>{blockStartDate}</Text>
              </Pressable>
              <TimeInput value={blockStartTime} onChange={setBlockStartTime} label="Starts" wheelPicker />
            </View>
            {blockCalendar === "start" ? (
              <MonthCalendar
                monthDate={blockStartDate}
                selectedDate={blockStartDate}
                onSelect={(next) => {
                  setBlockStartDate(next);
                  setBlockCalendar(null);
                }}
              />
            ) : null}
            <View style={styles.blockRow}>
              <Pressable
                onPress={() => setBlockCalendar(blockCalendar === "end" ? null : "end")}
                style={[styles.blockDate, { borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={15} color={accent} />
                <Text style={[styles.reminderDateText, { color: colors.ink }]}>{blockEndDate}</Text>
              </Pressable>
              <TimeInput value={blockEndTime} onChange={setBlockEndTime} label="Ends" wheelPicker />
            </View>
            {blockCalendar === "end" ? (
              <MonthCalendar
                monthDate={blockEndDate}
                selectedDate={blockEndDate}
                onSelect={(next) => {
                  setBlockEndDate(next);
                  setBlockCalendar(null);
                }}
              />
            ) : null}
          </>
        ) : null}
      </Card>
      {!hasDeadline ? <Card style={styles.form}>
        <SelectionMenu
          title="Repeat"
          searchable={false}
          multiple={false}
          items={[
            { id: "none", label: "Once", sublabel: "Do not repeat", icon: "calendar-outline" },
            { id: "daily", label: "Daily", sublabel: "Every day", icon: "repeat-outline" },
            { id: "selected_days", label: "Chosen days", sublabel: "Specific weekdays", icon: "calendar-number-outline" },
            { id: "every_other_day", label: "Every other day", sublabel: "Alternating days", icon: "swap-horizontal-outline" },
            { id: "interval_days", label: "Custom interval", sublabel: "Every chosen number of days", icon: "options-outline" },
            { id: "days_of_month", label: "Dates monthly", sublabel: "Specific dates each month", icon: "calendar-clear-outline" },
          ]}
          selectedIds={[repeat]}
          onChange={(ids) => ids[0] && setRepeat(ids[0] as RepeatMode)}
        />
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
      </Card> : null}
      <TutorialTarget id="todo-repeat-reminders">
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
          <View style={styles.presetSection}>
            <Pressable
              onPress={() =>
                setReminders((current) => {
                  const withoutDaily = current.filter(
                    (item) => !item.repeatDailyUntilDue,
                  );
                  return dailyUntilDeadline
                    ? withoutDaily
                    : [
                        ...withoutDaily,
                        {
                          id: `reminder-daily-until-${Date.now().toString(36)}`,
                          date: existing?.createdAt.slice(0, 10) ?? dateKey(),
                          time: "09:00",
                          repeatDailyUntilDue: true,
                        },
                      ];
                })
              }
              style={[
                styles.presetHeading,
                {
                  borderColor: dailyUntilDeadline ? accent : colors.border,
                  backgroundColor: colors.canvas,
                },
              ]}
            >
              <Ionicons
                name={dailyUntilDeadline ? "checkbox" : "square-outline"}
                size={19}
                color={dailyUntilDeadline ? accent : colors.faint}
              />
              <View style={styles.copy}>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Remind me daily until the deadline
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Once each day at 09:00 until completed, skipped, or due
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setPresetsOpen((open) => !open)}
              style={[
                styles.presetHeading,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.canvas,
                },
              ]}
            >
              <Ionicons name="notifications-outline" size={17} color={accent} />
              <View style={styles.copy}>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Reminder presets
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Choose one or several
                </Text>
              </View>
              <Ionicons
                name={presetsOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.muted}
              />
            </Pressable>
            {presetsOpen ? (
              <View
                style={[
                  styles.presetList,
                  { borderColor: colors.border },
                ]}
              >
                {(
                  [
                    [0, "At the deadline", "Uses the deadline time"],
                    [1, "One day before", "At 09:00"],
                    [3, "Three days before", "At 09:00"],
                    [7, "One week before", "At 09:00"],
                  ] as const
                ).map(([offset, label, description]) => {
                  const selected = relativeReminderSelected(offset);
                  return (
                    <Pressable
                      key={offset}
                      onPress={() => toggleRelativeReminder(offset)}
                      style={[
                        styles.presetRow,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={19}
                        color={selected ? accent : colors.faint}
                      />
                      <View style={styles.copy}>
                        <Text
                          style={[styles.presetTitle, { color: colors.ink }]}
                        >
                          {label}
                        </Text>
                        <Text
                          style={[styles.presetMeta, { color: colors.muted }]}
                        >
                          {description}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={toggleWeeklyBeforeDeadline}
                  style={[
                    styles.presetRow,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name={weeklyBeforeSelected ? "checkbox" : "square-outline"}
                    size={19}
                    color={weeklyBeforeSelected ? accent : colors.faint}
                  />
                  <View style={styles.copy}>
                    <Text
                      style={[styles.presetTitle, { color: colors.ink }]}
                    >
                      Every week before the deadline
                    </Text>
                    <Text
                      style={[styles.presetMeta, { color: colors.muted }]}
                    >
                      Weekly at 09:00, starting from the task date
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.customPresetRow}>
                  <View style={styles.copy}>
                    <Text
                      style={[styles.presetTitle, { color: colors.ink }]}
                    >
                      Custom days before
                    </Text>
                    <Text
                      style={[styles.presetMeta, { color: colors.muted }]}
                    >
                      Add any number of days before the deadline
                    </Text>
                  </View>
                  <TextInput
                    value={customDaysBefore}
                    onChangeText={setCustomDaysBefore}
                    keyboardType="number-pad"
                    placeholder="2"
                    placeholderTextColor={colors.faint}
                    style={[
                      styles.customDaysInput,
                      {
                        color: colors.ink,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={addCustomDaysBefore}
                    style={[
                      styles.customDaysAdd,
                      { backgroundColor: accent },
                    ]}
                  >
                    <Ionicons name="add" size={17} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {reminders.map((reminder, index) => (
          <View key={reminder.id} style={styles.reminderBlock}>
            <View style={styles.reminder}>
            {reminder.repeatDailyUntilDue ? (
              <View
                style={[
                  styles.reminderDate,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons name="repeat-outline" size={15} color={accent} />
                <Text
                  style={[styles.reminderDateText, { color: colors.ink }]}
                >
                  Daily until due
                </Text>
              </View>
            ) : (
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
            )}
            <TimeInput
              value={reminder.time}
              onChange={(value) =>
                setReminders((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, time: value } : item,
                  ),
                )
              }
              wheelPicker
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
                        ? {
                            ...item,
                            date,
                            daysBeforeDue: undefined,
                            schedule:
                              reminderRepeatMode(item) === "custom"
                                ? {
                                    mode: "interval_days",
                                    anchorDate: date,
                                    intervalDays: Math.max(
                                      1,
                                      Math.round(Number(item.intervalText) || 1),
                                    ),
                                  }
                                : reminderSchedule(
                                    reminderRepeatMode(item),
                                    date,
                                  ),
                          }
                        : item,
                    ),
                  );
                  setReminderCalendarIndex(null);
                }}
              />
            ) : null}
            {!reminder.repeatDailyUntilDue ? (
              <SelectionMenu
                title="Repeat reminder"
                searchable={false}
                multiple={false}
                items={[
                  { id: "once", label: "Once", sublabel: "Only on this date", icon: "calendar-outline" },
                  { id: "daily", label: "Daily", sublabel: "Every day from this date", icon: "repeat-outline" },
                  { id: "weekly", label: "Weekly", sublabel: "On this weekday", icon: "calendar-number-outline" },
                  { id: "every_other_day", label: "Every other day", sublabel: "Alternating days", icon: "swap-horizontal-outline" },
                  { id: "custom", label: "Custom interval", sublabel: "Every chosen number of days", icon: "options-outline" },
                  { id: "monthly", label: "Monthly", sublabel: "On this date each month", icon: "calendar-clear-outline" },
                ]}
                selectedIds={[reminderRepeatMode(reminder)]}
                onChange={(ids) =>
                  ids[0] &&
                  setReminderRepeat(index, ids[0] as ReminderRepeatMode)
                }
              />
            ) : null}
            {reminderRepeatMode(reminder) === "custom" ? (
              <View style={styles.reminderIntervalRow}>
                <Text style={[styles.help, { color: colors.muted }]}>Repeat every</Text>
                <TextInput
                  value={
                    reminder.intervalText ??
                    String(reminder.schedule?.intervalDays ?? 7)
                  }
                  onChangeText={(value) =>
                    setReminders((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              intervalText: value,
                              schedule: {
                                mode: "interval_days",
                                anchorDate: item.date,
                                intervalDays: Math.max(
                                  1,
                                  Math.round(
                                    Number(value) ||
                                      item.schedule?.intervalDays ||
                                      1,
                                  ),
                                ),
                              },
                            }
                          : item,
                      ),
                    )
                  }
                  keyboardType="number-pad"
                  style={[
                    styles.reminderIntervalInput,
                    { color: colors.ink, borderColor: colors.border },
                  ]}
                />
                <Text style={[styles.help, { color: colors.muted }]}>days</Text>
              </View>
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
        {linkedScheduledReminders.length ? (
          <View style={[styles.scheduledList, { borderColor: colors.border }]}>
            <Text style={[styles.help, { color: colors.muted }]}>
              Added from Schedule
            </Text>
            {linkedScheduledReminders.map((reminder) => (
              <Pressable
                key={reminder.id}
                onPress={() =>
                  router.navigate({
                    pathname: "/reminder-editor",
                    params: { id: reminder.id },
                  } as never)
                }
                style={styles.scheduledRow}
              >
                <Ionicons name="calendar-outline" size={14} color={accent} />
                <Text style={[styles.scheduledText, { color: colors.ink }]}>
                  {reminder.time} · {reminder.schedule.mode.replaceAll("_", " ")}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.faint}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        </> : null}
      </Card>
      </TutorialTarget>
      <TodoSubtaskEditorSection
        items={
          existing
            ? editorTodos.filter((todo) =>
                descendantTodoIds(editorTodos, existing.id).has(todo.id),
              )
            : []
        }
        onAdd={() => {
          const staged = stageCurrentTodo();
          if (!staged) return;
          router.push({
            pathname: "/todo-editor",
            params: {
              draftTreeId: editorTreeId,
              draftParentId: staged.id,
            },
          } as never);
        }}
        onEdit={(subtaskId) => {
          const staged = stagedNodes.some((node) => node.id === subtaskId);
          router.push({
            pathname: "/todo-editor",
            params: staged
              ? { draftTreeId: editorTreeId, draftId: subtaskId }
              : { id: subtaskId },
          } as never);
        }}
        onRemove={(subtaskId) => {
          const staged = stagedNodes.some((node) => node.id === subtaskId);
          const nestedCount = descendantTodoIds(editorTodos, subtaskId).size;
          Alert.alert(
            "Delete sub-to-do?",
            nestedCount
              ? "Its nested sub-to-dos will also be deleted."
              : "This cannot be undone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () =>
                  staged
                    ? removeTodoEditorDraftSubtree(editorTreeId, subtaskId)
                    : deleteTodo(subtaskId),
              },
            ],
          );
        }}
      />
      <Pressable onPress={() => save()} style={[styles.save, { backgroundColor: accent }]}>
        <Text style={styles.saveText}>Save to-do</Text>
      </Pressable>
      {persistedTodo ? (
        <Pressable
          onPress={() =>
            Alert.alert(
              "Delete to-do?",
              descendantTodoIds(state.todos ?? [], persistedTodo.id).size
                ? "Its nested subtasks will also be deleted. This cannot be undone."
                : "This cannot be undone.",
              [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  allowExit.current = true;
                  clearTodoEditorDraftTree(editorTreeId);
                  deleteTodo(persistedTodo.id);
                  router.back();
                },
              },
              ],
            )
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
  blockRow: { flexDirection: "row", alignItems: "flex-end", gap: 7 },
  blockDate: {
    minHeight: 42,
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
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
  reminderIntervalRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  reminderIntervalInput: {
    width: 58,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 8,
    textAlign: "center",
    fontSize: 9,
    fontWeight: "900",
  },
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
  scheduledList: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 8,
    gap: 4,
  },
  scheduledRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  scheduledText: { flex: 1, fontSize: 8, fontWeight: "800" },
  presetSection: { gap: 7 },
  presetHeading: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  presetList: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  presetRow: {
    minHeight: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  presetTitle: { fontSize: 9, lineHeight: 13, fontWeight: "900" },
  presetMeta: { fontSize: 7, lineHeight: 10, marginTop: 1 },
  customPresetRow: {
    minHeight: 58,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  customDaysInput: {
    width: 52,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
  },
  customDaysAdd: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
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
