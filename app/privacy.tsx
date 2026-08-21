import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";

const GOOGLE_HEALTH_POLICY_URL =
  "https://developers.google.com/health/policies/health-api-developer-user-data-policy";
const GOOGLE_HEALTH_LIMITED_USE_URL = `${GOOGLE_HEALTH_POLICY_URL}#limited-use`;

function ExternalLink({ label, url }: { label: string; url: string }) {
  const accent = useGroupAccent();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={t("Opens in your browser")}
      onPress={() => void Linking.openURL(url)}
      style={styles.link}
    >
      <Text translate={false} style={[styles.linkText, { color: accent }]}>
        {label}
      </Text>
      <Ionicons name="open-outline" size={14} color={accent} />
    </Pressable>
  );
}

function PolicySection({ title, children }: { title: string; children: string }) {
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

export default function PrivacyScreen() {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const supportUrl =
    process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() ||
    "mailto:ahmad.adayeh@gmail.com";
  const validSupportUrl =
    supportUrl && /^(https?:\/\/|mailto:)/i.test(supportUrl) ? supportUrl : null;

  return (
    <Screen contentContainerStyle={styles.page}>
      <View style={styles.content}>
        <PageHeader
          title={t("Privacy & Health Data Policy")}
          subtitle={t("How HabHub handles account, tracker, and Google Health data.")}
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label={t("Close privacy policy")}
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
            <Ionicons name="shield-checkmark-outline" size={21} color={accent} />
            <Text translate={false} style={[styles.badgeText, { color: colors.ink }]}>
              Privacy controls stay with you
            </Text>
          </View>
          <Text translate={false} style={[styles.updated, { color: colors.faint }]}>
            Last updated: 21 August 2026
          </Text>

          <PolicySection title="Scope and operator">
            This policy covers HabHub account, tracker, group, status, cloud-sync, and Google Health features. HabHub is operated by Ahmad Adayeh. Privacy and deletion questions can be sent to ahmad.adayeh@gmail.com.
          </PolicySection>

          <PolicySection title="Data HabHub collects">
            HabHub stores the account details and content you provide, including tracker definitions, goals, entries, notes, food and workout records, photos, group activity, and settings. If you connect Google Health, HabHub collects only the read-only categories you approve: activity and fitness, health measurements, nutrition, and sleep. Each imported value retains provider/source metadata needed for reconciliation and deletion.
          </PolicySection>

          <PolicySection title="How health data is used">
            Approved Google Health data is used only to populate your trackers, dashboards, history, progress, and goals; reconcile later updates or deletions; and sync your HabHub data across your signed-in devices. HabHub does not request write access to Google Health.
          </PolicySection>

          <PolicySection title="Visibility and sharing">
            Google Health imports follow the current configured visibility of their HabHub tracker. You can change that visibility in the tracker&apos;s settings. Private data remains account-only. Group-visible values and their source provenance are shared only with authorized members in group views, including leaderboards. Status visibility shares the permitted goal/status projection rather than the private raw value.
          </PolicySection>

          <PolicySection title="Processors, storage, and security">
            Supabase processes HabHub authentication, database and file storage, server functions, and account sync. Expo processes web hosting and, where used, app builds, updates, and push delivery; Google and Apple may process platform notification delivery. Google processes OAuth and provides only the Health categories you authorize. Authorized group or status recipients receive only data allowed by your visibility settings. HabHub uses HTTPS in transit, encrypts stored Google authorization credentials, applies per-account database access controls, and never exposes Google credentials to the web client.
          </PolicySection>

          <PolicySection title="Device and browser caches">
            Raw Google Health imports, identifiable Google-derived daily or group projections, provider-linked entry identifiers, and Google entry time or date choices are excluded from HabHub&apos;s plaintext device and browser activity caches, cloud merge-base cache, Android widget snapshot, and locally scheduled goal-notification projections. They remain available from the protected cloud account while signed in and in memory while the app is open. Consequently, a cold offline launch cannot display Google Health imports until HabHub reconnects. Editing an imported food time or date, or hiding a Google Health entry, requires an online, authenticated server confirmation; HabHub reports the change as saved only after that confirmation. The protected cloud account, rather than a plaintext local outbox, preserves those confirmed changes across refreshes and provider syncs.
          </PolicySection>

          <PolicySection title="Retention and your controls">
            Imported health entries remain in your HabHub account until you delete them or delete the account. Disconnect Google Health stops future access, removes the active HabHub credential and sync state, and keeps entries already imported. Delete imported data stops access and removes entries and import records owned by that Google Health connection; manual entries and Apple Health or Health Connect imports made by the HabHub phone app remain. Delete account in Settings removes active Google access first, then deletes the account&apos;s remaining cloud data. If full deletion cannot finish, HabHub reports failure so the remaining work can be retried; completed deletion steps are not rolled back. If Google&apos;s remote revocation endpoint is temporarily unavailable, an account-detached encrypted revocation job is queued and retried; account deletion may still finish after that durable handoff. Infrastructure backups age out under each processor&apos;s configured retention and recovery schedule.
          </PolicySection>

          <PolicySection title="Uses HabHub prohibits">
            HabHub does not sell health data, use it for targeted advertising, share it with data brokers, use it to determine credit, insurance, employment, lending, or housing eligibility, or use it for research. HabHub does not combine Google Health data with unrelated advertising profiles.
          </PolicySection>

          <View style={[styles.limitedUse, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
            <Text
              translate={false}
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: colors.ink }]}
            >
              Google Health Limited Use
            </Text>
            <Text translate={false} style={[styles.body, { color: colors.muted }]}>
              The use of information received from Google Health API and/or Developer Tools will adhere to the Google Health API Developer and User Data Policy, including the Limited Use requirements.
            </Text>
            <View style={styles.policyLinks}>
              <ExternalLink
                label="Google Health API Developer and User Data Policy"
                url={GOOGLE_HEALTH_POLICY_URL}
              />
              <ExternalLink
                label="Google Health Limited Use requirements"
                url={GOOGLE_HEALTH_LIMITED_USE_URL}
              />
            </View>
          </View>

          <PolicySection title="Contact and deletion help">
            For privacy questions or help disconnecting Google Health, deleting imported health data, or deleting your HabHub account, contact Ahmad Adayeh at ahmad.adayeh@gmail.com. Signed-in users can perform each deletion action directly in Settings.
          </PolicySection>
          {validSupportUrl ? (
            <ExternalLink label="Contact HabHub support" url={validSupportUrl} />
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

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
  section: { marginTop: 20 },
  sectionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  body: { fontSize: 11, lineHeight: 18, marginTop: 6 },
  limitedUse: { borderWidth: 1, borderRadius: 14, padding: 13, marginTop: 20 },
  policyLinks: { gap: 2, marginTop: 7 },
  link: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingVertical: 7,
  },
  linkText: { fontSize: 10, lineHeight: 15, fontWeight: "900", textDecorationLine: "underline" },
});
