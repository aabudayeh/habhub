import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  deleteGroupTodo,
  loadGroupTodos,
  saveGroupTodo,
  SaveGroupTodoInput,
  setGroupTodoCompletion,
} from "@/src/cloud/groupTodos";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { descendantTodoIds } from "@/src/domain/todos";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { GroupTodoItem } from "@/src/types";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";

const localTodosByGroup = new Map<string, GroupTodoItem[]>();
const localTodoListeners = new Map<string, Set<(todos: GroupTodoItem[]) => void>>();

function updateLocalGroupTodos(
  groupId: string,
  update: (current: GroupTodoItem[]) => GroupTodoItem[],
) {
  const next = update(localTodosByGroup.get(groupId) ?? []);
  localTodosByGroup.set(groupId, next);
  localTodoListeners.get(groupId)?.forEach((listener) => listener(next));
  return next;
}

/**
 * Screen-scoped group task state. Mutations broadcast only an invalidation;
 * actual task content remains protected by table RLS and is queried on demand.
 */
export function useGroupTodos(groupId: string, enabled = true) {
  const tutorial = useTutorialSandbox();
  const { state } = useApp();
  const subscriberId = useId();
  const [todos, setTodos] = useState<GroupTodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const groupIdRef = useRef(groupId);
  const channelRef = useRef<
    ReturnType<NonNullable<typeof supabase>["channel"]> | null
  >(null);
  groupIdRef.current = groupId;

  const cloudEnabled =
    enabled && !tutorial.active && Boolean(supabase) && isCloudGroupId(groupId);

  const refresh = useCallback(() => {
    if (!cloudEnabled) {
      if (!enabled) setTodos([]);
      if (!enabled) setReady(true);
      setError(undefined);
      return Promise.resolve();
    }
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    setReady(false);
    request = loadGroupTodos(groupId)
      .then((rows) => {
        if (groupIdRef.current !== groupId) return;
        setTodos(rows);
        setError(undefined);
      })
      .catch((reason) => {
        if (groupIdRef.current !== groupId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        if (groupIdRef.current === groupId) setLoading(false);
        if (groupIdRef.current === groupId) setReady(true);
      });
    requestRef.current = request;
    return request;
  }, [cloudEnabled, enabled, groupId]);

  useEffect(() => {
    requestRef.current = null;
    setTodos([]);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (cloudEnabled || !enabled) return;
    setTodos(localTodosByGroup.get(groupId) ?? []);
    setReady(true);
    const listeners = localTodoListeners.get(groupId) ?? new Set();
    const listener = (next: GroupTodoItem[]) => setTodos(next);
    listeners.add(listener);
    localTodoListeners.set(groupId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) localTodoListeners.delete(groupId);
    };
  }, [cloudEnabled, enabled, groupId]);

  useEffect(() => {
    if (!cloudEnabled || !supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };
    const channel = supabase
      .channel(`group-todos:${groupId}:${subscriberId}`)
      .on("broadcast", { event: "changed" }, queueRefresh)
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (timer) clearTimeout(timer);
      if (channelRef.current === channel) channelRef.current = null;
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [cloudEnabled, groupId, refresh, subscriberId]);

  const broadcast = useCallback(() => {
    void channelRef.current
      ?.send({ type: "broadcast", event: "changed", payload: {} })
      .catch(() => undefined);
  }, []);

  const save = useCallback(
    async (input: SaveGroupTodoInput) => {
      if (!cloudEnabled) {
        const now = new Date().toISOString();
        const currentTodos = localTodosByGroup.get(input.groupId) ?? [];
        const previous = input.id
          ? currentTodos.find((todo) => todo.id === input.id)
          : undefined;
        const invalidParent =
          input.parentId === input.id ||
          (input.id &&
            input.parentId &&
            descendantTodoIds(currentTodos, input.id).has(input.parentId));
        const saved: GroupTodoItem = {
          id: input.id ?? `local-group-todo-${Date.now()}`,
          groupId: input.groupId,
          creatorId: state.currentUserId,
          title: input.title.trim(),
          description: input.description?.trim() || undefined,
          parentId: invalidParent ? undefined : input.parentId,
          labels: input.labels ?? [],
          priority: input.priority,
          dueAt: input.dueAt,
          completionMode: input.completionMode,
          completedAt:
            input.completionMode === "shared"
              ? previous?.completedAt
              : undefined,
          completedByUserId:
            input.completionMode === "shared"
              ? previous?.completedByUserId
              : undefined,
          completedByIds:
            input.completionMode === "individual"
              ? previous?.completedByIds ?? []
              : [],
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        };
        updateLocalGroupTodos(input.groupId, (current) => [
          ...current.filter((todo) => todo.id !== saved.id),
          saved,
        ]);
        return saved;
      }
      const saved = await saveGroupTodo(input);
      await refresh();
      broadcast();
      return saved;
    },
    [broadcast, cloudEnabled, refresh, state.currentUserId],
  );

  const toggle = useCallback(
    async (todo: GroupTodoItem) => {
      const completed =
        todo.completionMode === "shared"
          ? Boolean(todo.completedAt)
          : todo.completedByIds.includes(state.currentUserId);
      if (!cloudEnabled) {
        const now = new Date().toISOString();
        updateLocalGroupTodos(groupId, (current) =>
          current.map((item) =>
            item.id !== todo.id
              ? item
              : item.completionMode === "shared"
                ? {
                    ...item,
                    completedAt: completed ? undefined : now,
                    completedByUserId: completed
                      ? undefined
                      : state.currentUserId,
                  }
                : {
                    ...item,
                    completedByIds: completed
                      ? item.completedByIds.filter(
                          (id) => id !== state.currentUserId,
                        )
                      : [...item.completedByIds, state.currentUserId],
                  },
          ),
        );
        return;
      }
      await setGroupTodoCompletion(todo.id, !completed);
      await refresh();
      broadcast();
    },
    [broadcast, cloudEnabled, groupId, refresh, state.currentUserId],
  );

  const remove = useCallback(
    async (todoId: string) => {
      if (cloudEnabled) await deleteGroupTodo(todoId);
      const removeFrom = (current: GroupTodoItem[]) => {
        const removed = descendantTodoIds(current, todoId);
        removed.add(todoId);
        return current.filter((todo) => !removed.has(todo.id));
      };
      if (cloudEnabled) setTodos(removeFrom);
      else updateLocalGroupTodos(groupId, removeFrom);
      broadcast();
    },
    [broadcast, cloudEnabled, groupId],
  );

  return { todos, loading, ready, error, refresh, save, toggle, remove };
}
