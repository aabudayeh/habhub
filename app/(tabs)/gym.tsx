import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState as NativeAppState,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale, useLocalization } from "@/src/i18n";
import { localizeExerciseName, localizeMuscleLabel } from "@/src/i18n/domain";
import { DraftNumberInput } from "@/src/components/DraftNumberInput";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { Button, Card, Chip, PageHeader, ProgressBar, Screen, SectionHeader } from "@/src/components/ui";
import {
  dateKey,
  dateWithOffsetFrom,
  formatClockTime,
  friendlyDate,
} from "@/src/domain/date";
import {
  EXERCISE_CATALOG,
  EXERCISE_CATEGORY_LABELS,
  ExerciseCatalogItem,
  ExerciseCategory,
  MUSCLE_LABELS,
  catalogExercise,
  exerciseKey,
} from "@/src/domain/exerciseCatalog";
import {
  completedGymSets,
  averageGymRestSeconds,
  estimateGymActiveCalories,
  expandedGymExercises,
  exerciseHistory,
  exerciseIdentity,
  exerciseStats,
  exerciseTrend,
  formatGymDuration,
  gymSessionClockBounds,
  gymSessionTimeBreakdown,
  gymRecap,
  muscleGroupStats,
  recommendedRestSeconds,
  totalGymRestSeconds,
  totalGymSetWorkSeconds,
  trainingVolumeKg,
} from "@/src/domain/gym";
import {
  consumeWorkoutTimerActions,
  dismissWorkoutTimerNotification,
  showWorkoutTimerNotification,
  WORKOUT_TIMER_FINISH,
  WORKOUT_TIMER_NEXT,
  WORKOUT_TIMER_PAUSE,
  WorkoutNotificationStep,
} from "@/src/notifications/workoutTimer";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { readableTextColor } from "@/src/domain/colors";
import {
  AppLanguage,
  GymCalorieCalculationMode,
  GymExercise,
  GymIntensity,
  GymPlan,
  GymSession,
  GymSet,
  MuscleGroup,
  Visibility,
} from "@/src/types";

const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const intensities: GymIntensity[] = ["light", "moderate", "vigorous"];
type RunningWorkoutPhase = "work" | "set_rest" | "exercise_rest";
type WorkoutPhase = RunningWorkoutPhase | "paused";
type WorkoutTimer = {
  phase: WorkoutPhase;
  resumePhase?: RunningWorkoutPhase;
  startedAt: number;
  phaseStartedAt: number;
  phaseElapsedSeconds: number;
  completedElapsedSeconds: number;
  pausedSeconds: number;
  pauseStartedAt?: number;
  exerciseId: string;
  setId?: string;
};

type GymMode = "workout" | "progress" | "performance";
type GymPerformanceRange = "week" | "month" | "year" | "all" | "custom";
type GymPerformancePriority = "all" | "gaining" | "steady" | "focus" | "learning";

type StoredWorkoutDraft = {
  savedAt: number;
  localDate: string;
  sessionId: string;
  sessionName: string;
  duration: string;
  calories: string;
  calorieCalculationMode: GymCalorieCalculationMode;
  intensity: GymIntensity;
  sessionNotes: string;
  visibility: Visibility;
  selectedPlanId: string | null;
  setStartDelaySeconds: number;
  exercises: GymExercise[];
  timer: WorkoutTimer;
};

const workoutDraftKey = (userId: string) => `habhub-active-gym-workout-v2:${userId}`;

function timerPhaseElapsed(timer: WorkoutTimer, now: number) {
  return (
    timer.phaseElapsedSeconds +
    (timer.phase === "paused"
      ? 0
      : Math.max(0, Math.floor((now - timer.phaseStartedAt) / 1000)))
  );
}

function timerSessionElapsed(timer: WorkoutTimer, now: number) {
  return timer.completedElapsedSeconds + timerPhaseElapsed(timer, now);
}

function workoutNotificationSteps(
  exercises: GymExercise[],
  timer: WorkoutTimer,
  language: AppLanguage,
  translate: (source: string) => string,
): WorkoutNotificationStep[] {
  const steps: WorkoutNotificationStep[] = [];
  const currentExerciseIndex = exercises.findIndex(
    (exercise) => exercise.id === timer.exerciseId,
  );
  if (currentExerciseIndex < 0) return steps;
  const runningPhase =
    timer.phase === "paused" ? (timer.resumePhase ?? "work") : timer.phase;
  const addWork = (exercise: GymExercise, set: GymSet) => {
    const setIndex = exercise.sets.findIndex((item) => item.id === set.id);
    const exerciseName = localizeExerciseName(language, exercise);
    const trackingMode =
      exercise.trackingMode ??
      catalogExercise(exercise.exerciseKey)?.trackingMode ??
      "load_reps";
    const paired = set.superset
      ? ` + ${localizeExerciseName(language, set.superset)} ${set.superset.weightKg || 0} kg × ${set.superset.reps}`
      : "";
    const target =
      trackingMode === "duration"
        ? `${Math.round(((set.workSeconds ?? 0) / 60) * 10) / 10} min`
        : trackingMode === "reps"
          ? `${set.reps} reps`
          : `${set.weightKg || 0} kg × ${set.reps} reps${paired}`;
    steps.push({
      title: translate(`${exerciseName} · Set ${setIndex + 1}/${exercise.sets.length}`),
      body: translate(`${target} · use Next when the set is done`),
      phase: "work",
    });
  };
  const appendExercise = (
    exercise: GymExercise,
    pendingSets: GymSet[],
    betweenExercises: boolean,
    restBeforeFirstSet = false,
  ) => {
    if (!pendingSets.length) return;
    if (betweenExercises)
      steps.push({
        title: translate(`Between exercises · next ${localizeExerciseName(language, exercise)}`),
        body: translate("REST · use Next when you are ready to start"),
        phase: "rest",
      });
    pendingSets.forEach((set, index) => {
      if (restBeforeFirstSet || index > 0)
        steps.push({
          title: translate(`${localizeExerciseName(language, exercise)} · set rest`),
          body: translate(`REST · next is set ${exercise.sets.findIndex((item) => item.id === set.id) + 1}`),
          phase: "rest",
        });
      addWork(exercise, set);
    });
  };

  const currentExercise = exercises[currentExerciseIndex];
  const currentSetIndex = timer.setId
    ? currentExercise.sets.findIndex((set) => set.id === timer.setId)
    : -1;
  if (runningPhase === "work" && currentSetIndex >= 0) {
    addWork(currentExercise, currentExercise.sets[currentSetIndex]);
    appendExercise(
      currentExercise,
      currentExercise.sets
        .slice(currentSetIndex + 1)
        .filter((set) => !set.completed),
      false,
      true,
    );
  } else if (runningPhase === "set_rest") {
    const pending = currentExercise.sets
      .slice(Math.max(0, currentSetIndex + 1))
      .filter((set) => !set.completed);
    if (pending.length) {
      const nextSet = pending[0];
      steps.push({
        title: `${currentExercise.name} · set rest`,
        body: `REST · next is set ${currentExercise.sets.findIndex((item) => item.id === nextSet.id) + 1}`,
        phase: "rest",
      });
      appendExercise(currentExercise, pending, false);
    }
  }
  exercises.slice(currentExerciseIndex + 1).forEach((exercise) => {
    appendExercise(
      exercise,
      exercise.sets.filter((set) => !set.completed),
      true,
    );
  });
  if (steps.length)
    steps[steps.length - 1] = {
      ...steps[steps.length - 1],
      body: `${steps[steps.length - 1].body} · finish the workout in HabHub`,
    };
  return steps;
}

function blankSet(reps = 10, weightKg = 0): GymSet {
  return { id: uniqueId("set"), reps, weightKg, completed: false };
}

function fromCatalog(item: ExerciseCatalogItem, previous?: GymExercise): GymExercise {
  return {
    id: uniqueId("exercise"),
    exerciseKey: item.key,
    name: item.name,
    muscleGroups: item.muscles,
    customMet: item.met,
    trackingMode: item.trackingMode,
    notes: previous?.notes,
    completed: false,
    sets: previous?.sets.length
      ? previous.sets.map((set) => ({ ...set, id: uniqueId("set"), completed: false }))
      : [
          item.trackingMode === "duration"
            ? { ...blankSet(0, 0), workSeconds: 0 }
            : blankSet(),
        ],
  };
}

function cloneExercises(exercises: GymExercise[], preserveCompletion = false) {
  return exercises.map((exercise) => ({
    ...exercise,
    id: uniqueId("exercise"),
    completed: preserveCompletion ? exercise.completed : false,
    restAfterSeconds: preserveCompletion
      ? exercise.restAfterSeconds
      : undefined,
    restTargetSeconds: preserveCompletion
      ? exercise.restTargetSeconds
      : undefined,
    sets: exercise.sets.map((set) => ({
      ...set,
      id: uniqueId("set"),
      completed: preserveCompletion ? set.completed : false,
      workSeconds: preserveCompletion ? set.workSeconds : undefined,
      restSeconds: preserveCompletion ? set.restSeconds : undefined,
      restTargetSeconds: preserveCompletion ? set.restTargetSeconds : undefined,
      superset: set.superset
        ? {
            ...set.superset,
            workSeconds: preserveCompletion
              ? set.superset.workSeconds
              : undefined,
          }
        : undefined,
    })),
  }));
}

function GymWiggle({
  active,
  index,
  children,
}: {
  active: boolean;
  index: number;
  children: React.ReactNode;
}) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);
    if (!active) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay((index % 4) * 35),
        Animated.timing(value, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: -1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, index, value]);

  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: value.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: ["-0.25deg", "0deg", "0.25deg"],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function GymDraggableExercise({
  active,
  index,
  count,
  spacing = 8,
  onMove,
  children,
}: {
  active: boolean;
  index: number;
  count: number;
  spacing?: number;
  onMove: (target: number) => void;
  children: React.ReactNode;
}) {
  const smoothDrag = useSmoothReorderGesture({
    enabled: active,
    index,
    count,
    initialStep: 64,
    onMove,
  });

  return (
    <GestureDetector gesture={smoothDrag.gesture}>
    <Reanimated.View
      onLayout={(event) =>
        smoothDrag.setStep(event.nativeEvent.layout.height + spacing)
      }
      style={[
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 30 : 5,
          elevation: smoothDrag.dragging ? 12 : 0,
        },
      ]}
      collapsable={false}
    >
      {children}
    </Reanimated.View>
    </GestureDetector>
  );
}

