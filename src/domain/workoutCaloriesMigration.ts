import type { MetricEntry } from "@/src/types";

export const RETIRED_WORKOUT_CALORIES_METRIC_ID = "workout_calories";

function activeEnergyAlreadyContainsWorkoutCalories(
  entries: readonly MetricEntry[],
  workoutCalories: MetricEntry,
) {
  const normalizedLabel = (value: string | undefined) =>
    String(value ?? "")
      .trim()
      .toLocaleLowerCase();
  const workoutTime = new Date(workoutCalories.recordedAt).getTime();
  const workoutValue = Number(workoutCalories.value || 0);
  return entries.some((candidate) => {
    if (
      candidate.metricId !== "exercise" ||
      candidate.userId !== workoutCalories.userId ||
      candidate.localDate !== workoutCalories.localDate
    )
      return false;
    const pairedId = workoutCalories.id.endsWith(":workout_calories")
      ? workoutCalories.id.slice(0, -"workout_calories".length) + "exercise"
      : undefined;
    if (pairedId && candidate.id === pairedId) return true;
    if (
      candidate.sourceProvider === workoutCalories.sourceProvider &&
      candidate.sourceRecordId &&
      candidate.sourceRecordId === workoutCalories.sourceRecordId
    )
      return true;
    const candidateTime = new Date(candidate.recordedAt).getTime();
    const candidateValue = Number(candidate.value || 0);
    const label = normalizedLabel(workoutCalories.label);
    return (
      label.length > 0 &&
      label === normalizedLabel(candidate.label) &&
      Number.isFinite(workoutTime) &&
      Number.isFinite(candidateTime) &&
      Math.abs(workoutTime - candidateTime) <= 15 * 60_000 &&
      Number.isFinite(workoutValue) &&
      Number.isFinite(candidateValue) &&
      Math.abs(workoutValue - candidateValue) <=
        Math.max(2, Math.abs(workoutValue) * 0.08)
    );
  });
}

function migratedActiveEnergyEntry(entry: MetricEntry): MetricEntry {
  const gymId =
    entry.id.startsWith("gym-sync:") &&
    entry.id.endsWith(":workout_calories")
    ? entry.id.slice(0, -"workout_calories".length) + "exercise"
    : undefined;
  const importedId =
    entry.sourceProvider && entry.sourceRecordId
      ? `health:${entry.sourceProvider}:workouts:${entry.sourceRecordId}:exercise:workout-energy`
      : undefined;
  return {
    ...entry,
    id:
      gymId ??
      importedId ??
      `retired-workout-calories:${entry.id}:exercise`,
    metricId: "exercise",
    note: [
      entry.note,
      "Migrated from the retired Workout calories tracker.",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Pure entry portion of the Workout-calories retirement migration. Existing
 * visibility/provenance are retained, existing Active-energy mirrors are not
 * duplicated, and an explicit Active-energy deletion remains authoritative.
 */
export function migrateRetiredWorkoutCaloriesEntries(
  entries: readonly MetricEntry[],
  currentUserId: string,
  priorDeletedEntryIds: readonly string[] = [],
) {
  const retiredEntries = entries.filter(
    (entry) => entry.metricId === RETIRED_WORKOUT_CALORIES_METRIC_ID,
  );
  const priorEntryDeletions = new Set(priorDeletedEntryIds);
  const migratedEntries = retiredEntries
    .filter(
      (entry) =>
        !priorEntryDeletions.has(entry.id) &&
        Number(entry.value || 0) > 0 &&
        !activeEnergyAlreadyContainsWorkoutCalories(entries, entry),
    )
    .map(migratedActiveEnergyEntry)
    .filter((entry) => !priorEntryDeletions.has(entry.id));
  const byIdentity = new Map(
    entries
      .filter(
        (entry) =>
          entry.metricId !== RETIRED_WORKOUT_CALORIES_METRIC_ID,
      )
      .map((entry) => [`${entry.userId}\u0000${entry.id}`, entry]),
  );
  for (const entry of migratedEntries)
    byIdentity.set(`${entry.userId}\u0000${entry.id}`, entry);
  return {
    entries: [...byIdentity.values()],
    removedOwnEntryIds: retiredEntries
      .filter((entry) => entry.userId === currentUserId)
      .map((entry) => entry.id),
  };
}
