import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;
type Snapshot = JsonObject & { entries?: JsonObject[]; metrics?: JsonObject[] };
type ChallengeRow = {
  id: string;
  metric_slug: string;
  local_date: string;
  end_date: string;
  recurrence: JsonObject | null;
};
type AggregateRow = {
  challenge_id: string;
  occurrence_date: string;
  user_id: string;
  total: number;
  has_data: boolean;
  synced_at: string;
  updated_at: string;
};

type CloudError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const DAY_MS = 86_400_000;
const PROJECTION_BATCH_SIZE = 500;
const LEGACY_CATALOGUE_PAGE_SIZE = 200;
// The database cursor is durable, so one Edge invocation only needs to make
// bounded progress. A later Google Health sync resumes exactly where this
// invocation stopped instead of issuing an unbounded PostgREST chain.
const MAX_PROJECTION_BATCHES = 20;
const SERVICE_BATCH_RPC = "project_public_challenge_totals_batch";
const OCCURRENCE_SYNC_SCHEMA_MISSING_CODES = new Set([
  "42P01",
  "PGRST204",
  "PGRST205",
]);

function occurrenceSyncSchemaUnavailable(error: { code?: string } | null) {
  return Boolean(
    error?.code && OCCURRENCE_SYNC_SCHEMA_MISSING_CODES.has(error.code),
  );
}

function batchProjectionRpcUnavailable(error: CloudError | null | undefined) {
  if (!error || !["42883", "PGRST202"].includes(error.code ?? "")) {
    return false;
  }
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .includes(SERVICE_BATCH_RPC);
}

