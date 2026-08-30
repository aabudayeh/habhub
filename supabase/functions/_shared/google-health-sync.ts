import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  dailyRollUp,
  reconcileDataPoints,
  refreshGoogleAccessToken,
  type GoogleHealthDataPoint,
} from "./google-health-api.ts";
import { googleHealthConfig } from "./google-health-config.ts";
import { decryptSecret, encryptSecret, sha256Hex } from "./google-health-crypto.ts";
import { googleHealthProviderErrorCode } from "./google-health-http.ts";
import { projectPublicChallengesFromSnapshot } from "./public-challenge-projection.ts";

type JsonObject = Record<string, unknown>;
type Metric = JsonObject & {
  id?: string;
  unit?: string;
  dataType?: string;
  defaultVisibility?: string;
  stepFallback?: boolean;
  healthMapping?: Mapping;
  submetrics?: Array<JsonObject & { id?: string; unit?: string; showProgressBar?: boolean; linkedMetricId?: string; healthMapping?: Mapping }>;
};
type Mapping = {
  dataType?: string;
  field?: string;
  activityKeys?: string[];
  workoutRecordKind?: string;
};
type Snapshot = JsonObject & { entries?: JsonObject[]; metrics?: Metric[]; settings?: JsonObject };
type EntryPreference = {
  entry_id?: unknown;
  visibility?: unknown;
  recorded_at_override?: unknown;
  display_local_date?: unknown;
  dismissed?: unknown;
};

type InternalRecord = {
  externalId: string;
  dataType: string;
  startTime: string;
  endTime: string;
  localDate: string;
  value: number | boolean;
  unit: string;
  label?: string;
  note?: string;
  activityKey?: string;
  sourceOrigin?: string;
  measurements?: Record<string, number>;
  nutrition?: Record<string, string | number>;
};

export type GoogleHealthSyncResult = {
  imported: number;
  deleted: number;
  dataTypes: string[];
  errors: Array<{ dataType: string; code: string }>;
};

type DataTypeDefinition = {
  googleType: string;
  internalType: string;
  mode: "daily" | "reconcile";
  filterField?: string;
  maxInitialDays: number;
  pageSize?: number;
  requiredScope: string;
};

export type GoogleHealthDateRange = { fromDate: string; throughDate: string };

const ACTIVITY_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
const HEALTH_SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
const NUTRITION_SCOPE = "https://www.googleapis.com/auth/googlehealth.nutrition.readonly";
const SLEEP_SCOPE = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";

const DATA_TYPES: readonly DataTypeDefinition[] = [
  { googleType: "steps", internalType: "steps", mode: "daily", maxInitialDays: 90, requiredScope: ACTIVITY_SCOPE },
  { googleType: "active-energy-burned", internalType: "active_energy", mode: "daily", maxInitialDays: 90, requiredScope: ACTIVITY_SCOPE },
  // A daily reconciled average prevents minute-level heart samples from
  // inflating the account snapshot while retaining a useful pulse history.
  { googleType: "heart-rate", internalType: "heart_rate", mode: "daily", maxInitialDays: 14, requiredScope: HEALTH_SCOPE },
  { googleType: "weight", internalType: "weight", mode: "reconcile", filterField: "weight.sample_time.physical_time", maxInitialDays: 90, requiredScope: HEALTH_SCOPE },
  { googleType: "body-fat", internalType: "body_fat", mode: "reconcile", filterField: "body_fat.sample_time.physical_time", maxInitialDays: 90, requiredScope: HEALTH_SCOPE },
  { googleType: "blood-glucose", internalType: "blood_glucose", mode: "reconcile", filterField: "blood_glucose.sample_time.physical_time", maxInitialDays: 90, requiredScope: HEALTH_SCOPE },
  { googleType: "sleep", internalType: "sleep", mode: "reconcile", filterField: "sleep.interval.civil_end_time", maxInitialDays: 90, pageSize: 25, requiredScope: SLEEP_SCOPE },
  { googleType: "exercise", internalType: "workouts", mode: "reconcile", filterField: "exercise.interval.civil_start_time", maxInitialDays: 90, pageSize: 25, requiredScope: ACTIVITY_SCOPE },
  { googleType: "hydration-log", internalType: "water", mode: "reconcile", filterField: "hydration_log.interval.civil_start_time", maxInitialDays: 90, requiredScope: NUTRITION_SCOPE },
  { googleType: "nutrition-log", internalType: "nutrition", mode: "reconcile", filterField: "nutrition_log.interval.civil_start_time", maxInitialDays: 90, requiredScope: NUTRITION_SCOPE },
] as const;

const NUTRIENT_FIELDS: Record<string, { key: string; multiplier: number }> = {
  PROTEIN: { key: "proteinG", multiplier: 1 },
  CARBOHYDRATES: { key: "carbsG", multiplier: 1 },
  DIETARY_FIBER: { key: "fiberG", multiplier: 1 },
  SUGAR: { key: "sugarG", multiplier: 1 },
  SATURATED_FAT: { key: "saturatedFatG", multiplier: 1 },
  TRANS_FAT: { key: "transFatG", multiplier: 1 },
  MONOUNSATURATED_FAT: { key: "monounsaturatedFatG", multiplier: 1 },
  POLYUNSATURATED_FAT: { key: "polyunsaturatedFatG", multiplier: 1 },
  UNSATURATED_FAT: { key: "unsaturatedFatG", multiplier: 1 },
  CHOLESTEROL: { key: "cholesterolMg", multiplier: 1_000 },
  SODIUM: { key: "sodiumMg", multiplier: 1_000 },
  POTASSIUM: { key: "potassiumMg", multiplier: 1_000 },
  CALCIUM: { key: "calciumMg", multiplier: 1_000 },
  IRON: { key: "ironMg", multiplier: 1_000 },
  MAGNESIUM: { key: "magnesiumMg", multiplier: 1_000 },
  PHOSPHORUS: { key: "phosphorusMg", multiplier: 1_000 },
  ZINC: { key: "zincMg", multiplier: 1_000 },
  COPPER: { key: "copperMg", multiplier: 1_000 },
  MANGANESE: { key: "manganeseMg", multiplier: 1_000 },
  CHLORIDE: { key: "chlorideMg", multiplier: 1_000 },
  CAFFEINE: { key: "caffeineMg", multiplier: 1_000 },
  VITAMIN_C: { key: "vitaminCMg", multiplier: 1_000 },
  VITAMIN_E: { key: "vitaminEMg", multiplier: 1_000 },
  THIAMIN: { key: "thiaminMg", multiplier: 1_000 },
  RIBOFLAVIN: { key: "riboflavinMg", multiplier: 1_000 },
  NIACIN: { key: "niacinMg", multiplier: 1_000 },
  PANTOTHENIC_ACID: { key: "pantothenicAcidMg", multiplier: 1_000 },
  VITAMIN_B6: { key: "vitaminB6Mg", multiplier: 1_000 },
  SELENIUM: { key: "seleniumMcg", multiplier: 1_000_000 },
  IODINE: { key: "iodineMcg", multiplier: 1_000_000 },
  VITAMIN_A: { key: "vitaminAMcg", multiplier: 1_000_000 },
  VITAMIN_D: { key: "vitaminDMcg", multiplier: 1_000_000 },
  VITAMIN_K: { key: "vitaminKMcg", multiplier: 1_000_000 },
  VITAMIN_B12: { key: "vitaminB12Mcg", multiplier: 1_000_000 },
  FOLATE: { key: "folateMcg", multiplier: 1_000_000 },
  FOLIC_ACID: { key: "folicAcidMcg", multiplier: 1_000_000 },
  BIOTIN: { key: "biotinMcg", multiplier: 1_000_000 },
  CHROMIUM: { key: "chromiumMcg", multiplier: 1_000_000 },
  MOLYBDENUM: { key: "molybdenumMcg", multiplier: 1_000_000 },
};

const FIELD_TO_NUTRITION_KEY: Record<string, string> = {
  protein: "proteinG", fat: "fatG", carbs: "carbsG", fiber: "fiberG",
  sodium: "sodiumMg", sugar: "sugarG", saturated_fat: "saturatedFatG",
  cholesterol: "cholesterolMg", potassium: "potassiumMg", calcium: "calciumMg",
  iron: "ironMg", magnesium: "magnesiumMg", vitamin_c: "vitaminCMg",
  vitamin_d: "vitaminDMcg", vitamin_b12: "vitaminB12Mcg",
  trans_fat: "transFatG", monounsaturated_fat: "monounsaturatedFatG",
  polyunsaturated_fat: "polyunsaturatedFatG", phosphorus: "phosphorusMg",
  zinc: "zincMg", copper: "copperMg", manganese: "manganeseMg",
  selenium: "seleniumMcg", iodine: "iodineMcg", vitamin_a: "vitaminAMcg",
  vitamin_e: "vitaminEMg", vitamin_k: "vitaminKMcg", vitamin_b1: "thiaminMg",
  vitamin_b2: "riboflavinMg", vitamin_b3: "niacinMg",
  vitamin_b5: "pantothenicAcidMg", vitamin_b6: "vitaminB6Mg",
  vitamin_b9: "folateMcg", folic_acid: "folicAcidMcg", caffeine: "caffeineMg",
  biotin: "biotinMcg", chloride: "chlorideMg", chromium: "chromiumMcg",
  molybdenum: "molybdenumMcg",
};

type MappedImportRecord = {
  externalId: string;
  dataType: string;
  localDate: string;
  entry: JsonObject;
};

type ImportReplacement = {
  dataType: string;
  fromDate: string;
  throughDate: string;
};

type ImportOwnership = {
  entry_id: string;
  data_type: string;
  local_date: string;
};

