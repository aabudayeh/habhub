import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  UIManager,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { TrackerViewFilterSheet } from "@/src/components/TrackerViewFilterSheet";
import { InfoPopover } from "@/src/components/InfoPopover";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  GoalHeatmap,
  TrackedGoalsHeatmap,
} from "@/src/components/GoalHeatmap";
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
  calendarPeriodRange,
  calendarWeekRange,
  dateWithOffsetFrom,
  friendlyDate,
  monthDateRange,
  shortDay,
} from "@/src/domain/date";
import {
  effectiveGoalTarget,
  formatMetricValue,
  isMetricTrackedOnDate,
  metricAverageGoalOffsetLabel,
  metricApplicableOnDate,
  metricOverallAverage,
  metricPeriodStats,
  metricStreakStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalStreakStats,
  trackedGoalSummary,
  weightProgressStats,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  AppState,
  HistoryRange,
  MetricDefinition,
  ProgressViewMode,
} from "@/src/types";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { isVacationDate } from "@/src/domain/vacation";
import {
  todoAppearsOnDate,
  todoResolvedOnDate,
} from "@/src/domain/schedule";
import {
  activeTrackerViewLabel,
  activeTrackerViewId,
  ALL_TRACKERS_FILTER,
  TRACKED_ONLY_FILTER,
  metricMatchesActiveView,
} from "@/src/domain/viewFilters";

