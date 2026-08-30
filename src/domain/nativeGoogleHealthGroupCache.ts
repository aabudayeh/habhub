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
export const NATIVE_GOOGLE_GROUP_MAX_ENTRIES = 80;
const NATIVE_GOOGLE_GROUP_RESERVED_RECENT_STATUSES = 64;
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
 * retaining the creation day so unchanged native cache metadata refreshes at
 * most once per day. Native secure storage remains independently size-bounded.
 */
export function nativeGoogleHealthCheckpointContentSignature(
  serialized: string,
) {
  try {
    const checkpoint = JSON.parse(serialized) as {
      version?: unknown;
      accountId?: unknown;
      groupId?: unknown;
      entries?: unknown;
      dailyMetricStatuses?: unknown;
    };
    return nativeGoogleHealthStableHash(
      asciiJson({
        version: checkpoint.version,
        accountId: checkpoint.accountId,
        groupId: checkpoint.groupId,
        entries: checkpoint.entries,
        dailyMetricStatuses: checkpoint.dailyMetricStatuses,
      }),
    );
  } catch {
    return nativeGoogleHealthStableHash(serialized);
  }
}

function legacyNativeGoogleHealthCheckpointContentSignature(
  serialized: string,
) {
  try {
    const checkpoint = JSON.parse(serialized) as {
      version?: unknown;
      accountId?: unknown;
      groupId?: unknown;
      createdAt?: unknown;
      entries?: unknown;
      dailyMetricStatuses?: unknown;
    };
    if (checkpoint.version !== 2) return;
    return nativeGoogleHealthStableHash(
      asciiJson({
        accountId: checkpoint.accountId,
        groupId: checkpoint.groupId,
        refreshDate:
          typeof checkpoint.createdAt === "string"
            ? checkpoint.createdAt.slice(0, 10)
            : undefined,
        entries: checkpoint.entries,
        dailyMetricStatuses: checkpoint.dailyMetricStatuses,
      }),
    );
  } catch {
    return;
  }
}

export function serializeNativeGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
  now = new Date(),
): string | undefined {
  const checkpoint = buildGoogleHealthGroupCheckpoint(source, now);
  if (!checkpoint) return;
  const latestStatusByKey = new Map<string, (typeof checkpoint.dailyMetricStatuses)[number]>();
  for (const status of checkpoint.dailyMetricStatuses) {
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
  const entries = checkpoint.entries
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    .slice(-NATIVE_GOOGLE_GROUP_MAX_ENTRIES);
  if (!statuses.length && !entries.length) return;

  const compact = { ...checkpoint, entries, dailyMetricStatuses: statuses };
  while (
    (compact.entries.length > 0 || compact.dailyMetricStatuses.length > 1) &&
    asciiJson(compact).length >
      NATIVE_GOOGLE_GROUP_CHUNK_LENGTH * NATIVE_GOOGLE_GROUP_MAX_CHUNKS
  ) {
    // Preserve a useful recent-status floor, then let older compact totals
    // yield before human-readable meal/workout rows. Detail is expensive to
    // reconstruct and is the reason this encrypted cache exists; today's
    // statuses remain at the newest end of the sorted array.
    if (
      compact.dailyMetricStatuses.length >
      NATIVE_GOOGLE_GROUP_RESERVED_RECENT_STATUSES
    )
      compact.dailyMetricStatuses.shift();
    else if (compact.entries.length) compact.entries.shift();
    else compact.dailyMetricStatuses.shift();
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
  if (nativeGoogleHealthStableHash(serialized) !== manifest.signature) return;
  if (
    nativeGoogleHealthCheckpointContentSignature(serialized) ===
    manifest.contentSignature
  )
    return serialized;
  // Manifest v1 originally coalesced writes by creation day and omitted the
  // payload version. Accept that exact signature only for a v2 payload so the
  // reader can validate, parse and rewrite existing encrypted checkpoints as
  // v3 without weakening the current v3 integrity check.
  return legacyNativeGoogleHealthCheckpointContentSignature(serialized) ===
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
