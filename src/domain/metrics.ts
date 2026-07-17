import { AppState, MetricDefinition, MetricEntry } from '@/src/types';
import { dateWithOffsetFrom } from './date';
import { dailyFoodGoal, energyFormulaVariables, KCAL_PER_KG_ESTIMATE } from './energy';
import { evaluateFormula, formulaIdentifiers, FormulaError } from './formula';

function aggregate(entries: MetricEntry[], method: MetricDefinition['aggregation']): number {
  const numbers = entries
    .map((entry) => (entry.value === true ? 1 : entry.value === false ? 0 : Number(entry.value)))
    .filter(Number.isFinite);
  if (!numbers.length) return 0;
  switch (method) {
    case 'latest':
      return numbers[numbers.length - 1];
    case 'average':
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case 'max':
      return Math.max(...numbers);
    case 'min':
      return Math.min(...numbers);
    default:
      return numbers.reduce((sum, value) => sum + value, 0);
  }
}

export function metricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
  stack: string[] = [],
): number {
  if (metric.dataType === 'photo') {
    return state.photos.filter((photo) => photo.userId === userId && photo.localDate === localDate).length;
  }
  if (metric.dataType !== 'calculated') {
    const sameDay = state.entries
      .filter((entry) => entry.metricId === metric.id && entry.userId === userId && entry.localDate === localDate)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    if (sameDay.length || metric.aggregation !== 'latest') return aggregate(sameDay, metric.aggregation);
    const carried = state.entries
      .filter((entry) => entry.metricId === metric.id && entry.userId === userId && entry.localDate <= localDate)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    return carried ? aggregate([carried], 'latest') : 0;
  }

  if (!metric.formula) return 0;
  if (stack.includes(metric.id)) throw new FormulaError(`Circular formula involving “${metric.name}”`);

  const variables: Record<string, number> = energyFormulaVariables(
    state.energyProfiles?.[userId] ?? state.settings.energyProfile,
    state.settings.baselineCalories,
  );
  for (const identifier of formulaIdentifiers(metric.formula)) {
    if (identifier in variables) continue;
    const dependency = state.metrics.find((candidate) => candidate.id === identifier);
    if (dependency) {
      variables[identifier] = metricValue(state, dependency, userId, localDate, [...stack, metric.id]);
    }
  }

  return evaluateFormula(metric.formula, variables);
}

export function safeMetricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  localDate: string,
): number {
  try {
    return metricValue(state, metric, userId, localDate);
  } catch {
    return 0;
  }
}

export function effectiveGoalTarget(state: AppState, metric: MetricDefinition, userId: string, localDate: string): number {
  if (metric.id !== 'food') return metric.goal.target;
  const exercise = state.metrics.find((candidate) => candidate.id === 'exercise');
  const activeEnergy = exercise ? safeMetricValue(state, exercise, userId, localDate) : 0;
  return dailyFoodGoal(metric.goal.target, activeEnergy, state.settings.foodGoalMode ?? 'activity_adjusted');
}

export function latestTextValue(state: AppState, metricId: string, userId: string, localDate: string): string {
  const match = state.entries
    .filter((entry) => entry.metricId === metricId && entry.userId === userId && entry.localDate === localDate)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  return typeof match?.value === 'string' ? match.value : '';
}

export function averageMetricValue(
  state: AppState,
  metric: MetricDefinition,
  userId: string,
  dates: string[],
): number {
  if (!dates.length) return 0;
  return dates.reduce((sum, date) => sum + safeMetricValue(state, metric, userId, date), 0) / dates.length;
}

export type SharedMetricResult = {
  mode: VisibilityMode;
  value: number;
  label: string;
};

type VisibilityMode = 'exact' | 'status' | 'private';

