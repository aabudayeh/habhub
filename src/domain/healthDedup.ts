import type { HealthImportRecord } from "../health/types";
import type {
  HealthDataType,
  HealthSourcePreference,
} from "../types";

const MINUTE_MS = 60_000;

function finiteTime(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numeric(value: number | boolean) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function closeNumber(
  left: number | undefined,
  right: number | undefined,
  absoluteTolerance: number,
  relativeTolerance = 0.06,
) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  const a = Number(left);
  const b = Number(right);
  return (
    Math.abs(a - b) <=
    Math.max(absoluteTolerance, Math.max(Math.abs(a), Math.abs(b)) * relativeTolerance)
  );
}

/** Stable internal source key. Raw package ids remain on the preference row. */
export function healthSourceId(origin: string | undefined) {
  const normalized = String(origin ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "health-system";
  if (
    normalized.includes("com.android.healthconnect.phone") ||
    normalized.includes("com.google.android.apps.healthdata") ||
    normalized === "health connect"
  )
    return "health-connect-device";
  if (normalized.includes("shealth") || normalized.includes("samsung"))
    return "samsung-health";
  if (normalized.includes("myfitnesspal")) return "myfitnesspal";
  if (normalized.includes("google") && normalized.includes("fit"))
    return "google-fit";
  if (
    normalized === "apple health" ||
    normalized.includes("com.apple.health")
  )
    return "apple-health";
  return normalized.replace(/\s+/g, "-");
}

export function healthSourceEnabled(
  origin: string | undefined,
  preferences: Record<string, HealthSourcePreference> | undefined,
) {
  return preferences?.[healthSourceId(origin)]?.enabled !== false;
}

export function healthRecordOrigins(record: HealthImportRecord) {
  return [
    ...(record.sourceOrigins ?? []),
    ...(record.origin ? [record.origin] : []),
  ].filter((origin, index, all) => origin && all.indexOf(origin) === index);
}

export function mergeHealthSourcePreferences(
  current: Record<string, HealthSourcePreference> | undefined,
  records: HealthImportRecord[],
) {
  let next = current ?? {};
  let changed = false;
  for (const origin of records.flatMap(healthRecordOrigins)) {
    const id = healthSourceId(origin);
    if (next[id]) continue;
    if (!changed) next = { ...next };
    next[id] = { enabled: true, origin };
    changed = true;
  }
  return changed ? next : current;
}

/** Lower numbers win when two apps publish the same semantic measurement. */
export function healthSourcePriority(
  origin: string | undefined,
  type: HealthDataType,
) {
  const id = healthSourceId(origin);
  if (type === "nutrition" && id === "myfitnesspal") return 0;
  if (type === "steps" && id === "samsung-health") return 0;
  if (id === "google-fit") return 8;
  if (id === "samsung-health") return type === "nutrition" ? 35 : 10;
  if (id === "myfitnesspal") return 12;
  if (id === "apple-health") return 90;
  if (id === "health-connect-device" || id === "health-system") return 100;
  return 25;
}

function sameInterval(left: HealthImportRecord, right: HealthImportRecord) {
  const leftStart = finiteTime(left.startTime);
  const rightStart = finiteTime(right.startTime);
  const leftEnd = finiteTime(left.endTime);
  const rightEnd = finiteTime(right.endTime);
  const startClose = Math.abs(leftStart - rightStart) <= 3 * MINUTE_MS;
  const endClose = Math.abs(leftEnd - rightEnd) <= 3 * MINUTE_MS;
  const overlap = Math.max(
    0,
    Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
  );
  const shorter = Math.max(
    1,
    Math.min(leftEnd - leftStart, rightEnd - rightStart),
  );
  return (startClose && endClose) || overlap / shorter >= 0.9;
}

function samePoint(left: HealthImportRecord, right: HealthImportRecord) {
  return (
    Math.abs(finiteTime(left.endTime) - finiteTime(right.endTime)) <=
    5 * MINUTE_MS
  );
}

function nutritionEquivalent(
  left: HealthImportRecord,
  right: HealthImportRecord,
) {
  const leftName = cleanText(left.label);
  const rightName = cleanText(right.label);
  if (
    leftName &&
    rightName &&
    leftName !== rightName &&
    !leftName.includes(rightName) &&
    !rightName.includes(leftName)
  )
    return false;
  const pairs: [number | undefined, number | undefined, number][] = [
    [left.nutrition?.proteinG, right.nutrition?.proteinG, 1],
    [left.nutrition?.carbsG, right.nutrition?.carbsG, 1],
    [left.nutrition?.fatG, right.nutrition?.fatG, 1],
  ];
  return (
    closeNumber(numeric(left.value), numeric(right.value), 2, 0.08) &&
    pairs.every(([a, b, tolerance]) => closeNumber(a, b, tolerance, 0.08))
  );
}

/**
 * Strong semantic equivalence used only across different source apps. It is
 * deliberately conservative so two genuine meals, glasses of water, or
 * workouts remain distinct even when their time ranges overlap.
 */
export function healthRecordsAreEquivalent(
  left: HealthImportRecord,
  right: HealthImportRecord,
) {
  if (left.type !== right.type) return false;
  if (healthSourceId(left.origin) === healthSourceId(right.origin)) return false;
  if ((left.workoutRecordKind ?? "session") !== (right.workoutRecordKind ?? "session"))
    return false;
  if (left.type === "steps") {
    return left.endTime.slice(0, 10) === right.endTime.slice(0, 10);
  }
  if (left.type === "menstruation")
    return left.endTime.slice(0, 10) === right.endTime.slice(0, 10);
  if (left.type === "nutrition")
    return samePoint(left, right) && nutritionEquivalent(left, right);
  if (left.type === "workouts") {
    if (!sameInterval(left, right)) return false;
    if (left.activityKey && right.activityKey)
      return left.activityKey === right.activityKey;
    const a = cleanText(left.label);
    const b = cleanText(right.label);
    return !a || !b || a === b || a.includes(b) || b.includes(a);
  }
  if (left.type === "sleep" || left.type === "active_energy") {
    return (
      sameInterval(left, right) &&
      closeNumber(numeric(left.value), numeric(right.value), 2, 0.08)
    );
  }
  if (!samePoint(left, right)) return false;
  const tolerance: Partial<Record<HealthDataType, number>> = {
    weight: 0.2,
    body_fat: 0.5,
    lean_body_mass: 0.3,
    blood_pressure: 2,
    heart_rate: 3,
    blood_glucose: 3,
    water: 0.03,
  };
  if (!closeNumber(numeric(left.value), numeric(right.value), tolerance[left.type] ?? 0.1))
    return false;
  if (left.type === "blood_pressure")
    return (
      closeNumber(left.measurements?.systolic, right.measurements?.systolic, 2) &&
      closeNumber(left.measurements?.diastolic, right.measurements?.diastolic, 2)
    );
  return true;
}

function latestRecord(left: HealthImportRecord, right: HealthImportRecord) {
  return String(right.updatedAt ?? right.endTime) >
    String(left.updatedAt ?? left.endTime)
    ? right
    : left;
}

function recordDay(record: HealthImportRecord) {
  return record.endTime.slice(0, 10);
}

function normalizeStepRecords(records: HealthImportRecord[]) {
  const byDaySource = new Map<string, HealthImportRecord[]>();
  for (const record of records) {
    const key = `${recordDay(record)}\u0000${healthSourceId(record.origin)}`;
    const existing = byDaySource.get(key);
    if (existing) existing.push(record);
    else byDaySource.set(key, [record]);
  }

  const totalsByDay = new Map<
    string,
    { record: HealthImportRecord; total: number }[]
  >();
  for (const items of byDaySource.values()) {
    items.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const contains = (outer: HealthImportRecord, inner: HealthImportRecord) =>
      outer !== inner &&
      outer.startTime <= inner.startTime &&
      outer.endTime >= inner.endTime;
    const aggregate = Math.max(
      0,
      ...items
        .filter(
          (item) =>
            finiteTime(item.endTime) - finiteTime(item.startTime) >=
              12 * 60 * MINUTE_MS ||
            items.filter((other) => contains(item, other)).length >= 2,
        )
        .map((item) => numeric(item.value)),
    );
    const atomic = items
      .filter((item) => !items.some((other) => contains(other, item)))
      .reduce((sum, item) => sum + numeric(item.value), 0);
    const total = Math.max(aggregate, atomic);
    if (!(total > 0)) continue;
    const template = items.reduce(latestRecord);
    const day = recordDay(template);
    const sourceId = healthSourceId(template.origin);
    const normalized: HealthImportRecord = {
      ...template,
      id: `daily:${day}:${sourceId}`,
      value: Math.round(total),
      startTime: items[0].startTime,
      endTime: items.reduce(
        (latest, item) => (item.endTime > latest ? item.endTime : latest),
        items[0].endTime,
      ),
    };
    const dayItems = totalsByDay.get(day);
    const next = { record: normalized, total };
    if (dayItems) dayItems.push(next);
    else totalsByDay.set(day, [next]);
  }

  return [...totalsByDay.values()].flatMap((sources) => {
    sources.sort(
      (a, b) =>
        healthSourcePriority(a.record.origin, "steps") -
          healthSourcePriority(b.record.origin, "steps") || b.total - a.total,
    );
    return sources[0]?.record ? [sources[0].record] : [];
  });
}

export function deduplicateHealthImportRecords(
  records: HealthImportRecord[],
  preferences?: Record<string, HealthSourcePreference>,
) {
  const exact = new Map<string, HealthImportRecord>();
  for (const record of records) {
    if (!healthSourceEnabled(record.origin, preferences)) continue;
    const key = `${record.provider}\u0000${record.type}\u0000${record.id}`;
    exact.set(key, exact.has(key) ? latestRecord(exact.get(key)!, record) : record);
  }
  const unique = [...exact.values()];
  const steps = normalizeStepRecords(
    unique.filter((record) => record.type === "steps"),
  );
  const groups = new Map<string, HealthImportRecord[]>();
  for (const record of unique) {
    if (record.type === "steps") continue;
    const key = `${record.type}\u0000${recordDay(record)}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  const chosen: HealthImportRecord[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        healthSourcePriority(a.origin, a.type) -
          healthSourcePriority(b.origin, b.type) ||
        String(b.updatedAt ?? b.endTime).localeCompare(
          String(a.updatedAt ?? a.endTime),
        ),
    );
    const keep: HealthImportRecord[] = [];
    for (const record of group) {
      if (!keep.some((candidate) => healthRecordsAreEquivalent(candidate, record)))
        keep.push(record);
    }
    chosen.push(...keep);
  }
  return [...chosen, ...steps].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
}
