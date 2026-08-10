import { FontAwesome6 } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import { BiologicalSex } from "@/src/types";

const BODY_WIDTH = 116;
const BODY_HEIGHT = 190;

type BodyVariant = BiologicalSex;

function BodyLayer({
  color,
  muscleProgress,
  variant,
}: {
  color: string;
  muscleProgress: number;
  variant: BodyVariant;
}) {
  const presentation = useMemo(() => {
    const muscle = Math.max(0, Math.min(1, muscleProgress));
    return {
      icon: variant === "female" ? "person-dress" : "person",
      size: variant === "female" ? 154 : 164,
      scaleX:
        (variant === "female" ? 0.98 : variant === "male" ? 1.03 : 1) +
        muscle * 0.06,
    } as const;
  }, [muscleProgress, variant]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <FontAwesome6
        name={presentation.icon}
        size={presentation.size}
        color={color}
        style={[
          styles.bodyGlyph,
          { transform: [{ scaleX: presentation.scaleX }] },
        ]}
      />
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
  bodyGlyph: {
    position: "absolute",
    left: 0,
    top: 12,
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    lineHeight: BODY_HEIGHT - 12,
    textAlign: "center",
  },
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
