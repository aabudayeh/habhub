import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Polygon,
  Rect,
} from "react-native-svg";

import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { statusBodyAppearance } from "@/src/domain/status";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import { BiologicalSex } from "@/src/types";

const BODY_WIDTH = 128;
const BODY_HEIGHT = 252;
const VIEWBOX_WIDTH = 180;
const VIEWBOX_HEIGHT = 356;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

type BodyVariant = BiologicalSex;

type Point = readonly [number, number];
type BodySegment =
  | { kind: "line"; end: Point }
  | { kind: "curve"; control1: Point; control2: Point; end: Point };

const point = ([x, y]: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function originalBodyPath(
  variant: BodyVariant,
  bodyMass: number,
  muscleProgress: number,
) {
  const center = VIEWBOX_WIDTH / 2;
  const positiveMass = Math.max(0, bodyMass);
  const muscle = Math.max(0, Math.min(1, muscleProgress));
  const headHalf =
    (variant === "male" ? 18.5 : variant === "female" ? 17.3 : 17.9) +
    positiveMass * 0.7;
  const neckHalf =
    (variant === "male" ? 12.2 : variant === "female" ? 10.2 : 11.2) +
    muscle * 1.2;
  const shoulderHalf =
    (variant === "male" ? 41 : variant === "female" ? 36.5 : 38.8) +
    muscle * 7 +
    bodyMass * 2.4;
  const waistHalf =
    (variant === "male" ? 24.5 : variant === "female" ? 21.5 : 23) +
    positiveMass * 10 +
    Math.min(0, bodyMass) * 3.5 +
    muscle * 0.7;
  const hipHalf =
    (variant === "male" ? 28 : variant === "female" ? 33.5 : 30.5) +
    positiveMass * 9 +
    Math.min(0, bodyMass) * 4.5 +
    muscle;
  const chestHalf =
    (variant === "male" ? 31 : variant === "female" ? 27.5 : 29.2) +
    positiveMass * 6 +
    muscle * (variant === "female" ? 3.5 : 6);
  const outerUpperArm =
    center + shoulderHalf + 6 + muscle * 2 + positiveMass * 1.7;
  const outerWrist = center + shoulderHalf + 1 + positiveMass * 1.2;
  const kneeOuter = center + 22 + positiveMass * 3.5 + muscle * 1.2;
  const calfOuter = center + 20 + positiveMass * 2.5 + muscle;
  const ankleOuter = center + 13 + positiveMass * 1.7;
  const start: Point = [center, 7];
  const segments: BodySegment[] = [
    {
      kind: "curve",
      control1: [center + headHalf * 0.72, 7],
      control2: [center + headHalf, 17],
      end: [center + headHalf, 30],
    },
    {
      kind: "curve",
      control1: [center + headHalf, 35],
      control2: [center + headHalf + 5, 34],
      end: [center + headHalf + 5, 41],
    },
    {
      kind: "curve",
      control1: [center + headHalf + 5, 47],
      control2: [center + headHalf + 2, 51],
      end: [center + headHalf, 48],
    },
    {
      kind: "curve",
      control1: [center + headHalf - 1, 54],
      control2: [center + neckHalf + 5, 57],
      end: [center + neckHalf + 4, 61],
    },
    {
      kind: "curve",
      control1: [center + neckHalf + 4, 66],
      control2: [center + neckHalf, 69],
      end: [center + neckHalf, 73],
    },
    {
      kind: "curve",
      control1: [center + neckHalf, 77],
      control2: [center + shoulderHalf * 0.7, 78],
      end: [center + shoulderHalf, 85],
    },
    {
      kind: "curve",
      control1: [center + shoulderHalf + 7, 91],
      control2: [outerUpperArm + 2, 104],
      end: [outerUpperArm, 122],
    },
    {
      kind: "curve",
      control1: [outerUpperArm - 1, 130],
      control2: [center + shoulderHalf + 4, 139],
      end: [center + shoulderHalf + 3, 145],
    },
    { kind: "line", end: [outerWrist, 180] },
    {
      kind: "curve",
      control1: [outerWrist + 5, 182],
      control2: [outerWrist + 8, 187],
      end: [outerWrist + 7, 192],
    },
    { kind: "line", end: [outerWrist + 10, 199] },
    {
      kind: "curve",
      control1: [outerWrist + 12, 203],
      control2: [outerWrist + 8, 206],
      end: [outerWrist + 6, 202],
    },
    { kind: "line", end: [outerWrist + 4, 196] },
    { kind: "line", end: [outerWrist + 6, 207] },
    {
      kind: "curve",
      control1: [outerWrist + 7, 211],
      control2: [outerWrist + 3, 212],
      end: [outerWrist + 2, 207],
    },
    { kind: "line", end: [outerWrist, 198] },
    { kind: "line", end: [outerWrist + 1, 209] },
    {
      kind: "curve",
      control1: [outerWrist + 1, 213],
      control2: [outerWrist - 3, 213],
      end: [outerWrist - 4, 208],
    },
    { kind: "line", end: [outerWrist - 5, 198] },
    { kind: "line", end: [outerWrist - 6, 206] },
    {
      kind: "curve",
      control1: [outerWrist - 7, 210],
      control2: [outerWrist - 10, 208],
      end: [outerWrist - 10, 204],
    },
    { kind: "line", end: [outerWrist - 11, 190] },
    {
      kind: "curve",
      control1: [outerWrist - 11, 185],
      control2: [outerWrist - 9, 181],
      end: [outerWrist - 6, 179],
    },
    { kind: "line", end: [center + shoulderHalf - 9, 143] },
    { kind: "line", end: [center + chestHalf + 7, 114] },
    {
      kind: "curve",
      control1: [center + chestHalf + 4, 123],
      control2: [center + chestHalf, 130],
      end: [center + chestHalf, 138],
    },
    {
      kind: "curve",
      control1: [center + chestHalf, 148],
      control2: [center + waistHalf, 151],
      end: [center + waistHalf, 160],
    },
    {
      kind: "curve",
      control1: [center + waistHalf, 171],
      control2: [center + hipHalf, 174],
      end: [center + hipHalf, 184],
    },
    {
      kind: "curve",
      control1: [center + hipHalf + 1, 203],
      control2: [kneeOuter + 4, 226],
      end: [kneeOuter, 246],
    },
    {
      kind: "curve",
      control1: [kneeOuter - 1, 261],
      control2: [calfOuter, 277],
      end: [calfOuter, 289],
    },
    { kind: "line", end: [ankleOuter, 325] },
    {
      kind: "curve",
      control1: [ankleOuter, 332],
      control2: [ankleOuter + 11, 337],
      end: [ankleOuter + 11, 343],
    },
    {
      kind: "curve",
      control1: [ankleOuter + 11, 348],
      control2: [center + 13, 351],
      end: [center + 7, 348],
    },
    {
      kind: "curve",
      control1: [center + 4, 346],
      control2: [center + 4, 337],
      end: [center + 6, 329],
    },
    { kind: "line", end: [center + 10, 250] },
    { kind: "line", end: [center + 5, 205] },
    {
      kind: "curve",
      control1: [center + 5, 198],
      control2: [center + 2, 193],
      end: [center, 191],
    },
  ];
  const mirror = ([x, y]: Point): Point => [center * 2 - x, y];
  const points = [start, ...segments.map((segment) => segment.end)];
  const right = segments
    .map((segment) =>
      segment.kind === "line"
        ? `L ${point(segment.end)}`
        : `C ${point(segment.control1)} ${point(segment.control2)} ${point(
            segment.end,
          )}`,
    )
    .join(" ");
  const left = segments
    .map((segment, index) => ({ segment, index }))
    .reverse()
    .map(({ segment, index }) => {
      const previous = mirror(points[index]);
      return segment.kind === "line"
        ? `L ${point(previous)}`
        : `C ${point(mirror(segment.control2))} ${point(
            mirror(segment.control1),
          )} ${point(previous)}`;
    })
    .join(" ");
  return `M ${point(start)} ${right} ${left} Z`;
}

function BodyDetails({
  bodyPath,
  color,
  mindTier,
  muscleTier,
  muscleProgress,
  variant,
}: {
  bodyPath: string;
  color: string;
  mindTier: 0 | 1 | 2 | 3;
  muscleTier: 0 | 1 | 2 | 3;
  muscleProgress: number;
  variant: BodyVariant;
}) {
  const shoulderY = variant === "male" ? 102 : 105;
  const muscleOpacity = 0.25 + Math.max(0, Math.min(1, muscleProgress)) * 0.2;
  return (
    <G>
      <Path
        d={bodyPath}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3.5}
      />
      {muscleTier >= 1 ? (
        <G
          fill="none"
          opacity={muscleOpacity}
          stroke={color}
          strokeLinecap="round"
          strokeWidth={2.2}
        >
          <Path d={`M 54 ${shoulderY} Q 62 96 69 105`} />
          <Path d={`M 126 ${shoulderY} Q 118 96 111 105`} />
        </G>
      ) : null}
      {muscleTier >= 2 ? (
        <G
          fill="none"
          opacity={muscleOpacity}
          stroke={color}
          strokeLinecap="round"
          strokeWidth={2.1}
        >
          <Path d="M 68 127 Q 79 135 89 132" />
          <Path d="M 112 127 Q 101 135 91 132" />
          <Path d="M 90 136 L 90 171" />
        </G>
      ) : null}
      {muscleTier >= 3 ? (
        <G
          fill="none"
          opacity={muscleOpacity}
          stroke={color}
          strokeLinecap="round"
          strokeWidth={1.9}
        >
          <Path d="M 80 149 Q 90 153 100 149" />
          <Path d="M 80 161 Q 90 165 100 161" />
          <Path d="M 81 174 Q 90 177 99 174" />
        </G>
      ) : null}
      {mindTier >= 1 ? (
        <G fill="none" stroke={color} strokeWidth={2.8}>
          <Rect x={72} y={34} width={16} height={11} rx={5} />
          <Rect x={92} y={34} width={16} height={11} rx={5} />
          <Line x1={88} y1={38.5} x2={92} y2={38.5} />
          <Line x1={72} y1={38} x2={67} y2={36.5} />
          <Line x1={108} y1={38} x2={113} y2={36.5} />
        </G>
      ) : null}
      {mindTier === 2 ? (
        <G fill="none" stroke={palette.amber} strokeWidth={2.2}>
          <Circle cx={100} cy={39.5} r={7.5} />
          <Path d="M 106 44 Q 111 52 108 62" />
        </G>
      ) : null}
      {mindTier >= 3 ? (
        <G>
          <Polygon points="63,12 90,2 117,12 90,22" fill={color} />
          <Path d="M 72 14 L 72 28 Q 90 36 108 28 L 108 14" fill={color} />
          <Line
            x1={114}
            y1={13}
            x2={114}
            y2={29}
            stroke={palette.amber}
            strokeWidth={2.2}
          />
          <Circle cx={114} cy={31} r={3} fill={palette.amber} />
        </G>
      ) : null}
    </G>
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
  const clipId = useId().replace(/:/g, "");
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const animatedProgress = useRef(new Animated.Value(clamped)).current;
  const ambientMotion = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    Animated.timing(animatedProgress, {
      duration: reduceMotion ? 0 : 720,
      toValue: clamped,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, clamped, reduceMotion]);

  useEffect(() => {
    ambientMotion.stopAnimation();
    ambientMotion.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientMotion, {
          duration: 2600,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(ambientMotion, {
          duration: 2600,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [ambientMotion, reduceMotion]);

  const fillHeight = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, VIEWBOX_HEIGHT],
  });
  const fillTop = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [VIEWBOX_HEIGHT, 0],
  });
  const percent = Math.round(clamped * 100);
  const boundedMuscle = Math.max(0, Math.min(1, muscleProgress));
  const appearance = useMemo(
    () => statusBodyAppearance(heightCm, weightKg, boundedMuscle),
    [boundedMuscle, heightCm, weightKg],
  );
  const bodyPath = useMemo(
    () => originalBodyPath(sex, appearance.bodyMass, boundedMuscle),
    [appearance.bodyMass, boundedMuscle, sex],
  );
  const ambientTranslate = ambientMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1.5],
  });
  const ambientScale = ambientMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.008],
  });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t("Tracked goals")}: ${percent}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={[
        styles.frame,
        {
          backgroundColor: colors.primarySoft,
          borderColor: colors.border,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.body,
          {
            transform: [
              { translateY: ambientTranslate },
              { scale: ambientScale },
              { scaleY: appearance.heightScale },
            ],
          },
        ]}
      >
        <Svg
          pointerEvents="none"
          width={BODY_WIDTH}
          height={BODY_HEIGHT}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        >
          <Defs>
            <ClipPath id={clipId}>
              <Path d={bodyPath} />
            </ClipPath>
          </Defs>
          <Path d={bodyPath} fill={colors.card} />
          <AnimatedRect
            clipPath={`url(#${clipId})`}
            fill={GOAL_COMPLETE_COLOR}
            height={fillHeight}
            width={VIEWBOX_WIDTH}
            x={0}
            y={fillTop}
          />
          <BodyDetails
            bodyPath={bodyPath}
            color={colors.ink}
            mindTier={mindTier}
            muscleProgress={boundedMuscle}
            muscleTier={appearance.muscleTier}
            variant={sex}
          />
        </Svg>
      </Animated.View>
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
    width: 164,
    height: 282,
    borderRadius: 82,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    overflow: "hidden",
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
