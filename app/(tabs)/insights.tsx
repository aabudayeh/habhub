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
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { AppText as Text } from "@/src/components/AppText";
import { useLocale, useTranslation } from "@/src/i18n";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { useFocusedCloudSyncPause } from "@/src/cloud/useFocusedCloudSyncPause";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { TrackerViewFilterSheet } from "@/src/components/TrackerViewFilterSheet";
import { InfoPopover } from "@/src/components/InfoPopover";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { useEditWiggle } from "@/src/components/useEditWiggle";
import {
  cachedGoalHeatmapModel,
  cachedTrackedGoalsHeatmapModel,
  GoalHeatmap,
  TrackedGoalsHeatmap,
} from "@/src/components/GoalHeatmap";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Card,
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
  metricJourneyProgressStats,
  metricOverallAverage,
  metricPeriodStats,
  metricStreakStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalStreakStats,
  trackedGoalSummary,
  weightDailyGoalStatus,
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
import { metricVisualization } from "@/src/domain/visualization";
import { isVacationDate } from "@/src/domain/vacation";
import {
  todoAppearsOnDate,
  todoResolvedOnDate,
} from "@/src/domain/schedule";
import {
  activeTrackerViewLabel,
  activeTrackerViewId,
  ALL_AVAILABLE_TRACKERS_FILTER,
  ALL_TRACKERS_FILTER,
  TRACKED_ONLY_FILTER,
  metricMatchesActiveView,
} from "@/src/domain/viewFilters";

const TRACKED = "tracked_goals";
const TRACKED_COLOR = "#FFD166";
const WEEK_CHART_MAX = 1.4;
type ViewMode = "week" | "month";
const PROGRESS_MODE_ORDER: ProgressViewMode[] = [
  "overview",
  "goal_maps",
];

