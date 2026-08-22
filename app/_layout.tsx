import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useNetInfo } from "@react-native-community/netinfo";
import { Image } from "expo-image";
import {
  Redirect,
  router,
  Stack,
  useSegments,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState as NativeAppState,
  ActivityIndicator,
  InteractionManager,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AiAssistantButton } from "@/src/components/AiAssistantButton";
import { ActiveTimerOverlay } from "@/src/components/ActiveTimerOverlay";
import { InAppChatBanner } from "@/src/components/InAppChatBanner";
import { WebAlertHost } from "@/src/components/WebAlertHost";
import {
  TutorialProvider,
  useTutorial,
} from "@/src/tutorial/TutorialContext";
import { TUTORIAL_GUIDES } from "@/src/tutorial/guides";
import { TutorialAppStateBoundary } from "@/src/tutorial/TutorialAppStateBoundary";
import { TutorialSpotlight } from "@/src/components/TutorialSpotlight";
import "react-native-reanimated";

import { AuthProvider, useAuth } from "@/src/auth/AuthProvider";
import {
  CloudSyncProvider,
  TutorialCloudSyncBoundary,
  useCloudSyncStatus,
} from "@/src/cloud/CloudSyncProvider";
import {
  HealthSyncProvider,
  TutorialHealthSyncBoundary,
} from "@/src/health/HealthSyncProvider";
import { AppProvider, useApp } from "@/src/state/AppProvider";
import { LocalizationProvider } from "@/src/i18n";
import { WebDocumentMetadata } from "@/src/i18n/WebDocumentMetadata";
import { onboardingCompletedLocally } from "@/src/storage/onboardingState";
import { shouldWaitForOnboardingAuthority } from "@/src/domain/onboarding";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { ScreenTimeSyncBridge } from "@/src/screenTime/ScreenTimeSyncBridge";
import { WidgetSnapshotBridge } from "@/src/widgets/WidgetSnapshotBridge";
import {
  CompactModeProvider,
  DarkModeProvider,
  FontScaleProvider,
  GroupAccentProvider,
  palette,
} from "@/src/theme";
import {
  allowPushRegistrationForAccount,
  cancelAllManagedLocalNotifications,
  disablePushNotifications,
  hasPendingPushDisable,
  syncCycleNotifications,
  syncAllLocalNotifications,
  syncGoalNotifications,
  syncGymNotifications,
  syncProductivityNotifications,
  refreshPushTokenRegistration,
  recoverPushRegistrationOnForeground,
  updatePushPreferences,
} from "@/src/notifications/push";
import { subscribeLocalNotificationRefresh } from "@/src/notifications/localRefresh";
import { resumeManagedLocalNotifications } from "@/src/notifications/localScheduling";
import { resumeLiveActivityTimerNotifications } from "@/src/notifications/liveTimer";
import { resumeWorkoutTimerNotifications } from "@/src/notifications/workoutTimer";
import { syncActivityTimerAlerts } from "@/src/notifications/activityTimerAlerts";
import { syncWebReminderSchedule } from "@/src/notifications/webReminderSync";
import {
  registerHabHubServiceWorker,
  subscribeWebPushSubscriptionChanges,
} from "@/src/notifications/webPush";
import { automaticFastProgress } from "@/src/domain/fasting";
import { markUserInteraction } from "@/src/lib/userInteraction";
import { captureGoogleHealthCompletionFromBrowserUrl } from "@/src/health/googleHealthCompletionBrowser";
import {
  GOOGLE_HEALTH_FOREGROUND_CHECK_INTERVAL_MS,
  requestGoogleHealthForegroundRefresh,
} from "@/src/health/googleHealthAutoSync";

// This runs during root-module evaluation, before AuthProvider and every
// loading/redirect guard. The completion credential remains in memory only.
captureGoogleHealthCompletionFromBrowserUrl();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: palette.canvas,
    primary: palette.primary,
    text: palette.ink,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView
      style={styles.root}
      onTouchStart={() => markUserInteraction()}
      onTouchMove={() => markUserInteraction()}
      onTouchEnd={() => markUserInteraction()}
      onTouchCancel={() => markUserInteraction()}
    >
      <AuthProvider>
        <AppProvider>
          <TutorialProvider guides={TUTORIAL_GUIDES}>
            <AppLocalizationBridge />
          </TutorialProvider>
        </AppProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function AppLocalizationBridge() {
  const { state } = useApp();
  const tutorial = useTutorial();
  const tutorialActive = Boolean(tutorial.activeSession);
  return (
    <LocalizationProvider language={state.settings.language}>
      <WebDocumentMetadata darkMode={state.settings.darkMode} />
      {tutorialActive ? null : <ScreenTimeSyncBridge />}
      {tutorialActive ? null : <WidgetSnapshotBridge />}
      {tutorialActive ? (
        <TutorialHealthSyncBoundary>
          <TutorialCloudSyncBoundary>
            <RootNavigator />
          </TutorialCloudSyncBoundary>
        </TutorialHealthSyncBoundary>
      ) : (
        <HealthSyncProvider>
          <CloudSyncProvider>
            <RootNavigator />
          </CloudSyncProvider>
        </HealthSyncProvider>
      )}
    </LocalizationProvider>
  );
}

