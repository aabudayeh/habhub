import { dateKey } from '@/src/domain/date';
import {
  deduplicateHealthImportRecords,
  healthRecordsAreEquivalent,
  healthSourceEnabled,
  healthSourceId,
  healthSourcePriority,
} from '@/src/domain/healthDedup';
import { metricEntryKey } from '@/src/domain/metricEntry';
import { HealthImportRecord } from '@/src/health/types';
import { AppState, EnergyProfile, HealthDataType, HealthMetricField, HealthMetricMapping, HealthProvider, HealthSourcePreference, MetricDefinition, MetricEntry, NutritionDetails, Visibility } from '@/src/types';

const METRICS_BY_DATA_TYPE: Record<HealthDataType, string[]> = {
  steps: ['steps'],
  active_energy: ['exercise'],
  weight: ['weight'],
  nutrition: ['food', 'protein', 'fat', 'carbs', 'fiber', 'sodium','sugar','saturated_fat','cholesterol','potassium','calcium','iron','magnesium','vitamin_c','vitamin_d','vitamin_b12'],
  water: ['water'],
  workouts: ['workout','workout_duration','workout_calories','workout_distance'],
  body_fat: ['body_fat'],
  lean_body_mass: ['lean_body_mass'],
  body_water_mass: ['body_water_mass'],
  bone_mass: ['bone_mass'],
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
  if(metrics)return metrics.filter((metric)=>
    (metric.healthMapping&&dataTypes.includes(metric.healthMapping.dataType)) ||
    metric.submetrics?.some((field)=>field.healthMapping&&dataTypes.includes(field.healthMapping.dataType))
  ).map((metric)=>metric.id);
  return [...new Set(dataTypes.flatMap((type) => METRICS_BY_DATA_TYPE[type]??[]))];
}

const NUTRITION_FIELDS:Partial<Record<HealthMetricField,keyof NutritionDetails>>={protein:'proteinG',fat:'fatG',carbs:'carbsG',fiber:'fiberG',sodium:'sodiumMg',sugar:'sugarG',saturated_fat:'saturatedFatG',cholesterol:'cholesterolMg',potassium:'potassiumMg',calcium:'calciumMg',iron:'ironMg',magnesium:'magnesiumMg',vitamin_c:'vitaminCMg',vitamin_d:'vitaminDMcg',vitamin_b12:'vitaminB12Mcg'};
function mappedValue(record:HealthImportRecord,metric:MetricDefinition){const field=metric.healthMapping?.field;if(!field)return undefined;if(field==='value')return metric.dataType==='boolean'?Number(record.value)>0:Number(record.value);if(field==='duration_minutes'){const minutes=record.measurements?.durationMinutes;if(minutes===undefined)return undefined;return metric.unit.toLowerCase().startsWith('hr')?minutes/60:minutes;}if(field==='active_calories')return record.measurements?.activeCalories;if(field==='distance_km')return record.measurements?.distanceKm;if(field==='systolic')return record.measurements?.systolic;if(field==='diastolic')return record.measurements?.diastolic;const nutritionField=NUTRITION_FIELDS[field];const value=nutritionField?record.nutrition?.[nutritionField]:undefined;return typeof value==='number'?value:undefined;}

function healthMappingMatchesRecord(
  mapping: HealthMetricMapping | undefined,
  record: HealthImportRecord,
) {
  if (!mapping || mapping.dataType !== record.type) return false;
  if (
    mapping.activityKeys?.length &&
    (!record.activityKey || !mapping.activityKeys.includes(record.activityKey))
  )
    return false;
  if (record.type !== "workouts") return true;
  const recordKind = record.workoutRecordKind ?? "session";
  if (mapping.workoutRecordKind && mapping.workoutRecordKind !== recordKind)
    return false;
  // A legacy/unfiltered workout mapping means the overall session. Movement
  // segments only populate trackers that explicitly opt into segment data.
  return recordKind !== "segment" || mapping.workoutRecordKind === "segment";
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
    localDate:
      record.localDate ?? dateKey(new Date(record.endTime || record.startTime)),
    recordedAt: record.endTime || record.startTime,
    visibility,
    source: 'imported',
    // The primary label describes the item (for example Walking or Banana).
    // Provider provenance stays in the note/subtext instead of replacing it.
    label: record.label,
    note: [record.note,origin ? `Synced from ${friendlyHealthOrigin(origin)}` : undefined].filter(Boolean).join(' · ') || undefined,
    nutrition,
    sourceProvider: record.provider,
    sourceRecordId: record.id,
    sourceOrigin: origin,
    sourceUpdatedAt: record.updatedAt,
  };
}

