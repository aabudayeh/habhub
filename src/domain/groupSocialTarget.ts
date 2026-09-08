import type { MetricEntry } from "@/src/types";

export type GroupSocialTargetType =
  | "recap_feed"
  | "group_recap"
  | "metric_entry"
  | "photo_update"
  | "badge"
  | "group_challenge"
  | "group_todo"
  | "group_note"
  | "chat_message";

export type GroupSocialTarget = {
  type: GroupSocialTargetType;
  id: string;
  /** Mutation-only context; never trusted by the backend authorization check. */
  ownerUserId?: string;
  cloudPublished?: boolean;
  clientGeneratedId?: string;
  localDate?: string;
};

export type MetricSocialTargetIdentity = {
  cloudId: string;
  ownerUserId: string;
  clientGeneratedId: string;
};

const GROUP_RECAP_STORY_ID = /^group-[a-z0-9](?:[a-z0-9_-]{0,79})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!CALENDAR_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Aggregate recap stories do not have a source row or an owner. Their
 * canonical identity binds the story renderer version, rolling period,
 * period anchor, and deterministic story id. The database independently
 * accepts this exact bounded format only for active members of the group.
 */
export function groupRecapSocialTarget(
  anchor: string,
  storyId: string,
): GroupSocialTarget {
  if (!isCalendarDate(anchor) || !GROUP_RECAP_STORY_ID.test(storyId))
    throw new Error("Invalid group recap story identity.");
  return {
    type: "group_recap",
    id: `v1:week:${anchor}:${storyId}`,
  };
}

export function groupRecapStoryShareHighlight(storyId: string) {
  if (!GROUP_RECAP_STORY_ID.test(storyId)) return undefined;
  return `story:${storyId}`;
}

export function groupRecapStoryIdFromShareHighlight(
  highlight: string | undefined,
) {
  if (!highlight?.startsWith("story:")) return undefined;
  const storyId = highlight.slice("story:".length);
  return GROUP_RECAP_STORY_ID.test(storyId) ? storyId : undefined;
}

/**
 * Keeps the last server-confirmed reaction stable while rapid optimistic taps
 * are serialized. `Map.has` deliberately distinguishes a confirmed removal
 * (`undefined`) from a burst that has not started.
 */
export function beginSocialReactionBurst<T>(
  confirmedByKey: Map<string, T | undefined>,
  key: string,
  confirmed: T | undefined,
) {
  if (!confirmedByKey.has(key)) confirmedByKey.set(key, confirmed);
}

export function confirmSocialReactionBurst<T>(
  confirmedByKey: Map<string, T | undefined>,
  key: string,
  confirmed: T | undefined,
) {
  confirmedByKey.set(key, confirmed);
}

export function finishSocialReactionBurst<T>(
  confirmedByKey: Map<string, T | undefined>,
  key: string,
) {
  confirmedByKey.delete(key);
}

function metricOwnerClientKey(ownerUserId: string, clientGeneratedId: string) {
  return `${ownerUserId}\u0000${clientGeneratedId}`;
}

/**
 * Keeps unresolved legacy metric ids collision-safe in local UI state. Once a
 * target has its server UUID, the canonical type/id pair is the shared key used
 * by persisted reactions and comments.
 */
export function groupSocialTargetKey(target: GroupSocialTarget) {
  if (
    target.type === "metric_entry" &&
    !target.cloudPublished &&
    target.ownerUserId
  )
    return `${target.type}\u0000legacy:${target.ownerUserId}\u0000${target.id}`;
  return `${target.type}\u0000${target.id}`;
}

/**
 * Chat client ids are unique per sender in the database, not per group. Keep
 * the owner in the canonical social identity so an id collision can never
 * attach a reaction to another member's message.
 */
export function chatMessageSocialTarget(
  senderUserId: string,
  clientGeneratedId: string,
): GroupSocialTarget {
  return {
    type: "chat_message",
    id: `${senderUserId}:${clientGeneratedId}`,
    ownerUserId: senderUserId,
    clientGeneratedId,
  };
}

/** Includes every field that can change legacy-to-canonical resolution. */
export function groupSocialTargetResolutionKey(target: GroupSocialTarget) {
  return [
    groupSocialTargetKey(target),
    target.clientGeneratedId ?? "",
    target.cloudPublished ? "published" : "legacy",
  ].join("\u0000");
}

/**
 * Upgrades legacy metric targets after an RLS-scoped identity lookup. The
 * owner/client pair prevents one member's locally generated id from resolving
 * to another member's entry, and conflicting identities fail closed.
 */
export function canonicalizeLegacyMetricSocialTargets(
  targets: readonly GroupSocialTarget[],
  identities: readonly MetricSocialTargetIdentity[],
) {
  const cloudIdByOwnerClient = new Map<string, string>();
  for (const identity of identities) {
    const key = metricOwnerClientKey(
      identity.ownerUserId,
      identity.clientGeneratedId,
    );
    const prior = cloudIdByOwnerClient.get(key);
    if (prior === undefined) cloudIdByOwnerClient.set(key, identity.cloudId);
    else if (prior !== identity.cloudId) cloudIdByOwnerClient.set(key, "");
  }
  return targets.map((target) => {
    if (
      target.type !== "metric_entry" ||
      target.cloudPublished ||
      !target.ownerUserId
    )
      return target;
    const clientGeneratedId = target.clientGeneratedId ?? target.id;
    const cloudId = cloudIdByOwnerClient.get(
      metricOwnerClientKey(target.ownerUserId, clientGeneratedId),
    );
    return cloudId
      ? {
          ...target,
          id: cloudId,
          cloudPublished: true,
          clientGeneratedId,
        }
      : target;
  });
}

/**
 * Builds the only social identity allowed for a metric log. Private and
 * calculated rows never become targets, while fetched rows prefer their
 * collision-free relational UUID over the mixed-version client id.
 */
export function metricEntrySocialTarget(
  entry: Pick<
    MetricEntry,
    "cloudId" | "id" | "localDate" | "userId" | "visibility" | "source"
  >,
): GroupSocialTarget | undefined {
  if (entry.source === "calculated" || entry.visibility !== "group") return;
  return {
    type: "metric_entry",
    id: entry.cloudId ?? entry.id,
    ownerUserId: entry.userId,
    cloudPublished: Boolean(entry.cloudId),
    clientGeneratedId: entry.id,
    localDate: entry.localDate,
  };
}
