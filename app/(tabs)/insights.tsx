import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import {
  animateReorder,
  useDelayedReorder,
} from "@/src/components/reorderAnimation";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Card,
  Chip,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  friendlyDate,
  monthDateRange,
  shortDay,
} from "@/src/domain/date";
import {
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  metricAverageGoalOffsetLabel,
  metricApplicableOnDate,
  metricOverallAverage,
  metricPeriodStats,
  metricStreakStats,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
  weightProgressStats,
} from "@/src/domain/metrics";
import {
  currentStreakWithRest,
  longestStreakWithRest,
} from "@/src/domain/streaks";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { AppState, MetricDefinition } from "@/src/types";
import { isInternalTracker } from "@/src/domain/trackerCatalog";

const TRACKED = "tracked_goals";
const TRACKED_COLOR = "#9B6BDB";
const WEEK_CHART_MAX = 1.4;
type ViewMode = "week" | "month";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Insights() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const today = dateKey();
  const metrics = state.metrics.filter(
    (metric) =>
      !isInternalTracker(metric) &&
      metric.sections.insights &&
      metric.dataType !== "text",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    (state.settings.progressMetricIds?.length
      ? state.settings.progressMetricIds
      : [TRACKED, "steps"]
    ).filter(
      (id) => id === TRACKED || metrics.some((metric) => metric.id === id),
    ),
  );
  const [filterTouched, setFilterTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [view, setView] = useState<ViewMode>("week");
  const [month, setMonth] = useState(today);
  const [weekAnchor, setWeekAnchor] = useState(today);
  const selectedMetrics = selectedIds
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter((metric): metric is MetricDefinition => Boolean(metric));
  const tracked = selectedIds.includes(TRACKED);
  const dates =
    view === "week"
      ? dateRangeEnding(weekAnchor, 7)
      : monthDateRange(month).filter((date) => date <= today);
  const summaryDates =
    view === "week"
      ? dates
      : dateRangeEnding(dates.at(-1) ?? today, 30);
  const selectorItems = [
    {
      id: TRACKED,
      label: "Tracked goals",
      icon: "checkmark-done-outline" as const,
      color: TRACKED_COLOR,
      sublabel: "All goals enabled on Today",
    },
    ...metrics.map((metric) => ({
      id: metric.id,
      label: metric.name,
      icon: metric.icon as keyof typeof Ionicons.glyphMap,
      color: metric.color,
    })),
  ];
  const hiddenItems = selectorItems.filter((item) => !selectedIds.includes(item.id));

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!editing) return false;
        setEditing(false);
        setShowPicker(false);
        return true;
      });
      return () => subscription.remove();
    }, [editing]),
  );

  function select(ids: string[]) {
    setSelectedIds(ids);
    updateSettings({ progressMetricIds: ids });
    setFilterTouched(true);
  }
  function move(metricId: string, targetIndex: number) {
    const current = selectedIds.filter((id) => id !== TRACKED);
    const index = current.indexOf(metricId);
    if (index < 0) return;
    const [item] = current.splice(index, 1);
    current.splice(Math.max(0, Math.min(targetIndex, current.length)), 0, item);
    animateReorder();
    select(selectedIds.includes(TRACKED) ? [TRACKED, ...current] : current);
  }

  function openDay(day: string) {
    router.navigate({
      pathname: "/day/[date]" as never,
      params: {
        date: day,
        ...(filterTouched ? { metrics: selectedIds.join(",") } : {}),
      },
    });
  }

  function trackedProgress(day: string) {
    const summary = trackedGoalSummary(state, state.currentUserId, day);
    return summary.total ? summary.met / summary.total : 0;
  }

  function rawDayVisuals(day: string) {
    const visuals = selectedMetrics.map((metric) => {
      const applicable = metricApplicableOnDate(
        state,
        metric,
        state.currentUserId,
        day,
      );
      return {
        color: metric.color,
        progress: applicable
          ? goalProgress(
              metric,
              safeMetricValue(state, metric, state.currentUserId, day),
              effectiveGoalTarget(state, metric, state.currentUserId, day),
            )
          : 0,
        goalReached:
          applicable &&
          scheduledGoalReached(state, metric, state.currentUserId, day),
      };
    });
    if (tracked)
      visuals.unshift({
        color: TRACKED_COLOR,
        progress: trackedProgress(day),
        goalReached: trackedGoalSummary(state, state.currentUserId, day).allMet,
      });
    return visuals;
  }

  function dayVisuals(day: string) {
    return rawDayVisuals(day).map((item) => ({
      ...item,
      progress: Math.min(item.progress, 1),
    }));
  }

  function status(day: string) {
    if (day > today) return "none" as const;
    const progress = dayVisuals(day).map((item) => item.progress);
    if (!progress.length) return "none" as const;
    return progress.every((value) => value >= 1)
      ? ("met" as const)
      : progress.some((value) => value > 0)
        ? ("partial" as const)
        : ("none" as const);
  }

  const legendItems = [
    ...(tracked
      ? [{ id: TRACKED, name: "Tracked goals", color: TRACKED_COLOR }]
      : []),
    ...selectedMetrics.map((metric) => ({
      id: metric.id,
      name: metric.name,
      color: metric.color,
    })),
  ].slice(0, 5);

  return (
    <Screen
      contentContainerStyle={{ paddingBottom: 14 }}
      refreshEnabled={!editing}
    >
      <PageHeader
        title="Progress"
        action={
          editing ? (
            <Pressable
              onPress={() => {
                setEditing(false);
                setShowPicker(false);
              }}
              style={[styles.done, { backgroundColor: accent }]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : undefined
        }
      />
      <View style={styles.controls}>
        <View style={styles.mode}>
          <Chip
            label="7 days"
            selected={view === "week"}
            onPress={() => setView("week")}
          />
          <Chip
            label="Month"
            selected={view === "month"}
            onPress={() => setView("month")}
          />
        </View>
      </View>
      <View style={styles.legendWrap}>
        {legendItems.map((item) => (
          <View
            key={item.id}
            style={[
              styles.legendItem,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={[styles.legendName, { color: colors.muted }]}>
              {item.name}
            </Text>
          </View>
        ))}
      </View>
      {view === "month" ? (
        <Card style={styles.visualCard}>
          <View style={styles.cardHeading}>
            <View>
              <Text style={[styles.eyebrow, { color: accent }]}>
                MONTH VIEW
              </Text>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>
                Daily goal progress
              </Text>
            </View>
            <Text style={[styles.legend, { color: colors.muted }]}>
              Up to 5 bars per day
            </Text>
          </View>
          <MonthCalendar
            selectedDate={today}
            monthDate={month}
            onMonthChange={setMonth}
            onSelect={openDay}
            dayStatus={status}
            dayVisuals={dayVisuals}
            allTrackedGoalsMet={(day) =>
              trackedGoalSummary(state, state.currentUserId, day).allMet
            }
          />
          <Text style={[styles.hint, { color: colors.muted }]}>
            Each colored line is one selected item. Tap a date for its filtered
            log.
          </Text>
        </Card>
      ) : (
        <Card style={styles.visualCard}>
          <View style={styles.weekNav}>
            <Pressable
              onPress={() => setWeekAnchor(dateWithOffsetFrom(weekAnchor, -7))}
              style={[styles.arrow, { backgroundColor: colors.canvas }]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <View style={styles.navCopy}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>
                7-day trend
              </Text>
              <Text style={[styles.legend, { color: colors.muted }]}>
                {friendlyDate(dates[0])} – {friendlyDate(dates[6])}
              </Text>
            </View>
            <Pressable
              disabled={weekAnchor >= today}
              onPress={() =>
                setWeekAnchor(
                  dateWithOffsetFrom(weekAnchor, 7) > today
                    ? today
                    : dateWithOffsetFrom(weekAnchor, 7),
                )
              }
              style={[styles.arrow, { backgroundColor: colors.canvas }]}
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={weekAnchor >= today ? colors.faint : colors.ink}
              />
            </Pressable>
          </View>
          <View style={styles.weekChart}>
            <View
              pointerEvents="none"
              style={[styles.goalReference, { borderTopColor: colors.ink }]}
            >
              <Text
                style={[
                  styles.goalReferenceLabel,
                  { color: colors.ink, backgroundColor: colors.card },
                ]}
              >
                GOAL · 100%
              </Text>
            </View>
            {dates.map((day) => (
              <Pressable
                key={day}
                onPress={() => openDay(day)}
                style={styles.dayColumn}
              >
                <View
                  style={[styles.bars, { borderBottomColor: colors.border }]}
                >
                  {rawDayVisuals(day)
                    .slice(0, 5)
                    .map((item, index) => (
                      <View
                        key={index}
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(3, Math.min(item.progress / WEEK_CHART_MAX, 1) * 100)}%`,
                            backgroundColor: item.color,
                          },
                        ]}
                      />
                    ))}
                </View>
                <Text style={[styles.dayLabel, { color: colors.muted }]}>
                  {shortDay(day).slice(0, 1)}
                </Text>
                <Text style={[styles.dayNumber, { color: colors.ink }]}>
                  {Number(day.slice(-2))}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            The dashed line is each item’s own goal. Bars can extend to 140%, so
            exceeding a goal stays visible across different units.
          </Text>
        </Card>
      )}
      <SectionHeader
        title={`${view === "week" ? "7-day" : "30-day"} summaries`}
      />
      <View style={styles.summaries}>
        {tracked ? (
          <TrackedSummary
            state={state}
            dates={summaryDates}
            editing={editing}
            onEdit={() => setEditing(true)}
            onRemove={() => select(selectedIds.filter((id) => id !== TRACKED))}
          />
        ) : null}
        {selectedMetrics.map((metric, index) => (
          <MetricSummary
            key={metric.id}
            state={state}
            metric={metric}
            dates={summaryDates}
            editing={editing}
            index={index}
            count={selectedMetrics.length}
            onEdit={() => setEditing(true)}
            onMove={(target) => move(metric.id, target)}
            onRemove={() => select(selectedIds.filter((id) => id !== metric.id))}
          />
        ))}
      </View>
      {editing ? (
        <>
          <Pressable
            onPress={() => setShowPicker((value) => !value)}
            style={[styles.addExisting, { borderColor: accent }]}
          >
            <Ionicons name="add" size={18} color={accent} />
            <Text style={[styles.addExistingText, { color: accent }]}>Add existing tracker</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => setEditing(true)}
          style={styles.editHint}
        >
          <Text style={[styles.hint, { color: colors.muted }]}>Hold a summary to edit what Progress shows</Text>
        </Pressable>
      )}
      <AddTrackerModal
        visible={showPicker}
        items={hiddenItems}
        onClose={() => setShowPicker(false)}
        onAdd={(id) => {
          select([...selectedIds, id]);
          setShowPicker(false);
        }}
      />
    </Screen>
  );
}

function TrackedSummary({
  state,
  dates,
  editing,
  onEdit,
  onRemove,
}: {
  state: AppState;
  dates: string[];
  editing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const colors = useAppColors();
  const wiggle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!editing) {
      wiggle.stopAnimation();
      wiggle.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 280, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [editing, wiggle]);
  const totals = dates.map((date) =>
    trackedGoalSummary(state, state.currentUserId, date),
  );
  const eligible = totals.filter((item) => item.total > 0);
  const met = totals.reduce((sum, item) => sum + item.met, 0);
  const possible = totals.reduce((sum, item) => sum + item.total, 0);
  const perfect = eligible.filter((item) => item.allMet).length;
  const streak = longestStreakWithRest(
    state,
    dates,
    (date) => trackedGoalSummary(state, state.currentUserId, date).allMet,
  );
  const currentStreak = currentStreakWithRest(
    state,
    dates,
    (date) => trackedGoalSummary(state, state.currentUserId, date).allMet,
  );
  const completion = possible ? Math.round((met / possible) * 100) : 0;
  return (
    <Animated.View
      style={[
        styles.animatedSummary,
        {
          transform: [
          {
            rotate: wiggle.interpolate({
              inputRange: [-1, 1],
              outputRange: ["-0.3deg", "0.3deg"],
            }),
          },
          ],
        },
      ]}
    >
    <Pressable style={styles.summaryWrap} onLongPress={onEdit}>
    <Card style={styles.summary}>
      <View
        style={[styles.summaryIcon, { backgroundColor: `${TRACKED_COLOR}18` }]}
      >
        <Ionicons name="checkmark-done" size={20} color={TRACKED_COLOR} />
      </View>
      <View style={styles.summaryPrimary}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={[styles.summaryName, styles.summaryNameRow, { color: colors.ink }]}
        >
          Tracked goals
        </Text>
        <Text style={[styles.summaryValue, { color: colors.ink }]}>{completion}%</Text>
        <Text style={[styles.summaryUnit, { color: colors.muted }]}>all goals in range</Text>
      </View>
      <View style={styles.summaryDetail}>
        <Text
          numberOfLines={2}
          style={[styles.summaryLabel, { color: colors.muted }]}
        >
          {met}/{possible} individual goals completed
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.remaining, { color: colors.ink }]}
        >
          {perfect}/{eligible.length} all-goal days
        </Text>
      </View>
      <View style={styles.summaryGoal}>
        <Text style={[styles.goalLine, { color: TRACKED_COLOR }]}>
          Current streak {currentStreak}d
        </Text>
        <Text style={[styles.streakLine, { color: colors.muted }]}>Best streak {streak}d</Text>
      </View>
      {editing ? (
        <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
          <Ionicons name="remove" size={16} color={palette.white} />
        </Pressable>
      ) : null}
    </Card>
    </Pressable>
    </Animated.View>
  );
}

function MetricSummary({
  state,
  metric,
  dates,
  editing,
  index,
  count,
  onEdit,
  onMove,
  onRemove,
}: {
  state: AppState;
  metric: MetricDefinition;
  dates: string[];
  editing: boolean;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const dragY = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const dragOrigin = useRef(index);
  const liveTarget = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  const lastDragY = useRef(0);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
  const {
    schedule: scheduleReorder,
    flush: flushReorder,
    cancel: cancelReorder,
  } = useDelayedReorder((target) => {
    liveTarget.current = target;
    dragY.setValue(
      lastDragY.current - (target - dragOrigin.current) * 82,
    );
    onMoveRef.current(target);
  });
  useEffect(() => {
    if (!editing) {
      cancelReorder();
      dragY.setValue(0);
      wiggle.stopAnimation();
      wiggle.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 135, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 270, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 135, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [cancelReorder, dragY, editing, wiggle]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          editing && Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          cancelReorder();
          dragOrigin.current = indexRef.current;
          liveTarget.current = indexRef.current;
          lastDragY.current = 0;
        },
        onPanResponderMove: (_event, gesture) => {
          lastDragY.current = gesture.dy;
          const target = Math.max(
            0,
            Math.min(
              countRef.current - 1,
              dragOrigin.current + Math.round(gesture.dy / 82),
            ),
          );
          dragY.setValue(
            gesture.dy - (liveTarget.current - dragOrigin.current) * 82,
          );
          if (target !== liveTarget.current) scheduleReorder(target);
          else cancelReorder();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          flushReorder();
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          cancelReorder();
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [
      cancelReorder,
      dragY,
      editing,
      flushReorder,
      scheduleReorder,
    ],
  );
  const periodStats = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    dates,
  );
  const applicable = periodStats.applicableDates;
  const measured = periodStats.loggedDates;
  const average = periodStats.average;
  const reached = periodStats.goalsReached;
  const streaks = metricStreakStats(
    state,
    metric,
    state.currentUserId,
    dates[dates.length - 1],
  );
  const overall = metricOverallAverage(
    state,
    metric,
    state.currentUserId,
    dates[dates.length - 1],
  );
  const isBoolean = metric.dataType === "boolean";
  const weightStats =
    metric.id === "weight"
      ? weightProgressStats(state, state.currentUserId, dates[dates.length - 1])
      : null;
  return (
    <Animated.View
      style={[
        styles.animatedSummary,
        {
          transform: [
          { translateY: dragY },
          {
            rotate: wiggle.interpolate({
              inputRange: [-1, 1],
              outputRange: ["-0.3deg", "0.3deg"],
            }),
          },
          ],
          zIndex: editing ? 3 : 0,
        },
      ]}
    >
    <Pressable
      style={styles.summaryWrap}
      onLongPress={onEdit}
      onPress={() =>
        editing ? undefined : router.navigate({
          pathname: "/metric-detail" as never,
          params: { metric: metric.id, date: dates[dates.length - 1] },
        } as never)
      }
    >
      <Card style={styles.summary}>
        {editing ? (
          <View {...responder.panHandlers} style={styles.drag}>
            <Ionicons name="reorder-three-outline" size={23} color={colors.faint} />
          </View>
        ) : null}
        <View
          style={[styles.summaryIcon, { backgroundColor: `${metric.color}18` }]}
        >
          <Ionicons
            name={metric.icon as keyof typeof Ionicons.glyphMap}
            size={20}
            color={metric.color}
          />
        </View>
        <View style={styles.summaryPrimary}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            style={[styles.summaryName, styles.summaryNameRow, { color: colors.ink }]}
          >
            {metric.name}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.summaryValue, { color: colors.ink }]}
          >
          {isBoolean
              ? `${applicable.length ? Math.round((reached / applicable.length) * 100) : 0}%`
              : Math.abs(average) >= 100
                ? Math.round(average).toLocaleString()
                : (Math.round(average * 10) / 10).toLocaleString()}
          </Text>
          {isBoolean ? (
            <Text style={[styles.summaryUnit, { color: colors.muted }]}>
              {dates.length}-day completion avg
            </Text>
          ) : (
            <Text style={[styles.summaryUnit, { color: colors.muted }]}>
              {dates.length}-day avg{metric.unit ? ` · ${metric.unit}` : ""}
            </Text>
          )}
        </View>
        <View style={styles.summaryDetail}>
        <Text
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          style={[styles.summaryLabel, { color: colors.muted }]}
        >
          {weightStats
            ? `${dates.length}-day average · ${Math.abs(weightStats.totalChange).toFixed(1)} kg ${weightStats.direction === "gain" ? "gained" : "lost"} · ${Math.abs(weightStats.averageWeeklyChange).toFixed(1)} kg/week`
            : isBoolean
              ? `${applicable.length ? Math.round((reached / applicable.length) * 100) : 0}% completed in this range`
              : `${measured.length ? `${measured.length} logged days` : "No entries"} · overall ${formatMetricValue(metric, overall)}`}
        </Text>
        {weightStats ? (
          <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.remaining, { color: colors.ink }]}>
            Last 7 days {Math.abs(weightStats.lastWeekChange).toFixed(1)} kg ·
            planned {weightStats.expectedWeeklyChange.toFixed(1)} kg/week ·{" "}
            {weightStats.remaining.toFixed(1)} kg remaining
          </Text>
        ) : !isBoolean ? (
          <Text numberOfLines={2} style={[styles.remaining, { color: colors.ink }]}>
            {metricAverageGoalOffsetLabel(
              metric,
              average,
              periodStats.averageTarget,
            )}
          </Text>
        ) : null}
        </View>
        <View style={styles.summaryGoal}>
        <Text style={[styles.goalLine, { color: accent }]}>
          {reached}/{applicable.length} goal days ·{" "}
          {applicable.length ? Math.round((reached / applicable.length) * 100) : 0}%
        </Text>
        <Text style={[styles.streakLine, { color: colors.muted }]}>
          Current {streaks.current}d · Best {streaks.best}d
        </Text>
        </View>
        {editing ? (
          <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
            <Ionicons name="remove" size={16} color={palette.white} />
          </Pressable>
        ) : null}
      </Card>
    </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  addExisting: { minHeight: 42, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
  addExistingText: { fontSize: 10, fontWeight: "900" },
  editHint: { alignItems: "center", paddingVertical: 8 },
  drag: { width: 28, alignItems: "center", justifyContent: "center" },
  remove: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center" },
  recap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: palette.ink,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 13,
  },
  recapText: { color: palette.white, fontSize: 11, fontWeight: "900" },
  today: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 19,
    padding: 14,
    marginBottom: 12,
  },
  copy: { flex: 1 },
  todayTitle: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  todayText: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  controls: { gap: 9, marginBottom: 4 },
  mode: { flexDirection: "row", gap: 7 },
  visualCard: { marginTop: 10, marginBottom: 14 },
  cardHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  eyebrow: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  legend: { color: palette.muted, fontSize: 9 },
  legendWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { color: palette.muted, fontSize: 9, fontWeight: "800" },
  hint: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center",
    marginTop: 10,
  },
  weekNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  navCopy: { alignItems: "center" },
  weekChart: {
    position: "relative",
    height: 210,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 16,
  },
  goalReference: {
    position: "absolute",
    zIndex: 3,
    left: 0,
    right: 0,
    top: 46,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderTopColor: palette.ink,
  },
  goalReferenceLabel: {
    position: "absolute",
    right: 2,
    top: -15,
    color: palette.ink,
    fontSize: 7,
    fontWeight: "900",
    backgroundColor: palette.card,
    paddingHorizontal: 4,
  },
  dayColumn: { flex: 1, alignItems: "center", height: "100%" },
  bars: {
    height: 164,
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  bar: {
    width: "15%",
    minWidth: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  dayLabel: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "800",
    marginTop: 7,
  },
  dayNumber: { color: palette.ink, fontSize: 9, fontWeight: "900" },
  summaries: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  animatedSummary: { width: "100%" },
  summaryWrap: { width: "100%" },
  summary: {
    width: "100%",
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  summaryPrimary: { width: 82, minWidth: 70 },
  summaryDetail: { flex: 1, minWidth: 0 },
  summaryGoal: { width: 82, alignItems: "flex-end" },
  trackedSummary: {
    width: "100%",
    minHeight: 66,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  trackedCopy: { flex: 1 },
  trackedStat: { alignItems: "flex-end" },
  summaryIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryName: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 6,
  },
  summaryNameRow: { marginTop: 0 },
  summaryValue: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  summaryUnit: { fontSize: 8, fontWeight: "800", marginTop: 1 },
  summaryLabel: {
    color: palette.muted,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 2,
  },
  remaining: {
    color: palette.ink,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "700",
    marginTop: 5,
  },
  goalLine: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "right",
  },
  streakLine: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "right",
  },
});
