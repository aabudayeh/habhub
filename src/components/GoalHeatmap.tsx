import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  effectiveGoalTarget,
  goalProgress,
  hasMetricData,
  isMetricTrackedOnDate,
  metricPeriodStats,
  safeMetricValue,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import { useAppColors } from "@/src/theme";
import { AppState, HistoryRange, MetricDefinition } from "@/src/types";

const NOT_LOGGED = "#F59E0B";

function alpha(color: string, opacity: number) {
  const normalized = color.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return color;
  return `#${normalized}${Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function GoalHeatmap({
  state,
  metric,
  dates,
  range,
  compact = false,
  onSelect,
}: {
  state: AppState;
  metric: MetricDefinition;
  dates: string[];
  range: HistoryRange;
  compact?: boolean;
  onSelect?: (date: string) => void;
}) {
  const colors = useAppColors();
  const today = new Date().toISOString().slice(0, 10);
  const weekStartsOn = state.settings.weekStartsOn ?? 1;
  const firstDate = dates[0];
  const firstWeekday = firstDate
    ? new Date(`${firstDate}T12:00:00`).getDay()
    : weekStartsOn;
  const leading =
    range === "week" ? 0 : (firstWeekday - weekStartsOn + 7) % 7;
  const cells = useMemo(
    () => [
      ...Array.from({ length: leading }, () => null),
      ...dates,
    ],
    [dates, leading],
  );
  const period = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    dates.filter((date) => date <= today),
  );
  const completion = period.applicableDates.length
    ? Math.round(
        (period.goalsReached / period.applicableDates.length) * 100,
      )
    : 0;
  const cellSize =
    range === "year" ? (compact ? 4 : 5) : compact ? 13 : 20;
  const gap = range === "year" ? 1 : compact ? 3 : 5;

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.grid,
          range === "year" && {
            height: cellSize * 7 + gap * 6,
            flexDirection: "column",
            alignContent: "flex-start",
          },
        ]}
      >
        {cells.map((date, index) => {
          if (!date)
            return (
              <View
                key={`empty-${index}`}
                style={{ width: cellSize, height: cellSize, margin: gap / 2 }}
              />
            );
          const future = date > today;
          const logged =
            !future && hasMetricData(state, metric, state.currentUserId, date);
          const tracked =
            !future && isMetricTrackedOnDate(state, metric, date);
          const reached =
            logged &&
            scheduledGoalReached(state, metric, state.currentUserId, date);
          const value = logged
            ? safeMetricValue(state, metric, state.currentUserId, date)
            : 0;
          const progress = logged
            ? goalProgress(
                metric,
                value,
                effectiveGoalTarget(
                  state,
                  metric,
                  state.currentUserId,
                  date,
                ),
              )
            : 0;
          const backgroundColor = future
            ? colors.canvas
            : reached
              ? progress > 1.75
                ? "#5D9C22"
                : progress > 1.15
                  ? "#86C53E"
                  : GOAL_COMPLETE_COLOR
              : tracked && !logged
                ? alpha(NOT_LOGGED, 0.72)
                : logged
                  ? alpha(metric.color, 0.22 + Math.min(progress, 1) * 0.7)
                  : colors.border;
          return (
            <Pressable
              key={date}
              accessibilityLabel={`${metric.name}, ${date}${
                reached
                  ? ", goal met"
                  : tracked && !logged
                    ? ", not logged"
                    : ""
              }`}
              disabled={!onSelect}
              onPress={() => onSelect?.(date)}
              style={{
                width: cellSize,
                height: cellSize,
                margin: gap / 2,
                borderRadius: range === "year" ? 1.5 : 4,
                backgroundColor,
                borderWidth: date === today ? 1 : 0,
                borderColor: colors.ink,
              }}
            />
          );
        })}
      </View>
      {!compact ? (
        <View style={styles.caption}>
          <Text style={[styles.captionText, { color: colors.muted }]}>
            {period.loggedDates.length} logged
          </Text>
          <Text style={[styles.captionText, { color: colors.ink }]}>
            {completion}% complete
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 5 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  caption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  captionText: { fontSize: 8, fontWeight: "800" },
});
