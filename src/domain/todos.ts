import {
  AppState,
  CalendarReminder,
  GroupTodoItem,
  TodoItem,
} from "@/src/types";
import { dateKey } from "@/src/domain/date";
import { scheduleAppliesOnDate } from "@/src/domain/schedule";

const TODO_LABEL_PATTERN = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu;
const MAX_TODO_LABELS = 12;

type TodoNode = Pick<TodoItem, "id" | "parentId">;

export function normalizeTodoLabel(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^#+/, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .slice(0, 32);
}

/** User-facing label copy is hash-free while storage remains normalized. */
export function formatTodoLabel(value: string) {
  return normalizeTodoLabel(value).replace(/\p{L}/u, (letter) =>
    letter.toLocaleUpperCase(),
  );
}

/** Preserve editable text while presenting inline #labels as friendly copy. */
export function formatTodoLabelText(value: string) {
  return value.replace(
    TODO_LABEL_PATTERN,
    (_match, leading: string, label: string) =>
      `${leading}${formatTodoLabel(label)}`,
  );
}

export function extractTodoLabels(...values: (string | undefined)[]) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(TODO_LABEL_PATTERN)) {
      const label = normalizeTodoLabel(match[2] ?? "");
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
      if (labels.length >= MAX_TODO_LABELS) return labels;
    }
  }
  return labels;
}

/**
 * Removes one inline #label without changing surrounding words or newlines.
 * Stored labels are derived from editable copy, so removing the token is the
 * single source of truth for both the editor and saved filters.
 */
export function removeTodoLabelFromText(value: string, valueToRemove: string) {
  const target = normalizeTodoLabel(valueToRemove);
  if (!target || !value) return value;

  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(TODO_LABEL_PATTERN)) {
    const fullMatch = match[0] ?? "";
    const leading = match[1] ?? "";
    const label = match[2] ?? "";
    const matchStart = match.index ?? 0;
    const labelStart = matchStart + leading.length;
    const matchEnd = matchStart + fullMatch.length;
    if (normalizeTodoLabel(label) !== target) continue;

    result += value.slice(cursor, labelStart);
    cursor = matchEnd;

    // If the removed token sat between two horizontal spaces, consume the
    // trailing one so the remaining sentence keeps exactly one space. Before
    // punctuation, a line break, or the end, remove the preceding space so
    // `Task #work.` becomes `Task.` rather than `Task .`.
    const before = value[labelStart - 1];
    const after = value[cursor];
    if (before === " " || before === "\t") {
      if (after === " " || after === "\t") cursor += 1;
      else result = result.slice(0, -1);
    }
    // A label at the beginning of a line must not leave an indentation gap.
    if (labelStart === 0 || before === "\n" || before === "\r") {
      while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
    }
  }
  if (!cursor) return value;
  return result + value.slice(cursor);
}

export function todoLabels(
  todo: Pick<TodoItem | GroupTodoItem, "title" | "description" | "labels">,
) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...(todo.labels ?? []),
    ...extractTodoLabels(todo.title, todo.description),
  ]) {
    const label = normalizeTodoLabel(candidate);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= MAX_TODO_LABELS) break;
  }
  return labels;
}

/**
 * Saved Today views combine explicit To-Do selection with an optional label
 * rule. Multiple labels are alternatives, while an explicit ID list further
 * narrows the result.
 */
export function todoMatchesViewFilter(
  todo: Pick<
    TodoItem,
    "id" | "title" | "description" | "labels"
  >,
  filter: { todoIds?: readonly string[]; todoLabels?: readonly string[] },
) {
  if (filter.todoIds !== undefined && !filter.todoIds.includes(todo.id))
    return false;
  const selectedLabels = new Set(
    (filter.todoLabels ?? []).map(normalizeTodoLabel).filter(Boolean),
  );
  if (!selectedLabels.size) return true;
  return todoLabels(todo).some((label) => selectedLabels.has(label));
}

