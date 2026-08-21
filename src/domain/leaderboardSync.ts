type SourceStampedEntry = {
  recordedAt?: string;
  sourceUpdatedAt?: string;
};

type LeaderboardSyncResult = {
  lastSyncedAt?: string;
};

type MemberDailyStatus = {
  groupId: string;
  userId: string;
  syncedAt?: string;
};

function newestTimestamp(values: (string | null | undefined)[]) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

/** Uses tracker provenance, never group presence or a viewer render time. */
export function latestMetricSourceTimestamp(entries: SourceStampedEntry[]) {
  return newestTimestamp(
    entries.map((entry) => entry.sourceUpdatedAt ?? entry.recordedAt),
  );
}

/**
 * A member's freshness is independent of the leaderboard period or tracker.
 * Prefer the server-owned membership checkpoint, with the newest published
 * daily-status row as a migration-safe fallback for older cloud schemas.
 */
export function latestMemberActivityPublishedAt(
  statuses: MemberDailyStatus[],
  groupId: string,
  userId: string,
  membershipCheckpoint?: string,
) {
  return newestTimestamp([
    membershipCheckpoint,
    ...statuses
      .filter(
        (status) => status.groupId === groupId && status.userId === userId,
      )
      .map((status) => status.syncedAt),
  ]);
}

/**
 * Only a server-confirmed group publish is valid leaderboard freshness.
 * Measurement time, presence, a viewer's account sync, and render time are
 * deliberately not accepted as fallbacks.
 */
export function leaderboardSyncTimestamp(
  result?: LeaderboardSyncResult,
) {
  return result?.lastSyncedAt;
}
