import type { DailyMetricStatus, MetricEntry } from "../types";

export const SHARED_DAILY_SUMMARY_LABEL =
  "Daily summary · individual log details have not synced yet";

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
  const detailedProjectionKeys = new Set(
    detailedEntries.map((entry) =>
      dailyProjectionKey(entry.userId, entry.metricId, entry.localDate),
    ),
  );
  const compactOnlyEntries = statuses
    .filter(
      (status) =>
        status.groupId === groupId &&
        status.userId !== currentUserId &&
        dateSet.has(status.localDate) &&
        status.visibility === "group" &&
        status.privacyProjectionVersion === 2 &&
        status.exactValue !== undefined &&
        !detailedProjectionKeys.has(
          dailyProjectionKey(
            status.userId,
            status.metricId,
            status.localDate,
          ),
        ),
    )
    .map<MetricEntry>((status) => ({
      id: `shared-total:${status.userId}:${status.metricId}:${status.localDate}`,
      metricId: status.metricId,
      userId: status.userId,
      value: status.exactValue!,
      localDate: status.localDate,
      recordedAt:
        status.syncedAt ?? `${status.localDate}T12:00:00.000Z`,
      visibility: "group",
      source: "calculated",
      label: SHARED_DAILY_SUMMARY_LABEL,
      sourceProvider: status.sourceProvider,
      sourceRevision: status.sourceRevision,
    }));
  return [...detailedEntries, ...compactOnlyEntries];
}
