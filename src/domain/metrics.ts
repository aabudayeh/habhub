import { AppState, MetricDefinition, MetricEntry } from "@/src/types";
import { dateKey, dateRangeEnding, dateWithOffsetFrom } from "./date";
import {
  dailyFoodGoal,
  energyFormulaVariables,
  KCAL_PER_KG_ESTIMATE,
} from "./energy";
import { evaluateFormula, formulaIdentifiers, FormulaError } from "./formula";
import { cycleForecast } from "./cycle";
import { gymMetricValue, hasGymMetricData } from "./gym";
import { isVacationDate } from "./vacation";
import {
  entriesForDay,
  entriesForMetric,
  entriesForUserDay,
  latestEntryOnOrBefore,
  photosForDay,
  statusForDay,
} from "./dataIndex";
import {
  bestStreakPeriodWithRest,
  currentStreakWithRest,
  longestStreakWithRest,
} from "./streaks";
import { unrecordedStepActivity } from "./health";
import {
  scheduleAppliesOnDate,
  todoAppearsOnDate,
  todoResolvedOnDate,
} from "./schedule";

function aggregate(
  entries: MetricEntry[],
  method: MetricDefinition["aggregation"],
): number {
  const numbers = entries
    .map((entry) =>
      entry.value === true
        ? 1
        : entry.value === false
          ? 0
          : Number(entry.value),
    )
    .filter(Number.isFinite);
  if (!numbers.length) return 0;
  switch (method) {
    case "latest":
      return numbers[numbers.length - 1];
    case "average":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "max":
      return Math.max(...numbers);
    case "min":
      return Math.min(...numbers);
    default:
      return numbers.reduce((sum, value) => sum + value, 0);
  }
}

export function metricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
  stack: string[] = [],
): number {
  if (metric.gymMapping)
    return gymMetricValue(
      state,
      metric.gymMapping,
      userId,
      localDate,
    );
  if (metric.id === "weight") {
    const latest = latestEntryOnOrBefore(
      state.entries,
      metric.id,
      userId,
      localDate,
    );
    return latest
      ? Number(latest.value)
      : (state.energyProfiles?.[userId]?.weightKg ??
          state.settings.energyProfile.weightKg);
  }
  if (metric.id === "overall_score")
    return dailyScore(state, userId, localDate);
  if (metric.id === "todo_completion") {
    const todos = (state.todos ?? []).filter((todo) =>
      todoAppearsOnDate(todo, localDate),
    );
    if (!todos.length) return 0;
    return (
      (todos.filter((todo) => todoResolvedOnDate(todo, localDate)).length /
        todos.length) *
      100
    );
  }
  if (metric.id === "cycle_day")
    return cycleForecast(state, userId, localDate).cycleDay;
  if (metric.id === "days_until_period")
    return Math.max(0, cycleForecast(state, userId, localDate).daysUntilPeriod ?? 0);
  if (metric.dataType === "photo") {
    return photosForDay(state.photos, userId, localDate).length;
  }
  if (metric.dataType !== "calculated") {
    const sameDay = entriesForDay(state.entries, metric.id, userId, localDate)
      .slice()
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    if (sameDay.length) return aggregate(sameDay, metric.aggregation);
    if (metric.stepFallback) {
      const steps = state.metrics.find(
        (candidate) =>
          candidate.healthMapping?.dataType === "steps" &&
          candidate.healthMapping.field === "value",
      );
      const stepCount = steps
        ? metricValue(state, steps, userId, localDate, [...stack, metric.id])
        : 0;
      const weight =
        state.energyProfiles?.[userId]?.weightKg ??
        state.settings.energyProfile.weightKg ??
        70;
      const estimate = unrecordedStepActivity(
        entriesForUserDay(state.entries, userId, localDate),
        state.metrics,
        stepCount,
        weight,
      );
      if (
        metric.healthMapping?.dataType === "workouts" &&
        metric.healthMapping.field === "distance_km"
      )
        return estimate.distanceKm;
      if (
        metric.healthMapping?.dataType === "workouts" &&
        metric.healthMapping.field === "duration_minutes"
      )
        return estimate.durationMinutes;
      return Math.round(
        estimate.knownWorkoutCalories + estimate.estimatedCalories,
      );
    }
    if (metric.aggregation !== "latest") return 0;
    const carried = latestEntryOnOrBefore(
      state.entries,
      metric.id,
      userId,
      localDate,
    );
    return carried ? aggregate([carried], "latest") : 0;
  }

  if (!metric.formula) return 0;
  if (stack.includes(metric.id))
    throw new FormulaError(`Circular formula involving “${metric.name}”`);

  const variables: Record<string, number> = energyFormulaVariables(
    state.energyProfiles?.[userId] ?? state.settings.energyProfile,
    state.settings.baselineCalories,
  );
  for (const identifier of formulaIdentifiers(metric.formula)) {
    if (identifier in variables) continue;
    const dependency = state.metrics.find(
      (candidate) => candidate.id === identifier,
    );
    if (dependency) {
      variables[identifier] = metricValue(
        state,
        dependency,
        userId,
        localDate,
        [...stack, metric.id],
      );
    }
  }

  return evaluateFormula(metric.formula, variables);
}

export function safeMetricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
): number {
  try {
    return metricValue(state, metric, userId, localDate);
  } catch {
    return 0;
  }
}

export function effectiveGoalTarget(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
): number {
  if (userId !== state.currentUserId) {
    const sharedTarget = statusForDay(
      state.dailyMetricStatuses,
      state.group.id,
      metric.id,
      userId,
      localDate,
    )?.goalTarget;
    if (sharedTarget !== undefined && Number.isFinite(sharedTarget))
      return sharedTarget;
  }
  if (metric.id === "weight") {
    const profile =
      state.energyProfiles?.[userId] ?? state.settings.energyProfile;
    const direction = weightDirectionFromProfile(profile);
    if (direction === "maintain") return profile.weightKg;
    const startingWeight = profile.startingWeightKg ?? profile.weightKg;
    const elapsedDays = Math.max(
      0,
      Math.floor(
        (new Date(`${localDate}T12:00:00`).getTime() -
          new Date(`${metric.activeFrom}T12:00:00`).getTime()) /
          86400000,
      ),
    );
    const planned = (profile.desiredWeeklyLossKg * elapsedDays) / 7;
    return direction === "gain"
      ? Math.min(profile.targetWeightKg, startingWeight + planned)
      : Math.max(profile.targetWeightKg, startingWeight - planned);
  }
  if (metric.id !== "food") return metric.goal.target;
  const exercise = state.metrics.find(
    (candidate) => candidate.id === "exercise",
  );
  const activeEnergy = exercise
    ? safeMetricValue(state, exercise, userId, localDate)
    : 0;
  return dailyFoodGoal(
    metric.goal.target,
    activeEnergy,
    state.settings.foodGoalMode ?? "activity_adjusted",
  );
}

