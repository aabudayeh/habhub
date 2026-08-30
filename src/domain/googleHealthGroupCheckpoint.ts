import { dateKey } from "@/src/domain/date";
import { cloudEntryNeedsItemDetail } from "@/src/domain/cloudMaintenance";
import type { DailyMetricStatus, MetricEntry } from "@/src/types";

export const GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION = 3 as const;
const LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION = 2 as const;
// An authorized item that was already shown must remain available across app
// restarts. Privacy fences, exact tombstones, membership loss and sign-out are
// the invalidation boundary; elapsed wall-clock time is not. The broad caps
// protect local storage without imposing the old seven-day/120-day expiry.
const GOOGLE_HEALTH_GROUP_CHECKPOINT_EARLIEST_DATE = "2000-01-01";
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES = 20_000;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES = 5_000;
const LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES = 10_000;
const LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES = 500;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_STATUS_BUDGET = 2 * 1024 * 1024;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_ENTRY_BUDGET = 6 * 1024 * 1024;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_SERIALIZED_BYTES =
  GOOGLE_HEALTH_GROUP_CHECKPOINT_STATUS_BUDGET +
  GOOGLE_HEALTH_GROUP_CHECKPOINT_ENTRY_BUDGET +
  16 * 1024;
const NON_EXPIRING_CHECKPOINT_DATE = "9999-12-31T23:59:59.999Z";

export type GoogleHealthGroupCheckpoint = {
  version: typeof GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION;
  accountId: string;
  groupId: string;
  createdAt: string;
  expiresAt: string;
  entries: MetricEntry[];
  dailyMetricStatuses: DailyMetricStatus[];
};

export type GoogleHealthGroupCheckpointSource = {
  currentUserId: string;
  groupId: string;
  entries?: readonly MetricEntry[];
  dailyMetricStatuses: readonly DailyMetricStatus[];
};

function validIso(value: unknown) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function validLocalDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validSharedGoogleStatus(
  value: unknown,
  groupId: string,
  earliestDate: string,
  latestDate: string,
): value is DailyMetricStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Partial<DailyMetricStatus>;
  return (
    status.groupId === groupId &&
    typeof status.metricId === "string" &&
    status.metricId.length > 0 &&
    status.metricId.length <= 200 &&
    typeof status.userId === "string" &&
    status.userId.length > 0 &&
    status.userId.length <= 200 &&
    validLocalDate(status.localDate) &&
    status.localDate! >= earliestDate &&
    status.localDate! <= latestDate &&
    typeof status.goalReached === "boolean" &&
    Number.isFinite(Number(status.scoreContribution)) &&
    status.sourceProvider === "google_health" &&
    (status.visibility === "group" || status.visibility === "status") &&
    status.privacyProjectionVersion === 2 &&
    (status.syncedAt === undefined || validIso(status.syncedAt)) &&
    (status.sourceRevision === undefined ||
      (Number.isSafeInteger(status.sourceRevision) && status.sourceRevision >= 0)) &&
    (status.exactValue === undefined ||
      (status.visibility === "group" && Number.isFinite(status.exactValue)))
  );
}

function minimalSharedGoogleStatus(
  status: DailyMetricStatus,
): DailyMetricStatus {
  const exactShared = status.visibility === "group";
  return {
    groupId: status.groupId,
    metricId: status.metricId.slice(0, 200),
    userId: status.userId.slice(0, 200),
    localDate: status.localDate,
    goalReached: status.goalReached,
    scoreContribution: Math.max(
      0,
      Math.min(100, Number(status.scoreContribution) || 0),
    ),
    ...(Number.isFinite(status.goalProgress)
      ? { goalProgress: Math.max(0, Math.min(300, status.goalProgress!)) }
      : {}),
    ...(status.goalKind ? { goalKind: status.goalKind } : {}),
    ...(exactShared && Number.isFinite(status.goalTarget)
      ? { goalTarget: status.goalTarget }
      : {}),
    visibility: status.visibility,
    ...(typeof status.goalEligible === "boolean"
      ? { goalEligible: status.goalEligible }
      : {}),
    ...(exactShared && Number.isFinite(status.exactValue)
      ? { exactValue: status.exactValue }
      : {}),
    privacyProjectionVersion: 2,
    ...(typeof status.hasData === "boolean" ? { hasData: status.hasData } : {}),
    sourceProvider: "google_health",
    ...(validIso(status.syncedAt) ? { syncedAt: status.syncedAt } : {}),
    ...(Number.isSafeInteger(status.sourceRevision) &&
    Number(status.sourceRevision) >= 0
      ? { sourceRevision: Math.floor(status.sourceRevision!) }
      : {}),
  };
}

function boundedText(value: unknown, maximum: number) {
  return value === undefined ||
    (typeof value === "string" && value.length <= maximum);
}

