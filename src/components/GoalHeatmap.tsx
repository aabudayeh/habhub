import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  effectiveGoalTarget,
  hasMetricData,
  isMetricTrackedOnDate,
  metricPeriodStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
} from "@/src/domain/metrics";
import { useAppColors } from "@/src/theme";
import { AppState, HistoryRange, MetricDefinition } from "@/src/types";
import { isVacationDate, VACATION_COLOR } from "@/src/domain/vacation";

const NOT_LOGGED = "#9CA3AF";
const LOGGED_NO_GOAL = "#F59E0B";
const GOAL_MISSED_FAR = "#7F1D1D";
const GOAL_MISSED_NEAR = "#EF4444";

function alpha(color: string, opacity: number) {
  const normalized = color.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return color;
  return `#${normalized}${Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function TrackedGoalsHeatmap({
  state,
  dates,
  range,
  compact = false,
  onSelect,
}: {
  state: AppState;
  dates: string[];
  range: HistoryRange;
  compact?: boolean;
  onSelect?: (date: string) => void;
}) {
  const colors = useAppColors();
  const today = new Date().toISOString().slice(0, 10);
  const weekStartsOn = state.settings.weekStartsOn ?? 1;
  const firstWeekday = dates[0]
    ? new Date(`${dates[0]}T12:00:00`).getDay()
    : weekStartsOn;
  const leading =
    range === "week" ? 0 : (firstWeekday - weekStartsOn + 7) % 7;
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...dates,
  ];
  const [availableWidth, setAvailableWidth] = useState(0);
  const gap = range === "year" ? 1 : compact ? 4 : 5;
  const yearColumns = Math.ceil(cells.length / 7);
  const layoutWidth = availableWidth || 300;
  const yearCellWidth = Math.max(
    2,
    Math.floor(
      ((layoutWidth - yearColumns * gap) / Math.max(1, yearColumns)) * 100,
    ) / 100,
  );
  const cellWidth =
    range === "year"
      ? yearCellWidth
      : range === "week"
        ? Math.max(
            28,
            (layoutWidth - dates.length * gap) /
              Math.max(1, dates.length),
          )
        : compact
          ? 13
          : 20;
  const cellHeight =
    range === "week" ? (compact ? 11 : 16) : cellWidth;
  const summaries = dates
    .filter((date) => date <= today)
    .map((date) => trackedGoalSummary(state, state.currentUserId, date));
  const met = summaries.reduce((sum, item) => sum + item.met, 0);
  const possible = summaries.reduce((sum, item) => sum + item.total, 0);
  return (
    <View
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={styles.root}
    >
      {range === "week" ? (
        <View style={styles.weekLabels}>
          {dates.map((date) => (
            <Text
              key={date}
              style={[styles.weekLabel, { color: colors.muted }]}
            >
              {new Intl.DateTimeFormat(undefined, { weekday: "short" })
                .format(new Date(`${date}T12:00:00`))
                .slice(0, 2)}
            </Text>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.grid,
          compact &&
            range === "week" && {
              justifyContent: "space-between",
            },
          range === "year" && {
            height: (cellHeight + gap) * 7,
            flexDirection: "column",
            alignContent: "center",
          },
          range === "week" && styles.weekGrid,
        ]}
      >
        {cells.map((date, index) => {
          if (!date)
            return (
              <View
                key={`empty-${index}`}
                style={{
                  width: cellWidth,
                  height: cellHeight,
                  margin: gap / 2,
                }}
              />
            );
          const future = date > today;
          const vacation =
            !future && isVacationDate(state, state.currentUserId, date);
          const summary = trackedGoalSummary(
            state,
            state.currentUserId,
            date,
          );
          const anyLogged = state.metrics.some(
            (metric) =>
              isMetricTrackedOnDate(state, metric, date) &&
              hasMetricData(state, metric, state.currentUserId, date),
          );
          const completion = summary.total ? summary.met / summary.total : 0;
          const backgroundColor = future
            ? colors.canvas
            : vacation
              ? VACATION_COLOR
              : !summary.total || !anyLogged
                ? alpha(NOT_LOGGED, 0.46)
                : summary.allMet
                  ? GOAL_COMPLETE_COLOR
                  : completion >= 0.7
                    ? GOAL_MISSED_NEAR
                    : completion >= 0.35
                      ? "#B93838"
                      : GOAL_MISSED_FAR;
          return (
            <Pressable
              key={date}
              disabled={!onSelect}
              onPress={() => onSelect?.(date)}
              style={{
                width: cellWidth,
                height: cellHeight,
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
            {met}/{possible} goals
          </Text>
          <Text style={[styles.captionText, { color: colors.ink }]}>
            {possible ? Math.round((met / possible) * 100) : 0}% complete
          </Text>
        </View>
      ) : null}
    </View>
  );
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
  const [availableWidth, setAvailableWidth] = useState(0);
  const gap = range === "year" ? 1 : compact ? 4 : 5;
  const yearColumns = Math.ceil(cells.length / 7);
  const layoutWidth = availableWidth || 300;
  const yearCellWidth = Math.max(
    2,
    Math.floor(
      ((layoutWidth - yearColumns * gap) / Math.max(1, yearColumns)) * 100,
    ) / 100,
  );
  const cellWidth =
    range === "year"
      ? yearCellWidth
      : range === "week"
        ? Math.max(
            28,
            (layoutWidth - dates.length * gap) /
              Math.max(1, dates.length),
          )
        : compact
          ? 13
          : 20;
  const cellHeight =
    range === "week" ? (compact ? 11 : 16) : cellWidth;

  return (
    <View
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={styles.root}
    >
      {range === "week" ? (
        <View style={styles.weekLabels}>
          {dates.map((date) => (
            <Text
              key={date}
              style={[styles.weekLabel, { color: colors.muted }]}
            >
              {new Intl.DateTimeFormat(undefined, { weekday: "short" })
                .format(new Date(`${date}T12:00:00`))
                .slice(0, 2)}
            </Text>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.grid,
          compact &&
            range === "week" && {
              justifyContent: "space-between",
            },
          range === "year" && {
            height: (cellHeight + gap) * 7,
            flexDirection: "column",
            alignContent: "center",
          },
          range === "week" && styles.weekGrid,
        ]}
      >
        {cells.map((date, index) => {
          if (!date)
            return (
              <View
                key={`empty-${index}`}
                style={{
                  width: cellWidth,
                  height: cellHeight,
                  margin: gap / 2,
                }}
              />
            );
          const future = date > today;
          const logged =
            !future && hasMetricData(state, metric, state.currentUserId, date);
          const tracked =
            !future && isMetricTrackedOnDate(state, metric, date);
          const skipped =
            !future &&
            (isVacationDate(state, state.currentUserId, date) ||
              state.entries.some(
                (entry) =>
                  entry.userId === state.currentUserId &&
                  entry.metricId === metric.id &&
                  entry.localDate === date &&
                  entry.value === "skipped",
              ));
          const reached =
            logged &&
            scheduledGoalReached(state, metric, state.currentUserId, date);
          const value = logged
            ? safeMetricValue(state, metric, state.currentUserId, date)
            : 0;
          const progress = logged
            ? metricVisualProgress(
                state,
                metric,
                state.currentUserId,
                date,
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
            : skipped
              ? VACATION_COLOR
            : !logged
              ? alpha(NOT_LOGGED, tracked ? 0.72 : 0.46)
            : metric.goalEnabled === false
              ? LOGGED_NO_GOAL
            : reached
              ? progress > 1.75
                ? "#5D9C22"
                : progress > 1.15
                  ? "#86C53E"
                  : GOAL_COMPLETE_COLOR
              : progress >= 0.7
                ? GOAL_MISSED_NEAR
                : progress >= 0.35
                  ? "#B93838"
                  : GOAL_MISSED_FAR;
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
                width: cellWidth,
                height: cellHeight,
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
  root: {
    width: "100%",
    maxWidth: "100%",
    gap: 5,
    overflow: "hidden",
  },
  grid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  weekGrid: { justifyContent: "center", alignItems: "center" },
  caption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  captionText: { fontSize: 8, fontWeight: "800" },
  weekLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 3,
  },
  weekLabel: { flex: 1, textAlign: "center", fontSize: 6, fontWeight: "800" },
});
