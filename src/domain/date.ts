export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatClockTime(
  input: Date | string,
  format: "12h" | "24h" = "24h",
  locale?: string,
): string {
  const date =
    input instanceof Date
      ? input
      : /^\d{2}:\d{2}$/.test(input)
        ? new Date(`2000-01-01T${input}:00`)
        : new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12h",
  });
}

export type TwelveHourDialCursor = {
  dialMinutes: number;
  absoluteMinutes: number;
};

/**
 * Advances a 12-hour clock hand without losing its AM/PM half-day.
 * The hand position is 0..719, while the returned absolute value remains
 * 0..1439 so the rest of the app can keep using its normal 24-hour storage.
 */
export function advanceTwelveHourDial(
  dialMinutes: number,
  cursor: TwelveHourDialCursor,
): TwelveHourDialCursor {
  const halfDayMinutes = 12 * 60;
  const dayMinutes = 24 * 60;
  const normalizedDial =
    ((Math.round(dialMinutes) % halfDayMinutes) + halfDayMinutes) %
    halfDayMinutes;
  let delta = normalizedDial - cursor.dialMinutes;
  if (delta > halfDayMinutes / 2) delta -= halfDayMinutes;
  else if (delta < -halfDayMinutes / 2) delta += halfDayMinutes;
  return {
    dialMinutes: normalizedDial,
    absoluteMinutes:
      ((cursor.absoluteMinutes + delta) % dayMinutes + dayMinutes) % dayMinutes,
  };
}

export function dateKeyWithOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function shortDay(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
}

export function friendlyDate(date: string, locale?: string): string {
  if (date === dateKey()) return 'Today';
  if (date === dateKeyWithOffset(-1)) return 'Yesterday';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );
}

export function compactDayDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function dateWithOffsetFrom(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function dateRangeEnding(localDate: string, length: number): string[] {
  return Array.from({ length }, (_, index) => dateWithOffsetFrom(localDate, index - length + 1));
}

export function calendarWeekRange(
  localDate: string,
  weekStartsOn: 0 | 1 | 6 = 1,
): string[] {
  const anchor = new Date(`${localDate}T12:00:00`);
  const offset = (anchor.getDay() - weekStartsOn + 7) % 7;
  const start = dateWithOffsetFrom(localDate, -offset);
  return Array.from({ length: 7 }, (_, index) =>
    dateWithOffsetFrom(start, index),
  );
}

export function monthDateRange(localDate: string): string[] {
  const date = new Date(`${localDate}T12:00:00`);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, index) => dateKey(new Date(date.getFullYear(), date.getMonth(), index + 1, 12)));
}

export function yearDateRange(localDate: string): string[] {
  const date = new Date(`${localDate}T12:00:00`);
  const year = date.getFullYear();
  const days =
    (new Date(year + 1, 0, 1, 12).getTime() -
      new Date(year, 0, 1, 12).getTime()) /
    86400000;
  return Array.from({ length: days }, (_, index) =>
    dateKey(new Date(year, 0, index + 1, 12)),
  );
}

export function calendarPeriodRange(
  localDate: string,
  period: "week" | "month" | "year",
  weekStartsOn: 0 | 1 | 6 = 1,
): string[] {
  if (period === "week") return calendarWeekRange(localDate, weekStartsOn);
  if (period === "month") return monthDateRange(localDate);
  return yearDateRange(localDate);
}

export function relativeTime(isoString: string): string {
  const timestamp = new Date(isoString).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