function boundedJson(value: unknown, maximum: number) {
  if (value === undefined) return true;
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function boundedJsonUtf8(value: unknown, maximumBytes: number) {
  try {
    const serialized = JSON.stringify(value);
    return (
      serialized === undefined || utf8ByteLength(serialized) <= maximumBytes
    );
  } catch {
    return false;
  }
}

function newestWithinSerializedBudget<T>(
  values: readonly T[],
  maximumBytes: number,
) {
  const retained: T[] = [];
  let usedBytes = 2;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    const serialized = JSON.stringify(value);
    if (serialized === undefined) continue;
    const valueBytes =
      utf8ByteLength(serialized) + (retained.length ? 1 : 0);
    if (usedBytes + valueBytes > maximumBytes) continue;
    retained.push(value);
    usedBytes += valueBytes;
  }
  return retained.reverse();
}

function validSharedGoogleEntry(
  value: unknown,
  accountId: string,
  earliestDate: string,
  latestDate: string,
): value is MetricEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<MetricEntry>;
  const validValue =
    typeof entry.value === "boolean" ||
    (typeof entry.value === "number" && Number.isFinite(entry.value)) ||
    (typeof entry.value === "string" && entry.value.length <= 500);
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    entry.id.length <= 300 &&
    (entry.cloudId === undefined ||
      (typeof entry.cloudId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          entry.cloudId,
        ))) &&
    typeof entry.metricId === "string" &&
    entry.metricId.length > 0 &&
    entry.metricId.length <= 200 &&
    typeof entry.userId === "string" &&
    entry.userId.length > 0 &&
    entry.userId.length <= 200 &&
    entry.userId !== accountId &&
    validValue &&
    validLocalDate(entry.localDate) &&
    entry.localDate! >= earliestDate &&
    entry.localDate! <= latestDate &&
    validIso(entry.recordedAt) &&
    entry.visibility === "group" &&
    entry.source === "imported" &&
    entry.sourceProvider === "google_health" &&
    boundedText(entry.label, 300) &&
    boundedText(entry.note, 1_000) &&
    boundedText(entry.sourceRecordId, 500) &&
    boundedText(entry.sourceOrigin, 300) &&
    boundedText(entry.imageStoragePath, 500) &&
    boundedJson(entry.nutrition, 12_000) &&
    boundedJson(entry.submetricValues, 4_000) &&
    (entry.sourceUpdatedAt === undefined || validIso(entry.sourceUpdatedAt)) &&
    (entry.sourceRevision === undefined ||
      (Number.isSafeInteger(entry.sourceRevision) && entry.sourceRevision >= 0)) &&
    cloudEntryNeedsItemDetail(entry as MetricEntry)
  );
}

function minimalSharedGoogleEntry(entry: MetricEntry): MetricEntry {
  return {
    id: entry.id.slice(0, 300),
    ...(entry.cloudId ? { cloudId: entry.cloudId } : {}),
    metricId: entry.metricId.slice(0, 200),
    userId: entry.userId.slice(0, 200),
    value: entry.value,
    localDate: entry.localDate,
    recordedAt: entry.recordedAt,
    visibility: "group",
    source: "imported",
    ...(entry.label ? { label: entry.label.slice(0, 300) } : {}),
    ...(entry.note ? { note: entry.note.slice(0, 1_000) } : {}),
    ...(entry.nutrition ? { nutrition: entry.nutrition } : {}),
    ...(entry.submetricValues
      ? { submetricValues: entry.submetricValues }
      : {}),
    sourceProvider: "google_health",
    ...(entry.sourceRecordId
      ? { sourceRecordId: entry.sourceRecordId.slice(0, 500) }
      : {}),
    ...(entry.sourceOrigin
      ? { sourceOrigin: entry.sourceOrigin.slice(0, 300) }
      : {}),
    ...(entry.sourceUpdatedAt
      ? { sourceUpdatedAt: entry.sourceUpdatedAt }
      : {}),
    ...(Number.isSafeInteger(entry.sourceRevision)
      ? { sourceRevision: entry.sourceRevision }
      : {}),
    ...(entry.imageStoragePath
      ? { imageStoragePath: entry.imageStoragePath.slice(0, 500) }
      : {}),
  };
}

/**
 * Stores already-authorized compact projections plus only the human-readable
 * meal/workout rows a member explicitly shared with the group. High-frequency
 * sensor records and private/status-only values are never included. Native
 * storage is Keychain/Keystore-backed and Web storage encrypts with AES-GCM.
 */
