import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BadgeMedallion } from "@/src/components/BadgeMedallion";
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
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors } from "@/src/theme";

export default function GroupMemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useApp();
  const colors = useAppColors();
  const { locale, t } = useLocalization();
  const challengeCloud = useGroupChallenges(state.group.id);
  const settledChallengeResults = useSettledChallengeResults(state.group.id);
  const settledChallengeOccurrenceKeys =
    settledChallengeResults.occurrenceKeys;
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

  const isSelf = member.id === state.currentUserId;
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
            {memberRoleLabel(member)} · <Text translate={false}>{state.group.name}</Text>
          </Text>
          <View style={styles.joinedMeta}>
            <Text style={[styles.joinedMetaText, { color: colors.muted }]}>
              Joined group
              <Text translate={false} style={{ color: colors.faint }}>
                {` · ${joinedGroupDate}`}
              </Text>
            </Text>
            <Text style={[styles.joinedMetaSeparator, { color: colors.faint }]}>|</Text>
            <Text style={[styles.joinedMetaText, { color: colors.muted }]}>
              Joined HabHub
              <Text translate={false} style={{ color: colors.faint }}>
                {` · ${joinedAppDate}`}
              </Text>
            </Text>
          </View>
          {member.lastDataSyncedAt ? (
            <Text style={[styles.sync, { color: colors.faint }]}>Last synced {relativeTime(member.lastDataSyncedAt)}</Text>
          ) : null}
        </View>
      </Card>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 16, padding: 18, marginBottom: 12 },
  heroCopy: { flex: 1 },
  name: { fontSize: 20, fontWeight: "900" },
  role: { fontSize: 9, lineHeight: 12, marginTop: 3 },
  joinedMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: 6,
    rowGap: 2,
    marginTop: 5,
  },
  joinedMetaText: { flexShrink: 1, fontSize: 8.5, lineHeight: 12, fontWeight: "700" },
  joinedMetaSeparator: { fontSize: 8.5, lineHeight: 12, fontWeight: "700" },
  sync: { fontSize: 9, marginTop: 6 },
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
