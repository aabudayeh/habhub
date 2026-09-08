import { FoodNutrientId } from "./food";
import { BiologicalSex, EnergyProfile } from "../types";

export type DailyNutrientReference = {
  kind: "target" | "range" | "limit" | "minimize";
  target?: number;
  min?: number;
  max?: number;
  basis: string;
};

function sexValue(
  sex: BiologicalSex,
  female: number,
  male: number,
): Pick<DailyNutrientReference, "target" | "min" | "max"> {
  if (sex === "female") return { target: female };
  if (sex === "male") return { target: male };
  return female === male
    ? { target: female }
    : { min: Math.min(female, male), max: Math.max(female, male) };
}

function target(
  value: number,
  basis: string,
): DailyNutrientReference {
  return { kind: "target", target: value, basis };
}

function sexTarget(
  sex: BiologicalSex,
  female: number,
  male: number,
  basis: string,
): DailyNutrientReference {
  return { kind: "target", ...sexValue(sex, female, male), basis };
}

/**
 * General daily reference values for non-pregnant people aged 13+.
 *
 * Values follow the US/Canadian National Academies DRI summary tables, with
 * current Dietary Guidelines limits for saturated fat and sodium. They are a
 * compact educational comparison, not a diagnosis or a prescribed target.
 * Nutrients without a defensible total-intake reference deliberately return
 * undefined instead of inventing a number.
 */
