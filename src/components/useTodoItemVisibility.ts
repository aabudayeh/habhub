import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "@habhub/todo-item-visibility/v1:";
const MAX_HIDDEN_ITEMS = 1_000;
const hiddenIdsByKey = new Map<string, Set<string>>();
const listenersByKey = new Map<string, Set<(hiddenIds: Set<string>) => void>>();

function publish(key: string, hiddenIds: Set<string>) {
  hiddenIdsByKey.set(key, hiddenIds);
  for (const listener of listenersByKey.get(key) ?? []) listener(hiddenIds);
}

function parsedIds(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0,
          )
          .slice(-MAX_HIDDEN_ITEMS)
      : [];
  } catch {
    return [];
  }
}

/** Local, account-scoped visibility. Shared group task data is never mutated. */
export function useTodoItemVisibility(scope: string) {
  const key = useMemo(
    () => `${STORAGE_PREFIX}${encodeURIComponent(scope)}`,
    [scope],
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(
    () => hiddenIdsByKey.get(key) ?? new Set(),
  );

  useEffect(() => {
    let active = true;
    const listener = (next: Set<string>) => setHiddenIds(new Set(next));
    const listeners = listenersByKey.get(key) ?? new Set();
    listeners.add(listener);
    listenersByKey.set(key, listeners);
    const cached = hiddenIdsByKey.get(key);
    if (cached) setHiddenIds(new Set(cached));
    else {
      setHiddenIds(new Set());
      void AsyncStorage.getItem(key)
        .then((stored) => {
          if (active && !hiddenIdsByKey.has(key))
            publish(key, new Set(parsedIds(stored)));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      listeners.delete(listener);
      if (!listeners.size) listenersByKey.delete(key);
    };
  }, [key]);

  const toggle = useCallback(
    (todoId: string) => {
      const next = new Set(hiddenIdsByKey.get(key) ?? hiddenIds);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      publish(key, next);
      void AsyncStorage.setItem(
        key,
        JSON.stringify([...next].slice(-MAX_HIDDEN_ITEMS)),
      ).catch(() => undefined);
    },
    [hiddenIds, key],
  );

  return {
    hiddenIds,
    isVisible: (todoId: string) => !hiddenIds.has(todoId),
    toggle,
  };
}
