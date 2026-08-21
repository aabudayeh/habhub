import type {
  BiologicalSex,
  StatusAvatarCalculationSource,
} from "../types";

/**
 * Calibration background (the formulas below remain app-specific morphs):
 * - VanItallie et al., AJCN 1990, doi:10.1093/ajcn/52.6.953 introduced
 *   height-normalized fat and fat-free mass indices.
 * - Kyle et al., Nutrition 2003, doi:10.1016/S0899-9007(03)00061-3 reported
 *   sex-specific FFMI/FMI population ranges used for the middle anchors.
 * - Heo et al., AJCN 2012, doi:10.3945/ajcn.111.025171 showed that BMI-to-fat
 *   relationships vary with sex, age and race/ethnicity. Accordingly, this
 *   code never treats weight/height as a unique or accurate body prediction.
 * - Talbot et al., Psychology of Men & Masculinities 2019,
 *   doi:10.1037/men0000165 validated a visual matrix with independent %fat and
 *   FFMI axes. It supports the two-axis design, not reuse of its artwork or a
 *   claim that a figure is an individual's measured body.
 */

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

/**
 * Resolves the user's persisted calculation preference. Body composition is
 * normally remains all-or-fallback for the saved Status preference. The
 * visual-only simulator may explicitly opt into partial independent signals,
 * where body fat affects adiposity and lean mass affects muscularity only.
 */
export function statusBodyCompositionForSource(
  source: StatusAvatarCalculationSource | undefined,
  composition: StatusBodyComposition,
  allowPartial = false,
): StatusBodyComposition {
  const hasBodyFat =
    typeof composition.bodyFatPercent === "number" &&
    Number.isFinite(composition.bodyFatPercent) &&
    composition.bodyFatPercent > 0;
  const hasLeanMass =
    typeof composition.leanBodyMassKg === "number" &&
    Number.isFinite(composition.leanBodyMassKg) &&
    composition.leanBodyMassKg > 0;
  if (source !== "body_composition") return { sex: composition.sex };
  if (!allowPartial && (!hasBodyFat || !hasLeanMass))
    return { sex: composition.sex };
  return {
    bodyFatPercent: hasBodyFat ? composition.bodyFatPercent : undefined,
    leanBodyMassKg: hasLeanMass ? composition.leanBodyMassKg : undefined,
    sex: composition.sex,
  };
}

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

/**
 * Ten visual review checkpoints. Runtime values are interpolated between
 * them, so these are not BMI classifications and are never shown to users.
 * The wide final interval keeps 120 kg and 150 kg visibly distinct at common
 * adult heights instead of making every high-weight profile the same shape.
 */
export const STATUS_BODY_MASS_BMI_KNOTS = [
  { bmi: 17, bodyMass: -1 },
  { bmi: 19, bodyMass: -0.78 },
  { bmi: 21, bodyMass: -0.5 },
  { bmi: 23, bodyMass: -0.25 },
  { bmi: 25, bodyMass: -0.05 },
  { bmi: 28, bodyMass: 0.17 },
  { bmi: 32, bodyMass: 0.38 },
  { bmi: 37, bodyMass: 0.61 },
  { bmi: 44, bodyMass: 0.82 },
  { bmi: 55, bodyMass: 1 },
] as const;

/** Ten review checkpoints per sex; runtime percentages interpolate smoothly. */
export const STATUS_BODY_FAT_PERCENT_KNOTS = {
  female: [14, 18, 23, 27, 31, 35, 39, 44, 50, 58],
  male: [6, 10, 14, 18, 22, 26, 30, 35, 41, 50],
  unspecified: [10, 14, 18, 22, 26, 30, 34, 39, 46, 54],
} as const satisfies Record<BiologicalSex, readonly number[]>;

/**
 * Fat-mass index (fat mass / height squared) complements percentage body fat.
 * The middle anchors cover the sex-specific population ranges reported by
 * Kyle et al. (2003); the outer anchors are deliberately broad rendering
 * limits, not healthy/unhealthy labels or diagnostic cut-offs.
 */
export const STATUS_FAT_MASS_INDEX_KNOTS = {
  female: [2.5, 3.9, 5.2, 6.7, 8.2, 9.8, 11.8, 14.5, 18, 23],
  male: [1.2, 1.8, 2.8, 4, 5.2, 6.7, 8.3, 10.8, 14, 19],
  unspecified: [1.8, 2.8, 4, 5.4, 6.8, 8.2, 10, 12.7, 16, 21],
} as const satisfies Record<BiologicalSex, readonly number[]>;

/**
 * Ten fat-free-mass-index review checkpoints per sex. FFMI is only a stable,
 * height-normalized morph input here; the avatar is not a body-composition
 * estimate. Every value between checkpoints is interpolated continuously.
 */
