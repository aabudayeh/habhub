import { dateKey } from '@/src/domain/date';
import { HealthImportRecord } from '@/src/health/types';
import { AppState, HealthDataType, HealthProvider, MetricEntry, NutritionDetails, Visibility } from '@/src/types';

const METRICS_BY_DATA_TYPE: Record<HealthDataType, string[]> = {
  steps: ['steps'],
  active_energy: ['exercise'],
  weight: ['weight'],
  nutrition: ['food', 'protein', 'fat', 'carbs', 'fiber', 'sodium'],
  water: ['water'],
  workouts: ['workout'],
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
    note: origin ? `Synced from ${friendlyHealthOrigin(origin)}` : undefined,
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
  for (const record of records) {
    if (record.type === 'steps' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'steps', Number(record.value), visibility));
    if (record.type === 'active_energy' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'exercise', Number(record.value), visibility));
    if (record.type === 'weight' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'weight', Number(record.value), visibility));
    if (record.type === 'water' && Number(record.value) > 0) entries.push(entryFor(record, userId, 'water', Number(record.value), visibility));
    if (record.type === 'workouts' && Boolean(record.value)) entries.push(entryFor(record, userId, 'workout', true, visibility));
    if (record.type !== 'nutrition') continue;
    const nutrition = record.nutrition;
    if (Number(record.value) > 0) entries.push(entryFor(record, userId, 'food', Number(record.value), visibility, nutrition));
    const macroEntries: [keyof NutritionDetails, string][] = [
      ['proteinG', 'protein'], ['fatG', 'fat'], ['carbsG', 'carbs'], ['fiberG', 'fiber'], ['sodiumMg', 'sodium'],
    ];
    for (const [field, metricId] of macroEntries) {
      const value = nutrition?.[field];
      if (typeof value === 'number' && value > 0) entries.push(entryFor(record, userId, metricId, value, visibility));
    }
  }
  return entries;
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

