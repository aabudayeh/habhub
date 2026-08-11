import { SupabaseClient, User } from "@supabase/supabase-js";

import { DEFAULT_METRICS } from "@/src/data/seed";
import {
  calendarWeekRange,
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  monthDateRange,
} from "@/src/domain/date";
import {
  effectiveGoalTarget,
  displayGoalProgress,
  formatMetricValue,
  hasMetricData,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import { leaderboardRows } from "@/src/domain/leaderboard";
import { normalizeEnergyProfile } from "@/src/domain/energy";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import {
  isVacationDate,
  vacationDates,
} from "@/src/domain/vacation";
import { metricEntryKey } from "@/src/domain/metricEntry";
import { reconcileImportedHealthEntries } from "@/src/domain/health";
import { supabase } from "@/src/lib/supabase";
import { translateUiText } from "@/src/i18n";
import {
  AppState,
  ChatMessage,
  DailyMetricStatus,
  Group,
  Member,
  MetricDefinition,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

const MEDIA_BUCKET = "paceboard-media";
// Live screens only need a bounded shared cache. The signed-in member's full
// history remains in their private snapshot, while older shared rows already
// on this device are preserved below.
const SHARED_ACTIVITY_CACHE_DAYS = 120;
const SHARED_SUMMARY_HISTORY_START = "2000-01-01";
const SHARED_MESSAGE_CACHE_LIMIT = 200;
const SHARED_PHOTO_CACHE_LIMIT = 120;
// Push is an arrival alert, not a history-import side effect. Keeping this
// window bounded prevents an offline/history repair from releasing a burst of
// old chat notifications when the sender next opens the app.
const CHAT_PUSH_FRESHNESS_MS = 15 * 60 * 1000;
const METRIC_PUSH_FRESHNESS_MS = 30 * 60 * 1000;
const attemptedWinnerEvents = new Set<string>();
const COLORS = [
  "#0FBFB8",
  "#FF5750",
  "#081B49",
  "#3478D4",
  "#7756D9",
  "#E9A23B",
  "#D95852",
  "#2A8F86",
  "#9B6B43",
];

function withLocalizedPushCopy<T extends { title: string; body: string }>(
  payload: T,
) {
  return {
    ...payload,
    titles: localizedUiText(payload.title),
    bodies: localizedUiText(payload.body),
  };
}

function localizedUiText(source: string) {
  return Object.fromEntries(
    (["en", "ar", "es", "zh-Hans", "sv", "de", "ru", "fr"] as const).map(
      (language) => [language, translateUiText(language, source)],
    ),
  );
}

function literalPushCopy(source: string) {
  return Object.fromEntries(
    (["en", "ar", "es", "zh-Hans", "sv", "de", "ru", "fr"] as const).map(
      (language) => [language, source],
    ),
  );
}

type CloudActivityEntryRow = {
  client_generated_id: string;
  metric_id: string;
  user_id: string;
  value: MetricEntry["value"];
  local_date: string;
  recorded_at: string;
  visibility: MetricEntry["visibility"];
  source: MetricEntry["source"];
  label?: string | null;
  note?: string | null;
  nutrition?: MetricEntry["nutrition"] | null;
  submetric_values?: MetricEntry["submetricValues"] | null;
  source_provider?: MetricEntry["sourceProvider"] | null;
  source_record_id?: string | null;
  source_origin?: string | null;
  source_updated_at?: string | null;
  image_path?: string | null;
};

type CloudActivityStatusRow = {
  metric_id: string;
  user_id: string;
  local_date: string;
  goal_reached: boolean;
  score_contribution?: number | string | null;
  goal_progress?: number | string | null;
  goal_kind?: DailyMetricStatus["goalKind"] | null;
  goal_target?: number | string | null;
  visibility?: DailyMetricStatus["visibility"] | null;
  goal_eligible?: boolean | null;
  exact_value?: number | string | null;
  has_data?: boolean | null;
  updated_at?: string | null;
};

type CloudDailyStatusUpsertRow = {
  group_id: string;
  metric_id: string | undefined;
  user_id: string;
  local_date: string;
  goal_reached: boolean;
  score_contribution: number;
  goal_progress: number;
  goal_kind: MetricDefinition["goal"]["kind"];
  goal_target: number;
  visibility: MetricEntry["visibility"];
  goal_eligible: boolean;
  exact_value: number | null;
  has_data: boolean;
  account_revision: number;
};

type GroupActivitySnapshot = {
  version?: number;
  updated_at?: string | null;
  since_date?: string | null;
  entries_since_date?: string | null;
  statuses_since_date?: string | null;
  metrics?: { id: string; slug: string }[];
  entries?: CloudActivityEntryRow[];
  statuses?: CloudActivityStatusRow[];
  tombstones?: {
    user_id: string;
    client_generated_id: string;
    local_date: string;
    deleted_at: string;
  }[];
};

export type CloudActivityMetadata = {
  version?: number;
  updatedAt?: string;
  sinceDate?: string;
};

function batches<T>(items: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/** Supabase REST responses are capped by the project's max_rows setting. */
async function loadAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  pageSize = 750,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await query(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function isCloudGroupId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function requireCloud() {
  if (!supabase) throw new Error("Cloud is not configured.");
  return supabase;
}

function cloudErrorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "details", "hint", "code"]
      .map((key) =>
        typeof record[key] === "string" ? String(record[key]) : "",
      )
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(" · ");
  }
  return typeof error === "string" && error
    ? error
    : "The cloud did not return an error description.";
}

function buildCloudDailyStatusRows(
  state: AppState,
  idBySlug: Map<string, string>,
  ownedEntries: MetricEntry[],
  statusDates: string[],
  accountRevision: number,
): CloudDailyStatusUpsertRow[] {
  const exactSharedEntryDays = new Set<string>();
  const statusSharedEntryDays = new Set<string>();
  const privateEntryDays = new Set<string>();
  ownedEntries.forEach((entry) => {
    const key = `${entry.metricId}:${entry.localDate}`;
    if (entry.visibility === "group") exactSharedEntryDays.add(key);
    else if (entry.visibility === "status") statusSharedEntryDays.add(key);
    else privateEntryDays.add(key);
  });
  return statusDates.flatMap((localDate) =>
    (state.group.metricConfiguration ?? [])
      .filter((groupMetric) => {
        const personalMetric =
          state.metrics.find((metric) => metric.id === groupMetric.id) ??
          groupMetric;
        return (
          groupMetric.dataType !== "text" &&
          idBySlug.has(groupMetric.id) &&
          metricApplicableOnDate(
            state,
            personalMetric,
            state.currentUserId,
            localDate,
          )
        );
      })
      .map((groupMetric) => {
        const metric =
          state.metrics.find((candidate) => candidate.id === groupMetric.id) ??
          groupMetric;
        const value = safeMetricValue(
          state,
          metric,
          state.currentUserId,
          localDate,
        );
        const entryDayKey = `${metric.id}:${localDate}`;
        const hasExactSharedEntry = exactSharedEntryDays.has(entryDayKey);
        const hasStatusSharedEntry = statusSharedEntryDays.has(entryDayKey);
        const hasPrivateEntry = privateEntryDays.has(entryDayKey);
        const exactShared =
          !isVacationDate(state, state.currentUserId, localDate) &&
          (hasExactSharedEntry ||
            (metric.defaultVisibility === "group" &&
              (metric.dataType === "calculated" ||
                (Boolean(metric.gymMapping) &&
                  (state.gymSessions ?? []).some(
                    (session) =>
                      session.userId === state.currentUserId &&
                      session.localDate === localDate &&
                      session.visibility === "group",
                  )) ||
                metric.stepFallback === true)));
        const hasData = hasMetricData(
          state,
          metric,
          state.currentUserId,
          localDate,
        );
        const statusVisibility = hasExactSharedEntry
          ? ("group" as const)
          : hasStatusSharedEntry
            ? ("status" as const)
            : hasPrivateEntry
              ? ("private" as const)
              : metric.defaultVisibility;
        return {
          group_id: state.group.id,
          metric_id: idBySlug.get(groupMetric.id),
          user_id: state.currentUserId,
          local_date: localDate,
          goal_reached: scheduledGoalReached(
            state,
            metric,
            state.currentUserId,
            localDate,
          ),
          score_contribution:
            Math.min(
              metricVisualProgress(
                state,
                metric,
                state.currentUserId,
                localDate,
                value,
                effectiveGoalTarget(
                  state,
                  metric,
                  state.currentUserId,
                  localDate,
                ),
              ),
              1,
            ) * 100,
          goal_progress: Math.max(
            0,
            Math.min(
              300,
              (metric.goalProgressMode === "journey"
                ? metricVisualProgress(
                    state,
                    metric,
                    state.currentUserId,
                    localDate,
                    value,
                  )
                : displayGoalProgress(
                    metric,
                    value,
                    effectiveGoalTarget(
                      state,
                      metric,
                      state.currentUserId,
                      localDate,
                    ),
                  )) * 100,
            ),
          ),
          goal_kind: metric.goal.kind,
          goal_target: effectiveGoalTarget(
            state,
            metric,
            state.currentUserId,
            localDate,
          ),
          visibility: statusVisibility,
          goal_eligible: isMetricTrackedOnDate(state, metric, localDate),
          exact_value: exactShared ? value : null,
          has_data: hasData,
          account_revision: accountRevision,
        };
      }),
  );
}

async function resolveAccountRevision(
  client: SupabaseClient,
  userId: string,
  knownRevision?: number,
) {
  if (
    Number.isSafeInteger(knownRevision) &&
    Number(knownRevision) >= 0
  )
    return Number(knownRevision);
  const result = await client
    .from("user_snapshots")
    .select("revision")
    .eq("user_id", userId)
    .single();
  if (result.error) throw result.error;
  const revision = Number(result.data.revision);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("Account sync revision is not available yet.");
  return revision;
}

async function upsertCloudDailyStatusRows(
  client: SupabaseClient,
  rows: CloudDailyStatusUpsertRow[],
) {
  if (!rows.length) return;
  // Upsert before deleting anything. A transient server failure must not make
  // a member disappear from the leaderboard on other devices.
  for (const batch of batches(rows)) {
    let { error } = await client.from("daily_metric_status").upsert(batch, {
      onConflict: "group_id,metric_id,user_id,local_date",
    });
    if (
      error &&
      /goal_progress|goal_kind|goal_target|visibility|goal_eligible|exact_value|has_data/i.test(
        `${error.code ?? ""} ${error.message ?? ""}`,
      )
    ) {
      const legacyStatuses = batch.map(
        ({
          goal_progress: _progress,
          goal_kind: _kind,
          goal_target: _target,
          visibility: _visibility,
          goal_eligible: _eligible,
          exact_value: _exact,
          has_data: _hasData,
          ...status
        }) => status,
      );
      ({ error } = await client.from("daily_metric_status").upsert(
        legacyStatuses,
        { onConflict: "group_id,metric_id,user_id,local_date" },
      ));
    }
    if (error) throw error;
  }
}

async function commitCloudActivityCheckpoint(
  client: SupabaseClient,
  groupId: string,
  dates: string[],
  fallbackSince: string,
  accountRevision: number,
) {
  const commit = await client.rpc("commit_group_activity_version", {
    p_group_id: groupId,
    p_since_date: [...dates].sort()[0] ?? fallbackSince,
    p_expected_revision: accountRevision,
  });
  if (commit.error) throw commit.error;

  const checkpoint = await client
    .from("group_activity_versions")
    .select("version, updated_at")
    .eq("group_id", groupId)
    .maybeSingle();
  if (!checkpoint.error && checkpoint.data?.updated_at) {
    const version = Number(checkpoint.data.version);
    return {
      version: Number.isFinite(version) ? version : undefined,
      updatedAt: checkpoint.data.updated_at as string,
    };
  }

  // Older schemas have no version row. The daily status trigger still owns a
  // server timestamp, which is safer than presenting the phone clock as proof
  // that the server accepted the data.
  const latestStatus = await client
    .from("daily_metric_status")
    .select("updated_at")
    .eq("group_id", groupId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const committedVersion = Number(commit.data);
  return {
    version: Number.isFinite(committedVersion)
      ? committedVersion
      : undefined,
    updatedAt:
      !latestStatus.error && latestStatus.data?.updated_at
        ? (latestStatus.data.updated_at as string)
        : undefined,
  };
}

function normalizedGroupConversationId(
  conversationId: string | null | undefined,
  groupId: string,
) {
  return !conversationId || conversationId === "group"
    ? `group:${groupId}`
    : conversationId;
}

function messageBelongsToGroup(
  state: AppState,
  message: ChatMessage,
  groupId: string,
) {
  if (message.groupId) return message.groupId === groupId;
  if (message.conversationId?.startsWith("group:"))
    return message.conversationId === `group:${groupId}`;
  // Messages persisted before group ownership was introduced can only be
  // safely attached to the workspace that was active with that local cache.
  return state.group.id === groupId;
}

function cloudOwnedMessage(message: ChatMessage, groupId: string) {
  if (message.groupId) return message.groupId === groupId;
  return message.conversationId === `group:${groupId}`;
}

function messageForGroup(
  message: ChatMessage,
  groupId: string,
): ChatMessage {
  return {
    ...message,
    groupId,
    conversationId: normalizedGroupConversationId(
      message.conversationId,
      groupId,
    ),
  };
}

function memberColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "P"
  );
}

