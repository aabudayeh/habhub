import type { DailyMetricStatus, MetricEntry } from "../types";

type SharedLeaderboardLogInput = {
  currentUserId: string;
  dates: readonly string[];
  entries: readonly MetricEntry[];
  groupId: string;
  /** True only after this cloud activity range has been RLS-refreshed. */
  peerDetailsAuthorized?: boolean;
  statuses: readonly DailyMetricStatus[];
};

const dailyProjectionKey = (
  userId: string,
  metricId: string,
  localDate: string,
) => `${userId}\u0000${metricId}\u0000${localDate}`;

export const SHARED_WORKOUT_DETAIL_METRIC_IDS = [
  "exercise",
  "workout_duration",
  "workout_distance",
] as const;

const workoutDetailMetricIds = new Set<string>(
  SHARED_WORKOUT_DETAIL_METRIC_IDS,
);

/**
 * A Workout row is an independently shareable completion record. Calories,
 * duration, and distance have their own tracker privacy, so those values must
 * travel only in their own relational rows rather than hitch-hiking in the
 * parent's submetric payload.
 */
export function withoutSharedWorkoutParentDetails(
  entry: MetricEntry,
): MetricEntry {
  if (entry.metricId !== "workout" || !entry.submetricValues) return entry;
  const remaining = Object.fromEntries(
    Object.entries(entry.submetricValues).filter(
      ([metricId]) => !workoutDetailMetricIds.has(metricId),
    ),
  );
  return {
    ...entry,
    submetricValues: Object.keys(remaining).length ? remaining : undefined,
  };
}

function normalizedSourceText(value: string | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function workoutSourceKeys(entry: MetricEntry) {
  const prefix = `${entry.userId}\u0000${entry.localDate}\u0000${entry.source}`;
  const sourceRecordId = entry.sourceRecordId?.trim();
  if (sourceRecordId)
    return new Set([
      `${prefix}\u0000record\u0000${entry.sourceProvider ?? ""}\u0000${sourceRecordId}`,
    ]);

  const keys = new Set<string>();
  const metricSuffix = `:${entry.metricId}`;
  if (entry.id.endsWith(metricSuffix))
    keys.add(`${prefix}\u0000id\u0000${entry.id.slice(0, -metricSuffix.length)}`);

  // Manual log and saved-gym child rows can predate sourceRecordId. Their
  // shared timestamp and copy provide a deterministic fallback while the
  // metric-specific id remains deliberately excluded from the fingerprint.
  keys.add(
    [
      prefix,
      "event",
      entry.sourceProvider ?? "",
      entry.recordedAt,
      normalizedSourceText(entry.label),
      normalizedSourceText(entry.note),
    ].join("\u0000"),
  );
  return keys;
}

function sameWorkoutSource(parent: MetricEntry, child: MetricEntry) {
  const parentKeys = workoutSourceKeys(parent);
  return [...workoutSourceKeys(child)].some((key) => parentKeys.has(key));
}

function newerSharedWorkoutDetail(left: MetricEntry, right: MetricEntry) {
  const revisionDifference =
    Number(right.sourceRevision ?? 0) - Number(left.sourceRevision ?? 0);
  if (revisionDifference) return revisionDifference;
  const updatedDifference =
    Date.parse(right.sourceUpdatedAt ?? "") -
    Date.parse(left.sourceUpdatedAt ?? "");
  if (Number.isFinite(updatedDifference) && updatedDifference)
    return updatedDifference;
  return right.id.localeCompare(left.id);
}

/**
 * Return only independently authorized rows that describe the same workout.
 * The caller supplies the output of sharedLeaderboardLogEntries, so a private
 * child never reaches this association step. One deterministic row per detail
 * metric also avoids duplicate display for legacy sourceRecordId-less rows.
 */
export function sharedWorkoutBreakdownEntries(
  parent: MetricEntry,
  authorizedEntries: readonly MetricEntry[],
): MetricEntry[] {
  if (parent.metricId !== "workout") return [];
  const byMetric = new Map<string, MetricEntry>();
  authorizedEntries.forEach((entry) => {
    if (
      !workoutDetailMetricIds.has(entry.metricId) ||
      !sameWorkoutSource(parent, entry)
    )
      return;
    const existing = byMetric.get(entry.metricId);
    if (!existing || newerSharedWorkoutDetail(existing, entry) > 0)
      byMetric.set(entry.metricId, entry);
  });
  return SHARED_WORKOUT_DETAIL_METRIC_IDS.flatMap((metricId) => {
    const entry = byMetric.get(metricId);
    return entry ? [entry] : [];
  });
}

/**
 * Select item-level leaderboard logs without using the compact exact value as
 * a replacement for those items. A v2 exact daily status is authoritative for
 * leaderboard totals, but a current `group` visibility still authorizes the
 * RLS-returned meal/workout/manual rows that explain that total.
 *
 * Peer details remain hidden until the route confirms an RLS-backed range
 * refresh, so stale offline cache cannot briefly reveal a revoked row.
 * Status-only/private projections then revoke cached peer rows immediately. A
 * missing status keeps the legacy group-row compatibility behavior; the cloud
 * loader separately applies revision fences before rows reach this selector.
 */
export function sharedLeaderboardLogEntries({
  currentUserId,
  dates,
  entries,
  groupId,
  peerDetailsAuthorized = true,
  statuses,
}: SharedLeaderboardLogInput): MetricEntry[] {
  const dateSet = new Set(dates);
  const statusByProjection = new Map<string, DailyMetricStatus>();
  statuses.forEach((status) => {
    if (status.groupId !== groupId) return;
    statusByProjection.set(
      dailyProjectionKey(status.userId, status.metricId, status.localDate),
      status,
    );
  });
  const detailedEntries = entries.filter((entry) => {
    if (!dateSet.has(entry.localDate)) return false;
    if (entry.userId === currentUserId) return true;
    if (!peerDetailsAuthorized) return false;
    if (entry.visibility !== "group") return false;
    const authoritativeStatus = statusByProjection.get(
      dailyProjectionKey(entry.userId, entry.metricId, entry.localDate),
    );
    return (
      authoritativeStatus?.visibility === undefined ||
      authoritativeStatus.visibility === "group"
    );
  });
  // Compact statuses belong to the ranking card above. A detail screen must
  // never fabricate a log from that aggregate: it either shows an authorized
  // relational item or no item. This also prevents a transient range fetch
  // from replacing a previously cached meal/workout with a daily-total row.
  return detailedEntries;
}
