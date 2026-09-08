import { supabase } from "@/src/lib/supabase";
import {
  dispatchCommittedGroupPushEvent,
  flushPendingGroupPushEvents,
} from "@/src/cloud/groupCloud";
import type { GroupNote, GroupScheduleItem } from "@/src/types";

type GroupNoteRow = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string | null;
  body: string;
  revision: number | string;
  created_at: string;
  updated_at: string;
};

type GroupScheduleRow = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  revision: number | string;
  created_at: string;
  updated_at: string;
};

export type SaveGroupNoteInput = {
  id?: string;
  groupId: string;
  title?: string;
  body: string;
  expectedRevision?: number;
};

export type SaveGroupScheduleInput = {
  id?: string;
  groupId: string;
  title: string;
  notes?: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  expectedRevision?: number;
};

function cloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .join(" · ");
    if (message) return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function noteFromRow(row: GroupNoteRow): GroupNote {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    title: row.title?.trim() || undefined,
    body: row.body,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleFromRow(row: GroupScheduleRow): GroupScheduleItem {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    title: row.title,
    notes: row.notes?.trim() || undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? undefined,
    allDay: row.all_day,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dispatchWorkspaceUpdate(
  kind: "group-note" | "group-schedule",
  id: string,
  revision: number,
) {
  const eventKey = `${kind}:${id}:r${revision}`;
  void dispatchCommittedGroupPushEvent(eventKey).catch(() =>
    flushPendingGroupPushEvents().catch(() => undefined),
  );
}

export async function loadGroupNotes(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_notes")
    .select("id, group_id, creator_id, title, body, revision, created_at, updated_at")
    .eq("group_id", groupId)
    .order("updated_at", { ascending: false })
    .limit(250);
  if (error) throw cloudError(error);
  return ((data as GroupNoteRow[] | null) ?? []).map(noteFromRow);
}

export async function saveGroupNote(input: SaveGroupNoteInput) {
  if (!supabase) throw new Error("Sign in to save a group note.");
  const { data, error } = await supabase.rpc("save_group_note", {
    p_note_id: input.id ?? null,
    p_group_id: input.groupId,
    p_title: input.title?.trim() || null,
    p_body: input.body.trim(),
    p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) throw cloudError(error);
  const saved = noteFromRow(data as GroupNoteRow);
  dispatchWorkspaceUpdate("group-note", saved.id, saved.revision);
  return saved;
}

export async function deleteGroupNote(noteId: string, expectedRevision: number) {
  if (!supabase) throw new Error("Sign in to delete a group note.");
  const { error } = await supabase.rpc("delete_group_note", {
    p_note_id: noteId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw cloudError(error);
}

export async function loadGroupSchedule(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_schedule_items")
    .select("id, group_id, creator_id, title, notes, starts_at, ends_at, all_day, revision, created_at, updated_at")
    .eq("group_id", groupId)
    .gte("starts_at", new Date(Date.now() - 31 * 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw cloudError(error);
  return ((data as GroupScheduleRow[] | null) ?? []).map(scheduleFromRow);
}

export async function saveGroupScheduleItem(input: SaveGroupScheduleInput) {
  if (!supabase) throw new Error("Sign in to save a group event.");
  const { data, error } = await supabase.rpc("save_group_schedule_item", {
    p_item_id: input.id ?? null,
    p_group_id: input.groupId,
    p_title: input.title.trim(),
    p_notes: input.notes?.trim() || null,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt ?? null,
    p_all_day: input.allDay,
    p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) throw cloudError(error);
  const saved = scheduleFromRow(data as GroupScheduleRow);
  dispatchWorkspaceUpdate("group-schedule", saved.id, saved.revision);
  return saved;
}

export async function deleteGroupScheduleItem(
  itemId: string,
  expectedRevision: number,
) {
  if (!supabase) throw new Error("Sign in to delete a group event.");
  const { error } = await supabase.rpc("delete_group_schedule_item", {
    p_item_id: itemId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw cloudError(error);
}
