import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthProvider";
import { Button, Chip, ProgressBar, useKeyboardReveal } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { ACTIVITY_LABELS } from "@/src/domain/energy";
import { trackerPresets, TrackerPreset } from "@/src/domain/trackerCatalog";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import { enablePushNotifications } from "@/src/notifications/push";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  ActivityLevel,
  AppState,
  BiologicalSex,
  LandingPage,
  MetricDefinition,
  WeightDirection,
} from "@/src/types";

const GOALS = [
  {
    id: "weight",
    title: "Manage my weight",
    copy: "Lose, maintain, or gain with a sensible energy plan.",
    icon: "scale-outline" as const,
  },
  {
    id: "activity",
    title: "Move more",
    copy: "Steps, workouts, or any activity you care about.",
    icon: "walk-outline" as const,
  },
  {
    id: "gym",
    title: "Track gym progress",
    copy: "Programs, sets, reps, strength, rest, and workout history.",
    icon: "barbell-outline" as const,
  },
  {
    id: "learning",
    title: "Learn consistently",
    copy: "Reading, studying, practice, or focused time.",
    icon: "book-outline" as const,
  },
  {
    id: "health",
    title: "Follow my health",
    copy: "Sleep, cycle, glucose, blood pressure, and more.",
    icon: "heart-outline" as const,
  },
  {
    id: "nutrition",
    title: "Eat healthier",
    copy: "Calories, meals, water, and useful nutrients.",
    icon: "restaurant-outline" as const,
  },
  {
    id: "friends",
    title: "Do it with friends",
    copy: "Private groups, friendly rankings, and chat.",
    icon: "people-outline" as const,
  },
];
const HEALTH = [
  { id: "sleep", label: "Sleep", metrics: ["sleep"] },
  {
    id: "blood_pressure",
    label: "Blood pressure & pulse",
    metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "pulse"],
  },
  { id: "blood_glucose", label: "Blood glucose", metrics: ["blood_glucose"] },
  { id: "menstrual_cycle", label: "Cycle", metrics: ["menstrual_cycle"] },
  { id: "pulse", label: "Pulse", metrics: ["pulse"] },
  {
    id: "body_composition",
    label: "Body composition",
    metrics: ["body_fat", "lean_body_mass"],
  },
] as const;
const GROUP_LABELS: Record<string, string> = {
  energy: "Weight & energy",
  activity: "Movement",
  nutrition: "Food & hydration",
  health: "Health readings",
  mind: "Learning",
  gym: "Gym",
  other: "Other",
};
const NOT_GOALS = new Set([
  "weight",
  "weekly_deficit_balance",
  "overall_score",
  "progress_photo",
  "pulse",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "body_fat",
  "lean_body_mass",
]);

