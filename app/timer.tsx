import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import {
  activityTimerDisplaySeconds,
  activityTimerElapsedSeconds,
  formatActivityTimer,
} from "@/src/domain/activityTimer";
import { dateKey } from "@/src/domain/date";
import { estimateGymActiveCalories } from "@/src/domain/gym";
import {
  EXERCISE_CATEGORY_LABELS,
  SESSION_ACTIVITY_EXERCISES,
  catalogExercise,
  inferSessionActivityFromName,
} from "@/src/domain/exerciseCatalog";
import {
  cancelActivityTimerAlerts,
  syncActivityTimerAlerts,
} from "@/src/notifications/activityTimerAlerts";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { ActivityTimer, GymIntensity, GymSession } from "@/src/types";

type WorkoutFinishDraft = {
  timer: ActivityTimer;
  seconds: number;
  distance: string;
  calories: string;
};

export default function ActivityTimerPage() {
  const tutorialSandbox = useTutorialSandboxActive();
  const tutorial = useTutorial();
  const params = useLocalSearchParams<{
    metric?: string;
    date?: string;
    duration?: string;
    timer?: string;
  }>();
  const {
    state,
    setActivityTimer,
    logMetric,
    saveGymSession,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language } = useLocalization();
  const timers = useMemo(
    () =>
      state.activityTimers?.length
        ? state.activityTimers
        : state.activeTimer
          ? [state.activeTimer]
          : [],
    [state.activeTimer, state.activityTimers],
  );
  const [selectedTimerId, setSelectedTimerId] = useState(
    params.timer ?? state.activeTimer?.id ?? timers[0]?.id ?? "",
  );
  const [creatingNew, setCreatingNew] = useState(
    (tutorialSandbox && tutorial.activeStep?.target === "timer-setup") ||
      timers.length === 0,
  );
  const timer = creatingNew
    ? undefined
    : timers.find((item) => item.id === selectedTimerId) ?? timers[0];
  const metrics = useMemo(
    () =>
      state.metrics.filter(
        (metric) =>
          metric.dataType === "number" &&
          metric.manualEntry !== false &&
          metric.timerEnabled,
      ),
    [state.metrics],
  );
  const [metricId, setMetricId] = useState(
    timer?.metricId ??
      (tutorialSandbox && metrics.some((item) => item.id === "reading")
        ? "reading"
        : undefined) ??
      (params.metric && metrics.some((item) => item.id === params.metric)
        ? params.metric
        : metrics[0]?.id) ??
      "",
  );
  const [mode, setMode] = useState<ActivityTimer["mode"]>(
    timer?.mode ?? (tutorialSandbox ? "countdown" : "stopwatch"),
  );
  const plannedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : dateKey();
  const [targetMinutes, setTargetMinutes] = useState(
    Math.max(1, Math.round(Number(params.duration) || 25)),
  );
  const [autoLog, setAutoLog] = useState(timer?.autoLog ?? false);
  const [saveAsWorkout, setSaveAsWorkout] = useState(
    timer?.workout !== undefined || metricId === "workout_duration",
  );
  const [workoutActivityKey, setWorkoutActivityKey] = useState(
    timer?.workout?.activityKey ?? "walking",
  );
  const initialActivity =
    catalogExercise(timer?.workout?.activityKey ?? "walking") ??
    SESSION_ACTIVITY_EXERCISES[0];
  const [workoutName, setWorkoutName] = useState(
    timer?.workout?.name ?? initialActivity?.name ?? "Workout",
  );
  const [workoutDistance, setWorkoutDistance] = useState(
    timer?.workout?.distanceKm ? String(timer.workout.distanceKm) : "",
  );
  const [workoutCalories, setWorkoutCalories] = useState(
    timer?.workout?.calories ? String(timer.workout.calories) : "",
  );
  const [workoutIntensity, setWorkoutIntensity] = useState<GymIntensity>(
    timer?.workout?.intensity ?? "moderate",
  );
  const [finishDraft, setFinishDraft] = useState<WorkoutFinishDraft>();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [customAlert, setCustomAlert] = useState("");
  const [now, setNow] = useState(Date.now());
  const finishingTimerIds = useRef(new Set<string>());
  const alertMinutes = state.settings.activityTimerAlertMinutes ?? [30, 60];
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (tutorialSandbox && tutorial.activeStep?.target === "timer-setup")
      setCreatingNew(true);
  }, [tutorial.activeStep?.target, tutorialSandbox]);
  useEffect(() => {
    if (creatingNew || !timers.length) return;
    if (!timers.some((item) => item.id === selectedTimerId))
      setSelectedTimerId(timers[0].id);
  }, [creatingNew, selectedTimerId, timers]);
  useEffect(() => {
    const expired = timers.find(
      (item) =>
        item.mode === "countdown" &&
        item.status === "running" &&
        activityTimerDisplaySeconds(item, now) <= 0,
    );
    if (expired) void finish(expired);
    // finish is intentionally driven only when a persisted timer reaches 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, timers]);
  const metric = state.metrics.find((item) => item.id === (timer?.metricId ?? metricId));
  const start = async () => {
    if (!metric)
      return Alert.alert("Choose a timed tracker", "Add one first if needed.");
    const targetSeconds = mode === "countdown" ? targetMinutes * 60 : undefined;
    const id = `timer-${Date.now().toString(36)}`;
    const distanceKm = Number(workoutDistance.replace(",", "."));
    const calories = Number(workoutCalories.replace(",", "."));
    const nextTimer: ActivityTimer = {
      id,
      metricId: metric.id,
      localDate: plannedDate,
      mode,
      targetSeconds,
      autoLog,
      startedAt: new Date().toISOString(),
      status: "running",
      accumulatedSeconds: 0,
      laps: [],
      workout: metric.id === "workout_duration" && saveAsWorkout
        ? {
            activityKey: workoutActivityKey || undefined,
            name: workoutName.trim() || "Workout",
            distanceKm:
              Number.isFinite(distanceKm) && distanceKm > 0
                ? distanceKm
                : undefined,
            calories:
              Number.isFinite(calories) && calories >= 0 && workoutCalories.trim()
                ? calories
                : undefined,
            intensity: workoutIntensity,
          }
        : undefined,
    };
    const notifications = tutorialSandbox
      ? { notificationId: undefined, notificationIds: [] }
      :
          (
            await syncActivityTimerAlerts(
              {
                ...state,
                activityTimers: [
                  ...timers.filter((item) => item.id !== id),
                  nextTimer,
                ],
                activeTimer: nextTimer,
              },
              { requestPermission: true },
            )
          )[id] ?? { notificationId: undefined, notificationIds: [] };
    setActivityTimer({
      ...nextTimer,
      ...notifications,
    });
    updateSettings({
      showActivityTimerOverlay: true,
      activityTimerOverlayMinimized: false,
    });
    if (tutorialSandbox)
      tutorial.reportEvent({
        actionId: "tutorial.timer.start",
        scope: "isolated-preview",
      });
    setSelectedTimerId(id);
    setCreatingNew(false);
  };
  const pause = async () => {
    if (!timer) return;
    if (!tutorialSandbox)
      await cancelActivityTimerAlerts(timer, state.currentUserId);
    setActivityTimer({
      ...timer,
      accumulatedSeconds: activityTimerElapsedSeconds(timer),
      status: "paused",
      pausedAt: new Date().toISOString(),
      notificationId: undefined,
      notificationIds: [],
    });
  };
  const resume = async () => {
    if (!timer || !metric) return;
    const nextTimer: ActivityTimer = {
      ...timer,
      startedAt: new Date().toISOString(),
      status: "running",
      pausedAt: undefined,
      notificationId: undefined,
      notificationIds: [],
    };
    const notifications = tutorialSandbox
      ? { notificationId: undefined, notificationIds: [] }
      :
          (
            await syncActivityTimerAlerts(
              {
                ...state,
                activityTimers: timers.map((item) =>
                  item.id === timer.id ? nextTimer : item,
                ),
                activeTimer: nextTimer,
              },
              { requestPermission: true },
            )
          )[timer.id] ?? { notificationId: undefined, notificationIds: [] };
    setActivityTimer({
      ...nextTimer,
      ...notifications,
    });
  };
  const lap = () => {
    if (!timer) return;
    setActivityTimer({
      ...timer,
      laps: [
        ...timer.laps,
        {
          id: `lap-${Date.now().toString(36)}`,
          seconds: activityTimerElapsedSeconds(timer),
          recordedAt: new Date().toISOString(),
        },
      ],
    });
  };
  const saveTimedWorkout = (
    target: ActivityTimer,
    seconds: number,
    distanceText = "",
    caloriesText = "",
  ) => {
    if (!target.workout) return;
    const workoutName = target.workout.name.trim();
    const activity =
      inferSessionActivityFromName(workoutName) ??
      catalogExercise(target.workout.activityKey);
    const activityKey = activity?.key ?? target.workout.activityKey;
    const distanceInput = Number(distanceText.replace(",", "."));
    const calorieInput = Number(caloriesText.replace(",", "."));
    const distanceKm =
      Number.isFinite(distanceInput) && distanceInput > 0
        ? distanceInput
        : Math.max(0, target.workout.distanceKm ?? 0);
    const hasManualCalories =
      Boolean(caloriesText.trim()) &&
      Number.isFinite(calorieInput) &&
      calorieInput >= 0;
    const durationMinutes = Math.max(0.1, seconds / 60);
    const exercise: GymSession["exercises"][number] = {
      id: `timer-exercise-${target.id}`,
      exerciseKey: activityKey,
      name: workoutName || activity?.name || "Workout",
      muscleGroups: activity?.muscles ?? ["full_body" as const],
      exerciseCategory: activity?.category ?? "other" as const,
      customMet: activity?.met,
      trackingMode: "duration" as const,
      trackingFields: distanceKm > 0
        ? ["duration", "distance"]
        : ["duration"],
      completed: true,
      sets: [
        {
          id: `timer-set-${target.id}`,
          reps: 0,
          weightKg: 0,
          completed: true,
          workSeconds: seconds,
          distanceKm: distanceKm || undefined,
        },
      ],
    };
    const estimatedCalories = estimateGymActiveCalories(
      state.settings.energyProfile,
      durationMinutes,
      target.workout.intensity ?? "moderate",
      [exercise],
      "session_met",
    );
    const recordedAt = new Date().toISOString();
    const timerLocalDate = target.localDate ?? dateKey(new Date(target.startedAt));
    const session: GymSession = {
      id: `activity-timer-workout-${target.id}`,
      userId: state.currentUserId,
      name: workoutName || activity?.name || "Workout",
      localDate: timerLocalDate,
      recordedAt,
      startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
      completedAt: recordedAt,
      pausedSeconds: 0,
      durationMinutes: Math.round(durationMinutes * 100) / 100,
      durationManual: false,
      distanceKm: distanceKm || undefined,
      calories: hasManualCalories
        ? calorieInput
        : target.workout.calories ?? estimatedCalories,
      calorieCalculationMode: "session_met",
      caloriesManual:
        hasManualCalories || target.workout.calories !== undefined,
      intensity: target.workout.intensity ?? "moderate",
      notes: `Recorded with Activity timer${target.laps.length ? ` · ${target.laps.length} laps` : ""}.`,
      exercises: [exercise],
      visibility:
        state.metrics.find((item) => item.id === "workout")
          ?.defaultVisibility ?? "group",
    };
    saveGymSession(session);
  };
  const logFinishedTimerMetric = (
    target: ActivityTimer,
    value: number,
    targetMetric: NonNullable<typeof metric>,
  ) => {
    // A GymSession writes the canonical Workout duration entry itself. Avoid
    // a second manual row when the timer was launched from that tracker.
    if (target.workout && target.metricId === "workout_duration") return;
    logMetric(target.metricId, value, targetMetric.defaultVisibility, "add", {
      localDate: target.localDate ?? dateKey(new Date(target.startedAt)),
      label: target.workout?.name ?? "Activity timer",
      note: `${target.laps.length} lap${target.laps.length === 1 ? "" : "s"}`,
    });
  };
  const finish = async (target = timer) => {
    if (!target || finishingTimerIds.current.has(target.id)) return;
    finishingTimerIds.current.add(target.id);
    try {
      if (!tutorialSandbox)
        await cancelActivityTimerAlerts(target, state.currentUserId);
      const seconds =
        target.mode === "countdown"
          ? Math.min(
              target.targetSeconds ?? 0,
              activityTimerElapsedSeconds(target),
            )
          : activityTimerElapsedSeconds(target);
      const targetMetric = state.metrics.find(
        (item) => item.id === target.metricId,
      );
      if (!targetMetric) {
        setActivityTimer(undefined, target.id);
        return;
      }
      const value = /hour|hr/i.test(targetMetric.unit)
        ? seconds / 3600
        : /sec/i.test(targetMetric.unit)
          ? seconds
          : seconds / 60;
      if (target.workout && !target.autoLog) {
        const pausedTarget: ActivityTimer = {
          ...target,
          status: "paused",
          accumulatedSeconds: seconds,
          pausedAt: new Date().toISOString(),
          notificationId: undefined,
          notificationIds: [],
        };
        setActivityTimer(pausedTarget);
        setFinishDraft({
          timer: pausedTarget,
          seconds,
          distance: target.workout.distanceKm
            ? String(target.workout.distanceKm)
            : "",
          calories:
            target.workout.calories !== undefined
              ? String(target.workout.calories)
              : "",
        });
        return;
      }
      if (target.autoLog) {
        // Persist the canonical workout/metric rows before removing the timer,
        // so a failed save cannot discard the only recoverable timer record.
        if (target.workout) saveTimedWorkout(target, seconds);
        logFinishedTimerMetric(target, value, targetMetric);
        setActivityTimer(undefined, target.id);
        router.back();
      } else {
        setActivityTimer(undefined, target.id);
        router.replace({
          pathname: "/log",
          params: {
            metric: target.metricId,
            date: target.localDate ?? dateKey(new Date(target.startedAt)),
            value: String(Math.round(value * 100) / 100),
            note: `${target.laps.length} timer lap${target.laps.length === 1 ? "" : "s"}`,
          },
        } as never);
      }
    } finally {
      finishingTimerIds.current.delete(target.id);
    }
  };
  const confirmWorkoutFinish = () => {
    if (!finishDraft) return;
    const targetMetric = state.metrics.find(
      (item) => item.id === finishDraft.timer.metricId,
    );
    if (!targetMetric) return;
    const value = /hour|hr/i.test(targetMetric.unit)
      ? finishDraft.seconds / 3600
      : /sec/i.test(targetMetric.unit)
        ? finishDraft.seconds
        : finishDraft.seconds / 60;
    saveTimedWorkout(
      finishDraft.timer,
      finishDraft.seconds,
      finishDraft.distance,
      finishDraft.calories,
    );
    logFinishedTimerMetric(finishDraft.timer, value, targetMetric);
    setActivityTimer(undefined, finishDraft.timer.id);
    setFinishDraft(undefined);
    router.back();
  };
  return (
    <Screen refreshEnabled={false}>
      <PageHeader
        title="Activity timer"
        subtitle="Stopwatch or countdown for timed trackers."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      {timers.length ? (
        <Card style={styles.timerList}>
          <View style={styles.timerListHeading}>
            <View style={styles.grow}>
              <Text style={[styles.label, { color: colors.ink }]}>Active timers</Text>
              <Text style={[styles.helper, { color: colors.muted }]}>
                {timers.length} running or paused
              </Text>
            </View>
            <IconButton
              icon={
                state.settings.showActivityTimerOverlay === false
                  ? "eye-off-outline"
                  : "eye-outline"
              }
              label={
                state.settings.showActivityTimerOverlay === false
                  ? "Show floating timer"
                  : "Hide floating timer"
              }
              onPress={() =>
                updateSettings({
                  showActivityTimerOverlay:
                    state.settings.showActivityTimerOverlay === false,
                  activityTimerOverlayMinimized: false,
                })
              }
            />
            <IconButton
              icon="add"
              label="Start another timer"
              onPress={() => setCreatingNew(true)}
            />
          </View>
          <View style={styles.timerChoices}>
            {timers.map((item) => {
              const itemMetric = state.metrics.find(
                (metricItem) => metricItem.id === item.metricId,
              );
              if (!itemMetric) return null;
              const selected = !creatingNew && timer?.id === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setSelectedTimerId(item.id);
                    setCreatingNew(false);
                  }}
                  style={[
                    styles.timerChoice,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected
                        ? colors.primarySoft
                        : colors.canvas,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.status === "paused" ? "pause" : "timer-outline"}
                    size={15}
                    color={selected ? accent : colors.muted}
                  />
                  <View style={styles.grow}>
                    <Text
                      translate={false}
                      numberOfLines={1}
                      style={[styles.timerChoiceName, { color: colors.ink }]}
                    >
                      {localizeMetricName(language, itemMetric)}
                    </Text>
                    <Text style={[styles.timerChoiceTime, { color: colors.muted }]}>
                      {formatActivityTimer(activityTimerDisplaySeconds(item, now))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}
      {timer && metric ? (
        finishDraft ? (
          <Card style={styles.finishCard}>
            <View style={[styles.finishIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="checkmark" size={22} color={accent} />
            </View>
            <Text style={[styles.finishTitle, { color: colors.ink }]}>Finish workout</Text>
            <Text style={[styles.helper, { color: colors.muted }]}>
              {formatActivityTimer(finishDraft.seconds)} recorded. Add optional
              distance or calories, or leave calories blank for a MET estimate
              based on {finishDraft.timer.workout?.name ?? "this activity"}.
            </Text>
            <View style={styles.finishFields}>
              <View style={styles.finishField}>
                <Text style={[styles.label, { color: colors.ink }]}>Distance · km</Text>
                <TextInput
                  accessibilityLabel="Workout distance in kilometres"
                  value={finishDraft.distance}
                  onChangeText={(distance) =>
                    setFinishDraft((current) =>
                      current ? { ...current, distance } : current,
                    )
                  }
                  keyboardType="decimal-pad"
                  placeholder="Optional"
                  placeholderTextColor={colors.faint}
                  style={[styles.finishInput, { color: colors.ink, borderColor: colors.border }]}
                />
              </View>
              <View style={styles.finishField}>
                <Text style={[styles.label, { color: colors.ink }]}>Active calories</Text>
                <TextInput
                  accessibilityLabel="Workout active calories"
                  value={finishDraft.calories}
                  onChangeText={(calories) =>
                    setFinishDraft((current) =>
                      current ? { ...current, calories } : current,
                    )
                  }
                  keyboardType="decimal-pad"
                  placeholder="Estimate"
                  placeholderTextColor={colors.faint}
                  style={[styles.finishInput, { color: colors.ink, borderColor: colors.border }]}
                />
              </View>
            </View>
            <View style={styles.finishActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setFinishDraft(undefined)}
                style={[styles.finishButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.finishButtonText, { color: colors.muted }]}>Keep paused</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={confirmWorkoutFinish}
                style={[styles.finishButton, { backgroundColor: accent, borderColor: accent }]}
              >
                <Text style={[styles.finishButtonText, { color: "#FFFFFF" }]}>Save workout</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
        <>
          <TutorialTarget id="timer-active">
          <Card style={styles.live}>
            <Text translate={false} style={[styles.metric, { color: accent }]}>
              {localizeMetricName(language, metric)}
            </Text>
            {timer.workout ? (
              <Text translate={false} style={[styles.workoutLiveName, { color: colors.muted }]}>
                Workout · {timer.workout.name}
              </Text>
            ) : null}
            <Text style={[styles.clock, { color: colors.ink }]}>
              {formatActivityTimer(
                activityTimerDisplaySeconds(timer, now),
              )}
            </Text>
            <Text style={[styles.status, { color: colors.muted }]}>
              {timer.status === "paused"
                ? "Paused"
                : timer.mode === "countdown"
                  ? "Countdown running"
                  : "Stopwatch running"}
            </Text>
            <View style={styles.liveActions}>
              <Pressable
                onPress={timer.status === "running" ? pause : resume}
                style={[styles.round, { backgroundColor: colors.primarySoft }]}
              >
                <Ionicons
                  name={timer.status === "running" ? "pause" : "play"}
                  size={23}
                  color={accent}
                />
              </Pressable>
              <Pressable onPress={lap} style={[styles.round, { backgroundColor: colors.canvas }]}>
                <Ionicons name="flag-outline" size={22} color={colors.ink} />
              </Pressable>
              <Pressable onPress={() => finish()} style={[styles.round, { backgroundColor: "#D24B4B18" }]}>
                <Ionicons name="stop" size={23} color="#D24B4B" />
              </Pressable>
            </View>
          </Card>
          </TutorialTarget>
          {timer.laps.length ? (
            <Card style={styles.laps}>
              {timer.laps.map((item, index) => (
                <View key={item.id} style={styles.lap}>
                  <Text style={[styles.lapText, { color: colors.muted }]}>
                    Lap {index + 1}
                  </Text>
                  <Text style={[styles.lapValue, { color: colors.ink }]}>
                    {formatActivityTimer(item.seconds)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
        )
      ) : (
        <>
          <TutorialTarget id="timer-setup" onTutorialActivate={() => {
            if (tutorialSandbox) void start();
          }}>
          <Card style={styles.setup}>
            {params.date ? (
              <Text style={[styles.helper, { color: colors.muted }]}>Planned for {plannedDate}. Confirm Start when you are ready.</Text>
            ) : null}
            <MetricSelector
              title="Choose a timed tracker"
              items={metrics.map((item) => ({
                id: item.id,
                label: item.name,
                icon: item.icon as keyof typeof Ionicons.glyphMap,
                color: item.color,
                group:
                  item.grouping ||
                  (item.category === "mind"
                    ? "Mind & focus"
                    : "Other timed trackers"),
              }))}
              selectedIds={metricId ? [metricId] : []}
              onChange={(ids) => {
                const nextMetricId = ids[0] ?? "";
                setMetricId(nextMetricId);
                if (nextMetricId === "workout_duration") setSaveAsWorkout(true);
              }}
              multiple={false}
              collapsibleGroups={["Mind & focus", "Other timed trackers"]}
            />
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/metric-editor",
                  params: { id: "new", focus: "timer" },
                } as never)
              }
            >
              <Text style={[styles.link, { color: accent }]}>
                {metrics.length
                  ? "Create another timed tracker"
                  : "Create a duration tracker"}
              </Text>
            </Pressable>
            {!metrics.length ? (
              <Text style={[styles.helper, { color: colors.muted }]}>
                Create a number tracker and turn on “Timed activity”.
              </Text>
            ) : null}
            {metricId === "workout_duration" ? (
              <View style={[styles.workoutPanel, { borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: saveAsWorkout }}
                  onPress={() => setSaveAsWorkout((value) => !value)}
                  style={styles.autoLog}
                >
                  <Ionicons
                    name={saveAsWorkout ? "checkbox" : "square-outline"}
                    size={20}
                    color={saveAsWorkout ? accent : colors.faint}
                  />
                  <View style={styles.grow}>
                    <Text style={[styles.autoLogText, { color: colors.ink }]}>Also save to Workout</Text>
                    <Text style={[styles.workoutHint, { color: colors.muted }]}>Syncs duration, distance and active energy into their trackers.</Text>
                  </View>
                </Pressable>
                {saveAsWorkout ? (
                  <View style={styles.workoutFields}>
                    <SelectionMenu
                      title="Workout activity"
                      items={SESSION_ACTIVITY_EXERCISES.map((item) => ({
                        id: item.key,
                        label: item.name,
                        icon: "fitness-outline",
                        color: accent,
                        group: EXERCISE_CATEGORY_LABELS[item.category],
                        sublabel: `${item.met} MET${item.supportsDistance ? " · distance" : ""}`,
                      }))}
                      selectedIds={workoutActivityKey ? [workoutActivityKey] : []}
                      onChange={(ids) => {
                        const activityKey = ids[0] ?? "";
                        const activity = catalogExercise(activityKey);
                        setWorkoutActivityKey(activityKey);
                        if (activity) setWorkoutName(activity.name);
                      }}
                      multiple={false}
                      minimumSelected={1}
                      emptyLabel="Choose activity"
                    />
                    <TextInput
                      accessibilityLabel="Workout name"
                      value={workoutName}
                      onChangeText={setWorkoutName}
                      placeholder="Custom workout name"
                      placeholderTextColor={colors.faint}
                      style={[styles.workoutNameInput, { color: colors.ink, borderColor: colors.border }]}
                    />
                    <View style={styles.wrap}>
                      {(["light", "moderate", "vigorous"] as GymIntensity[]).map((intensity) => (
                        <Chip
                          key={intensity}
                          label={intensity[0].toUpperCase() + intensity.slice(1)}
                          selected={workoutIntensity === intensity}
                          onPress={() => setWorkoutIntensity(intensity)}
                        />
                      ))}
                    </View>
                    {autoLog ? (
                      <View style={styles.finishFields}>
                        <TextInput
                          accessibilityLabel="Optional workout distance in kilometres"
                          value={workoutDistance}
                          onChangeText={setWorkoutDistance}
                          keyboardType="decimal-pad"
                          placeholder="Distance km · optional"
                          placeholderTextColor={colors.faint}
                          style={[styles.finishInput, styles.finishField, { color: colors.ink, borderColor: colors.border }]}
                        />
                        <TextInput
                          accessibilityLabel="Optional workout active calories"
                          value={workoutCalories}
                          onChangeText={setWorkoutCalories}
                          keyboardType="decimal-pad"
                          placeholder="Calories · estimate"
                          placeholderTextColor={colors.faint}
                          style={[styles.finishInput, styles.finishField, { color: colors.ink, borderColor: colors.border }]}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={[styles.label, { color: colors.ink }]}>Mode</Text>
            <View style={styles.wrap}>
              <Chip label="Stopwatch" selected={mode === "stopwatch"} onPress={() => setMode("stopwatch")} />
              <Chip label="Countdown" selected={mode === "countdown"} onPress={() => setMode("countdown")} />
            </View>
            {mode === "countdown" ? (
              <View style={styles.wrap}>
                {[10, 25, 30, 45, 60].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes} min`}
                    selected={targetMinutes === minutes}
                    onPress={() => setTargetMinutes(minutes)}
                  />
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => setAlertsOpen((open) => !open)}
              style={[styles.alertHeading, { borderColor: colors.border }]}
            >
              <View style={styles.alertCopy}>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Timer alerts
                </Text>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  {alertMinutes.length
                    ? alertMinutes.map((item) => `${item}m`).join(" · ")
                    : "Off"}
                </Text>
              </View>
              <Ionicons
                name={alertsOpen ? "chevron-up" : "chevron-down"}
                size={17}
                color={colors.faint}
              />
            </Pressable>
            {alertsOpen ? (
              <View style={styles.alertPanel}>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  Notify after these elapsed times. Countdown completion is
                  always scheduled separately.
                </Text>
                <View style={styles.wrap}>
                  {[5, 15, 30, 60, 120].map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes} min`}
                      selected={alertMinutes.includes(minutes)}
                      onPress={() =>
                        updateSettings({
                          activityTimerAlertMinutes: alertMinutes.includes(
                            minutes,
                          )
                            ? alertMinutes.filter((item) => item !== minutes)
                            : [...alertMinutes, minutes].sort((a, b) => a - b),
                        })
                      }
                    />
                  ))}
                </View>
                <View style={styles.customAlert}>
                  <TextInput
                    value={customAlert}
                    onChangeText={setCustomAlert}
                    keyboardType="numeric"
                    placeholder="Custom minutes"
                    placeholderTextColor={colors.faint}
                    style={[
                      styles.customAlertInput,
                      { color: colors.ink, borderColor: colors.border },
                    ]}
                  />
                  <Pressable
                    onPress={() => {
                      const minutes = Math.max(
                        1,
                        Math.round(Number(customAlert)),
                      );
                      if (!Number.isFinite(minutes)) return;
                      updateSettings({
                        activityTimerAlertMinutes: [
                          ...new Set([...alertMinutes, minutes]),
                        ].sort((a, b) => a - b),
                      });
                      setCustomAlert("");
                    }}
                    style={[styles.addAlert, { backgroundColor: accent }]}
                  >
                    <Ionicons name="add" size={17} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            ) : null}
            <Pressable
              onPress={() => setAutoLog((value) => !value)}
              style={styles.autoLog}
            >
              <Ionicons
                name={autoLog ? "checkbox" : "square-outline"}
                size={20}
                color={autoLog ? accent : colors.faint}
              />
              <Text style={[styles.autoLogText, { color: colors.ink }]}>
                Log automatically when finished
              </Text>
            </Pressable>
          </Card>
          </TutorialTarget>
          <Pressable onPress={start} style={[styles.start, { backgroundColor: accent }]}>
            <Ionicons name="play" size={18} color="#FFFFFF" />
            <Text style={styles.startText}>Start timer</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  timerList: { gap: 8, marginBottom: 8 },
  timerListHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timerChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  timerChoice: {
    width: "48.8%",
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerChoiceName: { fontSize: 8, fontWeight: "900" },
  timerChoiceTime: { fontSize: 8, fontWeight: "800", marginTop: 1 },
  setup: { gap: 10 },
  workoutPanel: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 9 },
  workoutFields: { gap: 8 },
  workoutHint: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  workoutNameInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 10,
    fontWeight: "800",
  },
  label: { fontSize: 10, fontWeight: "900" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  link: { fontSize: 9, fontWeight: "900", textAlign: "center" },
  helper: { fontSize: 8, lineHeight: 12, textAlign: "center" },
  alertHeading: {
    minHeight: 42,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
  },
  alertCopy: { flex: 1, minWidth: 0 },
  alertPanel: { gap: 7 },
  customAlert: { flexDirection: "row", alignItems: "center", gap: 6 },
  customAlertInput: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 9,
  },
  addAlert: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  autoLog: { flexDirection: "row", alignItems: "center", gap: 7 },
  autoLogText: { fontSize: 9, fontWeight: "800" },
  start: {
    minHeight: 48,
    marginTop: 9,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  startText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  live: { alignItems: "center", gap: 6 },
  metric: { fontSize: 10, fontWeight: "900" },
  workoutLiveName: { fontSize: 9, fontWeight: "800" },
  clock: { fontSize: 40, lineHeight: 48, fontWeight: "900", letterSpacing: 1 },
  status: { fontSize: 9, fontWeight: "800" },
  liveActions: { flexDirection: "row", gap: 13, marginTop: 9 },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  laps: { gap: 5, marginTop: 8 },
  finishCard: { alignItems: "center", gap: 10 },
  finishIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  finishTitle: { fontSize: 16, fontWeight: "900" },
  finishFields: { width: "100%", flexDirection: "row", gap: 8 },
  finishField: { flex: 1, minWidth: 0 },
  finishInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    fontSize: 10,
    fontWeight: "800",
  },
  finishActions: { width: "100%", flexDirection: "row", gap: 8 },
  finishButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  finishButtonText: { fontSize: 9, fontWeight: "900" },
  lap: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lapText: { fontSize: 8, fontWeight: "800" },
  lapValue: { fontSize: 10, fontWeight: "900" },
});
