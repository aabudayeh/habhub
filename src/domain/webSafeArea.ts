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
 * Screen's bottom padding predates the navigator-owned tab-bar space. A Web
 * tab scene already ends at the top edge of that navigator and must not reserve
 * another content gutter above it. This deliberately depends on the Web
 * environment being present rather than user-agent detection: installed iOS
 * apps can expose reduced or desktop-like navigator values. Native callers and
 * non-tab routes retain their existing safety clearance.
 */
export function resolveScreenBottomPadding(
  defaultMinimum: number,
  explicitMinimum: number | undefined,
  userPadding: number | undefined,
  safeAreaBottom: number,
  isTabScene: boolean,
  environment?: WebDisplayEnvironment,
) {
  const webTabScene = isTabScene && Boolean(environment);
  if (webTabScene) return 0;
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
