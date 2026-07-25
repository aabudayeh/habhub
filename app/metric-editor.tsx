import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  isAllowedTrackerColor,
  isReservedGoalColor,
  normalizeHexColor,
  TRACKER_COLOR_CHOICES,
} from "@/src/domain/colors";
import { energyFormulaVariables } from "@/src/domain/energy";
import { dateKey } from "@/src/domain/date";
import { MUSCLE_LABELS } from "@/src/domain/exerciseCatalog";
import { evaluateFormula, formulaIdentifiers } from "@/src/domain/formula";
import { defaultReminderTimes } from "@/src/domain/reminders";
import { trackerPresets, TrackerPreset } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  Aggregation,
  GoalKind,
  HealthDataType,
  HealthMetricField,
  MetricDataType,
  MetricDefinition,
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
  { id: "gym", label: "Gym", icon: "barbell-outline" },
  { id: "mind", label: "Mind", icon: "book-outline" },
  { id: "photos", label: "Photos", icon: "camera-outline" },
  { id: "other", label: "Other", icon: "apps-outline" },
];
const SOURCES: {
  id: HealthDataType;
  label: string;
  fields: { id: HealthMetricField; label: string }[];
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
    updateMetric,
    deleteMetric,
    addGroupMetric,
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
  const trackerPeriods = tracker
    ? state.trackedGoalPeriods[tracker.id]
    : undefined;
  const colors = useAppColors();
  const accent = useGroupAccent();
  const presets = trackerPresets(state).filter(
    (preset) =>
      !sourceMetrics.some((item) => item.id === preset.templateId) &&
      (preset.category !== "gym" || state.settings.showGym),
  );
  const [presetId, setPresetId] = useState("");
  const [name, setName] = useState(tracker?.name ?? "");
  const [color, setColor] = useState(
    isAllowedTrackerColor(tracker?.color ?? accent)
      ? (tracker?.color ?? accent)
      : TRACKER_COLOR_CHOICES[0],
  );
  const [category, setCategory] = useState<TrackerCategory>(
    tracker?.category ?? "other",
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
  const [healthOpen, setHealthOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(
    focus === "notifications",
  );
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToGoalStart = useRef(false);
  const scrolledToNotifications = useRef(false);
  const behaviorSectionY = useRef(0);
  const [showIcons, setShowIcons] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [customColor, setCustomColor] = useState(color);
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
  const [validation, setValidation] = useState<string | null>(null);
  const draftSignature = JSON.stringify({
    presetId,
    name,
    color,
    category,
    unit,
    dataType,
    goalEnabled,
    goalKind,
    goal,
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
    activeFrom,
    trackGoal,
    scheduleMode,
    minimumCompletions,
    intervalDays,
    daysOfMonth,
    selectedDays,
    reminderEnabled,
    reminderTimes,
  });
  const initialDraftSignature = useRef(draftSignature);
  const dirtyRef = useRef(false);
  const allowExit = useRef(false);
  const requestCloseRef = useRef<(exit?: () => void) => void>(
    () => undefined,
  );
  dirtyRef.current = draftSignature !== initialDraftSignature.current;
  const source = SOURCES.find((item) => item.id === healthType);
  function applyPreset(preset: TrackerPreset) {
    setPresetId(preset.templateId);
    setName(preset.name);
    setColor(preset.color);
    setCategory(preset.category ?? "other");
    setUnit(preset.unit);
    setDataType(preset.dataType);
    setGoalEnabled(preset.goalEnabled !== false);
    setGoalKind(preset.goal.kind);
    setGoal(String(preset.goal.target));
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
    setActiveFrom(dateKey());
    setTrackGoal(false);
    setGoalCalendarOpen(false);
    setReminderTimes(
      preset.reminders?.map((item) => item.time) ??
        defaultReminderTimes({ id: preset.templateId, category: preset.category }),
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
  function save(onSaved: () => void = () => router.back()) {
    const target = Number(goal.replace(",", "."));
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
      goalEnabled,
      goalRange:
        (presetId || tracker?.id) === "blood_pressure_systolic"
          ? { min: systolicMinimum, max: target }
          : rangeGoal && rangeMin && rangeMax
          ? { min: Number(rangeMin), max: Number(rangeMax) }
          : undefined,
      category,
      healthMapping: healthType
        ? { dataType: healthType, field: healthField }
        : undefined,
      gymMapping,
      gymMuscleGroups: category === "gym" ? gymMuscles : undefined,
      stepFallback,
      manualEntry:
        healthType === "steps" || tracker?.id === "steps" ? false : manualEntry,
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
      reminders: reminderTimes.map((time) => ({
        enabled: reminderEnabled,
        time,
      })),
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
      if (tracker) updateGroupMetric(tracker.id, definition);
      else addGroupMetric(definition);
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
  return (
    <Screen
      scrollRef={scrollRef}
      keyboardShouldPersistTaps="handled"
    >
      <PageHeader
        eyebrow={groupScope ? state.group.name : "Personal setup"}
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
            group: preset.category === "gym" ? "Gym" : "Ready-made",
          }))}
          selectedIds={presetId ? [presetId] : []}
          onChange={(ids) => {
            const preset = presets.find((item) => item.templateId === ids[0]);
            if (preset) applyPreset(preset);
          }}
          multiple={false}
          collapsibleGroups={state.settings.showGym ? ["Gym"] : []}
          emptyLabel="Or create your own below"
        />
      ) : null}
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
            <View style={styles.swatches}>
              {TRACKER_COLOR_CHOICES.map((item) => (
                <Pressable
                  key={item}
                  accessibilityLabel={`Choose tracker color ${item}`}
                  onPress={() => {
                    setColor(item);
                    setCustomColor(item);
                  }}
                  style={[
                    styles.swatch,
                    { backgroundColor: item },
                    color === item && { borderColor: colors.ink },
                  ]}
                >
                  {color === item ? (
                    <Ionicons
                      name="checkmark"
                      size={15}
                      color={palette.white}
                    />
                  ) : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.customColor}>
              <TextInput
                value={customColor}
                onChangeText={setCustomColor}
                autoCapitalize="characters"
                maxLength={7}
                placeholder="#2F6FED"
                placeholderTextColor={colors.faint}
                style={[
                  styles.colorInput,
                  { color: colors.ink, borderColor: colors.border },
                ]}
              />
              <Pressable
                disabled={!isAllowedTrackerColor(customColor)}
                onPress={() => {
                  const next = normalizeHexColor(customColor);
                  if (next) setColor(next);
                }}
                style={[
                  styles.colorApply,
                  {
                    backgroundColor: isAllowedTrackerColor(customColor)
                      ? (normalizeHexColor(customColor) ?? accent)
                      : colors.border,
                  },
                ]}
              >
                <Text style={styles.colorApplyText}>Apply</Text>
              </Pressable>
            </View>
            {isReservedGoalColor(customColor) ? (
              <Text style={[styles.help, { color: palette.amber }]}>
                That color is reserved for goal completion.
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.wrap}>
          {CATEGORIES.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              icon={item.icon}
              selected={category === item.id}
              onPress={() => setCategory(item.id)}
            />
          ))}
        </View>
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
            Gym picker. Rankings use estimated one-rep max; raw sets and notes
            stay controlled by each workout&apos;s visibility.
          </Text>
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
        {goalEnabled && dataType !== "text" ? (
          <>
            {(presetId || tracker?.id) === "blood_pressure_systolic" ? (
              <Text style={[styles.help, { color: colors.muted }]}>
                Both readings must be inside their preferred ranges. The adult defaults are 90–120 systolic and 60–80 diastolic; personalize these with a clinician when appropriate.
              </Text>
            ) : (
            <>
              <Text style={[styles.label, { color: colors.ink }]}>Success means</Text>
              <View style={styles.wrap}>
              <Chip
                label="At least"
                selected={goalKind === "at_least"}
                onPress={() => {
                  setGoalKind("at_least");
                  setRangeGoal(false);
                  setRangeMin("");
                  setRangeMax("");
                }}
              />
              <Chip
                label="No more than"
                selected={goalKind === "at_most"}
                onPress={() => {
                  setGoalKind("at_most");
                  setRangeGoal(false);
                  setRangeMin("");
                  setRangeMax("");
                }}
              />
              <Chip
                label="Near target"
                selected={goalKind === "exact" && !rangeGoal}
                onPress={() => {
                  setGoalKind("exact");
                  setRangeGoal(false);
                  setRangeMin("");
                  setRangeMax("");
                }}
              />
              <Chip
                label="Inside a range"
                selected={rangeGoal}
                onPress={() => {
                  setGoalKind("exact");
                  setRangeGoal(true);
                  setRangeMin(rangeMin || "60");
                  setRangeMax(rangeMax || "100");
                }}
              />
              </View>
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
                  label="Target"
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
          </>
        ) : null}
        <Text style={[styles.label, { color: colors.ink }]}>
          Who can see new entries?
        </Text>
        <View style={styles.wrap}>
          <Chip
            label="My group"
            icon="people-outline"
            selected={visibility === "group"}
            onPress={() => setVisibility("group")}
          />
          <Chip
            label="Goal status only"
            icon="checkmark-circle-outline"
            selected={visibility === "status"}
            onPress={() => setVisibility("status")}
          />
          <Chip
            label="Only me"
            icon="lock-closed-outline"
            selected={visibility === "private"}
            onPress={() => setVisibility("private")}
          />
        </View>
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
        <>
          <Card>
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
                    ? "This standardized tracker is calculated from Gym sessions. Raw sets and notes remain private."
                    : "Link this tracker to compatible data from Apple Health or Health Connect."}
                </Text>
                <View style={styles.wrap}>
              <Chip
                label="No connection"
                selected={!healthType}
                onPress={() => setHealthType("")}
              />
              {SOURCES.map((item) => (
                <Chip
                  key={item.id}
                  label={item.label}
                  selected={healthType === item.id}
                  onPress={() => {
                    setHealthType(item.id);
                    setHealthField(item.fields[0].id);
                    if (item.id === "steps") setManualEntry(false);
                  }}
                />
              ))}
                </View>
            {source ? (
              <>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Use this value
                </Text>
                <View style={styles.wrap}>
                  {source.fields.map((field) => (
                    <Chip
                      key={field.id}
                      label={field.label}
                      selected={healthField === field.id}
                      onPress={() => setHealthField(field.id)}
                    />
                  ))}
                </View>
              </>
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
                  tracker?.id === "steps"
                    ? false
                    : manualEntry
                }
                disabled={
                  Boolean(gymMapping) ||
                  healthType === "steps" ||
                  tracker?.id === "steps"
                }
                onValueChange={setManualEntry}
              />
            </View>
              </>
            ) : null}
          </Card>
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
          <Card>
            <SectionHeader title="How it behaves" />
            {!groupScope && goalEnabled && dataType !== "text" ? (
              <>
              <View
                style={[styles.switchRow, { borderColor: colors.border }]}
              >
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.ink }]}>
                    Count in tracked goals
                  </Text>
                  <Text style={[styles.help, { color: colors.muted }]}>
                    Include this goal in daily completion from the chosen
                    start date.
                  </Text>
                </View>
                <Switch value={trackGoal} onValueChange={setTrackGoal} />
              </View>
              <View
                style={[styles.switchRow, { borderColor: colors.border }]}
              >
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
            {goalEnabled && dataType !== "text" ? (
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
                        ).toLocaleDateString(undefined, {
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
            <View
              onLayout={(event) => {
                if (
                  focus !== "notifications" ||
                  scrolledToNotifications.current
                )
                  return;
                scrolledToNotifications.current = true;
                const y =
                  behaviorSectionY.current + event.nativeEvent.layout.y;
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
                      {reminderEnabled
                        ? `${reminderTimes.length} reminder${reminderTimes.length === 1 ? "" : "s"} enabled`
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
                      <View key={index} style={styles.reminderRow}>
                        <View style={styles.grow}>
                          <Field
                            label={`Time ${index + 1}`}
                            value={time}
                            set={(value) =>
                              setReminderTimes((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? value : item,
                                ),
                              )
                            }
                            colors={colors}
                            keyboard={false}
                          />
                        </View>
                        {reminderTimes.length > 1 ? (
                          <IconButton
                            icon="trash-outline"
                            label="Remove reminder"
                            onPress={() =>
                              setReminderTimes((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          />
                        ) : null}
                      </View>
                    ))}
                    <Pressable
                      onPress={() =>
                        setReminderTimes((current) => [...current, "19:00"])
                      }
                      style={[styles.addReminder, { borderColor: accent }]}
                    >
                      <Ionicons name="add" size={16} color={accent} />
                      <Text style={[styles.help, { color: accent }]}>
                        Add time
                      </Text>
                    </Pressable>
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
                    <View style={styles.wrap}>
                      {(
                        [
                          ["daily", "Every day"],
                          ["selected_days", "Selected weekdays"],
                          ["every_other_day", "Every other day"],
                          ["interval_days", "Custom interval"],
                          ["days_of_month", "Dates each month"],
                          ["weekly_min", "Minimum per week"],
                          ["monthly_min", "Minimum per month"],
                        ] as const
                      ).map(([value, label]) => (
                        <Chip
                          key={value}
                          label={label}
                          selected={scheduleMode === value}
                          onPress={() => setScheduleMode(value)}
                        />
                      ))}
                    </View>
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
            </View>
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
            {dataType === "calculated" ? (
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
                      (item) =>
                        item.id !== tracker?.id && item.dataType !== "text",
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
            ) : null}
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
            <Pressable
              onPress={() => setShowIcons((value) => !value)}
              style={styles.iconChoice}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: `${color}18` },
                ]}
              >
                <Ionicons
                  name={icon as keyof typeof Ionicons.glyphMap}
                  size={20}
                  color={color}
                />
              </View>
              <Text style={[styles.rowTitle, { color: colors.ink }]}>
                Change icon
              </Text>
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
          </Card>
          </View>
        </>
      ) : null}
      <View style={styles.actions}>
        {tracker ? (
          <View style={styles.delete}>
            <Button label="Delete" variant="danger" onPress={remove} />
          </View>
        ) : null}
        <View style={styles.grow}>
          <Button
            label={
              tracker ? "Save" : groupScope ? "Add to group" : "Add tracker"
            }
            icon="checkmark"
            onPress={() => save()}
          />
        </View>
      </View>
    </Screen>
  );
}
function Field({
  label,
  value,
  set,
  colors,
  keyboard = true,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  colors: ReturnType<typeof useAppColors>;
  keyboard?: boolean;
}) {
  return (
    <View style={styles.grow}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType={keyboard ? "decimal-pad" : "default"}
        style={[
          styles.input,
          { color: colors.ink, borderColor: colors.border },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "900", marginTop: 8, marginBottom: 7 },
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
  reminderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  grow: { flex: 1 },
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
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 9 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: 9, marginBottom: 16 },
  delete: { width: 96 },
});
