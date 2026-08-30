import type { MetricEntry } from "@/src/types";

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