export default function Onboarding() {
  const {
    state,
    updateSettings,
    updateEnergyProfile,
    configurePersonalMetrics,
    updateMemberName,
  } = useApp();
  const auth = useAuth();
  const health = useHealthSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [step, setStep] = useState(0);
  // Every unfinished account chooses its own name. Prefilling from the initial
  // demo snapshot could briefly show "Ahmad" before cloud account binding.
  const [displayName, setDisplayName] = useState("");
  const [goals, setGoals] = useState<string[]>(
    state.settings.selectedGoals ?? [],
  );
  const [healthChoices, setHealthChoices] = useState<string[]>(["sleep"]);
  const [direction, setDirection] = useState<WeightDirection>(
    state.settings.weightDirection ?? "lose",
  );
  const profile = state.settings.energyProfile;
  const [age, setAge] = useState(String(profile.age));
  const [height, setHeight] = useState(String(profile.heightCm));
  const [weight, setWeight] = useState(String(profile.weightKg));
  const [target, setTarget] = useState(String(profile.targetWeightKg));
  const [weeklyChange, setWeeklyChange] = useState(
    String(profile.desiredWeeklyLossKg || 0.5),
  );
  const [sex, setSex] = useState<BiologicalSex>(profile.sex);
  const [activity, setActivity] = useState<ActivityLevel>(
    profile.activityLevel,
  );
  const [pushReady, setPushReady] = useState(false);
  const [healthReady, setHealthReady] = useState(
    state.settings.healthSync.enabled,
  );
  const [advancedTutorial, setAdvancedTutorial] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [trackedSelected, setTrackedSelected] = useState<string[]>([]);
  const [customPresets, setCustomPresets] = useState<TrackerPreset[]>([]);
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [customGoal, setCustomGoal] = useState("1");
  const [customDataType, setCustomDataType] = useState<"number" | "boolean">(
    "number",
  );
  const [customTrackerOpen, setCustomTrackerOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [landingPage, setLandingPage] = useState<LandingPage>(
    (state.settings.selectedGoals ?? []).includes("friends")
      ? "group"
      : "index",
  );
  const initialized = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  useKeyboardReveal(scrollRef);
  const nextProfile = useMemo(
    () => ({
      ...profile,
      age: Number(age) || profile.age,
      heightCm: Number(height) || profile.heightCm,
      startingWeightKg:
        profile.startingWeightKg ?? (Number(weight) || profile.weightKg),
      weightKg: Number(weight) || profile.weightKg,
      targetWeightKg: Number(target) || profile.targetWeightKg,
      desiredWeeklyLossKg:
        direction === "maintain"
          ? 0
          : Math.max(0.1, Number(weeklyChange) || profile.desiredWeeklyLossKg),
      sex,
      activityLevel: activity,
    }),
    [profile, age, height, weight, target, weeklyChange, direction, sex, activity],
  );
  const desired = useMemo(() => {
    const ids = new Set<string>();
    if (goals.includes("weight"))
      [
        "weight",
        "food",
        "exercise",
        "deficit",
        "weekly_deficit_balance",
      ].forEach((id) => ids.add(id));
    if (goals.includes("activity"))
      [
        "steps",
        "exercise",
        "workout",
        "workout_duration",
        "workout_distance",
      ].forEach((id) => ids.add(id));
    if (goals.includes("gym"))
      [
        "exercise",
        "gym_completed",
        "gym_duration",
        "gym_total_volume",
      ].forEach((id) => ids.add(id));
    if (goals.includes("nutrition"))
      ["food", "water"].forEach((id) => ids.add(id));
    if (goals.includes("health"))
      HEALTH.filter((choice) => healthChoices.includes(choice.id)).forEach(
        (choice) => choice.metrics.forEach((id) => ids.add(id)),
      );
    if (goals.includes("learning")) ids.add("reading");
    return ids;
  }, [goals, healthChoices]);
  const proposed = useMemo(() => {
    const adjusted = {
      ...state,
      settings: {
        ...state.settings,
        energyProfile: nextProfile,
        weightDirection: direction,
      },
    } as AppState;
    const presets = trackerPresets(adjusted).filter((item) =>
      desired.has(item.templateId),
    );
    const reading: TrackerPreset[] = desired.has("reading")
      ? [
          {
            templateId: "reading",
            name: "Reading",
            icon: "book-outline",
            color: "#5969B0",
            unit: "min",
            dataType: "number",
            aggregation: "sum",
            goal: { kind: "at_least", target: 30 },
            goalEnabled: true,
            category: "mind",
            manualEntry: true,
            rankingDirection: "higher",
            defaultVisibility: "group",
            description: "A simple daily reading or study-time goal.",
          },
        ]
      : [];
    return [...presets, ...reading, ...customPresets];
  }, [state, desired, direction, nextProfile, customPresets]);
  const grouped = useMemo(
    () =>
      Object.entries(
        proposed
          .filter(
            (item) =>
              !healthChoices.includes("blood_pressure") ||
              !["blood_pressure_diastolic", "pulse"].includes(item.templateId),
          )
          .reduce<Record<string, typeof proposed>>((all, item) => {
          const key = item.category ?? "other";
          (all[key] ??= []).push(item);
          return all;
          }, {}),
      ),
    [healthChoices, proposed],
  );
  const targetIsValid =
    direction === "maintain" ||
    (direction === "lose" && nextProfile.targetWeightKg < nextProfile.weightKg) ||
    (direction === "gain" && nextProfile.targetWeightKg > nextProfile.weightKg);
  useEffect(() => {
    if (step === 2 && !initialized.current) {
      initialized.current = true;
      setSelected(proposed.map((item) => item.templateId));
      setTrackedSelected(
        proposed
          .filter(
            (item) =>
              item.goalEnabled !== false && !NOT_GOALS.has(item.templateId),
          )
          .map((item) => item.templateId),
      );
    }
  }, [step, proposed]);
  useEffect(() => {
    if (step === 1 && goals.includes("friends")) setLandingPage("group");
  }, [step, goals]);
  function toggle(id: string, setter = setGoals, current = goals) {
    setter(
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }
  function metricDefinitions(): MetricDefinition[] {
    const today = dateKey();
    return proposed
      .filter((item) => selected.includes(item.templateId))
      .map((item, order) => ({
        id: item.templateId,
        slug: item.templateId,
        name: item.name,
        icon: item.icon,
        color: item.color,
        unit: item.unit,
        dataType: item.dataType,
        aggregation: item.aggregation,
        goal: { ...item.goal },
        goalEnabled: item.goalEnabled,
        goalRange: item.goalRange,
        category: item.category,
        healthMapping: item.healthMapping,
        gymMapping: item.gymMapping,
        gymMuscleGroups: item.gymMuscleGroups,
        stepFallback: item.stepFallback,
        manualEntry: item.manualEntry,
        reminders: item.reminders,
        rankingDirection: item.rankingDirection,
        defaultVisibility: item.defaultVisibility,
        formula: item.formula,
        formulaVersion: 1,
        scoreWeight: 0,
        sections: { today: true, insights: true, group: false },
        order,
        activeFrom: today,
      }));
  }
  function configure() {
    const metrics = metricDefinitions();
    configurePersonalMetrics(
      metrics,
      metrics
        .filter((item) => trackedSelected.includes(item.id))
        .map((item) => item.id),
    );
    updateSettings({
      selectedGoals: goals,
      weightDirection: direction,
      showLeaderboard: goals.includes("friends"),
      showChat: goals.includes("friends"),
      showGym: goals.includes("gym"),
      defaultLandingPage: landingPage,
    });
    updateEnergyProfile(nextProfile);
  }
  async function enablePush() {
    try {
      if (auth.user)
        await enablePushNotifications(auth.user.id, {
          ...state.settings.notifications,
          pushEnabled: true,
        });
      updateSettings({
        notifications: { ...state.settings.notifications, pushEnabled: true },
      });
      setPushReady(true);
    } catch (error) {
      Alert.alert(
        "Notifications not enabled",
        error instanceof Error ? error.message : "You can enable them later.",
      );
    }
  }
  async function enableHealth() {
    try {
      await health.connect();
      setHealthReady(true);
    } catch (error) {
      Alert.alert(
        "Health connection not completed",
        error instanceof Error ? error.message : "You can connect later.",
      );
    }
  }
  async function saveDisplayName() {
    const name = displayName.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return;
    updateMemberName(state.currentUserId, name);
    if (auth.status === "signedIn")
      await auth.updateDisplayName(name).catch(() => undefined);
  }
  async function finish() {
    await saveDisplayName();
    updateSettings({
      onboardingComplete: true,
      tutorialComplete: true,
      advancedTutorialComplete: advancedTutorial,
      defaultLandingPage: landingPage,
    });
    requestAnimationFrame(() =>
      router.replace(
        (landingPage === "index" ? "/" : `/${landingPage}`) as never,
      ),
    );
  }
  function toggleTracker(id: string) {
    if (selected.includes(id)) {
      setSelected((current) => current.filter((item) => item !== id));
      setTrackedSelected((current) =>
        current.filter((item) => item !== id),
      );
    } else setSelected((current) => [...current, id]);
  }
  function addCustomTracker() {
    const name = customName.trim();
    const target = customDataType === "boolean" ? 1 : Number(customGoal);
    if (
      !name ||
      (customDataType === "number" &&
        (!Number.isFinite(target) || target <= 0))
    ) {
      Alert.alert(
        "Finish the tracker",
        customDataType === "number"
          ? "Add a name and a goal above zero."
          : "Add a tracker name.",
      );
      return;
    }
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "custom";
    const templateId = `${base}_${Date.now().toString(36)}`;
    const preset: TrackerPreset = {
      templateId,
      name,
      icon: "sparkles-outline",
      color: "#7756D9",
      unit: customDataType === "number" ? customUnit.trim() : "",
      dataType: customDataType,
      aggregation: customDataType === "number" ? "sum" : "max",
      goal:
        customDataType === "number"
          ? { kind: "at_least", target }
          : { kind: "complete", target: 1 },
      goalEnabled: true,
      category: "other",
      manualEntry: true,
      rankingDirection: "higher",
      defaultVisibility: "group",
      description:
        customDataType === "number"
          ? `Personal daily target: ${target}${customUnit.trim() ? ` ${customUnit.trim()}` : ""}.`
          : "Mark Yes when this is complete for the day.",
    };
    setCustomPresets((current) => [...current, preset]);
    setSelected((current) => [...current, templateId]);
    setTrackedSelected((current) => [...current, templateId]);
    setExpanded((current) =>
      current.includes("other") ? current : [...current, "other"],
    );
    setCustomName("");
    setCustomUnit("");
    setCustomGoal("1");
    setCustomDataType("number");
  }
  async function continueFlow() {
    if (step === 0) await saveDisplayName();
    if (step === 2) configure();
    if (step === 4) await finish();
    else setStep((value) => value + 1);
  }
  async function skipSetup() {
    if (!displayName.trim()) {
      Alert.alert("Add your name", "Enter the name you want friends to see.");
      return;
    }
    await saveDisplayName();
    updateSettings({
      onboardingComplete: true,
      tutorialComplete: false,
    });
    requestAnimationFrame(() => router.replace("/(tabs)" as never));
  }
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.page}>
          <View style={styles.top}>
            <View style={[styles.mark, { backgroundColor: accent }]}>
              <Ionicons name="navigate" size={20} color={palette.white} />
            </View>
            <Text style={[styles.brand, { color: colors.ink }]}>METRICRALLY</Text>
            <Text style={[styles.step, { color: colors.muted }]}>
              {step + 1}/5
            </Text>
          </View>
          <ProgressBar progress={(step + 1) / 5} color={accent} />
          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {step === 0 ? (
              <>
                <Title
                  title="What would you like to change?"
                  copy="Choose only what matters now. MetricRally builds the rest for you."
                  colors={colors}
                />
                <View style={styles.nameField}>
                  <Text style={[styles.nameLabel, { color: colors.ink }]}>
                    What should we call you?
                  </Text>
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={40}
                    placeholder="Your name"
                    placeholderTextColor={colors.faint}
                    returnKeyType="done"
                    style={[
                      styles.input,
                      {
                        color: colors.ink,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                  />
                </View>
                <View style={styles.goalGrid}>
                  {GOALS.map((goal) => (
                    <Pressable
                      key={goal.id}
                      onPress={() => toggle(goal.id)}
                      style={[
                        styles.goal,
                        {
                          backgroundColor: colors.card,
                          borderColor: goals.includes(goal.id)
                            ? accent
                            : colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.goalIcon,
                          { backgroundColor: `${accent}18` },
                        ]}
                      >
                        <Ionicons name={goal.icon} size={21} color={accent} />
                      </View>
                      <View style={styles.grow}>
                        <Text style={[styles.goalTitle, { color: colors.ink }]}>
                          {goal.title}
                        </Text>
                        <Text
                          style={[styles.goalCopy, { color: colors.muted }]}
                        >
                          {goal.copy}
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          goals.includes(goal.id)
                            ? "checkmark-circle"
                            : "ellipse-outline"
                        }
                        size={21}
                        color={goals.includes(goal.id) ? accent : colors.faint}
                      />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <Title
                  title="A little about you"
                  copy="Used privately for relevant targets and estimates."
                  colors={colors}
                />
                {goals.includes("weight") ? (
                  <>
                    <Text style={[styles.label, { color: colors.ink }]}>
                      Direction
                    </Text>
                    <View style={styles.wrap}>
                      <Chip
                        label="Lose"
                        selected={direction === "lose"}
                        onPress={() => setDirection("lose")}
                      />
                      <Chip
                        label="Maintain"
                        selected={direction === "maintain"}
                        onPress={() => setDirection("maintain")}
                      />
                      <Chip
                        label="Gain"
                        selected={direction === "gain"}
                        onPress={() => setDirection("gain")}
                      />
                    </View>
                    <View style={styles.fields}>
                      <Field
                        label="Age"
                        value={age}
                        set={setAge}
                        colors={colors}
                      />
                      <Field
                        label="Height cm"
                        value={height}
                        set={setHeight}
                        colors={colors}
                      />
                    </View>
                    <View style={styles.fields}>
                      <Field
                        label="Current kg"
                        value={weight}
                        set={setWeight}
                        colors={colors}
                      />
                      <Field
                        label="Target kg"
                        value={target}
                        set={setTarget}
                        colors={colors}
                      />
                    </View>
                    <View style={styles.wrap}>
                      {(
                        ["female", "male", "unspecified"] as BiologicalSex[]
                      ).map((item) => (
                        <Chip
                          key={item}
                          label={
                            item === "unspecified"
                              ? "Prefer not to say"
                              : item[0].toUpperCase() + item.slice(1)
                          }
                          selected={sex === item}
                          onPress={() => setSex(item)}
                        />
                      ))}
                    </View>
                    <Text style={[styles.label, { color: colors.ink }]}>
                      Usual activity
                    </Text>
                    <View style={styles.wrap}>
                      {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map(
                        (item) => (
                          <Chip
                            key={item}
                            label={ACTIVITY_LABELS[item]}
                            selected={activity === item}
                            onPress={() => setActivity(item)}
                          />
                        ),
                      )}
                    </View>
                    {!targetIsValid ? (
                      <Text style={[styles.validation, { color: palette.red }]}>
                        {direction === "lose"
                          ? "Choose a target below your current weight."
                          : "Choose a target above your current weight."}
                      </Text>
                    ) : null}
                    {direction !== "maintain" ? (
                      <>
                        <Text style={[styles.label, { color: colors.ink }]}>
                          Desired {direction === "gain" ? "gain" : "loss"} per week
                        </Text>
                        <View style={styles.wrap}>
                          {[0.25, 0.5, 0.75, 1].map((rate) => (
                            <Chip
                              key={rate}
                              label={`${rate} kg`}
                              selected={Number(weeklyChange) === rate}
                              onPress={() => setWeeklyChange(String(rate))}
                            />
                          ))}
                        </View>
                      </>
                    ) : null}
                  </>
                ) : (
                  <Empty
                    copy="No body profile is needed for these goals."
                    colors={colors}
                    accent={accent}
                  />
                )}
              </>
            ) : null}
            {step === 2 ? (
              <>
                <Title
                  title="Your starting setup"
                  copy="Only checked items are added. Other ready-made options stay available under Add."
                  colors={colors}
                />
                {goals.includes("health") ? (
                  <>
                    <Text style={[styles.label, { color: colors.ink }]}>
                      Health readings
                    </Text>
                    <View style={styles.choiceList}>
                      {HEALTH.map((choice) => (
                        <Pressable
                          key={choice.id}
                          onPress={() =>
                            toggle(choice.id, setHealthChoices, healthChoices)
                          }
                          style={[
                            styles.choice,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.goalTitle, { color: colors.ink }]}
                          >
                            {choice.label}
                          </Text>
                          <Ionicons
                            name={
                              healthChoices.includes(choice.id)
                                ? "checkbox"
                                : "square-outline"
                            }
                            size={21}
                            color={
                              healthChoices.includes(choice.id) ? accent : colors.faint
                            }
                          />
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                <View style={styles.selectActions}>
                  <Pressable
                    onPress={() => {
                      setSelected(proposed.map((item) => item.templateId));
                      setTrackedSelected(
                        proposed
                          .filter(
                            (item) =>
                              item.goalEnabled !== false &&
                              !NOT_GOALS.has(item.templateId),
                          )
                          .map((item) => item.templateId),
                      );
                    }}
                  >
                    <Text style={[styles.action, { color: accent }]}>
                      Select all
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setSelected([]);
                      setTrackedSelected([]);
                    }}
                  >
                    <Text style={[styles.action, { color: accent }]}>
                      Deselect all
                    </Text>
                  </Pressable>
                </View>
                <View
                  style={[
                    styles.customTracker,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: customTrackerOpen }}
                    onPress={() => setCustomTrackerOpen((value) => !value)}
                    style={styles.customHeading}
                  >
                    <Ionicons name="sparkles-outline" size={18} color={accent} />
                    <View style={styles.grow}>
                      <Text style={[styles.goalTitle, { color: colors.ink }]}>
                        Add a custom tracker
                      </Text>
                      <Text style={[styles.goalCopy, { color: colors.muted }]}>
                        {customTrackerOpen
                          ? "Start simple here; icons, formulas, and schedules remain available in Advanced settings."
                          : "Optional · expand only if the ready-made trackers do not fit."}
                      </Text>
                    </View>
                    <Ionicons
                      name={customTrackerOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.faint}
                    />
                  </Pressable>
                  {customTrackerOpen ? (
                    <>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder="Tracker name"
                    placeholderTextColor={colors.faint}
                    style={[
                      styles.input,
                      {
                        color: colors.ink,
                        borderColor: colors.border,
                        backgroundColor: colors.canvas,
                      },
                    ]}
                  />
                  <View style={styles.customTypeChoices}>
                    <View style={styles.customTypeChoice}>
                      <Chip
                        label="A number"
                        icon="calculator-outline"
                        selected={customDataType === "number"}
                        onPress={() => setCustomDataType("number")}
                      />
                    </View>
                    <View style={styles.customTypeChoice}>
                      <Chip
                        label="Yes or no"
                        icon="checkmark-circle-outline"
                        selected={customDataType === "boolean"}
                        onPress={() => setCustomDataType("boolean")}
                      />
                    </View>
                  </View>
                  {customDataType === "number" ? (
                    <View style={styles.fields}>
                      <TextInput
                        value={customGoal}
                        onChangeText={setCustomGoal}
                        keyboardType="decimal-pad"
                        placeholder="Daily goal"
                        placeholderTextColor={colors.faint}
                        style={[
                          styles.input,
                          styles.customField,
                          {
                            color: colors.ink,
                            borderColor: colors.border,
                            backgroundColor: colors.canvas,
                          },
                        ]}
                      />
                      <TextInput
                        value={customUnit}
                        onChangeText={setCustomUnit}
                        placeholder="Unit (optional)"
                        placeholderTextColor={colors.faint}
                        style={[
                          styles.input,
                          styles.customField,
                          {
                            color: colors.ink,
                            borderColor: colors.border,
                            backgroundColor: colors.canvas,
                          },
                        ]}
                      />
                    </View>
                  ) : (
                    <Text style={[styles.goalCopy, { color: colors.muted }]}>
                      Mark Yes when you complete it for the day.
                    </Text>
                  )}
                  <Button
                    label="Add custom tracker"
                    icon="add-circle-outline"
                    size="small"
                    onPress={addCustomTracker}
                  />
                    </>
                  ) : null}
                </View>
                {grouped.map(([group, items]) => (
                  <View
                    key={group}
                    style={[
                      styles.group,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Pressable
                      onPress={() => toggle(group, setExpanded, expanded)}
                      style={styles.groupHead}
                    >
                      <Text style={[styles.goalTitle, { color: colors.ink }]}>
                        {GROUP_LABELS[group] ?? group}
                      </Text>
                      <Text style={[styles.count, { color: colors.muted }]}>
                        {
                          items.filter((item) =>
                            selected.includes(item.templateId),
                          ).length
                        }
                        /{items.length}
                      </Text>
                      <Ionicons
                        name={
                          expanded.includes(group)
                            ? "chevron-up"
                            : "chevron-down"
                        }
                        size={18}
                        color={colors.faint}
                      />
                    </Pressable>
                    {expanded.includes(group)
                      ? items.map((item) => (
                          <Pressable
                            key={item.templateId}
                            onPress={() => toggleTracker(item.templateId)}
                            style={[
                              styles.tracker,
                              { borderTopColor: colors.border },
                            ]}
                          >
                            <View
                              style={[
                                styles.tinyIcon,
                                { backgroundColor: `${item.color}18` },
                              ]}
                            >
                              <Ionicons
                                name={
                                  item.icon as keyof typeof Ionicons.glyphMap
                                }
                                size={17}
                                color={item.color}
                              />
                            </View>
                            <View style={styles.grow}>
                              <Text
                                style={[
                                  styles.goalTitle,
                                  { color: colors.ink },
                                ]}
                              >
                                {item.name}
                              </Text>
                              <Text
                                style={[
                                  styles.goalCopy,
                                  { color: colors.muted },
                                ]}
                              >
                                {item.description}
                              </Text>
                            </View>
                            {item.goalEnabled !== false &&
                            !NOT_GOALS.has(item.templateId) ? (
                              <Pressable
                                accessibilityLabel={
                                  trackedSelected.includes(item.templateId)
                                    ? "Remove from daily tracked goals"
                                    : "Count as a daily tracked goal"
                                }
                                onPress={(event) => {
                                  event.stopPropagation();
                                  if (!selected.includes(item.templateId))
                                    setSelected((current) => [
                                      ...current,
                                      item.templateId,
                                    ]);
                                  toggle(
                                    item.templateId,
                                    setTrackedSelected,
                                    trackedSelected,
                                  );
                                }}
                                style={[
                                  styles.goalFlag,
                                  {
                                    backgroundColor:
                                      trackedSelected.includes(item.templateId)
                                        ? colors.primarySoft
                                        : colors.canvas,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={
                                    trackedSelected.includes(item.templateId)
                                      ? "flag"
                                      : "flag-outline"
                                  }
                                  size={15}
                                  color={
                                    trackedSelected.includes(item.templateId)
                                      ? accent
                                      : colors.faint
                                  }
                                />
                              </Pressable>
                            ) : null}
                            <Ionicons
                              name={
                                selected.includes(item.templateId)
                                  ? "checkbox"
                                  : "square-outline"
                              }
                              size={21}
                              color={
                                selected.includes(item.templateId)
                                  ? accent
                                  : colors.faint
                              }
                            />
                          </Pressable>
                        ))
                      : null}
                  </View>
                ))}
              </>
            ) : null}
            {step === 3 ? (
              <>
                <Title
                  title="Connect when you are ready"
                  copy="Both permissions are optional and can be changed later."
                  colors={colors}
                />
                <PermissionCard
                  icon="notifications-outline"
                  title="Notifications"
                  copy="Goal reminders, chat, and group updates."
                  done={pushReady}
                  action={enablePush}
                  colors={colors}
                  accent={accent}
                />
                <PermissionCard
                  icon="heart-outline"
                  title="Health data"
                  copy="Import selected data from Apple Health or Health Connect."
                  done={healthReady}
                  action={enableHealth}
                  colors={colors}
                  accent={accent}
                />
              </>
            ) : null}
            {step === 4 ? (
              <>
                <Title
                  title="You are ready"
                  copy="Three quick ideas are enough to start."
                  colors={colors}
                />
                <View style={styles.tutorial}>
                  <Tip
                    number="1"
                    title="Today keeps the focus small"
                    copy="Tap an item for its history; hold it to rearrange or remove it."
                    colors={colors}
                    accent={accent}
                  />
                  <Tip
                    number="2"
                    title="Log only what is manual"
                    copy="Connected health items update when the app opens or you pull down."
                    colors={colors}
                    accent={accent}
                  />
                  <Tip
                    number="3"
                    title="Advanced stays out of the way"
                    copy="Add ready-made items, formulas, sharing, and group rules only when needed."
                    colors={colors}
                    accent={accent}
                  />
                </View>
                <Pressable
                  onPress={() => setAdvancedTutorial((value) => !value)}
                  style={styles.advanced}
                >
                  <Ionicons
                    name={advancedTutorial ? "checkbox" : "square-outline"}
                    size={21}
                    color={advancedTutorial ? accent : colors.faint}
                  />
                  <Text style={[styles.goalTitle, { color: colors.ink }]}>
                    Continue to advanced customization
                  </Text>
                </Pressable>
              </>
            ) : null}
            {step === 4 ? (
              <View style={styles.landing}>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Open MetricRally on
                </Text>
                <View style={styles.wrap}>
                  <Chip
                    label="Today"
                    icon="today-outline"
                    selected={landingPage === "index"}
                    onPress={() => setLandingPage("index")}
                  />
                  {goals.includes("friends") ? (
                    <Chip
                      label="Leaderboard"
                      icon="people-outline"
                      selected={landingPage === "group"}
                      onPress={() => setLandingPage("group")}
                    />
                  ) : null}
                  <Chip
                    label="Progress"
                    icon="stats-chart-outline"
                    selected={landingPage === "insights"}
                    onPress={() => setLandingPage("insights")}
                  />
                  <Chip
                    label="Log"
                    icon="add-circle-outline"
                    selected={landingPage === "log"}
                    onPress={() => setLandingPage("log")}
                  />
                </View>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            {step > 0 ? (
              <Pressable
                onPress={() => setStep((value) => value - 1)}
                style={styles.back}
              >
                <Text style={[styles.backText, { color: colors.muted }]}>
                  Back
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={skipSetup}
                style={styles.back}
              >
                <Text style={[styles.backText, { color: colors.muted }]}>
                  Skip
                </Text>
              </Pressable>
            )}
            <View style={styles.next}>
              <Button
                label={step === 4 ? "Start using MetricRally" : "Continue"}
                disabled={
                  (step === 0 && (!displayName.trim() || !goals.length)) ||
                  (step === 1 && goals.includes("weight") && !targetIsValid) ||
                  (step === 2 && !selected.length)
                }
                onPress={continueFlow}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Title({
  title,
  copy,
  colors,
}: {
  title: string;
  copy: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>{copy}</Text>
    </>
  );
}
function Field({
  label,
  value,
  set,
  colors,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View style={styles.grow}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        style={[
          styles.input,
          {
            color: colors.ink,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      />
    </View>
  );
}
function Empty({
  copy,
  colors,
  accent,
}: {
  copy: string;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <View style={[styles.empty, { backgroundColor: colors.card }]}>
      <Ionicons name="shield-checkmark-outline" size={28} color={accent} />
      <Text style={[styles.goalTitle, { color: colors.ink }]}>{copy}</Text>
    </View>
  );
}
function PermissionCard({
  icon,
  title,
  copy,
  done,
  action,
  colors,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  done: boolean;
  action: () => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <Pressable
      onPress={action}
      style={[
        styles.permission,
        {
          backgroundColor: colors.card,
          borderColor: done ? accent : colors.border,
        },
      ]}
    >
      <View style={[styles.goalIcon, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.goalTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.goalCopy, { color: colors.muted }]}>{copy}</Text>
      </View>
      <Text style={[styles.done, { color: done ? accent : colors.muted }]}>
        {done ? "Connected" : "Set up"}
      </Text>
    </Pressable>
  );
}
function Tip({
  number,
  title,
  copy,
  colors,
  accent,
}: {
  number: string;
  title: string;
  copy: string;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <View style={styles.tip}>
      <View style={[styles.number, { backgroundColor: accent }]}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      <View style={styles.grow}>
        <Text style={[styles.goalTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.goalCopy, { color: colors.muted }]}>{copy}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 18, paddingBottom: 8 },
  top: { height: 50, flexDirection: "row", alignItems: "center", gap: 9 },
  mark: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  step: { marginLeft: "auto", fontSize: 10, fontWeight: "800" },
  body: { flex: 1 },
  bodyContent: { paddingTop: 15, paddingBottom: 12 },
  title: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  subtitle: { fontSize: 11, lineHeight: 17, marginTop: 5, marginBottom: 13 },
  goalGrid: { gap: 6 },
  goal: {
    minHeight: 59,
    borderWidth: 1,
    borderRadius: 15,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  goalIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  goalTitle: { fontSize: 11, fontWeight: "900" },
  nameLabel: { fontSize: 11, fontWeight: "900", marginBottom: 6 },
  goalCopy: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  grow: { flex: 1 },
  label: { fontSize: 10, fontWeight: "900", marginTop: 6, marginBottom: 6 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  fields: { flexDirection: "row", gap: 8 },
  customTypeChoices: {
    flexDirection: "row",
    gap: 14,
    marginTop: 2,
    marginBottom: 14,
  },
  customTypeChoice: { flex: 1 },
  fieldLabel: { fontSize: 9, fontWeight: "800", marginBottom: 4 },
  nameField: { marginBottom: 10 },
  validation: { fontSize: 9, fontWeight: "800", marginBottom: 8 },
  input: {
    height: 41,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
  },
  empty: {
    alignItems: "center",
    padding: 24,
    borderRadius: 17,
    gap: 6,
    marginTop: 16,
  },
  choiceList: { gap: 5 },
  choice: {
    height: 40,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectActions: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "flex-end",
    marginVertical: 9,
  },
  customTracker: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  customHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  customField: { flex: 1 },
  action: { fontSize: 10, fontWeight: "900" },
  group: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 7,
    overflow: "hidden",
  },
  groupHead: {
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  count: { marginLeft: "auto", fontSize: 9, fontWeight: "900" },
  tracker: {
    minHeight: 50,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  goalFlag: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  tinyIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  permission: {
    minHeight: 85,
    borderWidth: 1,
    borderRadius: 17,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 9,
  },
  done: { fontSize: 10, fontWeight: "900" },
  tutorial: { gap: 13, marginTop: 7 },
  tip: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  number: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { color: palette.white, fontSize: 11, fontWeight: "900" },
  advanced: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  landing: { marginTop: 14 },
  footer: { height: 58, flexDirection: "row", alignItems: "center", gap: 8 },
  back: { padding: 11 },
  backText: { fontSize: 11, fontWeight: "900" },
  next: { flex: 1 },
});
