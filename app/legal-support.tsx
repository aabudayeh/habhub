import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { useAppColors, useGroupAccent } from "@/src/theme";

const resources = [
  {
    label: "Privacy & Health Data Policy",
    detail: "Account, device, health, sharing, and retention practices.",
    icon: "shield-checkmark-outline" as const,
    path: "/privacy" as const,
  },
  {
    label: "Terms of Use",
    detail: "The terms that apply when you use HabHub.",
    icon: "reader-outline" as const,
    path: "/terms" as const,
  },
  {
    label: "Community Guidelines",
    detail: "Standards for groups, chat, challenges, and shared content.",
    icon: "people-circle-outline" as const,
    path: "/community-guidelines" as const,
  },
  {
    label: "Safety Center",
    detail: "Blocking, reporting, moderation, and safer participation.",
    icon: "flag-outline" as const,
    path: "/safety" as const,
  },
  {
    label: "HabHub Support",
    detail: "Get product, privacy, safety, or account help.",
    icon: "help-buoy-outline" as const,
    path: "/support" as const,
  },
  {
    label: "Account deletion help",
    detail: "Public instructions if you cannot use the installed app.",
    icon: "trash-outline" as const,
    path: "/delete-account" as const,
  },
];

export default function LegalSupportScreen() {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Screen>
      <PageHeader
        eyebrow="Settings"
        title="Legal & support"
        subtitle="Policies, community safety, and a direct path to help."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      <SectionHeader title="Resources" />
      <Card style={styles.card}>
        {resources.map((resource, index) => (
          <View
            key={resource.path}
            style={[
              styles.row,
              index < resources.length - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={resource.icon} size={20} color={accent} />
            </View>
            <View style={styles.copy}>
              <Text translate={false} style={[styles.title, { color: colors.ink }]}>
                {resource.label}
              </Text>
              <Text style={[styles.detail, { color: colors.muted }]}>{resource.detail}</Text>
            </View>
            <View style={styles.action}>
              <Button
                label="Open"
                size="small"
                variant="ghost"
                onPress={() => router.push(resource.path as never)}
              />
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 2 },
  row: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 11, lineHeight: 15, fontWeight: "900" },
  detail: { fontSize: 8.5, lineHeight: 13, marginTop: 2 },
  action: { minWidth: 64 },
});
