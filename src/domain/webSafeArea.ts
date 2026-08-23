export type WebDisplayEnvironment = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
};

export const STANDALONE_IOS_TAB_BOTTOM_INSET = 10;

export function isStandaloneIosWebApp(
  environment: WebDisplayEnvironment,
): boolean {
  const userAgent = environment.userAgent?.toLowerCase() ?? "";
  const platform = environment.platform?.toLowerCase() ?? "";
  const maxTouchPoints = Number.isFinite(environment.maxTouchPoints)
    ? Math.max(0, environment.maxTouchPoints ?? 0)
    : 0;
  const iosDevice =
    /iphone|ipad|ipod/.test(userAgent) ||
    (platform === "macintel" && maxTouchPoints > 1);
  const standalone =
    environment.displayModeStandalone === true ||
    environment.navigatorStandalone === true;

  return iosDevice && standalone;
}

/**
 * Installed iOS web apps already dedicate the bottom edge to the PWA shell.
 * Keep a small visual gutter in our tab bar instead of repeating the full
 * home-indicator inset inside it. Browser tabs, Android, desktop, and native
 * callers pass no matching environment and retain the complete safe area.
 */
export function resolveTabBarBottomInset(
  safeAreaBottom: number,
  environment?: WebDisplayEnvironment,
): number {
  const normalizedInset = Number.isFinite(safeAreaBottom)
    ? Math.max(0, safeAreaBottom)
    : 0;

  if (!environment || !isStandaloneIosWebApp(environment)) {
    return normalizedInset;
  }

  return Math.min(normalizedInset, STANDALONE_IOS_TAB_BOTTOM_INSET);
}
