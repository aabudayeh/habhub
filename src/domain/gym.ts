import { dateWithOffsetFrom } from "@/src/domain/date";
import {
  catalogExercise,
  exerciseKey,
  MUSCLE_LABELS,
} from "@/src/domain/exerciseCatalog";
import {
  AppState,
  EnergyProfile,
  GymCalorieCalculationMode,
  GymExercise,
  GymExerciseGoal,
  GymIntensity,
  GymMetricMapping,
  GymSession,
  MuscleGroup,
} from "@/src/types";
import { gymSessionsForDay } from "@/src/domain/dataIndex";

export function completedGymSets(exercises: GymExercise[]) {
  return exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.filter((set) => set.completed).length +
      exercise.sets.filter((set) => set.completed && set.superset).length,
    0,
  );
}

/** Derived gym trackers expose comparable totals without exposing raw set notes. */
export function gymMetricValue(
  state: AppState,
  mapping: GymMetricMapping,
  userId: string,
  localDate: string,
) {
  const sessions = gymSessionsForDay(state.gymSessions, userId, localDate);
  if (!sessions.length) return 0;
  const values = sessions.map((session) =>
    gymSessionMetricValue(session, mapping),
  );
  if (
    mapping.kind === "session_completed" ||
    mapping.kind === "exercise_one_rep_max"
  )
    return Math.max(0, ...values);
  return values.reduce((sum, value) => sum + value, 0);
}

/** Contribution of one saved workout to a derived gym tracker. */
export function gymSessionMetricValue(
  session: GymSession,
  mapping: GymMetricMapping,
) {
  if (mapping.kind === "session_completed")
    return completedGymSets(session.exercises) > 0 ? 1 : 0;
  if (mapping.kind === "session_duration")
    return Math.max(0, session.durationMinutes);
  if (mapping.kind === "session_volume")
    return trainingVolumeKg(session.exercises);
  if (mapping.kind === "completed_sets")
    return completedGymSets(session.exercises);
  if (
    mapping.kind === "exercise_one_rep_max" ||
    mapping.kind === "exercise_volume" ||
    mapping.kind === "exercise_reps" ||
    mapping.kind === "exercise_duration"
  ) {
    const expanded = expandedGymExercises(session.exercises);
    const exercises = expanded.filter(
      (exercise) => exerciseIdentity(exercise) === mapping.exerciseKey,
    );
    if (mapping.kind === "exercise_volume")
      return trainingVolumeKg(exercises);
    if (mapping.kind === "exercise_reps")
      return exercises.reduce(
        (total, exercise) =>
          total +
          exercise.sets.reduce(
            (sets, set) => sets + (set.completed ? Math.max(0, set.reps) : 0),
            0,
          ),
        0,
      );
    if (mapping.kind === "exercise_duration") {
      const measuredSeconds = exercises.reduce(
        (total, exercise) =>
          total +
          exercise.sets.reduce(
            (sets, set) =>
              sets + (set.completed ? Math.max(0, set.workSeconds ?? 0) : 0),
            0,
          ),
        0,
      );
      if (measuredSeconds > 0) return measuredSeconds / 60;
      const completedExerciseCount = expanded.filter((exercise) =>
        exercise.sets.some((set) => set.completed),
      ).length;
      return completedExerciseCount > 0
        ? (Math.max(0, session.durationMinutes) * exercises.length) /
            completedExerciseCount
        : 0;
    }
    return Math.max(
      0,
      ...exercises.flatMap((exercise) =>
        exercise.sets
          .filter((set) => set.completed)
          .map((set) => estimatedOneRepMax(set.weightKg, set.reps)),
      ),
    );
  }
  return trainingVolumeKg(
    expandedGymExercises(session.exercises).filter((exercise) =>
      (exercise.muscleGroups ?? ["full_body"]).includes(mapping.muscleGroup),
    ),
  );
}

/**
 * Returns a stable clock range for a saved workout. Guided sessions retain
 * their exact timestamps; older/manual sessions fall back to their recorded
 * completion time and saved duration.
 */
export function gymSessionClockBounds(session: GymSession) {
  const completedCandidate = session.completedAt ?? session.recordedAt;
  const completedMs = new Date(completedCandidate).getTime();
  if (!Number.isFinite(completedMs)) {
    return {
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    };
  }

  const explicitStartMs = session.startedAt
    ? new Date(session.startedAt).getTime()
    : Number.NaN;
  const fallbackStartMs =
    completedMs - Math.max(0, session.durationMinutes) * 60_000;
  const startedMs = Number.isFinite(explicitStartMs)
    ? Math.min(explicitStartMs, completedMs)
    : fallbackStartMs;

  return {
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
  };
}

