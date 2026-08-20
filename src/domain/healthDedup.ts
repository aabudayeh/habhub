import type { HealthImportRecord } from "../health/types";
import type {
  HealthDataType,
  HealthSourcePreference,
} from "../types";

const MINUTE_MS = 60_000;

type HealthImportIdentity = {
  id?: unknown;
  source?: unknown;
  sourceProvider?: unknown;
  sourceRecordId?: unknown;
  sourceOrigin?: unknown;
  recordedAt?: unknown;
  sourceUpdatedAt?: unknown;
};

type ImportedDailyAggregate = HealthImportIdentity & {
  value?: unknown;
  metricId?: unknown;
  userId?: unknown;
  localDate?: unknown;
  visibility?: unknown;
  label?: unknown;
  note?: unknown;
};

/**
 * Provenance survives cloud round-trips in more than one field. Treat any
 * imported marker as device ownership so a web fallback cannot delete or
 * override a health row merely because one legacy field is absent.
 */
export function hasHealthImportIdentity(entry: HealthImportIdentity) {
  return (
    entry.source === "imported" ||
    Boolean(entry.sourceProvider) ||
    Boolean(entry.sourceRecordId) ||
    Boolean(entry.sourceOrigin)
  );
}

/** Only provenance-free manual fallback rows may be replaced from the Log UI. */
export function manualStepEntriesEligibleForReplacement<
  TEntry extends HealthImportIdentity,
>(entries: readonly TEntry[]): TEntry[] {
  return entries.filter((entry) => !hasHealthImportIdentity(entry));
}

/**
 * Steps are a daily total, never an additive mixture of manual and imported
 * rows. The newest user override wins immediately; a later device sync can
 * reclaim authority without deleting either provenance stream.
 */
export function authoritativeStepEntries<
  TEntry extends HealthImportIdentity,
>(entries: readonly TEntry[]): TEntry[] {
  const imported = entries.filter(hasHealthImportIdentity);
  const manual = entries.filter((entry) => !hasHealthImportIdentity(entry));
  const latest = (items: readonly TEntry[]) =>
    items.reduce<TEntry | undefined>((current, candidate) => {
      if (!current) return candidate;
      const currentRevision = String(
        current.sourceUpdatedAt ?? current.recordedAt ?? "",
      );
      const candidateRevision = String(
        candidate.sourceUpdatedAt ?? candidate.recordedAt ?? "",
      );
      if (candidateRevision !== currentRevision)
        return candidateRevision > currentRevision ? candidate : current;
      return String(candidate.id ?? "") > String(current.id ?? "")
        ? candidate
        : current;
    }, undefined);
  const latestImported = latest(imported);
  const latestManual = latest(manual);
  if (!latestImported) return latestManual ? [latestManual] : [];
  if (!latestManual) return [latestImported];
  const importedRevision = String(
    latestImported.sourceUpdatedAt ?? latestImported.recordedAt ?? "",
  );
  const manualRevision = String(
    latestManual.sourceUpdatedAt ?? latestManual.recordedAt ?? "",
  );
  return manualRevision > importedRevision
    ? [latestManual]
    : [latestImported];
}

/**
 * Grouped Health Connect aggregates do not expose the underlying records'
 * last-modified timestamp. The adapter stamps a read revision, but an
 * unchanged re-read must not look like new device data and silently undo a
 * newer manual daily override. A genuinely changed aggregate receives the new
 * revision and can become authoritative again.
 */
export function preserveUnchangedDailyAggregateRevision<
  TEntry extends ImportedDailyAggregate,
>(existing: TEntry | undefined, incoming: TEntry): TEntry {
  if (
    !existing?.sourceUpdatedAt ||
    existing.sourceProvider !== incoming.sourceProvider ||
    existing.sourceRecordId !== incoming.sourceRecordId ||
    Number(existing.value) !== Number(incoming.value) ||
    existing.metricId !== incoming.metricId ||
    existing.userId !== incoming.userId ||
    existing.localDate !== incoming.localDate ||
    existing.source !== incoming.source ||
    existing.sourceOrigin !== incoming.sourceOrigin ||
    existing.visibility !== incoming.visibility ||
    existing.label !== incoming.label ||
    existing.note !== incoming.note
  )
    return incoming;
  return existing;
}

