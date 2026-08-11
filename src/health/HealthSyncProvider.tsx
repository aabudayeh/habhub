import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState, InteractionManager } from 'react-native';

import { dateKey } from '@/src/domain/date';
import { setCloudSyncPaused } from '@/src/cloud/syncGate';
import { enabledHealthDataTypes, mapHealthRecordsToEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import {
  healthSourceId,
  mergeHealthSourcePreferences,
} from '@/src/domain/healthDedup';
import { nativeHealthAdapter } from '@/src/health/adapter';
import { configureBackgroundHealthSync } from '@/src/health/background';
import {
  HEALTH_INITIAL_DAYS,
  HEALTH_STATUS_STORAGE_KEY,
} from '@/src/health/constants';
import {
  BackgroundHealthSyncRegistration,
  healthSyncMinimumIntervalMs,
  healthSyncSchedule,
  normalizeHealthSyncMode,
} from '@/src/health/schedule';
import { HealthAdapterAvailability, PersistedHealthStatus } from '@/src/health/types';
import { useApp } from '@/src/state/AppProvider';
import { SyncMode } from '@/src/types';

export type HealthSyncStatus = 'checking' | 'unavailable' | 'idle' | 'requesting' | 'syncing' | 'ready' | 'error';

const RECENT_IMPORT_DAYS = 7;
const BACKFILL_CHUNK_DAYS = 30;
const FIRST_BACKFILL_DELAY_MS = 6_000;
const NEXT_BACKFILL_DELAY_MS = 900;
const MAX_BACKFILL_RETRY_MS = 15 * 60 * 1000;

type HealthSyncContextValue = {
  status: HealthSyncStatus;
  availability: HealthAdapterAvailability | null;
  lastSyncedAt: string | null;
  importedCount: number;
  errorMessage: string | null;
  /** Actual native task state, distinct from the user's selected cadence. */
  backgroundRegistration:
    | BackgroundHealthSyncRegistration
    | 'configuring'
    | 'error';
  sourceOrigins: string[];
  sourceOptions: {
    id: string;
    origin: string;
    enabled: boolean;
  }[];
  connect: (options?: {
    historyDays?: 30 | 90 | 365 | 730;
    startTrackedGoalsAtFirstData?: boolean;
  }) => Promise<void>;
  syncNow: (reason?: 'open' | 'pull' | 'manual') => Promise<void>;
  syncHistory: () => Promise<void>;
  setSyncMode: (mode: SyncMode) => Promise<void>;
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<void>;
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

export function HealthSyncProvider({ children }: PropsWithChildren) {
  const { state, updateSettings, importHealthEntries } = useApp();
  const [status, setStatus] = useState<HealthSyncStatus>('checking');
  const [availability, setAvailability] = useState<HealthAdapterAvailability | null>(null);
  const [persisted, setPersisted] = useState<PersistedHealthStatus>({ lastSyncedAt: null, importedCount: 0, error: null });
  const [backgroundRegistration, setBackgroundRegistration] = useState<
    HealthSyncContextValue['backgroundRegistration']
  >('disabled');
  const persistedRef = useRef(persisted);
  const syncingRef = useRef<Promise<void> | null>(null);
  const backfillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSyncRef = useRef<
    ((
      reason: 'connect' | 'open' | 'pull' | 'manual' | 'history' | 'backfill',
      forceEnabled?: boolean,
    ) => Promise<void>) | null
  >(null);
  const stateRef = useRef(state);
  const updateSettingsRef = useRef(updateSettings);
  stateRef.current = state;
  updateSettingsRef.current = updateSettings;
  persistedRef.current = persisted;
  const backgroundConfigurationKey = useMemo(
    () =>
      JSON.stringify({
        enabled: state.settings.healthSync.enabled,
        backgroundAccess: state.settings.healthSync.backgroundAccess,
        dataTypes: state.settings.healthSync.dataTypes,
        mode: normalizeHealthSyncMode(state.settings.syncMode),
      }),
    [
      state.settings.healthSync.backgroundAccess,
      state.settings.healthSync.dataTypes,
      state.settings.healthSync.enabled,
      state.settings.syncMode,
    ],
  );

  const saveStatus = useCallback(async (next: PersistedHealthStatus) => {
    persistedRef.current = next;
    setPersisted(next);
    await AsyncStorage.setItem(`${HEALTH_STATUS_STORAGE_KEY}:${stateRef.current.currentUserId}`, JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (status === 'checking') return;
    const normalizedMode = normalizeHealthSyncMode(state.settings.syncMode);
    const clearsLegacyBackgroundFlag =
      normalizedMode === 'manual' &&
      state.settings.healthSync.backgroundAccess;
    if (
      normalizedMode === state.settings.syncMode &&
      !clearsLegacyBackgroundFlag
    )
      return;
    const healthSync = clearsLegacyBackgroundFlag
      ? { ...state.settings.healthSync, backgroundAccess: false }
      : state.settings.healthSync;
    const settings = {
      ...state.settings,
      syncMode: normalizedMode,
      healthSync,
    };
    stateRef.current = { ...stateRef.current, settings };
    updateSettingsRef.current({ syncMode: normalizedMode, healthSync });
    if (clearsLegacyBackgroundFlag)
      void saveStatus({
        ...persistedRef.current,
        backgroundAccess: false,
      });
  }, [saveStatus, state.settings, status]);

  useEffect(() => {
    let cancelled = false;
    const empty: PersistedHealthStatus = { lastSyncedAt:null,importedCount:0,error:null,backfill:null };
    persistedRef.current = empty;
    setPersisted(empty);
    const statusKey = `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`;
    Promise.all([nativeHealthAdapter.availability(), AsyncStorage.getItem(statusKey)])
      .then(async ([nextAvailability, saved]) => {
        if (cancelled) return;
        setAvailability(nextAvailability);
        let restored = empty;
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as PersistedHealthStatus;
            restored = {
              lastSyncedAt:
                parsed.lastSyncedAt && !Number.isNaN(new Date(parsed.lastSyncedAt).getTime())
                  ? parsed.lastSyncedAt
                  : null,
              connectionEnabled:
                typeof parsed.connectionEnabled === 'boolean'
                  ? parsed.connectionEnabled
                  : undefined,
              backgroundAccess:
                typeof parsed.backgroundAccess === 'boolean'
                  ? parsed.backgroundAccess
                  : undefined,
              importedCount: Number(parsed.importedCount ?? 0),
              error: parsed.error ?? null,
              lastReason: parsed.lastReason,
              lastImportFromDate: parsed.lastImportFromDate,
              backfill:
                parsed.backfill &&
                !Number.isNaN(new Date(parsed.backfill.from).getTime()) &&
                !Number.isNaN(new Date(parsed.backfill.cursorEnd).getTime())
                  ? parsed.backfill
                  : null,
              retryAttempt: Number(parsed.retryAttempt ?? 0),
              nextRetryAt: parsed.nextRetryAt ?? null,
            };
          } catch {
            await AsyncStorage.removeItem(statusKey);
          }
        }
        // Builds before device-local connection persistence did not save an
        // explicit flag. Recover those installations once from Android's
        // actual granted read permissions. Never override an explicit false,
        // because Disconnect intentionally leaves system permissions intact.
        if (
          restored.connectionEnabled === undefined &&
          nextAvailability.available &&
          nativeHealthAdapter.grantedConnectionState
        ) {
          const granted = await nativeHealthAdapter
            .grantedConnectionState(
              enabledHealthDataTypes(
                stateRef.current.settings.healthSync.dataTypes,
              ),
            )
            .catch(() => null);
          if (cancelled) return;
          if (granted?.connected) {
            restored = {
              ...restored,
              connectionEnabled: true,
              backgroundAccess: granted.backgroundAccess,
            };
            await AsyncStorage.setItem(
              statusKey,
              JSON.stringify(restored),
            ).catch(() => undefined);
          }
        }
        persistedRef.current = restored;
        setPersisted(restored);
        if (restored.connectionEnabled !== undefined) {
          const currentState = stateRef.current;
          const currentHealthSync = currentState.settings.healthSync;
          const backgroundAccess = restored.connectionEnabled
            ? (restored.backgroundAccess ?? currentHealthSync.backgroundAccess)
            : false;
          if (
            currentHealthSync.enabled !== restored.connectionEnabled ||
            currentHealthSync.backgroundAccess !== backgroundAccess
          ) {
            const healthSync = {
              ...currentHealthSync,
              enabled: restored.connectionEnabled,
              backgroundAccess,
            };
            stateRef.current = {
              ...currentState,
              settings: { ...currentState.settings, healthSync },
            };
            updateSettingsRef.current({ healthSync });
          }
        }
        setStatus(nextAvailability.available ? (stateRef.current.settings.healthSync.enabled ? 'ready' : 'idle') : 'unavailable');
      })
      .catch((error) => {
        if (!cancelled) { setStatus('error'); setPersisted((current) => ({ ...current, error: error instanceof Error ? error.message : 'Could not check health availability.' })); }
      });
    return () => { cancelled = true; };
  }, [state.currentUserId]);

  const scheduleBackfill = useCallback((delayMs: number) => {
    if (backfillTimerRef.current) clearTimeout(backfillTimerRef.current);
    backfillTimerRef.current = setTimeout(() => {
      backfillTimerRef.current = null;
      if (
        NativeAppState.currentState !== 'active' ||
        !stateRef.current.settings.onboardingComplete ||
        !stateRef.current.settings.healthSync.enabled
      ) return;
      InteractionManager.runAfterInteractions(() => {
        runSyncRef.current?.('backfill', true).catch(() => undefined);
      });
    }, delayMs);
  }, []);

  const rememberHealthSources = useCallback((records: import('@/src/health/types').HealthImportRecord[]) => {
    const currentState = stateRef.current;
    const currentHealth = currentState.settings.healthSync;
    const sourcePreferences = mergeHealthSourcePreferences(
      currentHealth.sourcePreferences,
      records,
    );
    if (sourcePreferences === currentHealth.sourcePreferences)
      return sourcePreferences;
    const healthSync = { ...currentHealth, sourcePreferences };
    stateRef.current = {
      ...currentState,
      settings: { ...currentState.settings, healthSync },
    };
    updateSettingsRef.current({ healthSync });
    return sourcePreferences;
  }, []);

  const runSync = useCallback(async (reason: 'connect' | 'open' | 'pull' | 'manual' | 'history' | 'backfill', forceEnabled = false) => {
    if (syncingRef.current) return syncingRef.current;
    const current = stateRef.current;
    if ((!current.settings.healthSync.enabled && !forceEnabled) || !nativeHealthAdapter.provider) return;
    const dataTypes = enabledHealthDataTypes(current.settings.healthSync.dataTypes);
    if (!dataTypes.length) throw new Error('Choose at least one health data category.');
    const operation = (async () => {
      // Automatic foreground and historical work must never turn onboarding
      // or normal navigation into a blocking loading state.
      const showBusy = reason === 'manual' || reason === 'pull' || reason === 'history';
      if (showBusy) setStatus('syncing');
      const pausesCloud = reason === 'backfill';
      if (pausesCloud) setCloudSyncPaused('health-backfill', true);
      try {
        let previous = persistedRef.current;
        const fullRefresh = reason === 'history';
        const initialHistoryImport =
          current.settings.healthSync.initialHistoryImportPending === true;
        if (reason === 'history') {
          await nativeHealthAdapter.requestPermissions(
            dataTypes,
            current.settings.healthSync.backgroundAccess,
          );
        }
        const historyDays = current.settings.healthHistoryDays ?? 90;
        const metricIds = metricIdsForHealthDataTypes(
          dataTypes,
          current.metrics,
        );
        let importedCount = 0;
        let cumulativeImportedCount = 0;
        let backfill = fullRefresh ? null : previous.backfill;
        if ((fullRefresh || initialHistoryImport) && !backfill) {
          const now = new Date();
          const historyFrom = syncStart(null, true, historyDays);
          const recentFrom = new Date(now);
          recentFrom.setDate(recentFrom.getDate() - RECENT_IMPORT_DAYS);
          if (recentFrom < historyFrom) recentFrom.setTime(historyFrom.getTime());
          const finalChunk = recentFrom.getTime() <= historyFrom.getTime();
          backfill = finalChunk
            ? null
            : {
                from: historyFrom.toISOString(),
                cursorEnd: recentFrom.toISOString(),
                importedCount: 0,
                finalizeTrackedGoalHistory: initialHistoryImport,
                preserveTrackedGoalHistory: fullRefresh,
              };
          // Persist the cursor before the native read. If Android stops the
          // process, the next foreground resumes instead of restarting years
          // of history from scratch.
          previous = {
            ...previous,
            backfill,
            retryAttempt: 0,
            nextRetryAt: null,
          };
          await saveStatus(previous);
          const records = await nativeHealthAdapter.read({
            from: recentFrom,
            to: now,
            dataTypes,
            sourcePreferences: current.settings.healthSync.sourcePreferences,
          });
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            'group',
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
          );
          importedCount = entries.length;
          cumulativeImportedCount = importedCount;
          await importHealthEntries(
            entries,
            nativeHealthAdapter.provider!,
            metricIds,
            dateKey(recentFrom),
            initialHistoryImport && finalChunk,
            fullRefresh,
          );
          backfill = backfill
            ? { ...backfill, importedCount }
            : null;
          if (backfill) scheduleBackfill(FIRST_BACKFILL_DELAY_MS);
        } else if (reason === 'backfill' && backfill) {
          const historyFrom = new Date(backfill.from);
          const chunkEnd = new Date(backfill.cursorEnd);
          const chunkStart = new Date(chunkEnd);
          chunkStart.setDate(chunkStart.getDate() - BACKFILL_CHUNK_DAYS);
          if (chunkStart < historyFrom) chunkStart.setTime(historyFrom.getTime());
          const finalChunk = chunkStart.getTime() <= historyFrom.getTime();
          const records = await nativeHealthAdapter.read({
            from: chunkStart,
            to: chunkEnd,
            dataTypes,
            sourcePreferences: current.settings.healthSync.sourcePreferences,
          });
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            'group',
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
          );
          importedCount = entries.length;
          cumulativeImportedCount =
            backfill.importedCount + importedCount;
          await importHealthEntries(
            entries,
            nativeHealthAdapter.provider!,
            metricIds,
            dateKey(chunkStart),
            backfill.finalizeTrackedGoalHistory && finalChunk,
            backfill.preserveTrackedGoalHistory === true,
          );
          backfill = finalChunk
            ? null
            : {
                ...backfill,
                cursorEnd: chunkStart.toISOString(),
                importedCount: cumulativeImportedCount,
              };
          if (backfill) scheduleBackfill(NEXT_BACKFILL_DELAY_MS);
        } else {
          const from = syncStart(previous.lastSyncedAt, false, historyDays);
          const records = await nativeHealthAdapter.read({
            from,
            to: new Date(),
            dataTypes,
            sourcePreferences: current.settings.healthSync.sourcePreferences,
          });
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            'group',
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
          );
          importedCount = entries.length;
          cumulativeImportedCount = importedCount;
          await importHealthEntries(
            entries,
            nativeHealthAdapter.provider!,
            metricIds,
            dateKey(from),
            false,
            false,
          );
          if (backfill) scheduleBackfill(FIRST_BACKFILL_DELAY_MS);
        }
        const cumulativeCount = backfill
          ? Math.max(backfill.importedCount, cumulativeImportedCount)
          : cumulativeImportedCount;
        await saveStatus({
          ...persistedRef.current,
          // Any successful native read proves that this device remains
          // connected. Backfill this marker for users upgrading from builds
          // that only stored the flag in the cloud-sanitized app snapshot.
          connectionEnabled: true,
          backgroundAccess: current.settings.healthSync.backgroundAccess,
          lastSyncedAt: new Date().toISOString(),
          lastReason: reason,
          importedCount: cumulativeCount,
          error: null,
          backfill,
          retryAttempt: 0,
          nextRetryAt: null,
        });
        setStatus('ready');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Health sync failed.';
        const retryAttempt = Math.min(8, (persistedRef.current.retryAttempt ?? 0) + 1);
        const retryDelay = Math.min(
          MAX_BACKFILL_RETRY_MS,
          5_000 * 2 ** (retryAttempt - 1),
        );
        await saveStatus({
          ...persistedRef.current,
          lastReason: reason,
          error: message,
          retryAttempt,
          nextRetryAt: new Date(Date.now() + retryDelay).toISOString(),
        });
        if (persistedRef.current.backfill) scheduleBackfill(retryDelay);
        setStatus(reason === 'backfill' || reason === 'open' ? 'ready' : 'error');
        throw error;
      } finally {
        if (pausesCloud) setCloudSyncPaused('health-backfill', false);
        syncingRef.current = null;
      }
    })();
    syncingRef.current = operation;
    return operation;
  }, [importHealthEntries, rememberHealthSources, saveStatus, scheduleBackfill]);
  runSyncRef.current = runSync;

  const connect = useCallback(async (options?: {
    historyDays?: 30 | 90 | 365 | 730;
    startTrackedGoalsAtFirstData?: boolean;
  }) => {
    if (!availability?.available) throw new Error(availability?.detail ?? 'Health data is not available on this device.');
    const current = stateRef.current.settings;
    const dataTypes = enabledHealthDataTypes(current.healthSync.dataTypes);
    const requestedBackgroundAccess =
      healthSyncSchedule(current.syncMode).requestsBackground;
    setStatus('requesting');
    try {
      await nativeHealthAdapter.requestPermissions(
        dataTypes,
        requestedBackgroundAccess,
      );
      const granted = nativeHealthAdapter.grantedConnectionState
        ? await nativeHealthAdapter
            .grantedConnectionState(dataTypes)
            .catch(() => null)
        : null;
      if (granted && !granted.connected)
        throw new Error('Health data read permission was not granted.');
      const backgroundAccess =
        requestedBackgroundAccess &&
        (granted ? granted.backgroundAccess : true);
      const latest = stateRef.current.settings;
      const historyBackfillAlreadyPending =
        latest.healthSync.backfillTrackedGoalsOnFirstImport === true;
      const shouldArmHistoryBackfill =
        historyBackfillAlreadyPending ||
        options?.startTrackedGoalsAtFirstData === true;
      const initialHistoryImportPending =
        options !== undefined || !persistedRef.current.lastSyncedAt;
      const healthSync = {
        ...latest.healthSync,
        enabled: true,
        backgroundAccess,
        // The initial read is deferred until onboarding has navigated away.
        // Remember that this is still the onboarding import so its historical
        // entries can establish the selected goals' start dates exactly once.
        backfillTrackedGoalsOnFirstImport: shouldArmHistoryBackfill,
        backfillTrackedGoalsEmptyReadCount: shouldArmHistoryBackfill
          ? historyBackfillAlreadyPending
            ? (latest.healthSync.backfillTrackedGoalsEmptyReadCount ?? 0)
            : 0
          : undefined,
        initialHistoryImportPending,
      };
      const nextSettings = {
        ...latest,
        healthSync,
        healthHistoryDays: options?.historyDays ?? latest.healthHistoryDays,
      };
      await saveStatus({
        ...persistedRef.current,
        connectionEnabled: true,
        backgroundAccess,
      });
      updateSettings({
        healthSync,
        healthHistoryDays: nextSettings.healthHistoryDays,
      });
      stateRef.current = {
        ...stateRef.current,
        settings: nextSettings,
      };
      // Permission approval should return control to onboarding immediately.
      // The first lightweight import runs after navigation instead of making
      // the setup button wait while Health Connect reads and maps its records.
      setStatus('ready');
      if (stateRef.current.settings.onboardingComplete)
        setTimeout(() => {
          runSync('connect', true).catch(() => undefined);
        }, 350);
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, [availability, runSync, saveStatus, updateSettings]);

  const setSyncMode = useCallback(async (mode: SyncMode) => {
    const currentState = stateRef.current;
    const current = currentState.settings;
    const schedule = healthSyncSchedule(mode);
    let healthSync = current.healthSync;

    if (!schedule.requestsBackground) {
      healthSync = { ...healthSync, backgroundAccess: false };
    } else if (healthSync.enabled && !healthSync.backgroundAccess) {
      const dataTypes = enabledHealthDataTypes(healthSync.dataTypes);
      setStatus('requesting');
      try {
        await nativeHealthAdapter.requestPermissions(dataTypes, true);
      } catch (error) {
        setStatus('ready');
        throw error;
      }
      const granted = nativeHealthAdapter.grantedConnectionState
        ? await nativeHealthAdapter
            .grantedConnectionState(dataTypes)
            .catch(() => null)
        : null;
      if (granted && !granted.connected)
        throw new Error('Health data read permission was not granted.');
      healthSync = {
        ...healthSync,
        // On Health Connect this is a distinct grant. When unavailable, the
        // selected cadence still governs foreground/resume refreshes, but no
        // background task is registered.
        backgroundAccess: granted ? granted.backgroundAccess : true,
      };
    }

    const nextSettings = { ...current, syncMode: mode, healthSync };
    stateRef.current = { ...currentState, settings: nextSettings };
    await saveStatus({
      ...persistedRef.current,
      connectionEnabled: healthSync.enabled,
      backgroundAccess: healthSync.backgroundAccess,
    });
    updateSettings({ syncMode: mode, healthSync });
    setStatus(healthSync.enabled ? 'ready' : 'idle');
  }, [saveStatus, updateSettings]);

  const disconnect = useCallback(async () => {
    setCloudSyncPaused('health-backfill', false);
    if (backfillTimerRef.current) {
      clearTimeout(backfillTimerRef.current);
      backfillTimerRef.current = null;
    }
    const current = stateRef.current.settings.healthSync;
    await saveStatus({
      ...persistedRef.current,
      connectionEnabled: false,
      backgroundAccess: false,
    });
    updateSettings({ healthSync: { ...current, enabled: false, backgroundAccess: false } });
    setStatus(availability?.available ? 'idle' : 'unavailable');
  }, [availability, saveStatus, updateSettings]);

  const setSourceEnabled = useCallback(async (sourceId: string, enabled: boolean) => {
    const currentState = stateRef.current;
    const currentHealth = currentState.settings.healthSync;
    const existing = currentHealth.sourcePreferences?.[sourceId];
    const observedOrigin = existing?.origin ?? currentState.entries.find(
      (entry) =>
        entry.userId === currentState.currentUserId &&
        entry.sourceOrigin &&
        healthSourceId(entry.sourceOrigin) === sourceId,
    )?.sourceOrigin;
    if (!observedOrigin || (existing?.enabled ?? true) === enabled) return;
    const healthSync = {
      ...currentHealth,
      sourcePreferences: {
        ...currentHealth.sourcePreferences,
        [sourceId]: { origin: observedOrigin, enabled },
      },
    };
    stateRef.current = {
      ...currentState,
      settings: { ...currentState.settings, healthSync },
    };
    updateSettingsRef.current({ healthSync });
    if (currentHealth.enabled) {
      // Rebuild the selected window in either direction. This also recomputes
      // OS aggregates whose stored row represented more than one writer.
      const joinedExistingSync = Boolean(syncingRef.current);
      await runSyncRef.current?.('history', true);
      if (joinedExistingSync)
        await runSyncRef.current?.('history', true);
    }
  }, []);

  useEffect(() => {
    // Cloud merges often recreate the settings object even when the actual
    // Health Connect schedule is unchanged. Avoid repeatedly reconfiguring the
    // native background task in that case.
    let cancelled = false;
    const currentSettings = stateRef.current.settings;
    const schedule = healthSyncSchedule(currentSettings.syncMode);
    setBackgroundRegistration(
      currentSettings.healthSync.enabled &&
        currentSettings.healthSync.backgroundAccess &&
        schedule.requestsBackground
        ? 'configuring'
        : 'disabled',
    );
    configureBackgroundHealthSync(
      currentSettings.healthSync,
      schedule.mode,
    )
      .then((registration) => {
        if (!cancelled) setBackgroundRegistration(registration);
      })
      .catch(() => {
        if (!cancelled) setBackgroundRegistration('error');
      });
    return () => {
      cancelled = true;
    };
  }, [backgroundConfigurationKey]);

  useEffect(() => {
    if (
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      !state.settings.healthSync.initialHistoryImportPending ||
      status !== 'ready'
    ) return;
    const task = InteractionManager.runAfterInteractions(() => {
      runSync('connect', true).catch(() => undefined);
    });
    return () => task.cancel();
  }, [
    runSync,
    state.settings.healthSync.enabled,
    state.settings.healthSync.initialHistoryImportPending,
    state.settings.onboardingComplete,
    status,
  ]);

  useEffect(() => {
    if (
      status !== 'ready' ||
      !persisted.backfill ||
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled
    ) return;
    const retryAt = persisted.nextRetryAt
      ? new Date(persisted.nextRetryAt).getTime()
      : 0;
    // The active import schedules its own short next chunk. This fallback is
    // only for a cursor restored after process death or background suspension.
    if (!backfillTimerRef.current)
      scheduleBackfill(
        Math.max(FIRST_BACKFILL_DELAY_MS, retryAt - Date.now()),
      );
  }, [
    persisted.backfill,
    persisted.nextRetryAt,
    scheduleBackfill,
    state.settings.healthSync.enabled,
    state.settings.onboardingComplete,
    status,
  ]);

  useEffect(
    () => () => {
      if (backfillTimerRef.current) clearTimeout(backfillTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      state.settings.healthSync.initialHistoryImportPending ||
      !healthSyncSchedule(state.settings.syncMode).requestsBackground
    ) return;
    // An automatic failure must remain quiet until the user retries or the app
    // is reopened. Including `error` here previously created an immediate loop.
    if (status !== 'ready') return;
    const last = persisted.lastSyncedAt
      ? new Date(persisted.lastSyncedAt).getTime()
      : 0;
    const stale =
      Date.now() - last >=
      healthSyncMinimumIntervalMs(state.settings.syncMode);
    if (stale) {
      const task = InteractionManager.runAfterInteractions(() => {
        runSync('open').catch(() => undefined);
      });
      return () => task.cancel();
    }
  }, [
    persisted.lastSyncedAt,
    runSync,
    state.settings.healthSync.enabled,
    state.settings.healthSync.initialHistoryImportPending,
    state.settings.onboardingComplete,
    state.settings.syncMode,
    status,
  ]);

  useEffect(() => {
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let resumeReadSequence = 0;
    const subscription = NativeAppState.addEventListener('change', (next) => {
      const readSequence = ++resumeReadSequence;
      if (next !== 'active' && resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      if (next !== 'active') return;
      // The headless background task writes both entries and this small status
      // record directly to storage. Reload it before deciding whether another
      // foreground read is due; otherwise the UI reports a stale timestamp and
      // Android performs a redundant Health Connect query after every resume.
      void AsyncStorage.getItem(
        `${HEALTH_STATUS_STORAGE_KEY}:${stateRef.current.currentUserId}`,
      )
        .then((saved) => {
          if (
            disposed ||
            readSequence !== resumeReadSequence ||
            NativeAppState.currentState !== 'active'
          ) return;
          if (saved) {
            try {
              const stored = JSON.parse(saved) as PersistedHealthStatus;
              const storedAt = stored.lastSyncedAt
                ? new Date(stored.lastSyncedAt).getTime()
                : 0;
              const currentAt = persistedRef.current.lastSyncedAt
                ? new Date(persistedRef.current.lastSyncedAt).getTime()
                : 0;
              if (storedAt >= currentAt) {
                persistedRef.current = stored;
                setPersisted(stored);
              }
            } catch {
              // The foreground keeps its last valid status if a write was
              // interrupted while Android suspended the process.
            }
          }

          if (
            persistedRef.current.backfill &&
            stateRef.current.settings.onboardingComplete &&
            stateRef.current.settings.healthSync.enabled
          ) {
            const retryAt = persistedRef.current.nextRetryAt
              ? new Date(persistedRef.current.nextRetryAt).getTime()
              : 0;
            scheduleBackfill(
              Math.max(FIRST_BACKFILL_DELAY_MS, retryAt - Date.now()),
            );
          }
          if (
            !stateRef.current.settings.onboardingComplete ||
            !stateRef.current.settings.healthSync.enabled ||
            stateRef.current.settings.healthSync.initialHistoryImportPending ||
            !healthSyncSchedule(stateRef.current.settings.syncMode)
              .requestsBackground
          ) return;
          // Permission errors stay quiet until the user explicitly reconnects.
          // Transient background/network/native read failures retry after their
          // persisted backoff instead of disabling automatic sync forever.
          if (
            persistedRef.current.error &&
            /permission|authorization|denied|not granted/i.test(
              persistedRef.current.error,
            )
          )
            return;
          const retryAt = persistedRef.current.nextRetryAt
            ? new Date(persistedRef.current.nextRetryAt).getTime()
            : 0;
          if (persistedRef.current.error && retryAt > Date.now()) return;
          const lastSyncedAt = persistedRef.current.lastSyncedAt;
          const last = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
          // Foreground refresh obeys the selected battery schedule.
          if (
            Date.now() - last <
            healthSyncMinimumIntervalMs(stateRef.current.settings.syncMode)
          ) return;
          // Cloud chat/presence recover first. Health imports are larger and can
          // safely start after the resumed screen is interactive.
          if (resumeTimer) clearTimeout(resumeTimer);
          resumeTimer = setTimeout(() => {
            resumeTimer = null;
            if (NativeAppState.currentState === 'active')
              InteractionManager.runAfterInteractions(() => {
                runSync('open').catch(() => undefined);
              });
          }, 3200);
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      subscription.remove();
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [runSync, scheduleBackfill]);

  const sourceOrigins = useMemo(() => [...new Set(state.entries
    .filter((entry) => entry.userId === state.currentUserId && entry.source === 'imported' && entry.sourceOrigin)
    .map((entry) => entry.sourceOrigin!))].sort(), [state.currentUserId, state.entries]);
  const sourceOptions = useMemo(() => {
    const byId = new Map<string, { id: string; origin: string; enabled: boolean }>();
    for (const preference of Object.values(
      state.settings.healthSync.sourcePreferences ?? {},
    )) {
      const id = healthSourceId(preference.origin);
      byId.set(id, { id, origin: preference.origin, enabled: preference.enabled });
    }
    for (const origin of sourceOrigins) {
      const id = healthSourceId(origin);
      if (!byId.has(id)) byId.set(id, { id, origin, enabled: true });
    }
    return [...byId.values()].sort((a, b) => a.origin.localeCompare(b.origin));
  }, [sourceOrigins, state.settings.healthSync.sourcePreferences]);

  const value = useMemo<HealthSyncContextValue>(() => ({
    status,
    availability,
    lastSyncedAt: persisted.lastSyncedAt,
    importedCount: persisted.importedCount ?? 0,
    errorMessage: persisted.error ?? null,
    backgroundRegistration,
    sourceOrigins,
    sourceOptions,
    connect,
    syncNow: (reason = 'manual') => runSync(reason),
    syncHistory: () => runSync('history'),
    setSyncMode,
    setSourceEnabled,
    disconnect,
    openSettings: nativeHealthAdapter.openSettings,
  }), [availability, backgroundRegistration, connect, disconnect, persisted, runSync, setSourceEnabled, setSyncMode, sourceOptions, sourceOrigins, status]);

  return <HealthSyncContext.Provider value={value}>{children}</HealthSyncContext.Provider>;
}

export function useHealthSync() {
  const context = useContext(HealthSyncContext);
  if (!context) throw new Error('useHealthSync must be used inside HealthSyncProvider');
  return context;
}
