import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type GroupActivityCachePayload,
  type GroupActivityCachePruneOptions,
  type GroupActivityCacheWriteOptions,
} from "./groupActivityCache.types";
import {
  createStoredGroupActivityCache,
  normalizeGroupId,
  normalizeMaxGroups,
  parseStoredGroupActivityCache,
} from "./groupActivityCache.shared";

const CACHE_KEY_PREFIX = "metric-rally:group-activity-cache:v1:";
const CACHE_INDEX_KEY = "metric-rally:group-activity-cache-index:v1";

type CacheIndexItem = {
  groupId: string;
  writtenAt: string;
};

let mutationQueue: Promise<void> = Promise.resolve();

function cacheKey(groupId: string): string {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(groupId)}`;
}

function enqueueMutation(task: () => Promise<void>): Promise<void> {
  const next = mutationQueue.then(task, task);
  mutationQueue = next.catch(() => undefined);
  return next;
}

async function readIndex(): Promise<CacheIndexItem[]> {
  const raw = await AsyncStorage.getItem(CACHE_INDEX_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is CacheIndexItem =>
            item !== null &&
            typeof item === "object" &&
            typeof item.groupId === "string" &&
            typeof item.writtenAt === "string",
        );
      }
    } catch {
      // Rebuild from complete per-group snapshots below.
    }
  }

  const cacheKeys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(CACHE_KEY_PREFIX),
  );
  const storedRows = await AsyncStorage.multiGet(cacheKeys);
  const rebuilt: CacheIndexItem[] = [];
  const corruptKeys: string[] = [];
  for (const [key, value] of storedRows) {
    const stored = value ? parseStoredGroupActivityCache(value) : null;
    if (!stored) {
      corruptKeys.push(key);
      continue;
    }
    rebuilt.push({
      groupId: normalizeGroupId(stored.payload.groupId),
      writtenAt: stored.writtenAt,
    });
  }
  if (corruptKeys.length > 0) {
    await AsyncStorage.multiRemove(corruptKeys);
  }
  return rebuilt;
}

function selectPrunedIndex(
  items: CacheIndexItem[],
  options?: GroupActivityCachePruneOptions,
): { retained: CacheIndexItem[]; removed: CacheIndexItem[] } {
  const maxGroups = normalizeMaxGroups(options?.maxGroups);
  const keep = new Set(
    (options?.keepGroupIds ?? []).map(normalizeGroupId).filter(Boolean),
  );
  const deduplicated = Array.from(
    new Map(items.map((item) => [normalizeGroupId(item.groupId), item])).values(),
  ).sort((left, right) => right.writtenAt.localeCompare(left.writtenAt));
  const retained: CacheIndexItem[] = [];
  const removed: CacheIndexItem[] = [];

  for (const item of deduplicated) {
    if (keep.has(item.groupId) || retained.length < maxGroups) {
      retained.push(item);
    } else {
      removed.push(item);
    }
  }
  return { retained, removed };
}

export async function readGroupActivityCache(
  groupId: string,
): Promise<GroupActivityCachePayload | null> {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return null;

  const raw = await AsyncStorage.getItem(cacheKey(normalizedGroupId));
  if (!raw) return null;

  const stored = parseStoredGroupActivityCache(raw, normalizedGroupId);
  if (!stored) {
    await removeGroupActivityCache(normalizedGroupId).catch(() => undefined);
    return null;
  }
  return stored.payload;
}

export function writeGroupActivityCache(
  payload: GroupActivityCachePayload,
  options?: GroupActivityCacheWriteOptions,
): Promise<void> {
  const normalizedGroupId = normalizeGroupId(payload.groupId);
  if (!normalizedGroupId) {
    return Promise.reject(new Error("A group ID is required to cache activity."));
  }

  return enqueueMutation(async () => {
    const stored = createStoredGroupActivityCache({
      ...payload,
      groupId: normalizedGroupId,
    });
    const existingIndex = await readIndex();
    const nextIndex = [
      { groupId: normalizedGroupId, writtenAt: stored.writtenAt },
      ...existingIndex.filter(
        (item) => normalizeGroupId(item.groupId) !== normalizedGroupId,
      ),
    ];
    const { retained, removed } = selectPrunedIndex(nextIndex, {
      ...options,
      keepGroupIds: [normalizedGroupId],
    });

    await AsyncStorage.multiSet([
      [cacheKey(normalizedGroupId), JSON.stringify(stored)],
      [CACHE_INDEX_KEY, JSON.stringify(retained)],
    ]);
    if (removed.length > 0) {
      await AsyncStorage.multiRemove(
        removed.map((item) => cacheKey(item.groupId)),
      );
    }
  });
}

export function removeGroupActivityCache(groupId: string): Promise<void> {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return Promise.resolve();

  return enqueueMutation(async () => {
    const existingIndex = await readIndex();
    const nextIndex = existingIndex.filter(
      (item) => normalizeGroupId(item.groupId) !== normalizedGroupId,
    );
    await AsyncStorage.multiRemove([
      cacheKey(normalizedGroupId),
      CACHE_INDEX_KEY,
    ]);
    if (nextIndex.length > 0) {
      await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(nextIndex));
    }
  });
}

export function pruneGroupActivityCaches(
  options?: GroupActivityCachePruneOptions,
): Promise<void> {
  return enqueueMutation(async () => {
    const existingIndex = await readIndex();
    const { retained, removed } = selectPrunedIndex(existingIndex, options);
    if (removed.length === 0 && retained.length === existingIndex.length) return;

    await AsyncStorage.multiSet([
      [CACHE_INDEX_KEY, JSON.stringify(retained)],
    ]);
    if (removed.length > 0) {
      await AsyncStorage.multiRemove(
        removed.map((item) => cacheKey(item.groupId)),
      );
    }
  });
}
