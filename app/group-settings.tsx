import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import { isCloudGroupId } from "@/src/cloud/groupCloud";

import {
  Avatar,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  memberDisplayName,
  memberOriginalLabel,
  memberRoleLabel,
} from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { isInternalTracker } from "@/src/domain/trackerCatalog";

const GROUP_COLORS = [
  "#176B4D",
  "#3478D4",
  "#7756D9",
  "#C45B35",
  "#9B3F72",
  "#2A8F86",
  "#59636E",
  "#8A6A24",
];

export default function GroupSettings() {
  const {
    state,
    updateGroupMetric,
    setMemberRole,
    updateNickname,
    setGroupRestDays,
    setGroupTheme,
    setGroupApprovalRequired,
    approveMember,
    removeMember,
  } = useApp();
  const auth = useAuth();
  const cloud = useCloudSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const me = state.group.members.find(
    (member) => member.id === state.currentUserId,
  )!;
  const canEdit = me.role === "owner" || me.role === "admin";
  const groupMetrics = (state.group.metricConfiguration ?? []).filter(
    (metric) => !isInternalTracker(metric),
  );
  const total = groupMetrics.reduce(
    (sum, metric) =>
      sum +
      (metric.sections.group &&
      metric.dataType !== "text" &&
      metric.dataType !== "photo"
        ? metric.scoreWeight
        : 0),
    0,
  );
  const aliases = state.settings.memberNicknamesByGroup?.[state.group.id] ?? {};
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      state.group.members.map((member) => [
        member.id,
        aliases[member.id] ?? "",
      ]),
    ),
  );

  function toggleRole(memberId: string, current: "owner" | "admin" | "member") {
    if (me.role !== "owner" || current === "owner") return;
    const role = current === "admin" ? "member" : "admin";
    Alert.alert(
      role === "admin" ? "Make this person an admin?" : "Remove admin access?",
      "Group admins can change competition scoring and settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => setMemberRole(memberId, role) },
      ],
    );
  }

  async function approve(memberId: string) {
    if (auth.status === "signedIn" && isCloudGroupId(state.group.id))
      await cloud.approveMember(memberId);
    else approveMember(memberId);
  }

  async function remove(memberId: string) {
    const action = async () => {
      if (auth.status === "signedIn" && isCloudGroupId(state.group.id))
        await cloud.removeMember(memberId);
      else removeMember(memberId);
    };
    Alert.alert("Remove this member?", "They can request to join again later.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void action() },
    ]);
  }

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        title="Group settings"
        subtitle="Competition rules belong to this group and apply to every member."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.status}>
        <Ionicons name="shield-checkmark" size={22} color={accent} />
        <View style={styles.copy}>
          <Text style={[styles.name, { color: colors.ink }]}>
            {canEdit ? "You can edit this group" : "View-only configuration"}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {memberRoleLabel(me)} · changes stay with this group
          </Text>
        </View>
      </Card>

      <SectionHeader title="Group color" />
      <Card style={styles.colors}>
        {GROUP_COLORS.map((color) => (
          <Pressable
            key={color}
            disabled={!canEdit}
            onPress={() => setGroupTheme(color)}
            style={[
              styles.swatch,
              { backgroundColor: color },
              (state.group.themeColor ?? palette.primary) === color && {
                borderColor: colors.ink,
                borderWidth: 3,
              },
            ]}
          >
            {(state.group.themeColor ?? palette.primary) === color ? (
              <Ionicons name="checkmark" size={17} color={palette.white} />
            ) : null}
          </Pressable>
        ))}
      </Card>

      <SectionHeader
        title="Group competition"
        action={
          canEdit ? (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() =>
                  groupMetrics.forEach((metric) =>
                    updateGroupMetric(metric.id, {
                      scoreWeight:
                        metric.dataType === "text" ||
                        metric.dataType === "photo"
                          ? 0
                          : Math.max(metric.scoreWeight, 10),
                      sections: { ...metric.sections, group: true },
                    }),
                  )
                }
              >
                <Text style={[styles.smallLink, { color: accent }]}>All</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  groupMetrics.forEach((metric) =>
                    updateGroupMetric(metric.id, {
                      scoreWeight: 0,
                      sections: { ...metric.sections, group: false },
                    }),
                  )
                }
              >
                <Text style={[styles.smallLink, { color: accent }]}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  router.navigate({
                    pathname: "/metric-editor",
                    params: { id: "new", scope: "group" },
                  })
                }
              >
                <Text style={[styles.link, { color: accent }]}>+ Add</Text>
              </Pressable>
            </View>
          ) : undefined
        }
      />
      <Card style={styles.list}>
        {groupMetrics
          .filter(
            (metric) =>
              !["weekly_deficit_balance", "overall_score"].includes(metric.id),
          )
          .map((metric, index, list) => {
            const competitive =
              metric.dataType !== "text" && metric.dataType !== "photo";
            const tracked = competitive
              ? metric.scoreWeight > 0 && metric.sections.group
              : metric.sections.group;
            return (
              <View
                key={metric.id}
                style={[
                  styles.metric,
                  index < list.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: `${metric.color}18` },
                  ]}
                >
                  <Ionicons
                    name={metric.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={metric.color}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.name, { color: colors.ink }]}>
                    {metric.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {!competitive
                      ? "Shared group item"
                      : tracked
                        ? `${total ? Math.round((metric.scoreWeight / total) * 100) : 0}% of group score`
                        : "Not ranked by this group"}
                  </Text>
                </View>
                {canEdit && tracked && competitive ? (
                  <View style={styles.weightControl}>
                    <Pressable
                      onPress={() =>
                        updateGroupMetric(metric.id, {
                          scoreWeight: Math.max(1, metric.scoreWeight - 5),
                        })
                      }
                      style={[
                        styles.step,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Ionicons name="remove" size={15} color={accent} />
                    </Pressable>
                    <Text style={[styles.weight, { color: colors.ink }]}>
                      {metric.scoreWeight}
                    </Text>
                    <Pressable
                      onPress={() =>
                        updateGroupMetric(metric.id, {
                          scoreWeight: Math.min(100, metric.scoreWeight + 5),
                        })
                      }
                      style={[
                        styles.step,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Ionicons name="add" size={15} color={accent} />
                    </Pressable>
                  </View>
                ) : null}
                {canEdit ? (
                  <Pressable
                    accessibilityLabel={`Edit ${metric.name}`}
                    onPress={() =>
                      router.navigate({
                        pathname: "/metric-editor",
                        params: { id: metric.id, scope: "group" },
                      })
                    }
                    style={[
                      styles.edit,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons name="create-outline" size={15} color={accent} />
                  </Pressable>
                ) : null}
                <Switch
                  disabled={!canEdit}
                  value={tracked}
                  onValueChange={(value) =>
                    updateGroupMetric(metric.id, {
                      scoreWeight: competitive && value ? 10 : 0,
                      sections: { ...metric.sections, group: value },
                    })
                  }
                  trackColor={{ false: colors.border, true: `${accent}88` }}
                  thumbColor={tracked ? accent : colors.faint}
                />
              </View>
            );
          })}
      </Card>
      <Text style={[styles.help, { color: colors.muted }]}>
        Weights are normalized to a maximum score of 100. Personal targets and
        Today layouts remain individual.
      </Text>

      <SectionHeader title="Streak rest days" />
      <Card style={styles.status}>
        <View style={styles.copy}>
          <Text style={[styles.name, { color: colors.ink }]}>
            Allowed per seven days
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            A missed day can preserve the group streak until this allowance is
            used.
          </Text>
        </View>
        <Pressable
          disabled={!canEdit}
          onPress={() =>
            setGroupRestDays(state.group.streakRestDaysPerWeek - 1)
          }
          style={[styles.step, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="remove" size={16} color={accent} />
        </Pressable>
        <Text style={[styles.rest, { color: colors.ink }]}>
          {state.group.streakRestDaysPerWeek}
        </Text>
        <Pressable
          disabled={!canEdit}
          onPress={() =>
            setGroupRestDays(state.group.streakRestDaysPerWeek + 1)
          }
          style={[styles.step, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="add" size={16} color={accent} />
        </Pressable>
      </Card>

      <SectionHeader title="Names in this group" />
      {canEdit ? (
        <Card style={styles.status}>
          <View style={styles.copy}>
            <Text style={[styles.name, { color: colors.ink }]}>Allow members to join immediately</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>Turn off to approve each invite request first.</Text>
          </View>
          <Switch
            value={!state.group.requireMemberApproval}
            onValueChange={(allow) => setGroupApprovalRequired(!allow)}
            trackColor={{ false: colors.border, true: `${accent}88` }}
            thumbColor={!state.group.requireMemberApproval ? accent : colors.faint}
          />
        </Card>
      ) : null}
      {canEdit && (state.group.pendingMembers?.length ?? 0) > 0 ? (
        <>
          <SectionHeader title="Join requests" />
          <Card style={styles.list}>
            {state.group.pendingMembers!.map((member) => (
              <View key={member.id} style={styles.person}>
                <Avatar initials={member.initials} color={accent} size={36} uri={member.avatarUri} />
                <Text style={[styles.name, styles.copy, { color: colors.ink }]}>{member.name}</Text>
                <Pressable onPress={() => void approve(member.id)}><Text style={[styles.role, { color: accent }]}>Approve</Text></Pressable>
                <Pressable onPress={() => void remove(member.id)}><Text style={[styles.role, { color: palette.red }]}>Decline</Text></Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <Card style={styles.list}>
        {state.group.members.map((member, index) => (
          <View
            key={member.id}
            style={[
              styles.person,
              index < state.group.members.length - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: 1,
              },
            ]}
          >
            <Pressable
              onPress={() => router.navigate(`/member/${member.id}` as never)}
            >
              <Avatar
                initials={member.initials}
                color={member.color}
                size={36}
                uri={member.avatarUri}
              />
            </Pressable>
            <View style={styles.copy}>
              <Pressable
                onPress={() => router.navigate(`/member/${member.id}` as never)}
              >
                <Text style={[styles.name, { color: colors.ink }]}>
                  {member.name}
                  {member.id === state.currentUserId ? " · You" : ""}
                </Text>
              </Pressable>
              <TextInput
                value={drafts[member.id] ?? ""}
                onChangeText={(value) =>
                  setDrafts((current) => ({ ...current, [member.id]: value }))
                }
                onBlur={() =>
                  updateNickname(member.id, drafts[member.id] ?? "")
                }
                placeholder="Nickname in this group"
                placeholderTextColor={colors.faint}
                style={[
                  styles.input,
                  { color: colors.ink, borderColor: colors.border },
                ]}
              />
            </View>
            {me.role === "owner" && member.role !== "owner" ? (
              <Pressable onPress={() => toggleRole(member.id, member.role)}>
                <Text style={[styles.role, { color: accent }]}>
                  {member.role === "admin" ? "Admin" : "Make admin"}
                </Text>
              </Pressable>
            ) : (
              <Text style={[styles.role, { color: colors.muted }]}>
                {memberDisplayName(state, member) !== member.name
                  ? memberOriginalLabel(state, member)
                  : memberRoleLabel(member)}
              </Text>
            )}
            {canEdit &&
            member.role !== "owner" &&
            member.id !== state.currentUserId &&
            (me.role === "owner" || member.role === "member") ? (
              <Pressable onPress={() => void remove(member.id)} style={styles.removeMember}>
                <Ionicons name="person-remove-outline" size={16} color={palette.red} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  smallLink: { fontSize: 9, fontWeight: "900" },
  status: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  name: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  link: { fontSize: 10, fontWeight: "900" },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingVertical: 2, paddingHorizontal: 11 },
  metric: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  edit: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  weightControl: { flexDirection: "row", alignItems: "center", gap: 3 },
  step: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  weight: { width: 24, textAlign: "center", fontSize: 10, fontWeight: "900" },
  help: { fontSize: 8, lineHeight: 13, paddingHorizontal: 5, marginTop: 5 },
  rest: { width: 25, textAlign: "center", fontSize: 16, fontWeight: "900" },
  person: { minHeight: 63, flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 9,
    fontSize: 9,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  role: { fontSize: 8, fontWeight: "900", maxWidth: 70, textAlign: "right" },
  removeMember: { padding: 5 },
});