export type HealthImportVisibility =
  | Visibility
  | Readonly<Record<string, Visibility>>;

function importedMetricVisibility(
  visibility: HealthImportVisibility,
  metricId: string,
) {
  return typeof visibility === "string"
    ? visibility
    : (visibility[metricId] ?? "group");
}

export function healthVisibilityByMetric(metrics: readonly MetricDefinition[]) {
  return Object.fromEntries(
    metrics.map((metric) => [metric.id, metric.defaultVisibility]),
  ) as Record<string, Visibility>;
}

export function mapHealthRecordsToEntries(
  records: HealthImportRecord[],
  userId: string,
  visibility: HealthImportVisibility = 'group',
  metrics?:MetricDefinition[],
  profileOrWeight: StepActivityProfile | number = 70,
  sourcePreferences?: Record<string, HealthSourcePreference>,
) {
  const entries: MetricEntry[] = [];
  const entryById = new Map<string, MetricEntry>();
  const directByType = new Map<HealthDataType, MetricDefinition[]>();
  const compoundByType = new Map<HealthDataType, MetricDefinition[]>();
  for (const metric of metrics ?? []) {
    if (metric.healthMapping) {
      const direct = directByType.get(metric.healthMapping.dataType);
      if (direct) direct.push(metric);
      else directByType.set(metric.healthMapping.dataType, [metric]);
    }
    for (const type of new Set(
      (metric.submetrics ?? []).flatMap((field) =>
        field.healthMapping ? [field.healthMapping.dataType] : [],
      ),
    )) {
      const compounds = compoundByType.get(type);
      if (compounds) compounds.push(metric);
      else compoundByType.set(type, [metric]);
    }
  }
  for (const record of deduplicateHealthImportRecords(records, sourcePreferences)) {
    if(metrics){
      for(const metric of (directByType.get(record.type) ?? []).filter((item)=>healthMappingMatchesRecord(item.healthMapping,record))){
        const value=mappedValue(record,metric);if(value===undefined||value===false||Number(value)<=0)continue;
        const entry=entryFor(record,userId,metric.id,value,importedMetricVisibility(visibility,metric.id),record.nutrition);
        entries.push(entry);entryById.set(entry.id,entry);
      }
      for(const metric of (compoundByType.get(record.type) ?? []).filter((item)=>
        item.submetrics?.some((field)=>healthMappingMatchesRecord(field.healthMapping,record))
      )){
        const submetricValues=Object.fromEntries(
          (metric.submetrics??[]).flatMap((field)=>{
            if(!healthMappingMatchesRecord(field.healthMapping,record))return [];
            const value=mappedValue(record,{
              ...metric,
              dataType:"number",
              unit:field.unit,
              healthMapping:field.healthMapping,
            });
            return typeof value==="number"&&Number.isFinite(value)&&value>0
              ? [[field.id,value]]
              : [];
          }),
        );
        if(!Object.keys(submetricValues).length)continue;
        const id=importedId(record,metric.id);
        const existing=entryById.get(id);
        if(existing){
          existing.submetricValues={
            ...(existing.submetricValues??{}),
            ...submetricValues,
          };
          continue;
        }
        const primary=
          (metric.submetrics??[]).find((field)=>field.showProgressBar&&submetricValues[field.id]!==undefined) ??
          (metric.submetrics??[]).find((field)=>!field.linkedMetricId&&submetricValues[field.id]!==undefined);
        if(!primary)continue;
        const entry=entryFor(
          record,
          userId,
          metric.id,
          submetricValues[primary.id],
          importedMetricVisibility(visibility,metric.id),
          record.nutrition,
        );
        entry.submetricValues=submetricValues;
        entries.push(entry);entryById.set(entry.id,entry);
      }
      continue;
    }
    if (record.type === 'steps' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'steps', Number(record.value), importedMetricVisibility(visibility,'steps')));
    if (record.type === 'active_energy' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'exercise', Number(record.value), importedMetricVisibility(visibility,'exercise')));
    if (record.type === 'weight' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'weight', Number(record.value), importedMetricVisibility(visibility,'weight')));
    if (record.type === 'water' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'water', Number(record.value), importedMetricVisibility(visibility,'water')));
    if (record.type === 'workouts' && record.workoutRecordKind !== 'segment' && Number(record.value)>0) {
      entries.push(entryFor(record, userId, 'workout', true, importedMetricVisibility(visibility,'workout')));
      entries.push(entryFor(record, userId, 'workout_duration', Math.round((record.measurements?.durationMinutes??Number(record.value))*10)/10, importedMetricVisibility(visibility,'workout_duration')));
      if((record.measurements?.activeCalories??0)>0)entries.push(entryFor(record,userId,'workout_calories',Math.round(record.measurements!.activeCalories!),importedMetricVisibility(visibility,'workout_calories')));
      if((record.measurements?.distanceKm??0)>0)entries.push(entryFor(record,userId,'workout_distance',Math.round(record.measurements!.distanceKm!*100)/100,importedMetricVisibility(visibility,'workout_distance')));
    }
    if (record.type === 'body_fat' && Number(record.value)>0) entries.push(entryFor(record,userId,'body_fat',Math.round(Number(record.value)*10)/10,importedMetricVisibility(visibility,'body_fat')));
    if (record.type === 'lean_body_mass' && Number(record.value)>0) entries.push(entryFor(record,userId,'lean_body_mass',Math.round(Number(record.value)*10)/10,importedMetricVisibility(visibility,'lean_body_mass')));
    if (record.type === 'body_water_mass' && Number(record.value)>0) entries.push(entryFor(record,userId,'body_water_mass',Math.round(Number(record.value)*10)/10,importedMetricVisibility(visibility,'body_water_mass')));
    if (record.type === 'bone_mass' && Number(record.value)>0) entries.push(entryFor(record,userId,'bone_mass',Math.round(Number(record.value)*10)/10,importedMetricVisibility(visibility,'bone_mass')));
    if (record.type === 'heart_rate' && Number(record.value)>0) entries.push(entryFor(record,userId,'pulse',Math.round(Number(record.value)),importedMetricVisibility(visibility,'pulse')));
    if (record.type === 'blood_pressure') {
      const systolic=record.measurements?.systolic??Number(record.value);const diastolic=record.measurements?.diastolic;
      if(systolic>0)entries.push(entryFor(record,userId,'blood_pressure_systolic',Math.round(systolic),importedMetricVisibility(visibility,'blood_pressure_systolic')));
      if(typeof diastolic==='number'&&diastolic>0)entries.push(entryFor(record,userId,'blood_pressure_diastolic',Math.round(diastolic),importedMetricVisibility(visibility,'blood_pressure_diastolic')));
    }
    if (record.type !== 'nutrition') continue;
    const nutrition = record.nutrition;
    if (Number(record.value) > 0) entries.push(entryFor(record, userId, 'food', Number(record.value), importedMetricVisibility(visibility,'food'), nutrition));
    const macroEntries: [keyof NutritionDetails, string][] = [
      ['proteinG', 'protein'], ['fatG', 'fat'], ['carbsG', 'carbs'], ['fiberG', 'fiber'], ['sodiumMg', 'sodium'],
      ['sugarG','sugar'],['saturatedFatG','saturated_fat'],['cholesterolMg','cholesterol'],['potassiumMg','potassium'],['calciumMg','calcium'],['ironMg','iron'],['magnesiumMg','magnesium'],['vitaminCMg','vitamin_c'],['vitaminDMcg','vitamin_d'],['vitaminB12Mcg','vitamin_b12'],
    ];
    for (const [field, metricId] of macroEntries) {
      const value = nutrition?.[field];
      if (typeof value === 'number' && value > 0) entries.push(entryFor(record, userId, metricId, ['sodium','cholesterol','potassium','calcium','magnesium'].includes(metricId)?Math.round(value):Math.round(value*10)/10, importedMetricVisibility(visibility,metricId)));
    }
  }
  return appendStepFallbackEntries(entries,userId,visibility,metrics,profileOrWeight);
}

