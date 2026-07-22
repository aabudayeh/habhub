import { dateKey } from '@/src/domain/date';
import { HealthImportRecord } from '@/src/health/types';
import { AppState, HealthDataType, HealthMetricField, HealthProvider, MetricDefinition, MetricEntry, NutritionDetails, Visibility } from '@/src/types';

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
  sleep:['sleep'],
  blood_glucose:['blood_glucose'],
  menstruation:['menstrual_cycle'],
};

export function enabledHealthDataTypes(dataTypes: Record<HealthDataType, boolean>) {
  return (Object.keys(dataTypes) as HealthDataType[]).filter((type) => dataTypes[type]);
}

export function metricIdsForHealthDataTypes(dataTypes: HealthDataType[],metrics?:MetricDefinition[]) {
  if(metrics)return metrics.filter((metric)=>metric.healthMapping&&dataTypes.includes(metric.healthMapping.dataType)).map((metric)=>metric.id);
  return [...new Set(dataTypes.flatMap((type) => METRICS_BY_DATA_TYPE[type]??[]))];
}

const NUTRITION_FIELDS:Partial<Record<HealthMetricField,keyof NutritionDetails>>={protein:'proteinG',fat:'fatG',carbs:'carbsG',fiber:'fiberG',sodium:'sodiumMg',sugar:'sugarG',saturated_fat:'saturatedFatG',cholesterol:'cholesterolMg',potassium:'potassiumMg',calcium:'calciumMg',iron:'ironMg',magnesium:'magnesiumMg',vitamin_c:'vitaminCMg',vitamin_d:'vitaminDMcg',vitamin_b12:'vitaminB12Mcg'};
function mappedValue(record:HealthImportRecord,metric:MetricDefinition){const field=metric.healthMapping?.field;if(!field)return undefined;if(field==='value')return metric.dataType==='boolean'?Number(record.value)>0:Number(record.value);if(field==='duration_minutes'){const minutes=record.measurements?.durationMinutes;if(minutes===undefined)return undefined;return metric.unit.toLowerCase().startsWith('hr')?minutes/60:minutes;}if(field==='active_calories')return record.measurements?.activeCalories;if(field==='distance_km')return record.measurements?.distanceKm;if(field==='systolic')return record.measurements?.systolic;if(field==='diastolic')return record.measurements?.diastolic;const nutritionField=NUTRITION_FIELDS[field];const value=nutritionField?record.nutrition?.[nutritionField]:undefined;return typeof value==='number'?value:undefined;}

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
  metrics?:MetricDefinition[],
  weightKg=70,
) {
  const entries: MetricEntry[] = [];
  for (const record of normalizeStepRecords(records)) {
    if(metrics){
      for(const metric of metrics.filter((item)=>item.healthMapping?.dataType===record.type)){
        const value=mappedValue(record,metric);if(value===undefined||value===false||Number(value)<=0)continue;
        entries.push(entryFor(record,userId,metric.id,value,visibility,record.nutrition));
      }
      continue;
    }
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
  return appendStepFallbackEntries(entries,userId,visibility,metrics,weightKg);
}

function appendStepFallbackEntries(entries:MetricEntry[],userId:string,visibility:Visibility,metrics:MetricDefinition[]|undefined,weightKg:number){
  if(!metrics)return entries;
  const stepIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='steps'&&metric.healthMapping.field==='value').map((metric)=>metric.id);
  const fallback=metrics.filter((metric)=>metric.stepFallback);
  if(!stepIds.length||!fallback.length)return entries;
  const workoutTypeIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='workouts'&&metric.healthMapping.field==='value').map((metric)=>metric.id);
  const distanceIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='workouts'&&metric.healthMapping.field==='distance_km').map((metric)=>metric.id);
  const durationIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='workouts'&&metric.healthMapping.field==='duration_minutes').map((metric)=>metric.id);
  const calorieIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='workouts'&&metric.healthMapping.field==='active_calories').map((metric)=>metric.id);
  const days=[...new Set(entries.filter((entry)=>stepIds.includes(entry.metricId)).map((entry)=>entry.localDate))];
  const derived:MetricEntry[]=[];
  for(const day of days){
    const dayEntries=entries.filter((entry)=>entry.localDate===day);
    const steps=Math.max(0,...dayEntries.filter((entry)=>stepIds.includes(entry.metricId)).map((entry)=>Number(entry.value||0)));
    if(steps<=0)continue;
    const walkingSessions=dayEntries.filter((entry)=>workoutTypeIds.includes(entry.metricId)&&/(walk|run|hike|treadmill)/i.test(entry.label??''));
    const sourceIds=new Set(walkingSessions.map((entry)=>entry.sourceRecordId).filter(Boolean));
    let coveredSteps=0;
    for(const sourceId of sourceIds){
      const label=walkingSessions.find((entry)=>entry.sourceRecordId===sourceId)?.label??'';const running=/(run|treadmill)/i.test(label);
      const distance=Math.max(0,...dayEntries.filter((entry)=>entry.sourceRecordId===sourceId&&distanceIds.includes(entry.metricId)).map((entry)=>Number(entry.value||0)));
      const duration=Math.max(0,...dayEntries.filter((entry)=>entry.sourceRecordId===sourceId&&durationIds.includes(entry.metricId)).map((entry)=>Number(entry.value||0)));
      const estimatedDistance=distance>0?distance:duration/60*(running?9:5);
      coveredSteps+=estimatedDistance*(running?1000:1312);
    }
    const uncoveredSteps=Math.max(0,steps-coveredSteps);const distanceKm=uncoveredSteps*.000762;const durationMinutes=distanceKm/5*60;const estimatedCalories=distanceKm*.53*Math.max(35,weightKg);
    const knownWorkoutCalories=dayEntries.filter((entry)=>calorieIds.includes(entry.metricId)).reduce((sum,entry)=>sum+Number(entry.value||0),0);
    const stepEntry=dayEntries.find((entry)=>stepIds.includes(entry.metricId))!;
    const make=(metricId:string,value:number,suffix:string):MetricEntry=>({id:`health:${stepEntry.sourceProvider??'health_connect'}:step-fallback:${day}:${metricId}:${suffix}`,metricId,userId,value:Math.round(value*10)/10,localDate:day,recordedAt:stepEntry.recordedAt,visibility,source:'calculated',label:'Estimated unrecorded walking from steps',note:`Uses ${Math.round(uncoveredSteps).toLocaleString()} steps not already explained by walking or running workouts.`,sourceProvider:stepEntry.sourceProvider,sourceRecordId:`step-fallback:${day}`,sourceOrigin:stepEntry.sourceOrigin});
    for(const metric of fallback){
      const existingActiveCalories=dayEntries.filter((entry)=>entry.metricId===metric.id).reduce((sum,entry)=>sum+Number(entry.value||0),0);
      // Always add calories for steps not represented by walking/running
      // workouts. If Health Connect did not expose active-energy rows, retain
      // known workout calories as the base instead of dropping them.
      const calories=(existingActiveCalories>0?0:knownWorkoutCalories)+estimatedCalories;
      if(calories>0)derived.push(make(metric.id,calories,'calories'));
    }
    if(uncoveredSteps>0){for(const id of distanceIds)derived.push(make(id,distanceKm,'distance'));for(const id of durationIds)derived.push(make(id,durationMinutes,'duration'));}
  }
  return [...entries,...derived];
}

