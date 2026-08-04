import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { InfoPopover } from "@/src/components/InfoPopover";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { scheduleEventsForDate, ScheduleEvent } from "@/src/domain/calendar";
import {
  calendarWeekRange,
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
} from "@/src/domain/date";
import {
  isInternalTracker,
  trackerGroupLabel,
} from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition, ScheduleViewFilter } from "@/src/types";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SCHEDULE_LOG_EXCLUDED = new Set([
  "steps",
  "tracked_goals",
  "overall_score",
  "daily_deficit",
  "weekly_deficit",
  "weekly_deficit_balance",
  "weekly_balance",
]);
const DEFAULT_SCHEDULE_LOG_NOISE = new Set([
  "active_energy",
  "workout_calories",
  "workout_distance",
]);
const DEFAULT_SCHEDULE_ACTIVITY_IDS = new Set([
  "food",
  "workout",
  "workout_duration",
  "gym_completed",
  "intermittent_fasting",
  "sleep",
]);

function canShowLogOnSchedule(metric: MetricDefinition) {
  return (
    metric.dataType !== "calculated" &&
    !isInternalTracker(metric) &&
    !SCHEDULE_LOG_EXCLUDED.has(metric.id)
  );
}

function SchedulePage() {
  const {
    state,
    deleteTodo,
    deleteCalendarReminder,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const [anchor, setAnchor] = useState(dateKey());
  const [editing, setEditing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<ScheduleViewFilter>();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(),
  );
  const startHour = state.settings.scheduleStartHour ?? 7;
  const hours = useMemo(
    () => [...HOURS.filter((hour) => hour >= startHour), ...HOURS.filter((hour) => hour < startHour)],
    [startHour],
  );
  const dates = useMemo(
    () => calendarWeekRange(anchor, state.settings.weekStartsOn ?? 1),
    [anchor, state.settings.weekStartsOn],
  );
  const logMetrics = useMemo(
    () =>
      state.metrics
        .filter(canShowLogOnSchedule)
        .sort((a, b) => a.order - b.order),
    [state.metrics],
  );
  const defaultLogMetricIds = useMemo(() => {
    const selected = new Set([
      ...state.settings.selectedGoals,
      ...state.settings.progressMetricIds,
      ...state.metrics
        .filter((metric) => metric.sections.today)
        .map((metric) => metric.id),
    ]);
    return logMetrics
      .filter(
        (metric) =>
          selected.has(metric.id) &&
          !DEFAULT_SCHEDULE_LOG_NOISE.has(metric.id) &&
          (metric.timerEnabled || DEFAULT_SCHEDULE_ACTIVITY_IDS.has(metric.id)),
      )
      .map((metric) => metric.id);
  }, [logMetrics, state.metrics, state.settings.progressMetricIds, state.settings.selectedGoals]);
  const fallbackFilter = useMemo<ScheduleViewFilter>(
    () => ({
      id: "schedule-default",
      name: "My schedule",
      includeTodos: true,
      includeReminders: true,
      logMetricIds: defaultLogMetricIds,
    }),
    [defaultLogMetricIds],
  );
  const storedFilters = state.settings.scheduleViewFilters ?? [];
  const scheduleFilters = storedFilters.length ? storedFilters : [fallbackFilter];
  const activeFilter =
    scheduleFilters.find(
      (view) => view.id === state.settings.activeScheduleViewFilterId,
    ) ?? scheduleFilters[0] ?? fallbackFilter;
  const filterItems = scheduleFilters.map((view) => ({
    id: view.id,
    label: view.name,
    icon: "albums-outline" as const,
    group: "Saved schedule views",
  }));
  const eventMatchesActiveFilter = useCallback(
    (event: ScheduleEvent) => {
      if (event.kind === "todo") return activeFilter.includeTodos;
      if (event.kind === "tracker" || event.kind === "reminder")
        return activeFilter.includeReminders;
      return Boolean(
        event.metricId && activeFilter.logMetricIds.includes(event.metricId),
      );
    },
    [activeFilter],
  );
  const eventsByDate = useMemo(() => {
    return Object.fromEntries(
      dates.map((date) => [
        date,
        scheduleEventsForDate(state, date).filter(eventMatchesActiveFilter),
      ]),
    ) as Record<string, ScheduleEvent[]>;
  }, [dates, eventMatchesActiveFilter, state]);
  const swipeGesture = usePageSwipeGesture({
    enabled: !editing,
    onPrevious: () => {
      setAnchor((current) => dateWithOffsetFrom(current, -7));
      setCalendarOpen(false);
    },
    onNext: () => {
      setAnchor((current) => dateWithOffsetFrom(current, 7));
      setCalendarOpen(false);
    },
  });
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!editing) return false;
          setEditing(false);
          return true;
        },
      );
      return () => subscription.remove();
    }, [editing]),
  );

  function editScheduleView(view: ScheduleViewFilter = activeFilter) {
    setDraftFilter({ ...view, logMetricIds: [...view.logMetricIds] });
    setFilterEditorOpen(true);
  }

  function newScheduleView() {
    setDraftFilter({
      ...activeFilter,
      id: `schedule-view-${Date.now().toString(36)}`,
      name: `Schedule view ${scheduleFilters.length + 1}`,
      logMetricIds: [...activeFilter.logMetricIds],
    });
    setFilterEditorOpen(true);
  }

  function saveScheduleView(view: ScheduleViewFilter) {
    const normalized = {
      ...view,
      name: view.name.trim() || "Schedule view",
      logMetricIds: [...new Set(view.logMetricIds)],
    };
    updateSettings({
      scheduleViewFilters: storedFilters.some((item) => item.id === view.id)
        ? storedFilters.map((item) =>
            item.id === view.id ? normalized : item,
          )
        : [...storedFilters, normalized],
      activeScheduleViewFilterId: normalized.id,
    });
    setFilterEditorOpen(false);
  }

  function deleteScheduleView(viewId: string) {
    const next = storedFilters.filter((item) => item.id !== viewId);
    updateSettings({
      scheduleViewFilters: next,
      activeScheduleViewFilterId: next[0]?.id,
    });
    setFilterEditorOpen(false);
  }

  function openEvent(event: ScheduleEvent, localDate: string) {
    if (editing) {
      Alert.alert("Remove scheduled item?", event.title, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (event.kind === "todo" && event.todoId)
              deleteTodo(event.todoId);
            else if (event.kind === "reminder")
              deleteCalendarReminder(event.id.replace(/^reminder:/, ""));
            else if (event.metricId)
              router.navigate({
                pathname: "/metric-editor",
                params: { id: event.metricId, focus: "notifications" },
              } as never);
          },
        },
      ]);
      return;
    }
    if (event.kind === "todo" && event.todoId)
      router.navigate({
        pathname: "/todo-editor",
        params: { id: event.todoId },
      } as never);
    else if (
      event.metricId &&
      event.durationMinutes &&
      state.metrics.find((metric) => metric.id === event.metricId)?.timerEnabled &&
      (event.kind === "tracker" || event.kind === "reminder")
    )
      router.push({
        pathname: "/timer",
        params: {
          metric: event.metricId,
          date: localDate,
          duration: String(Math.round(event.durationMinutes)),
        },
      } as never);
    else if (["log", "gym", "fasting"].includes(event.kind) && event.metricId)
      router.push({
        pathname: "/metric-detail",
        params: { metric: event.metricId, date: localDate, period: "today" },
      } as never);
    else if (event.kind === "gym") router.navigate("/gym" as never);
    else if (event.metricId)
      router.push({
        pathname: "/metric-editor",
        params: { id: event.metricId, focus: "notifications" },
      } as never);
    else if (event.kind === "reminder")
      router.navigate({
        pathname: "/reminder-editor",
        params: { id: event.id.replace(/^reminder:/, "") },
      } as never);
  }

  function toggleRow(rowId: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function createInSlot(localDate: string, time?: string) {
    Alert.alert("Add to this slot", undefined, [
      {
        text: "New to-do",
        onPress: () =>
          router.navigate({
            pathname: "/todo-editor",
            params: { date: localDate, time },
          } as never),
      },
      {
        text: "New reminder",
        onPress: () =>
          router.navigate({
            pathname: "/reminder-editor",
            params: { date: localDate, time },
          } as never),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const weekLabel = `${friendlyDate(dates[0], locale)} – ${friendlyDate(
    dates[dates.length - 1],
    locale,
  )}`;
  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={styles.pageGesture}>
    <Screen
      contentContainerStyle={styles.page}
    >
      <PageHeader
        title="Schedule"
        tutorialId="schedule-header"
        action={
          <View style={styles.headerActions}>
            <InfoPopover
              label="Explain Schedule"
              message="Tap an item to edit it. Double-tap or hold any slot to add another to-do or reminder. Tap a row label to reveal crowded rows, and hold the calendar background to enter edit mode."
            />
            <SelectionMenu
              title="Schedule view"
              items={filterItems}
              selectedIds={[activeFilter.id]}
              onChange={(ids) =>
                ids[0] &&
                updateSettings({ activeScheduleViewFilterId: ids[0] })
              }
              multiple={false}
              compactIcon
            />
            <Pressable
              onPress={() => setEditing((value) => !value)}
              style={[
                styles.editButton,
                { borderColor: editing ? accent : colors.border },
              ]}
            >
              <Ionicons
                name={editing ? "checkmark" : "create-outline"}
                size={16}
                color={accent}
              />
            </Pressable>
          </View>
        }
      />
      <Card style={styles.weekNav}>
        <Pressable
          onPress={() => setAnchor(dateWithOffsetFrom(anchor, -7))}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => setCalendarOpen((open) => !open)}
          style={styles.navCopy}
        >
          <Text style={[styles.weekTitle, { color: colors.ink }]}>
            {weekLabel}
          </Text>
          <Ionicons
            name={calendarOpen ? "chevron-up" : "chevron-down"}
            size={15}
            color={colors.muted}
          />
        </Pressable>
        <Pressable
          onPress={() => setAnchor(dateWithOffsetFrom(anchor, 7))}
          style={styles.navButton}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </Pressable>
      </Card>
      {calendarOpen ? (
        <MonthCalendar
          monthDate={anchor}
          selectedDate={anchor}
          onMonthChange={setAnchor}
          onSelect={(date) => {
            setAnchor(date);
            setCalendarOpen(false);
          }}
          hasActivity={(date) =>
            scheduleEventsForDate(state, date).some(eventMatchesActiveFilter)
          }
        />
      ) : null}
      {editing ? (
        <Card style={styles.scheduleSettings}>
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: colors.muted }]}>First hour</Text>
            <View style={styles.startHours}>
              {[5, 6, 7, 8, 9].map((hour) => (
                <Pressable
                  key={hour}
                  onPress={() => updateSettings({ scheduleStartHour: hour })}
                  style={[
                    styles.hourChoice,
                    {
                      borderColor: hour === startHour ? accent : colors.border,
                      backgroundColor:
                        hour === startHour ? colors.primarySoft : colors.card,
                    },
                  ]}
                >
                  <Text style={[styles.actionText, { color: colors.ink }]}>
                    {formatHour(hour, state.settings.timeFormat)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.filterManageRow}>
            <Pressable
              onPress={() => editScheduleView()}
              style={[styles.filterManage, { borderColor: colors.border }]}
            >
              <Ionicons name="options-outline" size={16} color={accent} />
              <View style={styles.filterManageCopy}>
                <Text style={[styles.filterManageTitle, { color: colors.ink }]}>
                  {activeFilter.name}
                </Text>
                <Text style={[styles.filterManageMeta, { color: colors.muted }]}>Choose to-dos, reminders and logged trackers</Text>
              </View>
              <Ionicons name="create-outline" size={15} color={accent} />
            </Pressable>
            <Pressable
              accessibilityLabel="New schedule view"
              onPress={newScheduleView}
              style={[styles.newFilterButton, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={18} color={accent} />
            </Pressable>
          </View>
        </Card>
      ) : null}
      <View style={styles.quickActions}>
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          style={[styles.quick, { borderColor: accent }]}
        >
          <Ionicons name="checkbox-outline" size={15} color={accent} />
          <Text style={[styles.actionText, { color: accent }]}>New to-do</Text>
        </Pressable>
        <Pressable
          onPress={() => router.navigate("/reminder-editor" as never)}
          style={[styles.quick, { borderColor: accent }]}
        >
          <Ionicons name="notifications-outline" size={15} color={accent} />
          <Text style={[styles.actionText, { color: accent }]}>
            New reminder
          </Text>
        </Pressable>
      </View>
      <Pressable
        delayLongPress={450}
        onLongPress={() => setEditing(true)}
      >
      <Card style={styles.gridCard}>
        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          <View style={styles.hourHeader} />
          {dates.map((date) => {
            const today = date === dateKey();
            return (
              <View key={date} style={styles.dayHeader}>
                <Text style={[styles.dayName, { color: colors.muted }]}>
                  {new Intl.DateTimeFormat(locale, { weekday: "short" })
                    .format(new Date(`${date}T12:00:00`))
                    .slice(0, 2)}
                </Text>
                <View
                  style={[
                    styles.dayNumberWrap,
                    today && { backgroundColor: accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      { color: today ? palette.white : colors.ink },
                    ]}
                  >
                    {Number(date.slice(-2))}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        <View
          style={[
            styles.allDayRow,
            {
              borderBottomColor: colors.border,
              minHeight: expandedRows.has("all")
                ? Math.max(
                    44,
                    ...dates.map(
                      (date) =>
                        (eventsByDate[date] ?? []).filter(
                          (event) => !event.time,
                        ).length *
                          18 +
                        8,
                    ),
                  )
                : 44,
            },
          ]}
        >
          <Pressable
            onPress={() => toggleRow("all")}
            style={styles.rowLabelButton}
          >
            <Text style={[styles.allDayLabel, { color: colors.muted }]}>
              ALL
            </Text>
            <Ionicons
              name={
                expandedRows.has("all") ? "chevron-up" : "chevron-down"
              }
              size={9}
              color={colors.faint}
            />
          </Pressable>
          {dates.map((date) => (
            <ScheduleCell
              key={date}
              events={(eventsByDate[date] ?? []).filter(
                (event) => !event.time,
              )}
              date={date}
              editing={editing}
              expanded={expandedRows.has("all")}
              onExpand={() => toggleRow("all")}
              onOpen={openEvent}
              onCreate={(date) => createInSlot(date)}
            />
          ))}
        </View>
        {hours.map((hour) => (
          <View
            key={hour}
            style={[
              styles.hourRow,
              {
                borderBottomColor: colors.border,
                minHeight: expandedRows.has(String(hour))
                  ? Math.max(
                      48,
                      ...dates.map(
                        (date) =>
                          (eventsByDate[date] ?? []).filter(
                            (event) =>
                              event.time &&
                              Number(event.time.slice(0, 2)) === hour,
                          ).length *
                            18 +
                          8,
                      ),
                    )
                  : 48,
              },
            ]}
          >
            <Pressable
              onPress={() => toggleRow(String(hour))}
              style={styles.rowLabelButton}
            >
              <Text style={[styles.hourLabel, { color: colors.muted }]}>
                {formatHour(hour, state.settings.timeFormat)}
              </Text>
              <Ionicons
                name={
                  expandedRows.has(String(hour))
                    ? "chevron-up"
                    : "chevron-down"
                }
                size={9}
                color={colors.faint}
              />
            </Pressable>
            {dates.map((date) => (
              <ScheduleCell
                key={date}
                events={(eventsByDate[date] ?? []).filter(
                  (event) =>
                    event.time &&
                    Number(event.time.slice(0, 2)) === hour,
                )}
                date={date}
                editing={editing}
                expanded={expandedRows.has(String(hour))}
                onExpand={() => toggleRow(String(hour))}
                onOpen={openEvent}
                onCreate={(date) =>
                  createInSlot(
                    date,
                    `${String(hour).padStart(2, "0")}:00`,
                  )
                }
              />
            ))}
          </View>
        ))}
      </Card>
      </Pressable>
      {draftFilter ? (
        <ScheduleViewEditor
          visible={filterEditorOpen}
          draft={draftFilter}
          metrics={logMetrics}
          canDelete={storedFilters.some((item) => item.id === draftFilter.id)}
          onChange={setDraftFilter}
          onClose={() => setFilterEditorOpen(false)}
          onDelete={() => deleteScheduleView(draftFilter.id)}
          onSave={() => saveScheduleView(draftFilter)}
        />
      ) : null}
    </Screen>
    </View>
    </GestureDetector>
  );
}

export default SchedulePage;

function ScheduleViewEditor({
  visible,
  draft,
  metrics,
  canDelete,
  onChange,
  onClose,
  onDelete,
  onSave,
}: {
  visible: boolean;
  draft: ScheduleViewFilter;
  metrics: MetricDefinition[];
  canDelete: boolean;
  onChange: (filter: ScheduleViewFilter) => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language } = useLocalization();
  const toggleMetric = (metricId: string) =>
    onChange({
      ...draft,
      logMetricIds: draft.logMetricIds.includes(metricId)
        ? draft.logMetricIds.filter((id) => id !== metricId)
        : [...draft.logMetricIds, metricId],
    });
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.filterBackdrop} onPress={onClose}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.filterSheet, { backgroundColor: colors.card }]}
        >
          <View style={styles.filterHeader}>
            <View style={styles.filterManageCopy}>
              <Text style={[styles.filterSheetTitle, { color: colors.ink }]}>Schedule view</Text>
              <Text style={[styles.filterManageMeta, { color: colors.muted }]}>Only selected tracker logs become timeline blocks.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.filterClose}>
              <Ionicons name="close" size={19} color={colors.muted} />
            </Pressable>
          </View>
          <TextInput
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder="View name"
            placeholderTextColor={colors.faint}
            style={[
              styles.filterNameInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <View style={styles.filterKinds}>
            {[
              {
                key: "includeTodos" as const,
                label: "To-dos",
                icon: "checkbox-outline" as const,
              },
              {
                key: "includeReminders" as const,
                label: "Reminders",
                icon: "notifications-outline" as const,
              },
            ].map((item) => {
              const selected = draft[item.key];
              return (
                <Pressable
                  key={item.key}
                  onPress={() =>
                    onChange({ ...draft, [item.key]: !selected })
                  }
                  style={[
                    styles.filterKind,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected
                        ? colors.primarySoft
                        : colors.canvas,
                    },
                  ]}
                >
                  <Ionicons name={item.icon} size={16} color={selected ? accent : colors.muted} />
                  <Text style={[styles.filterKindText, { color: colors.ink }]}>{item.label}</Text>
                  <Ionicons name={selected ? "checkbox" : "square-outline"} size={17} color={selected ? accent : colors.faint} />
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.filterSectionTitle, { color: colors.ink }]}>Logged tracker blocks</Text>
          <Text style={[styles.filterManageMeta, { color: colors.muted }]}>Choose useful, time-specific logs. Daily totals and calculated balances stay out.</Text>
          <ScrollView
            style={styles.filterList}
            contentContainerStyle={styles.filterListContent}
            nestedScrollEnabled
          >
            {metrics.map((metric) => {
              const selected = draft.logMetricIds.includes(metric.id);
              return (
                <Pressable
                  key={metric.id}
                  onPress={() => toggleMetric(metric.id)}
                  style={[styles.filterMetric, { borderColor: colors.border }]}
                >
                  <View style={[styles.filterMetricIcon, { backgroundColor: `${metric.color}18` }]}>
                    <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={16} color={metric.color} />
                  </View>
                  <View style={styles.filterManageCopy}>
                    <Text translate={false} style={[styles.filterMetricName, { color: colors.ink }]}>{localizeMetricName(language, metric)}</Text>
                    <Text style={[styles.filterManageMeta, { color: colors.muted }]}>{trackerGroupLabel(metric)}</Text>
                  </View>
                  <Ionicons name={selected ? "checkbox" : "square-outline"} size={19} color={selected ? accent : colors.faint} />
                </Pressable>
              );
            })}
            {!metrics.length ? (
              <Text style={[styles.filterEmpty, { color: colors.muted }]}>No useful logged trackers are available yet.</Text>
            ) : null}
          </ScrollView>
          <View style={styles.filterActions}>
            {canDelete ? (
              <Pressable onPress={onDelete} style={[styles.filterDelete, { borderColor: palette.red }]}>
                <Ionicons name="trash-outline" size={16} color={palette.red} />
              </Pressable>
            ) : null}
            <Pressable onPress={onSave} style={[styles.filterSave, { backgroundColor: accent }]}>
              <Text preserveColor style={styles.filterSaveText}>Save view</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ScheduleCell({
  events,
  date,
  editing,
  expanded,
  onExpand,
  onOpen,
  onCreate,
}: {
  events: ScheduleEvent[];
  date: string;
  editing: boolean;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (event: ScheduleEvent, date: string) => void;
  onCreate: (date: string) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const lastTap = useRef(0);
  const cellLongPress = useRef(false);
  const eventLongPress = useRef(false);
  const eventTap = useRef<{ id: string; at: number } | undefined>(undefined);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const durationEvents = events.filter((event) => event.durationMinutes);
  const pointEvents = events.filter((event) => !event.durationMinutes);
  const pressEvent = (event: ScheduleEvent) => {
    const now = Date.now();
    if (
      eventTap.current?.id === event.id &&
      now - eventTap.current.at < 320
    ) {
      if (eventTimer.current) clearTimeout(eventTimer.current);
      eventTap.current = undefined;
      onCreate(date);
      return;
    }
    eventTap.current = { id: event.id, at: now };
    if (eventTimer.current) clearTimeout(eventTimer.current);
    eventTimer.current = setTimeout(() => {
      eventTap.current = undefined;
      onOpen(event, date);
    }, 325);
  };
  return (
    <Pressable
      delayLongPress={380}
      onLongPress={() => {
        cellLongPress.current = true;
        onCreate(date);
      }}
      onPress={() => {
        if (cellLongPress.current) {
          cellLongPress.current = false;
          return;
        }
        const now = Date.now();
        if (now - lastTap.current < 320) {
          lastTap.current = 0;
          onCreate(date);
        } else {
          lastTap.current = now;
        }
      }}
      style={[styles.cell, { borderLeftColor: colors.border }]}
    >
      {durationEvents.slice(0, expanded ? durationEvents.length : 1).map((event, index) => {
        const color = event.color ?? accent;
        const minuteOffset = Number(event.time?.slice(3, 5) ?? 0) / 60 * 48;
        return (
          <Pressable
            key={event.id}
            onPress={() => pressEvent(event)}
            style={[
              styles.event,
              styles.durationEvent,
              {
                top: 2 + minuteOffset + index * 3,
                height: Math.max(18, Math.min(48 * 4, (event.durationMinutes ?? 1) * 0.8)),
                backgroundColor: `${color}35`,
                borderColor: color,
              },
            ]}
          >
            <Text
              numberOfLines={expanded ? undefined : 3}
              ellipsizeMode="clip"
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={[styles.eventText, { color }]}
            >
              {event.title}
            </Text>
          </Pressable>
        );
      })}
      {pointEvents.slice(0, expanded ? pointEvents.length : 2).map((event) => {
        const color =
          event.kind === "todo"
            ? event.skipped
              ? "#E58AA9"
              : event.completed
              ? palette.lime
              : event.overdue
                ? palette.red
              : "#E58A3B"
            : event.completed
              ? palette.lime
              : event.failed
                ? palette.red
                : event.color ?? (event.kind === "tracker" ? accent : "#7B61C8");
        return (
          <Pressable
            key={event.id}
            delayLongPress={380}
            onPress={() => {
              if (eventLongPress.current) {
                eventLongPress.current = false;
                return;
              }
              pressEvent(event);
            }}
            onLongPress={() => {
              eventLongPress.current = true;
              if (eventTimer.current) clearTimeout(eventTimer.current);
              eventTap.current = undefined;
              onCreate(date);
            }}
            style={[
              styles.event,
              durationEvents.length > 0 ? styles.eventBesideDuration : undefined,
              { backgroundColor: `${color}24` },
            ]}
          >
            <Text
              numberOfLines={expanded ? undefined : 2}
              ellipsizeMode="clip"
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={[
                styles.eventText,
                { color },
                (event.completed || event.skipped) && styles.complete,
              ]}
            >
              {editing ? "− " : ""}
              {event.title}
            </Text>
          </Pressable>
        );
      })}
      {pointEvents.length > 2 || durationEvents.length > 1 ? (
        <Pressable onPress={onExpand}>
          <Text style={[styles.more, { color: colors.muted }]}>
            {expanded ? "Collapse" : `+${Math.max(1, events.length - 3)}`}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function formatHour(hour: number, format: "12h" | "24h" | undefined) {
  if (format !== "12h") return String(hour).padStart(2, "0");
  const normalized = hour % 12 || 12;
  return `${normalized}${hour >= 12 ? "p" : "a"}`;
}

const styles = StyleSheet.create({
  pageGesture: { flex: 1 },
  page: { paddingBottom: 18 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  helpButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  editButton: {
    width: 34,
    height: 32,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionText: { fontSize: 8, fontWeight: "900" },
  weekNav: {
    minHeight: 52,
    padding: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  navButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  navCopy: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  weekTitle: { fontSize: 11, fontWeight: "900" },
  quickActions: { flexDirection: "row", gap: 6, marginVertical: 7 },
  scheduleSettings: {
    minHeight: 46,
    gap: 8,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingLabel: { fontSize: 8, fontWeight: "900" },
  startHours: { flex: 1, flexDirection: "row", gap: 4 },
  filterManageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  filterManage: {
    flex: 1,
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  filterManageCopy: { flex: 1, minWidth: 0 },
  filterManageTitle: { fontSize: 9, fontWeight: "900" },
  filterManageMeta: { fontSize: 7, lineHeight: 9, fontWeight: "700" },
  newFilterButton: {
    width: 39,
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  hourChoice: {
    flex: 1,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  quick: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  gridCard: { padding: 0, overflow: "hidden" },
  headerRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  hourHeader: { width: 31 },
  dayHeader: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dayName: { fontSize: 6, fontWeight: "900", textTransform: "uppercase" },
  dayNumberWrap: {
    width: 24,
    height: 24,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: { fontSize: 8, fontWeight: "900" },
  allDayRow: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  allDayLabel: {
    fontSize: 6,
    fontWeight: "900",
    textAlign: "center",
  },
  rowLabelButton: {
    width: 31,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 5,
    gap: 2,
  },
  hourRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  hourLabel: {
    fontSize: 6,
    fontWeight: "800",
    textAlign: "center",
  },
  cell: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    padding: 2,
    gap: 2,
    position: "relative",
  },
  event: { borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2 },
  durationEvent: {
    position: "absolute",
    left: 2,
    width: "56%",
    borderLeftWidth: 2,
    zIndex: 4,
  },
  eventBesideDuration: { marginLeft: "58%" },
  eventText: { fontSize: 5.5, lineHeight: 7, fontWeight: "900" },
  complete: { textDecorationLine: "line-through", opacity: 0.62 },
  more: { fontSize: 5.5, fontWeight: "900", textAlign: "center" },
  filterBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.46)",
    justifyContent: "flex-end",
    padding: 12,
  },
  filterSheet: {
    maxHeight: "86%",
    borderRadius: 21,
    padding: 14,
    gap: 8,
  },
  filterHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterSheetTitle: { fontSize: 14, fontWeight: "900" },
  filterClose: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  filterNameInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 10,
    fontWeight: "800",
  },
  filterKinds: { flexDirection: "row", gap: 6 },
  filterKind: {
    flex: 1,
    minHeight: 39,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterKindText: { flex: 1, fontSize: 8, fontWeight: "900" },
  filterSectionTitle: { fontSize: 10, fontWeight: "900", marginTop: 2 },
  filterList: { flexGrow: 0 },
  filterListContent: { paddingBottom: 2 },
  filterMetric: {
    minHeight: 46,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 3,
  },
  filterMetricIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  filterMetricName: { fontSize: 9, fontWeight: "800" },
  filterEmpty: { paddingVertical: 16, textAlign: "center", fontSize: 8 },
  filterActions: { flexDirection: "row", gap: 7 },
  filterDelete: {
    width: 43,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  filterSave: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  filterSaveText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
});
