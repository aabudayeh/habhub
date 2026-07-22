import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { createInitialState } from "@/src/data/seed";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  recommendedDailyDeficit,
  recommendedDailyIntake,
  recommendedDailyIntakeForDirection,
} from "@/src/domain/energy";
import {
  effectiveGoalTarget,
  goalCelebrationTiming,
  goalReached,
  isMetricTrackedOnDate,
  safeMetricValue,
} from "@/src/domain/metrics";
import { randomMessage } from "@/src/domain/social";
import { palette } from "@/src/theme";
import {
  AppState,
  DashboardSection,
  EnergyProfile,
  EntryDetails,
  Group,
  GymPlan,
  GymSession,
  MetricDefinition,
  MetricEntry,
  NewMetric,
  PhotoUpdate,
  Visibility,
} from "@/src/types";

export const APP_STORAGE_KEY = "paceboard-state-v1";

type Action =
  | { type: "hydrate"; state: AppState }
  | {
      type: "log";
      metricId: string;
      value: number | boolean | string;
      visibility: Visibility;
      details?: EntryDetails;
      mode: "add" | "replace";
    }
  | { type: "addMetric"; metric: NewMetric }
  | {
      type: "updateMetric";
      metricId: string;
      changes: Partial<MetricDefinition>;
    }
  | { type: "deleteMetric"; metricId: string }
  | { type: "deleteEntry"; entryId: string }
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
    }
  | {
      type: "configurePersonalMetrics";
      metrics: MetricDefinition[];
      trackedGoalIds: string[];
    }
  | {
      type: "updateGroupMetric";
      metricId: string;
      changes: Partial<MetricDefinition>;
    }
  | { type: "addGroupMetric"; metric: NewMetric }
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
  | { type: "settings"; changes: Partial<AppState["settings"]> }
  | { type: "energyProfile"; changes: Partial<EnergyProfile> }
  | { type: "createGroup"; name: string }
  | { type: "joinGroup"; code: string }
  | { type: "switchGroup"; groupId: string }
  | { type: "leaveGroup"; groupId: string }
  | { type: "nickname"; memberId: string; nickname: string }
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
  | { type: "saveGymSession"; session: GymSession }
  | { type: "deleteGymSession"; sessionId: string }
  | {
      type: "importHealth";
      entries: MetricEntry[];
      provider: NonNullable<MetricEntry["sourceProvider"]>;
      metricIds: string[];
      fromDate: string;
    }
  | { type: "reset" };

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function goalHistoryStart(state: AppState, metric: MetricDefinition) {
  const ownDates = state.entries
    .filter((entry) => entry.userId === state.currentUserId)
    .filter(
      (entry) =>
        entry.metricId === metric.id || metric.dataType === "calculated",
    )
    .map((entry) => entry.localDate);
  const allOwnDates = state.entries
    .filter((entry) => entry.userId === state.currentUserId)
    .map((entry) => entry.localDate);
  return [...ownDates, ...allOwnDates, metric.activeFrom].sort()[0];
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function withEnergyProfile(state: AppState, energyProfile: EnergyProfile) {
  const deficitTarget = recommendedDailyDeficit(energyProfile);
  const direction = state.settings.weightDirection ?? "lose";
  const foodTarget = recommendedDailyIntakeForDirection(energyProfile, direction);
  return withPersonalMetrics(
    {
      ...state,
      settings: { ...state.settings, energyProfile },
      energyProfiles: {
        ...state.energyProfiles,
        [state.currentUserId]: energyProfile,
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
          ? { ...metric, goal: { kind: "at_most" as const, target: foodTarget } }
          : metric.id === "weight"
            ? { ...metric, goal: { kind: direction === "gain" ? "at_least" as const : "at_most" as const, target: energyProfile.targetWeightKg } }
            : metric,
    ),
  );
}

function withPersonalMetrics(
  state: AppState,
  metrics: MetricDefinition[],
): AppState {
  return { ...state, metrics };
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

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return finalizeEndOfDayGoals(
        action.state,
        dateWithOffsetFrom(dateKey(), -1),
      );
    case "log": {
      const localDate = action.details?.localDate ?? dateKey();
      const metric = state.metrics.find(
        (candidate) => candidate.id === action.metricId,
      );
      if (metric?.id === "steps" || metric?.manualEntry === false) return state;
      const previousValue = metric
        ? safeMetricValue(state, metric, state.currentUserId, localDate)
        : 0;
      const cleanedEntries =
        action.mode === "replace"
          ? state.entries.filter(
              (entry) =>
                !(
                  entry.userId === state.currentUserId &&
                  entry.metricId === action.metricId &&
                  entry.localDate === localDate
                ),
            )
          : state.entries;
      let nextState: AppState = {
        ...state,
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
            recordedAt: action.details?.recordedAt ?? new Date().toISOString(),
            source: "manual",
            nutrition: action.details?.nutrition,
          },
        ],
      };
      if (
        metric?.id === "weight" &&
        typeof action.value === "number" &&
        Number.isFinite(action.value) &&
        localDate >=
          (state.entries
            .filter(
              (entry) =>
                entry.userId === state.currentUserId &&
                entry.metricId === "weight",
            )
            .map((entry) => entry.localDate)
            .sort()
            .at(-1) ?? "0000-00-00")
      ) {
        const energyProfile = {
          ...state.settings.energyProfile,
          weightKg: action.value,
        };
        nextState = withEnergyProfile(nextState, energyProfile);
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
    case "addMetric": {
      const baseId =
        (action.metric.templateId ?? slugify(action.metric.name)) || "metric";
      let id = baseId;
      let suffix = 2;
      while (state.metrics.some((metric) => metric.id === id))
        id = `${baseId}_${suffix++}`;
      const metric: MetricDefinition = {
        ...action.metric,
        id,
        aggregation:
          action.metric.aggregation ??
          (action.metric.dataType === "boolean"
            ? "max"
            : action.metric.dataType === "text" ||
                action.metric.dataType === "calculated"
              ? "latest"
              : "sum"),
        scoreWeight: 0,
        sections: { today: true, group: true, insights: true },
        order: state.metrics.length,
        activeFrom: action.metric.activeFrom ?? dateKey(),
      };
      delete (metric as MetricDefinition & { templateId?: string }).templateId;
      return withPersonalMetrics(state, [...state.metrics, metric]);
    }
    case "updateMetric":
      return withPersonalMetrics(
        state,
        state.metrics.map((metric) =>
          metric.id === action.metricId
            ? {
                ...metric,
                ...action.changes,
                activeFrom:
                  action.changes.activeFrom ??
                  (action.changes.scoreWeight !== undefined &&
                  action.changes.scoreWeight > 0 &&
                  metric.scoreWeight <= 0
                    ? dateKey()
                    : metric.activeFrom),
              }
            : metric,
        ),
      );
    case "deleteMetric":
      return {
        ...withPersonalMetrics(
          state,
          state.metrics
            .filter((metric) => metric.id !== action.metricId)
            .map((metric, order) => ({ ...metric, order })),
        ),
        entries: state.entries.filter(
          (entry) => entry.metricId !== action.metricId,
        ),
        trackedGoalPeriods: Object.fromEntries(
          Object.entries(state.trackedGoalPeriods).filter(
            ([metricId]) => metricId !== action.metricId,
          ),
        ),
        selectedGroupMetricId:
          state.selectedGroupMetricId === action.metricId
            ? "steps"
            : state.selectedGroupMetricId,
      };
    case "deleteEntry":
      return {
        ...state,
        entries: state.entries.filter(
          (entry) =>
            entry.id !== action.entryId ||
            entry.userId !== state.currentUserId ||
            entry.source !== "manual",
        ),
      };
    case "deletePhoto":
      return {
        ...state,
        photos: state.photos.filter(
          (photo) =>
            photo.id !== action.photoId ||
            photo.userId !== state.currentUserId,
        ),
      };
    case "setMetricSection": {
      const metric = state.metrics.find(
        (candidate) => candidate.id === action.metricId,
      );
      if (!metric) return state;
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
          action.historyMode === "history"
            ? [{ from: historyStart }]
            : [{ from: dateKey() }];
        return {
          ...state,
          metrics: metrics.map((candidate) =>
            candidate.id === metric.id
                ? {
                    ...candidate,
                    activeFrom:
                      action.historyMode === "history"
                        ? historyStart
                        : candidate.activeFrom,
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
        };
      }
      if (action.historyMode === "history") {
        return {
          ...state,
          trackedGoalPeriods: { ...state.trackedGoalPeriods, [metric.id]: [] },
        };
      }
      const yesterday = dateWithOffsetFrom(dateKey(), -1);
      const periods = existing.flatMap((period) =>
        !period.to
          ? period.from <= yesterday
            ? [{ ...period, to: yesterday }]
            : []
          : [period],
      );
      return {
        ...state,
        trackedGoalPeriods: {
          ...state.trackedGoalPeriods,
          [metric.id]: periods,
        },
      };
    }
    case "configurePersonalMetrics": {
      const today = dateKey();
      const metrics = action.metrics.map((metric, order) => ({
        ...metric,
        order,
        activeFrom: today,
      }));
      return {
        ...state,
        metrics,
        trackedGoalPeriods: Object.fromEntries(
          metrics.map((metric) => [
            metric.id,
            action.trackedGoalIds.includes(metric.id) ? [{ from: today }] : [],
          ]),
        ),
        selectedGroupMetricId: state.selectedGroupMetricId,
      };
    }
    case "updateGroupMetric": {
      const configuration = (state.group.metricConfiguration ?? []).map(
        (metric) =>
          metric.id === action.metricId
            ? { ...metric, ...action.changes }
            : metric,
      );
      const group = { ...state.group, metricConfiguration: configuration };
      const metrics = state.metrics.map((personal) =>
        personal.id === action.metricId
          ? {
              ...personal,
              ...action.changes,
              goal: personal.goal,
              goalRange: personal.goalRange,
              goalEnabled: personal.goalEnabled,
              defaultVisibility: personal.defaultVisibility,
              sections: personal.sections,
              scoreWeight: personal.scoreWeight,
            }
          : personal,
      );
      return {
        ...state,
        metrics,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "addGroupMetric": {
      const base =
        slugify(action.metric.templateId ?? action.metric.name) ||
        "group_tracker";
      let id = base;
      let suffix = 2;
      const existing = state.group.metricConfiguration ?? [];
      while (existing.some((metric) => metric.id === id))
        id = `${base}_${suffix++}`;
      const metric: MetricDefinition = {
        ...action.metric,
        id,
        order: existing.length,
        activeFrom: action.metric.activeFrom ?? dateKey(),
        scoreWeight:
          action.metric.dataType === "text" ||
          action.metric.dataType === "photo"
            ? 0
            : 1,
        sections: { today: true, insights: true, group: true },
      };
      const group = {
        ...state.group,
        metricConfiguration: [...existing, metric],
      };
      const metrics = state.metrics.some((item) => item.id === id)
        ? state.metrics
        : [...state.metrics, { ...metric, order: state.metrics.length }];
      return {
        ...state,
        metrics,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
        trackedGoalPeriods: { ...state.trackedGoalPeriods, [id]: [] },
      };
    }
    case "deleteGroupMetric": {
      const group = {
        ...state.group,
        metricConfiguration: (state.group.metricConfiguration ?? [])
          .filter((metric) => metric.id !== action.metricId)
          .map((metric, order) => ({ ...metric, order })),
      };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
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
    case "saveGymSession":
      return {
        ...state,
        gymSessions: [
          action.session,
          ...(state.gymSessions ?? []).filter((item) => item.id !== action.session.id),
        ],
      };
    case "deleteGymSession":
      return {
        ...state,
        gymSessions: (state.gymSessions ?? []).filter(
          (item) => item.id !== action.sessionId,
        ),
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
    case "settings": {
      const next = { ...state, settings: { ...state.settings, ...action.changes } };
      return action.changes.weightDirection
        ? withEnergyProfile(next, next.settings.energyProfile)
        : next;
    }
    case "energyProfile": {
      const energyProfile = {
        ...state.settings.energyProfile,
        ...action.changes,
      };
      return withEnergyProfile(state, energyProfile);
    }
    case "createGroup": {
      const currentMember = state.group.members.find(
        (member) => member.id === state.currentUserId,
      );
      if (!currentMember || !action.name.trim()) return state;
      const group: Group = {
        id: uniqueId("group"),
        name: action.name.trim(),
        inviteCode: `PACE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        templateName: "Healthy Competition",
        members: [{ ...currentMember, role: "owner" }],
        streakRestDaysPerWeek: 1,
        metricConfiguration: state.metrics.map((metric) => ({
          ...metric,
          scoreWeight:
            metric.goalEnabled === false ||
            metric.dataType === "photo" ||
            metric.dataType === "text"
              ? 0
              : 10,
          sections: { ...metric.sections, group: true },
        })),
      };
      const groups = state.groups.map((candidate) =>
        candidate.id === state.group.id ? state.group : candidate,
      );
      return { ...state, group, groups: [...groups, group] };
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
        metricConfiguration: state.metrics.map((metric) => ({
          ...metric,
          scoreWeight:
            metric.goalEnabled === false ||
            metric.dataType === "photo" ||
            metric.dataType === "text"
              ? 0
              : 10,
          sections: { ...metric.sections, group: true },
        })),
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
      return { ...state, group };
    }
    case "leaveGroup": {
      if (state.groups.length <= 1) return state;
      const groups = state.groups.filter(
        (group) => group.id !== action.groupId,
      );
      if (state.group.id !== action.groupId) return { ...state, groups };
      const group = groups[0];
      return { ...state, groups, group };
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
    case "groupRestDays": {
      const value = Math.max(0, Math.min(6, Math.round(action.value)));
      const group = { ...state.group, streakRestDaysPerWeek: value };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "groupTheme": {
      const group = { ...state.group, themeColor: action.color };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "groupApproval": {
      const group = { ...state.group, requireMemberApproval: action.value };
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
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
      const name = action.name.trim();
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
      return {
        ...state,
        group,
        groups: state.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        ),
      };
    }
    case "importHealth": {
      const replaceIds = new Set(action.metricIds);
      const preserved = state.entries.filter(
        (entry) =>
          !(
            entry.userId === state.currentUserId &&
            entry.sourceProvider === action.provider &&
            replaceIds.has(entry.metricId) &&
            entry.localDate >= action.fromDate
          ),
      );
      const byId = new Map(preserved.map((entry) => [entry.id, entry]));
      for (const entry of action.entries) byId.set(entry.id, entry);
      const latestWeight = action.entries
        .filter(
          (entry) =>
            entry.metricId === "weight" &&
            entry.userId === state.currentUserId &&
            Number(entry.value) > 0,
        )
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      const existingLatestWeight = state.entries
        .filter(
          (entry) =>
            entry.metricId === "weight" &&
            entry.userId === state.currentUserId &&
            Number(entry.value) > 0,
        )
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      if (
        !latestWeight ||
        (existingLatestWeight &&
          latestWeight.recordedAt < existingLatestWeight.recordedAt)
      )
        return { ...state, entries: [...byId.values()] };
      const energyProfile = {
        ...state.settings.energyProfile,
        weightKg: Number(latestWeight.value),
      };
      return withEnergyProfile(
        { ...state, entries: [...byId.values()] },
        energyProfile,
      );
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
  ) => void;
  addMetric: (metric: NewMetric) => void;
  updateMetric: (metricId: string, changes: Partial<MetricDefinition>) => void;
  deleteMetric: (metricId: string) => void;
  deleteEntry: (entryId: string) => void;
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
  ) => void;
  configurePersonalMetrics: (
    metrics: MetricDefinition[],
    trackedGoalIds: string[],
  ) => void;
  updateGroupMetric: (
    metricId: string,
    changes: Partial<MetricDefinition>,
  ) => void;
  addGroupMetric: (metric: NewMetric) => void;
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
  updateSettings: (changes: Partial<AppState["settings"]>) => void;
  updateEnergyProfile: (changes: Partial<EnergyProfile>) => void;
  createGroup: (name: string) => void;
  joinGroup: (code: string) => void;
  switchGroup: (groupId: string) => void;
  leaveGroup: (groupId: string) => void;
  updateNickname: (memberId: string, nickname: string) => void;
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
  saveGymSession: (session: GymSession) => void;
  deleteGymSession: (sessionId: string) => void;
  importHealthEntries: (
    entries: MetricEntry[],
    provider: NonNullable<MetricEntry["sourceProvider"]>,
    metricIds: string[],
    fromDate: string,
  ) => void;
  replaceState: (state: AppState) => void;
  resetDemo: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(APP_STORAGE_KEY)
      .then((saved) => {
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
            version: 17,
            settings: {
              ...defaults.settings,
              ...restored.settings,
              onboardingComplete:
                restored.settings?.onboardingComplete ?? restoredVersion < 15,
              energyProfile: {
                ...defaults.settings.energyProfile,
                ...restored.settings?.energyProfile,
              },
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
              if (restoredVersion < 4 && normalized.id === "weight")
                return {
                  ...normalized,
                  sections: { ...normalized.sections, today: false },
                };
              const profile = {
                ...defaults.settings.energyProfile,
                ...restored.settings?.energyProfile,
              };
              if (
                restoredVersion < 4 &&
                normalized.id === "deficit" &&
                normalized.goal.target === 500
              )
                return {
                  ...normalized,
                  goal: {
                    ...normalized.goal,
                    target: recommendedDailyDeficit(profile),
                  },
                };
              if (
                restoredVersion < 4 &&
                normalized.id === "food" &&
                normalized.goal.target === 2000
              )
                return {
                  ...normalized,
                  goal: {
                    ...normalized.goal,
                    target: recommendedDailyIntake(profile),
                  },
                };
              return normalized;
            }),
            group: {
              ...(restored.group ?? defaults.group),
              streakRestDaysPerWeek: restored.group?.streakRestDaysPerWeek ?? 1,
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
              streakRestDaysPerWeek: group.streakRestDaysPerWeek ?? 1,
              metricConfiguration:
                restoredVersion < 13 && group.id === defaults.group.id
                  ? restoredMetrics
                  : (group.metricConfiguration ?? restoredMetrics),
            })),
            energyProfiles: {
              ...defaults.energyProfiles,
              ...restored.energyProfiles,
              [restored.currentUserId ?? defaults.currentUserId]: {
                ...defaults.settings.energyProfile,
                ...restored.settings?.energyProfile,
              },
            },
            messages: (restored.messages ?? defaults.messages).map(
              (message) => ({
                ...message,
                conversationId: message.conversationId ?? "group",
              }),
            ),
            dailyMetricStatuses: restored.dailyMetricStatuses ?? [],
          };
          dispatch({
            type: "hydrate",
            state: restoredState,
          });
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = setTimeout(() => {
      AsyncStorage.setItem(
        APP_STORAGE_KEY,
        JSON.stringify({ ...state, lastSavedAt: new Date().toISOString() }),
      ).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timeout);
  }, [hydrated, state]);

  const replaceState = useCallback(
    (nextState: AppState) => dispatch({ type: "hydrate", state: nextState }),
    [],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      hydrated,
      logMetric: (metricId, entryValue, visibility, mode = "add", details) =>
        dispatch({
          type: "log",
          metricId,
          value: entryValue,
          visibility,
          mode,
          details,
        }),
      addMetric: (metric) => dispatch({ type: "addMetric", metric }),
      updateMetric: (metricId, changes) =>
        dispatch({ type: "updateMetric", metricId, changes }),
      deleteMetric: (metricId) => dispatch({ type: "deleteMetric", metricId }),
      deleteEntry: (entryId) => dispatch({ type: "deleteEntry", entryId }),
      deletePhoto: (photoId) => dispatch({ type: "deletePhoto", photoId }),
      setMetricSection: (metricId, section, value, historyMode) =>
        dispatch({
          type: "setMetricSection",
          metricId,
          section,
          value,
          historyMode,
        }),
      setTrackedGoal: (metricId, value, historyMode) =>
        dispatch({ type: "setTrackedGoal", metricId, value, historyMode }),
      configurePersonalMetrics: (metrics, trackedGoalIds) =>
        dispatch({ type: "configurePersonalMetrics", metrics, trackedGoalIds }),
      updateGroupMetric: (metricId, changes) =>
        dispatch({ type: "updateGroupMetric", metricId, changes }),
      addGroupMetric: (metric) => dispatch({ type: "addGroupMetric", metric }),
      deleteGroupMetric: (metricId) =>
        dispatch({ type: "deleteGroupMetric", metricId }),
      moveMetric: (metricId, direction) =>
        dispatch({ type: "moveMetric", metricId, direction }),
      reorderMetric: (metricId, targetIndex) =>
        dispatch({ type: "reorderMetric", metricId, targetIndex }),
      selectGroupMetric: (metricId) =>
        dispatch({ type: "selectGroupMetric", metricId }),
      saveGymPlan: (plan) => dispatch({ type: "saveGymPlan", plan }),
      deleteGymPlan: (planId) => dispatch({ type: "deleteGymPlan", planId }),
      saveGymSession: (session) => dispatch({ type: "saveGymSession", session }),
      deleteGymSession: (sessionId) =>
        dispatch({ type: "deleteGymSession", sessionId }),
      addPhoto: (uri, caption, visibility, localDate, capturedAt) =>
        dispatch({
          type: "addPhoto",
          uri,
          caption,
          visibility,
          localDate,
          capturedAt,
        }),
      setPhotoVisibility: (photoId, visibility) =>
        dispatch({ type: "setPhotoVisibility", photoId, visibility }),
      sendMessage: (text, conversationId = "group", recipientId, imageUri) =>
        dispatch({
          type: "sendMessage",
          text,
          conversationId,
          recipientId,
          imageUri,
        }),
      updateSettings: (changes) => dispatch({ type: "settings", changes }),
      updateEnergyProfile: (changes) =>
        dispatch({ type: "energyProfile", changes }),
      createGroup: (name) => dispatch({ type: "createGroup", name }),
      joinGroup: (code) => dispatch({ type: "joinGroup", code }),
      switchGroup: (groupId) => dispatch({ type: "switchGroup", groupId }),
      leaveGroup: (groupId) => dispatch({ type: "leaveGroup", groupId }),
      updateNickname: (memberId, nickname) =>
        dispatch({ type: "nickname", memberId, nickname }),
      setGroupRestDays: (value) => dispatch({ type: "groupRestDays", value }),
      setGroupTheme: (color) => dispatch({ type: "groupTheme", color }),
      setGroupApprovalRequired: (value) =>
        dispatch({ type: "groupApproval", value }),
      approveMember: (memberId) =>
        dispatch({ type: "approveMember", memberId }),
      removeMember: (memberId) =>
        dispatch({ type: "removeMember", memberId }),
      updateMemberAvatar: (memberId, avatarUri) =>
        dispatch({ type: "memberAvatar", memberId, avatarUri }),
      updateMemberName: (memberId, name) =>
        dispatch({ type: "memberName", memberId, name }),
      setMemberRole: (memberId, role) =>
        dispatch({ type: "memberRole", memberId, role }),
      importHealthEntries: (entries, provider, metricIds, fromDate) =>
        dispatch({
          type: "importHealth",
          entries,
          provider,
          metricIds,
          fromDate,
        }),
      replaceState,
      resetDemo: () => dispatch({ type: "reset" }),
    }),
    [hydrated, replaceState, state],
  );

  if (!hydrated) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingMark}>
          <Text style={styles.loadingInitial}>N</Text>
        </View>
        <Text style={styles.loadingTitle}>MetricRally</Text>
        <Text style={styles.loadingText}>Your goals, one clear direction.</Text>
        <ActivityIndicator
          color={palette.primary}
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
    backgroundColor: palette.canvas,
    padding: 24,
  },
  loadingMark: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink,
    marginBottom: 16,
  },
  loadingInitial: { color: palette.lime, fontSize: 30, fontWeight: "900" },
  loadingTitle: {
    color: palette.ink,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  loadingText: { color: palette.muted, fontSize: 13, marginTop: 5 },
  loadingSpinner: { marginTop: 22 },
});
