import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/src/components/ui";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import { memberDisplayName, memberOriginalLabel } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, shadow, useAppColors, useGroupAccent } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

const destinations = [
  { label: "Workout", icon: "barbell-outline", path: "/gym" },
  { label: "Challenges", icon: "trophy-outline", path: "/challenges" },
  { label: "Badges", icon: "ribbon-outline", path: "/badges" },
  { label: "Schedule", icon: "calendar-outline", path: "/calendar" },
  { label: "Journal", icon: "book-outline", path: "/journal" },
  { label: "Performance", icon: "stats-chart-outline", path: "/performance" },
] as const;

const items = [
  {
    label: "Cloud account & health sync",
    detail: "Backup, restore and device sync preferences",
    icon: "cloud-outline" as const,
    path: "/settings" as const,
  },
  {
    label: "Notifications",
    detail: "Goal activity, chat, badges and quiet hours",
    icon: "notifications-outline" as const,
    path: "/notifications" as const,
  },
  {
    label: "Display",
    detail: "Layout, dark mode, visible tabs and landing page",
    icon: "phone-portrait-outline" as const,
    path: "/display-settings" as const,
  },
  {
    label: "Groups",
    detail: "Switch, invite, join, or manage group scoring",
    icon: "people-outline" as const,
    path: "/groups" as const,
  },
  {
    label: "Legal & support",
    detail: "Policies, community safety, account help and support",
    icon: "shield-checkmark-outline" as const,
    path: "/legal-support" as const,
  },
  {
    label: "Quick guide",
    detail: "Interactive guides for every page and settings",
    icon: "help-circle-outline" as const,
    path: "/quick-guide" as const,
  },
  {
    label: "Customize trackers",
    detail: "Trackers, calculations, layouts and scoring",
    icon: "options-outline" as const,
    path: "/customize" as const,
  },
];

const NATIVE_MENU_DISMISS_MS = 320;

