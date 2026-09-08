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
import { useUserSafety } from "@/src/safety/userSafety";

function isUserAuthoredGroupEvent(event: GroupNotificationEvent) {
  return (
    event.kind === "social_reaction" ||
    event.kind === "social_comment" ||
    event.kind === "group_todo_completed" ||
    event.kind === "group_todo_all_completed" ||
    event.kind === "group_note_created" ||
    event.kind === "group_note_updated" ||
    event.kind === "group_schedule_created" ||
    event.kind === "group_schedule_updated" ||
    event.kind === "group_schedule_reminder"
  );
}

function preferenceAllowsEvent(
  event: GroupNotificationEvent,
  preferences: GroupNotificationPreferences | undefined,
) {
  if (preferences?.enabled === false) return false;
  if (event.kind === "group_schedule_reminder") return preferences?.scheduleReminders === true;
  if (
    (event.kind === "social_reaction" || event.kind === "social_comment") &&
    preferences?.socialReactions === false
  )
    return false;
  if (
    (event.kind === "group_todo_completed" ||
      event.kind === "group_todo_all_completed") &&
    preferences?.todoUpdates === false
  )
    return false;
  if (
    (event.kind === "group_note_created" ||
      event.kind === "group_note_updated" ||
      event.kind === "group_schedule_created" ||
      event.kind === "group_schedule_updated") &&
    preferences?.workspaceUpdates === false
  )
    return false;
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
  const accountId =
    auth.status === "signedIn" && auth.user ? auth.user.id : undefined;
  const safety = useUserSafety(accountId ?? "signed-out");
  const blockedUsersKey = useMemo(
    () => [...safety.blockedUserIds].sort().join(","),
    [safety.blockedUserIds],
  );
  const scopeKey = `${accountId ?? "signed-out"}\u0000${groupId}`;
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    events: GroupNotificationEvent[];
    loading: boolean;
    loaded: boolean;
    error?: string;
  }>(() => ({
    scopeKey,
    events: [],
    loading: false,
    loaded: false,
  }));
  const currentSnapshot =
    snapshot.scopeKey === scopeKey
      ? snapshot
      : {
          scopeKey,
          events: [] as GroupNotificationEvent[],
          loading: Boolean(accountId),
          loaded: false,
          error: undefined,
        };
  const requestRef = useRef<{
    scopeKey: string;
    promise: Promise<void>;
  } | null>(null);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const refresh = useCallback(() => {
    if (!accountId || !isCloudGroupId(groupId) || !supabase) {
      setSnapshot({
        scopeKey,
        events: [],
        loading: false,
        loaded: true,
        error: undefined,
      });
      return Promise.resolve();
    }
    if (requestRef.current?.scopeKey === scopeKey)
      return requestRef.current.promise;
    let request: Promise<void>;
    setSnapshot((current) => ({
      scopeKey,
      events: current.scopeKey === scopeKey ? current.events : [],
      loading: true,
      loaded: current.scopeKey === scopeKey && current.loaded,
      error: current.scopeKey === scopeKey ? current.error : undefined,
    }));
    request = loadGroupNotificationEvents(groupId)
      .then((rows) => {
        if (scopeRef.current !== scopeKey) return;
        setSnapshot({
          scopeKey,
          events: rows,
          loading: true,
          loaded: false,
          error: undefined,
        });
      })
      .catch((reason) => {
        if (scopeRef.current !== scopeKey) return;
        setSnapshot((current) => ({
          scopeKey,
          events: current.scopeKey === scopeKey ? current.events : [],
          loading: true,
          loaded: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      })
      .finally(() => {
        if (requestRef.current?.promise === request) requestRef.current = null;
        if (scopeRef.current !== scopeKey) return;
        setSnapshot((current) => ({
          scopeKey,
          events: current.scopeKey === scopeKey ? current.events : [],
          loading: false,
          loaded: true,
          error: current.scopeKey === scopeKey ? current.error : undefined,
        }));
      });
    requestRef.current = { scopeKey, promise: request };
    return request;
  }, [accountId, groupId, scopeKey]);

  useEffect(() => {
    if (requestRef.current?.scopeKey !== scopeKey) requestRef.current = null;
    setSnapshot({
      scopeKey,
      events: [],
      loading: Boolean(accountId),
      loaded: false,
      error: undefined,
    });
    void refresh();
  }, [accountId, refresh, scopeKey]);

  useEffect(() => {
    if (safety.hydrated) void refresh();
  }, [blockedUsersKey, refresh, safety.hydrated]);

  useEffect(() => {
    if (!supabase || !accountId || !isCloudGroupId(groupId)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `account:${accountId}:group-notifications`,
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
  }, [accountId, groupId, refresh]);

  const markRead = useCallback(
    async (eventIds: string[]) => {
      const ids = [...new Set(eventIds)];
      if (!accountId || !ids.length || scopeRef.current !== scopeKey) return;
      const operationScope = scopeKey;
      await markGroupNotificationEventsRead(groupId, ids);
      if (scopeRef.current !== operationScope) return;
      const readAt = new Date().toISOString();
      const idSet = new Set(ids);
      setSnapshot((current) =>
        current.scopeKey !== operationScope
          ? current
          : {
              ...current,
              events: current.events.map((event) =>
                idSet.has(event.id) && !event.readAt
                  ? { ...event, readAt }
                  : event,
              ),
            },
      );
    },
    [accountId, groupId, scopeKey],
  );

  const privacyScopedEvents = useMemo(
    () =>
      currentSnapshot.events.filter(
        (event) =>
          (!isUserAuthoredGroupEvent(event) ||
            (safety.hydrated &&
              !safety.blockedUserIds.has(event.actorId))),
      ),
    [
      currentSnapshot.events,
      safety.blockedUserIds,
      safety.hydrated,
    ],
  );
  const visibleEvents = useMemo(
    () =>
      privacyScopedEvents.filter((event) =>
        preferenceAllowsEvent(event, preferences),
      ),
    [preferences, privacyScopedEvents],
  );
  const unreadCount = useMemo(
    () => visibleEvents.filter((event) => !event.readAt).length,
    [visibleEvents],
  );
  const loaded = currentSnapshot.loaded;

  return {
    /** Recipient-scoped canonical rows, including muted but never blocked content. */
    allEvents: privacyScopedEvents,
    events: visibleEvents,
    unreadCount,
    loading: currentSnapshot.loading,
    loaded,
    markRead,
    loadedGroupId: loaded ? groupId : undefined,
    error: currentSnapshot.error,
    refresh,
  };
}
