import { SyncMode } from '@/src/types';

export type BackgroundHealthSyncRegistration =
  | 'disabled'
  | 'registered'
  | 'unavailable';

export type HealthSyncSchedule = {
  mode: SyncMode;
  /** Automatic foreground checks run on launch/resume once this old. */
  minimumIntervalMinutes: number | null;
  /** Whether HabHub should ask the OS to run the same check while closed. */
  requestsBackground: boolean;
};

const schedules: Record<SyncMode, HealthSyncSchedule> = {
  manual: {
    mode: 'manual',
    minimumIntervalMinutes: null,
    requestsBackground: false,
  },
  battery: {
    mode: 'battery',
    minimumIntervalMinutes: 12 * 60,
    requestsBackground: true,
  },
  balanced: {
    mode: 'balanced',
    minimumIntervalMinutes: 6 * 60,
    requestsBackground: true,
  },
  frequent: {
    mode: 'frequent',
    minimumIntervalMinutes: 60,
    requestsBackground: true,
  },
};

/**
 * Existing persisted ids keep their behavior. Missing or unknown legacy values
 * fall back to the app's long-standing balanced default instead of accidentally
 * registering the most frequent background cadence.
 */
export function normalizeHealthSyncMode(value: unknown): SyncMode {
  return value === 'manual' ||
    value === 'battery' ||
    value === 'balanced' ||
    value === 'frequent'
    ? value
    : 'balanced';
}

export function healthSyncSchedule(value: unknown): HealthSyncSchedule {
  return schedules[normalizeHealthSyncMode(value)];
}

export function healthSyncMinimumIntervalMs(value: unknown) {
  const minutes = healthSyncSchedule(value).minimumIntervalMinutes;
  return minutes === null
    ? Number.POSITIVE_INFINITY
    : minutes * 60 * 1000;
}
