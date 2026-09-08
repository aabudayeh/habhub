import type { TutorialGuide, TutorialProgress } from "../tutorial/types";

export type SetupPage = 0 | 1 | 2 | 3 | 4;
type SetupMode = "guided" | "classic" | null;

const GUIDED_PAGES: readonly SetupPage[] = [0];
const CLASSIC_PAGES: readonly SetupPage[] = [0, 1, 2, 3, 4];

/** Optional setup pages remain reachable without lengthening the first run. */
export function setupPageProgress(mode: SetupMode, page: SetupPage) {
  const pages = mode === "guided" ? GUIDED_PAGES : CLASSIC_PAGES;
  const index = pages.indexOf(page);
  return {
    current: index < 0 ? pages.length : index + 1,
    total: pages.length,
    optional: index < 0,
  };
}

export function adjacentSetupPage(
  mode: SetupMode,
  page: SetupPage,
  direction: -1 | 1,
): SetupPage {
  const pages = mode === "guided" ? GUIDED_PAGES : CLASSIC_PAGES;
  const index = pages.indexOf(page);
  if (index < 0) return mode === "guided" ? 0 : 4;
  return pages[Math.max(0, Math.min(pages.length - 1, index + direction))];
}

/** Motion preferences affect animation only, never the time available to read. */
export function tutorialReadingTimeMs(...text: (string | undefined)[]) {
  const copy = text.filter(Boolean).join(" ").trim();
  const words = Math.max(copy.split(/\s+/u).filter(Boolean).length, copy.length / 6);
  return Math.min(18_000, Math.max(4_500, Math.ceil((words / 210) * 60_000) + 1_200));
}

/** Give real demonstrations time to settle; missing actions stay passive. */
export function tutorialWatchTiming(readingMs: number, canActivate: boolean, autoAdvance: boolean) {
  const reading = Math.max(4_500, Number.isFinite(readingMs) ? readingMs : 4_500);
  const actionAtMs = canActivate
    ? autoAdvance ? reading : Math.max(1_450, Math.round(reading * 0.55))
    : undefined;
  return {
    actionAtMs,
    advanceAtMs: actionAtMs === undefined ? reading : Math.max(reading, actionAtMs + (autoAdvance ? 1_600 : 3_600)),
  };
}

/** A lesson learned in basics or the full guide should not prompt again. */
export function tutorialPageAlreadyLearned(
  guide: TutorialGuide | undefined,
  stepId: string | undefined,
  progressByGuide: Readonly<Record<string, TutorialProgress | undefined>>,
) {
  if (!guide) return false;
  if (progressByGuide[guide.id]?.completed) return true;
  const firstStepId = stepId ?? guide.steps[0]?.id;
  if (!firstStepId) return false;
  return Object.values(progressByGuide).some((progress) =>
    progress?.completedStepIds.includes(firstStepId),
  );
}
export type LiveSetupStep = "trackers" | "layout" | "first-log" | "explore" | "complete";

const LIVE_SETUP_STEPS: readonly LiveSetupStep[] = ["trackers", "layout", "first-log", "explore", "complete"];

export function activeLiveSetupStep(settings: {
  onboardingComplete: boolean;
  tutorialPromptsDisabled?: boolean;
  guidedSetupStep?: LiveSetupStep;
}): Exclude<LiveSetupStep, "complete"> | undefined {
  const step = settings.guidedSetupStep;
  return settings.onboardingComplete && !settings.tutorialPromptsDisabled && step && step !== "complete" && LIVE_SETUP_STEPS.includes(step)
    ? step : undefined;
}

export function nextLiveSetupStep(step: LiveSetupStep): LiveSetupStep {
  return LIVE_SETUP_STEPS[Math.min(LIVE_SETUP_STEPS.length - 1, Math.max(0, LIVE_SETUP_STEPS.indexOf(step)) + 1)];
}

export function skipAllTutorialsSettings() {
  return {
    tutorialPromptsDisabled: true,
    guidedSetupStep: "complete" as const,
    tutorialComplete: true,
    tutorialGuideId: undefined,
    tutorialGuideRunId: undefined,
  };
}
