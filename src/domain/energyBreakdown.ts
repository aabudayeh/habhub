import { calculateBmr } from '@/src/domain/energy';
import { dateKey } from '@/src/domain/date';
import { entriesForDay, entriesForUserDay } from '@/src/domain/dataIndex';
import {
  activeEnergyEntriesWithoutCoveredWorkoutFallbacks,
  friendlyHealthOrigin,
  isCalculatedStepFallback,
  isWorkoutEnergyEntry,
  unrecordedStepActivity,
} from '@/src/domain/health';
import { metricValue } from '@/src/domain/metrics';
import { AppState, MetricEntry } from '@/src/types';

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizedOrigin(entry: MetricEntry) {
  return entry.sourceOrigin
    ? friendlyHealthOrigin(entry.sourceOrigin).trim().toLocaleLowerCase()
    : '';
}

function compatibleOrigin(left: MetricEntry, right: MetricEntry) {
  const leftOrigin = normalizedOrigin(left);
  const rightOrigin = normalizedOrigin(right);
  return (
    !leftOrigin ||
    !rightOrigin ||
    leftOrigin === 'your phone' ||
    rightOrigin === 'your phone' ||
    leftOrigin === rightOrigin
  );
}

function isDailyActiveAggregate(entry: MetricEntry) {
  const label = (entry.label ?? '').trim().toLocaleLowerCase();
  const generic = /^(active (calories|energy)( total)?|calories burned)$/.test(
    label,
  );
  return (
    generic &&
    (label.endsWith('total') ||
      /(daily|aggregate|total|stream)/i.test(
        `${entry.sourceRecordId ?? ''} ${entry.id}`,
      ))
  );
}

function appendNote(note: string | undefined, addition: string) {
  return [note, addition].filter(Boolean).join(' · ');
}

function restingEnergyThrough(
  state: AppState,
  userId: string,
  localDate: string,
  now: Date,
) {
  const profile =
    state.energyProfiles?.[userId] ?? state.settings.energyProfile;
  const daily = calculateBmr(profile) || state.settings.baselineCalories;
  const today = dateKey(now);
  if (localDate < today) return daily;
  if (localDate > today) return 0;
  const start = new Date(`${today}T00:00:00`).getTime();
  return (
    daily *
    Math.max(0, Math.min(1, (now.getTime() - start) / 86_400_000))
  );
}

function breakdownEntry(
  source: MetricEntry,
  metricId: string,
): MetricEntry {
  return {
    ...source,
    id: `energy-breakdown:activity:${source.id}`,
    metricId,
    // These are read-only projections of the canonical Active energy rows.
    // Keeping the provider identity and label preserves workout provenance;
    // calculated prevents a detail view from deleting the source by mistake.
    source: 'calculated',
    sourceOrigin:
      source.sourceOrigin ??
      (source.source === 'manual' ? 'Manual entry' : undefined),
  };
}

/**
 * Read-only entry projection for the Total energy burned detail page.
 *
 * The first row per day is the one progressive BMR contribution. Every
 * workout/provider/uncovered-step Active energy row remains separate. A
 * residual is added only when the live calculated value or a provider total
 * contains energy that cannot be attributed to a stored source row.
 */
