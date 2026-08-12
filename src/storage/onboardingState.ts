import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "metric-rally-onboarding-complete-v1:";
const DRAFT_PREFIX = "metric-rally-onboarding-draft-v3:";

export const ONBOARDING_FLOW_VERSION = 3;

export type OnboardingDraft = {
  version: typeof ONBOARDING_FLOW_VERSION;
  step: 0 | 1 | 2 | 3 | 4;
  displayName: string;
  goals: string[];
  selectedTrackerIds: string[];
  trackedGoalIds: string[];
  expandedGoalIds: string[];
  direction: "lose" | "maintain" | "gain";
  age: string;
  height: string;
  weight: string;
  target: string;
  weeklyChange: string;
  sex: "female" | "male" | "unspecified";
  activity: "sedentary" | "light" | "moderate" | "very_active" | "athlete";
  landingPage: "index" | "log" | "group" | "insights" | "chat" | "gym" | "calendar" | "journal" | "performance" | "status";
  darkMode: boolean;
  startShortTour: boolean;
  healthHistoryDays: 30 | 90 | 365 | 730;
  startHealthGoalsFromHistory: boolean;
  updatedAt: string;
};

function key(accountId: string) {
  return `${PREFIX}${accountId}`;
}

export async function onboardingCompletedLocally(accountId: string) {
  const saved = await AsyncStorage.getItem(key(accountId));
  if (saved === "true") return true;
  if (!saved) return false;
  try {
    return Boolean(
      (JSON.parse(saved) as { completed?: boolean }).completed,
    );
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(accountId: string) {
  return AsyncStorage.setItem(
    key(accountId),
    JSON.stringify({
      completed: true,
      version: ONBOARDING_FLOW_VERSION,
      completedAt: new Date().toISOString(),
    }),
  );
}

function draftKey(accountId: string) {
  return `${DRAFT_PREFIX}${accountId}`;
}

/**
 * Account-scoped draft recovery keeps a provider remount, browser refresh, or
 * OAuth profile update from sending setup back to its first page. Unknown and
 * older shapes are ignored instead of reopening a partially incompatible flow.
 */
export async function readOnboardingDraft(accountId: string) {
  const saved = await AsyncStorage.getItem(draftKey(accountId));
  if (!saved) return null;
  try {
    const draft = JSON.parse(saved) as OnboardingDraft;
    return draft.version === ONBOARDING_FLOW_VERSION ? draft : null;
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(
  accountId: string,
  draft: OnboardingDraft,
) {
  return AsyncStorage.setItem(draftKey(accountId), JSON.stringify(draft));
}

export function clearOnboardingDraft(accountId: string) {
  return AsyncStorage.removeItem(draftKey(accountId));
}
