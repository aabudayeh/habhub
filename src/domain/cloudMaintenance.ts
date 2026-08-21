export const HISTORICAL_SUMMARY_AUDIT_INTERVAL_MS = 15 * 60 * 1000;

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
