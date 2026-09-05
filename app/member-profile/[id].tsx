import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BadgeMedallion } from "@/src/components/BadgeMedallion";
import { SafetyReportSheet } from "@/src/components/SafetyReportSheet";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { useSettledChallengeResults } from "@/src/cloud/useSettledChallengeResults";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { badgeLevelSummary, buildBadges } from "@/src/domain/badges";
import { dateKey, friendlyDate, relativeTime } from "@/src/domain/date";
import { memberDisplayName, memberRoleLabel } from "@/src/domain/members";
import { LocalizedAlert as Alert, useLocalization } from "@/src/i18n";
import {
  SafetyReportReason,
  useUserSafety,
} from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors } from "@/src/theme";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

export default function GroupMemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const safety = useUserSafety(state.currentUserId, tutorialSandbox);
  const colors = useAppColors();
  const { locale, t } = useLocalization();
  const challengeCloud = useGroupChallenges(state.group.id);
  const settledChallengeResults = useSettledChallengeResults(state.group.id);
  const settledChallengeOccurrenceKeys =
    settledChallengeResults.occurrenceKeys;
  const [reportOpen, setReportOpen] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const member = state.group.members.find((candidate) => candidate.id === id);
  const allBadges = useMemo(
    () => {
      if (!member) return [];
      return buildBadges(
        state,
        dateKey(),
        challengeCloud.challenges,
        dateKey(),
        settledChallengeResults.placements,
        settledChallengeOccurrenceKeys,
      );
    },
    [
      challengeCloud.challenges,
      member,
      settledChallengeOccurrenceKeys,
      settledChallengeResults.placements,
      state,
    ],
  );
  const level = useMemo(
    () => badgeLevelSummary(allBadges, member?.id ?? state.currentUserId),
    [allBadges, member?.id, state.currentUserId],
  );
  const badges = useMemo(
    () => {
      if (!member) return [];
      const earned = allBadges.filter(
        (badge) => badge.memberId === member.id && badge.status === "earned",
      );
      const showcase =
        member.id === state.currentUserId
          ? state.settings.badgeShowcaseByGroup[state.group.id] ?? []
          : [];
      return [
        ...showcase.flatMap((badgeId) =>
          earned.filter((badge) => badge.id === badgeId),
        ),
        ...earned,
      ]
        .filter(
          (badge, index, all) =>
            all.findIndex((candidate) => candidate.id === badge.id) === index,
        )
        .slice(0, 5);
    },
    [allBadges, member, state.currentUserId, state.group.id, state.settings.badgeShowcaseByGroup],
  );
  const competitiveStats = useMemo(() => {
    if (!member) return [];
    const challengeCount = (prefix: string) =>
      allBadges.find((badge) => badge.id === `${prefix}:${member.id}`)
        ?.earnedCount ?? 0;
    const challengeWins = challengeCount("challenge-wins");
    const challengeSeconds = challengeCount("challenge-seconds");
    const challengeThirds = challengeCount("challenge-thirds");
    return [
      {
        id: "challenge-wins",
        icon: "trophy-outline" as const,
        label: "Challenge wins",
        value: challengeWins,
      },
      {
        id: "challenge-podiums",
        icon: "podium-outline" as const,
        label: "Podium finishes",
        value: challengeWins + challengeSeconds + challengeThirds,
      },
      {
        id: "challenge-finishes",
        icon: "flag-outline" as const,
        label: "Challenges finished",
        value: challengeCount("challenge-finishes"),
      },
      {
        id: "current-leads",
        icon: "trending-up-outline" as const,
        label: "Current leads",
        value: allBadges.filter(
          (badge) =>
            badge.memberId === member.id &&
            badge.status === "recurring" &&
            badge.category === "competition",
        ).length,
      },
    ];
  }, [allBadges, member]);

  if (!member) {
    return (
      <Screen>
        <PageHeader
          title="Member unavailable"
          showMenu={false}
          action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
        />
        <Card style={styles.empty}>
          <Ionicons name="person-remove-outline" size={28} color={colors.faint} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>This person is no longer an active member of the selected group.</Text>
        </Card>
      </Screen>
    );
  }

  const activeMember = member;
  const isSelf = activeMember.id === state.currentUserId;
  const blocked = safety.isBlocked(activeMember.id);
  function confirmBlockChange() {
    Alert.alert(
      `${blocked ? "Unblock" : "Block"} ${memberDisplayName(state, activeMember)}?`,
      blocked
        ? "Their group messages can appear again. Direct messaging is available only when neither person has blocked the other."
        : "Their cached and future messages will be hidden immediately. Direct messages and chat push alerts stop across the block.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: blocked ? "Unblock" : "Block",
          style: blocked ? "default" : "destructive",
          onPress: () => {
            setSafetyBusy(true);
            const action = blocked
              ? safety.unblockUser(activeMember.id)
              : safety.blockUser(
                  state.group.id,
                  activeMember.id,
                  memberDisplayName(state, activeMember),
                );
            void action
              .then((result) =>
                Alert.alert(
                  blocked ? "Member unblocked" : "Member blocked",
                  safety.mode === "demo"
                    ? "This demo safety change stays on this device."
                    : result.cloudSynced
                      ? blocked
                        ? "Your cloud block list was updated."
                        : "Their messages are hidden and direct contact is disabled."
                  : "The change is active on this device. Cloud sync will retry when available.",
                ),
              )
              .catch((error) =>
                Alert.alert(
                  "Safety change not saved",
                  error instanceof Error
                    ? error.message
                    : "The change is active for this session. Try again when storage is available.",
                ),
              )
              .finally(() => setSafetyBusy(false));
          },
        },
      ],
    );
  }
  async function submitReport(reason: SafetyReportReason, details: string) {
    setSafetyBusy(true);
    try {
      const result = await safety.reportUser({
        groupId: state.group.id,
        userId: activeMember.id,
        reportedDisplayName: memberDisplayName(state, activeMember),
        reason,
        details,
      });
      setReportOpen(false);
      Alert.alert(
        result.cloudSynced ? "Report submitted" : "Demo report saved locally",
        result.cloudSynced
          ? "Your report is in HabHub's protected operator queue. An eligible group moderator may also review it, but the reported person cannot review their own report."
          : "Demo mode does not send reports to HabHub or group admins.",
      );
    } catch (error) {
      Alert.alert(
        "Report not submitted",
        error instanceof Error
          ? error.message
          : "Reconnect and try again so the report can be stored securely.",
      );
    } finally {
      setSafetyBusy(false);
    }
  }
  const joinedGroupDate = t(
    member.joinedGroupAt
      ? friendlyDate(member.joinedGroupAt.slice(0, 10), locale)
      : "Not available yet",
  );
  const joinedAppDate = t(
    member.joinedAppAt
      ? friendlyDate(member.joinedAppAt.slice(0, 10), locale)
      : "Not available yet",
  );
  return (
    <Screen>
      <PageHeader
        eyebrow="Group profile"
        title={isSelf ? "Your public profile" : memberDisplayName(state, member)}
        translateTitle={isSelf}
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />

      <Card style={styles.hero}>
        <Avatar
          initials={member.initials}
          color={member.color}
          uri={member.avatarUri}
          size={76}
        />
        <View style={styles.heroCopy}>
          <Text translate={false} style={[styles.name, { color: colors.ink }]}>
            {memberDisplayName(state, member)}
          </Text>
          <Text style={[styles.role, { color: colors.muted }]}>
            {memberRoleLabel(member)} · <Text translate={false} style={styles.roleValue}>{state.group.name}</Text>
          </Text>
          <View style={styles.joinedMeta}>
            <Text numberOfLines={1} style={[styles.joinedMetaText, { color: colors.muted }]}>
              Joined group
              <Text translate={false} style={[styles.joinedMetaValue, { color: colors.faint }]}>
                {` · ${joinedGroupDate}`}
              </Text>
            </Text>
            <Text style={[styles.joinedMetaSeparator, { color: colors.faint }]}>|</Text>
            <Text numberOfLines={1} style={[styles.joinedMetaText, { color: colors.muted }]}>
              Joined HabHub
              <Text translate={false} style={[styles.joinedMetaValue, { color: colors.faint }]}>
                {` · ${joinedAppDate}`}
              </Text>
            </Text>
          </View>
          {member.lastDataSyncedAt ? (
            <Text style={[styles.sync, { color: colors.faint }]}>Last synced {relativeTime(member.lastDataSyncedAt)}</Text>
          ) : null}
        </View>
      </Card>

      {!isSelf ? (
        <Card style={styles.safetyCard}>
          <View style={styles.safetyHeading}>
            <View
              style={[
                styles.safetyIcon,
                { backgroundColor: colors.primarySoft },
              ]}
            >
              <Ionicons
                name={blocked ? "shield" : "shield-outline"}
                size={20}
                color={blocked ? palette.red : colors.primary}
              />
            </View>
            <View style={styles.heroCopy}>
              <Text style={[styles.levelTitle, { color: colors.ink }]}>Community safety</Text>
              <Text style={[styles.badgeDetail, { color: colors.muted }]}>
                {blocked
                  ? "Blocked · this member's messages are hidden on your device."
                  : "Report a concern or block contact without leaving this profile."}
              </Text>
            </View>
          </View>
          <View style={styles.safetyActions}>
            <Button
              label="Message"
              icon="chatbubble-outline"
              size="small"
              variant="secondary"
              disabled={blocked}
              onPress={() =>
                router.navigate({
                  pathname: "/chat",
                  params: { recipient: member.id },
                } as never)
              }
            />
            <Button
              label="Report member"
              icon="flag-outline"
              size="small"
              variant="ghost"
              disabled={safetyBusy}
              onPress={() => setReportOpen(true)}
            />
            <Button
              label={blocked ? "Unblock" : "Block"}
              icon={blocked ? "person-add-outline" : "person-remove-outline"}
              size="small"
              variant={blocked ? "ghost" : "danger"}
              loading={safetyBusy}
              onPress={confirmBlockChange}
            />
            <Button
              label="Safety Center"
              icon="shield-checkmark-outline"
              size="small"
              variant="ghost"
              onPress={() => router.push("/safety" as never)}
            />
          </View>
        </Card>
      ) : null}

      <Card style={styles.levelCard}>
        <View style={styles.levelHeading}>
          <View style={[styles.levelIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="ribbon-outline" size={19} color={colors.primary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.levelTitle, { color: colors.ink }]}>Level {level.level} · {level.levelTitle}</Text>
            <Text style={[styles.levelMeta, { color: colors.muted }]}>{level.xp.toLocaleString()} momentum XP</Text>
          </View>
          <Text style={[styles.levelPercent, { color: colors.primary }]}>{Math.round(level.levelProgress * 100)}%</Text>
        </View>
        <View style={[styles.levelTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.levelFill,
              {
                backgroundColor: colors.primary,
                width: `${Math.max(2, level.levelProgress * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.levelRemaining, { color: colors.faint }]}>
          {Math.max(0, level.nextLevelXp - level.xp).toLocaleString()} XP to level {level.level + 1}
        </Text>
        <View style={styles.competitiveGrid}>
          {competitiveStats.map((stat) => (
            <View key={stat.id} style={[styles.competitiveStat, { borderColor: colors.border }]}>
              <Ionicons name={stat.icon} size={15} color={colors.primary} />
              <Text style={[styles.competitiveValue, { color: colors.ink }]}>{stat.value}</Text>
              <Text style={[styles.competitiveLabel, { color: colors.muted }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.comparisonAction}>
        <Button
          label={isSelf ? "View your comparisons" : `Compare with ${memberDisplayName(state, member)}`}
          icon="stats-chart-outline"
          onPress={() =>
            router.navigate({ pathname: "/member/[id]", params: { id: member.id } } as never)
          }
        />
      </View>

      <TutorialTarget id="badge-showcase-picker">
        <View>
          <SectionHeader
            title="Badge showcase"
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isSelf ? "Edit badge showcase" : "View all badges"}
                onPress={() =>
                  router.navigate({
                    pathname: "/badges",
                    params: {
                      memberId: member.id,
                      anchor: new Date().toISOString().slice(0, 10),
                      filter: "achievement",
                      ...(isSelf ? { selectShowcase: "true" } : {}),
                    },
                  } as never)
                }
                style={[styles.badgeAction, { borderColor: colors.border }]}
              >
                <Ionicons
                  name={isSelf ? "create-outline" : "grid-outline"}
                  size={16}
                  color={colors.primary}
                />
                <Text style={[styles.badgeActionText, { color: colors.primary }]}>
                  {isSelf ? "Edit" : "All"}
                </Text>
              </Pressable>
            }
          />
          <Card style={styles.badges}>
        {badges.length ? (
          badges.map((badge) => (
            <View key={badge.id} style={[styles.badge, { borderLeftColor: badge.color }]}>
              <BadgeMedallion
                badge={badge}
                trackerIcon={
                  badge.metricId
                    ? (state.metrics.find((metric) => metric.id === badge.metricId)
                        ?.icon as typeof badge.icon | undefined)
                    : undefined
                }
                size={42}
              />
              <View style={styles.heroCopy}>
                <Text style={[styles.badgeTitle, { color: colors.ink }]}>{badge.title}</Text>
                <Text style={[styles.badgeDetail, { color: colors.muted }]}>{badge.caption}</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyBadges}>
            <Ionicons name="ribbon-outline" size={22} color={colors.faint} />
            <Text style={[styles.badgeDetail, { color: colors.muted }]}>No showcase badges earned yet.</Text>
          </View>
        )}
          </Card>
        </View>
      </TutorialTarget>
      <SafetyReportSheet
        visible={reportOpen}
        title="Report member"
        subject={memberDisplayName(state, member)}
        demoMode={safety.mode === "demo"}
        busy={safetyBusy}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, details) => void submitReport(reason, details)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 16, padding: 18, marginBottom: 12 },
  heroCopy: { flex: 1 },
  name: { fontSize: 20, fontWeight: "900" },
  role: { fontSize: 8, lineHeight: 11, marginTop: 3 },
  roleValue: { fontSize: 8, lineHeight: 11 },
  joinedMeta: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 5,
    marginTop: 5,
  },
  joinedMetaText: { flexShrink: 1, minWidth: 0, fontSize: 7.5, lineHeight: 11, fontWeight: "700" },
  joinedMetaValue: { fontSize: 7.5, lineHeight: 11, fontWeight: "700" },
  joinedMetaSeparator: { flexShrink: 0, fontSize: 7.5, lineHeight: 11, fontWeight: "700" },
  sync: { fontSize: 9, marginTop: 6 },
  safetyCard: { gap: 12, marginBottom: 12 },
  safetyHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  safetyIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  safetyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 7,
  },
  levelCard: { gap: 10, padding: 15, marginBottom: 12 },
  levelHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  levelIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  levelTitle: { fontSize: 12, fontWeight: "900" },
  levelMeta: { fontSize: 9, marginTop: 2 },
  levelPercent: { fontSize: 12, fontWeight: "900" },
  levelTrack: { height: 7, borderRadius: 5, overflow: "hidden" },
  levelFill: { height: "100%", borderRadius: 5 },
  levelRemaining: { fontSize: 8, fontWeight: "800", textAlign: "right", marginTop: -5 },
  comparisonAction: { marginBottom: 12 },
  competitiveGrid: { flexDirection: "row", gap: 7, marginTop: 2 },
  competitiveStat: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 3,
    paddingVertical: 7,
  },
  competitiveValue: { fontSize: 13, fontWeight: "900" },
  competitiveLabel: { fontSize: 7, lineHeight: 9, fontWeight: "800", textAlign: "center" },
  badgeAction: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  badgeActionText: { fontSize: 9, fontWeight: "900" },
  badges: { gap: 10, padding: 14 },
  badge: { flexDirection: "row", alignItems: "center", gap: 11, borderLeftWidth: 3, paddingVertical: 8, paddingLeft: 10 },
  badgeTitle: { fontSize: 11, fontWeight: "900", lineHeight: 15 },
  badgeDetail: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  emptyBadges: { alignItems: "center", gap: 8, padding: 20 },
  empty: { alignItems: "center", gap: 10, padding: 28 },
  emptyText: { maxWidth: 280, textAlign: "center", fontSize: 11, lineHeight: 16 },
});
