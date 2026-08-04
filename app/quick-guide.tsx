import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  TUTORIAL_GUIDES,
} from "@/src/components/TutorialSpotlight";
import { IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

export default function QuickGuideScreen() {
  const { updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();

  function start(id: string, path: string) {
    updateSettings({
      tutorialComplete: false,
      tutorialGuideId: id,
      tutorialGuideRunId: Date.now(),
    });
    router.replace(path as never);
  }

  return (
    <Screen contentContainerStyle={styles.page}>
      <PageHeader
        title="Quick guide"
        subtitle="Choose a detailed interactive walkthrough. Your data and settings stay unchanged."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close guide"
            onPress={() => router.back()}
          />
        }
      />
      <View style={styles.list}>
        {TUTORIAL_GUIDES.map((guide) => (
          <Pressable
            key={guide.id}
            accessibilityRole="button"
            accessibilityLabel={`Start ${guide.title} guide`}
            onPress={() => start(guide.id, guide.path)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <View
              style={[styles.icon, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons
                name={guide.icon}
                size={21}
                color={accent}
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>
                {guide.title}
              </Text>
              <Text style={[styles.detail, { color: colors.muted }]}>
                {guide.detail}
              </Text>
            </View>
            <Ionicons
              name="play-circle-outline"
              size={22}
              color={accent}
            />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 18 },
  list: { gap: 9 },
  row: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 13, fontWeight: "900" },
  detail: { fontSize: 10, lineHeight: 14 },
});
