import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TimeInput } from "@/src/components/TimeInput";
import { useWebBeforeUnload } from "@/src/components/useWebBeforeUnload";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { dateKey } from "@/src/domain/date";
import { descendantTodoIds, todoLabels } from "@/src/domain/todos";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GroupTodoCompletionMode, TodoPriority } from "@/src/types";

type Draft = {
  title: string;
  description: string;
  priority: TodoPriority;
  completionMode: GroupTodoCompletionMode;
  hasDeadline: boolean;
  dueDate: string;
  dueTime: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  description: "",
  priority: "normal",
  completionMode: "individual",
  hasDeadline: false,
  dueDate: dateKey(),
  dueTime: "18:00",
});

export default function GroupTodoEditor() {
  const { id, parentId } = useLocalSearchParams<{ id?: string; parentId?: string }>();
  const { state } = useApp();
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const groupTodos = useGroupTodos(state.group.id, state.group.groupTodosEnabled === true);
  const existing = groupTodos.todos.find((todo) => todo.id === id);
  const parent = groupTodos.todos.find(
    (todo) => todo.id === (existing?.parentId ?? parentId),
  );
  const me = state.group.members.find((member) => member.id === state.currentUserId);
  const canDelete =
    existing?.creatorId === state.currentUserId || me?.role === "owner" || me?.role === "admin";
  const canEdit = !existing || canDelete;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
    });
  }, [existing]);

  const labels = todoLabels({
    title: draft.title,
    description: draft.description,
    labels: existing?.labels,
  });
  const signature = useMemo(() => JSON.stringify(draft), [draft]);
  const initialSignature = useRef(JSON.stringify(emptyDraft()));
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
    });
  }, [existing]);
  const allowExit = useRef(false);
  const dirty = signature !== initialSignature.current;
  useWebBeforeUnload(() => dirty && !allowExit.current);

  const patchDraft = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));
  const save = async (exit: () => void = () => router.back()) => {
    if (!draft.title.trim()) {
      Alert.alert("Add a title", "What does the group need to do?");
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      await groupTodos.save({
        id: existing?.id,
        groupId: state.group.id,
        parentId: existing?.parentId ?? parentId,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        labels,
        priority: draft.priority,
        dueAt: draft.hasDeadline
          ? `${draft.dueDate}T${draft.dueTime}:00`
          : undefined,
        completionMode: draft.completionMode,
      });
      allowExit.current = true;
      exit();
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  const requestClose = (exit: () => void = () => router.back()) => {
    if (!dirty) {
      allowExit.current = true;
      exit();
      return;
    }
    Alert.alert("Save your changes?", "This group to-do has unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          allowExit.current = true;
          exit();
        },
      },
      { text: "Save", onPress: () => void save(exit) },
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
        title={existing ? (canEdit ? "Edit group to-do" : "Group to-do") : parent ? "New group subtask" : "New group to-do"}
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

      {saveError || groupTodos.error ? (
        <Text translate={false} style={[styles.error, { color: "#D24B4B" }]}>{saveError ?? groupTodos.error}</Text>
      ) : null}
      {canEdit ? (
        <Pressable
          disabled={saving}
          onPress={() => void save()}
          style={[styles.save, { backgroundColor: accent, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={styles.saveText}>{saving ? "Saving…" : "Save group to-do"}</Text>
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
