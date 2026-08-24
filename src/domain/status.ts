import {
  AppState,
  type GymExercise,
  type GymSuperset,
  MetricDefinition,
  type MuscleGroup,
} from "@/src/types";

import { allTimePeriodDates } from "./leaderboard";
import { entriesForMetric } from "./dataIndex";
import { dateKey, dateRangeEnding } from "./date";
import { catalogExercise, exerciseFromActivityName } from "./exerciseCatalog";
import {
  canBeTrackedGoal,
  effectiveGoalTarget,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  weightDailyGoalStatus,
} from "./metrics";
import {
  statusMuscleProgressFromWeeks,
  statusMuscleWeeklyQuality,
} from "./statusAvatar";

export {
  statusBodyAppearance,
  type StatusBodyAppearance,
  type StatusBodyShape,
} from "./statusAvatar";

export type StatusMetricRollup = {
  completed: number;
  metric: MetricDefinition;
  opportunities: number;
  progress: number;
};

export type StatusRangeRollup = {
  completed: number;
  metrics: StatusMetricRollup[];
  opportunities: number;
  progress: number;
};

export type StatusAvatarProgression = {
  currentBodyFatPercent?: number;
  currentLeanBodyMassKg?: number;
  currentWeightKg: number;
  mindTier: 0 | 1 | 2 | 3;
  muscleProgress: number;
};

export type StatusAvatarBodyProgression = Omit<
  StatusAvatarProgression,
  "mindTier"
>;

