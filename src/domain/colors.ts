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

export function isAllowedTrackerColor(value: string) {
  return Boolean(normalizeHexColor(value)) && !isReservedGoalColor(value);
}
