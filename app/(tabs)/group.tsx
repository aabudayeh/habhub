import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, {
  ReactNode,
  useCallback,
  useDeferredValue,
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
  StyleSheet,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useTranslation } from "@/src/i18n";
import { shareText } from "@/src/lib/shareText";
import { ReorderItem } from "@/src/components/ReorderItem";
import { HorizontalPager } from "@/src/components/HorizontalPager";
import { useEditWiggle } from "@/src/components/useEditWiggle";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";

import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import {
  GoalHeatmap,
  type GoalHeatmapModel,
} from "@/src/components/GoalHeatmap";
import { GroupChallengeEditor } from "@/src/components/GroupChallengeEditor";
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
  calendarPeriodRange,
  dateKey,
  dateKeyWithOffset,
  friendlyDate,
  relativeTime,
} from "@/src/domain/date";
import { statusForDay } from "@/src/domain/dataIndex";
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
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { useFocusedCloudSyncPause } from "@/src/cloud/useFocusedCloudSyncPause";
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { useGroupNotificationEvents } from "@/src/cloud/useGroupNotificationEvents";
import {
  canManageGroupChallenge,
  acceptedChallengeParticipantIds,
  challengeCardId,
  challengeWinnerIds,
  challengeIdFromCard,
  declinedChallengeParticipantIds,
  expandGroupChallengeOccurrences,
  groupChallengeEndDate,
  groupChallengeParticipation,
  groupChallengeProgress,
  groupChallengeResponseDeadline,
  groupChallengeSourceId,
  isChallengeMetric,
  mergedLeaderboardCardOrder,
} from "@/src/domain/groupChallenges";
import {
  chunkIntoPages,
  leaderboardPageCapacity,
} from "@/src/domain/pagedLayout";
import {
  formatMetricValue,
  goalReached,
  hasMetricData,
  sharedMetricResult,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  AppState,
  GroupChallenge,
  HistoryRange,
  MetricDefinition,
  Visibility,
} from "@/src/types";

const SCORE_ID = "__score";
const SHARED_LEADERBOARD_SUMMARY_START = "2000-01-01";
const CHALLENGE_CELEBRATION_SCAN_LIMIT = 500;

function sharedLeaderboardHeatmapModel(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
): GoalHeatmapModel {
  const today = dateKey();
  const cells = dates.map((date) => {
    const future = date > today;
    const status = statusForDay(
      state.dailyMetricStatuses,
      state.group.id,
      metric.id,
      userId,
      date,
    );
    const result = sharedMetricResult(
      state,
      metric,
      userId,
      state.currentUserId,
      date,
    );
    const exactData =
      result.mode === "exact" && hasMetricData(state, metric, userId, date);
    const logged = !future && (status?.hasData === true || exactData);
    const tracked =
      !future && (status?.goalEligible ?? metric.activeFrom <= date);
    const target = Number(status?.goalTarget);
    const reached =
      logged &&
      (status?.goalReached === true ||
        (result.mode === "exact" &&
          goalReached(
            {
              ...metric,
              goal: status?.goalKind
                ? { ...metric.goal, kind: status.goalKind }
                : metric.goal,
            },
            result.value,
            Number.isFinite(target) ? target : metric.goal.target,
          )));
    return {
      date,
      future,
      logged,
      tracked,
      reached,
      backgroundColor: future
        ? undefined
        : !logged
          ? `${palette.faint}72`
          : !tracked
            ? palette.amber
            : reached
              ? palette.lime
              : palette.red,
    };
  });
  const applicableDates = cells
    .filter((cell) => !cell.future && cell.tracked)
    .map((cell) => cell.date);
  const loggedDates = cells
    .filter((cell) => cell.logged)
    .map((cell) => cell.date);
  const goalsReached = cells.filter((cell) => cell.reached).length;
  return {
    cells,
    period: {
      applicableDates,
      loggedDates,
      values: [],
      total: 0,
      average: 0,
      averageTarget: metric.goal.target,
      goalsReached,
    },
  };
}

