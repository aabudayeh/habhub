import type {
  AppState,
  ChatMessage,
  Group,
  Member,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

const serializedValueCache = new WeakMap<object, string | undefined>();
const durableGroupCache = new WeakMap<Group, string>();
const durableMediaRowCache = new WeakMap<object, string>();

// AppState follows the React reducer invariant: nested values are replaced,
// never mutated in place. The WeakMap memoization below relies on that same
// invariant; reducers use immutable spreads and commit a new object for every
// user/device edit. This also means a transient cloud wrapper can reuse exact
// serialized results without retaining any account identifiers or row values.

function serializedValue(value: unknown) {
  if (value && typeof value === "object") {
    if (serializedValueCache.has(value))
      return serializedValueCache.get(value);
    const serialized = JSON.stringify(value);
    serializedValueCache.set(value, serialized);
    return serialized;
  }
  return JSON.stringify(value);
}

function samePersistedValue(left: unknown, right: unknown) {
  return left === right || serializedValue(left) === serializedValue(right);
}

function durableMember(member: Member) {
  const {
    lastSeenAt: _lastSeenAt,
    lastDataSyncedAt: _lastDataSyncedAt,
    profileRevision: _profileRevision,
    ...durable
  } = member;
  // A signed remote URL is a presentation cache, not durable account data.
  // Keep an unsynced local URI, though, so an avatar selected offline survives.
  return durable.avatarStoragePath ? { ...durable, avatarUri: undefined } : durable;
}

function durableGroup(group: Group) {
  return {
    ...group,
    members: group.members.map(durableMember),
    pendingMembers: group.pendingMembers?.map(durableMember),
  };
}

function durableGroupJson(group: Group) {
  const cached = durableGroupCache.get(group);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(durableGroup(group));
  durableGroupCache.set(group, serialized);
  return serialized;
}

function sameDurableGroup(left: Group, right: Group) {
  return left === right || durableGroupJson(left) === durableGroupJson(right);
}

function sameDurableGroups(left: Group[], right: Group[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((group, index) => sameDurableGroup(group, right[index]));
}

function durableMediaRowJson<T extends object>(
  row: T,
  durableValue: (value: T) => unknown,
) {
  const cached = durableMediaRowCache.get(row);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(durableValue(row));
  durableMediaRowCache.set(row, serialized);
  return serialized;
}

function sameDurableMediaRow<T extends object>(
  left: T,
  right: T,
  durableValue: (value: T) => unknown,
) {
  return (
    left === right ||
    durableMediaRowJson(left, durableValue) ===
      durableMediaRowJson(right, durableValue)
  );
}

function durableEntry(entry: MetricEntry) {
  return entry.imageStoragePath ? { ...entry, imageUri: undefined } : entry;
}

function durablePhoto(photo: PhotoUpdate) {
  return photo.storagePath ? { ...photo, uri: undefined } : photo;
}

function durableMessage(message: ChatMessage) {
  return message.imageStoragePath
    ? { ...message, imageUri: undefined }
    : message;
}

function sameRowsByReference<T>(
  left: T[],
  right: T[],
  included: (row: T) => boolean,
  sameRow: (leftRow: T, rightRow: T) => boolean =
    (leftRow, rightRow) => leftRow === rightRow,
) {
  if (left === right) return true;
  let leftIndex = 0;
  let rightIndex = 0;
  while (true) {
    while (leftIndex < left.length && !included(left[leftIndex])) leftIndex += 1;
    while (rightIndex < right.length && !included(right[rightIndex]))
      rightIndex += 1;
    const leftRow = left[leftIndex];
    const rightRow = right[rightIndex];
    if (!leftRow || !rightRow) return leftRow === rightRow;
    if (!sameRow(leftRow, rightRow)) return false;
    leftIndex += 1;
    rightIndex += 1;
  }
}

function sameOwnedRowsByReference<T extends { userId: string }>(
  left: T[],
  right: T[],
  userId: string,
  sameRow?: (leftRow: T, rightRow: T) => boolean,
) {
  return sameRowsByReference(
    left,
    right,
    (row) => row.userId === userId,
    sameRow,
  );
}

/**
 * Whether the monolithic offline/account cache would materially change.
 *
 * Realtime presence and signed-URL refreshes deliberately create new Group
 * objects. Treating those transient wrappers as durable edits serialized years
 * of Health history twice after virtually every online sync. Exact serialized
 * comparisons are limited to the small account collections; large activity
 * arrays retain the collision-free reference walk used by the persistence
 * projection.
 */
export function localPersistenceChanged(previous: AppState, next: AppState) {
  if (previous === next) return false;
  if (
    previous.version !== next.version ||
    previous.currentUserId !== next.currentUserId ||
    !sameDurableGroup(previous.group, next.group) ||
    !sameDurableGroups(previous.groups, next.groups) ||
    !samePersistedValue(previous.energyProfiles, next.energyProfiles) ||
    !samePersistedValue(previous.metrics, next.metrics) ||
    !samePersistedValue(previous.gymPlans, next.gymPlans) ||
    !samePersistedValue(previous.gymSessions, next.gymSessions) ||
    !samePersistedValue(previous.gymExerciseGoals, next.gymExerciseGoals) ||
    !samePersistedValue(previous.todos, next.todos) ||
    !samePersistedValue(previous.journalNotes, next.journalNotes) ||
    !samePersistedValue(previous.calendarReminders, next.calendarReminders) ||
    !samePersistedValue(previous.activityTimers, next.activityTimers) ||
    !samePersistedValue(previous.activeTimer, next.activeTimer) ||
    !samePersistedValue(previous.settings, next.settings) ||
    !samePersistedValue(previous.trackedGoalPeriods, next.trackedGoalPeriods) ||
    previous.selectedGroupMetricId !== next.selectedGroupMetricId
  )
    return true;
  return !(
    sameOwnedRowsByReference(
      previous.entries,
      next.entries,
      next.currentUserId,
      (left, right) => sameDurableMediaRow(left, right, durableEntry),
    ) &&
    sameOwnedRowsByReference(
      previous.dailyMetricStatuses,
      next.dailyMetricStatuses,
      next.currentUserId,
    ) &&
    sameOwnedRowsByReference(
      previous.photos,
      next.photos,
      next.currentUserId,
      (left, right) => sameDurableMediaRow(left, right, durablePhoto),
    ) &&
    sameRowsByReference(
      previous.messages,
      next.messages,
      (message) => message.senderId === next.currentUserId,
      (left, right) => sameDurableMediaRow(left, right, durableMessage),
    )
  );
}
