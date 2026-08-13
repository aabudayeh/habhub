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
  age?: number;
  bodyFatPercent?: number;
  heightCm?: number;
  leanBodyMassKg?: number;
  muscleProgress?: number;
  sex?: BiologicalSex;
  weightKg?: number;
};

export type StatusAvatarSimulationBaseline = {
  age?: number;
  bodyFatPercent: number;
  bodyFatWasLogged: boolean;
  heightCm: number;
  leanBodyMassKg: number;
  leanMassWasLogged: boolean;
  muscleProgress: number;
  sex: BiologicalSex;
  weightKg: number;
  weightWasLogged: boolean;
};

export type StatusAvatarSimulationRange = {
  initialValue: number;
  maximumValue: number;
  minimumValue: number;
  step: number;
  unit: "" | "%" | "kg";
};

export type StatusAvatarSimulationState = {
  enabled: Record<StatusAvatarSimulationMetric, boolean>;
  values: Record<StatusAvatarSimulationMetric, number>;
};

export type StatusAvatarSimulationMarker = {
  currentValue?: number;
  recommendedValue?: number;
};

export type StatusAvatarSimulationMarkers = Record<
  StatusAvatarSimulationMetric,
  StatusAvatarSimulationMarker
>;

export type StatusAvatarSimulationConsistency =
  | { status: "ok" }
  | {
      differenceKg: number;
      impliedWeightKg?: number;
      status: "conflict";
    };

