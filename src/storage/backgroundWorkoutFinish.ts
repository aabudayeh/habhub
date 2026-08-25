import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  finishStoredWorkoutDraft,
  parseStoredWorkoutDraft,
  reconcileBackgroundWorkoutCompletion,
  replayStoredWorkoutActions,
  validBackgroundWorkoutCompletion,
  type BackgroundWorkoutCompletion,
  type NativeWorkoutActionReceipt,
} from "@/src/domain/backgroundWorkoutFinish";
import {
  getAppStateStorageItem,
  multiSetAppStateStorage,
} from "@/src/storage/appStateStorage";
import {
  APP_STORAGE_KEY,
  appAccountStorageKey,
} from "@/src/storage/appStateKeys";
import { runAppStateStorageMutation } from "@/src/storage/appStateMutation";
import { workoutDraftKey } from "@/src/storage/workoutTimerPresence";
import type { AppState } from "@/src/types";

const BACKGROUND_WORKOUT_COMPLETION_KEY_PREFIX =
  "habhub-background-workout-completion-v1:";

export function backgroundWorkoutCompletionKey(ownerId: string) {
  return `${BACKGROUND_WORKOUT_COMPLETION_KEY_PREFIX}${ownerId}`;
}

export async function readBackgroundWorkoutCompletion(ownerId: string) {
  const raw = await AsyncStorage.getItem(
    backgroundWorkoutCompletionKey(ownerId),
  ).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validBackgroundWorkoutCompletion(parsed, ownerId) ? parsed : null;
  } catch {
    return null;
  }
}

/** Caller must already own the app-state mutation gate. */
export async function removeBackgroundWorkoutCompletionExactUnlocked(
  ownerId: string,
  generation: string,
  occurredAt: number,
) {
  const key = backgroundWorkoutCompletionKey(ownerId);
  const existing = await readBackgroundWorkoutCompletion(ownerId);
  if (!sameFinish(existing, ownerId, generation, occurredAt)) return false;
  await AsyncStorage.removeItem(key);
  return true;
}

/**
 * Retire only when both recovery boundaries independently prove that replay is
 * no longer needed (exact session present or a later same-session edit/delete
 * superseded it). A crash before this compare-and-remove simply leaves the
 * receipt available for the next hydration.
 */
export function retireBackgroundWorkoutCompletionIfResolved(ownerId: string) {
  return runAppStateStorageMutation(async () => {
    const completion = await readBackgroundWorkoutCompletion(ownerId);
    if (!completion) return false;
    const [legacyRaw, accountRaw] = await Promise.all([
      getAppStateStorageItem(APP_STORAGE_KEY),
      getAppStateStorageItem(appAccountStorageKey(ownerId)),
    ]);
    const snapshots = [parseAppState(legacyRaw), parseAppState(accountRaw)];
    if (
      snapshots.some(
        (snapshot) =>
          snapshot?.currentUserId !== ownerId ||
          reconcileBackgroundWorkoutCompletion(snapshot, completion)
            .resolution === "applied",
      )
    )
      return false;
    return removeBackgroundWorkoutCompletionExactUnlocked(
      ownerId,
      completion.generation,
      completion.occurredAt,
    );
  });
}

function parseAppState(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

function sameFinish(
  completion: BackgroundWorkoutCompletion | null,
  ownerId: string,
  generation: string,
  occurredAt: number,
) {
  return Boolean(
    completion &&
      completion.ownerId === ownerId &&
      completion.generation === generation &&
      completion.occurredAt === occurredAt,
  );
}

/**
 * Durably logs a native Finish action before acknowledging its native queue
 * receipt. The account snapshot and recovery receipt make retries idempotent;
 * the latter also lets a still-alive AppProvider merge the headless change on
 * resume instead of overwriting it with an older in-memory snapshot.
 */
export function persistBackgroundWorkoutFinish({
  ownerId,
  generation,
  actions,
}: {
  ownerId: string;
  generation: string;
  actions: readonly NativeWorkoutActionReceipt[];
}) {
  return runAppStateStorageMutation(async () => {
    const legacySnapshot = await getAppStateStorageItem(APP_STORAGE_KEY);
    const activeState = parseAppState(legacySnapshot);
    // A headless Finish can resume after sign-out or an account switch. Require
    // an exact active-owner pointer; absent/malformed/foreign state leaves the
    // old owner's draft and native receipt untouched for an owner-scoped retry.
    if (activeState?.currentUserId !== ownerId) return null;

    const matching = actions.filter(
      (action) =>
        action.ownerId === ownerId &&
        action.generation === generation &&
        Number.isFinite(action.occurredAt),
    );
    const finishIndex = matching.findIndex(
      (action) => action.action === "workout-finish",
    );
    if (finishIndex < 0) return null;
    const throughFinish = matching.slice(0, finishIndex + 1);
    const finish = throughFinish[throughFinish.length - 1];
    const existingCompletion = await readBackgroundWorkoutCompletion(ownerId);
    const accountKey = appAccountStorageKey(ownerId);
    const state = activeState;
    if (!state) return null;
    const retryCompletion = sameFinish(
      existingCompletion,
      ownerId,
      generation,
      finish.occurredAt,
    )
      ? existingCompletion
      : null;
    let completion: BackgroundWorkoutCompletion;
    if (retryCompletion) {
      completion = retryCompletion;
    } else {
      const rawDraft = await AsyncStorage.getItem(workoutDraftKey(ownerId));
      const draft = parseStoredWorkoutDraft(rawDraft);
      if (!draft) return null;
      const replayedDraft = replayStoredWorkoutActions(draft, throughFinish);
      const session = finishStoredWorkoutDraft(
        replayedDraft,
        state,
        finish.occurredAt,
      );
      completion = {
        ownerId,
        generation,
        occurredAt: finish.occurredAt,
        baseSession:
          (state.gymSessions ?? []).find(
            (item) =>
              item.id === session.id && item.userId === state.currentUserId,
          ) ?? null,
        session,
      };
    }
    const reconciled = reconcileBackgroundWorkoutCompletion(state, completion);
    const nextState = {
      ...reconciled.state,
      lastSavedAt: new Date().toISOString(),
    };
    const serializedCompletion = JSON.stringify(completion);
    const serializedState = JSON.stringify(nextState);

    // Recovery receipt first: if Android suspends the task during either large
    // snapshot write, hydration can still replay this exact account-owned save.
    if (!retryCompletion)
      await AsyncStorage.setItem(
        backgroundWorkoutCompletionKey(ownerId),
        serializedCompletion,
      );
    await multiSetAppStateStorage([
      [APP_STORAGE_KEY, serializedState],
      [accountKey, serializedState],
    ]);
    await AsyncStorage.removeItem(workoutDraftKey(ownerId));
    return completion;
  });
}
