import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState as NativeAppState,
  InteractionManager,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { createInitialState } from "@/src/data/seed";
import { entriesForMetric } from "@/src/domain/dataIndex";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  applyImportedFoodFastBreaks,
  endManualFast,
  reconcileAutomaticFasting,
  reinstateAutomaticFasting,
  startManualFast,
} from "@/src/domain/fasting";
import { metricEntryKey } from "@/src/domain/metricEntry";
import {
  editFoodEntryClockTime,
  preserveFoodEntryClockOverride,
} from "@/src/domain/food";
import { reconcileImportedHealthEntries } from "@/src/domain/health";
import {
  isDailyStepReplacementCandidate,
  manualStepEntriesEligibleForReplacement,
  preserveUnchangedDailyAggregateRevision,
  preserveUnchangedStepFallback,
} from "@/src/domain/healthDedup";
import {
  normalizeEnergyProfile,
  recommendedDailyDeficit,
  recommendedDailyIntake,
  recommendedDailyIntakeForDirection,
} from "@/src/domain/energy";
import {
  canBeTrackedGoal,
  effectiveGoalTarget,
  goalCelebrationTiming,
  goalReached,
  isMetricTrackedOnDate,
  safeMetricValue,
} from "@/src/domain/metrics";
import { randomMessage } from "@/src/domain/social";
import { defaultReminderTimes } from "@/src/domain/reminders";
import { upgradeStateV21 } from "@/src/domain/stateMigration";
import { formulaIdentifiers } from "@/src/domain/formula";
import { completedGymSets } from "@/src/domain/gym";
import {
  createPersonalSetupGroup,
  DEFAULT_GROUP_THEME,
  groupMetricDefinitions,
  isPersonalSetupGroup,
  personalSetupMetricConfiguration,
} from "@/src/domain/groupSetup";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import { palette } from "@/src/theme";
import { isCloudSyncPaused } from "@/src/cloud/syncGate";
import { HEALTH_STATUS_STORAGE_KEY } from "@/src/health/constants";
import { PersistedHealthStatus } from "@/src/health/types";
import { notifyProgressMilestones } from "@/src/notifications/push";
import {
  ActivityTimer,
  AppState,
  CalendarReminder,
  DashboardSection,
  EnergyProfile,
  EntryDetails,
  Group,
  GroupCreationOptions,
  GymPlan,
  GymSession,
  GymExerciseGoal,
  JournalNote,
  MetricDefinition,
  MetricEntry,
  MuscleGroup,
  NewMetric,
  PhotoUpdate,
  TodoItem,
  Visibility,
} from "@/src/types";

export const APP_STORAGE_KEY = "paceboard-state-v1";
const APP_ACCOUNT_STORAGE_KEY_PREFIX = "habhub-account-state-v1:";
const LOCAL_PERSIST_IDLE_MAX_WAIT_MS = 4_000;

/**
 * Reducer authorization for the one supported manual device-owned value.
 * The token is module-private and minted only at the context boundary after
 * the Log screen explicitly identifies its request.
 */
const LOG_MANUAL_STEPS_CAPABILITY = Symbol("log-manual-steps");
type LogManualStepsCapability = typeof LOG_MANUAL_STEPS_CAPABILITY;

type LogMetricRequest = {
  source: "log-ui";
  deviceOwnedMetric: "steps";
};

export function appAccountStorageKey(accountId: string) {
  return `${APP_ACCOUNT_STORAGE_KEY_PREFIX}${accountId}`;
}

export async function readPersistedAccountState(accountId: string) {
  try {
    const saved = await AsyncStorage.getItem(appAccountStorageKey(accountId));
    if (!saved) return null;
    const parsed = JSON.parse(saved) as AppState;
    return parsed.currentUserId === accountId ? parsed : null;
  } catch {
    return null;
  }
}

function stateForLocalPersistence(state: AppState): AppState {
  // Shared member history has its own bounded, per-group cache. Persisting it
  // again inside the monolithic app snapshot made JSON serialization grow with
  // every member and could block Android's JS thread after app switching. This
  // account boundary remains in force after leaving/switching a cloud group so
  // the previous group's values and signed photo URLs cannot survive there.
  return {
    ...state,
    entries: state.entries.filter(
      (entry) => entry.userId === state.currentUserId,
    ),
    photos: state.photos.filter(
      (photo) => photo.userId === state.currentUserId,
    ),
    messages: state.messages.filter(
      (message) => message.senderId === state.currentUserId,
    ),
    dailyMetricStatuses: state.dailyMetricStatuses.filter(
      (status) => status.userId === state.currentUserId,
    ),
  };
}

export function persistAppStateNow(state: AppState) {
  const serialized = JSON.stringify({
    ...stateForLocalPersistence(state),
    lastSavedAt: new Date().toISOString(),
  });
  // The legacy key remains the pointer used by the native background task.
  // The account-scoped copy is the recovery boundary that prevents signing
  // into another account (or a transient empty cloud read) from overwriting a
  // user's tracker/page/goal preferences with a clean starter shell.
  return AsyncStorage.multiSet([
    [APP_STORAGE_KEY, serialized],
    [appAccountStorageKey(state.currentUserId), serialized],
  ]);
}

/**
 * The native background task writes Health Connect rows directly to storage.
 * If the JS process stayed alive, merge those device-owned rows into memory on
 * resume before the foreground snapshot can overwrite them.
 */
function mergeBackgroundHealthRows(
  live: AppState,
  stored: AppState,
  importFromDate?: string,
) {
  if (stored.currentUserId !== live.currentUserId) return live;
  const storedHealth = stored.entries.filter(
    (entry) =>
      entry.userId === live.currentUserId &&
      // Step-fallback energy/distance/duration rows are calculated locally but
      // still carry the native provider. They are part of the same background
      // Health Connect transaction and must resume with the imported rows.
      Boolean(entry.sourceProvider),
  );
  const replacesBackgroundWindow = Boolean(
    importFromDate && /^\d{4}-\d{2}-\d{2}$/.test(importFromDate),
  );
  if (!storedHealth.length && !replacesBackgroundWindow) return live;
  const retainedLiveEntries = replacesBackgroundWindow
    ? live.entries.filter(
        (entry) =>
          !(
            entry.userId === live.currentUserId &&
            Boolean(entry.sourceProvider) &&
            entry.localDate >= importFromDate!
          ),
      )
    : live.entries;
  const byId = new Map(
    retainedLiveEntries.map((entry) => [`${entry.userId}:${entry.id}`, entry]),
  );
  let changed = retainedLiveEntries.length !== live.entries.length;
  storedHealth.forEach((entry) => {
    const key = `${entry.userId}:${entry.id}`;
    const current = byId.get(key);
    const currentRevision = current?.sourceUpdatedAt ?? current?.recordedAt ?? "";
    const storedRevision = entry.sourceUpdatedAt ?? entry.recordedAt;
    if (!current || storedRevision > currentRevision) {
      byId.set(key, entry);
      changed = true;
    }
  });
  return changed
    ? {
        ...live,
        entries: [...byId.values()].sort((left, right) =>
          left.recordedAt.localeCompare(right.recordedAt),
        ),
      }
    : live;
}

function sameOwnedRowsByReference<T extends { userId: string }>(
  left: T[],
  right: T[],
  userId: string,
) {
  return sameRowsByReference(
    left,
    right,
    (row) => row.userId === userId,
  );
}

function sameRowsByReference<T>(
  left: T[],
  right: T[],
  included: (row: T) => boolean,
) {
  if (left === right) return true;
  let leftIndex = 0;
  let rightIndex = 0;
  while (true) {
    while (leftIndex < left.length && !included(left[leftIndex]))
      leftIndex += 1;
    while (rightIndex < right.length && !included(right[rightIndex]))
      rightIndex += 1;
    const leftRow = left[leftIndex];
    const rightRow = right[rightIndex];
    if (!leftRow || !rightRow) return leftRow === rightRow;
    if (leftRow !== rightRow) return false;
    leftIndex += 1;
    rightIndex += 1;
  }
}

/**
 * Friend activity is cached separately by CloudSyncProvider. Avoid scheduling
 * a second monolithic app snapshot when only those transient rows changed.
 */
function localPersistenceChanged(previous: AppState, next: AppState) {
  if (previous === next) return false;
  if (
    previous.version !== next.version ||
    previous.currentUserId !== next.currentUserId ||
    previous.group !== next.group ||
    previous.groups !== next.groups ||
    previous.energyProfiles !== next.energyProfiles ||
    previous.metrics !== next.metrics ||
    previous.gymPlans !== next.gymPlans ||
    previous.gymSessions !== next.gymSessions ||
    previous.gymExerciseGoals !== next.gymExerciseGoals ||
    previous.todos !== next.todos ||
    previous.journalNotes !== next.journalNotes ||
    previous.calendarReminders !== next.calendarReminders ||
    previous.activityTimers !== next.activityTimers ||
    previous.activeTimer !== next.activeTimer ||
    previous.settings !== next.settings ||
    previous.trackedGoalPeriods !== next.trackedGoalPeriods ||
    previous.selectedGroupMetricId !== next.selectedGroupMetricId
  )
    return true;
  return !(
    sameOwnedRowsByReference(
      previous.entries,
      next.entries,
      next.currentUserId,
    ) &&
    sameOwnedRowsByReference(
      previous.dailyMetricStatuses,
      next.dailyMetricStatuses,
      next.currentUserId,
    ) &&
    sameOwnedRowsByReference(
      previous.photos,
      next.photos,
      next.currentUserId,
    ) &&
    sameRowsByReference(
      previous.messages,
      next.messages,
      (message) => message.senderId === next.currentUserId,
    )
  );
}

