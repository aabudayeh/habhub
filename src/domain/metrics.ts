import { AppState, MetricDefinition, MetricEntry } from "@/src/types";
import { dateWithOffsetFrom } from "./date";
import {
  dailyFoodGoal,
  energyFormulaVariables,
  KCAL_PER_KG_ESTIMATE,
} from "./energy";
import { evaluateFormula, formulaIdentifiers, FormulaError } from "./formula";
import { cycleForecast } from "./cycle";

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
  if (metric.id === "weight") {
    const latest = state.entries
      .filter(
        (entry) =>
          entry.metricId === metric.id &&
          entry.userId === userId &&
          entry.localDate <= localDate &&
          Number.isFinite(Number(entry.value)),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    return latest
      ? Number(latest.value)
      : (state.energyProfiles?.[userId]?.weightKg ??
          state.settings.energyProfile.weightKg);
  }
  if (metric.id === "overall_score")
    return dailyScore(state, userId, localDate);
  if (metric.id === "cycle_day")
    return cycleForecast(state, userId, localDate).cycleDay;
  if (metric.id === "days_until_period")
    return Math.max(0, cycleForecast(state, userId, localDate).daysUntilPeriod ?? 0);
  if (metric.dataType === "photo") {
    return state.photos.filter(
      (photo) => photo.userId === userId && photo.localDate === localDate,
    ).length;
  }
  if (metric.dataType !== "calculated") {
    const sameDay = state.entries
      .filter(
        (entry) =>
          entry.metricId === metric.id &&
          entry.userId === userId &&
          entry.localDate === localDate,
      )
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
      return Math.round(
        uncoveredStepActivity(state, userId, localDate, stepCount, weight),
      );
    }
    if (metric.aggregation !== "latest") return 0;
    const carried = state.entries
      .filter(
        (entry) =>
          entry.metricId === metric.id &&
          entry.userId === userId &&
          entry.localDate <= localDate,
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
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

function uncoveredStepActivity(
  state: AppState,
  userId: string,
  localDate: string,
  steps: number,
  weightKg: number,
) {
  const day = state.entries.filter(
    (entry) => entry.userId === userId && entry.localDate === localDate,
  );
  const workoutIds = state.metrics
    .filter(
      (item) =>
        item.healthMapping?.dataType === "workouts" &&
        item.healthMapping.field === "value",
    )
    .map((item) => item.id);
  const distanceIds = state.metrics
    .filter(
      (item) =>
        item.healthMapping?.dataType === "workouts" &&
        item.healthMapping.field === "distance_km",
    )
    .map((item) => item.id);
  const durationIds = state.metrics
    .filter(
      (item) =>
        item.healthMapping?.dataType === "workouts" &&
        item.healthMapping.field === "duration_minutes",
    )
    .map((item) => item.id);
  const calorieIds = state.metrics
    .filter(
      (item) =>
        item.healthMapping?.dataType === "workouts" &&
        item.healthMapping.field === "active_calories",
    )
    .map((item) => item.id);
  const sessions = day.filter(
    (entry) =>
      workoutIds.includes(entry.metricId) &&
      /(walk|run|hike|treadmill)/i.test(entry.label ?? ""),
  );
  let covered = 0;
  for (const sourceId of new Set(
    sessions.map((entry) => entry.sourceRecordId).filter(Boolean),
  )) {
    const label =
      sessions.find((entry) => entry.sourceRecordId === sourceId)?.label ?? "";
    const running = /(run|treadmill)/i.test(label);
    const distance = Math.max(
      0,
      ...day
        .filter(
          (entry) =>
            entry.sourceRecordId === sourceId &&
            distanceIds.includes(entry.metricId),
        )
        .map((entry) => Number(entry.value || 0)),
    );
    const duration = Math.max(
      0,
      ...day
        .filter(
          (entry) =>
            entry.sourceRecordId === sourceId &&
            durationIds.includes(entry.metricId),
        )
        .map((entry) => Number(entry.value || 0)),
    );
    covered +=
      (distance || (duration / 60) * (running ? 9 : 5)) *
      (running ? 1000 : 1312);
  }
  const known = day
    .filter((entry) => calorieIds.includes(entry.metricId))
    .reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  const uncovered = Math.max(0, steps - covered);
  return known + uncovered * 0.000762 * 0.53 * Math.max(35, weightKg);
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
  const entries = state.entries
    .filter(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === "weight" &&
        entry.localDate <= anchor &&
        Number.isFinite(Number(entry.value)),
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
      ? state.photos.filter(
          (photo) =>
            photo.userId === subjectUserId &&
            photo.localDate === localDate &&
            photo.visibility === "group",
        ).length
      : safeMetricValue(state, metric, subjectUserId, localDate);
  if (subjectUserId === viewerUserId)
    return { mode: "exact", value, label: formatMetricValue(metric, value) };

  const entries = state.entries.filter(
    (entry) =>
      entry.metricId === metric.id &&
      entry.userId === subjectUserId &&
      entry.localDate === localDate,
  );
  const sharedStatus = state.dailyMetricStatuses?.find(
    (status) =>
      status.groupId === state.group.id &&
      status.metricId === metric.id &&
      status.userId === subjectUserId &&
      status.localDate === localDate,
  );
  const photoEntries =
    metric.dataType === "photo"
      ? state.photos.filter(
          (photo) =>
            photo.userId === subjectUserId && photo.localDate === localDate,
        )
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

  if (subjectUserId !== viewerUserId && !entries.length && sharedStatus)
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
    case "exact":
      return value === targetOverride;
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
  const hasExplicitData =
    metric.dataType === "photo"
      ? state.photos.some(
          (photo) =>
            photo.userId === userId && photo.localDate === localDate,
        )
      : state.entries.some(
          (entry) =>
            entry.userId === userId &&
            entry.metricId === metric.id &&
            entry.localDate === localDate,
        );
  // A backdated entry remains viewable even when the tracker itself was added
  // later. This does not make the goal retroactively tracked.
  if (metric.activeFrom > localDate && !hasExplicitData) return false;
  if (metric.id === "deficit")
    return state.entries.some(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === "food" &&
        entry.localDate === localDate,
    );
  if (metric.id === "weekly_deficit_balance")
    return weeklyDeficitBalance(state, userId, localDate).days > 0;
  return true;
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
    const hasVisibleValue =
      metric.dataType === "photo"
        ? state.photos.some(
            (photo) =>
              photo.userId === userId &&
              photo.localDate === localDate &&
              photo.visibility === "group",
          )
        : state.entries.some(
            (entry) =>
              entry.metricId === metric.id &&
              entry.userId === userId &&
              entry.localDate === localDate &&
              entry.visibility === "group",
          );
    if (status && !hasVisibleValue && userId !== state.currentUserId) {
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
    const cappedProgress = Math.min(
      goalProgress(
        metric,
        value,
        effectiveGoalTarget(state, metric, userId, localDate),
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
  const schedule = metric.goalSchedule;
  if (!schedule || schedule.mode === "daily") return true;
  if (schedule.mode === "selected_days")
    return (schedule.daysOfWeek ?? []).includes(
      new Date(`${localDate}T12:00:00`).getDay(),
    );
  if (schedule.mode === "every_other_day") {
    const anchor = schedule.anchorDate ?? metric.activeFrom;
    const days = Math.round(
      (new Date(`${localDate}T12:00:00`).getTime() -
        new Date(`${anchor}T12:00:00`).getTime()) /
        86400000,
    );
    return days >= 0 && days % 2 === 0;
  }
  // Weekly/monthly minimum goals remain visible through their current period;
  // their completion is evaluated across that period below.
  return true;
}

export function scheduledGoalReached(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
) {
  const reachedOnDate = (date: string) => {
    if (!metricApplicableOnDate(state, metric, userId, date)) return false;
    const primaryReached = goalReached(
      metric,
      safeMetricValue(state, metric, userId, date),
      effectiveGoalTarget(state, metric, userId, date),
    );
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
  const ratio =
    reportedDailyDeficit > 0 ? actualDailyDeficit / reportedDailyDeficit : 0;
  const status =
    ratio >= 0.6 && ratio <= 1.4
      ? "aligned"
      : ratio < 0.6
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
