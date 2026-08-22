export type Visibility = "private" | "group" | "status";
export type MetricDataType =
  | "number"
  | "boolean"
  | "text"
  | "photo"
  | "calculated";
export type Aggregation = "sum" | "latest" | "average" | "max" | "min";
export type RankingDirection = "higher" | "lower" | "closest";
export type GoalKind = "at_least" | "at_most" | "exact" | "complete";
export type GoalProgressMode = "daily" | "journey";
export type AdaptiveGoalTarget = {
  /** Opt-in. When disabled or history is unavailable, `goal.target` remains the fallback. */
  enabled: boolean;
  statistic: "average" | "median";
  /** The last fully completed calendar period, or all earlier logged history. */
  period: "week" | "month" | "year" | "all_time";
};
export type DashboardSection = "today" | "group" | "insights";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active"
  | "athlete";
export type BiologicalSex = "female" | "male" | "unspecified";
export type HealthProvider = "apple_health" | "health_connect" | "google_health";
export type HealthDataType =
  | "steps"
  | "active_energy"
  | "weight"
  | "nutrition"
  | "water"
  | "workouts"
  | "body_fat"
  | "lean_body_mass"
  | "body_water_mass"
  | "bone_mass"
  | "blood_pressure"
  | "heart_rate"
  | "sleep"
  | "blood_glucose"
  | "menstruation";

export type HealthMetricField =
  | "value"
  | "duration_minutes"
  | "active_calories"
  | "distance_km"
  | "systolic"
  | "diastolic"
  | "protein"
  | "fat"
  | "carbs"
  | "fiber"
  | "sodium"
  | "sugar"
  | "saturated_fat"
  | "cholesterol"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium"
  | "vitamin_c"
  | "vitamin_d"
  | "vitamin_b12"
  | "sugar_alcohol"
  | "alcohol"
  | "trans_fat"
  | "monounsaturated_fat"
  | "polyunsaturated_fat"
  | "omega_3"
  | "omega_6"
  | "starch"
  | "phosphorus"
  | "zinc"
  | "copper"
  | "manganese"
  | "selenium"
  | "iodine"
  | "vitamin_a"
  | "vitamin_e"
  | "vitamin_k"
  | "vitamin_b1"
  | "vitamin_b2"
  | "vitamin_b3"
  | "vitamin_b5"
  | "vitamin_b6"
  | "vitamin_b9"
  | "folic_acid"
  | "caffeine"
  | "biotin"
  | "chloride"
  | "chromium"
  | "molybdenum";
export type HealthMetricMapping = {
  dataType: HealthDataType;
  field: HealthMetricField;
  /**
   * Optional canonical workout filters. When present, only matching exercise
   * sessions may populate this tracker; an unfiltered workout mapping retains
   * the existing all-workouts behavior.
   */
  activityKeys?: string[];
  /** Distinguish an overall workout session from a typed movement segment. */
  workoutRecordKind?: "session" | "segment";
};
export type TrackerCategory =
  | "goals"
  | "activity"
  | "nutrition"
  | "body"
  | "health"
  | "gym"
  | "mind"
  | "photos"
  | "other";

export type MetricGoal = {
  kind: GoalKind;
  target: number;
};

export type MetricSubmetric = {
  id: string;
  name: string;
  unit: string;
  goalEnabled: boolean;
  goal: MetricGoal;
  goalRange?: { min: number; max: number };
  /** At most four submetrics can render as first-class progress bars. */
  showProgressBar?: boolean;
  /** Mirror a submitted value into another tracker without duplicating input. */
  linkedMetricId?: string;
  /** Optional device-data source for this individual field. */
  healthMapping?: HealthMetricMapping;
  /** Optional range-chart override for this field. */
  chartStyle?: MetricChartStyle;
};

export type MetricSubmetricDisplay = {
  mode: "separate" | "merged";
  /** Tokens such as {systolic}/{diastolic} {systolic.unit}. */
  template?: string;
  collapsible?: boolean;
  collapsibleLabel?: string;
  /** First N submetrics stay visible; later fields follow creation order under the disclosure. */
  visibleInputCount?: number;
  /** False when all input belongs to submetrics (for example blood pressure). */
  mainValueEnabled?: boolean;
};

export type MetricChartStyle = "auto" | "bar" | "line" | "both" | "completion";
export type MetricVisualization = {
  /** A single selected day in the tracker detail page. */
  detailDay?: "progress" | "completion" | "none";
  /** Week, month and year in tracker detail. */
  detailRange?: MetricChartStyle;
  /** Combined Progress overview. */
  progressOverview?: MetricChartStyle;
  /** Goal-map cells may show intensity or only completion state. */
  progressGrid?: "intensity" | "completion";
};

export type GymMetricMapping =
  | { kind: "session_completed" }
  | { kind: "session_duration" }
  | { kind: "session_volume" }
  | { kind: "completed_sets" }
  | { kind: "exercise_one_rep_max"; exerciseKey: string }
  | { kind: "exercise_volume"; exerciseKey: string }
  | { kind: "exercise_reps"; exerciseKey: string }
  | { kind: "exercise_duration"; exerciseKey: string }
  | { kind: "muscle_volume"; muscleGroup: MuscleGroup };

