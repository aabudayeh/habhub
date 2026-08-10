import { Ionicons } from "@expo/vector-icons";
import { Href, Tabs } from "expo-router";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { HapticTab } from "@/components/haptic-tab";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useApp } from "@/src/state/AppProvider";
import { LandingPage } from "@/src/types";
import { useTranslation } from "@/src/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
};

export default function TabLayout() {
  const accent = useGroupAccent();
  const { state } = useApp();
  const colors = useAppColors();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
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
  const defaultOrder: LandingPage[] = [
    "index",
    "log",
    "group",
    "insights",
    "chat",
    "gym",
    "calendar",
    "journal",
    "performance",
    "status",
  ];
  const savedOrder = state.settings.tabOrder ?? [];
  const showLog = state.settings.showLog !== false;
  const showLeaderboard = state.settings.showLeaderboard !== false;
  const showChat = state.settings.showChat !== false;
  const showGym = state.settings.showGym !== false;
  const showCalendar = state.settings.showCalendar !== false;
  const showJournal = state.settings.showJournal !== false;
  const showPerformance = state.settings.showPerformance !== false;
  const showStatus = state.settings.showStatus === true;
  const tabOrder = [
    ...savedOrder.filter(
      (id, index) =>
        defaultOrder.includes(id) && savedOrder.indexOf(id) === index,
    ),
    ...defaultOrder.filter((id) => !savedOrder.includes(id)),
  ];
  const tabOptions: Record<
    LandingPage,
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
    status: {
      title: t("Status"),
      href: showStatus ? ("/status" as Href) : null,
    },
  };
  const isVisible = (name: LandingPage) => tabOptions[name].href !== null;
  const orderedTabs = tabOrder;
  const requestedDefault = state.settings.defaultLandingPage ?? "index";
  const defaultTab: LandingPage = isVisible(requestedDefault)
    ? requestedDefault
    : orderedTabs.find(isVisible) ?? "index";
  return (
    <Tabs
      initialRouteName={defaultTab}
      // Inactive native trees must not keep drawing charts/lists behind the
      // visible page. Routes stay mounted so their local navigation state is
      // preserved, while React Navigation detaches and freezes their views.
      detachInactiveScreens
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        tabBarButton: isVisible(route.name as LandingPage)
          ? (props) => (
              <HapticTab {...props} tutorialId={`tab-${route.name}`} />
            )
          : () => null,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: colors.faint,
        tabBarHideOnKeyboard: true,
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
          height: 66 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(6, insets.bottom),
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 9, fontWeight: "700" },
        tabBarIcon: ({ color, focused }) => {
          const icon = icons[route.name];
          return (
            <View style={styles.tabIcon}>
              <Ionicons
                name={
                  focused
                    ? (icon.replace(
                        "-outline",
                        "",
                      ) as keyof typeof Ionicons.glyphMap)
                    : icon
                }
                size={23}
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
            </View>
          );
        },
      })}
    >
      {orderedTabs.map((name) => (
        <Tabs.Screen key={name} name={name} options={tabOptions[name]} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 30,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
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
});
