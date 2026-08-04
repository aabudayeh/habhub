import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { AppText as Text } from "@/src/components/AppText";
import { useLocale } from "@/src/i18n";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { entriesForDay } from "@/src/domain/dataIndex";
import {
  effectiveGoalTarget,
  goalProgress,
  goalReached,
  hasMetricData,
  isMetricTrackedOnDate,
  metricPeriodStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
  weightDailyGoalStatus,
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

type HeatmapCellModel = {
  date: string;
  future: boolean;
  backgroundColor?: string;
  secondaryBackgroundColor?: string;
  reached?: boolean;
  tracked?: boolean;
  logged?: boolean;
};

export type GoalHeatmapModel = {
  period: ReturnType<typeof metricPeriodStats>;
  cells: HeatmapCellModel[];
};

export type TrackedGoalsHeatmapModel = {
  met: number;
  possible: number;
  allGoalDays: number;
  eligibleDays: number;
  cells: HeatmapCellModel[];
};

type CacheInputs = {
  metrics: AppState["metrics"];
  photos: AppState["photos"];
  statuses: AppState["dailyMetricStatuses"];
  gymSessions: AppState["gymSessions"];
  todos: AppState["todos"];
  trackedPeriods: AppState["trackedGoalPeriods"];
  energyProfiles: AppState["energyProfiles"];
  energyProfile: AppState["settings"]["energyProfile"];
  vacationPeriods: AppState["settings"]["vacationPeriods"];
  foodGoalMode: AppState["settings"]["foodGoalMode"];
  baselineCalories: number;
  dayEndTime?: string;
};

type Cached<T> = CacheInputs & {
  metric?: MetricDefinition;
  model: T;
};

const goalModelCache = new WeakMap<
  AppState["entries"],
  Map<string, Cached<GoalHeatmapModel>>
>();
const trackedModelCache = new WeakMap<
  AppState["entries"],
  Map<string, Cached<TrackedGoalsHeatmapModel>>
>();

function cacheInputs(state: AppState): CacheInputs {
  return {
    metrics: state.metrics,
    photos: state.photos,
    statuses: state.dailyMetricStatuses,
    gymSessions: state.gymSessions,
    todos: state.todos,
    trackedPeriods: state.trackedGoalPeriods,
    energyProfiles: state.energyProfiles,
    energyProfile: state.settings.energyProfile,
    vacationPeriods: state.settings.vacationPeriods,
    foodGoalMode: state.settings.foodGoalMode,
    baselineCalories: state.settings.baselineCalories,
    dayEndTime: state.settings.dayEndTime,
  };
}

function sameInputs(left: Cached<unknown>, right: CacheInputs) {
  return (
    left.metrics === right.metrics &&
    left.photos === right.photos &&
    left.statuses === right.statuses &&
    left.gymSessions === right.gymSessions &&
    left.todos === right.todos &&
    left.trackedPeriods === right.trackedPeriods &&
    left.energyProfiles === right.energyProfiles &&
    left.energyProfile === right.energyProfile &&
    left.vacationPeriods === right.vacationPeriods &&
    left.foodGoalMode === right.foodGoalMode &&
    left.baselineCalories === right.baselineCalories &&
    left.dayEndTime === right.dayEndTime
  );
}

function cacheKey(
  userId: string,
  itemId: string,
  dates: string[],
  today: string,
) {
  return `${userId}\u0000${itemId}\u0000${dates[0] ?? ""}\u0000${
    dates.at(-1) ?? ""
  }\u0000${dates.length}\u0000${today}`;
}

function remember<T>(
  bucket: Map<string, Cached<T>>,
  key: string,
  value: Cached<T>,
) {
  if (bucket.size >= 80) {
    const oldest = bucket.keys().next().value;
    if (oldest) bucket.delete(oldest);
  }
  bucket.set(key, value);
  return value.model;
}

export function cachedGoalHeatmapModel(
  state: AppState,
  metric: MetricDefinition,
  dates: string[],
  today: string,
): GoalHeatmapModel {
  let bucket = goalModelCache.get(state.entries);
  if (!bucket) {
    bucket = new Map();
    goalModelCache.set(state.entries, bucket);
  }
  const key = cacheKey(state.currentUserId, metric.id, dates, today);
  const inputs = cacheInputs(state);
  const cached = bucket.get(key);
  if (cached && cached.metric === metric && sameInputs(cached, inputs))
    return cached.model;
  const period = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    dates.filter((date) => date <= today),
  );
  const isBloodPressure =
    metric.id === "blood_pressure_systolic" ||
    (metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "systolic");
  const diastolic = isBloodPressure
    ? state.metrics.find(
        (candidate) =>
          candidate.id === "blood_pressure_diastolic" ||
          (candidate.healthMapping?.dataType === "blood_pressure" &&
            candidate.healthMapping.field === "diastolic"),
      )
    : undefined;
  const cells = dates.map((date) => {
    const future = date > today;
    const logged =
      !future && hasMetricData(state, metric, state.currentUserId, date);
    const tracked =
      !future && isMetricTrackedOnDate(state, metric, date);
    const skipped =
      !future &&
      (isVacationDate(state, state.currentUserId, date) ||
        entriesForDay(state.entries, metric.id, state.currentUserId, date).some(
          (entry) => entry.value === "skipped",
        ));
    const reached =
      logged &&
      scheduledGoalReached(state, metric, state.currentUserId, date);
    const value = logged
      ? safeMetricValue(state, metric, state.currentUserId, date)
      : 0;
    const progress = logged
      ? metric.id === "weight"
        ? weightDailyGoalStatus(state, state.currentUserId, date).progress
        : metricVisualProgress(
          state,
          metric,
          state.currentUserId,
          date,
          value,
          effectiveGoalTarget(state, metric, state.currentUserId, date),
        )
      : 0;
    let backgroundColor = skipped
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
    let secondaryBackgroundColor: string | undefined;
    if (!future && !skipped && isBloodPressure && diastolic) {
      const diastolicLogged = hasMetricData(
        state,
        diastolic,
        state.currentUserId,
        date,
      );
      const diastolicValue = diastolicLogged
        ? safeMetricValue(state, diastolic, state.currentUserId, date)
        : 0;
      const diastolicReached =
        diastolicLogged &&
        goalReached(
          diastolic,
          diastolicValue,
          effectiveGoalTarget(state, diastolic, state.currentUserId, date),
        );
      const systolicReached =
        logged &&
        goalReached(
          metric,
          value,
          effectiveGoalTarget(state, metric, state.currentUserId, date),
        );
      const pressureColor = (
        hasReading: boolean,
        pressureReached: boolean,
        pressureProgress: number,
      ) =>
        !hasReading
          ? alpha(NOT_LOGGED, tracked ? 0.72 : 0.46)
          : pressureReached
            ? GOAL_COMPLETE_COLOR
            : pressureProgress >= 0.7
              ? GOAL_MISSED_NEAR
              : GOAL_MISSED_FAR;
      backgroundColor = pressureColor(
        logged,
        systolicReached,
        goalProgress(
          metric,
          value,
          effectiveGoalTarget(state, metric, state.currentUserId, date),
        ),
      );
      secondaryBackgroundColor = pressureColor(
        diastolicLogged,
        diastolicReached,
        goalProgress(
          diastolic,
          diastolicValue,
          effectiveGoalTarget(state, diastolic, state.currentUserId, date),
        ),
      );
    }
    return {
      date,
      future,
      backgroundColor,
      secondaryBackgroundColor,
      reached,
      tracked,
      logged,
    };
  });
  const model = { period, cells };
  return remember(bucket, key, { ...inputs, metric, model });
}

