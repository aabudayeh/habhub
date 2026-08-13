import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { ColorSpectrumPicker } from "@/src/components/ColorSpectrumPicker";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { isAllowedThemeColor, normalizeHexColor } from "@/src/domain/colors";
import { COMPLETION_INDICATOR_OPTIONS } from "@/src/domain/completionIndicators";
import { supportedLanguages, useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  AppLanguage,
  LandingPage,
  ProgressLayoutAvailability,
  StatusAvatarStyle,
} from "@/src/types";

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
  { id: "gym", label: "Workout", icon: "barbell-outline" },
  { id: "calendar", label: "Schedule", icon: "calendar-outline" },
  { id: "journal", label: "Journal", icon: "book-outline" },
  { id: "performance", label: "Performance", icon: "speedometer-outline" },
  { id: "status", label: "Status", icon: "accessibility-outline" },
];

const languages = supportedLanguages.map(({ id, label, nativeLabel }) => ({
  id,
  label: nativeLabel,
  sublabel: nativeLabel === label ? undefined : label,
  icon: "language-outline" as const,
}));

type ToggleKey =
  | "compactMode"
  | "darkMode"
  | "showLog"
  | "showLeaderboard"
  | "showChat"
  | "showGym"
  | "showCalendar"
  | "showJournal"
  | "showCalendarShortcut"
  | "showJournalShortcut"
  | "showPerformance"
  | "showStatus"
  | "showTodosToday"
  | "showGoalsToday"
  | "showAiAssistant";

