import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_PREFIX = "@habhub/todo-subtask-expansion/v1:";
const MAX_REMEMBERED_PARENTS = 500;

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

function parsedIds(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is string =>
          typeof item === "string" && item.length > 0,
      )
      .slice(-MAX_REMEMBERED_PARENTS);
  } catch {
    return [];
  }
}

/**
 * Remembers only this device's expanded subtask branches. It deliberately
 * stays outside AppState/cloud sync because expansion is a local view choice.
 */
export function useTodoSubtaskExpansion(scope: string) {
  const key = useMemo(() => storageKey(scope), [scope]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const keyRef = useRef(key);
  const revisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    keyRef.current = key;
    const loadRevision = ++revisionRef.current;
    setExpandedIds(new Set());
    void AsyncStorage.getItem(key)
      .then((stored) => {
        if (
          active &&
          keyRef.current === key &&
          revisionRef.current === loadRevision
        )
          setExpandedIds(new Set(parsedIds(stored)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key]);

  const remember = useCallback(
    (next: Set<string>) => {
      const values = [...next].slice(-MAX_REMEMBERED_PARENTS);
      void AsyncStorage.setItem(key, JSON.stringify(values)).catch(
        () => undefined,
      );
    },
    [key],
  );

  const toggle = useCallback(
    (todoId: string) => {
      revisionRef.current += 1;
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(todoId)) next.delete(todoId);
        else next.add(todoId);
        remember(next);
        return next;
      });
    },
    [remember],
  );

  const expand = useCallback(
    (todoId: string) => {
      revisionRef.current += 1;
      setExpandedIds((current) => {
        if (current.has(todoId)) return current;
        const next = new Set(current);
        next.add(todoId);
        remember(next);
        return next;
      });
    },
    [remember],
  );

  return {
    expandedIds,
    isExpanded: (todoId: string) => expandedIds.has(todoId),
    toggle,
    expand,
  };
}