export type UnrecordedStepActivity = {
  coveredSteps: number;
  uncoveredSteps: number;
  distanceKm: number;
  durationMinutes: number;
  estimatedCalories: number;
  knownWorkoutCalories: number;
};

export type StepActivityProfile = Pick<
  EnergyProfile,
  "age" | "sex" | "heightCm" | "weightKg"
>;

const DEFAULT_WALKING_SPEED_MPS = 1.34;
const LEGACY_STEP_LENGTH_M = 0.762;
const LEGACY_WALKING_KCAL_PER_KG_KM = 0.53;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stepProfile(profileOrWeight: StepActivityProfile | number) {
  return typeof profileOrWeight === "number"
    ? {
        age: 35,
        sex: "unspecified" as const,
        heightCm: 0,
        weightKg: profileOrWeight,
      }
    : profileOrWeight;
}

/**
 * Estimate ordinary level walking represented by an otherwise-unexplained
 * step count.
 *
 * Distance uses Lee et al.'s healthy-adult step-length regression when a
 * usable profile is available. Net walking oxygen cost then follows Ludlow et
 * al.'s height-weight-speed model. We intentionally assume one conservative
 * habitual speed because a daily aggregate step record contains no cadence;
 * measured workout distance/duration always takes precedence elsewhere.
 *
 * Sources:
 * https://doi.org/10.1080/1091367X.2026.2634091
 * https://doi.org/10.1152/japplphysiol.00864.2015
 */
