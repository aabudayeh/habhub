import { HealthDataType, HealthProvider, HealthSourcePreference, NutritionDetails } from '@/src/types';

export type HealthImportRecord = {
  id: string;
  type: HealthDataType;
  provider: HealthProvider;
  startTime: string;
  endTime: string;
  /** Local calendar day represented by a daily aggregate. */
  localDate?: string;
  value: number | boolean;
  unit: string;
  origin?: string;
  /** Writers observed for source controls; `origin` is the selected value source. */
  sourceOrigins?: string[];
  label?: string;
  /** Stable app-owned key normalized from the native workout classification. */
  activityKey?: string;
  /**
   * Health Connect exposes the overall activity and its typed movement
   * segments separately. Keeping the record kind explicit prevents a segment
   * from being counted as a second workout session.
   */
  workoutRecordKind?: "session" | "segment";
  nutrition?: NutritionDetails;
  note?: string;
  measurements?: { durationMinutes?: number; activeCalories?: number; distanceKm?: number; speedKmh?: number; systolic?: number; diastolic?: number };
  updatedAt?: string;
};

export type HealthReadRequest = {
  from: Date;
  to: Date;
  dataTypes: HealthDataType[];
  sourcePreferences?: Record<string, HealthSourcePreference>;
};

export type HealthAdapterAvailability = {
  available: boolean;
  provider: HealthProvider | null;
  title: string;
  detail: string;
};

export type HealthAdapter = {
  provider: HealthProvider | null;
  availability: () => Promise<HealthAdapterAvailability>;
  /**
   * Read the device's existing native grants without opening a permission
   * prompt. Android uses this only to migrate legacy connection intent when
   * no explicit per-device value has been persisted yet.
   */
  grantedConnectionState?: (
    dataTypes: HealthDataType[],
  ) => Promise<{ connected: boolean; backgroundAccess: boolean }>;
  requestPermissions: (dataTypes: HealthDataType[], backgroundAccess: boolean) => Promise<void>;
  read: (request: HealthReadRequest) => Promise<HealthImportRecord[]>;
  openSettings: () => Promise<void>;
};

export type PersistedHealthStatus = {
  lastSyncedAt: string | null;
  /** Explicit per-device connection intent; never sourced from cloud state. */
  connectionEnabled?: boolean;
  /** The background permission preference is also specific to this device. */
  backgroundAccess?: boolean;
  lastReason?: 'connect' | 'open' | 'pull' | 'manual' | 'history' | 'backfill' | 'background';
  /** Inclusive device date replaced by the most recent background import. */
  lastImportFromDate?: string;
  importedCount?: number;
  error?: string | null;
  /**
   * Older history is intentionally imported after the newest records.  The
   * cursor is persisted so Android can stop/restart the app without repeating
   * a large Health Connect read or blocking onboarding.
   */
  backfill?: {
    from: string;
    cursorEnd: string;
    importedCount: number;
    finalizeTrackedGoalHistory: boolean;
    /** A user-requested repair must never rewrite goal start periods. */
    preserveTrackedGoalHistory?: boolean;
  } | null;
  retryAttempt?: number;
  nextRetryAt?: string | null;
};