// Canonical nutrition tracker ids deliberately mirror their Health mapping
// field. Provider-only fields without a tracker (for example Google's general
// unsaturated-fat total) remain on the parent Food payload instead of creating
// an unrecognised/ghost metric entry.
const NUTRITION_SIDECAR_FIELDS = Object.entries(FIELD_TO_NUTRITION_KEY).map(
  ([metricId, nutritionKey]) => ({ metricId, nutritionKey }),
);

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positive(value: unknown) {
  const parsed = number(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function zonedDateKey(now: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (value.year && value.month && value.day)
      return `${value.year}-${value.month}-${value.day}`;
  } catch {
    // A stale/invalid profile timezone safely falls back to UTC.
  }
  return dateKey(now);
}

function civilDateKey(value: unknown) {
  const civil = asObject(value);
  const date = asObject(civil.date);
  const year = number(date.year);
  const month = number(date.month);
  const day = number(date.day);
  if (!year || !month || !day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function googleHealthSourceOrigin(point: GoogleHealthDataPoint) {
  const dataSource = asObject(point.dataSource);
  const application = asObject(dataSource.application);
  const packageName = String(application.packageName ?? "").trim();
  if (packageName) return packageName;
  const platform = String(dataSource.platform ?? "").trim();
  return platform && platform !== "PLATFORM_UNSPECIFIED"
    ? `Google Health (${platform.toLowerCase().replace(/_/g, " ")})`
    : "Google Health API";
}

function dailyValueDates(
  definition: DataTypeDefinition,
  points: GoogleHealthDataPoint[],
) {
  const valueField = definition.internalType === "steps"
    ? "steps"
    : definition.internalType === "active_energy"
      ? "activeEnergyBurned"
      : definition.internalType === "heart_rate"
        ? "heartRate"
        : "";
  const dates = new Set<string>();
  if (!valueField) return dates;
  for (const point of points) {
    const localDate = civilDateKey(point.civilStartTime);
    // Google distinguishes a missing rollup union from an explicitly set
    // zero. Only the latter is an authoritative current-day observation.
    if (localDate && point[valueField] !== undefined && point[valueField] !== null)
      dates.add(localDate);
  }
  return dates;
}

function replacementRangesForFetch(
  definition: DataTypeDefinition,
  range: GoogleHealthDateRange,
  today: string,
  authoritativeDailyDates: ReadonlySet<string> = new Set(),
) {
  const full = {
    dataType: definition.internalType,
    fromDate: range.fromDate,
    throughDate: range.throughDate,
  };
  if (definition.mode !== "daily") return [full];

  const replacements: typeof full[] = [];
  const lastCompletedDate = addDays(today, -1);
  const completedThrough = range.throughDate < lastCompletedDate
    ? range.throughDate
    : lastCompletedDate;
  if (range.fromDate <= completedThrough) {
    replacements.push({
      ...full,
      throughDate: completedThrough,
    });
  }
  for (const localDate of [...authoritativeDailyDates].sort()) {
    if (
      localDate >= today &&
      localDate >= range.fromDate &&
      localDate <= range.throughDate
    ) {
      replacements.push({
        dataType: definition.internalType,
        fromDate: localDate,
        throughDate: localDate,
      });
    }
  }
  return replacements;
}

function timeInfo(payload: JsonObject, useEndDate = false) {
  const interval = asObject(payload.interval);
  const sample = asObject(payload.sampleTime);
  const startTime = String(interval.startTime ?? sample.physicalTime ?? "");
  const endTime = String(interval.endTime ?? sample.physicalTime ?? startTime);
  const localDate =
    civilDateKey(useEndDate ? interval.civilEndTime : interval.civilStartTime) ??
    civilDateKey(sample.civilTime) ??
    (useEndDate ? endTime : startTime).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Date.parse(startTime || endTime))
    return undefined;
  return {
    startTime: new Date(startTime || endTime).toISOString(),
    endTime: new Date(endTime || startTime).toISOString(),
    localDate,
  };
}

function durationMinutes(start: string, end: string) {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 60_000);
}

function durationStringMinutes(value: unknown) {
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(String(value ?? ""));
  return match ? Math.max(0, Number(match[1]) / 60) : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function externalId(
  definition: DataTypeDefinition,
  point: GoogleHealthDataPoint,
  startTime: string,
  endTime: string,
) {
  const named = String(point.dataPointName ?? point.name ?? "");
  if (named) return `${definition.googleType}:${named.split("/").pop()}`;
  return `${definition.googleType}:${await sha256Hex(
    `${startTime}\u0000${endTime}\u0000${canonicalJson(point)}`,
  )}`;
}

async function normalizeDaily(
  definition: DataTypeDefinition,
  points: GoogleHealthDataPoint[],
  now: Date,
  today: string,
) {
  const records: InternalRecord[] = [];
  for (const point of points) {
    const localDate = civilDateKey(point.civilStartTime);
    if (!localDate) continue;
    let value: number | undefined;
    let unit = "";
    if (definition.internalType === "steps") {
      value = positive(asObject(point.steps).countSum);
      unit = "steps";
    } else if (definition.internalType === "active_energy") {
      value = positive(asObject(point.activeEnergyBurned).kcalSum);
      unit = "kcal";
    } else if (definition.internalType === "heart_rate") {
      value = positive(asObject(point.heartRate).beatsPerMinuteAvg);
      unit = "bpm";
    }
    if (value === undefined) continue;
    const startTime = `${localDate}T00:00:00.000Z`;
    const nextDay = addDays(localDate, 1);
    const endTime = localDate === today
      ? now.toISOString()
      : `${nextDay}T00:00:00.000Z`;
    records.push({
      externalId: `${definition.googleType}:daily:${localDate}`,
      dataType: definition.internalType,
      startTime,
      endTime,
      localDate,
      value,
      unit,
      label: definition.internalType === "steps" ? "Steps" : undefined,
    });
  }
  return records;
}

function nutritionFrom(payload: JsonObject) {
  const output: Record<string, string | number> = {};
  const mealType = String(payload.mealType ?? "");
  if (mealType === "BREAKFAST") output.mealType = "breakfast";
  else if (mealType === "LUNCH") output.mealType = "lunch";
  else if (mealType === "DINNER") output.mealType = "dinner";
  else if (mealType && mealType !== "MEAL_TYPE_UNSPECIFIED" && mealType !== "ANYTIME")
    output.mealType = "snack";
  for (const raw of Array.isArray(payload.nutrients) ? payload.nutrients : []) {
    const nutrient = asObject(raw);
    const mapping = NUTRIENT_FIELDS[String(nutrient.nutrient ?? "")];
    const grams = positive(asObject(nutrient.quantity).grams);
    if (mapping && grams !== undefined) output[mapping.key] = grams * mapping.multiplier;
  }
  const carbs = positive(asObject(payload.totalCarbohydrate).grams);
  const fat = positive(asObject(payload.totalFat).grams);
  if (carbs !== undefined) output.carbsG = carbs;
  if (fat !== undefined) output.fatG = fat;
  return output;
}

async function normalizeReconciled(
  definition: DataTypeDefinition,
  points: GoogleHealthDataPoint[],
) {
  const records: InternalRecord[] = [];
  for (const point of points) {
    const sourceOrigin = googleHealthSourceOrigin(point);
    let payload: JsonObject;
    if (definition.internalType === "weight") payload = asObject(point.weight);
    else if (definition.internalType === "body_fat") payload = asObject(point.bodyFat);
    else if (definition.internalType === "blood_glucose") payload = asObject(point.bloodGlucose);
    else if (definition.internalType === "sleep") payload = asObject(point.sleep);
    else if (definition.internalType === "workouts") payload = asObject(point.exercise);
    else if (definition.internalType === "water") payload = asObject(point.hydrationLog);
    else if (definition.internalType === "nutrition") payload = asObject(point.nutritionLog);
    else continue;
    const time = timeInfo(payload, definition.internalType === "sleep");
    if (!time) continue;
    const id = await externalId(definition, point, time.startTime, time.endTime);
    if (definition.internalType === "weight") {
      const value = positive(payload.weightGrams);
      if (value) records.push({ externalId: id, dataType: "weight", ...time, value: value / 1_000, unit: "kg", sourceOrigin, note: String(payload.notes ?? "") || undefined });
    } else if (definition.internalType === "body_fat") {
      const value = positive(payload.percentage);
      if (value) records.push({ externalId: id, dataType: "body_fat", ...time, value, unit: "%", sourceOrigin });
    } else if (definition.internalType === "blood_glucose") {
      const value = positive(payload.bloodGlucoseMilligramsPerDeciliter);
      if (value) records.push({ externalId: id, dataType: "blood_glucose", ...time, value, unit: "mg/dL", sourceOrigin, note: String(payload.notes ?? "") || undefined });
    } else if (definition.internalType === "sleep") {
      const summary = asObject(payload.summary);
      const minutes = positive(summary.minutesAsleep) ?? durationMinutes(time.startTime, time.endTime);
      if (minutes > 0) records.push({ externalId: id, dataType: "sleep", ...time, value: minutes / 60, unit: "hr", sourceOrigin, measurements: { durationMinutes: minutes }, label: "Sleep" });
    } else if (definition.internalType === "workouts") {
      const summary = asObject(payload.metricsSummary);
      const minutes = durationStringMinutes(payload.activeDuration) ?? durationMinutes(time.startTime, time.endTime);
      if (!(minutes > 0)) continue;
      const activeCalories = positive(summary.caloriesKcal);
      const distanceMm = positive(summary.distanceMillimeters);
      const workoutSteps = positive(summary.steps);
      const exerciseType = String(payload.exerciseType ?? "OTHER");
      records.push({
        externalId: id,
        dataType: "workouts",
        ...time,
        value: minutes,
        unit: "min",
        sourceOrigin,
        label: String(payload.displayName ?? exerciseType.replace(/_/g, " ")),
        activityKey: exerciseType.toLowerCase().replace(/_/g, "-"),
        note: String(payload.notes ?? "") || undefined,
        measurements: {
          durationMinutes: minutes,
          ...(activeCalories ? { activeCalories } : {}),
          ...(distanceMm ? { distanceKm: distanceMm / 1_000_000 } : {}),
          ...(workoutSteps ? { steps: workoutSteps } : {}),
        },
      });
    } else if (definition.internalType === "water") {
      const milliliters = positive(asObject(payload.amountConsumed).milliliters);
      if (milliliters) records.push({ externalId: id, dataType: "water", ...time, value: milliliters / 250, unit: "cups", sourceOrigin, label: "Water" });
    } else if (definition.internalType === "nutrition") {
      const calories = positive(asObject(payload.energy).kcal) ?? 0;
      const nutrition = nutritionFrom(payload);
      if (calories > 0 || Object.keys(nutrition).some((key) => key !== "mealType"))
        records.push({
          externalId: id,
          dataType: "nutrition",
          ...time,
          value: calories,
          unit: "kcal",
          sourceOrigin,
          label: String(payload.foodDisplayName ?? "Food"),
          nutrition,
        });
    }
  }
  return records;
}

function mappedValue(record: InternalRecord, mapping: Mapping, unit: string, metricDataType?: string) {
  if (mapping.field === "value")
    return metricDataType === "boolean" ? Number(record.value) > 0 : Number(record.value);
  if (mapping.field === "duration_minutes") {
    const minutes = record.measurements?.durationMinutes;
    return minutes === undefined ? undefined : unit.toLowerCase().startsWith("hr") ? minutes / 60 : minutes;
  }
  if (mapping.field === "active_calories") return record.measurements?.activeCalories;
  if (mapping.field === "distance_km") return record.measurements?.distanceKm;
  const nutritionKey = FIELD_TO_NUTRITION_KEY[String(mapping.field ?? "")];
  const nutritionValue = nutritionKey ? record.nutrition?.[nutritionKey] : undefined;
  return typeof nutritionValue === "number" ? nutritionValue : undefined;
}

function mappingMatches(mapping: Mapping | undefined, record: InternalRecord) {
  if (!mapping || mapping.dataType !== record.dataType) return false;
  return !mapping.activityKeys?.length || Boolean(record.activityKey && mapping.activityKeys.includes(record.activityKey));
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9:._-]+/g, "-").slice(0, 360);
}

function validVisibility(value: unknown) {
  const visibility = String(value ?? "");
  return ["private", "status", "group"].includes(visibility)
    ? visibility
    : undefined;
}

function baseEntry(record: InternalRecord, userId: string, metric: Metric, value: number | boolean, syncedAt: string) {
  const metricId = String(metric.id);
  const visibility = validVisibility(metric.defaultVisibility) ?? "private";
  const sourceRecordId = record.dataType === "steps"
    ? `aggregate:steps:${record.localDate}`
    : `google-health:${record.externalId}`;
  const mayCarryMealDetails = record.dataType !== "nutrition" || metricId === "food";
  const label = record.label ?? (
    record.dataType === "active_energy" &&
      /(?:^|:)daily(?::|$)/i.test(record.externalId)
      ? "Active energy total"
      : undefined
  );
  return {
    id: safeId(`google-health:${record.externalId}:${metricId}`),
    metricId,
    userId,
    value,
    localDate: record.localDate,
    recordedAt: record.endTime,
    sourceRecordedAt: record.endTime,
    // The configured tracker default is an explicit user choice. A later
    // per-entry override is preserved by reconciliation below.
    visibility,
    source: "imported",
    ...(mayCarryMealDetails && label ? { label } : {}),
    ...(mayCarryMealDetails
      ? { note: [record.note, "Synced from Google Health"].filter(Boolean).join(" · ") }
      : {}),
    ...(mayCarryMealDetails && record.nutrition ? { nutrition: record.nutrition } : {}),
    sourceProvider: "google_health",
    sourceRecordId,
    sourceOrigin: record.sourceOrigin ?? "Google Health API",
    sourceUpdatedAt: syncedAt,
    ...(record.dataType === "workouts" &&
      positive(record.measurements?.steps) !== undefined
      ? { sourceWorkoutSteps: positive(record.measurements?.steps) }
      : {}),
  };
}

function nearlyEqual(left: unknown, right: unknown) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return left === right;
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.001);
}

