import {
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import { HealthAdapter, HealthImportRecord } from '@/src/health/types';
import { HealthDataType, NutritionDetails } from '@/src/types';

type QuantityConfig = {
  identifier: string;
  type: HealthDataType;
  unit: string;
  nutritionField?: keyof NutritionDetails;
};

const QUANTITIES: QuantityConfig[] = [
  { identifier: 'HKQuantityTypeIdentifierStepCount', type: 'steps', unit: 'count' },
  { identifier: 'HKQuantityTypeIdentifierActiveEnergyBurned', type: 'active_energy', unit: 'kcal' },
  { identifier: 'HKQuantityTypeIdentifierBodyMass', type: 'weight', unit: 'kg' },
  { identifier: 'HKQuantityTypeIdentifierDietaryEnergyConsumed', type: 'nutrition', unit: 'kcal' },
  { identifier: 'HKQuantityTypeIdentifierDietaryProtein', type: 'nutrition', unit: 'g', nutritionField: 'proteinG' },
  { identifier: 'HKQuantityTypeIdentifierDietaryFatTotal', type: 'nutrition', unit: 'g', nutritionField: 'fatG' },
  { identifier: 'HKQuantityTypeIdentifierDietaryCarbohydrates', type: 'nutrition', unit: 'g', nutritionField: 'carbsG' },
  { identifier: 'HKQuantityTypeIdentifierDietaryFiber', type: 'nutrition', unit: 'g', nutritionField: 'fiberG' },
  { identifier: 'HKQuantityTypeIdentifierDietarySodium', type: 'nutrition', unit: 'mg', nutritionField: 'sodiumMg' },
  { identifier: 'HKQuantityTypeIdentifierDietaryWater', type: 'water', unit: 'L' },
];

function asDate(value: unknown, fallback: Date) {
  const date = value instanceof Date ? value : new Date(String(value ?? fallback.toISOString()));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function nestedNumber(value: unknown, ...keys: string[]) {
  let current: unknown = value;
  for (const key of keys) current = typeof current === 'object' && current ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === 'number' && Number.isFinite(current) ? current : 0;
}

function sourceName(value: Record<string, unknown>) {
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const source = (sources[0] ?? (value.sourceRevision as Record<string, unknown> | undefined)?.source) as Record<string, unknown> | undefined;
  return String(source?.bundleIdentifier ?? source?.name ?? 'Apple Health');
}

async function readQuantity(config: QuantityConfig, from: Date, to: Date): Promise<HealthImportRecord[]> {
  if (config.type === 'weight') {
    const samples = await queryQuantitySamples(config.identifier, {
      limit: 0,
      ascending: true,
      unit: config.unit,
      filter: { date: { startDate: from, endDate: to } },
    });
    return samples.map((sample) => {
      const start = asDate(sample.startDate, from);
      const end = asDate(sample.endDate, start);
      return {
        id: String(sample.uuid ?? `${config.identifier}:${end.toISOString()}`),
        provider: 'apple_health' as const,
        type: config.type,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        value: Number(sample.quantity ?? 0),
        unit: config.unit,
        origin: sourceName(sample),
      };
    });
  }
  const buckets = await queryStatisticsCollectionForQuantity(
    config.identifier,
    ['cumulativeSum'],
    from,
    { day: 1 },
    { unit: config.unit, filter: { date: { startDate: from, endDate: to, strictStartDate: true, strictEndDate: true } } },
  );
  return buckets.flatMap((bucket) => {
    const value = nestedNumber(bucket, 'sumQuantity', 'quantity');
    if (value <= 0) return [];
    const start = asDate(bucket.startDate, from);
    const end = asDate(bucket.endDate, start);
    const nutrition = config.nutritionField ? { [config.nutritionField]: value } as NutritionDetails : undefined;
    return [{
      id: `${config.identifier}:${start.toISOString().slice(0, 10)}`,
      provider: 'apple_health' as const,
      type: config.type,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      value: config.type === 'nutrition' && config.nutritionField ? 0 : value,
      unit: config.unit,
      origin: sourceName(bucket),
      nutrition,
    }];
  });
}

export const appleHealthAdapter: HealthAdapter = {
  provider: 'apple_health',
  availability: async () => ({
    available: await isHealthDataAvailableAsync(),
    provider: 'apple_health',
    title: 'Apple Health',
    detail: 'Imports permitted data from Apple Health, including data written there by compatible apps and wearables.',
  }),
  requestPermissions: async (dataTypes) => {
    const toRead = QUANTITIES.filter((item) => dataTypes.includes(item.type)).map((item) => item.identifier);
    if (dataTypes.includes('workouts')) toRead.push('HKWorkoutTypeIdentifier');
    if (!toRead.length) throw new Error('Choose at least one health data category.');
    await requestAuthorization({ toRead });
  },
  read: async ({ from, to, dataTypes }) => {
    const records = (await Promise.all(QUANTITIES.filter((item) => dataTypes.includes(item.type)).map((item) => readQuantity(item, from, to)))).flat();
    if (!dataTypes.includes('workouts')) return records;
    const workouts = await queryWorkoutSamples({ limit: 0, ascending: true, filter: { date: { startDate: from, endDate: to } } });
    return [...records, ...workouts.map((workout): HealthImportRecord => {
      const start = asDate(workout.startDate, from);
      const end = asDate(workout.endDate, start);
      return {
        id: String(workout.uuid ?? `workout:${start.toISOString()}`),
        provider: 'apple_health',
        type: 'workouts',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        value: true,
        unit: '',
        origin: sourceName(workout),
        label: String(workout.workoutActivityType ?? 'Workout'),
      };
    })];
  },
  openSettings: async () => { await Linking.openSettings(); },
};

