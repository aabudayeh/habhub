import { MetricDefinition } from "@/src/types";

export type AssistantCommandKind =
  | "number"
  | "food"
  | "blood_pressure"
  | "complete"
  | "text";

export type AssistantCommandParams = {
  kind?: string;
  tracker?: string;
  amount?: string;
  unit?: string;
  calories?: string;
  meal?: string;
  food?: string;
  systolic?: string;
  diastolic?: string;
  pulse?: string;
  value?: string;
};

export type AssistantLogDraft = {
  kind: AssistantCommandKind;
  metric?: MetricDefinition;
  value?: number | boolean | string;
  displayValue?: string;
  note?: string;
  label?: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  submetricValues?: Record<string, number>;
  error?: string;
};

const ALIASES: Record<string, string[]> = {
  food: ["food", "calorie", "calories", "meal", "nutrition"],
  water: ["water", "hydration"],
  exercise: [
    "active energy",
    "activity calories",
    "calories burned",
    "burned calories",
  ],
  energy_burned: ["energy burned", "total energy", "total calories burned"],
  workout: ["workout", "exercise completed"],
  workout_duration: ["workout duration", "exercise duration"],
  workout_distance: ["workout distance", "exercise distance"],
  weight: ["weight", "body weight"],
  blood_pressure_systolic: ["blood pressure", "bp"],
  pulse: ["pulse", "heart rate"],
  sleep: ["sleep", "sleep duration"],
  blood_glucose: ["blood glucose", "glucose", "blood sugar"],
  body_fat: ["body fat", "body fat percentage"],
  lean_body_mass: ["lean body mass", "lean mass"],
  body_water_mass: ["body water mass", "body water"],
  bone_mass: ["bone mass"],
};

