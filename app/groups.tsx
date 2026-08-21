import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";

import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  groupInviteMessage,
  validGroupInviteCode,
} from "@/src/domain/invites";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { shareText } from "@/src/lib/shareText";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export default function GroupsScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const { state, joinGroup, switchGroup, leaveGroup } = useApp();
  const auth = useAuth();
  const cloud = useCloudSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<
    "join" | "switch" | "leave" | null
  >(null);
  const activeMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManage =
    activeMember?.role === "owner" || activeMember?.role === "admin";
  const activeIsPersonal = isPersonalSetupGroup(state.group);
  const inviteReady = validGroupInviteCode(state.group.inviteCode);

  async function shareInvite() {
    if (tutorialSandbox) return;
    if (activeIsPersonal) return;
    if (!inviteReady) {
      await cloud.refreshGroup().catch(() => undefined);
      Alert.alert(
        "Invite is still preparing",
        "The group was refreshed. Try sharing again in a moment.",
      );
      return;
    }
    try {
      const result = await shareText(
        groupInviteMessage(state.group.name, state.group.inviteCode),
        `Join ${state.group.name} on HabHub`,
      );
      if (result === "copied")
        Alert.alert("Invite copied", "The invite link is ready to paste.");
    } catch (error) {
      Alert.alert(
        "Could not share invite",
        error instanceof Error ? error.message : "Copy the group code instead.",
      );
    }
  }

  async function join() {
    if (!validGroupInviteCode(code))
      return Alert.alert(
        "Valid invite code needed",
        "Enter the group code a friend shared.",
      );
    setBusy("join");
    try {
      if (auth.status === "signedIn") {
        const status = await cloud.joinGroup(code);
        if (status === "pending")
          Alert.alert("Request sent", "A group admin must approve you before the group appears.");
      } else joinGroup(code);
      setCode("");
    } catch (error) {
      Alert.alert("Could not join group", cloudErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  async function openGroup(groupId: string) {
    if (groupId === state.group.id) return;
    setBusy("switch");
    try {
      if (auth.status === "signedIn" && isCloudGroupId(groupId))
        await cloud.switchGroup(groupId);
      else switchGroup(groupId);
    } catch (error) {
      Alert.alert("Could not open group", cloudErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  function confirmLeave(groupId: string, groupName: string) {
    const leavingGroup = state.groups.find((group) => group.id === groupId);
    if (!leavingGroup || isPersonalSetupGroup(leavingGroup))
      return Alert.alert(
        "Personal setup stays private",
        "It is your non-shareable home group and cannot be left.",
      );
    Alert.alert(
      `Leave ${groupName}?`,
      "You will stop seeing this group until you join again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            if (auth.status === "signedIn" && isCloudGroupId(groupId)) {
              setBusy("leave");
              cloud
                .leaveGroup(groupId)
                .catch((error) =>
                  Alert.alert(
                    "Could not leave group",
                    cloudErrorMessage(error),
                  ),
                )
                .finally(() => setBusy(null));
            } else leaveGroup(groupId);
          },
        },
      ],
    );
  }

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <PageHeader
        eyebrow="Memberships"
        title="Your groups"
        subtitle="Switch groups without losing personal logs."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <TutorialTarget id="groups-list">
      <View style={styles.list}>
        {cloud.pendingGroup ? (
          <Card style={[styles.group, { borderColor: accent }]}>
            <View
              style={[styles.icon, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="time-outline" size={20} color={accent} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>
                {cloud.pendingGroup.groupName ?? "Invited group"}
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                Pending admin approval
              </Text>
            </View>
            <Text style={[styles.active, { color: accent }]}>PENDING</Text>
          </Card>
        ) : null}
        {state.groups.map((group) => {
          const active = group.id === state.group.id;
          const personal = isPersonalSetupGroup(group);
          const member = group.members.find(
            (item) => item.id === state.currentUserId,
          );
          return (
            <Pressable
              key={group.id}
              disabled={busy === "switch"}
              onPress={() => openGroup(group.id)}
            >
              <Card
                style={[
                  styles.group,
                  active && {
                    borderColor: accent,
                    borderWidth: 2,
                    backgroundColor: colors.card,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: active ? accent : colors.primarySoft },
                  ]}
                >
                  <Ionicons
                    name="people"
                    size={20}
                    color={active ? palette.white : accent}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: colors.ink }]}>
                    {group.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {personal
                      ? "Private personal setup"
                      : `${group.members.length} members · ${
                          member?.role === "owner" ? "Admin" : "Member"
                        } · ${group.inviteCode}`}
                  </Text>
                </View>
                {active ? (
                  <Text style={[styles.active, { color: accent }]}>ACTIVE</Text>
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={colors.faint}
                  />
                )}
                {!personal ? (
                  <Pressable
                    accessibilityLabel={`Leave ${group.name}`}
                    onPress={() => confirmLeave(group.id, group.name)}
                    style={styles.leave}
                  >
                    <Ionicons name="exit-outline" size={18} color={palette.red} />
                  </Pressable>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </View>
      </TutorialTarget>
      <Card style={styles.invite}>
        <View style={styles.group}>
          <Avatar
            initials={state.group.name.slice(0, 2).toUpperCase()}
            color={accent}
          />
          <View style={styles.copy}>
            <Text translate={false} style={[styles.title, { color: colors.ink }]}>
              {state.group.name}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {activeIsPersonal
                ? "Private to you · invite sharing is off"
                : inviteReady
                ? `Invite code ${state.group.inviteCode}`
                : "Preparing secure invite…"}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          {!activeIsPersonal ? (
            <View style={styles.actionButton}>
              <Button
                label="Share invite"
                icon="share-outline"
                variant="secondary"
                size="small"
                onPress={shareInvite}
              />
            </View>
          ) : null}
          {canManage ? (
            <View style={styles.actionButton}>
              <Button
                label="Group settings"
                icon="settings-outline"
                size="small"
                onPress={() => router.navigate("/group-settings" as never)}
              />
            </View>
          ) : null}
        </View>
      </Card>
      <SectionHeader title="Create a group" />
      <Card>
        <Text style={[styles.setupCopy, { color: colors.muted }]}>
          Review suggested trackers, choose a color, and decide how invite
          requests work before anything is added.
        </Text>
        <Button
          label="Set up a new group"
          icon="options-outline"
          onPress={() => router.navigate("/create-group" as never)}
        />
      </Card>
      <SectionHeader title="Join with a code" />
      <Card>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="PACE-7K2M"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <Button
          label="Join and switch"
          icon="enter-outline"
          loading={busy === "join"}
          onPress={join}
        />
      </Card>
    </Screen>
  );
}

function cloudErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return "The cloud server rejected the request. Try again.";
}

const styles = StyleSheet.create({
  list: { gap: 7 },
  group: { flexDirection: "row", alignItems: "center", gap: 9, padding: 10 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 12, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  active: { fontSize: 7, fontWeight: "900" },
  leave: { padding: 6 },
  invite: { marginTop: 10, gap: 9 },
  buttons: { flexDirection: "row", gap: 7 },
  actionButton: { flex: 1, minWidth: 0 },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 11,
    marginBottom: 8,
  },
  setupCopy: { fontSize: 10, lineHeight: 15, marginBottom: 10 },
});
