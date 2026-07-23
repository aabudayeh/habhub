import { PropsWithChildren } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  LinearTransition,
} from "react-native-reanimated";

const glideTransition = LinearTransition.duration(620).easing(
  Easing.inOut(Easing.cubic),
);

export function ReorderItem({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <Animated.View
      layout={glideTransition}
      style={[{ width: "100%" }, style]}
    >
      {children}
    </Animated.View>
  );
}
