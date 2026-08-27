import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { router, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
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
import {
  acceptedChallengeParticipantIds,
  groupChallengeAvailability,
  groupChallengeJoinDeadline,
  groupChallengeParticipation,
  groupChallengeSourceId,
} from "@/src/domain/groupChallenges";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { isPersonalSetupGroup } from "@/src/domain/groupSetup";
import { formatMetricValue } from "@/src/domain/metrics";
import type {
  GroupChallenge,
  GroupNotificationPreferences,
} from "@/src/types";

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
    setGroupTodosEnabled,
    updateSettings,
    flushLocalPersistence,
    approveMember,
    removeMember,
  } = useApp();
  const auth = useAuth();
  const cloud = useCloudSyncActions();
  const routeFocused = useIsFocused();
  const challengeCloud = useGroupChallenges(state.group.id, {
    discoverActive: true,
    discoveryPollingEnabled: routeFocused,
  });
  const navigation = useNavigation();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language, locale, t } = useLocalization();
  const format = (source: string, values: Record<string, string | number>) => {
    let output = t(source);
    Object.entries(values).forEach(([key, value]) => {
      output = output.replaceAll(`{${key}}`, String(value));
    });
    return output;
  };
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationMembersOpen, setNotificationMembersOpen] = useState(false);
  const [notificationTrackersOpen, setNotificationTrackersOpen] = useState(false);
  const [joiningChallengeId, setJoiningChallengeId] = useState<string>();
  const [challengeJoinError, setChallengeJoinError] = useState<string>();
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
  const notifications = state.settings.notifications;
  const groupNotificationPreferences =
    notifications.groupPreferencesByGroup?.[state.group.id] ?? {};
  const availableNotificationMemberIds = new Set(
    state.group.members
      .filter((member) => member.id !== state.currentUserId)
      .map((member) => member.id),
  );
  const notificationMemberIds = (
    groupNotificationPreferences.memberIds ??
    [...availableNotificationMemberIds]
  ).filter((memberId) => availableNotificationMemberIds.has(memberId));
  const availableNotificationMetricIds = new Set(
    visibleGroupMetrics.map((metric) => metric.id),
  );
  const notificationMetricIds = (
    groupNotificationPreferences.metricIds ?? notifications.metricIds
  ).filter((metricId) => availableNotificationMetricIds.has(metricId));
  const today = dateKey();
  const activeChallenges = useMemo(() => {
    const bySource = new Map<string, GroupChallenge>();
    for (const challenge of challengeCloud.challenges) {
      if (groupChallengeAvailability(challenge, today) === "finished")
        continue;
      const sourceId = groupChallengeSourceId(challenge);
      if (!bySource.has(sourceId)) bySource.set(sourceId, challenge);
    }
    return [...bySource.values()].sort((left, right) => {
      const leftAvailability = groupChallengeAvailability(left, today);
      const rightAvailability = groupChallengeAvailability(right, today);
      if (leftAvailability !== rightAvailability)
        return leftAvailability === "active" ? -1 : 1;
      return (
        left.localDate.localeCompare(right.localDate) ||
        left.id.localeCompare(right.id)
      );
    });
  }, [challengeCloud.challenges, today]);
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

  useEffect(() => {
    setJoiningChallengeId(undefined);
    setChallengeJoinError(undefined);
  }, [state.group.id]);

  function persistNicknameDrafts() {
    state.group.members.forEach((member) => {
      const next = (drafts[member.id] ?? "").trim();
      const current = (aliases[member.id] ?? "").trim();
      if (next !== current) updateNickname(member.id, next);
    });
  }

  function patchGroupNotifications(
    changes: Partial<GroupNotificationPreferences>,
  ) {
    updateSettings({
      notifications: {
        ...notifications,
        groupPreferencesByGroup: {
          ...(notifications.groupPreferencesByGroup ?? {}),
          [state.group.id]: {
            ...groupNotificationPreferences,
            ...changes,
          },
        },
      },
    });
  }

  function toggleNotificationMember(memberId: string) {
    patchGroupNotifications({
      memberIds: notificationMemberIds.includes(memberId)
        ? notificationMemberIds.filter((id) => id !== memberId)
        : [...notificationMemberIds, memberId],
    });
  }

  function toggleNotificationMetric(metricId: string) {
    patchGroupNotifications({
      metricIds: notificationMetricIds.includes(metricId)
        ? notificationMetricIds.filter((id) => id !== metricId)
        : [...notificationMetricIds, metricId],
    });
  }

  async function joinChallenge(challenge: GroupChallenge) {
    const sourceId = groupChallengeSourceId(challenge);
    if (joiningChallengeId) return;
    setJoiningChallengeId(sourceId);
    setChallengeJoinError(undefined);
    try {
      // The server atomically verifies active group membership, capacity, and
      // the challenge deadline before adding only this authenticated user.
      await challengeCloud.respond(sourceId, "accepted");
      await challengeCloud.refresh();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Could not join this challenge.";
      setChallengeJoinError(message);
      await challengeCloud.refresh();
      Alert.alert("Could not join challenge", message);
    } finally {
      setJoiningChallengeId(undefined);
    }
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

      <SectionHeader title="Group notifications" />
      <Card style={styles.notificationCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: notificationsOpen }}
          onPress={() => setNotificationsOpen((open) => !open)}
          style={styles.notificationDisclosure}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="notifications-outline" size={18} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.name, { color: colors.ink }]}>Personal alerts for this group</Text>
            <Text translate={false} style={[styles.meta, { color: colors.muted }]}>{t("Choose updates, people, trackers and challenge pace without changing anyone else's settings.")}</Text>
          </View>
          <Ionicons name={notificationsOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
        </Pressable>
        {notificationsOpen ? (
          <View style={[styles.notificationBody, { borderTopColor: colors.border }]}>
            <NotificationPreferenceRow
              title="Group alerts"
              detail="Master switch for activity and challenge updates from this group"
              value={groupNotificationPreferences.enabled !== false}
              onValueChange={(enabled) => patchGroupNotifications({ enabled })}
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Shared tracker progress"
              detail="When selected members add a shared tracker entry"
              value={
                groupNotificationPreferences.trackerUpdates ??
                groupNotificationPreferences.progressUpdates ??
                notifications.groupMetricActivity
              }
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(trackerUpdates) =>
                patchGroupNotifications({
                  trackerUpdates,
                  progressUpdates: undefined,
                })
              }
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Lead changes"
              detail="First-place changes in selected leaderboard trackers"
              value={
                groupNotificationPreferences.leadChanges ??
                notifications.leadChanges
              }
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(leadChanges) =>
                patchGroupNotifications({ leadChanges })
              }
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Challenge updates"
              detail="Invitations and accepted challenge changes"
              value={groupNotificationPreferences.challengeUpdates !== false}
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(challengeUpdates) =>
                patchGroupNotifications({ challengeUpdates })
              }
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Challenge standings"
              detail="Lead gained or lost and the gap to the next person"
              value={groupNotificationPreferences.challengeStandings !== false}
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(challengeStandings) =>
                patchGroupNotifications({ challengeStandings })
              }
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Challenge encouragement"
              detail="Occasional reminders scaled to challenge duration"
              value={groupNotificationPreferences.challengeReminders !== false}
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(challengeReminders) =>
                patchGroupNotifications({ challengeReminders })
              }
              colors={colors}
              accent={accent}
            />
            <NotificationPreferenceRow
              title="Challenge results"
              detail="Completion and winner notification when the period ends"
              value={groupNotificationPreferences.challengeResults !== false}
              disabled={groupNotificationPreferences.enabled === false}
              onValueChange={(challengeResults) =>
                patchGroupNotifications({ challengeResults })
              }
              colors={colors}
              accent={accent}
            />

            <View
              style={[
                styles.activeChallengesBlock,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.activeChallengesHeader}>
                <View style={styles.copy}>
                  <Text style={[styles.preferenceLabel, { color: colors.ink }]}>Active challenges</Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>Live and upcoming challenges in this group</Text>
                </View>
                {activeChallenges.length ? (
                  <Text style={[styles.activeChallengeCount, { color: accent }]}>{activeChallenges.length}</Text>
                ) : null}
              </View>

              {challengeCloud.loading && !activeChallenges.length ? (
                <Text style={[styles.activeChallengeEmpty, { color: colors.muted }]}>Checking active challenges…</Text>
              ) : null}
              {!challengeCloud.loading &&
              !challengeCloud.error &&
              !activeChallenges.length ? (
                <Text style={[styles.activeChallengeEmpty, { color: colors.muted }]}>No live or upcoming challenges.</Text>
              ) : null}
              {challengeCloud.error ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setChallengeJoinError(undefined);
                    void challengeCloud.refresh();
                  }}
                  style={styles.activeChallengeError}
                >
                  <Text style={[styles.activeChallengeErrorText, { color: palette.red }]}>{challengeCloud.error}</Text>
                  <Text style={[styles.activeChallengeRetry, { color: accent }]}>Retry</Text>
                </Pressable>
              ) : null}
              {challengeJoinError ? (
                <Text style={[styles.activeChallengeErrorText, { color: palette.red }]}>{challengeJoinError}</Text>
              ) : null}

              {activeChallenges.map((challenge) => {
                const availability = groupChallengeAvailability(challenge, today);
                const participation =
                  challenge.viewerParticipation ??
                  groupChallengeParticipation(challenge, state.currentUserId);
                const joined =
                  participation === "creator" || participation === "accepted";
                const alreadyParticipant = participation !== "not_invited";
                const participantCount =
                  challenge.participantCount ?? challenge.participantIds.length;
                const full = challenge.isFull ?? participantCount >= 50;
                const canJoin =
                  challenge.eligibleToJoin ??
                  (!joined && (alreadyParticipant || !full));
                const sourceId = groupChallengeSourceId(challenge);
                const joining = joiningChallengeId === sourceId;
                const metric = groupMetrics.find(
                  (candidate) => candidate.id === challenge.metricId,
                );
                const metricName = metric
                  ? localizeMetricName(language, metric)
                  : challenge.metricId;
                const title = challenge.title?.trim() || metricName;
                const goalLabel =
                  challenge.target === undefined
                    ? "Highest total"
                    : `Target ${
                        metric
                          ? formatMetricValue(metric, challenge.target)
                          : challenge.target
                      }`;
                const joinDeadline = groupChallengeJoinDeadline(challenge);
                const timing = challenge.recurrence
                  ? `Repeats until ${friendlyDate(joinDeadline, locale)}`
                  : challenge.localDate === joinDeadline
                    ? friendlyDate(challenge.localDate, locale)
                    : `${friendlyDate(challenge.localDate, locale)}–${friendlyDate(joinDeadline, locale)}`;
                const joinedCount =
                  challenge.acceptedParticipantCount ??
                  acceptedChallengeParticipantIds(challenge).length;
                return (
                  <View
                    key={sourceId}
                    style={[
                      styles.activeChallengeRow,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <View style={[styles.activeChallengeIcon, { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name="flag-outline" size={15} color={accent} />
                    </View>
                    <View style={styles.copy}>
                      <View style={styles.activeChallengeTitleRow}>
                        <Text
                          translate={false}
                          numberOfLines={1}
                          style={[styles.activeChallengeTitle, { color: colors.ink }]}
                        >
                          {title}
                        </Text>
                        <View
                          style={[
                            styles.activeChallengeState,
                            {
                              backgroundColor:
                                availability === "active"
                                  ? `${accent}18`
                                  : colors.canvas,
                              borderColor:
                                availability === "active" ? accent : colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.activeChallengeStateText,
                              {
                                color:
                                  availability === "active" ? accent : colors.muted,
                              },
                            ]}
                          >
                            {availability === "active" ? "LIVE" : "UPCOMING"}
                          </Text>
                        </View>
                      </View>
                      <Text
                        translate={false}
                        numberOfLines={2}
                        style={[styles.activeChallengeMeta, { color: colors.muted }]}
                      >
                        {metricName} · {goalLabel} · {timing} · {joinedCount} joined
                      </Text>
                    </View>
                    {joined ? (
                      <View style={[styles.challengeJoined, { backgroundColor: colors.primarySoft }]}>
                        <Ionicons name="checkmark-circle" size={13} color={accent} />
                        <Text style={[styles.challengeJoinedText, { color: accent }]}>Joined</Text>
                      </View>
                    ) : !canJoin ? (
                      <View style={[styles.challengeJoined, { backgroundColor: colors.canvas }]}>
                        <Text style={[styles.challengeJoinedText, { color: colors.muted }]}>{full ? "Full" : "Unavailable"}</Text>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={format("Join {value}", { value: title })}
                        disabled={Boolean(joiningChallengeId)}
                        onPress={() => void joinChallenge(challenge)}
                        style={[
                          styles.challengeJoin,
                          {
                            backgroundColor: colors.primarySoft,
                            borderColor: accent,
                            opacity: joiningChallengeId && !joining ? 0.5 : 1,
                          },
                        ]}
                      >
                        {joining ? (
                          <Ionicons name="sync" size={13} color={accent} />
                        ) : (
                          <Ionicons name="add" size={13} color={accent} />
                        )}
                        <Text style={[styles.challengeJoinText, { color: accent }]}>{joining ? "Joining…" : "Join"}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.preferenceBlock}>
              <Text style={[styles.preferenceLabel, { color: colors.ink }]}>Challenge reminder pace</Text>
              <View style={styles.segmentRow}>
                {(["minimal", "balanced", "frequent"] as const).map((cadence) => {
                  const selected =
                    (groupNotificationPreferences.challengeCadence ?? "balanced") === cadence;
                  return (
                    <Pressable
                      key={cadence}
                      disabled={
                        groupNotificationPreferences.enabled === false ||
                        groupNotificationPreferences.challengeReminders === false
                      }
                      onPress={() =>
                        patchGroupNotifications({ challengeCadence: cadence })
                      }
                      style={[
                        styles.segment,
                        {
                          backgroundColor: selected ? colors.primarySoft : colors.canvas,
                          borderColor: selected ? accent : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.segmentText, { color: selected ? accent : colors.muted }]}>
                        {cadence[0].toUpperCase() + cadence.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <NotificationFilter
              title="Members"
              detail={`${notificationMemberIds.length} of ${Math.max(0, state.group.members.length - 1)} selected`}
              open={notificationMembersOpen}
              onToggle={() => setNotificationMembersOpen((open) => !open)}
              colors={colors}
            >
              <View style={styles.chips}>
                {state.group.members
                  .filter((member) => member.id !== state.currentUserId)
                  .map((member) => {
                    const selected = notificationMemberIds.includes(member.id);
                    return (
                      <Pressable
                        key={member.id}
                        onPress={() => toggleNotificationMember(member.id)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? colors.primarySoft : colors.canvas,
                            borderColor: selected ? accent : colors.border,
                          },
                        ]}
                      >
                        <Text translate={false} style={[styles.chipText, { color: selected ? accent : colors.muted }]}>
                          {memberDisplayName(state, member)}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            </NotificationFilter>
            <NotificationFilter
              title="Trackers"
              detail={`${notificationMetricIds.length} of ${visibleGroupMetrics.length} selected`}
              open={notificationTrackersOpen}
              onToggle={() => setNotificationTrackersOpen((open) => !open)}
              colors={colors}
            >
              <View style={styles.chips}>
                {visibleGroupMetrics.map((metric) => {
                  const selected = notificationMetricIds.includes(metric.id);
                  return (
                    <Pressable
                      key={metric.id}
                      onPress={() => toggleNotificationMetric(metric.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? `${metric.color}18` : colors.canvas,
                          borderColor: selected ? metric.color : colors.border,
                        },
                      ]}
                    >
                      <Text translate={false} style={[styles.chipText, { color: selected ? metric.color : colors.muted }]}>
                        {localizeMetricName(language, metric)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </NotificationFilter>
            <Text style={[styles.notificationHelp, { color: colors.muted }]}>System permission and quiet hours stay in global Notifications. These choices only refine this group.</Text>
          </View>
        ) : null}
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

      <SectionHeader title="Group To-Dos" />
      <Card style={styles.status}>
        <View style={styles.copy}>
          <Text style={[styles.name, { color: colors.ink }]}>Shared task lists</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Members can create nested tasks, complete them together or
            individually, and share them in group chat. Off by default.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Enable group to-dos"
          disabled={!canEdit || personalSetup}
          value={state.group.groupTodosEnabled === true}
          onValueChange={setGroupTodosEnabled}
          trackColor={{ false: colors.border, true: `${accent}88` }}
          thumbColor={state.group.groupTodosEnabled ? accent : colors.faint}
        />
      </Card>
      {!canEdit && !personalSetup ? (
        <Text style={[styles.help, { color: colors.muted }]}>Only a group owner or admin can change this setting.</Text>
      ) : null}

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
              onPress={() => router.navigate(`/member-profile/${member.id}` as never)}
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
                onPress={() => router.navigate(`/member-profile/${member.id}` as never)}
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

function NotificationPreferenceRow({
  title,
  detail,
  value,
  disabled,
  onValueChange,
  colors,
  accent,
}: {
  title: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <View
      style={[
        styles.preferenceRow,
        { borderBottomColor: colors.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <View style={styles.copy}>
        <Text style={[styles.name, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>{detail}</Text>
      </View>
      <Switch
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: `${accent}88` }}
        thumbColor={value ? accent : colors.faint}
      />
    </View>
  );
}

function NotificationFilter({
  title,
  detail,
  open,
  onToggle,
  colors,
  children,
}: {
  title: string;
  detail: string;
  open: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useAppColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.filterBlock, { borderTopColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.filterDisclosure}
      >
        <View style={styles.copy}>
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{detail}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  smallLink: { fontSize: 9, fontWeight: "900" },
  status: { flexDirection: "row", alignItems: "center", gap: 10 },
  notificationCard: { padding: 0, overflow: "hidden" },
  notificationDisclosure: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, paddingVertical: 9 },
  notificationBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11, paddingBottom: 11 },
  preferenceRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  activeChallengesBlock: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  activeChallengesHeader: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 5 },
  activeChallengeCount: { minWidth: 24, textAlign: "center", fontSize: 9, fontWeight: "900" },
  activeChallengeEmpty: { fontSize: 8, lineHeight: 12, paddingVertical: 7 },
  activeChallengeError: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  activeChallengeErrorText: { flex: 1, fontSize: 8, lineHeight: 12 },
  activeChallengeRetry: { fontSize: 8, fontWeight: "900" },
  activeChallengeRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 7, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  activeChallengeIcon: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  activeChallengeTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  activeChallengeTitle: { flexShrink: 1, minWidth: 0, fontSize: 9, fontWeight: "900" },
  activeChallengeState: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2 },
  activeChallengeStateText: { fontSize: 6, fontWeight: "900" },
  activeChallengeMeta: { fontSize: 7, lineHeight: 10, marginTop: 2 },
  challengeJoined: { minHeight: 28, borderRadius: 9, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  challengeJoinedText: { fontSize: 7, fontWeight: "900" },
  challengeJoin: { minHeight: 30, borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  challengeJoinText: { fontSize: 8, fontWeight: "900" },
  preferenceBlock: { gap: 7, paddingVertical: 10 },
  preferenceLabel: { fontSize: 10, fontWeight: "900" },
  segmentRow: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, minHeight: 32, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 8, fontWeight: "900" },
  filterBlock: { borderTopWidth: StyleSheet.hairlineWidth },
  filterDisclosure: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 10 },
  chip: { minHeight: 30, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 8, fontWeight: "900" },
  notificationHelp: { fontSize: 8, lineHeight: 12, marginTop: 4 },
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
