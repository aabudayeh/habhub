import { MetricEntry, PhotoUpdate } from "@/src/types";

/**
 * Deliberately use a short, useful scale instead of forcing dozens of taps.
 * The UI walks this scale with compact minus/plus controls.
 */
export const PHOTO_VIDEO_SPEEDS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20] as const;
export type PhotoVideoSpeed = (typeof PHOTO_VIDEO_SPEEDS)[number];

export function adjacentPhotoVideoSpeed(
  current: PhotoVideoSpeed,
  direction: -1 | 1,
): PhotoVideoSpeed {
  const currentIndex = Math.max(0, PHOTO_VIDEO_SPEEDS.indexOf(current));
  const nextIndex = Math.max(
    0,
    Math.min(PHOTO_VIDEO_SPEEDS.length - 1, currentIndex + direction),
  );
  return PHOTO_VIDEO_SPEEDS[nextIndex];
}

/**
 * Photo progress is deliberately ordered from oldest to newest. Stable tie
 * breakers keep several photos from one day in their capture order.
 */
export function chronologicalProgressPhotos(photos: PhotoUpdate[]) {
  return [...photos].sort(
    (left, right) =>
      left.localDate.localeCompare(right.localDate) ||
      (left.capturedAt ?? left.createdAt).localeCompare(
        right.capturedAt ?? right.createdAt,
      ) ||
      left.id.localeCompare(right.id),
  );
}

/** Calendar-only label: unlike friendlyDate, this never changes to "Today". */
export function fullPhotoDate(localDate: string, locale?: string) {
  const parsed = new Date(`${localDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return localDate;
  return parsed.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Return the latest weight logged on the photo's exact calendar date. */
export type PhotoBodyMetricId = "weight" | "body_fat" | "lean_body_mass";

export type PhotoMetricMeasurement = {
  metricId: PhotoBodyMetricId;
  value: number;
  localDate: string;
  daysAway: number;
};

function calendarDayNumber(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Choose the closest canonical body measurement. Same-day values win; ties
 * prefer the later measurement and then the most recently recorded row.
 */
export function nearestPhotoMeasurement(
  entries: MetricEntry[],
  userId: string,
  photoDate: string,
  metricId: PhotoBodyMetricId,
): PhotoMetricMeasurement | undefined {
  const photoDay = calendarDayNumber(photoDate);
  const entry = entries
    .filter(
      (candidate) =>
        candidate.userId === userId &&
        candidate.metricId === metricId &&
        Number.isFinite(Number(candidate.value)),
    )
    .sort(
      (left, right) =>
        Math.abs(calendarDayNumber(left.localDate) - photoDay) -
          Math.abs(calendarDayNumber(right.localDate) - photoDay) ||
        right.localDate.localeCompare(left.localDate) ||
        right.recordedAt.localeCompare(left.recordedAt) ||
        right.id.localeCompare(left.id),
    )[0];
  if (!entry) return undefined;
  return {
    metricId,
    value: Number(entry.value),
    localDate: entry.localDate,
    daysAway: Math.abs(calendarDayNumber(entry.localDate) - photoDay),
  };
}

export function photoMeasurementLabel(
  entries: MetricEntry[],
  userId: string,
  localDate: string,
  metricId: PhotoBodyMetricId,
  locale?: string,
) {
  const measurement = nearestPhotoMeasurement(entries, userId, localDate, metricId);
  if (!measurement) return undefined;
  const unit = metricId === "body_fat" ? "%" : "kg";
  const name =
    metricId === "weight"
      ? "Weight"
      : metricId === "body_fat"
        ? "Body fat"
        : "Lean mass";
  const value = `${measurement.value.toLocaleString(locale, {
    maximumFractionDigits: 1,
  })} ${unit}`;
  const discrepancy =
    measurement.daysAway > 7
      ? ` · measured ${fullPhotoDate(measurement.localDate, locale)} (${measurement.daysAway}d away)`
      : "";
  return {
    ...measurement,
    name,
    value,
    label: `${name} ${value}${discrepancy}`,
    compactLabel:
      metricId === "weight" ? `${value}${discrepancy}` : `${name} ${value}${discrepancy}`,
  };
}

export function photoWeightLabel(
  entries: MetricEntry[],
  userId: string,
  localDate: string,
  locale?: string,
) {
  return photoMeasurementLabel(entries, userId, localDate, "weight", locale)
    ?.compactLabel;
}

/** 0.5x = two seconds per image; 20x = 50 milliseconds per image. */
export function photoFrameDurationMs(speed: PhotoVideoSpeed) {
  return Math.max(50, Math.round(1_000 / speed));
}

export function photoIndexAtOffset(
  offset: number,
  trackWidth: number,
  photoCount: number,
) {
  if (photoCount <= 1 || trackWidth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, offset / trackWidth));
  return Math.max(0, Math.min(photoCount - 1, Math.round(ratio * (photoCount - 1))));
}
