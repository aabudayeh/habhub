import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetInfo } from "@react-native-community/netinfo";
import { User } from "@supabase/supabase-js";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState as NativeAppState,
  InteractionManager,
  Platform,
} from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import {
  approveCloudGroupMember,
  type CloudActivityMetadata,
  createCloudGroup,
  isCloudGroupId,
  joinCloudGroup,
  leaveCloudGroup,
  loadCloudGroupActivity,
  loadCloudGroupShells,
  loadCloudMessages,
  loadCloudWorkspace,
  removeCloudGroupMember,
  sendMembershipPush,
  touchCloudGroupPresence,
  pushCloudRecentActivity,
  pushCloudWorkspace,
  pushCloudMessagesNow,
} from "@/src/cloud/groupCloud";
import { createInitialState } from "@/src/data/seed";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { metricEntryKey } from "@/src/domain/metricEntry";
import { suggestedAccountName } from "@/src/domain/profileName";
import {
  createPersonalSetupGroup,
  DEFAULT_GROUP_THEME,
  groupMetricDefinitions,
  isPersonalSetupGroup,
  personalSetupMetricConfiguration,
} from "@/src/domain/groupSetup";
import { upgradeStateV21 } from "@/src/domain/stateMigration";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import {
  readGroupActivityCache,
  writeGroupActivityCache,
} from "@/src/storage/groupActivityCache";
import { onboardingCompletedLocally } from "@/src/storage/onboardingState";
import {
  AppState,
  ChatMessage,
  Group,
  GroupCreationOptions,
  Member,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";
import { isCloudSyncPaused } from "@/src/cloud/syncGate";

const DEVICE_ID_KEY = "paceboard-cloud-device-id-v1";
const PENDING_GROUP_KEY = "metric-rally-pending-group-v1";
const MEDIA_BUCKET = "paceboard-media";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const GROUP_ACTIVITY_LOCAL_CACHE_DAYS = 120;
const GROUP_ACTIVITY_BACKGROUND_HISTORY_DAYS = 730;
const WORKSPACE_ACK_KEY_PREFIX = "habhub-workspace-ack-v2:";
const GROUP_CONFIGURATION_ACK_KEY_PREFIX =
  "habhub-group-configuration-ack-v2:";
const CLOUD_SYNC_CHECKPOINT_KEY_PREFIX = "habhub-cloud-checkpoint-v1:";
const CLOUD_SNAPSHOT_ACK_KEY_PREFIX = "habhub-cloud-snapshot-ack-v2:";
const CLOUD_MERGE_BASE_KEY_PREFIX = "habhub-cloud-merge-base-v2:";
const MAX_CLOUD_RETRY_MS = 5 * 60 * 1000;
const CHAT_OUTBOX_FRESHNESS_MS = 15 * 60 * 1000;
const LEADERBOARD_FRESHNESS_INTERVAL_MS = 5 * 60 * 1000;

export type CloudSyncStatus =
  | "disabled"
  | "initializing"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export type AccountDevice = {
  deviceId: string;
  platform: string;
  label?: string;
  lastSeenAt: string;
  isThisDevice: boolean;
};

type CloudSyncContextValue = {
  status: CloudSyncStatus;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  pendingChanges: boolean;
  pendingGroup: PendingGroupRequest | null;
  devices: AccountDevice[];
  syncNow: () => Promise<void>;
  pullLatest: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  forgetDevice: (deviceId: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  createGroup: (
    name: string,
    options?: GroupCreationOptions,
  ) => Promise<void>;
  joinGroup: (code: string) => Promise<"active" | "pending">;
  switchGroup: (groupId: string) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;
  refreshGroup: () => Promise<void>;
  refreshActivity: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  syncMessagesNow: (messageId?: string) => Promise<void>;
  approveMember: (userId: string) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
};

type CloudSyncActions = Pick<
  CloudSyncContextValue,
  | "syncNow"
  | "pullLatest"
  | "refreshDevices"
  | "forgetDevice"
  | "deleteAccount"
  | "createGroup"
  | "joinGroup"
  | "switchGroup"
  | "leaveGroup"
  | "refreshGroup"
  | "refreshActivity"
  | "refreshMessages"
  | "syncMessagesNow"
  | "approveMember"
  | "removeMember"
>;

export type PendingGroupRequest = {
  groupId: string;
  groupName?: string;
};

type SnapshotRow = {
  payload: AppState;
  revision: number;
  updated_at: string;
  device_id: string | null;
  schema_version: number;
};

type CloudMergeBase = {
  version: 2;
  settings: Record<string, string>;
  collections: Record<string, Record<string, string>>;
};

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);
const CloudSyncActionsContext = createContext<CloudSyncActions | null>(null);
const CloudSyncStatusContext = createContext<CloudSyncStatus>("disabled");

function parsePendingGroup(value: string | null): PendingGroupRequest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as PendingGroupRequest;
    if (parsed?.groupId) return parsed;
  } catch {
    // Older builds stored only the group id.
  }
  return { groupId: value };
}

