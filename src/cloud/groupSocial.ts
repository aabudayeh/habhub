import { supabase } from "@/src/lib/supabase";
import { moderateChatContent } from "@/src/safety/contentFilter";
import type {
  GroupSocialTarget,
  GroupSocialTargetType,
  MetricSocialTargetIdentity,
} from "@/src/domain/groupSocialTarget";
import { canonicalizeLegacyMetricSocialTargets } from "@/src/domain/groupSocialTarget";
import type { GroupSocialSummary } from "@/src/domain/socialEngagement";

export {
  metricEntrySocialTarget,
  type GroupSocialTarget,
  type GroupSocialTargetType,
} from "@/src/domain/groupSocialTarget";

export type GroupSocialReactionKind =
  | "heart"
  | "thumbs_up"
  | "thumbs_down"
  | "cheer";

/** Screen where an interaction was made. The server stores this only to route
 * the recipient back to the same representation; it never affects access. */
export type GroupSocialInteractionSurface =
  | "feed"
  | "leaderboard_log"
  | "group_notes"
  | "chat";

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

export type GroupSocialReactionMutation = {
  reaction?: GroupSocialReaction;
  pushEventKey?: string;
  requiresOutboxDrain?: boolean;
};

export type GroupSocialCommentMutation = {
  comment: GroupSocialComment;
  pushEventKey?: string;
  requiresOutboxDrain?: boolean;
};

const SOCIAL_TARGETS_PER_REQUEST = 20;
export type GroupSocialCommentPage = {
  comments: GroupSocialComment[];
  hasMore: boolean;
};

type EngagementRow = {
  target_type: GroupSocialTargetType;
  target_id: string;
  reaction_counts: GroupSocialSummary["reactionCounts"];
  own_reaction: ReactionRow | null;
  comment_count: number;
  comments: CommentRow[];
  has_more_comments: boolean;
};

type MetricTargetIdentityRow = {
  id: string;
  client_generated_id: string;
  user_id: string;
};

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

function promptSocialRpcUnavailable(error: unknown, functionName: string) {
  const message = cloudError(error).message;
  return (
    message.includes(functionName) &&
    /schema cache|could not find|does not exist|pgrst202/i.test(message)
  );
}

function pushEventKeyFrom(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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
  const idsByType = new Map<GroupSocialTargetType, Set<string>>();
  for (const target of targets) {
    if (!target.id) continue;
    let ids = idsByType.get(target.type);
    if (!ids) {
      ids = new Set<string>();
      idsByType.set(target.type, ids);
    }
    ids.add(target.id);
  }
  return new Map(
    [...idsByType].map(([targetType, ids]) => [targetType, [...ids]]),
  );
}

function metricTargetOwnerClientKey(ownerUserId: string, clientGeneratedId: string) {
  return `${ownerUserId}\u0000${clientGeneratedId}`;
}

/**
 * Old schema-v3 activity caches predate MetricEntry.cloudId. Resolve those
 * rows in bounded RLS-filtered batches before querying canonical social rows.
 * The owner/client pair is required because client-generated ids are not
 * group-global identities.
 */
export async function resolveGroupSocialTargets(
  groupId: string,
  targets: readonly GroupSocialTarget[],
  signal?: AbortSignal,
) {
  if (!supabase || !targets.length) return [...targets];
  const legacyMetricTargets = targets.filter(
    (target) =>
      target.type === "metric_entry" &&
      !target.cloudPublished &&
      Boolean(target.ownerUserId) &&
      Boolean(target.clientGeneratedId ?? target.id),
  );
  if (!legacyMetricTargets.length) return [...targets];

  const identities: MetricSocialTargetIdentity[] = [];
  for (
    let offset = 0;
    offset < legacyMetricTargets.length;
    offset += SOCIAL_TARGETS_PER_REQUEST
  ) {
    const page = legacyMetricTargets.slice(
      offset,
      offset + SOCIAL_TARGETS_PER_REQUEST,
    );
    const ownerIds = [
      ...new Set(page.flatMap((target) => target.ownerUserId ?? [])),
    ];
    const clientGeneratedIds = [
      ...new Set(
        page.map((target) => target.clientGeneratedId ?? target.id),
      ),
    ];
    const requestedPairs = new Set(
      page.map((target) =>
        metricTargetOwnerClientKey(
          target.ownerUserId!,
          target.clientGeneratedId ?? target.id,
        ),
      ),
    );
    const query = supabase
      .from("metric_entries")
      .select(
        "id, client_generated_id, user_id, metric_definitions!inner(group_id)",
      )
      .in("user_id", ownerIds)
      .in("client_generated_id", clientGeneratedIds)
      .eq("visibility", "group")
      .eq("metric_definitions.group_id", groupId);
    const response = await (signal ? query.abortSignal(signal) : query);
    if (response.error) throw cloudError(response.error);
    for (const row of (response.data ?? []) as MetricTargetIdentityRow[]) {
      const key = metricTargetOwnerClientKey(
        row.user_id,
        row.client_generated_id,
      );
      if (!requestedPairs.has(key)) continue;
      identities.push({
        cloudId: row.id,
        ownerUserId: row.user_id,
        clientGeneratedId: row.client_generated_id,
      });
    }
  }
  return canonicalizeLegacyMetricSocialTargets(targets, identities);
}

