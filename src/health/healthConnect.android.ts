import {
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from "react-native-health-connect";

import { HealthAdapter, HealthImportRecord } from "@/src/health/types";
import { HealthDataType, NutritionDetails } from "@/src/types";

const RECORD_TYPES: Record<HealthDataType, string> = {
  steps: "Steps",
  active_energy: "TotalCaloriesBurned",
  weight: "Weight",
  nutrition: "Nutrition",
  water: "Hydration",
  workouts: "ExerciseSession",
  body_fat: "BodyFat",
  lean_body_mass: "LeanBodyMass",
  blood_pressure: "BloodPressure",
  heart_rate: "HeartRate",
  sleep: "SleepSession",
  blood_glucose: "BloodGlucose",
  menstruation: "MenstruationPeriod",
};

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
  return (
    EXERCISE_NAMES[code] ??
    (Number.isFinite(code) ? `Workout (${code})` : "Workout")
  );
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
    if (duration >= 6 * 60 * 60 * 1000) return false; // Samsung's running daily total includes resting metabolism.
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
  const chosen: Record<string, unknown>[] = [];
  for (const record of records) {
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
}

function overlaps(record: Record<string, unknown>, start: string, end: string) {
  return String(record.endTime) > start && String(record.startTime) < end;
}

function nutrition(record: Record<string, unknown>): NutritionDetails {
  const oneDecimal = (value: number) => Math.round(value * 10) / 10;
  return {
    mealType: MEAL_NAMES[Number(record.mealType)],
    proteinG: oneDecimal(nestedNumber(record, "protein", "inGrams")),
    fatG: oneDecimal(nestedNumber(record, "totalFat", "inGrams")),
    carbsG: oneDecimal(nestedNumber(record, "totalCarbohydrate", "inGrams")),
    fiberG: oneDecimal(nestedNumber(record, "dietaryFiber", "inGrams")),
    sodiumMg: Math.round(
      nestedNumber(record, "sodium", "inMilligrams") ||
        nestedNumber(record, "sodium", "inGrams") * 1000,
    ),
    sugarG: oneDecimal(nestedNumber(record, "sugar", "inGrams")),
    saturatedFatG: oneDecimal(nestedNumber(record, "saturatedFat", "inGrams")),
    cholesterolMg: Math.round(
      nestedNumber(record, "cholesterol", "inMilligrams"),
    ),
    potassiumMg: Math.round(nestedNumber(record, "potassium", "inMilligrams")),
    calciumMg: Math.round(nestedNumber(record, "calcium", "inMilligrams")),
    ironMg: oneDecimal(nestedNumber(record, "iron", "inMilligrams")),
    magnesiumMg: Math.round(nestedNumber(record, "magnesium", "inMilligrams")),
    vitaminCMg: oneDecimal(nestedNumber(record, "vitaminC", "inMilligrams")),
    vitaminDMcg: oneDecimal(nestedNumber(record, "vitaminD", "inMicrograms")),
    vitaminB12Mcg: oneDecimal(
      nestedNumber(record, "vitaminB12", "inMicrograms"),
    ),
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
  if (type === "active_energy") {
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
  requestPermissions: async (dataTypes, backgroundAccess) => {
    const recordTypes = [
      ...new Set(
        dataTypes.flatMap((type) =>
          type === "workouts"
            ? ["ExerciseSession", "Distance", "TotalCaloriesBurned"]
            : type === "active_energy"
              ? ["TotalCaloriesBurned", "ExerciseSession"]
            : [RECORD_TYPES[type]],
        ),
      ),
    ];
    const base = recordTypes.map((recordType) => ({
      accessType: "read" as const,
      recordType,
    }));
    if (!base.length)
      throw new Error("Choose at least one health data category.");
    if (backgroundAccess) {
      try {
        await requestPermission([
          ...base,
          { accessType: "read", recordType: "BackgroundAccessPermission" },
        ]);
        return;
      } catch {
        // Some devices expose normal records but not the optional background feature.
      }
    }
    await requestPermission(base);
  },
  read: async ({ from, to, dataTypes }) => {
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
    const readSafe = async (recordType: string) => {
      try {
        const result = await readRecords(recordType, options);
        successfulReads += 1;
        return result.records as Record<string, unknown>[];
      } catch (error) {
        failures.push(`${recordType}: ${error instanceof Error ? error.message : "permission or provider error"}`);
        return [];
      }
    };
    const needsWorkoutDetails = dataTypes.includes("workouts");
    const needsWorkoutNames =
      needsWorkoutDetails || dataTypes.includes("active_energy");
    const calorieRecords =
      dataTypes.includes("active_energy") || needsWorkoutDetails
        ? dedupeCrossSource(
            individualIntervals(await readSafe("TotalCaloriesBurned")),
            "activity",
            (record) => nestedNumber(record, "energy", "inKilocalories"),
          )
        : [];
    const distanceRecords = needsWorkoutDetails
      ? dedupeCrossSource(
          individualIntervals(await readSafe("Distance")),
          "activity",
          (record) =>
            nestedNumber(record, "distance", "inKilometers") ||
            nestedNumber(record, "distance", "inMeters") / 1000,
        )
      : [];
    const workoutRecords = needsWorkoutNames
      ? dedupeCrossSource(
          await readSafe("ExerciseSession"),
          "activity",
          (record) => recordDuration(record) / 60000,
        )
      : [];
    const workoutImports = workoutRecords.map((record) => {
      const converted = convert("workouts", record);
      const start = String(record.startTime);
      const end = String(record.endTime);
      const source = origin(record);
      const matching = (items: Record<string, unknown>[]) => {
        const overlapping = items.filter((item) => overlaps(item, start, end));
        const sameSource = overlapping.filter((item) => origin(item) === source);
        return sameSource.length ? sameSource : overlapping;
      };
      const calories = matching(calorieRecords).reduce(
        (sum, item) =>
          sum + nestedNumber(item, "energy", "inKilocalories"),
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
      return {
        ...converted,
        note: [converted.note, details].filter(Boolean).join(" · ") || undefined,
        measurements: {
          ...converted.measurements,
          activeCalories,
          distanceKm,
        },
      };
    });
    const activeEnergyImports = calorieRecords.map((record) => {
      const converted = convert("active_energy", record);
      const matchingWorkout = workoutRecords.find(
        (workout) =>
          overlaps(workout, converted.startTime, converted.endTime) &&
          origin(workout) === origin(record),
      ) ?? workoutRecords.find((workout) =>
        overlaps(workout, converted.startTime, converted.endTime),
      );
      return matchingWorkout
        ? { ...converted, label: workoutLabel(matchingWorkout) }
        : converted;
    });
    for (const workout of workoutImports) {
      const calories = workout.measurements?.activeCalories ?? 0;
      if (
        calories > 0 &&
        !activeEnergyImports.some((energy) =>
          overlaps(
            { startTime: energy.startTime, endTime: energy.endTime },
            workout.startTime,
            workout.endTime,
          ),
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
          if (type === "workouts") return workoutImports;
          const records = await readSafe(RECORD_TYPES[type]);
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
        } catch {
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
