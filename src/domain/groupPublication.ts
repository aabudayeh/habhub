import type { AppState, Group } from "@/src/types";
import { accountOwnedCollections } from "@/src/domain/accountCollections";
import { orderedValueHash, stableValueHash } from "@/src/domain/cloudHash";

const CLOUD_GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPED_ID = /^habhub-group:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/is;
const destinationStateCache = new WeakMap<AppState, WeakMap<Group, AppState>>();
const publicationGroupCache = new WeakMap<AppState, Group[]>();
const publicationDigestCache = new WeakMap<AppState, { version: number; hash: string }>();
const ownedGymCache = new WeakMap<NonNullable<AppState["gymSessions"]>, Map<string, NonNullable<AppState["gymSessions"]>>>();

/** A personal source row is projected independently, never moved between groups. */
export function groupProjectionId(groupId: string, sourceId: string) {
  if (!CLOUD_GROUP_ID.test(groupId) || !sourceId)
    throw new Error("A group projection needs a valid destination and source id.");
  const scoped = SCOPED_ID.exec(sourceId);
  if (scoped) {
    if (scoped[1].toLowerCase() !== groupId.toLowerCase())
      throw new Error("A projection identity cannot be rebound to another group.");
    return `habhub-group:${groupId.toLowerCase()}:${scoped[2]}`;
  }
  return `habhub-group:${groupId.toLowerCase()}:${sourceId}`;
}

/** Do not decode another destination's id into a locally owned source row. */
export function groupProjectionSourceId(groupId: string, projectedId: string) {
  const scoped = SCOPED_ID.exec(projectedId);
  return scoped && scoped[1].toLowerCase() === groupId.toLowerCase()
    ? scoped[2]
    : projectedId;
}

/** Authoritative active shells only; pending invitations and personal setup never publish. */
export function cloudPublicationGroups(state: AppState): Group[] {
  const cached = publicationGroupCache.get(state);
  if (cached) return cached;
  const groups = new Map(state.groups.map((group) => [group.id, group]));
  groups.set(state.group.id, state.group);
  const result = [...groups.values()].filter(
    (group) =>
      CLOUD_GROUP_ID.test(group.id) &&
      group.members.some((member) => member.id === state.currentUserId),
  );
  publicationGroupCache.set(state, result);
  return result;
}

/** Keep personal logs, privacy, goals and health preferences; select only the destination schema. */
export function stateForGroupPublication(state: AppState, group: Group): AppState {
  if (state.group === group) return state;
  const byGroup = destinationStateCache.get(state) ?? new WeakMap<Group, AppState>();
  const cached = byGroup.get(group);
  if (cached) return cached;
  const result = { ...state, group };
  byGroup.set(group, result);
  destinationStateCache.set(state, byGroup);
  return result;
}

/** Same production digest used by the provider; shared history is hashed once per immutable array. */
export function groupPublicationDigest(state: AppState, version = 4) {
  const cached = publicationDigestCache.get(state);
  if (cached?.version === version) return cached.hash;
  const owned = accountOwnedCollections(state);
  let gym = state.gymSessions;
  if (gym) {
    const byAccount = ownedGymCache.get(gym) ?? new Map();
    let selected = byAccount.get(state.currentUserId);
    if (!selected) {
      selected = gym.filter((session) => session.userId === state.currentUserId);
      byAccount.set(state.currentUserId, selected);
      ownedGymCache.set(gym, byAccount);
    }
    gym = selected;
  }
  const hash = stableValueHash({
    sharedEntryDetailProjectionVersion: version,
    currentUserId: state.currentUserId,
    groupId: state.group.id,
    destinationMetrics: orderedValueHash(state.group.metricConfiguration),
    personalMetrics: orderedValueHash(state.metrics),
    trackedGoalPeriods: stableValueHash(state.trackedGoalPeriods),
    gymSessions: orderedValueHash(gym),
    vacationPeriods: orderedValueHash(state.settings.vacationPeriods),
    aliases: state.settings.memberNicknamesByGroup?.[state.group.id] ?? {},
    // Peer history, signed URLs, and account profile cosmetics never reopen this outbox.
    entries: orderedValueHash(owned.entries),
    photos: orderedValueHash(owned.photos),
    pendingPrivacyFences: state.settings.pendingMetricPrivacyFenceIdsByGroup?.[state.group.id] ?? [],
    pendingProjectionRepairs: state.settings.pendingGroupProjectionRepairIdsByGroup?.[state.group.id] ?? [],
  });
  publicationDigestCache.set(state, { version, hash });
  return hash;
}

/** Bounded foreground work; remaining destinations stay in the durable hash outbox. */
export const MAX_ADDITIONAL_GROUP_PUBLICATIONS_PER_PASS = 2;
export const MAX_BACKGROUND_GROUP_PUBLICATIONS_PER_PASS = 8;

/** Resume across long membership lists without an unbounded background task. */
export function backgroundGroupPublicationBatch(state: AppState, cursor = 0) {
  const groups = [...cloudPublicationGroups(state)].sort((a, b) => a.id.localeCompare(b.id));
  if (!groups.length) return { groups: [], nextCursor: 0 };
  const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor % groups.length : 0;
  const count = Math.min(groups.length, MAX_BACKGROUND_GROUP_PUBLICATIONS_PER_PASS);
  return {
    groups: Array.from({ length: count }, (_, index) => groups[(start + index) % groups.length]),
    nextCursor: (start + count) % groups.length,
  };
}

