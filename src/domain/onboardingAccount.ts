import type { AppState, EnergyProfile, MetricDefinition } from "../types";

/** Neutral calculation fallback, not an asserted measurement or demo person. */
export function emptyAccountEnergyProfile(): EnergyProfile {
  return { age: 30, sex: "unspecified", heightCm: 170, weightKg: 70, targetWeightKg: 70,
    activityLevel: "sedentary", desiredWeeklyLossKg: 0.25 };
}

/** Classic's optional form must not log unchanged defaults or copied body data. */
export function changedOnboardingProfile(current: EnergyProfile, next: EnergyProfile): Partial<EnergyProfile> {
  const fields = ["age", "sex", "heightCm", "weightKg", "targetWeightKg", "activityLevel", "desiredWeeklyLossKg"] as const;
  const changes: Partial<EnergyProfile> = Object.fromEntries(fields
    .filter((field) => current[field] !== next[field]).map((field) => [field, next[field]]));
  if (changes.weightKg !== undefined && current.startingWeightKg === undefined)
    changes.startingWeightKg = changes.weightKg;
  return changes;
}

/** Explicit list: spreading display defaults must never import demo activity. */
export function emptyPersonalAccountContent(): Pick<AppState,
  "entries" | "photos" | "messages" | "dailyMetricStatuses" | "todos" |
  "journalNotes" | "calendarReminders" | "gymPlans" | "gymSessions" |
  "gymExerciseGoals" | "activityTimers" | "activeTimer"
> {
  return {
    entries: [], photos: [], messages: [], dailyMetricStatuses: [], todos: [],
    journalNotes: [], calendarReminders: [], gymPlans: [], gymSessions: [],
    gymExerciseGoals: {}, activityTimers: [], activeTimer: undefined,
  };
}

const FIXTURE_COLLECTIONS = [
  ["todos", "demo-todo-"], ["journalNotes", "demo-journal-"],
  ["calendarReminders", "demo-reminder-"], ["gymPlans", "demo-plan-"],
  ["gymSessions", "demo-session-"],
] as const;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** Compare the entire record, allowing only one consistent calendar-day shift.
 * A changed title, body, completion, reminder, schedule time or child survives.
 * Field names are sorted because old snapshots may serialize them differently.
 */
function fixtureFingerprint(record: unknown): string {
  const dates: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") dates.push(...[...value.matchAll(ISO_DATE)].map((match) => match[0]));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(record);
  const first = dates.sort()[0];
  const firstDay = first ? Date.parse(`${first}T00:00:00Z`) : 0;
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(ISO_DATE, (date) =>
      `day:${(Date.parse(`${date}T00:00:00Z`) - firstDay) / 86_400_000}`,
    );
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
    return value;
  };
  return JSON.stringify(normalize(record));
}

/** Repair only positively identified, untouched legacy fixtures in real accounts.
 * Never run on the deliberate demo identity. Unknown or edited rows survive;
 * unowned scalar exercise goals are intentionally not guessed at retroactively.
 */
export function withoutUnchangedDemoAccountFixtures(state: AppState, demo: AppState): AppState {
  if (state.currentUserId === demo.currentUserId || state.group.id === demo.group.id) return state;
  const removable = new Map<string, Set<string>>();
  for (const [key, prefix] of FIXTURE_COLLECTIONS) {
    const rows = state[key] ?? [];
    const fingerprints = new Set((demo[key] ?? []).map(fixtureFingerprint));
    const matches = rows.map((row) => row.id.startsWith(prefix) && fingerprints.has(fixtureFingerprint(row)));
    const ids = new Set(rows.filter((_, index) => matches[index]).map((row) => row.id));
    // A duplicate edited row with the same ID is still user content.
    rows.forEach((row, index) => { if (!matches[index]) ids.delete(row.id); });
    removable.set(key, ids);
  }
  const todoIds = removable.get("todos")!;
  const todoById = new Map((state.todos ?? []).map((todo) => [todo.id, todo]));
  for (const todo of state.todos ?? []) {
    if (todoIds.has(todo.id)) continue;
    const visited = new Set<string>();
    let parentId = todo.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      todoIds.delete(parentId);
      parentId = todoById.get(parentId)?.parentId;
    }
  }
  // A plan becomes personally used when a retained session references it.
  const sessionIds = removable.get("gymSessions")!;
  const planIds = removable.get("gymPlans")!;
  for (const session of state.gymSessions ?? []) {
    if (!sessionIds.has(session.id) && session.planId) planIds.delete(session.planId);
  }
  let next = state;
  for (const [key] of FIXTURE_COLLECTIONS) {
    const rows = state[key] ?? [];
    const retained = rows.filter((row) => !removable.get(key)!.has(row.id));
    if (retained.length !== rows.length) next = { ...next, [key]: retained };
  }
  return next;
}