const TRACKED = "tracked_goals";
const TRACKED_COLOR = "#9B6BDB";
const WEEK_CHART_MAX = 1.4;
type ViewMode = "week" | "month";
const PROGRESS_MODE_ORDER: ProgressViewMode[] = [
  "overview",
  "goal_maps",
];

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
      (metric.sections.insights ||
        activeTrackerViewId(state, "progress") !== "all") &&
      metric.dataType !== "text" &&
      metricMatchesActiveView(state, metric, today, "progress"),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    (state.settings.progressMetricIds?.length
      ? state.settings.progressMetricIds
      : [TRACKED, "steps"]
    ).filter(
      (id) => id === TRACKED || metrics.some((metric) => metric.id === id),
    ),
  );
  const [editing, setEditing] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const orderDraftRef = useRef<string[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showViewFilters, setShowViewFilters] = useState(false);
  const overviewScrollRef = useRef<ScrollView>(null);
  const progressMode =
    state.settings.progressViewMode === "compact"
      ? "goal_maps"
      : (state.settings.progressViewMode ?? "overview");
  const setProgressMode = useCallback(
    (progressViewMode: ProgressViewMode) =>
      updateSettings({ progressViewMode }),
    [updateSettings],
  );
  const pageViewSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !editing &&
          Math.abs(gesture.dx) > 24 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.45,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const index = PROGRESS_MODE_ORDER.indexOf(progressMode);
          const offset = gesture.dx < 0 ? 1 : -1;
          setProgressMode(
            PROGRESS_MODE_ORDER[
              (index + offset + PROGRESS_MODE_ORDER.length) %
                PROGRESS_MODE_ORDER.length
            ],
          );
        },
      }),
    [editing, progressMode, setProgressMode],
  );
  const historyRange = state.settings.progressHistoryRange ?? "week";
  const historyAnchor = state.settings.progressHistoryAnchor ?? today;
  const view: ViewMode = historyRange === "week" ? "week" : "month";
  const setHistoryAnchor = useCallback(
    (progressHistoryAnchor: string) =>
      updateSettings({ progressHistoryAnchor }),
    [updateSettings],
  );
  const setHistoryRange = useCallback(
    (progressHistoryRange: HistoryRange) =>
      updateSettings({ progressHistoryRange }),
    [updateSettings],
  );
  useEffect(() => {
    setCloudSyncPaused("progress-edit", editing);
    return () => setCloudSyncPaused("progress-edit", false);
  }, [editing]);
  useEffect(() => {
    if (!editing || progressMode !== "overview") return;
    const timer = setTimeout(
      () => overviewScrollRef.current?.scrollToEnd({ animated: true }),
      120,
    );
    return () => clearTimeout(timer);
  }, [editing, progressMode]);
  const activeProgressFilter = activeTrackerViewId(state, "progress");
  const savedOrder = (
    editing && orderDraft?.length
      ? orderDraft
      : state.settings.progressMetricOrderIds?.length
        ? state.settings.progressMetricOrderIds
      : [
          ...selectedIds,
          ...state.metrics.map((metric) => metric.id),
        ]
  ).filter((id, index, all) => all.indexOf(id) === index);
  const configuredOrder =
    (selectedIds.includes(TRACKED) ||
      activeProgressFilter === TRACKED_ONLY_FILTER) &&
    !savedOrder.includes(TRACKED)
      ? [TRACKED, ...savedOrder]
      : savedOrder;
  const orderIndex = new Map(
    configuredOrder.map((metricId, index) => [metricId, index]),
  );
  const fallbackOrder = new Map(
    state.metrics.map((metric, index) => [metric.id, index]),
  );
  const orderedMetrics = [...metrics].sort(
    (left, right) =>
      (orderIndex.get(left.id) ??
        configuredOrder.length + (fallbackOrder.get(left.id) ?? 0)) -
      (orderIndex.get(right.id) ??
        configuredOrder.length + (fallbackOrder.get(right.id) ?? 0)),
  );
  const selectedMetrics =
    activeProgressFilter === ALL_TRACKERS_FILTER
      ? orderedMetrics.filter((metric) => selectedIds.includes(metric.id))
      : orderedMetrics;
  const tracked =
    selectedIds.includes(TRACKED) ||
    activeProgressFilter === TRACKED_ONLY_FILTER;
  const progressCardIds = [
    ...(tracked ? [TRACKED] : []),
    ...selectedMetrics.map((metric) => metric.id),
  ].sort(
    (left, right) =>
      (orderIndex.get(left) ??
        configuredOrder.length +
          (left === TRACKED ? -1 : (fallbackOrder.get(left) ?? 0))) -
      (orderIndex.get(right) ??
        configuredOrder.length +
          (right === TRACKED ? -1 : (fallbackOrder.get(right) ?? 0))),
  );
  const dates =
    view === "week"
      ? calendarWeekRange(
          historyAnchor,
          state.settings.weekStartsOn ?? 1,
        )
      : monthDateRange(historyAnchor).filter((date) => date <= today);
  // Keep the visual and summaries on the same calendar range. This also makes
  // Month agree with the Leaderboard Month calculation.
  const summaryDates = dates.filter((date) => date <= today);
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

  const finishEditing = useCallback(() => {
    const pendingOrder = orderDraftRef.current;
    if (pendingOrder?.length)
      updateSettings({ progressMetricOrderIds: pendingOrder });
    orderDraftRef.current = null;
    setOrderDraft(null);
    setEditing(false);
    setShowPicker(false);
  }, [updateSettings]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!editing) return false;
        finishEditing();
        return true;
      });
      return () => subscription.remove();
    }, [editing, finishEditing]),
  );

  function select(ids: string[]) {
    setSelectedIds(ids);
    const orderedIds = [
      ...configuredOrder,
      ...(ids.includes(TRACKED) ? [TRACKED] : []),
      ...state.metrics.map((metric) => metric.id),
      ...ids,
    ].filter(
      (id, index, all) => all.indexOf(id) === index,
    );
    updateSettings({
      progressMetricIds: ids,
      progressMetricOrderIds: orderedIds,
    });
  }
  function move(metricId: string, targetIndex: number) {
    const current = [...progressCardIds];
    const index = current.indexOf(metricId);
    if (index < 0) return;
    const [item] = current.splice(index, 1);
    current.splice(Math.max(0, Math.min(targetIndex, current.length)), 0, item);
    const visibleIds = new Set(current);
    const universe = [
      ...configuredOrder,
      TRACKED,
      ...state.metrics.map((metric) => metric.id),
    ].filter((id, position, all) => all.indexOf(id) === position);
    let visibleIndex = 0;
    const progressMetricOrderIds = universe.map((id) =>
      visibleIds.has(id) ? current[visibleIndex++] : id,
    );
    progressMetricOrderIds.push(...current.slice(visibleIndex));
    if (editing) {
      orderDraftRef.current = progressMetricOrderIds;
      setOrderDraft(progressMetricOrderIds);
      return;
    }
    updateSettings({ progressMetricOrderIds });
  }

  function openDay(day: string) {
    router.navigate({
      pathname: "/day/[date]" as never,
      params: {
        date: day,
        // Pass the visible Progress selection even when it came from saved
        // settings. Calculated trackers have a daily value but no raw entry,
        // so the day view cannot infer them from entry IDs alone.
        metrics: selectedIds.join(","),
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
          ? metricVisualProgress(
              state,
              metric,
              state.currentUserId,
              day,
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
  ].slice(0, 6);
  const shiftVisualPeriod = useCallback((direction: -1 | 1) => {
    if (view === "week") {
      const next = dateWithOffsetFrom(historyAnchor, direction * 7);
      setHistoryAnchor(next > today ? today : next);
      return;
    }
    const current = new Date(`${historyAnchor}T12:00:00`);
    current.setDate(1);
    current.setMonth(current.getMonth() + direction);
    const next = dateKey(current);
    if (next.slice(0, 7) <= today.slice(0, 7)) setHistoryAnchor(next);
  }, [historyAnchor, setHistoryAnchor, today, view]);
  const visualSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !editing &&
          Math.abs(gesture.dx) > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -50) shiftVisualPeriod(1);
          else if (gesture.dx > 50) shiftVisualPeriod(-1);
        },
      }),
    [editing, shiftVisualPeriod],
  );

  if (progressMode !== "overview")
    return (
      <View style={styles.pageSwipe} {...pageViewSwipeResponder.panHandlers}>
      <GoalMapProgress
        state={state}
        metrics={selectedMetrics}
        selectedIds={
          tracked && !selectedIds.includes(TRACKED)
            ? [TRACKED, ...selectedIds]
            : selectedIds
        }
        mode={progressMode}
        range={historyRange}
        anchor={historyAnchor}
        onAnchorChange={setHistoryAnchor}
        onModeChange={setProgressMode}
        onRangeChange={setHistoryRange}
        onOpenDay={openDay}
        onOpenEditor={() => setEditing(true)}
        editing={editing}
        onDoneEditing={finishEditing}
        onRemove={(id) =>
          select(selectedIds.filter((candidate) => candidate !== id))
        }
        onMove={move}
        onAddExisting={() => setShowPicker(true)}
        onOpenFilters={() => setShowViewFilters(true)}
        orderedIds={progressCardIds}
      />
      <AddTrackerModal
        visible={showPicker}
        items={hiddenItems}
        onClose={() => setShowPicker(false)}
        onAdd={(id) => {
          select([...selectedIds, id]);
          setShowPicker(false);
        }}
      />
      <TrackerViewFilterSheet
        visible={showViewFilters}
        scope="progress"
        onClose={() => setShowViewFilters(false)}
      />
      </View>
    );

  return (
    <View style={styles.pageSwipe} {...pageViewSwipeResponder.panHandlers}>
    <Screen
      scrollRef={overviewScrollRef}
      contentContainerStyle={{ paddingBottom: 14 }}
      refreshEnabled={!editing}
    >
      <PageHeader
        title="Progress"
        action={
          editing ? (
            <View style={styles.headerEditActions}>
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/customize",
                  params: { tab: "insights" },
                } as never)
              }
              style={[styles.headerEditIcon, { borderColor: colors.border }]}
            >
              <Ionicons name="settings-outline" size={17} color={accent} />
            </Pressable>
            <Pressable
              onPress={finishEditing}
              style={[styles.done, { backgroundColor: accent }]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityLabel="Open performance"
              onPress={() => router.push("/performance" as never)}
              style={[styles.headerEditIcon, { borderColor: colors.border }]}
            >
              <Ionicons name="speedometer-outline" size={17} color={accent} />
            </Pressable>
          )
        }
      />
      <ProgressModeBar
        mode={progressMode}
        onChange={setProgressMode}
      />
      <TutorialTarget id="progress-visual">
      <View {...visualSwipeResponder.panHandlers}>
      {view === "month" ? (
        <Card style={styles.visualCard}>
          <View style={styles.cardHeading}>
            <Text style={[styles.eyebrow, { color: accent }]}>MONTH VIEW</Text>
            <InfoPopover
              label="Explain month view"
              message="Each color is one selected tracker. Tap a date to open that day's filtered log."
            />
          </View>
          <MonthCalendar
            selectedDate={today}
            monthDate={historyAnchor}
            onMonthChange={setHistoryAnchor}
            onSelect={openDay}
            dayStatus={status}
            dayVisuals={dayVisuals}
            allTrackedGoalsMet={(day) =>
              trackedGoalSummary(state, state.currentUserId, day).allMet
            }
            vacationDay={(day) =>
              isVacationDate(state, state.currentUserId, day)
            }
          />
          <View style={styles.legendWrap}>
            {legendItems.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.legendItem,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.canvas,
                  },
                ]}
              >
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={[styles.legendName, { color: colors.muted }]}>
                  {item.name}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={[
              styles.mode,
              styles.modeInside,
              { borderTopColor: colors.border },
            ]}
          >
            <Chip label="Week" selected={false} onPress={() => setHistoryRange("week")} />
            <Chip label="Month" selected onPress={() => setHistoryRange("month")} />
          </View>
        </Card>
      ) : (
        <Card style={styles.visualCard}>
          <View style={styles.weekNav}>
            <Pressable
              onPress={() => setHistoryAnchor(dateWithOffsetFrom(historyAnchor, -7))}
              style={[styles.arrow, { backgroundColor: colors.canvas }]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <View style={styles.navCopy}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>
                Week
              </Text>
              <Text style={[styles.legend, { color: colors.muted }]}>
                {friendlyDate(dates[0])} – {friendlyDate(dates[6])}
              </Text>
            </View>
            <Pressable
              disabled={historyAnchor >= today}
              onPress={() =>
                setHistoryAnchor(
                  dateWithOffsetFrom(historyAnchor, 7) > today
                    ? today
                    : dateWithOffsetFrom(historyAnchor, 7),
                )
              }
              style={[styles.arrow, { backgroundColor: colors.canvas }]}
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={historyAnchor >= today ? colors.faint : colors.ink}
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
                    .slice(0, 6)
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
          <View style={styles.legendWrap}>
            {legendItems.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.legendItem,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.canvas,
                  },
                ]}
              >
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={[styles.legendName, { color: colors.muted }]}>
                  {item.name}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={[
              styles.mode,
              styles.modeInside,
              { borderTopColor: colors.border },
            ]}
          >
            <Chip label="Week" selected onPress={() => setHistoryRange("week")} />
            <Chip label="Month" selected={false} onPress={() => setHistoryRange("month")} />
          </View>
        </Card>
      )}
      </View>
      </TutorialTarget>
      <SectionHeader
        title={`${view === "week" ? "Week" : "Month"} summaries`}
        action={
          <Pressable
            onPress={() => setShowViewFilters(true)}
            style={styles.activeFilter}
          >
            <Ionicons name="funnel-outline" size={11} color={accent} />
            <Text style={[styles.activeFilterText, { color: accent }]}>
              {activeTrackerViewLabel(state, "progress")}
            </Text>
          </Pressable>
        }
      />
      <View style={styles.summaries}>
        {progressCardIds.map((itemId, index) =>
          itemId === TRACKED ? (
            <TrackedSummary
              key={TRACKED}
              state={state}
              dates={summaryDates}
              editing={editing}
              index={index}
              count={progressCardIds.length}
              onEdit={() => setEditing(true)}
              onMove={(target) => move(TRACKED, target)}
              onRemove={() =>
                select(selectedIds.filter((id) => id !== TRACKED))
              }
            />
          ) : (
            <MetricSummary
              key={itemId}
              state={state}
              metric={selectedMetrics.find((metric) => metric.id === itemId)!}
              dates={summaryDates}
              editing={editing}
              index={index}
              count={progressCardIds.length}
              onEdit={() => setEditing(true)}
              onMove={(target) => move(itemId, target)}
              onRemove={() =>
                select(selectedIds.filter((id) => id !== itemId))
              }
            />
          ),
        )}
      </View>
      {editing ? (
        <View style={styles.editActions}>
          <Pressable
            onPress={() => setShowPicker((value) => !value)}
            style={[
              styles.addExisting,
              styles.editActionButton,
              { borderColor: accent },
            ]}
          >
            <Ionicons name="add" size={18} color={accent} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[styles.addExistingText, { color: accent }]}
            >
              Add existing tracker
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              router.navigate({
                pathname: "/customize",
                params: { tab: "goals" },
              } as never)
            }
            style={[
              styles.addExisting,
              styles.editActionButton,
              { borderColor: accent },
            ]}
          >
            <Ionicons name="flag-outline" size={17} color={accent} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[styles.addExistingText, { color: accent }]}
            >
              Edit tracked goals
            </Text>
          </Pressable>
        </View>
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
      <TrackerViewFilterSheet
        visible={showViewFilters}
        scope="progress"
        onClose={() => setShowViewFilters(false)}
      />
    </Screen>
    </View>
  );
}

