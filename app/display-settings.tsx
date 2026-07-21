import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { LandingPage } from "@/src/types";

const pages: {
  id: LandingPage;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "index", label: "Today", icon: "today-outline" },
  { id: "log", label: "Log", icon: "add-circle-outline" },
  { id: "group", label: "Leaderboard", icon: "people-outline" },
  { id: "insights", label: "Progress", icon: "stats-chart-outline" },
  { id: "chat", label: "Chat", icon: "chatbubbles-outline" },
];
export default function DisplaySettings() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const visible = pages.filter(
    (page) =>
      (page.id !== "group" || state.settings.showLeaderboard) &&
      (page.id !== "chat" || state.settings.showChat),
  );
  function toggle(
    key: "compactMode" | "darkMode" | "showLeaderboard" | "showChat",
    value: boolean,
  ) {
    const changes: Partial<typeof state.settings> = { [key]: value };
    if (
      !value &&
      ((key === "showLeaderboard" &&
        state.settings.defaultLandingPage === "group") ||
        (key === "showChat" && state.settings.defaultLandingPage === "chat"))
    )
      changes.defaultLandingPage = "index";
    updateSettings(changes);
  }
  return (
    <Screen>
      <PageHeader
        title="Display"
        subtitle="Appearance and where North opens."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <SectionHeader title="Layout" />
      <Card style={styles.list}>
        {[
          [
            "compactMode",
            "Compact layout",
            "Fit more information without shrinking the page",
            "contract-outline",
          ],
          [
            "darkMode",
            "Dark mode",
            "Use the complete dark color scheme",
            "moon-outline",
          ],
          [
            "showLeaderboard",
            "Show Leaderboard",
            "Hide it for solo tracking",
            "trophy-outline",
          ],
          [
            "showChat",
            "Show Chat",
            "Hide it for solo tracking",
            "chatbubbles-outline",
          ],
        ].map(([key, title, copy, icon], index) => (
          <View
            key={key}
            style={[
              styles.row,
              index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
            ]}
          >
            <View
              style={[styles.icon, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons
                name={icon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={accent}
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{copy}</Text>
            </View>
            <Switch
              value={Boolean(
                state.settings[key as keyof typeof state.settings],
              )}
              onValueChange={(value) =>
                toggle(
                  key as
                    | "compactMode"
                    | "darkMode"
                    | "showLeaderboard"
                    | "showChat",
                  value,
                )
              }
              trackColor={{ false: colors.border, true: `${accent}88` }}
              thumbColor={
                Boolean(state.settings[key as keyof typeof state.settings])
                  ? accent
                  : colors.faint
              }
            />
          </View>
        ))}
      </Card>
      <SectionHeader title="Today tiles" />
      <Card style={styles.list}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="list-outline" size={18} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Show every tile
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Scroll through all Today tiles instead of using More.
            </Text>
          </View>
          <Switch
            value={state.settings.showAllTodayTiles}
            onValueChange={(showAllTodayTiles) =>
              updateSettings({ showAllTodayTiles })
            }
            trackColor={{ false: colors.border, true: `${accent}88` }}
            thumbColor={
              state.settings.showAllTodayTiles ? accent : colors.faint
            }
          />
        </View>
        {!state.settings.showAllTodayTiles ? (
          <View style={[styles.tileCount, { borderTopColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Tiles before More
            </Text>
            <View style={styles.countChips}>
              {[4, 5, 6].map((count) => (
                <Chip
                  key={count}
                  label={String(count)}
                  selected={(state.settings.todayTileLimit ?? 5) === count}
                  onPress={() => updateSettings({ todayTileLimit: count })}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Card>
      <SectionHeader title="Default landing page" />
      <Card style={styles.pages}>
        {visible.map((page) => (
          <Pressable
            key={page.id}
            onPress={() => updateSettings({ defaultLandingPage: page.id })}
            style={[
              styles.page,
              {
                borderColor:
                  state.settings.defaultLandingPage === page.id
                    ? accent
                    : colors.border,
                backgroundColor:
                  state.settings.defaultLandingPage === page.id
                    ? colors.primarySoft
                    : colors.card,
              },
            ]}
          >
            <Ionicons
              name={page.icon}
              size={20}
              color={
                state.settings.defaultLandingPage === page.id
                  ? accent
                  : colors.muted
              }
            />
            <Text
              style={[
                styles.pageText,
                {
                  color:
                    state.settings.defaultLandingPage === page.id
                      ? accent
                      : colors.ink,
                },
              ]}
            >
              {page.label}
            </Text>
            {state.settings.defaultLandingPage === page.id ? (
              <Ionicons name="checkmark-circle" size={18} color={accent} />
            ) : null}
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
const styles = StyleSheet.create({
  list: { paddingVertical: 2, paddingHorizontal: 11 },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 13, marginTop: 2 },
  pages: { gap: 7 },
  page: {
    height: 45,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  pageText: { flex: 1, fontSize: 11, fontWeight: "900" },
  tileCount: { borderTopWidth: 1, paddingVertical: 10, gap: 8 },
  countChips: { flexDirection: "row", gap: 6 },
});