export function weightProgressStats(
  state: AppState,
  userId: string,
  anchor: string,
) {
  const profile =
    state.energyProfiles?.[userId] ?? state.settings.energyProfile;
  const metric = state.metrics.find((item) => item.id === "weight");
  const direction = weightDirectionFromProfile(profile);
  const entries = entriesForMetric(state.entries, "weight", userId)
    .filter(
      (entry) =>
        entry.localDate <= anchor && Number.isFinite(Number(entry.value)),
    )
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  const currentEntry = entries.at(-1);
  const current = currentEntry ? Number(currentEntry.value) : profile.weightKg;
  const startingWeight = profile.startingWeightKg ?? entries[0]?.value ?? profile.weightKg;
  const weekEntry = [...entries]
    .reverse()
    .find((entry) => entry.localDate <= dateWithOffsetFrom(anchor, -7));
  const startDate = metric?.activeFrom ?? entries[0]?.localDate ?? anchor;
  const elapsedDays = Math.max(
    1,
    (new Date(`${anchor}T12:00:00`).getTime() -
      new Date(`${startDate}T12:00:00`).getTime()) /
      86400000,
  );
  const directional = (from: number, to: number) =>
    direction === "gain"
      ? to - from
      : direction === "lose"
        ? from - to
        : -Math.abs(to - from);
  const totalChange = directional(Number(startingWeight), current);
  const lastWeekChange = directional(
    weekEntry ? Number(weekEntry.value) : Number(startingWeight),
    current,
  );
  const scheduledTarget = metric
    ? effectiveGoalTarget(state, metric, userId, anchor)
    : profile.targetWeightKg;
  const remaining =
    direction === "gain"
      ? Math.max(0, profile.targetWeightKg - current)
      : direction === "lose"
        ? Math.max(0, current - profile.targetWeightKg)
        : Math.abs(current - profile.weightKg);
  const observedWeeklyChange = totalChange / (elapsedDays / 7);
  const projectedWeeklyChange =
    observedWeeklyChange > 0.05
      ? observedWeeklyChange
      : profile.desiredWeeklyLossKg;
  const expectedGoalDate =
    direction !== "maintain" && remaining > 0 && projectedWeeklyChange > 0
      ? dateWithOffsetFrom(
          anchor,
          Math.ceil((remaining / projectedWeeklyChange) * 7),
        )
      : undefined;
  const fullJourney = Math.abs(profile.targetWeightKg - Number(startingWeight));
  const journeyCompleted =
    direction === "gain"
      ? current - Number(startingWeight)
      : direction === "lose"
        ? Number(startingWeight) - current
        : Math.abs(current - Number(startingWeight)) <= 0.2
          ? fullJourney
          : 0;
  return {
    direction,
    startingWeight: Number(startingWeight),
    currentWeight: current,
    finalTarget: profile.targetWeightKg,
    scheduledTarget,
    expectedWeeklyChange:
      direction === "maintain" ? 0 : profile.desiredWeeklyLossKg,
    totalChange,
    averageWeeklyChange: observedWeeklyChange,
    lastWeekChange,
    remaining,
    expectedGoalDate,
    hasMeasurement: Boolean(currentEntry),
    /** Progress across the full starting-weight → final-target journey. */
    progress:
      fullJourney <= 0.01
        ? 1
        : Math.max(0, Math.min(1, journeyCompleted / fullJourney)),
  };
}

function weightDirectionFromProfile(profile: {
  weightKg: number;
  targetWeightKg: number;
  startingWeightKg?: number;
}): "lose" | "maintain" | "gain" {
  const baseline = profile.startingWeightKg ?? profile.weightKg;
  if (profile.targetWeightKg > baseline) return "gain";
  if (profile.targetWeightKg < baseline) return "lose";
  return "maintain";
}

export function latestTextValue(
  state: AppState,
  metricId: string,
  userId: string,
  localDate: string,
): string {
  const match = state.entries
    .filter(
      (entry) =>
        entry.metricId === metricId &&
        entry.userId === userId &&
        entry.localDate === localDate,
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  return typeof match?.value === "string" ? match.value : "";
}

export function averageMetricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
): number {
  if (!dates.length) return 0;
  return (
    dates.reduce(
      (sum, date) => sum + safeMetricValue(state, metric, userId, date),
      0,
    ) / dates.length
  );
}

export type SharedMetricResult = {
  mode: VisibilityMode;
  value: number;
  label: string;
};

type VisibilityMode = "exact" | "status" | "private";

export function sharedMetricResult(
  state: AppState,
  metric: MetricDefinition,
  subjectUserId: string,
  viewerUserId: string,
  localDate: string,
): SharedMetricResult {
  const value =
    metric.dataType === "photo" && subjectUserId !== viewerUserId
      ? photosForDay(state.photos, subjectUserId, localDate).filter(
          (photo) => photo.visibility === "group",
        ).length
      : safeMetricValue(state, metric, subjectUserId, localDate);
  if (subjectUserId === viewerUserId)
    return { mode: "exact", value, label: formatMetricValue(metric, value) };

  const entries = entriesForDay(
    state.entries,
    metric.id,
    subjectUserId,
    localDate,
  );
  const sharedStatus = statusForDay(
    state.dailyMetricStatuses,
    state.group.id,
    metric.id,
    subjectUserId,
    localDate,
  );
  const photoEntries =
    metric.dataType === "photo"
      ? photosForDay(state.photos, subjectUserId, localDate)
      : [];
  const visibility =
    metric.dataType === "photo"
      ? photoEntries.some((photo) => photo.visibility === "group")
        ? "group"
        : "private"
      : metric.dataType === "calculated"
        ? metric.defaultVisibility
        : entries.some((entry) => entry.visibility === "group")
          ? "group"
          : entries.some((entry) => entry.visibility === "status")
            ? "status"
            : "private";

  if (sharedStatus?.exactValue !== undefined)
    return {
      mode: "exact",
      value: sharedStatus.exactValue,
      label: formatMetricValue(metric, sharedStatus.exactValue),
    };
  if (
    subjectUserId !== viewerUserId &&
    !entries.length &&
    sharedStatus &&
    sharedStatus.hasData !== false
  )
    return {
      mode: "status",
      value: 0,
      label: sharedStatus.goalReached ? "Goal met" : "In progress",
    };
  if (visibility === "group")
    return { mode: "exact", value, label: formatMetricValue(metric, value) };
  if (visibility === "status") {
    return {
      mode: "status",
      value,
      label: goalReached(
        metric,
        value,
        effectiveGoalTarget(state, metric, subjectUserId, localDate),
      )
        ? "Goal met"
        : "In progress",
    };
  }
  return { mode: "private", value, label: "Private" };
}

