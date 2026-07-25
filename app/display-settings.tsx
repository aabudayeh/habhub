import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";

import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { useApp } from "@/src/state/AppProvider";
import {
  normalizeHexColor,
  THEME_COLOR_CHOICES,
} from "@/src/domain/colors";
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
  { id: "gym", label: "Gym", icon: "barbell-outline" },
  { id: "calendar", label: "Schedule", icon: "calendar-outline" },
  { id: "journal", label: "Journal", icon: "book-outline" },
];
export default function DisplaySettings() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [customColor, setCustomColor] = React.useState(
    state.settings.personalThemeColor ?? accent,
  );
  const normalizedCustomColor = normalizeHexColor(customColor);
  const visible = pages.filter(
    (page) =>
      (page.id !== "log" || state.settings.showLog) &&
      (page.id !== "group" || state.settings.showLeaderboard) &&
      (page.id !== "chat" || state.settings.showChat),
  ).filter(
    (page) =>
      (page.id !== "gym" || state.settings.showGym) &&
      (page.id !== "calendar" || state.settings.showCalendar) &&
      (page.id !== "journal" || state.settings.showJournal),
  );
  function toggle(
    key:
      | "compactMode"
      | "darkMode"
      | "showLog"
      | "showLeaderboard"
      | "showChat"
      | "showGym"
      | "showCalendar"
      | "showJournal"
      | "showTodosToday"
      | "showAiAssistant",
    value: boolean,
  ) {
    const changes: Partial<typeof state.settings> = { [key]: value };
    if (
      !value &&
      ((key === "showLog" && state.settings.defaultLandingPage === "log") ||
        (key === "showLeaderboard" &&
          state.settings.defaultLandingPage === "group") ||
        (key === "showChat" && state.settings.defaultLandingPage === "chat") ||
        (key === "showGym" && state.settings.defaultLandingPage === "gym") ||
        (key === "showCalendar" &&
          state.settings.defaultLandingPage === "calendar") ||
        (key === "showJournal" &&
          state.settings.defaultLandingPage === "journal"))
    )
      changes.defaultLandingPage = "index";
    updateSettings(changes);
  }
  return (
    <Screen>
      <PageHeader
        title="Display"
        subtitle="Appearance and where MetricRally opens."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <SectionHeader title="Colors" />
      <Card style={styles.themeCard}>
        <View style={styles.themeHeading}>
          <View style={[styles.themePreview, { backgroundColor: accent }]} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Personal theme
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Stored in your account only. It never changes the group&apos;s
              color for anyone else.
            </Text>
          </View>
          <Switch
            value={state.settings.overrideGroupTheme === true}
            onValueChange={(overrideGroupTheme) =>
              updateSettings({ overrideGroupTheme })
            }
            trackColor={{ false: colors.border, true: `${accent}88` }}
            thumbColor={
              state.settings.overrideGroupTheme ? accent : colors.faint
            }
          />
        </View>
        <View style={styles.swatches}>
          {THEME_COLOR_CHOICES.map((color) => {
            const selected =
              (state.settings.personalThemeColor ?? "") === color;
            return (
              <Pressable
                key={color}
                accessibilityLabel={`Choose theme color ${color}`}
                onPress={() => {
                  setCustomColor(color);
                  updateSettings({
                    personalThemeColor: color,
                    overrideGroupTheme: true,
                  });
                }}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  selected && {
                    borderColor: colors.ink,
                    transform: [{ scale: 1.08 }],
                  },
                ]}
              >
                {selected ? (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color="#FFFFFF"
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.customColor}>
          <TextInput
            value={customColor}
            onChangeText={setCustomColor}
            autoCapitalize="characters"
            maxLength={7}
            placeholder="#2F6FED"
            placeholderTextColor={colors.faint}
            style={[
              styles.colorInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <Pressable
            disabled={!normalizedCustomColor}
            onPress={() =>
              normalizedCustomColor &&
              updateSettings({
                personalThemeColor: normalizedCustomColor,
                overrideGroupTheme: true,
              })
            }
            style={[
              styles.applyColor,
              {
                backgroundColor: normalizedCustomColor ?? colors.border,
                opacity: normalizedCustomColor ? 1 : 0.55,
              },
            ]}
          >
            <Text style={styles.applyColorText}>Apply</Text>
          </Pressable>
        </View>
        <Text style={[styles.meta, { color: colors.muted }]}>
          Turn the switch off at any time to follow each group&apos;s color
          again.
        </Text>
      </Card>
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
            "showLog",
            "Show Log",
            "Hide the shortcut; logging stays available from tracker pages",
            "add-circle-outline",
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
          [
            "showGym",
            "Show Gym",
            "Pin strength plans and workout logging",
            "barbell-outline",
          ],
          [
            "showTodosToday",
            "Show to-dos on Today",
            "Hide tasks without deleting them",
            "checkbox-outline",
          ],
          [
            "showCalendar",
            "Show Schedule",
            "Calendar for reminders, tasks and tracker prompts",
            "calendar-outline",
          ],
          [
            "showJournal",
            "Show Journal",
            "Search notes collected across the app",
            "book-outline",
          ],
          [
            "showAiAssistant",
            "Show MetRal AI",
            "Floating assistant for logging, setup, reminders, and food-photo estimates",
            "sparkles-outline",
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
                    | "showLog"
                    | "showLeaderboard"
                    | "showChat"
                    | "showGym"
                    | "showCalendar"
                    | "showJournal"
                    | "showTodosToday"
                    | "showAiAssistant",
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
      <SectionHeader title="Calendar" />
      <Card style={styles.fontCard}>
        <Text style={[styles.title, { color: colors.ink }]}>Week starts on</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          Used consistently by weekly charts, summaries, and navigation.
        </Text>
        <View style={styles.countChips}>
          {[
            ["Monday", 1],
            ["Sunday", 0],
            ["Saturday", 6],
          ].map(([label, day]) => (
            <Chip
              key={String(day)}
              label={String(label)}
              selected={(state.settings.weekStartsOn ?? 1) === Number(day)}
              onPress={() =>
                updateSettings({ weekStartsOn: Number(day) as 0 | 1 | 6 })
              }
            />
          ))}
        </View>
      </Card>
      <SectionHeader title="Text size" />
      <Card style={styles.fontCard}>
        <Text style={[styles.meta, { color: colors.muted }]}>Applies consistently across every page.</Text>
        <View style={styles.countChips}>
          {[
            ["Standard", 1],
            ["Large", 1.12],
            ["Extra large", 1.25],
          ].map(([label, scale]) => (
            <Chip
              key={String(scale)}
              label={String(label)}
              selected={Math.abs((state.settings.fontScale ?? 1) - Number(scale)) < 0.01}
              onPress={() => updateSettings({ fontScale: Number(scale) })}
            />
          ))}
        </View>
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
        <View style={[styles.tileCount, { borderTopColor: colors.border }]}>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Completed goals
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Keep completed goals at the bottom or hide them from Today.
            </Text>
          </View>
          <View style={styles.countChips}>
            {(["bottom", "hide"] as const).map((behavior) => (
              <Chip
                key={behavior}
                label={behavior === "bottom" ? "Move down" : "Hide"}
                selected={
                  (state.settings.completedTodayBehavior ?? "bottom") ===
                  behavior
                }
                onPress={() =>
                  updateSettings({ completedTodayBehavior: behavior })
                }
              />
            ))}
          </View>
        </View>
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
  fontCard: { gap: 9 },
  themeCard: { gap: 12 },
  themeHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  themePreview: { width: 38, height: 38, borderRadius: 14 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  customColor: { flexDirection: "row", gap: 8 },
  colorInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 12,
    fontWeight: "800",
  },
  applyColor: {
    minWidth: 82,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  applyColorText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
});
