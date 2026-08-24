import { useEffect, useMemo } from "react";

import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { useApp } from "@/src/state/AppProvider";

/**
 * Keeps private Group To-Do reminder references valid without requiring the
 * Leaderboard section to be visible. The hook stays dormant for accounts that
 * have no private reminder attached to the active group.
 */
export function GroupTodoReminderReconciler() {
  const { state, deleteCalendarReminder } = useApp();
  const reminders = useMemo(
    () =>
      (state.calendarReminders ?? []).filter(
        (reminder) =>
          reminder.groupId === state.group.id && Boolean(reminder.groupTodoId),
      ),
    [state.calendarReminders, state.group.id],
  );
  const shouldReconcile =
    state.group.groupTodosEnabled === true && reminders.length > 0;
  const groupTodos = useGroupTodos(state.group.id, shouldReconcile);

  useEffect(() => {
    if (!shouldReconcile || !groupTodos.ready || groupTodos.error) return;
    const availableIds = new Set(groupTodos.todos.map((todo) => todo.id));
    for (const reminder of reminders)
      if (reminder.groupTodoId && !availableIds.has(reminder.groupTodoId))
        deleteCalendarReminder(reminder.id);
  }, [
    deleteCalendarReminder,
    groupTodos.error,
    groupTodos.ready,
    groupTodos.todos,
    reminders,
    shouldReconcile,
  ]);

  return null;
}
