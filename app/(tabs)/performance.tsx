import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import {
  AddTrackerItem,
  AddTrackerModal,
} from "@/src/components/AddTrackerModal";
import { AppText as Text } from "@/src/components/AppText";
import { TrackerViewFilterSheet } from "@/src/components/TrackerViewFilterSheet";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { dateKey } from "@/src/domain/date";
import {
  formatMetricValue,
  isMetricTrackedOnDate,
} from "@/src/domain/metrics";
import {
  PerformanceRange,
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

function comparisonText(row: TrackerPerformance) {
  if (!row.currentLoggedDays) return "No data this period";
  if (!row.previousLoggedDays) return "First comparable period";
  if (row.direction === "steady") return "Holding steady";
  const change = Math.min(999, Math.round(Math.abs(row.changePercent)));
  return row.improving
    ? `${change}% better vs previous`
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
}) {
  const colors = useAppColors();
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const step = useRef(113);
  const origin = useRef(index);
  const target = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
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
          dragY.setValue(0);
          setDragging(false);
          if (target.current !== origin.current)
            onMoveRef.current(target.current);
        },
        onPanResponderTerminate: () => {
          dragY.setValue(0);
          setDragging(false);
        },
      }),
    [dragY, editing],
  );
  const statusColor =
    row.direction === "missing"
      ? palette.amber
      : row.direction === "steady"
      ? colors.muted
      : row.improving
        ? palette.lime
        : palette.red;
  return (
    <Animated.View
      onLayout={(event) => {
        step.current = event.nativeEvent.layout.height + 12;
      }}
      style={{
        zIndex: dragging ? 30 : 0,
        elevation: dragging ? 12 : 0,
        transform: [{ translateY: dragY }, { scale: dragging ? 1.015 : 1 }],
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
                          : "month",
                  },
                } as never)
        }
      >
        <Card style={[styles.tile, editing && { borderColor: row.metric.color }]}>
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
                  {comparisonText(row)}
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
          {editing ? (
            <View
              accessibilityLabel={`Reorder ${row.metric.name}`}
              style={[
                styles.drag,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              {...responder.panHandlers}
            >
              <Ionicons
                name="reorder-three-outline"
                size={23}
                color={colors.muted}
              />
            </View>
          ) : (
            <View style={styles.trailing}>
              {pinned ? (
                <Ionicons name="pin" size={13} color={palette.amber} />
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </View>
          )}
        </Card>
      </Pressable>
    </Animated.View>
  );
}

export default function PerformancePage() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const range = state.settings.performanceRange ?? "week";
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
  const overview = useMemo(
    () => performanceOverview(state, range, visibleOrder),
    [range, state, visibleOrder],
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

  function beginEditing() {
    const next = [...configuredIds];
    setDraftIds(next);
    setEditing(true);
  }

  function finishEditing() {
    const finalOrder = [
      ...visibleOrder.filter((id) => draftIds.includes(id)),
      ...draftIds.filter((id) => !visibleOrder.includes(id)),
    ];
    updateSettings({
      performanceMetricIds: draftIds,
      performanceMetricOrderIds: finalOrder,
    });
    setEditing(false);
  }

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

  return (
    <Screen refreshEnabled={!editing}>
      <PageHeader
        title="Performance"
        subtitle="Compare momentum, consistency, and goal progress."
        action={
          <View style={styles.headerActions}>
            {editing ? (
              <Pressable onPress={finishEditing} style={styles.doneEdit}>
                <Text style={[styles.doneEditText, { color: accent }]}>Done</Text>
              </Pressable>
            ) : (
              <>
                <IconButton
                  icon="funnel-outline"
                  label="Choose a saved view"
                  onPress={() => setShowFilters(true)}
                />
                <IconButton
                  icon="create-outline"
                  label="Edit Performance"
                  onPress={beginEditing}
                />
              </>
            )}
          </View>
        }
      />

      <View style={[styles.rangeBar, { backgroundColor: colors.card }]}>
        {RANGES.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            selected={range === item.id}
            onPress={() => updateSettings({ performanceRange: item.id })}
          />
        ))}
      </View>
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
            range={range}
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
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  doneEdit: { minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
  doneEditText: { fontSize: 9, fontWeight: "900" },
  rangeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 15,
    padding: 5,
  },
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
    left: -7,
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
