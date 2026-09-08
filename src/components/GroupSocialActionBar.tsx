import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  type GroupSocialComment,
  type GroupSocialReaction,
  type GroupSocialReactionKind,
} from "@/src/cloud/groupSocial";
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { CheerIcon } from "@/src/components/CheerIcon";
import { memberDisplayName } from "@/src/domain/members";
import { relativeTime } from "@/src/domain/date";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { AppState, Member } from "@/src/types";

const ALL_REACTIONS: GroupSocialReactionKind[] = [
  "heart",
  "cheer",
  "thumbs_up",
  "thumbs_down",
];

function iconFor(reaction: GroupSocialReactionKind) {
  if (reaction === "heart") return "heart" as const;
  if (reaction === "thumbs_down") return "thumbs-down" as const;
  return "thumbs-up" as const;
}

function colorFor(reaction: GroupSocialReactionKind, accent: string) {
  if (reaction === "heart") return "#E65D75";
  if (reaction === "cheer") return "#D99A20";
  if (reaction === "thumbs_down") return "#D87C42";
  return accent;
}

export function GroupSocialActionBar({
  currentUserId,
  members,
  state,
  reactions,
  comments = [],
  allowedReactions = ALL_REACTIONS,
  commentsEnabled = true,
  onReact,
  onComment,
  onDeleteComment,
  onReportComment,
  onShare,
  onInteractionChange,
  inverse = false,
  compact = false,
}: {
  currentUserId: string;
  members: readonly Member[];
  state?: AppState;
  reactions: readonly GroupSocialReaction[];
  comments?: readonly GroupSocialComment[];
  allowedReactions?: readonly GroupSocialReactionKind[];
  commentsEnabled?: boolean;
  onReact: (reaction: GroupSocialReactionKind) => void;
  onComment?: (content: string) => Promise<void>;
  onDeleteComment?: (commentId: string) => Promise<void>;
  onReportComment?: (comment: GroupSocialComment) => void;
  onShare?: () => void;
  onInteractionChange?: (active: boolean) => void;
  inverse?: boolean;
  compact?: boolean;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [pressing, setPressing] = useState(false);
  const mine = reactions.find((reaction) => reaction.userId === currentUserId);
  const foreground = inverse ? "#FFFFFFE8" : colors.muted;
  const border = inverse ? "#FFFFFF38" : colors.border;
  const memberById = new Map(members.map((member) => [member.id, member]));

  const interactionActive = commentsOpen || posting || pressing;
  useEffect(() => {
    onInteractionChange?.(interactionActive);
  }, [interactionActive, onInteractionChange]);
  useEffect(
    () => () => onInteractionChange?.(false),
    [onInteractionChange],
  );

  const interactionPressHandlers = onInteractionChange
    ? {
        onPressIn: () => setPressing(true),
        onPressOut: () => setPressing(false),
      }
    : undefined;

  async function post() {
    const content = draft.trim();
    if (!content || !onComment || posting) return;
    setPosting(true);
    setDraft("");
    try {
      await onComment(content);
    } catch {
      setDraft(content);
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={[styles.root, { borderTopColor: border }, compact && styles.compactRoot]}>
      <View style={[styles.row, compact && styles.compactRow]}>
        {allowedReactions.map((reaction) => {
          const active = mine?.reaction === reaction;
          const color = colorFor(reaction, accent);
          const count = reactions.filter((item) => item.reaction === reaction).length;
          return (
            <Pressable
              key={reaction}
              accessibilityRole="button"
              accessibilityLabel={`${active ? "Remove" : "Add"} ${reaction.replace("_", " ")} reaction`}
              accessibilityState={{ selected: active }}
              hitSlop={5}
              {...interactionPressHandlers}
              onPress={() => onReact(reaction)}
              style={[
                styles.action,
                compact && styles.compactAction,
                active && { backgroundColor: `${color}20` },
              ]}
            >
              {reaction === "cheer" ? (
                <CheerIcon size={compact ? 13 : 15} color={active ? color : foreground} />
              ) : (
                <Ionicons
                  name={iconFor(reaction)}
                  size={compact ? 13 : 15}
                  color={active ? color : foreground}
                />
              )}
              {count ? (
                <Text translate={false} style={[styles.count, { color: active ? color : foreground }]}>
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {commentsEnabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: commentsOpen }}
            {...interactionPressHandlers}
            onPress={() => setCommentsOpen((open) => !open)}
            style={[styles.action, compact && styles.compactAction]}
          >
            <Ionicons name="chatbubble-outline" size={compact ? 13 : 15} color={foreground} />
            {comments.length ? (
              <Text translate={false} style={[styles.count, { color: foreground }]}>{comments.length}</Text>
            ) : null}
          </Pressable>
        ) : null}
        {onShare ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Share" {...interactionPressHandlers} onPress={onShare} style={[styles.action, compact && styles.compactAction]}>
            <Ionicons name="paper-plane-outline" size={compact ? 13 : 15} color={foreground} />
          </Pressable>
        ) : null}
      </View>
      {commentsOpen ? (
        <View style={[styles.comments, { borderTopColor: border }]}>
          {comments.length ? comments.map((comment) => {
            const author = memberById.get(comment.userId);
            const name = author
              ? state
                ? memberDisplayName(state, author)
                : author.name
              : "Member";
            return (
              <View key={comment.id} style={styles.commentRow}>
                <View style={styles.commentCopy}>
                  <View style={styles.commentMeta}>
                    <Text translate={false} style={[styles.author, { color: inverse ? "#FFFFFF" : colors.ink }]}>{name}</Text>
                    <Text translate={false} style={[styles.time, { color: foreground }]}>{relativeTime(comment.createdAt)}</Text>
                  </View>
                  <Text translate={false} style={[styles.comment, { color: foreground }]}>{comment.content}</Text>
                </View>
                {comment.userId === currentUserId && onDeleteComment ? (
                  <Pressable accessibilityLabel="Delete comment" hitSlop={6} {...interactionPressHandlers} onPress={() => void onDeleteComment(comment.id)} style={styles.deleteComment}>
                    <Ionicons name="trash-outline" size={13} color={foreground} />
                  </Pressable>
                ) : comment.userId !== currentUserId && onReportComment ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report comment from ${name}`}
                    hitSlop={6}
                    {...interactionPressHandlers}
                    onPress={() => onReportComment(comment)}
                    style={styles.deleteComment}
                  >
                    <Ionicons name="flag-outline" size={13} color={foreground} />
                  </Pressable>
                ) : null}
              </View>
            );
          }) : (
            <Text style={[styles.empty, { color: foreground }]}>No comments yet.</Text>
          )}
          {onComment ? (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                editable={!posting}
                placeholder="Add a comment"
                placeholderTextColor={inverse ? "#FFFFFF80" : colors.faint}
                style={[
                  styles.input,
                  {
                    color: inverse ? "#FFFFFF" : colors.ink,
                    borderColor: border,
                    backgroundColor: inverse ? "#FFFFFF14" : colors.canvas,
                  },
                ]}
              />
              <Pressable accessibilityLabel="Post comment" disabled={!draft.trim() || posting} {...interactionPressHandlers} onPress={() => void post()} style={[styles.send, { backgroundColor: inverse ? "#FFFFFF26" : colors.primarySoft, opacity: !draft.trim() || posting ? 0.45 : 1 }]}>
                <Ionicons name="send" size={15} color={inverse ? "#FFFFFF" : accent} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  compactRoot: { marginTop: 3 },
  row: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 3, flexWrap: "wrap" },
  compactRow: { minHeight: 28, justifyContent: "flex-end" },
  action: { minWidth: 34, height: 32, paddingHorizontal: 7, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  compactAction: { minWidth: 28, height: 26, paddingHorizontal: 5, borderRadius: 8 },
  count: { fontSize: 7, fontWeight: "900" },
  comments: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 7 },
  commentRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  commentCopy: { flex: 1, minWidth: 0 },
  commentMeta: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  author: { fontSize: 8, fontWeight: "900" },
  time: { fontSize: 7, fontWeight: "700" },
  comment: { fontSize: 9, lineHeight: 13, marginTop: 1 },
  deleteComment: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 8, textAlign: "center" },
  composer: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, fontSize: 10 },
  send: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
