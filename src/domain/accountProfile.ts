import type { AppState, Group, Member } from "../types";

/**
 * Account-owned member fields that must agree across every personal/group
 * shell. Role, presence, aliases and the deterministic group color remain
 * workspace-owned and are intentionally excluded.
 */
export type AccountMemberProfile = Pick<Member, "name" | "initials"> & {
  avatarStoragePath?: string;
  avatarUri?: string;
};

function normalizedProfile(member: Member): AccountMemberProfile {
  return {
    name: member.name,
    initials: member.initials,
    avatarStoragePath: member.avatarStoragePath,
    // A signed URL is only a presentation cache. A local file/data URI is part
    // of the offline outbox until it receives a stable storage path.
    avatarUri: member.avatarStoragePath ? undefined : member.avatarUri,
  };
}

export function accountMemberProfile(
  state: AppState,
): AccountMemberProfile | null {
  const active = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  if (active) return normalizedProfile(active);
  for (const group of state.groups) {
    const member = group.members.find(
      (candidate) => candidate.id === state.currentUserId,
    );
    if (member) return normalizedProfile(member);
    const pending = group.pendingMembers?.find(
      (candidate) => candidate.id === state.currentUserId,
    );
    if (pending) return normalizedProfile(pending);
  }
  return null;
}

export function sameAccountMemberProfile(
  left: AccountMemberProfile | null | undefined,
  right: AccountMemberProfile | null | undefined,
) {
  return (
    left?.name === right?.name &&
    left?.initials === right?.initials &&
    left?.avatarStoragePath === right?.avatarStoragePath &&
    left?.avatarUri === right?.avatarUri
  );
}

export function profileProjectionLagsSnapshot(
  profileRevision: number | undefined,
  snapshotRevision: number | undefined,
) {
  if (
    !Number.isSafeInteger(snapshotRevision) ||
    Number(snapshotRevision) <= 0
  )
    return false;
  return (
    !Number.isSafeInteger(profileRevision) ||
    Number(profileRevision) < Number(snapshotRevision)
  );
}

/**
 * Three-way merge for the account identity. A dirty local edit wins a true
 * same-field conflict; an unrelated local edit must not keep an old name over
 * a newer remote profile. A missing legacy base remains local-first so an
 * offline rename cannot be lost during the one-time upgrade.
 */
export function mergeAccountMemberProfile(
  remote: AccountMemberProfile | null,
  local: AccountMemberProfile | null,
  base?: AccountMemberProfile | null,
) {
  if (!remote) return local;
  if (!local) return remote;
  if (base === undefined) return local;
  const chooseLocal = <T,>(
    remoteValue: T,
    localValue: T,
    baseValue: T,
    equal: (left: T, right: T) => boolean,
  ) => {
    const remoteChanged = !equal(remoteValue, baseValue);
    const localChanged = !equal(localValue, baseValue);
    return (
      localChanged &&
      (!remoteChanged || !equal(localValue, remoteValue))
    );
  };
  const remoteIdentity = { name: remote.name, initials: remote.initials };
  const localIdentity = { name: local.name, initials: local.initials };
  const baseIdentity = { name: base?.name, initials: base?.initials };
  const identityEqual = (
    left: { name?: string; initials?: string },
    right: { name?: string; initials?: string },
  ) => left.name === right.name && left.initials === right.initials;
  const remoteAvatar = {
    avatarStoragePath: remote.avatarStoragePath,
    avatarUri: remote.avatarUri,
  };
  const localAvatar = {
    avatarStoragePath: local.avatarStoragePath,
    avatarUri: local.avatarUri,
  };
  const baseAvatar = {
    avatarStoragePath: base?.avatarStoragePath,
    avatarUri: base?.avatarUri,
  };
  const avatarEqual = (
    left: Pick<AccountMemberProfile, "avatarStoragePath" | "avatarUri">,
    right: Pick<AccountMemberProfile, "avatarStoragePath" | "avatarUri">,
  ) =>
    left.avatarStoragePath === right.avatarStoragePath &&
    left.avatarUri === right.avatarUri;
  const identity = chooseLocal(
    remoteIdentity,
    localIdentity,
    baseIdentity,
    identityEqual,
  )
    ? localIdentity
    : remoteIdentity;
  const avatar = chooseLocal(
    remoteAvatar,
    localAvatar,
    baseAvatar,
    avatarEqual,
  )
    ? localAvatar
    : remoteAvatar;
  return { ...identity, ...avatar };
}

function applyProfileToGroup(
  group: Group,
  userId: string,
  profile: AccountMemberProfile,
): Group {
  let changed = false;
  const updateMember = (member: Member) => {
    if (member.id !== userId) return member;
    if (sameAccountMemberProfile(normalizedProfile(member), profile))
      return member;
    changed = true;
    return {
      ...member,
      name: profile.name,
      initials: profile.initials,
      avatarStoragePath: profile.avatarStoragePath,
      avatarUri:
        profile.avatarStoragePath &&
        member.avatarStoragePath === profile.avatarStoragePath
          ? member.avatarUri
          : profile.avatarUri,
    };
  };
  const members = group.members.map(updateMember);
  const pendingMembers = group.pendingMembers?.map(updateMember);
  return changed ? { ...group, members, pendingMembers } : group;
}

/** Apply one canonical account identity to every cached workspace shell. */
export function applyAccountMemberProfile(
  state: AppState,
  profile: AccountMemberProfile | null,
): AppState {
  if (!profile) return state;
  const groups = state.groups.map((group) =>
    applyProfileToGroup(group, state.currentUserId, profile),
  );
  const groupFromList = groups.find((group) => group.id === state.group.id);
  const group =
    groupFromList ??
    applyProfileToGroup(state.group, state.currentUserId, profile);
  if (
    group === state.group &&
    groups.every((item, index) => item === state.groups[index])
  )
    return state;
  return { ...state, group, groups };
}
