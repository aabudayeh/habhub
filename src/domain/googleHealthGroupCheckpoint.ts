import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import type { DailyMetricStatus } from "@/src/types";

export const GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION = 1 as const;
export const GOOGLE_HEALTH_GROUP_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_DAYS = 35;
const GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES = 10_000;

export type GoogleHealthGroupCheckpoint = {
  version: typeof GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION;
  accountId: string;
  groupId: string;
  createdAt: string;
  expiresAt: string;
  dailyMetricStatuses: DailyMetricStatus[];
};

export type GoogleHealthGroupCheckpointSource = {
  currentUserId: string;
  groupId: string;
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

/**
 * Stores only already-authorized compact group projections. Raw provider
 * records, meal payloads, notes, images, private values and provider ids are
 * never included. The web storage adapter encrypts this checkpoint at rest.
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
  if (!statuses.length) return;
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId: source.currentUserId,
    groupId: source.groupId,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + GOOGLE_HEALTH_GROUP_CHECKPOINT_TTL_MS,
    ).toISOString(),
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
      GOOGLE_HEALTH_GROUP_CHECKPOINT_MAX_STATUSES
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
    )
  )
    return;
  return {
    version: GOOGLE_HEALTH_GROUP_CHECKPOINT_VERSION,
    accountId,
    groupId,
    createdAt: checkpoint.createdAt!,
    expiresAt: checkpoint.expiresAt!,
    dailyMetricStatuses: checkpoint.dailyMetricStatuses.map(
      minimalSharedGoogleStatus,
    ),
  };
}