const LeaderboardMemberGrid = React.memo(function LeaderboardMemberGrid({
  state,
  metric,
  memberId,
  gridDates,
  gridRange,
}: {
  state: AppState;
  metric: MetricDefinition;
  memberId: string;
  gridDates: string[];
  gridRange: HistoryRange;
}) {
  const colors = useAppColors();
  // Year grids can contain 365 cells per member. Keep that privacy-aware
  // projection stable across the parent screen's clock/edit renders.
  const gridModel = useMemo(
    () =>
      sharedLeaderboardHeatmapModel(
        state,
        metric,
        memberId,
        gridDates,
      ),
    [gridDates, memberId, metric, state],
  );
  return (
    <View
      style={[
        styles.memberGrid,
        {
          borderTopColor: colors.border,
          backgroundColor:
            memberId === state.currentUserId
              ? colors.primarySoft
              : colors.card,
        },
      ]}
    >
      <GoalHeatmap
        state={state}
        metric={metric}
        dates={gridDates}
        range={gridRange}
        compact
        completionOnly
        model={gridModel}
        onSelect={(selectedDate) => {
          const cell = gridModel.cells.find(
            (item) => item.date === selectedDate,
          );
          if (!cell?.logged) return;
          if (memberId === state.currentUserId) {
            router.navigate({
              pathname: "/day/[date]",
              params: { date: selectedDate, metrics: metric.id },
            } as never);
            return;
          }
          router.navigate({
            pathname: "/member/[id]",
            params: {
              id: memberId,
              period: "custom",
              anchor: selectedDate,
              metrics: metric.id,
            },
          } as never);
        }}
      />
    </View>
  );
});

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function LeaderboardScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const tutorial = useTutorial();
  const { state, updateMetric, updateSettings } = useApp();
  const cloud = useCloudSyncActions();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { height: viewportHeight } = useWindowDimensions();
  const t = useTranslation();
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const [dateNavigatorOpen, setDateNavigatorOpen] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const leaderboardUsesPages =
    state.settings.leaderboardLayoutMode === "pages";
  const [showPicker, setShowPicker] = useState(false);
  const [challengeEditorOpen, setChallengeEditorOpen] = useState(false);
  const [pendingChallengeCardId, setPendingChallengeCardId] = useState<string>();
  const [editingChallenge, setEditingChallenge] = useState<GroupChallenge>();
  const [expandedGridRows, setExpandedGridRows] = useState<string[]>([]);
  const [screenFocused, setScreenFocused] = useState(false);
  const [challengeCelebration, setChallengeCelebration] = useState<{
    id: string;
    title: string;
    detail: string;
  }>();
  const celebratingChallengeIds = useRef(new Set<string>());
  const [, setClockTick] = useState(0);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const rankingStateRef = useRef(state);
  rankingStateRef.current = state;
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      // Relative sync labels only need a clock while this tab is visible. A
      // mounted-but-frozen leaderboard can otherwise wake every minute and
      // recompute year-scale rankings behind whichever page the user is using.
      setClockTick((value) => value + 1);
      const timer = setInterval(
        () => setClockTick((value) => value + 1),
        60_000,
      );
      return () => {
        setScreenFocused(false);
        clearInterval(timer);
      };
    }, []),
  );
  useEffect(() => {
    if (!editing) {
      setDraggingCardId(null);
    }
  }, [editing]);
  useFocusedCloudSyncPause(
    "leaderboard-edit",
    editing || challengeEditorOpen,
  );
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManageGroup =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const personalSetup = isPersonalSetupGroup(state.group);
  const challengesEnabled =
    tutorialSandbox || (!personalSetup && isCloudGroupId(state.group.id));
  const challengeCloud = useGroupChallenges(state.group.id);
  const {
    allEvents: groupFeedEvents,
    unreadCount: groupFeedUnreadCount,
  } = useGroupNotificationEvents(
    state.group.id,
    state.settings.notifications.groupPreferencesByGroup?.[state.group.id],
  );
  const notificationBadgeCount =
    groupFeedUnreadCount + (state.group.pendingMembers?.length ?? 0);
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
  const completedChallengeResults = useMemo(() => {
    if (!screenFocused) return [];
    const today = dateKey();
    const throughDate = dateKeyWithOffset(-1);
    const celebrationCutoff = dateKeyWithOffset(-30);
    const saved = new Set([
      ...(state.settings.seenChallengeCelebrationIdsByGroup?.[
        state.group.id
      ] ?? []),
      ...celebratingChallengeIds.current,
    ]);
    const cloudResultsRequireSettlement =
      !tutorialSandbox && isCloudGroupId(state.group.id);
    const next = expandGroupChallengeOccurrences(
      challengeCloud.challenges,
      dateKeyWithOffset(-367),
      throughDate,
      CHALLENGE_CELEBRATION_SCAN_LIMIT,
    )
      .filter((challenge) => {
        const participation = groupChallengeParticipation(
          challenge,
          state.currentUserId,
        );
        const canonicalResult = groupFeedEvents.find(
          (event) =>
            event.kind === "challenge_result" &&
            event.challengeId === groupChallengeSourceId(challenge) &&
            event.occurrenceDate === challenge.localDate,
        );
        return (
          !saved.has(challenge.id) &&
          groupChallengeEndDate(challenge) >= celebrationCutoff &&
          groupChallengeEndDate(challenge) < today &&
          (participation === "creator" || participation === "accepted") &&
          (!cloudResultsRequireSettlement || Boolean(canonicalResult))
        );
      })
      .sort(
        (left, right) =>
          groupChallengeEndDate(right).localeCompare(
            groupChallengeEndDate(left),
          ) || right.id.localeCompare(left.id),
      )
      .find((challenge) =>
        tracked.some((item) => item.id === challenge.metricId),
      );
    if (!next) return [];
    const metric = tracked.find((item) => item.id === next.metricId)!;
    const canonicalResult = groupFeedEvents.find(
      (event) =>
        event.kind === "challenge_result" &&
        event.challengeId === groupChallengeSourceId(next) &&
        event.occurrenceDate === next.localDate,
    );
    const rows = groupChallengeProgress(state, next, metric);
    return [
      {
        challenge: next,
        metric,
        canonicalResult,
        winnerIds: canonicalResult
          ? []
          : challengeWinnerIds(
              rows,
              next.target,
              next.target === undefined ? "higher" : metric.rankingDirection,
            ),
      },
    ];
  }, [
    challengeCloud.challenges,
    groupFeedEvents,
    screenFocused,
    state,
    tracked,
    tutorialSandbox,
  ]);
  useEffect(() => {
    if (!screenFocused || challengeCelebration) return;
    const saved =
      state.settings.seenChallengeCelebrationIdsByGroup?.[state.group.id] ?? [];
    const seen = new Set([
      ...saved,
      ...celebratingChallengeIds.current,
    ]);
    const next = completedChallengeResults.find(
      (result) => !seen.has(result.challenge.id),
    );
    if (!next) return;
    celebratingChallengeIds.current.add(next.challenge.id);
    const title =
      next.challenge.title?.trim() || `${next.metric.name} challenge`;
    if (next.canonicalResult) {
      setChallengeCelebration({
        id: next.challenge.id,
        title: next.canonicalResult.title ?? `${title} complete`,
        detail:
          next.canonicalResult.detail ?? "The final standings are ready.",
      });
    } else {
      const winnerNames = next.winnerIds
        .map((id) => {
          if (id === state.currentUserId) return "You";
          const member = state.group.members.find((item) => item.id === id);
          return member ? memberDisplayName(state, member) : undefined;
        })
        .filter(Boolean);
      const userWon = next.winnerIds.includes(state.currentUserId);
      setChallengeCelebration({
        id: next.challenge.id,
        title: userWon ? `You won ${title}` : `${title} complete`,
        detail: winnerNames.length
          ? `${winnerNames.join(" & ")} ${winnerNames.length === 1 ? "wins" : "tie for first"}.`
          : "The final standings are ready.",
      });
    }
    updateSettings({
      seenChallengeCelebrationIdsByGroup: {
        ...(state.settings.seenChallengeCelebrationIdsByGroup ?? {}),
        [state.group.id]: [...saved, next.challenge.id].slice(
          -CHALLENGE_CELEBRATION_SCAN_LIMIT,
        ),
      },
    });
  }, [
    challengeCelebration,
    completedChallengeResults,
    screenFocused,
    state,
    updateSettings,
  ]);
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
  // Keep period/filter controls responsive while ranking rows for the newly
  // selected range are prepared. React can keep showing the last complete
  // rows for a frame instead of doing every member/metric calculation inside
  // the press event's render.
  const calculationPeriod = useDeferredValue(period);
  const calculationAnchor = useDeferredValue(anchor);
  const calculationSelected = useDeferredValue(selected);
  const pinnedIds = useMemo(
    () =>
      state.settings.leaderboardPinnedMetricIdsByGroup?.[state.group.id] ?? [],
    [state.group.id, state.settings.leaderboardPinnedMetricIdsByGroup],
  );
  const weekStartsOn = state.settings.weekStartsOn ?? 1;
  const gridRange: HistoryRange =
    state.settings.leaderboardGridRangeByGroup?.[state.group.id] ?? "week";
  const gridDates = useMemo(
    () => calendarPeriodRange(anchor, gridRange, weekStartsOn),
    [anchor, gridRange, weekStartsOn],
  );
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
      return calculationPeriod === "overall"
        ? allTimePeriodDates(
            rankingStateRef.current,
            calculationAnchor,
            calculationSelected.includes(SCORE_ID)
              ? tracked.map((metric) => metric.id)
              : calculationSelected,
          )
        : periodDates(calculationPeriod, calculationAnchor, weekStartsOn);
    },
    [
      allTimeInputs,
      calculationAnchor,
      calculationPeriod,
      calculationSelected,
      tracked,
      weekStartsOn,
    ],
  );
  const navigationDates = useMemo(
    () => periodDates(period, anchor, weekStartsOn),
    [anchor, period, weekStartsOn],
  );
  const visibleChallenges = useMemo(() => {
    const sortedDates = [...dates].sort();
    const firstChallengeDate = challengeCloud.challenges
      .map((challenge) => challenge.localDate)
      .sort()[0];
    const fromDate =
      period === "overall"
        ? (firstChallengeDate ?? anchor)
        : (sortedDates[0] ?? anchor);
    const throughDate =
      period === "overall"
        ? anchor
        : (sortedDates.at(-1) ?? anchor);
    const rangeChallenges = expandGroupChallengeOccurrences(
      challengeCloud.challenges,
      fromDate,
      throughDate,
    ).filter((challenge) => {
      const participation = groupChallengeParticipation(
        challenge,
        state.currentUserId,
      );
      return (
        participation === "creator" ||
        participation === "accepted" ||
        groupChallengeResponseDeadline(challenge) >= dateKey()
      );
    });
    // A future invitation must be actionable from today's Leaderboard even
    // though its scoring occurrence belongs to a later date range. Keep only
    // unanswered/declined source cards here so accepted future series do not
    // crowd the current ranking view.
    const futureInvitations = challengeCloud.challenges.filter((challenge) => {
      const participation = groupChallengeParticipation(
        challenge,
        state.currentUserId,
      );
      return (
        challenge.localDate > throughDate &&
        (participation === "invited" || participation === "declined") &&
        groupChallengeResponseDeadline(challenge) >= dateKey()
      );
    });
    return [
      ...new Map(
        [...rangeChallenges, ...futureInvitations].map((challenge) => [
          challenge.id,
          challenge,
        ]),
      ).values(),
    ];
  }, [anchor, challengeCloud.challenges, dates, period, state.currentUserId]);
  const savedCardOrder =
    state.settings.leaderboardCardOrderByGroup?.[state.group.id];
  const allCardIds = useMemo(
    () =>
      mergedLeaderboardCardOrder(
        savedCardOrder,
        selected,
        visibleChallenges,
      ),
    [savedCardOrder, selected, visibleChallenges],
  );
  const orderedCardIds = useMemo(
    () => {
      const visibleChallengeIds = new Set(
        visibleChallenges.map((challenge) => challenge.id),
      );
      return allCardIds.filter((id) => {
        const challengeId = challengeIdFromCard(id);
        return !challengeId || visibleChallengeIds.has(challengeId);
      });
    },
    [allCardIds, visibleChallenges],
  );
  const displayedSelected = useMemo(() => {
    if (editing) return orderedCardIds;
    const pinOrder = new Map(pinnedIds.map((id, index) => [id, index]));
    return [...orderedCardIds].sort((left, right) => {
      const leftPin = pinOrder.get(left);
      const rightPin = pinOrder.get(right);
      if (leftPin !== undefined || rightPin !== undefined)
        return leftPin === undefined
          ? 1
          : rightPin === undefined
            ? -1
            : leftPin - rightPin;
      return orderedCardIds.indexOf(left) - orderedCardIds.indexOf(right);
    });
  }, [editing, orderedCardIds, pinnedIds]);
  const leaderboardPageSize = useMemo(() => {
    return leaderboardPageCapacity(
      viewportHeight,
      state.group.members.length,
      dateNavigatorOpen,
      expandedGridRows.length > 0,
    );
  }, [
    dateNavigatorOpen,
    expandedGridRows.length,
    state.group.members.length,
    viewportHeight,
  ]);
  const requestedLeaderboardPage = pendingChallengeCardId
    ? (() => {
        const index = displayedSelected.indexOf(pendingChallengeCardId);
        return index >= 0 ? Math.floor(index / leaderboardPageSize) : undefined;
      })()
    : undefined;
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
    for (const id of calculationSelected) {
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
    calculationSelected,
    rankingInputs,
    tracked,
  ]);
  const visibleGridKeys = useMemo(
    () =>
      calculationSelected.flatMap((metricId) =>
        metricId === SCORE_ID
          ? []
          : (rankingRows.get(metricId) ?? [])
              .map((row) => `${metricId}:${row.member.id}`),
      ),
    [calculationSelected, rankingRows],
  );
  const targetedActivitySince = useMemo(
    () => {
      // Overall cannot infer the server's earliest shared day from a 120-day
      // local cache. Ask once for the complete compact status read model;
      // raw/exact entries remain server-clamped to their privacy-safe window.
      if (period === "overall") return SHARED_LEADERBOARD_SUMMARY_START;
      return [dates[0], gridDates[0]]
        .filter((date): date is string => Boolean(date))
        .sort()[0];
    },
    [dates, gridDates, period],
  );
  useFocusEffect(
    useCallback(() => {
      if (
        tutorialSandbox ||
        personalSetup ||
        !targetedActivitySince ||
        !isCloudGroupId(state.group.id)
      )
        return;
      const timer = setTimeout(() => {
        cloud.refreshActivity(targetedActivitySince).catch(() => undefined);
      }, 180);
      return () => clearTimeout(timer);
    }, [
      cloud,
      personalSetup,
      state.group.id,
      targetedActivitySince,
      tutorialSandbox,
    ]),
  );

  function saveGridRange(range: HistoryRange) {
    updateSettings({
      leaderboardGridRangeByGroup: {
        ...(state.settings.leaderboardGridRangeByGroup ?? {}),
        [state.group.id]: range,
      },
    });
  }

  function toggleGridRow(key: string) {
    setExpandedGridRows((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }
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
          !leaderboardUsesPages &&
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
    [calendarOpen, editing, leaderboardUsesPages, period],
  );
  async function invite() {
    if (tutorialSandbox) return;
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
    const nextCardOrder = allCardIds.filter(
      (id) => challengeIdFromCard(id) || next.includes(id),
    );
    for (const id of next) if (!nextCardOrder.includes(id)) nextCardOrder.push(id);
    updateSettings({
      leaderboardMetricIdsByGroup: {
        ...state.settings.leaderboardMetricIdsByGroup,
        [state.group.id]: next,
      },
      leaderboardPinnedMetricIdsByGroup: {
        ...(state.settings.leaderboardPinnedMetricIdsByGroup ?? {}),
        [state.group.id]: pinnedIds.filter(
          (id) => challengeIdFromCard(id) || next.includes(id),
        ),
      },
      leaderboardCardOrderByGroup: {
        ...(state.settings.leaderboardCardOrderByGroup ?? {}),
        [state.group.id]: nextCardOrder,
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
    const next = [...orderedCardIds];
    const index = next.indexOf(id);
    if (index < 0) return;
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(target, next.length)), 0, item);
    const visibleIds = new Set(orderedCardIds);
    const reordered = [...next];
    const fullOrder = allCardIds.map((cardId) =>
      visibleIds.has(cardId) ? (reordered.shift() ?? cardId) : cardId,
    );
    updateSettings({
      leaderboardCardOrderByGroup: {
        ...(state.settings.leaderboardCardOrderByGroup ?? {}),
        [state.group.id]: fullOrder,
      },
    });
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
  function openChallengeEditor(challenge?: GroupChallenge) {
    if (!challenge && state.group.members.length < 2) {
      Alert.alert(
        "Invite a friend first",
        "A challenge needs at least two active group members.",
      );
      return;
    }
    if (!tracked.some(isChallengeMetric)) {
      Alert.alert(
        "Add a numerical tracker first",
        "Challenges use an existing numerical tracker shared with this group.",
      );
      return;
    }
    if (!challenge) {
      tutorial.reportEvent({
        actionId: "tutorial.challenge.open-create",
        scope: "isolated-preview",
      });
    }
    setEditingChallenge(
      challenge
        ? challengeCloud.challenges.find(
            (candidate) => candidate.id === groupChallengeSourceId(challenge),
          ) ?? challenge
        : undefined,
    );
    setChallengeEditorOpen(true);
  }
  function confirmDeleteChallenge(challenge: GroupChallenge) {
    const sourceId = groupChallengeSourceId(challenge);
    Alert.alert(
      "Delete challenge?",
      "This removes the challenge card for every invited member. Tracker data is not changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            challengeCloud
              .remove(sourceId)
              .then(() => {
                const isChallengeSeriesCard = (id: string) => {
                  const challengeId = challengeIdFromCard(id);
                  return (
                    challengeId === sourceId ||
                    challengeId?.startsWith(`${sourceId}@`) === true
                  );
                };
                updateSettings({
                  leaderboardPinnedMetricIdsByGroup: {
                    ...(state.settings.leaderboardPinnedMetricIdsByGroup ?? {}),
                    [state.group.id]: pinnedIds.filter(
                      (id) => !isChallengeSeriesCard(id),
                    ),
                  },
                  leaderboardCardOrderByGroup: {
                    ...(state.settings.leaderboardCardOrderByGroup ?? {}),
                    [state.group.id]: (savedCardOrder ?? []).filter(
                      (id) => !isChallengeSeriesCard(id),
                    ),
                  },
                });
              })
              .catch((reason) =>
                Alert.alert(
                  "Could not delete challenge",
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
          },
        },
      ],
    );
  }
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
              {challengesEnabled ? (
                <TutorialTarget id="leaderboard-create-challenge">
                  <IconButton
                    icon="trophy-outline"
                    label="Create challenge"
                    onPress={() => openChallengeEditor()}
                  />
                </TutorialTarget>
              ) : null}
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
                {notificationBadgeCount > 0 ? (
                  <View style={styles.pendingDot}>
                    <Text style={styles.pendingDotText}>
                      {Math.min(9, notificationBadgeCount)}
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
            dates={navigationDates}
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
        {editing ? (
          <Card style={styles.gridEditControls}>
            <View style={styles.gridEditLine}>
              <View style={styles.gridRangeChoices}>
                {(["week", "month", "year"] as HistoryRange[]).map(
                  (range) => {
                    const selectedRange = gridRange === range;
                    return (
                      <Pressable
                        key={range}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selectedRange }}
                        onPress={() => saveGridRange(range)}
                        style={[
                          styles.gridRangeChoice,
                          {
                            borderColor: selectedRange
                              ? accent
                              : colors.border,
                            backgroundColor: selectedRange
                              ? colors.primarySoft
                              : colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.gridRangeChoiceText,
                            { color: selectedRange ? accent : colors.muted },
                          ]}
                        >
                          {range[0].toUpperCase() + range.slice(1)}
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </View>
              <View style={styles.gridDisclosureActions}>
                <Pressable
                  onPress={() => setExpandedGridRows(visibleGridKeys)}
                  style={styles.gridDisclosureAction}
                >
                  <Ionicons name="expand-outline" size={14} color={accent} />
                  <Text style={[styles.gridDisclosureText, { color: accent }]}>{t("Expand all")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setExpandedGridRows([])}
                  style={styles.gridDisclosureAction}
                >
                  <Ionicons name="contract-outline" size={14} color={accent} />
                  <Text style={[styles.gridDisclosureText, { color: accent }]}>{t("Collapse all")}</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.gridEditHint, { color: colors.muted }]}>{t("Calendar rows are collapsed by default. The selected range is saved for this group.")}</Text>
          </Card>
        ) : null}
      {(() => {
        const rankingCards = displayedSelected.map((id, cardIndex) => {
        const challengeId = challengeIdFromCard(id);
        const challenge = challengeId
          ? visibleChallenges.find((item) => item.id === challengeId)
          : undefined;
        if (challenge) {
          const manageable = canManageGroupChallenge(
            challenge,
            state.currentUserId,
            currentMember,
          );
          const editable =
            manageable && groupChallengeResponseDeadline(challenge) >= dateKey();
          return (
            <ReorderItem key={id} active={draggingCardId === id}>
              <EditableRankingCard
                editing={editing}
                index={cardIndex}
                count={displayedSelected.length}
                colors={colors}
                onMove={(target) => move(id, target)}
                onSendBelow={() => move(id, displayedSelected.length - 1)}
                onRemove={manageable ? () => confirmDeleteChallenge(challenge) : undefined}
                onEdit={editable ? () => openChallengeEditor(challenge) : undefined}
                pinned={pinnedIds.includes(id)}
                onPin={() => togglePin(id)}
                onDragStart={() => setDraggingCardId(id)}
                onDragHover={() => {}}
                onDragCancel={() => setDraggingCardId(null)}
                onDragEnd={() => setDraggingCardId(null)}
              >
                <ChallengeRankingCard
                  challenge={challenge}
                  state={state}
                  metric={tracked.find((item) => item.id === challenge.metricId)}
                  colors={colors}
                  accent={accent}
                  editing={editing}
                  pinned={pinnedIds.includes(id)}
                  onLongPress={() => setEditing(true)}
                  onRespond={(response) =>
                    challengeCloud
                      .respond(groupChallengeSourceId(challenge), response)
                      .then(() => undefined)
                  }
                />
              </EditableRankingCard>
            </ReorderItem>
          );
        }
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
              onSendBelow={() => move(id, displayedSelected.length - 1)}
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
            <TutorialTarget
              id={
                cardIndex === 0
                  ? "leaderboard-cards"
                  : `leaderboard-card-${id}`
              }
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
            {rows.map((row, index) => {
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
              const gridKey = `${id}:${row.member.id}`;
              const gridExpanded = expandedGridRows.includes(gridKey);
              const gridMemberName = memberDisplayName(state, row.member);
              return (
                <View
                  key={row.member.id}
                  style={[
                    styles.memberGridBlock,
                    gridExpanded &&
                      row.member.id === state.currentUserId && {
                        backgroundColor: colors.primarySoft,
                        borderRadius: 14,
                      },
                  ]}
                >
                  <View
                    style={[
                      styles.row,
                      { borderTopColor: colors.border },
                      row.member.id === state.currentUserId && {
                        backgroundColor: gridExpanded
                          ? "transparent"
                          : colors.primarySoft,
                        borderRadius: gridExpanded ? 0 : 14,
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
                  </Pressable>
                  {!includeScore && metric ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(`${gridExpanded ? "Collapse" : "Expand"} ${gridRange} calendar for ${gridMemberName}`)}
                      accessibilityState={{ expanded: gridExpanded }}
                      onPress={() => toggleGridRow(gridKey)}
                      hitSlop={8}
                      style={styles.gridToggle}
                    >
                      <Ionicons
                        name={gridExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={accent}
                      />
                    </Pressable>
                  ) : null}
                  </View>
                  {gridExpanded && metric ? (
                    <LeaderboardMemberGrid
                      state={state}
                      metric={metric}
                      memberId={row.member.id}
                      gridDates={gridDates}
                      gridRange={gridRange}
                    />
                  ) : null}
                </View>
              );
            })}
            </Card>
            </TutorialTarget>
            </EditableRankingCard>
          </ReorderItem>
        );
        });
        if (!leaderboardUsesPages || editing) return rankingCards;
        const rankingPages = chunkIntoPages(
          rankingCards,
          leaderboardPageSize,
        ).map((page, index) => (
          <View key={index} style={styles.pagedCardStack}>
            {page}
          </View>
        ));
        return (
          <HorizontalPager
            accessibilityLabel="Leaderboard"
            testID="leaderboard-card-pages"
            pages={rankingPages}
            requestedPage={requestedLeaderboardPage}
            onPageChange={(page) => {
              if (page === requestedLeaderboardPage)
                setPendingChallengeCardId(undefined);
            }}
          />
        );
      })()}
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
        <TutorialTarget id="leaderboard-edit">
          <Pressable onPress={() => setEditing(true)} style={styles.editHint}>
            <Text style={[styles.hint, { color: colors.muted }]}>Hold a ranking card to edit what Leaderboard shows</Text>
          </Pressable>
        </TutorialTarget>
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
      <GroupChallengeEditor
        visible={challengeEditorOpen}
        group={state.group}
        metrics={tracked}
        currentUserId={state.currentUserId}
        initialDate={anchor}
        challenge={editingChallenge}
        onClose={() => {
          setChallengeEditorOpen(false);
          setEditingChallenge(undefined);
        }}
        onSave={async (input) => {
          const creating = !input.id;
          const savedChallenge = await challengeCloud.save(input);
          if (creating) {
            setAnchor(savedChallenge.localDate);
            setPeriod("custom");
            setPendingChallengeCardId(challengeCardId(savedChallenge.id));
          }
        }}
      />
      {challengeCloud.error && challengesEnabled ? (
        <Pressable
          onPress={() => challengeCloud.refresh()}
          style={[styles.challengeRetry, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={accent} />
          <Text numberOfLines={2} style={[styles.challengeRetryText, { color: colors.muted }]}>Challenges could not refresh. Tap to retry.</Text>
        </Pressable>
      ) : null}
      {challengeCelebration ? (
        <ChallengeCompletionCelebration
          title={challengeCelebration.title}
          detail={challengeCelebration.detail}
          accent={accent}
          colors={colors}
          onClose={() => setChallengeCelebration(undefined)}
        />
      ) : null}
      </View>
    </Screen>
  );
}

function ChallengeCompletionCelebration({
  title,
  detail,
  accent,
  colors,
  onClose,
}: {
  title: string;
  detail: string;
  accent: string;
  colors: ReturnType<typeof useAppColors>;
  onClose: () => void;
}) {
  const burst = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(burst, {
      toValue: 1,
      duration: 950,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(onClose, 4_800);
    return () => clearTimeout(timer);
  }, [burst, onClose]);
  const confetti = Array.from({ length: 28 }, (_, index) => ({
    key: index,
    left: `${4 + ((index * 37) % 92)}%` as `${number}%`,
    color: [accent, palette.amber, palette.lime, palette.red][index % 4],
    delay: ((index % 7) + 1) * 0.06,
  }));
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close challenge celebration"
        onPress={onClose}
        style={styles.challengeCelebrationBackdrop}
      >
        <View style={styles.challengeConfetti} pointerEvents="none">
          {confetti.map((piece) => (
            <Animated.View
              key={piece.key}
              style={[
                styles.challengeConfettiPiece,
                {
                  left: piece.left,
                  backgroundColor: piece.color,
                  opacity: burst.interpolate({
                    inputRange: [0, piece.delay, 1],
                    outputRange: [0, 1, 0.72],
                  }),
                  transform: [
                    {
                      translateY: burst.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-80 - (piece.key % 5) * 16, 430],
                      }),
                    },
                    {
                      rotate: burst.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0deg", `${180 + piece.key * 29}deg`],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>
        <View
          style={[
            styles.challengeCelebrationCard,
            { backgroundColor: colors.card, borderColor: `${accent}70` },
          ]}
        >
          <View
            style={[
              styles.challengeCelebrationIcon,
              { backgroundColor: `${accent}20` },
            ]}
          >
            <Ionicons name="trophy" size={30} color={accent} />
          </View>
          <Text style={[styles.challengeCelebrationEyebrow, { color: accent }]}>CHALLENGE COMPLETE</Text>
          <Text style={[styles.challengeCelebrationTitle, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.challengeCelebrationDetail, { color: colors.muted }]}>{detail}</Text>
          <Text style={[styles.challengeCelebrationClose, { color: colors.faint }]}>Tap anywhere to close</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

function ChallengeRankingCard({
  challenge,
  state,
  metric,
  colors,
  accent,
  editing,
  pinned,
  onLongPress,
  onRespond,
}: {
  challenge: GroupChallenge;
  state: AppState;
  metric?: MetricDefinition;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
  editing: boolean;
  pinned: boolean;
  onLongPress: () => void;
  onRespond: (response: "accepted" | "declined") => Promise<void>;
}) {
  const [responding, setResponding] = useState<"accepted" | "declined">();
  const rows = useMemo(
    () => (metric ? groupChallengeProgress(state, challenge, metric) : []),
    [challenge, metric, state],
  );
  const complete = rows.filter((row) => row.complete).length;
  const participation = groupChallengeParticipation(
    challenge,
    state.currentUserId,
  );
  const acceptedCount = acceptedChallengeParticipantIds(challenge).length;
  const declinedCount = declinedChallengeParticipantIds(challenge).length;
  const awaitingCount = Math.max(
    0,
    challenge.participantIds.length - acceptedCount - declinedCount,
  );
  const title =
    challenge.title?.trim() ||
    (metric ? `${metric.name} challenge` : "Group challenge");
  const openCompetition = challenge.target === undefined;
  const targetLabel = openCompetition
    ? "Most wins"
    : metric
      ? formatMetricValue(metric, challenge.target!)
      : String(challenge.target);
  const endDate = groupChallengeEndDate(challenge);
  const finalized = endDate < dateKey();
  const periodLabel =
    endDate === challenge.localDate
      ? friendlyDate(challenge.localDate)
      : `${friendlyDate(challenge.localDate)} – ${friendlyDate(endDate)}`;
  async function respond(response: "accepted" | "declined") {
    setResponding(response);
    try {
      await onRespond(response);
    } catch (reason) {
      Alert.alert(
        "Could not update invitation",
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setResponding(undefined);
    }
  }
  return (
    <Card style={[styles.ranking, styles.challengeCard]}>
      <Pressable disabled={editing} onLongPress={onLongPress} style={styles.challengeHead}>
        <View style={[styles.challengeMark, { backgroundColor: `${accent}1F` }]}>
          <Ionicons name="trophy" size={18} color={accent} />
        </View>
        <View style={styles.challengeHeadingCopy}>
          <View style={styles.challengeEyebrowLine}>
            <Text style={[styles.eyebrow, { color: accent }]}>FRIEND CHALLENGE</Text>
            {pinned && !editing ? <Ionicons name="pin" size={12} color={palette.amber} /> : null}
          </View>
          <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.challengeMeta, { color: colors.muted }]}>
            {periodLabel} · {targetLabel} · {acceptedCount}/{challenge.participantIds.length} joined
            {challenge.recurrence ? " · repeats" : ""}
            {awaitingCount ? ` · ${awaitingCount} awaiting` : ""}
          </Text>
        </View>
        <View style={[styles.completePill, { backgroundColor: finalized ? `${palette.lime}35` : colors.primarySoft }]}>
          <Text style={[styles.completePillText, { color: finalized ? colors.ink : accent }]}>
            {openCompetition ? (finalized ? "Final" : "#1 wins") : `${complete}/${rows.length}`}
          </Text>
        </View>
      </Pressable>
      {!editing &&
      (participation === "invited" || participation === "declined") ? (
        <View style={[styles.challengeInvite, { borderTopColor: colors.border }]}>
          <View style={styles.challengeInviteCopy}>
            <Text style={[styles.name, { color: colors.ink }]}>
              {participation === "declined"
                ? "Invitation declined"
                : "You are invited"}
            </Text>
            <Text style={[styles.detail, { color: colors.muted }]}>
              {challenge.recurrence
                ? "Your answer applies to every repeat in this series."
                : endDate !== challenge.localDate
                  ? "Join to compete across the full date range."
                  : "Join to appear in this challenge ranking."}
            </Text>
          </View>
          {participation === "invited" ? (
            <Pressable
              disabled={Boolean(responding)}
              accessibilityRole="button"
              accessibilityLabel="Decline challenge"
              onPress={() => void respond("declined")}
              style={[styles.challengeResponse, { borderColor: colors.border }]}
            >
              <Text style={[styles.challengeResponseText, { color: colors.muted }]}>Decline</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={Boolean(responding)}
            accessibilityRole="button"
            accessibilityLabel="Accept challenge"
            onPress={() => void respond("accepted")}
            style={[styles.challengeResponse, { borderColor: accent, backgroundColor: colors.primarySoft }]}
          >
            <Text style={[styles.challengeResponseText, { color: accent }]}>
              {responding === "accepted" ? "Joining…" : "Accept"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!metric ? (
        <View style={[styles.challengeUnavailable, { borderTopColor: colors.border }]}>
          <Text style={[styles.detail, { color: colors.muted }]}>This tracker is no longer available.</Text>
        </View>
      ) : (
        rows.slice(0, 5).map((row, index) => (
          <View
            key={row.member.id}
            style={[
              styles.challengeRow,
              { borderTopColor: colors.border },
              row.member.id === state.currentUserId && {
                backgroundColor: colors.primarySoft,
                borderTopColor: "transparent",
              },
            ]}
          >
            <Text style={[styles.challengeRank, { color: index < 3 ? palette.amber : colors.faint }]}>#{index + 1}</Text>
            <Avatar initials={row.member.initials} color={row.member.color} uri={row.member.avatarUri} size={29} />
            <View style={styles.challengeMemberCopy}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
                {memberDisplayName(state, row.member)}{row.member.id === state.currentUserId ? " · You" : ""}
              </Text>
              <Text numberOfLines={1} style={[styles.challengeValue, { color: row.complete ? colors.ink : colors.muted }]}>
                {!openCompetition && row.complete ? "Target reached" : row.valueLabel}
              </Text>
            </View>
            <View style={styles.challengeProgress}>
              <View style={styles.challengeProgressLabel}>
                <Text style={[styles.challengePercent, { color: row.mode === "exact" ? colors.ink : colors.faint }]}>
                  {row.mode === "exact" ? `${Math.round(row.progress * 100)}%` : "—"}
                </Text>
                {row.complete ? <Ionicons name="checkmark-circle" size={14} color={palette.lime} /> : null}
              </View>
              <ProgressBar progress={row.progress} color={row.complete ? palette.lime : accent} />
            </View>
          </View>
        ))
      )}
      {rows.length > 5 ? (
        <Text style={[styles.challengeMore, { color: colors.muted }]}>+{rows.length - 5} more invited members</Text>
      ) : null}
    </Card>
  );
}

function EditableRankingCard({
  children,
  editing,
  index,
  count,
  colors,
  onMove,
  onSendBelow,
  onRemove,
  onEdit,
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
  onSendBelow?: () => void;
  onRemove?: () => void;
  onEdit?: () => void;
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
          {onEdit ? (
            <Pressable accessibilityLabel="Edit challenge" onPress={onEdit} style={styles.pinAction} hitSlop={6}>
              <Ionicons name="create-outline" size={15} color={colors.muted} />
            </Pressable>
          ) : null}
          {index < count - 1 && onSendBelow ? (
            <Pressable accessibilityLabel="Send card below" onPress={onSendBelow} style={styles.pinAction} hitSlop={6}>
              <Ionicons name="arrow-down" size={15} color={colors.muted} />
            </Pressable>
          ) : null}
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
          {onRemove ? (
            <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
              <Ionicons name="remove" size={16} color={palette.white} />
            </Pressable>
          ) : null}
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
  pagedCardStack: { gap: 6 },
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
  gridEditControls: { padding: 8, marginBottom: 6 },
  gridEditLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  gridRangeChoices: { flex: 1, flexDirection: "row", gap: 5 },
  gridRangeChoice: { minHeight: 30, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  gridRangeChoiceText: { fontSize: 8, fontWeight: "900" },
  gridDisclosureActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  gridDisclosureAction: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4 },
  gridDisclosureText: { fontSize: 7, fontWeight: "900" },
  gridEditHint: { fontSize: 7, lineHeight: 10, marginTop: 5 },
  ranking: { padding: 7 },
  challengeCard: { overflow: "hidden" },
  challengeHead: { flexDirection: "row", alignItems: "center", gap: 9, padding: 5, paddingBottom: 8 },
  challengeMark: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  challengeHeadingCopy: { flex: 1, minWidth: 0 },
  challengeEyebrowLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  challengeMeta: { fontSize: 8, lineHeight: 11, marginTop: 2, fontWeight: "700" },
  completePill: { minWidth: 43, height: 31, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  completePillText: { fontSize: 10, fontWeight: "900" },
  challengeInvite: { minHeight: 51, paddingHorizontal: 7, paddingVertical: 7, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  challengeInviteCopy: { flex: 1, minWidth: 0 },
  challengeResponse: { minHeight: 31, borderRadius: 10, borderWidth: 1, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  challengeResponseText: { fontSize: 8, fontWeight: "900" },
  challengeRow: { minHeight: 48, paddingHorizontal: 5, paddingVertical: 7, borderTopWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  challengeRank: { width: 23, fontSize: 10, fontWeight: "900" },
  challengeMemberCopy: { flex: 1, minWidth: 0 },
  challengeValue: { fontSize: 8, lineHeight: 11, marginTop: 2 },
  challengeProgress: { width: 105, gap: 3 },
  challengeProgressLabel: { minHeight: 15, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 },
  challengePercent: { fontSize: 9, fontWeight: "900", textAlign: "right" },
  challengeMore: { paddingVertical: 7, textAlign: "center", fontSize: 8, fontWeight: "800" },
  challengeUnavailable: { minHeight: 42, borderTopWidth: 1, alignItems: "center", justifyContent: "center" },
  challengeRetry: { minHeight: 42, marginVertical: 6, paddingHorizontal: 11, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 7 },
  challengeRetryText: { flex: 1, fontSize: 9, fontWeight: "800" },
  challengeCelebrationBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22, backgroundColor: "rgba(5,14,36,0.72)" },
  challengeConfetti: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  challengeConfettiPiece: { position: "absolute", top: 0, width: 9, height: 16, borderRadius: 3 },
  challengeCelebrationCard: { width: "100%", maxWidth: 390, minHeight: 245, borderRadius: 26, borderWidth: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  challengeCelebrationIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  challengeCelebrationEyebrow: { fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  challengeCelebrationTitle: { marginTop: 7, fontSize: 20, lineHeight: 25, fontWeight: "900", textAlign: "center" },
  challengeCelebrationDetail: { marginTop: 7, fontSize: 11, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  challengeCelebrationClose: { marginTop: 18, fontSize: 8, fontWeight: "800" },
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
  memberGridBlock: { overflow: "hidden" },
  gridToggle: { width: 22, minHeight: 34, alignItems: "center", justifyContent: "center" },
  memberGrid: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 7, paddingTop: 5, paddingBottom: 8 },
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
