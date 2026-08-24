import { supabase } from "@/src/lib/supabase";
import {
  GroupTodoCompletionMode,
  GroupTodoItem,
  TodoPriority,
} from "@/src/types";

type GroupTodoRow = {
  id: string;
  group_id: string;
  creator_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  labels: string[] | null;
  priority: TodoPriority;
  due_at: string | null;
  completion_mode: GroupTodoCompletionMode;
  shared_completed_at: string | null;
  shared_completed_by: string | null;
  created_at: string;
  updated_at: string;
  group_todo_completions?: {
    user_id: string;
    completed_at: string;
  }[] | null;
};

export type SaveGroupTodoInput = {
  id?: string;
  groupId: string;
  parentId?: string;
  title: string;
  description?: string;
  labels?: string[];
  priority: TodoPriority;
  dueAt?: string;
  completionMode: GroupTodoCompletionMode;
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

function fromRow(row: GroupTodoRow): GroupTodoItem {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    labels: [...new Set(row.labels ?? [])],
    priority: row.priority,
    dueAt: row.due_at ?? undefined,
    completionMode: row.completion_mode,
    completedAt: row.shared_completed_at ?? undefined,
    completedByUserId: row.shared_completed_by ?? undefined,
    completedByIds: [
      ...new Set(
        (row.group_todo_completions ?? []).map(
          (completion) => completion.user_id,
        ),
      ),
    ],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadGroupTodos(groupId: string) {
  if (!supabase) return [];
  const pageSize = 500;
  const rows: GroupTodoRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("group_todos")
      .select(
        "id, group_id, creator_id, parent_id, title, description, labels, priority, due_at, completion_mode, shared_completed_at, shared_completed_by, created_at, updated_at, group_todo_completions(user_id, completed_at)",
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw cloudError(error);
    const page = (data as GroupTodoRow[] | null) ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(fromRow);
}

export async function saveGroupTodo(input: SaveGroupTodoInput) {
  if (!supabase) throw new Error("Sign in to save a group to-do.");
  const { data, error } = await supabase.rpc("save_group_todo", {
    p_todo_id: input.id ?? null,
    p_group_id: input.groupId,
    p_parent_id: input.parentId ?? null,
    p_title: input.title,
    p_description: input.description?.trim() || null,
    p_labels: input.labels ?? [],
    p_priority: input.priority,
    p_due_at: input.dueAt ?? null,
    p_completion_mode: input.completionMode,
  });
  if (error) throw cloudError(error);
  return fromRow(data as GroupTodoRow);
}

export async function setGroupTodoCompletion(
  todoId: string,
  completed: boolean,
) {
  if (!supabase) throw new Error("Sign in to update a group to-do.");
  const { data, error } = await supabase.rpc("set_group_todo_completion", {
    p_todo_id: todoId,
    p_completed: completed,
  });
  if (error) throw cloudError(error);
  return fromRow(data as GroupTodoRow);
}

export async function deleteGroupTodo(todoId: string) {
  if (!supabase) throw new Error("Sign in to delete a group to-do.");
  const { error } = await supabase.rpc("delete_group_todo", {
    p_todo_id: todoId,
  });
  if (error) throw cloudError(error);
}