export function trackerVisibilityWithdrawsAccess(previous: string | undefined, next: string) {
  return (previous === "group" && next !== "group") ||
    (previous === "status" && next === "private");
}

export function mergeGroupProjectionRepairGeneration(...values: readonly unknown[]) {
  return Math.max(0, ...values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0));
}

export function repeatedGroupProjectionRepair(state: AppState, groupId: string, entryIds: readonly string[] | undefined) {
  return Boolean(entryIds?.length &&
    stableValueHash([...(state.settings.pendingGroupProjectionRepairIdsByGroup?.[groupId] ?? [])].sort()) ===
      stableValueHash([...entryIds].sort()));
}

/** A destination ACK may clear only exact source operations it actually committed. */
export function acknowledgeGroupPublication(
  state: AppState,
  groupId: string,
  result: {
    deletedEntryIds: readonly string[];
    deletedPhotoIds: readonly string[];
    acknowledgedPrivacyFenceMetricIds: readonly string[];
    groupConfigurationPushed?: boolean;
    groupConfigurationRevision?: number;
    projectionRepairEntryIds?: readonly string[];
  },
  privacyRequestIsCurrent: boolean,
): AppState {
  const entries = new Set(result.deletedEntryIds);
  const photos = new Set(result.deletedPhotoIds);
  const privacy = new Set(privacyRequestIsCurrent ? result.acknowledgedPrivacyFenceMetricIds : []);
  const configurationAck = result.groupConfigurationPushed === true &&
    Number.isSafeInteger(result.groupConfigurationRevision) &&
    Number(result.groupConfigurationRevision) >= 0;
  const repairs = { ...(state.settings.pendingGroupProjectionRepairIdsByGroup ?? {}) };
  const repairResponse = privacyRequestIsCurrent && result.projectionRepairEntryIds !== undefined;
  const repairChanged = repairResponse &&
    stableValueHash(repairs[groupId] ?? []) !== stableValueHash(result.projectionRepairEntryIds);
  let repairGeneration = mergeGroupProjectionRepairGeneration(state.settings.groupProjectionRepairGeneration);
  if (repairChanged) {
    if (result.projectionRepairEntryIds!.length) {
      repairs[groupId] = [...result.projectionRepairEntryIds!];
      if (repairGeneration >= Number.MAX_SAFE_INTEGER)
        throw new Error("Group repair generation needs account recovery.");
      repairGeneration += 1;
    }
    else delete repairs[groupId];
  }
  if (!entries.size && !photos.size && !privacy.size && !configurationAck && !repairChanged) return state;
  const fences = { ...(state.settings.pendingMetricPrivacyFenceIdsByGroup ?? {}) };
  if (privacy.size) {
    const remaining = (fences[groupId] ?? []).filter((id) => !privacy.has(id));
    if (remaining.length) fences[groupId] = remaining;
    else delete fences[groupId];
  }
  return {
    ...state,
    ...(configurationAck ? {
      groups: state.groups.map((group) => group.id === groupId
        ? { ...group, configurationRevision: Math.max(group.configurationRevision ?? 0, result.groupConfigurationRevision!) }
        : group),
      group: state.group.id === groupId
        ? { ...state.group, configurationRevision: Math.max(state.group.configurationRevision ?? 0, result.groupConfigurationRevision!) }
        : state.group,
    } : {}),
    settings: {
      ...state.settings,
      pendingDeletedEntryIds: (state.settings.pendingDeletedEntryIds ?? []).filter((id) => !entries.has(id)),
      deletedEntryIds: [...new Set([...(state.settings.deletedEntryIds ?? []), ...entries])],
      pendingDeletedPhotoIds: (state.settings.pendingDeletedPhotoIds ?? []).filter((id) => !photos.has(id)),
      deletedPhotoIds: [...new Set([...(state.settings.deletedPhotoIds ?? []), ...photos])],
      pendingMetricPrivacyFenceIdsByGroup: fences,
      pendingGroupProjectionRepairIdsByGroup: repairs,
      groupProjectionRepairGeneration: repairGeneration,
      pendingGroupConfigurationIds: configurationAck && privacyRequestIsCurrent
        ? (state.settings.pendingGroupConfigurationIds ?? []).filter((id) => id !== groupId)
        : state.settings.pendingGroupConfigurationIds,
    },
  };
}

export function pendingGroupPublications(
  state: AppState,
  acknowledgedHashes: ReadonlyMap<string, string>,
  requiredGroups: ReadonlySet<string>,
  digest: (destination: AppState) => string,
) {
  return cloudPublicationGroups(state)
    .map((group) => {
      const destination = stateForGroupPublication(state, group);
      return { group, state: destination, hash: digest(destination) };
    })
    .filter(
      ({ group, hash }) =>
        requiredGroups.has(group.id) ||
        state.settings.pendingGroupConfigurationIds?.includes(group.id) === true ||
        (state.settings.pendingMetricPrivacyFenceIdsByGroup?.[group.id]?.length ?? 0) > 0 ||
        (state.settings.pendingGroupProjectionRepairIdsByGroup?.[group.id]?.length ?? 0) > 0 ||
        acknowledgedHashes.get(group.id) !== hash,
    )
    .sort((left, right) => {
      const privacy = (group: Group) =>
        Number((state.settings.pendingMetricPrivacyFenceIdsByGroup?.[group.id]?.length ?? 0) > 0);
      return privacy(right.group) - privacy(left.group) ||
        Number(right.group.id === state.group.id) - Number(left.group.id === state.group.id);
    });
}