function semanticallyMatchesNative(incoming: JsonObject, existing: JsonObject) {
  if (
    existing.source !== "imported" ||
    !["apple_health", "health_connect"].includes(String(existing.sourceProvider)) ||
    existing.userId !== incoming.userId ||
    existing.metricId !== incoming.metricId ||
    existing.localDate !== incoming.localDate ||
    !nearlyEqual(existing.value, incoming.value)
  ) return false;
  const incomingTime = Date.parse(String(incoming.recordedAt ?? ""));
  const existingTime = Date.parse(String(existing.recordedAt ?? ""));
  if (!Number.isFinite(incomingTime) || !Number.isFinite(existingTime)) return false;
  const metricId = String(incoming.metricId ?? "");
  const tolerance = metricId === "steps" ? 24 * 60 * 60_000 : 5 * 60_000;
  if (Math.abs(incomingTime - existingTime) > tolerance) return false;
  const workout = String(incoming.sourceRecordId ?? "").includes(":exercise:") ||
    metricId === "exercise" || metricId.startsWith("workout");
  if (metricId === "food" || workout) {
    const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();
    if (normalize(incoming.label) !== normalize(existing.label)) return false;
  }
  return true;
}

function stableEntry(entry: JsonObject) {
  const { sourceUpdatedAt: _sourceUpdatedAt, ...stable } = entry;
  return canonicalJson(stable);
}

function stableStepFallbackEntry(entry: JsonObject) {
  const {
    sourceUpdatedAt: _sourceUpdatedAt,
    recordedAt: _recordedAt,
    sourceRecordedAt: _sourceRecordedAt,
    ...stable
  } = entry;
  return canonicalJson(stable);
}

function preserveUserIntentAndDeduplicate(
  mapped: Array<{ externalId: string; dataType: string; localDate: string; entry: JsonObject }>,
  snapshot: Snapshot,
) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const existingById = new Map(entries.map((entry) => [String(entry.id ?? ""), entry]));
  const settings = asObject(snapshot.settings);
  const savedOverrides = asObject(settings.googleHealthEntryOverrides);
  const dismissed = new Set([
    ...(Array.isArray(settings.dismissedHealthEntryIds) ? settings.dismissedHealthEntryIds : []),
    ...(Array.isArray(settings.deletedEntryIds) ? settings.deletedEntryIds : []),
    ...(Array.isArray(settings.pendingDeletedEntryIds) ? settings.pendingDeletedEntryIds : []),
  ].map(String));
  return mapped.flatMap((record) => {
    const generated = record.entry;
    const id = String(generated.id ?? "");
    if (!id || dismissed.has(id)) return [];
    const previous = existingById.get(id);
    const savedOverride = asObject(savedOverrides[id]);
    if (savedOverride.dismissed === true) return [];
    // Do not create a new Google mirror when a native copy arrived first. Once
    // a Google row is already server-owned, however, retain it behind the
    // client's native-first presentation. Deleting that ownership here made a
    // later native-cache gap erase the last Google fallback and show zero.
    if (
      !previous &&
      entries.some((candidate) => semanticallyMatchesNative(generated, candidate))
    )
      return [];
    let entry = generated;
    if (previous || Object.keys(savedOverride).length) {
      const savedVisibility = ["private", "status", "group"].includes(String(savedOverride.visibility))
        ? savedOverride.visibility
        : undefined;
      const recordedAtOverride = typeof savedOverride.recordedAtOverride === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(savedOverride.recordedAtOverride) &&
          Number.isFinite(Date.parse(savedOverride.recordedAtOverride))
        ? savedOverride.recordedAtOverride
        : undefined;
      const overrideLocalDate = typeof savedOverride.localDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(savedOverride.localDate) &&
          dateKey(new Date(`${savedOverride.localDate}T12:00:00Z`)) === savedOverride.localDate
        ? savedOverride.localDate
        : undefined;
      entry = {
        ...generated,
        ...(savedVisibility ? { visibility: savedVisibility } : {}),
        ...(recordedAtOverride
          ? {
              recordedAtOverride,
              recordedAt: recordedAtOverride,
              localDate: overrideLocalDate ?? generated.localDate,
            }
          : {}),
      };
      if (previous && stableEntry(previous) === stableEntry(entry)) entry = previous;
    }
    // Ownership remains anchored to the immutable source date. A user may
    // move the embedded food entry to another display day without preventing
    // a later provider deletion from finding the original ownership row.
    return [{ ...record, entry }];
  });
}

function snapshotWithEntryPreferences(snapshot: Snapshot, preferences: EntryPreference[]) {
  const settings = asObject(snapshot.settings);
  const existing = asObject(settings.googleHealthEntryOverrides);
  const overrides: JsonObject = { ...existing };
  for (const preference of preferences) {
    const id = typeof preference.entry_id === "string" ? preference.entry_id : "";
    if (!id) continue;
    const value: JsonObject = {};
    if (["private", "status", "group"].includes(String(preference.visibility)))
      value.visibility = preference.visibility;
    if (
      typeof preference.recorded_at_override === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(preference.recorded_at_override) &&
      Number.isFinite(Date.parse(preference.recorded_at_override)) &&
      typeof preference.display_local_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(preference.display_local_date) &&
      dateKey(new Date(`${preference.display_local_date}T12:00:00Z`)) === preference.display_local_date
    ) {
      value.recordedAtOverride = preference.recorded_at_override;
      value.localDate = preference.display_local_date;
    }
    if (preference.dismissed === true) value.dismissed = true;
    overrides[id] = value;
  }
  return {
    ...snapshot,
    settings: { ...settings, googleHealthEntryOverrides: overrides },
  } as Snapshot;
}

function mapRecordsToEntries(records: InternalRecord[], snapshot: Snapshot, userId: string, syncedAt: string) {
  const metrics = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const metricsById = new Map(
    metrics.flatMap((metric) => metric.id ? [[String(metric.id), metric] as const] : []),
  );
  const foodVisibility = validVisibility(metricsById.get("food")?.defaultVisibility);
  const mapped: Array<{ externalId: string; dataType: string; localDate: string; entry: JsonObject }> = [];
  for (const record of records) {
    const emittedEntryIds = new Set<string>();
    for (const metric of metrics) {
      if (!metric.id) continue;
      let entry: JsonObject | undefined;
      if (mappingMatches(metric.healthMapping, record)) {
        const value = mappedValue(record, metric.healthMapping!, String(metric.unit ?? ""), metric.dataType);
        if ((typeof value === "number" && Number.isFinite(value) && value > 0) || value === true) {
          entry = baseEntry(record, userId, metric, value, syncedAt);
        }
      }
      const values: Record<string, number> = {};
      for (const field of metric.submetrics ?? []) {
        if (!field.id || !mappingMatches(field.healthMapping, record)) continue;
        const value = mappedValue(record, field.healthMapping!, String(field.unit ?? ""));
        if (typeof value === "number" && Number.isFinite(value) && value > 0) values[field.id] = value;
      }
      if (Object.keys(values).length) {
        const primary = (metric.submetrics ?? []).find((field) =>
          field.id && field.showProgressBar && values[field.id] !== undefined)
          ?? (metric.submetrics ?? []).find((field) =>
            field.id && !field.linkedMetricId && values[field.id] !== undefined);
        if (primary?.id) {
          entry = {
            ...(entry ?? baseEntry(record, userId, metric, values[primary.id], syncedAt)),
            submetricValues: {
              ...asObject(entry?.submetricValues),
              ...values,
            },
          };
        }
      }
      if (
        entry &&
        record.dataType === "workouts" &&
        String(metric.id) === "workout"
      ) {
        const activeCalories = positive(record.measurements?.activeCalories);
        // Keep this non-additive provider detail in the private account
        // snapshot. The relational projector publishes it only into a
        // destination group's explicitly shared Active energy tracker; a
        // database trigger strips linked fields from the shared Workout row.
        if (activeCalories !== undefined) {
          entry = {
            ...entry,
            submetricValues: {
              ...asObject(entry.submetricValues),
              exercise: activeCalories,
            },
          };
        }
      }
      if (entry) {
        const entryId = String(entry.id ?? "");
        if (!entryId || emittedEntryIds.has(entryId)) continue;
        emittedEntryIds.add(entryId);
        mapped.push({ externalId: record.externalId, dataType: record.dataType, localDate: record.localDate, entry });
      }
    }
    if (record.dataType !== "nutrition") continue;
    for (const { metricId, nutritionKey } of NUTRITION_SIDECAR_FIELDS) {
      const value = positive(record.nutrition?.[nutritionKey]);
      if (value === undefined) continue;
      const entryId = safeId(`google-health:${record.externalId}:${metricId}`);
      // A configured nutrient tracker was already materialised by the normal
      // mapping path. The fallback is only for absent/incomplete definitions.
      if (emittedEntryIds.has(entryId)) continue;
      const nutrientMetric = metricsById.get(metricId);
      const visibility = validVisibility(nutrientMetric?.defaultVisibility)
        ?? foodVisibility
        ?? "private";
      const entry = baseEntry(
        record,
        userId,
        { ...nutrientMetric, id: metricId, defaultVisibility: visibility },
        value,
        syncedAt,
      );
      emittedEntryIds.add(entryId);
      mapped.push({
        externalId: record.externalId,
        dataType: record.dataType,
        // Reconciliation ownership stays on the immutable provider date even
        // when a user later moves an entry to another display date.
        localDate: record.localDate,
        entry,
      });
    }
  }
  return mapped;
}

const DERIVED_STEP_FALLBACK_DATA_TYPE = "derived_step_fallback";
// A daily step total has no session pace. Keep its reverse conversion on one
// ordinary-walk assumption, independent of every workout recorded that day.
const UNRECORDED_WALKING_SPEED_MPS = 1.4;
const ASSUMED_RUNNING_SPEED_KMH = 9;
const LEGACY_STEP_LENGTH_M = 0.762;
const LEGACY_RUNNING_STEP_LENGTH_M = 1;
const LEGACY_WALKING_KCAL_PER_KG_KM = 0.53;

// Opt-in estimates from Big Team Challenge's public conversion chart. They
// explain an existing Step total; they never manufacture provider Step data.
// https://www.bigteamchallenge.com/resources/activity-conversion-chart
const STEP_EQUIVALENTS: Readonly<
  Record<string, { stepsPerMinute: number; met: number }>
> = {
  basketball: { stepsPerMinute: 130, met: 6.5 },
  table_tennis: { stepsPerMinute: 120, met: 4 },
  golf: { stepsPerMinute: 110, met: 4.8 },
  yoga: { stepsPerMinute: 45, met: 2.5 },
  soccer: { stepsPerMinute: 145, met: 7 },
  american_football: { stepsPerMinute: 170, met: 6 },
  tennis: { stepsPerMinute: 170, met: 7 },
  badminton: { stepsPerMinute: 131, met: 5.5 },
  volleyball: { stepsPerMinute: 130, met: 4 },
  baseball: { stepsPerMinute: 130, met: 5 },
  cricket: { stepsPerMinute: 80, met: 5 },
  rugby: { stepsPerMinute: 190, met: 7 },
  hockey: { stepsPerMinute: 200, met: 7 },
  ice_hockey: { stepsPerMinute: 200, met: 8 },
  squash: { stepsPerMinute: 190, met: 8 },
  racquetball: { stepsPerMinute: 130, met: 7 },
  pilates: { stepsPerMinute: 91, met: 3 },
  tai_chi: { stepsPerMinute: 40, met: 3 },
  dance: { stepsPerMinute: 109, met: 5 },
  social_dance: { stepsPerMinute: 109, met: 4.5 },
  aerobics: { stepsPerMinute: 125, met: 6.5 },
  cycling: { stepsPerMinute: 170, met: 6.8 },
  stationary_cycling: { stepsPerMinute: 170, met: 6 },
  swimming: { stepsPerMinute: 180, met: 6 },
  pool_swimming: { stepsPerMinute: 180, met: 6 },
  open_water_swimming: { stepsPerMinute: 180, met: 7 },
  rowing: { stepsPerMinute: 210, met: 7 },
  rowing_machine: { stepsPerMinute: 210, met: 7 },
  boxing: { stepsPerMinute: 110, met: 8 },
  kickboxing: { stepsPerMinute: 210, met: 8 },
  strength_training: { stepsPerMinute: 100, met: 5 },
  functional_strength_training: { stepsPerMinute: 100, met: 5 },
  weightlifting: { stepsPerMinute: 100, met: 6 },
  weight_machine: { stepsPerMinute: 100, met: 5 },
  elliptical: { stepsPerMinute: 170, met: 5 },
  stair_climbing: { stepsPerMinute: 180, met: 6 },
  stair_machine: { stepsPerMinute: 180, met: 6 },
  jump_rope: { stepsPerMinute: 160, met: 8 },
  gardening: { stepsPerMinute: 60, met: 3.5 },
};

