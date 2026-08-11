import { supabase } from "@/src/lib/supabase";
import { GroupChallenge } from "@/src/types";

type GroupChallengeRow = {
  id: string;
  group_id: string;
  creator_id: string;
  metric_slug: string;
  title: string | null;
  target_value: number | string;
  local_date: string;
  participant_ids: string[];
  created_at: string;
  updated_at: string;
};

export type SaveGroupChallengeInput = {
  id?: string;
  groupId: string;
  metricId: string;
  title?: string;
  target: number;
  localDate: string;
  participantIds: string[];
};

function challengeCloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .join(" · ");
    if (message) return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function fromRow(row: GroupChallengeRow): GroupChallenge {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    metricId: row.metric_slug,
    title: row.title?.trim() || undefined,
    target: Number(row.target_value),
    localDate: row.local_date,
    participantIds: [...new Set(row.participant_ids ?? [])],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadGroupChallenges(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_challenges")
    .select(
      "id, group_id, creator_id, metric_slug, title, target_value, local_date, participant_ids, created_at, updated_at",
    )
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw challengeCloudError(error);
  return (data as GroupChallengeRow[] | null)?.map(fromRow) ?? [];
}

export async function saveGroupChallenge(input: SaveGroupChallengeInput) {
  if (!supabase) throw new Error("Sign in to create a shared challenge.");
  const { data, error } = await supabase.rpc("save_group_challenge", {
    p_challenge_id: input.id ?? null,
    p_group_id: input.groupId,
    p_metric_slug: input.metricId,
    p_title: input.title?.trim() || null,
    p_target_value: input.target,
    p_local_date: input.localDate,
    p_participant_ids: input.participantIds,
  });
  if (error) throw challengeCloudError(error);
  return fromRow(data as GroupChallengeRow);
}

export async function deleteGroupChallenge(id: string) {
  if (!supabase) throw new Error("Sign in to delete a shared challenge.");
  const { error } = await supabase.rpc("delete_group_challenge", {
    p_challenge_id: id,
  });
  if (error) throw challengeCloudError(error);
}
