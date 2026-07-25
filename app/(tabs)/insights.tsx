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
  ReorderDragState,
  ReorderItem,
  reorderShift,
} from "@/src/components/ReorderItem";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { GoalHeatmap } from "@/src/components/GoalHeatmap";
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
  goalProgress,
  isMetricTrackedOnDate,
  metricAverageGoalOffsetLabel,
  metricApplicableOnDate,
  metricOverallAverage,
  metricPeriodStats,
  metricStreakStats,
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
  activeTrackerViewLabel,
  metricMatchesActiveView,
} from "@/src/domain/viewFilters";

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
      metric.dataType !== "text" &&
      metricMatchesActiveView(state, metric, today),
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
  const [draggingMetricId, setDraggingMetricId] = useState<string | null>(null);
  const [dragPlacement, setDragPlacement] =
    useState<ReorderDragState | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [view, setView] = useState<ViewMode>("week");
  const progressMode = state.settings.progressViewMode ?? "overview";
  const historyRange = state.settings.progressHistoryRange ?? "week";
  const [historyAnchor, setHistoryAnchor] = useState(today);
  const [month, setMonth] = useState(today);
  const [weekAnchor, setWeekAnchor] = useState(today);
  useEffect(() => {
    if (!editing) {
      setDraggingMetricId(null);
      setDragPlacement(null);
    }
  }, [editing]);
  const selectedMetrics = selectedIds
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter((metric): metric is MetricDefinition => Boolean(metric));
  const tracked = selectedIds.includes(TRACKED);
  const dates =
    view === "week"
      ? calendarWeekRange(
          weekAnchor,
          state.settings.weekStartsOn ?? 1,
        )
      : monthDateRange(month).filter((date) => date <= today);
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
  const shiftVisualPeriod = useCallback((direction: -1 | 1) => {
    if (view === "week") {
      const next = dateWithOffsetFrom(weekAnchor, direction * 7);
      setWeekAnchor(next > today ? today : next);
      return;
    }
    const current = new Date(`${month}T12:00:00`);
    current.setDate(1);
    current.setMonth(current.getMonth() + direction);
    const next = dateKey(current);
    if (next.slice(0, 7) <= today.slice(0, 7)) setMonth(next);
  }, [month, today, view, weekAnchor]);
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
      <GoalMapProgress
        state={state}
        metrics={selectedMetrics}
        selectedIds={selectedIds}
        mode={progressMode}
        range={historyRange}
        anchor={historyAnchor}
        onAnchorChange={setHistoryAnchor}
        onModeChange={(progressViewMode) =>
          updateSettings({ progressViewMode })
        }
        onRangeChange={(progressHistoryRange) =>
          updateSettings({ progressHistoryRange })
        }
        onOpenDay={openDay}
        onOpenEditor={() => setEditing(true)}
        onToggleUntracked={() =>
          updateSettings({
            showUntrackedProgress:
              state.settings.showUntrackedProgress === false,
          })
        }
      />
    );

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
      <ProgressModeBar
        mode={progressMode}
        onChange={(progressViewMode) =>
          updateSettings({ progressViewMode })
        }
      />
      <Pressable
        onPress={() => router.navigate("/view-filters" as never)}
        style={styles.activeFilter}
      >
        <Ionicons name="funnel-outline" size={12} color={accent} />
        <Text style={[styles.activeFilterText, { color: accent }]}>
          {activeTrackerViewLabel(state)}
        </Text>
      </Pressable>
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
      <View {...visualSwipeResponder.panHandlers}>
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
            vacationDay={(day) =>
              isVacationDate(state, state.currentUserId, day)
            }
          />
          <Text style={[styles.hint, { color: colors.muted }]}>
            Each colored line is one selected item. Tap a date for its filtered
            log.
          </Text>
          <View
            style={[
              styles.mode,
              styles.modeInside,
              { borderTopColor: colors.border },
            ]}
          >
            <Chip label="7 days" selected={false} onPress={() => setView("week")} />
            <Chip label="Month" selected onPress={() => setView("month")} />
          </View>
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
                Week
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
          <View
            style={[
              styles.mode,
              styles.modeInside,
              { borderTopColor: colors.border },
            ]}
          >
            <Chip label="7 days" selected onPress={() => setView("week")} />
            <Chip label="Month" selected={false} onPress={() => setView("month")} />
          </View>
        </Card>
      )}
      </View>
      <SectionHeader
        title={`${view === "week" ? "Week" : "Month"} summaries`}
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
          <ReorderItem
            key={metric.id}
            active={draggingMetricId === metric.id}
            shift={reorderShift(index, dragPlacement)}
            settling={Boolean(dragPlacement?.settling)}
          >
            <MetricSummary
              state={state}
              metric={metric}
              dates={summaryDates}
              editing={editing}
              index={index}
              count={selectedMetrics.length}
              onEdit={() => setEditing(true)}
              onMove={(target) => move(metric.id, target)}
              onRemove={() => select(selectedIds.filter((id) => id !== metric.id))}
              onDragStart={(step) => {
                setDraggingMetricId(metric.id);
                setDragPlacement({
                  id: metric.id,
                  origin: index,
                  target: index,
                  step,
                });
              }}
              onDragHover={(target) =>
                setDragPlacement((current) =>
                  current?.id === metric.id ? { ...current, target } : current,
                )
              }
              onDragCancel={() => setDragPlacement(null)}
              onDragEnd={() => {
                setDragPlacement(null);
                setDraggingMetricId(null);
              }}
            />
          </ReorderItem>
        ))}
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
    </Screen>
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
  return (
    <View
      style={[
        styles.progressModes,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {(
        [
          ["overview", "Overview", "stats-chart-outline"],
          ["goal_maps", "Goal maps", "calendar-outline"],
          ["compact", "Compact", "grid-outline"],
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
    </View>
  );
}

function GoalMapProgress({
  state,
  metrics,
  mode,
  range,
  anchor,
  onAnchorChange,
  onModeChange,
  onRangeChange,
  onOpenDay,
  onOpenEditor,
  onToggleUntracked,
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
  onToggleUntracked: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const today = dateKey();
  const showUntracked = state.settings.showUntrackedProgress !== false;
  const visibleMetrics = showUntracked
    ? metrics
    : metrics.filter((metric) =>
        isMetricTrackedOnDate(state, metric, today),
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
  return (
    <Screen contentContainerStyle={{ paddingBottom: 14 }}>
      <PageHeader title="Progress" />
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
        <View style={styles.mapUtilityRow}>
          <Pressable onPress={onToggleUntracked} style={styles.mapUtility}>
            <Ionicons
              name={showUntracked ? "eye-outline" : "eye-off-outline"}
              size={14}
              color={accent}
            />
            <Text style={[styles.mapUtilityText, { color: accent }]}>
              {showUntracked ? "Untracked shown" : "Tracked only"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onModeChange("overview");
              onOpenEditor();
            }}
            style={styles.mapUtility}
          >
            <Ionicons name="options-outline" size={14} color={accent} />
            <Text style={[styles.mapUtilityText, { color: accent }]}>
              Edit view
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => router.navigate("/view-filters" as never)}
          style={styles.mapFilter}
        >
          <Ionicons name="funnel-outline" size={13} color={accent} />
          <Text style={[styles.mapUtilityText, { color: accent }]}>
            {activeTrackerViewLabel(state)}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={accent} />
        </Pressable>
      </Card>
      <View
        style={mode === "compact" ? styles.compactMaps : styles.detailedMaps}
      >
        {visibleMetrics.map((metric) => {
          const period = metricPeriodStats(
            state,
            metric,
            state.currentUserId,
            dates.filter((date) => date <= today),
          );
          return (
            <Pressable
              key={metric.id}
              onPress={() =>
                router.navigate({
                  pathname: "/metric-detail",
                  params: { metricId: metric.id },
                } as never)
              }
              style={mode === "compact" ? styles.compactMapWrap : undefined}
            >
              <Card
                style={[
                  styles.mapCard,
                  mode === "compact" && styles.compactMapCard,
                ]}
              >
                <View style={styles.mapHeading}>
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
                      numberOfLines={1}
                      style={[styles.mapMeta, { color: colors.muted }]}
                    >
                      {period.loggedDates.length} logged ·{" "}
                      {period.applicableDates.length
                        ? Math.round(
                            (period.goalsReached /
                              period.applicableDates.length) *
                              100,
                          )
                        : 0}
                      %
                    </Text>
                  </View>
                  {isMetricTrackedOnDate(state, metric, today) ? (
                    <Ionicons name="flag" size={13} color={accent} />
                  ) : null}
                </View>
                <GoalHeatmap
                  state={state}
                  metric={metric}
                  dates={dates}
                  range={range}
                  compact={mode === "compact"}
                  onSelect={onOpenDay}
                />
              </Card>
            </Pressable>
          );
        })}
      </View>
      {!visibleMetrics.length ? (
        <Card>
          <Text style={[styles.hint, { color: colors.muted }]}>
            No trackers match this view. Show untracked trackers or edit the
            Progress selection.
          </Text>
        </Card>
      ) : null}
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
  const streaks = trackedGoalStreakStats(state, state.currentUserId);
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
          Current streak {streaks.current}d
        </Text>
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
  onDragStart,
  onDragHover,
  onDragCancel,
  onDragEnd,
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
  onDragStart: (step: number) => void;
  onDragHover: (target: number) => void;
  onDragCancel: () => void;
  onDragEnd: () => void;
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
  const onDragStartRef = useRef(onDragStart);
  const onDragHoverRef = useRef(onDragHover);
  const onDragCancelRef = useRef(onDragCancel);
  const onDragEndRef = useRef(onDragEnd);
  const lastDragY = useRef(0);
  const dragStep = useRef(93);
  indexRef.current = index;
  countRef.current = count;
  onMoveRef.current = onMove;
  onDragStartRef.current = onDragStart;
  onDragHoverRef.current = onDragHover;
  onDragCancelRef.current = onDragCancel;
  onDragEndRef.current = onDragEnd;
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
        onMoveShouldSetPanResponder: (_event, gesture) =>
          editing && Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          onDragStartRef.current(dragStep.current);
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
              dragOrigin.current + Math.round(gesture.dy / dragStep.current),
            ),
          );
          dragY.setValue(gesture.dy);
          if (target !== liveTarget.current) {
            liveTarget.current = target;
            onDragHoverRef.current(target);
          }
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          const target = liveTarget.current;
          Animated.spring(dragY, {
            toValue: (target - dragOrigin.current) * dragStep.current,
            damping: 24,
            stiffness: 220,
            mass: 0.72,
            overshootClamping: true,
            useNativeDriver: true,
          }).start(() => {
            if (target !== dragOrigin.current) onMoveRef.current(target);
            dragY.setValue(0);
            onDragEndRef.current();
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            damping: 22,
            stiffness: 240,
            mass: 0.75,
            overshootClamping: true,
            useNativeDriver: true,
          }).start(() => {
            onDragCancelRef.current();
            onDragEndRef.current();
          });
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
    justifyContent: "center",
    gap: 6,
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
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  detailedMaps: { gap: 8 },
  compactMaps: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    alignItems: "flex-start",
  },
  compactMapWrap: { width: "48.8%" },
  mapCard: { gap: 8 },
  compactMapCard: {
    minHeight: 82,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 5,
  },
  mapHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  mapIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  mapName: { fontSize: 9, fontWeight: "900" },
  mapMeta: { fontSize: 7, fontWeight: "700", marginTop: 1 },
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  addExisting: { minHeight: 42, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
  addExistingText: { fontSize: 10, fontWeight: "900" },
  editActions: { flexDirection: "row", gap: 7 },
  editActionButton: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  editHint: { alignItems: "center", paddingVertical: 8 },
  drag: { width: 28, alignItems: "center", justifyContent: "center" },
  remove: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center" },
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
  legendWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -8 },
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
  streakLine: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "right",
  },
});
