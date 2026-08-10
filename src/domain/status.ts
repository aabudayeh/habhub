import { AppState, MetricDefinition } from "@/src/types";

import { allTimePeriodDates } from "./leaderboard";
import { entriesForMetric } from "./dataIndex";
import { dateRangeEnding } from "./date";
import {
  effectiveGoalTarget,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  weightDailyGoalStatus,
} from "./metrics";

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
  currentWeightKg: number;
  mindTier: 0 | 1 | 2 | 3;
  muscleProgress: number;
};

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Includes scheduled goal opportunities even when a day has no data row. */
export function statusAllTimeDates(
  state: AppState,
  userId: string,
  anchorDate: string,
) {
  const metrics = state.metrics.filter(
    (metric) => metric.goalEnabled !== false && metric.dataType !== "text",
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
      (metric) => metric.goalEnabled !== false && metric.dataType !== "text",
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
        const visualProgress = reached
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
export function statusAvatarProgression(
  state: AppState,
  userId: string,
  anchorDate: string,
): StatusAvatarProgression {
  const profile = state.energyProfiles?.[userId] ?? state.settings.energyProfile;
  let latestWeight: AppState["entries"][number] | undefined;
  let earliestWeight: AppState["entries"][number] | undefined;
  for (const entry of entriesForMetric(state.entries, "weight", userId)) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value))
      continue;
    if (
      !earliestWeight ||
      `${entry.localDate}:${entry.recordedAt}` <
        `${earliestWeight.localDate}:${earliestWeight.recordedAt}`
    )
      earliestWeight = entry;
    if (entry.localDate > anchorDate) continue;
    if (
      !latestWeight ||
      `${entry.localDate}:${entry.recordedAt}` >
        `${latestWeight.localDate}:${latestWeight.recordedAt}`
    )
      latestWeight = entry;
  }
  const currentWeightKg = Number(
    latestWeight?.value ?? earliestWeight?.value ?? profile.weightKg,
  );

  let completedSets = 0;
  for (const session of state.gymSessions ?? []) {
    if (session.userId !== userId || session.localDate > anchorDate) continue;
    for (const exercise of session.exercises)
      for (const set of exercise.sets) if (set.completed) completedSets += 1;
  }
  const muscleProgress = bounded(1 - Math.exp(-completedSets / 140), 0, 1);

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

  return { currentWeightKg, mindTier, muscleProgress };
}
