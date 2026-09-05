import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { PropsWithChildren } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";

export const HABHUB_SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || "ahmad.adayeh@gmail.com";

export function supportMailto(subject: string) {
  return `mailto:${HABHUB_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export function LegalSection({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  const colors = useAppColors();
  return (
    <View style={styles.section}>
      <Text
        translate={false}
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.ink }]}
      >
        {title}
      </Text>
      <Text translate={false} style={[styles.body, { color: colors.muted }]}>
        {children}
      </Text>
    </View>
  );
}

export function LegalRouteLink({
  label,
  route,
  icon = "arrow-forward-outline",
}: {
  label: string;
  route: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const accent = useGroupAccent();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => router.push(route as never)}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text translate={false} style={[styles.linkText, { color: accent }]}>
        {label}
      </Text>
      <Ionicons name={icon} size={15} color={accent} />
    </Pressable>
  );
}

export function ExternalLegalLink({
  label,
  url,
  icon = "open-outline",
}: {
  label: string;
  url: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const accent = useGroupAccent();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={t("Opens in your browser")}
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text translate={false} style={[styles.linkText, { color: accent }]}>
        {label}
      </Text>
      <Ionicons name={icon} size={15} color={accent} />
    </Pressable>
  );
}

export function LegalDocumentScreen({
  title,
  subtitle,
  badge,
  badgeIcon,
  updated,
  reviewRequired = false,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  badge: string;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  updated: string;
  reviewRequired?: boolean;
}>) {
  const colors = useAppColors();
  const accent = useGroupAccent();

  return (
    <Screen contentContainerStyle={styles.page}>
      <View style={styles.content}>
        <PageHeader
          title={title}
          subtitle={subtitle}
          translateTitle={false}
          translateSubtitle={false}
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label={`Close ${title}`}
              translate={false}
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace("/sign-in" as never)
              }
            />
          }
        />

        <Card style={styles.card}>
          <View style={[styles.badge, { backgroundColor: `${accent}18` }]}>
            <Ionicons name={badgeIcon} size={21} color={accent} />
            <Text translate={false} style={[styles.badgeText, { color: colors.ink }]}>
              {badge}
            </Text>
          </View>
          <Text translate={false} style={[styles.updated, { color: colors.faint }]}>
            Last updated: {updated}
          </Text>
          {reviewRequired ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.reviewNotice,
                { backgroundColor: colors.canvas, borderColor: colors.border },
              ]}
            >
              <Ionicons name="document-text-outline" size={18} color={accent} />
              <Text translate={false} style={[styles.reviewText, { color: colors.muted }]}>
                Operator-authored pre-release text. It describes the intended
                product rules, but qualified legal review and final operator
                details are still required before public store submission.
              </Text>
            </View>
          ) : null}
          {children}
        </Card>
      </View>
    </Screen>
  );
}

export const legalDocumentStyles = StyleSheet.create({
  actions: { gap: 8, marginTop: 18 },
  callout: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginTop: 18,
  },
  calloutTitle: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
  calloutBody: { fontSize: 10, lineHeight: 16, marginTop: 5 },
  email: { fontSize: 12, lineHeight: 18, fontWeight: "900", marginTop: 8 },
  linkGroup: { gap: 2, marginTop: 12 },
});

const styles = StyleSheet.create({
  page: { paddingTop: 18, paddingBottom: 48 },
  content: { width: "100%", maxWidth: 780, alignSelf: "center" },
  card: { padding: 18 },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
  },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: "900" },
  updated: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  reviewNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
  },
  reviewText: { flex: 1, fontSize: 10, lineHeight: 16 },
  section: { marginTop: 20 },
  sectionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  body: { fontSize: 11, lineHeight: 18, marginTop: 6 },
  link: {
    alignSelf: "stretch",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 9,
  },
  linkText: { flex: 1, fontSize: 11, lineHeight: 17, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
