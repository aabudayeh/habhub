import { useEffect, useMemo, useState } from "react";

import {
  type ChallengeViewerStanding,
  loadChallengeViewerStandings,
} from "@/src/cloud/groupChallenges";
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { usePublicChallenges } from "@/src/cloud/usePublicChallenges";
import { useSettledChallengeResults } from "@/src/cloud/useSettledChallengeResults";
import {
  challengeSettlementKey,
  expandGroupChallengeOccurrences,
  groupChallengeEndDate,
  groupChallengeSourceId,
  type ResolvedChallengePlacement,
} from "@/src/domain/groupChallenges";

/** Keeps every badge surface on the same bounded challenge-result inputs. */
export function useBadgeChallengeInputs(
  groupId: string,
  currentUserId: string,
  anchor: string,
  loadPublicPlacements = true,
) {
  const challengeCloud = useGroupChallenges(groupId);
  const settledChallengeResults = useSettledChallengeResults(groupId);
  const publicCloud = usePublicChallenges(loadPublicPlacements);
  const [publicViewerStandings, setPublicViewerStandings] = useState(
    new Map<string, ChallengeViewerStanding>(),
  );
  const [loadedPublicPlacementKey, setLoadedPublicPlacementKey] = useState<
    string | undefined
  >(() => (loadPublicPlacements ? undefined : ""));

  const publicPlacementOccurrences = useMemo(() => {
    if (!loadPublicPlacements) return [];
    const localChallengeIds = new Set(
      challengeCloud.challenges.map(groupChallengeSourceId),
    );
    const sources = publicCloud.joinedChallenges.filter(
      (challenge) =>
        challenge.audience === "public" &&
        !localChallengeIds.has(groupChallengeSourceId(challenge)),
    );
    const earliest = sources.map((challenge) => challenge.localDate).sort()[0];
    return earliest
      ? expandGroupChallengeOccurrences(sources, earliest, anchor, 500).filter(
          (challenge) => groupChallengeEndDate(challenge) < anchor,
        )
      : [];
  }, [
    anchor,
    challengeCloud.challenges,
    loadPublicPlacements,
    publicCloud.joinedChallenges,
  ]);
  const publicPlacementRequests = useMemo(
    () =>
      publicPlacementOccurrences.map((challenge) => ({
        challengeId: groupChallengeSourceId(challenge),
        occurrenceDate: challenge.localDate,
      })),
    [publicPlacementOccurrences],
  );
  const publicPlacementChallengeKey = publicPlacementRequests
    .map((request) =>
      challengeSettlementKey(request.challengeId, request.occurrenceDate),
    )
    .join("|");

  useEffect(() => {
    let active = true;
    if (!publicPlacementRequests.length) {
      setPublicViewerStandings(new Map());
      setLoadedPublicPlacementKey(publicPlacementChallengeKey);
      return () => {
        active = false;
      };
    }
    void loadChallengeViewerStandings(publicPlacementRequests)
      .then((standings) => {
        if (!active) return;
        setPublicViewerStandings(
          new Map(
            standings.map((standing) => [
              challengeSettlementKey(
                standing.challengeId,
                standing.occurrenceDate,
              ),
              standing,
            ]),
          ),
        );
        setLoadedPublicPlacementKey(publicPlacementChallengeKey);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Avoid repeating a bounded server-rank read for catalogue object refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicPlacementChallengeKey]);

  const publicChallengePlacements = useMemo(
    () =>
      publicPlacementOccurrences.flatMap(
        (challenge): ResolvedChallengePlacement[] => {
          const sourceId = groupChallengeSourceId(challenge);
          const standing = publicViewerStandings.get(
            challengeSettlementKey(sourceId, challenge.localDate),
          );
          if (!standing?.standingPosition || standing.competitorCount < 1)
            return [];
          return [
            {
              challengeId: sourceId,
              localDate: standing.occurrenceDate,
              placements: [
                {
                  memberId: currentUserId,
                  standingPosition: standing.standingPosition,
                  competitorCount: standing.competitorCount,
                  value: standing.total,
                  winner: standing.winner,
                },
              ],
            },
          ];
        },
      ),
    [currentUserId, publicPlacementOccurrences, publicViewerStandings],
  );
  const placements = useMemo(
    () => [
      ...(settledChallengeResults.placements ?? []),
      ...publicChallengePlacements,
    ],
    [publicChallengePlacements, settledChallengeResults.placements],
  );
  const initialLoadComplete =
    challengeCloud.initialLoadComplete &&
    !challengeCloud.error &&
    settledChallengeResults.authoritativeLoadComplete &&
    (!loadPublicPlacements ||
      (publicCloud.initialLoadComplete &&
        !publicCloud.error &&
        loadedPublicPlacementKey === publicPlacementChallengeKey));

  return {
    challenges: challengeCloud.challenges,
    placements,
    settledOccurrenceKeys: settledChallengeResults.occurrenceKeys,
    initialLoadComplete,
  };
}
