import type { AppState } from "@/src/types";

type OwnedAccountCollections = Pick<
  AppState,
  "entries" | "photos" | "messages" | "dailyMetricStatuses"
>;

type RowOwner<T> = (row: T) => string;

/**
 * AppState is immutable, but cloud/realtime updates often replace only the
 * outer state object. Cache the account-owned view by collection identity so a
 * settings or group-shell update does not rescan years of local history.
 *
 * The account id remains part of the cache key. Reusing an array across an
 * account transition therefore cannot expose another account's rows.
 */
function createOwnedRowsSelector<T>(owner: RowOwner<T>) {
  const cache = new WeakMap<readonly T[], Map<string, readonly T[]>>();
  return (rows: readonly T[], accountId: string): readonly T[] => {
    const byAccount = cache.get(rows);
    const cached = byAccount?.get(accountId);
    if (cached) return cached;

    let selected: T[] | null = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (owner(row) === accountId) {
        if (selected) selected.push(row);
        continue;
      }
      // Preserve the original array (and avoid an allocation) while every row
      // belongs to this account. Allocate only at the first excluded row.
      selected ??= rows.slice(0, index) as T[];
    }
    const result = selected ?? rows;
    const nextByAccount = byAccount ?? new Map<string, readonly T[]>();
    nextByAccount.set(accountId, result);
    if (!byAccount) cache.set(rows, nextByAccount);
    return result;
  };
}

const accountEntries = createOwnedRowsSelector<AppState["entries"][number]>(
  (entry) => entry.userId,
);
const accountPhotos = createOwnedRowsSelector<AppState["photos"][number]>(
  (photo) => photo.userId,
);
const accountMessages = createOwnedRowsSelector<AppState["messages"][number]>(
  (message) => message.senderId,
);
const accountDailyStatuses = createOwnedRowsSelector<
  AppState["dailyMetricStatuses"][number]
>((status) => status.userId);

export function accountOwnedCollections(
  state: AppState,
): OwnedAccountCollections {
  const accountId = state.currentUserId;
  return {
    entries: accountEntries(state.entries, accountId) as AppState["entries"],
    photos: accountPhotos(state.photos, accountId) as AppState["photos"],
    messages: accountMessages(
      state.messages,
      accountId,
    ) as AppState["messages"],
    dailyMetricStatuses: accountDailyStatuses(
      state.dailyMetricStatuses,
      accountId,
    ) as AppState["dailyMetricStatuses"],
  };
}
