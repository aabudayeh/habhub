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

function humanBodyPath(
  variant: BodyVariant,
  bodyMass: number,
  muscleProgress: number,
) {
  const center = VIEWBOX_WIDTH / 2;
  const positiveMass = Math.max(0, bodyMass);
  const muscle = Math.max(0, Math.min(1, muscleProgress));
  const headHalf =
    (variant === "male" ? 17.5 : variant === "female" ? 16.8 : 17.2) +
    positiveMass * 0.45;
  const neckHalf =
    (variant === "male" ? 11.5 : variant === "female" ? 10.2 : 10.8) +
    muscle * 0.8;
  const shoulderHalf =
    (variant === "male" ? 40 : variant === "female" ? 35.5 : 38) +
    muscle * 3.8 +
    bodyMass * 1.8;
  const waistHalf =
    (variant === "male" ? 23.5 : variant === "female" ? 22 : 23) +
    positiveMass * 7 +
    Math.min(0, bodyMass) * 2 +
    muscle * 0.5;
  const hipHalf =
    (variant === "male" ? 28 : variant === "female" ? 33 : 30.5) +
    positiveMass * 6 +
    Math.min(0, bodyMass) * 2.5 +
    muscle * 0.6;
  const chestHalf =
    (variant === "male" ? 31.5 : variant === "female" ? 29 : 30) +
    positiveMass * 4.5 +
    muscle * (variant === "female" ? 2 : 3);
  const upperArmOuter =
    center + shoulderHalf + 6 + muscle * 1.5 + positiveMass;
  const elbowOuter = center + shoulderHalf + 3 + muscle + positiveMass;
  const wristOuter = center + shoulderHalf - 1 + positiveMass;
  const upperArmInner = center + shoulderHalf - 10;
  const kneeOuter = center + 21 + positiveMass * 2.8 + muscle;
  const calfOuter = center + 23 + positiveMass * 2.3 + muscle;
  const ankleOuter = center + 13 + positiveMass * 1.4;
  const start: Point = [center, 10];
  const segments: BodySegment[] = [
    {
      kind: "curve",
      control1: [center + headHalf * 0.58, 10],
      control2: [center + headHalf, 17],
      end: [center + headHalf, 29],
    },
    {
      kind: "curve",
      control1: [center + headHalf, 34],
      control2: [center + headHalf + 3.8, 33],
      end: [center + headHalf + 3.8, 39],
    },
    {
      kind: "curve",
      control1: [center + headHalf + 3.8, 45],
      control2: [center + headHalf + 1, 48],
      end: [center + headHalf - 0.7, 45],
    },
    {
      kind: "curve",
      control1: [center + headHalf - 1.5, 53],
      control2: [center + neckHalf + 1.5, 58],
      end: [center + neckHalf + 1, 63],
    },
    {
      kind: "curve",
      control1: [center + neckHalf + 1, 67],
      control2: [center + neckHalf, 70],
      end: [center + neckHalf, 73],
    },
    {
      kind: "curve",
      control1: [center + neckHalf, 76],
      control2: [center + shoulderHalf * 0.68, 77],
      end: [center + shoulderHalf, 83],
    },
    {
      kind: "curve",
      control1: [center + shoulderHalf + 5, 88],
      control2: [upperArmOuter + 1, 101],
      end: [upperArmOuter, 113],
    },
    {
      kind: "curve",
      control1: [upperArmOuter, 124],
      control2: [elbowOuter + 1, 136],
      end: [elbowOuter, 144],
    },
    {
      kind: "curve",
      control1: [elbowOuter - 1, 154],
      control2: [wristOuter + 2, 168],
      end: [wristOuter, 180],
    },
    {
      kind: "curve",
      control1: [wristOuter + 4, 183],
      control2: [wristOuter + 5, 188],
      end: [wristOuter + 5, 192],
    },
    {
      kind: "curve",
      control1: [wristOuter + 5, 198],
      control2: [wristOuter + 2, 202],
      end: [wristOuter + 1, 207],
    },
    {
      kind: "curve",
      control1: [wristOuter, 211],
      control2: [wristOuter - 4, 212],
      end: [wristOuter - 6, 207],
    },
    {
      kind: "curve",
      control1: [wristOuter - 8, 201],
      control2: [wristOuter - 7, 190],
      end: [wristOuter - 7, 180],
    },
    {
      kind: "curve",
      control1: [upperArmInner + 4, 164],
      control2: [upperArmInner + 2, 151],
      end: [upperArmInner + 1, 143],
    },
    {
      kind: "curve",
      control1: [upperArmInner, 130],
      control2: [center + chestHalf - 4, 114],
      end: [center + chestHalf - 5, 105],
    },
    {
      kind: "curve",
      control1: [center + chestHalf - 1, 114],
      control2: [center + chestHalf, 124],
      end: [center + chestHalf, 134],
    },
    {
      kind: "curve",
      control1: [center + chestHalf - 1, 145],
      control2: [center + waistHalf, 151],
      end: [center + waistHalf, 159],
    },
    {
      kind: "curve",
      control1: [center + waistHalf, 169],
      control2: [center + hipHalf, 176],
      end: [center + hipHalf, 185],
    },
    {
      kind: "curve",
      control1: [center + hipHalf, 199],
      control2: [kneeOuter + 6, 218],
      end: [kneeOuter + 3, 235],
    },
    {
      kind: "curve",
      control1: [kneeOuter + 1, 244],
      control2: [kneeOuter, 250],
      end: [kneeOuter, 258],
    },
    {
      kind: "curve",
      control1: [kneeOuter, 270],
      control2: [calfOuter + 1, 280],
      end: [calfOuter - 1, 290],
    },
    {
      kind: "curve",
      control1: [calfOuter - 3, 307],
      control2: [ankleOuter + 2, 321],
      end: [ankleOuter, 330],
    },
    {
      kind: "curve",
      control1: [ankleOuter, 335],
      control2: [ankleOuter + 10, 339],
      end: [ankleOuter + 10, 343],
    },
    {
      kind: "curve",
      control1: [ankleOuter + 10, 347],
      control2: [center + 13, 349],
      end: [center + 8, 349],
    },
    {
      kind: "curve",
      control1: [center + 3, 349],
      control2: [center + 4, 339],
      end: [center + 8, 329],
    },
    {
      kind: "curve",
      control1: [center + 7, 309],
      control2: [center + 5, 278],
      end: [center + 7, 257],
    },
    {
      kind: "curve",
      control1: [center + 8, 239],
      control2: [center + 8, 220],
      end: [center + 6, 204],
    },
    {
      kind: "curve",
      control1: [center + 5, 197],
      control2: [center + 3, 192],
      end: [center, 189],
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
  const animatedProgress = useRef(new Animated.Value(0)).current;
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
    animatedProgress.stopAnimation();
    Animated.timing(animatedProgress, {
      duration: reduceMotion ? 0 : 900,
      toValue: clamped,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, clamped, reduceMotion]);

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
    () => humanBodyPath(sex, appearance.bodyMass, boundedMuscle),
    [appearance.bodyMass, boundedMuscle, sex],
  );
  const renderedHeight = Math.round(BODY_HEIGHT * appearance.heightScale);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t("Tracked goals")}: ${percent}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={styles.frame}
    >
      <Svg
        pointerEvents="none"
        width={BODY_WIDTH}
        height={renderedHeight}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      >
        <Defs>
          <ClipPath id={clipId}>
            <Path d={bodyPath} />
          </ClipPath>
        </Defs>
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
    alignItems: "center",
    justifyContent: "center",
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
