import { supabase } from "@/src/lib/supabase";
import {
  dispatchCommittedGroupPushEvent,
  flushPendingGroupPushEvents,
} from "@/src/cloud/groupCloud";
import type { GroupNote, GroupScheduleItem } from "@/src/types";
import { dateKey } from "@/src/domain/date";
import { groupScheduleCalendarRange } from "@/src/domain/groupSchedule";

const NOTE_MEDIA_BUCKET = "paceboard-media";
const NOTE_COLUMNS = "id, group_id, creator_id, title, body, image_path, image_owner_id, revision, created_at, updated_at";
const noteCleanupRequests = new Map<string, Promise<void>>();
const noteCleanupAfter = new Map<string, number>();

async function notesFromRows(rows: GroupNoteRow[]) {
  const notes = rows.map(noteFromRow);
  if (!supabase) return notes;
  const paths = [...new Set(notes.map((note) => note.imageStoragePath).filter((path): path is string => Boolean(path)))];
  const urls = new Map<string, string>();
  for (let offset = 0; offset < paths.length; offset += 100) {
    try {
      const { data } = await supabase.storage.from(NOTE_MEDIA_BUCKET).createSignedUrls(paths.slice(offset, offset + 100), 60 * 60);
      for (const row of data ?? []) if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    } catch { /* An unavailable image never rolls back an already saved note. */ }
  }
  return notes.map((note) => ({ ...note, imageUri: note.imageStoragePath ? urls.get(note.imageStoragePath) : undefined }));
}

async function cleanupGroupNoteImages(groupId: string, force = false): Promise<void> {
  if (!supabase) return;
  const { data: session } = await supabase.auth.getSession();
  const owner = session.session?.user.id;
  if (!owner) return;
  const key = `${owner}\u0000${groupId}`;
  const running = noteCleanupRequests.get(key);
  if (running) {
    await running;
    // A mutation may retire another image after the running load's scan.
    if (force) return cleanupGroupNoteImages(groupId, true);
    return;
  }
  if (!force && Date.now() < (noteCleanupAfter.get(key) ?? 0)) return;
  const client = supabase;
  const request = (async () => {
    // No foreign-file SELECT grant is needed for this authenticated cleanup.
    // Durable server lifecycle rows retry on the next refresh after an error.
    const result = await client.functions.invoke("group-note-media", { body: { groupId } });
    noteCleanupAfter.set(key, Date.now() + (result.error ? 30_000 : 5 * 60_000));
  })().catch(() => { noteCleanupAfter.set(key, Date.now() + 30_000); })
    .finally(() => noteCleanupRequests.delete(key));
  noteCleanupRequests.set(key, request);
  return request;
}

async function uploadGroupNoteImage(uri: string, groupId: string) {
  if (!supabase) throw new Error("Sign in to add an image.");
  const { data } = await supabase.auth.getSession();
  const owner = data.session?.user.id;
  if (!owner) throw new Error("Sign in to add an image.");
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read the selected image.");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
  const extension = mime.includes("png") || /\.png(?:$|\?)/i.test(uri) ? "png"
    : mime.includes("webp") || /\.webp(?:$|\?)/i.test(uri) ? "webp"
      : /hei[cf]/.test(mime) || /\.hei[cf](?:$|\?)/i.test(uri) ? "heic" : "jpg";
  const path = `${owner}/account/group-note/${Date.now()}-${Math.random().toString(36).slice(2, 12)}.${extension}`;
  // Reserve before Storage upload. A lost upload/save response remains visible
  // to the server's bounded expired-staging cleanup, even after app restart.
  const staged = await supabase.rpc("stage_group_note_image", { p_group_id: groupId, p_path: path });
  if (staged.error) throw cloudError(staged.error);
  const { error } = await supabase.storage.from(NOTE_MEDIA_BUCKET).upload(path, bytes, {
    contentType: extension === "jpg" ? "image/jpeg" : `image/${extension}`, cacheControl: "3600", upsert: false,
  });
  if (error) {
    await supabase.rpc("retire_unpublished_group_note_image", { p_group_id: groupId, p_path: path });
    void cleanupGroupNoteImages(groupId, true).catch(() => undefined);
    throw cloudError(error);
  }
  return path;
}

type GroupNoteRow = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string | null;
  body: string;
  image_path?: string | null;
  image_owner_id?: string | null;
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
  reminder_minutes: number | null;
  revision: number | string;
  created_at: string;
  updated_at: string;
};

export type SaveGroupNoteInput = {
  id?: string;
  groupId: string;
  title?: string;
  body: string;
  imageStoragePath?: string;
  imageUploadUri?: string;
  imagePreviewUri?: string;
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
  reminderMinutes?: number;
  expectedRevision?: number;
};

function cloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
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
    imageStoragePath: row.image_path ?? undefined,
    imageOwnerId: row.image_owner_id ?? undefined,
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
    reminderMinutes: row.reminder_minutes ?? undefined,
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

