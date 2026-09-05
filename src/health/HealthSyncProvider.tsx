import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState, InteractionManager, Platform } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { entriesForUserDay } from '@/src/domain/dataIndex';
import { dateKey } from '@/src/domain/date';
import {
  healthHistorySelectionKey,
  healthImportStart,
  normalizeHealthHistoryDays,
} from '@/src/domain/healthHistory';
import { setCloudSyncPaused } from '@/src/cloud/syncGate';
import { enabledHealthDataTypes, healthFallbackContextForRead, healthVisibilityByMetric, mapHealthRecordsToEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import {
  aggregateRangeThroughLocalDate,
  hasHealthImportIdentity,
  healthSourceId,
  historicalStepRepairStart,
  mergeHealthSourcePreferences,
  normalizeLiveStepSources,
  stepRepairRangeCovered,
} from '@/src/domain/healthDedup';
import { nativeHealthAdapter } from '@/src/health/adapter';
import { configureBackgroundHealthSync } from '@/src/health/background';
import {
  HEALTH_INITIAL_DAYS,
  HEALTH_ROUTINE_OVERLAP_DAYS,
  healthPhysicalActivityMigrationKey,
  HEALTH_STEPS_IMPORT_VERSION,
  HEALTH_TODAY_STEPS_ACTIVE_REFRESH_MS,
  HEALTH_STATUS_STORAGE_KEY,
  HEALTH_TODAY_STEPS_MIN_INTERVAL_MS,
} from '@/src/health/constants';
import {
  BackgroundHealthSyncRegistration,
  healthSyncMinimumIntervalMs,
  healthSyncSchedule,
  normalizeBackgroundSyncIntervalHours,
  normalizeHealthSyncMode,
} from '@/src/health/schedule';
import { HealthAdapterAvailability, LiveStepDiagnostics, PersistedHealthStatus } from '@/src/health/types';
import { parsePersistedHealthStatus, rebaseForegroundHealthStatus, reconcilePersistedHealthConnection } from '@/src/health/persistedStatus';
import { useApp } from '@/src/state/AppProvider';
import { runAppStateStorageMutation } from '@/src/storage/appStateMutation';
import { HealthDataType, HealthHistoryDays, LiveStepCombination, LiveStepSource, SyncMode } from '@/src/types';

export type HealthSyncStatus = 'checking' | 'unavailable' | 'idle' | 'requesting' | 'syncing' | 'ready' | 'error';

const BACKFILL_CHUNK_DAYS = 30;
const FIRST_BACKFILL_DELAY_MS = 6_000;
const NEXT_BACKFILL_DELAY_MS = 900;
const MAX_BACKFILL_RETRY_MS = 15 * 60 * 1000;
const STEPS_REPAIR_CHUNK_DAYS = 30;
const STEPS_REPAIR_CHUNKS_PER_BATCH = 4;
const STEPS_REPAIR_NEXT_CHUNK_DELAY_MS = 4_000;
const STEPS_REPAIR_RETRY_MS = 15 * 60 * 1000;
const FOREGROUND_STEPS_SETTLE_DELAY_MS = 700;
const FOREGROUND_STEPS_INTERACTION_MAX_WAIT_MS = 1_200;
const PHYSICAL_ACTIVITY_MIGRATION_DELAY_MS = 4_000;

type ActiveHealthOperation = 'full' | 'steps-refresh' | 'steps-repair';

type HealthSyncContextValue = {
  status: HealthSyncStatus;
  availability: HealthAdapterAvailability | null;
  lastSyncedAt: string | null;
  /** Latest completed cheap foreground refresh of today's Steps bucket. */
  lastStepSyncedAt: string | null;
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
  liveStepDiagnostics: LiveStepDiagnostics | null;
  connect: (options?: {
    historyDays?: HealthHistoryDays;
    dataTypes?: HealthDataType[];
    startTrackedGoalsAtFirstData?: boolean;
  }) => Promise<void>;
  syncNow: (reason?: 'open' | 'pull' | 'manual') => Promise<void>;
  syncHistory: () => Promise<void>;
  setHealthHistoryDays: (days: HealthHistoryDays) => Promise<void>;
  setSyncMode: (mode: SyncMode) => Promise<void>;
  setBackgroundSyncIntervalHours: (hours: number) => Promise<void>;
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<void>;
  setLiveStepConfiguration: (
    sources: LiveStepSource[],
    combination: LiveStepCombination,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  openSettings: () => Promise<void>;
};

const HealthSyncContext = createContext<HealthSyncContextValue | null>(null);

const tutorialHealthUnavailable: HealthAdapterAvailability = {
  available: false,
  provider: null,
  title: 'Tutorial demo',
  detail: 'Health data is disabled in the tutorial preview.',
};

const disabledHealthAction = async () => undefined;
const disabledHealthContext: HealthSyncContextValue = {
  status: 'unavailable',
  availability: tutorialHealthUnavailable,
  lastSyncedAt: null,
  lastStepSyncedAt: null,
  importedCount: 0,
  errorMessage: null,
  backgroundRegistration: 'disabled',
  sourceOrigins: [],
  sourceOptions: [],
  liveStepDiagnostics: null,
  connect: disabledHealthAction,
  syncNow: disabledHealthAction,
  syncHistory: disabledHealthAction,
  setHealthHistoryDays: disabledHealthAction,
  setSyncMode: disabledHealthAction,
  setBackgroundSyncIntervalHours: disabledHealthAction,
  setSourceEnabled: disabledHealthAction,
  setLiveStepConfiguration: disabledHealthAction,
  disconnect: disabledHealthAction,
  openSettings: disabledHealthAction,
};

/** Shadows the live/native health provider inside the tutorial sandbox. */
export function TutorialHealthSyncBoundary({ children }: PropsWithChildren) {
  return (
    <HealthSyncContext.Provider value={disabledHealthContext}>
      {children}
    </HealthSyncContext.Provider>
  );
}

function syncStart(
  lastSyncedAt: string | null,
  fullRefresh = false,
  historyDays: HealthHistoryDays = 90,
  now = new Date(),
) {
  return healthImportStart({
    now,
    lastSyncedAt,
    fullRefresh,
    historyDays,
    initialDays: HEALTH_INITIAL_DAYS,
    routineOverlapDays: HEALTH_ROUTINE_OVERLAP_DAYS,
  });
}

export function HealthSyncProvider({ children }: PropsWithChildren) {
  const { state, hydrated, updateSettings, importHealthEntries } = useApp();
  const auth = useAuth();
  const signedInNativeAccountId =
    Platform.OS === 'android' && auth.status === 'signedIn'
      ? (auth.user?.id ?? null)
      : null;
  const [status, setStatus] = useState<HealthSyncStatus>('checking');
  const [availability, setAvailability] = useState<HealthAdapterAvailability | null>(null);
  const [persisted, setPersisted] = useState<PersistedHealthStatus>({ lastSyncedAt: null, importedCount: 0, error: null });
  const [physicalActivityMigrationCompletedKey, setPhysicalActivityMigrationCompletedKey] = useState<string | null>(null);
  const [backgroundRegistration, setBackgroundRegistration] = useState<
    HealthSyncContextValue['backgroundRegistration']
  >('disabled');
  const [liveStepDiagnostics, setLiveStepDiagnostics] =
    useState<LiveStepDiagnostics | null>(null);
  const persistedRef = useRef(persisted);
  const syncingRef = useRef<Promise<void> | null>(null);
  const activeHealthOperationRef = useRef<ActiveHealthOperation | null>(null);
  const backfillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayStepsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayStepsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const todayStepsInteractionRef = useRef<
    ReturnType<typeof InteractionManager.runAfterInteractions> | null
  >(null);
  const todayStepsInteractionFallbackRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const stepsRepairTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSyncRef = useRef<
    ((
      reason: 'connect' | 'open' | 'pull' | 'manual' | 'history' | 'backfill',
      forceEnabled?: boolean,
    ) => Promise<void>) | null
  >(null);
  const refreshTodayStepsRef = useRef<
    ((force?: boolean, acceptCurrentDayZero?: boolean) => Promise<void>) | null
  >(null);
  const runStepsRepairRef = useRef<(() => Promise<void>) | null>(null);
  const stateRef = useRef(state);
  const updateSettingsRef = useRef(updateSettings);
  stateRef.current = state;
  updateSettingsRef.current = updateSettings;
  persistedRef.current = persisted;

  const refreshTodayStepsAfterInteractions = useCallback((force = false) => {
    todayStepsInteractionRef.current?.cancel();
    if (todayStepsInteractionFallbackRef.current)
      clearTimeout(todayStepsInteractionFallbackRef.current);
    let completed = false;
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null =
      null;
    const run = () => {
      if (completed) return;
      completed = true;
      task?.cancel();
      if (todayStepsInteractionRef.current === task)
        todayStepsInteractionRef.current = null;
      if (todayStepsInteractionFallbackRef.current) {
        clearTimeout(todayStepsInteractionFallbackRef.current);
        todayStepsInteractionFallbackRef.current = null;
      }
      if (NativeAppState.currentState === 'active')
        refreshTodayStepsRef.current?.(force).catch(() => undefined);
    };
    task = InteractionManager.runAfterInteractions(run);
    if (completed) task.cancel();
    else {
      todayStepsInteractionRef.current = task;
      todayStepsInteractionFallbackRef.current = setTimeout(
        run,
        FOREGROUND_STEPS_INTERACTION_MAX_WAIT_MS,
      );
    }
  }, []);
  const backgroundConfigurationKey = useMemo(
    () =>
      JSON.stringify({
        enabled: state.settings.healthSync.enabled,
        backgroundAccess: state.settings.healthSync.backgroundAccess,
        backgroundIntervalHours:
          state.settings.healthSync.backgroundIntervalHours,
        dataTypes: state.settings.healthSync.dataTypes,
        mode: normalizeHealthSyncMode(state.settings.syncMode),
      }),
    [
      state.settings.healthSync.backgroundAccess,
      state.settings.healthSync.backgroundIntervalHours,
      state.settings.healthSync.dataTypes,
      state.settings.healthSync.enabled,
      state.settings.syncMode,
    ],
  );

  const saveStatus = useCallback(async (next: PersistedHealthStatus) => {
    const accountId = stateRef.current.currentUserId;
    const key = `${HEALTH_STATUS_STORAGE_KEY}:${accountId}`;
    const rebased = await runAppStateStorageMutation(async () => {
      const stored = parsePersistedHealthStatus(await AsyncStorage.getItem(key));
      const durable = rebaseForegroundHealthStatus(stored, next);
      await AsyncStorage.setItem(key, JSON.stringify(durable));
      return durable;
    });
    if (stateRef.current.currentUserId !== accountId) return;
    persistedRef.current = rebased;
    setPersisted(rebased);
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
    const empty: PersistedHealthStatus = { lastSyncedAt:null,importedCount:0,error:null,backfill:null,stepsRepair:null };
    setLiveStepDiagnostics(null);
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
              lastStepSyncedAt:
                parsed.lastStepSyncedAt &&
                !Number.isNaN(new Date(parsed.lastStepSyncedAt).getTime())
                  ? parsed.lastStepSyncedAt
                  : null,
              stepsImportVersion: Number(parsed.stepsImportVersion ?? 0),
              stepsRepair:
                parsed.stepsRepair &&
                !Number.isNaN(new Date(parsed.stepsRepair.from).getTime()) &&
                !Number.isNaN(new Date(parsed.stepsRepair.cursorEnd).getTime())
                  ? parsed.stepsRepair
                  : null,
              stepsRepairError: parsed.stepsRepairError ?? null,
              stepsRepairNextRetryAt: parsed.stepsRepairNextRetryAt ?? null,
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
              backgroundReconciliation:
                parsed.backgroundReconciliation ?? null,
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
            restored = empty;
          }
        }
        // Reconcile persisted intent with current native grants on every
        // startup. Access can be revoked in system settings while HabHub is
        // closed, so a cached true must not keep showing Connected. Never turn
        // an explicit false back on merely because permissions remain after
        // the user chose Disconnect inside HabHub.
        const connectionStateReader =
          nativeHealthAdapter.grantedConnectionState;
        const canReconcileNativeGrant =
          restored.connectionEnabled !== false &&
          nextAvailability.available &&
          Boolean(connectionStateReader);
        const granted = canReconcileNativeGrant && connectionStateReader
          ? await connectionStateReader(
              enabledHealthDataTypes(
                stateRef.current.settings.healthSync.dataTypes,
              ),
            )
            .catch(() => null)
          : null;
        if (cancelled) return;
        let disconnectRevokedGrant = false;
        restored = await runAppStateStorageMutation(async () => {
          const latestRaw = await AsyncStorage.getItem(statusKey);
          let latest = parsePersistedHealthStatus(latestRaw);
          if (!latest) {
            if (latestRaw) await AsyncStorage.removeItem(statusKey);
            latest = restored;
          }
          const connection = reconcilePersistedHealthConnection(
            latest,
            granted,
          );
          const reconciled = connection.status;
          disconnectRevokedGrant = connection.disconnectRevokedGrant;
          if (reconciled !== latest)
            await AsyncStorage.setItem(statusKey, JSON.stringify(reconciled));
          return reconciled;
        });
        if (disconnectRevokedGrant)
          await nativeHealthAdapter.disconnect?.().catch(() => undefined);
        if (cancelled) return;
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

  useEffect(() => {
    const accountId = signedInNativeAccountId;
    const markerKey = accountId
      ? healthPhysicalActivityMigrationKey(accountId)
      : null;
    if (
      !accountId ||
      !markerKey ||
      markerKey === physicalActivityMigrationCompletedKey ||
      !hydrated ||
      accountId !== state.currentUserId ||
      status !== 'ready' ||
      !availability?.available ||
      nativeHealthAdapter.provider !== 'health_connect' ||
      persisted.connectionEnabled !== true ||
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      !state.settings.healthSync.dataTypes.steps
    )
      return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interaction: ReturnType<
      typeof InteractionManager.runAfterInteractions
    > | null = null;

    const clearScheduled = () => {
      interaction?.cancel();
      interaction = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const eligibleNow = () => {
      const current = stateRef.current;
      return (
        NativeAppState.currentState === 'active' &&
        current.currentUserId === accountId &&
        current.settings.onboardingComplete &&
        current.settings.healthSync.enabled &&
        current.settings.healthSync.dataTypes.steps &&
        persistedRef.current.connectionEnabled === true
      );
    };
    const attempt = async () => {
      if (cancelled || !eligibleNow()) return;
      // Let any launch/resume import finish first. The migration is optional
      // setup and must never occupy or queue the user's first native sync.
      if (syncingRef.current) {
        timer = setTimeout(() => {
          timer = null;
          void attempt();
        }, 1_000);
        return;
      }
      try {
        const existing = await AsyncStorage.getItem(markerKey);
        if (cancelled) return;
        if (existing) {
          setPhysicalActivityMigrationCompletedKey(markerKey);
          return;
        }
        if (!eligibleNow()) return;
        // Persist before opening Android's dialog. A denial, dismissal, or
        // process death therefore cannot create a prompt loop on reopen.
        await AsyncStorage.setItem(markerKey, new Date().toISOString());
        if (cancelled || !eligibleNow()) return;
        void nativeHealthAdapter.prepareCurrentDaySteps?.().catch(
          () => undefined,
        );
        setPhysicalActivityMigrationCompletedKey(markerKey);
      } catch {
        // A failed marker write must not risk a repeating system prompt. Leave
        // the migration untouched; explicit Settings > Sync now remains safe.
      }
    };
    const schedule = () => {
      clearScheduled();
      interaction = InteractionManager.runAfterInteractions(() => {
        interaction = null;
        if (cancelled || NativeAppState.currentState !== 'active') return;
        timer = setTimeout(() => {
          timer = null;
          void attempt();
        }, PHYSICAL_ACTIVITY_MIGRATION_DELAY_MS);
      });
    };
    const subscription = NativeAppState.addEventListener('change', (next) => {
      if (next === 'active') schedule();
      else clearScheduled();
    });
    if (NativeAppState.currentState === 'active') schedule();
    return () => {
      cancelled = true;
      subscription.remove();
      clearScheduled();
    };
  }, [
    availability?.available,
    hydrated,
    persisted.connectionEnabled,
    physicalActivityMigrationCompletedKey,
    state.currentUserId,
    state.settings.healthSync.dataTypes.steps,
    state.settings.healthSync.enabled,
    state.settings.onboardingComplete,
    status,
    signedInNativeAccountId,
  ]);

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

  const markPhysicalActivityMigrationAttempt = useCallback(
    async (accountId: string) => {
      const key = healthPhysicalActivityMigrationKey(accountId);
      setPhysicalActivityMigrationCompletedKey(key);
      await AsyncStorage.setItem(key, new Date().toISOString());
    },
    [],
  );

  const scheduleStepsRepair = useCallback((delayMs: number) => {
    if (stepsRepairTimerRef.current) clearTimeout(stepsRepairTimerRef.current);
    stepsRepairTimerRef.current = setTimeout(() => {
      stepsRepairTimerRef.current = null;
      if (
        NativeAppState.currentState !== 'active' ||
        !stateRef.current.settings.onboardingComplete ||
        !stateRef.current.settings.healthSync.enabled
      )
        return;
      InteractionManager.runAfterInteractions(() => {
        runStepsRepairRef.current?.().catch(() => undefined);
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

  const rememberLiveStepDiagnostics = useCallback(
    (records: import('@/src/health/types').HealthImportRecord[]) => {
      const diagnostics = records.find(
        (record) => record.type === 'steps' && record.liveStepDiagnostics,
      )?.liveStepDiagnostics;
      if (diagnostics) setLiveStepDiagnostics(diagnostics);
    },
    [],
  );

  const refreshTodaySteps = useCallback(async (
    force = false,
    acceptCurrentDayZero = false,
  ) => {
    const pending = syncingRef.current;
    if (pending) {
      const activeOperation = activeHealthOperationRef.current;
      if (activeOperation === 'steps-refresh') {
        if (!force) return pending;
        await pending.catch(() => undefined);
        return refreshTodayStepsRef.current?.(true, acceptCurrentDayZero);
      }
      await pending.catch(() => undefined);
      // A full read may have started before Samsung finished exporting its
      // latest bucket. Keep the queued, cheap current-day read instead of
      // silently treating the unrelated lock holder as this refresh.
      return refreshTodayStepsRef.current?.(true, acceptCurrentDayZero);
    }
    const current = stateRef.current;
    if (
      !current.settings.healthSync.enabled ||
      !current.settings.healthSync.dataTypes.steps ||
      !nativeHealthAdapter.provider
    )
      return;
    const last = persistedRef.current.lastStepSyncedAt
      ? new Date(persistedRef.current.lastStepSyncedAt).getTime()
      : 0;
    if (
      !force &&
      Number.isFinite(last) &&
      Date.now() - last < HEALTH_TODAY_STEPS_MIN_INTERVAL_MS
    )
      return;
    activeHealthOperationRef.current = 'steps-refresh';
    const operation = (async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      const stepMetricIds = metricIdsForHealthDataTypes(
        ['steps'],
        current.metrics,
      );
      const currentLocalDate = dateKey(from);
      const currentDayEntries = entriesForUserDay(
        current.entries,
        current.currentUserId,
        currentLocalDate,
      );
      const records = await nativeHealthAdapter.read({
        from,
        to,
        dataTypes: ['steps'],
        sourcePreferences: current.settings.healthSync.sourcePreferences,
        liveStepSources: current.settings.healthSync.liveStepSources,
        liveStepCombination: current.settings.healthSync.liveStepCombination,
      });
      rememberLiveStepDiagnostics(records);
      const sourcePreferences = rememberHealthSources(records);
      const entries = mapHealthRecordsToEntries(
        records,
        current.currentUserId,
        healthVisibilityByMetric(current.metrics),
        current.metrics,
        current.settings.energyProfile,
        sourcePreferences,
        healthFallbackContextForRead(currentDayEntries, current.metrics, ['steps']),
        current.settings.stepCoveragePreferences,
      );
      await importHealthEntries(
        entries,
        nativeHealthAdapter.provider!,
        stepMetricIds,
        currentLocalDate,
        false,
        true,
        {
          metricIds: stepMetricIds,
          throughDate: dateKey(to),
          removeStepFallbacks: true,
          acceptCurrentDayZero,
        },
        true,
      );
      const completedAt = new Date().toISOString();
      await saveStatus({
        ...persistedRef.current,
        connectionEnabled: true,
        lastStepSyncedAt: completedAt,
        stepsRepairError: null,
      });
    })().finally(() => {
      syncingRef.current = null;
      activeHealthOperationRef.current = null;
    });
    syncingRef.current = operation;
    return operation;
  }, [importHealthEntries, rememberHealthSources, rememberLiveStepDiagnostics, saveStatus]);
  refreshTodayStepsRef.current = refreshTodaySteps;

  const runStepsRepair = useCallback(async () => {
    const pending = syncingRef.current;
    if (pending) {
      if (activeHealthOperationRef.current === 'steps-repair') return pending;
      await pending.catch(() => undefined);
      return runStepsRepairRef.current?.();
    }
    const current = stateRef.current;
    if (
      !current.settings.healthSync.enabled ||
      !current.settings.healthSync.dataTypes.steps ||
      normalizeHealthHistoryDays(current.settings.healthHistoryDays) === 0 ||
      current.settings.healthSync.initialHistoryImportPending ||
      Boolean(persistedRef.current.backfill) ||
      !nativeHealthAdapter.provider ||
      (persistedRef.current.stepsImportVersion ?? 0) >=
        HEALTH_STEPS_IMPORT_VERSION
    )
      return;
    activeHealthOperationRef.current = 'steps-repair';
    const operation = (async () => {
      try {
        const now = new Date();
        let cursor = persistedRef.current.stepsRepair;
        if (!cursor) {
          const stepMetricIds = new Set(
            metricIdsForHealthDataTypes(['steps'], current.metrics),
          );
          const existingDates = current.entries
            .filter(
              (entry) =>
                entry.userId === current.currentUserId &&
                stepMetricIds.has(entry.metricId) &&
                hasHealthImportIdentity(entry),
            )
            .map((entry) => entry.localDate);
          const repairFrom = historicalStepRepairStart(
            now,
            normalizeHealthHistoryDays(
              current.settings.healthHistoryDays,
            ),
            existingDates,
          );
          cursor = {
            from: repairFrom.toISOString(),
            cursorEnd: now.toISOString(),
          };
          await saveStatus({
            ...persistedRef.current,
            stepsRepair: cursor,
            stepsRepairError: null,
            stepsRepairNextRetryAt: null,
          });
        }
        const stepMetricIds = metricIdsForHealthDataTypes(
          ['steps'],
          current.metrics,
        );
        const repairFrom = new Date(cursor.from);
        let nextRepair: PersistedHealthStatus['stepsRepair'] = cursor;
        let batchFrom: Date | null = null;
        let batchThrough: string | null = null;
        const batchRecords: import('@/src/health/types').HealthImportRecord[] = [];
        for (
          let batchIndex = 0;
          batchIndex < STEPS_REPAIR_CHUNKS_PER_BATCH && nextRepair;
          batchIndex += 1
        ) {
          const chunkEnd: Date = new Date(nextRepair.cursorEnd);
          const chunkStart: Date = new Date(chunkEnd);
          chunkStart.setDate(chunkStart.getDate() - STEPS_REPAIR_CHUNK_DAYS);
          if (chunkStart < repairFrom) chunkStart.setTime(repairFrom.getTime());
          const finalChunk: boolean =
            chunkStart.getTime() <= repairFrom.getTime();
          const records = await nativeHealthAdapter.read({
            from: chunkStart,
            to: chunkEnd,
            dataTypes: ['steps'],
            sourcePreferences: current.settings.healthSync.sourcePreferences,
            liveStepSources: current.settings.healthSync.liveStepSources,
            liveStepCombination:
              current.settings.healthSync.liveStepCombination,
          });
          rememberLiveStepDiagnostics(records);
          batchRecords.push(...records);
          batchFrom = chunkStart;
          batchThrough ??= aggregateRangeThroughLocalDate(chunkEnd);
          nextRepair = finalChunk
            ? null
            : {
                from: cursor.from,
                cursorEnd: chunkStart.toISOString(),
              };
        }
        if (!batchFrom || !batchThrough) return;
        const sourcePreferences = rememberHealthSources(batchRecords);
        const entries = mapHealthRecordsToEntries(
          batchRecords,
          current.currentUserId,
          healthVisibilityByMetric(current.metrics),
          current.metrics,
          current.settings.energyProfile,
          sourcePreferences,
          healthFallbackContextForRead(current.entries, current.metrics, ['steps']),
          current.settings.stepCoveragePreferences,
        );
        // Four native slices become one reducer update, one React render, and
        // one deferred/coalesced snapshot write. Keep the cloud gate open while
        // Health Connect reads so chat/group work remains responsive; pause it
        // only around the single local historical merge.
        setCloudSyncPaused('health-steps-repair', true);
        try {
          await importHealthEntries(
            entries,
            nativeHealthAdapter.provider!,
            stepMetricIds,
            dateKey(batchFrom),
            false,
            true,
            {
              metricIds: stepMetricIds,
              throughDate: batchThrough,
              removeStepFallbacks: true,
            },
            true,
          );
        } finally {
          setCloudSyncPaused('health-steps-repair', false);
        }
        await saveStatus({
          ...persistedRef.current,
          stepsImportVersion: nextRepair
            ? persistedRef.current.stepsImportVersion
            : HEALTH_STEPS_IMPORT_VERSION,
          stepsRepair: nextRepair,
          stepsRepairError: null,
          stepsRepairNextRetryAt: null,
        });
        if (nextRepair)
          scheduleStepsRepair(STEPS_REPAIR_NEXT_CHUNK_DELAY_MS);
      } catch (error) {
        await saveStatus({
          ...persistedRef.current,
          stepsRepairError:
            error instanceof Error ? error.message : 'Steps repair failed.',
          stepsRepairNextRetryAt: new Date(
            Date.now() + STEPS_REPAIR_RETRY_MS,
          ).toISOString(),
        });
        scheduleStepsRepair(STEPS_REPAIR_RETRY_MS);
        throw error;
      } finally {
        // Also releases a gate if a reducer/storage exception interrupted the
        // guarded import above.
        setCloudSyncPaused('health-steps-repair', false);
      }
    })().finally(() => {
      syncingRef.current = null;
      activeHealthOperationRef.current = null;
    });
    syncingRef.current = operation;
    return operation;
  }, [importHealthEntries, rememberHealthSources, rememberLiveStepDiagnostics, saveStatus, scheduleStepsRepair]);
  runStepsRepairRef.current = runStepsRepair;

  const runSync = useCallback(async (reason: 'connect' | 'open' | 'pull' | 'manual' | 'history' | 'backfill', forceEnabled = false) => {
    const pending = syncingRef.current;
    if (pending) {
      if (activeHealthOperationRef.current === 'full') return pending;
      await pending.catch(() => undefined);
      // A quick current-day read or repair chunk must not consume and discard
      // the full-sync request that owns the multi-type checkpoint.
      return runSyncRef.current?.(reason, forceEnabled);
    }
    const current = stateRef.current;
    if ((!current.settings.healthSync.enabled && !forceEnabled) || !nativeHealthAdapter.provider) return;
    const dataTypes = enabledHealthDataTypes(current.settings.healthSync.dataTypes);
    if (!dataTypes.length) throw new Error('Choose at least one health data category.');
    activeHealthOperationRef.current = 'full';
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
          if (
            dataTypes.includes('steps') &&
            signedInNativeAccountId === current.currentUserId
          )
            void markPhysicalActivityMigrationAttempt(
              signedInNativeAccountId,
            ).catch(() => undefined);
          await nativeHealthAdapter.requestPermissions(
            dataTypes,
            current.settings.healthSync.backgroundAccess,
          );
        }
        const historyDays = normalizeHealthHistoryDays(
          current.settings.healthHistoryDays,
        );
        const requestedHistorySelection = healthHistorySelectionKey(
          historyDays,
        );
        const historySelectionIsCurrent = () => {
          const latest = stateRef.current.settings;
          return (
            healthHistorySelectionKey(
              normalizeHealthHistoryDays(latest.healthHistoryDays),
            ) === requestedHistorySelection
          );
        };
        const metricIds = metricIdsForHealthDataTypes(
          dataTypes,
          current.metrics,
        );
        const stepMetricIds = dataTypes.includes('steps')
          ? metricIdsForHealthDataTypes(['steps'], current.metrics)
          : [];
        const stepAggregateReplacement = (to: Date) =>
          stepMetricIds.length
            ? {
                metricIds: stepMetricIds,
                throughDate: aggregateRangeThroughLocalDate(to),
                removeStepFallbacks: true,
              }
            : undefined;
        const requestedAt = new Date();
        let importedCount = 0;
        let cumulativeImportedCount = 0;
        let backfill =
          historyDays === 0 || fullRefresh ? null : previous.backfill;
        let completedStepHistoryRange: {
          from: string;
          through: string;
        } | null = null;
        if ((fullRefresh || initialHistoryImport) && !backfill) {
          const now = new Date();
          const historyFrom = syncStart(
            null,
            true,
            historyDays,
            now,
          );
          const recentFrom = new Date(now);
          recentFrom.setDate(
            recentFrom.getDate() - HEALTH_ROUTINE_OVERLAP_DAYS,
          );
          if (recentFrom < historyFrom) recentFrom.setTime(historyFrom.getTime());
          const finalChunk = recentFrom.getTime() <= historyFrom.getTime();
          backfill = finalChunk
            ? null
            : {
                from: historyFrom.toISOString(),
                cursorEnd: recentFrom.toISOString(),
                through: now.toISOString(),
                importedCount: 0,
                finalizeTrackedGoalHistory: initialHistoryImport,
                preserveTrackedGoalHistory: fullRefresh,
              };
          if (finalChunk)
            completedStepHistoryRange = {
              from: historyFrom.toISOString(),
              through: now.toISOString(),
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
            liveStepSources: current.settings.healthSync.liveStepSources,
            liveStepCombination:
              current.settings.healthSync.liveStepCombination,
          });
          if (!historySelectionIsCurrent()) {
            setStatus('ready');
            return;
          }
          rememberLiveStepDiagnostics(records);
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            healthVisibilityByMetric(current.metrics),
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
            healthFallbackContextForRead(current.entries, current.metrics, dataTypes),
            current.settings.stepCoveragePreferences,
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
            stepAggregateReplacement(now),
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
            liveStepSources: current.settings.healthSync.liveStepSources,
            liveStepCombination:
              current.settings.healthSync.liveStepCombination,
          });
          if (!historySelectionIsCurrent()) {
            setStatus('ready');
            return;
          }
          rememberLiveStepDiagnostics(records);
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            healthVisibilityByMetric(current.metrics),
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
            healthFallbackContextForRead(current.entries, current.metrics, dataTypes),
            current.settings.stepCoveragePreferences,
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
            stepAggregateReplacement(chunkEnd),
          );
          if (finalChunk && backfill.through)
            completedStepHistoryRange = {
              from: backfill.from,
              through: backfill.through,
            };
          backfill = finalChunk
            ? null
            : {
                ...backfill,
                cursorEnd: chunkStart.toISOString(),
                importedCount: cumulativeImportedCount,
              };
          if (backfill) scheduleBackfill(NEXT_BACKFILL_DELAY_MS);
        } else {
          const from = syncStart(
            previous.lastSyncedAt,
            false,
            historyDays,
          );
          const to = new Date();
          const records = await nativeHealthAdapter.read({
            from,
            to,
            dataTypes,
            sourcePreferences: current.settings.healthSync.sourcePreferences,
            liveStepSources: current.settings.healthSync.liveStepSources,
            liveStepCombination:
              current.settings.healthSync.liveStepCombination,
          });
          if (!historySelectionIsCurrent()) {
            setStatus('ready');
            return;
          }
          rememberLiveStepDiagnostics(records);
          const sourcePreferences = rememberHealthSources(records);
          const entries = mapHealthRecordsToEntries(
            records,
            current.currentUserId,
            healthVisibilityByMetric(current.metrics),
            current.metrics,
            current.settings.energyProfile,
            sourcePreferences,
            healthFallbackContextForRead(current.entries, current.metrics, dataTypes),
            current.settings.stepCoveragePreferences,
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
            stepAggregateReplacement(to),
          );
          if (backfill) scheduleBackfill(FIRST_BACKFILL_DELAY_MS);
        }
        const cumulativeCount = backfill
          ? Math.max(backfill.importedCount, cumulativeImportedCount)
          : cumulativeImportedCount;
        const existingImportedStepDates = stepMetricIds.length
          ? current.entries
              .filter(
                (entry) =>
                  entry.userId === current.currentUserId &&
                  stepMetricIds.includes(entry.metricId) &&
                  hasHealthImportIdentity(entry),
              )
              .map((entry) => entry.localDate)
          : [];
        const completedStepsImportVersion =
          stepMetricIds.length &&
          completedStepHistoryRange &&
          stepRepairRangeCovered(
            historicalStepRepairStart(
              requestedAt,
              historyDays,
              existingImportedStepDates,
            ),
            new Date(completedStepHistoryRange.from),
            new Date(completedStepHistoryRange.through),
            requestedAt,
          )
            ? HEALTH_STEPS_IMPORT_VERSION
            : persistedRef.current.stepsImportVersion;
        if (!historySelectionIsCurrent()) {
          setStatus('ready');
          return;
        }
        await saveStatus({
          ...persistedRef.current,
          // Any successful native read proves that this device remains
          // connected. Backfill this marker for users upgrading from builds
          // that only stored the flag in the cloud-sanitized app snapshot.
          connectionEnabled: true,
          backgroundAccess: current.settings.healthSync.backgroundAccess,
          lastSyncedAt: new Date().toISOString(),
          lastStepSyncedAt: stepMetricIds.length
            ? requestedAt.toISOString()
            : persistedRef.current.lastStepSyncedAt,
          lastReason: reason,
          importedCount: cumulativeCount,
          error: null,
          backfill,
          retryAttempt: 0,
          nextRetryAt: null,
          stepsImportVersion: completedStepsImportVersion,
          stepsRepair:
            completedStepsImportVersion === HEALTH_STEPS_IMPORT_VERSION
              ? null
              : persistedRef.current.stepsRepair,
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
        activeHealthOperationRef.current = null;
      }
    })();
    syncingRef.current = operation;
    return operation;
  }, [importHealthEntries, markPhysicalActivityMigrationAttempt, rememberHealthSources, rememberLiveStepDiagnostics, saveStatus, scheduleBackfill, signedInNativeAccountId]);
  runSyncRef.current = runSync;

  const resetPersistedHistoryWork = useCallback(async () => {
    const accountId = stateRef.current.currentUserId;
    const key = `${HEALTH_STATUS_STORAGE_KEY}:${accountId}`;
    const reset = await runAppStateStorageMutation(async () => {
      const stored =
        parsePersistedHealthStatus(await AsyncStorage.getItem(key)) ??
        persistedRef.current;
      const next: PersistedHealthStatus = {
        ...stored,
        backfill: null,
        stepsRepair: null,
        stepsRepairError: null,
        stepsRepairNextRetryAt: null,
        backgroundReconciliation: null,
        retryAttempt: 0,
        nextRetryAt: null,
      };
      await AsyncStorage.setItem(key, JSON.stringify(next));
      return next;
    });
    if (stateRef.current.currentUserId !== accountId) return;
    persistedRef.current = reset;
    setPersisted(reset);
  }, []);

  const setHealthHistoryDays = useCallback(async (days: HealthHistoryDays) => {
    const nextDays = normalizeHealthHistoryDays(days);
    const currentState = stateRef.current;
    const previousDays = normalizeHealthHistoryDays(
      currentState.settings.healthHistoryDays,
    );
    if (nextDays === previousDays) return;

    const pending = syncingRef.current;
    if (backfillTimerRef.current) {
      clearTimeout(backfillTimerRef.current);
      backfillTimerRef.current = null;
    }
    if (stepsRepairTimerRef.current) {
      clearTimeout(stepsRepairTimerRef.current);
      stepsRepairTimerRef.current = null;
    }
    setCloudSyncPaused('health-backfill', false);
    setCloudSyncPaused('health-steps-repair', false);
    const healthSync = {
      ...currentState.settings.healthSync,
      ...(nextDays === 0
        ? {
            backfillTrackedGoalsOnFirstImport: false,
            backfillTrackedGoalsEmptyReadCount: undefined,
          }
        : {}),
    };
    const settings = {
      ...currentState.settings,
      healthHistoryDays: nextDays,
      healthSync,
    };
    // Publish the boundary before awaiting storage so any native read already
    // in flight fails its pre-commit selection check.
    stateRef.current = { ...currentState, settings };
    updateSettingsRef.current({ healthHistoryDays: nextDays, healthSync });
    await resetPersistedHistoryWork();
    if (pending) {
      await pending.catch(() => undefined);
      // A foreground save that was already queued can land after the first
      // reset. Clear its obsolete cursor once more after it fully exits.
      await resetPersistedHistoryWork();
    }
  }, [resetPersistedHistoryWork]);

  const connect = useCallback(async (options?: {
    historyDays?: HealthHistoryDays;
    dataTypes?: HealthDataType[];
    startTrackedGoalsAtFirstData?: boolean;
  }) => {
    if (!availability?.available) throw new Error(availability?.detail ?? 'Health data is not available on this device.');
    const current = stateRef.current.settings;
    const dataTypes = options?.dataTypes
      ? [...new Set(options.dataTypes)]
      : enabledHealthDataTypes(current.healthSync.dataTypes);
    if (!dataTypes.length)
      throw new Error('Choose at least one connected-health tracker first.');
    const requestedBackgroundAccess =
      healthSyncSchedule(
        current.syncMode,
        current.healthSync.backgroundIntervalHours,
      ).requestsBackground;
    setStatus('requesting');
    try {
      if (
        dataTypes.includes('steps') &&
        signedInNativeAccountId === stateRef.current.currentUserId
      )
        void markPhysicalActivityMigrationAttempt(
          signedInNativeAccountId,
        ).catch(() => undefined);
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
      const previousHistoryDays = normalizeHealthHistoryDays(
        latest.healthHistoryDays,
      );
      const requestedHistoryDays = normalizeHealthHistoryDays(
        options?.historyDays ?? previousHistoryDays,
      );
      const historyBackfillAlreadyPending =
        latest.healthSync.backfillTrackedGoalsOnFirstImport === true;
      const shouldArmHistoryBackfill =
        requestedHistoryDays === 0
          ? false
          : options === undefined
          ? historyBackfillAlreadyPending
          : options.startTrackedGoalsAtFirstData === true;
      const initialHistoryImportPending =
        options !== undefined || !persistedRef.current.lastSyncedAt;
      const healthSync = {
        ...latest.healthSync,
        enabled: true,
        backgroundAccess,
        dataTypes: options?.dataTypes
          ? (Object.fromEntries(
              (Object.keys(latest.healthSync.dataTypes) as HealthDataType[]).map(
                (type) => [type, dataTypes.includes(type)],
              ),
            ) as Record<HealthDataType, boolean>)
          : latest.healthSync.dataTypes,
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
        healthHistoryDays: requestedHistoryDays,
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
      if (
        healthHistorySelectionKey(
          requestedHistoryDays,
        ) !==
        healthHistorySelectionKey(
          previousHistoryDays,
        )
      )
        await resetPersistedHistoryWork();
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
  }, [availability, markPhysicalActivityMigrationAttempt, resetPersistedHistoryWork, runSync, saveStatus, signedInNativeAccountId, updateSettings]);

  const setSyncMode = useCallback(async (
    mode: SyncMode,
    requestedIntervalHours?: number,
  ) => {
    const currentState = stateRef.current;
    const current = currentState.settings;
    const backgroundIntervalHours = normalizeBackgroundSyncIntervalHours(
      requestedIntervalHours ?? current.healthSync.backgroundIntervalHours,
    );
    const schedule = healthSyncSchedule(mode, backgroundIntervalHours);
    let healthSync =
      mode === 'custom'
        ? { ...current.healthSync, backgroundIntervalHours }
        : current.healthSync;

    if (!schedule.requestsBackground) {
      healthSync = { ...healthSync, backgroundAccess: false };
    } else if (healthSync.enabled && !healthSync.backgroundAccess) {
      const dataTypes = enabledHealthDataTypes(healthSync.dataTypes);
      setStatus('requesting');
      try {
        if (
          dataTypes.includes('steps') &&
          signedInNativeAccountId === currentState.currentUserId
        )
          void markPhysicalActivityMigrationAttempt(
            signedInNativeAccountId,
          ).catch(() => undefined);
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
  }, [markPhysicalActivityMigrationAttempt, saveStatus, signedInNativeAccountId, updateSettings]);

  const setBackgroundSyncIntervalHours = useCallback(
    async (hours: number) => {
      await setSyncMode(
        'custom',
        normalizeBackgroundSyncIntervalHours(hours),
      );
    },
    [setSyncMode],
  );

  const disconnect = useCallback(async () => {
    setCloudSyncPaused('health-backfill', false);
    setCloudSyncPaused('health-steps-repair', false);
    if (backfillTimerRef.current) {
      clearTimeout(backfillTimerRef.current);
      backfillTimerRef.current = null;
    }
    await nativeHealthAdapter.disconnect?.().catch(() => undefined);
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
    if (todayStepsTimerRef.current) {
      clearTimeout(todayStepsTimerRef.current);
      todayStepsTimerRef.current = null;
    }
    if (stepsRepairTimerRef.current) {
      clearTimeout(stepsRepairTimerRef.current);
      stepsRepairTimerRef.current = null;
    }
  }, []);

  const setLiveStepConfiguration = useCallback(
    async (sources: LiveStepSource[], combination: LiveStepCombination) => {
      const currentState = stateRef.current;
      const currentHealth = currentState.settings.healthSync;
      const liveStepSources = normalizeLiveStepSources(sources);
      if (!liveStepSources.length)
        throw new Error("Choose at least one live Step source.");
      const healthSync = {
        ...currentHealth,
        liveStepSources,
        liveStepCombination: combination,
      };
      stateRef.current = {
        ...currentState,
        settings: { ...currentState.settings, healthSync },
      };
      // Do not leave the previous configuration's candidate totals on screen
      // while the newly selected source read is pending or if it fails.
      setLiveStepDiagnostics(null);
      updateSettingsRef.current({ healthSync });
      if (
        liveStepSources.includes('physical_activity') &&
        currentHealth.enabled
      )
        await nativeHealthAdapter.prepareCurrentDaySteps?.().catch(
          () => undefined,
        );
      try {
        if (currentHealth.enabled && currentHealth.dataTypes.steps)
          await refreshTodayStepsRef.current?.(true, true);
      } catch (error) {
        // A source that cannot be read should not remain selected while Today
        // still shows the prior source's last confirmed total.
        const latestState = stateRef.current;
        stateRef.current = {
          ...latestState,
          settings: { ...latestState.settings, healthSync: currentHealth },
        };
        updateSettingsRef.current({ healthSync: currentHealth });
        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    // Cloud merges often recreate the settings object even when the actual
    // Health Connect schedule is unchanged. Avoid repeatedly reconfiguring the
    // native background task in that case.
    let cancelled = false;
    const currentSettings = stateRef.current.settings;
    const schedule = healthSyncSchedule(
      currentSettings.syncMode,
      currentSettings.healthSync.backgroundIntervalHours,
    );
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
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      !state.settings.healthSync.dataTypes.steps ||
      normalizeHealthHistoryDays(state.settings.healthHistoryDays) === 0 ||
      state.settings.healthSync.initialHistoryImportPending ||
      Boolean(persisted.backfill) ||
      (persisted.stepsImportVersion ?? 0) >= HEALTH_STEPS_IMPORT_VERSION
    ) {
      if ((persisted.stepsImportVersion ?? 0) >= HEALTH_STEPS_IMPORT_VERSION)
        setCloudSyncPaused('health-steps-repair', false);
      return;
    }
    const retryAt = persisted.stepsRepairNextRetryAt
      ? new Date(persisted.stepsRepairNextRetryAt).getTime()
      : 0;
    scheduleStepsRepair(
      Math.max(FIRST_BACKFILL_DELAY_MS, retryAt - Date.now()),
    );
    return () => {
      if (stepsRepairTimerRef.current) {
        clearTimeout(stepsRepairTimerRef.current);
        stepsRepairTimerRef.current = null;
      }
    };
  }, [
    persisted.stepsImportVersion,
    persisted.backfill,
    persisted.stepsRepair,
    persisted.stepsRepairNextRetryAt,
    scheduleStepsRepair,
    state.settings.healthSync.dataTypes.steps,
    state.settings.healthSync.enabled,
    state.settings.healthSync.initialHistoryImportPending,
    state.settings.healthHistoryDays,
    state.settings.onboardingComplete,
    status,
  ]);

  useEffect(() => {
    if (
      status !== 'ready' ||
      NativeAppState.currentState !== 'active' ||
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      !state.settings.healthSync.dataTypes.steps
    )
      return;
    if (todayStepsTimerRef.current)
      clearTimeout(todayStepsTimerRef.current);
    todayStepsTimerRef.current = setTimeout(() => {
      todayStepsTimerRef.current = null;
      if (NativeAppState.currentState === 'active')
        refreshTodayStepsAfterInteractions();
    }, FOREGROUND_STEPS_SETTLE_DELAY_MS);
    todayStepsIntervalRef.current = setInterval(() => {
      if (NativeAppState.currentState === 'active')
        refreshTodayStepsAfterInteractions();
    }, HEALTH_TODAY_STEPS_ACTIVE_REFRESH_MS);
    return () => {
      if (todayStepsTimerRef.current) {
        clearTimeout(todayStepsTimerRef.current);
        todayStepsTimerRef.current = null;
      }
      if (todayStepsIntervalRef.current) {
        clearInterval(todayStepsIntervalRef.current);
        todayStepsIntervalRef.current = null;
      }
    };
  }, [
    refreshTodayStepsAfterInteractions,
    state.currentUserId,
    state.settings.healthSync.dataTypes.steps,
    state.settings.healthSync.enabled,
    state.settings.onboardingComplete,
    status,
  ]);

  useEffect(() => {
    if (
      status !== 'ready' ||
      !persisted.backfill ||
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      normalizeHealthHistoryDays(state.settings.healthHistoryDays) === 0
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
    state.settings.healthHistoryDays,
    state.settings.onboardingComplete,
    status,
  ]);

  useEffect(
    () => () => {
      if (backfillTimerRef.current) clearTimeout(backfillTimerRef.current);
      if (todayStepsTimerRef.current) clearTimeout(todayStepsTimerRef.current);
      if (todayStepsIntervalRef.current)
        clearInterval(todayStepsIntervalRef.current);
      todayStepsInteractionRef.current?.cancel();
      if (todayStepsInteractionFallbackRef.current)
        clearTimeout(todayStepsInteractionFallbackRef.current);
      if (stepsRepairTimerRef.current) clearTimeout(stepsRepairTimerRef.current);
      setCloudSyncPaused('health-steps-repair', false);
    },
    [],
  );

  useEffect(() => {
    if (
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      state.settings.healthSync.initialHistoryImportPending ||
      !healthSyncSchedule(
        state.settings.syncMode,
        state.settings.healthSync.backgroundIntervalHours,
      ).requestsBackground
    ) return;
    // An automatic failure must remain quiet until the user retries or the app
    // is reopened. Including `error` here previously created an immediate loop.
    if (status !== 'ready') return;
    const last = persisted.lastSyncedAt
      ? new Date(persisted.lastSyncedAt).getTime()
      : 0;
    const stale =
      Date.now() - last >=
      healthSyncMinimumIntervalMs(
        state.settings.syncMode,
        state.settings.healthSync.backgroundIntervalHours,
      );
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
    state.settings.healthSync.backgroundIntervalHours,
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
      if (next !== 'active' && todayStepsTimerRef.current) {
        clearTimeout(todayStepsTimerRef.current);
        todayStepsTimerRef.current = null;
      }
      if (next !== 'active') return;
      // Today's one-bucket aggregate is small and user-visible. Refresh it on
      // every meaningful foreground return independently of the 1h/6h/12h
      // full-import cadence, with a short throttle for rapid app switching.
      if (
        stateRef.current.settings.onboardingComplete &&
        stateRef.current.settings.healthSync.enabled &&
        stateRef.current.settings.healthSync.dataTypes.steps
      ) {
        todayStepsTimerRef.current = setTimeout(() => {
          todayStepsTimerRef.current = null;
          if (NativeAppState.currentState === 'active')
            refreshTodayStepsAfterInteractions();
        }, FOREGROUND_STEPS_SETTLE_DELAY_MS);
      }
      if (
        stateRef.current.settings.onboardingComplete &&
        stateRef.current.settings.healthSync.enabled &&
        stateRef.current.settings.healthSync.dataTypes.steps &&
        normalizeHealthHistoryDays(
          stateRef.current.settings.healthHistoryDays,
        ) !== 0 &&
        !stateRef.current.settings.healthSync.initialHistoryImportPending &&
        !persistedRef.current.backfill &&
        (persistedRef.current.stepsImportVersion ?? 0) <
          HEALTH_STEPS_IMPORT_VERSION
      ) {
        const retryAt = persistedRef.current.stepsRepairNextRetryAt
          ? new Date(persistedRef.current.stepsRepairNextRetryAt).getTime()
          : 0;
        scheduleStepsRepair(
          Math.max(FIRST_BACKFILL_DELAY_MS, retryAt - Date.now()),
        );
      }
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
            stateRef.current.settings.healthSync.enabled &&
            normalizeHealthHistoryDays(
              stateRef.current.settings.healthHistoryDays,
            ) !== 0
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
            !healthSyncSchedule(
              stateRef.current.settings.syncMode,
              stateRef.current.settings.healthSync.backgroundIntervalHours,
            )
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
            healthSyncMinimumIntervalMs(
              stateRef.current.settings.syncMode,
              stateRef.current.settings.healthSync.backgroundIntervalHours,
            )
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
      if (todayStepsTimerRef.current) clearTimeout(todayStepsTimerRef.current);
    };
  }, [
    refreshTodayStepsAfterInteractions,
    runSync,
    scheduleBackfill,
    scheduleStepsRepair,
  ]);

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

  const syncNow = useCallback(
    async (reason: 'open' | 'pull' | 'manual' = 'manual') => {
      const currentHealth = stateRef.current.settings.healthSync;
      // Existing connected users have already completed Health Connect's
      // consent flow. A deliberate tap on Settings > Sync now is the safe,
      // contextual migration point for Android's separate Physical Activity
      // prompt; passive launch/resume refreshes never open a system dialog.
      if (
        reason === 'manual' &&
        currentHealth.enabled &&
        currentHealth.dataTypes.steps
      ) {
        if (signedInNativeAccountId === stateRef.current.currentUserId)
          void markPhysicalActivityMigrationAttempt(
            signedInNativeAccountId,
          ).catch(() => undefined);
        await nativeHealthAdapter.prepareCurrentDaySteps?.().catch(
          () => undefined,
        );
      }
      return runSync(reason);
    },
    [markPhysicalActivityMigrationAttempt, runSync, signedInNativeAccountId],
  );

  const value = useMemo<HealthSyncContextValue>(() => ({
    status,
    availability,
    lastSyncedAt: persisted.lastSyncedAt,
    lastStepSyncedAt: persisted.lastStepSyncedAt ?? null,
    importedCount: persisted.importedCount ?? 0,
    errorMessage: persisted.error ?? null,
    backgroundRegistration,
    sourceOrigins,
    sourceOptions,
    liveStepDiagnostics,
    connect,
    syncNow,
    syncHistory: () => runSync('history'),
    setHealthHistoryDays,
    setSyncMode,
    setBackgroundSyncIntervalHours,
    setSourceEnabled,
    setLiveStepConfiguration,
    disconnect,
    openSettings: nativeHealthAdapter.openSettings,
  }), [availability, backgroundRegistration, connect, disconnect, liveStepDiagnostics, persisted, runSync, setBackgroundSyncIntervalHours, setHealthHistoryDays, setLiveStepConfiguration, setSourceEnabled, setSyncMode, sourceOptions, sourceOrigins, status, syncNow]);

  return <HealthSyncContext.Provider value={value}>{children}</HealthSyncContext.Provider>;
}

export function useHealthSync() {
  const context = useContext(HealthSyncContext);
  if (!context) throw new Error('useHealthSync must be used inside HealthSyncProvider');
  return context;
}
