import { loadMyChallenges } from "@/src/cloud/groupChallenges";
import { supabase } from "@/src/lib/supabase";
import { dateKey, dateKeyWithOffset } from "@/src/domain/date";
import {
  acceptedChallengeParticipantIds,
  challengePeriodDates,
  expandGroupChallengeOccurrences,
  groupChallengeEndDate,
  groupChallengeJoinDeadline,
  groupChallengeSourceId,
} from "@/src/domain/groupChallenges";
import { periodMetricResult } from "@/src/domain/leaderboard";
import type { AppState, MetricDefinition } from "@/src/types";

type PublicChallengeTotalRow = {
  challengeId: string;
  occurrenceDate: string;
  total: number;
  hasData: boolean;
};

function metricCatalogue(state: AppState) {
  const metrics = new Map<string, MetricDefinition>();
  for (const metric of state.metrics) metrics.set(metric.id, metric);
  for (const group of [state.group, ...state.groups])
    for (const metric of group.metricConfiguration ?? [])
      if (!metrics.has(metric.id)) metrics.set(metric.id, metric);
  return metrics;
}

/**
 * Publish only rank-ready totals for public challenges the account accepted.
 * Raw logs, photos, and the private snapshot remain inaccessible to the
 * challenge owner and participants. The RPC independently verifies consent,
 * occurrence dates, caller identity, size, and numeric bounds.
 */
export async function publishJoinedPublicChallengeTotals(state: AppState) {
  const client = supabase;
  if (!client) return 0;
  const today = dateKey();
  const retryCutoff = dateKeyWithOffset(-30);
  const joined = (await loadMyChallenges())
    .filter(
      (challenge) =>
        challenge.audience === "public" &&
        acceptedChallengeParticipantIds(challenge).includes(
          state.currentUserId,
        ) &&
        challenge.localDate <= today &&
        groupChallengeJoinDeadline(challenge) >= retryCutoff,
    )
    .slice(0, 250);
  if (!joined.length) return 0;

  const metrics = metricCatalogue(state);
  const rows: PublicChallengeTotalRow[] = [];
  for (const challenge of joined) {
    const occurrences =
      challenge.recurrence && challenge.recurrence.mode !== "once"
        ? expandGroupChallengeOccurrences(
            [challenge],
            challenge.localDate > retryCutoff
              ? challenge.localDate
              : retryCutoff,
            today,
            5_000,
          )
        : [challenge];
    const metric = metrics.get(challenge.metricId);
    for (const occurrence of occurrences) {
      if (occurrence.localDate > today) continue;
      const endDate = groupChallengeEndDate(occurrence);
      const throughDate = endDate > today ? today : endDate;
      const dates = challengePeriodDates(occurrence.localDate, throughDate);
      const result = metric && dates.length
        ? periodMetricResult(
            state,
            metric,
            state.currentUserId,
            state.currentUserId,
            dates,
          )
        : undefined;
      const hasData = result?.mode === "exact" && result.visibleDays > 0;
      rows.push({
        challengeId: groupChallengeSourceId(occurrence),
        occurrenceDate: occurrence.localDate,
        total: hasData && Number.isFinite(result.total) ? result.total : 0,
        hasData,
      });
    }
  }

  rows.sort((left, right) =>
    right.occurrenceDate.localeCompare(left.occurrenceDate),
  );
  const byChallenge = new Map<string, PublicChallengeTotalRow[]>();
  for (const row of rows.slice(0, 5_000)) {
    const bucket = byChallenge.get(row.challengeId) ?? [];
    bucket.push(row);
    byChallenge.set(row.challengeId, bucket);
  }
  let written = 0;
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
  for (const challenge of joined) {
    const id = groupChallengeSourceId(challenge);
    const challengeRows = byChallenge.get(id) ?? [];
    if (!challengeRows.length) continue;
    if (
      challengeIds.length >= 100 ||
      batchRows.length + challengeRows.length > 500
    )
      await flush();
    challengeIds.push(id);
    batchRows.push(...challengeRows);
  }
  await flush();
  return written;
}
