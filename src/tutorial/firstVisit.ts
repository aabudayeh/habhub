export type TutorialPagePrompt = {
  pageId: string;
  guideId: `module:${string}`;
  /** Start at the page-specific lesson instead of replaying an entire module. */
  stepId?: string;
  /** Existing localized UI label used in the optional first-visit prompt. */
  title?: string;
};

const EXACT_PAGE_TOURS: Readonly<Record<string, TutorialPagePrompt>> = {
  "/status": { pageId: "status", guideId: "module:status" },
  "/profile": {
    pageId: "profile",
    guideId: "module:status",
    stepId: "full.status.profile",
    title: "My profile",
  },
  "/group": { pageId: "leaderboard", guideId: "module:leaderboard" },
  "/recap": { pageId: "group-recap", guideId: "module:group-recap" },
  "/recapfeed": {
    pageId: "recap-feed",
    guideId: "module:group-recap",
    stepId: "full.group-recap.feed",
    title: "Group recap",
  },
  "/(tabs)/recapfeed": {
    pageId: "recap-feed",
    guideId: "module:group-recap",
    stepId: "full.group-recap.feed",
    title: "Group recap",
  },
  "/group-schedule": { pageId: "group-schedule", guideId: "module:group-schedule" },
  "/group-notes": { pageId: "group-notes", guideId: "module:group-notes" },
  "/log": { pageId: "log", guideId: "module:log" },
  "/insights": { pageId: "progress", guideId: "module:progress" },
  "/gym": { pageId: "workout", guideId: "module:workout" },
  "/gym-exercise": {
    pageId: "exercise-progress",
    guideId: "module:workout",
    stepId: "full.workout.exercise-detail",
    title: "Workout",
  },
  "/chat": { pageId: "chat", guideId: "module:chat" },
  "/calendar": { pageId: "schedule", guideId: "module:schedule" },
  "/journal": { pageId: "journal", guideId: "module:journal" },
  "/performance": { pageId: "performance", guideId: "module:performance" },
  "/metric-detail": { pageId: "metric-detail", guideId: "module:metric-detail" },
  "/todo-editor": { pageId: "todo", guideId: "module:todo" },
  "/group-todo-editor": { pageId: "group-todo", guideId: "module:todo" },
  "/food-search": { pageId: "food", guideId: "module:food" },
  "/timer": { pageId: "timer", guideId: "module:timer" },
  "/timers": {
    pageId: "timers-tab",
    guideId: "module:timer",
    stepId: "full.timer.setup",
    title: "Timer",
  },
  "/(tabs)/timers": {
    pageId: "timers-tab",
    guideId: "module:timer",
    stepId: "full.timer.setup",
    title: "Timer",
  },
  "/menu": { pageId: "menu", guideId: "module:menu" },
  "/quick-guide": {
    pageId: "quick-guide",
    guideId: "module:menu",
    stepId: "full.menu.quick-guide",
    title: "Quick guide",
  },
  "/customize": { pageId: "customize", guideId: "module:custom-metric" },
  "/metric-editor": { pageId: "metric-editor", guideId: "module:custom-metric" },
  "/settings": { pageId: "settings", guideId: "module:settings" },
  "/legal-support": {
    pageId: "legal-support",
    guideId: "module:settings",
    stepId: "full.settings.legal-support",
    title: "Legal & support",
  },
  "/notifications": { pageId: "notifications", guideId: "module:notifications" },
  "/alerts": {
    pageId: "alerts",
    guideId: "module:notifications",
    stepId: "full.notifications.inbox",
    title: "Group updates",
  },
  "/display-settings": { pageId: "display", guideId: "module:display" },
  "/view-filters": {
    pageId: "view-filters",
    guideId: "module:today",
    stepId: "full.today.filter-manager",
    title: "Custom views",
  },
  "/note-editor": {
    pageId: "note-editor",
    guideId: "module:journal",
    stepId: "full.journal.labels",
    title: "New note",
  },
  "/reminder-editor": {
    pageId: "reminder-editor",
    guideId: "module:schedule",
    stepId: "full.schedule.tracker-reminders",
    title: "New reminder",
  },
  "/vacation": {
    pageId: "vacation",
    guideId: "module:performance",
    stepId: "full.performance.vacation",
    title: "Vacation mode",
  },
  "/safety": {
    pageId: "safety",
    guideId: "module:chat",
    stepId: "full.chat.safety",
    title: "Safety Center",
  },
  "/group-settings": {
    pageId: "group-settings",
    guideId: "module:groups",
    stepId: "full.groups.settings",
    title: "Group settings",
  },
  "/challenges": { pageId: "challenges", guideId: "module:challenges" },
  "/badges": { pageId: "badges", guideId: "module:badges" },
  "/groups": { pageId: "groups", guideId: "module:groups" },
  "/create-group": { pageId: "create-group", guideId: "module:groups" },
  "/leaderboard-detail": { pageId: "leaderboard-detail", guideId: "module:leaderboard" },
};

/**
 * Matches a routed page to its short replayable guide. Today is deliberately
 * absent because the first-run essentials already introduce Today and the
 * navigation bar before the person starts exploring.
 */
export function tutorialPromptForPath(
  pathname: string,
): TutorialPagePrompt | undefined {
  const normalized = pathname.length > 1
    ? pathname.replace(/\/+$/, "")
    : pathname;
  const exact = EXACT_PAGE_TOURS[normalized];
  if (exact) return exact;
  if (normalized.startsWith("/day/"))
    return { pageId: "daily-detail", guideId: "module:daily-detail" };
  if (normalized.startsWith("/member-profile/") || normalized.startsWith("/member/"))
    return { pageId: "comparison", guideId: "module:comparison" };
  return undefined;
}

export const FIRST_VISIT_TUTORIAL_PAGE_IDS = [
  ...new Set([
    ...Object.values(EXACT_PAGE_TOURS).map((item) => item.pageId),
    "daily-detail",
    "comparison",
  ]),
].sort();