export function estimateLevelWalkingFromSteps(
  steps: number,
  profileOrWeight: StepActivityProfile | number,
) {
  const profile = stepProfile(profileOrWeight);
  const safeSteps = Math.max(0, steps);
  const weightKg = clamp(Number(profile.weightKg) || 70, 35, 300);
  const heightCm = Number(profile.heightCm) || 0;
  const age = clamp(Number(profile.age) || 35, 18, 90);
  const hasProfileHeight = heightCm >= 130 && heightCm <= 220;
  const speedMps = DEFAULT_WALKING_SPEED_MPS;

  // Regression inputs are centimetres, kilograms and centimetres/second.
  // The published sex coefficient is negligible (0.02 cm) but retained.
  // The published model encodes male = 0 and female = 1. Unspecified keeps
  // the neutral baseline; the coefficient is only 0.02 cm either way.
  const sexTerm = profile.sex === "female" ? 1 : 0;
  const predictedStepLengthM = hasProfileHeight
    ? (-16.14 -
        0.06 * age +
        0.31 * heightCm -
        0.04 * weightKg +
        0.02 * sexTerm +
        0.3 * (speedMps * 100)) /
      100
    : LEGACY_STEP_LENGTH_M;
  const stepLengthM = hasProfileHeight
    ? clamp(predictedStepLengthM, 0.4, 1.05)
    : LEGACY_STEP_LENGTH_M;
  const distanceKm = (safeSteps * stepLengthM) / 1000;
  const durationMinutes = distanceKm
    ? (distanceKm * 1000) / speedMps / 60
    : 0;

  const estimatedCalories = hasProfileHeight
    ? // Walking-only oxygen cost in ml O2/kg/min; resting metabolism is
      // excluded because this value feeds the app's active-energy tracker.
      ((3.85 + (5.97 * speedMps ** 2) / (heightCm / 100)) *
        weightKg *
        durationMinutes *
        5) /
      1000
    : distanceKm * LEGACY_WALKING_KCAL_PER_KG_KM * weightKg;

  return {
    steps: safeSteps,
    stepLengthM,
    speedMps,
    distanceKm,
    durationMinutes,
    estimatedCalories,
  };
}

const MOVEMENT_WORKOUT = /(walk|run|hike|treadmill)/i;
const RUNNING_WORKOUT = /(run|treadmill)/i;

/**
 * Estimate the walking that remains after Health Connect workout sessions have
 * explained their share of the daily step total.
 *
 * A session may be represented by duration, distance, calories, or the boolean
 * Workout tracker. Matching every workout-mapped entry is important because a
 * user can hide/remove the boolean tracker while retaining the other fields.
 */
