export type WebDisplayEnvironment = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
};

export const STANDALONE_IOS_TAB_BOTTOM_INSET = 10;
export const WEB_TAB_CONTENT_BOTTOM_PADDING = 16;
export const IOS_WEB_MIN_EDITOR_FONT_SIZE = 16;

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
 * React Native Web gives a horizontal ScrollView `flexShrink: 1`. That is
 * normally harmless, but installed iOS web apps expose a taller full-screen
 * viewport and can select one more card per page than the remaining scene can
 * display. The pager then shrinks and clips the last card above the tab bar,
 * which looks like a safe-area-coloured strip attached to the navigator.
 *
 * Keep existing browser/native sizing unless the caller already requested
 * natural Web height or this is specifically an installed iOS web app. The
 * navigator still owns the real bottom safe area and home-indicator clearance.
 */
export function resolveWebPagerNaturalHeight(
  requested: boolean,
  environment?: WebDisplayEnvironment,
): boolean {
  return requested || Boolean(environment && isStandaloneIosWebApp(environment));
}

/**
 * Mobile Safari zooms the complete page when a focused editor renders below
 * 16 CSS pixels. Protect every iOS Web editor by default, while preserving the
 * existing explicit opt-in used by compact cross-platform editors (Chat) and
 * allowing a deliberate opt-out when a future control truly needs one.
 */
export function resolveWebEditorFontSize(
  fontSize: number,
  environment?: WebDisplayEnvironment,
  preventWebFocusZoom?: boolean,
): number {
  const normalizedFontSize = Number.isFinite(fontSize)
    ? Math.max(0, fontSize)
    : IOS_WEB_MIN_EDITOR_FONT_SIZE;
  const protectFocus =
    preventWebFocusZoom === true ||
    (preventWebFocusZoom !== false &&
      Boolean(environment && isIosWebDevice(environment)));
  return protectFocus
    ? Math.max(IOS_WEB_MIN_EDITOR_FONT_SIZE, normalizedFontSize)
    : normalizedFontSize;
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
