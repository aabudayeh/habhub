import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState as NativeAppState,
  BackHandler,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { DraftNumberInput } from "@/src/components/DraftNumberInput";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { Button, Card, Chip, PageHeader, ProgressBar, Screen, SectionHeader } from "@/src/components/ui";
import { dateKey, dateWithOffsetFrom, friendlyDate } from "@/src/domain/date";
import {
  EXERCISE_CATALOG,
  ExerciseCatalogItem,
  MUSCLE_LABELS,
  exerciseKey,
} from "@/src/domain/exerciseCatalog";
import {
  completedGymSets,
  averageGymRestSeconds,
  estimateGymActiveCalories,
  exerciseHistory,
  exerciseIdentity,
  exerciseTrend,
  formatGymDuration,
  gymRestBreakdown,
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
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  GymExercise,
  GymIntensity,
  GymPlan,
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
    steps.push({
      title: `${exercise.name} · Set ${setIndex + 1}/${exercise.sets.length}`,
      body: `${set.weightKg || 0} kg × ${set.reps} reps · use Next when the set is done`,
      phase: "work",
    });
  };
  const appendExercise = (
    exercise: GymExercise,
    pendingSets: GymSet[],
    betweenExercises: boolean,
  ) => {
    if (!pendingSets.length) return;
    if (betweenExercises)
      steps.push({
        title: `Between exercises · next ${exercise.name}`,
        body: "REST · use Next when you are ready to start",
        phase: "rest",
      });
    pendingSets.forEach((set, index) => {
      if (index > 0)
        steps.push({
          title: `${exercise.name} · set rest`,
          body: `REST · next is set ${exercise.sets.findIndex((item) => item.id === set.id) + 1}`,
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
      addWork(currentExercise, nextSet);
      appendExercise(currentExercise, pending.slice(1), false);
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
      body: `${steps[steps.length - 1].body} · finish the workout in MetricRally`,
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
    notes: previous?.notes,
    completed: false,
    sets: previous?.sets.length
      ? previous.sets.map((set) => ({ ...set, id: uniqueId("set"), completed: false }))
      : [blankSet()],
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
      restSeconds: preserveCompletion ? set.restSeconds : undefined,
      restTargetSeconds: preserveCompletion ? set.restTargetSeconds : undefined,
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

function GymDragHandle({
  index,
  count,
  color,
  onMove,
}: {
  index: number;
  count: number;
  color: string;
  onMove: (target: number) => void;
}) {
  const origin = useRef(index);
  const lastTarget = useRef(index);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          origin.current = index;
          lastTarget.current = index;
        },
        onPanResponderMove: (_, gesture) => {
          const target = Math.max(
            0,
            Math.min(count - 1, origin.current + Math.round(gesture.dy / 64)),
          );
          if (target === lastTarget.current) return;
          lastTarget.current = target;
          onMove(target);
        },
      }),
    [count, index, onMove],
  );

  return (
    <View
      {...pan.panHandlers}
      style={styles.exerciseDragHandle}
      hitSlop={8}
    >
      <Ionicons name="reorder-three" size={23} color={color} />
    </View>
  );
}

export default function GymScreen() {
  const {
    state,
    saveGymPlan,
    deleteGymPlan,
    saveGroupGymPlan,
    deleteGroupGymPlan,
    saveGymSession,
    deleteGymSession,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const scrollRef = useRef<ScrollView>(null);
  const targetOffsets = useRef<Record<string, number>>({});
  const [localDate, setLocalDate] = useState(dateKey());
  const [mode, setMode] = useState<"workout" | "progress">("workout");
  const [sessionId, setSessionId] = useState(() => uniqueId("gym"));
  const [sessionName, setSessionName] = useState("Gym day");
  const [duration, setDuration] = useState("");
  const [calories, setCalories] = useState("");
  const [intensity, setIntensity] = useState<GymIntensity>("moderate");
  const [sessionNotes, setSessionNotes] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("group");
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [exerciseEditMode, setExerciseEditMode] = useState(false);
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [customExerciseName, setCustomExerciseName] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState<MuscleGroup | "all">("all");
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
  } | null>(null);
  const initializedDate = useRef<string | null>(null);

  const moveExercise = useCallback((exerciseId: string, target: number) => {
    setExercises((current) => {
      const from = current.findIndex((item) => item.id === exerciseId);
      const bounded = Math.max(0, Math.min(current.length - 1, target));
      if (from < 0 || from === bounded) return current;
      LayoutAnimation.configureNext({
        duration: 180,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
      });
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(bounded, 0, moved);
      return next;
    });
  }, []);

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
          mapping.kind !== "exercise_volume")
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
            metric.name.replace(/\s+(strength|volume)$/i, ""),
          muscles:
            metric.gymMuscleGroups ??
            shared?.muscleGroups ??
            catalog?.muscles ??
            ["full_body"],
          equipment: catalog?.equipment ?? ("other" as const),
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
  const selectedSession = sessions.find(
    (session) => session.localDate === localDate,
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
  const inferredDuration =
    Number(duration) ||
    Math.max(
      completedSets > 0 ? 1 : 0,
      Math.round(
        Math.max(
          completedSets * 3,
          completedSets * 0.75 + loggedRestSeconds / 60,
        ),
      ),
    );
  const estimatedCalories =
    Number(calories) ||
    estimateGymActiveCalories(
      state.settings.energyProfile.weightKg,
      inferredDuration,
      intensity,
      exercises,
    );
  const timeBreakdown = gymSessionTimeBreakdown(
    inferredDuration,
    exercises,
  );
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
  const recentRestStats = gymRestBreakdown(
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
          sets: Array.from({ length: exercise.targetSets }, (_, index) => {
            const prior = latest?.sets[index] ?? latestSet;
            return blankSet(
              prior?.reps ?? exercise.targetReps,
              prior?.weightKg ?? exercise.startingWeightKg ?? 0,
            );
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

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (pickerOpen || recapOpen) {
            setPickerOpen(false);
            setRecapOpen(false);
            return true;
          }
          if (exerciseEditMode) {
            setExerciseEditMode(false);
            return true;
          }
          return false;
        },
      );
      return () => subscription.remove();
    }, [exerciseEditMode, pickerOpen, recapOpen]),
  );

  useEffect(() => {
    if (initializedDate.current === localDate) return;
    setWorkoutTimer(null);
    restAlerted.current = false;
    initializedDate.current = localDate;
    const existing = sessions.find((session) => session.localDate === localDate);
    if (existing) {
      setSessionId(existing.id);
      setSessionName(existing.name);
      setDuration(existing.durationMinutes ? String(existing.durationMinutes) : "");
      setCalories(existing.calories ? String(Math.round(existing.calories)) : "");
      setIntensity(existing.intensity ?? "moderate");
      setSessionNotes(existing.notes ?? "");
      setVisibility(existing.visibility);
      setSelectedPlanId(existing.planId ?? null);
      const next = cloneExercises(existing.exercises, true);
      setExercises(next);
      setOpenExerciseId(null);
      return;
    }
    setSessionId(uniqueId("gym"));
    setDuration("");
    setCalories("");
    setSessionNotes("");
    const plan =
      plans.find((item) => item.id === selectedPlanId) ?? plans[0];
    if (plan) loadPlan(plan, false);
    else {
      setSessionName("Gym day");
      setExercises([]);
      setOpenExerciseId(null);
      setSelectedPlanId(null);
    }
  }, [loadPlan, localDate, plans, selectedPlanId, sessions]);

  useEffect(() => {
    if (!workoutTimer || workoutTimer.phase === "paused") return;
    const timer = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [workoutTimer]);

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
    const handle = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.workoutTimer !== true)
        return;
      // Android notification actions are handled by the headless task and
      // replayed once on resume; handling them here as well would skip twice.
      if (
        Platform.OS === "android" &&
        (response.actionIdentifier === WORKOUT_TIMER_NEXT ||
          response.actionIdentifier === WORKOUT_TIMER_PAUSE)
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
    if (workoutTimer) {
      Alert.alert(
        "Workout in progress",
        "Finish this timed workout before changing its set structure.",
      );
      return;
    }
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

  function addCatalogExercise(item: ExerciseCatalogItem) {
    if (workoutTimer) {
      Alert.alert(
        "Workout in progress",
        "Finish the timed workout before changing its exercise list.",
      );
      return;
    }
    const exercise = fromCatalog(item, latestExercise(item.key));
    setExercises((current) => [...current, exercise]);
    setOpenExerciseId(exercise.id);
    setPickerOpen(false);
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
              Math.max(0, set.workSeconds ?? 0) + elapsedSeconds,
          };
        }),
      };
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
    const recordedAt =
      localDate === dateKey()
        ? new Date().toISOString()
        : `${localDate}T18:00:00.000Z`;
    const preciseDuration = Math.max(
      sessionCompletedSets > 0 ? 0.1 : 0,
      Math.round(sessionDuration * 100) / 100,
    );
    const sessionCalories =
      Number(calories) ||
      estimateGymActiveCalories(
        state.settings.energyProfile.weightKg,
        preciseDuration,
        intensity,
        sessionExercises,
      );
    const sessionTime = gymSessionTimeBreakdown(
      preciseDuration,
      sessionExercises,
    );
    saveGymSession({
      id: selectedSession?.id ?? sessionId,
      userId: state.currentUserId,
      planId: selectedPlanId ?? undefined,
      name: sessionName.trim() || "Gym day",
      localDate,
      recordedAt,
      startedAt: timing?.startedAt ?? selectedSession?.startedAt,
      completedAt: timing?.completedAt ?? selectedSession?.completedAt,
      pausedSeconds: timing?.pausedSeconds ?? selectedSession?.pausedSeconds,
      durationMinutes: preciseDuration,
      calories: sessionCompletedSets ? sessionCalories : undefined,
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
        ? `${sessionCompletedSets} sets · ${Math.round(sessionVolume).toLocaleString()} kg volume · ${formatGymDuration(sessionTime.exerciseSeconds)} exercise · ${formatGymDuration(sessionTime.setRestSeconds)} set rest · ${formatGymDuration(sessionTime.exerciseRestSeconds)} between exercises · ~${sessionCalories} active kcal`
        : "The exercise plan is saved without marking the workout complete.",
    );
  }

  function advanceWorkoutTimer(occurredAt = Date.now()) {
    if (!workoutTimer) return;
    if (workoutTimer.phase === "paused") {
      pauseOrResumeWorkout();
      return;
    }
    const now = Date.now();
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
        notes: exercise.notes,
        customMet: exercise.customMet,
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

  function finishTimedWorkout() {
    if (!workoutTimer) return;
    const now = Date.now();
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
        notes: exercise.notes,
        customMet: exercise.customMet,
      })),
      createdAt: selectedShared?.createdAt ?? now,
      updatedAt: now,
    });
    Alert.alert(
      selectedShared ? "Group workout updated" : "Shared with the group",
      "This standardized workout now appears in every active member's Gym templates. Raw completed sets and notes are still shared only through mapped group trackers.",
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
      (pickerMuscle === "all" || item.muscles.includes(pickerMuscle)) &&
      (!query ||
        item.name.toLowerCase().includes(query) ||
        item.muscles.some((muscle) =>
          MUSCLE_LABELS[muscle].toLowerCase().includes(query),
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
        ? `${timerExercise?.name ?? "Exercise"} · Set ${timerSetIndex + 1}/${timerExercise?.sets.length ?? 0}`
        : workoutTimer?.phase === "set_rest"
          ? `Set rest · next is set ${timerNextTarget ? timerNextTarget.exercise.sets.findIndex((set) => set.id === timerNextTarget.set.id) + 1 : ""}`
          : `Between exercises · next is ${timerNextTarget?.exercise.name ?? "finish"}`;
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
      workoutTimer ? workoutNotificationSteps(exercises, workoutTimer) : [],
    [exercises, workoutTimer],
  );
  timerActionRef.current = (action, occurredAt) => {
    if (action === WORKOUT_TIMER_PAUSE)
      pauseOrResumeWorkout(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_NEXT)
      advanceWorkoutTimer(occurredAt ?? Date.now());
    else if (action === WORKOUT_TIMER_FINISH) finishTimedWorkout();
  };
  notificationPayloadRef.current = workoutTimer
    ? {
        title: timerHeading,
        body: `${formatGymDuration(timerPhaseSeconds)} elapsed · ${timerNextLabel}`,
        phase:
          workoutTimer.phase === "work"
            ? "work"
            : workoutTimer.phase === "paused"
              ? "paused"
              : "rest",
        steps: notificationSteps,
      }
    : null;

  useEffect(() => {
    const replayQueuedActions = async () => {
      const actions = await consumeWorkoutTimerActions();
      actions.forEach((item, index) => {
        setTimeout(
          () => timerActionRef.current(item.action, item.occurredAt),
          index * 220,
        );
      });
    };
    const handleActivity = (next: typeof appActivity) => {
      setAppActivity(next);
      if (next === "active") {
        void dismissWorkoutTimerNotification();
        void replayQueuedActions();
        return;
      }
      const payload = notificationPayloadRef.current;
      if (payload)
        void showWorkoutTimerNotification(payload).catch(() => undefined);
    };
    if (NativeAppState.currentState === "active")
      void replayQueuedActions();
    const subscription = NativeAppState.addEventListener(
      "change",
      handleActivity,
    );
    return () => subscription.remove();
  }, []);

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
      title: timerHeading,
      body: `${timerNextLabel} · open MetricRally to adjust kg or reps`,
      phase:
        workoutTimer.phase === "work"
          ? "work"
          : workoutTimer.phase === "paused"
            ? "paused"
            : "rest",
      steps: notificationSteps,
    }).catch(() => undefined);
  }, [
    appActivity,
    notificationSteps,
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
                onPress: finishTimedWorkout,
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
      <Screen
        scrollRef={scrollRef}
        fixedTop={workoutTimerBar}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          title="Gym"
          action={
            <Pressable
              onPress={() => setRecapOpen(true)}
              style={[styles.roundAction, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="sparkles-outline" size={18} color={accent} />
            </Pressable>
          }
        />
        <View style={styles.modeRow}>
          <Chip label="Workout" selected={mode === "workout"} onPress={() => setMode("workout")} />
          <Chip label="Progress" selected={mode === "progress"} onPress={() => setMode("progress")} />
        </View>

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
                    {selectedSession ? "Saved day · edits stay on this date" : "New day · seeded from your active template"}
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
              <Pressable
                onPress={() => setSessionDetailsOpen((value) => !value)}
                style={[styles.detailsToggle, { borderColor: colors.border }]}
              >
                <View style={styles.grow}>
                  <Text style={[styles.exerciseName, { color: colors.ink }]}>
                    {sessionName || "Gym day"}
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
              <View style={styles.timerStartRow}>
                <View style={styles.grow}>
                  <Text style={[styles.exerciseName, { color: colors.ink }]}>
                    Guided timer
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    Optional · otherwise tick sets and save manually.
                  </Text>
                </View>
                <Button
                  label={completedSets ? "Time remaining sets" : "Start workout"}
                  icon="play"
                  size="small"
                  onPress={startGuidedWorkout}
                />
              </View>
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
                  {completedSets} sets · {Math.round(volume).toLocaleString()} kg
                </Text>
                )
              }
            />
            {exercises.map((exercise, exerciseIndex) => {
              const open = openExerciseId === exercise.id;
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
                      backgroundColor: active
                        ? `${timerColor}12`
                        : colors.card,
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
                      <GymDragHandle
                        index={exerciseIndex}
                        count={exercises.length}
                        color={accent}
                        onMove={(target) => moveExercise(exercise.id, target)}
                      />
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
                      <Text style={[styles.exerciseName, { color: colors.ink }]}>{exercise.name}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {(exercise.muscleGroups ?? ["full_body"]).map((muscle) => MUSCLE_LABELS[muscle]).join(" · ")}
                        {averageGymRestSeconds([exercise])
                          ? ` · ${averageGymRestSeconds([exercise])}s avg rest`
                          : ""}
                      </Text>
                    </View>
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
                                {MUSCLE_LABELS[muscle]}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.setHeader}>
                        <Text style={[styles.setSmall, { color: colors.muted }]}>Done</Text>
                        <Text style={[styles.setLabel, { color: colors.muted }]}>kg</Text>
                        <Text style={[styles.setLabel, { color: colors.muted }]}>reps</Text>
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
                            <DraftNumberInput
                              value={set.weightKg}
                              onCommit={(value) => updateSet(exercise.id, set.id, { weightKg: value })}
                              keyboardType="decimal-pad"
                              style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                            />
                            <DraftNumberInput
                              value={set.reps}
                              onCommit={(value) => updateSet(exercise.id, set.id, { reps: Math.round(value) })}
                              keyboardType="number-pad"
                              style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                            />
                            <Pressable
                              onPress={() =>
                                patchExercise(exercise.id, {
                                  sets: exercise.sets.filter((item) => item.id !== set.id),
                                })
                              }
                            >
                              <Ionicons name="close" size={19} color={colors.faint} />
                            </Pressable>
                          </View>
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
                          onPress={() =>
                            setExercises((current) => current.filter((item) => item.id !== exercise.id))
                          }
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
                      Between {exercise.name} and{" "}
                      {exercises[exerciseIndex + 1]?.name}
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
                </GymWiggle>
              );
            })}
            <Pressable
              onPress={() => setPickerOpen(true)}
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
                      label="Avg set rest"
                      value={
                        timeBreakdown.averageSetRestSeconds
                          ? formatGymDuration(
                              timeBreakdown.averageSetRestSeconds,
                            )
                          : "—"
                      }
                      color={colors.ink}
                    />
                    <TimeSummaryItem
                      label="Avg exercise rest"
                      value={
                        timeBreakdown.averageExerciseRestSeconds
                          ? formatGymDuration(
                              timeBreakdown.averageExerciseRestSeconds,
                            )
                          : "—"
                      }
                      color={colors.ink}
                    />
                  </Card>
                ) : null}
                <View style={styles.privacyRow}>
                  <View style={styles.grow}>
                    <Text style={[styles.label, { color: colors.muted }]}>
                      Share mapped gym results
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
        ) : (
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
                    label="Avg set rest"
                    value={
                      recentRestStats.averageSetRestSeconds
                        ? formatGymDuration(
                            recentRestStats.averageSetRestSeconds,
                          )
                        : "—"
                    }
                    color={palette.amber}
                  />
                  <TimeSummaryItem
                    label="Avg between"
                    value={
                      recentRestStats.averageExerciseRestSeconds
                        ? formatGymDuration(
                            recentRestStats.averageExerciseRestSeconds,
                          )
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
                        {Math.round(muscle.sets)} sets · {muscle.sessions} days
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
                  session.exercises.map((exercise) => [exerciseIdentity(exercise), exercise] as const),
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
                      <Text style={[styles.exerciseName, { color: colors.ink }]}>{exercise.name}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>{history.length} logged sessions · {trend === "learning" ? "building baseline" : trend}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.faint} />
                  </Pressable>
                );
              })}
            </Card>
            <SectionHeader title="Workout days" />
            <Card style={styles.history}>
              {sessions.slice(0, 12).map((session, index) => (
                <Pressable
                  key={session.id}
                  onPress={() => { initializedDate.current = null; setLocalDate(session.localDate); setMode("workout"); }}
                  onLongPress={() =>
                    Alert.alert("Delete workout day?", session.name, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteGymSession(session.id) },
                    ])
                  }
                  style={[styles.historyRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={styles.grow}>
                    <Text style={[styles.exerciseName, { color: colors.ink }]}>{session.name}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {friendlyDate(session.localDate)} · {completedGymSets(session.exercises)} sets · {session.durationMinutes} min
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
                    {Math.round(trainingVolumeKg(session.exercises)).toLocaleString()} kg
                  </Text>
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </Screen>

      <Modal transparent animationType="slide" visible={pickerOpen} onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <View style={styles.grow}>
                <Text style={[styles.progressTitle, { color: colors.ink }]}>Add exercise</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>Standard names keep progress history together.</Text>
              </View>
              <Pressable onPress={() => setPickerOpen(false)}>
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
            <View style={styles.pickerMuscles}>
              <Chip label="All" selected={pickerMuscle === "all"} onPress={() => setPickerMuscle("all")} />
              {(["chest", "back", "shoulders", "quadriceps", "hamstrings", "abs"] as MuscleGroup[]).map((muscle) => (
                <Chip key={muscle} label={MUSCLE_LABELS[muscle]} selected={pickerMuscle === muscle} onPress={() => setPickerMuscle(muscle)} />
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
              {pickerItems.slice(0, 40).map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => addCatalogExercise(item)}
                  style={[styles.pickerItem, { borderColor: colors.border }]}
                >
                  <View style={[styles.catalogIcon, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name="barbell-outline" size={17} color={accent} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.exerciseName, { color: colors.ink }]}>{item.name}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {groupExerciseKeys.has(item.key)
                        ? "Group exercise · "
                        : ""}
                      {item.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(" · ")}
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
                <Text style={[styles.progressTitle, { color: colors.ink }]}>Gym recap</Text>
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
  roundAction: { width: 37, height: 37, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", gap: 7, marginBottom: 8 },
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
  historyValue: { fontSize: 9, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  pickerSheet: { maxHeight: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 },
  pickerHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  search: { height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 10 },
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
