import {
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { CategoryTypes } from '@kingstinct/react-native-healthkit/modules';
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
  { identifier:'HKQuantityTypeIdentifierDietarySugar',type:'nutrition',unit:'g',nutritionField:'sugarG' },
  { identifier:'HKQuantityTypeIdentifierDietaryFatSaturated',type:'nutrition',unit:'g',nutritionField:'saturatedFatG' },
  { identifier:'HKQuantityTypeIdentifierDietaryCholesterol',type:'nutrition',unit:'mg',nutritionField:'cholesterolMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryPotassium',type:'nutrition',unit:'mg',nutritionField:'potassiumMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryCalcium',type:'nutrition',unit:'mg',nutritionField:'calciumMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryIron',type:'nutrition',unit:'mg',nutritionField:'ironMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryMagnesium',type:'nutrition',unit:'mg',nutritionField:'magnesiumMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryVitaminC',type:'nutrition',unit:'mg',nutritionField:'vitaminCMg' },
  { identifier:'HKQuantityTypeIdentifierDietaryVitaminD',type:'nutrition',unit:'mcg',nutritionField:'vitaminDMcg' },
  { identifier:'HKQuantityTypeIdentifierDietaryVitaminB12',type:'nutrition',unit:'mcg',nutritionField:'vitaminB12Mcg' },
  { identifier: 'HKQuantityTypeIdentifierDietaryWater', type: 'water', unit: 'L' },
  { identifier: 'HKQuantityTypeIdentifierBodyFatPercentage', type: 'body_fat', unit: '%' },
  { identifier: 'HKQuantityTypeIdentifierLeanBodyMass', type: 'lean_body_mass', unit: 'kg' },
  { identifier: 'HKQuantityTypeIdentifierRestingHeartRate', type: 'heart_rate', unit: 'count/min' },
  { identifier: 'HKQuantityTypeIdentifierBloodGlucose', type: 'blood_glucose', unit: 'mg/dL' },
];

async function readCategories(type:HealthDataType,identifier:'HKCategoryTypeIdentifierSleepAnalysis'|'HKCategoryTypeIdentifierMenstrualFlow',from:Date,to:Date):Promise<HealthImportRecord[]>{
  const samples=await CategoryTypes.queryCategorySamples(identifier,{limit:0,ascending:true,filter:{date:{startDate:from,endDate:to}}});
  return samples.flatMap((sample)=>{const start=asDate(sample.startDate,from);const end=asDate(sample.endDate,start);const numeric=Number(sample.value);if(type==='sleep'&&![1,3,4,5].includes(numeric))return[];if(type==='menstruation'&&numeric===5)return[];const durationMinutes=Math.max(0,(end.getTime()-start.getTime())/60000);return[{id:String(sample.uuid??`${identifier}:${start.toISOString()}`),provider:'apple_health' as const,type,startTime:start.toISOString(),endTime:end.toISOString(),value:type==='sleep'?durationMinutes/60:true,unit:type==='sleep'?'hr':'',origin:sourceName(sample),measurements:type==='sleep'?{durationMinutes}:undefined}];});
}

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
  if (config.type === 'weight' || config.type === 'body_fat' || config.type === 'lean_body_mass' || config.type === 'heart_rate') {
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
    if(dataTypes.includes('sleep'))toRead.push('HKCategoryTypeIdentifierSleepAnalysis');
    if(dataTypes.includes('menstruation'))toRead.push('HKCategoryTypeIdentifierMenstrualFlow');
    if (!toRead.length) throw new Error('Choose at least one health data category.');
    await requestAuthorization({ toRead });
  },
  read: async ({ from, to, dataTypes }) => {
    const records = (await Promise.all(QUANTITIES.filter((item) => dataTypes.includes(item.type)).map((item) => readQuantity(item, from, to)))).flat();
    if(dataTypes.includes('sleep'))records.push(...await readCategories('sleep','HKCategoryTypeIdentifierSleepAnalysis',from,to));
    if(dataTypes.includes('menstruation'))records.push(...await readCategories('menstruation','HKCategoryTypeIdentifierMenstrualFlow',from,to));
    if (!dataTypes.includes('workouts')) return records;
    const workouts = await queryWorkoutSamples({ limit: 0, ascending: true, filter: { date: { startDate: from, endDate: to } } });
    return [...records, ...workouts.map((workout): HealthImportRecord => {
      const raw = workout as unknown as Record<string, unknown>;
      const start = asDate(workout.startDate, from);
      const end = asDate(workout.endDate, start);
      return {
        id: String(workout.uuid ?? `workout:${start.toISOString()}`),
        provider: 'apple_health',
        type: 'workouts',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        value: Math.max(1,(end.getTime()-start.getTime())/60000),
        unit: 'min',
        origin: sourceName(workout),
        label: String(workout.workoutActivityType ?? 'Workout'),
        measurements: {
          durationMinutes: Math.max(0,(end.getTime()-start.getTime())/60000),
          activeCalories: nestedNumber(raw,'totalEnergyBurned','quantity') || Number(raw.totalEnergyBurned ?? 0),
          distanceKm: nestedNumber(raw,'totalDistance','quantity') || Number(raw.totalDistance ?? 0),
        },
      };
    })];
  },
  openSettings: async () => { await Linking.openSettings(); },
};