export type GoalSchedule = {
  mode:
    | "once"
    | "daily"
    | "selected_days"
    | "every_other_day"
    | "interval_days"
    | "days_of_month"
    | "weekly_min"
    | "monthly_min";
  /** JavaScript weekday numbers: Sunday 0 through Saturday 6. */
  daysOfWeek?: number[];
  minimumCompletions?: number;
  /** Repeat from anchorDate every N days. */
  intervalDays?: number;
  /** Specific calendar dates (1-31); impossible dates are simply skipped. */
  daysOfMonth?: number[];
  anchorDate?: string;
  /** Optional inclusive final date for a recurring schedule. */
  endDate?: string;
};

export type GoalReminder = {
  enabled: boolean;
  time: string;
  /** Optional purpose-specific copy, for example "Start fast". */
  label?: string;
  /** Planned session length; allows timed trackers to span Schedule slots. */
  durationMinutes?: number;
  /** Optional cadence; omitted means every day the goal itself is due. */
  schedule?: GoalSchedule;
};

export type MetricDefinition = {
  id: string;
  name: string;
  icon: string;
  color: string;
  unit: string;
  dataType: MetricDataType;
  aggregation: Aggregation;
  rankingDirection: RankingDirection;
  goal: MetricGoal;
  /** Optional history-based target for ordinary numerical trackers. */
  adaptiveGoalTarget?: AdaptiveGoalTarget;
  /**
   * `daily` compares each reading with that day's target. `journey` treats
   * the first recorded reading as 0% and the target as 100%.
   */
  goalProgressMode?: GoalProgressMode;
  /** Advanced: some health readings are informational and have no target. */
  goalEnabled?: boolean;
  /** Optional healthy/desired range, used instead of an exact point target. */
  goalRange?: { min: number; max: number };
  category?: TrackerCategory;
  /** User-facing collection such as “Morning routine” or “Heart health”. */
  grouping?: string;
  healthMapping?: HealthMetricMapping;
  /** Value is derived from standardized gym logs instead of a manual entry. */
  gymMapping?: GymMetricMapping;
  /** Primary muscles for a custom exercise-backed workout tracker. */
  gymMuscleGroups?: MuscleGroup[];
  /** Estimate uncovered walking activity from steps when no canonical activity calories exist. */
  stepFallback?: boolean;
  /** False for device-owned readings such as steps. */
  manualEntry?: boolean;
  /** Allow this numeric tracker to be selected by the activity timer. */
  timerEnabled?: boolean;
  /** Purpose-built defaults for an intermittent-fasting window tracker. */
  fastingSettings?: {
    /** Local HH:mm time at which the fasting window normally starts. */
    startTime: string;
    /** Planned fasting duration. The eating window is 1,440 minus this value. */
    fastingMinutes: number;
    /** Derive the window from the last meal and end it at the next first meal. */
    automaticFoodBreak: boolean;
  };
  /** Advanced compound tracker fields (for example BP or nutrition). */
  submetrics?: MetricSubmetric[];
  submetricDisplay?: MetricSubmetricDisplay;
  visualization?: MetricVisualization;
  scoreWeight: number;
  formula?: string;
  defaultVisibility: Visibility;
  sections: Record<DashboardSection, boolean>;
  order: number;
  /** Goals and completion scoring apply from this local date forward. */
  activeFrom: string;
  /** Personal Today preference; older pins sort first. */
  pinnedTodayAt?: string;
  goalSchedule?: GoalSchedule;
  reminder?: GoalReminder;
  /** Multiple local reminder times; `reminder` remains as a legacy fallback. */
  reminders?: GoalReminder[];
  /** Local alerts emitted once when today's progress crosses each percentage. */
  progressReminderPercentages?: number[];
  progressRemindersEnabled?: boolean;
};

export type Member = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: "owner" | "admin" | "member";
  /** Lightweight group-visible presence, independent of tracker writes. */
  lastSeenAt?: string;
  /** Server-confirmed time this member last published current group data. */
  lastDataSyncedAt?: string;
  /** Snapshot revision that last projected this account-owned profile row. */
  profileRevision?: number;
  avatarUri?: string;
  /** Private-bucket object path; signed URLs in avatarUri are intentionally temporary. */
  avatarStoragePath?: string;
};

export type MetricEntry = {
  id: string;
  metricId: string;
  userId: string;
  value: number | boolean | string;
  localDate: string;
  recordedAt: string;
  /** User-selected meal time retained across later health-source refreshes. */
  recordedAtOverride?: string;
  visibility: Visibility;
  source: "manual" | "imported" | "calculated";
  label?: string;
  note?: string;
  imageUri?: string;
  imageStoragePath?: string;
  nutrition?: NutritionDetails;
  /** Values captured with a compound tracker. */
  submetricValues?: Record<string, number>;
  /** Stable native provenance used to update records without creating duplicates. */
  sourceProvider?: HealthProvider;
  sourceRecordId?: string;
  sourceOrigin?: string;
  sourceUpdatedAt?: string;
  /** Account snapshot revision that published this shared cloud projection. */
  sourceRevision?: number;
};

