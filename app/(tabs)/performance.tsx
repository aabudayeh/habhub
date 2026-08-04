import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";

import {
  AddTrackerItem,
  AddTrackerModal,
} from "@/src/components/AddTrackerModal";
import { AppText as Text } from "@/src/components/AppText";
import { useLocale } from "@/src/i18n";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { TrackerViewFilterSheet } from "@/src/components/TrackerViewFilterSheet";
import { useEditWiggle } from "@/src/components/useEditWiggle";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { dateKey } from "@/src/domain/date";
import {
  formatMetricValue,
  isMetricTrackedOnDate,
} from "@/src/domain/metrics";
import {
  customPerformancePeriod,
  overallPerformancePeriod,
  PerformanceRange,
  performancePeriod,
  performanceOverview,
  TrackerPerformance,
} from "@/src/domain/performance";
import {
  activeTrackerViewId,
  activeTrackerViewLabel,
  ALL_AVAILABLE_TRACKERS_FILTER,
  ALL_TRACKERS_FILTER,
  TRACKED_ONLY_FILTER,
} from "@/src/domain/viewFilters";
import {
  isInternalTracker,
  trackerGroupLabel,
} from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

const RANGES: { id: PerformanceRange; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
  { id: "year", label: "Yearly" },
];

const COMPARISON_OPTIONS = [
  {
    id: "previous",
    label: "Previous period",
    icon: "play-back-outline" as const,
    group: "Comparison",
  },
  {
    id: "overall",
    label: "Overall average",
    icon: "analytics-outline" as const,
    group: "Comparison",
  },
  {
    id: "custom",
    label: "Custom ranges",
    icon: "calendar-outline" as const,
    group: "Comparison",
  },
];

type PerformancePriority =
  | "gaining"
  | "steady"
  | "focus"
  | "missing"
  | "strongest"
  | "opportunity";