/**
 * Session-level workout MET values mirrored from the app's 2024 Adult
 * Compendium-backed activity catalog. Individual strength movements are
 * intentionally absent. Published conversion-table rates above win; remaining
 * activities use a low-confidence manual product estimate anchored at
 * 3 MET=100 and 6 MET=130. These are not measured footfalls, and every
 * non-direct conversion remains manual opt-in.
 * https://pacompendium.com/adult-compendium/
 */
const SESSION_ACTIVITY_METS: Readonly<Record<string, number>> = {
  walking: 3.5,
  running: 7,
  track_running: 7,
  treadmill_running: 7,
  cycling: 6.8,
  stationary_cycling: 6,
  mountain_biking: 8.5,
  hand_cycling: 6,
  elliptical: 5,
  stair_climbing: 6,
  stair_machine: 6,
  rowing_machine: 7,
  wheelchair_walk: 3.5,
  wheelchair_run: 6,
  strength_training: 5,
  functional_strength_training: 5,
  weightlifting: 6,
  weight_machine: 5,
  aerobics: 6.5,
  boot_camp: 7,
  calisthenics: 5,
  circuit_training: 6,
  cross_training: 6,
  mixed_cardio: 6,
  hiit: 8,
  exercise_class: 5,
  fitness_gaming: 4,
  gymnastics: 4,
  jump_rope: 8,
  hula_hooping: 5,
  jumping_jacks: 8,
  skaters: 7,
  high_knees: 8,
  stretching: 2.5,
  warm_up: 3,
  cool_down: 2.5,
  recovery: 2.5,
  yoga: 2.5,
  pilates: 3,
  tai_chi: 3,
  barre: 3.5,
  core_training: 4,
  guided_breathing: 2,
  dance: 5,
  ballet: 5,
  ballroom_dance: 5,
  cardio_dance: 6,
  social_dance: 4.5,
  zumba: 6.5,
  baseball: 5,
  softball: 5,
  cricket: 5,
  basketball: 6.5,
  soccer: 7,
  american_football: 6,
  australian_football: 7,
  rugby: 7,
  handball: 7,
  volleyball: 4,
  beach_volleyball: 6,
  hockey: 7,
  ice_hockey: 8,
  roller_hockey: 7,
  lacrosse: 7,
  disc_sports: 5,
  badminton: 5.5,
  tennis: 7,
  table_tennis: 4,
  squash: 8,
  racquetball: 7,
  pickleball: 5,
  boxing: 8,
  kickboxing: 8,
  martial_arts: 7,
  wrestling: 7,
  fencing: 6,
  hiking: 6,
  backpacking: 7,
  orienteering: 8,
  rock_climbing: 7,
  paragliding: 3,
  hang_gliding: 3,
  horseback_riding: 4,
  fishing: 3,
  hunting: 5,
  golf: 4.8,
  archery: 3.5,
  bowling: 3,
  inline_skating: 7,
  roller_skating: 7,
  play: 4,
  swimming: 6,
  pool_swimming: 6,
  open_water_swimming: 7,
  water_fitness: 5,
  water_polo: 8,
  paddling: 5,
  canoeing: 5,
  kayaking: 5,
  rafting: 5,
  rowing: 7,
  sailing: 3,
  yachting: 3,
  surfing: 5,
  windsurfing: 5,
  kitesurfing: 7,
  water_skiing: 6,
  scuba_diving: 7,
  snorkeling: 5,
  skiing: 7,
  cross_country_skiing: 8,
  downhill_skiing: 6,
  snowboarding: 6,
  snowshoeing: 7,
  ice_skating: 7,
  ice_dancing: 6,
  curling: 4,
  triathlon: 8,
  duathlon: 8,
  aquathlon: 8,
  aquabike: 8,
  cross_triathlon: 8,
  cross_duathlon: 8,
  multisport_transition: 2,
  workout_break: 1.5,
  other_workout: 3.5,
};

function metCadenceStepEstimate(met: number) {
  return Math.round(Math.min(160, Math.max(80, 70 + 10 * met)));
}

const NON_STEP_COVERAGE_SESSION_KEYS = new Set([
  "multisport_transition",
  "other_workout",
  "workout_break",
]);

const STEP_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  basketball: "basketball",
  "table tennis": "table_tennis",
  "ping pong": "table_tennis",
  pingpong: "table_tennis",
  golf: "golf",
  yoga: "yoga",
  soccer: "soccer",
  football: "soccer",
  "american football": "american_football",
  tennis: "tennis",
  badminton: "badminton",
  volleyball: "volleyball",
  baseball: "baseball",
  cricket: "cricket",
  rugby: "rugby",
  hockey: "hockey",
  "ice hockey": "ice_hockey",
  squash: "squash",
  racquetball: "racquetball",
  pilates: "pilates",
  "tai chi": "tai_chi",
  dance: "dance",
  dancing: "dance",
  "social dance": "social_dance",
  aerobics: "aerobics",
  cycling: "cycling",
  biking: "cycling",
  bicycle: "cycling",
  "stationary cycling": "stationary_cycling",
  "stationary biking": "stationary_cycling",
  "stationary bike": "stationary_cycling",
  "exercise bike": "stationary_cycling",
  "indoor cycling": "stationary_cycling",
  swimming: "swimming",
  "pool swimming": "pool_swimming",
  "lap swimming": "pool_swimming",
  "open water swimming": "open_water_swimming",
  rowing: "rowing",
  "rowing machine": "rowing_machine",
  boxing: "boxing",
  kickboxing: "kickboxing",
  "strength training": "strength_training",
  "traditional strength training": "strength_training",
  "functional strength training": "functional_strength_training",
  weights: "weightlifting",
  weightlifting: "weightlifting",
  "weight lifting": "weightlifting",
  "weight machine": "weight_machine",
  elliptical: "elliptical",
  "cross trainer": "elliptical",
  "stair climbing": "stair_climbing",
  "stair climbing machine": "stair_machine",
  "stair machine": "stair_machine",
  "step machine": "stair_machine",
  "jump rope": "jump_rope",
  "skipping rope": "jump_rope",
  "high intensity interval training": "hiit",
  "preparation and recovery": "recovery",
  "wheelchair walk pace": "wheelchair_walk",
  "wheelchair run pace": "wheelchair_run",
  gardening: "gardening",
};

const DIRECT_STEP_ACTIVITY_KEYS = new Set([
  "walking",
  "running",
  "track_running",
  "treadmill_running",
  "hiking",
  "backpacking",
]);

function normalizedActivityLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stepCoverageActivityFromKey(value: unknown) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (NON_STEP_COVERAGE_SESSION_KEYS.has(key)) return undefined;
  if (DIRECT_STEP_ACTIVITY_KEYS.has(key))
    return { key, mode: "direct" as const };
  const met = SESSION_ACTIVITY_METS[key];
  const equivalent = STEP_EQUIVALENTS[key] ??
    (met > 0
      ? { stepsPerMinute: metCadenceStepEstimate(met), met }
      : undefined);
  return equivalent
    ? { key, mode: "equivalent" as const, ...equivalent }
    : undefined;
}

function stepCoverageActivity(value: unknown) {
  const label = normalizedActivityLabel(value);
  if (!label) return undefined;
  // Preserve exact catalog identities (notably track_running) before applying
  // broader family aliases such as any label containing "running".
  const canonical = stepCoverageActivityFromKey(
    STEP_ACTIVITY_LABELS[label] ?? label.replace(/\s+/g, "_"),
  );
  if (canonical) return canonical;
  if (/\btreadmill\b/.test(label))
    return { key: "treadmill_running", mode: "direct" as const };
  if (/\b(?:run|running|jog|jogging)\b/.test(label))
    return { key: "running", mode: "direct" as const };
  if (/\b(?:hike|hiking)\b/.test(label))
    return { key: "hiking", mode: "direct" as const };
  if (/\bbackpacking\b/.test(label))
    return { key: "backpacking", mode: "direct" as const };
  if (/\b(?:walk|walking)\b/.test(label))
    return { key: "walking", mode: "direct" as const };
  return undefined;
}

function stepCoverageSessionIdentity(entry: JsonObject) {
  const id = String(entry.id ?? "").replace(
    /^energy-breakdown:activity:/,
    "",
  );
  if (
    String(entry.sourceRecordId ?? "").startsWith("step-fallback:") ||
    id.includes(":step-fallback:")
  ) return undefined;
  const gym = id.match(
    /^gym-sync:(.+):(?:workout|workout_duration|workout_distance|exercise)$/,
  );
  if (gym?.[1]) return `gym:${encodeURIComponent(gym[1])}`;
  let sourceRecordId = String(entry.sourceRecordId ?? "");
  if (
    sourceRecordId.startsWith("samsung-total-workout:") &&
    sourceRecordId.endsWith(":workout-energy")
  ) {
    const body = sourceRecordId.slice(
      "samsung-total-workout:".length,
      -":workout-energy".length,
    );
    const separator = body.indexOf(":");
    if (separator > 0 && separator < body.length - 1)
      sourceRecordId = body.slice(separator + 1);
  }
  return sourceRecordId
    ? `source:${encodeURIComponent(
      String(entry.sourceProvider ?? "health"),
    )}:${encodeURIComponent(sourceRecordId)}`
    : String(entry.source ?? "") === "manual" &&
        String(entry.metricId ?? "") === "workout"
      ? `manual:${encodeURIComponent(String(entry.userId ?? ""))}:${encodeURIComponent(id)}`
      : undefined;
}

function eligibleStandaloneActiveEnergyForStepCoverage(entry: JsonObject) {
  const label = normalizedActivityLabel(entry.label);
  const sourceOrigin = normalizedActivityLabel(entry.sourceOrigin);
  const sourceRecordId = String(entry.sourceRecordId ?? entry.id ?? "");
  const genericActiveEnergy = /^(active (calories|energy)( total)?|calories burned)$/.test(
    label,
  );
  if (
    label === "estimated unrecorded walking from steps" ||
    /(?:resting energy|basal metabolic|\bbmr\b)/.test(label) ||
    (sourceOrigin.includes("fitbit") && genericActiveEnergy) ||
    (genericActiveEnergy &&
      (label.endsWith("total") ||
        (String(entry.sourceProvider ?? "") === "google_health" &&
          /(?:^|:)daily(?::|$)/i.test(sourceRecordId))))
  ) return false;
  return true;
}

function inferredGymStepActivities(snapshot: Snapshot) {
  const byIdentity = new Map<string, NonNullable<ReturnType<typeof stepCoverageActivity>>>();
  const sessions = Array.isArray(snapshot.gymSessions)
    ? snapshot.gymSessions
    : [];
  for (const value of sessions) {
    const session = asObject(value);
    const id = String(session.id ?? "");
    if (!id) continue;
    const named = stepCoverageActivity(session.name);
    if (named) {
      byIdentity.set(`gym:${encodeURIComponent(id)}`, named);
      continue;
    }
    const candidates = new Map<string, NonNullable<ReturnType<typeof stepCoverageActivity>>>();
    const exercises = Array.isArray(session.exercises) ? session.exercises : [];
    for (const exerciseValue of exercises) {
      const exercise = asObject(exerciseValue);
      const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
      const completedSets = sets
        .map(asObject)
        .filter((set) => set.completed === true);
      if (exercise.completed !== true && !completedSets.length) continue;
      const activity =
        stepCoverageActivityFromKey(exercise.exerciseKey) ??
        stepCoverageActivity(exercise.name);
      if (activity) candidates.set(activity.key, activity);
      for (const set of completedSets) {
        const superset = asObject(set.superset);
        const supersetActivity =
          stepCoverageActivityFromKey(superset.exerciseKey) ??
          stepCoverageActivity(superset.name);
        if (supersetActivity)
          candidates.set(supersetActivity.key, supersetActivity);
      }
    }
    if (candidates.size === 1)
      byIdentity.set(
        `gym:${encodeURIComponent(id)}`,
        [...candidates.values()][0],
      );
  }
  return byIdentity;
}

