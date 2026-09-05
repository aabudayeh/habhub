import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Button, Chip, ProgressBar, useKeyboardReveal } from "@/src/components/ui";
import { useAuth } from "@/src/auth/AuthProvider";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";
import { dateKey } from "@/src/domain/date";
import { ACTIVITY_LABELS } from "@/src/domain/energy";
import {
  selectedOnboardingHealthDataTypes,
  syncOnboardingProfileBestEffort,
} from "@/src/domain/onboarding";
import {
  firstDisplayName,
  friendlyAccountAlias,
  suggestedAccountName,
} from "@/src/domain/profileName";
import {
  isInternalTracker,
  trackerGroupLabel,
  trackerPresets,
  TrackerPreset,
} from "@/src/domain/trackerCatalog";
import { estimateWeightPlan } from "@/src/domain/weightPlan";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import {
  LocalizedAlert as Alert,
  useLocale,
  useTranslation,
} from "@/src/i18n";
import {
  enablePushNotifications,
  notificationSetupComplete,
} from "@/src/notifications/push";
import { useApp } from "@/src/state/AppProvider";
import {
  clearOnboardingDraft,
  markOnboardingCompleted,
  ONBOARDING_FLOW_VERSION,
  OnboardingDraft,
  OnboardingMode,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "@/src/storage/onboardingState";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  ActivityLevel,
  AppState,
  BiologicalSex,
  HealthHistoryDays,
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
    title: "Track workout progress",
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
] as const;

const HEALTH_TRACKER_IDS = [
  "sleep",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "pulse",
  "blood_glucose",
  "menstrual_cycle",
  "body_fat",
  "lean_body_mass",
  "body_water_mass",
  "bone_mass",
] as const;

const GOAL_TRACKER_IDS: Record<string, readonly string[]> = {
  weight: ["weight", "food", "exercise", "deficit", "weekly_deficit_balance"],
  activity: ["steps", "exercise", "workout", "workout_duration", "workout_distance"],
  // Workout and Workout duration are shared by the gym workspace and connected
  // health. Workout volume remains available later, but is intentionally not a
  // first-run recommendation.
  gym: ["exercise", "workout", "workout_duration"],
  learning: ["reading", "study", "work"],
  health: HEALTH_TRACKER_IDS,
  nutrition: ["food", "water", "intermittent_fasting"],
  friends: [],
};

/** A useful dashboard even when a new user chooses no specific ambition. */
const DEFAULT_STARTER_TRACKER_IDS = [
  "steps",
  "exercise",
  "food",
  "deficit",
  "weekly_deficit_balance",
  "todo_completion",
  "workout",
  "water",
  "reading",
  "study",
  "work",
] as const;
const DEFAULT_TRACKED_GOAL_IDS = ["steps", "exercise", "workout", "water"];
/** Useful optional choices shown without silently adding them to the setup. */
const OPTIONAL_ONBOARDING_TRACKER_IDS = ["screen_time"] as const;

function compactOnboardingName(value: string, generatedAlias: string) {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return normalized === generatedAlias
    ? generatedAlias
    : firstDisplayName(normalized);
}
const NOT_DAILY_GOALS = new Set([
  "weight",
  "weekly_deficit_balance",
  "overall_score",
  "progress_photo",
  "pulse",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "body_fat",
  "lean_body_mass",
  "body_water_mass",
  "bone_mass",
  "todo_completion",
]);

function presetTargetLabel(item: TrackerPreset) {
  if (item.goalEnabled === false) return null;
  if (item.dataType === "boolean") return "✓";
  const format = (value: number) =>
    Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const value = item.goalRange
    ? `${format(item.goalRange.min)}–${format(item.goalRange.max)}`
    : format(item.goal.target);
  return `${value}${item.unit ? ` ${item.unit}` : ""}`;
}

