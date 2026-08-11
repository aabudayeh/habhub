export type ScreenTimeLikeApp = {
  foregroundMs: number;
};

export type ScreenTimeLikeReport<TApp extends ScreenTimeLikeApp> = {
  screenTimeMs: number;
  apps: TApp[];
};

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
