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

/** Uses a saved page size when present and safely supports older snapshots. */
export function configuredPageCapacity(
  configured: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const normalizedFallback = Math.max(
    minimum,
    Math.min(maximum, Math.floor(fallback)),
  );
  if (!Number.isFinite(configured)) return normalizedFallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(configured!)));
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
    Math.min(6, Math.floor((height - reservedHeight) / estimatedRowHeight)),
  );
}

/**
 * Packs up to four Leaderboard cards when their estimated collapsed heights
 * fit the useful viewport. Expanding a member calendar must not change the
 * card-to-page grouping; the surrounding vertical screen remains available
 * for the temporarily taller page.
 */
export function leaderboardPageCapacity(
  viewportHeight: number,
  memberCount: number,
) {
  const height = Number.isFinite(viewportHeight) ? viewportHeight : 720;
  const members = Math.max(1, Math.floor(memberCount));
  // Page membership must stay stable while the date/history controls open.
  // Those controls live in the surrounding vertical screen, so their
  // temporary height is not part of the collapsed-card packing estimate.
  const reservedHeight = 220;
  const availableHeight = Math.max(180, height - reservedHeight);
  const estimatedCardHeight = 55 + members * 48;
  return Math.max(
    1,
    Math.min(4, Math.floor((availableHeight + 8) / (estimatedCardHeight + 8))),
  );
}