export default function Onboarding() {
  const {
    state,
    updateSettings,
    updateEnergyProfile,
    configurePersonalMetrics,
    updateMemberName,
    flushLocalPersistence,
  } = useApp();
  const auth = useAuth();
  const health = useHealthSync();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const t = useTranslation();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  useKeyboardReveal(scrollRef);

  const accountId =
    auth.user?.id ??
    (!auth.configured
      ? `demo:${state.currentUserId}`
      : state.currentUserId);
  const accountIdentity = auth.user ?? { id: state.currentUserId };
  const generatedAccountAlias = friendlyAccountAlias(accountIdentity);
  const memberName =
    state.group.members.find((member) => member.id === state.currentUserId)
      ?.name || suggestedAccountName(accountIdentity);
  const profile = state.settings.energyProfile;
  const [draftReady, setDraftReady] = useState(false);
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode | null>(
    null,
  );
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [finishing, setFinishing] = useState(false);
  const [completionRoute, setCompletionRoute] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(
    compactOnboardingName(memberName, generatedAccountAlias),
  );
  const [goals, setGoals] = useState<string[]>(
    state.settings.selectedGoals ?? [],
  );
  const [selected, setSelected] = useState<string[]>([
    ...DEFAULT_STARTER_TRACKER_IDS,
  ]);
  const [trackedSelected, setTrackedSelected] = useState<string[]>(
    DEFAULT_TRACKED_GOAL_IDS,
  );
  const [infoTracker, setInfoTracker] = useState<TrackerPreset | null>(null);
  const [expandedGoals, setExpandedGoals] = useState<string[]>([]);
  const [goalTargets, setGoalTargets] = useState<Record<string, string>>({});
  const [direction, setDirection] = useState<WeightDirection>(
    state.settings.weightDirection ?? "lose",
  );
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
  const [landingPage, setLandingPage] = useState<LandingPage>("index");
  const [showGoalsToday, setShowGoalsToday] = useState(
    state.settings.showGoalsToday !== false,
  );
  const [showTodosToday, setShowTodosToday] = useState(
    state.settings.showTodosToday !== false,
  );
  const [startShortTour, setStartShortTour] = useState(true);
  const [pushReady, setPushReady] = useState(false);
  const [healthReady, setHealthReady] = useState(
    state.settings.healthSync.enabled,
  );
  const [healthHistoryDays, setHealthHistoryDays] = useState<HealthHistoryDays>(
    state.settings.healthHistoryDays ?? 90,
  );
  const [startHealthGoalsFromHistory, setStartHealthGoalsFromHistory] =
    useState(true);
  const previousProposedIds = useRef<Set<string> | null>(null);
  const onboardingMountedRef = useRef(true);
  const currentAuthUserIdRef = useRef(auth.user?.id ?? null);
  currentAuthUserIdRef.current = auth.user?.id ?? null;

  useEffect(() => {
    onboardingMountedRef.current = true;
    setCloudSyncPaused("onboarding", true);
    return () => {
      onboardingMountedRef.current = false;
      setCloudSyncPaused("onboarding", false);
    };
  }, []);

  useEffect(() => {
    setHealthReady(state.settings.healthSync.enabled);
  }, [state.settings.healthSync.enabled]);

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    void readOnboardingDraft(accountId).then((draft) => {
      if (!active) return;
      if (draft) {
        setOnboardingMode(draft.onboardingMode);
        setStep(draft.step);
        setDisplayName(
          compactOnboardingName(draft.displayName, generatedAccountAlias),
        );
        setGoals(draft.goals);
        setSelected(draft.selectedTrackerIds);
        setTrackedSelected(draft.trackedGoalIds);
        setExpandedGoals(draft.expandedGoalIds);
        setGoalTargets(draft.goalTargets ?? {});
        setDirection(draft.direction);
        setAge(draft.age);
        setHeight(draft.height);
        setWeight(draft.weight);
        setTarget(draft.target);
        setWeeklyChange(draft.weeklyChange);
        setSex(draft.sex);
        setActivity(draft.activity);
        setLandingPage(draft.landingPage);
        setShowGoalsToday(draft.showGoalsToday);
        setShowTodosToday(draft.showTodosToday);
        setStartShortTour(draft.startShortTour);
        setHealthHistoryDays(draft.healthHistoryDays);
        setStartHealthGoalsFromHistory(
          draft.startHealthGoalsFromHistory,
        );
        // Restore this account's draft once. Keeping the live dark-mode value
        // out of this effect's dependencies prevents the final-page switch
        // from re-running hydration and jumping back to an older draft.
        updateSettings({ darkMode: draft.darkMode });
      }
      previousProposedIds.current = null;
      setDraftReady(true);
    });
    return () => {
      active = false;
    };
  }, [accountId, generatedAccountAlias, updateSettings]);

  useEffect(() => {
    let active = true;
    setPushReady(false);
    void notificationSetupComplete(auth.user?.id)
      .then((ready) => {
        if (active) setPushReady(ready);
      })
      .catch(() => {
        if (active) setPushReady(false);
      });
    return () => {
      active = false;
    };
  }, [auth.user?.id]);

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
          : Math.max(
              0.05,
              Math.min(
                2,
                Number(weeklyChange.replace(",", ".")) ||
                  profile.desiredWeeklyLossKg,
              ),
            ),
      sex,
      activityLevel: activity,
    }),
    [
      activity,
      age,
      direction,
      height,
      profile,
      sex,
      target,
      weeklyChange,
      weight,
    ],
  );

  const desired = useMemo(() => {
    const ids = new Set<string>(DEFAULT_STARTER_TRACKER_IDS);
    OPTIONAL_ONBOARDING_TRACKER_IDS.forEach((id) => ids.add(id));
    goals.forEach((goalId) =>
      (GOAL_TRACKER_IDS[goalId] ?? []).forEach((id) => ids.add(id)),
    );
    return ids;
  }, [goals]);
  const recommendedTracked = useMemo(() => {
    const ids = new Set(DEFAULT_TRACKED_GOAL_IDS);
    goals.forEach((goalId) =>
      (GOAL_TRACKER_IDS[goalId] ?? []).forEach((id) => {
        if (!NOT_DAILY_GOALS.has(id)) ids.add(id);
      }),
    );
    return ids;
  }, [goals]);
  const proposed = useMemo(() => {
    const adjusted = {
      ...state,
      settings: {
        ...state.settings,
        energyProfile: nextProfile,
        weightDirection: direction,
      },
    } as AppState;
    return trackerPresets(adjusted, true).filter((item) =>
      desired.has(item.templateId),
    );
  }, [desired, direction, nextProfile, state]);
  const visibleRecommendations = useMemo(
    () =>
      proposed.filter((item) =>
        !isInternalTracker({
          id: item.templateId,
          healthMapping: item.healthMapping,
        }),
      ),
    [proposed],
  );
  const groupedRecommendations = useMemo(() => {
    const groups = new Map<string, TrackerPreset[]>();
    visibleRecommendations.forEach((item) => {
      const label = trackerGroupLabel(item);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    });
    return [...groups.entries()];
  }, [visibleRecommendations]);
  const editableGoalItems = proposed.filter(
    (item) =>
      selected.includes(item.templateId) &&
      trackedSelected.includes(item.templateId) &&
      item.goalEnabled !== false &&
      item.dataType !== "boolean" &&
      item.goal.kind !== "complete" &&
      !item.goalRange,
  );
  const trackedHealthHistoryCount = proposed.filter(
    (item) =>
      selected.includes(item.templateId) &&
      trackedSelected.includes(item.templateId) &&
      Boolean(item.healthMapping),
  ).length;
  const onboardingHealthDataTypes = useMemo(
    () => selectedOnboardingHealthDataTypes(proposed, selected),
    [proposed, selected],
  );
  const targetIsValid =
    direction === "maintain" ||
    (direction === "lose" && nextProfile.targetWeightKg < nextProfile.weightKg) ||
    (direction === "gain" && nextProfile.targetWeightKg > nextProfile.weightKg);
  const weeklyChangeNumber = Number(weeklyChange.replace(",", "."));
  const weeklyChangeIsValid =
    direction === "maintain" ||
    (Number.isFinite(weeklyChangeNumber) &&
      weeklyChangeNumber >= 0.05 &&
      weeklyChangeNumber <= 2);
  const weightPlan = useMemo(
    () =>
      targetIsValid
        ? estimateWeightPlan({
            anchorDate: dateKey(),
            currentWeightKg: nextProfile.weightKg,
            direction,
            targetWeightKg: nextProfile.targetWeightKg,
            weeklyChangeKg: nextProfile.desiredWeeklyLossKg,
          })
        : undefined,
    [direction, nextProfile, targetIsValid],
  );
  const expectedWeightDate = weightPlan?.expectedGoalDate
    ? new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${weightPlan.expectedGoalDate}T12:00:00`))
    : undefined;
  const infoTarget = infoTracker ? presetTargetLabel(infoTracker) : null;

  useEffect(() => {
    if (!draftReady) return;
    const nextIds = new Set(proposed.map((item) => item.templateId));
    const previousIds = previousProposedIds.current;
    previousProposedIds.current = nextIds;
    if (!previousIds) {
      setSelected((current) =>
        current.filter((id) => nextIds.has(id)),
      );
      setTrackedSelected((current) =>
        current.filter((id) => nextIds.has(id)),
      );
      return;
    }
    const added = proposed.filter((item) => !previousIds.has(item.templateId));
    const removed = [...previousIds].filter((id) => !nextIds.has(id));
    if (!added.length && !removed.length) return;
    const removedSet = new Set(removed);
    setSelected((current) => [
      ...current.filter((id) => !removedSet.has(id)),
      ...added
        .map((item) => item.templateId)
        .filter((id) => !current.includes(id)),
    ]);
    setTrackedSelected((current) => [
      ...current.filter((id) => !removedSet.has(id)),
      ...added
        .map((item) => item.templateId)
        .filter(
          (id) => recommendedTracked.has(id) && !current.includes(id),
        ),
    ]);
  }, [draftReady, proposed, recommendedTracked]);

  useEffect(() => {
    if (!draftReady || finishing || !onboardingMode) return;
    const timer = setTimeout(() => {
      void writeOnboardingDraft(accountId, draftSnapshot(step)).catch(
        () => undefined,
      );
    }, 180);
    return () => clearTimeout(timer);
    // draftSnapshot deliberately observes every local picker below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    activity,
    age,
    direction,
    displayName,
    draftReady,
    expandedGoals,
    finishing,
    goalTargets,
    goals,
    healthHistoryDays,
    height,
    landingPage,
    onboardingMode,
    selected,
    sex,
    showGoalsToday,
    showTodosToday,
    startHealthGoalsFromHistory,
    startShortTour,
    state.settings.darkMode,
    step,
    target,
    trackedSelected,
    weeklyChange,
    weight,
  ]);

  function draftSnapshot(nextStep: 0 | 1 | 2 | 3 | 4): OnboardingDraft {
    return {
      version: ONBOARDING_FLOW_VERSION,
      onboardingMode: onboardingMode ?? "guided",
      step: nextStep,
      displayName,
      goals,
      selectedTrackerIds: selected,
      trackedGoalIds: trackedSelected,
      expandedGoalIds: expandedGoals,
      goalTargets,
      direction,
      age,
      height,
      weight,
      target,
      weeklyChange,
      sex,
      activity,
      landingPage,
      darkMode: state.settings.darkMode,
      showGoalsToday,
      showTodosToday,
      startShortTour,
      healthHistoryDays,
      startHealthGoalsFromHistory,
      updatedAt: new Date().toISOString(),
    };
  }

  function toggleGoal(id: string) {
    const enabling = !goals.includes(id);
    setGoals((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    // Today stays the calm default even when accountability is selected.
    // Leaderboard remains an explicit choice on the connection/start page.
    if (id === "friends" && !enabling && landingPage === "group")
      setLandingPage("index");
  }

  function chooseWeightDirection(next: WeightDirection) {
    setDirection(next);
    const current = Number(weight.replace(",", "."));
    const currentTarget = Number(target.replace(",", "."));
    if (!Number.isFinite(current)) return;
    if (next === "maintain") setTarget(String(current));
    else if (
      !Number.isFinite(currentTarget) ||
      (next === "lose" && currentTarget >= current) ||
      (next === "gain" && currentTarget <= current)
    )
      setTarget(String(Math.max(20, current + (next === "gain" ? 5 : -5))));
  }

  function toggleTracker(id: string) {
    const linkedIds =
      id === "blood_pressure_systolic"
        ? ["blood_pressure_systolic", "blood_pressure_diastolic"]
        : [id];
    if (selected.includes(id)) {
      setSelected((current) =>
        current.filter((item) => !linkedIds.includes(item)),
      );
      setTrackedSelected((current) =>
        current.filter((item) => !linkedIds.includes(item)),
      );
      return;
    }
    setSelected((current) => [
      ...current,
      ...linkedIds.filter((item) => !current.includes(item)),
    ]);
  }

  function toggleTrackedTracker(id: string) {
    if (!selected.includes(id))
      setSelected((current) =>
        current.includes(id) ? current : [...current, id],
      );
    setTrackedSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function showTrackerInfo(item: TrackerPreset) {
    setInfoTracker(item);
  }

  function chooseHealthGoalHistory(value: boolean) {
    setStartHealthGoalsFromHistory(value);
    // The choice remains authoritative even if permission was granted before
    // the user changed this switch. The deferred import reads this one-shot
    // flag only after onboarding has closed.
    if (!value || healthReady)
      updateSettings({
        healthSync: {
          ...state.settings.healthSync,
          backfillTrackedGoalsOnFirstImport: value || undefined,
          backfillTrackedGoalsEmptyReadCount: undefined,
        },
      });
  }

  function metricDefinitions(): MetricDefinition[] {
    const today = dateKey();
    return proposed
      .filter((item) => selected.includes(item.templateId))
      .map((item, order) => {
        const rawTarget = goalTargets[item.templateId];
        const parsedTarget = Number(rawTarget?.replace(",", "."));
        const targetOverride =
          rawTarget !== undefined &&
          Number.isFinite(parsedTarget) &&
          parsedTarget > 0
            ? parsedTarget
            : item.goal.target;
        return {
        id: item.templateId,
        slug: item.templateId,
        name: item.name,
        icon: item.icon,
        color: item.color,
        unit: item.unit,
        dataType: item.dataType,
        aggregation: item.aggregation,
        goal: { ...item.goal, target: targetOverride },
        adaptiveGoalTarget: item.adaptiveGoalTarget
          ? { ...item.adaptiveGoalTarget }
          : undefined,
        goalEnabled: item.goalEnabled,
        goalRange: item.goalRange,
        goalProgressMode: item.goalProgressMode,
        category: item.category,
        healthMapping: item.healthMapping,
        gymMapping: item.gymMapping,
        gymMuscleGroups: item.gymMuscleGroups,
        stepFallback: item.stepFallback,
        manualEntry: item.manualEntry,
        timerEnabled: item.timerEnabled,
        fastingSettings: item.fastingSettings
          ? { ...item.fastingSettings }
          : undefined,
        reminders: item.reminders,
        rankingDirection: item.rankingDirection,
        defaultVisibility: item.defaultVisibility,
        formula: item.formula,
        formulaVersion: 1,
        scoreWeight: 0,
        sections:
          item.templateId === "todo_completion"
            ? { today: true, insights: false, group: false }
            : { today: true, insights: true, group: false },
        order,
        activeFrom: today,
        };
      });
  }

  function configure(options?: { keepLeaderboardVisible?: boolean }) {
    const metrics = metricDefinitions();
    configurePersonalMetrics(
      metrics,
      metrics
        .filter((item) => trackedSelected.includes(item.id))
        .map((item) => item.id),
      startHealthGoalsFromHistory ? "history" : "today",
    );
    updateSettings({
      selectedGoals: goals,
      weightDirection: direction,
      weightManagementEnabled: goals.includes("weight"),
      showWeightManagementSummary: goals.includes("weight")
        ? state.settings.showWeightManagementSummary !== false
        : state.settings.showWeightManagementSummary,
      showLeaderboard:
        options?.keepLeaderboardVisible === true || goals.includes("friends"),
      showChat: true,
      showGym: true,
      showStatus:
        landingPage === "status" || state.settings.showStatus !== false,
      showGoalsToday,
      showTodosToday,
      defaultLandingPage: landingPage,
    });
    updateEnergyProfile(nextProfile);
  }

  function saveDisplayNameLocally() {
    const name =
      compactOnboardingName(displayName, generatedAccountAlias) ||
      suggestedAccountName(accountIdentity);
    updateMemberName(state.currentUserId, name);
    return name;
  }

  async function syncDisplayNameBestEffort(name: string) {
    const expectedUserId = auth.user?.id;
    if (auth.status !== "signedIn" || !expectedUserId) return;
    const result = await syncOnboardingProfileBestEffort({
      sync: () => auth.updateDisplayName(name),
      isAccountCurrent: () =>
        onboardingMountedRef.current &&
        currentAuthUserIdRef.current === expectedUserId,
    });
    if (result.status === "synced") return;

    const detail =
      result.error instanceof Error ? result.error.message : "Unknown error";
    const message = new Error(
      "Your setup was saved, but the account display name did not sync yet. You can retry it from Profile.",
    );
    // Do not attach an old account's warning to a newly selected identity.
    if (
      onboardingMountedRef.current &&
      currentAuthUserIdRef.current === expectedUserId
    )
      auth.reportAuthError(message);
    console.warn(
      `[onboarding] Display-name sync deferred (${result.reason}, ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}): ${detail}`,
    );
  }

  async function completeOnboarding(
    shortTour: boolean,
    route: string,
    options?: { keepLeaderboardVisible?: boolean },
  ) {
    if (healthReady)
      await health.setHealthHistoryDays(healthHistoryDays);
    configure(options);
    const name = saveDisplayNameLocally();
    updateSettings({
      healthHistoryDays,
      onboardingVersion: ONBOARDING_FLOW_VERSION,
      tutorialComplete: !shortTour,
      tutorialGuideId: shortTour ? "essential" : undefined,
      tutorialGuideRunId: shortTour ? Date.now() : undefined,
      defaultLandingPage: landingPage,
    });
    await flushLocalPersistence();
    await markOnboardingCompleted(accountId);
    updateSettings({ onboardingComplete: true });
    await flushLocalPersistence();
    await clearOnboardingDraft(accountId);
    await syncDisplayNameBestEffort(name);
    setCloudSyncPaused("onboarding", false);
    setCompletionRoute(route);
  }

  async function finish(shortTour = startShortTour) {
    if (finishing) return;
    setFinishing(true);
    try {
      await completeOnboarding(
        shortTour,
        shortTour
          ? "/"
          : landingPage === "index"
            ? "/"
            : `/${landingPage}`,
      );
    } catch (error) {
      setFinishing(false);
      Alert.alert(
        "Setup could not be saved",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  async function continueFlow() {
    if (finishing) return;
    if (step === 4) {
      await finish();
      return;
    }
    const next = (step + 1) as 1 | 2 | 3 | 4;
    await writeOnboardingDraft(accountId, draftSnapshot(next)).catch(
      () => undefined,
    );
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  async function skipSetup() {
    if (finishing) return;
    setFinishing(true);
    try {
      await completeOnboarding(true, "/", {
        keepLeaderboardVisible: true,
      });
    } catch (error) {
      setFinishing(false);
      Alert.alert(
        "Setup could not be saved",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  function chooseOnboardingMode(mode: OnboardingMode) {
    setOnboardingMode(mode);
    setStartShortTour(mode === "guided");
  }

  async function enablePush() {
    try {
      if (!auth.user)
        throw new Error(
          "Sign in on a physical device before connecting notifications.",
        );
      const preferences = {
        ...state.settings.notifications,
        pushEnabled: true,
      };
      await enablePushNotifications(
        auth.user.id,
        preferences,
        state.settings.language,
      );
      // Resolution is the registration acknowledgement. A second immediate
      // SELECT could fail after a successful insert and falsely show setup as
      // disconnected on a weak connection.
      updateSettings({
        notifications: preferences,
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
      await health.connect({
        historyDays: healthHistoryDays,
        dataTypes: onboardingHealthDataTypes,
        startTrackedGoalsAtFirstData:
          healthHistoryDays > 0 &&
          startHealthGoalsFromHistory &&
          trackedHealthHistoryCount > 0,
      });
      setHealthReady(true);
    } catch (error) {
      Alert.alert(
        "Health connection not completed",
        error instanceof Error ? error.message : "You can connect later.",
      );
    }
  }

  if (completionRoute) return <Redirect href={completionRoute as never} />;
  if (!draftReady)
    return (
      <SafeAreaView
        style={[styles.loading, { backgroundColor: colors.canvas }]}
      >
        <View style={[styles.mark, { backgroundColor: accent }]}>
          <Ionicons name="navigate" size={20} color={palette.white} />
        </View>
        <ActivityIndicator color={accent} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Restoring setup…</Text>
      </SafeAreaView>
    );

  if (!onboardingMode)
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.canvas }]}
        edges={["top", "bottom"]}
      >
        <ScrollView
          contentContainerStyle={styles.welcomeContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.welcomeMark, { backgroundColor: accent }]}>
            <Ionicons name="navigate" size={30} color={palette.white} />
          </View>
          <Text style={[styles.welcomeEyebrow, { color: accent }]}>WELCOME TO HABHUB</Text>
          <Text style={[styles.welcomeTitle, { color: colors.ink }]}>Build a Today page that works for you</Text>
          <Text style={[styles.welcomeCopy, { color: colors.muted }]}>Choose an interactive setup with a two-minute app tour, or use the familiar five-page setup on its own.</Text>
          <View style={styles.modeChoices}>
            <ModeChoice
              icon="sparkles-outline"
              title="Guided setup"
              copy="Recommended · Pick your goals, shape Today, then learn by opening real demo trackers and their history."
              badge="RECOMMENDED"
              onPress={() => chooseOnboardingMode("guided")}
              colors={colors}
              accent={accent}
            />
            <ModeChoice
              icon="options-outline"
              title="Quick setup"
              copy="Use the classic five-page setup. The interactive guide stays available if you want it later."
              badge="CLASSIC"
              onPress={() => chooseOnboardingMode("classic")}
              colors={colors}
              accent={accent}
            />
          </View>
          <View style={[styles.welcomeNote, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={accent} />
            <Text style={[styles.welcomeNoteText, { color: colors.muted }]}>Both paths save the same private, customizable setup. You can change everything later.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.page}>
          <View style={styles.top}>
            <View style={[styles.mark, { backgroundColor: accent }]}>
              <Ionicons name="navigate" size={20} color={palette.white} />
            </View>
            <Text style={[styles.brand, { color: colors.ink }]}>HABHUB</Text>
            <Text style={[styles.step, { color: colors.muted }]}>
              {step + 1}/5
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change setup path"
              onPress={() => setOnboardingMode(null)}
              style={[styles.modePill, { backgroundColor: colors.primarySoft }]}
            >
              <Text style={[styles.modePillText, { color: accent }]}>
                {onboardingMode === "guided" ? "Guided" : "Quick"}
              </Text>
            </Pressable>
          </View>
          <ProgressBar progress={(step + 1) / 5} color={accent} />
          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {step === 0 ? (
              <>
                <Title
                  title="What matters to you?"
                  copy="Pick any priorities that feel useful. You can also continue with a balanced starter setup."
                  colors={colors}
                />
                <Text style={[styles.nameLabel, { color: colors.ink }]}>What should we call you?</Text>
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
                <View style={styles.goalGrid}>
                  {GOALS.map((goal) => {
                    const chosen = goals.includes(goal.id);
                    return (
                      <Pressable
                        key={goal.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: chosen }}
                        accessibilityLabel={goal.title}
                        onPress={() => toggleGoal(goal.id)}
                        style={({ pressed }) => [
                          styles.goalChoice,
                          {
                            backgroundColor: colors.card,
                            borderColor: chosen ? accent : colors.border,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={[styles.goalIcon, { backgroundColor: `${accent}18` }]}>
                          <Ionicons name={goal.icon} size={21} color={accent} />
                        </View>
                        <View style={styles.grow}>
                          <Text style={[styles.goalTitle, { color: colors.ink }]}>{goal.title}</Text>
                          <Text style={[styles.goalCopy, { color: colors.muted }]}>{goal.copy}</Text>
                        </View>
                        <Ionicons
                          name={chosen ? "checkmark-circle" : "ellipse-outline"}
                          size={21}
                          color={chosen ? accent : colors.faint}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Title
                  title="Your starter dashboard"
                  copy={t("Trackers record things you want to see over time. Tracked goals are the small set that count toward Today's completion. For example, keep Body weight as a tracker for its long-term trend, while Steps can be a tracked goal you aim to finish each day.")}
                  colors={colors}
                />
                <View style={styles.legend}>
                  <Legend icon="checkmark-circle" label="Added to HabHub" color={accent} colors={colors} />
                  <Legend icon="flag" label="Counts as a daily goal" color={accent} colors={colors} />
                </View>
                <View
                  style={[
                    styles.setupStats,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <SetupStat value={selected.length} label="trackers ready" colors={colors} />
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <SetupStat value={trackedSelected.length} label="daily goals" colors={colors} />
                </View>
                <Text style={[styles.sectionLabel, { color: colors.ink }]}>What should Today show?</Text>
                <Text style={[styles.sectionHelp, { color: colors.muted }]}>Keep either section, both, or neither. This changes only your dashboard—not your trackers, tasks, or history.</Text>
                <TodayPreference
                  icon="flag-outline"
                  title="Trackers and daily goals"
                  copy="See tracker tiles and the goals that count toward daily completion."
                  value={showGoalsToday}
                  onValueChange={setShowGoalsToday}
                  colors={colors}
                  accent={accent}
                />
                <TodayPreference
                  icon="checkbox-outline"
                  title="To-dos"
                  copy="See tasks and their separate completion progress on Today."
                  value={showTodosToday}
                  onValueChange={setShowTodosToday}
                  colors={colors}
                  accent={accent}
                />
                <Text style={[styles.sectionLabel, { color: colors.ink }]}>Recommended setup</Text>
                <Text style={[styles.sectionHelp, { color: colors.muted }]}>Tap a tracker to learn what it records. Use the flag for daily completion and the checkmark to add or remove it.</Text>
                {groupedRecommendations.map(([label, items]) => (
                  <View key={label} style={styles.metricGroup}>
                    <Text style={[styles.metricGroupLabel, { color: colors.muted }]}>{label}</Text>
                    <View style={styles.metricGrid}>
                      {items.map((item) => (
                        <MetricSummaryCard
                          key={item.templateId}
                          item={item}
                          selected={selected.includes(item.templateId)}
                          tracked={trackedSelected.includes(item.templateId)}
                          width={
                            width < 360
                              ? "100%"
                              : width >= 760
                                ? "31.5%"
                                : "48.5%"
                          }
                          onShowInfo={() => showTrackerInfo(item)}
                          onToggle={() => toggleTracker(item.templateId)}
                          onToggleTracked={() => toggleTrackedTracker(item.templateId)}
                        />
                      ))}
                    </View>
                  </View>
                ))}
                {editableGoalItems.length ? (
                  <View
                    style={[
                      styles.targetEditor,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        expanded: expandedGoals.includes("tracker-targets"),
                      }}
                      onPress={() =>
                        setExpandedGoals((current) =>
                          current.includes("tracker-targets")
                            ? current.filter((id) => id !== "tracker-targets")
                            : [...current, "tracker-targets"],
                        )
                      }
                      style={styles.targetEditorHeader}
                    >
                      <View style={styles.grow}>
                        <Text style={[styles.goalTitle, { color: colors.ink }]}>Review daily goals (optional)</Text>
                        <Text style={[styles.goalCopy, { color: colors.muted }]}>The defaults are ready; open this only if you want different targets.</Text>
                      </View>
                      <Ionicons
                        name={expandedGoals.includes("tracker-targets") ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.faint}
                      />
                    </Pressable>
                    {expandedGoals.includes("tracker-targets") ? (
                      <View style={styles.targetRows}>
                        {editableGoalItems.map((item) => (
                          <View key={item.templateId} style={[styles.targetRow, { borderTopColor: colors.border }]}>
                            <View style={[styles.metricIcon, { backgroundColor: `${item.color}18` }]}>
                              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={16} color={item.color} />
                            </View>
                            <Text style={[styles.targetName, { color: colors.ink }]} numberOfLines={1}>{item.name}</Text>
                            <TextInput
                              accessibilityLabel={`${item.name} daily goal`}
                              value={goalTargets[item.templateId] ?? String(item.goal.target)}
                              onChangeText={(value) =>
                                setGoalTargets((current) => ({
                                  ...current,
                                  [item.templateId]: value,
                                }))
                              }
                              keyboardType="decimal-pad"
                              selectTextOnFocus
                              style={[
                                styles.targetInput,
                                {
                                  color: colors.ink,
                                  borderColor: colors.border,
                                  backgroundColor: colors.canvas,
                                },
                              ]}
                            />
                            <Text style={[styles.targetUnit, { color: colors.muted }]}>{item.unit || "goal"}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Title
                  title="Optional personal setup"
                  copy="Add profile details only when they help calculate your weight plan. You can change them later."
                  colors={colors}
                />
                {goals.includes("weight") ? (
                  <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.sectionLabel, { color: colors.ink }]}>Weight plan</Text>
                    <View style={styles.wrap}>
                      {(["lose", "maintain", "gain"] as WeightDirection[]).map((item) => (
                        <Chip key={item} label={item[0].toUpperCase() + item.slice(1)} selected={direction === item} onPress={() => chooseWeightDirection(item)} />
                      ))}
                    </View>
                    <View style={styles.fields}>
                      <Field label="Age" value={age} set={setAge} colors={colors} />
                      <Field label="Height cm" value={height} set={setHeight} colors={colors} />
                    </View>
                    <View style={styles.fields}>
                      <Field label="Current kg" value={weight} set={setWeight} colors={colors} />
                      <Field label="Target kg" value={target} set={setTarget} colors={colors} />
                    </View>
                    <View style={styles.wrap}>
                      {(["female", "male", "unspecified"] as BiologicalSex[]).map((item) => (
                        <Chip key={item} label={item === "unspecified" ? "Prefer not to say" : item[0].toUpperCase() + item.slice(1)} selected={sex === item} onPress={() => setSex(item)} />
                      ))}
                    </View>
                    <Text style={[styles.fieldGroupLabel, { color: colors.ink }]}>Usual activity</Text>
                    <View style={styles.wrap}>
                      {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((item) => (
                        <Chip key={item} label={ACTIVITY_LABELS[item]} selected={activity === item} onPress={() => setActivity(item)} />
                      ))}
                    </View>
                    {direction !== "maintain" ? (
                      <>
                        <Text style={[styles.fieldGroupLabel, { color: colors.ink }]}>
                          {direction === "gain"
                            ? "Desired gain per week"
                            : "Desired loss per week"}
                        </Text>
                        <View style={styles.rateControls}>
                          <View style={styles.rateChips}>
                          {[0.25, 0.5, 0.75, 1].map((rate) => (
                            <Chip key={rate} label={`${rate} kg`} selected={Number(weeklyChange) === rate} onPress={() => setWeeklyChange(String(rate))} />
                          ))}
                          </View>
                          <View style={[styles.rateInputWrap, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                            <TextInput
                              accessibilityLabel={
                                direction === "gain"
                                  ? "Desired gain per week"
                                  : "Desired loss per week"
                              }
                              value={weeklyChange}
                              onChangeText={setWeeklyChange}
                              keyboardType="decimal-pad"
                              selectTextOnFocus
                              style={[styles.rateInput, { color: colors.ink }]}
                            />
                            <Text style={[styles.rateUnit, { color: colors.muted }]}>kg/wk</Text>
                          </View>
                        </View>
                      </>
                    ) : null}
                    {weightPlan && (expectedWeightDate || direction === "maintain") ? (
                      <View style={[styles.weightEstimate, { backgroundColor: colors.primarySoft }]}>
                        <Ionicons name={direction === "maintain" ? "remove-outline" : "calendar-outline"} size={15} color={accent} />
                        <Text style={[styles.weightEstimateText, { color: colors.ink }]}>
                          {direction === "maintain"
                            ? `Maintain around ${nextProfile.weightKg.toFixed(1)} kg`
                            : `At ${weightPlan.weeklyChangeKg.toFixed(2).replace(/0$/, "")} kg/week · target around ${expectedWeightDate}`}
                        </Text>
                      </View>
                    ) : null}
                    {!targetIsValid ? (
                      <Text style={[styles.validation, { color: palette.red }]}>{direction === "lose" ? "Choose a target below your current weight." : "Choose a target above your current weight."}</Text>
                    ) : null}
                    {!weeklyChangeIsValid ? (
                      <Text style={[styles.validation, { color: palette.red }]}>Choose a weekly change from 0.05 to 2 kg.</Text>
                    ) : null}
                  </View>
                ) : null}
                {!goals.includes("weight") ? (
                  <View style={[styles.defaultNotice, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name="checkmark-circle" size={20} color={accent} />
                    <View style={styles.grow}>
                      <Text style={[styles.goalTitle, { color: colors.ink }]}>No extra profile details needed</Text>
                      <Text style={[styles.goalCopy, { color: colors.muted }]}>Your selected setup can work without age, height, weight, or body details.</Text>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Title
                  title="Connect what helps"
                  copy="Notifications and health connections are optional. Set them up now or return to Settings later."
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
                  title={
                    Platform.OS === "ios"
                      ? "Apple Health"
                      : Platform.OS === "android"
                        ? "Health Connect"
                        : "Health data"
                  }
                  copy={
                    Platform.OS === "ios"
                      ? "Import selected data from Apple Health."
                      : Platform.OS === "android"
                        ? "Import selected data from Health Connect."
                        : "Import selected data from Apple Health or Health Connect on your phone."
                  }
                  done={healthReady}
                  action={enableHealth}
                  colors={colors}
                  accent={accent}
                />
                <View style={[styles.importCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.goalTitle, { color: colors.ink }]}>Health history</Text>
                  <Text style={[styles.goalCopy, { color: colors.muted }]}>Choose how far back HabHub may read. Today only always reads the current day; a past day missed while the app was closed will not be imported later.</Text>
                  <View style={styles.wrap}>
                    {([[0, "Today only"], [30, "30 days"], [90, "3 months"], [365, "1 year"], [730, "2 years"]] as const).map(([days, label]) => (
                      <Chip
                        key={days}
                        label={label}
                        selected={healthHistoryDays === days}
                        onPress={() => {
                          setHealthHistoryDays(days);
                          if (days === 0) setStartHealthGoalsFromHistory(false);
                        }}
                      />
                    ))}
                  </View>
                  {healthHistoryDays > 0 && trackedHealthHistoryCount > 0 ? (
                    <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
                      <View style={styles.grow}>
                        <Text style={[styles.goalTitle, { color: colors.ink }]}>Use imported history for goal starts</Text>
                        <Text style={[styles.goalCopy, { color: colors.muted }]}>Applies only to connected trackers currently flagged as daily goals.</Text>
                      </View>
                      <Switch
                        value={startHealthGoalsFromHistory}
                        onValueChange={chooseHealthGoalHistory}
                        trackColor={{ false: colors.border, true: `${accent}88` }}
                        thumbColor={startHealthGoalsFromHistory ? accent : colors.faint}
                      />
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.sectionLabel, { color: colors.ink }]}>Open HabHub on</Text>
                <View style={styles.wrap}>
                  <Chip label="Today" icon="today-outline" selected={landingPage === "index"} onPress={() => setLandingPage("index")} />
                  {goals.includes("friends") ? <Chip label="Leaderboard" icon="people-outline" selected={landingPage === "group"} onPress={() => setLandingPage("group")} /> : null}
                  <Chip label="Progress" icon="stats-chart-outline" selected={landingPage === "insights"} onPress={() => setLandingPage("insights")} />
                  <Chip label="Log" icon="add-circle-outline" selected={landingPage === "log"} onPress={() => setLandingPage("log")} />
                  <Chip label="Status" icon="accessibility-outline" selected={landingPage === "status"} onPress={() => setLandingPage("status")} />
                </View>
                <View style={[styles.switchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.grow}>
                    <Text style={[styles.goalTitle, { color: colors.ink }]}>Start in dark mode</Text>
                    <Text style={[styles.goalCopy, { color: colors.muted }]}>This choice is saved with your setup.</Text>
                  </View>
                  <Switch
                    value={state.settings.darkMode}
                    onValueChange={(darkMode) => updateSettings({ darkMode })}
                    trackColor={{ false: colors.border, true: `${accent}88` }}
                    thumbColor={state.settings.darkMode ? accent : colors.faint}
                  />
                </View>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <Title
                  title="Ready when you are"
                  copy={onboardingMode === "guided" ? "Your setup is ready. Start the two-minute interactive guide, or enter HabHub now." : "Your classic setup is ready. You can still start the two-minute guide, or enter HabHub now."}
                  colors={colors}
                />
                <View style={[styles.readySummary, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="checkmark-circle" size={28} color={accent} />
                  <View style={styles.grow}>
                    <Text style={[styles.goalTitle, { color: colors.ink }]}>{selected.length} trackers are ready</Text>
                    <Text style={[styles.goalCopy, { color: colors.muted }]}>{trackedSelected.length} are flagged for daily completion. Today will show {showGoalsToday && showTodosToday ? "trackers and to-dos" : showGoalsToday ? "trackers" : showTodosToday ? "to-dos" : "a clean start"}.</Text>
                  </View>
                </View>
                <Text style={[styles.sectionLabel, { color: colors.ink }]}>After setup</Text>
                <TourChoice
                  selected={startShortTour}
                  icon="compass-outline"
                   title="Start the basic guide"
                   copy="Recommended. Learn Today, open a demo tracker, explore its weekly chart, and find display controls without changing your entries."
                  onPress={() => setStartShortTour(true)}
                />
                <TourChoice
                  selected={!startShortTour}
                  icon="rocket-outline"
                   title="Finish without the guide"
                   copy="Open your chosen page now. You can replay the basic guide from Quick Guide later."
                  onPress={() => setStartShortTour(false)}
                />
              </>
            ) : null}
          </ScrollView>
          <Modal
            animationType="fade"
            transparent
            visible={Boolean(infoTracker)}
            onRequestClose={() => setInfoTracker(null)}
          >
            <View style={styles.infoOverlay}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close tracker description"
                onPress={() => setInfoTracker(null)}
                style={StyleSheet.absoluteFill}
              />
              {infoTracker ? (
                <View
                  accessibilityViewIsModal
                  style={[
                    styles.infoCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.infoHeading}>
                    <View style={[styles.infoIcon, { backgroundColor: `${infoTracker.color}18` }]}>
                      <Ionicons name={infoTracker.icon as keyof typeof Ionicons.glyphMap} size={22} color={infoTracker.color} />
                    </View>
                    <View style={styles.grow}>
                      <Text style={[styles.infoTitle, { color: colors.ink }]}>{infoTracker.name}</Text>
                      <Text style={[styles.infoGroup, { color: colors.muted }]}>{trackerGroupLabel(infoTracker)}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setInfoTracker(null)} hitSlop={8} style={styles.infoClose}>
                      <Ionicons name="close" size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                  <Text translate={false} style={[styles.infoDescription, { color: colors.ink }]}>{t(infoTracker.description)}</Text>
                  <View style={styles.infoMetaRow}>
                    <View style={[styles.infoMeta, { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name={trackedSelected.includes(infoTracker.templateId) ? "flag" : "albums-outline"} size={13} color={accent} />
                      <Text style={[styles.infoMetaText, { color: accent }]}>
                        {trackedSelected.includes(infoTracker.templateId) ? "Counts as a daily goal" : "Available for reference"}
                      </Text>
                    </View>
                    {infoTarget ? (
                      <View style={[styles.infoMeta, { backgroundColor: colors.canvas }]}>
                        <Ionicons name="locate-outline" size={13} color={colors.muted} />
                        <Text translate={false} style={[styles.infoMetaText, { color: colors.muted }]}>{infoTarget}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => setInfoTracker(null)} style={[styles.infoDone, { backgroundColor: accent }]}>
                    <Text preserveColor style={styles.infoDoneText}>Got it</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Modal>
          <View style={styles.footer}>
            {step > 0 ? (
              <Pressable
                disabled={finishing}
                accessibilityRole="button"
                 onPress={() => setStep((value) => Math.max(0, value - 1) as 0 | 1 | 2 | 3)}
                style={styles.back}
              >
                <Text style={[styles.backText, { color: colors.muted }]}>Back</Text>
              </Pressable>
            ) : (
              <Pressable disabled={finishing} accessibilityRole="button" onPress={() => void skipSetup()} style={styles.back}>
                <Text style={[styles.backText, { color: colors.muted }]}>Skip</Text>
              </Pressable>
            )}
            <View style={styles.next}>
              <Button
                label={step === 4 ? "Start using HabHub" : "Continue"}
                disabled={finishing || !displayName.trim() || (step === 2 && goals.includes("weight") && (!targetIsValid || !weeklyChangeIsValid))}
                loading={finishing}
                onPress={() => void continueFlow()}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MetricSummaryCard({ item, selected, tracked, width, onShowInfo, onToggle, onToggleTracked }: { item: TrackerPreset; selected: boolean; tracked: boolean; width: "31.5%" | "48.5%" | "100%"; onShowInfo: () => void; onToggle: () => void; onToggleTracked: () => void }) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const canTrack = item.goalEnabled !== false && !NOT_DAILY_GOALS.has(item.templateId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`About ${item.name}`)}
      accessibilityHint={t(item.description)}
      onPress={onShowInfo}
      style={({ pressed }) => [styles.metricCard, { width, backgroundColor: colors.card, borderColor: selected ? `${accent}88` : colors.border, opacity: selected ? 1 : 0.55 }, pressed && styles.pressed]}
    >
      <View style={[styles.metricIcon, { backgroundColor: `${item.color}18` }]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={17} color={item.color} /></View>
      <View style={styles.grow}><Text style={[styles.metricName, { color: colors.ink }]}>{item.name}</Text><Text style={[styles.metricState, { color: colors.muted }]}>{tracked ? "Daily goal" : "Available"}</Text></View>
      <View style={styles.trackerActions}>
        {canTrack ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: tracked }} accessibilityLabel={tracked ? `Remove ${item.name} from daily tracked goals` : `Add ${item.name} to daily tracked goals`} hitSlop={7} onPress={(event) => { event.stopPropagation(); onToggleTracked(); }} style={[styles.miniFlag, { backgroundColor: tracked ? colors.primarySoft : colors.canvas }]}><Ionicons name={tracked ? "flag" : "flag-outline"} size={13} color={tracked ? accent : colors.faint} /></Pressable> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${selected ? "Remove" : "Add"} ${item.name}`} hitSlop={7} onPress={(event) => { event.stopPropagation(); onToggle(); }} style={styles.metricCheck}><Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={18} color={selected ? accent : colors.faint} /></Pressable>
      </View>
    </Pressable>
  );
}

