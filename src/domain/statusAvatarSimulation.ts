import type {
  BiologicalSex,
  StatusAvatarCalculationSource,
} from "../types";

export type StatusAvatarSimulationMetric =
  | "weight"
  | "bmi"
  | "body_fat"
  | "lean_body_mass";

export const STATUS_AVATAR_SIMULATION_METRICS: readonly {
  id: StatusAvatarSimulationMetric;
  label: string;
}[] = [
  { id: "weight", label: "Weight" },
  { id: "bmi", label: "BMI" },
  { id: "body_fat", label: "Body fat" },
  { id: "lean_body_mass", label: "Lean body mass" },
] as const;

export type StatusAvatarSimulationInput = {
  bodyFatPercent?: number;
  heightCm?: number;
  leanBodyMassKg?: number;
  muscleProgress?: number;
  sex?: BiologicalSex;
  weightKg?: number;
};

export type StatusAvatarSimulationBaseline = {
  bodyFatPercent: number;
  fatMassKg: number;
  heightCm: number;
  leanBodyMassKg: number;
  muscleProgress: number;
  sex: BiologicalSex;
  weightKg: number;
};

export type StatusAvatarSimulationRange = {
  initialValue: number;
  maximumValue: number;
  minimumValue: number;
  step: number;
  unit: "" | "%" | "kg";
};

