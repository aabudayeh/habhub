import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState } from 'react-native';

import { dateKey } from '@/src/domain/date';
import { enabledHealthDataTypes, mapHealthRecordsToEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import { nativeHealthAdapter } from '@/src/health/adapter';
import { configureBackgroundHealthSync } from '@/src/health/background';
import {
  HEALTH_INITIAL_DAYS,
  HEALTH_STATUS_STORAGE_KEY,
} from '@/src/health/constants';
import { HealthAdapterAvailability, PersistedHealthStatus } from '@/src/health/types';
import { useApp } from '@/src/state/AppProvider';

export type HealthSyncStatus = 'checking' | 'unavailable' | 'idle' | 'requesting' | 'syncing' | 'ready' | 'error';

type HealthSyncContextValue = {
  status: HealthSyncStatus;
  availability: HealthAdapterAvailability | null;
  lastSyncedAt: string | null;
  importedCount: number;
  errorMessage: string | null;
  sourceOrigins: string[];
  connect: () => Promise<void>;
  syncNow: (reason?: 'open' | 'pull' | 'manual') => Promise<void>;
  syncHistory: () => Promise<void>;
  disconnect: () => Promise<void>;
  openSettings: () => Promise<void>;
};

const HealthSyncContext = createContext<HealthSyncContextValue | null>(null);

function syncStart(
  lastSyncedAt: string | null,
  fullRefresh = false,
  historyDays = 90,
) {
  let from = lastSyncedAt ? new Date(lastSyncedAt) : new Date();
  if (Number.isNaN(from.getTime())) from = new Date();
  from.setHours(0, 0, 0, 0);
  // First setup imports a lightweight month. Explicit history repair imports
  // two years; routine syncs overlap two days so provider edits are corrected.
  from.setDate(
    from.getDate() -
      (fullRefresh
        ? historyDays
        : lastSyncedAt
          ? 2
          : HEALTH_INITIAL_DAYS),
  );
  return from;
}

function minimumIntervalMs(mode: ReturnType<typeof useApp>['state']['settings']['syncMode']) {
  if (mode === 'frequent') return 60 * 60 * 1000;
  if (mode === 'balanced') return 6 * 60 * 60 * 1000;
  if (mode === 'battery') return 12 * 60 * 60 * 1000;
  return Number.POSITIVE_INFINITY;
}

export function HealthSyncProvider({ children }: PropsWithChildren) {
  const { state, updateSettings, importHealthEntries } = useApp();
  const [status, setStatus] = useState<HealthSyncStatus>('checking');
  const [availability, setAvailability] = useState<HealthAdapterAvailability | null>(null);
  const [persisted, setPersisted] = useState<PersistedHealthStatus>({ lastSyncedAt: null, importedCount: 0, error: null });
  const persistedRef = useRef(persisted);
  const syncingRef = useRef<Promise<void> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  persistedRef.current = persisted;

  const saveStatus = useCallback(async (next: PersistedHealthStatus) => {
    setPersisted(next);
    await AsyncStorage.setItem(`${HEALTH_STATUS_STORAGE_KEY}:${stateRef.current.currentUserId}`, JSON.stringify(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPersisted({ lastSyncedAt:null,importedCount:0,error:null });
    Promise.all([nativeHealthAdapter.availability(), AsyncStorage.getItem(`${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`)])
      .then(async ([nextAvailability, saved]) => {
        if (cancelled) return;
        setAvailability(nextAvailability);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as PersistedHealthStatus;
            setPersisted({
              lastSyncedAt:
                parsed.lastSyncedAt && !Number.isNaN(new Date(parsed.lastSyncedAt).getTime())
                  ? parsed.lastSyncedAt
                  : null,
              importedCount: Number(parsed.importedCount ?? 0),
              error: parsed.error ?? null,
              lastReason: parsed.lastReason,
            });
          } catch {
            await AsyncStorage.removeItem(`${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`);
          }
        }
        setStatus(nextAvailability.available ? (stateRef.current.settings.healthSync.enabled ? 'ready' : 'idle') : 'unavailable');
      })
      .catch((error) => {
        if (!cancelled) { setStatus('error'); setPersisted((current) => ({ ...current, error: error instanceof Error ? error.message : 'Could not check health availability.' })); }
      });
    return () => { cancelled = true; };
  }, [state.currentUserId]);

  const runSync = useCallback(async (reason: 'connect' | 'open' | 'pull' | 'manual' | 'history', forceEnabled = false) => {
    if (syncingRef.current) return syncingRef.current;
    const current = stateRef.current;
    if ((!current.settings.healthSync.enabled && !forceEnabled) || !nativeHealthAdapter.provider) return;
    const dataTypes = enabledHealthDataTypes(current.settings.healthSync.dataTypes);
    if (!dataTypes.length) throw new Error('Choose at least one health data category.');
    const operation = (async () => {
      setStatus('syncing');
      try {
        const previous = persistedRef.current;
        const fullRefresh = reason === 'history';
        if (reason === 'history') {
          await nativeHealthAdapter.requestPermissions(
            dataTypes,
            current.settings.syncMode !== 'manual',
          );
        }
        const historyDays = current.settings.healthHistoryDays ?? 90;
        const from = syncStart(previous.lastSyncedAt, fullRefresh, historyDays);
        const records = fullRefresh
          ? await readHealthInChunks(from, new Date(), dataTypes)
          : await nativeHealthAdapter.read({ from, to: new Date(), dataTypes });
        const entries = mapHealthRecordsToEntries(records, current.currentUserId, 'group',current.metrics,current.settings.energyProfile.weightKg);
        importHealthEntries(entries, nativeHealthAdapter.provider!, metricIdsForHealthDataTypes(dataTypes,current.metrics), dateKey(from));
        await saveStatus({ lastSyncedAt: new Date().toISOString(), lastReason: reason, importedCount: entries.length, error: null });
        setStatus('ready');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Health sync failed.';
        await saveStatus({ ...persistedRef.current, lastReason: reason, error: message });
        setStatus('error');
        throw error;
      } finally {
        syncingRef.current = null;
      }
    })();
    syncingRef.current = operation;
    return operation;
  }, [importHealthEntries, saveStatus]);

  const connect = useCallback(async () => {
    if (!availability?.available) throw new Error(availability?.detail ?? 'Health data is not available on this device.');
    const current = stateRef.current.settings;
    const dataTypes = enabledHealthDataTypes(current.healthSync.dataTypes);
    const backgroundAccess = current.syncMode !== 'manual';
    setStatus('requesting');
    try {
      await nativeHealthAdapter.requestPermissions(dataTypes, backgroundAccess);
      await runSync('connect', true);
      const latest = stateRef.current.settings;
      const healthSync = {
        ...latest.healthSync,
        enabled: true,
        backgroundAccess,
      };
      updateSettings({ healthSync });
      stateRef.current = {
        ...stateRef.current,
        settings: { ...latest, healthSync },
      };
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, [availability, runSync, updateSettings]);

  const disconnect = useCallback(async () => {
    const current = stateRef.current.settings.healthSync;
    updateSettings({ healthSync: { ...current, enabled: false, backgroundAccess: false } });
    setStatus(availability?.available ? 'idle' : 'unavailable');
  }, [availability, updateSettings]);

  useEffect(() => {
    configureBackgroundHealthSync(state.settings.healthSync, state.settings.syncMode).catch(() => undefined);
  }, [state.settings.healthSync, state.settings.syncMode]);

  useEffect(() => {
    if (!state.settings.healthSync.enabled || state.settings.syncMode === 'manual') return;
    // An automatic failure must remain quiet until the user retries or the app
    // is reopened. Including `error` here previously created an immediate loop.
    if (status !== 'ready') return;
    const last = persisted.lastSyncedAt
      ? new Date(persisted.lastSyncedAt).getTime()
      : 0;
    const stale = Date.now() - last >= minimumIntervalMs(state.settings.syncMode);
    if (stale) runSync('open').catch(() => undefined);
  }, [persisted.lastSyncedAt, runSync, state.settings.healthSync.enabled, state.settings.syncMode, status]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', (next) => {
      if (next !== 'active' || !stateRef.current.settings.healthSync.enabled || stateRef.current.settings.syncMode === 'manual') return;
      // A denied/revoked permission stays quiet until the user explicitly
      // reconnects; Android emits several active events around permission UI.
      if (persistedRef.current.error) return;
      const lastSyncedAt = persistedRef.current.lastSyncedAt;
      const last = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
      // Foreground refresh obeys the selected battery schedule. Pull-to-refresh
      // remains the explicit immediate path.
      if (
        Date.now() - last >=
        minimumIntervalMs(stateRef.current.settings.syncMode)
      )
        runSync('open').catch(() => undefined);
    });
    return () => subscription.remove();
  }, [runSync]);

  const sourceOrigins = useMemo(() => [...new Set(state.entries
    .filter((entry) => entry.userId === state.currentUserId && entry.source === 'imported' && entry.sourceOrigin)
    .map((entry) => entry.sourceOrigin!))].sort(), [state.currentUserId, state.entries]);

  const value = useMemo<HealthSyncContextValue>(() => ({
    status,
    availability,
    lastSyncedAt: persisted.lastSyncedAt,
    importedCount: persisted.importedCount ?? 0,
    errorMessage: persisted.error ?? null,
    sourceOrigins,
    connect,
    syncNow: (reason = 'manual') => runSync(reason),
    syncHistory: () => runSync('history'),
    disconnect,
    openSettings: nativeHealthAdapter.openSettings,
  }), [availability, connect, disconnect, persisted, runSync, sourceOrigins, status]);

  return <HealthSyncContext.Provider value={value}>{children}</HealthSyncContext.Provider>;
}

async function readHealthInChunks(
  from: Date,
  to: Date,
  dataTypes: ReturnType<typeof enabledHealthDataTypes>,
) {
  const records = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(
      Math.min(
        to.getTime(),
        cursor.getTime() + 30 * 24 * 60 * 60 * 1000,
      ),
    );
    records.push(
      ...(await nativeHealthAdapter.read({
        from: cursor,
        to: end,
        dataTypes,
      })),
    );
    cursor = new Date(end.getTime() + 1);
  }
  return records;
}

export function useHealthSync() {
  const context = useContext(HealthSyncContext);
  if (!context) throw new Error('useHealthSync must be used inside HealthSyncProvider');
  return context;
}
