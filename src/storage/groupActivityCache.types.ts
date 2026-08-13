import type { DailyMetricStatus, MetricEntry } from "@/src/types";

export const GROUP_ACTIVITY_CACHE_SCHEMA_VERSION = 2;
export const DEFAULT_GROUP_ACTIVITY_CACHE_LIMIT = 8;

export type GroupActivityCachePayload = {
  groupId: string;
  version?: number;
  updatedAt?: string;
  entries: MetricEntry[];
  dailyMetricStatuses: DailyMetricStatus[];
};

export type GroupActivityCacheWriteOptions = {
  /** Maximum complete group snapshots to retain. Activity rows are never pruned individually. */
  maxGroups?: number;
};

export type GroupActivityCachePruneOptions = GroupActivityCacheWriteOptions & {
  /** Groups that must survive pruning, even when that temporarily exceeds maxGroups. */
  keepGroupIds?: string[];
};

export type StoredGroupActivityCache = {
  schemaVersion: typeof GROUP_ACTIVITY_CACHE_SCHEMA_VERSION;
  writtenAt: string;
  payload: GroupActivityCachePayload;
};

export type GroupActivityCacheApi = {
  readGroupActivityCache(groupId: string): Promise<GroupActivityCachePayload | null>;
  writeGroupActivityCache(
    payload: GroupActivityCachePayload,
    options?: GroupActivityCacheWriteOptions,
  ): Promise<void>;
  removeGroupActivityCache(groupId: string): Promise<void>;
  pruneGroupActivityCaches(options?: GroupActivityCachePruneOptions): Promise<void>;
};
