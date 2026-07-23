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
  | "mind"
  | "photos"
  | "other";

export type MetricGoal = {
  kind: GoalKind;
  target: number;
};

export type GoalSchedule = {
  mode:
    | "daily"
    | "selected_days"
    | "every_other_day"
    | "weekly_min"
    | "monthly_min";
  /** JavaScript weekday numbers: Sunday 0 through Saturday 6. */
  daysOfWeek?: number[];
  minimumCompletions?: number;
  anchorDate?: string;
};

export type GoalReminder = { enabled: boolean; time: string };

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
  /** Advanced: some health readings are informational and have no target. */
  goalEnabled?: boolean;
  /** Optional healthy/desired range, used instead of an exact point target. */
  goalRange?: { min: number; max: number };
  category?: TrackerCategory;
  healthMapping?: HealthMetricMapping;
  /** Estimate uncovered walking activity from steps when no canonical activity calories exist. */
  stepFallback?: boolean;
  /** False for device-owned readings such as steps. */
  manualEntry?: boolean;
  scoreWeight: number;
  formula?: string;
  defaultVisibility: Visibility;
  sections: Record<DashboardSection, boolean>;
  order: number;
  /** Goals and completion scoring apply from this local date forward. */
  activeFrom: string;
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
};

export type SyncMode = "manual" | "battery" | "balanced" | "frequent";
export type BanterTone = "supportive" | "friendly" | "ruthless" | "off";
export type FoodGoalMode = "activity_adjusted" | "fixed";
export type WeightDirection = "lose" | "maintain" | "gain";
export type LandingPage = "index" | "log" | "insights" | "group" | "chat" | "gym";

export type GymSet = {
  id: string;
  reps: number;
  weightKg: number;
  completed: boolean;
};
export type GymExercise = { id: string; name: string; sets: GymSet[] };
export type GymPlanExercise = {
  id: string;
  name: string;
  targetSets: number;
  targetReps: number;
  startingWeightKg?: number;
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
  durationMinutes: number;
  calories?: number;
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

export type UserSettings = {
  /** Legacy/manual fallback. Formula variable `baseline` now resolves to calculated daily energy. */
  baselineCalories: number;
  energyProfile: EnergyProfile;
  syncMode: SyncMode;
  healthSync: HealthSyncSettings;
  banterTone: BanterTone;
  autoMessages: boolean;
  cheerMessage: string;
  tauntMessage: string;
  reminderMessage: string;
  /** Legacy v15 setting retained while old snapshots migrate. */
  featuredTodayCard: "score" | string;
  defaultLandingPage: LandingPage;
  compactMode: boolean;
  /** App-controlled text scale; system font scaling is disabled so layouts stay synchronized. */
  fontScale: number;
  /** Show every Today tile in the main scroll instead of using the More sheet. */
  showAllTodayTiles: boolean;
  /** Maximum main-screen tiles before More appears when showAllTodayTiles is off. */
  todayTileLimit: number;
  darkMode: boolean;
  showLeaderboard: boolean;
  showChat: boolean;
  /** Optional dedicated strength-training tab. */
  showGym?: boolean;
  onboardingComplete: boolean;
  tutorialComplete: boolean;
  advancedTutorialComplete: boolean;
  selectedGoals: string[];
  /** Whether logged active energy raises that day's food allowance. */
  foodGoalMode: FoodGoalMode;
  weightDirection: WeightDirection;
  /** Personal aliases are scoped to the group where they were assigned. */
  memberNicknamesByGroup: Record<string, Record<string, string>>;
  /** Up to five badge ids the current user chose to feature in each group. */
  badgeShowcaseByGroup: Record<string, string[]>;
  progressMetricIds: string[];
  leaderboardMetricIdsByGroup: Record<string, string[]>;
  comparisonMetricIdsByGroup: Record<string, string[]>;
  comparisonPeriodByGroup: Record<
    string,
    "today" | "yesterday" | "week" | "month" | "custom"
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
  badgesAndWinners: boolean;
  reminders: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  mutedGroupIds?: string[];
  mutedConversationIds?: string[];
  missedGoalNudges?: boolean;
  streakAlerts?: boolean;
  /** Private on-device estimates derived from the user's own period-start history. */
  cyclePredictions?: boolean;
  cyclePhaseUpdates?: boolean;
  cycleReminderDays?: number;
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
};

export type AppState = {
  version: 21;
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
  | "category"
  | "healthMapping"
  | "stepFallback"
  | "manualEntry"
  | "goalSchedule"
  | "reminder"
  | "reminders"
> & {
  formula?: string;
  activeFrom?: string;
  /** Stable id used when adding a built-in preset after it was previously removed. */
  templateId?: string;
};
