import type { HistoryRange } from "@/src/types";

export function progressGridNavigationSettings(
  selectedDate: string,
  range: HistoryRange,
) {
  return {
    progressViewMode: "goal_maps" as const,
    progressHistoryRange: range,
    progressHistoryAnchor: selectedDate,
  };
}