function GymScreen() {
  const isFocused = useIsFocused();
  const {
    state,
    hydrated,
    saveGymPlan,
    deleteGymPlan,
    saveGroupGymPlan,
    deleteGroupGymPlan,
    saveGymSession,
    deleteGymSession,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const { language, t } = useLocalization();
  const scrollRef = useRef<ScrollView>(null);
  const targetOffsets = useRef<Record<string, number>>({});
  const [localDate, setLocalDate] = useState(dateKey());
  const [mode, setMode] = useState<GymMode>("workout");
  const [sessionId, setSessionId] = useState(() => uniqueId("gym"));
  const [sessionName, setSessionName] = useState("Workout");
  const [duration, setDuration] = useState("");
  const [calories, setCalories] = useState("");
  const [calorieCalculationMode, setCalorieCalculationMode] =
    useState<GymCalorieCalculationMode>("session_met");
  const [intensity, setIntensity] = useState<GymIntensity>("moderate");
  const [sessionNotes, setSessionNotes] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("group");
  const [setStartDelaySeconds, setSetStartDelaySeconds] = useState(0);
  const [timerSettingsOpen, setTimerSettingsOpen] = useState(false);
  const [calorieEstimateOpen, setCalorieEstimateOpen] = useState(false);
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [exerciseEditMode, setExerciseEditMode] = useState(false);
  useEffect(() => {
    setCloudSyncPaused("gym-edit", exerciseEditMode);
    return () => setCloudSyncPaused("gym-edit", false);
  }, [exerciseEditMode]);
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [customExerciseName, setCustomExerciseName] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState<MuscleGroup | "all">("all");
  const [pickerCategory, setPickerCategory] = useState<ExerciseCategory | "all">(
    "strength",
  );
  const [supersetTarget, setSupersetTarget] = useState<{
    exerciseId: string;
    setId: string;
  } | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [workoutTimer, setWorkoutTimer] = useState<WorkoutTimer | null>(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [appActivity, setAppActivity] = useState(
    NativeAppState.currentState,
  );
  const restAlerted = useRef(false);
  const handledTimerResponse = useRef<string | null>(null);
  const timerActionRef = useRef<
    (action: string, occurredAt?: number) => void
  >(() => undefined);
  const notificationPayloadRef = useRef<{
    title: string;
    body: string;
    phase: "work" | "rest" | "paused";
    steps: WorkoutNotificationStep[];
    phaseStartedAt: number;
    phaseElapsedSeconds: number;
  } | null>(null);
  const initializedDate = useRef<string | null>(null);
  const [workoutDraftReady, setWorkoutDraftReady] = useState(false);
  const [performanceRange, setPerformanceRange] =
    useState<GymPerformanceRange>("all");
  const [performanceCustomStart, setPerformanceCustomStart] = useState(
    dateWithOffsetFrom(dateKey(), -29),
  );
  const [performanceCustomEnd, setPerformanceCustomEnd] = useState(dateKey());
  const [performanceCustomPicker, setPerformanceCustomPicker] = useState<
    "start" | "end" | null
  >(null);
  const [performanceFilters, setPerformanceFilters] = useState<string[]>([]);
  const [performancePriority, setPerformancePriority] =
    useState<GymPerformancePriority>("all");
  const [performanceEditMode, setPerformanceEditMode] = useState(false);
  const [performanceOrder, setPerformanceOrder] = useState<string[]>([]);
  const [performancePinned, setPerformancePinned] = useState<string[]>([]);
  const [performanceHidden, setPerformanceHidden] = useState<string[]>([]);
  useEffect(() => {
    setCloudSyncPaused("gym-performance-edit", performanceEditMode);
    return () => setCloudSyncPaused("gym-performance-edit", false);
  }, [performanceEditMode]);

  const moveExercise = useCallback((exerciseId: string, target: number) => {
    setExercises((current) => {
      const from = current.findIndex((item) => item.id === exerciseId);
      const bounded = Math.max(0, Math.min(current.length - 1, target));
      if (from < 0 || from === bounded) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(bounded, 0, moved);
      return next;
    });
  }, []);

  const selectMode = useCallback(
    (nextMode: GymMode) => {
      if (nextMode === mode) return;
      setMode(nextMode);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ y: 0, animated: false }),
      );
    },
    [mode],
  );
  const pageSwipe = usePageSwipeGesture({
    enabled:
      !exerciseEditMode &&
      !performanceEditMode &&
      !pickerOpen &&
      !recapOpen &&
      !performanceCustomPicker,
    onPrevious: () => {
      const modes: GymMode[] = ["workout", "progress", "performance"];
      selectMode(modes[Math.max(0, modes.indexOf(mode) - 1)]);
    },
    onNext: () => {
      const modes: GymMode[] = ["workout", "progress", "performance"];
      selectMode(modes[Math.min(modes.length - 1, modes.indexOf(mode) + 1)]);
    },
  });

  const personalPlans = useMemo(
    () =>
      (state.gymPlans ?? [])
        .filter((plan) => plan.userId === state.currentUserId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.currentUserId, state.gymPlans],
  );
  const sharedPlans = useMemo(
    () => state.group.gymPlans ?? [],
    [state.group.gymPlans],
  );
  const plans = useMemo(
    () => [...sharedPlans, ...personalPlans],
    [personalPlans, sharedPlans],
  );
  const trackerExerciseItems = useMemo(() => {
    const catalogByKey = new Map(
      EXERCISE_CATALOG.map((item) => [item.key, item]),
    );
    const sharedExercises = new Map(
      sharedPlans
        .flatMap((plan) => plan.exercises)
        .map((exercise) => [exercise.exerciseKey, exercise]),
    );
    const mapped = new Map<
      string,
      ExerciseCatalogItem & { groupExercise: boolean }
    >();
    const sources = [
      ...(state.group.metricConfiguration ?? []).map((metric) => ({
        metric,
        groupExercise: true,
      })),
      ...state.metrics.map((metric) => ({
        metric,
        groupExercise: false,
      })),
    ];
    sources.forEach(({ metric, groupExercise }) => {
      const mapping = metric.gymMapping;
      if (
        !mapping ||
        (mapping.kind !== "exercise_one_rep_max" &&
          mapping.kind !== "exercise_volume" &&
          mapping.kind !== "exercise_reps" &&
          mapping.kind !== "exercise_duration")
      )
        return;
      if (mapped.has(mapping.exerciseKey)) return;
      const catalog = catalogByKey.get(mapping.exerciseKey);
      const shared = sharedExercises.get(mapping.exerciseKey);
      mapped.set(mapping.exerciseKey, {
          key: mapping.exerciseKey,
          name:
            shared?.name ??
            catalog?.name ??
            metric.name.replace(/\s+(strength|volume|reps|duration)$/i, ""),
          muscles:
            metric.gymMuscleGroups ??
            shared?.muscleGroups ??
            catalog?.muscles ??
            ["full_body"],
          equipment: catalog?.equipment ?? ("other" as const),
          category: catalog?.category ?? "strength",
          trackingMode:
            catalog?.trackingMode ??
            (mapping.kind === "exercise_duration"
              ? "duration"
              : mapping.kind === "exercise_reps"
                ? "reps"
                : "load_reps"),
          aliases: catalog?.aliases ?? [],
          health: catalog?.health,
          supportsDistance: catalog?.supportsDistance,
          met: shared?.customMet ?? catalog?.met ?? 3.5,
          groupExercise,
        });
    });
    return [...mapped.values()];
  }, [sharedPlans, state.group.metricConfiguration, state.metrics]);
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManageGroup =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const sessions = useMemo(
    () =>
      (state.gymSessions ?? [])
        .filter((session) => session.userId === state.currentUserId)
        .sort(
          (a, b) =>
            b.localDate.localeCompare(a.localDate) ||
            b.recordedAt.localeCompare(a.recordedAt),
        ),
    [state.currentUserId, state.gymSessions],
  );
  const performanceDates = useMemo(() => {
    const end = dateKey();
    if (performanceRange === "week")
      return { start: dateWithOffsetFrom(end, -6), end };
    if (performanceRange === "month")
      return { start: dateWithOffsetFrom(end, -29), end };
    if (performanceRange === "year")
      return { start: `${end.slice(0, 4)}-01-01`, end };
    if (performanceRange === "custom")
      return {
        start: performanceCustomStart <= performanceCustomEnd
          ? performanceCustomStart
          : performanceCustomEnd,
        end: performanceCustomStart <= performanceCustomEnd
          ? performanceCustomEnd
          : performanceCustomStart,
      };
    return { start: undefined, end };
  }, [performanceCustomEnd, performanceCustomStart, performanceRange]);
  const performanceSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (!performanceDates.start ||
            session.localDate >= performanceDates.start) &&
          session.localDate <= performanceDates.end,
      ),
    [performanceDates.end, performanceDates.start, sessions],
  );
  const performanceExerciseMap = useMemo(
    () =>
      new Map(
        sessions.flatMap((session) =>
          expandedGymExercises(session.exercises).map(
            (exercise) => [exerciseIdentity(exercise), exercise] as const,
          ),
        ),
      ),
    [sessions],
  );
  const performanceFilterItems = useMemo(
    () => [
      ...[...performanceExerciseMap.entries()].map(([key, exercise]) => ({
        id: `exercise:${key}`,
        label: localizeExerciseName(language, exercise),
        sublabel: (exercise.muscleGroups ?? ["full_body"])
          .map((muscle) => localizeMuscleLabel(language, muscle))
          .join(" · "),
        group: "Exercises",
        icon: "barbell-outline" as const,
        color: accent,
      })),
      ...(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((muscle) => ({
        id: `muscle:${muscle}`,
        label: localizeMuscleLabel(language, muscle),
        group: "Muscle groups",
        icon: "body-outline" as const,
        color: palette.amber,
      })),
    ],
    [accent, language, performanceExerciseMap],
  );
  const performanceRows = useMemo(() => {
    const selectedExercises = new Set(
      performanceFilters
        .filter((id) => id.startsWith("exercise:"))
        .map((id) => id.slice("exercise:".length)),
    );
    const selectedMuscles = new Set(
      performanceFilters
        .filter((id) => id.startsWith("muscle:"))
        .map((id) => id.slice("muscle:".length) as MuscleGroup),
    );
    const rows = [...performanceExerciseMap.entries()]
      .filter(([key, exercise]) => {
        if (!performanceFilters.length) return true;
        return (
          selectedExercises.has(key) ||
          (exercise.muscleGroups ?? ["full_body"]).some((muscle) =>
            selectedMuscles.has(muscle),
          )
        );
      })
      .map(([key, exercise]) => {
        const stats = exerciseStats(
          performanceSessions,
          state.currentUserId,
          key,
          state.gymExerciseGoals?.[key],
        );
        const volume = stats.history.reduce(
          (sum, observation) => sum + observation.volumeKg,
          0,
        );
        return { key, exercise, stats, volume };
      });
    const priorityMatches = (row: (typeof rows)[number]) => {
      if (performancePriority === "all") return true;
      if (performancePriority === "gaining") return row.stats.trend === "building";
      if (performancePriority === "steady") return row.stats.trend === "steady";
      if (performancePriority === "focus") return row.stats.trend === "regressing";
      return row.stats.trend === "learning";
    };
    const visible = rows.filter(
      (row) => !performanceHidden.includes(row.key) && priorityMatches(row),
    );
    const orderIndex = new Map(performanceOrder.map((key, index) => [key, index]));
    return visible.sort((a, b) => {
      const pin = Number(performancePinned.includes(b.key)) - Number(performancePinned.includes(a.key));
      if (pin) return pin;
      const ordered = (orderIndex.get(a.key) ?? 9999) - (orderIndex.get(b.key) ?? 9999);
      if (ordered) return ordered;
      return b.stats.improvement - a.stats.improvement;
    });
  }, [
    performanceExerciseMap,
    performanceFilters,
    performanceHidden,
    performanceOrder,
    performancePinned,
    performancePriority,
    performanceSessions,
    state.currentUserId,
    state.gymExerciseGoals,
  ]);
  useEffect(() => {
    const keys = [...performanceExerciseMap.keys()];
    setPerformanceOrder((current) => [
      ...current.filter((key) => keys.includes(key)),
      ...keys.filter((key) => !current.includes(key)),
    ]);
  }, [performanceExerciseMap]);
  const performanceTrendCounts = useMemo(() => {
    const counts = { gaining: 0, steady: 0, focus: 0, learning: 0 };
    performanceExerciseMap.forEach((_exercise, key) => {
      const trend = exerciseStats(
        performanceSessions,
        state.currentUserId,
        key,
      ).trend;
      if (trend === "building") counts.gaining += 1;
      else if (trend === "steady") counts.steady += 1;
      else if (trend === "regressing") counts.focus += 1;
      else counts.learning += 1;
    });
    return counts;
  }, [performanceExerciseMap, performanceSessions, state.currentUserId]);
  const performanceHighlights = useMemo(() => {
    const candidates = [...performanceExerciseMap.entries()]
      .map(([key, exercise]) => ({
        key,
        exercise,
        stats: exerciseStats(performanceSessions, state.currentUserId, key),
      }))
      .filter((row) => row.stats.sessions >= 2);
    return {
      strongest: [...candidates].sort(
        (a, b) => b.stats.improvement - a.stats.improvement,
      )[0],
      focus: [...candidates]
        .filter((row) => row.stats.trend === "regressing" || row.stats.trend === "steady")
        .sort((a, b) => a.stats.improvement - b.stats.improvement)[0],
    };
  }, [performanceExerciseMap, performanceSessions, state.currentUserId]);

  const movePerformanceRow = useCallback((key: string, target: number) => {
    setPerformanceOrder((current) => {
      const from = current.indexOf(key);
      const bounded = Math.max(0, Math.min(current.length - 1, target));
      if (from < 0 || from === bounded) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(bounded, 0, moved);
      return next;
    });
  }, []);
  const sessionsForDate = useMemo(
    () => sessions.filter((session) => session.localDate === localDate),
    [localDate, sessions],
  );
  const selectedSession = sessionsForDate.find(
    (session) => session.id === sessionId,
  );
  const savedDayTotals = useMemo(
    () =>
      sessionsForDate.reduce(
        (totals, session) => ({
          durationMinutes: totals.durationMinutes + session.durationMinutes,
          calories: totals.calories + Math.max(0, session.calories ?? 0),
        }),
        { durationMinutes: 0, calories: 0 },
      ),
    [sessionsForDate],
  );
  const gymDays = useMemo(
    () => new Set(sessions.map((session) => session.localDate)),
    [sessions],
  );
  const completedGymDays = useMemo(
    () =>
      new Set(
        sessions
          .filter((session) => completedGymSets(session.exercises) > 0)
          .map((session) => session.localDate),
      ),
    [sessions],
  );
  const completedSets = completedGymSets(exercises);
  const volume = trainingVolumeKg(exercises);
  const loggedRestSeconds = totalGymRestSeconds(exercises);
  const recordedWorkoutMinutes =
    (totalGymSetWorkSeconds(exercises) + loggedRestSeconds) / 60;
  const inferredDuration =
    Number(duration) ||
    Math.max(
      completedSets > 0 ? 1 : 0,
      recordedWorkoutMinutes,
      Math.round(
        Math.max(
          completedSets * 3,
          completedSets * 0.75 + loggedRestSeconds / 60,
        ),
      ),
    );
  const typedCalories = calories.trim() ? Number(calories) : Number.NaN;
  const estimatedCalories = Number.isFinite(typedCalories)
    ? Math.max(0, typedCalories)
    : estimateGymActiveCalories(
        state.settings.energyProfile,
        inferredDuration,
        intensity,
        exercises,
        calorieCalculationMode,
      );
  const timeBreakdown = gymSessionTimeBreakdown(
    inferredDuration,
    exercises,
  );
  const averageRestSeconds = averageGymRestSeconds(exercises);
  const recaps = gymRecap(sessions, state.currentUserId, localDate);
  const timerPhaseSeconds = workoutTimer
    ? timerPhaseElapsed(workoutTimer, timerNow)
    : 0;
  const timerTotalSeconds = workoutTimer
    ? timerSessionElapsed(workoutTimer, timerNow)
    : 0;
  const muscles = muscleGroupStats(
    sessions.filter(
      (session) =>
        session.localDate >= dateWithOffsetFrom(localDate, -29) &&
        session.localDate <= localDate,
    ),
    state.currentUserId,
  );
  const timedSessionBreakdowns = sessions
    .filter((session) => totalGymSetWorkSeconds(session.exercises) > 0)
    .map((session) =>
      gymSessionTimeBreakdown(session.durationMinutes, session.exercises),
    );
  const averageTimedWorkoutSeconds = timedSessionBreakdowns.length
    ? Math.round(
        timedSessionBreakdowns.reduce(
          (sum, item) => sum + item.totalSeconds,
          0,
        ) / timedSessionBreakdowns.length,
      )
    : 0;
  const averageTimedActiveSeconds = timedSessionBreakdowns.length
    ? Math.round(
        timedSessionBreakdowns.reduce(
          (sum, item) => sum + item.exerciseSeconds,
          0,
        ) / timedSessionBreakdowns.length,
      )
    : 0;
  const recentAverageRestSeconds = averageGymRestSeconds(
    sessions
      .filter(
        (session) =>
          session.localDate >= dateWithOffsetFrom(localDate, -29) &&
          session.localDate <= localDate,
      )
      .flatMap((session) => session.exercises),
  );
  const latestExercise = useCallback(
    (key: string) =>
      sessions
        .filter((session) => session.localDate < localDate)
        .flatMap((session) => session.exercises)
        .find((exercise) => exerciseIdentity(exercise) === key),
    [localDate, sessions],
  );
  const instantiatePlan = useCallback(
    (plan: GymPlan) =>
      plan.exercises.map((exercise) => {
        const key = exerciseKey(exercise.name, exercise.exerciseKey);
        const latest = latestExercise(key);
        const latestSet = latest?.sets.filter((set) => set.completed).at(-1);
        return {
          id: uniqueId("exercise"),
          exerciseKey: key,
          name: exercise.name,
          muscleGroups: exercise.muscleGroups,
          notes: exercise.notes,
          customMet: exercise.customMet,
          trackingMode:
            exercise.trackingMode ?? catalogExercise(key)?.trackingMode,
          sets: Array.from({ length: exercise.targetSets }, (_, index) => {
            const prior = latest?.sets[index] ?? latestSet;
            return {
              ...blankSet(
                prior?.reps ?? exercise.targetReps,
                prior?.weightKg ?? exercise.startingWeightKg ?? 0,
              ),
              workSeconds:
                prior?.workSeconds ??
                (exercise.trackingMode === "duration"
                  ? Math.max(0, exercise.targetDurationMinutes ?? 0) * 60
                  : undefined),
              superset:
                exercise.supersets?.find((item) => item.setIndex === index)
                  ?.superset ?? prior?.superset,
            };
          }),
        } satisfies GymExercise;
      }),
    [latestExercise],
  );
  const loadPlan = useCallback(
    (plan: GymPlan, preferLastDay = true) => {
      setSelectedPlanId(plan.id);
      setSessionName(plan.name);
      const prior = preferLastDay
        ? sessions.find(
            (session) =>
              session.planId === plan.id && session.localDate < localDate,
          )
        : undefined;
      const next = prior
        ? cloneExercises(prior.exercises)
        : instantiatePlan(plan);
      setExercises(next);
      setOpenExerciseId(null);
    },
    [instantiatePlan, localDate, sessions],
  );

  const loadSavedSession = useCallback((session: GymSession) => {
    setWorkoutTimer(null);
    restAlerted.current = false;
    setSessionId(session.id);
    setSessionName(session.name);
    setDuration(session.durationMinutes ? String(session.durationMinutes) : "");
    const storedCaloriesAreManual =
      session.caloriesManual ?? (session.calorieCalculationMode === undefined);
    setCalories(
      storedCaloriesAreManual && session.calories
        ? String(Math.round(session.calories))
        : "",
    );
    setCalorieCalculationMode(
      session.calorieCalculationMode ?? "session_met",
    );
    setIntensity(session.intensity ?? "moderate");
    setSetStartDelaySeconds(session.setStartDelaySeconds ?? 0);
    setSessionNotes(session.notes ?? "");
    setVisibility(session.visibility);
    setSelectedPlanId(session.planId ?? null);
    setExercises(cloneExercises(session.exercises, true));
    setOpenExerciseId(null);
  }, []);

  const seedNewSession = useCallback(() => {
    setWorkoutTimer(null);
    restAlerted.current = false;
    setSessionId(uniqueId("gym"));
    setDuration("");
    setCalories("");
    setCalorieCalculationMode("session_met");
    setIntensity("moderate");
    setSetStartDelaySeconds(0);
    setSessionNotes("");
    setOpenExerciseId(null);
    setSessionDetailsOpen(false);
    const plan =
      plans.find((item) => item.id === selectedPlanId) ?? plans[0];
    if (plan) {
      setSelectedPlanId(plan.id);
      setSessionName(plan.name);
      setExercises(instantiatePlan(plan));
      return;
    }
    setSelectedPlanId(null);
    setSessionName("Workout");
    setExercises([]);
  }, [instantiatePlan, plans, selectedPlanId]);

  const startNewWorkout = useCallback(() => {
    if (workoutTimer) {
      Alert.alert(
        "Workout in progress",
        "Finish the active workout before starting another session.",
      );
      return;
    }
    initializedDate.current = localDate;
    seedNewSession();
  }, [localDate, seedNewSession, workoutTimer]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (pickerOpen || recapOpen) {
            closeExercisePicker();
            setRecapOpen(false);
            return true;
          }
          if (exerciseEditMode || performanceEditMode) {
            setExerciseEditMode(false);
            setPerformanceEditMode(false);
            return true;
          }
          return false;
        },
      );
      return () => subscription.remove();
    }, [exerciseEditMode, performanceEditMode, pickerOpen, recapOpen]),
  );

  useEffect(() => {
    if (initializedDate.current === localDate) return;
    initializedDate.current = localDate;
    const existing = sessionsForDate[0];
    if (existing) {
      loadSavedSession(existing);
      return;
    }
    seedNewSession();
  }, [loadSavedSession, localDate, seedNewSession, sessionsForDate]);

  useEffect(() => {
    if (!hydrated || workoutDraftReady) return;
    let cancelled = false;
    void AsyncStorage.getItem(workoutDraftKey(state.currentUserId))
      .then((stored) => {
        if (cancelled || !stored) return;
        const draft = JSON.parse(stored) as StoredWorkoutDraft;
        if (
          !draft.timer ||
          !Array.isArray(draft.exercises) ||
          Date.now() - draft.savedAt > 72 * 60 * 60 * 1000
        )
          return;
        initializedDate.current = draft.localDate;
        setLocalDate(draft.localDate);
        setSessionId(draft.sessionId);
        setSessionName(draft.sessionName);
        setDuration(draft.duration);
        setCalories(draft.calories);
        setCalorieCalculationMode(draft.calorieCalculationMode);
        setIntensity(draft.intensity);
        setSessionNotes(draft.sessionNotes);
        setVisibility(draft.visibility);
        setSelectedPlanId(draft.selectedPlanId);
        setSetStartDelaySeconds(draft.setStartDelaySeconds ?? 0);
        setExercises(draft.exercises);
        setTimerNow(Date.now());
        setWorkoutTimer(draft.timer);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setWorkoutDraftReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, state.currentUserId, workoutDraftReady]);

  useEffect(() => {
    if (!workoutDraftReady) return;
    const key = workoutDraftKey(state.currentUserId);
    if (!workoutTimer) {
      void AsyncStorage.removeItem(key).catch(() => undefined);
      return;
    }
    const draft: StoredWorkoutDraft = {
      savedAt: Date.now(),
      localDate,
      sessionId,
      sessionName,
      duration,
      calories,
      calorieCalculationMode,
      intensity,
      sessionNotes,
      visibility,
      selectedPlanId,
      setStartDelaySeconds,
      exercises,
      timer: workoutTimer,
    };
    void AsyncStorage.setItem(key, JSON.stringify(draft)).catch(() => undefined);
  }, [
    calorieCalculationMode,
    calories,
    duration,
    exercises,
    intensity,
    localDate,
    selectedPlanId,
    sessionId,
    sessionName,
    sessionNotes,
    setStartDelaySeconds,
    state.currentUserId,
    visibility,
    workoutDraftReady,
    workoutTimer,
  ]);

  useEffect(() => {
    // Native timestamps and the workout notification remain authoritative while
    // this tab is offscreen; only the visible one-second display ticker pauses.
    if (!isFocused || !workoutTimer || workoutTimer.phase === "paused") return;
    setTimerNow(Date.now());
    const timer = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isFocused, workoutTimer]);

  useEffect(() => {
    if (
      !workoutTimer ||
      appActivity === "active" ||
      !["set_rest", "exercise_rest"].includes(workoutTimer.phase) ||
      restAlerted.current ||
      timerPhaseSeconds <= recommendedRestSeconds(intensity) + 60 ||
      state.settings.notifications.gymRestAlerts === false
    )
      return;
    restAlerted.current = true;
    void Notifications.getPermissionsAsync()
      .then((permission) => {
        if (!permission.granted) return;
        return Notifications.scheduleNotificationAsync({
          content: {
            title: "Rest timer",
            body: `Rest is ${formatGymDuration(timerPhaseSeconds)}. Ready to continue?`,
            data: { route: "/gym" },
          },
          trigger: null,
        });
      })
      .catch(() => undefined);
  }, [
    appActivity,
    intensity,
    state.settings.notifications.gymRestAlerts,
    timerPhaseSeconds,
    workoutTimer,
  ]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const handle = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.workoutTimer !== true)
        return;
      // Android notification actions are handled by the headless task and
      // replayed once on resume; handling them here as well would skip twice.
      if (
        Platform.OS === "android" &&
        (response.actionIdentifier === WORKOUT_TIMER_NEXT ||
          response.actionIdentifier === WORKOUT_TIMER_PAUSE ||
          response.actionIdentifier === WORKOUT_TIMER_FINISH)
      )
        return;
      const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handledTimerResponse.current === responseKey) return;
      handledTimerResponse.current = responseKey;
      timerActionRef.current(response.actionIdentifier);
      void Notifications.clearLastNotificationResponseAsync();
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    return () => subscription.remove();
  }, []);

  function updateSet(exerciseId: string, setId: string, changes: Partial<GymSet>) {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.id === setId ? { ...set, ...changes } : set,
              ),
            }
          : exercise,
      ),
    );
  }

  function scrollToWorkoutTarget(exerciseId: string, setId?: string) {
    setOpenExerciseId(exerciseId);
    const targetKey = setId ? `set:${setId}` : `exercise:${exerciseId}`;
    setTimeout(() => {
      const y = targetOffsets.current[targetKey];
      if (y !== undefined)
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 18), animated: true });
    }, 90);
  }

  function firstPendingTarget(
    source: GymExercise[],
    startExerciseIndex = 0,
  ) {
    for (let index = startExerciseIndex; index < source.length; index += 1) {
      const exercise = source[index];
      const set = exercise.sets.find((item) => !item.completed);
      if (set) return { exercise, set, exerciseIndex: index };
    }
    return null;
  }

  function startGuidedWorkout() {
    const target = firstPendingTarget(exercises);
    if (!target) {
      Alert.alert(
        "Workout already complete",
        "Add a set or load a fresh workout template to start another timed session.",
      );
      return;
    }
    const now = Date.now();
    setDuration("");
    setTimerNow(now);
    setWorkoutTimer({
      phase: "work",
      startedAt: now,
      phaseStartedAt: now,
      phaseElapsedSeconds: 0,
      completedElapsedSeconds: 0,
      pausedSeconds: 0,
      exerciseId: target.exercise.id,
      setId: target.set.id,
    });
    scrollToWorkoutTarget(target.exercise.id, target.set.id);
  }

  function pauseOrResumeWorkout(occurredAt = Date.now()) {
    if (!workoutTimer) return;
    const now = occurredAt;
    setTimerNow(now);
    if (workoutTimer.phase === "paused") {
      setWorkoutTimer({
        ...workoutTimer,
        phase: workoutTimer.resumePhase ?? "work",
        resumePhase: undefined,
        phaseStartedAt: now,
        pausedSeconds:
          workoutTimer.pausedSeconds +
          Math.max(
            0,
            Math.floor((now - (workoutTimer.pauseStartedAt ?? now)) / 1000),
          ),
        pauseStartedAt: undefined,
      });
      return;
    }
    setWorkoutTimer({
      ...workoutTimer,
      phase: "paused",
      resumePhase: workoutTimer.phase,
      phaseElapsedSeconds: timerPhaseElapsed(workoutTimer, now),
      phaseStartedAt: now,
      pauseStartedAt: now,
    });
  }

  function toggleSet(exerciseId: string, set: GymSet) {
    if (workoutTimer) {
      if (
        workoutTimer.phase === "work" &&
        workoutTimer.exerciseId === exerciseId &&
        workoutTimer.setId === set.id
      )
        advanceWorkoutTimer();
      return;
    }
    updateSet(exerciseId, set.id, { completed: !set.completed });
  }

  function finishExercise(exercise: GymExercise) {
    if (workoutTimer) return;
    patchExercise(exercise.id, { completed: true });
    setOpenExerciseId(null);
  }

  function patchExercise(exerciseId: string, changes: Partial<GymExercise>) {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, ...changes } : exercise,
      ),
    );
  }

  function addSet(exerciseId: string) {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        const previous = exercise.sets.at(-1);
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            blankSet(previous?.reps ?? 10, previous?.weightKg ?? 0),
          ],
        };
      }),
    );
  }

  function removeExerciseSafely(exercise: GymExercise) {
    if (workoutTimer?.exerciseId === exercise.id) {
      Alert.alert(
        "Current exercise is active",
        "Use Next or finish the workout before removing this exercise. Other exercises can still be edited while the timer runs.",
      );
      return;
    }
    setExercises((current) =>
      current.filter((item) => item.id !== exercise.id),
    );
  }

  function removeSetSafely(exercise: GymExercise, set: GymSet) {
    if (
      workoutTimer?.exerciseId === exercise.id &&
      workoutTimer.setId === set.id
    ) {
      Alert.alert(
        "Current set is active",
        "Use Next before removing this set. We keep its timer target stable while it is running.",
      );
      return;
    }
    patchExercise(exercise.id, {
      sets: exercise.sets.filter((item) => item.id !== set.id),
    });
  }

  function addCatalogExercise(item: ExerciseCatalogItem) {
    if (supersetTarget) {
      if (item.trackingMode === "duration") {
        Alert.alert(
          "Choose a set-based exercise",
          "Duration activities are logged as their own workout exercise and cannot be used as a superset.",
        );
        return;
      }
      updateSet(supersetTarget.exerciseId, supersetTarget.setId, {
        superset: {
          exerciseKey: item.key,
          name: item.name,
          muscleGroups: item.muscles,
          reps: 10,
          weightKg: 0,
          customMet: item.met,
          trackingMode: item.trackingMode,
        },
      });
      setSupersetTarget(null);
      setPickerOpen(false);
      setPickerSearch("");
      return;
    }
    const exercise = fromCatalog(item, latestExercise(item.key));
    setExercises((current) => [...current, exercise]);
    setOpenExerciseId(exercise.id);
    setPickerOpen(false);
    setPickerSearch("");
  }

  function openSupersetPicker(exerciseId: string, setId: string) {
    setSupersetTarget({ exerciseId, setId });
    setPickerOpen(true);
    setPickerSearch("");
  }

  function closeExercisePicker() {
    setPickerOpen(false);
    setSupersetTarget(null);
    setPickerSearch("");
  }

  function addCustomExercise() {
    const name = customExerciseName.trim();
    if (!name) return;
    const item: ExerciseCatalogItem = {
      key: exerciseKey(name),
      name,
      muscles: [pickerMuscle === "all" ? "full_body" : pickerMuscle],
      equipment: "other",
      category: "strength",
      trackingMode: "load_reps",
      aliases: [],
      met: 3.5,
    };
    setCustomExerciseName("");
    addCatalogExercise(item);
  }

  function recordTimerPhase(
    source: GymExercise[],
    timer: WorkoutTimer,
    elapsedSeconds: number,
  ) {
    return source.map((exercise) => {
      if (exercise.id !== timer.exerciseId) return exercise;
      if (timer.phase === "exercise_rest")
        return {
          ...exercise,
          restAfterSeconds:
            Math.max(0, exercise.restAfterSeconds ?? 0) + elapsedSeconds,
          restTargetSeconds: Math.max(
            120,
            recommendedRestSeconds(intensity),
          ),
        };
      return {
        ...exercise,
        sets: exercise.sets.map((set) => {
          if (set.id !== timer.setId) return set;
          if (timer.phase === "set_rest")
            return {
              ...set,
              restSeconds:
                Math.max(0, set.restSeconds ?? 0) + elapsedSeconds,
              restTargetSeconds: recommendedRestSeconds(intensity),
            };
          return {
            ...set,
            completed: true,
            workSeconds:
              Math.max(0, set.workSeconds ?? 0) +
              Math.max(0, elapsedSeconds - setStartDelaySeconds),
            superset: set.superset
              ? {
                  ...set.superset,
                  workSeconds:
                    Math.max(0, set.superset.workSeconds ?? 0) +
                    Math.max(
                      0,
                      Math.round(
                        (elapsedSeconds - setStartDelaySeconds) / 2,
                      ),
                    ),
                }
              : undefined,
          };
        }),
      };
    });
  }

  function changeCalorieCalculationMode(
    nextMode: GymCalorieCalculationMode,
  ) {
    if (nextMode === calorieCalculationMode) return;
    setCalorieCalculationMode(nextMode);
    // Choosing an estimate method intentionally replaces any typed override.
    setCalories("");
    if (!selectedSession || !completedGymSets(selectedSession.exercises))
      return;
    const recalculatedCalories = estimateGymActiveCalories(
      state.settings.energyProfile,
      selectedSession.durationMinutes,
      selectedSession.intensity ?? "moderate",
      selectedSession.exercises,
      nextMode,
    );
    saveGymSession({
      ...selectedSession,
      calories: recalculatedCalories,
      calorieCalculationMode: nextMode,
      caloriesManual: false,
    });
  }

  function persistSession(
    sessionExercises: GymExercise[],
    sessionDuration: number,
    timing?: {
      startedAt: string;
      completedAt: string;
      pausedSeconds: number;
    },
  ) {
    const sessionCompletedSets = completedGymSets(sessionExercises);
    const sessionVolume = trainingVolumeKg(sessionExercises);
    const nowRecordedAt = new Date().toISOString();
    const recordedAt =
      selectedSession?.recordedAt ??
      (localDate === dateKey()
        ? nowRecordedAt
        : `${localDate}T${nowRecordedAt.slice(11)}`);
    const preciseDuration = Math.max(
      sessionCompletedSets > 0 ? 0.1 : 0,
      Math.round(sessionDuration * 100) / 100,
    );
    const parsedManualCalories = Number(calories);
    const manualCalories =
      calories.trim() && Number.isFinite(parsedManualCalories)
        ? Math.max(0, parsedManualCalories)
        : undefined;
    const sessionCalories =
      manualCalories ??
      estimateGymActiveCalories(
        state.settings.energyProfile,
        preciseDuration,
        intensity,
        sessionExercises,
        calorieCalculationMode,
      );
    const sessionTime = gymSessionTimeBreakdown(
      preciseDuration,
      sessionExercises,
    );
    const completedAt = sessionCompletedSets
      ? timing?.completedAt ?? selectedSession?.completedAt ?? recordedAt
      : selectedSession?.completedAt;
    const completedAtMs = completedAt
      ? new Date(completedAt).getTime()
      : Number.NaN;
    const startedAt = sessionCompletedSets
      ? timing?.startedAt ??
        selectedSession?.startedAt ??
        (Number.isFinite(completedAtMs)
          ? new Date(completedAtMs - preciseDuration * 60_000).toISOString()
          : undefined)
      : selectedSession?.startedAt;
    saveGymSession({
      id: selectedSession?.id ?? sessionId,
      userId: state.currentUserId,
      planId: selectedPlanId ?? undefined,
      name: sessionName.trim() || "Workout",
      localDate,
      recordedAt,
      startedAt,
      completedAt,
      pausedSeconds: timing?.pausedSeconds ?? selectedSession?.pausedSeconds,
      setStartDelaySeconds,
      durationMinutes: preciseDuration,
      calories: sessionCompletedSets ? sessionCalories : undefined,
      calorieCalculationMode,
      caloriesManual: manualCalories !== undefined,
      intensity,
      notes: sessionNotes.trim() || undefined,
      exercises: sessionExercises,
      visibility,
    });
    setExercises(sessionExercises);
    setDuration(
      preciseDuration ? String(Math.round(preciseDuration * 10) / 10) : "",
    );
    setWorkoutTimer(null);
    restAlerted.current = false;
    Alert.alert(
      sessionCompletedSets ? "Workout saved" : "Day planned",
      sessionCompletedSets
        ? `${sessionCompletedSets} sets · ${Math.round(sessionVolume).toLocaleString(locale)} kg volume · ${formatGymDuration(sessionTime.exerciseSeconds)} exercise · ${formatGymDuration(sessionTime.setRestSeconds)} set rest · ${formatGymDuration(sessionTime.exerciseRestSeconds)} between exercises · ~${sessionCalories} active kcal`
        : "The exercise plan is saved without marking the workout complete.",
    );
  }

  function advanceWorkoutTimer(occurredAt = Date.now()) {
    if (!workoutTimer) return;
    if (workoutTimer.phase === "paused") {
      pauseOrResumeWorkout();
      return;
    }
    // Android may deliver an action after waking JS; use tap time so a late
    // resume cannot inflate the preceding work/rest phase.
    const now = Math.max(workoutTimer.phaseStartedAt, occurredAt);
    const phaseSeconds = Math.max(
      1,
      timerPhaseElapsed(workoutTimer, now),
    );
    let nextExercises = recordTimerPhase(
      exercises,
      workoutTimer,
      phaseSeconds,
    );
    const completedElapsedSeconds =
      workoutTimer.completedElapsedSeconds + phaseSeconds;
    const currentExerciseIndex = nextExercises.findIndex(
      (exercise) => exercise.id === workoutTimer.exerciseId,
    );
    const currentExercise = nextExercises[currentExerciseIndex];

    if (workoutTimer.phase === "work") {
      const currentSetIndex =
        currentExercise?.sets.findIndex(
          (set) => set.id === workoutTimer.setId,
        ) ?? -1;
      const nextSet = currentExercise?.sets
        .slice(currentSetIndex + 1)
        .find((set) => !set.completed);
      if (nextSet) {
        setExercises(nextExercises);
        setTimerNow(now);
        restAlerted.current = false;
        setWorkoutTimer({
          ...workoutTimer,
          phase: "set_rest",
          phaseStartedAt: now,
          phaseElapsedSeconds: 0,
          completedElapsedSeconds,
        });
        return;
      }

      nextExercises = nextExercises.map((exercise) =>
        exercise.id === workoutTimer.exerciseId
          ? { ...exercise, completed: true }
          : exercise,
      );
      const nextExercise = firstPendingTarget(
        nextExercises,
        currentExerciseIndex + 1,
      );
      if (nextExercise) {
        setExercises(nextExercises);
        setTimerNow(now);
        restAlerted.current = false;
        setWorkoutTimer({
          ...workoutTimer,
          phase: "exercise_rest",
          setId: undefined,
          phaseStartedAt: now,
          phaseElapsedSeconds: 0,
          completedElapsedSeconds,
        });
        return;
      }

      persistSession(nextExercises, completedElapsedSeconds / 60, {
        startedAt: new Date(workoutTimer.startedAt).toISOString(),
        completedAt: new Date(now).toISOString(),
        pausedSeconds: workoutTimer.pausedSeconds,
      });
      return;
    }

    const nextTarget =
      workoutTimer.phase === "set_rest"
        ? firstPendingTarget(nextExercises, currentExerciseIndex)
        : firstPendingTarget(nextExercises, currentExerciseIndex + 1);
    if (!nextTarget) {
      persistSession(nextExercises, completedElapsedSeconds / 60, {
        startedAt: new Date(workoutTimer.startedAt).toISOString(),
        completedAt: new Date(now).toISOString(),
        pausedSeconds: workoutTimer.pausedSeconds,
      });
      return;
    }
    setExercises(nextExercises);
    setTimerNow(now);
    restAlerted.current = false;
    setWorkoutTimer({
      ...workoutTimer,
      phase: "work",
      exerciseId: nextTarget.exercise.id,
      setId: nextTarget.set.id,
      phaseStartedAt: now,
      phaseElapsedSeconds: 0,
      completedElapsedSeconds,
    });
    scrollToWorkoutTarget(nextTarget.exercise.id, nextTarget.set.id);
  }

  function saveDay() {
    if (!exercises.length) {
      Alert.alert("Add an exercise", "Choose at least one exercise for this day.");
      return;
    }
    if (workoutTimer) {
      Alert.alert(
        "Workout timer is running",
        "Use the fixed Next button to finish the guided workout, or pause it before returning later.",
      );
      return;
    }
    const sessionDuration =
      Number(duration) ||
      Math.max(
        completedSets > 0 ? 1 : 0,
        (totalGymSetWorkSeconds(exercises) +
          totalGymRestSeconds(exercises)) /
          60,
        Math.round(
          Math.max(
            completedSets * 3,
            completedSets * 0.75 + totalGymRestSeconds(exercises) / 60,
          ),
        ),
      );
    persistSession(exercises, sessionDuration);
  }

  function savePlan(asNew: boolean) {
    if (!exercises.length) return;
    const existing = !asNew
      ? personalPlans.find((plan) => plan.id === selectedPlanId)
      : undefined;
    const now = new Date().toISOString();
    const plan: GymPlan = {
      id: existing?.id ?? uniqueId("plan"),
      userId: state.currentUserId,
      name: sessionName.trim() || "My workout",
      exercises: exercises.map((exercise) => ({
        id: uniqueId("plan-exercise"),
        exerciseKey: exerciseIdentity(exercise),
        name: exercise.name,
        muscleGroups: exercise.muscleGroups,
        targetSets: exercise.sets.length,
        targetReps: exercise.sets[0]?.reps ?? 10,
        startingWeightKg: exercise.sets[0]?.weightKg || undefined,
        targetDurationMinutes:
          exercise.trackingMode === "duration"
            ? Math.round(((exercise.sets[0]?.workSeconds ?? 0) / 60) * 10) / 10
            : undefined,
        notes: exercise.notes,
        customMet: exercise.customMet,
        trackingMode: exercise.trackingMode,
        supersets: exercise.sets.flatMap((set, setIndex) =>
          set.superset
            ? [
                {
                  setIndex,
                  superset: { ...set.superset, workSeconds: undefined },
                },
              ]
            : [],
        ),
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveGymPlan(plan);
    setSelectedPlanId(plan.id);
    Alert.alert(
      existing ? "Template updated" : "Workout template saved",
      `${plan.name} will seed new days without changing historical workouts.`,
    );
  }

  function chooseDate(nextDate: string) {
    if (workoutTimer) {
      Alert.alert(
        "Workout in progress",
        "Finish or pause and save this workout before changing days.",
      );
      return;
    }
    setLocalDate(nextDate);
    setCalendarOpen(false);
  }

  function chooseWorkoutSession(session: GymSession) {
    if (workoutTimer) {
      Alert.alert(
        "Workout in progress",
        "Finish the active workout before opening another session.",
      );
      return;
    }
    initializedDate.current = localDate;
    loadSavedSession(session);
  }

  function confirmDeleteWorkout(session: GymSession) {
    Alert.alert("Delete workout?", session.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteGymSession(session.id);
          if (session.id === sessionId) startNewWorkout();
        },
      },
    ]);
  }

  function finishTimedWorkout(occurredAt = Date.now()) {
    if (!workoutTimer) return;
    // Notification/watch actions can be replayed after Android wakes JS. The
    // action timestamp, rather than resume time, keeps work and rest accurate.
    const now = Math.max(workoutTimer.phaseStartedAt, occurredAt);
    const phaseSeconds =
      workoutTimer.phase === "paused"
        ? 0
        : Math.max(1, timerPhaseElapsed(workoutTimer, now));
    const nextExercises =
      phaseSeconds > 0
        ? recordTimerPhase(exercises, workoutTimer, phaseSeconds)
        : exercises;
    persistSession(
      nextExercises,
      (workoutTimer.completedElapsedSeconds + phaseSeconds) / 60,
      {
        startedAt: new Date(workoutTimer.startedAt).toISOString(),
        completedAt: new Date(now).toISOString(),
        pausedSeconds:
          workoutTimer.pausedSeconds +
          (workoutTimer.phase === "paused"
            ? Math.max(
                0,
                Math.floor(
                  (now - (workoutTimer.pauseStartedAt ?? now)) / 1000,
                ),
              )
            : 0),
      },
    );
  }

  function publishGroupPlan() {
    if (!canManageGroup || !exercises.length) return;
    const selectedShared = sharedPlans.find(
      (plan) => plan.id === selectedPlanId,
    );
    const now = new Date().toISOString();
    saveGroupGymPlan({
      id: selectedShared?.id ?? uniqueId("group-plan"),
      userId: `group:${state.group.id}`,
      name: sessionName.trim() || "Group workout",
      exercises: exercises.map((exercise) => ({
        id: uniqueId("plan-exercise"),
        exerciseKey: exerciseIdentity(exercise),
        name: exercise.name,
        muscleGroups: exercise.muscleGroups,
        targetSets: exercise.sets.length,
        targetReps: exercise.sets[0]?.reps ?? 10,
        startingWeightKg: exercise.sets[0]?.weightKg || undefined,
        targetDurationMinutes:
          exercise.trackingMode === "duration"
            ? Math.round(((exercise.sets[0]?.workSeconds ?? 0) / 60) * 10) / 10
            : undefined,
        notes: exercise.notes,
        customMet: exercise.customMet,
        trackingMode: exercise.trackingMode,
        supersets: exercise.sets.flatMap((set, setIndex) =>
          set.superset
            ? [
                {
                  setIndex,
                  superset: { ...set.superset, workSeconds: undefined },
                },
              ]
            : [],
        ),
      })),
      createdAt: selectedShared?.createdAt ?? now,
      updatedAt: now,
    });
    Alert.alert(
      selectedShared ? "Group workout updated" : "Shared with the group",
      "This standardized workout now appears in every active member's Workout templates. Raw completed sets and notes are still shared only through mapped group trackers.",
    );
  }

  const trackerExerciseKeys = new Set(
    trackerExerciseItems.map((item) => item.key),
  );
  const groupExerciseKeys = new Set(
    trackerExerciseItems
      .filter((item) => item.groupExercise)
      .map((item) => item.key),
  );
  const pickerItems = [
    ...trackerExerciseItems,
    ...EXERCISE_CATALOG.filter(
      (item) =>
        item.key !== "custom" && !trackerExerciseKeys.has(item.key),
    ),
  ].filter((item) => {
    const query = pickerSearch.trim().toLowerCase();
    return (
      (!supersetTarget || item.trackingMode !== "duration") &&
      (query || pickerCategory === "all" || item.category === pickerCategory) &&
      (pickerMuscle === "all" || item.muscles.includes(pickerMuscle)) &&
      (!query ||
        item.name.toLowerCase().includes(query) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
        EXERCISE_CATEGORY_LABELS[item.category].toLowerCase().includes(query) ||
        localizeExerciseName(language, item).toLowerCase().includes(query) ||
        item.muscles.some((muscle) =>
          localizeMuscleLabel(language, muscle).toLowerCase().includes(query),
        ))
    );
  });
  const timerExercise = workoutTimer
    ? exercises.find((exercise) => exercise.id === workoutTimer.exerciseId)
    : undefined;
  const timerExerciseIndex = timerExercise
    ? exercises.findIndex((exercise) => exercise.id === timerExercise.id)
    : -1;
  const timerSetIndex =
    timerExercise && workoutTimer?.setId
      ? timerExercise.sets.findIndex((set) => set.id === workoutTimer.setId)
      : -1;
  const timerNextTarget = workoutTimer
    ? workoutTimer.phase === "set_rest"
      ? firstPendingTarget(exercises, timerExerciseIndex)
      : workoutTimer.phase === "exercise_rest"
        ? firstPendingTarget(exercises, timerExerciseIndex + 1)
        : null
    : null;
  const timerColor =
    workoutTimer?.phase === "paused"
      ? palette.red
      : workoutTimer?.phase === "work"
        ? palette.lime
        : palette.amber;
  const timerHeading =
    workoutTimer?.phase === "paused"
      ? "Workout paused"
      : workoutTimer?.phase === "work"
        ? `${timerExercise ? localizeExerciseName(language, timerExercise) : "Exercise"} · Set ${timerSetIndex + 1}/${timerExercise?.sets.length ?? 0}`
        : workoutTimer?.phase === "set_rest"
          ? `Set rest · next is set ${timerNextTarget ? timerNextTarget.exercise.sets.findIndex((set) => set.id === timerNextTarget.set.id) + 1 : ""}`
          : `Between exercises · next is ${timerNextTarget ? localizeExerciseName(language, timerNextTarget.exercise) : "finish"}`;
  const timerNextLabel =
    workoutTimer?.phase === "paused"
      ? "Resume"
      : workoutTimer?.phase === "set_rest"
        ? "Start next set"
        : workoutTimer?.phase === "exercise_rest"
          ? "Start exercise"
          : timerExercise?.sets
                .slice(timerSetIndex + 1)
                .some((set) => !set.completed)
            ? "Finish set"
            : firstPendingTarget(exercises, timerExerciseIndex + 1)
              ? "Finish exercise"
              : "Finish workout";
  const notificationSteps = useMemo(
    () =>
      workoutTimer ? workoutNotificationSteps(exercises, workoutTimer, language, t) : [],
    [exercises, language, t, workoutTimer],
  );
  timerActionRef.current = (action, occurredAt) => {
    if (action === WORKOUT_TIMER_PAUSE)
      pauseOrResumeWorkout(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_NEXT)
      advanceWorkoutTimer(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_FINISH)
      finishTimedWorkout(occurredAt ?? Date.now());
  };
  notificationPayloadRef.current = workoutTimer
    ? {
        title: t(timerHeading),
        body: t(`${formatGymDuration(timerPhaseSeconds)} elapsed · ${timerNextLabel}`),
        phase:
          workoutTimer.phase === "work"
            ? "work"
            : workoutTimer.phase === "paused"
              ? "paused"
              : "rest",
        steps: notificationSteps,
        phaseStartedAt: workoutTimer.phaseStartedAt,
        phaseElapsedSeconds: workoutTimer.phaseElapsedSeconds,
      }
    : null;

  useEffect(() => {
    const handleActivity = (next: typeof appActivity) => {
      setAppActivity(next);
      if (next === "active") {
        void dismissWorkoutTimerNotification();
        return;
      }
      const payload = notificationPayloadRef.current;
      if (payload)
        void showWorkoutTimerNotification(payload).catch(() => undefined);
    };
    const subscription = NativeAppState.addEventListener(
      "change",
      handleActivity,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (
      !workoutDraftReady ||
      !workoutTimer ||
      appActivity !== "active"
    )
      return;
    void consumeWorkoutTimerActions().then((actions) => {
      actions.forEach((item, index) => {
        setTimeout(
          () => timerActionRef.current(item.action, item.occurredAt),
          index * 180,
        );
      });
    });
  }, [appActivity, workoutDraftReady, workoutTimer]);

  useEffect(() => {
    if (!workoutTimer) {
      void dismissWorkoutTimerNotification(true);
      return;
    }
    if (appActivity === "active") {
      void dismissWorkoutTimerNotification();
      return;
    }
    void showWorkoutTimerNotification({
      title: t(timerHeading),
      body: t(`${timerNextLabel} · open HabHub to adjust kg or reps`),
      phase:
        workoutTimer.phase === "work"
          ? "work"
          : workoutTimer.phase === "paused"
            ? "paused"
            : "rest",
      steps: notificationSteps,
      phaseStartedAt: workoutTimer.phaseStartedAt,
      phaseElapsedSeconds: workoutTimer.phaseElapsedSeconds,
    }).catch(() => undefined);
  }, [
    appActivity,
    notificationSteps,
    t,
    timerHeading,
    timerNextLabel,
    workoutTimer?.exerciseId,
    workoutTimer?.phase,
    workoutTimer?.setId,
    workoutTimer,
  ]);
  const workoutTimerBar = workoutTimer ? (
    <View
      style={[
        styles.workoutTimer,
        {
          borderColor: timerColor,
          backgroundColor: `${timerColor}24`,
        },
      ]}
    >
      <View style={[styles.timerPulse, { backgroundColor: timerColor }]} />
      <View style={styles.timerCopy}>
        <Text style={[styles.timerHeading, { color: colors.ink }]}>
          {timerHeading}
        </Text>
        <Text style={[styles.timerMeta, { color: colors.muted }]}>
          {formatGymDuration(timerPhaseSeconds)} now ·{" "}
          {formatGymDuration(timerTotalSeconds)} workout
        </Text>
      </View>
      <Pressable
        accessibilityLabel={
          workoutTimer.phase === "paused" ? "Resume workout" : "Pause workout"
        }
        onPress={() => pauseOrResumeWorkout()}
        style={[styles.timerControl, { borderColor: timerColor }]}
      >
        <Ionicons
          name={workoutTimer.phase === "paused" ? "play" : "pause"}
          size={17}
          color={timerColor}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="Finish workout now"
        onPress={() =>
          Alert.alert(
            "Finish workout now?",
            "Completed sets and timing so far will be saved.",
            [
              { text: "Keep training", style: "cancel" },
              {
                text: "Finish workout",
                style: "destructive",
                onPress: () => finishTimedWorkout(),
              },
            ],
          )
        }
        style={[styles.timerControl, { borderColor: palette.red }]}
      >
        <Ionicons name="stop" size={16} color={palette.red} />
      </Pressable>
      <Pressable
        onPress={() => advanceWorkoutTimer()}
        style={[styles.timerNext, { backgroundColor: timerColor }]}
      >
        <Text style={styles.timerNextText}>{timerNextLabel}</Text>
        <Ionicons name="chevron-forward" size={15} color={palette.ink} />
      </Pressable>
    </View>
  ) : undefined;

  return (
    <>
      <GestureDetector gesture={pageSwipe}>
      <View style={styles.pageGesture}>
      <Screen
        scrollRef={scrollRef}
        fixedTop={workoutTimerBar}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshEnabled={!exerciseEditMode}
      >
        <PageHeader
          title="Workout"
          tutorialId="gym-header"
          action={
            <View
              accessibilityRole="tablist"
              style={[
                styles.modeSegment,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {(["workout", "progress", "performance"] as const).map((item) => {
                const selected = mode === item;
                const label =
                  item === "workout"
                    ? "Workout"
                    : item === "progress"
                      ? "Progress"
                      : "Performance";
                return (
                  <Pressable
                    key={item}
                    accessibilityLabel={t(label)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => selectMode(item)}
                    style={({ pressed }) => [
                      styles.modeChoice,
                      selected && { backgroundColor: accent },
                      pressed && styles.modeChoicePressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeChoiceText,
                        {
                          color: selected
                            ? readableTextColor(accent)
                            : colors.muted,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          }
        />

        {mode === "workout" ? (
          <>
            <Card style={styles.dayCard}>
              <View style={styles.dateRow}>
                <Pressable
                  onPress={() =>
                    chooseDate(dateWithOffsetFrom(localDate, -1))
                  }
                >
                  <Ionicons name="chevron-back" size={25} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={() => setCalendarOpen((value) => !value)}
                  style={styles.center}
                >
                  <View style={styles.dateLabel}>
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={accent}
                    />
                    <Text style={[styles.date, { color: colors.ink }]}>
                      {friendlyDate(localDate)}
                    </Text>
                    <Ionicons
                      name={calendarOpen ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.muted}
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {selectedSession
                      ? `${sessionsForDate.length} saved workout${sessionsForDate.length === 1 ? "" : "s"} · editing this session`
                      : sessionsForDate.length
                        ? `New workout · ${sessionsForDate.length} already saved today`
                        : "New workout · seeded from your active template"}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={localDate >= dateKey()}
                  onPress={() =>
                    chooseDate(dateWithOffsetFrom(localDate, 1))
                  }
                >
                  <Ionicons
                    name="chevron-forward"
                    size={25}
                    color={localDate >= dateKey() ? colors.faint : colors.ink}
                  />
                </Pressable>
              </View>
              {calendarOpen ? (
                <View
                  style={[
                    styles.calendar,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <MonthCalendar
                    selectedDate={localDate}
                    monthDate={localDate}
                    onSelect={chooseDate}
                    hasActivity={(day) => gymDays.has(day)}
                    dayStatus={(day) =>
                      completedGymDays.has(day)
                        ? "met"
                        : gymDays.has(day)
                          ? "partial"
                          : "none"
                    }
                  />
                  <View style={styles.calendarLegend}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: palette.lime },
                      ]}
                    />
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      Completed workout
                    </Text>
                  </View>
                </View>
              ) : null}
              {sessionsForDate.length ? (
                <View
                  style={[
                    styles.sessionPicker,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.sessionPickerHeader}>
                    <View style={styles.grow}>
                      <Text style={[styles.label, { color: colors.muted }]}>Workouts this day</Text>
                      <Text style={[styles.sessionChoiceMeta, { color: colors.muted }]}>
                        {`${Math.round(savedDayTotals.durationMinutes * 10) / 10} min · ~${Math.round(savedDayTotals.calories)} active kcal total`}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel="Start another workout"
                      onPress={startNewWorkout}
                      style={[
                        styles.newSessionButton,
                        {
                          borderColor: selectedSession ? colors.border : accent,
                          backgroundColor: selectedSession
                            ? colors.card
                            : `${accent}1A`,
                        },
                      ]}
                    >
                      <Ionicons name="add" size={14} color={accent} />
                      <Text style={[styles.newSessionText, { color: accent }]}>New workout</Text>
                    </Pressable>
                  </View>
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.sessionChoices}
                  >
                    {sessionsForDate.map((session, index) => {
                      const selected = session.id === selectedSession?.id;
                      const clock = gymSessionClockBounds(session);
                      const time = clock.completedAt
                        ? formatClockTime(
                            clock.completedAt,
                            state.settings.timeFormat,
                            locale,
                          )
                        : `#${sessionsForDate.length - index}`;
                      return (
                        <Pressable
                          key={session.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => chooseWorkoutSession(session)}
                          onLongPress={() => confirmDeleteWorkout(session)}
                          style={[
                            styles.sessionChoice,
                            {
                              borderColor: selected ? accent : colors.border,
                              backgroundColor: selected
                                ? `${accent}18`
                                : colors.card,
                            },
                          ]}
                        >
                          <Text
                            translate={false}
                            numberOfLines={1}
                            style={[
                              styles.sessionChoiceName,
                              { color: colors.ink },
                            ]}
                          >
                            {session.name}
                          </Text>
                          <Text
                            style={[
                              styles.sessionChoiceMeta,
                              { color: colors.muted },
                            ]}
                          >
                            {time} · {completedGymSets(session.exercises)} sets
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <Pressable
                onPress={() => setSessionDetailsOpen((value) => !value)}
                style={[styles.detailsToggle, { borderColor: colors.border }]}
              >
                <View style={styles.grow}>
                  <Text style={[styles.exerciseName, { color: colors.ink }]}>
                    {sessionName || "Workout"}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {completedSets} sets · {inferredDuration} min · ~{estimatedCalories} active kcal
                  </Text>
                </View>
                <Ionicons
                  name={sessionDetailsOpen ? "chevron-up" : "options-outline"}
                  size={18}
                  color={accent}
                />
              </Pressable>
              {sessionDetailsOpen ? (
                <>
              {plans.length ? (
                <View
                  style={[
                    styles.templateMenu,
                    { borderColor: colors.border },
                  ]}
                >
                  <Pressable
                    onPress={() => setTemplatesOpen((value) => !value)}
                    style={styles.templateToggle}
                  >
                    <View style={styles.grow}>
                      <Text
                        style={[styles.exerciseName, { color: colors.ink }]}
                      >
                        Workout templates
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {plans.find((plan) => plan.id === selectedPlanId)?.name ??
                          `${plans.length} reusable workout${plans.length === 1 ? "" : "s"}`}
                      </Text>
                    </View>
                    <Ionicons
                      name={templatesOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.muted}
                    />
                  </Pressable>
                  {templatesOpen ? (
                    <View
                      style={[
                        styles.planRow,
                        { borderTopColor: colors.border },
                      ]}
                    >
                    {plans.map((plan) => (
                      <Pressable
                        key={plan.id}
                        onPress={() => {
                          loadPlan(plan);
                          setTemplatesOpen(false);
                        }}
                        style={styles.templateChoice}
                        onLongPress={() =>
                          plan.userId === `group:${state.group.id}` &&
                          !canManageGroup
                            ? undefined
                            : Alert.alert("Delete template?", plan.name, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () =>
                                plan.userId === `group:${state.group.id}`
                                  ? deleteGroupGymPlan(plan.id)
                                  : deleteGymPlan(plan.id),
                            },
                          ])
                        }
                      >
                        <Chip
                          label={`${plan.userId === `group:${state.group.id}` ? "Group · " : ""}${plan.name}`}
                          selected={selectedPlanId === plan.id}
                          translate={false}
                        />
                      </Pressable>
                    ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <TextInput
                value={sessionName}
                onChangeText={setSessionName}
                placeholder="Workout name, e.g. Push 1"
                placeholderTextColor={colors.faint}
                style={[styles.nameInput, { color: colors.ink, borderColor: colors.border }]}
              />
              <View style={styles.compactRow}>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.muted }]}>Minutes</Text>
                  <TextInput
                    value={duration}
                    onChangeText={setDuration}
                    keyboardType="number-pad"
                    placeholder={completedSets ? String(completedSets * 3) : "0"}
                    placeholderTextColor={colors.faint}
                    style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.muted }]}>Active kcal</Text>
                  <TextInput
                    value={calories}
                    onChangeText={setCalories}
                    keyboardType="number-pad"
                    placeholder={String(estimatedCalories)}
                    placeholderTextColor={colors.faint}
                    style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
                  />
                </View>
                <View style={styles.fieldWide}>
                  <Text style={[styles.label, { color: colors.muted }]}>Effort</Text>
                  <View style={styles.intensityRow}>
                    {intensities.map((item) => (
                      <Pressable
                        key={item}
                        onPress={() => setIntensity(item)}
                        style={[
                          styles.intensity,
                          {
                            borderColor: intensity === item ? accent : colors.border,
                            backgroundColor: intensity === item ? colors.primarySoft : "transparent",
                          },
                        ]}
                      >
                        <Text style={[styles.intensityText, { color: intensity === item ? accent : colors.muted }]}>
                          {item[0].toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <View
                style={[
                  styles.calorieMethod,
                  { borderColor: colors.border },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: calorieEstimateOpen }}
                  onPress={() => setCalorieEstimateOpen((open) => !open)}
                  style={styles.calorieMethodHeader}
                >
                  <View style={styles.grow}>
                    <Text style={[styles.label, { color: colors.ink }]}>Calorie estimate</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {calorieCalculationMode === "set_aware" ? "Set-aware" : "Session MET"}
                    </Text>
                  </View>
                  <Ionicons
                    name={calorieEstimateOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </Pressable>
                {calorieEstimateOpen ? (
                  <View style={styles.calorieMethodBody}>
                  <View style={styles.calorieMethodChoices}>
                    <Chip
                      label="Session MET"
                      size="small"
                      selected={calorieCalculationMode === "session_met"}
                      onPress={() =>
                        changeCalorieCalculationMode("session_met")
                      }
                    />
                    <Chip
                      label="Set-aware"
                      size="small"
                      selected={calorieCalculationMode === "set_aware"}
                      onPress={() =>
                        changeCalorieCalculationMode("set_aware")
                      }
                    />
                  </View>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                  {calorieCalculationMode === "set_aware"
                    ? "Uses body weight, exercise METs and active set time. Load and reps only make a small bounded adjustment."
                    : "Uses the workout duration and Compendium MET for the selected effort."}
                  {calories.trim()
                    ? " Your typed active-kcal value overrides this estimate."
                    : " Estimate only; wearable measurements may differ."}
                  </Text>
                  </View>
                ) : null}
              </View>
              <TextInput
                value={sessionNotes}
                onChangeText={setSessionNotes}
                placeholder="Workout notes (optional)"
                placeholderTextColor={colors.faint}
                multiline
                style={[styles.notes, { color: colors.ink, borderColor: colors.border }]}
              />
                </>
              ) : null}
            </Card>

            {exercises.length && !workoutTimer ? (
              <Card style={styles.guidedTimerCard}>
                <View style={styles.timerStartRow}>
                  <Pressable
                    accessibilityLabel="Guided timer settings"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: timerSettingsOpen }}
                    onPress={() => setTimerSettingsOpen((open) => !open)}
                    style={styles.timerSettingsToggle}
                  >
                    <View style={styles.grow}>
                      <Text style={[styles.exerciseName, { color: colors.ink }]}>
                        Guided timer
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        Optional · otherwise tick sets and save manually.
                      </Text>
                    </View>
                    <Ionicons
                      name={timerSettingsOpen ? "chevron-up" : "chevron-down"}
                      size={17}
                      color={colors.muted}
                    />
                  </Pressable>
                  <Button
                    label={completedSets ? "Time remaining sets" : "Start workout"}
                    icon="play"
                    size="small"
                    onPress={startGuidedWorkout}
                  />
                </View>
                {timerSettingsOpen ? (
                  <View
                    style={[
                      styles.timerAdjustment,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.grow}>
                      <Text style={[styles.label, { color: colors.ink }]}>Set start adjustment</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        Subtract phone-placement time from every guided set.
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel="Decrease set start adjustment"
                      onPress={() =>
                        setSetStartDelaySeconds((value) => Math.max(0, value - 1))
                      }
                      style={[styles.delayButton, { borderColor: colors.border }]}
                    >
                      <Ionicons name="remove" size={16} color={colors.ink} />
                    </Pressable>
                    <Text style={[styles.delayValue, { color: accent }]}>
                      {setStartDelaySeconds}s
                    </Text>
                    <Pressable
                      accessibilityLabel="Increase set start adjustment"
                      onPress={() =>
                        setSetStartDelaySeconds((value) => Math.min(15, value + 1))
                      }
                      style={[styles.delayButton, { borderColor: colors.border }]}
                    >
                      <Ionicons name="add" size={16} color={colors.ink} />
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            ) : null}

            <SectionHeader
              title="Exercises"
              action={
                exerciseEditMode ? (
                  <Pressable
                    onPress={() => setExerciseEditMode(false)}
                    style={[styles.exerciseDone, { backgroundColor: accent }]}
                  >
                    <Text style={styles.exerciseDoneText}>Done</Text>
                  </Pressable>
                ) : (
                <Text style={[styles.summary, { color: accent }]}>
                  {completedSets} sets · {Math.round(volume).toLocaleString(locale)} kg
                </Text>
                )
              }
            />
            {exercises.map((exercise, exerciseIndex) => {
              const open = openExerciseId === exercise.id;
              const trackingMode =
                exercise.trackingMode ??
                catalogExercise(exercise.exerciseKey)?.trackingMode ??
                "load_reps";
              const active = workoutTimer?.exerciseId === exercise.id;
              const activeExerciseRest =
                active && workoutTimer?.phase === "exercise_rest";
              const history = exerciseHistory(sessions, state.currentUserId, exerciseIdentity(exercise));
              const trend = exerciseTrend(history);
              const statusColor =
                trend === "building"
                  ? palette.lime
                  : trend === "steady"
                    ? palette.amber
                    : trend === "regressing"
                      ? palette.red
                      : colors.border;
              return (
                <GymWiggle
                  key={exercise.id}
                  active={exerciseEditMode}
                  index={exerciseIndex}
                >
                <GymDraggableExercise
                  active={exerciseEditMode}
                  index={exerciseIndex}
                  count={exercises.length}
                  onMove={(target) => moveExercise(exercise.id, target)}
                >
                <View
                  style={styles.exerciseContainer}
                  onLayout={(event) => {
                    targetOffsets.current[`exercise:${exercise.id}`] =
                      event.nativeEvent.layout.y;
                  }}
                >
                <Card
                  style={[
                    styles.exerciseCard,
                    {
                      borderColor: active ? timerColor : statusColor,
                      borderWidth: active ? 2 : 1,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  <Pressable
                    style={styles.exerciseHeader}
                    onPress={() => {
                      if (!exerciseEditMode) {
                        setOpenExerciseId(open ? null : exercise.id);
                      }
                    }}
                    onLongPress={() => {
                      setOpenExerciseId(null);
                      setExerciseEditMode(true);
                    }}
                  >
                    {exerciseEditMode ? (
                      <View style={styles.exerciseDragHandle}>
                        <Ionicons
                          name="reorder-three"
                          size={23}
                          color={accent}
                        />
                      </View>
                    ) : null}
                    {exercise.completed ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={palette.lime}
                      />
                    ) : (
                      <View style={[styles.exerciseDot, { backgroundColor: statusColor }]} />
                    )}
                    <View style={styles.grow}>
                      <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>{localizeExerciseName(language, exercise)}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {(exercise.muscleGroups ?? ["full_body"]).map((muscle) => localizeMuscleLabel(language, muscle)).join(" · ")}
                        {averageGymRestSeconds([exercise])
                          ? ` · ${averageGymRestSeconds([exercise])}s avg rest`
                          : ""}
                      </Text>
                    </View>
                    {exerciseEditMode ? (
                      <Pressable
                        accessibilityLabel={`Remove ${exercise.name}`}
                        onPress={() => removeExerciseSafely(exercise)}
                        style={styles.editRemoveExercise}
                        hitSlop={7}
                      >
                        <Ionicons name="remove" size={15} color={palette.white} />
                      </Pressable>
                    ) : null}
                    {!exerciseEditMode ? <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/gym-exercise" as never,
                          params: { key: exerciseIdentity(exercise), name: exercise.name },
                        })
                      }
                      style={[styles.miniAction, { borderColor: colors.border }]}
                    >
                      <Ionicons name="stats-chart-outline" size={16} color={accent} />
                    </Pressable> : null}
                    {!exerciseEditMode ? (
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                    ) : null}
                  </Pressable>
                  {open ? (
                    <View style={[styles.exerciseBody, { borderTopColor: colors.border }]}>
                      <View style={styles.muscleRow}>
                        {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((muscle) => {
                          const selected = exercise.muscleGroups?.includes(muscle) ?? false;
                          return (
                            <Pressable
                              key={muscle}
                              onPress={() =>
                                patchExercise(exercise.id, {
                                  muscleGroups: selected
                                    ? exercise.muscleGroups?.filter((item) => item !== muscle)
                                    : [...(exercise.muscleGroups ?? []), muscle],
                                })
                              }
                              style={[
                                styles.muscleChip,
                                {
                                  borderColor: selected ? accent : colors.border,
                                  backgroundColor: selected ? colors.primarySoft : "transparent",
                                },
                              ]}
                            >
                              <Text style={[styles.muscleText, { color: selected ? accent : colors.muted }]}>
                                {localizeMuscleLabel(language, muscle)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.setHeader}>
                        <Text style={[styles.setSmall, { color: colors.muted }]}>Done</Text>
                        {trackingMode === "load_reps" ? (
                          <Text style={[styles.setLabel, { color: colors.muted }]}>kg</Text>
                        ) : null}
                        <Text style={[styles.setLabel, { color: colors.muted }]}>
                          {trackingMode === "duration" ? "minutes" : "reps"}
                        </Text>
                        <View style={styles.closeSpace} />
                      </View>
                      {exercise.sets.map((set, setIndex) => (
                        <View
                          key={set.id}
                          style={[
                            styles.setBlock,
                            workoutTimer?.phase === "work" &&
                              workoutTimer.setId === set.id &&
                              styles.activeSet,
                          ]}
                          onLayout={(event) => {
                            targetOffsets.current[`set:${set.id}`] =
                              targetOffsets.current[`exercise:${exercise.id}`] +
                              event.nativeEvent.layout.y;
                          }}
                        >
                          <View style={styles.setRow}>
                            <Pressable onPress={() => toggleSet(exercise.id, set)}>
                              <Ionicons
                                name={set.completed ? "checkmark-circle" : "ellipse-outline"}
                                size={25}
                                color={set.completed ? palette.lime : colors.faint}
                              />
                            </Pressable>
                            {trackingMode === "load_reps" ? (
                              <DraftNumberInput
                                value={set.weightKg}
                                onCommit={(value) => updateSet(exercise.id, set.id, { weightKg: value })}
                                keyboardType="decimal-pad"
                                style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                              />
                            ) : null}
                            <DraftNumberInput
                              value={
                                trackingMode === "duration"
                                  ? Math.round(((set.workSeconds ?? 0) / 60) * 10) / 10
                                  : set.reps
                              }
                              onCommit={(value) =>
                                updateSet(
                                  exercise.id,
                                  set.id,
                                  trackingMode === "duration"
                                    ? { workSeconds: Math.max(0, value) * 60 }
                                    : { reps: Math.max(0, Math.round(value)) },
                                )
                              }
                              keyboardType={trackingMode === "duration" ? "decimal-pad" : "number-pad"}
                              style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                            />
                            <Pressable
                              onPress={() => removeSetSafely(exercise, set)}
                            >
                              <Ionicons name="close" size={19} color={colors.faint} />
                            </Pressable>
                          </View>
                          {trackingMode !== "duration" && set.superset ? (
                            <View
                              style={[
                                styles.supersetRow,
                                {
                                  borderColor: accent,
                                  backgroundColor: colors.primarySoft,
                                },
                              ]}
                            >
                              <View style={styles.supersetHeader}>
                                <View style={styles.supersetCopy}>
                                  <Text
                                    translate={false}
                                    numberOfLines={1}
                                    style={[styles.supersetName, { color: colors.ink }]}
                                  >
                                    Superset · {localizeExerciseName(language, set.superset)}
                                  </Text>
                                  {set.superset.workSeconds ? (
                                    <Text style={[styles.setTimeTextInline, { color: colors.muted }]}>
                                      ~{formatGymDuration(set.superset.workSeconds)} active
                                    </Text>
                                  ) : null}
                                </View>
                                <Pressable
                                  accessibilityLabel="Remove superset"
                                  onPress={() =>
                                    updateSet(exercise.id, set.id, {
                                      superset: undefined,
                                    })
                                  }
                                  hitSlop={6}
                                >
                                  <Ionicons name="close" size={17} color={colors.muted} />
                                </Pressable>
                              </View>
                              <View style={styles.supersetFields}>
                                <View style={styles.supersetField}>
                                  <Text style={[styles.supersetUnit, { color: colors.muted }]}>Weight (kg)</Text>
                                  <DraftNumberInput
                                    value={set.superset.weightKg}
                                    onCommit={(weightKg) =>
                                      updateSet(exercise.id, set.id, {
                                        superset: { ...set.superset!, weightKg },
                                      })
                                    }
                                    keyboardType="decimal-pad"
                                    style={[
                                      styles.supersetInput,
                                      { color: colors.ink, borderColor: colors.border },
                                    ]}
                                  />
                                </View>
                                <View style={styles.supersetField}>
                                  <Text style={[styles.supersetUnit, { color: colors.muted }]}>Reps</Text>
                                  <DraftNumberInput
                                    value={set.superset.reps}
                                    onCommit={(reps) =>
                                      updateSet(exercise.id, set.id, {
                                        superset: {
                                          ...set.superset!,
                                          reps: Math.max(0, Math.round(reps)),
                                        },
                                      })
                                    }
                                    keyboardType="number-pad"
                                    style={[
                                      styles.supersetInput,
                                      { color: colors.ink, borderColor: colors.border },
                                    ]}
                                  />
                                </View>
                              </View>
                            </View>
                          ) : trackingMode !== "duration" ? (
                            <Pressable
                              onPress={() => openSupersetPicker(exercise.id, set.id)}
                              style={styles.addSuperset}
                            >
                              <Ionicons name="link-outline" size={13} color={accent} />
                              <Text style={[styles.addSupersetText, { color: accent }]}>Add superset</Text>
                            </Pressable>
                          ) : null}
                          {set.restSeconds ? (
                            <View style={styles.restNote}>
                              <Ionicons
                                name="timer-outline"
                                size={12}
                                color={accent}
                              />
                              <Text
                                style={[
                                  styles.restNoteText,
                                  { color: colors.muted },
                                ]}
                              >
                                Rest after set {setIndex + 1} ·{" "}
                                {formatGymDuration(set.restSeconds)}
                              </Text>
                            </View>
                          ) : null}
                          {set.workSeconds ? (
                            <Text
                              style={[
                                styles.setTimeText,
                                { color: colors.muted },
                              ]}
                            >
                              Active set · {formatGymDuration(set.workSeconds)}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                      <TextInput
                        value={exercise.notes ?? ""}
                        onChangeText={(notes) => patchExercise(exercise.id, { notes })}
                        placeholder="Exercise notes, cues or pain-free adjustments"
                        placeholderTextColor={colors.faint}
                        style={[styles.exerciseNotes, { color: colors.ink, borderColor: colors.border }]}
                      />
                      <View style={styles.exerciseActions}>
                        <Button label="Add set" variant="ghost" icon="add" onPress={() => addSet(exercise.id)} />
                        <Pressable
                          onPress={() => removeExerciseSafely(exercise)}
                          style={styles.removeExercise}
                        >
                          <Ionicons name="trash-outline" size={16} color={palette.red} />
                          <Text style={styles.removeText}>Remove</Text>
                        </Pressable>
                      </View>
                      <Button
                        label={
                          exercise.completed
                            ? "Exercise complete"
                            : "Finish exercise"
                        }
                        icon="checkmark-circle-outline"
                        variant={exercise.completed ? "secondary" : "primary"}
                        disabled={exercise.completed}
                        onPress={() => finishExercise(exercise)}
                      />
                    </View>
                  ) : null}
                </Card>
                {(exercise.restAfterSeconds || activeExerciseRest) &&
                exerciseIndex < exercises.length - 1 ? (
                  <View
                    style={[
                      styles.betweenExerciseRest,
                      {
                        backgroundColor: `${palette.amber}20`,
                        borderColor: palette.amber,
                      },
                    ]}
                  >
                    <Ionicons
                      name="timer-outline"
                      size={14}
                      color={palette.amber}
                    />
                    <Text
                      style={[styles.restNoteText, { color: colors.ink }]}
                    >
                      Between <Text translate={false}>{localizeExerciseName(language, exercise)}</Text> and{" "}
                      <Text translate={false}>{exercises[exerciseIndex + 1] ? localizeExerciseName(language, exercises[exerciseIndex + 1]) : ""}</Text>
                      {" · "}
                      {formatGymDuration(
                        activeExerciseRest
                          ? timerPhaseSeconds
                          : exercise.restAfterSeconds ?? 0,
                      )}
                    </Text>
                  </View>
                ) : null}
                </View>
                </GymDraggableExercise>
                </GymWiggle>
              );
            })}
            <Pressable
              onPress={() => {
                setSupersetTarget(null);
                setPickerOpen(true);
              }}
              style={[styles.addExercise, { borderColor: accent }]}
            >
              <Ionicons name="add-circle-outline" size={19} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>Add exercise</Text>
            </Pressable>
            {exercises.length ? (
              <>
                {completedSets > 0 ? (
                  <Card style={styles.timeSummary}>
                    <TimeSummaryItem
                      label="Exercise time"
                      value={formatGymDuration(timeBreakdown.exerciseSeconds)}
                      color={accent}
                    />
                    <TimeSummaryItem
                      label="Set rest"
                      value={formatGymDuration(timeBreakdown.setRestSeconds)}
                      color={palette.amber}
                    />
                    <TimeSummaryItem
                      label="Between exercises"
                      value={formatGymDuration(
                        timeBreakdown.exerciseRestSeconds,
                      )}
                      color={palette.amber}
                    />
                    <TimeSummaryItem
                      label="Total"
                      value={formatGymDuration(timeBreakdown.totalSeconds)}
                      color={colors.ink}
                    />
                    <TimeSummaryItem
                      label="Avg rest"
                      value={
                        averageRestSeconds
                          ? formatGymDuration(averageRestSeconds)
                          : "—"
                      }
                      color={colors.ink}
                    />
                  </Card>
                ) : null}
                <View style={styles.privacyRow}>
                  <View style={styles.grow}>
                    <Text style={[styles.label, { color: colors.muted }]}>
                      Share mapped workout results
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      Group trackers receive standardized totals; set notes stay private.
                    </Text>
                  </View>
                  <View style={styles.privacyChoices}>
                    <Chip label="Group" selected={visibility === "group"} onPress={() => setVisibility("group")} />
                    <Chip label="Private" selected={visibility === "private"} onPress={() => setVisibility("private")} />
                  </View>
                </View>
                <View style={styles.bottomActions}>
                  <View style={styles.actionCell}>
                    <Button
                      label={selectedPlanId ? "Update" : "Save template"}
                      variant="secondary"
                      size="small"
                      onPress={() => savePlan(false)}
                    />
                  </View>
                  {selectedPlanId ? (
                    <View style={styles.actionCell}>
                      <Button
                        label="Save copy"
                        variant="secondary"
                        size="small"
                        onPress={() => savePlan(true)}
                      />
                    </View>
                  ) : null}
                  {canManageGroup ? (
                    <View style={styles.actionCell}>
                      <Button
                        label={
                          sharedPlans.some(
                            (plan) => plan.id === selectedPlanId,
                          )
                            ? "Update group"
                            : "Share with group"
                        }
                        icon="people-outline"
                        variant="secondary"
                        size="small"
                        onPress={publishGroupPlan}
                      />
                    </View>
                  ) : null}
                  <View style={styles.actionCell}>
                    <Button
                      label="Save workout"
                      icon="checkmark"
                      size="small"
                      onPress={saveDay}
                    />
                  </View>
                </View>
              </>
            ) : null}
          </>
        ) : mode === "progress" ? (
          <>
            <Card style={styles.progressLead}>
              <View style={styles.progressLeadTop}>
                <View style={styles.grow}>
                  <Text style={[styles.progressTitle, { color: colors.ink }]}>30-day training balance</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    Volume is allocated across every selected muscle group.
                  </Text>
                </View>
                <Pressable onPress={() => setRecapOpen(true)} style={[styles.miniAction, { borderColor: colors.border }]}>
                  <Ionicons name="sparkles-outline" size={17} color={accent} />
                </Pressable>
              </View>
              {averageTimedWorkoutSeconds ? (
                <View
                  style={[
                    styles.progressTiming,
                    { borderColor: colors.border },
                  ]}
                >
                  <TimeSummaryItem
                    label="Avg workout"
                    value={formatGymDuration(averageTimedWorkoutSeconds)}
                    color={accent}
                  />
                  <TimeSummaryItem
                    label="Avg exercise"
                    value={formatGymDuration(averageTimedActiveSeconds)}
                    color={palette.lime}
                  />
                  <TimeSummaryItem
                    label="Avg rest"
                    value={
                      recentAverageRestSeconds
                        ? formatGymDuration(recentAverageRestSeconds)
                        : "—"
                    }
                    color={palette.amber}
                  />
                </View>
              ) : null}
              {muscles.length ? muscles.slice(0, 8).map((muscle) => {
                const max = muscles[0]?.volumeKg || 1;
                return (
                  <View key={muscle.muscle} style={styles.muscleProgress}>
                    <View style={styles.progressLabelRow}>
                      <Text style={[styles.muscleName, { color: colors.ink }]}>{muscle.label}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {Math.round(muscle.sets)} sets · {muscle.sessions} sessions
                        {muscle.averageRestSeconds
                          ? ` · ${muscle.averageRestSeconds}s avg rest`
                          : ""}
                        {muscle.averageWorkSeconds
                          ? ` · ${formatGymDuration(muscle.averageWorkSeconds)} avg active`
                          : ""}
                      </Text>
                    </View>
                    <ProgressBar progress={muscle.volumeKg / max} color={accent} />
                  </View>
                );
              }) : (
                <Text style={[styles.empty, { color: colors.muted }]}>Complete a workout to see muscle-group balance.</Text>
              )}
            </Card>
            <SectionHeader title="Exercise history" />
            <Card style={styles.history}>
              {[...new Map(
                sessions.flatMap((session) =>
                  expandedGymExercises(session.exercises).map((exercise) => [exerciseIdentity(exercise), exercise] as const),
                ),
              ).entries()].map(([key, exercise], index) => {
                const history = exerciseHistory(sessions, state.currentUserId, key);
                const trend = exerciseTrend(history);
                return (
                  <Pressable
                    key={key}
                    onPress={() =>
                      router.push({ pathname: "/gym-exercise" as never, params: { key, name: exercise.name } })
                    }
                    style={[styles.historyRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                  >
                    <View style={[styles.exerciseDot, { backgroundColor: trend === "building" ? palette.lime : trend === "steady" ? palette.amber : trend === "regressing" ? palette.red : colors.border }]} />
                    <View style={styles.grow}>
                      <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>{localizeExerciseName(language, exercise)}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>{history.length} logged sessions · {trend === "learning" ? "building baseline" : trend}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.faint} />
                  </Pressable>
                );
              })}
            </Card>
            <SectionHeader title="Workout history" />
            <Card style={styles.history}>
              {sessions.slice(0, 12).map((session, index) => {
                const clock = gymSessionClockBounds(session);
                const clockRange =
                  clock.startedAt && clock.completedAt
                    ? `${formatClockTime(clock.startedAt, state.settings.timeFormat, locale)}–${formatClockTime(clock.completedAt, state.settings.timeFormat, locale)}`
                    : null;
                return (
                <Pressable
                  key={session.id}
                  onPress={() => {
                    initializedDate.current = session.localDate;
                    setLocalDate(session.localDate);
                    loadSavedSession(session);
                    selectMode("workout");
                  }}
                  onLongPress={() => confirmDeleteWorkout(session)}
                  style={[styles.historyRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={styles.grow}>
                    <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>{session.name}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {friendlyDate(session.localDate)}{clockRange ? ` · ${clockRange}` : ""} · {completedGymSets(session.exercises)} sets · {session.durationMinutes} min
                      {" · "}
                      {formatGymDuration(
                        gymSessionTimeBreakdown(
                          session.durationMinutes,
                          session.exercises,
                        ).restSeconds,
                      )} rest
                    </Text>
                  </View>
                  <Text style={[styles.historyValue, { color: accent }]}>
                    {Math.round(trainingVolumeKg(session.exercises)).toLocaleString(locale)} kg
                  </Text>
                </Pressable>
                );
              })}
            </Card>
          </>
        ) : (
          <View style={styles.performanceStack}>
            <Card style={styles.performanceControls}>
              <View style={styles.performanceRangeBar}>
                {(
                  [
                    ["week", "Week"],
                    ["month", "Month"],
                    ["year", "Year"],
                    ["all", "All time"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    onPress={() => setPerformanceRange(id)}
                    style={[
                      styles.performanceRangeChoice,
                      performanceRange === id && {
                        backgroundColor: colors.primarySoft,
                        borderColor: accent,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.performanceRangeText,
                        { color: performanceRange === id ? accent : colors.muted },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {performanceRange === "custom" ? (
                <>
                  <View style={styles.customDateRow}>
                    {(["start", "end"] as const).map((side) => {
                      const date = side === "start" ? performanceCustomStart : performanceCustomEnd;
                      return (
                        <Pressable
                          key={side}
                          onPress={() => setPerformanceCustomPicker(side)}
                          style={[
                            styles.customDate,
                            {
                              borderColor:
                                performanceCustomPicker === side ? accent : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.customDateLabel, { color: colors.muted }]}>
                            {side === "start" ? "From" : "To"}
                          </Text>
                          <Text style={[styles.customDateValue, { color: colors.ink }]}>
                            {friendlyDate(date)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {performanceCustomPicker ? (
                    <MonthCalendar
                      selectedDate={
                        performanceCustomPicker === "start"
                          ? performanceCustomStart
                          : performanceCustomEnd
                      }
                      monthDate={
                        performanceCustomPicker === "start"
                          ? performanceCustomStart
                          : performanceCustomEnd
                      }
                      rangeStart={performanceCustomStart}
                      rangeEnd={performanceCustomEnd}
                      rangeAccent={accent}
                      onSelect={(date) => {
                        if (performanceCustomPicker === "start")
                          setPerformanceCustomStart(date);
                        else setPerformanceCustomEnd(date);
                        setPerformanceCustomPicker(null);
                      }}
                    />
                  ) : null}
                </>
              ) : null}
              <SelectionMenu
                title="Exercise and muscle filters"
                items={performanceFilterItems}
                selectedIds={performanceFilters}
                onChange={setPerformanceFilters}
                emptyLabel="All exercises and muscle groups"
              />
            </Card>

            <View style={styles.performancePriorities}>
              {(
                [
                  ["gaining", "Top gainers", performanceTrendCounts.gaining, palette.lime],
                  ["steady", "Steady", performanceTrendCounts.steady, accent],
                  ["focus", "Need focus", performanceTrendCounts.focus, palette.amber],
                  ["learning", "Building baseline", performanceTrendCounts.learning, colors.muted],
                ] as const
              ).map(([id, label, count, color]) => (
                <Pressable
                  key={id}
                  onPress={() =>
                    setPerformancePriority((current) =>
                      current === id ? "all" : id,
                    )
                  }
                  style={[
                    styles.performancePriority,
                    {
                      borderColor: performancePriority === id ? color : colors.border,
                      backgroundColor:
                        performancePriority === id ? `${color}18` : colors.card,
                    },
                  ]}
                >
                  <Text style={[styles.performancePriorityCount, { color }]}>{count}</Text>
                  <Text style={[styles.performancePriorityLabel, { color: colors.muted }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {(performanceHighlights.strongest || performanceHighlights.focus) ? (
              <Card style={styles.performanceHighlights}>
                {performanceHighlights.strongest ? (
                  <View style={styles.performanceHighlight}>
                    <Ionicons name="trending-up" size={16} color={palette.lime} />
                    <View style={styles.grow}>
                      <Text style={[styles.label, { color: palette.lime }]}>Strongest improvement</Text>
                      <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>
                        {localizeExerciseName(language, performanceHighlights.strongest.exercise)} · {Math.round(performanceHighlights.strongest.stats.improvement)}%
                      </Text>
                    </View>
                  </View>
                ) : null}
                {performanceHighlights.focus ? (
                  <View style={styles.performanceHighlight}>
                    <Ionicons name="locate-outline" size={16} color={palette.amber} />
                    <View style={styles.grow}>
                      <Text style={[styles.label, { color: palette.amber }]}>Focus next</Text>
                      <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>
                        {localizeExerciseName(language, performanceHighlights.focus.exercise)}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </Card>
            ) : null}

            <SectionHeader
              title="Workout performance"
              action={
                performanceEditMode ? (
                  <Pressable
                    onPress={() => setPerformanceEditMode(false)}
                    style={[styles.exerciseDone, { backgroundColor: accent }]}
                  >
                    <Text style={styles.exerciseDoneText}>Done</Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.summary, { color: accent }]}>
                    {performanceRows.length} exercises
                  </Text>
                )
              }
            />
            {performanceRows.map((row, index) => {
              const trendColor =
                row.stats.trend === "building"
                  ? palette.lime
                  : row.stats.trend === "regressing"
                    ? palette.red
                    : row.stats.trend === "steady"
                      ? palette.amber
                      : colors.muted;
              return (
                <GymDraggableExercise
                  key={row.key}
                  active={performanceEditMode}
                  index={index}
                  count={performanceRows.length}
                  spacing={12}
                  onMove={(target) => movePerformanceRow(row.key, target)}
                >
                  <Pressable
                    onLongPress={() => setPerformanceEditMode(true)}
                    onPress={() =>
                      performanceEditMode
                        ? undefined
                        : router.push({
                            pathname: "/gym-exercise" as never,
                            params: { key: row.key, name: row.exercise.name },
                          })
                    }
                  >
                    <Card style={[styles.performanceTile, { borderColor: trendColor }]}>
                      {performanceEditMode ? (
                        <Ionicons name="reorder-three" size={23} color={accent} />
                      ) : (
                        <View style={[styles.exerciseDot, { backgroundColor: trendColor }]} />
                      )}
                      <View style={styles.grow}>
                        <View style={styles.performanceTitleRow}>
                          <Text translate={false} style={[styles.exerciseName, { color: colors.ink }]}>
                            {localizeExerciseName(language, row.exercise)}
                          </Text>
                          {performancePinned.includes(row.key) ? (
                            <Ionicons name="pin" size={12} color={accent} />
                          ) : null}
                        </View>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {row.stats.sessions} sessions · {Math.round(row.volume).toLocaleString(locale)} kg volume · best {Math.round(row.stats.bestOneRepMax)} kg e1RM
                        </Text>
                        <Text style={[styles.performanceSignal, { color: trendColor }]}>
                          {row.stats.trend === "learning"
                            ? "Building a reliable baseline"
                            : `${row.stats.improvement >= 0 ? "+" : ""}${Math.round(row.stats.improvement)}% strength change in this range · ${row.stats.trend}`}
                        </Text>
                      </View>
                      {performanceEditMode ? (
                        <View style={styles.performanceEditActions}>
                          <Pressable
                            onPress={() =>
                              setPerformancePinned((current) =>
                                current.includes(row.key)
                                  ? current.filter((key) => key !== row.key)
                                  : [...current, row.key],
                              )
                            }
                            style={[styles.performanceEditButton, { borderColor: colors.border }]}
                          >
                            <Ionicons
                              name={performancePinned.includes(row.key) ? "pin" : "pin-outline"}
                              size={15}
                              color={accent}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              setPerformanceHidden((current) => [...current, row.key])
                            }
                            style={[styles.performanceEditButton, { backgroundColor: palette.red, borderColor: palette.red }]}
                          >
                            <Ionicons name="remove" size={15} color={palette.white} />
                          </Pressable>
                        </View>
                      ) : (
                        <Ionicons name="chevron-forward" size={17} color={colors.faint} />
                      )}
                    </Card>
                  </Pressable>
                </GymDraggableExercise>
              );
            })}
            {!performanceRows.length ? (
              <Card>
                <Text style={[styles.empty, { color: colors.muted }]}>
                  No workout data matches this range and filter yet.
                </Text>
                {performanceHidden.length ? (
                  <Button
                    label="Restore hidden exercises"
                    variant="ghost"
                    size="small"
                    onPress={() => setPerformanceHidden([])}
                  />
                ) : null}
              </Card>
            ) : null}
          </View>
        )}
      </Screen>
      </View>
      </GestureDetector>

      <Modal transparent animationType="slide" visible={pickerOpen} onRequestClose={closeExercisePicker}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <View style={styles.grow}>
                <Text style={[styles.progressTitle, { color: colors.ink }]}>
                  {supersetTarget ? "Add superset exercise" : "Add exercise"}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {supersetTarget
                    ? "The paired movement shares this set and is tracked separately in progress."
                    : "Standard names keep progress history together."}
                </Text>
              </View>
              <Pressable onPress={closeExercisePicker}>
                <Ionicons name="close" size={23} color={colors.ink} />
              </Pressable>
            </View>
            <TextInput
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search exercise or muscle"
              placeholderTextColor={colors.faint}
              autoFocus
              style={[styles.search, { color: colors.ink, borderColor: colors.border }]}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pickerCategories}
            >
              <Chip
                label="All"
                selected={pickerCategory === "all"}
                onPress={() => setPickerCategory("all")}
              />
              {(Object.keys(EXERCISE_CATEGORY_LABELS) as ExerciseCategory[]).map(
                (category) => (
                  <Chip
                    key={category}
                    label={EXERCISE_CATEGORY_LABELS[category]}
                    selected={pickerCategory === category}
                    onPress={() => setPickerCategory(category)}
                  />
                ),
              )}
            </ScrollView>
            <View style={styles.pickerMuscles}>
              <Chip label="All" selected={pickerMuscle === "all"} onPress={() => setPickerMuscle("all")} />
              {(["chest", "back", "shoulders", "quadriceps", "hamstrings", "abs"] as MuscleGroup[]).map((muscle) => (
                <Chip key={muscle} label={localizeMuscleLabel(language, muscle)} selected={pickerMuscle === muscle} onPress={() => setPickerMuscle(muscle)} />
              ))}
            </View>
            <View style={styles.customRow}>
              <TextInput
                value={customExerciseName}
                onChangeText={setCustomExerciseName}
                placeholder="Can't find it? Name a custom exercise"
                placeholderTextColor={colors.faint}
                style={[styles.customInput, { color: colors.ink, borderColor: colors.border }]}
                onSubmitEditing={addCustomExercise}
              />
              <Pressable
                disabled={!customExerciseName.trim()}
                onPress={addCustomExercise}
                style={[styles.customAdd, { backgroundColor: customExerciseName.trim() ? accent : colors.border }]}
              >
                <Ionicons name="add" size={21} color={palette.white} />
              </Pressable>
            </View>
            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {pickerItems.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => addCatalogExercise(item)}
                  style={[styles.pickerItem, { borderColor: colors.border }]}
                >
                  <View style={[styles.catalogIcon, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name="barbell-outline" size={17} color={accent} />
                  </View>
                  <View style={styles.grow}>
                    <Text
                      translate={
                        EXERCISE_CATALOG.some(
                          (catalogItem) =>
                            catalogItem.key === item.key &&
                            catalogItem.name === item.name,
                        )
                      }
                      style={[styles.exerciseName, { color: colors.ink }]}
                    >
                      {localizeExerciseName(language, item)}
                    </Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {groupExerciseKeys.has(item.key)
                        ? "Group exercise · "
                        : ""}
                      {EXERCISE_CATEGORY_LABELS[item.category]} · {" "}
                      {item.muscles.map((muscle) => localizeMuscleLabel(language, muscle)).join(" · ")}
                    </Text>
                  </View>
                  <Ionicons name="add" size={20} color={accent} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={recapOpen} onRequestClose={() => setRecapOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRecapOpen(false)}>
          <View style={[styles.recapSheet, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <View style={styles.grow}>
                <Text style={[styles.progressTitle, { color: colors.ink }]}>Workout recap</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>Personal training signals, not medical advice.</Text>
              </View>
              <Ionicons name="sparkles" size={20} color={accent} />
            </View>
            {recaps.map((card) => (
              <Card
                key={card.id}
                style={[
                  styles.recapCard,
                  {
                    borderColor:
                      card.tone === "positive"
                        ? palette.lime
                        : card.tone === "attention"
                          ? palette.amber
                          : colors.border,
                  },
                ]}
              >
                <Text style={[styles.exerciseName, { color: colors.ink }]}>{card.title}</Text>
                <Text style={[styles.recapBody, { color: colors.muted }]}>{card.body}</Text>
              </Card>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default GymScreen;

function TimeSummaryItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.timeSummaryItem}>
      <Text style={[styles.timeSummaryValue, { color }]}>{value}</Text>
      <Text style={[styles.timeSummaryLabel, { color: colors.muted }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageGesture: { flex: 1 },
  page: { paddingBottom: 18 },
  workoutTimer: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timerPulse: { width: 8, height: 8, borderRadius: 4 },
  timerCopy: { flex: 1, minWidth: 0 },
  timerHeading: { fontSize: 11, fontWeight: "900" },
  timerMeta: { fontSize: 8, lineHeight: 11, marginTop: 2 },
  timerControl: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  timerNext: {
    minHeight: 34,
    maxWidth: 124,
    borderRadius: 10,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  timerNextText: {
    color: palette.ink,
    fontSize: 8,
    fontWeight: "900",
    flexShrink: 1,
  },
  timerStartRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  guidedTimerCard: { paddingVertical: 7, paddingHorizontal: 10 },
  timerSettingsToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerAdjustment: {
    minHeight: 44,
    borderTopWidth: 1,
    paddingTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeSegment: {
    height: 34,
    borderWidth: 1,
    borderRadius: 11,
    padding: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  modeChoice: {
    minWidth: 56,
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  modeChoicePressed: { opacity: 0.78 },
  modeChoiceText: { fontSize: 8, fontWeight: "900" },
  dayCard: { gap: 9 },
  detailsToggle: { minHeight: 43, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center" },
  dateLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  date: { fontSize: 13, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  calendar: { borderTopWidth: 1, paddingTop: 10 },
  calendarLegend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 5,
  },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  sessionPicker: { borderTopWidth: 1, paddingTop: 8, gap: 7 },
  sessionPickerHeader: {
    minHeight: 29,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  newSessionButton: {
    minHeight: 29,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  newSessionText: { fontSize: 8, fontWeight: "900" },
  sessionChoices: { gap: 6, paddingRight: 4 },
  sessionChoice: {
    width: 126,
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center",
  },
  sessionChoiceName: { fontSize: 9, fontWeight: "900" },
  sessionChoiceMeta: { fontSize: 7, lineHeight: 10, marginTop: 2 },
  templateMenu: { borderWidth: 1, borderRadius: 11, overflow: "hidden" },
  templateToggle: {
    minHeight: 44,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planRow: { borderTopWidth: 1, gap: 3, padding: 6 },
  templateChoice: { width: "100%" },
  nameInput: { borderWidth: 1, borderRadius: 11, minHeight: 41, paddingHorizontal: 11, fontSize: 11, fontWeight: "800" },
  compactRow: { flexDirection: "row", gap: 7 },
  field: { width: 76, gap: 4 },
  fieldWide: { flex: 1, gap: 4 },
  label: { fontSize: 8, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 9, height: 37, paddingHorizontal: 9, fontSize: 10 },
  intensityRow: { flexDirection: "row", gap: 4 },
  intensity: { flex: 1, height: 37, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  intensityText: { fontSize: 9, fontWeight: "900" },
  calorieMethod: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  calorieMethodHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  calorieMethodChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
  },
  calorieMethodBody: { gap: 6, paddingTop: 7 },
  notes: { borderWidth: 1, borderRadius: 10, minHeight: 42, maxHeight: 70, padding: 9, fontSize: 9, textAlignVertical: "top" },
  restCard: { paddingVertical: 8, paddingHorizontal: 10 },
  restMain: { flexDirection: "row", alignItems: "center", gap: 7 },
  restAdjust: { minWidth: 38, height: 32, paddingHorizontal: 5, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  restAdjustText: { fontSize: 8, fontWeight: "900" },
  restStop: { height: 32, paddingHorizontal: 10, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  restStopText: { color: palette.white, fontSize: 8, fontWeight: "900" },
  summary: { fontSize: 9, fontWeight: "900" },
  exerciseDone: {
    minHeight: 30,
    borderRadius: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseDoneText: {
    color: palette.ink,
    fontSize: 8,
    fontWeight: "900",
  },
  exerciseDragHandle: {
    width: 30,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseContainer: { width: "100%", marginBottom: 6 },
  exerciseCard: { paddingVertical: 2, paddingHorizontal: 9 },
  exerciseHeader: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8 },
  exerciseDot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flex: 1, minWidth: 0 },
  exerciseName: { fontSize: 11, fontWeight: "900" },
  miniAction: { width: 32, height: 32, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  exerciseBody: { borderTopWidth: 1, paddingVertical: 9, gap: 7 },
  muscleRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  muscleChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 },
  muscleText: { fontSize: 7, fontWeight: "800" },
  setHeader: { flexDirection: "row", gap: 7, alignItems: "center" },
  setSmall: { width: 28, textAlign: "center", fontSize: 7 },
  setLabel: { flex: 1, textAlign: "center", fontSize: 7 },
  closeSpace: { width: 19 },
  setBlock: { gap: 2, borderRadius: 9, paddingVertical: 2 },
  activeSet: { paddingHorizontal: 4, backgroundColor: `${palette.lime}16` },
  setRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  setTimeText: { marginLeft: 35, fontSize: 7, fontWeight: "700" },
  setTimeTextInline: { fontSize: 7, fontWeight: "700" },
  supersetRow: {
    minHeight: 66,
    marginLeft: 34,
    borderLeftWidth: 2,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 6,
    gap: 5,
  },
  supersetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  supersetCopy: { flex: 1, minWidth: 0 },
  supersetName: { fontSize: 8, fontWeight: "900" },
  supersetFields: { flexDirection: "row", gap: 8 },
  supersetField: { flex: 1, minWidth: 0, gap: 3 },
  supersetInput: {
    width: "100%",
    height: 32,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 7,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "800",
  },
  supersetUnit: { fontSize: 7, fontWeight: "800" },
  addSuperset: {
    marginLeft: 34,
    minHeight: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addSupersetText: { fontSize: 7, fontWeight: "900" },
  restNote: {
    marginLeft: 35,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 20,
  },
  exerciseRestNote: {
    marginLeft: 0,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  restNoteText: { fontSize: 8, fontWeight: "700" },
  betweenExerciseRest: {
    minHeight: 28,
    marginHorizontal: 13,
    marginVertical: 4,
    borderLeftWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  setInput: { flex: 1, height: 36, borderWidth: 1, borderRadius: 9, textAlign: "center", fontSize: 11, fontWeight: "800" },
  exerciseNotes: { borderWidth: 1, borderRadius: 9, minHeight: 37, paddingHorizontal: 9, fontSize: 9 },
  exerciseActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  removeExercise: { flexDirection: "row", gap: 4, alignItems: "center", padding: 8 },
  editRemoveExercise: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: palette.red,
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { color: palette.red, fontSize: 8, fontWeight: "900" },
  addExercise: { minHeight: 46, marginTop: 4, borderWidth: 1, borderStyle: "dashed", borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontSize: 9, fontWeight: "900" },
  privacyRow: { marginTop: 8, gap: 7 },
  privacyChoices: { flexDirection: "row", gap: 7 },
  timeSummary: {
    flexDirection: "row",
    paddingVertical: 9,
    paddingHorizontal: 6,
    marginTop: 7,
  },
  timeSummaryItem: { flex: 1, alignItems: "center", gap: 2 },
  timeSummaryValue: { fontSize: 13, fontWeight: "900" },
  timeSummaryLabel: {
    fontSize: 7,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  bottomActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 4,
  },
  actionCell: { width: "48%", flexGrow: 1 },
  delayButton: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  delayValue: { width: 28, textAlign: "center", fontSize: 10, fontWeight: "900" },
  progressLead: { gap: 11 },
  progressTiming: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    flexDirection: "row",
  },
  progressLeadTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressTitle: { fontSize: 15, fontWeight: "900" },
  muscleProgress: { gap: 5 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  muscleName: { fontSize: 9, fontWeight: "900" },
  empty: { fontSize: 9, textAlign: "center", padding: 18 },
  history: { paddingVertical: 2, paddingHorizontal: 10 },
  historyRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8 },
  performanceStack: { gap: 12 },
  performanceControls: { gap: 8, padding: 8 },
  performanceRangeBar: { flexDirection: "row", gap: 3 },
  performanceRangeChoice: {
    flex: 1,
    minHeight: 31,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  performanceRangeText: { fontSize: 7, fontWeight: "900" },
  customDateRow: { flexDirection: "row", gap: 7 },
  customDate: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 7 },
  customDateLabel: { fontSize: 6, fontWeight: "900", textTransform: "uppercase" },
  customDateValue: { fontSize: 9, fontWeight: "900", marginTop: 2 },
  performancePriorities: { flexDirection: "row", gap: 5 },
  performanceHighlights: { flexDirection: "row", gap: 8, paddingVertical: 8 },
  performanceHighlight: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  performancePriority: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  performancePriorityCount: { fontSize: 13, fontWeight: "900" },
  performancePriorityLabel: { fontSize: 6, fontWeight: "800", textAlign: "center" },
  performanceTile: {
    minHeight: 72,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  performanceTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  performanceSignal: { fontSize: 7, lineHeight: 10, fontWeight: "900", marginTop: 3 },
  performanceEditActions: { gap: 5 },
  performanceEditButton: {
    width: 27,
    height: 27,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  historyValue: { fontSize: 9, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  pickerSheet: { maxHeight: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 },
  pickerHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  search: { height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 10 },
  pickerCategories: { gap: 5, paddingRight: 8 },
  pickerMuscles: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  customRow: { flexDirection: "row", gap: 7 },
  customInput: { flex: 1, height: 40, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 10 },
  customAdd: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  pickerList: { maxHeight: 390 },
  pickerItem: { minHeight: 48, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  catalogIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  recapSheet: { margin: 14, marginBottom: 30, borderRadius: 22, padding: 14, gap: 8 },
  recapCard: { padding: 11 },
  recapBody: { fontSize: 9, lineHeight: 14, marginTop: 3 },
});
