import type {
  Aggregation,
  MetricEntry,
  Visibility,
} from "../types";
import { authoritativeStepEntries } from "./healthDedup";

function numericEntries(entries: readonly MetricEntry[]) {
  return entries.filter(
    (entry) =>
      typeof entry.value === "boolean" || Number.isFinite(Number(entry.value)),
  );
}

export function aggregateMetricEntries(
  entries: readonly MetricEntry[],
  aggregation: Aggregation,
) {
  const numbers = numericEntries(entries).map((entry) =>
    entry.value === true
      ? 1
      : entry.value === false
        ? 0
        : Number(entry.value),
  );
  if (!numbers.length) return undefined;
  switch (aggregation) {
    case "latest":
      return numbers[numbers.length - 1];
    case "average":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "max":
      return Math.max(...numbers);
    case "min":
      return Math.min(...numbers);
    default:
      return numbers.reduce((sum, value) => sum + value, 0);
  }
}

/**
 * Aggregate only entries whose access rule permits the requested projection.
 * Returning undefined (instead of zero) lets callers distinguish no visible
 * contribution from a legitimately shared zero.
 */
export function aggregateVisibleMetricEntries(
  entries: readonly MetricEntry[],
  aggregation: Aggregation,
  allowedVisibilities: ReadonlySet<Visibility>,
  authoritativeSteps = false,
) {
  const visible = numericEntries(entries)
    .filter((entry) => allowedVisibilities.has(entry.visibility))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const authoritative = authoritativeSteps
    ? authoritativeStepEntries(visible)
    : visible;
  return aggregateMetricEntries(authoritative, aggregation);
}

/** A verified compact projection is newer/more complete than cached raw rows. */
export function authoritativeSharedExactValue(
  verifiedProjection: number | undefined,
  localRawAggregate: number | undefined,
) {
  return verifiedProjection !== undefined
    ? verifiedProjection
    : localRawAggregate;
}

/**
 * A peer's cached raw rows are only a compatibility fallback until the owner
 * publishes an authoritative visibility for that day. Once that projection is
 * status-only or private, an older group-visible row must not remain readable.
 * Owners always retain access to their own local history.
 */
export function canUseCachedSharedRaw(
  subjectUserId: string,
  viewerUserId: string,
  authoritativeVisibility: Visibility | undefined,
  verifiedExactValue?: number,
) {
  return (
    subjectUserId === viewerUserId ||
    authoritativeVisibility === undefined ||
    (authoritativeVisibility === "group" && verifiedExactValue === undefined)
  );
}

export type SharedMetricPrivacyFence = {
  userId: string;
  metricId: string;
  revision: number;
};

/** A fence revokes only projections published at or before its account revision. */
export function projectionSurvivesPrivacyFence(
  sourceRevision: number | undefined,
  fenceRevision: number,
) {
  return (
    Number.isFinite(sourceRevision) &&
    Number(sourceRevision) > fenceRevision
  );
}

/** A redacted status row published by the restricting revision is authorized. */
export function statusProjectionSurvivesPrivacyFence(
  sourceRevision: number | undefined,
  fenceRevision: number,
) {
  return (
    Number.isFinite(sourceRevision) &&
    Number(sourceRevision) >= fenceRevision
  );
}

export function projectionSurvivesSharedMetricPrivacyFences(
  userId: string,
  metricId: string,
  sourceRevision: number | undefined,
  fences: readonly SharedMetricPrivacyFence[],
  visibility?: Visibility,
) {
  const matchingRevision = fences.reduce<number | undefined>(
    (current, fence) =>
      fence.userId === userId && fence.metricId === metricId
        ? Math.max(current ?? -1, fence.revision)
        : current,
    undefined,
  );
  return (
    matchingRevision === undefined ||
    (visibility === "status"
      ? statusProjectionSurvivesPrivacyFence(
          sourceRevision,
          matchingRevision,
        )
      : projectionSurvivesPrivacyFence(sourceRevision, matchingRevision))
  );
}

export function applySharedMetricPrivacyFences<T extends {
  userId: string;
  metricId: string;
  sourceRevision?: number;
  visibility?: Visibility;
}>(
  items: readonly T[],
  fences: readonly SharedMetricPrivacyFence[],
  viewerUserId?: string,
) {
  const revisionByProjection = new Map<string, number>();
  fences.forEach((fence) => {
    const key = `${fence.userId}\u0000${fence.metricId}`;
    revisionByProjection.set(
      key,
      Math.max(revisionByProjection.get(key) ?? -1, fence.revision),
    );
  });
  return items.filter((item) => {
    if (item.userId === viewerUserId) return true;
    const revision = revisionByProjection.get(
      `${item.userId}\u0000${item.metricId}`,
    );
    return (
      revision === undefined ||
      (item.visibility === "status"
        ? statusProjectionSurvivesPrivacyFence(
            item.sourceRevision,
            revision,
          )
        : projectionSurvivesPrivacyFence(item.sourceRevision, revision))
    );
  });
}
