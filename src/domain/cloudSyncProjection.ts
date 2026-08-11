type CloudDailyStatusIdentity = {
  group_id: string;
  metric_id: string | undefined;
  user_id: string;
  local_date: string;
};

function cloudDailyStatusRowKey(row: CloudDailyStatusIdentity) {
  return [row.group_id, row.metric_id, row.user_id, row.local_date].join(":");
}

/**
 * A workspace publication writes its recent leaderboard window first. Keep a
 * later historical pass from updating those identical rows a second time.
 */
export function excludeAlreadyPublishedDailyStatusRows<
  T extends CloudDailyStatusIdentity,
>(published: T[], candidates: T[]) {
  const publishedKeys = new Set(published.map(cloudDailyStatusRowKey));
  return candidates.filter(
    (candidate) => !publishedKeys.has(cloudDailyStatusRowKey(candidate)),
  );
}
