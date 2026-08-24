import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { reconcileGoogleHealthNativeMirrors } from "@/src/domain/health";
import { isGoogleHealthEntry } from "@/src/domain/googleHealthLocalPrivacy";
import { metricEntryKey } from "@/src/domain/metricEntry";
import type { AppState, MetricEntry, Visibility } from "@/src/types";

export const GOOGLE_HEALTH_STEP_CHECKPOINT_VERSION = 2 as const;
export const GOOGLE_HEALTH_STEP_CHECKPOINT_TTL_MS = 48 * 60 * 60 * 1000;
const GOOGLE_HEALTH_CHECKPOINT_MAX_ENTRIES = 128;

export type GoogleHealthStepCheckpoint = {
  version: typeof GOOGLE_HEALTH_STEP_CHECKPOINT_VERSION;
  accountId: string;
  createdAt: string;
  expiresAt: string;
  entries: MetricEntry[];
};

export type GoogleHealthStepCheckpointSource = Pick<
  AppState,
  "currentUserId" | "metrics" | "entries"
>;

function checkpointMetricIds(state: Pick<AppState, "metrics">) {
  return new Set(
    state.metrics
      .filter((metric) => {
        const type = metric.healthMapping?.dataType;
        return (
          type === "steps" ||
          type === "active_energy" ||
          type === "total_energy" ||
          type === "workouts" ||
          (type === "nutrition" && metric.id === "food")
        );
      })
      .map((metric) => metric.id),
  );
}

function validVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "status" || value === "group";
}

function safeOptionalString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : undefined;
}

function validRecentEntry(
  value: unknown,
  accountId: string,
  metricIds: ReadonlySet<string>,
  earliestDate: string,
  latestDate: string,
): value is MetricEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<MetricEntry>;
  const numericValue = Number(entry.value);
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    entry.id.length <= 500 &&
    entry.userId === accountId &&
    typeof entry.metricId === "string" &&
    metricIds.has(entry.metricId) &&
    typeof entry.localDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.localDate) &&
    entry.localDate >= earliestDate &&
    entry.localDate <= latestDate &&
    typeof entry.recordedAt === "string" &&
    Number.isFinite(Date.parse(entry.recordedAt)) &&
    Number.isFinite(numericValue) &&
    numericValue >= 0 &&
    entry.source === "imported" &&
    entry.sourceProvider === "google_health" &&
    validVisibility(entry.visibility) &&
    isGoogleHealthEntry(entry as MetricEntry)
  );
}

function minimalCheckpointEntry(entry: MetricEntry): MetricEntry {
  return {
    id: entry.id.slice(0, 500),
    metricId: entry.metricId.slice(0, 200),
    userId: entry.userId,
    value: Math.max(0, Number(entry.value)),
    localDate: entry.localDate,
    recordedAt: entry.recordedAt,
    visibility: entry.visibility,
    source: "imported",
    sourceProvider: "google_health",
    ...(safeOptionalString(entry.label, 200)
      ? { label: safeOptionalString(entry.label, 200) }
      : {}),
    ...(safeOptionalString(entry.sourceRecordId, 500)
      ? { sourceRecordId: safeOptionalString(entry.sourceRecordId, 500) }
      : {}),
    ...(safeOptionalString(entry.sourceOrigin, 320)
      ? { sourceOrigin: safeOptionalString(entry.sourceOrigin, 320) }
      : {}),
    ...(safeOptionalString(entry.sourceUpdatedAt, 64) &&
    Number.isFinite(Date.parse(entry.sourceUpdatedAt!))
      ? { sourceUpdatedAt: entry.sourceUpdatedAt }
      : {}),
    ...(Number.isFinite(entry.sourceRevision)
      ? { sourceRevision: Math.max(0, Math.floor(entry.sourceRevision!)) }
      : {}),
  };
}

/**
 * A deliberately small encrypted-at-rest browser checkpoint. It contains only
 * recent numeric inputs needed to avoid false zeroes for Steps, Food, activity,
 * workout-derived activity and Total energy while the protected cloud snapshot
 * hydrates. Nutrition payloads, notes, images and override registries never
 * enter it.
 */
