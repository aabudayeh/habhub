import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/src/auth/AuthProvider";
import {
  loadAccountNotificationEvents,
  markGroupNotificationEventsRead,
} from "@/src/cloud/groupNotificationEvents";
import { subscribePrivateBroadcast } from "@/src/cloud/privateBroadcast";
import { supabase } from "@/src/lib/supabase";
import type { GroupNotificationEvent } from "@/src/types";

/** Bounded recipient feed across groups plus explicitly joined public events. */
export function useAccountNotificationEvents() {
  const auth = useAuth();
  const [events, setEvents] = useState<GroupNotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (!supabase || auth.status !== "signedIn") {
      setEvents([]);
      setLoaded(true);
      setError(undefined);
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = loadAccountNotificationEvents()
      .then((rows) => {
        setEvents(rows);
        setError(undefined);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
        setLoaded(true);
      });
    requestRef.current = request;
    return request;
  }, [auth.status]);

  useEffect(() => {
    requestRef.current = null;
    setEvents([]);
    setLoaded(false);
    void refresh();
  }, [auth.user?.id, refresh]);

  useEffect(() => {
    if (!supabase || auth.status !== "signedIn" || !auth.user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `account:${auth.user.id}:group-notifications`,
      "notifications_updated",
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 120);
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [auth.status, auth.user, refresh]);

  const markRead = useCallback(async (eventIds: string[]) => {
    const idSet = new Set(eventIds);
    if (!idSet.size) return;
    const byGroup = new Map<string, string[]>();
    for (const event of events) {
      if (!idSet.has(event.id)) continue;
      const ids = byGroup.get(event.groupId) ?? [];
      ids.push(event.id);
      byGroup.set(event.groupId, ids);
    }
    await Promise.all(
      [...byGroup].map(([groupId, ids]) =>
        markGroupNotificationEventsRead(groupId, ids),
      ),
    );
    const readAt = new Date().toISOString();
    setEvents((current) =>
      current.map((event) =>
        idSet.has(event.id) && !event.readAt
          ? { ...event, readAt }
          : event,
      ),
    );
  }, [events]);

  const unreadCount = useMemo(
    () => events.filter((event) => !event.readAt).length,
    [events],
  );

  return {
    events,
    unreadCount,
    loading,
    loaded,
    error,
    refresh,
    markRead,
  };
}