function uniqueDeviceId() {
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function getDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = uniqueDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function accountName(user: User, fallback: string) {
  return suggestedAccountName(user) || fallback;
}

async function readCloudSyncCheckpoint(userId: string) {
  const value = await AsyncStorage.getItem(
    `${CLOUD_SYNC_CHECKPOINT_KEY_PREFIX}${userId}`,
  );
  return value && Number.isFinite(new Date(value).getTime()) ? value : null;
}

async function writeCloudSyncCheckpoint(userId: string, value: string) {
  await AsyncStorage.setItem(
    `${CLOUD_SYNC_CHECKPOINT_KEY_PREFIX}${userId}`,
    value,
  );
}

async function readCloudSnapshotAck(userId: string) {
  return AsyncStorage.getItem(`${CLOUD_SNAPSHOT_ACK_KEY_PREFIX}${userId}`);
}

async function writeCloudSnapshotAck(userId: string, hash: string) {
  await AsyncStorage.setItem(
    `${CLOUD_SNAPSHOT_ACK_KEY_PREFIX}${userId}`,
    hash,
  );
}

async function readCloudMergeBase(userId: string): Promise<CloudMergeBase | null> {
  try {
    const saved = await AsyncStorage.getItem(
      `${CLOUD_MERGE_BASE_KEY_PREFIX}${userId}`,
    );
    if (!saved) return null;
    const parsed = JSON.parse(saved) as CloudMergeBase;
    return parsed?.version === 2 && parsed.settings && parsed.collections
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function writeCloudMergeBase(userId: string, base: CloudMergeBase) {
  await AsyncStorage.setItem(
    `${CLOUD_MERGE_BASE_KEY_PREFIX}${userId}`,
    JSON.stringify(base),
  );
}

async function readWorkspaceAcks(userId: string) {
  try {
    const saved = await AsyncStorage.getItem(
      `${WORKSPACE_ACK_KEY_PREFIX}${userId}`,
    );
    if (!saved) return new Map<string, string>();
    const parsed = JSON.parse(saved) as Record<string, string>;
    return new Map(
      Object.entries(parsed).filter(
        ([groupId, hash]) => Boolean(groupId) && typeof hash === "string",
      ),
    );
  } catch {
    return new Map<string, string>();
  }
}

async function writeWorkspaceAcks(
  userId: string,
  acks: Map<string, string>,
) {
  await AsyncStorage.setItem(
    `${WORKSPACE_ACK_KEY_PREFIX}${userId}`,
    JSON.stringify(Object.fromEntries(acks)),
  );
}

async function readGroupConfigurationAcks(userId: string) {
  try {
    const saved = await AsyncStorage.getItem(
      `${GROUP_CONFIGURATION_ACK_KEY_PREFIX}${userId}`,
    );
    if (!saved) return new Map<string, string>();
    const parsed = JSON.parse(saved) as Record<string, string>;
    return new Map(
      Object.entries(parsed).filter(
        ([groupId, hash]) => Boolean(groupId) && typeof hash === "string",
      ),
    );
  } catch {
    return new Map<string, string>();
  }
}

async function writeGroupConfigurationAcks(
  userId: string,
  acks: Map<string, string>,
) {
  await AsyncStorage.setItem(
    `${GROUP_CONFIGURATION_ACK_KEY_PREFIX}${userId}`,
    JSON.stringify(Object.fromEntries(acks)),
  );
}

function isDemoBoundState(state: AppState) {
  return (
    state.group.id === "weekend-warriors" ||
    (!isCloudGroupId(state.group.id) &&
      state.group.members.some((member) =>
        ["sarah", "daniel", "maya"].includes(member.id),
      ))
  );
}

function createCleanAccountState(user: User): AppState {
  const defaults = createInitialState();
  const today = dateKey();
  const name = accountName(user, "HabHub member");
  const metrics = defaults.metrics.map((metric) => ({
    ...metric,
    activeFrom: today,
  }));
  const energyProfile = {
    age: 30,
    sex: "unspecified" as const,
    heightCm: 170,
    weightKg: 70,
    targetWeightKg: 70,
    activityLevel: "sedentary" as const,
    desiredWeeklyLossKg: 0.25,
  };
  // Onboarding fills the starter shell with only the goals the user chooses.
  // Keeping it empty here avoids leaking every catalog preset into Leaderboard.
  const group = createPersonalSetupGroup({
    id: user.id,
    name,
    initials:
      name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase() || "P",
    color: DEFAULT_GROUP_THEME,
    role: "owner",
  });
  return {
    ...defaults,
    currentUserId: user.id,
    group,
    groups: [group],
    metrics,
    entries: [],
    photos: [],
    messages: [],
    dailyMetricStatuses: [],
    energyProfiles: { [user.id]: energyProfile },
    settings: {
      ...defaults.settings,
      baselineCalories: 2000,
      energyProfile,
      memberNicknamesByGroup: { [group.id]: {} },
      badgeShowcaseByGroup: {},
      comparisonMetricIdsByGroup: {},
      comparisonPeriodByGroup: {},
    },
    trackedGoalPeriods: Object.fromEntries(
      metrics.map((metric) => [metric.id, []]),
    ),
    selectedGroupMetricId: "__score",
    lastSavedAt: null,
  };
}

function stateWithActiveGroup(
  state: AppState,
  group: Group,
  groups: Group[] = state.groups,
): AppState {
  if (!isPersonalSetupGroup(group)) return { ...state, group, groups };
  const metricConfiguration = personalSetupMetricConfiguration(
    state.metrics,
    state.trackedGoalPeriods,
  );
  const personalGroup = { ...group, metricConfiguration };
  return {
    ...state,
    group: personalGroup,
    groups: groups.map((candidate) =>
      candidate.id === personalGroup.id ? personalGroup : candidate,
    ),
    selectedGroupMetricId: metricConfiguration.some(
      (metric) => metric.id === state.selectedGroupMetricId,
    )
      ? state.selectedGroupMetricId
      : (metricConfiguration[0]?.id ?? "__score"),
  };
}

/** Cloud identities never inherit another local account or the seeded demo member. */
function bindStateToAccount(state: AppState, user: User): AppState {
  const defaults = createInitialState();
  const sourceVersion = Number(state.version ?? 1);
  if (state.currentUserId !== user.id || isDemoBoundState(state))
    return createCleanAccountState(user);
  if (sourceVersion >= 20)
    return upgradeStateV21({
      ...state,
      version: 23,
      settings: { ...state.settings, fontScale: state.settings.fontScale ?? 1 },
    }, defaults, sourceVersion);
  if (sourceVersion >= 19)
    return upgradeStateV21({
      ...state,
      version: 23,
      metrics: upgradeBloodPressureMetrics(state.metrics),
      settings: { ...state.settings, fontScale: state.settings.fontScale ?? 1 },
    }, defaults, sourceVersion);
  const historicalStart = state.entries
    .filter((entry) => entry.userId === user.id)
    .map((entry) => entry.localDate)
    .sort()[0];
  if (!historicalStart)
    return upgradeStateV21({
      ...state,
      version: 23,
      metrics: upgradeBloodPressureMetrics(state.metrics),
      settings: {
        ...state.settings,
        fontScale: state.settings.fontScale ?? 1,
        progressMetricIds: [
          "tracked_goals",
          ...(state.settings.progressMetricIds ?? []).filter(
            (id) => id !== "tracked_goals",
          ),
        ],
      },
    }, defaults, sourceVersion);
  const retrospective = new Set(
    state.metrics
      .filter((metric) =>
        (state.trackedGoalPeriods?.[metric.id] ?? []).some(
          (period) =>
            period.from === metric.activeFrom && historicalStart < period.from,
        ),
      )
      .map((metric) => metric.id),
  );
  return upgradeStateV21({
    ...state,
    version: 23,
    settings: {
      ...state.settings,
      fontScale: state.settings.fontScale ?? 1,
      progressMetricIds: [
        "tracked_goals",
        ...(state.settings.progressMetricIds ?? []).filter(
          (id) => id !== "tracked_goals",
        ),
      ],
    },
    metrics: upgradeBloodPressureMetrics(
      state.metrics.map((metric) =>
        retrospective.has(metric.id)
          ? { ...metric, activeFrom: historicalStart }
          : metric,
      ),
    ),
    trackedGoalPeriods: Object.fromEntries(
      Object.entries(state.trackedGoalPeriods ?? {}).map(
        ([metricId, periods]) => [
          metricId,
          retrospective.has(metricId)
            ? periods.map((period) => ({ ...period, from: historicalStart }))
            : periods,
        ],
      ),
    ),
  }, defaults, sourceVersion);
}

function photoUri(uri: PhotoUpdate["uri"]) {
  if (typeof uri === "string") return uri;
  if (typeof uri === "object" && uri && "uri" in uri) return uri.uri;
  return null;
}

function isUploadableLocalUri(uri: string | null) {
  return Boolean(uri && /^(file:|content:|ph:|blob:|data:)/i.test(uri));
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

function mediaInfo(uri: string, contentType?: string | null) {
  const fromType = contentType?.toLowerCase();
  if (fromType?.includes("png"))
    return { extension: "png", contentType: "image/png" };
  if (fromType?.includes("webp"))
    return { extension: "webp", contentType: "image/webp" };
  if (fromType?.includes("heic") || /\.hei[cf](?:$|\?)/i.test(uri))
    return { extension: "heic", contentType: "image/heic" };
  if (/\.png(?:$|\?)/i.test(uri))
    return { extension: "png", contentType: "image/png" };
  if (/\.webp(?:$|\?)/i.test(uri))
    return { extension: "webp", contentType: "image/webp" };
  return { extension: "jpg", contentType: "image/jpeg" };
}

async function uploadMedia(
  userId: string,
  kind: string,
  id: string,
  uri: string,
) {
  if (!supabase) throw new Error("Cloud is not configured.");
  const response = await fetch(uri);
  if (!response.ok)
    throw new Error(`Could not read the selected ${kind} image.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 25 * 1024 * 1024)
    throw new Error("Images must be smaller than 25 MB.");
  const info = mediaInfo(uri, response.headers.get("content-type"));
  const path = `${userId}/account/${safePart(kind)}/${safePart(id)}.${info.extension}`;
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, {
      contentType: info.contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw error;
  return path;
}

async function uploadOwnedMedia(state: AppState): Promise<AppState> {
  const userId = state.currentUserId;
  let changed = false;

  // Upload the account avatar first. A large Health Connect/photo backlog must
  // never leave a newly-selected profile picture waiting behind every other
  // media item. The path is deterministic and upserted, so retries are safe.
  const localAvatar = [state.group, ...state.groups]
    .flatMap((group) => group.members)
    .find(
      (member) =>
        member.id === userId &&
        !member.avatarStoragePath &&
        isUploadableLocalUri(member.avatarUri ?? null),
    );
  const uploadedAvatarPath = localAvatar
    ? await uploadMedia(
        userId,
        "avatar",
        userId,
        localAvatar.avatarUri!,
      )
    : undefined;
  if (uploadedAvatarPath) changed = true;

  const entries: MetricEntry[] = [];
  for (const entry of state.entries) {
    if (
      entry.userId === userId &&
      !entry.imageStoragePath &&
      isUploadableLocalUri(entry.imageUri ?? null)
    ) {
      const path = await uploadMedia(
        userId,
        "entry",
        entry.id,
        entry.imageUri!,
      );
      entries.push({ ...entry, imageStoragePath: path });
      changed = true;
    } else entries.push(entry);
  }
  const photos: PhotoUpdate[] = [];
  for (const photo of state.photos) {
    const uri = photoUri(photo.uri);
    if (
      photo.userId === userId &&
      !photo.storagePath &&
      isUploadableLocalUri(uri)
    ) {
      const path = await uploadMedia(userId, "photo", photo.id, uri!);
      photos.push({ ...photo, storagePath: path });
      changed = true;
    } else photos.push(photo);
  }
  const messages: ChatMessage[] = [];
  for (const message of state.messages) {
    if (
      message.senderId === userId &&
      !message.imageStoragePath &&
      isUploadableLocalUri(message.imageUri ?? null)
    ) {
      const path = await uploadMedia(
        userId,
        "chat",
        message.id,
        message.imageUri!,
      );
      messages.push({ ...message, imageStoragePath: path });
      changed = true;
    } else messages.push(message);
  }
  const updateGroup = async (group: Group): Promise<Group> => {
    const members: Member[] = group.members.map((member) =>
      member.id === userId && uploadedAvatarPath
        ? { ...member, avatarStoragePath: uploadedAvatarPath }
        : member,
    );
    return { ...group, members };
  };
  const groups = [] as Group[];
  for (const group of state.groups) groups.push(await updateGroup(group));
  const currentGroup =
    groups.find((group) => group.id === state.group.id) ??
    (await updateGroup(state.group));
  return changed
    ? { ...state, entries, photos, messages, groups, group: currentGroup }
    : state;
}

/** Never persist temporary signed URLs; only stable private-bucket paths. */
function snapshotPayload(state: AppState): AppState {
  const groups = state.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      const {
        lastSeenAt: _presence,
        lastDataSyncedAt: _published,
        ...stableMember
      } = member;
      return stableMember.avatarStoragePath
        ? { ...stableMember, avatarUri: undefined }
        : stableMember;
    }),
    pendingMembers: group.pendingMembers?.map((member) => {
      const {
        lastSeenAt: _presence,
        lastDataSyncedAt: _published,
        ...stableMember
      } = member;
      return stableMember;
    }),
  }));
  const currentGroup =
    groups.find((group) => group.id === state.group.id) ??
    {
      ...state.group,
      members: state.group.members.map((member) => {
        const {
          lastSeenAt: _presence,
          lastDataSyncedAt: _published,
          ...stableMember
        } = member;
        return stableMember;
      }),
    };
  return {
    ...state,
    // These flags describe a native import cursor on this physical device.
    // Syncing them to another phone could start (or finish) the wrong Health
    // Connect backfill there.
    settings: {
      ...state.settings,
      // This is a device-local outbox marker. Uploading it could make another
      // device push stale group settings on this device's behalf.
      pendingGroupConfigurationIds: undefined,
      healthSync: {
        ...state.settings.healthSync,
        enabled: false,
        backgroundAccess: false,
        initialHistoryImportPending: undefined,
        backfillTrackedGoalsOnFirstImport: undefined,
        backfillTrackedGoalsEmptyReadCount: undefined,
      },
    },
    group: currentGroup,
    groups,
    // Shared group history is an on-device cache backed by relational tables.
    // Keeping it out of the private snapshot makes hashing/saving proportional
    // to this user's data rather than the size of every group they joined.
    entries: state.entries
      .filter((entry) => entry.userId === state.currentUserId)
      .map((entry) =>
        entry.imageStoragePath ? { ...entry, imageUri: undefined } : entry,
      ),
    photos: state.photos
      .filter((photo) => photo.userId === state.currentUserId)
      .map((photo) => (photo.storagePath ? { ...photo, uri: "" } : photo)),
    // Group history is cached locally and reloaded from the relational table.
    // Keeping only owned messages in the private snapshot makes hashing and
    // account sync independent of a busy group chat.
    messages: state.messages
      .filter((message) => message.senderId === state.currentUserId)
      .map((message) =>
        message.imageStoragePath ? { ...message, imageUri: undefined } : message,
      ),
    dailyMetricStatuses: state.dailyMetricStatuses.filter(
      (status) => status.userId === state.currentUserId,
    ),
    lastSavedAt: null,
  };
}

function canonicalHashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalHashValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalHashValue(item)]),
    );
  }
  return value;
}

function valueHash(value: unknown) {
  const serialized = JSON.stringify(canonicalHashValue(value));
  const source = serialized === undefined ? "__undefined__" : serialized;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function hashRecord(record: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, value]) => [key, valueHash(value)]),
  );
}

function hashCollection<T>(
  items: T[] | undefined,
  keyFor: (item: T) => string,
) {
  return Object.fromEntries(
    (items ?? []).map((item) => [keyFor(item), valueHash(item)]),
  );
}

/**
 * Compact three-way merge base for account fields commonly edited from both
 * mobile and the web companion. Hashes distinguish an unchanged cached value
 * from an offline edit or deletion without duplicating the account payload in
 * AsyncStorage.
 */
function createCloudMergeBase(state: AppState): CloudMergeBase {
  const payload = snapshotPayload(state);
  const timers = payload.activityTimers?.length
    ? payload.activityTimers
    : payload.activeTimer
      ? [payload.activeTimer]
      : [];
  return {
    version: 2,
    settings: hashRecord(payload.settings as unknown as Record<string, unknown>),
    collections: {
      energyProfiles: hashRecord(
        payload.energyProfiles as unknown as Record<string, unknown>,
      ),
      gymExerciseGoals: hashRecord(
        payload.gymExerciseGoals as unknown as Record<string, unknown>,
      ),
      trackedGoalPeriods: hashRecord(
        payload.trackedGoalPeriods as unknown as Record<string, unknown>,
      ),
      pendingDeletedEntryIds: hashCollection(
        payload.settings.pendingDeletedEntryIds,
        (id) => id,
      ),
      pendingDeletedPhotoIds: hashCollection(
        payload.settings.pendingDeletedPhotoIds,
        (id) => id,
      ),
      deletedEntryIds: hashCollection(
        payload.settings.deletedEntryIds,
        (id) => id,
      ),
      deletedPhotoIds: hashCollection(
        payload.settings.deletedPhotoIds,
        (id) => id,
      ),
      dismissedHealthEntryIds: hashCollection(
        payload.settings.dismissedHealthEntryIds,
        (id) => id,
      ),
      metrics: hashCollection(payload.metrics, (item) => item.id),
      entries: hashCollection(payload.entries, (item) =>
        metricEntryKey(item.userId, item.id),
      ),
      photos: hashCollection(
        payload.photos,
        (item) => `${item.userId}:${item.id}`,
      ),
      messages: hashCollection(payload.messages, (item) => item.id),
      dailyMetricStatuses: hashCollection(
        payload.dailyMetricStatuses,
        dailyStatusKey,
      ),
      gymPlans: hashCollection(
        payload.gymPlans,
        (item) => `${item.userId}:${item.id}`,
      ),
      gymSessions: hashCollection(
        payload.gymSessions,
        (item) => `${item.userId}:${item.id}`,
      ),
      todos: hashCollection(payload.todos, (item) => item.id),
      journalNotes: hashCollection(
        payload.journalNotes,
        (item) => `${item.userId}:${item.id}`,
      ),
      calendarReminders: hashCollection(
        payload.calendarReminders,
        (item) => item.id,
      ),
      activityTimers: hashCollection(timers, (item) => item.id),
    },
  };
}

const stableHashCache = new WeakMap<AppState, string>();
const workspaceHashCache = new WeakMap<AppState, string>();

function stableHash(state: AppState) {
  const cached = stableHashCache.get(state);
  if (cached) return cached;
  const payload = snapshotPayload(state);
  // These values only remember which view was open on this device. They can
  // hitch a ride with a later durable account save, but switching a filter or
  // date range must not turn Cloud Account into a permanent "Pending" outbox.
  // Actual display preferences (theme, text size, tab order, visibility, etc.)
  // remain part of the synced hash.
  const settings = { ...payload.settings } as Record<string, unknown>;
  [
    "activeTrackerViewFilterId",
    "activeTodayTrackerViewFilterId",
    "activeProgressTrackerViewFilterId",
    "activePerformanceTrackerViewFilterId",
    "activeScheduleViewFilterId",
    "progressHistoryAnchor",
    "progressHistoryRange",
    "performanceRange",
    "tutorialGuideId",
    "tutorialGuideRunId",
    // Native health authorization/import preferences belong to this physical
    // device. They may ride with another durable save, but must never reopen
    // the account outbox merely because two devices use different schedules.
    "healthSync",
    "healthHistoryDays",
    "syncMode",
  ].forEach((key) => delete settings[key]);
  const groupShell = (group: Group) =>
    isCloudGroupId(group.id) ? { id: group.id } : group;
  const hash = valueHash({
    ...payload,
    settings,
    // Cloud group shells are hydrated from relational tables. Membership,
    // invites and admin-owned configuration changing on the server is not a
    // private account edit and must not re-open this device's outbox.
    group: groupShell(payload.group),
    groups: payload.groups.map(groupShell),
    selectedGroupMetricId: undefined,
  });
  stableHashCache.set(state, hash);
  return hash;
}

/** Only data represented by relational group tables belongs in a group push. */
function workspaceHash(state: AppState) {
  const cached = workspaceHashCache.get(state);
  if (cached) return cached;
  const payload = snapshotPayload(state);
  const currentMember = payload.group.members.find(
    (member) => member.id === payload.currentUserId,
  );
  const hash = valueHash({
    currentUserId: payload.currentUserId,
    groupId: payload.group.id,
    // The group shell, membership list and shared tracker definitions are
    // server-owned cache. Only this member's editable profile belongs in their
    // workspace outbox; group configuration has its own explicit hash below.
    currentMember: currentMember
      ? {
          id: currentMember.id,
          name: currentMember.name,
          initials: currentMember.initials,
          color: currentMember.color,
          avatarStoragePath: currentMember.avatarStoragePath,
        }
      : null,
    energyProfile:
      payload.energyProfiles[payload.currentUserId] ??
      payload.settings.energyProfile,
    aliases: payload.settings.memberNicknamesByGroup[payload.group.id] ?? {},
    entries: payload.entries.filter(
      (entry) => entry.userId === payload.currentUserId,
    ),
    photos: payload.photos.filter(
      (photo) => photo.userId === payload.currentUserId,
    ),
    dailyMetricStatuses: payload.dailyMetricStatuses.filter(
      (status) => status.userId === payload.currentUserId,
    ),
  });
  workspaceHashCache.set(state, hash);
  return hash;
}

async function resolvePrivateMedia(state: AppState): Promise<AppState> {
  if (!supabase) return state;
  const paths = new Set<string>();
  state.groups.forEach((group) =>
    group.members.forEach(
      (member) =>
        member.avatarStoragePath && paths.add(member.avatarStoragePath),
    ),
  );
  state.entries.forEach(
    (entry) => entry.imageStoragePath && paths.add(entry.imageStoragePath),
  );
  state.photos.forEach(
    (photo) => photo.storagePath && paths.add(photo.storagePath),
  );
  state.messages.forEach(
    (message) =>
      message.imageStoragePath && paths.add(message.imageStoragePath),
  );
  if (!paths.size) return state;
  const orderedPaths = [...paths];
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(orderedPaths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  const urls = new Map(
    (data ?? [])
      .filter((item) => item.signedUrl)
      .map((item) => [item.path, item.signedUrl]),
  );
  const groups = state.groups.map((group) => ({
    ...group,
    members: group.members.map((member) =>
      member.avatarStoragePath && urls.get(member.avatarStoragePath)
        ? { ...member, avatarUri: urls.get(member.avatarStoragePath)! }
        : member,
    ),
  }));
  return {
    ...state,
    groups,
    group: groups.find((group) => group.id === state.group.id) ?? state.group,
    entries: state.entries.map((entry) =>
      entry.imageStoragePath && urls.get(entry.imageStoragePath)
        ? { ...entry, imageUri: urls.get(entry.imageStoragePath)! }
        : entry,
    ),
    photos: state.photos.map((photo) =>
      photo.storagePath && urls.get(photo.storagePath)
        ? { ...photo, uri: urls.get(photo.storagePath)! }
        : photo,
    ),
    messages: state.messages.map((message) =>
      message.imageStoragePath && urls.get(message.imageStoragePath)
        ? { ...message, imageUri: urls.get(message.imageStoragePath)! }
        : message,
    ),
  };
}

/**
 * Copy only resolved/cached media URLs into the current durable state. Signed
 * URLs are presentation cache, not conflict-resolution input, so this helper
 * must never replace tracker, to-do, timer, or log fields.
 */
function mergePrivateMediaUrls(
  current: AppState,
  mediaSource: AppState,
): AppState {
  let changed = false;
  const avatarUrls = new Map<string, string>();
  mediaSource.groups.forEach((group) =>
    group.members.forEach((member) => {
      if (member.avatarStoragePath && member.avatarUri)
        avatarUrls.set(
          `${group.id}:${member.id}:${member.avatarStoragePath}`,
          member.avatarUri,
        );
    }),
  );
  const groups = current.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      if (!member.avatarStoragePath) return member;
      const uri = avatarUrls.get(
        `${group.id}:${member.id}:${member.avatarStoragePath}`,
      );
      if (!uri || uri === member.avatarUri) return member;
      changed = true;
      return { ...member, avatarUri: uri };
    }),
  }));
  const entryUrls = new Map(
    mediaSource.entries
      .filter((entry) => entry.imageStoragePath && entry.imageUri)
      .map((entry) => [
        `${metricEntryKey(entry.userId, entry.id)}:${entry.imageStoragePath}`,
        entry.imageUri!,
      ]),
  );
  const entries = current.entries.map((entry) => {
    if (!entry.imageStoragePath) return entry;
    const uri = entryUrls.get(
      `${metricEntryKey(entry.userId, entry.id)}:${entry.imageStoragePath}`,
    );
    if (!uri || uri === entry.imageUri) return entry;
    changed = true;
    return { ...entry, imageUri: uri };
  });
  const photoUrls = new Map(
    mediaSource.photos
      .filter((photo) => photo.storagePath && photo.uri)
      .map((photo) => [`${photo.id}:${photo.storagePath}`, photo.uri]),
  );
  const photos = current.photos.map((photo) => {
    if (!photo.storagePath) return photo;
    const uri = photoUrls.get(`${photo.id}:${photo.storagePath}`);
    if (!uri || uri === photo.uri) return photo;
    changed = true;
    return { ...photo, uri };
  });
  const messageUrls = new Map(
    mediaSource.messages
      .filter((message) => message.imageStoragePath && message.imageUri)
      .map((message) => [
        `${message.id}:${message.imageStoragePath}`,
        message.imageUri!,
      ]),
  );
  const messages = current.messages.map((message) => {
    if (!message.imageStoragePath) return message;
    const uri = messageUrls.get(
      `${message.id}:${message.imageStoragePath}`,
    );
    if (!uri || uri === message.imageUri) return message;
    changed = true;
    return { ...message, imageUri: uri };
  });
  if (!changed) return current;
  return {
    ...current,
    groups,
    group: groups.find((group) => group.id === current.group.id) ?? current.group,
    entries,
    photos,
    messages,
  };
}

/** Merge only newly uploaded storage paths into the latest live state. */
function mergeUploadedMediaMetadata(
  current: AppState,
  uploaded: AppState,
): AppState {
  let changed = false;
  const userId = current.currentUserId;
  const uploadedAvatar = [uploaded.group, ...uploaded.groups]
    .flatMap((group) => group.members)
    .find(
      (member) => member.id === userId && member.avatarStoragePath,
    );
  const groups = current.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      if (
        member.id !== userId ||
        member.avatarStoragePath ||
        !uploadedAvatar?.avatarStoragePath ||
        member.avatarUri !== uploadedAvatar.avatarUri
      )
        return member;
      changed = true;
      return {
        ...member,
        avatarStoragePath: uploadedAvatar.avatarStoragePath,
      };
    }),
  }));
  const uploadedEntries = new Map(
    uploaded.entries.map((entry) => [
      metricEntryKey(entry.userId, entry.id),
      entry,
    ]),
  );
  const entries = current.entries.map((entry) => {
    const source = uploadedEntries.get(metricEntryKey(entry.userId, entry.id));
    if (
      entry.imageStoragePath ||
      !source?.imageStoragePath ||
      entry.imageUri !== source.imageUri
    )
      return entry;
    changed = true;
    return { ...entry, imageStoragePath: source.imageStoragePath };
  });
  const uploadedPhotos = new Map(
    uploaded.photos.map((photo) => [photo.id, photo]),
  );
  const photos = current.photos.map((photo) => {
    const source = uploadedPhotos.get(photo.id);
    if (
      photo.storagePath ||
      !source?.storagePath ||
      photoUri(photo.uri) !== photoUri(source.uri)
    )
      return photo;
    changed = true;
    return { ...photo, storagePath: source.storagePath };
  });
  const uploadedMessages = new Map(
    uploaded.messages.map((message) => [message.id, message]),
  );
  const messages = current.messages.map((message) => {
    const source = uploadedMessages.get(message.id);
    if (
      message.imageStoragePath ||
      !source?.imageStoragePath ||
      message.imageUri !== source.imageUri
    )
      return message;
    changed = true;
    return { ...message, imageStoragePath: source.imageStoragePath };
  });
  if (!changed) return current;
  return {
    ...current,
    groups,
    group: groups.find((group) => group.id === current.group.id) ?? current.group,
    entries,
    photos,
    messages,
  };
}

function mergeById<T extends { id: string }>(remote: T[], local: T[]) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function mergeRecordFromBase<T>(
  remote: Record<string, T> | undefined,
  local: Record<string, T> | undefined,
  baseHashes?: Record<string, string>,
) {
  const remoteRecord = remote ?? {};
  const localRecord = local ?? {};
  const keys = new Set([
    ...Object.keys(baseHashes ?? {}),
    ...Object.keys(remoteRecord),
    ...Object.keys(localRecord),
  ]);
  const merged: Record<string, T> = {};
  keys.forEach((key) => {
    const remoteHas = Object.prototype.hasOwnProperty.call(remoteRecord, key);
    const localHas = Object.prototype.hasOwnProperty.call(localRecord, key);
    const remoteHash = remoteHas ? valueHash(remoteRecord[key]) : undefined;
    const localHash = localHas ? valueHash(localRecord[key]) : undefined;
    const baseHash = baseHashes?.[key];
    const remoteChanged = remoteHash !== baseHash;
    const localChanged = localHash !== baseHash;
    const useLocal =
      (localChanged && !remoteChanged) ||
      (localChanged && remoteChanged && localHash !== remoteHash);
    if (useLocal ? localHas : remoteHas)
      merged[key] = useLocal ? localRecord[key] : remoteRecord[key];
  });
  return merged;
}

function mergeCollectionFromBase<T>(
  remote: T[] | undefined,
  local: T[] | undefined,
  keyFor: (item: T) => string,
  baseHashes?: Record<string, string>,
) {
  const remoteMap = new Map((remote ?? []).map((item) => [keyFor(item), item]));
  const localMap = new Map((local ?? []).map((item) => [keyFor(item), item]));
  const keys = new Set([
    ...Object.keys(baseHashes ?? {}),
    ...remoteMap.keys(),
    ...localMap.keys(),
  ]);
  const merged: T[] = [];
  keys.forEach((key) => {
    const remoteItem = remoteMap.get(key);
    const localItem = localMap.get(key);
    const remoteHash = remoteItem ? valueHash(remoteItem) : undefined;
    const localHash = localItem ? valueHash(localItem) : undefined;
    const baseHash = baseHashes?.[key];
    const remoteChanged = remoteHash !== baseHash;
    const localChanged = localHash !== baseHash;
    const useLocal =
      (localChanged && !remoteChanged) ||
      (localChanged && remoteChanged && localHash !== remoteHash);
    const selected = useLocal ? localItem : remoteItem;
    if (selected) merged.push(selected);
  });
  return merged;
}

function mergeStates(
  remote: AppState,
  local: AppState,
  base?: CloudMergeBase | null,
): AppState {
  const groups = mergeById(remote.groups, local.groups);
  const onboardingComplete =
    remote.settings.onboardingComplete ||
    local.settings.onboardingComplete;
  const tutorialComplete =
    remote.settings.tutorialComplete ||
    local.settings.tutorialComplete;
  const settings = mergeRecordFromBase(
    remote.settings as unknown as Record<string, unknown>,
    local.settings as unknown as Record<string, unknown>,
    base?.settings,
  ) as unknown as AppState["settings"];
  settings.onboardingComplete = onboardingComplete;
  settings.tutorialComplete = tutorialComplete;
  settings.pendingDeletedEntryIds = mergeCollectionFromBase(
    remote.settings.pendingDeletedEntryIds,
    local.settings.pendingDeletedEntryIds,
    (id) => id,
    base?.collections.pendingDeletedEntryIds,
  );
  settings.pendingDeletedPhotoIds = mergeCollectionFromBase(
    remote.settings.pendingDeletedPhotoIds,
    local.settings.pendingDeletedPhotoIds,
    (id) => id,
    base?.collections.pendingDeletedPhotoIds,
  );
  settings.deletedEntryIds = mergeCollectionFromBase(
    remote.settings.deletedEntryIds,
    local.settings.deletedEntryIds,
    (id) => id,
    base?.collections.deletedEntryIds,
  );
  settings.deletedPhotoIds = mergeCollectionFromBase(
    remote.settings.deletedPhotoIds,
    local.settings.deletedPhotoIds,
    (id) => id,
    base?.collections.deletedPhotoIds,
  );
  settings.dismissedHealthEntryIds = mergeCollectionFromBase(
    remote.settings.dismissedHealthEntryIds,
    local.settings.dismissedHealthEntryIds,
    (id) => id,
    base?.collections.dismissedHealthEntryIds,
  );
  const deletedEntryIds = new Set([
    ...(settings.pendingDeletedEntryIds ?? []),
    ...(settings.deletedEntryIds ?? []),
  ]);
  const deletedPhotoIds = new Set([
    ...(settings.pendingDeletedPhotoIds ?? []),
    ...(settings.deletedPhotoIds ?? []),
  ]);
  const activityTimers = mergeCollectionFromBase(
    remote.activityTimers?.length
      ? remote.activityTimers
      : remote.activeTimer
        ? [remote.activeTimer]
        : [],
    local.activityTimers?.length
      ? local.activityTimers
      : local.activeTimer
        ? [local.activeTimer]
        : [],
    (item) => item.id,
    base?.collections.activityTimers,
  );
  return {
    ...remote,
    ...local,
    settings,
    groups,
    group: groups.find((group) => group.id === local.group.id) ?? local.group,
    energyProfiles: mergeRecordFromBase(
      remote.energyProfiles,
      local.energyProfiles,
      base?.collections.energyProfiles,
    ),
    metrics: mergeCollectionFromBase(
      remote.metrics,
      local.metrics,
      (item) => item.id,
      base?.collections.metrics,
    ),
    entries: mergeCollectionFromBase(
      remote.entries,
      local.entries,
      (entry) => metricEntryKey(entry.userId, entry.id),
      base?.collections.entries,
    ).filter(
      (entry) =>
        entry.userId !== local.currentUserId ||
        !deletedEntryIds.has(entry.id),
    ),
    photos: mergeCollectionFromBase(
      remote.photos,
      local.photos,
      (photo) => `${photo.userId}:${photo.id}`,
      base?.collections.photos,
    ).filter(
      (photo) =>
        photo.userId !== local.currentUserId ||
        !deletedPhotoIds.has(photo.id),
    ),
    messages: mergeCollectionFromBase(
      remote.messages,
      local.messages,
      (message) => message.id,
      base?.collections.messages,
    ),
    dailyMetricStatuses: mergeCollectionFromBase(
      remote.dailyMetricStatuses,
      local.dailyMetricStatuses,
      dailyStatusKey,
      base?.collections.dailyMetricStatuses,
    ),
    gymPlans: mergeCollectionFromBase(
      remote.gymPlans,
      local.gymPlans,
      (plan) => `${plan.userId}:${plan.id}`,
      base?.collections.gymPlans,
    ),
    gymSessions: mergeCollectionFromBase(
      remote.gymSessions,
      local.gymSessions,
      (session) => `${session.userId}:${session.id}`,
      base?.collections.gymSessions,
    ),
    gymExerciseGoals: mergeRecordFromBase(
      remote.gymExerciseGoals,
      local.gymExerciseGoals,
      base?.collections.gymExerciseGoals,
    ),
    todos: mergeCollectionFromBase(
      remote.todos,
      local.todos,
      (item) => item.id,
      base?.collections.todos,
    ),
    journalNotes: mergeCollectionFromBase(
      remote.journalNotes,
      local.journalNotes,
      (item) => `${item.userId}:${item.id}`,
      base?.collections.journalNotes,
    ),
    calendarReminders: mergeCollectionFromBase(
      remote.calendarReminders,
      local.calendarReminders,
      (item) => item.id,
      base?.collections.calendarReminders,
    ),
    activityTimers,
    activeTimer:
      activityTimers.find((timer) => timer.id === local.activeTimer?.id) ??
      activityTimers.find((timer) => timer.id === remote.activeTimer?.id) ??
      activityTimers[0],
    trackedGoalPeriods: mergeRecordFromBase(
      remote.trackedGoalPeriods,
      local.trackedGoalPeriods,
      base?.collections.trackedGoalPeriods,
    ),
    lastSavedAt: null,
  };
}

/** Native health authorization/import state belongs to this device, not cloud. */
function preserveDeviceHealthState(
  remote: AppState,
  local: AppState,
): AppState {
  if (remote.currentUserId !== local.currentUserId) return remote;
  return {
    ...remote,
    settings: {
      ...remote.settings,
      healthSync: local.settings.healthSync,
      healthHistoryDays: local.settings.healthHistoryDays,
      syncMode: local.settings.syncMode,
    },
  };
}

/**
 * Accept a newer account snapshot when this device has no local outbox.
 * Server-owned account fields (to-dos, timers, tracker order/settings, notes,
 * and owned logs) win, while relational group history remains a local cache
 * and native health authorization remains device-owned.
 */
function acceptCleanRemoteState(remote: AppState, local: AppState): AppState {
  if (remote.currentUserId !== local.currentUserId) return remote;
  const userId = remote.currentUserId;
  const remoteWithDeviceSettings = preserveDeviceHealthState(remote, local);
  // Personal setup groups are account-owned and therefore follow the remote
  // snapshot. Cloud groups are relational data, so retain their hydrated local
  // cache until the workspace refresh below replaces it. Treating every local
  // group as newer here resurrected stale personal setup colors/trackers after
  // a clean pull and could leave `group` inconsistent with the same item in
  // `groups`.
  const remoteGroupIds = new Set(
    remoteWithDeviceSettings.groups.map((group) => group.id),
  );
  const localCloudGroups = new Map(
    local.groups
      .filter((group) => isCloudGroupId(group.id))
      .map((group) => [group.id, group] as const),
  );
  const groups = [
    ...remoteWithDeviceSettings.groups.map((group) =>
      isCloudGroupId(group.id)
        ? (localCloudGroups.get(group.id) ?? group)
        : group,
    ),
    ...local.groups.filter(
      (group) =>
        isCloudGroupId(group.id) && !remoteGroupIds.has(group.id),
    ),
  ];
  const activeGroup = isCloudGroupId(remoteWithDeviceSettings.group.id)
    ? (groups.find(
        (group) => group.id === remoteWithDeviceSettings.group.id,
      ) ?? remoteWithDeviceSettings.group)
    : remoteWithDeviceSettings.group;
  const keepForeign = <T extends { userId: string }>(items: T[]) =>
    items.filter((item) => item.userId !== userId);
  const keepForeignPhotos = local.photos.filter(
    (photo) => photo.userId !== userId,
  );
  const keepForeignMessages = local.messages.filter(
    (message) => message.senderId !== userId,
  );
  const keepForeignStatuses = local.dailyMetricStatuses.filter(
    (item) => item.userId !== userId,
  );
  return {
    ...remoteWithDeviceSettings,
    group: activeGroup,
    groups,
    selectedGroupMetricId:
      remoteWithDeviceSettings.group.id === local.group.id
        ? local.selectedGroupMetricId
        : remoteWithDeviceSettings.selectedGroupMetricId,
    entries: [
      ...remoteWithDeviceSettings.entries.filter(
        (entry) => entry.userId === userId,
      ),
      ...keepForeign(local.entries),
    ],
    photos: [
      ...remoteWithDeviceSettings.photos.filter(
        (photo) => photo.userId === userId,
      ),
      ...keepForeignPhotos,
    ],
    messages: [
      ...remoteWithDeviceSettings.messages.filter(
        (message) => message.senderId === userId,
      ),
      ...keepForeignMessages,
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    dailyMetricStatuses: [
      ...remoteWithDeviceSettings.dailyMetricStatuses.filter(
        (item) => item.userId === userId,
      ),
      ...keepForeignStatuses,
    ],
    lastSavedAt: null,
  };
}

type MembershipRealtimeRow = {
  group_id?: string;
  user_id?: string;
  role?: Member["role"];
  status?: "active" | "pending";
  last_seen_at?: string;
  last_data_synced_at?: string;
};

function applyMembershipRealtimeRow(
  state: AppState,
  row: MembershipRealtimeRow,
): AppState | null {
  const groupId = row.group_id;
  const userId = row.user_id;
  if (!groupId || !userId) return null;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return null;
  const active = group.members.find((member) => member.id === userId);
  const pending = (group.pendingMembers ?? []).find(
    (member) => member.id === userId,
  );
  const localCurrentMember = [state.group, ...state.groups]
    .flatMap((candidate) => candidate.members)
    .find((member) => member.id === userId);
  const source =
    active ??
    pending ??
    localCurrentMember ?? {
      id: userId,
      name: userId === state.currentUserId ? "You" : "New member",
      initials: userId === state.currentUserId ? "Y" : "N",
      color: DEFAULT_GROUP_THEME,
      role: row.role ?? ("member" as const),
    };
  const member: Member = {
    ...source,
    role: row.role ?? source.role,
    lastSeenAt: row.last_seen_at ?? source.lastSeenAt,
    lastDataSyncedAt:
      row.last_data_synced_at &&
      (!source.lastDataSyncedAt ||
        row.last_data_synced_at >= source.lastDataSyncedAt)
        ? row.last_data_synced_at
        : source.lastDataSyncedAt,
  };
  const targetIsPending = row.status === "pending";
  const targetMember = targetIsPending ? pending : active;
  const membershipAlreadyMatches = targetIsPending
    ? Boolean(targetMember && !active)
    : Boolean(targetMember && !pending);
  if (
    membershipAlreadyMatches &&
    targetMember?.role === member.role &&
    targetMember.lastSeenAt === member.lastSeenAt &&
    targetMember.lastDataSyncedAt === member.lastDataSyncedAt
  )
    return state;
  const nextGroup: Group =
    targetIsPending
      ? {
          ...group,
          members: group.members.filter((item) => item.id !== userId),
          pendingMembers: [
            ...(group.pendingMembers ?? []).filter(
              (item) => item.id !== userId,
            ),
            member,
          ],
        }
      : {
          ...group,
          members: [
            ...group.members.filter((item) => item.id !== userId),
            member,
          ],
          pendingMembers: (group.pendingMembers ?? []).filter(
            (item) => item.id !== userId,
          ),
        };
  const groups = state.groups.map((item) =>
    item.id === groupId ? nextGroup : item,
  );
  return {
    ...state,
    groups,
    group: state.group.id === groupId ? nextGroup : state.group,
  };
}

function groupConfigurationHash(state: AppState) {
  return valueHash({
    id: state.group.id,
    name: state.group.name,
    templateName: state.group.templateName,
    streakRestDaysPerWeek: state.group.streakRestDaysPerWeek,
    themeColor: state.group.themeColor,
    requireMemberApproval: state.group.requireMemberApproval,
    gymPlans: state.group.gymPlans,
    metrics: state.group.metricConfiguration,
    roles: state.group.members.map((member) => [member.id, member.role]),
  });
}

function dailyStatusKey(
  status: AppState["dailyMetricStatuses"][number],
) {
  return [
    status.groupId,
    status.metricId,
    status.userId,
    status.localDate,
  ].join(":");
}

function mergeActivityEntries(
  cached: AppState["entries"],
  fetched: AppState["entries"],
  currentUserId: string,
) {
  const entries = new Map(
    cached.map((entry) => [
      metricEntryKey(entry.userId, entry.id),
      entry,
    ]),
  );
  fetched.forEach((entry) => {
    const key = metricEntryKey(entry.userId, entry.id);
    const existing = entries.get(key);
    const existingIsNewer =
      Boolean(existing?.sourceUpdatedAt) &&
      Boolean(entry.sourceUpdatedAt) &&
      existing!.sourceUpdatedAt! > entry.sourceUpdatedAt!;
    // Owned rows may be newer local writes waiting for upload. Fetched rows are
    // authoritative for friends unless their native-source revision is older
    // than the one already rendered from cache.
    if (
      !existing ||
      (existing.userId !== currentUserId && !existingIsNewer)
    )
      entries.set(key, entry);
  });
  return [...entries.values()].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
}

function mergeActivityStatuses(
  cached: AppState["dailyMetricStatuses"],
  fetched: AppState["dailyMetricStatuses"],
) {
  const statuses = new Map(
    cached.map((status) => [dailyStatusKey(status), status]),
  );
  fetched.forEach((status) => {
    const key = dailyStatusKey(status);
    const existing = statuses.get(key);
    if (
      !existing?.syncedAt ||
      !status.syncedAt ||
      status.syncedAt >= existing.syncedAt
    )
      statuses.set(key, status);
  });
  return [...statuses.values()];
}

function messagesEquivalent(
  left: AppState["messages"],
  right: AppState["messages"],
) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((message, index) => {
    const other = right[index];
    return (
      message.id === other?.id &&
      message.groupId === other.groupId &&
      message.senderId === other.senderId &&
      message.text === other.text &&
      message.createdAt === other.createdAt &&
      message.kind === other.kind &&
      message.conversationId === other.conversationId &&
      message.recipientId === other.recipientId &&
      message.imageStoragePath === other.imageStoragePath &&
      message.imageUri === other.imageUri
    );
  });
}

function cachedGroupActivity(
  state: AppState,
  groupId: string,
) {
  const cacheStart = new Date();
  cacheStart.setDate(
    cacheStart.getDate() - GROUP_ACTIVITY_LOCAL_CACHE_DAYS,
  );
  const cacheSinceDate = dateKey(cacheStart);
  const metricIds = new Set(
    state.group.id === groupId
      ? (state.group.metricConfiguration ?? []).map((metric) => metric.id)
      : [],
  );
  const memberIds = new Set(
    state.group.id === groupId
      ? state.group.members.map((member) => member.id)
      : [],
  );
  return {
    entries: state.entries
      .filter(
        (entry) =>
          entry.localDate >= cacheSinceDate &&
          metricIds.has(entry.metricId) &&
          memberIds.has(entry.userId),
      )
      .map((entry) =>
        entry.imageStoragePath
          ? { ...entry, imageUri: undefined }
          : entry,
      ),
    dailyMetricStatuses: state.dailyMetricStatuses.filter(
      (status) => status.groupId === groupId,
    ),
  };
}

/**
 * A workspace request can finish after a local health import, log, setting
 * change, or message. Keep those live personal writes while accepting the
 * server-owned group shell and other members' latest shared rows.
 */
function mergeWorkspaceWithoutRegression(
  remote: AppState,
  live: AppState,
  preserveLocalGroupConfiguration = false,
): AppState {
  const remoteGroupMetricIds = new Set(
    (remote.group.metricConfiguration ?? []).map((metric) => metric.id),
  );
  const remoteMetrics = new Map(
    remote.metrics.map((metric) => [metric.id, metric]),
  );
  const locallyConfiguredMetricIds = new Set(
    (live.group.metricConfiguration ?? []).map((metric) => metric.id),
  );
  const metrics = mergeById(remote.metrics, live.metrics).map((metric) => {
    const shared = remoteMetrics.get(metric.id);
    if (!shared || !remoteGroupMetricIds.has(metric.id)) return metric;
    if (
      preserveLocalGroupConfiguration &&
      locallyConfiguredMetricIds.has(metric.id)
    )
      return metric;
    return {
      ...shared,
      goal: metric.goal,
      goalRange: metric.goalRange,
      goalEnabled: metric.goalEnabled,
      goalSchedule: metric.goalSchedule,
      reminder: metric.reminder,
      reminders: metric.reminders,
      defaultVisibility: metric.defaultVisibility,
      healthMapping: metric.healthMapping ?? shared.healthMapping,
      gymMapping: metric.gymMapping ?? shared.gymMapping,
      gymMuscleGroups:
        metric.gymMuscleGroups ?? shared.gymMuscleGroups,
      stepFallback: metric.stepFallback ?? shared.stepFallback,
      manualEntry: metric.manualEntry ?? shared.manualEntry,
      sections: {
        ...shared.sections,
        today: metric.sections.today,
        insights: metric.sections.insights,
      },
      order: metric.order,
      activeFrom: metric.activeFrom,
    };
  });
  // The group shell is server-owned, but an account name/avatar selected on
  // this device is an offline-capable pending write. Preserve those fields
  // while the signed URL/profile row catches up instead of flashing the old
  // avatar back over the local selection.
  const liveCurrentMember = [live.group, ...live.groups]
    .flatMap((group) => group.members)
    .find((member) => member.id === live.currentUserId);
  const preserveLocalAvatar = isUploadableLocalUri(
    liveCurrentMember?.avatarUri ?? null,
  );
  const localGroupConfiguration =
    preserveLocalGroupConfiguration && live.group.id === remote.group.id
      ? live.group
      : null;
  const remoteGroupBase: Group = localGroupConfiguration
    ? {
        ...remote.group,
        name: localGroupConfiguration.name,
        templateName: localGroupConfiguration.templateName,
        streakRestDaysPerWeek:
          localGroupConfiguration.streakRestDaysPerWeek,
        themeColor: localGroupConfiguration.themeColor,
        requireMemberApproval:
          localGroupConfiguration.requireMemberApproval,
        metricConfiguration:
          localGroupConfiguration.metricConfiguration,
        gymPlans: localGroupConfiguration.gymPlans,
        members: remote.group.members.map((member) => ({
          ...member,
          role:
            localGroupConfiguration.members.find(
              (localMember) => localMember.id === member.id,
            )?.role ?? member.role,
        })),
      }
    : remote.group;
  const remoteGroup: Group = liveCurrentMember
    ? {
        ...remoteGroupBase,
        members: remoteGroupBase.members.map((member) =>
          member.id === live.currentUserId
            ? {
                ...member,
                name: liveCurrentMember.name,
                initials: liveCurrentMember.initials,
                color: liveCurrentMember.color,
                avatarUri: preserveLocalAvatar
                  ? liveCurrentMember.avatarUri
                  : member.avatarUri,
                avatarStoragePath: preserveLocalAvatar
                  ? liveCurrentMember.avatarStoragePath
                  : member.avatarStoragePath,
              }
            : member,
        ),
      }
    : remoteGroupBase;
  const groupMemberIds = new Set(
    remoteGroup.members.map((member) => member.id),
  );
  const cachedEntries = live.entries.filter(
    (entry) =>
      entry.userId === live.currentUserId ||
      (remoteGroupMetricIds.has(entry.metricId) &&
        groupMemberIds.has(entry.userId)),
  );
  const pendingDeletedEntryIds = new Set(
    [
      ...(live.settings.pendingDeletedEntryIds ?? []),
      ...(live.settings.deletedEntryIds ?? []),
    ],
  );
  const entries = mergeActivityEntries(
    cachedEntries,
    remote.entries,
    live.currentUserId,
  ).filter(
    (entry) =>
      entry.userId !== live.currentUserId ||
      !pendingDeletedEntryIds.has(entry.id),
  );
  const photos = new Map(remote.photos.map((photo) => [photo.id, photo]));
  live.photos
    .filter((photo) => photo.userId === live.currentUserId)
    .forEach((photo) => photos.set(photo.id, photo));
  const messages = new Map(
    remote.messages.map((message) => [message.id, message]),
  );
  live.messages
    .filter((message) => message.senderId === live.currentUserId)
    .forEach((message) => messages.set(message.id, message));
  const pendingDeletedPhotoIds = new Set(
    [
      ...(live.settings.pendingDeletedPhotoIds ?? []),
      ...(live.settings.deletedPhotoIds ?? []),
    ],
  );
  const statuses = mergeActivityStatuses(
    live.dailyMetricStatuses,
    remote.dailyMetricStatuses,
  );
  return {
    ...remote,
    ...live,
    group: remoteGroup,
    groups: mergeById(live.groups, remote.groups).map((group) =>
      group.id === remoteGroup.id ? remoteGroup : group,
    ),
    metrics,
    entries,
    photos: [...photos.values()].filter(
      (photo) =>
        photo.userId !== live.currentUserId ||
        !pendingDeletedPhotoIds.has(photo.id),
    ),
    messages: [...messages.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    ),
    dailyMetricStatuses: statuses,
    trackedGoalPeriods: {
      ...remote.trackedGoalPeriods,
      ...live.trackedGoalPeriods,
    },
    selectedGroupMetricId: remote.group.metricConfiguration?.some(
      (metric) => metric.id === live.selectedGroupMetricId,
    )
      ? live.selectedGroupMetricId
      : remote.selectedGroupMetricId,
    lastSavedAt: null,
  };
}

async function fetchSnapshot(userId: string): Promise<SnapshotRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_snapshots")
    .select("payload, revision, updated_at, device_id, schema_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (!/revision|device_id|schema_version|schema cache|column/i.test(errorText(error)))
      throw error;
    const legacy = await supabase
      .from("user_snapshots")
      .select("payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data
      ? {
          payload: legacy.data.payload as AppState,
          revision: 0,
          updated_at: legacy.data.updated_at,
          device_id: null,
          schema_version: Number(
            (legacy.data.payload as AppState | undefined)?.version ?? 1,
          ),
        }
      : null;
  }
  return data as SnapshotRow | null;
}

function upgradeBloodPressureMetrics(metrics: AppState["metrics"]) {
  return metrics.map((metric) => {
    const isSystolic =
      metric.id === "blood_pressure_systolic" ||
      (metric.healthMapping?.dataType === "blood_pressure" &&
        metric.healthMapping.field === "systolic");
    const isDiastolic =
      metric.id === "blood_pressure_diastolic" ||
      (metric.healthMapping?.dataType === "blood_pressure" &&
        metric.healthMapping.field === "diastolic");
    if (!isSystolic && !isDiastolic) return metric;
    return {
      ...metric,
      goalEnabled: true,
      goal: { kind: "exact" as const, target: isSystolic ? 120 : 80 },
      goalRange: isSystolic ? { min: 90, max: 120 } : { min: 60, max: 80 },
      ...(isDiastolic
        ? { sections: { today: false, group: false, insights: false } }
        : {}),
    };
  });
}

async function writeSnapshot(
  userId: string,
  payload: AppState,
  expectedRevision: number,
  deviceId: string,
) {
  if (!supabase) throw new Error("Cloud is not configured.");
  const current = await supabase.rpc("sync_user_snapshot", {
    expected_revision: expectedRevision,
    new_payload: payload,
    client_device_id: deviceId,
    client_schema_version: payload.version,
  });
  if (!current.error) {
    const result = Array.isArray(current.data) ? current.data[0] : current.data;
    return {
      revision: Number(result?.revision ?? expectedRevision + 1),
      updatedAt: result?.updated_at ?? new Date().toISOString(),
    };
  }
  if (
    !/sync_user_snapshot|schema cache|function.*does not exist|revision|schema_version|device_id/i.test(
      errorText(current.error),
    )
  )
    throw current.error;
  const updatedAt = new Date().toISOString();
  const legacy = await supabase.from("user_snapshots").upsert({
    user_id: userId,
    payload,
    updated_at: updatedAt,
  });
  if (legacy.error) throw legacy.error;
  return { revision: 0, updatedAt };
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "details", "hint", "code"]
      .map((key) =>
        typeof record[key] === "string" ? String(record[key]) : "",
      )
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(" · ");
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }
  return typeof error === "string" ? error : "";
}

function friendlySyncError(error: unknown) {
  const message = errorText(error);
  if (/network|fetch|offline|timeout/i.test(message))
    return "Offline changes are safe on this device and will retry automatically.";
  if (/column.*revision|sync_user_snapshot|schema cache/i.test(message))
    return "Apply the latest Supabase migrations before enabling cloud sync.";
  return message || "Cloud sync failed. Your local data is still safe.";
}

export function CloudSyncProvider({ children }: PropsWithChildren) {
  const { state, hydrated, replaceState } = useApp();
  const auth = useAuth();
  const network = useNetInfo();
  const networkAvailable =
    network.isConnected !== false && network.isInternetReachable !== false;
  const [status, setStatus] = useState<CloudSyncStatus>(
    auth.status === "signedIn" ? "initializing" : "disabled",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState(0);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [pendingGroup, setPendingGroup] =
    useState<PendingGroupRequest | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const stateRef = useRef(state);
  const lastSyncedAtRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const hashRef = useRef<string | null>(null);
  const mergeBaseRef = useRef<CloudMergeBase | null>(null);
  const workspaceHashRef = useRef<string | null>(null);
  const workspaceAckHashesRef = useRef(new Map<string, string>());
  const groupConfigurationAckHashesRef = useRef(
    new Map<string, string>(),
  );
  const workspaceUploadRequiredGroupsRef = useRef(new Set<string>());
  const groupConfigurationHashRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const deviceHeartbeatAtRef = useRef(0);
  const presenceHeartbeatAtRef = useRef(0);
  const lastResumeRecoveryAtRef = useRef(0);
  const initializedUserRef = useRef<string | null>(null);
  const remoteInitializationPendingRef = useRef(false);
  const identityResetUserRef = useRef<string | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const pullLatestPromiseRef = useRef<Promise<void> | null>(null);
  const pullLatestQueuedRevisionRef = useRef(0);
  const pullLatestRef = useRef<
    ((expectedRevision?: number) => Promise<void>) | null
  >(null);
  const pullRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullRetryAttemptRef = useRef(0);
  const snapshotWriteTargetRevisionRef = useRef(0);
  const syncIsForcedRef = useRef(false);
  const performSyncRef = useRef<
    ((forceWorkspace?: boolean, forceAttempt?: boolean) => Promise<void>) | null
  >(null);
  const leaderboardPublishPromiseRef = useRef<Promise<void> | null>(null);
  const leaderboardPublishedAtByGroupRef = useRef(new Map<string, number>());
  const cloudRetryAttemptRef = useRef(0);
  const nextRetryAtRef = useRef(0);
  const networkAvailableRef = useRef(networkAvailable);
  networkAvailableRef.current = networkAvailable;
  const previousNetworkAvailableRef = useRef(networkAvailable);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleSyncRef = useRef<
    ReturnType<typeof InteractionManager.runAfterInteractions> | null
  >(null);
  const suppressGroupRefreshUntilRef = useRef(0);
  const groupLoadSequenceRef = useRef(0);
  const activityLoadSequenceRef = useRef(0);
  const activityRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const activityVersionByGroupRef = useRef(new Map<string, number>());
  const activityCoverageSinceByGroupRef = useRef(new Map<string, string>());
  const activityVersionCheckByGroupRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const historicalHydrationStartedRef = useRef(new Set<string>());
  // undefined = no queued request, null = full activity refresh, string =
  // earliest local date requested by coalesced realtime events.
  const queuedActivitySinceRef = useRef<string | null | undefined>(undefined);
  const chatOutboxSeenRef = useRef(new Set<string>());
  const chatOutboxPendingRef = useRef(new Set<string>());
  const chatOutboxAttemptsRef = useRef(new Map<string, number>());
  const chatOutboxPromiseRef = useRef<Promise<void> | null>(null);
  const chatOutboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeBaseWriteRef = useRef<Promise<void>>(Promise.resolve());
  stateRef.current = state;

  const rememberCloudMergeBase = useCallback(
    (userId: string, acknowledgedState: AppState) => {
      const base = createCloudMergeBase(acknowledgedState);
      mergeBaseRef.current = base;
      mergeBaseWriteRef.current = mergeBaseWriteRef.current
        .catch(() => undefined)
        .then(() => writeCloudMergeBase(userId, base))
        .catch(() => undefined);
    },
    [],
  );

  const hasUnsyncedLocalChanges = useCallback(() => {
    const live = stateRef.current;
    if (stableHash(live) !== hashRef.current) return true;
    if (!isCloudGroupId(live.group.id)) return false;
    return (
      live.settings.pendingGroupConfigurationIds?.includes(live.group.id) ===
        true ||
      workspaceUploadRequiredGroupsRef.current.has(live.group.id) ||
      workspaceHash(live) !== workspaceHashRef.current
    );
  }, []);

  const mergeRemoteWorkspace = useCallback(
    (remote: AppState, live: AppState) => {
      const groupId = remote.group.id;
      const explicitlyPending =
        live.settings.pendingGroupConfigurationIds?.includes(groupId) === true;
      const acknowledged =
        groupConfigurationAckHashesRef.current.get(groupId) ?? null;
      const preserveLocalGroupConfiguration =
        live.group.id === groupId &&
        (explicitlyPending ||
          (acknowledged !== null &&
            groupConfigurationHash(live) !== acknowledged));
      const next = mergeWorkspaceWithoutRegression(
        remote,
        live,
        preserveLocalGroupConfiguration,
      );
      if (!preserveLocalGroupConfiguration) {
        const nextConfigurationHash = groupConfigurationHash(next);
        // This hash comes from the server-owned group workspace. The ref and
        // persisted map therefore mean "server acknowledged", never merely
        // "last value rendered locally".
        groupConfigurationHashRef.current = nextConfigurationHash;
        groupConfigurationAckHashesRef.current.set(
          groupId,
          nextConfigurationHash,
        );
        if (auth.user)
          void writeGroupConfigurationAcks(
            auth.user.id,
            groupConfigurationAckHashesRef.current,
          ).catch(() => undefined);
      }
      return next;
    },
    [auth.user],
  );

  const flushChatOutbox = useCallback(() => {
    if (
      chatOutboxPromiseRef.current ||
      auth.status !== "signedIn" ||
      !networkAvailableRef.current ||
      !isCloudGroupId(stateRef.current.group.id)
    ) return;
    const pending = [...chatOutboxPendingRef.current].slice(0, 8);
    if (!pending.length) return;
    const operation = (async () => {
      let shouldRetry = false;
      for (const messageId of pending) {
        try {
          await pushCloudMessagesNow(stateRef.current, messageId);
          chatOutboxPendingRef.current.delete(messageId);
          chatOutboxAttemptsRef.current.delete(messageId);
        } catch {
          const attempts = (chatOutboxAttemptsRef.current.get(messageId) ?? 0) + 1;
          chatOutboxAttemptsRef.current.set(messageId, attempts);
          if (attempts < 5) shouldRetry = true;
          else chatOutboxPendingRef.current.delete(messageId);
        }
      }
      if (shouldRetry && !chatOutboxTimerRef.current) {
        const attempts = Math.max(
          1,
          ...pending.map((id) => chatOutboxAttemptsRef.current.get(id) ?? 1),
        );
        chatOutboxTimerRef.current = setTimeout(() => {
          chatOutboxTimerRef.current = null;
          flushChatOutbox();
        }, Math.min(20_000, 1_200 * 2 ** (attempts - 1)));
      }
    })().finally(() => {
      chatOutboxPromiseRef.current = null;
      // Messages can arrive while this batch is in flight, and a reconnect may
      // queue more than the bounded batch. Drain the remainder without waiting
      // for a page change or the heavier workspace sync.
      if (
        chatOutboxPendingRef.current.size &&
        !chatOutboxTimerRef.current
      ) {
        chatOutboxTimerRef.current = setTimeout(() => {
          chatOutboxTimerRef.current = null;
          flushChatOutbox();
        }, 120);
      }
    });
    chatOutboxPromiseRef.current = operation;
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== "signedIn" || !isCloudGroupId(state.group.id)) return;
    const now = Date.now();
    for (const message of state.messages) {
      const createdAt = new Date(message.createdAt).getTime();
      if (
        message.senderId !== state.currentUserId ||
        (message.groupId
          ? message.groupId !== state.group.id
          : message.conversationId !== `group:${state.group.id}`) ||
        !Number.isFinite(createdAt) ||
        now - createdAt > CHAT_OUTBOX_FRESHNESS_MS ||
        chatOutboxSeenRef.current.has(message.id)
      ) continue;
      chatOutboxSeenRef.current.add(message.id);
      chatOutboxPendingRef.current.add(message.id);
    }
    if (networkAvailable) flushChatOutbox();
  }, [
    auth.status,
    flushChatOutbox,
    networkAvailable,
    state.currentUserId,
    state.group.id,
    state.messages,
  ]);

  useEffect(
    () => () => {
      if (chatOutboxTimerRef.current) clearTimeout(chatOutboxTimerRef.current);
    },
    [],
  );

  const recordServerSyncedAt = useCallback(
    (value: string | null | undefined) => {
      if (!value || !Number.isFinite(new Date(value).getTime())) return;
      const current = lastSyncedAtRef.current;
      const next =
        !current || new Date(value).getTime() >= new Date(current).getTime()
          ? value
          : current;
      lastSyncedAtRef.current = next;
      setLastSyncedAt(next);
      if (auth.user)
        void writeCloudSyncCheckpoint(auth.user.id, next).catch(
          () => undefined,
        );
    },
    [auth.user],
  );

  const recordActivityMetadata = useCallback(
    (groupId: string, metadata: CloudActivityMetadata) => {
      if (metadata.version !== undefined)
        activityVersionByGroupRef.current.set(groupId, metadata.version);
      if (metadata.sinceDate) {
        const current =
          activityCoverageSinceByGroupRef.current.get(groupId);
        if (!current || metadata.sinceDate < current)
          activityCoverageSinceByGroupRef.current.set(
            groupId,
            metadata.sinceDate,
          );
      }
    },
    [],
  );

  // Account identity is a hard cache boundary. Clear another account's local
  // theme/group state in a layout effect so it cannot flash on screen or be
  // persisted while the signed-in account snapshot is still loading.
  useLayoutEffect(() => {
    if (!hydrated || auth.status !== "signedIn" || !auth.user) return;
    if (
      stateRef.current.currentUserId === auth.user.id &&
      !isDemoBoundState(stateRef.current)
    )
      return;
    const clean = createCleanAccountState(auth.user);
    stateRef.current = clean;
    revisionRef.current = 0;
    hashRef.current = null;
    workspaceHashRef.current = null;
    groupConfigurationHashRef.current = null;
    initializedUserRef.current = null;
    identityResetUserRef.current = auth.user.id;
    activityVersionByGroupRef.current.clear();
    activityCoverageSinceByGroupRef.current.clear();
    activityVersionCheckByGroupRef.current.clear();
    historicalHydrationStartedRef.current.clear();
    lastSyncedAtRef.current = null;
    setLastSyncedAt(null);
    replaceState(clean);
  }, [auth.status, auth.user, hydrated, replaceState]);

  const touchPresence = useCallback(
    async (force = false) => {
      const groupId = stateRef.current.group.id;
      if (
        auth.status !== "signedIn" ||
        !isCloudGroupId(groupId) ||
        (!force &&
          Date.now() - presenceHeartbeatAtRef.current < 5 * 60 * 1000)
      )
        return;
      presenceHeartbeatAtRef.current = Date.now();
      const lastSeenAt = await touchCloudGroupPresence(groupId);
      const live = stateRef.current;
      const next = applyMembershipRealtimeRow(live, {
        group_id: groupId,
        user_id: live.currentUserId,
        status: "active",
        last_seen_at: lastSeenAt,
      });
      if (next && next !== live) {
        stateRef.current = next;
        replaceState(next);
      }
    },
    [auth.status, replaceState],
  );

  useEffect(() => {
    if (auth.status !== "signedIn") setPendingGroup(null);
  }, [auth.status]);

  const loadDevices = useCallback(async () => {
    if (!supabase || !auth.user) return;
    const deviceId = deviceIdRef.current ?? (await getDeviceId());
    deviceIdRef.current = deviceId;
    const { data, error } = await supabase
      .from("account_devices")
      .select("device_id, platform, label, last_seen_at")
      .order("last_seen_at", { ascending: false });
    if (error) throw error;
    setDevices(
      (data ?? []).map((item) => ({
        deviceId: item.device_id,
        platform: item.platform,
        label: item.label ?? undefined,
        lastSeenAt: item.last_seen_at,
        isThisDevice: item.device_id === deviceId,
      })),
    );
  }, [auth.user]);

  const pullLatestOnce = useCallback(async () => {
    if (!auth.user || !supabase) return;
    const operationUser = auth.user;
    const operationUserId = operationUser.id;
    const operationIsCurrent = () =>
      initializedUserRef.current === operationUserId &&
      stateRef.current.currentUserId === operationUserId;
    // Account reads and writes share one revision stream. If a save is already
    // in flight, let it finish before reading so a stale candidate can never
    // write against a revision advanced by this pull.
    const activeSync = syncPromiseRef.current;
    if (activeSync) await activeSync;
    if (!operationIsCurrent()) return;
    if (!networkAvailableRef.current) {
      setStatus("offline");
      setPendingChanges(hasUnsyncedLocalChanges());
      setErrorMessage(
        "Offline changes are safe on this device and will retry automatically.",
      );
      throw new Error("Network offline");
    }
    // Realtime account updates hydrate behind the currently rendered cache.
    // A global loading state here made every tab appear to reload.
    setErrorMessage(null);
    const pullStartAccountHash = stableHash(stateRef.current);
    const accountWasDirty = pullStartAccountHash !== hashRef.current;
    try {
      const remote = await fetchSnapshot(operationUserId);
      if (!operationIsCurrent()) return;
      if (!remote) return;
      revisionRef.current = remote.revision;
      const bound = bindStateToAccount(remote.payload, operationUser);
      // Reuse matching signed URLs from the rendered cache. Signing media is a
      // best-effort presentation refresh and must never delay a timer, to-do,
      // tracker-order, or settings update.
      const resolvedRemote = mergePrivateMediaUrls(bound, stateRef.current);
      const remoteHash = stableHash(bound);
      const accountChangedDuringPull =
        stableHash(stateRef.current) !== pullStartAccountHash;
      const preserveLocalAccount =
        accountWasDirty || accountChangedDuringPull;
      // A clean client must accept the newer account-owned fields. Always
      // merging local-over-remote made website/extension timer, to-do and order
      // changes appear briefly and then get overwritten by the phone cache.
      // Dirty/offline clients and edits made while this request was in flight
      // still keep their outbox and merge by stable ids.
      const resolved = preserveLocalAccount
        ? mergeStates(resolvedRemote, stateRef.current, mergeBaseRef.current)
        : acceptCleanRemoteState(resolvedRemote, stateRef.current);
      const resolvedHash = stableHash(resolved);
      hashRef.current = remoteHash;
      workspaceHashRef.current = isCloudGroupId(resolved.group.id)
        ? (workspaceAckHashesRef.current.get(resolved.group.id) ?? null)
        : null;
      groupConfigurationHashRef.current = isCloudGroupId(resolved.group.id)
        ? (groupConfigurationAckHashesRef.current.get(resolved.group.id) ?? null)
        : null;
      replaceState(resolved);
      stateRef.current = resolved;
      rememberCloudMergeBase(operationUserId, bound);
      recordServerSyncedAt(remote.updated_at);
      setPendingChanges(hasUnsyncedLocalChanges());
      // Also seeds the acknowledgement for upgraded clients whose cached and
      // remote durable state already match exactly.
      if (!preserveLocalAccount || resolvedHash === remoteHash)
        await writeCloudSnapshotAck(operationUserId, remoteHash).catch(
          () => undefined,
        );
      if (!operationIsCurrent()) return;
      setStatus("synced");
      cloudRetryAttemptRef.current = 0;
      nextRetryAtRef.current = 0;
      setNextRetryAt(0);
      InteractionManager.runAfterInteractions(() => {
        resolvePrivateMedia(bound)
          .then((mediaState) => {
            if (!operationIsCurrent()) return;
            const withMedia = mergePrivateMediaUrls(
              stateRef.current,
              mediaState,
            );
            if (withMedia === stateRef.current) return;
            stateRef.current = withMedia;
            replaceState(withMedia);
          })
          // Exhausted Storage egress or a transient signing failure must not
          // turn an otherwise successful account pull into a sync error.
          .catch(() => undefined);
      });
      if (isCloudGroupId(resolved.group.id)) {
        // "Get latest" returns as soon as the private account snapshot is
        // merged. The heavier group workspace catches up after interactions,
        // so the button and navigation never wait on 120 days of history.
        const groupId = resolved.group.id;
        const groupSequence = ++groupLoadSequenceRef.current;
        activityLoadSequenceRef.current += 1;
        InteractionManager.runAfterInteractions(() => {
          loadCloudWorkspace(
            stateRef.current,
            groupId,
            (metadata) => recordActivityMetadata(groupId, metadata),
          )
            .then((loaded) => {
              if (
                groupSequence !== groupLoadSequenceRef.current ||
                stateRef.current.group.id !== groupId ||
                !operationIsCurrent()
              )
                return;
              const next = mergeRemoteWorkspace(
                loaded,
                stateRef.current,
              );
              stateRef.current = next;
              workspaceHashRef.current =
                workspaceAckHashesRef.current.get(groupId) ?? null;
              replaceState(next);
            })
            .catch((groupError) =>
              setErrorMessage(
                `Account synced; group refresh will retry: ${errorText(groupError)}`,
              ),
            );
        });
      }
    } catch (error) {
      if (!operationIsCurrent()) return;
      setStatus(
        /network|fetch|offline|timeout/i.test(errorText(error))
          ? "offline"
          : "error",
      );
      setErrorMessage(friendlySyncError(error));
      throw error;
    }
  }, [
    auth.user,
    hasUnsyncedLocalChanges,
    mergeRemoteWorkspace,
    recordActivityMetadata,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
  ]);

  const pullLatest = useCallback((expectedRevision?: number): Promise<void> => {
    if (pullLatestPromiseRef.current) {
      // Manual callers share the in-flight request. Realtime callers retain the
      // highest revision they need, so a trailing request is only made when the
      // current response did not already include that update.
      if (expectedRevision !== undefined)
        pullLatestQueuedRevisionRef.current = Math.max(
          pullLatestQueuedRevisionRef.current,
          expectedRevision,
        );
      return pullLatestPromiseRef.current;
    }
    let operation: Promise<void>;
    operation = (async () => {
      let requiredRevision = expectedRevision ?? 0;
      const scheduleRequiredPull = (revision: number) => {
        if (
          revision <= revisionRef.current ||
          initializedUserRef.current !== auth.user?.id
        )
          return;
        pullLatestQueuedRevisionRef.current = Math.max(
          pullLatestQueuedRevisionRef.current,
          revision,
        );
        if (pullRetryTimerRef.current) return;
        const attempt = Math.min(6, pullRetryAttemptRef.current + 1);
        pullRetryAttemptRef.current = attempt;
        pullRetryTimerRef.current = setTimeout(() => {
          pullRetryTimerRef.current = null;
          const queuedRevision = pullLatestQueuedRevisionRef.current;
          pullLatestQueuedRevisionRef.current = 0;
          pullLatestRef.current?.(queuedRevision).catch(() => undefined);
        }, Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
      };
      // A committed Broadcast revision should be visible on the first fetch.
      // One bounded trailing fetch covers a replica/race delay and any higher
      // revision that arrived while the first request was resolving.
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          pullLatestQueuedRevisionRef.current = 0;
          await pullLatestOnce();
          requiredRevision = Math.max(
            requiredRevision,
            pullLatestQueuedRevisionRef.current,
          );
          if (requiredRevision <= revisionRef.current) break;
        }
      } catch (error) {
        requiredRevision = Math.max(
          requiredRevision,
          pullLatestQueuedRevisionRef.current,
        );
        scheduleRequiredPull(requiredRevision);
        throw error;
      }
      if (requiredRevision > revisionRef.current)
        scheduleRequiredPull(requiredRevision);
      else {
        if (pullRetryTimerRef.current) clearTimeout(pullRetryTimerRef.current);
        pullRetryTimerRef.current = null;
        pullRetryAttemptRef.current = 0;
        pullLatestQueuedRevisionRef.current = 0;
      }
    })().finally(() => {
      if (pullLatestPromiseRef.current === operation)
        pullLatestPromiseRef.current = null;
    });
    pullLatestPromiseRef.current = operation;
    return operation;
  }, [auth.user?.id, pullLatestOnce]);
  pullLatestRef.current = pullLatest;

  useEffect(
    () => () => {
      if (pullRetryTimerRef.current) clearTimeout(pullRetryTimerRef.current);
      pullRetryTimerRef.current = null;
      pullRetryAttemptRef.current = 0;
      pullLatestQueuedRevisionRef.current = 0;
    },
    [auth.user?.id],
  );

  const performSync = useCallback(async (
    forceWorkspace = false,
    forceAttempt = false,
  ) => {
    if (!auth.user || !supabase || initializedUserRef.current !== auth.user.id)
      return;
    if (remoteInitializationPendingRef.current) {
      // The local cache remains fully editable while startup restores the
      // account, but it must not race that fetch with a revision-0 write. The
      // initialization path drains the durable outbox as soon as it resolves.
      setPendingChanges(hasUnsyncedLocalChanges());
      return;
    }
    const operationUser = auth.user;
    const operationUserId = operationUser.id;
    const operationIsCurrent = () =>
      initializedUserRef.current === operationUserId &&
      stateRef.current.currentUserId === operationUserId;
    if (!forceAttempt && isCloudSyncPaused()) {
      // Edit/reorder mode pauses network writes, not the account itself. Avoid
      // showing a false Pending chip when there is no durable local change.
      setPendingChanges(hasUnsyncedLocalChanges());
      return;
    }
    if (!networkAvailableRef.current) {
      setStatus("offline");
      setPendingChanges(hasUnsyncedLocalChanges());
      setErrorMessage(
        "Offline changes are safe on this device and will retry automatically.",
      );
      return;
    }
    const deferGroupRetry =
      !forceAttempt && nextRetryAtRef.current > Date.now();
    if (syncPromiseRef.current) {
      const activeSync = syncPromiseRef.current;
      if (!forceAttempt || syncIsForcedRef.current) return activeSync;
      // A pull-to-refresh that lands during a quiet autosave still needs its
      // own freshness assertion after that serialized write completes.
      await activeSync;
      return performSyncRef.current?.(forceWorkspace, true);
    }
    syncIsForcedRef.current = forceAttempt;
    const operation = (async () => {
      // Serialize against a pull that started first. A pull that starts after
      // this operation observes syncPromiseRef and waits for this save instead.
      const activePull = pullLatestPromiseRef.current;
      if (activePull) await activePull;
      if (!operationIsCurrent()) return;
      // Routine debounced saves stay visually quiet. Explicit refresh controls
      // already expose their own progress and should not flash on every tap.
      if (forceAttempt) setStatus("syncing");
      if (!deferGroupRetry) setErrorMessage(null);
      try {
        const deviceId = deviceIdRef.current ?? (await getDeviceId());
        if (!operationIsCurrent()) return;
        deviceIdRef.current = deviceId;
        let candidate =
          stateRef.current.currentUserId === operationUserId
            ? stateRef.current
            : bindStateToAccount(stateRef.current, operationUser);
        const initialCandidateHash = stableHash(candidate);
        if (initialCandidateHash !== hashRef.current) {
          const uploadedCandidate = await uploadOwnedMedia(candidate);
          if (!operationIsCurrent()) return;
          candidate = mergeUploadedMediaMetadata(
            stateRef.current,
            uploadedCandidate,
          );
        }
        let candidateHash = stableHash(candidate);
        if (candidate !== stateRef.current) {
          replaceState(candidate);
          stateRef.current = candidate;
        }
        let syncedAt: string | null = null;
        const persistPrivateSnapshot = async () => {
          if (candidateHash === hashRef.current) return;
          if (!operationIsCurrent()) return;
          const payload = snapshotPayload(candidate);
          const expectedRevision = revisionRef.current;
          const ownTargetRevision = expectedRevision + 1;
          snapshotWriteTargetRevisionRef.current = ownTargetRevision;
          try {
            const result = await writeSnapshot(
              operationUserId,
              payload,
              expectedRevision,
              deviceId,
            );
            if (!operationIsCurrent()) return;
            revisionRef.current = result.revision;
            syncedAt = result.updatedAt;
            hashRef.current = candidateHash;
            rememberCloudMergeBase(operationUserId, candidate);
          } finally {
            if (
              snapshotWriteTargetRevisionRef.current === ownTargetRevision
            )
              snapshotWriteTargetRevisionRef.current = 0;
          }
        };

        // Establish the private snapshot revision before mutating relational
        // group rows. A stale device now conflicts and merges first, so it
        // cannot temporarily re-publish older visibility or deleted content.
        await persistPrivateSnapshot();
        if (!operationIsCurrent()) return;
        let nextWorkspaceHash = workspaceHash(candidate);
        const nextGroupConfigurationHash = groupConfigurationHash(candidate);
        const pushedGroupId = candidate.group.id;
        const pushedWorkspaceHash = nextWorkspaceHash;
        const pendingGroupConfiguration =
          candidate.settings.pendingGroupConfigurationIds?.includes(
            candidate.group.id,
          ) === true;
        const acknowledgedGroupConfigurationHash =
          groupConfigurationAckHashesRef.current.get(candidate.group.id) ??
          null;
        const shouldPushGroupConfiguration =
          pendingGroupConfiguration ||
          (acknowledgedGroupConfigurationHash !== null &&
            nextGroupConfigurationHash !==
              acknowledgedGroupConfigurationHash);
        const groupWorkspaceNeedsUpload =
          isCloudGroupId(candidate.group.id) &&
          (forceWorkspace ||
            pendingGroupConfiguration ||
            workspaceUploadRequiredGroupsRef.current.has(candidate.group.id) ||
            nextWorkspaceHash !== workspaceHashRef.current);
        let workspaceSynced = !groupWorkspaceNeedsUpload;
        let workspaceWasUploaded = false;
        let workspaceWarning: string | null = null;
        if (groupWorkspaceNeedsUpload && !deferGroupRetry) {
          workspaceSynced = true;
          suppressGroupRefreshUntilRef.current = Date.now() + 3000;
          try {
            const workspaceResult = await pushCloudWorkspace(
              candidate,
              shouldPushGroupConfiguration,
              ({ syncedAt }) => {
                if (!operationIsCurrent()) return;
                // A large historical status backfill publishes the newest
                // month first. Reflect that durable server checkpoint now;
                // older compact summaries may continue without making the
                // Cloud page look frozen or delaying current leaderboard data.
                recordServerSyncedAt(syncedAt);
                leaderboardPublishedAtByGroupRef.current.set(
                  pushedGroupId,
                  Date.now(),
                );
                const live = stateRef.current;
                const published = applyMembershipRealtimeRow(
                  live,
                  {
                    group_id: pushedGroupId,
                    user_id: stateRef.current.currentUserId,
                    status: "active",
                    last_data_synced_at: syncedAt,
                  },
                );
                if (published && published !== live) {
                  stateRef.current = published;
                  replaceState(published);
                }
              },
              revisionRef.current,
            );
            if (!operationIsCurrent()) return;
            if (!workspaceResult.workspacePushed)
              throw new Error("Group workspace is not active yet.");
            if (
              shouldPushGroupConfiguration &&
              !workspaceResult.groupConfigurationPushed
            )
              throw new Error(
                "Group settings are waiting for administrator access.",
              );
            workspaceWasUploaded = true;
            if (workspaceResult.activityVersion !== undefined)
              activityVersionByGroupRef.current.set(
                candidate.group.id,
                workspaceResult.activityVersion,
              );
            // A cloud request can finish after another local edit. Apply only
            // the acknowledgements to the latest live state; never replace it
            // with the older state captured when this request began.
            const liveAfterWorkspacePush = stateRef.current;
            let acknowledgedState = liveAfterWorkspacePush;
            const publishedGroupConfigurationRevision = Number(
              workspaceResult.groupConfigurationRevision,
            );
            if (
              workspaceResult.groupConfigurationPushed &&
              Number.isFinite(publishedGroupConfigurationRevision)
            ) {
              const groups = acknowledgedState.groups.map((group) =>
                group.id === pushedGroupId
                  ? {
                      ...group,
                      configurationRevision:
                        publishedGroupConfigurationRevision,
                    }
                  : group,
              );
              acknowledgedState = {
                ...acknowledgedState,
                groups,
                group:
                  acknowledgedState.group.id === pushedGroupId
                    ? {
                        ...acknowledgedState.group,
                        configurationRevision:
                          publishedGroupConfigurationRevision,
                      }
                    : acknowledgedState.group,
              };
            }
            if (workspaceResult.deletedEntryIds.length) {
              const acknowledged = new Set(
                workspaceResult.deletedEntryIds,
              );
              acknowledgedState = {
                ...acknowledgedState,
                settings: {
                  ...acknowledgedState.settings,
                  pendingDeletedEntryIds: (
                    acknowledgedState.settings.pendingDeletedEntryIds ?? []
                  ).filter((id) => !acknowledged.has(id)),
                  deletedEntryIds: [
                    ...new Set([
                      ...(acknowledgedState.settings.deletedEntryIds ?? []),
                      ...acknowledged,
                    ]),
                  ],
                },
              };
            }
            if (workspaceResult.deletedPhotoIds.length) {
              const acknowledged = new Set(
                workspaceResult.deletedPhotoIds,
              );
              acknowledgedState = {
                ...acknowledgedState,
                settings: {
                  ...acknowledgedState.settings,
                  pendingDeletedPhotoIds: (
                    acknowledgedState.settings.pendingDeletedPhotoIds ?? []
                  ).filter((id) => !acknowledged.has(id)),
                  deletedPhotoIds: [
                    ...new Set([
                      ...(acknowledgedState.settings.deletedPhotoIds ?? []),
                      ...acknowledged,
                    ]),
                  ],
                },
              };
            }
            const pushedConfigurationIsStillCurrent =
              acknowledgedState.group.id === pushedGroupId &&
              groupConfigurationHash(acknowledgedState) ===
                nextGroupConfigurationHash;
            if (
              workspaceResult.groupConfigurationPushed &&
              pushedConfigurationIsStillCurrent
            ) {
              acknowledgedState = {
                ...acknowledgedState,
                settings: {
                  ...acknowledgedState.settings,
                  pendingGroupConfigurationIds: (
                    acknowledgedState.settings.pendingGroupConfigurationIds ??
                    []
                  ).filter((groupId) => groupId !== pushedGroupId),
                },
              };
            }
            candidate = acknowledgedState;
            candidateHash = stableHash(candidate);
            nextWorkspaceHash = workspaceHash(candidate);
            if (acknowledgedState !== liveAfterWorkspacePush) {
              stateRef.current = acknowledgedState;
              replaceState(acknowledgedState);
            }
            workspaceUploadRequiredGroupsRef.current.delete(
              pushedGroupId,
            );
            workspaceAckHashesRef.current.set(
              pushedGroupId,
              pushedWorkspaceHash,
            );
            await writeWorkspaceAcks(
              operationUserId,
              workspaceAckHashesRef.current,
            ).catch(() => undefined);
            if (!operationIsCurrent()) return;
            if (workspaceResult.groupConfigurationPushed) {
              groupConfigurationHashRef.current =
                nextGroupConfigurationHash;
              groupConfigurationAckHashesRef.current.set(
                pushedGroupId,
                nextGroupConfigurationHash,
              );
              await writeGroupConfigurationAcks(
                operationUserId,
                groupConfigurationAckHashesRef.current,
              ).catch(() => undefined);
              if (!operationIsCurrent()) return;
            }
          } catch (error) {
            const workspaceErrorText = errorText(error);
            if (/stale_group_configuration/i.test(workspaceErrorText)) {
              // Another administrator committed first. Refresh the common
              // group CAS token and server shell while preserving this
              // device's explicitly pending edits, then let the serialized
              // retry publish them against the new revision.
              try {
                const loaded = await loadCloudWorkspace(
                  stateRef.current,
                  pushedGroupId,
                );
                if (operationIsCurrent()) {
                  const rebased = mergeRemoteWorkspace(
                    loaded,
                    stateRef.current,
                  );
                  stateRef.current = rebased;
                  replaceState(rebased);
                }
              } catch {
                // Keep the durable local outbox. The normal retry below will
                // hydrate again after transient connectivity recovers.
              }
            } else if (/stale_group_publish|40001/i.test(workspaceErrorText))
              throw new Error(
                `snapshot_conflict: ${workspaceErrorText || "newer account revision"}`,
              );
            // Group tables and the private account snapshot are independent.
            // Preserve settings and imported health data even when one shared
            // table is temporarily unavailable, then retry group data later.
            workspaceSynced = false;
            workspaceWarning = `Group data will retry: ${workspaceErrorText || "unknown server error"}`;
            const attempt = Math.min(
              8,
              cloudRetryAttemptRef.current + 1,
            );
            cloudRetryAttemptRef.current = attempt;
            const retryAt =
              Date.now() +
                Math.min(
                  MAX_CLOUD_RETRY_MS,
                  5_000 * 2 ** (attempt - 1),
                );
            nextRetryAtRef.current = retryAt;
            setNextRetryAt(retryAt);
          }
        }
        // A deliberate refresh is also a freshness assertion. Even when no
        // value changed, publish the compact recent status window so the
        // server can stamp this member as checked and up to date. Never use a
        // viewer refresh or phone clock as another member's sync timestamp.
        if (
          forceAttempt &&
          workspaceSynced &&
          !workspaceWasUploaded &&
          isCloudGroupId(candidate.group.id)
        ) {
          const recent = await pushCloudRecentActivity(
            candidate,
            2,
            revisionRef.current,
          );
          if (!operationIsCurrent()) return;
          if (recent.published)
            leaderboardPublishedAtByGroupRef.current.set(
              candidate.group.id,
              Date.now(),
            );
          if (recent.version !== undefined)
            activityVersionByGroupRef.current.set(
              candidate.group.id,
              recent.version,
            );
          if (recent.updatedAt) {
            recordServerSyncedAt(recent.updatedAt);
            const live = stateRef.current;
            const published = applyMembershipRealtimeRow(
              live,
              {
                group_id: candidate.group.id,
                user_id: candidate.currentUserId,
                status: "active",
                last_data_synced_at: recent.updatedAt,
              },
            );
            if (published && published !== live) {
              stateRef.current = published;
              replaceState(published);
            }
          }
        }
        // Group publication and media uploads may take long enough for another
        // local edit to land. Include the latest durable account state instead
        // of uploading the stale candidate captured at operation start.
        const latestBeforeSnapshot = stateRef.current;
        if (stableHash(latestBeforeSnapshot) !== candidateHash) {
          const uploadedLatest = await uploadOwnedMedia(latestBeforeSnapshot);
          if (!operationIsCurrent()) return;
          candidate = mergeUploadedMediaMetadata(
            stateRef.current,
            uploadedLatest,
          );
          candidateHash = stableHash(candidate);
          if (candidate !== stateRef.current) {
            stateRef.current = candidate;
            replaceState(candidate);
          }
        }
        await persistPrivateSnapshot();
        if (!operationIsCurrent()) return;
        hashRef.current = candidateHash;
        await writeCloudSnapshotAck(operationUserId, candidateHash).catch(
          () => undefined,
        );
        if (!operationIsCurrent()) return;
        if (workspaceSynced) {
          if (!isCloudGroupId(candidate.group.id)) {
            workspaceHashRef.current = nextWorkspaceHash;
          } else if (workspaceWasUploaded) {
            workspaceHashRef.current =
              candidate.group.id === pushedGroupId
                ? pushedWorkspaceHash
                : (workspaceAckHashesRef.current.get(candidate.group.id) ??
                  null);
          }
        }
        recordServerSyncedAt(syncedAt);
        const latestState = stateRef.current;
        const hasNewerLocalState = stableHash(latestState) !== candidateHash;
        const hasPendingWorkspace =
          isCloudGroupId(latestState.group.id) &&
          (latestState.settings.pendingGroupConfigurationIds?.includes(
            latestState.group.id,
          ) === true ||
            workspaceHash(latestState) !== workspaceHashRef.current);
        const needsFollowUpSync = hasNewerLocalState || hasPendingWorkspace;
        setPendingChanges(
          !workspaceSynced || needsFollowUpSync,
        );
        setStatus("synced");
        if (!deferGroupRetry) setErrorMessage(workspaceWarning);
        if (workspaceSynced) {
          cloudRetryAttemptRef.current = 0;
          const retryAt = needsFollowUpSync ? Date.now() + 500 : 0;
          nextRetryAtRef.current = retryAt;
          setNextRetryAt(retryAt);
        }
        void touchPresence().catch(() => undefined);
        // Device presence is a low-frequency heartbeat, not part of every
        // autosave. This avoids a second query after routine local edits.
        if (Date.now() - deviceHeartbeatAtRef.current >= 15 * 60 * 1000) {
          deviceHeartbeatAtRef.current = Date.now();
          supabase
            .rpc("register_account_device", {
              client_device_id: deviceId,
              client_platform: Platform.OS,
              client_label: null,
            })
            .then(() => undefined, () => undefined);
        }
      } catch (error) {
        if (!operationIsCurrent()) return;
        const syncErrorText = errorText(error);
        if (/snapshot_conflict/i.test(syncErrorText)) {
          setStatus("conflict");
          const remote = await fetchSnapshot(operationUserId).catch(() => null);
          if (!operationIsCurrent()) return;
          if (remote) {
            revisionRef.current = remote.revision;
            const merged = mergeStates(
              bindStateToAccount(remote.payload, operationUser),
              stateRef.current,
              mergeBaseRef.current,
            );
            rememberCloudMergeBase(
              operationUserId,
              bindStateToAccount(remote.payload, operationUser),
            );
            replaceState(merged);
            stateRef.current = merged;
            setPendingChanges(true);
            setErrorMessage(
              "Changes from two devices were merged. Sync once more to confirm them.",
            );
            cloudRetryAttemptRef.current = 1;
            nextRetryAtRef.current = Date.now() + 5_000;
            setNextRetryAt(nextRetryAtRef.current);
            return;
          }
        }
        const offline = /network|fetch|offline|timeout/i.test(syncErrorText);
        const attempt = Math.min(8, cloudRetryAttemptRef.current + 1);
        cloudRetryAttemptRef.current = attempt;
        const retryAt =
          Date.now() +
          Math.min(MAX_CLOUD_RETRY_MS, 5_000 * 2 ** (attempt - 1));
        nextRetryAtRef.current = retryAt;
        setNextRetryAt(retryAt);
        setStatus(offline ? "offline" : "error");
        setPendingChanges(hasUnsyncedLocalChanges());
        setErrorMessage(friendlySyncError(error));
      } finally {
        syncIsForcedRef.current = false;
        syncPromiseRef.current = null;
      }
    })();
    syncPromiseRef.current = operation;
    return operation;
  }, [
    auth.user,
    hasUnsyncedLocalChanges,
    mergeRemoteWorkspace,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
    touchPresence,
  ]);
  performSyncRef.current = performSync;

  const publishLeaderboardFreshness = useCallback(async () => {
    if (
      auth.status !== "signedIn" ||
      !auth.user ||
      !supabase ||
      initializedUserRef.current !== auth.user.id ||
      remoteInitializationPendingRef.current ||
      !networkAvailableRef.current ||
      NativeAppState.currentState !== "active" ||
      isCloudSyncPaused()
    )
      return;
    const current = stateRef.current;
    const groupId = current.group.id;
    if (!isCloudGroupId(groupId)) return;
    const lastAttempt =
      leaderboardPublishedAtByGroupRef.current.get(groupId) ?? 0;
    if (Date.now() - lastAttempt < LEADERBOARD_FRESHNESS_INTERVAL_MS) return;
    // A real local edit owns the next publication. Let the normal outbox save
    // it immediately instead of racing a metadata-only freshness assertion.
    const privateSnapshotChanged = stableHash(current) !== hashRef.current;
    const groupWorkspaceChanged =
      current.settings.pendingGroupConfigurationIds?.includes(groupId) ===
        true ||
      workspaceUploadRequiredGroupsRef.current.has(groupId) ||
      workspaceHash(current) !== workspaceHashRef.current;
    if (
      syncPromiseRef.current ||
      privateSnapshotChanged ||
      groupWorkspaceChanged ||
      leaderboardPublishPromiseRef.current
    )
      return;

    // Record the attempt boundary as well as success. A temporary network or
    // schema failure must not become a tight foreground retry loop.
    leaderboardPublishedAtByGroupRef.current.set(groupId, Date.now());
    const operation = (async () => {
      const recent = await pushCloudRecentActivity(
        current,
        2,
        revisionRef.current,
      );
      if (
        !recent.published ||
        stateRef.current.group.id !== groupId
      )
        return;
      if (recent.version !== undefined)
        activityVersionByGroupRef.current.set(groupId, recent.version);
      if (!recent.updatedAt) return;
      recordServerSyncedAt(recent.updatedAt);
      const published = applyMembershipRealtimeRow(stateRef.current, {
        group_id: groupId,
        user_id: current.currentUserId,
        status: "active",
        last_data_synced_at: recent.updatedAt,
      });
      if (published && published !== stateRef.current) {
        stateRef.current = published;
        replaceState(published);
      }
    })();
    leaderboardPublishPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      if (leaderboardPublishPromiseRef.current === operation)
        leaderboardPublishPromiseRef.current = null;
    }
  }, [auth.status, auth.user, recordServerSyncedAt, replaceState]);

  useEffect(() => {
    if (!hydrated || auth.status !== "signedIn" || !auth.user || !supabase) {
      initializedUserRef.current = null;
      setStatus("disabled");
      return;
    }
    let cancelled = false;
    const user = auth.user;
    remoteInitializationPendingRef.current = true;
    setStatus("initializing");
    setErrorMessage(null);
    (async () => {
      try {
        const deviceId = await getDeviceId();
        if (cancelled) return;
        deviceIdRef.current = deviceId;
        workspaceAckHashesRef.current = await readWorkspaceAcks(user.id);
        groupConfigurationAckHashesRef.current =
          await readGroupConfigurationAcks(user.id);
        const acknowledgedSnapshotHash = await readCloudSnapshotAck(user.id);
        mergeBaseRef.current = await readCloudMergeBase(user.id);
        if (
          !mergeBaseRef.current &&
          acknowledgedSnapshotHash &&
          stableHash(stateRef.current) === acknowledgedSnapshotHash
        )
          rememberCloudMergeBase(user.id, stateRef.current);
        const savedCheckpoint = await readCloudSyncCheckpoint(user.id);
        if (savedCheckpoint) {
          lastSyncedAtRef.current = savedCheckpoint;
          setLastSyncedAt(savedCheckpoint);
        }
        if (cancelled) return;
        // Local state is authoritative and usable before the first network
        // request. Mark the account initialized now so offline edits enter the
        // outbox instead of being silently ignored until a relaunch.
        initializedUserRef.current = user.id;
        const onboardingComplete = await onboardingCompletedLocally(user.id);
        if (cancelled) return;
        if (
          onboardingComplete &&
          stateRef.current.currentUserId === user.id &&
          !stateRef.current.settings.onboardingComplete
        ) {
          const markedComplete = {
            ...stateRef.current,
            settings: {
              ...stateRef.current.settings,
              onboardingComplete: true,
            },
          };
          stateRef.current = markedComplete;
          replaceState(markedComplete);
        }
        if (!networkAvailableRef.current) {
          setStatus("offline");
          setPendingChanges(hasUnsyncedLocalChanges());
          setErrorMessage(
            "Offline changes are safe on this device and will retry automatically.",
          );
          return;
        }
        const remote = await fetchSnapshot(user.id);
        if (cancelled) return;
        remoteInitializationPendingRef.current = false;
        let correctedAccountState = false;
        if (remote) {
          revisionRef.current = remote.revision;
          const identityWasReset =
            identityResetUserRef.current === user.id;
          const cachedAccountHash = stableHash(stateRef.current);
          correctedAccountState =
            remote.payload.currentUserId !== user.id ||
            isDemoBoundState(remote.payload);
          const bound = bindStateToAccount(remote.payload, user);
          const remoteHash = stableHash(bound);
          const checkpointTime = savedCheckpoint
            ? new Date(savedCheckpoint).getTime()
            : Number.NaN;
          const remoteTime = new Date(remote.updated_at).getTime();
          const cachedSavedTime = stateRef.current.lastSavedAt
            ? new Date(stateRef.current.lastSavedAt).getTime()
            : Number.NaN;
          // Older builds did not persist an account hash acknowledgement. On
          // the first upgraded launch, accept a provably newer remote snapshot
          // only when the local cache has not changed after its last server
          // checkpoint. Otherwise preserve the local/offline outbox. A small
          // tolerance covers the local persistence timestamp written just
          // after a successful server response.
          const firstUpgradeCanAcceptRemote =
            !acknowledgedSnapshotHash &&
            Number.isFinite(checkpointTime) &&
            remoteTime > checkpointTime &&
            (!Number.isFinite(cachedSavedTime) ||
              cachedSavedTime <= checkpointTime + 2_000);
          const localWasDirty =
            !identityWasReset &&
            (acknowledgedSnapshotHash
              ? cachedAccountHash !== acknowledgedSnapshotHash
              : cachedAccountHash !== remoteHash &&
                !firstUpgradeCanAcceptRemote);
          const remoteWithDeviceState = preserveDeviceHealthState(
            mergePrivateMediaUrls(bound, stateRef.current),
            stateRef.current,
          );
          // A persisted acknowledgement distinguishes an offline local edit
          // from an older-but-clean cache. Clean clients accept newer website,
          // extension, or phone changes; dirty clients preserve their outbox.
          let resolved = localWasDirty
            ? mergeStates(
                remoteWithDeviceState,
                stateRef.current,
                mergeBaseRef.current,
              )
            : acceptCleanRemoteState(remoteWithDeviceState, stateRef.current);
          if (onboardingComplete && !resolved.settings.onboardingComplete)
            resolved = {
              ...resolved,
              settings: {
                ...resolved.settings,
                onboardingComplete: true,
              },
            };
          if (!cancelled) {
            hashRef.current = correctedAccountState
              ? null
              : remoteHash;
            workspaceHashRef.current = isCloudGroupId(resolved.group.id)
              ? (workspaceAckHashesRef.current.get(resolved.group.id) ?? null)
              : null;
            if (
              isCloudGroupId(resolved.group.id) &&
              !workspaceHashRef.current
            )
              workspaceUploadRequiredGroupsRef.current.add(resolved.group.id);
            groupConfigurationHashRef.current = isCloudGroupId(
              resolved.group.id,
            )
              ? (groupConfigurationAckHashesRef.current.get(
                  resolved.group.id,
                ) ?? null)
              : null;
            replaceState(resolved);
            stateRef.current = resolved;
            rememberCloudMergeBase(user.id, bound);
            recordServerSyncedAt(remote.updated_at);
            const resolvedHash = stableHash(resolved);
            setPendingChanges(hasUnsyncedLocalChanges());
            if (!localWasDirty || resolvedHash === remoteHash)
              await writeCloudSnapshotAck(user.id, remoteHash).catch(
                () => undefined,
              );
            setStatus("synced");
          }
          // Signed media URLs and group history are cache hydration, not an
          // app-start prerequisite. Render the local/private snapshot first,
          // then merge these server-owned rows without regressing local writes.
          InteractionManager.runAfterInteractions(() => {
            (async () => {
              let hydratedState = stateRef.current;
              try {
                hydratedState = mergePrivateMediaUrls(
                  hydratedState,
                  await resolvePrivateMedia(bound),
                );
              } catch {
                // The account and group cache remain usable even when Storage
                // signing is temporarily unavailable or egress is restricted.
              }
              const existingGroups = await loadCloudGroupShells();
              const targetGroup =
                existingGroups.find(
                  (group) => group.id === hydratedState.group.id,
                ) ?? existingGroups[0];
              if (targetGroup)
                hydratedState = await loadCloudWorkspace(
                  { ...hydratedState, groups: existingGroups },
                  targetGroup.id,
                  (metadata) =>
                    recordActivityMetadata(targetGroup.id, metadata),
                );
              if (cancelled) return;
              const next = mergeRemoteWorkspace(
                hydratedState,
                stateRef.current,
              );
              stateRef.current = next;
              replaceState(next);
            })().catch((groupError) => {
              if (!cancelled)
                setErrorMessage(
                  `Account restored; group refresh will retry: ${errorText(groupError)}`,
                );
            });
          });
        } else {
          const bound = bindStateToAccount(stateRef.current, user);
          stateRef.current = bound;
          replaceState(bound);
          revisionRef.current = 0;
          hashRef.current = null;
          workspaceHashRef.current = isCloudGroupId(bound.group.id)
            ? (workspaceAckHashesRef.current.get(bound.group.id) ?? null)
            : null;
          groupConfigurationHashRef.current = isCloudGroupId(bound.group.id)
            ? (groupConfigurationAckHashesRef.current.get(bound.group.id) ?? null)
            : null;
          setPendingChanges(true);
          InteractionManager.runAfterInteractions(() => {
            (async () => {
              const existingGroups = await loadCloudGroupShells();
              if (!existingGroups.length || cancelled) return;
              const targetGroup = existingGroups[0];
              const loaded = await loadCloudWorkspace(
                { ...stateRef.current, groups: existingGroups },
                targetGroup.id,
                (metadata) =>
                  recordActivityMetadata(targetGroup.id, metadata),
              );
              if (cancelled) return;
              const next = mergeRemoteWorkspace(
                loaded,
                stateRef.current,
              );
              stateRef.current = next;
              workspaceHashRef.current =
                workspaceAckHashesRef.current.get(targetGroup.id) ?? null;
              if (!workspaceHashRef.current)
                workspaceUploadRequiredGroupsRef.current.add(targetGroup.id);
              replaceState(next);
            })().catch((groupError) => {
              if (!cancelled)
                setErrorMessage(
                  `Account ready; group refresh will retry: ${errorText(groupError)}`,
                );
            });
          });
        }
        if (cancelled) return;
        identityResetUserRef.current = null;
        supabase!.rpc("register_account_device", {
          client_device_id: deviceId,
          client_platform: Platform.OS,
          client_label: null,
        }).then(() => undefined, () => undefined);
        deviceHeartbeatAtRef.current = Date.now();
        if (
          !remote ||
          correctedAccountState ||
          hasUnsyncedLocalChanges()
        )
          await performSync(false, true);
        else setStatus("synced");
        loadDevices().catch(() => undefined);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            /network|fetch|offline|timeout/i.test(errorText(error))
              ? "offline"
              : "error",
          );
          setErrorMessage(friendlySyncError(error));
          setPendingChanges(hasUnsyncedLocalChanges());
          const attempt = Math.min(
            8,
            cloudRetryAttemptRef.current + 1,
          );
          cloudRetryAttemptRef.current = attempt;
          const retryAt =
            Date.now() +
            Math.min(MAX_CLOUD_RETRY_MS, 5_000 * 2 ** (attempt - 1));
          nextRetryAtRef.current = retryAt;
          setNextRetryAt(retryAt);
        }
      }
    })();
    return () => {
      cancelled = true;
      initializedUserRef.current = null;
      remoteInitializationPendingRef.current = false;
      mergeBaseRef.current = null;
    };
  }, [
    auth.status,
    auth.user,
    hydrated,
    hasUnsyncedLocalChanges,
    initializationAttempt,
    loadDevices,
    mergeRemoteWorkspace,
    performSync,
    recordActivityMetadata,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      initializedUserRef.current !== auth.user?.id
    )
      return;
    // Do not restart the debounce clock for every state object. Busy pages can
    // update several times per gesture; repeatedly cancelling here used to
    // postpone the actual outbox save indefinitely and created timer churn.
    if (timerRef.current || idleSyncRef.current) return;
    // Coalesce and defer full-snapshot hashing. Serializing the whole offline
    // state synchronously on every tap or keystroke caused phone UI stutter.
    const saveWhenReady = () => {
      timerRef.current = null;
      if (isCloudSyncPaused()) {
        timerRef.current = setTimeout(saveWhenReady, 1200);
        return;
      }
      if (!networkAvailableRef.current) {
        setPendingChanges(hasUnsyncedLocalChanges());
        setStatus("offline");
        return;
      }
      idleSyncRef.current = InteractionManager.runAfterInteractions(() => {
        idleSyncRef.current = null;
        const live = stateRef.current;
        const privateSnapshotChanged = stableHash(live) !== hashRef.current;
        const groupWorkspaceChanged =
          isCloudGroupId(live.group.id) &&
          (live.settings.pendingGroupConfigurationIds?.includes(
            live.group.id,
          ) === true ||
            workspaceUploadRequiredGroupsRef.current.has(live.group.id) ||
            workspaceHash(live) !== workspaceHashRef.current);
        if (!privateSnapshotChanged && !groupWorkspaceChanged) return;
        setPendingChanges(true);
        performSync().catch(() => undefined);
      });
    };
    timerRef.current = setTimeout(saveWhenReady, 1200);
  }, [
    auth.status,
    auth.user?.id,
    hasUnsyncedLocalChanges,
    performSync,
    state,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      idleSyncRef.current?.cancel();
      idleSyncRef.current = null;
    },
    [auth.user?.id],
  );

  useEffect(() => {
    if (
      !nextRetryAt ||
      !networkAvailable ||
      !pendingChanges ||
      auth.status !== "signedIn"
    )
      return;
    const timer = setTimeout(() => {
      if (
        NativeAppState.currentState === "active" &&
        networkAvailableRef.current
      ) {
        if (remoteInitializationPendingRef.current)
          setInitializationAttempt((value) => value + 1);
        else performSync(false, false).catch(() => undefined);
      }
    }, Math.max(0, nextRetryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [
    auth.status,
    networkAvailable,
    nextRetryAt,
    pendingChanges,
    performSync,
  ]);

  useEffect(() => {
    if (!supabase || auth.status !== "signedIn" || !auth.user) return;
    const client = supabase;
    let fallbackChannel: ReturnType<typeof client.channel> | null = null;
    const handleInvalidation = (next: {
      revision?: number;
      device_id?: string;
    }) => {
      const expectedRevision = Number(next.revision ?? 0);
      if (expectedRevision <= revisionRef.current) return;
      // Database-triggered Broadcast is not covered by channel `self: false`.
      // Ignore only the exact revision this runtime is currently writing. A
      // website and extension can share the same persistent device id, so a
      // blanket same-device guard would incorrectly hide their updates.
      if (
        next.device_id === deviceIdRef.current &&
        expectedRevision === snapshotWriteTargetRevisionRef.current
      )
        return;
      pullLatest(expectedRevision).catch(() => undefined);
    };
    const startPostgresFallback = () => {
      if (fallbackChannel) return;
      // Compatibility only for projects where the compact Broadcast migration
      // has not been applied yet. The normal path never streams snapshot JSON.
      fallbackChannel = client
        .channel(`account-snapshot-fallback:${auth.user!.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "user_snapshots",
            filter: `user_id=eq.${auth.user!.id}`,
          },
          (event) =>
            handleInvalidation(
              event.new as { revision?: number; device_id?: string },
            ),
        )
        .subscribe();
    };
    const channel = client
      .channel(`account:${auth.user.id}:snapshot`, {
        config: { private: true, broadcast: { self: false } },
      })
      .on(
        "broadcast",
        { event: "snapshot_updated" },
        (event: { payload?: { revision?: number; device_id?: string } }) =>
          handleInvalidation(event.payload ?? {}),
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED" && fallbackChannel) {
          const staleFallback = fallbackChannel;
          fallbackChannel = null;
          client.removeChannel(staleFallback).catch(() => undefined);
          return;
        }
        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        )
          startPostgresFallback();
      });
    return () => {
      client.removeChannel(channel).catch(() => undefined);
      if (fallbackChannel)
        client.removeChannel(fallbackChannel).catch(() => undefined);
    };
  }, [auth.status, auth.user, pullLatest]);

  useEffect(() => {
    if (!supabase || auth.status !== "signedIn" || !auth.user) return;
    let cancelled = false;
    let requestToWatch: PendingGroupRequest | null = null;
    let approvalCheckInFlight = false;
    const activateIfApproved = async (groupId: string) => {
      if (approvalCheckInFlight) return;
      approvalCheckInFlight = true;
      try {
        const shells = await loadCloudGroupShells();
        const shell = shells.find((group) => group.id === groupId);
        if (cancelled || !shell) return;
        // Show approval immediately from the lightweight group shell. History
        // then hydrates behind the rendered page instead of blocking it.
        const optimistic = {
          ...stateRef.current,
          group: shell,
          groups: mergeById(
            stateRef.current.groups.filter(isPersonalSetupGroup),
            shells,
          ),
        };
        stateRef.current = optimistic;
        hashRef.current = null;
        workspaceUploadRequiredGroupsRef.current.add(groupId);
        workspaceHashRef.current = null;
        groupConfigurationHashRef.current =
          groupConfigurationAckHashesRef.current.get(groupId) ?? null;
        replaceState(optimistic);
        await AsyncStorage.removeItem(PENDING_GROUP_KEY);
        requestToWatch = null;
        setPendingGroup(null);
        loadCloudWorkspace(
          optimistic,
          groupId,
          (metadata) => recordActivityMetadata(groupId, metadata),
        )
          .then((next) => {
            if (cancelled || stateRef.current.group.id !== groupId) return;
            const merged = mergeRemoteWorkspace(
              next,
              stateRef.current,
            );
            stateRef.current = merged;
            workspaceHashRef.current =
              workspaceAckHashesRef.current.get(groupId) ?? null;
            replaceState(merged);
          })
          .catch((error) =>
            setErrorMessage(
              `Group history will retry: ${errorText(error)}`,
            ),
          );
      } finally {
        approvalCheckInFlight = false;
      }
    };
    AsyncStorage.getItem(PENDING_GROUP_KEY)
      .then((stored) => {
        const request = parsePendingGroup(stored);
        requestToWatch = request;
        setPendingGroup(request);
        if (request) return activateIfApproved(request.groupId);
      })
      .catch(() => undefined);
    const approvalPoll = setInterval(() => {
      if (
        requestToWatch &&
        NativeAppState.currentState === "active"
      )
        activateIfApproved(requestToWatch.groupId).catch(() => undefined);
    }, 15000);
    const channel = supabase
      .channel(`membership-approval:${auth.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "group_members",
          filter: `user_id=eq.${auth.user.id}`,
        },
        (event) => {
          const membership = event.new as {
            group_id?: string;
            status?: string;
          };
          if (membership.group_id && membership.status === "active") {
            requestToWatch = {
              groupId: membership.group_id,
              groupName: requestToWatch?.groupName,
            };
            activateIfApproved(membership.group_id).catch(() => undefined);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "group_members",
          filter: `user_id=eq.${auth.user.id}`,
        },
        () => {
          AsyncStorage.removeItem(PENDING_GROUP_KEY).catch(() => undefined);
          setPendingGroup(null);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      clearInterval(approvalPoll);
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [
    auth.status,
    auth.user,
    mergeRemoteWorkspace,
    recordActivityMetadata,
    replaceState,
  ]);

  const refreshGroup = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const groupId = stateRef.current.group.id;
    const sequence = ++groupLoadSequenceRef.current;
    activityLoadSequenceRef.current += 1;
    const loaded = await loadCloudWorkspace(
      stateRef.current,
      groupId,
      (metadata) => recordActivityMetadata(groupId, metadata),
    );
    if (
      sequence !== groupLoadSequenceRef.current ||
      stateRef.current.group.id !== groupId
    )
      return;
    const refreshed = mergeRemoteWorkspace(
      loaded,
      stateRef.current,
    );
    stateRef.current = refreshed;
    workspaceHashRef.current =
      workspaceAckHashesRef.current.get(groupId) ?? null;
    replaceState(refreshed);
  }, [mergeRemoteWorkspace, recordActivityMetadata, replaceState]);

  const refreshMessages = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const messages = await loadCloudMessages(
      stateRef.current,
      stateRef.current.group.id,
    );
    if (messagesEquivalent(stateRef.current.messages, messages)) return;
    const next = { ...stateRef.current, messages };
    stateRef.current = next;
    // Do not hash or reload the full group workspace for a chat-only update.
    replaceState(next);
  }, [replaceState]);

  const refreshGroupActivity = useCallback(
    (sinceDate?: string): Promise<void> => {
      if (!isCloudGroupId(stateRef.current.group.id))
        return Promise.resolve();
      const requestedSince = sinceDate ?? null;
      const alreadyQueued = queuedActivitySinceRef.current;
      if (
        alreadyQueued === undefined ||
        requestedSince === null ||
        (alreadyQueued !== null && requestedSince < alreadyQueued)
      )
        queuedActivitySinceRef.current = requestedSince;

      // Realtime can emit one event for the entry and another for its daily
      // summary. Coalesce them into one serialized refresh rather than allowing
      // overlapping range requests to commit out of order.
      if (activityRefreshPromiseRef.current)
        return activityRefreshPromiseRef.current;

      const operation = (async () => {
        while (queuedActivitySinceRef.current !== undefined) {
          const queuedSince = queuedActivitySinceRef.current;
          queuedActivitySinceRef.current = undefined;
          const groupId = stateRef.current.group.id;
          if (!isCloudGroupId(groupId)) continue;
          const sequence = ++activityLoadSequenceRef.current;
          const activity = await loadCloudGroupActivity(
            stateRef.current,
            groupId,
            queuedSince ?? undefined,
          );
          if (
            sequence !== activityLoadSequenceRef.current ||
            stateRef.current.group.id !== groupId
          )
            continue;
          const lastVersion = activityVersionByGroupRef.current.get(groupId);
          const lastCoverage =
            activityCoverageSinceByGroupRef.current.get(groupId);
          const responseCoverage =
            activity.authoritativeStatusSinceDate ?? queuedSince ?? undefined;
          const extendsCoverage = Boolean(
            responseCoverage &&
              (!lastCoverage || responseCoverage < lastCoverage),
          );
          if (
            activity.version !== undefined &&
            lastVersion !== undefined &&
            activity.version <= lastVersion &&
            !extendsCoverage
          )
            continue;
          if (activity.version !== undefined)
            activityVersionByGroupRef.current.set(
              groupId,
              activity.version,
            );
          if (
            responseCoverage &&
            (!lastCoverage || responseCoverage < lastCoverage)
          )
            activityCoverageSinceByGroupRef.current.set(
              groupId,
              responseCoverage,
            );
          const live = stateRef.current;
          const deletedEntryKeys = new Set(
            activity.deletedEntryKeys ?? [],
          );
          const groupMetricIds = new Set(
            (live.group.metricConfiguration ?? []).map(
              (metric) => metric.id,
            ),
          );
          const groupMemberIds = new Set(
            live.group.members.map((member) => member.id),
          );
          const baseEntries = activity.authoritativeEntrySinceDate
            ? live.entries.filter(
                (entry) =>
                  entry.userId === live.currentUserId ||
                  !groupMetricIds.has(entry.metricId) ||
                  !groupMemberIds.has(entry.userId) ||
                  entry.localDate < activity.authoritativeEntrySinceDate!,
              )
            : live.entries;
          const baseStatuses = activity.authoritativeStatusSinceDate
            ? live.dailyMetricStatuses.filter(
                (status) =>
                  status.groupId !== groupId ||
                  status.userId === live.currentUserId ||
                  status.localDate < activity.authoritativeStatusSinceDate!,
              )
            : live.dailyMetricStatuses;
          // Absence in a range response is not a deletion signal. Merge the
          // fetched delta monotonically. Only the versioned snapshot RPC may
          // authoritatively prune absent friend rows in its bounded date range.
          const next = {
            ...live,
            entries: mergeActivityEntries(
              baseEntries.filter(
                (entry) =>
                  !deletedEntryKeys.has(
                    metricEntryKey(entry.userId, entry.id),
                  ),
              ),
              activity.entries,
              live.currentUserId,
            ),
            dailyMetricStatuses: mergeActivityStatuses(
              baseStatuses,
              activity.dailyMetricStatuses,
            ),
          };
          stateRef.current = next;
          replaceState(next);
          const cached = cachedGroupActivity(next, groupId);
          InteractionManager.runAfterInteractions(() => {
            writeGroupActivityCache({
              groupId,
              version: activity.version,
              updatedAt: activity.updatedAt,
              ...cached,
            }).catch(() => undefined);
          });
        }
      })();
      activityRefreshPromiseRef.current = operation;
      void operation
        .finally(() => {
          if (activityRefreshPromiseRef.current === operation)
            activityRefreshPromiseRef.current = null;
        })
        .catch(() => undefined);
      return operation;
    },
    [replaceState],
  );

  useEffect(() => {
    const wasAvailable = previousNetworkAvailableRef.current;
    previousNetworkAvailableRef.current = networkAvailable;
    if (
      !networkAvailable ||
      wasAvailable ||
      auth.status !== "signedIn" ||
      !auth.user
    )
      return;

    // Connectivity can return while the app remains foregrounded. Reset the
    // offline backoff and drain local writes immediately instead of waiting for
    // another edit, tab change, or app resume.
    cloudRetryAttemptRef.current = 0;
    nextRetryAtRef.current = 0;
    setNextRetryAt(0);
    flushChatOutbox();
    if (remoteInitializationPendingRef.current) {
      setInitializationAttempt((value) => value + 1);
      return;
    }
    const timer = setTimeout(() => {
      performSync(false, false).catch(() => undefined);
      refreshMessages().catch(() => undefined);
      refreshGroupActivity(
        dateWithOffsetFrom(dateKey(), -(GROUP_ACTIVITY_LOCAL_CACHE_DAYS - 1)),
      ).catch(() => undefined);
    }, 150);
    return () => clearTimeout(timer);
  }, [
    auth.status,
    auth.user,
    flushChatOutbox,
    networkAvailable,
    performSync,
    refreshGroupActivity,
    refreshMessages,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      !networkAvailable ||
      pendingChanges ||
      status !== "synced" ||
      NativeAppState.currentState !== "active" ||
      !isCloudGroupId(state.group.id)
    )
      return;
    const groupId = state.group.id;
    const historySince = dateWithOffsetFrom(
      dateKey(),
      -(GROUP_ACTIVITY_BACKGROUND_HISTORY_DAYS - 1),
    );
    if (
      historicalHydrationStartedRef.current.has(groupId) ||
      (activityCoverageSinceByGroupRef.current.get(groupId) ?? "9999-12-31") <=
        historySince
    )
      return;
    historicalHydrationStartedRef.current.add(groupId);
    let idleWork: ReturnType<typeof InteractionManager.runAfterInteractions> | null =
      null;
    let timer: ReturnType<typeof setTimeout>;
    const hydrateWhenIdle = () => {
      if (NativeAppState.currentState !== "active") {
        historicalHydrationStartedRef.current.delete(groupId);
        return;
      }
      if (syncPromiseRef.current) {
        timer = setTimeout(hydrateWhenIdle, 5_000);
        return;
      }
      idleWork = InteractionManager.runAfterInteractions(() => {
        refreshGroupActivity(historySince).catch(() => {
          // A later resume/reconnect may retry; never loop aggressively while
          // the phone is idle or the server is unavailable.
          historicalHydrationStartedRef.current.delete(groupId);
        });
      });
    };
    timer = setTimeout(hydrateWhenIdle, 12_000);
    return () => {
      clearTimeout(timer);
      idleWork?.cancel();
    };
  }, [
    auth.status,
    networkAvailable,
    pendingChanges,
    refreshGroupActivity,
    state.group.id,
    status,
  ]);

  const hydrateGroupInBackground = useCallback(
    (groupId: string) => {
      const base = stateRef.current;
      // A null hash means this device has local rows that have not yet been
      // acknowledged by the relational group tables (not merely the private
      // account snapshot). Keep that outbox marker through hydration.
      const workspaceUploadRequired =
        workspaceUploadRequiredGroupsRef.current.has(groupId);
      const sequence = ++groupLoadSequenceRef.current;
      activityLoadSequenceRef.current += 1;
      const hydrate = async () => {
        // Start the authoritative request immediately. Reading SQLite must not
        // sit in front of the network request; the cache and server race in
        // parallel, while each still commits as one complete snapshot.
        const workspacePromise = loadCloudWorkspace(
          base,
          groupId,
          (metadata) => recordActivityMetadata(groupId, metadata),
        );
        const cached = await readGroupActivityCache(groupId).catch(
          () => null,
        );
        if (
          cached &&
          sequence === groupLoadSequenceRef.current &&
          stateRef.current.group.id === groupId
        ) {
          const live = stateRef.current;
          const next = {
            ...live,
            entries: mergeActivityEntries(
              live.entries,
              cached.entries,
              live.currentUserId,
            ),
            dailyMetricStatuses: mergeActivityStatuses(
              live.dailyMetricStatuses,
              cached.dailyMetricStatuses,
            ),
          };
          if (cached.version !== undefined)
            activityVersionByGroupRef.current.set(
              groupId,
              cached.version,
            );
          stateRef.current = next;
          replaceState(next);
        }
        return workspacePromise;
      };
      hydrate()
        .then((loaded) => {
          // A slow response for an old group must never pull the user back
          // after they already switched elsewhere.
          if (
            sequence !== groupLoadSequenceRef.current ||
            stateRef.current.group.id !== groupId
          )
            return;
          const next = mergeRemoteWorkspace(
            loaded,
            stateRef.current,
          );
          stateRef.current = next;
          workspaceHashRef.current = workspaceUploadRequired
            ? null
            : (workspaceAckHashesRef.current.get(groupId) ?? null);
          replaceState(next);
          setPendingChanges(hasUnsyncedLocalChanges());
          const cachePayload = cachedGroupActivity(next, groupId);
          InteractionManager.runAfterInteractions(() => {
            writeGroupActivityCache({
              groupId,
              updatedAt: new Date().toISOString(),
              ...cachePayload,
            }).catch(() => undefined);
          });
        })
        .catch((error) =>
          setErrorMessage(`Group refresh will retry: ${errorText(error)}`),
        );
    },
    [
      hasUnsyncedLocalChanges,
      mergeRemoteWorkspace,
      recordActivityMetadata,
      replaceState,
    ],
  );

  useEffect(() => {
    if (
      !supabase ||
      auth.status !== "signedIn" ||
      !auth.user ||
      initializedUserRef.current !== auth.user.id ||
      !isCloudGroupId(state.group.id)
    )
      return;
    const client = supabase;
    const activityVersionChecks =
      activityVersionCheckByGroupRef.current;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let messageTimer: ReturnType<typeof setTimeout> | null = null;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    let activitySinceDate: string | undefined;
    const afterWriteSuppression = (baseDelay: number) =>
      Math.max(
        baseDelay,
        suppressGroupRefreshUntilRef.current - Date.now() + 50,
      );
    const queueRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => refreshGroup().catch(() => undefined),
        afterWriteSuppression(220),
      );
    };
    const queueMessageRefresh = () => {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        refreshMessages().catch(() => undefined);
      }, 60);
    };
    const queueActivityRefresh = (event?: {
      new?: Record<string, unknown>;
      old?: Record<string, unknown>;
    }) => {
      const announcedVersion = Number(event?.new?.version);
      const knownVersion = activityVersionByGroupRef.current.get(
        state.group.id,
      );
      if (
        Number.isFinite(announcedVersion) &&
        knownVersion !== undefined &&
        announcedVersion <= knownVersion
      )
        return;
      const changedDate = String(
        event?.new?.local_date ??
          event?.new?.since_date ??
          event?.old?.local_date ??
          event?.old?.since_date ??
          "",
      );
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - 2);
      const nextSince = /^\d{4}-\d{2}-\d{2}$/.test(changedDate)
        ? changedDate
        : dateKey(fallback);
      activitySinceDate =
        !activitySinceDate || nextSince < activitySinceDate
          ? nextSince
          : activitySinceDate;
      if (activityTimer) clearTimeout(activityTimer);
      activityTimer = setTimeout(
        () => {
          const since = activitySinceDate;
          activitySinceDate = undefined;
          refreshGroupActivity(since).catch(() => undefined);
        },
        afterWriteSuppression(120),
      );
    };
    const catchUpActivityIfNeeded = () => {
      const groupId = state.group.id;
      if (activityVersionChecks.has(groupId)) return;
      const check = (async () => {
        const { data, error } = await client
          .from("group_activity_versions")
          .select("version")
          .eq("group_id", groupId)
          .maybeSingle();
        if (
          cancelled ||
          error ||
          stateRef.current.group.id !== groupId
        )
          return;
        const remoteVersion = Number(data?.version);
        const knownVersion =
          activityVersionByGroupRef.current.get(groupId);
        if (
          !Number.isFinite(remoteVersion) ||
          knownVersion === undefined ||
          remoteVersion > knownVersion
        ) {
          const catchUpStart = new Date();
          catchUpStart.setDate(
            catchUpStart.getDate() - GROUP_ACTIVITY_LOCAL_CACHE_DAYS,
          );
          queueActivityRefresh({
            new: {
              since_date: dateKey(catchUpStart),
              version: Number.isFinite(remoteVersion)
                ? remoteVersion
                : undefined,
            },
          });
        }
      })().finally(() => {
        if (activityVersionChecks.get(groupId) === check)
          activityVersionChecks.delete(groupId);
      });
      activityVersionChecks.set(groupId, check);
    };
    const workspaceChannel = supabase
      .channel(`group-workspace:${state.group.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${state.group.id}`,
        },
        queueMessageRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "photo_updates",
          filter: `group_id=eq.${state.group.id}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${state.group.id}`,
        },
        (event) => {
          if (event.eventType === "DELETE") {
            queueRefresh();
            return;
          }
          const live = stateRef.current;
          const next = applyMembershipRealtimeRow(
            live,
            event.new as MembershipRealtimeRow,
          );
          if (!next) {
            queueRefresh();
            return;
          }
          if (next !== live) {
            stateRef.current = next;
            replaceState(next);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "metric_definitions",
          filter: `group_id=eq.${state.group.id}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_activity_versions",
          filter: `group_id=eq.${state.group.id}`,
        },
        queueActivityRefresh,
      )
      .subscribe();
    const activityChannel = supabase
      .channel(`group:${state.group.id}:activity`, {
        config: { private: true, broadcast: { self: false } },
      })
      .on(
        "broadcast",
        { event: "activity_updated" },
        (event: { payload?: Record<string, unknown> }) => {
          // Coverage is as important as the version: a same/newer version may
          // announce an older historical date than the last applied window.
          // The serialized loader owns the combined version+coverage guard.
          queueActivityRefresh({
            new: {
              since_date: event.payload?.since_date,
              version: event.payload?.version,
            },
          });
        },
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") catchUpActivityIfNeeded();
      });
    const chatChannel = supabase
      .channel(`group:${state.group.id}:chat`, {
        config: { private: true, broadcast: { self: false } },
      })
      .on("broadcast", { event: "message_committed" }, queueMessageRefresh)
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") queueMessageRefresh();
      });
    return () => {
      cancelled = true;
      activityVersionChecks.delete(state.group.id);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (messageTimer) clearTimeout(messageTimer);
      if (activityTimer) clearTimeout(activityTimer);
      supabase?.removeChannel(workspaceChannel).catch(() => undefined);
      supabase?.removeChannel(activityChannel).catch(() => undefined);
      supabase?.removeChannel(chatChannel).catch(() => undefined);
    };
  }, [
    auth.status,
    auth.user,
    refreshGroup,
    refreshGroupActivity,
    refreshMessages,
    replaceState,
    state.group.id,
  ]);

  useEffect(() => {
    const resumeTimers = new Set<ReturnType<typeof setTimeout>>();
    const later = (delay: number, work: () => void) => {
      const timer = setTimeout(() => {
        resumeTimers.delete(timer);
        if (NativeAppState.currentState === "active") work();
      }, delay);
      resumeTimers.add(timer);
    };
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next !== "active") {
        resumeTimers.forEach(clearTimeout);
        resumeTimers.clear();
        return;
      }
      if (
        auth.status !== "signedIn" ||
        Date.now() - lastResumeRecoveryAtRef.current < 3000
      )
        return;
      lastResumeRecoveryAtRef.current = Date.now();
      if (supabase && !supabase.realtime.isConnected())
        supabase.realtime.connect();
      if (auth.user)
        void readCloudSyncCheckpoint(auth.user.id)
          .then(recordServerSyncedAt)
          .catch(() => undefined);
      void touchPresence(true).catch(() => undefined);
      // Resume cached UI first, then recover chat and pending writes in
      // separate turns. The activity subscription checks its lightweight
      // server version on reconnect and only reloads history when it changed.
      later(150, () => {
        pushCloudMessagesNow(stateRef.current).catch(() => undefined);
        refreshMessages().catch(() => undefined);
      });
      // If the app was backgrounded for longer than the freshness window,
      // publish one compact leaderboard assertion after resume. The helper is
      // independently throttled and never marks the private outbox pending.
      later(450, () => {
        publishLeaderboardFreshness().catch(() => undefined);
      });
      if (pendingChanges || status === "offline")
        later(900, () => performSync().catch(() => undefined));
    });
    return () => {
      subscription.remove();
      resumeTimers.forEach(clearTimeout);
      resumeTimers.clear();
    };
  }, [
    auth.status,
    auth.user,
    pendingChanges,
    performSync,
    publishLeaderboardFreshness,
    recordServerSyncedAt,
    refreshMessages,
    status,
    touchPresence,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      !isCloudGroupId(state.group.id)
    )
      return;
    const timer = setInterval(() => {
      publishLeaderboardFreshness().catch(() => undefined);
    }, LEADERBOARD_FRESHNESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auth.status, publishLeaderboardFreshness, state.group.id]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      !isCloudGroupId(state.group.id)
    )
      return;
    void touchPresence(true).catch(() => undefined);
    const timer = setInterval(() => {
      if (NativeAppState.currentState === "active")
        void touchPresence().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [auth.status, state.group.id, touchPresence]);

  const value = useMemo<CloudSyncContextValue>(
    () => ({
      status,
      lastSyncedAt,
      errorMessage,
      pendingChanges,
      pendingGroup,
      devices,
      // A user-requested refresh also repairs relational group rows that may
      // be absent even when the private account snapshot is already current.
      syncNow: async () => {
        if (remoteInitializationPendingRef.current) {
          cloudRetryAttemptRef.current = 0;
          nextRetryAtRef.current = 0;
          setNextRetryAt(0);
          setInitializationAttempt((value) => value + 1);
          return;
        }
        // Manual pull-to-refresh bypasses the automatic five-minute cadence.
        // Serialize behind an already-running compact publish, then force the
        // normal outbox + recent leaderboard publication immediately.
        await leaderboardPublishPromiseRef.current?.catch(() => undefined);
        await performSync(false, true);
      },
      pullLatest,
      refreshDevices: loadDevices,
      forgetDevice: async (deviceId) => {
        if (!supabase) return;
        const { error } = await supabase
          .from("account_devices")
          .delete()
          .eq("device_id", deviceId);
        if (error) throw error;
        await loadDevices();
      },
      deleteAccount: async () => {
        if (!supabase) throw new Error("Cloud is not configured.");
        const { error } = await supabase.functions.invoke("delete-account");
        if (error) throw error;
        await supabase.auth.signOut({ scope: "global" });
      },
      createGroup: async (name, options) => {
        if (!auth.user)
          throw new Error("Sign in before creating a cloud group.");
        const me = stateRef.current.group.members.find(
          (member) => member.id === stateRef.current.currentUserId,
        );
        const metricConfiguration = groupMetricDefinitions(
          options?.metrics ?? [],
          dateKey(),
        );
        const themeColor = options?.themeColor ?? DEFAULT_GROUP_THEME;
        const requireMemberApproval =
          options?.requireMemberApproval ?? false;
        const groupId = await createCloudGroup(
          name,
          metricConfiguration,
          auth.user,
          me?.name,
          themeColor,
          requireMemberApproval,
        );
        const current = me
          ? { ...me, role: "owner" as const }
          : {
              id: auth.user.id,
              name: accountName(auth.user, "You"),
              initials: "Y",
              color: DEFAULT_GROUP_THEME,
              role: "owner" as const,
            };
        const group: Group = {
          id: groupId,
          name: name.trim(),
          inviteCode: "PREPARING",
          templateName: "Custom",
          members: [current],
          streakRestDaysPerWeek: 1,
          themeColor,
          requireMemberApproval,
          metricConfiguration,
        };
        const next = {
          ...stateRef.current,
          group,
          groups: [
            group,
            ...stateRef.current.groups.filter((item) => item.id !== groupId),
          ],
        };
        stateRef.current = next;
        // Group creation is atomic, but personal history/profile data still
        // needs its own idempotent relational upload.
        workspaceUploadRequiredGroupsRef.current.add(groupId);
        workspaceHashRef.current = null;
        const createdConfigurationHash = groupConfigurationHash(next);
        groupConfigurationHashRef.current = createdConfigurationHash;
        groupConfigurationAckHashesRef.current.set(
          groupId,
          createdConfigurationHash,
        );
        await writeGroupConfigurationAcks(
          auth.user!.id,
          groupConfigurationAckHashesRef.current,
        ).catch(() => undefined);
        replaceState(next);
        setPendingChanges(true);
        hydrateGroupInBackground(groupId);
      },
      joinGroup: async (code) => {
        const result = await joinCloudGroup(code);
        const joiningName = accountName(auth.user!, "A new member");
        if (result.status === "pending") {
          const request = {
            groupId: result.groupId,
            groupName: result.groupName,
          };
          await AsyncStorage.setItem(
            PENDING_GROUP_KEY,
            JSON.stringify(request),
          );
          setPendingGroup(request);
          sendMembershipPush({
            groupId: result.groupId,
            eventKey: `membership-request:${result.groupId}:${auth.user!.id}:${dateKey()}`,
            audience: "admins",
            title: `${joiningName} wants to join`,
            body: `Review the request for ${result.groupName ?? "your group"}.`,
            route: "/group-settings",
          }).catch(() => undefined);
          return "pending";
        }
        const groupId = result.groupId;
        const existingMember = stateRef.current.group.members.find(
          (member) => member.id === stateRef.current.currentUserId,
        );
        const current = existingMember
          ? { ...existingMember, role: "member" as const }
          : {
            id: stateRef.current.currentUserId,
            name: accountName(auth.user!, "You"),
            initials: "Y",
            color: DEFAULT_GROUP_THEME,
            role: "member" as const,
          };
        const cached = stateRef.current.groups.find(
          (group) => group.id === groupId,
        );
        const group: Group =
          cached ??
          ({
            id: groupId,
            name: result.groupName || "Joined group",
            inviteCode: "PREPARING",
            templateName: "Shared",
            members: [current],
            streakRestDaysPerWeek: 1,
            themeColor: DEFAULT_GROUP_THEME,
            metricConfiguration: [],
          } satisfies Group);
        const next = {
          ...stateRef.current,
          group,
          groups: [
            group,
            ...stateRef.current.groups.filter((item) => item.id !== groupId),
          ],
        };
        stateRef.current = next;
        // Joining grants read access immediately. Leave a local outbox marker
        // so this member's group-enabled history is uploaded after the cached
        // shell renders instead of being incorrectly treated as synchronized.
        workspaceUploadRequiredGroupsRef.current.add(groupId);
        workspaceHashRef.current = null;
        groupConfigurationHashRef.current =
          groupConfigurationAckHashesRef.current.get(groupId) ?? null;
        replaceState(next);
        setPendingChanges(true);
        await AsyncStorage.removeItem(PENDING_GROUP_KEY);
        setPendingGroup(null);
        hydrateGroupInBackground(groupId);
        sendMembershipPush({
          groupId,
          eventKey: `membership-joined:${groupId}:${auth.user!.id}:${dateKey()}`,
          audience: "admins",
          title: `${joiningName} joined`,
          body: `${joiningName} is now in ${result.groupName ?? "your group"}.`,
          route: "/group-settings",
        }).catch(() => undefined);
        return "active";
      },
      switchGroup: async (groupId) => {
        const group = stateRef.current.groups.find(
          (candidate) => candidate.id === groupId,
        );
        if (!group) throw new Error("That group is not available.");
        const next = stateWithActiveGroup(stateRef.current, group);
        stateRef.current = next;
        workspaceHashRef.current = isCloudGroupId(groupId)
          ? (workspaceAckHashesRef.current.get(groupId) ?? null)
          : null;
        if (
          isCloudGroupId(groupId) &&
          !workspaceHashRef.current
        )
          workspaceUploadRequiredGroupsRef.current.add(groupId);
        groupConfigurationHashRef.current = isCloudGroupId(groupId)
          ? (groupConfigurationAckHashesRef.current.get(groupId) ?? null)
          : null;
        replaceState(next);
        if (isCloudGroupId(groupId)) hydrateGroupInBackground(groupId);
      },
      leaveGroup: async (groupId) => {
        const before = stateRef.current;
        const leavingGroup = before.groups.find(
          (group) => group.id === groupId,
        );
        if (!leavingGroup)
          throw new Error("That group is no longer available.");
        if (isPersonalSetupGroup(leavingGroup) || !isCloudGroupId(groupId))
          throw new Error("Personal setup is private and cannot be left.");
        const leavingMember = leavingGroup.members.find(
          (member) => member.id === before.currentUserId,
        );
        if (!leavingMember)
          throw new Error("Your membership is no longer available.");
        let remaining = before.groups.filter(
          (group) => group.id !== groupId,
        );
        if (!remaining.length)
          remaining = [
            createPersonalSetupGroup(
              leavingMember,
              personalSetupMetricConfiguration(
                before.metrics,
                before.trackedGoalPeriods,
              ),
            ),
          ];
        const nextGroup =
          before.group.id === groupId ? remaining[0] : before.group;
        const next = stateWithActiveGroup(before, nextGroup, remaining);
        stateRef.current = next;
        workspaceHashRef.current = isCloudGroupId(nextGroup.id)
          ? (workspaceAckHashesRef.current.get(nextGroup.id) ?? null)
          : null;
        if (
          isCloudGroupId(nextGroup.id) &&
          !workspaceHashRef.current
        )
          workspaceUploadRequiredGroupsRef.current.add(nextGroup.id);
        groupConfigurationHashRef.current = isCloudGroupId(nextGroup.id)
          ? (groupConfigurationAckHashesRef.current.get(nextGroup.id) ?? null)
          : null;
        replaceState(next);
        try {
          await sendMembershipPush({
            groupId,
            eventKey: `membership-left:${groupId}:${before.currentUserId}:${Date.now()}`,
            audience: "admins",
            title: `${leavingMember?.name ?? "A member"} left`,
            body: `${leavingMember?.name ?? "A member"} left ${leavingGroup.name}.`,
            route: "/group-settings",
          }).catch(() => undefined);
          await leaveCloudGroup(groupId);
          setPendingChanges(true);
          if (isCloudGroupId(nextGroup.id))
            hydrateGroupInBackground(nextGroup.id);
        } catch (error) {
          stateRef.current = before;
          replaceState(before);
          throw error;
        }
      },
      refreshGroup,
      refreshActivity: () => {
        const groupId = stateRef.current.group.id;
        // A deliberate user refresh is also the mixed-version escape hatch:
        // older installed clients do not publish activity commit versions.
        activityVersionByGroupRef.current.delete(groupId);
        activityCoverageSinceByGroupRef.current.delete(groupId);
        return refreshGroupActivity(
          dateWithOffsetFrom(
            dateKey(),
            -(GROUP_ACTIVITY_LOCAL_CACHE_DAYS - 1),
          ),
        );
      },
      refreshMessages,
      syncMessagesNow: async (messageId) => {
        await pushCloudMessagesNow(stateRef.current, messageId);
      },
      approveMember: async (userId) => {
        const groupId = stateRef.current.group.id;
        await approveCloudGroupMember(groupId, userId);
        const live = stateRef.current;
        const optimistic = applyMembershipRealtimeRow(live, {
          group_id: groupId,
          user_id: userId,
          status: "active",
        });
        if (optimistic && optimistic !== live) {
          stateRef.current = optimistic;
          replaceState(optimistic);
        }
        await sendMembershipPush({
          groupId,
          eventKey: `membership-approved:${groupId}:${userId}`,
          audience: "user",
          recipientId: userId,
          title: `Welcome to ${stateRef.current.group.name}`,
          body: `Your request was approved. Tap to open the group.`,
          route: "/group",
        }).catch(() => undefined);
        refreshGroup().catch(() => undefined);
      },
      removeMember: async (userId) => {
        await sendMembershipPush({
          groupId: stateRef.current.group.id,
          eventKey: `membership-removed:${stateRef.current.group.id}:${userId}:${Date.now()}`,
          audience: "user",
          recipientId: userId,
          title: `Group membership updated`,
          body: `You were removed from ${stateRef.current.group.name}.`,
          route: "/groups",
        }).catch(() => undefined);
        const groupId = stateRef.current.group.id;
        await removeCloudGroupMember(groupId, userId);
        const live = stateRef.current;
        const activeGroup = live.groups.find((group) => group.id === groupId);
        if (activeGroup) {
          const nextGroup = {
            ...activeGroup,
            members: activeGroup.members.filter(
              (member) => member.id !== userId,
            ),
            pendingMembers: (activeGroup.pendingMembers ?? []).filter(
              (member) => member.id !== userId,
            ),
          };
          const next = {
            ...live,
            group: live.group.id === groupId ? nextGroup : live.group,
            groups: live.groups.map((group) =>
              group.id === groupId ? nextGroup : group,
            ),
          };
          stateRef.current = next;
          replaceState(next);
        }
        refreshGroup().catch(() => undefined);
      },
    }),
    [
      auth.user,
      devices,
      errorMessage,
      lastSyncedAt,
      loadDevices,
      pendingChanges,
      pendingGroup,
      performSync,
      pullLatest,
      refreshGroup,
      refreshGroupActivity,
      refreshMessages,
      hydrateGroupInBackground,
      replaceState,
      status,
    ],
  );

  // Action-only consumers (Chat, Leaderboard, group administration) should not
  // redraw their large lists whenever a background sync updates a timestamp or
  // retry flag. Stable proxies always call the newest provider implementation.
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const actions = useMemo<CloudSyncActions>(
    () => ({
      syncNow: () => latestValueRef.current.syncNow(),
      pullLatest: () => latestValueRef.current.pullLatest(),
      refreshDevices: () => latestValueRef.current.refreshDevices(),
      forgetDevice: (deviceId) => latestValueRef.current.forgetDevice(deviceId),
      deleteAccount: () => latestValueRef.current.deleteAccount(),
      createGroup: (name, options) =>
        latestValueRef.current.createGroup(name, options),
      joinGroup: (code) => latestValueRef.current.joinGroup(code),
      switchGroup: (groupId) => latestValueRef.current.switchGroup(groupId),
      leaveGroup: (groupId) => latestValueRef.current.leaveGroup(groupId),
      refreshGroup: () => latestValueRef.current.refreshGroup(),
      refreshActivity: () => latestValueRef.current.refreshActivity(),
      refreshMessages: () => latestValueRef.current.refreshMessages(),
      syncMessagesNow: (messageId) =>
        latestValueRef.current.syncMessagesNow(messageId),
      approveMember: (userId) =>
        latestValueRef.current.approveMember(userId),
      removeMember: (userId) => latestValueRef.current.removeMember(userId),
    }),
    [],
  );

  return (
    <CloudSyncStatusContext.Provider value={status}>
      <CloudSyncActionsContext.Provider value={actions}>
        <CloudSyncContext.Provider value={value}>
          {children}
        </CloudSyncContext.Provider>
      </CloudSyncActionsContext.Provider>
    </CloudSyncStatusContext.Provider>
  );
}

export function useCloudSync() {
  const context = useContext(CloudSyncContext);
  if (!context)
    throw new Error("useCloudSync must be used inside CloudSyncProvider");
  return context;
}

/** Stable cloud commands without subscribing the caller to sync status. */
export function useCloudSyncActions() {
  const context = useContext(CloudSyncActionsContext);
  if (!context)
    throw new Error("useCloudSyncActions must be used inside CloudSyncProvider");
  return context;
}

/** Lightweight status subscription for refresh controls and small indicators. */
export function useCloudSyncStatus() {
  return useContext(CloudSyncStatusContext);
}
