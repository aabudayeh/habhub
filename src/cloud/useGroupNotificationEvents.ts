import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  loadGroupNotificationEvents,
  markGroupNotificationEventsRead,
} from "@/src/cloud/groupNotificationEvents";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { supabase } from "@/src/lib/supabase";
import { GroupNotificationEvent } from "@/src/types";

/** Recipient-scoped, RLS-protected read model for the Leaderboard bell. */
export function useGroupNotificationEvents(groupId: string) {
  const subscriberId = useId();
  const [events, setEvents] = useState<GroupNotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const refresh = useCallback(() => {
    if (!isCloudGroupId(groupId) || !supabase) {
      setEvents([]);
      setError(undefined);
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = loadGroupNotificationEvents(groupId)
      .then((rows) => {
        if (groupIdRef.current !== groupId) return;
        setEvents(rows);
        setError(undefined);
      })
      .catch((reason) => {
        if (groupIdRef.current !== groupId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        if (groupIdRef.current === groupId) setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, [groupId]);

  useEffect(() => {
    requestRef.current = null;
    setEvents([]);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !isCloudGroupId(groupId)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`group-notification-events:${groupId}:${subscriberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_notification_events",
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refresh(), 120);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [groupId, refresh, subscriberId]);

  const markRead = useCallback(
    async (eventIds: string[]) => {
      const ids = [...new Set(eventIds)];
      if (!ids.length) return;
      await markGroupNotificationEventsRead(groupId, ids);
      const readAt = new Date().toISOString();
      const idSet = new Set(ids);
      setEvents((current) =>
        current.map((event) =>
          idSet.has(event.id) && !event.readAt
            ? { ...event, readAt }
            : event,
        ),
      );
    },
    [groupId],
  );

  const unreadCount = useMemo(
    () => events.filter((event) => !event.readAt).length,
    [events],
  );

  return { events, unreadCount, loading, error, refresh, markRead };
}