export type NutritionDetails = {
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
  saturatedFatG?: number;
  cholesterolMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  magnesiumMg?: number;
  vitaminCMg?: number;
  vitaminDMcg?: number;
  vitaminB12Mcg?: number;
  sugarAlcoholG?: number;
  alcoholG?: number;
  transFatG?: number;
  monounsaturatedFatG?: number;
  polyunsaturatedFatG?: number;
  /** Explicit provider total; never inferred from mono/poly values. */
  unsaturatedFatG?: number;
  omega3G?: number;
  omega6G?: number;
  starchG?: number;
  phosphorusMg?: number;
  zincMg?: number;
  copperMg?: number;
  manganeseMg?: number;
  seleniumMcg?: number;
  iodineMcg?: number;
  vitaminAMcg?: number;
  vitaminEMg?: number;
  vitaminKMcg?: number;
  thiaminMg?: number;
  riboflavinMg?: number;
  niacinMg?: number;
  pantothenicAcidMg?: number;
  vitaminB6Mg?: number;
  folateMcg?: number;
  /** Synthetic folic acid is distinct from total food folate when a source provides both. */
  folicAcidMcg?: number;
  caffeineMg?: number;
  biotinMcg?: number;
  chlorideMg?: number;
  chromiumMcg?: number;
  molybdenumMcg?: number;
};

export type PhotoUpdate = {
  id: string;
  userId: string;
  uri: string | number | { uri: string; width?: number; height?: number };
  caption: string;
  localDate: string;
  createdAt: string;
  visibility: Visibility;
  capturedAt?: string;
  storagePath?: string;
  /** Account snapshot revision that published this shared cloud projection. */
  sourceRevision?: number;
};

export type ChatMessage = {
  id: string;
  /** Group ownership is optional only while older persisted messages migrate. */
  groupId?: string;
  senderId: string | "system";
  text: string;
  createdAt: string;
  kind: "message" | "cheer" | "taunt" | "achievement";
  conversationId?: string;
  recipientId?: string;
  imageUri?: string;
  imageStoragePath?: string;
};

export type DailyMetricStatus = {
  groupId: string;
  metricId: string;
  userId: string;
  localDate: string;
  goalReached: boolean;
  scoreContribution: number;
  /** Percent of this member's personal target reached/consumed; target stays private. */
  goalProgress?: number;
  goalKind?: GoalKind;
  /** Shared member-specific target used to render an honest group progress bar. */
  goalTarget?: number;
  /** The member's current sharing choice for this tracker. */
  visibility?: Visibility;
  /** Whether this goal was part of the member's tracked-goal history that day. */
  goalEligible?: boolean;
  /** Exact daily value is populated only when the member shared exact values. */
  exactValue?: number;
  /** Version 2 exact values were derived from exact-visible sources only. */
  privacyProjectionVersion?: number;
  /** Distinguishes a real status-only measurement from an empty daily snapshot. */
  hasData?: boolean;
  /**
   * Sensitive-source provenance for compact projections. Google-derived
   * statuses remain cloud/in-memory only and are excluded from device caches.
   */
  sourceProvider?: HealthProvider;
  /** Last cloud update for this member's daily group snapshot. */
  syncedAt?: string;
  /** Account snapshot revision that published this shared cloud projection. */
  sourceRevision?: number;
};

/**
 * Server-authoritative user choices replayed into a Google Health row in
 * memory. Plaintext local projections strip this registry together with the
 * imported measurement, nutrition payload, and provider record.
 */
export type GoogleHealthEntryOverride = {
  recordedAtOverride?: string;
  localDate?: string;
  visibility?: Visibility;
  sourceUpdatedAt: string;
};

export type SyncMode = "manual" | "battery" | "balanced" | "frequent";
export type BanterTone = "supportive" | "friendly" | "ruthless" | "off";
export type FoodGoalMode = "activity_adjusted" | "fixed";
export type WeightDirection = "lose" | "maintain" | "gain";
export type LandingPage =
  | "index"
  | "log"
  | "insights"
  | "group"
  | "chat"
  | "gym"
  | "calendar"
  | "journal"
  | "performance"
  | "status";
export type ProgressViewMode = "overview" | "goal_maps" | "compact";
export type ProgressLayoutAvailability = "overview" | "goal_maps" | "both";
export type HistoryRange = "week" | "month" | "year";
export type CompletionFillMode =
  | "auto"
  | "clockwise"
  | "bottom_up"
  | "center_out";
export type TrackerViewFilter = {
  id: string;
  name: string;
  metricIds: string[];
  /** Today-only: include the To-Do block in this saved view. */
  includeTodos?: boolean;
  /** Today-only: explicit To-Dos to include; undefined preserves legacy all. */
  todoIds?: string[];
  /** Hidden saved views remain editable without cluttering quick selectors. */
  visible?: boolean;
};

/** Personal Schedule visibility preset. Logged blocks are opt-in per tracker. */
export type ScheduleViewFilter = {
  id: string;
  name: string;
  includeTodos: boolean;
  includeReminders: boolean;
  logMetricIds: string[];
};

export type TodoPriority = "low" | "normal" | "high" | "urgent";
export type TodoReminder = {
  id: string;
  /** ISO timestamp for a one-off reminder. */
  at?: string;
  /** Local HH:mm time combined with recurrence or the due date. */
  time?: string;
  /** Optional preset relative to the deadline. */
  daysBeforeDue?: number;
  /** Remind once per day from creation until the deadline or completion. */
  repeatDailyUntilDue?: boolean;
  /** Optional recurrence for this reminder, independent from task recurrence. */
  schedule?: GoalSchedule;
};