function resolvedStepCoverageActivity(
  entry: JsonObject,
  snapshot: Snapshot,
  inferredGymActivities: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof stepCoverageActivity>>
  >,
) {
  const identity = stepCoverageSessionIdentity(entry);
  const preferences = asObject(
    asObject(snapshot.settings).stepCoveragePreferences,
  );
  const session = identity
    ? asObject(asObject(preferences.sessions)[identity])
    : {};
  return (
    stepCoverageActivityFromKey(session.activityKey) ??
    stepCoverageActivityFromKey(entry.stepCoverageActivityKey) ??
    (identity ? inferredGymActivities.get(identity) : undefined) ??
    stepCoverageActivity(entry.label)
  );
}

function stepCoverageIncluded(
  entry: JsonObject,
  activity: NonNullable<ReturnType<typeof stepCoverageActivity>>,
  snapshot: Snapshot,
  inferredGymActivities: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof stepCoverageActivity>>
  >,
) {
  const identity = stepCoverageSessionIdentity(entry);
  if (!identity) return false;
  const preferences = asObject(
    asObject(snapshot.settings).stepCoveragePreferences,
  );
  const session = asObject(asObject(preferences.sessions)[identity]);
  const sessionChoice = String(session.choice ?? "");
  if (sessionChoice === "include" || sessionChoice === "exclude")
    return sessionChoice === "include";
  const activityRule = asObject(
    asObject(preferences.activityRules)[activity.key],
  );
  const ruleChoice = String(activityRule.choice ?? "");
  const effectiveFrom = String(activityRule.effectiveFrom ?? "");
  if (
    (ruleChoice === "include" || ruleChoice === "exclude") &&
    /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) &&
    String(entry.localDate ?? "") >= effectiveFrom
  ) return ruleChoice === "include";
  return activity.mode === "direct";
}

