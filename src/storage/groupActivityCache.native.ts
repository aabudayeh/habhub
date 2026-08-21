import * as SQLite from "expo-sqlite";

import {
  GROUP_ACTIVITY_CACHE_SCHEMA_VERSION,
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

const DATABASE_NAME = "metric-rally-cache.db";

type CacheRow = {
  payload: string;
};

type CacheAuditRow = CacheRow & {
  group_id: string;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(
      async (database) => {
        await database.execAsync(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          CREATE TABLE IF NOT EXISTS group_activity_cache (
            group_id TEXT PRIMARY KEY NOT NULL,
            schema_version INTEGER NOT NULL,
            remote_version INTEGER,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS group_activity_cache_updated_at_idx
            ON group_activity_cache(updated_at DESC);
          DELETE FROM group_activity_cache
            WHERE schema_version <> ${GROUP_ACTIVITY_CACHE_SCHEMA_VERSION};
        `);
        return database;
      },
    );
  }
  return databasePromise;
}

export async function readGroupActivityCache(
  groupId: string,
): Promise<GroupActivityCachePayload | null> {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return null;

  const database = await getDatabase();
  const row = await database.getFirstAsync<CacheRow>(
    "SELECT payload FROM group_activity_cache WHERE group_id = ? LIMIT 1",
    normalizedGroupId,
  );
  if (!row) return null;

  const stored = parseStoredGroupActivityCache(row.payload, normalizedGroupId);
  if (!stored) {
    await database.runAsync(
      "DELETE FROM group_activity_cache WHERE group_id = ?",
      normalizedGroupId,
    );
    return null;
  }
  const sanitized = JSON.stringify(stored);
  if (sanitized !== row.payload) {
    await database.runAsync(
      `UPDATE group_activity_cache
       SET schema_version = ?, remote_version = ?, updated_at = ?, payload = ?
       WHERE group_id = ? AND payload = ?`,
      stored.schemaVersion,
      stored.payload.version ?? null,
      stored.writtenAt,
      sanitized,
      normalizedGroupId,
      row.payload,
    );
  }
  return stored.payload;
}

export async function writeGroupActivityCache(
  payload: GroupActivityCachePayload,
  options?: GroupActivityCacheWriteOptions,
): Promise<void> {
  const normalizedGroupId = normalizeGroupId(payload.groupId);
  if (!normalizedGroupId) {
    throw new Error("A group ID is required to cache activity.");
  }

  const database = await getDatabase();
  const stored = createStoredGroupActivityCache({
    ...payload,
    groupId: normalizedGroupId,
  });
  const serialized = JSON.stringify(stored);
  const maxGroups = normalizeMaxGroups(options?.maxGroups);

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO group_activity_cache (
         group_id, schema_version, remote_version, updated_at, payload
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         schema_version = excluded.schema_version,
         remote_version = excluded.remote_version,
         updated_at = excluded.updated_at,
         payload = excluded.payload`,
      normalizedGroupId,
      stored.schemaVersion,
      stored.payload.version ?? null,
      stored.writtenAt,
      serialized,
    );
    await transaction.runAsync(
      `DELETE FROM group_activity_cache
       WHERE group_id NOT IN (
         SELECT group_id
         FROM group_activity_cache
         ORDER BY updated_at DESC
         LIMIT ?
       )`,
      maxGroups,
    );
  });
}

export async function purgeLegacyGroupActivityCaches(): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM group_activity_cache WHERE schema_version <> ?",
      GROUP_ACTIVITY_CACHE_SCHEMA_VERSION,
    );
    const rows = await transaction.getAllAsync<CacheAuditRow>(
      "SELECT group_id, payload FROM group_activity_cache",
    );
    for (const row of rows) {
      const stored = parseStoredGroupActivityCache(row.payload, row.group_id);
      if (!stored) {
        await transaction.runAsync(
          "DELETE FROM group_activity_cache WHERE group_id = ?",
          row.group_id,
        );
        continue;
      }
      const sanitized = JSON.stringify(stored);
      if (sanitized === row.payload) continue;
      await transaction.runAsync(
        `UPDATE group_activity_cache
         SET schema_version = ?, remote_version = ?, updated_at = ?, payload = ?
         WHERE group_id = ?`,
        stored.schemaVersion,
        stored.payload.version ?? null,
        stored.writtenAt,
        sanitized,
        row.group_id,
      );
    }
  });
}

export async function removeGroupActivityCache(groupId: string): Promise<void> {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return;

  const database = await getDatabase();
  await database.runAsync(
    "DELETE FROM group_activity_cache WHERE group_id = ?",
    normalizedGroupId,
  );
}

export async function pruneGroupActivityCaches(
  options?: GroupActivityCachePruneOptions,
): Promise<void> {
  const database = await getDatabase();
  const maxGroups = normalizeMaxGroups(options?.maxGroups);
  const keepGroupIds = Array.from(
    new Set(
      (options?.keepGroupIds ?? []).map(normalizeGroupId).filter(Boolean),
    ),
  );

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const placeholders = keepGroupIds.map(() => "?").join(", ");
    const keepClause =
      keepGroupIds.length > 0
        ? `AND group_id NOT IN (${placeholders})`
        : "";
    await transaction.runAsync(
      `DELETE FROM group_activity_cache
       WHERE group_id NOT IN (
         SELECT group_id
         FROM group_activity_cache
         ORDER BY updated_at DESC
         LIMIT ?
       )
       ${keepClause}`,
      maxGroups,
      ...keepGroupIds,
    );
  });
}
