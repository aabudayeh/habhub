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

const DAY_MS = 86_400_000;

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
  const effectiveAnchor =
    typeof recurrence?.anchorDate === "string" ? recurrence.anchorDate : anchor;
  if (typeof recurrence?.endDate === "string" && localDate > recurrence.endDate)
    return false;
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
  const value = Number(entry.value);
  return Number.isFinite(value) ? value : undefined;
}

function aggregateValues(
  values: { value: number; recordedAt: string }[],
  method: string,
) {
  if (!values.length) return undefined;
  if (method === "latest")
    return [...values].sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt)
    )[0]?.value;
  const numbers = values.map((item) => item.value);
  if (method === "average")
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (method === "max") return Math.max(...numbers);
  if (method === "min") return Math.min(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0);
}

function occurrenceDates(challenge: ChallengeRow, today: string) {
  const cutoff = dateWithOffset(today, -30);
  const recurring = challenge.recurrence &&
    challenge.recurrence.mode !== "once";
  if (!recurring)
    return challenge.local_date <= today && challenge.end_date >= cutoff
      ? [challenge.local_date]
      : [];
  const first = challenge.local_date > cutoff ? challenge.local_date : cutoff;
  const recurrenceEnd = typeof challenge.recurrence?.endDate === "string"
    ? challenge.recurrence.endDate
    : today;
  const last = recurrenceEnd < today ? recurrenceEnd : today;
  const dates: string[] = [];
  for (let date = first, guard = 0; date <= last && guard <= 31; guard += 1) {
    if (scheduleApplies(challenge.recurrence, challenge.local_date, date))
      dates.push(date);
    date = dateWithOffset(date, 1);
  }
  return dates;
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
  const catalogue = await admin.from("group_challenges")
    .select("id, metric_slug, local_date, end_date, recurrence")
    .eq("audience", "public")
    .is("deleted_at", null)
    .contains("accepted_participant_ids", [userId])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (catalogue.error) throw catalogue.error;
  const challenges = (catalogue.data ?? []) as ChallengeRow[];
  if (!challenges.length) return 0;
  const profile = await admin.from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) throw profile.error;
  const today = localDateInTimezone(
    new Date(syncedAt),
    typeof profile.data?.timezone === "string" ? profile.data.timezone : undefined,
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
  const rows: AggregateRow[] = [];
  const syncedChallengeIds = new Set<string>();
  for (const challenge of challenges) {
    const metric = metrics.get(challenge.metric_slug);
    if (!metric) continue;
    const aggregation = typeof metric.aggregation === "string"
      ? metric.aggregation
      : "sum";
    const metricEntries = entries.filter(
      (entry) => entry.metricId === challenge.metric_slug,
    );
    for (const occurrenceDate of occurrenceDates(challenge, today)) {
      const recurring = challenge.recurrence &&
        challenge.recurrence.mode !== "once";
      const periodEnd = recurring
        ? occurrenceDate
        : dateWithOffset(
            occurrenceDate,
            Math.max(0, elapsedDays(challenge.local_date, challenge.end_date)),
          );
      const throughDate = periodEnd > today ? today : periodEnd;
      const daily = new Map<string, { value: number; recordedAt: string }[]>();
      for (const entry of metricEntries) {
        const localDate = String(entry.localDate);
        if (localDate < occurrenceDate || localDate > throughDate) continue;
        const values = daily.get(localDate) ?? [];
        values.push({
          value: numericEntryValue(entry)!,
          recordedAt: typeof entry.recordedAt === "string"
            ? entry.recordedAt
            : `${localDate}T12:00:00Z`,
        });
        daily.set(localDate, values);
      }
      const dailyValues = [...daily]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, values]) => aggregateValues(values, aggregation))
        .filter((value): value is number => Number.isFinite(value));
      let total = dailyValues.reduce((sum, value) => sum + value, 0);
      if (challenge.metric_slug === "weight" && dailyValues.length) {
        const previous = metricEntries
          .filter((entry) => String(entry.localDate) < occurrenceDate)
          .sort((left, right) =>
            String(right.recordedAt ?? "").localeCompare(
              String(left.recordedAt ?? ""),
            )
          )[0];
        const baseline = previous === undefined
          ? dailyValues[0]
          : numericEntryValue(previous)!;
        const raw = dailyValues[dailyValues.length - 1] - baseline;
        const direction = metric.rankingDirection;
        total = direction === "lower" ? -raw : direction === "higher" ? raw : Math.abs(raw);
      }
      rows.push({
        challenge_id: challenge.id,
        occurrence_date: occurrenceDate,
        user_id: userId,
        total: Number.isFinite(total) ? total : 0,
        has_data: dailyValues.length > 0,
        synced_at: syncedAt,
        updated_at: syncedAt,
      });
      syncedChallengeIds.add(challenge.id);
    }
  }
  for (let offset = 0; offset < rows.length; offset += 500) {
    const written = await admin.from("public_challenge_totals")
      .upsert(rows.slice(offset, offset + 500), {
        onConflict: "challenge_id,occurrence_date,user_id",
      });
    if (written.error) throw written.error;
  }
  if (!syncedChallengeIds.size) return 0;
  const markers = await admin.from("public_challenge_participant_syncs")
    .upsert(
      [...syncedChallengeIds].map((challengeId) => ({
        challenge_id: challengeId,
        user_id: userId,
        synced_at: syncedAt,
      })),
      { onConflict: "challenge_id,user_id" },
    );
  if (markers.error) throw markers.error;
  return rows.length;
}