function latestMeasurementAtOrBefore(
  state: AppState,
  metricId: string,
  userId: string,
  anchorDate: string,
) {
  let latest: AppState["entries"][number] | undefined;
  for (const entry of entriesForMetric(state.entries, metricId, userId)) {
    if (
      entry.localDate > anchorDate ||
      typeof entry.value !== "number" ||
      !Number.isFinite(entry.value) ||
      entry.value <= 0
    )
      continue;
    const updateTime = entry.sourceUpdatedAt ?? entry.recordedAt;
    const latestUpdateTime = latest
      ? (latest.sourceUpdatedAt ?? latest.recordedAt)
      : "";
    if (
      !latest ||
      `${entry.localDate}:${updateTime}:${entry.id}` >
        `${latest.localDate}:${latestUpdateTime}:${latest.id}`
    )
      latest = entry;
  }
  return latest ? Number(latest.value) : undefined;
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type ResistanceMovement = Pick<
  GymExercise | GymSuperset,
  "exerciseKey" | "muscleGroups" | "name" | "trackingMode"
>;

const FULL_BODY_MUSCLE_GROUPS: MuscleGroup[] = [
  "chest",
  "back",
  "shoulders",
  "glutes",
  "quadriceps",
  "hamstrings",
];

function resistanceMovementGroups(movement: ResistanceMovement) {
  const catalog =
    catalogExercise(movement.exerciseKey) ??
    exerciseFromActivityName(movement.name);
  const trackingMode = movement.trackingMode ?? catalog?.trackingMode;
  // Known cardio, mobility, yoga and duration activities do not create a
  // muscularity reward just because they were recorded on the Workout page.
  if (trackingMode === "duration" || (catalog && catalog.category !== "strength"))
    return [];
  const groups = movement.muscleGroups?.length
    ? movement.muscleGroups
    : (catalog?.muscles ?? []);
  if (!catalog && !groups.length) return [];
  return groups.length ? groups : (["full_body"] as MuscleGroup[]);
}

function localDateOrdinal(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Calculates a bounded, training-linked motivational physique progression.
 * This is deliberately not a body-composition or lean-mass estimate.
 */
export function statusMuscleProgress(
  sessions: AppState["gymSessions"],
  userId: string,
  anchorDate: string,
) {
  const anchorOrdinal = localDateOrdinal(anchorDate);
  if (anchorOrdinal === null) return 0;
  const weeklyDoses = new Map<number, Map<MuscleGroup, number>>();
  const resistanceSessionDays = new Set<string>();

  const addSet = (weeksAgo: number, groups: readonly MuscleGroup[]) => {
    if (!groups.length) return;
    const week = weeklyDoses.get(weeksAgo) ?? new Map<MuscleGroup, number>();
    const expanded = groups.includes("full_body")
      ? FULL_BODY_MUSCLE_GROUPS.map((group) => [group, 0.35] as const)
      : groups.map((group, index) => [group, index === 0 ? 1 : 0.5] as const);
    for (const [group, credit] of expanded)
      week.set(group, Math.min(20, (week.get(group) ?? 0) + credit));
    weeklyDoses.set(weeksAgo, week);
  };

  for (const session of sessions ?? []) {
    if (
      session.userId !== userId ||
      session.localDate > anchorDate
    )
      continue;
    const sessionOrdinal = localDateOrdinal(session.localDate);
    if (sessionOrdinal === null || sessionOrdinal > anchorOrdinal) continue;
    const weeksAgo = Math.floor((anchorOrdinal - sessionOrdinal) / 7);
    let sessionHasResistanceEvidence = false;
    for (const exercise of session.exercises) {
      const primaryGroups = resistanceMovementGroups(exercise);
      if (
        primaryGroups.length &&
        (exercise.completed || exercise.sets.some((set) => set.completed))
      )
        sessionHasResistanceEvidence = true;
      for (const set of exercise.sets) {
        if (!set.completed) continue;
        addSet(weeksAgo, primaryGroups);
        if (set.superset) {
          const supersetGroups = resistanceMovementGroups(set.superset);
          addSet(weeksAgo, supersetGroups);
          if (supersetGroups.length) sessionHasResistanceEvidence = true;
        }
      }
    }
    if (sessionHasResistanceEvidence)
      resistanceSessionDays.add(session.localDate);
  }

  const sessionOffsets = [...resistanceSessionDays].flatMap((localDate) => {
    const ordinal = localDateOrdinal(localDate);
    return ordinal === null ? [] : [anchorOrdinal - ordinal];
  });

  return statusMuscleProgressFromWeeks(
    [...weeklyDoses].map(([weeksAgo, doses]) => ({
      quality: statusMuscleWeeklyQuality([...doses.values()]),
      weeksAgo,
    })),
    {
      recentWeekSessions: sessionOffsets.filter((daysAgo) => daysAgo <= 6)
        .length,
      recentMonthSessions: sessionOffsets.filter((daysAgo) => daysAgo <= 27)
        .length,
      lifetimeSessions: sessionOffsets.length,
    },
  );
}

/** Includes scheduled goal opportunities even when a day has no data row. */
export function statusAllTimeDates(
  state: AppState,
  userId: string,
  anchorDate: string,
) {
  const metrics = state.metrics.filter(
    (metric) => canBeTrackedGoal(metric) && metric.goalEnabled !== false,
  );
  const metricIds = metrics.map((metric) => metric.id);
  const dataDates = allTimePeriodDates(state, anchorDate, metricIds, [userId]);
  const starts = metrics.flatMap((metric) => {
    const periods = state.trackedGoalPeriods?.[metric.id];
    if (periods?.length)
      return periods
        .map((period) => period.from)
        .filter((date) => date <= anchorDate);
    return metric.sections.today && metric.activeFrom <= anchorDate
      ? [metric.activeFrom]
      : [];
  });
  const start = [dataDates[0], ...starts].filter(Boolean).sort()[0] ?? anchorDate;
  const length = Math.max(
    1,
    Math.floor(
      (new Date(`${anchorDate}T12:00:00`).getTime() -
        new Date(`${start}T12:00:00`).getTime()) /
        86_400_000,
    ) + 1,
  );
  return dateRangeEnding(anchorDate, length);
}

/**
 * Calculates the Status page once per selected range. Missing scheduled goals
 * remain honest zero-progress opportunities; unscheduled dates are ignored.
 */
export function statusRangeRollup(
  state: AppState,
  userId: string,
  dates: readonly string[],
): StatusRangeRollup {
  let completed = 0;
  let opportunities = 0;
  let progressTotal = 0;
  const metrics = state.metrics
    .filter(
      (metric) => canBeTrackedGoal(metric) && metric.goalEnabled !== false,
    )
    .map((metric): StatusMetricRollup => {
      let metricCompleted = 0;
      let metricOpportunities = 0;
      let metricProgress = 0;
      dates.forEach((date) => {
        if (
          !isMetricTrackedOnDate(state, metric, date) ||
          !metricApplicableOnDate(state, metric, userId, date)
        )
          return;
        metricOpportunities += 1;
        opportunities += 1;
        const value = safeMetricValue(state, metric, userId, date);
        const target = effectiveGoalTarget(state, metric, userId, date);
        // Status summarizes whether this range's daily goals were met. Weight
        // therefore uses its pace target for that day, not the expensive
        // all-journey calculation that scans and sorts weight history again for
        // every date in an all-time range.
        const reached = scheduledGoalReached(state, metric, userId, date);
        const visualProgress = reached && metric.id !== "food"
          ? 1
          : bounded(
              metric.id === "weight"
                ? weightDailyGoalStatus(state, userId, date).progress
                : metricVisualProgress(
                    state,
                    metric,
                    userId,
                    date,
                    value,
                    target,
                  ),
              0,
              1,
            );
        metricProgress += visualProgress;
        progressTotal += visualProgress;
        if (reached) {
          metricCompleted += 1;
          completed += 1;
        }
      });
      return {
        completed: metricCompleted,
        metric,
        opportunities: metricOpportunities,
        progress: metricOpportunities ? metricProgress / metricOpportunities : 0,
      };
    })
    .filter((metric) => metric.opportunities > 0);

  return {
    completed,
    metrics,
    opportunities,
    progress: opportunities ? progressTotal / opportunities : 0,
  };
}

/**
 * Durable avatar traits are based on history up to the selected date rather
 * than the currently visible range. This lets the same person visibly evolve
 * without making a week/month switch erase earned progression.
 */
export function statusAvatarBodyProgression(
  state: AppState,
  userId: string,
  anchorDate: string,
): StatusAvatarBodyProgression {
  const profile = state.energyProfiles?.[userId] ?? state.settings.energyProfile;
  const isCurrentDate = anchorDate >= dateKey();
  const currentWeightKg =
    (isCurrentDate ? profile.weightKg : undefined) ??
    latestMeasurementAtOrBefore(state, "weight", userId, anchorDate) ??
    profile.startingWeightKg ??
    profile.weightKg;
  const currentBodyFatPercent =
    (isCurrentDate ? profile.bodyFatPercent : undefined) ??
    latestMeasurementAtOrBefore(state, "body_fat", userId, anchorDate);
  const currentLeanBodyMassKg =
    (isCurrentDate ? profile.leanBodyMassKg : undefined) ??
    latestMeasurementAtOrBefore(
      state,
      "lean_body_mass",
      userId,
      anchorDate,
    );

  const muscleProgress = statusMuscleProgress(
    state.gymSessions,
    userId,
    anchorDate,
  );

  return {
    currentBodyFatPercent,
    currentLeanBodyMassKg,
    currentWeightKg,
    muscleProgress,
  };
}

export function statusAvatarProgression(
  state: AppState,
  userId: string,
  anchorDate: string,
): StatusAvatarProgression {
  const body = statusAvatarBodyProgression(state, userId, anchorDate);

  const mindMetrics = state.metrics.filter(
    (metric) => metric.category === "mind" && metric.goalEnabled !== false,
  );
  const mindDates = mindMetrics.length
    ? allTimePeriodDates(
        state,
        anchorDate,
        mindMetrics.map((metric) => metric.id),
        [userId],
      )
    : [];
  let mindCompletions = 0;
  mindMetrics.forEach((metric) => {
    mindDates.forEach((date) => {
      if (
        isMetricTrackedOnDate(state, metric, date) &&
        metricApplicableOnDate(state, metric, userId, date) &&
        scheduledGoalReached(state, metric, userId, date)
      )
        mindCompletions += 1;
    });
  });
  const mindTier: 0 | 1 | 2 | 3 =
    mindCompletions >= 100
      ? 3
      : mindCompletions >= 30
        ? 2
        : mindCompletions >= 7
          ? 1
          : 0;

  return {
    ...body,
    mindTier,
  };
}
