export type ScreenTimeLikeApp = {
  foregroundMs: number;
};

export type ScreenTimeLikeReport<TApp extends ScreenTimeLikeApp> = {
  screenTimeMs: number;
  apps: TApp[];
};

export type ScreenTimeDailySample = {
  localDate: string;
  from: number;
  to: number;
  screenTimeMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Android's UsageStats fallback can return an expanded aggregation bucket
 * instead of the exact requested window. A single calendar-day tracker value
 * can never exceed the length of that day, so reject impossible legacy/native
 * values at the domain boundary as well as in the native implementation.
 */
export function boundedScreenTimeMs(value: number, windowMs = DAY_MS) {
  if (!Number.isFinite(value) || !Number.isFinite(windowMs) || windowMs <= 0)
    return 0;
  return Math.max(0, Math.min(value, windowMs));
}

/** Converts native daily samples into private tracker rows without totals. */
export function screenTimeTrackerSamples(
  samples: readonly ScreenTimeDailySample[] | undefined,
) {
  return (samples ?? [])
    .filter(
      (sample) =>
        /^\d{4}-\d{2}-\d{2}$/.test(sample.localDate) &&
        Number.isFinite(sample.from) &&
        Number.isFinite(sample.to) &&
        sample.to > sample.from,
    )
    .map((sample) => ({
      localDate: sample.localDate,
      minutes:
        Math.round(
          (boundedScreenTimeMs(
            sample.screenTimeMs,
            sample.to - sample.from,
          ) /
            60_000) *
            10,
        ) / 10,
      // `to` is exclusive and is normally the following local midnight.
      // Keep the imported entry timestamp inside the day it represents.
      recordedAt: new Date(Math.max(sample.from, sample.to - 1)).toISOString(),
    }));
}

/**
 * Keeps a retained-history refresh from replacing hundreds of unchanged rows.
 * The caller supplies only the current user's Android-owned rows, which keeps
 * this calculation platform-independent and makes the eventual store write a
 * single, minimal batch.
 */
export function changedScreenTimeTrackerSamples<
  TSample extends { localDate: string; minutes: number },
  TEntry extends {
    localDate: string;
    value: number | boolean | string;
  },
>(samples: readonly TSample[], existingEntries: readonly TEntry[]) {
  const currentByDate = new Map(
    existingEntries
      .filter(
        (entry) =>
          typeof entry.value === "number" && Number.isFinite(entry.value),
      )
      .map((entry) => [entry.localDate, Number(entry.value)] as const),
  );
  return samples.filter((sample) => {
    const current = currentByDate.get(sample.localDate);
    return current === undefined || Math.abs(current - sample.minutes) >= 0.05;
  });
}

/** Removes values written by the pre-v4 expanded-bucket implementation. */
export function repairLegacyScreenTimeEntries<
  TEntry extends {
    metricId: string;
    sourceOrigin?: string;
    value: number | boolean | string;
  },
>(entries: readonly TEntry[]): TEntry[] {
  let changed = false;
  const repaired = entries.filter((entry) => {
    if (
      entry.metricId !== "screen_time" ||
      entry.sourceOrigin !== "android_usage_stats"
    )
      return true;
    if (
      typeof entry.value === "number" &&
      Number.isFinite(entry.value) &&
      entry.value >= 0 &&
      entry.value <= 1_440
    )
      return true;
    // Clamping 44 hours to 24 would still display a fabricated historical
    // value. Drop only the corrupted device-owned row; the next range query
    // recreates the date from a bounded native daily sample.
    changed = true;
    return false;
  });
  return changed ? repaired : (entries as TEntry[]);
}

/**
 * Converts a calendar-range UsageStats report into a per-day report. Android
 * returns totals for the queried interval, while HabHub's range UI compares
 * daily tracker values and therefore must show a daily average.
 */
export function averageScreenTimeReport<
  TApp extends ScreenTimeLikeApp,
  TReport extends ScreenTimeLikeReport<TApp>,
>(report: TReport, calendarDays: number): TReport {
  const divisor = Math.max(1, Math.floor(calendarDays));
  if (divisor === 1) return report;
  return {
    ...report,
    screenTimeMs: report.screenTimeMs / divisor,
    apps: report.apps.map((app) => ({
      ...app,
      foregroundMs: app.foregroundMs / divisor,
    })),
  };
}

/**
 * Counts selected calendar days actually covered by a bounded native report.
 * UsageStats caps very long requests, so an all-time selector must not divide
 * a 366-day response by every older date shown in the UI.
 */
export function screenTimeSampledDayCount(
  selectedDayStarts: readonly number[],
  reportFrom: number,
  reportTo: number,
) {
  const covered = selectedDayStarts.filter(
    (dayStart) => dayStart >= reportFrom && dayStart < reportTo,
  ).length;
  return Math.max(1, covered);
}

/** Formats a duration stored in minutes without collapsing it to total minutes. */
export function formatMinuteDuration(
  valueMinutes: number,
  hourUnit = "hr",
  minuteUnit = "min",
) {
  const minutes = Math.max(0, Math.round(valueMinutes));
  if (minutes < 60) return `${minutes} ${minuteUnit}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? `${hours} ${hourUnit} ${remainder} ${minuteUnit}`
    : `${hours} ${hourUnit}`;
}
