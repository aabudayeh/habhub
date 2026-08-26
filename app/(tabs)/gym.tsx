import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
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
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
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
  completeGymWorkout,
  averageGymRestSeconds,
  estimateGymActiveCalories,
  expandedGymExercises,
  exerciseHistory,
  exerciseIdentity,
  exercisePerformanceComparison,
  type GymExercisePerformanceComparison,
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
  customPerformancePeriod,
  overallPerformancePeriod,
  performancePeriod,
  type PerformanceRange,
} from "@/src/domain/performance";
import {
  acknowledgeWorkoutActionsAfterPersistence,
  webWorkoutActionAckRetryDelay,
} from "@/src/domain/workoutNotifications";
import {
  acknowledgeNativeWorkoutTimerAction,
  acknowledgeWebWorkoutTimerActions,
  configureWorkoutTimerNotification,
  consumeWorkoutTimerActions,
  dismissWorkoutTimerNotification,
  nativeWorkoutActionsEnabled,
  showWorkoutTimerNotification,
  subscribeWebWorkoutTimerActions,
  WORKOUT_TIMER_FINISH,
  WORKOUT_TIMER_NEXT,
  WORKOUT_TIMER_PAUSE,
  WORKOUT_TIMER_RESUME,
  type QueuedWorkoutTimerAction,
  WorkoutNotificationStep,
} from "@/src/notifications/workoutTimer";
import { useFocusedCloudSyncPause } from "@/src/cloud/useFocusedCloudSyncPause";
import {
  setWorkoutTimerPresence,
  workoutDraftKey,
} from "@/src/storage/workoutTimerPresence";
import { readBackgroundWorkoutCompletion } from "@/src/storage/backgroundWorkoutFinish";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useTutorial } from "@/src/tutorial/TutorialContext";
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
  GymTimerMode,
  MuscleGroup,
  Visibility,
} from "@/src/types";

const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const intensities: GymIntensity[] = ["light", "moderate", "vigorous"];
type RunningWorkoutPhase = "work" | "set_rest" | "exercise_rest";
type WorkoutPhase = RunningWorkoutPhase | "paused";
type WorkoutTimer = {
  mode: GymTimerMode;
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
type GymPerformancePriority = "all" | "gaining" | "steady" | "focus" | "learning";

const GYM_PERFORMANCE_RANGES: { id: PerformanceRange; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
  { id: "year", label: "Yearly" },
];

const GYM_COMPARISON_OPTIONS = [
  {
    id: "previous",
    label: "Previous period",
    icon: "play-back-outline" as const,
    group: "Comparison",
  },
  {
    id: "overall",
    label: "Overall average",
    icon: "analytics-outline" as const,
    group: "Comparison",
  },
  {
    id: "custom",
    label: "Custom ranges",
    icon: "calendar-outline" as const,
    group: "Comparison",
  },
];

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
  processedWebWorkoutActionIds?: string[];
  processedNativeWorkoutActionIds?: string[];
};

function queuedWorkoutTimerActionId(action: QueuedWorkoutTimerAction) {
  return action.webActionId
    ? `web:${action.webActionId}`
    : `${action.ownerId}:${action.generation}:${action.action}:${action.occurredAt}`;
}

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

