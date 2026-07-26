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
export type DashboardSection = "today" | "group" | "insights";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active"
  | "athlete";
export type BiologicalSex = "female" | "male" | "unspecified";
export type HealthProvider = "apple_health" | "health_connect";
export type HealthDataType =
  | "steps"
  | "active_energy"
  | "weight"
  | "nutrition"
  | "water"
  | "workouts"
  | "body_fat"
  | "lean_body_mass"
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
  | "vitamin_b12";
export type HealthMetricMapping = {
  dataType: HealthDataType;
  field: HealthMetricField;
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
};

export type MetricSubmetricDisplay = {
  mode: "separate" | "merged";
  /** Tokens such as {systolic}/{diastolic} {systolic.unit}. */
  template?: string;
  collapsible?: boolean;
  collapsibleLabel?: string;
  /** First N submetrics stay visible; later fields follow creation order under the disclosure. */
  visibleInputCount?: number;
};

export type GymMetricMapping =
  | { kind: "session_completed" }
  | { kind: "session_duration" }
  | { kind: "session_volume" }
  | { kind: "completed_sets" }
  | { kind: "exercise_one_rep_max"; exerciseKey: string }
  | { kind: "exercise_volume"; exerciseKey: string }
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
};

export type GoalReminder = {
  enabled: boolean;
  time: string;
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
  /** Primary muscles for a custom exercise-backed Gym tracker. */
  gymMuscleGroups?: MuscleGroup[];
  /** Estimate uncovered walking activity from steps when no canonical activity calories exist. */
  stepFallback?: boolean;
  /** False for device-owned readings such as steps. */
  manualEntry?: boolean;
  /** Allow this numeric tracker to be selected by the activity timer. */
  timerEnabled?: boolean;
  /** Advanced compound tracker fields (for example BP or nutrition). */
  submetrics?: MetricSubmetric[];
  submetricDisplay?: MetricSubmetricDisplay;
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
};

export type Member = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: "owner" | "admin" | "member";
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
};

export type ChatMessage = {
  id: string;
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
  /** Distinguishes a real status-only measurement from an empty daily snapshot. */
  hasData?: boolean;
  /** Last cloud update for this member's daily group snapshot. */
  syncedAt?: string;
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
  | "performance";
export type ProgressViewMode = "overview" | "goal_maps" | "compact";
export type HistoryRange = "week" | "month" | "year";
export type TrackerViewFilter = {
  id: string;
  name: string;
  metricIds: string[];
  /** Hidden saved views remain editable without cluttering quick selectors. */
  visible?: boolean;
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
};
export type TodoItem = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  dueAt?: string;
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
  startingWeightKg?: number;
  notes?: string;
  customMet?: number;
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
  durationMinutes: number;
  calories?: number;
  intensity?: GymIntensity;
  notes?: string;
  exercises: GymExercise[];
  visibility: Visibility;
};

export type HealthSyncSettings = {
  enabled: boolean;
  dataTypes: Record<HealthDataType, boolean>;
  /** Requested separately because both mobile operating systems may decline it. */
  backgroundAccess: boolean;
};

export type EnergyProfile = {
  age: number;
  sex: BiologicalSex;
  heightCm: number;
  /** Baseline retained for total progress even as current weight updates. */
  startingWeightKg?: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  desiredWeeklyLossKg: number;
};

export type VacationPeriod = {
  from: string;
  /** Missing while vacation mode is still active. */
  to?: string;
};

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
  darkMode: boolean;
  /** User-owned accent. It never mutates group configuration. */
  personalThemeColor?: string;
  /** Prefer personalThemeColor over the active group's accent on this device/account. */
  overrideGroupTheme?: boolean;
  /** Calendar week start used by app-owned week ranges. */
  weekStartsOn?: 0 | 1 | 6;
  /** Progress supports the original combined chart and two goal-map layouts. */
  progressViewMode?: ProgressViewMode;
  /** Condense Grid map cards without creating a separate navigation mode. */
  compactProgressGrid?: boolean;
  progressHistoryRange?: HistoryRange;
  /** Shared Progress anchor so switching layouts preserves the same period. */
  progressHistoryAnchor?: string;
  /** Optional per-tracker history strip on Today. */
  todayHistoryByMetric?: Record<string, HistoryRange | "off">;
  /** One shared range for every enabled Today history strip. */
  todayHistoryRange?: HistoryRange;
  /** Saved personal views are never written into group configuration. */
  trackerViewFilters?: TrackerViewFilter[];
  /** Legacy shared selection retained while stored snapshots migrate. */
  activeTrackerViewFilterId?: string;
  activeTodayTrackerViewFilterId?: string;
  activeProgressTrackerViewFilterId?: string;
  showUntrackedToday?: boolean;
  showUntrackedProgress?: boolean;
  showUntrackedLeaderboardByGroup?: Record<string, boolean>;
  /** Choose whether completed Today goals move down or disappear until edit mode. */
  completedTodayBehavior?: "bottom" | "hide";
  /** Optional visual used for the hero completion indicator. */
  completionIndicatorIcon?: string;
  /** Put the to-do block below goal trackers instead of above them. */
  todosBelowGoals?: boolean;
  /** Personal ordering for mixed Schedule-page events. */
  calendarEventOrder?: string[];
  /** First visible hour in Schedule; earlier hours remain reachable by scrolling. */
  scheduleStartHour?: number;
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
  showPerformance?: boolean;
  showTodosToday?: boolean;
  /** Elapsed stopwatch/countdown thresholds that trigger local alerts. */
  activityTimerAlertMinutes?: number[];
  /** Optional assistant entry point; cloud AI is proxied through a server function. */
  showAiAssistant?: boolean;
  onboardingComplete: boolean;
  tutorialComplete: boolean;
  advancedTutorialComplete: boolean;
  selectedGoals: string[];
  /** Whether logged active energy raises that day's food allowance. */
  foodGoalMode: FoodGoalMode;
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
  leaderboardMetricIdsByGroup: Record<string, string[]>;
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
  badgesAndWinners: boolean;
  reminders: boolean;
  /** Schedule local notifications for dated and recurring to-dos. */
  todoReminders?: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  mutedGroupIds?: string[];
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
  /** Wait this many full days after the latest completed gym session. */
  gymReminderDays?: number;
  /** Alert while a live rest timer is running substantially past its target. */
  gymRestAlerts?: boolean;
};

export type TrackedGoalPeriod = { from: string; to?: string };

export type Group = {
  id: string;
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
  /** Admin-published workout templates shared into every member's Gym picker. */
  gymPlans?: GymPlan[];
};

export type AppState = {
  version: 23;
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
  | "submetrics"
  | "submetricDisplay"
  | "goalSchedule"
  | "reminder"
  | "reminders"
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
