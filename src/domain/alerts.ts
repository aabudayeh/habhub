import { Ionicons } from "@expo/vector-icons";

import { dateKey, dateKeyWithOffset } from "@/src/domain/date";
import { leaderboardRows } from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import { palette } from "@/src/theme";
import {
  AppState,
  GroupNotificationEvent,
} from "@/src/types";

export type AlertCategory = "lead" | "message" | "achievement" | "challenge";
export type PaceAlert = {
  id: string;
  category: AlertCategory;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  detail: string;
  createdAt: string;
  memberId?: string;
  scope: "personal" | "group";
  readAt?: string;
};
export function buildAlerts(
  state: AppState,
  groupNotificationEvents: GroupNotificationEvent[] = [],
): PaceAlert[] {
  const today = dateKey();
  const yesterday = dateKeyWithOffset(-1);
  const notifications = state.settings.notifications;
  const groupPreferences =
    notifications.groupPreferencesByGroup?.[state.group.id];
  const leadAlertsEnabled =
    groupPreferences?.enabled !== false &&
    (groupPreferences?.leadChanges ?? notifications.leadChanges);
  const allowedMetricIds =
    groupPreferences?.metricIds ?? notifications.metricIds;
  const allowedMemberIds = groupPreferences?.memberIds;
  const tracked = (state.group.metricConfiguration ?? []).filter(
    (metric) =>
      leadAlertsEnabled &&
      allowedMetricIds.includes(metric.id) &&
      metric.scoreWeight > 0 &&
      metric.sections.group &&
      metric.dataType !== "text" &&
      metric.dataType !== "photo",
  );
  const leads = tracked.flatMap((metric): PaceAlert[] => {
    const current = leaderboardRows(
      state,
      [metric],
      [today],
      state.currentUserId,
      false,
    )[0];
    if (!current) return [];
    if (
      Array.isArray(allowedMemberIds) &&
      !allowedMemberIds.includes(current.member.id)
    )
      return [];
    const prior = leaderboardRows(
      state,
      [metric],
      [yesterday],
      state.currentUserId,
      false,
    )[0];
    const changed = prior && prior.member.id !== current.member.id;
    if (!changed) return [];
    return [
      {
        id: `lead-${metric.id}-${today}`,
        category: "lead",
        icon: metric.icon as PaceAlert["icon"],
        color: metric.color,
        title: `${memberDisplayName(state, current.member)} passed ${memberDisplayName(state, prior.member)}`,
        detail: `New #1 in ${metric.name} today.`,
        createdAt: `${today}T12:00:00`,
        memberId: current.member.id,
        scope: "group",
      },
    ];
  });
  const messages = state.messages
    .filter((message) => {
      const conversation = message.conversationId ?? "group";
      return (
        conversation === `group:${state.group.id}` ||
        conversation === "group" ||
        message.senderId === state.currentUserId ||
        message.recipientId === state.currentUserId
      );
    })
    .slice(-12)
    .map((message): PaceAlert => {
      const sender = state.group.members.find(
        (member) => member.id === message.senderId,
      );
      const achievement = message.kind === "achievement";
      const conversation = message.conversationId ?? "group";
      const groupConversation =
        conversation === "group" ||
        conversation === `group:${state.group.id}`;
      return {
        id: `message-${message.id}`,
        category: achievement ? "achievement" : "message",
        icon: message.imageUri
          ? "image-outline"
          : achievement
            ? "trophy-outline"
            : "chatbubble-outline",
        color: achievement ? palette.amber : palette.primary,
        title:
          message.senderId === "system"
            ? "HabHub update"
            : sender
              ? groupConversation
                ? `Group message in ${state.group.name}`
                : `Direct message from ${memberDisplayName(state, sender)}`
              : "New message",
        detail: groupConversation
          ? `${sender ? memberDisplayName(state, sender) : "A group member"}: ${message.text || "Sent an image"}`
          : message.text || "Sent an image",
        createdAt: message.createdAt,
        memberId: sender?.id,
        scope: groupConversation || achievement ? "group" : "personal",
      };
    });
  const challengeEvents = groupNotificationEvents.map((event): PaceAlert => {
    const actor = state.group.members.find(
      (member) => member.id === event.actorId,
    );
    const invitation = event.kind === "challenge_invitation";
    const accepted = event.kind === "challenge_accepted";
    const allAccepted = event.kind === "challenge_all_accepted";
    const result = event.kind === "challenge_result";
    const reminder = event.kind === "challenge_reminder";
    return {
      id: `group-notification-${event.id}`,
      category: "challenge",
      icon: invitation
        ? "flag-outline"
        : allAccepted
          ? "checkmark-circle-outline"
          : result
            ? "trophy-outline"
            : reminder
              ? "flame-outline"
              : "swap-vertical-outline",
      color: invitation
        ? palette.primary
        : result
          ? palette.amber
          : palette.lime,
      title:
        event.title ??
        (invitation
          ? "Challenge started"
          : allAccepted
            ? "Everyone is in"
            : accepted
              ? "Challenge accepted"
              : reminder
                ? "Keep pushing"
                : result
                  ? "Challenge complete"
                  : "Challenge standings changed"),
      detail:
        event.detail ??
        (invitation
          ? "Open HabHub to accept or decline."
          : allAccepted
            ? "Everyone accepted the challenge."
            : accepted
              ? "A friend accepted your challenge."
              : "Open the Leaderboard for the latest challenge standings."),
      createdAt: event.createdAt,
      memberId: actor?.id,
      scope: "group",
      readAt: event.readAt,
    };
  });
  return [...leads, ...messages, ...challengeEvents].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
