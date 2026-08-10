import { router } from "expo-router";
import React, {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { AppText as Text } from "@/src/components/AppText";
import { BodyProgressAvatar } from "@/src/components/BodyProgressAvatar";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  adjacentPeriod,
  DateRangeNavigator,
  PeriodChoiceBar,
} from "@/src/components/PeriodNavigator";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  periodDates,
  shiftedPeriodAnchor,
  type LeaderboardPeriod,
} from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import {
  statusAllTimeDates,
  statusAvatarProgression,
  statusRangeRollup,
  type StatusMetricRollup,
} from "@/src/domain/status";
import { localizeMetricName } from "@/src/i18n/domain";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

const SEGMENTS = 32;
const RING_SIZE = 76;

function ProgressRing({
  progress,
  color,
  unavailable,
}: {
  progress: number;
  color: string;
  unavailable: boolean;
}) {
  const colors = useAppColors();
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * SEGMENTS);
  const ringColor = unavailable ? palette.amber : color;
  return (
    <View style={styles.ring}>
      {Array.from({ length: SEGMENTS }, (_, index) => {
        const angle = (index / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
        const radius = RING_SIZE / 2 - 4;
        return (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                left: RING_SIZE / 2 + Math.cos(angle) * radius - 1.5,
                top: RING_SIZE / 2 + Math.sin(angle) * radius - 4,
                backgroundColor: index < filled ? ringColor : colors.border,
                transform: [{ rotate: `${(index / SEGMENTS) * 360}deg` }],
              },
            ]}
          />
        );
      })}
      <View style={styles.ringLabel}>
        <Text
          translate={false}
          numberOfLines={1}
          style={[styles.ringPercent, { color: unavailable ? palette.amber : colors.ink }]}
        >
          {unavailable ? "—" : `${Math.round(Math.max(0, progress) * 100)}%`}
        </Text>
      </View>
    </View>
  );
}

function GoalOrbit({
  anchor,
  period,
  rollup,
}: {
  anchor: string;
  period: LeaderboardPeriod;
  rollup: StatusMetricRollup;
}) {
  const colors = useAppColors();
  const { language } = useLocalization();
  const { metric, opportunities, completed, progress } = rollup;
  const met = opportunities > 0 && completed === opportunities;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.navigate({
          pathname: "/metric-detail",
          params: { metric: metric.id, date: anchor, period },
        } as never)
      }
      style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
    >
      <ProgressRing
        progress={progress}
        color={met ? GOAL_COMPLETE_COLOR : metric.color}
        unavailable={!opportunities}
      />
      <Text
        translate={false}
        numberOfLines={2}
        style={[styles.goalName, { color: colors.ink }]}
      >
        {localizeMetricName(language, metric)}
      </Text>
    </Pressable>
  );
}

