import { PropsWithChildren } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  LinearTransition,
} from "react-native-reanimated";

const glideTransition = LinearTransition.duration(260).easing(
  Easing.out(Easing.cubic),
);

export function ReorderItem({
  children,
  style,
  active = false,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; active?: boolean }>) {
  return (
    <Animated.View
      layout={active ? undefined : glideTransition}
      style={[{ width: "100%", zIndex: active ? 10 : 0 }, style]}
    >
      {children}
    </Animated.View>
  );
}
