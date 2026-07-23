import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { DraftNumberInput } from "@/src/components/DraftNumberInput";
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
  estimateGymActiveCalories,
  exerciseHistory,
  exerciseIdentity,
  exerciseTrend,
  gymRecap,
  muscleGroupStats,
  trainingVolumeKg,
} from "@/src/domain/gym";
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
    sets: previous?.sets.length
      ? previous.sets.map((set) => ({ ...set, id: uniqueId("set"), completed: false }))
      : [blankSet()],
  };
}

function cloneExercises(exercises: GymExercise[], preserveCompletion = false) {
  return exercises.map((exercise) => ({
    ...exercise,
    id: uniqueId("exercise"),
    sets: exercise.sets.map((set) => ({
      ...set,
      id: uniqueId("set"),
      completed: preserveCompletion ? set.completed : false,
    })),
  }));
}

export default function GymScreen() {
  const {
    state,
    saveGymPlan,
    deleteGymPlan,
    saveGymSession,
    deleteGymSession,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
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
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [customExerciseName, setCustomExerciseName] = useState("");
  const [pickerMuscle, setPickerMuscle] = useState<MuscleGroup | "all">("all");
  const [recapOpen, setRecapOpen] = useState(false);
  const initializedDate = useRef<string | null>(null);

  const plans = useMemo(
    () =>
      (state.gymPlans ?? [])
        .filter((plan) => plan.userId === state.currentUserId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.currentUserId, state.gymPlans],
  );
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
  const completedSets = completedGymSets(exercises);
  const volume = trainingVolumeKg(exercises);
  const inferredDuration = Number(duration) || completedSets * 3;
  const estimatedCalories =
    Number(calories) ||
    estimateGymActiveCalories(
      state.settings.energyProfile.weightKg,
      inferredDuration,
      intensity,
      exercises,
    );
  const recaps = gymRecap(sessions, state.currentUserId, localDate);
  const muscles = muscleGroupStats(
    sessions.filter(
      (session) =>
        session.localDate >= dateWithOffsetFrom(localDate, -29) &&
        session.localDate <= localDate,
    ),
    state.currentUserId,
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
      setOpenExerciseId(next[0]?.id ?? null);
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
          return false;
        },
      );
      return () => subscription.remove();
    }, [pickerOpen, recapOpen]),
  );

  useEffect(() => {
    if (initializedDate.current === localDate) return;
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
      setOpenExerciseId(next[0]?.id ?? null);
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

  function addCatalogExercise(item: ExerciseCatalogItem) {
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

  function saveDay() {
    if (!exercises.length) {
      Alert.alert("Add an exercise", "Choose at least one exercise for this day.");
      return;
    }
    const recordedAt =
      localDate === dateKey()
        ? new Date().toISOString()
        : `${localDate}T18:00:00.000Z`;
    saveGymSession({
      id: selectedSession?.id ?? sessionId,
      userId: state.currentUserId,
      planId: selectedPlanId ?? undefined,
      name: sessionName.trim() || "Gym day",
      localDate,
      recordedAt,
      durationMinutes: inferredDuration,
      calories: completedSets ? estimatedCalories : undefined,
      intensity,
      notes: sessionNotes.trim() || undefined,
      exercises,
      visibility,
    });
    Alert.alert(
      completedSets ? "Workout saved" : "Day planned",
      completedSets
        ? `${completedSets} sets · ${Math.round(volume).toLocaleString()} kg volume · ~${estimatedCalories} active kcal`
        : "The exercise plan is saved without marking the workout complete.",
    );
  }

  function savePlan(asNew: boolean) {
    if (!exercises.length) return;
    const existing = !asNew
      ? plans.find((plan) => plan.id === selectedPlanId)
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

  const pickerItems = EXERCISE_CATALOG.filter((item) => item.key !== "custom").filter((item) => {
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

  return (
    <>
      <Screen contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <PageHeader
          title="Gym"
          subtitle="Day-specific training, reusable workouts and personal progress"
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
                <Pressable onPress={() => setLocalDate(dateWithOffsetFrom(localDate, -1))}>
                  <Ionicons name="chevron-back" size={25} color={colors.ink} />
                </Pressable>
                <View style={styles.center}>
                  <Text style={[styles.date, { color: colors.ink }]}>{friendlyDate(localDate)}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {selectedSession ? "Saved day · edits stay on this date" : "New day · seeded from your active template"}
                  </Text>
                </View>
                <Pressable
                  disabled={localDate >= dateKey()}
                  onPress={() => setLocalDate(dateWithOffsetFrom(localDate, 1))}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={25}
                    color={localDate >= dateKey() ? colors.faint : colors.ink}
                  />
                </Pressable>
              </View>
              {plans.length ? (
                <View style={styles.planRow}>
                  {plans.map((plan) => (
                    <Pressable
                      key={plan.id}
                      onPress={() => loadPlan(plan)}
                      onLongPress={() =>
                        Alert.alert("Delete template?", plan.name, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteGymPlan(plan.id) },
                        ])
                      }
                    >
                      <Chip label={plan.name} selected={selectedPlanId === plan.id} />
                    </Pressable>
                  ))}
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
            </Card>

            <SectionHeader
              title="Exercises"
              action={
                <Text style={[styles.summary, { color: accent }]}>
                  {completedSets} sets · {Math.round(volume).toLocaleString()} kg
                </Text>
              }
            />
            {exercises.map((exercise) => {
              const open = openExerciseId === exercise.id;
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
                <Card key={exercise.id} style={[styles.exerciseCard, { borderColor: statusColor }]}>
                  <Pressable
                    style={styles.exerciseHeader}
                    onPress={() => setOpenExerciseId(open ? null : exercise.id)}
                  >
                    <View style={[styles.exerciseDot, { backgroundColor: statusColor }]} />
                    <View style={styles.grow}>
                      <Text style={[styles.exerciseName, { color: colors.ink }]}>{exercise.name}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {(exercise.muscleGroups ?? ["full_body"]).map((muscle) => MUSCLE_LABELS[muscle]).join(" · ")}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/gym-exercise" as never,
                          params: { key: exerciseIdentity(exercise), name: exercise.name },
                        })
                      }
                      style={[styles.miniAction, { borderColor: colors.border }]}
                    >
                      <Ionicons name="stats-chart-outline" size={16} color={accent} />
                    </Pressable>
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
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
                      {exercise.sets.map((set) => (
                        <View key={set.id} style={styles.setRow}>
                          <Pressable onPress={() => updateSet(exercise.id, set.id, { completed: !set.completed })}>
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
                    </View>
                  ) : null}
                </Card>
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
                <View style={styles.privacyRow}>
                  <Text style={[styles.label, { color: colors.muted }]}>Share completed workout</Text>
                  <Chip label="Group" selected={visibility === "group"} onPress={() => setVisibility("group")} />
                  <Chip label="Private" selected={visibility === "private"} onPress={() => setVisibility("private")} />
                </View>
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button
                      label={selectedPlanId ? "Update template" : "Save template"}
                      variant="secondary"
                      onPress={() => savePlan(false)}
                    />
                  </View>
                  {selectedPlanId ? (
                    <View style={styles.action}>
                      <Button label="Save as new" variant="secondary" onPress={() => savePlan(true)} />
                    </View>
                  ) : null}
                  <View style={styles.action}>
                    <Button label="Save day" icon="checkmark" onPress={saveDay} />
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
              {muscles.length ? muscles.slice(0, 8).map((muscle) => {
                const max = muscles[0]?.volumeKg || 1;
                return (
                  <View key={muscle.muscle} style={styles.muscleProgress}>
                    <View style={styles.progressLabelRow}>
                      <Text style={[styles.muscleName, { color: colors.ink }]}>{muscle.label}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {Math.round(muscle.sets)} sets · {muscle.sessions} days
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
              {pickerItems.slice(0, 14).map((item) => (
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

const styles = StyleSheet.create({
  page: { paddingBottom: 18 },
  roundAction: { width: 37, height: 37, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", gap: 7, marginBottom: 8 },
  dayCard: { gap: 9 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center" },
  date: { fontSize: 13, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  planRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
  summary: { fontSize: 9, fontWeight: "900" },
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
  setRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  setInput: { flex: 1, height: 36, borderWidth: 1, borderRadius: 9, textAlign: "center", fontSize: 11, fontWeight: "800" },
  exerciseNotes: { borderWidth: 1, borderRadius: 9, minHeight: 37, paddingHorizontal: 9, fontSize: 9 },
  exerciseActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  removeExercise: { flexDirection: "row", gap: 4, alignItems: "center", padding: 8 },
  removeText: { color: palette.red, fontSize: 8, fontWeight: "900" },
  addExercise: { minHeight: 43, borderWidth: 1, borderStyle: "dashed", borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontSize: 9, fontWeight: "900" },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  actions: { flexDirection: "row", gap: 6 },
  action: { flex: 1 },
  progressLead: { gap: 11 },
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