export function hasPersonalOnboardingContent(state: AppState): boolean {
  return state.entries.some((entry) => entry.userId === state.currentUserId) ||
    state.photos.some((photo) => photo.userId === state.currentUserId) ||
    state.dailyMetricStatuses.some((status) => status.userId === state.currentUserId) ||
    Object.values(state.trackedGoalPeriods ?? {}).some((periods) => periods.length > 0) ||
    Object.keys(state.gymExerciseGoals ?? {}).length > 0 ||
    Boolean(state.todos?.length || state.journalNotes?.length || state.calendarReminders?.length ||
      state.gymPlans?.length || state.gymSessions?.length || state.activityTimers?.length || state.activeTimer);
}

/** Only a truly fresh account can replace its inherited default catalog. */
export function canBeginEmptyGuidedSetup(state: AppState, defaults: readonly MetricDefinition[]): boolean {
  if (state.settings.onboardingComplete || hasPersonalOnboardingContent(state)) return false;
  // A deliberately changed catalog is personal setup even before its first log.
  // Schema repair renumbers order values but must not change relative order.
  if (state.metrics.length !== defaults.length) return false;
  const orderedIds = (metrics: readonly MetricDefinition[]) => [...metrics]
    .sort((left, right) => left.order - right.order).map((metric) => metric.id);
  if (JSON.stringify(orderedIds(state.metrics)) !== JSON.stringify(orderedIds(defaults))) return false;
  const defaultById = new Map(defaults.map((metric) => [metric.id, metric]));
  return state.metrics.every((metric) => {
    const original = defaultById.get(metric.id);
    if (!original) return false;
    const { activeFrom: _activeFrom, order: _order, ...definition } = metric;
    const { activeFrom: _defaultActiveFrom, order: _defaultOrder, ...defaultDefinition } = original;
    // Existing state migration materializes this one previously omitted false
    // value. Do not ignore other goal edits or infer arbitrary equivalence.
    if (metric.id === "body_fat" && original.goalEnabled === undefined && definition.goalEnabled === false)
      delete definition.goalEnabled;
    return fixtureFingerprint(definition) === fixtureFingerprint(defaultDefinition);
  });
}

export const ORDINARY_STARTER_TRACKER_IDS = ["steps", "water", "todo_completion"] as const;
export const ORDINARY_TRACKED_GOAL_IDS = ["steps", "water"] as const;

/** No data writes: only install defaults if this guide still has nothing added. */
export function shouldUseEmptyGuidedSetupDefaults(state: AppState): boolean {
  return state.settings.guidedSetupStartedEmpty === true && state.metrics.length === 0 &&
    !hasPersonalOnboardingContent(state);
}

export function beginPersonalGuidedSetup(state: AppState, defaults: readonly MetricDefinition[]): AppState {
  const startEmpty = canBeginEmptyGuidedSetup(state, defaults);
  return {
    ...state,
    ...(startEmpty ? { metrics: [], trackedGoalPeriods: {} } : {}),
    settings: { ...state.settings, guidedSetupStartedEmpty: startEmpty, guidedSetupStep: "trackers" },
  };
}

export function finishPersonalGuidedSetup(
  state: AppState,
  defaults: readonly MetricDefinition[],
  today: string,
  skipAllTutorials = false,
): AppState {
  const useDefaults = shouldUseEmptyGuidedSetupDefaults(state);
  const starterIds = new Set<string>(ORDINARY_STARTER_TRACKER_IDS);
  const trackedIds = new Set<string>(ORDINARY_TRACKED_GOAL_IDS);
  const metrics = useDefaults ? defaults.filter((metric) => starterIds.has(metric.id))
    .map((metric, order) => ({ ...metric, activeFrom: today, order, scoreWeight: 0,
      sections: { today: true, insights: metric.id !== "todo_completion", group: false } })) : state.metrics;
  return {
    ...state,
    metrics,
    trackedGoalPeriods: useDefaults ? Object.fromEntries(metrics.map((metric) =>
      [metric.id, trackedIds.has(metric.id) ? [{ from: today }] : []],
    )) : state.trackedGoalPeriods,
    settings: {
      ...state.settings,
      ...(useDefaults ? { showGoalsToday: true, showTodosToday: true } : {}),
      ...(skipAllTutorials ? { tutorialPromptsDisabled: true, tutorialComplete: true,
        tutorialGuideId: undefined, tutorialGuideRunId: undefined } : {}),
      guidedSetupStartedEmpty: false,
      guidedSetupStep: "complete",
    },
  };
}
