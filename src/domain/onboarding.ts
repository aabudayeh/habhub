export type OnboardingCloudStatus =
  | "disabled"
  | "initializing"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

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
    cloudSyncStatus === "offline" ||
    cloudSyncStatus === "error"
  );
}