export function hasGymMetricData(
  state: AppState,
  mapping: GymMetricMapping,
  userId: string,
  localDate: string,
) {
  const sessions = gymSessionsForDay(state.gymSessions, userId, localDate);
  if (!sessions.length) return false;
  if (mapping.kind === "session_completed") return true;
  if (mapping.kind === "session_duration")
    return sessions.some((session) => session.durationMinutes > 0);
  if (
    mapping.kind === "exercise_one_rep_max" ||
    mapping.kind === "exercise_volume" ||
    mapping.kind === "exercise_reps" ||
    mapping.kind === "exercise_duration"
  )
    return sessions.some((session) =>
      expandedGymExercises(session.exercises).some(
        (exercise) =>
          exerciseIdentity(exercise) === mapping.exerciseKey &&
          exercise.sets.some((set) => set.completed),
      ),
    );
  if (mapping.kind === "muscle_volume")
    return sessions.some((session) =>
      expandedGymExercises(session.exercises).some(
        (exercise) =>
          (exercise.muscleGroups ?? ["full_body"]).includes(
            mapping.muscleGroup,
          ) && exercise.sets.some((set) => set.completed),
      ),
    );
  return sessions.some((session) => completedGymSets(session.exercises) > 0);
}

/** Standard strength-training volume: sum of completed reps × external load. */
export function trainingVolumeKg(exercises: GymExercise[]) {
  return exercises.reduce(
    (sessionTotal, exercise) =>
      sessionTotal +
      exercise.sets.reduce(
        (exerciseTotal, set) =>
          exerciseTotal +
          (set.completed
            ? Math.max(0, set.reps) * Math.max(0, set.weightKg) +
              (set.superset
                ? Math.max(0, set.superset.reps) *
                  Math.max(0, set.superset.weightKg)
                : 0)
            : 0),
        0,
      ),
    0,
  );
}

/** Epley estimate. It is shown only as a training trend, never a safe load prescription. */
export function estimatedOneRepMax(weightKg: number, reps: number) {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + Math.min(reps, 12) / 30);
}

export function exerciseIdentity(exercise: Pick<GymExercise, "name" | "exerciseKey">) {
  return exerciseKey(exercise.name, exercise.exerciseKey);
}

/**
 * Presents paired superset movements as normal exercise observations without
 * duplicating them in the editable workout structure.
 */
export function expandedGymExercises(exercises: GymExercise[]) {
  const primary = exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set, superset: undefined })),
  }));
  const paired = new Map<string, GymExercise>();
  exercises.forEach((exercise) => {
    exercise.sets.forEach((set) => {
      if (!set.completed || !set.superset) return;
      const key = exerciseKey(set.superset.name, set.superset.exerciseKey);
      const existing = paired.get(key);
      const pairedSet = {
        id: `${set.id}:superset`,
        reps: set.superset.reps,
        weightKg: set.superset.weightKg,
        completed: true,
        workSeconds:
          set.superset.workSeconds ??
          (set.workSeconds ? Math.max(1, Math.round(set.workSeconds / 2)) : undefined),
      };
      if (existing) existing.sets.push(pairedSet);
      else
        paired.set(key, {
          id: `${exercise.id}:superset:${key}`,
          exerciseKey: key,
          name: set.superset.name,
          muscleGroups: set.superset.muscleGroups,
          customMet: set.superset.customMet,
          completed: true,
          sets: [pairedSet],
        });
    });
  });
  return [...primary, ...paired.values()];
}

export type ExerciseObservation = {
  sessionId: string;
  localDate: string;
  name: string;
  maxWeightKg: number;
  repsAtMax: number;
  estimatedOneRepMaxKg: number;
  volumeKg: number;
  completedSets: number;
  workSeconds: number;
  muscles: MuscleGroup[];
};

export function exerciseHistory(
  sessions: GymSession[],
  userId: string,
  key: string,
) {
  return sessions
    .filter((session) => session.userId === userId)
    .flatMap((session) =>
      expandedGymExercises(session.exercises)
        .filter((exercise) => exerciseIdentity(exercise) === key)
        .map((exercise): ExerciseObservation => {
          const sets = exercise.sets.filter((set) => set.completed);
          const max = [...sets].sort(
            (a, b) => b.weightKg - a.weightKg || b.reps - a.reps,
          )[0];
          return {
            sessionId: session.id,
            localDate: session.localDate,
            name: exercise.name,
            maxWeightKg: max?.weightKg ?? 0,
            repsAtMax: max?.reps ?? 0,
            estimatedOneRepMaxKg: Math.max(
              0,
              ...sets.map((set) =>
                estimatedOneRepMax(set.weightKg, set.reps),
              ),
            ),
            volumeKg: sets.reduce(
              (sum, set) => sum + set.weightKg * set.reps,
              0,
            ),
            completedSets: sets.length,
            workSeconds: sets.reduce(
              (sum, set) => sum + Math.max(0, set.workSeconds ?? 0),
              0,
            ),
            muscles: exercise.muscleGroups ?? [],
          };
        }),
    )
    .filter((item) => item.completedSets > 0)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}

