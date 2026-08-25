import { dateKey } from '@/src/domain/date';
import {
  deduplicateHealthImportRecords,
  displayedImportedStepCandidate,
  hasHealthImportIdentity,
  healthRecordsAreEquivalent,
  healthSourceEnabled,
  healthSourceId,
  healthSourcePriority,
} from '@/src/domain/healthDedup';
import { metricEntryKey } from '@/src/domain/metricEntry';
import { FOOD_NUTRIENTS } from '@/src/domain/food';
import {
  catalogExercise,
  exerciseFromActivityName,
} from '@/src/domain/exerciseCatalog';
import { HealthImportRecord } from '@/src/health/types';
import { AppState, EnergyProfile, HealthDataType, HealthMetricField, HealthMetricMapping, HealthProvider, HealthSourcePreference, MetricDefinition, MetricEntry, NutritionDetails, Visibility } from '@/src/types';
import {
  workoutActivityFamily,
  workoutQualifies,
} from './workoutQualification';

const METRICS_BY_DATA_TYPE: Record<HealthDataType, string[]> = {
  steps: ['steps'],
  active_energy: ['exercise'],
  total_energy: ['energy_burned'],
  weight: ['weight'],
  nutrition: ['food', ...FOOD_NUTRIENTS.map((nutrient) => nutrient.id)],
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

const NUTRITION_FIELDS: Partial<
  Record<HealthMetricField, keyof NutritionDetails>
> = Object.fromEntries(
  FOOD_NUTRIENTS.map((nutrient) => [nutrient.id, nutrient.nutritionKey]),
);
function mappedValue(record:HealthImportRecord,metric:MetricDefinition){const field=metric.healthMapping?.field;if(!field)return undefined;if(field==='value'){if(record.type==='workouts')return metric.dataType==='boolean'?true:1;return metric.dataType==='boolean'?Number(record.value)>0:Number(record.value);}if(field==='duration_minutes'){const minutes=record.measurements?.durationMinutes;if(minutes===undefined)return undefined;return metric.unit.toLowerCase().startsWith('hr')?minutes/60:minutes;}if(field==='active_calories')return record.measurements?.activeCalories;if(field==='distance_km')return record.measurements?.distanceKm;if(field==='systolic')return record.measurements?.systolic;if(field==='diastolic')return record.measurements?.diastolic;const nutritionField=NUTRITION_FIELDS[field];const value=nutritionField?record.nutrition?.[nutritionField]:undefined;return typeof value==='number'?value:undefined;}

function workoutCompletionQualifies(record: HealthImportRecord, metric: MetricDefinition) {
  if (
    record.type !== 'workouts' ||
    metric.healthMapping?.dataType !== 'workouts' ||
    metric.healthMapping.field !== 'value'
  ) return true;
  return workoutQualifies(
    {
      activityKey: record.activityKey,
      durationMinutes: record.measurements?.durationMinutes ?? Number(record.value),
      distanceKm: record.measurements?.distanceKm,
      activeCalories: record.measurements?.activeCalories,
    },
    metric.workoutQualification,
  );
}

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

function nutritionSidecarEntry(
  record: HealthImportRecord,
  userId: string,
  metricId: string,
  value: number | boolean,
  visibility: Visibility,
): MetricEntry {
  const full = entryFor(record, userId, metricId, value, visibility);
  const {
    label: _mealLabel,
    note: _mealNote,
    nutrition: _fullNutrition,
    ...sidecar
  } = full;
  return {
    ...sidecar,
    // A linked nutrient entry may be shared as tracker data, but it must not
    // carry a private meal name, note, or the full nutrition object with it.
    // sourceProvider/sourceRecordId/sourceOrigin retain dedup provenance.
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

function importedNutritionSidecarVisibility(
  visibility: HealthImportVisibility,
  metricId: string,
) {
  if (typeof visibility === "string") return visibility;
  // A canonical Food setting governs its linked values. If Food was removed,
  // respect the nutrient tracker itself and otherwise fail closed.
  return visibility.food ?? visibility[metricId] ?? "private";
}

export function healthVisibilityByMetric(metrics: readonly MetricDefinition[]) {
  return Object.fromEntries(
    metrics.map((metric) => [metric.id, metric.defaultVisibility]),
  ) as Record<string, Visibility>;
}

/**
 * Retain persisted rows only for health categories that the current native
 * read did not authoritatively refresh. This lets a cheap Steps-only read use
 * already-imported workout coverage without allowing a deleted native workout
 * to survive as stale calculation context during a full workout read.
 */
export function healthFallbackContextForRead(
  existingEntries: readonly MetricEntry[],
  metrics: readonly MetricDefinition[],
  authoritativeDataTypes: readonly HealthDataType[],
) {
  const authoritative = new Set(authoritativeDataTypes);
  if (!authoritative.size) return existingEntries;
  const mappingsByMetric = new Map(
    metrics.map((metric) => [
      metric.id,
      new Set([
        ...(metric.healthMapping ? [metric.healthMapping.dataType] : []),
        ...(metric.submetrics ?? []).flatMap((field) =>
          field.healthMapping ? [field.healthMapping.dataType] : [],
        ),
      ]),
    ]),
  );
  return existingEntries.filter((entry) => {
    if (entry.source !== "imported") return true;
    const mappedTypes = mappingsByMetric.get(entry.metricId);
    return !mappedTypes || ![...mappedTypes].some((type) => authoritative.has(type));
  });
}

export type WorkoutActiveEnergyEstimate = {
  calories: number;
  estimated: boolean;
  basis: string;
};

function recordTime(record: HealthImportRecord, edge: 'start' | 'end') {
  const value = edge === 'start' ? record.startTime : record.endTime;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isFitbitEnergyOrigin(origin: unknown) {
  return /(?:^|[.\s])fitbit(?:mobile)?(?:$|[.\s])/i.test(
    String(origin ?? '').trim(),
  );
}

/**
 * Fitbit can mirror its running total-energy/BMR stream through Health
 * Connect as small ActiveCaloriesBurned increments. A real workout-scoped row
 * has activity/session provenance by the time it reaches this mapper; an
 * unlabelled Fitbit increment belongs only in Total energy burned.
 */
export function isFitbitRestingEnergyRecord(record: HealthImportRecord) {
  if (record.type !== 'active_energy' || !isFitbitEnergyOrigin(record.origin))
    return false;
  const genericLabel = (record.label ?? '').trim();
  return !record.activityKey &&
    (!genericLabel || /^(active (calories|energy)( total)?|calories burned)$/i.test(genericLabel));
}

export function isFitbitRestingEnergyEntry(entry: MetricEntry) {
  if (!isFitbitEnergyOrigin(entry.sourceOrigin)) return false;
  const label = (entry.label ?? '').trim();
  return !label || /^(active (calories|energy)( total)?|calories burned)$/i.test(label);
}

function healthEnergyRecordCoversWorkout(
  energy: HealthImportRecord,
  workout: HealthImportRecord,
) {
  if (energy.provider !== workout.provider) return false;
  const energyStart = recordTime(energy, 'start');
  const energyEnd = recordTime(energy, 'end');
  const workoutStart = recordTime(workout, 'start');
  const workoutEnd = recordTime(workout, 'end');
  if (
    energyStart === undefined ||
    energyEnd === undefined ||
    workoutStart === undefined ||
    workoutEnd === undefined ||
    energyEnd <= workoutStart ||
    energyStart >= workoutEnd
  )
    return false;
  const energyActivity = energy.activityKey?.trim();
  const workoutActivity = workout.activityKey?.trim();
  if (energyActivity && workoutActivity && energyActivity !== workoutActivity)
    return false;
  const energyDuration = Math.max(1, energyEnd - energyStart);
  const workoutDuration = Math.max(1, workoutEnd - workoutStart);
  if (
    !energyActivity &&
    (energyDuration >= 20 * 60 * 60 * 1000 ||
      energyDuration > Math.max(2 * 60 * 60 * 1000, workoutDuration * 3))
  )
    return false;
  const energyOrigin = energy.origin
    ? friendlyHealthOrigin(energy.origin).trim().toLocaleLowerCase()
    : '';
  const workoutOrigin = workout.origin
    ? friendlyHealthOrigin(workout.origin).trim().toLocaleLowerCase()
    : '';
  if (energyOrigin && workoutOrigin && energyOrigin === workoutOrigin)
    return true;
  // Health Connect can expose records from several writers under one provider.
  // Cross-writer overlap alone is not ownership. Require the same explicit
  // activity plus an interval that substantially belongs to this workout.
  if (!energyActivity || !workoutActivity || energyActivity !== workoutActivity)
    return false;
  const overlap = Math.max(
    0,
    Math.min(energyEnd, workoutEnd) - Math.max(energyStart, workoutStart),
  );
  return overlap / energyDuration >= 0.8;
}

/**
 * Return a workout's own net active energy.
 *
 * Provider calories are kept verbatim. When they are absent, movement
 * sessions prefer measured distance and all other workouts use the catalog's
 * whole-session MET with 1 MET removed because resting energy is represented
 * separately by BMR.
 */
export function workoutActiveEnergy(
  record: HealthImportRecord,
  profileOrWeight: StepActivityProfile | number,
): WorkoutActiveEnergyEstimate {
  const measured = Number(record.measurements?.activeCalories ?? 0);
  if (Number.isFinite(measured) && measured > 0)
    return {
      calories: measured,
      estimated: false,
      basis: 'provider calorie measurement',
    };

  const profile = stepProfile(profileOrWeight);
  const weightKg = clamp(Number(profile.weightKg) || 70, 35, 300);
  const catalog =
    catalogExercise(record.activityKey) ??
    exerciseFromActivityName(record.label);
  const activityKey = record.activityKey ?? catalog?.key;
  const family = workoutActivityFamily(activityKey);
  const distanceKm = Math.max(
    0,
    Number(record.measurements?.distanceKm ?? 0) || 0,
  );
  if (distanceKm > 0 && (family === 'walking' || family === 'running'))
    return {
      calories:
        distanceKm *
        weightKg *
        (family === 'running' ? 1 : LEGACY_WALKING_KCAL_PER_KG_KM),
      estimated: true,
      basis: `${Math.round(distanceKm * 100) / 100} km distance`,
    };

  const explicitDuration = Number(record.measurements?.durationMinutes ?? 0);
  const intervalMinutes = Math.max(
    0,
    ((recordTime(record, 'end') ?? 0) -
      (recordTime(record, 'start') ?? 0)) /
      60000,
  );
  const durationMinutes = Math.max(
    0,
    Number.isFinite(explicitDuration) && explicitDuration > 0
      ? explicitDuration
      : intervalMinutes || Number(record.value) || 0,
  );
  if (durationMinutes <= 0)
    return { calories: 0, estimated: true, basis: 'workout duration' };
  const fallbackMet =
    family === 'walking'
      ? 3.5
      : family === 'running'
        ? 8.3
        : family === 'strength'
          ? 5
          : 4.5;
  const met = Math.max(1, Number(catalog?.met ?? fallbackMet) || fallbackMet);
  return {
    calories: ((met - 1) * 3.5 * weightKg * durationMinutes) / 200,
    estimated: true,
    basis: `${Math.round(durationMinutes * 10) / 10} min duration`,
  };
}

export function mapHealthRecordsToEntries(
  records: HealthImportRecord[],
  userId: string,
  visibility: HealthImportVisibility = 'group',
  metrics?:MetricDefinition[],
  profileOrWeight: StepActivityProfile | number = 70,
  sourcePreferences?: Record<string, HealthSourcePreference>,
  existingEntries: readonly MetricEntry[] = [],
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
  const deduplicatedRecords = deduplicateHealthImportRecords(
    records,
    sourcePreferences,
  ).filter((record) => !isFitbitRestingEnergyRecord(record));
  const activeEnergyRecords = deduplicatedRecords.filter(
    (record) => record.type === 'active_energy' && Number(record.value) > 0,
  );
  const activeEnergyMetric = metrics?.find(
    (metric) =>
      metric.id === 'exercise' &&
      metric.healthMapping?.dataType === 'active_energy' &&
      metric.healthMapping.field === 'value',
  );
  for (const record of deduplicatedRecords) {
    if(metrics){
      for(const metric of (directByType.get(record.type) ?? []).filter((item)=>healthMappingMatchesRecord(item.healthMapping,record)&&workoutCompletionQualifies(record,item))){
        const value=mappedValue(record,metric);if(value===undefined||value===false||Number(value)<=0)continue;
        const entry =
          record.type === 'nutrition' && metric.id !== 'food'
            ? nutritionSidecarEntry(
                record,
                userId,
                metric.id,
                value,
                importedNutritionSidecarVisibility(visibility, metric.id),
              )
            : entryFor(
                record,
                userId,
                metric.id,
                value,
                importedMetricVisibility(visibility, metric.id),
                record.nutrition,
              );
        if (
          record.type === 'active_energy' &&
          !record.activityKey &&
          (((recordTime(record, 'end') ?? 0) -
            (recordTime(record, 'start') ?? 0) >=
            20 * 60 * 60 * 1000) ||
            (record.provider === 'google_health' &&
              /(?:^|:)daily(?::|$)/i.test(record.id)))
        )
          entry.label ||= 'Active energy total';
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
        const entry =
          record.type === 'nutrition' && metric.id !== 'food'
            ? nutritionSidecarEntry(
                record,
                userId,
                metric.id,
                submetricValues[primary.id],
                importedNutritionSidecarVisibility(visibility, metric.id),
              )
            : entryFor(
                record,
                userId,
                metric.id,
                submetricValues[primary.id],
                importedMetricVisibility(visibility, metric.id),
                record.nutrition,
              );
        entry.submetricValues=submetricValues;
        entries.push(entry);entryById.set(entry.id,entry);
      }
      // ExerciseSession calories belong to that session, just like its
      // duration and distance. Health Connect and HealthKit sometimes expose
      // no matching ActiveCaloriesBurned interval, even though the session has
      // a calorie measurement or enough duration/distance to estimate it. In
      // that case retain one stable Active energy row per workout instead of
      // folding every workout into the unrelated uncovered-Steps estimate.
      if (
        activeEnergyMetric &&
        record.type === 'workouts' &&
        record.workoutRecordKind !== 'segment' &&
        !activeEnergyRecords.some((activeRecord) =>
          healthEnergyRecordCoversWorkout(activeRecord, record),
        )
      ) {
        const workoutEnergy = workoutActiveEnergy(record, profileOrWeight);
        if (workoutEnergy.calories > 0) {
          const entry = entryFor(
            record,
            userId,
            activeEnergyMetric.id,
            Math.round(workoutEnergy.calories * 10) / 10,
            importedMetricVisibility(visibility, activeEnergyMetric.id),
          );
          entry.id = `${entry.id}:workout-energy`;
          if (workoutEnergy.estimated) {
            entry.source = 'calculated';
            entry.note = [
              record.note,
              `Estimated from this workout's ${workoutEnergy.basis}; its provider did not supply active calories.`,
              record.origin?.trim()
                ? `Synced from ${friendlyHealthOrigin(record.origin.trim())}`
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ');
          }
          entries.push(entry);
          entryById.set(entry.id, entry);
        }
      }
      // Nutrition is compound data. Even when a user has not added every
      // linked nutrient tracker yet, retain a privacy-safe sidecar for every
      // positive field that the provider actually supplied. A later explicit
      // deep-link/add can then show the complete history instead of starting
      // from the day the tracker definition was created.
      if (record.type !== 'nutrition') continue;
    }
    if (record.type === 'steps' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'steps', Number(record.value), importedMetricVisibility(visibility,'steps')));
    if (record.type === 'active_energy' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'exercise', Number(record.value), importedMetricVisibility(visibility,'exercise')));
    if (record.type === 'total_energy' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'energy_burned', Number(record.value), importedMetricVisibility(visibility,'energy_burned')));
    if (record.type === 'weight' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'weight', Number(record.value), importedMetricVisibility(visibility,'weight')));
    if (record.type === 'water' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'water', Number(record.value), importedMetricVisibility(visibility,'water')));
    if (record.type === 'workouts' && record.workoutRecordKind !== 'segment' && Number(record.value)>0) {
      if (workoutQualifies({activityKey:record.activityKey,durationMinutes:record.measurements?.durationMinutes??Number(record.value),distanceKm:record.measurements?.distanceKm,activeCalories:record.measurements?.activeCalories})) entries.push(entryFor(record, userId, 'workout', true, importedMetricVisibility(visibility,'workout')));
      entries.push(entryFor(record, userId, 'workout_duration', Math.round((record.measurements?.durationMinutes??Number(record.value))*10)/10, importedMetricVisibility(visibility,'workout_duration')));
      if((record.measurements?.activeCalories??0)>0&&!entryById.has(importedId(record,'workout_calories')))entries.push(entryFor(record,userId,'workout_calories',Math.round(record.measurements!.activeCalories!),importedMetricVisibility(visibility,'workout_calories')));
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
    const pushNutritionEntry = (
      metricId: string,
      value: number,
      details?: NutritionDetails,
    ) => {
      const id = importedId(record, metricId);
      // When configured metrics are supplied, the generic import loop above
      // has already emitted matching nutrition trackers. Keep this fallback
      // for legacy/unconfigured callers without returning duplicate IDs.
      if (entryById.has(id)) return;
      const entry =
        metricId === 'food'
          ? entryFor(
              record,
              userId,
              metricId,
              value,
              importedNutritionSidecarVisibility(visibility, metricId),
              details,
            )
          : nutritionSidecarEntry(
              record,
              userId,
              metricId,
              value,
              importedNutritionSidecarVisibility(visibility, metricId),
            );
      entries.push(entry);
      entryById.set(id, entry);
    };
    if (Number(record.value) > 0)
      pushNutritionEntry('food', Number(record.value), nutrition);
    for (const nutrientDefinition of FOOD_NUTRIENTS) {
      const field = nutrientDefinition.nutritionKey;
      const metricId = nutrientDefinition.id;
      const value = nutrition?.[field];
      if (typeof value === 'number' && value > 0)
        pushNutritionEntry(metricId, value);
    }
  }
  return appendStepFallbackEntries(
    entries,
    userId,
    visibility,
    metrics,
    profileOrWeight,
    existingEntries,
  );
}

export type UnrecordedStepActivity = {
  coveredSteps: number;
  uncoveredSteps: number;
  distanceKm: number;
  durationMinutes: number;
  estimatedCalories: number;
  estimatedWorkoutCalories: number;
  knownWorkoutCalories: number;
};

/**
 * Workout calories that still need to be added to an Active energy tracker.
 *
 * A manual/app workout row is an independent contribution, so it must not
 * suppress a calorie estimate for a different synced walking/running session.
 * Conversely, an imported ActiveCaloriesBurned stream normally already
 * contains the provider's workout calories. In that case adding a second
 * workout-derived value would count the same activity twice.
 */
export function supplementalWorkoutCaloriesForActiveEnergy(
  dayEntries: readonly MetricEntry[],
  metrics: readonly MetricDefinition[],
  activeEnergyMetricId: string,
  estimate: Pick<
    UnrecordedStepActivity,
    "estimatedWorkoutCalories" | "knownWorkoutCalories"
  >,
) {
  const activeEnergyMetric = metrics.find(
    (metric) => metric.id === activeEnergyMetricId,
  );
  const hasImportedActiveEnergy = dayEntries.some(
    (entry) =>
      entry.metricId === activeEnergyMetricId &&
      !isCalculatedStepFallback(entry) &&
      !isFitbitRestingEnergyEntry(entry) &&
      entry.source === "imported" &&
      activeEnergyMetric?.healthMapping?.dataType === "active_energy" &&
      activeEnergyMetric.healthMapping.field === "value" &&
      Number(entry.value || 0) > 0,
  );
  if (hasImportedActiveEnergy) return 0;

  const activeMetricAlreadyStoresWorkoutCalories =
    activeEnergyMetric?.healthMapping?.dataType === "workouts" &&
    activeEnergyMetric.healthMapping.field === "active_calories";
  return (
    estimate.estimatedWorkoutCalories +
    (activeMetricAlreadyStoresWorkoutCalories
      ? 0
      : estimate.knownWorkoutCalories)
  );
}

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

export function isCalculatedStepFallback(entry: MetricEntry) {
  return (
    entry.source === "calculated" &&
    (entry.sourceRecordId?.startsWith("step-fallback:") ||
      entry.label === "Estimated unrecorded walking from steps")
  );
}

/** A calorie row derived directly from one native workout session. */
export function isWorkoutEnergyEntry(entry: MetricEntry) {
  return entry.id.endsWith(':workout-energy');
}

export function isDailyActiveEnergyAggregateEntry(entry: MetricEntry) {
  const label = (entry.label ?? '').trim().toLocaleLowerCase();
  const generic = /^(active (calories|energy)( total)?|calories burned)$/.test(
    label,
  );
  return (
    generic &&
    (label.endsWith('total') ||
      (entry.sourceProvider === 'google_health' &&
        /(?:^|:)daily(?::|$)/i.test(entry.sourceRecordId ?? entry.id)))
  );
}

/**
 * Ignore a stale workout fallback once a provider's canonical active-energy
 * stream is present. This keeps both totals and detail breakdowns aligned
 * after a source starts reporting calories on a later sync.
 */
export function activeEnergyEntriesWithoutCoveredWorkoutFallbacks(
  entries: readonly MetricEntry[],
) {
  const eligibleEntries = entries.filter(
    (entry) => !isFitbitRestingEnergyEntry(entry),
  );
  const workoutFallbacks = eligibleEntries.filter(isWorkoutEnergyEntry);
  const providerRows = eligibleEntries.filter(
    (entry) =>
      entry.source === 'imported' &&
      !isWorkoutEnergyEntry(entry) &&
      Number(entry.value || 0) > 0,
  );
  if (!workoutFallbacks.length || !providerRows.length) return eligibleEntries;

  const normalizedLabel = (entry: MetricEntry) => {
    const label = (entry.label ?? '').trim().toLocaleLowerCase();
    return /^(active (calories|energy)( total)?|calories burned)$/.test(label)
      ? ''
      : label;
  };
  const timestamp = (entry: MetricEntry) => {
    const value = new Date(entry.recordedAt).getTime();
    return Number.isFinite(value) ? value : undefined;
  };
  const normalizedOrigin = (entry: MetricEntry) =>
    entry.sourceOrigin
      ? friendlyHealthOrigin(entry.sourceOrigin).trim().toLocaleLowerCase()
      : '';
  const compatibleOrigin = (left: MetricEntry, right: MetricEntry) => {
    const leftOrigin = normalizedOrigin(left);
    const rightOrigin = normalizedOrigin(right);
    return leftOrigin === rightOrigin;
  };
  const covered = new Set<string>();
  // Match one provider row to at most one old fallback. A direct row for one
  // run must never erase unrelated walking, cycling, swimming, or gym rows
  // from the same day.
  for (const providerRow of providerRows) {
    const providerTime = timestamp(providerRow);
    const providerLabel = normalizedLabel(providerRow);
    const candidate = workoutFallbacks
      .filter((fallback) => !covered.has(fallback.id))
      .flatMap((fallback) => {
        if (fallback.sourceProvider !== providerRow.sourceProvider) return [];
        if (!compatibleOrigin(fallback, providerRow)) return [];
        const fallbackId = fallback.sourceRecordId ?? '';
        const providerId = providerRow.sourceRecordId ?? '';
        const relatedId =
          Boolean(fallbackId && providerId) &&
          (providerId === `workout-energy:${fallbackId}` ||
            fallbackId === `workout-energy:${providerId}`);
        const fallbackTime = timestamp(fallback);
        const timeDifference =
          providerTime === undefined || fallbackTime === undefined
            ? Number.POSITIVE_INFINITY
            : Math.abs(providerTime - fallbackTime);
        const fallbackLabel = normalizedLabel(fallback);
        const sameLabel =
          Boolean(providerLabel && fallbackLabel) &&
          providerLabel === fallbackLabel;
        const closeUnlabelledInterval =
          !providerLabel && timeDifference <= 60_000;
        if (!relatedId && !(sameLabel && timeDifference <= 15 * 60_000) && !closeUnlabelledInterval)
          return [];
        return [{ fallback, score: relatedId ? -1 : timeDifference }];
      })
      .sort((left, right) => left.score - right.score)[0]?.fallback;
    if (candidate) covered.add(candidate.id);
  }
  return eligibleEntries.filter((entry) => !covered.has(entry.id));
}

/**
 * Numeric Active energy reconciliation. A provider's daily aggregate and its
 * visible per-session components are alternate views of the same burn, so use
 * the larger representation for that provider. Manual/app rows and providers
 * without a day total remain additive.
 */
export function reconciledActiveEnergyValue(
  entries: readonly MetricEntry[],
) {
  const canonical = activeEnergyEntriesWithoutCoveredWorkoutFallbacks(entries);
  const totals = canonical.filter(isDailyActiveEnergyAggregateEntry);
  if (!totals.length)
    return canonical.reduce((sum, entry) => sum + Number(entry.value || 0), 0);

  const byProvider = new Map<
    string,
    { aggregate: number; components: number }
  >();
  let independent = 0;
  const providerKey = (entry: MetricEntry) => entry.sourceProvider ?? '';
  for (const total of totals) {
    const key = providerKey(total);
    if (!key) {
      independent += Number(total.value || 0);
      continue;
    }
    const bucket = byProvider.get(key) ?? { aggregate: 0, components: 0 };
    bucket.aggregate = Math.max(bucket.aggregate, Number(total.value || 0));
    byProvider.set(key, bucket);
  }
  for (const entry of canonical) {
    if (isDailyActiveEnergyAggregateEntry(entry)) continue;
    const key = providerKey(entry);
    const bucket = key ? byProvider.get(key) : undefined;
    if (!bucket) independent += Number(entry.value || 0);
    else bucket.components += Number(entry.value || 0);
  }
  return (
    independent +
    [...byProvider.values()].reduce(
      (sum, bucket) => sum + Math.max(bucket.aggregate, bucket.components),
      0,
    )
  );
}

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
  const activeEnergyIds = new Set(
    metrics
      .filter(
        (metric) =>
          metric.healthMapping?.dataType === "active_energy" &&
          metric.healthMapping.field === "value",
      )
      .map((metric) => metric.id),
  );
  const sessions = dayEntries.filter(
    (entry) =>
      workoutMetricIds.has(entry.metricId) &&
      Boolean(entry.sourceRecordId) &&
      !isCalculatedStepFallback(entry) &&
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
  let estimatedWorkoutCalories = 0;
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

    // A provider can expose a walking/running session with duration and
    // distance but omit ActiveCaloriesBurned (this is common when a workout
    // was forwarded by another app). In that case the session still needs to
    // contribute to Active energy and therefore Total energy burned. Prefer a
    // measured workout-calorie mapping whenever one exists for this native
    // session; otherwise estimate only this session from its measured
    // distance. The final metric composition below uses this estimate only
    // when no day-level ActiveCaloriesBurned rows exist, so an overlapping
    // provider total can never be counted twice.
    const hasMeasuredSessionCalories = matching.some(
      (entry) =>
        (calorieIds.has(entry.metricId) ||
          activeEnergyIds.has(entry.metricId)) &&
        Number(entry.value || 0) > 0,
    );
    if (!hasMeasuredSessionCalories && estimatedDistanceKm > 0) {
      const weightKg = clamp(
        Number(stepProfile(profileOrWeight).weightKg) || 70,
        35,
        300,
      );
      estimatedWorkoutCalories +=
        estimatedDistanceKm * weightKg *
        (running ? 1 : LEGACY_WALKING_KCAL_PER_KG_KM);
    }
  }
  // Non-movement workouts still contribute their known calories, but must not
  // subtract steps. Count each native workout once even when custom trackers
  // map the same calorie field.
  const knownCaloriesBySource = new Map<string, number>();
  for (const entry of dayEntries.filter(
    (item) => calorieIds.has(item.metricId) && !isCalculatedStepFallback(item),
  )) {
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
    estimatedWorkoutCalories,
    knownWorkoutCalories,
  };
}

