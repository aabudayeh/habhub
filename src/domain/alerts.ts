import { Ionicons } from "@expo/vector-icons";

import { dateKey, dateKeyWithOffset, friendlyDate } from "@/src/domain/date";
import { leaderboardRows } from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import { palette } from "@/src/theme";
import { AppState } from "@/src/types";

export type AlertCategory = "lead" | "message" | "achievement";
export type PaceAlert = {
  id: string;
  category: AlertCategory;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  detail: string;
  createdAt: string;
  memberId?: string;
};
export function buildAlerts(state: AppState): PaceAlert[] {
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
            ? "MetricRally update"
            : sender
              ? `Message from ${memberDisplayName(state, sender)}`
              : "New message",
        detail: message.text || "Sent an image",
        createdAt: message.createdAt,
        memberId: sender?.id,
      };
    });
  return [...leads, ...messages].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
