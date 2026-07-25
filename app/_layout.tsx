import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Redirect, router, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import "@/src/notifications/workoutTimer";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  AppState as NativeAppState,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import "react-native-reanimated";

import { AuthProvider, useAuth } from "@/src/auth/AuthProvider";
import { CloudSyncProvider } from "@/src/cloud/CloudSyncProvider";
import { HealthSyncProvider } from "@/src/health/HealthSyncProvider";
import { AppProvider, useApp } from "@/src/state/AppProvider";
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
  updatePushPreferences,
} from "@/src/notifications/push";
import { dateKey } from "@/src/domain/date";

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
    <AuthProvider>
      <AppProvider>
        <HealthSyncProvider>
          <CloudSyncProvider>
            <RootNavigator />
          </CloudSyncProvider>
        </HealthSyncProvider>
      </AppProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const auth = useAuth();
  const { state, hydrated } = useApp();
  const segments = useSegments();
  const rootSegment = String(segments[0] ?? "");
  const landingApplied = useRef(false);
  const cycleSignature = state.entries
    .filter((entry) => entry.userId === state.currentUserId && entry.metricId === "menstrual_cycle")
    .map((entry) => `${entry.localDate}:${entry.value}`)
    .join("|");
  const cycleStateRef = useRef(state);
  cycleStateRef.current = state;
  const cycleNotificationKey = `${cycleSignature}|${state.currentUserId}|${state.settings.notifications.pushEnabled}|${state.settings.notifications.cyclePredictions}|${state.settings.notifications.cyclePhaseUpdates}|${state.settings.notifications.cycleReminderDays}`;
  useEffect(() => {
    void syncCycleNotifications(cycleStateRef.current).catch(() => undefined);
  }, [cycleNotificationKey]);
  const goalReminderKey = JSON.stringify({
    user: state.currentUserId,
    periods: state.trackedGoalPeriods,
    reminders: state.metrics.map((metric) => [metric.id, metric.activeFrom, metric.goalSchedule, metric.reminder, metric.reminders]),
    entries: state.entries
      .filter((entry) => entry.userId === state.currentUserId && entry.localDate >= dateKey())
      .map((entry) => [entry.metricId, entry.localDate, entry.value]),
    notifications: state.settings.notifications,
  });
  useEffect(() => {
    void syncGoalNotifications(cycleStateRef.current).catch(() => undefined);
  }, [goalReminderKey]);
  const gymNotificationKey = JSON.stringify({
    user: state.currentUserId,
    gym: (state.gymSessions ?? []).map((session) => [
      session.id,
      session.recordedAt,
      session.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => [set.weightKg, set.reps, set.completed]),
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
  });
  useEffect(() => {
    void syncGymNotifications(cycleStateRef.current).catch(() => undefined);
  }, [gymNotificationKey]);
  const pushRegistrationKey = JSON.stringify({
    userId: auth.user?.id,
    notifications: state.settings.notifications,
  });
  useEffect(() => {
    if (!auth.user || !state.settings.notifications.pushEnabled) return;
    const userId = auth.user.id;
    const refresh = () =>
      updatePushPreferences(
        userId,
        cycleStateRef.current.settings.notifications,
      ).catch(() => undefined);
    void refresh();
    const subscription = NativeAppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") void refresh();
      },
    );
    return () => subscription.remove();
  }, [
    auth.user,
    pushRegistrationKey,
    state.settings.notifications.pushEnabled,
  ]);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const route = response.notification.request.content.data?.route;
      if (typeof route === "string" && route.startsWith("/"))
        router.push(route as never);
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (
      landingApplied.current ||
      !hydrated ||
      !state.settings.onboardingComplete ||
      auth.status === "loading" ||
      rootSegment !== "(tabs)"
    ) return;
    landingApplied.current = true;
    const target = state.settings.defaultLandingPage ?? "index";
    if (target !== "index")
      setTimeout(() => router.replace(`/${target}` as never), 0);
  }, [auth.status, hydrated, rootSegment, state.settings.defaultLandingPage, state.settings.onboardingComplete]);
  const inAuthRoute =
    rootSegment === "sign-in" ||
    rootSegment === "auth-callback" ||
    rootSegment === "update-password" ||
    rootSegment === "join" ||
    rootSegment === "onboarding";

  if (auth.status === "loading") {
    return (
      <View style={styles.loading}>
        <View style={styles.mark}>
          <Text style={styles.initial}>N</Text>
        </View>
        <ActivityIndicator color={palette.primary} />
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
    !state.settings.onboardingComplete &&
    rootSegment !== "onboarding" &&
    !(auth.configured && auth.status === "signedOut")
  )
    return <Redirect href={"/onboarding" as never} />;

  const accent = state.group.themeColor ?? palette.primary;
  const activeTheme = {
    ...theme,
    dark: state.settings.darkMode,
    colors: {
      ...theme.colors,
      primary: accent,
      background: state.settings.darkMode ? "#0F1411" : palette.canvas,
      text: state.settings.darkMode ? "#F1F5F2" : palette.ink,
      card: state.settings.darkMode ? "#18201B" : palette.card,
      border: state.settings.darkMode ? "#2B3730" : palette.border,
    },
  };
  return (
    <GroupAccentProvider color={accent}>
      <DarkModeProvider dark={state.settings.darkMode}>
        <FontScaleProvider scale={state.settings.fontScale ?? 1}>
          <CompactModeProvider compact={state.settings.compactMode}>
            <ThemeProvider value={activeTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: state.settings.darkMode
                    ? "#0F1411"
                    : palette.canvas,
                },
              }}
            >
              <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
              <Stack.Screen
                name="auth-callback"
                options={{ animation: "fade" }}
              />
              <Stack.Screen
                name="update-password"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="join" options={{ presentation: "modal" }} />
              <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
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
            <StatusBar style={state.settings.darkMode ? "light" : "dark"} />
            </ThemeProvider>
          </CompactModeProvider>
        </FontScaleProvider>
      </DarkModeProvider>
    </GroupAccentProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
    gap: 18,
  },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink,
  },
  initial: { color: palette.lime, fontSize: 26, fontWeight: "900" },
});
