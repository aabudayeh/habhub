import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { dateKey } from "@/src/domain/date";
import { palette, useAppColors } from "@/src/theme";

export function MonthCalendar({
  selectedDate,
  onSelect,
  hasActivity,
  dayStatus,
  dayVisuals,
  allTrackedGoalsMet,
  monthDate,
  onMonthChange,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
  hasActivity?: (date: string) => boolean;
  dayStatus?: (date: string) => "met" | "partial" | "none";
  dayVisuals?: (
    date: string,
  ) => { color: string; progress: number; goalReached?: boolean }[];
  allTrackedGoalsMet?: (date: string) => boolean;
  monthDate?: string;
  onMonthChange?: (date: string) => void;
}) {
  const colors = useAppColors();
  const initial = new Date(`${monthDate ?? selectedDate}T12:00:00`);
  const [cursor, setCursor] = useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1, 12),
  );
  useEffect(() => {
    if (monthDate) {
      const next = new Date(`${monthDate}T12:00:00`);
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    }
  }, [monthDate]);
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return {
        key: dateKey(day),
        number: day.getDate(),
        current: day.getMonth() === cursor.getMonth(),
      };
    });
  }, [cursor]);
  const title = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(cursor);
  function shift(delta: number) {
    const next = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + delta,
      1,
      12,
    );
    setCursor(next);
    onMonthChange?.(dateKey(next));
  }
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 20,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 45) shiftRef.current(-1);
          if (gesture.dx < -45) shiftRef.current(1);
        },
      }),
    [],
  );
  return (
    <View {...swipe.panHandlers}>
      <View style={styles.heading}>
        <Pressable
          onPress={() => shift(-1)}
          style={[styles.arrow, { backgroundColor: colors.canvas }]}
        >
          <Ionicons name="chevron-back" size={19} color={colors.ink} />
        </Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Pressable
          onPress={() => shift(1)}
          style={[styles.arrow, { backgroundColor: colors.canvas }]}
        >
          <Ionicons name="chevron-forward" size={19} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <Text
            key={`${day}-${index}`}
            style={[styles.weekday, { color: colors.faint }]}
          >
            {day}
          </Text>
        ))}
        {days.map((day) => {
          const selected = day.key === selectedDate;
          const status = dayStatus?.(day.key);
          const visuals = dayVisuals?.(day.key) ?? [];
          const allTrackedMet = allTrackedGoalsMet?.(day.key) ?? false;
          return (
            <Pressable
              key={day.key}
              onPress={() => onSelect(day.key)}
              style={[
                styles.day,
                status === "met" && {
                  backgroundColor: colors.isDark ? "#26351E" : "#EDF7D5",
                },
                status === "partial" && { backgroundColor: colors.primarySoft },
                selected && {
                  borderWidth: 2,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  { color: colors.ink },
                  !day.current && { color: colors.faint },
                  selected && { color: colors.primary },
                ]}
              >
                {day.number}
              </Text>
              {visuals.length ? (
                <View style={styles.visuals}>
                  {visuals.slice(0, 5).map((visual, index) => (
                    <View
                      key={index}
                      style={[
                        styles.visualTrack,
                        { backgroundColor: colors.border },
                      ]}
                    >
                      <View
                        style={[
                          styles.visualFill,
                          {
                            backgroundColor: visual.color,
                            width: `${Math.min(Math.max(visual.progress, 0), 1) * 100}%`,
                          },
                        ]}
                      />
                      {visual.goalReached ? (
                        <View
                          style={[
                            styles.goalTick,
                            { borderColor: colors.card },
                          ]}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : hasActivity?.(day.key) || (status && status !== "none") ? (
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: colors.primary },
                    status === "met" && styles.metDot,
                    selected && styles.dotSelected,
                  ]}
                />
              ) : null}
              {allTrackedMet ? (
                <Ionicons
                  name="checkmark-circle"
                  size={12}
                  color="#9B6BDB"
                  style={styles.goalBadge}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: "14.285%",
    textAlign: "center",
    color: palette.faint,
    fontSize: 9,
    fontWeight: "900",
    paddingVertical: 7,
  },
  day: {
    width: "14.285%",
    aspectRatio: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 5,
    borderRadius: 12,
  },
  selected: { backgroundColor: palette.primary },
  dayText: { color: palette.ink, fontSize: 12, fontWeight: "800", zIndex: 1 },
  muted: { color: "#C1C9C3" },
  selectedText: { color: palette.white },
  dot: {
    position: "absolute",
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.primary,
  },
  dotSelected: { backgroundColor: palette.lime },
  metDay: { backgroundColor: "#EDF7D5" },
  partialDay: { backgroundColor: palette.primarySoft },
  metDot: { backgroundColor: "#79A52B" },
  visuals: { position: "absolute", left: 5, right: 5, bottom: 4, gap: 1 },
  visualTrack: {
    height: 2,
    borderRadius: 2,
    backgroundColor: "rgba(104,117,109,.16)",
    overflow: "hidden",
  },
  visualFill: { height: 2, borderRadius: 2 },
  goalTick: {
    position: "absolute",
    top: -5,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D8A126",
    borderWidth: 1.5,
    borderColor: palette.card,
  },
  goalBadge: { position: "absolute", top: 1, right: 1 },
});
