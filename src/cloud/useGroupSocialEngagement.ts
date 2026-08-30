import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  addGroupSocialComment,
  deleteGroupSocialComment,
  GroupSocialComment,
  GroupSocialReaction,
  GroupSocialReactionKind,
  GroupSocialTarget,
  isUnavailableGroupSocialTargetError,
  loadGroupSocialEngagement,
  resolveMetricEntrySocialTarget,
  saveGroupSocialReaction,
} from "@/src/cloud/groupSocial";
import {
  flushPendingGroupPushEvents,
  isCloudGroupId,
} from "@/src/cloud/groupCloud";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { subscribePrivateBroadcast } from "@/src/cloud/privateBroadcast";
import { supabase } from "@/src/lib/supabase";
import { scheduleResponsiveWork } from "@/src/lib/responsiveWork";
import {
  beginSocialReactionBurst,
  confirmSocialReactionBurst,
  finishSocialReactionBurst,
  groupSocialTargetKey,
  groupSocialTargetResolutionKey,
} from "@/src/domain/groupSocialTarget";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";

function targetKey(target: GroupSocialTarget) {
  return groupSocialTargetKey(target);
}

function persistedTargetKey(target: Pick<GroupSocialTarget, "type" | "id">) {
  return `${target.type}\u0000${target.id}`;
}