/** A dated, exact-value competition shared only with explicitly invited members. */
export type GroupChallenge = {
  id: string;
  /** The persisted series row when `id` identifies a generated occurrence. */
  sourceChallengeId?: string;
  groupId: string;
  creatorId: string;
  metricId: string;
  title?: string;
  /** Omitted for an open competition where the highest period total wins. */
  target?: number;
  /** Inclusive first scoring date. */
  localDate: string;
  /** Inclusive final scoring date; omitted legacy rows are one-day challenges. */
  endDate?: string;
  /** Everyone invited to the challenge; this also remains the RLS audience. */
  participantIds: string[];
  /** The creator is accepted at creation; invitees opt in explicitly. */
  acceptedParticipantIds?: string[];
  /** Declined invitees stay in the RLS audience so clients can invalidate safely. */
  declinedParticipantIds?: string[];
  /** A bounded recurring series; generated occurrences are never persisted. */
  recurrence?: GoalSchedule;
  createdAt: string;
  updatedAt: string;
};

/** A private, recipient-scoped item in the Leaderboard notification feed. */
export type GroupNotificationEvent = {
  id: string;
  /** Stable server identity used to make event creation idempotent. */
  eventKey: string;
  groupId: string;
  recipientId: string;
  actorId: string;
  kind:
    | "challenge_invitation"
    | "challenge_accepted"
    | "challenge_standing"
    | "challenge_reminder"
    | "challenge_result";
  challengeId: string;
  /** Scored occurrence settled by the server, including recurring series. */
  occurrenceDate?: string;
  /** Server-authored copy for standings/results; legacy invitation rows omit it. */
  title?: string;
  detail?: string;
  createdAt: string;
  readAt?: string;
};
export type TodoItem = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  dueAt?: string;
  /** Optional planned work block, independent from the deadline. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  priority: TodoPriority;
  recurrence?: GoalSchedule;
  reminders: TodoReminder[];
  /** Recurring tasks complete independently on each local date. */
  completedDates: string[];
  /** Skips are deliberate completions, rendered in pink instead of green. */
  skippedDates?: string[];
  completedAt?: string;
  /** Stable personal ordering used by Today and tracker details. */
  order?: number;
  /** Pinned to-dos remain above the rest of the Today list. */
  pinnedAt?: string;
};
export type JournalNote = {
  id: string;
  userId: string;
  title?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  localDate: string;
  metricId?: string;
  /** A note can be linked to several trackers without becoming a tracker log. */
  metricIds?: string[];
  /** Free-form journal labels created with #label. */
  labels?: string[];
  entryId?: string;
  imageUri?: string;
  /**
   * A bounded vector layer drawn over the note body and optional image.
   * Coordinates are normalized so the private account snapshot remains
   * portable across phone and web canvas sizes.
   */
  drawing?: JournalDrawing;
};
export type JournalDrawingPoint = [x: number, y: number];
export type JournalDrawingStroke = {
  id: string;
  color: string;
  width: number;
  points: JournalDrawingPoint[];
};
export type JournalDrawing = {
  version: 1;
  strokes: JournalDrawingStroke[];
};
export type TimerLap = { id: string; seconds: number; recordedAt: string };
export type ActivityTimer = {
  id: string;
  metricId: string;
  mode: "stopwatch" | "countdown";
  targetSeconds?: number;
  autoLog: boolean;
  startedAt: string;
  status: "running" | "paused";
  accumulatedSeconds: number;
  pausedAt?: string;
  laps: TimerLap[];
  notificationId?: string;
  /** All scheduled threshold/completion alerts for the current run. */
  notificationIds?: string[];
};
export type CalendarReminder = {
  id: string;
  title: string;
  kind: "general" | "tracker" | "todo";
  metricId?: string;
  todoId?: string;
  time: string;
  /** Planned duration for timed tracker reminders. */
  durationMinutes?: number;
  schedule: GoalSchedule;
  enabled: boolean;
};

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "glutes"
  | "quadriceps"
  | "hamstrings"
  | "calves"
  | "full_body";