function Title({ title, copy, colors }: { title: string; copy: string; colors: ReturnType<typeof useAppColors> }) { return <><Text style={[styles.title, { color: colors.ink }]}>{title}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{copy}</Text></>; }
function Legend({ icon, label, color, colors }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; colors: ReturnType<typeof useAppColors> }) { return <View style={styles.legendItem}><Ionicons name={icon} size={15} color={color} /><Text style={[styles.legendText, { color: colors.muted }]}>{label}</Text></View>; }
function SetupStat({ value, label, colors }: { value: number; label: string; colors: ReturnType<typeof useAppColors> }) { return <View style={styles.setupStat}><Text translate={false} style={[styles.setupValue, { color: colors.ink }]}>{value}</Text><Text style={[styles.setupLabel, { color: colors.muted }]}>{label}</Text></View>; }
function Field({ label, value, set, colors }: { label: string; value: string; set: (value: string) => void; colors: ReturnType<typeof useAppColors> }) { return <View style={styles.grow}><Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text><TextInput value={value} onChangeText={set} keyboardType="decimal-pad" style={[styles.input, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} /></View>; }

function PermissionCard({ icon, title, copy, done, action, colors, accent }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; done: boolean; action: () => void; colors: ReturnType<typeof useAppColors>; accent: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${done ? "Connected" : "Set up"}`} onPress={action} style={({ pressed }) => [styles.permission, { backgroundColor: colors.card, borderColor: done ? accent : colors.border }, pressed && styles.pressed]}><View style={[styles.goalIcon, { backgroundColor: `${accent}18` }]}><Ionicons name={icon} size={22} color={accent} /></View><View style={styles.grow}><Text style={[styles.goalTitle, { color: colors.ink }]}>{title}</Text><Text style={[styles.goalCopy, { color: colors.muted }]}>{copy}</Text></View><Text style={[styles.done, { color: done ? accent : colors.muted }]}>{done ? "Connected" : "Set up"}</Text></Pressable>;
}

function ModeChoice({ icon, title, copy, badge, onPress, colors, accent }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; badge: string; onPress: () => void; colors: ReturnType<typeof useAppColors>; accent: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${copy}`} onPress={onPress} style={({ pressed }) => [styles.modeChoice, { backgroundColor: colors.card, borderColor: badge === "RECOMMENDED" ? accent : colors.border }, pressed && styles.pressed]}><View style={styles.modeChoiceTop}><View style={[styles.modeChoiceIcon, { backgroundColor: `${accent}18` }]}><Ionicons name={icon} size={24} color={accent} /></View><View style={[styles.modeBadge, { backgroundColor: badge === "RECOMMENDED" ? accent : colors.primarySoft }]}><Text preserveColor={badge === "RECOMMENDED"} style={[styles.modeBadgeText, { color: badge === "RECOMMENDED" ? palette.white : accent }]}>{badge}</Text></View></View><Text style={[styles.modeChoiceTitle, { color: colors.ink }]}>{title}</Text><Text style={[styles.modeChoiceCopy, { color: colors.muted }]}>{copy}</Text><View style={styles.modeChoiceAction}><Text style={[styles.modeChoiceActionText, { color: accent }]}>Continue</Text><Ionicons name="arrow-forward" size={16} color={accent} /></View></Pressable>;
}