function RootNavigator() {
  const auth = useAuth();
  const network = useNetInfo();
  const tutorial = useTutorial();
  const tutorialActive = Boolean(tutorial.activeSession);
  const cloudSyncStatus = useCloudSyncStatus();
  const { state, hydrated, updateSettings } = useApp();
  const segments = useSegments();
  const rootSegment = String(segments[0] ?? "");
  const landingApplied = useRef(false);
  const onboardingAccountId =
    auth.user?.id ?? (!auth.configured ? `demo:${state.currentUserId}` : null);
  const [onboardingMarker, setOnboardingMarker] = useState<{
    accountId: string;
    complete: boolean;
  } | null>(null);
  useEffect(() => {
    if (!hydrated || !onboardingAccountId) {
      setOnboardingMarker(null);
      return;
    }
    let active = true;
    const accountId = onboardingAccountId;
    setOnboardingMarker(null);
    void onboardingCompletedLocally(accountId).then((complete) => {
      if (active) setOnboardingMarker({ accountId, complete });
    });
    return () => {
      active = false;
    };
  }, [hydrated, onboardingAccountId]);
  const onboardingDone =
    state.settings.onboardingComplete ||
    (onboardingMarker?.accountId === onboardingAccountId &&
      onboardingMarker.complete);
  const localNotificationsReady =
    hydrated &&
    onboardingDone &&
    (auth.status === "demo" ||
      (auth.status === "signedIn" &&
        auth.user?.id === state.currentUserId));
  const localNotificationSchedulingEnabled =
    localNotificationsReady &&
    state.settings.notifications.pushEnabled;
  const localNotificationCleanupKey = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    void registerHabHubServiceWorker().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      !hydrated ||
      tutorialActive ||
      !auth.user?.id ||
      auth.session?.user.id !== auth.user.id
    )
      return;
    let active = true;
    let running = false;
    const accountId = auth.user.id;
    const refresh = async () => {
      if (
        !active ||
        running ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      )
        return;
      running = true;
      try {
        await requestGoogleHealthForegroundRefresh(accountId);
      } catch {
        // Signed provider webhooks and the durable six-hour sweep remain the
        // authority. A foreground network failure retries on the next online,
        // visibility, or interval signal without delaying navigation.
      } finally {
        running = false;
      }
    };
    const visible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const initialTimer = setTimeout(() => void refresh(), 12_000);
    const interval = setInterval(
      () => void refresh(),
      GOOGLE_HEALTH_FOREGROUND_CHECK_INTERVAL_MS,
    );
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    auth.session?.user.id,
    auth.user?.id,
    hydrated,
    tutorialActive,
  ]);
  useEffect(() => {
    if (
      !localNotificationsReady ||
      tutorialActive ||
      Platform.OS === "web"
    )
      return;
    const accountKey = auth.user?.id ?? `demo:${state.currentUserId}`;
    if (state.settings.notifications.pushEnabled) {
      localNotificationCleanupKey.current = null;
      resumeManagedLocalNotifications(state.currentUserId);
      resumeLiveActivityTimerNotifications(state.currentUserId);
      resumeWorkoutTimerNotifications(state.currentUserId);
      return;
    }
    if (localNotificationCleanupKey.current === accountKey) return;
    localNotificationCleanupKey.current = accountKey;
    void cancelAllManagedLocalNotifications(auth.user?.id).catch(
      () => undefined,
    );
  }, [
    auth.user?.id,
    localNotificationsReady,
    state.currentUserId,
    state.settings.notifications.pushEnabled,
    tutorialActive,
  ]);
  useEffect(() => {
    if (onboardingDone && !state.settings.onboardingComplete)
      updateSettings({ onboardingComplete: true });
  }, [
    onboardingDone,
    state.settings.onboardingComplete,
    updateSettings,
  ]);
  const cycleSignature = useMemo(
    () =>
      state.entries
        .filter(
          (entry) =>
            entry.userId === state.currentUserId &&
            entry.metricId === "menstrual_cycle",
        )
        .map((entry) => `${entry.localDate}:${entry.value}`)
        .join("|"),
    [state.currentUserId, state.entries],
  );
  const cycleStateRef = useRef(state);
  cycleStateRef.current = state;
  const activityTimerNotificationKey = useMemo(
    () =>
      JSON.stringify({
        user: state.currentUserId,
        timers: (state.activityTimers?.length
          ? state.activityTimers
          : state.activeTimer
            ? [state.activeTimer]
            : []
        ).map((timer) => [
          timer.id,
          timer.metricId,
          timer.mode,
          timer.targetSeconds,
          timer.startedAt,
          timer.status,
          timer.accumulatedSeconds,
        ]),
        alertMinutes: state.settings.activityTimerAlertMinutes,
        enabled: state.settings.notifications.pushEnabled,
        language: state.settings.language,
        metricLabels: state.metrics.map((metric) => [
          metric.id,
          metric.name,
        ]),
      }),
    [
      state.activeTimer,
      state.activityTimers,
      state.currentUserId,
      state.metrics,
      state.settings.activityTimerAlertMinutes,
      state.settings.language,
      state.settings.notifications.pushEnabled,
    ],
  );
  useEffect(() => {
    if (!localNotificationSchedulingEnabled || tutorialActive) return;
    const timer = setTimeout(
      () =>
        void syncActivityTimerAlerts(cycleStateRef.current).catch(
          () => undefined,
        ),
      600,
    );
    return () => clearTimeout(timer);
  }, [
    activityTimerNotificationKey,
    localNotificationSchedulingEnabled,
    tutorialActive,
  ]);
  const cycleNotificationKey = JSON.stringify({
    cycleSignature,
    user: state.currentUserId,
    language: state.settings.language,
    notifications: {
      pushEnabled: state.settings.notifications.pushEnabled,
      cyclePredictions: state.settings.notifications.cyclePredictions,
      cyclePhaseUpdates: state.settings.notifications.cyclePhaseUpdates,
      cycleReminderDays: state.settings.notifications.cycleReminderDays,
      quietHoursEnabled: state.settings.notifications.quietHoursEnabled,
      quietHoursStart: state.settings.notifications.quietHoursStart,
      quietHoursEnd: state.settings.notifications.quietHoursEnd,
    },
  });
  useEffect(() => {
    if (!localNotificationSchedulingEnabled || tutorialActive) return;
    const timer = setTimeout(
      () =>
        void syncCycleNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1200,
    );
    return () => clearTimeout(timer);
  }, [cycleNotificationKey, localNotificationSchedulingEnabled, tutorialActive]);
  const goalReminderKey = useMemo(
    () => {
      const recentFloor = dateWithOffsetFrom(dateKey(), -2);
      return JSON.stringify({
        user: state.currentUserId,
        periods: state.trackedGoalPeriods,
        metrics: state.metrics,
        semantics: {
          notifications: state.settings.notifications,
          language: state.settings.language,
          dayEndTime: state.settings.dayEndTime,
          energyProfile: state.settings.energyProfile,
          memberEnergyProfile:
            state.energyProfiles?.[state.currentUserId],
          baselineCalories: state.settings.baselineCalories,
          fastingRuntimeByMetric: state.settings.fastingRuntimeByMetric,
          vacationPeriods: state.settings.vacationPeriods,
        },
        recentCompletionInputs: {
          entries: state.entries
            .filter(
              (entry) =>
                entry.userId === state.currentUserId &&
                entry.localDate >= recentFloor,
            )
            .map((entry) => [
              entry.id,
              entry.metricId,
              entry.localDate,
              entry.value,
              entry.recordedAt,
            ]),
          statuses: (state.dailyMetricStatuses ?? [])
            .filter(
              (status) =>
                status.userId === state.currentUserId &&
                status.localDate >= recentFloor,
            )
            .map((status) => [
              status.metricId,
              status.localDate,
              status.goalReached,
              status.exactValue,
              status.goalEligible,
            ]),
          gym: (state.gymSessions ?? [])
            .filter(
              (session) =>
                session.userId === state.currentUserId &&
                session.localDate >= recentFloor,
            )
            .map((session) => [session.id, session.recordedAt]),
          todos: (state.todos ?? []).map((todo) => [
            todo.id,
            todo.completedAt,
            todo.completedDates,
            todo.skippedDates,
          ]),
        },
      });
    },
    [
      state.currentUserId,
      state.metrics,
      state.energyProfiles,
      state.entries,
      state.dailyMetricStatuses,
      state.gymSessions,
      state.todos,
      state.settings,
      state.trackedGoalPeriods,
    ],
  );
  useEffect(() => {
    if (!localNotificationSchedulingEnabled || tutorialActive) return;
    const timer = setTimeout(
      () =>
        void syncGoalNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    const now = new Date();
    const schedulingState = cycleStateRef.current;
    const nextFastingCompletion = schedulingState.metrics
      .filter((metric) => Boolean(metric.fastingSettings))
      .flatMap((metric) => {
        const progress = automaticFastProgress(
          schedulingState,
          schedulingState.currentUserId,
          now,
          metric.id,
        );
        const startedAt = progress.startedAt
          ? new Date(progress.startedAt).getTime()
          : Number.NaN;
        const completionAt =
          startedAt + progress.targetMinutes * 60 * 1000;
        return progress.active && completionAt > now.getTime()
          ? [completionAt]
          : [];
      })
      .sort((left, right) => left - right)[0];
    const fastingCompletionTimer = nextFastingCompletion
      ? setTimeout(
          () =>
            void syncGoalNotifications(cycleStateRef.current).catch(
              () => undefined,
            ),
          Math.min(
            2_147_000_000,
            Math.max(1_000, nextFastingCompletion - now.getTime() + 1_000),
          ),
        )
      : undefined;
    return () => {
      clearTimeout(timer);
      if (fastingCompletionTimer) clearTimeout(fastingCompletionTimer);
    };
  }, [goalReminderKey, localNotificationSchedulingEnabled, tutorialActive]);
  const gymNotificationKey = useMemo(
    () =>
      JSON.stringify({
        user: state.currentUserId,
        gym: (state.gymSessions ?? []).map((session) => [
          session.id,
          session.recordedAt,
          session.exercises.flatMap((exercise) =>
            exercise.sets.map((set) => [
              set.weightKg,
              set.reps,
              set.completed,
            ]),
          ),
        ]),
        enabled: state.settings.showGym,
        notifications: [
          state.settings.notifications.pushEnabled,
          state.settings.notifications.quietHoursEnabled,
          state.settings.notifications.quietHoursStart,
          state.settings.notifications.quietHoursEnd,
          state.settings.notifications.gymReminders,
          state.settings.notifications.gymAchievements,
          state.settings.notifications.gymReminderDays,
          state.settings.language,
        ],
      }),
    [
      state.currentUserId,
      state.gymSessions,
      state.settings.language,
      state.settings.notifications,
      state.settings.showGym,
    ],
  );
  useEffect(() => {
    if (!localNotificationSchedulingEnabled || tutorialActive) return;
    const timer = setTimeout(
      () =>
        void syncGymNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    return () => clearTimeout(timer);
  }, [gymNotificationKey, localNotificationSchedulingEnabled, tutorialActive]);
  const productivityNotificationKey = useMemo(
    () =>
      JSON.stringify({
        user: state.currentUserId,
        todos: state.todos,
        reminders: state.calendarReminders,
        enabled: state.settings.notifications.pushEnabled,
        language: state.settings.language,
        todoReminders: state.settings.notifications.todoReminders,
        quiet: [
          state.settings.notifications.quietHoursEnabled,
          state.settings.notifications.quietHoursStart,
          state.settings.notifications.quietHoursEnd,
        ],
      }),
    [
      state.calendarReminders,
      state.currentUserId,
      state.settings.language,
      state.settings.notifications,
      state.todos,
    ],
  );
  useEffect(() => {
    if (!localNotificationSchedulingEnabled || tutorialActive) return;
    const timer = setTimeout(
      () =>
        void syncProductivityNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    return () => clearTimeout(timer);
  }, [productivityNotificationKey, localNotificationSchedulingEnabled, tutorialActive]);
  const webReminderScheduleKey = useMemo(
    () =>
      JSON.stringify([
        goalReminderKey,
        cycleNotificationKey,
        gymNotificationKey,
        productivityNotificationKey,
        activityTimerNotificationKey,
      ]),
    [
      activityTimerNotificationKey,
      cycleNotificationKey,
      goalReminderKey,
      gymNotificationKey,
      productivityNotificationKey,
    ],
  );
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      !hydrated ||
      !state.settings.notifications.pushEnabled ||
      tutorialActive ||
      !auth.user?.id ||
      auth.session?.user.id !== auth.user.id ||
      state.currentUserId !== auth.user.id
    )
      return;
    let active = true;
    let attempt = 0;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        await syncWebReminderSchedule(cycleStateRef.current);
        attempt = 0;
      } catch {
        if (!active) return;
        const delayMs = Math.min(5 * 60_000, 3_000 * 2 ** attempt);
        attempt = Math.min(attempt + 1, 20);
        retryTimer = setTimeout(() => void sync(), delayMs);
      } finally {
        inFlight = false;
      }
    };
    const retryNow = () => {
      if (!active || document.hidden || !navigator.onLine) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      attempt = 0;
      void sync();
    };
    const initialTimer = setTimeout(() => void sync(), 2200);
    // The schedule is private server state, not a browser alarm. Periodically
    // republish it so an interrupted deployment or backend cleanup cannot
    // strand an otherwise healthy Web Push subscription. The publisher itself
    // coalesces unchanged work for ten minutes.
    const repairTimer = setInterval(retryNow, 12 * 60_000);
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", retryNow);
    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(repairTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", retryNow);
    };
  }, [
    auth.session?.user.id,
    auth.user?.id,
    hydrated,
    network.isConnected,
    network.isInternetReachable,
    state.currentUserId,
    state.settings.notifications.pushEnabled,
    tutorialActive,
    webReminderScheduleKey,
  ]);
  useEffect(() => {
    if (
      !localNotificationSchedulingEnabled ||
      tutorialActive ||
      Platform.OS === "web"
    )
      return;
    let active = true;
    let interactionTask: { cancel: () => void } | undefined;
    let interactionFallback: ReturnType<typeof setTimeout> | undefined;
    const refreshLocalSchedules = () => {
      if (!active) return;
      void syncAllLocalNotifications(cycleStateRef.current).catch(
        () => undefined,
      );
    };
    const unsubscribeRefresh = subscribeLocalNotificationRefresh(
      refreshLocalSchedules,
    );
    const refreshAfterInteractions = () => {
      interactionTask?.cancel();
      if (interactionFallback) clearTimeout(interactionFallback);
      let completed = false;
      const run = () => {
        if (completed) return;
        completed = true;
        if (interactionFallback) clearTimeout(interactionFallback);
        refreshLocalSchedules();
      };
      interactionTask = InteractionManager.runAfterInteractions(run);
      interactionFallback = setTimeout(run, 1500);
    };
    const foregroundSubscription = NativeAppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") refreshAfterInteractions();
      },
    );
    return () => {
      active = false;
      interactionTask?.cancel();
      if (interactionFallback) clearTimeout(interactionFallback);
      unsubscribeRefresh();
      foregroundSubscription.remove();
    };
  }, [localNotificationSchedulingEnabled, tutorialActive]);
  const pushRegistrationUserId = auth.user?.id;
  const pushRegistrationKey = useMemo(
    () =>
      JSON.stringify({
        userId: pushRegistrationUserId,
        language: state.settings.language,
        notifications: {
          pushEnabled: state.settings.notifications.pushEnabled,
          groupMetricActivity:
            state.settings.notifications.groupMetricActivity,
          leadChanges: state.settings.notifications.leadChanges,
          metricIds: state.settings.notifications.metricIds,
          chatMessages: state.settings.notifications.chatMessages,
          groupMembership: state.settings.notifications.groupMembership,
          challenges: state.settings.notifications.challenges,
          badgesAndWinners:
            state.settings.notifications.badgesAndWinners,
          quietHoursEnabled:
            state.settings.notifications.quietHoursEnabled,
          quietHoursStart: state.settings.notifications.quietHoursStart,
          quietHoursEnd: state.settings.notifications.quietHoursEnd,
          mutedGroupIds: state.settings.notifications.mutedGroupIds,
          groupPreferencesByGroup:
            state.settings.notifications.groupPreferencesByGroup,
          mutedConversationIds:
            state.settings.notifications.mutedConversationIds,
        },
      }),
    [
      pushRegistrationUserId,
      state.settings.language,
      state.settings.notifications.pushEnabled,
      state.settings.notifications.groupMetricActivity,
      state.settings.notifications.leadChanges,
      state.settings.notifications.metricIds,
      state.settings.notifications.chatMessages,
      state.settings.notifications.groupMembership,
      state.settings.notifications.challenges,
      state.settings.notifications.badgesAndWinners,
      state.settings.notifications.quietHoursEnabled,
      state.settings.notifications.quietHoursStart,
      state.settings.notifications.quietHoursEnd,
      state.settings.notifications.mutedGroupIds,
      state.settings.notifications.groupPreferencesByGroup,
      state.settings.notifications.mutedConversationIds,
    ],
  );
  useEffect(() => {
    if (
      !hydrated ||
      Platform.OS === "web" ||
      !pushRegistrationUserId ||
      state.settings.notifications.pushEnabled
    )
      return;
    // Account settings may turn off on another device while this phone is
    // offline. Local cleanup is immediate; the helper retains a durable
    // server-token deletion marker until any signed-in device reconnects.
    void disablePushNotifications(pushRegistrationUserId).catch(
      () => undefined,
    );
  }, [
    hydrated,
    network.isConnected,
    network.isInternetReachable,
    pushRegistrationUserId,
    state.settings.notifications.pushEnabled,
  ]);
  useEffect(() => {
    if (
      !hydrated ||
      Platform.OS === "web" ||
      !pushRegistrationUserId ||
      !state.settings.notifications.pushEnabled
    )
      return;
    const userId = pushRegistrationUserId;
    let active = true;
    const refresh = async () => {
      if (await hasPendingPushDisable(userId)) {
        // The user may have killed the process after the durable off marker was
        // written but before the settings snapshot reached disk. Do not let a
        // stale hydrated `true` recreate alarms or a remote token.
        if (active)
          updateSettings({
            notifications: {
              ...cycleStateRef.current.settings.notifications,
              pushEnabled: false,
            },
          });
        await disablePushNotifications(userId).catch(() => undefined);
        return false;
      }
      await allowPushRegistrationForAccount(userId);
      if (!active) return false;
      await updatePushPreferences(
        userId,
        cycleStateRef.current.settings.notifications,
        cycleStateRef.current.settings.language,
        () => active,
      );
      return active;
    };
    const recover = () =>
      recoverPushRegistrationOnForeground(
        userId,
        cycleStateRef.current.settings.notifications,
        cycleStateRef.current.settings.language,
        () => active,
      ).catch(() => undefined);
    const refreshAndRecover = () =>
      refresh()
        .then((allowed) => (allowed ? recover() : undefined))
        .catch(() => undefined);
    void refreshAndRecover();
    const foregroundSubscription = NativeAppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState !== "active") return;
        void refreshAndRecover();
      },
    );
    const subscription = Notifications.addPushTokenListener(
      () =>
        void refresh()
          .then((allowed) =>
            allowed
              ? refreshPushTokenRegistration(
                  userId,
                  cycleStateRef.current.settings.notifications,
                  cycleStateRef.current.settings.language,
                  () => active,
                )
              : undefined,
          )
          .catch(() => undefined),
    );
    return () => {
      active = false;
      foregroundSubscription.remove();
      subscription.remove();
    };
  }, [
    pushRegistrationUserId,
    pushRegistrationKey,
    state.settings.notifications.pushEnabled,
    hydrated,
    updateSettings,
  ]);
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      !hydrated ||
      !pushRegistrationUserId
    )
      return;
    const userId = pushRegistrationUserId;
    let active = true;
    if (!state.settings.notifications.pushEnabled) {
      void disablePushNotifications(userId).catch(() => undefined);
      return () => {
        active = false;
      };
    }
    const refresh = async () => {
      if (await hasPendingPushDisable(userId)) {
        if (active)
          updateSettings({
            notifications: {
              ...cycleStateRef.current.settings.notifications,
              pushEnabled: false,
            },
          });
        await disablePushNotifications(userId).catch(() => undefined);
        return;
      }
      await allowPushRegistrationForAccount(userId);
      if (!active) return;
      await updatePushPreferences(
        userId,
        cycleStateRef.current.settings.notifications,
        cycleStateRef.current.settings.language,
        () => active,
      );
      if (!active) return;
      await recoverPushRegistrationOnForeground(
        userId,
        cycleStateRef.current.settings.notifications,
        cycleStateRef.current.settings.language,
        () => active,
      );
    };
    const recover = () => void refresh().catch(() => undefined);
    recover();
    const visibilityListener = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", visibilityListener);
    const unsubscribeSubscriptionChanges =
      subscribeWebPushSubscriptionChanges(recover);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", visibilityListener);
      unsubscribeSubscriptionChanges();
    };
  }, [
    hydrated,
    network.isConnected,
    network.isInternetReachable,
    pushRegistrationKey,
    pushRegistrationUserId,
    state.settings.notifications.pushEnabled,
    updateSettings,
  ]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const route = data?.route;
      if (
        route === "/chat" &&
        data?.conversationType === "direct" &&
        typeof data?.senderId === "string"
      ) {
        router.push({
          pathname: "/chat",
          params: { recipient: data.senderId },
        } as never);
      } else if (typeof route === "string" && route.startsWith("/")) {
        const params = Object.fromEntries(
          Object.entries(data ?? {}).flatMap(([key, value]) =>
            key !== "route" &&
            (typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean")
              ? [[key, String(value)]]
              : [],
          ),
        );
        if (!route.includes("?") && Object.keys(params).length)
          router.push({ pathname: route, params } as never);
        else router.push(route as never);
      }
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response);
    });
    return () => subscription.remove();
  }, []);
  const safeDefaultLandingPage = useMemo(() => {
    const target = state.settings.defaultLandingPage ?? "index";
    const visible = {
      index: true,
      log: state.settings.showLog !== false,
      group: state.settings.showLeaderboard !== false,
      insights: true,
      chat: state.settings.showChat !== false,
      gym: state.settings.showGym !== false,
      calendar: state.settings.showCalendar !== false,
      journal: state.settings.showJournal !== false,
      performance: state.settings.showPerformance !== false,
      status: state.settings.showStatus === true,
    } as const;
    return visible[target] ? target : "index";
  }, [
    state.settings.defaultLandingPage,
    state.settings.showChat,
    state.settings.showGym,
    state.settings.showCalendar,
    state.settings.showJournal,
    state.settings.showLeaderboard,
    state.settings.showLog,
    state.settings.showPerformance,
    state.settings.showStatus,
  ]);
  useEffect(() => {
    if (
      landingApplied.current ||
      !hydrated ||
      !onboardingDone ||
      auth.status === "loading" ||
      rootSegment !== "(tabs)"
    ) return;
    landingApplied.current = true;
    const target = safeDefaultLandingPage;
    if (target !== "index")
      setTimeout(() => router.replace(`/${target}` as never), 0);
  }, [
    auth.status,
    hydrated,
    onboardingDone,
    rootSegment,
    safeDefaultLandingPage,
  ]);
  const accent =
    state.settings.overrideGroupTheme && state.settings.personalThemeColor
      ? state.settings.personalThemeColor
      : (state.group.themeColor ?? palette.primary);
  // Navigation's theme is context. Recreating it for every health entry,
  // message, or presence heartbeat invalidates every mounted navigator screen,
  // including screens retained in the stack. Keep it stable until appearance
  // settings actually change.
  const activeTheme = useMemo(
    () => ({
      ...theme,
      dark: state.settings.darkMode,
      colors: {
        ...theme.colors,
        primary: accent,
        background: state.settings.darkMode ? "#071127" : palette.canvas,
        text: state.settings.darkMode ? "#F5F8FF" : palette.ink,
        card: state.settings.darkMode ? "#101D39" : palette.card,
        border: state.settings.darkMode ? "#283654" : palette.border,
      },
    }),
    [accent, state.settings.darkMode],
  );
  const stackScreenOptions = useMemo(
    () => ({
      headerShown: false as const,
      contentStyle: {
        backgroundColor: state.settings.darkMode ? "#071127" : palette.canvas,
      },
    }),
    [state.settings.darkMode],
  );
  const inAuthRoute =
    rootSegment === "sign-in" ||
    rootSegment === "auth-callback" ||
    rootSegment === "auth" ||
    rootSegment === "update-password" ||
    rootSegment === "join" ||
    rootSegment === "onboarding" ||
    rootSegment === "extension" ||
    rootSegment === "privacy";

  const accountStateMismatch =
    auth.status === "signedIn" &&
    Boolean(auth.user) &&
    state.currentUserId !== auth.user?.id;
  // A new browser has no local onboarding marker. Wait for the authoritative
  // account snapshot before deciding whether to enter onboarding; otherwise an
  // already-onboarded account can bounce between onboarding and its saved
  // landing page while the first cloud read is still resolving.
  const cloudAccountHydrating = shouldWaitForOnboardingAuthority({
    authStatus: auth.status,
    cloudSyncStatus,
    onboardingDone,
  });
  if (auth.status === "loading" || accountStateMismatch || cloudAccountHydrating) {
    return (
      <View style={styles.loading}>
        <Image
          source={require("../assets/images/habhub-icon.png")}
          style={styles.loadingLogo}
          contentFit="contain"
          accessibilityLabel="HabHub logo"
        />
        <ActivityIndicator color="#58E1D4" />
      </View>
    );
  }
  if (auth.configured && auth.status === "signedOut" && !inAuthRoute)
    return <Redirect href={"/sign-in" as never} />;
  if (
    auth.status === "signedIn" &&
    auth.passwordRecovery &&
    rootSegment !== "update-password"
  )
    return <Redirect href={"/update-password" as never} />;
  if (
    auth.status === "signedIn" &&
    onboardingDone &&
    rootSegment === "onboarding"
  ) {
    const target = safeDefaultLandingPage;
    return <Redirect href={(target === "index" ? "/" : `/${target}`) as never} />;
  }
  if (
    !onboardingDone &&
    onboardingMarker?.accountId === onboardingAccountId &&
    rootSegment !== "onboarding" &&
    rootSegment !== "extension" &&
    rootSegment !== "privacy" &&
    !(auth.configured && auth.status === "signedOut")
  )
    return <Redirect href={"/onboarding" as never} />;

  return (
    <GroupAccentProvider color={accent}>
      <DarkModeProvider dark={state.settings.darkMode}>
        <FontScaleProvider scale={state.settings.fontScale ?? 1}>
          <CompactModeProvider compact={state.settings.compactMode}>
            <ThemeProvider value={activeTheme}>
            <View
              aria-hidden={tutorialActive}
              accessibilityElementsHidden={tutorialActive}
              importantForAccessibility={
                tutorialActive ? "no-hide-descendants" : "auto"
              }
              style={styles.tutorialRouteLayer}
            >
            <TutorialRouteBoundary>
            <Stack screenOptions={stackScreenOptions}>
              <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
              <Stack.Screen
                name="auth-callback"
                options={{ animation: "fade" }}
              />
              <Stack.Screen
                name="auth/callback"
                options={{ animation: "fade" }}
              />
              <Stack.Screen
                name="update-password"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="join" options={{ presentation: "modal" }} />
              <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
              <Stack.Screen name="extension" options={{ animation: "fade" }} />
              <Stack.Screen name="privacy" options={{ animation: "fade" }} />
              <Stack.Screen
                name="food-search"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="metric-detail"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="gym-exercise"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="customize"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="metric-editor"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="settings"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="display-settings"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="quick-guide"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="view-filters"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="todo-editor"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="reminder-editor"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="note-editor"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="metral-ai"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="assistant-log"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="timer" options={{ presentation: "modal" }} />
              <Stack.Screen
                name="profile"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="notifications"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="vacation"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="group-settings"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="badges" options={{ presentation: "modal" }} />
              <Stack.Screen name="alerts" options={{ presentation: "modal" }} />
              <Stack.Screen name="recap" options={{ presentation: "modal" }} />
              <Stack.Screen
                name="menu"
                options={{
                  presentation: "transparentModal",
                  animation: "fade",
                }}
              />
              <Stack.Screen name="member/[id]" />
              <Stack.Screen name="day/[date]" />
              <Stack.Screen name="leaderboard-detail" />
              <Stack.Screen name="groups" options={{ presentation: "modal" }} />
              <Stack.Screen
                name="create-group"
                options={{ presentation: "modal" }}
              />
            </Stack>
            {state.settings.showAiAssistant && rootSegment === "(tabs)" ? (
              <AiAssistantButton />
            ) : null}
            <ActiveTimerOverlay
              hidden={rootSegment === "timer" || rootSegment === "extension"}
            />
            <InAppChatBanner />
            <WebAlertHost />
            </TutorialRouteBoundary>
            </View>
            <TutorialSpotlight />
            <StatusBar style={state.settings.darkMode ? "light" : "dark"} />
            </ThemeProvider>
          </CompactModeProvider>
        </FontScaleProvider>
      </DarkModeProvider>
    </GroupAccentProvider>
  );
}

function TutorialRouteBoundary({ children }: React.PropsWithChildren) {
  const tutorial = useTutorial();
  if (!tutorial.activeSession) return <>{children}</>;
  return (
    <TutorialAppStateBoundary
      runId={tutorial.activeSession.runId}
      anchorDate={tutorial.activeSession.demoAnchorDate}
    >
      {children}
    </TutorialAppStateBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tutorialRouteLayer: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#081B49",
    gap: 18,
  },
  loadingLogo: { width: 88, height: 88, borderRadius: 24 },
});
