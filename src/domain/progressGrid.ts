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

export function yearHeatmapDateAtPoint(
  cells: (string | null)[],
  locationX: number,
  locationY: number,
  cellWidth: number,
  cellHeight: number,
  gap: number,
) {
  if (
    !Number.isFinite(locationX) ||
    !Number.isFinite(locationY) ||
    locationX < 0 ||
    locationY < 0
  )
    return undefined;
  const column = Math.floor(locationX / Math.max(1, cellWidth + gap));
  const row = Math.floor(locationY / Math.max(1, cellHeight + gap));
  if (row < 0 || row >= 7) return undefined;
  return cells[column * 7 + row] ?? undefined;
}
