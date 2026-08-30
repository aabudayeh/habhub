import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { palette, typography, useAppColors, useGroupAccent } from "@/src/theme";

type WeightQuickSliderProps = {
  lastWeight: number;
  unit: string;
  value: string;
  onChange: (value: string) => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundedWeight(value: number) {
  return Math.round(value * 10) / 10;
}

export function WeightQuickSlider({
  lastWeight,
  unit,
  value,
  onChange,
}: WeightQuickSliderProps) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [trackWidth, setTrackWidth] = useState(0);
  const trackPageXRef = useRef(0);
  const range = useMemo(() => {
    const span = clamp(lastWeight * 0.18, 10, 25);
    return {
      minimum: Math.max(1, roundedWeight(lastWeight - span)),
      maximum: roundedWeight(lastWeight + span),
    };
  }, [lastWeight]);
  const normalizedValue = value.trim().replace(",", ".");
  const parsed = normalizedValue ? Number(normalizedValue) : Number.NaN;
  const current = Number.isFinite(parsed)
    ? clamp(parsed, range.minimum, range.maximum)
    : lastWeight;
  const progress =
    (current - range.minimum) / Math.max(0.1, range.maximum - range.minimum);

  function selectAt(offset: number) {
    if (trackWidth <= 0) return;
    const ratio = clamp(offset / trackWidth, 0, 1);
    const next = roundedWeight(
      range.minimum + ratio * (range.maximum - range.minimum),
    );
    onChange(next.toFixed(1));
  }

  function step(direction: -1 | 1) {
    onChange(
      roundedWeight(clamp(current + direction * 0.1, range.minimum, range.maximum)).toFixed(1),
    );
  }

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.captionRow}>
        <Text style={[styles.caption, { color: colors.muted }]}>Last logged</Text>
        <Text translate={false} style={[styles.lastValue, { color: accent }]}>
          {lastWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
        </Text>
      </View>
      <View style={styles.controlRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease weight"
          onPress={() => step(-1)}
          style={[styles.stepButton, { borderColor: colors.border }]}
        >
          <Ionicons name="remove" size={15} color={accent} />
        </Pressable>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Weight slider"
          accessibilityValue={{
            min: range.minimum,
            max: range.maximum,
            now: current,
            text: `${current.toFixed(1)} ${unit}`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "increment") step(1);
            if (event.nativeEvent.actionName === "decrement") step(-1);
          }}
          onLayout={handleLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onResponderGrant={(event) => {
            trackPageXRef.current =
              event.nativeEvent.pageX - event.nativeEvent.locationX;
            selectAt(event.nativeEvent.locationX);
          }}
          onResponderMove={(event) =>
            selectAt(event.nativeEvent.pageX - trackPageXRef.current)
          }
          onResponderTerminationRequest={() => false}
          style={styles.trackTouchTarget}
        >
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: accent, width: `${progress * 100}%` },
              ]}
            />
            <View
              style={[
                styles.thumb,
                { backgroundColor: accent, left: `${progress * 100}%` },
              ]}
            />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase weight"
          onPress={() => step(1)}
          style={[styles.stepButton, { borderColor: colors.border }]}
        >
          <Ionicons name="add" size={15} color={accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: -3, marginBottom: 11 },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  caption: { ...typography.supporting, fontWeight: "800" },
  lastValue: { ...typography.supporting, fontWeight: "900" },
  controlRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepButton: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  trackTouchTarget: { flex: 1, height: 32, justifyContent: "center" },
  track: { height: 6, borderRadius: 999, position: "relative" },
  fill: { height: 6, borderRadius: 999 },
  thumb: {
    position: "absolute",
    top: -5,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
});