function metricFromRow(row: Record<string, any>): MetricDefinition {
  const configuration = (row.configuration ?? {}) as Partial<MetricDefinition>;
  const preset = DEFAULT_METRICS.find((metric) => metric.id === row.slug);
  const category = configuration.category ?? preset?.category ?? "other";
  const gymMapping =
    configuration.gymMapping ??
    preset?.gymMapping ??
    (category === "gym" && row.data_type === "number"
      ? {
          kind: "exercise_one_rep_max" as const,
          exerciseKey: `group:${row.group_id}:${row.slug}`,
        }
      : undefined);
  return {
    id: row.slug,
    name: row.slug === "blood_pressure_systolic" ? "Blood pressure" : row.name,
    icon: row.icon,
    color: row.color,
    unit: row.unit,
    dataType: row.data_type,
    aggregation: row.aggregation_method,
    rankingDirection: row.ranking_direction,
    goal: configuration.goal ?? { kind: "at_least", target: 1 },
    adaptiveGoalTarget: configuration.adaptiveGoalTarget,
    goalProgressMode:
      configuration.goalProgressMode ?? preset?.goalProgressMode,
    goalEnabled:
      configuration.goalEnabled ?? preset?.goalEnabled ?? true,
    goalRange: configuration.goalRange,
    category,
    grouping: configuration.grouping,
    healthMapping: configuration.healthMapping ?? preset?.healthMapping,
    gymMapping,
    gymMuscleGroups:
      configuration.gymMuscleGroups ?? preset?.gymMuscleGroups,
    stepFallback: configuration.stepFallback ?? preset?.stepFallback,
    manualEntry:
      gymMapping
        ? false
        : configuration.manualEntry ?? preset?.manualEntry ?? row.slug !== "steps",
    timerEnabled:
      configuration.timerEnabled ?? preset?.timerEnabled,
    submetrics: configuration.submetrics ?? preset?.submetrics,
    submetricDisplay:
      configuration.submetricDisplay ?? preset?.submetricDisplay,
    visualization:
      configuration.visualization ?? preset?.visualization,
    scoreWeight: Number(row.score_weight ?? 0),
    formula: row.formula ?? undefined,
    defaultVisibility: row.default_visibility,
    sections: configuration.sections ?? {
      today: true,
      group: true,
      insights: true,
    },
    order: Number(configuration.order ?? 0),
    activeFrom:
      configuration.activeFrom ?? new Date().toISOString().slice(0, 10),
    goalSchedule: configuration.goalSchedule,
    reminder: configuration.reminder,
    reminders: configuration.reminders,
  };
}

function metricRow(groupId: string, metric: MetricDefinition) {
  return {
    group_id: groupId,
    owner_user_id: null,
    slug: metric.id,
    name: metric.name,
    icon: metric.icon,
    color: metric.color,
    unit: metric.unit,
    data_type: metric.dataType,
    aggregation_method: metric.aggregation,
    ranking_direction: metric.rankingDirection,
    formula: metric.formula ?? null,
    score_weight: metric.scoreWeight,
    default_visibility: metric.defaultVisibility,
    configuration: {
      goal: metric.goal,
      adaptiveGoalTarget: metric.adaptiveGoalTarget,
      goalProgressMode: metric.goalProgressMode,
      goalEnabled: metric.goalEnabled,
      goalRange: metric.goalRange,
      category: metric.category,
      grouping: metric.grouping,
      healthMapping: metric.healthMapping,
      gymMapping: metric.gymMapping,
      gymMuscleGroups: metric.gymMuscleGroups,
      stepFallback: metric.stepFallback,
      manualEntry: metric.manualEntry,
      timerEnabled: metric.timerEnabled,
      submetrics: metric.submetrics,
      submetricDisplay: metric.submetricDisplay,
      visualization: metric.visualization,
      sections: metric.sections,
      order: metric.order,
      activeFrom: metric.activeFrom,
      // Reminder cadence and tracking dates are personal preferences. They
      // stay in each member's private snapshot and must not be overwritten by
      // the admin's copy of a shared tracker.
    },
  };
}

async function signedUrls(paths: string[]) {
  const client = requireCloud();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error) throw error;
  const pairs: [string, string][] = [];
  for (const item of data ?? [])
    if (item.path && item.signedUrl) pairs.push([item.path, item.signedUrl]);
  return new Map<string, string>(pairs);
}

