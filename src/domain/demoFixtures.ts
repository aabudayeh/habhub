import type { AppState } from "@/src/types";

type IdentifiedFixture = { id: string };

const DEFAULT_DEMO_ENTRY_ID = new RegExp(
  "^\\d{4}-\\d{2}-\\d{2}-(?:ahmad|sarah|daniel|maya)-" +
    "(?:steps|food|exercise|water|workout|protein|fat|carbs|fiber|sodium|weight|body-fat|lean-mass)$",
);
const DEFAULT_DEMO_PHOTO_ID =
  /^demo-photo-(?:ahmad|sarah|daniel|maya)-\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DEMO_MESSAGE_IDS = new Set([
  "welcome",
  "sarah-message",
  "lead-change",
  "daniel-message",
]);

function replaceDemoStatuses(
  restored: AppState["dailyMetricStatuses"] | undefined,
  defaults: AppState["dailyMetricStatuses"] | undefined,
) {
  const defaultStatuses = [...(defaults ?? [])];
  const fixtureKeys = new Set(
    defaultStatuses.map((status) =>
      [status.groupId, status.metricId, status.userId, status.localDate].join("|"),
    ),
  );
  return [
    ...(restored ?? []).filter(
      (status) =>
        !fixtureKeys.has(
          [status.groupId, status.metricId, status.userId, status.localDate].join(
            "|",
          ),
        ),
    ),
    ...defaultStatuses,
  ];
}

function replaceKnownFixtures<T extends IdentifiedFixture>(
  restored: readonly T[] | undefined,
  defaults: readonly T[] | undefined,
  isKnownLegacyFixtureId: (id: string) => boolean,
) {
  const defaultFixtures = [...(defaults ?? [])];
  const currentFixtureIds = new Set(defaultFixtures.map((item) => item.id));
  return [
    ...(restored ?? []).filter(
      (item) =>
        !currentFixtureIds.has(item.id) &&
        !isKnownLegacyFixtureId(item.id),
    ),
    ...defaultFixtures,
  ];
}

/**
 * Refreshes only records owned by the built-in credential-free demo fixture.
 * User-created records use unrelated generated ids and always survive. The
 * explicit legacy matchers also retire rolling-date fixtures from older app
 * versions, whose ids cannot appear in today's freshly generated defaults.
 */
export function refreshDefaultDemoFixtures(
  restored: AppState,
  defaults: AppState,
) {
  const currentUserId = restored.currentUserId ?? defaults.currentUserId;
  const restoredProfiles = restored.energyProfiles ?? {};
  const restoredCurrentProfile =
    restored.settings?.energyProfile ?? restoredProfiles[currentUserId];

  return {
    entries: replaceKnownFixtures(
      restored.entries,
      defaults.entries,
      (id) => DEFAULT_DEMO_ENTRY_ID.test(id),
    ),
    photos: replaceKnownFixtures(
      restored.photos,
      defaults.photos,
      (id) => DEFAULT_DEMO_PHOTO_ID.test(id),
    ),
    todos: replaceKnownFixtures(
      restored.todos,
      defaults.todos,
      (id) => id.startsWith("demo-todo-"),
    ),
    journalNotes: replaceKnownFixtures(
      restored.journalNotes,
      defaults.journalNotes,
      (id) => id.startsWith("demo-journal-"),
    ),
    calendarReminders: replaceKnownFixtures(
      restored.calendarReminders,
      defaults.calendarReminders,
      (id) => id.startsWith("demo-reminder-"),
    ),
    gymPlans: replaceKnownFixtures(
      restored.gymPlans,
      defaults.gymPlans,
      (id) => id.startsWith("demo-plan-"),
    ),
    gymSessions: replaceKnownFixtures(
      restored.gymSessions,
      defaults.gymSessions,
      (id) => id.startsWith("demo-session-"),
    ),
    messages: replaceKnownFixtures(
      restored.messages,
      defaults.messages,
      (id) => DEFAULT_DEMO_MESSAGE_IDS.has(id),
    ),
    dailyMetricStatuses: replaceDemoStatuses(
      restored.dailyMetricStatuses,
      defaults.dailyMetricStatuses,
    ),
    // Profiles and exercise goals do not carry a fixture identity. Existing
    // values therefore always win, including edits made to seeded members or
    // seeded exercises; the refresh may only add missing defaults.
    energyProfiles: {
      ...defaults.energyProfiles,
      ...restoredProfiles,
      ...(restoredCurrentProfile
        ? { [currentUserId]: restoredCurrentProfile }
        : {}),
    },
    gymExerciseGoals: {
      ...(defaults.gymExerciseGoals ?? {}),
      ...(restored.gymExerciseGoals ?? {}),
    },
  };
}
