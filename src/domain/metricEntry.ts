/**
 * Client-generated entry ids are unique only within a user. Group activity
 * caches must therefore include the owner whenever they identify an entry.
 */
export function metricEntryKey(userId: string, id: string) {
  return `${userId}:${id}`;
}
