import {
  aggregateRecord,
  aggregateGroupByPeriod,
  getGrantedPermissions,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from "react-native-health-connect";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";

import {
  exerciseFromActivityName,
  healthConnectSegmentExercise,
  healthConnectSessionExercise,
} from "@/src/domain/exerciseCatalog";
import {
  healthEnergyRecordCoversWorkout,
  isFitbitEnergyOrigin,
  samsungWorkoutEnergyRecords,
} from "@/src/domain/health";
import {
  authoritativeHealthConnectStepGroups,
  combineDisjointStepWindows,
  DEFAULT_LIVE_STEP_SOURCES,
  finalImportedStepTotal,
  healthSourceEnabled,
  localCalendarAggregateRange,
  partitionStepAggregateRange,
  reconcileCurrentDayStepTotal,
  replaceCanonicalStepAggregateForDay,
  resolveCurrentDeviceStepOrigins,
  samsungDailySummaryStepCount,
} from "@/src/domain/healthDedup";
import { HealthAdapter, HealthImportRecord } from "@/src/health/types";
import { HealthDataType, NutritionDetails } from "@/src/types";

type AndroidPhoneStepsModule = {
  healthConnectOnDeviceSteps?: boolean;
  getCurrentDeviceStepOrigins?: () => Promise<string[]>;
  startLocalPhoneStepRecording?: () => Promise<boolean>;
  readLocalPhoneSteps?: (
    fromEpochMs: number,
    toEpochMs: number,
  ) => Promise<{
    count: number;
    coverageStartEpochMs: number;
  } | null>;
  stopLocalPhoneStepRecording?: () => Promise<boolean>;
};

const androidPhoneSteps = NativeModules.HabHubAndroid as
  | AndroidPhoneStepsModule
  | undefined;
const LOCAL_PHONE_STEP_READ_TIMEOUT_MS = 1_500;
const CURRENT_DEVICE_ORIGIN_TIMEOUT_MS = 1_500;
const STEP_ORIGIN_DISCOVERY_RETRY_MS = 10 * 60_000;
const SAMSUNG_HEALTH_STEP_ORIGIN = "com.sec.android.app.shealth";
const SAMSUNG_HEALTH_STEP_SOURCE = "Samsung Health";
const LOCAL_PHONE_STEP_SOURCE = "Android phone (Physical Activity)";
const HEALTH_CONNECT_PHONE_STEP_SOURCE = "Android phone (Health Connect)";
let rememberedCurrentDeviceStepOrigins = ["android"];
let nextRawStepOriginDiscoveryAt = 0;

async function currentDeviceStepOrigins() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const origins = await Promise.race([
    Promise.resolve()
      .then(() => androidPhoneSteps?.getCurrentDeviceStepOrigins?.() ?? [])
      .catch(() => []),
    new Promise<string[]>((resolve) => {
      timeout = setTimeout(() => resolve([]), CURRENT_DEVICE_ORIGIN_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  rememberedCurrentDeviceStepOrigins = resolveCurrentDeviceStepOrigins(
    [...rememberedCurrentDeviceStepOrigins, ...(origins ?? [])],
    [],
  );
  return rememberedCurrentDeviceStepOrigins;
}

function rememberCurrentDeviceStepOrigins(observedOrigins: readonly unknown[]) {
  rememberedCurrentDeviceStepOrigins = resolveCurrentDeviceStepOrigins(
    rememberedCurrentDeviceStepOrigins,
    observedOrigins,
  );
  return rememberedCurrentDeviceStepOrigins;
}

function hasCurrentDeviceStepSpn(origins: readonly string[]) {
  return origins.some((origin) =>
    origin.toLowerCase().startsWith("com.android.healthconnect.phone."),
  );
}

function physicalActivityRuntimePermissionRequired() {
  return Number(Platform.Version) >= 29;
}

async function hasLocalPhoneStepPermission() {
  if (!physicalActivityRuntimePermissionRequired()) return true;
  return PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
  );
}

async function requestLocalPhoneStepPermission() {
  if (!physicalActivityRuntimePermissionRequired()) return true;
  const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
  if (await PermissionsAndroid.check(permission)) return true;
  return (
    (await PermissionsAndroid.request(permission)) ===
    PermissionsAndroid.RESULTS.GRANTED
  );
}

async function prepareLocalPhoneStepRecording() {
  const granted = await requestLocalPhoneStepPermission().catch(() => false);
  if (!granted) return;
  await androidPhoneSteps?.startLocalPhoneStepRecording?.().catch(
    () => false,
  );
}

async function readLocalPhoneSteps(from: Date, to: Date) {
  if (
    !androidPhoneSteps?.readLocalPhoneSteps ||
    !(await hasLocalPhoneStepPermission())
  )
    return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const count = await Promise.race([
    androidPhoneSteps
      .readLocalPhoneSteps(from.getTime(), to.getTime())
      .catch(() => null),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), LOCAL_PHONE_STEP_READ_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  return count &&
    Number.isFinite(count.count) &&
    count.count >= 0 &&
    Number.isFinite(count.coverageStartEpochMs)
    ? count
    : null;
}

const RECORD_TYPES: Record<HealthDataType, string> = {
  steps: "Steps",
  active_energy: "ActiveCaloriesBurned",
  total_energy: "TotalCaloriesBurned",
  weight: "Weight",
  nutrition: "Nutrition",
  water: "Hydration",
  workouts: "ExerciseSession",
  body_fat: "BodyFat",
  lean_body_mass: "LeanBodyMass",
  body_water_mass: "BodyWaterMass",
  bone_mass: "BoneMass",
  blood_pressure: "BloodPressure",
  heart_rate: "HeartRate",
  sleep: "SleepSession",
  blood_glucose: "BloodGlucose",
  menstruation: "MenstruationPeriod",
};

function recordTypesFor(dataTypes: HealthDataType[]) {
  return [
    ...new Set(
      dataTypes.flatMap((type) =>
        type === "workouts"
          ? [
              "ExerciseSession",
              "Distance",
              "ActiveCaloriesBurned",
              "TotalCaloriesBurned",
            ]
          : type === "active_energy"
            ? [
                "ActiveCaloriesBurned",
                "TotalCaloriesBurned",
                "ExerciseSession",
              ]
            : [RECORD_TYPES[type]],
      ),
    ),
  ];
}

const EXERCISE_NAMES: Record<number, string> = {
  0: "Workout",
  2: "Badminton",
  4: "Baseball",
  5: "Basketball",
  8: "Cycling",
  9: "Indoor cycling",
  10: "Boot camp",
  11: "Boxing",
  13: "Calisthenics",
  14: "Cricket",
  16: "Dancing",
  25: "Elliptical",
  26: "Exercise class",
  27: "Fencing",
  28: "American football",
  31: "Frisbee",
  32: "Golf",
  34: "Gymnastics",
  35: "Handball",
  36: "HIIT",
  37: "Hiking",
  38: "Ice hockey",
  39: "Ice skating",
  44: "Martial arts",
  46: "Paddling",
  48: "Pilates",
  50: "Racquetball",
  51: "Rock climbing",
  53: "Rowing",
  54: "Rowing machine",
  55: "Rugby",
  56: "Running",
  57: "Treadmill running",
  58: "Sailing",
  60: "Skating",
  61: "Skiing",
  62: "Snowboarding",
  63: "Snowshoeing",
  64: "Football",
  65: "Softball",
  66: "Squash",
  68: "Stair climbing",
  69: "Stair machine",
  70: "Strength training",
  71: "Stretching",
  72: "Surfing",
  73: "Open-water swimming",
  74: "Pool swimming",
  75: "Table tennis",
  76: "Tennis",
  78: "Volleyball",
  79: "Walking",
  80: "Water polo",
  81: "Weightlifting",
  82: "Wheelchair",
  83: "Yoga",
};

const MEAL_NAMES: Record<number, NutritionDetails["mealType"]> = {
  1: "breakfast",
  2: "lunch",
  3: "dinner",
  4: "snack",
};

function workoutLabel(record: Record<string, unknown>) {
  const code = Number(record.exerciseType);
  const title = String(record.title ?? "").trim();
  if (title && !/^\d+$/.test(title) && title !== String(record.exerciseType))
    return title;
  const canonical = healthConnectSessionExercise(code);
  return (
    canonical?.name ??
    EXERCISE_NAMES[code] ??
    (Number.isFinite(code) ? `Workout (${code})` : "Workout")
  );
}

function workoutActivity(record: Record<string, unknown>) {
  const title = String(record.title ?? "").trim();
  return (
    exerciseFromActivityName(title) ??
    healthConnectSessionExercise(Number(record.exerciseType))
  );
}

function workoutSegmentImports(
  record: Record<string, unknown>,
  session: HealthImportRecord,
) {
  const segments = Array.isArray(record.segments)
    ? (record.segments as Record<string, unknown>[])
    : [];
  return segments.flatMap((segment, index): HealthImportRecord[] => {
    const segmentType = Number(segment.segmentType);
    if (!Number.isFinite(segmentType)) return [];
    const startTime = String(segment.startTime ?? session.startTime);
    const endTime = String(segment.endTime ?? startTime);
    const durationMinutes = Math.max(
      0,
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000,
    );
    const repetitions = Number(segment.repetitions ?? 0);
    const exercise = healthConnectSegmentExercise(segmentType);
    return [
      {
        id: `${session.id}:segment:${index}`,
        provider: "health_connect",
        type: "workouts",
        startTime,
        endTime,
        value:
          Number.isFinite(repetitions) && repetitions > 0 ? repetitions : 0,
        unit: "reps",
        origin: session.origin,
        updatedAt: session.updatedAt,
        label: exercise?.name ?? `Exercise segment (${segmentType})`,
        activityKey: exercise?.key,
        workoutRecordKind: "segment",
        measurements: { durationMinutes },
      },
    ];
  });
}

function nestedNumber(value: unknown, ...keys: string[]) {
  let current: unknown = value;
  for (const key of keys)
    current =
      typeof current === "object" && current
        ? (current as Record<string, unknown>)[key]
        : undefined;
  const parsed = Number(current);
  return Number.isFinite(parsed) ? parsed : 0;
}

function origin(record: Record<string, unknown>) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(metadata?.dataOrigin ?? "Health Connect");
}

function recordId(record: Record<string, unknown>, type: HealthDataType) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(
    metadata?.id ??
      metadata?.clientRecordId ??
      `${type}:${record.startTime}:${record.endTime}`,
  );
}

function recordDuration(record: Record<string, unknown>) {
  return Math.max(
    0,
    new Date(String(record.endTime)).getTime() -
      new Date(String(record.startTime)).getTime(),
  );
}

function individualIntervals(records: Record<string, unknown>[]) {
  return records.filter((candidate) => {
    const duration = recordDuration(candidate);
    return !records.some(
      (other) =>
        other !== candidate &&
        origin(other) === origin(candidate) &&
        recordDuration(other) < duration &&
        String(other.startTime) >= String(candidate.startTime) &&
        String(other.endTime) <= String(candidate.endTime),
    );
  });
}

function sourcePriority(source: string, kind: "activity" | "nutrition") {
  const normalized = source.toLowerCase();
  if (kind === "nutrition" && normalized.includes("myfitnesspal")) return 0;
  if (kind === "nutrition") {
    // Samsung/Health Connect often re-publish entries originally written by a
    // dedicated food logger. Prefer the originating food app when both exist.
    if (normalized.includes("samsung") || normalized.includes("shealth")) return 8;
    if (normalized.includes("healthconnect.phone")) return 9;
    return 1;
  }
  if (normalized.includes("samsung") || normalized.includes("shealth")) return 1;
  if (
    normalized.includes("healthconnect.phone") ||
    normalized.includes("com.google.android.apps.healthdata")
  )
    return 9;
  return 3;
}

function nutritionEquivalent(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const clean = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const leftName = clean(left.name ?? left.mealName);
  const rightName = clean(right.name ?? right.mealName);
  if (leftName && rightName && leftName !== rightName && !leftName.includes(rightName) && !rightName.includes(leftName))
    return false;
  const a = nutrition(left);
  const b = nutrition(right);
  const pairs = [[a.proteinG, b.proteinG], [a.carbsG, b.carbsG], [a.fatG, b.fatG]] as const;
  const present = pairs.filter(([x, y]) => Number(x) > 0 || Number(y) > 0);
  return !present.length || present.every(([x, y]) => Math.abs(Number(x) - Number(y)) <= Math.max(1, Number(x) * 0.08));
}

function intervalSimilarity(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const leftStart = new Date(String(left.startTime ?? left.time)).getTime();
  const rightStart = new Date(String(right.startTime ?? right.time)).getTime();
  const leftEnd = new Date(String(left.endTime ?? left.time)).getTime();
  const rightEnd = new Date(String(right.endTime ?? right.time)).getTime();
  if (![leftStart, rightStart, leftEnd, rightEnd].every(Number.isFinite))
    return false;
  const startClose = Math.abs(leftStart - rightStart) <= 2 * 60 * 1000;
  const endClose = Math.abs(leftEnd - rightEnd) <= 2 * 60 * 1000;
  const overlap = Math.max(
    0,
    Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
  );
  const shorter = Math.max(1, Math.min(leftEnd - leftStart, rightEnd - rightStart));
  return (startClose && endClose) || overlap / shorter >= 0.9;
}

function dedupeCrossSource(
  records: Record<string, unknown>[],
  kind: "activity" | "nutrition",
  value: (record: Record<string, unknown>) => number,
) {
  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    const day = String(record.startTime ?? record.time ?? "").slice(0, 10);
    const group = byDay.get(day);
    if (group) group.push(record);
    else byDay.set(day, [record]);
  }
  return [...byDay.values()].flatMap((group) => {
    const chosen: Record<string, unknown>[] = [];
    for (const record of group) {
      const duplicateIndex = chosen.findIndex(
        (candidate) =>
          origin(candidate) !== origin(record) &&
          intervalSimilarity(candidate, record) &&
          (kind === "activity" ||
            (Math.abs(value(candidate) - value(record)) <=
              Math.max(2, Math.abs(value(candidate)) * 0.08) &&
              nutritionEquivalent(candidate, record))),
      );
      if (duplicateIndex < 0) {
        chosen.push(record);
        continue;
      }
      const current = chosen[duplicateIndex];
      if (
        sourcePriority(origin(record), kind) <
        sourcePriority(origin(current), kind)
      )
        chosen[duplicateIndex] = record;
    }
    return chosen;
  });
}

function overlaps(record: Record<string, unknown>, start: string, end: string) {
  return String(record.endTime) > start && String(record.startTime) < end;
}

function fitbitEnergyIsWorkoutScoped(
  energy: Record<string, unknown>,
  workouts: readonly Record<string, unknown>[],
) {
  if (!isFitbitEnergyOrigin(origin(energy))) return true;
  const energyStart = new Date(String(energy.startTime)).getTime();
  const energyEnd = new Date(String(energy.endTime)).getTime();
  if (![energyStart, energyEnd].every(Number.isFinite)) return false;
  return workouts.some((workout) => {
    if (origin(workout) !== origin(energy)) return false;
    const workoutStart = new Date(String(workout.startTime)).getTime();
    const workoutEnd = new Date(String(workout.endTime)).getTime();
    if (![workoutStart, workoutEnd].every(Number.isFinite)) return false;
    const tolerance = 5 * 60_000;
    return (
      Math.abs(energyStart - workoutStart) <= tolerance &&
      Math.abs(energyEnd - workoutEnd) <= tolerance
    );
  });
}

function nutrition(record: Record<string, unknown>): NutritionDetails {
  const optionalNested = (...keys: string[]) => {
    let current: unknown = record;
    for (const key of keys)
      current =
        typeof current === "object" && current
          ? (current as Record<string, unknown>)[key]
          : undefined;
    if (current === undefined || current === null || current === "")
      return undefined;
    const parsed = Number(current);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const mass = (field: string, unit: "g" | "mg" | "mcg") => {
    const grams = optionalNested(field, "inGrams");
    const milligrams = optionalNested(field, "inMilligrams");
    const micrograms = optionalNested(field, "inMicrograms");
    const value =
      unit === "g"
        ? (grams ??
          (milligrams === undefined ? undefined : milligrams / 1000) ??
          (micrograms === undefined ? undefined : micrograms / 1_000_000))
        : unit === "mg"
          ? (milligrams ??
            (grams === undefined ? undefined : grams * 1000) ??
            (micrograms === undefined ? undefined : micrograms / 1000))
          : (micrograms ??
            (milligrams === undefined ? undefined : milligrams * 1000) ??
            (grams === undefined ? undefined : grams * 1_000_000));
    if (value === undefined) return undefined;
    const precision = unit === "mcg" ? 100 : 1000;
    return Math.round(value * precision) / precision;
  };
  return {
    mealType: MEAL_NAMES[Number(record.mealType)],
    proteinG: mass("protein", "g"),
    fatG: mass("totalFat", "g"),
    carbsG: mass("totalCarbohydrate", "g"),
    fiberG: mass("dietaryFiber", "g"),
    sodiumMg: mass("sodium", "mg"),
    sugarG: mass("sugar", "g"),
    saturatedFatG: mass("saturatedFat", "g"),
    cholesterolMg: mass("cholesterol", "mg"),
    potassiumMg: mass("potassium", "mg"),
    calciumMg: mass("calcium", "mg"),
    ironMg: mass("iron", "mg"),
    magnesiumMg: mass("magnesium", "mg"),
    vitaminCMg: mass("vitaminC", "mg"),
    vitaminDMcg: mass("vitaminD", "mcg"),
    vitaminB12Mcg: mass("vitaminB12", "mcg"),
    transFatG: mass("transFat", "g"),
    monounsaturatedFatG: mass("monounsaturatedFat", "g"),
    polyunsaturatedFatG: mass("polyunsaturatedFat", "g"),
    phosphorusMg: mass("phosphorus", "mg"),
    zincMg: mass("zinc", "mg"),
    copperMg: mass("copper", "mg"),
    manganeseMg: mass("manganese", "mg"),
    seleniumMcg: mass("selenium", "mcg"),
    iodineMcg: mass("iodine", "mcg"),
    vitaminAMcg: mass("vitaminA", "mcg"),
    vitaminEMg: mass("vitaminE", "mg"),
    vitaminKMcg: mass("vitaminK", "mcg"),
    thiaminMg: mass("thiamin", "mg"),
    riboflavinMg: mass("riboflavin", "mg"),
    niacinMg: mass("niacin", "mg"),
    pantothenicAcidMg: mass("pantothenicAcid", "mg"),
    vitaminB6Mg: mass("vitaminB6", "mg"),
    folateMcg: mass("folate", "mcg"),
    folicAcidMcg: mass("folicAcid", "mcg"),
    caffeineMg: mass("caffeine", "mg"),
    biotinMcg: mass("biotin", "mcg"),
    chlorideMg: mass("chloride", "mg"),
    chromiumMcg: mass("chromium", "mcg"),
    molybdenumMcg: mass("molybdenum", "mcg"),
  };
}

function convert(
  type: HealthDataType,
  record: Record<string, unknown>,
): HealthImportRecord {
  const startTime = String(
    record.startTime ?? record.time ?? new Date().toISOString(),
  );
  const endTime = String(record.endTime ?? record.time ?? startTime);
  let value: number | boolean = 0;
  let unit = "";
  if (type === "steps") {
    value = Number(record.count ?? 0);
    unit = "steps";
  }
  if (type === "active_energy" || type === "total_energy") {
    value =
      nestedNumber(record, "energy", "inKilocalories") ||
      nestedNumber(record, "energy", "inCalories") / 1000 ||
      nestedNumber(record, "totalEnergyBurned", "inKilocalories") ||
      Number(record.activeCalories ?? 0);
    unit = "kcal";
  }
  if (type === "weight") {
    value = nestedNumber(record, "weight", "inKilograms");
    unit = "kg";
  }
  if (type === "nutrition") {
    value =
      nestedNumber(record, "energy", "inKilocalories") ||
      nestedNumber(record, "energy", "inCalories") / 1000 ||
      Number(record.calories ?? 0);
    unit = "kcal";
  }
  if (type === "water") {
    value =
      nestedNumber(record, "volume", "inLiters") ||
      nestedNumber(record, "volume", "inMilliliters") / 1000 ||
      Number(record.liters ?? 0);
    unit = "L";
  }
  const durationMinutes = Math.max(
    0,
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000,
  );
  if (type === "workouts") {
    value = durationMinutes || 1;
    unit = "min";
  }
  if (type === "body_fat") {
    value = Number(record.percentage ?? 0);
    unit = "%";
  }
  if (type === "lean_body_mass") {
    value = nestedNumber(record, "mass", "inKilograms");
    unit = "kg";
  }
  if (type === "body_water_mass" || type === "bone_mass") {
    value = nestedNumber(record, "mass", "inKilograms");
    unit = "kg";
  }
  if (type === "blood_pressure") {
    value = nestedNumber(record, "systolic", "inMillimetersOfMercury");
    unit = "mmHg";
  }
  if (type === "heart_rate") {
    const samples = Array.isArray(record.samples)
      ? (record.samples as Record<string, unknown>[])
      : [];
    const readings = samples
      .map((sample) => Number(sample.beatsPerMinute))
      .filter((reading) => Number.isFinite(reading) && reading > 0);
    value = Number(
      record.beatsPerMinute ??
        (readings.length
          ? readings.reduce((sum, reading) => sum + reading, 0) /
            readings.length
          : 0),
    );
    unit = "bpm";
  }
  if (type === "sleep") {
    value = durationMinutes / 60;
    unit = "hr";
  }
  if (type === "blood_glucose") {
    value =
      nestedNumber(record, "level", "inMilligramsPerDeciliter") ||
      nestedNumber(record, "level", "inMillimolesPerLiter") * 18.0182;
    unit = "mg/dL";
  }
  if (type === "menstruation") {
    value = true;
    unit = "";
  }
  const metadata = record.metadata as Record<string, unknown> | undefined;
  const workout = type === "workouts" ? workoutActivity(record) : undefined;
  return {
    id: recordId(record, type),
    provider: "health_connect",
    type,
    startTime,
    endTime,
    value,
    unit,
    origin: origin(record),
    updatedAt:
      typeof metadata?.lastModifiedTime === "string"
        ? metadata.lastModifiedTime
        : undefined,
    label:
      type === "nutrition"
        ? String(
            record.name ??
              record.mealName ??
              (MEAL_NAMES[Number(record.mealType)]
                ? `${MEAL_NAMES[Number(record.mealType)]} meal`
                : "Meal summary"),
          )
        : type === "workouts"
          ? workoutLabel(record)
          : undefined,
    activityKey: workout?.key,
    workoutRecordKind: type === "workouts" ? "session" : undefined,
    nutrition: type === "nutrition" ? nutrition(record) : undefined,
    note: typeof record.notes === "string" ? record.notes : undefined,
    measurements:
      type === "workouts"
        ? {
            durationMinutes,
            activeCalories:
              nestedNumber(record, "energy", "inKilocalories") ||
              nestedNumber(record, "totalEnergyBurned", "inKilocalories"),
            distanceKm:
              nestedNumber(record, "distance", "inKilometers") ||
              nestedNumber(record, "distance", "inMeters") / 1000,
          }
        : type === "sleep"
          ? { durationMinutes }
          : type === "blood_pressure"
            ? {
                systolic: nestedNumber(
                  record,
                  "systolic",
                  "inMillimetersOfMercury",
                ),
                diastolic: nestedNumber(
                  record,
                  "diastolic",
                  "inMillimetersOfMercury",
                ),
              }
            : undefined,
  };
}

export const healthConnectAdapter: HealthAdapter = {
  provider: "health_connect",
  availability: async () => {
    const available = await initialize().catch(() => false);
    return {
      available,
      provider: "health_connect",
      title: "Health Connect",
      detail:
        "Imports Android health data from compatible sources such as Samsung Health, Google Fit, and MyFitnessPal.",
    };
  },
  grantedConnectionState: async (dataTypes) => {
    const relevantRecordTypes = new Set(recordTypesFor(dataTypes));
    const granted = await getGrantedPermissions();
    return {
      connected: granted.some(
        (permission) =>
          permission.accessType === "read" &&
          relevantRecordTypes.has(permission.recordType),
      ),
      backgroundAccess: granted.some(
        (permission) =>
          permission.accessType === "read" &&
          permission.recordType === "BackgroundAccessPermission",
      ),
    };
  },
  requestPermissions: async (dataTypes, backgroundAccess) => {
    const recordTypes = recordTypesFor(dataTypes);
    const base = recordTypes.map((recordType) => ({
      accessType: "read" as const,
      recordType,
    }));
    const history = {
      accessType: "read" as const,
      recordType: "ReadHealthDataHistory" as const,
    };
    if (!base.length)
      throw new Error("Choose at least one health data category.");
    if (backgroundAccess) {
      try {
        await requestPermission([
          ...base,
          history,
          { accessType: "read", recordType: "BackgroundAccessPermission" },
        ]);
        if (dataTypes.includes("steps"))
          await prepareLocalPhoneStepRecording();
        return;
      } catch {
        // Some devices expose normal records but not the optional background feature.
      }
    }
    try {
      await requestPermission([...base, history]);
    } catch {
      // Android versions before extended-history permission still support the
      // standard Health Connect read window.
      await requestPermission(base);
    }
    if (dataTypes.includes("steps"))
      await prepareLocalPhoneStepRecording();
  },
  prepareCurrentDaySteps: prepareLocalPhoneStepRecording,
  disconnect: async () => {
    await androidPhoneSteps?.stopLocalPhoneStepRecording?.().catch(() => false);
  },
  read: async ({
    from,
    to,
    dataTypes,
    sourcePreferences,
    liveStepSources,
    liveStepCombination,
  }) => {
    const options = {
      timeRangeFilter: {
        operator: "between",
        startTime: from.toISOString(),
        endTime: to.toISOString(),
      },
      ascendingOrder: true,
      pageSize: 5000,
    };
    const failures: string[] = [];
    let successfulReads = 0;
    const readPages = async (
      recordType: string,
      readOptions: typeof options = options,
    ) => {
      const records: Record<string, unknown>[] = [];
      let pageToken: string | undefined;
      let page = 0;
      do {
        const result = await readRecords(recordType, {
          ...readOptions,
          ...(pageToken ? { pageToken } : {}),
        });
        records.push(...(result.records as Record<string, unknown>[]));
        pageToken = result.pageToken;
        page += 1;
      } while (pageToken && page < 50);
      return records;
    };
    const readSafe = async (recordType: string) => {
      try {
        const records = await readPages(recordType);
        successfulReads += 1;
        return records;
      } catch (error) {
        failures.push(`${recordType}: ${error instanceof Error ? error.message : "permission or provider error"}`);
        return [];
      }
    };
    const discoverCurrentDeviceStepOriginsFromRaw = async (
      start: Date,
      end: Date,
    ) => {
      const observed: string[] = [];
      let pageToken: string | undefined;
      // This is origin discovery, not a data import. A small newest-first cap
      // prevents an unusually busy Health Connect store from creating JS work
      // on the interaction lane merely to find one stable phone SPN.
      for (let page = 0; page < 3; page += 1) {
        const result = await readRecords("Steps", {
          timeRangeFilter: {
            operator: "between",
            startTime: start.toISOString(),
            endTime: end.toISOString(),
          },
          ascendingOrder: false,
          pageSize: 500,
          ...(pageToken ? { pageToken } : {}),
        });
        observed.push(
          ...(result.records as Record<string, unknown>[]).map(origin),
        );
        const resolved = resolveCurrentDeviceStepOrigins([], observed);
        if (hasCurrentDeviceStepSpn(resolved)) return resolved;
        pageToken = result.pageToken;
        if (!pageToken) break;
      }
      return resolveCurrentDeviceStepOrigins([], observed);
    };
    const readSamsungDailyStepSummaries = async (
      start: Date,
      endExclusive: Date,
    ) => {
      const records: Record<string, unknown>[] = [];
      let pageToken: string | undefined;
      // Samsung normally exposes only one full-day row per date. Read the
      // selected repair/current range once, rather than issuing one bridge
      // call per historical day. The high defensive page cap still bounds a
      // corrupt provider that retained thousands of replaced revisions.
      for (let page = 0; page < 16; page += 1) {
        const result = await readRecords("Steps", {
          timeRangeFilter: {
            operator: "between",
            startTime: start.toISOString(),
            endTime: endExclusive.toISOString(),
          },
          dataOriginFilter: [SAMSUNG_HEALTH_STEP_ORIGIN],
          ascendingOrder: false,
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {}),
        });
        records.push(...(result.records as Record<string, unknown>[]));
        pageToken = result.pageToken;
        if (!pageToken) break;
      }
      const candidates = records.map((record) => {
        const metadata = record.metadata as
          | Record<string, unknown>
          | undefined;
        return {
          count: Number(record.count ?? 0),
          startTime: String(record.startTime ?? ""),
          endTime: String(record.endTime ?? ""),
          lastModifiedTime: metadata?.lastModifiedTime
            ? String(metadata.lastModifiedTime)
            : undefined,
        };
      });
      const candidateBuckets = new Map<string, typeof candidates>();
      for (const candidate of candidates) {
        const candidateStart = new Date(candidate.startTime);
        if (Number.isNaN(candidateStart.getTime())) continue;
        const key = `${candidateStart.getFullYear()}-${String(candidateStart.getMonth() + 1).padStart(2, "0")}-${String(candidateStart.getDate()).padStart(2, "0")}`;
        const bucket = candidateBuckets.get(key);
        if (bucket) bucket.push(candidate);
        else candidateBuckets.set(key, [candidate]);
      }
      const totals = new Map<string, number>();
      let dayStart = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        0,
        0,
        0,
        0,
      );
      while (dayStart < endExclusive) {
        const localDate = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
        const nextDayStart = new Date(
          dayStart.getFullYear(),
          dayStart.getMonth(),
          dayStart.getDate() + 1,
          0,
          0,
          0,
          0,
        );
        const count = samsungDailySummaryStepCount(
          candidateBuckets.get(localDate) ?? [],
          dayStart,
          nextDayStart,
        );
        if (count !== null) totals.set(localDate, count);
        dayStart = nextDayStart;
      }
      return totals;
    };
    const enabledRecords = (records: Record<string, unknown>[]) =>
      records.filter((record) =>
        healthSourceEnabled(origin(record), sourcePreferences),
      );
    const needsWorkoutDetails = dataTypes.includes("workouts");
    const needsWorkoutNames =
      needsWorkoutDetails || dataTypes.includes("active_energy");
    const rawActiveCalorieRecords =
      dataTypes.includes("active_energy") || needsWorkoutDetails
        ? dedupeCrossSource(
            individualIntervals(enabledRecords(await readSafe("ActiveCaloriesBurned"))),
            "activity",
            (record) => nestedNumber(record, "energy", "inKilocalories"),
          )
        : [];
    // Samsung maps exercise calories to TotalCaloriesBurned. Keep the raw
    // source/session intervals for the conservative Samsung-only classifier
    // below; the ordinary total-energy tracker still uses the platform's
    // priority-aware daily aggregate.
    const rawTotalCalorieRecords =
      dataTypes.includes("active_energy") ||
      dataTypes.includes("total_energy") ||
      needsWorkoutDetails
        ? individualIntervals(
            enabledRecords(await readSafe("TotalCaloriesBurned")),
          )
        : [];
    const totalEnergyImports: HealthImportRecord[] = [];
    if (dataTypes.includes("total_energy")) {
      try {
        const groups = await aggregateGroupByPeriod({
          recordType: "TotalCaloriesBurned",
          timeRangeFilter: {
            operator: "between",
            startTime: from.toISOString(),
            endTime: to.toISOString(),
          },
          timeRangeSlicer: { period: "DAYS", length: 1 },
        });
        successfulReads += 1;
        for (const group of groups) {
          const result = group.result as unknown as Record<string, unknown>;
          const energy = nestedNumber(result, "ENERGY_TOTAL", "inKilocalories");
          if (!(energy > 0)) continue;
          const localDate = group.startTime.slice(0, 10);
          const sources = Array.isArray(result.dataOrigins)
            ? result.dataOrigins.map(String).filter(Boolean)
            : [];
          const end = new Date(group.endTime);
          totalEnergyImports.push({
            id: `aggregate:total-energy:${localDate}`,
            provider: "health_connect",
            type: "total_energy",
            startTime: group.startTime,
            endTime: Number.isNaN(end.getTime())
              ? group.endTime
              : new Date(end.getTime() - 1).toISOString(),
            localDate,
            value: energy,
            unit: "kcal",
            origin: sources.length === 1 ? sources[0] : "Health Connect",
            sourceOrigins: sources,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        failures.push(
          `TotalCaloriesBurned: ${error instanceof Error ? error.message : "permission or provider error"}`,
        );
      }
    }
    const distanceRecords = needsWorkoutDetails
      ? dedupeCrossSource(
          individualIntervals(enabledRecords(await readSafe("Distance"))),
          "activity",
          (record) =>
            nestedNumber(record, "distance", "inKilometers") ||
            nestedNumber(record, "distance", "inMeters") / 1000,
        )
      : [];
    const workoutRecords = needsWorkoutNames
      ? dedupeCrossSource(
          enabledRecords(await readSafe("ExerciseSession")),
          "activity",
          (record) => recordDuration(record) / 60000,
        )
      : [];
    // FitbitMobile can publish frequent BMR/total-energy increments under the
    // ActiveCaloriesBurned record type. Only accept a Fitbit row here when it
    // has the same boundaries as an actual Fitbit exercise session; its
    // all-day energy still arrives through TotalCaloriesBurned above.
    const activeCalorieRecords = rawActiveCalorieRecords.filter((record) =>
      fitbitEnergyIsWorkoutScoped(record, workoutRecords),
    );
    const convertedWorkoutSessions = workoutRecords.map((record) =>
      convert("workouts", record),
    );
    const convertedActiveEnergy = activeCalorieRecords.map((record) => {
      const converted = convert("active_energy", record);
      const matchingWorkout = workoutRecords.find(
        (workout) =>
          overlaps(workout, converted.startTime, converted.endTime) &&
          origin(workout) === origin(record),
      ) ?? workoutRecords.find((workout) =>
        overlaps(workout, converted.startTime, converted.endTime),
      );
      return matchingWorkout
        ? {
            ...converted,
            label: workoutLabel(matchingWorkout),
            activityKey: workoutActivity(matchingWorkout)?.key,
          }
        : converted;
    });
    const samsungWorkoutEnergy = samsungWorkoutEnergyRecords(
      rawTotalCalorieRecords.map((record) => convert("total_energy", record)),
      convertedWorkoutSessions,
      convertedActiveEnergy,
    );
    const activeEnergyImports = [
      ...samsungWorkoutEnergy.activeEnergyRecords,
      ...samsungWorkoutEnergy.workoutEnergyRecords,
    ];
    const workoutImports = workoutRecords.flatMap((record) => {
      const converted = convert("workouts", record);
      const start = String(record.startTime);
      const end = String(record.endTime);
      const source = origin(record);
      const matching = (items: Record<string, unknown>[]) => {
        const overlapping = items.filter((item) => overlaps(item, start, end));
        const sameSource = overlapping.filter((item) => origin(item) === source);
        return sameSource.length ? sameSource : overlapping;
      };
      const matchingEnergy = activeEnergyImports.filter(
        (item) =>
          item.endTime > start &&
          item.startTime < end &&
          item.origin === source,
      );
      const calories = matchingEnergy.reduce(
        (sum, item) => sum + Number(item.value || 0),
        0,
      );
      const distance = matching(distanceRecords).reduce(
        (sum, item) =>
          sum +
          (nestedNumber(item, "distance", "inKilometers") ||
            nestedNumber(item, "distance", "inMeters") / 1000),
        0,
      );
      const activeCalories =
        calories || converted.measurements?.activeCalories || 0;
      const distanceKm = distance || converted.measurements?.distanceKm || 0;
      const details = [
        converted.measurements?.durationMinutes
          ? `${Math.round(converted.measurements.durationMinutes)} min`
          : undefined,
        distanceKm ? `${Math.round(distanceKm * 100) / 100} km` : undefined,
        activeCalories ? `${Math.round(activeCalories)} kcal` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      const session: HealthImportRecord = {
        ...converted,
        note: [converted.note, details].filter(Boolean).join(" · ") || undefined,
        measurements: {
          ...converted.measurements,
          activeCalories,
          distanceKm,
        },
      };
      return [session, ...workoutSegmentImports(record, session)];
    });
    for (const workout of workoutImports) {
      if (workout.workoutRecordKind !== "session") continue;
      const calories = workout.measurements?.activeCalories ?? 0;
      if (
        calories > 0 &&
        !activeEnergyImports.some((energy) =>
          healthEnergyRecordCoversWorkout(energy, workout),
        )
      ) {
        activeEnergyImports.push({
          ...workout,
          id: `workout-energy:${workout.id}`,
          type: "active_energy",
          value: calories,
          unit: "kcal",
        });
      }
    }
    const results = await Promise.all(
      dataTypes.map(async (type) => {
        try {
          if (type === "active_energy") return activeEnergyImports;
          if (type === "total_energy") return totalEnergyImports;
          if (type === "workouts") return workoutImports;
          if (type === "steps") {
            // Use one timestamp for range partitioning, the query end, and the
            // imported revision. Crossing midnight between separate `now`
            // calls must not attach a total to the wrong local day.
            const stepReadAt = new Date();
            const syncRevision = stepReadAt.toISOString();
            const stepRange = localCalendarAggregateRange(from, to, stepReadAt);
            const stepSlices = partitionStepAggregateRange(
              stepRange,
              stepReadAt,
            );
            const stepTimeRangeFilter = {
              operator: "between" as const,
              startTime: stepRange.from.toISOString(),
              endTime: stepRange.to.toISOString(),
            };
            // Samsung devices use Samsung Health's full-day summary row for
            // both completed days and today. It is the single phone+watch
            // total displayed by Samsung Health itself. Other Android devices
            // retain Health Connect's priority-aware historical aggregate.
            // Today additionally reads unfiltered Health Connect,
            // Android on-device, and Local Recording as independent complete
            // midnight-to-now candidates. The user's device-local combination
            // setting chooses one, takes the highest, or explicitly adds them.
            // Source preferences currently apply across record types, so they
            // cannot safely filter Steps: disabling a nutrition-only writer
            // could otherwise exclude the on-device Steps writer or change the
            // platform's priority result.
            try {
              const requestedLiveStepSources = new Set(
                liveStepSources?.length
                  ? liveStepSources
                  : DEFAULT_LIVE_STEP_SOURCES,
              );
              const needsHealthConnectCurrent =
                requestedLiveStepSources.has("health_connect") ||
                requestedLiveStepSources.has("physical_activity");
              const needsSamsungCurrent =
                requestedLiveStepSources.has("samsung_health");
              const needsAndroidDeviceCurrent =
                requestedLiveStepSources.has("android_device");
              const needsPhysicalActivityCurrent =
                requestedLiveStepSources.has("physical_activity");
              const currentStart = stepSlices.current?.from;
              const currentEnd = stepSlices.current?.to;
              const includesCurrentDay = Boolean(stepSlices.current);
              const [
                unfilteredGroups,
                currentAggregate,
                samsungDailyTotals,
                localPhoneSlice,
                discoveredDeviceOrigins,
              ] =
                await Promise.all([
                  stepSlices.historical
                    ? aggregateGroupByPeriod({
                        recordType: "Steps",
                        timeRangeFilter: {
                          ...stepTimeRangeFilter,
                          endTime: stepSlices.historical.to.toISOString(),
                        },
                        timeRangeSlicer: { period: "DAYS", length: 1 },
                      })
                    : Promise.resolve([]),
                  includesCurrentDay && needsHealthConnectCurrent
                    ? aggregateRecord({
                        recordType: "Steps",
                        timeRangeFilter: {
                          operator: "between",
                          startTime: currentStart!.toISOString(),
                          endTime: currentEnd!.toISOString(),
                        },
                      })
                    : Promise.resolve(null),
                  needsSamsungCurrent
                    ? (async () => {
                        const samsungEnd = includesCurrentDay
                          ? new Date(
                              currentStart!.getFullYear(),
                              currentStart!.getMonth(),
                              currentStart!.getDate() + 1,
                              0,
                              0,
                              0,
                              0,
                            )
                          : stepRange.to;
                        return readSamsungDailyStepSummaries(
                          stepRange.from,
                          samsungEnd,
                        ).catch(() => new Map<string, number>());
                      })()
                    : Promise.resolve(new Map<string, number>()),
                  includesCurrentDay && needsPhysicalActivityCurrent
                    ? readLocalPhoneSteps(currentStart!, currentEnd!)
                    : Promise.resolve(null),
                  includesCurrentDay && needsAndroidDeviceCurrent
                    ? currentDeviceStepOrigins()
                    : Promise.resolve([]),
                ]);
              const authoritativeCurrentCount = currentAggregate
                ? Number(currentAggregate.COUNT_TOTAL ?? 0)
                : null;
              // Android 14+ exposes this phone's TYPE_STEP_COUNTER data under
              // `android` or an SPN. Query it for every open-day refresh so a
              // positive but stale cross-writer aggregate can never hide the
              // current phone total.
              let androidDeviceOrigins = rememberCurrentDeviceStepOrigins([
                ...discoveredDeviceOrigins,
                ...(currentAggregate?.dataOrigins ?? []),
              ]);
              const onDeviceHealthConnectStepsAvailable =
                androidPhoneSteps?.healthConnectOnDeviceSteps ??
                Number(Platform.Version) >= 34;
              if (
                includesCurrentDay &&
                needsAndroidDeviceCurrent &&
                onDeviceHealthConnectStepsAvailable &&
                !hasCurrentDeviceStepSpn(androidDeviceOrigins) &&
                Date.now() >= nextRawStepOriginDiscoveryAt
              ) {
                nextRawStepOriginDiscoveryAt =
                  Date.now() + STEP_ORIGIN_DISCOVERY_RETRY_MS;
                // A few framework-extension combinations omit the SPN from the
                // manager method and from a priority-resolved aggregate. A
                // bounded raw read is used only to discover that source name.
                // The source-filtered aggregate below performs the total in
                // native Health Connect without moving every interval into JS.
                const rawDeviceOrigins =
                  await discoverCurrentDeviceStepOriginsFromRaw(
                    currentStart!,
                    currentEnd!,
                  ).catch(() => []);
                androidDeviceOrigins = rememberCurrentDeviceStepOrigins(
                  rawDeviceOrigins,
                );
              }
              const androidDeviceAggregate =
                includesCurrentDay &&
                needsAndroidDeviceCurrent &&
                onDeviceHealthConnectStepsAvailable &&
                androidDeviceOrigins.length
                  ? await aggregateRecord({
                      recordType: "Steps",
                      timeRangeFilter: {
                        operator: "between",
                        startTime: currentStart!.toISOString(),
                        endTime: currentEnd!.toISOString(),
                      },
                      dataOriginFilter: androidDeviceOrigins,
                    }).catch(() => null)
                  : null;
              const contributedOrigins = [
                ...new Set(
                  [
                    ...unfilteredGroups.flatMap(
                      (group) => group.result.dataOrigins ?? [],
                    ),
                    ...(currentAggregate?.dataOrigins ?? []),
                    ...(samsungDailyTotals.size
                      ? [SAMSUNG_HEALTH_STEP_ORIGIN]
                      : []),
                    ...(androidDeviceAggregate?.dataOrigins ?? []),
                  ],
                ),
              ];
              const observedOrigins = [
                ...new Set(contributedOrigins.filter(Boolean)),
              ];
              const groups = authoritativeHealthConnectStepGroups(
                unfilteredGroups,
              );
              successfulReads += 1;
              const historicalRecords = groups.flatMap(
                (group): HealthImportRecord[] => {
                  const localDate = group.startTime.slice(0, 10);
                  const samsungCount = samsungDailyTotals.get(localDate);
                  const count = finalImportedStepTotal(
                    samsungCount ?? Number(group.result.COUNT_TOTAL ?? 0),
                  );
                  if (!(count > 0)) return [];
                  const sources = samsungCount !== undefined
                    ? [SAMSUNG_HEALTH_STEP_ORIGIN]
                    : [
                        ...new Set(
                          (group.result.dataOrigins?.length
                            ? group.result.dataOrigins
                            : observedOrigins
                          ).filter(Boolean),
                        ),
                      ].sort((a, b) => a.localeCompare(b));
                  const end = new Date(group.endTime);
                  const recordedAt = Number.isNaN(end.getTime())
                    ? group.endTime
                    : new Date(end.getTime() - 1).toISOString();
                  return [
                    {
                      id: `aggregate:steps:${localDate}`,
                      provider: "health_connect",
                      type: "steps",
                      startTime: group.startTime,
                      endTime: recordedAt,
                      localDate,
                      value: count,
                      unit: "steps",
                      origin:
                        samsungCount !== undefined
                          ? SAMSUNG_HEALTH_STEP_SOURCE
                          : sources.length === 1
                            ? sources[0]
                            : "Health Connect",
                      sourceOrigins:
                        samsungCount !== undefined ? sources : observedOrigins,
                      updatedAt: syncRevision,
                    },
                  ];
                },
              );
              const currentSlice = stepSlices.current;
              if (!currentSlice) return historicalRecords;
              const currentLocalDate = currentSlice.localDate;
              const samsungCurrentCount =
                samsungDailyTotals.get(currentLocalDate) ?? null;
              let samsungCurrentAggregate: {
                COUNT_TOTAL?: number;
                dataOrigins?: string[];
              } | null = samsungCurrentCount === null
                ? null
                : {
                    COUNT_TOTAL: samsungCurrentCount,
                    dataOrigins: [SAMSUNG_HEALTH_STEP_ORIGIN],
                  };
              if (
                samsungCurrentAggregate === null &&
                needsSamsungCurrent
              ) {
                // Older Samsung Health versions may expose only ordinary
                // interval rows. Keep a source-filtered current-day aggregate
                // as a compatibility fallback; completed days remain on the
                // platform aggregate when no full-day Samsung row exists.
                samsungCurrentAggregate = await aggregateRecord({
                  recordType: "Steps",
                  timeRangeFilter: {
                    operator: "between",
                    startTime: currentStart!.toISOString(),
                    endTime: currentEnd!.toISOString(),
                  },
                  dataOriginFilter: [SAMSUNG_HEALTH_STEP_ORIGIN],
                }).catch(() => null);
              }
              let disjointPhoneCandidate: number | null = null;
              if (localPhoneSlice) {
                const coverageStartMs = Math.min(
                  currentSlice.to.getTime(),
                  Math.max(
                    currentSlice.from.getTime(),
                    localPhoneSlice.coverageStartEpochMs,
                  ),
                );
                const prefixCount =
                  coverageStartMs <= currentSlice.from.getTime()
                    ? 0
                    : Number(
                        (
                          await aggregateRecord({
                            recordType: "Steps",
                            timeRangeFilter: {
                              operator: "between",
                              startTime: currentSlice.from.toISOString(),
                              endTime: new Date(coverageStartMs).toISOString(),
                            },
                          })
                        ).COUNT_TOTAL ?? 0,
                      );
                disjointPhoneCandidate = combineDisjointStepWindows(
                  prefixCount,
                  localPhoneSlice.count,
                );
              }
              const reconciledCurrent = reconcileCurrentDayStepTotal(
                authoritativeCurrentCount,
                disjointPhoneCandidate,
                androidDeviceAggregate
                  ? Number(androidDeviceAggregate.COUNT_TOTAL ?? 0)
                  : null,
                samsungCurrentAggregate
                  ? Number(samsungCurrentAggregate.COUNT_TOTAL ?? 0)
                  : null,
                {
                  selectedSources:
                    liveStepSources ?? DEFAULT_LIVE_STEP_SOURCES,
                  combination: liveStepCombination ?? "highest",
                },
              );
              if (reconciledCurrent.selectedSourcesUnavailable)
                throw new Error(
                  "The selected live Step sources returned no current value. Choose another source in Cloud & health sync.",
                );
              const currentCount = finalImportedStepTotal(
                reconciledCurrent.count,
              );
              const currentSources = [
                ...new Set(
                  (currentAggregate?.dataOrigins?.length
                    ? currentAggregate.dataOrigins
                    : observedOrigins
                  ).filter(Boolean),
                ),
              ].sort((a, b) => a.localeCompare(b));
              const liveCurrentSource = reconciledCurrent.combinedSources
                ? "HabHub diagnostic Step sum"
                : reconciledCurrent.usedSamsungHealth
                  ? SAMSUNG_HEALTH_STEP_SOURCE
                  : reconciledCurrent.usedLocalPhone
                    ? LOCAL_PHONE_STEP_SOURCE
                    : reconciledCurrent.usedAndroidDevice
                      ? HEALTH_CONNECT_PHONE_STEP_SOURCE
                      : undefined;
              // Preserve a successful zero as a diagnostic record. Entry
              // mapping still omits non-positive logs, while Settings can
              // distinguish a real zero from an unavailable/failed source.
              const currentRecord = {
                id: `aggregate:steps:${currentLocalDate}`,
                provider: "health_connect",
                type: "steps",
                startTime: currentSlice.from.toISOString(),
                endTime: new Date(
                  Math.max(
                    currentSlice.from.getTime(),
                    currentSlice.to.getTime() - 1,
                  ),
                ).toISOString(),
                localDate: currentLocalDate,
                value: Math.round(currentCount),
                unit: "steps",
                origin:
                  liveCurrentSource ??
                  (currentSources.length === 1
                    ? currentSources[0]
                    : "Health Connect"),
                sourceOrigins: liveCurrentSource
                  ? [
                      ...new Set([
                        ...observedOrigins,
                        liveCurrentSource,
                      ]),
                    ]
                  : observedOrigins,
                liveStepDiagnostics: reconciledCurrent.liveStepDiagnostics,
                updatedAt: syncRevision,
              } satisfies HealthImportRecord;
              return replaceCanonicalStepAggregateForDay(
                historicalRecords,
                currentLocalDate,
                currentRecord,
              );
            } catch (error) {
              // Raw Steps records can overlap across phone, watch, Samsung,
              // Google Fit, and Health Connect's on-device writer. Returning a
              // implicit guessed sum would be worse than retaining the last
              // confirmed aggregate. Explicit diagnostic Sum is handled only
              // after successful candidates are read above.
              throw new Error(
                `Steps aggregate: ${error instanceof Error ? error.message : "Health Connect aggregation failed"}`,
              );
            }
          }
          const rawRecords = await readSafe(RECORD_TYPES[type]);
          const records = enabledRecords(rawRecords);
          if (type === "nutrition")
            return dedupeCrossSource(
              records,
              "nutrition",
              (record) =>
                nestedNumber(record, "energy", "inKilocalories") ||
                nestedNumber(record, "energy", "inCalories") / 1000 ||
                Number(record.calories ?? 0),
            ).map((record) => convert(type, record));
          return records.map((record) => convert(type, record));
        } catch (error) {
          if (type === "steps") throw error;
          // A vendor may not expose every requested record type. Keep the other
          // categories syncing instead of failing the entire refresh.
          return [];
        }
      }),
    );
    if (!successfulReads && failures.length) {
      throw new Error(`Health Connect could not read the selected data. Open Health Connect permissions and try again. ${failures[0]}`);
    }
    return results.flat();
  },
  openSettings: openHealthConnectSettings,
};
