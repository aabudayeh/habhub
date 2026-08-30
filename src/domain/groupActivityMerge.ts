import { stableValueHash } from "@/src/domain/cloudHash";
import { cloudSourceTimestampIsNewer } from "@/src/domain/cloudMaintenance";
import { metricEntryKey } from "@/src/domain/metricEntry";
import type { AppState } from "@/src/types";

type Entry = AppState["entries"][number];
type Status = AppState["dailyMetricStatuses"][number];

type Positioned<T> = {
  index: number;
  value: T;
};

const entryIndexes = new WeakMap<
  AppState["entries"],
  Map<string, Positioned<Entry>>
>();
const statusIndexes = new WeakMap<
  AppState["dailyMetricStatuses"],
  Map<string, Positioned<Status>>
>();

function entryIndex(entries: AppState["entries"]) {
  const cached = entryIndexes.get(entries);
  if (cached) return cached;
  const built = new Map<string, Positioned<Entry>>();
  entries.forEach((value, index) =>
    built.set(metricEntryKey(value.userId, value.id), { index, value }),
  );
  entryIndexes.set(entries, built);
  return built;
}

function statusKey(status: Status) {
  return [
    status.groupId,
    status.metricId,
    status.userId,
    status.localDate,
  ].join(":");
}

function statusIndex(statuses: AppState["dailyMetricStatuses"]) {
  const cached = statusIndexes.get(statuses);
  if (cached) return cached;
  const built = new Map<string, Positioned<Status>>();
  statuses.forEach((value, index) =>
    built.set(statusKey(value), { index, value }),
  );
  statusIndexes.set(statuses, built);
  return built;
}

function sameImmutableValue(left: object, right: object) {
  return left === right || stableValueHash(left) === stableValueHash(right);
}

/**
 * Merge the bounded, privacy-authorized group activity delta while preserving
 * identities for every unchanged row. Realtime range reads commonly repeat
 * hundreds of existing rows around one changed item; rebuilding and sorting
 * the whole history for that response needlessly blocks Android's JS thread
 * and invalidates every downstream metric cache.
 */
export function mergeGroupActivityEntries(
  cached: AppState["entries"],
  fetched: AppState["entries"],
  currentUserId: string,
) {
  if (!fetched.length) return cached;
  const positions = new Map(entryIndex(cached));
  let next: AppState["entries"] | undefined;
  let orderChanged = false;

  for (const incoming of fetched) {
    const key = metricEntryKey(incoming.userId, incoming.id);
    const positioned = positions.get(key);
    const existing = positioned?.value;
    let accepted: Entry | undefined;

    if (!existing) {
      accepted = incoming;
      orderChanged = true;
    } else if (existing.userId === currentUserId) {
      if (incoming.cloudId && existing.cloudId !== incoming.cloudId)
        accepted = { ...existing, cloudId: incoming.cloudId };
    } else if (
      !cloudSourceTimestampIsNewer(
        existing.sourceUpdatedAt,
        incoming.sourceUpdatedAt,
      ) &&
      !sameImmutableValue(existing, incoming)
    ) {
      accepted = incoming;
      orderChanged ||= existing.recordedAt !== incoming.recordedAt;
    }

    if (!accepted) continue;
    if (!next) next = [...cached];
    if (positioned) {
      next[positioned.index] = accepted;
      positions.set(key, { index: positioned.index, value: accepted });
    } else {
      const index = next.length;
      next.push(accepted);
      positions.set(key, { index, value: accepted });
    }
  }

  if (!next) return cached;
  if (orderChanged)
    next.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  // Prime the next immutable array's index so a following realtime delta is
  // O(fetched rows), not another full-history Map construction.
  entryIndex(next);
  return next;
}

/** Preserve the status array when a versioned refresh repeats identical rows. */
export function mergeGroupActivityStatuses(
  cached: AppState["dailyMetricStatuses"],
  fetched: AppState["dailyMetricStatuses"],
) {
  if (!fetched.length) return cached;
  const positions = new Map(statusIndex(cached));
  let next: AppState["dailyMetricStatuses"] | undefined;

  for (const incoming of fetched) {
    const key = statusKey(incoming);
    const positioned = positions.get(key);
    const existing = positioned?.value;
    const acceptedByRevision =
      !existing?.syncedAt ||
      !incoming.syncedAt ||
      incoming.syncedAt >= existing.syncedAt;
    if (
      existing &&
      (!acceptedByRevision || sameImmutableValue(existing, incoming))
    )
      continue;
    if (!next) next = [...cached];
    if (positioned) {
      next[positioned.index] = incoming;
      positions.set(key, { index: positioned.index, value: incoming });
    } else {
      const index = next.length;
      next.push(incoming);
      positions.set(key, { index, value: incoming });
    }
  }

  if (!next) return cached;
  statusIndex(next);
  return next;
}
