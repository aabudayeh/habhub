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
  const shoulderLeft = female ? 27 : male ? 22 : 25;
  const shoulderRight = female ? 69 : male ? 74 : 71;
  const chestLeft = female ? 34 : male ? 30 : 32;
  const chestWidth = female ? 48 : male ? 56 : 52;
  const waistLeft = female ? 39 : male ? 35 : 37;
  const waistWidth = female ? 38 : male ? 46 : 42;
  const hipLeft = female ? 29 : male ? 34 : 32;
  const hipWidth = female ? 58 : male ? 48 : 52;
  const armLeft = male ? 19 : 22;
  const armRight = male ? 84 : 81;

  return [
    // An overlapping set of soft ovals creates one organic silhouette while
    // remaining fully code-native on Android, iOS, and web.
    { left: 44.5, top: 2, width: 27, height: 31, borderRadius: 14 },
    { left: 52, top: 30, width: 12, height: 15, borderRadius: 7 },
    {
      left: shoulderLeft,
      top: 43,
      width: 21,
      height: 20,
      borderRadius: 10,
    },
    {
      left: shoulderRight,
      top: 43,
      width: 21,
      height: 20,
      borderRadius: 10,
    },
    {
      left: chestLeft,
      top: 40,
      width: chestWidth,
      height: female ? 56 : 59,
      borderRadius: female ? 24 : 25,
    },
    {
      left: waistLeft,
      top: 78,
      width: waistWidth,
      height: 39,
      borderRadius: 18,
    },
    {
      left: hipLeft,
      top: 101,
      width: hipWidth,
      height: female ? 29 : 27,
      borderRadius: female ? 16 : 14,
    },
    {
      left: armLeft,
      top: 47,
      width: 13,
      height: 49,
      borderRadius: 9,
      rotate: "11deg",
    },
    {
      left: armRight,
      top: 47,
      width: 13,
      height: 49,
      borderRadius: 9,
      rotate: "-11deg",
    },
    {
      left: male ? 15 : 18,
      top: 86,
      width: 11,
      height: 45,
      borderRadius: 8,
      rotate: "5deg",
    },
    {
      left: male ? 89 : 86,
      top: 86,
      width: 11,
      height: 45,
      borderRadius: 8,
      rotate: "-5deg",
    },
    { left: male ? 14 : 17, top: 124, width: 11, height: 16, borderRadius: 8 },
    { left: male ? 90 : 87, top: 124, width: 11, height: 16, borderRadius: 8 },
    {
      left: female ? 32 : 34,
      top: 116,
      width: female ? 21 : 20,
      height: 48,
      borderRadius: 12,
      rotate: "2deg",
    },
    {
      left: female ? 63 : 62,
      top: 116,
      width: female ? 21 : 20,
      height: 48,
      borderRadius: 12,
      rotate: "-2deg",
    },
    {
      left: female ? 34 : 35,
      top: 153,
      width: female ? 17 : 18,
      height: 31,
      borderRadius: 10,
      rotate: "2deg",
    },
    {
      left: female ? 65 : 63,
      top: 153,
      width: female ? 17 : 18,
      height: 31,
      borderRadius: 10,
      rotate: "-2deg",
    },
    { left: female ? 28 : 29, top: 178, width: 27, height: 10, borderRadius: 7 },
    { left: female ? 61 : 60, top: 178, width: 27, height: 10, borderRadius: 7 },
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
