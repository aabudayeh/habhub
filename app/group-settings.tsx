import { Ionicons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import {
  isCloudGroupId,
} from "@/src/cloud/groupCloud";

import {
  Avatar,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { ColorSpectrumPicker } from "@/src/components/ColorSpectrumPicker";
import { useWebBeforeUnload } from "@/src/components/useWebBeforeUnload";
import {
  memberDisplayName,
  memberOriginalLabel,
  memberRoleLabel,
} from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { formulaIdentifiers } from "@/src/domain/formula";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";

export default function GroupSettings() {
  const {
    state,
    updateGroupMetric,
    deleteGroupMetric,
    setMemberRole,
    updateNickname,
    setGroupName,
    setGroupRestDays,
    setGroupTheme,
    setGroupApprovalRequired,
    flushLocalPersistence,
    approveMember,
    removeMember,
  } = useApp();
  const auth = useAuth();
  const cloud = useCloudSyncActions();
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language } = useLocalization();
  const me = state.group.members.find(
    (member) => member.id === state.currentUserId,
  )!;
  const canEdit = me.role === "owner" || me.role === "admin";
  const personalSetup = isPersonalSetupGroup(state.group);
  const groupMetrics = (state.group.metricConfiguration ?? []).filter(
    (metric) => !isInternalTracker(metric),
  );
  const visibleGroupMetrics = groupMetrics.filter(
    (metric) =>
      !["weekly_deficit_balance", "overall_score"].includes(metric.id),
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
  const [groupNameDraft, setGroupNameDraft] = useState(state.group.name);
  const [groupColorOpen, setGroupColorOpen] = useState(false);
  const [groupColorDraft, setGroupColorDraft] = useState(
    state.group.themeColor ?? palette.primary,
  );
  const observedGroupId = useRef(state.group.id);
  const observedGroupName = useRef(state.group.name);
  const allowExit = useRef(false);
  const closing = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      state.group.members.map((member) => [
        member.id,
        aliases[member.id] ?? "",
      ]),
    ),
  );
  const normalizedGroupName = groupNameDraft
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const currentGroupName = state.group.name
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const groupNameDirty =
    canEdit && normalizedGroupName !== currentGroupName;
  const nicknameDraftsDirty = state.group.members.some(
    (member) =>
      (drafts[member.id] ?? "").trim() !==
      (aliases[member.id] ?? "").trim(),
  );
  const canSaveGroupName = groupNameDirty && Boolean(normalizedGroupName);
  useWebBeforeUnload(
    () =>
      !allowExit.current && (groupNameDirty || nicknameDraftsDirty),
  );

  useEffect(() => {
    const groupChanged = observedGroupId.current !== state.group.id;
    const previousName = observedGroupName.current;
    observedGroupId.current = state.group.id;
    observedGroupName.current = state.group.name;
    setGroupNameDraft((current) =>
      groupChanged || current === previousName ? state.group.name : current,
    );
  }, [state.group.id, state.group.name]);

  useEffect(() => {
    setGroupColorDraft(state.group.themeColor ?? palette.primary);
    setGroupColorOpen(false);
  }, [state.group.id, state.group.themeColor]);

  function persistNicknameDrafts() {
    state.group.members.forEach((member) => {
      const next = (drafts[member.id] ?? "").trim();
      const current = (aliases[member.id] ?? "").trim();
      if (next !== current) updateNickname(member.id, next);
    });
  }

  async function flushAndExit(exit: () => void) {
    if (closing.current) return;
    closing.current = true;
    persistNicknameDrafts();
    try {
      // Group changes are reducer-first. Await the device snapshot before the
      // route disappears; cloud upload may safely happen later or offline.
      await flushLocalPersistence();
      allowExit.current = true;
      exit();
    } catch {
      closing.current = false;
      Alert.alert(
        "Could not save on this device",
        "Your changes are still open. Try closing Group settings again.",
      );
    }
  }

  async function saveName(exit?: () => void) {
    if (!canEdit) return;
    if (!normalizedGroupName) {
      Alert.alert("Name your group", "Enter a group name before saving.");
      return;
    }
    if (groupNameDirty) setGroupName(normalizedGroupName);
    setGroupNameDraft(normalizedGroupName);
    if (exit) {
      await flushAndExit(exit);
      return;
    }
    try {
      await flushLocalPersistence();
    } catch {
      Alert.alert(
        "Could not save on this device",
        "The name is still shown here. Tap Save to retry.",
      );
    }
  }

  function requestClose(exit: () => void = () => router.back()) {
    if (!groupNameDirty) {
      void flushAndExit(exit);
      return;
    }
    Alert.alert("Save group name?", "The new group name has not been saved.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => void flushAndExit(exit),
      },
      { text: "Save", onPress: () => void saveName(exit) },
    ]);
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (allowExit.current) return;
        event.preventDefault();
        requestCloseRef.current(() => navigation.dispatch(event.data.action));
      }),
    [navigation],
  );
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        allowExit.current = false;
        closing.current = false;
      }),
    [navigation],
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

  function updateApprovalRequirement(required: boolean) {
    // Group configuration is local-first. CloudSyncProvider observes the
    // workspace hash and retries this change when connectivity returns.
    setGroupApprovalRequired(required);
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

  function removeGroupMetric(metricId: string, metricName: string) {
    const dependencies = groupMetrics.filter(
      (metric) =>
        metric.formula &&
        formulaIdentifiers(metric.formula).includes(metricId),
    );
    if (dependencies.length) {
      Alert.alert(
        "Used by another tracker",
        `Remove it from ${dependencies.map((item) => item.name).join(", ")} first.`,
      );
      return;
    }
    Alert.alert(
      `Delete ${metricName}?`,
      "This removes the tracker from this group for every member. Existing shared entries for it are also removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete tracker",
          style: "destructive",
          onPress: () => deleteGroupMetric(metricId),
        },
      ],
    );
  }

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title="Group settings"
        tutorialId="group-settings"
        subtitle="Competition rules belong to this group and apply to every member."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => requestClose()}
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

      <SectionHeader title="Group name" />
      <Card style={styles.groupNameCard}>
        <View style={styles.groupNameRow}>
          <TextInput
            value={groupNameDraft}
            editable={canEdit}
            maxLength={80}
            onChangeText={setGroupNameDraft}
            onSubmitEditing={() => void saveName()}
            placeholder="Group name"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            selectTextOnFocus={canEdit}
            style={[
              styles.groupNameInput,
              {
                backgroundColor: colors.canvas,
                borderColor: groupNameDirty ? accent : colors.border,
                color: colors.ink,
              },
            ]}
          />
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              disabled={!canSaveGroupName}
              onPress={() => void saveName()}
              style={[
                styles.nameSave,
                {
                  backgroundColor: canSaveGroupName
                    ? colors.primarySoft
                    : "transparent",
                  borderColor: canSaveGroupName ? accent : colors.border,
                },
              ]}
            >
              <Ionicons
                name="checkmark"
                size={14}
                color={canSaveGroupName ? accent : colors.faint}
              />
              <Text
                style={[
                  styles.nameSaveText,
                  { color: canSaveGroupName ? accent : colors.faint },
                ]}
              >
                Save
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text
          style={[styles.meta, { color: colors.muted }]}
        >
          {canEdit
            ? groupNameDirty
              ? normalizedGroupName
                ? "Unsaved name"
                : "A group name is required"
              : "Shown to everyone in this group"
            : "Only the group owner or an admin can rename this group"}
        </Text>
      </Card>

      <SectionHeader title="Group color" />
      <Card style={styles.colorPicker}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: groupColorOpen }}
          accessibilityLabel={groupColorOpen ? "Hide group color picker" : "Show group color picker"}
          onPress={() => {
            if (groupColorOpen)
              setGroupColorDraft(state.group.themeColor ?? palette.primary);
            setGroupColorOpen((open) => !open);
          }}
          style={styles.colorDisclosure}
        >
          <View style={[styles.colorPreview, { backgroundColor: state.group.themeColor ?? palette.primary }]} />
          <View style={styles.copy}>
            <Text style={[styles.name, { color: colors.ink }]}>Shared accent</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {(state.group.themeColor ?? palette.primary).toUpperCase()} · {canEdit ? "Tap to customize" : "Admin managed"}
            </Text>
          </View>
          <Ionicons name={groupColorOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
        </Pressable>
        {groupColorOpen ? (
          <View style={[styles.colorPickerBody, { borderTopColor: colors.border }]}>
            <ColorSpectrumPicker
              value={groupColorDraft}
              disabled={!canEdit}
              onChange={setGroupColorDraft}
            />
            <View style={styles.colorFooter}>
              <Text style={[styles.meta, styles.colorHelp, { color: colors.muted }]}>
                {canEdit
                  ? "Apply once when the color is ready. Members can still choose a personal override."
                  : "Only a group admin can change the shared accent."}
              </Text>
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply group color"
                  disabled={groupColorDraft === (state.group.themeColor ?? palette.primary)}
                  onPress={() => {
                    setGroupTheme(groupColorDraft);
                    setGroupColorOpen(false);
                  }}
                  style={[
                    styles.colorApply,
                    {
                      backgroundColor: groupColorDraft === (state.group.themeColor ?? palette.primary)
                        ? colors.border
                        : accent,
                    },
                  ]}
                >
                  <Text style={styles.colorApplyText}>Apply</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
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
        {!visibleGroupMetrics.length ? (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No group trackers yet. Add a ready-made or custom tracker when this
            group is ready to compete.
          </Text>
        ) : null}
        {visibleGroupMetrics.map((metric, index, list) => {
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
                  <Text translate={false} style={[styles.name, { color: colors.ink }]}>
                    {localizeMetricName(language, metric)}
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
                    accessibilityLabel={`Delete ${metric.name}`}
                    onPress={() =>
                      removeGroupMetric(metric.id, metric.name)
                    }
                    style={[
                      styles.edit,
                      { backgroundColor: `${palette.red}12` },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={15}
                      color={palette.red}
                    />
                  </Pressable>
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
          disabled={!canEdit || state.group.streakRestDaysPerWeek <= 0}
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
          disabled={!canEdit || state.group.streakRestDaysPerWeek >= 4}
          onPress={() =>
            setGroupRestDays(state.group.streakRestDaysPerWeek + 1)
          }
          style={[styles.step, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="add" size={16} color={accent} />
        </Pressable>
      </Card>

      <SectionHeader title="Names in this group" />
      {canEdit && !personalSetup ? (
        <Card style={styles.status}>
          <View style={styles.copy}>
            <Text style={[styles.name, { color: colors.ink }]}>Allow members to join immediately</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>Turn off to approve each invite request first.</Text>
          </View>
          <Switch
            value={!state.group.requireMemberApproval}
            onValueChange={(allow) =>
              void updateApprovalRequirement(!allow)
            }
            trackColor={{ false: colors.border, true: `${accent}88` }}
            thumbColor={!state.group.requireMemberApproval ? accent : colors.faint}
          />
        </Card>
      ) : null}
      {canEdit &&
      !personalSetup &&
      (state.group.pendingMembers?.length ?? 0) > 0 ? (
        <>
          <SectionHeader title="Join requests" />
          <Card style={styles.list}>
            {state.group.pendingMembers!.map((member) => (
              <View key={member.id} style={styles.person}>
                <Avatar initials={member.initials} color={accent} size={36} uri={member.avatarUri} />
                <Text
                  translate={false}
                  style={[styles.name, styles.copy, { color: colors.ink }]}
                >
                  {member.name}
                </Text>
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
                <Text translate={false} style={[styles.name, { color: colors.ink }]}>
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
              <Text translate={false} style={[styles.role, { color: colors.muted }]}>
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
  groupNameCard: { gap: 5 },
  groupNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  groupNameInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 11,
    fontWeight: "800",
  },
  nameSave: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  nameSaveText: { fontSize: 9, fontWeight: "900" },
  copy: { flex: 1 },
  name: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  link: { fontSize: 10, fontWeight: "900" },
  colorPicker: { padding: 0, overflow: "hidden" },
  colorDisclosure: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, paddingVertical: 8 },
  colorPreview: { width: 30, height: 30, borderRadius: 10 },
  colorPickerBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 11, gap: 8 },
  colorFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  colorHelp: { flex: 1 },
  colorApply: { minHeight: 34, borderRadius: 11, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  colorApplyText: { color: palette.white, fontSize: 9, fontWeight: "900" },
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
  empty: { fontSize: 9, lineHeight: 14, paddingVertical: 14 },
});
