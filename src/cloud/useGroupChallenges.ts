import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  deleteGroupChallenge,
  loadActiveGroupChallenges,
  loadGroupChallenges,
  respondToGroupChallenge,
  saveGroupChallenge,
  sendGroupChallengeAcceptedPush,
  sendGroupChallengeStartedPush,
  GroupChallengeResponse,
  SaveGroupChallengeInput,
} from "@/src/cloud/groupChallenges";
import { groupChallengeSourceId } from "@/src/domain/groupChallenges";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { GroupChallenge } from "@/src/types";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";

type UseGroupChallengesOptions = {
  /** Group-settings discovery only; never use this for Leaderboard history. */
  discoverActive?: boolean;
};

/** A small, screen-scoped read model; realtime bursts coalesce into one request. */
export function useGroupChallenges(
  groupId: string,
  options: UseGroupChallengesOptions = {},
) {
  const tutorial = useTutorialSandbox();
  const { state } = useApp();
  const discoverActive = options.discoverActive === true;
  // Leaderboard stays mounted underneath the member comparison route. Give
  // every mounted hook its own Realtime topic so Supabase never reuses an
  // already-subscribed channel and rejects a second `.on(...)` callback.
  const subscriberId = useId();
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const challengesRef = useRef<GroupChallenge[]>([]);
  challengesRef.current = challenges;
  const requestRef = useRef<Promise<void> | null>(null);
  const trailingRefreshRef = useRef(false);
  const refreshRunnerRef = useRef<() => void>(() => undefined);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const refresh = useCallback(() => {
    if (tutorial.active) {
      setChallenges(
        (tutorial.bundle?.groupChallenges ?? []).filter(
          (challenge) => challenge.groupId === groupId,
        ),
      );
      setError(undefined);
      return Promise.resolve();
    }
    if (!isCloudGroupId(groupId) || !supabase) {
      setChallenges([]);
      setError(undefined);
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = (
      discoverActive ? loadActiveGroupChallenges : loadGroupChallenges
    )(groupId)
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
  }, [discoverActive, groupId, tutorial.active, tutorial.bundle]);
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
    if (
      !discoverActive ||
      tutorial.active ||
      !supabase ||
      !isCloudGroupId(groupId)
    )
      return;
    // Non-participants cannot subscribe directly to participant-scoped table
    // changes. Keep the small discovery list fresh without widening RLS or
    // changing the Leaderboard's normal realtime/read path.
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [discoverActive, groupId, refresh, tutorial.active]);

  useEffect(() => {
    if (tutorial.active || !supabase || !isCloudGroupId(groupId)) return;
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
  }, [groupId, refresh, subscriberId, tutorial.active]);

  const save = useCallback(async (input: SaveGroupChallengeInput) => {
    if (tutorial.active) {
      const now = new Date().toISOString();
      const saved: GroupChallenge = {
        id: input.id ?? `tutorial-challenge-${Date.now()}`,
        groupId: input.groupId,
        creatorId: state.currentUserId,
        metricId: input.metricId,
        title: input.title?.trim() || undefined,
        target: input.target,
        localDate: input.localDate,
        endDate: input.endDate ?? input.localDate,
        participantIds: [...new Set(input.participantIds)],
        acceptedParticipantIds: [state.currentUserId],
        declinedParticipantIds: [],
        recurrence: input.recurrence,
        createdAt: now,
        updatedAt: now,
      };
      setChallenges((current) => [
        saved,
        ...current.filter((challenge) => challenge.id !== saved.id),
      ]);
      return saved;
    }
    const isNew = !input.id;
    const saved = await saveGroupChallenge(input);
    if (groupIdRef.current === saved.groupId)
      setChallenges((current) => [
        saved,
        ...current.filter((challenge) => challenge.id !== saved.id),
      ]);
    if (isNew)
      await sendGroupChallengeStartedPush(saved).catch(() => undefined);
    return saved;
  }, [state.currentUserId, tutorial.active]);

  const respond = useCallback(async (
    id: string,
    response: GroupChallengeResponse,
  ) => {
    const sourceId =
      challengesRef.current.find((challenge) => challenge.id === id)
        ?.sourceChallengeId ?? id;
    if (tutorial.active) {
      let saved: GroupChallenge | undefined;
      setChallenges((current) =>
        current.map((challenge) => {
          if (groupChallengeSourceId(challenge) !== sourceId) return challenge;
          const accepted = new Set(challenge.acceptedParticipantIds ?? []);
          const declined = new Set(challenge.declinedParticipantIds ?? []);
          if (response === "accepted") {
            accepted.add(state.currentUserId);
            declined.delete(state.currentUserId);
          } else {
            declined.add(state.currentUserId);
            accepted.delete(state.currentUserId);
          }
          saved = {
            ...challenge,
            participantIds:
              response === "accepted"
                ? [...new Set([
                    ...challenge.participantIds,
                    state.currentUserId,
                  ])]
                : challenge.participantIds,
            acceptedParticipantIds: [...accepted],
            declinedParticipantIds: [...declined],
            updatedAt: new Date().toISOString(),
          };
          return saved;
        }),
      );
      return saved;
    }
    const saved = await respondToGroupChallenge(sourceId, response);
    if (groupIdRef.current === saved.groupId)
      setChallenges((current) => [
        saved,
        ...current.filter(
          (challenge) => groupChallengeSourceId(challenge) !== saved.id,
        ),
      ]);
    if (response === "accepted")
      await sendGroupChallengeAcceptedPush(
        saved,
        state.currentUserId,
      ).catch(() => undefined);
    return saved;
  }, [state.currentUserId, tutorial.active]);

  const remove = useCallback(async (id: string) => {
    const sourceId =
      challengesRef.current.find((challenge) => challenge.id === id)
        ?.sourceChallengeId ?? id;
    if (!tutorial.active) await deleteGroupChallenge(sourceId);
    setChallenges((current) =>
      current.filter(
        (challenge) => groupChallengeSourceId(challenge) !== sourceId,
      ),
    );
  }, [tutorial.active]);

  return { challenges, loading, error, refresh, save, respond, remove };
}
