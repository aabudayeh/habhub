import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';
import { localeForLanguage, translateUiText } from '@/src/i18n';
import { AppLanguage, AppState, NotificationSettings } from '@/src/types';
import {
  localizeExerciseName,
  localizeMetricName,
  localizeMetricUnit,
} from '@/src/i18n/domain';
import { cycleForecast } from '@/src/domain/cycle';
import { dateKey, dateWithOffsetFrom } from '@/src/domain/date';
import {
  effectiveGoalTarget,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricStreakStats,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
} from '@/src/domain/metrics';
import { defaultProgressReminderPercentages } from '@/src/domain/reminders';
import {
  earliestLocalNotificationSchedules,
  goalReminderNotificationId,
  goalReminderSemanticKey,
  LOCAL_NOTIFICATION_BUDGETS,
  localNotificationIdentifier,
  notificationFallsAfterFastingTarget,
  quietHoursAdjustedDateTime,
} from '@/src/domain/notificationScheduling';
import { automaticFastProgress } from '@/src/domain/fasting';
import { createLatestAsyncDrain } from '@/src/domain/latestAsyncDrain';
import {
  averageGymRestSeconds,
  completedGymSets,
  estimatedOneRepMax,
  exerciseHistory,
  exerciseIdentity,
  trainingVolumeKg,
} from '@/src/domain/gym';
import {
  scheduleAppliesOnDate,
  todoReminderAppliesOnDate,
  todoResolvedOnDate,
} from '@/src/domain/schedule';
import {
  ensureLocalNotificationChannels,
} from '@/src/notifications/localChannels';
import {
  dateLocalNotificationPlan,
  clearAllLocalNotifications,
  type LocalNotificationPlan,
  reconcileLocalNotifications,
  scheduleImmediateManagedLocalNotification,
} from '@/src/notifications/localScheduling';
import { requestLocalNotificationRefresh } from '@/src/notifications/localRefresh';
import { clearWorkoutTimerNotifications } from '@/src/notifications/workoutTimer';
import { clearLiveActivityTimerNotifications } from '@/src/notifications/liveTimer';
import {
  ACTIVITY_TIMER_ALERT_IDS,
  syncActivityTimerAlerts,
} from '@/src/notifications/activityTimerAlerts';
import type { ScreenTimeReport } from '@/src/screenTime';
import { readScreenTimeAppLimits } from '@/src/screenTime/appLimits';
import {
  clearCurrentWebPushIdentity,
  enableWebPushNotifications,
  recoverWebPushRegistration,
  unregisterCurrentWebPushSubscription,
  unregisterOrphanedWebPushSubscription,
  updateWebPushPreferences,
  webPushPermissionGranted,
  webPushSetupComplete,
} from '@/src/notifications/webPush';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isChat = notification.request.content.data?.route === '/chat';
    // Foreground chat uses the themed in-app banner, while the OS notification
    // remains in Notification Center. Background/closed delivery is unaffected.
    return { shouldShowBanner: !isChat, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

async function ensureNotificationChannel(language: AppLanguage = "en") {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('paceboard', {
    name: translateUiText(language, 'HabHub messages and updates'),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    sound: 'default',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

function storedPreferences(preferences: NotificationSettings, language: AppLanguage) {
  return {
    ...preferences,
    language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

let pushRegistrationQueue: Promise<void> = Promise.resolve();
const EXPO_TOKEN_CACHE_PREFIX = 'habhub-expo-push-token-v1:';
const PUSH_REGISTRATION_CACHE_PREFIX = 'habhub-push-registration-v2:';
const PUSH_DISABLE_PENDING_PREFIX = 'habhub-push-disable-pending-v1:';
const PUSH_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const PUSH_TOKEN_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const PUSH_TOKEN_FOREGROUND_REFRESH_MS = 15 * 60 * 1000;
const pushRegistrationBySignature = new Map<string, Promise<void>>();
const pushRegistrationMemory = new Map<
  string,
  { signature: string; registeredAt: number }
>();
const expoTokenFetchByProject = new Map<string, Promise<string>>();
const pushTokenRefreshByAccount = new Map<string, Promise<void>>();
const pushTokenRefreshAttemptAt = new Map<string, number>();
const disabledPushRegistrationAccounts = new Set<string>();
const pushDisableByAccount = new Map<string, Promise<void>>();
let pushIdentityCleanupQueue: Promise<void> = Promise.resolve();

function tokenCacheKey(projectId: string) {
  return `${EXPO_TOKEN_CACHE_PREFIX}${projectId}`;
}

function pushProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

function registrationCacheKey(userId: string, projectId: string) {
  return `${PUSH_REGISTRATION_CACHE_PREFIX}${projectId}:${userId}`;
}

function registrationAccountKey(userId: string, projectId: string) {
  return `${projectId}:${userId}`;
}

function pendingPushDisableKey(userId: string) {
  return `${PUSH_DISABLE_PENDING_PREFIX}${userId}`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function fetchExpoPushToken(projectId: string) {
  const inFlight = expoTokenFetchByProject.get(projectId);
  if (inFlight) return inFlight;
  const operation = (async () => {
    let lastError: unknown;
    for (const delay of [0, 700, 1800]) {
      if (delay) await wait(delay);
      try {
        const token = (
          await Notifications.getExpoPushTokenAsync({ projectId })
        ).data;
        await AsyncStorage.setItem(tokenCacheKey(projectId), token);
        return token;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  })();
  expoTokenFetchByProject.set(projectId, operation);
  operation.then(
    () => expoTokenFetchByProject.delete(projectId),
    () => expoTokenFetchByProject.delete(projectId),
  );
  return operation;
}

async function cachedOrFreshExpoPushToken(projectId: string) {
  const cached = await AsyncStorage.getItem(tokenCacheKey(projectId));
  if (cached) return { token: cached, cached: true };
  return {
    token: await fetchExpoPushToken(projectId),
    cached: false,
  };
}

async function registerPushToken(
  userId: string,
  projectId: string,
  token: string,
  preferences: NotificationSettings,
  language: AppLanguage,
  force = false,
) {
  const client = supabase;
  if (!client) return;
  const accountKey = registrationAccountKey(userId, projectId);
  if (disabledPushRegistrationAccounts.has(accountKey)) return;
  const stored = storedPreferences(preferences, language);
  const cacheKey = registrationCacheKey(userId, projectId);
  const signature = JSON.stringify({
    userId,
    projectId,
    token,
    platform: Platform.OS,
    preferences: stored,
  });
  const operationKey = `${force ? 'force' : 'normal'}:${signature}`;
  const inFlight = pushRegistrationBySignature.get(operationKey);
  if (inFlight) return inFlight;
  // Capture the auth-transition barrier now. A later sign-out cleanup captures
  // this registration queue in turn, which avoids a circular wait while still
  // guaranteeing that account B cannot reuse account A's native token.
  const identityBarrier = pushIdentityCleanupQueue;
  const operation = pushRegistrationQueue
    .catch(() => undefined)
    .then(async () => {
      await identityBarrier.catch(() => undefined);
      if (disabledPushRegistrationAccounts.has(accountKey)) return;
      if (!force) {
        let prior = pushRegistrationMemory.get(cacheKey);
        if (!prior) {
          try {
            const saved = await AsyncStorage.getItem(cacheKey);
            if (saved)
              prior = JSON.parse(saved) as {
                signature: string;
                registeredAt: number;
              };
          } catch {
            // A damaged local acknowledgement should cause one safe upsert.
          }
        }
        if (
          prior?.signature === signature &&
          Number.isFinite(prior.registeredAt) &&
          Date.now() - prior.registeredAt < PUSH_REGISTRATION_TTL_MS
        ) {
          pushRegistrationMemory.set(cacheKey, prior);
          return;
        }
      }
      // A queued operation can outlive sign-out/account switching. Reading the
      // locally persisted session here prevents an old account's preferences
      // from registering this physical token under the newly signed-in user.
      const { data } = await client.auth.getSession();
      if (
        disabledPushRegistrationAccounts.has(accountKey) ||
        data.session?.user.id !== userId
      )
        return;
      const { error } = await client.rpc('register_device_push_token', {
        p_token: token,
        p_platform: Platform.OS,
        p_preferences: stored,
      });
      if (error) throw error;
      const acknowledgement = {
        signature,
        registeredAt: Date.now(),
      };
      pushRegistrationMemory.set(cacheKey, acknowledgement);
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify(acknowledgement),
      ).catch(() => undefined);
    });
  pushRegistrationQueue = operation;
  pushRegistrationBySignature.set(operationKey, operation);
  operation.then(
    () => pushRegistrationBySignature.delete(operationKey),
    () => pushRegistrationBySignature.delete(operationKey),
  );
  return operation;
}

async function registeredTokenExists(userId: string, token: string) {
  if (!supabase) return true;
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('token', token)
    .eq('platform', Platform.OS)
    .maybeSingle();
  return !error && Boolean(data);
}

/**
 * Refresh the Expo token after the native APNs/FCM token changes. The native
 * listener can fire while getExpoPushTokenAsync is resolving, so coalesce and
 * cool down this path instead of recursively fetching/registering forever.
 */
export function refreshPushTokenRegistration(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
  shouldContinue: () => boolean = () => true,
  cooldownMs = PUSH_TOKEN_REFRESH_COOLDOWN_MS,
) {
  if (!supabase || Platform.OS === 'web') return Promise.resolve();
  const projectId = pushProjectId();
  if (!projectId) return Promise.resolve();
  const key = `${projectId}:${userId}`;
  const inFlight = pushTokenRefreshByAccount.get(key);
  if (inFlight) return inFlight;
  if (
    Date.now() - (pushTokenRefreshAttemptAt.get(key) ?? 0) <
    cooldownMs
  )
    return Promise.resolve();
  pushTokenRefreshAttemptAt.set(key, Date.now());
  const identityBarrier = pushIdentityCleanupQueue;
  const operation = identityBarrier
    .catch(() => undefined)
    .then(() => fetchExpoPushToken(projectId))
    .then((token) =>
      shouldContinue()
        ? registerPushToken(
            userId,
            projectId,
            token,
            preferences,
            language,
            true,
          )
        : undefined,
    )
    .then(() => undefined);
  pushTokenRefreshByAccount.set(key, operation);
  operation.then(
    () => pushTokenRefreshByAccount.delete(key),
    () => pushTokenRefreshByAccount.delete(key),
  );
  return operation;
}

function notificationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0);
    if (parts.length) return [...new Set(parts)].join(' · ');
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown cloud registration error.';
    }
  }
  return 'Unknown cloud registration error.';
}

/** A cloud-synced account re-enable supersedes any older offline disable. */
export async function allowPushRegistrationForAccount(userId: string) {
  await pushDisableByAccount.get(userId)?.catch(() => undefined);
  const projectId = pushProjectId();
  if (projectId)
    disabledPushRegistrationAccounts.delete(
      registrationAccountKey(userId, projectId),
    );
  await AsyncStorage.removeItem(pendingPushDisableKey(userId)).catch(
    () => undefined,
  );
}

export async function enablePushNotifications(
  userId: string | undefined,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
) {
  if (Platform.OS === 'web') {
    const identityBarrier = pushIdentityCleanupQueue;
    return enableWebPushNotifications(
      userId,
      preferences,
      language,
      identityBarrier,
      async () => {
        if (!userId) return;
        await allowPushRegistrationForAccount(userId);
      },
    );
  }
  if (!Device.isDevice) throw new Error('Use a physical device to enable push notifications.');
  await pushIdentityCleanupQueue.catch(() => undefined);
  await ensureNotificationChannel(language);
  let permission = await Notifications.getPermissionsAsync();
  const granted = () => permission.granted || permission.status === Notifications.PermissionStatus.GRANTED;
  if (!granted()) permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  if (!granted()) throw new Error('Android/iOS has not granted notification permission. Enable it in system settings and retry.');
  requestLocalNotificationRefresh();
  // Demo mode still needs the OS permission and explicit local channels for
  // reminders, but it intentionally has no cloud token registration.
  if (!userId) return;
  const projectId = pushProjectId();
  if (!projectId) throw new Error('This build is missing its EAS project ID.');
  await allowPushRegistrationForAccount(userId);
  let tokenResult: { token: string; cached: boolean };
  try {
    tokenResult = await cachedOrFreshExpoPushToken(projectId);
  } catch {
    throw new Error(
      'Notification permission is enabled, but Expo could not be reached. Check your connection and retry; you do not need to change phone permissions.',
    );
  }
  const token = tokenResult.token;
  if (supabase) {
    try {
      await registerPushToken(
        userId,
        projectId,
        token,
        preferences,
        language,
        true,
      );
    } catch (error) {
      throw new Error(
        `Permission is enabled, but cloud registration failed: ${notificationErrorMessage(error)}`,
      );
    }
  }
  if (tokenResult.cached) {
    // A cached project-scoped token lets account recreation recover even when
    // Expo's token endpoint is temporarily unavailable. Refresh it quietly so
    // a rotated token is registered without interrupting the user.
    void refreshPushTokenRegistration(userId, preferences, language).catch(
      () => undefined,
    );
  }
  return token;
}

export async function notificationPermissionGranted() {
  if (Platform.OS === 'web') return webPushPermissionGranted();
  if (!Device.isDevice) return false;
  const permission = await Notifications.getPermissionsAsync();
  return (
    permission.granted ||
    permission.status === Notifications.PermissionStatus.GRANTED
  );
}

/**
 * Stronger than OS permission: proves this build obtained an Expo token and,
 * when cloud sync is configured, successfully registered it for this account.
 * Onboarding uses this so a seeded `pushEnabled` preference cannot be mistaken
 * for a completed device setup.
 */
export async function notificationSetupComplete(userId?: string) {
  if (Platform.OS === 'web') return webPushSetupComplete(userId);
  if (!(await notificationPermissionGranted())) return false;
  const projectId = pushProjectId();
  if (!projectId) return false;
  const token = await AsyncStorage.getItem(tokenCacheKey(projectId));
  if (!token) return false;
  if (!supabase) return true;
  if (!userId) return false;
  const accountKey = registrationAccountKey(userId, projectId);
  if (disabledPushRegistrationAccounts.has(accountKey)) return false;
  const cacheKey = registrationCacheKey(userId, projectId);
  const signatureMatchesCurrentDevice = (acknowledgement: {
    signature?: string;
    registeredAt?: number;
  }) => {
    if (typeof acknowledgement.signature !== 'string') return false;
    try {
      const signature = JSON.parse(acknowledgement.signature) as {
        userId?: string;
        projectId?: string;
        token?: string;
        platform?: string;
      };
      return (
        signature.userId === userId &&
        signature.projectId === projectId &&
        signature.token === token &&
        signature.platform === Platform.OS
      );
    } catch {
      return false;
    }
  };
  const inMemory = pushRegistrationMemory.get(cacheKey);
  let acknowledgement: { signature?: string; registeredAt?: number } | undefined =
    inMemory;
  try {
    if (!acknowledgement) {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw)
        acknowledgement = JSON.parse(raw) as {
          signature?: string;
          registeredAt?: number;
        };
    }
    const acknowledgementMatches = Boolean(
      acknowledgement && signatureMatchesCurrentDevice(acknowledgement),
    );
    const acknowledgementFresh =
      acknowledgementMatches &&
      Number.isFinite(acknowledgement?.registeredAt) &&
      Date.now() - Number(acknowledgement?.registeredAt) <
        PUSH_REGISTRATION_TTL_MS;
    // The owner-readable token row is the authoritative setup truth. This
    // keeps a locally cached acknowledgement from showing Connected after a
    // server cleanup, token invalidation, or account recreation.
    const { data, error } = await supabase
      .from('device_push_tokens')
      .select('token, platform')
      .eq('user_id', userId)
      .eq('token', token)
      .eq('platform', Platform.OS)
      .maybeSingle();
    // A current, unexpired acknowledgement was written only after the token
    // registration succeeded. Keep that success authoritative while offline;
    // a successful server read can still prove the row was later removed.
    if (error) return acknowledgementFresh;
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function updatePushPreferences(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
  shouldContinue: () => boolean = () => true,
) {
  if (Platform.OS === 'web') {
    await pushIdentityCleanupQueue.catch(() => undefined);
    if (!shouldContinue()) return;
    await updateWebPushPreferences(
      userId,
      preferences,
      language,
      shouldContinue,
    );
    return;
  }
  if (!supabase) return;
  const projectId = pushProjectId();
  if (!projectId || !shouldContinue()) return;
  // Only the explicit enable flow may clear an account's disable fence. A
  // preferences effect can carry a stale pushEnabled=true value while the
  // user's disable action is already deleting the token row.
  await ensureNotificationChannel(language);
  await pushIdentityCleanupQueue.catch(() => undefined);
  if (!shouldContinue()) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted || !shouldContinue()) return;
  try {
    const { token } = await cachedOrFreshExpoPushToken(projectId);
    if (!shouldContinue()) return;
    const registrationExists = await registeredTokenExists(userId, token);
    if (!shouldContinue()) return;
    await registerPushToken(
      userId,
      projectId,
      token,
      preferences,
      language,
      !registrationExists,
    );
  } catch { /* The next foreground/settings visit retries registration. */ }
}

/**
 * Foreground recovery fetches the current Expo token instead of trusting the
 * project-scoped cache forever. This repairs DeviceNotRegistered cleanup and
 * reinstalls while the per-account cooldown prevents resume storms.
 */
export async function recoverPushRegistrationOnForeground(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
  shouldContinue: () => boolean = () => true,
) {
  if (Platform.OS === 'web') {
    await pushIdentityCleanupQueue.catch(() => undefined);
    if (!shouldContinue()) return;
    await recoverWebPushRegistration(
      userId,
      preferences,
      language,
      shouldContinue,
    );
    return;
  }
  if (!(await notificationPermissionGranted())) return;
  await refreshPushTokenRegistration(
    userId,
    preferences,
    language,
    shouldContinue,
    PUSH_TOKEN_FOREGROUND_REFRESH_MS,
  );
}

async function clearNativePushIdentity(userId: string, projectId?: string) {
  if (Platform.OS === 'web') return;
  await Notifications.unregisterForNotificationsAsync().catch(
    () => undefined,
  );
  if (!projectId) return;
  const cacheKey = registrationCacheKey(userId, projectId);
  pushRegistrationMemory.delete(cacheKey);
  await AsyncStorage.multiRemove([
    tokenCacheKey(projectId),
    cacheKey,
  ]).catch(() => undefined);
}

async function removeCurrentDevicePushToken(
  userId: string,
  registrationsBeforeCleanup: Promise<void>,
) {
  if (Platform.OS === 'web') return;
  const projectId = pushProjectId();
  if (!projectId) {
    await clearNativePushIdentity(userId);
    return;
  }
  const accountKey = registrationAccountKey(userId, projectId);
  disabledPushRegistrationAccounts.add(accountKey);
  // A registration already queued before the switch was toggled off must
  // finish (or observe the disabled fence) before the delete commits. Token
  // refresh work is awaited first because it may append to that queue.
  await pushTokenRefreshByAccount.get(accountKey)?.catch(() => undefined);
  await registrationsBeforeCleanup.catch(() => undefined);
  const token = await AsyncStorage.getItem(tokenCacheKey(projectId));
  let deletionError: unknown;
  if (supabase && token) {
    const { error } = await supabase
      .from('device_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token)
      .eq('platform', Platform.OS);
    deletionError = error;
  }
  // Always sever the native token locally, even if the old authenticated RLS
  // session disappeared before its exact server row could be removed.
  await clearNativePushIdentity(userId, projectId);
  if (deletionError) throw deletionError;
}

/** Remove only this physical phone's token before signing out or switching. */
export async function unregisterCurrentDevicePushToken(userId: string) {
  if (Platform.OS === 'web') {
    const operation = pushIdentityCleanupQueue
      .catch(() => undefined)
      .then(() => unregisterCurrentWebPushSubscription(userId));
    pushIdentityCleanupQueue = operation.catch(() => undefined);
    await operation;
    return;
  }
  const registrationsBeforeCleanup = pushRegistrationQueue;
  const operation = pushIdentityCleanupQueue
    .catch(() => undefined)
    .then(() =>
      removeCurrentDevicePushToken(userId, registrationsBeforeCleanup),
    );
  pushIdentityCleanupQueue = operation.catch(() => undefined);
  await operation;
}

/** Session recovery can discover there is no owner before an account id loads. */
export async function unregisterOrphanedDevicePushToken() {
  if (Platform.OS === 'web') {
    const operation = pushIdentityCleanupQueue
      .catch(() => undefined)
      .then(() => unregisterOrphanedWebPushSubscription());
    pushIdentityCleanupQueue = operation.catch(() => undefined);
    await operation;
    return;
  }
  const operation = pushIdentityCleanupQueue
    .catch(() => undefined)
    .then(async () => {
      await Notifications.unregisterForNotificationsAsync().catch(
        () => undefined,
      );
      const projectId = pushProjectId();
      if (projectId)
        await AsyncStorage.removeItem(tokenCacheKey(projectId)).catch(
          () => undefined,
        );
    });
  pushIdentityCleanupQueue = operation.catch(() => undefined);
  await operation;
}

/** A process-safe off intent wins over a stale hydrated true preference. */
export async function hasPendingPushDisable(userId: string) {
  return (
    (await AsyncStorage.getItem(pendingPushDisableKey(userId)).catch(
      () => undefined,
    )) === 'pending'
  );
}

/** Release the temporary sign-out fence after the auth transition settles. */
export function releasePushRegistrationFence(userId: string) {
  const projectId = pushProjectId();
  if (projectId)
    disabledPushRegistrationAccounts.delete(
      registrationAccountKey(userId, projectId),
    );
}

export async function disablePushNotifications(userId: string) {
  const existing = pushDisableByAccount.get(userId);
  if (existing) return existing;
  const projectId = pushProjectId();
  const accountKey = projectId
    ? registrationAccountKey(userId, projectId)
    : undefined;
  if (accountKey) disabledPushRegistrationAccounts.add(accountKey);
  // Start durable persistence and append the native cleanup fence before this
  // async function yields. A simultaneous A-to-B switch therefore cannot let B
  // register a fresh native identity that A's second clear would unregister.
  const pendingIntent = AsyncStorage.setItem(
    pendingPushDisableKey(userId),
    'pending',
  );
  const registrationsBeforeCleanup = pushRegistrationQueue;
  const refreshBeforeCleanup = accountKey
    ? pushTokenRefreshByAccount.get(accountKey)
    : undefined;
  const identityOperation = pushIdentityCleanupQueue
    .catch(() => undefined)
    .then(async () => {
      await pendingIntent;
      await Promise.all([
        cancelAllManagedLocalNotifications(userId),
        Platform.OS === 'web'
          ? clearCurrentWebPushIdentity(userId)
          : clearNativePushIdentity(userId, projectId),
      ]);
      await refreshBeforeCleanup?.catch(() => undefined);
      await registrationsBeforeCleanup.catch(() => undefined);
      // A token request queued before the fence may have repopulated the cache
      // after the first clear. Invalidate once more before releasing account B.
      if (Platform.OS === 'web')
        await clearCurrentWebPushIdentity(userId);
      else if (projectId)
        await clearNativePushIdentity(userId, projectId);
    });
  pushIdentityCleanupQueue = identityOperation.catch(() => undefined);
  const operation = identityOperation.then(async () => {
    if (supabase) {
      const { error } = await supabase.rpc('delete_all_own_push_tokens', {
        p_expected_user_id: userId,
      });
      if (error) throw error;
    }
    await AsyncStorage.removeItem(pendingPushDisableKey(userId));
  });
  pushDisableByAccount.set(userId, operation);
  operation.finally(() => {
    if (pushDisableByAccount.get(userId) === operation)
      pushDisableByAccount.delete(userId);
  }).catch(() => undefined);
  return operation;
}

const CYCLE_IDS = 'north-cycle-notification-ids-v1';
const GOAL_IDS = 'metric-rally-goal-reminder-ids-v1';
const GOAL_LEGACY_CLEANUP = 'habhub-goal-reminder-cleanup-v2';
const GYM_IDS = 'metric-rally-gym-notification-ids-v1';
const GYM_ACHIEVEMENT = 'metric-rally-gym-achievement-v1';
const PRODUCTIVITY_IDS = 'metric-rally-productivity-notification-ids-v1';
const PROGRESS_MILESTONES = 'habhub-progress-milestones-v1';
const SCREEN_TIME_APP_MILESTONES = 'habhub-screen-time-app-milestones-v1';

const legacyGoalCleanupByUser = new Map<string, Promise<void>>();

async function cancelLegacyGoalReminderNotifications(state: AppState) {
  const cleanupKey = `${GOAL_LEGACY_CLEANUP}:${encodeURIComponent(state.currentUserId)}`;
  if (await AsyncStorage.getItem(cleanupKey)) return;
  try {
    const metricIds = new Set(state.metrics.map((metric) => metric.id));
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled.map(async (request) => {
        const data = request.content.data ?? {};
        const route = typeof data.route === 'string' ? data.route : '';
        const directMetric =
          typeof data.metric === 'string' ? data.metric : undefined;
        const timerMetricMatch = /[?&]metric=([^&]+)/.exec(route);
        const timerMetric = timerMetricMatch
          ? decodeURIComponent(timerMetricMatch[1])
          : undefined;
        const legacyMetric = directMetric ?? timerMetric;
        const isGoalReminder =
          data.notificationKind === 'goal-reminder' ||
          (legacyMetric !== 'menstrual_cycle' &&
            Boolean(legacyMetric && metricIds.has(legacyMetric)) &&
            (route === '/metric-detail' || route.startsWith('/timer?')));
        if (!isGoalReminder) return;
        await Notifications.cancelScheduledNotificationAsync(
          request.identifier,
        ).catch(() => undefined);
      }),
    );
    await AsyncStorage.setItem(cleanupKey, 'done');
  } catch {
    // Retry the bounded one-time cleanup on the next scheduler pass. New
    // deterministic identifiers still prevent any additional duplicates.
  }
}

function ensureLegacyGoalReminderCleanup(state: AppState) {
  const userId = state.currentUserId;
  const existing = legacyGoalCleanupByUser.get(userId);
  if (existing) return existing;
  let cleanup: Promise<void>;
  cleanup = cancelLegacyGoalReminderNotifications(state).finally(() => {
    if (legacyGoalCleanupByUser.get(userId) === cleanup)
      legacyGoalCleanupByUser.delete(userId);
  });
  legacyGoalCleanupByUser.set(userId, cleanup);
  return cleanup;
}

function reminderTriggerDate(
  state: AppState,
  localDate: string,
  configured: string,
) {
  const adjusted = quietHoursAdjustedDateTime({
    enabled: state.settings.notifications.quietHoursEnabled,
    start: state.settings.notifications.quietHoursStart,
    end: state.settings.notifications.quietHoursEnd,
    localDate,
    time: configured,
  });
  return {
    date: new Date(`${adjusted.localDate}T${adjusted.time}:00`),
    time: adjusted.time,
  };
}

function localizedContent(state: AppState, title: string, body: string) {
  const language = state.settings.language ?? 'en';
  return {
    title: translateUiText(language, title),
    body: translateUiText(language, body),
  };
}

function goalReminderBody(state: AppState, metric: AppState['metrics'][number], localDate: string) {
  const locale = localeForLanguage(state.settings.language);
  const value = safeMetricValue(state, metric, state.currentUserId, localDate);
  const target = effectiveGoalTarget(state, metric, state.currentUserId, localDate);
  const remaining = Math.max(0, target - value);
  const metricName = localizeMetricName(state.settings.language, metric);
  const metricUnit = localizeMetricUnit(state.settings.language, metric);
  if (metric.id === 'sleep') {
    if (value <= 0) return 'Your wind-down reminder: an earlier bedtime makes the 7–9 hour sleep range easier to reach.';
    if (metric.goalRange && value < metric.goalRange.min) return `${(metric.goalRange.min - value).toFixed(1)} more hours would reach your sleep range.`;
    if (metric.goalRange && value > metric.goalRange.max) return `Sleep is ${(value - metric.goalRange.max).toFixed(1)} hours above your selected range.`;
    return 'Your sleep duration is inside your selected range.';
  }
  if (metric.goalRange) {
    if (value < metric.goalRange.min) return `${metricName} is ${Math.round(metric.goalRange.min - value)} ${metricUnit} below your range.`;
    if (value > metric.goalRange.max) return `${metricName} is ${Math.round(value - metric.goalRange.max)} ${metricUnit} above your range.`;
    return `${metricName} is inside your selected range.`;
  }
  if (metric.id === 'steps')
    return remaining > 0
      ? `${Math.round(remaining).toLocaleString(locale)} steps remain. A short walk can move today forward.`
      : 'Your step goal is complete.';
  if (metric.id === 'food') {
    if (value <= 0) return 'Log your meal when you are ready so today’s energy plan stays accurate.';
    const lastMeal = state.entries
      .filter((entry) => entry.userId === state.currentUserId && entry.metricId === 'food' && entry.localDate === localDate)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.nutrition?.mealType;
    return value > target
      ? `You are ${Math.round(value - target)} kcal over today’s current food allowance. Activity can still improve the daily balance.`
      : `${lastMeal ? `${lastMeal[0].toUpperCase()}${lastMeal.slice(1)} logged. ` : ''}${Math.round(remaining)} kcal remain for today.`;
  }
  if (['exercise', 'workout_duration'].includes(metric.id)) {
    const deficit = state.metrics.find((item) => item.id === 'deficit');
    const needed = deficit
      ? Math.max(0, effectiveGoalTarget(state, deficit, state.currentUserId, localDate) - safeMetricValue(state, deficit, state.currentUserId, localDate))
      : remaining;
    const walkingKcalPerMinute = Math.max(3, state.settings.energyProfile.weightKg * 0.055);
    return needed > 0
      ? `About ${Math.round(needed)} active kcal—or roughly ${Math.ceil(needed / walkingKcalPerMinute)} minutes of walking—would close today’s energy gap.`
      : `You have ${Math.round(remaining)} ${metricUnit} left for this goal.`;
  }
  if (metric.goal.kind === 'at_most')
    return value > target
      ? `${metricName} is ${Math.round(value - target)} ${metricUnit} over its target.`
      : `${Math.round(target - value)} ${metricUnit} remain within today’s target.`;
  return `${Math.round(remaining)} ${metricUnit} remain to reach today’s ${metricName.toLowerCase()} goal.`;
}

function progressReminderPercent(
  state: AppState,
  metric: AppState['metrics'][number],
  localDate: string,
) {
  if (
    metric.goalEnabled === false ||
    !metricApplicableOnDate(state, metric, state.currentUserId, localDate)
  )
    return 0;
  // Journey milestones represent movement from the first reading to the
  // long-term target. Treating weight as a regular at-most value would make a
  // first reading above the target appear more than 100% complete.
  if (metric.id === 'weight' || metric.goalProgressMode === 'journey')
    return Math.max(
      0,
      metricVisualProgress(
        state,
        metric,
        state.currentUserId,
        localDate,
      ) * 100,
    );
  if (
    metric.goalRange ||
    metric.goal.kind === 'exact' ||
    metric.goal.kind === 'complete'
  )
    return scheduledGoalReached(
      state,
      metric,
      state.currentUserId,
      localDate,
    )
      ? 100
      : 0;
  if (metric.goal.kind === 'at_most') {
    const target = effectiveGoalTarget(
      state,
      metric,
      state.currentUserId,
      localDate,
    );
    const value = safeMetricValue(state, metric, state.currentUserId, localDate);
    return target > 0 ? Math.max(0, (value / target) * 100) : 0;
  }
  return Math.max(
    0,
    metricVisualProgress(
      state,
      metric,
      state.currentUserId,
      localDate,
    ) * 100,
  );
}

function isQuietNow(settings: NotificationSettings) {
  if (!settings.quietHoursEnabled) return false;
  const configured = new Date().toTimeString().slice(0, 5);
  const start = settings.quietHoursStart;
  const end = settings.quietHoursEnd;
  return start <= end
    ? configured >= start && configured < end
    : configured >= start || configured < end;
}

function translatedTemplate(
  language: AppLanguage,
  source: string,
  values: Record<string, string | number>,
) {
  let translated = translateUiText(language, source);
  Object.entries(values).forEach(([key, value]) => {
    translated = translated.replaceAll(`{${key}}`, String(value));
  });
  return translated;
}

/**
 * Notify for device-only per-app screen-time limits. Package identifiers never
 * enter AppState, notification payloads, or cloud storage.
 */
export async function notifyScreenTimeAppLimits(
  state: AppState,
  report: ScreenTimeReport,
  localDate = dateKey(),
) {
  if (Platform.OS !== 'android' || localDate !== dateKey()) return;
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders || isQuietNow(settings)) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const limits = await readScreenTimeAppLimits(state.currentUserId);
  if (!limits.length) return;
  await ensureLocalNotificationChannels(state.settings.language);

  let stored: { date?: string; userId?: string; fired?: string[] } = {};
  try {
    stored = JSON.parse(
      (await AsyncStorage.getItem(SCREEN_TIME_APP_MILESTONES)) ?? '{}',
    ) as typeof stored;
  } catch {
    stored = {};
  }
  const fired = new Set(
    stored.date === localDate && stored.userId === state.currentUserId
      ? stored.fired ?? []
      : [],
  );
  const appsByPackage = new Map(
    report.apps.map((app) => [app.packageName, app] as const),
  );
  const thresholds = [75, 90, 100];
  for (const limit of limits) {
    const app = appsByPackage.get(limit.packageName);
    if (!app) continue;
    const minutes = app.foregroundMs / 60_000;
    const percent = Math.floor((minutes / limit.targetMinutes) * 100);
    const reached = thresholds.filter((threshold) => percent >= threshold);
    const newest = [...reached]
      .reverse()
      .find(
        (threshold) =>
          !fired.has(`${limit.packageName}:${limit.targetMinutes}:${threshold}`),
      );
    if (newest === undefined) continue;
    // A late first refresh emits one useful message rather than three.
    reached.forEach((threshold) =>
      fired.add(`${limit.packageName}:${limit.targetMinutes}:${threshold}`),
    );
    const body =
      newest >= 100
        ? translatedTemplate(
            state.settings.language,
            '{app} reached its daily screen-time limit of {minutes} min.',
            { app: limit.appName, minutes: limit.targetMinutes },
          )
        : translatedTemplate(
            state.settings.language,
            '{app} used {percent}% of its daily screen-time limit.',
            { app: limit.appName, percent: newest },
          );
    await scheduleImmediateManagedLocalNotification({
      title: translateUiText(state.settings.language, 'Screen time'),
      body,
      sound: 'default',
      data: { route: '/metric-detail', metric: 'screen_time', date: localDate },
    }, state.currentUserId);
  }
  await AsyncStorage.setItem(
    SCREEN_TIME_APP_MILESTONES,
    JSON.stringify({
      date: localDate,
      userId: state.currentUserId,
      fired: [...fired],
    }),
  );
}

/**
 * Emit deduplicated, immediate progress milestones after a local log. This is
 * separate from clock-time reminders so custom schedules are never replaced.
 */
export async function notifyProgressMilestones(
  previousState: AppState,
  nextState: AppState,
  localDate = dateKey(),
) {
  if (Platform.OS === 'web' || localDate !== dateKey()) return;
  const settings = nextState.settings.notifications;
  if (
    !settings.pushEnabled ||
    (!settings.reminders && settings.streakAlerts === false) ||
    isQuietNow(settings)
  ) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureLocalNotificationChannels(nextState.settings.language);
  let fired: string[] = [];
  try {
    fired = JSON.parse(
      (await AsyncStorage.getItem(PROGRESS_MILESTONES)) ?? '[]',
    ) as string[];
  } catch {
    fired = [];
  }
  const todayPrefix = `${nextState.currentUserId}:${localDate}:`;
  const retained = fired.filter((key) => key.startsWith(todayPrefix));
  const firedSet = new Set(retained);
  for (const metric of nextState.metrics) {
    if (metric.goalEnabled === false) continue;
    const previousMetric =
      previousState.metrics.find((candidate) => candidate.id === metric.id) ?? metric;
    const before = progressReminderPercent(previousState, previousMetric, localDate);
    const after = progressReminderPercent(nextState, metric, localDate);
    const metricName = localizeMetricName(nextState.settings.language, metric);
    if (
      settings.streakAlerts !== false &&
      !scheduledGoalReached(
        previousState,
        previousMetric,
        previousState.currentUserId,
        localDate,
      ) &&
      scheduledGoalReached(
        nextState,
        metric,
        nextState.currentUserId,
        localDate,
      )
    ) {
      const beforeStreak = metricStreakStats(
        previousState,
        previousMetric,
        previousState.currentUserId,
        localDate,
      ).current;
      const afterStreak = metricStreakStats(
        nextState,
        metric,
        nextState.currentUserId,
        localDate,
      ).current;
      const streakMilestones = [2, 3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];
      if (
        afterStreak > beforeStreak &&
        streakMilestones.includes(afterStreak)
      ) {
        const streakKey = `${todayPrefix}streak:${metric.id}:${afterStreak}`;
        if (!firedSet.has(streakKey)) {
          await scheduleImmediateManagedLocalNotification({
            ...localizedContent(
              nextState,
              `${metricName} streak`,
              `${afterStreak} days in a row. Keep the rhythm that works for you.`,
            ),
            sound: 'default',
            data: {
              route: '/metric-detail',
              metric: metric.id,
              date: localDate,
              notificationKind: 'streak-milestone',
            },
          }, nextState.currentUserId);
          firedSet.add(streakKey);
        }
      }
    }
    if (!settings.reminders || !metric.progressRemindersEnabled) continue;
    const thresholds = [
      ...new Set(
        metric.progressReminderPercentages?.length
          ? metric.progressReminderPercentages
          : defaultProgressReminderPercentages(metric),
      ),
    ]
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 300)
      .sort((left, right) => left - right);
    for (const threshold of thresholds) {
      const key = `${todayPrefix}${metric.id}:${threshold}`;
      if (before >= threshold || after < threshold || firedSet.has(key)) continue;
      const isJourney =
        metric.id === 'weight' || metric.goalProgressMode === 'journey';
      const milestoneBody =
        isJourney
          ? threshold === 100
            ? `${metricName} reached its long-term target.`
            : `${metricName} reached ${threshold}% of its long-term target.`
          : metric.goal.kind === 'at_most'
          ? threshold === 100
            ? `${metricName} reached today's limit.`
            : threshold < 100
              ? `${metricName} used ${threshold}% of today's limit.`
              : `${metricName} reached ${threshold}% of today's limit.`
          : threshold === 100
            ? `${metricName} reached today's target.`
            : `${metricName} reached ${threshold}% of today's target.`;
      const content = localizedContent(
        nextState,
        `${metricName} progress`,
        milestoneBody,
      );
      await scheduleImmediateManagedLocalNotification({
        ...content,
        sound: 'default',
        data: {
          route: '/metric-detail',
          metric: metric.id,
          date: localDate,
          notificationKind: 'progress-milestone',
        },
      }, nextState.currentUserId);
      firedSet.add(key);
    }
  }
  await AsyncStorage.setItem(PROGRESS_MILESTONES, JSON.stringify([...firedSet]));
}

async function syncGoalNotificationsNow(state: AppState) {
  if (Platform.OS === 'web') return;
  await ensureLegacyGoalReminderCleanup(state);
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders) {
    await reconcileLocalNotifications(GOAL_IDS, [], state.currentUserId);
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureLocalNotificationChannels(state.settings.language);
  const now = new Date();
  const today = dateKey(now);
  const plans: LocalNotificationPlan[] = [];
  const scheduledSemantics = new Set<string>();
  const fastingProgressByMetric = new Map(
    state.metrics
      .filter((metric) => Boolean(metric.fastingSettings))
      .map((metric) => [
        metric.id,
        automaticFastProgress(
          state,
          state.currentUserId,
          now,
          metric.id,
        ),
      ] as const),
  );
  const reminderMetrics = settings.reminders
    ? state.metrics.filter(
        (metric) =>
          metric.reminders?.some((item) => item.enabled) ||
          metric.reminder?.enabled,
      )
    : [];
  // Search a full year for sparse monthly/custom occurrences. Common daily
  // schedules stop as soon as the nearest iOS-safe category budget is full.
  for (let offset = 0; offset < 367; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const metric of reminderMetrics) {
      if (
        !(metric.reminders?.some((item) => item.enabled) || metric.reminder?.enabled) ||
        metric.activeFrom > localDate
      ) continue;
      const configured = metric.reminders?.length ? metric.reminders : metric.reminder ? [metric.reminder] : [];
      for (const [reminderIndex, reminder] of configured.entries()) {
        if (!reminder.enabled) continue;
        if (
          reminder.schedule &&
          !scheduleAppliesOnDate(
            reminder.schedule,
            reminder.schedule.anchorDate ?? metric.activeFrom,
            localDate,
          )
        )
          continue;
        if (
          !reminder.schedule &&
          metric.goalEnabled !== false &&
          !metric.fastingSettings &&
          !isMetricTrackedOnDate(state, metric, localDate)
        )
          continue;
        if (
          metric.goalEnabled !== false &&
          offset === 0 &&
          scheduledGoalReached(
            state,
            metric,
            state.currentUserId,
            localDate,
          )
        )
          continue;
        if (!/^\d{2}:\d{2}$/.test(reminder.time)) continue;
        const effective = reminderTriggerDate(
          state,
          localDate,
          reminder.time,
        );
        const time = effective.time;
        const trigger = effective.date;
        if (trigger <= now) continue;
        const fastingProgress = fastingProgressByMetric.get(metric.id);
        if (fastingProgress) {
          if (
            fastingProgress.active &&
            notificationFallsAfterFastingTarget({
              startedAt: fastingProgress.startedAt,
              targetMinutes: fastingProgress.targetMinutes,
              triggerAt: trigger.getTime(),
            })
          )
            continue;
        }
        const content = localizedContent(
          state,
          reminder.label ?? `${localizeMetricName(state.settings.language, metric)} reminder`,
          metric.fastingSettings && reminder.label
            ? reminder.label
            : goalReminderBody(state, metric, localDate),
        );
        const route = reminder.durationMinutes && metric.timerEnabled
          ? `/timer?metric=${encodeURIComponent(metric.id)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`
          : '/metric-detail';
        const semanticKey = goalReminderSemanticKey({
          userId: state.currentUserId,
          metricId: metric.id,
          localDate,
          time,
          title: content.title,
          body: content.body,
          route,
        });
        if (scheduledSemantics.has(semanticKey)) continue;
        scheduledSemantics.add(semanticKey);
        const identifier = goalReminderNotificationId({
          userId: state.currentUserId,
          metricId: metric.id,
          reminderIndex,
          localDate,
          time,
        });
        plans.push(dateLocalNotificationPlan({
          identifier,
          date: trigger,
          content: {
            ...content,
            data: {
              ...(reminder.durationMinutes && metric.timerEnabled
                ? {
                    route,
                  }
                : { route, metric: metric.id }),
              notificationKind: 'goal-reminder',
              reminderId: identifier,
            },
          },
        }));
      }
    }
    if (plans.length >= LOCAL_NOTIFICATION_BUDGETS.goals) break;
  }
  await reconcileLocalNotifications(
    GOAL_IDS,
    earliestLocalNotificationSchedules(plans, LOCAL_NOTIFICATION_BUDGETS.goals),
    state.currentUserId,
  );
}

/**
 * Hydration, reconnect, settings and resume can all request a refresh close
 * together. Drain only one scheduler at a time and coalesce queued work to the
 * newest immutable state. Combined with deterministic identifiers this makes
 * scheduling idempotent even if two React effects overlap.
 */
const drainGoalNotifications = createLatestAsyncDrain<AppState>(
  syncGoalNotificationsNow,
);

export function syncGoalNotifications(state: AppState) {
  if (Platform.OS === 'web') return Promise.resolve();
  return drainGoalNotifications(state);
}

async function syncCycleNotificationsNow(state: AppState) {
  if (Platform.OS === 'web') return;
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || (settings.cyclePredictions === false && settings.cyclePhaseUpdates !== true)) {
    await reconcileLocalNotifications(CYCLE_IDS, [], state.currentUserId);
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureLocalNotificationChannels(state.settings.language);
  const now = new Date();
  const today = dateKey(now);
  const forecast = cycleForecast(state, state.currentUserId, today);
  if (!forecast.nextPeriodStart) {
    await reconcileLocalNotifications(CYCLE_IDS, [], state.currentUserId);
    return;
  }
  const schedule: { date: string; sourceId: string; title: string; body: string }[] = [];
  if (settings.cyclePredictions !== false) {
    schedule.push({ date: dateWithOffsetFrom(forecast.nextPeriodStart, -(settings.cycleReminderDays ?? 2)), sourceId: 'period-estimate', title: 'Period estimate', body: `Your next period is estimated in ${settings.cycleReminderDays ?? 2} days. This may change as HabHub learns your cycle.` });
  }
  if (settings.cyclePhaseUpdates === true) {
    const currentStart = dateWithOffsetFrom(forecast.nextPeriodStart, -forecast.averageCycleDays);
    const future = (candidate: string) => {
      let next = candidate;
      while (next <= today) next = dateWithOffsetFrom(next, forecast.averageCycleDays);
      return next;
    };
    schedule.push(
      { date: future(currentStart), sourceId: 'menstrual-phase', title: 'Menstrual phase estimate', body: 'Your next cycle is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averagePeriodDays)), sourceId: 'follicular-phase', title: 'Follicular phase estimate', body: 'Your follicular phase is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 15)), sourceId: 'ovulation-phase', title: 'Ovulation phase estimate', body: 'Estimated ovulation phase begins around today. This is not a contraceptive prediction.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 12)), sourceId: 'luteal-phase', title: 'Luteal phase estimate', body: 'Your luteal phase is estimated to begin around today.' },
    );
  }
  const plans: LocalNotificationPlan[] = [];
  for (const item of schedule) {
    const effective = reminderTriggerDate(state, item.date, '09:00');
    const trigger = effective.date;
    if (trigger <= now) continue;
    const identifier = localNotificationIdentifier({
      userId: state.currentUserId,
      kind: 'cycle',
      sourceId: item.sourceId,
      localDate: item.date,
      time: effective.time,
    });
    plans.push(dateLocalNotificationPlan({
      identifier,
      date: trigger,
      content: {
        ...localizedContent(state, item.title, item.body),
        data: {
          route: '/metric-detail',
          metric: 'menstrual_cycle',
          notificationKind: 'cycle-reminder',
        },
      },
    }));
  }
  await reconcileLocalNotifications(
    CYCLE_IDS,
    earliestLocalNotificationSchedules(plans, LOCAL_NOTIFICATION_BUDGETS.cycle),
    state.currentUserId,
  );
}

