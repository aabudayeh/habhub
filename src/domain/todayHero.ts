import type { AppState, MetricDefinition, TodoItem } from "@/src/types";

import {
  effectiveGoalTarget,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
} from "./metrics";
import { todoAppearsOnDate, todoResolvedOnDate } from "./schedule";
import { todoMatchesViewFilter } from "./todos";

export type TodayHeroGoalProgress = {
  id: string;
  metric: MetricDefinition;
  met: boolean;
  progress: number;
  unavailable: boolean;
  value: number;
};

export type TodayHeroSummary = {
  allMet: boolean;
  completedTodos: number;
  goalProgress: TodayHeroGoalProgress[];
  met: number;
  progress: number;
  todoIds?: string[];
  todoLabels?: string[];
  todos: TodoItem[];
  todoVisible: boolean;
  total: number;
  trackedGoals: ReturnType<typeof trackedGoalSummary>;
  usesGoals: boolean;
};

function boundedProgress(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * The single semantic source for Today's featured card and its widget mirror.
 * Presentation-only tutorial previews stay in the Today screen; persisted
 * launcher snapshots always reflect the account's real goal and to-do state.
 */
export function todayHeroSummary(
  state: AppState,
  userId: string,
  localDate: string,
): TodayHeroSummary {
  const trackedGoals = trackedGoalSummary(state, userId, localDate);
  const activeView = (state.settings.trackerViewFilters ?? []).find(
    (filter) => filter.id === state.settings.activeTodayTrackerViewFilterId,
  );
  const todoVisible = activeView?.includeTodos !== false;
  const todoIds = activeView?.todoIds;
  const todoLabels = activeView?.todoLabels;
  const todos =
    state.settings.showTodosToday === false || !todoVisible
      ? []
      : (state.todos ?? []).filter(
          (todo) =>
            todoMatchesViewFilter(todo, { todoIds, todoLabels }) &&
            todoAppearsOnDate(todo, localDate),
        );
  const completedTodos = todos.filter((todo) =>
    todoResolvedOnDate(todo, localDate),
  ).length;
  const usesGoals = state.settings.showGoalsToday !== false;
  const total = usesGoals ? trackedGoals.total : todos.length;
  const met = usesGoals ? trackedGoals.met : completedTodos;
  const progress = total ? met / total : 0;
  const unavailableIds = new Set(
    trackedGoals.unavailable.map((metric) => metric.id),
  );
  const goalProgress = trackedGoals.metrics.map((metric) => {
    const unavailable = unavailableIds.has(metric.id);
    const met = scheduledGoalReached(state, metric, userId, localDate);
    const value = unavailable
      ? 0
      : safeMetricValue(state, metric, userId, localDate);
    return {
      id: metric.id,
      metric,
      met,
      progress: unavailable
        ? 0
        : met && metric.id !== "deficit"
          ? 1
          : boundedProgress(
              metricVisualProgress(
                state,
                metric,
                userId,
                localDate,
                value,
                effectiveGoalTarget(state, metric, userId, localDate),
              ),
            ),
      unavailable,
      value,
    };
  });

  return {
    allMet: total > 0 && met === total,
    completedTodos,
    goalProgress,
    met,
    progress,
    todoIds,
    todoLabels,
    todos,
    todoVisible,
    total,
    trackedGoals,
    usesGoals,
  };
}
