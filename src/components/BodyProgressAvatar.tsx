import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
} from "react-native";
import Svg, {
  Circle,
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

const BODY_WIDTH = 126;
const BODY_HEIGHT = 210;
const VIEWBOX_WIDTH = 180;
const VIEWBOX_HEIGHT = 300;

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
    (variant === "male" ? 19 : variant === "female" ? 17.8 : 18.4) +
    positiveMass * 0.8;
  const neckHalf =
    (variant === "male" ? 12.5 : variant === "female" ? 10.3 : 11.4) +
    muscle * 1.4;
  const shoulderHalf =
    (variant === "male" ? 44 : variant === "female" ? 37 : 40.5) +
    muscle * 8 +
    bodyMass * 2.8;
  const waistHalf =
    (variant === "male" ? 27 : variant === "female" ? 22 : 24.5) +
    positiveMass * 11 +
    Math.min(0, bodyMass) * 4 +
    muscle * 0.8;
  const hipHalf =
    (variant === "male" ? 30 : variant === "female" ? 35 : 32.5) +
    positiveMass * 10 +
    Math.min(0, bodyMass) * 5 +
    muscle * 1.2;
  const chestHalf =
    (variant === "male" ? 32 : variant === "female" ? 28 : 30) +
    positiveMass * 7 +
    muscle * (variant === "female" ? 4 : 7);
  const outerUpperArm =
    center + shoulderHalf + 7 + muscle * 2.5 + positiveMass * 2;
  const outerWrist = center + shoulderHalf + 10 + positiveMass * 1.5;
  const kneeOuter = center + 23 + positiveMass * 4 + muscle * 1.5;
  const ankleOuter = center + 15 + positiveMass * 2;
  const start: Point = [center, 8];
  const segments: BodySegment[] = [
    {
      kind: "curve",
      control1: [center + headHalf * 0.72, 8],
      control2: [center + headHalf, 20],
      end: [center + headHalf, 36],
    },
    {
      kind: "curve",
      control1: [center + headHalf, 39],
      control2: [center + headHalf + 5, 38],
      end: [center + headHalf + 5, 44],
    },
    {
      kind: "curve",
      control1: [center + headHalf + 5, 49],
      control2: [center + headHalf + 2, 54],
      end: [center + headHalf, 50],
    },
    {
      kind: "curve",
      control1: [center + headHalf, 55],
      control2: [center + neckHalf + 5, 58],
      end: [center + neckHalf + 4, 63],
    },
    {
      kind: "curve",
      control1: [center + neckHalf + 4, 69],
      control2: [center + neckHalf, 72],
      end: [center + neckHalf, 76],
    },
    {
      kind: "curve",
      control1: [center + neckHalf, 81],
      control2: [center + shoulderHalf * 0.7, 82],
      end: [center + shoulderHalf, 88],
    },
    {
      kind: "curve",
      control1: [center + shoulderHalf + 9, 94],
      control2: [outerUpperArm + 2, 108],
      end: [outerUpperArm, 123],
    },
    { kind: "line", end: [center + shoulderHalf + 5, 151] },
    { kind: "line", end: [outerWrist, 211] },
    {
      kind: "curve",
      control1: [outerWrist + 6, 214],
      control2: [outerWrist + 10, 219],
      end: [outerWrist + 8, 226],
    },
    { kind: "line", end: [outerWrist + 13, 238] },
    {
      kind: "curve",
      control1: [outerWrist + 14, 242],
      control2: [outerWrist + 10, 244],
      end: [outerWrist + 8, 240],
    },
    { kind: "line", end: [outerWrist + 5, 232] },
    { kind: "line", end: [outerWrist + 8, 245] },
    {
      kind: "curve",
      control1: [outerWrist + 9, 250],
      control2: [outerWrist + 4, 251],
      end: [outerWrist + 3, 246],
    },
    { kind: "line", end: [outerWrist + 1, 235] },
    { kind: "line", end: [outerWrist + 2, 248] },
    {
      kind: "curve",
      control1: [outerWrist + 2, 253],
      control2: [outerWrist - 3, 253],
      end: [outerWrist - 4, 248],
    },
    { kind: "line", end: [outerWrist - 5, 236] },
    { kind: "line", end: [outerWrist - 6, 246] },
    {
      kind: "curve",
      control1: [outerWrist - 7, 251],
      control2: [outerWrist - 11, 249],
      end: [outerWrist - 11, 245],
    },
    { kind: "line", end: [outerWrist - 12, 229] },
    {
      kind: "curve",
      control1: [outerWrist - 13, 222],
      control2: [outerWrist - 10, 216],
      end: [outerWrist - 6, 213],
    },
    { kind: "line", end: [outerWrist - 11, 211] },
    { kind: "line", end: [center + shoulderHalf - 6, 151] },
    { kind: "line", end: [center + shoulderHalf * 0.66, 118] },
    {
      kind: "curve",
      control1: [center + shoulderHalf * 0.64, 126],
      control2: [center + chestHalf, 134],
      end: [center + chestHalf, 143],
    },
    {
      kind: "curve",
      control1: [center + chestHalf, 152],
      control2: [center + waistHalf, 155],
      end: [center + waistHalf, 164],
    },
    {
      kind: "curve",
      control1: [center + waistHalf, 177],
      control2: [center + hipHalf, 182],
      end: [center + hipHalf, 194],
    },
    {
      kind: "curve",
      control1: [center + hipHalf + 1, 211],
      control2: [kneeOuter + 3, 228],
      end: [kneeOuter, 241],
    },
    { kind: "line", end: [ankleOuter, 272] },
    {
      kind: "curve",
      control1: [ankleOuter, 280],
      control2: [ankleOuter + 10, 286],
      end: [ankleOuter + 10, 291],
    },
    {
      kind: "curve",
      control1: [ankleOuter + 10, 296],
      control2: [center + 13, 298],
      end: [center + 6, 295],
    },
    {
      kind: "curve",
      control1: [center + 2, 293],
      control2: [center + 2, 286],
      end: [center + 4, 281],
    },
    { kind: "line", end: [center + 7, 273] },
    { kind: "line", end: [center + 7, 241] },
    { kind: "line", end: [center + 5, 211] },
    {
      kind: "curve",
      control1: [center + 5, 204],
      control2: [center + 2, 199],
      end: [center, 198],
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

function BodyLayer({
  bodyPath,
  fill,
  outline,
}: {
  bodyPath: string;
  fill: string;
  outline?: string;
}) {
  return (
    <Svg
      pointerEvents="none"
      width={BODY_WIDTH}
      height={BODY_HEIGHT}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    >
      <Path
        d={bodyPath}
        fill={fill}
        stroke={outline}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={outline ? 3.5 : 0}
      />
    </Svg>
  );
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
    <Svg
      pointerEvents="none"
      width={BODY_WIDTH}
      height={BODY_HEIGHT}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    >
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
    </Svg>
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
    outputRange: [0, BODY_HEIGHT],
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
        <BodyLayer bodyPath={bodyPath} fill={colors.card} />
        <Animated.View style={[styles.fillClip, { height: fillHeight }]}>
          <View style={styles.fillBody}>
            <BodyLayer bodyPath={bodyPath} fill={GOAL_COMPLETE_COLOR} />
          </View>
        </Animated.View>
        <BodyDetails
          bodyPath={bodyPath}
          color={colors.ink}
          mindTier={mindTier}
          muscleProgress={boundedMuscle}
          muscleTier={appearance.muscleTier}
          variant={sex}
        />
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
    width: 160,
    height: 238,
    borderRadius: 80,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
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
