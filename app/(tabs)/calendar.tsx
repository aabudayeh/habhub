import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { InfoPopover } from "@/src/components/InfoPopover";
import { scheduleEventsForDate, ScheduleEvent } from "@/src/domain/calendar";
import {
  calendarWeekRange,
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
} from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default function SchedulePage() {
  const {
    state,
    deleteTodo,
    deleteCalendarReminder,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [anchor, setAnchor] = useState(dateKey());
  const [editing, setEditing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
  const eventsByDate = useMemo(
    () =>
      Object.fromEntries(
        dates.map((date) => [date, scheduleEventsForDate(state, date)]),
      ) as Record<string, ScheduleEvent[]>,
    [dates, state],
  );
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

  const weekLabel = `${friendlyDate(dates[0])} – ${friendlyDate(
    dates[dates.length - 1],
  )}`;
  return (
    <Screen contentContainerStyle={styles.page}>
      <PageHeader
        title="Schedule"
        tutorialId="schedule-header"
        action={
          <View style={styles.headerActions}>
            <InfoPopover
              label="Explain Schedule"
              message="Tap an item to edit it. Double-tap or hold any slot to add another to-do or reminder. Tap a row label to reveal crowded rows, and hold the calendar background to enter edit mode."
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
          hasActivity={(date) => scheduleEventsForDate(state, date).length > 0}
        />
      ) : null}
      {editing ? (
        <Card style={styles.scheduleSettings}>
          <Text style={[styles.settingLabel, { color: colors.muted }]}>
            First hour
          </Text>
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
                  {new Intl.DateTimeFormat(undefined, { weekday: "short" })
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
    </Screen>
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
      {events.slice(0, expanded ? events.length : 2).map((event) => {
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
            style={[styles.event, { backgroundColor: `${color}24` }]}
          >
            <Text
              numberOfLines={2}
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
      {events.length > 2 ? (
        <Pressable onPress={onExpand}>
          <Text style={[styles.more, { color: colors.muted }]}>
            {expanded ? "Collapse" : `+${events.length - 2}`}
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingLabel: { fontSize: 8, fontWeight: "900" },
  startHours: { flex: 1, flexDirection: "row", gap: 4 },
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
  },
  event: { borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2 },
  eventText: { fontSize: 5.5, lineHeight: 7, fontWeight: "900" },
  complete: { textDecorationLine: "line-through", opacity: 0.62 },
  more: { fontSize: 5.5, fontWeight: "900", textAlign: "center" },
});
