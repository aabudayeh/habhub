import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { dateKey } from '@/src/domain/date';
import { enabledHealthDataTypes, mapHealthRecordsToEntries, mergeHealthEntries, metricIdsForHealthDataTypes } from '@/src/domain/health';
import { nativeHealthAdapter } from '@/src/health/adapter';
import { HEALTH_HISTORY_DAYS, HEALTH_STATUS_STORAGE_KEY } from '@/src/health/constants';
import { PersistedHealthStatus } from '@/src/health/types';
import { APP_STORAGE_KEY } from '@/src/state/AppProvider';
import { AppState, HealthSyncSettings, SyncMode } from '@/src/types';

const TASK_NAME = 'paceboard-health-background-sync';

function startDate(lastSyncedAt: string | null) {
  let date = lastSyncedAt ? new Date(lastSyncedAt) : new Date();
  if (Number.isNaN(date.getTime())) date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(
    date.getDate() - (lastSyncedAt ? 2 : HEALTH_HISTORY_DAYS),
  );
  return date;
}

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const stateJson = await AsyncStorage.getItem(APP_STORAGE_KEY);
    if (!stateJson || !nativeHealthAdapter.provider) return BackgroundTask.BackgroundTaskResult.Success;
    const state = JSON.parse(stateJson) as AppState;
    const statusJson = await AsyncStorage.getItem(
      `${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`,
    );
    if (!state.settings.healthSync.enabled || state.settings.syncMode === 'manual') return BackgroundTask.BackgroundTaskResult.Success;
    let status: PersistedHealthStatus = { lastSyncedAt: null };
    if (statusJson) {
      try { status = JSON.parse(statusJson) as PersistedHealthStatus; }
      catch { status = { lastSyncedAt: null }; }
    }
    const dataTypes = enabledHealthDataTypes(state.settings.healthSync.dataTypes);
    if (!dataTypes.length) return BackgroundTask.BackgroundTaskResult.Success;
    const from = startDate(status.lastSyncedAt);
    const records = await nativeHealthAdapter.read({ from, to: new Date(), dataTypes });
    const entries = mapHealthRecordsToEntries(
      records,
      state.currentUserId,
      'group',
      state.metrics,
      state.settings.energyProfile.weightKg,
    );
    const nextState: AppState = {
      ...state,
      entries: mergeHealthEntries(state, entries, nativeHealthAdapter.provider, metricIdsForHealthDataTypes(dataTypes, state.metrics), dateKey(from)),
      lastSavedAt: new Date().toISOString(),
    };
    const nextStatus: PersistedHealthStatus = {
      lastSyncedAt: new Date().toISOString(),
      lastReason: 'background',
      importedCount: entries.length,
      error: null,
    };
    await Promise.all([
      AsyncStorage.setItem(APP_STORAGE_KEY, JSON.stringify(nextState)),
      AsyncStorage.setItem(`${HEALTH_STATUS_STORAGE_KEY}:${state.currentUserId}`, JSON.stringify(nextStatus)),
    ]);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    const failed: PersistedHealthStatus = {
      lastSyncedAt: null,
      lastReason: 'background',
      importedCount: 0,
      error: error instanceof Error ? error.message : 'Background health sync failed.',
    };
    const stateJson = await AsyncStorage.getItem(APP_STORAGE_KEY).catch(() => null);
    const userId = stateJson ? (JSON.parse(stateJson) as AppState).currentUserId : "unknown";
    await AsyncStorage.setItem(`${HEALTH_STATUS_STORAGE_KEY}:${userId}`, JSON.stringify(failed)).catch(() => undefined);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function configureBackgroundHealthSync(settings: HealthSyncSettings, mode: SyncMode) {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (!settings.enabled || mode === 'manual') {
    if (registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    return;
  }
  const minimumInterval = mode === 'frequent' ? 60 : mode === 'balanced' ? 360 : 720;
  if (registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval });
}
