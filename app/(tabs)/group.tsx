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
  Alert,
  Animated,
  BackHandler,
  InteractionManager,
  PanResponder,
  Platform,
  Pressable,
  Share,
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
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Avatar,
  Card,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import { dateKey, dateKeyWithOffset, relativeTime } from "@/src/domain/date";
import { groupInviteMessage } from "@/src/domain/invites";
import {
  LeaderboardPeriod,
  leaderboardRows,
  periodAverageGoalReached,
  periodDates,
  periodTitle,
} from "@/src/domain/leaderboard";
import { memberDisplayName, memberOriginalLabel } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { Visibility } from "@/src/types";

const SCORE_ID = "__score";
const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "7 days" },
  { id: "month", label: "Month" },
  { id: "custom", label: "Pick day" },
];

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function LeaderboardScreen() {
  const { state, updateMetric, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragPlacement, setDragPlacement] =
    useState<ReorderDragState | null>(null);
  const [rankingsReady, setRankingsReady] = useState(false);
  const rankingStateRef = useRef(state);
  rankingStateRef.current = state;
  useEffect(() => {
    if (!editing) {
      setDraggingCardId(null);
      setDragPlacement(null);
    }
  }, [editing]);
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManageGroup =
    currentMember?.role === "owner" || currentMember?.role === "admin";
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
  const dates = useMemo(() => periodDates(period, anchor), [anchor, period]);
  const rankingInputs = useMemo(
    () => ({
      statuses: state.dailyMetricStatuses,
      energyProfiles: state.energyProfiles,
      entries: state.entries,
      group: state.group,
      gymSessions: state.gymSessions,
      metrics: state.metrics,
      photos: state.photos,
      settings: state.settings,
      trackedGoalPeriods: state.trackedGoalPeriods,
    }),
    [
      state.dailyMetricStatuses,
      state.energyProfiles,
      state.entries,
      state.group,
      state.gymSessions,
      state.metrics,
      state.photos,
      state.settings,
      state.trackedGoalPeriods,
    ],
  );
  const rankingRows = useMemo(() => {
    void rankingInputs;
    const rows = new Map<string, ReturnType<typeof leaderboardRows>>();
    if (!rankingsReady) return rows;
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
    rankingsReady,
    selected,
    rankingInputs,
    tracked,
  ]);
  function choosePeriod(next: LeaderboardPeriod) {
    setPeriod(next);
    if (next === "today" || next === "week" || next === "month")
      setAnchor(dateKey());
    if (next === "yesterday") setAnchor(dateKeyWithOffset(-1));
    setCalendarOpen(next === "custom");
  }
  const pageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !editing &&
          Math.abs(gesture.dx) > 22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const index = PERIODS.findIndex((item) => item.id === period);
          const direction = gesture.dx < 0 ? 1 : -1;
          const next = PERIODS[index + direction];
          if (next) choosePeriod(next.id);
        },
      }),
    [editing, period],
  );
  async function invite() {
    await Share.share({
      message: groupInviteMessage(state.group.name, state.group.inviteCode),
    });
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
      setRankingsReady(false);
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (active) setRankingsReady(true);
      });
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!editing) return false;
        setEditing(false);
        setShowPicker(false);
        return true;
      });
      return () => {
        active = false;
        task.cancel();
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
        subtitle={`${state.group.name} · ${state.group.members.length} friends`}
      />
      <View {...pageSwipeResponder.panHandlers}>
      <Card style={styles.periodCard}>
        <View style={styles.periodBar}>
          {PERIODS.map((item) => {
            const selectedPeriod = period === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => choosePeriod(item.id)}
                style={[
                  styles.periodChoice,
                  {
                    backgroundColor: selectedPeriod
                      ? colors.primarySoft
                      : "transparent",
                    borderColor: selectedPeriod ? accent : "transparent",
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[
                    styles.periodText,
                    { color: selectedPeriod ? accent : colors.muted },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {period === "custom" ? (
          <View style={[styles.calendar, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={() => setCalendarOpen((value) => !value)}
              style={styles.dateButton}
            >
              <Ionicons name="calendar-outline" size={17} color={accent} />
              <Text style={[styles.dateText, { color: colors.ink }]}>
                {periodTitle("custom", anchor)}
              </Text>
              <Ionicons
                name={calendarOpen ? "chevron-up" : "chevron-down"}
                size={17}
                color={colors.muted}
              />
            </Pressable>
            {calendarOpen ? (
              <View
                style={[styles.calendarBody, { borderTopColor: colors.border }]}
              >
                <MonthCalendar
                  monthDate={anchor}
                  selectedDate={anchor}
                  onSelect={(date) => {
                    setAnchor(date);
                    setCalendarOpen(false);
                  }}
                  onMonthChange={setAnchor}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
      {selected.map((id, cardIndex) => {
        const metric = tracked.find((item) => item.id === id);
        const includeScore = id === SCORE_ID;
        const rows = rankingRows.get(id) ?? [];
        return (
          <ReorderItem
            key={id}
            active={draggingCardId === id}
            shift={reorderShift(cardIndex, dragPlacement)}
            settling={Boolean(dragPlacement?.settling)}
          >
            <EditableRankingCard
              editing={editing}
              index={cardIndex}
              count={selected.length}
              colors={colors}
              onMove={(target) => move(id, target)}
              onRemove={() => saveSelection(selected.filter((item) => item !== id))}
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
                setDragPlacement({
                  id,
                  origin: cardIndex,
                  target: cardIndex,
                  step,
                });
              }}
              onDragHover={(target) =>
                setDragPlacement((current) =>
                  current?.id === id ? { ...current, target } : current,
                )
              }
              onDragCancel={() => setDragPlacement(null)}
              onDragEnd={() => {
                setDragPlacement(null);
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
            </Pressable>
            {!rankingsReady ? (
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
              const details = [
                includeScore ? "Group-weighted score" : result?.averageLabel,
                !includeScore &&
                result?.personalGoalKind === "at_least" &&
                (result.averageDisplayProgress ?? 0) > 1
                  ? `${Math.round(((result.averageDisplayProgress ?? 1) - 1) * 100)}% above personal goal`
                  : undefined,
                result && result.mode !== "private"
                  ? `${result.streak ?? 0}d streak`
                  : undefined,
                result?.lastSyncedAt || result?.lastRecordedAt
                  ? `Synced ${relativeTime(
                      result.lastSyncedAt ?? result.lastRecordedAt!,
                    )}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ");
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
                    <Text
                      style={[
                        styles.detail,
                        { color: colors.muted },
                        result?.mode === "private" && styles.private,
                      ]}
                    >
                      {details}
                    </Text>
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
            <Pressable
              onPress={invite}
              style={[styles.editGroupAction, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="person-add-outline" size={17} color={accent} />
              <Text style={[styles.link, { color: accent }]}>Invite</Text>
            </Pressable>
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
        <Pressable onPress={invite} style={styles.inline}>
          <Ionicons name="person-add-outline" size={17} color={accent} />
          <Text style={[styles.link, { color: accent }]}>Invite</Text>
        </Pressable>
        <Text style={[styles.code, { color: colors.faint }]}>
          {state.group.inviteCode}
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
  visibility?: Visibility;
  onVisibilityPress?: () => void;
  onDragStart: (step: number) => void;
  onDragHover: (target: number) => void;
  onDragCancel: () => void;
  onDragEnd: () => void;
}) {
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
  const dragStep = useRef(240);
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
        Animated.timing(wiggle, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 280, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 140, useNativeDriver: true }),
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
  return (
    <Animated.View
      onLayout={(event) => {
        dragStep.current = event.nativeEvent.layout.height + 6;
      }}
      style={[
        styles.rankingWrap,
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
      {editing ? (
        <View style={[styles.editBar, { borderColor: colors.border }]}>
          <View {...responder.panHandlers} style={styles.drag}>
            <Ionicons name="reorder-three-outline" size={24} color={colors.faint} />
          </View>
          <Text style={[styles.dragText, { color: colors.muted }]}>Drag to reorder</Text>
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
  );
}
const styles = StyleSheet.create({
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  rankingWrap: { marginBottom: 6 },
  editBar: { height: 38, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  drag: { width: 34, alignItems: "center", justifyContent: "center" },
  dragText: { flex: 1, fontSize: 9, fontWeight: "800" },
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
  private: { fontStyle: "italic" },
  bar: { width: 68, gap: 4 },
  score: { fontSize: 12, fontWeight: "900", textAlign: "right" },
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
  code: {
    marginLeft: "auto",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
