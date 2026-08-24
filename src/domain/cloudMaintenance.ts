export const HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS = 15 * 60 * 1000;
/** Routine freshness may touch today plus at most one explicitly relevant day. */
export const MAX_ROUTINE_CLOUD_ACTIVITY_DATES = 2;
/** Keep each historical projection slice small enough to yield between slices. */
export const HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE = 14;
/** Bound each PostgREST statement even when a group exposes many trackers. */
export const MAX_CLOUD_STATUS_UPSERT_ROWS = 100;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compare source revisions by instant, not by their wire representation.
 * Postgres normally returns `+00:00` while device imports use `Z`; a lexical
 * comparison treats the same instant as newer forever and can repeatedly
 * upsert an otherwise unchanged detailed Health row.
 */
export function cloudSourceTimestampIsNewer(
  incoming: string | null | undefined,
  stored: string | null | undefined,
) {
  if (!incoming) return false;
  if (!stored) return true;
  const incomingMs = Date.parse(incoming);
  const storedMs = Date.parse(stored);
  if (Number.isFinite(incomingMs) && Number.isFinite(storedMs))
    return incomingMs > storedMs;
  // Source revisions are expected to be ISO timestamps. If legacy malformed
  // data reaches this comparison, do not create an unbounded rewrite loop.
  return false;
}

/**
 * Select the tiny status window used by ordinary freshness publication.
 * Candidate order is meaningful: callers put genuinely changed dates before
 * fallback overlap dates. The returned dates are sorted for stable checkpoints.
 */
export function routineCloudActivityDates(
  today: string,
  candidateDates: readonly string[],
) {
  const selected: string[] = [];
  for (const localDate of [today, ...candidateDates]) {
    if (
      !LOCAL_DATE_PATTERN.test(localDate) ||
      localDate > today ||
      selected.includes(localDate)
    )
      continue;
    selected.push(localDate);
    if (selected.length === MAX_ROUTINE_CLOUD_ACTIVITY_DATES) break;
  }
  return selected.sort();
}

/**
 * Historical/backfilled dates are repaired newest-first in bounded slices.
 * Routine dates are excluded because their rows were already acknowledged by
 * the fast checkpoint in the same workspace publication.
 */
export function historicalCloudActivityDateBatches(
  candidateDates: readonly string[],
  routineDates: readonly string[],
) {
  const routine = new Set(routineDates);
  const dates = [...new Set(candidateDates)]
    .filter(
      (localDate) => LOCAL_DATE_PATTERN.test(localDate) && !routine.has(localDate),
    )
    .sort((left, right) => right.localeCompare(left));
  const batches: string[][] = [];
  for (
    let index = 0;
    index < dates.length;
    index += HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE
  )
    batches.push(
      dates.slice(index, index + HISTORICAL_CLOUD_ACTIVITY_DATE_BATCH_SIZE),
    );
  return batches;
}

export type HistoricalSummaryAudit = {
  auditedAt: number;
  earliestLocalDate?: string;
  distinctLocalDateCount: number;
};

type CloudEntryDetail = {
  source?: string;
  sourceOrigin?: string;
  note?: string;
  label?: string;
  metricId: string;
  nutrition?: unknown;
  imageStoragePath?: string;
};

/**
 * Imported sensor rows are represented in groups by compact daily statuses.
 * Keep a raw relational row only when it carries genuine item-level detail.
 * Provider provenance is already stored in `sourceOrigin` and must not turn a
 * 50k-row sensor history into a second raw upload merely because the local UI
 * formats it as a "Synced from ..." note.
 */
export function cloudEntryNeedsItemDetail(
  entry: CloudEntryDetail,
  metricCategory?: string,
) {
  if (entry.source !== "imported") return true;
  const providerProvenanceOnly = Boolean(
    entry.sourceOrigin &&
      entry.note?.startsWith("Synced from ") &&
      !entry.note.includes(" · "),
  );
  return Boolean(
    entry.imageStoragePath ||
      (entry.note && !providerProvenanceOnly) ||
      entry.nutrition ||
      (entry.label &&
        (entry.metricId === "food" ||
          entry.metricId === "workout" ||
          metricCategory === "gym")),
  );
}

/**
 * Full shared-history coverage checks are maintenance, not part of every live
 * Steps/account save. Re-audit after a bounded interval or immediately when a
 * backfill/configuration/privacy change can widen the expected server rows.
 */
export function shouldAuditHistoricalSummary(input: {
  now: number;
  cached?: HistoricalSummaryAudit;
  earliestLocalDate?: string;
  distinctLocalDateCount: number;
  groupMetricSetChanged: boolean;
  pendingPrivacyFenceCount: number;
}) {
  const {
    now,
    cached,
    earliestLocalDate,
    distinctLocalDateCount,
    groupMetricSetChanged,
    pendingPrivacyFenceCount,
  } = input;
  if (groupMetricSetChanged || pendingPrivacyFenceCount > 0 || !cached)
    return true;
  if (
    earliestLocalDate !== cached.earliestLocalDate ||
    distinctLocalDateCount !== cached.distinctLocalDateCount
  )
    return true;
  return now - cached.auditedAt >= HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS;
}
