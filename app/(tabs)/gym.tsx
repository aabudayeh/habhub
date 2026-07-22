import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { Button, Card, Chip, PageHeader, Screen, SectionHeader } from "@/src/components/ui";
import { dateKey, dateWithOffsetFrom, friendlyDate } from "@/src/domain/date";
import { completedGymSets, trainingVolumeKg } from "@/src/domain/gym";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { GymExercise, GymPlan, GymSet } from "@/src/types";

const id = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function blankSet(): GymSet {
  return { id: id("set"), reps: 10, weightKg: 0, completed: false };
}

function blankExercise(name = ""): GymExercise {
  return { id: id("exercise"), name, sets: [blankSet()] };
}

export default function GymScreen() {
  const { state, saveGymPlan, deleteGymPlan, saveGymSession, deleteGymSession } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [localDate, setLocalDate] = useState(dateKey());
  const [sessionName, setSessionName] = useState("Gym session");
  const [duration, setDuration] = useState("");
  const [calories, setCalories] = useState("");
  const [exerciseName, setExerciseName] = useState("");
  const [exercises, setExercises] = useState<GymExercise[]>([]);
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const plans = (state.gymPlans ?? []).filter(
    (plan) => plan.userId === state.currentUserId,
  );
  const sessions = useMemo(
    () =>
      (state.gymSessions ?? [])
        .filter((session) => session.userId === state.currentUserId)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, 6),
    [state.currentUserId, state.gymSessions],
  );
  const completedSets = completedGymSets(exercises);
  const volume = trainingVolumeKg(exercises);

  function choosePlan(plan: GymPlan) {
    setSelectedPlanId(plan.id);
    setSessionName(plan.name);
    const next = plan.exercises.map((exercise) => ({
      id: id("exercise"),
      name: exercise.name,
      sets: Array.from({ length: exercise.targetSets }, () => ({
        ...blankSet(),
        reps: exercise.targetReps,
        weightKg: exercise.startingWeightKg ?? 0,
      })),
    }));
    setExercises(next);
    setOpenExerciseId(next[0]?.id ?? null);
  }

  function addExercise() {
    const name = exerciseName.trim();
    if (!name) return;
    const exercise = blankExercise(name);
    setExercises((current) => [...current, exercise]);
    setOpenExerciseId(exercise.id);
    setExerciseName("");
  }

  function updateSet(
    exerciseId: string,
    setId: string,
    changes: Partial<GymSet>,
  ) {
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

  function addSet(exerciseId: string) {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        const previous = exercise.sets.at(-1);
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              ...blankSet(),
              reps: previous?.reps ?? 10,
              weightKg: previous?.weightKg ?? 0,
            },
          ],
        };
      }),
    );
  }

  function saveWorkout() {
    const completed = exercises
      .filter((exercise) => exercise.name.trim())
      .map((exercise) => ({
        ...exercise,
        sets: exercise.sets.filter((set) => set.completed),
      }))
      .filter((exercise) => exercise.sets.length);
    if (!completed.length) {
      Alert.alert("Complete one set", "Tap the circle beside a set before saving.");
      return;
    }
    const recordedAt = new Date().toISOString();
    saveGymSession({
      id: id("gym"),
      userId: state.currentUserId,
      planId: selectedPlanId ?? undefined,
      name: sessionName.trim() || "Gym session",
      localDate,
      recordedAt,
      durationMinutes: Math.max(0, Number(duration) || 0),
      calories: Number(calories) > 0 ? Number(calories) : undefined,
      exercises: completed,
      visibility: "group",
    });
    setExercises([]);
    setDuration("");
    setCalories("");
    setSelectedPlanId(null);
    Alert.alert("Workout saved", `${completedSets} sets · ${Math.round(volume)} kg volume`);
  }

  function saveRoutine() {
    const valid = exercises.filter((exercise) => exercise.name.trim());
    if (!valid.length) {
      Alert.alert("Add an exercise", "A plan needs at least one exercise.");
      return;
    }
    const now = new Date().toISOString();
    saveGymPlan({
      id: id("plan"),
      userId: state.currentUserId,
      name: sessionName.trim() || "My workout",
      exercises: valid.map((exercise) => ({
        id: id("plan-exercise"),
        name: exercise.name,
        targetSets: exercise.sets.length,
        targetReps: exercise.sets[0]?.reps ?? 10,
        startingWeightKg: exercise.sets[0]?.weightKg || undefined,
      })),
      createdAt: now,
      updatedAt: now,
    });
    Alert.alert("Plan saved", "You can start it again from My plans.");
  }

  return (
    <Screen contentContainerStyle={{ paddingBottom: 14 }} keyboardShouldPersistTaps="handled">
      <PageHeader title="Gym" subtitle="Plans, sets, reps and weight" />

      {plans.length ? (
        <>
          <SectionHeader title="My plans" />
          <View style={styles.chips}>
            {plans.map((plan) => (
              <Pressable
                key={plan.id}
                onPress={() => choosePlan(plan)}
                onLongPress={() =>
                  Alert.alert("Delete plan?", plan.name, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteGymPlan(plan.id) },
                  ])
                }
              >
                <Chip label={plan.name} selected={selectedPlanId === plan.id} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Card style={styles.sessionCard}>
        <View style={styles.dateRow}>
          <Pressable onPress={() => setLocalDate(dateWithOffsetFrom(localDate, -1))}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Text style={[styles.date, { color: colors.ink }]}>{friendlyDate(localDate)}</Text>
          <Pressable
            disabled={localDate >= dateKey()}
            onPress={() => setLocalDate(dateWithOffsetFrom(localDate, 1))}
          >
            <Ionicons
              name="chevron-forward"
              size={24}
              color={localDate >= dateKey() ? colors.faint : colors.ink}
            />
          </Pressable>
        </View>
        <TextInput
          value={sessionName}
          onChangeText={setSessionName}
          placeholder="Workout name"
          placeholderTextColor={colors.faint}
          style={[styles.nameInput, { color: colors.ink, borderColor: colors.border }]}
        />
        <View style={styles.twoColumns}>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.muted }]}>Duration (min)</Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder="Optional"
              placeholderTextColor={colors.faint}
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.muted }]}>Calories</Text>
            <TextInput
              value={calories}
              onChangeText={setCalories}
              keyboardType="number-pad"
              placeholder="Optional"
              placeholderTextColor={colors.faint}
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
            />
          </View>
        </View>
      </Card>

      <SectionHeader title="Exercises" action={<Text style={[styles.summary, { color: accent }]}>{completedSets} sets · {Math.round(volume)} kg</Text>} />
      {exercises.map((exercise) => {
        const open = openExerciseId === exercise.id;
        const done = exercise.sets.filter((set) => set.completed).length;
        return (
          <Card key={exercise.id} style={styles.exerciseCard}>
            <Pressable style={styles.exerciseHeader} onPress={() => setOpenExerciseId(open ? null : exercise.id)}>
              <View style={styles.exerciseCopy}>
                <Text style={[styles.exerciseName, { color: colors.ink }]}>{exercise.name}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{done}/{exercise.sets.length} sets complete</Text>
              </View>
              <Pressable
                accessibilityLabel={`Remove ${exercise.name}`}
                onPress={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))}
              >
                <Ionicons name="trash-outline" size={18} color={colors.faint} />
              </Pressable>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
            </Pressable>
            {open ? (
              <View style={[styles.sets, { borderTopColor: colors.border }]}>
                <View style={styles.setHeader}>
                  <Text style={[styles.setLabel, { color: colors.muted }]}>Done</Text>
                  <Text style={[styles.setValueLabel, { color: colors.muted }]}>kg</Text>
                  <Text style={[styles.setValueLabel, { color: colors.muted }]}>reps</Text>
                </View>
                {exercise.sets.map((set) => (
                  <View key={set.id} style={styles.setRow}>
                    <Pressable
                      accessibilityLabel={set.completed ? "Mark set incomplete" : "Mark set complete"}
                      onPress={() => updateSet(exercise.id, set.id, { completed: !set.completed })}
                    >
                      <Ionicons
                        name={set.completed ? "checkmark-circle" : "ellipse-outline"}
                        size={25}
                        color={set.completed ? accent : colors.faint}
                      />
                    </Pressable>
                    <TextInput
                      value={String(set.weightKg || "")}
                      onChangeText={(value) => updateSet(exercise.id, set.id, { weightKg: Math.max(0, Number(value) || 0) })}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.faint}
                      style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                    />
                    <TextInput
                      value={String(set.reps || "")}
                      onChangeText={(value) => updateSet(exercise.id, set.id, { reps: Math.max(0, Number(value) || 0) })}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.faint}
                      style={[styles.setInput, { color: colors.ink, borderColor: colors.border }]}
                    />
                    <Pressable
                      onPress={() =>
                        setExercises((current) =>
                          current.map((item) =>
                            item.id === exercise.id
                              ? { ...item, sets: item.sets.filter((candidate) => candidate.id !== set.id) }
                              : item,
                          ),
                        )
                      }
                    >
                      <Ionicons name="close" size={19} color={colors.faint} />
                    </Pressable>
                  </View>
                ))}
                <Button label="Add set" variant="ghost" icon="add" onPress={() => addSet(exercise.id)} />
              </View>
            ) : null}
          </Card>
        );
      })}

      <Card style={styles.addCard}>
        <TextInput
          value={exerciseName}
          onChangeText={setExerciseName}
          onSubmitEditing={addExercise}
          returnKeyType="done"
          placeholder="Add an exercise, e.g. Bench press"
          placeholderTextColor={colors.faint}
          style={[styles.addInput, { color: colors.ink, borderColor: colors.border }]}
        />
        <Pressable onPress={addExercise} style={[styles.addButton, { backgroundColor: accent }]}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </Card>

      {exercises.length ? (
        <View style={styles.actions}>
          <View style={styles.action}><Button label="Save as plan" variant="secondary" onPress={saveRoutine} /></View>
          <View style={styles.action}><Button label="Finish workout" icon="checkmark" onPress={saveWorkout} /></View>
        </View>
      ) : null}

      {sessions.length ? (
        <>
          <SectionHeader title="Recent workouts" />
          <Card style={styles.history}>
            {sessions.map((session, index) => (
              <Pressable
                key={session.id}
                onLongPress={() =>
                  Alert.alert("Delete workout?", session.name, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteGymSession(session.id) },
                  ])
                }
                style={[styles.historyRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={styles.exerciseCopy}>
                  <Text style={[styles.exerciseName, { color: colors.ink }]}>{session.name}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>{friendlyDate(session.localDate)} · {completedGymSets(session.exercises)} sets</Text>
                </View>
                <Text style={[styles.historyValue, { color: accent }]}>{Math.round(trainingVolumeKg(session.exercises)).toLocaleString()} kg</Text>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sessionCard: { gap: 10 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22 },
  date: { minWidth: 92, textAlign: "center", fontSize: 12, fontWeight: "900" },
  nameInput: { borderWidth: 1, borderRadius: 12, height: 43, paddingHorizontal: 12, fontSize: 12, fontWeight: "800" },
  twoColumns: { flexDirection: "row", gap: 9 },
  field: { flex: 1, gap: 5 },
  label: { fontSize: 9, fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 10, height: 39, paddingHorizontal: 10, fontSize: 11 },
  summary: { fontSize: 9, fontWeight: "900" },
  exerciseCard: { paddingVertical: 2, paddingHorizontal: 11 },
  exerciseHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  exerciseCopy: { flex: 1 },
  exerciseName: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 9, marginTop: 2 },
  sets: { borderTopWidth: 1, paddingVertical: 9, gap: 7 },
  setHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  setLabel: { width: 34, fontSize: 8, textAlign: "center" },
  setValueLabel: { flex: 1, fontSize: 8, textAlign: "center" },
  setRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  setInput: { flex: 1, height: 38, borderWidth: 1, borderRadius: 9, textAlign: "center", fontSize: 12, fontWeight: "800" },
  addCard: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  addInput: { flex: 1, height: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 11 },
  addButton: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1 },
  history: { paddingVertical: 2, paddingHorizontal: 11 },
  historyRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10 },
  historyValue: { fontSize: 10, fontWeight: "900" },
});
