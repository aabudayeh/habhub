import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  addGroupSocialComment,
  deleteGroupSocialComment,
  GroupSocialComment,
  GroupSocialInteractionSurface,
  GroupSocialReaction,
  GroupSocialReactionKind,
  GroupSocialTarget,
  isUnavailableGroupSocialTargetError,
  loadGroupSocialEngagement,
  loadGroupSocialCommentsPage,
  resolveMetricEntrySocialTarget,
  saveGroupSocialReaction,
} from "@/src/cloud/groupSocial";
import {
  dispatchCommittedGroupPushEvent,
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
import { moderateChatContent } from "@/src/safety/contentFilter";
import { useUserSafety } from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";
import {
  indexSocialRows,
  mergeSocialComments,
  restoreDeletedSocialComment,
  socialRowTargetKey,
  socialSummaryWithReaction,
  type GroupSocialSummary,
} from "@/src/domain/socialEngagement";

type CommentPageState = {
  before?: Pick<GroupSocialComment, "id" | "createdAt">;
  oldest?: Pick<GroupSocialComment, "id" | "createdAt">;
  hasMore: boolean;
  loading?: boolean;
  error?: string;
};

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

function demoGroupNoteEngagement(
  groupId: string,
  targets: readonly GroupSocialTarget[],
  currentUserId: string,
  memberIds: readonly string[],
) {
  const noteTargets = targets.filter((target) => target.type === "group_note");
  const actors = [...new Set([currentUserId, ...memberIds.filter(Boolean)])];
  const now = Date.now();
  const reactions: GroupSocialReaction[] = [];
  const comments: GroupSocialComment[] = [];
  const reactionKinds: GroupSocialReactionKind[] = [
    "cheer",
    "heart",
    "thumbs_up",
  ];
  const commentCopy = [
    "I’m in — I’ll bring water for the walk.",
    "The crispy tofu option sounds perfect.",
    "Love the ten-minute rule. Small wins still count!",
  ];
  noteTargets.forEach((target, index) => {
    actors.slice(0, Math.min(2, actors.length)).forEach((userId, actorIndex) => {
      const createdAt = new Date(
        now - (index * 95 + actorIndex * 18 + 12) * 60_000,
      ).toISOString();
      reactions.push({
        groupId,
        targetType: "group_note",
        targetId: target.id,
        userId,
        reaction: reactionKinds[(index + actorIndex) % reactionKinds.length],
        createdAt,
        updatedAt: createdAt,
      });
    });
    const createdAt = new Date(now - (index * 110 + 35) * 60_000).toISOString();
    comments.push({
      id: `demo-note-comment-${index}-${groupId}`,
      groupId,
      targetType: "group_note",
      targetId: target.id,
      userId: actors[(index + 1) % actors.length] ?? currentUserId,
      content: commentCopy[index % commentCopy.length],
      createdAt,
      updatedAt: createdAt,
    });
  });
  return { reactions, comments };
}

/**
 * One bounded engagement model shared by recap cards and Leaderboard logs.
 * The hook never fetches target content; callers must already possess the
 * privacy-authorized item before including its id in `targets`.
 */
export function useGroupSocialEngagement(
  groupId: string,
  targets: readonly GroupSocialTarget[],
  interactionSurface: GroupSocialInteractionSurface = "feed",
  includeComments = true,
) {
  const { state } = useApp();
  const cloud = useCloudSyncActions();
  const tutorial = useTutorialSandbox();
  const safety = useUserSafety(state.currentUserId, tutorial.active);
  const blockedUsersKey = useMemo(
    () => [...safety.blockedUserIds].sort().join(","),
    [safety.blockedUserIds],
  );
  const scopeKey = `${state.currentUserId}\u0000${groupId}\u0000${tutorial.active}\u0000${
    safety.hydrated ? blockedUsersKey : "safety-pending"
  }`;
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
  const requestScopeKey = `${scopeKey}\u0000${includeComments}\u0000${stableTargets.map(groupSocialTargetResolutionKey).join("|")}`;
  const [reactions, setReactions] = useState<GroupSocialReaction[]>([]);
  const [comments, setComments] = useState<GroupSocialComment[]>([]);
  const [summaries, setSummaries] = useState<GroupSocialSummary[]>([]);
  const [commentPages, setCommentPages] = useState(new Map<string, CommentPageState>());
  const commentPagesRef = useRef(commentPages);
  commentPagesRef.current = commentPages;
  const pageRequestsRef = useRef(new Map<string, AbortController>());
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const [targetAliases, setTargetAliases] = useState(new Map<string, string>());
  const targetAliasesRef = useRef(targetAliases);
  targetAliasesRef.current = targetAliases;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [dataScopeKey, setDataScopeKey] = useState(scopeKey);
  const dataScopeKeyRef = useRef(dataScopeKey);
  dataScopeKeyRef.current = dataScopeKey;
  const reactionsRef = useRef(reactions);
  reactionsRef.current = reactions;
  const requestRef = useRef<{
    scopeKey: string;
    promise: Promise<void>;
    controller: AbortController;
    refreshAgain: boolean;
  } | null>(null);
  const pendingMutationsRef = useRef(new Set<symbol>());
  const refreshQueuedRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const requestGenerationRef = useRef(0);
  const reactionMutationGenerationRef = useRef(new Map<string, number>());
  const reactionWriteQueueRef = useRef(
    new Map<
      string,
      Promise<{ pushEventKey?: string; requiresOutboxDrain?: boolean }>
    >(),
  );
  const confirmedReactionByMutationRef = useRef(
    new Map<string, GroupSocialReaction | undefined>(),
  );
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const activeRequestScopeRef = useRef(requestScopeKey);
  activeRequestScopeRef.current = requestScopeKey;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const cloudEnabled =
    !tutorial.active && Boolean(supabase) && isCloudGroupId(groupId);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return Promise.resolve();
    if (!cloudEnabled) {
      const seeded = demoGroupNoteEngagement(
        groupId,
        stableTargets,
        state.currentUserId,
        state.group.members.map((member) => member.id),
      );
      reactionsRef.current = seeded.reactions;
      commentsRef.current = includeComments ? seeded.comments : [];
      targetAliasesRef.current = new Map();
      setReactions(seeded.reactions);
      setComments(includeComments ? seeded.comments : []);
      setTargetAliases(new Map());
      setSummaries([]);
      setCommentPages(new Map());
      dataScopeKeyRef.current = scopeKey;
      setDataScopeKey(scopeKey);
      setLoading(false);
      setError(undefined);
      return Promise.resolve();
    }
    if (!stableTargets.length) {
      setLoading(false);
      setError(undefined);
      reactionsRef.current = [];
      commentsRef.current = [];
      targetAliasesRef.current = new Map();
      setReactions([]);
      setComments([]);
      setTargetAliases(new Map());
      setSummaries([]);
      setCommentPages(new Map());
      return Promise.resolve();
    }
    if (!safety.hydrated) return Promise.resolve();
    if (pendingMutationsRef.current.size) {
      refreshQueuedRef.current = true;
      return Promise.resolve();
    }
    if (requestRef.current?.scopeKey === requestScopeKey) {
      requestRef.current.refreshAgain = true;
      return requestRef.current.promise;
    }
    requestRef.current?.controller.abort();
    const generation = ++requestGenerationRef.current;
    const controller = new AbortController();
    let request: Promise<void>;
    setLoading(true);
    request = loadGroupSocialEngagement(groupId, stableTargets, {
      includeComments,
      signal: controller.signal,
    })
      .then(async (next) => {
        // A reader browsing an older page stays on that page as reactions arrive.
        // Re-read that bounded page so deleted/blocked comments disappear too.
        for (const [key, page] of commentPagesRef.current) {
          if (!page.before || !next.commentPages.has(key)) continue;
          const target = next.resolvedTargets.find((item) => persistedTargetKey(item) === key);
          if (!target) continue;
          const older = await loadGroupSocialCommentsPage(groupId, target, page.before, controller.signal);
          next.commentPages.set(key, older);
          next.comments = next.comments.filter((item) => socialRowTargetKey(item) !== key).concat(older.comments);
        }
        if (
          requestGenerationRef.current !== generation ||
          activeRequestScopeRef.current !== requestScopeKey ||
          pendingMutationsRef.current.size
        )
          return;
        reactionsRef.current = next.reactions;
        setReactions(next.reactions);
        commentsRef.current = next.comments;
        setComments(next.comments);
        setSummaries(next.summaries);
        const pages = new Map([...next.commentPages].map(([key, page]) => [key, {
          before: commentPagesRef.current.get(key)?.before,
          oldest: page.comments[0],
          hasMore: page.hasMore,
          error: commentPagesRef.current.get(key)?.error,
        }]));
        commentPagesRef.current = pages;
        setCommentPages(pages);
        const aliases = new Map(
          next.resolvedTargets.map((resolved, index) => [
            targetKey(stableTargets[index]),
            persistedTargetKey(resolved),
          ]),
        );
        targetAliasesRef.current = aliases;
        setTargetAliases(aliases);
        dataScopeKeyRef.current = scopeKey;
        setDataScopeKey(scopeKey);
        setError(undefined);
      })
      .catch((reason) => {
        if (
          requestGenerationRef.current !== generation ||
          activeRequestScopeRef.current !== requestScopeKey
        )
          return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        const refreshAgain = requestRef.current?.promise === request && requestRef.current.refreshAgain;
        if (requestRef.current?.promise === request) requestRef.current = null;
        if (
          requestGenerationRef.current !== generation ||
          activeRequestScopeRef.current !== requestScopeKey
        )
          return;
        setLoading(false);
        if (refreshAgain) void refreshRef.current();
      });
    requestRef.current = { scopeKey: requestScopeKey, promise: request, controller, refreshAgain: false };
    return request;
  }, [
    cloudEnabled,
    groupId,
    includeComments,
    requestScopeKey,
    scopeKey,
    stableTargets,
    state.currentUserId,
    state.group.members,
    safety.hydrated,
  ]);
  refreshRef.current = refresh;

  const beginMutation = useCallback((cancelCommentPages = true) => {
    const token = Symbol("social-mutation");
    pendingMutationsRef.current.add(token);
    if (cancelCommentPages) {
      for (const controller of pageRequestsRef.current.values()) controller.abort();
      pageRequestsRef.current.clear();
    }
    requestGenerationRef.current += 1;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    refreshQueuedRef.current = true;
    return token;
  }, []);
  const finishMutation = useCallback((token: symbol, operationScopeKey: string) => {
    if (!mountedRef.current || activeScopeRef.current !== operationScopeKey) return;
    pendingMutationsRef.current.delete(token);
    if (!pendingMutationsRef.current.size && refreshQueuedRef.current) {
      refreshQueuedRef.current = false;
      void refreshRef.current();
    }
  }, []);

  useEffect(() => {
    requestGenerationRef.current += 1;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    for (const controller of pageRequestsRef.current.values()) controller.abort();
    pageRequestsRef.current.clear();
    pendingMutationsRef.current.clear();
    refreshQueuedRef.current = false;
    reactionsRef.current = [];
    commentsRef.current = [];
    targetAliasesRef.current = new Map();
    reactionMutationGenerationRef.current.clear();
    reactionWriteQueueRef.current.clear();
    confirmedReactionByMutationRef.current.clear();
    setReactions([]);
    setComments([]);
    setTargetAliases(new Map());
    setSummaries([]);
    commentPagesRef.current = new Map();
    setCommentPages(new Map());
    dataScopeKeyRef.current = scopeKey;
    setDataScopeKey(scopeKey);
    setError(undefined);
  }, [scopeKey]);

  useEffect(() => {
    const pageRequests = pageRequestsRef.current;
    requestGenerationRef.current += 1;
    if (requestRef.current?.scopeKey !== requestScopeKey) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
    }
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
      requestRef.current?.controller.abort();
      requestRef.current = null;
      for (const controller of pageRequests.values()) controller.abort();
      pageRequests.clear();
    };
  }, [refresh, requestScopeKey]);

  useEffect(() => {
    if (!cloudEnabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: ReturnType<typeof scheduleResponsiveWork> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `group:${groupId}:social`,
      "social_updated",
      () => {
        if (timer || task) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (Platform.OS === "web") {
            void refresh();
            return;
          }
          task = scheduleResponsiveWork(() => { task = undefined; void refresh(); }, {
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

  const adjustCommentCount = useCallback((key: string, amount: number) => {
    setSummaries((current) => current.map((summary) =>
      socialRowTargetKey(summary) === key
        ? { ...summary, commentCount: Math.max(0, summary.commentCount + amount) }
        : summary,
    ));
  }, []);

  const loadCommentPage = useCallback(async (target: GroupSocialTarget, older = true) => {
    if (!cloudEnabled || !includeComments) return;
    const key = targetAliasesRef.current.get(targetKey(target)) ?? persistedTargetKey(target);
    if (pageRequestsRef.current.has(key) || pendingMutationsRef.current.size) return;
    const page = commentPagesRef.current.get(key);
    const before = older ? page?.oldest : undefined;
    if (older && (!page?.hasMore || !before)) return;
    const operationRequestScope = activeRequestScopeRef.current;
    const controller = new AbortController();
    pageRequestsRef.current.set(key, controller);
    const token = beginMutation(false);
    const setPage = (next: CommentPageState) => {
      const pages = new Map(commentPagesRef.current).set(key, next);
      commentPagesRef.current = pages;
      setCommentPages(pages);
    };
    setPage({ ...page, hasMore: page?.hasMore ?? false, loading: true, error: undefined });
    try {
      const resolved = await resolveMetricEntrySocialTarget(groupId, target, { signal: controller.signal });
      if (!resolved) throw new Error("That shared item is no longer available.");
      const next = await loadGroupSocialCommentsPage(groupId, resolved, before, controller.signal);
      if (controller.signal.aborted || activeRequestScopeRef.current !== operationRequestScope) return;
      commentsRef.current = commentsRef.current
        .filter((item) => socialRowTargetKey(item) !== key)
        .concat(next.comments);
      setComments(commentsRef.current);
      setPage({ before, oldest: next.comments[0], hasMore: next.hasMore });
    } catch (reason) {
      if (activeRequestScopeRef.current === operationRequestScope && !controller.signal.aborted)
        setPage({ ...page, hasMore: page?.hasMore ?? false, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      if (pageRequestsRef.current.get(key) === controller) pageRequestsRef.current.delete(key);
      finishMutation(token, scopeKey);
    }
  }, [beginMutation, cloudEnabled, finishMutation, groupId, includeComments, scopeKey]);

  const react = useCallback(
    async (target: GroupSocialTarget, reaction: GroupSocialReactionKind) => {
      if (cloudEnabled && !safety.hydrated)
        throw new Error("Safety settings are still loading. Try again shortly.");
      if (cloudEnabled && !safety.termsAccepted)
        throw new Error("Accept the community Terms before reacting.");
      const operationScopeKey = scopeKey;
      const requestedTargetKey = targetKey(target);
      const currentDataMatchesScope = dataScopeKeyRef.current === scopeKey;
      const knownPersistedKey = currentDataMatchesScope
        ? targetAliasesRef.current.get(requestedTargetKey)
        : undefined;
      const targetIds = new Set([target.id]);
      const currentReactions = currentDataMatchesScope
        ? reactionsRef.current
        : [];
      const existing = currentReactions.find(
        (item) =>
          item.userId === state.currentUserId &&
          item.targetType === target.type &&
          (targetIds.has(item.targetId) ||
            reactionPersistedTargetKey(item) === knownPersistedKey),
      );
      const nextReaction = existing?.reaction === reaction ? undefined : reaction;
      const before = currentReactions;
      const now = new Date().toISOString();
      const mutationKey = `${operationScopeKey}\u0000${requestedTargetKey}`;
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
      const operationToken = beginMutation();

      // Serialize writes for one target. Rapid taps still paint immediately,
      // while the database always receives the user's choices in tap order.
      const previousWrite = reactionWriteQueueRef.current.get(mutationKey) ??
        Promise.resolve({});
      const write = previousWrite.catch(() => undefined).then(async () => {
        if (!mountedRef.current || activeScopeRef.current !== operationScopeKey) return {};
        let resolvedTarget = await mutationTarget(target);
        if (!mountedRef.current || activeScopeRef.current !== operationScopeKey) return {};
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
            surface: interactionSurface,
          });
          confirmSocialReactionBurst(
            confirmedReactionByMutationRef.current,
            mutationKey,
            saved.reaction,
          );
          return saved;
        } catch (reason) {
          if (
            nextReaction &&
            target.type === "metric_entry" &&
            target.ownerUserId === state.currentUserId &&
            isUnavailableGroupSocialTargetError(reason)
          ) {
            resolvedTarget = await mutationTarget(target, true);
            if (activeScopeRef.current !== operationScopeKey) return {};
            const saved = await saveGroupSocialReaction({
              groupId,
              target: resolvedTarget,
              userId: state.currentUserId,
              reaction: nextReaction,
              surface: interactionSurface,
            });
            confirmSocialReactionBurst(
              confirmedReactionByMutationRef.current,
              mutationKey,
              saved.reaction,
            );
            return saved;
          } else throw reason;
        }
      });
      reactionWriteQueueRef.current.set(mutationKey, write);
      try {
        const saved = await write;
        // Dispatch the exact trigger-owned row immediately, like chat. The
        // broad drain remains only for staged-rollout clients whose database
        // has not installed the prompt-result RPC yet.
        if (saved.pushEventKey)
          void dispatchCommittedGroupPushEvent(saved.pushEventKey).catch(() =>
            flushPendingGroupPushEvents().catch(() => undefined),
          );
        else if (saved.requiresOutboxDrain)
          void flushPendingGroupPushEvents().catch(() => undefined);
      } catch (reason) {
        if (
          activeScopeRef.current === operationScopeKey &&
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
        finishMutation(operationToken, operationScopeKey);
      }
    },
    [
      cloudEnabled,
      groupId,
      mutationTarget,
      interactionSurface,
      safety.hydrated,
      safety.termsAccepted,
      state.currentUserId,
      scopeKey,
      beginMutation,
      finishMutation,
    ],
  );

  const comment = useCallback(
    async (target: GroupSocialTarget, content: string) => {
      if (!content.trim()) return;
      const moderation = moderateChatContent(content);
      if (!moderation.allowed)
        throw new Error(
          moderation.message.replace("message", "comment"),
        );
      if (cloudEnabled && !safety.hydrated)
        throw new Error("Safety settings are still loading. Try again shortly.");
      if (cloudEnabled && !safety.termsAccepted)
        throw new Error("Accept the community Terms before commenting.");
      const operationScopeKey = scopeKey;
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
      const countKey = targetAliasesRef.current.get(targetKey(target)) ?? persistedTargetKey(target);
      adjustCommentCount(countKey, 1);
      const operationToken = beginMutation();
      const removePending = () => {
        if (activeScopeRef.current !== operationScopeKey) return;
        commentsRef.current = commentsRef.current.filter((item) => item.id !== pendingId);
        setComments(commentsRef.current);
        adjustCommentCount(countKey, -1);
      };
      let resolvedTarget: GroupSocialTarget;
      try {
        resolvedTarget = await mutationTarget(target);
      } catch (reason) {
        removePending();
        finishMutation(operationToken, operationScopeKey);
        throw reason;
      }
      if (activeScopeRef.current !== operationScopeKey) {
        finishMutation(operationToken, operationScopeKey);
        return;
      }
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
            surface: interactionSurface,
          });
        } catch (reason) {
          if (
            target.type === "metric_entry" &&
            target.ownerUserId === state.currentUserId &&
            isUnavailableGroupSocialTargetError(reason)
          ) {
            resolvedTarget = await mutationTarget(target, true);
            if (activeScopeRef.current !== operationScopeKey) return;
            saved = await addGroupSocialComment({
              groupId,
              target: resolvedTarget,
              userId: state.currentUserId,
              content,
              surface: interactionSurface,
            });
          } else throw reason;
        }
        if (activeScopeRef.current === operationScopeKey) {
          commentsRef.current = mergeSocialComments(
            commentsRef.current.filter((item) => item.id !== pendingId),
            [saved.comment],
          );
          setComments(commentsRef.current);
          // A new reply belongs on the latest page even if the author was
          // browsing older discussion when they opened the composer.
          const pages = new Map(commentPagesRef.current);
          const page = pages.get(resolvedTargetKey);
          if (page?.before) {
            pages.set(resolvedTargetKey, { ...page, before: undefined });
            commentPagesRef.current = pages;
            setCommentPages(pages);
          }
        }
        if (saved.pushEventKey)
          void dispatchCommittedGroupPushEvent(saved.pushEventKey).catch(() =>
            flushPendingGroupPushEvents().catch(() => undefined),
          );
        else if (saved.requiresOutboxDrain)
          void flushPendingGroupPushEvents().catch(() => undefined);
      } catch (reason) {
        removePending();
        throw reason;
      } finally {
        finishMutation(operationToken, operationScopeKey);
      }
    },
    [
      cloudEnabled,
      groupId,
      interactionSurface,
      mutationTarget,
      safety.hydrated,
      safety.termsAccepted,
      state.currentUserId,
      scopeKey,
      adjustCommentCount,
      beginMutation,
      finishMutation,
    ],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const deleted = commentsRef.current.find((item) => item.id === commentId);
      if (!deleted) return;
      const operationScopeKey = scopeKey;
      commentsRef.current = commentsRef.current.filter((item) => item.id !== commentId);
      setComments(commentsRef.current);
      if (!cloudEnabled) return;
      const countKey = socialRowTargetKey(deleted);
      adjustCommentCount(countKey, -1);
      const operationToken = beginMutation();
      try {
        await deleteGroupSocialComment(commentId);
      } catch (reason) {
        if (activeScopeRef.current === operationScopeKey) {
          commentsRef.current = restoreDeletedSocialComment(commentsRef.current, deleted);
          setComments(commentsRef.current);
          adjustCommentCount(countKey, 1);
        }
        throw reason;
      } finally {
        finishMutation(operationToken, operationScopeKey);
      }
    },
    [adjustCommentCount, beginMutation, cloudEnabled, finishMutation, scopeKey],
  );

  const visibleReactions = useMemo(
    () =>
      dataScopeKey === scopeKey
        ? reactions.filter(
            (reaction) => !safety.blockedUserIds.has(reaction.userId),
          )
        : [],
    [dataScopeKey, reactions, safety.blockedUserIds, scopeKey],
  );
  const visibleComments = useMemo(
    () =>
      dataScopeKey === scopeKey
        ? comments.filter(
            (comment) => !safety.blockedUserIds.has(comment.userId),
          )
        : [],
    [comments, dataScopeKey, safety.blockedUserIds, scopeKey],
  );
  const reactionsByTarget = useMemo(
    () => indexSocialRows(visibleReactions.filter((row) => row.groupId === groupId)),
    [groupId, visibleReactions],
  );
  const commentsByTarget = useMemo(
    () => indexSocialRows(visibleComments.filter((row) => row.groupId === groupId)),
    [groupId, visibleComments],
  );
  const summariesByTarget = useMemo(() => {
    const result = new Map<string, GroupSocialSummary>();
    if (dataScopeKey !== scopeKey) return result;
    for (const summary of summaries) {
      const key = socialRowTargetKey(summary);
      const current = reactionsByTarget.get(key)?.find((row) => row.userId === state.currentUserId);
      result.set(key, socialSummaryWithReaction(summary, current?.reaction));
    }
    return result;
  }, [dataScopeKey, reactionsByTarget, scopeKey, state.currentUserId, summaries]);
  const resolvedTargetKey = useCallback(
    (target: GroupSocialTarget) => {
      const key = targetKey(target);
      return dataScopeKey === scopeKey ? (targetAliases.get(key) ?? key) : key;
    },
    [dataScopeKey, scopeKey, targetAliases],
  );

  return {
    interactionScopeKey: `${scopeKey}\u0000${safety.termsAccepted}`,
    reactions: visibleReactions,
    comments: visibleComments,
    reactionsByTarget,
    commentsByTarget,
    summariesByTarget,
    commentPages,
    loadCommentPage,
    loading,
    error,
    refresh,
    react,
    comment,
    removeComment,
    targetKey: resolvedTargetKey,
  };
}
