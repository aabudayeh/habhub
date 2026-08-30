import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { challengePeriodDates } from "@/src/domain/groupChallenges";
import { scheduleAppliesOnDate } from "@/src/domain/schedule";
import { supabase } from "@/src/lib/supabase";
import type {
  AppState,
  DailyMetricStatus,
  GoalSchedule,
  MetricDefinition,
  MetricEntry,
} from "@/src/types";

type PublicChallengeTotalRow = {
  challengeId: string;
  occurrenceDate: string;
  total: number;
  hasData: boolean;
};

type LegacyPublicChallengeRow = {
  id: string;
  group_id: string;
  metric_slug: string;
  local_date: string;
  end_date: string;
  recurrence: GoalSchedule | null;
};

type CloudError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const PROJECTION_BATCH_SIZE = 500;
const LEGACY_CATALOGUE_PAGE_SIZE = 200;
// The database cursor is durable, so one foreground sync only needs to make
// bounded progress. A later workspace/background sync resumes exactly where
// this invocation stopped instead of issuing an unbounded PostgREST chain.
const MAX_PROJECTION_BATCHES = 20;
const CLIENT_BATCH_RPC = "project_my_public_challenge_totals_batch";

function batchProjectionRpcUnavailable(error: CloudError | null | undefined) {
  if (!error || !["42883", "PGRST202"].includes(error.code ?? ""))
    return false;
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .includes(CLIENT_BATCH_RPC);
}

async function projectOutstandingOccurrences() {
  if (!supabase) return 0;
  let written = 0;
  for (let batch = 0; batch < MAX_PROJECTION_BATCHES; batch += 1) {
    const { data, error } = await supabase.rpc(CLIENT_BATCH_RPC, {
      p_limit: PROJECTION_BATCH_SIZE,
    });
    if (error) {
      if (batch === 0 && batchProjectionRpcUnavailable(error)) return undefined;
      throw error;
    }
    const batchWritten = Number(data ?? 0);
    if (
      !Number.isSafeInteger(batchWritten) ||
      batchWritten < 0 ||
      batchWritten > PROJECTION_BATCH_SIZE
    )
      throw new Error("Invalid public challenge projection response.");
    written += batchWritten;
    if (batchWritten < PROJECTION_BATCH_SIZE) return written;
  }
  return written;
}

function* occurrenceDates(
  challenge: LegacyPublicChallengeRow,
  today: string,
) {
  const recurrence = challenge.recurrence;
  if (!recurrence || recurrence.mode === "once") {
    if (challenge.local_date <= today) yield challenge.local_date;
    return;
  }
  const throughDate =
    recurrence.endDate && recurrence.endDate < today
      ? recurrence.endDate
      : today;
  for (
    let localDate = challenge.local_date;
    localDate <= throughDate;
    localDate = dateWithOffsetFrom(localDate, 1)
  ) {
    if (scheduleAppliesOnDate(recurrence, challenge.local_date, localDate))
      yield localDate;
  }
}

function metricCatalogue(state: AppState) {
  const metrics = new Map<string, MetricDefinition>();
  for (const metric of state.metrics) metrics.set(metric.id, metric);
  for (const group of [state.group, ...state.groups])
    for (const metric of group.metricConfiguration ?? [])
      if (!metrics.has(metric.id)) metrics.set(metric.id, metric);
  return metrics;
}

function numericEntryValue(entry: MetricEntry) {
  if (typeof entry.value === "boolean") return entry.value ? 1 : 0;
  return typeof entry.value === "number" && Number.isFinite(entry.value)
    ? entry.value
    : undefined;
}

