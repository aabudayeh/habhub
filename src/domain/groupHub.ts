import type { GroupHubAction } from "@/src/types";

export const DEFAULT_GROUP_HUB_ACTION_ORDER: readonly GroupHubAction[] = [
  "notifications",
  "recap",
  "challenges",
  "schedule",
  "notes",
];

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Persists an all-day date at noon UTC. The date portion therefore survives
 * display in every supported timezone instead of drifting across midnight.
 */
export function canonicalGroupScheduleAllDayInstant(value: string) {
  const match = value.trim().match(CALENDAR_DATE_PATTERN);
  if (!match) return;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  return date.toISOString();
}

/** Reads the semantic date of a canonical or legacy all-day timestamp. */
export function groupScheduleAllDayDateKey(startsAt: string) {
  const candidate = startsAt.slice(0, 10);
  return canonicalGroupScheduleAllDayInstant(candidate) ? candidate : undefined;
}

export function normalizeGroupHubActionOrder(
  order: readonly string[] | undefined,
): GroupHubAction[] {
  const allowed = new Set<string>(DEFAULT_GROUP_HUB_ACTION_ORDER);
  const result = [...new Set((order ?? []).filter((item) => allowed.has(item)))] as GroupHubAction[];
  for (const action of DEFAULT_GROUP_HUB_ACTION_ORDER)
    if (!result.includes(action)) result.push(action);
  return result;
}

export function visibleGroupHubActions(
  order: readonly string[] | undefined,
  options: {
    challenges: boolean;
    schedule: boolean;
    notes: boolean;
  },
) {
  return normalizeGroupHubActionOrder(order).filter((action) => {
    if (action === "challenges") return options.challenges;
    if (action === "schedule") return options.schedule;
    if (action === "notes") return options.notes;
    return true;
  });
}

export function moveGroupHubAction(
  order: readonly string[] | undefined,
  action: GroupHubAction,
  direction: -1 | 1,
) {
  const next = normalizeGroupHubActionOrder(order);
  const index = next.indexOf(action);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
