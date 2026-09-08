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
  const accountId =
    auth.status === "signedIn" && auth.user ? auth.user.id : undefined;
  const scopeKey = accountId ?? "signed-out";
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
    if (!supabase || !accountId) {
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
    request = loadAccountNotificationEvents()
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
  }, [accountId, scopeKey]);

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
    if (!supabase || !accountId) return;
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
  }, [accountId, refresh]);

  const markRead = useCallback(async (eventIds: string[]) => {
    const idSet = new Set(eventIds);
    if (!accountId || !idSet.size || scopeRef.current !== scopeKey) return;
    const operationScope = scopeKey;
    const operationEvents = currentSnapshot.events;
    const readAt = new Date().toISOString();
    // The category dot should clear as soon as the user leaves the tab they
    // actually viewed. Keep the network write durable, but do not make the UI
    // wait on a round trip before acknowledging that deliberate boundary.
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
    const byGroup = new Map<string, string[]>();
    for (const event of operationEvents) {
      if (!idSet.has(event.id)) continue;
      const ids = byGroup.get(event.groupId) ?? [];
      ids.push(event.id);
      byGroup.set(event.groupId, ids);
    }
    try {
      await Promise.all(
        [...byGroup].map(([groupId, ids]) =>
          markGroupNotificationEventsRead(groupId, ids),
        ),
      );
    } catch (reason) {
      if (scopeRef.current !== operationScope) throw reason;
      // Restore only this optimistic acknowledgement. A concurrent realtime
      // refresh that supplied a different server read timestamp remains read.
      setSnapshot((current) =>
        current.scopeKey !== operationScope
          ? current
          : {
              ...current,
              events: current.events.map((event) =>
                idSet.has(event.id) && event.readAt === readAt
                  ? { ...event, readAt: undefined }
                  : event,
              ),
            },
      );
      throw reason;
    }
  }, [accountId, currentSnapshot.events, scopeKey]);

  const unreadCount = useMemo(
    () => currentSnapshot.events.filter((event) => !event.readAt).length,
    [currentSnapshot.events],
  );

  return {
    events: currentSnapshot.events,
    unreadCount,
    loading: currentSnapshot.loading,
    loaded: currentSnapshot.loaded,
    error: currentSnapshot.error,
    refresh,
    markRead,
  };
}
