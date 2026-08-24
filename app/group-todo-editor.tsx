import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TimeInput } from "@/src/components/TimeInput";
import {
  useWebBackNavigationGuard,
  useWebBeforeUnload,
} from "@/src/components/useWebBeforeUnload";
import { TodoSubtaskEditorSection } from "@/src/components/TodoSubtaskEditorSection";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { dateKey } from "@/src/domain/date";
import { descendantTodoIds, todoLabels } from "@/src/domain/todos";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import {
  clearTodoEditorDraftTree,
  getTodoEditorDraftNodes,
  newTodoEditorDraftId,
  orderTodoEditorDraftNodes,
  removeTodoEditorDraftSubtree,
  resolveTodoEditorDraftParentId,
  upsertTodoEditorDraft,
  useTodoEditorDraftTree,
} from "@/src/state/todoEditorDrafts";
import { useAppColors, useGroupAccent } from "@/src/theme";
import {
  GoalSchedule,
  GroupTodoCompletionMode,
  TodoPriority,
} from "@/src/types";

type GroupTodoRepeatMode =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "every_other"
  | "custom"
  | "monthly";

type Draft = {
  title: string;
  description: string;
  priority: TodoPriority;
  completionMode: GroupTodoCompletionMode;
  hasDeadline: boolean;
  dueDate: string;
  dueTime: string;
  repeatMode: GroupTodoRepeatMode;
  repeatInterval: string;
  reminderEnabled: boolean;
  reminderDate: string;
  reminderTime: string;
};

type GroupTodoEditorDraftPayload = {
  draft: Draft;
  persistedId?: string;
  createdDuringDraft?: boolean;
};

const emptyDraft = (): Draft => ({
  title: "",
  description: "",
  priority: "normal",
  completionMode: "individual",
  hasDeadline: false,
  dueDate: dateKey(),
  dueTime: "18:00",
  repeatMode: "none",
  repeatInterval: "3",
  reminderEnabled: false,
  reminderDate: dateKey(),
  reminderTime: "09:00",
});

function repeatModeFor(schedule?: GoalSchedule): GroupTodoRepeatMode {
  if (!schedule) return "none";
  if (schedule.mode === "daily") return "daily";
  if (schedule.mode === "every_other_day") return "every_other";
  if (schedule.mode === "interval_days") return "custom";
  if (
    schedule.mode === "selected_days" &&
    JSON.stringify([...(schedule.daysOfWeek ?? [])].sort()) ===
      JSON.stringify([1, 2, 3, 4, 5])
  )
    return "weekdays";
  if (schedule.mode === "selected_days") return "weekly";
  if (schedule.mode === "days_of_month") return "monthly";
  return "daily";
}

