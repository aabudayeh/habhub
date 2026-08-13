import type {
  ActiveTutorialSession,
  TutorialGuide,
  TutorialProgress,
  TutorialStep,
} from "./types";
import { dateKey } from "../domain/date";
import { resolveTutorialRoute } from "./routes";

export function tutorialRoutePath(route: string) {
  const trimmed = route.trim();
  const path = trimmed.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function safeTutorialRoute(route: string | undefined): route is string {
  if (!route) return false;
  const trimmed = route.trim();
  return (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !/[\u0000-\u001f]/.test(trimmed) &&
    !trimmed.includes("://")
  );
}

export function resolvedTutorialRoute(
  route: string | undefined,
  demoAnchorDate?: string,
) {
  const resolved = resolveTutorialRoute(route, demoAnchorDate ?? dateKey());
  return safeTutorialRoute(resolved) ? resolved : undefined;
}

export function routeForStep(step: TutorialStep, demoAnchorDate?: string) {
  const candidate = step.navigation?.before ?? step.path;
  return resolvedTutorialRoute(candidate, demoAnchorDate) ?? "/";
}

export type TutorialCompletionState = {
  tutorialComplete: boolean;
  advancedTutorialComplete: boolean;
};

export function tutorialCloseSettings(
  guideId: string,
  completed: boolean,
  current: TutorialCompletionState,
) {
  return {
    tutorialComplete:
      guideId === "essential" ? true : current.tutorialComplete,
    advancedTutorialComplete:
      completed && guideId === "full-app"
        ? true
        : current.advancedTutorialComplete,
    tutorialGuideId: undefined,
    tutorialGuideRunId: undefined,
  };
}

export function tutorialGuideTrigger(settings: {
  tutorialComplete: boolean;
  tutorialGuideId?: string;
}) {
  return (
    settings.tutorialGuideId ??
    (!settings.tutorialComplete ? "essential" : undefined)
  );
}

export function tutorialSessionBlocksTrigger(
  activeGuideId: string | undefined,
  pendingGuideId: string | undefined,
) {
  return Boolean(activeGuideId || pendingGuideId);
}

export function routeMatchesStep(
  pathname: string,
  step: TutorialStep,
  demoAnchorDate?: string,
) {
  return (
    tutorialRoutePath(pathname) ===
    tutorialRoutePath(routeForStep(step, demoAnchorDate))
  );
}

export function clampedStepIndex(guide: TutorialGuide, index: number) {
  return Math.max(0, Math.min(guide.steps.length - 1, Math.floor(index || 0)));
}

export function stepIndexById(
  guide: TutorialGuide,
  stepId: string | undefined,
) {
  const index = stepId
    ? guide.steps.findIndex((step) => step.id === stepId)
    : -1;
  return index >= 0 ? index : 0;
}

export function createTutorialSession(
  guide: TutorialGuide,
  options?: {
    progress?: TutorialProgress | null;
    resume?: boolean;
    stepId?: string;
    now?: string;
    runId?: number;
    demoAnchorDate?: string;
  },
): ActiveTutorialSession {
  const now = options?.now ?? new Date().toISOString();
  const resumable =
    options?.resume &&
    options.progress?.guideId === guide.id &&
    options.progress.guideVersion === guide.version &&
    !options.progress.completed;
  const requestedIndex = options?.stepId
    ? stepIndexById(guide, options.stepId)
    : resumable
      ? options.progress!.stepIndex
      : 0;
  const stepIndex = clampedStepIndex(guide, requestedIndex);
  return {
    guideId: guide.id,
    guideVersion: guide.version,
    stepId: guide.steps[stepIndex]?.id ?? "",
    stepIndex,
    runId: options?.runId ?? Date.now(),
    demoAnchorDate:
      options?.demoAnchorDate ??
      dateKey(),
    completedStepIds: resumable
      ? options.progress!.completedStepIds.filter((id) =>
          guide.steps.some((step) => step.id === id),
        )
      : [],
    practiceActionIds: [],
    startedAt: resumable ? options.progress!.startedAt : now,
    updatedAt: now,
  };
}

export function reanchorTutorialSession(
  session: ActiveTutorialSession,
  demoAnchorDate = dateKey(),
  now = new Date().toISOString(),
): ActiveTutorialSession {
  if (session.demoAnchorDate === demoAnchorDate) return session;
  return { ...session, demoAnchorDate, updatedAt: now };
}

export function moveTutorialSession(
  guide: TutorialGuide,
  session: ActiveTutorialSession,
  direction: 1 | -1,
  now = new Date().toISOString(),
) {
  const current = guide.steps[clampedStepIndex(guide, session.stepIndex)];
  const stepIndex = clampedStepIndex(guide, session.stepIndex + direction);
  const completedStepIds =
    direction > 0 && current && !session.completedStepIds.includes(current.id)
      ? [...session.completedStepIds, current.id]
      : session.completedStepIds;
  return {
    ...session,
    stepIndex,
    stepId: guide.steps[stepIndex]?.id ?? "",
    completedStepIds,
    updatedAt: now,
  };
}

export function recordTutorialPracticeAction(
  guide: TutorialGuide,
  session: ActiveTutorialSession,
  actionId: string,
  options?: { autoAdvance?: boolean; now?: string },
) {
  const now = options?.now ?? new Date().toISOString();
  const recorded = session.practiceActionIds.includes(actionId)
    ? session
    : {
        ...session,
        practiceActionIds: [...session.practiceActionIds, actionId],
        updatedAt: now,
      };
  return options?.autoAdvance && session.stepIndex < guide.steps.length - 1
    ? moveTutorialSession(guide, recorded, 1, now)
    : recorded;
}

export function sessionProgress(
  session: ActiveTutorialSession,
  completed: boolean,
  now = new Date().toISOString(),
): TutorialProgress {
  const completedStepIds = completed
    ? session.stepId && !session.completedStepIds.includes(session.stepId)
      ? [...session.completedStepIds, session.stepId]
      : session.completedStepIds
    : session.completedStepIds;
  return {
    guideId: session.guideId,
    guideVersion: session.guideVersion,
    demoAnchorDate: session.demoAnchorDate,
    stepId: session.stepId,
    stepIndex: session.stepIndex,
    completedStepIds,
    completed,
    startedAt: session.startedAt,
    updatedAt: now,
  };
}
