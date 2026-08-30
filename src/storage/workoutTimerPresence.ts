import AsyncStorage from "@react-native-async-storage/async-storage";

import { storedWorkoutDraftHasActiveTimer } from "@/src/domain/workoutTimerPresence";

type WorkoutTimerPresence = {
  userId?: string;
  active: boolean;
};

let presence: WorkoutTimerPresence = { active: false };
let presenceRevision = 0;
const listeners = new Set<() => void>();

export const workoutDraftKey = (userId: string) =>
  `habhub-active-gym-workout-v2:${userId}`;

/**
 * Web image pickers return an embedded data URI. Keep that large payload out of
 * the frequently-mutated workout draft JSON so timer/set edits only rewrite the
 * small draft document. The session-scoped key is also safe to replace when the
 * user chooses a different photo for the same active workout.
 */
export const workoutDraftImageKey = (userId: string, sessionId: string) =>
  `habhub-active-gym-workout-image-v1:${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;

export function setWorkoutTimerPresence(userId: string, active: boolean) {
  if (presence.userId === userId && presence.active === active) return;
  presence = { userId, active };
  presenceRevision += 1;
  listeners.forEach((listener) => listener());
}

export function workoutTimerPresenceFor(userId: string) {
  return presence.userId === userId && presence.active;
}

export function subscribeWorkoutTimerPresence(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readWorkoutTimerPresence(userId: string) {
  const raw = await AsyncStorage.getItem(workoutDraftKey(userId)).catch(
    () => null,
  );
  return storedWorkoutDraftHasActiveTimer(raw);
}

export async function hydrateWorkoutTimerPresence(userId: string) {
  const revision = presenceRevision;
  const active = await readWorkoutTimerPresence(userId);
  // A mounted Workout screen is newer than this disk read and owns the dot.
  if (
    revision === presenceRevision &&
    (!presence.userId || presence.userId === userId)
  )
    setWorkoutTimerPresence(userId, active);
  return active;
}