/** Lightweight realtime chat refresh; avoids reloading every group entry. */
export async function loadCloudMessages(
  state: AppState,
  groupId: string,
): Promise<ChatMessage[]> {
  const client = requireCloud();
  const localGroupMessages = state.messages
    .filter((message) => messageBelongsToGroup(state, message, groupId))
    .map((message) => messageForGroup(message, groupId));
  const latestCachedAt = localGroupMessages
    .map((message) => message.createdAt)
    .sort()
    .at(-1);
  let query = client
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (latestCachedAt) {
    const overlap = new Date(latestCachedAt);
    overlap.setMinutes(overlap.getMinutes() - 5);
    query = query.gte("created_at", overlap.toISOString());
  }
  const { data, error } = await query.limit(SHARED_MESSAGE_CACHE_LIMIT);
  if (error) throw error;
  const rows = data ?? [];
  const urls = await signedUrls(
    rows.map((message) => message.image_path).filter(Boolean),
  );
  const remote: ChatMessage[] = rows.map((message) => ({
    id: message.client_generated_id ?? message.id,
    groupId,
    senderId: message.sender_id ?? "system",
    text: message.content,
    createdAt: message.created_at,
    kind: message.kind,
    conversationId: normalizedGroupConversationId(
      message.conversation_id,
      groupId,
    ),
    recipientId: message.recipient_id ?? undefined,
    imageStoragePath: message.image_path ?? undefined,
    imageUri: message.image_path
      ? (urls.get(message.image_path) ?? undefined)
      : undefined,
  }));
  const otherGroupMessages = state.messages.filter(
    (message) => !messageBelongsToGroup(state, message, groupId),
  );
  const byId = new Map(
    localGroupMessages.map((message) => [message.id, message]),
  );
  remote.forEach((message) => byId.set(message.id, message));
  return [...otherGroupMessages, ...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/** Refresh leaderboard values without reloading members, chat, or photos. */
export async function loadCloudGroupActivity(
  state: AppState,
  groupId: string,
  sinceDate?: string,
): Promise<
  Pick<AppState, "entries" | "dailyMetricStatuses"> & {
    version?: number;
    updatedAt?: string;
    deletedEntryKeys?: string[];
    authoritativeEntrySinceDate?: string;
    authoritativeStatusSinceDate?: string;
  }
> {
  const client = requireCloud();
  const activityStart = new Date();
  activityStart.setDate(
    activityStart.getDate() - SHARED_ACTIVITY_CACHE_DAYS,
  );
  const requestedSince = sinceDate ?? dateKey(activityStart);
  const recentEntrySince = dateKey(activityStart);
  const requestedEntrySince =
    requestedSince > recentEntrySince ? requestedSince : recentEntrySince;
  const snapshotResult = await client.rpc("get_group_activity_snapshot", {
    p_group_id: groupId,
    p_since_date: requestedSince,
  });
  const missingSnapshotRpc =
    snapshotResult.error?.code === "PGRST202" ||
    snapshotResult.error?.code === "42883";
  if (snapshotResult.error && !missingSnapshotRpc)
    throw snapshotResult.error;

  const snapshot = snapshotResult.data as GroupActivitySnapshot | null;
  const authoritativeSnapshot = !missingSnapshotRpc && snapshot !== null;
  const deletedEntryKeys = new Set(
    (snapshot?.tombstones ?? []).map(
      (tombstone) =>
        metricEntryKey(
          tombstone.user_id,
          tombstone.client_generated_id,
        ),
    ),
  );
  let metricRows = snapshot?.metrics ?? [];
  let entryRows = snapshot?.entries ?? [];
  let statusRows = snapshot?.statuses ?? [];

  // Backward compatibility while the migration is being rolled out. Once the
  // RPC exists, entries and statuses are read from one MVCC-consistent server
  // snapshot instead of two requests that can observe different write stages.
  if (missingSnapshotRpc) {
    const metricResult = await client
      .from("metric_definitions")
      .select("id, slug")
      .eq("group_id", groupId)
      .is("archived_at", null);
    if (metricResult.error) throw metricResult.error;
    metricRows = metricResult.data ?? [];
    const metricIds = metricRows.map((row) => row.id);
    [entryRows, statusRows] = await Promise.all([
      metricIds.length
        ? loadAllPages((from, to) => {
            let query = client
              .from("metric_entries")
              .select("*")
              .in("metric_id", metricIds)
              .order("recorded_at");
            query = query.gte("local_date", requestedEntrySince);
            return query.range(from, to);
          })
        : Promise.resolve([]),
      loadAllPages((from, to) => {
        let query = client
          .from("daily_metric_status")
          .select("*")
          .eq("group_id", groupId)
          .order("local_date");
        if (requestedSince)
          query = query.gte("local_date", requestedSince);
        return query.range(from, to);
      }),
    ]);
  }
  const slugById = new Map((metricRows ?? []).map((row) => [row.id, row.slug]));
  const urls = await signedUrls(
    entryRows
      .map((entry) => entry.image_path)
      .filter((path): path is string => Boolean(path)),
  );
  const remoteEntries: MetricEntry[] = entryRows.map((entry) => ({
    id: entry.client_generated_id,
    metricId: slugById.get(entry.metric_id) ?? entry.metric_id,
    userId: entry.user_id,
    value: entry.value as number | boolean | string,
    localDate: entry.local_date,
    recordedAt: entry.recorded_at,
    visibility: entry.visibility,
    source: entry.source,
    label: entry.label ?? undefined,
    note: entry.note ?? undefined,
    nutrition: entry.nutrition ?? undefined,
    submetricValues: entry.submetric_values ?? undefined,
    sourceProvider: entry.source_provider ?? undefined,
    sourceRecordId: entry.source_record_id ?? undefined,
    sourceOrigin: entry.source_origin ?? undefined,
    sourceUpdatedAt: entry.source_updated_at ?? undefined,
    imageStoragePath: entry.image_path ?? undefined,
    imageUri: entry.image_path
      ? (urls.get(entry.image_path) ?? undefined)
      : undefined,
  }));
  const groupMetricSlugs = new Set(slugById.values());
  const groupMemberIds = new Set(state.group.members.map((member) => member.id));
  // A range response is a delta, not proof that an absent cached row was
  // deleted. Seed the result with the matching local cache so an overlapping
  // realtime/manual refresh cannot temporarily erase a friend's leaderboard
  // value while related entry/status writes are still settling.
  const entriesById = new Map(
    state.entries
      .filter(
        (entry) =>
          !deletedEntryKeys.has(metricEntryKey(entry.userId, entry.id)) &&
          groupMetricSlugs.has(entry.metricId) &&
          groupMemberIds.has(entry.userId) &&
          (!authoritativeSnapshot ||
            entry.userId === state.currentUserId) &&
          (!authoritativeSnapshot ||
            entry.localDate >=
              (snapshot?.entries_since_date ?? requestedEntrySince)),
      )
      .map((entry) => [metricEntryKey(entry.userId, entry.id), entry]),
  );
  remoteEntries.forEach((entry) => {
    const key = metricEntryKey(entry.userId, entry.id);
    if (deletedEntryKeys.has(key)) return;
    const cached = entriesById.get(key);
    const cachedIsNewer =
      Boolean(cached?.sourceUpdatedAt) &&
      Boolean(entry.sourceUpdatedAt) &&
      cached!.sourceUpdatedAt! > entry.sourceUpdatedAt!;
    if (cached?.userId !== state.currentUserId && !cachedIsNewer)
      entriesById.set(key, entry);
    else if (!cached) entriesById.set(key, entry);
  });
  state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        !deletedEntryKeys.has(metricEntryKey(entry.userId, entry.id)) &&
        entry.localDate >= requestedEntrySince,
    )
    .forEach((entry) => {
      const key = metricEntryKey(entry.userId, entry.id);
      if (!entriesById.has(key)) entriesById.set(key, entry);
    });
  const remoteStatuses: DailyMetricStatus[] = statusRows.map((status) => ({
    groupId,
    metricId: slugById.get(status.metric_id) ?? status.metric_id,
    userId: status.user_id,
    localDate: status.local_date,
    goalReached: Boolean(status.goal_reached),
    scoreContribution: Number(status.score_contribution ?? 0),
    goalProgress:
      status.goal_progress === null || status.goal_progress === undefined
        ? undefined
        : Number(status.goal_progress),
    goalKind: status.goal_kind ?? undefined,
    goalTarget:
      status.goal_target === null || status.goal_target === undefined
        ? undefined
        : Number(status.goal_target),
    visibility: status.visibility ?? undefined,
    goalEligible:
      status.goal_eligible === null || status.goal_eligible === undefined
        ? undefined
        : Boolean(status.goal_eligible),
    exactValue:
      status.exact_value === null || status.exact_value === undefined
        ? undefined
        : Number(status.exact_value),
    hasData:
      status.has_data === null || status.has_data === undefined
        ? undefined
        : Boolean(status.has_data),
    syncedAt: status.updated_at ?? undefined,
  }));
  const statusMap = new Map(
    state.dailyMetricStatuses
      .filter(
        (status) =>
          status.groupId === groupId &&
          (!authoritativeSnapshot ||
            status.userId === state.currentUserId) &&
          (!authoritativeSnapshot ||
            status.localDate >=
              (snapshot?.statuses_since_date ?? requestedSince)),
      )
      .map((status) => [
        `${status.groupId}:${status.metricId}:${status.userId}:${status.localDate}`,
        status,
      ]),
  );
  remoteStatuses.forEach((status) => {
    const key = `${status.groupId}:${status.metricId}:${status.userId}:${status.localDate}`;
    const cached = statusMap.get(key);
    if (
      !cached?.syncedAt ||
      !status.syncedAt ||
      status.syncedAt >= cached.syncedAt
    )
      statusMap.set(key, status);
  });
  const sourceFiltered = reconcileImportedHealthEntries(
    [...entriesById.values()],
    state.metrics,
    state.settings.healthSync.sourcePreferences,
    state.currentUserId,
  );
  const deduplicatedEntries = reconcileImportedHealthEntries(
    sourceFiltered,
    state.metrics,
  );
  return {
    entries: deduplicatedEntries.sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    ),
    dailyMetricStatuses: [...statusMap.values()],
    version:
      typeof snapshot?.version === "number" ? snapshot.version : undefined,
    updatedAt: snapshot?.updated_at ?? undefined,
    deletedEntryKeys: [...deletedEntryKeys],
    authoritativeEntrySinceDate: authoritativeSnapshot
      ? (snapshot?.entries_since_date ?? requestedEntrySince)
      : undefined,
    authoritativeStatusSinceDate: authoritativeSnapshot
      ? (snapshot?.statuses_since_date ?? requestedSince)
      : undefined,
  };
}