export function totalEnergyBurnedBreakdownEntries(
  state: AppState,
  userId: string,
  localDates: readonly string[],
  now = new Date(),
) {
  const totalMetric = state.metrics.find(
    (metric) => metric.id === 'energy_burned',
  );
  const activeMetric = state.metrics.find((metric) => metric.id === 'exercise');
  if (!totalMetric) return [];
  const today = dateKey(now);
  const rows: MetricEntry[] = [];
  for (const localDate of [...new Set(localDates)]) {
    if (
      localDate > today ||
      (totalMetric.activeFrom && localDate < totalMetric.activeFrom)
    )
      continue;
    const recordedAt =
      localDate === today
        ? now.toISOString()
        : `${localDate}T23:59:59.999`;
    const resting = restingEnergyThrough(
      state,
      userId,
      localDate,
      now,
    );
    rows.push({
      id: `energy-breakdown:bmr:${localDate}`,
      metricId: totalMetric.id,
      userId,
      value: Math.round(resting * 10) / 10,
      localDate,
      recordedAt,
      visibility: totalMetric.defaultVisibility,
      source: 'calculated',
      label: 'Resting energy (BMR)',
      note:
        localDate === today
          ? 'Updates progressively through today.'
          : 'Full-day basal metabolic rate.',
    });

    const rawSourceRows = activeMetric
      ? entriesForDay(state.entries, activeMetric.id, userId, localDate).filter(
          (entry) => positive(entry.value) > 0,
        )
      : [];
    const canonicalSourceRows = activeMetric
      ? activeEnergyEntriesWithoutCoveredWorkoutFallbacks(
          rawSourceRows,
        )
      : [];
    const canonicalIds = new Set(canonicalSourceRows.map((entry) => entry.id));
    const suppressedWorkoutRows = rawSourceRows.filter(
      (entry) => isWorkoutEnergyEntry(entry) && !canonicalIds.has(entry.id),
    );
    const dailyAggregates = canonicalSourceRows.filter(isDailyActiveAggregate);
    const displaySourceRows = canonicalSourceRows.filter(
      (entry) =>
        !isCalculatedStepFallback(entry) && !isDailyActiveAggregate(entry),
    );
    const claimedWorkoutRows = new Set<string>();
    for (const aggregate of dailyAggregates) {
      const workouts = suppressedWorkoutRows.filter(
        (entry) =>
          !claimedWorkoutRows.has(entry.id) &&
          entry.sourceProvider === aggregate.sourceProvider &&
          compatibleOrigin(entry, aggregate),
      );
      if (!workouts.length) {
        displaySourceRows.push(aggregate);
        continue;
      }
      const aggregateValue = positive(aggregate.value);
      const workoutValue = workouts.reduce(
        (sum, entry) => sum + positive(entry.value),
        0,
      );
      const allocationScale =
        workoutValue > aggregateValue && workoutValue > 0
          ? aggregateValue / workoutValue
          : 1;
      for (const workout of workouts) {
        claimedWorkoutRows.add(workout.id);
        displaySourceRows.push({
          ...workout,
          value:
            Math.round(positive(workout.value) * allocationScale * 10) / 10,
          note: appendNote(
            workout.note,
            'Reconciled to the provider active-energy total.',
          ),
        });
      }
      const allocated = workouts.reduce(
        (sum, entry) => sum + positive(entry.value) * allocationScale,
        0,
      );
      const remainder = Math.max(0, aggregateValue - allocated);
      if (remainder > 0.05)
        displaySourceRows.push({
          ...aggregate,
          id: `${aggregate.id}:provider-remainder`,
          value: Math.round(remainder * 10) / 10,
          label: 'Other provider active energy',
          note: 'Provider active-energy total after its workout components.',
        });
    }

    const stepMetric = state.metrics.find(
      (metric) =>
        metric.healthMapping?.dataType === 'steps' &&
        metric.healthMapping.field === 'value',
    );
    const stepCount = stepMetric
      ? positive(metricValue(state, stepMetric, userId, localDate, [], now))
      : 0;
    const profile =
      state.energyProfiles?.[userId] ?? state.settings.energyProfile;
    const unrecordedSteps = stepMetric
      ? unrecordedStepActivity(
          entriesForUserDay(state.entries, userId, localDate),
          state.metrics,
          stepCount,
          profile,
        )
      : undefined;
    if (unrecordedSteps && unrecordedSteps.estimatedCalories > 0.05) {
      const stepSource = entriesForDay(
        state.entries,
        stepMetric!.id,
        userId,
        localDate,
      )
        .slice()
        .sort(
          (left, right) => right.recordedAt.localeCompare(left.recordedAt),
        )[0];
      displaySourceRows.push({
        id: `energy-breakdown:unrecorded-steps:${localDate}`,
        metricId: activeMetric?.id ?? 'exercise',
        userId,
        value: Math.round(unrecordedSteps.estimatedCalories * 10) / 10,
        localDate,
        recordedAt: stepSource?.recordedAt ?? recordedAt,
        visibility: activeMetric?.defaultVisibility ?? totalMetric.defaultVisibility,
        source: 'calculated',
        label: 'Estimated unrecorded walking from steps',
        note: `Uses ${Math.round(unrecordedSteps.uncoveredSteps).toLocaleString()} steps not already explained by walking or running workouts.`,
        sourceProvider: stepSource?.sourceProvider,
        sourceRecordId: `step-fallback:${localDate}`,
        sourceOrigin: stepSource?.sourceOrigin,
      });
    }
    const activityRows = displaySourceRows.map((entry) =>
      breakdownEntry(entry, totalMetric.id),
    );

    const activeTotal = activeMetric
      ? positive(metricValue(state, activeMetric, userId, localDate, [], now))
      : 0;
    const attributedActive = displaySourceRows.reduce(
      (sum, entry) => sum + positive(entry.value),
      0,
    );
    rows.push(...activityRows);
    const activeResidual = Math.max(0, activeTotal - attributedActive);
    // Active energy is rounded to whole kcal by the tracker total; do not
    // manufacture a residual row for that sub-kcal presentation difference.
    if (activeResidual > 0.55)
      rows.push({
        id: `energy-breakdown:active-residual:${localDate}`,
        metricId: totalMetric.id,
        userId,
        value: Math.round(activeResidual * 10) / 10,
        localDate,
        recordedAt,
        visibility: totalMetric.defaultVisibility,
        source: 'calculated',
        label: 'Other active energy',
        note: 'Calculated activity not attributable to a stored source entry.',
      });

    const total = positive(
      metricValue(state, totalMetric, userId, localDate, [], now),
    );
    const reportedResidual = Math.max(0, total - resting - activeTotal);
    if (reportedResidual > 0.05)
      rows.push({
        id: `energy-breakdown:reported-residual:${localDate}`,
        metricId: totalMetric.id,
        userId,
        value: Math.round(reportedResidual * 10) / 10,
        localDate,
        recordedAt,
        visibility: totalMetric.defaultVisibility,
        source: 'calculated',
        label: 'Other reported energy',
        note: 'Additional energy included in the connected-health total.',
      });
  }
  return rows.sort(
    (left, right) =>
      right.localDate.localeCompare(left.localDate) ||
      right.recordedAt.localeCompare(left.recordedAt),
  );
}