export type StatusAvatarSimulationPreview = {
  bodyFatPercent?: number;
  calculationSource: StatusAvatarCalculationSource;
  heightCm: number;
  leanBodyMassKg?: number;
  muscleProgress: number;
  sex: BiologicalSex;
  value: number;
  weightKg: number;
};

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeNumber(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function defaultBodyFatPercent(sex: BiologicalSex) {
  if (sex === "female") return 31;
  if (sex === "male") return 22;
  return 26;
}

/**
 * Produces a safe, internally consistent baseline for the visual-only avatar
 * simulator. Missing composition readings are replaced with deliberately
 * ordinary neutral values; the fallback is never written to profile or logs.
 */
export function statusAvatarSimulationBaseline(
  input: StatusAvatarSimulationInput,
): StatusAvatarSimulationBaseline {
  const sex =
    input.sex === "female" || input.sex === "male"
      ? input.sex
      : "unspecified";
  const heightCm = bounded(safeNumber(input.heightCm, 170), 135, 215);
  const heightM = heightCm / 100;
  const weightKg = bounded(
    safeNumber(input.weightKg, 22 * heightM * heightM),
    35,
    250,
  );
  const bodyFatPercent = bounded(
    safeNumber(input.bodyFatPercent, defaultBodyFatPercent(sex)),
    1,
    75,
  );
  const inferredLeanMassKg = weightKg * (1 - bodyFatPercent / 100);
  const leanBodyMassKg = bounded(
    safeNumber(input.leanBodyMassKg, inferredLeanMassKg),
    10,
    Math.max(10, weightKg - 0.5),
  );

  return {
    bodyFatPercent,
    fatMassKg: Math.max(0.5, weightKg - leanBodyMassKg),
    heightCm,
    leanBodyMassKg,
    muscleProgress: bounded(safeNumber(input.muscleProgress, 0), 0, 1),
    sex,
    weightKg,
  };
}

export function statusAvatarSimulationRange(
  metric: StatusAvatarSimulationMetric,
  baseline: StatusAvatarSimulationBaseline,
): StatusAvatarSimulationRange {
  const heightM = baseline.heightCm / 100;
  const heightSquared = heightM * heightM;
  const bmi = baseline.weightKg / heightSquared;

  if (metric === "weight") {
    const minimum = Math.min(
      baseline.weightKg,
      bounded(14 * heightSquared, 35, 250),
    );
    const maximum = Math.max(
      baseline.weightKg,
      bounded(60 * heightSquared, 35, 250),
    );
    return {
      initialValue: roundToStep(baseline.weightKg, 0.5),
      maximumValue: roundToStep(maximum, 0.5),
      minimumValue: roundToStep(minimum, 0.5),
      step: 0.5,
      unit: "kg",
    };
  }

  if (metric === "bmi") {
    const minimum = Math.min(bmi, Math.max(14, 35 / heightSquared));
    const maximum = Math.max(bmi, Math.min(60, 250 / heightSquared));
    return {
      initialValue: roundToStep(bmi, 0.5),
      maximumValue: roundToStep(maximum, 0.5),
      minimumValue: roundToStep(minimum, 0.5),
      step: 0.5,
      unit: "",
    };
  }

  if (metric === "body_fat") {
    const standardMinimum =
      baseline.sex === "female" ? 8 : baseline.sex === "male" ? 3 : 5;
    const standardMaximum =
      baseline.sex === "female" ? 70 : baseline.sex === "male" ? 60 : 65;
    return {
      initialValue: roundToStep(baseline.bodyFatPercent, 0.5),
      maximumValue: roundToStep(
        Math.max(standardMaximum, baseline.bodyFatPercent),
        0.5,
      ),
      minimumValue: roundToStep(
        Math.min(standardMinimum, baseline.bodyFatPercent),
        0.5,
      ),
      step: 0.5,
      unit: "%",
    };
  }

  const minimumFromHeight = 10 * heightSquared;
  const maximumFromHeight = 30 * heightSquared;
  const maximumForTotalMass = Math.max(10, 250 - baseline.fatMassKg);
  return {
    initialValue: roundToStep(baseline.leanBodyMassKg, 0.5),
    maximumValue: roundToStep(
      Math.max(
        baseline.leanBodyMassKg,
        Math.min(220, maximumForTotalMass, maximumFromHeight),
      ),
      0.5,
    ),
    minimumValue: roundToStep(
      Math.min(
        baseline.leanBodyMassKg,
        Math.max(10, 35 - baseline.fatMassKg, minimumFromHeight),
      ),
      0.5,
    ),
    step: 0.5,
    unit: "kg",
  };
}

/**
 * Resolves one independent what-if control into the existing avatar renderer.
 * Weight and BMI deliberately follow the BMI path. Composition controls create
 * the missing companion value locally so they work even with no logged body
 * composition. Nothing returned here is a profile or health-log mutation.
 */
export function statusAvatarSimulationPreview(
  metric: StatusAvatarSimulationMetric,
  requestedValue: number,
  baseline: StatusAvatarSimulationBaseline,
): StatusAvatarSimulationPreview {
  const range = statusAvatarSimulationRange(metric, baseline);
  const value = bounded(
    roundToStep(safeNumber(requestedValue, range.initialValue), range.step),
    range.minimumValue,
    range.maximumValue,
  );
  const heightM = baseline.heightCm / 100;

  if (metric === "weight") {
    return {
      calculationSource: "bmi",
      heightCm: baseline.heightCm,
      muscleProgress: baseline.muscleProgress,
      sex: baseline.sex,
      value,
      weightKg: value,
    };
  }

  if (metric === "bmi") {
    return {
      calculationSource: "bmi",
      heightCm: baseline.heightCm,
      muscleProgress: baseline.muscleProgress,
      sex: baseline.sex,
      value,
      weightKg: bounded(value * heightM * heightM, 35, 250),
    };
  }

  if (metric === "body_fat") {
    // Hold lean mass steady so the slider isolates a visual fat-gain/loss
    // scenario. Total mass is synthesized only for this preview.
    const syntheticWeightKg = bounded(
      baseline.leanBodyMassKg / Math.max(0.05, 1 - value / 100),
      35,
      250,
    );
    return {
      bodyFatPercent: value,
      calculationSource: "body_composition",
      heightCm: baseline.heightCm,
      leanBodyMassKg: Math.min(
        baseline.leanBodyMassKg,
        syntheticWeightKg - 0.5,
      ),
      muscleProgress: baseline.muscleProgress,
      sex: baseline.sex,
      value,
      weightKg: syntheticWeightKg,
    };
  }

  // Hold baseline fat mass steady so this becomes a visual lean-mass change,
  // not a simultaneous fat-gain scenario.
  const syntheticWeightKg = bounded(value + baseline.fatMassKg, 35, 250);
  const bodyFatPercent = bounded(
    (baseline.fatMassKg / syntheticWeightKg) * 100,
    1,
    75,
  );
  return {
    bodyFatPercent,
    calculationSource: "body_composition",
    heightCm: baseline.heightCm,
    leanBodyMassKg: Math.min(value, syntheticWeightKg - 0.5),
    muscleProgress: baseline.muscleProgress,
    sex: baseline.sex,
    value,
    weightKg: syntheticWeightKg,
  };
}