export function goalProgress(
  metric: MetricDefinition,
  value: number,
  targetOverride = metric.goal.target,
): number {
  if (metric.goalEnabled === false) return 0;
  if (metric.goalRange) {
    if (value <= 0) return 0;
    if (value >= metric.goalRange.min && value <= metric.goalRange.max)
      return 1;
    const edge =
      value < metric.goalRange.min
        ? metric.goalRange.min
        : metric.goalRange.max;
    return Math.max(
      0,
      1 - Math.abs(value - edge) / Math.max(Math.abs(edge), 1),
    );
  }
  const target = Math.max(targetOverride, 0.0001);
  switch (metric.goal.kind) {
    case "at_most":
      if (value <= 0) return 0;
      return value <= target ? 1 : Math.max(0, 1 - (value - target) / target);
    case "exact":
      return Math.max(0, 1 - Math.abs(value - target) / target);
    case "complete":
      return value > 0 ? 1 : 0;
    default:
      return Math.max(0, value / target);
  }
}

/** Visual progress toward/through a target without revealing the target value. */
export function displayGoalProgress(
  metric: MetricDefinition,
  value: number,
  targetOverride = metric.goal.target,
): number {
  if (metric.goalEnabled === false) return 0;
  if (metric.goalRange) return goalProgress(metric, value, targetOverride);
  if (metric.goal.kind === "complete") return value > 0 ? 1 : 0;
  const target = Math.max(Math.abs(targetOverride), 0.0001);
  return Math.max(0, Math.min(3, value / target));
}

export function metricJourneyProgressStats(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  const readings = state.entries
    .filter(
      (entry) =>
        entry.metricId === metric.id &&
        entry.userId === userId &&
        entry.localDate <= localDate &&
        Number.isFinite(Number(entry.value)),
    )
    .sort(
      (a, b) =>
        a.localDate.localeCompare(b.localDate) ||
        a.recordedAt.localeCompare(b.recordedAt),
    );
  const first = readings[0];
  const latest = readings[readings.length - 1];
  const starting = first ? Number(first.value) : 0;
  const current = latest ? Number(latest.value) : 0;
  const target = effectiveGoalTarget(
    state,
    metric,
    userId,
    localDate,
  );
  const journey = target - starting;
  const progress =
    !first || !latest
      ? 0
      : Math.abs(journey) < 0.0001
        ? goalReached(metric, current, target)
          ? 1
          : 0
        : Math.max(0, Math.min(1, (current - starting) / journey));
  return {
    starting,
    current,
    target,
    progress,
    remaining: Math.abs(target - current),
    hasMeasurement: Boolean(latest),
    startDate: first?.localDate,
    currentDate: latest?.localDate,
  };
}

/** Progress used by UI bars, including long-term baseline-to-target journeys. */
export function metricVisualProgress(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
  value = safeMetricValue(state, metric, userId, localDate),
  target = effectiveGoalTarget(state, metric, userId, localDate),
) {
  if (metric.id === "weight")
    return weightProgressStats(state, userId, localDate).progress;
  if (metric.goalProgressMode === "journey")
    return metricJourneyProgressStats(
      state,
      metric,
      userId,
      localDate,
    ).progress;
  return goalProgress(metric, value, target);
}

export function goalReached(
  metric: MetricDefinition,
  value: number,
  targetOverride = metric.goal.target,
): boolean {
  if (metric.goalEnabled === false) return false;
  if (metric.goalRange)
    return value >= metric.goalRange.min && value <= metric.goalRange.max;
  switch (metric.goal.kind) {
    case "at_most":
      return value <= targetOverride && value > 0;
    case "exact": {
      const tolerance =
        metric.unit === "kcal"
          ? Math.max(50, Math.abs(targetOverride) * 0.05)
          : metric.unit === "kg"
            ? 0.2
            : Math.max(0.1, Math.abs(targetOverride) * 0.02);
      return (
        Math.abs(value - targetOverride) <=
        tolerance
      );
    }
    case "complete":
      return value > 0;
    default:
      return value >= targetOverride;
  }
}

/** Whether a result can be judged on this date, independent of its value. */
export function metricApplicableOnDate(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  if (isVacationDate(state, userId, localDate)) return true;
  const hasExplicitData =
    metric.gymMapping
      ? hasGymMetricData(state, metric.gymMapping, userId, localDate)
      : metric.dataType === "photo"
        ? photosForDay(state.photos, userId, localDate).length > 0
        : entriesForDay(state.entries, metric.id, userId, localDate).length > 0;
  const hasSharedDailyStatus = Boolean(
    statusForDay(
      state.dailyMetricStatuses,
      state.group.id,
      metric.id,
      userId,
      localDate,
    ),
  );
  const hasDeficitInput =
    metric.id === "deficit" &&
    state.entries.some(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === "food" &&
        entry.localDate === localDate,
    );
  const hasRecordedData =
    hasExplicitData || hasSharedDailyStatus || hasDeficitInput;
  // A backdated entry remains viewable even when the tracker itself was added
  // later. This does not make the goal retroactively tracked.
  if (metric.activeFrom > localDate && !hasRecordedData) return false;
  // A weigh-in target is judged only on days with an actual measurement;
  // carrying yesterday's weight forward must not create a false daily win.
  if (metric.id === "weight" || metric.goalProgressMode === "journey")
    return hasRecordedData;
  if (metric.id === "todo_completion")
    return (state.todos ?? []).some((todo) =>
      todoAppearsOnDate(todo, localDate),
    );
  if (hasSharedDailyStatus && userId !== state.currentUserId) return true;
  if (metric.id === "deficit") return hasDeficitInput;
  if (metric.id === "weekly_deficit_balance")
    return weeklyDeficitBalance(state, userId, localDate).days > 0;
  return true;
}

export function hasMetricData(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  if (!metricApplicableOnDate(state, metric, userId, localDate)) return false;
  // Vacation protects completion/streaks but must never fabricate a zero
  // measurement that changes averages, totals, or calculated energy.
  if (isVacationDate(state, userId, localDate)) return false;
  if (metric.dataType === "photo")
    return photosForDay(state.photos, userId, localDate).length > 0;
  if (metric.gymMapping)
    return hasGymMetricData(state, metric.gymMapping, userId, localDate);
  if (metric.id === "todo_completion")
    return (state.todos ?? []).some((todo) =>
      todoAppearsOnDate(todo, localDate),
    );
  if (metric.dataType === "calculated") return true;
  return entriesForDay(state.entries, metric.id, userId, localDate).length > 0;
}

