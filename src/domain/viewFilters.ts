import { isMetricTrackedOnDate } from "@/src/domain/metrics";
import { AppState, MetricDefinition } from "@/src/types";

export const ALL_TRACKERS_FILTER = "all";
export const ALL_AVAILABLE_TRACKERS_FILTER = "all_available";
export const TRACKED_ONLY_FILTER = "tracked";
export const UNTRACKED_ONLY_FILTER = "untracked";
export type TrackerViewScope = "today" | "progress";

export function activeTrackerViewId(
  state: AppState,
  scope: TrackerViewScope,
) {
  return (
    (scope === "today"
      ? state.settings.activeTodayTrackerViewFilterId
      : state.settings.activeProgressTrackerViewFilterId) ??
    state.settings.activeTrackerViewFilterId ??
    ALL_TRACKERS_FILTER
  );
}

export function metricMatchesActiveView(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
  scope: TrackerViewScope,
) {
  const id = activeTrackerViewId(state, scope);
  if (
    id === ALL_TRACKERS_FILTER ||
    id === ALL_AVAILABLE_TRACKERS_FILTER
  )
    return true;
  const tracked = isMetricTrackedOnDate(state, metric, localDate);
  if (id === TRACKED_ONLY_FILTER) return tracked;
  if (id === UNTRACKED_ONLY_FILTER) return !tracked;
  const saved = state.settings.trackerViewFilters?.find(
    (filter) => filter.id === id,
  );
  return saved ? saved.metricIds.includes(metric.id) : true;
}

export function activeTrackerViewLabel(
  state: AppState,
  scope: TrackerViewScope,
) {
  const id = activeTrackerViewId(state, scope);
  if (id === TRACKED_ONLY_FILTER) return "Tracked goals";
  if (id === UNTRACKED_ONLY_FILTER) return "Other trackers";
  if (id === ALL_AVAILABLE_TRACKERS_FILTER) return "All trackers";
  return (
    state.settings.trackerViewFilters?.find((filter) => filter.id === id)
      ?.name ?? "None"
  );
}