export function cachedTrackedGoalsHeatmapModel(
  state: AppState,
  dates: string[],
  today: string,
): TrackedGoalsHeatmapModel {
  let bucket = trackedModelCache.get(state.entries);
  if (!bucket) {
    bucket = new Map();
    trackedModelCache.set(state.entries, bucket);
  }
  const key = cacheKey(state.currentUserId, "tracked-goals", dates, today);
  const inputs = cacheInputs(state);
  const cached = bucket.get(key);
  if (cached && sameInputs(cached, inputs)) return cached.model;
  let met = 0;
  let possible = 0;
  let allGoalDays = 0;
  let eligibleDays = 0;
  const cells = dates.map((date) => {
    const future = date > today;
    if (future) return { date, future };
    const vacation = isVacationDate(state, state.currentUserId, date);
    const summary = trackedGoalSummary(state, state.currentUserId, date);
    const anyLogged = state.metrics.some(
      (metric) =>
        isMetricTrackedOnDate(state, metric, date) &&
        hasMetricData(state, metric, state.currentUserId, date),
    );
    met += summary.met;
    possible += summary.total;
    if (summary.total > 0) {
      eligibleDays += 1;
      if (summary.allMet) allGoalDays += 1;
    }
    const completion = summary.total ? summary.met / summary.total : 0;
    const backgroundColor = vacation
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
    return { date, future, backgroundColor };
  });
  const model = { met, possible, allGoalDays, eligibleDays, cells };
  return remember(bucket, key, { ...inputs, model });
}

