import type { BiologicalSex } from "@/src/types";

export type StatusAvatarAtlasVariant = "female" | "male";

export type StatusAvatarSpriteConfig = {
  adiposityStates: number;
  bodyCenter: number;
  bodyHeight: number;
  bodyTop: number;
  muscleStates: number;
  spriteHeight: number;
  spriteWidth: number;
};

export type StatusAvatarAtlasSample = {
  column: number;
  opacity: number;
  row: number;
};

export type StatusAvatarAtlasBlend = {
  config: StatusAvatarSpriteConfig;
  samples: StatusAvatarAtlasSample[];
  variant: StatusAvatarAtlasVariant;
};

/**
 * V2 uses one normalized high-resolution sprite for each composition state.
 * Every source body is 500 px tall and centered on the same 328 x 512 canvas,
 * then rendered at roughly half size in Status. Keeping states in separate
 * files also means native/web decode only the one visible body instead of a
 * large atlas containing hundreds of unused figures.
 */
export const STATUS_AVATAR_SPRITE_GRIDS: Record<
  StatusAvatarAtlasVariant,
  StatusAvatarSpriteConfig
> = {
  male: {
    adiposityStates: 20,
    bodyCenter: 164,
    bodyHeight: 500,
    bodyTop: 6,
    muscleStates: 10,
    spriteHeight: 512,
    spriteWidth: 328,
  },
  female: {
    adiposityStates: 20,
    bodyCenter: 164,
    bodyHeight: 500,
    bodyTop: 6,
    muscleStates: 10,
    spriteHeight: 512,
    spriteWidth: 328,
  },
};

const BASE_ADIPOSITY_STATES = 13;
const EXTENDED_ADIPOSITY_START = 0.82;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));

/**
 * Maps the two continuous inputs onto a dense, independent two-axis grid.
 * The renderer selects exactly one baked sprite: it never cross-fades whole
 * silhouettes, so progress fill and theme contour still have one clean edge.
 */
export function statusAvatarAtlasBlend(
  sex: BiologicalSex,
  adiposity: number,
  muscleProgress: number,
): StatusAvatarAtlasBlend {
  const variant: StatusAvatarAtlasVariant = sex === "female" ? "female" : "male";
  const config = STATUS_AVATAR_SPRITE_GRIDS[variant];
  const boundedAdiposity = clamp(adiposity, -1, 1);
  // Preserve the approved 13-state calibration for ordinary BMI/body-fat
  // values. Only the highest adiposity range enters the seven new heavier
  // extensions, keeping common profiles natural while 120kg/150kg and high
  // measured-fat examples no longer collapse onto one endpoint.
  const baseColumn = Math.round(
    ((boundedAdiposity + 1) / 2) * (BASE_ADIPOSITY_STATES - 1),
  );
  const column =
    boundedAdiposity <= EXTENDED_ADIPOSITY_START
      ? baseColumn
      : BASE_ADIPOSITY_STATES -
        1 +
        Math.round(
          ((boundedAdiposity - EXTENDED_ADIPOSITY_START) /
            (1 - EXTENDED_ADIPOSITY_START)) *
            (config.adiposityStates - BASE_ADIPOSITY_STATES),
        );
  const row = Math.round(
    clamp(muscleProgress, 0, 1) * (config.muscleStates - 1),
  );
  return { config, samples: [{ column, row, opacity: 1 }], variant };
}
