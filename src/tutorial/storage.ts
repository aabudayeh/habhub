import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  ActiveTutorialSession,
  TutorialGuide,
  TutorialProgress,
} from "./types";
import { safeTutorialRoute } from "./session";

const PROGRESS_PREFIX = "metric-rally-tutorial-progress-v1:";
const ACTIVE_PREFIX = "metric-rally-active-tutorial-v1:";
const FIRST_VISIT_PREFIX = "metric-rally-tutorial-first-visits-v1:";

function accountPart(accountId: string) {
  return encodeURIComponent(accountId || "anonymous");
}

function progressKey(accountId: string, guideId: string) {
  return `${PROGRESS_PREFIX}${accountPart(accountId)}:${encodeURIComponent(guideId)}`;
}

function activeKey(accountId: string) {
  return `${ACTIVE_PREFIX}${accountPart(accountId)}`;
}

function firstVisitKey(accountId: string) {
  return `${FIRST_VISIT_PREFIX}${accountPart(accountId)}`;
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function readTutorialProgress(
  accountId: string,
  guide: TutorialGuide,
): Promise<TutorialProgress | null> {
  const value = parseObject(
    await AsyncStorage.getItem(progressKey(accountId, guide.id)),
  );
  if (
    !value ||
    value.guideId !== guide.id ||
    value.guideVersion !== guide.version ||
    typeof value.demoAnchorDate !== "string" ||
    typeof value.stepId !== "string" ||
    typeof value.stepIndex !== "number" ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return null;
  return {
    guideId: guide.id,
    guideVersion: guide.version,
    demoAnchorDate: value.demoAnchorDate,
    stepId: value.stepId,
    stepIndex: value.stepIndex,
    completedStepIds: strings(value.completedStepIds),
    completed: value.completed === true,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
  };
}

export function writeTutorialProgress(
  accountId: string,
  progress: TutorialProgress,
) {
  return AsyncStorage.setItem(
    progressKey(accountId, progress.guideId),
    JSON.stringify(progress),
  );
}

export async function readActiveTutorial(
  accountId: string,
  guides: readonly TutorialGuide[],
): Promise<ActiveTutorialSession | null> {
  const value = parseObject(await AsyncStorage.getItem(activeKey(accountId)));
  const guide = guides.find((item) => item.id === value?.guideId);
  if (
    !value ||
    !guide ||
    value.guideVersion !== guide.version ||
    typeof value.stepId !== "string" ||
    typeof value.stepIndex !== "number" ||
    typeof value.runId !== "number" ||
    typeof value.demoAnchorDate !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return null;
  const stepIndex = Math.floor(value.stepIndex);
  const step = guide.steps[stepIndex];
  if (!Number.isFinite(stepIndex) || !step || step.id !== value.stepId)
    return null;
  return {
    guideId: guide.id,
    guideVersion: guide.version,
    stepId: value.stepId,
    stepIndex,
    runId: value.runId,
    experienceMode: value.experienceMode === "watch" ? "watch" : "practice",
    returnPath:
      typeof value.returnPath === "string" && safeTutorialRoute(value.returnPath)
        ? value.returnPath
        : undefined,
    demoAnchorDate: value.demoAnchorDate,
    completedStepIds: strings(value.completedStepIds),
    practiceActionIds: strings(value.practiceActionIds),
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
  };
}

/** Page-tour prompts are local, account-scoped UX state, never cloud data. */
export async function readPromptedTutorialPages(accountId: string) {
  const value = parseObject(await AsyncStorage.getItem(firstVisitKey(accountId)));
  return strings(value?.pageIds);
}

export async function markTutorialPagePrompted(
  accountId: string,
  pageId: string,
) {
  const pageIds = await readPromptedTutorialPages(accountId);
  if (pageIds.includes(pageId)) return;
  await AsyncStorage.setItem(
    firstVisitKey(accountId),
    JSON.stringify({ pageIds: [...pageIds, pageId], updatedAt: new Date().toISOString() }),
  );
}

export function writeActiveTutorial(
  accountId: string,
  session: ActiveTutorialSession,
) {
  return AsyncStorage.setItem(activeKey(accountId), JSON.stringify(session));
}

export function clearActiveTutorial(accountId: string) {
  return AsyncStorage.removeItem(activeKey(accountId));
}
