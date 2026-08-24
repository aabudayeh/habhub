import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteGroupTodo,
  loadGroupTodos,
  saveGroupTodo,
  SaveGroupTodoInput,
  setGroupTodoCompletion,
} from "@/src/cloud/groupTodos";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import {
  descendantTodoIds,
  groupTodoCompletedOnDate,
} from "@/src/domain/todos";
import { dateKey } from "@/src/domain/date";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { GroupTodoItem } from "@/src/types";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";

const localTodosByGroup = new Map<string, GroupTodoItem[]>();
const localTodoListeners = new Map<string, Set<(todos: GroupTodoItem[]) => void>>();
const groupTodoLoadsByGroup = new Map<string, Promise<GroupTodoItem[]>>();

function loadGroupTodosShared(groupId: string) {
  const inFlight = groupTodoLoadsByGroup.get(groupId);
  if (inFlight) return inFlight;
  let request: Promise<GroupTodoItem[]>;
  request = loadGroupTodos(groupId).finally(() => {
    if (groupTodoLoadsByGroup.get(groupId) === request)
      groupTodoLoadsByGroup.delete(groupId);
  });
  groupTodoLoadsByGroup.set(groupId, request);
  return request;
}

type GroupTodoRealtimeChannel = ReturnType<
  NonNullable<typeof supabase>["channel"]
>;

type GroupTodoRealtimeEntry = {
  channel: GroupTodoRealtimeChannel;
  listeners: Set<() => void>;
  references: number;
};

const groupTodoRealtimeByGroup = new Map<string, GroupTodoRealtimeEntry>();

/**
 * Every hook in this JS runtime shares one group topic/channel. A per-hook
 * topic would isolate the sender from every other device, while separate
 * channels with the same topic can replace each other inside supabase-js.
 */
function acquireGroupTodoRealtime(
  groupId: string,
  onInvalidated: () => void,
) {
  if (!supabase) return undefined;
  let entry = groupTodoRealtimeByGroup.get(groupId);
  if (!entry) {
    const listeners = new Set<() => void>();
    const channel = supabase
      .channel(`group-todos:${groupId}`)
      .on("broadcast", { event: "changed" }, () => {
        for (const listener of [...listeners]) listener();
      })
      .subscribe();
    entry = { channel, listeners, references: 0 };
    groupTodoRealtimeByGroup.set(groupId, entry);
  }
  const acquired = entry;
  acquired.references += 1;
  acquired.listeners.add(onInvalidated);
  let released = false;
  return {
    send() {
      return acquired.channel.send({
        type: "broadcast",
        event: "changed",
        payload: {},
      });
    },
    release() {
      if (released) return;
      released = true;
      acquired.listeners.delete(onInvalidated);
      acquired.references = Math.max(0, acquired.references - 1);
      if (
        acquired.references > 0 ||
        groupTodoRealtimeByGroup.get(groupId) !== acquired
      )
        return;
      groupTodoRealtimeByGroup.delete(groupId);
      void supabase?.removeChannel(acquired.channel).catch(() => undefined);
    },
  };
}

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
  const [todos, setTodos] = useState<GroupTodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);
  const groupIdRef = useRef(groupId);
  const realtimeRef = useRef<
    ReturnType<typeof acquireGroupTodoRealtime>
  >(undefined);
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
    request = loadGroupTodosShared(groupId)
      .then((rows) => {
        if (groupIdRef.current !== groupId) return;
        setTodos(rows);
        updateLocalGroupTodos(groupId, () => rows);
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
    if (!enabled) return;
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
  }, [enabled, groupId]);

  useEffect(() => {
    if (!cloudEnabled || !supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };
    const realtime = acquireGroupTodoRealtime(groupId, queueRefresh);
    realtimeRef.current = realtime;
    return () => {
      if (timer) clearTimeout(timer);
      if (realtimeRef.current === realtime) realtimeRef.current = undefined;
      realtime?.release();
    };
  }, [cloudEnabled, groupId, refresh]);

  const broadcast = useCallback(() => {
    void realtimeRef.current?.send().catch(() => undefined);
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
          id:
            input.id ??
            `local-group-todo-${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 10)}`,
          groupId: input.groupId,
          creatorId: state.currentUserId,
          title: input.title.trim(),
          description: input.description?.trim() || undefined,
          parentId: invalidParent ? undefined : input.parentId,
          labels: input.labels ?? [],
          priority: input.priority,
          dueAt: input.dueAt,
          recurrence: input.recurrence,
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
          completedBy:
            input.completionMode === "individual"
              ? previous?.completedBy ?? []
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
      const previous = input.id
        ? (localTodosByGroup.get(input.groupId) ?? []).find(
            (todo) => todo.id === input.id,
          )
        : undefined;
      const response = await saveGroupTodo(input);
      const saved =
        response.completionMode === "individual" && previous
          ? {
              ...response,
              completedBy: previous.completedBy,
              completedByIds: previous.completedByIds,
            }
          : response;
      updateLocalGroupTodos(input.groupId, (current) => [
        ...current.filter((todo) => todo.id !== saved.id),
        saved,
      ]);
      broadcast();
      void refresh();
      return saved;
    },
    [broadcast, cloudEnabled, refresh, state.currentUserId],
  );

  const toggle = useCallback(
    async (todo: GroupTodoItem) => {
      const completed = groupTodoCompletedOnDate(
        todo,
        state.currentUserId,
        dateKey(),
      );
      const now = new Date().toISOString();
      const optimistic = (current: GroupTodoItem[]) =>
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
                    : [...new Set([...item.completedByIds, state.currentUserId])],
                  completedBy: completed
                    ? item.completedBy.filter(
                        (entry) => entry.userId !== state.currentUserId,
                      )
                    : [
                        ...item.completedBy.filter(
                          (entry) => entry.userId !== state.currentUserId,
                        ),
                        { userId: state.currentUserId, completedAt: now },
                      ],
                },
        );
      if (!cloudEnabled) {
        updateLocalGroupTodos(groupId, optimistic);
        return;
      }
      const before = localTodosByGroup.get(groupId) ?? [];
      updateLocalGroupTodos(groupId, optimistic);
      try {
        await setGroupTodoCompletion(todo.id, !completed);
        broadcast();
        void refresh();
      } catch (reason) {
        updateLocalGroupTodos(groupId, () => before);
        throw reason;
      }
    },
    [broadcast, cloudEnabled, groupId, refresh, state.currentUserId],
  );

  const remove = useCallback(
    async (todoId: string) => {
      const removeFrom = (current: GroupTodoItem[]) => {
        const removed = descendantTodoIds(current, todoId);
        removed.add(todoId);
        return current.filter((todo) => !removed.has(todo.id));
      };
      const before = localTodosByGroup.get(groupId) ?? [];
      updateLocalGroupTodos(groupId, removeFrom);
      if (cloudEnabled) {
        try {
          await deleteGroupTodo(todoId);
          broadcast();
        } catch (reason) {
          updateLocalGroupTodos(groupId, () => before);
          throw reason;
        }
      } else broadcast();
    },
    [broadcast, cloudEnabled, groupId],
  );

  return { todos, loading, ready, error, refresh, save, toggle, remove };
}
