import { Ionicons } from "@expo/vector-icons";

import { dateKey, dateKeyWithOffset, dateRangeEnding } from "@/src/domain/date";
import { leaderboardRows } from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import { buildGroupRecapFeed } from "@/src/domain/recaps";
import { todoAppearsOnDate, todoResolvedOnDate } from "@/src/domain/schedule";
import { todayHeroSummary } from "@/src/domain/todayHero";
import { palette } from "@/src/theme";
import {
  AppState,
  GroupNotificationEvent,
} from "@/src/types";

export type AlertCategory =
  | "today"
  | "lead"
  | "message"
  | "achievement"
  | "challenge";
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
  /** Explicit unread state; absence means this alert has no durable read cursor. */
  unread?: boolean;
  challengeId?: string;
  challengeOccurrenceDate?: string;
  groupId?: string;
  metricId?: string;
  entryId?: string;
  localDate?: string;
  todoId?: string;
  targetType?: "metric_entry" | "photo_update";
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
  const personalProgress = state.settings.notifications.reminders
    ? todayHeroSummary(state, state.currentUserId, today).goalProgress
        .filter(
          (goal) =>
            !goal.unavailable &&
            goal.progress > 0 &&
            (allowedMetricIds.length === 0 || allowedMetricIds.includes(goal.id)),
        )
        .sort((left, right) => right.progress - left.progress)
        .slice(0, 8)
        .map((goal): PaceAlert => {
          const percentage = Math.round(goal.progress * 100);
          return {
            id: `today-progress-${goal.id}-${today}-${percentage}`,
            category: "today",
            icon: goal.metric.icon as PaceAlert["icon"],
            color: goal.metric.color,
            title:
              percentage >= 100
                ? `${goal.metric.name} goal reached`
                : `${goal.metric.name} is ${percentage}% complete`,
            detail:
              percentage >= 100
                ? "Nice work. Open the tracker to see today's progress."
                : `${Math.max(0, 100 - percentage)}% remains for today's goal.`,
            createdAt: `${today}T12:00:00.000`,
            scope: "personal",
            metricId: goal.id,
            localDate: today,
          };
        })
    : [];
  const personalTodos = state.settings.notifications.todoReminders !== false
    ? (state.todos ?? [])
        .filter(
          (todo) =>
            !todo.parentId &&
            todoAppearsOnDate(todo, today) &&
            !todoResolvedOnDate(todo, today),
        )
        .sort((left, right) =>
          (left.dueAt ?? left.scheduledStartAt ?? left.createdAt).localeCompare(
            right.dueAt ?? right.scheduledStartAt ?? right.createdAt,
          ),
        )
        .slice(0, 6)
        .map((todo): PaceAlert => ({
          id: `today-todo-${todo.id}-${today}`,
          category: "today",
          icon: "checkbox-outline",
          color: palette.primary,
          title: todo.title,
          detail: todo.dueAt?.startsWith(today)
            ? "Due today · tap to find this to-do."
            : "On today's to-do list.",
          createdAt:
            todo.dueAt?.startsWith(today) ||
            todo.scheduledStartAt?.startsWith(today)
              ? todo.dueAt ?? todo.scheduledStartAt!
              : `${today}T08:00:00.000`,
          scope: "personal",
          todoId: todo.id,
          localDate: today,
        }))
    : [];
  const trackerUpdatesEnabled =
    groupPreferences?.enabled !== false &&
    (groupPreferences?.trackerUpdates ?? notifications.groupMetricActivity);
  const groupActivity = trackerUpdatesEnabled
    ? buildGroupRecapFeed(state, dateRangeEnding(today, 7))
        .filter(
          (item) =>
            item.memberId !== state.currentUserId &&
            Boolean(item.memberId) &&
            Boolean(item.metricId) &&
            ["log", "meal", "workout", "photo"].includes(item.kind) &&
            (!Array.isArray(allowedMemberIds) ||
              allowedMemberIds.includes(item.memberId!)) &&
            (allowedMetricIds.length === 0 ||
              allowedMetricIds.includes(item.metricId!)),
        )
        .slice(0, 24)
        .map((item): PaceAlert => ({
          id: `group-activity-${item.id}`,
          category: "lead",
          icon: item.icon as PaceAlert["icon"],
          color: item.color,
          title: item.title,
          detail: [item.value, item.body].filter(Boolean).join(" · "),
          createdAt: item.createdAt,
          memberId: item.memberId,
          scope: "group",
          metricId: item.metricId,
          entryId:
            item.socialTarget.type === "metric_entry"
              ? item.socialTarget.id
              : undefined,
          localDate: item.localDate,
        }))
    : [];
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
      const readAt =
        notifications.chatReadAtByConversation?.[conversation] ??
        (groupConversation
          ? notifications.chatReadAtByConversation?.[
              `group:${state.group.id}`
            ]
          : undefined);
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
        unread:
          !achievement &&
          message.senderId !== state.currentUserId &&
          (!readAt || message.createdAt > readAt),
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
    const socialReaction = event.kind === "social_reaction";
    return {
      id: `group-notification-${event.id}`,
      category: socialReaction ? "lead" : "challenge",
      icon: socialReaction
        ? event.reaction === "thumbs_down"
          ? "thumbs-down-outline"
          : event.reaction === "thumbs_up"
            ? "thumbs-up-outline"
            : "heart-outline"
        : invitation
        ? "flag-outline"
        : allAccepted
          ? "checkmark-circle-outline"
          : result
            ? "trophy-outline"
            : reminder
              ? "flame-outline"
              : "swap-vertical-outline",
      color: socialReaction
        ? palette.red
        : invitation
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
              ? `${actor ? memberDisplayName(state, actor) : "A friend"} accepted your challenge.`
              : "Open the Leaderboard for the latest challenge standings."),
      createdAt: event.createdAt,
      memberId: actor?.id,
      scope: "group",
      readAt: event.readAt,
      unread: !event.readAt,
      challengeId: event.challengeId,
      challengeOccurrenceDate: event.occurrenceDate,
      groupId: event.groupId,
      entryId: event.targetId,
      localDate: event.occurrenceDate,
      targetType: event.targetType,
    };
  });
  return [
    ...personalProgress,
    ...personalTodos,
    ...leads,
    ...groupActivity,
    ...messages,
    ...challengeEvents,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
