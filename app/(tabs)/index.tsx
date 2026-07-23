import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Alert,
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
import { AppText as Text } from "@/src/components/AppText";
import {
  animateReorder,
  useDelayedReorder,
} from "@/src/components/reorderAnimation";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, ProgressBar } from "@/src/components/ui";
import { compactDayDate, dateKey } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import {
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
  weightProgressStats,
  weeklyDeficitBalance,
} from "@/src/domain/metrics";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition } from "@/src/types";
import { isInternalTracker } from "@/src/domain/trackerCatalog";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const GOLD_HERO_FADE_MS = 1300;
const GOLD_TILE_FADE_MS = 950;
const GOLD_TILE_START_DELAY_MS = 1450;
const GOLD_TILE_STAGGER_MS = 1050;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Today() {
  const { state, reorderMetric, setMetricSection, deleteMetric, updateMetric, updateSettings } = useApp();
  const health = useHealthSync();
  const cloud = useCloudSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { height } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showAddTiles, setShowAddTiles] = useState(false);
  const [showDayEnd, setShowDayEnd] = useState(false);
  const today = dateKey();
  const user = state.group.members.find(
    (item) => item.id === state.currentUserId,
  )!;
  const goals = trackedGoalSummary(state, state.currentUserId, today);
  const weekly = weeklyDeficitBalance(state, state.currentUserId, today);
  const visible = useMemo(() => {
    const ordered = state.metrics
        .filter(
          (item) =>
            !isInternalTracker(item) &&
            item.sections.today &&
            item.activeFrom <= today,
        )
        .sort((a, b) => a.order - b.order);
    if (editing) return ordered;
    return ordered.sort((a, b) => {
      const pinOrder = Number(Boolean(b.pinnedTodayAt)) - Number(Boolean(a.pinnedTodayAt));
      if (pinOrder) return pinOrder;
      if (a.pinnedTodayAt && b.pinnedTodayAt)
        return a.pinnedTodayAt.localeCompare(b.pinnedTodayAt);
      const aMet = metricApplicableOnDate(state, a, state.currentUserId, today) && scheduledGoalReached(state, a, state.currentUserId, today);
      const bMet = metricApplicableOnDate(state, b, state.currentUserId, today) && scheduledGoalReached(state, b, state.currentUserId, today);
      return Number(aMet) - Number(bMet) || a.order - b.order;
    });
  }, [editing, state, today]);
  const tileLimit = Math.max(
    3,
    Math.min(8, state.settings.todayTileLimit ?? 5),
  );
  const primary = editing || state.settings.showAllTodayTiles
    ? visible
    : visible.slice(0, tileLimit);
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
  const heroGold = useRef(new Animated.Value(goals.allMet ? 1 : 0)).current;
  const heroCompletionColor = heroGold.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.lime, "#FFD166"],
  });
  useEffect(() => {
    const animation = Animated.timing(heroGold, {
      toValue: goals.allMet ? 1 : 0,
      duration: goals.allMet ? GOLD_HERO_FADE_MS : 260,
      delay: 0,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [goals.allMet, heroGold]);
  const celebration = useRef(new Animated.Value(0)).current;
  const [celebrationSpecial, setCelebrationSpecial] = useState(false);
  const [celebratingGoalIds, setCelebratingGoalIds] = useState<string[]>([]);
  const celebrationStorageKey = `metric-rally-celebrations-v2:${state.currentUserId}:${today}`;
  const goalCelebrationKey = goals.metrics
    .filter((item) => scheduledGoalReached(state, item, state.currentUserId, today))
    .map((item) => item.id)
    .sort()
    .join("|");
  const celebrationSnapshot = useRef({ goalCelebrationKey, allMet: goals.allMet });
  celebrationSnapshot.current = { goalCelebrationKey, allMet: goals.allMet };
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let clearTiles: ReturnType<typeof setTimeout> | undefined;
      AsyncStorage.getItem(celebrationStorageKey)
        .then((saved) => {
          if (cancelled) return;
          const previous = new Set((saved ?? "").split("|").filter(Boolean));
          const completed = celebrationSnapshot.current.goalCelebrationKey
            .split("|")
            .filter(Boolean);
          const newlyCompleted = completed.filter((id) => !previous.has(id));
          if (newlyCompleted.length) {
            const special = celebrationSnapshot.current.allMet;
            const duration = special ? 3800 : 2700;
            setCelebratingGoalIds(newlyCompleted);
            setCelebrationSpecial(special);
            celebration.setValue(0);
            Animated.timing(celebration, {
              toValue: 1,
              duration,
              useNativeDriver: true,
            }).start();
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
        celebration.stopAnimation();
        celebration.setValue(0);
      };
    }, [celebration, celebrationStorageKey]),
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
          setEditing(false);
          return true;
        },
      );
      return () => subscription.remove();
    }, [editing]),
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
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      edges={["top"]}
    >
      <ConfettiBurst progress={celebration} special={celebrationSpecial} />
      <ScrollView
        refreshControl={
          <RefreshControl
            enabled={!editing}
            refreshing={
              !editing &&
              (health.status === "syncing" || cloud.status === "syncing")
            }
            onRefresh={async () => {
              // Save local changes first, refresh shared rows, then import the
              // newest device health records. The health import is persisted by
              // the normal local-first cloud debounce without being overwritten.
              await cloud.syncNow().catch(() => undefined);
              await cloud.refreshGroup().catch(() => undefined);
              await health.syncNow("pull").catch(() => undefined);
            }}
            tintColor={accent}
          />
        }
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: accent }]}>
              {compactDayDate(today)}
            </Text>
            <Text style={[styles.greeting, { color: colors.ink }]}>
              Hi, {memberDisplayName(state, user)}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {editing ? (
              <Pressable
                onPress={() => setEditing(false)}
                style={[styles.done, { backgroundColor: accent }]}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
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
                <HeaderIcon
                  icon="notifications-outline"
                  label="Open notifications"
                  onPress={() => router.navigate("/alerts" as never)}
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
        <View
          style={[
            styles.hero,
            {
              backgroundColor: accent,
              borderColor: accent,
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
                {goals.allMet ? "DAY COMPLETE" : "TODAY'S FOCUS"}
              </Text>
              <Text
                preserveColor
                style={[
                  styles.heroValue,
                  { color: palette.white },
                ]}
              >
                {goals.met} of {goals.total}
              </Text>
              <Text
                preserveColor
                style={[
                  styles.heroTitle,
                  { color: palette.white },
                ]}
              >
                {goals.allMet
                  ? "Every goal reached"
                  : goals.total
                    ? `${goals.total - goals.met} goal${goals.total - goals.met === 1 ? "" : "s"} left`
                    : "Choose your first goal"}
              </Text>
            </View>
            <Animated.View
              style={[
                styles.ring,
                {
                  borderColor: heroCompletionColor,
                  backgroundColor: "transparent",
                },
              ]}
            >
              <Text
                preserveColor
                style={[
                  styles.ringText,
                  { color: palette.white },
                ]}
              >
                {goals.total ? Math.round((goals.met / goals.total) * 100) : 0}%
              </Text>
            </Animated.View>
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
                  width: `${goals.total ? (goals.met / goals.total) * 100 : 0}%`,
                },
              ]}
            />
          </View>
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
              return (
                <GoalCompletionDot
                  key={item.id}
                  icon={item.icon as keyof typeof Ionicons.glyphMap}
                  met={met}
                  unavailable={unavailable}
                  allMet={goals.allMet}
                />
              );
            })}
          </View>
        </View>
        {goals.allMet ? (
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
        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: colors.ink }]}>Your day</Text>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {editing ? "Drag · remove · add" : "Hold any card to edit"}
          </Text>
        </View>
        <View style={styles.list}>
          {primary.map((item, index) => (
            <TrackerRow
              key={item.id}
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
              celebrating={celebratingGoalIds.includes(item.id)}
              onEdit={() => setEditing(true)}
              onMove={(target) => {
                animateReorder();
                reorderMetric(item.id, visible[target]?.order ?? target);
              }}
              onRemove={() => remove(item)}
              onPin={() => updateMetric(item.id, { pinnedTodayAt: item.pinnedTodayAt ? undefined : new Date().toISOString() })}
            />
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
              style={[styles.add, styles.editActionButton, { borderColor: colors.border }]}
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
              style={[styles.add, styles.editActionButton, { borderColor: colors.border }]}
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
              onPress={() => setShowDayEnd(true)}
              style={[styles.add, styles.editActionButton, { borderColor: colors.border }]}
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
        visible={showMore}
        onRequestClose={() => setShowMore(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowMore(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>
              More from today
            </Text>
            {extra.map((item) => (
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
                <Text style={[styles.sheetName, { color: colors.ink }]}>
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
              </Pressable>
            ))}
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
  met,
  unavailable,
  allMet,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  met: boolean;
  unavailable: boolean;
  allMet: boolean;
}) {
  const gold = useRef(new Animated.Value(allMet && met ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(gold, {
      toValue: allMet && met ? 1 : 0,
      duration: allMet ? GOLD_HERO_FADE_MS : 220,
      delay: 0,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [allMet, gold, met]);
  const backgroundColor = met
    ? gold.interpolate({
        inputRange: [0, 1],
        outputRange: [palette.lime, "#FFD166"],
      })
    : "rgba(255,255,255,.16)";
  return (
    <Animated.View style={[styles.dot, { backgroundColor }]}>
      <Ionicons
        name={unavailable ? "remove" : met ? "checkmark" : icon}
        size={11}
        color={met && allMet ? "#654900" : met ? "#214218" : palette.white}
      />
    </Animated.View>
  );
}

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
  celebrating,
  onEdit,
  onMove,
  onRemove,
  onPin,
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
  celebrating: boolean;
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
  onPin: () => void;
}) {
  const dragOrigin = useRef(index);
  const liveTarget = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const onMoveRef = useRef(onMove);
  const lastDragY = useRef(0);
  const dragY = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const arrival = useRef(new Animated.Value(1)).current;
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
      lastDragY.current - (target - dragOrigin.current) * height,
    );
    onMoveRef.current(target);
  });
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
  useEffect(() => {
    if (!editing) {
      cancelReorder();
      wiggle.stopAnimation();
      wiggle.setValue(0);
      dragY.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 130, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 260, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 130, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [cancelReorder, dragY, editing, wiggle]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onStartShouldSetPanResponderCapture: () => editing,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          editing && Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
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
              dragOrigin.current + Math.round(gesture.dy / height),
            ),
          );
          dragY.setValue(
            gesture.dy - (liveTarget.current - dragOrigin.current) * height,
          );
          if (target !== liveTarget.current) scheduleReorder(target);
          else cancelReorder();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          flushReorder();
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
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
      height,
      scheduleReorder,
    ],
  );
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
  const cardComplete =
    item.id === "weekly_deficit_balance" ? weeklyBalanceAhead : met;
  const gold = useRef(
    new Animated.Value(allGoalsMet && trackedGoal && met ? 1 : 0),
  ).current;
  useEffect(() => {
    const becomesGold = allGoalsMet && trackedGoal && met;
    const animation = Animated.timing(gold, {
      toValue: becomesGold ? 1 : 0,
      duration: becomesGold ? GOLD_TILE_FADE_MS : 220,
      delay: becomesGold
        ? GOLD_TILE_START_DELAY_MS +
          Math.max(0, goalSequenceIndex) * GOLD_TILE_STAGGER_MS
        : 0,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [allGoalsMet, goalSequenceIndex, gold, met, trackedGoal]);
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
  const diastolic =
    item.id === "blood_pressure_systolic" ||
    (item.healthMapping?.dataType === "blood_pressure" && item.healthMapping.field === "systolic")
      ? state.metrics.find((candidate) => candidate.id === "blood_pressure_diastolic" || (candidate.healthMapping?.dataType === "blood_pressure" && candidate.healthMapping.field === "diastolic"))
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
  const content = trackerCopy(
    state,
    item,
    day,
    value,
    target,
    applicable,
    weekly,
  );
  return (
    <Animated.View style={{
      transform: [
        {
          translateY: Animated.add(
            dragY,
            arrival.interpolate({
              inputRange: [0, 1],
              outputRange: [-34, 0],
            }),
          ),
        },
        {
          scale: arrival.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
        { rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ["-0.35deg", "0.35deg"] }) },
      ],
      zIndex: editing ? 4 : 0,
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
        <View {...responder.panHandlers} style={styles.drag}>
          <Ionicons
            name="reorder-three-outline"
            size={24}
            color={colors.faint}
          />
        </View>
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
                  : item.goal.kind === "at_most" && value > target
                  ? palette.red
                  : colors.ink,
            },
          ]}
          numberOfLines={1}
        >
          {content.primary}
        </Text>
        <Text
          style={[styles.secondary, { color: colors.muted }]}
          numberOfLines={1}
        >
          {content.secondary}
        </Text>
      </View>
      {item.goalEnabled !== false && applicable ? (
        <View style={diastolic ? styles.bpProgress : styles.progress}>
          {diastolic ? <Text style={[styles.bpLabel, { color: colors.muted }]}>SYS</Text> : null}
          {trackedGoal && met ? (
            <GoalProgressBar
              progress={todayProgress(state, item, value, target)}
              transition={gold}
              trackColor={colors.border}
            />
          ) : (
            <ProgressBar
              progress={todayProgress(state, item, value, target)}
              color={todayProgressColor(state, item, value, target, met)}
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
          <Pressable onPress={onRemove} hitSlop={10} style={styles.remove}>
            <Ionicons name="remove" size={17} color={palette.white} />
          </Pressable>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      )}
    </AnimatedPressable>
    </Animated.View>
  );
}

function GoalProgressBar({
  progress,
  transition,
  trackColor,
}: {
  progress: number;
  transition: Animated.Value;
  trackColor: string;
}) {
  const color = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.lime, "#FFD166"],
  });
  return (
    <View style={[styles.goalProgressTrack, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.goalProgressFill,
          {
            backgroundColor: color,
            width: `${Math.min(1, Math.max(0, progress)) * 100}%`,
          },
        ]}
      />
    </View>
  );
}

function todayProgress(
  state: ReturnType<typeof useApp>["state"],
  item: MetricDefinition,
  value: number,
  target: number,
) {
  const direction = state.settings.weightDirection ?? "lose";
  if (item.goal.kind === "at_most") {
    if (item.id === "food" && direction === "gain") return value < target ? value / Math.max(target, 1) : 1;
    return Math.min(1, Math.abs(target - value) / Math.max(target, 1));
  }
  if (item.id === "deficit") {
    if (direction === "gain") return value < target ? value / Math.max(target, 1) : 1;
    return Math.min(1, Math.abs(value - target) / Math.max(target, 1));
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
    return value >= target ? palette.lime : palette.red;
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
) {
  if (!applicable)
    return {
      primary: "Not available yet",
      secondary: "Log food to calculate today’s energy balance",
    };
  if (item.id === "weekly_deficit_balance")
    return {
      primary: `${Math.abs(Math.round(weekly.balance)).toLocaleString()} kcal ${weekly.balance >= 0 ? "ahead" : "behind"}`,
      secondary: `${weekly.days} logged day${weekly.days === 1 ? "" : "s"} count this week`,
    };
  if (item.id === "food") {
    const left = target - value;
    return {
      primary:
        left >= 0
          ? `${Math.round(left).toLocaleString()} kcal left`
          : `${Math.abs(Math.round(left)).toLocaleString()} kcal over`,
      secondary: `${Math.round(value).toLocaleString()} consumed · allowance ${Math.round(target).toLocaleString()}`,
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
  eyebrow: { fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  greeting: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginTop: 1,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  ring: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 5,
    borderColor: palette.lime,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { color: palette.white, fontSize: 12, fontWeight: "900" },
  heroProgressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  heroProgressFill: { height: "100%", borderRadius: 999 },
  goalDots: { flexDirection: "row", gap: 4, marginTop: 10, overflow: "hidden" },
  dot: {
    width: 23,
    height: 23,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
  section: { fontSize: 13, fontWeight: "900" },
  hint: { fontSize: 8, fontWeight: "700" },
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
  progress: { width: 48 },
  goalProgressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  goalProgressFill: { height: "100%", borderRadius: 999 },
  bpProgress: { width: 55, gap: 2 },
  bpLabel: { fontSize: 6, fontWeight: "900" },
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
});