export function unrecordedStepActivity(
  dayEntries: MetricEntry[],
  metrics: MetricDefinition[],
  steps: number,
  profileOrWeight: StepActivityProfile | number,
): UnrecordedStepActivity {
  const walkingEstimate = estimateLevelWalkingFromSteps(
    steps,
    profileOrWeight,
  );
  const workoutMetricIds = new Set(
    metrics
      .filter((metric) => metric.healthMapping?.dataType === "workouts")
      .map((metric) => metric.id),
  );
  const distanceIds = new Set(
    metrics
      .filter(
        (metric) =>
          metric.healthMapping?.dataType === "workouts" &&
          metric.healthMapping.field === "distance_km",
      )
      .map((metric) => metric.id),
  );
  const durationIds = new Set(
    metrics
      .filter(
        (metric) =>
          metric.healthMapping?.dataType === "workouts" &&
          metric.healthMapping.field === "duration_minutes",
      )
      .map((metric) => metric.id),
  );
  const calorieIds = new Set(
    metrics
      .filter(
        (metric) =>
          metric.healthMapping?.dataType === "workouts" &&
          metric.healthMapping.field === "active_calories",
      )
      .map((metric) => metric.id),
  );
  const sessions = dayEntries.filter(
    (entry) =>
      workoutMetricIds.has(entry.metricId) &&
      Boolean(entry.sourceRecordId) &&
      MOVEMENT_WORKOUT.test(entry.label ?? ""),
  );
  const sessionKeys = new Map<
    string,
    { sourceProvider: MetricEntry["sourceProvider"]; sourceRecordId: string }
  >();
  for (const session of sessions) {
    const sourceRecordId = session.sourceRecordId!;
    sessionKeys.set(`${session.sourceProvider ?? "health"}\u0000${sourceRecordId}`, {
      sourceProvider: session.sourceProvider,
      sourceRecordId,
    });
  }
  const sameSession = (
    entry: MetricEntry,
    source: { sourceProvider: MetricEntry["sourceProvider"]; sourceRecordId: string },
  ) =>
    entry.sourceRecordId === source.sourceRecordId &&
    entry.sourceProvider === source.sourceProvider;
  let coveredSteps = 0;
  for (const source of sessionKeys.values()) {
    const matching = dayEntries.filter((entry) => sameSession(entry, source));
    const label =
      matching.find((entry) => MOVEMENT_WORKOUT.test(entry.label ?? ""))?.label ??
      "";
    const running = RUNNING_WORKOUT.test(label);
    const distanceKm = Math.max(
      0,
      ...matching
        .filter((entry) => distanceIds.has(entry.metricId))
        .map((entry) => Number(entry.value || 0)),
    );
    const durationMinutes = Math.max(
      0,
      ...matching
        .filter((entry) => durationIds.has(entry.metricId))
        .map((entry) => Number(entry.value || 0)),
    );
    const estimatedDistanceKm =
      distanceKm || (durationMinutes / 60) * (running ? 9 : 5);
    coveredSteps +=
      (estimatedDistanceKm * 1000) /
      (running ? 1 : walkingEstimate.stepLengthM);
  }
  // Non-movement workouts still contribute their known calories, but must not
  // subtract steps. Count each native workout once even when custom trackers
  // map the same calorie field.
  const knownCaloriesBySource = new Map<string, number>();
  for (const entry of dayEntries.filter((item) => calorieIds.has(item.metricId))) {
    const key = entry.sourceRecordId
      ? `${entry.sourceProvider ?? "health"}\u0000${entry.sourceRecordId}`
      : entry.id;
    knownCaloriesBySource.set(
      key,
      Math.max(knownCaloriesBySource.get(key) ?? 0, Number(entry.value || 0)),
    );
  }
  const knownWorkoutCalories = [...knownCaloriesBySource.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const uncoveredSteps = Math.max(0, steps - coveredSteps);
  const uncovered = estimateLevelWalkingFromSteps(
    uncoveredSteps,
    profileOrWeight,
  );
  return {
    coveredSteps,
    uncoveredSteps,
    distanceKm: uncovered.distanceKm,
    durationMinutes: uncovered.durationMinutes,
    estimatedCalories: uncovered.estimatedCalories,
    knownWorkoutCalories,
  };
}

function appendStepFallbackEntries(entries:MetricEntry[],userId:string,visibility:HealthImportVisibility,metrics:MetricDefinition[]|undefined,profileOrWeight:StepActivityProfile|number){
  if(!metrics)return entries;
  const stepIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='steps'&&metric.healthMapping.field==='value').map((metric)=>metric.id);
  const fallback=metrics.filter((metric)=>metric.stepFallback);
  if(!stepIds.length||!fallback.length)return entries;
  const stepIdSet=new Set(stepIds);
  const entriesByDay=new Map<string,MetricEntry[]>();
  for(const entry of entries){const dayEntries=entriesByDay.get(entry.localDate);if(dayEntries)dayEntries.push(entry);else entriesByDay.set(entry.localDate,[entry]);}
  const days=[...entriesByDay].filter(([,dayEntries])=>dayEntries.some((entry)=>stepIdSet.has(entry.metricId))).map(([day])=>day);
  const derived:MetricEntry[]=[];
  for(const day of days){
    const dayEntries=entriesByDay.get(day)??[];
    const steps=Math.max(0,...dayEntries.filter((entry)=>stepIdSet.has(entry.metricId)).map((entry)=>Number(entry.value||0)));
    if(steps<=0)continue;
    const estimate=unrecordedStepActivity(dayEntries,metrics,steps,profileOrWeight);
    const stepEntry=dayEntries.find((entry)=>stepIdSet.has(entry.metricId))!;
    const make=(metricId:string,value:number,suffix:string):MetricEntry=>({id:`health:${stepEntry.sourceProvider??'health_connect'}:step-fallback:${day}:${metricId}:${suffix}`,metricId,userId,value:Math.round(value*10)/10,localDate:day,recordedAt:stepEntry.recordedAt,visibility:importedMetricVisibility(visibility,metricId),source:'calculated',label:'Estimated unrecorded walking from steps',note:`Uses ${Math.round(estimate.uncoveredSteps).toLocaleString()} steps not already explained by walking or running workouts.`,sourceProvider:stepEntry.sourceProvider,sourceRecordId:`step-fallback:${day}`,sourceOrigin:stepEntry.sourceOrigin});
    for(const metric of fallback){
      const mapping=metric.healthMapping;
      if(mapping?.dataType==='active_energy'&&mapping.field==='value'){
        const existing=dayEntries.filter((entry)=>entry.metricId===metric.id).reduce((sum,entry)=>sum+Number(entry.value||0),0);
        const calories=(existing>0?0:estimate.knownWorkoutCalories)+estimate.estimatedCalories;
        if(calories>0)derived.push(make(metric.id,calories,'calories'));
      } else if(mapping?.dataType==='workouts'&&mapping.field==='distance_km'&&estimate.uncoveredSteps>0) {
        derived.push(make(metric.id,estimate.distanceKm,'distance'));
      } else if(mapping?.dataType==='workouts'&&mapping.field==='duration_minutes'&&estimate.uncoveredSteps>0) {
        derived.push(make(metric.id,estimate.durationMinutes,'duration'));
      }
    }
  }
  return [...entries,...derived];
}

