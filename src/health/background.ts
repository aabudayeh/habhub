import { HealthSyncSettings, SyncMode } from '@/src/types';

/** Web fallback; native builds substitute background.native.ts. */
export async function configureBackgroundHealthSync(_settings: HealthSyncSettings, _mode: SyncMode) {}