export function metricPeriodStats(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
) {
  const applicableDates = dates.filter((date) =>
    metricApplicableOnDate(state, metric, userId, date),
  );
  const loggedDates = applicableDates.filter((date) =>
    hasMetricData(state, metric, userId, date),
  );
  const values = loggedDates.map((date) =>
    safeMetricValue(state, metric, userId, date),
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length
    ? total / values.length
    : 0;
  const goalDates = applicableDates.filter(
    (date) =>
      isVacationDate(state, userId, date) ||
      hasMetricData(state, metric, userId, date),
  );
  const goalsReached = goalDates.filter((date) =>
    scheduledGoalReached(state, metric, userId, date),
  ).length;
  const targets = loggedDates.map((date) =>
    effectiveGoalTarget(state, metric, userId, date),
  );
  const averageTarget = targets.length
    ? targets.reduce((sum, value) => sum + value, 0) / targets.length
    : metric.goal.target;
  return {
    applicableDates,
    loggedDates,
    values,
    total,
    average,
    averageTarget,
    goalsReached,
  };
}

export function metricStreakStats(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  throughDate = dateKey(),
) {
  const periods = state.trackedGoalPeriods?.[metric.id] ?? [];
  const candidates = [
    metric.activeFrom,
    ...periods.map((period) => period.from),
    ...state.entries
      .filter(
        (entry) =>
          entry.userId === userId &&
          entry.metricId === metric.id &&
          entry.localDate <= throughDate,
      )
      .map((entry) => entry.localDate),
    ...(state.dailyMetricStatuses ?? [])
      .filter(
        (status) =>
          status.groupId === state.group.id &&
          status.userId === userId &&
          status.metricId === metric.id &&
          status.localDate <= throughDate &&
          status.goalEligible !== false,
      )
      .map((status) => status.localDate),
    ...(metric.gymMapping
      ? (state.gymSessions ?? [])
          .filter(
            (session) =>
              session.userId === userId &&
              session.localDate <= throughDate,
          )
          .map((session) => session.localDate)
      : []),
  ]
    .filter((date) => date <= throughDate)
    .sort();
  const start = candidates[0] ?? throughDate;
  const dates = dateRangeEnding(
    throughDate,
    Math.max(
      1,
      Math.floor(
        (new Date(`${throughDate}T12:00:00`).getTime() -
          new Date(`${start}T12:00:00`).getTime()) /
          86400000,
      ) + 1,
    ),
  );
  const met = (localDate: string) =>
    metric.goalEnabled !== false &&
    isMetricTrackedOnDate(state, metric, localDate) &&
    (isVacationDate(state, userId, localDate) ||
      (hasMetricData(state, metric, userId, localDate) &&
        scheduledGoalReached(state, metric, userId, localDate)));
  return {
    current: currentStreakWithRest(state, dates, met, userId),
    best: longestStreakWithRest(state, dates, met, userId),
  };
}

export function trackedGoalStreakStats(
  state: AppState,
  userId: string,
  throughDate = dateKey(),
) {
  const trackedMetrics = state.metrics.filter(
    (metric) =>
      metric.goalEnabled !== false &&
      metric.dataType !== "text" &&
      (state.trackedGoalPeriods?.[metric.id]?.length ||
        metric.sections.today),
  );
  const candidates = trackedMetrics
    .flatMap((metric) => [
      metric.activeFrom,
      ...(state.trackedGoalPeriods?.[metric.id] ?? []).map(
        (period) => period.from,
      ),
    ])
    .filter((date) => date <= throughDate)
    .sort();
  const start = candidates[0] ?? throughDate;
  const dates = dateRangeEnding(
    throughDate,
    Math.max(
      1,
      Math.floor(
        (new Date(`${throughDate}T12:00:00`).getTime() -
          new Date(`${start}T12:00:00`).getTime()) /
          86400000,
      ) + 1,
    ),
  );
  const met = (localDate: string) =>
    trackedGoalSummary(state, userId, localDate).allMet;
  return {
    current: currentStreakWithRest(state, dates, met, userId),
    best: longestStreakWithRest(state, dates, met, userId),
  };
}

export function metricOverallAverage(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  throughDate = dateKey(),
) {
  if (metric.dataType === "photo" || metric.dataType === "text") return 0;
  const entryDates = [
    ...new Set(
      entriesForMetric(state.entries, metric.id, userId)
        .filter((entry) => entry.localDate <= throughDate)
        .map((entry) => entry.localDate),
    ),
  ];
  const gymDates = metric.gymMapping
    ? [
        ...new Set(
          (state.gymSessions ?? [])
            .filter(
              (session) =>
                session.userId === userId &&
                session.localDate <= throughDate &&
                hasGymMetricData(
                  state,
                  metric.gymMapping!,
                  userId,
                  session.localDate,
                ),
            )
            .map((session) => session.localDate),
        ),
      ]
    : [];
  const dates =
    metric.dataType === "calculated"
      ? dateRangeEnding(
          throughDate,
          Math.max(
            1,
            Math.floor(
              (new Date(`${throughDate}T12:00:00`).getTime() -
                new Date(`${metric.activeFrom}T12:00:00`).getTime()) /
                86400000,
            ) + 1,
          ),
        )
      : metric.gymMapping
        ? gymDates
        : entryDates;
  return metricPeriodStats(state, metric, userId, dates).average;
}

export type MetricHistoricalRecords = {
  highestDay?: { value: number; date: string };
  highestWeek?: { value: number; from: string; to: string };
  highestMonth?: { value: number; key: string };
  highestYear?: { value: number; year: string };
  bestWeekday?: { value: number; weekday: string };
  bestWeekOfMonth?: { value: number; week: number };
  bestMonthOfYear?: { value: number; month: string };
  bestStreak?: { days: number; from: string; to: string };
};

/** Expensive, detail-page-only records derived from canonical daily values. */
export function metricHistoricalRecords(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  throughDate = dateKey(),
  weekStartsOn: 0 | 1 | 6 = 1,
): MetricHistoricalRecords {
  const explicitDates = [
    ...(state.trackedGoalPeriods?.[metric.id] ?? []).map(
      (period) => period.from,
    ),
    ...state.entries
      .filter(
        (entry) =>
          entry.userId === userId &&
          entry.metricId === metric.id &&
          entry.localDate <= throughDate,
      )
      .map((entry) => entry.localDate),
    ...(state.dailyMetricStatuses ?? [])
      .filter(
        (status) =>
          status.groupId === state.group.id &&
          status.userId === userId &&
          status.metricId === metric.id &&
          status.localDate <= throughDate,
      )
      .map((status) => status.localDate),
    ...(state.settings.vacationPeriods ?? []).map((period) => period.from),
    ...(metric.gymMapping
      ? (state.gymSessions ?? [])
          .filter(
            (session) =>
              session.userId === userId &&
              session.localDate <= throughDate,
          )
          .map((session) => session.localDate)
      : []),
  ].sort();
  const start = [metric.activeFrom, ...explicitDates].sort()[0] ?? metric.activeFrom;
  const length = Math.min(
    3653,
    Math.max(
      1,
      Math.floor(
        (new Date(`${throughDate}T12:00:00`).getTime() -
          new Date(`${start}T12:00:00`).getTime()) /
          86400000,
      ) + 1,
    ),
  );
  const allDates = dateRangeEnding(throughDate, length);
  const recorded = allDates
    .filter((date) => hasMetricData(state, metric, userId, date))
    .map((date) => ({
      date,
      value:
        metric.id === "todo_completion"
          ? (state.todos ?? []).filter(
              (todo) =>
                todoAppearsOnDate(todo, date) &&
                todoResolvedOnDate(todo, date),
            ).length
          : safeMetricValue(state, metric, userId, date),
    }));
  if (!recorded.length) return {};
  const highestDay = recorded.reduce((best, item) =>
    item.value > best.value ? item : best,
  );
  const aggregatePeriod = (items: { value: number }[]) =>
    metric.id === "todo_completion" ||
    metric.aggregation === "sum" ||
    metric.dataType === "boolean"
      ? items.reduce((sum, item) => sum + item.value, 0)
      : items.reduce((sum, item) => sum + item.value, 0) / items.length;
  const selectBest = <T extends { value: number }>(items: T[]) =>
    items.length
      ? items.reduce((best, item) => (item.value > best.value ? item : best))
      : undefined;
  const grouped = <T>(
    keyFor: (date: string) => string,
    project: (key: string, items: typeof recorded) => T,
  ) => {
    const groups = new Map<string, typeof recorded>();
    recorded.forEach((item) => {
      const key = keyFor(item.date);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()].map(([key, items]) =>
      project(key, items),
    );
  };
  const weekStart = (date: string) => {
    const parsed = new Date(`${date}T12:00:00`);
    const offset = (parsed.getDay() - weekStartsOn + 7) % 7;
    return dateWithOffsetFrom(date, -offset);
  };
  const weeks = grouped(
    weekStart,
    (from, items) => ({
      from,
      to: dateWithOffsetFrom(from, 6),
      value: aggregatePeriod(items),
    }),
  );
  const months = grouped(
    (date) => date.slice(0, 7),
    (key, items) => ({ key, value: aggregatePeriod(items) }),
  );
  const years = [...new Set(recorded.map((item) => item.date.slice(0, 4)))]
    .map((year) => {
      const from = `${year}-01-01`;
      const to =
        year === throughDate.slice(0, 4) ? throughDate : `${year}-12-31`;
      const length =
        Math.floor(
          (new Date(`${to}T12:00:00`).getTime() -
            new Date(`${from}T12:00:00`).getTime()) /
            86400000,
        ) + 1;
      const stats = metricPeriodStats(
        state,
        metric,
        userId,
        dateRangeEnding(to, length),
      );
      return {
        year,
        value:
          metric.id === "todo_completion" ||
          metric.aggregation === "sum" ||
          metric.dataType === "boolean"
            ? stats.total
            : stats.average,
      };
    })
    .filter((item) => Number.isFinite(item.value));
  const weekdays = grouped(
    (date) =>
      new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
        new Date(`${date}T12:00:00`),
      ),
    (weekday, items) => ({
      weekday,
      value: items.reduce((sum, item) => sum + item.value, 0) / items.length,
    }),
  );
  const weeksOfMonth = grouped(
    (date) => String(Math.ceil(Number(date.slice(-2)) / 7)),
    (week, items) => ({
      week: Number(week),
      value: items.reduce((sum, item) => sum + item.value, 0) / items.length,
    }),
  );
  const monthsOfYear = grouped(
    (date) => date.slice(5, 7),
    (month, items) => ({
      month: new Intl.DateTimeFormat(undefined, { month: "long" }).format(
        new Date(`2024-${month}-01T12:00:00`),
      ),
      value: items.reduce((sum, item) => sum + item.value, 0) / items.length,
    }),
  );
  const bestStreak = bestStreakPeriodWithRest(
    state,
    allDates,
    (date) =>
      metric.goalEnabled !== false &&
      isMetricTrackedOnDate(state, metric, date) &&
      (isVacationDate(state, userId, date) ||
        (hasMetricData(state, metric, userId, date) &&
          scheduledGoalReached(state, metric, userId, date))),
    userId,
  );
  return {
    highestDay,
    highestWeek: selectBest(weeks),
    highestMonth: selectBest(months),
    highestYear: selectBest(years),
    bestWeekday: selectBest(weekdays),
    bestWeekOfMonth: selectBest(weeksOfMonth),
    bestMonthOfYear: selectBest(monthsOfYear),
    bestStreak,
  };
}

export function metricAverageGoalOffsetLabel(
  metric: MetricDefinition,
  average: number,
  averageTarget: number,
) {
  const formatDifference = (difference: number) =>
    `${Math.abs(difference) >= 100 ? Math.round(Math.abs(difference)) : Math.round(Math.abs(difference) * 10) / 10} ${metric.unit}`.trim();
  if (metric.goalRange) {
    if (average < metric.goalRange.min)
      return `${formatDifference(metric.goalRange.min - average)} below range`;
    if (average > metric.goalRange.max)
      return `${formatDifference(average - metric.goalRange.max)} above range`;
    return "Average inside goal range";
  }
  const difference = average - averageTarget;
  if (Math.abs(difference) < 0.05) return "Average on target";
  return `${formatDifference(difference)} ${difference > 0 ? "above" : "below"} target`;
}

/**
 * Goals based on a day's accumulating nutrition or a calculated daily result
 * are not final while the day is still in progress. Celebrating them on the
 * first entry produces false positives (for example, 300 kcal is temporarily
 * below a 2,000 kcal food limit).
 */
export function goalCelebrationTiming(
  metric: MetricDefinition,
): "immediate" | "end_of_day" {
  if (metric.dataType === "calculated" || metric.category === "nutrition")
    return "end_of_day";
  if (
    metric.aggregation === "sum" &&
    (metric.goal.kind === "at_most" ||
      metric.goal.kind === "exact" ||
      Boolean(metric.goalRange))
  )
    return "end_of_day";
  return "immediate";
}

export function dailyScore(
  state: AppState,
  userId: string,
  localDate: string,
): number {
  const groupMetrics = state.group.metricConfiguration ?? [];
  const enabled = groupMetrics.filter(
    (metric) =>
      metric.goalEnabled !== false &&
      metric.scoreWeight > 0 &&
      metric.dataType !== "text" &&
      metric.activeFrom <= localDate &&
      (metric.id !== "deficit" ||
        state.entries.some(
          (entry) =>
            entry.userId === userId &&
            entry.metricId === "food" &&
            entry.localDate === localDate,
        )),
  );
  const totalWeight =
    enabled.reduce((sum, metric) => sum + metric.scoreWeight, 0) || 1;
  return enabled.reduce((score, metric) => {
    const status = state.dailyMetricStatuses?.find(
      (item) =>
        item.groupId === state.group.id &&
        item.metricId === metric.id &&
        item.userId === userId &&
        item.localDate === localDate,
    );
    if (status && userId !== state.currentUserId) {
      return (
        score +
        (metric.scoreWeight / totalWeight) *
          Math.min(Math.max(status.scoreContribution, 0), 100)
      );
    }
    let value = 0;
    if (metric.dataType === "calculated") {
      value =
        metric.defaultVisibility === "private"
          ? 0
          : safeMetricValue(state, metric, userId, localDate);
    } else if (metric.dataType === "photo") {
      value = state.photos.filter(
        (photo) =>
          photo.userId === userId &&
          photo.localDate === localDate &&
          photo.visibility === "group",
      ).length;
    } else {
      value = aggregate(
        state.entries
          .filter(
            (entry) =>
              entry.metricId === metric.id &&
              entry.userId === userId &&
              entry.localDate === localDate &&
              entry.visibility !== "private",
          )
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
        metric.aggregation,
      );
    }
    const personalMetric =
      userId === state.currentUserId
        ? (state.metrics.find((item) => item.id === metric.id) ?? metric)
        : metric;
    const cappedProgress = Math.min(
      goalProgress(
        personalMetric,
        value,
        effectiveGoalTarget(state, personalMetric, userId, localDate),
      ),
      1,
    );
    return score + (metric.scoreWeight / totalWeight) * cappedProgress * 100;
  }, 0);
}

export function isMetricTrackedOnDate(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
): boolean {
  const periods = state.trackedGoalPeriods?.[metric.id];
  const insidePeriod = !periods
    ? metric.sections.today && metric.activeFrom <= localDate
    : periods.some(
    (period) =>
      period.from <= localDate && (!period.to || localDate <= period.to),
  );
  if (!insidePeriod) return false;
  return scheduleAppliesOnDate(
    metric.goalSchedule,
    metric.activeFrom,
    localDate,
  );
}

export function scheduledGoalReached(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  if (isVacationDate(state, userId, localDate)) return true;
  if (state.entries.some(
    (entry) =>
      entry.userId === userId &&
      entry.metricId === metric.id &&
      entry.localDate === localDate &&
      entry.value === "skipped",
  )) return true;
  if (
    goalCelebrationTiming(metric) === "end_of_day" &&
    !isGoalFinalForDate(state, localDate)
  ) return false;
  const reachedOnDate = (date: string) => {
    if (!metricApplicableOnDate(state, metric, userId, date)) return false;
    const primaryReached = goalReached(
      metric,
      safeMetricValue(state, metric, userId, date),
      effectiveGoalTarget(state, metric, userId, date),
    );
    const progressSubmetrics = (metric.submetrics ?? []).filter(
      (submetric) =>
        submetric.showProgressBar && submetric.goalEnabled !== false,
    );
    if (progressSubmetrics.length) {
      const latestParentEntry = state.entries
        .filter(
          (entry) =>
            entry.metricId === metric.id &&
            entry.userId === userId &&
            entry.localDate === date,
        )
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      const submetricsReached = progressSubmetrics.every((submetric) => {
        const captured = Number(
          latestParentEntry?.submetricValues?.[submetric.id],
        );
        const linked = submetric.linkedMetricId
          ? state.metrics.find(
              (candidate) => candidate.id === submetric.linkedMetricId,
            )
          : undefined;
        const sameAsPrimary =
          submetric.id === metric.id ||
          submetric.id === "value" ||
          (submetric.healthMapping?.dataType ===
            metric.healthMapping?.dataType &&
            submetric.healthMapping?.field === metric.healthMapping?.field);
        const value = Number.isFinite(captured)
          ? captured
          : linked
            ? safeMetricValue(state, linked, userId, date)
            : sameAsPrimary
              ? safeMetricValue(state, metric, userId, date)
              : Number.NaN;
        if (!Number.isFinite(value)) return false;
        return goalReached(
          {
            ...metric,
            id: `${metric.id}:${submetric.id}`,
            name: submetric.name,
            unit: submetric.unit,
            goalEnabled: submetric.goalEnabled,
            goal: submetric.goal,
            goalRange: submetric.goalRange,
            submetrics: undefined,
            submetricDisplay: undefined,
          },
          value,
          submetric.goal.target,
        );
      });
      return (
        (metric.goalEnabled === false || primaryReached) &&
        submetricsReached
      );
    }
    const isBloodPressure =
      metric.id === "blood_pressure_systolic" ||
      (metric.healthMapping?.dataType === "blood_pressure" &&
        metric.healthMapping.field === "systolic");
    if (!isBloodPressure) return primaryReached;
    const diastolic = state.metrics.find(
      (candidate) =>
        candidate.id === "blood_pressure_diastolic" ||
        (candidate.healthMapping?.dataType === "blood_pressure" &&
          candidate.healthMapping.field === "diastolic"),
    );
    const companion =
      diastolic ??
      ({
        ...metric,
        id: "blood_pressure_diastolic",
        goal: { kind: "exact", target: 80 },
        goalRange: { min: 60, max: 80 },
        goalEnabled: true,
      } as MetricDefinition);
    return (
      primaryReached &&
      goalReached(
        companion,
        safeMetricValue(state, companion, userId, date),
        effectiveGoalTarget(state, companion, userId, date),
      )
    );
  };
  const schedule = metric.goalSchedule;
  if (!schedule || !["weekly_min", "monthly_min"].includes(schedule.mode))
    return reachedOnDate(localDate);
  const anchor = new Date(`${localDate}T12:00:00`);
  const start = new Date(anchor);
  if (schedule.mode === "weekly_min") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  } else start.setDate(1);
  let completed = 0;
  const cursor = new Date(start);
  while (cursor <= anchor) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (
      metricApplicableOnDate(state, metric, userId, key) &&
      reachedOnDate(key)
    )
      completed += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return completed >= Math.max(1, schedule.minimumCompletions ?? 1);
}

