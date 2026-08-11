import type { BiologicalSex } from "../types";

export type StatusBodyShape = "thin" | "average" | "full";

export type StatusBodyAppearance = {
  /** Continuous -1..1 fat-distribution signal; never displayed diagnostically. */
  adiposity: number;
  /** A continuous -1..1 value so body changes do not jump between presets. */
  bodyMass: number;
  bodyShape: StatusBodyShape;
  heightScale: number;
  /** Resolved lean-mass and resistance-training visual signal. */
  muscleProgress: number;
  muscleTier: 0 | 1 | 2 | 3;
};

export type StatusBodyComposition = {
  bodyFatPercent?: number;
  leanBodyMassKg?: number;
  sex?: BiologicalSex;
};

export const STATUS_AVATAR_VIEWBOX = {
  baselineY: 411,
  centerX: 100,
  crotchY: 229,
  handTipY: 258,
  headTopY: 8,
  height: 420,
  kneeY: 310,
  width: 200,
} as const;

/** Ten review checkpoints; runtime values are interpolated between them. */
export const STATUS_BODY_MASS_BMI_KNOTS = [
  { bmi: 17, bodyMass: -1 },
  { bmi: 19, bodyMass: -0.75 },
  { bmi: 21, bodyMass: -0.45 },
  { bmi: 23, bodyMass: -0.18 },
  { bmi: 25, bodyMass: 0.02 },
  { bmi: 28, bodyMass: 0.22 },
  { bmi: 31, bodyMass: 0.42 },
  { bmi: 35, bodyMass: 0.63 },
  { bmi: 40, bodyMass: 0.82 },
  { bmi: 46, bodyMass: 1 },
] as const;

/** Ten review checkpoints per sex; runtime percentages interpolate smoothly. */
export const STATUS_BODY_FAT_PERCENT_KNOTS = {
  female: [14, 17, 20, 23, 27, 31, 35, 40, 47, 56],
  male: [6, 9, 12, 15, 18, 22, 26, 31, 38, 48],
  unspecified: [10, 13, 16, 19, 23, 27, 31, 36, 43, 52],
} as const satisfies Record<BiologicalSex, readonly number[]>;

/**
 * Ten fat-free-mass-index review checkpoints per sex. FFMI is only a stable,
 * height-normalized morph input here; the avatar is not a body-composition
 * estimate. Every value between checkpoints is interpolated continuously.
 */
export const STATUS_LEAN_MASS_INDEX_KNOTS = {
  female: [12, 13, 14, 15, 16, 17, 18.5, 20, 22, 24],
  male: [14, 15, 16, 17, 18.5, 20, 21.5, 23, 25, 27],
  unspecified: [13, 14, 15, 16, 17.25, 18.5, 20, 21.5, 23.5, 25.5],
} as const satisfies Record<BiologicalSex, readonly number[]>;

export type StatusAvatarGeometry = {
  accessory: {
    capBrimY: number;
    capCrownBottomY: number;
    capHalfWidth: number;
    capTopY: number;
    eyeOffset: number;
    eyeY: number;
    lensRadius: number;
  };
  body: {
    ankleHalf: number;
    calfHalf: number;
    chestHalf: number;
    elbowInnerHalf: number;
    elbowOuterHalf: number;
    headHalf: number;
    hipHalf: number;
    kneeHalf: number;
    neckHalf: number;
    shoulderHalf: number;
    thighHalf: number;
    upperArmInnerHalf: number;
    upperArmOuterHalf: number;
    waistHalf: number;
    wristInnerHalf: number;
    wristOuterHalf: number;
  };
  bodyMass: number;
  adiposity: number;
  muscleProgress: number;
  variant: BiologicalSex;
};

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function interpolateCheckpoints(
  value: number,
  checkpoints: readonly number[],
  outputMinimum: number,
  outputMaximum: number,
) {
  const safe = Number.isFinite(value) ? value : checkpoints[4];
  if (safe <= checkpoints[0]) return outputMinimum;
  if (safe >= checkpoints.at(-1)!) return outputMaximum;
  for (let index = 1; index < checkpoints.length; index += 1) {
    const upper = checkpoints[index];
    if (safe > upper) continue;
    const lower = checkpoints[index - 1];
    const fraction = (safe - lower) / (upper - lower);
    const lowerOutput =
      outputMinimum +
      ((outputMaximum - outputMinimum) * (index - 1)) /
        (checkpoints.length - 1);
    const upperOutput =
      outputMinimum +
      ((outputMaximum - outputMinimum) * index) /
        (checkpoints.length - 1);
    return lowerOutput + (upperOutput - lowerOutput) * fraction;
  }
  return outputMaximum;
}

