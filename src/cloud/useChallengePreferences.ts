import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type ChallengeUserPreference,
  loadChallengeUserPreferences,
  saveChallengeUserPreference,
  withdrawFromGroupChallenge,
} from "@/src/cloud/groupChallenges";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { DEFAULT_DEMO_GROUP_ID } from "@/src/data/demoChallenges";

const cacheByUser = new Map<string, Map<string, ChallengeUserPreference>>();
const listenersByUser = new Map<
  string,
  Set<(preferences: Map<string, ChallengeUserPreference>) => void>
>();

function publish(
  userId: string,
  preferences: Map<string, ChallengeUserPreference>,
) {
  cacheByUser.set(userId, preferences);
  for (const listener of listenersByUser.get(userId) ?? [])
    listener(new Map(preferences));
}

/** Account-owned challenge presentation choices. Health values and challenge
 * rosters remain governed by their existing server-side access rules. */
export function useChallengePreferences() {
  const { state } = useApp();
  const tutorial = useTutorialSandboxActive();
  const userId = state.currentUserId;
  const localDemo = state.group.id === DEFAULT_DEMO_GROUP_ID;
  const [preferences, setPreferences] = useState(
    () => new Map(cacheByUser.get(userId) ?? []),
  );

  useEffect(() => {
    const listeners = listenersByUser.get(userId) ?? new Set();
    listeners.add(setPreferences);
    listenersByUser.set(userId, listeners);
    setPreferences(new Map(cacheByUser.get(userId) ?? []));
    return () => {
      listeners.delete(setPreferences);
      if (!listeners.size) listenersByUser.delete(userId);
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (tutorial || localDemo || !supabase) return;
    const rows = await loadChallengeUserPreferences();
    publish(userId, new Map(rows.map((row) => [row.challengeId, row])));
  }, [localDemo, tutorial, userId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const save = useCallback(
    async (
      challengeId: string,
      changes: Partial<Pick<ChallengeUserPreference, "hidden" | "pinned">>,
    ) => {
      const current = cacheByUser.get(userId)?.get(challengeId);
      const input = {
        hidden: changes.hidden ?? current?.hidden ?? false,
        pinned: changes.pinned ?? current?.pinned ?? false,
      };
      const saved =
        tutorial || localDemo || !supabase
          ? {
              challengeId,
              userId,
              ...input,
              withdrawnAt: current?.withdrawnAt,
              updatedAt: new Date().toISOString(),
            }
          : await saveChallengeUserPreference(challengeId, input);
      const next = new Map(cacheByUser.get(userId) ?? []);
      next.set(challengeId, saved);
      publish(userId, next);
      return saved;
    },
    [localDemo, tutorial, userId],
  );

  const withdraw = useCallback(
    async (challengeId: string) => {
      const current = cacheByUser.get(userId)?.get(challengeId);
      const saved =
        tutorial || localDemo || !supabase
          ? {
              challengeId,
              userId,
              hidden: true,
              pinned: false,
              withdrawnAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : await withdrawFromGroupChallenge(challengeId);
      const next = new Map(cacheByUser.get(userId) ?? []);
      next.set(challengeId, { ...current, ...saved });
      publish(userId, next);
      return saved;
    },
    [localDemo, tutorial, userId],
  );

  return useMemo(
    () => ({ preferences, refresh, save, withdraw }),
    [preferences, refresh, save, withdraw],
  );
}