export type GymTrend = "building" | "steady" | "regressing" | "learning";

/**
 * Conservative trend classification:
 * - no judgement before 4 logged exposures across >=21 days;
 * - building at >=2% estimated-1RM improvement;
 * - orange/steady only after 28 days without a 2% best;
 * - regressing only after two recent observations average >=5% below baseline.
 *
 * The 2% threshold is deliberately below ACSM's 2–10% load-progression band,
 * while the exposure gate avoids judging occasional gym visits.
 */
export function exerciseTrend(history: ExerciseObservation[]): GymTrend {
  if (
    history.length < 4 ||
    daysBetween(history[0].localDate, history.at(-1)!.localDate) < 21
  )
    return "learning";
  const recent = history.slice(-2);
  const prior = history.slice(0, -2);
  const recentBest = Math.max(...recent.map((item) => item.estimatedOneRepMaxKg));
  const priorBest = Math.max(...prior.map((item) => item.estimatedOneRepMaxKg));
  if (priorBest > 0 && recentBest >= priorBest * 1.02) return "building";
  const recentAverage =
    recent.reduce((sum, item) => sum + item.estimatedOneRepMaxKg, 0) /
    recent.length;
  const priorRecent = prior.slice(-2);
  const priorAverage =
    priorRecent.reduce((sum, item) => sum + item.estimatedOneRepMaxKg, 0) /
    Math.max(priorRecent.length, 1);
  if (priorAverage > 0 && recentAverage < priorAverage * 0.95)
    return "regressing";
  return daysBetween(
    prior.find(
      (item) => item.estimatedOneRepMaxKg >= priorBest * 0.99,
    )?.localDate ?? history[0].localDate,
    history.at(-1)!.localDate,
  ) >= 28
    ? "steady"
    : "learning";
}

export function exerciseStats(
  sessions: GymSession[],
  userId: string,
  key: string,
  goal?: GymExerciseGoal,
) {
  const history = exerciseHistory(sessions, userId, key);
  const first = history[0];
  const latest = history.at(-1);
  const bestOneRepMax = Math.max(
    0,
    ...history.map((item) => item.estimatedOneRepMaxKg),
  );
  const bestWeight = Math.max(0, ...history.map((item) => item.maxWeightKg));
  const bestWeightObservation = [...history]
    .reverse()
    .find((item) => item.maxWeightKg === bestWeight);
  const improvement =
    first?.estimatedOneRepMaxKg && latest
      ? ((latest.estimatedOneRepMaxKg - first.estimatedOneRepMaxKg) /
          first.estimatedOneRepMaxKg) *
        100
      : 0;
  const target = goal?.targetOneRepMaxKg ?? 0;
  const timedHistory = history.filter((item) => item.workSeconds > 0);
  return {
    history,
    trend: exerciseTrend(history),
    bestOneRepMax,
    bestWeight,
    repsAtBestWeight: bestWeightObservation?.repsAtMax ?? 0,
    improvement,
    sessions: history.length,
    averageWorkSeconds: timedHistory.length
      ? Math.round(
          timedHistory.reduce((sum, item) => sum + item.workSeconds, 0) /
            timedHistory.length,
        )
      : 0,
    goalProgress: target > 0 ? Math.min(1, bestOneRepMax / target) : 0,
  };
}

