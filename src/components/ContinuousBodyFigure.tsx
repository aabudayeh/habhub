import React, { memo, useId, useMemo } from "react";
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { statusAvatarSilhouettePath } from "@/src/domain/statusAvatarOutline";
import type { StatusAvatarGeometry } from "@/src/domain/statusAvatar";

type Props = {
  geometry: StatusAvatarGeometry;
  height: number;
  width: number;
  color: string;
  detailed?: boolean;
  opacity?: number;
};

/** One vector contour at every input value; no quantized sprites or ghost edges. */
export const ContinuousBodyFigure = memo(function ContinuousBodyFigure({
  geometry,
  height,
  width,
  color,
  detailed = false,
  opacity = 1,
}: Props) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bodyPath = useMemo(() => statusAvatarSilhouettePath(geometry), [geometry]);
  const { body: b } = geometry;
  const definition = Math.max(0.08, Math.min(0.48,
    0.18 + geometry.muscleProgress * 0.32 - Math.max(0, geometry.adiposity) * 0.25,
  ));
  return (
    <Svg
      pointerEvents="none"
      height={height}
      width={width}
      viewBox="0 0 200 420"
      preserveAspectRatio="xMidYMid meet"
      opacity={opacity}
    >
      <Defs>
        <LinearGradient id={`body-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#3A4D62" />
          <Stop offset="27%" stopColor="#8295A9" />
          <Stop offset="46%" stopColor="#CAD5E0" />
          <Stop offset="62%" stopColor="#ADBDCC" />
          <Stop offset="100%" stopColor="#40546A" />
        </LinearGradient>
        <LinearGradient id={`light-${id}`} x1="0%" y1="0%" x2="65%" y2="100%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <Stop offset="40%" stopColor="#FFFFFF" stopOpacity="0" />
          <Stop offset="100%" stopColor="#0E2135" stopOpacity="0.14" />
        </LinearGradient>
        <ClipPath id={`clip-${id}`}><Path d={bodyPath} /></ClipPath>
      </Defs>
      <Path
        d={bodyPath}
        fill={detailed ? `url(#body-${id})` : color}
        stroke={detailed ? color : "none"}
        strokeOpacity={0.45}
        strokeWidth={0.7}
        strokeLinejoin="round"
      />
      {detailed ? (
        <G clipPath={`url(#clip-${id})`}>
          <Rect x={0} y={0} width={200} height={420} fill={`url(#light-${id})`} />
          <G fill="none" stroke="#31475D" strokeWidth={1.2} strokeLinecap="round" opacity={definition}>
            <Path d={`M ${100 - b.neckHalf} 84 Q 84 97 ${100 - b.chestHalf * 0.68} 101 M ${100 + b.neckHalf} 84 Q 116 97 ${100 + b.chestHalf * 0.68} 101`} />
            <Path d={`M ${100 - b.chestHalf * 0.72} 120 Q 84 129 98 123 M ${100 + b.chestHalf * 0.72} 120 Q 116 129 102 123`} />
            <Path d="M 100 135 C 99 148 101 156 100 165" />
            <Path d={`M ${100 - b.waistHalf * 0.72} 181 Q 86 191 98 184 M ${100 + b.waistHalf * 0.72} 181 Q 114 191 102 184`} />
            <Path d={`M ${100 - b.hipHalf * 0.72} 215 Q 86 226 95 230 M ${100 + b.hipHalf * 0.72} 215 Q 114 226 105 230`} />
            <Path d={`M ${100 - b.thighHalf * 0.65} 252 Q ${100 - b.kneeHalf * 0.56} 284 ${100 - b.kneeHalf * 0.56} 305 M ${100 + b.thighHalf * 0.65} 252 Q ${100 + b.kneeHalf * 0.56} 284 ${100 + b.kneeHalf * 0.56} 305`} />
            <Path d={`M ${100 - b.calfHalf * 0.66} 329 Q ${100 - b.calfHalf * 0.8} 350 ${100 - b.ankleHalf * 0.74} 376 M ${100 + b.calfHalf * 0.66} 329 Q ${100 + b.calfHalf * 0.8} 350 ${100 + b.ankleHalf * 0.74} 376`} />
            <Path d={`M ${100 - b.upperArmOuterHalf + 5} 119 Q ${100 - b.elbowOuterHalf + 4} 143 ${100 - b.elbowOuterHalf + 5} 166 M ${100 + b.upperArmOuterHalf - 5} 119 Q ${100 + b.elbowOuterHalf - 4} 143 ${100 + b.elbowOuterHalf - 5} 166`} />
          </G>
        </G>
      ) : null}
    </Svg>
  );
});
