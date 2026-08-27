import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import {
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  findNodeHandle,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  adjacentPeriod,
  DateRangeNavigator,
  PeriodChoiceBar,
} from "@/src/components/PeriodNavigator";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import {
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
  relativeTime,
} from "@/src/domain/date";
import {
  allTimePeriodDates,
  leaderboardRows,
  LeaderboardPeriod,
  periodAverageGoalReached,
  PeriodMetricResult,
  periodDates,
  periodTitle,
  shiftedPeriodAnchor,
} from "@/src/domain/leaderboard";
import { latestMemberActivityPublishedAt } from "@/src/domain/leaderboardSync";
import { FOOD_NUTRIENTS } from "@/src/domain/food";
import {
  memberDisplayName,
  memberRoleLabel,
} from "@/src/domain/members";
import { imageSourceUri } from "@/src/domain/media";
import {
  deficitAlignmentBand,
  deficitRealityCheckAtDate,
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  metricVisualProgress,
} from "@/src/domain/metrics";
import {
  sharedLeaderboardLogEntries,
  sharedWorkoutBreakdownEntries,
} from "@/src/domain/sharedLeaderboardLogs";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { GroupSocialTarget } from "@/src/cloud/groupSocial";
import { useGroupSocialEngagement } from "@/src/cloud/useGroupSocialEngagement";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { AppState, MetricEntry, PhotoUpdate } from "@/src/types";

const SCORE_ID = "__score";

