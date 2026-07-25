import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { scheduleEventsForDate } from "@/src/domain/calendar";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

const kindIcons = {
  todo: "checkbox-outline",
  tracker: "flag-outline",
  reminder: "notifications-outline",
} as const;

export default function SchedulePage() {
  const { state, toggleTodo } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const events = useMemo(
    () => scheduleEventsForDate(state, selectedDate),
    [selectedDate, state],
  );
  return (
    <Screen>
      <PageHeader title="Schedule" />
      <Card style={styles.calendar}>
        <MonthCalendar
          monthDate={selectedDate}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
          hasActivity={(date) => scheduleEventsForDate(state, date).length > 0}
          dayVisuals={(date) => {
            const count = scheduleEventsForDate(state, date).length;
            return count
              ? [
                  {
                    color: accent,
                    progress: Math.min(1, count / 3),
                    goalReached: false,
                  },
                ]
              : [];
          }}
        />
      </Card>
      <View style={styles.heading}>
        <View>
          <Text style={[styles.title, { color: colors.ink }]}>
            {friendlyDate(selectedDate)}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {events.length} scheduled item{events.length === 1 ? "" : "s"}
          </Text>
        </View>
        <View style={styles.quickActions}>
          <Pressable
            onPress={() => router.navigate("/todo-editor" as never)}
            style={[styles.quick, { borderColor: accent }]}
          >
            <Ionicons name="checkbox-outline" size={14} color={accent} />
            <Text style={[styles.quickText, { color: accent }]}>To-do</Text>
          </Pressable>
          <Pressable
            onPress={() => router.navigate("/reminder-editor" as never)}
            style={[styles.quick, { borderColor: accent }]}
          >
            <Ionicons name="notifications-outline" size={14} color={accent} />
            <Text style={[styles.quickText, { color: accent }]}>Reminder</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.events}>
        {events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => {
              if (event.kind === "todo" && event.todoId)
                router.navigate({
                  pathname: "/todo-editor",
                  params: { id: event.todoId },
                } as never);
              else if (event.metricId)
                router.navigate({
                  pathname: "/metric-editor",
                  params: { id: event.metricId, focus: "notifications" },
                } as never);
            }}
            style={[
              styles.event,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {event.kind === "todo" && event.todoId ? (
              <Pressable
                onPress={() => toggleTodo(event.todoId!, selectedDate)}
                hitSlop={8}
              >
                <Ionicons
                  name={
                    event.completed
                      ? "checkmark-circle"
                      : "ellipse-outline"
                  }
                  size={20}
                  color={event.completed ? "#B8E45C" : accent}
                />
              </Pressable>
            ) : (
              <Ionicons
                name={kindIcons[event.kind]}
                size={19}
                color={accent}
              />
            )}
            <View style={styles.copy}>
              <Text
                style={[
                  styles.eventName,
                  { color: colors.ink },
                  event.completed && styles.complete,
                ]}
              >
                {event.title}
              </Text>
              <Text style={[styles.eventMeta, { color: colors.muted }]}>
                {event.time ?? "Any time"} · {event.kind}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.faint} />
          </Pressable>
        ))}
        {!events.length ? (
          <Card>
            <Text style={[styles.empty, { color: colors.muted }]}>
              Nothing scheduled for this date.
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  calendar: { marginBottom: 9 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { fontSize: 13, fontWeight: "900" },
  meta: { fontSize: 8, marginTop: 2 },
  quickActions: { flexDirection: "row", gap: 5 },
  quick: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  quickText: { fontSize: 8, fontWeight: "900" },
  events: { gap: 6 },
  event: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  copy: { flex: 1 },
  eventName: { fontSize: 10, fontWeight: "900" },
  eventMeta: { fontSize: 7, fontWeight: "700", marginTop: 2 },
  complete: { textDecorationLine: "line-through", opacity: 0.58 },
  empty: { textAlign: "center", fontSize: 9, fontWeight: "700" },
});
