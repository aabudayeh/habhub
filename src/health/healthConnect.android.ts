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
  active_energy: 'TotalCaloriesBurned',
  weight: 'Weight',
  nutrition: 'Nutrition',
  water: 'Hydration',
  workouts: 'ExerciseSession',
  body_fat: 'BodyFat',
  lean_body_mass: 'LeanBodyMass',
  blood_pressure: 'BloodPressure',
  heart_rate: 'HeartRate',
  sleep: 'SleepSession',
  blood_glucose: 'BloodGlucose',
  menstruation: 'MenstruationPeriod',
};

const EXERCISE_NAMES:Record<number,string>={0:'Workout',8:'Cycling',9:'Indoor cycling',16:'Elliptical',37:'Hiking',56:'Running',57:'Treadmill',79:'Walking',80:'Wheelchair activity'};

function nestedNumber(value: unknown, ...keys: string[]) {
  let current: unknown = value;
  for (const key of keys) current = typeof current === 'object' && current ? (current as Record<string, unknown>)[key] : undefined;
  const parsed=Number(current);return Number.isFinite(parsed) ? parsed : 0;
}

function origin(record: Record<string, unknown>) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(metadata?.dataOrigin ?? 'Health Connect');
}

function recordId(record: Record<string, unknown>, type: HealthDataType) {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return String(metadata?.id ?? metadata?.clientRecordId ?? `${type}:${record.startTime}:${record.endTime}`);
}

function recordDuration(record: Record<string, unknown>) {
  return Math.max(0, new Date(String(record.endTime)).getTime() - new Date(String(record.startTime)).getTime());
}

function individualIntervals(records: Record<string, unknown>[]) {
  return records.filter((candidate) => {
    const duration = recordDuration(candidate);
    if (duration >= 6 * 60 * 60 * 1000) return false; // Samsung's running daily total includes resting metabolism.
    return !records.some((other) => other !== candidate && origin(other) === origin(candidate) && recordDuration(other) < duration && String(other.startTime) >= String(candidate.startTime) && String(other.endTime) <= String(candidate.endTime));
  });
}

function overlaps(record: Record<string, unknown>, start: string, end: string) {
  return String(record.endTime) > start && String(record.startTime) < end;
}

function nutrition(record: Record<string, unknown>): NutritionDetails {
  const oneDecimal=(value:number)=>Math.round(value*10)/10;
  return {
    proteinG: oneDecimal(nestedNumber(record, 'protein', 'inGrams')),
    fatG: oneDecimal(nestedNumber(record, 'totalFat', 'inGrams')),
    carbsG: oneDecimal(nestedNumber(record, 'totalCarbohydrate', 'inGrams')),
    fiberG: oneDecimal(nestedNumber(record, 'dietaryFiber', 'inGrams')),
    sodiumMg: Math.round(nestedNumber(record, 'sodium', 'inMilligrams') || nestedNumber(record, 'sodium', 'inGrams') * 1000),
    sugarG:oneDecimal(nestedNumber(record,'sugar','inGrams')),saturatedFatG:oneDecimal(nestedNumber(record,'saturatedFat','inGrams')),
    cholesterolMg:Math.round(nestedNumber(record,'cholesterol','inMilligrams')),potassiumMg:Math.round(nestedNumber(record,'potassium','inMilligrams')),
    calciumMg:Math.round(nestedNumber(record,'calcium','inMilligrams')),ironMg:oneDecimal(nestedNumber(record,'iron','inMilligrams')),magnesiumMg:Math.round(nestedNumber(record,'magnesium','inMilligrams')),
    vitaminCMg:oneDecimal(nestedNumber(record,'vitaminC','inMilligrams')),vitaminDMcg:oneDecimal(nestedNumber(record,'vitaminD','inMicrograms')),vitaminB12Mcg:oneDecimal(nestedNumber(record,'vitaminB12','inMicrograms')),
  };
}