export type StatusAvatarSimulationPreview = {
  bmi: number;
  bodyFatPercent?: number;
  calculationSource: StatusAvatarCalculationSource;
  consistency: StatusAvatarSimulationConsistency;
  enabled: StatusAvatarSimulationState["enabled"];
  heightCm: number;
  leanBodyMassKg?: number;
  muscleProgress: number;
  sex: BiologicalSex;
  values: StatusAvatarSimulationState["values"];
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

function hasPositiveMeasurement(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Produces safe starting values for a visual-only simulation. Fallback body
 * composition values remain marked as unlogged so they are disabled at first
 * and never masquerade as measurements.
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
  const age =
    typeof input.age === "number" && Number.isFinite(input.age)
      ? bounded(input.age, 13, 120)
      : undefined;
  const weightWasLogged = hasPositiveMeasurement(input.weightKg);
  const weightKg = bounded(
    safeNumber(input.weightKg, 22 * heightM * heightM),
    35,
    250,
  );
  const bodyFatWasLogged = hasPositiveMeasurement(input.bodyFatPercent);
  const bodyFatPercent = bounded(
    safeNumber(input.bodyFatPercent, defaultBodyFatPercent(sex)),
    1,
    75,
  );
  const inferredLeanMassKg = weightKg * (1 - bodyFatPercent / 100);
  const leanMassWasLogged = hasPositiveMeasurement(input.leanBodyMassKg);
  const leanBodyMassKg = bounded(
    safeNumber(input.leanBodyMassKg, inferredLeanMassKg),
    10,
    220,
  );

  return {
    age,
    bodyFatPercent,
    bodyFatWasLogged,
    heightCm,
    leanBodyMassKg,
    leanMassWasLogged,
    muscleProgress: bounded(safeNumber(input.muscleProgress, 0), 0, 1),
    sex,
    weightKg,
    weightWasLogged,
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

  // Lean mass is its own visual signal. Its range is height-normalized and is
  // deliberately not silently constrained by the currently selected body-fat
  // or total-weight sliders. Inconsistent combinations are reported below.
  const minimumFromHeight = 10 * heightSquared;
  const maximumFromHeight = 30 * heightSquared;
  return {
    initialValue: roundToStep(baseline.leanBodyMassKg, 0.5),
    maximumValue: roundToStep(
      Math.max(
        baseline.leanBodyMassKg,
        Math.min(220, maximumFromHeight),
      ),
      0.5,
    ),
    minimumValue: roundToStep(
      Math.min(baseline.leanBodyMassKg, Math.max(10, minimumFromHeight)),
      0.5,
    ),
    step: 0.5,
    unit: "kg",
  };
}

const ADULT_HEALTHY_BMI_MIDPOINT = (18.5 + 24.9) / 2;
const GENERAL_ADULT_REFERENCE_AGE = 35;
const DEURENBERG_ADULT_AGE_MINIMUM = 18;
const DEURENBERG_ADULT_AGE_MAXIMUM = 83;

/**
 * Builds fixed, visual reference markers for the simulator tracks.
 *
 * The weight marker is the midpoint of the WHO adult healthy-BMI reference
 * range (18.5-24.9), converted using profile height. The composition markers
 * use the adult Deurenberg BMI/age/sex population equation at that same BMI,
 * then derive lean mass as reference weight minus estimated fat mass. An age
 * outside the adult source range (or no age) uses a general adult age of 35;
 * unspecified sex uses the midpoint of the male and female coefficients.
 * This keeps R available as an orientation point for every profile, while it
 * remains explicitly non-diagnostic and not a personalized medical target.
 *
 * Sources:
 * https://apps.who.int/nutrition/landscape/help.aspx?helpid=420&menu=0
 * https://pubmed.ncbi.nlm.nih.gov/2043597/
 */
export function statusAvatarSimulationMarkers(
  baseline: StatusAvatarSimulationBaseline,
): StatusAvatarSimulationMarkers {
  const current = {
    body_fat: baseline.bodyFatWasLogged
      ? baseline.bodyFatPercent
      : undefined,
    lean_body_mass: baseline.leanMassWasLogged
      ? baseline.leanBodyMassKg
      : undefined,
    weight: baseline.weightWasLogged ? baseline.weightKg : undefined,
  };

  const heightM = baseline.heightCm / 100;
  const referenceWeightKg =
    ADULT_HEALTHY_BMI_MIDPOINT * heightM * heightM;
  const referenceAge =
    baseline.age !== undefined &&
    baseline.age >= DEURENBERG_ADULT_AGE_MINIMUM &&
    baseline.age <= DEURENBERG_ADULT_AGE_MAXIMUM
      ? baseline.age
      : GENERAL_ADULT_REFERENCE_AGE;
  const sexCoefficient =
    baseline.sex === "male" ? 1 : baseline.sex === "female" ? 0 : 0.5;
  const referenceBodyFatPercent =
    1.2 * ADULT_HEALTHY_BMI_MIDPOINT +
    0.23 * referenceAge -
    10.8 * sexCoefficient -
    5.4;
  const referenceLeanBodyMassKg =
    referenceWeightKg * (1 - referenceBodyFatPercent / 100);

  const markerFor = (
    metric: "weight" | "body_fat" | "lean_body_mass",
    currentValue: number | undefined,
    recommendedValue: number | undefined,
  ): StatusAvatarSimulationMarker => {
    const range = statusAvatarSimulationRange(metric, baseline);
    const normalizeMarker = (value: number | undefined) =>
      value === undefined
        ? undefined
        : bounded(
            roundToStep(value, range.step),
            range.minimumValue,
            range.maximumValue,
          );
    return {
      currentValue: normalizeMarker(currentValue),
      recommendedValue: normalizeMarker(recommendedValue),
    };
  };

  return {
    bmi: {},
    body_fat: markerFor(
      "body_fat",
      current.body_fat,
      referenceBodyFatPercent,
    ),
    lean_body_mass: markerFor(
      "lean_body_mass",
      current.lean_body_mass,
      referenceLeanBodyMassKg,
    ),
    weight: markerFor("weight", current.weight, referenceWeightKg),
  };
}

function normalizedValue(
  metric: StatusAvatarSimulationMetric,
  requestedValue: number,
  baseline: StatusAvatarSimulationBaseline,
) {
  const range = statusAvatarSimulationRange(metric, baseline);
  return bounded(
    roundToStep(safeNumber(requestedValue, range.initialValue), range.step),
    range.minimumValue,
    range.maximumValue,
  );
}

export function statusAvatarSimulationInitialState(
  baseline: StatusAvatarSimulationBaseline,
  calculationSource: StatusAvatarCalculationSource = "bmi",
): StatusAvatarSimulationState {
  const values = Object.fromEntries(
    STATUS_AVATAR_SIMULATION_METRICS.map(({ id }) => [
      id,
      statusAvatarSimulationRange(id, baseline).initialValue,
    ]),
  ) as StatusAvatarSimulationState["values"];
  const useLoggedComposition =
    calculationSource === "body_composition";
  return {
    enabled: {
      // Weight and BMI are two views of the same size signal at the fixed
      // profile height. Keep both available: moving either slider updates the
      // other, while each switch only simulates whether that value is present.
      bmi: true,
      body_fat: useLoggedComposition && baseline.bodyFatWasLogged,
      lean_body_mass: useLoggedComposition && baseline.leanMassWasLogged,
      weight: true,
    },
    values,
  };
}

/**
 * Updates one slider. Weight and BMI are the same total-mass fact at a fixed
 * height, so their displayed values move together. Body fat and lean mass are
 * never derived from one another.
 */
export function statusAvatarSimulationSetValue(
  state: StatusAvatarSimulationState,
  metric: StatusAvatarSimulationMetric,
  requestedValue: number,
  baseline: StatusAvatarSimulationBaseline,
): StatusAvatarSimulationState {
  const value = normalizedValue(metric, requestedValue, baseline);
  const values = { ...state.values, [metric]: value };
  const heightM = baseline.heightCm / 100;
  const heightSquared = heightM * heightM;
  if (metric === "weight")
    values.bmi = normalizedValue("bmi", value / heightSquared, baseline);
  else if (metric === "bmi")
    values.weight = normalizedValue("weight", value * heightSquared, baseline);
  return { enabled: { ...state.enabled }, values };
}

/**
 * Every switch represents only whether that input is available to the visual
 * simulation. No switch is mutually exclusive: notably, weight and BMI remain
 * linked views of the same value and body fat and lean mass remain independent.
 */
export function statusAvatarSimulationSetEnabled(
  state: StatusAvatarSimulationState,
  metric: StatusAvatarSimulationMetric,
  enabled: boolean,
): StatusAvatarSimulationState {
  return {
    enabled: { ...state.enabled, [metric]: enabled },
    values: { ...state.values },
  };
}

function compositionConsistency(
  enabled: StatusAvatarSimulationState["enabled"],
  weightKg: number,
  bodyFatPercent: number | undefined,
  leanBodyMassKg: number | undefined,
): StatusAvatarSimulationConsistency {
  if (!enabled.lean_body_mass || leanBodyMassKg === undefined)
    return { status: "ok" };
  if (!enabled.body_fat || bodyFatPercent === undefined) {
    const differenceKg = Math.max(0, leanBodyMassKg - weightKg);
    return differenceKg > 0.5
      ? { differenceKg, status: "conflict" }
      : { status: "ok" };
  }
  const impliedWeightKg =
    leanBodyMassKg / Math.max(0.05, 1 - bodyFatPercent / 100);
  const differenceKg = Math.abs(impliedWeightKg - weightKg);
  const toleranceKg = Math.max(3, weightKg * 0.08);
  return differenceKg > toleranceKg
    ? { differenceKg, impliedWeightKg, status: "conflict" }
    : { status: "ok" };
}

/**
 * Resolves all enabled what-if controls together. No slider mutates profile or
 * log data, and no body-fat/lean-mass value is synthesized from its companion.
 * When a combination cannot describe one physical total, the renderer keeps
 * the two visual signals independent and returns an explicit conflict for UI.
 */
export function statusAvatarSimulationPreview(
  state: StatusAvatarSimulationState,
  baseline: StatusAvatarSimulationBaseline,
): StatusAvatarSimulationPreview {
  const heightM = baseline.heightCm / 100;
  const heightSquared = heightM * heightM;
  const values = Object.fromEntries(
    STATUS_AVATAR_SIMULATION_METRICS.map(({ id }) => [
      id,
      normalizedValue(id, state.values[id], baseline),
    ]),
  ) as StatusAvatarSimulationState["values"];
  const enabled = { ...state.enabled };
  const weightKg = enabled.weight
    ? values.weight
    : enabled.bmi
      ? bounded(values.bmi * heightSquared, 35, 250)
      : baseline.weightKg;
  const bmi = weightKg / heightSquared;
  const bodyFatPercent = enabled.body_fat ? values.body_fat : undefined;
  const leanBodyMassKg = enabled.lean_body_mass
    ? values.lean_body_mass
    : undefined;

  return {
    bmi,
    bodyFatPercent,
    calculationSource:
      bodyFatPercent !== undefined || leanBodyMassKg !== undefined
        ? "body_composition"
        : "bmi",
    consistency: compositionConsistency(
      enabled,
      weightKg,
      bodyFatPercent,
      leanBodyMassKg,
    ),
    enabled,
    heightCm: baseline.heightCm,
    leanBodyMassKg,
    muscleProgress: baseline.muscleProgress,
    sex: baseline.sex,
    values,
    weightKg,
  };
}
