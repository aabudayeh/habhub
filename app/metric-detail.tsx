import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale, useLocalization } from "@/src/i18n";
import {
  localizeExerciseName,
  localizeSubmetricName,
  localizeSubmetricUnit,
  translateDomainText,
} from "@/src/i18n/domain";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { FastingClockEditor } from "@/src/components/FastingClockEditor";
import { FastingProgressBar } from "@/src/components/FastingProgressBar";
import { InfoPopover } from "@/src/components/InfoPopover";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { TimeInput } from "@/src/components/TimeInput";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  Card,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import {
  dateKey,
  dateWithOffsetFrom,
  formatClockTime,
  friendlyDate,
  monthDateRange,
  yearDateRange,
} from "@/src/domain/date";
import {
  DEFICIT_ALIGNMENT_CLOSE_KCAL,
  deficitAlignmentBand,
  deficitRealityCheckAtDate,
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  hasMetricData,
  metricAverageGoalOffsetLabel,
  metricApplicableOnDate,
  metricChartTarget,
  metricOverallAverage,
  metricHistoricalRecords,
  metricJourneyProgressStats,
  metricPeriodStats,
  metricStreakStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  weeklyBalancePeriodReport,
  weightDailyGoalStatus,
  weightProgressStats,
} from "@/src/domain/metrics";
import {
  compoundMetricValues,
  formatCompoundMetricValue,
  submetricAsMetric,
  submetricValue,
} from "@/src/domain/submetrics";
import {
  LeaderboardPeriod,
  periodDates,
  periodTitle,
  shiftedPeriodAnchor,
} from "@/src/domain/leaderboard";
import { useApp } from "@/src/state/AppProvider";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { AppLanguage, MetricChartStyle, MetricDefinition } from "@/src/types";
import { cycleForecast } from "@/src/domain/cycle";
import { isVacationDate } from "@/src/domain/vacation";
import {
  todoAppearsOnDate,
  todoCompletedOnDate,
  todoResolvedOnDate,
  todoSkippedOnDate,
} from "@/src/domain/schedule";
import { flattenTodoHierarchy, todoLabels } from "@/src/domain/todos";
import {
  completedGymSets,
  gymSessionClockBounds,
  gymSessionMetricValue,
  trainingVolumeKg,
} from "@/src/domain/gym";
import { metricVisualization } from "@/src/domain/visualization";
import {
  completedFastDetails,
  fastingProgressForDate,
} from "@/src/domain/fasting";
import { ScreenTimeBreakdownCard } from "@/src/screenTime/ScreenTimeBreakdownCard";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import {
  FOOD_MACROS,
  FOOD_NUTRIENTS,
  FoodMacroId,
  FoodMacroRange,
  FoodMacroSlice,
  FoodNutrientBucket,
  FoodNutrientId,
  FoodNutrientSummary,
  foodNutrientDetailEntries,
  foodNutritionReport,
  editFoodEntryClockTime,
  isFoodNutrientDetailEntry,
  isFoodNutrientTrackerId,
} from "@/src/domain/food";
import { trackerPresets } from "@/src/domain/trackerCatalog";
import { isGoogleHealthEntry } from "@/src/domain/googleHealthLocalPrivacy";
import { totalEnergyBurnedBreakdownEntries } from "@/src/domain/energyBreakdown";
import {
  GoogleHealthClientError,
  invokeGoogleHealth,
} from "@/src/health/googleHealthWeb";

const DETAIL_PERIODS: { id: Exclude<LeaderboardPeriod, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "overall", label: "All time" },
];

function OptionalTutorialTarget({
  enabled,
  id,
  children,
}: React.PropsWithChildren<{ enabled: boolean; id: string }>) {
  return enabled ? (
    <TutorialTarget id={id}>{children}</TutorialTarget>
  ) : (
    <>{children}</>
  );
}

