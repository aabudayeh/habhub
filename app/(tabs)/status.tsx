import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
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
import { StatusAvatarSimulator } from "@/src/components/StatusAvatarSimulator";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  periodDates,
  shiftedPeriodAnchor,
  type LeaderboardPeriod,
} from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import { firstDisplayName } from "@/src/domain/profileName";
import {
  statusAllTimeDates,
  statusAvatarProgression,
  statusRangeRollup,
  type StatusMetricRollup,
} from "@/src/domain/status";
import {
  estimateWeightPlan,
  weightManagementSummaryVisible,
} from "@/src/domain/weightPlan";
import { localizeMetricName } from "@/src/i18n/domain";
import { useLocale, useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors } from "@/src/theme";

const SEGMENTS = 32;
const FLANK_RING_SIZE = 68;
const RING_SIZE = FLANK_RING_SIZE;
const TRACKER_DOUBLE_TAP_MS = 210;

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
  bloodPressureComposite,
  flank = false,
  period,
  rollup,
}: {
  anchor: string;
  bloodPressureComposite: boolean;
  flank?: boolean;
  period: LeaderboardPeriod;
  rollup: StatusMetricRollup;
}) {
  const colors = useAppColors();
  const { language } = useLocalization();
  const { metric, opportunities, completed, progress } = rollup;
  const met = opportunities > 0 && completed === opportunities;
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canLog =
    metric.dataType !== "calculated" &&
    !metric.fastingSettings &&
    metric.id !== "screen_time" &&
    metric.id !== "blood_pressure_diastolic" &&
    !(metric.id === "pulse" && bloodPressureComposite) &&
    (metric.manualEntry !== false || metric.id === "steps");
  const openDetails = useCallback(() => {
    router.navigate({
      pathname: "/metric-detail",
      params: { metric: metric.id, date: anchor, period },
    } as never);
  }, [anchor, metric.id, period]);
  const openLog = useCallback(() => {
    if (!canLog) {
      openDetails();
      return;
    }
    router.navigate({
      pathname: "/log",
      params: { metric: metric.id, date: anchor },
    } as never);
  }, [anchor, canLog, metric.id, openDetails]);
  const handlePress = useCallback(() => {
    if (!canLog) {
      openDetails();
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current <= TRACKER_DOUBLE_TAP_MS) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      lastTapRef.current = 0;
      openLog();
      return;
    }
    lastTapRef.current = now;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      lastTapRef.current = 0;
      openDetails();
    }, TRACKER_DOUBLE_TAP_MS);
  }, [canLog, openDetails, openLog]);
  useEffect(
    () => () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    },
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={localizeMetricName(language, metric)}
      accessibilityHint={
        canLog
          ? "Tap once for details. Double tap to open this tracker's Log page."
          : "Tap to open tracker details."
      }
      accessibilityActions={
        canLog ? [{ name: "log", label: "Open Log page" }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "log") openLog();
      }}
      onPress={handlePress}
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
      style={styles.bodyFact}
    >
      <Text
        numberOfLines={1}
        style={[styles.bodyFactLabel, { color: colors.muted }]}
      >
        {label}
      </Text>
      <Text
        translate={false}
        numberOfLines={1}
        style={[styles.bodyFactValue, { color: colors.ink }]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function StatusPage() {
  const { state, updateSettings } = useApp();
  const tutorial = useTutorial();
  const colors = useAppColors();
  const { t } = useLocalization();
  const locale = useLocale();
  const { width: viewportWidth } = useWindowDimensions();
  const roomyStatus = viewportWidth >= 480;
  const narrowStatus = viewportWidth < 360;
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const dateNavigatorOpen =
    state.settings.statusDateNavigatorCollapsed !== true;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [avatarSourceEditorOpen, setAvatarSourceEditorOpen] = useState(false);
  const [avatarSimulatorOpen, setAvatarSimulatorOpen] = useState(false);
  const avatarLongPressRef = useRef(false);
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
  const bloodPressureComposite = state.metrics.some(
    (metric) => metric.id === "blood_pressure_systolic",
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
  const showWeightSummary = weightManagementSummaryVisible(state.settings);
  const weightPlan = showWeightSummary
    ? estimateWeightPlan({
        anchorDate: dateKey(),
        currentWeightKg: avatarProgression.currentWeightKg,
        direction: state.settings.weightDirection ?? "lose",
        targetWeightKg: state.settings.energyProfile.targetWeightKg,
        weeklyChangeKg: state.settings.energyProfile.desiredWeeklyLossKg,
      })
    : undefined;
  const expectedWeightDate = weightPlan?.expectedGoalDate
    ? new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
      }).format(new Date(`${weightPlan.expectedGoalDate}T12:00:00`))
    : undefined;
  const weightPlanLabel = weightPlan
    ? weightPlan.direction === "maintain"
      ? `Maintaining around ${weightPlan.targetWeightKg.toFixed(1)} kg`
      : weightPlan.reached
        ? `Target ${weightPlan.targetWeightKg.toFixed(1)} kg reached`
        : expectedWeightDate
          ? `Target ${weightPlan.targetWeightKg.toFixed(1)} kg · est. ${expectedWeightDate}`
          : undefined
    : undefined;
  const bodyCompositionStat =
    typeof avatarProgression.currentBodyFatPercent === "number"
      ? {
          label: "Body fat",
          value: `${avatarProgression.currentBodyFatPercent.toFixed(1)}%`,
        }
      : {
          label: "Body fat",
          value: "—",
        };
  const completionPercent = Math.round(
    Math.max(0, Math.min(1, summary.progress)) * 100,
  );
  const bodyCompositionReady =
    typeof avatarProgression.currentBodyFatPercent === "number" &&
    Number.isFinite(avatarProgression.currentBodyFatPercent) &&
    avatarProgression.currentBodyFatPercent > 0 &&
    typeof avatarProgression.currentLeanBodyMassKg === "number" &&
    Number.isFinite(avatarProgression.currentLeanBodyMassKg) &&
    avatarProgression.currentLeanBodyMassKg > 0;
  const avatarCalculationSource =
    state.settings.statusAvatarCalculationSource ?? "bmi";
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
      <Screen minimumBottomPadding={16}>
        <View style={styles.compactHeaderSpacing}>
          <PageHeader
            tutorialId="status-header"
            title="Status"
            showMenu
          />
        </View>
        <PeriodChoiceBar
          period={period}
          onChange={choosePeriod}
          dateViewOpen={dateNavigatorOpen}
          onToggleDateView={() => {
            if (dateNavigatorOpen) setCalendarOpen(false);
            updateSettings({
              statusDateNavigatorCollapsed: dateNavigatorOpen,
            });
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
                    bloodPressureComposite={bloodPressureComposite}
                    period={period}
                    flank
                  />
                ))}
              </View>

              <TutorialTarget id="status-avatar-source">
              <TutorialTarget id="status-avatar">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Open avatar simulator")}
                accessibilityHint={t(
                  "Tap to preview changes. Hold for avatar calculation settings.",
                )}
                accessibilityState={{
                  expanded: avatarSourceEditorOpen || avatarSimulatorOpen,
                }}
                delayLongPress={420}
                onLongPress={() => {
                  avatarLongPressRef.current = true;
                  setAvatarSourceEditorOpen(true);
                }}
                onPress={() => {
                  if (avatarLongPressRef.current) return;
                  setAvatarSourceEditorOpen(false);
                  setAvatarSimulatorOpen(true);
                  tutorial.reportEvent({
                    actionId: "tutorial.status.open-simulator",
                    scope: "isolated-preview",
                  });
                }}
                onPressIn={() => {
                  avatarLongPressRef.current = false;
                }}
                style={({ pressed }) => [
                  styles.avatarColumn,
                  pressed && styles.avatarHeld,
                ]}
              >
                <View style={styles.personHeading}>
                  {member ? (
                    <Text
                      translate={false}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[styles.personName, { color: colors.ink }]}
                    >
                      {firstDisplayName(memberDisplayName(state, member))}
                    </Text>
                  ) : null}
                </View>
                <BodyProgressAvatar
                  bodyFatPercent={avatarProgression.currentBodyFatPercent}
                  calculationSource={avatarCalculationSource}
                  heightCm={state.settings.energyProfile.heightCm}
                  leanBodyMassKg={avatarProgression.currentLeanBodyMassKg}
                  muscleProgress={avatarProgression.muscleProgress}
                  progress={summary.progress}
                  showProgressLabel={false}
                  sex={state.settings.energyProfile.sex}
                  visualStyle={state.settings.statusAvatarStyle ?? "silhouette"}
                  weightKg={avatarProgression.currentWeightKg}
                />
                {showWeightSummary && weightPlanLabel ? (
                  <View
                    pointerEvents="none"
                    testID="status-weight-plan"
                    style={styles.personWeightPlan}
                  >
                    <Ionicons
                      name={
                        weightPlan?.direction === "maintain"
                          ? "remove-outline"
                          : "calendar-outline"
                      }
                      size={11}
                      color={colors.primary}
                    />
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[styles.personWeightPlanText, { color: colors.ink }]}
                    >
                      {weightPlanLabel}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              </TutorialTarget>
              </TutorialTarget>

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
                    bloodPressureComposite={bloodPressureComposite}
                    period={period}
                    flank
                  />
                ))}
              </View>
            </View>
            <View style={styles.bodyFacts}>
              {showWeightSummary ? (
                <>
                  <StatusBodyFact
                    label="Weight"
                    value={`${avatarProgression.currentWeightKg.toFixed(1)} kg`}
                  />
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.bodyFactDivider, { backgroundColor: colors.border }]}
                  />
                </>
              ) : null}
              <View
                accessible
                accessibilityLabel={`${t("Tracked goals")}: ${completionPercent}%`}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: completionPercent,
                  text: `${completionPercent}%`,
                }}
                style={styles.completionFact}
              >
                <Text
                  translate={false}
                  numberOfLines={1}
                  style={[styles.completionPercent, { color: colors.ink }]}
                >
                  {completionPercent}%
                </Text>
              </View>
              {showWeightSummary ? (
                <>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.bodyFactDivider, { backgroundColor: colors.border }]}
                  />
                  <StatusBodyFact
                    label={bodyCompositionStat.label}
                    value={bodyCompositionStat.value}
                  />
                </>
              ) : null}
            </View>
            {avatarSourceEditorOpen ? (
              <View
                accessibilityLabel={t("Avatar calculation source")}
                style={[
                  styles.avatarSourceEditor,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.avatarSourceChoices}>
                  {(["bmi", "body_composition"] as const).map((source) => {
                    const selected = avatarCalculationSource === source;
                    return (
                      <Pressable
                        key={source}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() =>
                          updateSettings({ statusAvatarCalculationSource: source })
                        }
                        style={({ pressed }) => [
                          styles.avatarSourceChoice,
                          {
                            backgroundColor: selected
                              ? GOAL_COMPLETE_COLOR
                              : colors.card,
                            borderColor: selected
                              ? GOAL_COMPLETE_COLOR
                              : colors.border,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          translate={false}
                          style={[
                            styles.avatarSourceChoiceText,
                            { color: selected ? palette.ink : colors.ink },
                          ]}
                        >
                          {source === "bmi"
                            ? t("BMI")
                            : t("Body composition")}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setAvatarSourceEditorOpen(false)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.avatarSourceDone,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      translate={false}
                      style={[styles.avatarSourceDoneText, { color: colors.muted }]}
                    >
                      {t("Done")}
                    </Text>
                  </Pressable>
                </View>
                {avatarCalculationSource === "body_composition" &&
                !bodyCompositionReady ? (
                  <Text
                    translate={false}
                    style={[styles.avatarSourceFallback, { color: colors.muted }]}
                  >
                    {t(
                      "BMI fallback until body fat and lean mass are logged",
                    )}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {remainingGoals.length ? (
            <View style={styles.goalGrid}>
              {remainingGoals.map((rollup) => (
                <GoalOrbit
                  key={rollup.metric.id}
                  rollup={rollup}
                  anchor={anchor}
                  bloodPressureComposite={bloodPressureComposite}
                  period={period}
                />
              ))}
            </View>
          ) : null}
        </Card>
        <StatusAvatarSimulator
          age={state.settings.energyProfile.age}
          bodyFatPercent={avatarProgression.currentBodyFatPercent}
          calculationSource={avatarCalculationSource}
          heightCm={state.settings.energyProfile.heightCm}
          leanBodyMassKg={avatarProgression.currentLeanBodyMassKg}
          muscleProgress={avatarProgression.muscleProgress}
          onClose={() => setAvatarSimulatorOpen(false)}
          progress={summary.progress}
          sex={state.settings.energyProfile.sex}
          visible={avatarSimulatorOpen}
          visualStyle={state.settings.statusAvatarStyle ?? "silhouette"}
          weightKg={avatarProgression.currentWeightKg}
        />
      </Screen>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Keep the shared safe-area/header geometry, while moving Status' first
  // control a little closer to its short one-line title.
  compactHeaderSpacing: { marginBottom: -5 },
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
  avatarHeld: { opacity: 0.9, transform: [{ scale: 0.99 }] },
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
    maxWidth: 280,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "nowrap",
    columnGap: 7,
    marginTop: 1,
    paddingHorizontal: 4,
  },
  bodyFact: {
    minHeight: 30,
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyFactLabel: {
    flexShrink: 0,
    textAlign: "center",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "800",
  },
  bodyFactValue: {
    flexShrink: 0,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
  },
  completionFact: {
    width: 48,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  completionPercent: {
    flexShrink: 0,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "900",
  },
  bodyFactDivider: { width: 1, height: 13 },
  personHeading: {
    position: "absolute",
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  personName: {
    minWidth: 0,
    flexShrink: 1,
    maxWidth: "100%",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  personWeightPlan: {
    position: "absolute",
    zIndex: 2,
    left: -22,
    right: -22,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  personWeightPlanText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  avatarSourceEditor: {
    maxWidth: 330,
    width: "92%",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 5,
  },
  avatarSourceChoices: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  avatarSourceChoice: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 15,
  },
  avatarSourceChoiceText: { fontSize: 10, lineHeight: 13, fontWeight: "900" },
  avatarSourceDone: { minHeight: 30, justifyContent: "center", paddingHorizontal: 5 },
  avatarSourceDoneText: { fontSize: 10, lineHeight: 13, fontWeight: "800" },
  avatarSourceFallback: { textAlign: "center", fontSize: 9, lineHeight: 12, fontWeight: "700" },
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
