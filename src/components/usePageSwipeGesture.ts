import { useCallback, useMemo, useRef } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

export function usePageSwipeGesture({
  enabled = true,
  onPrevious,
  onNext,
}: {
  enabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const callbacks = useRef({ onPrevious, onNext });
  callbacks.current = { onPrevious, onNext };
  const changePage = useCallback((direction: -1 | 1) => {
    if (direction < 0) callbacks.current.onPrevious();
    else callbacks.current.onNext();
  }, []);

  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-28, 28])
        .failOffsetY([-22, 22])
        .onEnd((event) => {
          "worklet";
          if (
            Math.abs(event.translationX) < 52 ||
            Math.abs(event.translationX) <
              Math.abs(event.translationY) * 1.35
          )
            return;
          runOnJS(changePage)(event.translationX < 0 ? 1 : -1);
        }),
    [changePage, enabled],
  );
}
