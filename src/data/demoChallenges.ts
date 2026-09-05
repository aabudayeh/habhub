import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { GroupChallenge } from "@/src/types";

export const DEFAULT_DEMO_GROUP_ID = "weekend-warriors";

const DEMO_MEMBER_IDS = ["ahmad", "sarah", "daniel", "maya"];

function timestamp(localDate: string, time = "12:00") {
  return `${localDate}T${time}:00.000Z`;
}

/**
 * A date-relative, credential-free showcase of the same challenge model used by
 * cloud groups. It stays outside persisted account state so demo actions cannot
 * leak into a signed-in workspace.
 */
export function createDefaultDemoChallenges(
  anchorDate = dateKey(),
): GroupChallenge[] {
  const activeStart = dateWithOffsetFrom(anchorDate, -3);
  const activeEnd = dateWithOffsetFrom(anchorDate, 3);
  const exerciseStart = dateWithOffsetFrom(anchorDate, -1);
  const exerciseEnd = dateWithOffsetFrom(anchorDate, 5);
  const hydrationStart = dateWithOffsetFrom(anchorDate, -2);
  const hydrationEnd = dateWithOffsetFrom(anchorDate, 4);
  const finishedStart = dateWithOffsetFrom(anchorDate, -13);
  const finishedEnd = dateWithOffsetFrom(anchorDate, -7);

  return [
    {
      id: "demo-challenge-step-showdown",
      groupId: DEFAULT_DEMO_GROUP_ID,
      creatorId: "maya",
      metricId: "steps",
      title: "7-day step showdown",
      visualIcon: "walk-outline",
      target: 70_000,
      localDate: activeStart,
      endDate: activeEnd,
      participantIds: [...DEMO_MEMBER_IDS],
      acceptedParticipantIds: [...DEMO_MEMBER_IDS],
      declinedParticipantIds: [],
      createdAt: timestamp(dateWithOffsetFrom(activeStart, -2), "18:30"),
      updatedAt: timestamp(anchorDate, "09:15"),
    },
    {
      id: "demo-challenge-exercise-sprint",
      groupId: DEFAULT_DEMO_GROUP_ID,
      creatorId: "ahmad",
      metricId: "exercise",
      title: "Exercise energy sprint",
      visualIcon: "fitness-outline",
      target: 1_800,
      localDate: exerciseStart,
      endDate: exerciseEnd,
      participantIds: [...DEMO_MEMBER_IDS],
      acceptedParticipantIds: ["ahmad", "sarah", "maya"],
      declinedParticipantIds: [],
      createdAt: timestamp(dateWithOffsetFrom(exerciseStart, -2), "08:20"),
      updatedAt: timestamp(anchorDate, "08:45"),
    },
    {
      id: "demo-challenge-hydration",
      groupId: DEFAULT_DEMO_GROUP_ID,
      creatorId: "sarah",
      metricId: "water",
      title: "Hydration streak",
      visualIcon: "nutrition-outline",
      target: 17.5,
      localDate: hydrationStart,
      endDate: hydrationEnd,
      participantIds: [...DEMO_MEMBER_IDS],
      // Ahmad sees a realistic pending invite in the local showcase and can
      // safely practice accepting or declining without touching the cloud.
      acceptedParticipantIds: ["sarah", "maya"],
      declinedParticipantIds: [],
      createdAt: timestamp(dateWithOffsetFrom(hydrationStart, -2), "17:40"),
      updatedAt: timestamp(anchorDate, "07:55"),
    },
    {
      id: "demo-challenge-strong-start",
      groupId: DEFAULT_DEMO_GROUP_ID,
      creatorId: "daniel",
      metricId: "exercise",
      title: "Strong start week",
      visualIcon: "fitness-outline",
      target: 2_100,
      localDate: finishedStart,
      endDate: finishedEnd,
      participantIds: [...DEMO_MEMBER_IDS],
      acceptedParticipantIds: [...DEMO_MEMBER_IDS],
      declinedParticipantIds: [],
      createdAt: timestamp(dateWithOffsetFrom(finishedStart, -3), "19:10"),
      updatedAt: timestamp(finishedEnd, "23:10"),
    },
  ];
}

let demoChallenges = createDefaultDemoChallenges();
const listeners = new Set<(challenges: GroupChallenge[]) => void>();

export function readDefaultDemoChallenges() {
  return demoChallenges;
}

export function updateDefaultDemoChallenges(
  update: (current: GroupChallenge[]) => GroupChallenge[],
) {
  demoChallenges = update(demoChallenges);
  for (const listener of listeners) listener(demoChallenges);
  return demoChallenges;
}

export function subscribeDefaultDemoChallenges(
  listener: (challenges: GroupChallenge[]) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