export function statusAdiposityForBodyFat(
  bodyFatPercent: number,
  sex: BiologicalSex,
) {
  return interpolateCheckpoints(
    bodyFatPercent,
    STATUS_BODY_FAT_PERCENT_KNOTS[sex],
    -1,
    1,
  );
}

export function statusLeanMassProgress(
  heightCm: number,
  leanBodyMassKg: number,
  sex: BiologicalSex,
) {
  const safeHeightM = bounded(heightCm, 135, 215) / 100;
  const safeLeanMassKg = bounded(leanBodyMassKg, 10, 220);
  const fatFreeMassIndex = safeLeanMassKg / (safeHeightM * safeHeightM);
  return interpolateCheckpoints(
    fatFreeMassIndex,
    STATUS_LEAN_MASS_INDEX_KNOTS[sex],
    0,
    1,
  );
}

export function statusBodyMassForBmi(bmi: number) {
  const safeBmi = Number.isFinite(bmi) ? bmi : 22;
  const first = STATUS_BODY_MASS_BMI_KNOTS[0];
  const last = STATUS_BODY_MASS_BMI_KNOTS.at(-1)!;
  if (safeBmi <= first.bmi) return first.bodyMass;
  if (safeBmi >= last.bmi) return last.bodyMass;
  for (let index = 1; index < STATUS_BODY_MASS_BMI_KNOTS.length; index += 1) {
    const upper = STATUS_BODY_MASS_BMI_KNOTS[index];
    if (safeBmi > upper.bmi) continue;
    const lower = STATUS_BODY_MASS_BMI_KNOTS[index - 1];
    const progress = (safeBmi - lower.bmi) / (upper.bmi - lower.bmi);
    return lower.bodyMass + (upper.bodyMass - lower.bodyMass) * progress;
  }
  return last.bodyMass;
}

/**
 * Diminishing-return response for completed resistance sets assigned to one
 * muscle group in one week. Ten weekly sets reach the reference dose; further
 * volume adds at most 15%, with effectively no visual reward past 20 sets.
 */
export function statusMuscleDoseResponse(weeklySets: number) {
  const sets = bounded(Number.isFinite(weeklySets) ? weeklySets : 0, 0, 20);
  if (sets <= 10) return Math.pow(sets / 10, 0.75);
  return 1 + 0.15 * (1 - Math.exp(-(sets - 10) / 4));
}

/** Six well-trained muscle-group equivalents represent a balanced week. */
export function statusMuscleWeeklyQuality(
  muscleGroupWeeklySets: readonly number[],
) {
  const response = muscleGroupWeeklySets.reduce(
    (total, sets) => total + statusMuscleDoseResponse(sets),
    0,
  );
  return bounded(response / 6, 0, 1);
}

export type StatusMuscleWeek = {
  quality: number;
  weeksAgo: number;
};

/**
 * Motivational training visualization, not a lean-mass estimate. Lifetime
 * effective training weeks drive slow adaptation (45-week time constant),
 * while the last eight weeks can soften or restore at most 14% of the look.
 * One unusually large session is capped to one weekly point and cannot jump a
 * visual checkpoint by itself.
 */
