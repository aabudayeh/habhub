import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/src/lib/supabase";

type BroadcastEnvelope = { payload?: Record<string, unknown> };
type BroadcastListener = (payload: Record<string, unknown>) => void;

type SharedSubscription = {
  channel: RealtimeChannel;
  listeners: Set<BroadcastListener>;
};

const subscriptions = new Map<string, SharedSubscription>();

/**
 * Shares one private Realtime Broadcast channel between every mounted consumer
 * of the same topic/event. This avoids duplicate socket channels when a tab
 * remains mounted behind a detail route, while carrying no canonical row data.
 */
export function subscribePrivateBroadcast(
  topic: string,
  event: string,
  listener: BroadcastListener,
) {
  if (!supabase) return () => undefined;
  const client = supabase;
  const key = `${topic}\u0000${event}`;
  let shared = subscriptions.get(key);
  if (!shared) {
    const listeners = new Set<BroadcastListener>();
    const channel = client
      .channel(topic, {
        config: { private: true, broadcast: { self: false } },
      })
      .on("broadcast", { event }, (envelope: BroadcastEnvelope) => {
        const payload = envelope.payload ?? {};
        for (const current of [...listeners]) current(payload);
      })
      .subscribe();
    shared = { channel, listeners };
    subscriptions.set(key, shared);
  }
  shared.listeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const current = subscriptions.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    subscriptions.delete(key);
    client.removeChannel(current.channel).catch(() => undefined);
  };
}
