import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { useGroupSchedule } from "@/src/cloud/useGroupHubContent";
import { loadGroupScheduleItem } from "@/src/cloud/groupHubContent";
import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { GroupScheduleCalendar } from "@/src/components/GroupScheduleCalendar";
import { InfoPopover } from "@/src/components/InfoPopover";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { TimeInput } from "@/src/components/TimeInput";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { TutorialModal as Modal } from "@/src/components/TutorialModal";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import {
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
  formatClockTime,
} from "@/src/domain/date";
import {
  canonicalGroupScheduleAllDayInstant,
  groupScheduleAllDayDateKey,
} from "@/src/domain/groupHub";
import {
  GROUP_EVENT_REMINDER_MINUTES,
  groupCalendarEventsForDate,
  groupScheduleCalendarRange,
  localGroupScheduleDateTime,
  type GroupCalendarEvent,
} from "@/src/domain/groupSchedule";
import { LocalizedAlert as Alert, useLocale, useTranslation } from "@/src/i18n";
import { useUserSafety } from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import type { GroupScheduleItem } from "@/src/types";

function localClock(iso: string) {
  const value = new Date(iso);
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export default function GroupScheduleScreen() {
  const { state, updateSettings } = useApp();
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
  const t = useTranslation();
  const tutorial = useTutorialSandbox();
  const tutorialGuide = useTutorial();
  const safety = useUserSafety(state.currentUserId, tutorial.active);
  const [anchor, setAnchor] = useState(dateKey());
  const [calendarOptionsOpen, setCalendarOptionsOpen] = useState(false);
  const schedule = useGroupSchedule(state.group.id, anchor);
  const groupTodos = useGroupTodos(
    state.group.id,
    state.group.groupTodosEnabled === true,
  );
  const [editing, setEditing] = useState<GroupScheduleItem | null>();
  const [editorGroupId, setEditorGroupId] = useState(state.group.id);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState(dateKey());
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(dateKey());
  const [endTime, setEndTime] = useState("10:00");
  const [hasEnd, setHasEnd] = useState(true);
  const [allDay, setAllDay] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<number>();
  const [datePicker, setDatePicker] = useState<"start" | "end">();
  const [saving, setSaving] = useState(false);
  const [slot, setSlot] = useState<{
    date: string;
    events: GroupCalendarEvent[];
    hour?: number;
  }>();
  const [focusedItem, setFocusedItem] = useState<GroupScheduleItem>();
  const [focusError, setFocusError] = useState<string>();
  const focusedNavigationKey = useRef<string | undefined>(undefined);
  const currentEditorScope = useRef(`${state.currentUserId}:${state.group.id}`);
  currentEditorScope.current = `${state.currentUserId}:${state.group.id}`;
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManageAll =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const groupPreferences =
    state.settings.notifications.groupPreferencesByGroup?.[state.group.id];
  const remindersEnabled = groupPreferences?.scheduleReminders === true;
  const range = useMemo(() => groupScheduleCalendarRange(anchor), [anchor]);
  const projected = useMemo(() => {
    const result = new Map<string, GroupCalendarEvent[]>();
    for (let day = 0; day < 56; day += 1) {
      const localDate = dateWithOffsetFrom(range.from, day);
      result.set(
        localDate,
        groupCalendarEventsForDate({
          state,
          items: schedule.items,
          todos: groupTodos.todos,
          localDate,
          blockedUserIds: safety.blockedUserIds,
          safetyHydrated: safety.hydrated,
        }),
      );
    }
    return result;
  }, [
    range.from,
    state,
    schedule.items,
    groupTodos.todos,
    safety.blockedUserIds,
    safety.hydrated,
  ]);

  useEffect(() => {
    setEditing(undefined);
    setSlot(undefined);
    setFocusedItem(undefined);
    setFocusError(undefined);
    setCalendarOptionsOpen(false);
  }, [state.group.id, state.currentUserId]);

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
    void cloud
      .switchGroup(groupId)
      .catch((reason) =>
        setGroupSwitchError(
          reason instanceof Error
            ? reason.message
            : "That group is not available.",
        ),
      );
  }, [cloud, requestedGroupId, state.group.id, state.groups]);

  const localFocus = schedule.items.find((item) => item.id === focusedItemId);
  useEffect(() => {
    if (
      !focusedItemId ||
      (requestedGroupId && requestedGroupId !== state.group.id)
    )
      return;
    const controller = new AbortController();
    const show = (item: GroupScheduleItem | undefined) => {
      if (controller.signal.aborted) return;
      if (
        !item ||
        item.groupId !== state.group.id ||
        (item.creatorId !== state.currentUserId &&
          (!safety.hydrated || safety.blockedUserIds.has(item.creatorId)))
      ) {
        if (safety.hydrated) {
          setFocusError("This event is no longer available.");
          setFocusedItem(undefined);
        }
        return;
      }
      setFocusError(undefined);
      setFocusedItem(item);
      const navigationKey = `${state.currentUserId}:${state.group.id}:${focusedItemId}`;
      if (focusedNavigationKey.current !== navigationKey) {
        focusedNavigationKey.current = navigationKey;
        setAnchor(
          item.allDay
            ? groupScheduleAllDayDateKey(item.startsAt)!
            : dateKey(new Date(item.startsAt)),
        );
      }
    };
    if (localFocus) show(localFocus);
    else if (schedule.cloudEnabled && safety.hydrated)
      void loadGroupScheduleItem(
        state.group.id,
        focusedItemId,
        controller.signal,
      )
        .then(show)
        .catch((reason) => {
          if (!controller.signal.aborted)
            setFocusError(
              reason instanceof Error
                ? reason.message
                : "This event is no longer available.",
            );
        });
    return () => controller.abort();
  }, [
    focusedItemId,
    localFocus,
    requestedGroupId,
    schedule.cloudEnabled,
    state.group.id,
    state.currentUserId,
    safety.hydrated,
    safety.blockedUserIds,
  ]);

  const activeSlotEvents = slot
    ? slot.events.flatMap((event) => {
        const latest = projected
          .get(slot.date)
          ?.find((candidate) => candidate.id === event.id);
        return latest ? [latest] : [];
      })
    : [];

  function openEditor(item?: GroupScheduleItem, date = anchor, hour = 9) {
    setSlot(undefined);
    setEditing(item ?? null);
    setEditorGroupId(state.group.id);
    setTitle(item?.title ?? "");
    setNotes(item?.notes ?? "");
    setStartDate(
      item
        ? item.allDay
          ? (groupScheduleAllDayDateKey(item.startsAt) ?? date)
          : dateKey(new Date(item.startsAt))
        : date,
    );
    setStartTime(
      item && !item.allDay
        ? localClock(item.startsAt)
        : `${String(hour).padStart(2, "0")}:00`,
    );
    setEndDate(
      item?.endsAt
        ? dateKey(new Date(item.endsAt))
        : hour === 23
          ? dateWithOffsetFrom(date, 1)
          : date,
    );
    setEndTime(
      item?.endsAt
        ? localClock(item.endsAt)
        : `${String((hour + 1) % 24).padStart(2, "0")}:00`,
    );
    setHasEnd(item ? Boolean(item.endsAt) : true);
    setAllDay(item?.allDay ?? false);
    setReminderMinutes(item?.allDay ? undefined : item?.reminderMinutes);
    setDatePicker(undefined);
  }

  async function save() {
    if (saving || editorGroupId !== state.group.id) return;
    const operationScope = currentEditorScope.current;
    const start = allDay
      ? canonicalGroupScheduleAllDayInstant(startDate)
      : localGroupScheduleDateTime(`${startDate} ${startTime}`);
    const end =
      !allDay && hasEnd
        ? localGroupScheduleDateTime(`${endDate} ${endTime}`)
        : undefined;
    if (!title.trim())
      return Alert.alert("Add a title", "Name this group event first.");
    if (!start)
      return Alert.alert("Check the start", "Choose a valid date and time.");
    if (!allDay && hasEnd && !end)
      return Alert.alert(
        "Check the end time",
        "Choose a valid end date and time.",
      );
    if (end && end <= start!)
      return Alert.alert(
        "Check the time range",
        "The event must end after it starts.",
      );
    setSaving(true);
    try {
      const saved = await schedule.save({
        id: editing?.id,
        groupId: editorGroupId,
        title,
        notes,
        startsAt: start,
        endsAt: end,
        allDay,
        reminderMinutes: allDay ? undefined : reminderMinutes,
        expectedRevision: editing?.revision,
      });
      if (currentEditorScope.current !== operationScope) return;
      setEditing(undefined);
      setAnchor(
        saved.allDay
          ? groupScheduleAllDayDateKey(saved.startsAt)!
          : dateKey(new Date(saved.startsAt)),
      );
      if (saved.id === focusedItemId) setFocusedItem(saved);
    } catch (reason) {
      Alert.alert(
        "Event not saved",
        reason instanceof Error ? reason.message : "Refresh and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(item: GroupScheduleItem) {
    Alert.alert(
      "Delete group event?",
      "This removes it for every member and cancels its upcoming reminder.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void schedule
              .remove(item)
              .then(() => {
                setSlot(undefined);
                if (focusedItem?.id === item.id) setFocusedItem(undefined);
              })
              .catch((reason) =>
                Alert.alert(
                  "Event not deleted",
                  reason instanceof Error
                    ? reason.message
                    : "Refresh and try again.",
                ),
              ),
        },
      ],
    );
  }

  function openTask(todoId: string) {
    setSlot(undefined);
    router.push({
      pathname: "/group-todo-editor",
      params: { id: todoId, groupId: state.group.id },
    });
  }

  const inputStyle = [
    styles.input,
    {
      color: colors.ink,
      borderColor: colors.border,
      backgroundColor: colors.canvas,
    },
  ];
  const eventRow = (item: GroupScheduleItem) => {
    const editable = item.creatorId === state.currentUserId || canManageAll;
    return (
      <View
        key={item.id}
        style={[styles.eventDetail, { borderColor: colors.border }]}
      >
        <View style={styles.detailHeader}>
          <Ionicons name="calendar-outline" size={20} color={accent} />
          <View style={styles.copy}>
            <Text
              translate={false}
              style={[styles.title, { color: colors.ink }]}
            >
              {item.title}
            </Text>
            <Text
              translate={false}
              style={[styles.meta, { color: colors.muted }]}
            >
              {item.allDay
                ? t("All day")
                : formatClockTime(
                    new Date(item.startsAt),
                    state.settings.timeFormat,
                    locale,
                  )}
              {item.endsAt && !item.allDay
                ? ` – ${dateKey(new Date(item.endsAt)) !== dateKey(new Date(item.startsAt)) ? friendlyDate(dateKey(new Date(item.endsAt)), locale) + " " : ""}${formatClockTime(new Date(item.endsAt), state.settings.timeFormat, locale)}`
                : ""}
            </Text>
          </View>
        </View>
        {item.notes ? (
          <Text
            translate={false}
            style={[styles.notes, { color: colors.muted }]}
          >
            {item.notes}
          </Text>
        ) : null}
        {item.reminderMinutes !== undefined && !item.allDay ? (
          <View style={styles.inlineInfo}>
            <Ionicons name="notifications-outline" size={15} color={accent} />
            <Text style={[styles.meta, { color: colors.muted }]}>
              {item.reminderMinutes === 0
                ? "Reminder at the start"
                : item.reminderMinutes === 1440
                  ? "Reminder 1 day before"
                  : `Reminder ${item.reminderMinutes} min before`}
            </Text>
          </View>
        ) : null}
        {editable ? (
          <View style={styles.sheetButtons}>
            <Pressable
              accessibilityRole="button"
              onPress={() => openEditor(item)}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Ionicons name="create-outline" size={16} color={accent} />
              <Text style={[styles.buttonText, { color: accent }]}>Edit</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => confirmDelete(item)}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.muted} />
              <Text style={[styles.buttonText, { color: colors.muted }]}>
                Delete
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  if (requestedGroupId && requestedGroupId !== state.group.id) {
    const known = state.groups.some((group) => group.id === requestedGroupId);
    return (
      <Screen>
        <PageHeader
          title="Opening Group Schedule"
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          }
        />
        <Card style={styles.switchCard}>
          {!groupSwitchError && known ? (
            <ActivityIndicator color={accent} />
          ) : null}
          <Text style={[styles.title, { color: colors.ink }]}>
            {groupSwitchError ||
              (known
                ? "Switching to the linked group…"
                : "This group is no longer available.")}
          </Text>
          {groupSwitchError && known ? (
            <Pressable
              onPress={() => {
                setGroupSwitchError(undefined);
                void cloud
                  .switchGroup(requestedGroupId)
                  .catch((reason) =>
                    setGroupSwitchError(
                      reason instanceof Error ? reason.message : "Try again.",
                    ),
                  );
              }}
              style={[styles.button, { borderColor: accent }]}
            >
              <Text style={{ color: accent }}>Try again</Text>
            </Pressable>
          ) : null}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader
        title="Group Schedule"
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            <IconButton
              icon="options-outline"
              label="Schedule view"
              onPress={() => setCalendarOptionsOpen(true)}
            />
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          </View>
        }
      />
      {schedule.error || groupTodos.error ? (
        <Pressable
          onPress={() => {
            void schedule.refresh();
            void groupTodos.refresh();
          }}
          style={[styles.notice, { borderColor: colors.border }]}
        >
          <Ionicons
            name="cloud-offline-outline"
            size={17}
            color={colors.muted}
          />
          <Text style={[styles.noticeText, { color: colors.muted }]}>
            {schedule.error ?? groupTodos.error} · Tap to retry
          </Text>
        </Pressable>
      ) : null}
      {focusError ? (
        <Text style={[styles.notes, { color: colors.muted }]}>
          {focusError}
        </Text>
      ) : null}
      {focusedItem &&
      focusedItem.groupId === state.group.id &&
      (focusedItem.creatorId === state.currentUserId ||
        (safety.hydrated &&
          !safety.blockedUserIds.has(focusedItem.creatorId))) ? (
        <Card style={styles.focusCard}>
          <Text style={[styles.label, { color: accent }]}>
            Opened from your updates
          </Text>
          {eventRow(
            schedule.items.find((item) => item.id === focusedItem.id) ??
              focusedItem,
          )}
          <Pressable
            onPress={() => {
              setFocusedItem(undefined);
              router.setParams({ scheduleItemId: "", itemId: "" });
            }}
            style={styles.dismiss}
          >
            <Text style={[styles.buttonText, { color: colors.muted }]}>
              Dismiss
            </Text>
          </Pressable>
        </Card>
      ) : null}
      {schedule.loading ? (
        <View accessibilityLiveRegion="polite" style={styles.loading}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.meta, { color: colors.muted }]}>
            Updating this calendar…
          </Text>
        </View>
      ) : null}
      <TutorialTarget id="group-schedule-calendar">
        <GroupScheduleCalendar
          anchor={anchor}
          onSelectDate={setAnchor}
          eventsByDate={projected}
          onOpenSlot={(date, events, hour) => setSlot({ date, events, hour })}
          onCreate={(date, hour) => openEditor(undefined, date, hour)}
          optionsOpen={calendarOptionsOpen}
          onCloseOptions={() => setCalendarOptionsOpen(false)}
          optionsFooter={
            <Card style={styles.reminderCard}>
              <Ionicons name="notifications-outline" size={20} color={accent} />
              <View style={styles.copy}>
                <Text
                  translate={false}
                  style={[styles.meta, { color: colors.muted }]}
                >
                  {state.group.name}
                </Text>
                <Text style={[styles.title, { color: colors.ink }]}>
                  Group event reminders
                </Text>
                {remindersEnabled &&
                (groupPreferences?.enabled === false ||
                  state.settings.notifications.pushEnabled === false ||
                  state.settings.notifications.mutedGroupIds?.includes(
                    state.group.id,
                  )) ? (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    Delivery is paused by your notification settings.
                  </Text>
                ) : null}
              </View>
              <InfoPopover
                label={t("About group event reminders")}
                message="Notify me for reminders set on shared events. Off by default; group mute and notification settings still apply."
              />
              <Switch
                accessibilityLabel="Group event reminders"
                value={remindersEnabled}
                onValueChange={(scheduleReminders) =>
                  updateSettings({
                    notifications: {
                      ...state.settings.notifications,
                      groupPreferencesByGroup: {
                        ...state.settings.notifications.groupPreferencesByGroup,
                        [state.group.id]: {
                          ...groupPreferences,
                          scheduleReminders,
                        },
                      },
                    },
                  })
                }
                trackColor={{ false: colors.border, true: `${accent}66` }}
                thumbColor={remindersEnabled ? accent : colors.faint}
              />
            </Card>
          }
          actions={
            <View style={styles.quickActions}>
              <TutorialTarget
                id="group-schedule-create"
                style={styles.quickTarget}
                onTutorialActivate={() => {
                  if (!tutorial.active) return;
                  openEditor();
                  setTitle("Evening group walk");
                  setNotes("Meet at the park entrance. Everyone is welcome.");
                  setStartTime("18:00");
                  setEndTime("19:00");
                  setReminderMinutes(15);
                  tutorialGuide.reportEvent({
                    actionId: "tutorial.group-schedule.open-editor",
                    scope: "isolated-preview",
                  });
                }}
                onTutorialDeactivate={() => setEditing(undefined)}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openEditor()}
                  style={[styles.quick, { borderColor: colors.border }]}
                >
                  <Ionicons name="add" size={18} color={accent} />
                  <Text style={[styles.buttonText, { color: colors.ink }]}>
                    New event
                  </Text>
                </Pressable>
              </TutorialTarget>
              {state.group.groupTodosEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/group-todo-editor",
                      params: { groupId: state.group.id, date: anchor },
                    })
                  }
                  style={[styles.quick, { borderColor: colors.border }]}
                >
                  <Ionicons name="checkbox-outline" size={17} color={accent} />
                  <Text style={[styles.buttonText, { color: accent }]}>
                    New to-do
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      </TutorialTarget>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(slot)}
        onRequestClose={() => setSlot(undefined)}
      >
        <Pressable
          accessibilityLabel="Close schedule details"
          onPress={() => setSlot(undefined)}
          style={styles.backdrop}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.copy}>
                <Text style={[styles.sheetTitle, { color: colors.ink }]}>
                  Group plans
                </Text>
                <Text
                  translate={false}
                  style={[styles.meta, { color: colors.muted }]}
                >
                  {slot ? friendlyDate(slot.date, locale) : ""}
                  {slot?.hour !== undefined
                    ? ` · ${formatClockTime(`${String(slot.hour).padStart(2, "0")}:00`, state.settings.timeFormat, locale)}`
                    : ""}
                </Text>
              </View>
              <IconButton
                icon="close"
                label="Close details"
                onPress={() => setSlot(undefined)}
              />
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              {activeSlotEvents.map((event) => {
                if (event.scheduleItemId) {
                  const item = schedule.items.find(
                    (candidate) => candidate.id === event.scheduleItemId,
                  );
                  return item ? eventRow(item) : null;
                }
                return (
                  <Pressable
                    key={event.id}
                    accessibilityRole="button"
                    onPress={() =>
                      event.groupTodoId && openTask(event.groupTodoId)
                    }
                    style={[styles.taskRow, { borderColor: colors.border }]}
                  >
                    <Ionicons
                      name={
                        event.source === "reminder"
                          ? "notifications-outline"
                          : event.completed
                            ? "checkbox"
                            : "checkbox-outline"
                      }
                      size={20}
                      color={accent}
                    />
                    <View style={styles.copy}>
                      <Text
                        translate={false}
                        style={[styles.title, { color: colors.ink }]}
                      >
                        {event.title}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {event.source === "reminder"
                          ? "Your private group-task reminder"
                          : "Group to-do · open to view or edit"}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={colors.muted}
                    />
                  </Pressable>
                );
              })}
              {!activeSlotEvents.length ? (
                <Text style={[styles.emptyCopy, { color: colors.muted }]}>
                  Nothing planned in this slot yet.
                </Text>
              ) : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                slot && openEditor(undefined, slot.date, slot.hour)
              }
              style={[
                styles.button,
                styles.primaryButton,
                { backgroundColor: accent },
              ]}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={[styles.buttonText, { color: "#FFFFFF" }]}>
                Add group event
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={editing !== undefined && editorGroupId === state.group.id}
        onRequestClose={() => !saving && setEditing(undefined)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.backdrop}
        >
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.ink }]}>
                {editing ? "Edit group event" : "New group event"}
              </Text>
              <IconButton
                icon="close"
                label="Close editor"
                onPress={() => !saving && setEditing(undefined)}
              />
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              <TextInput
                accessibilityLabel="Event title"
                value={title}
                onChangeText={setTitle}
                maxLength={160}
                placeholder="Event title"
                placeholderTextColor={colors.faint}
                style={inputStyle}
              />
              <View style={styles.settingRow}>
                <View style={styles.copy}>
                  <Text style={[styles.label, { color: colors.ink }]}>
                    All-day event
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    A shared date with no time or timed reminder.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="All-day event"
                  value={allDay}
                  onValueChange={(value) => {
                    setAllDay(value);
                    if (value) setReminderMinutes(undefined);
                  }}
                  trackColor={{ false: colors.border, true: `${accent}66` }}
                  thumbColor={allDay ? accent : colors.faint}
                />
              </View>
              <Text style={[styles.label, { color: colors.ink }]}>
                {allDay ? "Date" : "Starts"}
              </Text>
              <View style={styles.dateTimeRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose start date"
                  onPress={() =>
                    setDatePicker(datePicker === "start" ? undefined : "start")
                  }
                  style={[
                    styles.dateButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.canvas,
                    },
                  ]}
                >
                  <Ionicons name="calendar-outline" size={17} color={accent} />
                  <Text
                    translate={false}
                    style={[styles.buttonText, { color: colors.ink }]}
                  >
                    {friendlyDate(startDate, locale)}
                  </Text>
                </Pressable>
                {!allDay ? (
                  <View style={styles.timeField}>
                    <TimeInput
                      value={startTime}
                      onChange={setStartTime}
                      wheelPicker
                    />
                  </View>
                ) : null}
              </View>
              {datePicker === "start" ? (
                <MonthCalendar
                  selectedDate={startDate}
                  onSelect={(date) => {
                    setStartDate(date);
                    if (endDate < date) setEndDate(date);
                    setDatePicker(undefined);
                  }}
                />
              ) : null}
              {!allDay ? (
                <>
                  <View style={styles.settingRow}>
                    <Text
                      style={[styles.label, styles.copy, { color: colors.ink }]}
                    >
                      Add end time
                    </Text>
                    <Switch
                      accessibilityLabel="Add end time"
                      value={hasEnd}
                      onValueChange={setHasEnd}
                      trackColor={{ false: colors.border, true: `${accent}66` }}
                      thumbColor={hasEnd ? accent : colors.faint}
                    />
                  </View>
                  {hasEnd ? (
                    <>
                      <View style={styles.dateTimeRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Choose end date"
                          onPress={() =>
                            setDatePicker(
                              datePicker === "end" ? undefined : "end",
                            )
                          }
                          style={[
                            styles.dateButton,
                            {
                              borderColor: colors.border,
                              backgroundColor: colors.canvas,
                            },
                          ]}
                        >
                          <Ionicons
                            name="calendar-outline"
                            size={17}
                            color={accent}
                          />
                          <Text
                            translate={false}
                            style={[styles.buttonText, { color: colors.ink }]}
                          >
                            {friendlyDate(endDate, locale)}
                          </Text>
                        </Pressable>
                        <View style={styles.timeField}>
                          <TimeInput
                            value={endTime}
                            onChange={setEndTime}
                            wheelPicker
                          />
                        </View>
                      </View>
                      {datePicker === "end" ? (
                        <MonthCalendar
                          selectedDate={endDate}
                          onSelect={(date) => {
                            setEndDate(date);
                            setDatePicker(undefined);
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <SelectionMenu
                    title="Shared event reminder"
                    items={[
                      {
                        id: "off",
                        label: "No reminder",
                        icon: "notifications-off-outline",
                      },
                      ...GROUP_EVENT_REMINDER_MINUTES.map((minutes) => ({
                        id: String(minutes),
                        label:
                          minutes === 0
                            ? "At the start"
                            : minutes === 1440
                              ? "1 day before"
                              : `${minutes} minutes before`,
                        icon: "notifications-outline" as const,
                      })),
                    ]}
                    multiple={false}
                    minimumSelected={1}
                    searchable={false}
                    selectedIds={[
                      reminderMinutes === undefined
                        ? "off"
                        : String(reminderMinutes),
                    ]}
                    onChange={(ids) =>
                      setReminderMinutes(
                        ids[0] && ids[0] !== "off" ? Number(ids[0]) : undefined,
                      )
                    }
                  />
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    Only members who turn on Group event reminders receive this
                    alert. Event times follow each member’s time zone.
                  </Text>
                </>
              ) : null}
              <TextInput
                accessibilityLabel="Event notes"
                value={notes}
                onChangeText={setNotes}
                maxLength={4000}
                multiline
                placeholder="Meeting point or plan (optional)"
                placeholderTextColor={colors.faint}
                style={[inputStyle, styles.notesInput]}
              />
            </ScrollView>
            <View style={styles.sheetButtons}>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setEditing(undefined)}
                style={[styles.button, { borderColor: colors.border }]}
              >
                <Text style={[styles.buttonText, { color: colors.muted }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void save()}
                style={[
                  styles.button,
                  { backgroundColor: accent, opacity: saving ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.buttonText, { color: "#FFFFFF" }]}>
                  {saving ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  meta: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  notes: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  notice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  noticeText: { flex: 1, fontSize: 9, fontWeight: "700" },
  emptyCopy: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingVertical: 25,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5,14,36,.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "92%",
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetContent: { gap: 10, paddingBottom: 8 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    fontSize: 12,
  },
  notesInput: { minHeight: 82, paddingVertical: 10, textAlignVertical: "top" },
  settingRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: { fontSize: 12, fontWeight: "700" },
  sheetButtons: { flexDirection: "row", gap: 8, marginTop: 3 },
  button: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 13,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primaryButton: { flex: undefined },
  buttonText: { fontSize: 12, fontWeight: "700" },
  switchCard: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 18,
  },
  reminderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
  },
  quickActions: { flexDirection: "row", gap: 6 },
  quickTarget: { flex: 1, minWidth: 0 },
  quick: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  loading: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
  },
  eventDetail: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 7 },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  inlineInfo: { flexDirection: "row", alignItems: "center", gap: 7 },
  taskRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  dateTimeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  dateButton: {
    minWidth: 125,
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 8,
  },
  timeField: { flex: 1, minWidth: 125 },
  focusCard: { gap: 8, padding: 12, marginBottom: 9 },
  dismiss: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
