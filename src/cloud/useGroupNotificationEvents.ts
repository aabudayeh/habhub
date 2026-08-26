import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadGroupNotificationEvents,
  markGroupNotificationEventsRead,
} from "@/src/cloud/groupNotificationEvents";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { supabase } from "@/src/lib/supabase";
import {
  GroupNotificationEvent,
  type GroupNotificationPreferences,
} from "@/src/types";
import { useAuth } from "@/src/auth/AuthProvider";
import { subscribePrivateBroadcast } from "@/src/cloud/privateBroadcast";

function preferenceAllowsEvent(
  event: GroupNotificationEvent,
  preferences: GroupNotificationPreferences | undefined,
) {
  if (preferences?.enabled === false) return false;
  if (
    (event.kind === "challenge_invitation" ||
      event.kind === "challenge_accepted" ||
      event.kind === "challenge_all_accepted") &&
    preferences?.challengeUpdates === false
  )
    return false;
  if (event.kind === "challenge_standing")
    return preferences?.challengeStandings !== false;
  if (event.kind === "challenge_reminder")
    return preferences?.challengeReminders !== false;
  if (event.kind === "challenge_result")
    return preferences?.challengeResults !== false;
  return true;
}

/** Recipient-scoped, RLS-protected read model for the Leaderboard bell. */
export function useGroupNotificationEvents(
  groupId: string,
  preferences?: GroupNotificationPreferences,
) {
  const auth = useAuth();
  const [events, setEvents] = useState<GroupNotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedGroupId, setLoadedGroupId] = useState<string>();
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const refresh = useCallback(() => {
    if (!isCloudGroupId(groupId) || !supabase) {
      setEvents([]);
      setError(undefined);
      setLoaded(true);
      setLoadedGroupId(groupId);
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
        if (groupIdRef.current === groupId) {
          setLoading(false);
          setLoaded(true);
          setLoadedGroupId(groupId);
        }
      });
    requestRef.current = request;
    return request;
  }, [groupId]);

  useEffect(() => {
    requestRef.current = null;
    setEvents([]);
    setLoaded(false);
    setLoadedGroupId(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !isCloudGroupId(groupId)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (auth.status !== "signedIn" || !auth.user) return;
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
  }, [auth.status, auth.user, groupId, refresh]);

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

  const visibleEvents = useMemo(
    () => events.filter((event) => preferenceAllowsEvent(event, preferences)),
    [events, preferences],
  );
  const unreadCount = useMemo(
    () => visibleEvents.filter((event) => !event.readAt).length,
    [visibleEvents],
  );

  return {
    /** Recipient-scoped canonical rows, including locally muted categories. */
    allEvents: events,
    events: visibleEvents,
    unreadCount,
    loading,
    loaded,
    loadedGroupId,
    error,
    refresh,
    markRead,
  };
}