export function muscleGroupStats(sessions: GymSession[], userId: string) {
  const map = new Map<
    MuscleGroup,
    {
      muscle: MuscleGroup;
      volumeKg: number;
      sets: number;
      sessions: Set<string>;
      restSeconds: number;
      restSamples: number;
      workSeconds: number;
    }
  >();
  for (const session of sessions.filter((item) => item.userId === userId)) {
    for (const exercise of expandedGymExercises(session.exercises)) {
      const muscles = exercise.muscleGroups?.length
        ? exercise.muscleGroups
        : ["full_body" as const];
      const volume = trainingVolumeKg([exercise]) / muscles.length;
      const sets =
        exercise.sets.filter((set) => set.completed).length / muscles.length;
      const rests = exercise.sets.filter(
        (set) => (set.restSeconds ?? 0) > 0,
      );
      const restSeconds =
        (rests.reduce((sum, set) => sum + (set.restSeconds ?? 0), 0) +
          (exercise.restAfterSeconds ?? 0)) /
        muscles.length;
      const restSamples =
        (rests.length + (exercise.restAfterSeconds ? 1 : 0)) / muscles.length;
      const workSeconds =
        exercise.sets.reduce(
          (sum, set) => sum + Math.max(0, set.workSeconds ?? 0),
          0,
        ) / muscles.length;
      for (const muscle of muscles) {
        const current = map.get(muscle) ?? {
          muscle,
          volumeKg: 0,
          sets: 0,
          sessions: new Set<string>(),
          restSeconds: 0,
          restSamples: 0,
          workSeconds: 0,
        };
        current.volumeKg += volume;
        current.sets += sets;
        current.restSeconds += restSeconds;
        current.restSamples += restSamples;
        current.workSeconds += workSeconds;
        current.sessions.add(session.id);
        map.set(muscle, current);
      }
    }
  }
  return [...map.values()]
    .map((item) => ({
      muscle: item.muscle,
      label: MUSCLE_LABELS[item.muscle],
      volumeKg: item.volumeKg,
      sets: item.sets,
      sessions: item.sessions.size,
      averageRestSeconds: item.restSamples
        ? Math.round(item.restSeconds / item.restSamples)
        : 0,
      averageWorkSeconds: item.sessions.size
        ? Math.round(item.workSeconds / item.sessions.size)
        : 0,
    }))
    .sort((a, b) => b.volumeKg - a.volumeKg);
}

const METS: Record<GymIntensity, number> = {
  light: 3.5,
  moderate: 5,
  vigorous: 6,
};

export function totalGymRestSeconds(exercises: GymExercise[]) {
  return exercises.reduce(
    (total, exercise) =>
      total +
      Math.max(0, exercise.restAfterSeconds ?? 0) +
      exercise.sets.reduce(
        (sum, set) => sum + Math.max(0, set.restSeconds ?? 0),
        0,
      ),
    0,
  );
}

export function totalGymSetWorkSeconds(exercises: GymExercise[]) {
  return exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.reduce(
        (sum, set) =>
          sum +
          Math.max(0, set.workSeconds ?? 0) +
          Math.max(0, set.superset?.workSeconds ?? 0),
        0,
      ),
    0,
  );
}

export function gymRestBreakdown(exercises: GymExercise[]) {
  const setRests = exercises.flatMap((exercise) =>
    exercise.sets
      .map((set) => set.restSeconds)
      .filter((value): value is number => value !== undefined && value > 0),
  );
  const exerciseRests = exercises
    .map((exercise) => exercise.restAfterSeconds)
    .filter((value): value is number => value !== undefined && value > 0);
  const setRestSeconds = setRests.reduce((sum, value) => sum + value, 0);
  const exerciseRestSeconds = exerciseRests.reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    setRestSeconds,
    exerciseRestSeconds,
    totalRestSeconds: setRestSeconds + exerciseRestSeconds,
    averageSetRestSeconds: setRests.length
      ? Math.round(setRestSeconds / setRests.length)
      : 0,
    averageExerciseRestSeconds: exerciseRests.length
      ? Math.round(exerciseRestSeconds / exerciseRests.length)
      : 0,
  };
}

export function gymSessionTimeBreakdown(
  durationMinutes: number,
  exercises: GymExercise[],
) {
  const rest = gymRestBreakdown(exercises);
  const recordedWorkSeconds = totalGymSetWorkSeconds(exercises);
  const recordedTotalSeconds =
    recordedWorkSeconds + rest.totalRestSeconds;
  const totalSeconds = Math.max(
    recordedTotalSeconds,
    Math.max(0, Math.round(durationMinutes * 60)),
  );
  const restSeconds = Math.min(totalSeconds, rest.totalRestSeconds);
  return {
    totalSeconds,
    restSeconds,
    exerciseSeconds:
      recordedWorkSeconds || Math.max(0, totalSeconds - restSeconds),
    setRestSeconds: rest.setRestSeconds,
    exerciseRestSeconds: rest.exerciseRestSeconds,
    averageSetRestSeconds: rest.averageSetRestSeconds,
    averageExerciseRestSeconds: rest.averageExerciseRestSeconds,
  };
}

