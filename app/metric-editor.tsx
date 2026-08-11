import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale } from "@/src/i18n";
import { ColorSpectrumPicker } from "@/src/components/ColorSpectrumPicker";
import { TimeInput } from "@/src/components/TimeInput";

import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { InfoPopover } from "@/src/components/InfoPopover";
import { useWebBeforeUnload } from "@/src/components/useWebBeforeUnload";
import {
  isAllowedTrackerColor,
  TRACKER_COLOR_CHOICES,
} from "@/src/domain/colors";
import { energyFormulaVariables } from "@/src/domain/energy";
import { dateKey } from "@/src/domain/date";
import { MUSCLE_LABELS } from "@/src/domain/exerciseCatalog";
import { evaluateFormula, formulaIdentifiers } from "@/src/domain/formula";
import {
  defaultProgressReminderPercentages,
  defaultReminderTimes,
} from "@/src/domain/reminders";
import { trackerPresets, TrackerPreset } from "@/src/domain/trackerCatalog";
import { metricVisualization } from "@/src/domain/visualization";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  Aggregation,
  GoalKind,
  GoalSchedule,
  HealthDataType,
  HealthMetricField,
  MetricDataType,
  MetricDefinition,
  MetricChartStyle,
  MetricSubmetric,
  MuscleGroup,
  NewMetric,
  RankingDirection,
  TrackerCategory,
  Visibility,
} from "@/src/types";

const ICONS = [
  "walk-outline",
  "fitness-outline",
  "heart-outline",
  "leaf-outline",
  "water-outline",
  "star-outline",
  "restaurant-outline",
  "flash-outline",
  "trending-down-outline",
  "barbell-outline",
  "bicycle-outline",
  "body-outline",
  "bed-outline",
  "book-outline",
  "bulb-outline",
  "calendar-outline",
  "camera-outline",
  "checkmark-circle-outline",
  "flower-outline",
  "medkit-outline",
  "moon-outline",
  "pencil-outline",
  "pulse-outline",
  "reader-outline",
  "school-outline",
  "time-outline",
  "trophy-outline",
  "analytics-outline",
  "apps-outline",
  "basket-outline",
  "bonfire-outline",
  "cafe-outline",
  "checkbox-outline",
  "clipboard-outline",
  "cloud-outline",
  "color-palette-outline",
  "construct-outline",
  "earth-outline",
  "eye-outline",
  "fast-food-outline",
  "flag-outline",
  "football-outline",
  "game-controller-outline",
  "happy-outline",
  "headset-outline",
  "hourglass-outline",
  "library-outline",
  "musical-notes-outline",
  "nutrition-outline",
  "partly-sunny-outline",
  "people-outline",
  "person-outline",
  "podium-outline",
  "ribbon-outline",
  "rocket-outline",
  "shirt-outline",
  "sparkles-outline",
  "stopwatch-outline",
  "sunny-outline",
  "sync-outline",
  "timer-outline",
  "trail-sign-outline",
  "videocam-outline",
] as const;
const CATEGORIES: {
  id: TrackerCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "goals", label: "Goal", icon: "flag-outline" },
  { id: "activity", label: "Activity", icon: "walk-outline" },
  { id: "nutrition", label: "Food", icon: "restaurant-outline" },
  { id: "body", label: "Body", icon: "body-outline" },
  { id: "health", label: "Health", icon: "heart-outline" },
  { id: "gym", label: "Workout", icon: "barbell-outline" },
  { id: "mind", label: "Mind", icon: "book-outline" },
  { id: "photos", label: "Photos", icon: "camera-outline" },
  { id: "other", label: "Other", icon: "apps-outline" },
];

function clockPlusMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = ((hour * 60 + minute + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clockDurationMinutes(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const delta = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  return delta > 0 ? delta : delta + 1440;
}
const SOURCES: {
  id: HealthDataType;
  label: string;
  fields: { id: HealthMetricField; label: string }[];
  platforms?: readonly ("android" | "ios")[];
}[] = [
  {
    id: "steps",
    label: "Steps",
    fields: [{ id: "value", label: "Step count" }],
  },
  {
    id: "active_energy",
    label: "Active calories",
    fields: [{ id: "value", label: "Calories" }],
  },
  {
    id: "workouts",
    label: "Workout",
    fields: [
      { id: "duration_minutes", label: "Duration" },
      { id: "active_calories", label: "Calories" },
      { id: "distance_km", label: "Distance" },
      { id: "value", label: "Completed" },
    ],
  },
  {
    id: "sleep",
    label: "Sleep",
    fields: [{ id: "duration_minutes", label: "Duration" }],
  },
  { id: "weight", label: "Weight", fields: [{ id: "value", label: "Weight" }] },
  {
    id: "body_fat",
    label: "Body fat",
    fields: [{ id: "value", label: "Percentage" }],
  },
  {
    id: "lean_body_mass",
    label: "Lean mass",
    fields: [{ id: "value", label: "Mass" }],
  },
  {
    id: "body_water_mass",
    label: "Body water mass",
    fields: [{ id: "value", label: "Mass" }],
    platforms: ["android"],
  },
  {
    id: "bone_mass",
    label: "Bone mass",
    fields: [{ id: "value", label: "Mass" }],
    platforms: ["android"],
  },
  {
    id: "blood_pressure",
    label: "Blood pressure",
    fields: [
      { id: "systolic", label: "Systolic" },
      { id: "diastolic", label: "Diastolic" },
    ],
  },
  {
    id: "heart_rate",
    label: "Heart rate",
    fields: [{ id: "value", label: "Pulse" }],
  },
  {
    id: "blood_glucose",
    label: "Blood glucose",
    fields: [{ id: "value", label: "Reading" }],
  },
  { id: "water", label: "Water", fields: [{ id: "value", label: "Volume" }] },
  {
    id: "menstruation",
    label: "Menstrual cycle",
    fields: [{ id: "value", label: "Recorded day" }],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    fields: [
      { id: "value", label: "Calories" },
      { id: "protein", label: "Protein" },
      { id: "fat", label: "Fat" },
      { id: "carbs", label: "Carbs" },
      { id: "fiber", label: "Fiber" },
      { id: "sodium", label: "Sodium" },
      { id: "sugar", label: "Sugar" },
      { id: "saturated_fat", label: "Saturated fat" },
      { id: "cholesterol", label: "Cholesterol" },
      { id: "potassium", label: "Potassium" },
      { id: "calcium", label: "Calcium" },
      { id: "iron", label: "Iron" },
      { id: "magnesium", label: "Magnesium" },
      { id: "vitamin_c", label: "Vitamin C" },
      { id: "vitamin_d", label: "Vitamin D" },
      { id: "vitamin_b12", label: "Vitamin B12" },
    ],
  },
];

const AVAILABLE_SOURCES = SOURCES.filter(
  (source) =>
    !source.platforms ||
    ((Platform.OS === "android" || Platform.OS === "ios") &&
      source.platforms.includes(Platform.OS)),
);

export default function TrackerEditor() {
  const { id, scope, focus } = useLocalSearchParams<{
    id?: string;
    scope?: string;
    focus?: string;
  }>();
  const groupScope = scope === "group";
  const navigation = useNavigation();
  const {
    state,
    addMetric,
    addMetrics,
    updateMetric,
    deleteMetric,
    addGroupMetric,
    addGroupMetrics,
    updateGroupMetric,
    deleteGroupMetric,
    updateSettings,
    setTrackedGoal,
    setMetricSection,
  } = useApp();
  const sourceMetrics = groupScope
    ? (state.group.metricConfiguration ?? [])
    : state.metrics;
  const tracker =
    id && id !== "new"
      ? sourceMetrics.find((item) => item.id === id)
      : undefined;
  const trackerVisualDefaults = tracker
    ? metricVisualization(tracker)
    : {
        detailDay: "progress" as const,
        detailRange: "bar" as const,
        progressOverview: "bar" as const,
        progressGrid: "intensity" as const,
      };
  const linkedScheduledReminders =
    !groupScope && tracker
      ? (state.calendarReminders ?? []).filter(
          (reminder) =>
            reminder.kind === "tracker" && reminder.metricId === tracker.id,
        )
      : [];
  const trackerPeriods = tracker
    ? state.trackedGoalPeriods[tracker.id]
    : undefined;
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const presets = trackerPresets(state).filter(
    (preset) =>
      !sourceMetrics.some((item) => item.id === preset.templateId) &&
      (preset.category !== "gym" || state.settings.showGym),
  );
  const [presetId, setPresetId] = useState("");
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const bulkPresetMode = !tracker && selectedPresetIds.length > 1;
  const [name, setName] = useState(tracker?.name ?? "");
  const [color, setColor] = useState(() => {
    if (tracker?.color && isAllowedTrackerColor(tracker.color))
      return tracker.color;
    return TRACKER_COLOR_CHOICES[
      Math.floor(Math.random() * TRACKER_COLOR_CHOICES.length)
    ];
  });
  const [category, setCategory] = useState<TrackerCategory>(
    tracker?.category ?? "other",
  );
  const [grouping, setGrouping] = useState(
    tracker?.grouping ?? "",
  );
  const [unit, setUnit] = useState(tracker?.unit ?? "");
  const [dataType, setDataType] = useState<MetricDataType>(
    tracker?.dataType ?? "number",
  );
  const [goalEnabled, setGoalEnabled] = useState(
    tracker?.goalEnabled !== false,
  );
  const [goalKind, setGoalKind] = useState<GoalKind>(
    tracker?.goal.kind ?? "at_least",
  );
  const [goal, setGoal] = useState(String(tracker?.goal.target ?? ""));
  const [goalProgressMode, setGoalProgressMode] = useState(
    tracker?.goalProgressMode ?? "daily",
  );
  const [adaptiveTargetEnabled, setAdaptiveTargetEnabled] = useState(
    tracker?.adaptiveGoalTarget?.enabled ?? false,
  );
  const [adaptiveTargetStatistic, setAdaptiveTargetStatistic] = useState<
    "average" | "median"
  >(tracker?.adaptiveGoalTarget?.statistic ?? "average");
  const [adaptiveTargetPeriod, setAdaptiveTargetPeriod] = useState<
    "week" | "month" | "year" | "all_time"
  >(tracker?.adaptiveGoalTarget?.period ?? "month");
  const existingDiastolic = sourceMetrics.find(
    (item) => item.id === "blood_pressure_diastolic",
  );
  const [diastolicGoal, setDiastolicGoal] = useState(
    String(existingDiastolic?.goal.target ?? 80),
  );
  const [diastolicMin, setDiastolicMin] = useState(
    String(existingDiastolic?.goalRange?.min ?? 60),
  );
  const [rangeMin, setRangeMin] = useState(
    String(tracker?.goalRange?.min ?? ""),
  );
  const [rangeMax, setRangeMax] = useState(
    String(tracker?.goalRange?.max ?? ""),
  );
  const [rangeGoal, setRangeGoal] = useState(Boolean(tracker?.goalRange));
  const [formula, setFormula] = useState(tracker?.formula ?? "");
  const [icon, setIcon] = useState(tracker?.icon ?? ICONS[0]);
  const [visibility, setVisibility] = useState<Visibility>(
    tracker?.defaultVisibility ?? "group",
  );
  const [aggregation, setAggregation] = useState<Aggregation>(
    tracker?.aggregation ?? "sum",
  );
  const [ranking, setRanking] = useState<RankingDirection>(
    tracker?.rankingDirection ?? "higher",
  );
  const [advanced, setAdvanced] = useState(
    focus === "goal-start" || focus === "notifications",
  );
  const [behaviorOpen, setBehaviorOpen] = useState(
    focus === "goal-start" || focus === "notifications",
  );
  const [healthOpen, setHealthOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(
    focus === "notifications",
  );
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToGoalStart = useRef(false);
  const scrolledToNotifications = useRef(false);
  const advancedPanelY = useRef(0);
  const behaviorSectionY = useRef(0);
  const remindersSectionY = useRef(0);
  const [showIcons, setShowIcons] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [customTypeOpen, setCustomTypeOpen] = useState(
    Boolean(tracker?.grouping),
  );
  const [goalKindOpen, setGoalKindOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [healthSourceChoiceOpen, setHealthSourceChoiceOpen] = useState(false);
  const [healthFieldChoiceOpen, setHealthFieldChoiceOpen] = useState(false);
  const [scheduleChoiceOpen, setScheduleChoiceOpen] = useState(false);
  const [entryTypeOpen, setEntryTypeOpen] = useState(false);
  const [aggregationOpen, setAggregationOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [adaptiveStatisticOpen, setAdaptiveStatisticOpen] = useState(false);
  const [adaptivePeriodOpen, setAdaptivePeriodOpen] = useState(false);
  const [visualsOpen, setVisualsOpen] = useState(false);
  const [detailDayVisual, setDetailDayVisual] = useState<
    "progress" | "completion" | "none"
  >(tracker?.visualization?.detailDay ?? trackerVisualDefaults.detailDay);
  const [detailRangeVisual, setDetailRangeVisual] =
    useState<MetricChartStyle>(
      tracker?.visualization?.detailRange ?? trackerVisualDefaults.detailRange,
    );
  const [progressOverviewVisual, setProgressOverviewVisual] =
    useState<MetricChartStyle>(
      tracker?.visualization?.progressOverview ??
        trackerVisualDefaults.progressOverview,
    );
  const [progressGridVisual, setProgressGridVisual] = useState<
    "intensity" | "completion"
  >(
    tracker?.visualization?.progressGrid ??
      trackerVisualDefaults.progressGrid,
  );
  const [healthType, setHealthType] = useState<HealthDataType | "">(
    tracker?.healthMapping?.dataType ?? "",
  );
  const [gymMapping, setGymMapping] = useState(tracker?.gymMapping);
  const [gymMuscles, setGymMuscles] = useState<MuscleGroup[]>(
    tracker?.gymMuscleGroups ??
      (tracker?.gymMapping?.kind === "muscle_volume"
        ? [tracker.gymMapping.muscleGroup]
        : ["full_body"]),
  );
  const [healthField, setHealthField] = useState<HealthMetricField>(
    tracker?.healthMapping?.field ?? "value",
  );
  const [stepFallback, setStepFallback] = useState(
    tracker?.stepFallback ?? false,
  );
  const [manualEntry, setManualEntry] = useState(
    tracker?.manualEntry !== false,
  );
  const [timerEnabled, setTimerEnabled] = useState(
    tracker?.timerEnabled ??
      (focus === "timer" ||
        /min|hour|hr|sec/i.test(tracker?.unit ?? "") ||
        tracker?.category === "mind"),
  );
  const [fastingStartTime, setFastingStartTime] = useState(
    tracker?.fastingSettings?.startTime ?? "20:00",
  );
  const [fastingHours, setFastingHours] = useState(
    String((tracker?.fastingSettings?.fastingMinutes ?? 16 * 60) / 60),
  );
  const [automaticFoodBreak, setAutomaticFoodBreak] = useState(
    tracker?.fastingSettings?.automaticFoodBreak ?? true,
  );
  const isFastingTracker =
    Boolean(tracker?.fastingSettings) ||
    (presetId || tracker?.id) === "intermittent_fasting";
  const fastingDurationMinutes = Math.max(
    15,
    Math.min(1425, Math.round((Number(fastingHours) || 16) * 60)),
  );
  const fastingEndTime = clockPlusMinutes(
    fastingStartTime,
    fastingDurationMinutes,
  );
  const eatingWindowHours = Number(
    ((1440 - fastingDurationMinutes) / 60).toFixed(2),
  );
  const [submetricsOpen, setSubmetricsOpen] = useState(false);
  const [openSubmetricGoalId, setOpenSubmetricGoalId] = useState<string | null>(
    null,
  );
  const [openSubmetricHealthId, setOpenSubmetricHealthId] = useState<
    string | null
  >(null);
  const [openSubmetricFieldId, setOpenSubmetricFieldId] = useState<
    string | null
  >(null);
  const [openSubmetricChartId, setOpenSubmetricChartId] = useState<
    string | null
  >(null);
  const [submetrics, setSubmetrics] = useState<MetricSubmetric[]>(() => {
    if (tracker?.submetrics?.length) return tracker.submetrics;
    if (tracker?.id === "blood_pressure_systolic")
      return [
        {
          id: "systolic",
          name: "Systolic",
          unit: "mmHg",
          goalEnabled: true,
          goal: tracker.goal,
          goalRange: tracker.goalRange ?? { min: 90, max: 120 },
          showProgressBar: true,
          healthMapping: { dataType: "blood_pressure", field: "systolic" },
        },
        {
          id: "diastolic",
          name: "Diastolic",
          unit: "mmHg",
          goalEnabled: true,
          goal: existingDiastolic?.goal ?? { kind: "exact", target: 80 },
          goalRange: existingDiastolic?.goalRange ?? { min: 60, max: 80 },
          showProgressBar: true,
          linkedMetricId: "blood_pressure_diastolic",
          healthMapping: { dataType: "blood_pressure", field: "diastolic" },
        },
        {
          id: "pulse",
          name: "Pulse",
          unit: "bpm",
          goalEnabled: false,
          goal: { kind: "exact", target: 70 },
          showProgressBar: false,
          linkedMetricId: "pulse",
          healthMapping: { dataType: "heart_rate", field: "value" },
        },
      ];
    if (tracker?.id === "food")
      return [
        ["protein", "Protein", "g"],
        ["fat", "Fat", "g"],
        ["carbs", "Carbs", "g"],
        ["fiber", "Fiber", "g"],
        ["sugar", "Sugar", "g"],
      ].map(([id, subName, subUnit]) => ({
        id,
        name: subName,
        unit: subUnit,
        goalEnabled: false,
        goal: { kind: "at_least" as const, target: 0 },
        showProgressBar: false,
        linkedMetricId: id,
      }));
    return [];
  });
  const [submetricDisplayMode, setSubmetricDisplayMode] = useState<
    "separate" | "merged"
  >(tracker?.submetricDisplay?.mode ?? "separate");
  const [submetricTemplate, setSubmetricTemplate] = useState(
    tracker?.submetricDisplay?.template ??
      (tracker?.id === "blood_pressure_systolic"
        ? "{systolic}/{diastolic} {systolic.unit}"
        : ""),
  );
  const [submetricsCollapsible, setSubmetricsCollapsible] = useState(
    tracker?.submetricDisplay?.collapsible ?? tracker?.id === "food",
  );
  const [mainValueEnabled, setMainValueEnabled] = useState(
    tracker?.submetricDisplay?.mainValueEnabled ??
      tracker?.id !== "blood_pressure_systolic",
  );
  const [submetricsLabel, setSubmetricsLabel] = useState(
    tracker?.submetricDisplay?.collapsibleLabel ??
      (tracker?.id === "food" ? "Add vitamins, minerals and more" : "More fields"),
  );
  const [visibleSubmetricCount, setVisibleSubmetricCount] = useState(
    String(
      tracker?.submetricDisplay?.visibleInputCount ??
        Math.min(4, Math.max(1, tracker?.submetrics?.length ?? 1)),
    ),
  );
  const [activeFrom, setActiveFrom] = useState(tracker?.activeFrom ?? dateKey());
  const initiallyTracked = Boolean(
    !groupScope &&
      tracker &&
      (trackerPeriods
        ? trackerPeriods.some((period) => !period.to)
        : tracker.sections.today),
  );
  const [trackGoal, setTrackGoal] = useState(initiallyTracked);
  const [addToToday, setAddToToday] = useState(
    tracker?.sections.today ?? true,
  );
  const [goalCalendarOpen, setGoalCalendarOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(
    tracker?.goalSchedule?.mode ?? "daily",
  );
  const [minimumCompletions, setMinimumCompletions] = useState(
    String(tracker?.goalSchedule?.minimumCompletions ?? 3),
  );
  const [intervalDays, setIntervalDays] = useState(
    String(tracker?.goalSchedule?.intervalDays ?? 14),
  );
  const [daysOfMonth, setDaysOfMonth] = useState(
    (tracker?.goalSchedule?.daysOfMonth ?? [10, 14]).join(", "),
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(
    tracker?.goalSchedule?.daysOfWeek ?? [1, 3, 5],
  );
  const [reminderEnabled, setReminderEnabled] = useState(
    tracker?.reminder?.enabled ?? false,
  );
  const [reminderTimes, setReminderTimes] = useState<string[]>(
    tracker?.reminders?.map((item) => item.time) ??
      (tracker?.reminder?.time
        ? [tracker.reminder.time]
        : defaultReminderTimes(tracker ?? { id: presetId || "custom", category } as MetricDefinition)),
  );
  const [reminderSchedules, setReminderSchedules] = useState<
    (GoalSchedule | undefined)[]
  >(
    tracker?.reminders?.map((item) => item.schedule) ??
      reminderTimes.map(() => undefined),
  );
  const [reminderDurations, setReminderDurations] = useState<
    (number | undefined)[]
  >(
    tracker?.reminders?.map((item) => item.durationMinutes) ??
      reminderTimes.map(() => undefined),
  );
  const [reminderFrequencyOpen, setReminderFrequencyOpen] = useState<
    number | null
  >(null);
  const [progressRemindersEnabled, setProgressRemindersEnabled] = useState(
    tracker?.progressRemindersEnabled ?? false,
  );
  const [progressReminderPercentages, setProgressReminderPercentages] = useState<
    number[]
  >(
    tracker?.progressReminderPercentages ??
      defaultProgressReminderPercentages(
        tracker ?? {
          goal: { kind: goalKind, target: Number(goal) || 1 },
          goalRange: rangeGoal
            ? { min: Number(rangeMin) || 0, max: Number(rangeMax) || 1 }
            : undefined,
          goalProgressMode,
        },
      ),
  );
  const [customProgressReminder, setCustomProgressReminder] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const draftSignature = JSON.stringify({
    presetId,
    selectedPresetIds,
    name,
    color,
    category,
    grouping,
    unit,
    dataType,
    goalEnabled,
    goalKind,
    goal,
    goalProgressMode,
    adaptiveTargetEnabled,
    adaptiveTargetStatistic,
    adaptiveTargetPeriod,
    diastolicGoal,
    diastolicMin,
    rangeMin,
    rangeMax,
    rangeGoal,
    formula,
    icon,
    visibility,
    aggregation,
    ranking,
    healthType,
    healthField,
    gymMapping,
    gymMuscles,
    stepFallback,
    manualEntry,
    timerEnabled,
    fastingStartTime,
    fastingHours,
    automaticFoodBreak,
    detailDayVisual,
    detailRangeVisual,
    progressOverviewVisual,
    progressGridVisual,
    submetrics,
    submetricDisplayMode,
    submetricTemplate,
    submetricsCollapsible,
    submetricsLabel,
    visibleSubmetricCount,
    mainValueEnabled,
    activeFrom,
    trackGoal,
    addToToday,
    scheduleMode,
    minimumCompletions,
    intervalDays,
    daysOfMonth,
    selectedDays,
    reminderEnabled,
    reminderTimes,
    reminderSchedules,
    reminderDurations,
    progressRemindersEnabled,
    progressReminderPercentages,
  });
  const initialDraftSignature = useRef(draftSignature);
  const dirtyRef = useRef(false);
  const allowExit = useRef(false);
  const requestCloseRef = useRef<(exit?: () => void) => void>(
    () => undefined,
  );
  dirtyRef.current = draftSignature !== initialDraftSignature.current;
  useWebBeforeUnload(() => dirtyRef.current && !allowExit.current);
  const source = SOURCES.find((item) => item.id === healthType);
  const reusableGroupings = [
    ...new Set(
      [
        ...state.metrics,
        ...(state.group.metricConfiguration ?? []),
      ]
        .map((item) => item.grouping?.trim())
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const typeValue = grouping.trim()
    ? `grouping:${grouping.trim()}`
    : customTypeOpen
      ? "__custom_grouping__"
      : category;
  function clearPreset() {
    setPresetId("");
    setName("");
    const nextColor =
      TRACKER_COLOR_CHOICES[
        Math.floor(Math.random() * TRACKER_COLOR_CHOICES.length)
      ];
    setColor(nextColor);
    setCategory("other");
    setGrouping("");
    setCustomTypeOpen(false);
    setUnit("");
    setDataType("number");
    setGoalEnabled(true);
    setGoalKind("at_least");
    setGoal("");
    setGoalProgressMode("daily");
    setAdaptiveTargetEnabled(false);
    setAdaptiveTargetStatistic("average");
    setAdaptiveTargetPeriod("month");
    setRangeGoal(false);
    setRangeMin("");
    setRangeMax("");
    setFormula("");
    setIcon(ICONS[0]);
    setAggregation("sum");
    setRanking("higher");
    setHealthType("");
    setGymMapping(undefined);
    setGymMuscles(["full_body"]);
    setStepFallback(false);
    setManualEntry(true);
    setTimerEnabled(false);
    setFastingStartTime("20:00");
    setFastingHours("16");
    setAutomaticFoodBreak(false);
    setDetailDayVisual("progress");
    setDetailRangeVisual("auto");
    setProgressOverviewVisual("auto");
    setProgressGridVisual("intensity");
    setSubmetrics([]);
    setVisibleSubmetricCount("1");
    setMainValueEnabled(true);
    setTrackGoal(false);
    setAddToToday(true);
    setReminderEnabled(false);
    setReminderDurations([]);
    setAdvanced(false);
  }
  function applyPreset(preset: TrackerPreset) {
    const presetVisuals = metricVisualization({
      ...preset,
      id: preset.templateId,
    });
    setPresetId(preset.templateId);
    setName(preset.name);
    setColor(preset.color);
    setCategory(preset.category ?? "other");
    setGrouping(preset.grouping ?? "");
    setCustomTypeOpen(Boolean(preset.grouping));
    setUnit(preset.unit);
    setDataType(preset.dataType);
    setGoalEnabled(preset.goalEnabled !== false);
    setGoalKind(preset.goal.kind);
    setGoal(String(preset.goal.target));
    setGoalProgressMode(preset.goalProgressMode ?? "daily");
    setAdaptiveTargetEnabled(preset.adaptiveGoalTarget?.enabled ?? false);
    setAdaptiveTargetStatistic(
      preset.adaptiveGoalTarget?.statistic ?? "average",
    );
    setAdaptiveTargetPeriod(preset.adaptiveGoalTarget?.period ?? "month");
    if (preset.templateId === "blood_pressure_systolic") {
      setDiastolicGoal("80");
      setDiastolicMin("60");
    }
    setRangeMin(preset.goalRange ? String(preset.goalRange.min) : "");
    setRangeMax(preset.goalRange ? String(preset.goalRange.max) : "");
    setRangeGoal(Boolean(preset.goalRange));
    setFormula(preset.formula ?? "");
    setIcon(preset.icon);
    setVisibility(preset.defaultVisibility);
    setAggregation(preset.aggregation);
    setRanking(preset.rankingDirection);
    setHealthType(preset.healthMapping?.dataType ?? "");
    setHealthField(preset.healthMapping?.field ?? "value");
    setGymMapping(preset.gymMapping);
    setGymMuscles(
      preset.gymMuscleGroups ??
        (preset.gymMapping?.kind === "muscle_volume"
          ? [preset.gymMapping.muscleGroup]
          : ["full_body"]),
    );
    setStepFallback(preset.stepFallback ?? false);
    setManualEntry(preset.manualEntry !== false);
    setTimerEnabled(
      preset.timerEnabled ??
        (/min|hour|hr|sec/i.test(preset.unit) ||
          preset.category === "mind"),
    );
    setFastingStartTime(preset.fastingSettings?.startTime ?? "20:00");
    setFastingHours(
      String((preset.fastingSettings?.fastingMinutes ?? 16 * 60) / 60),
    );
    setAutomaticFoodBreak(
      preset.fastingSettings?.automaticFoodBreak ?? true,
    );
    setDetailDayVisual(presetVisuals.detailDay);
    setDetailRangeVisual(presetVisuals.detailRange);
    setProgressOverviewVisual(
      presetVisuals.progressOverview,
    );
    setProgressGridVisual(
      presetVisuals.progressGrid,
    );
    setSubmetrics(preset.submetrics ?? []);
    setSubmetricDisplayMode(preset.submetricDisplay?.mode ?? "separate");
    setSubmetricTemplate(preset.submetricDisplay?.template ?? "");
    setSubmetricsCollapsible(preset.submetricDisplay?.collapsible ?? false);
    setSubmetricsLabel(
      preset.submetricDisplay?.collapsibleLabel ?? "More fields",
    );
    setVisibleSubmetricCount(
      String(
        preset.submetricDisplay?.visibleInputCount ??
          Math.min(4, Math.max(1, preset.submetrics?.length ?? 1)),
      ),
    );
    setMainValueEnabled(
      preset.submetricDisplay?.mainValueEnabled ??
        preset.templateId !== "blood_pressure_systolic",
    );
    setActiveFrom(dateKey());
    setTrackGoal(false);
    setGoalCalendarOpen(false);
    setReminderTimes(
      preset.reminders?.map((item) => item.time) ??
        defaultReminderTimes({ id: preset.templateId, category: preset.category }),
    );
    setReminderSchedules(
      preset.reminders?.map((item) => item.schedule) ?? [],
    );
    setReminderDurations(
      preset.reminders?.map((item) => item.durationMinutes) ?? [],
    );
    setProgressRemindersEnabled(preset.progressRemindersEnabled ?? false);
    setProgressReminderPercentages(
      preset.progressReminderPercentages ??
        defaultProgressReminderPercentages(preset),
    );
    setScheduleMode("daily");
    setAdvanced(false);
  }
  function insert(token: string) {
    setFormula(
      (current) =>
        `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`,
    );
    setValidation(null);
  }
  function validate() {
    try {
      const known = Object.fromEntries(
        sourceMetrics.map((item) => [item.id, 1]),
      );
      const unknown = formulaIdentifiers(formula).filter(
        (key) =>
          !(key in known) &&
          !["bmr", "daily_activity", "baseline", "daily_energy"].includes(key),
      );
      if (unknown.length) throw new Error(`Unknown: ${unknown.join(", ")}`);
      const result = evaluateFormula(formula, {
        ...known,
        ...energyFormulaVariables(
          state.settings.energyProfile,
          state.settings.baselineCalories,
        ),
      });
      setValidation(`Looks good · example ${Number(result.toFixed(1))}`);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Check this calculation.";
      setValidation(message);
      Alert.alert("Calculation needs attention", message);
      return false;
    }
  }
  function savePresetSelection(onSaved: () => void) {
    const presetById = new Map(
      trackerPresets(state, true).map((preset) => [preset.templateId, preset]),
    );
    const requestedIds = [...selectedPresetIds];
    if (requestedIds.includes("blood_pressure_systolic")) {
      requestedIds.push("blood_pressure_diastolic", "pulse");
    }
    const existingIds = new Set(sourceMetrics.map((metric) => metric.id));
    const queuedIds = new Set<string>();
    const metrics = requestedIds.flatMap((templateId): NewMetric[] => {
      if (existingIds.has(templateId) || queuedIds.has(templateId)) return [];
      const preset = presetById.get(templateId);
      if (!preset) return [];
      queuedIds.add(templateId);
      const { description: _description, ...definition } = preset;
      const common: NewMetric = {
        ...definition,
        templateId,
        activeFrom: dateKey(),
        trackGoal: false,
        addToToday: !groupScope,
      };
      if (!groupScope) return [common];
      const {
        trackGoal: _trackGoal,
        addToToday: _addToToday,
        ...sharedDefinition
      } = common;
      return [
        {
          ...sharedDefinition,
          goalSchedule: undefined,
          reminder: undefined,
          reminders: undefined,
          progressRemindersEnabled: undefined,
          progressReminderPercentages: undefined,
        },
      ];
    });
    if (!metrics.length) {
      Alert.alert(
        "Nothing new to add",
        "Those ready-made trackers are already available.",
      );
      return;
    }
    if (groupScope) addGroupMetrics(metrics);
    else addMetrics(metrics);
    allowExit.current = true;
    onSaved();
  }
  function save(onSaved: () => void = () => router.back()) {
    if (bulkPresetMode) {
      savePresetSelection(onSaved);
      return;
    }
    const target = isFastingTracker
      ? fastingDurationMinutes / 60
      : Number(goal.replace(",", "."));
    const diastolicTarget = Number(diastolicGoal.replace(",", "."));
    const systolicMinimum = Number(rangeMin.replace(",", "."));
    const diastolicMinimum = Number(diastolicMin.replace(",", "."));
    if (!name.trim())
      return Alert.alert("Add a name", "Use a short, clear name.");
    if (!isAllowedTrackerColor(color))
      return Alert.alert(
        "Choose another color",
        "Lime and gold are reserved for goal-completion feedback.",
      );
    if (goalEnabled && dataType !== "text" && !Number.isFinite(target))
      return Alert.alert("Check your target", "Enter a valid number.");
    if (
      (presetId || tracker?.id) === "blood_pressure_systolic" &&
      (!Number.isFinite(systolicMinimum) ||
        !Number.isFinite(diastolicMinimum) ||
        !Number.isFinite(diastolicTarget) ||
        systolicMinimum >= target ||
        diastolicMinimum >= diastolicTarget)
    )
      return Alert.alert(
        "Check blood-pressure ranges",
        "Each range needs a lower value below its upper value.",
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activeFrom))
      return Alert.alert("Check the start date", "Use YYYY-MM-DD.");
    if (submetrics.filter((item) => item.showProgressBar).length > 4)
      return Alert.alert(
        "Too many progress bars",
        "Choose up to four submetrics to show as progress bars.",
      );
    if (submetrics.some((item) => !item.name.trim()))
      return Alert.alert("Check submetrics", "Every submetric needs a name.");
    if (
      submetricsCollapsible &&
      (!Number.isFinite(Number(visibleSubmetricCount)) ||
        Number(visibleSubmetricCount) < 1)
    )
      return Alert.alert(
        "Check visible inputs",
        "Keep at least one submetric visible before the extra inputs.",
      );
    const builtInCalculation = [
      "weekly_deficit_balance",
      "overall_score",
    ].includes(presetId || tracker?.id || "");
    if (
      dataType === "calculated" &&
      !builtInCalculation &&
      (!formula.trim() || !validate())
    )
      return;
    const primaryId = presetId || tracker?.id;
    const savedSubmetrics =
      primaryId === "blood_pressure_systolic"
        ? submetrics.map((item) =>
            item.id === "systolic"
              ? {
                  ...item,
                  goalEnabled: true,
                  goal: { kind: "exact" as const, target },
                  goalRange: { min: systolicMinimum, max: target },
                  showProgressBar: true,
                }
              : item.id === "diastolic"
                ? {
                    ...item,
                    goalEnabled: true,
                    goal: {
                      kind: "exact" as const,
                      target: diastolicTarget,
                    },
                    goalRange: {
                      min: diastolicMinimum,
                      max: diastolicTarget,
                    },
                    showProgressBar: true,
                  }
                : item,
          )
        : submetrics;
    const presetReminderLabels = presetId
      ? trackerPresets(state, true)
          .find((preset) => preset.templateId === presetId)
          ?.reminders?.map((reminder) => reminder.label)
      : undefined;
    const common: NewMetric = {
      name: name.trim(),
      icon,
      color,
      unit: unit.trim(),
      dataType,
      aggregation,
      goal: {
        kind:
          dataType === "boolean" || dataType === "photo"
            ? "complete"
            : (presetId || tracker?.id) === "blood_pressure_systolic"
              ? "exact"
            : goalKind,
        target: Number.isFinite(target) ? target : 0,
      },
      adaptiveGoalTarget:
        dataType === "number" &&
        goalEnabled &&
        !rangeGoal &&
        goalProgressMode !== "journey" &&
        !isFastingTracker &&
        !["weight", "food"].includes(presetId || tracker?.id || "")
          ? {
              enabled: adaptiveTargetEnabled,
              statistic: adaptiveTargetStatistic,
              period: adaptiveTargetPeriod,
            }
          : undefined,
      goalEnabled,
      goalProgressMode:
        goalEnabled && dataType === "number" && !rangeGoal
          ? goalProgressMode
          : "daily",
      goalRange:
        (presetId || tracker?.id) === "blood_pressure_systolic"
          ? { min: systolicMinimum, max: target }
          : rangeGoal && rangeMin && rangeMax
          ? { min: Number(rangeMin), max: Number(rangeMax) }
          : undefined,
      category,
      grouping: grouping.trim() || undefined,
      healthMapping: healthType
        ? { dataType: healthType, field: healthField }
        : undefined,
      gymMapping,
      gymMuscleGroups: category === "gym" ? gymMuscles : undefined,
      stepFallback,
      manualEntry:
        healthType === "steps" ||
        tracker?.id === "steps" ||
        isFastingTracker
          ? false
          : manualEntry,
      timerEnabled:
        dataType === "number" && !isFastingTracker ? timerEnabled : false,
      fastingSettings:
        isFastingTracker
          ? {
              startTime: fastingStartTime,
              fastingMinutes: fastingDurationMinutes,
              automaticFoodBreak,
            }
          : undefined,
      visualization: {
        detailDay: detailDayVisual,
        detailRange: detailRangeVisual,
        // Progress overview always uses per-day goal bars. Line charts remain
        // available in the tracker detail range view.
        progressOverview: "bar",
        progressGrid: progressGridVisual,
      },
      submetrics: savedSubmetrics.length
        ? savedSubmetrics.map((item) => ({
            ...item,
            name: item.name.trim(),
            unit: item.unit.trim(),
          }))
        : undefined,
      submetricDisplay: submetrics.length
        ? {
            mode: submetricDisplayMode,
            template:
              submetricDisplayMode === "merged"
                ? submetricTemplate.trim()
                : undefined,
            collapsible: submetricsCollapsible,
            collapsibleLabel: submetricsCollapsible
              ? submetricsLabel.trim() || "More fields"
              : undefined,
            visibleInputCount: submetricsCollapsible
              ? Math.min(
                  submetrics.length,
                  Math.max(1, Math.round(Number(visibleSubmetricCount) || 1)),
                )
              : undefined,
            mainValueEnabled,
          }
        : undefined,
      activeFrom,
      trackGoal: !groupScope && goalEnabled && trackGoal,
      addToToday: !groupScope && addToToday,
      goalSchedule: {
        mode: scheduleMode,
        daysOfWeek: scheduleMode === "selected_days" ? selectedDays : undefined,
        minimumCompletions:
          scheduleMode === "weekly_min" || scheduleMode === "monthly_min"
            ? Math.max(1, Number(minimumCompletions) || 1)
            : undefined,
        intervalDays:
          scheduleMode === "interval_days"
            ? Math.max(1, Math.round(Number(intervalDays) || 1))
            : undefined,
        daysOfMonth:
          scheduleMode === "days_of_month"
            ? [...new Set(
                daysOfMonth
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
              )].sort((a, b) => a - b)
            : undefined,
        anchorDate:
          scheduleMode === "every_other_day" ||
          scheduleMode === "interval_days"
            ? activeFrom
            : undefined,
      },
      reminder: {
        enabled: reminderEnabled,
        time: reminderTimes[0] ?? "19:00",
      },
      reminders: reminderTimes.map((time, index) => ({
        enabled: reminderEnabled,
        time,
        schedule: reminderSchedules[index],
        durationMinutes: reminderDurations[index],
        label:
          tracker?.reminders?.[index]?.label ?? presetReminderLabels?.[index],
      })),
      progressRemindersEnabled,
      progressReminderPercentages: [...new Set(progressReminderPercentages)]
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 300)
        .sort((left, right) => left - right),
      rankingDirection: dataType === "boolean" ? "higher" : ranking,
      defaultVisibility: visibility,
      formula:
        dataType === "calculated" && formula.trim()
          ? formula.trim()
          : undefined,
      templateId: tracker ? undefined : presetId || undefined,
    };
    const {
      trackGoal: shouldTrack,
      addToToday: shouldShowToday,
      ...definition
    } = common;
    if (groupScope) {
      const sharedDefinition = {
        ...definition,
        // Scheduling and reminders are personal preferences. Group trackers
        // only provide the shared shape, default target, and ranking rule.
        goalSchedule: undefined,
        reminder: undefined,
        reminders: undefined,
        progressRemindersEnabled: undefined,
        progressReminderPercentages: undefined,
      };
      if (tracker) updateGroupMetric(tracker.id, sharedDefinition);
      else addGroupMetric(sharedDefinition);
    } else if (tracker) {
      updateMetric(tracker.id, definition);
      if (shouldTrack || initiallyTracked) {
        setTrackedGoal(
          tracker.id,
          Boolean(shouldTrack),
          "today",
          shouldTrack ? activeFrom : undefined,
        );
      }
      setMetricSection(
        tracker.id,
        "today",
        Boolean(shouldTrack || shouldShowToday),
        "today",
      );
    } else addMetric(common);
    if ((presetId || tracker?.id) === "blood_pressure_systolic") {
      const presetsById = new Map(
        trackerPresets(state, true).map((preset) => [preset.templateId, preset]),
      );
      const ensure = (companionId: "blood_pressure_diastolic" | "pulse") => {
        const existing = sourceMetrics.find((item) => item.id === companionId);
        const preset = presetsById.get(companionId);
        if (!preset) return;
        const changes =
          companionId === "blood_pressure_diastolic"
            ? {
                goalEnabled,
                goal: { kind: "exact" as const, target: diastolicTarget },
                goalRange: {
                  min: diastolicMinimum,
                  max: diastolicTarget,
                },
                activeFrom,
              }
            : { activeFrom };
        if (existing) {
          if (groupScope) updateGroupMetric(existing.id, changes);
          else updateMetric(existing.id, changes);
        } else {
          const next = { ...preset, ...changes, templateId: companionId };
          if (groupScope) addGroupMetric(next);
          else addMetric(next);
        }
      };
      ensure("blood_pressure_diastolic");
      ensure("pulse");
    }
    if (healthType)
      updateSettings({
        healthSync: {
          ...state.settings.healthSync,
          dataTypes: {
            ...state.settings.healthSync.dataTypes,
            [healthType]: true,
          },
        },
      });
    allowExit.current = true;
    onSaved();
  }
  function requestClose(exit: () => void = () => router.back()) {
    if (!dirtyRef.current) {
      allowExit.current = true;
      exit();
      return;
    }
    Alert.alert("Save your changes?", "You have unsaved tracker changes.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          allowExit.current = true;
          exit();
        },
      },
      { text: "Save", onPress: () => save(exit) },
    ]);
  }
  requestCloseRef.current = requestClose;
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (allowExit.current || !dirtyRef.current) return;
        event.preventDefault();
        requestCloseRef.current(() => navigation.dispatch(event.data.action));
      }),
    [navigation],
  );
  useEffect(() => {
    if (groupScope || focus !== "notifications") return;
    setAdvanced(true);
    setBehaviorOpen(true);
    setRemindersOpen(true);
    scrolledToNotifications.current = false;
    const scrollToReminders = () => {
      if (
        advancedPanelY.current <= 0 ||
        behaviorSectionY.current <= 0 ||
        remindersSectionY.current <= 0
      )
        return;
      scrollRef.current?.scrollTo({
        y: Math.max(
          0,
          advancedPanelY.current +
            behaviorSectionY.current +
            remindersSectionY.current -
            65,
        ),
        animated: true,
      });
      scrolledToNotifications.current = true;
    };
    // Native layout can settle in more than one pass as Advanced and
    // Reminders expand. Retry briefly so a Schedule deep-link always lands on
    // the actual reminder controls rather than merely opening Advanced.
    const timers = [120, 280, 520, 900].map((delay) =>
      setTimeout(scrollToReminders, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [focus, groupScope, id]);
  function remove() {
    if (!tracker) return;
    const dependencies = sourceMetrics.filter(
      (item) =>
        item.formula && formulaIdentifiers(item.formula).includes(tracker.id),
    );
    if (dependencies.length)
      return Alert.alert(
        "Used by another tracker",
        `Remove it from ${dependencies.map((item) => item.name).join(", ")} first.`,
      );
    Alert.alert(
      `Delete ${tracker.name}?`,
      groupScope
        ? "This removes it from this group for every member."
        : "Earlier entries will also be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete tracker",
          style: "destructive",
          onPress: () => {
            if (groupScope) deleteGroupMetric(tracker.id);
            else deleteMetric(tracker.id);
            allowExit.current = true;
            router.back();
          },
        },
      ],
    );
  }
  function renderFormulaEditor() {
    if (dataType !== "calculated") return null;
    return (
      <>
        <TextInput
          value={formula}
          onChangeText={(value) => {
            setFormula(value);
            setValidation(null);
          }}
          autoCapitalize="none"
          multiline
          placeholder="Choose values below, then add + or −"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            styles.formula,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <Text style={[styles.mini, { color: colors.muted }]}>
          AVAILABLE VALUES
        </Text>
        <View style={styles.wrap}>
          {state.metrics
            .filter(
              (item) => item.id !== tracker?.id && item.dataType !== "text",
            )
            .map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                onPress={() => insert(item.id)}
              />
            ))}
        </View>
        <View style={styles.wrap}>
          {["bmr", "daily_activity", "+", "-", "*", "/", "(", ")"].map(
            (item) => (
              <Chip
                key={item}
                label={item.replace("_", " ")}
                onPress={() => insert(item)}
              />
            ),
          )}
        </View>
        <Button
          label="Check calculation"
          variant="ghost"
          onPress={validate}
        />
        {validation ? (
          <Text
            style={[
              styles.validation,
              {
                color: validation.startsWith("Looks")
                  ? accent
                  : palette.red,
              },
            ]}
          >
            {validation}
          </Text>
        ) : null}
      </>
    );
  }
  let deferredSubmetrics: React.ReactNode = null;
  return (
    <Screen
      scrollRef={scrollRef}
      keyboardShouldPersistTaps="handled"
    >
      <PageHeader
        eyebrow={groupScope ? state.group.name : "Personal setup"}
        translateEyebrow={!groupScope}
        title={
          tracker
            ? `Edit ${tracker.name}`
            : groupScope
              ? "Add group tracker"
              : "Add something to track"
        }
        subtitle={
          groupScope
            ? "Admins define this once; it becomes available to every group member."
            : "Keep it simple. Technical controls stay under Advanced."
        }
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => requestClose()}
          />
        }
      />
      {!tracker ? (
        <MetricSelector
          title="Choose a ready-made tracker"
          items={presets.map((preset) => ({
            id: preset.templateId,
            label: preset.name,
            icon: preset.icon as keyof typeof Ionicons.glyphMap,
            color: preset.color,
            sublabel: preset.description,
            group: preset.category === "gym" ? "Workout" : "Ready-made",
          }))}
          selectedIds={selectedPresetIds}
          onChange={(ids) => {
            setSelectedPresetIds(ids);
            if (!ids.length) {
              clearPreset();
              return;
            }
            if (ids.length === 1) {
              const preset = presets.find(
                (item) => item.templateId === ids[0],
              );
              if (preset) applyPreset(preset);
              return;
            }
            setPresetId("");
          }}
          multiple
          allowClear
          showSelectAll={false}
          collapsibleGroups={
            state.settings.showGym &&
            presets.some((preset) => preset.category === "gym")
              ? ["Workout"]
              : []
          }
          emptyLabel="Or create your own below"
        />
      ) : null}
      {bulkPresetMode ? (
        <Card>
          <View style={styles.bulkPresetIntro}>
            <View
              style={[
                styles.bulkPresetIcon,
                { backgroundColor: colors.primarySoft },
              ]}
            >
              <Ionicons name="layers-outline" size={22} color={accent} />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.label, { color: colors.ink }]}>
                {selectedPresetIds.length} ready-made trackers selected
              </Text>
              <Text style={[styles.help, { color: colors.muted }]}>
                They will be added together with their recommended defaults.
                Select only one tracker if you want to edit it first.
              </Text>
            </View>
          </View>
          <View style={styles.bulkPresetList}>
            {selectedPresetIds.map((selectedId) => {
              const selectedPreset = presets.find(
                (preset) => preset.templateId === selectedId,
              );
              if (!selectedPreset) return null;
              return (
                <View
                  key={selectedPreset.templateId}
                  style={[
                    styles.bulkPresetRow,
                    { borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name={selectedPreset.icon as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={selectedPreset.color}
                  />
                  <Text
                    translate={false}
                    style={[styles.bulkPresetName, { color: colors.ink }]}
                  >
                    {selectedPreset.name}
                  </Text>
                  <Ionicons name="checkmark-circle" size={17} color={accent} />
                </View>
              );
            })}
          </View>
        </Card>
      ) : (
        <>
      <Card>
        <Text style={[styles.label, { color: colors.ink }]}>
          What do you want to track?
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Reading, sleep, blood pressure…"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <Pressable
          onPress={() => setShowColors((value) => !value)}
          style={[styles.choiceRow, { borderColor: colors.border }]}
        >
          <View style={[styles.colorDot, { backgroundColor: color }]} />
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>
              Tracker color
            </Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              Lime and gold stay reserved for completed goals.
            </Text>
          </View>
          <Ionicons
            name={showColors ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.faint}
          />
        </Pressable>
        {showColors ? (
          <View style={styles.colorPanel}>
            <ColorSpectrumPicker
              value={color}
              onChange={setColor}
              variant="tracker"
            />
          </View>
        ) : null}
        <Pressable
          onPress={() => setShowIcons((value) => !value)}
          style={[styles.choiceRow, { borderColor: colors.border }]}
        >
          <View style={[styles.icon, { backgroundColor: `${color}18` }]}>
            <Ionicons
              name={icon as keyof typeof Ionicons.glyphMap}
              size={20}
              color={color}
            />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>
              Change icon
            </Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              Choose the symbol shown across the app.
            </Text>
          </View>
          <Ionicons
            name={showIcons ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.faint}
          />
        </Pressable>
        {showIcons ? (
          <View style={styles.icons}>
            {ICONS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setIcon(item)}
                style={[
                  styles.icon,
                  { borderColor: icon === item ? accent : colors.border },
                ]}
              >
                <Ionicons
                  name={item}
                  size={19}
                  color={icon === item ? accent : colors.muted}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        <ChoicePicker
          label="Type"
          value={typeValue}
          open={categoryOpen}
          setOpen={setCategoryOpen}
          options={[
            ...CATEGORIES.map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
            })),
            ...reusableGroupings.map((item) => ({
              id: `grouping:${item}`,
              label: item,
              icon: "albums-outline" as const,
            })),
            {
              id: "__custom_grouping__",
              label: "Create custom type",
              icon: "add-circle-outline" as const,
            },
          ]}
          onChange={(value) => {
            if (value === "__custom_grouping__") {
              setGrouping("");
              setCategory("other");
              setCustomTypeOpen(true);
              return;
            }
            if (value.startsWith("grouping:")) {
              setGrouping(value.slice("grouping:".length));
              setCategory("other");
              setCustomTypeOpen(false);
              return;
            }
            setGrouping("");
            setCategory(value as TrackerCategory);
            setCustomTypeOpen(false);
          }}
          colors={colors}
          accent={accent}
        />
        {customTypeOpen ? <View style={styles.fieldGroup}>
          <View style={styles.labelLine}>
            <Text style={[styles.label, { color: colors.ink }]}>
              Custom type
            </Text>
            <InfoPopover
              label="Explain tracker grouping"
              message="Create a reusable section such as Heart health or Morning routine. Group-created types become available to every member."
            />
          </View>
          <TextInput
            value={grouping}
            onChangeText={setGrouping}
            placeholder="Type name"
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        </View> : null}
        {category === "gym" &&
        dataType === "number" &&
        (!gymMapping ||
          gymMapping.kind === "exercise_one_rep_max" ||
          gymMapping.kind === "exercise_volume") ? (
          <MetricSelector
            title="Body parts"
            items={(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map(
              (muscle) => ({
                id: muscle,
                label: MUSCLE_LABELS[muscle],
                icon: "body-outline",
                color: accent,
              }),
            )}
            selectedIds={gymMuscles}
            onChange={(ids) => {
              const next = ids as MuscleGroup[];
              if (!next.length) return setGymMuscles(["full_body"]);
              if (next.length > 1 && next.includes("full_body"))
                return setGymMuscles(
                  gymMuscles.includes("full_body")
                    ? next.filter((item) => item !== "full_body")
                    : ["full_body"],
                );
              setGymMuscles(next);
            }}
            emptyLabel="Choose at least one body part"
          />
        ) : null}
        {groupScope && category === "gym" && !gymMapping ? (
          <Text style={[styles.help, { color: colors.muted }]}>
            This becomes a standardized group exercise in every member&apos;s
            Workout picker. Rankings use estimated one-rep max; raw sets and notes
            stay controlled by each workout&apos;s visibility.
          </Text>
        ) : null}
        <ChoicePicker
          label="Entry type"
          value={dataType}
          open={entryTypeOpen}
          setOpen={setEntryTypeOpen}
          options={[
            { id: "number", label: "Number", icon: "calculator-outline" },
            { id: "boolean", label: "Done / not done", icon: "checkbox-outline" },
            { id: "text", label: "Note", icon: "document-text-outline" },
            { id: "photo", label: "Photo", icon: "camera-outline" },
            { id: "calculated", label: "Calculated", icon: "code-slash-outline" },
          ]}
          onChange={(value) => setDataType(value as MetricDataType)}
          colors={colors}
          accent={accent}
        />
        {dataType === "number" ? (
          <ChoicePicker
            label="Multiple entries"
            value={aggregation}
            open={aggregationOpen}
            setOpen={setAggregationOpen}
            options={[
              { id: "sum", label: "Add them" },
              { id: "average", label: "Average" },
              { id: "latest", label: "Use latest" },
              { id: "max", label: "Use highest" },
              { id: "min", label: "Use lowest" },
            ]}
            onChange={(value) => setAggregation(value as Aggregation)}
            colors={colors}
            accent={accent}
          />
        ) : null}
        {groupScope ? (
          <ChoicePicker
            label="Competition"
            value={ranking}
            open={rankingOpen}
            setOpen={setRankingOpen}
            options={[
              { id: "higher", label: "Higher ranks first" },
              { id: "lower", label: "Lower ranks first" },
              { id: "closest", label: "Closest to personal target" },
            ]}
            onChange={(value) => setRanking(value as RankingDirection)}
            colors={colors}
            accent={accent}
          />
        ) : null}
        <View style={[styles.switchRow, { borderColor: colors.border }]}>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>
              Set a target
            </Text>
            <Text style={[styles.help, { color: colors.muted }]}>
              Turn this off for readings you only want to observe.
            </Text>
          </View>
          <Switch
            value={goalEnabled}
            onValueChange={setGoalEnabled}
            trackColor={{ false: colors.border, true: `${accent}88` }}
            thumbColor={goalEnabled ? accent : colors.faint}
          />
        </View>
        {goalEnabled && dataType !== "text" && !isFastingTracker ? (
          <>
            {(presetId || tracker?.id) === "blood_pressure_systolic" ? (
              <Text style={[styles.help, { color: colors.muted }]}>
                Both readings must be inside their preferred ranges. The adult defaults are 90–120 systolic and 60–80 diastolic; personalize these with a clinician when appropriate.
              </Text>
            ) : (
            <>
              <ChoicePicker
                label="Success"
                value={rangeGoal ? "range" : goalKind}
                open={goalKindOpen}
                setOpen={setGoalKindOpen}
                options={[
                  { id: "at_least", label: "At least the target" },
                  { id: "at_most", label: "No more than the target" },
                  { id: "exact", label: "Near the target" },
                  { id: "range", label: "Inside a range" },
                ]}
                onChange={(value) => {
                  setGoalKind(
                    value === "range" ? "exact" : (value as GoalKind),
                  );
                  setRangeGoal(value === "range");
                  if (value === "range") {
                    setRangeMin(rangeMin || "60");
                    setRangeMax(rangeMax || "100");
                  } else {
                    setRangeMin("");
                    setRangeMax("");
                  }
                }}
                colors={colors}
                accent={accent}
              />
            </>
            )}
            {(presetId || tracker?.id) === "blood_pressure_systolic" ? (
              <View style={styles.columns}>
                <Field
                  label="Systolic from"
                  value={rangeMin}
                  set={setRangeMin}
                  colors={colors}
                />
                <Field
                  label="Systolic to"
                  value={goal}
                  set={setGoal}
                  colors={colors}
                />
                <Field
                  label="Diastolic from"
                  value={diastolicMin}
                  set={setDiastolicMin}
                  colors={colors}
                />
                <Field
                  label="Diastolic to"
                  value={diastolicGoal}
                  set={setDiastolicGoal}
                  colors={colors}
                />
              </View>
            ) : rangeGoal ? (
              <View style={styles.columns}>
                <Field
                  label="From"
                  value={rangeMin}
                  set={setRangeMin}
                  colors={colors}
                />
                <Field
                  label="To"
                  value={rangeMax}
                  set={setRangeMax}
                  colors={colors}
                />
              </View>
            ) : (
              <View style={styles.columns}>
                <Field
                  label={groupScope ? "Default target" : "Target"}
                  value={goal}
                  set={setGoal}
                  colors={colors}
                />
                <Field
                  label="Unit"
                  value={unit}
                  set={setUnit}
                  colors={colors}
                  keyboard={false}
                />
              </View>
            )}
            {false && dataType === "number" &&
            !rangeGoal &&
            (presetId || tracker?.id) !== "blood_pressure_systolic" ? (
              <>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Progress bar
                </Text>
                <View style={styles.wrap}>
                  <Chip
                    label="Daily target"
                    selected={goalProgressMode === "daily"}
                    onPress={() => setGoalProgressMode("daily")}
                  />
                  <Chip
                    label="First reading → target"
                    selected={goalProgressMode === "journey"}
                    onPress={() => setGoalProgressMode("journey")}
                  />
                </View>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Long-term progress starts at the first logged reading and
                  reaches 100% at the target. It is judged only on measurement
                  days.
                </Text>
              </>
            ) : null}
          </>
        ) : null}
        {!groupScope && isFastingTracker ? (
          <View style={[styles.advancedSection, { borderColor: colors.border }]}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>Fasting plan</Text>
            <Text style={[styles.help, { color: colors.muted }]}>Set the usual window here. Start or end the actual fast from the tracker page.</Text>
            <View style={styles.inlineFields}>
              <TimeInput
                label="Desired start"
                value={fastingStartTime}
                onChange={setFastingStartTime}
                wheelPicker
              />
              <View style={styles.grow}>
                <Text style={[styles.label, { color: colors.ink }]}>Fast duration</Text>
                <TextInput
                  value={fastingHours}
                  onChangeText={setFastingHours}
                  keyboardType="decimal-pad"
                  style={[styles.compactInput, { color: colors.ink, borderColor: colors.border }]}
                />
              </View>
            </View>
            <View
              style={[
                styles.fastingSummary,
                { backgroundColor: colors.canvas, borderColor: colors.border },
              ]}
            >
              <View style={styles.grow}>
                <Text style={[styles.fastingSummaryLabel, { color: colors.muted }]}>Fast ends</Text>
                <Text style={[styles.fastingSummaryValue, { color: colors.ink }]}>{fastingEndTime}</Text>
              </View>
              <View style={styles.grow}>
                <Text style={[styles.fastingSummaryLabel, { color: colors.muted }]}>Eating window</Text>
                <Text style={[styles.fastingSummaryValue, { color: colors.ink }]}>{eatingWindowHours} hr</Text>
              </View>
            </View>
            <View style={[styles.switchRow, { borderColor: colors.border }]}>
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>Auto from meals</Text>
                <Text style={[styles.help, { color: colors.muted }]}>Food entries adjust the fast automatically. Manual Start and End remain available.</Text>
              </View>
              <Switch value={automaticFoodBreak} onValueChange={setAutomaticFoodBreak} />
            </View>
          </View>
        ) : null}
      </Card>
      <Pressable
        onPress={() => setAdvanced((value) => !value)}
        style={[
          styles.advancedButton,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.rowTitle, { color: colors.ink }]}>
            Advanced settings
          </Text>
          <Text style={[styles.help, { color: colors.muted }]}>
            Health sync, calculations, scoring and appearance
          </Text>
        </View>
        <Ionicons
          name={advanced ? "chevron-up" : "chevron-down"}
          size={19}
          color={accent}
        />
      </Pressable>
      {advanced ? (
        <View
          onLayout={(event) => {
            advancedPanelY.current = event.nativeEvent.layout.y;
            if (
              focus !== "notifications" ||
              scrolledToNotifications.current
            )
              return;
            setTimeout(() => {
              if (
                behaviorSectionY.current <= 0 ||
                remindersSectionY.current <= 0
              )
                return;
              scrollRef.current?.scrollTo({
                y: Math.max(
                  0,
                  advancedPanelY.current +
                    behaviorSectionY.current +
                    remindersSectionY.current -
                    65,
                ),
                animated: true,
              });
              scrolledToNotifications.current = true;
            }, 80);
          }}
        >
        <Card style={styles.advancedPanel}>
          {!groupScope && goalEnabled && dataType !== "text" ? (
            <>
              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Count in tracked goals
                  </Text>
                  <Text style={[styles.help, { color: colors.muted }]}>
                    Include this goal in daily completion from its start date.
                  </Text>
                </View>
                <Switch value={trackGoal} onValueChange={setTrackGoal} />
              </View>
              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Show on Today
                  </Text>
                  <Text style={[styles.help, { color: colors.muted }]}>
                    Keep it visible without making it a daily goal.
                  </Text>
                </View>
                <Switch
                  value={trackGoal || addToToday}
                  disabled={trackGoal}
                  onValueChange={setAddToToday}
                />
              </View>
            </>
          ) : null}
          {dataType === "number" && !isFastingTracker ? (
            <View style={[styles.switchRow, { borderColor: colors.border }]}>
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>
                  Timed activity
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Use this tracker with the stopwatch or countdown.
                </Text>
              </View>
              <Switch value={timerEnabled} onValueChange={setTimerEnabled} />
            </View>
          ) : null}
            <ChoicePicker
              label={groupScope ? "Default visibility" : "Visibility"}
              value={visibility}
              open={visibilityOpen}
              setOpen={setVisibilityOpen}
              options={[
                { id: "group", label: "Exact value", icon: "people-outline" },
                {
                  id: "status",
                  label: "Goal status only",
                  icon: "checkmark-circle-outline",
                },
                { id: "private", label: "Only me", icon: "lock-closed-outline" },
              ]}
              onChange={(value) => setVisibility(value as Visibility)}
              colors={colors}
              accent={accent}
              help={
                groupScope
                  ? "The group default. Each member may choose a stricter personal visibility."
                  : "Controls what group members can see for this tracker."
              }
            />
          {dataType === "number" &&
          !isFastingTracker &&
          !rangeGoal &&
          (presetId || tracker?.id) !== "blood_pressure_systolic" ? (
            <View style={[styles.advancedSection, { borderColor: colors.border }]}>
              <ChoicePicker
                label="Progress bar"
                value={goalProgressMode}
                open={progressOpen}
                setOpen={setProgressOpen}
                options={[
                  { id: "daily", label: "Daily target" },
                  {
                    id: "journey",
                    label: "Journey",
                  },
                ]}
                onChange={setGoalProgressMode}
                colors={colors}
                accent={accent}
              />
            </View>
          ) : null}
          {dataType === "number" &&
          goalEnabled &&
          !isFastingTracker &&
          !rangeGoal &&
          goalProgressMode !== "journey" &&
          !["weight", "food"].includes(presetId || tracker?.id || "") ? (
            <View
              style={[styles.advancedSection, { borderColor: colors.border }]}
            >
              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Automatic target
                  </Text>
                  <Text style={[styles.help, { color: colors.muted }]}>
                    Use your own completed history. The manual target remains
                    the fallback when no earlier data is available.
                  </Text>
                </View>
                <Switch
                  value={adaptiveTargetEnabled}
                  onValueChange={setAdaptiveTargetEnabled}
                />
              </View>
              {adaptiveTargetEnabled ? (
                <View style={styles.visualChoices}>
                  <ChoicePicker
                    label="Calculate with"
                    value={adaptiveTargetStatistic}
                    open={adaptiveStatisticOpen}
                    setOpen={setAdaptiveStatisticOpen}
                    options={[
                      { id: "average", label: "Average" },
                      { id: "median", label: "Median" },
                    ]}
                    onChange={(value) =>
                      setAdaptiveTargetStatistic(value as "average" | "median")
                    }
                    colors={colors}
                    accent={accent}
                  />
                  <ChoicePicker
                    label="History"
                    value={adaptiveTargetPeriod}
                    open={adaptivePeriodOpen}
                    setOpen={setAdaptivePeriodOpen}
                    options={[
                      { id: "week", label: "Previous week" },
                      { id: "month", label: "Previous month" },
                      { id: "year", label: "Previous year" },
                      { id: "all_time", label: "All earlier data" },
                    ]}
                    onChange={(value) =>
                      setAdaptiveTargetPeriod(
                        value as "week" | "month" | "year" | "all_time",
                      )
                    }
                    colors={colors}
                    accent={accent}
                    help="Week, month and year use the last fully completed calendar period."
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={[styles.advancedSection, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => setVisualsOpen((open) => !open)}
              style={styles.collapseHeading}
            >
              <View style={styles.grow}>
                <View style={styles.submetricTitleRow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Charts &amp; visuals
                  </Text>
                  <InfoPopover
                    label="About chart customization"
                    message="Chart and submetric customization is in beta and may not behave as expected for every custom tracker. If something looks wrong, send feedback from Settings so it can be fixed."
                  />
                </View>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Tracker detail and goal-map display
                </Text>
              </View>
              <Ionicons
                name={visualsOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.faint}
              />
            </Pressable>
            {visualsOpen ? (
              <View style={styles.visualChoices}>
                <VisualChoice
                  label="Selected day"
                  value={detailDayVisual}
                  options={[
                    ["progress", "Goal progress"],
                    ["completion", "Complete / not"],
                    ["none", "No visual"],
                  ]}
                  onChange={(value) =>
                    setDetailDayVisual(
                      value as "progress" | "completion" | "none",
                    )
                  }
                />
                <VisualChoice
                  label="Detail ranges"
                  value={detailRangeVisual}
                  options={[
                    ["auto", "Automatic"],
                    ["line", "Line"],
                    ["bar", "Bars"],
                    ["both", "Line and bars"],
                    ["completion", "Goal status"],
                  ]}
                  onChange={(value) =>
                    setDetailRangeVisual(value as MetricChartStyle)
                  }
                />
                <VisualChoice
                  label="Goal map"
                  value={progressGridVisual}
                  options={[
                    ["intensity", "Value intensity"],
                    ["completion", "Complete / not"],
                  ]}
                  onChange={(value) =>
                    setProgressGridVisual(
                      value as "intensity" | "completion",
                    )
                  }
                />
              </View>
            ) : null}
          </View>
          {(() => {
            deferredSubmetrics = (
          <View style={[styles.advancedSection, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => setSubmetricsOpen((open) => !open)}
              style={styles.collapseHeading}
            >
              <View style={styles.grow}>
                <View style={styles.submetricTitleRow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Submetrics
                  </Text>
                  <InfoPopover
                    label="How submetrics work"
                    message="Submetrics store related inputs together in one tracker. For example, blood pressure can collect systolic, diastolic and pulse, while selected fields can also update linked trackers. This beta feature may not cover every custom setup yet; report unexpected behavior from Settings."
                  />
                </View>
                <Text style={[styles.help, { color: colors.muted }]}>
                  {submetrics.length
                    ? `${submetrics.length} linked field${submetrics.length === 1 ? "" : "s"}`
                    : "Optional compound inputs such as blood pressure or nutrition"}
                </Text>
              </View>
              <Ionicons
                name={submetricsOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.faint}
              />
            </Pressable>
            {submetricsOpen ? (
              <View style={[styles.submetricList, { borderTopColor: colors.border }]}>
                {submetrics.length ? (
                  <View style={styles.switchRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: colors.ink }]}>
                        Main value
                      </Text>
                      <Text style={[styles.help, { color: colors.muted }]}>
                        Turn off when entries consist only of the fields below.
                      </Text>
                    </View>
                    <Switch
                      value={mainValueEnabled}
                      onValueChange={setMainValueEnabled}
                    />
                  </View>
                ) : null}
                {submetrics.map((submetric, index) => (
                  <View
                    key={submetric.id}
                    style={[styles.submetricCard, { borderColor: colors.border }]}
                  >
                    <View style={styles.submetricHeading}>
                      <Text style={[styles.mini, { color: colors.muted }]}>
                        FIELD {index + 1}
                      </Text>
                      <Pressable
                        accessibilityLabel={`Remove ${submetric.name}`}
                        onPress={() =>
                          setSubmetrics((current) =>
                            current.filter((item) => item.id !== submetric.id),
                          )
                        }
                      >
                        <Ionicons name="trash-outline" size={16} color={palette.red} />
                      </Pressable>
                    </View>
                    <View style={styles.twoFields}>
                      <View style={styles.grow}>
                        <Field
                          label="Name"
                          value={submetric.name}
                          set={(name) =>
                            setSubmetrics((current) =>
                              current.map((item) =>
                                item.id === submetric.id ? { ...item, name } : item,
                              ),
                            )
                          }
                          colors={colors}
                          keyboard={false}
                        />
                      </View>
                      <View style={styles.shortField}>
                        <Field
                          label="Unit"
                          value={submetric.unit}
                          set={(unit) =>
                            setSubmetrics((current) =>
                              current.map((item) =>
                                item.id === submetric.id ? { ...item, unit } : item,
                              ),
                            )
                          }
                          colors={colors}
                          keyboard={false}
                        />
                      </View>
                    </View>
                    <View style={styles.switchRow}>
                      <View style={styles.grow}>
                        <Text style={[styles.rowTitle, { color: colors.ink }]}>
                          Show progress bar
                        </Text>
                        <Text style={[styles.help, { color: colors.muted }]}>
                          Up to four compound fields can be shown.
                        </Text>
                      </View>
                      <Switch
                        value={submetric.showProgressBar === true}
                        onValueChange={(showProgressBar) =>
                          setSubmetrics((current) =>
                            current.map((item) =>
                              item.id === submetric.id
                                ? { ...item, showProgressBar }
                                : item,
                            ),
                          )
                        }
                      />
                    </View>
                    {submetric.showProgressBar ? (
                      <>
                        <ChoicePicker
                          label="Success"
                          value={submetric.goalRange ? "range" : submetric.goal.kind}
                          open={openSubmetricGoalId === submetric.id}
                          setOpen={(open) =>
                            setOpenSubmetricGoalId(open ? submetric.id : null)
                          }
                          options={[
                            { id: "at_least", label: "At least" },
                            { id: "at_most", label: "At most" },
                            { id: "exact", label: "Near target" },
                            { id: "range", label: "Inside a range" },
                          ]}
                          onChange={(value) =>
                            setSubmetrics((current) =>
                              current.map((item) =>
                                item.id === submetric.id
                                  ? value === "range"
                                    ? {
                                        ...item,
                                        goalEnabled: true,
                                        goal: { kind: "exact", target: item.goal.target },
                                        goalRange: item.goalRange ?? {
                                          min: Math.max(0, item.goal.target * 0.8),
                                          max: item.goal.target,
                                        },
                                      }
                                    : {
                                        ...item,
                                        goalEnabled: true,
                                        goal: {
                                          ...item.goal,
                                          kind: value as GoalKind,
                                        },
                                        goalRange: undefined,
                                      }
                                  : item,
                              ),
                            )
                          }
                          colors={colors}
                          accent={accent}
                        />
                        <View style={styles.twoFields}>
                          {(submetric.goalRange
                            ? [
                                ["From", submetric.goalRange.min, "min"],
                                ["To", submetric.goalRange.max, "max"],
                              ]
                            : [["Target", submetric.goal.target, "target"]]
                          ).map(([label, amount, key]) => (
                            <View key={String(key)} style={styles.grow}>
                              <Field
                                label={String(label)}
                                value={String(amount)}
                                set={(raw) =>
                                  setSubmetrics((current) =>
                                    current.map((item) => {
                                      if (item.id !== submetric.id) return item;
                                      const next = Number(raw.replace(",", "."));
                                      if (key === "target")
                                        return {
                                          ...item,
                                          goalEnabled: true,
                                          goal: {
                                            ...item.goal,
                                            target: Number.isFinite(next) ? next : 0,
                                          },
                                        };
                                      const range = item.goalRange ?? {
                                        min: 0,
                                        max: item.goal.target,
                                      };
                                      const goalRange = {
                                        ...range,
                                        [String(key)]: Number.isFinite(next) ? next : 0,
                                      };
                                      return {
                                        ...item,
                                        goalEnabled: true,
                                        goalRange,
                                        goal: {
                                          kind: "exact",
                                          target: goalRange.max,
                                        },
                                      };
                                    }),
                                  )
                                }
                                colors={colors}
                              />
                            </View>
                          ))}
                        </View>
                        <ChoicePicker
                          label="Range chart"
                          value={submetric.chartStyle ?? "auto"}
                          open={openSubmetricChartId === submetric.id}
                          setOpen={(open) =>
                            setOpenSubmetricChartId(
                              open ? submetric.id : null,
                            )
                          }
                          options={[
                            { id: "auto", label: "Follow tracker" },
                          { id: "line", label: "Line" },
                          { id: "bar", label: "Bars" },
                          { id: "both", label: "Line and bars" },
                            { id: "completion", label: "Goal status" },
                          ]}
                          onChange={(value) =>
                            setSubmetrics((current) =>
                              current.map((item) =>
                                item.id === submetric.id
                                  ? {
                                      ...item,
                                      chartStyle:
                                        value as MetricChartStyle,
                                    }
                                  : item,
                              ),
                            )
                          }
                          colors={colors}
                          accent={accent}
                        />
                      </>
                    ) : null}
                    <MetricSelector
                      title="Connected tracker"
                      emptyLabel="No linked tracker"
                      multiple={false}
                      items={sourceMetrics
                        .filter((item) => item.id !== tracker?.id)
                        .map((item) => ({
                          id: item.id,
                          label: item.name,
                          icon: item.icon as keyof typeof Ionicons.glyphMap,
                          color: item.color,
                        }))}
                      selectedIds={
                        submetric.linkedMetricId ? [submetric.linkedMetricId] : []
                      }
                      onChange={(ids) =>
                        setSubmetrics((current) =>
                          current.map((item) =>
                            item.id === submetric.id
                              ? { ...item, linkedMetricId: ids[0] }
                              : item,
                          ),
                        )
                      }
                    />
                    <ChoicePicker
                      label="Health source"
                      value={submetric.healthMapping?.dataType ?? "none"}
                      open={openSubmetricHealthId === submetric.id}
                      setOpen={(open) =>
                        setOpenSubmetricHealthId(open ? submetric.id : null)
                      }
                      options={[
                        { id: "none", label: "No device connection" },
                        ...AVAILABLE_SOURCES.map((source) => ({
                          id: source.id,
                          label: source.label,
                        })),
                      ]}
                      onChange={(value) =>
                        setSubmetrics((current) =>
                          current.map((item) =>
                            item.id === submetric.id
                              ? {
                                  ...item,
                                  healthMapping:
                                    value === "none"
                                      ? undefined
                                      : {
                                          dataType: value as HealthDataType,
                                          field:
                                            SOURCES.find(
                                              (source) => source.id === value,
                                            )?.fields[0]?.id ?? "value",
                                        },
                                }
                              : item,
                          ),
                        )
                      }
                      colors={colors}
                      accent={accent}
                    />
                    {submetric.healthMapping ? (
                      <ChoicePicker
                        label="Imported value"
                        value={submetric.healthMapping.field}
                        open={openSubmetricFieldId === submetric.id}
                        setOpen={(open) =>
                          setOpenSubmetricFieldId(open ? submetric.id : null)
                        }
                        options={(
                          SOURCES.find(
                            (source) =>
                              source.id === submetric.healthMapping?.dataType,
                          )?.fields ?? []
                        ).map((field) => ({
                          id: field.id,
                          label: field.label,
                        }))}
                        onChange={(value) =>
                          setSubmetrics((current) =>
                            current.map((item) =>
                              item.id === submetric.id && item.healthMapping
                                ? {
                                    ...item,
                                    healthMapping: {
                                      ...item.healthMapping,
                                      field: value as HealthMetricField,
                                    },
                                  }
                                : item,
                            ),
                          )
                        }
                        colors={colors}
                        accent={accent}
                      />
                    ) : null}
                  </View>
                ))}
                <Pressable
                  onPress={() =>
                    setSubmetrics((current) => [
                      ...current,
                      {
                        id: `field_${Date.now().toString(36)}`,
                        name: `Field ${current.length + 1}`,
                        unit: "",
                        goalEnabled: false,
                        goal: { kind: "at_least", target: 0 },
                        showProgressBar: false,
                      },
                    ])
                  }
                  style={[styles.addReminder, { borderColor: accent }]}
                >
                  <Ionicons name="add" size={16} color={accent} />
                  <Text style={[styles.help, { color: accent }]}>Add submetric</Text>
                </Pressable>
                {submetrics.length ? (
                  <>
                    <View style={styles.wrap}>
                      <Chip
                        label="Separate values"
                        selected={submetricDisplayMode === "separate"}
                        onPress={() => setSubmetricDisplayMode("separate")}
                      />
                      <Chip
                        label="Merged value"
                        selected={submetricDisplayMode === "merged"}
                        onPress={() => setSubmetricDisplayMode("merged")}
                      />
                    </View>
                    {submetricDisplayMode === "merged" ? (
                      <Field
                        label="Merged format"
                        value={submetricTemplate}
                        set={setSubmetricTemplate}
                        colors={colors}
                        keyboard={false}
                        info="Use a submetric ID inside braces. Add .unit when its unit should appear. Text and separators are kept exactly as entered."
                        example="Example: {systolic}/{diastolic} {systolic.unit} becomes 120/80 mmHg."
                      />
                    ) : null}
                    <View style={styles.switchRow}>
                      <Text style={[styles.rowTitle, { color: colors.ink }]}>
                        Collapse extra inputs
                      </Text>
                      <Switch
                        value={submetricsCollapsible}
                        onValueChange={setSubmetricsCollapsible}
                      />
                    </View>
                    {submetricsCollapsible ? (
                      <>
                        <Field
                          label="Visible inputs"
                          value={visibleSubmetricCount}
                          set={setVisibleSubmetricCount}
                          colors={colors}
                          info="Submetrics follow the order they were created. The first number you choose stays visible in the log form; all later inputs appear under the collapsed section."
                        />
                        <Field
                          label="Collapsed label"
                          value={submetricsLabel}
                          set={setSubmetricsLabel}
                          colors={colors}
                          keyboard={false}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
            );
            return null;
          })()}
          <View style={[styles.advancedSection, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => setHealthOpen((open) => !open)}
              style={styles.collapseHeading}
            >
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>
                  Health connection
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  {healthType
                    ? `Connected to ${SOURCES.find((item) => item.id === healthType)?.label ?? healthType}`
                    : "No health source connected"}
                </Text>
              </View>
              <Ionicons
                name={healthOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.faint}
              />
            </Pressable>
            {healthOpen ? (
              <>
                <Text style={[styles.help, { color: colors.muted }]}>
                  {gymMapping
                    ? "This standardized tracker is calculated from Workout sessions. Raw sets and notes remain private."
                    : "Link this tracker to compatible data from Apple Health or Health Connect."}
                </Text>
                <ChoicePicker
                  label="Health source"
                  value={healthType || "none"}
                  open={healthSourceChoiceOpen}
                  setOpen={setHealthSourceChoiceOpen}
                  options={[
                    { id: "none", label: "No connection" },
                    ...AVAILABLE_SOURCES.map((item) => ({
                      id: item.id,
                      label: item.label,
                    })),
                  ]}
                  onChange={(value) => {
                    if (value === "none") {
                      setHealthType("");
                      return;
                    }
                    const next = SOURCES.find((item) => item.id === value);
                    setHealthType(value as HealthDataType);
                    setHealthField(next?.fields[0]?.id ?? "value");
                    if (value === "steps") setManualEntry(false);
                  }}
                  colors={colors}
                  accent={accent}
                  help="Choose the device reading that should update this tracker."
                />
            {source ? (
              <ChoicePicker
                label="Imported value"
                value={healthField}
                open={healthFieldChoiceOpen}
                setOpen={setHealthFieldChoiceOpen}
                options={source.fields.map((field) => ({
                  id: field.id,
                  label: field.label,
                }))}
                onChange={setHealthField}
                colors={colors}
                accent={accent}
                help="Select the exact field to import from this health record."
              />
            ) : null}
            {healthType === "active_energy" ||
            (healthType === "workouts" && healthField === "active_calories") ? (
              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Estimate uncovered walking
                  </Text>
                  <Text style={[styles.help, { color: colors.muted }]}>
                    If activity calories are missing, use only steps not already
                    explained by walking or running workouts.
                  </Text>
                </View>
                <Switch value={stepFallback} onValueChange={setStepFallback} />
              </View>
            ) : null}
            <View style={[styles.switchRow, { borderColor: colors.border }]}>
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>
                  Allow manual entries
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Turn off for device-owned values such as steps.
                </Text>
              </View>
              <Switch
                value={
                  gymMapping ||
                  healthType === "steps" ||
                  tracker?.id === "steps" ||
                  isFastingTracker
                    ? false
                    : manualEntry
                }
                disabled={
                  Boolean(gymMapping) ||
                  healthType === "steps" ||
                  tracker?.id === "steps" ||
                  isFastingTracker
                }
                onValueChange={setManualEntry}
              />
            </View>
              </>
            ) : null}
          </View>
          {groupScope && dataType === "calculated" ? (
            <View style={[styles.advancedSection, { borderColor: colors.border }]}>
              <Text style={[styles.rowTitle, { color: colors.ink }]}>
                Calculation
              </Text>
              <Text style={[styles.help, { color: colors.muted }]}>
                Build the shared calculated value from available trackers.
              </Text>
              {renderFormulaEditor()}
            </View>
          ) : null}
          {!groupScope ? (
          <View
            onLayout={(event) => {
              behaviorSectionY.current = event.nativeEvent.layout.y;
              if (
                focus !== "goal-start" ||
                scrolledToGoalStart.current
              )
                return;
              scrolledToGoalStart.current = true;
              const y = event.nativeEvent.layout.y;
              setTimeout(
                () =>
                  scrollRef.current?.scrollTo({
                    y: Math.max(0, y - 75),
                    animated: true,
                  }),
                80,
              );
            }}
          >
          <View style={[styles.advancedSection, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => setBehaviorOpen((open) => !open)}
              style={styles.collapseHeading}
            >
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>
                  Goal behavior &amp; reminders
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Start date, schedule and reminder times
                </Text>
              </View>
              <Ionicons
                name={behaviorOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.faint}
              />
            </Pressable>
            {behaviorOpen ? (
              <>
            {!groupScope && goalEnabled && dataType !== "text" ? (
                <View style={styles.goalStart}>
                    <View style={styles.goalStartHeading}>
                      <Text style={[styles.label, { color: colors.ink }]}>
                        Goal starts
                      </Text>
                      <Pressable
                        onPress={() => {
                          setActiveFrom(dateKey());
                          setGoalCalendarOpen(false);
                        }}
                        style={[
                          styles.todayButton,
                          {
                            borderColor: accent,
                            backgroundColor: colors.primarySoft,
                          },
                        ]}
                      >
                        <Text style={[styles.todayText, { color: accent }]}>
                          Today
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() =>
                        setGoalCalendarOpen((open) => !open)
                      }
                      style={[
                        styles.goalDate,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.canvas,
                        },
                      ]}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={17}
                        color={accent}
                      />
                      <Text style={[styles.goalDateText, { color: colors.ink }]}>
                        {new Date(
                          `${activeFrom}T12:00:00`,
                        ).toLocaleDateString(locale, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </Text>
                      <Ionicons
                        name={
                          goalCalendarOpen
                            ? "chevron-up"
                            : "chevron-down"
                        }
                        size={16}
                        color={colors.muted}
                      />
                    </Pressable>
                    {goalCalendarOpen ? (
                      <View
                        style={[
                          styles.goalCalendar,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <MonthCalendar
                          monthDate={activeFrom}
                          selectedDate={activeFrom}
                          onSelect={(selectedDate) => {
                            setActiveFrom(selectedDate);
                            setGoalCalendarOpen(false);
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
            ) : null}
            {!groupScope ? <View
              onLayout={(event) => {
                remindersSectionY.current = event.nativeEvent.layout.y;
                if (
                  focus !== "notifications" ||
                  scrolledToNotifications.current
                )
                  return;
                scrolledToNotifications.current = true;
                const y =
                  advancedPanelY.current +
                  behaviorSectionY.current +
                  event.nativeEvent.layout.y;
                setTimeout(
                  () =>
                    scrollRef.current?.scrollTo({
                      y: Math.max(0, y - 75),
                      animated: true,
                    }),
                  100,
                );
              }}
            >
              <View
                style={[styles.collapsibleGroup, { borderColor: colors.border }]}
              >
                <Pressable
                  onPress={() => setRemindersOpen((open) => !open)}
                  style={styles.collapseHeading}
                >
                  <View style={styles.grow}>
                    <Text style={[styles.rowTitle, { color: colors.ink }]}>
                      Reminders
                    </Text>
                    <Text style={[styles.help, { color: colors.muted }]}>
                      {reminderEnabled || progressRemindersEnabled
                        ? [
                            reminderEnabled
                              ? `${reminderTimes.length} timed reminder${reminderTimes.length === 1 ? "" : "s"}`
                              : "",
                            progressRemindersEnabled ? "progress alerts" : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "Off"}
                    </Text>
                  </View>
                  <Ionicons
                    name={remindersOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.faint}
                  />
                </Pressable>
                {remindersOpen ? (
                  <>
                    <View
                      style={[
                        styles.switchRow,
                        { borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.grow}>
                        <Text
                          style={[styles.rowTitle, { color: colors.ink }]}
                        >
                          Remind me
                        </Text>
                        <Text style={[styles.help, { color: colors.muted }]}>
                          Uses the times below and respects quiet hours.
                        </Text>
                      </View>
                      <Switch
                        value={reminderEnabled}
                        onValueChange={setReminderEnabled}
                      />
                    </View>
                    {reminderTimes.map((time, index) => (
                      <View key={index} style={styles.reminderBlock}>
                      <View style={styles.reminderRow}>
                        <View style={styles.grow}>
                          <TimeInput
                            label={`Time ${index + 1}`}
                            value={time}
                            wheelPicker
                            onChange={(value) =>
                              setReminderTimes((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? value : item,
                                ),
                              )
                            }
                          />
                        </View>
                        {reminderTimes.length > 1 ? (
                          <IconButton
                            icon="trash-outline"
                            label="Remove reminder"
                            onPress={() =>
                              {
                                setReminderTimes((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                );
                                setReminderSchedules((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                );
                                setReminderDurations((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                );
                              }
                            }
                          />
                        ) : null}
                      </View>
                      {timerEnabled ? (
                        <>
                          <Pressable
                            onPress={() =>
                              setReminderDurations((current) => {
                                const next = [...current];
                                next[index] = next[index] ? undefined : 60;
                                return next;
                              })
                            }
                            style={[styles.reminderFrequency, { borderColor: colors.border }]}
                          >
                            <Ionicons name="timer-outline" size={14} color={accent} />
                            <Text style={[styles.help, { color: colors.ink }]}>Planned timed session</Text>
                            <Ionicons
                              name={reminderDurations[index] ? "checkbox" : "square-outline"}
                              size={17}
                              color={reminderDurations[index] ? accent : colors.faint}
                            />
                          </Pressable>
                          {reminderDurations[index] ? (
                            <TimeInput
                              label="Ends"
                              value={clockPlusMinutes(time, reminderDurations[index] ?? 60)}
                              onChange={(end) =>
                                setReminderDurations((current) => {
                                  const next = [...current];
                                  next[index] = clockDurationMinutes(time, end);
                                  return next;
                                })
                              }
                              wheelPicker
                            />
                          ) : null}
                        </>
                      ) : null}
                      <Pressable
                        onPress={() =>
                          setReminderFrequencyOpen((current) =>
                            current === index ? null : index,
                          )
                        }
                        style={[
                          styles.reminderFrequency,
                          { borderColor: colors.border },
                        ]}
                      >
                        <Ionicons name="repeat-outline" size={14} color={accent} />
                        <Text style={[styles.help, { color: colors.ink }]}>
                          {reminderScheduleLabel(reminderSchedules[index])}
                        </Text>
                        <Ionicons
                          name={
                            reminderFrequencyOpen === index
                              ? "chevron-up"
                              : "chevron-down"
                          }
                          size={14}
                          color={colors.faint}
                        />
                      </Pressable>
                      {reminderFrequencyOpen === index ? (
                        <ReminderScheduleEditor
                          schedule={reminderSchedules[index]}
                          anchorDate={activeFrom}
                          onChange={(schedule) =>
                            setReminderSchedules((current) => {
                              const next = [...current];
                              next[index] = schedule;
                              return next;
                            })
                          }
                        />
                      ) : null}
                      </View>
                    ))}
                    <Pressable
                      onPress={() => {
                        setReminderTimes((current) => [...current, "19:00"]);
                        setReminderSchedules((current) => [
                          ...current,
                          undefined,
                        ]);
                        setReminderDurations((current) => [
                          ...current,
                          undefined,
                        ]);
                      }}
                      style={[styles.addReminder, { borderColor: accent }]}
                    >
                      <Ionicons name="add" size={16} color={accent} />
                      <Text style={[styles.help, { color: accent }]}>
                        Add time
                      </Text>
                    </Pressable>
                    <View
                      style={[
                        styles.progressReminderPanel,
                        { borderTopColor: colors.border },
                      ]}
                    >
                      <View style={styles.switchRow}>
                        <View style={styles.grow}>
                          <Text style={[styles.rowTitle, { color: colors.ink }]}>Progress alerts</Text>
                          <Text style={[styles.help, { color: colors.muted }]}>
                            Alert once per tracker and day when progress crosses a selected milestone.
                          </Text>
                        </View>
                        <Switch
                          value={progressRemindersEnabled}
                          onValueChange={setProgressRemindersEnabled}
                        />
                      </View>
                      {progressRemindersEnabled ? (
                        <>
                          <View style={styles.wrap}>
                            {[25, 50, 75, 90, 100].map((percentage) => {
                              const selected = progressReminderPercentages.includes(percentage);
                              return (
                                <Chip
                                  key={percentage}
                                  label={`${percentage}%`}
                                  size="small"
                                  selected={selected}
                                  onPress={() =>
                                    setProgressReminderPercentages((current) =>
                                      selected
                                        ? current.filter((value) => value !== percentage)
                                        : [...current, percentage].sort((a, b) => a - b),
                                    )
                                  }
                                />
                              );
                            })}
                          </View>
                          <View style={styles.progressReminderCustom}>
                            <TextInput
                              value={customProgressReminder}
                              onChangeText={setCustomProgressReminder}
                              keyboardType="number-pad"
                              placeholder="Custom %"
                              placeholderTextColor={colors.faint}
                              style={[
                                styles.reminderScheduleInput,
                                styles.grow,
                                {
                                  color: colors.ink,
                                  borderColor: colors.border,
                                  backgroundColor: colors.canvas,
                                },
                              ]}
                            />
                            <IconButton
                              icon="add"
                              label="Add progress milestone"
                              onPress={() => {
                                const value = Math.round(Number(customProgressReminder));
                                if (!Number.isFinite(value) || value < 1 || value > 300) return;
                                setProgressReminderPercentages((current) =>
                                  [...new Set([...current, value])].sort((a, b) => a - b),
                                );
                                setCustomProgressReminder("");
                              }}
                            />
                          </View>
                          {progressReminderPercentages.some(
                            (percentage) => ![25, 50, 75, 90, 100].includes(percentage),
                          ) ? (
                            <View style={styles.wrap}>
                              {progressReminderPercentages
                                .filter((percentage) => ![25, 50, 75, 90, 100].includes(percentage))
                                .map((percentage) => (
                                  <Chip
                                    key={percentage}
                                    label={`${percentage}% ×`}
                                    size="small"
                                    selected
                                    onPress={() =>
                                      setProgressReminderPercentages((current) =>
                                        current.filter((value) => value !== percentage),
                                      )
                                    }
                                  />
                                ))}
                            </View>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                    {linkedScheduledReminders.length ? (
                      <View
                        style={[
                          styles.linkedReminders,
                          { borderColor: colors.border },
                        ]}
                      >
                        <Text style={[styles.help, { color: colors.muted }]}>
                          Added from Schedule
                        </Text>
                        {linkedScheduledReminders.map((reminder) => (
                          <Pressable
                            key={reminder.id}
                            onPress={() =>
                              router.navigate({
                                pathname: "/reminder-editor",
                                params: { id: reminder.id },
                              } as never)
                            }
                            style={styles.linkedReminderRow}
                          >
                            <Ionicons
                              name="calendar-outline"
                              size={14}
                              color={accent}
                            />
                            <Text
                              style={[
                                styles.linkedReminderText,
                                { color: colors.ink },
                              ]}
                            >
                              {reminder.time} ·{" "}
                              {reminderScheduleLabel(reminder.schedule)}
                            </Text>
                            <Ionicons
                              name="chevron-forward"
                              size={14}
                              color={colors.faint}
                            />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>
              <View
                style={[styles.collapsibleGroup, { borderColor: colors.border }]}
              >
                <Pressable
                  onPress={() => setScheduleOpen((open) => !open)}
                  style={styles.collapseHeading}
                >
                  <View style={styles.grow}>
                    <Text style={[styles.rowTitle, { color: colors.ink }]}>
                      Goal schedule
                    </Text>
                    <Text style={[styles.help, { color: colors.muted }]}>
                      {
                        {
                          once: "Once",
                          daily: "Every day",
                          selected_days: "Selected weekdays",
                          every_other_day: "Every other day",
                          interval_days: `Every ${intervalDays || "N"} days`,
                          days_of_month: "Specific dates each month",
                          weekly_min: `${minimumCompletions || "N"} times per week`,
                          monthly_min: `${minimumCompletions || "N"} times per month`,
                        }[scheduleMode]
                      }
                    </Text>
                  </View>
                  <Ionicons
                    name={scheduleOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.faint}
                  />
                </Pressable>
                {scheduleOpen ? (
                  <>
                    <ChoicePicker
                      label="Frequency"
                      value={scheduleMode}
                      open={scheduleChoiceOpen}
                      setOpen={setScheduleChoiceOpen}
                      options={[
                        { id: "daily", label: "Every day" },
                        {
                          id: "selected_days",
                          label: "Selected weekdays",
                        },
                        {
                          id: "every_other_day",
                          label: "Every other day",
                        },
                        {
                          id: "interval_days",
                          label: "Every few days",
                        },
                        {
                          id: "days_of_month",
                          label: "Specific dates each month",
                        },
                        {
                          id: "weekly_min",
                          label: "Minimum completions per week",
                        },
                        {
                          id: "monthly_min",
                          label: "Minimum completions per month",
                        },
                      ]}
                      onChange={setScheduleMode}
                      colors={colors}
                      accent={accent}
                      help="Choose exactly when this goal counts. Minimum schedules stay due until the required number is reached."
                    />
                    {scheduleMode === "selected_days" ? (
                      <View style={styles.wrap}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                          (label, day) => (
                            <Chip
                              key={label}
                              label={label}
                              selected={selectedDays.includes(day)}
                              onPress={() =>
                                setSelectedDays((current) =>
                                  current.includes(day)
                                    ? current.filter((item) => item !== day)
                                    : [...current, day],
                                )
                              }
                            />
                          ),
                        )}
                      </View>
                    ) : null}
                    {scheduleMode === "weekly_min" ||
                    scheduleMode === "monthly_min" ? (
                      <Field
                        label="Required completions"
                        value={minimumCompletions}
                        set={setMinimumCompletions}
                        colors={colors}
                      />
                    ) : null}
                    {scheduleMode === "interval_days" ? (
                      <Field
                        label="Days between goals"
                        value={intervalDays}
                        set={setIntervalDays}
                        colors={colors}
                      />
                    ) : null}
                    {scheduleMode === "days_of_month" ? (
                      <Field
                        label="Month dates (for example: 10, 14)"
                        value={daysOfMonth}
                        set={setDaysOfMonth}
                        colors={colors}
                        keyboard={false}
                      />
                    ) : null}
                    {scheduleMode === "weekly_min" ||
                    scheduleMode === "monthly_min" ? (
                      <Text style={[styles.help, { color: colors.muted }]}>
                        The goal remains due until the required total is reached
                        for that week or month.
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            </View> : null}
            {false ? <>
            <Text style={[styles.label, { color: colors.ink }]}>
              Entry type
            </Text>
            <View style={styles.wrap}>
              {(
                [
                  "number",
                  "boolean",
                  "text",
                  "photo",
                  "calculated",
                ] as MetricDataType[]
              ).map((item) => (
                <Chip
                  key={item}
                  label={
                    item === "number"
                      ? "Number"
                      : item === "boolean"
                        ? "Done / not done"
                        : item === "text"
                          ? "Note"
                          : item === "photo"
                            ? "Photo"
                            : "Calculated"
                  }
                  selected={dataType === item}
                  onPress={() => setDataType(item)}
                />
              ))}
            </View>
            {dataType === "number" ? (
              <>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Multiple entries in one day
                </Text>
                <View style={styles.wrap}>
                  {(
                    [
                      ["sum", "Add them"],
                      ["average", "Average"],
                      ["latest", "Use latest"],
                      ["max", "Use highest"],
                      ["min", "Use lowest"],
                    ] as [Aggregation, string][]
                  ).map(([value, label]) => (
                    <Chip
                      key={value}
                      label={label}
                      selected={aggregation === value}
                      onPress={() => setAggregation(value)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            </> : null}
            {renderFormulaEditor()}
              </>
            ) : null}
            {false ? <>
            <Text style={[styles.label, { color: colors.ink }]}>
              Competition order
            </Text>
            <View style={styles.wrap}>
              <Chip
                label="Higher ranks first"
                selected={ranking === "higher"}
                onPress={() => setRanking("higher")}
              />
              <Chip
                label="Lower ranks first"
                selected={ranking === "lower"}
                onPress={() => setRanking("lower")}
              />
              <Chip
                label="Closest to target"
                selected={ranking === "closest"}
                onPress={() => setRanking("closest")}
              />
            </View>
            </> : null}
          </View>
          </View>
          ) : null}
          {deferredSubmetrics}
        </Card>
        </View>
      ) : null}
        </>
      )}
      <View style={styles.actions}>
        {tracker ? (
          <View style={styles.delete}>
            <Button label="Delete" variant="danger" onPress={remove} />
          </View>
        ) : null}
        <View style={styles.grow}>
          <Button
            label={
              tracker
                ? "Save"
                : bulkPresetMode
                  ? groupScope
                    ? "Add selected to group"
                    : "Add selected trackers"
                  : groupScope
                    ? "Add to group"
                    : "Add tracker"
            }
            icon="checkmark"
            onPress={() => save()}
          />
        </View>
      </View>
    </Screen>
  );
}

function reminderScheduleLabel(schedule?: GoalSchedule) {
  if (!schedule) return "Every day this goal is due";
  return (
    {
      once: `Once · ${schedule.anchorDate ?? "selected date"}`,
      daily: "Every day",
      selected_days: "Selected weekdays",
      every_other_day: "Every other day",
      interval_days: `Every ${schedule.intervalDays ?? 1} days`,
      days_of_month: "Specific dates each month",
      weekly_min: "Minimum completions per week",
      monthly_min: "Minimum completions per month",
    }[schedule.mode] ?? "Custom frequency"
  );
}

function ReminderScheduleEditor({
  schedule,
  anchorDate,
  onChange,
}: {
  schedule?: GoalSchedule;
  anchorDate: string;
  onChange: (schedule?: GoalSchedule) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [endCalendarOpen, setEndCalendarOpen] = useState(false);
  const selected = schedule?.mode ?? "__goal__";
  const replace = (changes: Partial<GoalSchedule>) =>
    onChange({
      mode: schedule?.mode ?? "daily",
      anchorDate: schedule?.anchorDate ?? anchorDate,
      ...schedule,
      ...changes,
    });
  return (
    <View style={[styles.reminderSchedule, { borderColor: colors.border }]}>
      <MetricSelector
        title="Frequency"
        searchable={false}
        items={[
          {
            id: "__goal__",
            label: "Whenever the goal is due",
            sublabel: "Uses the goal schedule below",
            icon: "flag-outline",
          },
          {
            id: "once",
            label: "Once",
            sublabel: `On ${anchorDate}`,
            icon: "calendar-outline",
          },
          {
            id: "daily",
            label: "Every day",
            icon: "today-outline",
          },
          {
            id: "selected_days",
            label: "Selected weekdays",
            icon: "calendar-number-outline",
          },
          {
            id: "every_other_day",
            label: "Every other day",
            icon: "swap-horizontal-outline",
          },
          {
            id: "interval_days",
            label: "Custom interval",
            icon: "repeat-outline",
          },
          {
            id: "days_of_month",
            label: "Dates each month",
            icon: "calendar-clear-outline",
          },
        ]}
        selectedIds={[selected]}
        onChange={(ids) => {
          const mode = ids[0];
          if (!mode || mode === "__goal__") onChange(undefined);
          else
            onChange({
              mode: mode as GoalSchedule["mode"],
              anchorDate,
              daysOfWeek:
                mode === "selected_days" ? [1, 3, 5] : undefined,
              intervalDays: mode === "interval_days" ? 7 : undefined,
              daysOfMonth: mode === "days_of_month" ? [1, 15] : undefined,
            });
        }}
        multiple={false}
      />
      {schedule?.mode === "selected_days" ? (
        <MetricSelector
          title="Weekdays"
          items={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (label, day) => ({
              id: String(day),
              label,
              icon: "calendar-outline" as const,
            }),
          )}
          selectedIds={(schedule.daysOfWeek ?? []).map(String)}
          onChange={(ids) => replace({ daysOfWeek: ids.map(Number) })}
        />
      ) : null}
      {schedule?.mode === "interval_days" ? (
        <View style={styles.reminderScheduleField}>
          <Text style={[styles.help, { color: colors.muted }]}>
            Days between reminders
          </Text>
          <TextInput
            value={String(schedule.intervalDays ?? 7)}
            onChangeText={(value) =>
              replace({
                intervalDays: Math.max(1, Math.round(Number(value) || 1)),
              })
            }
            keyboardType="number-pad"
            style={[
              styles.reminderScheduleInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        </View>
      ) : null}
      {schedule?.mode === "days_of_month" ? (
        <View style={styles.reminderScheduleField}>
          <Text style={[styles.help, { color: colors.muted }]}>
            Dates each month
          </Text>
          <TextInput
            value={(schedule.daysOfMonth ?? []).join(", ")}
            onChangeText={(value) =>
              replace({
                daysOfMonth: [
                  ...new Set(
                    value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter(
                        (day) =>
                          Number.isInteger(day) && day >= 1 && day <= 31,
                      ),
                  ),
                ],
              })
            }
            keyboardType="numbers-and-punctuation"
            style={[
              styles.reminderScheduleInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
        </View>
      ) : null}
      {schedule && schedule.mode !== "once" ? (
        <>
          <Pressable
            onPress={() =>
              schedule.endDate
                ? replace({ endDate: undefined })
                : replace({ endDate: anchorDate })
            }
            style={[styles.reminderFrequency, { borderColor: colors.border }]}
          >
            <Ionicons name="calendar-outline" size={14} color={accent} />
            <Text style={[styles.help, { color: colors.ink }]}>Schedule end date</Text>
            <Ionicons name={schedule.endDate ? "checkbox" : "square-outline"} size={17} color={schedule.endDate ? accent : colors.faint} />
          </Pressable>
          {schedule.endDate ? (
            <>
              <Pressable
                onPress={() => setEndCalendarOpen((open) => !open)}
                style={[styles.goalDate, { borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={15} color={accent} />
                <Text style={[styles.goalDateText, { color: colors.ink }]}>{schedule.endDate}</Text>
                <Ionicons name={endCalendarOpen ? "chevron-up" : "chevron-down"} size={15} color={colors.muted} />
              </Pressable>
              {endCalendarOpen ? (
                <MonthCalendar
                  monthDate={schedule.endDate}
                  selectedDate={schedule.endDate}
                  onSelect={(next) => {
                    replace({ endDate: next });
                    setEndCalendarOpen(false);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function ChoicePicker<T extends string>({
  label,
  value,
  open,
  setOpen,
  options,
  onChange,
  colors,
  accent,
  help,
}: {
  label: string;
  value: T;
  open: boolean;
  setOpen: (open: boolean) => void;
  options: {
    id: T;
    label: string;
    icon?: keyof typeof Ionicons.glyphMap;
  }[];
  onChange: (value: T) => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
  help?: string;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? options[0];
  const helper =
    help ??
    ({
      Type: "Groups related trackers together without changing how values are calculated.",
      "Entry type": "Choose whether entries are numbers, check-offs, notes, photos, or calculated values.",
      "Multiple entries": "Choose how several entries on the same day combine into one daily result.",
      Competition: "Controls how members are ordered on this group's leaderboard.",
      Success: "Defines when this target counts as completed.",
      Visibility: "Controls what group members can see.",
      "Default visibility": "New members inherit this choice but may make their own data more private.",
      "Progress bar": "Daily evaluates each day. Journey shows progress from the starting measurement to a long-term target.",
    } as Record<string, string>)[label];
  return (
    <View style={[styles.choicePicker, { borderColor: colors.border }]}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={styles.choicePickerHeading}
      >
        {selected?.icon ? (
          <Ionicons name={selected.icon} size={17} color={accent} />
        ) : null}
        <View style={styles.grow}>
          <Text style={[styles.choicePickerLabel, { color: colors.muted }]}>
            {label}{" "}
            {helper ? (
              <Text
                onPress={(event) => {
                  event.stopPropagation();
                  setHelpOpen((current) => !current);
                }}
                style={{ color: accent }}
              >
                ⓘ
              </Text>
            ) : null}
          </Text>
          <Text style={[styles.rowTitle, { color: colors.ink }]}>
            {selected?.label ?? "Choose"}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={17}
          color={colors.faint}
        />
      </Pressable>
      {helpOpen && helper ? (
        <View
          style={[
            styles.choiceHelp,
            { backgroundColor: colors.primarySoft, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.choiceHelpText, { color: colors.ink }]}>
            {helper}
          </Text>
        </View>
      ) : null}
      {open ? (
        <View style={[styles.choicePickerList, { borderTopColor: colors.border }]}>
          {options.map((option) => {
            const active = option.id === value;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                style={[
                  styles.choicePickerOption,
                  active && { backgroundColor: colors.primarySoft },
                ]}
              >
                {option.icon ? (
                  <Ionicons
                    name={option.icon}
                    size={16}
                    color={active ? accent : colors.muted}
                  />
                ) : null}
                <Text
                  style={[
                    styles.choicePickerText,
                    { color: active ? accent : colors.ink },
                  ]}
                >
                  {option.label}
                </Text>
                {active ? (
                  <Ionicons name="checkmark" size={16} color={accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function VisualChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const colors = useAppColors();
  return (
    <View>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={styles.wrap}>
        {options.map(([id, option]) => (
          <Chip
            key={id}
            label={option}
            selected={value === id}
            onPress={() => onChange(id)}
          />
        ))}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  set,
  colors,
  keyboard = true,
  info,
  example,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  colors: ReturnType<typeof useAppColors>;
  keyboard?: boolean;
  info?: string;
  example?: string;
}) {
  return (
    <View style={styles.grow}>
      <View style={styles.labelLine}>
        <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
        {info ? <InfoPopover label={`About ${label}`} message={info} /> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType={keyboard ? "decimal-pad" : "default"}
        style={[
          styles.input,
          { color: colors.ink, borderColor: colors.border },
        ]}
      />
      {example ? (
        <Text style={[styles.fieldExample, { color: colors.muted }]}>
          {example}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "900", marginTop: 8, marginBottom: 7 },
  fieldGroup: { gap: 6 },
  labelLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldExample: { fontSize: 8, lineHeight: 12, marginTop: -4, marginBottom: 8 },
  inlineChoices: { gap: 5, paddingRight: 8 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    fontSize: 13,
    marginBottom: 9,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 8 },
  columns: { flexDirection: "row", gap: 9 },
  twoFields: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  inlineFields: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  compactInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 11,
    fontWeight: "800",
  },
  fastingSummary: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  fastingSummaryLabel: { fontSize: 8, fontWeight: "800" },
  fastingSummaryValue: { fontSize: 11, fontWeight: "900", marginTop: 2 },
  shortField: { width: 92 },
  submetricList: { borderTopWidth: 1, paddingTop: 10, gap: 9 },
  submetricCard: { borderWidth: 1, borderRadius: 14, padding: 10 },
  submetricHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  submetricTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  reminderBlock: { gap: 6, marginBottom: 7 },
  reminderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reminderFrequency: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
  },
  reminderSchedule: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 7,
    gap: 7,
  },
  reminderScheduleField: { gap: 4 },
  reminderScheduleInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 10,
    fontWeight: "800",
  },
  linkedReminders: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 8,
    gap: 4,
  },
  linkedReminderRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  linkedReminderText: { flex: 1, fontSize: 8, fontWeight: "800" },
  addReminder: {
    minHeight: 36,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginBottom: 6,
  },
  progressReminderPanel: { borderTopWidth: 1, paddingTop: 8, gap: 7 },
  progressReminderCustom: { flexDirection: "row", alignItems: "center", gap: 6 },
  grow: { flex: 1 },
  bulkPresetIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  bulkPresetIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkPresetList: { gap: 6, marginTop: 12 },
  bulkPresetRow: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bulkPresetName: { flex: 1, fontSize: 10, fontWeight: "800" },
  choicePicker: {
    borderWidth: 1,
    borderRadius: 13,
    overflow: "hidden",
    marginBottom: 8,
  },
  choicePickerHeading: {
    minHeight: 49,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  choicePickerLabel: { fontSize: 11, fontWeight: "900", marginBottom: 3 },
  choiceHelp: {
    marginHorizontal: 8,
    marginBottom: 7,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 9,
  },
  choiceHelpText: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
  choicePickerList: { borderTopWidth: 1, padding: 5 },
  choicePickerOption: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  choicePickerText: { flex: 1, fontSize: 9, fontWeight: "800" },
  switchRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },
  goalStart: { marginTop: 8 },
  goalStartHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  todayButton: {
    minHeight: 30,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  todayText: { fontSize: 9, fontWeight: "900" },
  goalDate: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  goalDateText: { flex: 1, fontSize: 11, fontWeight: "900" },
  goalCalendar: { borderTopWidth: 1, marginTop: 9, paddingTop: 9 },
  rowTitle: { fontSize: 12, fontWeight: "900" },
  help: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  collapseHeading: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  collapsibleGroup: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 4,
  },
  advancedButton: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 10,
  },
  advancedPanel: { gap: 0 },
  advancedSection: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 6,
  },
  formula: { minHeight: 76, textAlignVertical: "top" },
  mini: { fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginBottom: 7 },
  validation: {
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 7,
  },
  iconChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  choiceRow: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 9,
  },
  colorDot: { width: 34, height: 34, borderRadius: 12 },
  colorPanel: { marginBottom: 10, gap: 9 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  swatch: {
    width: 33,
    height: 33,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  customColor: { flexDirection: "row", gap: 8 },
  colorInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    fontSize: 11,
    fontWeight: "800",
  },
  colorApply: {
    width: 76,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  colorApplyText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  icons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 9,
    marginBottom: 14,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 12,
    marginBottom: 16,
  },
  delete: { width: 96 },
  visualChoices: { borderTopWidth: 1, borderTopColor: "transparent" },
});
