import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { isCloudGroupId, pushCloudRecentActivity } from '@/src/cloud/groupCloud';
import { dateKey } from '@/src/domain/date';
import { applyImportedFoodFastBreaks } from '@/src/domain/fasting';
import { enabledHealthDataTypes, healthVisibilityByMetric, mapHealthRecordsToEntries, mergeHealthEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import { mergeHealthSourcePreferences } from '@/src/domain/healthDedup';
import { nativeHealthAdapter } from '@/src/health/adapter';
import { HEALTH_INITIAL_DAYS, HEALTH_STATUS_STORAGE_KEY } from '@/src/health/constants';
import {
  BackgroundHealthSyncRegistration,
  healthSyncMinimumIntervalMs,
  healthSyncSchedule,
} from '@/src/health/schedule';
import { PersistedHealthStatus } from '@/src/health/types';
import { supabase } from '@/src/lib/supabase';
import {
  APP_STORAGE_KEY,
  appAccountStorageKey,
} from '@/src/state/AppProvider';
import { AppState, HealthSyncSettings, SyncMode } from '@/src/types';

const TASK_NAME = 'paceboard-health-background-sync';
const CLOUD_SYNC_CHECKPOINT_KEY_PREFIX = 'habhub-cloud-checkpoint-v1:';

function startDate(lastSyncedAt: string | null) {
  let date = lastSyncedAt ? new Date(lastSyncedAt) : new Date();
  if (Number.isNaN(date.getTime())) date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(
    date.getDate() - (lastSyncedAt ? 2 : HEALTH_INITIAL_DAYS),
  );
  return date;
}

TaskManager.defineTask(TASK_NAME, async () => {
  let previousStatus: PersistedHealthStatus = { lastSyncedAt: null };
  let statusUserId = "unknown";
  try {
    const stateJson = await AsyncStorage.getItem(APP_STORAGE_KEY);
    if (!stateJson || !nativeHealthAdapter.provider) return BackgroundTask.BackgroundTaskResult.Success;
    const state = JSON.parse(stateJson) as AppState;
    statusUserId = state.currentUserId;
    const statusJson = await AsyncStorage.getItem(
      `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`,
    );
    const schedule = healthSyncSchedule(state.settings.syncMode);
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
        healthSyncMinimumIntervalMs(schedule.mode)
    )
      return BackgroundTask.BackgroundTaskResult.Success;
    const dataTypes = enabledHealthDataTypes(state.settings.healthSync.dataTypes);
    if (!dataTypes.length) return BackgroundTask.BackgroundTaskResult.Success;
    const from = startDate(status.lastSyncedAt);
    const records = await nativeHealthAdapter.read({
      from,
      to: new Date(),
      dataTypes,
      sourcePreferences: state.settings.healthSync.sourcePreferences,
    });
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
    );
    const nextState = applyImportedFoodFastBreaks({
      ...state,
      settings:
        sourcePreferences === state.settings.healthSync.sourcePreferences
          ? state.settings
          : {
              ...state.settings,
              healthSync: { ...state.settings.healthSync, sourcePreferences },
            },
      entries: mergeHealthEntries(state, entries, nativeHealthAdapter.provider, metricIdsForHealthDataTypes(dataTypes, state.metrics), dateKey(from)),
      lastSavedAt: new Date().toISOString(),
    }, entries);
    const nextStatus: PersistedHealthStatus = {
      ...status,
      connectionEnabled: true,
      backgroundAccess: state.settings.healthSync.backgroundAccess,
      lastSyncedAt: new Date().toISOString(),
      lastReason: 'background',
      lastImportFromDate: dateKey(from),
      importedCount: entries.length,
      error: null,
    };
    // Commit rows first and the status/checkpoint last. Foreground resume uses
    // that checkpoint as the proof that the stored replacement window is
    // complete, so these writes must not race each other.
    const serializedState = JSON.stringify(nextState);
    await AsyncStorage.multiSet([
      [APP_STORAGE_KEY, serializedState],
      [appAccountStorageKey(nextState.currentUserId), serializedState],
    ]);
    await AsyncStorage.setItem(
      `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`,
      JSON.stringify(nextStatus),
    );
    // Local health import is the durable source of truth. If a signed-in cloud
    // session is available, publish only the two-day compact leaderboard
    // overlap as a best-effort follow-up. Network/auth failure must never roll
    // back the native import or make WorkManager repeat the Health Connect read.
    if (supabase && isCloudGroupId(nextState.group.id)) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id === nextState.currentUserId) {
          const published = await pushCloudRecentActivity(nextState, 2);
          if (published.updatedAt)
            await AsyncStorage.setItem(
              `${CLOUD_SYNC_CHECKPOINT_KEY_PREFIX}${nextState.currentUserId}`,
              published.updatedAt,
            );
        }
      } catch {
        // The foreground durable outbox publishes this state on next resume.
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    const retryAttempt = Math.min(
      8,
      (previousStatus.retryAttempt ?? 0) + 1,
    );
    const retryDelay = Math.min(
      6 * 60 * 60 * 1000,
      5 * 60 * 1000 * 2 ** (retryAttempt - 1),
    );
    const failed: PersistedHealthStatus = {
      ...previousStatus,
      lastReason: 'background',
      importedCount: previousStatus.importedCount ?? 0,
      error: error instanceof Error ? error.message : 'Background health sync failed.',
      retryAttempt,
      nextRetryAt: new Date(Date.now() + retryDelay).toISOString(),
    };
    await AsyncStorage.setItem(
      `${HEALTH_STATUS_STORAGE_KEY}:${statusUserId}`,
      JSON.stringify(failed),
    ).catch(() => undefined);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function configureBackgroundHealthSync(
  settings: HealthSyncSettings,
  mode: SyncMode,
): Promise<BackgroundHealthSyncRegistration> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  const schedule = healthSyncSchedule(mode);
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