function equivalentSteps(
  activity: NonNullable<ReturnType<typeof stepCoverageActivity>>,
  input: { durationMinutes: number; activeCalories: number },
  snapshot: Snapshot,
) {
  if (activity.mode !== "equivalent") return 0;
  let durationMinutes = Math.max(0, input.durationMinutes);
  if (!(durationMinutes > 0) && input.activeCalories > 0) {
    // Active calories exclude resting expenditure. Use net intensity only for
    // this calorie-to-duration fallback; measured duration remains authoritative.
    const kcalPerMinute =
      ((activity.met - 1) * 3.5 * stepActivityProfile(snapshot).weightKg) /
      200;
    if (activity.met > 1 && kcalPerMinute > 0)
      durationMinutes = input.activeCalories / kcalPerMinute;
  }
  return durationMinutes > 0
    ? activity.stepsPerMinute * durationMinutes
    : 0;
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stepActivityProfile(snapshot: Snapshot) {
  const profile = asObject(asObject(snapshot.settings).energyProfile);
  return {
    age: bounded(number(profile.age) ?? 35, 18, 90),
    sex: String(profile.sex ?? "unspecified"),
    heightCm: number(profile.heightCm) ?? 0,
    weightKg: bounded(number(profile.weightKg) ?? 70, 35, 300),
  };
}

/**
 * Profile-aware step length for one recorded walking, hiking, or running
 * workout. Both clients use these exact equations and units:
 *
 * walking/hiking (Lee et al.):
 *   length_m = (-16.14 - 0.06*age_y + 0.31*height_cm
 *     - 0.04*weight_kg + 0.02*sex_female + 0.30*speed_cm_s) / 100
 * running (Malisoux et al.):
 *   length_m = -0.255 - 0.001*age_y + 0.279*height_m
 *     + 0.083*speed_kmh
 *
 * When distance and duration are both measured, their exact pace is used.
 * Otherwise the activity-family fallback affects this workout only.
 * https://doi.org/10.1080/1091367X.2026.2634091
 * https://doi.org/10.1177/23259671231204629
 */
function movementStepLengthForCoverage(
  input: {
    distanceKm?: number;
    durationMinutes?: number;
    running?: boolean;
  },
  snapshot: Snapshot,
) {
  const profile = stepActivityProfile(snapshot);
  const distanceKm = Math.max(0, Number(input.distanceKm) || 0);
  const durationMinutes = Math.max(0, Number(input.durationMinutes) || 0);
  const running = input.running === true;
  const hasMeasuredSpeed = distanceKm > 0 && durationMinutes > 0;
  const speedKmh = hasMeasuredSpeed
    ? distanceKm / (durationMinutes / 60)
    : running
      ? ASSUMED_RUNNING_SPEED_KMH
      : UNRECORDED_WALKING_SPEED_MPS * 3.6;
  const hasProfileHeight = profile.heightCm >= 130 && profile.heightCm <= 220;
  if (!hasProfileHeight) {
    return {
      stepLengthM: running
        ? LEGACY_RUNNING_STEP_LENGTH_M
        : LEGACY_STEP_LENGTH_M,
      speedKmh,
      speedSource: hasMeasuredSpeed ? "measured" as const : "assumed" as const,
    };
  }
  if (running) {
    const predictedStepLengthM =
      -0.255 -
      0.001 * profile.age +
      0.279 * (profile.heightCm / 100) +
      0.083 * speedKmh;
    return {
      stepLengthM: bounded(predictedStepLengthM, 0.6, 2),
      speedKmh,
      speedSource: hasMeasuredSpeed ? "measured" as const : "assumed" as const,
    };
  }
  const sexTerm = profile.sex === "female" ? 1 : 0;
  const predictedStepLengthM =
    (-16.14 -
      0.06 * profile.age +
      0.31 * profile.heightCm -
      0.04 * profile.weightKg +
      0.02 * sexTerm +
      0.3 * ((speedKmh / 3.6) * 100)) / 100;
  return {
    stepLengthM: bounded(predictedStepLengthM, 0.4, 1.05),
    speedKmh,
    speedSource: hasMeasuredSpeed ? "measured" as const : "assumed" as const,
  };
}

function estimateWalkingFromSteps(steps: number, snapshot: Snapshot) {
  const profile = stepActivityProfile(snapshot);
  const safeSteps = Math.max(0, steps);
  const hasProfileHeight = profile.heightCm >= 130 && profile.heightCm <= 220;
  const sexTerm = profile.sex === "female" ? 1 : 0;
  const predictedStepLengthM = hasProfileHeight
    ? (-16.14 -
      0.06 * profile.age +
      0.31 * profile.heightCm -
      0.04 * profile.weightKg +
      0.02 * sexTerm +
      0.3 * (UNRECORDED_WALKING_SPEED_MPS * 100)) / 100
    : LEGACY_STEP_LENGTH_M;
  const stepLengthM = hasProfileHeight
    ? bounded(predictedStepLengthM, 0.4, 1.05)
    : LEGACY_STEP_LENGTH_M;
  const distanceKm = (safeSteps * stepLengthM) / 1_000;
  const durationMinutes = distanceKm
    ? (distanceKm * 1_000) / UNRECORDED_WALKING_SPEED_MPS / 60
    : 0;
  const estimatedCalories = hasProfileHeight
    ? ((3.85 +
      (5.97 * UNRECORDED_WALKING_SPEED_MPS ** 2) / (profile.heightCm / 100)) *
      profile.weightKg *
      durationMinutes *
      5) / 1_000
    : distanceKm * LEGACY_WALKING_KCAL_PER_KG_KM * profile.weightKg;
  return { stepLengthM, distanceKm, durationMinutes, estimatedCalories };
}

function movementDistanceForStepCoverage(
  input: {
    distanceKm?: number;
    durationMinutes?: number;
    activeCalories?: number;
    running?: boolean;
  },
  snapshot: Snapshot,
) {
  const measuredDistance = Math.max(0, Number(input.distanceKm) || 0);
  if (measuredDistance > 0) return measuredDistance;
  const durationMinutes = Math.max(0, Number(input.durationMinutes) || 0);
  const activeCalories = Math.max(0, Number(input.activeCalories) || 0);
  const running = input.running === true;
  const profile = stepActivityProfile(snapshot);
  if (activeCalories > 0) {
    let calorieDistanceKm = activeCalories /
      (profile.weightKg * (running ? 1 : LEGACY_WALKING_KCAL_PER_KG_KM));
    if (!running && durationMinutes > 0 && profile.heightCm >= 130 && profile.heightCm <= 220) {
      const oxygenCostMlKgMin =
        (activeCalories * 1_000) / (profile.weightKg * durationMinutes * 5);
      const inferredSpeedMps = Math.sqrt(
        Math.max(
          0,
          (oxygenCostMlKgMin - 3.85) * (profile.heightCm / 100) / 5.97,
        ),
      );
      if (Number.isFinite(inferredSpeedMps) && inferredSpeedMps > 0) {
        calorieDistanceKm =
          (bounded(inferredSpeedMps, 0.5, 2.2) * durationMinutes * 60) /
          1_000;
      }
    }
    if (durationMinutes > 0) {
      return bounded(
        calorieDistanceKm,
        (durationMinutes / 60) * (running ? 4 : 1),
        (durationMinutes / 60) * (running ? 20 : 8),
      );
    }
    return calorieDistanceKm;
  }
  return durationMinutes > 0
    ? (durationMinutes / 60) * (running ? 9 : 5)
    : 0;
}

function replacementContains(
  replacement: ImportReplacement,
  dataType: string,
  localDate: string,
) {
  return replacement.dataType === dataType &&
    localDate >= replacement.fromDate &&
    localDate <= replacement.throughDate;
}

function derivedStepFallbackReplacements(
  replacements: readonly ImportReplacement[],
  snapshot: Snapshot,
  mapped: readonly MappedImportRecord[],
  ownership: readonly ImportOwnership[],
) {
  const derived = replacements
    .filter((replacement) => ["steps", "workouts"].includes(replacement.dataType))
    .map((replacement) => ({
      ...replacement,
      dataType: DERIVED_STEP_FALLBACK_DATA_TYPE,
    }));
  const entriesById = new Map(
    (Array.isArray(snapshot.entries) ? snapshot.entries : [])
      .map((entry) => [String(entry.id ?? ""), entry] as const),
  );
  const extraDates = new Set<string>();
  for (const owned of ownership) {
    if (!["steps", "workouts"].includes(owned.data_type)) continue;
    if (!replacements.some((replacement) =>
      replacementContains(replacement, owned.data_type, owned.local_date)
    )) continue;
    const displayDate = String(entriesById.get(owned.entry_id)?.localDate ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) extraDates.add(displayDate);
  }
  for (const record of mapped) {
    if (!["steps", "workouts"].includes(record.dataType)) continue;
    const displayDate = String(record.entry.localDate ?? record.localDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) extraDates.add(displayDate);
  }
  for (const localDate of extraDates) {
    if (derived.some((replacement) =>
      replacementContains(replacement, DERIVED_STEP_FALLBACK_DATA_TYPE, localDate)
    )) continue;
    derived.push({
      dataType: DERIVED_STEP_FALLBACK_DATA_TYPE,
      fromDate: localDate,
      throughDate: localDate,
    });
  }
  return [...new Map(
    derived.map((replacement) => [
      `${replacement.dataType}\u0000${replacement.fromDate}\u0000${replacement.throughDate}`,
      replacement,
    ]),
  ).values()];
}

function datesCoveredBy(replacements: readonly ImportReplacement[]) {
  const dates = new Set<string>();
  for (const replacement of replacements) {
    if (replacement.dataType !== DERIVED_STEP_FALLBACK_DATA_TYPE) continue;
    let localDate = replacement.fromDate;
    // Google Health currently reconciles at most 90 days. Keep a hard safety
    // bound so a corrupt cursor can never turn one worker invocation into an
    // unbounded date loop.
    for (let count = 0; count < 400 && localDate <= replacement.throughDate; count += 1) {
      dates.add(localDate);
      localDate = addDays(localDate, 1);
    }
  }
  return dates;
}

function postImportEntries(
  snapshot: Snapshot,
  mapped: readonly MappedImportRecord[],
  replacements: readonly ImportReplacement[],
  ownership: readonly ImportOwnership[],
) {
  const removedIds = new Set(
    ownership
      .filter((owned) => replacements.some((replacement) =>
        replacementContains(replacement, owned.data_type, owned.local_date)
      ))
      .map((owned) => owned.entry_id),
  );
  const incomingIds = new Set(mapped.map((record) => String(record.entry.id ?? "")));
  const result = new Map<string, JsonObject>();
  for (const entry of Array.isArray(snapshot.entries) ? snapshot.entries : []) {
    const id = String(entry.id ?? "");
    if (!id || removedIds.has(id) || incomingIds.has(id)) continue;
    result.set(id, entry);
  }
  for (const record of mapped) {
    const id = String(record.entry.id ?? "");
    if (id) result.set(id, record.entry);
  }
  return [...result.values()];
}

function appendStepFallbackRecords(
  mapped: readonly MappedImportRecord[],
  snapshot: Snapshot,
  userId: string,
  syncedAt: string,
  replacements: readonly ImportReplacement[],
  ownership: readonly ImportOwnership[],
) {
  const derivedReplacements = derivedStepFallbackReplacements(
    replacements,
    snapshot,
    mapped,
    ownership,
  );
  if (!derivedReplacements.length) {
    return { mapped: [...mapped], replacements: [...replacements] };
  }
  const allReplacements = [...replacements, ...derivedReplacements];
  const entries = postImportEntries(
    snapshot,
    mapped,
    allReplacements,
    ownership,
  );
  const metrics = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const existingById = new Map(
    (Array.isArray(snapshot.entries) ? snapshot.entries : [])
      .map((entry) => [String(entry.id ?? ""), entry] as const),
  );
  const stepMetricIds = new Set(metrics
    .filter((metric) =>
      metric.healthMapping?.dataType === "steps" &&
      metric.healthMapping.field === "value"
    )
    .map((metric) => String(metric.id)));
  const fallbackMetrics = metrics.filter((metric) =>
    metric.stepFallback === true ||
    ["exercise", "workout_duration", "workout_distance"].includes(String(metric.id))
  );
  if (!stepMetricIds.size || !fallbackMetrics.length) {
    return { mapped: [...mapped], replacements: allReplacements };
  }
  const workoutMetricIds = new Set(metrics
    .filter((metric) => metric.healthMapping?.dataType === "workouts")
    .map((metric) => String(metric.id)));
  const distanceMetricIds = new Set(metrics
    .filter((metric) =>
      metric.healthMapping?.dataType === "workouts" &&
      metric.healthMapping.field === "distance_km"
    )
    .map((metric) => String(metric.id)));
  const durationMetricIds = new Set(metrics
    .filter((metric) =>
      metric.healthMapping?.dataType === "workouts" &&
      metric.healthMapping.field === "duration_minutes"
    )
    .map((metric) => String(metric.id)));
  const calorieMetricIds = new Set(metrics
    .filter((metric) =>
      metric.healthMapping?.dataType === "workouts" &&
      metric.healthMapping.field === "active_calories"
    )
    .map((metric) => String(metric.id)));
  const activeEnergyMetricIds = new Set(metrics
    .filter((metric) =>
      metric.healthMapping?.dataType === "active_energy" &&
      metric.healthMapping.field === "value"
    )
    .map((metric) => String(metric.id)));
  const inferredGymActivities = inferredGymStepActivities(snapshot);
  const byDay = new Map<string, JsonObject[]>();
  for (const entry of entries) {
    const localDate = String(entry.localDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;
    const rows = byDay.get(localDate);
    if (rows) rows.push(entry);
    else byDay.set(localDate, [entry]);
  }
  const derived: MappedImportRecord[] = [];
  for (const localDate of datesCoveredBy(derivedReplacements)) {
    const dayEntries = byDay.get(localDate) ?? [];
    const stepEntries = dayEntries.filter((entry) =>
      stepMetricIds.has(String(entry.metricId ?? "")) &&
      (number(entry.value) ?? 0) > 0
    );
    const nativeSteps = stepEntries.filter((entry) =>
      ["apple_health", "health_connect"].includes(String(entry.sourceProvider ?? ""))
    );
    const selectedStepEntries = nativeSteps.length ? nativeSteps : stepEntries;
    const stepEntry = selectedStepEntries
      .slice()
      .sort((left, right) => (number(right.value) ?? 0) - (number(left.value) ?? 0))[0];
    const steps = number(stepEntry?.value) ?? 0;
    if (!(steps > 0)) continue;
    const linkedRows = new Map<string, JsonObject[]>();
    for (const entry of dayEntries) {
      if (String(entry.label ?? "") === "Estimated unrecorded walking from steps") continue;
      const key = stepCoverageSessionIdentity(entry);
      if (!key) continue;
      const rows = linkedRows.get(key);
      if (rows) rows.push(entry);
      else linkedRows.set(key, [entry]);
    }
    let coveredSteps = 0;
    for (const rows of linkedRows.values()) {
      const activityEntry = rows.find((entry) => {
        const metricId = String(entry.metricId ?? "");
        const identity = stepCoverageSessionIdentity(entry);
        const preferences = asObject(
          asObject(snapshot.settings).stepCoveragePreferences,
        );
        const explicitlyClassifiedActiveEnergy =
          activeEnergyMetricIds.has(metricId) &&
          eligibleStandaloneActiveEnergyForStepCoverage(entry) &&
          Boolean(
            identity &&
              stepCoverageActivityFromKey(
                asObject(asObject(preferences.sessions)[identity]).activityKey,
              ),
          );
        return (
          (workoutMetricIds.has(metricId) ||
            explicitlyClassifiedActiveEnergy) &&
          Boolean(
            resolvedStepCoverageActivity(
              entry,
              snapshot,
              inferredGymActivities,
            ),
          )
        );
      });
      const activity = activityEntry
        ? resolvedStepCoverageActivity(
            activityEntry,
            snapshot,
            inferredGymActivities,
          )
        : undefined;
      if (
        !activityEntry ||
        !activity ||
        !stepCoverageIncluded(
          activityEntry,
          activity,
          snapshot,
          inferredGymActivities,
        )
      ) continue;
      const running = [
        "running",
        "track_running",
        "treadmill_running",
      ].includes(activity.key);
      const distanceKm = Math.max(0, ...rows
        .filter((entry) => distanceMetricIds.has(String(entry.metricId ?? "")))
        .map((entry) => number(entry.value) ?? 0));
      const durationMinutes = Math.max(0, ...rows
        .filter((entry) => durationMetricIds.has(String(entry.metricId ?? "")))
        .map((entry) => number(entry.value) ?? 0));
      const activeCalories = Math.max(
        0,
        ...rows
          .filter((entry) =>
            calorieMetricIds.has(String(entry.metricId ?? "")) ||
            activeEnergyMetricIds.has(String(entry.metricId ?? ""))
          )
          .map((entry) => number(entry.value) ?? 0),
        ...rows.map((entry) =>
          number(asObject(entry.submetricValues).exercise) ?? 0
        ),
      );
      const directWorkoutSteps = Math.max(
        0,
        ...rows.map((entry) => number(entry.sourceWorkoutSteps) ?? 0),
      );
      const estimatedDistanceKm = movementDistanceForStepCoverage(
        { distanceKm, durationMinutes, activeCalories, running },
        snapshot,
      );
      if (directWorkoutSteps > 0) {
        coveredSteps += directWorkoutSteps;
      } else if (activity.mode === "equivalent") {
        coveredSteps += equivalentSteps(
          activity,
          { durationMinutes, activeCalories },
          snapshot,
        );
      } else {
        const workoutStepLength = movementStepLengthForCoverage(
          { distanceKm, durationMinutes, running },
          snapshot,
        );
        coveredSteps += (estimatedDistanceKm * 1_000) /
          workoutStepLength.stepLengthM;
      }
    }
    const uncoveredSteps = Math.max(0, steps - coveredSteps);
    const estimate = estimateWalkingFromSteps(uncoveredSteps, snapshot);
    const recordedAt = String(stepEntry?.recordedAt ?? syncedAt);
    for (const metric of fallbackMetrics) {
      const mapping = metric.healthMapping;
      let value = 0;
      let suffix = "";
      if (mapping?.dataType === "active_energy" && mapping.field === "value") {
        value = estimate.estimatedCalories;
        suffix = "calories";
      } else if (mapping?.dataType === "workouts" && mapping.field === "distance_km") {
        value = estimate.distanceKm;
        suffix = "distance";
      } else if (mapping?.dataType === "workouts" && mapping.field === "duration_minutes") {
        value = estimate.durationMinutes;
        suffix = "duration";
      }
      if (!(value > 0) || !suffix || !metric.id) continue;
      const metricId = String(metric.id);
      const entryId = safeId(
        `google-health:step-fallback:${localDate}:${metricId}:${suffix}`,
      );
      const nextEntry: JsonObject = {
        id: entryId,
        metricId,
        userId,
        value: Math.round(value * 10) / 10,
        localDate,
        recordedAt,
        visibility: validVisibility(metric.defaultVisibility) ?? "private",
        source: "calculated",
        label: "Estimated unrecorded walking from steps",
        note: `Uses ${Math.round(uncoveredSteps).toLocaleString("en-US")} steps not already explained by workouts included in Step coverage.`,
        sourceProvider: "google_health",
        sourceRecordId: `step-fallback:${localDate}`,
        sourceOrigin: String(stepEntry?.sourceOrigin ?? "Google Health API"),
        sourceUpdatedAt: syncedAt,
      };
      const existingEntry = existingById.get(entryId);
      const retainedEntry =
        existingEntry &&
          stableStepFallbackEntry(existingEntry) ===
            stableStepFallbackEntry(nextEntry)
          ? existingEntry
          : nextEntry;
      derived.push({
        externalId: `step-fallback:${localDate}`,
        dataType: DERIVED_STEP_FALLBACK_DATA_TYPE,
        localDate,
        entry: retainedEntry,
      });
    }
  }
  return { mapped: [...mapped, ...derived], replacements: allReplacements };
}

function preferNativeStepOwner(
  mapped: Array<{ externalId: string; dataType: string; localDate: string; entry: JsonObject }>,
  snapshot: Snapshot,
) {
  const existing = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const existingGoogleIds = new Set(
    existing
      .filter((entry) =>
        entry.sourceProvider === "google_health" ||
        String(entry.id ?? "").startsWith("google-health:")
      )
      .map((entry) => String(entry.id ?? "")),
  );
  return mapped.flatMap((record) => {
    if (record.dataType !== "steps") return [record];
    const hasNativeCanonical = existing.some((entry) =>
      entry.metricId === record.entry.metricId &&
      entry.localDate === record.localDate &&
      entry.source === "imported" &&
      ["apple_health", "health_connect"].includes(String(entry.sourceProvider)) &&
      String(entry.sourceRecordId ?? "").startsWith("aggregate:steps:") &&
      positive(entry.value) !== undefined
    );
    // Native owns presentation, but an already-owned Google total remains a
    // durable fallback. The shared client reconciliation hides it while the
    // native row exists; retaining ownership prevents a later cache-only
    // native gap from turning a confirmed account total into zero.
    return hasNativeCanonical &&
        !existingGoogleIds.has(String(record.entry.id ?? ""))
      ? []
      : [record];
  });
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant|revoked|expired/i.test(message)) return "reauthorization_required";
  const providerCode = googleHealthProviderErrorCode(error);
  if (providerCode === "missing_oauth_scope" || /403|permission|scope/i.test(message))
    return "scope_denied";
  if (/429|quota/i.test(message)) return "rate_limited";
  if (/abort|timeout/i.test(message)) return "timeout";
  // Google catalog reasons are bounded identifiers. Persisting the reason (not
  // the arbitrary provider message) makes service-only cursor state diagnostic
  // while remaining safe to return through the existing status endpoint.
  if (providerCode) return providerCode;
  return "provider_error";
}

type RefreshReplacementProof = {
  expectedGeneration: number;
  leaseId: string;
  nonce: string;
  fingerprint: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

type RefreshReplacementConnection = {
  status?: unknown;
  sync_lease_id?: unknown;
  connection_generation?: unknown;
  refresh_replacement_nonce?: unknown;
  refresh_token_fingerprint?: unknown;
  refresh_token_ciphertext?: unknown;
  refresh_token_iv?: unknown;
  encryption_key_version?: unknown;
};

type RefreshReplacementDisposition = "active" | "queued" | "not_applied" | "ambiguous";

function refreshReplacementDisposition(
  proof: RefreshReplacementProof,
  connection: RefreshReplacementConnection | null | undefined,
  exactCredentialQueued: boolean,
): RefreshReplacementDisposition {
  const exactStoredCredential =
    connection?.status === "connected" &&
    connection.sync_lease_id === proof.leaseId &&
    Number(connection.connection_generation) === proof.expectedGeneration + 1 &&
    connection.refresh_replacement_nonce === proof.nonce &&
    connection.refresh_token_fingerprint === proof.fingerprint &&
    connection.refresh_token_ciphertext === proof.ciphertext &&
    connection.refresh_token_iv === proof.iv &&
    Number(connection.encryption_key_version) === proof.keyVersion;
  if (exactStoredCredential) return "active";
  if (exactCredentialQueued) return "queued";
  if (
    connection?.status === "connected" &&
    connection.sync_lease_id === proof.leaseId &&
    Number(connection.connection_generation) === proof.expectedGeneration
  ) return "not_applied";
  return "ambiguous";
}

async function persistRefreshReplacement(
  admin: SupabaseClient,
  userId: string,
  proof: RefreshReplacementProof,
  scopes: string[],
  expiresAt?: string,
) {
  const args = {
    p_user_id: userId,
    p_lease_id: proof.leaseId,
    p_expected_generation: proof.expectedGeneration,
    p_replacement_nonce: proof.nonce,
    p_refresh_token_fingerprint: proof.fingerprint,
    p_refresh_token_ciphertext: proof.ciphertext,
    p_refresh_token_iv: proof.iv,
    p_encryption_key_version: proof.keyVersion,
    p_granted_scopes: scopes,
    p_refresh_token_expires_at: expiresAt ?? null,
  };
  let persistenceError: unknown;
  // A second call with the same nonce is safe and resolves the most common
  // committed-but-response-lost failure without needing compensation.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const persisted = await admin.rpc("persist_google_health_refresh_replacement", args);
    const result = Array.isArray(persisted.data) ? persisted.data[0] : persisted.data;
    if (
      !persisted.error &&
      result?.outcome === "applied" &&
      Number(result.connectionGeneration) === proof.expectedGeneration + 1 &&
      result.replacementNonce === proof.nonce &&
      result.refreshTokenFingerprint === proof.fingerprint
    ) return;
    persistenceError = persisted.error ?? new Error("google_health_refresh_replacement_rejected");
  }

  // Do not compensate based on an ambiguous mutation response. Re-read both
  // the exact active tuple and durable revocation queue before deciding whether
  // revoking the provider-issued token is safe.
  const [stored, queued] = await Promise.all([
    admin.from("google_health_connections")
      .select(
        "status,sync_lease_id,connection_generation,refresh_replacement_nonce,refresh_token_fingerprint,refresh_token_ciphertext,refresh_token_iv,encryption_key_version",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("google_health_revocation_queue")
      .select("id")
      .eq("user_id", userId)
      .eq("refresh_token_ciphertext", proof.ciphertext)
      .eq("refresh_token_iv", proof.iv)
      .eq("encryption_key_version", proof.keyVersion)
      .limit(1),
  ]);
  if (stored.error || queued.error) {
    // Fail closed: without an exact read, the replacement may already be the
    // active credential. Never enqueue/revoke it on uncertainty.
    throw persistenceError ?? stored.error ?? queued.error ?? new Error("google_health_refresh_replacement_ambiguous");
  }
  const disposition = refreshReplacementDisposition(
    proof,
    stored.data as RefreshReplacementConnection | null,
    (queued.data?.length ?? 0) > 0,
  );
  if (disposition === "active") return;
  if (disposition === "queued") throw new Error("google_health_sync_cancelled");
  if (disposition === "not_applied") {
    const compensation = await admin.from("google_health_revocation_queue").insert({
      user_id: userId,
      refresh_token_ciphertext: proof.ciphertext,
      refresh_token_iv: proof.iv,
      encryption_key_version: proof.keyVersion,
    });
    if (compensation.error) throw compensation.error;
  }
  throw persistenceError ?? new Error(
    disposition === "ambiguous"
      ? "google_health_refresh_replacement_ambiguous"
      : "google_health_refresh_replacement_failed",
  );
}

async function definitionRange(
  admin: SupabaseClient,
  userId: string,
  definition: DataTypeDefinition,
  today: string,
) {
  const { data, error } = await admin
    .from("google_health_sync_cursors")
    .select("last_success_at")
    .eq("user_id", userId)
    .eq("data_type", definition.googleType)
    .maybeSingle();
  if (error) throw error;
  const last = data?.last_success_at ? new Date(data.last_success_at) : undefined;
  const initialFrom = addDays(today, -(definition.maxInitialDays - 1));
  if (!last || !Number.isFinite(last.getTime())) return { fromDate: initialFrom, throughDate: today };
  const overlap = addDays(dateKey(last), -2);
  return { fromDate: overlap < initialFrom ? initialFrom : overlap, throughDate: today };
}

async function fetchDefinition(
  accessToken: string,
  definition: DataTypeDefinition,
  range: { fromDate: string; throughDate: string },
  now: Date,
  today: string,
) {
  if (definition.mode === "daily") {
    // Daily rollups have a provider maximum of 90 days, and heart rate is
    // limited to 14. Historical webhook spans are therefore split rather
    // than truncated, so both old deletes and newer events are reconciled.
    const records: InternalRecord[] = [];
    const authoritativeDailyDates = new Set<string>();
    let fromDate = range.fromDate;
    while (fromDate <= range.throughDate) {
      const throughDate = [addDays(fromDate, definition.maxInitialDays - 1), range.throughDate]
        .sort()[0];
      const response = await dailyRollUp(
        accessToken,
        definition.googleType,
        fromDate,
        addDays(throughDate, 1),
      );
      for (const localDate of dailyValueDates(
        definition,
        response.rollupDataPoints ?? [],
      )) authoritativeDailyDates.add(localDate);
      records.push(...await normalizeDaily(
        definition,
        response.rollupDataPoints ?? [],
        now,
        today,
      ));
      fromDate = addDays(throughDate, 1);
    }
    return { records, authoritativeDailyDates };
  }
  const usesCivilTime = definition.filterField?.includes("civil_");
  const lower = usesCivilTime ? range.fromDate : `${range.fromDate}T00:00:00Z`;
  const upperDate = addDays(range.throughDate, 1);
  const upper = usesCivilTime ? upperDate : `${upperDate}T00:00:00Z`;
  const field = definition.filterField!;
  const points = await reconcileDataPoints(
    accessToken,
    definition.googleType,
    `${field} >= "${lower}" AND ${field} < "${upper}"`,
    definition.pageSize ?? 10_000,
  );
  return { records: await normalizeReconciled(definition, points) };
}

async function performGoogleHealthSync(
  admin: SupabaseClient,
  userId: string,
  onlyGoogleTypes?: ReadonlySet<string>,
  options?: { ranges?: ReadonlyMap<string, GoogleHealthDateRange> },
  leaseId?: string,
): Promise<GoogleHealthSyncResult> {
  const config = googleHealthConfig();
  const [
    { data: connection, error: connectionError },
    { data: snapshotRow, error: snapshotError },
    { data: profile, error: profileError },
    { data: preferences, error: preferencesError },
  ] = await Promise.all([
    admin.from("google_health_connections").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("user_snapshots").select("payload,revision").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
    admin.from("google_health_entry_preferences")
      .select("entry_id,visibility,recorded_at_override,display_local_date,dismissed")
      .eq("user_id", userId),
  ]);
  if (connectionError) throw connectionError;
  if (snapshotError) throw snapshotError;
  if (profileError) throw profileError;
  if (preferencesError) throw preferencesError;
  if (!connection?.refresh_token_ciphertext || !connection.refresh_token_iv)
    throw new Error("Google Health is not connected");
  if (!snapshotRow?.payload) throw new Error("HabHub account snapshot is not ready");
  let activePreferences = (preferences ?? []) as EntryPreference[];
  const snapshot = snapshotWithEntryPreferences(
    snapshotRow.payload as Snapshot,
    activePreferences,
  );
  const refreshToken = await decryptSecret({
    ciphertext: connection.refresh_token_ciphertext,
    iv: connection.refresh_token_iv,
    keyVersion: connection.encryption_key_version,
  }, { purpose: "refresh-token", userId });

  let accessToken: string;
  let activeGrantedScopes = new Set<string>(connection.granted_scopes ?? []);
  try {
    const refreshed = await refreshGoogleAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    });
    accessToken = refreshed.access_token;
    const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
    const encrypted = await encryptSecret(
      nextRefreshToken,
      { purpose: "refresh-token", userId },
    );
    if (typeof refreshed.scope === "string") {
      const supportedScopes = new Set([ACTIVITY_SCOPE, HEALTH_SCOPE, NUTRITION_SCOPE, SLEEP_SCOPE]);
      activeGrantedScopes = new Set(
        refreshed.scope.split(/\s+/).filter((scope) => supportedScopes.has(scope)),
      );
    }
    const refreshTokenExpiresAt = refreshed.refresh_token_expires_in
      ? new Date(Date.now() + refreshed.refresh_token_expires_in * 1000).toISOString()
      : undefined;
    const expectedGeneration = Number(connection.connection_generation);
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || !leaseId)
      throw new Error("google_health_sync_cancelled");
    if (refreshed.refresh_token) {
      const proof: RefreshReplacementProof = {
        expectedGeneration,
        leaseId,
        nonce: crypto.randomUUID(),
        fingerprint: await sha256Hex(refreshed.refresh_token),
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
      };
      await persistRefreshReplacement(
        admin,
        userId,
        proof,
        [...activeGrantedScopes],
        refreshTokenExpiresAt,
      );
    } else {
      // Re-encryption of the unchanged token is not a provider replacement and
      // never has a compensating revoke path. Guard it with the same lease and
      // generation, but preserve the live credential on an ambiguous response.
      const persisted = await admin.from("google_health_connections").update({
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_iv: encrypted.iv,
        refresh_token_fingerprint: await sha256Hex(refreshToken),
        refresh_replacement_nonce: null,
        encryption_key_version: encrypted.keyVersion,
        granted_scopes: [...activeGrantedScopes],
        ...(refreshTokenExpiresAt ? { refresh_token_expires_at: refreshTokenExpiresAt } : {}),
      })
        .eq("user_id", userId)
        .eq("status", "connected")
        .eq("sync_lease_id", leaseId)
        .eq("connection_generation", expectedGeneration)
        .select("user_id")
        .maybeSingle();
      if (persisted.error || !persisted.data)
        throw persisted.error ?? new Error("google_health_sync_cancelled");
    }
  } catch (error) {
    const code = errorCode(error);
    const marked = await admin.from("google_health_connections").update({
      status: code === "reauthorization_required" ? "error" : "connected",
      last_error_code: code,
      last_error_at: new Date().toISOString(),
      ...(code === "reauthorization_required"
        ? {
          refresh_token_ciphertext: null,
          refresh_token_iv: null,
          refresh_token_fingerprint: null,
          refresh_replacement_nonce: null,
          refresh_token_expires_at: null,
        }
        : {}),
    }).eq("user_id", userId).eq("sync_lease_id", leaseId);
    if (marked.error) console.error("Google Health refresh failure state could not be persisted");
    throw error;
  }

  const now = new Date();
  const today = zonedDateKey(now, String(profile?.timezone ?? "UTC"));
  const definitions = DATA_TYPES.filter((definition) =>
    activeGrantedScopes.has(definition.requiredScope) &&
    (!onlyGoogleTypes?.size || onlyGoogleTypes.has(definition.googleType)));
  if (!definitions.length) {
    const finished = await admin.rpc("finish_google_health_sync", {
      p_user_id: userId,
      p_lease_id: leaseId,
      p_successes: [],
      p_errors: [],
      p_synced_at: now.toISOString(),
    });
    if (finished.error || finished.data !== true)
      throw finished.error ?? new Error("google_health_sync_cancelled");
    return { imported: 0, deleted: 0, dataTypes: [], errors: [] };
  }
  const fetched: Array<{
    definition: DataTypeDefinition;
    range: GoogleHealthDateRange;
    records: InternalRecord[];
    authoritativeDailyDates?: ReadonlySet<string>;
    error?: unknown;
  }> = [];
  for (const definition of definitions) {
    const range = options?.ranges?.get(definition.googleType) ??
      await definitionRange(admin, userId, definition, today);
    try {
      const result = await fetchDefinition(accessToken, definition, range, now, today);
      fetched.push({ definition, range, ...result });
    } catch (error) {
      fetched.push({ definition, range, error, records: [] });
    }
  }

  const successful = fetched.filter((item) => !item.error);
  const errors = fetched.filter((item) => item.error).map((item) => ({
    dataType: item.definition.googleType,
    code: errorCode(item.error),
  }));
  if (!successful.length) {
    const finished = await admin.rpc("finish_google_health_sync", {
      p_user_id: userId,
      p_lease_id: leaseId,
      p_successes: [],
      p_errors: errors,
      p_synced_at: now.toISOString(),
    });
    if (finished.error || finished.data !== true)
      throw finished.error ?? new Error("google_health_sync_cancelled");
    // A completed provider attempt with per-type failures is still a valid,
    // actionable sync result. Returning the bounded error catalog lets manual
    // clients explain which categories failed and lets durable background jobs
    // retry only those categories instead of collapsing everything into a
    // generic transport error.
    return {
      imported: 0,
      deleted: 0,
      dataTypes: [],
      errors,
    };
  }

  const replacements = successful.flatMap((item) =>
    replacementRangesForFetch(
      item.definition,
      item.range,
      today,
      item.authoritativeDailyDates,
    )
  );
  let effectiveReplacements: ImportReplacement[] = replacements;
  const stepContextReplacements = replacements.filter((replacement) =>
    ["steps", "workouts"].includes(replacement.dataType)
  );
  let importOwnership: Array<Record<string, unknown>> = [];
  if (stepContextReplacements.length) {
    const ownershipFromDate = stepContextReplacements
      .map((replacement) => replacement.fromDate)
      .sort()[0];
    const ownershipThroughDate = stepContextReplacements
      .map((replacement) => replacement.throughDate)
      .sort()
      .at(-1)!;
    const ownership = await admin.from("google_health_import_records")
      .select("entry_id,data_type,local_date")
      .eq("user_id", userId)
      .in("data_type", ["steps", "workouts", DERIVED_STEP_FALLBACK_DATA_TYPE])
      .gte("local_date", ownershipFromDate)
      .lte("local_date", ownershipThroughDate);
    if (ownership.error) throw ownership.error;
    importOwnership = (ownership.data ?? []) as Array<Record<string, unknown>>;
  }
  const stepFallbackOwnership = importOwnership.map((owned) => ({
    entry_id: String(owned.entry_id ?? ""),
    data_type: String(owned.data_type ?? ""),
    local_date: String(owned.local_date ?? ""),
  })).filter((owned) =>
    Boolean(owned.entry_id) &&
    Boolean(owned.data_type) &&
    /^\d{4}-\d{2}-\d{2}$/.test(owned.local_date)
  );
  const fetchedRecords = successful.flatMap((item) => item.records);
  let currentSnapshot = snapshot;
  let currentRevision = Number(snapshotRow.revision);
  let mapped: Array<{ externalId: string; dataType: string; localDate: string; entry: JsonObject }> = [];
  let seenRecords: Array<{ entryId: string; dataType: string; localDate: string }> = [];
  let applied: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const mappedFromProvider = mapRecordsToEntries(fetchedRecords, currentSnapshot, userId, now.toISOString());
    seenRecords = mappedFromProvider.map((record) => ({
      entryId: String(record.entry.id ?? ""),
      dataType: record.dataType,
      localDate: record.localDate,
    })).filter((record) => record.entryId);
    mapped = mappedFromProvider;
    mapped = preferNativeStepOwner(mapped, currentSnapshot);
    mapped = preserveUserIntentAndDeduplicate(mapped, currentSnapshot);
    const withStepFallback = appendStepFallbackRecords(
      mapped,
      currentSnapshot,
      userId,
      now.toISOString(),
      replacements,
      stepFallbackOwnership,
    );
    mapped = withStepFallback.mapped;
    effectiveReplacements = withStepFallback.replacements;
    seenRecords.push(...mapped
      .filter((record) => record.dataType === DERIVED_STEP_FALLBACK_DATA_TYPE)
      .map((record) => ({
        entryId: String(record.entry.id ?? ""),
        dataType: record.dataType,
        localDate: record.localDate,
      }))
      .filter((record) => record.entryId));
    const result = await admin.rpc("apply_google_health_import", {
      p_user_id: userId,
      p_records: mapped,
      p_seen_records: seenRecords,
      p_replacements: effectiveReplacements,
      p_synced_at: now.toISOString(),
      p_expected_revision: currentRevision,
      p_lease_id: leaseId,
    });
    if (!result.error) {
      applied = result.data;
      break;
    }
    if (!/google_health_snapshot_conflict|40001/i.test(String(result.error.message ?? "")))
      throw result.error;
    const { data: latest, error: latestError } = await admin.from("user_snapshots")
      .select("payload,revision")
      .eq("user_id", userId)
      .maybeSingle();
    if (latestError || !latest?.payload || latest.revision === undefined)
      throw latestError ?? result.error;
    const refreshedPreferences = await admin.from("google_health_entry_preferences")
      .select("entry_id,visibility,recorded_at_override,display_local_date,dismissed")
      .eq("user_id", userId);
    if (refreshedPreferences.error) throw refreshedPreferences.error;
    activePreferences = (refreshedPreferences.data ?? []) as EntryPreference[];
    currentSnapshot = snapshotWithEntryPreferences(
      latest.payload as Snapshot,
      activePreferences,
    );
    currentRevision = Number(latest.revision);
  }
  if (applied === undefined) throw new Error("google_health_snapshot_conflict");

  const appliedRow = Array.isArray(applied) ? applied[0] : applied;
  let projectionRevision = Number(appliedRow?.revision);
  if (!Number.isSafeInteger(projectionRevision) || projectionRevision < 0)
    throw new Error("google_health_snapshot_conflict");
  let groupProjectionApplied = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const projection = await admin.rpc("project_google_health_group_data", {
      p_user_id: userId,
      p_snapshot_revision: projectionRevision,
    });
    if (!projection.error) {
      groupProjectionApplied = true;
      break;
    }
    if (!/google_health_projection_conflict|40001/i.test(
      String(projection.error.message ?? ""),
    )) throw projection.error;
    const latest = await admin.from("user_snapshots")
      .select("revision")
      .eq("user_id", userId)
      .maybeSingle();
    if (latest.error || latest.data?.revision === undefined)
      throw latest.error ?? projection.error;
    projectionRevision = Number(latest.data.revision);
    if (!Number.isSafeInteger(projectionRevision) || projectionRevision < 0)
      throw projection.error;
  }
  if (!groupProjectionApplied) throw new Error("google_health_projection_conflict");

  // A web-only participant may not belong to the public challenge creator's
  // group, so the ordinary group projection cannot provide their score. Read
  // the just-committed account snapshot and publish only consented aggregate
  // totals before marking this Google Health sync complete.
  const challengeSnapshot = await admin.from("user_snapshots")
    .select("payload,revision")
    .eq("user_id", userId)
    .maybeSingle();
  if (challengeSnapshot.error || !challengeSnapshot.data?.payload)
    throw challengeSnapshot.error ?? new Error("google_health_snapshot_missing");
  if (Number(challengeSnapshot.data.revision) !== projectionRevision)
    throw new Error("google_health_projection_conflict");
  await projectPublicChallengesFromSnapshot(
    admin,
    userId,
    challengeSnapshot.data.payload as Snapshot,
    now.toISOString(),
  );

  const finished = await admin.rpc("finish_google_health_sync", {
    p_user_id: userId,
    p_lease_id: leaseId,
    p_successes: successful.map((item) => ({
      dataType: item.definition.googleType,
      throughDate: item.range.throughDate,
    })),
    p_errors: errors,
    p_synced_at: now.toISOString(),
  });
  if (finished.error || finished.data !== true)
    throw finished.error ?? new Error("google_health_sync_cancelled");

  return {
    imported: Number(appliedRow?.imported_count ?? mapped.length),
    deleted: Number(appliedRow?.deleted_count ?? 0),
    dataTypes: successful.map((item) => item.definition.googleType),
    errors,
  };
}

