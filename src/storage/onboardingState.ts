import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeHealthHistoryDays } from "@/src/domain/healthHistory";
import type { HealthHistoryDays, LandingPage } from "@/src/types";

const PREFIX = "metric-rally-onboarding-complete-v1:";
// Keep the established key so an in-progress v3 draft can be upgraded in
// place instead of disappearing after the guided-flow release.
const DRAFT_PREFIX = "metric-rally-onboarding-draft-v3:";

export const ONBOARDING_FLOW_VERSION = 4;

export type OnboardingMode = "guided" | "classic";

export type OnboardingDraft = {
  version: typeof ONBOARDING_FLOW_VERSION;
  onboardingMode: OnboardingMode;
  step: 0 | 1 | 2 | 3 | 4;
  displayName: string;
  goals: string[];
  selectedTrackerIds: string[];
  trackedGoalIds: string[];
  expandedGoalIds: string[];
  /** Optional numeric target edits keyed by starter tracker id. */
  goalTargets?: Record<string, string>;
  direction: "lose" | "maintain" | "gain";
  age: string;
  height: string;
  weight: string;
  target: string;
  weeklyChange: string;
  sex: "female" | "male" | "unspecified";
  activity: "sedentary" | "light" | "moderate" | "very_active" | "athlete";
  landingPage: LandingPage;
  darkMode: boolean;
  showGoalsToday: boolean;
  showTodosToday: boolean;
  startShortTour: boolean;
  healthHistoryDays: HealthHistoryDays;
  startHealthGoalsFromHistory: boolean;
  updatedAt: string;
};

type LegacyOnboardingDraftV3 = Omit<
  OnboardingDraft,
  "version" | "onboardingMode" | "showGoalsToday" | "showTodosToday"
> & {
  version: 3;
  onboardingMode?: OnboardingMode;
  showGoalsToday?: boolean;
  showTodosToday?: boolean;
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
    const draft = JSON.parse(saved) as
      | OnboardingDraft
      | LegacyOnboardingDraftV3;
    if (draft.version === ONBOARDING_FLOW_VERSION)
      return {
        ...draft,
        healthHistoryDays: normalizeHealthHistoryDays(
          draft.healthHistoryDays,
        ),
      } satisfies OnboardingDraft;
    if (draft.version === 3) {
      return {
        ...draft,
        version: ONBOARDING_FLOW_VERSION,
        // Version 3 was the original five-page setup, now offered as the
        // familiar secondary path.
        onboardingMode: draft.onboardingMode ?? "classic",
        showGoalsToday: draft.showGoalsToday ?? true,
        showTodosToday: draft.showTodosToday ?? true,
        healthHistoryDays: normalizeHealthHistoryDays(
          draft.healthHistoryDays,
        ),
      } satisfies OnboardingDraft;
    }
    return null;
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
