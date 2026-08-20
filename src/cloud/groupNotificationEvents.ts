import { supabase } from "@/src/lib/supabase";
import { GroupNotificationEvent } from "@/src/types";

type GroupNotificationEventRow = {
  id: string;
  event_key: string;
  group_id: string;
  recipient_id: string;
  actor_id: string;
  event_type: GroupNotificationEvent["kind"];
  challenge_id: string;
  created_at: string;
  read_at: string | null;
};

function fromRow(row: GroupNotificationEventRow): GroupNotificationEvent {
  return {
    id: row.id,
    eventKey: row.event_key,
    groupId: row.group_id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    kind: row.event_type,
    challengeId: row.challenge_id,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

function notificationCloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value),
      )
      .join(" · ");
    if (message) return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function loadGroupNotificationEvents(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_notification_events")
    .select(
      "id, event_key, group_id, recipient_id, actor_id, event_type, challenge_id, created_at, read_at",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw notificationCloudError(error);
  return (data as GroupNotificationEventRow[] | null)?.map(fromRow) ?? [];
}

export async function markGroupNotificationEventsRead(
  groupId: string,
  eventIds: string[],
) {
  if (!supabase || eventIds.length === 0) return;
  const { error } = await supabase.rpc("mark_group_notification_events_read", {
    p_group_id: groupId,
    p_event_ids: [...new Set(eventIds)],
  });
  if (error) throw notificationCloudError(error);
}
