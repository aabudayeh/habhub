import type { CompletionFillMode } from "@/src/types";

/**
 * One shared registry keeps the Display preview and Today's hero renderer in
 * sync. The values are Ionicons vector glyphs, so they remain crisp at every
 * density without loading image assets or running a per-frame JS animation.
 */
export const COMPLETION_INDICATOR_OPTIONS = [
  { icon: "ellipse-outline", label: "Circle", defaultFillMode: "clockwise" },
  { icon: "square-outline", label: "Square", defaultFillMode: "clockwise" },
  { icon: "flash-outline", label: "Lightning", defaultFillMode: "bottom_up" },
  { icon: "happy-outline", label: "Smiley", defaultFillMode: "center_out" },
  { icon: "beer-outline", label: "Beer", defaultFillMode: "bottom_up" },
  { icon: "cafe-outline", label: "Coffee", defaultFillMode: "bottom_up" },
  { icon: "heart-outline", label: "Heart", defaultFillMode: "center_out" },
  { icon: "star-outline", label: "Star", defaultFillMode: "center_out" },
  { icon: "shield-checkmark-outline", label: "Shield", defaultFillMode: "bottom_up" },
  { icon: "flame-outline", label: "Flame", defaultFillMode: "bottom_up" },
  { icon: "rocket-outline", label: "Rocket", defaultFillMode: "bottom_up" },
  { icon: "leaf-outline", label: "Leaf", defaultFillMode: "center_out" },
  { icon: "trophy-outline", label: "Trophy", defaultFillMode: "bottom_up" },
  { icon: "diamond-outline", label: "Diamond", defaultFillMode: "center_out" },
  { icon: "planet-outline", label: "Orbit", defaultFillMode: "clockwise" },
  { icon: "fitness-outline", label: "Strength", defaultFillMode: "center_out" },
  { icon: "ribbon-outline", label: "Medal", defaultFillMode: "bottom_up" },
  { icon: "compass-outline", label: "Compass", defaultFillMode: "clockwise" },
  { icon: "water-outline", label: "Water drop", defaultFillMode: "bottom_up" },
  { icon: "sparkles-outline", label: "Sparkles", defaultFillMode: "center_out" },
] as const satisfies readonly {
  icon: string;
  label: string;
  defaultFillMode: Exclude<CompletionFillMode, "auto">;
}[];

export type CompletionIndicatorIcon =
  (typeof COMPLETION_INDICATOR_OPTIONS)[number]["icon"];

const DEFAULT_COMPLETION_INDICATOR = COMPLETION_INDICATOR_OPTIONS[0];

export function completionIndicatorOption(icon?: string) {
  return (
    COMPLETION_INDICATOR_OPTIONS.find((option) => option.icon === icon) ??
    DEFAULT_COMPLETION_INDICATOR
  );
}

export function completionIndicatorFillMode(
  icon: string | undefined,
  requested: CompletionFillMode,
): Exclude<CompletionFillMode, "auto"> {
  return requested === "auto"
    ? completionIndicatorOption(icon).defaultFillMode
    : requested;
}
