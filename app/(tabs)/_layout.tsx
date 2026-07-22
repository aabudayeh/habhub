import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";

import { HapticTab } from "@/components/haptic-tab";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useApp } from "@/src/state/AppProvider";

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "today-outline",
  log: "add-circle-outline",
  group: "people-outline",
  insights: "stats-chart-outline",
  chat: "chatbubbles-outline",
  gym: "barbell-outline",
};

export default function TabLayout() {
  const accent = useGroupAccent();
  const { state } = useApp();
  const colors = useAppColors();
  return (
    <Tabs
      initialRouteName={state.settings.defaultLandingPage ?? "index"}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarButton: HapticTab,
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
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="log" options={{ title: "Log" }} />
      <Tabs.Screen
        name="group"
        options={{
          title: "Leaderboard",
          href: state.settings.showLeaderboard ? "/group" : null,
        }}
      />
      <Tabs.Screen name="insights" options={{ title: "Progress" }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          href: state.settings.showChat ? "/chat" : null,
        }}
      />
      <Tabs.Screen
        name="gym"
        options={{ title: "Gym", href: state.settings.showGym ? "/gym" : null }}
      />
    </Tabs>
  );
}
