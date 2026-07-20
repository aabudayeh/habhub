import { dateKey } from '@/src/domain/date';
import { HealthImportRecord } from '@/src/health/types';
import { AppState, HealthDataType, HealthProvider, MetricEntry, NutritionDetails, Visibility } from '@/src/types';

const METRICS_BY_DATA_TYPE: Record<HealthDataType, string[]> = {
  steps: ['steps'],
  active_energy: ['exercise'],
  weight: ['weight'],
  nutrition: ['food', 'protein', 'fat', 'carbs', 'fiber', 'sodium','sugar','saturated_fat','cholesterol','potassium','calcium','iron','magnesium','vitamin_c','vitamin_d','vitamin_b12'],
  water: ['water'],
  workouts: ['workout','workout_duration','workout_calories','workout_distance'],
  body_fat: ['body_fat'],
  lean_body_mass: ['lean_body_mass'],
  blood_pressure: ['blood_pressure_systolic','blood_pressure_diastolic'],
  heart_rate: ['pulse'],
};

export function enabledHealthDataTypes(dataTypes: Record<HealthDataType, boolean>) {
  return (Object.keys(dataTypes) as HealthDataType[]).filter((type) => dataTypes[type]);
}

export function metricIdsForHealthDataTypes(dataTypes: HealthDataType[]) {
  return [...new Set(dataTypes.flatMap((type) => METRICS_BY_DATA_TYPE[type]))];
}

function importedId(record: HealthImportRecord, metricId: string) {
  return `health:${record.provider}:${record.type}:${record.id}:${metricId}`;
}

function entryFor(
  record: HealthImportRecord,
  userId: string,
  metricId: string,
  value: number | boolean,
  visibility: Visibility,
  nutrition?: NutritionDetails,
): MetricEntry {
  const origin = record.origin?.trim();
  return {
    id: importedId(record, metricId),
    metricId,
    userId,
    value,
    localDate: dateKey(new Date(record.endTime || record.startTime)),
    recordedAt: record.endTime || record.startTime,
    visibility,
    source: 'imported',
    label: record.label ?? (origin ? `Imported from ${friendlyHealthOrigin(origin)}` : undefined),
    note: [record.note,origin ? `Synced from ${friendlyHealthOrigin(origin)}` : undefined].filter(Boolean).join(' · ') || undefined,
    nutrition,
    sourceProvider: record.provider,
    sourceRecordId: record.id,
    sourceOrigin: origin,
    sourceUpdatedAt: record.updatedAt,
  };
}

export function mapHealthRecordsToEntries(
  records: HealthImportRecord[],
  userId: string,
  visibility: Visibility = 'group',
) {
  const entries: MetricEntry[] = [];
  for (const record of normalizeStepRecords(records)) {
    if (record.type === 'steps' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'steps', Number(record.value), visibility));
    if (record.type === 'active_energy' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'exercise', Number(record.value), visibility));
    if (record.type === 'weight' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'weight', Number(record.value), visibility));
    if (record.type === 'water' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'water', Number(record.value), visibility));
    if (record.type === 'workouts' && Number(record.value)>0) {
      entries.push(entryFor(record, userId, 'workout', true, visibility));
      entries.push(entryFor(record, userId, 'workout_duration', Math.round((record.measurements?.durationMinutes??Number(record.value))*10)/10, visibility));
      if((record.measurements?.activeCalories??0)>0)entries.push(entryFor(record,userId,'workout_calories',Math.round(record.measurements!.activeCalories!),visibility));
      if((record.measurements?.distanceKm??0)>0)entries.push(entryFor(record,userId,'workout_distance',Math.round(record.measurements!.distanceKm!*100)/100,visibility));
    }
    if (record.type === 'body_fat' && Number(record.value)>0) entries.push(entryFor(record,userId,'body_fat',Math.round(Number(record.value)*10)/10,visibility));
    if (record.type === 'lean_body_mass' && Number(record.value)>0) entries.push(entryFor(record,userId,'lean_body_mass',Math.round(Number(record.value)*10)/10,visibility));
    if (record.type === 'heart_rate' && Number(record.value)>0) entries.push(entryFor(record,userId,'pulse',Math.round(Number(record.value)),visibility));
    if (record.type === 'blood_pressure') {
      const systolic=record.measurements?.systolic??Number(record.value);const diastolic=record.measurements?.diastolic;
      if(systolic>0)entries.push(entryFor(record,userId,'blood_pressure_systolic',Math.round(systolic),visibility));
      if(typeof diastolic==='number'&&diastolic>0)entries.push(entryFor(record,userId,'blood_pressure_diastolic',Math.round(diastolic),visibility));
    }
    if (record.type !== 'nutrition') continue;
    const nutrition = record.nutrition;
    if (Number(record.value) > 0) entries.push(entryFor(record, userId, 'food', Number(record.value), visibility, nutrition));
    const macroEntries: [keyof NutritionDetails, string][] = [
      ['proteinG', 'protein'], ['fatG', 'fat'], ['carbsG', 'carbs'], ['fiberG', 'fiber'], ['sodiumMg', 'sodium'],
      ['sugarG','sugar'],['saturatedFatG','saturated_fat'],['cholesterolMg','cholesterol'],['potassiumMg','potassium'],['calciumMg','calcium'],['ironMg','iron'],['magnesiumMg','magnesium'],['vitaminCMg','vitamin_c'],['vitaminDMcg','vitamin_d'],['vitaminB12Mcg','vitamin_b12'],
    ];
    for (const [field, metricId] of macroEntries) {
      const value = nutrition?.[field];
      if (typeof value === 'number' && value > 0) entries.push(entryFor(record, userId, metricId, ['sodium','cholesterol','potassium','calcium','magnesium'].includes(metricId)?Math.round(value):Math.round(value*10)/10, visibility));
    }
  }
  return entries;
}

