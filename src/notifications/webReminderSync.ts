import { Platform } from "react-native";

import { createLatestAsyncDrain } from "@/src/domain/latestAsyncDrain";
import { supabase } from "@/src/lib/supabase";
import { planWebReminderSchedule } from "@/src/notifications/webReminderSchedule";
import type { AppState } from "@/src/types";

const WEB_REMINDER_SCHEDULE_REPAIR_MS = 10 * 60 * 1000;

type AcceptedSchedule = {
  acceptedAt: number;
  signature: string;
};

const lastAcceptedSchedule = new Map<string, AcceptedSchedule>();

async function syncNow(state: AppState) {
  if (Platform.OS !== "web" || !supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session)
    throw new Error("The signed-in Web session is not ready for reminder sync.");
  if (data.session.user.id !== state.currentUserId)
    throw new Error("The signed-in account changed during reminder sync.");
  const events = planWebReminderSchedule(state);
  const signature = JSON.stringify(events);
  const prior = lastAcceptedSchedule.get(state.currentUserId);
  if (
    prior?.signature === signature &&
    Date.now() - prior.acceptedAt < WEB_REMINDER_SCHEDULE_REPAIR_MS
  )
    return;
  const { data: acceptedCount, error } = await supabase.rpc(
    "replace_own_web_notification_schedule",
    {
      p_expected_user_id: state.currentUserId,
      p_events: events,
    },
  );
  if (error) throw error;
  if (Number(acceptedCount) !== events.length)
    throw new Error("The Web reminder schedule was not fully accepted.");
  // A periodically renewed acknowledgement repairs rows removed by a
  // transient backend cleanup or an interrupted rollout even when the local
  // reminder definitions did not change. It also avoids a foreground request
  // storm while the user moves between routes.
  lastAcceptedSchedule.set(state.currentUserId, {
    acceptedAt: Date.now(),
    signature,
  });
}

const drain = createLatestAsyncDrain<AppState>(syncNow);

export function syncWebReminderSchedule(state: AppState) {
  if (Platform.OS !== "web") return Promise.resolve();
  return drain(state);
}

export async function clearWebReminderSchedule(userId: string) {
  if (Platform.OS !== "web" || !supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId) return;
  const { error } = await supabase.rpc("replace_own_web_notification_schedule", {
    p_expected_user_id: userId,
    p_events: [],
  });
  if (error) throw error;
  lastAcceptedSchedule.delete(userId);
}
