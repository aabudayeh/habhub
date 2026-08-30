import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadMyChallenges,
  loadPublicChallenges,
  respondToGroupChallenge,
} from "@/src/cloud/groupChallenges";
import { GroupChallenge } from "@/src/types";

export function usePublicChallenges(enabled = true) {
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [joinedChallenges, setJoinedChallenges] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (requestRef.current) return requestRef.current;
    let request: Promise<void>;
    setLoading(true);
    request = Promise.all([loadPublicChallenges(), loadMyChallenges()])
      .then(([publicRows, joinedRows]) => {
        setChallenges(publicRows);
        setJoinedChallenges(joinedRows);
        setError(undefined);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const join = useCallback(
    async (challengeId: string) => {
      await respondToGroupChallenge(challengeId, "accepted");
      await refresh();
    },
    [refresh],
  );

  return { challenges, joinedChallenges, loading, error, refresh, join };
}