export function statusMuscleProgressFromWeeks(
  weeks: readonly StatusMuscleWeek[],
) {
  let effectiveTrainingWeeks = 0;
  let recentWeightedQuality = 0;
  let recentWeightTotal = 0;
  for (let weeksAgo = 0; weeksAgo < 8; weeksAgo += 1)
    recentWeightTotal += Math.pow(0.78, weeksAgo);
  for (const week of weeks) {
    const weeksAgo = Math.max(0, Math.floor(week.weeksAgo));
    const quality = bounded(
      Number.isFinite(week.quality) ? week.quality : 0,
      0,
      1,
    );
    effectiveTrainingWeeks += quality;
    if (weeksAgo < 8)
      recentWeightedQuality += quality * Math.pow(0.78, weeksAgo);
  }
  const recentConsistency = recentWeightTotal
    ? recentWeightedQuality / recentWeightTotal
    : 0;
  const lifetimeAdaptation = 1 - Math.exp(-effectiveTrainingWeeks / 45);
  return bounded(
    lifetimeAdaptation * (0.86 + 0.14 * recentConsistency),
    0,
    1,
  );
}

/**
 * Converts height and weight into a restrained continuous silhouette input.
 * The wider upper range intentionally does not make 90 kg and 120 kg look the
 * same at an average height. BMI is only used as a visual interpolation input;
 * the UI does not present it as a diagnosis or a preferred body shape.
 */
export function statusBodyAppearance(
  heightCm: number,
  weightKg: number,
  trainingProgress: number,
  composition: StatusBodyComposition = {},
): StatusBodyAppearance {
  const safeHeightCm = bounded(
    Number.isFinite(heightCm) ? heightCm : 170,
    135,
    215,
  );
  const safeWeightKg = bounded(
    Number.isFinite(weightKg) ? weightKg : 70,
    35,
    250,
  );
  const heightM = safeHeightCm / 100;
  const bmi = safeWeightKg / (heightM * heightM);
  const bodyMass = statusBodyMassForBmi(bmi);
  const sex = composition.sex ?? "unspecified";
  const measuredBodyFat =
    composition.bodyFatPercent !== undefined &&
    Number.isFinite(composition.bodyFatPercent) &&
    composition.bodyFatPercent > 0
      ? bounded(composition.bodyFatPercent, 1, 75)
      : undefined;
  const adiposity =
    measuredBodyFat === undefined
      ? bodyMass
      : statusAdiposityForBodyFat(measuredBodyFat, sex);
  const explicitLeanMass =
    composition.leanBodyMassKg !== undefined &&
    Number.isFinite(composition.leanBodyMassKg) &&
    composition.leanBodyMassKg > 0
      ? bounded(composition.leanBodyMassKg, 10, safeWeightKg)
      : undefined;
  // Body-fat measurements can provide a coherent fat-free-mass fallback. If
  // both fields are supplied but disagree, the explicit lean value remains
  // bounded by total weight and both signals stay inside safe morph limits.
  const resolvedLeanMass =
    explicitLeanMass ??
    (measuredBodyFat === undefined
      ? undefined
      : safeWeightKg * (1 - measuredBodyFat / 100));
  const leanMassProgress =
    resolvedLeanMass === undefined
      ? undefined
      : statusLeanMassProgress(safeHeightCm, resolvedLeanMass, sex);
  const boundedTraining = bounded(
    Number.isFinite(trainingProgress) ? trainingProgress : 0,
    0,
    1,
  );
  // Lean body mass includes bone, organs and water, so it is evidence rather
  // than a literal skeletal-muscle reading. Resistance history adds a smaller
  // independent tone signal with diminishing visual returns.
  const muscleProgress =
    leanMassProgress === undefined
      ? boundedTraining
      : bounded(
          1 -
            (1 - leanMassProgress * 0.82) *
              (1 - boundedTraining * 0.45),
          0,
          1,
        );
  const shapeScore = bodyMass * 0.35 + adiposity * 0.65;
  const bodyShape: StatusBodyShape =
    shapeScore < -0.42 ? "thin" : shapeScore > 0.28 ? "full" : "average";
  const muscleTier: 0 | 1 | 2 | 3 =
    muscleProgress >= 0.72
      ? 3
      : muscleProgress >= 0.4
        ? 2
        : muscleProgress >= 0.14
          ? 1
          : 0;

  return {
    adiposity,
    bodyMass,
    bodyShape,
    // Height changes presentation scale without distorting the fixed pose or
    // limb ratios. The restrained range keeps every figure inside the same
    // Status layout while still distinguishing short and tall profiles.
    heightScale: bounded(1 + (safeHeightCm - 170) / 700, 0.95, 1.065),
    muscleProgress,
    muscleTier,
  };
}