export function sharedMetricResult(
  state: AppState,
  metric: MetricDefinition,
  subjectUserId: string,
  viewerUserId: string,
  localDate: string,
): SharedMetricResult {
  const value = metric.dataType === 'photo' && subjectUserId !== viewerUserId
    ? state.photos.filter((photo) => photo.userId === subjectUserId && photo.localDate === localDate && photo.visibility === 'group').length
    : safeMetricValue(state, metric, subjectUserId, localDate);
  if (subjectUserId === viewerUserId) return { mode: 'exact', value, label: formatMetricValue(metric, value) };

  const entries = state.entries.filter(
    (entry) => entry.metricId === metric.id && entry.userId === subjectUserId && entry.localDate === localDate,
  );
  const sharedStatus = state.dailyMetricStatuses?.find((status) =>
    status.groupId === state.group.id && status.metricId === metric.id && status.userId === subjectUserId && status.localDate === localDate,
  );
  const photoEntries = metric.dataType === 'photo'
    ? state.photos.filter((photo) => photo.userId === subjectUserId && photo.localDate === localDate)
    : [];
  const visibility = metric.dataType === 'photo'
    ? photoEntries.some((photo) => photo.visibility === 'group') ? 'group' : 'private'
    : metric.dataType === 'calculated'
    ? metric.defaultVisibility
    : entries.some((entry) => entry.visibility === 'group')
      ? 'group'
      : entries.some((entry) => entry.visibility === 'status')
        ? 'status'
        : 'private';

  if (subjectUserId !== viewerUserId && !entries.length && sharedStatus) return { mode: 'status', value: 0, label: sharedStatus.goalReached ? 'Goal met' : 'In progress' };
  if (visibility === 'group') return { mode: 'exact', value, label: formatMetricValue(metric, value) };
  if (visibility === 'status') {
    return { mode: 'status', value, label: goalReached(metric, value, effectiveGoalTarget(state, metric, subjectUserId, localDate)) ? 'Goal met' : 'In progress' };
  }
  return { mode: 'private', value, label: 'Private' };
}

export function goalProgress(metric: MetricDefinition, value: number, targetOverride = metric.goal.target): number {
  const target = Math.max(targetOverride, 0.0001);
  switch (metric.goal.kind) {
    case 'at_most':
      if (value <= 0) return 0;
      return value <= target ? 1 : Math.max(0, 1 - (value - target) / target);
    case 'exact':
      return Math.max(0, 1 - Math.abs(value - target) / target);
    case 'complete':
      return value > 0 ? 1 : 0;
    default:
      return Math.max(0, value / target);
  }
}

export function goalReached(metric: MetricDefinition, value: number, targetOverride = metric.goal.target): boolean {
  switch (metric.goal.kind) {
    case 'at_most':
      return value <= targetOverride && value > 0;
    case 'exact':
      return value === targetOverride;
    case 'complete':
      return value > 0;
    default:
      return value >= targetOverride;
  }
}

export function dailyScore(state: AppState, userId: string, localDate: string): number {
  const enabled = state.metrics.filter((metric) => metric.scoreWeight > 0 && metric.dataType !== 'text' && metric.activeFrom <= localDate);
  const totalWeight = enabled.reduce((sum, metric) => sum + metric.scoreWeight, 0) || 1;
  return enabled.reduce((score, metric) => {
    const status = state.dailyMetricStatuses?.find((item) => item.groupId === state.group.id && item.metricId === metric.id && item.userId === userId && item.localDate === localDate);
    const hasVisibleValue = metric.dataType === 'photo'
      ? state.photos.some((photo) => photo.userId === userId && photo.localDate === localDate && photo.visibility === 'group')
      : state.entries.some((entry) => entry.metricId === metric.id && entry.userId === userId && entry.localDate === localDate && entry.visibility === 'group');
    if (status && !hasVisibleValue && userId !== state.currentUserId) {
      return score + (metric.scoreWeight / totalWeight) * Math.min(Math.max(status.scoreContribution, 0), 100);
    }
    let value = 0;
    if (metric.dataType === 'calculated') {
      value = metric.defaultVisibility === 'private' ? 0 : safeMetricValue(state, metric, userId, localDate);
    } else if (metric.dataType === 'photo') {
      value = state.photos.filter((photo) => photo.userId === userId && photo.localDate === localDate && photo.visibility === 'group').length;
    } else {
      value = aggregate(
        state.entries
          .filter((entry) => entry.metricId === metric.id && entry.userId === userId && entry.localDate === localDate && entry.visibility !== 'private')
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
        metric.aggregation,
      );
    }
    const cappedProgress = Math.min(goalProgress(metric, value, effectiveGoalTarget(state, metric, userId, localDate)), 1);
    return score + (metric.scoreWeight / totalWeight) * cappedProgress * 100;
  }, 0);
}

export function isMetricTrackedOnDate(state: AppState, metric: MetricDefinition, localDate: string): boolean {
  const periods = state.trackedGoalPeriods?.[metric.id];
  if (!periods) return metric.sections.today && metric.activeFrom <= localDate;
  return periods.some((period) => period.from <= localDate && (!period.to || localDate <= period.to));
}