async function syncProductivityNotificationsNow(state: AppState) {
  if (Platform.OS === 'web') return;
  // The one-time goal-reminder migration recognizes legacy timer routes.
  // Serialize it before calendar/to-do timers are recreated so it can never
  // cancel a fresh productivity reminder scheduled by a concurrent effect.
  await ensureLegacyGoalReminderCleanup(state);
  if (!state.settings.notifications.pushEnabled) {
    await reconcileLocalNotifications(
      PRODUCTIVITY_IDS,
      [],
      state.currentUserId,
    );
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureLocalNotificationChannels(state.settings.language);
  const now = new Date();
  const today = dateKey(now);
  const plans: LocalNotificationPlan[] = [];
  const schedule = (
    localDate: string,
    time: string,
    title: string,
    body: string,
    route: string,
    kind: string,
    sourceId: string,
  ) => {
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    const effective = reminderTriggerDate(state, localDate, time);
    const effectiveTime = effective.time;
    const trigger = effective.date;
    if (trigger <= now) return;
    const identifier = localNotificationIdentifier({
      userId: state.currentUserId,
      kind,
      sourceId,
      localDate,
      time: effectiveTime,
    });
    plans.push(
      dateLocalNotificationPlan({
        identifier,
        date: trigger,
        content: {
          ...localizedContent(state, title, body),
          data: { route, notificationKind: kind, reminderId: identifier },
        },
      }),
    );
  };
  // One-off deadlines and sparse calendar recurrences can be months away.
  // Daily-heavy schedules still stop as soon as their nearest budget is full.
  for (let offset = 0; offset < 367; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const todo of
      state.settings.notifications.todoReminders === false
        ? []
        : state.todos ?? []) {
      if (
        todoResolvedOnDate(todo, localDate) ||
        (!todo.recurrence && Boolean(todo.completedAt))
      )
        continue;
      const dueDate = todo.dueAt?.slice(0, 10);
      const dueTime = todo.dueAt?.slice(11, 16) ?? '09:00';
      const explicitDeadlineReminder = todo.reminders.some(
        (reminder) =>
          todoReminderAppliesOnDate(todo, reminder, localDate) &&
          (reminder.time ?? reminder.at?.slice(11, 16) ?? dueTime) ===
            dueTime,
      );
      if (dueDate === localDate && !explicitDeadlineReminder)
        schedule(
          localDate,
          dueTime,
          'To-do deadline',
          todo.title,
          `/todo-editor?id=${todo.id}`,
          'todo-deadline',
          todo.id,
        );
      for (const reminder of todo.reminders) {
        if (!todoReminderAppliesOnDate(todo, reminder, localDate)) continue;
        schedule(
          localDate,
          reminder.time ?? todo.dueAt?.slice(11, 16) ?? '09:00',
          todo.dueAt?.slice(0, 10) === localDate
            ? 'To-do deadline'
            : 'To-do reminder',
          todo.title,
          `/todo-editor?id=${todo.id}`,
          'todo-reminder',
          `${todo.id}:${reminder.id}`,
        );
      }
    }
    for (const reminder of state.calendarReminders ?? []) {
      if (
        !reminder.enabled ||
        !scheduleAppliesOnDate(reminder.schedule, today, localDate)
      )
        continue;
      schedule(
        localDate,
        reminder.time,
        reminder.title,
        reminder.kind === 'tracker'
          ? 'A scheduled tracker reminder is ready.'
          : reminder.kind === 'todo'
            ? 'A scheduled to-do reminder is ready.'
            : 'Scheduled reminder',
        reminder.kind === 'tracker' && reminder.metricId && reminder.durationMinutes
          ? `/timer?metric=${encodeURIComponent(reminder.metricId)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`
          : '/calendar',
        'calendar-reminder',
        reminder.id,
      );
    }
    if (plans.length >= LOCAL_NOTIFICATION_BUDGETS.productivity) break;
  }
  await reconcileLocalNotifications(
    PRODUCTIVITY_IDS,
    earliestLocalNotificationSchedules(
      plans,
      LOCAL_NOTIFICATION_BUDGETS.productivity,
    ),
    state.currentUserId,
  );
}