export function buildGoogleHealthStepCheckpoint(
  state: GoogleHealthStepCheckpointSource,
  now = new Date(),
): GoogleHealthStepCheckpoint | undefined {
  const today = dateKey(now);
  const earliestDate = dateWithOffsetFrom(today, -1);
  const metricIds = checkpointMetricIds(state);
  const entries = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        metricIds.has(entry.metricId) &&
        entry.localDate >= earliestDate &&
        entry.localDate <= today &&
        isGoogleHealthEntry(entry) &&
        entry.sourceProvider === "google_health" &&
        Number.isFinite(Number(entry.value)) &&
        Number(entry.value) >= 0,
    )
    .slice(-GOOGLE_HEALTH_CHECKPOINT_MAX_ENTRIES)
    .map(minimalCheckpointEntry);
  if (!entries.length) return undefined;
  return {
    version: GOOGLE_HEALTH_STEP_CHECKPOINT_VERSION,
    accountId: state.currentUserId,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + GOOGLE_HEALTH_STEP_CHECKPOINT_TTL_MS,
    ).toISOString(),
    entries,
  };
}

export function parseGoogleHealthStepCheckpoint(
  value: unknown,
  state: Pick<AppState, "currentUserId" | "metrics">,
  now = new Date(),
): GoogleHealthStepCheckpoint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = value as Partial<GoogleHealthStepCheckpoint>;
  if (
    candidate.version !== GOOGLE_HEALTH_STEP_CHECKPOINT_VERSION ||
    candidate.accountId !== state.currentUserId ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    Date.parse(candidate.createdAt) > now.getTime() + 5 * 60_000 ||
    Date.parse(candidate.expiresAt) <= now.getTime() ||
    Date.parse(candidate.expiresAt) - Date.parse(candidate.createdAt) >
      GOOGLE_HEALTH_STEP_CHECKPOINT_TTL_MS + 5 * 60_000 ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > GOOGLE_HEALTH_CHECKPOINT_MAX_ENTRIES
  )
    return;
  const today = dateKey(now);
  const earliestDate = dateWithOffsetFrom(today, -1);
  const metricIds = checkpointMetricIds(state);
  if (
    !candidate.entries.every((entry) =>
      validRecentEntry(
        entry,
        state.currentUserId,
        metricIds,
        earliestDate,
        today,
      ),
    )
  )
    return;
  return {
    version: GOOGLE_HEALTH_STEP_CHECKPOINT_VERSION,
    accountId: state.currentUserId,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    entries: candidate.entries.map(minimalCheckpointEntry),
  };
}

export function mergeGoogleHealthStepCheckpoint(
  state: AppState,
  checkpoint: GoogleHealthStepCheckpoint | undefined,
  now = new Date(),
): AppState {
  const parsed = parseGoogleHealthStepCheckpoint(checkpoint, state, now);
  if (!parsed) return state;
  const entries = new Map(
    state.entries.map((entry) => [
      metricEntryKey(entry.userId, entry.id),
      entry,
    ]),
  );
  let changed = false;
  for (const cached of parsed.entries) {
    const key = metricEntryKey(cached.userId, cached.id);
    const existing = entries.get(key);
    const existingRevision = Date.parse(
      existing?.sourceUpdatedAt ?? existing?.recordedAt ?? "",
    );
    const cachedRevision = Date.parse(
      cached.sourceUpdatedAt ?? cached.recordedAt,
    );
    if (
      existing &&
      (!isGoogleHealthEntry(existing) ||
        (Number.isFinite(existingRevision) && existingRevision >= cachedRevision))
    )
      continue;
    entries.set(key, cached);
    changed = true;
  }
  if (!changed) return state;
  return {
    ...state,
    entries: reconcileGoogleHealthNativeMirrors(
      [...entries.values()],
      state.metrics,
      state.settings.healthSync.sourcePreferences,
      state.currentUserId,
    ),
  };
}
