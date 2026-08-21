import {
  DailyMetricStatus,
  GymSession,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

type SizedIndex<T> = {
  size: number;
  values: Map<string, T[]>;
};

type RecordedAtIndex = {
  size: number;
  values: Set<string>;
};

const entryIndexes = new WeakMap<MetricEntry[], SizedIndex<MetricEntry>>();
const statusIndexes = new WeakMap<
  DailyMetricStatus[],
  SizedIndex<DailyMetricStatus>
>();
const gymIndexes = new WeakMap<GymSession[], SizedIndex<GymSession>>();
const photoIndexes = new WeakMap<PhotoUpdate[], SizedIndex<PhotoUpdate>>();
const metricEntryIndexes = new WeakMap<
  MetricEntry[],
  SizedIndex<MetricEntry>
>();
const userDayEntryIndexes = new WeakMap<
  MetricEntry[],
  SizedIndex<MetricEntry>
>();
const recordedAtEntryIndexes = new WeakMap<MetricEntry[], RecordedAtIndex>();
function indexed<T>(
  source: T[],
  cache: WeakMap<T[], SizedIndex<T>>,
  keyFor: (item: T) => string,
) {
  const cached = cache.get(source);
  if (cached?.size === source.length) return cached.values;
  const values = new Map<string, T[]>();
  for (const item of source) {
    const key = keyFor(item);
    const bucket = values.get(key);
    if (bucket) bucket.push(item);
    else values.set(key, [item]);
  }
  cache.set(source, { size: source.length, values });
  return values;
}

const dailyKey = (metricId: string, userId: string, localDate: string) =>
  `${metricId}\u0000${userId}\u0000${localDate}`;

export function entriesForDay(
  entries: MetricEntry[],
  metricId: string,
  userId: string,
  localDate: string,
) {
  return (
    indexed(
      entries,
      entryIndexes,
      (entry) => dailyKey(entry.metricId, entry.userId, entry.localDate),
    ).get(dailyKey(metricId, userId, localDate)) ?? []
  );
}

export function entriesForMetric(
  entries: MetricEntry[],
  metricId: string,
  userId: string,
) {
  const key = `${metricId}\u0000${userId}`;
  return (
    indexed(
      entries,
      metricEntryIndexes,
      (entry) => `${entry.metricId}\u0000${entry.userId}`,
    ).get(key) ?? []
  );
}

export function latestEntryOnOrBefore(
  entries: MetricEntry[],
  metricId: string,
  userId: string,
  localDate: string,
) {
  const candidates = entriesForMetric(entries, metricId, userId);
  let latest: MetricEntry | undefined;
  for (const entry of candidates) {
    if (entry.localDate > localDate) continue;
    if (!latest || entry.recordedAt > latest.recordedAt) latest = entry;
  }
  return latest;
}

export function entriesForUserDay(
  entries: MetricEntry[],
  userId: string,
  localDate: string,
) {
  const key = `${userId}\u0000${localDate}`;
  return (
    indexed(
      entries,
      userDayEntryIndexes,
      (entry) => `${entry.userId}\u0000${entry.localDate}`,
    ).get(key) ?? []
  );
}

export function hasEntryAtRecordedTime(
  entries: MetricEntry[],
  metricId: string,
  userId: string,
  recordedAt: string,
) {
  let index = recordedAtEntryIndexes.get(entries);
  if (!index || index.size !== entries.length) {
    index = {
      size: entries.length,
      values: new Set(
        entries.map(
          (entry) =>
            `${entry.metricId}\u0000${entry.userId}\u0000${entry.recordedAt}`,
        ),
      ),
    };
    recordedAtEntryIndexes.set(entries, index);
  }
  return index.values.has(
    `${metricId}\u0000${userId}\u0000${recordedAt}`,
  );
}

export function statusForDay(
  statuses: DailyMetricStatus[] | undefined,
  groupId: string,
  metricId: string,
  userId: string,
  localDate: string,
) {
  if (!statuses?.length) return undefined;
  return indexed(
    statuses,
    statusIndexes,
    (status) =>
      `${status.groupId}\u0000${dailyKey(
        status.metricId,
        status.userId,
        status.localDate,
      )}`,
  ).get(`${groupId}\u0000${dailyKey(metricId, userId, localDate)}`)?.[0];
}

export function gymSessionsForDay(
  sessions: GymSession[] | undefined,
  userId: string,
  localDate: string,
) {
  if (!sessions?.length) return [];
  return (
    indexed(
      sessions,
      gymIndexes,
      (session) => `${session.userId}\u0000${session.localDate}`,
    ).get(`${userId}\u0000${localDate}`) ?? []
  );
}

export function photosForDay(
  photos: PhotoUpdate[],
  userId: string,
  localDate: string,
) {
  if (!photos.length) return [];
  return (
    indexed(
      photos,
      photoIndexes,
      (photo) => `${photo.userId}\u0000${photo.localDate}`,
    ).get(`${userId}\u0000${localDate}`) ?? []
  );
}
