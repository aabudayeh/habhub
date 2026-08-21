import type { GoogleHealthDateRange } from "./google-health-sync.ts";

type WebhookEvent = { payload: Record<string, unknown> };

function dateKey(value: unknown) {
  const text = String(value ?? "");
  const key = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Date.parse(`${key}T12:00:00Z`))
    ? key
    : undefined;
}

function dateFromCivil(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const dateTime = value as Record<string, unknown>;
  const date = dateTime.date && typeof dateTime.date === "object" && !Array.isArray(dateTime.date)
    ? dateTime.date as Record<string, unknown>
    : dateTime;
  const year = Number(date.year);
  const month = Number(date.month);
  const day = Number(date.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  return dateKey(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function addDateDays(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function currentDateForProfile(now: Date, timezone: unknown) {
  const utcEnvelope = addDateDays(now.toISOString().slice(0, 10), 1);
  if (typeof timezone === "string" && timezone.trim()) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const key = dateKey(`${value.year}-${value.month}-${value.day}`);
      if (key) return key > utcEnvelope ? key : utcEnvelope;
    } catch {
      // Invalid/missing legacy profile zones use the east-of-UTC safety bound.
    }
  }
  // A civil date can legitimately be tomorrow relative to UTC for profiles
  // east of the date boundary. One extra civil day is bounded and prevents a
  // signed correction from being acknowledged but silently discarded.
  return utcEnvelope;
}

export function googleHealthWebhookEventRange(
  event: WebhookEvent,
  latestAllowedDate: string,
): GoogleHealthDateRange | undefined {
  const data = event.payload?.data && typeof event.payload.data === "object" && !Array.isArray(event.payload.data)
    ? event.payload.data as Record<string, unknown>
    : undefined;
  const candidates: string[] = [];
  for (const raw of Array.isArray(data?.intervals) ? data.intervals : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const interval = raw as Record<string, unknown>;
    const iso = interval.civilIso8601TimeInterval && typeof interval.civilIso8601TimeInterval === "object"
      ? interval.civilIso8601TimeInterval as Record<string, unknown>
      : {};
    const civil = interval.civilDateTimeInterval && typeof interval.civilDateTimeInterval === "object"
      ? interval.civilDateTimeInterval as Record<string, unknown>
      : {};
    const physical = interval.physicalTimeInterval && typeof interval.physicalTimeInterval === "object"
      ? interval.physicalTimeInterval as Record<string, unknown>
      : {};
    for (const value of [
      dateKey(iso.startTime), dateKey(iso.endTime),
      dateFromCivil(civil.startDateTime), dateFromCivil(civil.endDateTime),
      dateKey(physical.startTime), dateKey(physical.endTime),
    ]) if (value) candidates.push(value);
  }
  const safeLatest = dateKey(latestAllowedDate);
  if (!candidates.length || !safeLatest) return undefined;
  candidates.sort();
  const earliest = addDateDays(safeLatest, -3650);
  let fromDate = addDateDays(candidates[0], -1);
  let throughDate = addDateDays(candidates[candidates.length - 1], 1);
  if (fromDate < earliest) fromDate = earliest;
  if (throughDate > safeLatest) throughDate = safeLatest;
  if (throughDate < fromDate) return undefined;
  return { fromDate, throughDate };
}
