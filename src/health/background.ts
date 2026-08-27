import { HealthSyncSettings, SyncMode } from '@/src/types';
import {
  BackgroundHealthSyncRegistration,
  healthSyncSchedule,
} from '@/src/health/schedule';

/** Web fallback; native builds substitute background.native.ts. */
export async function configureBackgroundHealthSync(
  settings: HealthSyncSettings,
  mode: SyncMode,
): Promise<BackgroundHealthSyncRegistration> {
  return settings.enabled &&
    settings.backgroundAccess &&
    healthSyncSchedule(mode, settings.backgroundIntervalHours)
      .requestsBackground
    ? 'unavailable'
    : 'disabled';
}
