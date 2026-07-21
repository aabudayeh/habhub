import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, ProgressBar } from "@/src/components/ui";
import { compactDayDate, dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import {
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  isMetricTrackedOnDate,
  safeMetricValue,
  trackedGoalSummary,
  weightProgressStats,
  weeklyDeficitBalance,
} from "@/src/domain/metrics";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition } from "@/src/types";

export default function Today() {
  const { state, reorderMetric, setMetricSection, deleteMetric } = useApp();
  const health = useHealthSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { height } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showAddTiles, setShowAddTiles] = useState(false);
  const today = dateKey();
  const user = state.group.members.find(
    (item) => item.id === state.currentUserId,
  )!;
  const goals = trackedGoalSummary(state, state.currentUserId, today);
  const weekly = weeklyDeficitBalance(state, state.currentUserId, today);
  const visible = useMemo(
    () =>
      state.metrics
        .filter((item) => item.sections.today && item.activeFrom <= today)
        .sort((a, b) => a.order - b.order),
    [state.metrics, today],
  );
  const tileLimit = Math.max(
    3,
    Math.min(8, state.settings.todayTileLimit ?? 5),
  );
  const primary = state.settings.showAllTodayTiles
    ? visible
    : visible.slice(0, tileLimit);
  const extra = state.settings.showAllTodayTiles
    ? []
    : visible.slice(tileLimit);
  const hiddenTracked = state.metrics
    .filter(
      (metric) =>
        !metric.sections.today && isMetricTrackedOnDate(state, metric, today),
    )
    .sort((a, b) => a.order - b.order);
  const weekAll = Array.from(
    { length: 7 },
    (_, i) =>
      trackedGoalSummary(
        state,
        state.currentUserId,
        dateWithOffsetFrom(today, -i),
      ).allMet,
  ).every(Boolean);
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
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={health.status === "syncing"}
            onRefresh={() => health.syncNow("pull").catch(() => undefined)}
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
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={[styles.heroEyebrow, { color: accent }]}>
                {goals.allMet ? "DAY COMPLETE" : "TODAY'S FOCUS"}
              </Text>
              <Text style={[styles.heroValue, { color: colors.ink }]}>
                {goals.met} of {goals.total}
              </Text>
              <Text style={[styles.heroTitle, { color: colors.muted }]}>
                {goals.allMet
                  ? "Every goal reached"
                  : goals.total
                    ? `${goals.total - goals.met} goal${goals.total - goals.met === 1 ? "" : "s"} left`
                    : "Choose your first goal"}
              </Text>
            </View>
            <View
              style={[
                styles.ring,
                { borderColor: accent, backgroundColor: colors.primarySoft },
              ]}
            >
              <Text style={[styles.ringText, { color: accent }]}>
                {goals.total ? Math.round((goals.met / goals.total) * 100) : 0}%
              </Text>
            </View>
          </View>
          <ProgressBar
            progress={goals.total ? goals.met / goals.total : 0}
            color={accent}
          />
          <View style={styles.goalDots}>
            {goals.metrics.map((item) => {
              const unavailable = goals.unavailable.some(
                (metric) => metric.id === item.id,
              );
              const met = goalReached(
                item,
                safeMetricValue(state, item, state.currentUserId, today),
                effectiveGoalTarget(state, item, state.currentUserId, today),
              );
              return (
                <View
                  key={item.id}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: met ? accent : colors.canvas,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      unavailable
                        ? "remove"
                        : met
                          ? "checkmark"
                          : (item.icon as keyof typeof Ionicons.glyphMap)
                    }
                    size={11}
                    color={met ? palette.white : colors.faint}
                  />
                </View>
              );
            })}
          </View>
        </View>
        {goals.allMet ? (
          <Celebration
            title={weekAll ? "Perfect week" : "Today complete"}
            copy={
              weekAll
                ? "Seven days of showing up. A special badge is yours."
                : "Nice work. Your daily completion badge is ready."
            }
            special={weekAll}
            colors={colors}
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
              onEdit={() => setEditing(true)}
              onMove={(target) => reorderMetric(item.id, target)}
              onRemove={() => remove(item)}
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
              style={[styles.add, { borderColor: accent }]}
            >
              <Ionicons name="add" size={19} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>
                Add existing goal tile
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.navigate("/customize?tab=goals" as never)}
              style={[styles.add, { borderColor: colors.border }]}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={18}
                color={accent}
              />
              <Text style={[styles.addText, { color: accent }]}>
                Edit tracked goals
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
                <Text style={[styles.sheetValue, { color: colors.muted }]}>
                  {displayValue(state, item, today, weekly)}
                </Text>
              </Pressable>
            ))}
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
              Add a tracked goal
            </Text>
            {hiddenTracked.length ? (
              hiddenTracked.map((item) => (
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
                Every tracked goal already has a Today tile.
              </Text>
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
  onEdit,
  onMove,
  onRemove,
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
  onEdit: () => void;
  onMove: (target: number) => void;
  onRemove: () => void;
}) {
  const start = useRef(index);
  start.current = index;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        onPanResponderRelease: (_event, gesture) =>
          onMove(
            Math.max(
              0,
              Math.min(
                count - 1,
                start.current + Math.round(gesture.dy / height),
              ),
            ),
          ),
      }),
    [count, editing, height, onMove],
  );
  const value =
    item.id === "weekly_deficit_balance"
      ? weekly.balance
      : safeMetricValue(state, item, state.currentUserId, day);
  const applicable =
    item.id !== "deficit" ||
    state.entries.some(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === "food" &&
        entry.localDate === day,
    );
  const target = effectiveGoalTarget(state, item, state.currentUserId, day);
  const met = applicable && goalReached(item, value, target);
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
    <Pressable
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
          backgroundColor: colors.card,
          borderColor: editing ? `${accent}66` : colors.border,
        },
      ]}
    >
      {editing ? (
        <Pressable {...responder.panHandlers} style={styles.drag}>
          <Ionicons
            name="reorder-three-outline"
            size={24}
            color={colors.faint}
          />
        </Pressable>
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
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
            {item.name}
          </Text>
          {met ? (
            <Ionicons name="checkmark-circle" size={15} color={accent} />
          ) : null}
        </View>
        <Text
          style={[
            styles.primary,
            {
              color:
                item.goal.kind === "at_most" && value > target
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
        <View style={styles.progress}>
          <ProgressBar
            progress={goalProgress(item, value, target)}
            color={item.color}
          />
        </View>
      ) : null}
      {editing ? (
        <Pressable onPress={onRemove} hitSlop={10} style={styles.remove}>
          <Ionicons name="remove" size={17} color={palette.white} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      )}
    </Pressable>
  );
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
}: {
  title: string;
  copy: string;
  special?: boolean;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View
      style={[
        styles.celebration,
        {
          backgroundColor: special ? "#FFF2C9" : colors.card,
          borderColor: special ? "#E4B84A" : colors.border,
        },
      ]}
    >
      <Text style={styles.sparkles}>{special ? "✦ ✨ ✦" : "✦"}</Text>
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
    </View>
  );
}
const styles = StyleSheet.create({
  editActions: { gap: 6 },
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
  name: { fontSize: 11, fontWeight: "900" },
  primary: { fontSize: 14, fontWeight: "900", marginTop: 1 },
  secondary: { fontSize: 8, lineHeight: 12, marginTop: 1 },
  progress: { width: 48 },
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
