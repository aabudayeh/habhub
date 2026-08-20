import type { LandingPage, UserSettings } from "@/src/types";

/**
 * Today and Status form the stable starting pair, while Chat stays at the
 * reachable right edge. The remaining pages retain the user's relative order.
 */
export const DEFAULT_TAB_ORDER: readonly LandingPage[] = [
  "index",
  "status",
  "log",
  "group",
  "insights",
  "gym",
  "calendar",
  "journal",
  "performance",
  "chat",
];

const FIXED_TAB_IDS = new Set<LandingPage>(["index", "status", "chat"]);

export function isFixedNavigationPage(page: LandingPage) {
  return FIXED_TAB_IDS.has(page);
}

/**
 * Repairs missing/duplicate tab ids and enforces the two fixed navigation
 * edges without discarding the user's ordering of the middle pages.
 */
export function normalizeTabOrder(
  savedOrder: readonly LandingPage[] | undefined,
): LandingPage[] {
  const validSaved = (savedOrder ?? []).filter(
    (id, index) =>
      DEFAULT_TAB_ORDER.includes(id) && savedOrder?.indexOf(id) === index,
  );
  const complete = [
    ...validSaved,
    ...DEFAULT_TAB_ORDER.filter((id) => !validSaved.includes(id)),
  ];
  const middle = complete.filter((id) => !FIXED_TAB_IDS.has(id));
  return ["index", "status", ...middle, "chat"];
}

/** One-time v25 default: expose Status, then preserve later opt-outs. */
export function navigationDefaultsForVersion(
  settings: Pick<UserSettings, "showStatus" | "tabOrder">,
  sourceVersion: number,
) {
  return {
    showStatus: sourceVersion < 25 ? true : settings.showStatus !== false,
    tabOrder: normalizeTabOrder(settings.tabOrder),
  };
}
