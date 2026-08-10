import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
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

function bodyShapes(variant: BodyVariant, muscleProgress: number): Shape[] {
  const female = variant === "female";
  const male = variant === "male";
  const muscle = Math.max(0, Math.min(1, muscleProgress));
  const shoulderLeft = female ? 26 : male ? 20 : 23;
  const shoulderWidth = female ? 64 : male ? 76 : 70;
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
    { left: 44, top: 1, width: 28, height: 34, borderRadius: 16 },
    { left: 42, top: 13, width: 5, height: 10, borderRadius: 4 },
    { left: 69, top: 13, width: 5, height: 10, borderRadius: 4 },
    { left: 48, top: 22, width: 20, height: 15, borderRadius: 9 },
    { left: 52, top: 30, width: 12, height: 15, borderRadius: 7 },
    {
      left: shoulderLeft - muscle * 3,
      top: 42,
      width: shoulderWidth + muscle * 6,
      height: 22,
      borderRadius: 12,
    },
    {
      left: chestLeft - muscle * 3,
      top: 40,
      width: chestWidth + muscle * 6,
      height: female ? 64 : 67,
      borderRadius: female ? 20 : 18,
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
      width: 13 + muscle * 4,
      height: 49,
      borderRadius: 9,
      rotate: "11deg",
    },
    {
      left: armRight,
      top: 47,
      width: 13 + muscle * 4,
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
    {
      left: female ? 30 : 31,
      top: 178,
      width: 24,
      height: 9,
      borderRadius: 7,
      rotate: "-2deg",
    },
    {
      left: female ? 62 : 61,
      top: 178,
      width: 24,
      height: 9,
      borderRadius: 7,
      rotate: "2deg",
    },
  ];
}

function BodyLayer({
  color,
  muscleProgress,
  variant,
}: {
  color: string;
  muscleProgress: number;
  variant: BodyVariant;
}) {
  const shapes = useMemo(
    () => bodyShapes(variant, muscleProgress),
    [muscleProgress, variant],
  );
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
  heightCm = 170,
  mindTier = 0,
  muscleProgress = 0,
  progress,
  sex = "unspecified",
  weightKg = 70,
}: {
  heightCm?: number;
  mindTier?: 0 | 1 | 2 | 3;
  muscleProgress?: number;
  progress: number;
  sex?: BiologicalSex;
  weightKg?: number;
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
  const heightM = Math.max(1.3, Math.min(2.2, heightCm / 100));
  const bmi = weightKg / (heightM * heightM);
  const bodyScaleX = Math.max(0.86, Math.min(1.18, 0.9 + (bmi - 17) * 0.016));
  const bodyScaleY = Math.max(
    0.92,
    Math.min(1.06, 0.92 + ((heightCm - 145) / 65) * 0.14),
  );
  const boundedMuscle = Math.max(0, Math.min(1, muscleProgress));

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
      <View
        style={[
          styles.body,
          { transform: [{ scaleX: bodyScaleX }, { scaleY: bodyScaleY }] },
        ]}
      >
        <BodyLayer
          color={colors.faint}
          muscleProgress={boundedMuscle}
          variant={sex}
        />
        <Animated.View style={[styles.fillClip, { height: fillHeight }]}>
          <View style={styles.fillBody}>
            <BodyLayer
              color={GOAL_COMPLETE_COLOR}
              muscleProgress={boundedMuscle}
              variant={sex}
            />
          </View>
        </Animated.View>
        {mindTier >= 1 ? (
          <View pointerEvents="none" style={styles.glasses}>
            <View style={[styles.lens, { borderColor: colors.ink }]} />
            <View style={[styles.glassesBridge, { backgroundColor: colors.ink }]} />
            <View style={[styles.lens, { borderColor: colors.ink }]} />
          </View>
        ) : null}
        {mindTier >= 2 ? (
          <View pointerEvents="none" style={styles.monocleAccent}>
            <View style={[styles.monocleRim, { borderColor: palette.amber }]} />
            <View style={[styles.monocleChain, { backgroundColor: palette.amber }]} />
          </View>
        ) : null}
        {mindTier >= 3 ? (
          <View pointerEvents="none" style={styles.cap}>
            <View style={[styles.capCrown, { backgroundColor: palette.amber }]} />
            <View style={[styles.capBrim, { backgroundColor: colors.ink }]} />
          </View>
        ) : null}
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
  glasses: {
    position: "absolute",
    left: 43,
    top: 12,
    width: 30,
    height: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  lens: {
    width: 12,
    height: 9,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  glassesBridge: { width: 6, height: 1.5 },
  monocleAccent: {
    position: "absolute",
    left: 59,
    top: 11,
    width: 19,
    height: 33,
  },
  monocleRim: {
    width: 13,
    height: 11,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  monocleChain: {
    position: "absolute",
    left: 11,
    top: 10,
    width: 1,
    height: 23,
    transform: [{ rotate: "-12deg" }],
  },
  cap: {
    position: "absolute",
    left: 38,
    top: -5,
    width: 41,
    height: 14,
    alignItems: "center",
  },
  capCrown: {
    width: 27,
    height: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    transform: [{ rotate: "-3deg" }],
  },
  capBrim: { width: 41, height: 3, borderRadius: 2, marginTop: -1 },
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