type Action =
  | {
      /** Internal: commit an already-reduced local state without re-running effects. */
      type: "replaceLocal";
      state: AppState;
    }
  | {
      type: "hydrate";
      state: AppState;
      preserveDeviceHealthSync?: boolean;
    }
  | {
      type: "log";
      metricId: string;
      value: number | boolean | string;
      visibility: Visibility;
      details?: EntryDetails;
      mode: "add" | "replace";
      manualDeviceEntryCapability?: LogManualStepsCapability;
    }
  | {
      type: "deviceScreenTime";
      samples: {
        localDate: string;
        minutes: number;
        recordedAt: string;
      }[];
    }
  | { type: "addMetric"; metric: NewMetric }
  | { type: "addMetrics"; metrics: NewMetric[] }
  | {
      type: "updateMetric";
      metricId: string;
      changes: Partial<MetricDefinition>;
    }
  | { type: "deleteMetric"; metricId: string }
  | { type: "deleteEntry"; entryId: string }
  | {
      type: "updateFoodEntryTime";
      entryId: string;
      clockTime: string;
      editedAt: string;
    }
  | { type: "skipGoal"; metricId: string; localDate: string }
  | { type: "deletePhoto"; photoId: string }
  | {
      type: "setMetricSection";
      metricId: string;
      section: DashboardSection;
      value: boolean;
      historyMode?: "today" | "history";
    }
  | {
      type: "setTrackedGoal";
      metricId: string;
      value: boolean;
      historyMode: "today" | "history";
      startDate?: string;
    }
  | {
      type: "configurePersonalMetrics";
      metrics: MetricDefinition[];
      trackedGoalIds: string[];
      historyMode: "today" | "history";
    }
  | {
      type: "updateGroupMetric";
      metricId: string;
      changes: Partial<MetricDefinition>;
    }
  | { type: "addGroupMetric"; metric: NewMetric }
  | { type: "addGroupMetrics"; metrics: NewMetric[] }
  | { type: "deleteGroupMetric"; metricId: string }
  | { type: "moveMetric"; metricId: string; direction: -1 | 1 }
  | { type: "reorderMetric"; metricId: string; targetIndex: number }
  | { type: "selectGroupMetric"; metricId: string }
  | {
      type: "addPhoto";
      uri: string;
      caption: string;
      visibility: Visibility;
      localDate?: string;
      capturedAt?: string;
    }
  | { type: "setPhotoVisibility"; photoId: string; visibility: Visibility }
  | {
      type: "sendMessage";
      text: string;
      conversationId: string;
      recipientId?: string;
      imageUri?: string;
    }
  | { type: "saveTodo"; todo: TodoItem }
  | { type: "deleteTodo"; todoId: string }
  | { type: "toggleTodo"; todoId: string; localDate: string }
  | { type: "skipTodo"; todoId: string; localDate: string }
  | { type: "reorderTodo"; todoId: string; targetIndex: number }
  | { type: "saveJournalNote"; note: JournalNote }
  | { type: "deleteJournalNote"; noteId: string }
  | { type: "saveCalendarReminder"; reminder: CalendarReminder }
  | { type: "deleteCalendarReminder"; reminderId: string }
  | { type: "activityTimer"; timer?: ActivityTimer; timerId?: string }
  | { type: "startFast"; metricId: string; at: string }
  | { type: "endFast"; metricId: string; at: string }
  | { type: "settings"; changes: Partial<AppState["settings"]> }
  | { type: "energyProfile"; changes: Partial<EnergyProfile> }
  | { type: "createGroup"; name: string; options?: GroupCreationOptions }
  | { type: "joinGroup"; code: string }
  | { type: "switchGroup"; groupId: string }
  | { type: "leaveGroup"; groupId: string }
  | { type: "nickname"; memberId: string; nickname: string }
  | { type: "groupName"; name: string }
  | { type: "groupRestDays"; value: number }
  | { type: "groupTheme"; color: string }
  | { type: "groupApproval"; value: boolean }
  | { type: "approveMember"; memberId: string }
  | { type: "removeMember"; memberId: string }
  | { type: "memberAvatar"; memberId: string; avatarUri?: string }
  | { type: "memberName"; memberId: string; name: string }
  | { type: "memberRole"; memberId: string; role: "admin" | "member" }
  | { type: "saveGymPlan"; plan: GymPlan }
  | { type: "deleteGymPlan"; planId: string }
  | { type: "saveGroupGymPlan"; plan: GymPlan }
  | { type: "deleteGroupGymPlan"; planId: string }
  | { type: "saveGymSession"; session: GymSession }
  | { type: "deleteGymSession"; sessionId: string }
  | { type: "gymExerciseGoal"; exerciseKey: string; goal: GymExerciseGoal }
  | {
      type: "importHealth";
      entries: MetricEntry[];
      provider: NonNullable<MetricEntry["sourceProvider"]>;
      metricIds: string[];
      fromDate: string;
      /** Final chunk lets onboarding history update goal starts exactly once. */
      finalizeInitialImport?: boolean;
      /** Manual history repair imports values without changing goal periods. */
      preserveTrackedGoalHistory?: boolean;
      /**
       * Successful daily aggregates replace only these imported tracker rows
       * inside the exact requested window. Manual rows are never removed.
       */
      aggregateReplacement?: {
        metricIds: string[];
        throughDate: string;
        removeStepFallbacks?: boolean;
      };
    }
  | { type: "reset" };

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function goalHistoryStart(state: AppState, metric: MetricDefinition) {
  const sourceIds =
    metric.dataType === "calculated"
      ? metric.id === "deficit"
        ? ["food"]
        : formulaIdentifiers(metric.formula ?? "").filter((id) =>
            state.metrics.some((candidate) => candidate.id === id),
          )
      : [metric.id];
  const ownDates = state.entries
    .filter((entry) => entry.userId === state.currentUserId)
    .filter((entry) => sourceIds.includes(entry.metricId))
    .map((entry) => entry.localDate);
  const photoDates =
    metric.dataType === "photo"
      ? state.photos
          .filter((photo) => photo.userId === state.currentUserId)
          .map((photo) => photo.localDate)
      : [];
  return [...ownDates, ...photoDates].sort()[0] ?? metric.activeFrom;
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function linkedBloodPressureIds(
  metrics: MetricDefinition[],
  metricId: string,
) {
  const target = metrics.find((metric) => metric.id === metricId);
  const ids = new Set([metricId]);
  if (target && isBloodPressureSystolic(target))
    metrics
      .filter(isBloodPressureDiastolic)
      .forEach((metric) => ids.add(metric.id));
  return ids;
}

function withoutMetricSelections(
  settings: AppState["settings"],
  removedIds: Set<string>,
): AppState["settings"] {
  const remove = (ids: string[]) => ids.filter((id) => !removedIds.has(id));
  return {
    ...settings,
    progressMetricIds: remove(settings.progressMetricIds),
    progressMetricOrderIds: remove(settings.progressMetricOrderIds ?? []),
    progressPinnedMetricIds: remove(settings.progressPinnedMetricIds ?? []),
    performanceMetricIds: settings.performanceMetricIds
      ? remove(settings.performanceMetricIds)
      : undefined,
    performanceMetricOrderIds: remove(
      settings.performanceMetricOrderIds ?? [],
    ),
    performancePinnedMetricIds: remove(
      settings.performancePinnedMetricIds ?? [],
    ),
    leaderboardMetricIdsByGroup: Object.fromEntries(
      Object.entries(settings.leaderboardMetricIdsByGroup).map(
        ([groupId, ids]) => [groupId, remove(ids)],
      ),
    ),
    leaderboardPinnedMetricIdsByGroup: settings.leaderboardPinnedMetricIdsByGroup
      ? Object.fromEntries(
          Object.entries(settings.leaderboardPinnedMetricIdsByGroup).map(
            ([groupId, ids]) => [groupId, remove(ids)],
          ),
        )
      : undefined,
    comparisonMetricIdsByGroup: Object.fromEntries(
      Object.entries(settings.comparisonMetricIdsByGroup).map(
        ([groupId, ids]) => [groupId, remove(ids)],
      ),
    ),
    notifications: {
      ...settings.notifications,
      metricIds: remove(settings.notifications.metricIds),
    },
  };
}

function withEnergyProfile(state: AppState, energyProfile: EnergyProfile) {
  const direction = state.settings.weightDirection ?? "lose";
  energyProfile = normalizeEnergyProfile(energyProfile);
  const weightKg = energyProfile.weightKg;
  const normalizedProfile: EnergyProfile = {
    ...energyProfile,
    weightKg,
    targetWeightKg:
      direction === "maintain"
        ? weightKg
        : direction === "lose"
          ? Math.min(energyProfile.targetWeightKg, Math.max(0.1, weightKg - 0.1))
          : Math.max(energyProfile.targetWeightKg, weightKg + 0.1),
    desiredWeeklyLossKg:
      direction === "maintain" ? 0 : energyProfile.desiredWeeklyLossKg,
  };
  const deficitTarget = recommendedDailyDeficit(normalizedProfile);
  const foodTarget = recommendedDailyIntakeForDirection(normalizedProfile, direction);
  return withPersonalMetrics(
    {
      ...state,
      settings: { ...state.settings, energyProfile: normalizedProfile },
      energyProfiles: {
        ...state.energyProfiles,
        [state.currentUserId]: normalizedProfile,
      },
    },
    state.metrics.map((metric) =>
      metric.id === "deficit"
        ? direction === "lose"
          ? { ...metric, name: "Daily deficit", formula: "bmr + daily_activity + exercise - food", goal: { kind: "at_least" as const, target: deficitTarget }, goalRange: undefined }
          : direction === "gain"
            ? { ...metric, name: "Daily surplus", formula: "food - bmr - daily_activity - exercise", goal: { kind: "at_least" as const, target: deficitTarget }, goalRange: undefined }
            : { ...metric, name: "Energy balance", formula: "food - bmr - daily_activity - exercise", goal: { kind: "exact" as const, target: 0 }, goalRange: { min: -150, max: 150 } }
        : metric.id === "food"
          ? {
              ...metric,
              goal: {
                kind:
                  direction === "gain"
                    ? ("at_least" as const)
                    : direction === "maintain"
                      ? ("exact" as const)
                      : ("at_most" as const),
                target: foodTarget,
              },
              goalRange: undefined,
            }
          : metric.id === "weight"
            ? {
                ...metric,
                goal: {
                  kind:
                    direction === "gain"
                      ? ("at_least" as const)
                      : direction === "maintain"
                        ? ("exact" as const)
                        : ("at_most" as const),
                  target: normalizedProfile.targetWeightKg,
                },
              }
            : metric,
    ),
  );
}

type BodyProfileNumericField =
  | "weightKg"
  | "bodyFatPercent"
  | "leanBodyMassKg";

const BODY_PROFILE_METRICS: readonly {
  field: BodyProfileNumericField;
  label?: string;
  metricId: "weight" | "body_fat" | "lean_body_mass";
}[] = [
  { field: "weightKg", label: "Profile weight", metricId: "weight" },
  { field: "bodyFatPercent", metricId: "body_fat" },
  {
    field: "leanBodyMassKg",
    metricId: "lean_body_mass",
  },
];

function entryOrder(entry: MetricEntry) {
  // recordedAt can be a sample/end-of-day timestamp in the future relative to
  // the moment a Health aggregate or profile value was actually updated.
  // sourceUpdatedAt keeps a newly logged/imported same-day composition value
  // authoritative without letting an older date replace today's profile.
  return `${entry.localDate}:${entry.sourceUpdatedAt ?? entry.recordedAt}`;
}

function latestNumericProfileEntry(
  entries: MetricEntry[],
  userId: string,
  metricId: string,
) {
  let latest: MetricEntry | undefined;
  for (const entry of entriesForMetric(entries, metricId, userId)) {
    if (
      typeof entry.value !== "number" ||
      !Number.isFinite(entry.value) ||
      entry.value <= 0
    )
      continue;
    if (!latest || entryOrder(entry) > entryOrder(latest)) latest = entry;
  }
  return latest;
}

/** Keep current private profile values aligned with the newest logged/imported measurements. */
function withLatestBodyProfileMeasurements(state: AppState) {
  const changes: Partial<EnergyProfile> = {};
  for (const mapping of BODY_PROFILE_METRICS) {
    const latest = latestNumericProfileEntry(
      state.entries,
      state.currentUserId,
      mapping.metricId,
    );
    if (latest) changes[mapping.field] = Number(latest.value);
  }
  if (!Object.keys(changes).length) return state;
  const candidate = normalizeEnergyProfile({
    ...state.settings.energyProfile,
    ...changes,
  });
  const changed = BODY_PROFILE_METRICS.some(
    (mapping) =>
      Object.prototype.hasOwnProperty.call(changes, mapping.field) &&
      candidate[mapping.field] !== state.settings.energyProfile[mapping.field],
  );
  return changed ? withEnergyProfile(state, candidate) : state;
}

function withPersonalMetrics(
  state: AppState,
  metrics: MetricDefinition[],
): AppState {
  return syncPersonalSetupGroup({ ...state, metrics });
}

function syncPersonalSetupGroup(state: AppState): AppState {
  const activeIsPersonal = isPersonalSetupGroup(state.group);
  if (
    !activeIsPersonal &&
    !state.groups.some((group) => isPersonalSetupGroup(group))
  )
    return state;
  const metricConfiguration = personalSetupMetricConfiguration(
    state.metrics,
    state.trackedGoalPeriods,
  );
  const group = activeIsPersonal
    ? { ...state.group, metricConfiguration }
    : state.group;
  return {
    ...state,
    group,
    groups: state.groups.map((candidate) =>
      isPersonalSetupGroup(candidate)
        ? { ...candidate, metricConfiguration }
        : candidate,
    ),
    selectedGroupMetricId: activeIsPersonal
      ? metricConfiguration.some(
          (metric) => metric.id === state.selectedGroupMetricId,
        )
        ? state.selectedGroupMetricId
        : (metricConfiguration[0]?.id ?? "__score")
      : state.selectedGroupMetricId,
  };
}

function hasShareableGoalEvidence(
  state: AppState,
  metric: MetricDefinition,
  localDate: string,
) {
  const entries = state.entries.filter(
    (entry) =>
      entry.userId === state.currentUserId &&
      entry.localDate === localDate &&
      entry.visibility !== "private",
  );
  if (metric.dataType !== "calculated")
    return entries.some((entry) => entry.metricId === metric.id);
  if (metric.defaultVisibility === "private") return false;
  const dependencies = new Set(
    metric.formula?.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [],
  );
  return entries.some((entry) => dependencies.has(entry.metricId));
}

function finalizeEndOfDayGoals(state: AppState, localDate: string): AppState {
  if (
    !state.settings.autoMessages ||
    state.settings.banterTone === "off" ||
    localDate >= dateKey()
  )
    return state;
  const messages = state.metrics
    .filter(
      (metric) =>
        metric.goalEnabled !== false &&
        metric.dataType !== "text" &&
        goalCelebrationTiming(metric) === "end_of_day" &&
        isMetricTrackedOnDate(state, metric, localDate) &&
        hasShareableGoalEvidence(state, metric, localDate),
    )
    .filter((metric) =>
      goalReached(
        metric,
        safeMetricValue(state, metric, state.currentUserId, localDate),
        effectiveGoalTarget(state, metric, state.currentUserId, localDate),
      ),
    )
    .filter(
      (metric) =>
        !state.messages.some(
          (message) =>
            message.id ===
            `auto-goal:${state.group.id}:${state.currentUserId}:${localDate}:${metric.id}`,
        ),
    )
    .map((metric) => ({
      id: `auto-goal:${state.group.id}:${state.currentUserId}:${localDate}:${metric.id}`,
      groupId: state.group.id,
      senderId: "system",
      conversationId: `group:${state.group.id}`,
      kind: "cheer" as const,
      text: `${randomMessage("cheer", state.settings.banterTone)} Yesterday's ${metric.name.toLowerCase()} goal was met!`,
      createdAt: new Date().toISOString(),
    }));
  return messages.length
    ? { ...state, messages: [...state.messages, ...messages] }
    : state;
}

function markGroupConfigurationPending(
  previous: AppState,
  next: AppState,
): AppState {
  if (!isCloudGroupId(next.group.id)) return next;
  const pending = new Set(
    previous.settings.pendingGroupConfigurationIds ?? [],
  );
  pending.add(next.group.id);
  return {
    ...next,
    settings: {
      ...next.settings,
      pendingGroupConfigurationIds: [...pending],
    },
  };
}

/**
 * Every local reducer path shares one deletion outbox. This prevents generated
 * rows (fasting, gym, Health Connect replacements, and future calculated
 * trackers) from bypassing cloud deletion bookkeeping simply because they do
 * not use the explicit delete-entry action.
 */
function withLocalDeletionTombstones(
  previous: AppState,
  next: AppState,
): AppState {
  if (previous.currentUserId !== next.currentUserId) return next;
  const entriesChanged = previous.entries !== next.entries;
  const photosChanged = previous.photos !== next.photos;
  // Most local actions only update settings, todos, timers, or another small
  // collection. Their reducers preserve the entries/photos array references,
  // which is definitive proof that no deletion tombstone can have changed.
  // Avoid walking a year of Health Connect rows on the originating tap.
  if (!entriesChanged && !photosChanged) return next;

  const changedOwnedIds = <T extends { id: string; userId: string }>(
    previousItems: T[],
    nextItems: T[],
    changed: boolean,
  ) => {
    if (!changed)
      return { removed: [] as string[], added: new Set<string>() };
    const previousIds = new Set<string>();
    const nextIds = new Set<string>();
    for (const item of previousItems)
      if (item.userId === previous.currentUserId) previousIds.add(item.id);
    for (const item of nextItems)
      if (item.userId === next.currentUserId) nextIds.add(item.id);
    const removed: string[] = [];
    const added = new Set<string>();
    previousIds.forEach((id) => {
      if (!nextIds.has(id)) removed.push(id);
    });
    nextIds.forEach((id) => {
      if (!previousIds.has(id)) added.add(id);
    });
    return { removed, added };
  };
  const entryChanges = changedOwnedIds(
    previous.entries,
    next.entries,
    entriesChanged,
  );
  const photoChanges = changedOwnedIds(
    previous.photos,
    next.photos,
    photosChanged,
  );
  const removedEntryIds = entryChanges.removed;
  const addedEntryIds = entryChanges.added;
  const removedPhotoIds = photoChanges.removed;
  const addedPhotoIds = photoChanges.added;
  if (
    !removedEntryIds.length &&
    !removedPhotoIds.length &&
    !addedEntryIds.size &&
    !addedPhotoIds.size
  )
    return next;
  const reconcileTombstones = (
    existing: string[] | undefined,
    removed: string[],
    added: Set<string>,
  ) =>
    [...new Set([...(existing ?? []), ...removed])].filter(
      (id) => !added.has(id),
    );
  return {
    ...next,
    settings: {
      ...next.settings,
      pendingDeletedEntryIds: reconcileTombstones(
        next.settings.pendingDeletedEntryIds,
        removedEntryIds,
        addedEntryIds,
      ),
      deletedEntryIds: reconcileTombstones(
        next.settings.deletedEntryIds,
        removedEntryIds,
        addedEntryIds,
      ),
      pendingDeletedPhotoIds: reconcileTombstones(
        next.settings.pendingDeletedPhotoIds,
        removedPhotoIds,
        addedPhotoIds,
      ),
      deletedPhotoIds: reconcileTombstones(
        next.settings.deletedPhotoIds,
        removedPhotoIds,
        addedPhotoIds,
      ),
    },
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "replaceLocal":
      return action.state;
    case "hydrate": {
      // Health Connect authorization and its import cursor belong to this
      // physical device. A delayed cloud/group refresh for the same account
      // must never replace them with the deliberately disconnected values in
      // the portable cloud snapshot.
      const incoming =
        action.preserveDeviceHealthSync &&
        action.state.currentUserId === state.currentUserId
          ? {
              ...action.state,
              settings: {
                ...action.state.settings,
                healthSync: state.settings.healthSync,
                healthHistoryDays: state.settings.healthHistoryDays,
                syncMode: state.settings.syncMode,
              },
            }
          : action.state;
      // Completing onboarding is monotonic for the current account. A delayed
      // cloud snapshot must never send a user back into the startup flow.
      const hydrated =
        incoming.currentUserId === state.currentUserId
          ? {
              ...incoming,
              settings: {
                ...incoming.settings,
                onboardingComplete:
                  state.settings.onboardingComplete ||
                  incoming.settings.onboardingComplete,
                onboardingVersion: Math.max(
                  state.settings.onboardingVersion ?? 0,
                  incoming.settings.onboardingVersion ?? 0,
                ),
                tutorialComplete:
                  state.settings.tutorialComplete ||
                  incoming.settings.tutorialComplete,
                advancedTutorialComplete:
                  state.settings.advancedTutorialComplete ||
                  incoming.settings.advancedTutorialComplete,
              },
            }
          : incoming;
      return finalizeEndOfDayGoals(
        hydrated,
        dateWithOffsetFrom(dateKey(), -1),
      );
    }
    case "log": {
      const localDate = action.details?.localDate ?? dateKey();
      const metric = state.metrics.find(
        (candidate) => candidate.id === action.metricId,
      );
      // Device-owned rows remain reducer-protected even if a caller bypasses
      // the native UI or a malformed cloud definition flips manualEntry.
      // Only the provider-minted Log capability can replace daily Steps.
      const authorizedManualSteps =
        metric?.id === "steps" &&
        action.mode === "replace" &&
        typeof action.value === "number" &&
        Number.isFinite(action.value) &&
        action.value >= 0 &&
        action.manualDeviceEntryCapability ===
          LOG_MANUAL_STEPS_CAPABILITY;
      if (
        (metric?.id === "steps" || metric?.manualEntry === false) &&
        !authorizedManualSteps
      )
        return state;
      const previousValue = metric
        ? safeMetricValue(state, metric, state.currentUserId, localDate)
        : 0;
      const replacementCandidates =
        action.mode === "replace"
          ? state.entries.filter(
              (entry) =>
                entry.userId === state.currentUserId &&
                entry.metricId === action.metricId &&
                entry.localDate === localDate,
            )
          : [];
      // Manual Steps may coexist with a phone aggregate in storage.
      // Editing it replaces only provenance-free manual rows. In particular,
      // an imported row is neither removed locally nor sent to the deletion
      // outbox. The newest manual/device revision controls the displayed daily
      // total, so a later device sync can safely reclaim authority.
      const entriesToReplace = authorizedManualSteps
        ? manualStepEntriesEligibleForReplacement(replacementCandidates)
        : replacementCandidates;
      const replacedEntries = new Set(entriesToReplace);
      const cleanedEntries = replacedEntries.size
        ? state.entries.filter((entry) => !replacedEntries.has(entry))
        : state.entries;
      const replacedEntryIds = entriesToReplace.map((entry) => entry.id);
      const changedAt = new Date().toISOString();
      let nextState: AppState = {
        ...state,
        settings: replacedEntryIds.length
          ? {
              ...state.settings,
              pendingDeletedEntryIds: [
                ...new Set([
                  ...(state.settings.pendingDeletedEntryIds ?? []),
                  ...replacedEntryIds,
                ]),
              ],
              deletedEntryIds: [
                ...new Set([
                  ...(state.settings.deletedEntryIds ?? []),
                  ...replacedEntryIds,
                ]),
              ],
            }
          : state.settings,
        entries: [
          ...cleanedEntries,
          {
            id: uniqueId("entry"),
            metricId: action.metricId,
            userId: state.currentUserId,
            value: action.value,
            visibility: action.visibility,
            note: action.details?.note,
            label: action.details?.label,
            imageUri: action.details?.imageUri,
            localDate,
            recordedAt: action.details?.recordedAt ?? changedAt,
            source: "manual",
            sourceUpdatedAt: changedAt,
            nutrition: action.details?.nutrition,
            submetricValues: action.details?.submetricValues,
          },
        ],
      };
      const addedEntry = nextState.entries.at(-1)!;
      if (metric?.id === "food")
        nextState = reconcileAutomaticFasting(nextState, [addedEntry]);
      else if (metric?.fastingSettings)
        nextState = reconcileAutomaticFasting(
          nextState,
          undefined,
          metric.id,
        );
      const bodyProfileMapping = BODY_PROFILE_METRICS.find(
        (mapping) => mapping.metricId === metric?.id,
      );
      if (
        bodyProfileMapping &&
        typeof action.value === "number" &&
        Number.isFinite(action.value)
      ) {
        const previousLatest = latestNumericProfileEntry(
          state.entries,
          state.currentUserId,
          bodyProfileMapping.metricId,
        );
        if (!previousLatest || entryOrder(addedEntry) >= entryOrder(previousLatest))
          nextState = withEnergyProfile(nextState, {
            ...state.settings.energyProfile,
            [bodyProfileMapping.field]: action.value,
          });
      }
      if (
        metric &&
        goalCelebrationTiming(metric) === "immediate" &&
        state.settings.autoMessages &&
        state.settings.banterTone !== "off" &&
        action.visibility !== "private" &&
        !goalReached(
          metric,
          previousValue,
          effectiveGoalTarget(state, metric, state.currentUserId, localDate),
        ) &&
        goalReached(
          metric,
          safeMetricValue(nextState, metric, state.currentUserId, localDate),
          effectiveGoalTarget(
            nextState,
            metric,
            state.currentUserId,
            localDate,
          ),
        )
      ) {
        nextState.messages = [
          ...nextState.messages,
          {
            id: uniqueId("auto"),
            groupId: state.group.id,
            senderId: "system",
            conversationId: `group:${state.group.id}`,
            kind: "cheer",
            text: `${randomMessage("cheer", state.settings.banterTone)} ${metric.name} goal reached!`,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return localDate < dateKey()
        ? finalizeEndOfDayGoals(nextState, localDate)
        : nextState;
    }
    case "deviceScreenTime": {
      const metric = state.metrics.find((candidate) => candidate.id === "screen_time");
      if (!metric) return state;
      const samples = new Map(
        action.samples
          .filter(
            (sample) =>
              /^\d{4}-\d{2}-\d{2}$/.test(sample.localDate) &&
              Number.isFinite(sample.minutes),
          )
          .map((sample) => [sample.localDate, sample] as const),
      );
      if (!samples.size) return state;
      const entries: MetricEntry[] = [...samples.values()].map((sample) => {
        const id = `screen-time:${state.currentUserId}:${sample.localDate}`;
        return {
          id,
          metricId: metric.id,
          userId: state.currentUserId,
          value: Math.max(0, Math.min(1_440, sample.minutes)),
          localDate: sample.localDate,
          recordedAt: sample.recordedAt,
          visibility: "private",
          source: "imported",
          sourceOrigin: "android_usage_stats",
          sourceRecordId: id,
          sourceUpdatedAt: sample.recordedAt,
        };
      });
      return {
        ...state,
        entries: [
          ...state.entries.filter(
            (candidate) =>
              !(
                candidate.userId === state.currentUserId &&
                candidate.metricId === metric.id &&
                samples.has(candidate.localDate) &&
                candidate.sourceOrigin === "android_usage_stats"
              ),
          ),
          ...entries,
        ],
      };
    }
    case "addMetric": {
      const {
        trackGoal = false,
        addToToday = true,
        ...definition
      } = action.metric;
      const baseId =
        (action.metric.templateId ?? slugify(action.metric.name)) || "metric";
      let id = baseId;
      let suffix = 2;
      while (state.metrics.some((metric) => metric.id === id))
        id = `${baseId}_${suffix++}`;
      const internalCompanion =
        baseId === "blood_pressure_diastolic" ||
        (action.metric.healthMapping?.dataType === "blood_pressure" &&
          action.metric.healthMapping.field === "diastolic");
      const gymMapping =
        definition.gymMapping ??
        (definition.category === "gym" && definition.dataType === "number"
          ? {
              kind: "exercise_one_rep_max" as const,
              exerciseKey: `personal:${state.currentUserId}:${id}`,
            }
          : undefined);
      const metric: MetricDefinition = {
        ...definition,
        id,
        gymMapping,
        manualEntry: gymMapping ? false : definition.manualEntry,
        unit:
          gymMapping?.kind === "exercise_one_rep_max" && !definition.unit
            ? "kg e1RM"
            : definition.unit,
        aggregation:
          action.metric.aggregation ??
          (action.metric.dataType === "boolean"
            ? "max"
            : action.metric.dataType === "text" ||
                action.metric.dataType === "calculated"
              ? "latest"
              : "sum"),
        scoreWeight: 0,
        sections: internalCompanion
          ? { today: false, group: false, insights: false }
          : {
              today: trackGoal || addToToday,
              group: true,
              insights: true,
            },
        order: state.metrics.length,
        activeFrom: action.metric.activeFrom ?? dateKey(),
      };
      delete (metric as MetricDefinition & { templateId?: string }).templateId;
      const next = withPersonalMetrics(state, [...state.metrics, metric]);
      return {
        ...next,
        trackedGoalPeriods: {
          ...state.trackedGoalPeriods,
          [id]:
            trackGoal && !internalCompanion
              ? [{ from: metric.activeFrom }]
              : [],
        },
      };
    }
    case "updateMetric": {
      const previousMetric = state.metrics.find(
        (metric) => metric.id === action.metricId,
      );
      const automaticFastingWasEnabled =
        previousMetric?.fastingSettings?.automaticFoodBreak === true;
      const automaticFastingIsEnabled =
        action.changes.fastingSettings?.automaticFoodBreak === true;
      let next = withPersonalMetrics(
        state,
        state.metrics.map((metric) =>
          metric.id === action.metricId
            ? (() => {
                const updated = {
                  ...metric,
                  ...action.changes,
                  activeFrom:
                    action.changes.activeFrom ??
                    (action.changes.scoreWeight !== undefined &&
                    action.changes.scoreWeight > 0 &&
                    metric.scoreWeight <= 0
                      ? dateKey()
                      : metric.activeFrom),
                };
                return updated.category === "gym" &&
                  updated.dataType === "number" &&
                  !updated.gymMapping
                  ? {
                      ...updated,
                      gymMapping: {
                        kind: "exercise_one_rep_max" as const,
                        exerciseKey: `personal:${state.currentUserId}:${metric.id}`,
                      },
                      manualEntry: false,
                      unit: updated.unit || "kg e1RM",
                    }
                  : updated;
              })()
            : metric,
          ),
      );
      if (action.changes.defaultVisibility) {
        const changedAt = new Date().toISOString();
        const privacyFenceRequired =
          previousMetric?.defaultVisibility === "group" &&
          action.changes.defaultVisibility !== "group" &&
          isCloudGroupId(state.group.id);
        const pendingFencesByGroup = {
          ...(next.settings.pendingMetricPrivacyFenceIdsByGroup ?? {}),
        };
        if (privacyFenceRequired) {
          pendingFencesByGroup[state.group.id] = [
            ...new Set([
              ...(pendingFencesByGroup[state.group.id] ?? []),
              action.metricId,
            ]),
          ];
        } else if (
          action.changes.defaultVisibility === "group" &&
          isCloudGroupId(state.group.id)
        ) {
          const remaining = (pendingFencesByGroup[state.group.id] ?? []).filter(
            (metricId) => metricId !== action.metricId,
          );
          if (remaining.length) pendingFencesByGroup[state.group.id] = remaining;
          else delete pendingFencesByGroup[state.group.id];
        }
        next = {
          ...next,
          entries: next.entries.map((entry) =>
            entry.userId === state.currentUserId &&
            entry.metricId === action.metricId
              ? {
                  ...entry,
                  visibility: action.changes.defaultVisibility!,
                  sourceUpdatedAt: changedAt,
                }
              : entry,
          ),
          dailyMetricStatuses: next.dailyMetricStatuses.map((status) =>
            status.userId === state.currentUserId &&
            status.metricId === action.metricId
              ? {
                  ...status,
                  visibility: action.changes.defaultVisibility!,
                }
              : status,
          ),
          photos:
            action.metricId === "progress_photo"
              ? next.photos.map((photo) =>
                  photo.userId === state.currentUserId
                    ? {
                        ...photo,
                        visibility: action.changes.defaultVisibility!,
                      }
                    : photo,
                )
              : next.photos,
          settings: {
            ...next.settings,
            pendingMetricPrivacyFenceIdsByGroup: pendingFencesByGroup,
          },
        };
      }
      if (
        previousMetric?.fastingSettings &&
        !automaticFastingWasEnabled &&
        automaticFastingIsEnabled
      )
        next = reinstateAutomaticFasting(next, action.metricId);
      if (previousMetric?.fastingSettings)
        next = reconcileAutomaticFasting(
          next,
          undefined,
          action.metricId,
        );
      if (!action.changes.activeFrom || !(state.trackedGoalPeriods[action.metricId]?.length))
        return next;
      return {
        ...next,
        trackedGoalPeriods: {
          ...next.trackedGoalPeriods,
          [action.metricId]: [{ from: action.changes.activeFrom }],
        },
      };
    }
    case "deleteMetric": {
      const removedIds = linkedBloodPressureIds(
        state.metrics,
        action.metricId,
      );
      const removedEntryIds = state.entries
        .filter(
          (entry) =>
            entry.userId === state.currentUserId &&
            removedIds.has(entry.metricId),
        )
        .map((entry) => entry.id);
      return {
        ...withPersonalMetrics(
          state,
          state.metrics
            .filter((metric) => !removedIds.has(metric.id))
            .map((metric, order) => ({ ...metric, order })),
        ),
        entries: state.entries.filter(
          (entry) =>
            entry.userId !== state.currentUserId ||
            !removedIds.has(entry.metricId),
        ),
        trackedGoalPeriods: Object.fromEntries(
          Object.entries(state.trackedGoalPeriods).filter(
            ([metricId]) => !removedIds.has(metricId),
          ),
        ),
        settings: {
          ...withoutMetricSelections(state.settings, removedIds),
          pendingDeletedEntryIds: [
            ...new Set([
              ...(state.settings.pendingDeletedEntryIds ?? []),
              ...removedEntryIds,
            ]),
          ],
          deletedEntryIds: [
            ...new Set([
              ...(state.settings.deletedEntryIds ?? []),
              ...removedEntryIds,
            ]),
          ],
        },
        selectedGroupMetricId: removedIds.has(state.selectedGroupMetricId)
            ? "steps"
            : state.selectedGroupMetricId,
      };
    }
    case "deleteEntry":
      {
        const target = state.entries.find(
          (entry) => entry.id === action.entryId && entry.userId === state.currentUserId,
        );
        if (!target || target.source === "calculated") return state;
        const next: AppState = {
          ...state,
          entries: state.entries.filter(
            (entry) =>
              metricEntryKey(entry.userId, entry.id) !==
              metricEntryKey(state.currentUserId, action.entryId),
          ),
          settings: {
            ...state.settings,
            pendingDeletedEntryIds: [
              ...new Set([
                ...(state.settings.pendingDeletedEntryIds ?? []),
                target.id,
              ]),
            ],
            deletedEntryIds: [
              ...new Set([
                ...(state.settings.deletedEntryIds ?? []),
                target.id,
              ]),
            ],
            dismissedHealthEntryIds:
              target.source === "imported"
                ? [
                    ...new Set([
                      ...(state.settings.dismissedHealthEntryIds ?? []),
                      target.id,
                    ]),
                  ]
                : state.settings.dismissedHealthEntryIds,
          },
        };
        if (target.metricId === "food")
          return reconcileAutomaticFasting(next, [target]);
        return state.metrics.some(
          (metric) =>
            metric.id === target.metricId && Boolean(metric.fastingSettings),
        )
          ? reconcileAutomaticFasting(next, [target], target.metricId)
          : next;
      }
    case "updateFoodEntryTime": {
      const target = state.entries.find(
        (entry) =>
          entry.id === action.entryId && entry.userId === state.currentUserId,
      );
      if (!target) return state;
      const updated = editFoodEntryClockTime(
        target,
        state.currentUserId,
        action.clockTime,
        action.editedAt,
      );
      if (!updated || updated === target) return state;
      const next: AppState = {
        ...state,
        entries: state.entries.map((entry) =>
          metricEntryKey(entry.userId, entry.id) ===
          metricEntryKey(state.currentUserId, action.entryId)
            ? updated
            : entry,
        ),
      };
      return reconcileAutomaticFasting(next, [updated]);
    }
    case "skipGoal": {
      const metric = state.metrics.find((item) => item.id === action.metricId);
      if (!metric || metric.goalEnabled === false) return state;
      const id = `goal-skip:${state.currentUserId}:${metric.id}:${action.localDate}`;
      return {
        ...state,
        entries: [
          ...state.entries.filter(
            (entry) =>
              metricEntryKey(entry.userId, entry.id) !==
              metricEntryKey(state.currentUserId, id),
          ),
          {
            id,
            metricId: metric.id,
            userId: state.currentUserId,
            value: "skipped",
            localDate: action.localDate,
            recordedAt: new Date().toISOString(),
            visibility: metric.defaultVisibility,
            source: "manual",
            label: "Goal skipped",
            note: "Marked complete as a planned skip/rest day.",
          },
        ],
      };
    }
    case "deletePhoto": {
      const ownedPhoto = state.photos.some(
        (photo) =>
          photo.id === action.photoId && photo.userId === state.currentUserId,
      );
      return {
        ...state,
        settings: ownedPhoto
          ? {
              ...state.settings,
              pendingDeletedPhotoIds: [
                ...new Set([
                  ...(state.settings.pendingDeletedPhotoIds ?? []),
                  action.photoId,
                ]),
              ],
              deletedPhotoIds: [
                ...new Set([
                  ...(state.settings.deletedPhotoIds ?? []),
                  action.photoId,
                ]),
              ],
            }
          : state.settings,
        photos: state.photos.filter(
          (photo) =>
            photo.id !== action.photoId ||
            photo.userId !== state.currentUserId,
        ),
      };
    }
    case "addMetrics": {
      // Apply the whole ready-made selection to one in-memory snapshot. The
      // provider persists and renders only the final result, so a bulk add can
      // never leave a partially-created tracker list behind.
      const next = action.metrics.reduce(
        (current, metric) => reducer(current, { type: "addMetric", metric }),
        state,
      );
      const healthTypes = action.metrics.flatMap((metric) => [
        ...(metric.healthMapping?.dataType
          ? [metric.healthMapping.dataType]
          : []),
        ...(metric.submetrics ?? []).flatMap((submetric) =>
          submetric.healthMapping?.dataType
            ? [submetric.healthMapping.dataType]
            : [],
        ),
      ]);
      if (!healthTypes.length) return next;
      return {
        ...next,
        settings: {
          ...next.settings,
          healthSync: {
            ...next.settings.healthSync,
            dataTypes: {
              ...next.settings.healthSync.dataTypes,
              ...Object.fromEntries(healthTypes.map((type) => [type, true])),
            },
          },
        },
      };
    }
    case "setMetricSection": {
      const metric = state.metrics.find(
        (candidate) => candidate.id === action.metricId,
      );
      if (!metric) return state;
      if (action.value && !canBeTrackedGoal(metric)) return state;
      return withPersonalMetrics(
        state,
        state.metrics.map((metric) =>
          metric.id === action.metricId
            ? {
                ...metric,
                sections: {
                  ...metric.sections,
                  [action.section]: action.value,
                },
              }
            : metric,
        ),
      );
    }
    case "setTrackedGoal": {
      const metric = state.metrics.find(
        (candidate) => candidate.id === action.metricId,
      );
      if (!metric) return state;
      const metrics =
        action.value && metric.goalEnabled === false
          ? state.metrics.map((candidate) =>
              candidate.id === metric.id
                ? { ...candidate, goalEnabled: true }
                : candidate,
            )
          : state.metrics;
      const existing =
        state.trackedGoalPeriods?.[metric.id] ??
        (metric.sections.today ? [{ from: metric.activeFrom }] : []);
      if (action.value) {
        const historyStart = goalHistoryStart(state, metric);
        const periods =
          action.startDate
            ? [{ from: action.startDate }]
            : action.historyMode === "history"
            ? [{ from: historyStart }]
            : [{ from: dateKey() }];
        return syncPersonalSetupGroup({
          ...state,
          metrics: metrics.map((candidate) =>
            candidate.id === metric.id
                ? {
                    ...candidate,
                    activeFrom:
                      action.startDate ??
                      (action.historyMode === "history"
                        ? historyStart
                        : candidate.activeFrom),
                    goal:
                      candidate.id === "weekly_deficit_balance"
                        ? { kind: "at_least" as const, target: 0 }
                        : candidate.goal,
                  sections: { ...candidate.sections, today: true },
                }
              : candidate,
          ),
          trackedGoalPeriods: {
            ...state.trackedGoalPeriods,
            [metric.id]: periods,
          },
        });
      }
      if (action.historyMode === "history") {
        return syncPersonalSetupGroup({
          ...state,
          trackedGoalPeriods: { ...state.trackedGoalPeriods, [metric.id]: [] },
        });
      }
      const yesterday = dateWithOffsetFrom(dateKey(), -1);
      const periods = existing.flatMap((period) =>
        !period.to
          ? period.from <= yesterday
            ? [{ ...period, to: yesterday }]
            : []
          : [period],
      );
      return syncPersonalSetupGroup({
        ...state,
        trackedGoalPeriods: {
          ...state.trackedGoalPeriods,
          [metric.id]: periods,
        },
      });
    }
    case "configurePersonalMetrics": {
      const today = dateKey();
      const configuredState = { ...state, metrics: action.metrics };
      const trackedGoalIds = action.trackedGoalIds.filter((id) => {
        const metric = action.metrics.find((candidate) => candidate.id === id);
        return metric ? canBeTrackedGoal(metric) : false;
      });
      const metrics = action.metrics.map((metric, order) => ({
        ...metric,
        order,
        activeFrom: trackedGoalIds.includes(metric.id)
          ? action.historyMode === "history"
            ? goalHistoryStart(configuredState, metric)
            : today
          : today,
      }));
      return syncPersonalSetupGroup({
        ...state,
        metrics,
        trackedGoalPeriods: Object.fromEntries(
          metrics.map((metric) => [
            metric.id,
            trackedGoalIds.includes(metric.id)
              ? [{ from: metric.activeFrom }]
              : [],
          ]),
        ),
        selectedGroupMetricId: state.selectedGroupMetricId,
      });
    }
    case "updateGroupMetric": {
      const configuration = (state.group.metricConfiguration ?? []).map(
        (metric) => {
          if (metric.id !== action.metricId) return metric;
          const updated = { ...metric, ...action.changes };
          return updated.category === "gym" &&
            updated.dataType === "number" &&
            !updated.gymMapping
            ? {
                ...updated,
                gymMapping: {
                  kind: "exercise_one_rep_max" as const,
                  exerciseKey: `group:${state.group.id}:${metric.id}`,
                },
                gymMuscleGroups:
                  updated.gymMuscleGroups?.length
                    ? updated.gymMuscleGroups
                    : ["full_body" as MuscleGroup],
                manualEntry: false,
                unit: updated.unit || "kg e1RM",
              }
            : updated;
        },
      );
      const group = { ...state.group, metricConfiguration: configuration };
      const normalizedShared = configuration.find(
        (metric) => metric.id === action.metricId,
      );
      let metrics = state.metrics.map((personal) =>
        personal.id === action.metricId && normalizedShared
          ? {
              ...personal,
              ...normalizedShared,
              goal: personal.goal,
              adaptiveGoalTarget: personal.adaptiveGoalTarget,
              goalRange: personal.goalRange,
              goalEnabled: personal.goalEnabled,
              goalSchedule: personal.goalSchedule,
              reminder: personal.reminder,
              reminders: personal.reminders,
              defaultVisibility: personal.defaultVisibility,
              sections: personal.sections,
              scoreWeight: personal.scoreWeight,
              order: personal.order,
            }
          : personal,
      );
      const sharedMetric = configuration.find(
        (metric) => metric.id === action.metricId && metric.sections.group,
      );
      if (
        sharedMetric &&
        !metrics.some((personal) => personal.id === sharedMetric.id)
      ) {
        metrics = [
          ...metrics,
          {
            ...sharedMetric,
            defaultVisibility: "group",
            sections: { ...sharedMetric.sections, today: true, insights: true },
            order: metrics.length,
          },
        ];
      }
      return markGroupConfigurationPending(state, {
        ...state,
        metrics,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "addGroupMetric": {
      const { trackGoal: _trackGoal, ...definition } = action.metric;
      const base =
        slugify(action.metric.templateId ?? action.metric.name) ||
        "group_tracker";
      let id = base;
      let suffix = 2;
      const existing = state.group.metricConfiguration ?? [];
      while (existing.some((metric) => metric.id === id))
        id = `${base}_${suffix++}`;
      const internalCompanion =
        base === "blood_pressure_diastolic" ||
        (action.metric.healthMapping?.dataType === "blood_pressure" &&
          action.metric.healthMapping.field === "diastolic");
      const gymMapping =
        definition.gymMapping ??
        (definition.category === "gym" && definition.dataType === "number"
          ? {
              kind: "exercise_one_rep_max" as const,
              exerciseKey: `group:${state.group.id}:${id}`,
            }
          : undefined);
      const metric: MetricDefinition = {
        ...definition,
        id,
        gymMapping,
        gymMuscleGroups:
          definition.category === "gym"
            ? definition.gymMuscleGroups?.length
              ? definition.gymMuscleGroups
              : ["full_body"]
            : undefined,
        manualEntry: gymMapping ? false : definition.manualEntry,
        unit:
          gymMapping?.kind === "exercise_one_rep_max" && !definition.unit
            ? "kg e1RM"
            : definition.unit,
        defaultVisibility: definition.defaultVisibility ?? "group",
        order: existing.length,
        activeFrom: action.metric.activeFrom ?? dateKey(),
        scoreWeight:
          action.metric.dataType === "text" ||
          action.metric.dataType === "photo"
            ? 0
            : 1,
        sections: internalCompanion
          ? { today: false, insights: false, group: false }
          : { today: true, insights: true, group: true },
      };
      const group = {
        ...state.group,
        metricConfiguration: [...existing, metric],
      };
      const metrics = state.metrics.some((item) => item.id === id)
        ? state.metrics
        : [...state.metrics, { ...metric, order: state.metrics.length }];
      return markGroupConfigurationPending(state, {
        ...state,
        metrics,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
        trackedGoalPeriods: { ...state.trackedGoalPeriods, [id]: [] },
      });
    }
    case "addGroupMetrics":
      // Group configuration uses the same atomic bulk boundary as personal
      // trackers. Each item still passes through the established normalization
      // and duplicate-id logic in addGroupMetric.
      return action.metrics.reduce(
        (current, metric) =>
          reducer(current, { type: "addGroupMetric", metric }),
        state,
      );
    case "deleteGroupMetric": {
      const existing = state.group.metricConfiguration ?? [];
      const removedIds = linkedBloodPressureIds(existing, action.metricId);
      const group = {
        ...state.group,
        metricConfiguration: existing
          .filter((metric) => !removedIds.has(metric.id))
          .map((metric, order) => ({ ...metric, order })),
      };
      return markGroupConfigurationPending(state, {
        ...state,
        settings: withoutMetricSelections(state.settings, removedIds),
        selectedGroupMetricId: removedIds.has(state.selectedGroupMetricId)
          ? "__score"
          : state.selectedGroupMetricId,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "moveMetric": {
      const ordered = [...state.metrics].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex(
        (metric) => metric.id === action.metricId,
      );
      const nextIndex = index + action.direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length)
        return state;
      [ordered[index], ordered[nextIndex]] = [
        ordered[nextIndex],
        ordered[index],
      ];
      return withPersonalMetrics(
        state,
        ordered.map((metric, order) => ({ ...metric, order })),
      );
    }
    case "reorderMetric": {
      const ordered = [...state.metrics].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex(
        (metric) => metric.id === action.metricId,
      );
      if (index < 0) return state;
      const [moved] = ordered.splice(index, 1);
      ordered.splice(
        Math.max(0, Math.min(action.targetIndex, ordered.length)),
        0,
        moved,
      );
      return withPersonalMetrics(
        state,
        ordered.map((metric, order) => ({ ...metric, order })),
      );
    }
    case "selectGroupMetric":
      return { ...state, selectedGroupMetricId: action.metricId };
    case "saveGymPlan":
      return {
        ...state,
        gymPlans: [
          action.plan,
          ...(state.gymPlans ?? []).filter((item) => item.id !== action.plan.id),
        ],
      };
    case "deleteGymPlan":
      return {
        ...state,
        gymPlans: (state.gymPlans ?? []).filter((item) => item.id !== action.planId),
      };
    case "saveGroupGymPlan": {
      const normalizedPlan: GymPlan = {
        ...action.plan,
        id: action.plan.id.startsWith(`group-plan:${state.group.id}:`)
          ? action.plan.id
          : `group-plan:${state.group.id}:${slugify(action.plan.name)}-${Date.now().toString(36)}`,
        userId: `group:${state.group.id}`,
        exercises: action.plan.exercises.map((exercise) => ({
          ...exercise,
          exerciseKey:
            exercise.exerciseKey &&
            !exercise.exerciseKey.startsWith("custom:")
              ? exercise.exerciseKey
              : `group:${state.group.id}:${slugify(exercise.name)}`,
        })),
      };
      const group = {
        ...state.group,
        gymPlans: [
          normalizedPlan,
          ...(state.group.gymPlans ?? []).filter(
            (item) => item.id !== normalizedPlan.id,
          ),
        ],
      };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((item) =>
          item.id === group.id ? group : item,
        ),
      });
    }
    case "deleteGroupGymPlan": {
      const group = {
        ...state.group,
        gymPlans: (state.group.gymPlans ?? []).filter(
          (item) => item.id !== action.planId,
        ),
      };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((item) =>
          item.id === group.id ? group : item,
        ),
      });
    }
    case "saveGymSession": {
      const session = action.session;
      const completedSets = completedGymSets(session.exercises);
      const calorieValue = Math.max(0, Number(session.calories ?? 0));
      const synced = (completedSets > 0 ? [
        { metricId: "workout", value: true },
        { metricId: "workout_duration", value: session.durationMinutes },
        { metricId: "workout_calories", value: calorieValue },
        { metricId: "exercise", value: calorieValue },
      ] : [])
        .filter(
          (item) =>
            state.metrics.some((metric) => metric.id === item.metricId) &&
            (item.metricId === "workout" || Number(item.value) > 0),
        )
        .map((item): MetricEntry => ({
          id: `gym-sync:${session.id}:${item.metricId}`,
          metricId: item.metricId,
          userId: state.currentUserId,
          value: item.value,
          localDate: session.localDate,
          recordedAt: session.recordedAt,
          visibility:
            session.visibility === "private"
              ? "private"
              : (state.metrics.find((metric) => metric.id === item.metricId)
                  ?.defaultVisibility ?? "group"),
          source: "manual",
          label: session.name,
          note: `Workout session · ${completedSets} sets${session.notes ? ` · ${session.notes}` : ""}`,
        }));
      const existingSyncedIds = state.entries
        .filter(
          (entry) =>
            entry.userId === state.currentUserId &&
            entry.id.startsWith(`gym-sync:${session.id}:`),
        )
        .map((entry) => entry.id);
      const nextSyncedIds = new Set(synced.map((entry) => entry.id));
      const removedSyncedIds = existingSyncedIds.filter(
        (id) => !nextSyncedIds.has(id),
      );
      const reconcileDeletedIds = (ids: string[] | undefined) => [
        ...new Set([
          ...(ids ?? []).filter((id) => !nextSyncedIds.has(id)),
          ...removedSyncedIds,
        ]),
      ];
      return {
        ...state,
        settings: {
          ...state.settings,
          pendingDeletedEntryIds: reconcileDeletedIds(
            state.settings.pendingDeletedEntryIds,
          ),
          deletedEntryIds: reconcileDeletedIds(
            state.settings.deletedEntryIds,
          ),
        },
        gymSessions: [
          session,
          ...(state.gymSessions ?? []).filter((item) => item.id !== session.id),
        ],
        entries: [
          ...state.entries.filter(
            (entry) =>
              entry.userId !== state.currentUserId ||
              !entry.id.startsWith(`gym-sync:${session.id}:`),
          ),
          ...synced,
        ],
      };
    }
    case "deleteGymSession": {
      const removedSyncedIds = state.entries
        .filter(
          (entry) =>
            entry.userId === state.currentUserId &&
            entry.id.startsWith(`gym-sync:${action.sessionId}:`),
        )
        .map((entry) => entry.id);
      return {
        ...state,
        settings: {
          ...state.settings,
          pendingDeletedEntryIds: [
            ...new Set([
              ...(state.settings.pendingDeletedEntryIds ?? []),
              ...removedSyncedIds,
            ]),
          ],
          deletedEntryIds: [
            ...new Set([
              ...(state.settings.deletedEntryIds ?? []),
              ...removedSyncedIds,
            ]),
          ],
        },
        gymSessions: (state.gymSessions ?? []).filter(
          (item) => item.id !== action.sessionId,
        ),
        entries: state.entries.filter(
          (entry) =>
            entry.userId !== state.currentUserId ||
            !entry.id.startsWith(`gym-sync:${action.sessionId}:`),
        ),
      };
    }
    case "gymExerciseGoal":
      return {
        ...state,
        gymExerciseGoals: {
          ...(state.gymExerciseGoals ?? {}),
          [action.exerciseKey]: action.goal,
        },
      };
    case "addPhoto": {
      const photo: PhotoUpdate = {
        id: uniqueId("photo"),
        userId: state.currentUserId,
        uri: action.uri,
        caption: action.caption,
        visibility: action.visibility,
        localDate: action.localDate ?? dateKey(),
        createdAt: action.capturedAt ?? new Date().toISOString(),
        capturedAt: action.capturedAt,
      };
      return { ...state, photos: [photo, ...state.photos] };
    }
    case "setPhotoVisibility":
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === action.photoId
            ? { ...photo, visibility: action.visibility }
            : photo,
        ),
      };
    case "sendMessage":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: uniqueId("message"),
            groupId: state.group.id,
            senderId: state.currentUserId,
            text: action.text.trim(),
            conversationId: action.conversationId,
            recipientId: action.recipientId,
            imageUri: action.imageUri,
            createdAt: new Date().toISOString(),
            kind: "message",
          },
        ],
      };
    case "saveTodo":
      return {
        ...state,
        todos: [
          ...(state.todos ?? []).filter((todo) => todo.id !== action.todo.id),
          {
            ...action.todo,
            order:
              action.todo.order ??
              (state.todos ?? []).find((todo) => todo.id === action.todo.id)
                ?.order ??
              (state.todos ?? []).length,
          },
        ],
      };
    case "deleteTodo":
      return {
        ...state,
        todos: (state.todos ?? []).filter((todo) => todo.id !== action.todoId),
        calendarReminders: (state.calendarReminders ?? []).filter(
          (reminder) => reminder.todoId !== action.todoId,
        ),
      };
    case "toggleTodo":
      return {
        ...state,
        todos: (state.todos ?? []).map((todo) => {
          if (todo.id !== action.todoId) return todo;
          const completed = todo.completedDates.includes(action.localDate);
          return {
            ...todo,
            completedDates: completed
              ? todo.completedDates.filter(
                  (date) => date !== action.localDate,
                )
              : [...todo.completedDates, action.localDate].sort(),
            completedAt: todo.recurrence
              ? undefined
              : completed
                ? undefined
                : new Date().toISOString(),
            skippedDates: (todo.skippedDates ?? []).filter(
              (date) => date !== action.localDate,
            ),
          };
        }),
      };
    case "skipTodo":
      return {
        ...state,
        todos: (state.todos ?? []).map((todo) =>
          todo.id !== action.todoId
            ? todo
            : {
                ...todo,
                completedDates: todo.completedDates.filter(
                  (date) => date !== action.localDate,
                ),
                skippedDates: (todo.skippedDates ?? []).includes(
                  action.localDate,
                )
                  ? (todo.skippedDates ?? []).filter(
                      (date) => date !== action.localDate,
                    )
                  : [...(todo.skippedDates ?? []), action.localDate].sort(),
                completedAt: todo.recurrence
                  ? undefined
                  : new Date().toISOString(),
              },
        ),
      };
    case "reorderTodo": {
      const todos = [...(state.todos ?? [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const from = todos.findIndex((todo) => todo.id === action.todoId);
      if (from < 0) return state;
      const [moved] = todos.splice(from, 1);
      todos.splice(Math.max(0, Math.min(action.targetIndex, todos.length)), 0, moved);
      return {
        ...state,
        todos: todos.map((todo, order) => ({ ...todo, order })),
      };
    }
    case "saveJournalNote":
      return {
        ...state,
        journalNotes: [
          ...(state.journalNotes ?? []).filter(
            (note) => note.id !== action.note.id,
          ),
          action.note,
        ],
      };
    case "deleteJournalNote":
      return {
        ...state,
        journalNotes: (state.journalNotes ?? []).filter(
          (note) => note.id !== action.noteId,
        ),
      };
    case "saveCalendarReminder":
      return {
        ...state,
        calendarReminders: [
          ...(state.calendarReminders ?? []).filter(
            (reminder) => reminder.id !== action.reminder.id,
          ),
          action.reminder,
        ],
      };
    case "deleteCalendarReminder":
      return {
        ...state,
        calendarReminders: (state.calendarReminders ?? []).filter(
          (reminder) => reminder.id !== action.reminderId,
        ),
      };
    case "activityTimer":
      {
        const current =
          state.activityTimers?.length
            ? state.activityTimers
            : state.activeTimer
              ? [state.activeTimer]
              : [];
        if (action.timer) {
          const timers = [
            ...current.filter((timer) => timer.id !== action.timer!.id),
            action.timer,
          ];
          return { ...state, activityTimers: timers, activeTimer: action.timer };
        }
        const removeId = action.timerId ?? state.activeTimer?.id;
        const timers = removeId
          ? current.filter((timer) => timer.id !== removeId)
          : current;
        return {
          ...state,
          activityTimers: timers,
          activeTimer: timers[0],
        };
      }
    case "startFast":
      return startManualFast(state, action.metricId, new Date(action.at));
    case "endFast":
      return endManualFast(state, action.metricId, new Date(action.at));
    case "settings": {
      const next = { ...state, settings: { ...state.settings, ...action.changes } };
      const sourcePreferenceEnablementChanged = action.changes.healthSync &&
        Object.prototype.hasOwnProperty.call(action.changes.healthSync, "sourcePreferences") &&
        [
          ...new Set([
            ...Object.keys(state.settings.healthSync.sourcePreferences ?? {}),
            ...Object.keys(action.changes.healthSync.sourcePreferences ?? {}),
          ]),
        ].some(
          (sourceId) =>
            (state.settings.healthSync.sourcePreferences?.[sourceId]?.enabled ?? true) !==
            (action.changes.healthSync?.sourcePreferences?.[sourceId]?.enabled ?? true),
        );
      const withSources = sourcePreferenceEnablementChanged
          ? {
              ...next,
              entries: reconcileImportedHealthEntries(
                next.entries,
                next.metrics,
                next.settings.healthSync.sourcePreferences,
                next.currentUserId,
              ),
            }
          : next;
      return action.changes.weightDirection
        ? withEnergyProfile(withSources, withSources.settings.energyProfile)
        : withSources;
    }
    case "energyProfile": {
      const energyProfile = {
        ...state.settings.energyProfile,
        ...action.changes,
      };
      const next = withEnergyProfile(state, energyProfile);
      const changedMeasurements = BODY_PROFILE_METRICS.filter((mapping) =>
        Object.prototype.hasOwnProperty.call(action.changes, mapping.field),
      );
      if (!changedMeasurements.length) return next;
      const localDate = dateKey();
      const recordedAt = new Date().toISOString();
      const changedIds = new Set(
        changedMeasurements.map(
          (mapping) =>
            `profile-${mapping.metricId}:${state.currentUserId}:${localDate}`,
        ),
      );
      const deletedIds = changedMeasurements
        .filter((mapping) => next.settings.energyProfile[mapping.field] === undefined)
        .map(
          (mapping) =>
            `profile-${mapping.metricId}:${state.currentUserId}:${localDate}`,
        );
      const restoredIds = new Set(
        changedMeasurements
          .filter(
            (mapping) =>
              next.settings.energyProfile[mapping.field] !== undefined,
          )
          .map(
            (mapping) =>
              `profile-${mapping.metricId}:${state.currentUserId}:${localDate}`,
          ),
      );
      return {
        ...next,
        settings: {
          ...next.settings,
          pendingDeletedEntryIds: [
            ...new Set([
              ...(next.settings.pendingDeletedEntryIds ?? []).filter(
                (id) => !restoredIds.has(id),
              ),
              ...deletedIds,
            ]),
          ],
          deletedEntryIds: [
            ...new Set([
              ...(next.settings.deletedEntryIds ?? []).filter(
                (id) => !restoredIds.has(id),
              ),
              ...deletedIds,
            ]),
          ],
        },
        entries: [
          ...next.entries.filter(
            (entry) =>
              !changedIds.has(entry.id) || entry.userId !== state.currentUserId,
          ),
          ...changedMeasurements.flatMap((mapping): MetricEntry[] => {
            const value = next.settings.energyProfile[mapping.field];
            if (value === undefined) return [];
            return [
              {
                id: `profile-${mapping.metricId}:${state.currentUserId}:${localDate}`,
                metricId: mapping.metricId,
                userId: state.currentUserId,
                value,
                localDate,
                recordedAt,
                visibility:
                  next.metrics.find((metric) => metric.id === mapping.metricId)
                    ?.defaultVisibility ?? "private",
                source: "manual",
                sourceUpdatedAt: recordedAt,
                label: mapping.label,
                note:
                  mapping.metricId === "weight"
                    ? "Updated from Body & energy profile"
                    : undefined,
              },
            ];
          }),
        ],
      };
    }
    case "createGroup": {
      const currentMember = state.group.members.find(
        (member) => member.id === state.currentUserId,
      );
      if (!currentMember || !action.name.trim()) return state;
      const metricConfiguration = groupMetricDefinitions(
        action.options?.metrics ?? [],
        dateKey(),
      );
      const group: Group = {
        id: uniqueId("group"),
        name: action.name.trim(),
        inviteCode: `PACE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        templateName: "Healthy Competition",
        members: [{ ...currentMember, role: "owner" }],
        streakRestDaysPerWeek: 1,
        themeColor: action.options?.themeColor ?? DEFAULT_GROUP_THEME,
        requireMemberApproval:
          action.options?.requireMemberApproval ?? false,
        metricConfiguration,
      };
      const groups = state.groups.map((candidate) =>
        candidate.id === state.group.id ? state.group : candidate,
      );
      const missingPersonal = metricConfiguration.filter(
        (metric) =>
          !state.metrics.some((personal) => personal.id === metric.id),
      );
      return {
        ...state,
        group,
        groups: [...groups, group],
        metrics: [
          ...state.metrics,
          ...missingPersonal.map((metric, index) => ({
            ...metric,
            sections: {
              ...metric.sections,
              today: !isBloodPressureDiastolic(metric),
              insights: !isBloodPressureDiastolic(metric),
            },
            order: state.metrics.length + index,
          })),
        ],
        trackedGoalPeriods: {
          ...state.trackedGoalPeriods,
          ...Object.fromEntries(
            missingPersonal.map((metric) => [metric.id, []]),
          ),
        },
        selectedGroupMetricId: metricConfiguration[0]?.id ?? "__score",
      };
    }
    case "joinGroup": {
      const normalized = action.code.trim().toUpperCase();
      if (!normalized) return state;
      const existing = state.groups.find(
        (group) => group.inviteCode.toUpperCase() === normalized,
      );
      if (existing) return { ...state, group: existing };
      const currentMember = state.group.members.find(
        (member) => member.id === state.currentUserId,
      );
      if (!currentMember) return state;
      const group: Group = {
        id: uniqueId("joined"),
        name: `Joined ${normalized}`,
        inviteCode: normalized,
        templateName: "Shared template",
        members: [{ ...currentMember, role: "member" }],
        streakRestDaysPerWeek: 1,
        metricConfiguration: [],
      };
      const groups = state.groups.map((candidate) =>
        candidate.id === state.group.id ? state.group : candidate,
      );
      return { ...state, group, groups: [...groups, group] };
    }
    case "switchGroup": {
      const group = state.groups.find(
        (candidate) => candidate.id === action.groupId,
      );
      if (!group) return state;
      return syncPersonalSetupGroup({ ...state, group });
    }
    case "leaveGroup": {
      const leavingGroup = state.groups.find(
        (group) => group.id === action.groupId,
      );
      if (!leavingGroup || isPersonalSetupGroup(leavingGroup)) return state;
      let groups = state.groups.filter(
        (group) => group.id !== action.groupId,
      );
      if (!groups.length) {
        const currentMember = leavingGroup.members.find(
          (member) => member.id === state.currentUserId,
        );
        if (!currentMember) return state;
        groups = [
          createPersonalSetupGroup(
            currentMember,
            personalSetupMetricConfiguration(
              state.metrics,
              state.trackedGoalPeriods,
            ),
          ),
        ];
      }
      if (state.group.id !== action.groupId) return { ...state, groups };
      const group = groups[0];
      return syncPersonalSetupGroup({ ...state, groups, group });
    }
    case "nickname": {
      const groupAliases =
        state.settings.memberNicknamesByGroup?.[state.group.id] ?? {};
      return {
        ...state,
        settings: {
          ...state.settings,
          memberNicknamesByGroup: {
            ...state.settings.memberNicknamesByGroup,
            [state.group.id]: {
              ...groupAliases,
              [action.memberId]: action.nickname.trim(),
            },
          },
        },
      };
    }
    case "groupName": {
      const current = state.group.members.find(
        (member) => member.id === state.currentUserId,
      );
      if (current?.role !== "owner" && current?.role !== "admin") return state;
      const name = action.name.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!name || name === state.group.name) return state;
      const group = { ...state.group, name };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "groupRestDays": {
      const value = Math.max(0, Math.min(4, Math.round(action.value)));
      const group = { ...state.group, streakRestDaysPerWeek: value };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "groupTheme": {
      const group = { ...state.group, themeColor: action.color };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "groupApproval": {
      const group = { ...state.group, requireMemberApproval: action.value };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "approveMember": {
      const pending = state.group.pendingMembers ?? [];
      const member = pending.find((item) => item.id === action.memberId);
      if (!member) return state;
      const group = {
        ...state.group,
        members: [...state.group.members, { ...member, role: "member" as const }],
        pendingMembers: pending.filter((item) => item.id !== action.memberId),
      };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "removeMember": {
      if (action.memberId === state.currentUserId) return state;
      const group = {
        ...state.group,
        members: state.group.members.filter(
          (member) => member.id !== action.memberId,
        ),
        pendingMembers: (state.group.pendingMembers ?? []).filter(
          (member) => member.id !== action.memberId,
        ),
      };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "memberAvatar": {
      const updateMembers = (group: Group): Group => ({
        ...group,
        members: group.members.map((member) =>
          member.id === action.memberId
            ? {
                ...member,
                avatarUri: action.avatarUri,
                avatarStoragePath: undefined,
              }
            : member,
        ),
      });
      const groups = state.groups.map(updateMembers);
      return { ...state, groups, group: updateMembers(state.group) };
    }
    case "memberName": {
      const name = action.name.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) return state;
      const updateMembers = (group: Group): Group => ({
        ...group,
        members: group.members.map((member) =>
          member.id === action.memberId
            ? {
                ...member,
                name,
                initials: name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase(),
              }
            : member,
        ),
      });
      const groups = state.groups.map(updateMembers);
      return { ...state, groups, group: updateMembers(state.group) };
    }
    case "memberRole": {
      const current = state.group.members.find(
        (member) => member.id === state.currentUserId,
      );
      const target = state.group.members.find(
        (member) => member.id === action.memberId,
      );
      if (current?.role !== "owner" || !target || target.role === "owner")
        return state;
      const group = {
        ...state.group,
        members: state.group.members.map((member) =>
          member.id === action.memberId
            ? { ...member, role: action.role }
            : member,
        ),
      };
      return markGroupConfigurationPending(state, {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      });
    }
    case "importHealth": {
      // Health Connect/HealthKit can briefly return an incomplete page while
      // another writer is updating. Upsert stable source ids without clearing
      // the overlap first, so a routine refresh never makes readings flash out.
      const existingById = new Map(
        state.entries.map((entry) => [
          metricEntryKey(entry.userId, entry.id),
          entry,
        ]),
      );
      const replacementMetricIds = new Set(
        action.aggregateReplacement?.metricIds ?? [],
      );
      const byId = new Map(
        state.entries
          .filter(
            (entry) =>
              !isDailyStepReplacementCandidate(entry, {
                userId: state.currentUserId,
                provider: action.provider,
                stepMetricIds: replacementMetricIds,
                fromDate: action.fromDate,
                throughDate: action.aggregateReplacement?.throughDate ?? "",
                includeFallbacks:
                  action.aggregateReplacement?.removeStepFallbacks === true,
              }),
          )
          .map((entry) => [metricEntryKey(entry.userId, entry.id), entry]),
      );
      const dismissed = new Set(state.settings.dismissedHealthEntryIds ?? []);
      for (const entry of action.entries) {
        if (dismissed.has(entry.id)) continue;
        const key = metricEntryKey(entry.userId, entry.id);
        const sourceReconciledEntry = replacementMetricIds.has(entry.metricId)
          ? preserveUnchangedDailyAggregateRevision(
              existingById.get(key),
              entry,
            )
          : preserveUnchangedStepFallback(existingById.get(key), entry);
        const nextEntry = preserveFoodEntryClockOverride(
          existingById.get(key),
          sourceReconciledEntry,
        );
        byId.set(key, nextEntry);
      }
      const targetMetrics = new Set(action.metricIds);
      const affected: MetricEntry[] = [];
      const unaffected: MetricEntry[] = [];
      for (const entry of byId.values()) {
        if (
          entry.userId === state.currentUserId &&
          entry.sourceProvider === action.provider &&
          targetMetrics.has(entry.metricId) &&
          entry.localDate >= action.fromDate
        )
          affected.push(entry);
        else unaffected.push(entry);
      }
      const reconciled = reconcileImportedHealthEntries(
        affected,
        state.metrics,
        state.settings.healthSync.sourcePreferences,
      );
      const nextEntries = [...unaffected, ...reconciled];
      const entriesUnchanged =
        nextEntries.length === state.entries.length &&
        nextEntries.every(
          (entry) =>
            existingById.get(metricEntryKey(entry.userId, entry.id)) === entry,
        );
      const reconciledState = entriesUnchanged
        ? state
        : applyImportedFoodFastBreaks(
            { ...state, entries: nextEntries },
            action.entries,
          );
      // A frequent Steps-only aggregate cannot change the private body
      // profile. Avoid three full entry-index scans on every foreground read.
      const importedState = action.entries.some((entry) =>
        BODY_PROFILE_METRICS.some(
          (mapping) => mapping.metricId === entry.metricId,
        ),
      )
        ? withLatestBodyProfileMeasurements(reconciledState)
        : reconciledState;
      if (action.preserveTrackedGoalHistory) return importedState;
      const withOnboardingGoalHistory = (next: AppState): AppState => {
        const pendingFirstImport =
          next.settings.healthSync.backfillTrackedGoalsOnFirstImport === true;
        const initialHistoryPending =
          next.settings.healthSync.initialHistoryImportPending === true;
        // Historical chunks are deliberately applied incrementally for a
        // responsive UI. Goal dates are recalculated only after the final
        // chunk, when every selected tracker has had a chance to import data.
        if (initialHistoryPending && !action.finalizeInitialImport) return next;
        if (
          next.settings.onboardingComplete &&
          !pendingFirstImport &&
          !initialHistoryPending
        )
          return next;
        if (
          pendingFirstImport &&
          !initialHistoryPending &&
          action.entries.length === 0
        ) {
          const emptyReadCount =
            next.settings.healthSync.backfillTrackedGoalsEmptyReadCount ?? 0;
          const allowOneRetry = emptyReadCount < 1;
          return {
            ...next,
            settings: {
              ...next.settings,
              healthSync: {
                ...next.settings.healthSync,
                backfillTrackedGoalsOnFirstImport: allowOneRetry,
                backfillTrackedGoalsEmptyReadCount: allowOneRetry
                  ? emptyReadCount + 1
                  : undefined,
              },
            },
          };
        }
        const starts = new Map<string, string>();
        if (pendingFirstImport)
          next.metrics.forEach((metric) => {
            const periods = next.trackedGoalPeriods[metric.id] ?? [];
            if (!periods.length) return;
            const start = goalHistoryStart(next, metric);
            if (start < periods[0].from) starts.set(metric.id, start);
          });
        const settings = pendingFirstImport || initialHistoryPending
          ? {
              ...next.settings,
              healthSync: {
                ...next.settings.healthSync,
                backfillTrackedGoalsOnFirstImport: false,
                backfillTrackedGoalsEmptyReadCount: undefined,
                initialHistoryImportPending: false,
              },
            }
          : next.settings;
        if (!starts.size)
          return settings === next.settings ? next : { ...next, settings };
        return {
          ...next,
          settings,
          metrics: next.metrics.map((metric) =>
            starts.has(metric.id)
              ? { ...metric, activeFrom: starts.get(metric.id)! }
              : metric,
          ),
          trackedGoalPeriods: Object.fromEntries(
            Object.entries(next.trackedGoalPeriods).map(
              ([metricId, periods]) => [
                metricId,
                starts.has(metricId)
                  ? periods.map((period, index) =>
                      index === 0
                        ? { ...period, from: starts.get(metricId)! }
                        : period,
                    )
                  : periods,
              ],
            ),
          ),
        };
      };
      return withOnboardingGoalHistory(importedState);
    }
    case "reset":
      return createInitialState();
    default:
      return state;
  }
}

type AppContextValue = {
  state: AppState;
  hydrated: boolean;
  logMetric: (
    metricId: string,
    value: number | boolean | string,
    visibility: Visibility,
    mode?: "add" | "replace",
    details?: EntryDetails,
    request?: LogMetricRequest,
  ) => void;
  setDeviceScreenTime: (
    localDate: string,
    minutes: number,
    recordedAt: string,
  ) => void;
  setDeviceScreenTimeRange: (
    samples: {
      localDate: string;
      minutes: number;
      recordedAt: string;
    }[],
  ) => void;
  addMetric: (metric: NewMetric) => void;
  addMetrics: (metrics: NewMetric[]) => void;
  updateMetric: (metricId: string, changes: Partial<MetricDefinition>) => void;
  deleteMetric: (metricId: string) => void;
  deleteEntry: (entryId: string) => void;
  updateFoodEntryTime: (entryId: string, clockTime: string) => void;
  skipGoal: (metricId: string, localDate: string) => void;
  deletePhoto: (photoId: string) => void;
  setMetricSection: (
    metricId: string,
    section: DashboardSection,
    value: boolean,
    historyMode?: "today" | "history",
  ) => void;
  setTrackedGoal: (
    metricId: string,
    value: boolean,
    historyMode: "today" | "history",
    startDate?: string,
  ) => void;
  configurePersonalMetrics: (
    metrics: MetricDefinition[],
    trackedGoalIds: string[],
    historyMode: "today" | "history",
  ) => void;
  updateGroupMetric: (
    metricId: string,
    changes: Partial<MetricDefinition>,
  ) => void;
  addGroupMetric: (metric: NewMetric) => void;
  addGroupMetrics: (metrics: NewMetric[]) => void;
  deleteGroupMetric: (metricId: string) => void;
  moveMetric: (metricId: string, direction: -1 | 1) => void;
  reorderMetric: (metricId: string, targetIndex: number) => void;
  selectGroupMetric: (metricId: string) => void;
  addPhoto: (
    uri: string,
    caption: string,
    visibility: Visibility,
    localDate?: string,
    capturedAt?: string,
  ) => void;
  setPhotoVisibility: (photoId: string, visibility: Visibility) => void;
  sendMessage: (
    text: string,
    conversationId?: string,
    recipientId?: string,
    imageUri?: string,
  ) => void;
  saveTodo: (todo: TodoItem) => void;
  deleteTodo: (todoId: string) => void;
  toggleTodo: (todoId: string, localDate: string) => void;
  skipTodo: (todoId: string, localDate: string) => void;
  reorderTodo: (todoId: string, targetIndex: number) => void;
  saveJournalNote: (note: JournalNote) => void;
  deleteJournalNote: (noteId: string) => void;
  saveCalendarReminder: (reminder: CalendarReminder) => void;
  deleteCalendarReminder: (reminderId: string) => void;
  setActivityTimer: (timer?: ActivityTimer, timerId?: string) => void;
  startFast: (metricId?: string) => void;
  endFast: (metricId?: string) => void;
  updateSettings: (changes: Partial<AppState["settings"]>) => void;
  updateEnergyProfile: (changes: Partial<EnergyProfile>) => void;
  createGroup: (name: string, options?: GroupCreationOptions) => void;
  joinGroup: (code: string) => void;
  switchGroup: (groupId: string) => void;
  leaveGroup: (groupId: string) => void;
  updateNickname: (memberId: string, nickname: string) => void;
  setGroupName: (name: string) => void;
  setGroupRestDays: (value: number) => void;
  setGroupTheme: (color: string) => void;
  setGroupApprovalRequired: (value: boolean) => void;
  approveMember: (memberId: string) => void;
  removeMember: (memberId: string) => void;
  updateMemberAvatar: (memberId: string, avatarUri?: string) => void;
  updateMemberName: (memberId: string, name: string) => void;
  setMemberRole: (memberId: string, role: "admin" | "member") => void;
  saveGymPlan: (plan: GymPlan) => void;
  deleteGymPlan: (planId: string) => void;
  saveGroupGymPlan: (plan: GymPlan) => void;
  deleteGroupGymPlan: (planId: string) => void;
  saveGymSession: (session: GymSession) => void;
  deleteGymSession: (sessionId: string) => void;
  setGymExerciseGoal: (exerciseKey: string, goal: GymExerciseGoal) => void;
  importHealthEntries: (
    entries: MetricEntry[],
    provider: NonNullable<MetricEntry["sourceProvider"]>,
    metricIds: string[],
    fromDate: string,
    finalizeInitialImport?: boolean,
    preserveTrackedGoalHistory?: boolean,
    aggregateReplacement?: {
      metricIds: string[];
      throughDate: string;
      removeStepFallbacks?: boolean;
    },
    /** Device-owned imports can be re-read; keep their JSON save off tap frames. */
    deferPersistence?: boolean,
  ) => Promise<void>;
  /** Flush the latest reducer state to this device before a route exits. */
  flushLocalPersistence: () => Promise<void>;
  /** Swap an account boundary in memory without persisting a clean placeholder. */
  stageState: (state: AppState) => void;
  replaceState: (state: AppState) => void;
  resetDemo: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  initialState,
  persistence = "durable",
}: PropsWithChildren<{
  initialState?: AppState;
  persistence?: "durable" | "ephemeral";
}>) {
  const ephemeral = persistence === "ephemeral";
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => initialState ?? createInitialState(),
  );
  const [hydrated, setHydrated] = useState(ephemeral);
  const persistenceStateRef = useRef(state);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const persistenceTaskRef = useRef<
    ReturnType<typeof InteractionManager.runAfterInteractions> | null
  >(null);
  const persistenceIdleFallbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const persistenceWriteRef = useRef<Promise<void> | null>(null);
  const persistenceDeferredTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const persistenceDeferredRunRef = useRef<(() => void) | null>(null);
  const persistenceResumeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const persistenceDirtyRef = useRef(false);
  const persistenceRevisionRef = useRef(0);
  const persistenceObservedStateRef = useRef<AppState | null>(null);
  persistenceStateRef.current = state;

  const persistLatestState = useCallback((immediate = false): Promise<void> => {
    if (ephemeral) return Promise.resolve();
    // AppState may emit inactive and background in quick succession, while a
    // resume can overlap the tail of the background write. JSON.stringify is
    // synchronous, so coalescing here prevents duplicate full-state
    // serialization from blocking the first taps after returning to the app.
    if (persistenceWriteRef.current) {
      if (immediate) persistenceDeferredRunRef.current?.();
      return persistenceWriteRef.current;
    }

    const deferForegroundTurn = () => {
      if (NativeAppState.currentState !== "active") return Promise.resolve();
      return new Promise<void>((resolve) => {
        let completed = false;
        const run = () => {
          if (completed) return;
          completed = true;
          if (persistenceDeferredTimerRef.current) {
            clearTimeout(persistenceDeferredTimerRef.current);
            persistenceDeferredTimerRef.current = null;
          }
          if (persistenceDeferredRunRef.current === run)
            persistenceDeferredRunRef.current = null;
          resolve();
        };
        persistenceDeferredRunRef.current = run;
        // Unlike a Promise microtask, this yields the current press/navigation
        // frame to React Native before JSON.stringify runs. If the app starts
        // backgrounding first, the AppState handler invokes `run` immediately,
        // so Android cannot suspend an unresolved timer and lose the flush.
        persistenceDeferredTimerRef.current = setTimeout(run, 0);
      });
    };

    let write: Promise<void>;
    write = (async () => {
      if (!immediate) await deferForegroundTurn();
      while (persistenceDirtyRef.current) {
        const revision = persistenceRevisionRef.current;
        const latest = persistenceStateRef.current;
        await persistAppStateNow(latest);
        if (revision === persistenceRevisionRef.current) {
          persistenceDirtyRef.current = false;
          continue;
        }
        // State changed while AsyncStorage was writing. Yield again before the
        // trailing foreground serialization; a background transition can still
        // force this same gate immediately via persistenceDeferredRunRef.
        await deferForegroundTurn();
      }
    })()
      .finally(() => {
        if (persistenceWriteRef.current === write)
          persistenceWriteRef.current = null;
      });
    persistenceWriteRef.current = write;
    return write;
  }, [ephemeral]);

  const queuePersistenceAfterInteractions = useCallback(() => {
    if (ephemeral) return;
    if (persistenceTaskRef.current) return;
    let completed = false;
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null =
      null;
    const run = () => {
      if (completed) return;
      completed = true;
      if (persistenceIdleFallbackTimerRef.current) {
        clearTimeout(persistenceIdleFallbackTimerRef.current);
        persistenceIdleFallbackTimerRef.current = null;
      }
      if (persistenceTaskRef.current === task)
        persistenceTaskRef.current = null;
      void persistLatestState().catch(() => undefined);
    };
    task = InteractionManager.runAfterInteractions(run);
    // A looping animation can keep InteractionManager busy indefinitely. The
    // fallback cancels the same task and invokes the same guarded callback, so
    // persistence stays off the immediate tap frame without sacrificing local
    // durability or serializing twice.
    if (!completed) {
      persistenceTaskRef.current = task;
      persistenceIdleFallbackTimerRef.current = setTimeout(
        () => {
          if (completed) return;
          task?.cancel();
          run();
        },
        LOCAL_PERSIST_IDLE_MAX_WAIT_MS,
      );
    } else {
      task.cancel();
    }
  }, [ephemeral, persistLatestState]);

  const scheduleDeferredPersistence = useCallback(() => {
    if (ephemeral) return;
    if (NativeAppState.currentState !== "active") {
      void persistLatestState(true).catch(() => undefined);
      return;
    }
    if (
      persistenceWriteRef.current ||
      persistenceTimerRef.current ||
      persistenceTaskRef.current
    )
      return;
    const persistWhenIdle = () => {
      persistenceTimerRef.current = null;
      if (isCloudSyncPaused()) {
        persistenceTimerRef.current = setTimeout(persistWhenIdle, 650);
        return;
      }
      queuePersistenceAfterInteractions();
    };
    // A short coalescing window preserves near-immediate offline durability
    // while avoiding a full year-cache JSON.stringify for every rapid tap.
    persistenceTimerRef.current = setTimeout(persistWhenIdle, 850);
  }, [ephemeral, persistLatestState, queuePersistenceAfterInteractions]);

  useEffect(() => {
    if (ephemeral) return;
    AsyncStorage.getItem(APP_STORAGE_KEY)
      .then(async (saved) => {
        if (saved) {
          const restored = JSON.parse(saved) as AppState;
          const defaults = createInitialState();
          const restoredVersion = Number(restored.version ?? 1);
          const isDefaultDemo =
            (restored.group?.id ?? defaults.group.id) === defaults.group.id;
          let restoredMetrics =
            restoredVersion < 3
              ? [
                  ...(restored.metrics ?? []),
                  ...defaults.metrics.filter(
                    (candidate) =>
                      !(restored.metrics ?? []).some(
                        (metric) => metric.id === candidate.id,
                      ),
                  ),
                ].map((metric, order) => ({
                  ...metric,
                  activeFrom: metric.activeFrom ?? dateKey(),
                  order,
                }))
              : (restored.metrics ?? defaults.metrics).map((metric) => ({
                  ...metric,
                  activeFrom: metric.activeFrom ?? dateKey(),
                }));
          if (restoredVersion < 9 && isDefaultDemo) {
            const savedById = new Map(
              restoredMetrics.map((metric) => [metric.id, metric]),
            );
            const builtInIds = new Set(
              defaults.metrics.map((metric) => metric.id),
            );
            restoredMetrics = [
              ...defaults.metrics.map((metric) => ({
                ...metric,
                ...(savedById.get(metric.id) ?? {}),
                activeFrom: metric.activeFrom,
                rankingDirection:
                  metric.id === "deficit"
                    ? ("closest" as const)
                    : (savedById.get(metric.id)?.rankingDirection ??
                      metric.rankingDirection),
              })),
              ...restoredMetrics.filter((metric) => !builtInIds.has(metric.id)),
            ].map((metric, order) => ({ ...metric, order }));
          }
          if (restoredVersion < 15) {
            const newTrackerIds = new Set([
              "sleep",
              "blood_glucose",
              "menstrual_cycle",
            ]);
            restoredMetrics = [
              ...restoredMetrics,
              ...defaults.metrics.filter(
                (candidate) =>
                  newTrackerIds.has(candidate.id) &&
                  !restoredMetrics.some((metric) => metric.id === candidate.id),
              ),
            ];
          }
          const defaultEntryIds = new Set(
            defaults.entries.map((entry) => entry.id),
          );
          const defaultPhotoIds = new Set(
            defaults.photos.map((photo) => photo.id),
          );
          let migratedTrackedGoals =
            restoredVersion < 9 && isDefaultDemo
              ? Object.fromEntries(
                  restoredMetrics.map((metric) => [
                    metric.id,
                    defaults.trackedGoalPeriods[metric.id] ??
                      restored.trackedGoalPeriods?.[metric.id] ??
                      [],
                  ]),
                )
              : (restored.trackedGoalPeriods ?? defaults.trackedGoalPeriods);
          const historicalStart = [
            ...(restored.entries ?? []).filter(
              (entry) => entry.userId === restored.currentUserId,
            ),
            ...(restored.photos ?? []).filter(
              (photo) => photo.userId === restored.currentUserId,
            ),
          ]
            .map((item) => item.localDate)
            .sort()[0];
          if (restoredVersion < 17 && historicalStart) {
            const retrospective = new Set(
              restoredMetrics
                .filter((metric) =>
                  (migratedTrackedGoals[metric.id] ?? []).some(
                    (period) =>
                      period.from === metric.activeFrom &&
                      historicalStart < period.from,
                  ),
                )
                .map((metric) => metric.id),
            );
            restoredMetrics = restoredMetrics.map((metric) =>
              retrospective.has(metric.id)
                ? { ...metric, activeFrom: historicalStart }
                : metric,
            );
            migratedTrackedGoals = Object.fromEntries(
              Object.entries(migratedTrackedGoals).map(([metricId, periods]) => [
                metricId,
                retrospective.has(metricId)
                  ? periods.map((period) => ({
                      ...period,
                      from: historicalStart,
                    }))
                  : periods,
              ]),
            );
          }
          const restoredState: AppState = {
            ...defaults,
            ...restored,
            version: 25,
            settings: {
              ...defaults.settings,
              ...restored.settings,
              streakRestDaysPerWeek: Math.max(
                0,
                Math.min(4, restored.settings?.streakRestDaysPerWeek ?? 1),
              ),
              progressMetricIds:
                restoredVersion < 19
                  ? [
                      "tracked_goals",
                      ...(restored.settings?.progressMetricIds ?? []).filter(
                        (id) => id !== "tracked_goals",
                      ),
                    ]
                  : (restored.settings?.progressMetricIds ??
                    defaults.settings.progressMetricIds),
              onboardingComplete:
                restored.settings?.onboardingComplete ?? restoredVersion < 15,
              energyProfile: normalizeEnergyProfile({
                ...defaults.settings.energyProfile,
                ...restored.settings?.energyProfile,
              }),
              healthSync: {
                ...defaults.settings.healthSync,
                ...restored.settings?.healthSync,
                dataTypes: {
                  ...defaults.settings.healthSync.dataTypes,
                  ...restored.settings?.healthSync?.dataTypes,
                },
              },
              memberNicknamesByGroup: restored.settings
                ?.memberNicknamesByGroup ?? {
                [restored.group?.id ?? defaults.group.id]: {
                  ...(restored.settings?.memberNicknames ?? {}),
                },
              },
              badgeShowcaseByGroup: {
                ...defaults.settings.badgeShowcaseByGroup,
                ...restored.settings?.badgeShowcaseByGroup,
              },
              notifications: {
                ...defaults.settings.notifications,
                ...restored.settings?.notifications,
              },
            },
            trackedGoalPeriods: migratedTrackedGoals,
            entries:
              restoredVersion < 9 && isDefaultDemo
                ? [
                    ...(restored.entries ?? []).filter(
                      (entry) => !defaultEntryIds.has(entry.id),
                    ),
                    ...defaults.entries,
                  ]
                : (restored.entries ?? defaults.entries),
            photos:
              restoredVersion < 9 && isDefaultDemo
                ? [
                    ...(restored.photos ?? []).filter(
                      (photo) => !defaultPhotoIds.has(photo.id),
                    ),
                    ...defaults.photos,
                  ]
                : (restored.photos ?? defaults.photos),
            metrics: restoredMetrics.map((metric) => {
              const preset = defaults.metrics.find(
                (candidate) => candidate.id === metric.id,
              );
              const enriched =
                restoredVersion < 15 && preset
                  ? {
                      ...metric,
                      category: metric.category ?? preset.category,
                      healthMapping:
                        metric.healthMapping ?? preset.healthMapping,
                      gymMapping: metric.gymMapping ?? preset.gymMapping,
                      gymMuscleGroups:
                        metric.gymMuscleGroups ?? preset.gymMuscleGroups,
                      stepFallback: metric.stepFallback ?? preset.stepFallback,
                      manualEntry: metric.manualEntry ?? preset.manualEntry,
                      goalEnabled:
                        metric.id === "weekly_deficit_balance"
                          ? false
                          : (metric.goalEnabled ?? preset.goalEnabled),
                      goalRange: metric.goalRange ?? preset.goalRange,
                      aggregation: [
                        "body_fat",
                        "lean_body_mass",
                        "blood_pressure_systolic",
                        "blood_pressure_diastolic",
                        "pulse",
                        "blood_glucose",
                      ].includes(metric.id)
                        ? ("average" as const)
                        : metric.aggregation,
                    }
                  : metric;
              const normalized =
                enriched.id === "deficit" &&
                enriched.formula === "baseline + exercise - food"
                  ? {
                      ...enriched,
                      formula: "bmr + daily_activity + exercise - food",
                    }
                  : enriched;
              const reminderUpgraded =
                restoredVersion < 18
                  ? {
                      ...normalized,
                      reminders:
                        normalized.reminders?.length
                          ? normalized.reminders
                          : defaultReminderTimes(normalized).map((time) => ({
                              enabled: normalized.reminder?.enabled ?? false,
                              time,
                            })),
                    }
                  : normalized;
              const upgraded =
                restoredVersion < 20 &&
                ["blood_pressure_systolic", "blood_pressure_diastolic"].includes(
                  reminderUpgraded.id,
                )
                  ? {
                      ...reminderUpgraded,
                      goalEnabled: true,
                      goal: {
                        kind: "exact" as const,
                        target:
                          reminderUpgraded.id === "blood_pressure_systolic"
                            ? 120
                            : 80,
                      },
                      goalRange:
                        reminderUpgraded.id === "blood_pressure_systolic"
                          ? { min: 90, max: 120 }
                          : { min: 60, max: 80 },
                      ...(reminderUpgraded.id === "blood_pressure_diastolic"
                        ? {
                            sections: {
                              today: false,
                              group: false,
                              insights: false,
                            },
                          }
                        : {}),
                    }
                  : reminderUpgraded;
              if (restoredVersion < 4 && upgraded.id === "weight")
                return {
                  ...upgraded,
                  sections: { ...upgraded.sections, today: false },
                };
              const profile = {
                ...defaults.settings.energyProfile,
                ...restored.settings?.energyProfile,
              };
              if (
                restoredVersion < 4 &&
                upgraded.id === "deficit" &&
                upgraded.goal.target === 500
              )
                return {
                  ...upgraded,
                  goal: {
                    ...upgraded.goal,
                    target: recommendedDailyDeficit(profile),
                  },
                };
              if (
                restoredVersion < 4 &&
                upgraded.id === "food" &&
                upgraded.goal.target === 2000
              )
                return {
                  ...upgraded,
                  goal: {
                    ...upgraded.goal,
                    target: recommendedDailyIntake(profile),
                  },
                };
              if (upgraded.id === "intermittent_fasting" && preset)
                return {
                  ...upgraded,
                  fastingSettings: {
                    startTime:
                      upgraded.fastingSettings?.startTime ??
                      preset.fastingSettings?.startTime ??
                      "20:00",
                    fastingMinutes:
                      upgraded.fastingSettings?.fastingMinutes ??
                      preset.fastingSettings?.fastingMinutes ??
                      16 * 60,
                    automaticFoodBreak:
                      upgraded.fastingSettings?.automaticFoodBreak ?? true,
                  },
                };
              return upgraded;
            }),
            group: {
              ...(restored.group ?? defaults.group),
              streakRestDaysPerWeek: Math.max(
                0,
                Math.min(4, restored.group?.streakRestDaysPerWeek ?? 1),
              ),
              metricConfiguration:
                restoredVersion < 13 && isDefaultDemo
                  ? restoredMetrics
                  : (restored.group?.metricConfiguration ?? restoredMetrics),
            },
            groups: (restored.groups?.length
              ? restored.groups
              : [restored.group ?? defaults.group]
            ).map((group) => ({
              ...group,
              streakRestDaysPerWeek: Math.max(
                0,
                Math.min(4, group.streakRestDaysPerWeek ?? 1),
              ),
              metricConfiguration:
                restoredVersion < 13 && group.id === defaults.group.id
                  ? restoredMetrics
                  : (group.metricConfiguration ?? restoredMetrics),
            })),
            energyProfiles: Object.fromEntries(
              Object.entries({
                ...defaults.energyProfiles,
                ...restored.energyProfiles,
                [restored.currentUserId ?? defaults.currentUserId]: {
                  ...defaults.settings.energyProfile,
                  ...restored.settings?.energyProfile,
                },
              }).map(([userId, profile]) => [
                userId,
                normalizeEnergyProfile(profile),
              ]),
            ),
            messages: (restored.messages ?? defaults.messages).map((message) => {
              const restoredGroupId =
                message.groupId ??
                (message.conversationId?.startsWith("group:")
                  ? message.conversationId.slice("group:".length)
                  : (restored.group?.id ?? defaults.group.id));
              return {
                ...message,
                groupId: restoredGroupId,
                conversationId:
                  !message.conversationId || message.conversationId === "group"
                    ? `group:${restoredGroupId}`
                    : message.conversationId,
              };
            }),
            dailyMetricStatuses: restored.dailyMetricStatuses ?? [],
          };
          // Health authorization belongs to this installation, not the cloud
          // snapshot. Restore it before the first hydrated render so a quick
          // close/reopen cannot show (or persist) the cloud's sanitized "off"
          // value while HealthSyncProvider is still loading its device record.
          const savedHealthStatus = await AsyncStorage.getItem(
            `${HEALTH_STATUS_STORAGE_KEY}:${restoredState.currentUserId}`,
          ).catch(() => null);
          let stateWithDeviceHealth = restoredState;
          if (savedHealthStatus) {
            try {
              const deviceStatus = JSON.parse(
                savedHealthStatus,
              ) as PersistedHealthStatus;
              if (typeof deviceStatus.connectionEnabled === "boolean") {
                const enabled = deviceStatus.connectionEnabled;
                stateWithDeviceHealth = {
                  ...restoredState,
                  settings: {
                    ...restoredState.settings,
                    healthSync: {
                      ...restoredState.settings.healthSync,
                      enabled,
                      backgroundAccess: enabled
                        ? (deviceStatus.backgroundAccess ??
                          restoredState.settings.healthSync.backgroundAccess)
                        : false,
                    },
                  },
                };
              }
            } catch {
              // A damaged status record must not block the rest of the local
              // account from loading. HealthSyncProvider can repair it later.
            }
          }
          dispatch({
            type: "hydrate",
            state: upgradeStateV21(
              stateWithDeviceHealth,
              defaults,
              restoredVersion,
            ),
          });
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, [ephemeral]);

  useEffect(() => {
    if (!hydrated || ephemeral) return;
    const previous = persistenceObservedStateRef.current;
    persistenceObservedStateRef.current = state;
    if (previous && !localPersistenceChanged(previous, state)) return;
    persistenceDirtyRef.current = true;
    persistenceRevisionRef.current += 1;
    if (NativeAppState.currentState !== "active") return;
    scheduleDeferredPersistence();
  }, [ephemeral, hydrated, scheduleDeferredPersistence, state]);

  useEffect(() => {
    if (!hydrated || ephemeral) return;
    const clearQueuedPersistence = () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      persistenceTaskRef.current?.cancel();
      persistenceTaskRef.current = null;
      if (persistenceIdleFallbackTimerRef.current) {
        clearTimeout(persistenceIdleFallbackTimerRef.current);
        persistenceIdleFallbackTimerRef.current = null;
      }
      if (persistenceResumeTimerRef.current) {
        clearTimeout(persistenceResumeTimerRef.current);
        persistenceResumeTimerRef.current = null;
      }
    };
    const subscription = NativeAppState.addEventListener("change", (next) => {
      clearQueuedPersistence();
      if (next !== "active") {
        // Flush while leaving the foreground. This prevents a queued
        // InteractionManager task from waking up with the UI and blocking the
        // first taps after app switching.
        if (persistenceDirtyRef.current) {
          void persistLatestState(true).catch(() => undefined);
        }
        return;
      }
      // A native background Health Connect task may have updated storage while
      // this JS process remained suspended. Reconcile that small device-owned
      // delta before any queued foreground save can overwrite it.
      void (async () => {
        await persistenceWriteRef.current?.catch(() => undefined);
        const currentUserId = persistenceStateRef.current.currentUserId;
        const [saved, savedHealthStatus] = await Promise.all([
          AsyncStorage.getItem(APP_STORAGE_KEY).catch(() => null),
          AsyncStorage.getItem(
            `${HEALTH_STATUS_STORAGE_KEY}:${currentUserId}`,
          ).catch(() => null),
        ]);
        if (saved) {
          try {
            let importFromDate: string | undefined;
            if (savedHealthStatus) {
              const healthStatus = JSON.parse(
                savedHealthStatus,
              ) as PersistedHealthStatus;
              if (
                healthStatus.lastReason === "background" &&
                !healthStatus.error
              )
                importFromDate = healthStatus.lastImportFromDate;
            }
            const merged = mergeBackgroundHealthRows(
              persistenceStateRef.current,
              JSON.parse(saved) as AppState,
              importFromDate,
            );
            if (merged !== persistenceStateRef.current) {
              const committed = {
                ...merged,
                lastSavedAt: new Date().toISOString(),
              };
              persistenceStateRef.current = committed;
              persistenceObservedStateRef.current = committed;
              persistenceDirtyRef.current = true;
              persistenceRevisionRef.current += 1;
              dispatch({ type: "replaceLocal", state: committed });
            }
          } catch {
            // Keep the last valid in-memory snapshot if storage was interrupted.
          }
        }
        if (!persistenceDirtyRef.current) return;
        // Let navigation paint and resume-time subscriptions settle first.
        persistenceResumeTimerRef.current = setTimeout(() => {
          persistenceResumeTimerRef.current = null;
          queuePersistenceAfterInteractions();
        }, 4000);
      })();
    });
    return () => {
      subscription.remove();
      clearQueuedPersistence();
    };
  }, [ephemeral, hydrated, persistLatestState, queuePersistenceAfterInteractions]);

  useEffect(
    () => () => {
      if (persistenceTimerRef.current)
        clearTimeout(persistenceTimerRef.current);
      persistenceTaskRef.current?.cancel();
      if (persistenceResumeTimerRef.current)
        clearTimeout(persistenceResumeTimerRef.current);
      if (persistenceIdleFallbackTimerRef.current)
        clearTimeout(persistenceIdleFallbackTimerRef.current);
      // Do not leave a coalesced persistence promise waiting on a foreground
      // timer when the provider/app is being torn down.
      persistenceDeferredRunRef.current?.();
    },
    [],
  );

  const commitReducedState = useCallback(
    (next: AppState, persistImmediately = false) => {
      if (next === persistenceStateRef.current) return Promise.resolve();
      const committed = { ...next, lastSavedAt: new Date().toISOString() };
      persistenceStateRef.current = committed;
      persistenceObservedStateRef.current = committed;
      if (ephemeral) {
        dispatch({ type: "replaceLocal", state: committed });
        return Promise.resolve();
      }
      persistenceDirtyRef.current = true;
      persistenceRevisionRef.current += 1;
      dispatch({ type: "replaceLocal", state: committed });
      if (persistImmediately) return persistLatestState(true);
      scheduleDeferredPersistence();
      return Promise.resolve();
    },
    [ephemeral, persistLatestState, scheduleDeferredPersistence],
  );

  const commitAction = useCallback(
    (action: Exclude<Action, { type: "hydrate" } | { type: "replaceLocal" }>) => {
      const previous = persistenceStateRef.current;
      const next = withLocalDeletionTombstones(
        previous,
        reducer(previous, action),
      );
      return commitReducedState(next).catch(() => undefined);
    },
    [commitReducedState],
  );

  const replaceState = useCallback(
    (nextState: AppState) => {
      const next = reducer(persistenceStateRef.current, {
        type: "hydrate",
        state: nextState,
        preserveDeviceHealthSync: true,
      });
      void commitReducedState(next).catch(() => undefined);
    },
    [commitReducedState],
  );

  const stageState = useCallback((nextState: AppState) => {
    if (persistenceTimerRef.current) {
      clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    persistenceTaskRef.current?.cancel();
    persistenceTaskRef.current = null;
    if (persistenceResumeTimerRef.current) {
      clearTimeout(persistenceResumeTimerRef.current);
      persistenceResumeTimerRef.current = null;
    }
    const next = reducer(persistenceStateRef.current, {
      type: "hydrate",
      state: nextState,
      preserveDeviceHealthSync: false,
    });
    persistenceStateRef.current = next;
    persistenceObservedStateRef.current = next;
    persistenceDirtyRef.current = false;
    dispatch({ type: "replaceLocal", state: next });
  }, []);

  // These callbacks sit on provider/effect boundaries. Keeping their identity
  // stable prevents every unrelated entry, message, or presence update from
  // tearing down and rebuilding Health Connect and root notification effects.
  const updateSettingsAction = useCallback<
    AppContextValue["updateSettings"]
  >(
    (changes) => void commitAction({ type: "settings", changes }),
    [commitAction],
  );
  const importHealthEntriesAction = useCallback<
    AppContextValue["importHealthEntries"]
  >(
    (
      entries,
      provider,
      metricIds,
      fromDate,
      finalizeInitialImport,
      preserveTrackedGoalHistory,
      aggregateReplacement,
      deferPersistence,
    ) => {
      const previous = persistenceStateRef.current;
      const next = withLocalDeletionTombstones(
        previous,
        reducer(previous, {
          type: "importHealth",
          entries,
          provider,
          metricIds,
          fromDate,
          finalizeInitialImport,
          preserveTrackedGoalHistory,
          aggregateReplacement,
        }),
      );
      const changed = next !== previous;
      return commitReducedState(next, !deferPersistence).then(async () => {
        if (ephemeral || !changed) return;
        // Historical repairs must remain silent. Only a current-day value
        // crossing a configured threshold can emit an immediate milestone.
        if (entries.some((entry) => entry.localDate === dateKey())) {
          await notifyProgressMilestones(previous, next, dateKey());
        }
      });
    },
    [commitReducedState, ephemeral],
  );
  const flushLocalPersistenceAction = useCallback(
    () => (ephemeral ? Promise.resolve() : persistLatestState(true)),
    [ephemeral, persistLatestState],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      hydrated,
      logMetric: (
        metricId,
        entryValue,
        visibility,
        mode = "add",
        details,
        request,
      ) => {
        const previous = persistenceStateRef.current;
        const manualDeviceEntryCapability =
          metricId === "steps" &&
          mode === "replace" &&
          request?.source === "log-ui" &&
          request.deviceOwnedMetric === "steps"
            ? LOG_MANUAL_STEPS_CAPABILITY
            : undefined;
        const next = withLocalDeletionTombstones(
          previous,
          reducer(previous, {
            type: "log",
            metricId,
            value: entryValue,
            visibility,
            mode,
            details,
            manualDeviceEntryCapability,
          }),
        );
        void commitReducedState(next)
          .then(() => {
            if (ephemeral) return;
            return notifyProgressMilestones(
              previous,
              next,
              details?.localDate ?? dateKey(),
            );
          })
          .catch(() => undefined);
      },
      setDeviceScreenTime: (localDate, minutes, recordedAt) => {
        const previous = persistenceStateRef.current;
        const next = withLocalDeletionTombstones(
          previous,
          reducer(previous, {
            type: "deviceScreenTime",
            samples: [{ localDate, minutes, recordedAt }],
          }),
        );
        void commitReducedState(next)
          .then(() => {
            if (ephemeral) return;
            return notifyProgressMilestones(previous, next, localDate);
          })
          .catch(() => undefined);
      },
      setDeviceScreenTimeRange: (samples) => {
        if (!samples.length) return;
        const previous = persistenceStateRef.current;
        const next = withLocalDeletionTombstones(
          previous,
          reducer(previous, { type: "deviceScreenTime", samples }),
        );
        // Range hydration is a background import, not a user log action. Keep
        // it silent so opening Screen Time cannot race the foreground bridge
        // and emit duplicate progress notifications for today's sample.
        void commitReducedState(next).catch(() => undefined);
      },
      addMetric: (metric) => void commitAction({ type: "addMetric", metric }),
      addMetrics: (metrics) =>
        void commitAction({ type: "addMetrics", metrics }),
      updateMetric: (metricId, changes) =>
        void commitAction({ type: "updateMetric", metricId, changes }),
      deleteMetric: (metricId) => void commitAction({ type: "deleteMetric", metricId }),
      deleteEntry: (entryId) => void commitAction({ type: "deleteEntry", entryId }),
      updateFoodEntryTime: (entryId, clockTime) =>
        void commitAction({
          type: "updateFoodEntryTime",
          entryId,
          clockTime,
          editedAt: new Date().toISOString(),
        }),
      skipGoal: (metricId, localDate) => void commitAction({ type: "skipGoal", metricId, localDate }),
      deletePhoto: (photoId) => void commitAction({ type: "deletePhoto", photoId }),
      setMetricSection: (metricId, section, value, historyMode) =>
        void commitAction({
          type: "setMetricSection",
          metricId,
          section,
          value,
          historyMode,
        }),
      setTrackedGoal: (metricId, value, historyMode, startDate) =>
        void commitAction({
          type: "setTrackedGoal",
          metricId,
          value,
          historyMode,
          startDate,
        }),
      configurePersonalMetrics: (metrics, trackedGoalIds, historyMode) =>
        void commitAction({
          type: "configurePersonalMetrics",
          metrics,
          trackedGoalIds,
          historyMode,
        }),
      updateGroupMetric: (metricId, changes) =>
        void commitAction({ type: "updateGroupMetric", metricId, changes }),
      addGroupMetric: (metric) => void commitAction({ type: "addGroupMetric", metric }),
      addGroupMetrics: (metrics) =>
        void commitAction({ type: "addGroupMetrics", metrics }),
      deleteGroupMetric: (metricId) =>
        void commitAction({ type: "deleteGroupMetric", metricId }),
      moveMetric: (metricId, direction) =>
        void commitAction({ type: "moveMetric", metricId, direction }),
      reorderMetric: (metricId, targetIndex) =>
        void commitAction({ type: "reorderMetric", metricId, targetIndex }),
      selectGroupMetric: (metricId) =>
        void commitAction({ type: "selectGroupMetric", metricId }),
      saveGymPlan: (plan) => void commitAction({ type: "saveGymPlan", plan }),
      deleteGymPlan: (planId) => void commitAction({ type: "deleteGymPlan", planId }),
      saveGroupGymPlan: (plan) =>
        void commitAction({ type: "saveGroupGymPlan", plan }),
      deleteGroupGymPlan: (planId) =>
        void commitAction({ type: "deleteGroupGymPlan", planId }),
      saveGymSession: (session) => void commitAction({ type: "saveGymSession", session }),
      deleteGymSession: (sessionId) =>
        void commitAction({ type: "deleteGymSession", sessionId }),
      setGymExerciseGoal: (exerciseKey, goal) =>
        void commitAction({ type: "gymExerciseGoal", exerciseKey, goal }),
      addPhoto: (uri, caption, visibility, localDate, capturedAt) =>
        void commitAction({
          type: "addPhoto",
          uri,
          caption,
          visibility,
          localDate,
          capturedAt,
        }),
      setPhotoVisibility: (photoId, visibility) =>
        void commitAction({ type: "setPhotoVisibility", photoId, visibility }),
      sendMessage: (text, conversationId = "group", recipientId, imageUri) =>
        void commitAction({
          type: "sendMessage",
          text,
          conversationId,
          recipientId,
          imageUri,
        }),
      saveTodo: (todo) => void commitAction({ type: "saveTodo", todo }),
      deleteTodo: (todoId) => void commitAction({ type: "deleteTodo", todoId }),
      toggleTodo: (todoId, localDate) =>
        void commitAction({ type: "toggleTodo", todoId, localDate }),
      skipTodo: (todoId, localDate) =>
        void commitAction({ type: "skipTodo", todoId, localDate }),
      reorderTodo: (todoId, targetIndex) =>
        void commitAction({ type: "reorderTodo", todoId, targetIndex }),
      saveJournalNote: (note) =>
        void commitAction({ type: "saveJournalNote", note }),
      deleteJournalNote: (noteId) =>
        void commitAction({ type: "deleteJournalNote", noteId }),
      saveCalendarReminder: (reminder) =>
        void commitAction({ type: "saveCalendarReminder", reminder }),
      deleteCalendarReminder: (reminderId) =>
        void commitAction({ type: "deleteCalendarReminder", reminderId }),
      setActivityTimer: (timer, timerId) =>
        void commitAction({ type: "activityTimer", timer, timerId }),
      startFast: (metricId = "intermittent_fasting") =>
        void commitAction({
          type: "startFast",
          metricId,
          at: new Date().toISOString(),
        }),
      endFast: (metricId = "intermittent_fasting") =>
        void commitAction({
          type: "endFast",
          metricId,
          at: new Date().toISOString(),
        }),
      updateSettings: updateSettingsAction,
      updateEnergyProfile: (changes) =>
        void commitAction({ type: "energyProfile", changes }),
      createGroup: (name, options) =>
        void commitAction({ type: "createGroup", name, options }),
      joinGroup: (code) => void commitAction({ type: "joinGroup", code }),
      switchGroup: (groupId) => void commitAction({ type: "switchGroup", groupId }),
      leaveGroup: (groupId) => void commitAction({ type: "leaveGroup", groupId }),
      updateNickname: (memberId, nickname) =>
        void commitAction({ type: "nickname", memberId, nickname }),
      setGroupName: (name) => void commitAction({ type: "groupName", name }),
      setGroupRestDays: (value) => void commitAction({ type: "groupRestDays", value }),
      setGroupTheme: (color) => void commitAction({ type: "groupTheme", color }),
      setGroupApprovalRequired: (value) =>
        void commitAction({ type: "groupApproval", value }),
      approveMember: (memberId) =>
        void commitAction({ type: "approveMember", memberId }),
      removeMember: (memberId) =>
        void commitAction({ type: "removeMember", memberId }),
      updateMemberAvatar: (memberId, avatarUri) =>
        void commitAction({ type: "memberAvatar", memberId, avatarUri }),
      updateMemberName: (memberId, name) =>
        void commitAction({ type: "memberName", memberId, name }),
      setMemberRole: (memberId, role) =>
        void commitAction({ type: "memberRole", memberId, role }),
      importHealthEntries: importHealthEntriesAction,
      flushLocalPersistence: flushLocalPersistenceAction,
      stageState,
      replaceState,
      resetDemo: () => void commitAction({ type: "reset" }),
    }),
    [
      commitAction,
      commitReducedState,
      ephemeral,
      flushLocalPersistenceAction,
      hydrated,
      importHealthEntriesAction,
      stageState,
      replaceState,
      state,
      updateSettingsAction,
    ],
  );

  if (!hydrated) {
    return (
      <View style={styles.loadingScreen}>
        <Image
          source={require("../../assets/images/habhub-icon.png")}
          style={styles.loadingLogo}
          contentFit="cover"
          accessibilityLabel="HabHub logo"
        />
        <Text style={styles.loadingTitle}>HabHub</Text>
        <Text style={styles.loadingText}>Your goals, one clear direction.</Text>
        <ActivityIndicator
          color="#0FBFB8"
          style={styles.loadingSpinner}
        />
      </View>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    minHeight: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink,
    padding: 24,
  },
  loadingLogo: {
    width: 62,
    height: 62,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  loadingTitle: {
    color: palette.white,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  loadingText: { color: "#B1BED2", fontSize: 13, marginTop: 5 },
  loadingSpinner: { marginTop: 22 },
});
