import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Platform, StyleSheet } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { AppText, AppTextInput } from "@/src/components/AppText";
import {
  claimColdLaunchMetricAnimation,
  coldLaunchMetricAnimationSnapshot,
  subscribeColdLaunchMetricAnimation,
} from "@/src/animation/coldLaunchMetricAnimation";
import {
  animatedMetricValueAtProgress,
  animatedMetricValueFormat,
  formatAnimatedMetricValue,
} from "@/src/domain/animatedMetricValue";
import { formatMetricValue } from "@/src/domain/metrics";
import type { HealthSyncStatus } from "@/src/health/HealthSyncProvider";
import { useFontScale } from "@/src/theme";
import type { MetricDefinition } from "@/src/types";

const AnimatedTextInput = Animated.createAnimatedComponent(AppTextInput);
const COUNT_DURATION_MS = 1_150;
const HEALTH_SETTLE_DELAY_MS = 1_400;
const HEALTH_CHECK_TIMEOUT_MS = 2_400;

/** One shared UI-thread progress value drives every visible Today metric. */
export function useColdLaunchMetricProgress(
  healthStatus: HealthSyncStatus,
  healthSyncMarker: string | null,
) {
  const phase = useSyncExternalStore(
    subscribeColdLaunchMetricAnimation,
    coldLaunchMetricAnimationSnapshot,
    coldLaunchMetricAnimationSnapshot,
  );
  const progress = useSharedValue(phase === "consumed" ? 1 : 0);
  const reduceMotion = useReducedMotion();
  const armedAt = React.useRef<number | null>(null);
  const claimedHere = React.useRef(false);

  useEffect(() => {
    // Root routing makes the one-time launch decision in a parent passive
    // effect. Keep the initial value at zero while that decision is pending;
    // otherwise the final number can flash for one frame before an eligible
    // launch resets to zero and begins counting.
    if (phase === "pending") {
      if (!claimedHere.current) progress.value = 0;
      return;
    }
    if (phase === "consumed") {
      if (!claimedHere.current) progress.value = 1;
      return;
    }
    if (reduceMotion) {
      claimedHere.current = claimColdLaunchMetricAnimation("today");
      progress.value = 1;
      return;
    }
    progress.value = 0;
    armedAt.current ??= Date.now();
    const healthPending =
      healthStatus === "checking" ||
      healthStatus === "requesting" ||
      healthStatus === "syncing";
    const requestedDelay = healthPending
      ? HEALTH_CHECK_TIMEOUT_MS
      : healthStatus === "ready"
        ? HEALTH_SETTLE_DELAY_MS
        : 120;
    const elapsed = Date.now() - armedAt.current;
    const delay = Math.max(0, Math.min(requestedDelay, HEALTH_CHECK_TIMEOUT_MS - elapsed));
    const timer = setTimeout(() => {
      if (!claimColdLaunchMetricAnimation("today")) return;
      claimedHere.current = true;
      progress.value = withTiming(1, {
        duration: COUNT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [healthStatus, healthSyncMarker, phase, progress, reduceMotion]);

  return progress;
}

export function ColdLaunchMetricValue({
  metric,
  value,
  locale,
  progress,
  style,
}: {
  metric: MetricDefinition;
  value: number;
  locale?: string;
  progress: SharedValue<number>;
  style?: StyleProp<TextStyle>;
}) {
  const format = useMemo(
    () => animatedMetricValueFormat(metric, value, locale),
    [locale, metric, value],
  );
  const finalText = useMemo(
    () => formatMetricValue(metric, value, locale),
    [locale, metric, value],
  );
  const sizingStyle = useAnimatedTextSizing(style);
  const animatedProps = useAnimatedProps(() => {
    const displayValue = animatedMetricValueAtProgress(
      0,
      value,
      progress.value,
    );
    const text = formatAnimatedMetricValue(displayValue, format);
    return { text, defaultValue: text };
  }, [format, progress, value]);

  return (
    <AnimatedTextInput
      accessibilityLabel={finalText}
      allowFontScaling={false}
      animatedProps={animatedProps}
      caretHidden
      defaultValue={finalText}
      editable={false}
      focusable={false}
      pointerEvents="none"
      scrollEnabled={false}
      style={[styles.text, style, sizingStyle]}
      translate={false}
      underlineColorAndroid="transparent"
    />
  );
}

export function ColdLaunchCountValue({
  value,
  total,
  progress,
  style,
}: {
  value: number;
  total: number;
  progress: SharedValue<number>;
  style?: StyleProp<TextStyle>;
}) {
  const finalText = `${value} of ${total}`;
  const [animationSettled, setAnimationSettled] = useState(() =>
    coldLaunchMetricAnimationSnapshot() === "consumed",
  );
  const settleAnimation = useCallback(() => {
    setAnimationSettled(true);
  }, []);
  const sizingStyle = useAnimatedTextSizing(style);
  const animatedProps = useAnimatedProps(() => {
    const count = Math.round(
      animatedMetricValueAtProgress(0, value, progress.value),
    );
    const text = `${count} of ${total}`;
    return { text, defaultValue: text };
  }, [progress, total, value]);

  // Keep the one-time launch count on the UI thread, then permanently swap to
  // React Native's stable Text layout. Android can vertically mis-measure a
  // non-editable TextInput after its animated `text` prop is retargeted by a
  // later sync. Crossing to React only once avoids both that retained input and
  // frame-by-frame JS work; later goal updates render immediately as normal text.
  useAnimatedReaction(
    () => progress.value >= 1,
    (settled, previouslySettled) => {
      if (settled && !previouslySettled) runOnJS(settleAnimation)();
    },
    [progress, settleAnimation],
  );

  if (animationSettled) {
    return (
      <AppText
        accessibilityLabel={finalText}
        numberOfLines={1}
        preserveColor
        style={style}
        translate={false}
      >
        {finalText}
      </AppText>
    );
  }

  return (
    <AnimatedTextInput
      accessibilityLabel={finalText}
      allowFontScaling={false}
      animatedProps={animatedProps}
      caretHidden
      defaultValue={finalText}
      editable={false}
      focusable={false}
      pointerEvents="none"
      scrollEnabled={false}
      style={resolveCountTextStyle(style, sizingStyle)}
      translate={false}
      underlineColorAndroid="transparent"
    />
  );
}

function resolveCountTextStyle(
  style: StyleProp<TextStyle>,
  sizingStyle: TextStyle,
) {
  const resolved = StyleSheet.flatten([
    styles.text,
    style,
    sizingStyle,
  ]) as TextStyle | undefined;
  if (Platform.OS !== "web" || typeof resolved?.color !== "string") {
    return resolved;
  }
  return {
    ...resolved,
    WebkitTextFillColor: resolved.color,
  } as TextStyle & { WebkitTextFillColor: string };
}

function useAnimatedTextSizing(style: StyleProp<TextStyle>) {
  const fontScale = useFontScale();
  const flattened = StyleSheet.flatten(style);
  const baseFontSize = flattened?.fontSize ?? 14;
  const baseLineHeight = flattened?.lineHeight ?? Math.ceil(baseFontSize * 1.3);
  return {
    height: baseLineHeight * fontScale,
    lineHeight: baseLineHeight * fontScale,
  };
}

const styles = StyleSheet.create({
  text: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderWidth: 0,
    margin: 0,
    padding: 0,
    textAlignVertical: "center",
  },
});
