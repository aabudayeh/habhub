import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import {
  Card,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { useApp } from "@/src/state/AppProvider";
import { useAuth } from "@/src/auth/AuthProvider";
import {
  disablePushNotifications,
  enablePushNotifications,
  updatePushPreferences,
} from "@/src/notifications/push";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { NotificationSettings } from "@/src/types";

export default function NotificationsScreen() {
  const { state, updateSettings } = useApp();
  const auth = useAuth();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const value = state.settings.notifications;
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [trackersOpen, setTrackersOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const registrationAttempted = useRef(false);
  const groupMetrics = (state.group.metricConfiguration ?? []).filter(
    (metric) => metric.scoreWeight > 0 && metric.dataType !== "text",
  );
  const reminderTrackers = state.metrics.filter(
    (metric) => metric.goalEnabled !== false && metric.dataType !== "text",
  );
  function patch(changes: Partial<NotificationSettings>) {
    updateSettings({ notifications: { ...value, ...changes } });
  }
  function toggleMetric(id: string) {
    patch({
      metricIds: value.metricIds.includes(id)
        ? value.metricIds.filter((item) => item !== id)
        : [...value.metricIds, id],
    });
  }
  useEffect(() => {
    if (!auth.user || !value.pushEnabled) return;
    if (registrationAttempted.current) {
      updatePushPreferences(auth.user.id, value);
      return;
    }
    registrationAttempted.current = true;
    enablePushNotifications(auth.user.id, value)
      .then(() =>
        setPermissionNote("This phone is registered for MetricRally notifications."),
      )
      .catch((error) => {
        setPermissionNote(
          error instanceof Error
            ? error.message
            : "This phone could not be registered.",
        );
        // Keep the user's preference enabled when system permission exists;
        // registration is retried on the next settings/foreground visit.
      });
  }, [auth.user, updateSettings, value]);
  async function togglePush() {
    const next = !value.pushEnabled;
    if (!next) {
      patch({ pushEnabled: false });
      if (auth.user) await disablePushNotifications(auth.user.id);
      setPermissionNote("Push delivery is off on this account.");
      return;
    }
    if (!auth.user) {
      patch({ pushEnabled: true });
      setPermissionNote(
        "Demo preferences are saved locally. Sign in to register this phone.",
      );
      return;
    }
    try {
      await enablePushNotifications(auth.user.id, {
        ...value,
        pushEnabled: true,
      });
      patch({ pushEnabled: true });
      setPermissionNote("This phone is registered for MetricRally notifications.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Permission could not be enabled.";
      setPermissionNote(message);
      Alert.alert("Notifications not enabled", message);
    }
  }
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        subtitle="Choose exactly what can interrupt you."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card>
        <ToggleRow
          icon="notifications"
          title="Push notifications"
          copy="Master switch for notifications on this device"
          enabled={value.pushEnabled}
          onPress={togglePush}
        />
        {permissionNote ? (
          <Text style={[styles.permissionNote, { color: colors.muted }]}>
            {permissionNote}
          </Text>
        ) : null}
      </Card>
      <CollapsibleTitle
        title="Group activity"
        open={groupOpen}
        onPress={() => setGroupOpen((open) => !open)}
      />
      {groupOpen ? <Card style={styles.list}>
        <ToggleRow
          icon="pulse-outline"
          title="Tracked activity"
          copy="Notify when friends log selected group items"
          enabled={value.groupMetricActivity}
          onPress={() =>
            patch({ groupMetricActivity: !value.groupMetricActivity })
          }
        />
        {groupMetrics.map((metric) => (
          <Pressable
            key={metric.id}
            disabled={!value.groupMetricActivity}
            onPress={() => toggleMetric(metric.id)}
            style={[
              styles.metric,
              !value.groupMetricActivity && styles.disabled,
            ]}
          >
            <View
              style={[
                styles.metricIcon,
                { backgroundColor: `${metric.color}18` },
              ]}
            >
              <Ionicons
                name={metric.icon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={metric.color}
              />
            </View>
            <Text style={[styles.metricName, { color: colors.ink }]}>
              {metric.name}
            </Text>
            <Ionicons
              name={
                value.metricIds.includes(metric.id)
                  ? "checkbox"
                  : "square-outline"
              }
              size={21}
              color={
                value.metricIds.includes(metric.id) ? accent : colors.faint
              }
            />
          </Pressable>
        ))}
      </Card> : null}
      <CollapsibleTitle
        title="Other notifications"
        open={otherOpen}
        onPress={() => setOtherOpen((open) => !open)}
      />
      {otherOpen ? <Card style={styles.list}>
        <ToggleRow
          icon="swap-vertical-outline"
          title="Lead changes"
          copy="Someone overtakes the leader in a tracked group item"
          enabled={value.leadChanges}
          onPress={() => patch({ leadChanges: !value.leadChanges })}
        />
        <ToggleRow
          icon="chatbubbles-outline"
          title="Chat messages"
          copy="Group and private messages; individual chats can also be muted in Chat"
          enabled={value.chatMessages}
          onPress={() => patch({ chatMessages: !value.chatMessages })}
        />
        <ToggleRow
          icon="flame-outline"
          title="Streak updates"
          copy="Useful milestones for any active goal"
          enabled={value.streakAlerts !== false}
          onPress={() => patch({ streakAlerts: value.streakAlerts === false })}
        />
        <ToggleRow
          icon="heart-dislike-outline"
          title="Goal recovery nudges"
          copy="A gentle prompt after repeated missed days"
          enabled={value.missedGoalNudges !== false}
          onPress={() =>
            patch({ missedGoalNudges: value.missedGoalNudges === false })
          }
        />
        <ToggleRow
          icon="trophy-outline"
          title="Badges & winners"
          copy="Awards and finalized period winners"
          enabled={value.badgesAndWinners}
          onPress={() => patch({ badgesAndWinners: !value.badgesAndWinners })}
        />
        <ToggleRow
          icon="alarm-outline"
          title="Logging reminders"
          copy="Your configured daily reminders"
          enabled={value.reminders}
          onPress={() => patch({ reminders: !value.reminders })}
        />
        <ToggleRow
          icon="barbell-outline"
          title="Gym reminders"
          copy={`Private prompt after ${value.gymReminderDays ?? 3} days without a completed workout`}
          enabled={value.gymReminders !== false}
          onPress={() => patch({ gymReminders: value.gymReminders === false })}
        />
        <ToggleRow
          icon="sparkles-outline"
          title="Gym encouragement"
          copy="Personal-best and completed-workout encouragement on this device"
          enabled={value.gymAchievements !== false}
          onPress={() =>
            patch({ gymAchievements: value.gymAchievements === false })
          }
        />
        {value.gymReminders !== false ? (
          <View style={styles.times}>
            <Text style={[styles.label, { color: colors.muted }]}>
              Prompt after
            </Text>
            {[2, 3, 4, 7].map((days) => (
              <Pressable
                key={days}
                onPress={() => patch({ gymReminderDays: days })}
              >
                <Text
                  style={{
                    color:
                      (value.gymReminderDays ?? 3) === days
                        ? accent
                        : colors.muted,
                    fontWeight: "900",
                  }}
                >
                  {days} days
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <ToggleRow
          icon="calendar-outline"
          title="Upcoming period estimate"
          copy={`Private reminder ${value.cycleReminderDays ?? 2} days before the rolling estimate`}
          enabled={value.cyclePredictions !== false}
          onPress={() => patch({ cyclePredictions: value.cyclePredictions === false })}
        />
        <ToggleRow
          icon="flower-outline"
          title="Cycle phase updates"
          copy="Optional phase estimates based on logged cycle history"
          enabled={value.cyclePhaseUpdates === true}
          onPress={() => patch({ cyclePhaseUpdates: value.cyclePhaseUpdates !== true })}
        />
        {value.cyclePredictions !== false ? (
          <View style={styles.times}>
            <Text style={[styles.label, { color: colors.muted }]}>Period estimate timing</Text>
            {[1, 2, 3, 5].map((days) => (
              <Pressable key={days} onPress={() => patch({ cycleReminderDays: days })}>
                <Text style={{ color: (value.cycleReminderDays ?? 2) === days ? accent : colors.muted, fontWeight: "900" }}>{days} day{days === 1 ? "" : "s"} before</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card> : null}
      <CollapsibleTitle
        title="Tracker reminders"
        open={trackersOpen}
        onPress={() => setTrackersOpen((open) => !open)}
      />
      {trackersOpen ? (
        <Card style={styles.list}>
          {reminderTrackers.map((metric) => {
            const reminders = metric.reminders?.length
              ? metric.reminders
              : metric.reminder
                ? [metric.reminder]
                : [];
            const active = reminders.filter((item) => item.enabled);
            return (
              <Pressable
                key={metric.id}
                onPress={() =>
                  router.navigate({
                    pathname: "/metric-editor",
                    params: { id: metric.id, focus: "notifications" },
                  } as never)
                }
                style={[styles.metric, { borderBottomColor: colors.border }]}
              >
                <View
                  style={[
                    styles.metricIcon,
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
                  <Text style={[styles.metricName, { color: colors.ink }]}>
                    {metric.name}
                  </Text>
                  <Text style={[styles.copyText, { color: colors.muted }]}>
                    {active.length
                      ? active.map((item) => item.time).join(" · ")
                      : "Reminders off"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            );
          })}
        </Card>
      ) : null}
      <CollapsibleTitle
        title="Quiet hours"
        open={quietOpen}
        onPress={() => setQuietOpen((open) => !open)}
      />
      {quietOpen ? <Card>
        <ToggleRow
          icon="moon-outline"
          title="Quiet hours"
          copy="Hold non-urgent alerts during this window"
          enabled={value.quietHoursEnabled}
          onPress={() => patch({ quietHoursEnabled: !value.quietHoursEnabled })}
        />
        {value.quietHoursEnabled ? (
          <View style={styles.times}>
            <View style={styles.time}>
              <Text style={[styles.label, { color: colors.muted }]}>From</Text>
              <TextInput
                value={value.quietHoursStart}
                onChangeText={(quietHoursStart) => patch({ quietHoursStart })}
                style={[
                  styles.input,
                  {
                    color: colors.ink,
                    borderColor: colors.border,
                    backgroundColor: colors.canvas,
                  },
                ]}
              />
            </View>
            <View style={styles.time}>
              <Text style={[styles.label, { color: colors.muted }]}>Until</Text>
              <TextInput
                value={value.quietHoursEnd}
                onChangeText={(quietHoursEnd) => patch({ quietHoursEnd })}
                style={[
                  styles.input,
                  {
                    color: colors.ink,
                    borderColor: colors.border,
                    backgroundColor: colors.canvas,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
      </Card> : null}
      <Text style={[styles.note, { color: colors.muted }]}>
        The installed app requests system permission and registers this phone.
        Expo Go on Android cannot receive remote push notifications; use an EAS
        development or release build.
      </Text>
    </Screen>
  );
}

function CollapsibleTitle({
  title,
  open,
  onPress,
}: {
  title: string;
  open: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable onPress={onPress} style={styles.collapseTitle}>
      <Text style={[styles.collapseTitleText, { color: colors.ink }]}>
        {title}
      </Text>
      <Ionicons
        name={open ? "chevron-up" : "chevron-down"}
        size={18}
        color={accent}
      />
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  copy,
  enabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  enabled: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.copyText, { color: colors.muted }]}>{copy}</Text>
      </View>
      <View
        style={[
          styles.toggle,
          { backgroundColor: colors.border },
          enabled && styles.toggleOn,
          enabled && { backgroundColor: accent },
        ]}
      >
        <View style={[styles.knob, enabled && styles.knobOn]} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  collapseTitle: {
    minHeight: 40,
    marginTop: 8,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  collapseTitleText: { fontSize: 12, fontWeight: "900" },
  list: { paddingVertical: 4, paddingHorizontal: 13 },
  row: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  copyText: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 2 },
  toggle: {
    width: 43,
    height: 25,
    borderRadius: 13,
    padding: 3,
    backgroundColor: "#D9DFDA",
  },
  toggleOn: { backgroundColor: palette.primary },
  knob: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: palette.white,
  },
  knobOn: { marginLeft: 18 },
  permissionNote: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 8,
  },
  metric: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  metricName: { flex: 1, color: palette.ink, fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  times: { flexDirection: "row", gap: 10, marginTop: 12 },
  time: { flex: 1 },
  label: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "800",
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    padding: 10,
    color: palette.ink,
    textAlign: "center",
    fontWeight: "800",
  },
  note: {
    color: palette.muted,
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 13,
  },
});
