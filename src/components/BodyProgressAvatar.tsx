import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Circle, G, Line, Path, Polygon } from "react-native-svg";

import { AppText as Text } from "@/src/components/AppText";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  statusAvatarAtlasBlend,
  type StatusAvatarAtlasBlend,
  type StatusAvatarAtlasSample,
} from "@/src/domain/statusAvatarAtlas";
import {
  statusBodyAppearance,
  statusBodyCompositionForSource,
} from "@/src/domain/statusAvatar";
import { STATUS_AVATAR_SPRITES } from "@/src/generated/statusAvatarSprites";
import { useLocalization } from "@/src/i18n";
import { useAppColors } from "@/src/theme";
import type {
  BiologicalSex,
  StatusAvatarCalculationSource,
  StatusAvatarStyle,
} from "@/src/types";

const BODY_WIDTH = 164;
const BODY_HEIGHT = 250;

function spriteSource(
  variant: StatusAvatarAtlasBlend["variant"],
  sample: StatusAvatarAtlasSample,
) {
  return STATUS_AVATAR_SPRITES[variant][sample.row][
    sample.column
  ] as ImageSourcePropType;
}

function AtlasCell({
  blend,
  height,
  opacityScale,
  sample,
  tintColor,
  width,
}: {
  blend: StatusAvatarAtlasBlend;
  height: number;
  opacityScale: number;
  sample: StatusAvatarAtlasSample;
  tintColor?: string;
  width: number;
}) {
  const { config } = blend;
  // Keep the generated figure's source proportions. Scaling X and Y
  // independently made the body and head look unnaturally long. The viewport
  // clips only transparent atlas padding; the widest source figure still fits.
  const scale = height / config.bodyHeight;

  return (
    <Image
      fadeDuration={0}
      resizeMode="stretch"
      source={spriteSource(blend.variant, sample)}
      style={[
        styles.atlasImage,
        {
          height: config.spriteHeight * scale,
          left: width / 2 - config.bodyCenter * scale,
          opacity: sample.opacity * opacityScale,
          tintColor,
          top: -config.bodyTop * scale,
          width: config.spriteWidth * scale,
        },
      ]}
    />
  );
}

