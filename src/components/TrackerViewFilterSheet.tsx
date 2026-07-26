import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  activeTrackerViewId,
  ALL_AVAILABLE_TRACKERS_FILTER,
  ALL_TRACKERS_FILTER,
  TRACKED_ONLY_FILTER,
  TrackerViewScope,
} from "@/src/domain/viewFilters";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

export function TrackerViewFilterSheet({
  visible,
  scope,
  onClose,
}: {
  visible: boolean;
  scope: TrackerViewScope;
  onClose: () => void;
}) {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const setting =
    scope === "today"
      ? "activeTodayTrackerViewFilterId"
      : "activeProgressTrackerViewFilterId";
  const choices = [
    [TRACKED_ONLY_FILTER, "Tracked goals only", "flag-outline"],
    [ALL_AVAILABLE_TRACKERS_FILTER, "All trackers", "apps-outline"],
    [ALL_TRACKERS_FILTER, "None", "remove-circle-outline"],
    ...(state.settings.trackerViewFilters ?? [])
      .filter((filter) => filter.visible !== false)
      .map((filter) => [filter.id, filter.name, "funnel-outline"]),
  ] as [string, string, keyof typeof Ionicons.glyphMap][];
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.sheet, { backgroundColor: colors.card }]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.ink }]}>
            {scope === "today" ? "Today view" : "Progress view"}
          </Text>
          {choices.map(([id, label, icon]) => (
            <Pressable
              key={id}
              onPress={() => {
                updateSettings({ [setting]: id });
                onClose();
              }}
              style={[styles.row, { borderColor: colors.border }]}
            >
              <Ionicons name={icon} size={17} color={accent} />
              <Text style={[styles.name, { color: colors.ink }]}>{label}</Text>
              {activeTrackerViewId(state, scope) === id ? (
                <Ionicons name="checkmark" size={17} color={accent} />
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              onClose();
              router.navigate({
                pathname: "/view-filters",
                params: { scope },
              } as never);
            }}
            style={[styles.manage, { borderColor: accent }]}
          >
            <Ionicons name="settings-outline" size={15} color={accent} />
            <Text style={[styles.manageText, { color: accent }]}>
              Manage custom views
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.34)",
    justifyContent: "flex-end",
    padding: 12,
  },
  sheet: { borderRadius: 22, padding: 14, gap: 8, maxHeight: "78%" },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 3,
  },
  title: { fontSize: 13, fontWeight: "900", marginBottom: 3 },
  row: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  name: { flex: 1, fontSize: 10, fontWeight: "800" },
  manage: {
    minHeight: 42,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  manageText: { fontSize: 9, fontWeight: "900" },
});
