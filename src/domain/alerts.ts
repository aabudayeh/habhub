import { Ionicons } from "@expo/vector-icons";

import { dateKey, dateKeyWithOffset, friendlyDate } from "@/src/domain/date";
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
  const tracked = (state.group.metricConfiguration ?? []).filter(
    (metric) =>
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
    const prior = leaderboardRows(
      state,
      [metric],
      [yesterday],
      state.currentUserId,
      false,
    )[0];
    const changed = prior && prior.member.id !== current.member.id;
    return [
      {
        id: `lead-${metric.id}-${today}`,
        category: "lead",
        icon: metric.icon as PaceAlert["icon"],
        color: metric.color,
        title: changed
          ? `${memberDisplayName(state, current.member)} passed ${memberDisplayName(state, prior.member)}`
          : `${memberDisplayName(state, current.member)} leads ${metric.name}`,
        detail: changed
          ? `New #1 in ${metric.name} today.`
          : `Current ${metric.name} leader for ${friendlyDate(today)}.`,
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
                ? `Group message from ${memberDisplayName(state, sender)}`
                : `Direct message from ${memberDisplayName(state, sender)}`
              : "New message",
        detail: groupConversation
          ? `${state.group.name} · ${message.text || "Sent an image"}`
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
    return {
      id: `group-notification-${event.id}`,
      category: "challenge",
      icon: invitation ? "flag-outline" : "trophy-outline",
      color: invitation ? palette.primary : palette.lime,
      title: invitation ? "Challenge started" : "Challenge accepted",
      detail: invitation
        ? "Open HabHub to accept or decline."
        : "A friend accepted your challenge.",
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
