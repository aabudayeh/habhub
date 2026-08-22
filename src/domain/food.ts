import { dateKey } from "./date";
import type { MetricEntry, NutritionDetails } from "../types";

const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** Locale-tolerant nutrition inputs are stored only when they contain intake. */
export function parsePositiveFoodNutrientAmount(
  raw: string | number | undefined,
) {
  if (raw === undefined) return undefined;
  const amount =
    typeof raw === "string" ? Number(raw.trim().replace(",", ".")) : raw;
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

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
export type FoodNutrientId =
  | FoodMacroId
  | "fiber"
  | "sodium"
  | "sugar"
  | "saturated_fat"
  | "cholesterol"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium"
  | "vitamin_c"
  | "vitamin_d"
  | "vitamin_b12"
  | "sugar_alcohol"
  | "alcohol"
  | "trans_fat"
  | "monounsaturated_fat"
  | "polyunsaturated_fat"
  | "omega_3"
  | "omega_6"
  | "starch"
  | "phosphorus"
  | "zinc"
  | "copper"
  | "manganese"
  | "selenium"
  | "iodine"
  | "vitamin_a"
  | "vitamin_e"
  | "vitamin_k"
  | "vitamin_b1"
  | "vitamin_b2"
  | "vitamin_b3"
  | "vitamin_b5"
  | "vitamin_b6"
  | "vitamin_b9"
  | "folic_acid"
  | "caffeine"
  | "biotin"
  | "chloride"
  | "chromium"
  | "molybdenum";
export type FoodMacroRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "overall"
  | "custom";

export type FoodNutrientDefinition = {
  id: FoodNutrientId;
  label: string;
  nutritionKey: Exclude<keyof NutritionDetails, "mealType">;
  unit: "g" | "mg" | "mcg";
  caloriesPerGram?: 4 | 9;
  color: string;
  icon:
    | "barbell-outline"
    | "leaf-outline"
    | "ellipse-outline"
    | "flower-outline"
    | "water-outline"
    | "cube-outline"
    | "heart-outline"
    | "medical-outline"
    | "fitness-outline"
    | "sparkles-outline"
    | "sunny-outline"
    | "medkit-outline";
  group:
    | "Macros"
    | "Carbohydrates"
    | "Fats"
    | "Other nutrients"
    | "Minerals"
    | "Vitamins";
};

/**
 * The normalized nutrient fields that food entries can currently carry. The
 * id is also the linked built-in tracker id, so every visual can open the
 * corresponding detail page without maintaining a second mapping.
 */
export const FOOD_NUTRIENTS: readonly FoodNutrientDefinition[] = [
  {
    id: "protein",
    label: "Protein",
    nutritionKey: "proteinG",
    unit: "g",
    caloriesPerGram: 4,
    color: "#B05C8C",
    icon: "barbell-outline",
    group: "Macros",
  },
  {
    id: "carbs",
    label: "Carbs",
    nutritionKey: "carbsG",
    unit: "g",
    caloriesPerGram: 4,
    color: "#8A6B32",
    icon: "leaf-outline",
    group: "Macros",
  },
  {
    id: "fat",
    label: "Fat",
    nutritionKey: "fatG",
    unit: "g",
    caloriesPerGram: 9,
    color: "#E08A32",
    icon: "ellipse-outline",
    group: "Macros",
  },
  {
    id: "fiber",
    label: "Fiber",
    nutritionKey: "fiberG",
    unit: "g",
    color: "#337B7B",
    icon: "flower-outline",
    group: "Carbohydrates",
  },
  {
    id: "sugar",
    label: "Sugar",
    nutritionKey: "sugarG",
    unit: "g",
    color: "#C47C47",
    icon: "cube-outline",
    group: "Carbohydrates",
  },
  {
    id: "saturated_fat",
    label: "Saturated fat",
    nutritionKey: "saturatedFatG",
    unit: "g",
    color: "#A85D49",
    icon: "ellipse-outline",
    group: "Fats",
  },
  {
    id: "cholesterol",
    label: "Cholesterol",
    nutritionKey: "cholesterolMg",
    unit: "mg",
    color: "#9B3F72",
    icon: "heart-outline",
    group: "Other nutrients",
  },
  {
    id: "sodium",
    label: "Sodium",
    nutritionKey: "sodiumMg",
    unit: "mg",
    color: "#6D7FA8",
    icon: "water-outline",
    group: "Minerals",
  },
  {
    id: "potassium",
    label: "Potassium",
    nutritionKey: "potassiumMg",
    unit: "mg",
    color: "#5F8C57",
    icon: "leaf-outline",
    group: "Minerals",
  },
  {
    id: "calcium",
    label: "Calcium",
    nutritionKey: "calciumMg",
    unit: "mg",
    color: "#71839B",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "iron",
    label: "Iron",
    nutritionKey: "ironMg",
    unit: "mg",
    color: "#8D5A45",
    icon: "fitness-outline",
    group: "Minerals",
  },
  {
    id: "magnesium",
    label: "Magnesium",
    nutritionKey: "magnesiumMg",
    unit: "mg",
    color: "#7462A8",
    icon: "sparkles-outline",
    group: "Minerals",
  },
  {
    id: "vitamin_c",
    label: "Vitamin C",
    nutritionKey: "vitaminCMg",
    unit: "mg",
    color: "#E08A32",
    icon: "sunny-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_d",
    label: "Vitamin D",
    nutritionKey: "vitaminDMcg",
    unit: "mcg",
    color: "#D2A329",
    icon: "sunny-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b12",
    label: "Vitamin B12",
    nutritionKey: "vitaminB12Mcg",
    unit: "mcg",
    color: "#B05C8C",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "sugar_alcohol",
    label: "Sugar alcohol",
    nutritionKey: "sugarAlcoholG",
    unit: "g",
    color: "#B47A5A",
    icon: "cube-outline",
    group: "Carbohydrates",
  },
  {
    id: "starch",
    label: "Starch",
    nutritionKey: "starchG",
    unit: "g",
    color: "#9B7A3D",
    icon: "leaf-outline",
    group: "Carbohydrates",
  },
  {
    id: "trans_fat",
    label: "Trans fat",
    nutritionKey: "transFatG",
    unit: "g",
    color: "#9F5A4A",
    icon: "ellipse-outline",
    group: "Fats",
  },
  {
    id: "monounsaturated_fat",
    label: "Monounsaturated fat",
    nutritionKey: "monounsaturatedFatG",
    unit: "g",
    color: "#C7793D",
    icon: "ellipse-outline",
    group: "Fats",
  },
  {
    id: "polyunsaturated_fat",
    label: "Polyunsaturated fat",
    nutritionKey: "polyunsaturatedFatG",
    unit: "g",
    color: "#D5963E",
    icon: "ellipse-outline",
    group: "Fats",
  },
  {
    id: "omega_3",
    label: "Omega-3",
    nutritionKey: "omega3G",
    unit: "g",
    color: "#3E8F9C",
    icon: "water-outline",
    group: "Fats",
  },
  {
    id: "omega_6",
    label: "Omega-6",
    nutritionKey: "omega6G",
    unit: "g",
    color: "#B08A42",
    icon: "water-outline",
    group: "Fats",
  },
  {
    id: "phosphorus",
    label: "Phosphorus",
    nutritionKey: "phosphorusMg",
    unit: "mg",
    color: "#657C9A",
    icon: "sparkles-outline",
    group: "Minerals",
  },
  {
    id: "zinc",
    label: "Zinc",
    nutritionKey: "zincMg",
    unit: "mg",
    color: "#737E8A",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "copper",
    label: "Copper",
    nutritionKey: "copperMg",
    unit: "mg",
    color: "#A8663E",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "manganese",
    label: "Manganese",
    nutritionKey: "manganeseMg",
    unit: "mg",
    color: "#79634F",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "selenium",
    label: "Selenium",
    nutritionKey: "seleniumMcg",
    unit: "mcg",
    color: "#5D7C88",
    icon: "sparkles-outline",
    group: "Minerals",
  },
  {
    id: "iodine",
    label: "Iodine",
    nutritionKey: "iodineMcg",
    unit: "mcg",
    color: "#6C61A5",
    icon: "water-outline",
    group: "Minerals",
  },
  {
    id: "chloride",
    label: "Chloride",
    nutritionKey: "chlorideMg",
    unit: "mg",
    color: "#5D8193",
    icon: "water-outline",
    group: "Minerals",
  },
  {
    id: "chromium",
    label: "Chromium",
    nutritionKey: "chromiumMcg",
    unit: "mcg",
    color: "#6E7781",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "molybdenum",
    label: "Molybdenum",
    nutritionKey: "molybdenumMcg",
    unit: "mcg",
    color: "#637481",
    icon: "medical-outline",
    group: "Minerals",
  },
  {
    id: "vitamin_a",
    label: "Vitamin A",
    nutritionKey: "vitaminAMcg",
    unit: "mcg",
    color: "#D98235",
    icon: "sunny-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_e",
    label: "Vitamin E",
    nutritionKey: "vitaminEMg",
    unit: "mg",
    color: "#B88B35",
    icon: "sunny-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_k",
    label: "Vitamin K",
    nutritionKey: "vitaminKMcg",
    unit: "mcg",
    color: "#5D914E",
    icon: "leaf-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b1",
    label: "Vitamin B1",
    nutritionKey: "thiaminMg",
    unit: "mg",
    color: "#9A6AA5",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b2",
    label: "Vitamin B2",
    nutritionKey: "riboflavinMg",
    unit: "mg",
    color: "#A96591",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b3",
    label: "Vitamin B3",
    nutritionKey: "niacinMg",
    unit: "mg",
    color: "#8D65A5",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b5",
    label: "Vitamin B5",
    nutritionKey: "pantothenicAcidMg",
    unit: "mg",
    color: "#7A69AA",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b6",
    label: "Vitamin B6",
    nutritionKey: "vitaminB6Mg",
    unit: "mg",
    color: "#6E70AE",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "vitamin_b9",
    label: "Vitamin B9",
    nutritionKey: "folateMcg",
    unit: "mcg",
    color: "#667AAD",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "folic_acid",
    label: "Folic acid",
    nutritionKey: "folicAcidMcg",
    unit: "mcg",
    color: "#5F82A7",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "biotin",
    label: "Biotin",
    nutritionKey: "biotinMcg",
    unit: "mcg",
    color: "#8B6EA4",
    icon: "medkit-outline",
    group: "Vitamins",
  },
  {
    id: "alcohol",
    label: "Alcohol",
    nutritionKey: "alcoholG",
    unit: "g",
    color: "#8A6579",
    icon: "water-outline",
    group: "Other nutrients",
  },
  {
    id: "caffeine",
    label: "Caffeine",
    nutritionKey: "caffeineMg",
    unit: "mg",
    color: "#795A45",
    icon: "water-outline",
    group: "Other nutrients",
  },
] as const;

export const FOOD_MACROS = FOOD_NUTRIENTS.filter(
  (nutrient): nutrient is FoodNutrientDefinition & { id: FoodMacroId; caloriesPerGram: 4 | 9 } =>
    nutrient.id === "protein" || nutrient.id === "carbs" || nutrient.id === "fat",
);

const FOOD_NUTRIENT_IDS = new Set<string>(
  FOOD_NUTRIENTS.map((nutrient) => nutrient.id),
);

/** True for the built-in trackers that are linked to Food nutrition fields. */
export function isFoodNutrientTrackerId(id: string): id is FoodNutrientId {
  return FOOD_NUTRIENT_IDS.has(id);
}

/** Positive nutrient quantities actually carried by one Food record. */
export function capturedFoodNutrients(nutrition: NutritionDetails | undefined) {
  if (!nutrition) return [];
  return FOOD_NUTRIENTS.flatMap((nutrient) => {
    const value = Number(nutrition[nutrient.nutritionKey]);
    return Number.isFinite(value) && value > 0
      ? [{ metricId: nutrient.id, value }]
      : [];
  });
}

const FOOD_NUTRIENT_DETAIL_ENTRY_PREFIX = "food-nutrient-detail:";

/** True only for an in-memory nutrient row projected from its Food parent. */
export function isFoodNutrientDetailEntry(entry: Pick<MetricEntry, "id">) {
  return entry.id.startsWith(FOOD_NUTRIENT_DETAIL_ENTRY_PREFIX);
}

function foodSourceKey(entry: MetricEntry) {
  return entry.sourceRecordId
    ? `${entry.sourceProvider ?? ""}\u0000${entry.sourceRecordId}`
    : undefined;
}

/**
 * Builds the nutrient detail page's read-only view from canonical Food rows.
 *
 * Persisted sidecars remain useful for cloud sharing and explicitly configured
 * trackers, but older snapshots can legitimately be missing them. The Food
 * payload is the source of truth for a meal, so this view replaces any linked
 * sidecar with one calculated projection and leaves standalone dietary records
 * (for example Apple Health nutrient samples) untouched. Nothing returned by
 * this function is written back to app state or made discoverable as a tracker.
 */
export function foodNutrientDetailEntries(
  entries: readonly MetricEntry[],
  userId: string,
  nutrientId: FoodNutrientId,
): readonly MetricEntry[] {
  const nutrient = FOOD_NUTRIENTS.find((item) => item.id === nutrientId);
  if (!nutrient) return entries;

  const foodParents = entries.filter(
    (entry) =>
      entry.userId === userId &&
      entry.metricId === "food" &&
      Boolean(entry.nutrition),
  );
  if (!foodParents.length) return entries;

  const parents = foodParents.flatMap((entry) => {
    if (
      !entry.nutrition
    )
      return [];
    const value = Number(entry.nutrition[nutrient.nutritionKey]);
    return Number.isFinite(value) && value > 0 ? [{ entry, value }] : [];
  });
  const linkedSidecarIds = new Set(
    foodParents.flatMap((entry) => [
      `${entry.id}:nutrient:${nutrientId}`,
      `${FOOD_NUTRIENT_DETAIL_ENTRY_PREFIX}${entry.id}:${nutrientId}`,
    ]),
  );
  const linkedSourceKeys = new Set(
    foodParents.flatMap((entry) => {
      const key = foodSourceKey(entry);
      return key ? [key] : [];
    }),
  );
  const linkedSidecarKeys = new Set<string>();
  for (const candidate of entries) {
    if (
      candidate.userId === userId &&
      candidate.metricId === nutrientId &&
      (linkedSidecarIds.has(candidate.id) ||
        linkedSourceKeys.has(foodSourceKey(candidate) ?? ""))
    )
      linkedSidecarKeys.add(`${candidate.userId}\u0000${candidate.id}`);
  }

  const projections: MetricEntry[] = parents.map(({ entry: parent, value }) => ({
    id: `${FOOD_NUTRIENT_DETAIL_ENTRY_PREFIX}${parent.id}:${nutrientId}`,
    metricId: nutrientId,
    userId: parent.userId,
    value,
    localDate: parent.localDate,
    recordedAt: parent.recordedAt,
    recordedAtOverride: parent.recordedAtOverride,
    visibility: parent.visibility,
    source: "calculated",
    label: parent.label,
    sourceProvider: parent.sourceProvider,
    sourceRecordId: parent.sourceRecordId,
    sourceOrigin: parent.sourceOrigin,
    sourceUpdatedAt: parent.sourceUpdatedAt,
    sourceRevision: parent.sourceRevision,
  }));

  return [
    ...entries.filter(
      (entry) => !linkedSidecarKeys.has(`${entry.userId}\u0000${entry.id}`),
    ),
    ...projections,
  ];
}

export function hasFoodNutrientTracker(
  metrics: readonly { id: string }[],
  id: FoodNutrientId,
) {
  return metrics.some((metric) => metric.id === id);
}

export function nextFoodNutrientTrackerOrder(
  metrics: readonly { order: number }[],
) {
  return Math.max(-1, ...metrics.map((metric) => metric.order)) + 1;
}

export type FoodMacroSlice = {
  id: FoodMacroId;
  label: string;
  color: string;
  value: number;
  unit: "g";
  percent: number;
  goal?: number;
};

export type FoodNutrientSummary = {
  id: FoodNutrientId;
  label: string;
  color: string;
  unit: "g" | "mg" | "mcg";
  value: number;
  goal?: number;
};

export type FoodNutrientBucket = {
  key: string;
  label: string;
  values: Partial<Record<FoodNutrientId, number | null>>;
  recordedDays: number;
};

/** @deprecated Retained for callers compiled against the first macro report. */
export type FoodMacroBucket = FoodNutrientBucket;

export type FoodNutritionReport = {
  macroSlices: FoodMacroSlice[];
  nutrients: FoodNutrientSummary[];
  availableIds: FoodNutrientId[];
  buckets: FoodNutrientBucket[];
  dayValues?: Partial<Record<FoodNutrientId, number>>;
  averageValues: Partial<Record<FoodNutrientId, number>>;
  recordedDayCount: number;
  hasData: boolean;
  hasMacroData: boolean;
  bucketUnit: "day" | "month" | "year";
};

/** @deprecated The richer report remains source-compatible by alias. */
export type FoodMacroReport = FoodNutritionReport;

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

type CapturedNutrients = {
  values: Partial<Record<FoodNutrientId, number>>;
  present: Set<FoodNutrientId>;
};

function emptyNutrientValues(): Partial<Record<FoodNutrientId, number>> {
  return {};
}

function nutrientValuesByDate(entries: readonly MetricEntry[], userId: string) {
  const byDate = new Map<string, CapturedNutrients>();
  const foodSourceRecords = new Set(
    entries.flatMap((entry) =>
      entry.userId === userId &&
      entry.metricId === "food" &&
      entry.sourceProvider &&
      entry.sourceRecordId
        ? [`${entry.sourceProvider}\u0000${entry.sourceRecordId}`]
        : [],
    ),
  );
  const capture = (
    localDate: string,
    nutrient: FoodNutrientDefinition,
    amount: number,
  ) => {
    const captured = byDate.get(localDate) ?? {
      values: emptyNutrientValues(),
      present: new Set<FoodNutrientId>(),
    };
    captured.values[nutrient.id] = (captured.values[nutrient.id] ?? 0) + amount;
    captured.present.add(nutrient.id);
    byDate.set(localDate, captured);
  };
  for (const entry of entries) {
    if (
      entry.userId !== userId ||
      entry.metricId !== "food" ||
      !entry.nutrition
    )
      continue;
    for (const nutrient of FOOD_NUTRIENTS) {
      const raw = entry.nutrition[nutrient.nutritionKey];
      const amount = Number(raw);
      // A source-present zero is not useful evidence that the nutrient was
      // actually captured (some health providers materialize absent optional
      // masses as zero). Keep the range menu limited to logged intake.
      if (raw === undefined || !Number.isFinite(amount) || amount <= 0) continue;
      capture(entry.localDate, nutrient, amount);
    }
  }
  // Apple Health exposes each dietary quantity as its own imported record, so
  // a nutrient can legitimately have no calorie/food parent. Include only
  // identified imported sidecars whose native record is not already carried
  // by a full food entry; manual sidecars and Health Connect companions remain
  // excluded to prevent double counting.
  const nutrientByMetricId = new Map(
    FOOD_NUTRIENTS.map((nutrient) => [nutrient.id, nutrient]),
  );
  for (const entry of entries) {
    if (
      entry.userId !== userId ||
      entry.source !== "imported" ||
      !entry.sourceProvider ||
      !entry.sourceRecordId
    )
      continue;
    const nutrient = nutrientByMetricId.get(entry.metricId as FoodNutrientId);
    if (!nutrient) continue;
    if (
      foodSourceRecords.has(`${entry.sourceProvider}\u0000${entry.sourceRecordId}`)
    )
      continue;
    const amount = Number(entry.value);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    capture(entry.localDate, nutrient, amount);
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

function averageNutrientValues(
  dates: readonly string[],
  byDate: ReadonlyMap<string, CapturedNutrients>,
) {
  const captured = dates
    .map((date) => byDate.get(date))
    .filter((value): value is CapturedNutrients => Boolean(value));
  if (!captured.length) return {};
  return Object.fromEntries(
    FOOD_NUTRIENTS.flatMap((nutrient) => {
      // Missing optional nutrition is unknown, not zero. This matters for
      // sparse provider records (Apple Health commonly stores one dietary
      // quantity per record), so every nutrient uses only its own captured
      // days as the denominator.
      const recorded = captured.filter((values) =>
        values.present.has(nutrient.id),
      );
      return recorded.length
        ? [
            [
              nutrient.id,
              rounded(
                recorded.reduce(
                  (sum, values) => sum + (values.values[nutrient.id] ?? 0),
                  0,
                ) / recorded.length,
              ),
            ],
          ]
        : [];
    }),
  ) as Partial<Record<FoodNutrientId, number>>;
}

function periodBuckets(
  range: FoodMacroRange,
  dates: readonly string[],
  byDate: ReadonlyMap<string, CapturedNutrients>,
  locale: string,
): Pick<FoodNutritionReport, "buckets" | "bucketUnit"> {
  if (range === "year") {
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    return {
      bucketUnit: "month",
      buckets: monthKeys.map((key) => {
        const bucketDates = dates.filter((date) => date.startsWith(key));
        return {
          key,
          label: monthLabel(key, locale),
          values: averageNutrientValues(bucketDates, byDate),
          recordedDays: bucketDates.filter((date) => byDate.has(date)).length,
        };
      }),
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
        buckets: yearKeys.map((key) => {
          const bucketDates = dates.filter((date) => date.startsWith(key));
          return {
            key,
            label: key,
            values: averageNutrientValues(bucketDates, byDate),
            recordedDays: bucketDates.filter((date) => byDate.has(date)).length,
          };
        }),
      };
    }
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    return {
      bucketUnit: "month",
      buckets: monthKeys.map((key) => {
        const bucketDates = dates.filter((date) => date.startsWith(key));
        return {
          key,
          label: monthLabel(key, locale),
          values: averageNutrientValues(bucketDates, byDate),
          recordedDays: bucketDates.filter((date) => byDate.has(date)).length,
        };
      }),
    };
  }
  return {
    bucketUnit: "day",
    buckets: dates.map((key) => ({
      key,
      label: dayLabel(key, locale),
      values: Object.fromEntries(
        FOOD_NUTRIENTS.map((nutrient) => [
          nutrient.id,
          byDate.get(key)?.present.has(nutrient.id)
            ? rounded(byDate.get(key)?.values[nutrient.id] ?? 0)
            : null,
        ]),
      ) as Partial<Record<FoodNutrientId, number | null>>,
      recordedDays: byDate.has(key) ? 1 : 0,
    })),
  };
}

/**
 * Produces one nutrition report for the exact date range shown by the food
 * detail page. Pie percentages use macro energy (4/4/9 kcal per gram), while
 * every broader nutrient remains in its normalized g, mg, or microgram unit.
 */
export function foodNutritionReport({
  entries,
  userId,
  range,
  dates,
  anchorDate,
  goals = {},
  locale = "en",
}: {
  entries: readonly MetricEntry[];
  userId: string;
  range: FoodMacroRange;
  dates: readonly string[];
  anchorDate: string;
  goals?: Partial<Record<FoodNutrientId, number>>;
  locale?: string;
}): FoodNutritionReport {
  const byDate = nutrientValuesByDate(entries, userId);
  const reportDates =
    range === "overall"
      ? [...byDate.keys()].filter((date) => date <= anchorDate).sort()
      : [...dates].sort();
  const rangePresent = new Set<FoodNutrientId>();
  for (const date of reportDates)
    for (const nutrient of byDate.get(date)?.present ?? [])
      rangePresent.add(nutrient);
  const availableIds = FOOD_NUTRIENTS.filter((nutrient) =>
    rangePresent.has(nutrient.id),
  ).map((nutrient) => nutrient.id);
  const selected = FOOD_NUTRIENTS.filter((nutrient) =>
    rangePresent.has(nutrient.id),
  );
  const totals = emptyNutrientValues();
  for (const date of reportDates) {
    const values = byDate.get(date);
    if (!values) continue;
    for (const nutrient of FOOD_NUTRIENTS)
      totals[nutrient.id] =
        (totals[nutrient.id] ?? 0) + (values.values[nutrient.id] ?? 0);
  }
  const macroCalories = FOOD_MACROS.reduce(
    (sum, macro) => sum + (totals[macro.id] ?? 0) * macro.caloriesPerGram,
    0,
  );
  const macroSlices = FOOD_MACROS.map((macro) => ({
    id: macro.id,
    label: macro.label,
    color: macro.color,
    value: rounded(totals[macro.id] ?? 0),
    unit: "g" as const,
    percent:
      macroCalories > 0
        ? rounded(((totals[macro.id] ?? 0) * macro.caloriesPerGram * 100) / macroCalories)
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
  const recordedDayCount = reportDates.filter((date) => byDate.has(date)).length;
  const averageValues = averageNutrientValues(reportDates, byDate);
  const dayValues =
    reportDates.length === 1
      ? Object.fromEntries(
          FOOD_NUTRIENTS.map((nutrient) => [
            nutrient.id,
            rounded(byDate.get(reportDates[0])?.values[nutrient.id] ?? 0),
          ]),
        ) as Partial<Record<FoodNutrientId, number>>
      : undefined;
  const nutrients = selected.map((nutrient) => ({
    id: nutrient.id,
    label: nutrient.label,
    color: nutrient.color,
    unit: nutrient.unit,
    value: rounded(totals[nutrient.id] ?? 0),
    goal:
      Number.isFinite(goals[nutrient.id]) && Number(goals[nutrient.id]) > 0
        ? Number(goals[nutrient.id])
        : undefined,
  }));
  return {
    macroSlices,
    nutrients,
    availableIds,
    dayValues,
    averageValues,
    recordedDayCount,
    ...bucketReport,
    hasData: availableIds.length > 0,
    hasMacroData: macroSlices.some((slice) => slice.value > 0),
  };
}

/** @deprecated Prefer the broader nutrition name for new callers. */
export const foodMacroReport = foodNutritionReport;
