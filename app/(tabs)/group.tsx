import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { shareText } from "@/src/lib/shareText";
import { ReorderItem } from "@/src/components/ReorderItem";
import { useEditWiggle } from "@/src/components/useEditWiggle";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  adjacentPeriod,
  DateRangeNavigator,
  PeriodChoiceBar,
} from "@/src/components/PeriodNavigator";
import {
  Avatar,
  Card,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import {
  dateKey,
  dateKeyWithOffset,
  relativeTime,
} from "@/src/domain/date";
import {
  groupInviteMessage,
  validGroupInviteCode,
} from "@/src/domain/invites";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";
import {
  LeaderboardPeriod,
  allTimePeriodDates,
  leaderboardRows,
  periodAverageGoalReached,
  periodDates,
  periodTitle,
  shiftedPeriodAnchor,
} from "@/src/domain/leaderboard";
import { leaderboardSyncTimestamp } from "@/src/domain/leaderboardSync";
import { memberDisplayName, memberOriginalLabel } from "@/src/domain/members";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { Visibility } from "@/src/types";

const SCORE_ID = "__score";
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function LeaderboardScreen() {
  const { state, updateMetric, updateSettings } = useApp();
  const cloud = useCloudSyncActions();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const [dateNavigatorOpen, setDateNavigatorOpen] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [, setClockTick] = useState(0);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const rankingStateRef = useRef(state);
  rankingStateRef.current = state;
  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!editing) {
      setDraggingCardId(null);
    }
  }, [editing]);
  useEffect(() => {
    setCloudSyncPaused("leaderboard-edit", editing);
    return () => setCloudSyncPaused("leaderboard-edit", false);
  }, [editing]);
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManageGroup =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const personalSetup = isPersonalSetupGroup(state.group);
  const inviteReady = validGroupInviteCode(state.group.inviteCode);
  const tracked = useMemo(
    () =>
      (state.group.metricConfiguration ?? []).filter(
        (metric) =>
          metric.dataType !== "text" &&
          metric.dataType !== "photo" &&
          metric.sections.group,
      ),
    [state.group.metricConfiguration],
  );
  const saved = state.settings.leaderboardMetricIdsByGroup?.[
    state.group.id
  ] ?? [state.selectedGroupMetricId || SCORE_ID];
  const validSaved = saved.filter(
    (id) => id === SCORE_ID || tracked.some((metric) => metric.id === id),
  );
  const initialSelected =
    validSaved.length >= 2
      ? validSaved
      : ([
          ...validSaved,
          tracked.find((metric) => !validSaved.includes(metric.id))?.id,
        ].filter(Boolean) as string[]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelected);
  const selected = useMemo(
    () => (selectedIds.length ? selectedIds : [SCORE_ID]),
    [selectedIds],
  );
  const pinnedIds = useMemo(
    () =>
      state.settings.leaderboardPinnedMetricIdsByGroup?.[state.group.id] ?? [],
    [state.group.id, state.settings.leaderboardPinnedMetricIdsByGroup],
  );
  const displayedSelected = useMemo(() => {
    if (editing) return selected;
    const pinOrder = new Map(pinnedIds.map((id, index) => [id, index]));
    return [...selected].sort((left, right) => {
      const leftPin = pinOrder.get(left);
      const rightPin = pinOrder.get(right);
      if (leftPin !== undefined || rightPin !== undefined)
        return leftPin === undefined
          ? 1
          : rightPin === undefined
            ? -1
            : leftPin - rightPin;
      return selected.indexOf(left) - selected.indexOf(right);
    });
  }, [editing, pinnedIds, selected]);
  const weekStartsOn = state.settings.weekStartsOn ?? 1;
  const allTimeInputs = useMemo(
    () => ({
      statuses: state.dailyMetricStatuses,
      entries: state.entries,
      groupId: state.group.id,
      gymSessions: state.gymSessions,
    }),
    [
      state.dailyMetricStatuses,
      state.entries,
      state.group.id,
      state.gymSessions,
    ],
  );
  const dates = useMemo(
    () => {
      void allTimeInputs;
      return period === "overall"
        ? allTimePeriodDates(
            rankingStateRef.current,
            anchor,
            selected.includes(SCORE_ID)
              ? tracked.map((metric) => metric.id)
              : selected,
          )
        : periodDates(period, anchor, weekStartsOn);
    },
    [
      allTimeInputs,
      anchor,
      period,
      selected,
      tracked,
      weekStartsOn,
    ],
  );
  const rankingInputs = useMemo(
    () => ({
      statuses: state.dailyMetricStatuses,
      energyProfiles: state.energyProfiles,
      entries: state.entries,
      groupId: state.group.id,
      groupMembers: state.group.members,
      groupMetrics: state.group.metricConfiguration,
      groupRestDays: state.group.streakRestDaysPerWeek,
      gymSessions: state.gymSessions,
      metrics: state.metrics,
      photos: state.photos,
      todos: state.todos,
      trackedGoalPeriods: state.trackedGoalPeriods,
      currentUserId: state.currentUserId,
      baselineCalories: state.settings.baselineCalories,
      dayEndTime: state.settings.dayEndTime,
      energyProfile: state.settings.energyProfile,
      foodGoalMode: state.settings.foodGoalMode,
      personalRestDays: state.settings.streakRestDaysPerWeek,
      vacationPeriods: state.settings.vacationPeriods,
      weightDirection: state.settings.weightDirection,
    }),
    [
      state.dailyMetricStatuses,
      state.energyProfiles,
      state.entries,
      state.group.id,
      state.group.members,
      state.group.metricConfiguration,
      state.group.streakRestDaysPerWeek,
      state.gymSessions,
      state.metrics,
      state.photos,
      state.todos,
      state.trackedGoalPeriods,
      state.currentUserId,
      state.settings.baselineCalories,
      state.settings.dayEndTime,
      state.settings.energyProfile,
      state.settings.foodGoalMode,
      state.settings.streakRestDaysPerWeek,
      state.settings.vacationPeriods,
      state.settings.weightDirection,
    ],
  );
  const rankingRows = useMemo(() => {
    void rankingInputs;
    const rows = new Map<string, ReturnType<typeof leaderboardRows>>();
    for (const id of selected) {
      const metric = tracked.find((item) => item.id === id);
      rows.set(
        id,
        leaderboardRows(
          rankingStateRef.current,
          metric ? [metric] : [],
          dates,
          rankingStateRef.current.currentUserId,
          id === SCORE_ID,
        ),
      );
    }
    return rows;
  }, [
    dates,
    selected,
    rankingInputs,
    tracked,
  ]);
  function choosePeriod(next: LeaderboardPeriod) {
    setPeriod(next);
    if (
      next === "today" ||
      next === "week" ||
      next === "month" ||
      next === "year" ||
      next === "overall"
    )
      setAnchor(dateKey());
    if (next === "yesterday") setAnchor(dateKeyWithOffset(-1));
    setCalendarOpen(false);
  }
  function toggleDateNavigator() {
    if (dateNavigatorOpen) setCalendarOpen(false);
    setDateNavigatorOpen((open) => !open);
  }
  function shiftRange(direction: -1 | 1) {
    const next = shiftedPeriodAnchor(period, anchor, direction);
    if (!next) return;
    if (period === "today" || period === "yesterday") setPeriod("custom");
    setAnchor(next);
  }
  const pageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !editing &&
          !calendarOpen &&
          Math.abs(gesture.dx) > 22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const direction = gesture.dx < 0 ? 1 : -1;
          const next = adjacentPeriod(period, direction);
          if (next) choosePeriod(next);
        },
      }),
    [calendarOpen, editing, period],
  );
  async function invite() {
    if (personalSetup) return;
    if (!inviteReady) {
      await cloud.refreshGroup().catch(() => undefined);
      Alert.alert(
        "Invite is still preparing",
        "The group was refreshed. Try sharing again in a moment.",
      );
      return;
    }
    try {
      const result = await shareText(
        groupInviteMessage(state.group.name, state.group.inviteCode),
        `Join ${state.group.name} on HabHub`,
      );
      if (result === "copied")
        Alert.alert("Invite copied", "The invite link is ready to paste.");
    } catch (error) {
      Alert.alert(
        "Could not share invite",
        error instanceof Error ? error.message : "Copy the group code instead.",
      );
    }
  }
  function chooseVisibility(metricId: string, metricName: string) {
    Alert.alert(`${metricName} visibility`, "What can this group see?", [
      {
        text: "Exact values",
        onPress: () =>
          updateMetric(metricId, { defaultVisibility: "group" }),
      },
      {
        text: "Goal status only",
        onPress: () =>
          updateMetric(metricId, { defaultVisibility: "status" }),
      },
      {
        text: "Private",
        onPress: () =>
          updateMetric(metricId, { defaultVisibility: "private" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }
  function saveSelection(ids: string[]) {
    const next = ids.length ? ids : [SCORE_ID];
    setSelectedIds(next);
    updateSettings({
      leaderboardMetricIdsByGroup: {
        ...state.settings.leaderboardMetricIdsByGroup,
        [state.group.id]: next,
      },
      leaderboardPinnedMetricIdsByGroup: {
        ...(state.settings.leaderboardPinnedMetricIdsByGroup ?? {}),
        [state.group.id]: pinnedIds.filter((id) => next.includes(id)),
      },
    });
  }
  function togglePin(id: string) {
    updateSettings({
      leaderboardPinnedMetricIdsByGroup: {
        ...(state.settings.leaderboardPinnedMetricIdsByGroup ?? {}),
        [state.group.id]: pinnedIds.includes(id)
          ? pinnedIds.filter((candidate) => candidate !== id)
          : [...pinnedIds, id],
      },
    });
  }
  function move(id: string, target: number) {
    const next = [...selected];
    const index = next.indexOf(id);
    if (index < 0) return;
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(target, next.length)), 0, item);
    saveSelection(next);
  }
  const options = [
    {
      id: SCORE_ID,
      label: "Overall score",
      icon: "speedometer-outline" as const,
      color: palette.purple,
      sublabel: "Calculated from this group's scoring rules",
    },
    ...tracked.map((metric) => ({
      id: metric.id,
      label: metric.name,
      icon: metric.icon as keyof typeof Ionicons.glyphMap,
      color: metric.color,
      sublabel: "Allowed in Group settings",
    })),
  ];
  const hiddenOptions = options.filter((item) => !selected.includes(item.id));
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!editing) return false;
        setEditing(false);
        setShowPicker(false);
        return true;
      });
      return () => {
        subscription.remove();
      };
    }, [editing]),
  );
  return (
    <Screen
      contentContainerStyle={{ paddingBottom: 14 }}
      refreshEnabled={!editing}
    >
      <PageHeader
        title="Leaderboard"
        tutorialId="leaderboard-header"
        action={
          editing ? (
            <View style={styles.headerActions}>
            {canManageGroup ? (
              <IconButton
                icon="settings-outline"
                label="Group settings"
                onPress={() => router.navigate("/group-settings" as never)}
              />
            ) : null}
            <Pressable
              onPress={() => {
                setEditing(false);
                setShowPicker(false);
              }}
              style={[styles.done, { backgroundColor: accent }]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
            </View>
          ) : (
            <View style={styles.headerActions}>
              <IconButton
                icon="sparkles-outline"
                label="Group recap"
                onPress={() =>
                  router.navigate("/recap?scope=group" as never)
                }
              />
              <View>
                <IconButton
                  icon="notifications-outline"
                  label="Group notifications"
                  onPress={() =>
                    router.navigate("/alerts?scope=group" as never)
                  }
                />
                {(state.group.pendingMembers?.length ?? 0) > 0 ? (
                  <View style={styles.pendingDot}>
                    <Text style={styles.pendingDotText}>
                      {Math.min(9, state.group.pendingMembers?.length ?? 0)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )
        }
      />
      <View {...pageSwipeResponder.panHandlers}>
        <PeriodChoiceBar
          period={period}
          onChange={choosePeriod}
          dateViewOpen={dateNavigatorOpen}
          onToggleDateView={toggleDateNavigator}
        />
        {period !== "overall" && dateNavigatorOpen ? (
          <DateRangeNavigator
            period={period}
            anchor={anchor}
            dates={dates}
            calendarOpen={calendarOpen}
            onToggleCalendar={() => setCalendarOpen((value) => !value)}
            onShift={shiftRange}
          >
            <MonthCalendar
              monthDate={anchor}
              selectedDate={anchor}
              onSelect={(date) => {
                setAnchor(date);
                setPeriod("custom");
                setCalendarOpen(false);
              }}
              onMonthChange={setAnchor}
            />
          </DateRangeNavigator>
        ) : null}
      {displayedSelected.map((id, cardIndex) => {
        const metric = tracked.find((item) => item.id === id);
        const includeScore = id === SCORE_ID;
        const rows = rankingRows.get(id) ?? [];
        return (
          <ReorderItem
            key={id}
            active={draggingCardId === id}
          >
            <EditableRankingCard
              editing={editing}
              index={cardIndex}
              count={displayedSelected.length}
              colors={colors}
              onMove={(target) => move(id, target)}
              onRemove={() => saveSelection(selected.filter((item) => item !== id))}
              pinned={pinnedIds.includes(id)}
              onPin={() => togglePin(id)}
              visibility={
                id === SCORE_ID
                  ? undefined
                  : state.metrics.find((item) => item.id === id)
                      ?.defaultVisibility
              }
              onVisibilityPress={
                id === SCORE_ID || !metric
                  ? undefined
                  : () => chooseVisibility(metric.id, metric.name)
              }
              onDragStart={(step) => {
                setDraggingCardId(id);
              }}
              onDragHover={() => {}}
              onDragCancel={() => setDraggingCardId(null)}
              onDragEnd={() => {
                setDraggingCardId(null);
              }}
            >
            <Card style={styles.ranking}>
            <Pressable
              onLongPress={() => setEditing(true)}
              onPress={() =>
                editing ? undefined : router.navigate({
                  pathname: "/leaderboard-detail",
                  params: { period, anchor, metrics: id },
                } as never)
              }
              style={styles.rankingHead}
            >
              <View>
                <Text style={[styles.eyebrow, { color: accent }]}>
                  {periodTitle(period, anchor).toUpperCase()}
                </Text>
                <Text style={[styles.title, { color: colors.ink }]}>
                  {includeScore ? "Overall score" : metric?.name}
                </Text>
              </View>
              <View style={styles.rankingHeadAction}>
              {pinnedIds.includes(id) && !editing ? (
                <Ionicons name="pin" size={13} color={palette.amber} />
              ) : null}
              {includeScore ? (
                <Text
                  style={[
                    styles.max,
                    { color: accent, backgroundColor: colors.primarySoft },
                  ]}
                >
                  MAX 100
                </Text>
              ) : (
                <Ionicons name="expand-outline" size={20} color={accent} />
              )}
              </View>
            </Pressable>
            {false ? (
              <View style={[styles.loadingRankings, { borderTopColor: colors.border }]}>
                <Text style={[styles.detail, { color: colors.muted }]}>
                  Loading saved rankings…
                </Text>
              </View>
            ) : null}
            {rows.slice(0, 4).map((row, index) => {
              const result = row.metrics[0]?.result;
              const value = includeScore
                ? `${Math.round(row.score)} pts`
                : (result?.label ?? "No data");
              const resultColor =
                !includeScore &&
                result &&
                result.mode !== "private" &&
                result.visibleDays > 0
                  ? periodAverageGoalReached(result)
                    ? palette.lime
                    : palette.red
                  : row.member.color;
              const syncTimestamp = leaderboardSyncTimestamp(result);
              const canShowStreak =
                !includeScore &&
                result &&
                result.label !== "Private" &&
                result.mode !== "private" &&
                result.visibleDays > 0;
              const rangeSummary =
                !includeScore && dates.length > 1
                  ? result?.averageLabel
                  : undefined;
              return (
                <View
                  key={row.member.id}
                  style={[
                    styles.row,
                    { borderTopColor: colors.border },
                    row.member.id === state.currentUserId && {
                      backgroundColor: colors.primarySoft,
                      borderRadius: 14,
                      borderTopColor: "transparent",
                    },
                  ]}
                >
                  <Pressable
                    disabled={editing}
                    onPress={() =>
                      router.navigate({
                        pathname: "/member/[id]",
                        params: {
                          id: row.member.id,
                          period,
                          anchor,
                          metrics: id,
                        },
                      } as never)
                    }
                    style={styles.memberLink}
                  >
                  <Text
                    style={[
                      styles.rank,
                      { color: colors.faint },
                      index < 3 && styles.podium,
                    ]}
                  >
                    #{index + 1}
                  </Text>
                  <Avatar
                    initials={row.member.initials}
                    color={row.member.color}
                    uri={row.member.avatarUri}
                    size={31}
                  />
                  <View style={styles.copy}>
                    <Text style={[styles.name, { color: colors.ink }]}>
                      {memberDisplayName(state, row.member)}
                      {row.member.id === state.currentUserId ? " · You" : ""}
                    </Text>
                    {memberOriginalLabel(state, row.member) ? (
                      <Text style={[styles.original, { color: colors.faint }]}>
                        {memberOriginalLabel(state, row.member)}
                      </Text>
                    ) : null}
                    {includeScore ? (
                      <Text style={[styles.detail, { color: colors.muted }]}>
                        Group-weighted score
                      </Text>
                    ) : canShowStreak ? (
                      <View style={styles.streakBlock}>
                        <View style={styles.detailLine}>
                          <Ionicons
                            name="flame"
                            size={12}
                            color={metric?.color ?? accent}
                          />
                          <Text
                            style={[styles.streakText, { color: colors.muted }]}
                          >
                            {result.streak ?? 0}d · Best{" "}
                            {result.bestStreak ?? 0}d
                          </Text>
                        </View>
                        {syncTimestamp ? (
                          <Text
                            style={[styles.syncDetail, { color: colors.muted }]}
                          >
                            Synced {relativeTime(syncTimestamp)}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.detail,
                          { color: colors.muted },
                          result?.mode === "private" && styles.private,
                        ]}
                      >
                        {syncTimestamp
                          ? `Synced ${relativeTime(syncTimestamp)}`
                          : result?.label === "Private"
                            ? "Private"
                            : "No data"}
                      </Text>
                    )}
                  </View>
                  </Pressable>
                  <Pressable
                    disabled={editing}
                    onPress={() => {
                      router.navigate({
                        pathname: "/leaderboard-detail",
                        params: { period, anchor, metrics: id },
                      } as never);
                    }}
                    style={styles.metricLink}
                  >
                    <View style={styles.bar}>
                      <Text style={[styles.score, { color: colors.ink }]}>
                        {value}
                      </Text>
                      <ProgressBar
                        progress={
                          includeScore
                            ? row.score / 100
                            : (result?.averageDisplayProgress ??
                              row.score / 100)
                        }
                        color={resultColor}
                        layered={
                          !includeScore &&
                          result?.personalGoalKind === "at_least"
                        }
                      />
                      {rangeSummary ? (
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                          style={[styles.rangeSummary, { color: colors.muted }]}
                        >
                          {rangeSummary}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={15}
                      color={colors.faint}
                    />
                  </Pressable>
                </View>
              );
            })}
            </Card>
            </EditableRankingCard>
          </ReorderItem>
        );
      })}
      {editing ? (
        <>
          <View style={styles.editActions}>
            <Pressable
              onPress={() => setShowPicker((value) => !value)}
              style={[styles.addExisting, styles.editAction, { borderColor: accent }]}
            >
              <Ionicons name="add" size={18} color={accent} />
              <Text style={[styles.addExistingText, { color: accent }]}>Add existing tracker</Text>
            </Pressable>
            {canManageGroup ? (
              <Pressable
                onPress={() =>
                  router.navigate({
                    pathname: "/metric-editor",
                    params: { id: "new", scope: "group" },
                  })
                }
                style={[
                  styles.addExisting,
                  styles.editAction,
                  { borderColor: accent },
                ]}
              >
                <Ionicons name="create-outline" size={17} color={accent} />
                <Text style={[styles.addExistingText, { color: accent }]}>
                  Create tracker
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.editGroupActions}>
            <Pressable
              onPress={() => router.navigate("/groups" as never)}
              style={[styles.editGroupAction, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="swap-horizontal" size={17} color={accent} />
              <Text style={[styles.link, { color: accent }]}>Manage groups</Text>
            </Pressable>
            {!personalSetup ? (
              <Pressable
                onPress={invite}
                style={[styles.editGroupAction, { backgroundColor: colors.primarySoft }]}
              >
                <Ionicons name="person-add-outline" size={17} color={accent} />
                <Text style={[styles.link, { color: accent }]}>Invite</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <Pressable onPress={() => setEditing(true)} style={styles.editHint}>
          <Text style={[styles.hint, { color: colors.muted }]}>Hold a ranking card to edit what Leaderboard shows</Text>
        </Pressable>
      )}
      {!editing ? <View style={styles.actions}>
        <Pressable
          onPress={() => router.navigate("/groups" as never)}
          style={styles.inline}
        >
          <Ionicons name="swap-horizontal" size={17} color={accent} />
          <Text style={[styles.link, { color: accent }]}>Manage groups</Text>
        </Pressable>
        {!personalSetup ? (
          <Pressable onPress={invite} style={styles.inline}>
            <Ionicons name="person-add-outline" size={17} color={accent} />
            <Text style={[styles.link, { color: accent }]}>Invite</Text>
          </Pressable>
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.groupSummary, { color: colors.faint }]}
        >
          {personalSetup
            ? `${state.group.name} · private`
            : `${state.group.name} · ${state.group.members.length} friends`}
        </Text>
      </View> : null}
      <AddTrackerModal
        visible={showPicker}
        items={hiddenOptions}
        onClose={() => setShowPicker(false)}
        onAdd={(id) => {
          saveSelection([...selected, id]);
          setShowPicker(false);
        }}
      />
      </View>
    </Screen>
  );
}

function EditableRankingCard({
  children,
  editing,
  index,
  count,
  colors,
  onMove,
  onRemove,
  pinned,
  onPin,
  visibility,
  onVisibilityPress,
  onDragStart,
  onDragHover,
  onDragCancel,
  onDragEnd,
}: {
  children: ReactNode;
  editing: boolean;
  index: number;
  count: number;
  colors: ReturnType<typeof useAppColors>;
  onMove: (target: number) => void;
  onRemove: () => void;
  pinned: boolean;
  onPin: () => void;
  visibility?: Visibility;
  onVisibilityPress?: () => void;
  onDragStart: (step: number) => void;
  onDragHover: (target: number) => void;
  onDragCancel: () => void;
  onDragEnd: () => void;
}) {
  const dragStep = useRef(240);
  const smoothDrag = useSmoothReorderGesture({
    enabled: editing,
    index,
    count,
    initialStep: dragStep.current,
    onMove,
    onStart: () => onDragStart(dragStep.current),
    onTargetChange: onDragHover,
    onCancel: onDragCancel,
    onEnd: onDragEnd,
  });
  const wiggle = useEditWiggle(editing && !smoothDrag.dragging);
  return (
    <Reanimated.View
      onLayout={(event) => {
        dragStep.current = event.nativeEvent.layout.height + 6;
        smoothDrag.setStep(dragStep.current);
      }}
      style={[
        styles.rankingWrap,
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
      {editing ? (
        <View style={[styles.editBar, { borderColor: colors.border }]}>
          <GestureDetector gesture={smoothDrag.gesture}>
          <View collapsable={false} style={styles.drag}>
            <Ionicons name="reorder-three-outline" size={24} color={colors.faint} />
          </View>
          </GestureDetector>
          <Text style={[styles.dragText, { color: colors.muted }]}>Drag to reorder</Text>
          <Pressable
            accessibilityLabel={pinned ? "Unpin ranking" : "Pin ranking"}
            onPress={onPin}
            style={styles.pinAction}
            hitSlop={6}
          >
            <Ionicons
              name={pinned ? "pin" : "pin-outline"}
              size={15}
              color={pinned ? palette.amber : colors.muted}
            />
          </Pressable>
          {visibility && onVisibilityPress ? (
            <Pressable
              onPress={onVisibilityPress}
              style={styles.visibility}
              hitSlop={6}
            >
              <Ionicons
                name={
                  visibility === "group"
                    ? "eye-outline"
                    : visibility === "status"
                      ? "checkmark-circle-outline"
                      : "lock-closed-outline"
                }
                size={15}
                color={colors.muted}
              />
              <Text style={[styles.visibilityText, { color: colors.muted }]}>
                {visibility === "group"
                  ? "Exact"
                  : visibility === "status"
                    ? "Goal only"
                    : "Private"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
            <Ionicons name="remove" size={16} color={palette.white} />
          </Pressable>
        </View>
      ) : null}
      {children}
      </Animated.View>
    </Reanimated.View>
  );
}

export default LeaderboardScreen;
const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: 5, alignItems: "center" },
  pendingDot: {
    position: "absolute",
    right: -2,
    top: -3,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#F06A45",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  pendingDotText: { color: palette.white, fontSize: 8, fontWeight: "900" },
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  rankingWrap: { marginBottom: 6 },
  editBar: { height: 38, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  drag: { width: 34, alignItems: "center", justifyContent: "center" },
  dragText: { flex: 1, fontSize: 9, fontWeight: "800" },
  pinAction: { width: 28, minHeight: 28, alignItems: "center", justifyContent: "center" },
  visibility: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, minHeight: 28 },
  visibilityText: { fontSize: 8, fontWeight: "900" },
  remove: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center" },
  addExisting: { minHeight: 42, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 },
  editActions: { flexDirection: "row", gap: 7 },
  editGroupActions: { flexDirection: "row", gap: 7, marginBottom: 7 },
  editGroupAction: { flex: 1, minHeight: 38, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  editAction: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  addExistingText: { fontSize: 10, fontWeight: "900" },
  editHint: { alignItems: "center", paddingVertical: 7 },
  hint: { fontSize: 9, fontWeight: "700" },
  ranking: { padding: 7 },
  rankingHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 4,
  },
  eyebrow: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  title: { fontSize: 14, fontWeight: "900", marginTop: 1 },
  max: { fontSize: 8, fontWeight: "900", padding: 7, borderRadius: 10 },
  loadingRankings: {
    minHeight: 45,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  rankingHeadAction: { flexDirection: "row", alignItems: "center", gap: 7 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 45,
    paddingHorizontal: 5,
    paddingVertical: 7,
    borderTopWidth: 1,
  },
  rank: { width: 26, fontSize: 11, fontWeight: "900" },
  podium: { color: palette.amber, fontSize: 14 },
  memberLink: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  copy: { flex: 1 },
  metricLink: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  name: { fontSize: 12, fontWeight: "900" },
  original: { fontSize: 8, marginTop: 1 },
  detail: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  detailLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  streakBlock: { marginTop: 2 },
  streakText: { fontSize: 8, lineHeight: 12 },
  syncDetail: { fontSize: 7, lineHeight: 10, marginLeft: 15 },
  detailCopy: { flex: 1 },
  private: { fontStyle: "italic" },
  bar: { width: 124, gap: 3 },
  score: { fontSize: 12, fontWeight: "900", textAlign: "right" },
  rangeSummary: {
    fontSize: 7,
    lineHeight: 9,
    fontWeight: "700",
    textAlign: "right",
  },
  periodCard: { padding: 5, marginBottom: 7 },
  periodBar: { flexDirection: "row", alignItems: "center", gap: 3 },
  periodChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 33,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  periodText: { fontSize: 9, fontWeight: "900" },
  calendar: { borderTopWidth: 1, paddingTop: 7 },
  dateButton: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateText: { flex: 1, fontSize: 11, fontWeight: "900" },
  calendarBody: { borderTopWidth: 1, paddingTop: 9 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 5 },
  link: { fontSize: 10, fontWeight: "900" },
  groupSummary: {
    flexShrink: 1,
    marginLeft: "auto",
    fontSize: 8,
    fontWeight: "900",
    textAlign: "right",
  },
});