function bloodPressureProgressSummary(
  state: AppState,
  metric: MetricDefinition,
  dates: string[],
) {
  const isBloodPressure =
    metric.id === "blood_pressure_systolic" ||
    (metric.healthMapping?.dataType === "blood_pressure" &&
      metric.healthMapping.field === "systolic");
  if (!isBloodPressure) return null;
  const diastolic = state.metrics.find(
    (candidate) =>
      candidate.id === "blood_pressure_diastolic" ||
      (candidate.healthMapping?.dataType === "blood_pressure" &&
        candidate.healthMapping.field === "diastolic"),
  );
  if (!diastolic) return null;
  const systolicPeriod = metricPeriodStats(
    state,
    metric,
    state.currentUserId,
    dates,
  );
  const diastolicPeriod = metricPeriodStats(
    state,
    diastolic,
    state.currentUserId,
    dates,
  );
  const hasSystolic = systolicPeriod.loggedDates.length > 0;
  const hasDiastolic = diastolicPeriod.loggedDates.length > 0;
  const offset = (
    label: string,
    average: number,
    range: { min: number; max: number } | undefined,
  ) => {
    if (!range) return `${label} ${Math.round(average)} mmHg`;
    if (average > range.max)
      return `${label} ${Math.round(average - range.max)} high`;
    if (average < range.min)
      return `${label} ${Math.round(range.min - average)} low`;
    return `${label} in range`;
  };
  return {
    diastolic,
    systolicPeriod,
    diastolicPeriod,
    averageLabel: `${hasSystolic ? Math.round(systolicPeriod.average) : "—"}/${
      hasDiastolic ? Math.round(diastolicPeriod.average) : "—"
    }`,
    offsetLabel:
      [
        hasSystolic
          ? offset("SYS", systolicPeriod.average, metric.goalRange)
          : null,
        hasDiastolic
          ? offset("DIA", diastolicPeriod.average, diastolic.goalRange)
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || "No complete blood-pressure readings",
  };
}

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function holdProgressCloudSync(tutorialSandbox: boolean) {
  if (tutorialSandbox) return;
  setCloudSyncPaused("progress-edit", true);
}

function Insights() {
  const { state, updateSettings } = useApp();
  const locale = useLocale();
  const t = useTranslation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const tutorial = useTutorial();
  const tutorialSandbox = useTutorialSandboxActive();
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
  const [overviewVisualOpen, setOverviewVisualOpen] = useState(true);
  const overviewScrollRef = useRef<ScrollView>(null);
  const summarySectionY = useRef(0);
  const progressLayoutAvailability =
    state.settings.progressLayoutAvailability ?? "both";
  const availableProgressModes = useMemo<ProgressViewMode[]>(
    () =>
      progressLayoutAvailability === "overview"
        ? ["overview"]
        : progressLayoutAvailability === "goal_maps"
          ? ["goal_maps"]
          : PROGRESS_MODE_ORDER,
    [progressLayoutAvailability],
  );
  const savedProgressMode =
    state.settings.progressViewMode === "compact"
      ? "goal_maps"
      : (state.settings.progressViewMode ?? "overview");
  const progressMode = availableProgressModes.includes(savedProgressMode)
    ? savedProgressMode
    : availableProgressModes[0];
  useEffect(() => {
    // When Display settings hides the mode bar, its selected view must remain
    // usable: the hidden bar can no longer act as the expand control.
    if (availableProgressModes.length === 1) setOverviewVisualOpen(true);
  }, [availableProgressModes.length, progressMode]);
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
          availableProgressModes.length > 1 &&
          Math.abs(gesture.dx) > 24 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.45,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const index = availableProgressModes.indexOf(progressMode);
          const offset = gesture.dx < 0 ? 1 : -1;
          setProgressMode(
            availableProgressModes[
              (index + offset + availableProgressModes.length) %
                availableProgressModes.length
            ],
          );
        },
      }),
    [availableProgressModes, editing, progressMode, setProgressMode],
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
  useFocusedCloudSyncPause("progress-edit", editing);
  useEffect(() => {
    if (!editing || progressMode !== "overview") return;
    const timer = setTimeout(
      () =>
        overviewScrollRef.current?.scrollTo({
          y: Math.max(0, summarySectionY.current - 4),
          animated: true,
        }),
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
    activeProgressFilter === ALL_AVAILABLE_TRACKERS_FILTER
      ? orderedMetrics
      : activeProgressFilter === ALL_TRACKERS_FILTER
        ? orderedMetrics.filter((metric) => selectedIds.includes(metric.id))
        : orderedMetrics;
  const tracked =
    selectedIds.includes(TRACKED) ||
    activeProgressFilter === TRACKED_ONLY_FILTER;
  const pinnedProgressIds = state.settings.progressPinnedMetricIds ?? [];
  const pinPositions = new Map(
    pinnedProgressIds.map((metricId, index) => [metricId, index]),
  );
  const orderedProgressCardIds = [
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
  const progressCardIds = editing
    ? orderedProgressCardIds
    : [...orderedProgressCardIds].sort((left, right) => {
        const leftPin = pinPositions.get(left);
        const rightPin = pinPositions.get(right);
        if (leftPin === undefined && rightPin === undefined) return 0;
        if (leftPin === undefined) return 1;
        if (rightPin === undefined) return -1;
        return leftPin - rightPin;
      });
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

  const beginEditing = useCallback(() => {
    // Pause before the first drag event can mutate local draft ordering.
    holdProgressCloudSync(tutorialSandbox);
    setEditing(true);
  }, [tutorialSandbox]);

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
  function removeProgressCard(id: string) {
    const ids = selectedIds.filter((candidate) => candidate !== id);
    setSelectedIds(ids);
    updateSettings({
      progressMetricIds: ids,
      progressPinnedMetricIds: pinnedProgressIds.filter(
        (candidate) => candidate !== id,
      ),
      ...(activeProgressFilter !== ALL_TRACKERS_FILTER
        ? { activeProgressTrackerViewFilterId: ALL_TRACKERS_FILTER }
        : {}),
    });
  }
  function toggleProgressPin(id: string) {
    updateSettings({
      progressPinnedMetricIds: pinnedProgressIds.includes(id)
        ? pinnedProgressIds.filter((candidate) => candidate !== id)
        : [...pinnedProgressIds, id],
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
    tutorial.reportEvent({
      actionId: "tutorial.progress.open-day",
      scope: "isolated-preview",
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
      const reached =
        applicable &&
        scheduledGoalReached(state, metric, state.currentUserId, day);
      const value = safeMetricValue(state, metric, state.currentUserId, day);
      const isBloodPressure =
        metric.id === "blood_pressure_systolic" ||
        (metric.healthMapping?.dataType === "blood_pressure" &&
          metric.healthMapping.field === "systolic");
      const journeyProgress =
        isBloodPressure
          ? reached
            ? 1
            : 0
          : metric.id === "weight"
          ? weightDailyGoalStatus(state, state.currentUserId, day).progress
          : metric.goalProgressMode === "journey"
          ? metricJourneyProgressStats(
              state,
              metric,
              state.currentUserId,
              day,
            ).progress
          : null;
      return {
        id: metric.id,
        color: metric.color,
        chartStyle: "bar" as const,
        progress: applicable
          ? journeyProgress ?? metricVisualProgress(
              state,
              metric,
              state.currentUserId,
              day,
              value,
              effectiveGoalTarget(state, metric, state.currentUserId, day),
            )
          : 0,
        goalReached: reached,
      };
    });
    if (tracked)
      visuals.unshift({
        id: TRACKED,
        color: TRACKED_COLOR,
        chartStyle: "bar" as const,
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
        onOpenEditor={beginEditing}
        editing={editing}
        onDoneEditing={finishEditing}
        onRemove={removeProgressCard}
        onPin={toggleProgressPin}
        pinnedIds={pinnedProgressIds}
        showModeBar={availableProgressModes.length > 1}
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
            <View style={styles.headerEditActions}>
              <Pressable
                accessibilityLabel={t("Open recap")}
                onPress={() =>
                  router.navigate("/recap?scope=personal" as never)
                }
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons name="sparkles-outline" size={17} color={accent} />
              </Pressable>
              <Pressable
                accessibilityLabel={t("Open performance")}
                onPress={() => router.push("/performance" as never)}
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons name="speedometer-outline" size={17} color={accent} />
              </Pressable>
            </View>
          )
        }
      />
      {availableProgressModes.length > 1 ? (
        <TutorialTarget id="progress-modes">
          <ProgressModeBar
            mode={progressMode}
            expanded={overviewVisualOpen}
            onChange={setProgressMode}
            onToggleSelected={() =>
              setOverviewVisualOpen((open) => !open)
            }
          />
        </TutorialTarget>
      ) : null}
      {overviewVisualOpen ? (
      <TutorialTarget id="progress-visual">
      <View testID="progress-overview-chart" {...visualSwipeResponder.panHandlers}>
      {view === "month" ? (
        <Card style={styles.visualCard}>
          <View style={styles.cardHeading}>
            <Text style={[styles.eyebrow, { color: accent }]}>MONTH VIEW</Text>
            <InfoPopover
              label="Explain month view"
              message="Each color is one selected tracker. Tap a date to open that day's filtered log."
            />
            <TutorialTarget id="progress-range">
            <RangeCycleButton
              range="month"
              ranges={["week", "month"]}
              onChange={setHistoryRange}
            />
            </TutorialTarget>
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
            trackedGoalColor={TRACKED_COLOR}
              vacationDay={(day) =>
                isVacationDate(state, state.currentUserId, day)
              }
              tutorialDayTarget="progress-grid-cell"
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
        </Card>
      ) : (
        <Card style={styles.visualCard}>
          <View style={styles.cardHeading}>
            <Text style={[styles.eyebrow, { color: accent }]}>WEEK VIEW</Text>
            <InfoPopover
              label="Explain week view"
              message="Each color is one selected tracker. Swipe or use the arrows to change weeks, then tap a day for its filtered log."
            />
            <TutorialTarget id="progress-range">
            <RangeCycleButton
              range="week"
              ranges={["week", "month"]}
              onChange={setHistoryRange}
            />
            </TutorialTarget>
          </View>
          <View style={styles.weekNav}>
            <Pressable
              onPress={() => setHistoryAnchor(dateWithOffsetFrom(historyAnchor, -7))}
              style={[styles.arrow, { backgroundColor: colors.canvas }]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <View style={styles.navCopy}>
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
            {dates.map((day, index) => (
              <Pressable
                key={day}
                onPress={() => openDay(day)}
                style={[
                  styles.dayColumn,
                  index > 0 && {
                    borderLeftWidth: StyleSheet.hairlineWidth,
                    borderLeftColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[styles.bars, { borderBottomColor: colors.border }]}
                >
                  {rawDayVisuals(day)
                    .filter(
                      (item) =>
                        legendItems.some((legend) => legend.id === item.id),
                    )
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
                  {shortDay(day, locale).slice(0, 1)}
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
        </Card>
      )}
      </View>
      </TutorialTarget>
      ) : null}
      <View
        onLayout={(event) => {
          summarySectionY.current = event.nativeEvent.layout.y;
        }}
      >
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
      </View>
      <TutorialTarget id="progress-overview-card">
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
              onEdit={beginEditing}
              onMove={(target) => move(TRACKED, target)}
              onRemove={() => removeProgressCard(TRACKED)}
              pinned={pinnedProgressIds.includes(TRACKED)}
              onPin={() => toggleProgressPin(TRACKED)}
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
              onEdit={beginEditing}
              onMove={(target) => move(itemId, target)}
              onRemove={() => removeProgressCard(itemId)}
              pinned={pinnedProgressIds.includes(itemId)}
              onPin={() => toggleProgressPin(itemId)}
            />
          ),
        )}
      </View>
      </TutorialTarget>
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
        <TutorialTarget id="progress-edit">
        <Pressable
          onPress={beginEditing}
          style={styles.editHint}
        >
          <Text style={[styles.hint, { color: colors.muted }]}>Hold a summary to edit what Progress shows</Text>
        </Pressable>
        </TutorialTarget>
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

export default Insights;

function ProgressModeBar({
  mode,
  expanded,
  onChange,
  onToggleSelected,
}: {
  mode: ProgressViewMode;
  expanded: boolean;
  onChange: (mode: ProgressViewMode) => void;
  onToggleSelected: () => void;
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
      testID="progress-mode-bar"
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
            accessibilityRole="button"
            accessibilityLabel={
              selected
                ? `${label}, ${expanded ? "collapse" : "expand"} ${value === "overview" ? "visual" : "controls"}`
                : `Show ${label}`
            }
            accessibilityState={{
              selected,
              expanded: selected ? expanded : undefined,
            }}
            onPress={selected ? onToggleSelected : () => onChange(value)}
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
            {selected ? (
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={10}
                color={accent}
              />
            ) : null}
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

function RangeCycleButton({
  range,
  ranges,
  onChange,
}: {
  range: HistoryRange;
  ranges: HistoryRange[];
  onChange: (range: HistoryRange) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const next = () => {
    const index = ranges.indexOf(range);
    onChange(ranges[(index + 1) % ranges.length]);
  };
  return (
    <Pressable
      accessibilityLabel={`Showing ${range}. Tap to change range`}
      onPress={next}
      style={[
        styles.rangeCycle,
        { borderColor: colors.border, backgroundColor: colors.canvas },
      ]}
    >
      <Ionicons name="calendar-outline" size={13} color={accent} />
      <Text style={[styles.rangeCycleText, { color: accent }]}>
        {range === "week" ? "Week" : range === "month" ? "Month" : "Year"}
      </Text>
      <Ionicons name="swap-horizontal" size={12} color={colors.faint} />
    </Pressable>
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
  onPin,
  pinnedIds,
  showModeBar,
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
  onPin: (id: string) => void;
  pinnedIds: string[];
  showModeBar: boolean;
  onMove: (id: string, target: number) => void;
  onAddExisting: () => void;
  onOpenFilters: () => void;
  orderedIds: string[];
}) {
  const locale = useLocale();
  const t = useTranslation();
  const { updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const today = dateKey();
  const compact = state.settings.compactProgressGrid === true;
  // In the two-layout view this disclosure is a persisted, device-local UI
  // preference. Grid-only mode intentionally reveals the navigator because
  // there is no mode-bar control available to reopen it.
  const controlsCardOpen =
    !showModeBar ||
    state.settings.progressGridDateNavigatorCollapsed !== true;
  const [controlsOpen, setControlsOpen] = useState(false);
  const visibleMetrics = metrics;
  const visibleMetricById = useMemo(
    () => new Map(visibleMetrics.map((metric) => [metric.id, metric])),
    [visibleMetrics],
  );
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const trackedSelected = selectedIds.includes(TRACKED);
  const gridItemIds = orderedIds.filter(
    (id) =>
      (id === TRACKED && trackedSelected) ||
      visibleMetricById.has(id),
  );
  const dates = useMemo(
    () =>
      calendarPeriodRange(
        anchor,
        range,
        state.settings.weekStartsOn ?? 1,
      ),
    [anchor, range, state.settings.weekStartsOn],
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
      ? `${friendlyDate(dates[0], locale)} – ${friendlyDate(dates[6], locale)}`
      : new Intl.DateTimeFormat(locale, {
          month: range === "month" ? "long" : undefined,
          year: "numeric",
        }).format(new Date(`${anchor}T12:00:00`));
  const trackedModel = cachedTrackedGoalsHeatmapModel(state, dates, today);
  const trackedMet = trackedModel.met;
  const trackedPossible = trackedModel.possible;
  const trackedCompletion = trackedPossible
    ? Math.round((trackedMet / trackedPossible) * 100)
    : 0;
  return (
    <Screen
      contentContainerStyle={{ paddingBottom: 14 }}
      refreshEnabled={!editing}
    >
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
                accessibilityLabel={t("Open recap")}
                onPress={() =>
                  router.navigate("/recap?scope=personal" as never)
                }
                style={[styles.headerEditIcon, { borderColor: colors.border }]}
              >
                <Ionicons name="sparkles-outline" size={17} color={accent} />
              </Pressable>
              <Pressable
                accessibilityLabel={t("Open performance")}
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
      {showModeBar ? (
        <TutorialTarget id="progress-modes">
          <ProgressModeBar
            mode={mode}
            expanded={controlsCardOpen}
            onChange={onModeChange}
            onToggleSelected={() =>
              updateSettings({
                progressGridDateNavigatorCollapsed: controlsCardOpen,
              })
            }
          />
        </TutorialTarget>
      ) : null}
      {controlsCardOpen ? (
      <Card style={styles.mapControls}>
        <View style={styles.periodNav}>
          <Pressable
            onPress={() => shift(-1)}
            style={[styles.mapArrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Pressable
            accessibilityLabel={
              controlsOpen ? "Hide grid controls" : "Show grid controls"
            }
            onPress={() => setControlsOpen((open) => !open)}
            style={styles.mapPeriodToggle}
          >
            <Text style={[styles.mapRangeLabel, { color: accent }]}>
              {range.toUpperCase()}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.mapPeriod, { color: colors.ink }]}
            >
              {label}
            </Text>
            <Ionicons
              name={controlsOpen ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.muted}
            />
          </Pressable>
          <Pressable
            onPress={() => shift(1)}
            style={[styles.mapArrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        </View>
        {controlsOpen ? (
          <View style={[styles.rangeRow, { borderTopColor: colors.border }]}>
            <RangeCycleButton
              range={range}
              ranges={["week", "month", "year"]}
              onChange={onRangeChange}
            />
            <Pressable onPress={onOpenFilters} style={styles.compactFilter}>
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
        ) : null}
      </Card>
      ) : null}
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
                {pinnedIdSet.has(TRACKED) && !editing ? (
                  <Ionicons
                    accessibilityLabel="Pinned"
                    name="pin"
                    size={13}
                    color={palette.amber}
                  />
                ) : null}
                {editing ? (
                  <View style={styles.cardEditActions}>
                    <Pressable
                      accessibilityLabel={
                        pinnedIdSet.has(TRACKED)
                          ? "Unpin tracked goals"
                          : "Pin tracked goals"
                      }
                      onPress={(event) => {
                        event.stopPropagation();
                        onPin(TRACKED);
                      }}
                      style={[styles.goalDate, { borderColor: colors.border }]}
                      hitSlop={7}
                    >
                      <Ionicons
                        name={pinnedIdSet.has(TRACKED) ? "pin" : "pin-outline"}
                        size={15}
                        color={pinnedIdSet.has(TRACKED) ? palette.amber : accent}
                      />
                    </Pressable>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        onRemove(TRACKED);
                      }}
                      style={styles.remove}
                      hitSlop={7}
                    >
                      <Ionicons name="remove" size={15} color={palette.white} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <TrackedGoalsHeatmap
                state={state}
                dates={dates}
                range={range}
                compact={compact}
                onSelect={editing ? undefined : onOpenDay}
                onLongPress={editing ? undefined : onOpenEditor}
                model={trackedModel}
              />
            </Card>
          </MapReorderCard>
        ) : (() => {
          const metric = visibleMetricById.get(itemId);
          if (!metric) return null;
          const heatmapModel = cachedGoalHeatmapModel(
            state,
            metric,
            dates,
            today,
          );
          const period = heatmapModel.period;
          const bloodPressure = bloodPressureProgressSummary(
            state,
            metric,
            dates,
          );
          // Match the percentage rendered by the non-compact GoalHeatmap.
          const completion = period.applicableDates.length
            ? Math.round(
                (period.goalsReached / period.applicableDates.length) * 100,
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
                      {bloodPressure
                        ? `${bloodPressure.averageLabel} mmHg avg`
                        : metric.dataType === "boolean"
                        ? `${completion}% completion avg`
                        : `${formatMetricValue(metric, period.average)} avg`}
                      {metric.dataType !== "boolean"
                        ? bloodPressure
                          ? ` · ${period.loggedDates.length} logged · ${bloodPressure.offsetLabel}`
                          : ` · ${period.loggedDates.length} logged · ${metricAverageGoalOffsetLabel(
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
                      {bloodPressure
                        ? `${Math.round(metricOverallAverage(state, metric, state.currentUserId, today))}/${Math.round(metricOverallAverage(state, bloodPressure.diastolic, state.currentUserId, today))} mmHg`
                        : formatMetricValue(
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
                  {pinnedIdSet.has(metric.id) && !editing ? (
                    <Ionicons
                      accessibilityLabel="Pinned"
                      name="pin"
                      size={13}
                      color={palette.amber}
                    />
                  ) : null}
                  {editing ? (
                    <View style={styles.cardEditActions}>
                      {isMetricTrackedOnDate(state, metric, today) ? (
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            router.navigate({
                              pathname: "/metric-editor",
                              params: {
                                id: metric.id,
                                focus: "goal-start",
                              },
                            } as never);
                          }}
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
                      <Pressable
                        accessibilityLabel={
                            pinnedIdSet.has(metric.id)
                            ? `Unpin ${metric.name}`
                            : `Pin ${metric.name}`
                        }
                        onPress={(event) => {
                          event.stopPropagation();
                          onPin(metric.id);
                        }}
                        style={[styles.goalDate, { borderColor: colors.border }]}
                        hitSlop={7}
                      >
                        <Ionicons
                          name={pinnedIdSet.has(metric.id) ? "pin" : "pin-outline"}
                          size={15}
                          color={pinnedIdSet.has(metric.id) ? palette.amber : accent}
                        />
                      </Pressable>
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          onRemove(metric.id);
                        }}
                        style={styles.remove}
                        hitSlop={7}
                      >
                        <Ionicons name="remove" size={15} color={palette.white} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                <GoalHeatmap
                  state={state}
                  metric={metric}
                  dates={dates}
                  range={range}
                  compact={compact}
                  onSelect={editing ? undefined : onOpenDay}
                  onLongPress={editing ? undefined : onOpenEditor}
                  model={heatmapModel}
                  completionOnly={
                    metricVisualization(metric).progressGrid === "completion"
                  }
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
  const tutorialSandbox = useTutorialSandboxActive();
  const step = useRef(112);
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: step.current,
    onMove,
    onStart: () => holdProgressCloudSync(tutorialSandbox),
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
  return (
    <Reanimated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 8;
        smoothDrag.setStep(step.current);
      }}
      style={[
        wrapStyle,
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 20 : editing ? 3 : 0,
          elevation: smoothDrag.dragging ? 12 : 0,
        },
      ]}
    >
      <Animated.View
        style={{
          transform: [
            {
              rotate: wiggle.interpolate({
                inputRange: [-1, 1],
                outputRange: ["-0.25deg", "0.25deg"],
              }),
            },
          ],
        }}
      >
      <Pressable
        onPress={editing ? undefined : onPress}
        onLongPress={onLongPress}
        style={editing ? { borderColor: colors.border } : undefined}
      >
        {children}
      </Pressable>
      {editing ? (
        <GestureDetector gesture={smoothDrag.gesture}>
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
        >
          <Ionicons
            name="reorder-three-outline"
            size={22}
            color={colors.muted}
          />
        </View>
        </GestureDetector>
      ) : null}
      </Animated.View>
    </Reanimated.View>
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
  pinned,
  onPin,
}: {
  state: AppState;
  dates: string[];
  editing: boolean;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
  pinned: boolean;
  onPin: () => void;
}) {
  const colors = useAppColors();
  const tutorialSandbox = useTutorialSandboxActive();
  const step = useRef(93);
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: step.current,
    onMove,
    onStart: () => holdProgressCloudSync(tutorialSandbox),
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
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
    <Reanimated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 9;
        smoothDrag.setStep(step.current);
      }}
      style={[
        styles.animatedSummary,
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 30 : editing ? 3 : 0,
          elevation: smoothDrag.dragging ? 14 : 0,
        },
      ]}
    >
    <Animated.View
      style={{
        transform: [
          {
            rotate: wiggle.interpolate({
              inputRange: [-1, 1],
              outputRange: ["-0.3deg", "0.3deg"],
            }),
          },
        ],
      }}
    >
    <Pressable style={styles.summaryWrap} onLongPress={onEdit}>
    <Card style={styles.summary}>
      {editing ? (
        <GestureDetector gesture={smoothDrag.gesture}>
        <View
          collapsable={false}
          style={styles.drag}
        >
          <Ionicons
            name="reorder-three-outline"
            size={23}
            color={colors.faint}
          />
        </View>
        </GestureDetector>
      ) : null}
      <View
        style={[styles.summaryIcon, { backgroundColor: `${TRACKED_COLOR}18` }]}
      >
        <Ionicons name="checkmark-done" size={20} color={TRACKED_COLOR} />
        {pinned && !editing ? (
          <View
            accessibilityLabel="Pinned"
            style={[
              styles.visiblePin,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name="pin" size={9} color={palette.amber} />
          </View>
        ) : null}
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
      </View>
      <View style={styles.summaryGoal}>
        <Text
          numberOfLines={2}
          style={[styles.goalLine, { color: TRACKED_COLOR }]}
        >
          {perfect}/{eligible.length} all-goal days
        </Text>
        <View style={styles.streakRow}>
          <Ionicons name="flame" size={12} color={TRACKED_COLOR} />
          <Text style={[styles.streakLine, { color: colors.muted }]}>
            {streaks.current}d · Best {streaks.best}d
          </Text>
        </View>
      </View>
      {editing ? (
        <View style={styles.cardEditActions}>
          <Pressable
            accessibilityLabel={pinned ? "Unpin tracked goals" : "Pin tracked goals"}
            onPress={(event) => {
              event.stopPropagation();
              onPin();
            }}
            style={[styles.goalDate, { borderColor: colors.border }]}
            hitSlop={8}
          >
            <Ionicons
              name={pinned ? "pin" : "pin-outline"}
              size={15}
              color={pinned ? palette.amber : colors.primary}
            />
          </Pressable>
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            style={styles.remove}
            hitSlop={8}
          >
            <Ionicons name="remove" size={16} color={palette.white} />
          </Pressable>
        </View>
      ) : null}
    </Card>
    </Pressable>
    </Animated.View>
    </Reanimated.View>
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
  pinned,
  onPin,
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
  pinned: boolean;
  onPin: () => void;
}) {
  const locale = useLocale();
  const tutorialSandbox = useTutorialSandboxActive();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const dragStep = useRef(93);
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: dragStep.current,
    onMove,
    onStart: () => holdProgressCloudSync(tutorialSandbox),
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
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
  const bloodPressure = bloodPressureProgressSummary(state, metric, dates);
  return (
    <Reanimated.View
      onLayout={(event) => {
        dragStep.current = event.nativeEvent.layout.height + 9;
        smoothDrag.setStep(dragStep.current);
      }}
      style={[
        styles.animatedSummary,
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 20 : editing ? 3 : 0,
          elevation: smoothDrag.dragging ? 12 : 0,
        },
      ]}
    >
    <Animated.View
      style={{
        transform: [
          {
            rotate: wiggle.interpolate({
              inputRange: [-1, 1],
              outputRange: ["-0.3deg", "0.3deg"],
            }),
          },
        ],
      }}
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
          <GestureDetector gesture={smoothDrag.gesture}>
          <View
            collapsable={false}
            style={styles.drag}
          >
            <Ionicons name="reorder-three-outline" size={23} color={colors.faint} />
          </View>
          </GestureDetector>
        ) : null}
        <View
          style={[styles.summaryIcon, { backgroundColor: `${metric.color}18` }]}
        >
          <Ionicons
            name={metric.icon as keyof typeof Ionicons.glyphMap}
            size={20}
            color={metric.color}
          />
          {pinned && !editing ? (
            <View
              accessibilityLabel="Pinned"
              style={[
                styles.visiblePin,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="pin" size={9} color={palette.amber} />
            </View>
          ) : null}
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
              : bloodPressure
              ? bloodPressure.averageLabel
              : isBoolean
              ? `${applicable.length ? Math.round((reached / applicable.length) * 100) : 0}%`
              : Math.abs(average) >= 100
                ? Math.round(average).toLocaleString(locale)
                : (Math.round(average * 10) / 10).toLocaleString(locale)}
          </Text>
          {isTodo ? (
            <Text style={[styles.summaryUnit, { color: colors.muted }]}>
              {todoPossible ? `${todoCompleted}/${todoPossible} completed` : "No to-dos"}
            </Text>
          ) : bloodPressure ? (
            <Text style={[styles.summaryUnit, { color: colors.muted }]}>
              {dates.length}-day avg · mmHg
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
            : bloodPressure
              ? `${measured.length ? `${measured.length} logged days` : "No entries"} · overall ${Math.round(overall)}/${Math.round(metricOverallAverage(state, bloodPressure.diastolic, state.currentUserId, dates[dates.length - 1]))} mmHg`
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
        ) : bloodPressure ? (
          <Text numberOfLines={2} style={[styles.remaining, { color: colors.ink }]}>
            {bloodPressure.offsetLabel}
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
            <Pressable
              accessibilityLabel={pinned ? `Unpin ${metric.name}` : `Pin ${metric.name}`}
              onPress={(event) => {
                event.stopPropagation();
                onPin();
              }}
              style={[styles.goalDate, { borderColor: colors.border }]}
              hitSlop={6}
            >
              <Ionicons
                name={pinned ? "pin" : "pin-outline"}
                size={15}
                color={pinned ? palette.amber : accent}
              />
            </Pressable>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              style={styles.remove}
              hitSlop={8}
            >
              <Ionicons name="remove" size={16} color={palette.white} />
            </Pressable>
          </View>
        ) : null}
      </Card>
    </Pressable>
    </Animated.View>
    </Reanimated.View>
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
    marginBottom: 4,
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
  mapControls: { gap: 0, marginBottom: 9, paddingVertical: 8 },
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderTopWidth: 1,
    marginTop: 7,
    paddingTop: 7,
  },
  rangeCycle: {
    minHeight: 31,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rangeCycleText: { fontSize: 8, fontWeight: "900" },
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
  mapPeriodToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  mapRangeLabel: {
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  mapArrow: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPeriod: {
    flexShrink: 1,
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
  visiblePin: {
    position: "absolute",
    right: -5,
    top: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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
  visualCard: { marginTop: 4, marginBottom: 14 },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  eyebrow: {
    flex: 1,
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
