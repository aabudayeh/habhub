import { isMetricTrackedOnDate } from "@/src/domain/metrics";
import { AppState, MetricDefinition } from "@/src/types";

export const ALL_TRACKERS_FILTER = "all";
export const TRACKED_ONLY_FILTER = "tracked";
export const UNTRACKED_ONLY_FILTER = "untracked";

export function metricMatchesActiveView(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
) {
  const id = state.settings.activeTrackerViewFilterId ?? ALL_TRACKERS_FILTER;
  if (id === ALL_TRACKERS_FILTER) return true;
  const tracked = isMetricTrackedOnDate(state, metric, localDate);
  if (id === TRACKED_ONLY_FILTER) return tracked;
  if (id === UNTRACKED_ONLY_FILTER) return !tracked;
  const saved = state.settings.trackerViewFilters?.find(
    (filter) => filter.id === id,
  );
  return saved ? saved.metricIds.includes(metric.id) : true;
}

export function activeTrackerViewLabel(state: AppState) {
  const id = state.settings.activeTrackerViewFilterId ?? ALL_TRACKERS_FILTER;
  if (id === TRACKED_ONLY_FILTER) return "Tracked goals";
  if (id === UNTRACKED_ONLY_FILTER) return "Other trackers";
  return (
    state.settings.trackerViewFilters?.find((filter) => filter.id === id)
      ?.name ?? "All trackers"
  );
}
