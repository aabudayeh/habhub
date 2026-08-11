import type { BiologicalSex } from "@/src/types";

export type StatusAvatarAtlasVariant = "female" | "male";

export type StatusAvatarAtlasConfig = {
  atlasHeight: number;
  atlasWidth: number;
  bodyCenters: readonly (readonly number[])[];
  bodyHeights: readonly number[];
  bodyTops: readonly number[];
};

export type StatusAvatarAtlasSample = {
  column: number;
  opacity: number;
  row: number;
};

export type StatusAvatarAtlasBlend = {
  config: StatusAvatarAtlasConfig;
  samples: StatusAvatarAtlasSample[];
  variant: StatusAvatarAtlasVariant;
};

/**
 * Alpha bounds measured from the final generated PNGs. Every selected frame is
 * normalized to the same displayed head-to-foot height and baseline, so a
 * muscle-tier change cannot make the person grow or move sideways.
 */
export const STATUS_AVATAR_ATLASES: Record<
  StatusAvatarAtlasVariant,
  StatusAvatarAtlasConfig
> = {
  male: {
    atlasHeight: 1254,
    atlasWidth: 1254,
    bodyCenters: [
      [86.5, 220, 356.5, 495, 629, 764.5, 901.5, 1036.5, 1169],
      [86, 220, 357, 494.5, 629, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 220, 357, 494.5, 629.5, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 219.5, 357, 494.5, 629, 764.5, 901.5, 1036.5, 1169],
      [86.5, 220, 356.5, 495, 629, 764.5, 901.5, 1036.5, 1168.5],
      [86.5, 220, 357, 495, 629, 764, 901.5, 1036, 1169],
      [86.5, 219.5, 356.5, 494.5, 629, 764, 901.5, 1036.5, 1168.5],
    ],
    bodyHeights: [152, 152, 153, 155, 156, 158, 155],
    bodyTops: [47, 216, 383, 556, 726, 897, 1067],
  },
  female: {
    atlasHeight: 1254,
    atlasWidth: 1254,
    bodyCenters: [
      [97.5, 239, 379.5, 521.5, 662.5, 804, 946, 1091.5],
      [97.5, 239, 379.5, 522, 662.5, 805, 946.5, 1093],
      [98, 239.5, 380.5, 522, 663.5, 805.5, 948.5, 1095],
      [98, 239.5, 381, 523.5, 664, 806, 949, 1095.5],
      [98.5, 240.5, 381, 523.5, 664.5, 806.5, 950, 1096.5],
      [99, 241, 382, 524, 665, 808, 951, 1097.5],
      [100, 242, 383.5, 525.5, 666.5, 809, 952.5, 1099.5],
    ],
    bodyHeights: [143, 146, 147, 147, 148, 148, 156],
    bodyTops: [43, 201, 365, 525, 683, 842, 1002],
  },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));

/**
 * Resolves continuous composition to one of the dense generated states. A
 * single frame guarantees one crisp outline; cross-fading whole transparent
 * silhouettes created ghost/double edges that looked like stacked avatars.
 * The pure input axes still move continuously, while the visible 8/9 by 7
 * matrix supplies 56/63 small, predictable combinations.
 */
export function statusAvatarAtlasBlend(
  sex: BiologicalSex,
  adiposity: number,
  muscleProgress: number,
): StatusAvatarAtlasBlend {
  const variant: StatusAvatarAtlasVariant = sex === "female" ? "female" : "male";
  const config = STATUS_AVATAR_ATLASES[variant];
  const column = Math.round(
    ((clamp(adiposity, -1, 1) + 1) / 2) *
      (config.bodyCenters[0].length - 1),
  );
  const row = Math.round(
    clamp(muscleProgress, 0, 1) * (config.bodyCenters.length - 1),
  );
  return { config, samples: [{ column, row, opacity: 1 }], variant };
}
