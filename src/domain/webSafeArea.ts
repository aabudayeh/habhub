export type WebDisplayEnvironment = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
};

export const STANDALONE_IOS_TAB_BOTTOM_INSET = 10;

export function isIosWebDevice(
  environment: WebDisplayEnvironment,
): boolean {
  const userAgent = environment.userAgent?.toLowerCase() ?? "";
  const platform = environment.platform?.toLowerCase() ?? "";
  const maxTouchPoints = Number.isFinite(environment.maxTouchPoints)
    ? Math.max(0, environment.maxTouchPoints ?? 0)
    : 0;
  return (
    /iphone|ipad|ipod/.test(userAgent) ||
    (platform === "macintel" && maxTouchPoints > 1)
  );
}

export function isStandaloneIosWebApp(
  environment: WebDisplayEnvironment,
): boolean {
  const standalone =
    environment.displayModeStandalone === true ||
    environment.navigatorStandalone === true;

  return isIosWebDevice(environment) && standalone;
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

/**
 * Screen's bottom padding predates the navigator-owned tab-bar space. iOS Web
 * tab scenes must not reserve another content gutter above that navigator,
 * regardless of whether Safari reports its standalone flag reliably. Non-tab
 * routes and every other platform keep their existing safety clearance.
 */
export function resolveScreenBottomPadding(
  defaultMinimum: number,
  explicitMinimum: number | undefined,
  userPadding: number | undefined,
  safeAreaBottom: number,
  isTabScene: boolean,
  environment?: WebDisplayEnvironment,
) {
  const iosWebTab =
    isTabScene && Boolean(environment && isIosWebDevice(environment));
  if (iosWebTab) return 0;
  const requestedMinimum =
    typeof explicitMinimum === "number"
      ? Math.max(0, explicitMinimum)
      : Math.max(0, defaultMinimum);
  const requestedPadding =
    typeof userPadding === "number" ? Math.max(0, userPadding) : 0;
  const safeInset = Number.isFinite(safeAreaBottom)
    ? Math.max(0, safeAreaBottom)
    : 0;
  return Math.max(requestedMinimum, requestedPadding) + safeInset;
}
