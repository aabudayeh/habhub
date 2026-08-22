export const HEALTH_STATUS_STORAGE_KEY = 'paceboard-health-status-v1';
/** Two-year repair window for first connection and user-requested refreshes. */
export const HEALTH_HISTORY_DAYS = 730;
/** Keep first-run onboarding responsive; deeper history is an explicit repair. */
export const HEALTH_INITIAL_DAYS = 30;
/**
 * Version 2 repairs completed-day rows from the short-lived Samsung override
 * into Health Connect's priority-aware historical aggregates. Today's
 * phone-origin authority does not require a history repair.
 */
export const HEALTH_STEPS_IMPORT_VERSION = 2;
/**
 * One automatic, post-hydration request per native device/account/version.
 * Version 3 gives existing accounts one contextual opportunity to grant the
 * Physical Activity permission for the Local Recording fallback. Android 14+
 * uses the Health Connect phone origin first; explicit Settings > Sync now
 * remains available after a denial.
 */
export const HEALTH_PHYSICAL_ACTIVITY_MIGRATION_VERSION = 3;
const HEALTH_PHYSICAL_ACTIVITY_MIGRATION_KEY =
  'paceboard-health-physical-activity-migration';

export function healthPhysicalActivityMigrationKey(accountId: string) {
  return `${HEALTH_PHYSICAL_ACTIVITY_MIGRATION_KEY}:v${HEALTH_PHYSICAL_ACTIVITY_MIGRATION_VERSION}:${accountId}`;
}
/** A foreground return may refresh today's one-bucket aggregate this often. */
export const HEALTH_TODAY_STEPS_MIN_INTERVAL_MS = 20_000;
/** Health Connect batches on-device steps about once per minute. */
export const HEALTH_TODAY_STEPS_ACTIVE_REFRESH_MS = 60_000;
