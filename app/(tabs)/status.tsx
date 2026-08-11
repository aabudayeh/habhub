import { router } from "expo-router";
import React, {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
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
import { palette, useAppColors } from "@/src/theme";

const SEGMENTS = 32;
const RING_SIZE = 76;
const FLANK_RING_SIZE = 68;

function ProgressRing({
  progress,
  color,
  size = RING_SIZE,
  unavailable,
}: {
  progress: number;
  color: string;
  size?: number;
  unavailable: boolean;
}) {
  const colors = useAppColors();
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * SEGMENTS);
  const ringColor = unavailable ? palette.amber : color;
  return (
    <View style={{ height: size, width: size }}>
      {Array.from({ length: SEGMENTS }, (_, index) => {
        const angle = (index / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
        const radius = size / 2 - 4;
        return (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                left: size / 2 + Math.cos(angle) * radius - 1.5,
                top: size / 2 + Math.sin(angle) * radius - 4,
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
  flank = false,
  period,
  rollup,
}: {
  anchor: string;
  flank?: boolean;
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
      style={({ pressed }) => [
        styles.goal,
        flank && { width: FLANK_RING_SIZE },
        pressed && styles.pressed,
      ]}
    >
      <ProgressRing
        progress={progress}
        color={met ? GOAL_COMPLETE_COLOR : metric.color}
        size={flank ? FLANK_RING_SIZE : RING_SIZE}
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

function StatusBodyFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  return (
    <View
      accessible
      accessibilityLabel={`${t(label)}: ${value}`}
      style={[
        styles.bodyFact,
        {
          backgroundColor: colors.canvas,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={[styles.bodyFactLabel, { color: colors.muted }]}
      >
        {label}
      </Text>
      <Text
        translate={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={[styles.bodyFactValue, { color: colors.ink }]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function StatusPage() {
  const { state } = useApp();
  const colors = useAppColors();
  const { t } = useLocalization();
  const { width: viewportWidth } = useWindowDimensions();
  const roomyStatus = viewportWidth >= 480;
  const narrowStatus = viewportWidth < 360;
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
  const bodyCompositionStat =
    typeof avatarProgression.currentBodyFatPercent === "number"
      ? {
          label: "Body fat",
          value: `${avatarProgression.currentBodyFatPercent.toFixed(1)}%`,
        }
      : typeof avatarProgression.currentLeanBodyMassKg === "number"
        ? {
            label: "Lean body mass",
            value: `${avatarProgression.currentLeanBodyMassKg.toFixed(1)} kg`,
          }
        : {
            label: "Body fat",
            value: "—",
          };
  // The existing tracker order is the user's display order, so reordering
  // trackers also determines which goal rings sit closest to the avatar. Keep
  // an even flank count for a balanced narrow-phone layout; any remainder
  // continues in the compact grid below.
  const flankGoalCount = narrowStatus
    ? 0
    : summary.metrics.length >= 4
      ? 4
      : summary.metrics.length >= 2
        ? 2
        : 0;
  const flankGoals = summary.metrics.slice(0, flankGoalCount);
  const leftFlankGoals = flankGoals.filter((_, index) => index % 2 === 0);
  const rightFlankGoals = flankGoals.filter((_, index) => index % 2 === 1);
  const remainingGoals = summary.metrics.slice(flankGoalCount);
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
            <View
              style={[
                styles.avatarStage,
                roomyStatus && styles.avatarStageRoomy,
              ]}
            >
              <View
                style={[
                  styles.goalRail,
                  !flankGoalCount && styles.goalRailEmpty,
                  roomyStatus && styles.goalRailRoomy,
                ]}
              >
                {leftFlankGoals.map((rollup) => (
                  <GoalOrbit
                    key={rollup.metric.id}
                    rollup={rollup}
                    anchor={anchor}
                    period={period}
                    flank
                  />
                ))}
              </View>

              <View style={styles.avatarColumn}>
                <BodyProgressAvatar
                  bodyFatPercent={avatarProgression.currentBodyFatPercent}
                  heightCm={state.settings.energyProfile.heightCm}
                  leanBodyMassKg={avatarProgression.currentLeanBodyMassKg}
                  mindTier={avatarProgression.mindTier}
                  muscleProgress={avatarProgression.muscleProgress}
                  progress={summary.progress}
                  sex={state.settings.energyProfile.sex}
                  visualStyle={state.settings.statusAvatarStyle ?? "silhouette"}
                  weightKg={avatarProgression.currentWeightKg}
                />
              </View>

              <View
                style={[
                  styles.goalRail,
                  !flankGoalCount && styles.goalRailEmpty,
                  roomyStatus && styles.goalRailRoomy,
                ]}
              >
                {rightFlankGoals.map((rollup) => (
                  <GoalOrbit
                    key={rollup.metric.id}
                    rollup={rollup}
                    anchor={anchor}
                    period={period}
                    flank
                  />
                ))}
              </View>
            </View>
            <View style={styles.bodyFacts}>
              <StatusBodyFact
                label="Weight"
                value={`${avatarProgression.currentWeightKg.toFixed(1)} kg`}
              />
              <StatusBodyFact
                label={bodyCompositionStat.label}
                value={bodyCompositionStat.value}
              />
            </View>
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

          {remainingGoals.length ? (
            <View style={styles.goalGrid}>
              {remainingGoals.map((rollup) => (
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
  statusCard: { gap: 16, paddingHorizontal: 10, paddingVertical: 18 },
  personWrap: { alignItems: "center", justifyContent: "center", gap: 5 },
  avatarStage: {
    width: "100%",
    maxWidth: 448,
    alignSelf: "center",
    alignItems: "stretch",
    justifyContent: "center",
    flexDirection: "row",
    columnGap: 2,
  },
  avatarStageRoomy: { columnGap: 12 },
  avatarColumn: { width: 164, alignItems: "center", justifyContent: "center" },
  goalRail: {
    width: FLANK_RING_SIZE,
    justifyContent: "space-evenly",
    alignItems: "center",
    alignSelf: "stretch",
  },
  goalRailRoomy: { width: 92 },
  goalRailEmpty: { width: 0 },
  bodyFacts: {
    width: "100%",
    maxWidth: 286,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 2,
  },
  bodyFact: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  bodyFactLabel: {
    width: "100%",
    textAlign: "center",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "800",
  },
  bodyFactValue: {
    width: "100%",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
  },
  personName: { marginTop: 8, maxWidth: "82%", fontSize: 16, fontWeight: "900" },
  summary: { maxWidth: 520, textAlign: "center", fontSize: 12, fontWeight: "700" },
  goalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
  },
  goal: { width: 92, alignItems: "center", gap: 5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  segment: { position: "absolute", width: 3, height: 8, borderRadius: 2 },
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPercent: { fontSize: 13, fontWeight: "900" },
  goalName: { minHeight: 30, textAlign: "center", fontSize: 11, lineHeight: 14, fontWeight: "800" },
});