function ProgressModeBar({
  mode,
  onChange,
}: {
  mode: ProgressViewMode;
  onChange: (mode: ProgressViewMode) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 45) return;
          const index = PROGRESS_MODE_ORDER.indexOf(mode);
          const offset = gesture.dx < 0 ? 1 : -1;
          onChange(
            PROGRESS_MODE_ORDER[
              (index + offset + PROGRESS_MODE_ORDER.length) %
                PROGRESS_MODE_ORDER.length
            ],
          );
        },
      }),
    [mode, onChange],
  );
  return (
    <View
      {...swipeResponder.panHandlers}
      style={[
        styles.progressModes,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {(
        [
          ["overview", "Overview", "stats-chart-outline"],
          ["goal_maps", "Grid map", "calendar-outline"],
        ] as const
      ).map(([value, label, icon]) => {
        const selected = mode === value;
        return (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            style={[
              styles.progressMode,
              selected && { backgroundColor: `${accent}18` },
            ]}
          >
            <Ionicons
              name={icon}
              size={14}
              color={selected ? accent : colors.muted}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.progressModeText,
                { color: selected ? accent : colors.muted },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
      <View style={styles.modeHelp}>
        <InfoPopover
          label="Explain Progress views"
          message="Overview compares averages and streaks. Grid map shows one color map per tracker; its compact layout is available while editing."
        />
      </View>
    </View>
  );
}

function GoalMapProgress({
  state,
  metrics,
  selectedIds,
  mode,
  range,
  anchor,
  onAnchorChange,
  onModeChange,
  onRangeChange,
  onOpenDay,
  onOpenEditor,
  editing,
  onDoneEditing,
  onRemove,
  onMove,
  onAddExisting,
  onOpenFilters,
  orderedIds,
}: {
  state: AppState;
  metrics: MetricDefinition[];
  selectedIds: string[];
  mode: ProgressViewMode;
  range: HistoryRange;
  anchor: string;
  onAnchorChange: (date: string) => void;
  onModeChange: (mode: ProgressViewMode) => void;
  onRangeChange: (range: HistoryRange) => void;
  onOpenDay: (date: string) => void;
  onOpenEditor: () => void;
  editing: boolean;
  onDoneEditing: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, target: number) => void;
  onAddExisting: () => void;
  onOpenFilters: () => void;
  orderedIds: string[];
}) {
  const { updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const today = dateKey();
  const compact = state.settings.compactProgressGrid === true;
  const visibleMetrics = metrics;
  const trackedSelected = selectedIds.includes(TRACKED);
  const gridItemIds = orderedIds.filter(
    (id) =>
      (id === TRACKED && trackedSelected) ||
      visibleMetrics.some((metric) => metric.id === id),
  );
  const dates = calendarPeriodRange(
    anchor,
    range,
    state.settings.weekStartsOn ?? 1,
  );
  const shift = (direction: -1 | 1) => {
    const date = new Date(`${anchor}T12:00:00`);
    if (range === "week") date.setDate(date.getDate() + direction * 7);
    else if (range === "month") date.setMonth(date.getMonth() + direction);
    else date.setFullYear(date.getFullYear() + direction);
    const next = dateKey(date);
    if (next <= today || direction < 0) onAnchorChange(next);
  };
  const label =
    range === "week"
      ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[6])}`
      : new Intl.DateTimeFormat(undefined, {
          month: range === "month" ? "long" : undefined,
          year: "numeric",
        }).format(new Date(`${anchor}T12:00:00`));
  const trackedTotals = dates
    .filter((date) => date <= today)
    .map((date) => trackedGoalSummary(state, state.currentUserId, date));
  const trackedMet = trackedTotals.reduce((sum, item) => sum + item.met, 0);
  const trackedPossible = trackedTotals.reduce(
    (sum, item) => sum + item.total,
    0,
  );
  const trackedCompletion = trackedPossible
    ? Math.round((trackedMet / trackedPossible) * 100)
    : 0;
  return (
    <Screen contentContainerStyle={{ paddingBottom: 14 }}>
      <PageHeader
        title="Progress"
        action={
          editing ? (
            <View style={styles.headerEditActions}>
              <Pressable
                accessibilityLabel="Customize Progress"
                onPress={() =>
                  router.navigate({
                    pathname: "/customize",
                    params: { tab: "insights" },
                  } as never)
                }
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons name="settings-outline" size={17} color={accent} />
              </Pressable>
              <Pressable
                accessibilityLabel="Toggle compact grid"
                onPress={() =>
                  updateSettings({ compactProgressGrid: !compact })
                }
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons
                  name={compact ? "grid" : "grid-outline"}
                  size={17}
                  color={accent}
                />
              </Pressable>
              <Pressable
                onPress={onDoneEditing}
                style={[styles.done, { backgroundColor: accent }]}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.headerEditActions}>
              <Pressable
                accessibilityLabel="Toggle compact grid"
                onPress={() =>
                  updateSettings({ compactProgressGrid: !compact })
                }
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons
                  name={compact ? "grid" : "grid-outline"}
                  size={17}
                  color={accent}
                />
              </Pressable>
              <Pressable
                accessibilityLabel="Open performance"
                onPress={() => router.push("/performance" as never)}
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons
                  name="speedometer-outline"
                  size={17}
                  color={accent}
                />
              </Pressable>
            </View>
          )
        }
      />
      <ProgressModeBar mode={mode} onChange={onModeChange} />
      <Card style={styles.mapControls}>
        <View style={styles.rangeRow}>
          {(["week", "month", "year"] as HistoryRange[]).map((item) => (
            <Chip
              key={item}
              label={
                item === "week"
                  ? "Week"
                  : item === "month"
                    ? "Month"
                    : "Year"
              }
              selected={range === item}
              onPress={() => onRangeChange(item)}
            />
          ))}
          <Pressable
            onPress={onOpenFilters}
            style={styles.compactFilter}
          >
            <Ionicons name="funnel-outline" size={13} color={accent} />
            <Text
              numberOfLines={1}
              style={[styles.mapUtilityText, { color: accent }]}
            >
              {activeTrackerViewLabel(state, "progress")}
            </Text>
          </Pressable>
          <InfoPopover
            label="Explain grid colors"
            message="Grey: not logged. Red: goal missed. Pink: skipped or vacation. Lime: goal met. Orange: logged without a goal."
          />
        </View>
        <View style={styles.periodNav}>
          <Pressable
            onPress={() => shift(-1)}
            style={[styles.mapArrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Text style={[styles.mapPeriod, { color: colors.ink }]}>{label}</Text>
          <Pressable
            onPress={() => shift(1)}
            style={[styles.mapArrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        </View>
      </Card>
      <View
        style={compact ? styles.compactMaps : styles.detailedMaps}
      >
        {gridItemIds.map((itemId, index) =>
          itemId === TRACKED ? (
          <MapReorderCard
            key={TRACKED}
            editing={editing}
            index={index}
            count={gridItemIds.length}
            onMove={(target) => onMove(TRACKED, target)}
            onPress={() => onOpenDay(anchor)}
            onLongPress={onOpenEditor}
            wrapStyle={
              compact
                ? range === "month" && !editing
                  ? styles.compactMapWrap
                  : styles.fullMapWrap
                : undefined
            }
          >
            <Card
              style={[
                styles.mapCard,
                compact && styles.compactMapCard,
                compact && range === "year" && styles.compactYearMapCard,
                editing && styles.mapEditingCard,
              ]}
            >
              <View
                style={[
                  styles.mapHeading,
                  compact && styles.compactMapHeading,
                ]}
              >
                {compact ? (
                  <>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.mapName,
                        styles.compactMapName,
                        { color: colors.ink },
                      ]}
                    >
                      Tracked goals
                    </Text>
                    <Text
                      style={[
                        styles.compactPercent,
                        { color: TRACKED_COLOR },
                      ]}
                    >
                      {trackedCompletion}%
                    </Text>
                  </>
                ) : (
                  <>
                    <View
                      style={[
                        styles.mapIcon,
                        { backgroundColor: `${TRACKED_COLOR}18` },
                      ]}
                    >
                      <Ionicons
                        name="checkmark-done-outline"
                        size={16}
                        color={TRACKED_COLOR}
                      />
                    </View>
                    <View style={styles.grow}>
                      <Text style={[styles.mapName, { color: colors.ink }]}>
                        Tracked goals
                      </Text>
                      <Text style={[styles.mapMeta, { color: colors.muted }]}>
                        {trackedCompletion}% · {trackedMet}/{trackedPossible} goals
                      </Text>
                      <Text style={[styles.mapMeta, { color: colors.muted }]}>
                        Best streak{" "}
                        {
                          trackedGoalStreakStats(
                            state,
                            state.currentUserId,
                            today,
                          ).best
                        }
                        d
                      </Text>
                    </View>
                    <View style={styles.mapStreak}>
                      <Ionicons name="flame" size={12} color={TRACKED_COLOR} />
                      <Text
                        style={[
                          styles.mapStreakText,
                          { color: TRACKED_COLOR },
                        ]}
                      >
                        {
                          trackedGoalStreakStats(
                            state,
                            state.currentUserId,
                            today,
                          ).current
                        }
                      </Text>
                    </View>
                    <Ionicons name="flag" size={13} color={accent} />
                  </>
                )}
                {editing ? (
                  <Pressable
                    onPress={() => onRemove(TRACKED)}
                    style={styles.remove}
                    hitSlop={7}
                  >
                    <Ionicons name="remove" size={15} color={palette.white} />
                  </Pressable>
                ) : null}
              </View>
              <TrackedGoalsHeatmap
                state={state}
                dates={dates}
                range={range}
                compact={compact}
                onSelect={onOpenDay}
              />
            </Card>
          </MapReorderCard>
        ) : (() => {
          const metric = visibleMetrics.find(
            (candidate) => candidate.id === itemId,
          );
          if (!metric) return null;
          const period = metricPeriodStats(
            state,
            metric,
            state.currentUserId,
            dates.filter((date) => date <= today),
          );
          const completionDenominator = metric.goalEnabled
            ? period.applicableDates.length
            : dates.filter((date) => date <= today).length;
          const completionNumerator = metric.goalEnabled
            ? period.goalsReached
            : period.loggedDates.length;
          const completion = completionDenominator
            ? Math.round(
                (completionNumerator / completionDenominator) * 100,
              )
            : 0;
          return (
            <MapReorderCard
              key={metric.id}
              editing={editing}
              index={index}
              count={gridItemIds.length}
              onLongPress={onOpenEditor}
              onPress={() =>
                router.navigate({
                  pathname: "/metric-detail",
                  params: { metric: metric.id, date: anchor },
                } as never)
              }
              wrapStyle={
                editing
                  ? styles.fullMapWrap
                  : compact
                  ? range === "month"
                    ? styles.compactMapWrap
                    : styles.fullMapWrap
                  : undefined
              }
              onMove={(target) => onMove(metric.id, target)}
            >
              <Card
                style={[
                  styles.mapCard,
                  compact && styles.compactMapCard,
                  compact && range === "year" && styles.compactYearMapCard,
                  editing && styles.mapEditingCard,
                ]}
              >
                <View
                  style={[
                    styles.mapHeading,
                    compact && styles.compactMapHeading,
                  ]}
                >
                  {compact ? (
                    <>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.mapName,
                          styles.compactMapName,
                          { color: colors.ink },
                        ]}
                      >
                        {metric.name}
                      </Text>
                      <Text
                        style={[
                          styles.compactPercent,
                          { color: metric.color },
                        ]}
                      >
                        {completion}%
                      </Text>
                    </>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.mapIcon,
                          { backgroundColor: `${metric.color}18` },
                        ]}
                      >
                        <Ionicons
                          name={metric.icon as keyof typeof Ionicons.glyphMap}
                          size={16}
                          color={metric.color}
                        />
                      </View>
                      <View style={styles.grow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.mapName, { color: colors.ink }]}
                        >
                          {metric.name}
                        </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.mapMeta, { color: colors.muted }]}
                    >
                      {metric.dataType === "boolean"
                        ? `${period.goalsReached}/${period.applicableDates.length} complete`
                        : `${formatMetricValue(metric, period.average)} avg`}
                      {" · "}
                      {period.goalsReached}/{period.applicableDates.length} goal
                      days
                      {metric.dataType !== "boolean"
                        ? ` · ${period.loggedDates.length} logged · ${metricAverageGoalOffsetLabel(
                            metric,
                            period.average,
                            period.averageTarget,
                          )}`
                        : ""}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.mapMeta, { color: colors.muted }]}
                    >
                      Overall{" "}
                      {formatMetricValue(
                        metric,
                        metricOverallAverage(
                          state,
                          metric,
                          state.currentUserId,
                          today,
                        ),
                      )}
                      {" · Best "}
                      {
                        metricStreakStats(
                          state,
                          metric,
                          state.currentUserId,
                          today,
                        ).best
                      }
                      d
                    </Text>
                      </View>
                      <View style={styles.mapStreak}>
                        <Ionicons name="flame" size={12} color={metric.color} />
                        <Text
                          style={[
                            styles.mapStreakText,
                            { color: metric.color },
                          ]}
                        >
                          {
                            metricStreakStats(
                              state,
                              metric,
                              state.currentUserId,
                              today,
                            ).current
                          }
                        </Text>
                      </View>
                      {isMetricTrackedOnDate(state, metric, today) ? (
                        <Ionicons name="flag" size={13} color={accent} />
                      ) : null}
                    </>
                  )}
                  {editing &&
                  isMetricTrackedOnDate(state, metric, today) ? (
                    <Pressable
                      onPress={() =>
                        router.navigate({
                          pathname: "/metric-editor",
                          params: {
                            id: metric.id,
                            focus: "goal-start",
                          },
                        } as never)
                      }
                      style={[styles.dateEdit, { borderColor: colors.border }]}
                      hitSlop={7}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={15}
                        color={accent}
                      />
                    </Pressable>
                  ) : null}
                  {editing ? (
                    <Pressable
                      onPress={() => onRemove(metric.id)}
                      style={styles.remove}
                      hitSlop={7}
                    >
                      <Ionicons name="remove" size={15} color={palette.white} />
                    </Pressable>
                  ) : null}
                </View>
                <GoalHeatmap
                  state={state}
                  metric={metric}
                  dates={dates}
                  range={range}
                  compact={compact}
                  onSelect={onOpenDay}
                />
              </Card>
            </MapReorderCard>
          );
        })(),
        )}
      </View>
      {editing ? (
        <View style={styles.editActions}>
        <Pressable
          onPress={onAddExisting}
          style={[
            styles.addExisting,
            styles.editActionButton,
            { borderColor: accent },
          ]}
        >
          <Ionicons name="add" size={17} color={accent} />
          <Text style={[styles.addExistingText, { color: accent }]}>
            Add existing tracker
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            router.navigate({
              pathname: "/customize",
              params: { tab: "goals" },
            } as never)
          }
          style={[
            styles.addExisting,
            styles.editActionButton,
            { borderColor: accent },
          ]}
        >
          <Ionicons name="flag-outline" size={17} color={accent} />
          <Text style={[styles.addExistingText, { color: accent }]}>
            Tracked goals
          </Text>
        </Pressable>
        </View>
      ) : null}
      {!visibleMetrics.length ? (
        <Card>
          <Text style={[styles.hint, { color: colors.muted }]}>
            No trackers match this view. Choose All trackers or edit the
            Progress selection.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function MapReorderCard({
  editing,
  index,
  count,
  onMove,
  onPress,
  onLongPress,
  wrapStyle,
  children,
}: {
  editing: boolean;
  index: number;
  count: number;
  onMove: (target: number) => void;
  onPress: () => void;
  onLongPress: () => void;
  wrapStyle?: object | false;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const step = useRef(112);
  const origin = useRef(index);
  const target = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
  useEffect(() => {
    if (!editing) {
      wiggle.stopAnimation();
      wiggle.setValue(0);
      dragY.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, {
          toValue: 1,
          duration: 145,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: -1,
          duration: 290,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: 0,
          duration: 145,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [dragY, editing, wiggle]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        onPanResponderGrant: () => {
          origin.current = indexRef.current;
          target.current = indexRef.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(gesture.dy);
          target.current = Math.max(
            0,
            Math.min(
              countRef.current - 1,
              origin.current + Math.round(gesture.dy / step.current),
            ),
          );
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderRelease: () => {
          const next = target.current;
          dragY.setValue(0);
          setDragging(false);
          if (next !== origin.current) onMoveRef.current(next);
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          setDragging(false);
        },
      }),
    [dragY, editing],
  );
  return (
    <Animated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 8;
      }}
      style={[
        wrapStyle,
        {
          zIndex: dragging ? 20 : editing ? 3 : 0,
          elevation: dragging ? 12 : 0,
          transform: [
            { translateY: dragY },
            { scale: dragging ? 1.01 : 1 },
            {
              rotate: wiggle.interpolate({
                inputRange: [-1, 1],
                outputRange: ["-0.25deg", "0.25deg"],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={editing ? undefined : onPress}
        onLongPress={onLongPress}
        style={editing ? { borderColor: colors.border } : undefined}
      >
        {children}
      </Pressable>
      {editing ? (
        <View
          accessibilityLabel="Drag to reorder"
          collapsable={false}
          style={[
            styles.mapDragHandle,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          {...responder.panHandlers}
        >
          <Ionicons
            name="reorder-three-outline"
            size={22}
            color={colors.muted}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

function TrackedSummary({
  state,
  dates,
  editing,
  index,
  count,
  onEdit,
  onMove,
  onRemove,
}: {
  state: AppState;
  dates: string[];
  editing: boolean;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
}) {
  const colors = useAppColors();
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const step = useRef(93);
  const origin = useRef(index);
  const target = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
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
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        onPanResponderGrant: () => {
          origin.current = indexRef.current;
          target.current = indexRef.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(gesture.dy);
          target.current = Math.max(
            0,
            Math.min(
              countRef.current - 1,
              origin.current + Math.round(gesture.dy / step.current),
            ),
          );
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderRelease: () => {
          const next = target.current;
          dragY.setValue(0);
          setDragging(false);
          if (next !== origin.current) onMoveRef.current(next);
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          setDragging(false);
        },
      }),
    [dragY, editing],
  );
  const totals = dates.map((date) =>
    trackedGoalSummary(state, state.currentUserId, date),
  );
  const eligible = totals.filter((item) => item.total > 0);
  const met = totals.reduce((sum, item) => sum + item.met, 0);
  const possible = totals.reduce((sum, item) => sum + item.total, 0);
  const perfect = eligible.filter((item) => item.allMet).length;
  const streaks = trackedGoalStreakStats(state, state.currentUserId);
  const completion = possible ? Math.round((met / possible) * 100) : 0;
  return (
    <Animated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 9;
      }}
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
          zIndex: dragging ? 30 : editing ? 3 : 0,
          elevation: dragging ? 14 : 0,
        },
      ]}
    >
    <Pressable style={styles.summaryWrap} onLongPress={onEdit}>
    <Card style={styles.summary}>
      {editing ? (
        <View
          collapsable={false}
          style={styles.drag}
          {...responder.panHandlers}
        >
          <Ionicons
            name="reorder-three-outline"
            size={23}
            color={colors.faint}
          />
        </View>
      ) : null}
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
        <View style={styles.streakRow}>
          <Ionicons name="flame" size={12} color={TRACKED_COLOR} />
          <Text style={[styles.goalLine, { color: TRACKED_COLOR }]}>
            {streaks.current}d
          </Text>
        </View>
        <Text style={[styles.streakLine, { color: colors.muted }]}>Best streak {streaks.best}d</Text>
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
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const dragOrigin = useRef(index);
  const liveTarget = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  const dragStep = useRef(93);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
  useEffect(() => {
    if (!editing) {
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
  }, [dragY, editing, wiggle]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        onPanResponderGrant: () => {
          dragOrigin.current = indexRef.current;
          liveTarget.current = indexRef.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          const target = Math.max(
            0,
            Math.min(
              countRef.current - 1,
              dragOrigin.current + Math.round(gesture.dy / dragStep.current),
            ),
          );
          dragY.setValue(gesture.dy);
          if (target !== liveTarget.current) {
            liveTarget.current = target;
          }
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderRelease: () => {
          const target = liveTarget.current;
          dragY.setValue(0);
          if (target !== dragOrigin.current) onMoveRef.current(target);
          setDragging(false);
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          setDragging(false);
        },
      }),
    [dragY, editing],
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
    dateKey(),
  );
  const overall = metricOverallAverage(
    state,
    metric,
    state.currentUserId,
    dates[dates.length - 1],
  );
  const isBoolean = metric.dataType === "boolean";
  const isTodo = metric.id === "todo_completion";
  const todoPossible = isTodo
    ? dates.reduce(
        (sum, date) =>
          sum +
          (state.todos ?? []).filter((todo) => todoAppearsOnDate(todo, date))
            .length,
        0,
      )
    : 0;
  const todoCompleted = isTodo
    ? dates.reduce(
        (sum, date) =>
          sum +
          (state.todos ?? []).filter(
            (todo) =>
              todoAppearsOnDate(todo, date) &&
              todoResolvedOnDate(todo, date),
          ).length,
        0,
      )
    : 0;
  const todoCompletion = todoPossible
    ? Math.round((todoCompleted / todoPossible) * 100)
    : 0;
  const trackedGoal = isMetricTrackedOnDate(
    state,
    metric,
    dateKey(),
  );
  const weightStats =
    metric.id === "weight"
      ? weightProgressStats(state, state.currentUserId, dates[dates.length - 1])
      : null;
  return (
    <Animated.View
      onLayout={(event) => {
        dragStep.current = event.nativeEvent.layout.height + 9;
      }}
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
          zIndex: dragging ? 20 : editing ? 3 : 0,
          elevation: dragging ? 12 : 0,
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
          <View
            collapsable={false}
            style={styles.drag}
            {...responder.panHandlers}
          >
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
          <View style={styles.summaryTitleLine}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              style={[
                styles.summaryName,
                styles.summaryNameRow,
                styles.summaryTitleText,
                { color: colors.ink },
              ]}
            >
              {metric.name}
            </Text>
            {trackedGoal ? (
              <View
                accessibilityLabel="Tracked goal"
                style={[
                  styles.trackedMarker,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Ionicons name="flag" size={9} color={accent} />
              </View>
            ) : null}
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.summaryValue, { color: colors.ink }]}
          >
          {isTodo
              ? `${todoCompletion}%`
              : isBoolean
              ? `${applicable.length ? Math.round((reached / applicable.length) * 100) : 0}%`
              : Math.abs(average) >= 100
                ? Math.round(average).toLocaleString()
                : (Math.round(average * 10) / 10).toLocaleString()}
          </Text>
          {isTodo ? (
            <Text style={[styles.summaryUnit, { color: colors.muted }]}>
              {todoPossible ? `${todoCompleted}/${todoPossible} completed` : "No to-dos"}
            </Text>
          ) : isBoolean ? (
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
          {isTodo
            ? todoPossible
              ? `${todoCompleted}/${todoPossible} to-dos completed in this range`
              : "No to-dos scheduled in this range"
            : weightStats
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
        <View style={styles.streakRow}>
          <Ionicons name="flame" size={12} color={metric.color} />
          <Text style={[styles.streakLine, { color: colors.muted }]}>
            {streaks.current}d · Best {streaks.best}d
          </Text>
        </View>
        </View>
        {editing ? (
          <View style={styles.cardEditActions}>
            {trackedGoal ? (
              <Pressable
                accessibilityLabel={`Change ${metric.name} goal start date`}
                onPress={() =>
                  router.push({
                    pathname: "/metric-editor" as never,
                    params: { id: metric.id, focus: "goal-start" },
                  })
                }
                style={[styles.goalDate, { borderColor: colors.border }]}
                hitSlop={6}
              >
                <Ionicons name="calendar-outline" size={15} color={accent} />
              </Pressable>
            ) : null}
            <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
              <Ionicons name="remove" size={16} color={palette.white} />
            </Pressable>
          </View>
        ) : null}
      </Card>
    </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pageSwipe: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  progressModes: {
    minHeight: 42,
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 3,
    marginTop: -7,
    marginBottom: 9,
  },
  progressMode: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  progressModeText: { fontSize: 8, fontWeight: "900" },
  modeHelp: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  activeFilter: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 2,
    marginBottom: 5,
  },
  activeFilterText: { fontSize: 8, fontWeight: "900" },
  mapControls: { gap: 8, marginBottom: 9 },
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  compactFilter: {
    flex: 1,
    minWidth: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  periodNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mapArrow: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPeriod: {
    flex: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
  },
  mapUtilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mapUtility: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
  },
  mapUtilityText: { fontSize: 8, fontWeight: "900" },
  mapFilter: {
    flex: 1,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  mapFilterRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  detailedMaps: { gap: 8 },
  compactMaps: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    alignItems: "flex-start",
  },
  compactMapWrap: { width: "48.8%" },
  fullMapWrap: { width: "100%" },
  mapCard: { gap: 8 },
  mapEditingCard: { paddingLeft: 46 },
  mapDragHandle: {
    position: "absolute",
    left: 9,
    top: 12,
    width: 30,
    height: 30,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 40,
    elevation: 16,
  },
  compactMapCard: {
    minHeight: 0,
    paddingHorizontal: 7,
    paddingVertical: 7,
    gap: 4,
  },
  compactYearMapCard: {
    paddingHorizontal: 12,
    paddingBottom: 9,
  },
  mapHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  compactMapHeading: { gap: 5 },
  compactMapName: { flex: 1, fontSize: 8 },
  compactPercent: { fontSize: 9, fontWeight: "900" },
  mapIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  mapName: { fontSize: 9, fontWeight: "900" },
  mapMeta: { fontSize: 7, fontWeight: "700", marginTop: 1 },
  mapStreak: {
    minWidth: 27,
    height: 22,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  mapStreakText: { fontSize: 8, fontWeight: "900" },
  headerEditActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerEditIcon: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  addExisting: { minHeight: 42, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
  addExistingText: { fontSize: 10, fontWeight: "900" },
  editActions: { flexDirection: "row", gap: 7 },
  editActionButton: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  editHint: { alignItems: "center", paddingVertical: 8 },
  drag: { width: 28, alignItems: "center", justifyContent: "center" },
  remove: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center" },
  dateEdit: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardEditActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  goalDate: { width: 27, height: 27, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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
  modeInside: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
    justifyContent: "center",
  },
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
  legendWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { color: palette.muted, fontSize: 7, fontWeight: "800" },
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
  summaryTitleLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryTitleText: { flexShrink: 1 },
  trackedMarker: {
    width: 18,
    height: 18,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
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
  streakRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  streakLine: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    marginTop: 0,
    textAlign: "right",
  },
});