async function projectOutstandingOccurrences(
  admin: SupabaseClient,
  userId: string,
) {
  let written = 0;
  for (let batch = 0; batch < MAX_PROJECTION_BATCHES; batch += 1) {
    const { data, error } = await admin.rpc(SERVICE_BATCH_RPC, {
      p_user_id: userId,
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
    ) {
      throw new Error("Invalid public challenge projection response.");
    }
    written += batchWritten;
    if (batchWritten < PROJECTION_BATCH_SIZE) return written;
  }
  return written;
}

function dateAtNoon(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function dateWithOffset(value: string, offset: number) {
  const next = dateAtNoon(value);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function elapsedDays(anchor: string, value: string) {
  return Math.round(
    (dateAtNoon(value).getTime() - dateAtNoon(anchor).getTime()) / DAY_MS,
  );
}

function localDateInTimezone(now: Date, timeZone?: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function scheduleApplies(
  recurrence: JsonObject | null,
  anchor: string,
  localDate: string,
) {
  const mode = typeof recurrence?.mode === "string" ? recurrence.mode : "once";
  const effectiveAnchor = typeof recurrence?.anchorDate === "string"
    ? recurrence.anchorDate
    : anchor;
  if (
    typeof recurrence?.endDate === "string" && localDate > recurrence.endDate
  ) {
    return false;
  }
  if (mode === "once") return localDate === effectiveAnchor;
  if (localDate < effectiveAnchor) return false;
  if (mode === "daily") return true;
  if (mode === "selected_days") {
    const days = Array.isArray(recurrence?.daysOfWeek)
      ? recurrence.daysOfWeek.map(Number)
      : [];
    return days.includes(dateAtNoon(localDate).getUTCDay());
  }
  if (mode === "every_other_day" || mode === "interval_days") {
    const interval = mode === "every_other_day"
      ? 2
      : Math.max(1, Math.round(Number(recurrence?.intervalDays ?? 1)));
    const elapsed = elapsedDays(effectiveAnchor, localDate);
    return elapsed >= 0 && elapsed % interval === 0;
  }
  if (mode === "days_of_month") {
    const days = Array.isArray(recurrence?.daysOfMonth)
      ? recurrence.daysOfMonth.map(Number)
      : [];
    return days.includes(Number(localDate.slice(-2)));
  }
  return false;
}

function numericEntryValue(entry: JsonObject) {
  if (typeof entry.value === "boolean") return entry.value ? 1 : 0;
  return typeof entry.value === "number" && Number.isFinite(entry.value)
    ? entry.value
    : undefined;
}

function aggregateValues(
  values: { value: number; recordedAt: string }[],
  method: string,
) {
  if (!values.length) return undefined;
  if (method === "latest") {
    return [...values].sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt)
    )[0]?.value;
  }
  const numbers = values.map((item) => item.value);
  if (method === "average") {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }
  if (method === "max") return Math.max(...numbers);
  if (method === "min") return Math.min(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0);
}

function* occurrenceDates(challenge: ChallengeRow, today: string) {
  const recurring = challenge.recurrence &&
    challenge.recurrence.mode !== "once";
  if (!recurring) {
    if (challenge.local_date <= today) yield challenge.local_date;
    return;
  }
  const recurrenceEnd = typeof challenge.recurrence?.endDate === "string"
    ? challenge.recurrence.endDate
    : today;
  const last = recurrenceEnd < today ? recurrenceEnd : today;
  for (let date = challenge.local_date; date <= last;) {
    if (scheduleApplies(challenge.recurrence, challenge.local_date, date)) {
      yield date;
    }
    date = dateWithOffset(date, 1);
  }
}

async function persistLegacyRows(
  admin: SupabaseClient,
  userId: string,
  rows: AggregateRow[],
) {
  for (let offset = 0; offset < rows.length; offset += PROJECTION_BATCH_SIZE) {
    const written = await admin.from("public_challenge_totals")
      .upsert(rows.slice(offset, offset + PROJECTION_BATCH_SIZE), {
        onConflict: "challenge_id,occurrence_date,user_id",
      });
    if (written.error) throw written.error;
  }
  if (!rows.length) return 0;

  let occurrenceSchemaUnavailable = false;
  for (let offset = 0; offset < rows.length; offset += PROJECTION_BATCH_SIZE) {
    const markers = await admin.from("public_challenge_occurrence_syncs")
      .upsert(
        rows.slice(offset, offset + PROJECTION_BATCH_SIZE).map((row) => ({
          challenge_id: row.challenge_id,
          occurrence_date: row.occurrence_date,
          user_id: row.user_id,
          synced_at: row.synced_at,
        })),
        { onConflict: "challenge_id,occurrence_date,user_id" },
      );
    if (markers.error && occurrenceSyncSchemaUnavailable(markers.error)) {
      occurrenceSchemaUnavailable = true;
      break;
    }
    if (markers.error) throw markers.error;
  }
  if (occurrenceSchemaUnavailable) {
    // Edge code may deploy just before the occurrence-scoped table. Mark this
    // challenge only after every one of its aggregate rows was written.
    const legacy = await admin.from("public_challenge_participant_syncs")
      .upsert(
        [{
          challenge_id: rows[0].challenge_id,
          user_id: userId,
          synced_at: rows[0].synced_at,
        }],
        { onConflict: "challenge_id,user_id" },
      );
    if (legacy.error) throw legacy.error;
  }
  return rows.length;
}

function legacyAggregateRows(
  challenge: ChallengeRow,
  metric: JsonObject | undefined,
  entries: JsonObject[],
  userId: string,
  today: string,
  syncedAt: string,
) {
  const aggregation = typeof metric?.aggregation === "string"
    ? metric.aggregation
    : "sum";
  const metricEntries = entries.filter(
    (entry) => entry.metricId === challenge.metric_slug,
  );
  const rows: AggregateRow[] = [];
  for (const occurrenceDate of occurrenceDates(challenge, today)) {
    if (!metric) {
      rows.push({
        challenge_id: challenge.id,
        occurrence_date: occurrenceDate,
        user_id: userId,
        total: 0,
        has_data: false,
        synced_at: syncedAt,
        updated_at: syncedAt,
      });
      continue;
    }
    const recurring = challenge.recurrence &&
      challenge.recurrence.mode !== "once";
    const periodEnd = recurring ? occurrenceDate : dateWithOffset(
      occurrenceDate,
      Math.max(0, elapsedDays(challenge.local_date, challenge.end_date)),
    );
    const throughDate = periodEnd > today ? today : periodEnd;
    const daily = new Map<string, { value: number; recordedAt: string }[]>();
    const restrictedDates = new Set<string>();
    for (const entry of metricEntries) {
      const localDate = String(entry.localDate);
      if (localDate < occurrenceDate || localDate > throughDate) continue;
      // Exact public totals are built only from explicit group-visible rows.
      // Only an explicit group row is eligible for an exact total. A day with
      // private, status-only, or missing visibility fails closed unless the
      // same daily projection has an explicit group-visible replacement.
      if (entry.visibility !== "group") {
        restrictedDates.add(localDate);
        continue;
      }
      const values = daily.get(localDate) ?? [];
      values.push({
        value: numericEntryValue(entry)!,
        recordedAt: typeof entry.recordedAt === "string"
          ? entry.recordedAt
          : `${localDate}T12:00:00Z`,
      });
      daily.set(localDate, values);
    }
    const hasRestrictedDay = [...restrictedDates].some(
      (localDate) => !daily.has(localDate),
    );
    const dailyValues = hasRestrictedDay ? [] : [...daily]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => aggregateValues(values, aggregation))
      .filter((value): value is number => Number.isFinite(value));
    let total = dailyValues.reduce((sum, value) => sum + value, 0);
    if (challenge.metric_slug === "weight" && dailyValues.length) {
      const previousDate = metricEntries
        .filter((entry) =>
          entry.visibility === "group" &&
          String(entry.localDate) < occurrenceDate
        )
        .map((entry) => String(entry.localDate))
        .sort((left, right) => right.localeCompare(left))[0];
      const previousValues = previousDate
        ? metricEntries
          .filter((entry) =>
            entry.visibility === "group" &&
            entry.localDate === previousDate
          )
          .map((entry) => ({
            value: numericEntryValue(entry)!,
            recordedAt: typeof entry.recordedAt === "string"
              ? entry.recordedAt
              : `${previousDate}T12:00:00Z`,
          }))
        : [];
      const baseline = aggregateValues(previousValues, aggregation) ??
        dailyValues[0];
      const raw = dailyValues[dailyValues.length - 1] - baseline;
      const direction = metric.rankingDirection;
      total = direction === "lower"
        ? -raw
        : direction === "higher"
        ? raw
        : Math.abs(raw);
    }
    rows.push({
      challenge_id: challenge.id,
      occurrence_date: occurrenceDate,
      user_id: userId,
      total: Number.isFinite(total) ? total : 0,
      has_data: dailyValues.length > 0 && !hasRestrictedDay,
      synced_at: syncedAt,
      updated_at: syncedAt,
    });
  }
  return rows;
}

/**
 * Refresh aggregate-only public challenge scores after a server Google Health
 * sync. This is the background equivalent of the signed-in client RPC: it
 * never copies raw entries/photos into challenge tables, and a sync marker is
 * written only after every aggregate batch succeeds.
 */
export async function projectPublicChallengesFromSnapshot(
  admin: SupabaseClient,
  userId: string,
  snapshot: Snapshot,
  syncedAt: string,
) {
  const projected = await projectOutstandingOccurrences(admin, userId);
  if (projected !== undefined) return projected;

  const profile = await admin.from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) throw profile.error;
  const today = localDateInTimezone(
    new Date(syncedAt),
    typeof profile.data?.timezone === "string"
      ? profile.data.timezone
      : undefined,
  );

  const metrics = new Map(
    (Array.isArray(snapshot.metrics) ? snapshot.metrics : [])
      .filter((metric) => typeof metric.id === "string")
      .map((metric) => [String(metric.id), metric]),
  );
  const entries = (Array.isArray(snapshot.entries) ? snapshot.entries : [])
    .filter((entry) =>
      (!entry.userId || entry.userId === userId) &&
      typeof entry.metricId === "string" &&
      typeof entry.localDate === "string" &&
      numericEntryValue(entry) !== undefined
    );
  let cursor: string | undefined;
  let written = 0;
  for (;;) {
    let query = admin.from("group_challenges")
      .select("id, metric_slug, local_date, end_date, recurrence")
      .eq("audience", "public")
      .is("deleted_at", null)
      .contains("accepted_participant_ids", [userId])
      .order("id", { ascending: true })
      .limit(LEGACY_CATALOGUE_PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const catalogue = await query;
    if (catalogue.error) throw catalogue.error;
    const challenges = (catalogue.data ?? []) as ChallengeRow[];
    for (const challenge of challenges) {
      const metric = metrics.get(challenge.metric_slug);
      written += await persistLegacyRows(
        admin,
        userId,
        legacyAggregateRows(
          challenge,
          metric,
          entries,
          userId,
          today,
          syncedAt,
        ),
      );
    }
    if (challenges.length < LEGACY_CATALOGUE_PAGE_SIZE) break;
    const nextCursor = challenges.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("Public challenge catalogue paging did not advance.");
    }
    cursor = nextCursor;
  }
  return written;
}
