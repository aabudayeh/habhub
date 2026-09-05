import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Button, Card, IconButton, PageHeader, Screen, SectionHeader } from "@/src/components/ui";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { policyVersionLabel } from "@/src/legal/policy";
import {
  ModerationReport,
  SAFETY_REPORT_REASONS,
  SafetyReportReason,
  useUserSafety,
} from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

function reasonLabel(reason: SafetyReportReason) {
  return (
    SAFETY_REPORT_REASONS.find((candidate) => candidate.id === reason)?.label ??
    "Safety concern"
  );
}

export default function SafetyCenter() {
  const { state } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const safety = useUserSafety(state.currentUserId, tutorialSandbox);
  const [busy, setBusy] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const currentMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canModerate =
    safety.mode === "cloud" &&
    (currentMember?.role === "owner" || currentMember?.role === "admin");

  const loadModeration = safety.loadModeration;
  useEffect(() => {
    if (!safety.hydrated || !canModerate) return;
    void loadModeration(state.group.id).catch(() => undefined);
  }, [canModerate, loadModeration, safety.hydrated, state.group.id]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await safety.refresh();
      if (canModerate) await safety.loadModeration(state.group.id);
    } catch (error) {
      Alert.alert(
        "Safety settings unavailable",
        error instanceof Error ? error.message : "Try again when connected.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [canModerate, safety, state.group.id]);

  function confirmUnblock(userId: string, displayName: string) {
    Alert.alert(
      `Unblock ${displayName}?`,
      "Their group messages can appear again, and direct messaging will be available unless they have blocked you.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: () => {
            setBusy(`unblock:${userId}`);
            void safety
              .unblockUser(userId)
              .then((result) => {
                if (!result.cloudSynced && safety.mode === "cloud")
                  Alert.alert(
                    "Unblocked on this device",
                    "Cloud sync will retry when your connection is available.",
                  );
              })
              .catch((error) =>
                Alert.alert(
                  "Unblock not saved",
                  error instanceof Error
                    ? error.message
                    : "Try again when storage is available.",
                ),
              )
              .finally(() => setBusy(undefined));
          },
        },
      ],
    );
  }

  function moderate(
    report: ModerationReport,
    action:
      | "reviewed"
      | "remove_message"
      | "remove_comment"
      | "dismissed",
  ) {
    const destructive =
      action === "remove_message" || action === "remove_comment";
    const contentLabel = action === "remove_comment" ? "comment" : "message";
    Alert.alert(
      destructive ? `Remove reported ${contentLabel}?` : "Update this report?",
      destructive
        ? `The ${contentLabel} will be removed from the shared group. The report remains in the protected operator queue for independent follow-up.`
        : action === "reviewed"
          ? "Mark this report as reviewed in the group queue? It remains available for independent operator follow-up."
          : "Dismiss this report from the group queue without removing content? It remains available for independent operator follow-up.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text:
            action === "reviewed"
              ? "Mark reviewed"
              : action === "dismissed"
                ? "Dismiss"
                : `Remove ${contentLabel}`,
          style: destructive ? "destructive" : "default",
          onPress: () => {
            setBusy(`report:${report.id}`);
            void safety
              .moderateReport(report.id, action)
              .catch((error) =>
                Alert.alert(
                  "Moderation failed",
                  error instanceof Error ? error.message : "Try again.",
                ),
              )
              .finally(() => setBusy(undefined));
          },
        },
      ],
    );
  }

  return (
    <Screen
      contentContainerStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={accent}
        />
      }
    >
      <PageHeader
        eyebrow="Trust & safety"
        title="Safety Center"
        subtitle="Control who can contact you and follow up on reports."
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />

      <Card style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="shield-checkmark" size={24} color={accent} />
        </View>
        <View style={styles.grow}>
          <Text style={[styles.heroTitle, { color: colors.ink }]}>You control your group experience</Text>
          <Text style={[styles.body, { color: colors.muted }]}>Blocking hides that member&apos;s cached and future messages immediately. Every cloud report enters a protected operator queue; eligible group moderators can also act, except on reports about themselves or reports they filed.</Text>
        </View>
      </Card>

      {safety.mode === "demo" ? (
        <Card style={[styles.notice, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="flask-outline" size={21} color={accent} />
          <View style={styles.grow}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>Demo safety preview</Text>
            <Text style={[styles.body, { color: colors.muted }]}>Blocks and reports stay on this device. Demo reports are not submitted to HabHub or a group admin.</Text>
          </View>
        </Card>
      ) : (
        <Card style={styles.termsCard}>
          <View style={styles.row}>
            <Ionicons
              name={safety.termsAccepted ? "checkmark-circle" : "document-text-outline"}
              size={22}
              color={safety.termsAccepted ? accent : colors.muted}
            />
            <View style={styles.grow}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>
                {safety.termsAccepted ? "Cloud community Terms accepted" : "Accept Terms to use cloud chat"}
              </Text>
              <Text style={[styles.body, { color: colors.muted }]}>Version {policyVersionLabel(safety.bundledTermsVersion)} · reporting and blocking remain available before acceptance.</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Button
              label="Read Terms"
              variant="ghost"
              size="small"
              onPress={() => router.push("/terms" as never)}
            />
            {!safety.termsAccepted ? (
              <Button
                label="Agree & enable chat"
                size="small"
                loading={busy === "terms"}
                onPress={() => {
                  setBusy("terms");
                  void safety
                    .acceptTerms()
                    .then(() =>
                      Alert.alert(
                        "Terms accepted",
                        "Cloud chat is now enabled for this account.",
                      ),
                    )
                    .catch((error) =>
                      Alert.alert(
                        "Could not accept Terms",
                        error instanceof Error ? error.message : "Try again.",
                      ),
                    )
                    .finally(() => setBusy(undefined));
                }}
              />
            ) : null}
          </View>
        </Card>
      )}

      <SectionHeader title="Blocked members" />
      {safety.blockedUsers.length ? (
        <Card style={styles.list}>
          {safety.blockedUsers.map((member, index) => (
            <View
              key={member.userId}
              style={[
                styles.listRow,
                index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
              ]}
            >
              <View style={[styles.smallIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="person-remove-outline" size={18} color={accent} />
              </View>
              <View style={styles.grow}>
                <Text translate={false} style={[styles.cardTitle, { color: colors.ink }]}>{member.displayName}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>Messages hidden · blocked {new Date(member.createdAt).toLocaleDateString()}</Text>
              </View>
              <Button
                label="Unblock"
                variant="ghost"
                size="small"
                loading={busy === `unblock:${member.userId}`}
                onPress={() => confirmUnblock(member.userId, member.displayName)}
              />
            </View>
          ))}
        </Card>
      ) : (
        <Card style={styles.empty}>
          <Ionicons name="people-outline" size={23} color={colors.faint} />
          <Text style={[styles.body, { color: colors.muted }]}>You have not blocked anyone. Use a member profile or chat safety control when needed.</Text>
        </Card>
      )}

      <SectionHeader title="Your recent reports" />
      {safety.reports.length ? (
        <Card style={styles.list}>
          {safety.reports.map((report, index) => (
            <View
              key={report.id}
              style={[
                styles.reportRow,
                index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
              ]}
            >
              <View style={styles.reportHeading}>
                <Text translate={false} style={[styles.cardTitle, { color: colors.ink }]}>{report.reportType === "message" ? "Message from " : report.reportType === "comment" ? "Comment from " : "Member: "}{report.reportedDisplayName}</Text>
                <Text style={[styles.status, { color: report.localOnly ? colors.muted : accent }]}>{report.localOnly ? "DEMO ONLY" : report.status.toUpperCase()}</Text>
              </View>
              <Text style={[styles.body, { color: colors.muted }]}>{reasonLabel(report.reason)} · {new Date(report.createdAt).toLocaleDateString()}</Text>
              {!report.localOnly ? (
                <Text style={[styles.queueMeta, { color: colors.muted }]}>
                  {report.operatorReviewState === "queued"
                    ? "Protected operator review queued"
                    : report.operatorReviewState === "dismissed"
                      ? "Operator review dismissed"
                      : "Operator review completed"}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      ) : (
        <Card style={styles.empty}>
          <Ionicons name="flag-outline" size={23} color={colors.faint} />
          <Text style={[styles.body, { color: colors.muted }]}>No reports from this account.</Text>
        </Card>
      )}

      {canModerate ? (
        <>
          <SectionHeader title={`Group moderation · ${state.group.name}`} translateTitle={false} />
          <Card style={[styles.moderatorNotice, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="shield-outline" size={19} color={accent} />
            <Text style={[styles.body, styles.grow, { color: colors.muted }]}>Reports about your own account or reports you filed never appear in your group queue. Group decisions do not remove a report from the protected operator queue.</Text>
          </Card>
          {safety.moderationReports.length ? (
            <View style={styles.moderationList}>
              {safety.moderationReports.map((report) => (
                <Card key={report.id} style={styles.moderationCard}>
                  <View style={styles.reportHeading}>
                    <Text translate={false} style={[styles.cardTitle, { color: colors.ink }]}>{report.reportedDisplayName}</Text>
                    <Text style={[styles.status, { color: accent }]}>{report.status.toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.body, { color: colors.muted }]}>{reasonLabel(report.reason)} · reported by {report.reporterDisplayName}</Text>
                  {report.operatorReviewRequired ? (
                    <Text style={[styles.escalation, { color: accent }]}>Independent operator review required</Text>
                  ) : null}
                  {report.messageExcerpt ? (
                    <View style={[styles.excerpt, { backgroundColor: colors.canvas, borderColor: colors.border }]}>
                      <Text translate={false} numberOfLines={4} style={[styles.excerptText, { color: colors.ink }]}>{report.messageExcerpt}</Text>
                    </View>
                  ) : null}
                  {report.details ? <Text translate={false} style={[styles.details, { color: colors.muted }]}>{report.details}</Text> : null}
                  <View style={styles.actions}>
                    <Button label="Reviewed" size="small" variant="ghost" disabled={busy === `report:${report.id}`} onPress={() => moderate(report, "reviewed")} />
                    <Button label="Dismiss" size="small" variant="ghost" disabled={busy === `report:${report.id}`} onPress={() => moderate(report, "dismissed")} />
                    {report.messageAvailable ? <Button label="Remove message" size="small" variant="danger" loading={busy === `report:${report.id}`} onPress={() => moderate(report, "remove_message")} /> : null}
                    {report.commentAvailable ? <Button label="Remove comment" size="small" variant="danger" loading={busy === `report:${report.id}`} onPress={() => moderate(report, "remove_comment")} /> : null}
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <Card style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={23} color={accent} />
              <Text style={[styles.body, { color: colors.muted }]}>No open reports in this group.</Text>
            </Card>
          )}
        </>
      ) : null}

      <Card style={styles.supportCard}>
        <View style={styles.grow}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>Need HabHub support?</Text>
          <Text style={[styles.body, { color: colors.muted }]}>For urgent danger, contact local emergency services. In-app reports already enter the protected operator queue; use support for extra context or an appeal.</Text>
        </View>
        <Pressable accessibilityRole="link" onPress={() => router.push("/support" as never)} style={styles.supportLink}>
          <Text style={[styles.supportLinkText, { color: accent }]}>Open support</Text>
          <Ionicons name="arrow-forward" size={15} color={accent} />
        </Pressable>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 42 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  body: { fontSize: 9.5, lineHeight: 14, marginTop: 3 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  termsCard: { gap: 12, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 11, lineHeight: 15, fontWeight: "900" },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 7 },
  list: { paddingVertical: 2, marginBottom: 12 },
  listRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  smallIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  empty: { alignItems: "center", gap: 7, marginBottom: 12, paddingVertical: 20 },
  reportRow: { paddingVertical: 11 },
  queueMeta: { fontSize: 8, lineHeight: 12, marginTop: 3, fontWeight: "800" },
  reportHeading: { flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "flex-start" },
  moderatorNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 9 },
  status: { flexShrink: 0, fontSize: 7.5, lineHeight: 11, fontWeight: "900", letterSpacing: 0.6 },
  moderationList: { gap: 9, marginBottom: 12 },
  moderationCard: { gap: 8 },
  excerpt: { borderWidth: 1, borderRadius: 11, padding: 10 },
  excerptText: { fontSize: 10, lineHeight: 15 },
  details: { fontSize: 9, lineHeight: 14 },
  escalation: { fontSize: 8.5, lineHeight: 12, fontWeight: "900" },
  supportCard: { gap: 10, marginTop: 8 },
  supportLink: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  supportLinkText: { fontSize: 10, fontWeight: "900" },
});
