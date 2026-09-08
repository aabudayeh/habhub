import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { Card } from "@/src/components/ui";
import { scheduleEventsForHourSlot } from "@/src/domain/calendar";
import {
  calendarWeekRange,
  dateKey,
  dateWithOffsetFrom,
  formatClockTime,
} from "@/src/domain/date";
import type { GroupCalendarEvent } from "@/src/domain/groupSchedule";
import { useLocale, useTranslation } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type CalendarView = "week" | "day" | "month";

/** Shares MonthCalendar, week boundaries and duration-slot logic with Schedule. */
export function GroupScheduleCalendar({
  anchor,
  onSelectDate,
  eventsByDate,
  onOpenSlot,
  onCreate,
}: {
  anchor: string;
  onSelectDate: (date: string) => void;
  eventsByDate: ReadonlyMap<string, GroupCalendarEvent[]>;
  onOpenSlot: (
    date: string,
    events: GroupCalendarEvent[],
    hour?: number,
  ) => void;
  onCreate: (date: string, hour?: number) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const t = useTranslation();
  const { state } = useApp();
  const { width } = useWindowDimensions();
  const [gridViewportWidth, setGridViewportWidth] = useState(0);
  const [view, setView] = useState<CalendarView>(width < 350 ? "day" : "week");
  const [monthOpen, setMonthOpen] = useState(false);
  const [filters, setFilters] = useState({
    event: true,
    task: true,
    reminder: true,
  });
  const week = useMemo(
    () => calendarWeekRange(anchor, state.settings.weekStartsOn ?? 1),
    [anchor, state.settings.weekStartsOn],
  );
  const dates = view === "week" ? week : [anchor];
  const firstHour = state.settings.scheduleStartHour ?? 7;
  const hours = Array.from({ length: 24 }, (_, i) => (firstHour + i) % 24);
  const eventsFor = (date: string) =>
    (eventsByDate.get(date) ?? []).filter((event) => filters[event.source]);
  const shortDate = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });
  const rangeLabel =
    view === "week"
      ? `${shortDate(week[0])} – ${shortDate(week[6])}`
      : shortDate(anchor);
  const shift = (direction: number) => {
    if (view !== "month")
      return onSelectDate(
        dateWithOffsetFrom(anchor, direction * (view === "week" ? 7 : 1)),
      );
    const next = new Date(`${anchor}T12:00:00`);
    next.setDate(1);
    next.setMonth(next.getMonth() + direction);
    onSelectDate(dateKey(next));
  };
  const renderCell = (
    date: string,
    events: GroupCalendarEvent[],
    hour?: number,
  ) => (
    <Pressable
      key={date}
      accessibilityRole="button"
      accessibilityLabel={t("{date}, {time}, {count} items").replace("{date}", shortDate(date)).replace("{time}", hour === undefined ? t("All items") : formatClockTime(`${String(hour).padStart(2, "0")}:00`, state.settings.timeFormat, locale)).replace("{count}", String(events.length))}
      accessibilityHint={t("Open this slot; long press to add a group event")}
      onPress={() => onOpenSlot(date, events, hour)}
      onLongPress={() => onCreate(date, hour)}
      style={[styles.cell, { borderLeftColor: colors.border }]}
    >
      {events.slice(0, 2).map((event) => {
        const color =
          event.source === "task"
            ? "#C7782C"
            : event.source === "reminder"
              ? "#8E66C5"
              : accent;
        return (
          <View
            key={event.id}
            style={[styles.event, { backgroundColor: `${color}1F` }]}
          >
            <Text
              translate={false}
              numberOfLines={view === "day" ? 2 : 3}
              style={[
                styles.eventText,
                view === "day" && styles.dayEventText,
                { color: colors.ink },
                event.completed && styles.completed,
              ]}
            >
              {event.title}
            </Text>
          </View>
        );
      })}
      {events.length > 2 ? (
        <Text
          style={[styles.more, { color: colors.muted }]}
        >{`+${events.length - 2}`}</Text>
      ) : null}
      {view === "day" && !events.length ? (
        <Ionicons
          name="add"
          size={15}
          color={colors.faint}
          style={styles.emptyPlus}
        />
      ) : null}
    </Pressable>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View
          style={[
            styles.segments,
            { backgroundColor: colors.canvas, borderColor: colors.border },
          ]}
        >
          {(["week", "day", "month"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={option === "week" ? t("Week calendar view") : option === "day" ? t("Day calendar view") : t("Month calendar view")}
              accessibilityState={{ selected: option === view }}
              onPress={() => {
                setView(option);
                setMonthOpen(false);
              }}
              style={[
                styles.segment,
                option === view && { backgroundColor: colors.card },
              ]}
            >
              <Text
                style={[
                  styles.controlText,
                  { color: view === option ? colors.ink : colors.muted },
                ]}
              >
                {option === "week"
                  ? "Week"
                  : option === "day"
                    ? "Day"
                    : "Month"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelectDate(dateKey())}
          style={[styles.today, { borderColor: colors.border }]}
        >
          <Text style={[styles.controlText, { color: colors.ink }]}>Today</Text>
        </Pressable>
      </View>
      {view !== "month" ? (
        <Card style={styles.weekNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              view === "week" ? t("Previous week") : t("Previous day")
            }
            onPress={() => shift(-1)}
            style={styles.navButton}
          >
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Choose a calendar date")}
            accessibilityState={{ expanded: monthOpen }}
            onPress={() => setMonthOpen(!monthOpen)}
            style={styles.navCopy}
          >
            <Text
              translate={false}
              style={[styles.weekTitle, { color: colors.ink }]}
            >
              {rangeLabel}
            </Text>
            <Ionicons
              name={monthOpen ? "chevron-up" : "chevron-down"}
              size={15}
              color={colors.muted}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={view === "week" ? t("Next week") : t("Next day")}
            onPress={() => shift(1)}
            style={styles.navButton}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.ink} />
          </Pressable>
        </Card>
      ) : null}
      {monthOpen || view === "month" ? (
        <Card>
          <MonthCalendar
            monthDate={anchor}
            selectedDate={anchor}
            onMonthChange={onSelectDate}
            onSelect={(date) => {
              onSelectDate(date);
              setMonthOpen(false);
            }}
            hasActivity={(date) => eventsFor(date).length > 0}
          />
        </Card>
      ) : null}
      <View style={styles.filters}>
        {(
          [
            { id: "event", title: "Events", icon: "calendar-outline" },
            { id: "task", title: "To-dos", icon: "checkbox-outline" },
            {
              id: "reminder",
              title: "Reminders",
              icon: "notifications-outline",
            },
          ] as const
        ).map((filter) => (
          <Pressable
            key={filter.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: filters[filter.id] }}
            onPress={() =>
              setFilters((current) => ({
                ...current,
                [filter.id]: !current[filter.id],
              }))
            }
            style={[
              styles.filter,
              {
                borderColor: filters[filter.id] ? accent : colors.border,
                backgroundColor: filters[filter.id]
                  ? `${accent}12`
                  : colors.card,
              },
            ]}
          >
            <Ionicons
              name={filter.icon}
              size={14}
              color={filters[filter.id] ? accent : colors.muted}
            />
            <Text
              style={[
                styles.filterText,
                { color: filters[filter.id] ? colors.ink : colors.muted },
              ]}
            >
              {filter.title}
            </Text>
          </Pressable>
        ))}
      </View>
      {view === "month" ? (
        <Card style={styles.agenda}>
          <View style={styles.agendaHeader}>
            <Text
              translate={false}
              style={[styles.weekTitle, { color: colors.ink }]}
            >
              {shortDate(anchor)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Add group event on selected date")}
              onPress={() => onCreate(anchor)}
              style={styles.navButton}
            >
              <Ionicons name="add" size={21} color={accent} />
            </Pressable>
          </View>
          {eventsFor(anchor).map((event) => (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              onPress={() => onOpenSlot(anchor, [event])}
              style={[styles.agendaItem, { borderTopColor: colors.border }]}
            >
              <Ionicons
                name={
                  event.source === "event"
                    ? "calendar-outline"
                    : event.source === "task"
                      ? "checkbox-outline"
                      : "notifications-outline"
                }
                color={accent}
                size={18}
              />
              <Text
                translate={false}
                style={[styles.agendaTitle, { color: colors.ink }]}
              >
                {event.title}
              </Text>
              <Text
                translate={false}
                style={[styles.agendaTime, { color: colors.muted }]}
              >
                {event.time
                  ? formatClockTime(
                      event.time,
                      state.settings.timeFormat,
                      locale,
                    )
                  : t("All day")}
              </Text>
            </Pressable>
          ))}
          {!eventsFor(anchor).length ? (
            <Pressable
              onPress={() => onCreate(anchor)}
              style={styles.emptyAgenda}
            >
              <Text style={{ color: colors.muted }}>
                Nothing planned. Add a group event.
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ) : (
        <Card style={styles.gridCard}>
          <ScrollView
            horizontal
            onLayout={(event) => setGridViewportWidth(event.nativeEvent.layout.width)}
            contentContainerStyle={[styles.gridScroller, { width: Math.max(view === "week" ? 350 : 100, gridViewportWidth) }]}
            showsHorizontalScrollIndicator={view === "week" && gridViewportWidth < 350}
          >
            <View style={[styles.grid, view === "week" && styles.weekGrid]}>
              <View
                style={[styles.headerRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.hourLabelBox} />
                {dates.map((date) => {
                  const today = date === dateKey();
                  return (
                    <Pressable
                      key={date}
                      accessibilityRole="button"
                      accessibilityLabel={t("Show {date}").replace("{date}", shortDate(date))}
                      onPress={() => {
                        onSelectDate(date);
                        setView("day");
                      }}
                      style={styles.dayHeader}
                    >
                      <Text
                        translate={false}
                        style={[styles.dayName, { color: colors.muted }]}
                      >
                        {new Date(`${date}T12:00:00`).toLocaleDateString(
                          locale,
                          { weekday: "short" },
                        )}
                      </Text>
                      <View
                        style={[
                          styles.dayBadge,
                          today && { backgroundColor: accent },
                        ]}
                      >
                        <Text
                          translate={false}
                          style={[
                            styles.dayNumber,
                            { color: today ? "#FFFFFF" : colors.ink },
                          ]}
                        >
                          {new Date(`${date}T12:00:00`).getDate()}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View
                style={[styles.hourRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.hourLabelBox}>
                  <Text style={[styles.hourText, { color: colors.muted }]}>
                    ALL
                  </Text>
                </View>
                {dates.map((date) => renderCell(date, eventsFor(date)))}
              </View>
              {hours.map((hour) => (
                <View
                  key={hour}
                  style={[styles.hourRow, { borderBottomColor: colors.border }]}
                >
                  <View style={styles.hourLabelBox}>
                    <Text
                      translate={false}
                      style={[styles.hourText, { color: colors.muted }]}
                    >
                      {state.settings.timeFormat === "12h"
                        ? `${hour % 12 || 12}${hour >= 12 ? "p" : "a"}`
                        : String(hour).padStart(2, "0")}
                    </Text>
                  </View>
                  {dates.map((date) =>
                    renderCell(
                      date,
                      scheduleEventsForHourSlot(
                        eventsFor(date),
                        hour,
                      ) as GroupCalendarEvent[],
                      hour,
                    ),
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}
      <Text style={[styles.hint, { color: colors.muted }]}>
        Tap a slot to see its items. Hold an empty slot to plan something
        together.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  toolbar: { flexDirection: "row", gap: 8 },
  segments: {
    flex: 1,
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 13,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  today: {
    minWidth: 60,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  controlText: { fontSize: 12, fontWeight: "700" },
  weekNav: {
    minHeight: 52,
    padding: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  navCopy: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  weekTitle: { fontSize: 12, fontWeight: "900" },
  filters: { flexDirection: "row", gap: 6 },
  filter: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterText: { fontSize: 11, fontWeight: "700" },
  gridCard: { padding: 0, overflow: "hidden" },
  gridScroller: { flexGrow: 1 },
  grid: { flex: 1 },
  weekGrid: { minWidth: 350 },
  headerRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  dayHeader: {
    flex: 1,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dayName: { fontSize: 8, fontWeight: "900" },
  dayBadge: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: { fontSize: 10, fontWeight: "900" },
  hourRow: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  hourLabelBox: {
    width: 34,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 8,
  },
  hourText: { fontSize: 8, fontWeight: "800" },
  cell: {
    flex: 1,
    minWidth: 44,
    minHeight: 52,
    borderLeftWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  event: { borderRadius: 5, paddingHorizontal: 3, paddingVertical: 3 },
  eventText: { fontSize: 7, lineHeight: 10, fontWeight: "900" },
  dayEventText: { fontSize: 11, lineHeight: 16 },
  completed: { textDecorationLine: "line-through", opacity: 0.7 },
  more: { fontSize: 8, fontWeight: "900", textAlign: "center" },
  emptyPlus: { alignSelf: "center", marginTop: 12 },
  hint: { fontSize: 11, lineHeight: 16 },
  agenda: { padding: 12 },
  agendaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  agendaItem: {
    minHeight: 54,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  agendaTitle: { flex: 1, fontSize: 11, fontWeight: "800" },
  agendaTime: { fontSize: 9, fontWeight: "700" },
  emptyAgenda: {
    minHeight: 80,
    justifyContent: "center",
    alignItems: "center",
  },
});