export type GymIntensity = "light" | "moderate" | "vigorous";
export type GymCalorieCalculationMode = "session_met" | "set_aware";
export type WorkoutExerciseTrackingMode = "load_reps" | "reps" | "duration";
export type GymExerciseGoal = {
  targetOneRepMaxKg?: number;
  targetWeightKg?: number;
  targetReps?: number;
};
export type GymSet = {
  id: string;
  reps: number;
  weightKg: number;
  completed: boolean;
  /** Active time from starting to finishing this set. */
  workSeconds?: number;
  /** Rest taken after this set. Optional for older saved sessions. */
  restSeconds?: number;
  restTargetSeconds?: number;
  /** Optional second movement performed immediately with this set. */
  superset?: GymSuperset;
};
export type GymSuperset = {
  exerciseKey?: string;
  name: string;
  muscleGroups?: MuscleGroup[];
  reps: number;
  weightKg: number;
  customMet?: number;
  trackingMode?: WorkoutExerciseTrackingMode;
  /** Defaults to half of the paired set's measured active time. */
  workSeconds?: number;
};
export type GymExercise = {
  id: string;
  /** Stable catalog id keeps history continuous when display names change. */
  exerciseKey?: string;
  name: string;
  muscleGroups?: MuscleGroup[];
  sets: GymSet[];
  notes?: string;
  customMet?: number;
  /** Controls which set fields are meaningful for this exercise. */
  trackingMode?: WorkoutExerciseTrackingMode;
  /** Exercise-level completion and rest between exercises. */
  completed?: boolean;
  restAfterSeconds?: number;
  restTargetSeconds?: number;
};
export type GymPlanExercise = {
  id: string;
  exerciseKey?: string;
  name: string;
  muscleGroups?: MuscleGroup[];
  targetSets: number;
  targetReps: number;
  targetDurationMinutes?: number;
  startingWeightKg?: number;
  notes?: string;
  customMet?: number;
  trackingMode?: WorkoutExerciseTrackingMode;
  supersets?: {
    setIndex: number;
    superset: GymSuperset;
  }[];
};
export type GymPlan = {
  id: string;
  userId: string;
  name: string;
  exercises: GymPlanExercise[];
  createdAt: string;
  updatedAt: string;
};
export type GymSession = {
  id: string;
  userId: string;
  planId?: string;
  name: string;
  localDate: string;
  recordedAt: string;
  /** Present for sessions recorded with the guided workout timer. */
  startedAt?: string;
  completedAt?: string;
  pausedSeconds?: number;
  /** Seconds removed from every guided set for phone-placement time. */
  setStartDelaySeconds?: number;
  durationMinutes: number;
  calories?: number;
  /** How estimated active calories were calculated for this saved workout. */
  calorieCalculationMode?: GymCalorieCalculationMode;
  /** Distinguishes a typed override from a reproducible app estimate. */
  caloriesManual?: boolean;
  intensity?: GymIntensity;
  notes?: string;
  exercises: GymExercise[];
  visibility: Visibility;
};

export type HealthSyncSettings = {
  enabled: boolean;
  dataTypes: Record<HealthDataType, boolean>;
  /** Observed native writers and their device-local import preference. */
  sourcePreferences?: Record<string, HealthSourcePreference>;
  /** Requested separately because both mobile operating systems may decline it. */
  backgroundAccess: boolean;
  /**
   * One-shot onboarding handoff. Health permissions are granted before the
   * first import is intentionally deferred, so the reducer consumes this flag
   * when that initial history arrives after onboarding navigation completes.
   */
  backfillTrackedGoalsOnFirstImport?: boolean;
  /** One transient empty read may retry before the one-shot handoff expires. */
  backfillTrackedGoalsEmptyReadCount?: number;
  /** One-shot import selected during onboarding; cleared after its final chunk. */
  initialHistoryImportPending?: boolean;
};

export type HealthSourcePreference = {
  /** Raw Health Connect package id or HealthKit source name. */
  origin: string;
  /** Unknown/new writers default to enabled until the user turns one off. */
  enabled: boolean;
};

export type EnergyProfile = {
  age: number;
  sex: BiologicalSex;
  heightCm: number;
  /** Baseline retained for total progress even as current weight updates. */
  startingWeightKg?: number;
  weightKg: number;
  /** Optional measured body-fat percentage used by the private body profile. */
  bodyFatPercent?: number;
  /** Optional measured lean body mass, including non-fat tissue, in kilograms. */
  leanBodyMassKg?: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  /** Optional baseline activity estimate; synced exercise remains separate. */
  dailyActivityCaloriesOverride?: number;
  desiredWeeklyLossKg: number;
};

export type VacationPeriod = {
  from: string;
  /** Missing while vacation mode is still active. */
  to?: string;
};

/**
 * Personal, durable state for the current intermittent-fasting interaction.
 * A metric definition owns the schedule; this record only owns one member's
 * manual start/end state and must never be copied into group configuration.
 */
export type FastingRuntimeSetting = {
  /** ISO timestamp at which the represented fast began. */
  startedAt: string;
  /** Distinguishes a Start-button session from an inferred automatic fast. */
  startedManually: boolean;
  /** ISO timestamp once the represented fast has been completed. */
  endedAt?: string;
  /** How this runtime session was completed. */
  endedBy?: "manual" | "food";
  /** Food row that completed a manual-start session, for safe reconciliation. */
  endedByFoodEntryId?: string;
  /** Prevent inferred progress from immediately restarting after manual End. */
  suppressAutomaticUntil?: string;
};

/** App-owned interface language. User content is never machine-translated. */
export type AppLanguage =
  | "en"
  | "ar"
  | "es"
  | "zh-Hans"
  | "sv"
  | "de"
  | "ru"
  | "fr";

/** Code-native Status figure treatment; both modes share the same live body geometry. */
export type StatusAvatarStyle = "silhouette" | "body_model";

/** Personal card-flow choice; omitted remains the original vertical list. */
export type DashboardLayoutMode = "scroll" | "pages";

/** Personal choice of measurements used to select the Status body sprite. */
export type StatusAvatarCalculationSource = "bmi" | "body_composition";

