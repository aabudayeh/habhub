import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteGroupNote,
  deleteGroupScheduleItem,
  loadGroupNotes,
  loadGroupSchedule,
  saveGroupNote,
  saveGroupScheduleItem,
  type SaveGroupNoteInput,
  type SaveGroupScheduleInput,
} from "@/src/cloud/groupHubContent";
import { subscribePrivateBroadcast } from "@/src/cloud/privateBroadcast";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { dateKeyWithOffset } from "@/src/domain/date";
import { canonicalGroupScheduleAllDayInstant } from "@/src/domain/groupHub";
import { supabase } from "@/src/lib/supabase";
import { useUserSafety } from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandbox } from "@/src/tutorial/TutorialSandboxContext";
import type { GroupNote, GroupScheduleItem } from "@/src/types";

type HubKind = "notes" | "schedule";
type HubRows = { notes: GroupNote; schedule: GroupScheduleItem };

const rowsByScope = {
  notes: new Map<string, GroupNote[]>(),
  schedule: new Map<string, GroupScheduleItem[]>(),
};
const listenersByScope = {
  notes: new Map<string, Set<(rows: GroupNote[]) => void>>(),
  schedule: new Map<string, Set<(rows: GroupScheduleItem[]) => void>>(),
};
const requestsByScope = {
  notes: new Map<string, Promise<GroupNote[]>>(),
  schedule: new Map<string, Promise<GroupScheduleItem[]>>(),
};

function accountGroupScopeKey(currentUserId: string, groupId: string) {
  return `${currentUserId}\u0000${groupId}`;
}

function emit<K extends HubKind>(kind: K, scopeKey: string, rows: HubRows[K][]) {
  rowsByScope[kind].set(scopeKey, rows as never);
  const listeners = listenersByScope[kind].get(scopeKey) as
    | Set<(rows: HubRows[K][]) => void>
    | undefined;
  listeners?.forEach((listener) => listener(rows));
}

function localSeed<K extends HubKind>(
  kind: K,
  scopeKey: string,
  groupId: string,
  currentUserId: string,
  memberIds: readonly string[],
): HubRows[K][] {
  const cached = rowsByScope[kind].get(scopeKey) as HubRows[K][] | undefined;
  if (cached) return cached;
  const now = new Date();
  const creators = [
    ...new Set([currentUserId, ...memberIds.filter(Boolean)]),
  ];
  const creatorAt = (index: number) =>
    creators[index % creators.length] ?? currentUserId;
  const timestampMinutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();
  const rows = (kind === "notes"
    ? [
        {
          id: `demo-group-note-${groupId}`,
          groupId,
          creatorId: creatorAt(0),
          title: "Weekend game plan",
          body: "Saturday · Trail walk at 10:00\nSunday · Meal prep and weekly check-in\nBring water and choose an easy pace.",
          revision: 1,
          createdAt: timestampMinutesAgo(190),
          updatedAt: timestampMinutesAgo(24),
        },
        {
          id: `demo-group-note-meals-${groupId}`,
          groupId,
          creatorId: creatorAt(1),
          title: "Meal-prep swap list",
          body: "Protein: lemon chicken or crispy tofu\nCarbs: herbed rice or roast potatoes\nSnack: Greek yogurt, berries, and walnuts",
          revision: 2,
          createdAt: timestampMinutesAgo(1_860),
          updatedAt: timestampMinutesAgo(95),
        },
        {
          id: `demo-group-note-challenge-${groupId}`,
          groupId,
          creatorId: creatorAt(2),
          title: "September challenge tips",
          body: "Log the small wins too. A ten-minute walk keeps momentum alive, and cheering somebody else counts as showing up for the team.",
          revision: 1,
          createdAt: timestampMinutesAgo(720),
          updatedAt: timestampMinutesAgo(340),
        },
      ]
    : [
        {
          id: `demo-group-event-${groupId}`,
          groupId,
          creatorId: creatorAt(0),
          title: "Sunrise group walk",
          notes: "Easy pace · meet by the park entrance.",
          startsAt: `${dateKeyWithOffset(1)}T10:00:00`,
          endsAt: `${dateKeyWithOffset(1)}T11:00:00`,
          allDay: false,
          revision: 1,
          createdAt: timestampMinutesAgo(140),
          updatedAt: timestampMinutesAgo(20),
        },
        {
          id: `demo-group-event-prep-${groupId}`,
          groupId,
          creatorId: creatorAt(1),
          title: "Meal-prep Sunday",
          notes: "Share one reliable recipe in Group Notes.",
          startsAt: canonicalGroupScheduleAllDayInstant(dateKeyWithOffset(3))!,
          allDay: true,
          revision: 1,
          createdAt: timestampMinutesAgo(980),
          updatedAt: timestampMinutesAgo(260),
        },
        {
          id: `demo-group-event-strength-${groupId}`,
          groupId,
          creatorId: creatorAt(2),
          title: "Full-body circuit",
          notes: "Three friendly rounds; every movement has a low-impact option.",
          startsAt: `${dateKeyWithOffset(5)}T18:30:00`,
          endsAt: `${dateKeyWithOffset(5)}T19:20:00`,
          allDay: false,
          revision: 2,
          createdAt: timestampMinutesAgo(2_400),
          updatedAt: timestampMinutesAgo(420),
        },
      ]) as HubRows[K][];
  rowsByScope[kind].set(scopeKey, rows as never);
  return rows;
}

