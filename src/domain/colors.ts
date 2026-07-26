export const GOAL_COMPLETE_COLOR = "#B8E45C";
export const ALL_GOALS_COMPLETE_COLOR = "#D7A62A";

export const THEME_COLOR_CHOICES = [
  "#176B4D",
  "#2F6FED",
  "#7756D9",
  "#C14F87",
  "#D95852",
  "#D46B28",
  "#167C80",
  "#49616E",
] as const;

export const TRACKER_COLOR_CHOICES = [
  "#176B4D",
  "#2F6FED",
  "#7756D9",
  "#C14F87",
  "#D95852",
  "#D46B28",
  "#167C80",
  "#49616E",
  "#7A5B3A",
  "#527D38",
  "#0E7490",
  "#2563EB",
  "#4F46E5",
  "#7C3AED",
  "#9333EA",
  "#BE185D",
  "#E11D48",
  "#C2410C",
  "#B45309",
  "#3F7D20",
  "#15803D",
  "#0F766E",
  "#475569",
  "#6B4F8A",
] as const;

export function normalizeHexColor(value: string): string | undefined {
  const raw = value.trim().toUpperCase();
  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-F]{6}$/.test(prefixed)) return undefined;
  return prefixed;
}

export function isReservedGoalColor(value: string) {
  const normalized = normalizeHexColor(value);
  return (
    normalized === GOAL_COMPLETE_COLOR ||
    normalized === ALL_GOALS_COMPLETE_COLOR
  );
}

function rgb(value: string) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ] as const;
}

function isFarFromGoalColors(value: string, minimumDistance: number) {
  const candidate = rgb(value);
  if (!candidate) return false;
  return [GOAL_COMPLETE_COLOR, ALL_GOALS_COMPLETE_COLOR].every((reserved) => {
    const target = rgb(reserved)!;
    const distance = Math.sqrt(
      candidate.reduce(
        (sum, channel, index) =>
          sum + Math.pow(channel - target[index], 2),
        0,
      ),
    );
    return distance >= minimumDistance;
  });
}

/** Tracker identity colors must not resemble lime/gold completion feedback. */
export function isAllowedTrackerColor(value: string) {
  return isFarFromGoalColors(value, 66);
}

/** Keep theme accents visually distinct from goal and perfect-day feedback. */
export function isAllowedThemeColor(value: string) {
  return isFarFromGoalColors(value, 72);
}