type StepFallbackEntry = HealthImportIdentity & {
  metricId?: unknown;
  userId?: unknown;
  localDate?: unknown;
  value?: unknown;
  visibility?: unknown;
  label?: unknown;
  note?: unknown;
};

/** Retain identity when only a fallback row's synthetic read time changed. */
export function preserveUnchangedStepFallback<
  TEntry extends StepFallbackEntry,
>(existing: TEntry | undefined, incoming: TEntry): TEntry {
  if (
    !existing ||
    !incoming.sourceRecordId?.toString().startsWith("step-fallback:") ||
    existing.sourceRecordId !== incoming.sourceRecordId ||
    existing.metricId !== incoming.metricId ||
    existing.userId !== incoming.userId ||
    existing.localDate !== incoming.localDate ||
    existing.sourceProvider !== incoming.sourceProvider ||
    existing.sourceOrigin !== incoming.sourceOrigin ||
    existing.source !== incoming.source ||
    existing.visibility !== incoming.visibility ||
    existing.value !== incoming.value ||
    existing.label !== incoming.label ||
    existing.note !== incoming.note
  )
    return incoming;
  return existing;
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Repairs at least the configured history and any older Steps already stored,
 * while respecting Health Connect's maximum history window requested by the
 * app. This prevents a later settings change from stranding old bad totals.
 */
export function historicalStepRepairStart(
  now: Date,
  configuredHistoryDays: number,
  existingImportedLocalDates: readonly string[],
  maximumHistoryDays = 730,
) {
  const today = new Date(now);
  if (!Number.isFinite(today.getTime()))
    throw new Error("A valid repair time is required.");
  today.setHours(0, 0, 0, 0);
  const maximumDays = Math.max(1, Math.floor(maximumHistoryDays));
  const earliestAllowed = new Date(today);
  earliestAllowed.setDate(earliestAllowed.getDate() - maximumDays);
  const configuredStart = new Date(today);
  configuredStart.setDate(
    configuredStart.getDate() -
      Math.min(maximumDays, Math.max(1, Math.floor(configuredHistoryDays))),
  );
  let selected = configuredStart;
  for (const localDate of existingImportedLocalDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;
    const candidate = new Date(`${localDate}T12:00:00`);
    if (!Number.isFinite(candidate.getTime()) || candidate > today) continue;
    candidate.setHours(0, 0, 0, 0);
    if (candidate < selected) selected = candidate;
  }
  return selected < earliestAllowed ? earliestAllowed : selected;
}

/** Inclusive local day represented by an exclusive aggregate range end. */
export function aggregateRangeThroughLocalDate(to: Date) {
  const end = new Date(to);
  if (!Number.isFinite(end.getTime()))
    throw new Error("A valid aggregate range end is required.");
  if (
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0
  )
    end.setMilliseconds(-1);
  return localDateString(end);
}

/**
 * Health Connect's unfiltered Activity aggregate always owns the Steps total.
 * Source preferences are not record-type-specific, so applying them here can
 * accidentally exclude a Steps writer when the user disabled an unrelated
 * nutrition or workout source. A vendor-filtered total is never authoritative.
 */
export function authoritativeHealthConnectStepGroups<TGroup>(
  unfiltered: readonly TGroup[],
  _originFiltered?: readonly TGroup[],
): readonly TGroup[] {
  return unfiltered;
}

/** True only for the canonical daily total emitted by our aggregate adapter. */
export function isCanonicalHealthConnectStepAggregate(
  identity: string | undefined,
) {
  return identity?.startsWith("aggregate:steps:") === true;
}

type CanonicalStepEntry = {
  sourceRecordId?: string;
  sourceUpdatedAt?: string;
  recordedAt: string;
};

/** Selects the newest canonical aggregate and ignores legacy writer totals. */
export function selectCanonicalHealthConnectStepAggregate<
  TEntry extends CanonicalStepEntry,
>(entries: readonly TEntry[]): TEntry | undefined {
  return entries
    .filter((entry) =>
      isCanonicalHealthConnectStepAggregate(entry.sourceRecordId),
    )
    .reduce<TEntry | undefined>((selected, entry) => {
      if (!selected) return entry;
      const selectedRevision = String(
        selected.sourceUpdatedAt ?? selected.recordedAt,
      );
      const entryRevision = String(entry.sourceUpdatedAt ?? entry.recordedAt);
      return entryRevision > selectedRevision ? entry : selected;
  }, undefined);
}

/**
 * A non-bucketed current-day aggregate is fresher than the partial final
 * period returned beside historical buckets. Replace that one day; never add
 * the two totals, which would double-count the same Activity records.
 */
export function replaceCanonicalStepAggregateForDay<
  TRecord extends { localDate?: string },
>(
  records: readonly TRecord[],
  localDate: string,
  current: TRecord | undefined,
) {
  const next: TRecord[] = [];
  let inserted = false;
  for (const record of records) {
    if (record.localDate !== localDate) {
      next.push(record);
      continue;
    }
    if (!inserted && current) next.push(current);
    inserted = true;
  }
  if (!inserted && current) next.push(current);
  return next;
}

/** A generic history read may claim the repair version only if it covered it. */
export function stepRepairRangeCovered(
  requiredFrom: Date,
  coveredFrom: Date,
  coveredThrough: Date,
  now: Date,
) {
  const dates = [requiredFrom, coveredFrom, coveredThrough, now];
  if (dates.some((date) => !Number.isFinite(date.getTime()))) return false;
  return (
    localDateString(coveredFrom) <= localDateString(requiredFrom) &&
    localDateString(coveredThrough) >= localDateString(now)
  );
}

type DailyStepReplacementEntry = {
  userId: string;
  metricId: string;
  localDate: string;
  source?: unknown;
  sourceProvider?: unknown;
  sourceRecordId?: string;
  sourceOrigin?: string;
};

/** Exact imported rows cleared after a successful aggregate read. */
export function isDailyStepReplacementCandidate(
  entry: DailyStepReplacementEntry,
  options: {
    userId: string;
    provider: unknown;
    stepMetricIds: ReadonlySet<string>;
    fromDate: string;
    throughDate: string;
    includeFallbacks?: boolean;
  },
) {
  if (entry.source === "manual") return false;
  const explicitProviderMatch = entry.sourceProvider === options.provider;
  const legacyImportedIdentity =
    !entry.sourceProvider &&
    entry.source !== "manual" &&
    (entry.source === "imported" ||
      Boolean(entry.sourceOrigin) ||
      entry.sourceRecordId?.startsWith("aggregate:steps:") ||
      entry.sourceRecordId?.startsWith("daily:") ||
      (options.includeFallbacks === true &&
        entry.sourceRecordId?.startsWith("step-fallback:")));
  return Boolean(
    entry.userId === options.userId &&
    (explicitProviderMatch || legacyImportedIdentity) &&
    entry.localDate >= options.fromDate &&
    entry.localDate <= options.throughDate &&
    (options.stepMetricIds.has(entry.metricId) ||
      (options.includeFallbacks === true &&
        entry.sourceRecordId?.startsWith("step-fallback:")))
  );
}

/**
 * Expands a chunked Health Connect request to local calendar-day boundaries.
 * Period aggregation is anchored to the request start, so a backfill chunk
 * beginning at 14:00 would otherwise create 14:00-to-14:00 "days" and assign
 * the wrong step total to both dates. The current day remains partial at now;
 * historical boundaries round up and harmlessly overlap the adjacent chunk.
 */
export function localCalendarAggregateRange(
  from: Date,
  to: Date,
  now: Date = new Date(),
) {
  const start = new Date(from);
  const requestedEnd = new Date(
    Math.min(to.getTime(), now.getTime()),
  );
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(requestedEnd.getTime()) ||
    requestedEnd <= start
  )
    throw new Error("Health aggregate range must have a positive duration.");

  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = new Date(requestedEnd);
  if (end < today) {
    const alreadyMidnight =
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      end.getMilliseconds() === 0;
    end.setHours(0, 0, 0, 0);
    if (!alreadyMidnight) end.setDate(end.getDate() + 1);
  }
  return { from: start, to: end };
}

