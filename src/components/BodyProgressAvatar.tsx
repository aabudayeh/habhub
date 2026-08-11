import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Stop,
} from "react-native-svg";

import { AppText as Text } from "@/src/components/AppText";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  STATUS_AVATAR_VIEWBOX,
  statusAvatarGeometry,
  statusBodyAppearance,
  type StatusAvatarGeometry,
} from "@/src/domain/statusAvatar";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import { BiologicalSex, StatusAvatarStyle } from "@/src/types";

const BODY_WIDTH = 132;
const BODY_HEIGHT = 278;
const VIEWBOX_WIDTH = STATUS_AVATAR_VIEWBOX.width;
const VIEWBOX_HEIGHT = STATUS_AVATAR_VIEWBOX.height;
const CENTER_X = VIEWBOX_WIDTH / 2;

type Point = readonly [number, number];
type BodySegment = {
  control1: Point;
  control2: Point;
  end: Point;
};

const point = ([x, y]: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function curve(control1: Point, control2: Point, end: Point): BodySegment {
  return { control1, control2, end };
}

/**
 * Builds one closed, symmetrical body silhouette. Fullness and muscle alter
 * only horizontal landmarks, so every combination keeps the same head,
 * height, baseline and human proportions.
 */
export function bodySilhouettePath(
  geometry: StatusAvatarGeometry,
) {
  const female = geometry.variant === "female";
  const {
    ankleHalf,
    calfHalf,
    chestHalf,
    elbowInnerHalf,
    elbowOuterHalf,
    headHalf,
    hipHalf,
    kneeHalf,
    neckHalf,
    shoulderHalf,
    thighHalf,
    upperArmInnerHalf,
    upperArmOuterHalf,
    waistHalf,
    wristInnerHalf,
    wristOuterHalf,
  } = geometry.body;
  const upperArmOuter = CENTER_X + upperArmOuterHalf;
  const elbowOuter = CENTER_X + elbowOuterHalf;
  const wristOuter = CENTER_X + wristOuterHalf;
  const wristInner = CENTER_X + wristInnerHalf;
  const elbowInner = CENTER_X + elbowInnerHalf;
  const upperArmInner = CENTER_X + upperArmInnerHalf;
  // Keep the complete head/jaw outline identical within each sex. Training may
  // widen the lower neck into the shoulders, but never changes the face.
  const faceNeckHalf = female
    ? 10
    : geometry.variant === "male"
      ? 12
      : 11;

  const start: Point = [CENTER_X, 8];
  const jawHalf = female ? 13.5 : geometry.variant === "male" ? 15 : 14.25;
  const head: BodySegment[] = [
    curve(
      [CENTER_X + headHalf * 0.62, 8],
      [CENTER_X + headHalf, 16],
      [CENTER_X + headHalf, 30],
    ),
    curve(
      [CENTER_X + headHalf, 35],
      [CENTER_X + headHalf - 0.5, 40],
      [CENTER_X + headHalf - 1, 43],
    ),
    curve(
      [CENTER_X + headHalf + 3.5, 42],
      [CENTER_X + headHalf + 4, 48],
      [CENTER_X + headHalf + 1.5, 52],
    ),
    curve(
      [CENTER_X + headHalf, 57],
      [CENTER_X + jawHalf + 2, 62],
      [CENTER_X + jawHalf, 64],
    ),
    curve(
      [CENTER_X + jawHalf - 1, 67],
      [CENTER_X + faceNeckHalf, 68],
      [CENTER_X + faceNeckHalf, 71],
    ),
    curve(
      [CENTER_X + faceNeckHalf, 75],
      [CENTER_X + faceNeckHalf, 78],
      [CENTER_X + faceNeckHalf + 0.5, 80],
    ),
  ];

  const segments: BodySegment[] = [
    ...head,
    // Shoulder to fingertips. Hands finish at upper-thigh level, as in the
    // reference silhouettes, rather than reaching toward the knees.
    curve(
      [CENTER_X + neckHalf + 8, 81],
      [CENTER_X + shoulderHalf - 8, 82],
      [CENTER_X + shoulderHalf, 87],
    ),
    curve(
      [CENTER_X + shoulderHalf + 7, 95],
      [upperArmOuter, 109],
      [upperArmOuter, 126],
    ),
    curve(
      [upperArmOuter + 1, 141],
      [elbowOuter + 1, 157],
      [elbowOuter, 172],
    ),
    curve(
      [elbowOuter - 1, 188],
      [wristOuter + 1, 213],
      [wristOuter, 230],
    ),
    curve(
      [wristOuter + 5, 237],
      [wristOuter + 7, 246],
      [wristOuter + 4, 252],
    ),
    curve(
      [wristOuter + 2, 259],
      [wristOuter - 2, 263],
      [wristOuter - 4, 258],
    ),
    curve(
      [wristOuter - 7, 253],
      [wristInner - 1, 242],
      [wristInner, 232],
    ),
    curve(
      [wristInner - 1, 215],
      [elbowInner - 2, 190],
      [elbowInner, 176],
    ),
    curve(
      [elbowInner, 158],
      [upperArmInner + 1, 140],
      [upperArmInner, 126],
    ),
    curve(
      [upperArmInner - 2, 119],
      [CENTER_X + chestHalf - 2, 113],
      [CENTER_X + chestHalf - 3, 108],
    ),
    curve(
      [CENTER_X + chestHalf, 124],
      [CENTER_X + chestHalf, 136],
      [CENTER_X + chestHalf - 1, 145],
    ),
    curve(
      [CENTER_X + chestHalf - 2, 160],
      [CENTER_X + waistHalf, 173],
      [CENTER_X + waistHalf, 183],
    ),
    curve(
      [CENTER_X + waistHalf, 195],
      [CENTER_X + hipHalf, 204],
      [CENTER_X + hipHalf, 216],
    ),
    curve(
      [CENTER_X + hipHalf, 231],
      [CENTER_X + thighHalf + 3, 245],
      [CENTER_X + thighHalf, 262],
    ),
    curve(
      [CENTER_X + thighHalf - 2, 281],
      [CENTER_X + kneeHalf + 2, 296],
      [CENTER_X + kneeHalf, 310],
    ),
    curve(
      [CENTER_X + kneeHalf, 326],
      [CENTER_X + calfHalf + 1, 340],
      [CENTER_X + calfHalf, 352],
    ),
    curve(
      [CENTER_X + calfHalf - 2, 368],
      [CENTER_X + ankleHalf + 1, 384],
      [CENTER_X + ankleHalf, 393],
    ),
    curve(
      [CENTER_X + ankleHalf + 2, 399],
      [CENTER_X + ankleHalf + 13, 402],
      [CENTER_X + ankleHalf + 14, 407],
    ),
    curve(
      [CENTER_X + ankleHalf + 14, 412],
      [CENTER_X + 13, 413],
      [CENTER_X + 9, 411],
    ),
    curve(
      [CENTER_X + 5, 408],
      [CENTER_X + 7, 400],
      [CENTER_X + 8, 393],
    ),
    curve(
      [CENTER_X + 10, 378],
      [CENTER_X + 11, 363],
      [CENTER_X + 10, 348],
    ),
    curve(
      [CENTER_X + 9, 334],
      [CENTER_X + 8, 320],
      [CENTER_X + 9, 307],
    ),
    curve(
      [CENTER_X + 10, 291],
      [CENTER_X + 8, 274],
      [CENTER_X + 6, 259],
    ),
    curve(
      [CENTER_X + 5, 248],
      [CENTER_X + 3, 237],
      [CENTER_X, 229],
    ),
  ];

  const mirror = ([x, y]: Point): Point => [CENTER_X * 2 - x, y];
  const vertices = [start, ...segments.map((segment) => segment.end)];
  const right = segments
    .map(
      (segment) =>
        `C ${point(segment.control1)} ${point(segment.control2)} ${point(
          segment.end,
        )}`,
    )
    .join(" ");
  const left = segments
    .map((segment, index) => ({ segment, index }))
    .reverse()
    .map(
      ({ segment, index }) =>
        `C ${point(mirror(segment.control2))} ${point(
          mirror(segment.control1),
        )} ${point(mirror(vertices[index]))}`,
    )
    .join(" ");
  return `M ${point(start)} ${right} ${left} Z`;
}

/**
 * Hair is anchored only to the stable head landmarks. It never scales with
 * weight or training, so the face remains recognizably the same person while
 * the body morphs. The rear layer adds a female bob without drawing a second
 * head/body; the front layer supplies a clean hairline for each profile sex.
 */
function AvatarHair({
  fillColor,
  geometry,
  layer,
  lineColor,
}: {
  fillColor: string;
  geometry: StatusAvatarGeometry;
  layer: "back" | "front";
  lineColor: string;
}) {
  const { headHalf } = geometry.body;
  const female = geometry.variant === "female";

  if (layer === "back") {
    if (!female) return null;
    const outer = headHalf + 4.5;
    return (
      <Path
        d={`M ${CENTER_X} 4.5 C ${CENTER_X - outer * 0.68} 4.5 ${
          CENTER_X - outer
        } 16 ${CENTER_X - outer} 33 C ${CENTER_X - outer - 1.5} 48 ${
          CENTER_X - outer - 1
        } 66 ${CENTER_X - outer - 4} 82 Q ${CENTER_X - headHalf + 2} 80 ${
          CENTER_X - 11
        } 70 L ${CENTER_X + 11} 70 Q ${CENTER_X + headHalf - 2} 80 ${
          CENTER_X + outer + 4
        } 82 C ${CENTER_X + outer + 1} 66 ${CENTER_X + outer + 1.5} 48 ${
          CENTER_X + outer
        } 33 C ${CENTER_X + outer} 16 ${CENTER_X + outer * 0.68} 4.5 ${
          CENTER_X
        } 4.5 Z`}
        fill={fillColor}
        stroke={lineColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
      />
    );
  }

  if (female) {
    return (
      <Path
        d={`M ${CENTER_X - headHalf + 0.5} 33 C ${
          CENTER_X - headHalf + 0.5
        } 16 ${CENTER_X - headHalf * 0.56} 8 ${CENTER_X} 7.5 C ${
          CENTER_X + headHalf * 0.66
        } 7.5 ${CENTER_X + headHalf} 17 ${CENTER_X + headHalf - 0.2} 33 C ${
          CENTER_X + headHalf * 0.52
        } 27 ${CENTER_X + 7} 22 ${CENTER_X + 1.5} 22 C ${CENTER_X - 5} 20 ${
          CENTER_X - headHalf * 0.45
        } 26 ${CENTER_X - headHalf + 0.5} 33 Z`}
        fill={fillColor}
        stroke={lineColor}
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    );
  }

  // A short side-parted haircut follows the same fixed head anchor for male
  // and unspecified profiles. It does not alter face width or height.
  return (
    <Path
      d={`M ${CENTER_X - headHalf + 1} 30 C ${CENTER_X - headHalf + 1} 16 ${
        CENTER_X - headHalf * 0.55
      } 8 ${CENTER_X - 1} 7.5 C ${CENTER_X + headHalf * 0.58} 7.5 ${
        CENTER_X + headHalf - 0.5
      } 16 ${CENTER_X + headHalf - 0.5} 29 C ${CENTER_X + 8} 23 ${
        CENTER_X + 2
      } 20 ${CENTER_X - 3} 20.5 C ${CENTER_X - 7} 21 ${
        CENTER_X - 12
      } 25 ${CENTER_X - headHalf + 1} 30 Z`}
      fill={fillColor}
      stroke={lineColor}
      strokeLinejoin="round"
      strokeWidth={1.8}
    />
  );
}

/**
 * Optional body-model treatment. These are restrained anatomical contour
 * hints inside the one silhouette—not a second body layer or a raster sprite.
 * Their definition follows the same continuous fat/lean/training signals.
 */
function BodyModelDetails({
  color,
  geometry,
}: {
  color: string;
  geometry: StatusAvatarGeometry;
}) {
  const { body, adiposity, muscleProgress } = geometry;
  const female = geometry.variant === "female";
  const definition = Math.max(
    0.16,
    Math.min(0.72, 0.28 + muscleProgress * 0.52 - Math.max(0, adiposity) * 0.2),
  );
  const chestY = female ? 123 : 119;
  const waistY = 181;
  const leftChest = CENTER_X - body.chestHalf * 0.66;
  const rightChest = CENTER_X + body.chestHalf * 0.66;
  const leftWaist = CENTER_X - body.waistHalf * 0.7;
  const rightWaist = CENTER_X + body.waistHalf * 0.7;
  const leftKnee = CENTER_X - body.kneeHalf * 0.56;
  const rightKnee = CENTER_X + body.kneeHalf * 0.56;

  return (
    <G
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={definition}
    >
      <Path
        d={`M ${CENTER_X - body.neckHalf + 1} 87 Q ${
          CENTER_X - body.chestHalf * 0.38
        } 98 ${leftChest} 103 M ${CENTER_X + body.neckHalf - 1} 87 Q ${
          CENTER_X + body.chestHalf * 0.38
        } 98 ${rightChest} 103`}
        strokeWidth={1.9}
      />
      <Path
        d={`M ${leftChest} ${chestY} Q ${CENTER_X - body.chestHalf * 0.34} ${
          chestY + 7
        } ${CENTER_X - 2} ${chestY + 3} M ${rightChest} ${chestY} Q ${
          CENTER_X + body.chestHalf * 0.34
        } ${chestY + 7} ${CENTER_X + 2} ${chestY + 3}`}
        strokeWidth={1.8}
      />
      <Path
        d={`M ${CENTER_X} ${chestY + 7} C ${CENTER_X - 1} 145 ${
          CENTER_X + 1
        } 157 ${CENTER_X} 168`}
        opacity={0.45 + muscleProgress * 0.55}
        strokeWidth={1.5}
      />
      <Path
        d={`M ${leftWaist} ${waistY} Q ${CENTER_X - body.waistHalf * 0.32} ${
          waistY + 5
        } ${CENTER_X - 4} ${waistY + 3} M ${rightWaist} ${waistY} Q ${
          CENTER_X + body.waistHalf * 0.32
        } ${waistY + 5} ${CENTER_X + 4} ${waistY + 3}`}
        strokeWidth={1.35}
      />
      <Circle cx={CENTER_X} cy={173} r={1.7} fill={color} stroke="none" />
      <Path
        d={`M ${CENTER_X - body.hipHalf * 0.72} 218 Q ${
          CENTER_X - body.thighHalf * 0.38
        } 224 ${CENTER_X - 6} 228 M ${CENTER_X + body.hipHalf * 0.72} 218 Q ${
          CENTER_X + body.thighHalf * 0.38
        } 224 ${CENTER_X + 6} 228`}
        strokeWidth={1.45}
      />
      <Path
        d={`M ${leftKnee - 6} 307 Q ${leftKnee} 313 ${leftKnee + 6} 307 M ${
          rightKnee - 6
        } 307 Q ${rightKnee} 313 ${rightKnee + 6} 307`}
        strokeWidth={1.45}
      />
      <Path
        d={`M ${CENTER_X - body.calfHalf * 0.65} 333 Q ${
          CENTER_X - body.calfHalf * 0.82
        } 348 ${CENTER_X - body.ankleHalf * 0.72} 374 M ${
          CENTER_X + body.calfHalf * 0.65
        } 333 Q ${CENTER_X + body.calfHalf * 0.82} 348 ${
          CENTER_X + body.ankleHalf * 0.72
        } 374`}
        strokeWidth={1.35}
      />
      <Path
        d={`M ${CENTER_X - body.upperArmOuterHalf + 4} 123 Q ${
          CENTER_X - body.elbowOuterHalf + 2
        } 142 ${CENTER_X - body.elbowOuterHalf + 4} 161 M ${
          CENTER_X + body.upperArmOuterHalf - 4
        } 123 Q ${CENTER_X + body.elbowOuterHalf - 2} 142 ${
          CENTER_X + body.elbowOuterHalf - 4
        } 161`}
        opacity={0.25 + muscleProgress * 0.75}
        strokeWidth={1.5}
      />
    </G>
  );
}

function NerdAccessories({
  color,
  geometry,
  mindTier,
}: {
  color: string;
  geometry: StatusAvatarGeometry;
  mindTier: 0 | 1 | 2 | 3;
}) {
  if (!mindTier) return null;
  const { capBrimY, capCrownBottomY, capHalfWidth, capTopY, eyeOffset, eyeY, lensRadius } =
    geometry.accessory;
  const leftEyeX = CENTER_X - eyeOffset;
  const rightEyeX = CENTER_X + eyeOffset;
  const bridgeLeft = leftEyeX + lensRadius;
  const bridgeRight = rightEyeX - lensRadius;
  const templeOffset = geometry.body.headHalf - 1;
  return (
    <G fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <G strokeWidth={3}>
        <Circle cx={leftEyeX} cy={eyeY} r={lensRadius} />
        <Circle cx={rightEyeX} cy={eyeY} r={lensRadius} />
        <Line x1={bridgeLeft} y1={eyeY} x2={bridgeRight} y2={eyeY} />
        <Line
          x1={leftEyeX - lensRadius}
          y1={eyeY - 1}
          x2={CENTER_X - templeOffset}
          y2={eyeY - 2.5}
        />
        <Line
          x1={rightEyeX + lensRadius}
          y1={eyeY - 1}
          x2={CENTER_X + templeOffset}
          y2={eyeY - 2.5}
        />
      </G>
      {mindTier >= 2 ? (
        <G stroke={palette.amber} strokeWidth={2.2}>
          <Circle cx={rightEyeX} cy={eyeY} r={lensRadius + 3} />
          <Path
            d={`M ${rightEyeX + lensRadius * 0.7} ${eyeY + lensRadius * 0.75} Q ${
              rightEyeX + lensRadius + 6
            } ${eyeY + 17} ${rightEyeX + lensRadius + 2} ${eyeY + 29}`}
          />
        </G>
      ) : null}
      {mindTier >= 3 ? (
        <G>
          <Polygon
            points={`${CENTER_X - capHalfWidth},${capBrimY} ${CENTER_X},${capTopY} ${
              CENTER_X + capHalfWidth
            },${capBrimY} ${CENTER_X},${capBrimY + 12}`}
            fill={color}
            stroke="none"
          />
          <Path
            d={`M ${CENTER_X - geometry.body.headHalf - 2} ${capBrimY + 3} L ${
              CENTER_X - geometry.body.headHalf - 2
            } ${capCrownBottomY} Q ${CENTER_X} ${capCrownBottomY + 8} ${
              CENTER_X + geometry.body.headHalf + 2
            } ${capCrownBottomY} L ${CENTER_X + geometry.body.headHalf + 2} ${capBrimY + 3}`}
            fill={color}
            stroke="none"
          />
          <Line
            x1={CENTER_X + capHalfWidth - 3}
            y1={capBrimY}
            x2={CENTER_X + capHalfWidth - 3}
            y2={capCrownBottomY + 5}
            stroke={palette.amber}
            strokeWidth={2.2}
          />
          <Circle
            cx={CENTER_X + capHalfWidth - 3}
            cy={capCrownBottomY + 8}
            r={3}
            fill={palette.amber}
            stroke="none"
          />
        </G>
      ) : null}
    </G>
  );
}

export function BodyProgressAvatar({
  bodyFatPercent,
  heightCm = 170,
  leanBodyMassKg,
  mindTier = 0,
  muscleProgress = 0,
  progress,
  sex = "unspecified",
  visualStyle = "silhouette",
  weightKg = 70,
}: {
  bodyFatPercent?: number;
  heightCm?: number;
  leanBodyMassKg?: number;
  mindTier?: 0 | 1 | 2 | 3;
  muscleProgress?: number;
  progress: number;
  sex?: BiologicalSex;
  visualStyle?: StatusAvatarStyle;
  weightKg?: number;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const gradientId = `statusBodyFill${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clamped = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  );
  const [reduceMotion, setReduceMotion] = useState(false);
  const [renderedProgress, setRenderedProgress] = useState(0);
  const renderedProgressRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

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
    if (animationFrameRef.current !== null)
      cancelAnimationFrame(animationFrameRef.current);
    if (reduceMotion) {
      renderedProgressRef.current = clamped;
      setRenderedProgress(clamped);
      return;
    }
    const from = renderedProgressRef.current;
    const startedAt = Date.now();
    const durationMs = 900;
    const step = () => {
      const elapsed = Date.now() - startedAt;
      const linear = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - linear, 3);
      const next = from + (clamped - from) * eased;
      renderedProgressRef.current = next;
      setRenderedProgress(next);
      if (linear < 1) animationFrameRef.current = requestAnimationFrame(step);
      else animationFrameRef.current = null;
    };
    animationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [clamped, reduceMotion]);

  const percent = Math.round(clamped * 100);
  const boundedMuscle = Math.max(0, Math.min(1, muscleProgress));
  const appearance = useMemo(
    () =>
      statusBodyAppearance(heightCm, weightKg, boundedMuscle, {
        bodyFatPercent,
        leanBodyMassKg,
        sex,
      }),
    [bodyFatPercent, boundedMuscle, heightCm, leanBodyMassKg, sex, weightKg],
  );
  const geometry = useMemo(
    () =>
      statusAvatarGeometry(
        sex,
        appearance.bodyMass,
        appearance.muscleProgress,
        appearance.adiposity,
      ),
    [appearance.adiposity, appearance.bodyMass, appearance.muscleProgress, sex],
  );
  const bodyPath = useMemo(
    () => bodySilhouettePath(geometry),
    [geometry],
  );
  const renderedWidth = Math.round(BODY_WIDTH * appearance.heightScale);
  const renderedHeight = Math.round(BODY_HEIGHT * appearance.heightScale);
  const fillBoundary = Math.max(0, Math.min(1, 1 - renderedProgress));
  const transparentBoundary = Math.max(0, fillBoundary - 0.001);
  const hasVisibleFill = renderedProgress > 0.0005;
  const hasFullFill = renderedProgress >= 0.9995;
  const bodyModel = visualStyle === "body_model";
  const restingFillColor = bodyModel ? colors.primarySoft : GOAL_COMPLETE_COLOR;
  const restingFillOpacity = bodyModel ? 1 : 0;

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
        width={renderedWidth}
        height={renderedHeight}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      >
        <Defs>
          <LinearGradient id={gradientId} x1={0} y1={0} x2={0} y2={1}>
            <Stop
              offset={0}
              stopColor={hasFullFill ? GOAL_COMPLETE_COLOR : restingFillColor}
              stopOpacity={hasFullFill ? 1 : restingFillOpacity}
            />
            <Stop
              offset={transparentBoundary}
              stopColor={hasFullFill ? GOAL_COMPLETE_COLOR : restingFillColor}
              stopOpacity={hasFullFill ? 1 : restingFillOpacity}
            />
            <Stop
              offset={fillBoundary}
              stopColor={GOAL_COMPLETE_COLOR}
              stopOpacity={hasVisibleFill ? 1 : 0}
            />
            <Stop
              offset={1}
              stopColor={GOAL_COMPLETE_COLOR}
              stopOpacity={hasVisibleFill ? 1 : 0}
            />
          </LinearGradient>
        </Defs>
        <AvatarHair
          fillColor={colors.card}
          geometry={geometry}
          layer="back"
          lineColor={colors.ink}
        />
        <Path
          d={bodyPath}
          fill={`url(#${gradientId})`}
          stroke={colors.ink}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3.6}
        />
        {bodyModel ? (
          <BodyModelDetails color={colors.ink} geometry={geometry} />
        ) : null}
        <AvatarHair
          fillColor={colors.card}
          geometry={geometry}
          layer="front"
          lineColor={colors.ink}
        />
        <NerdAccessories
          color={colors.ink}
          geometry={geometry}
          mindTier={mindTier}
        />
      </Svg>
      <View
        pointerEvents="none"
        style={[
          styles.percentPill,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text translate={false} style={[styles.percent, { color: colors.ink }]}>
          {percent}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 164,
    height: 302,
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
