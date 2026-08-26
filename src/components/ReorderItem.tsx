import { PropsWithChildren, useLayoutEffect } from "react";
import { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function ReorderItem({
  children,
  style,
  active = false,
  shift = 0,
  settling = false,
  onLayout,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  shift?: number;
  settling?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}>) {
  const offset = useSharedValue(shift);
  useLayoutEffect(() => {
    offset.value = settling
      ? 0
      : withTiming(shift, {
          duration: 130,
          easing: Easing.out(Easing.cubic),
        });
  }, [offset, settling, shift]);
  const shiftStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: settling ? 0 : offset.value }],
    }),
    [settling],
  );
  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        {
          width: "100%",
          zIndex: active ? 10 : 0,
          elevation: active ? 10 : 0,
        },
        shiftStyle,
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export type ReorderDragState = {
  id: string;
  origin: number;
  target: number;
  step: number;
  settling?: boolean;
};

export function reorderShift(index: number, drag: ReorderDragState | null) {
  if (!drag || drag.settling || index === drag.origin) return 0;
  if (drag.target > drag.origin && index > drag.origin && index <= drag.target)
    return -drag.step;
  if (drag.target < drag.origin && index >= drag.target && index < drag.origin)
    return drag.step;
  return 0;
}
