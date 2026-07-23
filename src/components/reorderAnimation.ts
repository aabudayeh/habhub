import { useCallback, useEffect, useRef } from "react";

/** Requires a brief hover over the new slot before committing a live reorder. */
export function useDelayedReorder(
  onCommit: (target: number) => void,
  delay = 340,
) {
  const callback = useRef(onCommit);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  callback.current = onCommit;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const target = pending.current;
    pending.current = null;
    if (target !== null) callback.current(target);
  }, []);

  const schedule = useCallback(
    (target: number) => {
      if (pending.current === target) return;
      if (timer.current) clearTimeout(timer.current);
      pending.current = target;
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = pending.current;
        pending.current = null;
        if (next !== null) callback.current(next);
      }, delay);
    },
    [delay],
  );

  useEffect(() => cancel, [cancel]);
  return { schedule, flush, cancel };
}
