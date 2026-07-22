import { GymExercise, GymSession } from "@/src/types";

export function completedGymSets(exercises: GymExercise[]) {
  return exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.filter((set) => set.completed).length,
    0,
  );
}

/** Standard strength-training volume: sum of completed reps × load. */
export function trainingVolumeKg(exercises: GymExercise[]) {
  return exercises.reduce(
    (sessionTotal, exercise) =>
      sessionTotal +
      exercise.sets.reduce(
        (exerciseTotal, set) =>
          exerciseTotal +
          (set.completed ? Math.max(0, set.reps) * Math.max(0, set.weightKg) : 0),
        0,
      ),
    0,
  );
}

export function sessionPersonalRecord(session: GymSession) {
  return session.exercises.reduce<{
    exercise: string;
    weightKg: number;
    reps: number;
  } | null>((best, exercise) => {
    const strongest = exercise.sets
      .filter((set) => set.completed)
      .sort((a, b) => b.weightKg - a.weightKg || b.reps - a.reps)[0];
    if (!strongest || (best && strongest.weightKg <= best.weightKg)) return best;
    return {
      exercise: exercise.name,
      weightKg: strongest.weightKg,
      reps: strongest.reps,
    };
  }, null);
}

export function recentGymVolume(sessions: GymSession[], userId: string) {
  return sessions
    .filter((session) => session.userId === userId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, 7)
    .map((session) => ({
      id: session.id,
      date: session.localDate,
      volumeKg: trainingVolumeKg(session.exercises),
    }));
}
