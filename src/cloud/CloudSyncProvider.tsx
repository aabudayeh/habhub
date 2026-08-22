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
  ActivityIndicator,
  AppState as NativeAppState,
  InteractionManager,
  Platform,
  View,
} from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import {
  approveCloudGroupMember,
  type CloudActivityMetadata,
  createCloudGroup,
  flushPendingGroupPushEvents,
  hasActiveCloudGroupMembership,
  isCloudGroupId,
  joinCloudGroup,
  leaveCloudGroup,
  loadCloudGroupActivity,
  loadCloudGroupShells,
  loadCloudMessages,
  loadCloudWorkspace,
  removeCloudGroupMember,
  touchCloudGroupPresence,
  pushCloudRecentActivity,
  pushCloudAccountMetadata,
  pushCloudWorkspace,
  pushCloudMessagesNow,
} from "@/src/cloud/groupCloud";
import { createInitialState } from "@/src/data/seed";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  accountMemberProfile,
  applyAccountMemberProfile,
  type AccountMemberProfile,
  mergeAccountMemberProfile,
  profileProjectionLagsSnapshot,
} from "@/src/domain/accountProfile";
import { metricEntryKey } from "@/src/domain/metricEntry";
import {
  metricIdsForHealthDataTypes,
  reconcileGoogleHealthNativeMirrors,
} from "@/src/domain/health";
import { mergeLocalCurrentDayDeviceStepEntries } from "@/src/domain/healthDedup";
import { applySharedMetricPrivacyFences } from "@/src/domain/sharedMetricPrivacy";
import {
  applyGoogleHealthEntryOverrides,
  isGoogleHealthEntry,
  isGoogleHealthEntryId,
  stateWithoutGoogleHealthLocalData,
  withoutGoogleHealthDerivedStatuses,
} from "@/src/domain/googleHealthLocalPrivacy";
import { cloudAccountEnergyProjection } from "@/src/domain/energy";
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
import { translateUiText } from "@/src/i18n";
import {
  getPrivacyAwareUserSnapshot,
  getPrivacyAwareUserSnapshotMetadata,
  isGoogleHealthPrivacyUpgradeError,
  privacyAwareSnapshotTopic,
  type PrivacyAwareSnapshotMetadata,
  type PrivacyAwareSnapshotRow,
  syncPrivacyAwareUserSnapshot,
} from "@/src/cloud/snapshotPrivacy";
import {
  readPersistedAccountState,
  useApp,
} from "@/src/state/AppProvider";
import { AppStateStorageReadError } from "@/src/storage/appStateStorage";
import {
  purgeLegacyGroupActivityCaches,
  readGroupActivityCache,
  removeGroupActivityCache,
  writeGroupActivityCache,
} from "@/src/storage/groupActivityCache";
import { onboardingCompletedLocally } from "@/src/storage/onboardingState";
import {
  getLargeStorageItem,
  multiRemoveLargeStorage,
  setLargeStorageItem,
} from "@/src/storage/durableLargeStorage";
import {
  AppState,
  ChatMessage,
  Group,
  GroupCreationOptions,
  Member,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";
import {
  isCloudSyncPaused,
  subscribeCloudSyncPause,
} from "@/src/cloud/syncGate";
import {
  AUTO_SYNC_MAX_INTERACTION_WAIT_MS,
  nextAutoSyncDelay,
} from "@/src/cloud/autoSyncTiming";
import {
  cloudConflictBackoffActive,
  type CloudConflictGate,
  nextCloudConflictGate,
} from "@/src/domain/cloudConflict";
import {
  orderedValueHash,
  stableValueHash,
} from "@/src/domain/cloudHash";
import { networkReachability } from "@/src/domain/network";
import { accountOwnedCollections } from "@/src/domain/accountCollections";
import {
  canBootstrapCloudSnapshotCursor,
  cloudSnapshotCursorForAcknowledgement,
  cloudSnapshotCursorMatches,
  type CloudSnapshotCursor,
} from "@/src/domain/cloudSnapshotCursor";
import {
  scheduleResponsiveWork,
  waitForResponsiveTurn,
} from "@/src/lib/responsiveWork";
import { subscribeUserInteraction } from "@/src/lib/userInteraction";

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
const CLOUD_SNAPSHOT_CURSOR_KEY_PREFIX = "habhub-cloud-snapshot-cursor-v1:";
const CLOUD_MERGE_BASE_KEY_PREFIX = "habhub-cloud-merge-base-v4:";
const LEGACY_CLOUD_MERGE_BASE_KEY_PREFIXES = [
  "habhub-cloud-merge-base-v2:",
  "habhub-cloud-merge-base-v3:",
] as const;
const GOOGLE_HEALTH_CLOUD_CACHE_SCRUB_KEY =
  "habhub-google-health-cloud-cache-scrub-v2";
const ACCOUNT_METADATA_ACK_KEY_PREFIX = "habhub-account-metadata-ack-v1:";
const MAX_CLOUD_RETRY_MS = 5 * 60 * 1000;
const MAX_GROUP_READ_RETRY_MS = 2 * 60 * 1000;
const MAX_SURFACE_READ_RETRY_MS = 60 * 1000;
const CHAT_OUTBOX_RECOVERY_LIMIT = 200;
const CHAT_OUTBOX_AUTOMATIC_RETRY_LIMIT = 5;
const LEADERBOARD_FRESHNESS_INTERVAL_MS = 5 * 60 * 1000;

function mergeQueuedActivitySince(
  current: string | null | undefined,
  failed: string | null,
) {
  if (current === undefined || failed === null) return failed;
  if (current === null) return null;
  return failed < current ? failed : current;
}

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
  refreshActivity: (sinceDate?: string) => Promise<void>;
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

type SnapshotRow = PrivacyAwareSnapshotRow<AppState>;
type SnapshotMetadata = PrivacyAwareSnapshotMetadata;

type CloudMergeBase = {
  version: 2;
  accountProfile?: AccountMemberProfile | null;
  settings: Record<string, string>;
  collections: Record<string, Record<string, string>>;
};

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);
const CloudSyncActionsContext = createContext<CloudSyncActions | null>(null);
const CloudSyncStatusContext = createContext<CloudSyncStatus>("disabled");

const disabledCloudAction = async () => undefined;
const disabledCloudContext: CloudSyncContextValue = {
  status: "disabled",
  lastSyncedAt: null,
  errorMessage: null,
  pendingChanges: false,
  pendingGroup: null,
  devices: [],
  syncNow: disabledCloudAction,
  pullLatest: disabledCloudAction,
  refreshDevices: disabledCloudAction,
  forgetDevice: disabledCloudAction,
  deleteAccount: disabledCloudAction,
  createGroup: disabledCloudAction,
  joinGroup: async () => "active",
  switchGroup: disabledCloudAction,
  leaveGroup: disabledCloudAction,
  refreshGroup: disabledCloudAction,
  refreshActivity: disabledCloudAction,
  refreshMessages: disabledCloudAction,
  syncMessagesNow: disabledCloudAction,
  approveMember: disabledCloudAction,
  removeMember: disabledCloudAction,
};

/** Shadows live cloud providers for real routes rendered in tutorial practice. */
export function TutorialCloudSyncBoundary({ children }: PropsWithChildren) {
  return (
    <CloudSyncStatusContext.Provider value="disabled">
      <CloudSyncActionsContext.Provider value={disabledCloudContext}>
        <CloudSyncContext.Provider value={disabledCloudContext}>
          {children}
        </CloudSyncContext.Provider>
      </CloudSyncActionsContext.Provider>
    </CloudSyncStatusContext.Provider>
  );
}

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

async function readCloudSnapshotCursor(userId: string) {
  try {
    const saved = await AsyncStorage.getItem(
      `${CLOUD_SNAPSHOT_CURSOR_KEY_PREFIX}${userId}`,
    );
    if (!saved) return null;
    const cursor = JSON.parse(saved) as CloudSnapshotCursor;
    return Number.isSafeInteger(cursor.revision) &&
      typeof cursor.updatedAt === "string" &&
      typeof cursor.acknowledgedHash === "string"
      ? cursor
      : null;
  } catch {
    return null;
  }
}

async function writeCloudSnapshotCursor(
  userId: string,
  metadata: SnapshotMetadata,
  acknowledgedHash: string,
) {
  await AsyncStorage.setItem(
    `${CLOUD_SNAPSHOT_CURSOR_KEY_PREFIX}${userId}`,
    JSON.stringify(
      cloudSnapshotCursorForAcknowledgement(metadata, acknowledgedHash),
    ),
  );
}

async function readAccountMetadataAck(userId: string) {
  return AsyncStorage.getItem(`${ACCOUNT_METADATA_ACK_KEY_PREFIX}${userId}`);
}

async function writeAccountMetadataAck(userId: string, hash: string) {
  await AsyncStorage.setItem(
    `${ACCOUNT_METADATA_ACK_KEY_PREFIX}${userId}`,
    hash,
  );
}

async function readCloudMergeBase(userId: string): Promise<CloudMergeBase | null> {
  try {
    await multiRemoveLargeStorage(
      LEGACY_CLOUD_MERGE_BASE_KEY_PREFIXES.map((prefix) => `${prefix}${userId}`),
    ).catch(() => undefined);
    const saved = await getLargeStorageItem(
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

function mergeBaseForLocalPersistence(
  base: CloudMergeBase,
  acknowledgedState: AppState,
) {
  const googleEntries = acknowledgedState.entries.filter(isGoogleHealthEntry);
  const googleEntryIds = new Set(googleEntries.map((entry) => entry.id));
  const googleEntryKeys = new Set(
    googleEntries.map((entry) => metricEntryKey(entry.userId, entry.id)),
  );
  const locallyCacheableStatuses = new Set(
    withoutGoogleHealthDerivedStatuses(
      acknowledgedState.entries,
      acknowledgedState.dailyMetricStatuses,
    ).map(dailyStatusKey),
  );
  const sanitizedState = stateWithoutGoogleHealthLocalData(acknowledgedState);
  const settings = { ...base.settings };
  const collections = { ...base.collections };
  // Provider ids embed metric/date information and override values contain a
  // health-event timestamp. Neither belongs in this plaintext merge base.
  delete settings.googleHealthEntryOverrides;
  settings.pendingDeletedEntryIds = stableValueHash(
    sanitizedState.settings.pendingDeletedEntryIds,
  );
  settings.deletedEntryIds = stableValueHash(
    sanitizedState.settings.deletedEntryIds,
  );
  settings.dismissedHealthEntryIds = stableValueHash(
    sanitizedState.settings.dismissedHealthEntryIds,
  );
  collections.entries = Object.fromEntries(
    Object.entries(collections.entries ?? {}).filter(
      ([entryKey]) =>
        !googleEntryKeys.has(entryKey) &&
        !isGoogleHealthEntryId(entryKey.slice(entryKey.indexOf(":") + 1)),
    ),
  );
  collections.dailyMetricStatuses = Object.fromEntries(
    Object.entries(collections.dailyMetricStatuses ?? {}).filter(
      ([statusKey]) => locallyCacheableStatuses.has(statusKey),
    ),
  );
  const withoutGoogleIntentKeys = (record: Record<string, string> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).filter(
        ([entryId]) =>
          !googleEntryIds.has(entryId) && !isGoogleHealthEntryId(entryId),
      ),
    );
  collections.pendingDeletedEntryIds = withoutGoogleIntentKeys(
    collections.pendingDeletedEntryIds,
  );
  collections.deletedEntryIds = withoutGoogleIntentKeys(
    collections.deletedEntryIds,
  );
  collections.dismissedHealthEntryIds = withoutGoogleIntentKeys(
    collections.dismissedHealthEntryIds,
  );
  return { ...base, settings, collections };
}

async function writeCloudMergeBase(
  userId: string,
  base: CloudMergeBase,
  acknowledgedState: AppState,
) {
  await setLargeStorageItem(
    `${CLOUD_MERGE_BASE_KEY_PREFIX}${userId}`,
    JSON.stringify({
      ...mergeBaseForLocalPersistence(base, acknowledgedState),
      writtenAt: new Date().toISOString(),
    }),
  );
}

let googleHealthCloudCacheScrubPromise: Promise<void> | undefined;

function purgeLegacyGoogleHealthCloudCaches() {
  if (googleHealthCloudCacheScrubPromise)
    return googleHealthCloudCacheScrubPromise;
  googleHealthCloudCacheScrubPromise = (async () => {
    if (
      (await AsyncStorage.getItem(GOOGLE_HEALTH_CLOUD_CACHE_SCRUB_KEY)) ===
      "done"
    )
      return;
    const keys = (await AsyncStorage.getAllKeys()).filter(
      (key) =>
        LEGACY_CLOUD_MERGE_BASE_KEY_PREFIXES.some((prefix) =>
          key.startsWith(prefix),
        ) ||
        key.startsWith(WORKSPACE_ACK_KEY_PREFIX) ||
        key.startsWith(CLOUD_SNAPSHOT_ACK_KEY_PREFIX) ||
        key.startsWith(CLOUD_SNAPSHOT_CURSOR_KEY_PREFIX),
    );
    if (keys.length) await AsyncStorage.multiRemove(keys);
    await AsyncStorage.setItem(GOOGLE_HEALTH_CLOUD_CACHE_SCRUB_KEY, "done");
  })();
  return googleHealthCloudCacheScrubPromise;
}

function waitForCloudCacheWriteTurn() {
  if (NativeAppState.currentState !== "active") return Promise.resolve();
  return waitForResponsiveTurn({
    maximumDelayMs: 4_000,
    minimumUserQuietMs: 1_600,
  }).promise;
}

async function yieldCloudMaintenanceToUi() {
  if (
    Platform.OS === "web" ||
    NativeAppState.currentState !== "active"
  )
    return;
  const turn = waitForResponsiveTurn({
    minimumDelayMs: 12,
    maximumDelayMs: 360,
    minimumUserQuietMs: 1_600,
  });
  await turn.promise;
}

/**
 * Native cloud reads can return a large JSON body. Abort and restart an
 * automatic read when a new touch begins so response parsing/projection never
 * repeatedly lands in the middle of active navigation. Background execution
 * and web keep the ordinary one-shot request behavior.
 */
async function readCloudResponsively<T>(
  read: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  for (;;) {
    await yieldCloudMaintenanceToUi();
    const canAbortForTouch =
      Platform.OS !== "web" && NativeAppState.currentState === "active";
    const controller = canAbortForTouch ? new AbortController() : null;
    const unsubscribe = controller
      ? subscribeUserInteraction(() => controller.abort())
      : () => undefined;
    try {
      const result = await read(controller?.signal);
      // Storage-signing and compatibility helpers are not all abortable. A
      // touch that landed while one of them was pending still invalidates this
      // presentation turn; retry after quiet instead of parsing/merging now.
      if (controller?.signal.aborted) continue;
      return result;
    } catch (error) {
      if (!controller?.signal.aborted) throw error;
      // The touch is the new quiet-window boundary. Retry only after it ends.
    } finally {
      unsubscribe();
    }
  }
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
      version: 27,
      settings: { ...state.settings, fontScale: state.settings.fontScale ?? 1 },
    }, defaults, sourceVersion);
  if (sourceVersion >= 19)
    return upgradeStateV21({
      ...state,
      version: 27,
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
      version: 27,
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
    version: 27,
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

const snapshotPayloadCache = new WeakMap<AppState, AppState>();

/** Never persist temporary signed URLs; only stable private-bucket paths. */
function snapshotPayload(state: AppState): AppState {
  const cached = snapshotPayloadCache.get(state);
  if (cached) return cached;
  const owned = accountOwnedCollections(state);
  const groups = state.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      const {
        lastSeenAt: _presence,
        lastDataSyncedAt: _published,
        profileRevision: _profileRevision,
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
        profileRevision: _profileRevision,
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
          profileRevision: _profileRevision,
          ...stableMember
        } = member;
        return stableMember;
      }),
    };
  const payload: AppState = {
    ...state,
    // These flags describe a native import cursor on this physical device.
    // Syncing them to another phone could start (or finish) the wrong Health
    // Connect backfill there.
    settings: {
      ...state.settings,
      // This is a device-local outbox marker. Uploading it could make another
      // device push stale group settings on this device's behalf.
      pendingGroupConfigurationIds: undefined,
      // Privacy fence publication is also a device-local relational outbox.
      pendingMetricPrivacyFenceIdsByGroup: undefined,
      // Disclosure state follows this device and must not create an account
      // sync just because another screen size uses a different layout.
      progressGridDateNavigatorCollapsed: undefined,
      healthSync: {
        ...state.settings.healthSync,
        enabled: false,
        backgroundAccess: false,
        // Installed writer packages and enable/disable choices differ per
        // phone. Keep them in the offline device snapshot, not the account.
        sourcePreferences: undefined,
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
    entries: owned.entries.map((entry) =>
      entry.imageStoragePath ? { ...entry, imageUri: undefined } : entry,
    ),
    photos: owned.photos.map((photo) =>
      photo.storagePath ? { ...photo, uri: "" } : photo,
    ),
    // Group history is cached locally and reloaded from the relational table.
    // Keeping only owned messages in the private snapshot makes hashing and
    // account sync independent of a busy group chat.
    messages: owned.messages.map((message) =>
      message.imageStoragePath ? { ...message, imageUri: undefined } : message,
    ),
    dailyMetricStatuses: owned.dailyMetricStatuses,
    lastSavedAt: null,
  };
  snapshotPayloadCache.set(state, payload);
  return payload;
}

function messageBelongsToCloudGroup(
  message: ChatMessage,
  groupId: string,
) {
  return (
    message.groupId === groupId ||
    message.conversationId === `group:${groupId}`
  );
}

/** Drop every value/media handle authorized only by a departed group. */
function purgeDepartedGroupData(state: AppState, departed: Group): AppState {
  return {
    ...state,
    // Entries do not carry a group id, and a stale shell may already omit an
    // old member or metric. Keep only owned rows; the next authorized group's
    // scoped cache restores any peer rows that still belong on this device.
    entries: state.entries.filter(
      (entry) => entry.userId === state.currentUserId,
    ),
    dailyMetricStatuses: state.dailyMetricStatuses.filter(
      (status) => status.groupId !== departed.id,
    ),
    // PhotoUpdate has no group id; retaining any peer photo across membership
    // loss can preserve a signed URL after its RLS authorization disappears.
    photos: state.photos.filter(
      (photo) => photo.userId === state.currentUserId,
    ),
    messages: state.messages.filter(
      (message) => !messageBelongsToCloudGroup(message, departed.id),
    ),
  };
}

function hashRecord(record: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, value]) => [
      key,
      stableValueHash(value),
    ]),
  );
}