export async function syncGoogleHealthUser(
  admin: SupabaseClient,
  userId: string,
  onlyGoogleTypes?: ReadonlySet<string>,
  options?: {
    manual?: boolean;
    ranges?: ReadonlyMap<string, GoogleHealthDateRange>;
  },
): Promise<GoogleHealthSyncResult> {
  const { data, error } = await admin.rpc("claim_google_health_sync", {
    p_user_id: userId,
    p_manual: options?.manual === true,
  });
  if (error) throw error;
  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim?.lease_id) throw new Error(String(claim?.denial_reason ?? "sync_busy"));
  try {
    return await performGoogleHealthSync(admin, userId, onlyGoogleTypes, options, claim.lease_id);
  } finally {
    const { error: releaseError } = await admin.rpc("release_google_health_sync", {
      p_user_id: userId,
      p_lease_id: claim.lease_id,
    });
    if (releaseError) console.error("Google Health sync lease release failed");
  }
}

export async function connectionStatus(admin: SupabaseClient, userId: string) {
  const [
    { data: connection, error: connectionError },
    { count: importedCount, error: importedCountError },
  ] = await Promise.all([
    admin.from("google_health_connections")
      .select("status,google_email,granted_scopes,last_synced_at,last_error_code,sync_lease_until")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("google_health_import_records")
      .select("entry_id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  if (connectionError) throw connectionError;
  if (importedCountError) throw importedCountError;
  if (!connection)
    return {
      state: "disconnected",
      provider: "google_health",
      scopes: [],
      importedCount: importedCount ?? 0,
      syncing: false,
    };
  const syncLeaseUntil = typeof connection.sync_lease_until === "string"
    ? Date.parse(connection.sync_lease_until)
    : Number.NaN;
  return {
    state: connection.status,
    provider: "google_health",
    email: connection.google_email ?? null,
    scopes: connection.granted_scopes ?? [],
    lastSyncedAt: connection.last_synced_at ?? null,
    lastError: connection.last_error_code ?? null,
    importedCount: importedCount ?? 0,
    syncing: Number.isFinite(syncLeaseUntil) && syncLeaseUntil > Date.now(),
  };
}

export const googleHealthWebhookDataTypes = DATA_TYPES
  .map((definition) => definition.googleType)
  .filter((dataType) => dataType !== "active-energy-burned");

// Pure fixtures use the production mapping and reconciliation code directly.
// This is not an Edge endpoint and exports no credentials or account state.
export const googleHealthSyncTestHooks = {
  nutritionFrom,
  googleHealthSourceOrigin,
  dailyValueDates,
  replacementRangesForFetch,
  mapRecordsToEntries,
  appendStepFallbackRecords,
  estimateWalkingFromSteps,
  movementStepLengthForCoverage,
  metCadenceStepEstimate,
  stepCoverageActivity,
  stepCoverageActivityFromKey,
  eligibleStandaloneActiveEnergyForStepCoverage,
  derivedStepFallbackReplacements,
  preserveUserIntentAndDeduplicate,
  preferNativeStepOwner,
  semanticallyMatchesNative,
  refreshReplacementDisposition,
};