export function buildGoogleHealthGroupCheckpoint(
  source: GoogleHealthGroupCheckpointSource,
  now = new Date(),
): GoogleHealthGroupCheckpoint | undefined {
  if (!source.currentUserId || !source.groupId) return;
  const today = dateKey(now);
  const earliestDate = GOOGLE_HEALTH_GROUP_CHECKPOINT_EARLIEST_DATE;
  const statusCandidates = source.dailyMetricStatuses
    .filter((status) =>
      validSharedGoogleStatus(status, source.groupId, earliestDate, today),
    )
    .sort((left, right) =>
      left.localDate === right.localDate
        ? (left.syncedAt ?? "").localeCompare(right.syncedAt ?? "")
        : left.localDate.localeCompare(right.localDate),
    )
    .slice(-GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES)
    .map(minimalSharedGoogleStatus);
  const entryCandidates = (source.entries ?? [])
    .filter((entry) =>
      validSharedGoogleEntry(
        entry,
        source.currentUserId,
        earliestDate,
        today,
      ),
    )
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    .slice(-GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES)
    .map(minimalSharedGoogleEntry);
  // IndexedDB can hold much more than the old rolling window, but a malformed
  // nutrition payload must not turn one cache rewrite into an 80 MB main-thread
  // stringify/encryption task. Keep the newest authorized rows within fixed
  // status/detail byte budgets; ordinary groups retain years of sparse logs.
  const statuses = newestWithinSerializedBudget(
    statusCandidates,
    GOOGLE_HEALTH_GROUP_CHECKPOINT_STATUS_BUDGET,
  );
  const entries = newestWithinSerializedBudget(
    entryCandidates,
    GOOGLE_HEALTH_GROUP_CHECKPOINT_ENTRY_BUDGET,
  );
  if (!statuses.length && !entries.length) return;
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId: source.currentUserId,
    groupId: source.groupId,
    createdAt: now.toISOString(),
    // Kept as a field so v2 ciphertext can be upgraded in place. Readers no
    // longer treat time as revocation; the authorization stream does that.
    expiresAt: NON_EXPIRING_CHECKPOINT_DATE,
    entries,
    dailyMetricStatuses: statuses,
  };
}

export function parseGoogleHealthGroupCheckpoint(
  value: unknown,
  accountId: string,
  groupId: string,
  now = new Date(),
): GoogleHealthGroupCheckpoint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const checkpoint = value as Partial<GoogleHealthGroupCheckpoint>;
  const checkpointVersion = (value as { version?: unknown }).version;
  const legacy =
    checkpointVersion === LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION;
  if (
    (checkpointVersion !== GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION &&
      checkpointVersion !== LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION) ||
    checkpoint.accountId !== accountId ||
    checkpoint.groupId !== groupId ||
    !validIso(checkpoint.createdAt) ||
    !validIso(checkpoint.expiresAt) ||
    Date.parse(checkpoint.createdAt!) > now.getTime() + 5 * 60_000 ||
    !Array.isArray(checkpoint.dailyMetricStatuses) ||
    checkpoint.dailyMetricStatuses.length >
      (legacy
        ? LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES
        : GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES) ||
    !Array.isArray(checkpoint.entries) ||
    checkpoint.entries.length >
      (legacy
        ? LEGACY_GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES
        : GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES) ||
    (!legacy &&
      !boundedJsonUtf8(
        checkpoint,
        GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_SERIALIZED_BYTES,
      ))
  )
    return;
  const today = dateKey(now);
  const earliestDate = GOOGLE_HEALTH_GROUP_CHECKPOINT_EARLIEST_DATE;
  if (
    !checkpoint.dailyMetricStatuses.every((status) =>
      validSharedGoogleStatus(status, groupId, earliestDate, today),
    ) ||
    !checkpoint.entries.every((entry) =>
      validSharedGoogleEntry(
        entry,
        accountId,
        earliestDate,
        today,
      ),
    )
  )
    return;
  const entries = checkpoint.entries.map(minimalSharedGoogleEntry);
  const dailyMetricStatuses = checkpoint.dailyMetricStatuses.map(
    minimalSharedGoogleStatus,
  );
  if (legacy) {
    entries.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    dailyMetricStatuses.sort((left, right) =>
      left.localDate === right.localDate
        ? (left.syncedAt ?? "").localeCompare(right.syncedAt ?? "")
        : left.localDate.localeCompare(right.localDate),
    );
  }
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId,
    groupId,
    createdAt: checkpoint.createdAt!,
    expiresAt: NON_EXPIRING_CHECKPOINT_DATE,
    // Legacy v2 had independent row caps but no total serialized-size limit.
    // Compact a valid authenticated upgrade instead of treating it as corrupt;
    // every subsequent write uses the bounded v3 representation.
    entries: legacy
      ? newestWithinSerializedBudget(
          entries,
          GOOGLE_HEALTH_GROUP_CHECKPOINT_ENTRY_BUDGET,
        )
      : entries,
    dailyMetricStatuses: legacy
      ? newestWithinSerializedBudget(
          dailyMetricStatuses,
          GOOGLE_HEALTH_GROUP_CHECKPOINT_STATUS_BUDGET,
        )
      : dailyMetricStatuses,
  };
}