async function groupMembers(groupIds: string[]) {
  const client = requireCloud();
  if (!groupIds.length)
    return new Map<string, { active: Member[]; pending: Member[] }>();
  const currentMembership = await client
    .from("group_members")
    .select(
      "group_id, user_id, role, status, last_seen_at, last_data_synced_at",
    )
    .in("group_id", groupIds);
  let membership: {
    group_id: string;
    user_id: string;
    role: Member["role"];
    status: string;
    last_seen_at?: string | null;
    last_data_synced_at?: string | null;
  }[];
  if (!currentMembership.error) {
    membership = (currentMembership.data ?? []) as typeof membership;
  } else if (/last_data_synced_at/i.test(currentMembership.error.message)) {
    // Allow the app update to remain usable while the additive migration is
    // being deployed. Approval status and presence must not regress merely
    // because the new freshness column is not visible in the schema cache yet.
    const compatible = await client
      .from("group_members")
      .select("group_id, user_id, role, status, last_seen_at")
      .in("group_id", groupIds);
    if (!compatible.error) {
      membership = (compatible.data ?? []).map((row) => ({
        ...row,
        last_data_synced_at: null,
      })) as typeof membership;
    } else if (!/status|last_seen_at|column/i.test(compatible.error.message)) {
      throw compatible.error;
    } else {
      const legacy = await client
        .from("group_members")
        .select("group_id, user_id, role")
        .in("group_id", groupIds);
      if (legacy.error) throw legacy.error;
      membership = (legacy.data ?? []).map((row) => ({
        ...row,
        status: "active",
        last_seen_at: null,
        last_data_synced_at: null,
      })) as typeof membership;
    }
  } else if (/status|last_seen_at|column/i.test(currentMembership.error.message)) {
    const legacy = await client
      .from("group_members")
      .select("group_id, user_id, role")
      .in("group_id", groupIds);
    if (legacy.error) throw legacy.error;
    membership = (legacy.data ?? []).map((row) => ({
      ...row,
      status: "active",
      last_seen_at: null,
      last_data_synced_at: null,
    })) as typeof membership;
  } else {
    throw currentMembership.error;
  }
  const userIds = [...new Set((membership ?? []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await client
        .from("profiles")
        .select("id, display_name, avatar_path, account_revision")
        .in("id", userIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const urls = await signedUrls(
    (profiles ?? []).map((profile) => profile.avatar_path).filter(Boolean),
  );
  const result = new Map<string, { active: Member[]; pending: Member[] }>();
  for (const membershipRow of membership ?? []) {
    const profile = profileMap.get(membershipRow.user_id);
    const name = profile?.display_name || "HabHub member";
    const member: Member = {
      id: membershipRow.user_id,
      name,
      initials: initials(name),
      color: memberColor(membershipRow.user_id),
      role: membershipRow.role,
      lastSeenAt: membershipRow.last_seen_at ?? undefined,
      lastDataSyncedAt:
        membershipRow.last_data_synced_at ?? undefined,
      profileRevision: Number.isFinite(Number(profile?.account_revision))
        ? Number(profile?.account_revision)
        : undefined,
      avatarStoragePath: profile?.avatar_path ?? undefined,
      avatarUri: profile?.avatar_path
        ? (urls.get(profile.avatar_path) ?? undefined)
        : undefined,
    };
    const current = result.get(membershipRow.group_id) ?? {
      active: [],
      pending: [],
    };
    const key = membershipRow.status === "pending" ? "pending" : "active";
    current[key].push(member);
    result.set(membershipRow.group_id, current);
  }
  return result;
}

export async function loadCloudGroupShells(): Promise<Group[]> {
  const client = requireCloud();
  const currentMemberships = await client
    .from("group_members")
    .select("group_id, role, status");
  let memberships = currentMemberships.data;
  if (currentMemberships.error) {
    if (!/status|column|schema cache/i.test(currentMemberships.error.message))
      throw currentMemberships.error;
    const legacy = await client.from("group_members").select("group_id, role");
    if (legacy.error) throw legacy.error;
    memberships = (legacy.data ?? []).map((row) => ({ ...row, status: "active" }));
  }
  // Pending requests are not workspaces yet. Including them here caused a
  // failed protected-table load to replace the user's valid active group.
  const groupIds = (memberships ?? [])
    .filter((row) => row.status !== "pending")
    .map((row) => row.group_id);
  if (!groupIds.length) return [];
  const [
    { data: rows, error: groupError },
    { data: metrics, error: metricError },
    members,
  ] = await Promise.all([
    client
      .from("groups")
      .select(
        "id, name, invite_code, template_name, settings, configuration_revision",
      )
      .in("id", groupIds),
    client
      .from("metric_definitions")
      .select("*")
      .in("group_id", groupIds)
      .is("archived_at", null),
    groupMembers(groupIds),
  ]);
  if (groupError) throw groupError;
  if (metricError) throw metricError;
  return (rows ?? []).map(
    (row): Group => ({
      id: row.id,
      configurationRevision: Number(row.configuration_revision ?? 0),
      name: row.name,
      inviteCode: row.invite_code,
      templateName: row.template_name,
      members: members.get(row.id)?.active ?? [],
      pendingMembers: members.get(row.id)?.pending ?? [],
      requireMemberApproval: Boolean(
        (row.settings as Record<string, any>)?.requireMemberApproval,
      ),
      streakRestDaysPerWeek: Math.max(
        0,
        Math.min(
          4,
          Number(
            (row.settings as Record<string, any>)?.streakRestDaysPerWeek ?? 1,
          ),
        ),
      ),
      themeColor: String(
        (row.settings as Record<string, any>)?.themeColor ?? "#0FBFB8",
      ),
      gymPlans: Array.isArray(
        (row.settings as Record<string, any>)?.gymPlans,
      )
        ? (row.settings as Record<string, any>).gymPlans
        : [],
      metricConfiguration: (metrics ?? [])
        .filter((metric) => metric.group_id === row.id)
        .map(metricFromRow)
        .sort((a, b) => a.order - b.order),
    }),
  );
}

export async function createCloudGroup(
  name: string,
  metrics: MetricDefinition[],
  user: User,
  displayName?: string,
  themeColor = "#0FBFB8",
  requireMemberApproval = false,
) {
  const client = requireCloud();
  void displayName;
  void user;
  const { data: atomicGroupId, error: atomicError } = await client.rpc(
    "create_group_with_metrics_v2",
    {
      p_group_name: name.trim(),
      p_metric_rows: metrics.map((metric) => metricRow("", metric)),
      p_group_theme_color: themeColor,
      p_require_member_approval: requireMemberApproval,
    },
  );
  if (atomicError) {
    const message = cloudErrorText(atomicError);
    if (/schema cache|function.*does not exist|create_group_with_metrics_v2/i.test(
      message,
    ))
      throw new Error(
        "Group creation needs the latest Supabase migration. Apply it and try again.",
      );
    throw new Error(message);
  }
  if (!atomicGroupId)
    throw new Error("The group could not be created. Try again.");
  return atomicGroupId as string;
}

export async function joinCloudGroup(code: string) {
  const client = requireCloud();
  const { data, error } = await client.rpc("request_group_membership", {
    code: code.trim().toUpperCase(),
  });
  if (error) {
    if (/request_group_membership|schema cache|does not exist/i.test(error.message))
      throw new Error(
        "Group approval is not installed on the cloud project yet. Apply the latest Supabase migration and try again.",
      );
    throw error;
  }
  const result = data as {
    groupId: string;
    groupName?: string;
    status: "active" | "pending";
  };
  return result;
}

export async function sendMembershipPush(input: {
  groupId: string;
  eventKey: string;
  title: string;
  body: string;
  audience: "admins" | "user" | "group";
  recipientId?: string;
  route?: string;
}) {
  // Membership changes must remain successful even if the optional push
  // function is temporarily unavailable or not deployed yet.
  const result = await requireCloud().functions.invoke("send-push", {
    body: withLocalizedPushCopy({
      eventKey: input.eventKey,
      groupId: input.groupId,
      category: "membership",
      audience: input.audience,
      recipientId: input.recipientId,
      title: input.title,
      body: input.body,
      data: {
        route: input.route ?? "/groups",
        groupId: input.groupId,
      },
    }),
  });
  if (result.error) throw result.error;
}

export async function approveCloudGroupMember(groupId: string, userId: string) {
  const { error } = await requireCloud().rpc(
    "approve_group_member_transactionally",
    {
      p_group_id: groupId,
      p_user_id: userId,
    },
  );
  if (error) throw error;
}

export async function touchCloudGroupPresence(groupId: string) {
  const client = requireCloud();
  const { data, error } = await client.rpc("touch_group_member_presence", {
    p_group_id: groupId,
  });
  if (error) {
    if (
      /touch_group_member_presence|schema cache|does not exist|last_seen_at/i.test(
        error.message,
      )
    )
      return new Date().toISOString();
    throw error;
  }
  return typeof data === "string" ? data : new Date().toISOString();
}

export async function removeCloudGroupMember(groupId: string, userId: string) {
  const { error } = await requireCloud().rpc(
    "remove_group_member_transactionally",
    {
      p_group_id: groupId,
      p_user_id: userId,
    },
  );
  if (error) throw error;
}

export async function leaveCloudGroup(groupId: string) {
  const client = requireCloud();
  const { error } = await client.rpc("leave_group_transactionally", {
    p_group_id: groupId,
  });
  if (error) throw error;
}

export async function loadCloudWorkspace(
  state: AppState,
  groupId: string,
  onActivityLoaded?: (metadata: CloudActivityMetadata) => void,
  activitySinceDate = dateWithOffsetFrom(
    dateKey(),
    -(SHARED_ACTIVITY_CACHE_DAYS - 1),
  ),
  preloadedShells?: Group[],
): Promise<AppState> {
  const client = requireCloud();
  // Startup already loads the group shells to select the active workspace.
  // Reuse that consistent snapshot instead of immediately issuing the same
  // membership/profile/metric request set a second time.
  const shells = preloadedShells ?? (await loadCloudGroupShells());
  const group = shells.find((candidate) => candidate.id === groupId);
  if (!group)
    throw new Error("This group is unavailable or you no longer have access.");
  const groupMetrics = (group.metricConfiguration ?? []).sort(
    (a, b) => a.order - b.order,
  );
  const missingTracked = groupMetrics.filter(
    (metric) =>
      (metric.sections.group ||
        (isBloodPressureDiastolic(metric) &&
          groupMetrics.some(
            (candidate) =>
              candidate.sections.group &&
              isBloodPressureSystolic(candidate),
          ))) &&
      !state.metrics.some((personal) => personal.id === metric.id),
  );
  const personalMetrics = [
    ...state.metrics.map((personal) => {
      const shared = groupMetrics.find(
        (metric) =>
          metric.id === personal.id && metric.sections.group,
      );
      return shared
        ? {
            ...shared,
            goal: personal.goal,
            goalRange: personal.goalRange,
            goalEnabled: personal.goalEnabled,
            // Schedules and reminder times belong to the person, not to the
            // group's shared tracker definition. Keep them when the group
            // workspace is reconstructed after a cold launch.
            goalSchedule: personal.goalSchedule,
            reminder: personal.reminder,
            reminders: personal.reminders,
            defaultVisibility: personal.defaultVisibility,
            healthMapping: personal.healthMapping ?? shared.healthMapping,
            gymMapping: personal.gymMapping ?? shared.gymMapping,
            gymMuscleGroups:
              personal.gymMuscleGroups ?? shared.gymMuscleGroups,
            stepFallback: personal.stepFallback ?? shared.stepFallback,
            manualEntry: personal.manualEntry ?? shared.manualEntry,
            sections: {
              ...shared.sections,
              today: personal.sections.today,
              insights: personal.sections.insights,
            },
            order: personal.order,
            activeFrom: personal.activeFrom,
          }
        : personal;
    }),
    ...missingTracked.map((metric, index) => ({
      ...metric,
      defaultVisibility: "group" as const,
      order: state.metrics.length + index,
      sections: {
        ...metric.sections,
        today: !isBloodPressureDiastolic(metric),
        insights: !isBloodPressureDiastolic(metric),
      },
    })),
  ];
  // Render the cached/recent window first. Older compact summaries are loaded
  // during idle time by the provider instead of blocking group navigation.
  const [activity, messageRows, photoRows] =
    await Promise.all([
      loadCloudGroupActivity(
        {
          ...state,
          // Group activity scoping must use the shell we just loaded, not the
          // previously-selected group's member list during a group switch.
          group,
        },
        groupId,
        activitySinceDate,
      ),
      (async () => {
        const { data, error } = await client
          .from("messages")
          .select("*")
          .eq("group_id", groupId)
          .order("created_at", { ascending: false })
          .limit(SHARED_MESSAGE_CACHE_LIMIT);
          if (error) throw error;
          return data ?? [];
      })(),
      (async () => {
        const { data, error } = await client
          .from("photo_updates")
          .select("*")
          .eq("group_id", groupId)
          .order("created_at", { ascending: false })
          .limit(SHARED_PHOTO_CACHE_LIMIT);
          if (error) throw error;
          return data ?? [];
      })(),
    ]);
  onActivityLoaded?.({
    version: activity.version,
    updatedAt: activity.updatedAt,
    sinceDate: activity.authoritativeStatusSinceDate,
  });
  const mediaIds = photoRows.map(
    (photo) => photo.media_asset_id,
  );
  const { data: media, error: mediaError } = mediaIds.length
    ? await client
        .from("media_assets")
        .select("id, storage_path, captured_at")
        .in("id", mediaIds)
    : { data: [], error: null };
  if (mediaError) throw mediaError;
  const mediaById = new Map((media ?? []).map((item) => [item.id, item]));
  const paths = [
    ...messageRows
      .map((message) => message.image_path)
      .filter(Boolean),
    ...(media ?? []).map((item) => item.storage_path).filter(Boolean),
  ];
  const urls = await signedUrls(paths);
  // The activity RPC owns the bounded group window. Preserve unrelated and
  // older local data, then overlay its collision-safe snapshot. This keeps
  // pending owner rows and local image URIs while allowing an authoritative
  // snapshot to remove stale friend rows from the active window.
  const cloudMetricSlugs = new Set(groupMetrics.map((metric) => metric.id));
  const groupMemberIds = new Set(group.members.map((member) => member.id));
  const entriesById = new Map(
    state.entries
      .filter(
        (entry) =>
          entry.localDate <
            (activity.authoritativeEntrySinceDate ?? activitySinceDate) ||
          !cloudMetricSlugs.has(entry.metricId) ||
          !groupMemberIds.has(entry.userId),
      )
      .map((entry) => [metricEntryKey(entry.userId, entry.id), entry]),
  );
  activity.entries.forEach((entry) => {
    entriesById.set(metricEntryKey(entry.userId, entry.id), entry);
  });
  const entries = [...entriesById.values()].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
  const statusMap = new Map(
    state.dailyMetricStatuses
      .filter(
        (status) =>
          status.groupId !== groupId ||
          status.localDate <
            (activity.authoritativeStatusSinceDate ?? activitySinceDate),
      )
      .map((status) => [
        `${status.groupId}:${status.metricId}:${status.userId}:${status.localDate}`,
        status,
      ]),
  );
  activity.dailyMetricStatuses.forEach((status) => {
    const key = `${status.groupId}:${status.metricId}:${status.userId}:${status.localDate}`;
    statusMap.set(key, status);
  });
  const dailyMetricStatuses = [...statusMap.values()];
  const remoteMessages: ChatMessage[] = messageRows.map(
    (message) => ({
      id: message.client_generated_id ?? message.id,
      groupId,
      senderId: message.sender_id ?? "system",
      text: message.content,
      createdAt: message.created_at,
      kind: message.kind,
      conversationId: normalizedGroupConversationId(
        message.conversation_id,
        groupId,
      ),
      recipientId: message.recipient_id ?? undefined,
      imageStoragePath: message.image_path ?? undefined,
      imageUri: message.image_path
        ? (urls.get(message.image_path) ?? undefined)
        : undefined,
    }),
  );
  // Keep locally-created messages until their cloud upsert is visible. A realtime
  // refresh must never make a just-sent message (or offline history) disappear.
  const localGroupMessages = state.messages
    .filter((message) => messageBelongsToGroup(state, message, groupId))
    .map((message) => messageForGroup(message, groupId));
  const otherGroupMessages = state.messages.filter(
    (message) => !messageBelongsToGroup(state, message, groupId),
  );
  const messagesById = new Map(
    localGroupMessages.map((message) => [message.id, message]),
  );
  remoteMessages.forEach((message) => messagesById.set(message.id, message));
  const messages = [...otherGroupMessages, ...messagesById.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const remotePhotos: PhotoUpdate[] = photoRows.map((photo) => {
    const asset = mediaById.get(photo.media_asset_id);
    const path = asset?.storage_path;
    return {
      id: photo.client_generated_id ?? photo.id,
      userId: photo.owner_user_id,
      uri: path ? (urls.get(path) ?? "") : "",
      storagePath: path,
      caption: photo.caption,
      localDate: photo.local_date,
      createdAt: photo.created_at,
      capturedAt: asset?.captured_at ?? undefined,
      visibility: photo.visibility,
    };
  });
  const photosById = new Map(state.photos.map((photo) => [photo.id, photo]));
  remotePhotos.forEach((photo) => photosById.set(photo.id, photo));
  const photos = [...photosById.values()];
  return {
    ...state,
    group,
    groups: shells,
    metrics: personalMetrics,
    trackedGoalPeriods: Object.fromEntries(
      personalMetrics.map((metric) => [
        metric.id,
        state.trackedGoalPeriods[metric.id] ?? [],
      ]),
    ),
    entries,
    photos,
    messages,
    dailyMetricStatuses,
    selectedGroupMetricId: groupMetrics.some(
      (metric) => metric.id === state.selectedGroupMetricId,
    )
      ? state.selectedGroupMetricId
      : (groupMetrics[0]?.id ?? "steps"),
  };
}

function freshChatPushCandidate(message: ChatMessage, now = Date.now()) {
  const createdAt = new Date(message.createdAt).getTime();
  return Number.isFinite(createdAt) && now - createdAt <= CHAT_PUSH_FRESHNESS_MS;
}

/**
 * Fast chat-only outbox used independently from the heavier account/workspace
 * backup. A message id targets the newly-created row without scanning or
 * waiting for any health/group sync work.
 */
export async function pushCloudMessagesNow(
  state: AppState,
  messageId?: string,
) {
  if (!isCloudGroupId(state.group.id)) return;
  const client = requireCloud();
  const sender = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  if (!sender) return;
  const membership = await client
    .from("group_members")
    .select("status")
    .eq("group_id", state.group.id)
    .eq("user_id", state.currentUserId)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (membership.data?.status !== "active") return;
  const activeMemberIds = new Set(
    state.group.members.map((member) => member.id),
  );
  const now = Date.now();
  const owned = state.messages
    .filter(
      (message) =>
        message.senderId === state.currentUserId &&
        cloudOwnedMessage(message, state.group.id) &&
        (!messageId || message.id === messageId) &&
        (!message.recipientId || activeMemberIds.has(message.recipientId)),
    )
    .map((message) => messageForGroup(message, state.group.id))
    .slice(-SHARED_MESSAGE_CACHE_LIMIT);
  if (!owned.length) return;
  // For a just-created message, one idempotent upsert followed by one
  // idempotent Edge Function invocation is both faster and more reliable than
  // first waiting on a status query. The generic recovery path below still
  // queries pending delivery state when no id was supplied.
  if (messageId) {
    const message = owned[owned.length - 1];
    const upsert = await client.from("messages").upsert(
      {
        group_id: state.group.id,
        sender_id: state.currentUserId,
        client_generated_id: message.id,
        kind: message.kind,
        content: message.text,
        conversation_id:
          message.conversationId ?? `group:${state.group.id}`,
        recipient_id: message.recipientId ?? null,
        image_path: message.imageStoragePath ?? null,
        metadata: {},
        created_at: message.createdAt,
      },
      { onConflict: "sender_id,client_generated_id" },
    );
    if (upsert.error) throw upsert.error;
    // The relational chat row must always be recovered, even if the message
    // spent hours offline. Push is only an arrival alert, so stale recovery
    // rows are deliberately stored without waking the recipient.
    if (!freshChatPushCandidate(message, now)) return;
    const result = await client.functions.invoke("send-push", {
      body: chatPushPayload(state, sender, message),
    });
    if (result.error) throw result.error;
    return;
  }
  const currentRows: {
    client_generated_id: string;
    push_dispatched_at: string | null;
  }[] = [];
  for (const ids of batches(
    owned.map((message) => message.id),
    80,
  )) {
    const current = await client
      .from("messages")
      .select("client_generated_id, push_dispatched_at")
      .eq("group_id", state.group.id)
      .eq("sender_id", state.currentUserId)
      .in("client_generated_id", ids);
    if (current.error) throw current.error;
    currentRows.push(...(current.data ?? []));
  }
  const rows = new Map(
    currentRows.map((row) => [row.client_generated_id, row]),
  );
  const missing = owned.filter((message) => !rows.has(message.id));
  for (const batch of batches(missing, 80)) {
    const upsert = await client.from("messages").upsert(
      batch.map((message) => ({
        group_id: state.group.id,
        sender_id: state.currentUserId,
        client_generated_id: message.id,
        kind: message.kind,
        content: message.text,
        conversation_id: message.conversationId ?? `group:${state.group.id}`,
        recipient_id: message.recipientId ?? null,
        image_path: message.imageStoragePath ?? null,
        metadata: {},
        created_at: message.createdAt,
      })),
      { onConflict: "sender_id,client_generated_id" },
    );
    if (upsert.error) throw upsert.error;
  }
  const pending = owned
    .filter(
      (message) =>
        freshChatPushCandidate(message, now) &&
        (!rows.has(message.id) || !rows.get(message.id)?.push_dispatched_at),
    )
    .slice(-30);
  if (!pending.length) return;
  const dispatches = await Promise.allSettled(
    pending.map(async (message) => {
      const result = await client.functions.invoke("send-push", {
        body: chatPushPayload(state, sender, message),
      });
      if (result.error) throw result.error;
    }),
  );
  const failed = dispatches.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}

function chatPushPayload(
  state: AppState,
  sender: Member,
  message: ChatMessage,
) {
  const hasUserText = Boolean(message.text);
  const body = message.recipientId
    ? message.text || "Sent an image"
    : `${state.group.name}: ${message.text || "Sent an image"}`;
  const payload = withLocalizedPushCopy({
    eventKey: `message:${state.group.id}:${message.id}`,
    clientMessageId: message.id,
    groupId: state.group.id,
    category: "chat" as const,
    recipientId: message.recipientId,
    title: message.recipientId
      ? `Direct message from ${sender.name}`
      : `Group message from ${sender.name}`,
    body,
    data: {
      route: "/chat",
      category: "chat",
      groupId: state.group.id,
      messageId: message.id,
      senderId: state.currentUserId,
      senderName: sender.name,
      conversationId:
        message.conversationId ?? `group:${state.group.id}`,
    },
  });
  if (hasUserText) {
    // Chat text is user-authored content. Never run it through the app-owned
    // phrase catalog, even when it happens to match a built-in label.
    return { ...payload, bodies: literalPushCopy(body) };
  }
  const imageCopy = localizedUiText("Sent an image");
  return {
    ...payload,
    bodies: Object.fromEntries(
      Object.entries(imageCopy).map(([language, value]) => [
        language,
        message.recipientId ? value : `${state.group.name}: ${value}`,
      ]),
    ),
  };
}

/**
 * Publish only compact recent leaderboard summaries. Native background health
 * imports use this path so group freshness can improve while the app is closed
 * without uploading photos, chat, detailed logs, or historical backfills.
 */
export async function pushCloudRecentActivity(
  state: AppState,
  days = 2,
  accountRevision?: number,
): Promise<{ published: boolean; version?: number; updatedAt?: string }> {
  if (!isCloudGroupId(state.group.id) || days < 1)
    return { published: false };
  const client = requireCloud();
  const [membership, metricRows, publishRevision] = await Promise.all([
    client
      .from("group_members")
      .select("status")
      .eq("group_id", state.group.id)
      .eq("user_id", state.currentUserId)
      .maybeSingle(),
    client
      .from("metric_definitions")
      .select("id, slug")
      .eq("group_id", state.group.id)
      .is("archived_at", null),
    resolveAccountRevision(client, state.currentUserId, accountRevision),
  ]);
  if (membership.error) throw membership.error;
  if (metricRows.error) throw metricRows.error;
  if (membership.data?.status !== "active") return { published: false };
  const idBySlug = new Map(
    (metricRows.data ?? []).map((row) => [row.slug, row.id]),
  );
  const ownedEntries = state.entries.filter(
    (entry) =>
      entry.userId === state.currentUserId && idBySlug.has(entry.metricId),
  );
  const dates = dateRangeEnding(dateKey(), Math.min(30, Math.ceil(days)));
  const rows = buildCloudDailyStatusRows(
    state,
    idBySlug,
    ownedEntries,
    dates,
    publishRevision,
  );
  await upsertCloudDailyStatusRows(client, rows);
  const checkpoint = await commitCloudActivityCheckpoint(
    client,
    state.group.id,
    dates,
    dates[0] ?? dateKey(),
    publishRevision,
  );
  return {
    published: true,
    version: checkpoint.version,
    updatedAt: checkpoint.updatedAt,
  };
}

function currentAccountMember(state: AppState) {
  return (
    state.group.members.find(
      (member) => member.id === state.currentUserId,
    ) ??
    state.groups
      .flatMap((group) => group.members)
      .find((member) => member.id === state.currentUserId)
  );
}

function accountMetadataRpcParams(
  state: AppState,
  publishRevision: number,
) {
  const current = currentAccountMember(state);
  if (!current)
    throw new Error("The signed-in profile is not available locally yet.");
  const profile = normalizeEnergyProfile(
    state.energyProfiles[state.currentUserId] ?? state.settings.energyProfile,
  );
  return {
    p_expected_revision: publishRevision,
    p_display_name: current.name,
    p_avatar_path: current.avatarStoragePath ?? null,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    p_energy_profile: {
      age: profile.age,
      biological_sex: profile.sex,
      height_cm: profile.heightCm,
      weight_kg: profile.weightKg,
      target_weight_kg: profile.targetWeightKg,
      activity_level: profile.activityLevel,
      desired_weekly_loss_kg: profile.desiredWeeklyLossKg,
    },
  };
}

/**
 * Publish the small account-owned profile projection without loading or
 * rewriting the active group's activity history. This is also used while the
 * personal setup workspace is active, where no relational group push exists.
 */
export async function pushCloudAccountMetadata(
  state: AppState,
  accountRevision?: number,
) {
  const client = requireCloud();
  const publishRevision = await resolveAccountRevision(
    client,
    state.currentUserId,
    accountRevision,
  );
  const projection = await client.rpc("publish_account_workspace_metadata", {
    ...accountMetadataRpcParams(state, publishRevision),
    p_group_id: null,
    p_expected_group_configuration_revision: null,
    p_group_name: null,
    p_group_template_name: null,
    p_group_settings: null,
    p_group_metrics: null,
    p_member_roles: [],
  });
  if (projection.error) throw projection.error;
}

export async function pushCloudWorkspace(
  state: AppState,
  pushGroupConfiguration = true,
  onRecentActivityCommitted?: (checkpoint: {
    syncedAt: string;
    localDates: string[];
  }) => void,
  accountRevision?: number,
) {
  if (!isCloudGroupId(state.group.id))
    return {
      deletedEntryIds: [],
      deletedPhotoIds: [],
      activityVersion: undefined,
      workspacePushed: false,
      groupConfigurationPushed: false,
    };
  const client = requireCloud();
  const current = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  if (!current)
    return {
      deletedEntryIds: [],
      deletedPhotoIds: [],
      activityVersion: undefined,
      workspacePushed: false,
      groupConfigurationPushed: false,
    };
  const publishRevision = await resolveAccountRevision(
    client,
    state.currentUserId,
    accountRevision,
  );
  const membership = await client
    .from("group_members")
    .select("status")
    .eq("group_id", state.group.id)
    .eq("user_id", state.currentUserId)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (membership.data?.status !== "active")
    return {
      deletedEntryIds: [],
      deletedPhotoIds: [],
      activityVersion: undefined,
      workspacePushed: false,
      groupConfigurationPushed: false,
    };
  const canManage = current.role === "owner" || current.role === "admin";
  const groupConfigurationPushed = canManage && pushGroupConfiguration;
  const metadataProjection = await client.rpc(
    "publish_account_workspace_metadata",
    {
      ...accountMetadataRpcParams(state, publishRevision),
      p_group_id: groupConfigurationPushed ? state.group.id : null,
      p_expected_group_configuration_revision: groupConfigurationPushed
        ? (state.group.configurationRevision ?? 0)
        : null,
      p_group_name: groupConfigurationPushed ? state.group.name : null,
      p_group_template_name: groupConfigurationPushed
        ? state.group.templateName
        : null,
      p_group_settings: groupConfigurationPushed
        ? {
            streakRestDaysPerWeek: state.group.streakRestDaysPerWeek,
            themeColor: state.group.themeColor ?? "#0FBFB8",
            requireMemberApproval:
              state.group.requireMemberApproval ?? false,
            gymPlans: state.group.gymPlans ?? [],
          }
        : null,
      p_group_metrics: groupConfigurationPushed
        ? (state.group.metricConfiguration ?? []).map((metric) =>
            metricRow(state.group.id, metric),
          )
        : null,
      p_member_roles:
        groupConfigurationPushed && current.role === "owner"
          ? state.group.members
              .filter((member) => member.role !== "owner")
              .map((member) => ({
                user_id: member.id,
                role: member.role,
              }))
          : [],
    },
  );
  if (metadataProjection.error) throw metadataProjection.error;
  const projectionResult = metadataProjection.data as {
    groupMetricSetChanged?: boolean;
    groupConfigurationRevision?: number;
  } | null;
  const groupMetricSetChanged =
    projectionResult?.groupMetricSetChanged === true;
  const { data: metricRows, error: metricError } = await client
    .from("metric_definitions")
    .select("id, slug")
    .eq("group_id", state.group.id)
    .is("archived_at", null);
  if (metricError) throw metricError;
  const idBySlug = new Map((metricRows ?? []).map((row) => [row.slug, row.id]));
  const explicitDeletedEntryIds = [
    ...new Set(state.settings.pendingDeletedEntryIds ?? []),
  ];
  const explicitlyDeletedLocalDates: string[] = [];
  for (const batch of batches(explicitDeletedEntryIds)) {
    const deleted = await client.rpc("delete_group_metric_entries", {
      p_client_generated_ids: batch,
      p_expected_revision: publishRevision,
    });
    if (deleted.error) {
      throw deleted.error;
    } else {
      (
        (deleted.data ?? []) as {
          deleted_client_generated_id?: string;
          deleted_local_date?: string;
        }[]
      ).forEach((row) => {
        if (
          typeof row.deleted_local_date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.deleted_local_date)
        )
          explicitlyDeletedLocalDates.push(row.deleted_local_date);
      });
    }
  }
  const ownedEntries = state.entries.filter(
    (entry) =>
      entry.userId === state.currentUserId && idBySlug.has(entry.metricId),
  );
  const recentCommitSinceDate = dateWithOffsetFrom(dateKey(), -29);
  const fastRecentDates = dateRangeEnding(dateKey(), 30);
  const fastRecentStatuses = buildCloudDailyStatusRows(
    state,
    idBySlug,
    ownedEntries,
    fastRecentDates,
    publishRevision,
  );
  // Publish the current leaderboard window before comparing/uploading detailed
  // food, workout, message, photo, and historical rows. This keeps a manual or
  // Health Connect refresh responsive even for accounts with a large history.
  await upsertCloudDailyStatusRows(client, fastRecentStatuses);
  const fastRecentCheckpoint = await commitCloudActivityCheckpoint(
    client,
    state.group.id,
    fastRecentDates,
    recentCommitSinceDate,
    publishRevision,
  );
  if (fastRecentCheckpoint.updatedAt)
    onRecentActivityCommitted?.({
      syncedAt: fastRecentCheckpoint.updatedAt,
      localDates: fastRecentDates,
    });
  const detailedOwnedEntries = ownedEntries.filter((entry) => {
    const metric =
      state.metrics.find((candidate) => candidate.id === entry.metricId) ??
      state.group.metricConfiguration?.find(
        (candidate) => candidate.id === entry.metricId,
      );
    if (entry.source !== "imported") return true;
    // Imported high-frequency sensor records are represented by one compact
    // exact daily status. Retain only imported rows whose item-level detail is
    // useful in a shared log (meals, named workouts, notes or images).
    return Boolean(
      entry.imageStoragePath ||
        entry.note ||
        entry.nutrition ||
      (entry.label &&
          ["food", "workout", "gym"].includes(metric?.category ?? "")),
    );
  });
  const rawOwnedEntries = detailedOwnedEntries.filter(
    (entry) => entry.visibility === "group",
  );
  const oldEntries: {
    client_generated_id: string;
    metric_id: string;
    source_updated_at?: string | null;
    image_path?: string | null;
    visibility: MetricEntry["visibility"];
    source?: MetricEntry["source"] | null;
    label?: string | null;
    note?: string | null;
    nutrition?: MetricEntry["nutrition"] | null;
  }[] = [];
  // Diff only stable ids that can actually be uploaded. The previous routine
  // scanned every historical metric row on every color/name/log change, which
  // left Cloud pending for minutes on accounts with long Health Connect
  // histories. Compact sensor data is represented by daily status rows and
  // therefore never belongs in this raw-entry lookup.
  const candidateIds = detailedOwnedEntries.map((entry) => entry.id);
  for (const ids of batches(candidateIds, 250)) {
    if (!ids.length) continue;
    const result = await client
      .from("metric_entries")
      .select(
        "client_generated_id, metric_id, source_updated_at, image_path, visibility, source, label, note, nutrition",
      )
      .eq("user_id", state.currentUserId)
      .in("client_generated_id", ids);
    if (result.error) throw result.error;
    oldEntries.push(...(result.data ?? []));
  }
  const oldEntriesById = new Map(
    oldEntries
      .map((entry) => [entry.client_generated_id, entry]),
  );
  const rawCandidateById = new Map(
    rawOwnedEntries.map((entry) => [entry.id, entry]),
  );
  ownedEntries.forEach((entry) => {
    const remote = oldEntriesById.get(entry.id);
    if (remote && remote.visibility !== entry.visibility)
      rawCandidateById.set(entry.id, entry);
  });
  const entriesToUpsert = [...rawCandidateById.values()].filter((entry) => {
    const remote = oldEntriesById.get(entry.id);
    return (
      !remote ||
      remote.visibility !== entry.visibility ||
      Boolean(
        entry.sourceUpdatedAt &&
          (!remote.source_updated_at ||
            entry.sourceUpdatedAt > remote.source_updated_at),
      ) ||
      Boolean(
        entry.visibility === "group" &&
          entry.imageStoragePath &&
          !remote.image_path,
      )
    );
  });
  const updatedEntryIds = entriesToUpsert
    .filter((entry) => oldEntriesById.has(entry.id))
    .map((entry) => entry.id);
  // Keep history diffs bounded and sequential. A large import can span dozens
  // of batches; firing all of them together competes with the account snapshot
  // and group hydration for PostgREST connections and can surface PGRST003 on
  // smaller projects. This is background reconciliation, so bounded pressure
  // is more important than a short burst of peak throughput.
  const loadPriorRowsBatch = (entryIds: string[]) =>
    client
      .from("metric_entries")
      .select(
        "client_generated_id, value, local_date, recorded_at, visibility, source, label, note, nutrition, submetric_values, source_provider, source_record_id, source_origin, source_updated_at, image_path",
      )
      .eq("user_id", state.currentUserId)
      .in("client_generated_id", entryIds);
  const priorRowResults: Awaited<
    ReturnType<typeof loadPriorRowsBatch>
  >[] = [];
  for (const entryIds of batches(updatedEntryIds, 250)) {
    const result = await loadPriorRowsBatch(entryIds);
    priorRowResults.push(result);
  }
  const priorRowError = priorRowResults.find((result) => result.error)?.error;
  if (priorRowError) throw priorRowError;
  const priorRowsById = new Map(
    priorRowResults.flatMap((result) => result.data ?? []).map((entry) => [
      entry.client_generated_id,
      entry,
    ]),
  );
  const newSharedEntries = entriesToUpsert.filter(
    (entry) =>
      !oldEntriesById.has(entry.id) &&
      entry.visibility !== "private" &&
      Date.now() - new Date(entry.recordedAt).getTime() <=
        METRIC_PUSH_FRESHNESS_MS,
  );
  const changedSharedEntries = entriesToUpsert.filter((entry) => {
    const previous = oldEntriesById.get(entry.id);
    return (
      entry.visibility !== "private" || previous?.visibility !== "private"
    );
  });
  // Never infer deletion from absence in the device cache. Only the explicit
  // tombstones processed above may remove a server row.
  const leadEntriesByMetric = new Map<string, MetricEntry[]>();
  const today = dateKey();
  const sharedCompetitionState = (source: AppState): AppState => ({
    ...source,
    // Ranking alerts must be evaluated exactly as another group member sees
    // them. Keeping the owner's private rows here could announce a private
    // value merely because the syncing device can see its own data.
    entries: source.entries.filter(
      (entry) =>
        entry.userId !== source.currentUserId ||
        entry.visibility !== "private",
    ),
    dailyMetricStatuses: source.dailyMetricStatuses.filter(
      (status) =>
        status.userId !== source.currentUserId ||
        status.visibility !== "private",
    ),
  });
  changedSharedEntries.forEach((entry) => {
    const entries = leadEntriesByMetric.get(entry.metricId);
    if (entries) entries.push(entry);
    else leadEntriesByMetric.set(entry.metricId, [entry]);
  });
  const dispatchCommittedEntryNotifications = () =>
    Promise.allSettled(
      newSharedEntries.map((entry) => {
        const metric =
          (state.group.metricConfiguration ?? []).find(
            (item) => item.id === entry.metricId,
          ) ?? state.metrics.find((item) => item.id === entry.metricId);
        return client.functions.invoke("send-push", {
          body: withLocalizedPushCopy({
            eventKey: `entry:${state.group.id}:${state.currentUserId}:${entry.id}`,
            groupId: state.group.id,
            category: "metric",
            metricId: entry.metricId,
            title: `${current.name} logged ${metric?.name ?? "a metric"}`,
            body:
              entry.visibility === "group" &&
              metric &&
              typeof entry.value !== "string"
                ? formatMetricValue(metric, Number(entry.value))
                : `A shared ${metric?.name ?? "metric"} update was added.`,
            data: {
              route: `/day/${entry.localDate}`,
              metricId: entry.metricId,
            },
          }),
        });
      }),
    );
  const dispatchCommittedLeadNotifications = () =>
    Promise.allSettled(
      [...leadEntriesByMetric.entries()].flatMap(([metricId, changedEntries]) => {
      const metric = (state.group.metricConfiguration ?? []).find(
        (item) => item.id === metricId,
      );
      if (!metric || (!metric.sections.group && metric.scoreWeight <= 0))
        return [];
      const changedEntryIds = new Set(changedEntries.map((entry) => entry.id));
      const priorEntries = changedEntries.flatMap((entry): MetricEntry[] => {
        const previous = priorRowsById.get(entry.id);
        if (!previous) return [];
        return [
          {
            ...entry,
            value: previous.value as MetricEntry["value"],
            localDate: previous.local_date,
            recordedAt: previous.recorded_at,
            visibility: previous.visibility as MetricEntry["visibility"],
            source: previous.source as MetricEntry["source"],
            label: previous.label ?? undefined,
            note: previous.note ?? undefined,
            nutrition:
              (previous.nutrition as MetricEntry["nutrition"]) ?? undefined,
            submetricValues:
              (previous.submetric_values as MetricEntry["submetricValues"]) ??
              undefined,
            sourceProvider:
              (previous.source_provider as MetricEntry["sourceProvider"]) ??
              undefined,
            sourceRecordId: previous.source_record_id ?? undefined,
            sourceOrigin: previous.source_origin ?? undefined,
            sourceUpdatedAt: previous.source_updated_at ?? undefined,
            imageUri: undefined,
            imageStoragePath: previous.image_path ?? undefined,
          },
        ];
      });
      const previousState = {
        ...state,
        entries: [
          ...state.entries.filter(
            (item) =>
              item.userId !== state.currentUserId ||
              !changedEntryIds.has(item.id),
          ),
          ...priorEntries,
        ],
      };
      const currentCompetitionState = sharedCompetitionState(state);
      const previousCompetitionState = sharedCompetitionState(previousState);
      const candidateDates = new Set([
        ...changedEntries.map((entry) => entry.localDate),
        ...priorEntries.map((entry) => entry.localDate),
      ]);
      const ranges: { label: string; dates: string[] }[] = [
        { label: "today", dates: [today] },
        {
          label: "this week",
          dates: calendarWeekRange(
            today,
            state.settings.weekStartsOn ?? 1,
          ).filter((date) => date <= today),
        },
        {
          label: "this month",
          dates: monthDateRange(today).filter((date) => date <= today),
        },
      ].filter(({ dates }) =>
        dates.some((date) => candidateDates.has(date)),
      );
      const changed = ranges.flatMap(({ label, dates }) => {
        const currentRow = leaderboardRows(
          currentCompetitionState,
          [metric],
          dates,
          "__shared_group_view__",
          false,
        )[0];
        const previousRow = leaderboardRows(
          previousCompetitionState,
          [metric],
          dates,
          "__shared_group_view__",
          false,
        )[0];
        const currentResult = currentRow?.metrics[0]?.result;
        const previousResult = previousRow?.metrics[0]?.result;
        const currentLeader =
          currentResult &&
          currentResult.mode !== "private" &&
          currentResult.visibleDays > 0
            ? currentRow.member
            : undefined;
        const previousLeader =
          previousResult &&
          previousResult.mode !== "private" &&
          previousResult.visibleDays > 0
            ? previousRow.member
            : undefined;
        return currentLeader && previousLeader?.id !== currentLeader.id
          ? [{ label, previousLeader, currentLeader }]
          : [];
      });
      if (!changed.length) return [];
      const latestChange = changedEntries
        .map((entry) => entry.sourceUpdatedAt ?? entry.recordedAt)
        .sort()
        .at(-1);
      const firstChangedId = changedEntries
        .map((entry) => entry.id)
        .sort()[0];
      const byLeader = new Map<string, typeof changed>();
      changed.forEach((change) => {
        const changes = byLeader.get(change.currentLeader.id);
        if (changes) changes.push(change);
        else byLeader.set(change.currentLeader.id, [change]);
      });
      return [...byLeader.entries()].map(([leaderId, leaderChanges]) => {
        const leaderName = leaderChanges[0].currentLeader.name;
        const passed = [
          ...new Set(
            leaderChanges
              .map((change) => change.previousLeader?.name)
              .filter((name): name is string => Boolean(name)),
          ),
        ];
        return client.functions.invoke("send-push", {
          body: withLocalizedPushCopy({
            eventKey: `lead:${state.group.id}:${state.currentUserId}:${metric.id}:${leaderId}:${firstChangedId}:${latestChange ?? today}`,
            groupId: state.group.id,
            category: "lead",
            audience: "group_including_sender",
            metricId: metric.id,
            title: `${leaderName} took the lead`,
            body: passed.length
              ? `${leaderName} passed ${passed.join(", ")} in ${metric.name} for ${leaderChanges.map((change) => change.label).join(", ")}.`
              : `${leaderName} is the new ${metric.name} leader for ${leaderChanges.map((change) => change.label).join(", ")}.`,
            data: { route: "/group", metricId: metric.id },
          }),
        });
      });
      }),
    );
  if (entriesToUpsert.length) {
    const rows = entriesToUpsert.map((entry) => ({
        client_generated_id: entry.id,
        metric_id: idBySlug.get(entry.metricId),
        user_id: state.currentUserId,
        value: entry.value,
        local_date: entry.localDate,
        recorded_at: entry.recordedAt,
        visibility: entry.visibility,
        source: entry.source,
        label: entry.label ?? null,
        note: entry.note ?? null,
        nutrition: entry.nutrition ?? null,
        submetric_values: entry.submetricValues ?? null,
        image_path: entry.imageStoragePath ?? null,
        source_provider: entry.sourceProvider ?? null,
        source_record_id: entry.sourceRecordId ?? null,
        source_origin: entry.sourceOrigin ?? null,
        source_updated_at: entry.sourceUpdatedAt ?? null,
        account_revision: publishRevision,
      }));
    for (const batch of batches(rows)) {
      const { error } = await client.from("metric_entries").upsert(batch, {
        onConflict: "user_id,client_generated_id",
      });
      if (error) throw error;
    }
    // Re-importing a native record after an explicit deletion intentionally
    // resurrects that client id. Remove its old tombstone only after the new
    // row is durable, otherwise peers would keep filtering the replacement.
    for (const batch of batches(entriesToUpsert.map((entry) => entry.id))) {
      const cleared = await client.rpc(
        "clear_group_metric_entry_tombstones",
        {
          p_client_generated_ids: batch,
          p_expected_revision: publishRevision,
        },
      );
      if (cleared.error) throw cleared.error;
    }
  }

  const statusStart = new Date();
  statusStart.setHours(12, 0, 0, 0);
  statusStart.setDate(statusStart.getDate() - SHARED_ACTIVITY_CACHE_DAYS);
  const recentStatusSinceDate = dateKey(statusStart);
  const localSharedHistoryStart = [
    ...ownedEntries
      .filter((entry) => entry.visibility !== "private")
      .map((entry) => entry.localDate),
    ...state.dailyMetricStatuses
      .filter(
        (status) =>
          status.groupId === state.group.id &&
          status.userId === state.currentUserId &&
          status.visibility !== "private",
      )
      .map((status) => status.localDate),
  ].sort()[0];
  let remoteSharedHistoryStart: string | undefined;
  let latestRemoteStatusUpdatedAt: string | undefined;
  if (localSharedHistoryStart) {
    const [coverage, latest] = await Promise.all([
      client
        .from("daily_metric_status")
        .select("local_date")
        .eq("group_id", state.group.id)
        .eq("user_id", state.currentUserId)
        .order("local_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      client
        .from("daily_metric_status")
        .select("updated_at")
        .eq("group_id", state.group.id)
        .eq("user_id", state.currentUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (coverage.error) throw coverage.error;
    if (latest.error) throw latest.error;
    remoteSharedHistoryStart = coverage.data?.local_date;
    latestRemoteStatusUpdatedAt = latest.data?.updated_at;
  }
  const needsHistoricalSummaryRepair = Boolean(
    localSharedHistoryStart &&
      (groupMetricSetChanged ||
        !remoteSharedHistoryStart ||
        localSharedHistoryStart < remoteSharedHistoryStart),
  );
  const statusSinceDate = needsHistoricalSummaryRepair
    ? SHARED_SUMMARY_HISTORY_START
    : recentStatusSinceDate;
  const rebuildStatusHistory =
    needsHistoricalSummaryRepair ||
    explicitDeletedEntryIds.length > 0;
  const changedActivityDates = [
    ...ownedEntries
      .filter(
        (entry) =>
          !latestRemoteStatusUpdatedAt ||
          (entry.sourceUpdatedAt ?? entry.recordedAt) >
            latestRemoteStatusUpdatedAt,
      )
      .map((entry) => entry.localDate),
    ...(state.gymSessions ?? [])
      .filter(
        (session) =>
          session.userId === state.currentUserId &&
          (!latestRemoteStatusUpdatedAt ||
            session.recordedAt > latestRemoteStatusUpdatedAt),
      )
      .map((session) => session.localDate),
  ];
  // Source timestamps describe when Health Connect recorded a measurement,
  // not when this device imported it. A newly backfilled/corrected row can be
  // older than the latest server status timestamp and must still refresh the
  // bounded recent leaderboard window.
  const boundedRecentActivityDates = [
    ...ownedEntries
      .filter((entry) => entry.localDate >= recentCommitSinceDate)
      .map((entry) => entry.localDate),
    ...(state.gymSessions ?? [])
      .filter(
        (session) =>
          session.userId === state.currentUserId &&
          session.localDate >= recentCommitSinceDate,
      )
      .map((session) => session.localDate),
    ...state.dailyMetricStatuses
      .filter(
        (status) =>
          status.groupId === state.group.id &&
          status.userId === state.currentUserId &&
          status.localDate >= recentCommitSinceDate,
      )
      .map((status) => status.localDate),
    ...vacationDates(state, state.currentUserId).filter(
      (localDate) => localDate >= recentCommitSinceDate,
    ),
  ];
  const statusDates = [
    ...new Set([
      ...(rebuildStatusHistory
        ? ownedEntries
            .filter((entry) => entry.localDate >= statusSinceDate)
            .map((entry) => entry.localDate)
        : []),
      ...entriesToUpsert.map((entry) => entry.localDate),
      ...changedActivityDates,
      ...boundedRecentActivityDates,
      ...explicitlyDeletedLocalDates,
      ...(rebuildStatusHistory
        ? (state.gymSessions ?? [])
            .filter(
              (session) =>
                session.userId === state.currentUserId &&
                session.localDate >= statusSinceDate,
            )
            .map((session) => session.localDate)
        : []),
      ...(rebuildStatusHistory
        ? state.dailyMetricStatuses
            .filter(
              (status) =>
                status.groupId === state.group.id &&
                status.userId === state.currentUserId &&
                status.localDate >= statusSinceDate,
            )
            .map((status) => status.localDate)
        : []),
      ...(rebuildStatusHistory
        ? vacationDates(state, state.currentUserId).filter(
            (localDate) => localDate >= statusSinceDate,
          )
        : []),
      dateKey(),
    ]),
  ];
  const statuses = buildCloudDailyStatusRows(
    state,
    idBySlug,
    ownedEntries,
    statusDates,
    publishRevision,
  );
  const upsertStatuses = (rows: CloudDailyStatusUpsertRow[]) =>
    upsertCloudDailyStatusRows(client, rows);
  const commitActivity = (dates: string[]) =>
    commitCloudActivityCheckpoint(
      client,
      state.group.id,
      dates,
      statusSinceDate,
      publishRevision,
    );

  // Publish the newest month first. A large first-time history backfill can
  // continue afterwards, while peers already receive today's values and an
  // honest recent-sync timestamp instead of seeing "No data" for minutes.
  const recentSince = recentCommitSinceDate;
  const recentStatuses = statuses.filter(
    (status) => status.local_date >= recentSince,
  );
  const olderStatuses = statuses.filter(
    (status) => status.local_date < recentSince,
  );
  await upsertStatuses(recentStatuses);
  await upsertStatuses(olderStatuses);

  const activityCommitDates = [
    ...statusDates,
    ...explicitlyDeletedLocalDates,
  ];
  const needsHistoricalCommit = activityCommitDates.some(
    (localDate) => localDate < recentSince,
  );
  // The fast checkpoint above already published and stamped the current
  // leaderboard window. Reuse it for routine saves; only commit a second
  // version when this request genuinely widened historical coverage or
  // propagated an older correction/deletion.
  const activityCommit = needsHistoricalCommit
    ? await commitActivity(activityCommitDates)
    : fastRecentCheckpoint;

  // Notifications may expose an exact value or a ranking change. Dispatch
  // only after the detailed entries, compact statuses, and revision-checked
  // activity checkpoint are all durable. A stale publish that loses its CAS
  // race therefore cannot announce data that the group never received.
  await Promise.all([
    dispatchCommittedEntryNotifications(),
    dispatchCommittedLeadNotifications(),
  ]);

  // Period-winner alerts are distinct from live lead-change alerts: they only
  // announce a period that has finished. Stable event keys plus the server's
  // push_events claim make this safe when several members sync at once.
  if (state.group.members.length > 1) {
    const winnerState = sharedCompetitionState(state);
    const winnerMetrics = (state.group.metricConfiguration ?? []).filter(
      (metric) =>
        metric.scoreWeight > 0 &&
        metric.sections.group &&
        metric.dataType !== "text" &&
        metric.dataType !== "photo",
    );
    const yesterday = dateWithOffsetFrom(today, -1);
    const currentWeek = calendarWeekRange(
      today,
      state.settings.weekStartsOn ?? 1,
    );
    const finalizedPeriods: {
      key: "day" | "week" | "month";
      anchor: string;
      title: string;
      dates: string[];
    }[] = [
      {
        key: "day",
        anchor: yesterday,
        title: "Yesterday's group winners",
        dates: [yesterday],
      },
    ];
    if (currentWeek[0] === today) {
      const priorWeekAnchor = dateWithOffsetFrom(today, -1);
      const priorWeek = calendarWeekRange(
        priorWeekAnchor,
        state.settings.weekStartsOn ?? 1,
      );
      finalizedPeriods.push({
        key: "week",
        anchor: priorWeek[0],
        title: "Last week's group winners",
        dates: priorWeek,
      });
    }
    if (today.endsWith("-01")) {
      const priorMonthAnchor = dateWithOffsetFrom(today, -1);
      finalizedPeriods.push({
        key: "month",
        anchor: priorMonthAnchor.slice(0, 7),
        title: "Last month's group winners",
        dates: monthDateRange(priorMonthAnchor),
      });
    }
    await Promise.allSettled(
      finalizedPeriods.map(async (period) => {
        const eventKey = `winner:${state.group.id}:${period.key}:${period.anchor}`;
        if (attemptedWinnerEvents.has(eventKey)) return;
        const winners = winnerMetrics.flatMap((metric) => {
          const row = leaderboardRows(
            winnerState,
            [metric],
            period.dates,
            "__shared_group_view__",
            false,
          )[0];
          const result = row?.metrics[0]?.result;
          return result &&
            result.mode !== "private" &&
            result.visibleDays > 0
            ? [{ metric: metric.name, member: row.member.name }]
            : [];
        });
        if (!winners.length) return;
        attemptedWinnerEvents.add(eventKey);
        const preview = winners
          .slice(0, 3)
          .map((winner) => `${winner.member}: ${winner.metric}`)
          .join("; ");
        const remaining = winners.length - 3;
        const result = await client.functions.invoke("send-push", {
          body: withLocalizedPushCopy({
            eventKey,
            groupId: state.group.id,
            category: "winner",
            audience: "group_including_sender",
            title: period.title,
            body: `${preview}${remaining > 0 ? `; +${remaining} more` : ""}.`,
            data: { route: "/badges", groupId: state.group.id },
          }),
        });
        if (result.error) {
          attemptedWinnerEvents.delete(eventKey);
          throw result.error;
        }
      }),
    );
  }

  const activeMemberIds = new Set(
    state.group.members.map((member) => member.id),
  );
  const ownedMessages = state.messages.filter(
    (message) =>
      message.senderId === state.currentUserId &&
      cloudOwnedMessage(message, state.group.id) &&
      (!message.recipientId || activeMemberIds.has(message.recipientId)),
  ).map((message) => messageForGroup(message, state.group.id));
  const currentMessageRows = await client
    .from("messages")
    .select("client_generated_id, push_dispatched_at")
    .eq("group_id", state.group.id)
    .eq("sender_id", state.currentUserId);
  let legacyMessageKeys = new Set<string>();
  let oldMessageIds = new Set<string>();
  let pendingPushIds = new Set<string>();
  let legacyMessages = false;
  if (currentMessageRows.error) {
    if (!/client_generated_id|column|schema cache/i.test(currentMessageRows.error.message))
      throw currentMessageRows.error;
    legacyMessages = true;
    const legacyRows = await client
      .from("messages")
      .select("content, created_at")
      .eq("group_id", state.group.id)
      .eq("sender_id", state.currentUserId);
    if (legacyRows.error) throw legacyRows.error;
    legacyMessageKeys = new Set(
      (legacyRows.data ?? []).map(
        (message) => `${message.created_at}|${message.content}`,
      ),
    );
  } else {
    oldMessageIds = new Set(
      (currentMessageRows.data ?? []).map(
        (message) => message.client_generated_id,
      ),
    );
    pendingPushIds = new Set(
      (currentMessageRows.data ?? [])
        .filter((message) => !message.push_dispatched_at)
        .map((message) => message.client_generated_id),
    );
  }
  const newMessages = ownedMessages.filter((message) =>
    legacyMessages
      ? !legacyMessageKeys.has(`${message.createdAt}|${message.text}`)
      : !oldMessageIds.has(message.id),
  );
  // Chat is append-preserving. Missing local rows may simply be an older or
  // partially loaded snapshot, so absence must not be interpreted as deletion.
  if (newMessages.length && !legacyMessages) {
    const currentUpsert = await client.from("messages").upsert(
      newMessages.map((message) => ({
        group_id: state.group.id,
        sender_id: state.currentUserId,
        client_generated_id: message.id,
        kind: message.kind,
        content: message.text,
        conversation_id: message.conversationId ?? `group:${state.group.id}`,
        recipient_id: message.recipientId ?? null,
        image_path: message.imageStoragePath ?? null,
        metadata: {},
        created_at: message.createdAt,
      })),
      { onConflict: "sender_id,client_generated_id" },
    );
    if (currentUpsert.error) {
      if (!/constraint|conflict|client_generated_id|column|schema cache/i.test(currentUpsert.error.message))
        throw currentUpsert.error;
      legacyMessages = true;
    }
  }
  if (legacyMessages && newMessages.length) {
    // Old schemas cannot enforce direct-message or image authorization. Never
    // downgrade a private message into a group-visible legacy row.
    const legacySafeMessages = newMessages.filter(
      (message) => !message.recipientId && !message.imageStoragePath,
    );
    if (legacySafeMessages.length) {
      const legacyInsert = await client.from("messages").insert(
        legacySafeMessages.map((message) => ({
          group_id: state.group.id,
          sender_id: state.currentUserId,
          kind: message.kind,
          content: message.text || "Shared an update",
          metadata: {},
          created_at: message.createdAt,
        })),
      );
      if (legacyInsert.error) throw legacyInsert.error;
    }
  }
  const pushCandidates = legacyMessages
    ? newMessages.filter((message) => freshChatPushCandidate(message))
    : ownedMessages.filter(
        (message) =>
          freshChatPushCandidate(message) &&
          (newMessages.some((candidate) => candidate.id === message.id) ||
            pendingPushIds.has(message.id)),
      );
  const pushResults = await Promise.allSettled(
    pushCandidates.map(async (message) => {
      const result = await client.functions.invoke("send-push", {
        body: chatPushPayload(state, current, message),
      });
      if (result.error) throw result.error;
      return result.data;
    }),
  );
  void pushResults;

  const explicitDeletedPhotoIds = [
    ...new Set(state.settings.pendingDeletedPhotoIds ?? []),
  ];
  for (const batch of batches(explicitDeletedPhotoIds)) {
    const deleted = await client.rpc("delete_group_photo_updates", {
      p_client_generated_ids: batch,
      p_group_id: null,
      p_expected_revision: publishRevision,
    });
    if (deleted.error) throw deleted.error;
  }
  const ownedPhotos = state.photos.filter(
    (photo) => photo.userId === state.currentUserId && photo.storagePath,
  );
  const { data: oldPhotos, error: oldPhotoError } = await client
    .from("photo_updates")
    .select("client_generated_id")
    .eq("group_id", state.group.id)
    .eq("owner_user_id", state.currentUserId);
  if (oldPhotoError) throw oldPhotoError;
  const currentPhotoIds = new Set(ownedPhotos.map((photo) => photo.id));
  const inferredDeletedPhotoIds = (oldPhotos ?? [])
    .map((photo) => photo.client_generated_id)
    .filter((id) => id && !currentPhotoIds.has(id));
  if (inferredDeletedPhotoIds.length) {
    const deleted = await client.rpc("delete_group_photo_updates", {
      p_client_generated_ids: inferredDeletedPhotoIds,
      p_group_id: state.group.id,
      p_expected_revision: publishRevision,
    });
    if (deleted.error) throw deleted.error;
  }
  const deletedPhotoIds = [
    ...new Set([...explicitDeletedPhotoIds, ...inferredDeletedPhotoIds]),
  ];
  for (const photo of ownedPhotos) {
    const { data: asset, error: assetError } = await client
      .from("media_assets")
      .upsert(
        {
          owner_user_id: state.currentUserId,
          storage_path: photo.storagePath,
          captured_at: photo.capturedAt ?? photo.createdAt,
        },
        { onConflict: "storage_path" },
      )
      .select("id")
      .single();
    if (assetError) throw assetError;
    const { error } = await client.from("photo_updates").upsert(
      {
        media_asset_id: asset.id,
        owner_user_id: state.currentUserId,
        group_id: state.group.id,
        client_generated_id: photo.id,
        caption: photo.caption,
        local_date: photo.localDate,
         visibility: photo.visibility,
         created_at: photo.createdAt,
         account_revision: publishRevision,
       },
      { onConflict: "owner_user_id,client_generated_id" },
    );
    if (error) throw error;
  }

  const aliases = state.settings.memberNicknamesByGroup[state.group.id] ?? {};
  const aliasRows = Object.entries(aliases)
    .filter(([, alias]) => alias.trim())
    .map(([memberId, alias]) => ({
      subject_user_id: memberId,
      nickname: alias.trim(),
    }));
  const aliasProjection = await client.rpc("publish_group_member_aliases", {
    p_group_id: state.group.id,
    p_expected_revision: publishRevision,
    p_aliases: aliasRows,
  });
  if (aliasProjection.error) throw aliasProjection.error;
  return {
    deletedEntryIds: explicitDeletedEntryIds,
    deletedPhotoIds,
    activityVersion: activityCommit.version,
    workspacePushed: true,
    groupConfigurationPushed,
    groupConfigurationRevision:
      projectionResult?.groupConfigurationRevision,
  };
}