function gymPerformanceScoreText(
  comparison: GymExercisePerformanceComparison,
  locale: string,
) {
  const rounded = Math.round(comparison.currentScore * 10) / 10;
  if (comparison.scoreKind === "strength")
    return `${rounded.toLocaleString(locale)} kg avg e1RM`;
  if (comparison.scoreKind === "duration")
    return `${formatGymDuration(Math.round(comparison.currentScore))} avg active`;
  if (comparison.scoreKind === "reps")
    return `${rounded.toLocaleString(locale)} avg reps`;
  return `${rounded.toLocaleString(locale)} kg avg volume`;
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
  const {
    state,
    hydrated,
    saveGymPlan,
    deleteGymPlan,
    saveGroupGymPlan,
    deleteGroupGymPlan,
    saveGymSession,
    deleteGymSession,
    updateSettings,
    flushLocalPersistence,
  } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const tutorial = useTutorial();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const { language, t } = useLocalization();
  const webNotificationParams = useLocalSearchParams<{
    workoutAction?: string | string[];
    workoutActionAt?: string | string[];
  }>();
  const webNotificationAction = Array.isArray(
    webNotificationParams.workoutAction,
  )
    ? webNotificationParams.workoutAction[0]
    : webNotificationParams.workoutAction;
  const webNotificationActionAt = Array.isArray(
    webNotificationParams.workoutActionAt,
  )
    ? webNotificationParams.workoutActionAt[0]
    : webNotificationParams.workoutActionAt;
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
  useFocusedCloudSyncPause("gym-edit", exerciseEditMode);
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
  const configuredTimerMode: GymTimerMode =
    state.settings.gymTimerMode === "whole_workout"
      ? "whole_workout"
      : "guided";
  const loggedTodayCollapsed =
    state.settings.gymLoggedTodayCollapsed !== false;
  const [timerNow, setTimerNow] = useState(Date.now());
  const activeTutorialTarget = tutorial.activeStep?.target;
  useEffect(() => {
    if (activeTutorialTarget === "workout-templates") {
      setSessionDetailsOpen(true);
      setTemplatesOpen(true);
    }
    if (activeTutorialTarget === "workout-exercises" && exercises[0]) {
      setOpenExerciseId(exercises[0].id);
    }
  }, [activeTutorialTarget, exercises]);
  const [appActivity, setAppActivity] = useState(
    NativeAppState.currentState,
  );
  const handledTimerResponse = useRef<string | null>(null);
  const handledWebTimerAction = useRef<string | null>(null);
  const [queuedNativeTimerActions, setQueuedNativeTimerActions] = useState<
    QueuedWorkoutTimerAction[]
  >([]);
  const [pendingWebTimerActionAcks, setPendingWebTimerActionAcks] = useState<
    QueuedWorkoutTimerAction[]
  >([]);
  const [pendingNativeTimerActionAcks, setPendingNativeTimerActionAcks] =
    useState<QueuedWorkoutTimerAction[]>([]);
  const [webTimerActionAckRetry, setWebTimerActionAckRetry] = useState(0);
  const [nativeTimerActionAckRetry, setNativeTimerActionAckRetry] = useState(0);
  const processedNativeTimerActionIds = useRef(new Set<string>());
  const processedNativeTimerActionOrder = useRef<string[]>([]);
  const handledBackgroundWorkoutCompletion = useRef<string | null>(null);
  const webTimerActionAckAttempt = useRef(0);
  const nativeTimerActionAckAttempt = useRef(0);
  const workoutDraftPersistenceRef = useRef<Promise<void>>(Promise.resolve());
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
    allowProgression: boolean;
  } | null>(null);
  const initializedDate = useRef<string | null>(null);
  const loadedSavedSessionId = useRef<string | null>(null);
  const [workoutDraftReady, setWorkoutDraftReady] = useState(false);
  useEffect(() => {
    if (!workoutDraftReady) return;
    setWorkoutTimerPresence(
      state.currentUserId,
      !tutorialSandbox && Boolean(workoutTimer),
    );
  }, [
    state.currentUserId,
    tutorialSandbox,
    workoutDraftReady,
    workoutTimer,
  ]);
  useEffect(() => {
    if (
      Platform.OS !== "android" ||
      tutorialSandbox ||
      !workoutDraftReady ||
      !workoutTimer ||
      appActivity !== "active"
    )
      return;
    let cancelled = false;
    void readBackgroundWorkoutCompletion(state.currentUserId).then(
      (completion) => {
        if (
          cancelled ||
          !completion ||
          completion.session.id !== sessionId
        )
          return;
        const identity = `${completion.generation}:${completion.occurredAt}`;
        if (handledBackgroundWorkoutCompletion.current === identity) return;
        handledBackgroundWorkoutCompletion.current = identity;
        // The headless task already wrote this session. Reapplying through the
        // foreground reducer is idempotent and updates a still-alive provider,
        // while clearing the stale local timer without replaying Finish twice.
        // Flush immediately: AppProvider retires the exact recovery receipt
        // only after both active and account snapshots contain this session.
        saveGymSession(completion.session);
        void flushLocalPersistence().catch(() => undefined);
        setExercises(completion.session.exercises);
        setDuration(
          completion.session.durationMinutes
            ? String(
                Math.round(completion.session.durationMinutes * 10) / 10,
              )
            : "",
        );
        setWorkoutTimer(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    appActivity,
    flushLocalPersistence,
    saveGymSession,
    sessionId,
    state.currentUserId,
    tutorialSandbox,
    workoutDraftReady,
    workoutTimer,
  ]);
  const enqueueNativeTimerActions = useCallback(
    (actions: QueuedWorkoutTimerAction[]) => {
      if (!actions.length) return;
      // A crash after draft persistence but before ACK leaves the exact receipt
      // queued natively. Its durable ID proves the transition was already
      // applied, so ACK it without replaying the workout phase a second time.
      const alreadyProcessed = actions.filter((item) =>
        processedNativeTimerActionIds.current.has(
          queuedWorkoutTimerActionId(item),
        ),
      );
      if (alreadyProcessed.length)
        setPendingNativeTimerActionAcks((current) => {
          const known = new Set(current.map(queuedWorkoutTimerActionId));
          return [
            ...current,
            ...alreadyProcessed.filter((item) => {
              const id = queuedWorkoutTimerActionId(item);
              if (known.has(id)) return false;
              known.add(id);
              return true;
            }),
          ].slice(-30);
        });
      setQueuedNativeTimerActions((current) => {
        const known = new Set(
          current.map(queuedWorkoutTimerActionId),
        );
        const additions = actions.filter((item) => {
          const id = queuedWorkoutTimerActionId(item);
          if (known.has(id) || processedNativeTimerActionIds.current.has(id))
            return false;
          known.add(id);
          return true;
        });
        return additions.length ? [...current, ...additions].slice(-30) : current;
      });
    },
    [],
  );
  const queueWebTimerActionAck = useCallback(
    (action: QueuedWorkoutTimerAction) => {
      if (!action.webActionId) return;
      setPendingWebTimerActionAcks((current) =>
        current.some((item) => item.webActionId === action.webActionId)
          ? current
          : [...current, action].slice(-30),
      );
    },
    [],
  );
  const queueNativeTimerActionAck = useCallback(
    (action: QueuedWorkoutTimerAction) => {
      if (action.webActionId || Platform.OS !== "android") return;
      const id = queuedWorkoutTimerActionId(action);
      setPendingNativeTimerActionAcks((current) =>
        current.some((item) => queuedWorkoutTimerActionId(item) === id)
          ? current
          : [...current, action].slice(-30),
      );
    },
    [],
  );
  useEffect(() => {
    if (Platform.OS !== "web" || tutorialSandbox || !workoutDraftReady) return;
    return subscribeWebWorkoutTimerActions(
      state.currentUserId,
      enqueueNativeTimerActions,
    );
  }, [
    enqueueNativeTimerActions,
    state.currentUserId,
    tutorialSandbox,
    workoutDraftReady,
  ]);
  const [performanceRange, setPerformanceRange] =
    useState<PerformanceRange>("week");
  const defaultPerformancePeriod = useMemo(
    () =>
      performancePeriod(
        performanceRange,
        dateKey(),
        state.settings.weekStartsOn ?? 1,
        locale,
      ),
    [locale, performanceRange, state.settings.weekStartsOn],
  );
  const [performanceComparisonMode, setPerformanceComparisonMode] = useState<
    "previous" | "overall" | "custom"
  >("previous");
  const [performanceCurrentStart, setPerformanceCurrentStart] = useState(
    defaultPerformancePeriod.currentDates[0] ?? dateKey(),
  );
  const [performanceCurrentEnd, setPerformanceCurrentEnd] = useState(
    defaultPerformancePeriod.currentDates.at(-1) ?? dateKey(),
  );
  const [performancePreviousStart, setPerformancePreviousStart] = useState(
    defaultPerformancePeriod.previousDates[0] ?? dateKey(),
  );
  const [performancePreviousEnd, setPerformancePreviousEnd] = useState(
    defaultPerformancePeriod.previousDates.at(-1) ?? dateKey(),
  );
  const [performanceRangePicker, setPerformanceRangePicker] = useState<
    "current" | "previous" | null
  >(null);
  const [performanceRangePickerStep, setPerformanceRangePickerStep] = useState<
    "start" | "end"
  >("start");
  const [performanceFilters, setPerformanceFilters] = useState<string[]>([]);
  const [performancePriority, setPerformancePriority] =
    useState<GymPerformancePriority>("all");
  const [performanceEditMode, setPerformanceEditMode] = useState(false);
  const [performanceOrder, setPerformanceOrder] = useState<string[]>([]);
  const [performancePinned, setPerformancePinned] = useState<string[]>([]);
  const [performanceHidden, setPerformanceHidden] = useState<string[]>([]);
  useFocusedCloudSyncPause("gym-performance-edit", performanceEditMode);

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
      !performanceRangePicker,
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
  const gymReminderMetric = useMemo(
    () =>
      state.metrics.find(
        (metric) => metric.gymMapping?.kind === "session_completed",
      ) ?? state.metrics.find((metric) => metric.id === "workout"),
    [state.metrics],
  );
  const openGymReminders = useCallback(() => {
    if (!gymReminderMetric) return;
    router.push({
      pathname: "/metric-editor",
      params: { id: gymReminderMetric.id, focus: "notifications" },
    } as never);
  }, [gymReminderMetric]);
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
  const selectedPerformancePeriod = useMemo(() => {
    if (performanceComparisonMode === "overall")
      return overallPerformancePeriod(state, defaultPerformancePeriod);
    if (performanceComparisonMode === "custom")
      return customPerformancePeriod(
        performanceCurrentStart,
        performanceCurrentEnd,
        performancePreviousStart,
        performancePreviousEnd,
        locale,
      );
    return defaultPerformancePeriod;
  }, [
    defaultPerformancePeriod,
    locale,
    performanceComparisonMode,
    performanceCurrentEnd,
    performanceCurrentStart,
    performancePreviousEnd,
    performancePreviousStart,
    state,
  ]);
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
  const performanceBaseRows = useMemo(() => {
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
    return [...performanceExerciseMap.entries()]
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
        const trackingMode =
          exercise.trackingMode ??
          catalogExercise(exercise.exerciseKey)?.trackingMode ??
          "load_reps";
        const comparison = exercisePerformanceComparison(
          sessions,
          state.currentUserId,
          key,
          selectedPerformancePeriod.currentDates,
          selectedPerformancePeriod.previousDates,
          trackingMode,
          selectedPerformancePeriod.inProgress,
        );
        return { key, exercise, comparison };
      });
  }, [
    performanceExerciseMap,
    performanceFilters,
    selectedPerformancePeriod,
    sessions,
    state.currentUserId,
  ]);
  const performanceRows = useMemo(() => {
    const rows = performanceBaseRows;
    const priorityMatches = (row: (typeof rows)[number]) => {
      if (performancePriority === "all") return true;
      if (performancePriority === "gaining")
        return row.comparison.trend === "building";
      if (performancePriority === "steady")
        return row.comparison.trend === "steady";
      if (performancePriority === "focus")
        return row.comparison.trend === "regressing";
      return row.comparison.trend === "learning";
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
      return b.comparison.improvement - a.comparison.improvement;
    });
  }, [
    performanceBaseRows,
    performanceHidden,
    performanceOrder,
    performancePinned,
    performancePriority,
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
    performanceBaseRows
      .filter((row) => !performanceHidden.includes(row.key))
      .forEach((row) => {
        const trend = row.comparison.trend;
        if (trend === "building") counts.gaining += 1;
        else if (trend === "steady") counts.steady += 1;
        else if (trend === "regressing") counts.focus += 1;
        else counts.learning += 1;
      });
    return counts;
  }, [performanceBaseRows, performanceHidden]);
  const performanceHighlights = useMemo(() => {
    const candidates = performanceBaseRows.filter(
      (row) =>
        !performanceHidden.includes(row.key) &&
        row.comparison.currentSessions > 0 &&
        row.comparison.previousSessions > 0,
    );
    return {
      strongest: [...candidates].sort(
        (a, b) => b.comparison.improvement - a.comparison.improvement,
      )[0],
      focus: [...candidates]
        .filter(
          (row) =>
            row.comparison.trend === "regressing" ||
            row.comparison.trend === "steady",
        )
        .sort(
          (a, b) => a.comparison.improvement - b.comparison.improvement,
        )[0],
    };
  }, [performanceBaseRows, performanceHidden]);

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
  const selectPerformanceRange = useCallback((next: PerformanceRange) => {
    setPerformanceRange(next);
    setPerformanceComparisonMode((current) =>
      current === "custom" ? "previous" : current,
    );
    setPerformanceRangePicker(null);
  }, []);
  const sessionsForDate = useMemo(
    () => sessions.filter((session) => session.localDate === localDate),
    [localDate, sessions],
  );
  const selectedSession = sessionsForDate.find(
    (session) => session.id === sessionId,
  );
  const loggedSessionsForDate = useMemo(
    () =>
      sessionsForDate.filter(
        (session) => completedGymSets(session.exercises) > 0,
      ),
    [sessionsForDate],
  );
  const selectedSessionLogged = Boolean(
    selectedSession && completedGymSets(selectedSession.exercises) > 0,
  );
  const savedDayTotals = useMemo(
    () =>
      loggedSessionsForDate.reduce(
        (totals, session) => ({
          durationMinutes: totals.durationMinutes + session.durationMinutes,
          calories: totals.calories + Math.max(0, session.calories ?? 0),
        }),
        { durationMinutes: 0, calories: 0 },
      ),
    [loggedSessionsForDate],
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
  const plannedSetCount = exercises.reduce(
    (total, exercise) => total + exercise.sets.length,
    0,
  );
  const allWorkoutSetsComplete =
    plannedSetCount > 0 &&
    exercises.every((exercise) =>
      exercise.sets.every((set) => set.completed),
    );
  const workoutEditorTitle = selectedSessionLogged
    ? "Logged exercises"
    : completedSets > 0
      ? "Workout in progress"
      : "Exercises to complete";
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
    loadedSavedSessionId.current = session.id;
    setWorkoutTimer(null);
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
    loadedSavedSessionId.current = null;
    setWorkoutTimer(null);
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
    const loadedId = loadedSavedSessionId.current;
    if (!hydrated || !loadedId) return;
    if (sessions.some((session) => session.id === loadedId)) return;
    // A cloud pull or tracker-detail deletion removed the saved source while
    // this screen still had it open. Preserve the visible draft, active timer,
    // and chosen template, but detach the deleted identity so Save cannot
    // silently recreate the removed session.
    loadedSavedSessionId.current = null;
    setSessionId(uniqueId("gym"));
  }, [hydrated, sessions]);

  useEffect(() => {
    if (!hydrated || workoutDraftReady) return;
    if (tutorialSandbox) {
      setWorkoutDraftReady(true);
      return;
    }
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
        const processedWebActionIds = Array.isArray(
          draft.processedWebWorkoutActionIds,
        )
          ? draft.processedWebWorkoutActionIds
              .filter(
                (id): id is string =>
                  typeof id === "string" &&
                  id.length >= 8 &&
                  id.length <= 160 &&
                  /^[A-Za-z0-9_-]+$/.test(id),
              )
              .slice(-60)
          : [];
        for (const webActionId of processedWebActionIds) {
          const id = `web:${webActionId}`;
          processedNativeTimerActionIds.current.add(id);
          processedNativeTimerActionOrder.current.push(id);
        }
        const processedNativeActionIds = Array.isArray(
          draft.processedNativeWorkoutActionIds,
        )
          ? draft.processedNativeWorkoutActionIds
              .filter(
                (id): id is string =>
                  typeof id === "string" && id.length > 0 && id.length <= 640,
              )
              .slice(-60)
          : [];
        for (const id of processedNativeActionIds) {
          processedNativeTimerActionIds.current.add(id);
          processedNativeTimerActionOrder.current.push(id);
        }
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
        setWorkoutTimer({
          ...draft.timer,
          mode:
            draft.timer.mode === "whole_workout"
              ? "whole_workout"
              : "guided",
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setWorkoutDraftReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, state.currentUserId, tutorialSandbox, workoutDraftReady]);

  useEffect(() => {
    if (tutorialSandbox || !workoutDraftReady) return;
    const key = workoutDraftKey(state.currentUserId);
    const persist = () => {
      if (!workoutTimer) return AsyncStorage.removeItem(key);
      const processedWebWorkoutActionIds =
        processedNativeTimerActionOrder.current
          .filter((id) => id.startsWith("web:"))
          .map((id) => id.slice(4))
          .slice(-60);
      const processedNativeWorkoutActionIds =
        processedNativeTimerActionOrder.current
          .filter((id) => !id.startsWith("web:"))
          .slice(-60);
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
        processedWebWorkoutActionIds,
        processedNativeWorkoutActionIds,
      };
      return AsyncStorage.setItem(key, JSON.stringify(draft));
    };
    const persistence = workoutDraftPersistenceRef.current.then(
      persist,
      persist,
    );
    workoutDraftPersistenceRef.current = persistence;
    void persistence.catch(() => undefined);
  }, [
    calorieCalculationMode,
    calories,
    duration,
    exercises,
    intensity,
    localDate,
    pendingWebTimerActionAcks,
    pendingNativeTimerActionAcks,
    selectedPlanId,
    sessionId,
    sessionName,
    sessionNotes,
    setStartDelaySeconds,
    state.currentUserId,
    tutorialSandbox,
    visibility,
    webTimerActionAckRetry,
    workoutDraftReady,
    workoutTimer,
  ]);

  useFocusEffect(
    useCallback(() => {
    // Native timestamps and the workout notification remain authoritative while
    // this tab is offscreen; only the visible one-second display ticker pauses.
    if (!workoutTimer || workoutTimer.phase === "paused") return;
    setTimerNow(Date.now());
    const timer = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(timer);
    }, [workoutTimer]),
  );

  useEffect(() => {
    if (tutorialSandbox || Platform.OS === "web") return;
    const handle = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.workoutTimer !== true)
        return;
      // Android notification actions are committed by the native receiver;
      // consume that single persisted queue instead of applying the response
      // object separately and advancing twice.
      if (
        Platform.OS === "android" &&
        (response.actionIdentifier === WORKOUT_TIMER_NEXT ||
          response.actionIdentifier === WORKOUT_TIMER_PAUSE ||
          response.actionIdentifier === WORKOUT_TIMER_FINISH)
      ) {
        // Native handles the lock-screen row synchronously. If React is still
        // alive (including a Wear action while the app is foreground), consume
        // its persisted action now; the AppState replay remains a race-safe
        // fallback when Android wakes the app later.
        if (nativeWorkoutActionsEnabled())
          void consumeWorkoutTimerActions(state.currentUserId).then(
            enqueueNativeTimerActions,
          );
        void Notifications.clearLastNotificationResponseAsync();
        return;
      }
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
  }, [enqueueNativeTimerActions, state.currentUserId, tutorialSandbox]);

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
    // Prepare the Android channel, action categories, and background handler
    // while React is fully active. Waiting until the screen-lock AppState event
    // leaves some OEMs too little time before JS is suspended.
    if (!tutorialSandbox)
      void configureWorkoutTimerNotification().catch(() => undefined);
    const now = Date.now();
    setDuration("");
    setTimerNow(now);
    setWorkoutTimer({
      mode: configuredTimerMode,
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
    if (workoutTimer?.phase === "paused") resumeWorkout(occurredAt);
    else pauseWorkout(occurredAt);
  }

  function pauseWorkout(occurredAt = Date.now()) {
    const now = occurredAt;
    setTimerNow(now);
    setWorkoutTimer((current) => {
      if (!current || current.phase === "paused") return current;
      return {
        ...current,
        phase: "paused",
        resumePhase: current.phase,
        phaseElapsedSeconds: timerPhaseElapsed(current, now),
        phaseStartedAt: now,
        pauseStartedAt: now,
      };
    });
  }

  function resumeWorkout(occurredAt = Date.now()) {
    const now = occurredAt;
    setTimerNow(now);
    setWorkoutTimer((current) => {
      if (!current || current.phase !== "paused") return current;
      return {
        ...current,
        phase: current.resumePhase ?? "work",
        resumePhase: undefined,
        phaseStartedAt: now,
        pausedSeconds:
          current.pausedSeconds +
          Math.max(
            0,
            Math.floor((now - (current.pauseStartedAt ?? now)) / 1000),
          ),
        pauseStartedAt: undefined,
      };
    });
  }

  function toggleSet(exerciseId: string, set: GymSet) {
    if (workoutTimer && workoutTimer.mode !== "whole_workout") {
      if (
        workoutTimer.phase === "work" &&
        workoutTimer.exerciseId === exerciseId &&
        workoutTimer.setId === set.id
      )
        advanceWorkoutTimer();
      return;
    }
    const exercise = exercises.find((item) => item.id === exerciseId);
    if (
      !set.completed &&
      (exercise?.exerciseKey === "back_squat" ||
        exercise?.name.toLocaleLowerCase().includes("squat"))
    ) {
      tutorial.reportEvent({
        actionId: "tutorial.workout.complete-set",
        scope: "isolated-preview",
      });
    }
    updateSet(exerciseId, set.id, { completed: !set.completed });
  }

  function finishExercise(exercise: GymExercise) {
    if (workoutTimer && workoutTimer.mode !== "whole_workout") return;
    patchExercise(exercise.id, { completed: true });
    setOpenExerciseId(null);
  }

  function completeAllSets() {
    if (workoutTimer && workoutTimer.mode !== "whole_workout") return;
    setExercises((current) => completeGymWorkout(current));
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
    if (
      workoutTimer?.mode !== "whole_workout" &&
      workoutTimer?.exerciseId === exercise.id
    ) {
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
      workoutTimer?.mode !== "whole_workout" &&
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
    Alert.alert(
      sessionCompletedSets ? "Workout saved" : "Day planned",
      sessionCompletedSets
        ? `${sessionCompletedSets} sets · ${Math.round(sessionVolume).toLocaleString(locale)} kg volume · ${formatGymDuration(sessionTime.exerciseSeconds)} exercise · ${formatGymDuration(sessionTime.setRestSeconds)} set rest · ${formatGymDuration(sessionTime.exerciseRestSeconds)} between exercises · ~${sessionCalories} active kcal`
        : "The exercise plan is saved without marking the workout complete.",
    );
  }

  function advanceWorkoutTimer(occurredAt = Date.now()) {
    if (!workoutTimer) return;
    if (workoutTimer.mode === "whole_workout") return;
    if (workoutTimer.phase === "paused") {
      // A notification/watch action may be replayed well after the tap. Keep
      // the pause duration anchored to that native action timestamp.
      pauseOrResumeWorkout(occurredAt);
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
      workoutTimer.mode === "whole_workout"
        ? exercises
        : phaseSeconds > 0
          ? recordTimerPhase(exercises, workoutTimer, phaseSeconds)
          : exercises;
    const sessionElapsedSeconds =
      workoutTimer.mode === "whole_workout"
        ? timerSessionElapsed(workoutTimer, now)
        : workoutTimer.completedElapsedSeconds + phaseSeconds;
    persistSession(
      nextExercises,
      sessionElapsedSeconds / 60,
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
      : workoutTimer?.mode === "whole_workout"
        ? "Whole workout"
        : workoutTimer?.phase === "work"
          ? `${timerExercise ? localizeExerciseName(language, timerExercise) : "Exercise"} · Set ${timerSetIndex + 1}/${timerExercise?.sets.length ?? 0}`
          : workoutTimer?.phase === "set_rest"
            ? `Set rest · next is set ${timerNextTarget ? timerNextTarget.exercise.sets.findIndex((set) => set.id === timerNextTarget.set.id) + 1 : ""}`
            : `Between exercises · next is ${timerNextTarget ? localizeExerciseName(language, timerNextTarget.exercise) : "finish"}`;
  const timerNextLabel =
    workoutTimer?.mode === "whole_workout"
      ? "Finish when you're done"
      : workoutTimer?.phase === "paused"
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
    () => {
      if (!workoutTimer) return [];
      if (workoutTimer.mode === "whole_workout")
        return [
          {
            title: t("Whole workout"),
            body: t("Finish when you're done"),
            phase: "work" as const,
          },
        ];
      return workoutNotificationSteps(exercises, workoutTimer, language, t);
    },
    [exercises, language, t, workoutTimer],
  );
  timerActionRef.current = (action, occurredAt) => {
    if (action === WORKOUT_TIMER_PAUSE) {
      if (Platform.OS === "web") pauseWorkout(occurredAt ?? Date.now());
      else pauseOrResumeWorkout(occurredAt ?? Date.now());
    } else if (action === WORKOUT_TIMER_RESUME)
      resumeWorkout(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_NEXT)
      advanceWorkoutTimer(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_FINISH)
      finishTimedWorkout(occurredAt ?? Date.now());
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !webNotificationAction) return;
    if (!workoutDraftReady) return;
    const supported = [
      WORKOUT_TIMER_NEXT,
      WORKOUT_TIMER_PAUSE,
      WORKOUT_TIMER_RESUME,
    ];
    if (!supported.includes(webNotificationAction)) {
      router.replace("/gym" as never);
      return;
    }
    const actionKey = `${webNotificationAction}:${webNotificationActionAt ?? ""}`;
    if (handledWebTimerAction.current === actionKey) return;
    handledWebTimerAction.current = actionKey;
    if (workoutTimer) {
      const receivedAt = Number(webNotificationActionAt);
      const now = Date.now();
      const occurredAt =
        Number.isFinite(receivedAt) &&
        receivedAt >= now - 5 * 60_000 &&
        receivedAt <= now + 60_000
          ? receivedAt
          : now;
      timerActionRef.current(webNotificationAction, occurredAt);
    }
    // Remove the one-shot action so refresh/back cannot replay it. Replacing
    // this same route preserves the hydrated workout draft and visible mode.
    router.replace("/gym" as never);
  }, [
    webNotificationAction,
    webNotificationActionAt,
    workoutDraftReady,
    workoutTimer,
  ]);

  useEffect(() => {
    const next = queuedNativeTimerActions[0];
    if (!next || !workoutDraftReady) return;
    const id = queuedWorkoutTimerActionId(next);
    if (!workoutTimer || processedNativeTimerActionIds.current.has(id)) {
      setQueuedNativeTimerActions((current) =>
        current[0] && queuedWorkoutTimerActionId(current[0]) === id
          ? current.slice(1)
          : current.filter(
              (item) => queuedWorkoutTimerActionId(item) !== id,
            ),
      );
      queueWebTimerActionAck(next);
      queueNativeTimerActionAck(next);
      return;
    }

    processedNativeTimerActionIds.current.add(id);
    processedNativeTimerActionOrder.current.push(id);
    if (processedNativeTimerActionOrder.current.length > 60) {
      const expired = processedNativeTimerActionOrder.current.shift();
      if (expired) processedNativeTimerActionIds.current.delete(expired);
    }
    // Apply exactly one notification transition in this committed render. Removing
    // it from the queue is batched with the timer/exercise state updates, so
    // the next effect observes the newly committed workout phase rather than
    // relying on a timing delay that can fail on a large account.
    timerActionRef.current(next.action, next.occurredAt);
    setQueuedNativeTimerActions((current) =>
      current[0] && queuedWorkoutTimerActionId(current[0]) === id
        ? current.slice(1)
        : current.filter(
            (item) => queuedWorkoutTimerActionId(item) !== id,
          ),
    );
    queueWebTimerActionAck(next);
    queueNativeTimerActionAck(next);
  }, [
    queueNativeTimerActionAck,
    queueWebTimerActionAck,
    queuedNativeTimerActions,
    workoutDraftReady,
    workoutTimer,
  ]);

  useEffect(() => {
    if (
      Platform.OS !== "android" ||
      tutorialSandbox ||
      !pendingNativeTimerActionAcks.length
    )
      return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const next = pendingNativeTimerActionAcks[0];
    const id = queuedWorkoutTimerActionId(next);
    const durability =
      next.action === WORKOUT_TIMER_FINISH
        ? flushLocalPersistence()
        : workoutDraftPersistenceRef.current;
    void acknowledgeWorkoutActionsAfterPersistence(durability, async () => {
      await acknowledgeNativeWorkoutTimerAction(next);
    })
      .then(() => {
        if (!active) return;
        nativeTimerActionAckAttempt.current = 0;
        setPendingNativeTimerActionAcks((current) =>
          current.filter(
            (item) => queuedWorkoutTimerActionId(item) !== id,
          ),
        );
      })
      .catch(() => {
        if (!active) return;
        const delay = webWorkoutActionAckRetryDelay(
          nativeTimerActionAckAttempt.current,
        );
        nativeTimerActionAckAttempt.current += 1;
        retryTimer = setTimeout(
          () => setNativeTimerActionAckRetry((value) => value + 1),
          delay,
        );
      });
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    flushLocalPersistence,
    nativeTimerActionAckRetry,
    pendingNativeTimerActionAcks,
    tutorialSandbox,
  ]);

  useEffect(() => {
    if (Platform.OS !== "web" || !pendingWebTimerActionAcks.length) return;
    let active = true;
    const pending = pendingWebTimerActionAcks;
    const pendingIds = new Set(
      pending
        .map((action) => action.webActionId)
        .filter((id): id is string => Boolean(id)),
    );
    let retryTimer: number | undefined;
    const retryNow = () => setWebTimerActionAckRetry((value) => value + 1);
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", retryWhenVisible);
    void acknowledgeWorkoutActionsAfterPersistence(
      workoutDraftPersistenceRef.current,
      () =>
        active
          ? acknowledgeWebWorkoutTimerActions(state.currentUserId, pending)
          : Promise.resolve(),
    )
      .then(() => {
        if (!active) return;
        webTimerActionAckAttempt.current = 0;
        setPendingWebTimerActionAcks((current) =>
          current.filter(
            (action) =>
              !action.webActionId || !pendingIds.has(action.webActionId),
          ),
        );
      })
      .catch(() => {
        if (!active) return;
        const delay = webWorkoutActionAckRetryDelay(
          webTimerActionAckAttempt.current,
        );
        webTimerActionAckAttempt.current += 1;
        retryTimer = window.setTimeout(retryNow, delay);
      });
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [
    pendingWebTimerActionAcks,
    state.currentUserId,
    webTimerActionAckRetry,
  ]);

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
        allowProgression: workoutTimer.mode !== "whole_workout",
      }
    : null;

  useEffect(() => {
    if (tutorialSandbox) return;
    const handleActivity = (next: typeof appActivity) => {
      setAppActivity(next);
      // Android can suspend React before the state-driven effect commits when
      // the screen locks. Start this request directly from AppState as the
      // pre-suspend fallback; workoutTimer.ts revision-coalesces the duplicate
      // inactive/background/effect calls into one final Expo post.
      if (next === "active") {
        void dismissWorkoutTimerNotification(state.currentUserId);
        return;
      }
      const payload = notificationPayloadRef.current;
      if (payload && state.settings.notifications.pushEnabled)
        void showWorkoutTimerNotification({
          ...payload,
          ownerId: state.currentUserId,
        }).catch(() => undefined);
    };
    const subscription = NativeAppState.addEventListener(
      "change",
      handleActivity,
    );
    return () => subscription.remove();
  }, [
    state.currentUserId,
    state.settings.notifications.pushEnabled,
    tutorialSandbox,
  ]);

  useEffect(() => {
    if (Platform.OS !== "web" || tutorialSandbox) return;
    const syncWebWorkoutNotification = () => {
      const payload = notificationPayloadRef.current;
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible" ||
        !payload ||
        !state.settings.notifications.pushEnabled
      ) {
        void dismissWorkoutTimerNotification(state.currentUserId);
        return;
      }
      void showWorkoutTimerNotification({
        ...payload,
        ownerId: state.currentUserId,
      }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", syncWebWorkoutNotification);
    syncWebWorkoutNotification();
    return () => {
      document.removeEventListener(
        "visibilitychange",
        syncWebWorkoutNotification,
      );
    };
  }, [
    state.currentUserId,
    state.settings.notifications.pushEnabled,
    tutorialSandbox,
    workoutTimer?.exerciseId,
    workoutTimer?.phase,
    workoutTimer?.phaseStartedAt,
    workoutTimer?.mode,
    workoutTimer?.setId,
  ]);

  useEffect(() => {
    if (
      tutorialSandbox ||
      !workoutDraftReady ||
      !workoutTimer ||
      appActivity !== "active"
    )
      return;
    void consumeWorkoutTimerActions(state.currentUserId).then(
      enqueueNativeTimerActions,
    );
  }, [
    appActivity,
    enqueueNativeTimerActions,
    state.currentUserId,
    workoutDraftReady,
    workoutTimer,
    tutorialSandbox,
  ]);

  useEffect(() => {
    if (tutorialSandbox || !workoutDraftReady) return;
    if (!workoutTimer) {
      void dismissWorkoutTimerNotification(state.currentUserId, true);
      return;
    }
    if (appActivity === "active") {
      void dismissWorkoutTimerNotification(state.currentUserId);
      return;
    }
    if (!state.settings.notifications.pushEnabled) {
      void dismissWorkoutTimerNotification(state.currentUserId);
      return;
    }
    void showWorkoutTimerNotification({
      title: t(timerHeading),
      body:
        workoutTimer.mode === "whole_workout"
          ? t("Finish when you're done")
          : t(`${timerNextLabel} · open HabHub to adjust kg or reps`),
      phase:
        workoutTimer.phase === "work"
          ? "work"
          : workoutTimer.phase === "paused"
            ? "paused"
            : "rest",
      steps: notificationSteps,
      phaseStartedAt: workoutTimer.phaseStartedAt,
      phaseElapsedSeconds: workoutTimer.phaseElapsedSeconds,
      allowProgression: workoutTimer.mode !== "whole_workout",
      ownerId: state.currentUserId,
    }).catch(() => undefined);
  }, [
    appActivity,
    notificationSteps,
    t,
    timerHeading,
    timerNextLabel,
    workoutTimer?.exerciseId,
    state.currentUserId,
    state.settings.notifications.pushEnabled,
    workoutTimer?.phase,
    workoutTimer?.mode,
    workoutTimer?.setId,
    workoutTimer,
    workoutDraftReady,
    tutorialSandbox,
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
      {workoutTimer.mode !== "whole_workout" ? (
        <Pressable
          onPress={() => advanceWorkoutTimer()}
          style={[styles.timerNext, { backgroundColor: timerColor }]}
        >
          <Text style={styles.timerNextText}>{timerNextLabel}</Text>
          <Ionicons name="chevron-forward" size={15} color={palette.ink} />
        </Pressable>
      ) : null}
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
            <View style={styles.headerTools}>
              {gymReminderMetric ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("Reminders")}: ${gymReminderMetric.name}`}
                  onPress={openGymReminders}
                  style={({ pressed }) => [
                    styles.reminderShortcut,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                    pressed && styles.modeChoicePressed,
                  ]}
                >
                  <Ionicons name="alarm-outline" size={15} color={accent} />
                </Pressable>
              ) : null}
            </View>
          }
        />
        <TutorialTarget id="workout-modes">
        <View
          accessibilityRole="tablist"
          style={[
            styles.modeSegment,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {(["workout", "progress", "performance"] as const).map(
            (item) => {
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
            },
          )}
        </View>
        </TutorialTarget>

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
                    {selectedSessionLogged
                      ? `${loggedSessionsForDate.length} logged workout${loggedSessionsForDate.length === 1 ? "" : "s"} · reviewing a logged session`
                      : selectedSession
                        ? "Continue your saved workout plan"
                        : loggedSessionsForDate.length
                          ? `Plan the next workout · ${loggedSessionsForDate.length} already logged today`
                        : "Plan today's workout · seeded from your active template"}
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
              {loggedSessionsForDate.length ? (
                <View
                  style={[
                    styles.sessionPicker,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.sessionPickerHeader}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        loggedTodayCollapsed
                          ? "Show logged workouts"
                          : "Hide logged workouts",
                      )}
                      accessibilityState={{ expanded: !loggedTodayCollapsed }}
                      onPress={() =>
                        updateSettings({
                          gymLoggedTodayCollapsed: !loggedTodayCollapsed,
                        })
                      }
                      style={styles.loggedTodayHeading}
                    >
                      <View
                        style={[
                          styles.loggedTodayIcon,
                          { backgroundColor: `${palette.lime}1F` },
                        ]}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={16}
                          color={palette.lime}
                        />
                      </View>
                      <View style={styles.grow}>
                      <View style={styles.loggedTodayTitleRow}>
                        <Text style={[styles.loggedTodayTitle, { color: colors.ink }]}>Logged today</Text>
                        <View
                          style={[
                            styles.loggedCount,
                            { backgroundColor: `${palette.lime}1F` },
                          ]}
                        >
                          <Text style={[styles.loggedCountText, { color: palette.lime }]}>
                            {loggedSessionsForDate.length}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.sessionChoiceMeta, { color: colors.muted }]}>
                        {`${Math.round(savedDayTotals.durationMinutes * 10) / 10} min · ~${Math.round(savedDayTotals.calories)} active kcal total`}
                      </Text>
                      </View>
                      <Ionicons
                        name={
                          loggedTodayCollapsed
                            ? "chevron-down"
                            : "chevron-up"
                        }
                        size={15}
                        color={colors.muted}
                      />
                    </Pressable>
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
                  {!loggedTodayCollapsed ? (
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.sessionChoices}
                    >
                      {loggedSessionsForDate.map((session, index) => {
                      const selected = session.id === selectedSession?.id;
                      const logged = completedGymSets(session.exercises) > 0;
                      const clock = gymSessionClockBounds(session);
                      const time = clock.completedAt
                        ? formatClockTime(
                            clock.completedAt,
                            state.settings.timeFormat,
                            locale,
                          )
                        : `#${loggedSessionsForDate.length - index}`;
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
                          <View style={styles.sessionChoiceTop}>
                            <Ionicons
                              name={logged ? "checkmark-circle" : "document-outline"}
                              size={13}
                              color={logged ? palette.lime : colors.muted}
                            />
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
                                styles.sessionChoiceStatus,
                                { color: logged ? palette.lime : colors.muted },
                              ]}
                            >
                              {logged ? "Logged" : "Draft"}
                            </Text>
                          </View>
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
                  ) : null}
                </View>
              ) : null}
              <TutorialTarget id="workout-session-details">
              <Pressable
                onPress={() => setSessionDetailsOpen((value) => !value)}
                style={[
                  styles.detailsToggle,
                  {
                    borderColor: selectedSessionLogged ? `${palette.lime}55` : colors.border,
                    backgroundColor: selectedSessionLogged ? `${palette.lime}08` : "transparent",
                  },
                ]}
              >
                <View
                  style={[
                    styles.workoutStatusIcon,
                    {
                      backgroundColor: selectedSessionLogged
                        ? `${palette.lime}1F`
                        : colors.primarySoft,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      selectedSessionLogged ? "checkmark-done" : "barbell-outline"
                    }
                    size={15}
                    color={selectedSessionLogged ? palette.lime : accent}
                  />
                </View>
                <View style={styles.grow}>
                  <Text style={[styles.workoutStatusTitle, { color: colors.ink }]}>
                    {selectedSessionLogged ? "Workout logged" : "Plan & log workout"}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {sessionName || "Workout"} · {completedSets} sets · {inferredDuration} min · ~{estimatedCalories} active kcal
                  </Text>
                </View>
                <Ionicons
                  name={sessionDetailsOpen ? "chevron-up" : "options-outline"}
                  size={18}
                  color={accent}
                />
              </Pressable>
              </TutorialTarget>
              {sessionDetailsOpen ? (
                <>
              {plans.length ? (
                <TutorialTarget id="workout-templates">
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
                          if (
                            plan.name.trim().toLocaleLowerCase() ===
                            "full-body strength"
                          ) {
                            tutorial.reportEvent({
                              actionId: "tutorial.workout.choose-template",
                              scope: "isolated-preview",
                            });
                          }
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
                </TutorialTarget>
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
              <TutorialTarget id="workout-guided-timer">
              <Card style={styles.guidedTimerCard}>
                <View style={styles.timerStartRow}>
                  <Pressable
                    accessibilityLabel="Workout timer"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: timerSettingsOpen }}
                    onPress={() => setTimerSettingsOpen((open) => !open)}
                    style={styles.timerSettingsToggle}
                  >
                    <View style={styles.grow}>
                      <Text style={[styles.exerciseName, { color: colors.ink }]}>
                        Workout timer
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {configuredTimerMode === "guided"
                          ? "Sets & rests · Next advances the workout."
                          : "Whole workout · mark sets manually."}
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
                      styles.timerSettingsBody,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.timerModeSetting}>
                      <Text style={[styles.label, { color: colors.ink }]}>Timer progression</Text>
                      <View style={styles.timerModeChoices}>
                        <Chip
                          label="Sets & rests"
                          size="small"
                          selected={configuredTimerMode === "guided"}
                          onPress={() =>
                            updateSettings({ gymTimerMode: "guided" })
                          }
                        />
                        <Chip
                          label="Whole workout"
                          size="small"
                          selected={configuredTimerMode === "whole_workout"}
                          onPress={() =>
                            updateSettings({ gymTimerMode: "whole_workout" })
                          }
                        />
                      </View>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {configuredTimerMode === "guided"
                          ? "Next moves through each set and rest."
                          : "One Start/Pause/Finish timer; mark sets manually."}
                      </Text>
                    </View>
                    {configuredTimerMode === "guided" ? (
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
                  </View>
                ) : null}
              </Card>
              </TutorialTarget>
            ) : null}

            <SectionHeader
              title={workoutEditorTitle}
              action={
                exerciseEditMode ? (
                  <Pressable
                    onPress={() => setExerciseEditMode(false)}
                    style={[styles.exerciseDone, { backgroundColor: accent }]}
                  >
                    <Text style={styles.exerciseDoneText}>Done</Text>
                  </Pressable>
                ) : (
                  <View style={styles.summaryActions}>
                    <Text style={[styles.summary, { color: accent }]}>
                      {completedSets} sets · {Math.round(volume).toLocaleString(locale)} kg
                    </Text>
                    {plannedSetCount > 0 &&
                    !allWorkoutSetsComplete &&
                    (!workoutTimer || workoutTimer.mode === "whole_workout") ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Complete all workout sets"
                        onPress={completeAllSets}
                        style={[
                          styles.completeAll,
                          {
                            borderColor: accent,
                            backgroundColor: colors.primarySoft,
                          },
                        ]}
                      >
                        <Ionicons name="checkmark-done" size={13} color={accent} />
                        <Text style={[styles.completeAllText, { color: accent }]}>Complete all</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
                            {exerciseIndex === 0 && setIndex === 0 ? (
                              <TutorialTarget id="workout-exercises">
                                <Pressable onPress={() => toggleSet(exercise.id, set)}>
                                  <Ionicons
                                    name={set.completed ? "checkmark-circle" : "ellipse-outline"}
                                    size={25}
                                    color={set.completed ? palette.lime : colors.faint}
                                  />
                                </Pressable>
                              </TutorialTarget>
                            ) : (
                              <Pressable onPress={() => toggleSet(exercise.id, set)}>
                                <Ionicons
                                  name={set.completed ? "checkmark-circle" : "ellipse-outline"}
                                  size={25}
                                  color={set.completed ? palette.lime : colors.faint}
                                />
                              </Pressable>
                            )}
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
                      Between{" "}
                      <Text translate={false} style={styles.restNoteText}>
                        {localizeExerciseName(language, exercise)}
                      </Text>{" "}
                      and{" "}
                      <Text translate={false} style={styles.restNoteText}>
                        {exercises[exerciseIndex + 1]
                          ? localizeExerciseName(
                              language,
                              exercises[exerciseIndex + 1],
                            )
                          : ""}
                      </Text>
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
                <TutorialTarget id="workout-save">
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
                      label={selectedSession ? "Update workout" : "Save workout"}
                      icon="checkmark"
                      size="small"
                      onPress={saveDay}
                    />
                  </View>
                </View>
                </TutorialTarget>
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
                {GYM_PERFORMANCE_RANGES.map(({ id, label }) => (
                  <Pressable
                    key={id}
                    onPress={() => selectPerformanceRange(id)}
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
              <SelectionMenu
                title="Compare with"
                items={GYM_COMPARISON_OPTIONS}
                selectedIds={[performanceComparisonMode]}
                multiple={false}
                searchable={false}
                onChange={(ids) => {
                  const next = ids[0] as
                    | "previous"
                    | "overall"
                    | "custom"
                    | undefined;
                  if (!next) return;
                  setPerformanceComparisonMode(next);
                  setPerformanceRangePicker(null);
                }}
              />
              {performanceComparisonMode === "custom" ? (
                <View style={styles.customRanges}>
                  <View style={styles.customDateRow}>
                    {(
                      [
                        [
                          "current",
                          "Range A",
                          performanceCurrentStart,
                          performanceCurrentEnd,
                        ],
                        [
                          "previous",
                          "Range B",
                          performancePreviousStart,
                          performancePreviousEnd,
                        ],
                      ] as const
                    ).map(([id, label, start, end]) => (
                      <Pressable
                        key={id}
                        onPress={() => {
                          setPerformanceRangePicker(id);
                          setPerformanceRangePickerStep("start");
                        }}
                        style={[
                          styles.customDate,
                          {
                            borderColor:
                              performanceRangePicker === id
                                ? accent
                                : colors.border,
                            backgroundColor: colors.canvas,
                          },
                        ]}
                      >
                        <Text style={[styles.customDateLabel, { color: accent }]}>
                          {label}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.customDateValue, { color: colors.ink }]}
                        >
                          {friendlyDate(start)} – {friendlyDate(end)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {performanceRangePicker ? (
                    <>
                      <Text style={[styles.performancePickerHelp, { color: colors.muted }]}>
                        Select {performanceRangePicker === "current" ? "Range A" : "Range B"}{" "}
                        {performanceRangePickerStep === "start" ? "start" : "end"} date
                      </Text>
                      <MonthCalendar
                        monthDate={
                          performanceRangePicker === "current"
                            ? performanceCurrentEnd
                            : performancePreviousEnd
                        }
                        selectedDate={
                          performanceRangePicker === "current"
                            ? performanceRangePickerStep === "start"
                              ? performanceCurrentStart
                              : performanceCurrentEnd
                            : performanceRangePickerStep === "start"
                              ? performancePreviousStart
                              : performancePreviousEnd
                        }
                        rangeStart={
                          performanceRangePicker === "current"
                            ? performanceCurrentStart
                            : performancePreviousStart
                        }
                        rangeEnd={
                          performanceRangePicker === "current"
                            ? performanceCurrentEnd
                            : performancePreviousEnd
                        }
                        rangeAccent={accent}
                        onSelect={(date) => {
                          if (performanceRangePicker === "current") {
                            if (performanceRangePickerStep === "start") {
                              setPerformanceCurrentStart(date);
                              setPerformanceCurrentEnd(date);
                              setPerformanceRangePickerStep("end");
                            } else {
                              if (date < performanceCurrentStart) {
                                setPerformanceCurrentEnd(performanceCurrentStart);
                                setPerformanceCurrentStart(date);
                              } else {
                                setPerformanceCurrentEnd(date);
                              }
                              setPerformanceRangePicker(null);
                            }
                          } else if (performanceRangePickerStep === "start") {
                            setPerformancePreviousStart(date);
                            setPerformancePreviousEnd(date);
                            setPerformanceRangePickerStep("end");
                          } else {
                            if (date < performancePreviousStart) {
                              setPerformancePreviousEnd(performancePreviousStart);
                              setPerformancePreviousStart(date);
                            } else {
                              setPerformancePreviousEnd(date);
                            }
                            setPerformanceRangePicker(null);
                          }
                        }}
                      />
                    </>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.performancePeriodLine}>
                <Ionicons name="swap-horizontal-outline" size={13} color={accent} />
                <Text
                  numberOfLines={2}
                  style={[styles.performancePeriodText, { color: colors.muted }]}
                >
                  {selectedPerformancePeriod.currentLabel} vs {selectedPerformancePeriod.previousLabel}
                </Text>
              </View>
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
                        {localizeExerciseName(language, performanceHighlights.strongest.exercise)} · {Math.round(performanceHighlights.strongest.comparison.improvement)}%
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
                row.comparison.trend === "building"
                  ? palette.lime
                  : row.comparison.trend === "regressing"
                    ? palette.red
                    : row.comparison.trend === "steady"
                      ? palette.amber
                      : colors.muted;
              const comparisonText = row.comparison.provisional
                ? `${selectedPerformancePeriod.currentLabel} is still in progress; the downward comparison is withheld.`
                : !row.comparison.currentSessions
                  ? `No workout data in ${selectedPerformancePeriod.currentLabel}.`
                  : !row.comparison.previousSessions
                    ? `No comparable workout data in ${selectedPerformancePeriod.previousLabel}.`
                    : `${row.comparison.improvement >= 0 ? "+" : ""}${Math.round(row.comparison.improvement)}% vs ${selectedPerformancePeriod.previousLabel} · ${row.comparison.trend}`;
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
                        <Text translate={false} style={[styles.meta, { color: colors.muted }]}>
                          {row.comparison.currentSessions} {t("sessions")}
                          {row.comparison.currentSessions
                            ? ` · ${gymPerformanceScoreText(row.comparison, locale)} · ${Math.round(row.comparison.currentVolumeKg).toLocaleString(locale)} ${t("kg volume")}`
                            : ""}
                        </Text>
                        <Text style={[styles.performanceSignal, { color: trendColor }]}>
                          {comparisonText}
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
              style={[styles.search, { color: colors.ink, borderColor: colors.border }]}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pickerCategoryScroller}
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
  timerSettingsBody: { borderTopWidth: 1, paddingTop: 7, gap: 7 },
  timerModeSetting: { gap: 5 },
  timerModeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  timerAdjustment: {
    minHeight: 44,
    borderTopWidth: 1,
    paddingTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTools: { flexDirection: "row", alignItems: "center", gap: 4 },
  reminderShortcut: {
    width: 30,
    height: 34,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modeSegment: {
    width: "100%",
    height: 34,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 11,
    padding: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  modeChoice: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 4,
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
  loggedTodayHeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  loggedTodayIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  loggedTodayTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  loggedTodayTitle: { fontSize: 10, fontWeight: "900" },
  loggedCount: {
    minWidth: 19,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  loggedCountText: { fontSize: 7, fontWeight: "900" },
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
  sessionChoiceTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sessionChoiceName: { flex: 1, minWidth: 0, fontSize: 9, fontWeight: "900" },
  sessionChoiceStatus: { marginLeft: "auto", fontSize: 6, fontWeight: "900" },
  sessionChoiceMeta: { fontSize: 7, lineHeight: 10, marginTop: 2 },
  workoutStatusIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  workoutStatusTitle: { fontSize: 10, fontWeight: "900" },
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
  summaryActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  completeAll: {
    minHeight: 26,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  completeAllText: { fontSize: 7, fontWeight: "900" },
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
  customRanges: { gap: 7 },
  customDateRow: { flexDirection: "row", gap: 7 },
  customDate: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 7 },
  customDateLabel: { fontSize: 6, fontWeight: "900", textTransform: "uppercase" },
  customDateValue: { fontSize: 9, fontWeight: "900", marginTop: 2 },
  performancePickerHelp: {
    fontSize: 8,
    fontWeight: "800",
    textAlign: "center",
  },
  performancePeriodLine: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  performancePeriodText: { flex: 1, fontSize: 8, lineHeight: 11, fontWeight: "800" },
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
  pickerCategoryScroller: { flexGrow: 0, minHeight: 40, maxHeight: 40 },
  pickerCategories: {
    minHeight: 40,
    alignItems: "center",
    columnGap: 5,
    paddingRight: 8,
    paddingVertical: 2,
  },
  pickerMuscles: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 5,
    rowGap: 6,
    paddingVertical: 2,
  },
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