function normalize(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\b(?:my|the|tracker|metric|log|entry)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metricTerms(metric: MetricDefinition) {
  return [
    normalize(metric.id),
    normalize(metric.name),
    ...(ALIASES[metric.id] ?? []).map(normalize),
  ].filter(Boolean);
}

function metricCanAccept(
  metric: MetricDefinition,
  kind: AssistantCommandKind,
) {
  if (
    metric.id === "steps" ||
    metric.manualEntry === false ||
    metric.dataType === "calculated" ||
    metric.dataType === "photo"
  )
    return false;
  if (kind === "complete") return metric.dataType === "boolean";
  if (kind === "text") return metric.dataType === "text";
  return metric.dataType === "number";
}

export function assistantLoggableMetrics(
  metrics: MetricDefinition[],
  kind: AssistantCommandKind,
) {
  return metrics.filter((metric) => metricCanAccept(metric, kind));
}

export function resolveAssistantMetric(
  metrics: MetricDefinition[],
  query: string | undefined,
  kind: AssistantCommandKind,
) {
  const normalized = normalize(query);
  if (!normalized) return undefined;
  const candidates = assistantLoggableMetrics(metrics, kind);
  const best = candidates
    .map((metric) => {
      const terms = metricTerms(metric);
      const exact = terms.some((term) => term === normalized);
      const contained = terms
        .filter(
          (term) =>
            term.length > 2 &&
            (normalized.includes(term) || term.includes(normalized)),
        )
        .sort((a, b) => b.length - a.length)[0];
      return {
        metric,
        score: exact ? 1000 : contained ? 100 + contained.length : 0,
      };
    })
    .sort((a, b) => b.score - a.score)[0];
  return best?.score ? best.metric : undefined;
}

type UnitFamily = {
  canonical: string;
  units: Record<string, number>;
};

const UNIT_FAMILIES: UnitFamily[] = [
  {
    canonical: "l",
    units: {
      l: 1,
      liter: 1,
      litre: 1,
      ml: 0.001,
      milliliter: 0.001,
      millilitre: 0.001,
      cup: 0.236588,
      "fluid ounce": 0.0295735,
      floz: 0.0295735,
    },
  },
  {
    canonical: "min",
    units: {
      min: 1,
      minute: 1,
      hr: 60,
      hour: 60,
      sec: 1 / 60,
      second: 1 / 60,
    },
  },
  {
    canonical: "hr",
    units: {
      hr: 1,
      hour: 1,
      min: 1 / 60,
      minute: 1 / 60,
    },
  },
  {
    canonical: "kg",
    units: { kg: 1, kilogram: 1, lb: 0.453592, pound: 0.453592 },
  },
  {
    canonical: "km",
    units: {
      km: 1,
      kilometer: 1,
      kilometre: 1,
      mi: 1.60934,
      mile: 1.60934,
      m: 0.001,
      meter: 0.001,
      metre: 0.001,
    },
  },
  {
    canonical: "g",
    units: { g: 1, gram: 1, mg: 0.001, milligram: 0.001, kg: 1000 },
  },
  {
    canonical: "mg",
    units: { mg: 1, milligram: 1, g: 1000, gram: 1000 },
  },
  {
    canonical: "kcal",
    units: {
      kcal: 1,
      calorie: 1,
      cal: 1,
      kilocalorie: 1,
      kj: 1 / 4.184,
      kilojoule: 1 / 4.184,
    },
  },
];

function normalizeUnit(value: string | undefined) {
  return normalize(value)
    .replace(/\bfluid ounces\b/, "fluid ounce")
    .replace(/\bfl oz\b/, "floz")
    .replace(/s$/, "");
}

export function convertAssistantAmount(
  amount: number,
  spokenUnit: string | undefined,
  metric: MetricDefinition,
) {
  const source = normalizeUnit(spokenUnit);
  const target = normalizeUnit(metric.unit);
  if (!source || !target || source === target)
    return { value: amount, converted: false };
  const family = UNIT_FAMILIES.find(
    (candidate) =>
      normalizeUnit(candidate.canonical) === target &&
      candidate.units[source] !== undefined,
  );
  if (!family)
    return {
      value: amount,
      converted: false,
      warning: `I could not convert ${spokenUnit} to ${metric.unit}. Check the value before logging.`,
    };
  return {
    value: Math.round(amount * family.units[source] * 10000) / 10000,
    converted: true,
  };
}

function commandKind(value: string | undefined): AssistantCommandKind {
  return value === "food" ||
    value === "blood_pressure" ||
    value === "complete" ||
    value === "text"
    ? value
    : "number";
}

function mealType(value: string | undefined) {
  const normalized = normalize(value);
  if (normalized.includes("breakfast")) return "breakfast" as const;
  if (normalized.includes("lunch")) return "lunch" as const;
  if (normalized.includes("dinner") || normalized.includes("supper"))
    return "dinner" as const;
  if (normalized.includes("snack")) return "snack" as const;
  return undefined;
}

export function buildAssistantLogDraft(
  metrics: MetricDefinition[],
  params: AssistantCommandParams,
  metricOverride?: MetricDefinition,
): AssistantLogDraft {
  const kind = commandKind(params.kind);
  const query =
    kind === "food"
      ? "food"
      : kind === "blood_pressure"
        ? "blood pressure"
        : params.tracker;
  const metric =
    metricOverride ??
    resolveAssistantMetric(
      metrics,
      query,
      kind === "food" || kind === "blood_pressure" ? "number" : kind,
    );

  if (!metric) {
    return {
      kind,
      error: query
        ? `No editable tracker matched “${query}”. Choose a tracker before logging.`
        : "Google Assistant did not provide a tracker.",
    };
  }

  if (kind === "complete") {
    return {
      kind,
      metric,
      value: true,
      displayValue: "Completed",
      note: "Logged with Google Assistant",
    };
  }

  if (kind === "text") {
    const value = params.value?.trim();
    return value
      ? {
          kind,
          metric,
          value,
          displayValue: value,
          note: "Logged with Google Assistant",
        }
      : { kind, metric, error: "Google Assistant did not provide a value." };
  }

  if (kind === "blood_pressure") {
    const systolic = numeric(params.systolic);
    const diastolic = numeric(params.diastolic);
    const pulse = numeric(params.pulse);
    if (systolic === undefined || diastolic === undefined)
      return {
        kind,
        metric,
        error: "Both systolic and diastolic readings are required.",
      };
    return {
      kind,
      metric,
      value: systolic,
      displayValue: `${Math.round(systolic)}/${Math.round(diastolic)} mmHg${pulse === undefined ? "" : ` · ${Math.round(pulse)} bpm`}`,
      note: "Logged with Google Assistant",
      submetricValues: {
        systolic,
        diastolic,
        ...(pulse === undefined ? {} : { pulse }),
      },
    };
  }

  const amount = numeric(kind === "food" ? params.calories : params.amount);
  if (amount === undefined)
    return {
      kind,
      metric,
      error: "Google Assistant did not provide a numeric amount.",
    };
  const conversion = convertAssistantAmount(amount, params.unit, metric);
  const meal = mealType(params.meal);
  const foodLabel = params.food?.trim();
  return {
    kind,
    metric,
    value: conversion.value,
    displayValue: `${Math.round(conversion.value * 100) / 100}${metric.unit ? ` ${metric.unit}` : ""}`,
    note: [
      "Logged with Google Assistant",
      conversion.warning,
    ]
      .filter(Boolean)
      .join(" · "),
    label:
      foodLabel ||
      (meal ? `${meal.slice(0, 1).toUpperCase()}${meal.slice(1)}` : undefined),
    mealType: meal,
  };
}
