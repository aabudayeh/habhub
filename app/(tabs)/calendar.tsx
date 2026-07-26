import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

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

  const weekLabel = `${friendlyDate(dates[0])} – ${friendlyDate(
    dates[dates.length - 1],
  )}`;
  return (
    <Screen contentContainerStyle={styles.page}>
      <PageHeader
        title="Schedule"
        action={
          <View style={styles.headerActions}>
            <InfoPopover
              label="Explain Schedule"
              message="Tap an item to edit it, hold the calendar to enter edit mode, double-tap an empty cell to create a dated to-do, tap a crowded cell's count to expand it, and tap the date range to jump through the month."
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
              <Text style={[styles.actionText, { color: accent }]}>
                {editing ? "Done" : "Edit"}
              </Text>
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
          <Text style={[styles.weekMeta, { color: colors.muted }]}>
            Tap to choose a week
          </Text>
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
        <View style={[styles.allDayRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.allDayLabel, { color: colors.muted }]}>ALL</Text>
          {dates.map((date) => (
            <ScheduleCell
              key={date}
              events={(eventsByDate[date] ?? []).filter(
                (event) => !event.time,
              )}
              date={date}
              editing={editing}
              onOpen={openEvent}
              onCreate={(date) =>
                router.navigate({
                  pathname: "/todo-editor",
                  params: { date },
                } as never)
              }
            />
          ))}
        </View>
        {hours.map((hour) => (
          <View
            key={hour}
            style={[styles.hourRow, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.hourLabel, { color: colors.muted }]}>
              {formatHour(hour, state.settings.timeFormat)}
            </Text>
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
                onOpen={openEvent}
                onCreate={(date) =>
                  router.navigate({
                    pathname: "/todo-editor",
                    params: {
                      date,
                      time: `${String(hour).padStart(2, "0")}:00`,
                    },
                  } as never)
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
  onOpen,
  onCreate,
}: {
  events: ScheduleEvent[];
  date: string;
  editing: boolean;
  onOpen: (event: ScheduleEvent, date: string) => void;
  onCreate: (date: string) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [expanded, setExpanded] = useState(false);
  const lastTap = React.useRef(0);
  return (
    <Pressable
      onPress={() => {
        const now = Date.now();
        if (now - lastTap.current < 320) onCreate(date);
        lastTap.current = now;
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
            onPress={() => onOpen(event, date)}
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
        <Pressable onPress={() => setExpanded((value) => !value)}>
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
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
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
  navCopy: { flex: 1, alignItems: "center" },
  weekTitle: { fontSize: 11, fontWeight: "900" },
  weekMeta: { fontSize: 7, marginTop: 2 },
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
    width: 31,
    fontSize: 6,
    fontWeight: "900",
    textAlign: "center",
    paddingTop: 12,
  },
  hourRow: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  hourLabel: {
    width: 31,
    fontSize: 6,
    fontWeight: "800",
    textAlign: "center",
    paddingTop: 4,
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