function MindAccessories({
  height,
  mindTier,
  variant,
  width,
}: {
  height: number;
  mindTier: 0 | 1 | 2 | 3;
  variant: StatusAvatarAtlasBlend["variant"];
  width: number;
}) {
  if (!mindTier) return null;
  const scale = height / 150;
  const eyeY = height * 0.075;
  const eyeOffset = 5.2 * scale;
  const lensRadius = 4.3 * scale;
  const centerX = width / 2;
  const ink = "#E8F0FF";
  const gold = "#F6C453";
  const leftEye = centerX - eyeOffset;
  const rightEye = centerX + eyeOffset;
  const capHalf = 15 * scale;
  const capTop = Math.max(1, 3 * scale);
  const capBrim = 10 * scale;

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${width} ${height}`}
    >
      <G
        fill="none"
        stroke={ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={Math.max(1.25, 1.25 * scale)}
      >
        <Circle cx={leftEye} cy={eyeY} r={lensRadius} />
        <Circle cx={rightEye} cy={eyeY} r={lensRadius} />
        <Line
          x1={leftEye + lensRadius}
          y1={eyeY}
          x2={rightEye - lensRadius}
          y2={eyeY}
        />
      </G>
      {mindTier >= 2 ? (
        <G
          fill="none"
          stroke={gold}
          strokeLinecap="round"
          strokeWidth={Math.max(1.2, 1.15 * scale)}
        >
          <Circle cx={rightEye} cy={eyeY} r={lensRadius + 1.7 * scale} />
          <Path
            d={`M ${rightEye + lensRadius * 0.75} ${eyeY + lensRadius * 0.75} Q ${
              rightEye + 9 * scale
            } ${eyeY + 14 * scale} ${rightEye + 6 * scale} ${
              eyeY + 22 * scale
            }`}
          />
        </G>
      ) : null}
      {mindTier >= 3 ? (
        <G>
          <Polygon
            fill={ink}
            points={`${centerX - capHalf},${capBrim} ${centerX},${capTop} ${
              centerX + capHalf
            },${capBrim} ${centerX},${capBrim + 7 * scale}`}
          />
          <Line
            x1={centerX + capHalf - 2 * scale}
            y1={capBrim}
            x2={centerX + capHalf - 2 * scale}
            y2={capBrim + 12 * scale}
            stroke={gold}
            strokeLinecap="round"
            strokeWidth={Math.max(1.2, 1.1 * scale)}
          />
          <Circle
            cx={centerX + capHalf - 2 * scale}
            cy={capBrim + 13.5 * scale}
            fill={gold}
            r={1.8 * scale}
          />
        </G>
      ) : null}
    </Svg>
  );
}

function AtlasBodyLayer({
  blend,
  height,
  opacityScale = 1,
  tintColor,
  width,
}: {
  blend: StatusAvatarAtlasBlend;
  height: number;
  opacityScale?: number;
  tintColor?: string;
  width: number;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {blend.samples.map((sample) => (
        <AtlasCell
          key={`${sample.column}:${sample.row}`}
          blend={blend}
          height={height}
          opacityScale={opacityScale}
          sample={sample}
          tintColor={tintColor}
          width={width}
        />
      ))}
    </View>
  );
}

export function BodyProgressAvatar({
  allowPartialComposition = false,
  bodyFatPercent,
  calculationSource = "bmi",
  displayScale = 1,
  heightCm = 170,
  leanBodyMassKg,
  mindTier = 0,
  muscleProgress = 0,
  progress,
  showProgressLabel = true,
  sex = "unspecified",
  visualStyle = "silhouette",
  weightKg = 70,
}: {
  allowPartialComposition?: boolean;
  bodyFatPercent?: number;
  calculationSource?: StatusAvatarCalculationSource;
  displayScale?: number;
  heightCm?: number;
  leanBodyMassKg?: number;
  mindTier?: 0 | 1 | 2 | 3;
  muscleProgress?: number;
  progress: number;
  showProgressLabel?: boolean;
  sex?: BiologicalSex;
  visualStyle?: StatusAvatarStyle;
  weightKg?: number;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
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
  const boundedDisplayScale = Math.max(
    0.5,
    Math.min(1, Number.isFinite(displayScale) ? displayScale : 1),
  );
  const boundedMuscle = Math.max(0, Math.min(1, muscleProgress));
  const appearance = useMemo(
    () =>
      statusBodyAppearance(
        heightCm,
        weightKg,
        boundedMuscle,
        statusBodyCompositionForSource(
          calculationSource,
          {
            bodyFatPercent,
            leanBodyMassKg,
            sex,
          },
          allowPartialComposition,
        ),
      ),
    [
      allowPartialComposition,
      bodyFatPercent,
      boundedMuscle,
      calculationSource,
      heightCm,
      leanBodyMassKg,
      sex,
      weightKg,
    ],
  );
  const blend = useMemo(
    () =>
      statusAvatarAtlasBlend(
        sex,
        appearance.adiposity,
        appearance.muscleProgress,
      ),
    [appearance.adiposity, appearance.muscleProgress, sex],
  );
  const renderedWidth = BODY_WIDTH * boundedDisplayScale;
  const renderedHeight = Math.round(
    BODY_HEIGHT * appearance.heightScale * boundedDisplayScale,
  );
  const progressHeight = Math.max(
    0,
    Math.min(renderedHeight, renderedHeight * renderedProgress),
  );
  const bodyModel = visualStyle === "body_model";

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t("Tracked goals")}: ${percent}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={[
        styles.frame,
        {
          height: 302 * boundedDisplayScale,
          width: BODY_WIDTH * boundedDisplayScale,
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.avatarViewport,
          { height: renderedHeight, width: renderedWidth },
        ]}
      >
        <AtlasBodyLayer
          blend={blend}
          height={renderedHeight}
          opacityScale={bodyModel ? 1 : 0.34}
          tintColor={bodyModel ? undefined : colors.ink}
          width={renderedWidth}
        />
        {bodyModel ? (
          <AtlasBodyLayer
            blend={blend}
            height={renderedHeight}
            opacityScale={0.36}
            tintColor={colors.ink}
            width={renderedWidth}
          />
        ) : null}
        {progressHeight > 0.1 ? (
          <View
            pointerEvents="none"
            style={[styles.progressClip, { height: progressHeight }]}
          >
            <View
              style={[
                styles.progressBody,
                { height: renderedHeight, width: renderedWidth },
              ]}
            >
              <AtlasBodyLayer
                blend={blend}
                height={renderedHeight}
                opacityScale={bodyModel ? 0.82 : 1}
                tintColor={GOAL_COMPLETE_COLOR}
                width={renderedWidth}
              />
            </View>
          </View>
        ) : null}
        <MindAccessories
          height={renderedHeight}
          mindTier={mindTier}
          variant={blend.variant}
          width={renderedWidth}
        />
        {showProgressLabel ? (
          <View
            pointerEvents="none"
            style={[
              styles.percentPill,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              numberOfLines={1}
              translate={false}
              style={[styles.percent, { color: colors.ink }]}
            >
              {percent}%
            </Text>
          </View>
        ) : null}
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
  avatarViewport: {
    overflow: "hidden",
  },
  atlasImage: {
    position: "absolute",
  },
  progressClip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  progressBody: {
    position: "absolute",
    bottom: 0,
    left: 0,
  },
  percentPill: {
    position: "absolute",
    left: "50%",
    bottom: 16,
    width: 60,
    transform: [{ translateX: -30 }],
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
  },
  percent: { flexShrink: 0, fontSize: 12, lineHeight: 15, fontWeight: "900" },
});