export type UserSettings = {
  /** Legacy/manual fallback. Formula variable `baseline` now resolves to calculated daily energy. */
  baselineCalories: number;
  energyProfile: EnergyProfile;
  syncMode: SyncMode;
  healthSync: HealthSyncSettings;
  /** Explicit repair window; routine sync always uses a small overlap. */
  healthHistoryDays?: 30 | 90 | 365 | 730;
  banterTone: BanterTone;
  autoMessages: boolean;
  cheerMessage: string;
  tauntMessage: string;
  reminderMessage: string;
  /** Legacy v15 setting retained while old snapshots migrate. */
  featuredTodayCard: "score" | string;
  defaultLandingPage: LandingPage;
  /** Interface language; stored as a portable BCP-47-compatible id. */
  language: AppLanguage;
  /** Personal navigation-tab order; hidden tabs retain their place for later. */
  tabOrder?: LandingPage[];
  /** Local clock time after which accumulating daily goals become final. */
  dayEndTime?: string;
  compactMode: boolean;
  /** App-controlled text scale; system font scaling is disabled so layouts stay synchronized. */
  fontScale: number;
  /** Show every Today tile in the main scroll instead of using the More sheet. */
  showAllTodayTiles: boolean;
  /** Maximum main-screen tiles before More appears when showAllTodayTiles is off. */
  todayTileLimit: number;
  /** Optional horizontal, screen-sized tracker pages on Today. */
  todayLayoutMode?: DashboardLayoutMode;
  /** Optional horizontal ranking-card pages on Leaderboard. */
  leaderboardLayoutMode?: DashboardLayoutMode;
  darkMode: boolean;
  /** User-owned accent. It never mutates group configuration. */
  personalThemeColor?: string;
  /** Prefer personalThemeColor over the active group's accent on this device/account. */
  overrideGroupTheme?: boolean;
  /** Calendar week start used by app-owned week ranges. */
  weekStartsOn?: 0 | 1 | 6;
  /** Progress supports the original combined chart and two goal-map layouts. */
  progressViewMode?: ProgressViewMode;
  /** Choose whether Progress exposes Overview, Grid map, or both layouts. */
  progressLayoutAvailability?: ProgressLayoutAvailability;
  /** Condense Grid map cards without creating a separate navigation mode. */
  compactProgressGrid?: boolean;
  /** Device-local disclosure state for the Grid map date navigator. */
  progressGridDateNavigatorCollapsed?: boolean;
  progressHistoryRange?: HistoryRange;
  /** Shared Progress anchor so switching layouts preserves the same period. */
  progressHistoryAnchor?: string;
  /** Optional per-tracker history strip on Today. */
  todayHistoryByMetric?: Record<string, HistoryRange | "off">;
  /** One shared range for every enabled Today history strip. */
  todayHistoryRange?: HistoryRange;
  /** One global disclosure replaces per-tile history visibility controls. */
  todayHistoryCollapsed?: boolean;
  /** Saved personal views are never written into group configuration. */
  trackerViewFilters?: TrackerViewFilter[];
  /** Legacy shared selection retained while stored snapshots migrate. */
  activeTrackerViewFilterId?: string;
  activeTodayTrackerViewFilterId?: string;
  activeProgressTrackerViewFilterId?: string;
  activePerformanceTrackerViewFilterId?: string;
  showUntrackedToday?: boolean;
  showUntrackedProgress?: boolean;
  showUntrackedLeaderboardByGroup?: Record<string, boolean>;
  /** Choose whether completed Today goals stay put, move down, or disappear. */
  completedTodayBehavior?: "stay" | "bottom" | "hide";
  /** Optional visual used for the hero completion indicator. */
  completionIndicatorIcon?: string;
  /** How the selected completion symbol reveals its completed portion. */
  completionIndicatorFillMode?: CompletionFillMode;
  /** Show the percentage-revealed outline around Today's featured card. */
  showFeaturedCardProgressOutline?: boolean;
  /** Keep Today's page header and featured summary visible while the list scrolls. */
  pinTodayHeaderAndFeaturedCard?: boolean;
  /** Personal visual treatment for the continuously morphed Status figure. */
  statusAvatarStyle?: StatusAvatarStyle;
  /** Defaults to BMI; composition is used only when both required readings exist. */
  statusAvatarCalculationSource?: StatusAvatarCalculationSource;
  /** Remember whether the Status range/date controls were collapsed. */
  statusDateNavigatorCollapsed?: boolean;
  /** Put the to-do block below goal trackers instead of above them. */
  todosBelowGoals?: boolean;
  /** Personal ordering for mixed Schedule-page events. */
  calendarEventOrder?: string[];
  /** First visible hour in Schedule; earlier hours remain reachable by scrolling. */
  scheduleStartHour?: number;
  /** Saved personal combinations of to-dos, reminders and selected log blocks. */
  scheduleViewFilters?: ScheduleViewFilter[];
  activeScheduleViewFilterId?: string;
  /** Applies to every app-owned clock label and time input preview. */
  timeFormat?: "12h" | "24h";
  /** Optional shortcut tab; logging remains available from tracker details. */
  showLog: boolean;
  showLeaderboard: boolean;
  showChat: boolean;
  /** Optional dedicated strength-training tab. */
  showGym?: boolean;
  showCalendar?: boolean;
  showJournal?: boolean;
  /** Optional Today-header shortcuts; tabs may remain hidden independently. */
  showCalendarShortcut?: boolean;
  showJournalShortcut?: boolean;
  showPerformance?: boolean;
  /** Default-visible avatar-and-goal Status tab; users may hide it in Display. */
  showStatus?: boolean;
  showTodosToday?: boolean;
  /** Hide tracked-goal tiles from Today without changing tracking history. */
  showGoalsToday?: boolean;
  /** Elapsed stopwatch/countdown thresholds that trigger local alerts. */
  activityTimerAlertMinutes?: number[];
  /** Floating timer stays hidden while timers continue running. */
  showActivityTimerOverlay?: boolean;
  /** Optional assistant entry point; cloud AI is proxied through a server function. */
  showAiAssistant?: boolean;
  onboardingComplete: boolean;
  /** Persisted schema marker for account-safe first-run setup. */
  onboardingVersion?: number;
  tutorialComplete: boolean;
  advancedTutorialComplete: boolean;
  /** Active basic-guide replay selected from Quick Guide. */
  tutorialGuideId?: string;
  /** Changes for every replay so the overlay reliably returns to step one. */
  tutorialGuideRunId?: number;
  selectedGoals: string[];
  /** Whether this person wants a lose, maintain, or gain weight plan. */
  weightManagementEnabled?: boolean;
  /** Show the compact weight/body-fat/target summary on Today and Status. */
  showWeightManagementSummary?: boolean;
  /** Whether logged active energy raises that day's food allowance. */
  foodGoalMode: FoodGoalMode;
  /** Remembered nutrients in the Food detail filter, including temporarily unavailable ones. */
  foodNutrientIds?: string[];
  /** Preferred multi-day nutrition visualization. */
  foodNutritionRangeMode?: "average" | "individual";
  /** Personal Start/End state keyed by intermittent-fasting metric id. */
  fastingRuntimeByMetric?: Record<string, FastingRuntimeSetting>;
  /** Personal pause periods protect goal streaks without inventing measurements. */
  vacationPeriods?: VacationPeriod[];
  /** Personal weekly rest allowance used by Today and Progress streaks. */
  streakRestDaysPerWeek?: number;
  weightDirection: WeightDirection;
  /** Personal aliases are scoped to the group where they were assigned. */
  memberNicknamesByGroup: Record<string, Record<string, string>>;
  /** Up to five badge ids the current user chose to feature in each group. */
  badgeShowcaseByGroup: Record<string, string[]>;
  progressMetricIds: string[];
  /** Personal Progress card order, independent from filters and visibility. */
  progressMetricOrderIds?: string[];
  /** Personally pinned Progress cards; pins sort first outside edit mode. */
  progressPinnedMetricIds?: string[];
  /** Personal Performance tiles; omitted means every compatible tracker. */
  performanceMetricIds?: string[];
  /** Personal Performance order, independent from Progress and groups. */
  performanceMetricOrderIds?: string[];
  /** Personally pinned Performance tiles; pins sort before temporary insights. */
  performancePinnedMetricIds?: string[];
  performanceRange?: "day" | "week" | "month" | "year";
  leaderboardMetricIdsByGroup: Record<string, string[]>;
  /** Personal pinned Leaderboard cards; metric ids and challenge-prefixed ids share one order. */
  leaderboardPinnedMetricIdsByGroup?: Record<string, string[]>;
  /** Unified metric/challenge card order. Unknown ids are ignored during rendering. */
  leaderboardCardOrderByGroup?: Record<string, string[]>;
  /** Completed challenge celebrations already shown on this account/device. */
  seenChallengeCelebrationIdsByGroup?: Record<string, string[]>;
  /** Personal calendar range shown inside expanded Leaderboard member rows. */
  leaderboardGridRangeByGroup?: Record<string, HistoryRange>;
  comparisonMetricIdsByGroup: Record<string, string[]>;
  comparisonPeriodByGroup: Record<
    string,
    | "today"
    | "yesterday"
    | "week"
    | "month"
    | "year"
    | "overall"
    | "custom"
  >;
  /** Imported health records the user explicitly hid/deleted. */
  dismissedHealthEntryIds?: string[];
  /** Minimal edit intent for cloud-only Google rows; never contains a health value. */
  googleHealthEntryOverrides?: Record<string, GoogleHealthEntryOverride>;
  /** Explicit cloud deletes; absence from a bounded cache is never a delete. */
  pendingDeletedEntryIds?: string[];
  /** Explicit progress-photo deletes awaiting relational cloud acknowledgement. */
  pendingDeletedPhotoIds?: string[];
  /** Durable tombstones prevent an offline device or stale fetch reviving logs. */
  deletedEntryIds?: string[];
  /** Durable tombstones prevent deleted progress photos being revived. */
  deletedPhotoIds?: string[];
  /** Durable local-first outbox for administrator-owned group configuration. */
  pendingGroupConfigurationIds?: string[];
  /** Tracker privacy revocations awaiting a revision-checked group fence. */
  pendingMetricPrivacyFenceIdsByGroup?: Record<string, string[]>;
  /** Legacy v6 aliases retained only while migrating stored demo state. */
  memberNicknames?: Record<string, string>;
  notifications: NotificationSettings;
};

