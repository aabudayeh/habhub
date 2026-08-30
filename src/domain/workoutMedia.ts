import { stepCoverageGymSessionId } from "@/src/domain/stepCoveragePreferences";
import { MetricEntry } from "@/src/types";

export function linkedGymWorkoutMediaSessionId(
  entry: Pick<MetricEntry, "id" | "metricId">,
) {
  if (entry.metricId !== "workout" && entry.metricId !== "exercise")
    return undefined;
  return stepCoverageGymSessionId(entry.id);
}

/**
 * Give each independently-authorized workout projection its own reference to
 * the one stored photo. Visibility remains untouched, so cloud RLS can expose
 * Workout and Active energy separately without relying on a private sibling.
 */
export function reconcileLinkedGymWorkoutMedia(
  entries: MetricEntry[],
  ownerId: string,
) {
  const mediaBySession = new Map<
    string,
    Pick<MetricEntry, "imageUri" | "imageStoragePath">
  >();
  for (const entry of entries) {
    const sessionId = linkedGymWorkoutMediaSessionId(entry);
    if (
      entry.userId !== ownerId ||
      !sessionId ||
      (!entry.imageUri && !entry.imageStoragePath)
    )
      continue;
    const previous = mediaBySession.get(sessionId);
    // A durable storage path is authoritative. Keep its URI/path pair together
    // rather than accidentally combining a newly selected local URI with an
    // older sibling's storage path during recovery from an interrupted upload.
    if (!previous || (!previous.imageStoragePath && entry.imageStoragePath))
      mediaBySession.set(sessionId, {
        imageUri: entry.imageUri,
        imageStoragePath: entry.imageStoragePath,
      });
  }
  return entries.map((entry) => {
    const sessionId = linkedGymWorkoutMediaSessionId(entry);
    const media = sessionId ? mediaBySession.get(sessionId) : undefined;
    if (
      entry.userId !== ownerId ||
      !media ||
      (entry.imageUri === media.imageUri &&
        entry.imageStoragePath === media.imageStoragePath)
    )
      return entry;
    return {
      ...entry,
      imageUri: media.imageUri,
      imageStoragePath: media.imageStoragePath,
    };
  });
}
