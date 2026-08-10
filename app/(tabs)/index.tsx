import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
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
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { AppText as Text } from "@/src/components/AppText";
import {
  LocalizedAlert as Alert,
  useLocale,
  useLocalization,
} from "@/src/i18n";
import { GoalHeatmap } from "@/src/components/GoalHeatmap";
import { FastingProgressBar } from "@/src/components/FastingProgressBar";
import { RangeGoalProgressBar } from "@/src/components/RangeGoalProgressBar";
import { TodoTodayList } from "@/src/components/TodoTodayList";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  todoAppearsOnDate,
  todoResolvedOnDate,
} from "@/src/domain/schedule";
import {
  ALL_GOALS_COMPLETE_COLOR,
  GOAL_COMPLETE_COLOR,
} from "@/src/domain/colors";
import { ReorderItem } from "@/src/components/ReorderItem";
import { useEditWiggle } from "@/src/components/useEditWiggle";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, ProgressBar } from "@/src/components/ui";
import { DEFAULT_METRICS } from "@/src/data/seed";
import {
  calendarPeriodRange,
  compactDayDate,
  dateKey,
  dateWithOffsetFrom,
} from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import {
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricJourneyProgressStats,
  metricStreakStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
  weightProgressStats,
  weeklyDeficitBalance,
} from "@/src/domain/metrics";
import {
  compoundMetricValues,
  formatCompoundMetricValue,
  submetricAsMetric,
} from "@/src/domain/submetrics";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import {
  useCloudSyncActions,
  useCloudSyncStatus,
} from "@/src/cloud/CloudSyncProvider";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  CompletionFillMode,
  HistoryRange,
  MetricDefinition,
} from "@/src/types";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { orderTodayMetrics } from "@/src/domain/todayOrdering";
import { metricVisualization } from "@/src/domain/visualization";
import { fastingProgressForDate } from "@/src/domain/fasting";
import {
  completionIndicatorFillMode,
  completionIndicatorOption,
} from "@/src/domain/completionIndicators";
import {
  activeTrackerViewLabel,
  activeTrackerViewId,
  ALL_AVAILABLE_TRACKERS_FILTER,
  ALL_TRACKERS_FILTER,
  metricMatchesActiveView,
  TRACKED_ONLY_FILTER,
} from "@/src/domain/viewFilters";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const GOLD_HERO_FADE_MS = 1300;
const GOLD_TILE_FADE_MS = 950;
const GOLD_TILE_START_DELAY_MS = 1450;
const GOLD_TILE_STAGGER_MS = 1050;
const COMPLETION_INDICATOR_SIZE = 60;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function Today() {
  const {
    state,
    reorderMetric,
    setMetricSection,
    setTrackedGoal,
    deleteMetric,
    updateMetric,
    updateSettings,
  } = useApp();
  const health = useHealthSync();
  const cloud = useCloudSyncActions();
  const cloudStatus = useCloudSyncStatus();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { height } = useWindowDimensions();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [completionSortEnabled, setCompletionSortEnabled] = useState(true);
  const exitingEditMode = useRef(false);
  const [draggingMetricId, setDraggingMetricId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [showAddTiles, setShowAddTiles] = useState(false);
  const [showDayEnd, setShowDayEnd] = useState(false);
  const [showHistoryOptions, setShowHistoryOptions] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<string[]>([]);
  const [showViewFilters, setShowViewFilters] = useState(false);
  const todaySwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !editing &&
          !showMore &&
          !showAddTiles &&
          !showDayEnd &&
          !showHistoryOptions &&
          gesture.dx < -22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -55) router.navigate("/menu");
        },
      }),
    [editing, showAddTiles, showDayEnd, showHistoryOptions, showMore],
  );
  useEffect(() => {
    if (!editing) {
      setDraggingMetricId(null);
    }
  }, [editing]);
  useEffect(() => {
    setCloudSyncPaused("today-edit", editing);
    return () => setCloudSyncPaused("today-edit", false);
  }, [editing]);
  const beginEditing = useCallback(() => {
    exitingEditMode.current = false;
    setCompletionSortEnabled(false);
    setEditing(true);
  }, []);
  const finishEditing = useCallback(() => {
    if (exitingEditMode.current) return;
    exitingEditMode.current = true;
    setDraggingMetricId(null);
    requestAnimationFrame(() => {
      setEditing(false);
      requestAnimationFrame(() => {
        setCompletionSortEnabled(true);
        exitingEditMode.current = false;
      });
    });
  }, []);
  const today = dateKey();
  const todayHistoryRange = state.settings.todayHistoryRange ?? "week";
  const user = state.group.members.find(
    (item) => item.id === state.currentUserId,
  )!;
  const goals = trackedGoalSummary(state, state.currentUserId, today);
  const showGoalsToday = state.settings.showGoalsToday !== false;
  const weekly = weeklyDeficitBalance(state, state.currentUserId, today);
  const activeTodayView = (state.settings.trackerViewFilters ?? []).find(
    (filter) => filter.id === state.settings.activeTodayTrackerViewFilterId,
  );
  const customTodoVisible = activeTodayView?.includeTodos !== false;
  const customTodoIds = activeTodayView?.todoIds;
  const todayTodos =
    state.settings.showTodosToday === false || !customTodoVisible
      ? []
      : (state.todos ?? []).filter(
          (todo) =>
            (customTodoIds === undefined || customTodoIds.includes(todo.id)) &&
            todoAppearsOnDate(todo, today),
        );
  const completedTodayTodos = todayTodos.filter((todo) =>
    todoResolvedOnDate(todo, today),
  ).length;
  const heroUsesGoals = showGoalsToday;
  const heroMet = heroUsesGoals ? goals.met : completedTodayTodos;
  const heroTotal = heroUsesGoals ? goals.total : todayTodos.length;
  const heroProgress = heroTotal ? heroMet / heroTotal : 0;
  const heroAllMet = heroTotal > 0 && heroMet === heroTotal;
  const visible = useMemo(() => {
    // This is the section-level visibility switch, so it must fence every
    // metric-card path rather than only ordinary goal rows. Derived metrics
    // (for example Weekly balance), calculated/food/fasting trackers and the
    // compact "More" sheet all flow from this same collection. Keep the edit
    // header visible below so the eye control can reveal the section again.
    if (!showGoalsToday) return [];
    const ordered = state.metrics
        .filter(
          (item) =>
            !isInternalTracker(item) &&
            (item.sections.today ||
              activeTrackerViewId(state, "today") !== ALL_TRACKERS_FILTER) &&
            item.activeFrom <= today &&
            (
              state.settings.showUntrackedToday !== false ||
              isMetricTrackedOnDate(state, item, today) ||
              activeTrackerViewId(state, "today") !==
                ALL_TRACKERS_FILTER
            ) &&
            metricMatchesActiveView(state, item, today, "today"),
        )
        .sort((a, b) => a.order - b.order);
    if (editing || !completionSortEnabled) return ordered;
    const completedBehavior =
      state.settings.completedTodayBehavior ?? "bottom";
    return orderTodayMetrics(ordered, completedBehavior, (item) => {
      return (
        item.goalEnabled !== false &&
        metricApplicableOnDate(
          state,
          item,
          state.currentUserId,
          today,
        ) &&
        scheduledGoalReached(state, item, state.currentUserId, today)
      );
    });
  }, [completionSortEnabled, editing, showGoalsToday, state, today]);
  const tileLimit = Math.max(
    3,
    Math.min(8, state.settings.todayTileLimit ?? 5),
  );
  const primary = editing || state.settings.showAllTodayTiles
    ? visible
    : visible.slice(0, tileLimit);
  useEffect(() => {
    if (state.settings.todayHistoryCollapsed === true) return;
    setExpandedHistoryIds((current) => {
      const next = primary.map((metric) => metric.id);
      return current.length === next.length &&
        current.every((id, index) => id === next[index])
        ? current
        : next;
    });
  }, [primary, state.settings.todayHistoryCollapsed]);
  const goldGoalOrder = primary
    .filter((item) => isMetricTrackedOnDate(state, item, today))
    .map((item) => item.id);
  const extra = editing || state.settings.showAllTodayTiles
    ? []
    : visible.slice(tileLimit);
  const hiddenTrackers = state.metrics
    .filter(
      (metric) =>
        !isInternalTracker(metric) &&
        !metric.sections.today &&
        metric.activeFrom <= today,
    )
    .sort((a, b) => a.order - b.order);
  const [goldSequenceRun, setGoldSequenceRun] = useState(0);
  const goalLiquidMotion = useRef(new Animated.Value(0)).current;
  const heroGold = useRef(new Animated.Value(heroAllMet ? 1 : 0)).current;
  const heroCompletionColor = heroGold.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.lime, "#FFD166"],
  });
  const heroBackgroundColor = heroGold.interpolate({
    inputRange: [0, 1],
    outputRange: [accent, colors.isDark ? "#806018" : "#B98212"],
  });
  useEffect(() => {
    if (!heroAllMet) {
      heroGold.stopAnimation();
      heroGold.setValue(0);
    }
  }, [heroAllMet, heroGold]);
  useEffect(() => {
    if (!heroAllMet || goldSequenceRun === 0) return;
    heroGold.stopAnimation();
    heroGold.setValue(0);
    const animation = Animated.timing(heroGold, {
      toValue: 1,
      duration: GOLD_HERO_FADE_MS,
      delay: 0,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [goldSequenceRun, heroAllMet, heroGold]);
  useEffect(() => {
    if (!goals.metrics.length || !showGoalsToday) return;
    goalLiquidMotion.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(goalLiquidMotion, {
          toValue: 1,
          duration: 1700,
          useNativeDriver: true,
        }),
        Animated.timing(goalLiquidMotion, {
          toValue: 0,
          duration: 1700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [goalLiquidMotion, goals.metrics.length, showGoalsToday]);
  const celebration = useRef(new Animated.Value(0)).current;
  const [confettiVisible, setConfettiVisible] = useState(false);
  const [celebrationSpecial, setCelebrationSpecial] = useState(false);
  const [celebratingGoalIds, setCelebratingGoalIds] = useState<string[]>([]);
  const celebrationStorageKey = `metric-rally-celebrations-v2:${state.currentUserId}:${today}`;
  const completedGoalIds = goals.metrics
    .filter((item) => scheduledGoalReached(state, item, state.currentUserId, today))
    .map((item) => item.id)
    .sort();
  const completedTodoIds = (state.todos ?? [])
    .filter(
      (todo) =>
        todoAppearsOnDate(todo, today) &&
        todo.completedDates.includes(today),
    )
    .map((todo) => `todo:${todo.id}`);
  const goalCelebrationKey = [...completedGoalIds, ...completedTodoIds]
    .sort()
    .join("|");
  const celebrationSnapshot = useRef({ goalCelebrationKey, allMet: goals.allMet });
  celebrationSnapshot.current = { goalCelebrationKey, allMet: goals.allMet };
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let clearTiles: ReturnType<typeof setTimeout> | undefined;
      let clearConfetti: ReturnType<typeof setTimeout> | undefined;
      AsyncStorage.getItem(celebrationStorageKey)
        .then((saved) => {
          if (cancelled) return;
          const previous = new Set((saved ?? "").split("|").filter(Boolean));
          const completed = celebrationSnapshot.current.goalCelebrationKey
            .split("|")
            .filter(Boolean);
          const newlyCompleted = completed.filter((id) => !previous.has(id));
          if (newlyCompleted.length) {
            const newGoalIds = newlyCompleted.filter(
              (id) => !id.startsWith("todo:"),
            );
            const special =
              newGoalIds.length > 0 && celebrationSnapshot.current.allMet;
            const duration = special ? 3800 : 2700;
            if (special) setGoldSequenceRun((value) => value + 1);
            setCelebratingGoalIds(newGoalIds);
            setCelebrationSpecial(special);
            setConfettiVisible(true);
            celebration.stopAnimation();
            celebration.setValue(0);
            Animated.timing(celebration, {
              toValue: 1,
              duration,
              useNativeDriver: true,
            }).start(() => {
              if (cancelled) return;
              setConfettiVisible(false);
              celebration.setValue(0);
            });
            // Android can pause a native animation while sync or the app
            // lifecycle changes. This guarantees the overlay is removed.
            clearConfetti = setTimeout(() => {
              if (cancelled) return;
              celebration.stopAnimation();
              celebration.setValue(0);
              setConfettiVisible(false);
            }, duration + 500);
            clearTiles = setTimeout(
              () => setCelebratingGoalIds([]),
              duration,
            );
          }
          AsyncStorage.setItem(
            celebrationStorageKey,
            [...completed].sort().join("|"),
          ).catch(() => undefined);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        if (clearTiles) clearTimeout(clearTiles);
        if (clearConfetti) clearTimeout(clearConfetti);
        celebration.stopAnimation();
        celebration.setValue(0);
        setConfettiVisible(false);
      };
    }, [celebration, celebrationStorageKey]),
  );
  const celebrateTodo = useCallback(
    (todoId: string) => {
      const duration = 2700;
      setCelebrationSpecial(false);
      setConfettiVisible(true);
      celebration.stopAnimation();
      celebration.setValue(0);
      Animated.timing(celebration, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start(() => {
        setConfettiVisible(false);
        celebration.setValue(0);
      });
      setTimeout(() => {
        celebration.stopAnimation();
        celebration.setValue(0);
        setConfettiVisible(false);
      }, duration + 500);
      AsyncStorage.getItem(celebrationStorageKey)
        .then((saved) => {
          const completed = new Set((saved ?? "").split("|").filter(Boolean));
          completed.add(`todo:${todoId}`);
          return AsyncStorage.setItem(
            celebrationStorageKey,
            [...completed].sort().join("|"),
          );
        })
        .catch(() => undefined);
    },
    [celebration, celebrationStorageKey],
  );
  const tileHeight = Math.max(
    52,
    Math.min(
      88,
      (height - 345) / Math.max(Math.min(primary.length, tileLimit), 1),
    ),
  );
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
  function remove(item: MetricDefinition) {
    Alert.alert(
      `Remove ${item.name}?`,
      "Keep earlier history, or permanently remove this tracker and its entries.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Hide from Today",
          onPress: () => setMetricSection(item.id, "today", false, "today"),
        },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: () => deleteMetric(item.id),
        },
      ],
    );
  }
  return (
    <SafeAreaView
      {...todaySwipeResponder.panHandlers}
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      edges={["top", "bottom"]}
    >
      {confettiVisible ? (
        <ConfettiBurst progress={celebration} special={celebrationSpecial} />
      ) : null}
      <ScrollView
        refreshControl={
          <RefreshControl
            enabled={!editing}
            refreshing={
              !editing &&
              (health.status === "syncing" || cloudStatus === "syncing")
            }
            onRefresh={async () => {
              // Health updates become local immediately. Upload the resulting
              // snapshot once, then reconcile shared summaries without ever
              // clearing the cached leaderboard first.
              await health.syncNow("pull").catch(() => undefined);
              await new Promise<void>((resolve) =>
                setTimeout(resolve, 0),
              );
              await cloud.syncNow().catch(() => undefined);
              await cloud.refreshActivity().catch(() => undefined);
            }}
            tintColor={accent}
          />
        }
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerIdentity}>
            <Text style={[styles.eyebrow, { color: accent }]}>
              {compactDayDate(today, locale)}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.greeting, { color: colors.ink }]}
            >
              Hi, {memberDisplayName(state, user)}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {editing ? (
              <>
                <HeaderIcon
                  icon="settings-outline"
                  label="Customize Today"
                  onPress={() =>
                    router.navigate("/customize?tab=today" as never)
                  }
                  colors={colors}
                  accent={accent}
                />
                <Pressable
                  onPress={finishEditing}
                  style={[styles.done, { backgroundColor: accent }]}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                <HeaderIcon
                  icon="sparkles-outline"
                  label="Open recap"
                  onPress={() =>
                    router.navigate("/recap?scope=personal" as never)
                  }
                  colors={colors}
                  accent={accent}
                />
                {state.settings.showCalendarShortcut ? (
                  <HeaderIcon
                    icon="calendar-outline"
                    label="Open schedule"
                    onPress={() => router.navigate("/calendar" as never)}
                    colors={colors}
                    accent={accent}
                  />
                ) : null}
                {state.settings.showJournalShortcut ? (
                  <HeaderIcon
                    icon="book-outline"
                    label="Open journal"
                    onPress={() => router.navigate("/journal" as never)}
                    colors={colors}
                    accent={accent}
                  />
                ) : null}
                <HeaderIcon
                  icon="notifications-outline"
                  label="Open notifications"
                  onPress={() =>
                    router.navigate("/alerts?scope=personal" as never)
                  }
                  colors={colors}
                  accent={accent}
                />
              </>
            )}
            <Pressable onPress={() => router.navigate("/menu")}>
              <Avatar
                initials={user.initials}
                color={accent}
                uri={user.avatarUri}
                size={39}
              />
            </Pressable>
          </View>
        </View>
        <TutorialTarget id="today-hero">
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Open daily status"
          onPress={() => router.navigate("/status" as never)}
          style={[
            styles.hero,
            {
              backgroundColor: heroBackgroundColor,
              borderColor: heroCompletionColor,
            },
          ]}
        >
          <View style={styles.heroTop}>
            <View>
              <Text
                style={[
                  styles.heroEyebrow,
                  { color: "rgba(255,255,255,.76)" },
                ]}
              >
                {heroAllMet
                  ? "DAY COMPLETE"
                  : heroUsesGoals
                    ? "TODAY'S FOCUS"
                    : "TO-DOS"}
                {heroUsesGoals && todayTodos.length
                  ? ` · ${completedTodayTodos}/${todayTodos.length} TO-DOS`
                  : ""}
              </Text>
              <Text
                preserveColor
                style={[
                  styles.heroValue,
                  { color: palette.white },
                ]}
              >
                {`${heroMet} of ${heroTotal}`}
              </Text>
              <Text
                preserveColor
                style={[
                  styles.heroTitle,
                  { color: palette.white },
                ]}
              >
                {heroAllMet
                  ? heroUsesGoals
                    ? "Every goal reached"
                    : "Every to-do complete"
                  : heroTotal
                    ? `${heroTotal - heroMet} ${
                        heroUsesGoals
                          ? `goal${heroTotal - heroMet === 1 ? "" : "s"}`
                          : `to-do${heroTotal - heroMet === 1 ? "" : "s"}`
                      } left`
                    : heroUsesGoals
                      ? "Choose your first goal"
                      : "No to-dos today"}
              </Text>
            </View>
            <CompletionShapeIndicator
              icon={state.settings.completionIndicatorIcon}
              progress={heroProgress}
              fillMode={
                state.settings.completionIndicatorFillMode ?? "auto"
              }
              color={
                heroAllMet
                  ? ALL_GOALS_COMPLETE_COLOR
                  : GOAL_COMPLETE_COLOR
              }
            />
          </View>
          <View
            style={[
              styles.heroProgressTrack,
              { backgroundColor: "rgba(255,255,255,.22)" },
            ]}
          >
            <Animated.View
              style={[
                styles.heroProgressFill,
                {
                  backgroundColor: heroCompletionColor,
                  width: `${heroProgress * 100}%`,
                },
              ]}
            />
          </View>
          {heroUsesGoals && todayTodos.length ? (
            <View style={styles.heroTodoProgressTrack}>
              <View
                style={[
                  styles.heroTodoProgressFill,
                  {
                    width: `${(completedTodayTodos / todayTodos.length) * 100}%`,
                  },
                ]}
              />
            </View>
          ) : null}
          {heroUsesGoals ? (
            <View style={styles.goalDots}>
              {goals.metrics.map((item) => {
                const unavailable = goals.unavailable.some(
                  (metric) => metric.id === item.id,
                );
                const met = scheduledGoalReached(
                  state,
                  item,
                  state.currentUserId,
                  today,
                );
                const value = unavailable
                  ? 0
                  : safeMetricValue(
                      state,
                      item,
                      state.currentUserId,
                      today,
                    );
                const progress = unavailable
                  ? 0
                  : met
                    ? 1
                    : Math.max(
                        0,
                        Math.min(
                          1,
                          metricVisualProgress(
                            state,
                            item,
                            state.currentUserId,
                            today,
                            value,
                            effectiveGoalTarget(
                              state,
                              item,
                              state.currentUserId,
                              today,
                            ),
                          ),
                        ),
                      );
                return (
                  <GoalCompletionDot
                    key={item.id}
                    icon={item.icon as keyof typeof Ionicons.glyphMap}
                    name={item.name}
                    met={met}
                    progress={progress}
                    unavailable={unavailable}
                    allMet={goals.allMet}
                    sequenceRun={goldSequenceRun}
                    liquidMotion={goalLiquidMotion}
                    onPress={() =>
                      router.navigate({
                        pathname: "/metric-detail",
                        params: { metric: item.id, date: today },
                      } as never)
                    }
                  />
                );
              })}
            </View>
          ) : null}
        </AnimatedPressable>
        </TutorialTarget>
        {showGoalsToday && goals.allMet ? (
          <Celebration
            title="All goals complete"
            copy="Perfect Day badge earned for completing every tracked goal today."
            special
            colors={colors}
            onPress={() =>
              router.push({
                pathname: "/badges",
                params: {
                  anchor: today,
                  filter: "achievement",
                  highlight: "perfect-day",
                },
              } as never)
            }
          />
        ) : null}
        {state.settings.todosBelowGoals !== true ? (
          <TodoTodayList
            localDate={today}
            onComplete={celebrateTodo}
            editing={editing}
            onRequestEdit={beginEditing}
            visibleOverride={customTodoVisible}
            todoIds={customTodoIds}
          />
        ) : null}
        <View style={styles.sectionRow}>
          <Pressable
            accessibilityLabel="Customize Today"
            delayLongPress={325}
            onLongPress={() => {
              if (!editing) beginEditing();
            }}
          >
            <Text style={[styles.section, { color: colors.ink }]}>Your day</Text>
          </Pressable>
          <View style={styles.sectionActions}>
            {editing ? (
              <Pressable
                accessibilityLabel={
                  showGoalsToday ? "Hide trackers" : "Show trackers"
                }
                onPress={() =>
                  updateSettings({ showGoalsToday: !showGoalsToday })
                }
                style={[
                  styles.sectionVisibility,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name={showGoalsToday ? "eye-outline" : "eye-off-outline"}
                  size={15}
                  color={accent}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setShowViewFilters(true)}
              delayLongPress={325}
              onLongPress={() => {
                if (!editing) beginEditing();
              }}
              style={[
                styles.filterButton,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="funnel-outline" size={12} color={accent} />
              <Text
                numberOfLines={1}
                style={[styles.filterButtonText, { color: accent }]}
              >
                {activeTrackerViewLabel(state, "today")}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.list}>
          {primary.map((item, index) => (
            <ReorderItem
              key={item.id}
              active={draggingMetricId === item.id}
            >
              <TrackerRow
                item={item}
                index={index}
                count={visible.length}
                height={tileHeight}
                state={state}
                day={today}
                editing={editing}
                colors={colors}
                accent={accent}
                weekly={weekly}
                trackedGoal={isMetricTrackedOnDate(
                  state,
                  item,
                  today,
                )}
                allGoalsMet={goals.allMet}
                goalSequenceIndex={goldGoalOrder.indexOf(item.id)}
                goldSequenceRun={goldSequenceRun}
                celebrating={celebratingGoalIds.includes(item.id)}
                historyRange={todayHistoryRange}
                historyExpanded={expandedHistoryIds.includes(item.id)}
                onEdit={beginEditing}
                onMove={(target) =>
                  reorderMetric(item.id, visible[target]?.order ?? target)
                }
                onRemove={() => remove(item)}
                onPin={() => updateMetric(item.id, { pinnedTodayAt: item.pinnedTodayAt ? undefined : new Date().toISOString() })}
                onTrackedToggle={() => {
                  if (isMetricTrackedOnDate(state, item, today)) {
                    Alert.alert(
                      `Stop tracking ${item.name}?`,
                      "Choose whether earlier goal history should remain.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "From today",
                          onPress: () =>
                            setTrackedGoal(item.id, false, "today"),
                        },
                        {
                          text: "Remove history",
                          style: "destructive",
                          onPress: () =>
                            setTrackedGoal(item.id, false, "history"),
                        },
                      ],
                    );
                    return;
                  }
                  Alert.alert(
                    `Track ${item.name}?`,
                    "When should this goal begin counting?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Apply to history",
                        onPress: () =>
                          setTrackedGoal(item.id, true, "history"),
                      },
                      {
                        text: "Start today",
                        onPress: () =>
                          setTrackedGoal(item.id, true, "today"),
                      },
                      {
                        text: "Choose date",
                        onPress: () =>
                          router.navigate({
                            pathname: "/metric-editor",
                            params: { id: item.id, focus: "goal-start" },
                          } as never),
                      },
                    ],
                  );
                }}
                onHistoryExpandToggle={() =>
                  setExpandedHistoryIds((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
                onDragStart={() => {
                  setDraggingMetricId(item.id);
                }}
                onDragHover={() => {}}
                onDragCancel={() => setDraggingMetricId(null)}
                onDragEnd={() => {
                  setDraggingMetricId(null);
                }}
              />
            </ReorderItem>
          ))}
        </View>
        {extra.length ? (
          <Pressable
            onPress={() => setShowMore(true)}
            style={[
              styles.more,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.moreText, { color: colors.ink }]}>More</Text>
            <View style={styles.moreRight}>
              <Text style={[styles.moreCount, { color: colors.muted }]}>
                {extra.length} more
              </Text>
              <Ionicons name="chevron-down" size={17} color={colors.faint} />
            </View>
          </Pressable>
        ) : null}
        {state.settings.todosBelowGoals === true ? (
          <TodoTodayList
            localDate={today}
            onComplete={celebrateTodo}
            editing={editing}
            onRequestEdit={beginEditing}
            visibleOverride={customTodoVisible}
            todoIds={customTodoIds}
          />
        ) : null}
        {editing ? (
          <View style={styles.editActions}>
            <Pressable
              onPress={() => setShowAddTiles(true)}
              style={[styles.add, styles.editActionButton, { borderColor: accent }]}
            >
              <Ionicons name="add" size={19} color={accent} />
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={[styles.addText, { color: accent }]}
              >
                Add existing
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/metric-editor",
                  params: { id: "new" },
                })
              }
              style={[styles.add, styles.editActionButton, { borderColor: accent }]}
            >
              <Ionicons name="create-outline" size={18} color={accent} />
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={[styles.addText, { color: accent }]}
              >
                Create tracker
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.navigate("/customize?tab=goals" as never)}
              style={[styles.add, styles.editActionButton, { borderColor: accent }]}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={18}
                color={accent}
              />
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={[styles.addText, { color: accent }]}
              >
                Tracked goals
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowHistoryOptions(true)}
              style={[styles.add, styles.editActionButton, { borderColor: accent }]}
            >
              <Ionicons name="calendar-outline" size={18} color={accent} />
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={[styles.addText, { color: accent }]}
              >
                History
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowDayEnd(true)}
              style={[styles.add, styles.editActionButton, { borderColor: accent }]}
            >
              <Ionicons name="moon-outline" size={18} color={accent} />
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={[styles.addText, { color: accent }]}
              >
                Day ends {state.settings.dayEndTime ?? "00:00"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <Modal
        transparent
        animationType="fade"
        visible={showViewFilters}
        onRequestClose={() => setShowViewFilters(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setShowViewFilters(false)}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>
              Today view
            </Text>
            {[
              [TRACKED_ONLY_FILTER, "Tracked goals only", "flag-outline"],
              [ALL_AVAILABLE_TRACKERS_FILTER, "All trackers", "apps-outline"],
              [ALL_TRACKERS_FILTER, "None", "remove-circle-outline"],
              ...(state.settings.trackerViewFilters ?? [])
                .filter((filter) => filter.visible !== false)
                .map((filter) => [
                  filter.id,
                  filter.name,
                  "funnel-outline",
                ]),
            ].map(([id, label, icon]) => (
              <Pressable
                key={id}
                onPress={() => {
                  updateSettings({ activeTodayTrackerViewFilterId: id });
                  setShowViewFilters(false);
                }}
                style={[styles.sheetRow, { borderColor: colors.border }]}
              >
                <Ionicons
                  name={icon as keyof typeof Ionicons.glyphMap}
                  size={17}
                  color={accent}
                />
                <Text style={[styles.sheetName, { color: colors.ink }]}>
                  {label}
                </Text>
                {activeTrackerViewId(state, "today") === id ? (
                  <Ionicons name="checkmark" size={17} color={accent} />
                ) : null}
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setShowViewFilters(false);
                router.navigate({
                  pathname: "/view-filters",
                  params: { scope: "today" },
                } as never);
              }}
              style={[styles.manageFilters, { borderColor: accent }]}
            >
              <Ionicons name="settings-outline" size={15} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>
                Manage custom views
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={showMore}
        onRequestClose={() => setShowMore(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowMore(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>
              More from today
            </Text>
            {extra.map((item) => {
              const completed =
                metricApplicableOnDate(
                  state,
                  item,
                  state.currentUserId,
                  today,
                ) &&
                scheduledGoalReached(
                  state,
                  item,
                  state.currentUserId,
                  today,
                );
              return (
              <Pressable
                key={item.id}
                onPress={() => {
                  setShowMore(false);
                  router.navigate({
                    pathname: "/metric-detail",
                    params: { metric: item.id },
                  });
                }}
                style={[styles.sheetRow, { borderColor: colors.border }]}
              >
                <View
                  style={[
                    styles.smallIcon,
                    { backgroundColor: `${item.color}18` },
                  ]}
                >
                  <Ionicons
                    name={item.icon as keyof typeof Ionicons.glyphMap}
                    size={17}
                    color={item.color}
                  />
                </View>
                <Text
                  style={[
                    styles.sheetName,
                    { color: completed ? GOAL_COMPLETE_COLOR : colors.ink },
                    completed && styles.completedText,
                  ]}
                >
                  {item.name}
                </Text>
                {isMetricTrackedOnDate(state, item, today) ? (
                  <View
                    style={[
                      styles.trackedMarker,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons name="flag" size={9} color={accent} />
                  </View>
                ) : null}
                <Text style={[styles.sheetValue, { color: colors.muted }]}>
                  {displayValue(state, item, today, weekly)}
                </Text>
                {completed ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={17}
                    color={GOAL_COMPLETE_COLOR}
                  />
                ) : null}
              </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={showHistoryOptions}
        onRequestClose={() => setShowHistoryOptions(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setShowHistoryOptions(false)}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>
              History below Today tiles
            </Text>
            {(
              [
                ["week", "Week", "Seven daily cells"],
                ["month", "Month", "Every day in the selected month"],
                ["year", "Year", "A compact full-year grid"],
              ] as const
            ).map(([range, label, description]) => (
              <Pressable
                key={range}
                onPress={() => {
                  updateSettings({ todayHistoryRange: range });
                }}
                style={[styles.sheetRow, { borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={17} color={accent} />
                <View style={styles.historyOptionCopy}>
                  <Text
                    style={[
                      styles.historyOptionTitle,
                      { color: colors.ink },
                    ]}
                  >
                    {label}
                  </Text>
                  <Text
                    style={[
                      styles.historyOptionDescription,
                      { color: colors.muted },
                    ]}
                  >
                    {description}
                  </Text>
                </View>
                {todayHistoryRange === range ? (
                  <Ionicons name="checkmark" size={17} color={accent} />
                ) : null}
              </Pressable>
            ))}
            <View style={styles.historyBulkRow}>
              <Pressable
                onPress={() => {
                  setExpandedHistoryIds(primary.map((metric) => metric.id));
                  updateSettings({ todayHistoryCollapsed: false });
                  setShowHistoryOptions(false);
                }}
                style={[
                  styles.historyBulkButton,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons name="chevron-down" size={17} color={accent} />
                <Text style={[styles.historyBulkText, { color: colors.ink }]}>
                  Expand all
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setExpandedHistoryIds([]);
                  updateSettings({ todayHistoryCollapsed: true });
                  setShowHistoryOptions(false);
                }}
                style={[
                  styles.historyBulkButton,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons name="chevron-up" size={17} color={accent} />
                <Text style={[styles.historyBulkText, { color: colors.ink }]}>
                  Collapse all
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      <Modal transparent animationType="fade" visible={showDayEnd} onRequestClose={() => setShowDayEnd(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowDayEnd(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>When does your day finish?</Text>
            <Text style={[styles.moreCount, { color: colors.muted }]}>Food and energy-balance goals become final at this time.</Text>
            <View style={styles.dayEndOptions}>
              {["21:00", "22:00", "23:00", "00:00"].map((time) => (
                <Pressable key={time} onPress={() => { updateSettings({ dayEndTime: time }); setShowDayEnd(false); }} style={[styles.dayEndChoice, { borderColor: time === (state.settings.dayEndTime ?? "00:00") ? accent : colors.border }]}>
                  <Text style={[styles.name, { color: colors.ink }]}>{time}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={showAddTiles}
        onRequestClose={() => setShowAddTiles(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setShowAddTiles(false)}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>
              Add an existing tracker
            </Text>
            {hiddenTrackers.length ? (
              hiddenTrackers.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setMetricSection(item.id, "today", true);
                    setShowAddTiles(false);
                  }}
                  style={[styles.sheetRow, { borderColor: colors.border }]}
                >
                  <Ionicons
                    name={item.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={item.color}
                  />
                  <Text style={[styles.sheetName, { color: colors.ink }]}>
                    {item.name}
                  </Text>
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={accent}
                  />
                </Pressable>
              ))
            ) : (
              <Text style={[styles.moreCount, { color: colors.muted }]}>
                Every available tracker already has a Today tile.
              </Text>
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ConfettiBurst({
  progress,
  special,
}: {
  progress: Animated.Value;
  special: boolean;
}) {
  const { height } = useWindowDimensions();
  const colors = special
    ? ["#FFD700", "#FFB000", "#FFF1A8", "#F6C445"]
    : [palette.lime, palette.amber, palette.purple, palette.red, palette.white];
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confetti,
        special && styles.confettiSpecial,
        {
          opacity: progress.interpolate({
            inputRange: [0, 0.06, 0.82, 1],
            outputRange: [0, 1, 1, 0],
          }),
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-60, special ? height * 0.82 : height * 0.66],
            }),
          }],
        },
      ]}
    >
      {Array.from({ length: special ? 160 : 72 }, (_, index) => (
        <View
          key={index}
          style={[
            styles.confettiPiece,
            {
              left: `${(index * 37) % 96}%`,
              top: special
                ? (index * 47) % Math.max(420, height - 80)
                : (index * 23) % 170,
              backgroundColor: colors[index % colors.length],
              transform: [{ rotate: `${index * 29}deg` }],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

function GoalCompletionDot({
  icon,
  name,
  met,
  progress,
  unavailable,
  allMet,
  sequenceRun,
  liquidMotion,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  name: string;
  met: boolean;
  progress: number;
  unavailable: boolean;
  allMet: boolean;
  sequenceRun: number;
  liquidMotion: Animated.Value;
  onPress: () => void;
}) {
  const gold = useRef(new Animated.Value(allMet && met ? 1 : 0)).current;
  useEffect(() => {
    if (!allMet || !met) {
      gold.stopAnimation();
      gold.setValue(0);
    }
  }, [allMet, gold, met]);
  useEffect(() => {
    if (!allMet || !met || sequenceRun === 0) return;
    gold.stopAnimation();
    gold.setValue(0);
    const animation = Animated.timing(gold, {
      toValue: 1,
      duration: GOLD_HERO_FADE_MS,
      delay: 0,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [allMet, gold, met, sequenceRun]);
  const fillColor = met
    ? gold.interpolate({
        inputRange: [0, 1],
        outputRange: [palette.lime, "#FFD166"],
      })
    : palette.lime;
  const normalized = unavailable
    ? 0
    : Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const waveTranslateX = liquidMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [-5, 5],
  });
  return (
    <Pressable
      accessibilityLabel={`Open ${name}, ${Math.round(normalized * 100)}% complete`}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      hitSlop={5}
    >
      <View style={styles.dot}>
        {normalized > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.dotLiquid,
              {
                backgroundColor: fillColor,
                height: `${normalized * 100}%`,
              },
            ]}
          >
            {normalized < 1 ? (
              <Animated.View
                style={[
                  styles.dotWave,
                  { transform: [{ translateX: waveTranslateX }] },
                ]}
              />
            ) : null}
          </Animated.View>
        ) : null}
        <Ionicons
          name={unavailable ? "remove" : met ? "checkmark" : icon}
          size={11}
          color={met && allMet ? "#654900" : palette.white}
          style={styles.dotIcon}
        />
      </View>
    </Pressable>
  );
}

export default Today;

function HeaderIcon({
  icon,
  label,
  onPress,
  colors,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.headerIcon,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={18} color={accent} />
    </Pressable>
  );
}
function TrackerRow({
  item,
  index,
  count,
  height,
  state,
  day,
  editing,
  colors,
  accent,
  weekly,
  trackedGoal,
  allGoalsMet,
  goalSequenceIndex,
  goldSequenceRun,
  celebrating,
  historyRange,
  historyExpanded,
  onEdit,
  onMove,
  onRemove,
  onPin,
  onTrackedToggle,
  onHistoryExpandToggle,
  onDragStart,
  onDragHover,
  onDragCancel,
  onDragEnd,
}: {
  item: MetricDefinition;
  index: number;
  count: number;
  height: number;
  state: ReturnType<typeof useApp>["state"];
  day: string;
  editing: boolean;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
  weekly: ReturnType<typeof weeklyDeficitBalance>;
  trackedGoal: boolean;
  allGoalsMet: boolean;
  goalSequenceIndex: number;
  goldSequenceRun: number;
  celebrating: boolean;
  historyRange: HistoryRange | "off";
  historyExpanded: boolean;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
  onPin: () => void;
  onTrackedToggle: () => void;
  onHistoryExpandToggle: () => void;
  onDragStart: () => void;
  onDragHover: (target: number) => void;
  onDragCancel: () => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { t } = useLocalization();
  const arrival = useRef(new Animated.Value(1)).current;
  const dragStep = height + 6;
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: dragStep,
    onMove,
    onStart: onDragStart,
    onTargetChange: onDragHover,
    onCancel: onDragCancel,
    onEnd: onDragEnd,
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
  useEffect(() => smoothDrag.setStep(dragStep), [dragStep, smoothDrag]);
  useEffect(() => {
    if (!celebrating) return;
    arrival.setValue(0);
    Animated.spring(arrival, {
      toValue: 1,
      damping: 12,
      stiffness: 145,
      useNativeDriver: true,
    }).start();
  }, [arrival, celebrating]);
  const actualValue =
    item.id === "weekly_deficit_balance"
      ? weekly.balance
      : safeMetricValue(state, item, state.currentUserId, day);
  const value = useAnimatedNumber(actualValue);
  const weeklyBalanceAhead =
    item.id === "weekly_deficit_balance" &&
    weekly.days > 0 &&
    weekly.balance >= 0;
  const applicable = metricApplicableOnDate(
    state,
    item,
    state.currentUserId,
    day,
  );
  const target = effectiveGoalTarget(state, item, state.currentUserId, day);
  const met =
    applicable &&
    scheduledGoalReached(state, item, state.currentUserId, day);
  const currentStreak = useMemo(
    () =>
      metricStreakStats(state, item, state.currentUserId, dateKey()).current,
    [item, state],
  );
  const cardComplete =
    item.id === "weekly_deficit_balance" ? weeklyBalanceAhead : met;
  const gold = useRef(
    new Animated.Value(allGoalsMet && trackedGoal && met ? 1 : 0),
  ).current;
  useEffect(() => {
    if (!allGoalsMet || !trackedGoal || !met) {
      gold.stopAnimation();
      gold.setValue(0);
    }
  }, [allGoalsMet, gold, met, trackedGoal]);
  useEffect(() => {
    const becomesGold = allGoalsMet && trackedGoal && met;
    if (!becomesGold || goldSequenceRun === 0) return;
    gold.stopAnimation();
    gold.setValue(0);
    const animation = Animated.timing(gold, {
      toValue: 1,
      duration: GOLD_TILE_FADE_MS,
      delay:
        GOLD_TILE_START_DELAY_MS +
        Math.max(0, goalSequenceIndex) * GOLD_TILE_STAGGER_MS,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [
    allGoalsMet,
    goalSequenceIndex,
    gold,
    goldSequenceRun,
    met,
    trackedGoal,
  ]);
  const completedBackground = gold.interpolate({
    inputRange: [0, 1],
    outputRange: [
      colors.isDark ? "#193625" : "#EFF9DE",
      colors.isDark ? "#3B3218" : "#FFF5D6",
    ],
  });
  const completedBorder = gold.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.lime, "#FFD166"],
  });
  const isBloodPressure =
    item.id === "blood_pressure" ||
    item.id === "blood_pressure_systolic" ||
    item.name.trim().toLowerCase() === "blood pressure" ||
    (item.healthMapping?.dataType === "blood_pressure" &&
      item.healthMapping.field !== "diastolic");
  const isFasting = Boolean(item.fastingSettings);
  const fastingProgress = isFasting
    ? fastingProgressForDate(
        state,
        state.currentUserId,
        day,
        new Date(),
        item.id,
      )
    : undefined;
  const fastingStartedAt = fastingProgress?.startedAt
    ? new Date(fastingProgress.startedAt)
    : undefined;
  const fastingStartClock =
    fastingStartedAt && !Number.isNaN(fastingStartedAt.getTime())
      ? new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit",
          hour12: state.settings.timeFormat === "12h",
        }).format(fastingStartedAt)
      : undefined;
  const fastingStartDay =
    fastingStartedAt && dateKey(fastingStartedAt) === dateKey()
      ? t("Today")
      : fastingStartedAt &&
          dateKey(fastingStartedAt) === dateWithOffsetFrom(dateKey(), -1)
        ? t("Yesterday")
        : fastingStartedAt
          ? new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(fastingStartedAt)
          : "";
  const diastolic = isBloodPressure
    ? state.metrics.find(
        (candidate) =>
          candidate.id === "blood_pressure_diastolic" ||
          candidate.id.toLowerCase().includes("diastolic") ||
          (candidate.healthMapping?.dataType === "blood_pressure" &&
            candidate.healthMapping.field === "diastolic"),
      ) ??
      DEFAULT_METRICS.find(
        (candidate) => candidate.id === "blood_pressure_diastolic",
      )
    : undefined;
  const diastolicValue = diastolic
    ? safeMetricValue(state, diastolic, state.currentUserId, day)
    : 0;
  const photo =
    item.dataType === "photo"
      ? state.photos.find(
          (entry) =>
            entry.userId === state.currentUserId && entry.localDate === day,
        )
      : undefined;
  const compoundValues = compoundMetricValues(
    state,
    item,
    state.currentUserId,
    day,
  );
  const mergedCompoundValue = formatCompoundMetricValue(item, compoundValues);
  const progressSubmetrics = (item.submetrics ?? [])
    .filter((submetric) => submetric.showProgressBar)
    .slice(0, 4);
  const content = isFasting
    ? {
        primary: fastingProgress?.active
          ? "Fast in progress"
          : fastingProgress?.startedAt
            ? `${formatMetricValue(item, fastingProgress.minutes / 60)} fast`
            : "Ready to start",
        secondary: fastingProgress?.active
          ? `${t("Started")} ${fastingStartDay} ${fastingStartClock ?? ""} · ${formatMetricValue(item, fastingProgress.minutes / 60)} ${t("elapsed")}`
          : fastingProgress?.startedAt
            ? fastingProgress.endedOutsideEatingWindow
              ? "Ended outside the eating window"
              : "Ended in the eating window"
            : `${formatMetricValue(item, (fastingProgress?.targetMinutes ?? 16 * 60) / 60)} fast · ${formatMetricValue(item, (1440 - (fastingProgress?.targetMinutes ?? 16 * 60)) / 60)} eating window`,
      }
    : mergedCompoundValue
    ? {
        primary: mergedCompoundValue,
        secondary: "",
      }
    : isBloodPressure
    ? {
        primary:
          value > 0 || diastolicValue > 0
            ? `${value > 0 ? Math.round(value) : "—"}/${diastolicValue > 0 ? Math.round(diastolicValue) : "—"} mmHg`
            : "No reading today",
        secondary: "",
      }
    : trackerCopy(
        state,
        item,
        day,
        value,
        target,
        applicable,
        weekly,
        locale,
      );
  return (
    <Reanimated.View
      style={[
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 20 : editing ? 4 : 0,
          elevation: smoothDrag.dragging ? 12 : 0,
        },
      ]}
    >
    <Animated.View style={{
      transform: [
        {
          translateY: arrival.interpolate({
            inputRange: [0, 1],
            outputRange: [-34, 0],
          }),
        },
        {
          scale: arrival.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
        { rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ["-0.35deg", "0.35deg"] }) },
      ],
    }}>
    <AnimatedPressable
      onLongPress={onEdit}
      onPress={() =>
        editing
          ? undefined
          : item.id === "overall_score"
            ? router.navigate("/group" as never)
            : router.navigate({
                pathname: "/metric-detail",
                params: { metric: item.id },
              })
      }
      style={[
        styles.row,
        !editing && historyRange !== "off" && historyExpanded
          ? styles.rowWithHistory
          : null,
        {
          height,
          backgroundColor: cardComplete
            ? completedBackground
            : colors.card,
          borderColor: cardComplete
            ? completedBorder
            : editing
              ? `${accent}66`
              : colors.border,
        },
      ]}
    >
      {editing ? (
        <GestureDetector gesture={smoothDrag.gesture}>
        <View collapsable={false} style={styles.drag}>
          <Ionicons
            name="reorder-three-outline"
            size={24}
            color={colors.faint}
          />
        </View>
        </GestureDetector>
      ) : (
        <View style={[styles.icon, { backgroundColor: `${item.color}18` }]}>
          {photo ? (
            <Image source={photo.uri} style={styles.photo} />
          ) : (
            <Ionicons
              name={item.icon as keyof typeof Ionicons.glyphMap}
              size={19}
              color={item.color}
            />
          )}
        </View>
      )}
      <View style={styles.rowCopy}>
        <View style={styles.nameLine}>
          <Text
            style={[styles.name, { color: colors.ink }, met && styles.completedText]}
            numberOfLines={1}
            adjustsFontSizeToFit={editing}
            minimumFontScale={editing ? 0.72 : 1}
          >
            {item.name}
          </Text>
          {trackedGoal ? (
            <View
              style={[
                styles.trackedMarker,
                { backgroundColor: colors.primarySoft },
              ]}
              accessibilityLabel="Tracked goal"
            >
              <Ionicons name="flag" size={9} color={accent} />
            </View>
          ) : null}
          {item.pinnedTodayAt && !editing ? (
            <Ionicons
              name="pin"
              size={12}
              color={palette.amber}
              accessibilityLabel="Pinned"
            />
          ) : null}
          {!editing && currentStreak > 0 ? (
            <View style={styles.streakBadge} accessibilityLabel={`${currentStreak} day streak`}>
              <Ionicons name="flame" size={11} color={item.color} />
              <Text style={[styles.streakBadgeText, { color: item.color }]}>
                {currentStreak}
              </Text>
            </View>
          ) : null}
          {met ? (
            <View style={styles.completionCheck}>
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={palette.lime}
              />
              <Animated.View
                style={[styles.completionCheckGold, { opacity: gold }]}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color="#FFD166"
                />
              </Animated.View>
            </View>
          ) : null}
        </View>
        <Text
          style={[
            styles.primary,
            {
              color:
                item.id === "weekly_deficit_balance"
                  ? colors.ink
                  : applicable && item.goal.kind === "at_most" && value > target
                  ? palette.red
                  : colors.ink,
            },
          ]}
          numberOfLines={1}
        >
          {content.primary}
        </Text>
        {content.secondary ? (
          <Text
            style={[styles.secondary, { color: colors.muted }]}
            numberOfLines={editing ? 2 : 1}
          >
            {content.secondary}
          </Text>
        ) : null}
      </View>
      {(item.goalEnabled !== false || progressSubmetrics.length > 0) &&
      applicable &&
      (!isFasting || Boolean(fastingProgress?.startedAt)) ? (
        <View
          style={
            isFasting
              ? styles.fastingProgress
              : progressSubmetrics.length > 1 || diastolic
              ? styles.bpProgress
              : styles.progress
          }
        >
          {isFasting && fastingProgress?.startedAt ? (
            <FastingProgressBar
              startedAt={fastingProgress.startedAt}
              endedAt={fastingProgress.endedAt}
              active={fastingProgress.active}
              locale={locale}
              targetMinutes={fastingProgress.targetMinutes}
              metricColor={item.color}
              timeFormat={state.settings.timeFormat ?? "24h"}
              endedOutsideEatingWindow={
                fastingProgress.endedOutsideEatingWindow
              }
              compact
              style={styles.todayFastingProgressBar}
            />
          ) : progressSubmetrics.length ? (
            progressSubmetrics.map((submetric) => {
              const submetricDefinition = submetricAsMetric(item, submetric);
              const subValue = compoundValues[submetric.id] ?? 0;
              const subMet = goalReached(
                submetricDefinition,
                subValue,
                submetric.goal.target,
              );
              return (
                <View key={submetric.id} style={styles.submetricProgressRow}>
                  <Text
                    style={[styles.bpLabel, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {submetric.name.slice(0, 3).toUpperCase()}
                  </Text>
                  <View style={styles.submetricProgressBar}>
                    {isBloodPressure && submetric.goalRange ? (
                      <RangeGoalProgressBar
                        value={subValue}
                        range={submetric.goalRange}
                        color={subMet ? palette.lime : palette.red}
                        unit={submetric.unit}
                        compact
                      />
                    ) : (
                      <ProgressBar
                        progress={goalProgress(
                          submetricDefinition,
                          subValue,
                          submetric.goal.target,
                        )}
                        color={subMet ? palette.lime : item.color}
                        layered={submetric.goal.kind === "at_least"}
                      />
                    )}
                  </View>
                </View>
              );
            })
          ) : (
            <>
          {diastolic ? <Text style={[styles.bpLabel, { color: colors.muted }]}>SYS</Text> : null}
          {trackedGoal && met ? (
            <GoalProgressBar
              progress={todayProgress(state, item, value, target)}
              transition={gold}
              trackColor={colors.border}
              layered={item.goal.kind === "at_least"}
            />
          ) : (
            <ProgressBar
              progress={todayProgress(state, item, value, target)}
              color={todayProgressColor(state, item, value, target, met)}
              layered={item.goal.kind === "at_least"}
            />
          )}
          {diastolic ? (
            <>
              <Text style={[styles.bpLabel, { color: colors.muted }]}>DIA</Text>
              {trackedGoal && met ? (
                <GoalProgressBar
                  progress={goalProgress(
                    diastolic,
                    diastolicValue,
                    effectiveGoalTarget(
                      state,
                      diastolic,
                      state.currentUserId,
                      day,
                    ),
                  )}
                  transition={gold}
                  trackColor={colors.border}
                />
              ) : (
                <ProgressBar
                  progress={goalProgress(diastolic, diastolicValue, effectiveGoalTarget(state, diastolic, state.currentUserId, day))}
                  color={diastolic.goalRange && diastolicValue >= diastolic.goalRange.min && diastolicValue <= diastolic.goalRange.max ? palette.lime : palette.red}
                />
              )}
            </>
          ) : null}
            </>
          )}
        </View>
      ) : null}
      {editing ? (
        <View style={styles.rowEditActions}>
          <Pressable onPress={onPin} hitSlop={8} style={[styles.editTracker, { borderColor: item.pinnedTodayAt ? palette.amber : accent }]}>
            <Ionicons name={item.pinnedTodayAt ? "pin" : "pin-outline"} size={14} color={item.pinnedTodayAt ? palette.amber : accent} />
          </Pressable>
          <Pressable
            onPress={() => router.navigate({ pathname: "/metric-editor", params: { id: item.id } } as never)}
            hitSlop={8}
            style={[styles.editTracker, { borderColor: accent }]}
          >
            <Ionicons name="create-outline" size={15} color={accent} />
          </Pressable>
          <Pressable
            accessibilityLabel={
              trackedGoal
                ? `Remove ${item.name} from tracked goals`
                : `Add ${item.name} to tracked goals`
            }
            onPress={onTrackedToggle}
            hitSlop={8}
            style={[
              styles.editTracker,
              { borderColor: trackedGoal ? item.color : accent },
            ]}
          >
            <Ionicons
              name={trackedGoal ? "flag" : "flag-outline"}
              size={14}
              color={trackedGoal ? item.color : accent}
            />
          </Pressable>
          <Pressable onPress={onRemove} hitSlop={10} style={styles.remove}>
            <Ionicons name="remove" size={17} color={palette.white} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.rowEnd}>
          {historyRange !== "off" ? (
            <Pressable
              accessibilityLabel={
                historyExpanded ? "Collapse history" : "Expand history"
              }
              onPress={(event) => {
                event.stopPropagation();
                onHistoryExpandToggle();
              }}
              hitSlop={8}
              style={styles.historyToggle}
            >
              <Ionicons
                name={historyExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={accent}
              />
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={colors.faint} />
          )}
        </View>
      )}
    </AnimatedPressable>
    {!editing && historyRange !== "off" && historyExpanded ? (
      <Animated.View
        style={[
          styles.todayHistory,
          {
            backgroundColor: cardComplete ? completedBackground : colors.card,
            borderColor: cardComplete ? completedBorder : colors.border,
          },
        ]}
      >
        <GoalHeatmap
          state={state}
          metric={item}
          dates={calendarPeriodRange(
            day,
            historyRange,
            state.settings.weekStartsOn ?? 1,
          )}
          range={historyRange}
          compact
          completionOnly={
            metricVisualization(item).progressGrid === "completion"
          }
          onSelect={(selectedDate) =>
            router.navigate({
              pathname: "/metric-detail",
              params: { metric: item.id, date: selectedDate },
            })
          }
        />
      </Animated.View>
    ) : null}
    </Animated.View>
    </Reanimated.View>
  );
}

function GoalProgressBar({
  progress,
  transition,
  trackColor,
  layered = false,
}: {
  progress: number;
  transition: Animated.Value;
  trackColor: string;
  layered?: boolean;
}) {
  const color = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.lime, "#FFD166"],
  });
  const secondColor = transition.interpolate({
    inputRange: [0, 1],
    outputRange: ["#66C95E", "#E2B83F"],
  });
  const thirdColor = transition.interpolate({
    inputRange: [0, 1],
    outputRange: ["#2F9E62", "#C98E24"],
  });
  const safeProgress = Math.max(0, Number.isFinite(progress) ? progress : 0);
  const overflow = layered
    ? Math.min(1, Math.max(0, safeProgress - 1))
    : 0;
  const secondOverflow =
    layered && safeProgress >= 2
      ? Math.min(1, Math.max(0, safeProgress - 2))
      : 0;
  return (
    <View style={[styles.goalProgressTrack, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.goalProgressFill,
          {
            backgroundColor: color,
            width: `${Math.min(1, safeProgress) * 100}%`,
          },
        ]}
      />
      {overflow > 0 ? (
        <Animated.View
          style={[
            styles.goalProgressLayer,
            {
              backgroundColor: secondColor,
              width: `${overflow * 100}%`,
            },
          ]}
        />
      ) : null}
      {secondOverflow > 0 ? (
        <Animated.View
          style={[
            styles.goalProgressLayer,
            {
              backgroundColor: thirdColor,
              width: `${secondOverflow * 100}%`,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

function todayProgress(
  state: ReturnType<typeof useApp>["state"],
  item: MetricDefinition,
  value: number,
  target: number,
) {
  if (item.id === "weight" || item.goalProgressMode === "journey")
    return metricVisualProgress(
      state,
      item,
      state.currentUserId,
      dateKey(),
      value,
      target,
    );
  const direction = state.settings.weightDirection ?? "lose";
  if (item.goal.kind === "at_most") {
    if (item.id === "food" && direction === "gain") return value < target ? value / Math.max(target, 1) : 1;
    return Math.min(1, Math.abs(target - value) / Math.max(target, 1));
  }
  return goalProgress(item, value, target);
}

function todayProgressColor(
  state: ReturnType<typeof useApp>["state"],
  item: MetricDefinition,
  value: number,
  target: number,
  met: boolean,
) {
  const direction = state.settings.weightDirection ?? "lose";
  if (item.goalRange)
    return value >= item.goalRange.min && value <= item.goalRange.max ? palette.lime : palette.red;
  if (item.goal.kind === "at_most")
    return item.id === "food" && direction === "gain" ? (value >= target ? palette.lime : palette.red) : (value <= target ? palette.lime : palette.red);
  if (item.id === "deficit")
    return value >= target ? palette.lime : item.color;
  return met ? palette.lime : item.color;
}

function useAnimatedNumber(target: number) {
  const [value, setValue] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const from = current.current;
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const elapsed = Math.min(1, (Date.now() - started) / 520);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = from + (target - from) * eased;
      current.current = next;
      setValue(next);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}
function displayValue(
  state: ReturnType<typeof useApp>["state"],
  item: MetricDefinition,
  day: string,
  weekly: ReturnType<typeof weeklyDeficitBalance>,
) {
  if (item.id === "weekly_deficit_balance")
    return `${Math.abs(Math.round(weekly.balance))} kcal`;
  return formatMetricValue(
    item,
    safeMetricValue(state, item, state.currentUserId, day),
  );
}
function trackerCopy(
  state: ReturnType<typeof useApp>["state"],
  item: MetricDefinition,
  day: string,
  value: number,
  target: number,
  applicable: boolean,
  weekly: ReturnType<typeof weeklyDeficitBalance>,
  locale: string,
) {
  if (!applicable) {
    const secondary =
      item.id === "deficit" || item.id === "weekly_deficit_balance"
        ? "Log food to calculate today’s energy balance"
        : item.id === "todo_completion"
          ? "No to-dos are scheduled for this day"
          : item.goalProgressMode === "journey" || item.id === "weight"
            ? `No ${item.name.toLowerCase()} reading for this day`
            : `No ${item.name.toLowerCase()} data for this day`;
    return { primary: "Not available yet", secondary };
  }
  if (item.id === "weekly_deficit_balance")
    return {
      primary: `${Math.abs(Math.round(weekly.balance)).toLocaleString(locale)} kcal ${weekly.balance >= 0 ? "ahead" : "behind"}`,
      secondary: `${weekly.days} logged day${weekly.days === 1 ? "" : "s"} count this week`,
    };
  if (item.id === "food") {
    const left = target - value;
    return {
      primary:
        left >= 0
          ? `${Math.round(left).toLocaleString(locale)} kcal left`
          : `${Math.abs(Math.round(left)).toLocaleString(locale)} kcal over`,
      secondary: `${Math.round(value).toLocaleString(locale)} consumed · allowance ${Math.round(target).toLocaleString(locale)}`,
    };
  }
  if (item.id === "weight") {
    const progress = weightProgressStats(state, state.currentUserId, day);
    const action = progress.direction === "gain" ? "gained" : "lost";
    return {
      primary: progress.hasMeasurement
        ? `${progress.currentWeight.toFixed(1)} kg · ${progress.remaining.toFixed(1)} kg to target`
        : "Add your first weigh-in",
      secondary: progress.hasMeasurement
        ? `${Math.abs(progress.totalChange).toFixed(1)} kg ${progress.totalChange >= 0 ? action : "off plan"} · ${Math.abs(progress.averageWeeklyChange).toFixed(1)} kg/week avg · ${Math.abs(progress.lastWeekChange).toFixed(1)} kg last week`
        : `Starting ${progress.startingWeight.toFixed(1)} kg · target ${progress.finalTarget.toFixed(1)} kg`,
    };
  }
  if (item.goalProgressMode === "journey") {
    const progress = metricJourneyProgressStats(
      state,
      item,
      state.currentUserId,
      day,
    );
    return {
      primary: progress.hasMeasurement
        ? formatMetricValue(item, progress.current)
        : "Add a first reading",
      secondary: progress.hasMeasurement
        ? `${Math.round(progress.progress * 100)}% to ${formatMetricValue(
            item,
            progress.target,
          )} · ${formatMetricValue(item, progress.remaining)} remaining`
        : "Your first reading becomes the starting point",
    };
  }
  if (item.dataType === "photo")
    return {
      primary: value ? `${Math.round(value)} added today` : "No photo today",
      secondary: "Tap to view or compare progress photos",
    };
  return {
    primary: formatMetricValue(item, value),
    secondary:
      item.goalEnabled === false
        ? "Tracking only"
        : item.goal.kind === "at_most"
          ? `${Math.max(0, target - value).toFixed(item.unit === "L" ? 1 : 0)} ${item.unit} remaining`
          : item.goal.kind === "at_least" && value > target
            ? `${formatMetricValue(item, value - target)} above goal`
          : `Goal ${formatMetricValue(item, target)}`,
  };
}
function Celebration({
  title,
  copy,
  special = false,
  colors,
  onPress,
}: {
  title: string;
  copy: string;
  special?: boolean;
  colors: ReturnType<typeof useAppColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open today's badges"
      onPress={onPress}
      style={[
        styles.celebration,
        {
          backgroundColor: special ? "#FFF2C9" : colors.card,
          borderColor: special ? "#E4B84A" : colors.border,
        },
      ]}
    >
      <Text style={styles.sparkles}>✨</Text>
      <View style={styles.rowCopy}>
        <Text
          style={[styles.name, { color: special ? "#6B4A00" : colors.ink }]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.secondary,
            { color: special ? "#806316" : colors.muted },
          ]}
        >
          {copy}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={special ? "#806316" : colors.muted} />
    </Pressable>
  );
}

/**
 * The selected completion shape is the progress track itself. Its outline is
 * revealed continuously, rather than drawing a second ring around a small icon.
 */
function CompletionShapeIndicator({
  icon,
  progress,
  color,
  fillMode,
}: {
  icon?: string;
  progress: number;
  color: string;
  fillMode: CompletionFillMode;
}) {
  const normalized = Math.max(0, Math.min(1, progress));
  const label = `${Math.round(normalized * 100)}%`;
  const resolvedOption = completionIndicatorOption(icon);
  const resolvedIcon = resolvedOption.icon as keyof typeof Ionicons.glyphMap;
  const resolvedFill = completionIndicatorFillMode(
    resolvedOption.icon,
    fillMode,
  );
  const progressMotion = useRef(new Animated.Value(1)).current;
  const previousProgress = useRef(normalized);

  useEffect(() => {
    if (normalized > previousProgress.current) {
      progressMotion.stopAnimation();
      progressMotion.setValue(0.94);
      Animated.spring(progressMotion, {
        toValue: 1,
        speed: 24,
        bounciness: normalized >= 1 ? 9 : 5,
        useNativeDriver: true,
      }).start();
    }
    previousProgress.current = normalized;
    return () => progressMotion.stopAnimation();
  }, [normalized, progressMotion]);

  const coloredIcon = (style?: object) => (
    <Ionicons
      name={resolvedIcon}
      size={COMPLETION_INDICATOR_SIZE}
      color={color}
      style={[
        styles.completionShapeIcon,
        {
          textShadowColor: color,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 1.15,
        },
        style,
      ]}
    />
  );
  return (
    <Animated.View
      accessibilityLabel={`${label} of today's tracked goals complete`}
      style={[
        styles.completionShape,
        { transform: [{ scale: progressMotion }] },
      ]}
    >
      <Ionicons
        name={resolvedIcon}
        size={COMPLETION_INDICATOR_SIZE}
        color="rgba(255,255,255,.28)"
        style={[
          styles.completionShapeIcon,
          styles.completionShapeTrackIcon,
        ]}
      />
      {resolvedFill === "clockwise" ? (
        <ClockwiseIconReveal progress={normalized}>
          {coloredIcon()}
        </ClockwiseIconReveal>
      ) : (
        <View
          pointerEvents="none"
          style={[
            styles.completionReveal,
            resolvedFill === "bottom_up"
              ? {
                  top: (1 - normalized) * COMPLETION_INDICATOR_SIZE,
                  height: normalized * COMPLETION_INDICATOR_SIZE,
                  width: COMPLETION_INDICATOR_SIZE,
                }
              : {
                  left:
                    ((1 - normalized) * COMPLETION_INDICATOR_SIZE) / 2,
                  width: normalized * COMPLETION_INDICATOR_SIZE,
                  height: COMPLETION_INDICATOR_SIZE,
                },
          ]}
        >
          {coloredIcon(
            resolvedFill === "bottom_up"
              ? { top: -(1 - normalized) * COMPLETION_INDICATOR_SIZE }
              : {
                  left:
                    -((1 - normalized) * COMPLETION_INDICATOR_SIZE) / 2,
                },
          )}
        </View>
      )}
      <View pointerEvents="none" style={styles.completionShapeLabelCenter}>
        <Text preserveColor style={styles.completionShapeLabel}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

function ClockwiseIconReveal({
  progress,
  children,
}: React.PropsWithChildren<{ progress: number }>) {
  const half = COMPLETION_INDICATOR_SIZE / 2;
  const segment = (index: number) =>
    Math.max(0, Math.min(1, progress * 4 - index));
  const top = segment(0);
  const right = segment(1);
  const bottom = segment(2);
  const left = segment(3);
  const pieces = [
    {
      left: half,
      top: 0,
      width: half * top,
      height: half,
      icon: { left: -half, top: 0 },
    },
    {
      left: half,
      top: half,
      width: half,
      height: half * right,
      icon: { left: -half, top: -half },
    },
    {
      left: half - half * bottom,
      top: half,
      width: half * bottom,
      height: half,
      icon: { left: -(half - half * bottom), top: -half },
    },
    {
      left: 0,
      top: half - half * left,
      width: half,
      height: half * left,
      icon: {
        left: 0,
        top: -(half - half * left),
      },
    },
  ];
  return (
    <>
      {pieces.map((piece, index) =>
        piece.width > 0 && piece.height > 0 ? (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.completionReveal,
              {
                left: piece.left,
                top: piece.top,
                width: piece.width,
                height: piece.height,
              },
            ]}
          >
            {React.isValidElement(children)
              ? React.cloneElement(
                  children as React.ReactElement<{ style?: object }>,
                  {
                    style: [
                      (children as React.ReactElement<{ style?: object }>).props
                        .style,
                      piece.icon,
                    ],
                  },
                )
              : children}
          </View>
        ) : null,
      )}
    </>
  );
}

const styles = StyleSheet.create({
  confetti: {
    position: "absolute",
    zIndex: 20,
    top: 35,
    left: 8,
    right: 8,
    height: 120,
    elevation: 50,
  },
  confettiSpecial: { top: 0, left: 0, right: 0, bottom: 0, height: undefined },
  confettiPiece: { position: "absolute", width: 8, height: 14, borderRadius: 3 },
  editActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  editActionButton: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
  },
  rowEditActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  rowEnd: {
    width: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  historyToggle: {
    width: 22,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  editTracker: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayEndOptions: { flexDirection: "row", gap: 7, marginTop: 14 },
  dayEndChoice: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  safe: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: 14, paddingBottom: 10 },
  header: {
    height: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerIdentity: { flex: 1, minWidth: 0, paddingRight: 8 },
  eyebrow: { fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  greeting: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 6,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  hero: { borderRadius: 20, borderWidth: 1, padding: 14, minHeight: 135 },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 11,
  },
  heroEyebrow: {
    color: "rgba(255,255,255,.72)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  heroValue: {
    color: palette.white,
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 35,
    marginTop: 3,
  },
  heroTitle: { color: palette.white, fontSize: 11, fontWeight: "800" },
  completionShape: {
    width: COMPLETION_INDICATOR_SIZE,
    height: COMPLETION_INDICATOR_SIZE,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  completionShapeIcon: {
    position: "absolute",
    left: 0,
    top: 0,
    width: COMPLETION_INDICATOR_SIZE,
    height: COMPLETION_INDICATOR_SIZE,
    lineHeight: COMPLETION_INDICATOR_SIZE,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  completionShapeTrackIcon: {
    textShadowColor: "rgba(255,255,255,.28)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1.15,
  },
  completionReveal: {
    position: "absolute",
    left: 0,
    top: 0,
    height: COMPLETION_INDICATOR_SIZE,
    overflow: "hidden",
  },
  completionShapeLabelCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  completionShapeLabel: {
    color: palette.white,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroProgressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  heroProgressFill: { height: "100%", borderRadius: 999 },
  heroTodoProgressTrack: {
    height: 3,
    marginTop: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,.18)",
  },
  heroTodoProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.72)",
  },
  goalDots: { flexDirection: "row", gap: 4, marginTop: 10, overflow: "hidden" },
  dot: {
    width: 23,
    height: 23,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.2)",
    backgroundColor: "rgba(255,255,255,.14)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dotLiquid: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  dotWave: {
    position: "absolute",
    left: -9,
    top: -2,
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.34)",
  },
  dotIcon: {
    zIndex: 1,
    textShadowColor: "rgba(0,0,0,.42)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  celebration: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sparkles: { fontSize: 18 },
  sectionRow: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionActions: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  sectionVisibility: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { fontSize: 13, fontWeight: "900" },
  hint: { fontSize: 8, fontWeight: "700" },
  filterButton: {
    maxWidth: "100%",
    flexShrink: 1,
    minHeight: 28,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  filterButtonText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 8,
    fontWeight: "900",
  },
  list: { flex: 1, gap: 6 },
  row: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowWithHistory: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  drag: {
    width: 30,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photo: { width: 42, height: 42 },
  rowCopy: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  completionCheck: { width: 15, height: 15 },
  completionCheckGold: { position: "absolute", inset: 0 },
  trackedMarker: {
    width: 18,
    height: 18,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 11, fontWeight: "900" },
  completedText: { textDecorationLine: "line-through", opacity: 0.68 },
  primary: { fontSize: 14, fontWeight: "900", marginTop: 1 },
  secondary: { fontSize: 8, lineHeight: 12, marginTop: 1 },
  progress: { width: 108 },
  fastingProgress: {
    width: 108,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  todayFastingProgressBar: {
    flex: 0,
    width: "100%",
  },
  goalProgressTrack: {
    position: "relative",
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  streakBadgeText: { fontSize: 8, fontWeight: "900" },
  goalProgressFill: { height: "100%", borderRadius: 999 },
  goalProgressLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  bpProgress: { width: 108, gap: 2 },
  bpLabel: { fontSize: 6, fontWeight: "900" },
  submetricProgressRow: {
    minHeight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  submetricProgressBar: { flex: 1 },
  todayHistory: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    paddingTop: 8,
  },
  remove: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: palette.red,
    alignItems: "center",
    justifyContent: "center",
  },
  more: {
    height: 44,
    borderWidth: 1,
    borderRadius: 15,
    marginTop: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moreText: { fontSize: 11, fontWeight: "900" },
  moreRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  moreCount: { fontSize: 8 },
  add: {
    height: 42,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addText: { fontSize: 10, fontWeight: "900" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,15,12,.52)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 30,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#89918C",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 15, fontWeight: "900", marginBottom: 8 },
  sheetRow: {
    height: 54,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  smallIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetName: { flex: 1, fontSize: 11, fontWeight: "900" },
  sheetValue: { fontSize: 10, fontWeight: "800" },
  historyOptionCopy: {
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
    gap: 1,
  },
  historyOptionTitle: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  historyOptionDescription: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "600",
  },
  historyBulkRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  historyBulkButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  historyBulkText: { fontSize: 9, fontWeight: "900" },
  manageFilters: {
    minHeight: 42,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 13,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
});
