import { PropsWithChildren, useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const orderTransition = LinearTransition.duration(230).easing(
  Easing.out(Easing.cubic),
);

export function ReorderItem({
  children,
  style,
  active = false,
  shift = 0,
  settling = false,
  animateLayout = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  shift?: number;
  settling?: boolean;
  animateLayout?: boolean;
}>) {
  const offset = useSharedValue(shift);
  useEffect(() => {
    offset.value = settling
      ? shift
      : withTiming(shift, {
          duration: 130,
          easing: Easing.out(Easing.cubic),
        });
  }, [offset, settling, shift]);
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));
  return (
    <Animated.View
      layout={animateLayout && !active ? orderTransition : undefined}
      style={[
        {
          width: "100%",
          zIndex: active ? 10 : 0,
          elevation: active ? 10 : 0,
        },
        settling ? { transform: [{ translateY: 0 }] } : shiftStyle,
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
