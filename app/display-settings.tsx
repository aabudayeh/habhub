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
import { ColorSpectrumPicker } from "@/src/components/ColorSpectrumPicker";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { useApp } from "@/src/state/AppProvider";
import {
  isAllowedThemeColor,
  normalizeHexColor,
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
  { id: "performance", label: "Performance", icon: "speedometer-outline" },
];
export default function DisplaySettings() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [customColor, setCustomColor] = React.useState(
    state.settings.personalThemeColor ?? accent,
  );
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  const [indicatorOpen, setIndicatorOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const normalizedCustomColor = normalizeHexColor(customColor);
  const allowedCustomColor =
    normalizedCustomColor && isAllowedThemeColor(normalizedCustomColor)
      ? normalizedCustomColor
      : undefined;
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
  ).filter(
    (page) => page.id !== "performance" || state.settings.showPerformance,
  );
  const navigationOrder = React.useMemo(() => {
    const saved = state.settings.tabOrder ?? [];
    const valid = saved.filter(
      (id, index) =>
        pages.some((page) => page.id === id) && saved.indexOf(id) === index,
    );
    return [...valid, ...pages.map((page) => page.id).filter((id) => !valid.includes(id))];
  }, [state.settings.tabOrder]);
  const visibleNavigationOrder = navigationOrder.filter((id) =>
    visible.some((page) => page.id === id),
  );
  function moveNavigationItem(id: LandingPage, direction: -1 | 1) {
    const current = [...navigationOrder];
    const visibleFrom = visibleNavigationOrder.indexOf(id);
    const visibleTo = visibleFrom + direction;
    if (
      visibleFrom < 0 ||
      visibleTo < 0 ||
      visibleTo >= visibleNavigationOrder.length
    )
      return;
    const from = current.indexOf(id);
    const to = current.indexOf(visibleNavigationOrder[visibleTo]);
    [current[from], current[to]] = [current[to], current[from]];
    updateSettings({ tabOrder: current });
  }
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
      | "showPerformance"
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
          state.settings.defaultLandingPage === "journal") ||
        (key === "showPerformance" &&
          state.settings.defaultLandingPage === "performance"))
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
      <TutorialTarget id="personal-theme">
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
        <ColorSpectrumPicker
          value={state.settings.personalThemeColor ?? accent}
          onChange={(personalThemeColor) => {
            setCustomColor(personalThemeColor);
            updateSettings({
              personalThemeColor,
              overrideGroupTheme: true,
            });
          }}
        />
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
            disabled={!allowedCustomColor}
            onPress={() =>
              allowedCustomColor &&
              updateSettings({
                personalThemeColor: allowedCustomColor,
                overrideGroupTheme: true,
              })
            }
            style={[
              styles.applyColor,
              {
                backgroundColor: allowedCustomColor ?? colors.border,
                opacity: allowedCustomColor ? 1 : 0.55,
              },
            ]}
          >
            <Text style={styles.applyColorText}>Apply</Text>
          </Pressable>
        </View>
        {normalizedCustomColor && !allowedCustomColor ? (
          <Text style={[styles.meta, { color: "#D24B4B" }]}>
            That color is reserved for goal-completion feedback.
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: colors.muted }]}>
          Turn the switch off at any time to follow each group&apos;s color
          again. Lime and gold stay reserved for completion feedback.
        </Text>
      </Card>
      </TutorialTarget>
      <SectionHeader title="Layout" />
      <TutorialTarget id="display-layout">
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
            "showPerformance",
            "Show Performance",
            "At-a-glance strengths, trends, and areas to improve",
            "speedometer-outline",
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
                    | "showPerformance"
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
      </TutorialTarget>
      <Pressable
        onPress={() => setAdvancedOpen((open) => !open)}
        style={[
          styles.advancedHeading,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>
            Advanced display
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Calendar, text size, Today behavior, landing page, and tab order
          </Text>
        </View>
        <Ionicons
          name={advancedOpen ? "chevron-up" : "chevron-down"}
          size={18}
          color={accent}
        />
      </Pressable>
      {advancedOpen ? (
        <>
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
        <Text style={[styles.title, { color: colors.ink }]}>Time format</Text>
        <View style={styles.countChips}>
          <Chip
            label="24 hour"
            selected={(state.settings.timeFormat ?? "24h") === "24h"}
            onPress={() => updateSettings({ timeFormat: "24h" })}
          />
          <Chip
            label="AM / PM"
            selected={state.settings.timeFormat === "12h"}
            onPress={() => updateSettings({ timeFormat: "12h" })}
          />
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
        <Pressable
          onPress={() => setIndicatorOpen((open) => !open)}
          style={styles.row}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons
              name={
                (state.settings.completionIndicatorIcon ??
                  "ellipse-outline") as keyof typeof Ionicons.glyphMap
              }
              size={18}
              color={accent}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Completion symbol
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Choose the symbol in Today&apos;s focus.
            </Text>
          </View>
          <Ionicons
            name={indicatorOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.faint}
          />
        </Pressable>
        {indicatorOpen ? (
          <View
            style={[styles.symbolGrid, { borderTopColor: colors.border }]}
          >
            {[
              "ellipse-outline",
              "square-outline",
              "flash-outline",
              "happy-outline",
              "beer-outline",
              "cafe-outline",
              "heart-outline",
              "star-outline",
            ].map((icon) => {
              const selected =
                (state.settings.completionIndicatorIcon ??
                  "ellipse-outline") === icon;
              return (
                <Pressable
                  key={icon}
                  onPress={() =>
                    updateSettings({ completionIndicatorIcon: icon })
                  }
                  style={[
                    styles.symbol,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected
                        ? colors.primarySoft
                        : colors.canvas,
                    },
                  ]}
                >
                  <Ionicons
                    name={icon as keyof typeof Ionicons.glyphMap}
                    size={21}
                    color={selected ? accent : colors.muted}
                  />
                </Pressable>
              );
            })}
          </View>
        ) : null}
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
        <View style={[styles.tileCount, { borderTopColor: colors.border }]}>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>To-do placement</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Put tasks above or below your tracker cards.
            </Text>
          </View>
          <View style={styles.countChips}>
            <Chip
              label="Above goals"
              selected={state.settings.todosBelowGoals !== true}
              onPress={() => updateSettings({ todosBelowGoals: false })}
            />
            <Chip
              label="Below goals"
              selected={state.settings.todosBelowGoals === true}
              onPress={() => updateSettings({ todosBelowGoals: true })}
            />
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
      <SectionHeader title="Navigation" />
      <Card style={styles.list}>
        <Pressable
          onPress={() => setNavigationOpen((open) => !open)}
          style={styles.row}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="reorder-three-outline" size={20} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Navigation order
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Choose how enabled tabs appear along the bottom.
            </Text>
          </View>
          <Ionicons
            name={navigationOpen ? "chevron-up" : "chevron-down"}
            size={19}
            color={colors.faint}
          />
        </Pressable>
        {navigationOpen
          ? visibleNavigationOrder.map((id, index) => {
              const page = pages.find((item) => item.id === id)!;
              return (
                <View
                  key={id}
                  style={[
                    styles.navigationRow,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <Ionicons name={page.icon} size={18} color={accent} />
                  <Text style={[styles.pageText, { color: colors.ink }]}>
                    {page.label}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Move ${page.label} left`}
                    disabled={index === 0}
                    onPress={() => moveNavigationItem(id, -1)}
                    style={styles.orderButton}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={17}
                      color={index === 0 ? colors.faint : colors.ink}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Move ${page.label} right`}
                    disabled={index === visibleNavigationOrder.length - 1}
                    onPress={() => moveNavigationItem(id, 1)}
                    style={styles.orderButton}
                  >
                    <Ionicons
                      name="arrow-down"
                      size={17}
                      color={
                        index === visibleNavigationOrder.length - 1
                          ? colors.faint
                          : colors.ink
                      }
                    />
                  </Pressable>
                </View>
              );
            })
          : null}
      </Card>
        </>
      ) : null}
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
  navigationRow: {
    minHeight: 46,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  orderButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  tileCount: { borderTopWidth: 1, paddingVertical: 10, gap: 8 },
  symbolGrid: {
    borderTopWidth: 1,
    paddingVertical: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  symbol: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
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
  advancedHeading: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
