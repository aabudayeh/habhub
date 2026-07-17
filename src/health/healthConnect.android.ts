import {
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';

import { HealthAdapter, HealthImportRecord } from '@/src/health/types';
import { HealthDataType, NutritionDetails } from '@/src/types';

const RECORD_TYPES: Record<HealthDataType, string> = {
  steps: 'Steps',
  active_energy: 'ActiveCaloriesBurned',
  weight: 'Weight',
  nutrition: 'Nutrition',
  water: 'Hydration',
  workouts: 'ExerciseSession',
};

function nestedNumber(value: unknown, ...keys: string[]) {
  let current: unknown = value;
  for (const key of keys) current = typeof current === 'object' && current ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === 'number' && Number.isFinite(current) ? current : 0;
}

function origin(record: Record<string, unknown>) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(metadata?.dataOrigin ?? 'Health Connect');
}

function recordId(record: Record<string, unknown>, type: HealthDataType) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(metadata?.id ?? metadata?.clientRecordId ?? `${type}:${record.startTime}:${record.endTime}`);
}

function nutrition(record: Record<string, unknown>): NutritionDetails {
  return {
    proteinG: nestedNumber(record, 'protein', 'inGrams'),
    fatG: nestedNumber(record, 'totalFat', 'inGrams'),
    carbsG: nestedNumber(record, 'totalCarbohydrate', 'inGrams'),
    fiberG: nestedNumber(record, 'dietaryFiber', 'inGrams'),
    sodiumMg: nestedNumber(record, 'sodium', 'inMilligrams') || nestedNumber(record, 'sodium', 'inGrams') * 1000,
  };
}

function convert(type: HealthDataType, record: Record<string, unknown>): HealthImportRecord {
  const startTime = String(record.startTime ?? record.time ?? new Date().toISOString());
  const endTime = String(record.endTime ?? record.time ?? startTime);
  let value: number | boolean = 0;
  let unit = '';
  if (type === 'steps') { value = Number(record.count ?? 0); unit = 'steps'; }
  if (type === 'active_energy') { value = nestedNumber(record, 'energy', 'inKilocalories'); unit = 'kcal'; }
  if (type === 'weight') { value = nestedNumber(record, 'weight', 'inKilograms'); unit = 'kg'; }
  if (type === 'nutrition') { value = nestedNumber(record, 'energy', 'inKilocalories'); unit = 'kcal'; }
  if (type === 'water') { value = nestedNumber(record, 'volume', 'inLiters'); unit = 'L'; }
  if (type === 'workouts') value = true;
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return {
    id: recordId(record, type),
    provider: 'health_connect',
    type,
    startTime,
    endTime,
    value,
    unit,
    origin: origin(record),
    updatedAt: typeof metadata?.lastModifiedTime === 'string' ? metadata.lastModifiedTime : undefined,
    label: type === 'nutrition' ? String(record.mealName ?? record.name ?? 'Meal summary') : type === 'workouts' ? String(record.title ?? record.exerciseType ?? 'Workout') : undefined,
    nutrition: type === 'nutrition' ? nutrition(record) : undefined,
  };
}

export const healthConnectAdapter: HealthAdapter = {
  provider: 'health_connect',
  availability: async () => {
    const available = await initialize().catch(() => false);
    return {
      available,
      provider: 'health_connect',
      title: 'Health Connect',
      detail: 'Imports Android health data from compatible sources such as Samsung Health, Google Fit, and MyFitnessPal.',
    };
  },
  requestPermissions: async (dataTypes, backgroundAccess) => {
    const base = dataTypes.map((type) => ({ accessType: 'read' as const, recordType: RECORD_TYPES[type] }));
    if (!base.length) throw new Error('Choose at least one health data category.');
    if (backgroundAccess) {
      try {
        await requestPermission([...base, { accessType: 'read', recordType: 'BackgroundAccessPermission' }]);
        return;
      } catch {
        // Some devices expose normal records but not the optional background feature.
      }
    }
    await requestPermission(base);
  },
  read: async ({ from, to, dataTypes }) => {
    const options = { timeRangeFilter: { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() }, ascendingOrder: true };
    const results = await Promise.all(dataTypes.map(async (type) => {
      const { records } = await readRecords(RECORD_TYPES[type], options);
      return records.map((record) => convert(type, record));
    }));
    return results.flat();
  },
  openSettings: openHealthConnectSettings,
};

