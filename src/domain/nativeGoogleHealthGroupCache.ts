import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  buildGoogleHealthGroupCheckpoint,
  parseGoogleHealthGroupCheckpoint,
  type GoogleHealthGroupCheckpoint,
  type GoogleHealthGroupCheckpointSource,
} from "@/src/domain/googleHealthGroupCheckpoint";

export const NATIVE_GOOGLE_GROUP_MANIFEST_VERSION = 1 as const;
// Expo notes that some platform versions have historically rejected values
// above roughly 2,048 bytes. JSON is escaped to ASCII first, so every chunk
// remains conservatively below that boundary.
export const NATIVE_GOOGLE_GROUP_CHUNK_LENGTH = 1_800;
export const NATIVE_GOOGLE_GROUP_MAX_CHUNKS = 48;
export const NATIVE_GOOGLE_GROUP_MAX_STATUSES = 320;
export const NATIVE_GOOGLE_GROUP_CACHE_DAYS = 7;
export type NativeGoogleHealthGroupSlot = "slot-a" | "slot-b";

export type NativeGoogleHealthGroupManifest = {
  version: typeof NATIVE_GOOGLE_GROUP_MANIFEST_VERSION;
  generation: NativeGoogleHealthGroupSlot;
  chunkCount: number;
  signature: string;
  contentSignature: string;
};

export function nativeGoogleHealthStableHash(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

function asciiJson(value: unknown) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Ignore second-by-second checkpoint timestamps when coalescing writes, while
 * retaining the creation day so an unchanged cache refreshes its seven-day
 * expiry at most once per day.
 */
export function nativeGoogleHealthCheckpointContentSignature(
  serialized: string,
) {
  try {
    const checkpoint = JSON.parse(serialized) as {
      accountId?: unknown;
      groupId?: unknown;
      createdAt?: unknown;
      dailyMetricStatuses?: unknown;
    };
    return nativeGoogleHealthStableHash(
      asciiJson({
        accountId: checkpoint.accountId,
        groupId: checkpoint.groupId,
        refreshDate:
          typeof checkpoint.createdAt === "string"
            ? checkpoint.createdAt.slice(0, 10)
            : undefined,
        dailyMetricStatuses: checkpoint.dailyMetricStatuses,
      }),
    );
  } catch {
    return nativeGoogleHealthStableHash(serialized);
  }
}

export function serializeNativeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
  now = new Date(),
): string | undefined {
  const checkpoint = buildGoogleHealthGroupCheckpoint(source, now);
  if (!checkpoint) return;
  const earliestDate = dateWithOffsetFrom(
    dateKey(now),
    -(NATIVE_GOOGLE_GROUP_CACHE_DAYS - 1),
  );
  const latestStatusByKey = new Map<string, (typeof checkpoint.dailyMetricStatuses)[number]>();
  for (const status of checkpoint.dailyMetricStatuses) {
    if (status.localDate < earliestDate) continue;
    const key = [status.userId, status.metricId, status.localDate].join("\u0000");
    const current = latestStatusByKey.get(key);
    if (
      !current ||
      Number(status.sourceRevision ?? -1) >
        Number(current.sourceRevision ?? -1) ||
      (Number(status.sourceRevision ?? -1) ===
        Number(current.sourceRevision ?? -1) &&
        (status.syncedAt ?? "") >= (current.syncedAt ?? ""))
    )
      latestStatusByKey.set(key, status);
  }
  const statuses = [...latestStatusByKey.values()]
    .sort((left, right) => {
      if (left.localDate !== right.localDate)
        return left.localDate.localeCompare(right.localDate);
      return (left.syncedAt ?? "").localeCompare(right.syncedAt ?? "");
    })
    .slice(-NATIVE_GOOGLE_GROUP_MAX_STATUSES);
  if (!statuses.length) return;

  const compact = { ...checkpoint, dailyMetricStatuses: statuses };
  while (
    compact.dailyMetricStatuses.length > 1 &&
    asciiJson(compact).length >
      NATIVE_GOOGLE_GROUP_CHUNK_LENGTH * NATIVE_GOOGLE_GROUP_MAX_CHUNKS
  ) {
    // Oldest projections yield first; today's last-known values survive even
    // for unusually large groups without allowing unbounded Keychain growth.
    compact.dailyMetricStatuses.shift();
  }
  const serialized = asciiJson(compact);
  return serialized.length <=
    NATIVE_GOOGLE_GROUP_CHUNK_LENGTH * NATIVE_GOOGLE_GROUP_MAX_CHUNKS
    ? serialized
    : undefined;
}

export function checkpointChunks(
  serialized: string,
  generation: NativeGoogleHealthGroupSlot,
): { manifest: NativeGoogleHealthGroupManifest; chunks: string[] } | undefined {
  const chunks = Array.from(
    {
      length: Math.ceil(
        serialized.length / NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
      ),
    },
    (_, index) =>
      serialized.slice(
        index * NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
        (index + 1) * NATIVE_GOOGLE_GROUP_CHUNK_LENGTH,
      ),
  );
  if (!chunks.length || chunks.length > NATIVE_GOOGLE_GROUP_MAX_CHUNKS)
    return;
  return {
    manifest: {
      version: NATIVE_GOOGLE_GROUP_MANIFEST_VERSION,
      generation,
      chunkCount: chunks.length,
      signature: nativeGoogleHealthStableHash(serialized),
      contentSignature:
        nativeGoogleHealthCheckpointContentSignature(serialized),
    },
    chunks,
  };
}

export function parseNativeGoogleHealthManifest(
  raw: string | null | undefined,
): NativeGoogleHealthGroupManifest | undefined {
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const manifest = parsed as Partial<NativeGoogleHealthGroupManifest>;
    if (
      manifest.version !== NATIVE_GOOGLE_GROUP_MANIFEST_VERSION ||
      (manifest.generation !== "slot-a" &&
        manifest.generation !== "slot-b") ||
      !Number.isSafeInteger(manifest.chunkCount) ||
      Number(manifest.chunkCount) < 1 ||
      Number(manifest.chunkCount) > NATIVE_GOOGLE_GROUP_MAX_CHUNKS ||
      typeof manifest.signature !== "string" ||
      !/^[a-z0-9]{4,80}$/.test(manifest.signature) ||
      typeof manifest.contentSignature !== "string" ||
      !/^[a-z0-9]{4,80}$/.test(manifest.contentSignature)
    )
      return;
    return manifest as NativeGoogleHealthGroupManifest;
  } catch {
    return;
  }
}

export function joinCheckpointChunks(
  manifest: NativeGoogleHealthGroupManifest,
  chunks: readonly (string | null | undefined)[],
) {
  if (
    chunks.length !== manifest.chunkCount ||
    chunks.some((chunk) => typeof chunk !== "string")
  )
    return;
  const serialized = chunks.join("");
  return nativeGoogleHealthStableHash(serialized) === manifest.signature &&
    nativeGoogleHealthCheckpointContentSignature(serialized) ===
      manifest.contentSignature
    ? serialized
    : undefined;
}

export function parseNativeGoogleHealthGroupCheckpoint(
  serialized: string,
  accountId: string,
  groupId: string,
  now = new Date(),
): GoogleHealthGroupCheckpoint | undefined {
  try {
    return parseGoogleHealthGroupCheckpoint(
      JSON.parse(serialized),
      accountId,
      groupId,
      now,
    );
  } catch {
    return;
  }
}
