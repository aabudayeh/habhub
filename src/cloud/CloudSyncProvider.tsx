import AsyncStorage from "@react-native-async-storage/async-storage";
import { User } from "@supabase/supabase-js";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState as NativeAppState, Platform } from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import {
  approveCloudGroupMember,
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
  pushCloudWorkspace,
  pushCloudMessagesNow,
} from "@/src/cloud/groupCloud";
import { createInitialState } from "@/src/data/seed";
import { dateKey } from "@/src/domain/date";
import {
  DEFAULT_GROUP_THEME,
  groupMetricDefinitions,
} from "@/src/domain/groupSetup";
import { upgradeStateV21 } from "@/src/domain/stateMigration";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import {
  AppState,
  ChatMessage,
  Group,
  GroupCreationOptions,
  Member,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

const DEVICE_ID_KEY = "paceboard-cloud-device-id-v1";
const PENDING_GROUP_KEY = "metric-rally-pending-group-v1";
const MEDIA_BUCKET = "paceboard-media";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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
  syncMessagesNow: () => Promise<void>;
  approveMember: (userId: string) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
};

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

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

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
  const metadataName =
    user.user_metadata?.display_name ??
    user.user_metadata?.full_name ??
    user.user_metadata?.name;
  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split("@")[0] || fallback;
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
  const name = accountName(user, "MetricRally member");
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
  const group: Group = {
    id: `account-starter-${user.id}`,
    name: "Personal setup",
    inviteCode: "CREATE-GROUP",
    templateName: "Healthy Competition",
    members: [
      {
        id: user.id,
        name,
        initials:
          name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] ?? "")
            .join("")
            .toUpperCase() || "P",
        color: "#176B4D",
        role: "owner",
      },
    ],
    streakRestDaysPerWeek: 1,
    themeColor: "#176B4D",
    metricConfiguration: metrics,
  };
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
      metrics
        .filter(
          (metric) =>
            metric.sections.today &&
            metric.goalEnabled !== false &&
            !["weight", "weekly_deficit_balance", "overall_score"].includes(
              metric.id,
            ),
        )
        .map((metric) => [metric.id, [{ from: today }]]),
    ),
    selectedGroupMetricId: "steps",
    lastSavedAt: null,
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
      version: 21,
      settings: { ...state.settings, fontScale: state.settings.fontScale ?? 1 },
    }, defaults, sourceVersion);
  if (sourceVersion >= 19)
    return upgradeStateV21({
      ...state,
      version: 21,
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
      version: 21,
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
    version: 21,
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
    const members: Member[] = [];
    for (const member of group.members) {
      if (
        member.id === userId &&
        !member.avatarStoragePath &&
        isUploadableLocalUri(member.avatarUri ?? null)
      ) {
        const path = await uploadMedia(
          userId,
          "avatar",
          member.id,
          member.avatarUri!,
        );
        members.push({ ...member, avatarStoragePath: path });
        changed = true;
      } else members.push(member);
    }
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
    members: group.members.map((member) =>
      member.avatarStoragePath ? { ...member, avatarUri: undefined } : member,
    ),
  }));
  return {
    ...state,
    group: groups.find((group) => group.id === state.group.id) ?? state.group,
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

function valueHash(value: unknown) {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function stableHash(state: AppState) {
  return valueHash(snapshotPayload(state));
}

/** Only data represented by relational group tables belongs in a group push. */
function workspaceHash(state: AppState) {
  const payload = snapshotPayload(state);
  return valueHash({
    currentUserId: payload.currentUserId,
    group: payload.group,
    groupMetrics: payload.group.metricConfiguration ?? [],
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
    messages: payload.messages.filter(
      (message) => message.senderId === payload.currentUserId,
    ),
    dailyMetricStatuses: payload.dailyMetricStatuses.filter(
      (status) => status.userId === payload.currentUserId,
    ),
  });
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

function mergeById<T extends { id: string }>(remote: T[], local: T[]) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function mergeStates(remote: AppState, local: AppState): AppState {
  const groups = mergeById(remote.groups, local.groups);
  return {
    ...remote,
    ...local,
    groups,
    group: groups.find((group) => group.id === local.group.id) ?? local.group,
    entries: mergeById(remote.entries, local.entries),
    photos: mergeById(remote.photos, local.photos),
    messages: mergeById(remote.messages, local.messages),
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
  const [status, setStatus] = useState<CloudSyncStatus>(
    auth.status === "signedIn" ? "initializing" : "disabled",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [pendingGroup, setPendingGroup] =
    useState<PendingGroupRequest | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const hashRef = useRef<string | null>(null);
  const workspaceHashRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const initializedUserRef = useRef<string | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressGroupRefreshUntilRef = useRef(0);
  stateRef.current = state;

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

  const pullLatest = useCallback(async () => {
    if (!auth.user || !supabase) return;
    setStatus("syncing");
    setErrorMessage(null);
    try {
      const remote = await fetchSnapshot(auth.user.id);
      if (!remote) return;
      revisionRef.current = remote.revision;
      const bound = bindStateToAccount(remote.payload, auth.user);
      const resolvedRemote = await resolvePrivateMedia(bound);
      const remoteHash = stableHash(resolvedRemote);
      // Pulling group/chat updates can race with a just-finished Health Connect
      // import. Merge by stable client ids so the UI never flashes back to the
      // older cloud snapshot while the local import is still uploading.
      let resolved = mergeStates(resolvedRemote, stateRef.current);
      if (isCloudGroupId(resolved.group.id)) {
        try {
          resolved = await loadCloudWorkspace(resolved, resolved.group.id);
        } catch (groupError) {
          setErrorMessage(
            `Account synced; group refresh will retry: ${errorText(groupError)}`,
          );
        }
      }
      const resolvedHash = stableHash(resolved);
      hashRef.current = remoteHash;
      workspaceHashRef.current =
        resolvedHash === remoteHash ? workspaceHash(resolved) : null;
      replaceState(resolved);
      stateRef.current = resolved;
      setLastSyncedAt(remote.updated_at);
      setPendingChanges(resolvedHash !== remoteHash);
      setStatus("synced");
    } catch (error) {
      setStatus(
        /network|fetch|offline|timeout/i.test(String(error))
          ? "offline"
          : "error",
      );
      setErrorMessage(friendlySyncError(error));
    }
  }, [auth.user, replaceState]);

  const performSync = useCallback(async () => {
    if (!auth.user || !supabase || initializedUserRef.current !== auth.user.id)
      return;
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const operation = (async () => {
      // Routine debounced saves stay visually quiet. Explicit refresh controls
      // already expose their own progress and should not flash on every tap.
      setErrorMessage(null);
      try {
        const deviceId = deviceIdRef.current ?? (await getDeviceId());
        deviceIdRef.current = deviceId;
        let candidate =
          stateRef.current.currentUserId === auth.user!.id
            ? stateRef.current
            : bindStateToAccount(stateRef.current, auth.user!);
        candidate = await uploadOwnedMedia(candidate);
        const candidateHash = stableHash(candidate);
        if (candidate !== stateRef.current) {
          replaceState(candidate);
          stateRef.current = candidate;
        }
        const nextWorkspaceHash = workspaceHash(candidate);
        let workspaceSynced = true;
        let workspaceWarning: string | null = null;
        if (
          isCloudGroupId(candidate.group.id) &&
          nextWorkspaceHash !== workspaceHashRef.current
        ) {
          suppressGroupRefreshUntilRef.current = Date.now() + 3000;
          try {
            await pushCloudWorkspace(candidate);
          } catch (error) {
            // Group tables and the private account snapshot are independent.
            // Preserve settings and imported health data even when one shared
            // table is temporarily unavailable, then retry group data later.
            workspaceSynced = false;
            workspaceWarning = `Group data will retry: ${errorText(error) || "unknown server error"}`;
          }
        }
        const payload = snapshotPayload(candidate);
        const result = await writeSnapshot(
          auth.user!.id,
          payload,
          revisionRef.current,
          deviceId,
        );
        revisionRef.current = result.revision;
        const syncedAt = result.updatedAt;
        hashRef.current = candidateHash;
        if (workspaceSynced) workspaceHashRef.current = nextWorkspaceHash;
        setLastSyncedAt(syncedAt);
        setPendingChanges(!workspaceSynced);
        setStatus("synced");
        setErrorMessage(workspaceWarning);
        supabase
          .rpc("register_account_device", {
            client_device_id: deviceId,
            client_platform: Platform.OS,
            client_label: null,
          })
          .then(() => undefined, () => undefined);
        loadDevices().catch(() => undefined);
      } catch (error) {
        if (/snapshot_conflict/i.test(String(error))) {
          setStatus("conflict");
          const remote = await fetchSnapshot(auth.user!.id).catch(() => null);
          if (remote) {
            revisionRef.current = remote.revision;
            const merged = mergeStates(
              bindStateToAccount(remote.payload, auth.user!),
              stateRef.current,
            );
            replaceState(merged);
            stateRef.current = merged;
            setPendingChanges(true);
            setErrorMessage(
              "Changes from two devices were merged. Sync once more to confirm them.",
            );
            return;
          }
        }
        const offline = /network|fetch|offline|timeout/i.test(String(error));
        setStatus(offline ? "offline" : "error");
        setPendingChanges(true);
        setErrorMessage(friendlySyncError(error));
      } finally {
        syncPromiseRef.current = null;
      }
    })();
    syncPromiseRef.current = operation;
    return operation;
  }, [auth.user, loadDevices, replaceState]);

  useEffect(() => {
    if (!hydrated || auth.status !== "signedIn" || !auth.user || !supabase) {
      initializedUserRef.current = null;
      setStatus("disabled");
      return;
    }
    let cancelled = false;
    const user = auth.user;
    setStatus("initializing");
    setErrorMessage(null);
    (async () => {
      try {
        const deviceId = await getDeviceId();
        if (cancelled) return;
        deviceIdRef.current = deviceId;
        const remote = await fetchSnapshot(user.id);
        if (cancelled) return;
        let correctedAccountState = false;
        if (remote) {
          revisionRef.current = remote.revision;
          correctedAccountState =
            remote.payload.currentUserId !== user.id ||
            isDemoBoundState(remote.payload);
          const bound = bindStateToAccount(remote.payload, user);
          let resolved = await resolvePrivateMedia(bound);
          // The cached device state is rendered first. Preserve its stable-id
          // local writes while the older cloud snapshot and group tables load
          // in the background; the next normal sync uploads the merged result.
          if (
            stateRef.current.currentUserId === user.id &&
            !isDemoBoundState(stateRef.current)
          )
            resolved = mergeStates(resolved, stateRef.current);
          let existingGroups: Group[] = [];
          try {
            existingGroups = await loadCloudGroupShells();
          } catch (groupError) {
            setErrorMessage(
              `Account restored; group refresh will retry: ${errorText(groupError)}`,
            );
          }
          const targetGroup =
            existingGroups.find((group) => group.id === resolved.group.id) ??
            existingGroups[0];
          if (targetGroup)
            resolved = await loadCloudWorkspace(
              { ...resolved, groups: existingGroups },
              targetGroup.id,
            );
          if (!cancelled) {
            hashRef.current = correctedAccountState
              ? null
              : stableHash(resolved);
            workspaceHashRef.current = workspaceHash(resolved);
            replaceState(resolved);
            stateRef.current = resolved;
            setLastSyncedAt(remote.updated_at);
          }
        } else {
          let bound = bindStateToAccount(stateRef.current, user);
          let existingGroups: Group[] = [];
          try {
            existingGroups = await loadCloudGroupShells();
          } catch (groupError) {
            setErrorMessage(
              `Account ready; group refresh will retry: ${errorText(groupError)}`,
            );
          }
          if (existingGroups.length)
            bound = await loadCloudWorkspace(
              { ...bound, groups: existingGroups },
              existingGroups[0].id,
            );
          stateRef.current = bound;
          replaceState(bound);
          revisionRef.current = 0;
          hashRef.current = null;
          workspaceHashRef.current = existingGroups.length
            ? workspaceHash(bound)
            : null;
        }
        if (cancelled) return;
        initializedUserRef.current = user.id;
        await supabase!.rpc("register_account_device", {
          client_device_id: deviceId,
          client_platform: Platform.OS,
          client_label: null,
        });
        if (!remote || correctedAccountState) await performSync();
        else setStatus("synced");
        loadDevices().catch(() => undefined);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            /network|fetch|offline|timeout/i.test(String(error))
              ? "offline"
              : "error",
          );
          setErrorMessage(friendlySyncError(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      initializedUserRef.current = null;
    };
  }, [
    auth.status,
    auth.user,
    hydrated,
    loadDevices,
    performSync,
    replaceState,
  ]);

  useEffect(() => {
    if (
      auth.status !== "signedIn" ||
      initializedUserRef.current !== auth.user?.id
    )
      return;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Coalesce and defer full-snapshot hashing. Serializing the whole offline
    // state synchronously on every tap or keystroke caused phone UI stutter.
    timerRef.current = setTimeout(() => {
      const hash = stableHash(stateRef.current);
      if (hash === hashRef.current) return;
      setPendingChanges(true);
      performSync().catch(() => undefined);
    }, 2400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [auth.status, auth.user?.id, performSync, state]);

  useEffect(() => {
    if (!supabase || auth.status !== "signedIn" || !auth.user) return;
    const channel = supabase
      .channel(`account-snapshot:${auth.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_snapshots",
          filter: `user_id=eq.${auth.user.id}`,
        },
        (event) => {
          const next = event.new as { revision?: number; device_id?: string };
          if (
            Number(next.revision ?? 0) <= revisionRef.current ||
            next.device_id === deviceIdRef.current
          )
            return;
          pullLatest().catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [auth.status, auth.user, pullLatest]);

  useEffect(() => {
    if (!supabase || auth.status !== "signedIn" || !auth.user) return;
    let cancelled = false;
    const activateIfApproved = async (groupId: string) => {
      const shells = await loadCloudGroupShells();
      if (cancelled || !shells.some((group) => group.id === groupId)) return;
      const next = await loadCloudWorkspace(
        { ...stateRef.current, groups: shells },
        groupId,
      );
      if (cancelled) return;
      stateRef.current = next;
      hashRef.current = stableHash(next);
      workspaceHashRef.current = workspaceHash(next);
      replaceState(next);
      await AsyncStorage.removeItem(PENDING_GROUP_KEY);
      setPendingGroup(null);
    };
    AsyncStorage.getItem(PENDING_GROUP_KEY)
      .then((stored) => {
        const request = parsePendingGroup(stored);
        setPendingGroup(request);
        if (request) return activateIfApproved(request.groupId);
      })
      .catch(() => undefined);
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
          if (membership.group_id && membership.status === "active")
            activateIfApproved(membership.group_id).catch(() => undefined);
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
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [auth.status, auth.user, replaceState]);

  const refreshGroup = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const refreshed = await loadCloudWorkspace(
      stateRef.current,
      stateRef.current.group.id,
    );
    stateRef.current = refreshed;
    hashRef.current = stableHash(refreshed);
    workspaceHashRef.current = workspaceHash(refreshed);
    replaceState(refreshed);
  }, [replaceState]);

  const refreshMessages = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const messages = await loadCloudMessages(
      stateRef.current,
      stateRef.current.group.id,
    );
    const next = { ...stateRef.current, messages };
    stateRef.current = next;
    // Do not hash or reload the full group workspace for a chat-only update.
    replaceState(next);
  }, [replaceState]);

  const refreshGroupActivity = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const groupId = stateRef.current.group.id;
    const activity = await loadCloudGroupActivity(stateRef.current, groupId);
    if (stateRef.current.group.id !== groupId) return;
    const next = { ...stateRef.current, ...activity };
    stateRef.current = next;
    replaceState(next);
  }, [replaceState]);

  const hydrateGroupInBackground = useCallback(
    (groupId: string) => {
      const base = stateRef.current;
      loadCloudWorkspace(base, groupId)
        .then((next) => {
          // A slow response for an old group must never pull the user back
          // after they already switched elsewhere.
          if (stateRef.current.group.id !== groupId) return;
          stateRef.current = next;
          // Persist the active-group selection after the cached shell has been
          // replaced by the authoritative workspace.
          hashRef.current = null;
          workspaceHashRef.current = workspaceHash(next);
          replaceState(next);
          setPendingChanges(true);
        })
        .catch((error) =>
          setErrorMessage(`Group refresh will retry: ${errorText(error)}`),
        );
    },
    [replaceState],
  );

  useEffect(() => {
    if (
      !supabase ||
      auth.status !== "signedIn" ||
      !isCloudGroupId(state.group.id)
    )
      return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let messageTimer: ReturnType<typeof setTimeout> | null = null;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (Date.now() < suppressGroupRefreshUntilRef.current) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => refreshGroup().catch(() => undefined),
        500,
      );
    };
    const queueMessageRefresh = () => {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        refreshMessages().catch(() => undefined);
      }, 120);
    };
    const queueActivityRefresh = () => {
      if (Date.now() < suppressGroupRefreshUntilRef.current) return;
      if (activityTimer) clearTimeout(activityTimer);
      activityTimer = setTimeout(
        () => refreshGroupActivity().catch(() => undefined),
        350,
      );
    };
    const channel = supabase
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
        queueRefresh,
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
          table: "daily_metric_status",
          filter: `group_id=eq.${state.group.id}`,
        },
        queueActivityRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (messageTimer) clearTimeout(messageTimer);
      if (activityTimer) clearTimeout(activityTimer);
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [
    auth.status,
    refreshGroup,
    refreshGroupActivity,
    refreshMessages,
    state.group.id,
  ]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next === "active" && auth.status === "signedIn") {
        if (pendingChanges || status === "offline")
          performSync().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [auth.status, pendingChanges, performSync, status]);

  const value = useMemo<CloudSyncContextValue>(
    () => ({
      status,
      lastSyncedAt,
      errorMessage,
      pendingChanges,
      pendingGroup,
      devices,
      syncNow: performSync,
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
              color: "#176B4D",
              role: "owner" as const,
            };
        const group: Group = {
          id: groupId,
          name: name.trim(),
          inviteCode: "Loading...",
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
        workspaceHashRef.current = workspaceHash(next);
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
            color: "#176B4D",
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
            inviteCode: "Loading...",
            templateName: "Shared",
            members: [current],
            streakRestDaysPerWeek: 1,
            themeColor: "#176B4D",
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
        workspaceHashRef.current = workspaceHash(next);
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
        const next = { ...stateRef.current, group };
        stateRef.current = next;
        workspaceHashRef.current = workspaceHash(next);
        replaceState(next);
        if (isCloudGroupId(groupId)) hydrateGroupInBackground(groupId);
      },
      leaveGroup: async (groupId) => {
        const before = stateRef.current;
        const leavingMember = before.group.members.find(
          (member) => member.id === before.currentUserId,
        );
        const remaining = before.groups.filter((group) => group.id !== groupId);
        const nextGroup = remaining[0];
        if (!nextGroup)
          throw new Error(
            "Create another group before leaving your only group.",
          );
        const next = { ...before, group: nextGroup, groups: remaining };
        stateRef.current = next;
        workspaceHashRef.current = workspaceHash(next);
        replaceState(next);
        try {
          await sendMembershipPush({
            groupId,
            eventKey: `membership-left:${groupId}:${before.currentUserId}:${Date.now()}`,
            audience: "admins",
            title: `${leavingMember?.name ?? "A member"} left`,
            body: `${leavingMember?.name ?? "A member"} left ${before.group.name}.`,
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
      refreshActivity: refreshGroupActivity,
      refreshMessages,
      syncMessagesNow: async () => {
        await pushCloudMessagesNow(stateRef.current);
      },
      approveMember: async (userId) => {
        await approveCloudGroupMember(stateRef.current.group.id, userId);
        await sendMembershipPush({
          groupId: stateRef.current.group.id,
          eventKey: `membership-approved:${stateRef.current.group.id}:${userId}`,
          audience: "user",
          recipientId: userId,
          title: `Welcome to ${stateRef.current.group.name}`,
          body: `Your request was approved. Tap to open the group.`,
          route: "/group",
        }).catch(() => undefined);
        await refreshGroup();
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
        await removeCloudGroupMember(stateRef.current.group.id, userId);
        await refreshGroup();
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

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
    </CloudSyncContext.Provider>
  );
}

export function useCloudSync() {
  const context = useContext(CloudSyncContext);
  if (!context)
    throw new Error("useCloudSync must be used inside CloudSyncProvider");
  return context;
}