export default function TrackerDetail() {
  const {
    metric: trackerId,
    date,
    period: requestedPeriod,
    focusTodo,
    todoFocusAt,
  } = useLocalSearchParams<{
    metric: string;
    date?: string;
    period?: LeaderboardPeriod;
    focusTodo?: string;
    todoFocusAt?: string;
  }>();
  const {
    state: persistedState,
    deleteEntry,
    purgeGoogleHealthEntry,
    updateFoodEntryTime,
    deletePhoto,
    skipGoal,
    updateMetric,
    startFast,
    endFast,
  } = useApp();
  const cloud = useCloudSyncActions();
  const tutorial = useTutorial();
  const locale = useLocale();
  const { language, t } = useLocalization();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [day, setDay] = useState(date ?? dateKey());
  const [period, setPeriod] = useState<LeaderboardPeriod>(
    requestedPeriod ?? "today",
  );
  useEffect(() => {
    if (date) setDay(date);
    if (requestedPeriod) setPeriod(requestedPeriod);
  }, [date, requestedPeriod, todoFocusAt]);
  const [dateNavigatorOpen, setDateNavigatorOpen] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [photoCompareOpen, setPhotoCompareOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [collapsedEntryDates, setCollapsedEntryDates] = useState<string[]>([]);
  const [editingFoodEntryId, setEditingFoodEntryId] = useState<string>();
  const [foodTimeDraft, setFoodTimeDraft] = useState("12:00");
  const [foodTimeSaving, setFoodTimeSaving] = useState(false);
  const [dismissingGoogleEntryId, setDismissingGoogleEntryId] =
    useState<string>();
  const lastFoodTapRef = useRef<{ entryId: string; at: number } | undefined>(
    undefined,
  );
  const detailScrollRef = useRef<ScrollView>(null);
  const scrollToTodo = useCallback((y: number) => {
    detailScrollRef.current?.scrollTo({ y, animated: true });
  }, []);
  const weekly =
    trackerId === "weekly_deficit_balance" || trackerId === "weekly_deficit";
  const persistedTracker = persistedState.metrics.find(
    (item) => item.id === trackerId,
  );
  const virtualNutrientTracker = useMemo<MetricDefinition | undefined>(() => {
    if (persistedTracker || !isFoodNutrientTrackerId(trackerId)) return undefined;
    const nutrient = FOOD_NUTRIENTS.find((item) => item.id === trackerId);
    if (!nutrient) return undefined;
    const preset = trackerPresets(persistedState, true).find(
      (item) => item.templateId === trackerId,
    );
    if (!preset) return undefined;
    const firstFoodDate = persistedState.entries
      .filter(
        (entry) =>
          entry.userId === persistedState.currentUserId &&
          entry.metricId === "food" &&
          Number(entry.nutrition?.[nutrient.nutritionKey]) > 0,
      )
      .map((entry) => entry.localDate)
      .sort()[0];
    return {
      ...preset,
      id: trackerId,
      scoreWeight: 0,
      sections: { today: false, group: false, insights: false },
      order: persistedState.metrics.length,
      activeFrom: firstFoodDate ?? dateKey(),
    };
  }, [persistedState, persistedTracker, trackerId]);
  const tracker = persistedTracker ?? virtualNutrientTracker;
  const state = useMemo(() => {
    if (!isFoodNutrientTrackerId(trackerId)) return persistedState;
    const entries = foodNutrientDetailEntries(
      persistedState.entries,
      persistedState.currentUserId,
      trackerId,
    );
    if (entries === persistedState.entries && !virtualNutrientTracker)
      return persistedState;
    return {
      ...persistedState,
      metrics: virtualNutrientTracker
        ? [...persistedState.metrics, virtualNutrientTracker]
        : persistedState.metrics,
      entries: [...entries],
    };
  }, [persistedState, trackerId, virtualNutrientTracker]);
  const historicalRecords = useMemo(
    () =>
      tracker && recordsOpen
        ? metricHistoricalRecords(
            state,
            tracker,
            state.currentUserId,
            dateKey(),
            state.settings.weekStartsOn ?? 1,
            locale,
          )
        : {},
    [locale, recordsOpen, state, tracker],
  );
  const dates = useMemo(
    () => periodDates(period, day, state.settings.weekStartsOn ?? 1),
    [day, period, state.settings.weekStartsOn],
  );
  useEffect(() => {
    const collapsedByDefault = ["week", "month", "year", "overall"].includes(
      period,
    );
    setCollapsedEntryDates(collapsedByDefault ? dates : []);
  }, [dates, period]);
  function shiftRange(direction: number) {
    const next = shiftedPeriodAnchor(
      period,
      day,
      direction < 0 ? -1 : 1,
    );
    if (!next) return;
    if (period === "today" || period === "yesterday") setPeriod("custom");
    setDay(next);
  }
  const chooseDetailPeriod = useCallback(
    (next: Exclude<LeaderboardPeriod, "custom">) => {
      setPeriod(next);
      if (next === "today") setDay(dateKey());
      if (next === "yesterday")
        setDay(dateWithOffsetFrom(dateKey(), -1));
      if (next === "overall") setCalendarOpen(false);
    },
    [],
  );
  function toggleDateNavigator() {
    if (dateNavigatorOpen) setCalendarOpen(false);
    setDateNavigatorOpen((open) => !open);
  }
  const pageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) > 22 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          const currentIndex =
            period === "custom"
              ? 1
              : DETAIL_PERIODS.findIndex((item) => item.id === period);
          const direction = gesture.dx < 0 ? 1 : -1;
          const next = DETAIL_PERIODS[currentIndex + direction];
          if (next) chooseDetailPeriod(next.id);
        },
      }),
    [chooseDetailPeriod, period],
  );
  if (weekly)
    return (
      <WeeklyDetail
        state={state}
        day={day}
        setDay={setDay}
        period={period}
        setPeriod={setPeriod}
        choosePeriod={chooseDetailPeriod}
        dateNavigatorOpen={dateNavigatorOpen}
        toggleDateNavigator={toggleDateNavigator}
        calendarOpen={calendarOpen}
        setCalendarOpen={setCalendarOpen}
        shiftRange={shiftRange}
        swipeHandlers={pageSwipeResponder.panHandlers}
        colors={colors}
        accent={accent}
      />
    );
  if (!tracker)
    return (
      <Screen>
        <PageHeader
          title="Tracker not found"
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          }
        />
      </Screen>
    );
  const isBloodPressure =
    tracker.id === "blood_pressure_systolic" ||
    (tracker.healthMapping?.dataType === "blood_pressure" &&
      tracker.healthMapping.field === "systolic");
  const visualization = metricVisualization(tracker);
  const trackerEntries = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === tracker.id &&
        dates.includes(entry.localDate) &&
        (!tracker.gymMapping || !entry.id.startsWith("gym-sync:")),
    )
    .sort(
      (a, b) =>
        b.localDate.localeCompare(a.localDate) ||
        b.recordedAt.localeCompare(a.recordedAt),
    );
  const entries =
    tracker.id === "energy_burned"
      ? totalEnergyBurnedBreakdownEntries(
          state,
          state.currentUserId,
          dates,
        )
      : trackerEntries;
  const editingFoodEntry = editingFoodEntryId
    ? entries.find((entry) => entry.id === editingFoodEntryId)
    : undefined;
  function openFoodTimeEditor(entry: (typeof entries)[number]) {
    if (tracker?.id !== "food" || entry.source === "calculated") return;
    const recorded = new Date(entry.recordedAt);
    if (!Number.isFinite(recorded.getTime())) return;
    setFoodTimeDraft(
      `${String(recorded.getHours()).padStart(2, "0")}:${String(
        recorded.getMinutes(),
      ).padStart(2, "0")}`,
    );
    setEditingFoodEntryId(entry.id);
  }
  function handleFoodEntryTap(entry: (typeof entries)[number]) {
    if (tracker?.id !== "food" || entry.source === "calculated") return;
    const now = Date.now();
    const previous = lastFoodTapRef.current;
    lastFoodTapRef.current = { entryId: entry.id, at: now };
    if (!previous || previous.entryId !== entry.id || now - previous.at > 360)
      return;
    lastFoodTapRef.current = undefined;
    openFoodTimeEditor(entry);
  }
  async function saveFoodEntryTime() {
    if (!editingFoodEntry || foodTimeSaving) return;
    if (!isGoogleHealthEntry(editingFoodEntry)) {
      await updateFoodEntryTime(editingFoodEntry.id, foodTimeDraft);
      setEditingFoodEntryId(undefined);
      return;
    }
    const edited = editFoodEntryClockTime(
      editingFoodEntry,
      state.currentUserId,
      foodTimeDraft,
      new Date().toISOString(),
    );
    if (!edited) {
      Alert.alert("Invalid meal time", "Choose a valid time for this meal day.");
      return;
    }
    if (edited === editingFoodEntry) {
      setEditingFoodEntryId(undefined);
      return;
    }
    setFoodTimeSaving(true);
    try {
      await invokeGoogleHealth("updateEntry", {
        entryId: editingFoodEntry.id,
        patch: {
          recordedAtOverride: edited.recordedAtOverride!,
          localDate: edited.localDate,
        },
      });
      // The server owns durability. Apply the confirmed choice in memory only;
      // AppProvider's plaintext projection strips the Google row and override.
      await updateFoodEntryTime(editingFoodEntry.id, foodTimeDraft);
      setEditingFoodEntryId(undefined);
      await cloud.pullLatest().catch(() => undefined);
    } catch (error) {
      const signedOut =
        error instanceof GoogleHealthClientError &&
        error.code === "sign_in_required";
      Alert.alert(
        "Could not save Google Health time",
        signedOut
          ? "Sign in again, then retry. Google Health entry edits must be saved online."
          : "Check your connection and retry. Google Health entry edits must be confirmed by HabHub cloud before they are saved.",
      );
    } finally {
      setFoodTimeSaving(false);
    }
  }
  async function dismissEntry(entry: (typeof entries)[number]) {
    if (!isGoogleHealthEntry(entry)) {
      deleteEntry(entry.id);
      return;
    }
    if (dismissingGoogleEntryId) return;
    setDismissingGoogleEntryId(entry.id);
    try {
      await invokeGoogleHealth("dismissEntry", { entryId: entry.id });
      await purgeGoogleHealthEntry(entry.id);
      await cloud.pullLatest().catch(() => undefined);
    } catch (error) {
      const signedOut =
        error instanceof GoogleHealthClientError &&
        error.code === "sign_in_required";
      Alert.alert(
        "Could not hide Google Health entry",
        signedOut
          ? "Sign in again, then retry."
          : "Check your connection and retry. Google Health entries are hidden only after HabHub cloud confirms the change.",
      );
    } finally {
      setDismissingGoogleEntryId(undefined);
    }
  }
  function promptEntryRemoval(entry: (typeof entries)[number]) {
    const linkedFoodParent =
      isFoodNutrientTrackerId(entry.metricId) && entry.sourceRecordId
        ? state.entries.find(
            (candidate) =>
              candidate.userId === entry.userId &&
              candidate.metricId === "food" &&
              candidate.sourceProvider === entry.sourceProvider &&
              candidate.sourceRecordId === entry.sourceRecordId,
          )
        : undefined;
    if (linkedFoodParent) {
      Alert.alert(
        t("Managed from Food"),
        t(
          "This nutrient belongs to a linked food record. Open Food to manage or remove the meal without leaving its nutrition totals out of sync.",
        ),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: t("Open Food"),
            onPress: () =>
              router.push({
                pathname: "/metric-detail",
                params: {
                  metric: "food",
                  date: linkedFoodParent.localDate,
                  period,
                },
              }),
          },
        ],
      );
      return;
    }
    Alert.alert(
      entry.source === "imported" ? "Hide imported entry?" : "Delete entry?",
      entry.source === "imported"
        ? "This imported record will remain hidden after future health syncs."
        : "This removes this manually logged item.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void dismissEntry(entry),
        },
      ],
    );
  }
  const gymSourceSessions = tracker.gymMapping
    ? (state.gymSessions ?? [])
        .filter(
          (session) =>
            session.userId === state.currentUserId &&
            dates.includes(session.localDate) &&
            gymSessionMetricValue(session, tracker.gymMapping!) > 0,
        )
        .sort(
          (a, b) =>
            b.localDate.localeCompare(a.localDate) ||
            b.recordedAt.localeCompare(a.recordedAt),
        )
    : [];
  const gymEntryDates = new Set(
    gymSourceSessions.map((session) => session.localDate),
  );
  const entryCountsByDate = new Map<string, number>();
  for (const localDate of [
    ...entries.map((entry) => entry.localDate),
    ...gymSourceSessions.map((session) => session.localDate),
  ])
    entryCountsByDate.set(localDate, (entryCountsByDate.get(localDate) ?? 0) + 1);
  const entryCountForDate = (localDate: string) =>
    entryCountsByDate.get(localDate) ?? 0;
  const toggleEntryDate = (localDate: string) =>
    setCollapsedEntryDates((current) =>
      current.includes(localDate)
        ? current.filter((date) => date !== localDate)
        : [...current, localDate],
    );
  const pairedBloodPressure = (entry: (typeof entries)[number]) => {
    if (!isBloodPressure) return null;
    const diastolicId = state.metrics.find(
      (candidate) =>
        candidate.id === "blood_pressure_diastolic" ||
        (candidate.healthMapping?.dataType === "blood_pressure" &&
          candidate.healthMapping.field === "diastolic"),
    )?.id;
    const pulseId = state.metrics.find(
      (candidate) =>
        candidate.id === "pulse" ||
        candidate.healthMapping?.dataType === "heart_rate",
    )?.id;
    const companions = state.entries.filter(
      (candidate) =>
        candidate.userId === entry.userId &&
        candidate.localDate === entry.localDate &&
        [diastolicId, pulseId].includes(candidate.metricId),
    );
    const nearest = (metricId: string) =>
      companions
        .filter((candidate) => candidate.metricId === metricId)
        .sort(
          (a, b) =>
            Math.abs(new Date(a.recordedAt).getTime() - new Date(entry.recordedAt).getTime()) -
            Math.abs(new Date(b.recordedAt).getTime() - new Date(entry.recordedAt).getTime()),
        )[0];
    return {
      diastolic: diastolicId ? nearest(diastolicId) : undefined,
      pulse: pulseId ? nearest(pulseId) : undefined,
    };
  };
  const dayPhotos =
    tracker.dataType === "photo"
      ? state.photos.filter(
          (photo) =>
            photo.userId === state.currentUserId && dates.includes(photo.localDate),
        )
      : [];
  const olderPhoto =
    tracker.dataType === "photo"
      ? [...state.photos]
          .filter(
            (photo) =>
              photo.userId === state.currentUserId && photo.localDate < day,
          )
          .sort((a, b) => b.localDate.localeCompare(a.localDate))[0]
      : undefined;
  const periodStats = metricPeriodStats(
    state,
    tracker,
    state.currentUserId,
    dates,
  );
  const chartDates = periodStats.applicableDates;
  const loggedDates = periodStats.loggedDates;
  const diastolicTracker =
    isBloodPressure
      ? (state.metrics.find(
          (item) =>
            item.id === "blood_pressure_diastolic" ||
            (item.healthMapping?.dataType === "blood_pressure" &&
              item.healthMapping.field === "diastolic"),
        ) ?? {
          ...tracker,
          id: "blood_pressure_diastolic",
          name: "Diastolic pressure",
          color: "#C45B35",
          goal: { kind: "exact", target: 80 },
          goalRange: { min: 60, max: 80 },
          goalEnabled: true,
        })
      : undefined;
  const pulseTracker =
    isBloodPressure
      ? (state.metrics.find(
          (item) => item.id === "pulse" || item.healthMapping?.dataType === "heart_rate",
        ) ?? {
          ...tracker,
          id: "pulse",
          name: "Pulse",
          unit: "bpm",
          goalEnabled: false,
        })
      : undefined;
  const diastolicValues = diastolicTracker
    ? loggedDates.map((date) =>
        safeMetricValue(state, diastolicTracker, state.currentUserId, date),
      )
    : undefined;
  const trendDates =
    period === "year"
      ? yearDateRange(day)
      : period === "month"
        ? monthDateRange(day)
        : dates;
  const trendValues: (number | null)[] = trendDates.map((date) =>
    date <= dateKey() &&
    hasMetricData(state, tracker, state.currentUserId, date)
      ? safeMetricValue(state, tracker, state.currentUserId, date)
      : null,
  );
  const trendDiastolicValues: (number | null)[] | undefined =
    diastolicTracker
      ? trendDates.map((date) =>
          date <= dateKey() &&
          hasMetricData(
            state,
            diastolicTracker,
            state.currentUserId,
            date,
          )
            ? safeMetricValue(
                state,
                diastolicTracker,
                state.currentUserId,
                date,
              )
            : null,
        )
      : undefined;
  const average = periodStats.average;
  const streaks = metricStreakStats(
    state,
    tracker,
    state.currentUserId,
    dateKey(),
  );
  const overallAverage = metricOverallAverage(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const overallAverageDiastolic = diastolicTracker
    ? metricOverallAverage(
        state,
        diastolicTracker,
        state.currentUserId,
        day,
      )
    : 0;
  const applicable = metricApplicableOnDate(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const current = safeMetricValue(state, tracker, state.currentUserId, day);
  const currentDiastolic = diastolicTracker
    ? safeMetricValue(state, diastolicTracker, state.currentUserId, day)
    : 0;
  const currentPulse = pulseTracker
    ? safeMetricValue(state, pulseTracker, state.currentUserId, day)
    : 0;
  const compoundValues = compoundMetricValues(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const mergedCompoundValue = formatCompoundMetricValue(
    tracker,
    compoundValues,
  );
  const progressSubmetrics = (tracker.submetrics ?? [])
    .filter((submetric) => submetric.showProgressBar)
    .slice(0, 4);
  const submetricSamples = new Map<string, Map<string, number[]>>();
  if (!isBloodPressure && progressSubmetrics.length) {
    progressSubmetrics.forEach((submetric) =>
      submetricSamples.set(submetric.id, new Map()),
    );
    entries.forEach((entry) => {
      progressSubmetrics.forEach((submetric) => {
        const value = entry.submetricValues?.[submetric.id];
        if (!Number.isFinite(value)) return;
        const byDate = submetricSamples.get(submetric.id)!;
        byDate.set(entry.localDate, [
          ...(byDate.get(entry.localDate) ?? []),
          value as number,
        ]);
      });
    });
  }
  const aggregateSubmetric = (values: number[]) => {
    if (!values.length) return null;
    if (tracker.aggregation === "average")
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    if (tracker.aggregation === "max") return Math.max(...values);
    if (tracker.aggregation === "min") return Math.min(...values);
    if (tracker.aggregation === "latest") return values.at(-1) ?? null;
    return values.reduce((sum, value) => sum + value, 0);
  };
  const submetricTrendSeries = progressSubmetrics.map((submetric) => ({
    submetric,
    definition: submetricAsMetric(tracker, submetric),
    values: trendDates.map((date) => {
      const captured = aggregateSubmetric(
        submetricSamples.get(submetric.id)?.get(date) ?? [],
      );
      if (captured !== null) return captured;
      const linked = submetric.linkedMetricId
        ? state.metrics.find(
            (metric) => metric.id === submetric.linkedMetricId,
          )
        : undefined;
      const parentOwnsValue =
        submetric.id === tracker.id ||
        submetric.id === "value" ||
        (submetric.id === "systolic" &&
          tracker.healthMapping?.dataType === "blood_pressure" &&
          tracker.healthMapping.field === "systolic") ||
        (Boolean(tracker.healthMapping) &&
          tracker.healthMapping?.dataType === submetric.healthMapping?.dataType &&
          tracker.healthMapping?.field === submetric.healthMapping?.field);
      if (
        (linked &&
          hasMetricData(state, linked, state.currentUserId, date)) ||
        (parentOwnsValue &&
          hasMetricData(state, tracker, state.currentUserId, date))
      )
        return submetricValue(
          state,
          tracker,
          submetric,
          state.currentUserId,
          date,
        );
      return null;
    }),
  }));
  const averageDiastolic = diastolicValues?.length
    ? diastolicValues.reduce((sum, value) => sum + value, 0) /
      diastolicValues.length
    : 0;
  const isPhoto = tracker.dataType === "photo";
  const formatRecordValue = (value: number) =>
    tracker.id === "todo_completion"
      ? `${Math.round(value)} completed`
      : formatMetricValue(tracker, value);
  const weightStats =
    tracker.id === "weight"
      ? weightProgressStats(state, state.currentUserId, day)
      : null;
  const weightDayStatus =
    tracker.id === "weight"
      ? weightDailyGoalStatus(state, state.currentUserId, day)
      : null;
  const journeyStats =
    tracker.goalProgressMode === "journey"
      ? metricJourneyProgressStats(
          state,
          tracker,
          state.currentUserId,
          day,
        )
      : null;
  const displayAvailable =
    tracker.id === "weight"
      ? Boolean(weightStats?.hasMeasurement)
      : journeyStats
        ? journeyStats.hasMeasurement
      : applicable &&
        (tracker.dataType === "calculated" ||
          (dates.length === 1
            ? hasData(state, tracker, day)
            : loggedDates.length > 0));
  const target = effectiveGoalTarget(state, tracker, state.currentUserId, day);
  const chartTarget = metricChartTarget(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const displayedTarget =
    dates.length === 1 ? target : periodStats.averageTarget;
  const displayedValue =
    weightStats?.currentWeight ??
    journeyStats?.current ??
    (dates.length === 1 ? current : average);
  const dayGoalMet =
    dates.length === 1 &&
    displayAvailable &&
    scheduledGoalReached(state, tracker, state.currentUserId, day);
  const diastolicTarget = diastolicTracker
    ? effectiveGoalTarget(
        state,
        diastolicTracker,
        state.currentUserId,
        day,
      )
    : 0;
  const systolicDayMet =
    displayAvailable && goalReached(tracker, current, target);
  const diastolicDayMet =
    Boolean(diastolicTracker) &&
    displayAvailable &&
    goalReached(diastolicTracker!, currentDiastolic, diastolicTarget);
  const latestWeightDate = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === "weight" &&
        entry.localDate <= day,
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate))[0]?.localDate;
  const reality =
    tracker.id === "weight" && latestWeightDate
      ? deficitRealityCheckAtDate(state, state.currentUserId, latestWeightDate)
      : null;
  const realityBand = reality ? deficitAlignmentBand(reality) : "neutral";
  const realityColor =
    realityBand === "close"
      ? palette.lime
      : realityBand === "warning"
        ? palette.amber
        : realityBand === "far"
          ? palette.red
          : colors.border;
  const canSkipToday =
    Boolean(persistedTracker) &&
    day === dateKey() &&
    tracker.goalEnabled !== false;
  const isFasting = Boolean(tracker.fastingSettings);
  const automaticFasting =
    isFasting && tracker.fastingSettings?.automaticFoodBreak === true;
  const fastingProgress = isFasting
    ? fastingProgressForDate(
        state,
        state.currentUserId,
        day,
        new Date(),
        tracker.id,
      )
    : undefined;
  const canControlFast =
    isFasting && dates.length === 1 && day === dateKey();
  const canAddEntry =
    Boolean(persistedTracker) &&
    tracker.id !== "todo_completion" &&
    tracker.id !== "steps" &&
    !isFasting &&
    tracker.manualEntry !== false &&
    tracker.dataType !== "calculated";
  const canOpenWorkout = tracker.id === "workout";
  return (
    <Screen scrollRef={detailScrollRef}>
      <PageHeader
        tutorialId="metric-detail-header"
        title={tracker.name}
        translateTitle={false}
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            <IconButton
              icon="book-outline"
              label={`Open ${tracker.name} journal notes`}
              onPress={() =>
                router.navigate({
                  pathname: "/journal",
                  params: { metric: tracker.id },
                } as never)
              }
            />
            <IconButton
              icon="calendar-outline"
              label="Open schedule"
              onPress={() => router.navigate("/calendar" as never)}
            />
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          </View>
        }
      />
      <View {...pageSwipeResponder.panHandlers}>
      <View style={styles.controls}>
        <Card style={styles.periodCard}>
          <View style={styles.periodBar}>
            {DETAIL_PERIODS.map((item) => {
              const selectedPeriod = period === item.id;
              const showDateToggle =
                selectedPeriod && item.id !== "overall";
              const selectedOverall =
                selectedPeriod && item.id === "overall";
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showDateToggle
                      ? `${item.label}, ${dateNavigatorOpen ? "collapse" : "expand"} date view`
                      : item.label
                  }
                  accessibilityState={{
                    selected: selectedPeriod,
                    disabled: selectedOverall,
                    expanded: showDateToggle
                      ? dateNavigatorOpen
                      : undefined,
                  }}
                  disabled={selectedOverall}
                  onPress={() => {
                    if (showDateToggle) toggleDateNavigator();
                    else chooseDetailPeriod(item.id);
                  }}
                  style={[
                    styles.periodChoice,
                    item.id === "yesterday"
                      ? styles.periodChoiceYesterday
                      : item.id === "overall"
                        ? styles.periodChoiceOverall
                        : null,
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
                    minimumFontScale={0.68}
                    style={[
                      styles.periodText,
                      { color: selectedPeriod ? accent : colors.muted },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {showDateToggle ? (
                    <Ionicons
                      name={dateNavigatorOpen ? "chevron-up" : "chevron-down"}
                      size={7}
                      color={accent}
                      style={styles.periodChevron}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Card>
        {period !== "overall" && dateNavigatorOpen ? (
          <Card style={styles.navigator}>
          <View style={styles.dateNav}>
            <IconButton
              icon="chevron-back"
              label="Previous"
              onPress={() => shiftRange(-1)}
            />
            <Pressable
              onPress={() => setCalendarOpen((open) => !open)}
              style={styles.navCopy}
            >
              <Text style={[styles.navTitle, { color: colors.ink }]}>
                {periodTitle(period, day)}
              </Text>
              <View style={styles.navDate}>
                <Ionicons name="calendar-outline" size={13} color={accent} />
                <Text style={[styles.navSub, { color: colors.muted }]}>
                  {dates.length > 1
                    ? `${friendlyDate(dates[0], locale)} – ${friendlyDate(dates[dates.length - 1], locale)}`
                    : friendlyDate(day, locale)}
                </Text>
                <Ionicons
                  name={calendarOpen ? "chevron-up" : "chevron-down"}
                  size={13}
                  color={colors.muted}
                />
              </View>
            </Pressable>
            <IconButton
              icon="chevron-forward"
              label="Next"
              onPress={() => shiftRange(1)}
            />
          </View>
          {calendarOpen ? (
            <View style={[styles.calendar, { borderTopColor: colors.border }]}>
              <MonthCalendar
                monthDate={day}
                selectedDate={day}
                onSelect={(selectedDay) => {
                  setDay(selectedDay);
                  setPeriod("custom");
                  setCalendarOpen(false);
                }}
                hasActivity={(localDate) =>
                  hasData(state, tracker, localDate)
                }
                dayVisuals={(localDate) => {
                  if (!hasData(state, tracker, localDate)) return [];
                  const localTarget = effectiveGoalTarget(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  );
                  const localValue = safeMetricValue(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  );
                  const visuals = [
                    {
                      color: tracker.color,
                      progress: displayGoalProgress(
                        tracker,
                        localValue,
                        localTarget,
                      ),
                      goalReached: scheduledGoalReached(
                        state,
                        tracker,
                        state.currentUserId,
                        localDate,
                      ),
                    },
                  ];
                  if (diastolicTracker) {
                    const localDiastolicTarget = effectiveGoalTarget(
                      state,
                      diastolicTracker,
                      state.currentUserId,
                      localDate,
                    );
                    const localDiastolicValue = safeMetricValue(
                      state,
                      diastolicTracker,
                      state.currentUserId,
                      localDate,
                    );
                    visuals.push({
                      color: diastolicTracker.color,
                      progress: displayGoalProgress(
                        diastolicTracker,
                        localDiastolicValue,
                        localDiastolicTarget,
                      ),
                      goalReached: goalReached(
                        diastolicTracker,
                        localDiastolicValue,
                        localDiastolicTarget,
                      ),
                    });
                  }
                  return visuals;
                }}
                allTrackedGoalsMet={(localDate) =>
                  hasData(state, tracker, localDate) &&
                  scheduledGoalReached(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  )
                }
                vacationDay={(localDate) =>
                  isVacationDate(state, state.currentUserId, localDate)
                }
              />
            </View>
          ) : null}
          </Card>
        ) : null}
      </View>
      {canSkipToday || canAddEntry || canOpenWorkout || tracker.timerEnabled || isFasting ? (
        <OptionalTutorialTarget enabled={isFasting} id="fasting-controls">
          <View style={styles.detailQuickActions}>
          {canSkipToday ? (
            <Pressable
              onPress={() =>
                Alert.alert(
                  `Skip ${tracker.name} today?`,
                  "This counts today as complete and records a visible skip entry that you can delete later.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Skip today", onPress: () => skipGoal(tracker.id, day) },
                  ],
                )
              }
              style={[
                styles.skipToday,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Ionicons name="play-skip-forward-outline" size={16} color={accent} />
              <Text style={[styles.skipTodayText, { color: accent }]}>Skip today</Text>
            </Pressable>
          ) : null}
          {canAddEntry ? (
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/(tabs)/log",
                  params: { metric: tracker.id, date: day },
                })
              }
              style={[
                styles.skipToday,
                { borderColor: accent, backgroundColor: accent },
              ]}
            >
              <Ionicons name="add" size={16} color={palette.white} />
              <Text style={styles.quickAddText}>Add</Text>
            </Pressable>
          ) : null}
          {canOpenWorkout ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open workout page"
              onPress={() => router.navigate("/gym" as never)}
              style={[
                styles.skipToday,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.primarySoft,
                },
              ]}
            >
              <Ionicons name="barbell-outline" size={16} color={accent} />
              <Text style={[styles.skipTodayText, { color: accent }]}>Workout</Text>
            </Pressable>
          ) : null}
          {tracker.timerEnabled && !isFasting ? (
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/timer",
                  params: { metric: tracker.id },
                } as never)
              }
              style={[
                styles.skipToday,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.primarySoft,
                },
              ]}
            >
              <Ionicons name="timer-outline" size={16} color={accent} />
              <Text style={[styles.skipTodayText, { color: accent }]}>Timer</Text>
            </Pressable>
          ) : null}
          {canControlFast ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                fastingProgress?.active ? "End fast" : "Start fast"
              }
              onPress={() => {
                if (fastingProgress?.active) endFast(tracker.id);
                else startFast(tracker.id);
                tutorial.reportEvent({
                  actionId: "tutorial.fasting.toggle",
                  scope: "isolated-preview",
                });
              }}
              style={[
                styles.skipToday,
                {
                  borderColor: fastingProgress?.active ? palette.red : accent,
                  backgroundColor: fastingProgress?.active
                    ? `${palette.red}18`
                    : accent,
                },
              ]}
            >
              <Ionicons
                name={fastingProgress?.active ? "stop-circle" : "play-circle"}
                size={16}
                color={fastingProgress?.active ? palette.red : palette.white}
              />
              <Text
                style={[
                  styles.skipTodayText,
                  {
                    color: fastingProgress?.active
                      ? palette.red
                      : palette.white,
                  },
                ]}
              >
                {fastingProgress?.active ? "End fast" : "Start fast"}
              </Text>
            </Pressable>
          ) : null}
          {isFasting ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: automaticFasting }}
              accessibilityLabel="Automatic fasting"
              onPress={() =>
                updateMetric(tracker.id, {
                  fastingSettings: {
                    startTime: tracker.fastingSettings?.startTime ?? "20:00",
                    fastingMinutes:
                      tracker.fastingSettings?.fastingMinutes ?? 16 * 60,
                    automaticFoodBreak: !automaticFasting,
                  },
                })
              }
              style={[
                styles.skipToday,
                {
                  borderColor: automaticFasting ? accent : colors.border,
                  backgroundColor: automaticFasting
                    ? colors.primarySoft
                    : colors.card,
                },
              ]}
            >
              <Ionicons
                name={automaticFasting ? "sync" : "sync-outline"}
                size={16}
                color={automaticFasting ? accent : colors.muted}
              />
              <Text
                style={[
                  styles.skipTodayText,
                  { color: automaticFasting ? accent : colors.muted },
                ]}
              >
                Auto {automaticFasting ? "on" : "off"}
              </Text>
            </Pressable>
          ) : null}
          </View>
        </OptionalTutorialTarget>
      ) : null}
      {tracker.id === "screen_time" ? (
        <ScreenTimeBreakdownCard dates={dates} />
      ) : null}
      {isFasting ? (
        <FastingClockEditor
          startTime={tracker.fastingSettings?.startTime ?? "20:00"}
          fastingMinutes={
            tracker.fastingSettings?.fastingMinutes ?? 16 * 60
          }
          metricColor={tracker.color}
          timeFormat={state.settings.timeFormat ?? "24h"}
          locale={locale}
          onChange={(startTime, fastingMinutes) =>
            updateMetric(tracker.id, {
              fastingSettings: {
                startTime,
                fastingMinutes,
                automaticFoodBreak:
                  tracker.fastingSettings?.automaticFoodBreak ?? true,
              },
            })
          }
        />
      ) : null}
      <Card style={styles.summary}>
        <TutorialTarget id="metric-detail-summary">
          <View style={styles.summaryTop}>
          <View>
            <Text style={[styles.label, { color: colors.faint }]}>
              {dates.length === 1
                ? day === dateKey()
                  ? "TODAY"
                  : friendlyDate(day, locale).toUpperCase()
                : `${dates.length}-DAY AVERAGE`}
            </Text>
            <Text style={[styles.value, { color: colors.ink }]}>
              {isPhoto
                ? `${dayPhotos.length} photo${dayPhotos.length === 1 ? "" : "s"}`
                : !displayAvailable
                  ? "Not available"
                  : weightStats
                    ? formatMetricValue(tracker, weightStats.currentWeight)
                  : dates.length === 1 && mergedCompoundValue
                    ? mergedCompoundValue
                  : isBloodPressure
                    ? `${Math.round(dates.length === 1 ? current : average)}/${Math.round(dates.length === 1 ? currentDiastolic : averageDiastolic)} mmHg`
                  : formatMetricValue(
                      tracker,
                      dates.length === 1 ? current : average,
                    )}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {isBloodPressure && currentPulse > 0
                ? `Pulse ${Math.round(currentPulse)} bpm`
                : summaryLine(
                    state,
                    tracker,
                    day,
                    displayedValue,
                    displayedTarget,
                    applicable,
                  )}
            </Text>
          </View>
          <View
            style={[
              styles.largeIcon,
              { backgroundColor: `${tracker.color}18` },
            ]}
          >
            <Ionicons
              name={tracker.icon as keyof typeof Ionicons.glyphMap}
              size={23}
              color={tracker.color}
            />
          </View>
          </View>
        </TutorialTarget>
        {weightStats && dates.length === 1 ? (
          <View style={styles.weightJourney}>
            <View style={styles.weightJourneyLabels}>
              <View>
                <Text style={[styles.weightJourneyLabel, { color: colors.muted }]}>
                  START
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {weightStats.startingWeight.toFixed(1)} kg
                </Text>
              </View>
              <View style={styles.weightJourneyCurrent}>
                <Text style={[styles.weightJourneyLabel, { color: tracker.color }]}>
                  CURRENT
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {weightStats.currentWeight.toFixed(1)} kg
                </Text>
              </View>
              <View style={styles.weightJourneyTarget}>
                <Text style={[styles.weightJourneyLabel, { color: colors.muted }]}>
                  TARGET
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {weightStats.finalTarget.toFixed(1)} kg
                </Text>
              </View>
            </View>
            <ProgressBar
              progress={weightStats.progress}
              color={weightStats.progress >= 1 ? palette.lime : tracker.color}
            />
            <Text style={[styles.weightJourneyCaption, { color: colors.muted }]}>
              {Math.round(weightStats.progress * 100)}% of the full weight journey
              completed
            </Text>
            {weightDayStatus ? (
              <Text
                style={[
                  styles.weightJourneyCaption,
                  {
                    color: !weightDayStatus.hasMeasurement
                      ? colors.muted
                      : weightDayStatus.reached
                        ? palette.lime
                        : colors.ink,
                  },
                ]}
              >
                Daily pace: {weightDayStatus.expected.toFixed(1)} kg
                {weightDayStatus.direction === "lose"
                  ? " or below"
                  : weightDayStatus.direction === "gain"
                    ? " or above"
                    : " ± 0.2 kg"}
                {weightDayStatus.hasMeasurement
                  ? weightDayStatus.reached
                    ? " · on pace"
                    : " · not on pace"
                  : " · weigh in to assess"}
              </Text>
            ) : null}
          </View>
        ) : null}
        {journeyStats && dates.length === 1 ? (
          <View style={styles.weightJourney}>
            <View style={styles.weightJourneyLabels}>
              <View>
                <Text style={[styles.weightJourneyLabel, { color: colors.muted }]}>
                  START
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {journeyStats.hasMeasurement
                    ? formatMetricValue(tracker, journeyStats.starting)
                    : "Not logged"}
                </Text>
              </View>
              <View style={styles.weightJourneyCurrent}>
                <Text style={[styles.weightJourneyLabel, { color: tracker.color }]}>
                  CURRENT
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {journeyStats.hasMeasurement
                    ? formatMetricValue(tracker, journeyStats.current)
                    : "—"}
                </Text>
              </View>
              <View style={styles.weightJourneyTarget}>
                <Text style={[styles.weightJourneyLabel, { color: colors.muted }]}>
                  TARGET
                </Text>
                <Text style={[styles.weightJourneyValue, { color: colors.ink }]}>
                  {formatMetricValue(tracker, journeyStats.target)}
                </Text>
              </View>
            </View>
            <ProgressBar
              progress={journeyStats.progress}
              color={
                journeyStats.progress >= 1 ? palette.lime : tracker.color
              }
            />
            <Text style={[styles.weightJourneyCaption, { color: colors.muted }]}>
              {Math.round(journeyStats.progress * 100)}% of the long-term goal
              completed
            </Text>
          </View>
        ) : null}
        {dates.length === 1 &&
        isFasting &&
        fastingProgress?.startedAt &&
        visualization.detailDay !== "none" ? (
          <TutorialTarget id="metric-detail-chart">
            <View style={styles.dayProgress}>
            <FastingProgressBar
              startedAt={fastingProgress.startedAt}
              endedAt={fastingProgress.endedAt}
              active={fastingProgress.active}
              locale={locale}
              targetMinutes={fastingProgress.targetMinutes}
              metricColor={tracker.color}
              timeFormat={state.settings.timeFormat ?? "24h"}
              endedOutsideEatingWindow={
                fastingProgress.endedOutsideEatingWindow
              }
            />
            </View>
          </TutorialTarget>
        ) : null}
        {dates.length === 1 &&
        displayAvailable &&
        (tracker.goalEnabled !== false || progressSubmetrics.length > 0) &&
        !isPhoto &&
        !isFasting &&
        !weightStats &&
        !journeyStats &&
        visualization.detailDay !== "none" ? (
          <TutorialTarget id="metric-detail-chart">
            <View style={styles.dayProgress}>
            {progressSubmetrics.length && !isBloodPressure ? (
              progressSubmetrics.map((submetric) => {
                const definition = submetricAsMetric(tracker, submetric);
                const subValue = compoundValues[submetric.id] ?? 0;
                const subMet = goalReached(
                  definition,
                  subValue,
                  submetric.goal.target,
                );
                return (
                  <View key={submetric.id}>
                    <View style={styles.dayProgressHeading}>
                      <Text
                        translate={false}
                        style={[
                          styles.dayProgressLabel,
                          { color: colors.muted },
                        ]}
                      >
                        {localizeSubmetricName(language, tracker, submetric)}
                      </Text>
                      <Text
                        style={[
                          styles.dayProgressLabel,
                          { color: subMet ? palette.lime : colors.ink },
                        ]}
                      >
                        {Math.round(subValue * 10) / 10} {localizeSubmetricUnit(language, tracker, submetric)}
                      </Text>
                    </View>
                    {visualization.detailDay !== "completion" ? (
                      <ProgressBar
                        progress={goalProgress(
                          definition,
                          subValue,
                          submetric.goal.target,
                        )}
                        color={subMet ? palette.lime : tracker.color}
                        layered={submetric.goal.kind === "at_least"}
                      />
                    ) : null}
                  </View>
                );
              })
            ) : (
              <>
            <View style={styles.dayProgressHeading}>
              <Text style={[styles.dayProgressLabel, { color: colors.muted }]}>
                {isBloodPressure ? "Systolic" : "Goal progress"}
              </Text>
              <Ionicons
                name={
                  (isBloodPressure ? systolicDayMet : dayGoalMet)
                    ? "checkmark-circle"
                    : "ellipse-outline"
                }
                size={17}
                color={
                  (isBloodPressure ? systolicDayMet : dayGoalMet)
                    ? palette.lime
                    : colors.faint
                }
              />
            </View>
            {isBloodPressure ? (
              <RangeGoalProgressBar
                value={current}
                range={tracker.goalRange ?? { min: 90, max: 120 }}
                color={systolicDayMet ? palette.lime : palette.red}
                colors={colors}
                unit="mmHg"
              />
            ) : visualization.detailDay !== "completion" ? (
              <ProgressBar
                progress={metricVisualProgress(
                  state,
                  tracker,
                  state.currentUserId,
                  day,
                  current,
                  target,
                )}
                color={systolicDayMet ? palette.lime : tracker.color}
                layered={tracker.goal.kind === "at_least"}
              />
            ) : null}
            {diastolicTracker ? (
              <>
                <View style={styles.dayProgressHeading}>
                  <Text
                    style={[styles.dayProgressLabel, { color: colors.muted }]}
                  >
                    Diastolic
                  </Text>
                  <Ionicons
                    name={
                      diastolicDayMet
                        ? "checkmark-circle"
                        : "ellipse-outline"
                    }
                    size={17}
                    color={
                      diastolicDayMet ? palette.lime : colors.faint
                    }
                  />
                </View>
                <RangeGoalProgressBar
                  value={currentDiastolic}
                  range={diastolicTracker.goalRange ?? { min: 60, max: 80 }}
                  color={diastolicDayMet ? palette.lime : palette.red}
                  colors={colors}
                  unit="mmHg"
                />
              </>
            ) : null}
              </>
            )}
            </View>
          </TutorialTarget>
        ) : null}
        {dates.length > 1 &&
        displayAvailable &&
        tracker.goalEnabled !== false &&
        tracker.goal.kind === "at_least" &&
        !isPhoto &&
        !weightStats &&
        !journeyStats ? (
          <View style={styles.dayProgress}>
            <View style={styles.dayProgressHeading}>
              <Text style={[styles.dayProgressLabel, { color: colors.muted }]}>
                Average goal progress
              </Text>
              <Text style={[styles.dayProgressLabel, { color: colors.muted }]}>
                {displayedValue > displayedTarget
                  ? `${formatMetricValue(tracker, displayedValue - displayedTarget)} above`
                  : `${formatMetricValue(tracker, displayedTarget - displayedValue)} left`}
              </Text>
            </View>
            <ProgressBar
              progress={goalProgress(
                tracker,
                displayedValue,
                displayedTarget,
              )}
              color={tracker.color}
              layered
            />
          </View>
        ) : null}
        {dates.length > 1 &&
        trendValues.some((value) => value !== null) &&
        (isBloodPressure ||
          tracker.submetricDisplay?.mainValueEnabled !== false ||
          progressSubmetrics.length === 0) &&
        !isPhoto ? (
          <Trend
            values={trendValues}
            dates={dates}
            axisRange={
              period === "year"
                ? "year"
                : period === "month"
                  ? "month"
                  : undefined
            }
            tracker={tracker}
            target={chartTarget}
            colors={colors}
            secondaryValues={trendDiastolicValues}
            secondaryColor={diastolicTracker?.color}
            secondaryTarget={diastolicTracker?.goal.target}
            primaryRange={tracker.goalRange}
            secondaryRange={diastolicTracker?.goalRange}
            dense={period === "year" || period === "overall"}
            chartStyle={visualization.detailRange}
          />
        ) : null}
        {dates.length > 1 && !isBloodPressure && !isPhoto
          ? submetricTrendSeries.map(({ submetric, definition, values }) =>
              values.some((value) => value !== null) ? (
                <View key={submetric.id} style={styles.submetricTrend}>
                  <Text
                    translate={false}
                    style={[styles.submetricTrendTitle, { color: colors.ink }]}
                  >
                    {localizeSubmetricName(language, tracker, submetric)}
                  </Text>
                  <Trend
                    values={values}
                    dates={dates}
                    axisRange={
                      period === "year"
                        ? "year"
                        : period === "month"
                          ? "month"
                          : undefined
                    }
                    tracker={definition}
                    target={submetric.goal.target}
                    colors={colors}
                    primaryRange={submetric.goalRange}
                    dense={period === "year" || period === "overall"}
                    chartStyle={
                      !submetric.chartStyle ||
                      submetric.chartStyle === "auto"
                        ? visualization.detailRange
                        : submetric.chartStyle
                    }
                  />
                </View>
              ) : null,
            )
          : null}
        {!isPhoto ? (
          <View style={[styles.stats, { borderColor: colors.border }]}>
            <Stat
              label="Current streak"
              value={`${streaks.current} days`}
              colors={colors}
            />
            <Stat
              label="Best streak"
              value={`${streaks.best} days`}
              colors={colors}
            />
            {dates.length > 1 ? (
              <>
                <Stat
                  label="Goals reached"
                  value={`${periodStats.goalsReached}/${chartDates.length}`}
                  colors={colors}
                />
                <Stat
                  label="Average vs goal"
                  value={metricAverageGoalOffsetLabel(
                    tracker,
                    average,
                    periodStats.averageTarget,
                  )}
                  colors={colors}
                />
              </>
            ) : null}
            {dates.length > 1 &&
            tracker.aggregation === "sum" &&
            tracker.dataType !== "boolean" ? (
              <Stat
                label="Period total"
                value={formatMetricValue(tracker, periodStats.total)}
                colors={colors}
              />
            ) : null}
            <Stat
              label="Overall average"
              value={
                isBloodPressure
                  ? `${Math.round(overallAverage)}/${Math.round(overallAverageDiastolic)} mmHg`
                  : formatMetricValue(tracker, overallAverage)
              }
              colors={colors}
            />
          </View>
        ) : null}
        {state.trackedGoalPeriods[tracker.id]?.length ? (
          <Text style={[styles.trackingSince, { color: colors.muted }]}>
            Goal tracked since {new Date(`${state.trackedGoalPeriods[tracker.id].find((period) => !period.to)?.from ?? state.trackedGoalPeriods[tracker.id][0].from}T12:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
          </Text>
        ) : null}
      </Card>
      {tracker.id === "food" ? (
        <FoodNutritionSection
          state={state}
          period={period as FoodMacroRange}
          dates={dates}
          anchorDate={day}
          locale={locale}
        />
      ) : null}
      {!isPhoto ? (
        <Card style={styles.recordsCard}>
          <Pressable
            onPress={() => setRecordsOpen((open) => !open)}
            style={styles.recordsHeading}
          >
            <View style={styles.recordsTitle}>
              <Ionicons name="trophy-outline" size={17} color={tracker.color} />
              <View>
                <Text style={[styles.recordsName, { color: colors.ink }]}>
                  Records & patterns
                </Text>
                <Text style={[styles.recordsHint, { color: colors.muted }]}>
                  High points, best periods, and streak dates
                </Text>
              </View>
            </View>
            <Ionicons
              name={recordsOpen ? "chevron-up" : "chevron-down"}
              size={17}
              color={colors.muted}
            />
          </Pressable>
          {recordsOpen ? (
            <View style={[styles.recordGrid, { borderTopColor: colors.border }]}>
              <Stat
                label={
                  historicalRecords.highestWeek
                    ? `Highest week ${tracker.aggregation === "sum" ? "total" : "average"} · ${friendlyDate(historicalRecords.highestWeek.from, locale)} – ${friendlyDate(historicalRecords.highestWeek.to, locale)}`
                    : `Highest week ${tracker.aggregation === "sum" ? "total" : "average"}`
                }
                value={
                  historicalRecords.highestWeek
                    ? formatRecordValue(historicalRecords.highestWeek.value)
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label={
                  historicalRecords.highestMonth
                    ? `Highest month ${tracker.aggregation === "sum" ? "total" : "average"} · ${new Intl.DateTimeFormat(locale, {
                        month: "long",
                        year: "numeric",
                      }).format(
                        new Date(
                          `${historicalRecords.highestMonth.key}-01T12:00:00`,
                        ),
                      )}`
                    : `Highest month ${tracker.aggregation === "sum" ? "total" : "average"}`
                }
                value={
                  historicalRecords.highestMonth
                    ? formatRecordValue(historicalRecords.highestMonth.value)
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label={
                  historicalRecords.highestYear
                    ? `Highest year ${tracker.aggregation === "sum" ? "total" : "average"} · ${historicalRecords.highestYear.year}`
                    : `Highest year ${tracker.aggregation === "sum" ? "total" : "average"}`
                }
                value={
                  historicalRecords.highestYear
                    ? formatRecordValue(historicalRecords.highestYear.value)
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label="Highest average weekday"
                value={
                  historicalRecords.bestWeekday
                    ? `${historicalRecords.bestWeekday.weekday} · ${formatMetricValue(
                        tracker,
                        historicalRecords.bestWeekday.value,
                      )}`
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label="Highest average week of month"
                value={
                  historicalRecords.bestWeekOfMonth
                    ? `Week ${historicalRecords.bestWeekOfMonth.week} · ${formatMetricValue(
                        tracker,
                        historicalRecords.bestWeekOfMonth.value,
                      )}`
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label="Highest average month of year"
                value={
                  historicalRecords.bestMonthOfYear
                    ? `${historicalRecords.bestMonthOfYear.month} · ${formatMetricValue(
                        tracker,
                        historicalRecords.bestMonthOfYear.value,
                      )}`
                    : "—"
                }
                colors={colors}
              />
              <Stat
                label="Best streak period"
                value={
                  historicalRecords.bestStreak
                    ? `${historicalRecords.bestStreak.days}d · ${friendlyDate(
                        historicalRecords.bestStreak.from,
                      )} – ${friendlyDate(historicalRecords.bestStreak.to, locale)}`
                    : "—"
                }
                colors={colors}
              />
            </View>
          ) : null}
        </Card>
      ) : null}
      {["menstrual_cycle", "menstrual_flow", "cycle_day", "days_until_period"].includes(tracker.id) ? (
        <Card style={{ gap: 4 }}>
          {(() => {
            const forecast = cycleForecast(state, state.currentUserId, day);
            return <>
              <Text style={[styles.label, { color: tracker.color }]}>CYCLE ESTIMATE</Text>
              <Text style={[styles.value, { color: colors.ink }]}>Day {forecast.cycleDay || "–"} · {forecast.phase}</Text>
              <Text style={[styles.sub, { color: colors.muted }]}>
                {forecast.nextPeriodStart ? `Next period around ${friendlyDate(forecast.nextPeriodStart, locale)} · ${forecast.averageCycleDays}-day rolling average` : "Log a period start to begin estimates."}
              </Text>
              <Text style={[styles.sub, { color: colors.faint }]}>Estimates learn from up to six recent cycles; personalized after three completed cycles. Not contraception or medical advice.</Text>
            </>;
          })()}
        </Card>
      ) : null}
      {weightStats ? (
        <Card style={styles.weightPlan}>
          <Stat
            label="Total change"
            value={`${Math.abs(weightStats.totalChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Weekly average"
            value={`${Math.abs(weightStats.averageWeeklyChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Last 7 days"
            value={`${Math.abs(weightStats.lastWeekChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Plan per week"
            value={`${weightStats.expectedWeeklyChange.toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Expected goal date"
            value={
              weightStats.expectedGoalDate
                ? new Date(`${weightStats.expectedGoalDate}T12:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
                : "Maintaining"
            }
            colors={colors}
          />
        </Card>
      ) : null}
      {reality && reality.status !== "insufficient" ? (
      <Card style={{ borderColor: realityColor }}>
          <Text style={[styles.entryTitle, { color: colors.ink }]}>
            Reported vs scale-estimated energy
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {reality.status === "aligned"
                ? `The two estimates are within ${DEFICIT_ALIGNMENT_CLOSE_KCAL} kcal/day.`
                : reality.status === "noise"
                  ? "Normal scale variation is larger than the current signal. Keep logging."
                  : `Measured change and reported energy differ across ${Math.round(reality.days)} days.`}
          </Text>
            <>
              <Text style={[styles.entryValue, { color: realityColor }]}>
                Logged {state.settings.weightDirection === "gain" ? "surplus" : "deficit"} {Math.round(reality.reportedDailyDeficit)} kcal/day ·
                scale-implied {state.settings.weightDirection === "gain" ? "surplus" : "deficit"} {Math.round(reality.actualDailyDeficit)} kcal/day ·{" "}
                {Math.abs(reality.weightChangeKg).toFixed(1)} kg change
              </Text>
              {reality.estimatedDays > 0 ? (
                <Text style={[styles.sub, { color: colors.muted }]}>
                  {reality.estimatedDays} unlogged day{reality.estimatedDays === 1 ? "" : "s"} used your logged-day average.
                </Text>
              ) : null}
            </>
        </Card>
      ) : null}
      {tracker.id === "todo_completion" ? (
        <TodoTrackerEntries
          state={state}
          dates={dates}
          focusTodoId={focusTodo}
          focusToken={todoFocusAt}
          onRequestScroll={scrollToTodo}
        />
      ) : null}
      {tracker.id !== "todo_completion" ? <View style={styles.logHeader}>
        <Text style={[styles.section, { color: colors.ink }]}>
          Entries
        </Text>
        {tracker.id === "food" ? (
          <Text style={[styles.entryEditHint, { color: colors.faint }]}>Double-tap a meal to edit its time</Text>
        ) : null}
      </View> : null}
      <View style={styles.entries}>
        {gymSourceSessions.map((session, index) => {
          const contribution = gymSessionMetricValue(
            session,
            tracker.gymMapping!,
          );
          const clock = gymSessionClockBounds(session);
          const firstOnDate =
            index === 0 ||
            gymSourceSessions[index - 1].localDate !== session.localDate;
          const collapsed = collapsedEntryDates.includes(session.localDate);
          return (
            <React.Fragment key={`gym:${session.id}`}>
            {dates.length > 1 && firstOnDate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                onPress={() => toggleEntryDate(session.localDate)}
                style={[styles.dateGroupHeader, { borderColor: colors.border }]}
              >
                <Text
                  style={[styles.entryTitle, { color: colors.ink }]}
                >
                  {friendlyDate(session.localDate, locale)}
                </Text>
                <View style={styles.dateGroupMeta}>
                  <Text style={[styles.time, { color: colors.muted }]}>
                    {entryCountForDate(session.localDate)}
                  </Text>
                  <Ionicons
                    name={collapsed ? "chevron-down" : "chevron-up"}
                    size={16}
                    color={accent}
                  />
                </View>
              </Pressable>
            ) : null}
            {!collapsed ? (
            <Card style={styles.entry}>
              <View style={styles.entryTop}>
                <View style={styles.grow}>
                  <Text style={[styles.entryTitle, { color: colors.ink }]}>
                    {session.name || "Workout"}
                  </Text>
                  <Text style={[styles.time, { color: colors.faint }]}>
                    {friendlyDate(session.localDate, locale)}
                    {clock.startedAt && clock.completedAt
                      ? ` | ${formatClockTime(clock.startedAt, state.settings.timeFormat, locale)}–${formatClockTime(clock.completedAt, state.settings.timeFormat, locale)}`
                      : ` | ${formatClockTime(session.recordedAt, state.settings.timeFormat, locale)}`}
                  </Text>
                </View>
                <Text style={[styles.entryValue, { color: tracker.color }]}>
                  {formatMetricValue(tracker, contribution)}
                </Text>
              </View>
              <Text style={[styles.note, { color: colors.muted }]}>
                {completedGymSets(session.exercises)} completed sets |{" "}
                {Math.round(trainingVolumeKg(session.exercises)).toLocaleString(locale)}{" "}
                kg volume | {Math.round(session.durationMinutes)} min
              </Text>
              <Text translate={false} style={[styles.note, { color: colors.faint }]}>
                {session.exercises.map((exercise) => localizeExerciseName(language, exercise)).join(", ")}
              </Text>
            </Card>
            ) : null}
            </React.Fragment>
          );
        })}
        {entries.map((entry, index) => {
          const firstOnDate =
            index === 0 || entries[index - 1].localDate !== entry.localDate;
          const collapsed = collapsedEntryDates.includes(entry.localDate);
          const linkedGymSession = entry.id.startsWith("gym-sync:")
            ? (state.gymSessions ?? []).find((session) =>
                entry.id.startsWith(`gym-sync:${session.id}:`),
              )
            : undefined;
          const gymClock = linkedGymSession
            ? gymSessionClockBounds(linkedGymSession)
            : undefined;
          const hasFastMetadata =
            entry.submetricValues?.fast_started_at_ms !== undefined ||
            entry.submetricValues?.fast_ended_at_ms !== undefined ||
            entry.submetricValues?.fasting_minutes !== undefined;
          const fastDetails = hasFastMetadata
            ? completedFastDetails(entry)
            : undefined;
          const canEditFoodTime =
            tracker.id === "food" && entry.source !== "calculated";
          return (
          <React.Fragment key={`${entry.userId}:${entry.id}`}>
          {dates.length > 1 && firstOnDate && !gymEntryDates.has(entry.localDate) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !collapsed }}
              onPress={() => toggleEntryDate(entry.localDate)}
              style={[styles.dateGroupHeader, { borderColor: colors.border }]}
            >
              <Text style={[styles.entryTitle, { color: colors.ink }]}>
                {friendlyDate(entry.localDate, locale)}
              </Text>
              <View style={styles.dateGroupMeta}>
                <Text style={[styles.time, { color: colors.muted }]}>
                  {entryCountForDate(entry.localDate)}
                </Text>
                <Ionicons
                  name={collapsed ? "chevron-down" : "chevron-up"}
                  size={16}
                  color={accent}
                />
              </View>
            </Pressable>
          ) : null}
          {!collapsed ? (
          <Pressable
            accessibilityRole={canEditFoodTime ? "button" : undefined}
            accessibilityLabel={
              canEditFoodTime
                ? `${entry.label || tracker.name}, ${formatClockTime(
                    entry.recordedAt,
                    state.settings.timeFormat,
                    locale,
                  )}`
                : undefined
            }
            accessibilityHint={
              canEditFoodTime
                ? t("Opens the meal time editor")
                : undefined
            }
            accessibilityActions={
              canEditFoodTime
                ? [{ name: "activate", label: t("Edit meal time") }]
                : undefined
            }
            onAccessibilityAction={
              canEditFoodTime
                ? (event) => {
                    if (event.nativeEvent.actionName === "activate")
                      openFoodTimeEditor(entry);
                  }
                : undefined
            }
            onAccessibilityTap={
              canEditFoodTime
                ? () => openFoodTimeEditor(entry)
                : undefined
            }
            onPress={
              canEditFoodTime
                ? () => handleFoodEntryTap(entry)
                : undefined
            }
            delayLongPress={450}
            onLongPress={
              entry.source !== "calculated"
                ? () => promptEntryRemoval(entry)
                : undefined
            }
          >
          <Card style={styles.entry}>
            <View style={styles.entryTop}>
              <View style={styles.grow}>
                <Text style={[styles.entryTitle, { color: colors.ink }]}>
                  {fastDetails
                    ? `${t(fastDetails.startedAutomatically ? "Automatic" : "Manual")} · ${tracker.name}`
                    : entry.nutrition?.mealType
                    ? `${entry.nutrition.mealType[0].toUpperCase()}${entry.nutrition.mealType.slice(1)} · ${entry.label || tracker.name}`
                    : entry.label || tracker.name}
                </Text>
                <Text style={[styles.time, { color: colors.faint }]}>
                  {gymClock?.startedAt && gymClock.completedAt
                    ? `${formatClockTime(gymClock.startedAt, state.settings.timeFormat, locale)}–${formatClockTime(gymClock.completedAt, state.settings.timeFormat, locale)}`
                    : formatClockTime(
                        entry.recordedAt,
                        state.settings.timeFormat,
                        locale,
                      )}{" "}
                  ·{" "}
                  {fastDetails
                    ? t(fastDetails.endedAutomatically ? "Automatic" : "Manual")
                    : isFoodNutrientDetailEntry(entry)
                    ? entry.sourceOrigin || "Food log"
                    : tracker.id === "energy_burned" &&
                        entry.id.startsWith("energy-breakdown:")
                      ? entry.sourceOrigin || "Calculated"
                    : entry.source === "imported"
                    ? entry.sourceOrigin || "Health import"
                    : "Manual entry"}
                </Text>
              </View>
              <Text style={[styles.entryValue, { color: tracker.color }]}>
                {(() => {
                  const pair = pairedBloodPressure(entry);
                  if (pair?.diastolic)
                    return `${Math.round(Number(entry.value))}/${Math.round(Number(pair.diastolic.value))} mmHg${pair.pulse ? ` · ${Math.round(Number(pair.pulse.value))} bpm` : ""}`;
                  return typeof entry.value === "number"
                    ? formatMetricValue(tracker, entry.value)
                    : String(entry.value);
                })()}
              </Text>
            </View>
            {entry.note ? (
              <Text translate={false} style={[styles.note, { color: colors.muted }]}>
                {entry.note}
              </Text>
            ) : null}
            {entry.nutrition ? (
              <Text style={[styles.note, { color: colors.muted }]}>
                {nutritionLine(entry.nutrition)}
              </Text>
            ) : null}
            {fastDetails ? (
              <View style={styles.fastEntryDetails}>
                <Text style={[styles.note, { color: colors.muted }]}>
                  {t("Start")} · {formatFastDateTime(
                    fastDetails.startedAt,
                    state.settings.timeFormat ?? "24h",
                    locale,
                  )}
                </Text>
                <Text style={[styles.note, { color: colors.muted }]}>
                  {t("End")} · {formatFastDateTime(
                    fastDetails.endedAt,
                    state.settings.timeFormat ?? "24h",
                    locale,
                  )}
                </Text>
                <Text style={[styles.note, { color: colors.muted }]}>
                  {t("Duration")} · {formatFastMinutes(
                    fastDetails.minutes,
                    language,
                    locale,
                  )} · {t("Eating window")} · {formatFastMinutes(
                    fastDetails.eatingWindowMinutes,
                    language,
                    locale,
                  )}
                </Text>
              </View>
            ) : !hasFastMetadata && entry.submetricValues &&
            Object.keys(entry.submetricValues).length ? (
              <Text style={[styles.note, { color: colors.muted }]}>
                {Object.entries(entry.submetricValues)
                  .map(([id, amount]) => {
                    const submetric = tracker.submetrics?.find(
                      (item) => item.id === id,
                    );
                    return `${submetric?.name ?? id}: ${amount}${submetric?.unit ? ` ${submetric.unit}` : ""}`;
                  })
                  .join(" · ")}
              </Text>
            ) : null}
            {entry.imageUri ? (
              <ExpandableImage
                uri={entry.imageUri}
                thumbnailStyle={styles.image}
              />
            ) : null}
          </Card>
          </Pressable>
          ) : null}
          </React.Fragment>
          );
        })}
        {dayPhotos.map((photo) => (
          <Pressable
            key={photo.id}
            delayLongPress={450}
            onLongPress={() =>
              Alert.alert(
                "Delete photo?",
                "This removes this progress-photo entry.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deletePhoto(photo.id),
                  },
                ],
              )
            }
          >
          <Card style={styles.entry}>
            <Text style={[styles.entryTitle, { color: colors.ink }]}>
              {photo.caption || "Progress photo"}
            </Text>
            <Text style={[styles.time, { color: colors.faint }]}>
              {friendlyDate(photo.localDate, locale)}
            </Text>
            <ExpandableImage
              uri={photo.uri}
              containerStyle={styles.photoImageFrame}
              thumbnailStyle={styles.photoImage}
            />
            {olderPhoto ? (
              <>
                <Pressable
                  onPress={() => setPhotoCompareOpen((open) => !open)}
                  style={styles.photoToggle}
                >
                  <Text style={[styles.note, { color: colors.muted }]}>
                    Compare with {friendlyDate(olderPhoto.localDate, locale)}
                  </Text>
                  <Ionicons
                    name={photoCompareOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={accent}
                  />
                </Pressable>
                {photoCompareOpen ? (
                  <>
                    <View style={styles.photoCompare}>
                      <ExpandableImage
                        uri={photo.uri}
                        containerStyle={styles.compareImageFrame}
                        thumbnailStyle={styles.compareImage}
                      />
                      <ExpandableImage
                        uri={olderPhoto.uri}
                        containerStyle={styles.compareImageFrame}
                        thumbnailStyle={styles.compareImage}
                      />
                    </View>
                    <Pressable
                      onPress={() =>
                        router.navigate({
                          pathname: "/day/[date]",
                          params: { date: day, metrics: tracker.id },
                        } as never)
                      }
                      style={[styles.compareButton, { borderColor: accent }]}
                    >
                      <Ionicons
                        name="download-outline"
                        size={16}
                        color={accent}
                      />
                      <Text style={[styles.compareText, { color: accent }]}>
                        Open comparison & export
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </Card>
          </Pressable>
        ))}
      </View>
      <Modal
        transparent
        visible={Boolean(editingFoodEntry)}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!foodTimeSaving) setEditingFoodEntryId(undefined);
        }}
      >
        <Pressable
          style={styles.foodTimeBackdrop}
          onPress={() => {
            if (!foodTimeSaving) setEditingFoodEntryId(undefined);
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[styles.foodTimeSheet, { backgroundColor: colors.card }]}
          >
            <View style={styles.foodTimeHeading}>
              <View style={styles.grow}>
                <Text style={[styles.foodTimeTitle, { color: colors.ink }]}>Edit meal time</Text>
                <Text
                  translate={false}
                  numberOfLines={1}
                  style={[styles.foodTimeMeal, { color: colors.muted }]}
                >
                  {editingFoodEntry?.label || "Food entry"}
                </Text>
              </View>
              <Ionicons name="time-outline" size={20} color={accent} />
            </View>
            <TimeInput
              value={foodTimeDraft}
              onChange={setFoodTimeDraft}
              label="Meal time"
              wheelPicker
            />
            <Text style={[styles.foodTimeNote, { color: colors.muted }]}>
              Only the time changes. Calories, nutrition, source, and sharing
              stay the same.
              {editingFoodEntry && isGoogleHealthEntry(editingFoodEntry)
                ? " Google Health entry edits require an online cloud confirmation."
                : ""}
            </Text>
            <View style={styles.foodTimeActions}>
              <Pressable
                disabled={foodTimeSaving}
                onPress={() => setEditingFoodEntryId(undefined)}
                style={[styles.foodTimeButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.foodTimeButtonText, { color: colors.muted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={foodTimeSaving}
                onPress={() => void saveFoodEntryTime()}
                style={[
                  styles.foodTimeButton,
                  {
                    backgroundColor: accent,
                    opacity: foodTimeSaving ? 0.65 : 1,
                  },
                ]}
              >
                <Text preserveColor style={styles.foodTimeSaveText}>
                  {foodTimeSaving ? "Saving…" : "Save time"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {tracker.id !== "todo_completion" &&
      !entries.length &&
      !dayPhotos.length &&
      !gymSourceSessions.length ? (
        <Card>
          <Text style={[styles.empty, { color: colors.muted }]}>
            {tracker.dataType === "calculated"
              ? "This value is calculated from the day’s inputs."
              : "Nothing recorded on this day."}
          </Text>
        </Card>
      ) : null}
      </View>
    </Screen>
  );
}

function FoodNutritionSection({
  state,
  period,
  dates,
  anchorDate,
  locale,
}: {
  state: ReturnType<typeof useApp>["state"];
  period: FoodMacroRange;
  dates: string[];
  anchorDate: string;
  locale: string;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const { updateSettings } = useApp();
  const [open, setOpen] = useState(false);
  const nutrientIds = useMemo(
    () => FOOD_NUTRIENTS.map((nutrient) => nutrient.id),
    [],
  );
  const rememberedIds = useMemo(
    () => {
      const stored = state.settings.foodNutrientIds?.filter(
        (id): id is FoodNutrientId => nutrientIds.includes(id as FoodNutrientId),
      );
      return stored?.length ? stored : FOOD_MACROS.map((macro) => macro.id);
    },
    [nutrientIds, state.settings.foodNutrientIds],
  );
  const goals = useMemo(
    () => {
      if (!open) return {};
      return Object.fromEntries(
        FOOD_NUTRIENTS.flatMap((nutrient) => {
          const definition = state.metrics.find(
            (metric) => metric.id === nutrient.id,
          );
          if (!definition || definition.goalEnabled === false) return [];
          return [
            [
              nutrient.id,
              effectiveGoalTarget(
                state,
                definition,
                state.currentUserId,
                anchorDate,
              ),
            ],
          ];
        }),
      ) as Partial<Record<FoodNutrientId, number>>;
    },
    [anchorDate, open, state],
  );
  const report = useMemo(
    () => {
      if (!open) return undefined;
      return foodNutritionReport({
        entries: state.entries,
        userId: state.currentUserId,
        range: period,
        dates,
        anchorDate,
        goals,
        locale,
      });
    },
    [anchorDate, dates, goals, locale, open, period, state.currentUserId, state.entries],
  );
  const dayView = dates.length === 1 && period !== "overall";
  const selectedIds = useMemo(() => {
    if (!report) return [];
    const rememberedAvailable = report.availableIds.filter((id) =>
      rememberedIds.includes(id),
    );
    if (rememberedAvailable.length) return rememberedAvailable;
    const defaultAvailable = report.availableIds.filter((id) =>
      FOOD_MACROS.some((macro) => macro.id === id),
    );
    return defaultAvailable.length ? defaultAvailable : report.availableIds.slice(0, 1);
  }, [rememberedIds, report]);
  const shownNutrients = useMemo(
    () => report?.nutrients.filter((nutrient) => selectedIds.includes(nutrient.id)) ?? [],
    [report, selectedIds],
  );
  const rangeMode = state.settings.foodNutritionRangeMode ?? "average";
  const openNutrient = useCallback(
    (id: FoodNutrientId) => {
      router.push({
        pathname: "/metric-detail",
        params: { metric: id, date: anchorDate, period },
      });
    },
    [anchorDate, period],
  );
  return (
    <Card style={styles.foodMacroCard}>
      <View style={styles.foodMacroHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel="Nutrition"
          onPress={() => setOpen((current) => !current)}
          style={styles.foodNutritionHeaderToggle}
        >
          <View style={[styles.foodMacroIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="nutrition-outline" size={17} color={accent} />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.foodMacroTitle, { color: colors.ink }]}>Nutrition</Text>
            <Text style={[styles.foodMacroHint, { color: colors.muted }]}>Macros, vitamins, minerals and more</Text>
          </View>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.muted}
          />
        </Pressable>
        {open && report?.availableIds.length ? (
          <SelectionMenu
            title="Shown nutrients"
            items={FOOD_NUTRIENTS.filter((nutrient) =>
              report.availableIds.includes(nutrient.id),
            ).map((nutrient) => ({
              id: nutrient.id,
              label: nutrient.label,
              color: nutrient.color,
              icon: nutrient.icon,
              group: nutrient.group,
              sublabel: displayNutrientUnit(nutrient.unit),
            }))}
            selectedIds={selectedIds}
            onChange={(ids) => {
              const selectedAvailable = report.availableIds.filter((id) =>
                ids.includes(id),
              );
              if (!selectedAvailable.length) return;
              const unavailableRemembered = rememberedIds.filter(
                (id) => !report.availableIds.includes(id),
              );
              updateSettings({
                foodNutrientIds: [
                  ...unavailableRemembered,
                  ...selectedAvailable,
                ],
              });
            }}
            multiple
            minimumSelected={1}
            compactIcon
            icon="options-outline"
          />
        ) : null}
      </View>
      {open && report ? (
        <View style={[styles.foodMacroBody, { borderTopColor: colors.border }]}>
          {report.hasData ? (
            <>
              <View style={styles.foodMacroPieRow}>
                <FoodMacroDonut
                  slices={report.macroSlices}
                  colors={colors}
                  onOpenNutrient={openNutrient}
                />
                <View
                  style={[
                    styles.foodMacroLegend,
                    !dayView && styles.foodNutritionLegendWithMode,
                  ]}
                >
                  {report.macroSlices.map((slice) => (
                    <Pressable
                      key={slice.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${slice.label}, ${formatNutrientValue(slice.value, slice.unit, locale)}, ${slice.percent}%`}
                      onPress={() => openNutrient(slice.id)}
                      style={styles.foodMacroLegendRow}
                    >
                      <View style={[styles.foodMacroDot, { backgroundColor: slice.color }]} />
                      <View style={styles.grow}>
                        <Text translate={false} style={[styles.foodMacroLegendName, { color: colors.ink }]}>{t(slice.label)}</Text>
                        <Text style={[styles.foodMacroLegendValue, { color: colors.muted }]}>
                          {slice.percent.toLocaleString(locale, { maximumFractionDigits: 1 })}% · {formatNutrientValue(slice.value, slice.unit, locale)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
                {!dayView ? (
                  <View
                    accessibilityRole="tablist"
                    style={[
                      styles.foodNutritionModeSwitch,
                      { backgroundColor: colors.canvas, borderColor: colors.border },
                    ]}
                  >
                    {(["average", "individual"] as const).map((mode) => {
                      const selected = rangeMode === mode;
                      return (
                        <Pressable
                          key={mode}
                          accessibilityRole="tab"
                          accessibilityState={{ selected }}
                          accessibilityLabel={mode === "average" ? "Average" : "Individual"}
                          hitSlop={10}
                          onPress={() => updateSettings({ foodNutritionRangeMode: mode })}
                          style={[
                            styles.foodNutritionModeChoice,
                            selected && { backgroundColor: accent },
                          ]}
                        >
                          <Text
                            preserveColor={selected}
                            style={[
                              styles.foodNutritionModeText,
                              { color: selected ? "#FFFFFF" : colors.muted },
                            ]}
                          >
                            {mode === "average" ? "Average" : "Individual"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <Text style={[styles.foodMacroCaption, { color: colors.faint }]}>Macro calorie share · tap any nutrient to open its tracker</Text>
              {dayView && report.dayValues ? (
                <View style={styles.foodMacroProgressList}>
                  {shownNutrients.map((nutrient) => (
                    <FoodNutrientProgress
                      key={nutrient.id}
                      nutrient={nutrient}
                      value={report.dayValues?.[nutrient.id] ?? 0}
                      locale={locale}
                      colors={colors}
                      onPress={() => openNutrient(nutrient.id)}
                    />
                  ))}
                </View>
              ) : rangeMode === "average" ? (
                <View style={styles.foodMacroProgressList}>
                  <Text style={[styles.foodNutritionAverageCaption, { color: colors.faint }]}>
                    Average on days each nutrient was recorded
                  </Text>
                  {shownNutrients.map((nutrient) => (
                    <FoodNutrientProgress
                      key={nutrient.id}
                      nutrient={nutrient}
                      value={report.averageValues[nutrient.id] ?? 0}
                      locale={locale}
                      colors={colors}
                      onPress={() => openNutrient(nutrient.id)}
                    />
                  ))}
                </View>
              ) : (
                <FoodNutrientBars
                  buckets={report.buckets}
                  nutrients={shownNutrients}
                  bucketUnit={report.bucketUnit}
                  locale={locale}
                  colors={colors}
                  onOpenNutrient={openNutrient}
                />
              )}
            </>
          ) : (
            <View style={[styles.foodMacroEmpty, { borderColor: colors.border }]}>
              <Ionicons name="restaurant-outline" size={19} color={colors.faint} />
              <Text style={[styles.foodMacroEmptyText, { color: colors.muted }]}>No nutrition details were available in food entries for this range.</Text>
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function FoodMacroDonut({
  slices,
  colors,
  onOpenNutrient,
}: {
  slices: FoodMacroSlice[];
  colors: ReturnType<typeof useAppColors>;
  onOpenNutrient: (id: FoodMacroId) => void;
}) {
  const size = 108;
  const radius = 39;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  return (
    <View style={styles.foodMacroDonut} accessibilityLabel="Macro calorie share">
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.border}
          strokeWidth={14}
        />
        {slices.map((slice) => {
          const length = (Math.max(0, slice.percent) / 100) * circumference;
          const offset = -consumed;
          consumed += length;
          return (
            <Circle
              key={slice.id}
              accessible
              accessibilityLabel={`${slice.label}, ${slice.percent}%`}
              onPress={() => onOpenNutrient(slice.id)}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={14}
              strokeDasharray={[length, Math.max(0, circumference - length)]}
              strokeDashoffset={offset}
              rotation={-90}
              origin={`${size / 2}, ${size / 2}`}
            />
          );
        })}
      </Svg>
      <View pointerEvents="none" style={styles.foodMacroDonutCenter}>
        <Text translate={false} style={[styles.foodMacroDonutLabel, { color: colors.muted }]}>MACRO</Text>
        <Text style={[styles.foodMacroDonutValue, { color: colors.ink }]}>%</Text>
      </View>
    </View>
  );
}

function FoodNutrientProgress({
  nutrient,
  value,
  locale,
  colors,
  onPress,
}: {
  nutrient: FoodNutrientSummary;
  value: number;
  locale: string;
  colors: ReturnType<typeof useAppColors>;
  onPress: () => void;
}) {
  const { t } = useLocalization();
  const goal = nutrient.goal;
  const scale = Math.max(1, value * 1.08, (goal ?? 0) * 1.2);
  const fill = Math.min(1, Math.max(0, value / scale));
  const goalPosition = goal ? Math.min(1, Math.max(0, goal / scale)) : undefined;
  const percentage = goal ? Math.round((value / goal) * 100) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${nutrient.label}, ${formatNutrientValue(value, nutrient.unit, locale)}${percentage === undefined ? "" : `, ${percentage}%`}`}
      onPress={onPress}
      style={styles.foodMacroProgress}
    >
      <View style={styles.foodMacroProgressHeading}>
        <View style={styles.foodMacroProgressName}>
          <View style={[styles.foodMacroDot, { backgroundColor: nutrient.color }]} />
          <Text translate={false} style={[styles.foodMacroProgressLabel, { color: colors.ink }]}>{t(nutrient.label)}</Text>
        </View>
        <Text style={[styles.foodMacroProgressValue, { color: colors.muted }]}>
          {formatNutrientValue(value, nutrient.unit, locale)}
          {percentage !== undefined ? ` · ${percentage}%` : ""}
        </Text>
      </View>
      <View style={[styles.foodMacroProgressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.foodMacroProgressFill, { width: `${fill * 100}%`, backgroundColor: nutrient.color }]} />
        {goalPosition !== undefined ? (
          <View
            accessibilityLabel={`Goal ${formatNutrientValue(goal ?? 0, nutrient.unit, locale)}`}
            style={[
              styles.foodMacroGoalTick,
              { left: `${goalPosition * 100}%`, backgroundColor: palette.amber },
            ]}
          />
        ) : null}
      </View>
      {goal ? (
        <Text style={[styles.foodMacroGoalCopy, { color: colors.faint }]}>Goal {formatNutrientValue(goal, nutrient.unit, locale)}</Text>
      ) : null}
    </Pressable>
  );
}

function FoodNutrientBars({
  buckets,
  nutrients,
  bucketUnit,
  locale,
  colors,
  onOpenNutrient,
}: {
  buckets: FoodNutrientBucket[];
  nutrients: FoodNutrientSummary[];
  bucketUnit: "day" | "month" | "year";
  locale: string;
  colors: ReturnType<typeof useAppColors>;
  onOpenNutrient: (id: FoodNutrientId) => void;
}) {
  const { t } = useLocalization();
  const nutrientMax = Object.fromEntries(
    nutrients.map((nutrient) => [
      nutrient.id,
      Math.max(
        1,
        ...buckets.flatMap((bucket) => {
          const value = bucket.values[nutrient.id];
          return value === null || value === undefined ? [] : [value];
        }),
      ),
    ]),
  ) as Partial<Record<FoodNutrientId, number>>;
  const percentFor = (nutrient: FoodNutrientSummary, value: number) =>
    nutrient.goal
      ? (value / nutrient.goal) * 100
      : (value / (nutrientMax[nutrient.id] ?? 1)) * 100;
  const percentages = buckets.flatMap((bucket) =>
    nutrients.flatMap((nutrient) => {
      const value = bucket.values[nutrient.id];
      return value === null || value === undefined
        ? []
        : [percentFor(nutrient, value)];
    }),
  );
  const axisMax = Math.max(100, Math.ceil((Math.max(1, ...percentages) * 1.08) / 25) * 25);
  const labelIndexes = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])].filter(
    (index) => index >= 0,
  );
  const axisLabel = bucketUnit === "day" ? "Day" : bucketUnit === "month" ? "Month" : "Year";
  return (
    <View style={styles.foodMacroBarsWrap}>
      <View style={styles.foodMacroBarLegend}>
        {nutrients.map((nutrient) => (
          <Pressable
            key={nutrient.id}
            accessibilityRole="button"
            onPress={() => onOpenNutrient(nutrient.id)}
            style={styles.foodMacroBarLegendItem}
          >
            <View style={[styles.foodMacroDot, { backgroundColor: nutrient.color }]} />
            <Text translate={false} style={[styles.foodMacroBarLegendText, { color: colors.muted }]}>
              {t(nutrient.label)} · {displayNutrientUnit(nutrient.unit)} · {nutrient.goal ? `${t("goal")} ${formatNutrientValue(nutrient.goal, nutrient.unit, locale)}` : t("range maximum")}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.foodMacroChartRow}>
        <View style={styles.foodMacroYAxis}>
          <Text style={[styles.foodMacroAxisUnit, { color: colors.faint }]}>Relative %</Text>
          {[axisMax, axisMax / 2, 0].map((tick) => (
            <Text key={tick} style={[styles.foodMacroYAxisLabel, { color: colors.muted }]}>
              {tick.toLocaleString(locale, { maximumFractionDigits: 1 })}
            </Text>
          ))}
        </View>
        <View
          accessibilityLabel="Nutrient history chart"
          style={styles.foodMacroChartViewport}
        >
          <View style={styles.foodMacroScrollablePlot}>
            <View style={styles.foodMacroPlot}>
              {[0, 50, 100].map((top) => (
                <View key={top} style={[styles.foodMacroGrid, { top: `${top}%`, borderTopColor: colors.border }]} />
              ))}
              <View style={styles.foodMacroBars}>
                {buckets.map((bucket) => (
                  <View
                    key={bucket.key}
                    style={styles.foodMacroBarSlot}
                  >
                    {nutrients.map((nutrient) => {
                      const value = bucket.values[nutrient.id];
                      const relativePercent =
                        value === null || value === undefined
                          ? 0
                          : percentFor(nutrient, value);
                      return (
                        <Pressable
                          key={nutrient.id}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: value === null || value === undefined }}
                          accessibilityLabel={`${bucket.label}, ${nutrient.label}, ${value === null || value === undefined ? t("not recorded") : formatNutrientValue(value, nutrient.unit, locale)}${nutrient.goal && value !== null && value !== undefined ? `, ${Math.round(relativePercent)}%` : ""}`}
                          disabled={value === null || value === undefined}
                          onPress={() => onOpenNutrient(nutrient.id)}
                          style={styles.foodMacroBarTarget}
                        >
                          {value === null || value === undefined ? (
                            <View style={[styles.foodMacroMissingBar, { backgroundColor: colors.border }]} />
                          ) : (
                            <View
                              style={[
                                styles.foodMacroBar,
                                {
                                  height: `${Math.max(2, Math.min(100, relativePercent / axisMax * 100))}%`,
                                  backgroundColor: nutrient.color,
                                },
                              ]}
                            />
                          )}
                          {nutrient.goal ? (
                            <View
                              accessibilityLabel={`Goal ${formatNutrientValue(nutrient.goal, nutrient.unit, locale)}`}
                              style={[
                                styles.foodMacroBarGoalTick,
                                {
                                  bottom: `${Math.min(1, 100 / axisMax) * 100}%`,
                                  borderTopColor: palette.amber,
                                },
                              ]}
                            />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.foodMacroXAxis}>
              {labelIndexes.map((index, labelIndex) => (
                <Text
                  key={`${buckets[index]?.key}-${index}`}
                  numberOfLines={1}
                  style={[
                    styles.foodMacroXAxisLabel,
                    { color: colors.muted },
                    labelIndex === 1 && styles.foodMacroXAxisMiddle,
                    labelIndex === 2 && styles.foodMacroXAxisEnd,
                  ]}
                >
                  {buckets[index]?.label}
                </Text>
              ))}
            </View>
          </View>
        </View>
      </View>
      <Text translate={false} style={[styles.foodMacroAxisCaption, { color: colors.faint }]}>
        {t(axisLabel)} · {t("Goal bars show percent of goal; no-goal bars show percent of range maximum")}
      </Text>
    </View>
  );
}

function displayNutrientUnit(unit: FoodNutrientSummary["unit"]) {
  return unit === "mcg" ? "µg" : unit;
}

function formatNutrientValue(
  value: number,
  unit: FoodNutrientSummary["unit"],
  locale: string,
) {
  return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${displayNutrientUnit(unit)}`;
}

function TodoTrackerEntries({
  state,
  dates,
  focusTodoId,
  focusToken,
  onRequestScroll,
}: {
  state: ReturnType<typeof useApp>["state"];
  dates: string[];
  focusTodoId?: string;
  focusToken?: string;
  onRequestScroll: (y: number) => void;
}) {
  const { toggleTodo, skipTodo, deleteTodo, reorderTodo } = useApp();
  const locale = useLocale();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeTodoLabel, setActiveTodoLabel] = useState<string>();
  const cardOffsetRef = useRef<number | undefined>(undefined);
  const rowOffsetsRef = useRef(new Map<string, number>());
  const focusAnimation = useRef(new Animated.Value(0)).current;
  const [highlightedTodoId, setHighlightedTodoId] = useState<string>();
  const completedFocusRef = useRef<string | undefined>(undefined);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priorities = {
    low: "#6C8AA6",
    normal: "#8A8F98",
    high: "#F59E0B",
    urgent: "#D24B4B",
  } as const;
  const allItems = (state.todos ?? [])
    .map((todo) => {
      const relevantDates = dates.filter((date) =>
        todoAppearsOnDate(todo, date),
      );
      return { id: todo.id, parentId: todo.parentId, todo, relevantDates };
    })
    .filter((item) => item.relevantDates.length)
    .sort((a, b) => (a.todo.dueAt ?? "9999").localeCompare(b.todo.dueAt ?? "9999"));
  const todoLabelsInView = [
    ...new Set(allItems.flatMap(({ todo }) => todoLabels(todo))),
  ].sort((a, b) => a.localeCompare(b));
  const items = activeTodoLabel
    ? allItems.filter(({ todo }) => todoLabels(todo).includes(activeTodoLabel))
    : allItems;
  const flattenedItems = flattenTodoHierarchy(items);
  const focusKey = focusTodoId
    ? `${focusTodoId}:${focusToken ?? "focus"}`
    : undefined;
  const attemptFocus = useCallback(() => {
    if (!focusTodoId || !focusKey || completedFocusRef.current === focusKey)
      return;
    const cardOffset = cardOffsetRef.current;
    const rowOffset = rowOffsetsRef.current.get(focusTodoId);
    if (cardOffset === undefined || rowOffset === undefined) return;
    completedFocusRef.current = focusKey;
    setHighlightedTodoId(focusTodoId);
    onRequestScroll(Math.max(0, cardOffset + rowOffset - 24));
    focusAnimation.stopAnimation();
    focusAnimation.setValue(0);
    Animated.sequence([
      Animated.timing(focusAnimation, {
        toValue: -1,
        duration: 80,
        useNativeDriver: false,
      }),
      Animated.timing(focusAnimation, {
        toValue: 1,
        duration: 110,
        useNativeDriver: false,
      }),
      Animated.timing(focusAnimation, {
        toValue: -1,
        duration: 110,
        useNativeDriver: false,
      }),
      Animated.timing(focusAnimation, {
        toValue: 1,
        duration: 110,
        useNativeDriver: false,
      }),
      Animated.timing(focusAnimation, {
        toValue: -1,
        duration: 110,
        useNativeDriver: false,
      }),
      Animated.timing(focusAnimation, {
        toValue: 0,
        duration: 80,
        useNativeDriver: false,
      }),
    ]).start();
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedTodoId((current) =>
        current === focusTodoId ? undefined : current,
      );
      highlightTimerRef.current = null;
    }, 3_200);
  }, [focusAnimation, focusKey, focusTodoId, onRequestScroll]);
  useEffect(() => {
    completedFocusRef.current = undefined;
    const timer = setTimeout(attemptFocus, 100);
    return () => clearTimeout(timer);
  }, [attemptFocus, focusKey]);
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );
  return (
    <View
      onLayout={(event) => {
        cardOffsetRef.current = event.nativeEvent.layout.y;
        attemptFocus();
      }}
    >
    <Card style={styles.todoDetailCard}>
      <View style={styles.logHeader}>
        <View>
          <Text style={[styles.section, { color: colors.ink }]}>To-dos</Text>
          <Text style={[styles.time, { color: colors.muted }]}>
            {items.filter(({ todo, relevantDates }) =>
              relevantDates.some((date) => todoResolvedOnDate(todo, date)),
            ).length}
            /{items.length} completed in this view
          </Text>
        </View>
        <Pressable
          onPress={() => router.navigate("/todo-editor" as never)}
          style={[styles.logButton, { backgroundColor: accent }]}
        >
          <Ionicons name="add" size={15} color={palette.white} />
          <Text style={styles.logButtonText}>New to-do</Text>
        </Pressable>
      </View>
      {todoLabelsInView.length ? (
        <View style={styles.todoLabelFilters}>
          <Pressable
            onPress={() => setActiveTodoLabel(undefined)}
            style={[styles.todoLabelChip, { borderColor: activeTodoLabel ? colors.border : accent, backgroundColor: activeTodoLabel ? colors.canvas : colors.primarySoft }]}
          >
            <Text style={[styles.todoLabelText, { color: activeTodoLabel ? colors.muted : accent }]}>All</Text>
          </Pressable>
          {todoLabelsInView.map((label) => (
            <Pressable
              key={label}
              onPress={() => setActiveTodoLabel((current) => current === label ? undefined : label)}
              style={[styles.todoLabelChip, { borderColor: activeTodoLabel === label ? accent : colors.border, backgroundColor: activeTodoLabel === label ? colors.primarySoft : colors.canvas }]}
            >
              <Text translate={false} style={[styles.todoLabelText, { color: activeTodoLabel === label ? accent : colors.muted }]}>#{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {flattenedItems.map(({ item: { todo, relevantDates }, depth }) => {
        const complete = relevantDates.every((date) =>
          todoCompletedOnDate(todo, date),
        );
        const skipped = relevantDates.every((date) =>
          todoSkippedOnDate(todo, date),
        );
        const open = openIds.includes(todo.id);
        const dueDate = todo.dueAt?.slice(0, 10);
        const daysToDue = dueDate
          ? Math.ceil(
              (new Date(`${dueDate}T12:00:00`).getTime() -
                new Date(`${dates[dates.length - 1]}T12:00:00`).getTime()) /
                86400000,
            )
          : undefined;
        const urgency =
          complete
            ? "#B8E45C"
            : daysToDue !== undefined && daysToDue <= 1
              ? "#D24B4B"
              : daysToDue !== undefined && daysToDue <= 7
                ? "#F59E0B"
                : daysToDue !== undefined
                  ? "#4F8A3D"
                  : colors.border;
        return (
          <Animated.View
            key={todo.id}
            onLayout={(event) => {
              rowOffsetsRef.current.set(todo.id, event.nativeEvent.layout.y);
              attemptFocus();
            }}
            style={
              focusTodoId === todo.id
                ? {
                    transform: [
                      {
                        translateX: focusAnimation.interpolate({
                          inputRange: [-1, 0, 1],
                          outputRange: [-5, 0, 5],
                        }),
                      },
                    ],
                  }
                : undefined
            }
          >
          <Pressable
            onPress={() =>
              router.navigate({
                pathname: "/todo-editor",
                params: { id: todo.id },
              } as never)
            }
            onLongPress={() => {
              const index = flattenedItems.findIndex((item) => item.item.todo.id === todo.id);
              const actionDate = relevantDates.at(-1)!;
              Alert.alert(todo.title, "Reorder, skip, or delete this to-do.", [
                ...(index > 0
                  ? [
                      {
                        text: "Move up",
                        onPress: () => reorderTodo(todo.id, index - 1),
                      },
                    ]
                  : []),
                ...(index < flattenedItems.length - 1
                  ? [
                      {
                        text: "Move down",
                        onPress: () => reorderTodo(todo.id, index + 1),
                      },
                    ]
                  : []),
                {
                  text: skipped ? "Undo skip" : "Skip",
                  onPress: () => skipTodo(todo.id, actionDate),
                },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteTodo(todo.id),
                },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            style={[
              styles.todoDetailRow,
              { marginLeft: Math.min(depth, 8) * 10 },
              {
                borderColor:
                  highlightedTodoId === todo.id ? "#E9A23B" : urgency,
                backgroundColor: colors.canvas,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="Add subtask"
              onPress={(event) => {
                event.stopPropagation();
                router.navigate({
                  pathname: "/todo-editor",
                  params: { parentId: todo.id },
                } as never);
              }}
              hitSlop={8}
            >
              <Ionicons name="return-down-forward-outline" size={14} color={colors.faint} />
            </Pressable>
            <Pressable
              onPress={() => toggleTodo(todo.id, relevantDates.at(-1)!)}
              hitSlop={8}
            >
              <Ionicons
                name={
                  skipped
                    ? "play-skip-forward-circle"
                    : complete
                      ? "checkmark-circle"
                      : "ellipse-outline"
                }
                size={18}
                color={
                  skipped
                    ? "#E783B5"
                    : complete
                      ? "#B8E45C"
                      : priorities[todo.priority]
                }
              />
            </Pressable>
            <View style={styles.grow}>
              <Text
                translate={false}
                style={[
                  styles.entryTitle,
                  { color: colors.ink },
                  (complete || skipped) && styles.todoComplete,
                ]}
              >
                {todo.title}
              </Text>
              <Text style={[styles.time, { color: colors.muted }]}>
                {dueDate ? `Deadline ${friendlyDate(dueDate, locale)}` : "No deadline"}
                {" · "}
                {todo.priority} priority
              </Text>
              {open ? (
                <View style={styles.todoExtra}>
                  {todo.description ? (
                    <Text translate={false} style={[styles.note, { color: colors.muted }]}>
                      {todo.description}
                    </Text>
                  ) : null}
                  {todo.reminders.map((reminder) => (
                    <Text
                      key={reminder.id}
                      style={[styles.time, { color: colors.muted }]}
                    >
                      Reminder {reminder.at?.slice(0, 10) ?? "repeating"} ·{" "}
                      {formatClockTime(
                        reminder.time ?? reminder.at?.slice(11, 16) ?? "",
                        state.settings.timeFormat,
                        locale,
                      )}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                setOpenIds((current) =>
                  open
                    ? current.filter((id) => id !== todo.id)
                    : [...current, todo.id],
                );
              }}
              hitSlop={8}
            >
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.faint}
              />
            </Pressable>
          </Pressable>
          </Animated.View>
        );
      })}
      {!allItems.length ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          No to-dos appear in this period.
        </Text>
      ) : activeTodoLabel && !items.length ? (
        <Text translate={false} style={[styles.empty, { color: colors.muted }]}>No #{activeTodoLabel} to-dos appear in this period.</Text>
      ) : null}
    </Card>
    </View>
  );
}

function formatLocalizedTemplate(
  t: (source: string) => string,
  source: string,
  values: Record<string, string>,
) {
  return Object.entries(values).reduce(
    (copy, [name, value]) => copy.replaceAll(`{${name}}`, value),
    t(source),
  );
}

function WeeklyDetail({
  state,
  day,
  setDay,
  period,
  setPeriod,
  choosePeriod,
  dateNavigatorOpen,
  toggleDateNavigator,
  calendarOpen,
  setCalendarOpen,
  shiftRange,
  swipeHandlers,
  colors,
  accent,
}: {
  state: ReturnType<typeof useApp>["state"];
  day: string;
  setDay: (day: string) => void;
  period: LeaderboardPeriod;
  setPeriod: React.Dispatch<React.SetStateAction<LeaderboardPeriod>>;
  choosePeriod: (period: Exclude<LeaderboardPeriod, "custom">) => void;
  dateNavigatorOpen: boolean;
  toggleDateNavigator: () => void;
  calendarOpen: boolean;
  setCalendarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  shiftRange: (direction: number) => void;
  swipeHandlers: React.ComponentProps<typeof View>;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  const locale = useLocale();
  const { t } = useLocalization();
  const tracker = state.metrics.find(
    (metric) => metric.id === "weekly_deficit_balance",
  );
  const trackerColor = tracker?.color ?? accent;
  const report = useMemo(
    () =>
      weeklyBalancePeriodReport(
        state,
        state.currentUserId,
        period,
        day,
        state.settings.weekStartsOn ?? 1,
      ),
    [day, period, state],
  );
  const foodEntryDates = useMemo(
    () =>
      new Set(
        state.entries
          .filter(
            (entry) =>
              entry.userId === state.currentUserId &&
              entry.metricId === "food",
          )
          .map((entry) => entry.localDate),
      ),
    [state.currentUserId, state.entries],
  );
  const hasFood = useCallback(
    (localDate: string) => foodEntryDates.has(localDate),
    [foodEntryDates],
  );
  const resultLabel = (
    period === "today" || period === "yesterday" || period === "custom"
      ? t("Week-to-date result")
      : formatLocalizedTemplate(t, "{period} result", {
          period: t(periodTitle(period, day, locale)),
        })
  ).toLocaleUpperCase(locale);
  const bucketName = (bucket: (typeof report.buckets)[number]) => {
    if (report.bucketKind === "year") return bucket.startDate.slice(0, 4);
    if (report.bucketKind === "month")
      return new Intl.DateTimeFormat(locale, { month: "short" }).format(
        new Date(`${bucket.startDate}T12:00:00`),
      );
    if (report.bucketKind === "week")
      return friendlyDate(bucket.startDate, locale);
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
    }).format(new Date(`${bucket.startDate}T12:00:00`));
  };
  const bucketBalanceLabel = (balance: number) =>
    formatLocalizedTemplate(
      t,
      balance >= 0 ? "{balance} kcal ahead" : "{balance} kcal behind",
      {
        balance: Math.abs(Math.round(balance)).toLocaleString(locale),
      },
    );
  const bestLabel = report.bestBucket
    ? `${bucketName(report.bestBucket)} · ${bucketBalanceLabel(report.bestBucket.balance)}`
    : "—";
  const worstLabel = report.worstBucket
    ? `${bucketName(report.worstBucket)} · ${bucketBalanceLabel(report.worstBucket.balance)}`
    : "—";
  const loggedSummary = formatLocalizedTemplate(
    t,
    report.days === 1
      ? "{days} logged day · {actual} actual / {target} target"
      : "{days} logged days · {actual} actual / {target} target",
    {
      days: report.days.toLocaleString(locale),
      actual: Math.round(report.actual).toLocaleString(locale),
      target: Math.round(report.target).toLocaleString(locale),
    },
  );
  const reportNarrative =
    report.days === 0
      ? t("There is not enough food data in this period yet.")
      : formatLocalizedTemplate(
          t,
          report.balance >= 0
            ? report.days === 1
              ? "You are {balance} kcal ahead of the cumulative plan across {days} logged day."
              : "You are {balance} kcal ahead of the cumulative plan across {days} logged days."
            : report.days === 1
              ? "You are {balance} kcal behind the cumulative plan across {days} logged day."
              : "You are {balance} kcal behind the cumulative plan across {days} logged days.",
          {
            balance: Math.abs(Math.round(report.balance)).toLocaleString(locale),
            days: report.days.toLocaleString(locale),
          },
        );
  return (
    <Screen>
      <PageHeader
        title="Weekly balance"
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            <InfoPopover
              label={t("About Weekly balance")}
              message={t(
                "Only days with food recorded count. A non-negative balance means the weekly target is on plan.",
              )}
            />
            <IconButton
              icon="book-outline"
              label="Open Weekly balance journal notes"
              onPress={() =>
                router.navigate({
                  pathname: "/journal",
                  params: { metric: "weekly_deficit_balance" },
                } as never)
              }
            />
            <IconButton
              icon="calendar-outline"
              label="Open schedule"
              onPress={() => router.navigate("/calendar" as never)}
            />
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          </View>
        }
      />
      <View {...swipeHandlers}>
        <View style={styles.controls}>
          <Card style={styles.periodCard}>
            <View style={styles.periodBar}>
              {DETAIL_PERIODS.map((item) => {
                const selectedPeriod = period === item.id;
                const showDateToggle = selectedPeriod && item.id !== "overall";
                const selectedOverall = selectedPeriod && item.id === "overall";
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showDateToggle
                        ? formatLocalizedTemplate(
                            t,
                            "{period}, {action} date view",
                            {
                              period: t(item.label),
                              action: t(
                                dateNavigatorOpen ? "collapse" : "expand",
                              ),
                            },
                          )
                        : t(item.label)
                    }
                    accessibilityState={{
                      selected: selectedPeriod,
                      disabled: selectedOverall,
                      expanded: showDateToggle ? dateNavigatorOpen : undefined,
                    }}
                    disabled={selectedOverall}
                    onPress={() => {
                      if (showDateToggle) toggleDateNavigator();
                      else choosePeriod(item.id);
                    }}
                    style={[
                      styles.periodChoice,
                      item.id === "yesterday"
                        ? styles.periodChoiceYesterday
                        : item.id === "overall"
                          ? styles.periodChoiceOverall
                          : null,
                      {
                        backgroundColor: selectedPeriod
                          ? colors.primarySoft
                          : "transparent",
                        borderColor: selectedPeriod
                          ? trackerColor
                          : "transparent",
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.68}
                      style={[
                        styles.periodText,
                        {
                          color: selectedPeriod ? trackerColor : colors.muted,
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {showDateToggle ? (
                      <Ionicons
                        name={dateNavigatorOpen ? "chevron-up" : "chevron-down"}
                        size={7}
                        color={trackerColor}
                        style={styles.periodChevron}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </Card>
          {period !== "overall" && dateNavigatorOpen ? (
            <Card style={styles.navigator}>
              <View style={styles.dateNav}>
                <IconButton
                  icon="chevron-back"
                  label="Previous"
                  onPress={() => shiftRange(-1)}
                />
                <Pressable
                  onPress={() => setCalendarOpen((open) => !open)}
                  style={styles.navCopy}
                >
                  <Text style={[styles.navTitle, { color: colors.ink }]}>
                    {periodTitle(period, day, locale)}
                  </Text>
                  <View style={styles.navDate}>
                    <Ionicons
                      name="calendar-outline"
                      size={13}
                      color={trackerColor}
                    />
                    <Text style={[styles.navSub, { color: colors.muted }]}>
                      {period === "today" ||
                      period === "yesterday" ||
                      period === "custom"
                        ? formatLocalizedTemplate(t, "Week through {value}", {
                            value: friendlyDate(day, locale),
                          })
                        : `${friendlyDate(report.startDate, locale)} – ${friendlyDate(report.endDate, locale)}`}
                    </Text>
                    <Ionicons
                      name={calendarOpen ? "chevron-up" : "chevron-down"}
                      size={13}
                      color={colors.muted}
                    />
                  </View>
                </Pressable>
                <IconButton
                  icon="chevron-forward"
                  label="Next"
                  onPress={() => shiftRange(1)}
                />
              </View>
              {calendarOpen ? (
                <View
                  style={[styles.calendar, { borderTopColor: colors.border }]}
                >
                  <MonthCalendar
                    monthDate={day}
                    selectedDate={day}
                    onSelect={(selectedDay) => {
                      setDay(selectedDay);
                      setPeriod("custom");
                      setCalendarOpen(false);
                    }}
                    hasActivity={hasFood}
                  />
                </View>
              ) : null}
            </Card>
          ) : null}
        </View>
      </View>
      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <View style={styles.grow}>
            <Text style={[styles.label, { color: colors.faint }]}>
              {resultLabel}
            </Text>
            <Text
              style={[
                styles.value,
                {
                  color:
                    report.days === 0
                      ? colors.faint
                      : report.balance >= 0
                        ? trackerColor
                        : palette.red,
                },
              ]}
            >
              {report.days
                ? bucketBalanceLabel(report.balance)
                : t("Not available")}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {report.days
                ? loggedSummary
                : "Log food to calculate the balance for this period."}
            </Text>
          </View>
          <View
            style={[
              styles.largeIcon,
              { backgroundColor: `${trackerColor}18` },
            ]}
          >
            <Ionicons
              name="calendar-number-outline"
              size={23}
              color={trackerColor}
            />
          </View>
        </View>
        <WeeklyBalanceChart
          report={report}
          colors={colors}
          positiveColor={trackerColor}
          labelForBucket={bucketName}
        />
        <View style={[styles.stats, { borderTopColor: colors.border }]}>
          <Stat
            label="Logged days"
            value={String(report.days)}
            colors={colors}
          />
          <Stat
            label="Average per day"
            value={
              report.days
                ? formatLocalizedTemplate(t, "{value} kcal", {
                    value: Math.round(
                      report.averageDailyBalance,
                    ).toLocaleString(locale),
                  })
                : "—"
            }
            colors={colors}
          />
          <Stat
            label="Periods on plan"
            value={
              report.countedBuckets
                ? `${report.onPlanBuckets}/${report.countedBuckets}`
                : "—"
            }
            colors={colors}
          />
        </View>
      </Card>
      <Card style={styles.weeklyEntriesCard}>
        <View style={styles.weeklyEntriesHeading}>
          <View
            style={[
              styles.weeklyReportIcon,
              { backgroundColor: `${trackerColor}18` },
            ]}
          >
            <Ionicons name="list-outline" size={18} color={trackerColor} />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.entryTitle, { color: colors.ink }]}>Entries</Text>
            <Text style={[styles.time, { color: colors.muted }]}>
              End-of-day balances from food-logged days
            </Text>
          </View>
        </View>
        {report.dailyBalances.length ? (
          [...report.dailyBalances].reverse().map((entry, index) => (
            <View
              key={entry.id}
              style={[
                styles.weeklyEntryRow,
                index > 0
                  ? { borderTopColor: colors.border, borderTopWidth: 1 }
                  : null,
              ]}
            >
              <View
                style={[
                  styles.weeklyEntryIcon,
                  {
                    backgroundColor:
                      entry.balance >= 0
                        ? `${trackerColor}18`
                        : `${palette.red}18`,
                  },
                ]}
              >
                <Ionicons
                  name={entry.balance >= 0 ? "trending-up" : "trending-down"}
                  size={15}
                  color={entry.balance >= 0 ? trackerColor : palette.red}
                />
              </View>
              <View style={styles.grow}>
                <Text style={[styles.entryTitle, { color: colors.ink }]}>
                  {friendlyDate(entry.startDate, locale)}
                </Text>
                <Text style={[styles.time, { color: colors.muted }]}>
                  {formatLocalizedTemplate(
                    t,
                    "{actual} kcal actual · {target} kcal target",
                    {
                      actual: Math.round(entry.actual).toLocaleString(locale),
                      target: Math.round(entry.target).toLocaleString(locale),
                    },
                  )}
                </Text>
              </View>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[
                  styles.weeklyEntryValue,
                  {
                    color: entry.balance >= 0 ? trackerColor : palette.red,
                  },
                ]}
              >
                {bucketBalanceLabel(entry.balance)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No completed food-logged days in this period yet.
          </Text>
        )}
      </Card>
      <Card style={styles.weeklyReportCard}>
        <View style={styles.weeklyReportHeading}>
          <View
            style={[
              styles.weeklyReportIcon,
              { backgroundColor: `${trackerColor}18` },
            ]}
          >
            <Ionicons name="analytics-outline" size={18} color={trackerColor} />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.entryTitle, { color: colors.ink }]}>
              Balance report
            </Text>
            <Text style={[styles.time, { color: colors.muted }]}>
              Meaningful comparisons from food-logged days only
            </Text>
          </View>
        </View>
        <Text style={[styles.note, { color: colors.muted }]}>
          {reportNarrative}
        </Text>
        <View style={[styles.weeklyReportGrid, { borderTopColor: colors.border }]}>
          <Stat label="Best period" value={bestLabel} colors={colors} />
          <Stat label="Lowest period" value={worstLabel} colors={colors} />
          <Stat
            label="Plan consistency"
            value={
              report.countedBuckets
                ? `${Math.round((report.onPlanBuckets / report.countedBuckets) * 100)}%`
                : "—"
            }
            colors={colors}
          />
        </View>
      </Card>
    </Screen>
  );
}

function WeeklyBalanceChart({
  report,
  colors,
  positiveColor,
  labelForBucket,
}: {
  report: ReturnType<typeof weeklyBalancePeriodReport>;
  colors: ReturnType<typeof useAppColors>;
  positiveColor: string;
  labelForBucket: (
    bucket: ReturnType<typeof weeklyBalancePeriodReport>["buckets"][number],
  ) => string;
}) {
  const locale = useLocale();
  const { t } = useLocalization();
  const hasChartData = report.countedBuckets > 0;
  const maxAbsolute = Math.max(
    1,
    ...report.buckets
      .filter((bucket) => bucket.days > 0)
      .map((bucket) => Math.abs(bucket.balance)),
  );
  return (
    <View
      accessibilityLabel={t("Energy balance chart")}
      style={styles.weeklyBalanceChartWrap}
    >
      <View style={styles.weeklyBalanceChart}>
        <View
          style={[
            styles.weeklyBalanceZeroLine,
            { borderTopColor: palette.amber },
          ]}
        >
          <Text style={[styles.weeklyBalanceGoalLabel, { color: palette.amber }]}>plan</Text>
        </View>
        <View style={styles.weeklyBalanceBars}>
          {report.buckets.map((bucket) => {
            const magnitude = Math.max(
              3,
              (Math.abs(bucket.balance) / maxAbsolute) * 100,
            );
            const positive = bucket.balance >= 0;
            return (
              <View key={bucket.id} style={styles.weeklyBalanceSlot}>
                <View style={styles.weeklyBalanceHalfTop}>
                  {bucket.days > 0 && positive ? (
                    <View
                      style={[
                        styles.weeklyBalanceBar,
                        {
                          height: `${magnitude}%`,
                          backgroundColor: positiveColor,
                        },
                      ]}
                    />
                  ) : null}
                </View>
                <View style={styles.weeklyBalanceHalfBottom}>
                  {bucket.days > 0 && !positive ? (
                    <View
                      style={[
                        styles.weeklyBalanceBar,
                        {
                          height: `${magnitude}%`,
                          backgroundColor: palette.red,
                        },
                      ]}
                    />
                  ) : bucket.days === 0 ? (
                    <View
                      style={[
                        styles.weeklyBalanceMissing,
                        { backgroundColor: colors.border },
                      ]}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.weeklyBalanceLabels}>
        {report.buckets.map((bucket) => (
          <Text
            key={bucket.id}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.58}
            style={[styles.weeklyBalanceLabel, { color: colors.muted }]}
          >
            {labelForBucket(bucket)}
          </Text>
        ))}
      </View>
      <Text style={[styles.weeklyBalanceScale, { color: colors.faint }]}>
        {hasChartData
          ? formatLocalizedTemplate(
              t,
              "±{value} kcal · above line = ahead · below = behind",
              { value: Math.round(maxAbsolute).toLocaleString(locale) },
            )
          : t("No food-logged days in this period")}
      </Text>
    </View>
  );
}
function RangeGoalProgressBar({
  value,
  range,
  color,
  colors,
  unit,
}: {
  value: number;
  range: { min: number; max: number };
  color: string;
  colors: ReturnType<typeof useAppColors>;
  unit: string;
}) {
  const minimum = Math.min(range.min, range.max);
  const maximum = Math.max(range.min, range.max);
  const scaleMaximum = Math.max(maximum * 1.35, value * 1.1, 1);
  const fill = Math.min(1, Math.max(0, value / scaleMaximum));
  const rangeLeft = Math.min(1, Math.max(0, minimum / scaleMaximum));
  const rangeRight = Math.min(1, Math.max(rangeLeft, maximum / scaleMaximum));
  return (
    <View style={styles.rangeGoalWrap}>
      <View style={[styles.rangeGoalTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.rangeGoalFill,
            { width: `${fill * 100}%`, backgroundColor: color },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.rangeGoalBand,
            {
              left: `${rangeLeft * 100}%`,
              width: `${Math.max(0.012, rangeRight - rangeLeft) * 100}%`,
              borderColor: palette.lime,
              backgroundColor: `${palette.lime}20`,
            },
          ]}
        />
      </View>
      <Text style={[styles.rangeGoalCaption, { color: colors.muted }]}>
        Target {minimum}–{maximum} {unit}
      </Text>
    </View>
  );
}

function Trend({
  values,
  dates,
  axisRange,
  tracker,
  target,
  colors,
  secondaryValues,
  secondaryColor,
  secondaryTarget,
  primaryRange,
  secondaryRange,
  dense = false,
  chartStyle = "bar",
}: {
  values: (number | null)[];
  dates: string[];
  axisRange?: "month" | "year";
  tracker: MetricDefinition;
  target: number;
  colors: ReturnType<typeof useAppColors>;
  secondaryValues?: (number | null)[];
  secondaryColor?: string;
  secondaryTarget?: number;
  primaryRange?: { min: number; max: number };
  secondaryRange?: { min: number; max: number };
  dense?: boolean;
  chartStyle?: MetricChartStyle;
}) {
  const locale = useLocale();
  if (secondaryValues)
    return (
      <TrendFrame
        dates={dates}
        range={axisRange}
        colors={colors}
        axisInsetLeft={40}
        axisInsetRight={8}
      >
        <BloodPressureTrend
          systolic={values}
          diastolic={secondaryValues}
          systolicColor={tracker.color}
          diastolicColor={secondaryColor ?? colors.muted}
          systolicRange={primaryRange ?? { min: 90, max: 120 }}
          diastolicRange={secondaryRange ?? { min: 60, max: 80 }}
        />
      </TrendFrame>
    );
  if (chartStyle === "line" || chartStyle === "both")
    return (
      <TrendFrame
        dates={dates}
        range={axisRange}
        colors={colors}
        axisInsetLeft={44}
        axisInsetRight={8}
      >
        <SingleLineTrend
          values={values}
          color={tracker.color}
          target={target}
          unit={tracker.unit}
          colors={colors}
          showBars={chartStyle === "both"}
        />
      </TrendFrame>
    );
  if (chartStyle === "completion")
    return (
      <TrendFrame dates={dates} range={axisRange} colors={colors}>
        <View style={styles.completionTrend}>
          {downsampleValues(values, 90).map((value, index) => {
            const met = value !== null && goalReached(tracker, value, target);
            return (
              <View
                key={index}
                style={[
                  styles.completionTrendCell,
                  {
                    backgroundColor:
                      value === null
                        ? colors.border
                        : met
                          ? palette.lime
                          : `${tracker.color}55`,
                  },
                ]}
              />
            );
          })}
        </View>
      </TrendFrame>
    );
  const numericValues = values.filter(
    (value): value is number => value !== null,
  );
  const max = Math.max(
    ...numericValues,
    target,
    secondaryTarget ?? 0,
    1,
  );
  return (
    <TrendFrame
      dates={dates}
      range={axisRange}
      colors={colors}
      axisInsetLeft={40}
      axisInsetRight={4}
    >
    <View style={[styles.chart, dense && styles.denseChart]}>
      {[max, max / 2, 0].map((tick, index) => (
        <React.Fragment key={`bar-axis-${index}`}>
          <View
            style={[
              styles.lineGrid,
              {
                left: 0,
                right: 0,
                top: `${index * 50}%`,
                borderTopColor: colors.border,
              },
            ]}
          />
          <Text
            style={[
              styles.barAxisLabel,
              { top: index === 2 ? "100%" : `${index * 50}%`, color: colors.muted },
            ]}
          >
            {Math.abs(tick) >= 100
              ? Math.round(tick).toLocaleString(locale)
              : (Math.round(tick * 10) / 10).toLocaleString(locale)}
          </Text>
        </React.Fragment>
      ))}
      <View
        style={[
          styles.lineYAxis,
          { left: 0, top: 0, bottom: 0, backgroundColor: colors.border },
        ]}
      />
      <View
        style={[
          styles.goalLine,
          {
            bottom: `${Math.min(1, target / max) * 100}%`,
            borderColor: tracker.color,
          },
        ]}
      >
        <Text style={[styles.goalLabel, { color: tracker.color }]}>
          {secondaryValues ? "systolic goal" : "goal"}
        </Text>
      </View>
      {secondaryValues && secondaryTarget ? (
        <View
          style={[
            styles.goalLine,
            {
              bottom: `${Math.min(1, secondaryTarget / max) * 100}%`,
              borderColor: secondaryColor ?? colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.goalLabel,
              styles.secondaryGoalLabel,
              { color: secondaryColor ?? colors.muted },
            ]}
          >
            diastolic goal
          </Text>
        </View>
      ) : null}
      {values.map((value, index) => (
        <View
          key={index}
          style={[styles.barSlot, dense && styles.denseBarSlot]}
        >
          {value !== null ? (
            <View
              style={[
                styles.bar,
                dense && styles.denseBar,
                {
                  height: `${Math.max(3, (value / max) * 100)}%`,
                  backgroundColor: tracker.color,
                },
              ]}
            />
          ) : (
            <View
              style={[
                styles.missingBar,
                dense && styles.denseMissingBar,
                { backgroundColor: colors.border },
              ]}
            />
          )}
          {secondaryValues ? (
            secondaryValues[index] !== null &&
            secondaryValues[index] !== undefined ? (
              <View
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(
                      3,
                      ((secondaryValues[index] as number) / max) * 100,
                    )}%`,
                    backgroundColor: secondaryColor ?? colors.muted,
                  },
                ]}
              />
            ) : null
          ) : null}
        </View>
      ))}
    </View>
    </TrendFrame>
  );
}

function TrendFrame({
  dates,
  range,
  colors,
  axisInsetLeft = 0,
  axisInsetRight = 0,
  children,
}: {
  dates: string[];
  range?: "month" | "year";
  colors: ReturnType<typeof useAppColors>;
  axisInsetLeft?: number;
  axisInsetRight?: number;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const [axisWidth, setAxisWidth] = useState(0);
  if (!range || dates.length <= 1) return <>{children}</>;
  const rawLabels = range === "year"
    ? dates.reduce<{ index: number; label: string }[]>((items, date, index) => {
        const month = date.slice(0, 7);
        if (items.some((item) => dates[item.index].slice(0, 7) === month))
          return items;
        items.push({
          index,
          label: new Intl.DateTimeFormat(locale, { month: "short" })
            .format(new Date(`${date}T12:00:00`))
            .slice(0, 3),
        });
        return items;
      }, [])
    : dates
        .map((date, index) => ({ index, label: String(Number(date.slice(-2))) }))
        .filter(
          ({ index }) =>
            index === 0 ||
            (dates.length >= 6 && index === dates.length - 1) ||
            (index + 1) % 5 === 0,
        );
  const labels = range === "month"
    ? rawLabels.filter(({ index }, labelIndex) => {
        const next = rawLabels[labelIndex + 1];
        if (!next || next.index !== dates.length - 1) return true;

        // Always keep the final day, but omit the preceding tick when the two
        // labels cannot fit cleanly (notably day 30 beside day 31 on phones).
        const usableWidth = axisWidth || 320;
        const pixelGap =
          ((next.index - index) / Math.max(1, dates.length - 1)) * usableWidth;
        return pixelGap >= 22;
      })
    : rawLabels;
  return (
    <View style={styles.trendFrame}>
      {children}
      <View
        style={[
          styles.trendXAxis,
          { marginLeft: axisInsetLeft, marginRight: axisInsetRight },
        ]}
        onLayout={({ nativeEvent }) => setAxisWidth(nativeEvent.layout.width)}
        pointerEvents="none"
      >
        {labels.map(({ index, label }) => {
          const atStart = index === 0;
          const atEnd = index === dates.length - 1;
          return (
            <Text
              key={`${dates[index]}-${label}`}
              style={[
                styles.trendXAxisLabel,
                {
                  color: colors.muted,
                  left: `${(index / Math.max(1, dates.length - 1)) * 100}%`,
                  marginLeft: atStart ? 0 : atEnd ? -28 : -14,
                  textAlign: atStart ? "left" : atEnd ? "right" : "center",
                },
              ]}
            >
              {label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function downsampleValues(values: (number | null)[], maxPoints: number) {
  if (values.length <= maxPoints) return values;
  const chunk = Math.ceil(values.length / maxPoints);
  const result: (number | null)[] = [];
  for (let index = 0; index < values.length; index += chunk) {
    const group = values
      .slice(index, index + chunk)
      .filter((value): value is number => value !== null);
    result.push(
      group.length
        ? group.reduce((sum, value) => sum + value, 0) / group.length
        : null,
    );
  }
  return result;
}

function SingleLineTrend({
  values,
  color,
  target,
  unit,
  colors,
  showBars = false,
}: {
  values: (number | null)[];
  color: string;
  target: number;
  unit: string;
  colors: ReturnType<typeof useAppColors>;
  showBars?: boolean;
}) {
  const locale = useLocale();
  const [width, setWidth] = useState(0);
  const height = 148;
  const plotLeft = 44;
  const plotRight = 8;
  const plotTop = 12;
  const plotBottom = 132;
  const plotHeight = plotBottom - plotTop;
  const series = downsampleValues(values, 64);
  const numeric = series.filter((value): value is number => value !== null);
  const safeTarget = Number.isFinite(target) ? target : (numeric[0] ?? 0);
  const rawMin = Math.min(...numeric, safeTarget);
  const rawMax = Math.max(...numeric, safeTarget);
  const padding = Math.max(0.5, (rawMax - rawMin) * 0.12);
  const minValue = rawMin - padding;
  const maxValue = rawMax + padding;
  const span = Math.max(1, maxValue - minValue);
  const plotWidth = Math.max(0, width - plotLeft - plotRight);
  const point = (value: number | null, index: number) => ({
    x:
      series.length === 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (index / Math.max(1, series.length - 1)) * plotWidth,
    y:
      value === null
        ? null
        : plotBottom - ((value - minValue) / span) * plotHeight,
  });
  const points = series.map(point);
  const connectedPoints = points.filter(
    (item): item is { x: number; y: number } => item.y !== null,
  );
  const goalY = plotBottom - ((safeTarget - minValue) / span) * plotHeight;
  const goalLabelTop =
    goalY > plotTop + 18 ? goalY - 15 : Math.min(plotBottom - 13, goalY + 3);
  const ticks = [maxValue, (maxValue + minValue) / 2, minValue];
  const formatAxisValue = (value: number) =>
    Math.abs(value) >= 100
      ? Math.round(value).toLocaleString(locale)
      : (Math.round(value * 10) / 10).toLocaleString(locale);
  return (
    <View
      style={[styles.bpChart, { height }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {ticks.map((tick, index) => {
        const top = plotBottom - ((tick - minValue) / span) * plotHeight;
        return (
          <React.Fragment key={`${tick}-${index}`}>
            <View
              style={[
                styles.lineGrid,
                {
                  left: plotLeft,
                  right: plotRight,
                  top,
                  borderTopColor: colors.border,
                },
              ]}
            />
            <Text
              style={[
                styles.lineTickLabel,
                { top: top - 6, color: colors.muted },
              ]}
            >
              {formatAxisValue(tick)}
            </Text>
          </React.Fragment>
        );
      })}
      <View
        style={[
          styles.lineYAxis,
          {
            left: plotLeft,
            top: plotTop,
            height: plotHeight,
            backgroundColor: colors.border,
          },
        ]}
      />
      <View
        style={[
          styles.lineGoalReference,
          {
            left: plotLeft,
            right: plotRight,
            top: goalY,
            borderTopColor: color,
          },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.lineGoalLabel,
          {
            right: plotRight + 2,
            top: goalLabelTop,
            color,
            backgroundColor: colors.card,
          },
        ]}
      >
        Target {formatAxisValue(safeTarget)}{unit ? ` ${unit}` : ""}
      </Text>
      {showBars && width > 0
        ? points.map((current, index) => {
            if (current.y === null) return null;
            const barWidth = Math.max(
              2,
              Math.min(14, (plotWidth / Math.max(1, series.length)) * 0.58),
            );
            return (
              <View
                key={`overlay-bar-${index}`}
                style={[
                  styles.lineOverlayBar,
                  {
                    left: current.x - barWidth / 2,
                    top: current.y,
                    width: barWidth,
                    height: Math.max(2, plotBottom - current.y),
                    backgroundColor: `${color}3D`,
                  },
                ]}
              />
            );
          })
        : null}
      {width > 0
        ? connectedPoints.slice(1).map((current, index) => {
            const previous = connectedPoints[index];
            const dx = current.x - previous.x;
            const dy = current.y - previous.y;
            return (
              <View
                key={`line-${index}`}
                style={[
                  styles.chartSegment,
                  {
                    backgroundColor: color,
                    left: previous.x,
                    top: previous.y,
                    width: Math.sqrt(dx * dx + dy * dy),
                    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                  },
                ]}
              />
            );
          })
        : null}
      {width > 0
        ? points.map((current, index) =>
            current.y === null ? null : (
              <View
                key={`dot-${index}`}
                style={[
                  styles.chartDot,
                  {
                    backgroundColor: color,
                    left: current.x - 3,
                    top: current.y - 3,
                    width: 6,
                    height: 6,
                  },
                ]}
              />
            ),
          )
        : null}
      {!numeric.length ? (
        <Text style={[styles.sub, { color: colors.muted }]}>No data</Text>
      ) : null}
    </View>
  );
}

function BloodPressureTrend({
  systolic,
  diastolic,
  systolicColor,
  diastolicColor,
  systolicRange,
  diastolicRange,
}: {
  systolic: (number | null)[];
  diastolic: (number | null)[];
  systolicColor: string;
  diastolicColor: string;
  systolicRange: { min: number; max: number };
  diastolicRange: { min: number; max: number };
}) {
  const colors = useAppColors();
  const [width, setWidth] = useState(0);
  const height = 148;
  const plotLeft = 40;
  const plotRight = 8;
  const plotTop = 8;
  const plotBottom = 140;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = Math.max(0, width - plotLeft - plotRight);
  const all = [...systolic, ...diastolic].filter(
    (value): value is number => value !== null,
  );
  const minValue = Math.max(
    0,
    Math.min(...all, systolicRange.min, diastolicRange.min) - 15,
  );
  const maxValue = Math.max(...all, systolicRange.max, diastolicRange.max, 1) + 15;
  const span = Math.max(1, maxValue - minValue);
  const y = (value: number) =>
    plotBottom - ((value - minValue) / span) * plotHeight;
  const points = (values: (number | null)[]) =>
    values.map((value, index) => ({
      x:
        values.length === 1
          ? plotLeft + plotWidth / 2
          : plotLeft + (index / Math.max(1, values.length - 1)) * plotWidth,
      y: value === null ? null : y(value),
    }));
  const ticks = [maxValue, (maxValue + minValue) / 2, minValue];
  const draw = (values: (number | null)[], color: string) => {
    const series = points(values);
    const connected = series.filter(
      (point): point is { x: number; y: number } => point.y !== null,
    );
    return (
      <>
        {connected.slice(1).map((point, index) => {
          const previous = connected[index];
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          return (
            <View
              key={`line-${index}`}
              style={[
                styles.chartSegment,
                {
                  backgroundColor: color,
                  left: previous.x,
                  top: previous.y,
                  width: length,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          );
        })}
        {series.map((point, index) =>
          point.y === null ? null : (
          <View
            key={`dot-${index}`}
            style={[
              styles.chartDot,
              {
                backgroundColor: color,
                left: point.x - 4,
                top: point.y - 4,
              },
            ]}
          />
          ),
        )}
      </>
    );
  };
  return (
    <View>
      <View style={styles.bpLegend}>
        <LegendDot label="Systolic" color={systolicColor} />
        <LegendDot label="Diastolic" color={diastolicColor} />
      </View>
      <View
        style={[styles.bpChart, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {ticks.map((tick, index) => {
          const top = y(tick);
          return (
            <React.Fragment key={`${tick}-${index}`}>
              <View
                style={[
                  styles.lineGrid,
                  {
                    left: plotLeft,
                    right: plotRight,
                    top,
                    borderTopColor: colors.border,
                  },
                ]}
              />
              <Text
                style={[
                  styles.lineTickLabel,
                  { top: top - 6, color: colors.muted },
                ]}
              >
                {Math.round(tick)}
              </Text>
            </React.Fragment>
          );
        })}
        <View
          style={[
            styles.lineYAxis,
            {
              left: plotLeft,
              top: plotTop,
              height: plotHeight,
              backgroundColor: colors.border,
            },
          ]}
        />
        {[systolicRange, diastolicRange].map((range, index) => (
          <View
            key={index}
            style={[
              styles.bpGoalBand,
              {
                left: plotLeft,
                right: plotRight,
                backgroundColor: `${index === 0 ? systolicColor : diastolicColor}12`,
                bottom: height - y(range.min),
                height: Math.max(2, y(range.min) - y(range.max)),
              },
            ]}
          />
        ))}
        {width > 0 ? draw(systolic, systolicColor) : null}
        {width > 0 ? draw(diastolic, diastolicColor) : null}
      </View>
    </View>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.time, { color }]}>{label}</Text>
    </View>
  );
}
function Stat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}
function hasData(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
) {
  return hasMetricData(state, tracker, state.currentUserId, day);
}

function formatFastDateTime(
  value: Date,
  timeFormat: "12h" | "24h",
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(value);
}

function formatFastMinutes(
  value: number,
  language: AppLanguage,
  locale: string,
) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const number = new Intl.NumberFormat(locale);
  const parts = [];
  if (hours)
    parts.push(`${number.format(hours)} ${translateDomainText(language, "hr")}`);
  if (remainder || !parts.length)
    parts.push(`${number.format(remainder)} ${translateDomainText(language, "min")}`);
  return parts.join(" ");
}

function summaryLine(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
  value: number,
  target: number,
  applicable: boolean,
) {
  if (!applicable) {
    if (tracker.id === "todo_completion")
      return "No to-dos are scheduled for this date.";
    if (
      tracker.id === "daily_deficit" ||
      tracker.id === "weekly_deficit_balance"
    )
      return "Food has not been recorded, so no energy result is calculated.";
    if (
      tracker.id === "blood_pressure_systolic" ||
      tracker.healthMapping?.dataType === "blood_pressure"
    )
      return "No blood-pressure reading has been recorded for this date.";
    if (
      tracker.id === "sleep" ||
      tracker.healthMapping?.dataType === "sleep"
    )
      return "No sleep has been recorded for this date.";
    return `No ${tracker.name.toLowerCase()} data has been recorded for this date.`;
  }
  if (tracker.goalEnabled === false)
    return "Informational reading · no target attached";
  if (tracker.id === "food")
    return `${Math.round(value)} consumed · ${Math.max(0, Math.round(target - value))} remaining`;
  if (tracker.id === "weight") {
    const first = state.entries
      .filter(
        (entry) =>
          entry.userId === state.currentUserId && entry.metricId === "weight",
      )
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))[0];
    const change = first ? value - Number(first.value) : 0;
    return first
      ? `${change > 0 ? "+" : ""}${change.toFixed(1)} kg from starting weight`
      : "Add a first weigh-in to establish your baseline";
  }
  if (tracker.goalRange)
    return `Preferred range ${tracker.goalRange.min}–${tracker.goalRange.max} ${tracker.unit}`;
  if (tracker.goal.kind === "at_least" && value > target)
    return `${formatMetricValue(tracker, value - target)} above goal`;
  return `Target ${formatMetricValue(tracker, target)}`;
}
function nutritionLine(
  nutrition: NonNullable<
    ReturnType<typeof useApp>["state"]["entries"][number]["nutrition"]
  >,
) {
  return FOOD_NUTRIENTS.flatMap((nutrient) => {
    const value = Number(nutrition[nutrient.nutritionKey]);
    return Number.isFinite(value) && value > 0
      ? [`${nutrient.label} ${Math.round(value * 100) / 100} ${displayNutrientUnit(nutrient.unit)}`]
      : [];
  })
    .join(" · ");
}
const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 1 },
  weightPlan: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  controls: {
    alignItems: "stretch",
    gap: 8,
    marginBottom: 10,
  },
  periodCard: { padding: 5 },
  periodBar: { flexDirection: "row", alignItems: "center", gap: 3 },
  periodChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    paddingHorizontal: 2,
  },
  periodText: {
    alignSelf: "stretch",
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
    paddingHorizontal: 1,
  },
  periodChoiceYesterday: { flex: 1.22 },
  periodChoiceOverall: { flex: 1.08 },
  periodChevron: { marginTop: -2 },
  foodMacroCard: { gap: 0 },
  foodMacroHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  foodNutritionHeaderToggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  foodMacroIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  foodMacroTitle: { fontSize: 10, fontWeight: "900" },
  foodMacroHint: { fontSize: 7.5, fontWeight: "700", marginTop: 2 },
  foodMacroBody: { borderTopWidth: 1, paddingTop: 10, marginTop: 7, gap: 10 },
  foodMacroPieRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 2,
  },
  foodMacroDonut: { width: 108, height: 108, position: "relative" },
  foodMacroDonutCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  foodMacroDonutLabel: { fontSize: 6.5, fontWeight: "900", letterSpacing: 0.8 },
  foodMacroDonutValue: { fontSize: 16, fontWeight: "900", marginTop: -1 },
  foodMacroLegend: { flex: 1, minWidth: 0, gap: 7 },
  foodNutritionLegendWithMode: { paddingTop: 29 },
  foodNutritionModeSwitch: {
    position: "absolute",
    right: 0,
    top: 0,
    height: 25,
    borderWidth: 1,
    borderRadius: 8,
    padding: 2,
    flexDirection: "row",
  },
  foodNutritionModeChoice: {
    minWidth: 48,
    paddingHorizontal: 5,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  foodNutritionModeText: { fontSize: 6.5, fontWeight: "900" },
  foodMacroLegendRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  foodMacroDot: { width: 7, height: 7, borderRadius: 4 },
  foodMacroLegendName: { fontSize: 9, fontWeight: "900" },
  foodMacroLegendValue: { fontSize: 8, fontWeight: "700", marginTop: 1 },
  foodMacroCaption: { fontSize: 7.5, lineHeight: 11, textAlign: "center" },
  foodNutritionAverageCaption: { fontSize: 7.5, fontWeight: "800", textAlign: "center" },
  foodMacroProgressList: { gap: 10, marginTop: 2 },
  foodMacroProgress: { gap: 4 },
  foodMacroProgressHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  foodMacroProgressName: { flexDirection: "row", alignItems: "center", gap: 6 },
  foodMacroProgressLabel: { fontSize: 9, fontWeight: "900" },
  foodMacroProgressValue: { fontSize: 8, fontWeight: "800" },
  foodMacroProgressTrack: {
    height: 9,
    borderRadius: 5,
    position: "relative",
    overflow: "visible",
  },
  foodMacroProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
  },
  foodMacroGoalTick: {
    position: "absolute",
    top: -3,
    bottom: -3,
    width: 2,
    borderRadius: 1,
    marginLeft: -1,
  },
  foodMacroGoalCopy: { fontSize: 7, fontWeight: "800", textAlign: "right" },
  foodMacroEmpty: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  foodMacroEmptyText: { flex: 1, fontSize: 8.5, lineHeight: 13 },
  foodMacroBarsWrap: { marginTop: 2 },
  foodMacroBarLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    marginBottom: 8,
  },
  foodMacroBarLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  foodMacroBarLegendText: { fontSize: 7, fontWeight: "800" },
  foodMacroChartRow: { flexDirection: "row", height: 144 },
  foodMacroYAxis: {
    width: 40,
    height: 126,
    paddingRight: 5,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  foodMacroAxisUnit: { position: "absolute", top: -10, right: 5, fontSize: 6, fontWeight: "900" },
  foodMacroYAxisLabel: { fontSize: 6.5, fontWeight: "800" },
  foodMacroChartViewport: { flex: 1, minWidth: 0 },
  foodMacroScrollablePlot: { flex: 1, minWidth: 0, height: 144 },
  foodMacroPlot: { height: 126, position: "relative" },
  foodMacroGrid: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  foodMacroBars: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
    zIndex: 1,
  },
  foodMacroBarSlot: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 0,
  },
  foodMacroBarTarget: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    position: "relative",
  },
  foodMacroBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    opacity: 0.86,
  },
  foodMacroBarGoalTick: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 2,
    zIndex: 2,
  },
  foodMacroMissingBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    opacity: 0.55,
  },
  foodMacroXAxis: {
    height: 14,
    marginTop: 4,
    position: "relative",
  },
  foodMacroXAxisLabel: {
    position: "absolute",
    left: 0,
    width: 82,
    fontSize: 6.5,
    fontWeight: "800",
  },
  foodMacroXAxisMiddle: { left: "50%", marginLeft: -41, textAlign: "center" },
  foodMacroXAxisEnd: { left: undefined, right: 0, textAlign: "right" },
  foodMacroAxisCaption: { fontSize: 7, fontWeight: "700", textAlign: "center" },
  recordsCard: { gap: 0 },
  recordsHeading: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recordsTitle: { flexDirection: "row", alignItems: "center", gap: 9 },
  recordsName: { fontSize: 10, fontWeight: "900" },
  recordsHint: { fontSize: 7, fontWeight: "700", marginTop: 2 },
  recordGrid: {
    borderTopWidth: 1,
    paddingTop: 9,
    marginTop: 7,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  navigator: {
    padding: 8,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navCopy: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navDate: { flexDirection: "row", alignItems: "center", gap: 5 },
  navTitle: { fontSize: 14, fontWeight: "900" },
  navSub: { fontSize: 9, marginTop: 2, textAlign: "center" },
  calendar: { borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  summary: { marginBottom: 9 },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  label: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  value: { fontSize: 25, fontWeight: "900", marginTop: 4 },
  sub: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  weightJourney: { gap: 8, marginTop: 15 },
  weightJourneyLabels: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  weightJourneyCurrent: { alignItems: "center" },
  weightJourneyTarget: { alignItems: "flex-end" },
  weightJourneyLabel: { fontSize: 7, fontWeight: "900", letterSpacing: 0.7 },
  weightJourneyValue: { fontSize: 10, fontWeight: "900", marginTop: 2 },
  weightJourneyCaption: { fontSize: 8, textAlign: "center" },
  dayProgress: { gap: 6, marginTop: 12 },
  dayProgressHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayProgressLabel: { fontSize: 8, fontWeight: "900" },
  largeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chart: {
    height: 92,
    marginTop: 16,
    marginLeft: 40,
    marginRight: 4,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    position: "relative",
  },
  lineOverlayBar: { position: "absolute", borderRadius: 3, zIndex: 1 },
  barAxisLabel: {
    position: "absolute",
    left: -40,
    width: 34,
    marginTop: -5,
    textAlign: "right",
    fontSize: 7,
    fontWeight: "800",
  },
  trendFrame: { width: "100%" },
  trendXAxis: {
    position: "relative",
    height: 15,
    marginTop: 3,
  },
  trendXAxisLabel: {
    position: "absolute",
    top: 0,
    width: 28,
    fontSize: 6.5,
    fontWeight: "800",
  },
  denseChart: {
    height: 104,
    gap: 0,
    paddingHorizontal: 1,
  },
  bpLegend: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  bpChart: {
    marginTop: 9,
    position: "relative",
    overflow: "hidden",
  },
  bpGoalBand: { position: "absolute", left: 0, right: 0 },
  chartSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    transformOrigin: "left center",
    zIndex: 2,
  },
  chartDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 3,
  },
  lineGrid: {
    position: "absolute",
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 0,
  },
  lineYAxis: {
    position: "absolute",
    width: StyleSheet.hairlineWidth,
    zIndex: 1,
  },
  lineTickLabel: {
    position: "absolute",
    left: 0,
    width: 38,
    textAlign: "right",
    fontSize: 7,
    fontWeight: "800",
  },
  lineGoalReference: {
    position: "absolute",
    borderTopWidth: 1,
    borderStyle: "dashed",
    zIndex: 2,
  },
  lineGoalLabel: {
    position: "absolute",
    maxWidth: 120,
    fontSize: 7,
    fontWeight: "900",
    paddingHorizontal: 3,
    zIndex: 4,
  },
  rangeGoalWrap: { gap: 4 },
  rangeGoalTrack: {
    height: 9,
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  },
  rangeGoalFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
  },
  rangeGoalBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  rangeGoalCaption: { fontSize: 7, fontWeight: "800" },
  barSlot: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
  },
  denseBarSlot: { gap: 0 },
  bar: {
    flex: 1,
    minHeight: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    opacity: 0.8,
  },
  denseBar: {
    borderTopLeftRadius: 0.5,
    borderTopRightRadius: 0.5,
  },
  missingBar: {
    flex: 1,
    height: 2,
    borderRadius: 2,
    opacity: 0.55,
  },
  denseMissingBar: { height: 1 },
  completionTrend: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 2,
    marginTop: 10,
  },
  completionTrendCell: {
    flex: 1,
    minWidth: 1,
    borderRadius: 3,
  },
  submetricTrend: { marginTop: 12 },
  submetricTrendTitle: {
    fontSize: 9,
    fontWeight: "900",
    marginBottom: 3,
  },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    zIndex: 2,
  },
  goalLabel: {
    position: "absolute",
    right: 0,
    top: -12,
    fontSize: 7,
    fontWeight: "900",
  },
  secondaryGoalLabel: { left: 0, right: undefined },
  trackingSince: { fontSize: 8, fontWeight: "800", marginTop: 8 },
  detailQuickActions: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 8,
  },
  skipToday: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  skipTodayText: { fontSize: 9, fontWeight: "900" },
  quickAddText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
    borderTopWidth: 1,
    marginTop: 13,
    paddingTop: 11,
  },
  stat: { width: "33.333%", paddingRight: 6 },
  statValue: { fontSize: 12, fontWeight: "900" },
  statLabel: { fontSize: 7, marginTop: 2 },
  logHeader: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  entryEditHint: { maxWidth: "62%", fontSize: 7.5, fontWeight: "700", textAlign: "right" },
  logActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  section: { fontSize: 13, fontWeight: "900" },
  logButton: {
    height: 30,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logButtonText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  entries: { gap: 7 },
  todoDetailCard: { gap: 7 },
  todoLabelFilters: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  todoLabelChip: { minHeight: 25, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  todoLabelText: { fontSize: 7, fontWeight: "900" },
  todoDetailRow: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  todoComplete: { textDecorationLine: "line-through", opacity: 0.62 },
  todoExtra: { gap: 3, marginTop: 5 },
  dateGroupHeader: {
    minHeight: 38,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateGroupMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  entry: { padding: 12 },
  entryTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  grow: { flex: 1 },
  entryTitle: { fontSize: 11, fontWeight: "900" },
  time: { fontSize: 8, marginTop: 3 },
  entryValue: { fontSize: 12, fontWeight: "900" },
  foodTimeBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.46)",
    justifyContent: "flex-end",
    padding: 12,
  },
  foodTimeSheet: { borderRadius: 22, padding: 15, gap: 12 },
  foodTimeHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  foodTimeTitle: { fontSize: 14, fontWeight: "900" },
  foodTimeMeal: { fontSize: 8.5, marginTop: 2 },
  foodTimeNote: { fontSize: 8, lineHeight: 12 },
  foodTimeActions: { flexDirection: "row", gap: 8 },
  foodTimeButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  foodTimeButtonText: { fontSize: 9, fontWeight: "900" },
  foodTimeSaveText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  note: { fontSize: 9, lineHeight: 14, marginTop: 7 },
  fastEntryDetails: { gap: 1 },
  image: { width: 92, height: 66, borderRadius: 10, marginTop: 8 },
  photoImageFrame: { width: "100%", height: 230, marginTop: 8 },
  photoImage: { width: "100%", height: "100%", borderRadius: 13 },
  photoToggle: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoCompare: { flexDirection: "row", gap: 7, marginTop: 7 },
  compareImageFrame: { flex: 1, height: 150 },
  compareImage: { width: "100%", height: "100%", borderRadius: 11 },
  compareButton: {
    height: 38,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  compareText: { fontSize: 9, fontWeight: "900" },
  empty: { fontSize: 10, textAlign: "center" },
  weeklyBalanceChartWrap: { marginTop: 14, gap: 4 },
  weeklyBalanceChart: { height: 126, position: "relative" },
  weeklyBalanceZeroLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    borderTopWidth: 2,
    zIndex: 2,
  },
  weeklyBalanceGoalLabel: {
    position: "absolute",
    right: 0,
    top: -12,
    fontSize: 7,
    fontWeight: "900",
  },
  weeklyBalanceBars: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    gap: 3,
  },
  weeklyBalanceSlot: { flex: 1, minWidth: 0 },
  weeklyBalanceHalfTop: {
    height: "50%",
    justifyContent: "flex-end",
    paddingHorizontal: 1,
  },
  weeklyBalanceHalfBottom: {
    height: "50%",
    justifyContent: "flex-start",
    paddingHorizontal: 1,
  },
  weeklyBalanceBar: { width: "100%", borderRadius: 3, opacity: 0.9 },
  weeklyBalanceMissing: {
    width: "100%",
    height: 2,
    borderRadius: 1,
    opacity: 0.65,
  },
  weeklyBalanceLabels: { flexDirection: "row", gap: 3 },
  weeklyBalanceLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 6.5,
    fontWeight: "800",
    textAlign: "center",
  },
  weeklyBalanceScale: { fontSize: 7, fontWeight: "700", textAlign: "center" },
  weeklyReportCard: { gap: 8 },
  weeklyEntriesCard: { gap: 8 },
  weeklyEntriesHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  weeklyEntryRow: {
    minHeight: 52,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  weeklyEntryIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  weeklyEntryValue: {
    width: "35%",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  weeklyReportHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  weeklyReportIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  weeklyReportGrid: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
  },
  weekRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
