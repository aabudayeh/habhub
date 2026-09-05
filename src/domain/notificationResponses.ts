export type NotificationResponseIdentity = Readonly<{
  actionIdentifier: string;
  notificationDate: number;
  notificationIdentifier: string;
}>;

export type NotificationResponseReadiness = Readonly<{
  authConfigured: boolean;
  authStatus: "loading" | "signedOut" | "signedIn" | "demo";
  authUserId?: string;
  hydrated: boolean;
  onboardingComplete: boolean;
  responseOwnerId?: string;
  stateUserId: string;
  tutorialActive: boolean;
}>;

export type NotificationResponseDisposition = "wait" | "open" | "discard";
export type WorkoutNotificationActionDisposition =
  | "wait"
  | "apply"
  | "discard";

type DefaultLandingTimerHandle = ReturnType<typeof setTimeout>;

type DefaultLandingScheduler = Readonly<{
  cancel?: (handle: DefaultLandingTimerHandle) => void;
  isStillPending: () => boolean;
  navigate: () => void;
  schedule?: (callback: () => void) => DefaultLandingTimerHandle;
}>;

const DEFAULT_RESPONSE_HISTORY_LIMIT = 64;

function responseIdentityKey(identity: NotificationResponseIdentity) {
  return JSON.stringify([
    identity.notificationIdentifier,
    identity.notificationDate,
    identity.actionIdentifier,
  ]);
}

/**
 * Expo can surface the same tap through both the live listener and its cached
 * last-response getter. Keep a small process-local history so either arrival
 * order opens a destination at most once.
 */
export function createNotificationResponseClaimGate(
  historyLimit = DEFAULT_RESPONSE_HISTORY_LIMIT,
) {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1)
    throw new RangeError("Notification response history must be positive.");

  const handled = new Set<string>();

  return (identity: NotificationResponseIdentity) => {
    const key = responseIdentityKey(identity);
    if (handled.has(key)) return false;

    handled.add(key);
    while (handled.size > historyLimit) {
      const oldest = handled.values().next().value;
      if (typeof oldest !== "string") break;
      handled.delete(oldest);
    }
    return true;
  };
}

/**
 * Notification data is account-scoped navigation state. New notifications use
 * `accountId`; the workout timer's existing owner field keeps older scheduled
 * rows safe while users upgrade.
 */
export function notificationResponseOwnerId(
  data: Record<string, unknown> | null | undefined,
) {
  const candidate = data?.accountId ?? data?.workoutOwnerId;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

const workoutNotificationActions = new Set([
  "workout-next",
  "workout-pause",
  "workout-resume",
  "workout-finish",
]);

/**
 * A normal tap on the workout notification only opens Gym. Action buttons are
 * different: iOS must retain their cached response until the hydrated workout
 * draft has actually consumed the transition.
 */
export function isActionableWorkoutNotificationResponse(
  data: Record<string, unknown> | null | undefined,
  actionIdentifier: string,
) {
  return (
    data?.workoutTimer === true &&
    data.route === "/gym" &&
    workoutNotificationActions.has(actionIdentifier)
  );
}

export function shouldDeferWorkoutNotificationResponseClear({
  actionIdentifier,
  data,
  disposition,
  platform,
}: {
  actionIdentifier: string;
  data: Record<string, unknown> | null | undefined;
  disposition: NotificationResponseDisposition;
  platform: string;
}) {
  return (
    platform === "ios" &&
    disposition === "open" &&
    isActionableWorkoutNotificationResponse(data, actionIdentifier)
  );
}

/**
 * Gym owns the iOS action only after its account-scoped draft is hydrated.
 * An authoritative empty draft consumes the stale response without applying
 * it, while a temporary cold-start state keeps Expo's cached handoff intact.
 */
export function workoutNotificationActionDisposition({
  accountAuthorityReady,
  draftReady,
  hydrated,
  responseOwnerId,
  stateUserId,
  timerActive,
}: {
  accountAuthorityReady: boolean;
  draftReady: boolean;
  hydrated: boolean;
  responseOwnerId?: string;
  stateUserId: string;
  timerActive: boolean;
}): WorkoutNotificationActionDisposition {
  if (!accountAuthorityReady || !hydrated || !draftReady) return "wait";
  if (!responseOwnerId || responseOwnerId !== stateUserId) return "discard";
  return timerActive ? "apply" : "discard";
}

/**
 * A cold-start response must survive auth and hydration redirects. Once an
 * authenticated account is authoritative, a response for another account is
 * consumed without exposing its destination.
 */
export function notificationResponseDisposition({
  authConfigured,
  authStatus,
  authUserId,
  hydrated,
  onboardingComplete,
  responseOwnerId,
  stateUserId,
  tutorialActive,
}: NotificationResponseReadiness): NotificationResponseDisposition {
  if (!hydrated || tutorialActive || !onboardingComplete) return "wait";

  // Demo mode is available in configured release builds too. Resolve it before
  // the configured-auth branch so an exact demo-owned tap cannot wait forever
  // for a signed-in user that intentionally does not exist.
  if (authStatus === "demo") {
    return responseOwnerId === stateUserId ||
      responseOwnerId === `demo:${stateUserId}`
      ? "open"
      : "discard";
  }

  if (authConfigured) {
    if (authStatus !== "signedIn" || !authUserId) return "wait";
    if (authUserId !== stateUserId) return "wait";
    // Unscoped responses can have survived an account switch from an older
    // build. Fail closed instead of guessing that they belong to this account.
    return responseOwnerId === authUserId ? "open" : "discard";
  }

  return "wait";
}

/**
 * Defers the configured landing page until navigation has mounted while
 * allowing a higher-priority notification tap (or unmount) to revoke it.
 * The callback also checks current ownership immediately before navigating so
 * a stale timer cannot overwrite a route that won after it was scheduled.
 */
export function scheduleGuardedDefaultLanding({
  cancel = (handle) => clearTimeout(handle),
  isStillPending,
  navigate,
  schedule = (callback) => setTimeout(callback, 0),
}: DefaultLandingScheduler) {
  let active = true;
  const handle = schedule(() => {
    if (!active) return;
    active = false;
    if (!isStillPending()) return;
    navigate();
  });

  return () => {
    if (!active) return;
    active = false;
    cancel(handle);
  };
}