function convert(type: HealthDataType, record: Record<string, unknown>): HealthImportRecord {
  const startTime = String(record.startTime ?? record.time ?? new Date().toISOString());
  const endTime = String(record.endTime ?? record.time ?? startTime);
  let value: number | boolean = 0;
  let unit = '';
  if (type === 'steps') { value = Number(record.count ?? 0); unit = 'steps'; }
  if (type === 'active_energy') { value = nestedNumber(record, 'energy', 'inKilocalories') || nestedNumber(record,'energy','inCalories')/1000 || nestedNumber(record,'totalEnergyBurned','inKilocalories') || Number(record.activeCalories??0); unit = 'kcal'; }
  if (type === 'weight') { value = nestedNumber(record, 'weight', 'inKilograms'); unit = 'kg'; }
  if (type === 'nutrition') { value = nestedNumber(record, 'energy', 'inKilocalories'); unit = 'kcal'; }
  if (type === 'water') { value = nestedNumber(record, 'volume', 'inLiters') || nestedNumber(record, 'volume', 'inMilliliters') / 1000 || Number(record.liters??0); unit = 'L'; }
  const durationMinutes = Math.max(0, (new Date(endTime).getTime()-new Date(startTime).getTime())/60000);
  if (type === 'workouts') { value = durationMinutes || 1; unit = 'min'; }
  if (type === 'body_fat') { value = Number(record.percentage ?? 0); unit = '%'; }
  if (type === 'lean_body_mass') { value = nestedNumber(record, 'mass', 'inKilograms'); unit = 'kg'; }
  if (type === 'blood_pressure') { value = nestedNumber(record, 'systolic', 'inMillimetersOfMercury'); unit = 'mmHg'; }
  if (type === 'heart_rate') { const samples=Array.isArray(record.samples)?record.samples as Record<string,unknown>[]:[];const readings=samples.map((sample)=>Number(sample.beatsPerMinute)).filter((reading)=>Number.isFinite(reading)&&reading>0);value = Number(record.beatsPerMinute ?? (readings.length?readings.reduce((sum,reading)=>sum+reading,0)/readings.length:0)); unit = 'bpm'; }
  if(type==='sleep'){value=durationMinutes/60;unit='hr';}
  if(type==='blood_glucose'){value=nestedNumber(record,'level','inMilligramsPerDeciliter')||nestedNumber(record,'level','inMillimolesPerLiter')*18.0182;unit='mg/dL';}
  if(type==='menstruation'){value=true;unit='';}
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
    label: type === 'nutrition' ? String(record.mealName ?? record.name ?? 'Meal summary') : type === 'workouts' ? String(record.title ?? EXERCISE_NAMES[Number(record.exerciseType)] ?? record.exerciseType ?? 'Workout') : undefined,
    nutrition: type === 'nutrition' ? nutrition(record) : undefined,
    note: typeof record.notes === 'string' ? record.notes : undefined,
    measurements: type === 'workouts' ? {
      durationMinutes,
      activeCalories: nestedNumber(record,'energy','inKilocalories') || nestedNumber(record,'totalEnergyBurned','inKilocalories'),
      distanceKm: nestedNumber(record,'distance','inKilometers') || nestedNumber(record,'distance','inMeters')/1000,
    } : type === 'sleep' ? { durationMinutes } : type === 'blood_pressure' ? {
      systolic: nestedNumber(record, 'systolic', 'inMillimetersOfMercury'),
      diastolic: nestedNumber(record, 'diastolic', 'inMillimetersOfMercury'),
    } : undefined,
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
    const recordTypes=[...new Set(dataTypes.flatMap((type)=>type==='workouts'?['ExerciseSession','Distance','TotalCaloriesBurned']:[RECORD_TYPES[type]]))];
    const base = recordTypes.map((recordType) => ({ accessType: 'read' as const, recordType }));
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
    const readSafe = async (recordType:string) => (await readRecords(recordType,options).catch(()=>({records:[]}))).records as Record<string,unknown>[];
    const needsWorkoutDetails=dataTypes.includes('workouts');
    const calorieRecords=(dataTypes.includes('active_energy')||needsWorkoutDetails)?individualIntervals(await readSafe('TotalCaloriesBurned')):[];
    const distanceRecords=needsWorkoutDetails?individualIntervals(await readSafe('Distance')):[];
    const results = await Promise.all(dataTypes.map(async (type) => {
      try {
        if(type==='active_energy') return calorieRecords.map((record)=>convert(type,record));
        const records=await readSafe(RECORD_TYPES[type]);
        if(type==='workouts') return records.map((record)=>{
          const converted=convert(type,record);const start=String(record.startTime);const end=String(record.endTime);const source=origin(record);
          const calories=calorieRecords.filter((item)=>origin(item)===source&&overlaps(item,start,end)).reduce((sum,item)=>sum+nestedNumber(item,'energy','inKilocalories'),0);
          const distance=distanceRecords.filter((item)=>origin(item)===source&&overlaps(item,start,end)).reduce((sum,item)=>sum+(nestedNumber(item,'distance','inKilometers')||nestedNumber(item,'distance','inMeters')/1000),0);
          return {...converted,measurements:{...converted.measurements,activeCalories:calories||converted.measurements?.activeCalories,distanceKm:distance||converted.measurements?.distanceKm}};
        });
        return records.map((record) => convert(type, record));
      } catch {
        // A vendor may not expose every requested record type. Keep the other
        // categories syncing instead of failing the entire refresh.
        return [];
      }
    }));
    return results.flat();
  },
  openSettings: openHealthConnectSettings,
};