function metricHealthType(metric: MetricDefinition | undefined) {
  return (
    metric?.healthMapping?.dataType ??
    metric?.submetrics?.find((field) => field.healthMapping)?.healthMapping
      ?.dataType
  );
}

function entryAsHealthRecord(
  entry: MetricEntry,
  type: HealthDataType,
): HealthImportRecord {
  const origin = entry.sourceOrigin ?? entry.sourceProvider ?? "Health system";
  return {
    id: entry.id,
    provider: entry.sourceProvider ?? "health_connect",
    type,
    startTime: entry.recordedAt,
    endTime: entry.recordedAt,
    value:
      typeof entry.value === "string"
        ? Number(entry.value) || 0
        : entry.value,
    unit: "",
    origin,
    label: entry.label,
    nutrition: entry.nutrition,
    updatedAt: entry.sourceUpdatedAt,
    measurements:
      type === "blood_pressure"
        ? {
            systolic: entry.submetricValues?.systolic,
            diastolic: entry.submetricValues?.diastolic,
          }
        : undefined,
  };
}

function legacyIntervalMirror(
  left: MetricEntry,
  right: MetricEntry,
  type: HealthDataType,
) {
  if (!["active_energy", "workouts", "sleep"].includes(type)) return false;
  if (left.localDate !== right.localDate) return false;
  const leftSource = healthSourceId(left.sourceOrigin);
  const rightSource = healthSourceId(right.sourceOrigin);
  if (leftSource === rightSource) return false;
  const systemSource = (source: string) =>
    source === "health-connect-device" ||
    source === "apple-health" ||
    source === "health-system";
  if (!systemSource(leftSource) && !systemSource(rightSource)) return false;
  const timeGap = Math.abs(
    new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
  );
  if (!Number.isFinite(timeGap) || timeGap > 2 * 60 * 60 * 1000) return false;
  const a = Number(left.value || 0);
  const b = Number(right.value || 0);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    Math.abs(a - b) > Math.max(2, Math.max(Math.abs(a), Math.abs(b)) * 0.08)
  )
    return false;
  const clean = (value: string | undefined) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const leftLabel = clean(left.label);
  const rightLabel = clean(right.label);
  // A missing label is not enough evidence to merge two real workouts. Sleep
  // and unlabeled daily energy may safely use the strong system-source/value
  // match; workouts require a matching activity description.
  if (type === "workouts" && (!leftLabel || !rightLabel)) return false;
  return (
    !leftLabel ||
    !rightLabel ||
    leftLabel === rightLabel ||
    leftLabel.includes(rightLabel) ||
    rightLabel.includes(leftLabel)
  );
}

