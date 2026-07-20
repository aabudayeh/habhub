import { HealthDataType, HealthProvider, NutritionDetails } from '@/src/types';

export type HealthImportRecord = {
  id: string;
  type: HealthDataType;
  provider: HealthProvider;
  startTime: string;
  endTime: string;
  value: number | boolean;
  unit: string;
  origin?: string;
  label?: string;
  nutrition?: NutritionDetails;
  note?: string;
  measurements?: { durationMinutes?: number; activeCalories?: number; distanceKm?: number; speedKmh?: number; systolic?: number; diastolic?: number };
  updatedAt?: string;
};

export type HealthReadRequest = {
  from: Date;
  to: Date;
  dataTypes: HealthDataType[];
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
  requestPermissions: (dataTypes: HealthDataType[], backgroundAccess: boolean) => Promise<void>;
  read: (request: HealthReadRequest) => Promise<HealthImportRecord[]>;
  openSettings: () => Promise<void>;
};

export type PersistedHealthStatus = {
  lastSyncedAt: string | null;
  lastReason?: 'connect' | 'open' | 'pull' | 'manual' | 'background';
  importedCount?: number;
  error?: string | null;
};