/**
 * Splits a calendar-aligned Steps read into completed local days and today's
 * partial day from one clock snapshot. Keeping this in the domain layer makes
 * the midnight boundary deterministic: a read that begins just before
 * midnight cannot accidentally pair tomorrow's date with yesterday's range.
 *
 * The current slice always ends at `now`, never tomorrow's midnight. Health
 * Connect can then apply its Activity priority and overlap removal to exactly
 * the records available so far without us summing phone, watch, or app totals.
 */
export function partitionStepAggregateRange(
  range: { from: Date; to: Date },
  now: Date,
) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const readAt = new Date(now);
  if (
    ![from, to, readAt].every((date) => Number.isFinite(date.getTime())) ||
    to <= from
  )
    throw new Error("Step aggregate range must have a positive duration.");

  const todayStart = new Date(readAt);
  todayStart.setHours(0, 0, 0, 0);
  const historicalEnd = new Date(
    Math.min(to.getTime(), todayStart.getTime()),
  );
  const currentStart = new Date(
    Math.max(from.getTime(), todayStart.getTime()),
  );
  const currentEnd = new Date(Math.min(to.getTime(), readAt.getTime()));

  return {
    historical:
      historicalEnd > from
        ? { from, to: historicalEnd }
        : undefined,
    current:
      currentEnd > currentStart
        ? {
            from: currentStart,
            to: currentEnd,
            localDate: localDateString(readAt),
          }
        : undefined,
  };
}

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