export default function MenuScreen() {
  const tutorial = useTutorial();
  const tutorialSandbox = useTutorialSandboxActive();
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleDestinations = destinations.filter((item) =>
    t(item.label).toLocaleLowerCase().includes(normalizedQuery),
  );
  const visibleItems = items.filter((item) =>
    `${t(item.label)} ${t(item.detail)}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const user = state.group.members.find(
    (member) => member.id === state.currentUserId,
  )!;
  const destinationOpeningRef = React.useRef(false);
  const closeSwipe = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          gesture.dx > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx >= 55) router.back();
        },
      }),
    [],
  );
  const openItem = React.useCallback(
    (path: (typeof items)[number]["path"] | (typeof destinations)[number]["path"]) => {
      if (destinationOpeningRef.current) return;
      destinationOpeningRef.current = true;
      const actionId =
        path === "/customize"
          ? "tutorial.navigation.open-customize"
          : path === "/display-settings"
            ? "tutorial.navigation.open-display"
            : undefined;
      const openDestination = () => {
        router.navigate(path as never);
        if (actionId)
          tutorial.reportEvent({
            actionId,
            scope: "isolated-preview",
          });
      };
      // Close the transparent drawer before presenting the destination modal.
      // Advance the guide only when the one real destination navigation runs.
      // That prevents the engine from trying to open the next route while the
      // outgoing Android surface is still being detached.
      router.back();
      if (Platform.OS === "web") {
        setTimeout(openDestination, 0);
      } else {
        setTimeout(openDestination, NATIVE_MENU_DISMISS_MS);
      }
    },
    [tutorial],
  );
  return (
    <View style={styles.overlay} {...closeSwipe.panHandlers}>
      <Pressable
        accessibilityLabel="Close menu"
        style={styles.scrim}
        onPress={() => router.back()}
      />
      <SafeAreaView
        style={[styles.panel, { backgroundColor: colors.card }]}
        edges={["top", "bottom"]}
      >
        <View style={styles.topRow}>
          <View style={styles.brandLockup}>
            <Image
              source={require("../assets/images/habhub-icon.png")}
              style={styles.brandLogo}
              contentFit="cover"
              accessibilityLabel="HabHub logo"
            />
            <Text style={[styles.brand, { color: colors.ink }]}>HabHub</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Close menu")}
            onPress={() => router.back()}
            style={[styles.close, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <TutorialTarget id="menu-profile">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("My profile")}
          onPress={() => router.replace("/profile")}
          style={[styles.profile, { borderBottomColor: colors.border }]}
        >
          <Avatar
            initials={user.initials}
            color={accent}
            uri={user.avatarUri}
            size={48}
          />
          <View style={styles.profileCopy}>
            <Text style={[styles.name, { color: colors.ink }]}>
              {memberDisplayName(state, user)}
            </Text>
            {memberOriginalLabel(state, user) ? (
              <Text style={[styles.original, { color: colors.faint }]}>
                {memberOriginalLabel(state, user)}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.muted }]}>
              My profile · <Text translate={false}>{state.group.name}</Text>
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.faint} />
        </Pressable>
        </TutorialTarget>
        <View style={[styles.search, { backgroundColor: colors.canvas, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={19} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a page or setting"
            accessibilityLabel="Find a page or setting"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.ink }]}
            placeholderTextColor={colors.muted}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("Clear")} onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={19} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView style={styles.menuScroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {visibleDestinations.length ? (
            <>
              <Text style={[styles.category, { color: colors.muted }]}>Explore</Text>
              <View style={styles.destinations}>
                {visibleDestinations.map((item) => (
                  <Pressable
                    key={item.path}
                    accessibilityRole="button"
                    accessibilityLabel={t(item.label)}
                    onPress={() => openItem(item.path)}
                    style={({ pressed }) => [styles.destination, { backgroundColor: colors.canvas, borderColor: colors.border }, pressed && styles.pressed]}
                  >
                    <Ionicons name={item.icon} size={21} color={accent} />
                    <Text style={[styles.destinationLabel, { color: colors.ink }]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {visibleItems.length ? <Text style={[styles.category, { color: colors.muted }]}>Settings</Text> : null}
          {visibleItems.map((item) => {
            const row = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(item.label)}
                onPress={() => openItem(item.path)}
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[styles.icon, { backgroundColor: colors.primarySoft }]}
                >
                  <Ionicons name={item.icon} size={21} color={accent} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.label, { color: colors.ink }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    {item.detail}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.faint}
                />
              </Pressable>
            );
            if (item.path === "/display-settings")
              return (
                <TutorialTarget key={item.label} id="menu-display" onTutorialActivate={tutorialSandbox ? () => openItem(item.path) : undefined}>
                  {row}
                </TutorialTarget>
              );
            if (item.path === "/customize")
              return (
                <TutorialTarget key={item.label} id="menu-customize">
                  {row}
                </TutorialTarget>
              );
            return (
              <React.Fragment key={item.label}>
                {row}
              </React.Fragment>
            );
          })}
          {!visibleItems.length && !visibleDestinations.length ? (
            <Text style={[styles.empty, { color: colors.muted }]}>No matching options</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(23,33,27,0.28)",
  },
  scrim: { flex: 1 },
  panel: {
    width: "86%",
    maxWidth: 420,
    backgroundColor: palette.card,
    paddingHorizontal: 20,
    ...shadow,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandLogo: { width: 34, height: 34, borderRadius: 10 },
  brand: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 21,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  profile: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  profileCopy: { flex: 1 },
  name: { color: palette.ink, fontSize: 18, fontWeight: "700" },
  meta: { color: palette.muted, fontSize: 12, marginTop: 2 },
  original: { color: palette.faint, fontSize: 10, marginTop: 1 },
  menuScroll: { flex: 1 },
  list: { paddingVertical: 14, paddingBottom: 24, gap: 6 },
  search: { minHeight: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 9 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 13 },
  category: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 8, marginBottom: 6 },
  destinations: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  destination: { width: "31%", flexGrow: 1, minHeight: 70, borderRadius: 15, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 7 },
  destinationLabel: { fontSize: 10, fontWeight: "600", textAlign: "center" },
  empty: { fontSize: 14, textAlign: "center", padding: 24 },
  item: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 17,
    padding: 10,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primarySoft,
  },
  copy: { flex: 1 },
  label: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  detail: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  pressed: { opacity: 0.65 },
});
