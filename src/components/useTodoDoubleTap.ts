import { useCallback, useEffect, useRef } from "react";

const TODO_DOUBLE_TAP_WINDOW_MS = 220;

type PendingPress<T> = {
  id: string;
  item: T;
  pressedAt: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Keeps the existing single-tap editor action while reserving a quick second
 * tap on the same card for completion. Child controls stop propagation and are
 * therefore unaffected.
 */
export function useTodoCardPress<T extends { id: string }>({
  onOpen,
  onComplete,
}: {
  onOpen: (item: T) => void;
  onComplete: (item: T) => void;
}) {
  const callbacks = useRef({ onOpen, onComplete });
  callbacks.current = { onOpen, onComplete };
  const pending = useRef<PendingPress<T> | undefined>(undefined);
  const activePress = useRef<
    { id: string; longPressTriggered: boolean } | undefined
  >(undefined);

  const cancelPending = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current = undefined;
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const onPress = useCallback(
    (item: T, alreadyComplete: boolean, doubleTapEnabled = true) => {
      if (
        activePress.current?.id === item.id &&
        activePress.current.longPressTriggered
      ) {
        activePress.current = undefined;
        return;
      }
      activePress.current = undefined;
      if (!doubleTapEnabled) {
        cancelPending();
        callbacks.current.onOpen(item);
        return;
      }

      const now = Date.now();
      const previous = pending.current;
      if (
        previous?.id === item.id &&
        now - previous.pressedAt <= TODO_DOUBLE_TAP_WINDOW_MS
      ) {
        cancelPending();
        if (!alreadyComplete) callbacks.current.onComplete(item);
        return;
      }

      // A press on another row supersedes the unfinished gesture instead of
      // opening two stacked editors a fraction of a second apart.
      cancelPending();
      const next: PendingPress<T> = {
        id: item.id,
        item,
        pressedAt: now,
        timer: setTimeout(() => {
          if (pending.current !== next) return;
          pending.current = undefined;
          callbacks.current.onOpen(next.item);
        }, TODO_DOUBLE_TAP_WINDOW_MS),
      };
      pending.current = next;
    },
    [cancelPending],
  );

  const onPressIn = useCallback((item: T) => {
    activePress.current = { id: item.id, longPressTriggered: false };
  }, []);

  const onLongPress = useCallback(
    (item: T, action: () => void) => {
      activePress.current = { id: item.id, longPressTriggered: true };
      cancelPending();
      action();
    },
    [cancelPending],
  );

  return { onPress, onPressIn, onLongPress, cancelPending };
}

/** A selected label is removed only after two deliberate taps. */
export function useTodoLabelDoubleTap(onRemove: (label: string) => void) {
  const remove = useRef(onRemove);
  remove.current = onRemove;
  const previous = useRef<{ label: string; pressedAt: number } | undefined>(
    undefined,
  );

  return useCallback((label: string) => {
    const now = Date.now();
    if (
      previous.current?.label === label &&
      now - previous.current.pressedAt <= TODO_DOUBLE_TAP_WINDOW_MS
    ) {
      previous.current = undefined;
      remove.current(label);
      return;
    }
    previous.current = { label, pressedAt: now };
  }, []);
}