/** Chooses one canonical writer for OS aggregates that must match a source UI. */
export function preferredHealthSourceOrigin(
  origins: readonly string[],
  type: HealthDataType,
  preferences?: Record<string, HealthSourcePreference>,
) {
  return [...new Set(origins.filter(Boolean))]
    .filter((origin) => healthSourceEnabled(origin, preferences))
    .sort(
      (left, right) =>
        healthSourcePriority(left, type) - healthSourcePriority(right, type) ||
        left.localeCompare(right),
    )[0];
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
    return recordDay(left) === recordDay(right);
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
    body_water_mass: 0.3,
    bone_mass: 0.1,
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(record.localDate ?? ""))
    return record.localDate!;
  if (record.type !== "steps")
    return (record.endTime || record.startTime).slice(0, 10);
  const instant = new Date(record.endTime || record.startTime);
  if (!Number.isNaN(instant.getTime())) {
    const year = instant.getFullYear();
    const month = String(instant.getMonth() + 1).padStart(2, "0");
    const day = String(instant.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return (record.endTime || record.startTime).slice(0, 10);
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
    const canonicalPlatformAggregate = items.find((item) =>
      isCanonicalHealthConnectStepAggregate(item.id),
    );
    const normalized: HealthImportRecord = {
      ...template,
      // Preserve adapter-owned aggregate identity end-to-end. The reducer uses
      // it to distinguish Health Connect's priority-aware total from legacy
      // raw per-writer rows after local/cloud round-trips.
      id: canonicalPlatformAggregate?.id ?? `daily:${day}:${sourceId}`,
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
    // Steps have already been resolved by Health Connect's priority-aware
    // Aggregate API. Shared source preferences are not type-aware and must not
    // discard that canonical total because its sole contributor is disabled
    // for nutrition/workout imports.
    if (
      record.type !== "steps" &&
      !healthSourceEnabled(record.origin, preferences)
    )
      continue;
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
