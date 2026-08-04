import { useEffect, useRef } from "react";
import { Animated } from "react-native";

/** Keep the native-thread edit cue active for the full edit-mode session. */
export function useEditWiggle(active: boolean) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);
    if (!active) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 145,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: -1,
          duration: 290,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 145,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      value.stopAnimation();
      value.setValue(0);
    };
  }, [active, value]);

  return value;
}