export type NotificationSettings = {
  pushEnabled: boolean;
  groupMetricActivity: boolean;
  leadChanges: boolean;
  metricIds: string[];
  chatMessages: boolean;
  groupMembership?: boolean;
  /** Invitations and response updates for shared group challenges. */
  challenges?: boolean;
  badgesAndWinners: boolean;
  reminders: boolean;
  /** Schedule local notifications for dated and recurring to-dos. */
  todoReminders?: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  mutedGroupIds?: string[];
  /** Personal delivery rules for one group; missing fields keep legacy globals. */
  groupPreferencesByGroup?: Record<string, GroupNotificationPreferences>;
  mutedConversationIds?: string[];
  /** Private read cursors used for lightweight unread chat indicators. */
  chatReadAtByConversation?: Record<string, string>;
  missedGoalNudges?: boolean;
  streakAlerts?: boolean;
  /** Private on-device estimates derived from the user's own period-start history. */
  cyclePredictions?: boolean;
  cyclePhaseUpdates?: boolean;
  cycleReminderDays?: number;
  /** Private inactivity reminders for the strength-training workspace. */
  gymReminders?: boolean;
  /** Private personal-best and consistency encouragement. */
  gymAchievements?: boolean;
  /** Wait this many full days after the latest completed workout session. */
  gymReminderDays?: number;
};

