import { dateKey } from "@/src/domain/date";
import {
  completedGymDistanceKm,
  completedGymSets,
  estimateGymActiveCalories,
  gymSessionEntryNote,
  gymSessionDistanceKm,
  gymSessionWorkoutSample,
  gymSessionVisibilityForMetric,
  recommendedRestSeconds,
} from "@/src/domain/gym";
import { workoutQualifies } from "@/src/domain/workoutQualification";
import { inferStepCoverageActivityFromGymSession } from "@/src/domain/stepCoveragePreferences";
import type {
  AppState,
  GymCalorieCalculationMode,
  GymExercise,
  GymIntensity,
  GymSession,
  MetricEntry,
  Visibility,
} from "@/src/types";

export const BACKGROUND_WORKOUT_COMPLETION_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;
export const STORED_WORKOUT_DRAFT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export type NativeWorkoutActionName =
  | "workout-next"
  | "workout-pause"
  | "workout-finish";

export type NativeWorkoutActionReceipt = {
  action: NativeWorkoutActionName;
  occurredAt: number;
  ownerId: string;
  generation: string;
};

export type StoredRunningWorkoutPhase =
  | "work"
  | "set_rest"
  | "exercise_rest";
export type StoredWorkoutPhase = StoredRunningWorkoutPhase | "paused";

export type StoredWorkoutTimer = {
  mode: "guided" | "whole_workout";
  phase: StoredWorkoutPhase;
  resumePhase?: StoredRunningWorkoutPhase;
  startedAt: number;
  phaseStartedAt: number;
  phaseElapsedSeconds: number;
  completedElapsedSeconds: number;
  pausedSeconds: number;
  pauseStartedAt?: number;
  exerciseId: string;
  setId?: string;
};

export type StoredWorkoutDraft = {
  savedAt: number;
  localDate: string;
  sessionId: string;
  sessionName: string;
  duration: string;
  durationManual?: boolean;
  calories: string;
  calorieCalculationMode: GymCalorieCalculationMode;
  intensity: GymIntensity;
  sessionNotes: string;
  sessionImageUri?: string;
  sessionImageStoragePath?: string;
  visibility: Visibility;
  selectedPlanId: string | null;
  setStartDelaySeconds: number;
  exercises: GymExercise[];
  timer: StoredWorkoutTimer;
  processedWebWorkoutActionIds?: string[];
  /** Native receipts already reflected in this exact durable draft snapshot. */
  processedNativeWorkoutActionIds?: string[];
};

export type BackgroundWorkoutCompletion = {
  ownerId: string;
  generation: string;
  occurredAt: number;
  /** Exact same-id session seen before Finish; null means Finish created it. */
  baseSession: GymSession | null;
  session: GymSession;
};

export type BackgroundWorkoutCompletionResolution =
  | "applied"
  | "already_applied"
  | "superseded";

type WorkoutFinishState = Pick<
  AppState,
  "currentUserId" | "entries" | "gymSessions" | "metrics" | "settings"
>;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function nativeWorkoutActionReceiptId(
  action: NativeWorkoutActionReceipt,
) {
  return `${action.ownerId}:${action.generation}:${action.action}:${action.occurredAt}`;
}

export function parseStoredWorkoutDraft(
  raw: string | null,
  now = Date.now(),
): StoredWorkoutDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<StoredWorkoutDraft>;
    const timer = draft.timer as Partial<StoredWorkoutTimer> | undefined;
    if (
      !finiteNumber(draft.savedAt) ||
      draft.savedAt > now + 60_000 ||
      now - draft.savedAt > STORED_WORKOUT_DRAFT_MAX_AGE_MS ||
      typeof draft.localDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.localDate) ||
      typeof draft.sessionId !== "string" ||
      !draft.sessionId ||
      typeof draft.sessionName !== "string" ||
      typeof draft.duration !== "string" ||
      (draft.durationManual !== undefined &&
        typeof draft.durationManual !== "boolean") ||
      typeof draft.calories !== "string" ||
      !["session_met", "set_aware"].includes(
        draft.calorieCalculationMode ?? "",
      ) ||
      !["light", "moderate", "vigorous"].includes(draft.intensity ?? "") ||
      typeof draft.sessionNotes !== "string" ||
      (draft.sessionImageUri !== undefined &&
        typeof draft.sessionImageUri !== "string") ||
      (draft.sessionImageStoragePath !== undefined &&
        typeof draft.sessionImageStoragePath !== "string") ||
      !["private", "group", "status"].includes(draft.visibility ?? "") ||
      (draft.selectedPlanId !== null &&
        typeof draft.selectedPlanId !== "string") ||
      !finiteNumber(draft.setStartDelaySeconds) ||
      !Array.isArray(draft.exercises) ||
      !timer ||
      !["guided", "whole_workout"].includes(timer.mode ?? "") ||
      !["work", "set_rest", "exercise_rest", "paused"].includes(
        timer.phase ?? "",
      ) ||
      !finiteNumber(timer.startedAt) ||
      !finiteNumber(timer.phaseStartedAt) ||
      !finiteNumber(timer.phaseElapsedSeconds) ||
      !finiteNumber(timer.completedElapsedSeconds) ||
      !finiteNumber(timer.pausedSeconds) ||
      typeof timer.exerciseId !== "string"
    )
      return null;
    return draft as StoredWorkoutDraft;
  } catch {
    return null;
  }
}