function TodayPreference({ icon, title, copy, value, onValueChange, colors, accent }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; value: boolean; onValueChange: (value: boolean) => void; colors: ReturnType<typeof useAppColors>; accent: string }) {
  return <View style={[styles.todayPreference, { backgroundColor: colors.card, borderColor: value ? `${accent}88` : colors.border }]}><View style={[styles.goalIcon, { backgroundColor: `${accent}18` }]}><Ionicons name={icon} size={21} color={accent} /></View><View style={styles.grow}><Text style={[styles.goalTitle, { color: colors.ink }]}>{title}</Text><Text style={[styles.goalCopy, { color: colors.muted }]}>{copy}</Text></View><Switch accessibilityLabel={`Show ${title} on Today`} value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: `${accent}88` }} thumbColor={value ? accent : colors.faint} /></View>;
}

function TourChoice({ selected, icon, title, copy, onPress }: { selected: boolean; icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; onPress: () => void }) {
  const colors = useAppColors(); const accent = useGroupAccent();
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.tourChoice, { backgroundColor: colors.card, borderColor: selected ? accent : colors.border }, pressed && styles.pressed]}><View style={[styles.goalIcon, { backgroundColor: `${accent}18` }]}><Ionicons name={icon} size={21} color={accent} /></View><View style={styles.grow}><Text style={[styles.goalTitle, { color: colors.ink }]}>{title}</Text><Text style={[styles.goalCopy, { color: colors.muted }]}>{copy}</Text></View><Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={21} color={selected ? accent : colors.faint} /></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }, loadingText: { fontSize: 10, fontWeight: "800" }, welcomeContent: { width: "100%", maxWidth: 760, alignSelf: "center", flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32 }, welcomeMark: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 18 }, welcomeEyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.6, marginBottom: 7 }, welcomeTitle: { maxWidth: 620, fontSize: 31, lineHeight: 36, fontWeight: "900", letterSpacing: -0.9 }, welcomeCopy: { maxWidth: 620, fontSize: 12, lineHeight: 19, marginTop: 8 }, modeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 }, modeChoice: { flexGrow: 1, flexBasis: 260, minHeight: 178, borderWidth: 1, borderRadius: 22, padding: 16 }, modeChoiceTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }, modeChoiceIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" }, modeBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 }, modeBadgeText: { fontSize: 7, fontWeight: "900", letterSpacing: 0.5 }, modeChoiceTitle: { fontSize: 17, lineHeight: 21, fontWeight: "900", marginTop: 14 }, modeChoiceCopy: { fontSize: 10, lineHeight: 15, marginTop: 4 }, modeChoiceAction: { marginTop: "auto", paddingTop: 13, flexDirection: "row", alignItems: "center", gap: 5 }, modeChoiceActionText: { fontSize: 10, fontWeight: "900" }, welcomeNote: { maxWidth: 620, borderRadius: 14, padding: 11, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }, welcomeNoteText: { flex: 1, fontSize: 9, lineHeight: 13, fontWeight: "700" }, page: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 18, paddingBottom: 8 }, top: { height: 50, flexDirection: "row", alignItems: "center", gap: 9 }, mark: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" }, brand: { fontSize: 12, fontWeight: "900", letterSpacing: 1.5 }, step: { marginLeft: "auto", fontSize: 10, fontWeight: "800" }, modePill: { minHeight: 26, borderRadius: 999, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" }, modePillText: { fontSize: 8, fontWeight: "900" }, body: { flex: 1 }, bodyContent: { paddingTop: 15, paddingBottom: 16 }, title: { fontSize: 25, lineHeight: 30, fontWeight: "900", letterSpacing: -0.6 }, subtitle: { fontSize: 11, lineHeight: 17, marginTop: 5, marginBottom: 13 }, nameLabel: { fontSize: 11, fontWeight: "900", marginBottom: 6 }, input: { height: 41, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, fontSize: 12, fontWeight: "800", marginBottom: 8 }, defaultNotice: { flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderRadius: 15, marginBottom: 10 }, grow: { flex: 1, minWidth: 0 }, goalGrid: { gap: 7 }, goalChoice: { minHeight: 61, borderWidth: 1, borderRadius: 15, padding: 9, flexDirection: "row", alignItems: "center", gap: 9 }, goalIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center" }, goalTitle: { fontSize: 11, fontWeight: "900" }, goalCopy: { fontSize: 9, lineHeight: 13, marginTop: 2 }, pressed: { opacity: 0.72 }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 13, marginBottom: 9 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendText: { fontSize: 9, fontWeight: "800" }, setupStats: { minHeight: 65, borderWidth: 1, borderRadius: 16, flexDirection: "row", alignItems: "center", padding: 8, marginBottom: 12 }, setupStat: { flex: 1, alignItems: "center", gap: 2 }, setupValue: { fontSize: 19, fontWeight: "900" }, setupLabel: { fontSize: 8, fontWeight: "800" }, statDivider: { width: StyleSheet.hairlineWidth, height: 35 }, sectionLabel: { fontSize: 11, fontWeight: "900", marginTop: 8, marginBottom: 7 }, sectionHelp: { fontSize: 9, lineHeight: 13, marginTop: -3, marginBottom: 8 }, todayPreference: { minHeight: 66, borderWidth: 1, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 7 }, metricGroup: { marginBottom: 5 }, metricGroupLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4, marginBottom: 5 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 7, marginBottom: 9 }, metricCard: { minHeight: 57, borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: "row", alignItems: "center", gap: 7 }, metricIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" }, metricName: { fontSize: 9, lineHeight: 12, fontWeight: "900", flexShrink: 1 }, metricState: { fontSize: 7, fontWeight: "700", marginTop: 2 }, trackerActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }, miniFlag: { width: 23, height: 23, borderRadius: 8, alignItems: "center", justifyContent: "center" }, metricCheck: { width: 21, height: 23, alignItems: "center", justifyContent: "center" }, profileCard: { borderWidth: 1, borderRadius: 17, padding: 12, marginBottom: 9 }, fields: { flexDirection: "row", gap: 8 }, fieldLabel: { fontSize: 9, fontWeight: "800", marginBottom: 4 }, fieldGroupLabel: { fontSize: 10, fontWeight: "900", marginTop: 3, marginBottom: 6 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }, rateControls: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7 }, rateChips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 }, rateInputWrap: { width: 92, minHeight: 34, borderWidth: 1, borderRadius: 11, paddingHorizontal: 7, flexDirection: "row", alignItems: "center" }, rateInput: { flex: 1, minWidth: 0, paddingVertical: 5, fontSize: 10, fontWeight: "900", textAlign: "right" }, rateUnit: { marginLeft: 3, fontSize: 7, fontWeight: "800" }, weightEstimate: { minHeight: 32, borderRadius: 11, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 7 }, weightEstimateText: { flex: 1, fontSize: 9, lineHeight: 12, fontWeight: "800" }, validation: { fontSize: 9, fontWeight: "800", marginBottom: 7 }, permission: { minHeight: 76, borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9 }, done: { fontSize: 9, fontWeight: "900" }, importCard: { borderWidth: 1, borderRadius: 17, padding: 12, marginBottom: 9 }, switchRow: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, flexDirection: "row", alignItems: "center", gap: 10 }, readySummary: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 13, marginBottom: 7 }, tourChoice: { minHeight: 76, borderWidth: 1, borderRadius: 17, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }, switchCard: { minHeight: 58, borderWidth: 1, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 }, infoOverlay: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,14,24,.66)" }, infoCard: { width: "100%", maxWidth: 430, borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 }, infoHeading: { flexDirection: "row", alignItems: "center", gap: 10 }, infoIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" }, infoTitle: { fontSize: 16, lineHeight: 20, fontWeight: "900" }, infoGroup: { fontSize: 9, lineHeight: 12, fontWeight: "800", marginTop: 2 }, infoClose: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" }, infoDescription: { fontSize: 12, lineHeight: 18, fontWeight: "700" }, infoMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, infoMeta: { minHeight: 28, borderRadius: 10, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5 }, infoMetaText: { fontSize: 8, lineHeight: 11, fontWeight: "900" }, infoDone: { minHeight: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }, infoDoneText: { color: palette.white, fontSize: 11, fontWeight: "900" }, footer: { height: 58, flexDirection: "row", alignItems: "center", gap: 8 }, back: { padding: 11 }, backText: { fontSize: 11, fontWeight: "900" }, next: { flex: 1 },
  targetEditor: { borderWidth: 1, borderRadius: 16, marginTop: 4, overflow: "hidden" },
  targetEditorHeader: { minHeight: 52, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  targetRows: { paddingHorizontal: 10, paddingBottom: 8 },
  targetRow: { minHeight: 43, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 7 },
  targetName: { flex: 1, minWidth: 0, fontSize: 9, fontWeight: "900" },
  targetInput: { width: 68, height: 32, borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, textAlign: "right", fontSize: 10, fontWeight: "900" },
  targetUnit: { width: 35, fontSize: 8, fontWeight: "800" },
});