/**
 * Produces all horizontal silhouette landmarks and face-relative accessory
 * anchors. Mass, muscle and mind are independent dimensions: mass and muscle
 * continuously morph these points, while glasses/monocle/cap use the stable
 * face anchors and therefore remain aligned for every combination.
 */
export function statusAvatarGeometry(
  variant: BiologicalSex,
  bodyMass: number,
  muscleProgress: number,
  adiposity = bodyMass,
): StatusAvatarGeometry {
  const female = variant === "female";
  const male = variant === "male";
  const mass = bounded(Number.isFinite(bodyMass) ? bodyMass : 0, -1, 1);
  const thin = Math.max(0, -mass);
  const size = Math.max(0, mass);
  const fat = bounded(Number.isFinite(adiposity) ? adiposity : mass, -1, 1);
  const fatLean = Math.max(0, -fat);
  const fatFull = Math.max(0, fat);
  const muscle = bounded(
    Number.isFinite(muscleProgress) ? muscleProgress : 0,
    0,
    1,
  );
  const headHalf = female ? 17 : male ? 18 : 17.5;
  const neckHalf = (female ? 10 : male ? 12 : 11) + muscle * 0.8;
  const shoulderHalf =
    (female ? 40 : male ? 45 : 42) + muscle * 7.5 + size * 2.5 - thin * 1.5;
  const chestHalf =
    (female ? 34 : male ? 38 : 36) +
    muscle * 5 +
    size * 3 +
    fatFull * 4.5 -
    thin * 3;
  const waistHalf =
    (female ? 25.5 : male ? 28 : 27) +
    size * 3.5 +
    fatFull * 11 -
    fatLean * 2.5 -
    thin * 2 -
    muscle * 0.8;
  const hipHalf =
    (female ? 38 : male ? 32 : 35) +
    size * 4 +
    fatFull * 8 -
    fatLean * 1.5 -
    thin * 1.5 +
    muscle;
  const thighHalf =
    (female ? 31.5 : male ? 29.5 : 30.5) +
    size * 3 +
    fatFull * 6 -
    fatLean -
    thin * 2 +
    muscle * 2;
  const kneeHalf =
    (female ? 20 : male ? 21 : 20.5) +
    size +
    fatFull * 2 -
    thin * 1.5 +
    muscle;
  const calfHalf =
    (female ? 21.5 : male ? 23 : 22.2) +
    size +
    fatFull * 2 -
    thin * 1.5 +
    muscle * 1.5;
  const ankleHalf =
    (female ? 10 : male ? 11.5 : 10.8) + size * 0.6 + fatFull;

  return {
    accessory: {
      capBrimY: STATUS_AVATAR_VIEWBOX.headTopY + 5,
      capCrownBottomY: STATUS_AVATAR_VIEWBOX.headTopY + 21,
      capHalfWidth: headHalf + 13,
      capTopY: STATUS_AVATAR_VIEWBOX.headTopY - 8,
      eyeOffset: headHalf * 0.61,
      eyeY: female ? 39 : 38,
      lensRadius: headHalf * 0.42,
    },
    body: {
      ankleHalf,
      calfHalf,
      chestHalf,
      elbowInnerHalf: shoulderHalf - 1 + muscle + size,
      elbowOuterHalf:
        shoulderHalf + 10 + muscle * 2.5 + size * 1.4 + fatFull * 2,
      headHalf,
      hipHalf,
      kneeHalf,
      neckHalf,
      shoulderHalf,
      thighHalf,
      upperArmInnerHalf: shoulderHalf - 9 + muscle + size,
      upperArmOuterHalf:
        shoulderHalf + 8 + muscle * 2.5 + size * 1.4 + fatFull * 2,
      waistHalf,
      wristInnerHalf: shoulderHalf - 4 + size * 0.25 + fatFull * 0.25,
      wristOuterHalf:
        shoulderHalf + 4 + muscle + size * 0.5 + fatFull * 0.9,
    },
    adiposity: fat,
    bodyMass: mass,
    muscleProgress: muscle,
    variant,
  };
}
