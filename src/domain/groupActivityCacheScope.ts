import type {
  AppState,
  DailyMetricStatus,
  MetricEntry,
} from "@/src/types";

export type CachedGroupActivity = {
  groupId: string;
  version?: number;
  updatedAt?: string;
  entries: MetricEntry[];
  dailyMetricStatuses: DailyMetricStatus[];
};

/**
 * Revalidates a durable group-activity snapshot against the account and group
 * shell that are active now. The cache is only a paint-ahead optimization:
 * membership, configured metrics, and exact-value visibility must all still be
 * proven by the account-scoped shell before any row can enter rendered state.
 * Plain group caches default to peer rows so they cannot become an account
 * outbox; the separately encrypted account checkpoint may opt into owned rows.
 */
export function scopeCachedGroupActivity(
  cached: CachedGroupActivity,
  state: Pick<AppState, "currentUserId" | "group">,
  expectedUserId: string,
  expectedGroupId: string,
  includeCurrentUser = false,
): CachedGroupActivity | null {
  if (
    state.currentUserId !== expectedUserId ||
    state.group.id !== expectedGroupId ||
    cached.groupId !== expectedGroupId ||
    !state.group.members.some((member) => member.id === expectedUserId)
  )
    return null;

  const memberIds = new Set(state.group.members.map((member) => member.id));
  const metricIds = new Set(
    (state.group.metricConfiguration ?? []).map((metric) => metric.id),
  );

  return {
    ...cached,
    // Private/status-only measurements are represented by compact statuses;
    // an item-level cached row is reusable only when exact values were shared.
    entries: cached.entries.filter(
      (entry) =>
        entry.visibility === "group" &&
        (includeCurrentUser || entry.userId !== expectedUserId) &&
        memberIds.has(entry.userId) &&
        metricIds.has(entry.metricId),
    ),
    dailyMetricStatuses: cached.dailyMetricStatuses.filter(
      (status) =>
        status.groupId === expectedGroupId &&
        status.visibility !== "private" &&
        (includeCurrentUser || status.userId !== expectedUserId) &&
        memberIds.has(status.userId) &&
        metricIds.has(status.metricId),
    ),
  };
}
