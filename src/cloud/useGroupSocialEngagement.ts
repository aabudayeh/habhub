import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addGroupSocialComment,
  deleteGroupSocialComment,
  GroupSocialComment,
  GroupSocialReaction,
  GroupSocialReactionKind,
  GroupSocialTarget,
  loadGroupSocialEngagement,
  saveGroupSocialReaction,
} from "@/src/cloud/groupSocial";
import {
  flushPendingGroupPushEvents,
  isCloudGroupId,
} from "@/src/cloud/groupCloud";
import { subscribePrivateBroadcast } from "@/src/cloud/privateBroadcast";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";

function targetKey(target: GroupSocialTarget) {
  return `${target.type}\u0000${target.id}`;
}

/**
 * One bounded engagement model shared by recap cards and Leaderboard logs.
 * The hook never fetches target content; callers must already possess the
 * privacy-authorized item before including its id in `targets`.
 */
export function useGroupSocialEngagement(
  groupId: string,
  targets: readonly GroupSocialTarget[],
) {
  const { state } = useApp();
  const tutorial = useTutorialSandbox();
  const stableTargets = useMemo(
    () =>
      [...targets]
        .filter((target) => Boolean(target.id))
        .sort((left, right) => targetKey(left).localeCompare(targetKey(right))),
    // A compact semantic key avoids refetching merely because a feed rebuild
    // produced a new array with the same authorized item identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets.map(targetKey).sort().join("|")],
  );
  const [reactions, setReactions] = useState<GroupSocialReaction[]>([]);
  const [comments, setComments] = useState<GroupSocialComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const cloudEnabled =
    !tutorial.active && Boolean(supabase) && isCloudGroupId(groupId);

  const refresh = useCallback(() => {
    if (!cloudEnabled || !stableTargets.length) {
      setLoading(false);
      setError(undefined);
      if (!stableTargets.length) {
        setReactions([]);
        setComments([]);
      }
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = loadGroupSocialEngagement(groupId, stableTargets)
      .then((next) => {
        setReactions(next.reactions);
        setComments(next.comments);
        setError(undefined);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, [cloudEnabled, groupId, stableTargets]);

  useEffect(() => {
    requestRef.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cloudEnabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `group:${groupId}:social`,
      "social_updated",
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 160);
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [cloudEnabled, groupId, refresh]);

  const react = useCallback(
    async (target: GroupSocialTarget, reaction: GroupSocialReactionKind) => {
      const existing = reactions.find(
        (item) =>
          item.userId === state.currentUserId &&
          item.targetType === target.type &&
          item.targetId === target.id,
      );
      const nextReaction = existing?.reaction === reaction ? undefined : reaction;
      const before = reactions;
      const now = new Date().toISOString();
      setReactions((current) => [
        ...current.filter(
          (item) =>
            !(
              item.userId === state.currentUserId &&
              item.targetType === target.type &&
              item.targetId === target.id
            ),
        ),
        ...(nextReaction
          ? [
              {
                groupId,
                targetType: target.type,
                targetId: target.id,
                userId: state.currentUserId,
                reaction: nextReaction,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
              } satisfies GroupSocialReaction,
            ]
          : []),
      ]);
      if (!cloudEnabled) return;
      try {
        await saveGroupSocialReaction({
          groupId,
          target,
          userId: state.currentUserId,
          reaction: nextReaction,
        });
        // The database trigger owns recipient/copy/privacy and creates the
        // canonical outbox row. This merely asks the existing bounded drain to
        // deliver it; failures remain durable for the next foreground pass.
        void flushPendingGroupPushEvents().catch(() => undefined);
      } catch (reason) {
        setReactions(before);
        throw reason;
      }
    },
    [cloudEnabled, groupId, reactions, state.currentUserId],
  );

  const comment = useCallback(
    async (target: GroupSocialTarget, content: string) => {
      if (!content.trim()) return;
      if (!cloudEnabled) {
        const now = new Date().toISOString();
        setComments((current) => [
          ...current,
          {
            id: `local-comment-${Date.now().toString(36)}`,
            groupId,
            targetType: target.type,
            targetId: target.id,
            userId: state.currentUserId,
            content: content.trim(),
            createdAt: now,
            updatedAt: now,
          },
        ]);
        return;
      }
      const saved = await addGroupSocialComment({
        groupId,
        target,
        userId: state.currentUserId,
        content,
      });
      setComments((current) => [...current, saved]);
    },
    [cloudEnabled, groupId, state.currentUserId],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const before = comments;
      setComments((current) => current.filter((item) => item.id !== commentId));
      if (!cloudEnabled) return;
      try {
        await deleteGroupSocialComment(commentId);
      } catch (reason) {
        setComments(before);
        throw reason;
      }
    },
    [cloudEnabled, comments],
  );

  const reactionsByTarget = useMemo(() => {
    const map = new Map<string, GroupSocialReaction[]>();
    for (const reaction of reactions) {
      const key = targetKey({ type: reaction.targetType, id: reaction.targetId });
      map.set(key, [...(map.get(key) ?? []), reaction]);
    }
    return map;
  }, [reactions]);
  const commentsByTarget = useMemo(() => {
    const map = new Map<string, GroupSocialComment[]>();
    for (const item of comments) {
      const key = targetKey({ type: item.targetType, id: item.targetId });
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [comments]);

  return {
    reactions,
    comments,
    reactionsByTarget,
    commentsByTarget,
    loading,
    error,
    refresh,
    react,
    comment,
    removeComment,
    targetKey,
  };
}
