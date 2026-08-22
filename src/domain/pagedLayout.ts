export function chunkIntoPages<T>(items: readonly T[], requestedSize: number): T[][] {
  const size = Math.max(1, Math.floor(requestedSize));
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

export function clampPageIndex(index: number, pageCount: number) {
  if (pageCount <= 0) return 0;
  return Math.max(0, Math.min(Math.round(index), pageCount - 1));
}

export function pageIndexFromOffset(
  offset: number,
  pageWidth: number,
  pageCount: number,
) {
  if (!Number.isFinite(offset) || !Number.isFinite(pageWidth) || pageWidth <= 0)
    return 0;
  return clampPageIndex(offset / pageWidth, pageCount);
}

/**
 * Keeps a normal Today page within the useful phone viewport while avoiding
 * one-card pages on smaller devices. Expanded history remains reachable via
 * the surrounding vertical screen scroll.
 */
export function todayPageCapacity(viewportHeight: number, compact: boolean) {
  const height = Number.isFinite(viewportHeight) ? viewportHeight : 720;
  const reservedHeight = compact ? 320 : 365;
  const estimatedRowHeight = compact ? 58 : 68;
  return Math.max(
    2,
    Math.min(5, Math.floor((height - reservedHeight) / estimatedRowHeight)),
  );
}
