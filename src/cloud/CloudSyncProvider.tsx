import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '@supabase/supabase-js';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState, Platform } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { createCloudGroup, isCloudGroupId, joinCloudGroup, leaveCloudGroup, loadCloudGroupShells, loadCloudWorkspace, pushCloudWorkspace } from '@/src/cloud/groupCloud';
import { createInitialState } from '@/src/data/seed';
import { dateKey } from '@/src/domain/date';
import { supabase } from '@/src/lib/supabase';
import { useApp } from '@/src/state/AppProvider';
import { AppState, ChatMessage, Group, Member, MetricEntry, PhotoUpdate } from '@/src/types';

const DEVICE_ID_KEY = 'paceboard-cloud-device-id-v1';
const MEDIA_BUCKET = 'paceboard-media';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type CloudSyncStatus = 'disabled' | 'initializing' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

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
  devices: AccountDevice[];
  syncNow: () => Promise<void>;
  pullLatest: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  forgetDevice: (deviceId: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  joinGroup: (code: string) => Promise<void>;
  switchGroup: (groupId: string) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;
  refreshGroup: () => Promise<void>;
};

type SnapshotRow = {
  payload: AppState;
  revision: number;
  updated_at: string;
  device_id: string | null;
  schema_version: number;
};

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

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
  const metadataName = user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name;
  return typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split('@')[0] || fallback;
}

function isDemoBoundState(state: AppState) {
  return state.group.id === 'weekend-warriors'
    || (!isCloudGroupId(state.group.id) && state.group.members.some((member) => ['sarah','daniel','maya'].includes(member.id)));
}

function createCleanAccountState(user: User): AppState {
  const defaults = createInitialState();
  const today = dateKey();
  const name = accountName(user, 'North member');
  const metrics = defaults.metrics.map((metric) => ({ ...metric, activeFrom: today }));
  const energyProfile = { age: 30, sex: 'unspecified' as const, heightCm: 170, weightKg: 70, targetWeightKg: 70, activityLevel: 'sedentary' as const, desiredWeeklyLossKg: 0.25 };
  const group: Group = {
    id: `account-starter-${user.id}`,
    name: 'Personal setup',
    inviteCode: 'CREATE-GROUP',
    templateName: 'Healthy Competition',
    members: [{ id: user.id, name, initials: name.split(/\s+/).slice(0,2).map((part)=>part[0]??'').join('').toUpperCase() || 'P', color: '#176B4D', role: 'owner' }],
    streakRestDaysPerWeek: 1,
    themeColor: '#176B4D',
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
    settings: { ...defaults.settings, baselineCalories: 2000, energyProfile, memberNicknamesByGroup: { [group.id]: {} }, badgeShowcaseByGroup: {} },
    trackedGoalPeriods: Object.fromEntries(metrics.filter((metric)=>metric.sections.today).map((metric)=>[metric.id,[{from:today}]])),
    selectedGroupMetricId: 'steps',
    lastSavedAt: null,
  };
}

/** Cloud identities never inherit another local account or the seeded demo member. */
function bindStateToAccount(state: AppState, user: User): AppState {
  if (state.currentUserId !== user.id || isDemoBoundState(state)) return createCleanAccountState(user);
  return state;
}

function photoUri(uri: PhotoUpdate['uri']) {
  if (typeof uri === 'string') return uri;
  if (typeof uri === 'object' && uri && 'uri' in uri) return uri.uri;
  return null;
}