export default function LeaderboardDetail() {
  const params = useLocalSearchParams<{
    period?: string;
    anchor?: string;
    metrics?: string;
    memberId?: string;
    entryId?: string;
    logFocusAt?: string;
  }>();
  const { state, updateSettings } = useApp();
  const cloud = useCloudSyncActions();
  const tutorialSandbox = useTutorialSandboxActive();
  const { language, t } = useLocalization();
  const calculationStateRef = useRef(state);
  calculationStateRef.current = state;
  const colors = useAppColors();
  const accent = useGroupAccent();
  const scrollRef = useRef<ScrollView>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>(
    (params.period as LeaderboardPeriod) || "today",
  );
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const dateNavigatorOpen =
    state.settings.leaderboardDetailDateNavigatorCollapsed === false;
  const [showCalendar, setShowCalendar] = useState(false);
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const [detailsReady, setDetailsReady] = useState(false);
  // In-memory rows have already passed the account, membership, revision and
  // privacy-fence checks in CloudSyncProvider. Paint them immediately while a
  // forced range refresh verifies changes instead of flashing a daily total.
  const [peerDetailsAuthorized, setPeerDetailsAuthorized] = useState(true);
  const [detailsRefreshFailed, setDetailsRefreshFailed] = useState(false);
  const [detailsRefreshAttempt, setDetailsRefreshAttempt] = useState(0);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string>();
  const handledLogFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    // Paint the route shell first, then calculate details on the next task.
    // Waiting on React Native's global interaction queue can starve forever
    // behind an unrelated native animation and make this page look blank.
    const task = setTimeout(() => {
      if (active) setDetailsReady(true);
    }, 0);
    return () => {
      active = false;
      clearTimeout(task);
    };
  }, []);
  const dates = useMemo(
    () =>
      period === "overall"
        ? allTimePeriodDates(state, anchor)
        : periodDates(period, anchor, state.settings.weekStartsOn ?? 1),
    [anchor, period, state],
  );
  // The main Leaderboard hydrates compact all-time statuses. Detail requests
  // then use the earliest real date represented by those statuses so raw item
  // pagination never starts at an artificial 2000 sentinel.
  const targetedActivitySince = dates[0];
  useEffect(() => {
    if (
      !detailsReady ||
      !targetedActivitySince
    )
      return;
    if (tutorialSandbox || !isCloudGroupId(state.group.id)) {
      setPeerDetailsAuthorized(true);
      return;
    }
    let active = true;
    setDetailsRefreshFailed(false);
    const timer = setTimeout(() => {
      cloud
        // Google Health item rows deliberately stay out of plaintext device
        // caches. Rehydrate this explicit detail range even when its compact
        // activity version and coverage were restored after an app restart.
        .refreshActivity(targetedActivitySince, { force: true })
        .then(() => {
          if (active) setPeerDetailsAuthorized(true);
        })
        .catch(() => {
          if (active) setDetailsRefreshFailed(true);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    cloud,
    detailsReady,
    detailsRefreshAttempt,
    state.group.id,
    targetedActivitySince,
    tutorialSandbox,
  ]);
  const visibleEntries = useMemo(() => {
    if (!detailsReady) return [];
    return sharedLeaderboardLogEntries({
      currentUserId: state.currentUserId,
      dates,
      entries: state.entries,
      groupId: state.group.id,
      peerDetailsAuthorized,
      statuses: state.dailyMetricStatuses,
    });
  }, [
    dates,
    detailsReady,
    state.currentUserId,
    state.dailyMetricStatuses,
    state.entries,
    state.group.id,
    peerDetailsAuthorized,
  ]);
  const loggedIds = useMemo(
    () => [...new Set(visibleEntries.map((entry) => entry.metricId))],
    [visibleEntries],
  );
  const socialTargets = useMemo<GroupSocialTarget[]>(
    () =>
      visibleEntries
        .filter(
          (entry) =>
            entry.source !== "calculated" &&
            !entry.id.startsWith("shared-total:"),
        )
        .map((entry) => ({ type: "metric_entry", id: entry.id })),
    [visibleEntries],
  );
  const social = useGroupSocialEngagement(state.group.id, socialTargets);
  const available = useMemo(
    () =>
      (state.group.metricConfiguration ?? []).filter(
        (metric) => metric.sections.group && metric.dataType !== "photo",
      ),
    [state.group.metricConfiguration],
  );
  const requested = (params.metrics || "").split(",").filter(Boolean);
  const requestedAvailable = requested.filter(
    (id) =>
      id === SCORE_ID || available.some((metric) => metric.id === id),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    requestedAvailable.length
      ? requestedAvailable
      : loggedIds.length
        ? loggedIds
        : [SCORE_ID],
  );

  useEffect(() => {
    if (!params.entryId || !visibleEntries.length) return;
    const focusKey = `${params.entryId}:${params.logFocusAt ?? "initial"}`;
    if (handledLogFocus.current === focusKey) return;
    const entry = visibleEntries.find((item) => item.id === params.entryId);
    if (!entry) return;
    handledLogFocus.current = focusKey;
    setSelectedIds((current) =>
      current.includes(entry.metricId) ? current : [entry.metricId],
    );
    setOpenLogs((current) => ({ ...current, [entry.userId]: true }));
    setHighlightedEntryId(entry.id);
    const timer = setTimeout(() => setHighlightedEntryId(undefined), 4_000);
    return () => clearTimeout(timer);
  }, [params.entryId, params.logFocusAt, visibleEntries]);

  const availableKey = available.map((metric) => metric.id).join("|");
  useEffect(() => {
    const currentAvailable = availableKey.split("|").filter(Boolean);
    setSelectedIds((current) => {
      const valid = current.filter(
        (id) => id === SCORE_ID || currentAvailable.includes(id),
      );
      return valid.length
        ? valid
        : currentAvailable.length
          ? currentAvailable
          : [SCORE_ID];
    });
  }, [availableKey]);

  const metrics = useMemo(
    () => available.filter((metric) => selectedIds.includes(metric.id)),
    [available, selectedIds],
  );
  const rankingMetrics = useMemo(
    () => metrics.filter((metric) => metric.dataType !== "text"),
    [metrics],
  );
  const includeScore = selectedIds.includes(SCORE_ID);
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
  const rows = useMemo(
    () => {
      void rankingInputs;
      const calculationState = calculationStateRef.current;
      return detailsReady
        ? leaderboardRows(
            calculationState,
            rankingMetrics,
            dates,
            calculationState.currentUserId,
            includeScore,
          )
        : [];
    },
    [
      dates,
      detailsReady,
      includeScore,
      rankingMetrics,
      rankingInputs,
    ],
  );
  const options = useMemo(
    () => [
      {
        id: SCORE_ID,
        label: "Overall score",
        icon: "speedometer-outline" as const,
        color: palette.purple,
      },
      ...available.map((metric) => ({
        id: metric.id,
        label: metric.name,
        icon: metric.icon as keyof typeof Ionicons.glyphMap,
        color: metric.color,
      })),
    ],
    [available],
  );
  const entriesByMember = useMemo(() => {
    const selected = new Set(metrics.map((metric) => metric.id));
    const grouped = new Map<string, MetricEntry[]>();
    visibleEntries.forEach((entry) => {
      if (!selected.has(entry.metricId)) return;
      const entries = grouped.get(entry.userId) ?? [];
      entries.push(entry);
      grouped.set(entry.userId, entries);
    });
    return grouped;
  }, [metrics, visibleEntries]);
  const authorizedEntriesByMember = useMemo(() => {
    const grouped = new Map<string, MetricEntry[]>();
    visibleEntries.forEach((entry) => {
      const entries = grouped.get(entry.userId) ?? [];
      entries.push(entry);
      grouped.set(entry.userId, entries);
    });
    return grouped;
  }, [visibleEntries]);

  function setRange(next: LeaderboardPeriod) {
    setPeriod(next);
    if (
      next === "today" ||
      next === "week" ||
      next === "month" ||
      next === "year" ||
      next === "overall"
    )
      setAnchor(dateKey());
    if (next === "yesterday")
      setAnchor(dateWithOffsetFrom(dateKey(), -1));
    setShowCalendar(false);
  }
  function shift(direction: -1 | 1) {
    const next = shiftedPeriodAnchor(period, anchor, direction);
    if (!next) return;
    if (period === "today" || period === "yesterday") setPeriod("custom");
    setAnchor(next);
  }
  function toggleDateNavigator() {
    if (dateNavigatorOpen) setShowCalendar(false);
    updateSettings({
      leaderboardDetailDateNavigatorCollapsed: dateNavigatorOpen,
    });
  }
  const pageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          !showCalendar &&
          Math.abs(gesture.dx) > 22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const next = adjacentPeriod(
            period,
            gesture.dx < 0 ? 1 : -1,
          );
          if (next) setRange(next);
        },
      }),
    [period, showCalendar],
  );

  return (
    <Screen scrollRef={scrollRef}>
      <PageHeader
        eyebrow="Leaderboard details"
        title={periodTitle(period, anchor)}
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <View {...pageSwipeResponder.panHandlers}>
        <PeriodChoiceBar
          period={period}
          onChange={setRange}
          dateViewOpen={dateNavigatorOpen}
          onToggleDateView={toggleDateNavigator}
        />
        {period !== "overall" && dateNavigatorOpen ? (
          <DateRangeNavigator
            period={period}
            anchor={anchor}
            dates={dates}
            calendarOpen={showCalendar}
            onToggleCalendar={() => setShowCalendar((value) => !value)}
            onShift={shift}
          >
            <MonthCalendar
                monthDate={anchor}
                selectedDate={anchor}
                onSelect={(date) => {
                  setAnchor(date);
                  setPeriod("custom");
                  setShowCalendar(false);
                }}
                dayVisuals={(localDate) => {
                  if (!rankingMetrics.length) return [];
                  const dayRows = leaderboardRows(
                    state,
                    rankingMetrics,
                    [localDate],
                    state.currentUserId,
                    false,
                  );
                  return rankingMetrics.map((metric) => {
                    const results = dayRows
                      .map((row) =>
                        row.metrics.find(
                          (item) => item.metric.id === metric.id,
                        )?.result,
                      )
                      .filter(
                        (result): result is PeriodMetricResult =>
                          Boolean(result && result.mode !== "private"),
                      );
                    const progress = results.length
                      ? results.reduce(
                          (sum, result) =>
                            sum +
                            (result.averageDisplayProgress ??
                              result.averageGoalProgress ??
                              0),
                          0,
                        ) / results.length
                      : 0;
                    return {
                      color: metric.color,
                      progress,
                      goalReached:
                        results.length > 0 &&
                        results.every(
                          (result) =>
                            result.visibleDays > 0 &&
                            result.completedDays >= result.visibleDays,
                        ),
                    };
                  });
                }}
                allTrackedGoalsMet={(localDate) => {
                  if (!rankingMetrics.length) return false;
                  const dayRows = leaderboardRows(
                    state,
                    rankingMetrics,
                    [localDate],
                    state.currentUserId,
                    false,
                  );
                  const results = dayRows.flatMap((row) =>
                    row.metrics.map((item) => item.result),
                  );
                  return (
                    results.some((result) => result.mode !== "private") &&
                    results
                      .filter((result) => result.mode !== "private")
                      .every(
                        (result) =>
                          result.visibleDays > 0 &&
                          result.completedDays >= result.visibleDays,
                      )
                  );
                }}
              />
          </DateRangeNavigator>
        ) : null}
      {false ? (
        <View style={styles.range}>
          <Ionicons name="calendar-outline" size={15} color={accent} />
          <Text style={styles.rangeText}>
            {dates[0]} → {dates[dates.length - 1]} · {dates.length} day
            {dates.length === 1 ? "" : "s"}
          </Text>
        </View>
      ) : null}
      <View style={styles.members}>
        {!detailsReady ? (
          <Card style={styles.loadingCard}>
            <Text style={[styles.metricSub, { color: colors.muted }]}>
              Loading saved leaderboard details…
            </Text>
          </Card>
        ) : null}
        {detailsRefreshFailed ? (
          <Card style={styles.detailRefreshCard}>
            <Text style={[styles.metricSub, { color: colors.muted }]}>
              Could not refresh individual logs. Daily totals are still shown.
            </Text>
            <Button
              label="Retry individual logs"
              icon="refresh-outline"
              size="small"
              variant="ghost"
              onPress={() => setDetailsRefreshAttempt((attempt) => attempt + 1)}
            />
          </Card>
        ) : null}
        {rows.map((row, index) => {
          const memberSyncedAt = latestMemberActivityPublishedAt(
            state.dailyMetricStatuses,
            state.group.id,
            row.member.id,
            row.member.lastDataSyncedAt,
          );
          const entries = entriesByMember.get(row.member.id) ?? [];
          const authorizedEntries =
            authorizedEntriesByMember.get(row.member.id) ?? [];
          const expanded = Boolean(openLogs[row.member.id]);
          const weightDay =
            dates.length === 1 &&
            entries.some((entry) => entry.metricId === "weight");
          const alignment = weightDay
            ? deficitRealityCheckAtDate(state, row.member.id, dates[0])
            : undefined;
          const alignmentBand = alignment
            ? deficitAlignmentBand(alignment)
            : "neutral";
          const alignmentColor =
            alignmentBand === "close"
              ? palette.lime
              : alignmentBand === "warning"
                ? palette.amber
                : alignmentBand === "far"
                  ? palette.red
                  : accent;
          return (
            <TutorialTarget
              key={row.member.id}
              id={
                index === 0
                  ? "leaderboard-detail-chart"
                  : `leaderboard-detail-member-${row.member.id}`
              }
            >
            <Card style={styles.memberCard}>
              <View style={styles.heading}>
                <Text
                  style={[
                    styles.rank,
                    { color: colors.faint },
                    index < 3 && styles.podium,
                  ]}
                >
                  #{index + 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("Compare with")} ${memberDisplayName(state, row.member)}`}
                  onPress={() =>
                    router.navigate({
                      pathname: "/member/[id]",
                      params: {
                        id: row.member.id,
                        period,
                        anchor,
                        metrics: selectedIds.join(","),
                      },
                    } as never)
                  }
                  style={styles.memberAvatarLink}
                >
                  <Avatar
                    initials={row.member.initials}
                    color={row.member.color}
                    uri={row.member.avatarUri}
                    size={44}
                  />
                </Pressable>
                <View style={styles.copy}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("Compare with")} ${memberDisplayName(state, row.member)}`}
                    onPress={() =>
                      router.navigate({
                        pathname: "/member/[id]",
                        params: {
                          id: row.member.id,
                          period,
                          anchor,
                          metrics: selectedIds.join(","),
                        },
                      } as never)
                    }
                    style={styles.memberNameLink}
                  >
                    <Text style={[styles.name, { color: colors.ink }]}>
                      <Text translate={false}>{memberDisplayName(state, row.member)}</Text>
                      {row.member.id === state.currentUserId ? " · You" : ""}
                    </Text>
                  </Pressable>
                  <Text style={[styles.role, { color: colors.muted }]}>
                    {memberRoleLabel(row.member)}
                  </Text>
                  {memberSyncedAt ? (
                    <Text style={[styles.role, { color: colors.muted }]}>
                      Synced {relativeTime(memberSyncedAt)}
                    </Text>
                  ) : null}
                </View>
                {includeScore ? (
                  <View>
                    <Text style={[styles.score, { color: colors.ink }]}>
                      {Math.round(row.score)}
                    </Text>
                    <Text style={[styles.scoreLabel, { color: colors.faint }]}>score</Text>
                  </View>
                ) : null}
              </View>
              {includeScore ? (
                <ProgressBar
                  progress={row.score / 100}
                  color={row.member.color}
                />
              ) : null}
              <View style={styles.metricList}>
                {row.metrics.map(({ metric, result }) => {
                  const personalMetric =
                    row.member.id === state.currentUserId
                      ? (state.metrics.find((item) => item.id === metric.id) ??
                        metric)
                      : metric;
                  const progress =
                    result.averageDisplayProgress ??
                    (row.member.id === state.currentUserId &&
                    result.mode === "exact" &&
                    result.visibleDays > 0
                      ? personalMetric.goalProgressMode === "journey"
                        ? metricVisualProgress(
                            state,
                            personalMetric,
                            row.member.id,
                            anchor,
                            result.average,
                          )
                        : displayGoalProgress(
                            personalMetric,
                            result.average,
                            effectiveGoalTarget(
                              state,
                              personalMetric,
                              row.member.id,
                              anchor,
                            ),
                          )
                      : undefined);
                  const progressCopy = personalGoalProgressCopy(
                    result,
                    progress,
                  );
                  const progressColor = periodAverageGoalReached(result)
                    ? palette.lime
                    : palette.red;
                  return (
                  <View
                    key={metric.id}
                    style={[styles.metric, { borderBottomColor: colors.border }]}
                  >
                    <View
                      style={[
                        styles.metricIcon,
                        { backgroundColor: `${metric.color}18` },
                      ]}
                    >
                      <Ionicons
                        name={metric.icon as keyof typeof Ionicons.glyphMap}
                        size={17}
                        color={metric.color}
                      />
                    </View>
                    <View style={styles.copy}>
                      <Text translate={false} style={[styles.metricName, { color: colors.ink }]}>
                        {localizeMetricName(language, metric)}
                      </Text>
                      <Text style={[styles.metricSub, { color: colors.muted }]}>
                        {result.averageLabel ??
                          `${result.visibleDays} visible day${result.visibleDays === 1 ? "" : "s"}`}
                      </Text>
                      {result.label !== "Private" ? (
                        <Text style={[styles.metricSub, { color: colors.muted }]}>
                          {result.streak ?? 0}d · Best streak{" "}
                          {result.bestStreak ?? 0}d
                        </Text>
                      ) : null}
                      {progressCopy && progress !== undefined ? (
                        <View style={styles.metricGoal}>
                          <Text
                            style={[
                              styles.metricGoalText,
                              { color: colors.muted },
                            ]}
                          >
                            {progressCopy}
                          </Text>
                          <ProgressBar
                            progress={progress}
                            color={progressColor}
                            layered={result.personalGoalKind === "at_least"}
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.metricValue,
                        { color: accent },
                        result.mode === "private" && {
                          color: colors.faint,
                          fontStyle: "italic",
                        },
                      ]}
                    >
                      {result.label}
                    </Text>
                  </View>
                  );
                })}
              </View>
              {alignment && alignment.status !== "insufficient" ? (
                <View
                  style={[
                    styles.alignment,
                    { backgroundColor: `${alignmentColor}18` },
                  ]}
                >
                  <Ionicons
                    name={
                      alignment.status === "aligned"
                        ? "checkmark-circle"
                        : "analytics-outline"
                    }
                    size={20}
                    color={alignmentColor}
                  />
                  <View style={styles.copy}>
                    <Text style={[styles.logValue, { color: colors.ink }]}>Reporting alignment</Text>
                    <Text style={[styles.note, { color: colors.muted }]}>
                      {alignment.status === "aligned"
                        ? "Scale change roughly matches the reported deficit."
                        : `Logged energy balance ${Math.round(alignment.reportedDailyDeficit)} vs scale-implied ${Math.round(alignment.actualDailyDeficit)} kcal/day (positive follows the member's deficit/surplus plan).`}
                    </Text>
                  </View>
                </View>
              ) : null}
              {entries.length ? (
                <View style={styles.logs}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() =>
                      setOpenLogs((current) => ({
                        ...current,
                        [row.member.id]: !expanded,
                      }))
                    }
                    style={styles.logToggle}
                  >
                    <Text style={[styles.blockTitle, { color: colors.faint }]}>
                      SHARED LOGS · {entries.length}
                    </Text>
                    <Text style={[styles.logHint, { color: accent }]}>
                      {expanded ? "Hide" : "Show"}
                    </Text>
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={accent}
                    />
                  </Pressable>
                  {expanded
                    ? entries
                        .sort((a, b) =>
                          b.recordedAt.localeCompare(a.recordedAt),
                        )
                        .map((entry) => (
                          <LogRow
                            key={`${entry.userId}:${entry.id}`}
                            entry={entry}
                            state={state}
                            workoutBreakdown={sharedWorkoutBreakdownEntries(
                              entry,
                              authorizedEntries,
                            )}
                            social={social}
                            highlighted={highlightedEntryId === entry.id}
                            scrollRef={scrollRef}
                          />
                        ))
                    : null}
                </View>
              ) : null}
              <PhotoCompare
                state={state}
                memberId={row.member.id}
                dates={dates}
              />
            </Card>
            </TutorialTarget>
          );
        })}
      </View>
      <View style={styles.whatToShow}>
        <MetricSelector
          title="What to show"
          items={options}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          emptyLabel="No shared logs in this range"
        />
      </View>
      </View>
    </Screen>
  );
}

