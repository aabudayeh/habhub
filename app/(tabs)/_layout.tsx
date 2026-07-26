import { Ionicons } from "@expo/vector-icons";
import { Href, Tabs } from "expo-router";
import React from "react";

import { HapticTab } from "@/components/haptic-tab";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useApp } from "@/src/state/AppProvider";
import { LandingPage } from "@/src/types";

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
};

export default function TabLayout() {
  const accent = useGroupAccent();
  const { state } = useApp();
  const colors = useAppColors();
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
  ];
  const savedOrder = state.settings.tabOrder ?? [];
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
    index: { title: "Today" },
    log: { title: "Log", href: state.settings.showLog ? "/log" : null },
    group: {
      title: "Leaderboard",
      href: state.settings.showLeaderboard ? "/group" : null,
    },
    insights: { title: "Progress" },
    chat: { title: "Chat", href: state.settings.showChat ? "/chat" : null },
    gym: { title: "Gym", href: state.settings.showGym ? "/gym" : null },
    calendar: {
      title: "Schedule",
      href: state.settings.showCalendar ? "/calendar" : null,
    },
    journal: {
      title: "Journal",
      href: state.settings.showJournal ? "/journal" : null,
    },
    performance: {
      title: "Performance",
      href: state.settings.showPerformance ? "/performance" : null,
    },
  };
  return (
    <Tabs
      initialRouteName={state.settings.defaultLandingPage ?? "index"}
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        // Health/chat updates should not recalculate every inactive chart tab.
        freezeOnBlur: true,
        tabBarButton: (props) => (
          <HapticTab {...props} tutorialId={`tab-${route.name}`} />
        ),
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: colors.faint,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: 76,
          paddingTop: 8,
          paddingBottom: 11,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 9, fontWeight: "700" },
        tabBarIcon: ({ color, focused }) => (
          <Ionicons
            name={
              focused
                ? (icons[route.name].replace(
                    "-outline",
                    "",
                  ) as keyof typeof Ionicons.glyphMap)
                : icons[route.name]
            }
            size={23}
            color={color}
          />
        ),
      })}
    >
      {tabOrder.map((name) => (
        <Tabs.Screen key={name} name={name} options={tabOptions[name]} />
      ))}
    </Tabs>
  );
}