export function isGoalFinalForDate(
  state: AppState,
  localDate: string,
  now = new Date(),
) {
  const today = dateKey(now);
  if (localDate < today) return true;
  if (localDate > today) return false;
  const end = state.settings.dayEndTime ?? "00:00";
  if (end === "00:00") return false;
  const [hour, minute] = end.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
}

export function trackedGoalSummary(
  state: AppState,
  userId: string,
  localDate: string,
  metricIds?: string[],
) {
  const metrics = state.metrics.filter(
    (metric) =>
      metric.goalEnabled !== false &&
      metric.activeFrom <= localDate &&
      metric.dataType !== "text" &&
      (metricIds
        ? metricIds.includes(metric.id)
        : isMetricTrackedOnDate(state, metric, localDate)),
  );
  const unavailable = metrics.filter(
    (metric) => !metricApplicableOnDate(state, metric, userId, localDate),
  );
  if (isVacationDate(state, userId, localDate))
    return {
      met: metrics.length,
      total: metrics.length,
      applicableTotal: metrics.length,
      allMet: metrics.length > 0,
      metrics,
      unavailable: [] as MetricDefinition[],
    };
  const applicable = metrics.filter(
    (metric) => !unavailable.some((item) => item.id === metric.id),
  );
  const met = applicable.filter((metric) =>
    scheduledGoalReached(state, metric, userId, localDate),
  );
  return {
    met: met.length,
    // The total represents goals the user chose to track. A calculated goal
    // can be temporarily unavailable (for example deficit before food is
    // logged), but it must not silently disappear from the chosen-goal count.
    total: metrics.length,
    applicableTotal: applicable.length,
    allMet: metrics.length > 0 && met.length === metrics.length,
    metrics,
    unavailable,
  };
}