function normalizeStepRecords(records: HealthImportRecord[]) {
  const nonSteps=records.filter((record)=>record.type!=='steps');
  const grouped=new Map<string,HealthImportRecord[]>();
  for(const record of records.filter((item)=>item.type==='steps')){
    const day=dateKey(new Date(record.endTime||record.startTime));const source=(record.origin||'Health Connect').toLowerCase();const key=`${day}|${source}`;
    grouped.set(key,[...(grouped.get(key)??[]),record]);
  }
  const byDay=new Map<string,{origin:string;records:HealthImportRecord[];total:number}[]>();
  for(const [key,items] of grouped){const [day,origin]=key.split('|');const group={origin,records:items,total:items.reduce((sum,item)=>sum+Number(item.value||0),0)};byDay.set(day,[...(byDay.get(day)??[]),group]);}
  const daily:HealthImportRecord[]=[];
  for(const [day,sources] of byDay){
    const priority=(source:string)=>source.includes('samsung')||source.includes('shealth')?0:source.includes('healthconnect.phone')||source.includes('com.google.android.apps.healthdata')?9:2;
    const chosen=[...sources].sort((a,b)=>priority(a.origin)-priority(b.origin)||b.total-a.total)[0];if(!chosen||chosen.total<=0)continue;
    const ordered=[...chosen.records].sort((a,b)=>a.startTime.localeCompare(b.startTime));const first=ordered[0];daily.push({...first,id:`daily:${day}:${chosen.origin}`,value:Math.round(chosen.total),startTime:first.startTime,endTime:ordered.reduce((latest,item)=>item.endTime>latest?item.endTime:latest,first.endTime)});
  }
  return [...nonSteps,...daily];
}

export function mergeHealthEntries(
  state: AppState,
  entries: MetricEntry[],
  provider: HealthProvider,
  metricIds: string[],
  fromDate: string,
) {
  const targetMetrics = new Set(metricIds);
  const byId = new Map(
    state.entries
      .filter((entry) => !(
        entry.userId === state.currentUserId &&
        entry.sourceProvider === provider &&
        targetMetrics.has(entry.metricId) &&
        entry.localDate >= fromDate
      ))
      .map((entry) => [entry.id, entry]),
  );
  entries.forEach((entry) => byId.set(entry.id, entry));
  return [...byId.values()];
}

export function friendlyHealthOrigin(origin: string) {
  const normalized = origin.toLowerCase();
  if (normalized.includes('myfitnesspal')) return 'MyFitnessPal';
  if (normalized.includes('shealth') || normalized.includes('samsung')) return 'Samsung Health';
  if (normalized.includes('google') && normalized.includes('fitness')) return 'Google Fit';
  if (normalized.includes('apple')) return 'Apple Health';
  return origin;
}
