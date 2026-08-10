import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { useLocalization } from "@/src/i18n";
import { useAppColors } from "@/src/theme";
import { BiologicalSex } from "@/src/types";

const BODY_WIDTH = 116;
const BODY_HEIGHT = 190;

type BodyVariant = BiologicalSex;

type Shape = {
  borderRadius: number;
  height: number;
  left: number;
  rotate?: string;
  top: number;
  width: number;
};

function bodyShapes(variant: BodyVariant): Shape[] {
  const female = variant === "female";
  const male = variant === "male";
  const torsoLeft = female ? 35 : male ? 29 : 33;
  const torsoWidth = female ? 46 : male ? 58 : 50;
  const hipLeft = female ? 29 : male ? 35 : 32;
  const hipWidth = female ? 58 : male ? 46 : 52;

  return [
    { left: 44, top: 3, width: 28, height: 28, borderRadius: 14 },
    { left: 52, top: 29, width: 12, height: 13, borderRadius: 6 },
    {
      left: torsoLeft,
      top: 38,
      width: torsoWidth,
      height: female ? 65 : 68,
      borderRadius: female ? 23 : 20,
    },
    {
      left: hipLeft,
      top: 91,
      width: hipWidth,
      height: female ? 35 : 30,
      borderRadius: female ? 18 : 14,
    },
    {
      left: male ? 18 : 21,
      top: 43,
      width: 13,
      height: 78,
      borderRadius: 7,
      rotate: "7deg",
    },
    {
      left: male ? 85 : 82,
      top: 43,
      width: 13,
      height: 78,
      borderRadius: 7,
      rotate: "-7deg",
    },
    { left: 35, top: 111, width: 19, height: 70, borderRadius: 10 },
    { left: 62, top: 111, width: 19, height: 70, borderRadius: 10 },
    { left: 29, top: 174, width: 27, height: 12, borderRadius: 7 },
    { left: 60, top: 174, width: 27, height: 12, borderRadius: 7 },
  ];
}

function BodyLayer({ color, variant }: { color: string; variant: BodyVariant }) {
  const shapes = useMemo(() => bodyShapes(variant), [variant]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {shapes.map((shape, index) => (
        <View
          key={index}
          style={[
            styles.shape,
            {
              backgroundColor: color,
              borderRadius: shape.borderRadius,
              height: shape.height,
              left: shape.left,
              top: shape.top,
              transform: shape.rotate ? [{ rotate: shape.rotate }] : undefined,
              width: shape.width,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function BodyProgressAvatar({
  progress,
  sex = "unspecified",
}: {
  progress: number;
  sex?: BiologicalSex;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const animatedProgress = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    Animated.timing(animatedProgress, {
      duration: 650,
      toValue: clamped,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, clamped]);

  const fillHeight = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, BODY_HEIGHT],
  });
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("Tracked goals")}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={[
        styles.frame,
        {
          backgroundColor: colors.primarySoft,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.body}>
        <BodyLayer color={colors.faint} variant={sex} />
        <Animated.View style={[styles.fillClip, { height: fillHeight }]}>
          <View style={styles.fillBody}>
            <BodyLayer color={GOAL_COMPLETE_COLOR} variant={sex} />
          </View>
        </Animated.View>
      </View>
      <View
        pointerEvents="none"
        style={[styles.percentPill, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Animated.Text style={[styles.percent, { color: colors.ink }]}>
          {percent}%
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 154,
    height: 224,
    borderRadius: 77,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
  },
  shape: { position: "absolute" },
  fillClip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: BODY_WIDTH,
    overflow: "hidden",
  },
  fillBody: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
  },
  percentPill: {
    position: "absolute",
    right: -8,
    bottom: 20,
    minWidth: 49,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
  },
  percent: { fontSize: 12, fontWeight: "900" },
});
