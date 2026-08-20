import { dateKey } from "./date";
import type { MetricEntry } from "../types";

const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function validIso(value: string | undefined) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Applies a user-selected clock time without changing the meal's calendar day
 * or any value, visibility, source identity, or nutrition payload.
 */
export function editFoodEntryClockTime(
  entry: MetricEntry,
  currentUserId: string,
  clockTime: string,
  editedAt: string,
): MetricEntry | undefined {
  if (
    entry.userId !== currentUserId ||
    entry.metricId !== "food" ||
    entry.source === "calculated" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.localDate)
  )
    return undefined;
  const match = CLOCK_TIME_PATTERN.exec(clockTime);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) return undefined;

  const local = new Date(
    Number(entry.localDate.slice(0, 4)),
    Number(entry.localDate.slice(5, 7)) - 1,
    Number(entry.localDate.slice(8, 10)),
    hour,
    minute,
    0,
    0,
  );
  // Reject malformed dates and clock times skipped by a local DST transition.
  if (
    !Number.isFinite(local.getTime()) ||
    dateKey(local) !== entry.localDate ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  )
    return undefined;

  const recordedAt = local.toISOString();
  const requestedRevision = validIso(editedAt);
  if (!requestedRevision) return undefined;
  const previousRevision = validIso(entry.sourceUpdatedAt);
  const revision = new Date(
    Math.max(
      new Date(requestedRevision).getTime(),
      previousRevision ? new Date(previousRevision).getTime() + 1 : 0,
    ),
  ).toISOString();
  if (recordedAt === entry.recordedAt && entry.recordedAtOverride === recordedAt)
    return entry;
  return {
    ...entry,
    recordedAt,
    recordedAtOverride: recordedAt,
    sourceUpdatedAt: revision,
  };
}

/**
 * Health refreshes may update the original meal record, but a user's chosen
 * meal time remains authoritative until they edit it again.
 */
export function preserveFoodEntryClockOverride(
  existing: MetricEntry | undefined,
  incoming: MetricEntry,
): MetricEntry {
  if (
    incoming.metricId !== "food" ||
    !existing?.recordedAtOverride ||
    existing.userId !== incoming.userId ||
    existing.id !== incoming.id
  )
    return incoming;
  const incomingRevision = validIso(incoming.sourceUpdatedAt);
  const existingRevision = validIso(existing.sourceUpdatedAt);
  return {
    ...incoming,
    localDate: existing.localDate,
    recordedAt: existing.recordedAtOverride,
    recordedAtOverride: existing.recordedAtOverride,
    sourceUpdatedAt:
      incomingRevision &&
      (!existingRevision || incomingRevision > existingRevision)
        ? incomingRevision
        : existingRevision ?? incoming.sourceUpdatedAt,
  };
}

export type FoodMacroId = "protein" | "carbs" | "fat";
export type FoodMacroRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "overall"
  | "custom";

export const FOOD_MACROS: readonly {
  id: FoodMacroId;
  label: string;
  nutritionKey: "proteinG" | "carbsG" | "fatG";
  caloriesPerGram: number;
  color: string;
  icon: "barbell-outline" | "leaf-outline" | "water-outline";
}[] = [
  {
    id: "protein",
    label: "Protein",
    nutritionKey: "proteinG",
    caloriesPerGram: 4,
    color: "#B05C8C",
    icon: "barbell-outline",
  },
  {
    id: "carbs",
    label: "Carbs",
    nutritionKey: "carbsG",
    caloriesPerGram: 4,
    color: "#8A6B32",
    icon: "leaf-outline",
  },
  {
    id: "fat",
    label: "Fat",
    nutritionKey: "fatG",
    caloriesPerGram: 9,
    color: "#E08A32",
    icon: "water-outline",
  },
] as const;

export type FoodMacroSlice = {
  id: FoodMacroId;
  label: string;
  color: string;
  grams: number;
  percent: number;
  goal?: number;
};

export type FoodMacroBucket = {
  key: string;
  label: string;
  values: Record<FoodMacroId, number | null>;
};

export type FoodMacroReport = {
  slices: FoodMacroSlice[];
  buckets: FoodMacroBucket[];
  dayValues?: Record<FoodMacroId, number>;
  hasData: boolean;
  bucketUnit: "day" | "month" | "year";
};

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function emptyMacroValues(): Record<FoodMacroId, number> {
  return { protein: 0, carbs: 0, fat: 0 };
}

function macroValuesByDate(entries: readonly MetricEntry[], userId: string) {
  const byDate = new Map<string, Record<FoodMacroId, number>>();
  for (const entry of entries) {
    if (
      entry.userId !== userId ||
      entry.metricId !== "food" ||
      !entry.nutrition
    )
      continue;
    const values = byDate.get(entry.localDate) ?? emptyMacroValues();
    let captured = false;
    for (const macro of FOOD_MACROS) {
      const amount = Number(entry.nutrition[macro.nutritionKey]);
      if (!Number.isFinite(amount) || amount < 0) continue;
      values[macro.id] += amount;
      captured = true;
    }
    if (captured) byDate.set(entry.localDate, values);
  }
  return byDate;
}

