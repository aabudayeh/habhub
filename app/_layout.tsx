import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Image } from "expo-image";
import { Redirect, router, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import "@/src/notifications/workoutTimer";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  TutorialSpotlight,
} from "@/src/components/TutorialSpotlight";
import "react-native-reanimated";

import { AuthProvider, useAuth } from "@/src/auth/AuthProvider";
import { CloudSyncProvider } from "@/src/cloud/CloudSyncProvider";
import { HealthSyncProvider } from "@/src/health/HealthSyncProvider";
import { AppProvider, useApp } from "@/src/state/AppProvider";
import { LocalizationProvider } from "@/src/i18n";
import { WebDocumentMetadata } from "@/src/i18n/WebDocumentMetadata";
import { onboardingCompletedLocally } from "@/src/storage/onboardingState";
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
  syncCycleNotifications,
  syncGoalNotifications,
  syncGymNotifications,
  syncProductivityNotifications,
  refreshPushTokenRegistration,
  updatePushPreferences,
} from "@/src/notifications/push";

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
    <GestureHandlerRootView style={styles.root}>
      <AuthProvider>
        <AppProvider>
          <AppLocalizationBridge />
        </AppProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function AppLocalizationBridge() {
  const { state } = useApp();
  return (
    <LocalizationProvider language={state.settings.language}>
      <WebDocumentMetadata />
      <ScreenTimeSyncBridge />
      <WidgetSnapshotBridge />
      <HealthSyncProvider>
        <CloudSyncProvider>
          <RootNavigator />
        </CloudSyncProvider>
      </HealthSyncProvider>
    </LocalizationProvider>
  );
}

function RootNavigator() {
  const auth = useAuth();
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
  const cycleNotificationKey = `${cycleSignature}|${state.currentUserId}|${state.settings.notifications.pushEnabled}|${state.settings.notifications.cyclePredictions}|${state.settings.notifications.cyclePhaseUpdates}|${state.settings.notifications.cycleReminderDays}`;
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void syncCycleNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1200,
    );
    return () => clearTimeout(timer);
  }, [cycleNotificationKey]);
  const goalReminderKey = useMemo(
    () =>
      JSON.stringify({
        user: state.currentUserId,
        periods: state.trackedGoalPeriods,
        reminders: state.metrics.map((metric) => [
          metric.id,
          metric.activeFrom,
          metric.goalSchedule,
          metric.reminder,
          metric.reminders,
        ]),
        notifications: {
          pushEnabled: state.settings.notifications.pushEnabled,
          reminders: state.settings.notifications.reminders,
          quietHoursEnabled:
            state.settings.notifications.quietHoursEnabled,
          quietHoursStart: state.settings.notifications.quietHoursStart,
          quietHoursEnd: state.settings.notifications.quietHoursEnd,
        },
      }),
    [
      state.currentUserId,
      state.metrics,
      state.settings.notifications.pushEnabled,
      state.settings.notifications.reminders,
      state.settings.notifications.quietHoursEnabled,
      state.settings.notifications.quietHoursStart,
      state.settings.notifications.quietHoursEnd,
      state.trackedGoalPeriods,
    ],
  );
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void syncGoalNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    return () => clearTimeout(timer);
  }, [goalReminderKey]);
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
        ],
      }),
    [
      state.currentUserId,
      state.gymSessions,
      state.settings.notifications,
      state.settings.showGym,
    ],
  );
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void syncGymNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    return () => clearTimeout(timer);
  }, [gymNotificationKey]);
  const productivityNotificationKey = useMemo(
    () =>
      JSON.stringify({
        user: state.currentUserId,
        todos: state.todos,
        reminders: state.calendarReminders,
        enabled: state.settings.notifications.pushEnabled,
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
      state.settings.notifications,
      state.todos,
    ],
  );
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void syncProductivityNotifications(cycleStateRef.current).catch(
          () => undefined,
        ),
      1800,
    );
    return () => clearTimeout(timer);
  }, [productivityNotificationKey]);
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
          badgesAndWinners:
            state.settings.notifications.badgesAndWinners,
          quietHoursEnabled:
            state.settings.notifications.quietHoursEnabled,
          quietHoursStart: state.settings.notifications.quietHoursStart,
          quietHoursEnd: state.settings.notifications.quietHoursEnd,
          mutedGroupIds: state.settings.notifications.mutedGroupIds,
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
      state.settings.notifications.badgesAndWinners,
      state.settings.notifications.quietHoursEnabled,
      state.settings.notifications.quietHoursStart,
      state.settings.notifications.quietHoursEnd,
      state.settings.notifications.mutedGroupIds,
      state.settings.notifications.mutedConversationIds,
    ],
  );
  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !pushRegistrationUserId ||
      !state.settings.notifications.pushEnabled
    )
      return;
    const userId = pushRegistrationUserId;
    let active = true;
    const refresh = () =>
      updatePushPreferences(
        userId,
        cycleStateRef.current.settings.notifications,
        cycleStateRef.current.settings.language,
        () => active,
      ).catch(() => undefined);
    void refresh();
    const subscription = Notifications.addPushTokenListener(
      () =>
        void refreshPushTokenRegistration(
          userId,
          cycleStateRef.current.settings.notifications,
          cycleStateRef.current.settings.language,
          () => active,
        ).catch(() => undefined),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [
    pushRegistrationUserId,
    pushRegistrationKey,
    state.settings.notifications.pushEnabled,
  ]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const route = data?.route;
      if (route === "/chat" && typeof data?.senderId === "string") {
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
    rootSegment === "extension";

  const accountStateMismatch =
    auth.status === "signedIn" &&
    Boolean(auth.user) &&
    state.currentUserId !== auth.user?.id;
  if (auth.status === "loading" || accountStateMismatch) {
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
    !(auth.configured && auth.status === "signedOut")
  )
    return <Redirect href={"/onboarding" as never} />;

  return (
    <GroupAccentProvider color={accent}>
      <DarkModeProvider dark={state.settings.darkMode}>
        <FontScaleProvider scale={state.settings.fontScale ?? 1}>
          <CompactModeProvider compact={state.settings.compactMode}>
            <ThemeProvider value={activeTheme}>
            <TutorialProvider>
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
            <TutorialSpotlight />
            <StatusBar style={state.settings.darkMode ? "light" : "dark"} />
            </TutorialProvider>
            </ThemeProvider>
          </CompactModeProvider>
        </FontScaleProvider>
      </DarkModeProvider>
    </GroupAccentProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#081B49",
    gap: 18,
  },
  loadingLogo: { width: 88, height: 88, borderRadius: 24 },
});