export function timerPhaseElapsedSeconds(
  timer: StoredWorkoutTimer,
  now: number,
) {
  return (
    timer.phaseElapsedSeconds +
    (timer.phase === "paused"
      ? 0
      : Math.max(0, Math.floor((now - timer.phaseStartedAt) / 1000)))
  );
}

function firstPendingTarget(
  exercises: GymExercise[],
  startExerciseIndex = 0,
) {
  for (let index = startExerciseIndex; index < exercises.length; index += 1) {
    const exercise = exercises[index];
    const set = exercise.sets.find((item) => !item.completed);
    if (set) return { exercise, set, exerciseIndex: index };
  }
  return null;
}

export function recordStoredWorkoutTimerPhase(
  source: GymExercise[],
  timer: StoredWorkoutTimer,
  elapsedSeconds: number,
  intensity: GymIntensity,
  setStartDelaySeconds: number,
) {
  return source.map((exercise) => {
    if (exercise.id !== timer.exerciseId) return exercise;
    if (timer.phase === "exercise_rest")
      return {
        ...exercise,
        restAfterSeconds:
          Math.max(0, exercise.restAfterSeconds ?? 0) + elapsedSeconds,
        restTargetSeconds: Math.max(120, recommendedRestSeconds(intensity)),
      };
    return {
      ...exercise,
      sets: exercise.sets.map((set) => {
        if (set.id !== timer.setId) return set;
        if (timer.phase === "set_rest")
          return {
            ...set,
            restSeconds: Math.max(0, set.restSeconds ?? 0) + elapsedSeconds,
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

function pauseOrResumeStoredWorkout(
  draft: StoredWorkoutDraft,
  occurredAt: number,
): StoredWorkoutDraft {
  const timer = draft.timer;
  const now = Math.max(timer.phaseStartedAt, occurredAt);
  if (timer.phase === "paused")
    return {
      ...draft,
      timer: {
        ...timer,
        phase: timer.resumePhase ?? "work",
        resumePhase: undefined,
        phaseStartedAt: now,
        pausedSeconds:
          timer.pausedSeconds +
          Math.max(
            0,
            Math.floor((now - (timer.pauseStartedAt ?? now)) / 1000),
          ),
        pauseStartedAt: undefined,
      },
    } satisfies StoredWorkoutDraft;
  return {
    ...draft,
    timer: {
      ...timer,
      phase: "paused",
      resumePhase: timer.phase,
      phaseElapsedSeconds: timerPhaseElapsedSeconds(timer, now),
      phaseStartedAt: now,
      pauseStartedAt: now,
    },
  } satisfies StoredWorkoutDraft;
}

function advanceStoredWorkout(
  draft: StoredWorkoutDraft,
  occurredAt: number,
): StoredWorkoutDraft {
  const timer = draft.timer;
  if (timer.mode === "whole_workout") return draft;
  if (timer.phase === "paused")
    return pauseOrResumeStoredWorkout(draft, occurredAt);
  const now = Math.max(timer.phaseStartedAt, occurredAt);
  const phaseSeconds = Math.max(1, timerPhaseElapsedSeconds(timer, now));
  let exercises = recordStoredWorkoutTimerPhase(
    draft.exercises,
    timer,
    phaseSeconds,
    draft.intensity,
    draft.setStartDelaySeconds,
  );
  const completedElapsedSeconds =
    timer.completedElapsedSeconds + phaseSeconds;
  const currentExerciseIndex = exercises.findIndex(
    (exercise) => exercise.id === timer.exerciseId,
  );
  const currentExercise = exercises[currentExerciseIndex];
  if (timer.phase === "work") {
    const currentSetIndex =
      currentExercise?.sets.findIndex((set) => set.id === timer.setId) ?? -1;
    const nextSet = currentExercise?.sets
      .slice(currentSetIndex + 1)
      .find((set) => !set.completed);
    if (nextSet)
      return {
        ...draft,
        exercises,
        timer: {
          ...timer,
          phase: "set_rest",
          phaseStartedAt: now,
          phaseElapsedSeconds: 0,
          completedElapsedSeconds,
        },
      };
    exercises = exercises.map((exercise) =>
      exercise.id === timer.exerciseId
        ? { ...exercise, completed: true }
        : exercise,
    );
    const nextExercise = firstPendingTarget(
      exercises,
      currentExerciseIndex + 1,
    );
    if (nextExercise)
      return {
        ...draft,
        exercises,
        timer: {
          ...timer,
          phase: "exercise_rest",
          setId: undefined,
          phaseStartedAt: now,
          phaseElapsedSeconds: 0,
          completedElapsedSeconds,
        },
      };
    return { ...draft, exercises };
  }
  const nextTarget =
    timer.phase === "set_rest"
      ? firstPendingTarget(exercises, currentExerciseIndex)
      : firstPendingTarget(exercises, currentExerciseIndex + 1);
  if (!nextTarget) return { ...draft, exercises };
  return {
    ...draft,
    exercises,
    timer: {
      ...timer,
      phase: "work",
      exerciseId: nextTarget.exercise.id,
      setId: nextTarget.set.id,
      phaseStartedAt: now,
      phaseElapsedSeconds: 0,
      completedElapsedSeconds,
    },
  };
}

export function replayStoredWorkoutActions(
  draft: StoredWorkoutDraft,
  actions: readonly NativeWorkoutActionReceipt[],
) {
  let current = draft;
  const alreadyApplied = new Set(
    Array.isArray(draft.processedNativeWorkoutActionIds)
      ? draft.processedNativeWorkoutActionIds
      : [],
  );
  for (const action of actions) {
    if (action.action === "workout-finish") break;
    // A foreground replay may have committed the transition to the draft and
    // then been killed before its exact native ACK. Retrying that receipt must
    // ACK it, not advance the workout for a second time.
    if (alreadyApplied.has(nativeWorkoutActionReceiptId(action))) continue;
    current =
      action.action === "workout-pause"
        ? pauseOrResumeStoredWorkout(current, action.occurredAt)
        : advanceStoredWorkout(current, action.occurredAt);
  }
  return current;
}

export function finishStoredWorkoutDraft(
  draft: StoredWorkoutDraft,
  state: WorkoutFinishState,
  occurredAt: number,
): GymSession {
  const timer = draft.timer;
  const now = Math.max(timer.phaseStartedAt, occurredAt);
  const phaseSeconds =
    timer.phase === "paused"
      ? 0
      : Math.max(1, timerPhaseElapsedSeconds(timer, now));
  const exercises =
    timer.mode === "whole_workout"
      ? draft.exercises
      : phaseSeconds > 0
        ? recordStoredWorkoutTimerPhase(
            draft.exercises,
            timer,
            phaseSeconds,
            draft.intensity,
            draft.setStartDelaySeconds,
          )
        : draft.exercises;
  const elapsedSeconds =
    timer.mode === "whole_workout"
      ? timer.completedElapsedSeconds + timerPhaseElapsedSeconds(timer, now)
      : timer.completedElapsedSeconds + phaseSeconds;
  const completedSets = completedGymSets(exercises);
  const preciseDuration = Math.max(
    completedSets > 0 ? 0.1 : 0,
    Math.round((elapsedSeconds / 60) * 100) / 100,
  );
  const parsedManualCalories = Number(draft.calories);
  const manualCalories =
    draft.calories.trim() && Number.isFinite(parsedManualCalories)
      ? Math.max(0, parsedManualCalories)
      : undefined;
  const sessionCalories =
    manualCalories ??
    estimateGymActiveCalories(
      state.settings.energyProfile,
      preciseDuration,
      draft.intensity,
      exercises,
      draft.calorieCalculationMode,
    );
  const existingSession = state.gymSessions?.find(
    (session) =>
      session.id === draft.sessionId && session.userId === state.currentUserId,
  );
  const completedAt = new Date(now).toISOString();
  const recordedAt =
    existingSession?.recordedAt ??
    (draft.localDate === dateKey(new Date(now))
      ? completedAt
      : `${draft.localDate}T${completedAt.slice(11)}`);
  return {
    id: existingSession?.id ?? draft.sessionId,
    userId: state.currentUserId,
    planId: draft.selectedPlanId ?? undefined,
    name: draft.sessionName.trim() || "Workout",
    localDate: draft.localDate,
    recordedAt,
    startedAt: completedSets
      ? new Date(timer.startedAt).toISOString()
      : existingSession?.startedAt,
    completedAt: completedSets ? completedAt : existingSession?.completedAt,
    pausedSeconds: completedSets
      ? timer.pausedSeconds +
        (timer.phase === "paused"
          ? Math.max(
              0,
              Math.floor((now - (timer.pauseStartedAt ?? now)) / 1000),
            )
          : 0)
      : existingSession?.pausedSeconds,
    setStartDelaySeconds: draft.setStartDelaySeconds,
    durationMinutes: preciseDuration,
    durationManual: draft.durationManual === true,
    distanceKm: completedGymDistanceKm(exercises),
    calories: completedSets ? sessionCalories : undefined,
    calorieCalculationMode: draft.calorieCalculationMode,
    caloriesManual: manualCalories !== undefined,
    intensity: draft.intensity,
    notes: draft.sessionNotes.trim() || undefined,
    imageUri: draft.sessionImageUri || undefined,
    imageStoragePath: draft.sessionImageStoragePath || undefined,
    exercises,
    visibility: draft.visibility,
  };
}

function workoutSessionForStorage(
  session: GymSession,
  completedSets = completedGymSets(session.exercises),
) {
  if (completedSets <= 0) return session;
  const storedSession = { ...session };
  delete storedSession.imageUri;
  delete storedSession.imageStoragePath;
  return storedSession;
}

/**
 * Applies the same durable session and generated tracker rows as the foreground
 * save reducer. The account fence is mandatory because this path can run in a
 * headless Android JS task while another account snapshot also exists locally.
 */
export function applyBackgroundGymSession(
  state: AppState,
  session: GymSession,
): AppState {
  if (session.userId !== state.currentUserId) return state;
  const completedSets = completedGymSets(session.exercises);
  const {
    imageUri: sessionImageUri,
    imageStoragePath: sessionImageStoragePath,
  } = session;
  // A completed workout photo belongs to one canonical MetricEntry. Keeping a
  // second raw URI on GymSession would upload/share the same photo twice and
  // leak a device-local file URI into account snapshots.
  const storedSession = workoutSessionForStorage(session, completedSets);
  const inferredStepActivity = inferStepCoverageActivityFromGymSession(session);
  const calorieValue = Math.max(0, Number(session.calories ?? 0));
  const distanceValue = gymSessionDistanceKm(session);
  const workoutMetric = state.metrics.find((metric) => metric.id === "workout");
  const qualifiesAsWorkout = workoutQualifies(
    gymSessionWorkoutSample(session),
    workoutMetric?.workoutQualification,
  );
  const syncedValues = (completedSets > 0
    ? [
        { metricId: "workout", value: qualifiesAsWorkout },
        { metricId: "workout_duration", value: session.durationMinutes },
        { metricId: "workout_distance", value: distanceValue },
        { metricId: "exercise", value: calorieValue },
      ]
    : [])
    .filter(
      (item) =>
        state.metrics.some((metric) => metric.id === item.metricId) &&
        (item.metricId === "workout" || Number(item.value) > 0),
    );
  const synced = syncedValues
    .map(
      (item): MetricEntry => ({
        id: `gym-sync:${session.id}:${item.metricId}`,
        metricId: item.metricId,
        userId: state.currentUserId,
        value: item.value,
        localDate: session.localDate,
        recordedAt: session.recordedAt,
        visibility: gymSessionVisibilityForMetric(
          session.visibility,
          state.metrics.find((metric) => metric.id === item.metricId)
            ?.defaultVisibility ?? "group",
        ),
        source: "manual",
        label: session.name,
        stepCoverageActivityKey: inferredStepActivity?.key,
        note: gymSessionEntryNote(session),
        ...((item.metricId === "workout" || item.metricId === "exercise") &&
          (sessionImageUri || sessionImageStoragePath)
          ? {
              imageUri: sessionImageUri,
              imageStoragePath: sessionImageStoragePath,
            }
          : {}),
      }),
    );
  const existingSession = (state.gymSessions ?? []).find(
    (item) => item.id === session.id && item.userId === state.currentUserId,
  );
  const existingSynced = state.entries.filter(
    (entry) =>
      entry.userId === state.currentUserId &&
      entry.id.startsWith(`gym-sync:${session.id}:`),
  );
  if (
    existingSession &&
    JSON.stringify(existingSession) === JSON.stringify(storedSession) &&
    JSON.stringify(existingSynced) === JSON.stringify(synced)
  )
    return state;
  const existingSyncedIds = existingSynced.map((entry) => entry.id);
  const nextSyncedIds = new Set(synced.map((entry) => entry.id));
  const removedSyncedIds = existingSyncedIds.filter(
    (id) => !nextSyncedIds.has(id),
  );
  const reconcileDeletedIds = (ids: string[] | undefined) => [
    ...new Set([
      ...(ids ?? []).filter((id) => !nextSyncedIds.has(id)),
      ...removedSyncedIds,
    ]),
  ];
  return {
    ...state,
    settings: {
      ...state.settings,
      pendingDeletedEntryIds: reconcileDeletedIds(
        state.settings.pendingDeletedEntryIds,
      ),
      deletedEntryIds: reconcileDeletedIds(state.settings.deletedEntryIds),
    },
    gymSessions: [
      storedSession,
      ...(state.gymSessions ?? []).filter((item) => item.id !== session.id),
    ],
    entries: [
      ...state.entries.filter(
        (entry) =>
          entry.userId !== state.currentUserId ||
          !entry.id.startsWith(`gym-sync:${session.id}:`),
      ),
      ...synced,
    ],
  };
}

/**
 * A completion receipt is a crash-recovery record, never an authority that may
 * overwrite a later user edit. An exact session means the receipt was already
 * incorporated. Otherwise only same-session evidence decides whether the
 * receipt is unfinished recovery or has been superseded by an edit/delete;
 * unrelated later saves must not discard a valid workout.
 */
export function reconcileBackgroundWorkoutCompletion(
  state: AppState,
  completion: BackgroundWorkoutCompletion,
): {
  state: AppState;
  resolution: BackgroundWorkoutCompletionResolution;
} {
  if (
    completion.ownerId !== state.currentUserId ||
    completion.session.userId !== state.currentUserId
  )
    return { state, resolution: "superseded" };
  const existing = (state.gymSessions ?? []).find(
    (session) =>
      session.id === completion.session.id &&
      session.userId === state.currentUserId,
  );
  const completionSessionForStorage = workoutSessionForStorage(
    completion.session,
  );
  if (
    existing &&
    JSON.stringify(existing) === JSON.stringify(completionSessionForStorage)
  )
    return { state, resolution: "already_applied" };
  if (existing) {
    const isUnfinishedBase =
      completion.baseSession !== null &&
      JSON.stringify(existing) === JSON.stringify(completion.baseSession);
    if (!isUnfinishedBase) return { state, resolution: "superseded" };
  } else if (completion.baseSession !== null) {
    // Finish was updating an existing session, but that exact session is now
    // absent. A later deletion wins over the crash-recovery receipt.
    return { state, resolution: "superseded" };
  } else {
    const generatedPrefix = `gym-sync:${completion.session.id}:`;
    const deletedIds = [
      ...(state.settings.pendingDeletedEntryIds ?? []),
      ...(state.settings.deletedEntryIds ?? []),
    ];
    if (deletedIds.some((id) => id.startsWith(generatedPrefix)))
      return { state, resolution: "superseded" };
  }
  return {
    state: applyBackgroundGymSession(state, completion.session),
    resolution: "applied",
  };
}

export function validBackgroundWorkoutCompletion(
  value: unknown,
  ownerId: string,
  now = Date.now(),
): value is BackgroundWorkoutCompletion {
  if (!value || typeof value !== "object") return false;
  const completion = value as Partial<BackgroundWorkoutCompletion>;
  return (
    completion.ownerId === ownerId &&
    typeof completion.generation === "string" &&
    completion.generation.length > 0 &&
    finiteNumber(completion.occurredAt) &&
    completion.occurredAt <= now + 60_000 &&
    now - completion.occurredAt <= BACKGROUND_WORKOUT_COMPLETION_MAX_AGE_MS &&
    Boolean(completion.session) &&
    completion.session?.userId === ownerId &&
    typeof completion.session?.id === "string" &&
    (completion.baseSession === null ||
      (Boolean(completion.baseSession) &&
        completion.baseSession?.userId === ownerId &&
        completion.baseSession?.id === completion.session?.id))
  );
}