/**
 * Removes legacy mirrored rows and disabled sources without touching manual
 * data. Callers can pass a refreshed slice so normal imports stay bounded.
 */
export function reconcileImportedHealthEntries(
  entries: MetricEntry[],
  metrics: MetricDefinition[],
  sourcePreferences?: Record<string, HealthSourcePreference>,
  ownerUserId?: string,
) {
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
  const untouched: MetricEntry[] = [];
  const groups = new Map<string, MetricEntry[]>();
  for (const entry of entries) {
    const healthType = metricHealthType(metricById.get(entry.metricId));
    const healthOwned = Boolean(
      entry.sourceProvider &&
        healthType &&
        (!ownerUserId || entry.userId === ownerUserId),
    );
    if (!healthOwned) {
      untouched.push(entry);
      continue;
    }
    if (!healthSourceEnabled(entry.sourceOrigin, sourcePreferences)) continue;
    const key = `${entry.userId}\u0000${entry.metricId}\u0000${entry.localDate}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const reconciled: MetricEntry[] = [];
  for (const group of groups.values()) {
    const healthType = metricHealthType(metricById.get(group[0].metricId));
    if (!healthType) {
      reconciled.push(...group);
      continue;
    }
    if (healthType === "steps") {
      const bySource = new Map<string, MetricEntry[]>();
      for (const entry of group) {
        const source = healthSourceId(entry.sourceOrigin);
        const items = bySource.get(source);
        if (items) items.push(entry);
        else bySource.set(source, [entry]);
      }
      const sourceTotals = [...bySource.values()].map((items) => {
        const hasDailyAggregate = items.some(
          (entry) =>
            entry.sourceRecordId?.startsWith("daily:") ||
            entry.id.includes(":daily:"),
        );
        const total = hasDailyAggregate
          ? Math.max(...items.map((entry) => Number(entry.value || 0)))
          : items.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
        const template = [...items].sort((a, b) =>
          b.recordedAt.localeCompare(a.recordedAt),
        )[0];
        return { template, total };
      });
      sourceTotals.sort(
        (a, b) =>
          healthSourcePriority(a.template.sourceOrigin, "steps") -
            healthSourcePriority(b.template.sourceOrigin, "steps") ||
          b.total - a.total,
      );
      const selected = sourceTotals[0];
      if (selected?.total > 0)
        reconciled.push({
          ...selected.template,
          value: Math.round(selected.total),
        });
      continue;
    }

    const sorted = [...group].sort(
      (a, b) =>
        healthSourcePriority(a.sourceOrigin, healthType) -
          healthSourcePriority(b.sourceOrigin, healthType) ||
        b.recordedAt.localeCompare(a.recordedAt),
    );
    const keep: MetricEntry[] = [];
    for (const entry of sorted) {
      const record = entryAsHealthRecord(entry, healthType);
      if (
        !keep.some((candidate) =>
          healthRecordsAreEquivalent(
            entryAsHealthRecord(candidate, healthType),
            record,
          ) || legacyIntervalMirror(candidate, entry, healthType),
        )
      )
        keep.push(entry);
    }
    reconciled.push(...keep);
  }
  return [...untouched, ...reconciled];
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
      .map((entry) => [
        metricEntryKey(entry.userId, entry.id),
        entry,
      ]),
  );
  entries.forEach((entry) =>
    byId.set(metricEntryKey(entry.userId, entry.id), entry),
  );
  return [...byId.values()];
}

export function friendlyHealthOrigin(origin: string) {
  const normalized = origin.toLowerCase();
  if (
    normalized.includes('healthconnect.phone') ||
    normalized.includes('com.google.android.apps.healthdata') ||
    normalized === 'health connect'
  ) return 'Your phone';
  if (normalized.includes('myfitnesspal')) return 'MyFitnessPal';
  if (normalized.includes('shealth') || normalized.includes('samsung')) return 'Samsung Health';
  if (normalized.includes('google') && normalized.includes('fitness')) return 'Google Fit';
  if (normalized.includes('apple')) return 'Apple Health';
  return origin;
}
