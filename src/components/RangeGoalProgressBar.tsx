import React from "react";
import { StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { palette, useAppColors } from "@/src/theme";

/** A value bar with the preferred interval marked directly on its track. */
export function RangeGoalProgressBar({
  value,
  range,
  color,
  unit,
  compact = false,
}: {
  value: number;
  range: { min: number; max: number };
  color: string;
  unit: string;
  compact?: boolean;
}) {
  const colors = useAppColors();
  const minimum = Math.min(range.min, range.max);
  const maximum = Math.max(range.min, range.max);
  const scaleMaximum = Math.max(maximum * 1.35, value * 1.1, 1);
  const fill = Math.min(1, Math.max(0, value / scaleMaximum));
  const rangeLeft = Math.min(1, Math.max(0, minimum / scaleMaximum));
  const rangeRight = Math.min(1, Math.max(rangeLeft, maximum / scaleMaximum));
  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      <View
        style={[
          styles.track,
          compact && styles.compactTrack,
          { backgroundColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.fill,
            { width: `${fill * 100}%`, backgroundColor: color },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.band,
            {
              left: `${rangeLeft * 100}%`,
              width: `${Math.max(0.012, rangeRight - rangeLeft) * 100}%`,
              borderColor: palette.lime,
              backgroundColor: `${palette.lime}20`,
            },
          ]}
        />
      </View>
      {!compact ? (
        <Text style={[styles.caption, { color: colors.muted }]}>
          Target {minimum}–{maximum} {unit}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 4 },
  compactWrap: { gap: 0 },
  track: { height: 9, borderRadius: 999, overflow: "hidden" },
  compactTrack: { height: 7 },
  fill: { height: "100%", borderRadius: 999 },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  caption: { fontSize: 8, fontWeight: "800" },
});