export function trackedGoalSummary(state: AppState, userId: string, localDate: string, metricIds?: string[]) {
  const metrics = state.metrics.filter((metric) =>
    metric.activeFrom <= localDate && metric.dataType !== 'text' &&
    (metricIds ? metricIds.includes(metric.id) : isMetricTrackedOnDate(state, metric, localDate)),
  );
  const met = metrics.filter((metric) => goalReached(metric, safeMetricValue(state, metric, userId, localDate), effectiveGoalTarget(state, metric, userId, localDate)));
  return { met: met.length, total: metrics.length, allMet: metrics.length > 0 && met.length === metrics.length, metrics };
}

export type DeficitRealityCheck = {
  status: 'aligned' | 'reported_ahead' | 'scale_ahead' | 'insufficient' | 'noise';
  actualDailyDeficit: number;
  reportedDailyDeficit: number;
  days: number;
  weightChangeKg: number;
  fromDate?: string;
  toDate?: string;
};

export function deficitRealityCheck(state: AppState, userId: string): DeficitRealityCheck {
  const latest = state.entries
    .filter((entry) => entry.metricId === 'weight' && entry.userId === userId && Number.isFinite(Number(entry.value)))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  return latest ? deficitRealityCheckAtDate(state, userId, latest.localDate) : emptyRealityCheck();
}

function emptyRealityCheck(): DeficitRealityCheck {
  return { status: 'insufficient', actualDailyDeficit: 0, reportedDailyDeficit: 0, days: 0, weightChangeKg: 0 };
}

