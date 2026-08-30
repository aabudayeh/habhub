import { Ionicons } from "@expo/vector-icons";
import { BottomTabBar } from "@react-navigation/bottom-tabs";
import { useIsFocused } from "@react-navigation/native";
import { Href, Tabs } from "expo-router";
import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Freeze } from "react-freeze";
import { enableFreeze } from "react-native-screens";

import { HapticTab } from "@/components/haptic-tab";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useApp } from "@/src/state/AppProvider";
import { LandingPage } from "@/src/types";
import { useTranslation } from "@/src/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSoftwareKeyboardVisibility } from "@/src/components/useSoftwareKeyboardVisibility";
import {
  hydrateWorkoutTimerPresence,
  setWorkoutTimerPresence,
  subscribeWorkoutTimerPresence,
  workoutTimerPresenceFor,
} from "@/src/storage/workoutTimerPresence";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { requestLogDraftExit } from "@/src/components/logDraftNavigationGuard";
import {
  compactTabBarForCount,
  normalizeTabOrder,
} from "@/src/domain/navigation";
import {
  resolveTabBarBottomInset,
  WebDisplayEnvironment,
} from "@/src/domain/webSafeArea";

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "today-outline",
  log: "add-circle-outline",
  group: "people-outline",
  insights: "stats-chart-outline",
  chat: "chatbubbles-outline",
  gym: "barbell-outline",
  calendar: "calendar-outline",
  journal: "book-outline",
  performance: "speedometer-outline",
  status: "accessibility-outline",
  timers: "timer-outline",
  recapfeed: "newspaper-outline",
};

type TabRouteName = LandingPage | "timers";

// Native tabs keep their local state, but hidden heavy pages must stop React
// work while another tab is handling touches. react-native-screens requires
// this opt-in for `freezeOnBlur` to suspend inactive React subtrees.
if (Platform.OS !== "web") enableFreeze(true);

function WebTabFreeze({ children }: React.PropsWithChildren) {
  const isFocused = useIsFocused();
  // react-native-screens freezes inactive native screens, but its web fallback
  // leaves every visited tab mounted and subscribed to the full app state.
  // Suspend only hidden web tab subtrees so large Status/Progress histories do
  // not re-render behind the page the user is actually touching.
  if (Platform.OS !== "web") return children;
  return <Freeze freeze={!isFocused}>{children}</Freeze>;
}