export function formatGymDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!minutes) return `${remainder}s`;
  if (!remainder) return `${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

export function averageGymRestSeconds(exercises: GymExercise[]) {
  const breakdown = gymRestBreakdown(exercises);
  const sampleCount =
    exercises.reduce(
      (total, exercise) =>
        total +
        exercise.sets.filter((set) => (set.restSeconds ?? 0) > 0).length,
      0,
    ) +
    exercises.filter((exercise) => (exercise.restAfterSeconds ?? 0) > 0)
      .length;
  return sampleCount
    ? Math.round(breakdown.totalRestSeconds / sampleCount)
    : 0;
}

export function recommendedRestSeconds(intensity: GymIntensity) {
  return intensity === "vigorous" ? 150 : intensity === "light" ? 60 : 90;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function intensityAdjustedMet(
  catalogMet: number,
  intensity: GymIntensity,
) {
  return intensity === "light"
    ? Math.min(catalogMet, METS.light)
    : intensity === "vigorous"
      ? Math.max(catalogMet, METS.vigorous)
      : catalogMet;
}

function netMetCalories(
  met: number,
  weightKg: number,
  durationMinutes: number,
) {
  return ((Math.max(1, met) - 1) * 3.5 * weightKg * durationMinutes) / 200;
}

/** Standard whole-session estimate from the selected Compendium MET. */
function estimateSessionMetCalories(
  weightKg: number,
  durationMinutes: number,
  intensity: GymIntensity,
  exercises: GymExercise[] = [],
) {
  const completed = expandedGymExercises(exercises)
    .map((exercise) => ({
      met: exercise.customMet ?? METS[intensity],
      sets: exercise.sets.filter((set) => set.completed).length,
    }))
    .filter((item) => item.sets > 0);
  const totalSets = completed.reduce((sum, item) => sum + item.sets, 0);
  const catalogMet = totalSets
    ? completed.reduce((sum, item) => sum + item.met * item.sets, 0) / totalSets
    : METS[intensity];
  const met = intensityAdjustedMet(catalogMet, intensity);
  // This mode deliberately remains the plain, reproducible Compendium
  // estimate. Load, reps and set timing belong to the optional set-aware mode.
  return Math.max(0, Math.round(netMetCalories(met, weightKg, durationMinutes)));
}

type GymEnergyProfile = Pick<EnergyProfile, "heightCm" | "weightKg">;

function normalizeGymProfile(profileOrWeight: GymEnergyProfile | number) {
  const profile =
    typeof profileOrWeight === "number"
      ? { weightKg: profileOrWeight, heightCm: 172 }
      : profileOrWeight;
  return {
    weightKg: clamp(Number(profile.weightKg) || 70, 35, 300),
    heightM: clamp((Number(profile.heightCm) || 172) / 100, 1.3, 2.2),
  };
}

type MechanicalMovement = {
  /** Approximate positive vertical travel as a share of stature. */
  travelHeightRatio: number;
  /** Share of body mass whose centre of mass is appreciably raised. */
  bodyMassFraction: number;
  /** Machine/cable stacks do not map one-to-one to moved external mass. */
  externalLoadFactor: number;
};

function mechanicalMovement(exercise: GymExercise): MechanicalMovement {
  const key = exerciseIdentity(exercise);
  const equipment = catalogExercise(key)?.equipment;
  const externalLoadFactor =
    equipment === "machine" || equipment === "cable" ? 0.75 : 1;

  // Isometric and horizontal-resistance work cannot be represented by m*g*h;
  // their catalog MET remains the set-aware estimate's anchor.
  if (/(plank|farmer_carry|sled_push|battle_ropes)/.test(key))
    return { travelHeightRatio: 0, bodyMassFraction: 0, externalLoadFactor: 0 };
  if (key === "assisted_pull_up")
    return { travelHeightRatio: 0.25, bodyMassFraction: 1, externalLoadFactor: -1 };
  if (/(pull_up|chest_dip)/.test(key))
    return { travelHeightRatio: 0.25, bodyMassFraction: 1, externalLoadFactor: 1 };
  if (key === "push_up")
    return { travelHeightRatio: 0.18, bodyMassFraction: 0.69, externalLoadFactor: 1 };
  if (/(back_squat|front_squat|goblet_squat|hack_squat|bulgarian_split_squat|walking_lunge)/.test(key))
    return { travelHeightRatio: 0.28, bodyMassFraction: 0.65, externalLoadFactor };
  if (/(deadlift|good_morning)/.test(key))
    return { travelHeightRatio: 0.28, bodyMassFraction: 0.25, externalLoadFactor };
  if (key === "leg_press")
    return { travelHeightRatio: 0.22, bodyMassFraction: 0, externalLoadFactor };
  if (/(hip_thrust|glute_bridge)/.test(key))
    return { travelHeightRatio: 0.14, bodyMassFraction: 0.45, externalLoadFactor };
  if (/(calf_raise)/.test(key))
    return { travelHeightRatio: 0.06, bodyMassFraction: 0.65, externalLoadFactor };
  if (/(bench_press|close_grip_bench)/.test(key))
    return { travelHeightRatio: 0.25, bodyMassFraction: 0.08, externalLoadFactor };
  if (/(overhead_press|shoulder_press|arnold_press)/.test(key))
    return { travelHeightRatio: 0.24, bodyMassFraction: 0.08, externalLoadFactor };
  if (/(row|pulldown|pull|face_pull)/.test(key))
    return { travelHeightRatio: 0.21, bodyMassFraction: 0.05, externalLoadFactor };
  if (/(burpee|mountain_climber)/.test(key))
    return { travelHeightRatio: 0.25, bodyMassFraction: 0.7, externalLoadFactor: 1 };
  if (/(leg_raise|back_extension|ab_wheel|russian_twist)/.test(key))
    return { travelHeightRatio: 0.14, bodyMassFraction: 0.3, externalLoadFactor };
  if (key === "kettlebell_swing")
    return { travelHeightRatio: 0.25, bodyMassFraction: 0.1, externalLoadFactor: 1 };
  if (equipment === "bodyweight")
    return { travelHeightRatio: 0.18, bodyMassFraction: 0.55, externalLoadFactor: 1 };
  if (/(curl|extension|fly|raise|pushdown|kickback|abduction|crunch)/.test(key))
    return { travelHeightRatio: 0.15, bodyMassFraction: 0.03, externalLoadFactor };
  return { travelHeightRatio: 0.18, bodyMassFraction: 0.08, externalLoadFactor };
}

function positiveSetWorkJoules(
  exercise: GymExercise,
  set: GymExercise["sets"][number],
  weightKg: number,
  heightM: number,
) {
  const movement = mechanicalMovement(exercise);
  if (movement.travelHeightRatio <= 0 || set.reps <= 0) return 0;
  const externalMass = Math.max(0, set.weightKg);
  const effectiveMass =
    movement.externalLoadFactor < 0
      ? Math.max(0, weightKg * movement.bodyMassFraction - externalMass)
      : weightKg * movement.bodyMassFraction +
        externalMass * movement.externalLoadFactor;
  return (
    effectiveMass *
    9.80665 *
    heightM *
    movement.travelHeightRatio *
    Math.max(0, set.reps)
  );
}

/**
 * Set-aware resistance-training estimate.
 *
 * The Compendium MET is still the evidence-based anchor because lifted kg and
 * reps do not directly determine energy expenditure. Exercise METs are
 * weighted by recorded active-set time (or a conservative 3 seconds per rep
 * fallback). A bounded mechanical-work signal (effective mass x gravity x
 * estimated vertical travel x reps) makes load and repetitions meaningful
 * without pretending that external work converts directly to human calories.
 * Body mass, workout duration and measured time remain the main drivers.
 *
 * References:
 * https://pacompendium.com/conditioning-exercise/
 * https://doi.org/10.1519/00124278-200702000-00023
 * https://doi.org/10.3390/sports6040137
 * https://doi.org/10.1111/cpf.12604
 */
function estimateSetAwareCalories(
  profileOrWeight: GymEnergyProfile | number,
  durationMinutes: number,
  intensity: GymIntensity,
  exercises: GymExercise[],
) {
  const { weightKg, heightM } = normalizeGymProfile(profileOrWeight);
  const completed = exercises.flatMap((exercise) =>
    exercise.sets
      .filter((set) => set.completed)
      .flatMap((set) => {
        const primary = {
          exercise,
          set,
          met: intensityAdjustedMet(
            exercise.customMet ?? METS[intensity],
            intensity,
          ),
          reps: Math.max(0, set.reps),
          weightKg: Math.max(0, set.weightKg),
          measuredWorkSeconds: Math.max(0, set.workSeconds ?? 0),
        };
        if (!set.superset) return [primary];
        const pairedExercise: GymExercise = {
          id: `${exercise.id}:superset:${set.id}`,
          exerciseKey: set.superset.exerciseKey,
          name: set.superset.name,
          muscleGroups: set.superset.muscleGroups,
          customMet: set.superset.customMet,
          sets: [],
        };
        const pairedSet = {
          ...set,
          reps: set.superset.reps,
          weightKg: set.superset.weightKg,
          workSeconds:
            set.superset.workSeconds ??
            (set.workSeconds ? Math.max(1, Math.round(set.workSeconds / 2)) : undefined),
          superset: undefined,
        };
        return [
          primary,
          {
            exercise: pairedExercise,
            set: pairedSet,
            met: intensityAdjustedMet(
              set.superset.customMet ?? METS[intensity],
              intensity,
            ),
            reps: Math.max(0, pairedSet.reps),
            weightKg: Math.max(0, pairedSet.weightKg),
            measuredWorkSeconds: Math.max(0, pairedSet.workSeconds ?? 0),
          },
        ];
      }),
  );
  if (!completed.length || weightKg <= 0 || durationMinutes <= 0) return 0;

  const hasMeasuredWork = completed.some(
    (set) => set.measuredWorkSeconds > 0,
  );
  const setWork = completed.map((set) => ({
    ...set,
    workSeconds:
      set.measuredWorkSeconds > 0
        ? set.measuredWorkSeconds
        : clamp(set.reps * 3, 12, 60),
  }));
  const sessionSeconds = Math.max(1, durationMinutes * 60);
  const rawWorkSeconds = setWork.reduce(
    (sum, set) => sum + set.workSeconds,
    0,
  );
  // Erroneous or overlapping timer records must not exceed session duration.
  const workScale = Math.min(1, sessionSeconds / Math.max(rawWorkSeconds, 1));
  const workSeconds = rawWorkSeconds * workScale;
  const timeWeightedMet =
    setWork.reduce(
      (sum, set) => sum + set.met * set.workSeconds * workScale,
      0,
    ) / Math.max(workSeconds, 1);

  const activeShare = clamp(workSeconds / sessionSeconds, 0, 1);
  const rawTimingModifier = clamp(
    1 + (activeShare - 0.25) * 0.55,
    0.86,
    1.12,
  );
  // Heuristic rep timing carries less weight than an actual guided timer.
  const timingModifier = hasMeasuredWork
    ? rawTimingModifier
    : 1 + (rawTimingModifier - 1) * 0.35;

  const totalReps = setWork.reduce((sum, set) => sum + set.reps, 0);
  const averageReps = totalReps / completed.length;
  const positiveWorkJoules = completed.reduce(
    (sum, item) =>
      sum +
      positiveSetWorkJoules(
        item.exercise,
        item.set,
        weightKg,
        heightM,
      ),
    0,
  );
  // A reference set is ten repetitions raising body mass through 12% of
  // stature. Its only purpose is to normalize mechanical work; joules are not
  // presented as measured metabolic calories. This makes load and reps matter
  // without claiming a universal lifting efficiency that research does not
  // support across exercise types.
  const referenceSetWorkJoules =
    weightKg * 9.80665 * heightM * 0.12 * 10;
  const mechanicalDemand =
    positiveWorkJoules > 0
      ? positiveWorkJoules /
        Math.max(referenceSetWorkJoules * completed.length, 1)
      : 0;
  // Log scaling keeps load/repetition changes visible at ordinary training
  // weights without letting very heavy sets dominate the session estimate.
  // At equal duration, common load or rep progressions produce a noticeable
  // correction, while the Compendium MET remains the physiological anchor.
  const mechanicalModifier =
    mechanicalDemand > 0
      ? clamp(0.78 + 0.24 * Math.log2(1 + mechanicalDemand), 0.8, 1.35)
      : 1;

  // Retain a small density signal for exercises where displacement is unknown
  // (isometrics, carries and sled work). For mechanically modeled movements,
  // reps already contribute directly through positive work.
  const fallbackDensityModifier =
    mechanicalDemand > 0
      ? 1
      : clamp(0.96 + Math.min(0.08, averageReps * 0.005), 0.96, 1.04);
  const workloadModifier = mechanicalModifier * fallbackDensityModifier;

  const compendiumAnchor = netMetCalories(
    timeWeightedMet,
    weightKg,
    durationMinutes,
  );
  const adjusted = compendiumAnchor * timingModifier * workloadModifier;
  return Math.max(
    0,
    Math.round(
      clamp(
        adjusted,
        compendiumAnchor * 0.7,
        compendiumAnchor * 1.4,
      ),
    ),
  );
}

/**
 * Net active energy: 1 MET is subtracted so resting energy already represented
 * by BMR is not counted a second time. The default is the plain whole-session
 * MET estimate; set-aware is an explicit opt-in.
 */
export function estimateGymActiveCalories(
  profileOrWeight: GymEnergyProfile | number,
  durationMinutes: number,
  intensity: GymIntensity,
  exercises: GymExercise[] = [],
  mode: GymCalorieCalculationMode = "session_met",
) {
  const { weightKg } = normalizeGymProfile(profileOrWeight);
  return mode === "set_aware"
    ? estimateSetAwareCalories(
        profileOrWeight,
        durationMinutes,
        intensity,
        exercises,
      )
    : estimateSessionMetCalories(
        weightKg,
        durationMinutes,
        intensity,
        exercises,
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

export type GymRecapCard = {
  id: string;
  title: string;
  body: string;
  tone: "positive" | "attention" | "neutral";
};

export function gymRecap(
  sessions: GymSession[],
  userId: string,
  anchor: string,
) {
  const mine = sessions
    .filter(
      (session) =>
        session.userId === userId &&
        session.localDate <= anchor &&
        session.localDate >= dateWithOffsetFrom(anchor, -59),
    )
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  if (!mine.length)
    return [
      {
        id: "start",
        title: "Your first baseline",
        body: "Complete a workout to start exercise and muscle-group trends.",
        tone: "neutral",
      },
    ] satisfies GymRecapCard[];
  const cards: GymRecapCard[] = [];
  const last7 = mine.filter(
    (item) => item.localDate >= dateWithOffsetFrom(anchor, -6),
  );
  const prior7 = mine.filter(
    (item) =>
      item.localDate >= dateWithOffsetFrom(anchor, -13) &&
      item.localDate < dateWithOffsetFrom(anchor, -6),
  );
  const volume = (items: GymSession[]) =>
    items.reduce((sum, session) => sum + trainingVolumeKg(session.exercises), 0);
  const currentVolume = volume(last7);
  const priorVolume = volume(prior7);
  const volumeChange = priorVolume
    ? ((currentVolume - priorVolume) / priorVolume) * 100
    : 0;
  cards.push({
    id: "week",
    title: `${last7.length} workout${last7.length === 1 ? "" : "s"} this week`,
    body: prior7.length
      ? `${Math.round(currentVolume).toLocaleString()} kg volume versus ${Math.round(priorVolume).toLocaleString()} kg in the prior seven days (${volumeChange >= 0 ? "+" : ""}${volumeChange.toFixed(0)}%).`
      : `${Math.round(currentVolume).toLocaleString()} kg of completed-set volume logged.`,
    tone: last7.length >= 2 ? "positive" : "neutral",
  });
  const keys = [
    ...new Set(
      mine.flatMap((session) =>
        session.exercises.map((exercise) => exerciseIdentity(exercise)),
      ),
    ),
  ];
  const trends = keys.map((key) => ({
    key,
    name:
      mine
        .flatMap((item) => item.exercises)
        .find((exercise) => exerciseIdentity(exercise) === key)?.name ?? key,
    stats: exerciseStats(mine, userId, key),
  }));
  const improved = trends
    .filter((item) => item.stats.trend === "building")
    .sort((a, b) => b.stats.improvement - a.stats.improvement)[0];
  if (improved)
    cards.push({
      id: "best",
      title: `${improved.name} is moving`,
      body: `${Math.max(0, improved.stats.improvement).toFixed(1)}% estimated-strength improvement from your first logged session.`,
      tone: "positive",
    });
  const stagnant = trends.find((item) => item.stats.trend === "steady");
  if (stagnant)
    cards.push({
      id: "stagnant",
      title: `Review ${stagnant.name}`,
      body: "No clear estimated-strength best for at least four weeks. Recovery, technique, repetitions, or a small 2–10% load progression may be worth reviewing.",
      tone: "attention",
    });
  const muscles = muscleGroupStats(mine, userId);
  if (muscles.length)
    cards.push({
      id: "muscle",
      title: `${muscles[0].label} leads your volume`,
      body: `${Math.round(muscles[0].sets)} allocated sets across ${muscles[0].sessions} sessions in the selected history.`,
      tone: "neutral",
    });
  const recentRest = last7.flatMap((session) =>
    session.exercises.flatMap((exercise) => [
      ...exercise.sets
        .map((set) => set.restSeconds)
        .filter((value): value is number => value !== undefined && value > 0),
      ...(exercise.restAfterSeconds ? [exercise.restAfterSeconds] : []),
    ]),
  );
  if (recentRest.length) {
    const average = Math.round(
      recentRest.reduce((sum, value) => sum + value, 0) / recentRest.length,
    );
    cards.push({
      id: "rest",
      title: `${average}s average rest`,
      body:
        average > 210
          ? "Your logged rests are long. That can suit heavy strength work; review unusually long gaps if they were accidental."
          : "Rest timing is now included in your workout and calorie estimate.",
      tone: average > 210 ? "attention" : "neutral",
    });
  }
  return cards.slice(0, 6);
}

function daysBetween(from: string, to: string) {
  return Math.max(
    0,
    Math.round(
      (new Date(`${to}T12:00:00`).getTime() -
        new Date(`${from}T12:00:00`).getTime()) /
        86400000,
    ),
  );
}