export function deficitRealityCheckAtDate(state: AppState, userId: string, localDate: string): DeficitRealityCheck {
  const weight = state.metrics.find((metric) => metric.id === 'weight');
  const deficit = state.metrics.find((metric) => metric.id === 'deficit');
  if (!weight || !deficit) return emptyRealityCheck();
  const weightEntries = state.entries
    .filter((entry) => entry.metricId === weight.id && entry.userId === userId && entry.localDate <= localDate && Number.isFinite(Number(entry.value)))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const currentIndex = weightEntries.map((entry) => entry.localDate).lastIndexOf(localDate);
  if (currentIndex < 1) return emptyRealityCheck();
  const previous = weightEntries[currentIndex - 1];
  const current = weightEntries[currentIndex];
  const days = Math.max(0.5, (new Date(current.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 86400000);
  const weightChangeKg = Number(previous.value) - Number(current.value);
  const dateCursor = new Date(`${previous.localDate}T12:00:00`);
  if (previous.localDate !== current.localDate) dateCursor.setDate(dateCursor.getDate() + 1);
  const reported: number[] = [];
  while (dateCursor <= new Date(`${current.localDate}T12:00:00`)) {
    const key = `${dateCursor.getFullYear()}-${String(dateCursor.getMonth() + 1).padStart(2, '0')}-${String(dateCursor.getDate()).padStart(2, '0')}`;
    reported.push(safeMetricValue(state, deficit, userId, key));
    dateCursor.setDate(dateCursor.getDate() + 1);
  }
  const reportedDailyDeficit = reported.reduce((sum, value) => sum + value, 0) / Math.max(reported.length, 1);
  const actualDailyDeficit = weightChangeKg * KCAL_PER_KG_ESTIMATE / days;
  if (Math.abs(weightChangeKg) < 0.3) return { status: 'noise', actualDailyDeficit, reportedDailyDeficit, days, weightChangeKg, fromDate: previous.localDate, toDate: current.localDate };
  const ratio = reportedDailyDeficit > 0 ? actualDailyDeficit / reportedDailyDeficit : 0;
  const status = ratio >= 0.6 && ratio <= 1.4 ? 'aligned' : ratio < 0.6 ? 'reported_ahead' : 'scale_ahead';
  return { status, actualDailyDeficit, reportedDailyDeficit, days, weightChangeKg, fromDate: previous.localDate, toDate: current.localDate };
}

export function rankedMembers(state: AppState, metric: MetricDefinition, localDate: string) {
  const rows = state.group.members.map((member) => ({
    member,
    value: safeMetricValue(state, metric, member.id, localDate),
  }));

  return rows.sort((a, b) => {
    if (a.value === 0 && b.value !== 0) return 1;
    if (b.value === 0 && a.value !== 0) return -1;
    if (metric.rankingDirection === 'lower') return a.value - b.value;
    if (metric.rankingDirection === 'closest') {
      return Math.abs(a.value - effectiveGoalTarget(state, metric, a.member.id, localDate)) - Math.abs(b.value - effectiveGoalTarget(state, metric, b.member.id, localDate));
    }
    return b.value - a.value;
  });
}

export function goalRemainingLabel(state: AppState, metric: MetricDefinition, userId: string, localDate: string): string | undefined {
  if (metric.dataType === 'text' || metric.dataType === 'boolean' || metric.dataType === 'photo') return undefined;
  const value = safeMetricValue(state, metric, userId, localDate);
  const target = effectiveGoalTarget(state, metric, userId, localDate);
  if (metric.id === 'exercise') {
    const deficit = state.metrics.find((candidate) => candidate.id === 'deficit');
    if (deficit) {
      const deficitValue = safeMetricValue(state, deficit, userId, localDate);
      const deficitTarget = effectiveGoalTarget(state, deficit, userId, localDate);
      const rescueBurn = Math.max(0, deficitTarget - deficitValue);
      if (rescueBurn > 0) {
        return `${formatMetricValue(metric, rescueBurn)} more activity would reach today’s deficit goal · a walk or run can help`;
      }
    }
  }
  if (metric.id === 'weight') {
    const remaining = Math.max(0, value - target);
    const weights = state.entries.filter((entry) => entry.metricId === metric.id && entry.userId === userId && entry.localDate <= localDate && Number.isFinite(Number(entry.value))).sort((a,b)=>b.localDate.localeCompare(a.localDate));
    const current = weights[0];
    const older = current ? weights.find((entry) => entry.localDate <= new Date(new Date(`${current.localDate}T12:00:00`).getTime() - 6 * 86400000).toISOString().slice(0,10)) : undefined;
    const elapsed = current && older ? Math.max(1,(new Date(`${current.localDate}T12:00:00`).getTime()-new Date(`${older.localDate}T12:00:00`).getTime())/86400000) : 0;
    const pace = current && older && elapsed ? (Number(older.value)-Number(current.value))/elapsed*7 : 0;
    return `${formatMetricValue(metric, remaining)} left to lose${pace>0?` · ~${pace.toFixed(1)} kg/week pace`:' · pace pending more weigh-ins'}`;
  }
  if (metric.goal.kind === 'at_least') {
    const remaining = Math.max(0, target - value);
    return remaining > 0 ? `${formatMetricValue(metric, remaining)} left · goal ${formatMetricValue(metric, target)}` : `Goal reached · ${formatMetricValue(metric, value-target)} above target`;
  }
  if (metric.goal.kind === 'at_most') {
    const remaining = target - value;
    const mode = metric.id === 'food' && state.settings.foodGoalMode !== 'fixed' ? ' · adjusts with active energy' : '';
    return remaining >= 0 ? `${formatMetricValue(metric, remaining)} remaining · goal ${formatMetricValue(metric, target)}${mode}` : `${formatMetricValue(metric, Math.abs(remaining))} over goal${mode}`;
  }
  const difference = Math.abs(target-value);
  return difference > 0 ? `${formatMetricValue(metric,difference)} from target · goal ${formatMetricValue(metric,target)}` : 'Exact goal reached';
}

export type WeeklyDeficitBalance = {
  balance: number;
  actual: number;
  target: number;
  days: number;
  startDate: string;
};

/** Positive means ahead of the cumulative deficit target; negative means there is a weekly shortfall. */
export function weeklyDeficitBalance(state: AppState, userId: string, localDate: string): WeeklyDeficitBalance {
  const deficit = state.metrics.find((metric) => metric.id === 'deficit');
  const weekday = new Date(`${localDate}T12:00:00`).getDay();
  const mondayOffset = -((weekday + 6) % 7);
  const startDate = dateWithOffsetFrom(localDate, mondayOffset);
  const days = Math.abs(mondayOffset) + 1;
  if (!deficit) return { balance: 0, actual: 0, target: 0, days, startDate };
  let actual = 0;
  let target = 0;
  for (let index = 0; index < days; index += 1) {
    const day = dateWithOffsetFrom(startDate, index);
    actual += safeMetricValue(state, deficit, userId, day);
    target += effectiveGoalTarget(state, deficit, userId, day);
  }
  return { balance: actual - target, actual, target, days, startDate };
}

export function formatMetricValue(metric: MetricDefinition, value: number): string {
  if (metric.dataType === 'boolean') return value > 0 ? 'Done' : 'Not yet';
  if (metric.dataType === 'photo') return `${Math.round(value)} photo${Math.round(value) === 1 ? '' : 's'}`;
  const rounded = Math.abs(value) >= 1000 ? Math.round(value).toLocaleString() : Number(value.toFixed(1)).toLocaleString();
  return metric.unit ? `${rounded} ${metric.unit}` : rounded;
}
