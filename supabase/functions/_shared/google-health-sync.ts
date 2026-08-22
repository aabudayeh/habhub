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

type JsonObject = Record<string, unknown>;
type Metric = JsonObject & {
  id?: string;
  unit?: string;
  dataType?: string;
  defaultVisibility?: string;
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
      if (value) records.push({ externalId: id, dataType: "weight", ...time, value: value / 1_000, unit: "kg", note: String(payload.notes ?? "") || undefined });
    } else if (definition.internalType === "body_fat") {
      const value = positive(payload.percentage);
      if (value) records.push({ externalId: id, dataType: "body_fat", ...time, value, unit: "%" });
    } else if (definition.internalType === "blood_glucose") {
      const value = positive(payload.bloodGlucoseMilligramsPerDeciliter);
      if (value) records.push({ externalId: id, dataType: "blood_glucose", ...time, value, unit: "mg/dL", note: String(payload.notes ?? "") || undefined });
    } else if (definition.internalType === "sleep") {
      const summary = asObject(payload.summary);
      const minutes = positive(summary.minutesAsleep) ?? durationMinutes(time.startTime, time.endTime);
      if (minutes > 0) records.push({ externalId: id, dataType: "sleep", ...time, value: minutes / 60, unit: "hr", measurements: { durationMinutes: minutes }, label: "Sleep" });
    } else if (definition.internalType === "workouts") {
      const summary = asObject(payload.metricsSummary);
      const minutes = durationStringMinutes(payload.activeDuration) ?? durationMinutes(time.startTime, time.endTime);
      if (!(minutes > 0)) continue;
      const activeCalories = positive(summary.caloriesKcal);
      const distanceMm = positive(summary.distanceMillimeters);
      const exerciseType = String(payload.exerciseType ?? "OTHER");
      records.push({
        externalId: id,
        dataType: "workouts",
        ...time,
        value: minutes,
        unit: "min",
        label: String(payload.displayName ?? exerciseType.replace(/_/g, " ")),
        activityKey: exerciseType.toLowerCase().replace(/_/g, "-"),
        note: String(payload.notes ?? "") || undefined,
        measurements: {
          durationMinutes: minutes,
          ...(activeCalories ? { activeCalories } : {}),
          ...(distanceMm ? { distanceKm: distanceMm / 1_000_000 } : {}),
        },
      });
    } else if (definition.internalType === "water") {
      const milliliters = positive(asObject(payload.amountConsumed).milliliters);
      if (milliliters) records.push({ externalId: id, dataType: "water", ...time, value: milliliters / 250, unit: "cups", label: "Water" });
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
    ...(mayCarryMealDetails && record.label ? { label: record.label } : {}),
    ...(mayCarryMealDetails
      ? { note: [record.note, "Synced from Google Health"].filter(Boolean).join(" · ") }
      : {}),
    ...(mayCarryMealDetails && record.nutrition ? { nutrition: record.nutrition } : {}),
    sourceProvider: "google_health",
    sourceRecordId,
    sourceOrigin: "Google Health API",
    sourceUpdatedAt: syncedAt,
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
    // Native device ownership is order-independent. If a Health Connect or
    // HealthKit mirror is present, suppress the Google materialization even
    // when an older Google row/override already exists. The server preference
    // remains available so Google can become the fallback if native vanishes.
    if (entries.some((candidate) => semanticallyMatchesNative(generated, candidate)))
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

function preferNativeStepOwner(
  mapped: Array<{ externalId: string; dataType: string; localDate: string; entry: JsonObject }>,
  snapshot: Snapshot,
) {
  const existing = Array.isArray(snapshot.entries) ? snapshot.entries : [];
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
    // A device-native aggregate is authoritative for its civil day. Skipping
    // the Google materialization also makes reconciliation remove an older
    // Google-owned duplicate; web-only users still receive the Google total.
    return hasNativeCanonical ? [] : [record];
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
      records.push(...await normalizeDaily(
        definition,
        response.rollupDataPoints ?? [],
        now,
        today,
      ));
      fromDate = addDays(throughDate, 1);
    }
    return records;
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
  return normalizeReconciled(definition, points);
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
    error?: unknown;
  }> = [];
  for (const definition of definitions) {
    const range = options?.ranges?.get(definition.googleType) ??
      await definitionRange(admin, userId, definition, today);
    try {
      const records = await fetchDefinition(accessToken, definition, range, now, today);
      fetched.push({ definition, range, records });
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
    throw new Error("Every Google Health data request failed");
  }

  const replacements = successful.map((item) => ({
    dataType: item.definition.internalType,
    fromDate: item.range.fromDate,
    throughDate: item.range.throughDate,
  }));
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
    const result = await admin.rpc("apply_google_health_import", {
      p_user_id: userId,
      p_records: mapped,
      p_seen_records: seenRecords,
      p_replacements: replacements,
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

  const row = Array.isArray(applied) ? applied[0] : applied;
  return {
    imported: Number(row?.imported_count ?? mapped.length),
    deleted: Number(row?.deleted_count ?? 0),
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
      .select("status,google_email,granted_scopes,last_synced_at,last_error_code")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("google_health_import_records")
      .select("entry_id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  if (connectionError) throw connectionError;
  if (importedCountError) throw importedCountError;
  if (!connection)
    return { state: "disconnected", provider: "google_health", scopes: [], importedCount: importedCount ?? 0 };
  return {
    state: connection.status,
    provider: "google_health",
    email: connection.google_email ?? null,
    scopes: connection.granted_scopes ?? [],
    lastSyncedAt: connection.last_synced_at ?? null,
    lastError: connection.last_error_code ?? null,
    importedCount: importedCount ?? 0,
  };
}

export const googleHealthWebhookDataTypes = DATA_TYPES
  .map((definition) => definition.googleType)
  .filter((dataType) => dataType !== "active-energy-burned");

// Pure fixtures use the production mapping and reconciliation code directly.
// This is not an Edge endpoint and exports no credentials or account state.
export const googleHealthSyncTestHooks = {
  nutritionFrom,
  mapRecordsToEntries,
  preserveUserIntentAndDeduplicate,
  preferNativeStepOwner,
  semanticallyMatchesNative,
  refreshReplacementDisposition,
};
