import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/src/components/ui";
import { memberDisplayName, memberOriginalLabel } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, shadow, useAppColors, useGroupAccent } from "@/src/theme";

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
    label: "Quick guide",
    detail: "Replay the short setup and tutorial",
    icon: "help-circle-outline" as const,
    path: "/onboarding" as const,
  },
  {
    label: "Advanced settings",
    detail: "Trackers, calculations, layouts and scoring",
    icon: "options-outline" as const,
    path: "/customize" as const,
  },
];

export default function MenuScreen() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const user = state.group.members.find(
    (member) => member.id === state.currentUserId,
  )!;
  return (
    <View style={styles.overlay}>
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
          <Text style={[styles.brand, { color: accent }]}>NORTH</Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.close, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <Pressable
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
              My profile · {state.group.name}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.faint} />
        </Pressable>
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => router.replace(item.path as never)}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
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
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>
          ))}
        </View>
        <Text style={[styles.privacy, { color: colors.muted }]}>
          New items share their values with your group by default. You can make
          any item or entry private.
        </Text>
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
    maxWidth: 390,
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
  brand: {
    color: palette.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  close: {
    width: 42,
    height: 42,
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
  name: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  meta: { color: palette.muted, fontSize: 12, marginTop: 2 },
  original: { color: palette.faint, fontSize: 10, marginTop: 1 },
  list: { paddingVertical: 14, gap: 6 },
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
  label: { color: palette.ink, fontSize: 14, fontWeight: "800" },
  detail: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  privacy: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: "auto",
    paddingVertical: 16,
  },
  pressed: { opacity: 0.65 },
});
