import {
  catalogExercise,
  exerciseFromActivityName,
  SESSION_ACTIVITY_EXERCISES,
} from "@/src/domain/exerciseCatalog";
import type {
  EnergyProfile,
  GymSession,
  MetricEntry,
  StepCoverageChoice,
  StepCoveragePreferences,
} from "@/src/types";

const ENERGY_ACTIVITY_PREFIX = "energy-breakdown:activity:";
const MAX_SESSION_PREFERENCES = 2_000;
export const STEP_COVERAGE_ALL_HISTORY_DATE = "0000-01-01";
const normalizedPreferenceCache = new WeakMap<
  StepCoveragePreferences,
  StepCoveragePreferences
>();
const EMPTY_STEP_COVERAGE_PREFERENCES: StepCoveragePreferences = {
  version: 1,
  sessions: {},
  activityRules: {},
};

/**
 * Big Team Challenge's public activity conversion chart, in estimated
 * steps/minute. These are opt-in equivalents, never measured Step records.
 * https://www.bigteamchallenge.com/resources/activity-conversion-chart
 */
const EQUIVALENT_STEPS_PER_MINUTE: Readonly<Record<string, number>> = {
  basketball: 130,
  table_tennis: 120,
  golf: 110,
  yoga: 45,
  soccer: 145,
  american_football: 170,
  tennis: 170,
  badminton: 131,
  volleyball: 130,
  baseball: 130,
  cricket: 80,
  rugby: 190,
  hockey: 200,
  ice_hockey: 200,
  squash: 190,
  racquetball: 130,
  pilates: 91,
  tai_chi: 40,
  dance: 109,
  social_dance: 109,
  aerobics: 125,
  cycling: 170,
  stationary_cycling: 170,
  swimming: 180,
  pool_swimming: 180,
  open_water_swimming: 180,
  rowing: 210,
  rowing_machine: 210,
  boxing: 110,
  kickboxing: 210,
  strength_training: 100,
  functional_strength_training: 100,
  weightlifting: 100,
  weight_machine: 100,
  elliptical: 170,
  stair_climbing: 180,
  stair_machine: 180,
  jump_rope: 160,
  gardening: 60,
};

const DIRECT_STEP_ACTIVITY_KEYS = new Set([
  "walking",
  "running",
  "track_running",
  "treadmill_running",
  "hiking",
]);

const DIRECT_STEP_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  walking: "Walking",
  running: "Running",
  track_running: "Track running",
  treadmill_running: "Treadmill running",
  hiking: "Hiking",
};

const NON_STEP_COVERAGE_SESSION_KEYS = new Set([
  "multisport_transition",
  "other_workout",
  "workout_break",
]);

const SESSION_ACTIVITY_BY_KEY = new Map(
  SESSION_ACTIVITY_EXERCISES.map((activity) => [activity.key, activity]),
);

/**
 * Low-confidence, manual-only product estimate for session activities without
 * a published activity-table rate. MET values come from the app's 2024 Adult
 * Compendium activity catalog, but the resulting value is not measured
 * footfall. Linear interpolation keeps the requested anchors exact:
 * 3 MET = 100 steps/min and 6 MET = 130 steps/min. Values are bounded so very
 * light or vigorous non-step sports cannot dominate a measured Step total.
 * These estimates are always manual opt-in.
 * https://pacompendium.com/adult-compendium/
 */
export function metCadenceStepEstimate(met: number) {
  return Math.round(Math.min(160, Math.max(80, 70 + 10 * met)));
}

const LABEL_ACTIVITY_ALIASES: Readonly<Record<string, string>> = {
  "ping pong": "table_tennis",
  pingpong: "table_tennis",
  "american football": "american_football",
  "ice hockey": "ice_hockey",
  "social dance": "social_dance",
  "stationary bike": "stationary_cycling",
  "exercise bike": "stationary_cycling",
  "indoor cycling": "stationary_cycling",
  "lap swimming": "pool_swimming",
  "open water swimming": "open_water_swimming",
  "rowing machine": "rowing_machine",
  "strength training": "strength_training",
  "functional strength training": "functional_strength_training",
  "weight lifting": "weightlifting",
  weights: "weightlifting",
  "stair climbing": "stair_climbing",
  "stair machine": "stair_machine",
  "step machine": "stair_machine",
  "jump rope": "jump_rope",
  "skipping rope": "jump_rope",
  gardening: "gardening",
};