function personalGoalProgressCopy(
  result: PeriodMetricResult,
  progress = result.averageDisplayProgress,
) {
  if (result.mode === "private" || progress === undefined)
    return undefined;
  const percent = Math.round(progress * 100);
  if (result.personalGoalKind === "at_most")
    return percent <= 100
      ? `${percent}% allowance used · ${100 - percent}% remaining`
      : `${percent - 100}% over personal allowance`;
  if (percent < 100)
    return `${percent}% toward personal goal · ${100 - percent}% remaining`;
  if (percent === 100) return "Personal goal reached";
  return `${percent - 100}% beyond personal goal`;
}

function LogRow({
  entry,
  state,
  workoutBreakdown,
  social,
  highlighted,
  scrollRef,
}: {
  entry: MetricEntry;
  state: AppState;
  workoutBreakdown: MetricEntry[];
  social: ReturnType<typeof useGroupSocialEngagement>;
  highlighted: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const colors = useAppColors();
  const { language } = useLocalization();
  const rowRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const lastTapAt = useRef(0);
  const metric =
    (state.group.metricConfiguration ?? []).find(
      (item) => item.id === entry.metricId,
    ) ?? state.metrics.find((item) => item.id === entry.metricId);
  const socialTarget = useMemo<GroupSocialTarget | undefined>(
    () =>
      entry.source === "calculated" || entry.id.startsWith("shared-total:")
        ? undefined
        : { type: "metric_entry", id: entry.id },
    [entry.id, entry.source],
  );
  const targetKey = socialTarget ? social.targetKey(socialTarget) : undefined;
  const reactions = targetKey
    ? social.reactionsByTarget.get(targetKey) ?? []
    : [];
  const react = (reaction: "heart" | "thumbs_up" | "thumbs_down") => {
    if (!socialTarget) return;
    void social.react(socialTarget, reaction).catch((reason) =>
      Alert.alert(
        "Could not react",
        reason instanceof Error ? reason.message : "Please try again.",
      ),
    );
  };
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => {
      if (!rowRef.current || !scrollRef.current) return;
      const scrollHandle = findNodeHandle(scrollRef.current);
      if (!scrollHandle) return;
      rowRef.current.measureLayout(
        scrollHandle,
        (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 110), animated: true }),
        () => undefined,
      );
    }, 180);
    return () => clearTimeout(timer);
  }, [highlighted, scrollRef]);
  if (!metric) return null;
  const value =
    typeof entry.value === "string"
      ? entry.value
      : formatMetricValue(
          metric,
          entry.value === true
            ? 1
            : entry.value === false
              ? 0
              : Number(entry.value),
        );
  const workoutDetails = workoutBreakdown.flatMap((detail) => {
    const detailMetric =
      (state.group.metricConfiguration ?? []).find(
        (item) => item.id === detail.metricId,
      ) ?? state.metrics.find((item) => item.id === detail.metricId);
    const amount = Number(detail.value);
    if (!Number.isFinite(amount) || !detailMetric) return [];
    return [
      `${localizeMetricName(language, detailMetric)} ${formatMetricValue(detailMetric, amount)}`,
    ];
  });
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole={socialTarget ? "button" : undefined}
      accessibilityLabel={socialTarget ? "Double tap to like this shared log" : undefined}
      onPress={
        socialTarget
          ? () => {
              const now = Date.now();
              if (now - lastTapAt.current <= 320) react("heart");
              lastTapAt.current = now;
            }
          : undefined
      }
      style={[
        styles.log,
        { borderLeftColor: metric.color, backgroundColor: `${metric.color}0D` },
        highlighted && styles.highlightedLog,
      ]}
    >
      <View style={styles.logBody}>
        <View style={styles.logMetric}>
          <Ionicons
            name={metric.icon as keyof typeof Ionicons.glyphMap}
            size={13}
            color={metric.color}
          />
          <Text translate={false} style={[styles.logMetricText, { color: metric.color }]}>
            {localizeMetricName(language, metric)}
          </Text>
        </View>
        <View style={styles.logTop}>
          <Text style={[styles.logValue, { color: colors.ink }]}>
            {value}
            {entry.label
              ? ` · ${entry.nutrition?.mealType ? `${entry.nutrition.mealType[0].toUpperCase()}${entry.nutrition.mealType.slice(1)} · ` : ""}${entry.label}`
              : ""}
          </Text>
          <Text style={[styles.logDate, { color: colors.faint }]}>
            {friendlyDate(entry.localDate)}
          </Text>
        </View>
        {entry.note ? (
          <Text translate={false} style={[styles.note, { color: colors.muted }]}>{entry.note}</Text>
        ) : null}
        {entry.nutrition ? (
          <Text style={[styles.nutrition, { color: colors.primary }]}>
            {FOOD_NUTRIENTS
              .flatMap((nutrient) => {
                const amount = entry.nutrition?.[nutrient.nutritionKey];
                return typeof amount === "number" && amount > 0
                  ? [
                      `${nutrient.label} ${Math.round(amount * 10) / 10}${nutrient.unit}`,
                    ]
                  : [];
              })
              .join(" · ")}
          </Text>
        ) : null}
        {workoutDetails.length ? (
          <Text translate={false} style={[styles.nutrition, { color: colors.primary }]}>
            {workoutDetails.join(" · ")}
          </Text>
        ) : null}
        {socialTarget ? (
          <View style={styles.socialActions}>
            {(
              [
                ["thumbs_up", "thumbs-up-outline"],
                ["thumbs_down", "thumbs-down-outline"],
                ["heart", "heart-outline"],
              ] as const
            ).map(([reaction, icon]) => {
              const selected = reactions.some(
                (item) =>
                  item.userId === state.currentUserId &&
                  item.reaction === reaction,
              );
              const count = reactions.filter(
                (item) => item.reaction === reaction,
              ).length;
              return (
                <Pressable
                  key={reaction}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${reaction.replaceAll("_", " ")}${count ? `, ${count}` : ""}`}
                  onPress={() => react(reaction)}
                  style={[
                    styles.socialAction,
                    {
                      borderColor: selected ? metric.color : colors.border,
                      backgroundColor: selected ? `${metric.color}18` : colors.card,
                    },
                  ]}
                >
                  <Ionicons
                    name={selected && reaction === "heart" ? "heart" : icon}
                    size={14}
                    color={selected ? metric.color : colors.muted}
                  />
                  {count ? (
                    <Text translate={false} style={[styles.socialCount, { color: selected ? metric.color : colors.muted }]}>
                      {count}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      {entry.imageUri ? (
        <ExpandableImage
          uri={entry.imageUri}
          thumbnailStyle={styles.logImage}
        />
      ) : null}
    </Pressable>
  );
}

function PhotoCompare({
  state,
  memberId,
  dates,
}: {
  state: AppState;
  memberId: string;
  dates: string[];
}) {
  const tutorialSandbox = useTutorialSandboxActive();
  const accent = useGroupAccent();
  const colors = useAppColors();
  const visible = useMemo(
    () =>
      state.photos
        .filter(
          (photo) =>
            photo.userId === memberId &&
            (memberId === state.currentUserId ||
              photo.visibility === "group"),
        )
        .sort((a, b) => b.localDate.localeCompare(a.localDate)),
    [memberId, state.currentUserId, state.photos],
  );
  const primary = visible.find((photo) => dates.includes(photo.localDate));
  const olderDates = [
    ...new Set(
      visible
        .filter((photo) => primary && photo.localDate < primary.localDate)
        .map((photo) => photo.localDate),
    ),
  ]
    .sort()
    .reverse();
  const primaryDate = primary?.localDate ?? "";
  const defaultOlderDate = olderDates[0] ?? "";
  const [compareDate, setCompareDate] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const collageRef = useRef<ViewShot>(null);
  const Share = {
    share: async (_options: { message: string }) => {
      if (tutorialSandbox) return;
      const uri = await collageRef.current?.capture?.();
      if (!uri) throw new Error("Could not create comparison image.");
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Save or share progress comparison",
      });
    },
  };
  useEffect(
    () => setCompareDate(defaultOlderDate ? [defaultOlderDate] : []),
    [memberId, primaryDate, defaultOlderDate],
  );
  const comparison = visible.find(
    (photo) => photo.localDate === compareDate[0],
  );
  if (!primary) return null;

  function weight(day: string) {
    const entry = state.entries
      .filter((item) => item.userId === memberId && item.metricId === "weight")
      .sort(
        (a, b) =>
          Math.abs(
            new Date(`${a.localDate}T12:00:00`).getTime() -
              new Date(`${day}T12:00:00`).getTime(),
          ) -
          Math.abs(
            new Date(`${b.localDate}T12:00:00`).getTime() -
              new Date(`${day}T12:00:00`).getTime(),
          ),
      )[0];
    return entry
      ? `${Number(entry.value).toFixed(1)} kg${entry.localDate === day ? "" : " nearby"}`
      : "No weight log";
  }

  async function save() {
    if (tutorialSandbox) return;
    const photos = [primary, comparison].filter(Boolean) as PhotoUpdate[];
    if (photos.length < 2) return;
    if (Platform.OS !== "web") {
      await Share.share({
        message: `HabHub comparison\n${photos.map((photo) => `${photo.localDate} · ${weight(photo.localDate)}`).join("\n")}`,
      });
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#F5F7F2";
      context.fillRect(0, 0, 1200, 850);
      context.fillStyle = "#17211B";
      context.font = "bold 34px sans-serif";
      context.fillText("HabHub progress comparison", 45, 55);
      const images = await Promise.all(
        photos.map(
          (photo) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = document.createElement("img");
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error("Photo unavailable"));
              image.src = imageSourceUri(photo.uri);
            }),
        ),
      );
      images.forEach((image, index) => {
        const x = 45 + index * 565;
        context.drawImage(image, x, 90, 540, 620);
        context.textAlign = "center";
        context.fillStyle = "#17211B";
        context.font = "bold 23px sans-serif";
        context.fillText(photos[index].localDate, x + 270, 755);
        context.fillStyle = "#176B4D";
        context.font = "bold 18px sans-serif";
        context.fillText(weight(photos[index].localDate), x + 270, 790);
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `metric-rally-${memberId}-comparison.png`;
        link.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch (error) {
      Alert.alert(
        "Could not save collage",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  return (
    <View style={styles.photos}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.photoToggle}
      >
        <Text style={[styles.blockTitle, { color: colors.faint }]}>PROGRESS PHOTO</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={17}
          color={accent}
        />
      </Pressable>
      {open ? (
        <>
          <ViewShot
            ref={collageRef}
            options={{ format: "png", quality: 1 }}
            style={styles.capture}
          >
            <Text preserveColor style={styles.captureTitle}>
              HabHub progress comparison
            </Text>
            <View style={styles.photoGrid}>
              {[primary, comparison].filter(Boolean).map((photo) => (
                <View key={photo!.id} style={styles.photoItem}>
                  <ExpandableImage
                    uri={photo!.uri}
                    thumbnailStyle={styles.photo}
                  />
                  <Text preserveColor style={styles.photoDate}>
                    {photo!.localDate}
                  </Text>
                  <Text preserveColor style={styles.photoWeight}>
                    {weight(photo!.localDate)}
                  </Text>
                </View>
              ))}
            </View>
          </ViewShot>
          {olderDates.length ? (
            <MetricSelector
              title="Older comparison date"
              items={olderDates.map((day) => ({
                id: day,
                label: day,
                icon: "calendar-outline",
                sublabel: weight(day),
              }))}
              selectedIds={compareDate}
              onChange={setCompareDate}
              multiple={false}
            />
          ) : null}
          {comparison ? (
            <Button
              label={
                Platform.OS === "web"
                  ? "Download collage"
                  : "Save or share collage"
              }
              icon={
                Platform.OS === "web" ? "download-outline" : "share-outline"
              }
              variant="ghost"
              onPress={save}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photoToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 38,
  },
  capture: {
    backgroundColor: "#F5F7F2",
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
  captureTitle: {
    color: "#17211B",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 11 },
  navigator: { padding: 8, marginBottom: 10 },
  dateNav: { flexDirection: "row", alignItems: "center" },
  navCopy: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navDate: { flexDirection: "row", alignItems: "center", gap: 5 },
  navTitle: { fontSize: 12, fontWeight: "900" },
  navSub: { fontSize: 9, marginTop: 2 },
  calendar: { borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  range: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginVertical: 13,
  },
  rangeText: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  members: { gap: 11 },
  loadingCard: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  detailRefreshCard: {
    alignItems: "center",
    gap: 9,
    paddingVertical: 13,
  },
  whatToShow: { marginTop: 15, paddingTop: 2 },
  memberCard: { padding: 13 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 9,
  },
  rank: { width: 27, color: palette.faint, fontSize: 12, fontWeight: "900" },
  podium: { color: palette.amber, fontSize: 15 },
  memberAvatarLink: { borderRadius: 22 },
  memberNameLink: { alignSelf: "flex-start" },
  copy: { flex: 1 },
  name: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  role: { color: palette.muted, fontSize: 9, marginTop: 2 },
  score: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  scoreLabel: { color: palette.faint, fontSize: 8, textAlign: "center" },
  metricList: { marginTop: 9 },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  metricIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  metricName: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  metricSub: { color: palette.muted, fontSize: 8, marginTop: 2 },
  metricGoal: { gap: 4, marginTop: 5 },
  metricGoalText: { fontSize: 8, fontWeight: "700" },
  metricValue: { color: palette.primary, fontSize: 12, fontWeight: "900" },
  private: { color: palette.faint, fontStyle: "italic" },
  alignment: {
    flexDirection: "row",
    gap: 9,
    backgroundColor: palette.primarySoft,
    borderRadius: 13,
    padding: 10,
    marginTop: 10,
  },
  logs: { marginTop: 12 },
  logToggle: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  blockTitle: {
    flex: 1,
    color: palette.faint,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  logHint: {
    color: palette.primary,
    fontSize: 8,
    fontWeight: "900",
    marginRight: 5,
  },
  log: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 12,
    padding: 9,
    marginTop: 6,
    borderLeftWidth: 3,
  },
  highlightedLog: {
    borderColor: palette.amber,
    borderWidth: 2,
    borderLeftWidth: 4,
  },
  logBody: { flex: 1 },
  logMetric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  logMetricText: { fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  logTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  logValue: { flex: 1, color: palette.ink, fontSize: 11, fontWeight: "900" },
  logDate: { color: palette.faint, fontSize: 8 },
  note: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  nutrition: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 13,
    marginTop: 4,
  },
  socialActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  socialAction: {
    minWidth: 34,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  socialCount: { fontSize: 8, fontWeight: "900" },
  logImage: { width: 64, height: 64, borderRadius: 10 },
  photos: { marginTop: 14, gap: 8 },
  photoGrid: { flexDirection: "row", gap: 8 },
  photoItem: { flex: 1 },
  photo: { width: 145, height: 175, borderRadius: 13 },
  photoDate: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
  },
  photoWeight: {
    color: palette.primary,
    fontSize: 8,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 2,
  },
});
