import type { MetricEntry } from "@/src/types";
import { hasHealthImportIdentity } from "@/src/domain/healthDedup";

export const RETIRED_WORKOUT_CALORIES_METRIC_ID = "workout_calories";
const RETIRED_WORKOUT_CALORIES_NOTE =
  "Migrated from the retired Workout calories tracker.";

function normalizedWorkoutLabel(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function activeEnergyRowsRepresentSameWorkout(
  candidate: MetricEntry,
  workoutCalories: MetricEntry,
) {
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
  const workoutTime = new Date(workoutCalories.recordedAt).getTime();
  const candidateTime = new Date(candidate.recordedAt).getTime();
  const workoutValue = Number(workoutCalories.value || 0);
  const candidateValue = Number(candidate.value || 0);
  const label = normalizedWorkoutLabel(workoutCalories.label);
  return (
    label.length > 0 &&
    label === normalizedWorkoutLabel(candidate.label) &&
    Number.isFinite(workoutTime) &&
    Number.isFinite(candidateTime) &&
    Math.abs(workoutTime - candidateTime) <= 15 * 60_000 &&
    Number.isFinite(workoutValue) &&
    Number.isFinite(candidateValue) &&
    Math.abs(workoutValue - candidateValue) <=
      Math.max(2, Math.abs(workoutValue) * 0.08)
  );
}

function activeEnergyAlreadyContainsWorkoutCalories(
  entries: readonly MetricEntry[],
  workoutCalories: MetricEntry,
) {
  return entries.some((candidate) =>
    activeEnergyRowsRepresentSameWorkout(candidate, workoutCalories),
  );
}

function isRetiredWorkoutCaloriesProjection(entry: MetricEntry) {
  return (
    entry.metricId === "exercise" &&
    entry.id.startsWith("retired-workout-calories:") &&
    entry.note?.includes(RETIRED_WORKOUT_CALORIES_NOTE) === true
  );
}

/**
 * A history repair can import a provider-owned workout after the legacy
 * Workout-calories row was already migrated to Active energy. Reconcile only
 * that explicitly marked migration row, and only against a strongly matching
 * health-owned replacement. Ordinary manual entries are never candidates.
 */
function reconcileLateWorkoutCaloriesReplacements(
  entries: readonly MetricEntry[],
  currentUserId: string,
) {
  const migratedRows = entries.filter(
    (entry) =>
      entry.userId === currentUserId &&
      isRetiredWorkoutCaloriesProjection(entry),
  );
  if (!migratedRows.length)
    return { entries: [...entries], removedEntryIds: [] as string[] };
  const migratedSet = new Set(migratedRows);
  const healthOwnedRows = entries.filter(
    (entry) =>
      entry.metricId === "exercise" &&
      !migratedSet.has(entry) &&
      hasHealthImportIdentity(entry),
  );
  const duplicateRows = new Set(
    migratedRows.filter((migrated) =>
      healthOwnedRows.some((replacement) =>
        activeEnergyRowsRepresentSameWorkout(replacement, migrated),
      ),
    ),
  );
  return {
    entries: entries.filter((entry) => !duplicateRows.has(entry)),
    removedEntryIds: [...duplicateRows].map((entry) => entry.id),
  };
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
      RETIRED_WORKOUT_CALORIES_NOTE,
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
  const reconciled = reconcileLateWorkoutCaloriesReplacements(
    [...byIdentity.values()],
    currentUserId,
  );
  return {
    entries: reconciled.entries,
    removedOwnEntryIds: retiredEntries
      .filter((entry) => entry.userId === currentUserId)
      .map((entry) => entry.id)
      .concat(
        reconciled.removedEntryIds.filter((id) =>
          entries.some(
            (entry) => entry.id === id && entry.userId === currentUserId,
          ),
        ),
      ),
  };
}