export type StepCoverageActivity = {
  key: string;
  label: string;
  mode: "direct" | "equivalent";
  /** Present only for opt-in activity equivalents. */
  stepsPerMinute?: number;
  /** Catalog MET used only to infer duration when the workout omitted it. */
  met?: number;
};

export type StepCoverageResolution = {
  included: boolean;
  source: "default" | "session" | "activity_rule";
  choice: StepCoverageChoice;
};

export type StepCoverageActivityScope =
  | "session"
  | "future_activity"
  | "all_activity";

function readableActivityLabel(key: string) {
  const label = key.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Resolve a durable activity key stored on an entry or private preference. */
export function stepCoverageActivityFromKey(
  key?: string,
): StepCoverageActivity | undefined {
  if (!key?.trim()) return undefined;
  const normalizedKey = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (NON_STEP_COVERAGE_SESSION_KEYS.has(normalizedKey)) return undefined;
  const catalog = SESSION_ACTIVITY_BY_KEY.get(normalizedKey);
  if (DIRECT_STEP_ACTIVITY_KEYS.has(normalizedKey))
    return {
      key: normalizedKey,
      label:
        catalog?.name ??
        DIRECT_STEP_ACTIVITY_LABELS[normalizedKey] ??
        readableActivityLabel(normalizedKey),
      mode: "direct",
      met: catalog?.met,
    };
  const publishedStepsPerMinute = EQUIVALENT_STEPS_PER_MINUTE[normalizedKey];
  const stepsPerMinute =
    publishedStepsPerMinute ??
    (catalog ? metCadenceStepEstimate(catalog.met) : undefined);
  if (typeof stepsPerMinute !== "number" || !(stepsPerMinute > 0))
    return undefined;
  return {
    key: normalizedKey,
    label: catalog?.name ?? readableActivityLabel(normalizedKey),
    mode: "equivalent",
    stepsPerMinute,
    met:
      catalog?.met ??
      (normalizedKey === "gardening" ? 3.5 : undefined),
  };
}

const STEP_COVERAGE_ACTIVITIES = Object.freeze(
  [
    ...DIRECT_STEP_ACTIVITY_KEYS,
    ...Object.keys(EQUIVALENT_STEPS_PER_MINUTE),
    ...SESSION_ACTIVITY_EXERCISES.map((activity) => activity.key),
  ]
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .map((key) => stepCoverageActivityFromKey(key))
    .filter((activity): activity is StepCoverageActivity => Boolean(activity))
    .sort(
      (left, right) =>
        left.label.toLowerCase() < right.label.toLowerCase()
          ? -1
          : left.label.toLowerCase() > right.label.toLowerCase()
            ? 1
            : left.key < right.key
              ? -1
              : left.key > right.key
                ? 1
                : 0,
    ),
);

/** Stable, alphabetized menu choices for explicit Step classification. */
export function listStepCoverageActivities(): readonly StepCoverageActivity[] {
  return STEP_COVERAGE_ACTIVITIES;
}

function normalizedLabel(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fallbackActivityKey(label: string) {
  const normalized = normalizedLabel(label);
  if (!normalized) return undefined;
  if (/\btreadmill\b/.test(normalized)) return "treadmill_running";
  if (/\b(?:run|running|jog|jogging)\b/.test(normalized)) return "running";
  if (/\b(?:hike|hiking)\b/.test(normalized)) return "hiking";
  if (/\b(?:walk|walking)\b/.test(normalized)) return "walking";
  return LABEL_ACTIVITY_ALIASES[normalized];
}

/** Resolve only activities with a measured-Step model or a cited equivalent. */
export function stepCoverageActivity(label?: string): StepCoverageActivity | undefined {
  if (!label?.trim()) return undefined;
  const catalog = exerciseFromActivityName(label);
  const key = catalog?.key ?? fallbackActivityKey(label);
  if (!key) return undefined;
  const resolvedCatalog = catalog ?? catalogExercise(key);
  const activity = stepCoverageActivityFromKey(key);
  return activity
    ? {
        ...activity,
        label: resolvedCatalog?.name ?? activity.label ?? label.trim(),
      }
    : undefined;
}

export function stepCoverageSourceEntryId(entry: Pick<MetricEntry, "id">) {
  return entry.id.startsWith(ENERGY_ACTIVITY_PREFIX)
    ? entry.id.slice(ENERGY_ACTIVITY_PREFIX.length)
    : entry.id;
}

/**
 * Samsung Health exposes workout calories as TotalCaloriesBurned intervals.
 * The native importer promotes each interval to Active energy while retaining
 * the matched ExerciseSession id inside its stable source id:
 *
 *   samsung-total-workout:<energy id>:<workout id>:workout-energy
 *
 * Treat that promoted row as part of the ExerciseSession. This lets one
 * private Step-coverage choice update the linked Workout, duration, distance,
 * Active energy and Total energy views instead of leaving the calorie row as
 * an unrelated session.
 */
export function stepCoverageWorkoutRecordId(
  entry: Pick<MetricEntry, "sourceRecordId">,
) {
  const sourceRecordId = entry.sourceRecordId?.trim();
  if (!sourceRecordId?.startsWith("samsung-total-workout:") ||
      !sourceRecordId.endsWith(":workout-energy"))
    return sourceRecordId;
  const body = sourceRecordId.slice(
    "samsung-total-workout:".length,
    -":workout-energy".length,
  );
  // Health Connect record ids are UUID-like and do not contain colons. Split
  // only the importer-owned pair; malformed/legacy values safely keep their
  // original identity rather than being linked to the wrong session.
  const separator = body.indexOf(":");
  if (separator <= 0 || separator >= body.length - 1) return sourceRecordId;
  return body.slice(separator + 1);
}

export function stepCoverageGymSessionId(entryId: string) {
  const canonicalId = stepCoverageSourceEntryId({ id: entryId });
  const match = canonicalId.match(
    /^gym-sync:(.+):(?:workout|workout_duration|workout_distance|exercise)$/,
  );
  return match?.[1];
}

/**
 * Private identity shared by duration, distance and calorie rows originating
 * from one workout. It is intentionally never attached to group projections.
 */
export function stepCoverageSessionIdentity(
  entry: Pick<
    MetricEntry,
    | "id"
    | "metricId"
    | "userId"
    | "sourceProvider"
    | "sourceRecordId"
    | "source"
  >,
) {
  if (
    entry.sourceRecordId?.startsWith("step-fallback:") ||
    stepCoverageSourceEntryId(entry).includes(":step-fallback:")
  )
    return undefined;
  const sessionId = stepCoverageGymSessionId(entry.id);
  if (sessionId) return `gym:${encodeURIComponent(sessionId)}`;
  const workoutRecordId = stepCoverageWorkoutRecordId(entry);
  if (workoutRecordId)
    return `source:${encodeURIComponent(
      entry.sourceProvider ?? "health",
    )}:${encodeURIComponent(workoutRecordId)}`;
  // Older standalone manual Workout rows predate the compound manual-workout
  // writer and therefore have no sourceRecordId. They still need a private,
  // stable identity so the user can classify that one workout. Detail rows are
  // linked only when a real shared sourceRecordId/gym id exists.
  if (entry.source === "manual" && entry.metricId === "workout")
    return `manual:${encodeURIComponent(entry.userId)}:${encodeURIComponent(
      stepCoverageSourceEntryId(entry),
    )}`;
  // A standalone Active-energy interval may be entered manually or restored
  // from an older importer without a provider record id. The detail screen is
  // responsible for admitting only eligible Active-energy rows, but once the
  // user explicitly classifies one it still needs a private, durable identity
  // so the preference survives reload and the calories-only estimator can use
  // it. Keep this generic fallback source-local: callers outside Step coverage
  // cannot opt an unrelated entry into the calculation accidentally.
  if (entry.source !== "calculated" && entry.id)
    return `entry:${encodeURIComponent(entry.userId)}:${encodeURIComponent(
      stepCoverageSourceEntryId(entry),
    )}`;
  return undefined;
}

export function entriesShareStepCoverageSession(
  left: Pick<
    MetricEntry,
    | "id"
    | "metricId"
    | "userId"
    | "sourceProvider"
    | "sourceRecordId"
    | "source"
  >,
  right: Pick<
    MetricEntry,
    | "id"
    | "metricId"
    | "userId"
    | "sourceProvider"
    | "sourceRecordId"
    | "source"
  >,
) {
  const leftIdentity = stepCoverageSessionIdentity(left);
  return Boolean(
    leftIdentity && leftIdentity === stepCoverageSessionIdentity(right),
  );
}

/**
 * Infer one unambiguous Step activity from a saved Workout-page session.
 * The user's session name wins; otherwise only completed exercises are
 * considered. Multiple different eligible activities remain unclassified so
 * the app can ask the user instead of silently choosing the wrong conversion.
 */
export function inferStepCoverageActivityFromGymSession(
  session: Pick<GymSession, "name" | "exercises">,
): StepCoverageActivity | undefined {
  const named = stepCoverageActivity(session.name);
  if (named) return named;
  const candidates = new Map<string, StepCoverageActivity>();
  for (const exercise of session.exercises) {
    const completedSets = exercise.sets.filter((set) => set.completed);
    if (!exercise.completed && !completedSets.length) continue;
    const activity =
      stepCoverageActivityFromKey(exercise.exerciseKey) ??
      stepCoverageActivity(exercise.name);
    if (activity) candidates.set(activity.key, activity);
    for (const set of completedSets) {
      const supersetActivity =
        stepCoverageActivityFromKey(set.superset?.exerciseKey) ??
        stepCoverageActivity(set.superset?.name);
      if (supersetActivity)
        candidates.set(supersetActivity.key, supersetActivity);
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

/** Idempotently enrich legacy saved-gym rows after local/cloud restoration. */
export function withInferredGymStepCoverageEntries(
  entries: MetricEntry[],
  sessions: readonly GymSession[],
): MetricEntry[] {
  const inferredBySessionId = new Map<string, string | undefined>(
    sessions.map((session) => [
      `${session.userId}\u0000${session.id}`,
      inferStepCoverageActivityFromGymSession(session)?.key,
    ]),
  );
  let changed = false;
  const next = entries.map((entry) => {
    const sessionId = stepCoverageGymSessionId(entry.id);
    if (!sessionId) return entry;
    const ownerSessionKey = `${entry.userId}\u0000${sessionId}`;
    if (!inferredBySessionId.has(ownerSessionKey)) return entry;
    const activityKey = inferredBySessionId.get(ownerSessionKey);
    if (entry.stepCoverageActivityKey === activityKey) return entry;
    changed = true;
    if (activityKey) return { ...entry, stepCoverageActivityKey: activityKey };
    const { stepCoverageActivityKey: _stale, ...withoutStaleActivity } = entry;
    return withoutStaleActivity;
  });
  return changed ? next : entries;
}

export function linkedStepCoverageEntries(
  entries: readonly MetricEntry[],
  target: MetricEntry,
) {
  const identity = stepCoverageSessionIdentity(target);
  return identity
    ? entries.filter(
        (entry) => stepCoverageSessionIdentity(entry) === identity,
      )
    : [];
}

export function stepCoverageProjectionSource(
  projection: MetricEntry,
  entries: readonly MetricEntry[],
) {
  const sourceId = stepCoverageSourceEntryId(projection);
  return entries.find(
    (entry) => entry.userId === projection.userId && entry.id === sourceId,
  );
}

function validChoice(value: unknown): value is StepCoverageChoice {
  return value === "include" || value === "exclude";
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Defensive normalization for restored/cloud snapshots. */
export function normalizeStepCoveragePreferences(
  value?: StepCoveragePreferences,
): StepCoveragePreferences {
  if (!value) return EMPTY_STEP_COVERAGE_PREFERENCES;
  const cached = normalizedPreferenceCache.get(value);
  if (cached) return cached;
  const sessions = Object.entries(value?.sessions ?? {})
    .filter(
      ([key, preference]) =>
        Boolean(key) &&
        validChoice(preference?.choice) &&
        validTimestamp(preference?.updatedAt),
    )
    .sort(([, left], [, right]) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, MAX_SESSION_PREFERENCES);
  const activityRules = Object.entries(value?.activityRules ?? {}).filter(
    ([key, preference]) =>
      Boolean(key) &&
      Boolean(stepCoverageActivity(catalogExercise(key)?.name ?? key)) &&
      validChoice(preference?.choice) &&
      validDate(preference?.effectiveFrom) &&
      validTimestamp(preference?.updatedAt),
  );
  const normalized: StepCoveragePreferences = {
    version: 1,
    sessions: Object.fromEntries(
      sessions.map(([key, preference]) => {
        const activity = stepCoverageActivityFromKey(preference.activityKey);
        return [
          key,
          {
            choice: preference.choice,
            ...(activity ? { activityKey: activity.key } : {}),
            updatedAt: preference.updatedAt,
          },
        ];
      }),
    ),
    activityRules: Object.fromEntries(activityRules),
  };
  normalizedPreferenceCache.set(value, normalized);
  normalizedPreferenceCache.set(normalized, normalized);
  return normalized;
}

/** Preference override, inferred gym metadata, then visible source label. */
export function resolveNormalizedStepCoverageActivity(
  entry: MetricEntry,
  preferences: StepCoveragePreferences,
) {
  const identity = stepCoverageSessionIdentity(entry);
  const sessionActivity = identity
    ? stepCoverageActivityFromKey(preferences.sessions[identity]?.activityKey)
    : undefined;
  return (
    sessionActivity ??
    stepCoverageActivityFromKey(entry.stepCoverageActivityKey) ??
    stepCoverageActivity(entry.label)
  );
}

export function resolveStepCoverageActivity(
  entry: MetricEntry,
  preferences?: StepCoveragePreferences,
) {
  return resolveNormalizedStepCoverageActivity(
    entry,
    normalizeStepCoveragePreferences(preferences),
  );
}

export function resolveNormalizedStepCoverageChoice(
  entry: MetricEntry,
  preferences: StepCoveragePreferences,
): StepCoverageResolution | undefined {
  const activity = resolveNormalizedStepCoverageActivity(entry, preferences);
  const identity = stepCoverageSessionIdentity(entry);
  if (!activity || !identity) return undefined;
  const session = preferences.sessions[identity];
  if (session)
    return {
      included: session.choice === "include",
      choice: session.choice,
      source: "session",
    };
  const activityRule = preferences.activityRules[activity.key];
  if (activityRule && entry.localDate >= activityRule.effectiveFrom)
    return {
      included: activityRule.choice === "include",
      choice: activityRule.choice,
      source: "activity_rule",
    };
  // Only activities that directly represent measured walking/running/hiking
  // movement are safe defaults. An app-authored Basketball/Yoga/etc. label is
  // useful for preselecting the conversion, but it is not consent to subtract
  // an activity-equivalent from the user's measured Step total.
  const choice = activity.mode === "direct" ? "include" : "exclude";
  return { included: choice === "include", choice, source: "default" };
}

export function resolveStepCoverageChoice(
  entry: MetricEntry,
  preferences?: StepCoveragePreferences,
) {
  return resolveNormalizedStepCoverageChoice(
    entry,
    normalizeStepCoveragePreferences(preferences),
  );
}

export function withStepCoverageChoice(
  current: StepCoveragePreferences | undefined,
  entry: MetricEntry,
  choice: StepCoverageChoice,
  scope: StepCoverageActivityScope,
  updatedAt = new Date().toISOString(),
) {
  const normalized = normalizeStepCoveragePreferences(current);
  const identity = stepCoverageSessionIdentity(entry);
  const activity = resolveNormalizedStepCoverageActivity(entry, normalized);
  if (!identity || !activity) return normalized;
  if (scope === "session")
    return normalizeStepCoveragePreferences({
      ...normalized,
      sessions: {
        ...normalized.sessions,
        [identity]: {
          ...normalized.sessions[identity],
          choice,
          updatedAt,
        },
      },
    });
  const sessions = { ...normalized.sessions };
  // A generic display label may rely on an explicit activity classification.
  // Retain that classification for this session while the activity rule covers
  // later correctly-labelled/inferred sessions.
  if (sessions[identity]?.activityKey)
    sessions[identity] = { ...sessions[identity], choice, updatedAt };
  else delete sessions[identity];
  return normalizeStepCoveragePreferences({
    ...normalized,
    sessions,
    activityRules: {
      ...normalized.activityRules,
      [activity.key]: {
        choice,
        effectiveFrom:
          scope === "all_activity"
            ? STEP_COVERAGE_ALL_HISTORY_DATE
            : entry.localDate,
        updatedAt,
      },
    },
  });
}

/**
 * Explicitly classify one linked workout and include it in Step coverage.
 * The override is session-scoped: a generic "Workout" label is not enough to
 * safely infer what future unrelated workouts should be.
 */
export function withStepCoverageActivityOverride(
  current: StepCoveragePreferences | undefined,
  entry: MetricEntry,
  activityKey: string,
  choice: StepCoverageChoice = "include",
  updatedAt = new Date().toISOString(),
) {
  const normalized = normalizeStepCoveragePreferences(current);
  const identity = stepCoverageSessionIdentity(entry);
  const activity = stepCoverageActivityFromKey(activityKey);
  if (!identity || !activity) return normalized;
  return normalizeStepCoveragePreferences({
    ...normalized,
    sessions: {
      ...normalized.sessions,
      [identity]: {
        choice,
        activityKey: activity.key,
        updatedAt,
      },
    },
  });
}

/**
 * Classify an otherwise generic workout and apply that choice either to this
 * one linked session, from its date forward, or to matching activity history.
 * The explicit session classification is retained in every scope so a generic
 * "Workout" row remains understandable after sync/restoration.
 */
export function withStepCoverageActivitySelection(
  current: StepCoveragePreferences | undefined,
  entry: MetricEntry,
  activityKey: string,
  scope: StepCoverageActivityScope,
  choice: StepCoverageChoice = "include",
  updatedAt = new Date().toISOString(),
) {
  const classified = withStepCoverageActivityOverride(
    current,
    entry,
    activityKey,
    choice,
    updatedAt,
  );
  return scope === "session"
    ? classified
    : withStepCoverageChoice(
        classified,
        entry,
        choice,
        scope,
        updatedAt,
      );
}

function newerPreference<T extends { updatedAt: string }>(
  left: T | undefined,
  right: T | undefined,
) {
  if (!left) return right;
  if (!right) return left;
  return right.updatedAt > left.updatedAt ? right : left;
}

/** Merge independently edited device rules without dropping unrelated choices. */
export function mergeStepCoveragePreferences(
  remote?: StepCoveragePreferences,
  local?: StepCoveragePreferences,
) {
  const left = normalizeStepCoveragePreferences(remote);
  const right = normalizeStepCoveragePreferences(local);
  const sessionKeys = new Set([
    ...Object.keys(left.sessions),
    ...Object.keys(right.sessions),
  ]);
  const activityKeys = new Set([
    ...Object.keys(left.activityRules),
    ...Object.keys(right.activityRules),
  ]);
  return normalizeStepCoveragePreferences({
    version: 1,
    sessions: Object.fromEntries(
      [...sessionKeys].flatMap((key) => {
        const preference = newerPreference(
          left.sessions[key],
          right.sessions[key],
        );
        return preference ? [[key, preference]] : [];
      }),
    ),
    activityRules: Object.fromEntries(
      [...activityKeys].flatMap((key) => {
        const preference = newerPreference(
          left.activityRules[key],
          right.activityRules[key],
        );
        return preference ? [[key, preference]] : [];
      }),
    ),
  });
}

/**
 * Opt-in equivalent steps. Measured duration wins; Active calories only infer
 * duration when net intensity (MET - 1) and a valid body weight are available.
 */
export function equivalentStepEstimate(
  activity: StepCoverageActivity,
  input: { durationMinutes?: number; activeCalories?: number },
  profile: Pick<EnergyProfile, "weightKg">,
) {
  if (activity.mode !== "equivalent" || !(activity.stepsPerMinute! > 0))
    return undefined;
  const measuredMinutes = Number(input.durationMinutes ?? 0);
  let durationMinutes = measuredMinutes > 0 ? measuredMinutes : 0;
  let durationSource: "measured" | "calorie_met_estimate" = "measured";
  if (!(durationMinutes > 0)) {
    const calories = Number(input.activeCalories ?? 0);
    const met = Number(activity.met ?? 0);
    const weightKg = Number(profile.weightKg ?? 0);
    // Active calories exclude resting expenditure, so infer duration from net
    // intensity rather than the gross Compendium MET value.
    const kilocaloriesPerMinute = ((met - 1) * 3.5 * weightKg) / 200;
    if (!(calories > 0) || !(met > 1) || !(kilocaloriesPerMinute > 0))
      return undefined;
    durationMinutes = calories / kilocaloriesPerMinute;
    durationSource = "calorie_met_estimate";
  }
  return {
    steps: activity.stepsPerMinute! * durationMinutes,
    durationMinutes,
    durationSource,
    stepsPerMinute: activity.stepsPerMinute!,
  };
}