function appendStepFallbackEntries(entries:MetricEntry[],userId:string,visibility:HealthImportVisibility,metrics:MetricDefinition[]|undefined,profileOrWeight:StepActivityProfile|number,existingEntries:readonly MetricEntry[]=[]){
  if(!metrics)return entries;
  const stepIds=metrics.filter((metric)=>metric.healthMapping?.dataType==='steps'&&metric.healthMapping.field==='value').map((metric)=>metric.id);
  const fallback=metrics.filter((metric)=>metric.stepFallback);
  if(!stepIds.length||!fallback.length)return entries;
  const stepIdSet=new Set(stepIds);
  const entriesByDay=new Map<string,MetricEntry[]>();
  for(const entry of entries){const dayEntries=entriesByDay.get(entry.localDate);if(dayEntries)dayEntries.push(entry);else entriesByDay.set(entry.localDate,[entry]);}
  const existingByDay=new Map<string,MetricEntry[]>();
  for(const entry of existingEntries){
    if(entry.userId!==userId||!entriesByDay.has(entry.localDate)||isCalculatedStepFallback(entry))continue;
    const dayEntries=existingByDay.get(entry.localDate);
    if(dayEntries)dayEntries.push(entry);else existingByDay.set(entry.localDate,[entry]);
  }
  const days=[...entriesByDay].filter(([,dayEntries])=>dayEntries.some((entry)=>stepIdSet.has(entry.metricId))).map(([day])=>day);
  const derived:MetricEntry[]=[];
  for(const day of days){
    const importedDayEntries=entriesByDay.get(day)??[];
    // A fast current-day Steps refresh intentionally reads no workout records.
    // Reuse the persisted same-day workout measurements as calculation
    // context, while allowing newly read rows to replace matching identities.
    // Context rows are never returned or re-imported by this mapper.
    const contextualById=new Map(
      (existingByDay.get(day)??[]).map((entry)=>[entry.id,entry]),
    );
    for(const entry of importedDayEntries)contextualById.set(entry.id,entry);
    const dayEntries=[...contextualById.values()];
    const steps=Math.max(0,...importedDayEntries.filter((entry)=>stepIdSet.has(entry.metricId)).map((entry)=>Number(entry.value||0)));
    if(steps<=0)continue;
    const estimate=unrecordedStepActivity(dayEntries,metrics,steps,profileOrWeight);
    const stepEntry=importedDayEntries.find((entry)=>stepIdSet.has(entry.metricId))!;
    const make=(metricId:string,value:number,suffix:string):MetricEntry=>({id:`health:${stepEntry.sourceProvider??'health_connect'}:step-fallback:${day}:${metricId}:${suffix}`,metricId,userId,value:Math.round(value*10)/10,localDate:day,recordedAt:stepEntry.recordedAt,visibility:importedMetricVisibility(visibility,metricId),source:'calculated',label:'Estimated unrecorded walking from steps',note:`Uses ${Math.round(estimate.uncoveredSteps).toLocaleString()} steps not already explained by walking or running workouts.`,sourceProvider:stepEntry.sourceProvider,sourceRecordId:`step-fallback:${day}`,sourceOrigin:stepEntry.sourceOrigin});
    for(const metric of fallback){
      const mapping=metric.healthMapping;
      if(mapping?.dataType==='active_energy'&&mapping.field==='value'){
        if(estimate.estimatedCalories>0)derived.push(make(metric.id,estimate.estimatedCalories,'calories'));
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

function nativeGoogleOwnershipPriority(entry: MetricEntry) {
  return entry.sourceProvider === "google_health" ? 1 : 0;
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
  if (!["active_energy", "total_energy", "workouts", "sleep"].includes(type))
    return false;
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
      healthType &&
        entry.source !== "manual" &&
        hasHealthImportIdentity(entry) &&
        (!ownerUserId || entry.userId === ownerUserId),
    );
    if (!healthOwned) {
      untouched.push(entry);
      continue;
    }
    // Steps use Health Connect's unfiltered, priority-aware aggregate. Source
    // preferences are shared across record types, so disabling (for example)
    // a nutrition writer must never discard that platform Steps total.
    if (
      healthType !== "steps" &&
      !healthSourceEnabled(entry.sourceOrigin, sourcePreferences)
    )
      continue;
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
      const selected = displayedImportedStepCandidate(group);
      if (selected && selected.total > 0)
        reconciled.push({
          ...selected.template,
          value: selected.total,
        });
      continue;
    }

    const sorted = [...group].sort(
      (a, b) =>
        nativeGoogleOwnershipPriority(a) - nativeGoogleOwnershipPriority(b) ||
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

/**
 * Makes Health Connect/HealthKit authoritative over a mirrored Google Health
 * row regardless of which source arrived first. Only provider-coexistence
 * metric/day buckets are inspected; conservative semantic matching keeps
 * genuinely separate meals, workouts, and measurements.
 */
export function reconcileGoogleHealthNativeMirrors(
  entries: MetricEntry[],
  metrics: MetricDefinition[],
  sourcePreferences?: Record<string, HealthSourcePreference>,
  ownerUserId?: string,
) {
  const providersByKey = new Map<
    string,
    { google: boolean; native: boolean }
  >();
  const bucketKey = (entry: MetricEntry) =>
    `${entry.userId}\u0000${entry.metricId}\u0000${entry.localDate}`;
  for (const entry of entries) {
    if (ownerUserId && entry.userId !== ownerUserId) continue;
    const google = entry.sourceProvider === "google_health";
    const native =
      entry.sourceProvider === "health_connect" ||
      entry.sourceProvider === "apple_health";
    if (!google && !native) continue;
    const key = bucketKey(entry);
    const providers = providersByKey.get(key) ?? {
      google: false,
      native: false,
    };
    providers.google ||= google;
    providers.native ||= native;
    providersByKey.set(key, providers);
  }
  const coexistenceKeys = new Set(
    [...providersByKey]
      .filter(([, providers]) => providers.google && providers.native)
      .map(([key]) => key),
  );
  if (!coexistenceKeys.size) return entries;

  const affected = entries.filter((entry) =>
    coexistenceKeys.has(bucketKey(entry)),
  );
  const affectedSet = new Set(affected);
  const reconciled = reconcileImportedHealthEntries(
    affected,
    metrics,
    sourcePreferences,
    ownerUserId,
  );
  if (
    reconciled.length === affected.length &&
    reconciled.every((entry) => affectedSet.has(entry))
  )
    return entries;
  return [
    ...entries.filter((entry) => !affectedSet.has(entry)),
    ...reconciled,
  ];
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