function normalizeStepRecords(records: HealthImportRecord[]) {
  const nonSteps=records.filter((record)=>record.type!=='steps');
  const grouped=new Map<string,HealthImportRecord[]>();
  for(const record of records.filter((item)=>item.type==='steps')){
    const day=dateKey(new Date(record.endTime||record.startTime));const source=(record.origin||'Health Connect').toLowerCase();const key=`${day}|${source}`;
    grouped.set(key,[...(grouped.get(key)??[]),record]);
  }
  const byDay=new Map<string,{origin:string;records:HealthImportRecord[];total:number}[]>();
  for(const [key,items] of grouped){const [day,origin]=key.split('|');const contains=(outer:HealthImportRecord,inner:HealthImportRecord)=>outer!==inner&&outer.startTime<=inner.startTime&&outer.endTime>=inner.endTime;const aggregates=items.filter((item)=>items.filter((other)=>contains(item,other)).length>=2);const atomic=items.filter((item)=>!items.some((other)=>contains(item,other)));const aggregateTotal=Math.max(0,...aggregates.map((item)=>Number(item.value||0)));const intervalTotal=atomic.reduce((sum,item)=>sum+Number(item.value||0),0);const group={origin,records:items,total:Math.max(aggregateTotal,intervalTotal)};byDay.set(day,[...(byDay.get(day)??[]),group]);}
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
