import type { MetricDefinition } from "@/src/types";

export type AnimatedMetricValueFormat = {
  kind: "number" | "screen-time";
  decimals: number;
  unit: string;
  groupSeparator: string;
  decimalSeparator: string;
  negativePrefix: string;
  digits: string[];
  hourUnit: string;
  minuteUnit: string;
};

function numberParts(locale: string | undefined, value: number) {
  return new Intl.NumberFormat(locale).formatToParts(value);
}

/** Captures locale tokens once on JS; the UI-thread formatter needs no Intl. */
export function animatedMetricValueFormat(
  metric: MetricDefinition,
  target: number,
  locale?: string,
): AnimatedMetricValueFormat {
  const parts = numberParts(locale, 12_345.6);
  const negativeParts = numberParts(locale, -1);
  const firstInteger = negativeParts.findIndex((part) => part.type === "integer");
  const roundedTarget = Number(target.toFixed(1));
  return {
    kind: metric.id === "screen_time" ? "screen-time" : "number",
    decimals:
      Math.abs(target) >= 1_000 || Number.isInteger(roundedTarget) ? 0 : 1,
    unit: metric.unit,
    groupSeparator: parts.find((part) => part.type === "group")?.value ?? ",",
    decimalSeparator:
      parts.find((part) => part.type === "decimal")?.value ?? ".",
    negativePrefix: negativeParts
      .slice(0, Math.max(0, firstInteger))
      .map((part) => part.value)
      .join(""),
    digits: Array.from({ length: 10 }, (_, digit) =>
      new Intl.NumberFormat(locale, { useGrouping: false }).format(digit),
    ),
    hourUnit: "hr",
    minuteUnit: "min",
  };
}

export function animatedMetricValueAtProgress(
  from: number,
  to: number,
  progress: number,
) {
  "worklet";
  const bounded = Math.max(0, Math.min(1, progress));
  return from + (to - from) * bounded;
}

function localizedDigits(value: string, digits: string[]) {
  "worklet";
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index) - 48;
    result += code >= 0 && code <= 9 ? digits[code] : value[index];
  }
  return result;
}

function groupedInteger(value: string, separator: string) {
  "worklet";
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (index > 0 && (value.length - index) % 3 === 0) result += separator;
    result += value[index];
  }
  return result;
}

/** Matches formatMetricValue while remaining safe to execute as a worklet. */
export function formatAnimatedMetricValue(
  value: number,
  format: AnimatedMetricValueFormat,
) {
  "worklet";
  if (format.kind === "screen-time") {
    const totalMinutes = Math.max(0, Math.round(value));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    // formatMetricValue's duration formatter deliberately uses ASCII digits.
    const localizedHours = String(hours);
    const localizedMinutes = String(minutes);
    if (totalMinutes < 60)
      return `${localizedMinutes} ${format.minuteUnit}`;
    return minutes
      ? `${localizedHours} ${format.hourUnit} ${localizedMinutes} ${format.minuteUnit}`
      : `${localizedHours} ${format.hourUnit}`;
  }

  const finiteValue = Number.isFinite(value) ? value : 0;
  const scale = format.decimals === 0 ? 1 : 10;
  const rounded = Math.round(Math.abs(finiteValue) * scale) / scale;
  const fixed = rounded.toFixed(format.decimals);
  const [integer, fraction] = fixed.split(".");
  const grouped = groupedInteger(integer, format.groupSeparator);
  const localizedNumber = localizedDigits(
    fraction === undefined
      ? grouped
      : `${grouped}${format.decimalSeparator}${fraction}`,
    format.digits,
  );
  const sign = finiteValue < 0 && rounded > 0 ? format.negativePrefix || "-" : "";
  return `${sign}${localizedNumber}${format.unit ? ` ${format.unit}` : ""}`;
}
