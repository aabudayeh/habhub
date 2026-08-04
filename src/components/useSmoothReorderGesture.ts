import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

type Options = {
  enabled: boolean;
  index: number;
  count: number;
  initialStep: number;
  onMove: (target: number) => void;
  onStart?: () => void;
  onTargetChange?: (target: number) => void;
  onCancel?: () => void;
  onEnd?: () => void;
};

/**
 * Runs drag frames on the UI thread. Only slot changes and the final commit
 * cross to JavaScript, which keeps Android reordering smooth under load.
 */
export function useSmoothReorderGesture({
  enabled,
  index,
  count,
  initialStep,
  onMove,
  onStart,
  onTargetChange,
  onCancel,
  onEnd,
}: Options) {
  const [dragging, setDragging] = useState(false);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const indexValue = useSharedValue(index);
  const countValue = useSharedValue(count);
  const stepValue = useSharedValue(initialStep);
  const originValue = useSharedValue(index);
  const targetValue = useSharedValue(index);
  const releasedValue = useSharedValue(false);
  const callbacks = useRef({
    onMove,
    onStart,
    onTargetChange,
    onCancel,
    onEnd,
  });
  callbacks.current = {
    onMove,
    onStart,
    onTargetChange,
    onCancel,
    onEnd,
  };

  useEffect(() => {
    indexValue.value = index;
    countValue.value = count;
    if (!enabled) {
      translateY.value = 0;
      scale.value = 1;
      setDragging(false);
    }
  }, [count, countValue, enabled, index, indexValue, scale, translateY]);

  const begin = useCallback(() => {
    setDragging(true);
    callbacks.current.onStart?.();
  }, []);
  const targetChanged = useCallback((target: number) => {
    callbacks.current.onTargetChange?.(target);
  }, []);
  const commit = useCallback((target: number, origin: number) => {
    if (target !== origin) callbacks.current.onMove(target);
  }, []);
  const finish = useCallback((cancelled: boolean) => {
    setDragging(false);
    if (cancelled) callbacks.current.onCancel?.();
    callbacks.current.onEnd?.();
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetY([-2, 2])
        .failOffsetX([-36, 36])
        .onStart(() => {
          "worklet";
          originValue.value = indexValue.value;
          targetValue.value = indexValue.value;
          releasedValue.value = false;
          scale.value = withSpring(1.012, {
            damping: 24,
            stiffness: 260,
          });
          runOnJS(begin)();
        })
        .onUpdate((event) => {
          "worklet";
          translateY.value = event.translationY;
          const step = Math.max(1, stepValue.value);
          const next = Math.max(
            0,
            Math.min(
              countValue.value - 1,
              originValue.value + Math.round(event.translationY / step),
            ),
          );
          if (next !== targetValue.value) {
            targetValue.value = next;
            runOnJS(targetChanged)(next);
          }
        })
        .onEnd(() => {
          "worklet";
          releasedValue.value = true;
          const target = targetValue.value;
          const origin = originValue.value;
          // The React list will move this keyed row into its new slot. Offset
          // the native transform by that same distance first so the row stays
          // under the finger instead of flashing at the new layout position.
          translateY.value -= (target - origin) * stepValue.value;
          runOnJS(commit)(target, origin);
          translateY.value = withSpring(
            0,
            {
              damping: 25,
              stiffness: 250,
              mass: 0.72,
              overshootClamping: true,
            },
            (finished) => {
              if (finished) runOnJS(finish)(false);
            },
          );
          scale.value = withSpring(1, {
            damping: 25,
            stiffness: 250,
          });
        })
        .onFinalize(() => {
          "worklet";
          const cancelled = !releasedValue.value;
          if (cancelled) {
            translateY.value = withSpring(0, {
              damping: 25,
              stiffness: 250,
              mass: 0.72,
              overshootClamping: true,
            });
            scale.value = withSpring(1, {
              damping: 25,
              stiffness: 250,
            });
            runOnJS(finish)(true);
          }
        }),
    [
      begin,
      commit,
      countValue,
      enabled,
      finish,
      indexValue,
      originValue,
      releasedValue,
      scale,
      stepValue,
      targetChanged,
      targetValue,
      translateY,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const setStep = useCallback(
    (next: number) => {
      stepValue.value = Math.max(1, next);
    },
    [stepValue],
  );

  return { animatedStyle, dragging, gesture, setStep };
}
