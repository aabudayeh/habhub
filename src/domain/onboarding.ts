import type { HealthDataType } from "../types";

type OnboardingHealthTracker = {
  templateId: string;
  healthMapping?: { dataType: HealthDataType };
  submetrics?: readonly {
    healthMapping?: { dataType: HealthDataType };
  }[];
};

/**
 * Limits the first native health consent request to the features the person
 * selected during onboarding. Formula-only energy balance trackers need total
 * energy even though their dependency is intentionally hidden from the setup
 * catalog.
 */
export function selectedOnboardingHealthDataTypes(
  trackers: readonly OnboardingHealthTracker[],
  selectedTrackerIds: readonly string[],
): HealthDataType[] {
  const selected = new Set(selectedTrackerIds);
  const result = new Set<HealthDataType>();

  for (const tracker of trackers) {
    if (!selected.has(tracker.templateId)) continue;
    if (tracker.healthMapping) result.add(tracker.healthMapping.dataType);
    for (const submetric of tracker.submetrics ?? []) {
      if (submetric.healthMapping)
        result.add(submetric.healthMapping.dataType);
    }
  }

  if (selected.has("deficit") || selected.has("weekly_deficit_balance"))
    result.add("total_energy");

  return [...result];
}

export type OnboardingCloudStatus =
  | "disabled"
  | "initializing"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export type OnboardingProfileSyncResult =
  | { status: "synced"; attempts: number }
  | {
      status: "deferred";
      attempts: number;
      reason: "account_changed" | "failed" | "timed_out";
      error: unknown;
    };

class OnboardingProfileSyncTimeoutError extends Error {
  constructor() {
    super("Account profile sync timed out.");
    this.name = "OnboardingProfileSyncTimeoutError";
  }
}

function settleWithin<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OnboardingProfileSyncTimeoutError()),
      Math.max(1, timeoutMs),
    );
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Makes a bounded, account-scoped attempt to mirror the locally saved
 * onboarding name into auth metadata. Fast failures receive one retry. A
 * timed-out request is not duplicated because the original request may still
 * complete, and every failure is returned instead of blocking onboarding.
 */
export async function syncOnboardingProfileBestEffort({
  sync,
  isAccountCurrent,
  maxAttempts = 2,
  attemptTimeoutMs = 3_000,
  retryDelayMs = 150,
}: {
  sync: () => Promise<void>;
  isAccountCurrent: () => boolean;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
}): Promise<OnboardingProfileSyncResult> {
  const attemptsAllowed = Math.max(1, Math.min(2, Math.trunc(maxAttempts)));
  let attempts = 0;
  let lastError: unknown = new Error("Account profile sync was deferred.");

  while (attempts < attemptsAllowed) {
    if (!isAccountCurrent())
      return {
        status: "deferred",
        attempts,
        reason: "account_changed",
        error: lastError,
      };
    attempts += 1;
    try {
      await settleWithin(Promise.resolve().then(sync), attemptTimeoutMs);
      return { status: "synced", attempts };
    } catch (error) {
      lastError = error;
      if (error instanceof OnboardingProfileSyncTimeoutError)
        return {
          status: "deferred",
          attempts,
          reason: "timed_out",
          error,
        };
      if (attempts >= attemptsAllowed)
        return {
          status: "deferred",
          attempts,
          reason: "failed",
          error,
        };
      if (retryDelayMs > 0)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, retryDelayMs),
        );
    }
  }

  return {
    status: "deferred",
    attempts,
    reason: "failed",
    error: lastError,
  };
}

/**
 * A fresh browser has no trustworthy local onboarding marker. Do not decide
 * that it is a new account until the first cloud account read has succeeded.
 * A previously completed local account can keep working offline.
 */
export function shouldWaitForOnboardingAuthority({
  authStatus,
  cloudSyncStatus,
  onboardingDone,
}: {
  authStatus: "loading" | "signedIn" | "signedOut" | "demo";
  cloudSyncStatus: OnboardingCloudStatus;
  onboardingDone: boolean;
}) {
  if (authStatus !== "signedIn" || onboardingDone) return false;
  return (
    cloudSyncStatus === "disabled" ||
    cloudSyncStatus === "initializing" ||
    cloudSyncStatus === "syncing" ||
    cloudSyncStatus === "offline" ||
    cloudSyncStatus === "error"
  );
}
