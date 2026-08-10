import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { AppState, FastingRuntimeSetting, MetricDefinition, MetricEntry } from "@/src/types";

const AUTO_FAST_PREFIX = "fasting-auto-food-";
const MANUAL_FAST_PREFIX = "fasting-manual-";
const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;

export type AutomaticFastProgress = {
  active: boolean;
  mode?: "manual" | "automatic";
  startedAt?: string;
  endedAt?: string;
  minutes: number;
  targetMinutes: number;
  endedOutsideEatingWindow?: boolean;
};

export type CompletedFastDetails = {
  startedAt: Date;
  endedAt: Date;
  minutes: number;
  eatingWindowMinutes: number;
  startedAutomatically: boolean;
  endedAutomatically: boolean;
};

function fastingMetric(state: AppState, metricId = "intermittent_fasting") {
  return state.metrics.find(
    (candidate) => candidate.id === metricId && candidate.fastingSettings,
  );
}

function validDate(value?: string | number) {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function scheduledFastStart(endedAt: Date, localDate: string, startTime: string) {
  const startedAt = new Date(`${localDate}T${startTime}:00`);
  if (Number.isNaN(startedAt.getTime())) return undefined;
  if (startedAt >= endedAt) startedAt.setDate(startedAt.getDate() - 1);
  return startedAt;
}

function nextScheduledStart(now: Date, startTime: string) {
  const candidate = new Date(`${dateKey(now)}T${startTime}:00`);
  if (Number.isNaN(candidate.getTime()))
    return new Date(now.getTime() + DAY_MINUTES * MINUTE_MS);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function isFoodEntry(entry: MetricEntry, userId: string) {
  return (
    entry.userId === userId &&
    entry.metricId === "food" &&
    Number(entry.value) > 0 &&
    !Number.isNaN(new Date(entry.recordedAt).getTime())
  );
}

function foodEntriesThrough(
  state: AppState,
  userId: string,
  now: Date,
) {
  const nowMs = now.getTime();
  return state.entries
    .filter((entry) => {
      if (!isFoodEntry(entry, userId)) return false;
      const recordedAtMs = new Date(entry.recordedAt).getTime();
      return Number.isFinite(recordedAtMs) && recordedAtMs <= nowMs;
    })
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

function elapsedMinutes(startedAt: Date, endedAt: Date) {
  return Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / MINUTE_MS),
  );
}

function progressFromEntry(
  entry: MetricEntry,
  targetMinutes: number,
): AutomaticFastProgress | undefined {
  const startedAt = validDate(entry.submetricValues?.fast_started_at_ms);
  const endedAt = validDate(
    entry.submetricValues?.fast_ended_at_ms ?? entry.recordedAt,
  );
  if (!startedAt || !endedAt || endedAt < startedAt) return undefined;
  const minutes = Number.isFinite(entry.submetricValues?.fasting_minutes)
    ? Math.max(0, Number(entry.submetricValues?.fasting_minutes))
    : elapsedMinutes(startedAt, endedAt);
  return {
    active: false,
    mode: entry.id.startsWith(AUTO_FAST_PREFIX) ? "automatic" : "manual",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    minutes,
    targetMinutes,
    endedOutsideEatingWindow:
      minutes < targetMinutes || minutes >= DAY_MINUTES,
  };
}

/**
 * Converts the private numeric fields used for sync/calculation into a safe,
 * typed representation for user-facing history. Invalid legacy rows are
 * intentionally ignored rather than exposing their raw metadata keys.
 */
export function completedFastDetails(
  entry: MetricEntry,
): CompletedFastDetails | undefined {
  const startedAt = validDate(entry.submetricValues?.fast_started_at_ms);
  const endedAt = validDate(
    entry.submetricValues?.fast_ended_at_ms ?? entry.recordedAt,
  );
  if (!startedAt || !endedAt || endedAt < startedAt) return undefined;
  const minutes = Number.isFinite(entry.submetricValues?.fasting_minutes)
    ? Math.max(0, Number(entry.submetricValues?.fasting_minutes))
    : elapsedMinutes(startedAt, endedAt);
  const storedEatingWindow = entry.submetricValues?.eating_window_minutes;
  return {
    startedAt,
    endedAt,
    minutes,
    eatingWindowMinutes: Number.isFinite(storedEatingWindow)
      ? Math.max(0, Number(storedEatingWindow))
      : Math.max(0, DAY_MINUTES - minutes),
    startedAutomatically: entry.id.startsWith(AUTO_FAST_PREFIX),
    endedAutomatically:
      Number(entry.submetricValues?.ended_automatically) === 1,
  };
}

function inferredAutomaticStart(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  now: Date,
) {
  if (!metric.fastingSettings?.automaticFoodBreak) return undefined;
  const today = dateKey(now);
  const yesterday = dateWithOffsetFrom(today, -1);
  const startTime = metric.fastingSettings.startTime ?? "20:00";
  const plannedStartToday = new Date(`${today}T${startTime}:00`);
  const plannedStartYesterday = new Date(`${yesterday}T${startTime}:00`);
  const plannedEndToday = new Date(
    plannedStartYesterday.getTime() +
      (metric.fastingSettings.fastingMinutes ?? 16 * 60) * MINUTE_MS,
  );
  const foods = foodEntriesThrough(state, userId, now);
  const latestMeal = foods.at(-1);
  const todayFoods = foods.filter((entry) => entry.localDate === today);

  let startedAt: Date | undefined;
  if (now >= plannedStartToday) {
    startedAt = latestMeal
      ? new Date(latestMeal.recordedAt)
      : plannedStartToday;
  } else if (now <= plannedEndToday && todayFoods.length === 0) {
    startedAt = latestMeal
      ? new Date(latestMeal.recordedAt)
      : plannedStartYesterday;
  }
  return startedAt && !Number.isNaN(startedAt.getTime()) && startedAt <= now
    ? startedAt
    : undefined;
}

/**
 * Re-enables meal-derived inference after Auto has been switched off. An
 * active manual session remains authoritative; completed/suppressed runtime
 * state is cleared so the latest meal (or configured start) can be used again.
 */
export function reinstateAutomaticFasting(
  state: AppState,
  metricId = "intermittent_fasting",
): AppState {
  const runtime = state.settings.fastingRuntimeByMetric?.[metricId];
  if (!runtime || (runtime.startedManually && !runtime.endedAt)) return state;
  const fastingRuntimeByMetric = {
    ...(state.settings.fastingRuntimeByMetric ?? {}),
  };
  delete fastingRuntimeByMetric[metricId];
  return {
    ...state,
    settings: {
      ...state.settings,
      fastingRuntimeByMetric,
    },
  };
}

/** Current/manual session, falling back to the latest completed session today. */
export function automaticFastProgress(
  state: AppState,
  userId: string,
  now = new Date(),
  metricId = "intermittent_fasting",
): AutomaticFastProgress {
  const metric = fastingMetric(state, metricId);
  const targetMinutes = metric?.fastingSettings?.fastingMinutes ?? 16 * 60;
  if (!metric || userId !== state.currentUserId)
    return { active: false, minutes: 0, targetMinutes };

  const runtime = state.settings.fastingRuntimeByMetric?.[metric.id];
  const runtimeStart = validDate(runtime?.startedAt);
  if (runtimeStart && !runtime?.endedAt && runtimeStart <= now) {
    return {
      active: true,
      mode: runtime?.startedManually ? "manual" : "automatic",
      startedAt: runtimeStart.toISOString(),
      minutes: elapsedMinutes(runtimeStart, now),
      targetMinutes,
    };
  }

  let inferredStart = inferredAutomaticStart(state, metric, userId, now);
  const suppressedUntil = validDate(runtime?.suppressAutomaticUntil);
  const runtimeEnd = validDate(runtime?.endedAt);
  if (
    inferredStart &&
    runtimeEnd &&
    inferredStart <= runtimeEnd &&
    suppressedUntil &&
    now >= suppressedUntil
  )
    inferredStart = suppressedUntil;
  if (
    inferredStart &&
    (!suppressedUntil || now >= suppressedUntil) &&
    (!runtimeEnd || inferredStart > runtimeEnd)
  ) {
    return {
      active: true,
      mode: "automatic",
      startedAt: inferredStart.toISOString(),
      minutes: elapsedMinutes(inferredStart, now),
      targetMinutes,
    };
  }

  const today = dateKey(now);
  const latest = state.entries
    .filter(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === metric.id &&
        entry.localDate === today,
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
  return (
    (latest && progressFromEntry(latest, targetMinutes)) ?? {
      active: false,
      minutes: 0,
      targetMinutes,
    }
  );
}

/** Completed progress for a selected date, or live progress when that date is today. */
export function fastingProgressForDate(
  state: AppState,
  userId: string,
  localDate: string,
  now = new Date(),
  metricId = "intermittent_fasting",
): AutomaticFastProgress {
  if (localDate === dateKey(now))
    return automaticFastProgress(state, userId, now, metricId);
  const metric = fastingMetric(state, metricId);
  const targetMinutes = metric?.fastingSettings?.fastingMinutes ?? 16 * 60;
  const latest = state.entries
    .filter(
      (entry) =>
        entry.userId === userId &&
        entry.metricId === metricId &&
        entry.localDate === localDate,
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
  return (
    (latest && progressFromEntry(latest, targetMinutes)) ?? {
      active: false,
      minutes: 0,
      targetMinutes,
    }
  );
}

function completedFastEntry(
  state: AppState,
  metric: MetricDefinition,
  startedAt: Date,
  endedAt: Date,
  id: string,
  label: string,
  endedAutomatically: boolean,
  source: MetricEntry["source"] = "manual",
): MetricEntry {
  const minutes = Math.max(1, elapsedMinutes(startedAt, endedAt));
  return {
    id,
    metricId: metric.id,
    userId: state.currentUserId,
    value: Number((minutes / 60).toFixed(2)),
    localDate: dateKey(endedAt),
    recordedAt: endedAt.toISOString(),
    visibility: metric.defaultVisibility,
    source,
    sourceUpdatedAt: endedAt.toISOString(),
    sourceRecordId: id,
    label,
    submetricValues: {
      fast_started_at_ms: startedAt.getTime(),
      fast_ended_at_ms: endedAt.getTime(),
      fasting_minutes: minutes,
      eating_window_minutes: Math.max(0, DAY_MINUTES - minutes),
      ended_automatically: endedAutomatically ? 1 : 0,
    },
  };
}

function withRuntime(
  state: AppState,
  metricId: string,
  runtime: FastingRuntimeSetting,
) {
  return {
    ...state,
    settings: {
      ...state.settings,
      fastingRuntimeByMetric: {
        ...(state.settings.fastingRuntimeByMetric ?? {}),
        [metricId]: runtime,
      },
    },
  };
}

/** Starts a durable manual fast without writing a fake numeric log. */
export function startManualFast(
  state: AppState,
  metricId = "intermittent_fasting",
  now = new Date(),
): AppState {
  const metric = fastingMetric(state, metricId);
  if (!metric || Number.isNaN(now.getTime())) return state;
  return withRuntime(state, metric.id, {
    startedAt: now.toISOString(),
    startedManually: true,
  });
}

/** Ends the live manual or inferred fast and stores one normal session entry. */
export function endManualFast(
  state: AppState,
  metricId = "intermittent_fasting",
  now = new Date(),
): AppState {
  const metric = fastingMetric(state, metricId);
  const progress = automaticFastProgress(state, state.currentUserId, now, metricId);
  const startedAt = validDate(progress.startedAt);
  if (!metric || !progress.active || !startedAt || startedAt >= now) return state;
  const id = `${MANUAL_FAST_PREFIX}${now.getTime()}`;
  const entry = completedFastEntry(
    state,
    metric,
    startedAt,
    now,
    id,
    "Fast ended manually",
    false,
  );
  return withRuntime(
    {
      ...state,
      entries: [
        ...state.entries.filter(
          (candidate) =>
            !(
              candidate.userId === state.currentUserId &&
              candidate.id === id
            ),
        ),
        entry,
      ],
    },
    metric.id,
    {
      startedAt: startedAt.toISOString(),
      startedManually: progress.mode === "manual",
      endedAt: now.toISOString(),
      endedBy: "manual",
      suppressAutomaticUntil: nextScheduledStart(
        now,
        metric.fastingSettings?.startTime ?? "20:00",
      ).toISOString(),
    },
  );
}

/**
 * Rebuilds automatic fasting completions from food history and closes an
 * active manual session at the first food only when Auto from meals is on.
 */
export function reconcileAutomaticFasting(
  state: AppState,
  changedEntries?: MetricEntry[],
): AppState {
  const metric = fastingMetric(state);
  if (!metric?.fastingSettings?.automaticFoodBreak) return state;

  const foods = state.entries
    .filter((entry) => isFoodEntry(entry, state.currentUserId))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const foodsByDate = new Map<string, MetricEntry[]>();
  foods.forEach((entry) => {
    const day = foodsByDate.get(entry.localDate) ?? [];
    day.push(entry);
    foodsByDate.set(entry.localDate, day);
  });

  let next = state;
  let runtime = state.settings.fastingRuntimeByMetric?.[metric.id];
  let runtimeStart = validDate(runtime?.startedAt);
  if (
    runtimeStart &&
    runtime?.startedManually &&
    runtime.endedBy === "food" &&
    runtime.endedByFoodEntryId &&
    !foods.some((entry) => entry.id === runtime!.endedByFoodEntryId)
  ) {
    const removedId = `${MANUAL_FAST_PREFIX}food-${runtime.endedByFoodEntryId}`;
    runtime = { startedAt: runtime.startedAt, startedManually: true };
    next = withRuntime(
      {
        ...next,
        entries: next.entries.filter(
          (entry) =>
            !(
              entry.userId === state.currentUserId && entry.id === removedId
            ),
        ),
      },
      metric.id,
      runtime,
    );
    runtimeStart = validDate(runtime.startedAt);
  }
  if (runtimeStart && runtime?.startedManually) {
    const foodAfterStart = foods.find(
      (entry) => new Date(entry.recordedAt) > runtimeStart,
    );
    if (!runtime.endedAt && foodAfterStart) {
      const endedAt = new Date(foodAfterStart.recordedAt);
      const id = `${MANUAL_FAST_PREFIX}food-${foodAfterStart.id}`;
      const entry = completedFastEntry(
        state,
        metric,
        runtimeStart,
        endedAt,
        id,
        "Fast ended automatically at first food",
        true,
      );
      next = withRuntime(
        {
          ...next,
          entries: [
            ...next.entries.filter(
              (candidate) =>
                !(
                  candidate.userId === state.currentUserId &&
                  candidate.id.startsWith(`${MANUAL_FAST_PREFIX}food-`)
                ),
            ),
            entry,
          ],
        },
        metric.id,
        {
          ...runtime,
          endedAt: endedAt.toISOString(),
          endedBy: "food",
          endedByFoodEntryId: foodAfterStart.id,
          suppressAutomaticUntil: nextScheduledStart(
            endedAt,
            metric.fastingSettings.startTime,
          ).toISOString(),
        },
      );
    }
  }

  const requestedDates = new Set<string>();
  (changedEntries ?? []).forEach((entry) => {
    if (!isFoodEntry(entry, state.currentUserId)) return;
    requestedDates.add(entry.localDate);
    requestedDates.add(dateWithOffsetFrom(entry.localDate, 1));
  });
  if (!requestedDates.size) {
    foodsByDate.forEach((_entries, localDate) => requestedDates.add(localDate));
    next.entries.forEach((entry) => {
      if (
        entry.userId === state.currentUserId &&
        entry.id.startsWith(AUTO_FAST_PREFIX)
      )
        requestedDates.add(entry.localDate);
    });
  }

  let entries = [...next.entries];
  let changed = next !== state;
  requestedDates.forEach((localDate) => {
    const automaticId = `${AUTO_FAST_PREFIX}${localDate}`;
    const automaticIndex = entries.findIndex(
      (entry) =>
        entry.userId === state.currentUserId && entry.id === automaticId,
    );
    const manualForDay = entries.some(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === metric.id &&
        entry.localDate === localDate &&
        entry.id !== automaticId,
    );
    const firstFood = foodsByDate.get(localDate)?.[0];
    if (manualForDay || !firstFood) {
      if (automaticIndex >= 0) {
        entries.splice(automaticIndex, 1);
        changed = true;
      }
      return;
    }

    const endedAt = new Date(firstFood.recordedAt);
    const previousLastFood = foods
      .filter((food) => new Date(food.recordedAt) < endedAt)
      .at(-1);
    const startedAt = previousLastFood
      ? new Date(previousLastFood.recordedAt)
      : scheduledFastStart(
          endedAt,
          localDate,
          metric.fastingSettings?.startTime ?? "20:00",
        );
    if (!startedAt || startedAt >= endedAt) return;

    const automaticEntry = completedFastEntry(
      state,
      metric,
      startedAt,
      endedAt,
      automaticId,
      "Fast ended automatically at first food",
      true,
      "calculated",
    );
    automaticEntry.sourceProvider = firstFood.sourceProvider;
    automaticEntry.sourceOrigin = firstFood.sourceOrigin;
    automaticEntry.sourceUpdatedAt =
      firstFood.sourceUpdatedAt ?? firstFood.recordedAt;
    if (automaticIndex >= 0) entries[automaticIndex] = automaticEntry;
    else entries.push(automaticEntry);
    changed = true;
  });

  return changed ? { ...next, entries } : next;
}

/** Backward-compatible entry point used by Health Connect import paths. */
export function applyImportedFoodFastBreaks(
  state: AppState,
  importedEntries: MetricEntry[],
): AppState {
  return reconcileAutomaticFasting(state, importedEntries);
}
