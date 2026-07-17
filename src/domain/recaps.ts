import { AppState, MetricDefinition } from '@/src/types';
import { dateKey, dateRangeEnding, friendlyDate } from './date';
import { memberDisplayName } from './members';
import { dailyScore, formatMetricValue, safeMetricValue, trackedGoalSummary } from './metrics';

export type RecapScope = 'personal' | 'group';

export type RecapStory = {
  id: string;
  scope: RecapScope;
  eyebrow: string;
  title: string;
  stat: string;
  body: string;
  icon: string;
  color: string;
};

function average(state: AppState, metric: MetricDefinition, userId: string, dates: string[]) {
  return dates.reduce((sum, day) => sum + safeMetricValue(state, metric, userId, day), 0) / Math.max(dates.length, 1);
}

function total(state: AppState, metric: MetricDefinition, userId: string, dates: string[]) {
  return dates.reduce((sum, day) => sum + safeMetricValue(state, metric, userId, day), 0);
}

function deterministicShuffle(stories: RecapStory[], seed: string) {
  return [...stories].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function signedChange(current: number, previous: number) {
  if (!previous) return undefined;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function buildRecapStories(state: AppState, scope: RecapScope, anchor = dateKey()): RecapStory[] {
  const current = dateRangeEnding(anchor, 7);
  const previous = dateRangeEnding(current[0], 8).slice(0, 7);
  const stories = scope === 'personal'
    ? personalStories(state, current, previous)
    : groupStories(state, current, previous);
  return deterministicShuffle(stories, `${anchor}:${scope}`).slice(0, 8);
}

function personalStories(state: AppState, current: string[], previous: string[]): RecapStory[] {
  const userId = state.currentUserId;
  const stories: RecapStory[] = [];
  const steps = state.metrics.find((metric) => metric.id === 'steps');
  const exercise = state.metrics.find((metric) => metric.id === 'exercise');
  const food = state.metrics.find((metric) => metric.id === 'food');
  const protein = state.metrics.find((metric) => metric.id === 'protein');
  const perfect = current.filter((day) => trackedGoalSummary(state, userId, day).allMet).length;
  const goalTotals = current.map((day) => trackedGoalSummary(state, userId, day));
  const met = goalTotals.reduce((sum, item) => sum + item.met, 0);
  const possible = goalTotals.reduce((sum, item) => sum + item.total, 0);
  const scores = current.map((day) => ({ day, value: dailyScore(state, userId, day) })).sort((a, b) => b.value - a.value);

  if (steps) {
    const stepAverage = average(state, steps, userId, current);
    const priorAverage = average(state, steps, userId, previous);
    const stepTotal = total(state, steps, userId, current);
    const change = signedChange(stepAverage, priorAverage);
    const km = stepTotal * 0.000762;
    stories.push({ id: 'personal-steps', scope: 'personal', eyebrow: 'YOUR 7-DAY RECAP', title: 'You kept moving', stat: `${Math.round(stepAverage).toLocaleString()} steps/day`, body: change === undefined ? `${km.toFixed(1)} estimated kilometres this week.` : `${Math.abs(change)}% ${change >= 0 ? 'more' : 'less'} than last week · about ${km.toFixed(1)} km.`, icon: steps.icon, color: steps.color });
    stories.push({ id: 'personal-distance', scope: 'personal', eyebrow: 'DISTANCE UNLOCKED', title: 'Put it in perspective', stat: `${(km / 42.195).toFixed(1)} marathons`, body: `Your ${Math.round(stepTotal).toLocaleString()} steps add up to roughly ${km.toFixed(1)} km.`, icon: 'map-outline', color: '#3274D9' });
  }
  stories.push({ id: 'personal-goals', scope: 'personal', eyebrow: 'GOAL CHECK', title: perfect ? 'Perfect days happened' : 'Every check counts', stat: `${perfect}/7 all-goal days`, body: `${met} of ${possible} individual tracked goals completed across the week.`, icon: 'checkmark-done-outline', color: '#9B6BDB' });
  stories.push({ id: 'personal-score', scope: 'personal', eyebrow: 'BEST DAY', title: friendlyDate(scores[0]?.day ?? current[6]), stat: `${Math.round(scores[0]?.value ?? 0)}/100`, body: 'Your highest configured Paceboard score in this recap window.', icon: 'sparkles-outline', color: '#6A5ACD' });
  if (exercise) {
    const value = total(state, exercise, userId, current);
    stories.push({ id: 'personal-exercise', scope: 'personal', eyebrow: 'ACTIVE ENERGY', title: 'Energy invested', stat: formatMetricValue(exercise, value), body: 'Total logged active energy across your last seven days.', icon: exercise.icon, color: exercise.color });
  }
  if (food) {
    const value = average(state, food, userId, current);
    stories.push({ id: 'personal-food', scope: 'personal', eyebrow: 'NUTRITION RHYTHM', title: 'Your daily average', stat: formatMetricValue(food, value), body: 'Your activity-adjusted allowance is evaluated separately on each day.', icon: food.icon, color: food.color });
  }
  if (protein) {
    const value = average(state, protein, userId, current);
    stories.push({ id: 'personal-protein', scope: 'personal', eyebrow: 'PROTEIN CHECK', title: 'Weekly average', stat: formatMetricValue(protein, value), body: 'A simple look at consistency—not a medical recommendation.', icon: protein.icon, color: protein.color });
  }
  stories.push({ id: 'personal-consistency', scope: 'personal', eyebrow: 'SHOWING UP', title: 'Seven days, one story', stat: `${Math.round(current.reduce((sum, day) => sum + dailyScore(state, userId, day), 0) / 7)}/100`, body: 'Your average configured score for this rolling week.', icon: 'calendar-outline', color: '#E9873F' });
  return stories;
}

function groupStories(state: AppState, current: string[], previous: string[]): RecapStory[] {
  const stories: RecapStory[] = [];
  const members = state.group.members;
  const scoreRows = members.map((member) => ({ member, score: current.reduce((sum, day) => sum + dailyScore(state, member.id, day), 0) / 7 })).sort((a, b) => b.score - a.score);
  stories.push({ id: 'group-champion', scope: 'group', eyebrow: `${state.group.name.toUpperCase()} RECAP`, title: `${memberDisplayName(state, scoreRows[0].member)} leads the week`, stat: `${Math.round(scoreRows[0].score)}/100`, body: 'Highest average configured group score over the last seven days.', icon: 'trophy-outline', color: '#D8A126' });
  const tracked = state.metrics.filter((metric) => metric.scoreWeight > 0 && metric.sections.group && metric.dataType !== 'text').slice(0, 5);
  tracked.forEach((metric) => {
    const rows = members.map((member) => ({ member, value: average(state, metric, member.id, current) })).sort((a, b) => metric.rankingDirection === 'lower' ? a.value - b.value : b.value - a.value);
    stories.push({ id: `group-${metric.id}`, scope: 'group', eyebrow: `${metric.name.toUpperCase()} LEADER`, title: memberDisplayName(state, rows[0].member), stat: formatMetricValue(metric, rows[0].value), body: 'Best daily average across the current seven-day recap.', icon: metric.icon, color: metric.color });
  });
  const steps = state.metrics.find((metric) => metric.id === 'steps');
  if (steps) {
    const groupSteps = members.reduce((sum, member) => sum + total(state, steps, member.id, current), 0);
    stories.push({ id: 'group-distance', scope: 'group', eyebrow: 'TOGETHER', title: 'The group went far', stat: `${Math.round(groupSteps).toLocaleString()} steps`, body: `Roughly ${(groupSteps * 0.000762).toFixed(1)} km combined—about ${(groupSteps * 0.000762 / 42.195).toFixed(1)} marathons.`, icon: 'people-outline', color: steps.color });
  }
  const improvements = members.map((member) => {
    const now = current.reduce((sum, day) => sum + dailyScore(state, member.id, day), 0) / 7;
    const before = previous.reduce((sum, day) => sum + dailyScore(state, member.id, day), 0) / 7;
    return { member, delta: now - before };
  }).sort((a, b) => b.delta - a.delta);
  stories.push({ id: 'group-comeback', scope: 'group', eyebrow: 'COMEBACK ENERGY', title: memberDisplayName(state, improvements[0].member), stat: `${improvements[0].delta >= 0 ? '+' : ''}${Math.round(improvements[0].delta)} pts`, body: 'Largest score change compared with the previous seven days.', icon: 'trending-up-outline', color: '#E65D58' });
  stories.push({ id: 'group-finish', scope: 'group', eyebrow: 'KEEP IT FRIENDLY', title: 'The board resets every day', stat: `${members.length} friends`, body: 'Cheer a win, share the work, and keep the competition moving.', icon: 'chatbubbles-outline', color: '#3274D9' });
  return stories;
}
