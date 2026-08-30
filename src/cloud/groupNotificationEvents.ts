import { supabase } from "@/src/lib/supabase";
import { GroupNotificationEvent } from "@/src/types";

type GroupNotificationEventRow = {
  id: string;
  event_key: string;
  group_id: string;
  recipient_id: string;
  actor_id: string;
  event_type: GroupNotificationEvent["kind"];
  challenge_id: string | null;
  occurrence_date: string | null;
  target_type: GroupNotificationEvent["targetType"] | null;
  target_id: string | null;
  reaction: GroupNotificationEvent["reaction"] | null;
  interaction_surface?: GroupNotificationEvent["interactionSurface"] | null;
  title: string | null;
  detail: string | null;
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
    challengeId: row.challenge_id ?? undefined,
    occurrenceDate: row.occurrence_date ?? undefined,
    title: row.title?.trim() || undefined,
    detail: row.detail?.trim() || undefined,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    reaction: row.reaction ?? undefined,
    interactionSurface: row.interaction_surface ?? undefined,
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
  const current = await supabase
    .from("group_notification_events")
    .select(
      "id, event_key, group_id, recipient_id, actor_id, event_type, challenge_id, occurrence_date, target_type, target_id, reaction, interaction_surface, title, detail, created_at, read_at",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    // Match the bounded 30-day celebration scan so frequent reminder events
    // cannot push an unseen canonical result out of the local settlement view.
    .limit(500);
  let data: unknown = current.data;
  let error = current.error;
  if (error && missingInteractionSurfaceColumn(error)) {
    const legacy = await supabase
      .from("group_notification_events")
      .select(
        "id, event_key, group_id, recipient_id, actor_id, event_type, challenge_id, occurrence_date, target_type, target_id, reaction, title, detail, created_at, read_at",
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(500);
    data = legacy.data;
    error = legacy.error;
  }
  if (error) throw notificationCloudError(error);
  return (data as GroupNotificationEventRow[] | null)?.map(fromRow) ?? [];
}

function missingInteractionSurfaceColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = [row.message, row.details, row.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    row.code === "42703" ||
    /interaction_surface.*(?:does not exist|schema cache|could not find)/i.test(
      message,
    )
  );
}

/** Account bell feed. RLS still limits rows to the authenticated recipient and
 * either an active group membership or an explicitly joined public challenge. */
export async function loadAccountNotificationEvents() {
  if (!supabase) return [];
  const current = await supabase
    .from("group_notification_events")
    .select(
      "id, event_key, group_id, recipient_id, actor_id, event_type, challenge_id, occurrence_date, target_type, target_id, reaction, interaction_surface, title, detail, created_at, read_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  let data: unknown = current.data;
  let error = current.error;
  if (error && missingInteractionSurfaceColumn(error)) {
    const legacy = await supabase
      .from("group_notification_events")
      .select(
        "id, event_key, group_id, recipient_id, actor_id, event_type, challenge_id, occurrence_date, target_type, target_id, reaction, title, detail, created_at, read_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    data = legacy.data;
    error = legacy.error;
  }
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
