import { supabase } from "@/src/lib/supabase";

export type GroupSocialTargetType =
  | "recap_feed"
  | "metric_entry"
  | "photo_update"
  | "badge"
  | "group_challenge"
  | "group_todo";

export type GroupSocialTarget = {
  type: GroupSocialTargetType;
  id: string;
};

export type GroupSocialReactionKind =
  | "heart"
  | "thumbs_up"
  | "thumbs_down";

export type GroupSocialReaction = {
  groupId: string;
  targetType: GroupSocialTargetType;
  targetId: string;
  userId: string;
  reaction: GroupSocialReactionKind;
  createdAt: string;
  updatedAt: string;
};

export type GroupSocialComment = {
  id: string;
  groupId: string;
  targetType: GroupSocialTargetType;
  targetId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type ReactionRow = {
  group_id: string;
  target_type: GroupSocialTargetType;
  target_id: string;
  user_id: string;
  reaction: GroupSocialReactionKind;
  created_at: string;
  updated_at: string;
};

type CommentRow = {
  id: string;
  group_id: string;
  target_type: GroupSocialTargetType;
  target_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

const SOCIAL_TARGETS_PER_REQUEST = 20;
const SOCIAL_ROWS_PER_REQUEST = 1000;

function cloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
      .join(" · ");
    if (message) return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function reactionFromRow(row: ReactionRow): GroupSocialReaction {
  return {
    groupId: row.group_id,
    targetType: row.target_type,
    targetId: row.target_id,
    userId: row.user_id,
    reaction: row.reaction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function commentFromRow(row: CommentRow): GroupSocialComment {
  return {
    id: row.id,
    groupId: row.group_id,
    targetType: row.target_type,
    targetId: row.target_id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function targetsByType(targets: readonly GroupSocialTarget[]) {
  const result = new Map<GroupSocialTargetType, string[]>();
  for (const target of targets) {
    if (!target.id) continue;
    result.set(target.type, [
      ...new Set([...(result.get(target.type) ?? []), target.id]),
    ]);
  }
  return result;
}

async function loadRowsForTargets<Row>(
  table: "group_social_reactions" | "group_social_comments",
  columns: string,
  groupId: string,
  targets: readonly GroupSocialTarget[],
) {
  if (!supabase || !targets.length) return [] as Row[];
  const groups = [...targetsByType(targets).entries()];
  const result: Row[] = [];
  // Keep both the target expression and returned row count bounded. A recap
  // can include a large all-time feed, while a popular target can accumulate
  // many comments/reactions over time; neither should become a table-wide
  // response or monopolize the JS thread.
  for (const [targetType, ids] of groups) {
    for (let offset = 0; offset < ids.length; offset += SOCIAL_TARGETS_PER_REQUEST) {
      const page = ids.slice(offset, offset + SOCIAL_TARGETS_PER_REQUEST);
      const response = await supabase
        .from(table)
        .select(columns)
        .eq("group_id", groupId)
        .eq("target_type", targetType)
        .in("target_id", page)
        .order(table === "group_social_comments" ? "created_at" : "updated_at", {
          ascending: false,
        })
        .limit(SOCIAL_ROWS_PER_REQUEST);
      if (response.error) throw cloudError(response.error);
      result.push(...(((response.data as Row[] | null) ?? [])));
    }
  }
  return result;
}

export async function loadGroupSocialEngagement(
  groupId: string,
  targets: readonly GroupSocialTarget[],
) {
  const [reactionRows, commentRows] = await Promise.all([
    loadRowsForTargets<ReactionRow>(
      "group_social_reactions",
      "group_id, target_type, target_id, user_id, reaction, created_at, updated_at",
      groupId,
      targets,
    ),
    loadRowsForTargets<CommentRow>(
      "group_social_comments",
      "id, group_id, target_type, target_id, user_id, content, created_at, updated_at",
      groupId,
      targets,
    ),
  ]);
  return {
    reactions: reactionRows.map(reactionFromRow),
    comments: commentRows
      .map(commentFromRow)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

export async function saveGroupSocialReaction(input: {
  groupId: string;
  target: GroupSocialTarget;
  userId: string;
  reaction?: GroupSocialReactionKind;
}) {
  if (!supabase) throw new Error("Sign in to react to a shared item.");
  if (!input.reaction) {
    const { error } = await supabase
      .from("group_social_reactions")
      .delete()
      .eq("group_id", input.groupId)
      .eq("target_type", input.target.type)
      .eq("target_id", input.target.id)
      .eq("user_id", input.userId);
    if (error) throw cloudError(error);
    return undefined;
  }
  const { data, error } = await supabase
    .from("group_social_reactions")
    .upsert(
      {
        group_id: input.groupId,
        target_type: input.target.type,
        target_id: input.target.id,
        user_id: input.userId,
        reaction: input.reaction,
      },
      { onConflict: "group_id,target_type,target_id,user_id" },
    )
    .select(
      "group_id, target_type, target_id, user_id, reaction, created_at, updated_at",
    )
    .single();
  if (error) throw cloudError(error);
  return reactionFromRow(data as ReactionRow);
}

export async function addGroupSocialComment(input: {
  groupId: string;
  target: GroupSocialTarget;
  userId: string;
  content: string;
}) {
  if (!supabase) throw new Error("Sign in to comment on a shared item.");
  const content = input.content.trim();
  if (!content) throw new Error("Write a comment first.");
  const { data, error } = await supabase
    .from("group_social_comments")
    .insert({
      group_id: input.groupId,
      target_type: input.target.type,
      target_id: input.target.id,
      user_id: input.userId,
      content,
    })
    .select(
      "id, group_id, target_type, target_id, user_id, content, created_at, updated_at",
    )
    .single();
  if (error) throw cloudError(error);
  return commentFromRow(data as CommentRow);
}

export async function deleteGroupSocialComment(commentId: string) {
  if (!supabase) throw new Error("Sign in to delete this comment.");
  const { error } = await supabase
    .from("group_social_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw cloudError(error);
}
