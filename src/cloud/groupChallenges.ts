import { supabase } from "@/src/lib/supabase";
import { GoalSchedule, GroupChallenge } from "@/src/types";

type GroupChallengeRow = {
  id: string;
  group_id: string;
  creator_id: string;
  metric_slug: string;
  title: string | null;
  target_value: number | string;
  local_date: string;
  participant_ids: string[];
  accepted_participant_ids: string[];
  declined_participant_ids: string[];
  recurrence: GoalSchedule | null;
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
  recurrence?: GoalSchedule;
};

export type GroupChallengeResponse = "accepted" | "declined";

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
    acceptedParticipantIds: [
      ...new Set(row.accepted_participant_ids ?? row.participant_ids ?? []),
    ],
    declinedParticipantIds: [
      ...new Set(row.declined_participant_ids ?? []),
    ],
    recurrence: row.recurrence ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadGroupChallenges(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_challenges")
    .select(
      "id, group_id, creator_id, metric_slug, title, target_value, local_date, participant_ids, accepted_participant_ids, declined_participant_ids, recurrence, created_at, updated_at",
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
    p_recurrence: input.recurrence ?? null,
  });
  if (error) throw challengeCloudError(error);
  return fromRow(data as GroupChallengeRow);
}

export async function respondToGroupChallenge(
  id: string,
  response: GroupChallengeResponse,
) {
  if (!supabase) throw new Error("Sign in to answer a shared challenge.");
  const { data, error } = await supabase.rpc("respond_group_challenge", {
    p_challenge_id: id,
    p_accept: response === "accepted",
  });
  if (error) throw challengeCloudError(error);
  return fromRow(data as GroupChallengeRow);
}

async function sendChallengePush(input: {
  challenge: GroupChallenge;
  eventKey: string;
  recipientId?: string;
  event: "started" | "accepted";
  title: string;
  body: string;
}) {
  if (!supabase) return;
  const { error } = await supabase.functions.invoke("send-push", {
    body: {
      eventKey: input.eventKey,
      groupId: input.challenge.groupId,
      category: "challenge",
      audience: "user",
      recipientId: input.recipientId,
      title: input.title,
      body: input.body,
      data: {
        route: "/group",
        groupId: input.challenge.groupId,
        challengeId: input.challenge.id,
        challengeEvent: input.event,
      },
    },
  });
  if (error) throw error;
}

export async function sendGroupChallengeStartedPush(
  challenge: GroupChallenge,
) {
  // One authenticated edge invocation fans out only to the server-verified
  // invite list. This stays O(1) in client/network work for large groups.
  await sendChallengePush({
    challenge,
    eventKey: `challenge-started:${challenge.id}`,
    event: "started",
    title: "Challenge started",
    body: "Open HabHub to accept or decline.",
  });
}

export async function sendGroupChallengeAcceptedPush(
  challenge: GroupChallenge,
  acceptingUserId: string,
) {
  await sendChallengePush({
    challenge,
    eventKey: `challenge-accepted:${challenge.id}:${acceptingUserId}`,
    recipientId: challenge.creatorId,
    event: "accepted",
    title: "Challenge accepted",
    body: "A friend accepted your challenge.",
  });
}

export async function deleteGroupChallenge(id: string) {
  if (!supabase) throw new Error("Sign in to delete a shared challenge.");
  const { error } = await supabase.rpc("delete_group_challenge", {
    p_challenge_id: id,
  });
  if (error) throw challengeCloudError(error);
}