function aggregateEntries(
  entries: MetricEntry[],
  method: MetricDefinition["aggregation"],
) {
  if (!entries.length) return undefined;
  const sorted = [...entries].sort((left, right) =>
    left.recordedAt.localeCompare(right.recordedAt),
  );
  if (method === "latest") return numericEntryValue(sorted.at(-1)!)!;
  const values = sorted.map((entry) => numericEntryValue(entry)!);
  if (method === "average")
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (method === "max") return Math.max(...values);
  if (method === "min") return Math.min(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

function preferredStatus(
  statuses: DailyMetricStatus[],
  challengeGroupId: string,
) {
  return [...statuses].sort((left, right) => {
    const groupPreference =
      Number(right.groupId === challengeGroupId) -
      Number(left.groupId === challengeGroupId);
    if (groupPreference) return groupPreference;
    return String(right.syncedAt ?? "").localeCompare(left.syncedAt ?? "");
  })[0];
}

function legacyProjectionResult(
  state: AppState,
  challenge: LegacyPublicChallengeRow,
  metric: MetricDefinition | undefined,
  dates: string[],
) {
  if (!metric || !dates.length) return { hasData: false, total: 0 };
  const dateSet = new Set(dates);
  const matchingStatuses = state.dailyMetricStatuses.filter(
    (status) =>
      status.userId === state.currentUserId &&
      status.metricId === challenge.metric_slug &&
      dateSet.has(status.localDate),
  );
  let dailyValues: { date: string; value: number }[] = [];
  let baseline: number | undefined;
  let hasRestrictedDay = false;

  if (matchingStatuses.length) {
    const byDate = new Map<string, DailyMetricStatus[]>();
    for (const status of matchingStatuses) {
      const bucket = byDate.get(status.localDate) ?? [];
      bucket.push(status);
      byDate.set(status.localDate, bucket);
    }
    const selected = [...byDate.entries()].map(([date, statuses]) => ({
      date,
      status: preferredStatus(statuses, challenge.group_id),
    }));
    hasRestrictedDay = selected.some(
      ({ status }) =>
        status?.hasData === true && status.visibility !== "group",
    );
    dailyValues = selected
      .filter(
        ({ status }) =>
          status?.visibility === "group" &&
          Number.isFinite(status.exactValue),
      )
      .map(({ date, status }) => ({ date, value: status!.exactValue! }));
    if (challenge.metric_slug === "weight") {
      const previousDate = state.dailyMetricStatuses
        .filter(
          (status) =>
            status.userId === state.currentUserId &&
            status.metricId === challenge.metric_slug &&
            status.localDate < dates[0] &&
            status.visibility === "group" &&
            Number.isFinite(status.exactValue),
        )
        .map((status) => status.localDate)
        .sort((left, right) => right.localeCompare(left))[0];
      const previous = previousDate
        ? preferredStatus(
            state.dailyMetricStatuses.filter(
              (status) =>
                status.userId === state.currentUserId &&
                status.metricId === challenge.metric_slug &&
                status.localDate === previousDate &&
                status.visibility === "group" &&
                Number.isFinite(status.exactValue),
            ),
            challenge.group_id,
          )
        : undefined;
      baseline = previous?.exactValue;
    }
  } else {
    const entries = state.entries.filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === challenge.metric_slug &&
        numericEntryValue(entry) !== undefined,
    );
    for (const date of dates) {
      const dateEntries = entries.filter((entry) => entry.localDate === date);
      const groupEntries = dateEntries.filter(
        (entry) => entry.visibility === "group",
      );
      if (dateEntries.length > groupEntries.length && !groupEntries.length) {
        hasRestrictedDay = true;
        continue;
      }
      const value = aggregateEntries(groupEntries, metric.aggregation);
      if (value !== undefined) dailyValues.push({ date, value });
    }
    if (challenge.metric_slug === "weight") {
      const previousDate = entries
        .filter(
          (entry) =>
            entry.visibility === "group" && entry.localDate < dates[0],
        )
        .map((entry) => entry.localDate)
        .sort((left, right) => right.localeCompare(left))[0];
      baseline = previousDate
        ? aggregateEntries(
            entries.filter(
              (entry) =>
                entry.visibility === "group" &&
                entry.localDate === previousDate,
            ),
            metric.aggregation,
          )
        : undefined;
    }
  }

  dailyValues.sort((left, right) => left.date.localeCompare(right.date));
  if (hasRestrictedDay || !dailyValues.length)
    return { hasData: false, total: 0 };
  if (challenge.metric_slug !== "weight") {
    return {
      hasData: true,
      total: dailyValues.reduce((sum, item) => sum + item.value, 0),
    };
  }
  const delta =
    dailyValues.at(-1)!.value - (baseline ?? dailyValues[0].value);
  return {
    hasData: true,
    total:
      metric.rankingDirection === "lower"
        ? -delta
        : metric.rankingDirection === "higher"
          ? delta
          : Math.abs(delta),
  };
}

/**
 * Zero-downtime fallback for a client deployed just before the batch RPC. Its
 * catalogue and occurrence writes are both bounded, but every accepted row is
 * cursor-paged rather than silently truncated.
 */
async function publishLegacyOccurrences(state: AppState) {
  const client = supabase;
  if (!client) return 0;
  const today = dateKey();
  const metrics = metricCatalogue(state);
  let written = 0;
  let cursor: string | undefined;
  let challengeIds: string[] = [];
  let batchRows: PublicChallengeTotalRow[] = [];
  const flush = async () => {
    if (!challengeIds.length) return;
    const { data, error } = await client.rpc(
      "publish_joined_public_challenge_totals",
      { p_challenge_ids: challengeIds, p_rows: batchRows },
    );
    if (error) throw error;
    written += Number(data ?? 0);
    challengeIds = [];
    batchRows = [];
  };
  const append = async (row: PublicChallengeTotalRow) => {
    const needsChallengeId = !challengeIds.includes(row.challengeId);
    if (
      batchRows.length >= PROJECTION_BATCH_SIZE ||
      (needsChallengeId && challengeIds.length >= 100)
    )
      await flush();
    if (!challengeIds.includes(row.challengeId))
      challengeIds.push(row.challengeId);
    batchRows.push(row);
  };

  for (;;) {
    let query = client
      .from("group_challenges")
      .select("id, group_id, metric_slug, local_date, end_date, recurrence")
      .eq("audience", "public")
      .is("deleted_at", null)
      .contains("accepted_participant_ids", [state.currentUserId])
      .order("id", { ascending: true })
      .limit(LEGACY_CATALOGUE_PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as LegacyPublicChallengeRow[];
    for (const challenge of page) {
      const metric = metrics.get(challenge.metric_slug);
      for (const occurrenceDate of occurrenceDates(challenge, today)) {
        const periodEnd = challenge.recurrence &&
            challenge.recurrence.mode !== "once"
          ? occurrenceDate
          : challenge.end_date;
        const throughDate = periodEnd > today ? today : periodEnd;
        const dates = challengePeriodDates(occurrenceDate, throughDate);
        const result = legacyProjectionResult(state, challenge, metric, dates);
        await append({
          challengeId: challenge.id,
          occurrenceDate,
          total:
            result.hasData && Number.isFinite(result.total) ? result.total : 0,
          hasData: result.hasData,
        });
      }
    }
    if (page.length < LEGACY_CATALOGUE_PAGE_SIZE) break;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor)
      throw new Error("Public challenge catalogue paging did not advance.");
    cursor = nextCursor;
  }
  await flush();
  return written;
}

/**
 * Refresh rank-ready totals for every accepted public challenge occurrence.
 * The server derives authoritative values from synced, group-visible daily
 * status rows and advances durable per-occurrence watermarks in bounded batches.
 */
export async function publishJoinedPublicChallengeTotals(state: AppState) {
  if (!supabase) return 0;
  const projected = await projectOutstandingOccurrences();
  return projected ?? publishLegacyOccurrences(state);
}
