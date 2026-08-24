export type WebDisplayEnvironment = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
};

export const STANDALONE_IOS_TAB_BOTTOM_INSET = 10;
export const WEB_TAB_CONTENT_BOTTOM_PADDING = 16;

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
 * iOS Safari and installed iOS web apps expose a visual viewport that already
 * stops above their browser/system gesture chrome. Reusing the full reported
 * inset inside React Navigation makes the tab bar reserve the same space a
 * second time. Keep a small touch-safe gutter in both iOS Web modes. Android,
 * desktop, and native callers retain the complete reported inset.
 */
export function resolveTabBarBottomInset(
  safeAreaBottom: number,
  environment?: WebDisplayEnvironment,
): number {
  const normalizedInset = Number.isFinite(safeAreaBottom)
    ? Math.max(0, safeAreaBottom)
    : 0;

  if (!environment || !isIosWebDevice(environment)) {
    return normalizedInset;
  }

  return Math.min(normalizedInset, STANDALONE_IOS_TAB_BOTTOM_INSET);
}

/**
 * The tab navigator owns the system safe area, while the screen owns a small
 * aesthetic/scrolling gutter below its last control. Web tab scenes therefore
 * keep content padding but must not add the reported safe-area inset again.
 * Native callers and non-tab routes retain their existing full clearance.
 */
export function resolveScreenBottomPadding(
  defaultMinimum: number,
  explicitMinimum: number | undefined,
  userPadding: number | undefined,
  safeAreaBottom: number,
  isTabScene: boolean,
  environment?: WebDisplayEnvironment,
) {
  const requestedMinimum =
    typeof explicitMinimum === "number"
      ? Math.max(0, explicitMinimum)
      : Math.max(0, defaultMinimum);
  const requestedPadding =
    typeof userPadding === "number" ? Math.max(0, userPadding) : 0;
  const safeInset = Number.isFinite(safeAreaBottom)
    ? Math.max(0, safeAreaBottom)
    : 0;
  if (isTabScene && Boolean(environment)) {
    const explicitContentPadding = Math.max(
      typeof explicitMinimum === "number" ? requestedMinimum : 0,
      requestedPadding,
    );
    return Math.max(WEB_TAB_CONTENT_BOTTOM_PADDING, explicitContentPadding);
  }
  return Math.max(requestedMinimum, requestedPadding) + safeInset;
}