export type GroupNotificationPreferences = {
  /** Master switch for non-chat activity from this group. */
  enabled?: boolean;
  /** Fresh shared tracker logs. */
  trackerUpdates?: boolean;
  /** Legacy pre-release field retained while older local snapshots migrate. */
  progressUpdates?: boolean;
  /** Explicit overtakes and first-place changes. */
  leadChanges?: boolean;
  /** Undefined means all members; an explicit empty array means none. */
  memberIds?: string[];
  /** Undefined means the global tracker selection; empty means none. */
  metricIds?: string[];
  challengeUpdates?: boolean;
  challengeStandings?: boolean;
  challengeReminders?: boolean;
  challengeResults?: boolean;
  challengeCadence?: "minimal" | "balanced" | "frequent";
};

export type TrackedGoalPeriod = { from: string; to?: string };

export type Group = {
  id: string;
  /** Server CAS token for administrator-owned group configuration. */
  configurationRevision?: number;
  name: string;
  inviteCode: string;
  templateName: string;
  members: Member[];
  /** Number of missed days permitted inside each rolling seven-day streak window. */
  streakRestDaysPerWeek: number;
  /** Group-owned accent used throughout the app while this group is active. */
  themeColor?: string;
  /** When enabled, invite joins wait for an admin to approve them. */
  requireMemberApproval?: boolean;
  /** Membership requests visible only to group admins. */
  pendingMembers?: Member[];
  /** Versioned locally in demo mode; cloud mode stores this as group-owned configuration. */
  metricConfiguration?: MetricDefinition[];
  /** Admin-published workout templates shared into every member's Workout picker. */
  gymPlans?: GymPlan[];
};

export type AppState = {
  /** v27 signals Google-health-aware fail-closed local persistence. */
  version: 27;
  currentUserId: string;
  group: Group;
  groups: Group[];
  /** Private per-member profiles used by calculated energy metrics. */
  energyProfiles: Record<string, EnergyProfile>;
  metrics: MetricDefinition[];
  entries: MetricEntry[];
  photos: PhotoUpdate[];
  messages: ChatMessage[];
  /** Value-free status rows shared when the underlying entry is not exact-value visible. */
  dailyMetricStatuses: DailyMetricStatus[];
  gymPlans?: GymPlan[];
  gymSessions?: GymSession[];
  gymExerciseGoals?: Record<string, GymExerciseGoal>;
  todos?: TodoItem[];
  journalNotes?: JournalNote[];
  calendarReminders?: CalendarReminder[];
  /** Multiple local activity timers can run independently. */
  activityTimers?: ActivityTimer[];
  /** Legacy selected timer retained while older snapshots migrate. */
  activeTimer?: ActivityTimer;
  settings: UserSettings;
  /** Preserves which goals counted on each historical date. */
  trackedGoalPeriods: Record<string, TrackedGoalPeriod[]>;
  selectedGroupMetricId: string;
  lastSavedAt: string | null;
};

export type EntryDetails = {
  note?: string;
  label?: string;
  imageUri?: string;
  localDate?: string;
  recordedAt?: string;
  nutrition?: NutritionDetails;
  submetricValues?: Record<string, number>;
};

export type NewEntry = Pick<
  MetricEntry,
  "metricId" | "value" | "visibility" | "note"
> & {
  localDate?: string;
};

export type NewMetric = Pick<
  MetricDefinition,
  | "name"
  | "icon"
  | "color"
  | "unit"
  | "dataType"
  | "aggregation"
  | "goal"
  | "adaptiveGoalTarget"
  | "rankingDirection"
  | "defaultVisibility"
  | "goalEnabled"
  | "goalRange"
  | "goalProgressMode"
  | "category"
  | "grouping"
  | "healthMapping"
  | "gymMapping"
  | "gymMuscleGroups"
  | "stepFallback"
  | "manualEntry"
  | "timerEnabled"
  | "fastingSettings"
  | "submetrics"
  | "submetricDisplay"
  | "visualization"
  | "goalSchedule"
  | "reminder"
  | "reminders"
  | "progressReminderPercentages"
  | "progressRemindersEnabled"
> & {
  formula?: string;
  activeFrom?: string;
  /** Explicitly add this tracker to Today and tracked-goal history. */
  trackGoal?: boolean;
  /** Show on Today without counting it as a tracked goal. */
  addToToday?: boolean;
  /** Stable id used when adding a built-in preset after it was previously removed. */
  templateId?: string;
};

export type GroupCreationOptions = {
  /** Only these explicitly reviewed trackers are created for the group. */
  metrics?: NewMetric[];
  themeColor?: string;
  requireMemberApproval?: boolean;
};