export type DeficitRealityCheck = {
  status:
    | "aligned"
    | "reported_ahead"
    | "scale_ahead"
    | "insufficient"
    | "noise";
  actualDailyDeficit: number;
  reportedDailyDeficit: number;
  days: number;
  weightChangeKg: number;
  loggedDays: number;
  estimatedDays: number;
  fromDate?: string;
  toDate?: string;
};

/** Close enough for normal food-label, exercise, and scale estimation error. */
export const DEFICIT_ALIGNMENT_CLOSE_KCAL = 200;
/** Beyond this daily difference the two estimates are materially far apart. */
export const DEFICIT_ALIGNMENT_FAR_KCAL = 500;

export function deficitAlignmentBand(
  result: DeficitRealityCheck,
): "close" | "warning" | "far" | "neutral" {
  if (result.status === "insufficient") return "neutral";
  const difference = Math.abs(
    result.reportedDailyDeficit - result.actualDailyDeficit,
  );
  if (difference <= DEFICIT_ALIGNMENT_CLOSE_KCAL) return "close";
  if (difference <= DEFICIT_ALIGNMENT_FAR_KCAL) return "warning";
  return "far";
}

export function deficitRealityCheck(
  state: AppState,
  userId: string,
): DeficitRealityCheck {
  const latest = state.entries
    .filter(
      (entry) =>
        entry.metricId === "weight" &&
        entry.userId === userId &&
        Number.isFinite(Number(entry.value)),
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  return latest
    ? deficitRealityCheckAtDate(state, userId, latest.localDate)
    : emptyRealityCheck();
}

function emptyRealityCheck(): DeficitRealityCheck {
  return {
    status: "insufficient",
    actualDailyDeficit: 0,
    reportedDailyDeficit: 0,
    days: 0,
    weightChangeKg: 0,
    loggedDays: 0,
    estimatedDays: 0,
  };
}

export function deficitRealityCheckAtDate(
  state: AppState,
  userId: string,
  localDate: string,
): DeficitRealityCheck {
  const weight = state.metrics.find((metric) => metric.id === "weight");
  const deficit = state.metrics.find((metric) => metric.id === "deficit");
  if (!weight || !deficit) return emptyRealityCheck();
  const weightEntries = state.entries
    .filter(
      (entry) =>
        entry.metricId === weight.id &&
        entry.userId === userId &&
        entry.localDate <= localDate &&
        Number.isFinite(Number(entry.value)),
    )
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const currentIndex = weightEntries
    .map((entry) => entry.localDate)
    .lastIndexOf(localDate);
  if (currentIndex < 1) return emptyRealityCheck();
  const previous = weightEntries[currentIndex - 1];
  const current = weightEntries[currentIndex];
  const days = Math.max(
    0.5,
    (new Date(current.recordedAt).getTime() -
      new Date(previous.recordedAt).getTime()) /
      86400000,
  );
  const weightChangeKg = Number(previous.value) - Number(current.value);
  const dateCursor = new Date(`${previous.localDate}T12:00:00`);
  if (previous.localDate !== current.localDate)
    dateCursor.setDate(dateCursor.getDate() + 1);
  const reported: number[] = [];
  let intervalDays = 0;
  while (dateCursor <= new Date(`${current.localDate}T12:00:00`)) {
    intervalDays += 1;
    const key = `${dateCursor.getFullYear()}-${String(dateCursor.getMonth() + 1).padStart(2, "0")}-${String(dateCursor.getDate()).padStart(2, "0")}`;
    if (
      state.entries.some(
        (entry) =>
          entry.userId === userId &&
          entry.metricId === "food" &&
          entry.localDate === key,
      )
    )
      reported.push(safeMetricValue(state, deficit, userId, key));
    dateCursor.setDate(dateCursor.getDate() + 1);
  }
  const reportedDailyDeficit =
    reported.reduce((sum, value) => sum + value, 0) /
    Math.max(reported.length, 1);
  const profile =
    state.energyProfiles?.[userId] ?? state.settings.energyProfile;
  const actualDailyDeficit =
    ((weightChangeKg * KCAL_PER_KG_ESTIMATE) / days) *
    (weightDirectionFromProfile(profile) === "gain" ? -1 : 1);
  if (!reported.length)
    return {
      status: "insufficient",
      actualDailyDeficit,
      reportedDailyDeficit: 0,
      days,
      weightChangeKg,
      loggedDays: 0,
      estimatedDays: intervalDays,
      fromDate: previous.localDate,
      toDate: current.localDate,
    };
  if (Math.abs(weightChangeKg) < 0.3)
    return {
      status: "noise",
      actualDailyDeficit,
      reportedDailyDeficit,
      days,
      weightChangeKg,
      loggedDays: reported.length,
      estimatedDays: Math.max(0, intervalDays - reported.length),
      fromDate: previous.localDate,
      toDate: current.localDate,
    };
  const difference = Math.abs(actualDailyDeficit - reportedDailyDeficit);
  const status =
    difference <= DEFICIT_ALIGNMENT_CLOSE_KCAL
      ? "aligned"
      : actualDailyDeficit < reportedDailyDeficit
        ? "reported_ahead"
        : "scale_ahead";
  return {
    status,
    actualDailyDeficit,
    reportedDailyDeficit,
    days,
    weightChangeKg,
    loggedDays: reported.length,
    estimatedDays: Math.max(0, intervalDays - reported.length),
    fromDate: previous.localDate,
    toDate: current.localDate,
  };
}

export function rankedMembers(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
) {
  const rows = state.group.members.map((member) => ({
    member,
    value: safeMetricValue(state, metric, member.id, localDate),
  }));

  return rows.sort((a, b) => {
    if (a.value === 0 && b.value !== 0) return 1;
    if (b.value === 0 && a.value !== 0) return -1;
    if (metric.rankingDirection === "lower") return a.value - b.value;
    if (metric.rankingDirection === "closest") {
      return (
        Math.abs(
          a.value - effectiveGoalTarget(state, metric, a.member.id, localDate),
        ) -
        Math.abs(
          b.value - effectiveGoalTarget(state, metric, b.member.id, localDate),
        )
      );
    }
    return b.value - a.value;
  });
}

export function goalRemainingLabel(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
): string | undefined {
  if (metric.goalEnabled === false) return undefined;
  if (
    metric.dataType === "text" ||
    metric.dataType === "boolean" ||
    metric.dataType === "photo"
  )
    return undefined;
  const value = safeMetricValue(state, metric, userId, localDate);
  const target = effectiveGoalTarget(state, metric, userId, localDate);
  if (metric.id === "exercise") {
    const deficit = state.metrics.find(
      (candidate) => candidate.id === "deficit",
    );
    if (deficit) {
      const deficitValue = safeMetricValue(state, deficit, userId, localDate);
      const deficitTarget = effectiveGoalTarget(
        state,
        deficit,
        userId,
        localDate,
      );
      const rescueBurn = Math.max(0, deficitTarget - deficitValue);
      if (rescueBurn > 0) {
        return `${formatMetricValue(metric, rescueBurn)} more activity would reach today’s deficit goal · a walk or run can help`;
      }
    }
  }
  if (metric.id === "weight") {
    const gaining = (state.settings.weightDirection ?? "lose") === "gain";
    const remaining = Math.max(0, gaining ? target - value : value - target);
    const weights = state.entries
      .filter(
        (entry) =>
          entry.metricId === metric.id &&
          entry.userId === userId &&
          entry.localDate <= localDate &&
          Number.isFinite(Number(entry.value)),
      )
      .sort((a, b) => b.localDate.localeCompare(a.localDate));
    const current = weights[0];
    const older = current
      ? weights.find(
          (entry) =>
            entry.localDate <=
            new Date(
              new Date(`${current.localDate}T12:00:00`).getTime() -
                6 * 86400000,
            )
              .toISOString()
              .slice(0, 10),
        )
      : undefined;
    const elapsed =
      current && older
        ? Math.max(
            1,
            (new Date(`${current.localDate}T12:00:00`).getTime() -
              new Date(`${older.localDate}T12:00:00`).getTime()) /
              86400000,
          )
        : 0;
    const pace =
      current && older && elapsed
        ? ((Number(older.value) - Number(current.value)) / elapsed) * 7
        : 0;
    return `${formatMetricValue(metric, remaining)} left to ${gaining ? "gain" : "lose"}${pace !== 0 ? ` · ~${Math.abs(pace).toFixed(1)} kg/week pace` : " · pace pending more weigh-ins"}`;
  }
  if (metric.goal.kind === "at_least") {
    const remaining = Math.max(0, target - value);
    return remaining > 0
      ? `${formatMetricValue(metric, remaining)} left · goal ${formatMetricValue(metric, target)}`
      : `Goal reached · ${formatMetricValue(metric, value - target)} above target`;
  }
  if (metric.goal.kind === "at_most") {
    const remaining = target - value;
    const mode =
      metric.id === "food" && state.settings.foodGoalMode !== "fixed"
        ? " · adjusts with active energy"
        : "";
    return remaining >= 0
      ? `${formatMetricValue(metric, remaining)} remaining · goal ${formatMetricValue(metric, target)}${mode}`
      : `${formatMetricValue(metric, Math.abs(remaining))} over goal${mode}`;
  }
  const difference = Math.abs(target - value);
  return difference > 0
    ? `${formatMetricValue(metric, difference)} from target · goal ${formatMetricValue(metric, target)}`
    : "Exact goal reached";
}

export type WeeklyDeficitBalance = {
  balance: number;
  actual: number;
  target: number;
  days: number;
  startDate: string;
};

/** Positive means ahead of the cumulative deficit target; negative means there is a weekly shortfall. */
export function weeklyDeficitBalance(
  state: AppState,
  userId: string,
  localDate: string,
): WeeklyDeficitBalance {
  const deficit = state.metrics.find((metric) => metric.id === "deficit");
  const weekday = new Date(`${localDate}T12:00:00`).getDay();
  const mondayOffset = -((weekday + 6) % 7);
  const startDate = dateWithOffsetFrom(localDate, mondayOffset);
  const calendarDays = Math.abs(mondayOffset) + 1;
  if (!deficit) return { balance: 0, actual: 0, target: 0, days: 0, startDate };
  let actual = 0;
  let target = 0;
  let days = 0;
  for (let index = 0; index < calendarDays; index += 1) {
    const day = dateWithOffsetFrom(startDate, index);
    const hasFood = state.entries.some(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === "food" &&
        entry.localDate === day,
    );
    if (!hasFood) continue;
    days += 1;
    actual += safeMetricValue(state, deficit, userId, day);
    target += effectiveGoalTarget(state, deficit, userId, day);
  }
  return { balance: actual - target, actual, target, days, startDate };
}

export function formatMetricValue(
  metric: MetricDefinition,
  value: number,
): string {
  if (metric.dataType === "boolean") return value > 0 ? "Done" : "Not yet";
  if (metric.dataType === "photo")
    return `${Math.round(value)} photo${Math.round(value) === 1 ? "" : "s"}`;
  const rounded =
    Math.abs(value) >= 1000
      ? Math.round(value).toLocaleString()
      : Number(value.toFixed(1)).toLocaleString();
  return metric.unit ? `${rounded} ${metric.unit}` : rounded;
}
