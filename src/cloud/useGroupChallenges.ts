import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  deleteGroupChallenge,
  loadGroupChallenges,
  saveGroupChallenge,
  SaveGroupChallengeInput,
} from "@/src/cloud/groupChallenges";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { supabase } from "@/src/lib/supabase";
import { GroupChallenge } from "@/src/types";

/** A small, screen-scoped read model; realtime bursts coalesce into one request. */
export function useGroupChallenges(groupId: string) {
  // Leaderboard stays mounted underneath the member comparison route. Give
  // every mounted hook its own Realtime topic so Supabase never reuses an
  // already-subscribed channel and rejects a second `.on(...)` callback.
  const subscriberId = useId();
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const trailingRefreshRef = useRef(false);
  const refreshRunnerRef = useRef<() => void>(() => undefined);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const refresh = useCallback(() => {
    if (!isCloudGroupId(groupId) || !supabase) {
      setChallenges([]);
      setError(undefined);
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = loadGroupChallenges(groupId)
      .then((rows) => {
        if (groupIdRef.current !== groupId) return;
        setChallenges(rows);
        setError(undefined);
      })
      .catch((reason) => {
        if (groupIdRef.current !== groupId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        if (groupIdRef.current === groupId) setLoading(false);
        if (groupIdRef.current === groupId && trailingRefreshRef.current) {
          trailingRefreshRef.current = false;
          setTimeout(() => refreshRunnerRef.current(), 0);
        }
      });
    requestRef.current = request;
    return request;
  }, [groupId]);
  refreshRunnerRef.current = () => void refresh();

  useEffect(() => {
    // A previous group's request may still be settling. It is safely guarded
    // by groupIdRef, while the new workspace starts its own bounded read now.
    requestRef.current = null;
    trailingRefreshRef.current = false;
    setChallenges([]);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !isCloudGroupId(groupId)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (requestRef.current) {
          trailingRefreshRef.current = true;
          return;
        }
        void refresh();
      }, 180);
    };
    const channel = supabase
      .channel(`group-challenges:${groupId}:${subscriberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_challenges",
          filter: `group_id=eq.${groupId}`,
        },
        queueRefresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [groupId, refresh, subscriberId]);

  const save = useCallback(async (input: SaveGroupChallengeInput) => {
    const saved = await saveGroupChallenge(input);
    if (groupIdRef.current === saved.groupId)
      setChallenges((current) => [
        saved,
        ...current.filter((challenge) => challenge.id !== saved.id),
      ]);
    return saved;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteGroupChallenge(id);
    setChallenges((current) =>
      current.filter((challenge) => challenge.id !== id),
    );
  }, []);

  return { challenges, loading, error, refresh, save, remove };
}
