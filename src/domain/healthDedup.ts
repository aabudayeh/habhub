import type {
  HealthImportRecord,
  LiveStepDiagnostics,
} from "../health/types";
import { FOOD_NUTRIENTS } from "./food";
import type {
  HealthDataType,
  HealthSourcePreference,
  LiveStepCombination,
  LiveStepSource,
  NutritionDetails,
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
      const currentProviderPriority = stepProviderPriority(
        current.sourceProvider,
      );
      const candidateProviderPriority = stepProviderPriority(
        candidate.sourceProvider,
      );
      if (candidateProviderPriority !== currentProviderPriority)
        return candidateProviderPriority > currentProviderPriority
          ? candidate
          : current;
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

/**
 * Keep a confirmed current-day aggregate only when the next read has no
 * positive value. A positive unfiltered Health Connect aggregate is already
 * priority-aware and deduplicated, and may legitimately decrease when Health
 * Connect applies a source-priority/deletion correction during the open day.
 */
export function preserveCurrentDayStepFloor<
  TEntry extends ImportedDailyAggregate,
>(
  existing: TEntry | undefined,
  incoming: TEntry,
  currentLocalDate: string,
): TEntry {
  const revisionReconciled = preserveUnchangedDailyAggregateRevision(
    existing,
    incoming,
  );
  if (
    !existing ||
    existing.localDate !== currentLocalDate ||
    incoming.localDate !== currentLocalDate ||
    !isCanonicalHealthConnectStepAggregate(
      String(existing.sourceRecordId ?? ""),
    ) ||
    !isCanonicalHealthConnectStepAggregate(
      String(incoming.sourceRecordId ?? ""),
    ) ||
    existing.sourceProvider !== incoming.sourceProvider ||
    existing.sourceRecordId !== incoming.sourceRecordId ||
    existing.metricId !== incoming.metricId ||
    existing.userId !== incoming.userId
  )
    return revisionReconciled;
  const incomingValue = Number(incoming.value);
  return Number(existing.value) > 0 &&
    (!Number.isFinite(incomingValue) || incomingValue <= 0)
    ? existing
    : revisionReconciled;
}

/**
 * A canonical aggregate migration can replace older Android-device rows with
 * a different id. A positive canonical total must replace those rows even if
 * it is lower: summing or flooring legacy source rows bypasses Health
 * Connect's priority-aware deduplication. Only a non-positive migration read
 * may retain the previously confirmed display total.
 */
export function preserveCurrentDayStepReplacementFloor<
  TEntry extends ImportedDailyAggregate,
>(
  existingDayEntries: readonly TEntry[],
  incoming: TEntry,
  currentLocalDate: string,
): TEntry {
  if (
    incoming.localDate !== currentLocalDate ||
    !isCanonicalHealthConnectStepAggregate(
      String(incoming.sourceRecordId ?? ""),
    )
  )
    return incoming;
  const previous = displayedImportedStepCandidate(
    existingDayEntries.filter(
      (entry) =>
        entry.localDate === currentLocalDate &&
        entry.metricId === incoming.metricId &&
        entry.userId === incoming.userId &&
        hasHealthImportIdentity(entry),
    ),
  );
  const previousValue = Number(previous?.total);
  const incomingValue = Number(incoming.value);
  if (
    !previous ||
    !Number.isFinite(previousValue) ||
    !Number.isFinite(incomingValue) ||
    incomingValue > 0 ||
    previousValue <= 0
  )
    return incoming;
  return {
    ...incoming,
    value: previousValue,
    sourceOrigin: previous.template.sourceOrigin ?? incoming.sourceOrigin,
  };
}

/**
 * A successful live read may transiently contain no positive current-day row.
 * Keep the already confirmed imported total for the still-open local day; the
 * aggregate replacement may continue clearing fallbacks and historical rows.
 */
export function currentDayStepFloorsForEmptyReplacement<
  TEntry extends ImportedDailyAggregate & { id?: unknown },
>(
  existingEntries: readonly TEntry[],
  incomingEntries: readonly TEntry[],
  options: {
    userId: string;
    currentLocalDate: string;
    stepMetricIds: ReadonlySet<string>;
  },
): TEntry[] {
  const floors: TEntry[] = [];
  for (const metricId of options.stepMetricIds) {
    const matchesDayMetric = (entry: TEntry) =>
      entry.userId === options.userId &&
      entry.localDate === options.currentLocalDate &&
      String(entry.metricId ?? "") === metricId;
    const incoming = displayedImportedStepCandidate(
      incomingEntries.filter(
        (entry) =>
          matchesDayMetric(entry) &&
          entry.sourceProvider === "health_connect" &&
          entry.source === "imported",
      ),
    );
    if (incoming && incoming.total > 0) continue;
    const existing = displayedImportedStepCandidate(
      existingEntries.filter(
        (entry) =>
          matchesDayMetric(entry) &&
          entry.sourceProvider === "health_connect" &&
          entry.source === "imported" &&
          !String(entry.sourceRecordId ?? "").startsWith("step-fallback:"),
      ),
    );
    if (!existing || existing.total <= 0) continue;
    if (
      isCanonicalHealthConnectStepAggregate(
        String(existing.template.sourceRecordId ?? ""),
      ) &&
      Number(existing.template.value) === existing.total
    ) {
      floors.push(existing.template);
      continue;
    }
    floors.push({
      ...existing.template,
      value: existing.total,
      sourceRecordId: `aggregate:steps:${options.currentLocalDate}`,
    });
  }
  return floors;
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
 * Health Connect's unfiltered Activity aggregate always owns completed-day
 * Steps. Source preferences are not record-type-specific, so applying them
 * here can accidentally exclude a Steps writer when the user disabled an
 * unrelated nutrition or workout source. A vendor-filtered historical total is
 * never authoritative.
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

/** Device-owned current-day origins that can be fresher than cloud state. */
export function isAndroidDeviceStepOrigin(origin: unknown) {
  const normalized = String(origin ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "android" ||
    normalized.startsWith("com.android.healthconnect.phone.")
  );
}

/**
 * Merge the framework-discovered current-device source with an SPN exposed by
 * a current aggregate/raw record. Some extension builds expose the SPN through
 * only one of these surfaces, so neither discovery path is sufficient alone.
 */
export function resolveCurrentDeviceStepOrigins(
  discoveredOrigins: readonly unknown[],
  observedOrigins: readonly unknown[],
) {
  return [
    ...new Set(
      [
        ...discoveredOrigins,
        ...observedOrigins.filter(isAndroidDeviceStepOrigin),
      ]
        .map((origin) => String(origin ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * A clean cloud snapshot must not erase a newer locally confirmed current-day
 * Health Connect total. A positive server row may still apply a source-priority
 * or deletion correction when its Health Connect revision is at least as new
 * as the phone row. Legacy local interval rows have no canonical revision and
 * therefore still converge to any positive server canonical row. Google web
 * totals never displace the phone-native row.
 */
export function mergeLocalCurrentDayDeviceStepEntries<
  TEntry extends ImportedDailyAggregate & { id?: unknown },
>(
  remoteEntries: TEntry[],
  localEntries: readonly TEntry[],
  options: {
    userId: string;
    currentLocalDate: string;
    stepMetricIds: ReadonlySet<string>;
  },
): TEntry[] {
  const localByMetric = new Map<string, TEntry[]>();
  for (const entry of localEntries) {
    const metricId = String(entry.metricId ?? "");
    if (
      entry.userId !== options.userId ||
      entry.localDate !== options.currentLocalDate ||
      !options.stepMetricIds.has(metricId) ||
      entry.sourceProvider !== "health_connect" ||
      !hasHealthImportIdentity(entry) ||
      entry.source === "manual" ||
      String(entry.sourceRecordId ?? "").startsWith("step-fallback:") ||
      !Number.isFinite(Number(entry.value)) ||
      Number(entry.value) <= 0
    )
      continue;
    const grouped = localByMetric.get(metricId);
    if (grouped) grouped.push(entry);
    else localByMetric.set(metricId, [entry]);
  }
  if (!localByMetric.size) return remoteEntries;

  const preserved = new Map<
    string,
    { local: { template: TEntry; total: number }; remote?: TEntry }
  >();
  for (const [metricId, localEntriesForMetric] of localByMetric) {
    const local = displayedImportedStepCandidate(localEntriesForMetric);
    if (!local?.total) continue;
    const localCanonical = selectCanonicalHealthConnectStepAggregate(
      localEntriesForMetric.filter(
        (entry) => entry.sourceProvider === "health_connect",
      ),
    );
    const remoteEntriesForMetric = remoteEntries.filter(
      (entry) =>
        entry.userId === options.userId &&
        entry.localDate === options.currentLocalDate &&
        String(entry.metricId ?? "") === metricId &&
        entry.source !== "manual" &&
        hasHealthImportIdentity(entry),
    );
    const remoteCanonical = selectCanonicalHealthConnectStepAggregate(
      remoteEntriesForMetric.filter(
        (entry) => entry.sourceProvider === "health_connect",
      ),
    );
    const remoteCanonicalValue = Number(remoteCanonical?.value);
    const hasPositiveRemoteNativeCanonical =
      Boolean(remoteCanonical) &&
      Number.isFinite(remoteCanonicalValue) &&
      remoteCanonicalValue > 0;
    const localRevision = Date.parse(
      String(localCanonical?.sourceUpdatedAt ?? localCanonical?.recordedAt ?? ""),
    );
    const remoteRevision = Date.parse(
      String(remoteCanonical?.sourceUpdatedAt ?? remoteCanonical?.recordedAt ?? ""),
    );
    const remoteCanonicalIsStale =
      hasPositiveRemoteNativeCanonical &&
      Boolean(localCanonical) &&
      Number(localCanonical?.value) > 0 &&
      Number.isFinite(localRevision) &&
      Number.isFinite(remoteRevision) &&
      remoteRevision < localRevision;
    if (!hasPositiveRemoteNativeCanonical || remoteCanonicalIsStale)
      preserved.set(metricId, { local, remote: remoteCanonical });
  }
  if (!preserved.size) return remoteEntries;

  return [
    ...remoteEntries.filter(
      (entry) =>
        !(
          entry.userId === options.userId &&
          entry.localDate === options.currentLocalDate &&
          preserved.has(String(entry.metricId ?? "")) &&
          entry.source !== "manual" &&
          hasHealthImportIdentity(entry)
        ),
    ),
    ...[...preserved.values()].flatMap(({ local, remote }) => {
      const template = remote ?? local.template;
      return [
        {
          ...template,
          value: local.total,
          sourceRecordId: `aggregate:steps:${options.currentLocalDate}`,
          sourceOrigin:
            local.template.sourceOrigin ?? template.sourceOrigin,
          sourceUpdatedAt:
            local.template.sourceUpdatedAt ?? template.sourceUpdatedAt,
        },
      ];
    }),
  ];
}

type CanonicalStepEntry = {
  sourceRecordId?: unknown;
  sourceProvider?: unknown;
  sourceUpdatedAt?: unknown;
  recordedAt?: unknown;
  value?: unknown;
};

/** A phone's native health repository outranks the web-account rollup. */
function stepProviderPriority(provider: unknown) {
  const normalized = String(provider ?? "");
  if (
    normalized === "health_connect" ||
    normalized === "apple_health" ||
    normalized === "healthkit"
  )
    return 2;
  return normalized === "google_health" ? 1 : 0;
}

/** Selects a native canonical aggregate before a newer Google web rollup. */
export function selectCanonicalHealthConnectStepAggregate<
  TEntry extends CanonicalStepEntry,
>(entries: readonly TEntry[]): TEntry | undefined {
  return entries
    .filter((entry) =>
      isCanonicalHealthConnectStepAggregate(
        String(entry.sourceRecordId ?? ""),
      ),
    )
    .reduce<TEntry | undefined>((selected, entry) => {
      if (!selected) return entry;
      const selectedProviderPriority = stepProviderPriority(
        selected.sourceProvider,
      );
      const entryProviderPriority = stepProviderPriority(entry.sourceProvider);
      if (entryProviderPriority !== selectedProviderPriority)
        return entryProviderPriority > selectedProviderPriority
          ? entry
          : selected;
      const selectedRevision = String(
        selected.sourceUpdatedAt ?? selected.recordedAt,
      );
      const entryRevision = String(entry.sourceUpdatedAt ?? entry.recordedAt);
      return entryRevision > selectedRevision ? entry : selected;
  }, undefined);
}

/**
 * Mirrors the Steps value shown before canonical migration. A legacy source
 * can contain several interval rows (27 + 27 = 54); selecting only its newest
 * row would recreate the exact half-total regression during replacement.
 */
export function displayedImportedStepCandidate<
  TEntry extends ImportedDailyAggregate & { id?: unknown },
>(
  entries: readonly TEntry[],
): { template: TEntry; total: number } | undefined {
  const imported = entries.filter(hasHealthImportIdentity);
  const canonical = selectCanonicalHealthConnectStepAggregate(imported);
  if (canonical) {
    const total = Number(canonical.value);
    return Number.isFinite(total)
      ? { template: canonical, total: Math.max(0, Math.round(total)) }
      : undefined;
  }
  const bySource = new Map<string, TEntry[]>();
  for (const entry of imported) {
    const source = healthSourceId(String(entry.sourceOrigin ?? ""));
    const grouped = bySource.get(source);
    if (grouped) grouped.push(entry);
    else bySource.set(source, [entry]);
  }
  const candidates = [...bySource.values()].flatMap((items) => {
    const values = items
      .map((entry) => Number(entry.value))
      .filter(Number.isFinite);
    if (!values.length) return [];
    const hasDailyAggregate = items.some(
      (entry) =>
        String(entry.sourceRecordId ?? "").startsWith("daily:") ||
        String(entry.id ?? "").includes(":daily:"),
    );
    const total = hasDailyAggregate
      ? Math.max(...values)
      : values.reduce((sum, value) => sum + value, 0);
    const template = [...items].sort((left, right) =>
      String(right.recordedAt ?? "").localeCompare(
        String(left.recordedAt ?? ""),
      ),
    )[0];
    return [{ template, total: Math.max(0, Math.round(total)) }];
  });
  candidates.sort(
    (left, right) =>
      healthSourcePriority(
        String(left.template.sourceOrigin ?? ""),
        "steps",
      ) -
        healthSourcePriority(
          String(right.template.sourceOrigin ?? ""),
          "steps",
        ) ||
      right.total - left.total,
  );
  return candidates[0];
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

/**
 * Combines only adjacent, non-overlapping windows: Health Connect from local
 * midnight up to the first locally recorded delta, then Android's local phone
 * deltas from that exact boundary onward.
 */
export function combineDisjointStepWindows(
  healthConnectPrefixCount: number,
  localPhoneSuffixCount: number,
) {
  const prefix = Number.isFinite(healthConnectPrefixCount)
    ? Math.max(0, Math.round(healthConnectPrefixCount))
    : 0;
  const suffix = Number.isFinite(localPhoneSuffixCount)
    ? Math.max(0, Math.round(localPhoneSuffixCount))
    : 0;
  return prefix + suffix;
}

/** Normalizes the platform total once at the canonical-record boundary. */
export function finalImportedStepTotal(count: number) {
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export type SamsungDailyStepCandidate = {
  count: number;
  startTime: string;
  endTime: string;
  lastModifiedTime?: string;
};

/**
 * Select Samsung Health's one full-local-day Steps row rather than summing
 * the overlapping phone/Google minute rows that Health Connect also exposes.
 * Samsung publishes this row with a 00:00-23:59 interval and continuously
 * replaces its count with the same phone+watch total shown in Samsung Health.
 */
export function samsungDailySummaryStepCount(
  candidates: readonly SamsungDailyStepCandidate[],
  localDayStart: Date,
  nextLocalDayStart: Date,
) {
  const startMs = localDayStart.getTime();
  const endMs = nextLocalDayStart.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
    return null;
  const boundaryToleranceMs = 5 * 60_000;
  // A local day is 23 or 25 hours at a daylight-saving transition. Compare
  // against this date's real midnight-to-midnight span so Samsung's
  // 00:00-23:59 summary remains valid on the spring-forward day without
  // accepting an ordinary partial interval on a normal day.
  const minimumFullDayDurationMs = Math.max(
    0,
    endMs - startMs - boundaryToleranceMs,
  );
  const summaries = candidates
    .filter((candidate) => {
      const candidateStart = new Date(candidate.startTime).getTime();
      const candidateEnd = new Date(candidate.endTime).getTime();
      return (
        Number.isFinite(candidate.count) &&
        candidate.count >= 0 &&
        Number.isFinite(candidateStart) &&
        Number.isFinite(candidateEnd) &&
        candidateStart >= startMs - boundaryToleranceMs &&
        candidateStart <= startMs + boundaryToleranceMs &&
        candidateEnd >= endMs - boundaryToleranceMs &&
        candidateEnd <= endMs + boundaryToleranceMs &&
        candidateEnd - candidateStart >= minimumFullDayDurationMs
      );
    })
    .sort((left, right) => {
      const leftUpdated = new Date(left.lastModifiedTime ?? 0).getTime() || 0;
      const rightUpdated = new Date(right.lastModifiedTime ?? 0).getTime() || 0;
      return rightUpdated - leftUpdated || right.count - left.count;
    });
  return summaries.length ? finalImportedStepTotal(summaries[0].count) : null;
}

export const LIVE_STEP_SOURCES: readonly LiveStepSource[] = [
  "samsung_health",
  "health_connect",
  "android_device",
  "physical_activity",
] as const;

export const LIVE_STEP_STRATEGY_VERSION = 2;

/**
 * Samsung's full-day row is the only generally available Health Connect value
 * that mirrors Samsung Health's combined phone+watch total. Android on-device
 * is the deterministic fallback when Samsung has no row on the device.
 */
export const DEFAULT_LIVE_STEP_SOURCES: readonly LiveStepSource[] = [
  "samsung_health",
  "android_device",
] as const;

/** Repairs persisted/remote arrays while retaining a deterministic UI order. */
export function normalizeLiveStepSources(value: unknown): LiveStepSource[] {
  if (!Array.isArray(value)) return [...DEFAULT_LIVE_STEP_SOURCES];
  const selected = new Set(value);
  return LIVE_STEP_SOURCES.filter((source) => selected.has(source));
}

type LiveStepReconciliationOptions = {
  selectedSources: readonly LiveStepSource[];
  combination: LiveStepCombination;
};

type LiveStepReconciliation = {
  count: number;
  usedSamsungHealth: boolean;
  usedLocalPhone: boolean;
  usedAndroidDevice: boolean;
  combinedSources?: boolean;
  selectedSourcesUnavailable?: boolean;
  liveStepDiagnostics?: LiveStepDiagnostics;
};

/**
 * Reconciles complete current-day candidates according to an explicit device
 * preference. With no options it retains the legacy Samsung-first behavior for
 * old callers. Configured reads can choose one source exactly, take a fixed
 * priority, use the highest non-additive total, or explicitly sum overlaps.
 */
export function reconcileCurrentDayStepTotal(
  healthConnectCount: number | null | undefined,
  disjointPhoneCandidate: number | null | undefined,
  androidDeviceCount?: number | null,
  samsungHealthCount?: number | null,
  options?: LiveStepReconciliationOptions,
): LiveStepReconciliation {
  const healthConnect = Number.isFinite(healthConnectCount)
    ? Math.max(0, Math.round(healthConnectCount as number))
    : null;
  const localPhone = Number.isFinite(disjointPhoneCandidate)
    ? Math.max(0, Math.round(disjointPhoneCandidate as number))
    : null;
  const androidDevice = Number.isFinite(androidDeviceCount)
    ? Math.max(0, Math.round(androidDeviceCount as number))
    : null;
  const samsungHealth = Number.isFinite(samsungHealthCount)
    ? Math.max(0, Math.round(samsungHealthCount as number))
    : null;

  const resultFor = (source: LiveStepSource, count: number) => ({
    count,
    usedSamsungHealth: source === "samsung_health",
    usedLocalPhone: source === "physical_activity",
    usedAndroidDevice: source === "android_device",
  });

  if (options) {
    const normalizedSources = normalizeLiveStepSources(options.selectedSources);
    const selectedSources = normalizedSources.length
      ? normalizedSources
      : [...DEFAULT_LIVE_STEP_SOURCES];
    const candidates = {
      samsung_health: samsungHealth,
      health_connect: healthConnect,
      android_device: androidDevice,
      physical_activity: localPhone,
    } satisfies Record<LiveStepSource, number | null>;
    const availableSelected = selectedSources.filter(
      (source) => candidates[source] !== null,
    );
    const positiveSelected = availableSelected.filter(
      (source) => Number(candidates[source]) > 0,
    );
    const candidateDiagnostics = Object.fromEntries(
      LIVE_STEP_SOURCES.flatMap((source) =>
        candidates[source] === null ? [] : [[source, candidates[source]]],
      ),
    ) as Partial<Record<LiveStepSource, number>>;

    if (!positiveSelected.length) {
      const fallback = availableSelected[0] ?? selectedSources[0];
      const result = resultFor(fallback, 0);
      return {
        ...result,
        selectedSourcesUnavailable: !availableSelected.length,
        liveStepDiagnostics: {
          candidates: candidateDiagnostics,
          selectedSources,
          combination: options.combination,
          result: 0,
          resultSources: [],
        },
      };
    }

    if (options.combination === "sum" && positiveSelected.length > 1) {
      const count = positiveSelected.reduce(
        (sum, source) => sum + Number(candidates[source]),
        0,
      );
      return {
        count,
        usedSamsungHealth: false,
        usedLocalPhone: false,
        usedAndroidDevice: false,
        combinedSources: true,
        liveStepDiagnostics: {
          candidates: candidateDiagnostics,
          selectedSources,
          combination: "sum",
          result: count,
          resultSources: positiveSelected,
        },
      };
    }

    // Every candidate covers the same local-midnight-to-now window. Highest
    // is a non-additive heuristic, not record-level deduplication or proof of
    // freshness.
    const selectedSource =
      options.combination === "priority"
        ? positiveSelected[0]
        : positiveSelected.reduce((best, source) =>
            Number(candidates[source]) > Number(candidates[best])
              ? source
              : best,
          );
    const count = Number(candidates[selectedSource]);
    return {
      ...resultFor(selectedSource, count),
      liveStepDiagnostics: {
        candidates: candidateDiagnostics,
        selectedSources,
        combination: options.combination,
        result: count,
        resultSources: [selectedSource],
      },
    };
  }

  if (samsungHealth !== null && samsungHealth > 0)
    return {
      count: samsungHealth,
      usedSamsungHealth: true,
      usedLocalPhone: false,
      usedAndroidDevice: false,
    };
  if (healthConnect !== null && healthConnect > 0)
    return {
      count: healthConnect,
      usedSamsungHealth: false,
      usedLocalPhone: false,
      usedAndroidDevice: false,
    };
  if (androidDevice !== null && androidDevice > 0)
    return {
      count: androidDevice,
      usedSamsungHealth: false,
      usedLocalPhone: false,
      usedAndroidDevice: true,
    };
  if (localPhone !== null && localPhone > 0)
    return {
      count: localPhone,
      usedSamsungHealth: false,
      usedLocalPhone: true,
      usedAndroidDevice: false,
    };
  return {
    count: healthConnect ?? 0,
    usedSamsungHealth: false,
    usedLocalPhone: false,
    usedAndroidDevice: false,
  };
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
  if (
    left.nutrition?.mealType &&
    right.nutrition?.mealType &&
    left.nutrition.mealType !== right.nutrition.mealType
  )
    return false;
  let sharedSignature = false;
  const leftCalories = positiveNumber(left.value);
  const rightCalories = positiveNumber(right.value);
  if (leftCalories !== undefined && rightCalories !== undefined) {
    sharedSignature = true;
    if (!closeNumber(leftCalories, rightCalories, 2, 0.08)) return false;
  }
  for (const nutrient of FOOD_NUTRIENTS) {
    const a = positiveNumber(left.nutrition?.[nutrient.nutritionKey]);
    const b = positiveNumber(right.nutrition?.[nutrient.nutritionKey]);
    if (a === undefined || b === undefined) continue;
    sharedSignature = true;
    const tolerance =
      nutrient.id === "protein" ||
      nutrient.id === "carbs" ||
      nutrient.id === "fat"
        ? 1
        : nutrient.unit === "g"
          ? 0.2
          : 0.1;
    if (!closeNumber(a, b, tolerance, 0.08)) return false;
  }
  // Separate Apple/Health Connect dietary quantities often have zero calories
  // and exactly one populated field. Only the same populated nutrient can be
  // a duplicate; disjoint micronutrients must both survive.
  return sharedSignature;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mergeEquivalentNutritionRecords(
  preferred: HealthImportRecord,
  alternate: HealthImportRecord,
): HealthImportRecord {
  const nutrition: NutritionDetails = {};
  const mealType = preferred.nutrition?.mealType ?? alternate.nutrition?.mealType;
  if (mealType) nutrition.mealType = mealType;
  for (const nutrient of FOOD_NUTRIENTS) {
    const preferredValue = positiveNumber(
      preferred.nutrition?.[nutrient.nutritionKey],
    );
    const alternateValue = positiveNumber(
      alternate.nutrition?.[nutrient.nutritionKey],
    );
    const value = preferredValue ?? alternateValue;
    if (value !== undefined) nutrition[nutrient.nutritionKey] = value;
  }
  const preferredCalories = positiveNumber(preferred.value);
  const alternateCalories = positiveNumber(alternate.value);
  return {
    ...preferred,
    value: preferredCalories ?? alternateCalories ?? preferred.value,
    label: preferred.label ?? alternate.label,
    note: preferred.note ?? alternate.note,
    nutrition: Object.keys(nutrition).length ? nutrition : undefined,
    sourceOrigins: [
      ...new Set([
        ...healthRecordOrigins(preferred),
        ...healthRecordOrigins(alternate),
      ]),
    ],
  };
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
  if (
    left.type === "sleep" ||
    left.type === "active_energy" ||
    left.type === "total_energy"
  ) {
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
      const equivalentIndex = keep.findIndex((candidate) =>
        healthRecordsAreEquivalent(candidate, record),
      );
      if (equivalentIndex < 0) {
        keep.push(record);
        continue;
      }
      if (record.type === "nutrition")
        keep[equivalentIndex] = mergeEquivalentNutritionRecords(
          keep[equivalentIndex],
          record,
        );
    }
    chosen.push(...keep);
  }
  return [...chosen, ...steps].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
}
