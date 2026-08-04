import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import {
  InteractionManager,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import {
  LocalizedAlert as Alert,
  useLocale,
  useLocalization,
} from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";

import { MetricSelector } from "@/src/components/MetricSelector";
import { ExpandableImage } from "@/src/components/ExpandableImage";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  adjacentPeriod,
  DateRangeNavigator,
  PeriodChoiceBar,
} from "@/src/components/PeriodNavigator";
import {
  Avatar,
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { buildBadges } from "@/src/domain/badges";
import {
  comparisonStats,
  metricHeadToHeadStats,
} from "@/src/domain/comparison";
import {
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
  relativeTime,
} from "@/src/domain/date";
import {
  allTimePeriodDates,
  averageAtDate,
  LeaderboardPeriod,
  periodDates,
  periodMetricResult,
  periodTitle,
  shiftedPeriodAnchor,
} from "@/src/domain/leaderboard";
import { latestMemberActivityPublishedAt } from "@/src/domain/leaderboardSync";
import { imageSourceUri } from "@/src/domain/media";
import {
  memberDisplayName,
  memberOriginalLabel,
  memberRoleLabel,
} from "@/src/domain/members";
import {
  formatMetricValue,
  metricOverallAverage,
  metricVisualProgress,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors } from "@/src/theme";

export default function MemberProfile() {
  const params = useLocalSearchParams<{
    id: string;
    period?: string;
    anchor?: string;
    metrics?: string;
  }>();
  const { state, updateSettings } = useApp();
  const locale = useLocale();
  const { language } = useLocalization();
  const calculationStateRef = useRef(state);
  calculationStateRef.current = state;
  const colors = useAppColors();
  const member =
    state.group.members.find((item) => item.id === params.id) ??
    state.group.members[0];
  const memberSyncedAt = latestMemberActivityPublishedAt(
    state.dailyMetricStatuses,
    state.group.id,
    member.id,
    member.lastDataSyncedAt,
  );
  const groupMetricConfiguration = state.group.metricConfiguration;
  const available = useMemo(
    () =>
      (groupMetricConfiguration ?? []).filter(
        (metric) =>
          metric.dataType !== "text" &&
          metric.dataType !== "photo",
      ),
    [groupMetricConfiguration],
  );
  const paramIds = (params.metrics ?? "")
    .split(",")
    .filter((id) => id && id !== "__score");
  const initial = paramIds.filter((id) =>
    available.some((metric) => metric.id === id),
  );
  const savedMetricIds =
    state.settings.comparisonMetricIdsByGroup?.[state.group.id] ?? [];
  const [metricIds, setMetricIds] = useState<string[]>(
    initial.length
      ? initial
      : savedMetricIds.filter((id) =>
            available.some((metric) => metric.id === id),
          ).length
        ? savedMetricIds.filter((id) =>
            available.some((metric) => metric.id === id),
          )
        : ([available[0]?.id].filter(Boolean) as string[]),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    member.id === state.currentUserId
      ? [state.currentUserId]
      : [state.currentUserId, member.id],
  );
  const [period, setPeriod] = useState<LeaderboardPeriod>(
    (params.period as LeaderboardPeriod) ||
      state.settings.comparisonPeriodByGroup?.[state.group.id] ||
      "week",
  );
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const [photosOpen, setPhotosOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const comparisonReady = true;
  // Keep selector/date presses responsive. The previous comparison remains
  // visible while React prepares the newly requested range at low priority.
  const deferredMetricIds = useDeferredValue(metricIds);
  const deferredSelectedIds = useDeferredValue(selectedIds);
  const deferredPeriod = useDeferredValue(period);
  const deferredAnchor = useDeferredValue(anchor);
  const metrics = useMemo(
    () => available.filter((metric) => deferredMetricIds.includes(metric.id)),
    [available, deferredMetricIds],
  );
  const groupMembers = state.group.members;
  const groupMemberIds = useMemo(
    () => groupMembers.map((item) => item.id).join("|"),
    [groupMembers],
  );
  const people = useMemo(
    () =>
      deferredSelectedIds
        .map((id) => groupMembers.find((item) => item.id === id))
        .filter(Boolean) as typeof groupMembers,
    [deferredSelectedIds, groupMembers],
  );
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
      return deferredPeriod === "overall"
        ? allTimePeriodDates(
            calculationStateRef.current,
            deferredAnchor,
            deferredMetricIds,
            deferredSelectedIds,
          )
        : periodDates(
            deferredPeriod,
            deferredAnchor,
            weekStartsOn,
          );
    },
    [
      allTimeInputs,
      deferredAnchor,
      deferredMetricIds,
      deferredPeriod,
      deferredSelectedIds,
      weekStartsOn,
    ],
  );
  const navigationDates = useMemo(
    () => {
      void allTimeInputs;
      return period === "overall"
        ? allTimePeriodDates(
            calculationStateRef.current,
            anchor,
            metricIds,
            selectedIds,
          )
        : periodDates(period, anchor, weekStartsOn);
    },
    [
      allTimeInputs,
      anchor,
      metricIds,
      period,
      selectedIds,
      weekStartsOn,
    ],
  );
  const comparisonInputs = useMemo(
    () => ({
      statuses: state.dailyMetricStatuses,
      energyProfiles: state.energyProfiles,
      entries: state.entries,
      groupId: state.group.id,
      groupMemberIds,
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
      groupMemberIds,
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
  const badgeInputs = useMemo(
    () => ({
      groupId: state.group.id,
      groupMembers: state.group.members,
      groupMetrics: state.group.metricConfiguration,
      groupRestDays: state.group.streakRestDaysPerWeek,
      metrics: state.metrics,
      entries: state.entries,
      statuses: state.dailyMetricStatuses,
      trackedGoals: state.trackedGoalPeriods,
      energyProfiles: state.energyProfiles,
      gymSessions: state.gymSessions,
      photos: state.photos,
      energyProfile: state.settings.energyProfile,
      weightDirection: state.settings.weightDirection,
      baselineCalories: state.settings.baselineCalories,
      foodGoalMode: state.settings.foodGoalMode,
      vacationPeriods: state.settings.vacationPeriods,
      currentUserId: state.currentUserId,
    }),
    [
      state.group.id,
      state.group.members,
      state.group.metricConfiguration,
      state.group.streakRestDaysPerWeek,
      state.metrics,
      state.entries,
      state.dailyMetricStatuses,
      state.trackedGoalPeriods,
      state.energyProfiles,
      state.gymSessions,
      state.photos,
      state.settings.energyProfile,
      state.settings.weightDirection,
      state.settings.baselineCalories,
      state.settings.foodGoalMode,
      state.settings.vacationPeriods,
      state.currentUserId,
    ],
  );
  const [allBadges, setAllBadges] = useState<ReturnType<typeof buildBadges>>(
    [],
  );
  useEffect(() => {
    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void badgeInputs;
      const next = buildBadges(calculationStateRef.current, anchor);
      if (active) setAllBadges(next);
    });
    return () => {
      active = false;
      task.cancel();
    };
  }, [anchor, badgeInputs]);
  const resultCache = useMemo(() => {
    void comparisonInputs;
    const cache = new Map<
      string,
      {
        range: ReturnType<typeof periodMetricResult>;
        seven: ReturnType<typeof averageAtDate>;
        thirty: ReturnType<typeof averageAtDate>;
        overallLabel: string;
      }
    >();
    if (!comparisonReady) return cache;
    const calculationState = calculationStateRef.current;
    for (const metric of metrics)
      for (const person of people) {
        const key = `${metric.id}:${person.id}`;
        cache.set(key, {
          range: periodMetricResult(
            calculationState,
            metric,
            person.id,
            calculationState.currentUserId,
            dates,
          ),
          seven: averageAtDate(
            calculationState,
            metric,
            person.id,
            calculationState.currentUserId,
                  deferredAnchor,
            7,
          ),
          thirty: averageAtDate(
            calculationState,
            metric,
            person.id,
            calculationState.currentUserId,
                  deferredAnchor,
            30,
          ),
          overallLabel:
            person.id === calculationState.currentUserId
              ? formatMetricValue(
                  metric,
                  metricOverallAverage(
                    calculationState,
                    metric,
                    person.id,
                    deferredAnchor,
                  ),
                )
              : statValue(
                  periodMetricResult(
                    calculationState,
                    metric,
                    person.id,
                    calculationState.currentUserId,
                    allTimePeriodDates(
                      calculationState,
                      deferredAnchor,
                      [metric.id],
                      [person.id],
                    ),
                  ),
                  locale,
                ),
        });
      }
    return cache;
  }, [
    comparisonReady,
    dates,
    deferredAnchor,
    metrics,
    people,
    comparisonInputs,
    locale,
  ]);
  const stats = useMemo(
    () => {
      void comparisonInputs;
      const calculationState = calculationStateRef.current;
      return comparisonReady
        ? comparisonStats(
            calculationState,
            member.id,
            calculationState.currentUserId,
            dates,
            metrics.slice(0, 1),
          )
        : {
            bestDay: "—",
            bestScore: 0,
            daysWon: 0,
            longestWinStreak: 0,
            eligibleDays: 0,
          };
    },
    [
      comparisonReady,
      dates,
      member.id,
      metrics,
      comparisonInputs,
    ],
  );
  const headToHeads = useMemo(
    () => {
      void comparisonInputs;
      const calculationState = calculationStateRef.current;
      return comparisonReady
        ? metrics
            .map((metric) => ({
              metric,
              stats: metricHeadToHeadStats(
                calculationState,
                metric,
                member.id,
                calculationState.currentUserId,
                dates,
              ),
            }))
            .filter((item) => item.stats)
        : [];
    },
    [
      comparisonReady,
      dates,
      member.id,
      metrics,
      comparisonInputs,
    ],
  );
  const periodBadge =
    period === "week" ? "week" : period === "month" ? "month" : "today";
  const badges = useMemo(
    () =>
      allBadges.filter(
        (badge) =>
          badge.memberId === member.id && badge.period === periodBadge,
      ),
    [allBadges, member.id, periodBadge],
  );
  const badgeOptions = useMemo(
    () =>
      allBadges
        .filter((badge) => badge.memberId === member.id)
        .map((badge) => ({
          id: badge.id,
          label: badge.title,
          icon: badge.icon,
          color: badge.color,
          sublabel: badge.caption,
        })),
    [allBadges, member.id],
  );
  const showcase = state.settings.badgeShowcaseByGroup[state.group.id] ?? [];
  const displayedBadges = [...badges]
    .sort(
      (a, b) =>
        (showcase.includes(a.id) ? 0 : 1) - (showcase.includes(b.id) ? 0 : 1),
    )
    .slice(0, 5);
  function shift(days: number) {
    if (period === "overall") return;
    const next = dateWithOffsetFrom(anchor, days);
    if (next <= dateKey()) {
      if (period === "today" || period === "yesterday") setPeriod("custom");
      setAnchor(next);
    }
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
    if (next === "yesterday")
      setAnchor(dateWithOffsetFrom(dateKey(), -1));
    setCalendarOpen(false);
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
        // Do not capture child touches: selectors, date controls, and links
        // should receive their press immediately. The page only claims a
        // gesture after a deliberate horizontal drag.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !calendarOpen &&
          Math.abs(gesture.dx) > 22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const next = adjacentPeriod(
            period,
            gesture.dx < 0 ? 1 : -1,
          );
          if (next) choosePeriod(next);
        },
      }),
    [calendarOpen, period],
  );
  function chooseMetrics(ids: string[]) {
    setMetricIds(ids);
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      const savedPeriod =
        state.settings.comparisonPeriodByGroup?.[state.group.id];
      const savedMetrics =
        state.settings.comparisonMetricIdsByGroup?.[state.group.id] ?? [];
      if (
        savedPeriod === period &&
        savedMetrics.join(",") === metricIds.join(",")
      )
        return;
      updateSettings({
        comparisonPeriodByGroup: {
          ...state.settings.comparisonPeriodByGroup,
          [state.group.id]: period,
        },
        comparisonMetricIdsByGroup: {
          ...state.settings.comparisonMetricIdsByGroup,
          [state.group.id]: metricIds,
        },
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [
    metricIds,
    period,
    state.group.id,
    state.settings.comparisonMetricIdsByGroup,
    state.settings.comparisonPeriodByGroup,
    updateSettings,
  ]);
  return (
    <Screen>
      <PageHeader
        eyebrow="Friend comparison"
        title={
          member.id === state.currentUserId
            ? "Your progress"
            : memberDisplayName(state, member)
        }
        translateTitle={member.id === state.currentUserId}
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
      <Card style={styles.profile}>
        <Avatar
          initials={member.initials}
          color={member.color}
          uri={member.avatarUri}
          size={58}
        />
        <View style={styles.copy}>
          <Text translate={false} style={[styles.name, { color: colors.ink }]}>
            {memberDisplayName(state, member)}
          </Text>
          {memberOriginalLabel(state, member) ? (
            <Text style={[styles.original, { color: colors.faint }]}>
              {memberOriginalLabel(state, member)}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.muted }]}>
            {memberRoleLabel(member)} · <Text translate={false}>{state.group.name}</Text>
          </Text>
          {memberSyncedAt ? (
            <Text style={[styles.meta, { color: colors.muted }]}>
              Synced {relativeTime(memberSyncedAt)}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name="shield-checkmark-outline"
          size={22}
          color={colors.primary}
        />
      </Card>
      {false ? (
        <>
          <SectionHeader title="Date range" />
          <View style={styles.chips}>
            <Chip
              label="Today"
              selected={period === "today"}
              onPress={() => {
                choosePeriod("today");
                setAnchor(dateKey());
              }}
            />
            <Chip
              label="Yesterday"
              selected={period === "yesterday"}
              onPress={() => {
                choosePeriod("yesterday");
                setAnchor(dateWithOffsetFrom(dateKey(), -1));
              }}
            />
            <Chip
              label="7 days"
              selected={period === "week"}
              onPress={() => choosePeriod("week")}
            />
            <Chip
              label="Month"
              selected={period === "month"}
              onPress={() => choosePeriod("month")}
            />
          </View>
          <Card style={styles.navigator}>
            <IconButton
              icon="chevron-back"
              label="Previous"
              onPress={() =>
                shift(period === "week" ? -7 : period === "month" ? -30 : -1)
              }
            />
            <View style={styles.navCopy}>
              <Text style={[styles.navTitle, { color: colors.ink }]}>
                {periodTitle(period, anchor)}
              </Text>
              <Text style={[styles.navSub, { color: colors.muted }]}>
                {dates.length > 1
                  ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])}`
                  : friendlyDate(anchor)}
              </Text>
            </View>
            <IconButton
              icon="chevron-forward"
              label="Next"
              onPress={() =>
                shift(period === "week" ? 7 : period === "month" ? 30 : 1)
              }
            />
          </Card>
          <SectionHeader title="Comparison filters" />
          <View style={styles.selectors}>
            <MetricSelector
              title="What to show"
              items={available.map((metric) => ({
                id: metric.id,
                label: metric.name,
                icon: metric.icon as keyof typeof Ionicons.glyphMap,
                color: metric.color,
              }))}
              selectedIds={metricIds}
              onChange={chooseMetrics}
            />
            <MetricSelector
              title="People on chart"
              items={state.group.members.map((person) => ({
                id: person.id,
                label:
                  person.id === state.currentUserId
                    ? "You"
                    : memberDisplayName(state, person),
                icon: "person-outline",
                color: person.color,
              }))}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
            />
          </View>
        </>
      ) : null}
      {member.id === state.currentUserId ? (
        <>
          <SectionHeader title="Your competitive stats" />
          <View style={styles.comparisonStats}>
            <StatCard
              icon="sparkles-outline"
              label="Best day"
              value={stats.bestDay}
              detail={`${Math.round(stats.bestScore)} pts`}
            />
            <StatCard
              icon="medal-outline"
              label="Days ranked #1"
              value={`${stats.daysWon}/${stats.eligibleDays}`}
              detail={periodTitle(period, anchor)}
            />
            <StatCard
              icon="flame-outline"
              label="Longest win streak"
              value={`${stats.longestWinStreak} day${stats.longestWinStreak === 1 ? "" : "s"}`}
              detail="Within this range"
            />
          </View>
        </>
      ) : dates.length > 1 && headToHeads.length ? (
        <>
          <SectionHeader title="Head-to-head vs you" />
          {headToHeads.map(({ metric, stats: duel }) =>
            duel ? (
              <Card key={metric.id} style={styles.duel}>
                <View style={styles.duelHeading}>
                  <View
                    style={[
                      styles.metricMark,
                      { backgroundColor: `${metric.color}18` },
                    ]}
                  >
                    <Ionicons
                      name={metric.icon as keyof typeof Ionicons.glyphMap}
                      size={19}
                      color={metric.color}
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text translate={false} style={[styles.duelTitle, { color: colors.ink }]}>{localizeMetricName(language, metric)}</Text>
                    <Text style={[styles.duelMeta, { color: colors.muted }]}>
                      {duel.eligibleDays} comparable day
                      {duel.eligibleDays === 1 ? "" : "s"} ·{" "}
                      {metric.rankingDirection === "lower"
                        ? "lower wins"
                        : metric.rankingDirection === "closest"
                          ? "closest to personal goal wins"
                          : "higher wins"}
                    </Text>
                  </View>
                </View>
                <View style={styles.duelGrid}>
                  <DuelStat
                    label="Best day"
                    you={`${formatMetricValue(metric, duel.viewerBest.value)} · ${friendlyDate(duel.viewerBest.date, locale)}`}
                    friend={`${formatMetricValue(metric, duel.subjectBest.value)} · ${friendlyDate(duel.subjectBest.date, locale)}`}
                    friendName={memberDisplayName(state, member)}
                  />
                  <DuelStat
                    label="Days won"
                    you={`${duel.viewerWins}`}
                    friend={`${duel.subjectWins}`}
                    friendName={memberDisplayName(state, member)}
                    detail={duel.ties ? `${duel.ties} tied` : undefined}
                  />
                  <DuelStat
                    label="Longest win streak"
                    you={`${duel.viewerLongestStreak} day${duel.viewerLongestStreak === 1 ? "" : "s"}`}
                    friend={`${duel.subjectLongestStreak} day${duel.subjectLongestStreak === 1 ? "" : "s"}`}
                    friendName={memberDisplayName(state, member)}
                  />
                </View>
              </Card>
            ) : null,
          )}
        </>
      ) : dates.length > 1 ? (
        <Card style={styles.headEmpty}>
          <Ionicons name="analytics-outline" size={20} color={colors.primary} />
          <Text style={[styles.emptyPhotos, { color: colors.muted }]}>
            Head-to-head stats appear for selected “higher wins” metrics with
            shared daily data. Goal-distance metrics such as food and deficit
            are intentionally excluded.
          </Text>
        </Card>
      ) : null}
      <View style={styles.metricCards}>
        {metrics.map((metric) => (
          <Card key={metric.id} style={styles.chartCard}>
            <View style={styles.chartHeading}>
              <View>
                <Text style={[styles.chartEyebrow, { color: metric.color }]}>
                  {periodTitle(period, anchor).toUpperCase()}
                </Text>
                <Text translate={false} style={[styles.chartTitle, { color: colors.ink }]}>{localizeMetricName(language, metric)}</Text>
              </View>
              <View
                style={[
                  styles.metricMark,
                  { backgroundColor: `${metric.color}18` },
                ]}
              >
                <Ionicons
                  name={metric.icon as keyof typeof Ionicons.glyphMap}
                  size={21}
                  color={metric.color}
                />
              </View>
            </View>
            <View style={styles.bars}>
              {people.map((person) => {
                const cached = resultCache.get(`${metric.id}:${person.id}`);
                const result = cached!.range;
                return (
                  <View key={person.id} style={styles.personBlock}>
                    <View style={styles.barRow}>
                      <Avatar
                        initials={person.initials}
                        color={person.color}
                        uri={person.avatarUri}
                        size={34}
                      />
                      <View style={styles.barCopy}>
                        <View style={styles.labels}>
                          <Text style={[styles.barName, { color: colors.ink }]}>
                            {person.id === state.currentUserId
                              ? "You"
                              : <Text translate={false}>{memberDisplayName(state, person)}</Text>}
                          </Text>
                        <Text
                          style={[
                              styles.barValue,
                              { color: result.mode === "private" ? colors.faint : colors.muted },
                            ]}
                          >
                            {result.label}
                          </Text>
                        </View>
                        <ProgressBar
                          progress={
                            result.mode === "private"
                              ? 0
                              : (result.averageDisplayProgress ??
                                metricVisualProgress(
                                  state,
                                  metric,
                                  person.id,
                                  anchor,
                                  result.average,
                                ))
                          }
                          color={person.color}
                          layered={
                            result.personalGoalKind === "at_least" ||
                            metric.goal.kind === "at_least"
                          }
                        />
                        {result.label !== "Private" ? (
                          <Text
                            style={[
                              styles.streakMeta,
                              { color: colors.muted },
                            ]}
                          >
                            {result.streak ?? 0}d · Best streak{" "}
                            {result.bestStreak ?? 0}d
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.stats}>
                      <MiniStat
                        label="Range avg"
                        value={
                          result.mode === "private"
                            ? "Private"
                            : metric.dataType === "boolean"
                              ? (result.averageLabel ?? "—")
                              : result.average.toLocaleString(locale, {
                                  maximumFractionDigits: 1,
                                })
                        }
                      />
                      <MiniStat
                        label="7-day avg"
                        value={statValue(cached!.seven, locale)}
                      />
                      <MiniStat
                        label="30-day avg"
                        value={statValue(cached!.thirty, locale)}
                      />
                      <MiniStat
                        label="Overall avg"
                        value={cached!.overallLabel}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        ))}
      </View>
      {displayedBadges.length ? (
        <>
          <SectionHeader
            title={`${memberDisplayName(state, member)}'s badge showcase`}
            action={
              <Pressable
                onPress={() =>
                  router.navigate({
                    pathname: "/badges",
                    params: { anchor, filter: "achievement" },
                  } as never)
                }
              >
                <Text style={[styles.badgeLink, { color: colors.primary }]}>All badges</Text>
              </Pressable>
            }
          />
          {member.id === state.currentUserId ? (
            <MetricSelector
              title="Choose up to 5 showcase badges"
              items={badgeOptions}
              selectedIds={
                showcase.length
                  ? showcase
                  : displayedBadges.map((badge) => badge.id)
              }
              onChange={(ids) => {
                if (ids.length <= 5)
                  updateSettings({
                    badgeShowcaseByGroup: {
                      ...state.settings.badgeShowcaseByGroup,
                      [state.group.id]: ids,
                    },
                  });
              }}
            />
          ) : null}
          <Card>
            <View style={styles.badgeList}>
              {displayedBadges.map((badge) => (
                <View
                  key={badge.id}
                  style={[styles.badge, { borderLeftColor: badge.color }]}
                >
                  <View
                    style={[
                      styles.badgeIcon,
                      { backgroundColor: `${badge.color}20` },
                    ]}
                  >
                    <Ionicons name={badge.icon} size={18} color={badge.color} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.badgeTitle, { color: colors.ink }]}>{badge.title}</Text>
                    <Text style={[styles.badgeCaption, { color: colors.muted }]}>
                      {badge.caption} · {badge.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}
      <Pressable onPress={() => setPhotosOpen((open) => !open)}>
        <Card style={styles.collapseHeader}>
          <Ionicons name="images-outline" size={18} color={colors.primary} />
          <Text style={[styles.collapseTitle, { color: colors.ink }]}>
            Shared photo comparison
          </Text>
          <Ionicons
            name={photosOpen ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.muted}
          />
        </Card>
      </Pressable>
      {photosOpen ? (
        <Card>
          {people.map((person) => (
            <ProfilePhotoCompare
              key={person.id}
              state={state}
              personId={person.id}
              dates={dates}
            />
          ))}
        </Card>
      ) : null}
      <PeriodChoiceBar period={period} onChange={choosePeriod} />
      <DateRangeNavigator
        period={period}
        anchor={anchor}
        dates={navigationDates}
        calendarOpen={calendarOpen}
        onToggleCalendar={() => setCalendarOpen((open) => !open)}
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
      <View style={styles.selectors}>
        <MetricSelector
          title="What to show"
          items={available.map((metric) => ({
            id: metric.id,
            label: metric.name,
            icon: metric.icon as keyof typeof Ionicons.glyphMap,
            color: metric.color,
          }))}
          selectedIds={metricIds}
          onChange={chooseMetrics}
        />
        <MetricSelector
          title="People on chart"
          items={state.group.members.map((person) => ({
            id: person.id,
            label:
              person.id === state.currentUserId
                ? "You"
                : memberDisplayName(state, person),
            icon: "person-outline",
            color: person.color,
          }))}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
      </View>
      <View style={[styles.privacy, { borderTopColor: colors.border }]}>
        <Ionicons name="lock-closed-outline" size={19} color={colors.primary} />
        <Text style={[styles.privacyText, { color: colors.muted }]}>
          Private values and photos never enter this comparison. Goal-status
          sharing can show completion without revealing the underlying number.
        </Text>
      </View>
      </View>
    </Screen>
  );
}
function statValue(result: ReturnType<typeof periodMetricResult>, locale: string) {
  if (result.mode === "private") return "Private";
  if (result.mode === "status") return result.label;
  return result.average.toLocaleString(locale, { maximumFractionDigits: 1 });
}
function MiniStat({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.stat, { backgroundColor: colors.canvas }]}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}
function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  detail: string;
}) {
  const colors = useAppColors();
  return (
    <Card style={styles.comparisonCard}>
      <Ionicons name={icon} size={19} color={colors.primary} />
      <Text style={[styles.comparisonValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.comparisonLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.comparisonDetail, { color: colors.faint }]}>{detail}</Text>
    </Card>
  );
}
function DuelStat({
  label,
  you,
  friend,
  friendName,
  detail,
}: {
  label: string;
  you: string;
  friend: string;
  friendName: string;
  detail?: string;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.duelStat, { backgroundColor: colors.canvas }]}>
      <Text style={[styles.duelLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.duelSide}>
        <Text style={[styles.duelPerson, { color: colors.faint }]}>You</Text>
        <Text style={[styles.duelValue, { color: colors.ink }]}>{you}</Text>
      </View>
      <View style={styles.duelSide}>
        <Text style={[styles.duelPerson, { color: colors.faint }]}>{friendName}</Text>
        <Text style={[styles.duelValue, { color: colors.ink }]}>{friend}</Text>
      </View>
      {detail ? <Text style={[styles.duelDetail, { color: colors.muted }]}>{detail}</Text> : null}
    </View>
  );
}
function ProfilePhotoCompare({
  state,
  personId,
  dates,
}: {
  state: ReturnType<typeof useApp>["state"];
  personId: string;
  dates: string[];
}) {
  const colors = useAppColors();
  const person = state.group.members.find((item) => item.id === personId)!;
  const visible = state.photos
    .filter(
      (photo) =>
        photo.userId === personId &&
        (personId === state.currentUserId || photo.visibility === "group"),
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
  const primary = visible.find((photo) => dates.includes(photo.localDate));
  const older = primary
    ? visible.filter((photo) => photo.localDate < primary.localDate)
    : [];
  const primaryId = primary?.id ?? "";
  const defaultOlderId = older[0]?.id ?? "";
  const [olderId, setOlderId] = useState<string[]>([]);
  useEffect(
    () => setOlderId(defaultOlderId ? [defaultOlderId] : []),
    [primaryId, defaultOlderId],
  );
  const comparison = older.find((photo) => photo.id === olderId[0]);
  const collageRef = useRef<ViewShot>(null);
  function weight(day: string) {
    const entry = state.entries
      .filter(
        (item) =>
          item.userId === personId &&
          item.metricId === "weight" &&
          (personId === state.currentUserId || item.visibility === "group"),
      )
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
    return entry ? `${Number(entry.value).toFixed(1)} kg` : "No weight log";
  }
  async function save() {
    if (!primary || !comparison) return;
    if (Platform.OS !== "web") {
      const uri = await collageRef.current?.capture?.();
      if (uri)
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Save or share progress comparison",
        });
      return;
    }
    try {
      const photos = [primary, comparison];
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#F5F7F2";
      context.fillRect(0, 0, canvas.width, canvas.height);
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
        context.fillText(
          friendlyDate(photos[index].localDate),
          x + 270,
          755,
        );
        context.fillStyle = "#176B4D";
        context.font = "bold 18px sans-serif";
        context.fillText(weight(photos[index].localDate), x + 270, 790);
      });
      await new Promise<void>((resolve, reject) =>
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Could not create the comparison image."));
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `habhub-${personId}-comparison.png`;
          link.click();
          URL.revokeObjectURL(url);
          resolve();
        }, "image/png"),
      );
    } catch (error) {
      Alert.alert(
        "Could not save collage",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }
  return (
    <View style={styles.photoPerson}>
      <Text style={[styles.photoName, { color: colors.ink }]}>
        {personId === state.currentUserId
          ? "You"
          : memberDisplayName(state, person)}
      </Text>
      {primary ? (
        <>
          <ViewShot
            ref={collageRef}
            options={{ format: "png", quality: 1 }}
            style={styles.photoCapture}
          >
            <Text preserveColor style={styles.captureTitle}>
              HabHub progress comparison
            </Text>
            <View style={styles.photos}>
              <View style={styles.photoBlock}>
                <ExpandableImage
                  uri={primary.uri}
                  thumbnailStyle={styles.photo}
                />
                <Text preserveColor style={styles.photoDate}>
                  {friendlyDate(primary.localDate)}
                </Text>
                <Text preserveColor style={styles.photoDate}>
                  {weight(primary.localDate)}
                </Text>
              </View>
              {comparison ? (
                <View style={styles.photoBlock}>
                  <ExpandableImage
                    uri={comparison.uri}
                    thumbnailStyle={styles.photo}
                  />
                  <Text preserveColor style={styles.photoDate}>
                    {friendlyDate(comparison.localDate)}
                  </Text>
                  <Text preserveColor style={styles.photoDate}>
                    {weight(comparison.localDate)}
                  </Text>
                </View>
              ) : null}
            </View>
          </ViewShot>
          {comparison ? (
            <Button
              label="Save or share collage"
              icon="download-outline"
              variant="ghost"
              onPress={save}
            />
          ) : null}
          {older.length ? (
            <MetricSelector
              title="Older comparison photo"
              multiple={false}
              items={older.map((photo) => ({
                id: photo.id,
                label: friendlyDate(photo.localDate),
                icon: "image-outline",
                color: person.color,
              }))}
              selectedIds={olderId}
              onChange={setOlderId}
            />
          ) : (
            <Text style={[styles.emptyPhotos, { color: colors.muted }]}>
              No older photo is available yet.
            </Text>
          )}
        </>
      ) : (
        <Text style={[styles.emptyPhotos, { color: colors.muted }]}>No shared photo in this range.</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  collapseHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  collapseTitle: { flex: 1, fontSize: 11, fontWeight: "900" },
  photoCapture: {
    backgroundColor: "#F5F7F2",
    padding: 9,
    borderRadius: 12,
    marginBottom: 8,
  },
  captureTitle: {
    color: "#17211B",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 7,
  },
  profile: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  original: { color: palette.faint, fontSize: 9, marginTop: 2 },
  meta: { color: palette.muted, fontSize: 11, marginTop: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  selectors: { gap: 8 },
  navigator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 8,
    marginTop: 10,
  },
  navSpacer: { width: 38, height: 38 },
  navCopy: { alignItems: "center", flex: 1 },
  navTitle: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  navSub: { color: palette.muted, fontSize: 9, marginTop: 2 },
  comparisonStats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  comparisonCard: { flex: 1, minWidth: 105, padding: 12 },
  comparisonValue: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 7,
  },
  comparisonLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "900",
    marginTop: 2,
  },
  comparisonDetail: { color: palette.faint, fontSize: 7, marginTop: 3 },
  duel: { marginBottom: 9 },
  duelHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 11,
  },
  duelTitle: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  duelMeta: { color: palette.muted, fontSize: 8, marginTop: 2 },
  duelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  duelStat: {
    flex: 1,
    minWidth: 155,
    backgroundColor: palette.canvas,
    borderRadius: 12,
    padding: 10,
  },
  duelLabel: {
    color: palette.primary,
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  duelSide: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 7,
    paddingVertical: 3,
  },
  duelPerson: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    maxWidth: "36%",
  },
  duelValue: {
    flex: 1,
    color: palette.ink,
    fontSize: 9,
    fontWeight: "900",
    textAlign: "right",
  },
  duelDetail: {
    color: palette.faint,
    fontSize: 7,
    textAlign: "right",
    marginTop: 3,
  },
  headEmpty: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    overflow: "hidden",
  },
  metricCards: { gap: 12, marginTop: 18 },
  chartCard: { padding: 15 },
  chartHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  chartEyebrow: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  chartTitle: {
    color: palette.ink,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 3,
  },
  metricMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bars: { gap: 18, marginTop: 18 },
  personBlock: { gap: 10 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barCopy: { flex: 1 },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  barName: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  barValue: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  streakMeta: { fontSize: 8, fontWeight: "700", marginTop: 5 },
  private: { color: palette.faint, fontStyle: "italic" },
  stats: { flexDirection: "row", gap: 5, marginLeft: 44 },
  stat: {
    flex: 1,
    backgroundColor: palette.canvas,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 5,
  },
  statValue: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  statLabel: {
    color: palette.muted,
    fontSize: 7,
    textAlign: "center",
    marginTop: 2,
  },
  badgeLink: { color: palette.primary, fontSize: 10, fontWeight: "900" },
  badgeList: { gap: 7 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderLeftWidth: 3,
    paddingLeft: 8,
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTitle: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  badgeCaption: {
    color: palette.muted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 2,
  },
  photoPerson: { paddingVertical: 9, gap: 7 },
  photoName: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoBlock: { width: 128 },
  photo: { width: 128, height: 150, borderRadius: 13 },
  photoDate: {
    color: palette.muted,
    fontSize: 8,
    textAlign: "center",
    marginTop: 3,
  },
  emptyPhotos: {
    color: palette.muted,
    fontSize: 10,
    fontStyle: "italic",
    flex: 1,
    flexShrink: 1,
    lineHeight: 15,
  },
  privacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
    paddingHorizontal: 2,
  },
  privacyText: {
    flex: 1,
    color: palette.primary,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
});