function monthLabel(key: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(
    new Date(`${key}-15T12:00:00`),
  );
}

function dayLabel(key: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${key}T12:00:00`));
}

function averageMacroValues(
  dates: readonly string[],
  byDate: ReadonlyMap<string, Record<FoodMacroId, number>>,
) {
  const captured = dates
    .map((date) => byDate.get(date))
    .filter((value): value is Record<FoodMacroId, number> => Boolean(value));
  if (!captured.length)
    return { protein: null, carbs: null, fat: null } as Record<
      FoodMacroId,
      number | null
    >;
  return Object.fromEntries(
    FOOD_MACROS.map((macro) => [
      macro.id,
      rounded(
        captured.reduce((sum, values) => sum + values[macro.id], 0) /
          captured.length,
      ),
    ]),
  ) as Record<FoodMacroId, number | null>;
}

function periodBuckets(
  range: FoodMacroRange,
  dates: readonly string[],
  byDate: ReadonlyMap<string, Record<FoodMacroId, number>>,
  locale: string,
): Pick<FoodMacroReport, "buckets" | "bucketUnit"> {
  if (range === "year") {
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    return {
      bucketUnit: "month",
      buckets: monthKeys.map((key) => ({
        key,
        label: monthLabel(key, locale),
        values: averageMacroValues(
          dates.filter((date) => date.startsWith(key)),
          byDate,
        ),
      })),
    };
  }
  if (range === "overall") {
    const first = dates[0];
    const last = dates.at(-1);
    const years = first && last ? Number(last.slice(0, 4)) - Number(first.slice(0, 4)) + 1 : 0;
    if (years > 2) {
      const yearKeys = [...new Set(dates.map((date) => date.slice(0, 4)))];
      return {
        bucketUnit: "year",
        buckets: yearKeys.map((key) => ({
          key,
          label: key,
          values: averageMacroValues(
            dates.filter((date) => date.startsWith(key)),
            byDate,
          ),
        })),
      };
    }
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    return {
      bucketUnit: "month",
      buckets: monthKeys.map((key) => ({
        key,
        label: monthLabel(key, locale),
        values: averageMacroValues(
          dates.filter((date) => date.startsWith(key)),
          byDate,
        ),
      })),
    };
  }
  return {
    bucketUnit: "day",
    buckets: dates.map((key) => ({
      key,
      label: dayLabel(key, locale),
      values: Object.fromEntries(
        FOOD_MACROS.map((macro) => [
          macro.id,
          byDate.has(key) ? rounded(byDate.get(key)![macro.id]) : null,
        ]),
      ) as Record<FoodMacroId, number | null>,
    })),
  };
}

/**
 * Produces one nutrition report for the exact date range shown by the food
 * detail page. Pie percentages use macro energy (4/4/9 kcal per gram), while
 * displayed actuals remain grams.
 */
export function foodMacroReport({
  entries,
  userId,
  range,
  dates,
  anchorDate,
  selectedIds,
  goals = {},
  locale = "en",
}: {
  entries: readonly MetricEntry[];
  userId: string;
  range: FoodMacroRange;
  dates: readonly string[];
  anchorDate: string;
  selectedIds: readonly FoodMacroId[];
  goals?: Partial<Record<FoodMacroId, number>>;
  locale?: string;
}): FoodMacroReport {
  const byDate = macroValuesByDate(entries, userId);
  const selected = FOOD_MACROS.filter((macro) =>
    selectedIds.includes(macro.id),
  );
  const reportDates =
    range === "overall"
      ? [...byDate.keys()].filter((date) => date <= anchorDate).sort()
      : [...dates].sort();
  const totals = emptyMacroValues();
  for (const date of reportDates) {
    const values = byDate.get(date);
    if (!values) continue;
    for (const macro of FOOD_MACROS) totals[macro.id] += values[macro.id];
  }
  const selectedCalories = selected.reduce(
    (sum, macro) => sum + totals[macro.id] * macro.caloriesPerGram,
    0,
  );
  const slices = selected.map((macro) => ({
    id: macro.id,
    label: macro.label,
    color: macro.color,
    grams: rounded(totals[macro.id]),
    percent:
      selectedCalories > 0
        ? rounded((totals[macro.id] * macro.caloriesPerGram * 100) / selectedCalories)
        : 0,
    goal:
      Number.isFinite(goals[macro.id]) && Number(goals[macro.id]) > 0
        ? Number(goals[macro.id])
        : undefined,
  }));
  const bucketReport = periodBuckets(
    range,
    reportDates,
    byDate,
    locale,
  );
  const dayValues =
    reportDates.length === 1
      ? Object.fromEntries(
          FOOD_MACROS.map((macro) => [
            macro.id,
            rounded(byDate.get(reportDates[0])?.[macro.id] ?? 0),
          ]),
        ) as Record<FoodMacroId, number>
      : undefined;
  return {
    slices,
    dayValues,
    ...bucketReport,
    hasData: slices.some((slice) => slice.grams > 0),
  };
}
