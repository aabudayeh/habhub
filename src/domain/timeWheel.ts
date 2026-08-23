/** Returns the bounded wheel row whose centre is nearest the scroll offset. */
export function wheelIndexFromOffset(
  offset: number,
  rowHeight: number,
  itemCount: number,
) {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 0;
  const safeHeight =
    Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  return Math.max(
    0,
    Math.min(Math.floor(itemCount) - 1, Math.round(safeOffset / safeHeight)),
  );
}