export default function GroupTodoEditor() {
  const {
    id,
    parentId,
    draftTreeId,
    draftId,
    draftParentId,
  } = useLocalSearchParams<{
    id?: string;
    parentId?: string;
    draftTreeId?: string;
    draftId?: string;
    draftParentId?: string;
  }>();
  const {
    state,
    saveCalendarReminder,
    deleteCalendarReminder,
  } = useApp();
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const groupTodos = useGroupTodos(state.group.id, state.group.groupTodosEnabled === true);
  const editorTreeId = useRef(
    draftTreeId ?? newTodoEditorDraftId("group-todo-tree"),
  ).current;
  const editorDraftId = useRef(
    id ?? draftId ?? newTodoEditorDraftId("group-todo"),
  ).current;
  const stagedNodes = useTodoEditorDraftTree<GroupTodoEditorDraftPayload>(
    editorTreeId,
  );
  const stagedNode = stagedNodes.find((node) => node.id === editorDraftId);
  const existing = groupTodos.todos.find((todo) => todo.id === id);
  const resolvedParentId =
    existing?.parentId ?? parentId ?? draftParentId ?? stagedNode?.parentId;
  const parent =
    groupTodos.todos.find((todo) => todo.id === resolvedParentId) ??
    stagedNodes.find((node) => node.id === resolvedParentId);
  const me = state.group.members.find((member) => member.id === state.currentUserId);
  const canDelete =
    existing?.creatorId === state.currentUserId || me?.role === "owner" || me?.role === "admin";
  const canEdit = !existing || canDelete;
  const personalReminder = (state.calendarReminders ?? []).find(
    (reminder) =>
      reminder.groupId === state.group.id && reminder.groupTodoId === existing?.id,
  );
  const [draft, setDraft] = useState<Draft>(
    () => stagedNode?.value.draft ?? emptyDraft(),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reminderCalendarOpen, setReminderCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const initializedId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!existing || initializedId.current === existing.id) return;
    initializedId.current = existing.id;
    setDraft({
      title: existing.title,
      description: existing.description ?? "",
      priority: existing.priority,
      completionMode: existing.completionMode,
      hasDeadline: Boolean(existing.dueAt),
      dueDate: existing.dueAt?.slice(0, 10) ?? dateKey(),
      dueTime: existing.dueAt?.slice(11, 16) ?? "18:00",
      repeatMode: repeatModeFor(existing.recurrence),
      repeatInterval: String(existing.recurrence?.intervalDays ?? 3),
      reminderEnabled: personalReminder?.enabled === true,
      reminderDate:
        personalReminder?.schedule.anchorDate ??
        existing.dueAt?.slice(0, 10) ??
        dateKey(),
      reminderTime: personalReminder?.time ?? "09:00",
    });
  }, [existing, personalReminder]);

  const labels = todoLabels({
    title: draft.title,
    description: draft.description,
    labels: existing?.labels,
  });
  const signature = useMemo(() => JSON.stringify(draft), [draft]);
  const initialSignature = useRef(
    JSON.stringify(stagedNode?.value.draft ?? emptyDraft()),
  );
  useEffect(() => {
    if (!existing || initializedId.current !== existing.id) return;
    initialSignature.current = JSON.stringify({
      title: existing.title,
      description: existing.description ?? "",
      priority: existing.priority,
      completionMode: existing.completionMode,
      hasDeadline: Boolean(existing.dueAt),
      dueDate: existing.dueAt?.slice(0, 10) ?? dateKey(),
      dueTime: existing.dueAt?.slice(11, 16) ?? "18:00",
      repeatMode: repeatModeFor(existing.recurrence),
      repeatInterval: String(existing.recurrence?.intervalDays ?? 3),
      reminderEnabled: personalReminder?.enabled === true,
      reminderDate:
        personalReminder?.schedule.anchorDate ??
        existing.dueAt?.slice(0, 10) ??
        dateKey(),
      reminderTime: personalReminder?.time ?? "09:00",
    });
  }, [existing, personalReminder]);
  const allowExit = useRef(false);
  const promptOpen = useRef(false);
  const ownsDraftTree = !draftTreeId;
  const hasStagedDescendants =
    ownsDraftTree && stagedNodes.some((node) => node.id !== editorDraftId);
  const dirty =
    signature !== initialSignature.current || hasStagedDescendants;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useWebBeforeUnload(() => dirtyRef.current && !allowExit.current);

  const patchDraft = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));
  const recurrenceFor = (value: Draft): GoalSchedule | undefined => {
    const anchorDate = value.hasDeadline ? value.dueDate : dateKey();
    const anchorDay = new Date(`${anchorDate}T12:00:00`).getDay();
    if (value.repeatMode === "none") return undefined;
    if (value.repeatMode === "daily") return { mode: "daily", anchorDate };
    if (value.repeatMode === "weekdays")
      return {
        mode: "selected_days",
        daysOfWeek: [1, 2, 3, 4, 5],
        anchorDate,
      };
    if (value.repeatMode === "every_other")
      return { mode: "every_other_day", anchorDate };
    if (value.repeatMode === "custom")
      return {
        mode: "interval_days",
        intervalDays: Math.max(
          1,
          Math.round(Number(value.repeatInterval) || 1),
        ),
        anchorDate,
      };
    if (value.repeatMode === "weekly")
      return { mode: "selected_days", daysOfWeek: [anchorDay], anchorDate };
    return {
      mode: "days_of_month",
      daysOfMonth: [Number(anchorDate.slice(-2))],
      anchorDate,
    };
  };
  const stageCurrentDraft = () => {
    if (canEdit && !draft.title.trim()) {
      Alert.alert("Add a title", "What does the group need to do?");
      return undefined;
    }
    upsertTodoEditorDraft(editorTreeId, {
      id: editorDraftId,
      parentId: resolvedParentId,
      title: draft.title.trim(),
      value: {
        draft: { ...draft },
        persistedId: existing?.id ?? stagedNode?.value.persistedId,
        createdDuringDraft: stagedNode?.value.createdDuringDraft,
      },
    });
    return editorDraftId;
  };
  const persistGroupDraft = (
    value: GroupTodoEditorDraftPayload,
    resolvedId: string | undefined,
    resolvedDraftParentId: string | undefined,
  ) => {
    const todoDraft = value.draft;
    return groupTodos.save({
      id: resolvedId,
      groupId: state.group.id,
      parentId: resolvedDraftParentId,
      title: todoDraft.title.trim(),
      description: todoDraft.description.trim() || undefined,
      labels: todoLabels({
        title: todoDraft.title,
        description: todoDraft.description,
      }),
      priority: todoDraft.priority,
      dueAt: todoDraft.hasDeadline
        ? `${todoDraft.dueDate}T${todoDraft.dueTime}:00`
        : undefined,
      recurrence: recurrenceFor(todoDraft),
      completionMode: todoDraft.completionMode,
    });
  };
  const savePersonalReminder = (
    savedId: string,
    savedTitle: string,
    value: Draft,
    previousReminderId?: string,
  ) => {
    const recurrence = recurrenceFor(value);
    if (value.reminderEnabled) {
      saveCalendarReminder({
        id:
          previousReminderId ??
          `group-todo-reminder-${savedId}-${state.currentUserId}`,
        title: savedTitle,
        kind: "todo",
        groupId: state.group.id,
        groupTodoId: savedId,
        time: value.reminderTime,
        schedule: recurrence ?? {
          mode: "once",
          anchorDate: value.hasDeadline
            ? value.dueDate
            : value.reminderDate,
        },
        enabled: true,
      });
    } else if (previousReminderId)
      deleteCalendarReminder(previousReminderId);
  };
  const cleanupCreatedDraftRows = async (
    scopeRootId = editorDraftId,
  ) => {
    const nodes = getTodoEditorDraftNodes<GroupTodoEditorDraftPayload>(
      editorTreeId,
    );
    const scopeIds = descendantTodoIds(nodes, scopeRootId);
    scopeIds.add(scopeRootId);
    const createdNodes = orderTodoEditorDraftNodes(
      nodes.filter(
        (node) =>
          scopeIds.has(node.id) &&
          node.value.createdDuringDraft &&
          node.value.persistedId,
      ),
    ).reverse();
    for (const node of createdNodes) {
      await groupTodos.remove(node.value.persistedId!);
      deleteCalendarReminder(
        `group-todo-reminder-${node.value.persistedId}-${state.currentUserId}`,
      );
      upsertTodoEditorDraft(editorTreeId, {
        ...node,
        value: {
          ...node.value,
          persistedId: undefined,
          createdDuringDraft: undefined,
        },
      });
    }
  };
  const save = async (exit: (() => void) | null = () => router.back()) => {
    if (!stageCurrentDraft()) return undefined;
    if (draftTreeId) {
      initialSignature.current = signature;
      if (exit) {
        allowExit.current = true;
        exit();
      }
      return stagedNode;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const rootPersistedId =
        existing?.id ?? stagedNode?.value.persistedId;
      const saved = canEdit
        ? await persistGroupDraft(
            { draft, persistedId: rootPersistedId },
            rootPersistedId,
            resolvedParentId,
          )
        : existing;
      if (!saved) throw new Error("The group to-do is unavailable.");
      upsertTodoEditorDraft(editorTreeId, {
        id: editorDraftId,
        parentId: resolvedParentId,
        title: saved.title,
        value: {
          draft: { ...draft },
          persistedId: saved.id,
          createdDuringDraft:
            stagedNode?.value.createdDuringDraft ?? !rootPersistedId,
        },
      });
      savePersonalReminder(saved.id, saved.title, draft, personalReminder?.id);

      const idMap = new Map([[editorDraftId, saved.id]]);
      const pending = orderTodoEditorDraftNodes(
        getTodoEditorDraftNodes<GroupTodoEditorDraftPayload>(
          editorTreeId,
        ).filter((node) => node.id !== editorDraftId),
        [editorDraftId],
      );
      for (const next of pending) {
        const savedChild = await persistGroupDraft(
          next.value,
          next.value.persistedId,
          resolveTodoEditorDraftParentId(next.parentId, idMap),
        );
        idMap.set(next.id, savedChild.id);
        upsertTodoEditorDraft(editorTreeId, {
          ...next,
          title: savedChild.title,
          value: {
            ...next.value,
            persistedId: savedChild.id,
            createdDuringDraft:
              next.value.createdDuringDraft ?? !next.value.persistedId,
          },
        });
        savePersonalReminder(
          savedChild.id,
          savedChild.title,
          next.value.draft,
        );
      }
      clearTodoEditorDraftTree(editorTreeId);
      initialSignature.current = signature;
      if (exit) {
        allowExit.current = true;
        exit();
      }
      return saved;
    } catch (reason) {
      const saveMessage =
        reason instanceof Error ? reason.message : String(reason);
      try {
        await cleanupCreatedDraftRows();
        setSaveError(`${saveMessage} Nothing partial was kept; try again.`);
      } catch (cleanupReason) {
        const cleanupMessage =
          cleanupReason instanceof Error
            ? cleanupReason.message
            : String(cleanupReason);
        setSaveError(
          `${saveMessage} Saved portions remain staged for a safe retry (${cleanupMessage}).`,
        );
      }
    } finally {
      setSaving(false);
    }
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
    Alert.alert("Save your changes?", "This group to-do has unsaved changes.", [
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
              removeTodoEditorDraftSubtree(editorTreeId, editorDraftId);
            allowExit.current = true;
            exit();
            return;
          }
          setSaving(true);
          setSaveError(undefined);
          void cleanupCreatedDraftRows()
            .then(() => {
              clearTodoEditorDraftTree(editorTreeId);
              allowExit.current = true;
              exit();
            })
            .catch((reason) =>
              setSaveError(
                reason instanceof Error ? reason.message : String(reason),
              ),
            )
            .finally(() => setSaving(false));
        },
      },
      {
        text: "Save",
        onPress: () => {
          promptOpen.current = false;
          void save(exit);
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

  if (id && groupTodos.loading && !existing)
    return (
      <Screen>
        <PageHeader title="Group to-do" showMenu={false} />
        <Text style={[styles.message, { color: colors.muted }]}>Loading…</Text>
      </Screen>
    );

  if (id && groupTodos.ready && !existing)
    return (
      <Screen>
        <PageHeader
          title="Group to-do unavailable"
          subtitle="It may have been completed and removed, or you no longer have access."
          showMenu={false}
          action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
        />
      </Screen>
    );

  return (
    <Screen>
      <PageHeader
        title={existing ? (canEdit ? "Edit group to-do" : "Group to-do") : stagedNode ? "Edit group subtask" : parent ? "New group subtask" : "New group to-do"}
        subtitle={parent ? `Under ${parent.title}` : canEdit ? "Visible to active group members." : "Only its creator or a group admin can edit it."}
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => requestClose()} />}
      />
      <Card style={styles.form}>
        <TextInput
          value={draft.title}
          editable={canEdit}
          onChangeText={(title) => patchDraft({ title })}
          placeholder="What needs doing? Use #labels if useful"
          placeholderTextColor={colors.faint}
          maxLength={240}
          style={[styles.titleInput, { color: colors.ink, borderColor: colors.border }]}
        />
        <TextInput
          value={draft.description}
          editable={canEdit}
          onChangeText={(description) => patchDraft({ description })}
          placeholder="Optional note"
          placeholderTextColor={colors.faint}
          maxLength={4000}
          multiline
          style={[styles.noteInput, { color: colors.ink, borderColor: colors.border }]}
        />
        {labels.length ? (
          <View style={styles.wrap}>
            {labels.map((label) => <Chip key={label} label={`#${label}`} selected size="small" />)}
          </View>
        ) : (
          <Text style={[styles.help, { color: colors.muted }]}>#labels are parsed automatically for quick filters.</Text>
        )}
        <Text style={[styles.label, { color: colors.ink }]}>Priority</Text>
        <View style={styles.wrap}>
          {(["low", "normal", "high", "urgent"] as const).map((priority) => (
            <Chip
              key={priority}
              label={priority[0].toUpperCase() + priority.slice(1)}
              selected={draft.priority === priority}
              onPress={canEdit ? () => patchDraft({ priority }) : undefined}
              size="small"
            />
          ))}
        </View>
      </Card>

      <Card style={styles.form}>
        <Text style={[styles.label, { color: colors.ink }]}>Repeat</Text>
        <View style={styles.wrap}>
          {([
            ["none", "Does not repeat"],
            ["daily", "Daily"],
            ["weekdays", "Weekdays"],
            ["weekly", "Weekly"],
            ["every_other", "Every other day"],
            ["custom", "Custom interval"],
            ["monthly", "Monthly"],
          ] as const).map(([mode, label]) => (
            <Chip
              key={mode}
              label={label}
              selected={draft.repeatMode === mode}
              onPress={canEdit ? () => patchDraft({ repeatMode: mode }) : undefined}
              size="small"
            />
          ))}
        </View>
        {draft.repeatMode === "custom" ? (
          <View style={styles.intervalRow}>
            <Text style={[styles.help, { color: colors.muted }]}>Every</Text>
            <TextInput
              value={draft.repeatInterval}
              editable={canEdit}
              onChangeText={(repeatInterval) => patchDraft({ repeatInterval })}
              keyboardType="number-pad"
              maxLength={3}
              style={[styles.intervalInput, { color: colors.ink, borderColor: colors.border }]}
            />
            <Text style={[styles.help, { color: colors.muted }]}>days</Text>
          </View>
        ) : null}
        <Text style={[styles.help, { color: colors.muted }]}>Recurring completion resets on each scheduled day.</Text>
      </Card>

      <Card style={styles.form}>
        <Pressable
          onPress={() => patchDraft({ reminderEnabled: !draft.reminderEnabled })}
          style={styles.switchLine}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>My reminder</Text>
            <Text style={[styles.help, { color: colors.muted }]}>Private to you and synced only with your account.</Text>
          </View>
          <Ionicons
            name={draft.reminderEnabled ? "checkbox" : "square-outline"}
            size={21}
            color={draft.reminderEnabled ? accent : colors.faint}
          />
        </Pressable>
        {draft.reminderEnabled ? (
          <>
            {!draft.repeatMode || draft.repeatMode === "none" ? (
              <>
                <Pressable
                  disabled={draft.hasDeadline}
                  onPress={() => setReminderCalendarOpen((open) => !open)}
                  style={[styles.dateButton, { borderColor: colors.border }]}
                >
                  <Ionicons name="calendar-outline" size={17} color={accent} />
                  <Text translate={false} style={[styles.dateText, { color: colors.ink }]}>{draft.hasDeadline ? draft.dueDate : draft.reminderDate}</Text>
                  {draft.hasDeadline ? null : (
                    <Ionicons name={reminderCalendarOpen ? "chevron-up" : "chevron-down"} size={15} color={colors.muted} />
                  )}
                </Pressable>
                {reminderCalendarOpen && !draft.hasDeadline ? (
                  <MonthCalendar
                    monthDate={draft.reminderDate}
                    selectedDate={draft.reminderDate}
                    onSelect={(reminderDate) => {
                      patchDraft({ reminderDate });
                      setReminderCalendarOpen(false);
                    }}
                  />
                ) : null}
              </>
            ) : null}
            <TimeInput
              value={draft.reminderTime}
              onChange={(reminderTime) => patchDraft({ reminderTime })}
              label="Reminder time"
              wheelPicker
            />
          </>
        ) : null}
      </Card>

      <Card style={styles.form}>
        <Text style={[styles.label, { color: colors.ink }]}>Completion</Text>
        <View style={styles.wrap}>
          <Chip
            label="Everyone completes it"
            selected={draft.completionMode === "individual"}
            onPress={canEdit ? () => patchDraft({ completionMode: "individual" }) : undefined}
            size="small"
          />
          <Chip
            label="One completion for group"
            selected={draft.completionMode === "shared"}
            onPress={canEdit ? () => patchDraft({ completionMode: "shared" }) : undefined}
            size="small"
          />
        </View>
        <Text style={[styles.help, { color: colors.muted }]}>
          {draft.completionMode === "individual"
            ? "Each member checks off their own copy."
            : "Any member checks it off for the whole group."}
        </Text>
      </Card>

      <Card style={styles.form}>
        <Pressable
          disabled={!canEdit}
          onPress={() => patchDraft({ hasDeadline: !draft.hasDeadline })}
          style={styles.switchLine}
        >
          <View style={styles.copy}>
            <Text style={[styles.label, { color: colors.ink }]}>Deadline</Text>
            <Text style={[styles.help, { color: colors.muted }]}>Optional shared due date.</Text>
          </View>
          <Ionicons
            name={draft.hasDeadline ? "checkbox" : "square-outline"}
            size={21}
            color={draft.hasDeadline ? accent : colors.faint}
          />
        </Pressable>
        {draft.hasDeadline ? (
          <>
            <Pressable
              disabled={!canEdit}
              onPress={() => setCalendarOpen((open) => !open)}
              style={[styles.dateButton, { borderColor: colors.border }]}
            >
              <Ionicons name="calendar-outline" size={17} color={accent} />
              <Text translate={false} style={[styles.dateText, { color: colors.ink }]}>{draft.dueDate}</Text>
              <Ionicons name={calendarOpen ? "chevron-up" : "chevron-down"} size={15} color={colors.muted} />
            </Pressable>
            {calendarOpen ? (
              <MonthCalendar
                monthDate={draft.dueDate}
                selectedDate={draft.dueDate}
                onSelect={(dueDate) => {
                  patchDraft({ dueDate });
                  setCalendarOpen(false);
                }}
              />
            ) : null}
            {canEdit ? (
              <TimeInput value={draft.dueTime} onChange={(dueTime) => patchDraft({ dueTime })} label="Time" wheelPicker />
            ) : (
              <Text translate={false} style={[styles.help, { color: colors.muted }]}>Due at {draft.dueTime}</Text>
            )}
          </>
        ) : null}
      </Card>

      <TodoSubtaskEditorSection
        items={
          existing || stagedNode
            ? [
                ...groupTodos.todos.filter(
                  (todo) =>
                    !stagedNodes.some(
                      (node) =>
                        node.id === todo.id ||
                        node.value.persistedId === todo.id,
                    ),
                ),
                ...stagedNodes.map((node) => ({
                  id: node.id,
                  parentId: node.parentId,
                  title: node.title,
                })),
              ].filter((todo, _index, all) =>
                descendantTodoIds(
                  all,
                  existing?.id ?? editorDraftId,
                ).has(todo.id),
              )
            : []
        }
        canAdd
        canManage={canEdit}
        canManageItem={(subtaskId) => {
          if (stagedNodes.some((node) => node.id === subtaskId)) return true;
          const subtask = groupTodos.todos.find((todo) => todo.id === subtaskId);
          return (
            subtask?.creatorId === state.currentUserId ||
            me?.role === "owner" ||
            me?.role === "admin"
          );
        }}
        addingDisabled={saving}
        onAdd={() => {
          if (saving || !stageCurrentDraft()) return;
          router.push({
            pathname: "/group-todo-editor",
            params: {
              draftTreeId: editorTreeId,
              draftParentId: editorDraftId,
            },
          } as never);
        }}
        onEdit={(subtaskId) => {
          const staged = stagedNodes.some((node) => node.id === subtaskId);
          router.push({
            pathname: "/group-todo-editor",
            params: staged
              ? { draftTreeId: editorTreeId, draftId: subtaskId }
              : { id: subtaskId },
          } as never);
        }}
        onRemove={(subtaskId) => {
          const staged = stagedNodes.some((node) => node.id === subtaskId);
          const editorItems = [
            ...groupTodos.todos,
            ...stagedNodes.map((node) => ({
              id: node.id,
              parentId: node.parentId,
              title: node.title,
            })),
          ];
          const removedIds = descendantTodoIds(editorItems, subtaskId);
          removedIds.add(subtaskId);
          Alert.alert(
            "Delete group sub-to-do?",
            removedIds.size > 1
              ? "Its nested sub-to-dos will also be deleted for everyone."
              : "This removes it for everyone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  if (staged) {
                    setSaving(true);
                    setSaveError(undefined);
                    void cleanupCreatedDraftRows(subtaskId)
                      .then(() =>
                        removeTodoEditorDraftSubtree(
                          editorTreeId,
                          subtaskId,
                        ),
                      )
                      .catch((reason) =>
                        setSaveError(
                          reason instanceof Error
                            ? reason.message
                            : String(reason),
                        ),
                      )
                      .finally(() => setSaving(false));
                    return;
                  }
                  for (const reminder of state.calendarReminders ?? [])
                    if (
                      reminder.groupTodoId &&
                      removedIds.has(reminder.groupTodoId)
                    )
                      deleteCalendarReminder(reminder.id);
                  void groupTodos.remove(subtaskId).catch((reason) =>
                    setSaveError(
                      reason instanceof Error ? reason.message : String(reason),
                    ),
                  );
                },
              },
            ],
          );
        }}
      />

      {saveError || groupTodos.error ? (
        <Text translate={false} style={[styles.error, { color: "#D24B4B" }]}>{saveError ?? groupTodos.error}</Text>
      ) : null}
      {canEdit || existing ? (
        <Pressable
          disabled={saving}
          onPress={() => void save()}
          style={[styles.save, { backgroundColor: accent, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={styles.saveText}>{saving ? "Saving…" : canEdit ? "Save group to-do" : "Save my reminder"}</Text>
        </Pressable>
      ) : null}
      {existing && canDelete ? (
        <Pressable
          onPress={() =>
            Alert.alert(
              "Delete group to-do?",
              descendantTodoIds(groupTodos.todos, existing.id).size
                ? "Its nested subtasks will also be deleted for everyone."
                : "This removes it for everyone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    setSaving(true);
                    if (personalReminder)
                      deleteCalendarReminder(personalReminder.id);
                    clearTodoEditorDraftTree(editorTreeId);
                    void groupTodos.remove(existing.id)
                      .then(() => {
                        allowExit.current = true;
                        router.back();
                      })
                      .catch((reason) => setSaveError(reason instanceof Error ? reason.message : String(reason)))
                      .finally(() => setSaving(false));
                  },
                },
              ],
            )
          }
          style={styles.delete}
        >
          <Text style={styles.deleteText}>Delete for group</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 9, marginBottom: 8 },
  titleInput: { minHeight: 45, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, fontSize: 12, fontWeight: "900" },
  noteInput: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: 11, fontSize: 10, textAlignVertical: "top" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  label: { fontSize: 10, fontWeight: "900" },
  help: { fontSize: 8, lineHeight: 12 },
  switchLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  intervalRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  intervalInput: { width: 54, minHeight: 35, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, fontSize: 10, fontWeight: "800", textAlign: "center" },
  copy: { flex: 1 },
  dateButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  dateText: { flex: 1, fontSize: 10, fontWeight: "800" },
  save: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  delete: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#C44949", fontSize: 9, fontWeight: "900" },
  error: { fontSize: 9, lineHeight: 13, marginBottom: 8 },
  message: { padding: 18, fontSize: 10 },
});
