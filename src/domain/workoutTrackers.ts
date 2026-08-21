import type {
  AppState,
  MetricDefinition,
  TrackedGoalPeriod,
  UserSettings,
} from "../types";

/**
 * Older releases exposed the same workout session twice: once as a general
 * tracker and once as a gym-derived tracker. Keep these aliases at the data
 * boundary so old local/cloud snapshots continue to open without duplicate
 * tiles or split history.
 */
export const WORKOUT_TRACKER_ALIASES = {
  gym_completed: "workout",
  gym_duration: "workout_duration",
} as const;

export function canonicalWorkoutTrackerId(id: string) {
  return WORKOUT_TRACKER_ALIASES[
    id as keyof typeof WORKOUT_TRACKER_ALIASES
  ] ?? id;
}

function canonicalIds(ids: string[] | undefined) {
  if (!ids) return undefined;
  return [...new Set(ids.map(canonicalWorkoutTrackerId))];
}

function mergePeriods(periods: TrackedGoalPeriod[]) {
  const ordered = [
    ...new Map(
      periods.map((period) => [`${period.from}:${period.to ?? ""}`, period]),
    ).values(),
  ].sort((a, b) => a.from.localeCompare(b.from));
  return ordered.reduce<TrackedGoalPeriod[]>((result, period) => {
    const previous = result.at(-1);
    if (!previous) return [{ ...period }];
    if (!previous.to) return result;
    if (period.from > previous.to) return [...result, { ...period }];
    previous.to = !period.to
      ? undefined
      : previous.to > period.to
        ? previous.to
        : period.to;
    return result;
  }, []);
}

function mergeReminders(
  first: MetricDefinition["reminders"],
  second: MetricDefinition["reminders"],
) {
  const reminders = [...(first ?? []), ...(second ?? [])];
  if (!reminders.length) return first ?? second;
  return [
    ...new Map(
      reminders.map((reminder) => [
        `${reminder.time}:${JSON.stringify(reminder.schedule ?? null)}`,
        reminder,
      ]),
    ).values(),
  ];
}

function mergeMetricList(
  metrics: MetricDefinition[],
  defaults: MetricDefinition[],
) {
  const defaultById = new Map(defaults.map((metric) => [metric.id, metric]));
  const grouped = new Map<string, MetricDefinition[]>();
  metrics.forEach((metric) => {
    const id = canonicalWorkoutTrackerId(metric.id);
    grouped.set(id, [...(grouped.get(id) ?? []), metric]);
  });

  return [...grouped.entries()]
    .map(([id, candidates]) => {
      if (!candidates.some((candidate) => candidate.id !== id))
        return candidates[0];
      const canonical = candidates.find((candidate) => candidate.id === id);
      const alias = candidates.find((candidate) => candidate.id !== id)!;
      const fallback = defaultById.get(id);
      const source = canonical ?? alias;
      const sections = candidates.reduce(
        (current, metric) => ({
          today: current.today || metric.sections.today,
          group: current.group || metric.sections.group,
          insights: current.insights || metric.sections.insights,
        }),
        { today: false, group: false, insights: false },
      );
      return {
        ...fallback,
        ...source,
        id,
        // An alias-only snapshot adopts the canonical label while retaining
        // the user's goal, color, visibility and reminder choices.
        name: canonical?.name ?? fallback?.name ?? source.name,
        healthMapping:
          canonical?.healthMapping ?? fallback?.healthMapping ?? alias.healthMapping,
        gymMapping:
          canonical?.gymMapping ?? fallback?.gymMapping ?? alias.gymMapping,
        manualEntry:
          canonical?.manualEntry ?? fallback?.manualEntry ?? alias.manualEntry,
        sections,
        order: Math.min(...candidates.map((candidate) => candidate.order)),
        activeFrom: candidates
          .map((candidate) => candidate.activeFrom)
          .sort()[0],
        reminders: candidates.reduce(
          (current, metric) => mergeReminders(current, metric.reminders),
          undefined as MetricDefinition["reminders"],
        ),
      } satisfies MetricDefinition;
    })
    .sort((a, b) => a.order - b.order)
    .map((metric, order) => ({ ...metric, order }));
}

function canonicalRecord<T>(record: Record<string, T> | undefined) {
  if (!record) return undefined;
  const result: Record<string, T> = {};
  Object.entries(record).forEach(([id, value]) => {
    const canonical = canonicalWorkoutTrackerId(id);
    if (!(canonical in result) || id === canonical) result[canonical] = value;
  });
  return result;
}

function canonicalGroupedIds(record: Record<string, string[]> | undefined) {
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).map(([groupId, ids]) => [
      groupId,
      canonicalIds(ids) ?? [],
    ]),
  );
}