export default function TabLayout() {
  const accent = useGroupAccent();
  const { state } = useApp();
  const colors = useAppColors();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const webDisplayEnvironment = useMemo<WebDisplayEnvironment | undefined>(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      typeof navigator === "undefined"
    ) {
      return undefined;
    }

    const browserNavigator = navigator as Navigator & {
      standalone?: boolean;
    };
    return {
      userAgent: browserNavigator.userAgent,
      platform: browserNavigator.platform,
      maxTouchPoints: browserNavigator.maxTouchPoints,
      displayModeStandalone:
        window.matchMedia?.("(display-mode: standalone)").matches === true,
      navigatorStandalone: browserNavigator.standalone === true,
    };
  }, []);
  const tabBarBottomInset = resolveTabBarBottomInset(
    insets.bottom,
    webDisplayEnvironment,
  );
  // Portrait iPhones report a bottom safe area but commonly zero side insets.
  // Their rounded lower corners can still mask the first/last tab labels even
  // though a screenshot contains every pixel, so reserve a small edge gutter
  // only for web displays that actually report a home-indicator safe area.
  const curvedWebEdgeGutter =
    Platform.OS === "web" && insets.bottom > 0 ? 10 : 0;
  const softwareKeyboardVisible = useSoftwareKeyboardVisibility();
  const activityTimers = state.activityTimers?.length
    ? state.activityTimers
    : state.activeTimer
      ? [state.activeTimer]
      : [];
  const hasActiveActivityTimer = activityTimers.length > 0;
  const hasActiveWorkoutTimer = useSyncExternalStore(
    subscribeWorkoutTimerPresence,
    () => workoutTimerPresenceFor(state.currentUserId),
    () => false,
  );
  useEffect(() => {
    setWorkoutTimerPresence(state.currentUserId, false);
    void hydrateWorkoutTimerPresence(state.currentUserId);
  }, [state.currentUserId]);
  const hasUnreadChat = useMemo(() => {
    const readAt =
      state.settings.notifications.chatReadAtByConversation ?? {};
    const groupConversationId = `group:${state.group.id}`;
    return state.messages.some((message) => {
      if (
        message.senderId === state.currentUserId ||
        message.senderId === "system" ||
        (message.groupId && message.groupId !== state.group.id)
      )
        return false;
      const rawConversationId = message.conversationId ?? "group";
      const conversationId =
        rawConversationId === "group"
          ? groupConversationId
          : rawConversationId;
      const isCurrentGroup = conversationId === groupConversationId;
      const isDirectForCurrentUser =
        conversationId.startsWith("dm:") &&
        conversationId
          .slice(3)
          .split(":")
          .includes(state.currentUserId);
      if (!isCurrentGroup && !isDirectForCurrentUser) return false;
      const cursor =
        readAt[`${state.group.id}:${conversationId}`] ??
        readAt[conversationId] ??
        "";
      return message.createdAt > cursor;
    });
  }, [
    state.currentUserId,
    state.group.id,
    state.messages,
    state.settings.notifications.chatReadAtByConversation,
  ]);
  const showLog = state.settings.showLog !== false;
  const showLeaderboard = state.settings.showLeaderboard !== false;
  const showChat = state.settings.showChat !== false;
  const showGym = state.settings.showGym !== false;
  const showCalendar = state.settings.showCalendar !== false;
  const showJournal = state.settings.showJournal !== false;
  const showPerformance = state.settings.showPerformance !== false;
  const showRecap = state.settings.showRecap === true;
  const showStatus = state.settings.showStatus !== false;
  const tabOrder = useMemo(
    () => normalizeTabOrder(state.settings.tabOrder),
    [state.settings.tabOrder],
  );
  const showTimersTab =
    state.settings.showActiveTimersTab === true && hasActiveActivityTimer;
  const orderedTabs = useMemo<TabRouteName[]>(() => {
    if (!showTimersTab) return tabOrder;
    const next: TabRouteName[] = [...tabOrder];
    const workoutIndex = next.indexOf("gym");
    next.splice(workoutIndex >= 0 ? workoutIndex + 1 : next.length, 0, "timers");
    return next;
  }, [showTimersTab, tabOrder]);
  const tabOptions: Record<
    TabRouteName,
    { title: string; href?: Href | null }
  > = {
    index: { title: t("Today") },
    log: {
      title: t("Log"),
      href: showLog ? "/log" : null,
    },
    group: {
      title: t("Leaderboard"),
      href: showLeaderboard ? "/group" : null,
    },
    insights: { title: t("Progress") },
    chat: { title: t("Chat"), href: showChat ? "/chat" : null },
    gym: { title: t("Workout"), href: showGym ? "/gym" : null },
    calendar: {
      title: t("Schedule"),
      href: showCalendar ? "/calendar" : null,
    },
    journal: {
      title: t("Journal"),
      href: showJournal ? "/journal" : null,
    },
    performance: {
      title: t("Performance"),
      href: showPerformance ? "/performance" : null,
    },
    recapfeed: {
      title: t("Feed"),
      href: showRecap ? ("/recapfeed" as Href) : null,
    },
    status: {
      title: t("Status"),
      href: showStatus ? ("/status" as Href) : null,
    },
    timers: {
      title: t("Timers"),
      href: showTimersTab ? ("/timers" as Href) : null,
    },
  };
  const isVisible = (name: TabRouteName) => tabOptions[name].href !== null;
  const visibleTabCount = orderedTabs.filter(isVisible).length;
  const compactTabBar = compactTabBarForCount(visibleTabCount);
  const requestedDefault = state.settings.defaultLandingPage ?? "index";
  const defaultTab: LandingPage = isVisible(requestedDefault)
    ? requestedDefault
    : tabOrder.find(isVisible) ?? "index";
  return (
    <Tabs
      initialRouteName={defaultTab}
      tabBar={(props) => (
        <TutorialTarget id="tab-bar">
          <BottomTabBar {...props} />
        </TutorialTarget>
      )}
      screenLayout={({ children }) => (
        <WebTabFreeze>{children}</WebTabFreeze>
      )}
      // Inactive native trees must not keep drawing charts/lists behind the
      // visible page. Routes stay mounted so their local navigation state is
      // preserved, while React Navigation detaches and freezes their views.
      detachInactiveScreens
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        tabBarButton: isVisible(route.name as TabRouteName)
          ? (props) => (
              <HapticTab {...props} tutorialId={`tab-${route.name}`} />
            )
          : () => null,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: colors.faint,
        // React Native Web does not emit the Keyboard events consumed by
        // tabBarHideOnKeyboard. Its visual viewport is handled below instead.
        tabBarHideOnKeyboard: Platform.OS !== "web",
        // The default tab-bar show animation keeps the bar absolutely
        // positioned for 250 ms after Android has already closed the keyboard,
        // then puts it back into layout. On Chat that creates a second resize
        // and a visible composer flicker. Reinsert it immediately; the native
        // keyboard transition still supplies the visual movement.
        tabBarVisibilityAnimationConfig:
          route.name === "chat"
            ? {
                show: { animation: "timing", config: { duration: 0 } },
                hide: { animation: "timing", config: { duration: 0 } },
              }
            : undefined,
        tabBarStyle: {
          display:
            Platform.OS === "web" && softwareKeyboardVisible
              ? "none"
              : "flex",
          // On Android, keep Chat's bar in normal navigator layout. Combined
          // with adjustResize this gives the composer one authoritative bottom
          // edge and prevents stale/double IME offsets. Web and iOS retain the
          // established overlay behavior and reserve this height in Chat.
          position:
            route.name === "chat" && Platform.OS !== "android"
              ? "absolute"
              : undefined,
          height: 55 + tabBarBottomInset,
          paddingTop: 2,
          paddingBottom: Math.max(1, tabBarBottomInset),
          paddingLeft:
            Platform.OS === "web"
              ? Math.max(insets.left, curvedWebEdgeGutter)
              : undefined,
          paddingRight:
            Platform.OS === "web"
              ? Math.max(insets.right, curvedWebEdgeGutter)
              : undefined,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarItemStyle: compactTabBar
          ? { minWidth: 0, paddingHorizontal: 0 }
          : undefined,
        tabBarLabelStyle: compactTabBar
          ? {
              fontSize: 7.2,
              lineHeight: 8,
              letterSpacing: -0.25,
              fontWeight: "700",
              marginHorizontal: -3,
            }
          : { fontSize: 9, fontWeight: "700" },
        tabBarIcon: ({ color, focused }) => {
          const icon = icons[route.name];
          return (
            <View
              style={[styles.tabIcon, compactTabBar && styles.compactTabIcon]}
            >
              <Ionicons
                name={
                  focused
                    ? (icon.replace(
                        "-outline",
                        "",
                      ) as keyof typeof Ionicons.glyphMap)
                    : icon
                }
                size={compactTabBar ? 20 : 22}
                color={color}
              />
              {route.name === "chat" && hasUnreadChat ? (
                <View
                  accessibilityLabel={t("Unread chat messages")}
                  style={[
                    styles.unreadDot,
                    { borderColor: colors.card },
                  ]}
                />
              ) : null}
              {(route.name === "gym" && hasActiveWorkoutTimer) ||
              (route.name === "timers" && hasActiveActivityTimer) ? (
                <View
                  accessibilityLabel={
                    route.name === "gym"
                      ? t("Workout timer active")
                      : t("Activity timer active")
                  }
                  style={[
                    styles.timerDot,
                    { borderColor: colors.card },
                  ]}
                />
              ) : null}
            </View>
          );
        },
      })}
    >
      {orderedTabs.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={tabOptions[name]}
          listeners={({ navigation }) => ({
            tabPress: (event) => {
              if (name === "log") return;
              const tabState = navigation.getState();
              if (tabState.routes[tabState.index]?.name !== "log") return;
              const guarded = requestLogDraftExit(() =>
                navigation.navigate(name as never),
              );
              if (guarded) event.preventDefault();
            },
          })}
        />
      ))}
      {!orderedTabs.includes("timers") ? (
        <Tabs.Screen
          name="timers"
          options={tabOptions.timers}
          listeners={({ navigation }) => ({
            tabPress: (event) => {
              const tabState = navigation.getState();
              if (tabState.routes[tabState.index]?.name !== "log") return;
              const guarded = requestLogDraftExit(() =>
                navigation.navigate("timers" as never),
              );
              if (guarded) event.preventDefault();
            },
          })}
        />
      ) : null}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 30,
    height: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  compactTabIcon: {
    width: 26,
    height: 21,
  },
  unreadDot: {
    position: "absolute",
    top: 0,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: "#F06A45",
  },
  timerDot: {
    position: "absolute",
    top: 0,
    right: 1,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 2,
    backgroundColor: "#A7F432",
  },
});