export async function loadGroupNotes(groupId: string, signal?: AbortSignal) {
  if (!supabase) return [];
  let query = supabase
    .from("group_notes")
    .select(NOTE_COLUMNS)
    .eq("group_id", groupId)
    .order("updated_at", { ascending: false })
    .limit(250);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw cloudError(error);
  const rows = ((data as GroupNoteRow[] | null) ?? []).filter((row) => row.group_id === groupId);
  void cleanupGroupNoteImages(groupId).catch(() => undefined);
  return notesFromRows(rows);
}

export async function saveGroupNote(input: SaveGroupNoteInput) {
  if (!supabase) throw new Error("Sign in to save a group note.");
  let uploadedPath: string | undefined;
  let row: GroupNoteRow;
  try {
    if (input.imageUploadUri) uploadedPath = await uploadGroupNoteImage(input.imageUploadUri, input.groupId);
    const { data, error } = await supabase.rpc("save_group_note", {
      p_note_id: input.id ?? null, p_group_id: input.groupId,
      p_title: input.title?.trim() || null, p_body: input.body.trim(),
      p_expected_revision: input.expectedRevision ?? null,
      p_image_path: uploadedPath ?? input.imageStoragePath ?? null,
    });
    if (error) throw cloudError(error);
    row = data as GroupNoteRow;
  } catch (reason) {
    if (!uploadedPath) throw reason;
    // This RPC serializes against publication and never retires a bound image.
    // Recover a committed save after a lost response before offering a retry.
    const retired = await supabase.rpc("retire_unpublished_group_note_image", { p_group_id: input.groupId, p_path: uploadedPath });
    if (retired.error) throw reason;
    const recovered = await supabase.from("group_notes").select(NOTE_COLUMNS).eq("group_id", input.groupId).eq("image_path", uploadedPath).maybeSingle();
    void cleanupGroupNoteImages(input.groupId, true).catch(() => undefined);
    if (recovered.error || !recovered.data) throw reason;
    row = recovered.data as GroupNoteRow;
  }
  const saved = (await notesFromRows([row]))[0];
  dispatchWorkspaceUpdate("group-note", saved.id, saved.revision);
  void cleanupGroupNoteImages(input.groupId, true).catch(() => undefined);
  return uploadedPath && input.imageUploadUri ? { ...saved, imageUri: input.imageUploadUri } : saved;
}

export async function deleteGroupNote(
  noteId: string,
  expectedRevision: number,
  groupId?: string,
) {
  if (!supabase) throw new Error("Sign in to delete a group note.");
  const { error } = await supabase.rpc("delete_group_note", {
    p_note_id: noteId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw cloudError(error);
  if (groupId) void cleanupGroupNoteImages(groupId, true).catch(() => undefined);
}

export async function loadGroupSchedule(
  groupId: string,
  range = groupScheduleCalendarRange(dateKey()),
  signal?: AbortSignal,
) {
  if (!supabase) return [];
  const rows: GroupScheduleRow[] = [];
  let cursor: GroupScheduleRow | undefined;
  // Fixed-size keyset pages avoid silently dropping popular dates. Reads are
  // calendar-window bounded and the guard reports an error instead of partial data.
  for (let page = 0; page < 100; page += 1) {
    let query = supabase
      .from("group_schedule_items")
      .select(
        "id, group_id, creator_id, title, notes, starts_at, ends_at, all_day, reminder_minutes, revision, created_at, updated_at",
      )
      .eq("group_id", groupId)
      .lt("starts_at", range.startsBefore)
      .or(`starts_at.gte.${range.startsAfter},ends_at.gt.${range.startsAfter}`)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(250);
    if (cursor)
      query = query.or(
        `starts_at.gt.${cursor.starts_at},and(starts_at.eq.${cursor.starts_at},id.gt.${cursor.id})`,
      );
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw cloudError(error);
    const pageRows = (data as GroupScheduleRow[] | null) ?? [];
    rows.push(...pageRows);
    if (pageRows.length < 250) return rows.map(scheduleFromRow);
    cursor = pageRows[pageRows.length - 1];
  }
  throw new Error(
    "This calendar window has too many events to load. Try again or ask an administrator to reduce duplicate events.",
  );
}

/** Notification links may point outside the currently displayed month. RLS applies. */
export async function loadGroupScheduleItem(
  groupId: string,
  itemId: string,
  signal?: AbortSignal,
) {
  if (!supabase) return;
  let query = supabase
    .from("group_schedule_items")
    .select(
      "id, group_id, creator_id, title, notes, starts_at, ends_at, all_day, reminder_minutes, revision, created_at, updated_at",
    )
    .eq("group_id", groupId)
    .eq("id", itemId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw cloudError(error);
  return data ? scheduleFromRow(data as GroupScheduleRow) : undefined;
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
    p_reminder_minutes: input.allDay ? null : (input.reminderMinutes ?? null),
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
