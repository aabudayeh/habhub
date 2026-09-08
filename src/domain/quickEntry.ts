import type { MetricDefinition, MetricQuickEntry } from "@/src/types";

const EPSILON = 1e-9;

function isStepAligned(value: number, step: number) {
  const steps = value / step;
  return Math.abs(steps - Math.round(steps)) <= EPSILON;
}

function decimalPlaces(value: number) {
  const [coefficient, exponentText] = String(value).toLowerCase().split("e");
  const coefficientPlaces = (coefficient.split(".")[1] ?? "").length;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Math.max(0, coefficientPlaces - exponent);
}

export function normalizedQuickEntry(
  metric: Pick<MetricDefinition, "dataType" | "quickEntry">,
): MetricQuickEntry | undefined {
  const candidate = metric.quickEntry;
  if (
    metric.dataType !== "number" ||
    candidate?.kind !== "stepper" ||
    !Number.isFinite(candidate.step) ||
    candidate.step <= 0
  )
    return undefined;
  const candidateMinimum = Number(candidate.minimum);
  const minimum =
    Number.isFinite(candidateMinimum) &&
    candidateMinimum >= 0 &&
    isStepAligned(candidateMinimum, candidate.step)
      ? candidateMinimum
      : candidate.step;
  const candidateMaximum = Number(candidate.maximum);
  const maximum =
    Number.isFinite(candidateMaximum) &&
    candidateMaximum >= minimum &&
    isStepAligned(candidateMaximum, candidate.step)
      ? candidateMaximum
      : undefined;
  return {
    kind: "stepper",
    step: candidate.step,
    minimum,
    maximum,
    stepLabel: candidate.stepLabel?.trim() || undefined,
  };
}

export function quickEntryStepCount(value: number, step: number) {
  return Number.isFinite(value) && Number.isFinite(step) && step > 0
    ? value / step
    : 0;
}

export function adjustQuickEntryValue(
  value: number,
  configuration: MetricQuickEntry,
  direction: -1 | 1,
) {
  const step = configuration.step;
  const minimum = configuration.minimum ?? step;
  const current = Number.isFinite(value)
    ? Math.round((value + EPSILON) / step) * step
    : minimum;
  const unbounded = current + direction * step;
  const bounded = Math.max(
    minimum,
    configuration.maximum === undefined
      ? unbounded
      : Math.min(configuration.maximum, unbounded),
  );
  const precision = Math.min(
    15,
    decimalPlaces(step),
  );
  return Number(bounded.toFixed(precision));
}

export function isQuickEntryAligned(
  value: number,
  configuration: MetricQuickEntry,
) {
  if (!Number.isFinite(value)) return false;
  const minimum = configuration.minimum ?? configuration.step;
  if (value < minimum - EPSILON) return false;
  if (
    configuration.maximum !== undefined &&
    value > configuration.maximum + EPSILON
  )
    return false;
  return isStepAligned(value, configuration.step);
}

export function quickEntryLabel(
  count: number,
  configuration: MetricQuickEntry,
) {
  const base = configuration.stepLabel?.trim() || "step";
  return Math.abs(count - 1) < EPSILON ? base : `${base}s`;
}