/**
 * Keeps gym prompts private and on-device. Group activity still uses the
 * regular shared tracker entries created from a completed session.
 */
async function syncGymNotificationsNow(state: AppState) {
  if (Platform.OS === 'web') return;
  const settings = state.settings.notifications;
  const idsKey = `${GYM_IDS}:${state.currentUserId}`;
  const achievementKey = `${GYM_ACHIEVEMENT}:${state.currentUserId}`;
  if (!settings.pushEnabled || state.settings.showGym === false) {
    await reconcileLocalNotifications(idsKey, [], state.currentUserId);
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureLocalNotificationChannels(state.settings.language);
  const sessions = (state.gymSessions ?? [])
    .filter(
      (session) =>
        session.userId === state.currentUserId &&
        completedGymSets(session.exercises) > 0,
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const latest = sessions[0];
  const plans: LocalNotificationPlan[] = [];

  if (settings.gymReminders !== false) {
    const waitDays = Math.max(1, Math.min(14, settings.gymReminderDays ?? 3));
    const baseDate = latest?.localDate ?? dateKey();
    let reminderDate = dateWithOffsetFrom(baseDate, waitDays);
    const now = new Date();
    let effective = reminderTriggerDate(state, reminderDate, '18:00');
    let time = effective.time;
    let trigger = effective.date;
    if (trigger <= now) {
      reminderDate = dateWithOffsetFrom(dateKey(), 1);
      effective = reminderTriggerDate(state, reminderDate, '18:00');
      time = effective.time;
      trigger = effective.date;
    }
    const identifier = localNotificationIdentifier({
      userId: state.currentUserId,
      kind: 'gym-reminder',
      sourceId: latest?.id ?? 'first-workout',
      localDate: reminderDate,
      time,
    });
    plans.push(
      dateLocalNotificationPlan({
        identifier,
        date: trigger,
        content: {
          ...localizedContent(
            state,
            'Ready for your next workout?',
            latest
              ? `It has been ${waitDays} days since ${latest.name}. Reuse it or choose another saved workout when you are ready.`
              : 'Start a workout to build your personal exercise baseline.',
          ),
          data: {
            route: '/gym',
            notificationKind: 'gym-reminder',
            reminderId: identifier,
          },
        },
      }),
    );
  }
  await reconcileLocalNotifications(
    idsKey,
    earliestLocalNotificationSchedules(plans, LOCAL_NOTIFICATION_BUDGETS.gym),
    state.currentUserId,
  );

  if (
    settings.gymAchievements !== false &&
    latest &&
    !isQuietNow(settings)
  ) {
    const alreadyNotified = await AsyncStorage.getItem(achievementKey);
    if (alreadyNotified !== latest.id) {
      const records = latest.exercises.flatMap((exercise) => {
        const current = Math.max(
          0,
          ...exercise.sets
            .filter((set) => set.completed)
            .map((set) => estimatedOneRepMax(set.weightKg, set.reps)),
        );
        const previousHistory = exerciseHistory(
          sessions.filter((session) => session.id !== latest.id),
          state.currentUserId,
          exerciseIdentity(exercise),
        );
        const previousBest = Math.max(
          0,
          ...previousHistory.map((item) => item.estimatedOneRepMaxKg),
        );
        return current > 0 && previousBest > 0 && current >= previousBest * 1.005
          ? [exercise.name]
          : [];
      });
      const previousComparable =
        sessions
          .slice(1)
          .find(
            (session) =>
              (latest.planId && session.planId === latest.planId) ||
              session.name.trim().toLowerCase() ===
                latest.name.trim().toLowerCase(),
          ) ?? sessions[1];
      const latestRest = averageGymRestSeconds(latest.exercises);
      const priorRest = previousComparable
        ? averageGymRestSeconds(previousComparable.exercises)
        : 0;
      const restCopy =
        latestRest > 0 && priorRest > 0
          ? ` Average rest was ${Math.abs(latestRest - priorRest)}s ${latestRest > priorRest ? 'longer' : 'shorter'} than ${previousComparable.name}.`
          : '';
      await scheduleImmediateManagedLocalNotification({
        ...localizedContent(
          state,
          records.length ? 'New workout best' : 'Workout saved',
          records.length
            ? `${records
                .slice(0, 2)
                .map((name) =>
                  localizeExerciseName(state.settings.language, {
                    exerciseKey: latest.exercises.find((item) => item.name === name)?.exerciseKey,
                    name,
                  }),
                )
                .join(' and ')} moved above your prior estimated best.${restCopy}`
            : `${completedGymSets(latest.exercises)} sets and ${Math.round(trainingVolumeKg(latest.exercises)).toLocaleString(localeForLanguage(state.settings.language))} kg of volume logged.${restCopy}`,
        ),
        sound: 'default',
        data: { route: '/gym', notificationKind: 'gym-achievement' },
      }, state.currentUserId);
      await AsyncStorage.setItem(achievementKey, latest.id);
    }
  }
}

const drainCycleNotifications = createLatestAsyncDrain<AppState>(
  syncCycleNotificationsNow,
);
const drainProductivityNotifications = createLatestAsyncDrain<AppState>(
  syncProductivityNotificationsNow,
);
const drainGymNotifications = createLatestAsyncDrain<AppState>(
  syncGymNotificationsNow,
);

export function syncCycleNotifications(state: AppState) {
  if (Platform.OS === 'web') return Promise.resolve();
  return drainCycleNotifications(state);
}

export function syncProductivityNotifications(state: AppState) {
  if (Platform.OS === 'web') return Promise.resolve();
  return drainProductivityNotifications(state);
}

export function syncGymNotifications(state: AppState) {
  if (Platform.OS === 'web') return Promise.resolve();
  return drainGymNotifications(state);
}

/** Replenish rolling alarm windows after time-zone/day and foreground changes. */
export async function syncAllLocalNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  await Promise.all([
    syncGoalNotifications(state),
    syncCycleNotifications(state),
    syncProductivityNotifications(state),
    syncGymNotifications(state),
    syncActivityTimerAlerts(state),
  ]);
}

export async function cancelAllManagedLocalNotifications(userId?: string) {
  await Promise.all([
    clearAllLocalNotifications([
      GOAL_IDS,
      CYCLE_IDS,
      PRODUCTIVITY_IDS,
      ...(userId
        ? [`${GYM_IDS}:${userId}`, `${GYM_ACHIEVEMENT}:${userId}`]
        : []),
      PROGRESS_MILESTONES,
      SCREEN_TIME_APP_MILESTONES,
      'habhub-live-activity-notification-ids-v1',
      ACTIVITY_TIMER_ALERT_IDS,
      'metricrally-workout-notification-flow-v1',
      'metricrally-workout-notification-actions-v1',
    ]),
    // Expo cancellation cannot clear the native locked-screen workout action
    // queue. Clear both the banner and HabHubWorkoutNotificationStore so the
    // next account can never consume the prior account's queued actions.
    clearWorkoutTimerNotifications(),
    clearLiveActivityTimerNotifications(),
  ]);
}
