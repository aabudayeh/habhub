/** Runtime placeholder used by tutorial routes that depend on the demo anchor day. */
export const TUTORIAL_DATE_ROUTE_TOKEN = ":tutorial-date" as const;

export const TUTORIAL_DAY_ROUTE =
  `/day/${TUTORIAL_DATE_ROUTE_TOKEN}` as const;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves tutorial-only route placeholders against the active sandbox date. */
export function resolveTutorialRoute(
  route: string | undefined,
  anchorDate: string,
): string | undefined {
  if (!route) return route;
  if (!DATE_KEY_PATTERN.test(anchorDate))
    throw new Error(`Invalid tutorial anchor date: ${anchorDate}`);
  return route.replaceAll(TUTORIAL_DATE_ROUTE_TOKEN, anchorDate);
}
