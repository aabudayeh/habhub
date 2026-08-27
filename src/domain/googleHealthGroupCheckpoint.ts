import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { cloudEntryNeedsItemDetail } from "@/src/domain/cloudMaintenance";
import type { DailyMetricStatus, MetricEntry } from "@/src/types";

export const GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION = 2 as const;
export const GOOGLE_HEALTH_GROUP_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_DAYS = 120;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES = 10_000;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES = 500;

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
  const earliestDate = dateWithOffsetFrom(
    today,
    -(GOOGLE_HEALTH_GROUP_CHECKPOINT_DAYS - 1),
  );
  const statuses = source.dailyMetricStatuses
    .filter((status) =>
      validSharedGoogleStatus(status, source.groupId, earliestDate, today),
    )
    .slice(-GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES)
    .map(minimalSharedGoogleStatus);
  const entries = (source.entries ?? [])
    .filter((entry) =>
      validSharedGoogleEntry(
        entry,
        source.currentUserId,
        earliestDate,
        today,
      ),
    )
    .slice(-GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES)
    .map(minimalSharedGoogleEntry);
  if (!statuses.length && !entries.length) return;
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId: source.currentUserId,
    groupId: source.groupId,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + GOOGLE_HEALTH_GROUP_CHECKPOINT_TTL_MS,
    ).toISOString(),
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
  if (
    checkpoint.version !== GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION ||
    checkpoint.accountId !== accountId ||
    checkpoint.groupId !== groupId ||
    !validIso(checkpoint.createdAt) ||
    !validIso(checkpoint.expiresAt) ||
    Date.parse(checkpoint.createdAt!) > now.getTime() + 5 * 60_000 ||
    Date.parse(checkpoint.expiresAt!) <= now.getTime() ||
    Date.parse(checkpoint.expiresAt!) - Date.parse(checkpoint.createdAt!) >
      GOOGLE_HEALTH_GROUP_CHECKPOINT_TTL_MS + 5 * 60_000 ||
    !Array.isArray(checkpoint.dailyMetricStatuses) ||
    checkpoint.dailyMetricStatuses.length >
      GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES ||
    !Array.isArray(checkpoint.entries) ||
    checkpoint.entries.length > GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_ENTRIES
  )
    return;
  const today = dateKey(now);
  const earliestDate = dateWithOffsetFrom(
    today,
    -(GOOGLE_HEALTH_GROUP_CHECKPOINT_DAYS - 1),
  );
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
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId,
    groupId,
    createdAt: checkpoint.createdAt!,
    expiresAt: checkpoint.expiresAt!,
    entries: checkpoint.entries.map(minimalSharedGoogleEntry),
    dailyMetricStatuses: checkpoint.dailyMetricStatuses.map(
      minimalSharedGoogleStatus,
    ),
  };
}
