import { MetricDefinition, UserSettings } from "@/src/types";

type CompletedBehavior = NonNullable<
  UserSettings["completedTodayBehavior"]
>;

/**
 * Pins are a separate, higher-priority rule. Completion behavior only
 * determines what happens inside the unpinned section.
 */
export function orderTodayMetrics(
  metrics: MetricDefinition[],
  completedBehavior: CompletedBehavior,
  isCompletedGoal: (metric: MetricDefinition) => boolean,
) {
  const eligible =
    completedBehavior === "hide"
      ? metrics.filter((metric) => !isCompletedGoal(metric))
      : [...metrics];
  const pinned = eligible
    .filter((metric) => Boolean(metric.pinnedTodayAt))
    .sort(
      (a, b) =>
        (a.pinnedTodayAt ?? "").localeCompare(b.pinnedTodayAt ?? "") ||
        a.order - b.order,
    );
  const unpinned = eligible
    .filter((metric) => !metric.pinnedTodayAt)
    .sort((a, b) => {
      if (completedBehavior === "stay") return a.order - b.order;
      return (
        Number(isCompletedGoal(a)) - Number(isCompletedGoal(b)) ||
        a.order - b.order
      );
    });
  return [...pinned, ...unpinned];
}
