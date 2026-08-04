export const GOAL_COMPLETE_COLOR = "#B8E45C";
export const ALL_GOALS_COMPLETE_COLOR = "#D7A62A";

export const THEME_COLOR_CHOICES = [
  "#081B49",
  "#0FBFB8",
  "#FF5750",
  "#2F6FED",
  "#7756D9",
  "#C14F87",
  "#D95852",
  "#D46B28",
  "#167C80",
  "#49616E",
] as const;

export const TRACKER_COLOR_CHOICES = [
  "#0FBFB8",
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

function linearChannel(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(value: string) {
  const channels = rgb(value);
  if (!channels) return 0;
  return (
    linearChannel(channels[0]) * 0.2126 +
    linearChannel(channels[1]) * 0.7152 +
    linearChannel(channels[2]) * 0.0722
  );
}

export function contrastRatio(left: string, right: string) {
  const bright = Math.max(relativeLuminance(left), relativeLuminance(right));
  const dark = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (bright + 0.05) / (dark + 0.05);
}

export function readableTextColor(background: string) {
  return contrastRatio(background, "#FFFFFF") >=
    contrastRatio(background, "#08111F")
    ? "#FFFFFF"
    : "#08111F";
}

function mixColor(value: string, target: "#000000" | "#FFFFFF", amount: number) {
  const source = rgb(value);
  const destination = rgb(target);
  if (!source || !destination) return value;
  return `#${source
    .map((channel, index) =>
      Math.round(channel + (destination[index] - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

/** Preserve the selected hue while keeping accent text and controls legible. */
export function accessibleThemeAccent(value: string, dark = false) {
  const normalized = normalizeHexColor(value) ?? "#081B49";
  const luminance = relativeLuminance(normalized);
  if (
    contrastRatio(normalized, "#FFFFFF") >= 4.5 &&
    (!dark || contrastRatio(normalized, "#101D39") >= 3)
  )
    return normalized;
  if (luminance >= 0.15 && luminance <= 0.18) return normalized;
  const target = luminance < 0.15 ? "#FFFFFF" : "#000000";
  let low = 0;
  let high = 1;
  let best = normalized;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const amount = (low + high) / 2;
    const candidate = mixColor(normalized, target, amount);
    const candidateLuminance = relativeLuminance(candidate);
    best = candidate;
    if (target === "#FFFFFF") {
      if (candidateLuminance < 0.165) low = amount;
      else high = amount;
    } else if (candidateLuminance > 0.165) low = amount;
    else high = amount;
  }
  return best;
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
