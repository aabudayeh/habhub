import { Platform } from "react-native";

import { createLatestAsyncDrain } from "@/src/domain/latestAsyncDrain";
import { supabase } from "@/src/lib/supabase";
import { planWebReminderSchedule } from "@/src/notifications/webReminderSchedule";
import type { AppState } from "@/src/types";

const lastAcceptedSignature = new Map<string, string>();

async function syncNow(state: AppState) {
  if (Platform.OS !== "web" || !supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== state.currentUserId) return;
  const events = planWebReminderSchedule(state);
  const signature = JSON.stringify(events);
  if (lastAcceptedSignature.get(state.currentUserId) === signature) return;
  const { error } = await supabase.rpc("replace_own_web_notification_schedule", {
    p_expected_user_id: state.currentUserId,
    p_events: events,
  });
  if (error) throw error;
  lastAcceptedSignature.set(state.currentUserId, signature);
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
  lastAcceptedSignature.delete(userId);
}