export function TrackedGoalsHeatmap({
  state,
  dates,
  range,
  compact = false,
  onSelect,
  model,
}: {
  state: AppState;
  dates: string[];
  range: HistoryRange;
  compact?: boolean;
  onSelect?: (date: string) => void;
  model?: TrackedGoalsHeatmapModel;
}) {
  const colors = useAppColors();
  const locale = useLocale();
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
            8,
            (layoutWidth - Math.max(0, dates.length - 1) * gap - 2) /
              Math.max(1, dates.length),
          )
        : compact
          ? 13
          : 20;
  const cellHeight =
    range === "week" ? (compact ? 11 : 16) : cellWidth;
  const heatmap = model ?? cachedTrackedGoalsHeatmapModel(state, dates, today);
  const cellsByDate = useMemo(
    () => new Map(heatmap.cells.map((cell) => [cell.date, cell])),
    [heatmap],
  );
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
              {new Intl.DateTimeFormat(locale, { weekday: "short" })
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
          range === "week" && { columnGap: gap },
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
                  margin: range === "week" ? 0 : gap / 2,
                }}
              />
            );
          const cell = cellsByDate.get(date);
          const cellStyle = {
            width: cellWidth,
            height: cellHeight,
            margin: range === "week" ? 0 : gap / 2,
            borderRadius: range === "year" ? 1.5 : 4,
            backgroundColor: cell?.future
              ? colors.canvas
              : cell?.backgroundColor,
            borderWidth: date === today ? 1 : 0,
            borderColor: colors.ink,
          };
          return range === "year" ? (
            <View key={date} style={cellStyle} />
          ) : (
            <Pressable
              key={date}
              disabled={!onSelect}
              onPress={() => onSelect?.(date)}
              style={cellStyle}
            />
          );
        })}
      </View>
      {!compact ? (
        <View style={styles.caption}>
          <Text style={[styles.captionText, { color: colors.muted }]}>
            {heatmap.allGoalDays}/{heatmap.eligibleDays} all-goal days
          </Text>
          <Text style={[styles.captionText, { color: colors.ink }]}>
            {heatmap.possible
              ? Math.round((heatmap.met / heatmap.possible) * 100)
              : 0}
            % complete
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
  model,
  completionOnly = false,
}: {
  state: AppState;
  metric: MetricDefinition;
  dates: string[];
  range: HistoryRange;
  compact?: boolean;
  onSelect?: (date: string) => void;
  model?: GoalHeatmapModel;
  completionOnly?: boolean;
}) {
  const colors = useAppColors();
  const locale = useLocale();
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
  const heatmap = model ?? cachedGoalHeatmapModel(state, metric, dates, today);
  const period = heatmap.period;
  const cellsByDate = useMemo(
    () => new Map(heatmap.cells.map((cell) => [cell.date, cell])),
    [heatmap],
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
            8,
            (layoutWidth - Math.max(0, dates.length - 1) * gap - 2) /
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
              {new Intl.DateTimeFormat(locale, { weekday: "short" })
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
          range === "week" && { columnGap: gap },
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
                  margin: range === "week" ? 0 : gap / 2,
                }}
              />
            );
          const cell = cellsByDate.get(date);
          const completionColor =
            completionOnly && cell?.logged && !cell.secondaryBackgroundColor
              ? cell.reached
                ? GOAL_COMPLETE_COLOR
                : GOAL_MISSED_NEAR
              : cell?.backgroundColor;
          const cellStyle = {
            width: cellWidth,
            height: cellHeight,
            margin: range === "week" ? 0 : gap / 2,
            borderRadius: range === "year" ? 1.5 : 4,
            backgroundColor: cell?.future
              ? colors.canvas
              : completionColor,
            borderWidth: date === today ? 1 : 0,
            borderColor: colors.ink,
            overflow: "hidden" as const,
          };
          const split =
            !cell?.future && cell?.secondaryBackgroundColor ? (
              <LinearGradient
                pointerEvents="none"
                colors={[
                  completionColor ?? NOT_LOGGED,
                  completionColor ?? NOT_LOGGED,
                  cell.secondaryBackgroundColor,
                  cell.secondaryBackgroundColor,
                ]}
                locations={[0, 0.49, 0.51, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            ) : null;
          return range === "year" ? (
            <View key={date} style={cellStyle}>{split}</View>
          ) : (
            <Pressable
              key={date}
              accessibilityLabel={`${metric.name}, ${date}${
                cell?.reached
                  ? ", goal met"
                  : cell?.tracked
                    ? ", not logged"
                    : ""
              }`}
              disabled={!onSelect}
              onPress={() => onSelect?.(date)}
              style={cellStyle}
            >
              {split}
            </Pressable>
          );
        })}
      </View>
      {!compact ? (
        <View style={styles.caption}>
          <Text style={[styles.captionText, { color: colors.muted }]}>
            {period.goalsReached}/{period.applicableDates.length} goal days
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
  weekGrid: {
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "nowrap",
  },
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