function moveItem(ids: string[], from: number, to: number) {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

function metricDisplay(row: TrackerPerformance, range: PerformanceRange) {
  if (!row.currentLoggedDays) return "No data this period";
  if (row.metric.dataType === "boolean") {
    const denominator = Math.max(row.currentLoggedDays, row.currentGoalDays);
    return denominator
      ? `${row.currentGoalDays}/${denominator} completed`
      : "No entries";
  }
  const value = formatMetricValue(row.metric, row.current);
  return range === "day" ? value : `${value} avg`;
}

function comparisonText(
  row: TrackerPerformance,
  comparisonLabel = "previous",
) {
  if (!row.currentLoggedDays) return "No data this period";
  if (!row.previousLoggedDays) return "First comparable period";
  if (row.provisional) return "Current period still in progress";
  if (row.direction === "steady") return "Holding steady";
  const change = Math.min(999, Math.round(Math.abs(row.changePercent)));
  return row.improving
    ? `${change}% better vs ${comparisonLabel}`
    : `${change}% further from goal`;
}

function ComparisonBars({ row }: { row: TrackerPerformance }) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const goalAware = row.metric.goalEnabled !== false;
  const max = goalAware
    ? Math.max(1, row.currentScore, row.previousScore)
    : Math.max(1, Math.abs(row.current), Math.abs(row.previous));
  const current = goalAware
    ? Math.max(0, row.currentScore / max)
    : Math.abs(row.current) / max;
  const previous = goalAware
    ? Math.max(0, row.previousScore / max)
    : Math.abs(row.previous) / max;
  return (
    <View style={styles.bars}>
      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.barFill,
            {
              backgroundColor: row.improving ? palette.lime : accent,
              width: `${Math.min(100, current * 100)}%`,
            },
          ]}
        />
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.barFill,
            {
              backgroundColor: colors.faint,
              width: `${Math.min(100, previous * 100)}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

function PerformanceTile({
  row,
  range,
  editing,
  index,
  count,
  onEdit,
  onMove,
  onRemove,
  pinned,
  onPin,
  comparisonLabel,
}: {
  row: TrackerPerformance;
  range: PerformanceRange;
  editing: boolean;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
  pinned: boolean;
  onPin: () => void;
  comparisonLabel: string;
}) {
  const colors = useAppColors();
  const step = useRef(113);
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: step.current,
    onMove,
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
  const statusColor =
    row.direction === "missing"
      ? palette.amber
      : row.direction === "steady"
      ? colors.muted
      : row.improving
        ? palette.lime
        : palette.red;
  return (
    <Reanimated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 12;
        smoothDrag.setStep(step.current);
      }}
      style={[
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 30 : 0,
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
                outputRange: ["-0.35deg", "0.35deg"],
              }),
            },
          ],
        }}
      >
      <Pressable
        onLongPress={onEdit}
        onPress={
          editing
            ? undefined
            : () =>
                router.push({
                  pathname: "/metric-detail",
                  params: {
                    metric: row.metric.id,
                    period:
                      range === "day"
                        ? "today"
                        : range === "week"
                          ? "week"
                          : range === "month"
                            ? "month"
                            : "year",
                  },
                } as never)
        }
      >
        <Card style={[styles.tile, editing && { borderColor: row.metric.color }]}>
          {editing ? (
            <GestureDetector gesture={smoothDrag.gesture}>
            <View
              accessibilityLabel={`Reorder ${row.metric.name}`}
              style={[
                styles.drag,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name="reorder-three-outline"
                size={23}
                color={colors.muted}
              />
            </View>
            </GestureDetector>
          ) : null}
          {editing ? (
            <View style={styles.editActions}>
              <Pressable
                accessibilityLabel={`Hide ${row.metric.name}`}
                onPress={onRemove}
                style={[
                  styles.editAction,
                  {
                    backgroundColor: palette.red,
                    borderColor: palette.red,
                  },
                ]}
              >
                <Ionicons name="remove" size={15} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityLabel={
                  pinned ? `Unpin ${row.metric.name}` : `Pin ${row.metric.name}`
                }
                onPress={onPin}
                style={[
                  styles.editAction,
                  {
                    backgroundColor: colors.card,
                    borderColor: pinned ? palette.amber : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={pinned ? "pin" : "pin-outline"}
                  size={14}
                  color={pinned ? palette.amber : colors.muted}
                />
              </Pressable>
            </View>
          ) : null}
          <View
            style={[
              styles.metricIcon,
              { backgroundColor: `${row.metric.color}1F` },
            ]}
          >
            <Ionicons
              name={row.metric.icon as keyof typeof Ionicons.glyphMap}
              size={19}
              color={row.metric.color}
            />
          </View>
          <View style={styles.tileBody}>
            <View style={styles.tileTop}>
              <View style={styles.tileTitle}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
                  {row.metric.name}
                </Text>
                <Text style={[styles.value, { color: colors.ink }]}>
                  {metricDisplay(row, range)}
                </Text>
              </View>
              <View style={styles.change}>
                <Ionicons
                  name={
                    row.direction === "missing"
                      ? "alert-circle-outline"
                      : row.direction === "steady"
                      ? "remove"
                      : row.direction === "new"
                        ? "sparkles"
                        : row.improving
                          ? "trending-up"
                          : "trending-down"
                  }
                  size={16}
                  color={statusColor}
                />
                <Text style={[styles.changeText, { color: statusColor }]}>
                  {comparisonText(row, comparisonLabel)}
                </Text>
              </View>
            </View>
            <ComparisonBars row={row} />
            <View style={styles.stats}>
              {!row.currentLoggedDays ? (
                <Text style={[styles.stat, { color: colors.muted }]}>
                  {row.previousLoggedDays
                    ? `Previous ${formatMetricValue(row.metric, row.previous)} avg`
                    : "No entries in either period"}
                </Text>
              ) : row.metric.goalEnabled !== false ? (
                <>
                  <Text style={[styles.stat, { color: colors.muted }]}>
                    Goal {Math.round(row.currentGoalRate * 100)}%
                  </Text>
                  <Text style={[styles.stat, { color: colors.muted }]}>
                    {row.currentGoalDays}/
                    {Math.max(row.currentLoggedDays, row.currentGoalDays)} days
                  </Text>
                </>
              ) : (
                <Text style={[styles.stat, { color: colors.muted }]}>
                  No goal set
                </Text>
              )}
              <Text style={[styles.stat, { color: colors.muted }]}>
                🔥 {row.currentStreak} · best {row.bestStreak}
              </Text>
              {row.currentLoggedDays && range !== "day" ? (
                <Text style={[styles.stat, { color: colors.muted }]}>
                  Total {formatMetricValue(row.metric, row.currentTotal)}
                </Text>
              ) : null}
            </View>
          </View>
          {!editing ? (
            <View style={styles.trailing}>
              {pinned ? (
                <Ionicons name="pin" size={13} color={palette.amber} />
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </View>
          ) : null}
        </Card>
      </Pressable>
      </Animated.View>
    </Reanimated.View>
  );
}

function PerformancePage() {
  const { state, updateSettings } = useApp();
  const locale = useLocale();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const range = state.settings.performanceRange ?? "week";
  const defaultPeriod = useMemo(
    () =>
      performancePeriod(
        range,
        dateKey(),
        state.settings.weekStartsOn ?? 1,
        locale,
      ),
    [locale, range, state.settings.weekStartsOn],
  );
  const [comparisonMode, setComparisonMode] = useState<
    "previous" | "overall" | "custom"
  >("previous");
  const [customCurrentStart, setCustomCurrentStart] = useState(
    defaultPeriod.currentDates[0] ?? dateKey(),
  );
  const [customCurrentEnd, setCustomCurrentEnd] = useState(
    defaultPeriod.currentDates.at(-1) ?? dateKey(),
  );
  const [customPreviousStart, setCustomPreviousStart] = useState(
    defaultPeriod.previousDates[0] ?? dateKey(),
  );
  const [customPreviousEnd, setCustomPreviousEnd] = useState(
    defaultPeriod.previousDates.at(-1) ?? dateKey(),
  );
  const [rangePicker, setRangePicker] = useState<"current" | "previous" | null>(
    null,
  );
  const [rangePickerStep, setRangePickerStep] = useState<"start" | "end">(
    "start",
  );
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [priority, setPriority] = useState<PerformancePriority | null>(null);
  const compatible = useMemo(
    () =>
      state.metrics
        .filter(
          (metric) =>
            !isInternalTracker(metric) &&
            metric.dataType !== "text" &&
            metric.dataType !== "photo" &&
            metric.id !== "tracked_goals",
        )
        .sort((a, b) => a.order - b.order),
    [state.metrics],
  );
  const configuredIds = useMemo(() => {
    if (state.settings.performanceMetricIds)
      return state.settings.performanceMetricIds;
    const compatibleIds = new Set(compatible.map((metric) => metric.id));
    const progressDefaults = state.settings.progressMetricIds.filter((id) =>
      compatibleIds.has(id),
    );
    return progressDefaults.length
      ? progressDefaults
      : compatible.map((metric) => metric.id);
  }, [
    compatible,
    state.settings.performanceMetricIds,
    state.settings.progressMetricIds,
  ]);
  const [draftIds, setDraftIds] = useState(configuredIds);
  const order = state.settings.performanceMetricOrderIds ?? configuredIds;
  const orderedCompatible = useMemo(() => {
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...compatible].sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.order - b.order,
    );
  }, [compatible, order]);
  const activeFilter = activeTrackerViewId(state, "performance");
  const visibleIds = useMemo(() => {
    const base = editing ? draftIds : configuredIds;
    if (editing || activeFilter === ALL_TRACKERS_FILTER) return base;
    if (activeFilter === ALL_AVAILABLE_TRACKERS_FILTER)
      return orderedCompatible.map((metric) => metric.id);
    if (activeFilter === TRACKED_ONLY_FILTER)
      return orderedCompatible
        .filter((metric) =>
          isMetricTrackedOnDate(state, metric, dateKey()),
        )
        .map((metric) => metric.id);
    const saved = state.settings.trackerViewFilters?.find(
      (filter) => filter.id === activeFilter,
    );
    return saved?.metricIds ?? base;
  }, [
    activeFilter,
    configuredIds,
    draftIds,
    editing,
    orderedCompatible,
    state,
  ]);
  const visibleOrder = useMemo(() => {
    if (editing) return draftIds;
    const visible = new Set(visibleIds);
    return [
      ...order.filter((id) => visible.has(id)),
      ...visibleIds.filter((id) => !order.includes(id)),
    ];
  }, [draftIds, editing, order, visibleIds]);
  const selectedPeriod = useMemo(() => {
    if (comparisonMode === "overall")
      return overallPerformancePeriod(state, defaultPeriod);
    if (comparisonMode === "custom")
      return customPerformancePeriod(
        customCurrentStart,
        customCurrentEnd,
        customPreviousStart,
        customPreviousEnd,
        locale,
      );
    return defaultPeriod;
  }, [
    comparisonMode,
    customCurrentEnd,
    customCurrentStart,
    customPreviousEnd,
    customPreviousStart,
    defaultPeriod,
    locale,
    state,
  ]);
  const overview = useMemo(
    () =>
      performanceOverview(
        state,
        selectedPeriod.range,
        visibleOrder,
        dateKey(),
        selectedPeriod,
      ),
    [selectedPeriod, state, visibleOrder],
  );
  const baseRows = useMemo(() => {
    const byId = new Map(overview.rows.map((row) => [row.metric.id, row]));
    return visibleOrder
      .map((id) => byId.get(id))
      .filter((row): row is TrackerPerformance => Boolean(row));
  }, [overview.rows, visibleOrder]);
  const hiddenItems: AddTrackerItem[] = compatible
    .filter((metric) => !draftIds.includes(metric.id))
    .map((metric) => ({
      id: metric.id,
      label: metric.name,
      icon: metric.icon as keyof typeof Ionicons.glyphMap,
      color: metric.color,
      sublabel: trackerGroupLabel(metric),
    }));

  useEffect(() => {
    setCloudSyncPaused("performance-edit", editing);
    return () => setCloudSyncPaused("performance-edit", false);
  }, [editing]);

  const beginEditing = useCallback(() => {
    const next = [...configuredIds];
    setDraftIds(next);
    setEditing(true);
  }, [configuredIds]);

  const finishEditing = useCallback(() => {
    const finalOrder = [
      ...visibleOrder.filter((id) => draftIds.includes(id)),
      ...draftIds.filter((id) => !visibleOrder.includes(id)),
    ];
    updateSettings({
      performanceMetricIds: draftIds,
      performanceMetricOrderIds: finalOrder,
    });
    setEditing(false);
  }, [draftIds, updateSettings, visibleOrder]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!editing) return false;
          finishEditing();
          return true;
        },
      );
      return () => subscription.remove();
    }, [editing, finishEditing]),
  );

  function reorder(metricId: string, target: number) {
    const currentOrder = rows.map((row) => row.metric.id);
    const from = currentOrder.indexOf(metricId);
    if (from < 0 || from === target) return;
    const nextVisible = moveItem(currentOrder, from, target);
    setDraftIds((current) => [
      ...nextVisible,
      ...current.filter((id) => !nextVisible.includes(id)),
    ]);
  }

  const improvingCount = baseRows.filter(
    (row) => row.direction === "up" || row.direction === "new",
  ).length;
  const focusCount = baseRows.filter(
    (row) => row.direction === "down",
  ).length;
  const missingCount = baseRows.filter(
    (row) => row.direction === "missing",
  ).length;
  const steadyCount =
    baseRows.length - improvingCount - focusCount - missingCount;
  const strongest = overview.strengths[0];
  const opportunity = overview.opportunities.find(
    (row) => row.metric.id !== strongest?.metric.id,
  );
  const pinnedIds = useMemo(
    () => state.settings.performancePinnedMetricIds ?? [],
    [state.settings.performancePinnedMetricIds],
  );
  const rows = useMemo(() => {
    if (editing) return baseRows;
    const originalPositions = new Map(
      baseRows.map((row, index) => [row.metric.id, index]),
    );
    const pinPositions = new Map(
      pinnedIds.map((metricId, index) => [metricId, index]),
    );
    const matchesPriority = (row: TrackerPerformance) => {
      if (!priority) return false;
      if (priority === "gaining")
        return row.direction === "up" || row.direction === "new";
      if (priority === "steady") return row.direction === "steady";
      if (priority === "focus") return row.direction === "down";
      if (priority === "missing") return row.direction === "missing";
      if (priority === "strongest")
        return row.metric.id === strongest?.metric.id;
      return row.metric.id === opportunity?.metric.id;
    };
    return [...baseRows].sort((a, b) => {
      const aPin = pinPositions.get(a.metric.id);
      const bPin = pinPositions.get(b.metric.id);
      if (aPin !== undefined || bPin !== undefined) {
        if (aPin === undefined) return 1;
        if (bPin === undefined) return -1;
        return aPin - bPin;
      }
      if (priority) {
        const priorityDifference =
          Number(matchesPriority(b)) - Number(matchesPriority(a));
        if (priorityDifference) return priorityDifference;
      }
      return (
        (originalPositions.get(a.metric.id) ?? 0) -
        (originalPositions.get(b.metric.id) ?? 0)
      );
    });
  }, [
    baseRows,
    editing,
    opportunity?.metric.id,
    pinnedIds,
    priority,
    strongest?.metric.id,
  ]);

  function togglePriority(next: PerformancePriority) {
    if (editing) return;
    setPriority((current) => (current === next ? null : next));
  }

  function togglePin(metricId: string) {
    updateSettings({
      performancePinnedMetricIds: pinnedIds.includes(metricId)
        ? pinnedIds.filter((id) => id !== metricId)
        : [...pinnedIds, metricId],
    });
  }

  const selectRange = useCallback(
    (nextRange: PerformanceRange) => {
      setComparisonMode((current) => (current === "custom" ? "previous" : current));
      setRangePicker(null);
      updateSettings({ performanceRange: nextRange });
    },
    [updateSettings],
  );
  const moveBetweenRanges = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = RANGES.findIndex((item) => item.id === range);
      const next = RANGES[currentIndex + direction];
      if (next) selectRange(next.id);
    },
    [range, selectRange],
  );
  const pageSwipe = usePageSwipeGesture({
    enabled: !editing && !rangePicker,
    onPrevious: () => moveBetweenRanges(-1),
    onNext: () => moveBetweenRanges(1),
  });

  return (
    <GestureDetector gesture={pageSwipe}>
    <View style={styles.pageGesture}>
    <Screen refreshEnabled={!editing}>
      <PageHeader
        title="Performance"
        tutorialId="performance-header"
        action={
          editing ? (
            <Pressable onPress={finishEditing} style={styles.doneEdit}>
              <Text style={[styles.doneEditText, { color: accent }]}>Done</Text>
            </Pressable>
          ) : undefined
        }
      />

      <Card style={styles.rangeCard}>
      <View style={styles.rangeBar}>
        {RANGES.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => selectRange(item.id)}
            style={[
              styles.rangeChoice,
              {
                borderColor: range === item.id ? accent : "transparent",
                backgroundColor:
                  range === item.id ? colors.primarySoft : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.rangeText,
                { color: range === item.id ? accent : colors.muted },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      </Card>
      <SelectionMenu
        title="Compare with"
        items={COMPARISON_OPTIONS}
        selectedIds={[comparisonMode]}
        multiple={false}
        searchable={false}
        onChange={(ids) => {
          const next = ids[0] as "previous" | "overall" | "custom" | undefined;
          if (!next) return;
          setComparisonMode(next);
          setRangePicker(null);
        }}
      />
      {comparisonMode === "custom" ? (
        <Card style={styles.customRanges}>
          <View style={styles.customRangeRow}>
            {(
              [
                [
                  "current",
                  "Range A",
                  customCurrentStart,
                  customCurrentEnd,
                ],
                [
                  "previous",
                  "Range B",
                  customPreviousStart,
                  customPreviousEnd,
                ],
              ] as const
            ).map(([id, label, start, end]) => (
              <Pressable
                key={id}
                onPress={() => {
                  setRangePicker(id);
                  setRangePickerStep("start");
                }}
                style={[
                  styles.customRangeButton,
                  {
                    borderColor: rangePicker === id ? accent : colors.border,
                    backgroundColor: colors.canvas,
                  },
                ]}
              >
                <Text style={[styles.customRangeLabel, { color: accent }]}>
                  {label}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.customRangeDate, { color: colors.ink }]}
                >
                  {start} – {end}
                </Text>
              </Pressable>
            ))}
          </View>
          {rangePicker ? (
            <>
              <Text style={[styles.pickerHelp, { color: colors.muted }]}>
                Select {rangePicker === "current" ? "Range A" : "Range B"}{" "}
                {rangePickerStep === "start" ? "start" : "end"} date
              </Text>
              <MonthCalendar
                monthDate={
                  rangePicker === "current"
                    ? customCurrentEnd
                    : customPreviousEnd
                }
                selectedDate={
                  rangePicker === "current"
                    ? rangePickerStep === "start"
                      ? customCurrentStart
                      : customCurrentEnd
                    : rangePickerStep === "start"
                      ? customPreviousStart
                      : customPreviousEnd
                }
                rangeStart={
                  rangePicker === "current"
                    ? customCurrentStart
                    : customPreviousStart
                }
                rangeEnd={
                  rangePicker === "current"
                    ? customCurrentEnd
                    : customPreviousEnd
                }
                rangeAccent={accent}
                onSelect={(date) => {
                  if (rangePicker === "current") {
                    if (rangePickerStep === "start") {
                      setCustomCurrentStart(date);
                      setCustomCurrentEnd(date);
                      setRangePickerStep("end");
                    } else {
                      if (date < customCurrentStart) {
                        setCustomCurrentEnd(customCurrentStart);
                        setCustomCurrentStart(date);
                      } else {
                        setCustomCurrentEnd(date);
                      }
                      setRangePicker(null);
                    }
                  } else if (rangePickerStep === "start") {
                    setCustomPreviousStart(date);
                    setCustomPreviousEnd(date);
                    setRangePickerStep("end");
                  } else {
                    if (date < customPreviousStart) {
                      setCustomPreviousEnd(customPreviousStart);
                      setCustomPreviousStart(date);
                    } else {
                      setCustomPreviousEnd(date);
                    }
                    setRangePicker(null);
                  }
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}
      <View style={styles.periodLine}>
        <Text style={[styles.period, { color: colors.muted }]}>
          {overview.period.currentLabel} vs {overview.period.previousLabel}
        </Text>
        <Pressable onPress={() => setShowFilters(true)} style={styles.filterLabel}>
          <Ionicons name="funnel-outline" size={13} color={accent} />
          <Text style={[styles.filterText, { color: accent }]}>
            {activeTrackerViewLabel(state, "performance")}
          </Text>
        </Pressable>
      </View>

      {rows.length ? (
        <>
          <Card style={styles.momentum}>
            <View style={styles.momentumTop}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.ink }]}>
                  Momentum
                </Text>
                <Text style={[styles.sectionMeta, { color: colors.muted }]}>
                  Direction is goal-aware, so lower can be better.
                </Text>
              </View>
              <View style={[styles.scorePill, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.scoreText, { color: accent }]}>
                  {improvingCount}/{baseRows.length} improving
                </Text>
              </View>
            </View>
            <View style={styles.momentumStats}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Prioritize gaining trackers"
                onPress={() => togglePriority("gaining")}
                style={[
                  styles.momentumStat,
                  {
                    borderColor:
                      priority === "gaining" ? palette.lime : "transparent",
                    backgroundColor:
                      priority === "gaining"
                        ? colors.primarySoft
                        : "transparent",
                  },
                ]}
              >
                <Text style={[styles.momentumNumber, { color: palette.lime }]}>
                  {improvingCount}
                </Text>
                <Text style={[styles.momentumLabel, { color: colors.muted }]}>
                  gaining
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Prioritize steady trackers"
                onPress={() => togglePriority("steady")}
                style={[
                  styles.momentumStat,
                  {
                    borderColor:
                      priority === "steady" ? accent : "transparent",
                    backgroundColor:
                      priority === "steady"
                        ? colors.primarySoft
                        : "transparent",
                  },
                ]}
              >
                <Text style={[styles.momentumNumber, { color: colors.ink }]}>
                  {steadyCount}
                </Text>
                <Text style={[styles.momentumLabel, { color: colors.muted }]}>
                  steady
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Prioritize trackers needing focus"
                onPress={() => togglePriority("focus")}
                style={[
                  styles.momentumStat,
                  {
                    borderColor:
                      priority === "focus" ? palette.amber : "transparent",
                    backgroundColor:
                      priority === "focus"
                        ? colors.primarySoft
                        : "transparent",
                  },
                ]}
              >
                <Text style={[styles.momentumNumber, { color: palette.amber }]}>
                  {focusCount}
                </Text>
                <Text style={[styles.momentumLabel, { color: colors.muted }]}>
                  need focus
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Prioritize trackers with no data"
                onPress={() => togglePriority("missing")}
                style={[
                  styles.momentumStat,
                  {
                    borderColor:
                      priority === "missing" ? colors.muted : "transparent",
                    backgroundColor:
                      priority === "missing"
                        ? colors.primarySoft
                        : "transparent",
                  },
                ]}
              >
                <Text style={[styles.momentumNumber, { color: colors.muted }]}>
                  {missingCount}
                </Text>
                <Text style={[styles.momentumLabel, { color: colors.muted }]}>
                  no data
                </Text>
              </Pressable>
            </View>
          </Card>

          <View style={styles.insightGrid}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Prioritize strongest tracker"
              onPress={() => togglePriority("strongest")}
              style={styles.insightPressable}
            >
            <Card
              style={[
                styles.insight,
                priority === "strongest" && { borderColor: palette.lime },
              ]}
            >
              <Ionicons name="sparkles" size={19} color={palette.lime} />
              <Text style={[styles.insightEyebrow, { color: palette.lime }]}>
                Strongest
              </Text>
              <Text numberOfLines={1} style={[styles.insightTitle, { color: colors.ink }]}>
                {strongest?.metric.name ?? "More data needed"}
              </Text>
              <Text numberOfLines={2} style={[styles.insightMeta, { color: colors.muted }]}>
                {strongest
                  ? `${Math.round(strongest.currentGoalRate * 100)}% goal rate · ${comparisonText(strongest)}`
                  : "Keep logging to reveal a pattern."}
              </Text>
            </Card>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Prioritize next focus tracker"
              onPress={() => togglePriority("opportunity")}
              style={styles.insightPressable}
            >
            <Card
              style={[
                styles.insight,
                priority === "opportunity" && { borderColor: palette.amber },
              ]}
            >
              <Ionicons name="compass-outline" size={19} color={palette.amber} />
              <Text style={[styles.insightEyebrow, { color: palette.amber }]}>
                Focus next
              </Text>
              <Text numberOfLines={1} style={[styles.insightTitle, { color: colors.ink }]}>
                {opportunity?.metric.name ?? "Keep the momentum"}
              </Text>
              <Text numberOfLines={2} style={[styles.insightMeta, { color: colors.muted }]}>
                {opportunity
                  ? `${Math.round(opportunity.currentGoalRate * 100)}% goal rate · ${comparisonText(opportunity)}`
                  : "No weaker area is clear yet."}
              </Text>
            </Card>
            </Pressable>
          </View>
        </>
      ) : null}

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>
          Tracker performance
        </Text>
        <Text style={[styles.sectionMeta, { color: colors.muted }]}>
          Hold a tile to organize this page.
        </Text>
      </View>
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <PerformanceTile
            key={row.metric.id}
            row={row}
            range={overview.period.range}
            editing={editing}
            index={index}
            count={rows.length}
            onEdit={beginEditing}
            onMove={(target) => reorder(row.metric.id, target)}
            onRemove={() => {
              setDraftIds((current) =>
                current.filter((id) => id !== row.metric.id),
              );
              if (pinnedIds.includes(row.metric.id))
                togglePin(row.metric.id);
            }}
            pinned={pinnedIds.includes(row.metric.id)}
            onPin={() => togglePin(row.metric.id)}
            comparisonLabel={overview.period.previousLabel.toLowerCase()}
          />
        ))}
      </View>

      {editing ? (
        <Pressable
          onPress={() => setShowAdd(true)}
          style={[styles.add, { borderColor: accent }]}
        >
          <Ionicons name="add-circle-outline" size={18} color={accent} />
          <Text style={[styles.addText, { color: accent }]}>
            Add existing tracker
          </Text>
        </Pressable>
      ) : null}

      {!rows.length ? (
        <Card>
          <Text style={[styles.empty, { color: colors.muted }]}>
            No comparable data in this view yet. Choose another filter or log a
            tracker in both periods.
          </Text>
        </Card>
      ) : null}

      <TrackerViewFilterSheet
        visible={showFilters}
        scope="performance"
        onClose={() => setShowFilters(false)}
      />
      <AddTrackerModal
        visible={showAdd}
        items={hiddenItems}
        onClose={() => setShowAdd(false)}
        onAdd={(id) => {
          setDraftIds((current) =>
            current.includes(id) ? current : [...current, id],
          );
          setShowAdd(false);
        }}
      />
    </Screen>
    </View>
    </GestureDetector>
  );
}

export default PerformancePage;

const styles = StyleSheet.create({
  pageGesture: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  doneEdit: { minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
  doneEditText: { fontSize: 9, fontWeight: "900" },
  rangeCard: { padding: 5, marginBottom: 7 },
  rangeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  rangeChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 33,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  rangeText: { fontSize: 9, fontWeight: "900" },
  customRanges: { gap: 8 },
  customRangeRow: { flexDirection: "row", gap: 7 },
  customRangeButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  customRangeLabel: { fontSize: 7, fontWeight: "900" },
  customRangeDate: { fontSize: 7, fontWeight: "800", marginTop: 2 },
  pickerHelp: { fontSize: 8, fontWeight: "800", textAlign: "center" },
  periodLine: {
    minHeight: 31,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  period: { fontSize: 8, fontWeight: "700" },
  filterLabel: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "55%" },
  filterText: { fontSize: 8, fontWeight: "900" },
  momentum: { gap: 9, marginTop: 7 },
  momentumTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: { fontSize: 11, fontWeight: "900" },
  sectionMeta: { fontSize: 7, lineHeight: 10, marginTop: 2 },
  scorePill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  scoreText: { fontSize: 8, fontWeight: "900" },
  momentumStats: { flexDirection: "row", gap: 6 },
  momentumStat: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 11,
  },
  momentumNumber: { fontSize: 17, fontWeight: "900" },
  momentumLabel: { fontSize: 7, fontWeight: "800", marginTop: 1 },
  insightGrid: { flexDirection: "row", gap: 9, marginTop: 10 },
  insightPressable: { flex: 1, minWidth: 0 },
  insight: { flex: 1, minWidth: 0, gap: 3 },
  insightEyebrow: { fontSize: 7, fontWeight: "900", textTransform: "uppercase" },
  insightTitle: { fontSize: 10, fontWeight: "900" },
  insightMeta: { fontSize: 7, lineHeight: 10 },
  sectionHeading: { marginTop: 13, marginBottom: 6 },
  rows: { gap: 12 },
  tile: {
    minHeight: 102,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  metricIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBody: { flex: 1, minWidth: 0, gap: 6 },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 7,
  },
  tileTitle: { flex: 1, minWidth: 0 },
  name: { fontSize: 10, fontWeight: "900" },
  value: { fontSize: 9, fontWeight: "800", marginTop: 2 },
  change: {
    maxWidth: "46%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  changeText: { fontSize: 7, fontWeight: "900", textAlign: "right" },
  bars: { gap: 3 },
  barTrack: { height: 4, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  stats: { flexDirection: "row", flexWrap: "wrap", columnGap: 9, rowGap: 2 },
  stat: { fontSize: 7, fontWeight: "700" },
  editActions: {
    position: "absolute",
    top: -7,
    right: -7,
    flexDirection: "row",
    gap: 5,
    zIndex: 5,
  },
  editAction: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  trailing: { alignItems: "center", justifyContent: "center", gap: 6 },
  drag: {
    width: 31,
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    minHeight: 46,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addText: { fontSize: 9, fontWeight: "900" },
  empty: { fontSize: 9, lineHeight: 14, textAlign: "center" },
});