export async function loadGroupSocialEngagement(
  groupId: string,
  targets: readonly GroupSocialTarget[],
  options: { includeComments?: boolean; signal?: AbortSignal } = {},
) {
  const resolvedTargets = await resolveGroupSocialTargets(groupId, targets, options.signal);
  const rows: EngagementRow[] = [];
  const uniqueTargets = [...targetsByType(resolvedTargets)].flatMap(([type, ids]) =>
    ids.map((id) => ({ type, id })),
  );
  if (supabase) {
    for (let offset = 0; offset < uniqueTargets.length; offset += SOCIAL_TARGETS_PER_REQUEST) {
      const query = supabase.rpc("get_group_social_engagement", {
        p_group_id: groupId,
        p_targets: uniqueTargets.slice(offset, offset + SOCIAL_TARGETS_PER_REQUEST),
        p_include_comments: options.includeComments !== false,
      });
      const response = await (options.signal ? query.abortSignal(options.signal) : query);
      if (response.error) throw cloudError(response.error);
      rows.push(...((response.data ?? []) as EngagementRow[]));
    }
  }
  return {
    resolvedTargets,
    summaries: rows.map((row): GroupSocialSummary => ({
      groupId,
      targetType: row.target_type,
      targetId: row.target_id,
      reactionCounts: row.reaction_counts,
      ownReaction: row.own_reaction?.reaction,
      commentCount: Number(row.comment_count),
    })),
    reactions: rows.flatMap((row) => row.own_reaction ? [reactionFromRow(row.own_reaction)] : []),
    commentPages: new Map(rows.map((row) => [
      `${row.target_type}\u0000${row.target_id}`,
      { comments: row.comments.map(commentFromRow), hasMore: row.has_more_comments },
    ])),
    comments: rows.flatMap((row) => row.comments.map(commentFromRow))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

export async function loadGroupSocialCommentsPage(
  groupId: string,
  target: GroupSocialTarget,
  before?: Pick<GroupSocialComment, "id" | "createdAt">,
  signal?: AbortSignal,
): Promise<GroupSocialCommentPage> {
  if (!supabase) return { comments: [], hasMore: false };
  const query = supabase.rpc("list_group_social_comments_page", {
    p_group_id: groupId,
    p_target_type: target.type,
    p_target_id: target.id,
    p_before_created_at: before?.createdAt ?? null,
    p_before_id: before?.id ?? null,
    p_limit: 20,
  });
  const response = await (signal ? query.abortSignal(signal) : query);
  if (response.error) throw cloudError(response.error);
  const page = response.data as { comments: CommentRow[]; has_more: boolean };
  return { comments: page.comments.map(commentFromRow), hasMore: page.has_more };
}

/**
 * Resolve an old/local metric-entry id to its server-owned UUID. The owner id
 * is only a collision disambiguator: the SELECT remains subject to entry RLS,
 * and the mutation RPC independently revalidates active membership, group,
 * visibility, and the privacy revision fence.
 */
export async function resolveMetricEntrySocialTarget(
  groupId: string,
  target: GroupSocialTarget,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<GroupSocialTarget | undefined> {
  if (target.type !== "metric_entry") return target;
  if (target.cloudPublished && !options?.force) return target;
  if (!supabase || !target.ownerUserId) return undefined;
  const clientGeneratedId = target.clientGeneratedId ?? target.id;
  const query = supabase
    .from("metric_entries")
    .select("id, metric_definitions!inner(group_id)")
    .eq("user_id", target.ownerUserId)
    .eq("client_generated_id", clientGeneratedId)
    .eq("visibility", "group")
    .eq("metric_definitions.group_id", groupId)
    .limit(1);
  const { data, error } = await (options?.signal ? query.abortSignal(options.signal) : query).maybeSingle();
  if (error) throw cloudError(error);
  const cloudId =
    data && typeof (data as { id?: unknown }).id === "string"
      ? (data as { id: string }).id
      : undefined;
  if (!cloudId) return undefined;
  return {
    ...target,
    id: cloudId,
    cloudPublished: true,
    clientGeneratedId,
  };
}

export function isUnavailableGroupSocialTargetError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("shared item is no longer available")
  );
}

export async function saveGroupSocialReaction(input: {
  groupId: string;
  target: GroupSocialTarget;
  userId: string;
  reaction?: GroupSocialReactionKind;
  surface: GroupSocialInteractionSurface;
}): Promise<GroupSocialReactionMutation> {
  if (!supabase) throw new Error("Sign in to react to a shared item.");
  const args = {
    p_group_id: input.groupId,
    p_target_type: input.target.type,
    p_target_id: input.target.id,
    p_reaction: input.reaction ?? null,
    p_surface: input.surface,
  };
  const prompt = await supabase.rpc("set_group_social_reaction_v2", args);
  if (!prompt.error) {
    const payload = (Array.isArray(prompt.data)
      ? prompt.data[0]
      : prompt.data) as
      | { reaction?: ReactionRow | null; push_event_key?: unknown }
      | null;
    return {
      reaction:
        input.reaction && payload?.reaction
          ? reactionFromRow(payload.reaction)
          : undefined,
      pushEventKey: pushEventKeyFrom(payload?.push_event_key),
    };
  }
  if (!promptSocialRpcUnavailable(prompt.error, "set_group_social_reaction_v2"))
    throw cloudError(prompt.error);

  // Staged rollout compatibility: an older database still commits the same
  // durable trigger-owned event; the caller falls back to the bounded outbox
  // drain until the forward migration is installed.
  const legacy = await supabase.rpc("set_group_social_reaction", args);
  if (legacy.error) throw cloudError(legacy.error);
  const row = Array.isArray(legacy.data) ? legacy.data[0] : legacy.data;
  return {
    reaction:
      row && input.reaction ? reactionFromRow(row as ReactionRow) : undefined,
    requiresOutboxDrain: Boolean(input.reaction),
  };
}

export async function addGroupSocialComment(input: {
  groupId: string;
  target: GroupSocialTarget;
  userId: string;
  content: string;
  surface: GroupSocialInteractionSurface;
}): Promise<GroupSocialCommentMutation> {
  if (!supabase) throw new Error("Sign in to comment on a shared item.");
  const content = input.content.trim();
  if (!content) throw new Error("Write a comment first.");
  const moderation = moderateChatContent(content);
  if (!moderation.allowed)
    throw new Error(
      moderation.message ?? "That comment cannot be posted as written.",
    );
  const prompt = await supabase.rpc("add_group_social_comment_v2", {
    p_group_id: input.groupId,
    p_target_type: input.target.type,
    p_target_id: input.target.id,
    p_content: content,
    p_surface: input.surface,
  });
  if (!prompt.error) {
    const payload = (Array.isArray(prompt.data)
      ? prompt.data[0]
      : prompt.data) as
      | { comment?: CommentRow | null; push_event_key?: unknown }
      | null;
    if (!payload?.comment)
      throw new Error("The comment was not saved. Try again.");
    return {
      comment: commentFromRow(payload.comment),
      pushEventKey: pushEventKeyFrom(payload.push_event_key),
    };
  }
  if (!promptSocialRpcUnavailable(prompt.error, "add_group_social_comment_v2"))
    throw cloudError(prompt.error);

  const { data, error } = await supabase
    .from("group_social_comments")
    .insert({
      group_id: input.groupId,
      target_type: input.target.type,
      target_id: input.target.id,
      user_id: input.userId,
      content,
      source_surface: input.surface,
    })
    .select(
      "id, group_id, target_type, target_id, user_id, content, created_at, updated_at",
    )
    .single();
  if (error) throw cloudError(error);
  return {
    comment: commentFromRow(data as CommentRow),
    requiresOutboxDrain: true,
  };
}

export async function deleteGroupSocialComment(commentId: string) {
  if (!supabase) throw new Error("Sign in to delete this comment.");
  const { error } = await supabase
    .from("group_social_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw cloudError(error);
}
