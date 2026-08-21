import {
  DEFAULT_GROUP_ACTIVITY_CACHE_LIMIT,
  GROUP_ACTIVITY_CACHE_SCHEMA_VERSION,
  type GroupActivityCachePayload,
  type StoredGroupActivityCache,
} from "./groupActivityCache.types";
import {
  withoutGoogleHealthDerivedStatuses,
  withoutGoogleHealthEntries,
} from "../domain/googleHealthLocalPrivacy";

export function normalizeGroupId(groupId: string): string {
  return groupId.trim();
}

export function normalizeMaxGroups(maxGroups: number | undefined): number {
  if (maxGroups === undefined || !Number.isFinite(maxGroups)) {
    return DEFAULT_GROUP_ACTIVITY_CACHE_LIMIT;
  }
  return Math.max(1, Math.floor(maxGroups));
}

export function createStoredGroupActivityCache(
  payload: GroupActivityCachePayload,
  writtenAt = new Date().toISOString(),
): StoredGroupActivityCache {
  const entries = withoutGoogleHealthEntries(payload.entries);
  const dailyMetricStatuses = withoutGoogleHealthDerivedStatuses(
    payload.entries,
    payload.dailyMetricStatuses,
  );
  return {
    schemaVersion: GROUP_ACTIVITY_CACHE_SCHEMA_VERSION,
    writtenAt,
    payload: {
      ...payload,
      groupId: normalizeGroupId(payload.groupId),
      entries: [...entries],
      dailyMetricStatuses: [...dailyMetricStatuses],
    },
  };
}

export function parseStoredGroupActivityCache(
  value: string,
  expectedGroupId?: string,
): StoredGroupActivityCache | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredGroupActivityCache> | null;
    if (
      !parsed ||
      parsed.schemaVersion !== GROUP_ACTIVITY_CACHE_SCHEMA_VERSION ||
      typeof parsed.writtenAt !== "string" ||
      !isGroupActivityCachePayload(parsed.payload)
    ) {
      return null;
    }

    const normalizedExpectedGroupId = expectedGroupId
      ? normalizeGroupId(expectedGroupId)
      : undefined;
    if (
      normalizedExpectedGroupId &&
      normalizeGroupId(parsed.payload.groupId) !== normalizedExpectedGroupId
    ) {
      return null;
    }

    const stored = parsed as StoredGroupActivityCache;
    const entries = withoutGoogleHealthEntries(stored.payload.entries);
    const dailyMetricStatuses = withoutGoogleHealthDerivedStatuses(
      stored.payload.entries,
      stored.payload.dailyMetricStatuses,
    );
    return entries === stored.payload.entries &&
      dailyMetricStatuses === stored.payload.dailyMetricStatuses
      ? stored
      : {
          ...stored,
          payload: { ...stored.payload, entries, dailyMetricStatuses },
        };
  } catch {
    return null;
  }
}

function isGroupActivityCachePayload(
  value: unknown,
): value is GroupActivityCachePayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Partial<GroupActivityCachePayload>;
  if (
    typeof payload.groupId !== "string" ||
    normalizeGroupId(payload.groupId).length === 0 ||
    !Array.isArray(payload.entries) ||
    !Array.isArray(payload.dailyMetricStatuses)
  ) {
    return false;
  }

  if (
    payload.version !== undefined &&
    (!Number.isFinite(payload.version) || (payload.version ?? 0) < 0)
  ) {
    return false;
  }
  if (
    payload.updatedAt !== undefined &&
    typeof payload.updatedAt !== "string"
  ) {
    return false;
  }

  return (
    payload.entries.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.metricId === "string" &&
        typeof entry.userId === "string" &&
        typeof entry.localDate === "string",
    ) &&
    payload.dailyMetricStatuses.every(
      (status) =>
        status !== null &&
        typeof status === "object" &&
        typeof status.groupId === "string" &&
        typeof status.metricId === "string" &&
        typeof status.userId === "string" &&
        typeof status.localDate === "string",
    )
  );
}