function reactionPersistedTargetKey(
  reaction: Pick<GroupSocialReaction, "targetType" | "targetId">,
) {
  return `${reaction.targetType}\u0000${reaction.targetId}`;
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
  const cloud = useCloudSyncActions();
  const tutorial = useTutorialSandbox();
  const stableTargets = useMemo(
    () =>
      [...targets]
        .filter((target) => Boolean(target.id))
        .sort((left, right) => targetKey(left).localeCompare(targetKey(right))),
    // A compact semantic key avoids refetching merely because a feed rebuild
    // produced a new array with the same authorized item identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets.map(groupSocialTargetResolutionKey).sort().join("|")],
  );
  const [reactions, setReactions] = useState<GroupSocialReaction[]>([]);
  const [comments, setComments] = useState<GroupSocialComment[]>([]);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const [targetAliases, setTargetAliases] = useState(new Map<string, string>());
  const targetAliasesRef = useRef(targetAliases);
  targetAliasesRef.current = targetAliases;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reactionsRef = useRef(reactions);
  reactionsRef.current = reactions;
  const requestRef = useRef<Promise<void> | null>(null);
  const requestGenerationRef = useRef(0);
  const reactionMutationGenerationRef = useRef(new Map<string, number>());
  const reactionWriteQueueRef = useRef(new Map<string, Promise<void>>());
  const confirmedReactionByMutationRef = useRef(
    new Map<string, GroupSocialReaction | undefined>(),
  );
  const activeGroupRef = useRef(groupId);
  activeGroupRef.current = groupId;
  const cloudEnabled =
    !tutorial.active && Boolean(supabase) && isCloudGroupId(groupId);

  const refresh = useCallback(() => {
    if (!cloudEnabled || !stableTargets.length) {
      setLoading(false);
      setError(undefined);
      if (!stableTargets.length) {
        reactionsRef.current = [];
        commentsRef.current = [];
        targetAliasesRef.current = new Map();
        setReactions([]);
        setComments([]);
        setTargetAliases(new Map());
      }
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    const generation = ++requestGenerationRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = loadGroupSocialEngagement(groupId, stableTargets)
      .then((next) => {
        if (requestGenerationRef.current !== generation) return;
        reactionsRef.current = next.reactions;
        setReactions(next.reactions);
        commentsRef.current = next.comments;
        setComments(next.comments);
        const aliases = new Map(
          next.resolvedTargets.map((resolved, index) => [
            targetKey(stableTargets[index]),
            persistedTargetKey(resolved),
          ]),
        );
        targetAliasesRef.current = aliases;
        setTargetAliases(aliases);
        setError(undefined);
      })
      .catch((reason) => {
        if (requestGenerationRef.current !== generation) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestGenerationRef.current !== generation) return;
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, [cloudEnabled, groupId, stableTargets]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    requestRef.current = null;
    const task =
      Platform.OS === "web"
        ? undefined
        : scheduleResponsiveWork(() => void refresh(), {
            minimumDelayMs: 180,
            maximumDelayMs: 2_000,
            minimumUserQuietMs: 650,
          });
    if (Platform.OS === "web") void refresh();
    return () => {
      task?.cancel();
      requestGenerationRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!cloudEnabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: ReturnType<typeof scheduleResponsiveWork> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `group:${groupId}:social`,
      "social_updated",
      () => {
        if (timer) clearTimeout(timer);
        task?.cancel();
        timer = setTimeout(() => {
          if (Platform.OS === "web") {
            void refresh();
            return;
          }
          task = scheduleResponsiveWork(() => void refresh(), {
            minimumDelayMs: 80,
            maximumDelayMs: 2_000,
            minimumUserQuietMs: 650,
          });
        }, 160);
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      task?.cancel();
      unsubscribe();
    };
  }, [cloudEnabled, groupId, refresh]);

  const mutationTarget = useCallback(
    async (target: GroupSocialTarget, forceRepair = false) => {
      if (!cloudEnabled || target.type !== "metric_entry") return target;
      if (
        target.ownerUserId === state.currentUserId &&
        (!target.cloudPublished || forceRepair)
      ) {
        // Only an owner may publish or repair their source row. A viewer may
        // resolve an already RLS-readable legacy id, but never writes it.
        await cloud.syncNow();
        if (target.localDate)
          await cloud.refreshActivity(target.localDate, { force: true });
      }
      const resolved = await resolveMetricEntrySocialTarget(groupId, target, {
        force: forceRepair || !target.cloudPublished,
      });
      if (!resolved)
        throw new Error("That shared item is no longer available.");
      return resolved;
    },
    [cloud, cloudEnabled, groupId, state.currentUserId],
  );

  const react = useCallback(
    async (target: GroupSocialTarget, reaction: GroupSocialReactionKind) => {
      const operationGroupId = groupId;
      const requestedTargetKey = targetKey(target);
      const knownPersistedKey = targetAliasesRef.current.get(requestedTargetKey);
      const targetIds = new Set([target.id]);
      const existing = reactionsRef.current.find(
        (item) =>
          item.userId === state.currentUserId &&
          item.targetType === target.type &&
          (targetIds.has(item.targetId) ||
            reactionPersistedTargetKey(item) === knownPersistedKey),
      );
      const nextReaction = existing?.reaction === reaction ? undefined : reaction;
      const before = reactionsRef.current;
      const now = new Date().toISOString();
      const mutationKey = `${operationGroupId}\u0000${requestedTargetKey}\u0000${state.currentUserId}`;
      if (
        cloudEnabled &&
        !reactionWriteQueueRef.current.has(mutationKey) &&
        !confirmedReactionByMutationRef.current.has(mutationKey)
      )
        // The first tap in a serialized burst starts from a server-loaded
        // value. Later taps must not replace this baseline with another tap's
        // unconfirmed optimistic value.
        beginSocialReactionBurst(
          confirmedReactionByMutationRef.current,
          mutationKey,
          existing,
        );
      const mutationGeneration =
        (reactionMutationGenerationRef.current.get(mutationKey) ?? 0) + 1;
      reactionMutationGenerationRef.current.set(
        mutationKey,
        mutationGeneration,
      );
      // Paint the choice before target repair/network work. Privacy remains
      // server-authorized by the RPC and any failure rolls this exact mutation
      // back, but the button itself now responds in the same frame as the tap.
      const optimistic = [
        ...before.filter(
          (item) =>
            !(
              item.userId === state.currentUserId &&
              item.targetType === target.type &&
              (targetIds.has(item.targetId) ||
                reactionPersistedTargetKey(item) === knownPersistedKey)
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
      ];
      reactionsRef.current = optimistic;
      setReactions(optimistic);
      if (!cloudEnabled) return;

      // Serialize writes for one target. Rapid taps still paint immediately,
      // while the database always receives the user's choices in tap order.
      const previousWrite = reactionWriteQueueRef.current.get(mutationKey) ??
        Promise.resolve();
      const write = previousWrite.catch(() => undefined).then(async () => {
        let resolvedTarget = await mutationTarget(target);
        if (activeGroupRef.current !== operationGroupId) return;
        const resolvedTargetKey = persistedTargetKey(resolvedTarget);
        targetIds.add(resolvedTarget.id);
        setTargetAliases((current) => {
          const next = new Map(current);
          next.set(requestedTargetKey, resolvedTargetKey);
          targetAliasesRef.current = next;
          return next;
        });
        if (
          reactionMutationGenerationRef.current.get(mutationKey) ===
          mutationGeneration
        ) {
          const normalized = reactionsRef.current.map((item) =>
            item.userId === state.currentUserId &&
            item.targetType === target.type &&
            item.targetId === target.id
              ? { ...item, targetId: resolvedTarget.id }
              : item,
          );
          reactionsRef.current = normalized;
          setReactions(normalized);
        }
        try {
          const saved = await saveGroupSocialReaction({
            groupId,
            target: resolvedTarget,
            userId: state.currentUserId,
            reaction: nextReaction,
          });
          confirmSocialReactionBurst(
            confirmedReactionByMutationRef.current,
            mutationKey,
            saved,
          );
        } catch (reason) {
          if (
            nextReaction &&
            target.type === "metric_entry" &&
            target.ownerUserId === state.currentUserId &&
            isUnavailableGroupSocialTargetError(reason)
          ) {
            resolvedTarget = await mutationTarget(target, true);
            const saved = await saveGroupSocialReaction({
              groupId,
              target: resolvedTarget,
              userId: state.currentUserId,
              reaction: nextReaction,
            });
            confirmSocialReactionBurst(
              confirmedReactionByMutationRef.current,
              mutationKey,
              saved,
            );
          } else throw reason;
        }
      });
      reactionWriteQueueRef.current.set(mutationKey, write);
      try {
        await write;
        // The database trigger owns recipient/copy/privacy and creates the
        // canonical outbox row. This merely asks the existing bounded drain to
        // deliver it; failures remain durable for the next foreground pass.
        void flushPendingGroupPushEvents().catch(() => undefined);
      } catch (reason) {
        if (
          activeGroupRef.current === operationGroupId &&
          reactionMutationGenerationRef.current.get(mutationKey) ===
            mutationGeneration
        ) {
          const confirmed =
            confirmedReactionByMutationRef.current.get(mutationKey);
          const rolledBack = [
            ...reactionsRef.current.filter(
              (item) =>
                !(
                  item.userId === state.currentUserId &&
                  item.targetType === target.type &&
                  (targetIds.has(item.targetId) ||
                    reactionPersistedTargetKey(item) === knownPersistedKey)
                ),
            ),
            ...(confirmed ? [confirmed] : []),
          ];
          reactionsRef.current = rolledBack;
          setReactions(rolledBack);
        }
        throw reason;
      } finally {
        if (reactionWriteQueueRef.current.get(mutationKey) === write)
          reactionWriteQueueRef.current.delete(mutationKey);
        if (!reactionWriteQueueRef.current.has(mutationKey))
          finishSocialReactionBurst(
            confirmedReactionByMutationRef.current,
            mutationKey,
          );
      }
    },
    [
      cloudEnabled,
      groupId,
      mutationTarget,
      state.currentUserId,
    ],
  );

  const comment = useCallback(
    async (target: GroupSocialTarget, content: string) => {
      if (!content.trim()) return;
      const operationGroupId = groupId;
      const now = new Date().toISOString();
      const pendingId = `local-comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const pending: GroupSocialComment = {
        id: pendingId,
        groupId,
        targetType: target.type,
        targetId: target.id,
        userId: state.currentUserId,
        content: content.trim(),
        createdAt: now,
        updatedAt: now,
      };
      commentsRef.current = [...commentsRef.current, pending];
      setComments(commentsRef.current);
      if (!cloudEnabled) return;
      let resolvedTarget: GroupSocialTarget;
      try {
        resolvedTarget = await mutationTarget(target);
      } catch (reason) {
        commentsRef.current = commentsRef.current.filter(
          (item) => item.id !== pendingId,
        );
        setComments(commentsRef.current);
        throw reason;
      }
      if (activeGroupRef.current !== operationGroupId) return;
      const requestedTargetKey = targetKey(target);
      const resolvedTargetKey = persistedTargetKey(resolvedTarget);
      setTargetAliases((current) => {
        const next = new Map(current);
        next.set(requestedTargetKey, resolvedTargetKey);
        targetAliasesRef.current = next;
        return next;
      });
      try {
        let saved: Awaited<ReturnType<typeof addGroupSocialComment>>;
        try {
          saved = await addGroupSocialComment({
            groupId,
            target: resolvedTarget,
            userId: state.currentUserId,
            content,
          });
        } catch (reason) {
          if (
            target.type === "metric_entry" &&
            target.ownerUserId === state.currentUserId &&
            isUnavailableGroupSocialTargetError(reason)
          ) {
            resolvedTarget = await mutationTarget(target, true);
            saved = await addGroupSocialComment({
              groupId,
              target: resolvedTarget,
              userId: state.currentUserId,
              content,
            });
          } else throw reason;
        }
        if (activeGroupRef.current === operationGroupId) {
          commentsRef.current = commentsRef.current.map((item) =>
            item.id === pendingId ? saved : item,
          );
          setComments(commentsRef.current);
        }
        // The insert trigger has already created an immutable recipient event
        // and push outbox row. Ask the bounded dispatcher to deliver it now;
        // a transient failure remains durable for the normal foreground drain.
        void flushPendingGroupPushEvents().catch(() => undefined);
      } catch (reason) {
        commentsRef.current = commentsRef.current.filter(
          (item) => item.id !== pendingId,
        );
        setComments(commentsRef.current);
        throw reason;
      }
    },
    [cloudEnabled, groupId, mutationTarget, state.currentUserId],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const before = commentsRef.current;
      commentsRef.current = before.filter((item) => item.id !== commentId);
      setComments(commentsRef.current);
      if (!cloudEnabled) return;
      try {
        await deleteGroupSocialComment(commentId);
      } catch (reason) {
        commentsRef.current = before;
        setComments(before);
        throw reason;
      }
    },
    [cloudEnabled],
  );

  const reactionsByTarget = useMemo(() => {
    const map = new Map<string, GroupSocialReaction[]>();
    for (const reaction of reactions) {
      if (reaction.groupId !== groupId) continue;
      const key = persistedTargetKey({
        type: reaction.targetType,
        id: reaction.targetId,
      });
      map.set(key, [...(map.get(key) ?? []), reaction]);
    }
    return map;
  }, [groupId, reactions]);
  const commentsByTarget = useMemo(() => {
    const map = new Map<string, GroupSocialComment[]>();
    for (const item of comments) {
      if (item.groupId !== groupId) continue;
      const key = persistedTargetKey({
        type: item.targetType,
        id: item.targetId,
      });
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [comments, groupId]);
  const resolvedTargetKey = useCallback(
    (target: GroupSocialTarget) => {
      const key = targetKey(target);
      return targetAliases.get(key) ?? key;
    },
    [targetAliases],
  );

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
    targetKey: resolvedTargetKey,
  };
}