export default function StatusPage() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const [dateNavigatorOpen, setDateNavigatorOpen] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Date controls should acknowledge a tap immediately. Range totals and the
  // all-time avatar history can then catch up at transition priority while the
  // previous result remains visible instead of blocking the pressed frame.
  const calculationState = useDeferredValue(state);
  const calculationPeriod = useDeferredValue(period);
  const calculationAnchor = useDeferredValue(anchor);
  const calculationStateRef = useRef(calculationState);
  calculationStateRef.current = calculationState;
  // Presence, chat, theme, and navigation settings must not invalidate a full
  // Status history calculation. Track only collections/settings used by the
  // metric engine, matching the lightweight leaderboard calculation boundary.
  const calculationInputs = useMemo(
    () => ({
      baselineCalories: calculationState.settings.baselineCalories,
      currentUserId: calculationState.currentUserId,
      dailyMetricStatuses: calculationState.dailyMetricStatuses,
      dayEndTime: calculationState.settings.dayEndTime,
      energyProfile: calculationState.settings.energyProfile,
      energyProfiles: calculationState.energyProfiles,
      entries: calculationState.entries,
      foodGoalMode: calculationState.settings.foodGoalMode,
      fastingRuntimeByMetric:
        calculationState.settings.fastingRuntimeByMetric,
      groupId: calculationState.group.id,
      gymSessions: calculationState.gymSessions,
      metrics: calculationState.metrics,
      photos: calculationState.photos,
      todos: calculationState.todos,
      trackedGoalPeriods: calculationState.trackedGoalPeriods,
      vacationPeriods: calculationState.settings.vacationPeriods,
      weightDirection: calculationState.settings.weightDirection,
      weekStartsOn: calculationState.settings.weekStartsOn,
    }),
    [
      calculationState.currentUserId,
      calculationState.dailyMetricStatuses,
      calculationState.energyProfiles,
      calculationState.entries,
      calculationState.group.id,
      calculationState.gymSessions,
      calculationState.metrics,
      calculationState.photos,
      calculationState.settings.baselineCalories,
      calculationState.settings.dayEndTime,
      calculationState.settings.energyProfile,
      calculationState.settings.foodGoalMode,
      calculationState.settings.fastingRuntimeByMetric,
      calculationState.settings.vacationPeriods,
      calculationState.settings.weightDirection,
      calculationState.settings.weekStartsOn,
      calculationState.todos,
      calculationState.trackedGoalPeriods,
    ],
  );
  const member = state.group.members.find(
    (item) => item.id === state.currentUserId,
  );
  const navigationDates = useMemo(
    () => periodDates(period, anchor, state.settings.weekStartsOn ?? 1),
    [anchor, period, state.settings.weekStartsOn],
  );
  const calculationDates = useMemo(
    () => {
      void calculationInputs;
      const currentState = calculationStateRef.current;
      return calculationPeriod === "overall"
        ? statusAllTimeDates(
            currentState,
            currentState.currentUserId,
            calculationAnchor,
          )
        : periodDates(
            calculationPeriod,
            calculationAnchor,
            currentState.settings.weekStartsOn ?? 1,
          );
    },
    [
      calculationAnchor,
      calculationInputs,
      calculationPeriod,
    ],
  );
  const summary = useMemo(
    () => {
      void calculationInputs;
      const currentState = calculationStateRef.current;
      return statusRangeRollup(
        currentState,
        currentState.currentUserId,
        calculationDates,
      );
    },
    [calculationDates, calculationInputs],
  );
  const avatarProgression = useMemo(
    () => {
      void calculationInputs;
      const currentState = calculationStateRef.current;
      return statusAvatarProgression(
        currentState,
        currentState.currentUserId,
        calculationAnchor,
      );
    },
    [calculationAnchor, calculationInputs],
  );
  const choosePeriod = useCallback(
    (next: Exclude<LeaderboardPeriod, "custom">) => {
      setPeriod(next);
      setAnchor(
        next === "yesterday" ? dateWithOffsetFrom(dateKey(), -1) : dateKey(),
      );
      setCalendarOpen(false);
    },
    [],
  );
  const shift = useCallback(
    (direction: -1 | 1) => {
      const next = shiftedPeriodAnchor(period, anchor, direction);
      if (!next) return;
      if (period === "today" || period === "yesterday") setPeriod("custom");
      setAnchor(next);
      setCalendarOpen(false);
    },
    [anchor, period],
  );
  const swipeRange = useCallback(
    (direction: -1 | 1) => {
      const next = adjacentPeriod(period, direction);
      if (!next) return;
      choosePeriod(next);
    },
    [choosePeriod, period],
  );
  const swipe = usePageSwipeGesture({
    onPrevious: () => swipeRange(-1),
    onNext: () => swipeRange(1),
  });

  return (
    <GestureDetector gesture={swipe}>
      <Screen>
        <PageHeader
          title="Status"
          showMenu
        />
        <PeriodChoiceBar
          period={period}
          onChange={choosePeriod}
          dateViewOpen={dateNavigatorOpen}
          onToggleDateView={() => {
            if (dateNavigatorOpen) setCalendarOpen(false);
            setDateNavigatorOpen((open) => !open);
          }}
        />
        {period !== "overall" && dateNavigatorOpen ? (
          <DateRangeNavigator
            period={period}
            anchor={anchor}
            dates={navigationDates}
            calendarOpen={calendarOpen}
            onToggleCalendar={() => setCalendarOpen((open) => !open)}
            onShift={shift}
          >
            <MonthCalendar
              monthDate={anchor}
              selectedDate={anchor}
              onSelect={(next) => {
                setAnchor(next <= dateKey() ? next : dateKey());
                if (period === "today" || period === "yesterday")
                  setPeriod("custom");
                setCalendarOpen(false);
              }}
              onMonthChange={(next) =>
                setAnchor(next <= dateKey() ? next : dateKey())
              }
            />
          </DateRangeNavigator>
        ) : null}

        <Card style={styles.statusCard}>
          <View style={styles.personWrap}>
            <View style={[styles.halo, { borderColor: `${accent}55` }]} />
            <BodyProgressAvatar
              heightCm={state.settings.energyProfile.heightCm}
              mindTier={avatarProgression.mindTier}
              muscleProgress={avatarProgression.muscleProgress}
              progress={summary.progress}
              sex={state.settings.energyProfile.sex}
              weightKg={avatarProgression.currentWeightKg}
            />
            {member ? (
              <Text
                translate={false}
                numberOfLines={1}
                style={[styles.personName, { color: colors.ink }]}
              >
                {memberDisplayName(state, member)}
              </Text>
            ) : null}
            <Text style={[styles.summary, { color: colors.muted }]}>
              {summary.opportunities
                ? `${summary.completed}/${summary.opportunities} ${t(
                    calculationDates.length === 1
                      ? "goals completed on this date"
                      : "goal opportunities completed in this range",
                  )}`
                : t("No goals are currently tracked. Add one in customization.")}
            </Text>
          </View>

          {summary.metrics.length ? (
            <View style={styles.goalGrid}>
              {summary.metrics.map((rollup) => (
                <GoalOrbit
                  key={rollup.metric.id}
                  rollup={rollup}
                  anchor={anchor}
                  period={period}
                />
              ))}
            </View>
          ) : null}
        </Card>
      </Screen>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  statusCard: { gap: 16, paddingVertical: 18 },
  personWrap: { alignItems: "center", justifyContent: "center", gap: 5 },
  halo: {
    position: "absolute",
    top: -8,
    width: 172,
    height: 242,
    borderRadius: 86,
    borderWidth: 1,
  },
  personName: { marginTop: 8, maxWidth: "82%", fontSize: 16, fontWeight: "900" },
  summary: { fontSize: 12, fontWeight: "700" },
  goalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
  },
  goal: { width: 92, alignItems: "center", gap: 5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  ring: { width: RING_SIZE, height: RING_SIZE },
  segment: { position: "absolute", width: 3, height: 8, borderRadius: 2 },
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPercent: { fontSize: 13, fontWeight: "900" },
  goalName: { minHeight: 30, textAlign: "center", fontSize: 11, lineHeight: 14, fontWeight: "800" },
});