export function dailyNutrientReference(
  nutrientId: FoodNutrientId,
  profile: Pick<EnergyProfile, "age" | "sex" | "weightKg">,
  dailyEnergyKcal: number,
): DailyNutrientReference | undefined {
  const age = Math.max(13, Math.round(profile.age || 13));
  const sex = profile.sex ?? "unspecified";
  const energy = Math.max(800, Number(dailyEnergyKcal) || 2000);
  const youngerTeen = age < 14;
  const teen = age < 19;
  const older = age > 50;

  switch (nutrientId) {
    case "protein":
      return target(
        Math.max(0, profile.weightKg || 0) *
          (youngerTeen ? 0.95 : teen ? 0.85 : 0.8),
        youngerTeen
          ? "0.95 g per kg body weight"
          : teen
            ? "0.85 g per kg body weight"
            : "0.8 g per kg body weight",
      );
    case "carbs":
      return target(130, "adult and adolescent RDA");
    case "fat":
      return {
        kind: "range",
        min: (energy * (teen ? 0.25 : 0.2)) / 9,
        max: (energy * 0.35) / 9,
        basis: teen ? "25–35% of daily energy" : "20–35% of daily energy",
      };
    case "fiber":
      return sexTarget(
        sex,
        teen ? 26 : older ? 21 : 25,
        youngerTeen ? 31 : teen ? 38 : older ? 30 : 38,
        "age- and sex-based adequate intake",
      );
    case "saturated_fat":
      return {
        kind: "limit",
        max: (energy * 0.1) / 9,
        basis: "less than 10% of daily energy",
      };
    case "trans_fat":
      return { kind: "minimize", basis: "keep intake as low as possible" };
    case "sodium":
      return {
        kind: "limit",
        max: youngerTeen ? 1800 : 2300,
        basis: "age-based Dietary Guidelines limit",
      };
    case "potassium":
      return sexTarget(
        sex,
        teen ? 2300 : 2600,
        youngerTeen ? 2500 : teen ? 3000 : 3400,
        "age- and sex-based adequate intake",
      );
    case "calcium":
      return target(
        teen ? 1300 : age > 70 || (sex === "female" && age > 50) ? 1200 : 1000,
        "age- and sex-based RDA",
      );
    case "iron":
      return sexTarget(
        sex,
        youngerTeen ? 8 : teen ? 15 : older ? 8 : 18,
        youngerTeen ? 8 : teen ? 11 : 8,
        "age- and sex-based RDA",
      );
    case "magnesium":
      return sexTarget(
        sex,
        youngerTeen ? 240 : teen ? 360 : age < 31 ? 310 : 320,
        youngerTeen ? 240 : teen ? 410 : age < 31 ? 400 : 420,
        "age- and sex-based RDA",
      );
    case "vitamin_c":
      return sexTarget(
        sex,
        youngerTeen ? 45 : teen ? 65 : 75,
        youngerTeen ? 45 : teen ? 75 : 90,
        "age- and sex-based RDA",
      );
    case "vitamin_d":
      return target(age > 70 ? 20 : 15, "age-based RDA");
    case "vitamin_b12":
      return target(youngerTeen ? 1.8 : 2.4, "age-based RDA");
    case "omega_3":
      return sexTarget(
        sex,
        youngerTeen ? 1 : 1.1,
        youngerTeen ? 1.2 : 1.6,
        "age- and sex-based adequate intake",
      );
    case "omega_6":
      return sexTarget(
        sex,
        youngerTeen ? 10 : teen ? 11 : older ? 11 : 12,
        youngerTeen ? 12 : teen ? 16 : older ? 14 : 17,
        "age- and sex-based adequate intake",
      );
    case "phosphorus":
      return target(teen ? 1250 : 700, "age-based RDA");
    case "zinc":
      return sexTarget(
        sex,
        youngerTeen ? 8 : teen ? 9 : 8,
        youngerTeen ? 8 : 11,
        "age- and sex-based RDA",
      );
    case "copper":
      return target(youngerTeen ? 0.7 : teen ? 0.89 : 0.9, "age-based RDA");
    case "manganese":
      return sexTarget(
        sex,
        teen ? 1.6 : 1.8,
        youngerTeen ? 1.9 : teen ? 2.2 : 2.3,
        "age- and sex-based adequate intake",
      );
    case "selenium":
      return target(youngerTeen ? 40 : 55, "age-based RDA");
    case "iodine":
      return target(youngerTeen ? 120 : 150, "age-based RDA");
    case "chloride":
      return target(age > 70 ? 1800 : older ? 2000 : 2300, "age-based adequate intake");
    case "chromium":
      return sexTarget(
        sex,
        youngerTeen ? 21 : teen ? 24 : older ? 20 : 25,
        youngerTeen ? 25 : teen ? 35 : older ? 30 : 35,
        "age- and sex-based adequate intake",
      );
    case "molybdenum":
      return target(youngerTeen ? 34 : teen ? 43 : 45, "age-based RDA");
    case "vitamin_a":
      return sexTarget(
        sex,
        youngerTeen ? 600 : 700,
        youngerTeen ? 600 : 900,
        "age- and sex-based RDA",
      );
    case "vitamin_e":
      return target(youngerTeen ? 11 : 15, "age-based RDA");
    case "vitamin_k":
      return sexTarget(
        sex,
        youngerTeen ? 60 : teen ? 75 : 90,
        youngerTeen ? 60 : teen ? 75 : 120,
        "age- and sex-based adequate intake",
      );
    case "vitamin_b1":
      return sexTarget(
        sex,
        youngerTeen ? 0.9 : teen ? 1 : 1.1,
        youngerTeen ? 0.9 : 1.2,
        "age- and sex-based RDA",
      );
    case "vitamin_b2":
      return sexTarget(
        sex,
        youngerTeen ? 0.9 : teen ? 1 : 1.1,
        youngerTeen ? 0.9 : 1.3,
        "age- and sex-based RDA",
      );
    case "vitamin_b3":
      return sexTarget(
        sex,
        youngerTeen ? 12 : 14,
        youngerTeen ? 12 : 16,
        "age- and sex-based RDA",
      );
    case "vitamin_b5":
      return target(youngerTeen ? 4 : 5, "age-based adequate intake");
    case "vitamin_b6":
      return sexTarget(
        sex,
        youngerTeen ? 1 : teen ? 1.2 : older ? 1.5 : 1.3,
        youngerTeen ? 1 : teen ? 1.3 : older ? 1.7 : 1.3,
        "age- and sex-based RDA",
      );
    case "vitamin_b9":
      return target(youngerTeen ? 300 : 400, "dietary folate equivalent RDA");
    case "biotin":
      return target(youngerTeen ? 20 : teen ? 25 : 30, "age-based adequate intake");
    default:
      return undefined;
  }
}

export function nutrientReferenceScaleValue(
  reference: DailyNutrientReference | undefined,
) {
  return reference?.target ?? reference?.max ?? reference?.min ?? 0;
}
