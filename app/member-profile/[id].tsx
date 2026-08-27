import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { buildBadges } from "@/src/domain/badges";
import { friendlyDate, relativeTime } from "@/src/domain/date";
import { memberDisplayName, memberRoleLabel } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors } from "@/src/theme";

export default function GroupMemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useApp();
  const colors = useAppColors();
  const member = state.group.members.find((candidate) => candidate.id === id);
  const badges = useMemo(
    () => {
      if (!member) return [];
      const earned = buildBadges(state).filter(
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
    [member, state],
  );

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
          {member.lastDataSyncedAt ? (
            <Text style={[styles.sync, { color: colors.faint }]}>Last synced {relativeTime(member.lastDataSyncedAt)}</Text>
          ) : null}
        </View>
      </Card>

      <View style={styles.joinedGrid}>
        <JoinedCard
          icon="people-outline"
          label="Joined group"
          value={member.joinedGroupAt ? friendlyDate(member.joinedGroupAt.slice(0, 10)) : "Not available yet"}
        />
        <JoinedCard
          icon="sparkles-outline"
          label="Joined HabHub"
          value={member.joinedAppAt ? friendlyDate(member.joinedAppAt.slice(0, 10)) : "Not available yet"}
        />
      </View>

      <Button
        label={isSelf ? "View your comparisons" : `Compare with ${memberDisplayName(state, member)}`}
        icon="stats-chart-outline"
        onPress={() =>
          router.navigate({ pathname: "/member/[id]", params: { id: member.id } } as never)
        }
      />

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
              <View style={[styles.badgeIcon, { backgroundColor: `${badge.color}1F` }]}>
                <Ionicons name={badge.icon} size={19} color={badge.color} />
              </View>
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

function JoinedCard({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const colors = useAppColors();
  return (
    <Card style={styles.joinedCard}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[styles.joinedLabel, { color: colors.faint }]}>{label}</Text>
      <Text style={[styles.joinedValue, { color: colors.ink }]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  heroCopy: { flex: 1 },
  name: { fontSize: 20, fontWeight: "900" },
  role: { fontSize: 10, marginTop: 3 },
  sync: { fontSize: 9, marginTop: 5 },
  joinedGrid: { flexDirection: "row", gap: 8 },
  joinedCard: { flex: 1, minHeight: 98, gap: 5, padding: 12 },
  joinedLabel: { fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  joinedValue: { fontSize: 11, fontWeight: "900" },
  badgeAction: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  badgeActionText: { fontSize: 9, fontWeight: "900" },
  badges: { gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 9, borderLeftWidth: 3, paddingVertical: 5, paddingLeft: 9 },
  badgeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  badgeTitle: { fontSize: 11, fontWeight: "900" },
  badgeDetail: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  emptyBadges: { alignItems: "center", gap: 7, padding: 18 },
  empty: { alignItems: "center", gap: 10, padding: 28 },
  emptyText: { maxWidth: 280, textAlign: "center", fontSize: 11, lineHeight: 16 },
});