function canonicalSettings(settings: UserSettings): UserSettings {
  return {
    ...settings,
    progressMetricIds: canonicalIds(settings.progressMetricIds) ?? [],
    progressMetricOrderIds: canonicalIds(settings.progressMetricOrderIds),
    progressPinnedMetricIds: canonicalIds(settings.progressPinnedMetricIds),
    performanceMetricIds: canonicalIds(settings.performanceMetricIds),
    performanceMetricOrderIds: canonicalIds(
      settings.performanceMetricOrderIds,
    ),
    performancePinnedMetricIds: canonicalIds(
      settings.performancePinnedMetricIds,
    ),
    leaderboardMetricIdsByGroup:
      canonicalGroupedIds(settings.leaderboardMetricIdsByGroup) ?? {},
    leaderboardPinnedMetricIdsByGroup: canonicalGroupedIds(
      settings.leaderboardPinnedMetricIdsByGroup,
    ),
    leaderboardCardOrderByGroup: canonicalGroupedIds(
      settings.leaderboardCardOrderByGroup,
    ),
    comparisonMetricIdsByGroup:
      canonicalGroupedIds(settings.comparisonMetricIdsByGroup) ?? {},
    todayHistoryByMetric: canonicalRecord(settings.todayHistoryByMetric),
    trackerViewFilters: settings.trackerViewFilters?.map((filter) => ({
      ...filter,
      metricIds: canonicalIds(filter.metricIds) ?? [],
    })),
    scheduleViewFilters: settings.scheduleViewFilters?.map((filter) => ({
      ...filter,
      logMetricIds: canonicalIds(filter.logMetricIds) ?? [],
    })),
    notifications: {
      ...settings.notifications,
      metricIds: canonicalIds(settings.notifications.metricIds) ?? [],
    },
  };
}

function canonicalTrackedPeriods(
  periods: Record<string, TrackedGoalPeriod[]>,
) {
  const grouped = new Map<string, TrackedGoalPeriod[]>();
  Object.entries(periods).forEach(([id, values]) => {
    const canonical = canonicalWorkoutTrackerId(id);
    grouped.set(canonical, [...(grouped.get(canonical) ?? []), ...values]);
  });
  return Object.fromEntries(
    [...grouped.entries()].map(([id, values]) => [id, mergePeriods(values)]),
  );
}

function canonicalStatuses(statuses: AppState["dailyMetricStatuses"]) {
  const result = new Map<string, (typeof statuses)[number]>();
  statuses.forEach((status) => {
    const metricId = canonicalWorkoutTrackerId(status.metricId);
    const key = `${status.groupId}:${metricId}:${status.userId}:${status.localDate}`;
    if (!result.has(key) || status.metricId === metricId)
      result.set(key, { ...status, metricId });
  });
  return [...result.values()];
}

/**
 * Idempotently folds legacy gym summary trackers into Workout and Workout
 * duration. This is deliberately schema-version independent because a stale
 * device can still upload an older snapshot after a newer device has migrated.
 */
export function consolidateWorkoutTrackers(
  state: AppState,
  defaults: AppState,
): AppState {
  const metrics = mergeMetricList(state.metrics, defaults.metrics);
  const groupDefaults = defaults.group.metricConfiguration ?? defaults.metrics;
  const mergeGroup = (group: AppState["group"]) => ({
    ...group,
    metricConfiguration: group.metricConfiguration
      ? mergeMetricList(group.metricConfiguration, groupDefaults)
      : group.metricConfiguration,
  });
  const groups = state.groups.map(mergeGroup);
  const group = mergeGroup(state.group);
  return {
    ...state,
    metrics,
    settings: canonicalSettings(state.settings),
    trackedGoalPeriods: canonicalTrackedPeriods(state.trackedGoalPeriods),
    entries: state.entries.map((entry) => ({
      ...entry,
      metricId: canonicalWorkoutTrackerId(entry.metricId),
    })),
    dailyMetricStatuses: canonicalStatuses(state.dailyMetricStatuses),
    journalNotes: state.journalNotes?.map((note) => ({
      ...note,
      metricId: note.metricId
        ? canonicalWorkoutTrackerId(note.metricId)
        : undefined,
      metricIds: note.metricIds ? canonicalIds(note.metricIds) : undefined,
    })),
    calendarReminders: state.calendarReminders?.map((reminder) => ({
      ...reminder,
      metricId: reminder.metricId
        ? canonicalWorkoutTrackerId(reminder.metricId)
        : undefined,
    })),
    activityTimers: state.activityTimers?.map((timer) => ({
      ...timer,
      metricId: canonicalWorkoutTrackerId(timer.metricId),
    })),
    activeTimer: state.activeTimer
      ? {
          ...state.activeTimer,
          metricId: canonicalWorkoutTrackerId(state.activeTimer.metricId),
        }
      : undefined,
    group,
    groups: groups.map((candidate) =>
      candidate.id === group.id ? group : candidate,
    ),
    selectedGroupMetricId: canonicalWorkoutTrackerId(
      state.selectedGroupMetricId,
    ),
  };
}