export default function DisplaySettings() {
  const { state, updateSettings } = useApp();
  const tutorial = useTutorial();
  const { t } = useLocalization();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [customColor, setCustomColor] = React.useState(
    state.settings.personalThemeColor ?? accent,
  );
  const [colorOpen, setColorOpen] = React.useState(false);
  const [generalOpen, setGeneralOpen] = React.useState(false);
  const [pagesOpen, setPagesOpen] = React.useState(false);
  const [todayOpen, setTodayOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [indicatorOpen, setIndicatorOpen] = React.useState(false);
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  React.useEffect(() => {
    if (tutorial.activeStep?.target === "display-layout") setGeneralOpen(true);
  }, [tutorial.activeStep?.target]);
  const normalizedCustomColor = normalizeHexColor(customColor);
  const allowedCustomColor =
    normalizedCustomColor && isAllowedThemeColor(normalizedCustomColor)
      ? normalizedCustomColor
      : undefined;
  const visible = pages.filter(
    (page) =>
      (page.id !== "log" || state.settings.showLog) &&
      (page.id !== "group" || state.settings.showLeaderboard) &&
      (page.id !== "chat" || state.settings.showChat) &&
      (page.id !== "gym" || state.settings.showGym) &&
      (page.id !== "calendar" || state.settings.showCalendar) &&
      (page.id !== "journal" || state.settings.showJournal) &&
      (page.id !== "performance" || state.settings.showPerformance) &&
      (page.id !== "status" || state.settings.showStatus),
  );
  const navigationOrder = React.useMemo(() => {
    const saved = state.settings.tabOrder ?? [];
    const valid = saved.filter(
      (id, index) =>
        pages.some((page) => page.id === id) && saved.indexOf(id) === index,
    );
    return [
      ...valid,
      ...pages.map((page) => page.id).filter((id) => !valid.includes(id)),
    ];
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

  function toggle(key: ToggleKey, value: boolean) {
    const changes: Partial<typeof state.settings> = { [key]: value };
    const hiddenLandingPage: Partial<Record<ToggleKey, LandingPage>> = {
      showLog: "log",
      showLeaderboard: "group",
      showChat: "chat",
      showGym: "gym",
      showCalendar: "calendar",
      showJournal: "journal",
      showPerformance: "performance",
      showStatus: "status",
    };
    if (
      !value &&
      hiddenLandingPage[key] === state.settings.defaultLandingPage
    )
      changes.defaultLandingPage = "index";
    updateSettings(changes);
  }

  return (
    <Screen>
      <PageHeader
        title="Display"
        subtitle="Appearance and where HabHub opens."
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />

      <TutorialTarget id="personal-theme">
        <Card style={styles.themeCard}>
          <Pressable
            onPress={() => setColorOpen((open) => !open)}
            style={styles.headingRow}
          >
            <View style={[styles.themePreview, { backgroundColor: accent }]} />
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>Personal theme</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>Your color or the current group color</Text>
            </View>
            <Switch
              value={state.settings.overrideGroupTheme === true}
              onValueChange={(overrideGroupTheme) =>
                updateSettings({ overrideGroupTheme })
              }
              trackColor={{ false: colors.border, true: `${accent}88` }}
              thumbColor={state.settings.overrideGroupTheme ? accent : colors.faint}
            />
            <Ionicons
              name={colorOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.faint}
            />
          </Pressable>
          {colorOpen ? (
            <View style={styles.colorBody}>
              <ColorSpectrumPicker
                value={state.settings.personalThemeColor ?? accent}
                onChange={(personalThemeColor) => {
                  setCustomColor(personalThemeColor);
                  updateSettings({ personalThemeColor, overrideGroupTheme: true });
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
                  <Text preserveColor style={styles.applyColorText}>Apply</Text>
                </Pressable>
              </View>
              {normalizedCustomColor && !allowedCustomColor ? (
                <Text style={[styles.meta, { color: "#D24B4B" }]}>That color is reserved for completion feedback.</Text>
              ) : null}
              <Pressable
                onPress={() => {
                  setCustomColor(palette.primary);
                  updateSettings({
                    personalThemeColor: palette.primary,
                    overrideGroupTheme: true,
                  });
                }}
                style={[styles.defaultTheme, { borderColor: colors.border }]}
              >
                <View style={[styles.defaultThemeDot, { backgroundColor: palette.primary }]} />
                <Text style={[styles.defaultThemeText, { color: colors.ink }]}>Use HabHub default</Text>
              </Pressable>
              <Text style={[styles.meta, { color: colors.muted }]}>Turn override off to follow the group. Completion colors stay reserved and contrast is adjusted automatically.</Text>
            </View>
          ) : null}
        </Card>
      </TutorialTarget>

      <CollapsibleSection
        title="General"
        copy="Language, theme mode, text, calendar, time, and startup page"
        open={generalOpen}
        onPress={() => setGeneralOpen((open) => !open)}
      >
        <TutorialTarget id="display-layout">
          <Card style={styles.list}>
            <SelectionMenu
              title="Language"
              icon="language-outline"
              items={languages}
              selectedIds={[state.settings.language ?? "en"]}
              onChange={([value]) =>
                value && updateSettings({ language: value as AppLanguage })
              }
              multiple={false}
              searchable={false}
            />
            <ToggleRow
              icon="contract-outline"
              title="Compact layout"
              copy="Fit more information on each screen"
              enabled={state.settings.compactMode}
              onChange={(value) => toggle("compactMode", value)}
            />
            <ToggleRow
              icon="moon-outline"
              title="Dark mode"
              copy="Use the full dark color scheme"
              enabled={state.settings.darkMode}
              onChange={(value) => toggle("darkMode", value)}
            />
            <SelectionMenu
              title="Text size"
              items={[
                { id: "1", label: "Standard", icon: "text-outline" },
                { id: "1.12", label: "Large", icon: "text-outline" },
                { id: "1.25", label: "Extra large", icon: "text-outline" },
              ]}
              selectedIds={[String(state.settings.fontScale ?? 1)]}
              onChange={([value]) => value && updateSettings({ fontScale: Number(value) })}
              multiple={false}
              searchable={false}
            />
            <SelectionMenu
              title="Week starts on"
              items={[
                { id: "1", label: "Monday", icon: "calendar-outline" },
                { id: "0", label: "Sunday", icon: "calendar-outline" },
                { id: "6", label: "Saturday", icon: "calendar-outline" },
              ]}
              selectedIds={[String(state.settings.weekStartsOn ?? 1)]}
              onChange={([value]) =>
                value && updateSettings({ weekStartsOn: Number(value) as 0 | 1 | 6 })
              }
              multiple={false}
              searchable={false}
            />
            <SelectionMenu
              title="Time format"
              items={[
                { id: "24h", label: "24 hour", icon: "time-outline" },
                { id: "12h", label: "AM / PM", icon: "time-outline" },
              ]}
              selectedIds={[state.settings.timeFormat ?? "24h"]}
              onChange={([value]) =>
                value && updateSettings({ timeFormat: value as "12h" | "24h" })
              }
              multiple={false}
              searchable={false}
            />
            <SelectionMenu
              title="Default landing page"
              items={visible.map((page) => ({
                id: page.id,
                label: page.label,
                icon: page.icon,
              }))}
              selectedIds={[state.settings.defaultLandingPage ?? "index"]}
              onChange={([value]) =>
                value && updateSettings({ defaultLandingPage: value as LandingPage })
              }
              multiple={false}
              searchable={false}
            />
          </Card>
        </TutorialTarget>
      </CollapsibleSection>

      <CollapsibleSection
        title="Show pages"
        copy="Keep only the pages you use in navigation"
        open={pagesOpen}
        onPress={() => setPagesOpen((open) => !open)}
      >
        <Card style={styles.list}>
          {(
            [
              ["showLog", "Log", "Logging remains available from tracker pages", "add-circle-outline"],
              ["showLeaderboard", "Leaderboard", "Group rankings and comparisons", "trophy-outline"],
              ["showChat", "Chat", "Group and direct conversations", "chatbubbles-outline"],
              ["showGym", "Workout", "Exercise plans and workout logging", "barbell-outline"],
              ["showCalendar", "Schedule", "Reminders, tasks, and prompts", "calendar-outline"],
              ["showJournal", "Journal", "Notes collected across the app", "book-outline"],
              ["showPerformance", "Performance", "Strengths, trends, and focus areas", "speedometer-outline"],
              ["showStatus", "Status", "A visual dashboard around your tracked goals", "accessibility-outline"],
              ["showAiAssistant", "MetRal AI", "Floating logging and setup assistant", "sparkles-outline"],
            ] as [ToggleKey, string, string, keyof typeof Ionicons.glyphMap][]
          ).map(([key, title, copy, icon]) => (
            <ToggleRow
              key={key}
              icon={icon}
              title={title}
              copy={copy}
              enabled={Boolean(state.settings[key])}
              onChange={(value) => toggle(key, value)}
            />
          ))}
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Today tiles"
        copy="Completion symbol, tasks, shortcuts, and completed items"
        open={todayOpen}
        onPress={() => setTodayOpen((open) => !open)}
      >
        <Card style={styles.list}>
          <Pressable onPress={() => setIndicatorOpen((open) => !open)} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons
                name={(state.settings.completionIndicatorIcon ?? "ellipse-outline") as keyof typeof Ionicons.glyphMap}
                size={18}
                color={accent}
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>Completion symbol</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>Symbol and fill direction in Today&apos;s focus</Text>
            </View>
            <Ionicons name={indicatorOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.faint} />
          </Pressable>
          {indicatorOpen ? (
            <View style={[styles.symbolBody, { borderTopColor: colors.border }]}>
              <View style={styles.symbolGrid}>
                {COMPLETION_INDICATOR_OPTIONS.map(({ icon, label }) => {
                  const selected =
                    (state.settings.completionIndicatorIcon ??
                      "ellipse-outline") === icon;
                  return (
                    <Pressable
                      key={icon}
                      accessibilityLabel={t(label)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => updateSettings({ completionIndicatorIcon: icon })}
                      style={[
                        styles.symbol,
                        {
                          borderColor: selected ? accent : colors.border,
                          backgroundColor: selected ? colors.primarySoft : colors.canvas,
                        },
                      ]}
                    >
                      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={21} color={selected ? accent : colors.muted} />
                    </Pressable>
                  );
                })}
              </View>
              <SelectionMenu
                title="Fill direction"
                items={[
                  { id: "auto", label: "Automatic", icon: "sparkles-outline" },
                  { id: "clockwise", label: "Clockwise", icon: "refresh-outline" },
                  { id: "bottom_up", label: "Bottom up", icon: "arrow-up-outline" },
                  { id: "center_out", label: "Center out", icon: "expand-outline" },
                ]}
                selectedIds={[state.settings.completionIndicatorFillMode ?? "auto"]}
                onChange={([value]) =>
                  value && updateSettings({ completionIndicatorFillMode: value as "auto" | "clockwise" | "bottom_up" | "center_out" })
                }
                multiple={false}
                searchable={false}
              />
            </View>
          ) : null}
          <ToggleRow
            icon="scan-outline"
            title="Progress outline"
            copy="Show progress around the featured card"
            enabled={state.settings.showFeaturedCardProgressOutline !== false}
            onChange={(showFeaturedCardProgressOutline) =>
              updateSettings({ showFeaturedCardProgressOutline })
            }
          />
          <ToggleRow
            icon="list-outline"
            title="Show every tile"
            copy="Scroll through all Today tiles instead of using More"
            enabled={Boolean(state.settings.showAllTodayTiles)}
            onChange={(showAllTodayTiles) => updateSettings({ showAllTodayTiles })}
          />
          {!state.settings.showAllTodayTiles ? (
            <View style={[styles.optionBlock, { borderTopColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.ink }]}>Tiles before More</Text>
              <View style={styles.chips}>
                {[4, 5, 6].map((count) => (
                  <Chip key={count} label={String(count)} selected={(state.settings.todayTileLimit ?? 5) === count} onPress={() => updateSettings({ todayTileLimit: count })} />
                ))}
              </View>
            </View>
          ) : null}
          <SelectionMenu
            title="Completed items"
            items={[
              { id: "stay", label: "Do nothing", icon: "remove-outline" },
              { id: "bottom", label: "Move down", icon: "arrow-down-outline" },
              { id: "hide", label: "Hide", icon: "eye-off-outline" },
            ]}
            selectedIds={[state.settings.completedTodayBehavior ?? "bottom"]}
            onChange={([value]) =>
              value && updateSettings({ completedTodayBehavior: value as "stay" | "bottom" | "hide" })
            }
            multiple={false}
            searchable={false}
          />
          <SelectionMenu
            title="To-do placement"
            items={[
              { id: "above", label: "Above goals", icon: "arrow-up-outline" },
              { id: "below", label: "Below goals", icon: "arrow-down-outline" },
            ]}
            selectedIds={[state.settings.todosBelowGoals ? "below" : "above"]}
            onChange={([value]) => value && updateSettings({ todosBelowGoals: value === "below" })}
            multiple={false}
            searchable={false}
          />
          <ToggleRow
            icon="albums-outline"
            title="Show trackers"
            copy="Hide all tracker tiles without changing goals or history"
            enabled={state.settings.showGoalsToday !== false}
            onChange={(value) => toggle("showGoalsToday", value)}
          />
          <ToggleRow
            icon="checkbox-outline"
            title="Show to-dos"
            copy="Hide tasks without deleting them"
            enabled={state.settings.showTodosToday !== false}
            onChange={(value) => toggle("showTodosToday", value)}
          />
          <ToggleRow
            icon="calendar-clear-outline"
            title="Schedule shortcut"
            copy="Show a Schedule icon in the Today header"
            enabled={state.settings.showCalendarShortcut !== false}
            onChange={(value) => toggle("showCalendarShortcut", value)}
          />
          <ToggleRow
            icon="book-outline"
            title="Journal shortcut"
            copy="Show a Journal icon in the Today header"
            enabled={state.settings.showJournalShortcut !== false}
            onChange={(value) => toggle("showJournalShortcut", value)}
          />
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced"
        copy="Progress layouts and navigation order"
        open={advancedOpen}
        onPress={() => setAdvancedOpen((open) => !open)}
      >
        <Card style={styles.list}>
          <SelectionMenu
            title="Status avatar style"
            items={[
              {
                id: "silhouette",
                label: "Clean silhouette",
                icon: "person-outline",
              },
              {
                id: "body_model",
                label: "Detailed body model",
                icon: "fitness-outline",
              },
            ]}
            selectedIds={[state.settings.statusAvatarStyle ?? "silhouette"]}
            onChange={([value]) =>
              value &&
              updateSettings({ statusAvatarStyle: value as StatusAvatarStyle })
            }
            multiple={false}
            searchable={false}
          />
          <SelectionMenu
            title="Progress layouts"
            items={[
              { id: "overview", label: "Overview only", icon: "stats-chart-outline" },
              { id: "goal_maps", label: "Grid map only", icon: "grid-outline" },
              { id: "both", label: "Overview and Grid map", icon: "albums-outline" },
            ]}
            selectedIds={[state.settings.progressLayoutAvailability ?? "both"]}
            onChange={([value]) => {
              if (!value) return;
              const availability = value as ProgressLayoutAvailability;
              updateSettings({
                progressLayoutAvailability: availability,
                ...(availability === "overview"
                  ? { progressViewMode: "overview" as const }
                  : availability === "goal_maps"
                    ? { progressViewMode: "goal_maps" as const }
                    : {}),
              });
            }}
            multiple={false}
            searchable={false}
          />
          <Pressable
            onPress={() => setNavigationOpen((open) => !open)}
            style={[styles.row, styles.navigationHeading]}
          >
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="reorder-three-outline" size={20} color={accent} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>Navigation order</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>Order enabled tabs along the bottom</Text>
            </View>
            <Ionicons name={navigationOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.faint} />
          </Pressable>
          {navigationOpen
            ? visibleNavigationOrder.map((id, index) => {
                const page = pages.find((item) => item.id === id)!;
                return (
                  <View key={id} style={[styles.navigationRow, { borderTopColor: colors.border }]}>
                    <Ionicons name={page.icon} size={18} color={accent} />
                    <Text style={[styles.pageText, { color: colors.ink }]}>{page.label}</Text>
                    <Pressable accessibilityLabel={`Move ${page.label} up`} disabled={index === 0} onPress={() => moveNavigationItem(id, -1)} style={styles.orderButton}>
                      <Ionicons name="arrow-up" size={17} color={index === 0 ? colors.faint : colors.ink} />
                    </Pressable>
                    <Pressable accessibilityLabel={`Move ${page.label} down`} disabled={index === visibleNavigationOrder.length - 1} onPress={() => moveNavigationItem(id, 1)} style={styles.orderButton}>
                      <Ionicons name="arrow-down" size={17} color={index === visibleNavigationOrder.length - 1 ? colors.faint : colors.ink} />
                    </Pressable>
                  </View>
                );
              })
            : null}
        </Card>
      </CollapsibleSection>

      <TutorialTarget id="display-widgets-info">
        <Card style={styles.widgetInfo}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="accessibility-outline" size={19} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>Status Avatar widget</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{"On Android, add it from the launcher's widget picker. HabHub refreshes it from the latest app snapshot."}</Text>
          </View>
          <Ionicons name="phone-portrait-outline" size={18} color={colors.faint} />
        </Card>
      </TutorialTarget>
    </Screen>
  );
}

function CollapsibleSection({
  title,
  copy,
  open,
  onPress,
  children,
}: React.PropsWithChildren<{
  title: string;
  copy: string;
  open: boolean;
  onPress: () => void;
}>) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <View>
      <Pressable onPress={onPress} style={[styles.sectionHeading, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.copy}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{copy}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={accent} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function ToggleRow({
  icon,
  title,
  copy,
  enabled,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>{copy}</Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: `${accent}88` }}
        thumbColor={enabled ? accent : colors.faint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 7, paddingVertical: 7, paddingHorizontal: 10 },
  row: {
    minHeight: 55,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 10, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  sectionHeading: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  sectionTitle: { fontSize: 11, fontWeight: "900" },
  sectionBody: { paddingTop: 7 },
  themeCard: { gap: 10 },
  themePreview: { width: 36, height: 36, borderRadius: 12 },
  colorBody: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "transparent", paddingTop: 4 },
  customColor: { flexDirection: "row", gap: 7 },
  colorInput: { flex: 1, height: 41, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 11, fontWeight: "800" },
  applyColor: { minWidth: 78, height: 41, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  applyColorText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  defaultTheme: { minHeight: 39, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  defaultThemeDot: { width: 18, height: 18, borderRadius: 6 },
  defaultThemeText: { fontSize: 9, fontWeight: "900" },
  symbolBody: { borderTopWidth: 1, paddingTop: 8, gap: 8 },
  symbolGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  symbol: { width: 40, height: 40, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  optionBlock: { borderTopWidth: 1, paddingVertical: 8, gap: 7 },
  chips: { flexDirection: "row", gap: 6 },
  navigationRow: { minHeight: 44, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  navigationHeading: { borderBottomWidth: 0 },
  widgetInfo: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  pageText: { flex: 1, fontSize: 10, fontWeight: "900" },
  orderButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