function isUploadableLocalUri(uri: string | null) {
  return Boolean(uri && /^(file:|content:|ph:|blob:|data:)/i.test(uri));
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function mediaInfo(uri: string, contentType?: string | null) {
  const fromType = contentType?.toLowerCase();
  if (fromType?.includes('png')) return { extension: 'png', contentType: 'image/png' };
  if (fromType?.includes('webp')) return { extension: 'webp', contentType: 'image/webp' };
  if (fromType?.includes('heic') || /\.hei[cf](?:$|\?)/i.test(uri)) return { extension: 'heic', contentType: 'image/heic' };
  if (/\.png(?:$|\?)/i.test(uri)) return { extension: 'png', contentType: 'image/png' };
  if (/\.webp(?:$|\?)/i.test(uri)) return { extension: 'webp', contentType: 'image/webp' };
  return { extension: 'jpg', contentType: 'image/jpeg' };
}

async function uploadMedia(userId: string, kind: string, id: string, uri: string) {
  if (!supabase) throw new Error('Cloud is not configured.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Could not read the selected ${kind} image.`);
  const blob = await response.blob();
  if (blob.size > 25 * 1024 * 1024) throw new Error('Images must be smaller than 25 MB.');
  const info = mediaInfo(uri, blob.type);
  const path = `${userId}/account/${safePart(kind)}/${safePart(id)}.${info.extension}`;
  const bytes = await blob.arrayBuffer();
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: info.contentType,
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw error;
  return path;
}

async function uploadOwnedMedia(state: AppState): Promise<AppState> {
  const userId = state.currentUserId;
  let changed = false;
  const entries: MetricEntry[] = [];
  for (const entry of state.entries) {
    if (entry.userId === userId && !entry.imageStoragePath && isUploadableLocalUri(entry.imageUri ?? null)) {
      const path = await uploadMedia(userId, 'entry', entry.id, entry.imageUri!);
      entries.push({ ...entry, imageStoragePath: path }); changed = true;
    } else entries.push(entry);
  }
  const photos: PhotoUpdate[] = [];
  for (const photo of state.photos) {
    const uri = photoUri(photo.uri);
    if (photo.userId === userId && !photo.storagePath && isUploadableLocalUri(uri)) {
      const path = await uploadMedia(userId, 'photo', photo.id, uri!);
      photos.push({ ...photo, storagePath: path }); changed = true;
    } else photos.push(photo);
  }
  const messages: ChatMessage[] = [];
  for (const message of state.messages) {
    if (message.senderId === userId && !message.imageStoragePath && isUploadableLocalUri(message.imageUri ?? null)) {
      const path = await uploadMedia(userId, 'chat', message.id, message.imageUri!);
      messages.push({ ...message, imageStoragePath: path }); changed = true;
    } else messages.push(message);
  }
  const updateGroup = async (group: Group): Promise<Group> => {
    const members: Member[] = [];
    for (const member of group.members) {
      if (member.id === userId && !member.avatarStoragePath && isUploadableLocalUri(member.avatarUri ?? null)) {
        const path = await uploadMedia(userId, 'avatar', member.id, member.avatarUri!);
        members.push({ ...member, avatarStoragePath: path }); changed = true;
      } else members.push(member);
    }
    return { ...group, members };
  };
  const groups = [] as Group[];
  for (const group of state.groups) groups.push(await updateGroup(group));
  const currentGroup = groups.find((group) => group.id === state.group.id) ?? await updateGroup(state.group);
  return changed ? { ...state, entries, photos, messages, groups, group: currentGroup } : state;
}

/** Never persist temporary signed URLs; only stable private-bucket paths. */
function snapshotPayload(state: AppState): AppState {
  const groups = state.groups.map((group) => ({
    ...group,
    members: group.members.map((member) => member.avatarStoragePath ? { ...member, avatarUri: undefined } : member),
  }));
  return {
    ...state,
    group: groups.find((group) => group.id === state.group.id) ?? state.group,
    groups,
    entries: state.entries.map((entry) => entry.imageStoragePath ? { ...entry, imageUri: undefined } : entry),
    photos: state.photos.map((photo) => photo.storagePath ? { ...photo, uri: '' } : photo),
    messages: state.messages.map((message) => message.imageStoragePath ? { ...message, imageUri: undefined } : message),
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
    metrics: payload.metrics,
    energyProfile: payload.energyProfiles[payload.currentUserId] ?? payload.settings.energyProfile,
    aliases: payload.settings.memberNicknamesByGroup[payload.group.id] ?? {},
    entries: payload.entries.filter((entry) => entry.userId === payload.currentUserId),
    photos: payload.photos.filter((photo) => photo.userId === payload.currentUserId),
    messages: payload.messages.filter((message) => message.senderId === payload.currentUserId),
    dailyMetricStatuses: payload.dailyMetricStatuses.filter((status) => status.userId === payload.currentUserId),
  });
}

async function resolvePrivateMedia(state: AppState): Promise<AppState> {
  if (!supabase) return state;
  const paths = new Set<string>();
  state.groups.forEach((group) => group.members.forEach((member) => member.avatarStoragePath && paths.add(member.avatarStoragePath)));
  state.entries.forEach((entry) => entry.imageStoragePath && paths.add(entry.imageStoragePath));
  state.photos.forEach((photo) => photo.storagePath && paths.add(photo.storagePath));
  state.messages.forEach((message) => message.imageStoragePath && paths.add(message.imageStoragePath));
  if (!paths.size) return state;
  const orderedPaths = [...paths];
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(orderedPaths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  const urls = new Map((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
  const groups = state.groups.map((group) => ({ ...group, members: group.members.map((member) => member.avatarStoragePath && urls.get(member.avatarStoragePath) ? { ...member, avatarUri: urls.get(member.avatarStoragePath)! } : member) }));
  return {
    ...state,
    groups,
    group: groups.find((group) => group.id === state.group.id) ?? state.group,
    entries: state.entries.map((entry) => entry.imageStoragePath && urls.get(entry.imageStoragePath) ? { ...entry, imageUri: urls.get(entry.imageStoragePath)! } : entry),
    photos: state.photos.map((photo) => photo.storagePath && urls.get(photo.storagePath) ? { ...photo, uri: urls.get(photo.storagePath)! } : photo),
    messages: state.messages.map((message) => message.imageStoragePath && urls.get(message.imageStoragePath) ? { ...message, imageUri: urls.get(message.imageStoragePath)! } : message),
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
  const { data, error } = await supabase.from('user_snapshots')
    .select('payload, revision, updated_at, device_id, schema_version')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as SnapshotRow | null;
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = ['message', 'details', 'hint', 'code']
      .map((key) => typeof record[key] === 'string' ? String(record[key]) : '')
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(' · ');
    try { return JSON.stringify(error); } catch { return ''; }
  }
  return typeof error === 'string' ? error : '';
}

function friendlySyncError(error: unknown) {
  const message = errorText(error);
  if (/network|fetch|offline|timeout/i.test(message)) return 'Offline changes are safe on this device and will retry automatically.';
  if (/column.*revision|sync_user_snapshot|schema cache/i.test(message)) return 'Apply the latest Supabase migrations before enabling cloud sync.';
  return message || 'Cloud sync failed. Your local data is still safe.';
}

export function CloudSyncProvider({ children }: PropsWithChildren) {
  const { state, hydrated, replaceState } = useApp();
  const auth = useAuth();
  const [status, setStatus] = useState<CloudSyncStatus>(auth.status === 'signedIn' ? 'initializing' : 'disabled');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
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

  const loadDevices = useCallback(async () => {
    if (!supabase || !auth.user) return;
    const deviceId = deviceIdRef.current ?? await getDeviceId();
    deviceIdRef.current = deviceId;
    const { data, error } = await supabase.from('account_devices').select('device_id, platform, label, last_seen_at').order('last_seen_at', { ascending: false });
    if (error) throw error;
    setDevices((data ?? []).map((item) => ({ deviceId: item.device_id, platform: item.platform, label: item.label ?? undefined, lastSeenAt: item.last_seen_at, isThisDevice: item.device_id === deviceId })));
  }, [auth.user]);

  const pullLatest = useCallback(async () => {
    if (!auth.user || !supabase) return;
    setStatus('syncing'); setErrorMessage(null);
    try {
      const remote = await fetchSnapshot(auth.user.id);
      if (!remote) return;
      revisionRef.current = remote.revision;
      const bound = bindStateToAccount(remote.payload, auth.user);
      let resolved = await resolvePrivateMedia(bound);
      if (isCloudGroupId(resolved.group.id)) resolved = await loadCloudWorkspace(resolved, resolved.group.id);
      hashRef.current = stableHash(resolved);
      workspaceHashRef.current = workspaceHash(resolved);
      replaceState(resolved);
      setLastSyncedAt(remote.updated_at); setPendingChanges(false); setStatus('synced');
    } catch (error) {
      setStatus(/network|fetch|offline|timeout/i.test(String(error)) ? 'offline' : 'error');
      setErrorMessage(friendlySyncError(error));
    }
  }, [auth.user, replaceState]);

  const performSync = useCallback(async () => {
    if (!auth.user || !supabase || initializedUserRef.current !== auth.user.id) return;
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const operation = (async () => {
      setStatus('syncing'); setErrorMessage(null);
      try {
        const deviceId = deviceIdRef.current ?? await getDeviceId();
        deviceIdRef.current = deviceId;
        let candidate = bindStateToAccount(stateRef.current, auth.user!);
        candidate = await uploadOwnedMedia(candidate);
        if (stableHash(candidate) !== stableHash(stateRef.current)) {
          replaceState(candidate);
          stateRef.current = candidate;
        }
        const nextWorkspaceHash = workspaceHash(candidate);
        if (isCloudGroupId(candidate.group.id) && nextWorkspaceHash !== workspaceHashRef.current) {
          suppressGroupRefreshUntilRef.current = Date.now() + 3000;
          try { await pushCloudWorkspace(candidate); }
          catch (error) { throw new Error(`Group data could not sync: ${errorText(error) || 'unknown server error'}`); }
        }
        const payload = snapshotPayload(candidate);
        const { data, error } = await supabase.rpc('sync_user_snapshot', {
          expected_revision: revisionRef.current,
          new_payload: payload,
          client_device_id: deviceId,
          client_schema_version: payload.version,
        });
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        revisionRef.current = Number(result?.revision ?? revisionRef.current + 1);
        const syncedAt = result?.updated_at ?? new Date().toISOString();
        hashRef.current = stableHash(candidate);
        workspaceHashRef.current = nextWorkspaceHash;
        setLastSyncedAt(syncedAt); setPendingChanges(false); setStatus('synced');
        await supabase.rpc('register_account_device', { client_device_id: deviceId, client_platform: Platform.OS, client_label: null });
        loadDevices().catch(() => undefined);
      } catch (error) {
        if (/snapshot_conflict/i.test(String(error))) {
          setStatus('conflict');
          const remote = await fetchSnapshot(auth.user!.id).catch(() => null);
          if (remote) {
            revisionRef.current = remote.revision;
            const merged = mergeStates(bindStateToAccount(remote.payload, auth.user!), stateRef.current);
            replaceState(merged); stateRef.current = merged; setPendingChanges(true);
            setErrorMessage('Changes from two devices were merged. Sync once more to confirm them.');
            return;
          }
        }
        const offline = /network|fetch|offline|timeout/i.test(String(error));
        setStatus(offline ? 'offline' : 'error'); setPendingChanges(true); setErrorMessage(friendlySyncError(error));
      } finally {
        syncPromiseRef.current = null;
      }
    })();
    syncPromiseRef.current = operation;
    return operation;
  }, [auth.user, loadDevices, replaceState]);

  useEffect(() => {
    if (!hydrated || auth.status !== 'signedIn' || !auth.user || !supabase) {
      initializedUserRef.current = null;
      setStatus('disabled');
      return;
    }
    let cancelled = false;
    const user = auth.user;
    setStatus('initializing'); setErrorMessage(null);
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
          correctedAccountState = remote.payload.currentUserId !== user.id || isDemoBoundState(remote.payload);
          const bound = bindStateToAccount(remote.payload, user);
          let resolved = await resolvePrivateMedia(bound);
          const existingGroups = await loadCloudGroupShells();
          const targetGroup = existingGroups.find((group)=>group.id===resolved.group.id) ?? existingGroups[0];
          if (targetGroup) resolved = await loadCloudWorkspace({ ...resolved, groups: existingGroups }, targetGroup.id);
          if (!cancelled) { hashRef.current = correctedAccountState ? null : stableHash(resolved); workspaceHashRef.current = workspaceHash(resolved); replaceState(resolved); stateRef.current = resolved; setLastSyncedAt(remote.updated_at); }
        } else {
          let bound = bindStateToAccount(stateRef.current, user);
          const existingGroups = await loadCloudGroupShells();
          if (existingGroups.length) bound = await loadCloudWorkspace({ ...bound, groups: existingGroups }, existingGroups[0].id);
          stateRef.current = bound; replaceState(bound); revisionRef.current = 0; hashRef.current = null; workspaceHashRef.current = existingGroups.length ? workspaceHash(bound) : null;
        }
        if (cancelled) return;
        initializedUserRef.current = user.id;
        await supabase!.rpc('register_account_device', { client_device_id: deviceId, client_platform: Platform.OS, client_label: null });
        if (!remote || correctedAccountState) await performSync(); else setStatus('synced');
        loadDevices().catch(() => undefined);
      } catch (error) {
        if (!cancelled) { setStatus(/network|fetch|offline|timeout/i.test(String(error)) ? 'offline' : 'error'); setErrorMessage(friendlySyncError(error)); }
      }
    })();
    return () => { cancelled = true; initializedUserRef.current = null; };
  }, [auth.status, auth.user, hydrated, loadDevices, performSync, replaceState]);

  useEffect(() => {
    if (auth.status !== 'signedIn' || initializedUserRef.current !== auth.user?.id) return;
    const hash = stableHash(state);
    if (hash === hashRef.current) return;
    setPendingChanges(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => performSync(), 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [auth.status, auth.user?.id, performSync, state]);

  useEffect(() => {
    if (!supabase || auth.status !== 'signedIn' || !auth.user) return;
    const channel = supabase.channel(`account-snapshot:${auth.user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_snapshots', filter: `user_id=eq.${auth.user.id}` }, (event) => {
        const next = event.new as { revision?: number; device_id?: string };
        if (Number(next.revision ?? 0) <= revisionRef.current || next.device_id === deviceIdRef.current) return;
        pullLatest().catch(() => undefined);
      })
      .subscribe();
    return () => { supabase?.removeChannel(channel).catch(() => undefined); };
  }, [auth.status, auth.user, pullLatest]);

  const refreshGroup = useCallback(async () => {
    if (!isCloudGroupId(stateRef.current.group.id)) return;
    const refreshed = await loadCloudWorkspace(stateRef.current, stateRef.current.group.id);
    stateRef.current = refreshed;
    hashRef.current = stableHash(refreshed);
    workspaceHashRef.current = workspaceHash(refreshed);
    replaceState(refreshed);
  }, [replaceState]);

  useEffect(() => {
    if (!supabase || auth.status !== 'signedIn' || !isCloudGroupId(state.group.id)) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (Date.now() < suppressGroupRefreshUntilRef.current) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refreshGroup().catch(() => undefined), 500);
    };
    const channel = supabase.channel(`group-workspace:${state.group.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `group_id=eq.${state.group.id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photo_updates', filter: `group_id=eq.${state.group.id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${state.group.id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'metric_definitions', filter: `group_id=eq.${state.group.id}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_metric_status', filter: `group_id=eq.${state.group.id}` }, queueRefresh)
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase?.removeChannel(channel).catch(() => undefined);
    };
  }, [auth.status, refreshGroup, state.group.id]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', (next) => {
      if (next === 'active' && auth.status === 'signedIn') {
        if (pendingChanges || status === 'offline') performSync().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [auth.status, pendingChanges, performSync, status]);

  const value = useMemo<CloudSyncContextValue>(() => ({
    status, lastSyncedAt, errorMessage, pendingChanges, devices,
    syncNow: performSync,
    pullLatest,
    refreshDevices: loadDevices,
    forgetDevice: async (deviceId) => {
      if (!supabase) return;
      const { error } = await supabase.from('account_devices').delete().eq('device_id', deviceId);
      if (error) throw error;
      await loadDevices();
    },
    deleteAccount: async () => {
      if (!supabase) throw new Error('Cloud is not configured.');
      const { error } = await supabase.functions.invoke('delete-account');
      if (error) throw error;
      await supabase.auth.signOut({ scope: 'global' });
    },
    createGroup: async (name) => {
      if (!auth.user) throw new Error('Sign in before creating a cloud group.');
      const me = stateRef.current.group.members.find((member) => member.id === stateRef.current.currentUserId);
      const groupId = await createCloudGroup(name, stateRef.current.metrics, auth.user, me?.name);
      const next = await loadCloudWorkspace(stateRef.current, groupId);
      stateRef.current = next; workspaceHashRef.current = workspaceHash(next); replaceState(next); setPendingChanges(true);
    },
    joinGroup: async (code) => {
      const groupId = await joinCloudGroup(code);
      const next = await loadCloudWorkspace(stateRef.current, groupId);
      stateRef.current = next; workspaceHashRef.current = workspaceHash(next); replaceState(next); setPendingChanges(true);
    },
    switchGroup: async (groupId) => {
      const next = await loadCloudWorkspace(stateRef.current, groupId);
      stateRef.current = next; workspaceHashRef.current = workspaceHash(next); replaceState(next); setPendingChanges(true);
    },
    leaveGroup: async (groupId) => {
      await leaveCloudGroup(groupId);
      const shells = await loadCloudGroupShells();
      const localGroups = stateRef.current.groups.filter((group) => !isCloudGroupId(group.id) && group.id !== groupId);
      const remaining = [...shells, ...localGroups];
      const nextGroup = remaining[0];
      if (!nextGroup) throw new Error('Create another group before leaving your only group.');
      const next = isCloudGroupId(nextGroup.id)
        ? await loadCloudWorkspace({ ...stateRef.current, groups: remaining }, nextGroup.id)
        : { ...stateRef.current, group: nextGroup, groups: remaining, metrics: nextGroup.metricConfiguration ?? stateRef.current.metrics };
      stateRef.current = next; replaceState(next); setPendingChanges(true);
    },
    refreshGroup,
  }), [auth.user, devices, errorMessage, lastSyncedAt, loadDevices, pendingChanges, performSync, pullLatest, refreshGroup, replaceState, status]);

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync() {
  const context = useContext(CloudSyncContext);
  if (!context) throw new Error('useCloudSync must be used inside CloudSyncProvider');
  return context;
}