/**
 * Repairs legacy/corrupt adjacency without flattening a valid hierarchy.
 * Missing parents, self-parenting, and cycles become roots deterministically.
 */
export function normalizeTodoItems(todos: TodoItem[]) {
  const ids = new Set(todos.map((todo) => todo.id));
  const normalized = todos.map((todo) => ({
    ...todo,
    parentId:
      todo.parentId && todo.parentId !== todo.id && ids.has(todo.parentId)
        ? todo.parentId
        : undefined,
    labels: todoLabels(todo),
  }));
  const byId = new Map(normalized.map((todo) => [todo.id, todo]));

  for (const todo of normalized) {
    const visited = new Set([todo.id]);
    let parentId = todo.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        todo.parentId = undefined;
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return normalized;
}

export function descendantTodoIds<T extends TodoNode>(
  todos: readonly T[],
  parentId: string,
) {
  const children = new Map<string, string[]>();
  for (const todo of todos) {
    if (!todo.parentId) continue;
    const list = children.get(todo.parentId) ?? [];
    list.push(todo.id);
    children.set(todo.parentId, list);
  }
  const descendants = new Set<string>();
  const pending = [...(children.get(parentId) ?? [])];
  while (pending.length) {
    const id = pending.pop();
    if (!id || descendants.has(id) || id === parentId) continue;
    descendants.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return descendants;
}

export type FlattenedTodo<T> = { item: T; depth: number };

/** Preserves the caller's sorting while placing every child after its parent. */
export function flattenTodoHierarchy<T extends TodoNode>(todos: readonly T[]) {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const todo of todos) {
    if (!todo.parentId || !byId.has(todo.parentId) || todo.parentId === todo.id) {
      roots.push(todo);
      continue;
    }
    const list = children.get(todo.parentId) ?? [];
    list.push(todo);
    children.set(todo.parentId, list);
  }

  const result: FlattenedTodo<T>[] = [];
  const visited = new Set<string>();
  const append = (todo: T, depth: number) => {
    if (visited.has(todo.id)) return;
    visited.add(todo.id);
    result.push({ item: todo, depth });
    for (const child of children.get(todo.id) ?? []) append(child, depth + 1);
  };
  for (const root of roots) append(root, 0);
  // Cycle-only islands are still visible and editable rather than disappearing.
  for (const todo of todos) append(todo, 0);
  return result;
}

export function groupTodoAppearsOnDate(
  todo: GroupTodoItem,
  localDate = dateKey(),
) {
  if (!todo.recurrence) return true;
  return scheduleAppliesOnDate(
    todo.recurrence,
    todo.recurrence.anchorDate ?? todo.dueAt?.slice(0, 10) ?? todo.createdAt.slice(0, 10),
    localDate,
  );
}

export function groupTodoCompletedOnDate(
  todo: GroupTodoItem,
  currentUserId: string,
  localDate = dateKey(),
) {
  if (todo.completionMode === "shared")
    return Boolean(
      todo.completedAt &&
        (!todo.recurrence || dateKey(new Date(todo.completedAt)) === localDate),
    );
  const completion = todo.completedBy.find(
    (item) => item.userId === currentUserId,
  );
  return Boolean(
    completion &&
      (!todo.recurrence || dateKey(new Date(completion.completedAt)) === localDate),
  );
}

/** Fail closed when a private reminder references a disabled or missing group. */
export function groupTodoReminderFeatureEnabled(
  state: Pick<AppState, "group" | "groups">,
  reminder: Pick<CalendarReminder, "groupId" | "groupTodoId">,
) {
  if (!reminder.groupTodoId) return true;
  if (!reminder.groupId) return false;
  const group =
    state.group.id === reminder.groupId
      ? state.group
      : state.groups.find((candidate) => candidate.id === reminder.groupId);
  return group?.groupTodosEnabled === true;
}
