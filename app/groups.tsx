import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

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
import { groupInviteMessage } from "@/src/domain/invites";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export default function GroupsScreen() {
  const { state, createGroup, joinGroup, switchGroup, leaveGroup } = useApp();
  const auth = useAuth();
  const cloud = useCloudSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<
    "create" | "join" | "switch" | "leave" | null
  >(null);
  const activeMember = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  const canManage =
    activeMember?.role === "owner" || activeMember?.role === "admin";

  async function create() {
    if (!name.trim())
      return Alert.alert("Name your group", "Enter a group name first.");
    setBusy("create");
    try {
      if (auth.status === "signedIn") await cloud.createGroup(name);
      else createGroup(name);
      setName("");
    } catch (error) {
      Alert.alert("Could not create group", cloudErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  async function join() {
    if (!code.trim())
      return Alert.alert(
        "Invite code needed",
        "Enter the code a friend shared.",
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
    if (state.groups.length <= 1)
      return Alert.alert(
        "Keep one group",
        "Create or join another group first.",
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
      <View style={styles.list}>
        {state.groups.map((group) => {
          const active = group.id === state.group.id;
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
                    backgroundColor: colors.primarySoft,
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
                    {group.members.length} members ·{" "}
                    {member?.role === "owner" ? "Admin" : "Member"} ·{" "}
                    {group.inviteCode}
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
                <Pressable
                  accessibilityLabel={`Leave ${group.name}`}
                  onPress={() => confirmLeave(group.id, group.name)}
                  style={styles.leave}
                >
                  <Ionicons name="exit-outline" size={18} color={palette.red} />
                </Pressable>
              </Card>
            </Pressable>
          );
        })}
      </View>
      <Card style={styles.invite}>
        <View style={styles.group}>
          <Avatar
            initials={state.group.name.slice(0, 2).toUpperCase()}
            color={accent}
          />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              {state.group.name}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Invite code {state.group.inviteCode}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <Button
            label="Share invite"
            icon="share-outline"
            variant="secondary"
            onPress={() =>
              Share.share({
                message: groupInviteMessage(
                  state.group.name,
                  state.group.inviteCode,
                ),
              })
            }
          />
          {canManage ? (
            <Button
              label="Group settings"
              icon="settings-outline"
              onPress={() => router.navigate("/group-settings" as never)}
            />
          ) : null}
        </View>
      </Card>
      <SectionHeader title="Create a group" />
      <Card>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Office Step League"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <Button
          label={
            auth.status === "signedIn"
              ? "Create cloud group"
              : "Create and switch"
          }
          icon="add"
          loading={busy === "create"}
          onPress={create}
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
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 11,
    marginBottom: 8,
  },
});
