import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { isCloudGroupId, pushCloudRecentActivity } from '@/src/cloud/groupCloud';
import { publishJoinedPublicChallengeTotals } from '@/src/cloud/publicChallengeProjection';
import { dateKey } from '@/src/domain/date';
import {
  healthHistorySelectionKey,
  healthImportStart,
  normalizeHealthHistoryDays,
} from '@/src/domain/healthHistory';
import { backgroundHealthReconciliationWindow } from '@/src/domain/healthReconciliation';
import { applyImportedFoodFastBreaks } from '@/src/domain/fasting';
import { enabledHealthDataTypes, healthFallbackContextForRead, healthVisibilityByMetric, mapHealthRecordsToEntries, mergeHealthEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import {
  aggregateRangeThroughLocalDate,
  currentDayStepFloorsForEmptyReplacement,
  isDailyStepReplacementCandidate,
  mergeHealthSourcePreferences,
  preserveCurrentDayStepFloor,
  preserveCurrentDayStepReplacementFloor,
} from '@/src/domain/healthDedup';
import { nativeHealthAdapter } from '@/src/health/adapter';
import {
  HEALTH_INITIAL_DAYS,
  HEALTH_ROUTINE_OVERLAP_DAYS,
  HEALTH_STATUS_STORAGE_KEY,
} from '@/src/health/constants';
import {
  BackgroundHealthSyncRegistration,
  healthSyncMinimumIntervalMs,
  healthSyncSchedule,
} from '@/src/health/schedule';
import { HealthImportRecord, PersistedHealthStatus } from '@/src/health/types';
import { parsePersistedHealthStatus } from '@/src/health/persistedStatus';
import { supabase } from '@/src/lib/supabase';
import {
  APP_STORAGE_KEY,
  appAccountStorageKey,
} from '@/src/storage/appStateKeys';
import {
  getAppStateStorageItem,
  multiSetAppStateStorage,
} from '@/src/storage/appStateStorage';
import { runAppStateStorageMutation } from '@/src/storage/appStateMutation';
import { AppState, HealthDataType, HealthHistoryDays, HealthSyncSettings, SyncMode } from '@/src/types';

const TASK_NAME = 'paceboard-health-background-sync';
const CLOUD_SYNC_CHECKPOINT_KEY_PREFIX = 'habhub-cloud-checkpoint-v1:';

function startDate(
  lastSyncedAt: string | null,
  historyDays: HealthHistoryDays,
  now: Date,
) {
  return healthImportStart({
    now,
    lastSyncedAt,
    historyDays,
    initialDays: HEALTH_INITIAL_DAYS,
    routineOverlapDays: HEALTH_ROUTINE_OVERLAP_DAYS,
  });
}

function parseAppState(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

function applyBackgroundHealthRecords(
  state: AppState,
  records: HealthImportRecord[],
  dataTypes: HealthDataType[],
  from: Date,
  to: Date,
  provider: NonNullable<(typeof nativeHealthAdapter)['provider']>,
) {
  const sourcePreferences = mergeHealthSourcePreferences(
    state.settings.healthSync.sourcePreferences,
    records,
  );
  const entries = mapHealthRecordsToEntries(
    records,
    state.currentUserId,
    healthVisibilityByMetric(state.metrics),
    state.metrics,
    state.settings.energyProfile,
    sourcePreferences,
    healthFallbackContextForRead(state.entries, state.metrics, dataTypes),
    state.settings.stepCoveragePreferences,
  );
  const stepMetricIds = dataTypes.includes('steps')
    ? metricIdsForHealthDataTypes(['steps'], state.metrics)
    : [];
  const stepMetricSet = new Set(stepMetricIds);
  const replacementThrough = aggregateRangeThroughLocalDate(to);
  const currentLocalDate = dateKey();
  const existingById = new Map(
    state.entries.map((entry) => [`${entry.userId}:${entry.id}`, entry]),
  );
  const existingCurrentStepEntriesByMetric = new Map<
    string,
    AppState['entries']
  >();
  for (const entry of state.entries) {
    if (
      entry.userId !== state.currentUserId ||
      entry.localDate !== currentLocalDate ||
      !stepMetricSet.has(entry.metricId)
    )
      continue;
    const dayEntries =
      existingCurrentStepEntriesByMetric.get(entry.metricId) ?? [];
    dayEntries.push(entry);
    existingCurrentStepEntriesByMetric.set(entry.metricId, dayEntries);
  }
  const revisionSafeEntries = entries.map((entry) =>
    stepMetricSet.has(entry.metricId)
      ? preserveCurrentDayStepReplacementFloor(
          existingCurrentStepEntriesByMetric.get(entry.metricId) ?? [],
          preserveCurrentDayStepFloor(
            existingById.get(`${entry.userId}:${entry.id}`),
            entry,
            currentLocalDate,
          ),
          currentLocalDate,
        )
      : entry,
  );
  const currentDayFloors =
    stepMetricIds.length &&
    dateKey(from) <= currentLocalDate &&
    replacementThrough >= currentLocalDate
      ? currentDayStepFloorsForEmptyReplacement(
          state.entries,
          revisionSafeEntries,
          {
            userId: state.currentUserId,
            currentLocalDate,
            stepMetricIds: stepMetricSet,
          },
        )
      : [];
  const revisionSafeEntriesWithFloors = [
    ...revisionSafeEntries,
    ...currentDayFloors,
  ];
  const replacementBase = stepMetricIds.length
    ? {
        ...state,
        entries: state.entries.filter(
          (entry) =>
            !isDailyStepReplacementCandidate(entry, {
              userId: state.currentUserId,
              provider,
              stepMetricIds: stepMetricSet,
              fromDate: dateKey(from),
              throughDate: replacementThrough,
              includeFallbacks: true,
            }),
        ),
      }
    : state;
  const nextState = applyImportedFoodFastBreaks(
    {
      ...replacementBase,
      settings:
        sourcePreferences === state.settings.healthSync.sourcePreferences
          ? state.settings
          : {
              ...state.settings,
              healthSync: {
                ...state.settings.healthSync,
                sourcePreferences,
              },
            },
      entries: mergeHealthEntries(
        replacementBase,
        revisionSafeEntriesWithFloors,
        provider,
        metricIdsForHealthDataTypes(dataTypes, state.metrics),
        dateKey(from),
        dateKey(to),
      ),
      lastSavedAt: new Date().toISOString(),
    },
    revisionSafeEntriesWithFloors,
  );
  return { entries, nextState, revisionSafeEntriesWithFloors };
}

TaskManager.defineTask(TASK_NAME, async () => {
  let previousStatus: PersistedHealthStatus = { lastSyncedAt: null };
  let statusUserId = "unknown";
  try {
    const provider = nativeHealthAdapter.provider;
    const stateJson = await getAppStateStorageItem(APP_STORAGE_KEY);
    if (!stateJson || !provider) return BackgroundTask.BackgroundTaskResult.Success;
    const state = JSON.parse(stateJson) as AppState;
    statusUserId = state.currentUserId;
    const statusJson = await AsyncStorage.getItem(
      `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`,
    );
    const schedule = healthSyncSchedule(
      state.settings.syncMode,
      state.settings.healthSync.backgroundIntervalHours,
    );
    if (
      !state.settings.healthSync.enabled ||
      !state.settings.healthSync.backgroundAccess ||
      !schedule.requestsBackground
    )
      return BackgroundTask.BackgroundTaskResult.Success;
    let status: PersistedHealthStatus = { lastSyncedAt: null };
    if (statusJson) {
      try { status = JSON.parse(statusJson) as PersistedHealthStatus; }
      catch { status = { lastSyncedAt: null }; }
    }
    previousStatus = status;
    const lastSuccessfulSync = status.lastSyncedAt
      ? new Date(status.lastSyncedAt).getTime()
      : 0;
    if (
      Number.isFinite(lastSuccessfulSync) &&
      Date.now() - lastSuccessfulSync <
        healthSyncMinimumIntervalMs(
          schedule.mode,
          state.settings.healthSync.backgroundIntervalHours,
        )
    )
      return BackgroundTask.BackgroundTaskResult.Success;
    const dataTypes = enabledHealthDataTypes(state.settings.healthSync.dataTypes);
    if (!dataTypes.length) return BackgroundTask.BackgroundTaskResult.Success;
    const to = new Date();
    const historyDays = normalizeHealthHistoryDays(
      state.settings.healthHistoryDays,
    );
    const requestedHistorySelection = healthHistorySelectionKey(
      historyDays,
    );
    const from = startDate(
      status.lastSyncedAt,
      historyDays,
      to,
    );
    const records = await nativeHealthAdapter.read({
      from,
      to,
      dataTypes,
      sourcePreferences: state.settings.healthSync.sourcePreferences,
      liveStepSources: state.settings.healthSync.liveStepSources,
      liveStepCombination: state.settings.healthSync.liveStepCombination,
    });
    const reconciliation =
      provider === 'health_connect'
        ? backgroundHealthReconciliationWindow({
            historyDays,
            now: to,
            recentFrom: from,
            state: status.backgroundReconciliation,
          })
        : null;
    const reconciliationRecords = reconciliation
      ? await nativeHealthAdapter.read({
          from: reconciliation.from,
          to: reconciliation.to,
          dataTypes,
          sourcePreferences: state.settings.healthSync.sourcePreferences,
          liveStepSources: state.settings.healthSync.liveStepSources,
          liveStepCombination: state.settings.healthSync.liveStepCombination,
        })
      : [];
    // Health Connect may take seconds while another headless notification task
    // or the foreground provider commits state. Re-read and transform the
    // newest account snapshot inside the shared write gate; network publishing
    // remains below and never holds this local durability lock.
    const applied = await runAppStateStorageMutation(async () => {
      const statusKey = `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`;
      const latestStatus =
        parsePersistedHealthStatus(await AsyncStorage.getItem(statusKey)) ??
        status;
      const accountKey = appAccountStorageKey(state.currentUserId);
      const legacySnapshot = await getAppStateStorageItem(APP_STORAGE_KEY);
      const activeState = parseAppState(legacySnapshot);
      // The native read above can outlive a foreground account switch. Never
      // restore the original owner from an absent, malformed, or foreign
      // global active-account pointer.
      if (activeState?.currentUserId !== state.currentUserId) return null;
      const latest = activeState;
      const latestSchedule = healthSyncSchedule(
        latest.settings.syncMode,
        latest.settings.healthSync.backgroundIntervalHours,
      );
      if (
        !latest.settings.healthSync.enabled ||
        !latest.settings.healthSync.backgroundAccess ||
        !latestSchedule.requestsBackground
      )
        return null;
      if (
        healthHistorySelectionKey(
          normalizeHealthHistoryDays(latest.settings.healthHistoryDays),
        ) !== requestedHistorySelection
      )
        return null;
      const latestEnabledTypes = new Set(
        enabledHealthDataTypes(latest.settings.healthSync.dataTypes),
      );
      const currentDataTypes = dataTypes.filter((type) =>
        latestEnabledTypes.has(type),
      );
      if (!currentDataTypes.length) return null;
      const currentRecords = records.filter((record) =>
        currentDataTypes.includes(record.type),
      );
      const recentResult = applyBackgroundHealthRecords(
        latest,
        currentRecords,
        currentDataTypes,
        from,
        to,
        provider,
      );
      const reconciliationResult = reconciliation
        ? applyBackgroundHealthRecords(
            recentResult.nextState,
            reconciliationRecords.filter((record) =>
              currentDataTypes.includes(record.type),
            ),
            currentDataTypes,
            reconciliation.from,
            reconciliation.to,
            provider,
          )
        : null;
      const result = reconciliationResult ?? recentResult;
      const allImportedEntries = [
        ...recentResult.entries,
        ...(reconciliationResult?.entries ?? []),
      ];
      const allRevisionSafeEntries = [
        ...recentResult.revisionSafeEntriesWithFloors,
        ...(reconciliationResult?.revisionSafeEntriesWithFloors ?? []),
      ];
      const syncedAt = new Date().toISOString();
      const nextStatus: PersistedHealthStatus = {
        ...latestStatus,
        connectionEnabled: true,
        backgroundAccess: result.nextState.settings.healthSync.backgroundAccess,
        lastSyncedAt: syncedAt,
        lastStepSyncedAt: currentDataTypes.includes('steps')
          ? syncedAt
          : status.lastStepSyncedAt,
        lastReason: 'background',
        lastImportFromDate: dateKey(from),
        importedCount: allImportedEntries.length,
        backgroundReconciliation: reconciliation
          ? reconciliation.nextState
          : latestStatus.backgroundReconciliation,
        error: null,
      };
      const serializedState = JSON.stringify(result.nextState);
      await multiSetAppStateStorage([
        [APP_STORAGE_KEY, serializedState],
        [accountKey, serializedState],
      ]);
      // The status carries the replacement-window checkpoint used by any
      // foreground writer queued behind this transaction. Keep it inside the
      // same JS mutation gate so that writer can rebase instead of restoring a
      // stale set of native rows.
      await AsyncStorage.setItem(
        statusKey,
        JSON.stringify(nextStatus),
      );
      return {
        ...result,
        dataTypes: currentDataTypes,
        revisionSafeEntriesWithFloors: allRevisionSafeEntries,
      };
    });
    if (!applied) return BackgroundTask.BackgroundTaskResult.Success;
    const { nextState, revisionSafeEntriesWithFloors } = applied;
    // Local health import is the durable source of truth. If a signed-in cloud
    // session is available, publish only the two-day compact leaderboard
    // overlap as a best-effort follow-up. Network/auth failure must never roll
    // back the native import or make WorkManager repeat the Health Connect read.
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id === nextState.currentUserId) {
          if (isCloudGroupId(nextState.group.id)) {
            const changedDates = [
              ...new Set(
                revisionSafeEntriesWithFloors.map((entry) => entry.localDate),
              ),
            ].sort((left, right) => right.localeCompare(left));
            const published = await pushCloudRecentActivity(
              nextState,
              2,
              undefined,
              changedDates,
            );
            if (published.updatedAt)
              await AsyncStorage.setItem(
                `${CLOUD_SYNC_CHECKPOINT_KEY_PREFIX}${nextState.currentUserId}`,
                published.updatedAt,
              );
          }
          // Public participants may not share the creator's group. Refresh
          // their explicitly consented challenge aggregates in the same
          // background pass so settlement never mistakes a stale score for a
          // completed post-deadline sync.
          await publishJoinedPublicChallengeTotals(nextState);
        }
      } catch {
        // The foreground durable outbox publishes this state on next resume.
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    if (statusUserId !== 'unknown')
      await runAppStateStorageMutation(async () => {
        const statusKey = `${HEALTH_STATUS_STORAGE_KEY}:${statusUserId}`;
        const latestStatus =
          parsePersistedHealthStatus(await AsyncStorage.getItem(statusKey)) ??
          previousStatus;
        const retryAttempt = Math.min(
          8,
          (latestStatus.retryAttempt ?? 0) + 1,
        );
        const retryDelay = Math.min(
          6 * 60 * 60 * 1000,
          5 * 60 * 1000 * 2 ** (retryAttempt - 1),
        );
        const failed: PersistedHealthStatus = {
          ...latestStatus,
          lastReason: 'background',
          importedCount: latestStatus.importedCount ?? 0,
          error:
            error instanceof Error
              ? error.message
              : 'Background health sync failed.',
          retryAttempt,
          nextRetryAt: new Date(Date.now() + retryDelay).toISOString(),
        };
        await AsyncStorage.setItem(statusKey, JSON.stringify(failed));
      }).catch(() => undefined);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function configureBackgroundHealthSync(
  settings: HealthSyncSettings,
  mode: SyncMode,
): Promise<BackgroundHealthSyncRegistration> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  const schedule = healthSyncSchedule(
    mode,
    settings.backgroundIntervalHours,
  );
  // Android Health Connect background reads require the separate background
  // grant. If it is unavailable, foreground/resume sync remains active and we
  // avoid registering an OS task that can only fail and waste battery.
  if (
    !settings.enabled ||
    !settings.backgroundAccess ||
    !schedule.requestsBackground
  ) {
    if (registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    return 'disabled';
  }
  const availability = await BackgroundTask.getStatusAsync();
  // Expo SDK 54's runtime returns 2 for Available, but the package namespace
  // does not expose the enum value through its public TypeScript surface.
  if (availability !== 2) {
    if (registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    return 'unavailable';
  }
  const minimumInterval = schedule.minimumIntervalMinutes!;
  if (registered) {
    const options =
      await TaskManager.getTaskOptionsAsync<BackgroundTask.BackgroundTaskOptions>(
        TASK_NAME,
      ).catch(() => null);
    if (Number(options?.minimumInterval) === minimumInterval)
      return 'registered';
    await BackgroundTask.unregisterTaskAsync(TASK_NAME);
  }
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval });
  return 'registered';
}