function hashCollection<T>(
  items: T[] | undefined,
  keyFor: (item: T) => string,
) {
  return Object.fromEntries(
    (items ?? []).map((item) => [keyFor(item), stableValueHash(item)]),
  );
}

async function hashLargeCollectionResponsively<T>(
  items: T[] | undefined,
  keyFor: (item: T) => string,
  shouldContinue: () => boolean,
) {
  const result: Record<string, string> = {};
  const rows = items ?? [];
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    result[keyFor(item)] = stableValueHash(item);
    if ((index + 1) % 1_500 !== 0 || index + 1 >= rows.length) continue;
    if (!shouldContinue()) return null;
    if (NativeAppState.currentState !== "active") continue;
    const turn = waitForResponsiveTurn({
      minimumDelayMs: 8,
      maximumDelayMs: 280,
      minimumUserQuietMs: 1_600,
    });
    await turn.promise;
  }
  return shouldContinue() ? result : null;
}

/**
 * Compact three-way merge base for account fields commonly edited from both
 * mobile and the web companion. The entry/status maps can contain years of
 * imported Health history, so build those two maps cooperatively instead of
 * monopolizing Android's JS thread while the user is navigating.
 */
async function createCloudMergeBaseResponsively(
  state: AppState,
  shouldContinue: () => boolean,
): Promise<CloudMergeBase | null> {
  const payload = snapshotPayload(state);
  if (!shouldContinue()) return null;
  const entries = await hashLargeCollectionResponsively(
    payload.entries,
    (item) => metricEntryKey(item.userId, item.id),
    shouldContinue,
  );
  if (!entries) return null;
  const dailyMetricStatuses = await hashLargeCollectionResponsively(
    payload.dailyMetricStatuses,
    dailyStatusKey,
    shouldContinue,
  );
  if (!dailyMetricStatuses) return null;
  const timers = payload.activityTimers?.length
    ? payload.activityTimers
    : payload.activeTimer
      ? [payload.activeTimer]
      : [];
  return {
    version: 2,
    accountProfile: accountMemberProfile(payload),
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
      entries,
      photos: hashCollection(
        payload.photos,
        (item) => `${item.userId}:${item.id}`,
      ),
      messages: hashCollection(payload.messages, (item) => item.id),
      dailyMetricStatuses,
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
const accountMetadataHashCache = new WeakMap<AppState, string>();

function stableHash(state: AppState) {
  const cached = stableHashCache.get(state);
  if (cached) return cached;
  // Snapshot acknowledgements/cursors are persisted in plaintext. Hash only
  // the cache-safe projection so their digest cannot fingerprint Google row
  // ids, values, dates, or per-entry overrides. Google imports are reconciled
  // by the server revision stream rather than by this local account outbox.
  const payload = snapshotPayload(stateWithoutGoogleHealthLocalData(state));
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
    "progressGridDateNavigatorCollapsed",
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
  const {
    entries,
    photos,
    messages,
    metrics,
    groups,
    gymPlans,
    gymSessions,
    todos,
    journalNotes,
    calendarReminders,
    activityTimers,
    dailyMetricStatuses: _dailyMetricStatuses,
    settings: _payloadSettings,
    group: _payloadGroup,
    ...compactPayload
  } = payload;
  const hash = stableValueHash({
    ...compactPayload,
    settings,
    // Hash large immutable collections item-by-item. Most rows retain object
    // identity across a one-entry Health/realtime update, so their cached
    // hashes are reused without re-stringifying years of history.
    entries: orderedValueHash(entries),
    photos: orderedValueHash(photos),
    messages: orderedValueHash(messages),
    metrics: orderedValueHash(metrics),
    gymPlans: orderedValueHash(gymPlans),
    gymSessions: orderedValueHash(gymSessions),
    todos: orderedValueHash(todos),
    journalNotes: orderedValueHash(journalNotes),
    calendarReminders: orderedValueHash(calendarReminders),
    activityTimers: orderedValueHash(activityTimers),
    // Keep owned summaries in the snapshot as an offline cache, but never let
    // their server-owned `updated_at` reopen the private account outbox.
    dailyMetricStatuses: [],
    // Cloud shells are reduced to ids below, so retain the account-owned
    // identity explicitly in the private revision stream.
    accountProfile: accountMemberProfile(payload),
    // Cloud group shells are hydrated from relational tables. Membership,
    // invites and admin-owned configuration changing on the server is not a
    // private account edit and must not re-open this device's outbox.
    group: groupShell(payload.group),
    groups: orderedValueHash(groups.map(groupShell)),
    selectedGroupMetricId: undefined,
  });
  stableHashCache.set(state, hash);
  return hash;
}

/** Small relational projection shared by every group and every device. */
function accountMetadataHash(state: AppState) {
  const cached = accountMetadataHashCache.get(state);
  if (cached) return cached;
  const hash = stableValueHash({
    profile: accountMemberProfile(state),
    energyProfile: cloudAccountEnergyProjection(
      state.energyProfiles[state.currentUserId] ??
        state.settings.energyProfile,
    ),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  accountMetadataHashCache.set(state, hash);
  return hash;
}

/** Only data represented by relational group tables belongs in a group push. */
function workspaceHash(state: AppState) {
  const cached = workspaceHashCache.get(state);
  if (cached) return cached;
  const payload = snapshotPayload(state);
  const hash = stableValueHash({
    currentUserId: payload.currentUserId,
    groupId: payload.group.id,
    // Profile and energy data use their own small global projection. Keeping
    // them out of this hash prevents a rename from uploading a year of group
    // activity or reopening the outbox once for every joined group.
    aliases: payload.settings.memberNicknamesByGroup[payload.group.id] ?? {},
    entries: orderedValueHash(payload.entries),
    photos: orderedValueHash(payload.photos),
    pendingPrivacyFences:
      state.settings.pendingMetricPrivacyFenceIdsByGroup?.[
        payload.group.id
      ] ?? [],
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

function workspaceAckMayPersist(state: AppState) {
  return !state.entries.some(
    (entry) =>
      entry.userId === state.currentUserId && isGoogleHealthEntry(entry),
  );
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
    const remoteHash = remoteHas
      ? stableValueHash(remoteRecord[key])
      : undefined;
    const localHash = localHas
      ? stableValueHash(localRecord[key])
      : undefined;
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
    const remoteHash = remoteItem ? stableValueHash(remoteItem) : undefined;
    const localHash = localItem ? stableValueHash(localItem) : undefined;
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

function mergeEntriesFromBase(
  remote: MetricEntry[] | undefined,
  local: MetricEntry[] | undefined,
  baseHashes?: Record<string, string>,
) {
  const merged = mergeCollectionFromBase(
    remote,
    local,
    (entry) => metricEntryKey(entry.userId, entry.id),
    baseHashes,
  );
  const byKey = new Map(
    merged.map((entry) => [metricEntryKey(entry.userId, entry.id), entry]),
  );
  const remoteKeys = new Set(
    (remote ?? []).map((entry) => metricEntryKey(entry.userId, entry.id)),
  );
  for (const entry of remote ?? []) {
    if (!isGoogleHealthEntry(entry)) continue;
    const key = metricEntryKey(entry.userId, entry.id);
    // The server import remains authoritative for raw/provider fields even
    // when this process still has an in-memory merge base. User-selected time
    // and visibility live in the separate minimal override registry and are
    // replayed after this merge.
    byKey.set(key, entry);
  }
  for (const entry of local ?? []) {
    if (!isGoogleHealthEntry(entry)) continue;
    const key = metricEntryKey(entry.userId, entry.id);
    if (!remoteKeys.has(key)) byKey.delete(key);
  }
  return [...byKey.values()];
}

function preserveLocalCurrentDayDeviceSteps(
  incoming: AppState,
  local: AppState,
): AppState {
  if (incoming.currentUserId !== local.currentUserId) return incoming;
  const entries = mergeLocalCurrentDayDeviceStepEntries(
    incoming.entries,
    local.entries,
    {
      userId: local.currentUserId,
      currentLocalDate: dateKey(),
      stepMetricIds: new Set(
        metricIdsForHealthDataTypes(["steps"], local.metrics),
      ),
    },
  );
  return entries === incoming.entries ? incoming : { ...incoming, entries };
}

function mergeStates(
  remote: AppState,
  local: AppState,
  base?: CloudMergeBase | null,
): AppState {
  const groups = mergeById(remote.groups, local.groups);
  const profile = mergeAccountMemberProfile(
    accountMemberProfile(remote),
    accountMemberProfile(local),
    base?.accountProfile,
  );
  const onboardingComplete =
    remote.settings.onboardingComplete ||
    local.settings.onboardingComplete;
  const tutorialComplete =
    remote.settings.tutorialComplete ||
    local.settings.tutorialComplete;
  const advancedTutorialComplete =
    remote.settings.advancedTutorialComplete ||
    local.settings.advancedTutorialComplete;
  const settings = mergeRecordFromBase(
    remote.settings as unknown as Record<string, unknown>,
    local.settings as unknown as Record<string, unknown>,
    base?.settings,
  ) as unknown as AppState["settings"];
  settings.onboardingComplete = onboardingComplete;
  settings.onboardingVersion = Math.max(
    remote.settings.onboardingVersion ?? 0,
    local.settings.onboardingVersion ?? 0,
  );
  settings.tutorialComplete = tutorialComplete;
  settings.advancedTutorialComplete = advancedTutorialComplete;
  settings.progressGridDateNavigatorCollapsed =
    local.settings.progressGridDateNavigatorCollapsed;
  // Google entry mutations are applied locally only after authenticated server
  // acknowledgement. On every pull, the protected owner snapshot is therefore
  // the authority for which fields are explicit preferences; a time-only local
  // edit must never manufacture or preserve an inherited visibility override.
  settings.googleHealthEntryOverrides =
    remote.settings.googleHealthEntryOverrides;
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
  const merged: AppState = {
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
    entries: mergeEntriesFromBase(
      remote.entries,
      local.entries,
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
  const withGoogleHealthOverrides = {
    ...merged,
    entries: applyGoogleHealthEntryOverrides(
      merged.entries,
      merged.settings.googleHealthEntryOverrides,
      local.currentUserId,
      merged.metrics,
    ),
  };
  const withNativeGoogleOwnership = {
    ...withGoogleHealthOverrides,
    entries: reconcileGoogleHealthNativeMirrors(
      withGoogleHealthOverrides.entries,
      withGoogleHealthOverrides.metrics,
      withGoogleHealthOverrides.settings.healthSync.sourcePreferences,
      local.currentUserId,
    ),
  };
  return preserveLocalCurrentDayDeviceSteps(
    applyAccountMemberProfile(withNativeGoogleOwnership, profile),
    local,
  );
}

/** Native authorization and transient UI state belong to this device. */
function preserveDeviceSettings(
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
      progressGridDateNavigatorCollapsed:
        local.settings.progressGridDateNavigatorCollapsed,
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
  const remoteWithDeviceSettings = preserveDeviceSettings(remote, local);
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
  const acceptedOwnedEntries = mergeLocalCurrentDayDeviceStepEntries(
    remoteWithDeviceSettings.entries.filter(
      (entry) => entry.userId === userId,
    ),
    local.entries,
    {
      userId: local.currentUserId,
      currentLocalDate: dateKey(),
      stepMetricIds: new Set(
        metricIdsForHealthDataTypes(["steps"], local.metrics),
      ),
    },
  );
  const accepted: AppState = {
    ...remoteWithDeviceSettings,
    group: activeGroup,
    groups,
    selectedGroupMetricId:
      remoteWithDeviceSettings.group.id === local.group.id
        ? local.selectedGroupMetricId
        : remoteWithDeviceSettings.selectedGroupMetricId,
    entries: [...acceptedOwnedEntries, ...keepForeign(local.entries)],
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
  accepted.entries = applyGoogleHealthEntryOverrides(
    accepted.entries,
    accepted.settings.googleHealthEntryOverrides,
    userId,
    accepted.metrics,
  );
  accepted.entries = reconcileGoogleHealthNativeMirrors(
    accepted.entries,
    accepted.metrics,
    accepted.settings.healthSync.sourcePreferences,
    userId,
  );
  // Cloud group shells are retained as a relational activity cache, but the
  // signed-in member's account identity belongs to the accepted snapshot. If
  // this is omitted, a clean second device can publish its stale cached name
  // back over the newly saved one.
  return applyAccountMemberProfile(
    accepted,
    accountMemberProfile(remoteWithDeviceSettings),
  );
}

type MembershipRealtimeRow = {
  group_id?: string;
  user_id?: string;
  role?: Member["role"];
  status?: "active" | "pending";
  last_seen_at?: string;
  last_data_synced_at?: string;
};

type ProfileRealtimeRow = {
  id?: string;
  display_name?: string;
  avatar_path?: string | null;
  account_revision?: number;
};

function applyProfileRealtimeRow(
  state: AppState,
  row: ProfileRealtimeRow,
): AppState | null {
  const userId = row.id;
  const name = row.display_name?.trim();
  const revision = Number(row.account_revision);
  if (!userId || !name) return null;
  let changed = false;
  const updateGroup = (group: Group) => {
    let groupChanged = false;
    const updateMember = (member: Member) => {
      if (member.id !== userId) return member;
      if (
        Number.isSafeInteger(revision) &&
        Number.isSafeInteger(member.profileRevision) &&
        revision < Number(member.profileRevision)
      )
        return member;
      const avatarStoragePath = row.avatar_path ?? undefined;
      const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase();
      if (
        member.name === name &&
        member.initials === initials &&
        member.avatarStoragePath === avatarStoragePath &&
        (!Number.isSafeInteger(revision) ||
          member.profileRevision === revision)
      )
        return member;
      changed = true;
      groupChanged = true;
      return {
        ...member,
        name,
        initials,
        avatarStoragePath,
        avatarUri:
          member.avatarStoragePath === avatarStoragePath
            ? member.avatarUri
            : undefined,
        profileRevision: Number.isSafeInteger(revision)
          ? revision
          : member.profileRevision,
      };
    };
    const members = group.members.map(updateMember);
    const pendingMembers = group.pendingMembers?.map(updateMember);
    return groupChanged ? { ...group, members, pendingMembers } : group;
  };
  const groups = state.groups.map(updateGroup);
  const group =
    groups.find((candidate) => candidate.id === state.group.id) ??
    updateGroup(state.group);
  return changed ? { ...state, groups, group } : state;
}

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
  return stableValueHash({
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
  preserveLocalAccountProfile = false,
  minimumAccountProfileRevision?: number,
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
      adaptiveGoalTarget: metric.adaptiveGoalTarget,
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
  const remoteCurrentMember = remote.group.members.find(
    (member) => member.id === live.currentUserId,
  );
  const remoteProfileRevision = Number(remoteCurrentMember?.profileRevision);
  const remoteProfileLagsSnapshot = profileProjectionLagsSnapshot(
    remoteProfileRevision,
    minimumAccountProfileRevision,
  );
  const selectedAccountProfile =
    preserveLocalAccountProfile || remoteProfileLagsSnapshot
    ? accountMemberProfile(live)
    : (accountMemberProfile(remote) ?? accountMemberProfile(live));
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
  const remoteGroup = remoteGroupBase;
  // The remote workspace already merged the authorized bounded snapshot with
  // its fence-filtered older history. Only owned local outbox rows may overlay
  // it here; re-seeding live peer rows would resurrect revoked data.
  const cachedEntries = live.entries.filter(
    (entry) => entry.userId === live.currentUserId,
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
    live.dailyMetricStatuses.filter(
      (status) => status.userId === live.currentUserId,
    ),
    remote.dailyMetricStatuses,
  );
  const merged: AppState = {
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
  return applyAccountMemberProfile(merged, selectedAccountProfile);
}

async function fetchSnapshot(
  _userId: string,
  signal?: AbortSignal,
): Promise<SnapshotRow | null> {
  if (!supabase) return null;
  return getPrivacyAwareUserSnapshot<AppState>(supabase, signal);
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
  return syncPrivacyAwareUserSnapshot(
    supabase,
    payload,
    expectedRevision,
    deviceId,
  );
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
  if (isGoogleHealthPrivacyUpgradeError(error))
    return "This HabHub version cannot safely sync Google Health data. Update HabHub to continue.";
  if (
    Platform.OS === "web" &&
    /quota has been exceeded|QuotaExceededError|storage quota/i.test(message)
  )
    return "This browser could not save another offline copy. Your cloud data is still protected; reopen HabHub after freeing browser storage so it can retry.";
  if (isTransientCloudError(message))
    return "Offline changes are safe on this device and will retry automatically.";
  if (/column.*revision|sync_user_snapshot|schema cache/i.test(message))
    return "Apply the latest Supabase migrations before enabling cloud sync.";
  return message || "Cloud sync failed. Your local data is still safe.";
}

async function fetchSnapshotMetadata(
  _userId: string,
): Promise<SnapshotMetadata | null> {
  if (!supabase) return null;
  // Deliberately omit payload. On established accounts this keeps normal
  // native cold start to a tiny capability-gated revision probe.
  return getPrivacyAwareUserSnapshotMetadata(supabase);
}

/**
 * PostgREST reports an exhausted/temporarily busy connection pool as PGRST003.
 * It is recoverable in the same way as a network timeout: keep the durable
 * device outbox, back off, and retry. Treating it as a permanent schema error
 * left otherwise healthy accounts stuck at Connecting/Needs attention.
 */
function isTransientCloudError(error: unknown) {
  const message = typeof error === "string" ? error : errorText(error);
  return /network|fetch|offline|timeout|timed out|PGRST003|connection pool|too many connections/i.test(
    message,
  );
}

function isDefinitiveGroupMembershipLoss(error: unknown) {
  if (isTransientCloudError(error)) return false;
  return /42501|not authorized|permission denied|group is unavailable|no longer have access|membership is no longer (?:active|available)/i.test(
    errorText(error),
  );
}

export function CloudSyncProvider({ children }: PropsWithChildren) {
  const {
    state,
    hydrated,
    localMutationRevision,
    replaceState,
    flushLocalPersistence,
    stageState,
  } = useApp();
  const auth = useAuth();
  const network = useNetInfo();
  const reachability = networkReachability(
    network.isConnected,
    network.isInternetReachable,
  );
  // Browser reachability is not consistently populated. Native cold starts,
  // however, must wait for a confirmed connection: nullable NetInfo fields
  // previously launched a long Supabase request in airplane mode. The cached
  // auth user is presentation-only, so remote work also waits for Supabase to
  // restore a real session.
  const networkAvailable =
    Boolean(auth.session) &&
    (reachability === "online" ||
      (Platform.OS === "web" && reachability === "unknown"));
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
  const [accountBoundaryReadyUserId, setAccountBoundaryReadyUserId] =
    useState<string | null>(null);
  const stateRef = useRef(state);
  const lastSyncedAtRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const hashRef = useRef<string | null>(null);
  const mergeBaseRef = useRef<CloudMergeBase | null>(null);
  const accountMetadataHashRef = useRef<string | null>(null);
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
  const groupReadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const groupReadRetryAttemptRef = useRef(0);
  const groupReadRetryGroupIdRef = useRef<string | null>(null);
  const groupReadRetryRunnerRef = useRef<
    ((groupId: string) => void) | null
  >(null);
  const messageReadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const messageReadRetryAttemptRef = useRef(0);
  const messageReadRetryGroupIdRef = useRef<string | null>(null);
  const messageReadRetryRunnerRef = useRef<
    ((groupId: string) => void) | null
  >(null);
  const activityReadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activityReadRetryAttemptRef = useRef(0);
  const activityReadRetryGroupIdRef = useRef<string | null>(null);
  const activityReadRetryRunnerRef = useRef<
    ((groupId: string) => void) | null
  >(null);
  const snapshotWriteTargetRevisionRef = useRef(0);
  const syncIsForcedRef = useRef(false);
  const performSyncRef = useRef<
    ((
      forceWorkspace?: boolean,
      forceAttempt?: boolean,
      manualAttempt?: boolean,
    ) => Promise<void>) | null
  >(null);
  const leaderboardPublishPromiseRef = useRef<Promise<void> | null>(null);
  const leaderboardPublishedAtByGroupRef = useRef(new Map<string, number>());
  const cloudRetryAttemptRef = useRef(0);
  const nextRetryAtRef = useRef(0);
  const workspaceConflictGateRef = useRef<CloudConflictGate | null>(null);
  const conflictRefreshRef = useRef<{
    userId: string;
    promise: Promise<SnapshotRow | null>;
  } | null>(null);
  const networkAvailableRef = useRef(networkAvailable);
  networkAvailableRef.current = networkAvailable;
  const previousNetworkAvailableRef = useRef(networkAvailable);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleSyncRef = useRef<{ cancel: () => void } | null>(null);
  const idleSyncFallbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const autoSyncFirstChangeAtRef = useRef<number | null>(null);
  const autoSyncLastChangeAtRef = useRef<number | null>(null);
  const suppressGroupRefreshUntilRef = useRef(0);
  const groupLoadSequenceRef = useRef(0);
  const activityLoadSequenceRef = useRef(0);
  const groupRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const messageRefreshPromiseRef = useRef<Promise<void> | null>(null);
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
  const chatOutboxBoundaryRef = useRef<string | null>(null);
  const chatOutboxSeenRef = useRef(new Set<string>());
  const chatOutboxInitializedGroupRef = useRef<string | null>(null);
  const chatOutboxPendingRef = useRef(new Set<string>());
  const chatOutboxAttemptsRef = useRef(new Map<string, number>());
  const chatOutboxPromiseRef = useRef<Promise<void> | null>(null);
  const chatRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const chatOutboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeBaseWriteRef = useRef<Promise<void>>(Promise.resolve());
  const mergeBaseBuildTaskRef = useRef<{ cancel: () => void } | null>(null);
  const mergeBaseBuildPromiseRef = useRef<Promise<void> | null>(null);
  const mergeBaseBuildGenerationRef = useRef(0);
  const mergeBaseBuiltGenerationRef = useRef(0);
  const pendingMergeBaseRef = useRef<{
    userId: string;
    state: AppState;
    generation: number;
  } | null>(null);
  const scheduleMergeBaseBuildRef = useRef<(() => void) | null>(null);
  const renderedStateRef = useRef(state);
  if (renderedStateRef.current !== state) {
    // Cloud replacements update `stateRef` before AppProvider schedules their
    // transition render. An unrelated urgent status render can happen first;
    // only a genuinely new provider state may replace that authoritative ref.
    renderedStateRef.current = state;
    stateRef.current = state;
  }

  useEffect(() => {
    // v2 merge bases and group-cache rows may predate Google provenance
    // filtering. Every active read is already fail-closed; defer the broad
    // migration sweep so parsing dormant group snapshots cannot contend with
    // launch/navigation taps. Signed-in ACK readers separately await their
    // small key-only scrub before loading hashes.
    let cancelled = false;
    const task = scheduleResponsiveWork(() => {
      if (cancelled) return;
      void Promise.all([
        purgeLegacyGoogleHealthCloudCaches(),
        purgeLegacyGroupActivityCaches(),
      ]).catch(() => undefined);
    }, {
      minimumDelayMs: 1_500,
      maximumDelayMs: 30_000,
      minimumUserQuietMs: 2_000,
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, []);

  const scheduleMergeBaseBuild = useCallback(() => {
    if (
      mergeBaseBuildTaskRef.current ||
      mergeBaseBuildPromiseRef.current ||
      !pendingMergeBaseRef.current
    )
      return;
    let started = false;
    const task = scheduleResponsiveWork(() => {
      started = true;
      mergeBaseBuildTaskRef.current = null;
      const pending = pendingMergeBaseRef.current;
      pendingMergeBaseRef.current = null;
      if (!pending) return;
      const current = () =>
        mergeBaseBuildGenerationRef.current === pending.generation &&
        stateRef.current.currentUserId === pending.userId;
      let operation: Promise<void>;
      operation = createCloudMergeBaseResponsively(pending.state, current)
        .then((base) => {
          if (!base || !current()) return;
          mergeBaseRef.current = base;
          mergeBaseBuiltGenerationRef.current = pending.generation;
          mergeBaseWriteRef.current = mergeBaseWriteRef.current
            .catch(() => undefined)
            .then(waitForCloudCacheWriteTurn)
            .then(() =>
              writeCloudMergeBase(pending.userId, base, pending.state),
            )
            .catch(() => undefined);
        })
        .catch(() => undefined)
        .finally(() => {
          if (mergeBaseBuildPromiseRef.current === operation)
            mergeBaseBuildPromiseRef.current = null;
          if (pendingMergeBaseRef.current)
            scheduleMergeBaseBuildRef.current?.();
        });
      mergeBaseBuildPromiseRef.current = operation;
    }, {
      minimumDelayMs: Platform.OS === "web" ? 0 : 120,
      maximumDelayMs: Platform.OS === "web" ? 1_000 : 2_800,
      minimumUserQuietMs: Platform.OS === "web" ? 0 : 1_600,
    });
    if (!started) mergeBaseBuildTaskRef.current = task;
    else task.cancel();
  }, []);
  scheduleMergeBaseBuildRef.current = scheduleMergeBaseBuild;

  const rememberCloudMergeBase = useCallback(
    (userId: string, acknowledgedState: AppState) => {
      const generation = mergeBaseBuildGenerationRef.current + 1;
      mergeBaseBuildGenerationRef.current = generation;
      pendingMergeBaseRef.current = {
        userId,
        state: acknowledgedState,
        generation,
      };
      scheduleMergeBaseBuildRef.current?.();
    },
    [],
  );

  const ensureLatestCloudMergeBase = useCallback(async (userId: string) => {
    // Normal acknowledgements stay off the interaction lane. A dirty pull or
    // revision conflict, however, must merge against the newest acknowledged
    // base; using the previous base can misclassify both sides as changed and
    // overwrite a newer remote edit. Force/drain only that rare correctness
    // path, and always let a cancelled generation settle before retrying.
    while (stateRef.current.currentUserId === userId) {
      const active = mergeBaseBuildPromiseRef.current;
      if (active) {
        await active;
        continue;
      }
      const pending = pendingMergeBaseRef.current;
      if (!pending || pending.userId !== userId) return;
      if (mergeBaseBuiltGenerationRef.current >= pending.generation) {
        pendingMergeBaseRef.current = null;
        return;
      }
      mergeBaseBuildTaskRef.current?.cancel();
      mergeBaseBuildTaskRef.current = null;
      pendingMergeBaseRef.current = null;
      const current = () =>
        mergeBaseBuildGenerationRef.current === pending.generation &&
        stateRef.current.currentUserId === pending.userId;
      let operation: Promise<void>;
      operation = createCloudMergeBaseResponsively(pending.state, current)
        .then((base) => {
          if (!base || !current()) return;
          mergeBaseRef.current = base;
          mergeBaseBuiltGenerationRef.current = pending.generation;
          mergeBaseWriteRef.current = mergeBaseWriteRef.current
            .catch(() => undefined)
            .then(waitForCloudCacheWriteTurn)
            .then(() =>
              writeCloudMergeBase(pending.userId, base, pending.state),
            )
            .catch(() => undefined);
        })
        .catch(() => undefined)
        .finally(() => {
          if (mergeBaseBuildPromiseRef.current === operation)
            mergeBaseBuildPromiseRef.current = null;
          if (pendingMergeBaseRef.current)
            scheduleMergeBaseBuildRef.current?.();
        });
      mergeBaseBuildPromiseRef.current = operation;
      await operation;
    }
  }, []);

  useEffect(
    () => () => {
      mergeBaseBuildGenerationRef.current += 1;
      mergeBaseBuiltGenerationRef.current = 0;
      pendingMergeBaseRef.current = null;
      mergeBaseBuildTaskRef.current?.cancel();
      mergeBaseBuildTaskRef.current = null;
    },
    [auth.user?.id],
  );

  const fetchConflictSnapshot = useCallback((userId: string) => {
    const active = conflictRefreshRef.current;
    if (active?.userId === userId) return active.promise;
    let promise: Promise<SnapshotRow | null>;
    promise = readCloudResponsively((signal) =>
      fetchSnapshot(userId, signal),
    ).finally(() => {
      if (conflictRefreshRef.current?.promise === promise)
        conflictRefreshRef.current = null;
    });
    conflictRefreshRef.current = { userId, promise };
    return promise;
  }, []);

  const scheduleWorkspaceConflictRetry = useCallback(
    (userId: string, observedRevision?: number) => {
      const gate = nextCloudConflictGate(
        workspaceConflictGateRef.current,
        userId,
        Date.now(),
        observedRevision,
      );
      workspaceConflictGateRef.current = gate;
      cloudRetryAttemptRef.current = gate.attempt;
      nextRetryAtRef.current = gate.retryAt;
      setNextRetryAt(gate.retryAt);
      return gate;
    },
    [],
  );

  const restoreWorkspaceConflictRetry = useCallback((userId: string) => {
    const gate = workspaceConflictGateRef.current;
    if (gate?.userId !== userId) return false;
    cloudRetryAttemptRef.current = gate.attempt;
    nextRetryAtRef.current = gate.retryAt;
    setNextRetryAt(gate.retryAt);
    return true;
  }, []);

  const hasUnsyncedLocalChanges = useCallback(() => {
    const live = stateRef.current;
    if (stableHash(live) !== hashRef.current) return true;
    if (accountMetadataHash(live) !== accountMetadataHashRef.current)
      return true;
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
      const preserveLocalGroupConfiguration =
        live.group.id === groupId && explicitlyPending;
      const preserveLocalAccountProfile =
        accountMetadataHash(live) !== accountMetadataHashRef.current;
      const next = mergeWorkspaceWithoutRegression(
        remote,
        live,
        preserveLocalGroupConfiguration,
        preserveLocalAccountProfile,
        revisionRef.current,
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
      }
      return next;
    },
    [],
  );

  const flushChatOutbox = useCallback(() => {
    if (
      chatOutboxPromiseRef.current ||
      auth.status !== "signedIn" ||
      !networkAvailableRef.current ||
      !isCloudGroupId(stateRef.current.group.id)
    ) return;
    const pending = [...chatOutboxPendingRef.current]
      .filter(
        (messageId) =>
          (chatOutboxAttemptsRef.current.get(messageId) ?? 0) <
          CHAT_OUTBOX_AUTOMATIC_RETRY_LIMIT,
      )
      .sort(
        (left, right) =>
          (chatOutboxAttemptsRef.current.get(left) ?? 0) -
          (chatOutboxAttemptsRef.current.get(right) ?? 0),
      )
      .slice(0, 8);
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
          // Keep the local message as a durable outbox row after the bounded
          // foreground retry burst. A later reconnect/resume/manual refresh
          // gets another exact idempotent attempt instead of silently losing
          // a message after five temporary failures.
          if (attempts < CHAT_OUTBOX_AUTOMATIC_RETRY_LIMIT)
            shouldRetry = true;
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
      const hasImmediatelyRetryableMessages = [
        ...chatOutboxPendingRef.current,
      ].some(
        (messageId) =>
          (chatOutboxAttemptsRef.current.get(messageId) ?? 0) <
          CHAT_OUTBOX_AUTOMATIC_RETRY_LIMIT,
      );
      if (hasImmediatelyRetryableMessages && !chatOutboxTimerRef.current) {
        chatOutboxTimerRef.current = setTimeout(() => {
          chatOutboxTimerRef.current = null;
          flushChatOutbox();
        }, 120);
      }
    });
    chatOutboxPromiseRef.current = operation;
  }, [auth.status]);

  const recoverChatOutbox = useCallback(() => {
    if (
      chatRecoveryPromiseRef.current ||
      auth.status !== "signedIn" ||
      !networkAvailableRef.current ||
      !isCloudGroupId(stateRef.current.group.id)
    )
      return chatRecoveryPromiseRef.current ?? Promise.resolve();
    const boundary = chatOutboxBoundaryRef.current;
    const queuedIds = [...chatOutboxPendingRef.current];
    const operation = pushCloudMessagesNow(stateRef.current)
      .then(() => {
        if (chatOutboxBoundaryRef.current !== boundary) return;
        queuedIds.forEach((messageId) => {
          chatOutboxPendingRef.current.delete(messageId);
          chatOutboxAttemptsRef.current.delete(messageId);
        });
      })
      .catch(() => {
        // The generic recovery query is the low-request path. If it fails,
        // retain every durable id and fall back to the bounded targeted queue.
        if (chatOutboxBoundaryRef.current === boundary) flushChatOutbox();
      })
      .finally(() => {
        if (chatRecoveryPromiseRef.current === operation)
          chatRecoveryPromiseRef.current = null;
        if (
          chatOutboxBoundaryRef.current === boundary &&
          chatOutboxPendingRef.current.size
        )
          flushChatOutbox();
      });
    chatRecoveryPromiseRef.current = operation;
    return operation;
  }, [auth.status, flushChatOutbox]);

  useEffect(() => {
    const boundary = `${auth.user?.id ?? "signed-out"}:${state.group.id}`;
    if (chatOutboxBoundaryRef.current === boundary) return;
    chatOutboxBoundaryRef.current = boundary;
    chatOutboxInitializedGroupRef.current = null;
    chatOutboxSeenRef.current.clear();
    chatOutboxPendingRef.current.clear();
    chatOutboxAttemptsRef.current.clear();
    if (chatOutboxTimerRef.current) clearTimeout(chatOutboxTimerRef.current);
    chatOutboxTimerRef.current = null;
  }, [auth.user?.id, state.group.id]);

  useEffect(() => {
    if (auth.status !== "signedIn" || !isCloudGroupId(state.group.id)) return;
    const ownedMessagesForRecovery = state.messages
      .filter((message) =>
        !(
        message.senderId !== state.currentUserId ||
        (message.groupId
          ? message.groupId !== state.group.id
          : message.conversationId !== `group:${state.group.id}`)
        ),
      )
      .slice(-CHAT_OUTBOX_RECOVERY_LIMIT);
    if (chatOutboxInitializedGroupRef.current !== state.group.id) {
      chatOutboxInitializedGroupRef.current = state.group.id;
      ownedMessagesForRecovery.forEach((message) =>
        chatOutboxSeenRef.current.add(message.id),
      );
      // Startup/re-hydration uses one recovery query rather than treating all
      // recent local history as newly sent and launching one request per row.
      if (networkAvailable) {
        const boundary = chatOutboxBoundaryRef.current;
        void pushCloudMessagesNow(stateRef.current).catch(() => {
          // A temporary failure must put the exact local rows back into the
          // durable targeted outbox. The boundary guard prevents an old
          // account/group recovery from leaking into the newly selected one.
          if (chatOutboxBoundaryRef.current !== boundary) return;
          ownedMessagesForRecovery.forEach((message) =>
            chatOutboxPendingRef.current.add(message.id),
          );
          flushChatOutbox();
        });
      } else {
        // These messages were restored from local persistence while offline.
        // Keep them queued so the connectivity effect sends them without a
        // Chat-page visit or manual Cloud Sync.
        ownedMessagesForRecovery.forEach((message) =>
          chatOutboxPendingRef.current.add(message.id),
        );
      }
      return;
    }
    for (const message of ownedMessagesForRecovery) {
      if (chatOutboxSeenRef.current.has(message.id)) continue;
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

  const evictUnavailableGroup = useCallback(
    async (groupId: string) => {
      const live = stateRef.current;
      const departed = live.groups.find((group) => group.id === groupId);
      if (!departed || !isCloudGroupId(groupId)) {
        await removeGroupActivityCache(groupId).catch(() => undefined);
        return;
      }
      let remaining = live.groups.filter((group) => group.id !== groupId);
      if (!remaining.length) {
        const priorMember =
          departed.members.find(
            (member) => member.id === live.currentUserId,
          ) ??
          ({
            id: live.currentUserId,
            name: accountMemberProfile(live)?.name ?? "HabHub member",
            initials: accountMemberProfile(live)?.initials ?? "H",
            color: DEFAULT_GROUP_THEME,
            role: "owner",
          } satisfies Member);
        remaining = [
          createPersonalSetupGroup(
            priorMember,
            personalSetupMetricConfiguration(
              live.metrics,
              live.trackedGoalPeriods,
            ),
          ),
        ];
      }
      const active =
        live.group.id === groupId ? remaining[0] : live.group;
      const evicted = purgeDepartedGroupData(
        stateWithActiveGroup(live, active, remaining),
        departed,
      );
      stateRef.current = evicted;
      workspaceUploadRequiredGroupsRef.current.delete(groupId);
      activityVersionByGroupRef.current.delete(groupId);
      activityCoverageSinceByGroupRef.current.delete(groupId);
      workspaceAckHashesRef.current.delete(groupId);
      groupConfigurationAckHashesRef.current.delete(groupId);
      replaceState(evicted, { source: "local" });
      await removeGroupActivityCache(groupId).catch(() => undefined);
      setPendingChanges(true);
    },
    [replaceState],
  );

  const verifyActiveGroupMembership = useCallback(async () => {
    const groupId = stateRef.current.group.id;
    if (!isCloudGroupId(groupId)) return;
    try {
      if (!(await hasActiveCloudGroupMembership(groupId)))
        await evictUnavailableGroup(groupId);
    } catch (error) {
      // A timeout/offline response is not evidence of revocation. The normal
      // bounded retry and the next resume/reconnect will verify again.
      if (isDefinitiveGroupMembershipLoss(error))
        await evictUnavailableGroup(groupId);
    }
  }, [evictUnavailableGroup]);

  const clearGroupReadRetry = useCallback((groupId?: string) => {
    if (
      groupId &&
      groupReadRetryGroupIdRef.current &&
      groupReadRetryGroupIdRef.current !== groupId
    )
      return;
    if (groupReadRetryTimerRef.current)
      clearTimeout(groupReadRetryTimerRef.current);
    groupReadRetryTimerRef.current = null;
    groupReadRetryAttemptRef.current = 0;
    groupReadRetryGroupIdRef.current = null;
  }, []);

  const markGroupReadSucceeded = useCallback(
    (groupId: string) => {
      clearGroupReadRetry(groupId);
      setErrorMessage((current) =>
        /group (?:refresh|history).*will retry/i.test(current ?? "")
          ? null
          : current,
      );
    },
    [clearGroupReadRetry],
  );

  const scheduleGroupReadRetry = useCallback(
    (groupId: string) => {
      if (
        auth.status !== "signedIn" ||
        !auth.user ||
        initializedUserRef.current !== auth.user.id ||
        stateRef.current.group.id !== groupId
      )
        return;
      if (
        groupReadRetryGroupIdRef.current &&
        groupReadRetryGroupIdRef.current !== groupId
      )
        clearGroupReadRetry();
      groupReadRetryGroupIdRef.current = groupId;
      if (
        groupReadRetryTimerRef.current ||
        !networkAvailableRef.current ||
        NativeAppState.currentState !== "active"
      )
        return;
      const attempt = Math.min(7, groupReadRetryAttemptRef.current + 1);
      groupReadRetryAttemptRef.current = attempt;
      groupReadRetryTimerRef.current = setTimeout(() => {
        groupReadRetryTimerRef.current = null;
        if (
          !networkAvailableRef.current ||
          NativeAppState.currentState !== "active" ||
          initializedUserRef.current !== auth.user?.id ||
          stateRef.current.group.id !== groupId
        )
          return;
        groupReadRetryRunnerRef.current?.(groupId);
      }, Math.min(MAX_GROUP_READ_RETRY_MS, 3_000 * 2 ** (attempt - 1)));
    },
    [auth.status, auth.user, clearGroupReadRetry],
  );

  const clearMessageReadRetry = useCallback((groupId?: string) => {
    if (
      groupId &&
      messageReadRetryGroupIdRef.current &&
      messageReadRetryGroupIdRef.current !== groupId
    )
      return;
    if (messageReadRetryTimerRef.current)
      clearTimeout(messageReadRetryTimerRef.current);
    messageReadRetryTimerRef.current = null;
    messageReadRetryAttemptRef.current = 0;
    messageReadRetryGroupIdRef.current = null;
  }, []);

  const scheduleMessageReadRetry = useCallback(
    (groupId: string) => {
      if (
        auth.status !== "signedIn" ||
        !auth.user ||
        initializedUserRef.current !== auth.user.id ||
        stateRef.current.group.id !== groupId
      )
        return;
      if (
        messageReadRetryGroupIdRef.current &&
        messageReadRetryGroupIdRef.current !== groupId
      )
        clearMessageReadRetry();
      messageReadRetryGroupIdRef.current = groupId;
      if (
        messageReadRetryTimerRef.current ||
        !networkAvailableRef.current ||
        NativeAppState.currentState !== "active"
      )
        return;
      const attempt = Math.min(6, messageReadRetryAttemptRef.current + 1);
      messageReadRetryAttemptRef.current = attempt;
      messageReadRetryTimerRef.current = setTimeout(() => {
        messageReadRetryTimerRef.current = null;
        if (
          !networkAvailableRef.current ||
          NativeAppState.currentState !== "active" ||
          initializedUserRef.current !== auth.user?.id ||
          stateRef.current.group.id !== groupId
        )
          return;
        messageReadRetryRunnerRef.current?.(groupId);
      }, Math.min(MAX_SURFACE_READ_RETRY_MS, 2_000 * 2 ** (attempt - 1)));
    },
    [auth.status, auth.user, clearMessageReadRetry],
  );

  const clearActivityReadRetry = useCallback((groupId?: string) => {
    if (
      groupId &&
      activityReadRetryGroupIdRef.current &&
      activityReadRetryGroupIdRef.current !== groupId
    )
      return;
    if (activityReadRetryTimerRef.current)
      clearTimeout(activityReadRetryTimerRef.current);
    activityReadRetryTimerRef.current = null;
    activityReadRetryAttemptRef.current = 0;
    activityReadRetryGroupIdRef.current = null;
  }, []);

  const scheduleActivityReadRetry = useCallback(
    (groupId: string) => {
      if (
        auth.status !== "signedIn" ||
        !auth.user ||
        initializedUserRef.current !== auth.user.id ||
        stateRef.current.group.id !== groupId
      )
        return;
      if (
        activityReadRetryGroupIdRef.current &&
        activityReadRetryGroupIdRef.current !== groupId
      )
        clearActivityReadRetry();
      activityReadRetryGroupIdRef.current = groupId;
      if (
        activityReadRetryTimerRef.current ||
        !networkAvailableRef.current ||
        NativeAppState.currentState !== "active"
      )
        return;
      const attempt = Math.min(6, activityReadRetryAttemptRef.current + 1);
      activityReadRetryAttemptRef.current = attempt;
      activityReadRetryTimerRef.current = setTimeout(() => {
        activityReadRetryTimerRef.current = null;
        if (
          !networkAvailableRef.current ||
          NativeAppState.currentState !== "active" ||
          initializedUserRef.current !== auth.user?.id ||
          stateRef.current.group.id !== groupId
        )
          return;
        activityReadRetryRunnerRef.current?.(groupId);
      }, Math.min(MAX_SURFACE_READ_RETRY_MS, 2_000 * 2 ** (attempt - 1)));
    },
    [auth.status, auth.user, clearActivityReadRetry],
  );

  // Account identity is a hard cache boundary. Clear another account's local
  // theme/group state in a layout effect so it cannot flash on screen or be
  // persisted while the signed-in account snapshot is still loading.
  useLayoutEffect(() => {
    if (!hydrated || auth.status !== "signedIn" || !auth.user) {
      setAccountBoundaryReadyUserId(null);
      return;
    }
    if (
      stateRef.current.currentUserId === auth.user.id &&
      !isDemoBoundState(stateRef.current)
    ) {
      setAccountBoundaryReadyUserId(auth.user.id);
      return;
    }
    let cancelled = false;
    let storageRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const user = auth.user;
    const clean = createCleanAccountState(auth.user);
    stateRef.current = clean;
    revisionRef.current = 0;
    hashRef.current = null;
    accountMetadataHashRef.current = null;
    workspaceHashRef.current = null;
    groupConfigurationHashRef.current = null;
    initializedUserRef.current = null;
    identityResetUserRef.current = auth.user.id;
    activityVersionByGroupRef.current.clear();
    activityCoverageSinceByGroupRef.current.clear();
    activityVersionCheckByGroupRef.current.clear();
    historicalHydrationStartedRef.current.clear();
    lastSyncedAtRef.current = null;
    workspaceConflictGateRef.current = null;
    conflictRefreshRef.current = null;
    cloudRetryAttemptRef.current = 0;
    nextRetryAtRef.current = 0;
    setNextRetryAt(0);
    setLastSyncedAt(null);
    setAccountBoundaryReadyUserId(null);
    // Clear the previous account from rendered memory immediately, but do not
    // persist the clean placeholder over this user's durable scoped cache.
    stageState(clean);
    const recoverPersistedAccount = () => {
      void readPersistedAccountState(user.id)
        .then((cached) => {
          if (cancelled || auth.user?.id !== user.id) return;
          const recovered = cached ? bindStateToAccount(cached, user) : clean;
          stateRef.current = recovered;
          stageState(recovered);
          setAccountBoundaryReadyUserId(user.id);
        })
        .catch((error) => {
          if (cancelled || auth.user?.id !== user.id) return;
          // Keep the persistence/cloud boundary closed until durable storage
          // can prove whether this account has an offline snapshot. IndexedDB
          // has a short reopen retry; unexpected provider failures back off a
          // little longer without ever treating them as an empty account.
          storageRetryTimer = setTimeout(
            recoverPersistedAccount,
            error instanceof AppStateStorageReadError ? 650 : 1_500,
          );
        });
    };
    recoverPersistedAccount();
    return () => {
      cancelled = true;
      if (storageRetryTimer) clearTimeout(storageRetryTimer);
    };
  }, [auth.status, auth.user, hydrated, stageState]);

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
        replaceState(next, { source: "cloud" });
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
    if (workspaceConflictGateRef.current?.userId !== operationUserId)
      setErrorMessage(null);
    await yieldCloudMaintenanceToUi();
    if (!operationIsCurrent()) return;
    const pullStartAccountHash = stableHash(stateRef.current);
    const accountWasDirty = pullStartAccountHash !== hashRef.current;
    try {
      const remote = await readCloudResponsively((signal) =>
        fetchSnapshot(operationUserId, signal),
      );
      if (!operationIsCurrent()) return;
      if (!remote) return;
      // Response parsing happens before this continuation. Keep the remaining
      // payload upgrade/hash/merge work out of a newly-started navigation.
      await yieldCloudMaintenanceToUi();
      if (!operationIsCurrent()) return;
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
      if (preserveLocalAccount) {
        await ensureLatestCloudMergeBase(operationUserId);
        if (!operationIsCurrent()) return;
      }
      const resolved = preserveLocalAccount
        ? mergeStates(resolvedRemote, stateRef.current, mergeBaseRef.current)
        : acceptCleanRemoteState(resolvedRemote, stateRef.current);
      const resolvedHash = stableHash(resolved);
      const shouldAcknowledgeRemoteSnapshot =
        !preserveLocalAccount || resolvedHash === remoteHash;
      hashRef.current = remoteHash;
      let acceptedMetadataHash: string | null = null;
      if (!preserveLocalAccount) {
        acceptedMetadataHash = accountMetadataHash(resolved);
        accountMetadataHashRef.current = acceptedMetadataHash;
      }
      workspaceHashRef.current = isCloudGroupId(resolved.group.id)
        ? (workspaceAckHashesRef.current.get(resolved.group.id) ?? null)
        : null;
      groupConfigurationHashRef.current = isCloudGroupId(resolved.group.id)
        ? (groupConfigurationAckHashesRef.current.get(resolved.group.id) ?? null)
        : null;
      // Advance the cloud ref before awaiting the disk boundary. A local edit
      // that lands during that write is reduced from this state and must remain
      // authoritative after the await.
      stateRef.current = resolved;
      await replaceState(
        resolved,
        {
          source: preserveLocalAccount ? "local" : "cloud",
          persistImmediately: shouldAcknowledgeRemoteSnapshot,
        },
      );
      if (!operationIsCurrent()) return;
      if (acceptedMetadataHash)
        await writeAccountMetadataAck(
          operationUserId,
          acceptedMetadataHash,
        ).catch(() => undefined);
      rememberCloudMergeBase(operationUserId, bound);
      recordServerSyncedAt(remote.updated_at);
      // Also seeds the acknowledgement for upgraded clients whose cached and
      // remote durable state already match exactly.
      if (shouldAcknowledgeRemoteSnapshot) {
        await writeCloudSnapshotAck(operationUserId, remoteHash).catch(
          () => undefined,
        );
        await writeCloudSnapshotCursor(
          operationUserId,
          remote,
          remoteHash,
        ).catch(() => undefined);
      }
      if (!operationIsCurrent()) return;
      const conflictGate = workspaceConflictGateRef.current;
      if (conflictGate?.userId === operationUserId) {
        setStatus("conflict");
        setPendingChanges(true);
        setErrorMessage(
          "Changes from two devices were merged. Group data will retry automatically; Sync now retries immediately.",
        );
        restoreWorkspaceConflictRetry(operationUserId);
      } else {
        setStatus("synced");
        setPendingChanges(hasUnsyncedLocalChanges());
        cloudRetryAttemptRef.current = 0;
        nextRetryAtRef.current = 0;
        setNextRetryAt(0);
      }
      scheduleResponsiveWork(() => {
        resolvePrivateMedia(bound)
          .then(async (mediaState) => {
            await yieldCloudMaintenanceToUi();
            if (!operationIsCurrent()) return;
            const withMedia = mergePrivateMediaUrls(
              stateRef.current,
              mediaState,
            );
            if (withMedia === stateRef.current) return;
            stateRef.current = withMedia;
            replaceState(withMedia, { source: "cloud" });
          })
          // Exhausted Storage egress or a transient signing failure must not
          // turn an otherwise successful account pull into a sync error.
          .catch(() => undefined);
      }, { minimumDelayMs: 120, maximumDelayMs: 2_000, minimumUserQuietMs: 1_600 });
      if (isCloudGroupId(resolved.group.id)) {
        // "Get latest" returns as soon as the private account snapshot is
        // merged. The heavier group workspace catches up after interactions,
        // so the button and navigation never wait on 120 days of history.
        const groupId = resolved.group.id;
        const groupSequence = ++groupLoadSequenceRef.current;
        activityLoadSequenceRef.current += 1;
        scheduleResponsiveWork(() => {
          readCloudResponsively((signal) =>
            loadCloudWorkspace(
              stateRef.current,
              groupId,
              (metadata) => recordActivityMetadata(groupId, metadata),
              undefined,
              undefined,
              signal,
            ),
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
              replaceState(next, { source: "cloud" });
              markGroupReadSucceeded(groupId);
            })
            .catch((groupError) => {
              setErrorMessage(
                `Account synced; group refresh will retry: ${errorText(groupError)}`,
              );
              scheduleGroupReadRetry(groupId);
            });
        }, {
          minimumDelayMs: 300,
          maximumDelayMs: 3_000,
          minimumUserQuietMs: 1_800,
        });
      }
    } catch (error) {
      if (!operationIsCurrent()) return;
      setStatus(
        isTransientCloudError(error) ? "offline" : "error",
      );
      setErrorMessage(friendlySyncError(error));
      throw error;
    }
  }, [
    auth.user,
    ensureLatestCloudMergeBase,
    hasUnsyncedLocalChanges,
    mergeRemoteWorkspace,
    markGroupReadSucceeded,
    recordActivityMetadata,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
    restoreWorkspaceConflictRetry,
    scheduleGroupReadRetry,
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
    manualAttempt = false,
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
    const now = Date.now();
    const conflictBackoffActive =
      !manualAttempt &&
      cloudConflictBackoffActive(
        workspaceConflictGateRef.current,
        operationUserId,
        now,
      );
    const deferGroupRetry =
      conflictBackoffActive ||
      (!forceAttempt && nextRetryAtRef.current > now);
    if (syncPromiseRef.current) {
      const activeSync = syncPromiseRef.current;
      if (!forceAttempt || syncIsForcedRef.current) return activeSync;
      // A pull-to-refresh that lands during a quiet autosave still needs its
      // own freshness assertion after that serialized write completes.
      await activeSync;
      return performSyncRef.current?.(forceWorkspace, true, manualAttempt);
    }
    syncIsForcedRef.current = forceAttempt;
    const operation = (async () => {
      // Serialize against a pull that started first. A pull that starts after
      // this operation observes syncPromiseRef and waits for this save instead.
      const activePull = pullLatestPromiseRef.current;
      if (activePull) await activePull;
      // A compact foreground freshness publish and a durable workspace save
      // target the same status rows/checkpoint. Serialize the hand-off so a
      // resume/interval tick cannot duplicate that work beside an autosave.
      const activeFreshness = leaderboardPublishPromiseRef.current;
      if (activeFreshness) await activeFreshness;
      if (!operationIsCurrent()) return;
      // Routine debounced saves stay visually quiet. Explicit refresh controls
      // already expose their own progress and should not flash on every tap.
      if (forceAttempt) setStatus("syncing");
      if (!deferGroupRetry) setErrorMessage(null);
      try {
        // Network callbacks can resume while a user is pressing a tab. Hold
        // all snapshot projection/hash work until that real touch settles.
        await yieldCloudMaintenanceToUi();
        if (!operationIsCurrent()) return;
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
          replaceState(candidate, { source: "cloud" });
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
        await yieldCloudMaintenanceToUi();
        if (!operationIsCurrent()) return;
        await persistPrivateSnapshot();
        if (!operationIsCurrent()) return;
        const pushedAccountMetadataHash = accountMetadataHash(candidate);
        const accountMetadataNeedsUpload =
          pushedAccountMetadataHash !== accountMetadataHashRef.current;
        let accountMetadataSynced = !accountMetadataNeedsUpload;
        let accountMetadataAckPending = false;
        let workspaceAcksPending = false;
        let groupConfigurationAcksPending = false;
        const acknowledgeAccountMetadata = () => {
          accountMetadataHashRef.current = pushedAccountMetadataHash;
          accountMetadataAckPending = true;
        };
        let nextWorkspaceHash = workspaceHash(candidate);
        const nextGroupConfigurationHash = groupConfigurationHash(candidate);
        const pushedGroupId = candidate.group.id;
        const pushedWorkspaceHash = nextWorkspaceHash;
        const pendingGroupConfiguration =
          candidate.settings.pendingGroupConfigurationIds?.includes(
            candidate.group.id,
          ) === true;
        // Only the reducer's explicit durable outbox marker authorizes a group
        // settings upload. A stale/missing ACK hash is not proof of a user edit
        // and must never republish an older cached configuration after a crash.
        const shouldPushGroupConfiguration = pendingGroupConfiguration;
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
                  replaceState(published, { source: "cloud" });
                }
              },
              revisionRef.current,
              yieldCloudMaintenanceToUi,
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
            accountMetadataSynced = true;
            acknowledgeAccountMetadata();
            if (!operationIsCurrent()) return;
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
            if (workspaceResult.acknowledgedPrivacyFenceMetricIds.length) {
              const acknowledged = new Set(
                workspaceResult.acknowledgedPrivacyFenceMetricIds,
              );
              const pendingByGroup = {
                ...(acknowledgedState.settings
                  .pendingMetricPrivacyFenceIdsByGroup ?? {}),
              };
              const remaining = (pendingByGroup[pushedGroupId] ?? []).filter(
                (metricId) => !acknowledged.has(metricId),
              );
              if (remaining.length) pendingByGroup[pushedGroupId] = remaining;
              else delete pendingByGroup[pushedGroupId];
              acknowledgedState = {
                ...acknowledgedState,
                settings: {
                  ...acknowledgedState.settings,
                  pendingMetricPrivacyFenceIdsByGroup: pendingByGroup,
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
              replaceState(acknowledgedState, { source: "cloud" });
            }
            workspaceUploadRequiredGroupsRef.current.delete(
              pushedGroupId,
            );
            if (workspaceAckMayPersist(candidate))
              workspaceAckHashesRef.current.set(
                pushedGroupId,
                pushedWorkspaceHash,
              );
            else
              // A workspace digest changes with Google values/ids and is
              // therefore not written to plaintext storage. The in-memory
              // hash below still prevents duplicate uploads this session.
              workspaceAckHashesRef.current.delete(pushedGroupId);
            workspaceAcksPending = true;
            if (workspaceResult.groupConfigurationPushed) {
              groupConfigurationHashRef.current =
                nextGroupConfigurationHash;
              groupConfigurationAckHashesRef.current.set(
                pushedGroupId,
                nextGroupConfigurationHash,
              );
              groupConfigurationAcksPending = true;
            }
          } catch (error) {
            const workspaceErrorText = errorText(error);
            if (/stale_group_configuration/i.test(workspaceErrorText)) {
              // Another administrator committed first. Refresh the common
              // group CAS token and server shell while preserving this
              // device's explicitly pending edits, then let the serialized
              // retry publish them against the new revision.
              try {
                const loaded = await readCloudResponsively((signal) =>
                  loadCloudWorkspace(
                    stateRef.current,
                    pushedGroupId,
                    undefined,
                    undefined,
                    undefined,
                    signal,
                  ),
                );
                if (operationIsCurrent()) {
                  const rebased = mergeRemoteWorkspace(
                    loaded,
                    stateRef.current,
                  );
                  stateRef.current = rebased;
                  replaceState(rebased, { source: "cloud" });
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
            const activeConflictGate = workspaceConflictGateRef.current;
            let retryAt: number;
            if (activeConflictGate?.userId === operationUserId) {
              retryAt = scheduleWorkspaceConflictRetry(operationUserId).retryAt;
            } else {
              const attempt = Math.min(
                8,
                cloudRetryAttemptRef.current + 1,
              );
              cloudRetryAttemptRef.current = attempt;
              retryAt =
                Date.now() +
                Math.min(
                  MAX_CLOUD_RETRY_MS,
                  5_000 * 2 ** (attempt - 1),
                );
            }
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
              replaceState(published, { source: "cloud" });
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
            replaceState(candidate, { source: "cloud" });
          }
        }
        // A profile rename/body-profile edit is global account metadata, not a
        // group-history operation. Publish it even while the personal setup
        // workspace is active, and independently while a heavy group retry is
        // backed off. One persisted hash coalesces all such edits.
        if (
          accountMetadataNeedsUpload &&
          !accountMetadataSynced &&
          (!groupWorkspaceNeedsUpload || deferGroupRetry)
        ) {
          await pushCloudAccountMetadata(candidate, revisionRef.current);
          if (!operationIsCurrent()) return;
          accountMetadataSynced = true;
          acknowledgeAccountMetadata();
          if (!operationIsCurrent()) return;
        }
        await yieldCloudMaintenanceToUi();
        if (!operationIsCurrent()) return;
        await persistPrivateSnapshot();
        if (!operationIsCurrent()) return;
        // The server revision is not a durable acknowledgement until the
        // corresponding (or newer locally edited) state is on this device.
        // Otherwise a crash can restart from an older cache, misclassify it as
        // a local edit, and upload it over the revision that just succeeded.
        await flushLocalPersistence();
        if (!operationIsCurrent()) return;
        if (accountMetadataAckPending)
          await writeAccountMetadataAck(
            operationUserId,
            pushedAccountMetadataHash,
          ).catch(() => undefined);
        if (workspaceAcksPending)
          await writeWorkspaceAcks(
            operationUserId,
            workspaceAckHashesRef.current,
          ).catch(() => undefined);
        if (groupConfigurationAcksPending)
          await writeGroupConfigurationAcks(
            operationUserId,
            groupConfigurationAckHashesRef.current,
          ).catch(() => undefined);
        if (!operationIsCurrent()) return;
        hashRef.current = candidateHash;
        await writeCloudSnapshotAck(operationUserId, candidateHash).catch(
          () => undefined,
        );
        if (syncedAt)
          await writeCloudSnapshotCursor(
            operationUserId,
            {
              revision: revisionRef.current,
              updated_at: syncedAt,
              device_id: deviceId,
              schema_version: candidate.version,
            },
            candidateHash,
          ).catch(() => undefined);
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
        const hasPendingAccountMetadata =
          accountMetadataHash(latestState) !==
          accountMetadataHashRef.current;
        const hasPendingWorkspace =
          isCloudGroupId(latestState.group.id) &&
          (latestState.settings.pendingGroupConfigurationIds?.includes(
            latestState.group.id,
          ) === true ||
            workspaceHash(latestState) !== workspaceHashRef.current);
        const needsFollowUpSync =
          hasNewerLocalState ||
          hasPendingAccountMetadata ||
          hasPendingWorkspace;
        setPendingChanges(
          !workspaceSynced || !accountMetadataSynced || needsFollowUpSync,
        );
        const workspaceConflictPending =
          !workspaceSynced &&
          workspaceConflictGateRef.current?.userId === operationUserId;
        setStatus(workspaceConflictPending ? "conflict" : "synced");
        if (!deferGroupRetry) setErrorMessage(workspaceWarning);
        if (workspaceSynced && accountMetadataSynced) {
          workspaceConflictGateRef.current = null;
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
          scheduleWorkspaceConflictRetry(operationUserId);
          const remote = await fetchConflictSnapshot(operationUserId).catch(
            () => null,
          );
          if (!operationIsCurrent()) return;
          if (remote) {
            const activeGate = workspaceConflictGateRef.current;
            if (activeGate?.userId === operationUserId)
              workspaceConflictGateRef.current = {
                ...activeGate,
                observedRevision: remote.revision,
              };
            revisionRef.current = remote.revision;
            await ensureLatestCloudMergeBase(operationUserId);
            if (!operationIsCurrent()) return;
            const merged = mergeStates(
              bindStateToAccount(remote.payload, operationUser),
              stateRef.current,
              mergeBaseRef.current,
            );
            rememberCloudMergeBase(
              operationUserId,
              bindStateToAccount(remote.payload, operationUser),
            );
            // The remote snapshot is the new merge base, while `merged` still
            // contains a durable local outbox that the scheduled retry must
            // publish. Classify that hybrid rebase explicitly as local.
            replaceState(merged, { source: "local" });
            stateRef.current = merged;
            setPendingChanges(true);
            setErrorMessage(
              "Changes from two devices were merged. Sync once more to confirm them.",
            );
            return;
          }
          setPendingChanges(true);
          setErrorMessage(
            "Changes from two devices need a fresh copy. Sync will retry automatically.",
          );
          return;
        }
        const offline = isTransientCloudError(syncErrorText);
        const activeConflictGate = workspaceConflictGateRef.current;
        let retryAt: number;
        if (activeConflictGate?.userId === operationUserId) {
          retryAt = scheduleWorkspaceConflictRetry(operationUserId).retryAt;
        } else {
          const attempt = Math.min(8, cloudRetryAttemptRef.current + 1);
          cloudRetryAttemptRef.current = attempt;
          retryAt =
            Date.now() +
            Math.min(MAX_CLOUD_RETRY_MS, 5_000 * 2 ** (attempt - 1));
        }
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
    ensureLatestCloudMergeBase,
    fetchConflictSnapshot,
    flushLocalPersistence,
    hasUnsyncedLocalChanges,
    mergeRemoteWorkspace,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
    scheduleWorkspaceConflictRetry,
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
      isCloudSyncPaused() ||
      cloudConflictBackoffActive(
        workspaceConflictGateRef.current,
        auth.user.id,
        Date.now(),
      )
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
        replaceState(published, { source: "cloud" });
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
    if (
      !hydrated ||
      auth.status !== "signedIn" ||
      !auth.user ||
      !supabase ||
      accountBoundaryReadyUserId !== auth.user.id
    ) {
      initializedUserRef.current = null;
      setStatus(auth.status === "signedIn" ? "initializing" : "disabled");
      return;
    }
    let cancelled = false;
    const user = auth.user;
    const responsiveTasks = new Set<{ cancel: () => void }>();
    let deviceBookkeepingTimer: ReturnType<typeof setTimeout> | null = null;
    const waitForUi = async (
      minimumDelayMs: number,
      maximumDelayMs: number,
    ) => {
      if (Platform.OS === "web") return;
      const task = waitForResponsiveTurn({
        minimumDelayMs,
        maximumDelayMs,
        minimumUserQuietMs: 1_600,
      });
      responsiveTasks.add(task);
      try {
        await task.promise;
      } finally {
        responsiveTasks.delete(task);
      }
    };
    let settleInitialNetworkWork: () => void = () => undefined;
    const initialNetworkWorkSettled = new Promise<void>((resolve) => {
      settleInitialNetworkWork = resolve;
    });
    remoteInitializationPendingRef.current = true;
    setStatus("initializing");
    setErrorMessage(null);
    (async () => {
      try {
        const startingOffline = !networkAvailableRef.current;
        if (startingOffline) {
          // Paint the account-scoped cache immediately. NetInfo begins with an
          // unknown snapshot on Android, and local acknowledgement reads must
          // not hold the entire signed-in UI behind an initializing screen.
          initializedUserRef.current = user.id;
          setStatus("offline");
          setErrorMessage(
            "Offline changes are safe on this device and will retry automatically.",
          );
        }
        // This migration is an ordering boundary, not background maintenance:
        // old ACK maps and cursors may fingerprint Google rows. Remove them
        // before any startup reader can load and later rewrite those hashes.
        await purgeLegacyGoogleHealthCloudCaches();
        if (cancelled) return;
        const [
          deviceId,
          workspaceAcks,
          groupConfigurationAcks,
          accountMetadataAck,
          acknowledgedSnapshotHash,
          savedSnapshotCursor,
          savedMergeBase,
          savedCheckpoint,
          onboardingComplete,
        ] = await Promise.all([
          getDeviceId(),
          readWorkspaceAcks(user.id),
          readGroupConfigurationAcks(user.id),
          readAccountMetadataAck(user.id),
          readCloudSnapshotAck(user.id),
          readCloudSnapshotCursor(user.id),
          readCloudMergeBase(user.id),
          readCloudSyncCheckpoint(user.id),
          onboardingCompletedLocally(user.id),
        ]);
        if (cancelled) return;
        deviceIdRef.current = deviceId;
        workspaceAckHashesRef.current = workspaceAcks;
        groupConfigurationAckHashesRef.current = groupConfigurationAcks;
        accountMetadataHashRef.current = accountMetadataAck;
        mergeBaseRef.current = savedMergeBase;
        if (savedCheckpoint) {
          lastSyncedAtRef.current = savedCheckpoint;
          setLastSyncedAt(savedCheckpoint);
        }
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
          // This device-local completion flag is an account outbox value even
          // though startup restored it from its small durable checkpoint.
          replaceState(markedComplete, { source: "local" });
        }
        if (!networkAvailableRef.current) {
          // Local reducers and persistence stay fully usable offline. Mark the
          // outbox owner here, but keep initialization pending so reconnect
          // fetches/merges the server revision before it publishes this outbox.
          initializedUserRef.current = user.id;
          setStatus("offline");
          setErrorMessage(
            "Offline changes are safe on this device and will retry automatically.",
          );
          const pendingCheck = scheduleResponsiveWork(() => {
            if (
              !cancelled &&
              !networkAvailableRef.current &&
              initializedUserRef.current === user.id
            )
              setPendingChanges(hasUnsyncedLocalChanges());
          }, { minimumDelayMs: 900, maximumDelayMs: 4_000 });
          responsiveTasks.add(pendingCheck);
          return;
        }
        // Existing accounts already have a complete private cache. Give its
        // first navigation/tap frames priority before starting online restore.
        await waitForUi(280, 1_200);
        if (cancelled) return;
        const remoteMetadata = await fetchSnapshotMetadata(user.id);
        if (cancelled) return;
        // A persisted cursor proves what the server acknowledged, but not that
        // the matching local snapshot reached AsyncStorage before a crash. Hash
        // the actual restored cache after another real touch-quiet turn before
        // allowing the metadata-only fast path.
        await waitForUi(0, 1_200);
        if (cancelled) return;
        const accountIdentityMatches =
          stateRef.current.currentUserId === user.id &&
          !isDemoBoundState(stateRef.current);
        const currentSnapshotHash = acknowledgedSnapshotHash
          ? stableHash(stateRef.current)
          : "";
        const cursorMatches = cloudSnapshotCursorMatches(
          savedSnapshotCursor,
          remoteMetadata,
          acknowledgedSnapshotHash,
          currentSnapshotHash,
          accountIdentityMatches,
        );
        const canBootstrapCursor = canBootstrapCloudSnapshotCursor({
          hasCursor: Boolean(savedSnapshotCursor),
          metadata: remoteMetadata,
          acknowledgedHash: acknowledgedSnapshotHash,
          currentHash: currentSnapshotHash,
          savedCheckpoint,
          accountIdentityMatches,
        });
        const cachedSnapshotIsCurrent = cursorMatches || canBootstrapCursor;
        if (
          canBootstrapCursor &&
          remoteMetadata &&
          acknowledgedSnapshotHash
        )
          void writeCloudSnapshotCursor(
            user.id,
            remoteMetadata,
            acknowledgedSnapshotHash,
          ).catch(() => undefined);
        // Only changed/new accounts pay the cost of downloading and parsing
        // the full JSON snapshot. The cursor is written together with the hash
        // acknowledgement, so it can never bless an unmerged remote revision.
        const remote =
          remoteMetadata && !cachedSnapshotIsCurrent
            ? await readCloudResponsively((signal) =>
                fetchSnapshot(user.id, signal),
              )
            : null;
        if (cancelled) return;
        // Payload upgrades, hashing and three-way merges are synchronous. Start
        // them after any navigation animation that occurred during the fetch.
        await waitForUi(0, 1_800);
        if (cancelled) return;
        if (
          !mergeBaseRef.current &&
          acknowledgedSnapshotHash &&
          stableHash(stateRef.current) === acknowledgedSnapshotHash
        )
          rememberCloudMergeBase(user.id, stateRef.current);
        // A successful account read ends the previous startup backoff. Group
        // publication below may establish its own fresh retry, but stale delay
        // from an earlier PGRST003 must not suppress deferred group hydration.
        if (!restoreWorkspaceConflictRetry(user.id)) {
          cloudRetryAttemptRef.current = 0;
          nextRetryAtRef.current = 0;
          setNextRetryAt(0);
        }
        initializedUserRef.current = user.id;
        remoteInitializationPendingRef.current = false;
        let correctedAccountState = false;
        if (cachedSnapshotIsCurrent && remoteMetadata) {
          revisionRef.current = remoteMetadata.revision;
          hashRef.current = acknowledgedSnapshotHash;
          const live = stateRef.current;
          workspaceHashRef.current = isCloudGroupId(live.group.id)
            ? (workspaceAckHashesRef.current.get(live.group.id) ?? null)
            : null;
          if (isCloudGroupId(live.group.id) && !workspaceHashRef.current)
            workspaceUploadRequiredGroupsRef.current.add(live.group.id);
          groupConfigurationHashRef.current = isCloudGroupId(live.group.id)
            ? (groupConfigurationAckHashesRef.current.get(live.group.id) ??
              null)
            : null;
          recordServerSyncedAt(remoteMetadata.updated_at);
          setPendingChanges(hasUnsyncedLocalChanges());
          setStatus("synced");

          // Relational group rows have their own revision stream. Refresh them
          // eventually, but only after a real touch-quiet window; the cached
          // group remains fully usable while the request waits.
          const groupHydration = scheduleResponsiveWork(() => {
            (async () => {
              await initialNetworkWorkSettled;
              if (cancelled || nextRetryAtRef.current > Date.now()) return;
              const existingGroups = await readCloudResponsively((signal) =>
                loadCloudGroupShells(signal),
              );
              if (cancelled || !existingGroups.length) return;
              const current = stateRef.current;
              const targetGroup =
                existingGroups.find(
                  (group) => group.id === current.group.id,
                ) ?? existingGroups[0];
              const loaded = await readCloudResponsively((signal) =>
                loadCloudWorkspace(
                  { ...current, groups: existingGroups },
                  targetGroup.id,
                  (metadata) =>
                    recordActivityMetadata(targetGroup.id, metadata),
                  undefined,
                  existingGroups,
                  signal,
                ),
              );
              await waitForUi(0, 2_500);
              if (cancelled) return;
              const next = mergeRemoteWorkspace(loaded, stateRef.current);
              stateRef.current = next;
              replaceState(next, { source: "cloud" });
              markGroupReadSucceeded(targetGroup.id);
            })().catch((groupError) => {
              if (cancelled) return;
              setErrorMessage(
                `Account ready; group refresh will retry: ${errorText(groupError)}`,
              );
              const groupId = stateRef.current.group.id;
              if (isCloudGroupId(groupId)) scheduleGroupReadRetry(groupId);
            });
          }, {
            minimumDelayMs: 3_000,
            maximumDelayMs: 12_000,
            minimumUserQuietMs: 1_800,
          });
          responsiveTasks.add(groupHydration);
        } else if (remote) {
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
          const remoteWithDeviceState = preserveDeviceSettings(
            mergePrivateMediaUrls(bound, stateRef.current),
            stateRef.current,
          );
          // A persisted acknowledgement distinguishes an offline local edit
          // from an older-but-clean cache. Clean clients accept newer website,
          // extension, or phone changes; dirty clients preserve their outbox.
          if (localWasDirty) {
            await ensureLatestCloudMergeBase(user.id);
            if (cancelled) return;
          }
          let resolved = correctedAccountState
            ? stateRef.current
            : localWasDirty
              ? mergeStates(
                  remoteWithDeviceState,
                  stateRef.current,
                  mergeBaseRef.current,
                )
              : acceptCleanRemoteState(
                  remoteWithDeviceState,
                  stateRef.current,
                );
          if (onboardingComplete && !resolved.settings.onboardingComplete)
            resolved = {
              ...resolved,
              settings: {
                ...resolved.settings,
                onboardingComplete: true,
              },
            };
          if (!cancelled) {
            const resolvedHash = stableHash(resolved);
            const shouldAcknowledgeRemoteSnapshot =
              !correctedAccountState &&
              (!localWasDirty || resolvedHash === remoteHash);
            hashRef.current = correctedAccountState
              ? null
              : remoteHash;
            let acceptedMetadataHash: string | null = null;
            if (!correctedAccountState && !localWasDirty) {
              acceptedMetadataHash = accountMetadataHash(resolved);
              accountMetadataHashRef.current = acceptedMetadataHash;
            }
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
            // Publish this authoritative value before waiting for storage. A
            // user edit during the flush is then based on `resolved` and updates
            // stateRef through the normal urgent local-render path; never assign
            // the older value again after the await.
            stateRef.current = resolved;
            await replaceState(
              resolved,
              {
                source: localWasDirty ? "local" : "cloud",
                persistImmediately: shouldAcknowledgeRemoteSnapshot,
              },
            );
            if (cancelled) return;
            if (acceptedMetadataHash)
              await writeAccountMetadataAck(
                user.id,
                acceptedMetadataHash,
              ).catch(() => undefined);
            if (!correctedAccountState)
              rememberCloudMergeBase(user.id, bound);
            recordServerSyncedAt(remote.updated_at);
            setPendingChanges(hasUnsyncedLocalChanges());
            if (shouldAcknowledgeRemoteSnapshot) {
              await writeCloudSnapshotAck(user.id, remoteHash).catch(
                () => undefined,
              );
              await writeCloudSnapshotCursor(
                user.id,
                remote,
                remoteHash,
              ).catch(() => undefined);
            }
            setStatus("synced");
          }
          // Signed media URLs and group history are cache hydration, not an
          // app-start prerequisite. Render the local/private snapshot first,
          // then merge these server-owned rows without regressing local writes.
          const groupHydration = scheduleResponsiveWork(() => {
            (async () => {
              // The first account write and the heavier group workspace read
              // used to start together. On small Supabase projects that burst
              // could exhaust PostgREST's pool (PGRST003) and strand startup at
              // Connecting. Serialize the cache hydration behind the account
              // outbox while keeping the already-rendered local cache usable.
              await initialNetworkWorkSettled;
              if (cancelled) return;
              if (nextRetryAtRef.current > Date.now()) {
                const groupId = stateRef.current.group.id;
                if (isCloudGroupId(groupId)) scheduleGroupReadRetry(groupId);
                return;
              }
              let hydratedState = stateRef.current;
              try {
                hydratedState = mergePrivateMediaUrls(
                  hydratedState,
                  await readCloudResponsively(() => resolvePrivateMedia(bound)),
                );
              } catch {
                // The account and group cache remain usable even when Storage
                // signing is temporarily unavailable or egress is restricted.
              }
              const existingGroups = await readCloudResponsively((signal) =>
                loadCloudGroupShells(signal),
              );
              const targetGroup =
                existingGroups.find(
                  (group) => group.id === hydratedState.group.id,
                ) ?? existingGroups[0];
              if (targetGroup)
                hydratedState = await readCloudResponsively((signal) =>
                  loadCloudWorkspace(
                    { ...hydratedState, groups: existingGroups },
                    targetGroup.id,
                    (metadata) =>
                      recordActivityMetadata(targetGroup.id, metadata),
                    undefined,
                    existingGroups,
                    signal,
                  ),
                );
              await waitForUi(0, 2_500);
              if (cancelled) return;
              const next = mergeRemoteWorkspace(
                hydratedState,
                stateRef.current,
              );
              stateRef.current = next;
              replaceState(next, { source: "cloud" });
              if (targetGroup) markGroupReadSucceeded(targetGroup.id);
            })().catch((groupError) => {
              if (!cancelled) {
                setErrorMessage(
                  `Account restored; group refresh will retry: ${errorText(groupError)}`,
                );
                const groupId = stateRef.current.group.id;
                if (isCloudGroupId(groupId)) scheduleGroupReadRetry(groupId);
              }
            });
          }, {
            minimumDelayMs: 1_200,
            maximumDelayMs: 4_000,
            minimumUserQuietMs: 1_800,
          });
          responsiveTasks.add(groupHydration);
        } else {
          const bound = bindStateToAccount(stateRef.current, user);
          stateRef.current = bound;
          replaceState(bound, { source: "cloud" });
          revisionRef.current = 0;
          hashRef.current = null;
          workspaceHashRef.current = isCloudGroupId(bound.group.id)
            ? (workspaceAckHashesRef.current.get(bound.group.id) ?? null)
            : null;
          groupConfigurationHashRef.current = isCloudGroupId(bound.group.id)
            ? (groupConfigurationAckHashesRef.current.get(bound.group.id) ?? null)
            : null;
          setPendingChanges(true);
          const groupHydration = scheduleResponsiveWork(() => {
            (async () => {
              await initialNetworkWorkSettled;
              if (cancelled) return;
              if (nextRetryAtRef.current > Date.now()) {
                const groupId = stateRef.current.group.id;
                if (isCloudGroupId(groupId)) scheduleGroupReadRetry(groupId);
                return;
              }
              const existingGroups = await readCloudResponsively((signal) =>
                loadCloudGroupShells(signal),
              );
              if (!existingGroups.length || cancelled) return;
              const targetGroup = existingGroups[0];
              const loaded = await readCloudResponsively((signal) =>
                loadCloudWorkspace(
                  { ...stateRef.current, groups: existingGroups },
                  targetGroup.id,
                  (metadata) =>
                    recordActivityMetadata(targetGroup.id, metadata),
                  undefined,
                  existingGroups,
                  signal,
                ),
              );
              await waitForUi(0, 2_500);
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
              replaceState(next, { source: "cloud" });
              markGroupReadSucceeded(targetGroup.id);
            })().catch((groupError) => {
              if (!cancelled) {
                setErrorMessage(
                  `Account ready; group refresh will retry: ${errorText(groupError)}`,
                );
                const groupId = stateRef.current.group.id;
                if (isCloudGroupId(groupId)) scheduleGroupReadRetry(groupId);
              }
            });
          }, {
            minimumDelayMs: 1_200,
            maximumDelayMs: 4_000,
            minimumUserQuietMs: 1_800,
          });
          responsiveTasks.add(groupHydration);
        }
        if (cancelled) return;
        identityResetUserRef.current = null;
        if (
          (!cachedSnapshotIsCurrent && !remote) ||
          correctedAccountState ||
          hasUnsyncedLocalChanges()
        ) {
          await waitForUi(180, 1_500);
          if (cancelled) return;
          await performSync(false, true);
        } else setStatus("synced");
        settleInitialNetworkWork();
        // Device bookkeeping is not on the critical startup path. Stagger it
        // behind the account/group work rather than adding two more concurrent
        // PostgREST requests during a cold launch.
        deviceBookkeepingTimer = setTimeout(() => {
          if (cancelled || nextRetryAtRef.current > Date.now()) return;
          supabase!
            .rpc("register_account_device", {
              client_device_id: deviceId,
              client_platform: Platform.OS,
              client_label: null,
            })
            .then(() => undefined, () => undefined);
          deviceHeartbeatAtRef.current = Date.now();
          loadDevices().catch(() => undefined);
        }, 1800);
      } catch (error) {
        if (!cancelled) {
          settleInitialNetworkWork();
          setStatus(
            isTransientCloudError(error) ? "offline" : "error",
          );
          setErrorMessage(friendlySyncError(error));
          setPendingChanges(hasUnsyncedLocalChanges());
          const activeConflictGate = workspaceConflictGateRef.current;
          let retryAt: number;
          if (activeConflictGate?.userId === user.id) {
            retryAt = scheduleWorkspaceConflictRetry(user.id).retryAt;
          } else {
            const attempt = Math.min(
              8,
              cloudRetryAttemptRef.current + 1,
            );
            cloudRetryAttemptRef.current = attempt;
            retryAt =
              Date.now() +
              Math.min(MAX_CLOUD_RETRY_MS, 5_000 * 2 ** (attempt - 1));
          }
          nextRetryAtRef.current = retryAt;
          setNextRetryAt(retryAt);
        }
      }
    })();
    return () => {
      cancelled = true;
      responsiveTasks.forEach((task) => task.cancel());
      responsiveTasks.clear();
      if (deviceBookkeepingTimer) clearTimeout(deviceBookkeepingTimer);
      settleInitialNetworkWork();
      initializedUserRef.current = null;
      remoteInitializationPendingRef.current = false;
      mergeBaseRef.current = null;
    };
  }, [
    auth.status,
    auth.user,
    accountBoundaryReadyUserId,
    ensureLatestCloudMergeBase,
    hydrated,
    hasUnsyncedLocalChanges,
    initializationAttempt,
    loadDevices,
    markGroupReadSucceeded,
    mergeRemoteWorkspace,
    performSync,
    recordActivityMetadata,
    recordServerSyncedAt,
    rememberCloudMergeBase,
    replaceState,
    restoreWorkspaceConflictRetry,
    scheduleWorkspaceConflictRetry,
    scheduleGroupReadRetry,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      initializedUserRef.current !== auth.user?.id
    )
      return;
    const changedAt = Date.now();
    autoSyncFirstChangeAtRef.current ??= changedAt;
    autoSyncLastChangeAtRef.current = changedAt;

    // Keep one timer for the whole burst. The callback observes the latest
    // change time and reschedules itself, which avoids timer churn on every
    // keystroke while retaining a five-second maximum trigger latency.
    if (timerRef.current || idleSyncRef.current) return;
    const saveWhenReady = () => {
      timerRef.current = null;
      const now = Date.now();
      const firstChangeAt = autoSyncFirstChangeAtRef.current ?? now;
      const lastChangeAt = autoSyncLastChangeAtRef.current ?? firstChangeAt;
      const remaining = nextAutoSyncDelay(
        now,
        firstChangeAt,
        lastChangeAt,
      );
      if (remaining > 0) {
        timerRef.current = setTimeout(saveWhenReady, remaining);
        return;
      }
      if (isCloudSyncPaused()) {
        // Edit/reorder and historical Health Connect imports deliberately hold
        // the network gate. The gate subscription below wakes this exact
        // outbox when the final pause reason clears, without polling.
        setPendingChanges(hasUnsyncedLocalChanges());
        return;
      }
      if (NativeAppState.currentState !== "active") {
        setPendingChanges(hasUnsyncedLocalChanges());
        return;
      }
      if (!networkAvailableRef.current) {
        setPendingChanges(hasUnsyncedLocalChanges());
        setStatus("offline");
        return;
      }

      let completed = false;
      const runSyncCheck = () => {
        if (completed) return;
        const checkNow = Date.now();
        const currentFirstChangeAt =
          autoSyncFirstChangeAtRef.current ?? checkNow;
        const currentLastChangeAt =
          autoSyncLastChangeAtRef.current ?? currentFirstChangeAt;
        const rescheduleAfter = nextAutoSyncDelay(
          checkNow,
          currentFirstChangeAt,
          currentLastChangeAt,
        );
        if (rescheduleAfter > 0) {
          completed = true;
          idleSyncRef.current?.cancel();
          idleSyncRef.current = null;
          if (idleSyncFallbackTimerRef.current)
            clearTimeout(idleSyncFallbackTimerRef.current);
          idleSyncFallbackTimerRef.current = null;
          timerRef.current = setTimeout(saveWhenReady, rescheduleAfter);
          return;
        }
        completed = true;
        idleSyncRef.current?.cancel();
        idleSyncRef.current = null;
        if (idleSyncFallbackTimerRef.current)
          clearTimeout(idleSyncFallbackTimerRef.current);
        idleSyncFallbackTimerRef.current = null;
        autoSyncFirstChangeAtRef.current = null;
        autoSyncLastChangeAtRef.current = null;
        const live = stateRef.current;
        const privateSnapshotChanged = stableHash(live) !== hashRef.current;
        const accountMetadataChanged =
          accountMetadataHash(live) !== accountMetadataHashRef.current;
        const groupWorkspaceChanged =
          isCloudGroupId(live.group.id) &&
          (live.settings.pendingGroupConfigurationIds?.includes(
            live.group.id,
          ) === true ||
            workspaceUploadRequiredGroupsRef.current.has(live.group.id) ||
            workspaceHash(live) !== workspaceHashRef.current);
        if (
          !privateSnapshotChanged &&
          !accountMetadataChanged &&
          !groupWorkspaceChanged
        )
          return;
        setPendingChanges(true);
        performSync().catch(() => undefined);
      };
      // InteractionManager alone does not classify a discrete press as an
      // interaction. The root touch pulse keeps this hash pass behind actual
      // taps as well as navigation animations. Repeated touches may postpone
      // cloud work, while the independent local persistence outbox remains
      // durable immediately.
      const idleTask = scheduleResponsiveWork(runSyncCheck, {
        maximumDelayMs: AUTO_SYNC_MAX_INTERACTION_WAIT_MS,
        minimumUserQuietMs: 1_600,
      });
      if (completed) idleTask.cancel();
      else idleSyncRef.current = idleTask;
    };
    timerRef.current = setTimeout(
      saveWhenReady,
      nextAutoSyncDelay(changedAt, changedAt, changedAt),
    );
  }, [
    auth.status,
    auth.user?.id,
    hasUnsyncedLocalChanges,
    performSync,
    localMutationRevision,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      idleSyncRef.current?.cancel();
      idleSyncRef.current = null;
      if (idleSyncFallbackTimerRef.current)
        clearTimeout(idleSyncFallbackTimerRef.current);
      idleSyncFallbackTimerRef.current = null;
      autoSyncFirstChangeAtRef.current = null;
      autoSyncLastChangeAtRef.current = null;
    },
    [auth.user?.id],
  );

  useEffect(() => {
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCloudSyncPause((paused) => {
      if (
        paused ||
        wakeTimer ||
        auth.status !== "signedIn" ||
        initializedUserRef.current !== auth.user?.id
      )
        return;
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        if (!hasUnsyncedLocalChanges()) return;
        setPendingChanges(true);
        if (!networkAvailableRef.current) {
          setStatus("offline");
          return;
        }
        if (NativeAppState.currentState !== "active") return;
        autoSyncFirstChangeAtRef.current = null;
        autoSyncLastChangeAtRef.current = null;
        performSyncRef.current?.().catch(() => undefined);
      }, 0);
    });
    return () => {
      unsubscribe();
      if (wakeTimer) clearTimeout(wakeTimer);
    };
  }, [auth.status, auth.user?.id, hasUnsyncedLocalChanges]);

  useEffect(() => {
    const initializationPending = remoteInitializationPendingRef.current;
    if (
      !nextRetryAt ||
      !networkAvailable ||
      (!pendingChanges && !initializationPending) ||
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
    if (
      !supabase ||
      !networkAvailable ||
      auth.status !== "signedIn" ||
      !auth.user
    )
      return;
    const client = supabase;
    const handleInvalidation = (next: { revision?: number }) => {
      const expectedRevision = Number(next.revision ?? 0);
      if (expectedRevision <= revisionRef.current) return;
      // Database-triggered Broadcast is not covered by channel `self: false`.
      // The v27 topic deliberately carries only the revision, so ignore the
      // exact optimistic revision this runtime is writing. If another device
      // wins that revision, the local write conflicts and its recovery pull
      // fetches the winner rather than relying on this invalidation.
      if (
        expectedRevision === snapshotWriteTargetRevisionRef.current
      )
        return;
      pullLatest(expectedRevision).catch(() => undefined);
    };
    const channel = client
      .channel(privacyAwareSnapshotTopic(auth.user.id), {
        config: { private: true, broadcast: { self: false } },
      })
      .on(
        "broadcast",
        { event: "snapshot_updated" },
        (event: { payload?: { revision?: number } }) =>
          handleInvalidation(event.payload ?? {}),
      )
      .subscribe();
    return () => {
      client.removeChannel(channel).catch(() => undefined);
    };
  }, [auth.status, auth.user, networkAvailable, pullLatest]);

  useEffect(() => {
    if (
      !supabase ||
      !networkAvailable ||
      auth.status !== "signedIn" ||
      !auth.user
    )
      return;
    let cancelled = false;
    let requestToWatch: PendingGroupRequest | null = null;
    let approvalCheckInFlight = false;
    const activateIfApproved = async (groupId: string) => {
      if (approvalCheckInFlight) return;
      approvalCheckInFlight = true;
      try {
        const shells = await readCloudResponsively((signal) =>
          loadCloudGroupShells(signal),
        );
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
        replaceState(optimistic, { source: "local" });
        await AsyncStorage.removeItem(PENDING_GROUP_KEY);
        requestToWatch = null;
        setPendingGroup(null);
        readCloudResponsively((signal) =>
          loadCloudWorkspace(
            optimistic,
            groupId,
            (metadata) => recordActivityMetadata(groupId, metadata),
            undefined,
            undefined,
            signal,
          ),
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
            replaceState(merged, { source: "cloud" });
            markGroupReadSucceeded(groupId);
          })
          .catch((error) => {
            setErrorMessage(
              `Group history will retry: ${errorText(error)}`,
            );
            scheduleGroupReadRetry(groupId);
          });
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
        (event) => {
          AsyncStorage.removeItem(PENDING_GROUP_KEY).catch(() => undefined);
          setPendingGroup(null);
          const removed = event.old as {
            group_id?: string;
            user_id?: string;
          };
          if (
            removed.user_id === auth.user?.id &&
            removed.group_id &&
            stateRef.current.groups.some(
              (group) => group.id === removed.group_id,
            )
          )
            void evictUnavailableGroup(removed.group_id);
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
    networkAvailable,
    markGroupReadSucceeded,
    mergeRemoteWorkspace,
    recordActivityMetadata,
    replaceState,
    scheduleGroupReadRetry,
    evictUnavailableGroup,
  ]);

  const refreshGroup = useCallback((): Promise<void> => {
    if (!isCloudGroupId(stateRef.current.group.id)) return Promise.resolve();
    if (groupRefreshPromiseRef.current)
      return groupRefreshPromiseRef.current;
    const groupId = stateRef.current.group.id;
    let operation: Promise<void>;
    operation = (async () => {
      const sequence = ++groupLoadSequenceRef.current;
      activityLoadSequenceRef.current += 1;
      await yieldCloudMaintenanceToUi();
      if (stateRef.current.group.id !== groupId) return;
      let loaded: AppState;
      try {
        loaded = await readCloudResponsively((signal) =>
          loadCloudWorkspace(
            stateRef.current,
            groupId,
            (metadata) => recordActivityMetadata(groupId, metadata),
            undefined,
            undefined,
            signal,
          ),
        );
      } catch (error) {
        if (isDefinitiveGroupMembershipLoss(error)) {
          await evictUnavailableGroup(groupId);
          return;
        }
        scheduleGroupReadRetry(groupId);
        throw error;
      }
      await yieldCloudMaintenanceToUi();
      if (
        sequence !== groupLoadSequenceRef.current ||
        stateRef.current.group.id !== groupId
      )
        return;
      const refreshed = mergeRemoteWorkspace(loaded, stateRef.current);
      stateRef.current = refreshed;
      workspaceHashRef.current =
        workspaceAckHashesRef.current.get(groupId) ?? null;
      replaceState(refreshed, { source: "cloud" });
      markGroupReadSucceeded(groupId);
    })().finally(() => {
      if (groupRefreshPromiseRef.current === operation)
        groupRefreshPromiseRef.current = null;
    });
    groupRefreshPromiseRef.current = operation;
    return operation;
  }, [
    markGroupReadSucceeded,
    mergeRemoteWorkspace,
    recordActivityMetadata,
    replaceState,
    scheduleGroupReadRetry,
    evictUnavailableGroup,
  ]);

  const refreshMessages = useCallback((): Promise<void> => {
    if (!isCloudGroupId(stateRef.current.group.id)) return Promise.resolve();
    if (messageRefreshPromiseRef.current)
      return messageRefreshPromiseRef.current;
    const groupId = stateRef.current.group.id;
    let operation: Promise<void>;
    operation = (async () => {
      try {
        await yieldCloudMaintenanceToUi();
        if (stateRef.current.group.id !== groupId) return;
        const messages = await readCloudResponsively((signal) =>
          loadCloudMessages(stateRef.current, groupId, signal),
        );
        await yieldCloudMaintenanceToUi();
        if (stateRef.current.group.id !== groupId) return;
        clearMessageReadRetry(groupId);
        if (messagesEquivalent(stateRef.current.messages, messages)) return;
        const next = { ...stateRef.current, messages };
        stateRef.current = next;
        // Do not hash or reload the full group workspace for a chat-only update.
        replaceState(next, { source: "cloud" });
      } catch (error) {
        scheduleMessageReadRetry(groupId);
        throw error;
      }
    })().finally(() => {
      if (messageRefreshPromiseRef.current === operation)
        messageRefreshPromiseRef.current = null;
    });
    messageRefreshPromiseRef.current = operation;
    return operation;
  }, [clearMessageReadRetry, replaceState, scheduleMessageReadRetry]);
  messageReadRetryRunnerRef.current = (groupId) => {
    if (stateRef.current.group.id !== groupId) return;
    void refreshMessages().catch(() => undefined);
  };

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
          await yieldCloudMaintenanceToUi();
          if (stateRef.current.group.id !== groupId) continue;
          let activity: Awaited<ReturnType<typeof loadCloudGroupActivity>>;
          try {
            activity = await readCloudResponsively((signal) =>
              loadCloudGroupActivity(
                stateRef.current,
                groupId,
                queuedSince ?? undefined,
                signal,
              ),
            );
          } catch (error) {
            // The request was removed from the queue before its network read.
            // Restore that exact coverage (merging any newer invalidation that
            // arrived in flight) so a transient failure cannot lose history.
            queuedActivitySinceRef.current = mergeQueuedActivitySince(
              queuedActivitySinceRef.current,
              queuedSince,
            );
            scheduleActivityReadRetry(groupId);
            throw error;
          }
          await yieldCloudMaintenanceToUi();
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
          const fenceFilteredEntries = applySharedMetricPrivacyFences(
            live.entries,
            activity.privacyFences ?? [],
            live.currentUserId,
          );
          const fenceFilteredStatuses = applySharedMetricPrivacyFences(
            live.dailyMetricStatuses,
            activity.privacyFences ?? [],
            live.currentUserId,
          );
          const baseEntries = activity.authoritativeEntrySinceDate
            ? fenceFilteredEntries.filter(
                (entry) =>
                  entry.userId === live.currentUserId ||
                  !groupMetricIds.has(entry.metricId) ||
                  !groupMemberIds.has(entry.userId) ||
                  entry.localDate < activity.authoritativeEntrySinceDate!,
              )
            : fenceFilteredEntries;
          const baseStatuses = activity.authoritativeStatusSinceDate
            ? fenceFilteredStatuses.filter(
                (status) =>
                  status.groupId !== groupId ||
                  status.userId === live.currentUserId ||
                  status.localDate < activity.authoritativeStatusSinceDate!,
              )
            : fenceFilteredStatuses;
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
          replaceState(next, { source: "cloud" });
          const cached = cachedGroupActivity(next, groupId);
          scheduleResponsiveWork(() => {
            writeGroupActivityCache({
              groupId,
              version: activity.version,
              updatedAt: activity.updatedAt,
              ...cached,
            }).catch(() => undefined);
          }, {
            minimumDelayMs: 120,
            maximumDelayMs: 4_000,
            minimumUserQuietMs: 1_600,
          });
        }
        clearActivityReadRetry(stateRef.current.group.id);
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
    [clearActivityReadRetry, replaceState, scheduleActivityReadRetry],
  );
  activityReadRetryRunnerRef.current = (groupId) => {
    if (stateRef.current.group.id !== groupId) return;
    const queuedSince = queuedActivitySinceRef.current;
    if (queuedSince === undefined) return;
    void refreshGroupActivity(queuedSince ?? undefined).catch(() => undefined);
  };

  useEffect(() => {
    if (
      !hydrated ||
      auth.status !== "signedIn" ||
      !auth.user ||
      !networkAvailable
    )
      return;
    // The relational outbox is account-scoped, so startup drains events even
    // for a group the user has just left and can no longer open locally.
    void flushPendingGroupPushEvents().catch(() => undefined);
  }, [auth.status, auth.user, hydrated, networkAvailable]);

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
    if (!restoreWorkspaceConflictRetry(auth.user.id)) {
      cloudRetryAttemptRef.current = 0;
      nextRetryAtRef.current = 0;
      setNextRetryAt(0);
    }
    // A genuine offline -> online transition starts one new bounded retry
    // window for durable chat rows that exhausted their previous attempt set.
    chatOutboxAttemptsRef.current.clear();
    void recoverChatOutbox();
    void flushPendingGroupPushEvents().catch(() => undefined);
    if (remoteInitializationPendingRef.current) {
      setInitializationAttempt((value) => value + 1);
      return;
    }
    const tasks = new Set<{ cancel: () => void }>();
    const later = (
      minimumDelayMs: number,
      maximumDelayMs: number,
      work: () => void,
    ) => {
      const task = scheduleResponsiveWork(work, {
        minimumDelayMs,
        maximumDelayMs,
      });
      tasks.add(task);
    };
    // The durable account outbox goes first, but no longer competes with the
    // first tap after Android reports that connectivity returned.
    later(260, 1_500, () => {
      performSync(false, false).catch(() => undefined);
    });
    later(700, 2_400, () => {
      verifyActiveGroupMembership().catch(() => undefined);
      refreshMessages().catch(() => undefined);
    });
    // Group history can be large and is independently durable on the server.
    // Hydrate it after account/chat recovery instead of landing every response
    // and state replacement in the same JS turn.
    later(1_600, 4_000, () => {
      refreshGroupActivity(
        dateWithOffsetFrom(dateKey(), -(GROUP_ACTIVITY_LOCAL_CACHE_DAYS - 1)),
      ).catch(() => undefined);
      const retryGroupId = groupReadRetryGroupIdRef.current;
      if (retryGroupId) scheduleGroupReadRetry(retryGroupId);
      const retryActivityGroupId = activityReadRetryGroupIdRef.current;
      if (retryActivityGroupId)
        scheduleActivityReadRetry(retryActivityGroupId);
    });
    return () => {
      tasks.forEach((task) => task.cancel());
      tasks.clear();
    };
  }, [
    auth.status,
    auth.user,
    evictUnavailableGroup,
    flushChatOutbox,
    networkAvailable,
    performSync,
    recoverChatOutbox,
    refreshGroupActivity,
    refreshMessages,
    restoreWorkspaceConflictRetry,
    scheduleActivityReadRetry,
    scheduleGroupReadRetry,
    verifyActiveGroupMembership,
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
        await yieldCloudMaintenanceToUi();
        if (stateRef.current.group.id !== groupId) return base;
        // Start the authoritative request immediately. Reading SQLite must not
        // sit in front of the network request; the cache and server race in
        // parallel, while each still commits as one complete snapshot.
        const workspacePromise = readCloudResponsively((signal) =>
          loadCloudWorkspace(
            base,
            groupId,
            (metadata) => recordActivityMetadata(groupId, metadata),
            undefined,
            undefined,
            signal,
          ),
        );
        const cached = await readGroupActivityCache(groupId).catch(
          () => null,
        );
        await yieldCloudMaintenanceToUi();
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
          replaceState(next, { source: "cloud" });
        }
        const workspace = await workspacePromise;
        await yieldCloudMaintenanceToUi();
        return workspace;
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
          replaceState(next, { source: "cloud" });
          markGroupReadSucceeded(groupId);
          setPendingChanges(hasUnsyncedLocalChanges());
          const cachePayload = cachedGroupActivity(next, groupId);
          scheduleResponsiveWork(() => {
            writeGroupActivityCache({
              groupId,
              updatedAt: new Date().toISOString(),
              ...cachePayload,
            }).catch(() => undefined);
          }, {
            minimumDelayMs: 120,
            maximumDelayMs: 4_000,
            minimumUserQuietMs: 1_600,
          });
        })
        .catch((error) => {
          if (isDefinitiveGroupMembershipLoss(error)) {
            void evictUnavailableGroup(groupId);
            return;
          }
          setErrorMessage(`Group refresh will retry: ${errorText(error)}`);
          scheduleGroupReadRetry(groupId);
        });
    },
    [
      hasUnsyncedLocalChanges,
      markGroupReadSucceeded,
      mergeRemoteWorkspace,
      recordActivityMetadata,
      replaceState,
      scheduleGroupReadRetry,
      evictUnavailableGroup,
    ],
  );
  groupReadRetryRunnerRef.current = hydrateGroupInBackground;

  useEffect(
    () => () => {
      clearGroupReadRetry();
      clearMessageReadRetry();
      clearActivityReadRetry();
      queuedActivitySinceRef.current = undefined;
    },
    [
      auth.user?.id,
      clearActivityReadRetry,
      clearGroupReadRetry,
      clearMessageReadRetry,
      state.group.id,
    ],
  );

  useEffect(() => {
    if (
      !supabase ||
      auth.status !== "signedIn" ||
      !auth.user ||
      !networkAvailable ||
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
          table: "groups",
          filter: `id=eq.${state.group.id}`,
        },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
        },
        (event) => {
          const row = event.new as ProfileRealtimeRow;
          if (row.id === stateRef.current.currentUserId) {
            // The private revision is the canonical merge boundary for this
            // account. Pull it instead of turning an incoming self-profile row
            // into a new local outbox write.
            const revision = Number(row.account_revision);
            if (
              Number.isSafeInteger(revision) &&
              revision <= revisionRef.current
            )
              return;
            pullLatest(
              Number.isSafeInteger(revision) ? revision : undefined,
            ).catch(() => undefined);
            return;
          }
          const live = stateRef.current;
          const previousAvatarPath = live.groups
            .flatMap((group) => [
              ...group.members,
              ...(group.pendingMembers ?? []),
            ])
            .find((member) => member.id === row.id)?.avatarStoragePath;
          const next = applyProfileRealtimeRow(live, row);
          if (!next) {
            queueRefresh();
            return;
          }
          if (next !== live) {
            stateRef.current = next;
            replaceState(next, { source: "cloud" });
          }
          // Names apply from the tiny realtime row immediately. Only a changed
          // private-bucket object needs the deferred shell refresh for a new
          // signed URL.
          if (previousAvatarPath !== (row.avatar_path ?? undefined))
            queueRefresh();
        },
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
            const removed = event.old as { group_id?: string };
            if (removed.group_id === stateRef.current.group.id)
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
            replaceState(next, { source: "cloud" });
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
    networkAvailable,
    pullLatest,
    refreshGroup,
    refreshGroupActivity,
    refreshMessages,
    replaceState,
    state.group.id,
  ]);

  useEffect(() => {
    const resumeTasks = new Set<{ cancel: () => void }>();
    const later = (
      minimumDelayMs: number,
      maximumDelayMs: number,
      work: () => void,
    ) => {
      const task = scheduleResponsiveWork(() => {
        if (NativeAppState.currentState === "active") work();
      }, { minimumDelayMs, maximumDelayMs });
      resumeTasks.add(task);
    };
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next !== "active") {
        resumeTasks.forEach((task) => task.cancel());
        resumeTasks.clear();
        return;
      }
      if (
        auth.status !== "signedIn" ||
        Date.now() - lastResumeRecoveryAtRef.current < 3000
      )
        return;
      lastResumeRecoveryAtRef.current = Date.now();
      if (!networkAvailableRef.current) {
        setStatus("offline");
        return;
      }
      if (supabase && !supabase.realtime.isConnected())
        supabase.realtime.connect();
      if (auth.user)
        void readCloudSyncCheckpoint(auth.user.id)
          .then(recordServerSyncedAt)
          .catch(() => undefined);
      const initializationPending = remoteInitializationPendingRef.current;
      if (initializationPending) {
        if (!auth.user || !restoreWorkspaceConflictRetry(auth.user.id)) {
          cloudRetryAttemptRef.current = 0;
          nextRetryAtRef.current = 0;
          setNextRetryAt(0);
        }
        setInitializationAttempt((value) => value + 1);
      }
      const retryGroupId = groupReadRetryGroupIdRef.current;
      if (retryGroupId) scheduleGroupReadRetry(retryGroupId);
      const retryActivityGroupId = activityReadRetryGroupIdRef.current;
      if (retryActivityGroupId)
        scheduleActivityReadRetry(retryActivityGroupId);
      // Resume cached UI first, then recover chat and pending writes in
      // separate turns. The activity subscription checks its lightweight
      // server version on reconnect and only reloads history when it changed.
      later(220, 1_400, () => {
        void recoverChatOutbox();
        void flushPendingGroupPushEvents().catch(() => undefined);
        refreshMessages().catch(() => undefined);
      });
      // If the app was backgrounded for longer than the freshness window,
      // publish one compact leaderboard assertion after resume. The helper is
      // independently throttled and never marks the private outbox pending.
      later(1_500, 3_200, () => {
        publishLeaderboardFreshness().catch(() => undefined);
      });
      // `pendingChanges` is presentation state and may still be false when the
      // app was suspended before the autosave timer fired. Inspect the durable
      // local outbox on resume so closing/reopening never makes manual Cloud
      // Sync a prerequisite for publishing a just-made edit.
      if (!initializationPending)
        later(650, 2_000, () => {
          // Hashing a year-long offline snapshot is deliberately outside the
          // native AppState callback so the first resumed frame and tap are
          // never held up by JSON serialization.
          if (
            pendingChanges ||
            status === "offline" ||
            hasUnsyncedLocalChanges()
          )
            performSync().catch(() => undefined);
        });
      later(1_050, 2_800, () => {
        verifyActiveGroupMembership().catch(() => undefined);
        void touchPresence(true).catch(() => undefined);
      });
    });
    return () => {
      subscription.remove();
      resumeTasks.forEach((task) => task.cancel());
      resumeTasks.clear();
    };
  }, [
    auth.status,
    auth.user,
    flushChatOutbox,
    hasUnsyncedLocalChanges,
    pendingChanges,
    performSync,
    publishLeaderboardFreshness,
    recoverChatOutbox,
    recordServerSyncedAt,
    refreshMessages,
    restoreWorkspaceConflictRetry,
    scheduleActivityReadRetry,
    scheduleGroupReadRetry,
    status,
    touchPresence,
    verifyActiveGroupMembership,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      !networkAvailable ||
      !isCloudGroupId(state.group.id)
    )
      return;
    const timer = setInterval(() => {
      publishLeaderboardFreshness().catch(() => undefined);
    }, LEADERBOARD_FRESHNESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [
    auth.status,
    networkAvailable,
    publishLeaderboardFreshness,
    state.group.id,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      !networkAvailable ||
      !isCloudGroupId(state.group.id)
    )
      return;
    void touchPresence(true).catch(() => undefined);
    const timer = setInterval(() => {
      if (NativeAppState.currentState === "active")
        void touchPresence().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [auth.status, networkAvailable, state.group.id, touchPresence]);

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
          workspaceConflictGateRef.current = null;
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
        await performSync(false, true, true);
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
        await replaceState(next, {
          source: "local",
          persistImmediately: true,
        });
        if (stateRef.current.currentUserId !== auth.user!.id) return;
        await writeGroupConfigurationAcks(
          auth.user!.id,
          groupConfigurationAckHashesRef.current,
        ).catch(() => undefined);
        setPendingChanges(true);
        hydrateGroupInBackground(groupId);
      },
      joinGroup: async (code) => {
        const result = await joinCloudGroup(code);
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
          // The membership transaction created a canonical durable event.
          // Dispatch is best-effort here and is retried on reconnect/startup.
          flushPendingGroupPushEvents().catch(() => undefined);
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
        replaceState(next, { source: "local" });
        setPendingChanges(true);
        await AsyncStorage.removeItem(PENDING_GROUP_KEY);
        setPendingGroup(null);
        hydrateGroupInBackground(groupId);
        flushPendingGroupPushEvents().catch(() => undefined);
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
        replaceState(next, { source: "local" });
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
        replaceState(next, { source: "local" });
        try {
          await leaveCloudGroup(groupId);
          // Send only after the membership mutation commits. The trigger-owned
          // outbox survives this former member losing group RLS access.
          await flushPendingGroupPushEvents().catch(() => undefined);
          const purged = purgeDepartedGroupData(
            stateRef.current,
            leavingGroup,
          );
          stateRef.current = purged;
          replaceState(purged, { source: "local" });
          await removeGroupActivityCache(groupId).catch(() => undefined);
          activityVersionByGroupRef.current.delete(groupId);
          activityCoverageSinceByGroupRef.current.delete(groupId);
          workspaceAckHashesRef.current.delete(groupId);
          groupConfigurationAckHashesRef.current.delete(groupId);
          setPendingChanges(true);
          if (isCloudGroupId(nextGroup.id))
            hydrateGroupInBackground(nextGroup.id);
        } catch (error) {
          stateRef.current = before;
          replaceState(before, { source: "local" });
          throw error;
        }
      },
      refreshGroup,
      refreshActivity: (sinceDate) => {
        const groupId = stateRef.current.group.id;
        const requestedSince = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate ?? "")
          ? sinceDate
          : undefined;
        const loadedSince = activityCoverageSinceByGroupRef.current.get(groupId);
        // Range hydration is idempotent: once a period is present locally,
        // revisiting the Leaderboard should not download and re-render it.
        // Realtime keeps that cache current; parameterless manual refreshes
        // remain a deliberate force-refresh escape hatch.
        if (requestedSince && loadedSince && loadedSince <= requestedSince)
          return Promise.resolve();
        // A deliberate user refresh is also the mixed-version escape hatch:
        // older installed clients do not publish activity commit versions.
        if (!requestedSince) {
          activityVersionByGroupRef.current.delete(groupId);
          activityCoverageSinceByGroupRef.current.delete(groupId);
        }
        return refreshGroupActivity(
          requestedSince
            ? requestedSince
            : dateWithOffsetFrom(
                dateKey(),
                -(GROUP_ACTIVITY_LOCAL_CACHE_DAYS - 1),
              ),
        );
      },
      refreshMessages,
      syncMessagesNow: async (messageId) => {
        await pushCloudMessagesNow(stateRef.current, messageId);
        if (messageId) {
          chatOutboxPendingRef.current.delete(messageId);
          chatOutboxAttemptsRef.current.delete(messageId);
        }
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
          replaceState(optimistic, { source: "cloud" });
        }
        await flushPendingGroupPushEvents().catch(() => undefined);
        refreshGroup().catch(() => undefined);
      },
      removeMember: async (userId) => {
        const groupId = stateRef.current.group.id;
        await removeCloudGroupMember(groupId, userId);
        await flushPendingGroupPushEvents().catch(() => undefined);
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
          replaceState(next, { source: "cloud" });
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
      refreshActivity: (sinceDate) =>
        latestValueRef.current.refreshActivity(sinceDate),
      refreshMessages: () => latestValueRef.current.refreshMessages(),
      syncMessagesNow: (messageId) =>
        latestValueRef.current.syncMessagesNow(messageId),
      approveMember: (userId) =>
        latestValueRef.current.approveMember(userId),
      removeMember: (userId) => latestValueRef.current.removeMember(userId),
    }),
    [],
  );
  const accountBoundaryPending =
    hydrated &&
    auth.status === "signedIn" &&
    Boolean(auth.user?.id) &&
    accountBoundaryReadyUserId !== auth.user?.id;

  return (
    <CloudSyncStatusContext.Provider value={status}>
      <CloudSyncActionsContext.Provider value={actions}>
        <CloudSyncContext.Provider value={value}>
          {accountBoundaryPending ? (
            <View
              accessibilityLabel={translateUiText(
                state.settings.language,
                "Restoring offline account data",
              )}
              accessibilityRole="progressbar"
              style={{
                alignItems: "center",
                backgroundColor: state.settings.darkMode ? "#0E1116" : "#F7F8FA",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <ActivityIndicator
                color={state.group.themeColor ?? "#5B7CFA"}
                size="large"
              />
            </View>
          ) : (
            children
          )}
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
