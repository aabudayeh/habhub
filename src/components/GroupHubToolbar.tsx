import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { HeaderIconButton } from "@/src/components/ui";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupHubAction } from "@/src/types";

const DETAILS: Record<
  GroupHubAction,
  {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description: string;
    route: string;
  }
> = {
  notifications: {
    icon: "notifications-outline",
    label: "Notifications",
    description: "Group activity and alerts",
    route: "/alerts?scope=group",
  },
  recap: {
    icon: "sparkles-outline",
    label: "Recap",
    description: "Story and social feed",
    route: "/recap?scope=group",
  },
  challenges: {
    icon: "trophy-outline",
    label: "Challenges",
    description: "Current, past, and public challenges",
    route: "/challenges",
  },
  schedule: {
    icon: "calendar-outline",
    label: "Schedule",
    description: "Plans shared with this group",
    route: "/group-schedule",
  },
  notes: {
    icon: "document-text-outline",
    label: "Notes",
    description: "Shared notes and discussions",
    route: "/group-notes",
  },
};

export function GroupHubToolbar({
  actions,
  notificationBadgeCount,
  onOpenNotifications,
}: {
  actions: readonly GroupHubAction[];
  notificationBadgeCount: number;
  onOpenNotifications: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [open, setOpen] = useState(false);
  const pinned = actions.slice(0, 2);
  const overflow = actions.slice(2);
  const go = (action: GroupHubAction) => {
    setOpen(false);
    if (action === "notifications") {
      onOpenNotifications();
      return;
    }
    router.navigate(DETAILS[action].route as never);
  };

  return (
    <View style={styles.toolbar}>
      {pinned.map((action) => {
        const detail = DETAILS[action];
        return (
          <View key={action} style={styles.iconWrap}>
            <HeaderIconButton icon={detail.icon} label={detail.label} onPress={() => go(action)} />
            {action === "notifications" && notificationBadgeCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: accent }]}>
                <Text translate={false} style={styles.badgeText}>{Math.min(9, notificationBadgeCount)}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {overflow.length ? (
        <HeaderIconButton
          icon="grid-outline"
          label="More group pages"
          onPress={() => setOpen(true)}
        />
      ) : null}
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close group pages" style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.menu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.menuHeader}>
              <View>
                <Text style={[styles.menuTitle, { color: colors.ink }]}>Group pages</Text>
                <Text style={[styles.menuHint, { color: colors.muted }]}>Reorder these in Display settings</Text>
              </View>
              <Ionicons name="close" size={18} color={colors.faint} />
            </View>
            <View style={styles.grid}>
              {overflow.map((action) => {
                const detail = DETAILS[action];
                return (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    accessibilityLabel={`Open group ${detail.label}`}
                    onPress={(event) => {
                      event.stopPropagation();
                      go(action);
                    }}
                    style={[styles.item, { backgroundColor: colors.canvas, borderColor: colors.border }]}
                  >
                    <View style={[styles.itemIcon, { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name={detail.icon} size={20} color={accent} />
                      {action === "notifications" && notificationBadgeCount > 0 ? (
                        <View style={[styles.itemBadge, { backgroundColor: accent }]}><Text translate={false} style={styles.badgeText}>{Math.min(9, notificationBadgeCount)}</Text></View>
                      ) : null}
                    </View>
                    <Text style={[styles.itemTitle, { color: colors.ink }]}>{detail.label}</Text>
                    <Text style={[styles.itemCopy, { color: colors.muted }]}>{detail.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconWrap: { position: "relative" },
  badge: { position: "absolute", right: -1, top: -2, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontSize: 7, lineHeight: 9, fontWeight: "900" },
  backdrop: { flex: 1, backgroundColor: "rgba(5,14,36,.48)", alignItems: "flex-end", justifyContent: "flex-start", paddingTop: 74, paddingHorizontal: 14 },
  menu: { width: "100%", maxWidth: 360, borderWidth: 1, borderRadius: 22, padding: 13, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  menuHeader: { minHeight: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 3 },
  menuTitle: { fontSize: 13, fontWeight: "900" },
  menuHint: { fontSize: 7.5, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  item: { width: "48%", minHeight: 112, borderWidth: 1, borderRadius: 16, padding: 11, justifyContent: "center" },
  itemIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative" },
  itemBadge: { position: "absolute", right: -4, top: -4, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 10, fontWeight: "900", marginTop: 7 },
  itemCopy: { fontSize: 7.5, lineHeight: 11, marginTop: 2 },
});
