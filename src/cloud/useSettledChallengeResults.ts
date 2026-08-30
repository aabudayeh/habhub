import { useEffect, useMemo, useRef, useState } from "react";

import { loadGroupChallengeResultPlacements } from "@/src/cloud/groupChallenges";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { useGroupNotificationEvents } from "@/src/cloud/useGroupNotificationEvents";
import { challengeSettlementKey } from "@/src/domain/groupChallenges";
import type { ResolvedChallengePlacement } from "@/src/domain/groupChallenges";

/**
 * Undefined means the local/demo challenge model may resolve synchronously.
 * A cloud group returns an array (including an empty one) so consumers cannot
 * mistake an unsettled challenge for a final result.
 */
export function useSettledChallengeResults(groupId: string) {
  const notifications = useGroupNotificationEvents(groupId);
  const [placements, setPlacements] = useState<ResolvedChallengePlacement[]>(
    [],
  );
  const [loading, setLoading] = useState(() => isCloudGroupId(groupId));
  const [initiallyLoadedGroupId, setInitiallyLoadedGroupId] = useState<
    string | undefined
  >(() => (isCloudGroupId(groupId) ? undefined : groupId));
  const [authoritativelyLoadedGroupId, setAuthoritativelyLoadedGroupId] =
    useState<string | undefined>(() =>
      isCloudGroupId(groupId) ? undefined : groupId,
    );
  const groupRef = useRef(groupId);
  groupRef.current = groupId;
  const newestResultEvent = notifications.allEvents.find(
    (event) => event.kind === "challenge_result",
  )?.id;

  useEffect(() => {
    if (!isCloudGroupId(groupId)) {
      setPlacements([]);
      setLoading(false);
      setInitiallyLoadedGroupId(groupId);
      setAuthoritativelyLoadedGroupId(groupId);
      return;
    }
    let active = true;
    setLoading(true);
    void loadGroupChallengeResultPlacements(groupId)
      .then((rows) => {
        if (active && groupRef.current === groupId) {
          setPlacements(rows);
          setAuthoritativelyLoadedGroupId(groupId);
        }
      })
      .catch(() => {
        // Keep the last immutable snapshot during a transient network failure.
      })
      .finally(() => {
        if (active && groupRef.current === groupId) {
          setLoading(false);
          setInitiallyLoadedGroupId(groupId);
        }
      });
    return () => {
      active = false;
    };
  }, [groupId, newestResultEvent]);

  const occurrenceKeys = useMemo(
    () =>
      isCloudGroupId(groupId)
        ? placements.map((result) =>
            challengeSettlementKey(result.challengeId, result.localDate),
          )
        : undefined,
    [groupId, placements],
  );
  return {
    placements: isCloudGroupId(groupId) ? placements : undefined,
    occurrenceKeys,
    loading,
    initialLoadComplete: initiallyLoadedGroupId === groupId,
    authoritativeLoadComplete: authoritativelyLoadedGroupId === groupId,
  };
}

export function useSettledChallengeOccurrenceKeys(groupId: string) {
  return useSettledChallengeResults(groupId).occurrenceKeys;
}