function useGroupHubRows<K extends HubKind>(kind: K, groupId: string) {
  const { state } = useApp();
  const tutorial = useTutorialSandbox();
  const safety = useUserSafety(state.currentUserId, tutorial.active);
  const scopeKey = accountGroupScopeKey(state.currentUserId, groupId);
  const memberIds = useMemo(
    () => state.group.members.map((member) => member.id),
    [state.group.members],
  );
  const cloudEnabled = !tutorial.active && Boolean(supabase) && isCloudGroupId(groupId);
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    rows: HubRows[K][];
  }>(() => ({
    scopeKey,
    rows: cloudEnabled
      ? ((rowsByScope[kind].get(scopeKey) ?? []) as HubRows[K][])
      : localSeed(kind, scopeKey, groupId, state.currentUserId, memberIds),
  }));
  const rows = useMemo(
    () =>
      snapshot.scopeKey === scopeKey
        ? snapshot.rows
        : cloudEnabled
          ? ((rowsByScope[kind].get(scopeKey) ?? []) as HubRows[K][])
          : localSeed(
              kind,
              scopeKey,
              groupId,
              state.currentUserId,
              memberIds,
            ),
    [cloudEnabled, groupId, kind, memberIds, scopeKey, snapshot, state.currentUserId],
  );
  const setRows = useCallback(
    (next: HubRows[K][]) => setSnapshot({ scopeKey, rows: next }),
    [scopeKey],
  );
  const [loading, setLoading] = useState(cloudEnabled && rows.length === 0);
  const [error, setError] = useState<string>();
  const errorScopeRef = useRef(scopeKey);
  // A route-triggered group switch can render once before the new request
  // resolves. Never expose the previous group's cached rows in that frame.
  const groupRows = useMemo(
    () => rows.filter((row) => row.groupId === groupId),
    [groupId, rows],
  );
  // Blocking is an access rule, not a presentation preference. Cached rows
  // from before a block must disappear immediately, and remote authors stay
  // fail-closed until the account's safety state has hydrated.
  const scopedRows = useMemo(
    () =>
      groupRows.filter(
        (row) =>
          row.creatorId === state.currentUserId ||
          (safety.hydrated && !safety.blockedUserIds.has(row.creatorId)),
      ),
    [groupRows, safety.blockedUserIds, safety.hydrated, state.currentUserId],
  );
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const refresh = useCallback(() => {
    if (!cloudEnabled) {
      setRows(
        localSeed(
          kind,
          scopeKey,
          groupId,
          state.currentUserId,
          memberIds,
        ),
      );
      setLoading(false);
      errorScopeRef.current = scopeKey;
      setError(undefined);
      return Promise.resolve();
    }
    const existing = requestsByScope[kind].get(scopeKey) as
      | Promise<HubRows[K][]>
      | undefined;
    if (existing) return existing.then(() => undefined);
    setLoading(true);
    const request = (kind === "notes"
      ? loadGroupNotes(groupId)
      : loadGroupSchedule(groupId)) as Promise<HubRows[K][]>;
    requestsByScope[kind].set(scopeKey, request as never);
    return request
      .then((next) => {
        emit(kind, scopeKey, next);
        if (scopeRef.current === scopeKey) {
          setRows(next);
          errorScopeRef.current = scopeKey;
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (scopeRef.current === scopeKey) {
          errorScopeRef.current = scopeKey;
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (requestsByScope[kind].get(scopeKey) === request)
          requestsByScope[kind].delete(scopeKey);
        if (scopeRef.current === scopeKey) setLoading(false);
      });
  }, [cloudEnabled, groupId, kind, memberIds, scopeKey, setRows, state.currentUserId]);

  useEffect(() => {
    const map = listenersByScope[kind] as Map<
      string,
      Set<(rows: HubRows[K][]) => void>
    >;
    const listeners = map.get(scopeKey) ?? new Set();
    const listener = (next: HubRows[K][]) => setRows(next);
    listeners.add(listener);
    map.set(scopeKey, listeners);
    void refresh();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) map.delete(scopeKey);
    };
  }, [kind, refresh, scopeKey, setRows]);

  useEffect(() => {
    if (!cloudEnabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePrivateBroadcast(
      `group:${groupId}:workspace`,
      "group_hub_updated",
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 140);
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [cloudEnabled, groupId, refresh]);

  const replace = useCallback(
    (next: HubRows[K][]) => emit(kind, scopeKey, next),
    [kind, scopeKey],
  );
  return {
    rows: scopedRows,
    loading:
      loading ||
      (cloudEnabled && snapshot.scopeKey !== scopeKey && !scopedRows.length),
    error: errorScopeRef.current === scopeKey ? error : undefined,
    refresh,
    replace,
    cachedRows: groupRows,
    cloudEnabled,
  };
}

export function useGroupNotes(groupId: string) {
  const { state } = useApp();
  const model = useGroupHubRows("notes", groupId);
  const save = useCallback(
    async (input: SaveGroupNoteInput) => {
      const before = model.cachedRows;
      const now = new Date().toISOString();
      const prior = input.id ? before.find((item) => item.id === input.id) : undefined;
      const optimistic: GroupNote = {
        id: input.id ?? `local-group-note-${Date.now().toString(36)}`,
        groupId,
        creatorId: prior?.creatorId ?? state.currentUserId,
        title: input.title?.trim() || undefined,
        body: input.body.trim(),
        revision: (prior?.revision ?? 0) + 1,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      model.replace([optimistic, ...before.filter((item) => item.id !== optimistic.id)]);
      if (!model.cloudEnabled) return optimistic;
      try {
        const saved = await saveGroupNote(input);
        model.replace([saved, ...before.filter((item) => item.id !== saved.id)]);
        return saved;
      } catch (reason) {
        model.replace(before);
        void model.refresh();
        throw reason;
      }
    },
    [groupId, model, state.currentUserId],
  );
  const remove = useCallback(
    async (note: GroupNote) => {
      const before = model.cachedRows;
      model.replace(before.filter((item) => item.id !== note.id));
      if (!model.cloudEnabled) return;
      try {
        await deleteGroupNote(note.id, note.revision);
      } catch (reason) {
        model.replace(before);
        void model.refresh();
        throw reason;
      }
    },
    [model],
  );
  return {
    rows: model.rows,
    notes: model.rows,
    loading: model.loading,
    error: model.error,
    refresh: model.refresh,
    replace: model.replace,
    cloudEnabled: model.cloudEnabled,
    save,
    remove,
  };
}

export function useGroupSchedule(groupId: string) {
  const { state } = useApp();
  const model = useGroupHubRows("schedule", groupId);
  const save = useCallback(
    async (input: SaveGroupScheduleInput) => {
      const before = model.cachedRows;
      const now = new Date().toISOString();
      const prior = input.id ? before.find((item) => item.id === input.id) : undefined;
      const optimistic: GroupScheduleItem = {
        id: input.id ?? `local-group-event-${Date.now().toString(36)}`,
        groupId,
        creatorId: prior?.creatorId ?? state.currentUserId,
        title: input.title.trim(),
        notes: input.notes?.trim() || undefined,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        revision: (prior?.revision ?? 0) + 1,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      model.replace(
        [optimistic, ...before.filter((item) => item.id !== optimistic.id)].sort(
          (left, right) => left.startsAt.localeCompare(right.startsAt),
        ),
      );
      if (!model.cloudEnabled) return optimistic;
      try {
        const saved = await saveGroupScheduleItem(input);
        model.replace(
          [saved, ...before.filter((item) => item.id !== saved.id)].sort(
            (left, right) => left.startsAt.localeCompare(right.startsAt),
          ),
        );
        return saved;
      } catch (reason) {
        model.replace(before);
        void model.refresh();
        throw reason;
      }
    },
    [groupId, model, state.currentUserId],
  );
  const remove = useCallback(
    async (item: GroupScheduleItem) => {
      const before = model.cachedRows;
      model.replace(before.filter((candidate) => candidate.id !== item.id));
      if (!model.cloudEnabled) return;
      try {
        await deleteGroupScheduleItem(item.id, item.revision);
      } catch (reason) {
        model.replace(before);
        void model.refresh();
        throw reason;
      }
    },
    [model],
  );
  return {
    rows: model.rows,
    items: model.rows,
    loading: model.loading,
    error: model.error,
    refresh: model.refresh,
    replace: model.replace,
    cloudEnabled: model.cloudEnabled,
    save,
    remove,
  };
}