export const STATUS_LEAN_MASS_INDEX_KNOTS = {
  female: [12, 13, 14, 14.6, 15.3, 16.1, 16.8, 17.9, 20, 22.5],
  male: [14, 15, 16, 16.7, 17.7, 19, 19.8, 21.5, 24, 27],
  unspecified: [13, 14, 15, 15.65, 16.5, 17.55, 18.3, 19.7, 22, 24.75],
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

/**
 * Resolves measured body fat into the avatar's continuous adiposity axis.
 * Percentage supplies the distribution signal while fat-mass index retains
 * the effect of absolute fat mass at a given height. Neither input can recover
 * an individual's real circumferences or regional fat distribution, so this
 * remains an approximate motivational morph.
 */
export function statusAdiposityForComposition(
  heightCm: number,
  weightKg: number,
  bodyFatPercent: number,
  sex: BiologicalSex,
) {
  const safeHeightM = bounded(heightCm, 135, 215) / 100;
  const safeWeightKg = bounded(weightKg, 35, 250);
  const safeBodyFat = bounded(bodyFatPercent, 1, 75);
  const fatMassIndex =
    (safeWeightKg * (safeBodyFat / 100)) / (safeHeightM * safeHeightM);
  const percentageSignal = statusAdiposityForBodyFat(safeBodyFat, sex);
  const massSignal = interpolateCheckpoints(
    fatMassIndex,
    STATUS_FAT_MASS_INDEX_KNOTS[sex],
    -1,
    1,
  );
  return bounded(percentageSignal * 0.6 + massSignal * 0.4, -1, 1);
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
 * muscle group in one week. Ten sets are the app's reference dose, not a
 * physiological optimum. The cap prevents one very high-volume week from
 * producing an implausible visual jump. The qualitative diminishing-return
 * shape and fractional credit for secondary muscles follow Pelland et al.,
 * Sports Medicine 2026, doi:10.1007/s40279-025-02344-w; the exact visual curve
 * and cap are deliberately conservative product calibration.
 */
export function statusMuscleDoseResponse(weeklySets: number) {
  const sets = bounded(Number.isFinite(weeklySets) ? weeklySets : 0, 0, 20);
  if (sets <= 10) return Math.pow(sets / 10, 0.75);
  return 1 + 0.15 * (1 - Math.exp(-(sets - 10) / 4));
}

/** Six trained muscle-group equivalents represent the app's balanced week. */
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

export type StatusMuscleFrequency = {
  /** Distinct resistance-training days in the seven days through the anchor. */
  recentWeekSessions?: number;
  /** Distinct resistance-training days in the 28 days through the anchor. */
  recentMonthSessions?: number;
  /** Distinct resistance-training days at or before the anchor. */
  lifetimeSessions?: number;
};

/**
 * Motivational training visualization, not a lean-mass estimate. Lifetime
 * effective training weeks drive slow visual progression, while the last
 * eight weeks and bounded 7/28-day session frequency softly reinforce the
 * look. The 45-week/72-session calibrations are UX pacing choices, not a claim
 * that physiology follows one universal clock. One unusually large session is
 * capped to one weekly point.
 */
export function statusMuscleProgressFromWeeks(
  weeks: readonly StatusMuscleWeek[],
  frequency: StatusMuscleFrequency = {},
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
  const recentWeekFrequency = bounded(
    Number.isFinite(frequency.recentWeekSessions)
      ? Number(frequency.recentWeekSessions) / 3
      : 0,
    0,
    1,
  );
  const recentMonthFrequency = bounded(
    Number.isFinite(frequency.recentMonthSessions)
      ? Number(frequency.recentMonthSessions) / 12
      : 0,
    0,
    1,
  );
  const lifetimeSessionAdaptation =
    1 -
    Math.exp(
      -bounded(
        Number.isFinite(frequency.lifetimeSessions)
          ? Number(frequency.lifetimeSessions)
          : 0,
        0,
        10_000,
      ) /
        72,
    );
  // Frequency is deliberately secondary to completed resistance work. It
  // helps people whose sessions lack detailed set/load data, but one busy
  // week cannot instantly create a high-muscle avatar. The 7/28-day windows
  // also make a selected historical date independent from future workouts.
  const recentFrequency =
    recentWeekFrequency * 0.4 + recentMonthFrequency * 0.6;
  const durableAdaptation =
    1 -
    (1 - lifetimeAdaptation) *
      (1 - lifetimeSessionAdaptation * 0.45);
  return bounded(
    durableAdaptation * (0.86 + 0.14 * recentConsistency) +
      recentFrequency *
        0.1 *
        (0.35 + lifetimeSessionAdaptation * 0.65),
    0,
    1,
  );
}

/**
 * Converts height, weight and optional composition evidence into restrained
 * continuous silhouette inputs. Weight and height alone cannot identify fat
 * and lean compartments, so BMI is only the fallback total-size/adiposity
 * morph. Measured body fat separates adiposity, and height-normalized lean mass
 * separates muscularity. The result is approximate and motivational: it is
 * not a scan, diagnosis, or prediction of a person's real body.
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
  const explicitLeanMass =
    composition.leanBodyMassKg !== undefined &&
    Number.isFinite(composition.leanBodyMassKg) &&
    composition.leanBodyMassKg > 0
      ? bounded(composition.leanBodyMassKg, 10, safeWeightKg)
      : undefined;
  // Do not infer fatness from lean mass. The two optional composition signals
  // are independent: measured body fat changes adiposity, while an absent
  // body-fat signal leaves the predictable BMI fallback in place.
  const resolvedBodyFat = measuredBodyFat;
  const adiposity =
    resolvedBodyFat === undefined
      ? bodyMass
      : statusAdiposityForComposition(
          safeHeightCm,
          safeWeightKg,
          resolvedBodyFat,
          sex,
        );
  // A body-fat percentage mathematically identifies fat-free mass, but not
  // skeletal muscle. Use only explicitly supplied lean mass for this axis;
  // otherwise completed resistance history and recent gym frequency provide
  // the conservative muscle fallback requested by the user.
  const resolvedLeanMass = explicitLeanMass;
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
  // than a skeletal-muscle measurement. Resistance history adds an independent
  // tone signal with diminishing visual returns. The noisy signals are blended
  // instead of treating either one as a literal body-shape prediction.
  const muscleProgress =
    leanMassProgress === undefined
      ? boundedTraining
      : bounded(
          1 -
            (1 - leanMassProgress * 0.76) *
              (1 - boundedTraining * 0.5),
          0,
          1,
        );
  const shapeScore = bodyMass * 0.35 + adiposity * 0.65;
  const bodyShape: StatusBodyShape =
    shapeScore < -0.42 ? "thin" : shapeScore > 0.22 ? "full" : "average";
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
    heightScale: bounded(1 + (safeHeightCm - 170) / 560, 0.935, 1.08),
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
  const neckHalf = (female ? 10 : male ? 12 : 11) + muscle * 0.9;
  const shoulderHalf =
    (female ? 39.5 : male ? 45 : 42) +
    muscle * (female ? 7.5 : 9.5) +
    size * 2.8 -
    thin * 1.8;
  const chestHalf =
    (female ? 34 : male ? 38 : 36) +
    muscle * (female ? 6.5 : 9) +
    size * 3.5 +
    fatFull * 6 -
    thin * 3.5;
  const waistHalf =
    (female ? 25 : male ? 27.5 : 26.5) +
    size * 4 +
    fatFull * (female ? 16 : 17.5) -
    fatLean * 3 -
    thin * 2.3 -
    muscle;
  const hipHalf =
    (female ? 38 : male ? 32 : 35) +
    size * 4.5 +
    fatFull * (female ? 11.5 : 10.5) -
    fatLean * 2 -
    thin * 1.8 +
    muscle * (female ? 1.8 : 1.3);
  const thighHalf =
    (female ? 31.5 : male ? 29.5 : 30.5) +
    size * 3.8 +
    fatFull * (female ? 8.5 : 7.5) -
    fatLean * 1.4 -
    thin * 2.2 +
    muscle * 3.5;
  const kneeHalf =
    (female ? 20 : male ? 21 : 20.5) +
    size +
    fatFull * 2.8 -
    thin * 1.5 +
    muscle;
  const calfHalf =
    (female ? 21.5 : male ? 23 : 22.2) +
    size +
    fatFull * 3 -
    thin * 1.5 +
    muscle * 2;
  const ankleHalf =
    (female ? 10 : male ? 11.5 : 10.8) + size * 0.7 + fatFull * 1.3;

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
      elbowInnerHalf: shoulderHalf - 1 + muscle * 1.2 + size,
      elbowOuterHalf:
        shoulderHalf + 10 + muscle * 3.5 + size * 1.5 + fatFull * 3,
      headHalf,
      hipHalf,
      kneeHalf,
      neckHalf,
      shoulderHalf,
      thighHalf,
      upperArmInnerHalf: shoulderHalf - 9 + muscle * 1.4 + size,
      upperArmOuterHalf:
        shoulderHalf + 8 + muscle * 3.8 + size * 1.5 + fatFull * 3,
      waistHalf,
      wristInnerHalf: shoulderHalf - 4 + size * 0.25 + fatFull * 0.25,
      wristOuterHalf:
        shoulderHalf + 4 + muscle * 1.2 + size * 0.55 + fatFull,
    },
    adiposity: fat,
    bodyMass: mass,
    muscleProgress: muscle,
    variant,
  };
}
