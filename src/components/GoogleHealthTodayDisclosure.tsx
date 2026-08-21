import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import { AppText as Text } from "@/src/components/AppText";
import { googleHealthNormalUseDisclosureKey } from "@/src/domain/googleHealthSetup";
import { useTranslation } from "@/src/i18n";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

type DisclosureMarker = {
  accountId: string;
  dismissed: boolean;
};

export function GoogleHealthTodayDisclosure({ hidden = false }: { hidden?: boolean }) {
  const auth = useAuth();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const accountId = auth.status === "signedIn" ? auth.user?.id ?? null : null;
  const [marker, setMarker] = useState<DisclosureMarker | null>(null);

  useEffect(() => {
    setMarker(null);
    if (
      Platform.OS !== "web" ||
      hidden ||
      auth.status !== "signedIn" ||
      !accountId ||
      typeof window === "undefined"
    )
      return;
    let dismissed = false;
    try {
      dismissed =
        window.localStorage.getItem(
          googleHealthNormalUseDisclosureKey(accountId),
        ) === "true";
    } catch {
      // Private browsing may reject localStorage. Show the disclosure and keep
      // any dismissal in memory for the current signed-in session.
    }
    setMarker({ accountId, dismissed });
  }, [accountId, auth.status, hidden]);

  if (
    Platform.OS !== "web" ||
    hidden ||
    auth.status !== "signedIn" ||
    !accountId ||
    marker?.accountId !== accountId ||
    marker.dismissed
  )
    return null;

  const dismiss = () => {
    setMarker({ accountId, dismissed: true });
    try {
      window.localStorage.setItem(
        googleHealthNormalUseDisclosureKey(accountId),
        "true",
      );
    } catch {
      // The in-memory marker still prevents repeated prompts this session.
    }
  };

  const reviewSetup = () => {
    dismiss();
    // This only opens the existing disclosure/setup flow. OAuth and collection
    // still require the separate affirmative consent immediately before connect.
    router.push("/settings" as never);
  };

  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: `${accent}55` },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${accent}18` }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={accent} />
        </View>
        <View style={styles.titleCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t("Google Health for web")}
          </Text>
          <Text style={[styles.kicker, { color: accent }]}>
            {t("Review before connecting")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Dismiss Google Health information")}
          hitSlop={8}
          onPress={dismiss}
          style={styles.close}
        >
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <Text style={[styles.body, { color: colors.muted }]}>
        {t(
          "The HabHub web app cannot read Apple Health or Health Connect directly. The Google Health phone app securely bridges that data to your Google account, then HabHub imports only the read-only categories you approve.",
        )}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        {t(
          "HabHub collects the activity and fitness, health measurement, nutrition, and sleep data you approve. It uses this data to populate your trackers, dashboards, and goals and to sync them across your devices.",
        )}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        {t(
          "Google Health imports follow each tracker's current configured visibility. Group, status, or leaderboard sharing follows that setting. You can change it in the tracker's settings.",
        )}
      </Text>
      <Text style={[styles.limitedUse, { color: colors.faint }]}>
        {t("HabHub's use follows Google Health Limited Use requirements.")}
      </Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Review Google Health setup")}
          onPress={reviewSetup}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: accent },
            pressed && styles.pressed,
          ]}
        >
          <Text preserveColor style={styles.primaryText}>
            {t("Review Google Health setup")}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={palette.white} />
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("Privacy & Limited Use")}
          onPress={() => router.push("/privacy" as never)}
          style={styles.policyLink}
        >
          <Text style={[styles.policyText, { color: accent }]}>
            {t("Privacy & Limited Use")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    marginTop: 10,
    padding: 12,
    gap: 7,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  kicker: { fontSize: 8, lineHeight: 12, fontWeight: "800", marginTop: 1 },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { fontSize: 9, lineHeight: 14 },
  limitedUse: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  primary: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  policyLink: { minHeight: 42, justifyContent: "center", paddingHorizontal: 5 },
  policyText: { fontSize: 9, fontWeight: "900", textDecorationLine: "underline" },
  pressed: { opacity: 0.82 },
});
