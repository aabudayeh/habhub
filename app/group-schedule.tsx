import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, View } from "react-native";

import { useGroupSchedule } from "@/src/cloud/useGroupHubContent";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey, friendlyDate, formatClockTime } from "@/src/domain/date";
import {
  canonicalGroupScheduleAllDayInstant,
  groupScheduleAllDayDateKey,
} from "@/src/domain/groupHub";
import { LocalizedAlert as Alert, useLocale } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupScheduleItem } from "@/src/types";

function localDateTimeInput(iso?: string) {
  const date = iso ? new Date(iso) : new Date(Date.now() + 3_600_000);
  if (!Number.isFinite(date.getTime())) return `${dateKey()} 09:00`;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+|T)(\d{2}):(\d{2})$/);
  if (!match) return;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3]) ||
    date.getHours() !== Number(match[4]) ||
    date.getMinutes() !== Number(match[5])
  ) return;
  return date.toISOString();
}

export default function GroupScheduleScreen() {
  const { state } = useApp();
  const cloud = useCloudSyncActions();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    scheduleItemId?: string | string[];
    itemId?: string | string[];
    scheduleFocusAt?: string | string[];
  }>();
  const requestedGroupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;
  const focusedItemParam = params.scheduleItemId ?? params.itemId;
  const focusedItemId = Array.isArray(focusedItemParam)
    ? focusedItemParam[0]
    : focusedItemParam;
  const attemptedGroupSwitch = useRef<string | undefined>(undefined);
  const [groupSwitchError, setGroupSwitchError] = useState<string>();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const schedule = useGroupSchedule(state.group.id);
  const [editing, setEditing] = useState<GroupScheduleItem | null>();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [startsAt, setStartsAt] = useState(localDateTimeInput());
  const [endsAt, setEndsAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentMember = state.group.members.find((member) => member.id === state.currentUserId);
  const canManageAll = currentMember?.role === "owner" || currentMember?.role === "admin";
  const items = useMemo(
    () => [...schedule.items].sort((left, right) => {
      if (left.id === focusedItemId) return -1;
      if (right.id === focusedItemId) return 1;
      return left.startsAt.localeCompare(right.startsAt);
    }),
    [focusedItemId, schedule.items],
  );

  useEffect(() => {
    const groupId = requestedGroupId;
    if (
      !groupId ||
      groupId === state.group.id ||
      attemptedGroupSwitch.current === groupId ||
      !state.groups.some((group) => group.id === groupId)
    )
      return;
    attemptedGroupSwitch.current = groupId;
    setGroupSwitchError(undefined);
    void cloud.switchGroup(groupId).catch((reason) =>
      setGroupSwitchError(
        reason instanceof Error ? reason.message : "That group is not available.",
      ),
    );
  }, [cloud, requestedGroupId, state.group.id, state.groups]);

  if (requestedGroupId && requestedGroupId !== state.group.id) {
    const known = state.groups.some((group) => group.id === requestedGroupId);
    return (
      <Screen>
        <PageHeader
          title="Opening Group Schedule"
          showMenu={false}
          action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
        />
        <Card style={styles.switchCard}>
          {!groupSwitchError && known ? <ActivityIndicator color={accent} /> : null}
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>
            {groupSwitchError || (known ? "Switching to the linked group…" : "This group is no longer available.")}
          </Text>
          {groupSwitchError && known ? (
            <Pressable
              onPress={() => {
                attemptedGroupSwitch.current = undefined;
                setGroupSwitchError(undefined);
                void cloud.switchGroup(requestedGroupId).catch((reason) =>
                  setGroupSwitchError(reason instanceof Error ? reason.message : "Try again."),
                );
              }}
              style={[styles.retryButton, { borderColor: accent }]}
            >
              <Text style={[styles.buttonText, { color: accent }]}>Try again</Text>
            </Pressable>
          ) : null}
        </Card>
      </Screen>
    );
  }

  function openEditor(item?: GroupScheduleItem) {
    setEditing(item ?? null);
    setTitle(item?.title ?? "");
    setNotes(item?.notes ?? "");
    setStartsAt(
      item?.allDay
        ? (groupScheduleAllDayDateKey(item.startsAt) ?? dateKey(new Date(item.startsAt)))
        : localDateTimeInput(item?.startsAt),
    );
    setEndsAt(item?.endsAt ? localDateTimeInput(item.endsAt) : "");
    setAllDay(item?.allDay ?? false);
  }

  async function save() {
    const start = allDay
      ? canonicalGroupScheduleAllDayInstant(startsAt)
      : parseLocalDateTime(startsAt);
    const end = !allDay && endsAt.trim()
      ? parseLocalDateTime(endsAt)
      : undefined;
    if (!title.trim()) return Alert.alert("Add a title", "Name this group event first.");
    if (!start) return Alert.alert("Check the start", allDay ? "Use YYYY-MM-DD, for example 2026-09-12." : "Use YYYY-MM-DD HH:MM, for example 2026-09-12 10:30.");
    if (!allDay && endsAt.trim() && !end) return Alert.alert("Check the end time", "Use YYYY-MM-DD HH:MM or leave the end blank.");
    if (end && end < start) return Alert.alert("Check the time range", "The event cannot end before it starts.");
    setSaving(true);
    try {
      await schedule.save({
        id: editing?.id,
        groupId: state.group.id,
        title,
        notes,
        startsAt: start,
        endsAt: end,
        allDay,
        expectedRevision: editing?.revision,
      });
      setEditing(undefined);
    } catch (reason) {
      Alert.alert("Event not saved", reason instanceof Error ? reason.message : "Refresh and try again.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(item: GroupScheduleItem) {
    Alert.alert("Delete group event?", "This removes it for every member.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void schedule.remove(item).catch((reason) =>
          Alert.alert("Event not deleted", reason instanceof Error ? reason.message : "Refresh and try again."),
        ),
      },
    ]);
  }

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title="Group Schedule"
        subtitle="Shared plans update for everyone in this group."
        showMenu={false}
        action={<View style={styles.headerActions}><IconButton icon="add" label="Add group event" onPress={() => openEditor()} /><IconButton icon="close" label="Close" onPress={() => router.back()} /></View>}
      />
      {schedule.error ? (
        <Pressable onPress={() => void schedule.refresh()} style={[styles.notice, { borderColor: colors.border }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
          <Text style={[styles.noticeText, { color: colors.muted }]}>{schedule.error} · Tap to retry</Text>
        </Pressable>
      ) : null}
      <View style={styles.list}>
        {items.map((item) => {
          const starts = new Date(item.startsAt);
          const ends = item.endsAt ? new Date(item.endsAt) : undefined;
          const displayDateKey = item.allDay
            ? (groupScheduleAllDayDateKey(item.startsAt) ?? dateKey(starts))
            : dateKey(starts);
          const displayDate = item.allDay
            ? new Date(`${displayDateKey}T12:00:00`)
            : starts;
          const editable = item.creatorId === state.currentUserId || canManageAll;
          const focused = item.id === focusedItemId;
          return (
            <Card
              key={item.id}
              style={[
                styles.card,
                focused && { borderColor: accent, borderWidth: 2 },
              ]}
            >
              <View style={[styles.dateBadge, { backgroundColor: colors.primarySoft }]}>
                <Text translate={false} style={[styles.dateMonth, { color: accent }]}>{displayDate.toLocaleDateString(locale, { month: "short" }).toUpperCase()}</Text>
                <Text translate={false} style={[styles.dateDay, { color: colors.ink }]}>{displayDate.getDate()}</Text>
              </View>
              <View style={styles.copy}>
                <Text translate={false} style={[styles.title, { color: colors.ink }]}>{item.title}</Text>
                <Text translate={false} style={[styles.time, { color: colors.muted }]}>
                  {friendlyDate(displayDateKey, locale)} · {item.allDay ? "All day" : formatClockTime(starts, state.settings.timeFormat, locale)}
                  {ends && !item.allDay ? `–${formatClockTime(ends, state.settings.timeFormat, locale)}` : ""}
                </Text>
                {focused ? <Text style={[styles.focusedLabel, { color: accent }]}>Opened from your updates</Text> : null}
                {item.notes ? <Text translate={false} numberOfLines={3} style={[styles.notes, { color: colors.muted }]}>{item.notes}</Text> : null}
              </View>
              {editable ? <View style={styles.cardActions}><IconButton icon="create-outline" label="Edit event" onPress={() => openEditor(item)} /><IconButton icon="trash-outline" label="Delete event" onPress={() => confirmDelete(item)} /></View> : null}
            </Card>
          );
        })}
        {!schedule.loading && !items.length ? (
          <Pressable onPress={() => openEditor()} style={[styles.empty, { borderColor: colors.border }]}>
            <Ionicons name="calendar-outline" size={24} color={accent} />
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>Plan something together</Text>
            <Text style={[styles.emptyCopy, { color: colors.muted }]}>Add a workout, check-in, walk, or any shared event.</Text>
          </Pressable>
        ) : null}
      </View>
      <Modal transparent animationType="fade" visible={editing !== undefined} onRequestClose={() => !saving && setEditing(undefined)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: colors.ink }]}>{editing ? "Edit group event" : "New group event"}</Text><IconButton icon="close" label="Close editor" onPress={() => setEditing(undefined)} /></View>
            <TextInput value={title} onChangeText={setTitle} maxLength={160} placeholder="Event title" placeholderTextColor={colors.faint} style={[styles.input, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} />
            <View style={styles.allDayRow}><View style={styles.copy}><Text style={[styles.fieldTitle, { color: colors.ink }]}>All-day event</Text><Text style={[styles.fieldHint, { color: colors.muted }]}>Stores the date only; hidden times and end values are cleared.</Text></View><Switch value={allDay} onValueChange={(value) => { setAllDay(value); if (value) { const parsed = parseLocalDateTime(startsAt); setStartsAt(parsed ? dateKey(new Date(parsed)) : startsAt.slice(0, 10)); setEndsAt(""); } else if (/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) setStartsAt(`${startsAt} 09:00`); }} trackColor={{ false: colors.border, true: `${accent}66` }} thumbColor={allDay ? accent : colors.faint} /></View>
            <Text style={[styles.fieldTitle, { color: colors.ink }]}>{allDay ? "Date · YYYY-MM-DD" : "Start · YYYY-MM-DD HH:MM"}</Text>
            <TextInput value={startsAt} onChangeText={setStartsAt} autoCapitalize="none" placeholder={allDay ? "2026-09-12" : "2026-09-12 10:30"} placeholderTextColor={colors.faint} style={[styles.input, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} />
            {!allDay ? <><Text style={[styles.fieldTitle, { color: colors.ink }]}>End · optional</Text><TextInput value={endsAt} onChangeText={setEndsAt} autoCapitalize="none" placeholder="2026-09-12 11:30" placeholderTextColor={colors.faint} style={[styles.input, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} /></> : null}
            <TextInput value={notes} onChangeText={setNotes} maxLength={2000} multiline placeholder="Notes, meeting point, or plan (optional)" placeholderTextColor={colors.faint} style={[styles.input, styles.notesInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} />
            <View style={styles.sheetButtons}><Pressable disabled={saving} onPress={() => setEditing(undefined)} style={[styles.button, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.muted }]}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={() => void save()} style={[styles.button, { backgroundColor: accent }]}><Text style={[styles.buttonText, { color: "#FFFFFF" }]}>{saving ? "Saving…" : "Save"}</Text></Pressable></View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  list: { gap: 9 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 11 },
  dateBadge: { width: 46, minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  dateMonth: { fontSize: 7, fontWeight: "900" },
  dateDay: { fontSize: 18, lineHeight: 21, fontWeight: "900" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  time: { fontSize: 8, lineHeight: 12, fontWeight: "800", marginTop: 2 },
  focusedLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", marginTop: 3 },
  notes: { fontSize: 9, lineHeight: 13, marginTop: 5 },
  cardActions: { flexDirection: "row", alignItems: "center" },
  notice: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, marginBottom: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  noticeText: { flex: 1, fontSize: 8, fontWeight: "700" },
  empty: { minHeight: 150, borderWidth: 1, borderStyle: "dashed", borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 22, gap: 5 },
  emptyTitle: { fontSize: 13, fontWeight: "900" },
  emptyCopy: { maxWidth: 260, fontSize: 9, lineHeight: 14, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(5,14,36,.62)", alignItems: "center", justifyContent: "center", padding: 18 },
  sheet: { width: "100%", maxWidth: 480, borderWidth: 1, borderRadius: 22, padding: 16, gap: 9 },
  sheetHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, fontSize: 11 },
  notesInput: { minHeight: 84, paddingVertical: 10, textAlignVertical: "top" },
  allDayRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10 },
  fieldTitle: { fontSize: 9, fontWeight: "900" },
  fieldHint: { fontSize: 8, lineHeight: 11, marginTop: 2 },
  sheetButtons: { flexDirection: "row", gap: 8, marginTop: 3 },
  button: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: "transparent", borderRadius: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 10, fontWeight: "900" },
  switchCard: { minHeight: 140, alignItems: "center", justifyContent: "center", gap: 10, padding: 18 },
  retryButton: { minHeight: 40, paddingHorizontal: 18, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
