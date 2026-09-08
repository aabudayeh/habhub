import type { AppState, GroupScheduleItem, GroupTodoItem } from "@/src/types";
import type { ScheduleEvent } from "@/src/domain/calendar";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { groupScheduleAllDayDateKey } from "@/src/domain/groupHub";
import { scheduleAppliesOnDate } from "@/src/domain/schedule";
import {
  groupTodoAppearsOnDate,
  groupTodoCompletedOnDate,
  groupTodoReminderFeatureEnabled,
} from "@/src/domain/todos";

export const GROUP_EVENT_REMINDER_MINUTES = [0, 5, 15, 30, 60, 1440] as const;

export type GroupCalendarEvent = ScheduleEvent & {
  source: "event" | "task" | "reminder";
  scheduleItemId?: string;
  calendarReminderId?: string;
};

/** MonthCalendar's 42 cells, padded for custom week boundaries at either edge. */
export function groupScheduleCalendarRange(anchor: string) {
  const first = new Date(`${anchor}T12:00:00`);
  first.setDate(1);
  first.setDate(1 - first.getDay());
  const from = dateWithOffsetFrom(dateKey(first), -7);
  const to = dateWithOffsetFrom(from, 56);
  const reminderHorizon = dateWithOffsetFrom(to, 1);
  // All-day rows have semantic UTC dates, timed rows have local dates. Query
  // the union, then project exactly in groupCalendarEventsForDate below.
  return {
    from,
    to,
    startsAfter: new Date(
      Math.min(
        new Date(`${from}T00:00:00`).getTime(),
        Date.parse(`${from}T00:00:00Z`),
      ),
    ).toISOString(),
    startsBefore: new Date(
      Math.max(
        new Date(`${reminderHorizon}T00:00:00`).getTime(),
        Date.parse(`${reminderHorizon}T00:00:00Z`),
      ),
    ).toISOString(),
  };
}

export function localGroupScheduleDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return;
  return date.toISOString();
}

function clock(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** No private trackers/logs/todos or other group's items enter this projection. */
export function groupCalendarEventsForDate({
  state,
  items,
  todos,
  localDate,
  blockedUserIds = new Set<string>(),
  safetyHydrated = true,
}: {
  state: Pick<
    AppState,
    "group" | "groups" | "settings" | "currentUserId" | "calendarReminders"
  >;
  items: readonly GroupScheduleItem[];
  todos: readonly GroupTodoItem[];
  localDate: string;
  blockedUserIds?: ReadonlySet<string>;
  safetyHydrated?: boolean;
}): GroupCalendarEvent[] {
  const groupId = state.group.id;
  if (!state.group.members.some((member) => member.id === state.currentUserId))
    return [];
  const visible = (row: { groupId: string; creatorId: string }) =>
    row.groupId === groupId &&
    (row.creatorId === state.currentUserId ||
      (safetyHydrated && !blockedUserIds.has(row.creatorId)));
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(`${dateWithOffsetFrom(localDate, 1)}T00:00:00`);
  const events: GroupCalendarEvent[] = items.filter(visible).flatMap((item) => {
    const base: GroupCalendarEvent = {
      id: `event:${item.id}`,
      title: item.title,
      kind: "log",
      source: "event",
      scheduleItemId: item.id,
      groupId,
    };
    if (item.allDay)
      return groupScheduleAllDayDateKey(item.startsAt) === localDate
        ? [base]
        : [];
    const start = new Date(item.startsAt);
    const end = item.endsAt ? new Date(item.endsAt) : start;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      return [];
    if (end <= start)
      return dateKey(start) === localDate
        ? [{ ...base, time: clock(start) }]
        : [];
    if (start >= dayEnd || end <= dayStart) return [];
    const clippedStart = new Date(
      Math.max(start.getTime(), dayStart.getTime()),
    );
    const clippedEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
    // Wall-clock minutes match the individual hour grid, including DST days.
    const endMinutes =
      clippedEnd.getTime() === dayEnd.getTime()
        ? 1440
        : clippedEnd.getHours() * 60 + clippedEnd.getMinutes();
    return [
      {
        ...base,
        time: clock(clippedStart),
        durationMinutes: Math.max(
          1,
          endMinutes - clippedStart.getHours() * 60 - clippedStart.getMinutes(),
        ),
      },
    ];
  });
  const preferences =
    state.settings.notifications.groupPreferencesByGroup?.[groupId];
  if (
    preferences?.scheduleReminders === true &&
    preferences.enabled !== false &&
    !state.settings.notifications.mutedGroupIds?.includes(groupId)
  ) {
    for (const item of items.filter(visible)) {
      if (
        item.allDay ||
        item.reminderMinutes === undefined ||
        !GROUP_EVENT_REMINDER_MINUTES.some(
          (minutes) => minutes === item.reminderMinutes,
        )
      )
        continue;
      const due = new Date(
        new Date(item.startsAt).getTime() - item.reminderMinutes * 60_000,
      );
      if (Number.isFinite(due.getTime()) && dateKey(due) === localDate)
        events.push({
          id: `event-reminder:${item.id}`,
          title: item.title,
          time: clock(due),
          kind: "reminder",
          source: "reminder",
          scheduleItemId: item.id,
          groupId,
        });
    }
  }
  const visibleTodos = state.group.groupTodosEnabled
    ? todos.filter(visible)
    : [];
  for (const todo of visibleTodos) {
    const due = todo.dueAt ? new Date(todo.dueAt) : undefined;
    if (!groupTodoAppearsOnDate(todo, localDate)) continue;
    if (!todo.recurrence && due && dateKey(due) !== localDate) continue;
    events.push({
      id: `task:${todo.id}`,
      title: todo.title,
      source: "task",
      kind: "todo",
      groupTodoId: todo.id,
      groupId,
      time: due && Number.isFinite(due.getTime()) ? clock(due) : undefined,
      completed: groupTodoCompletedOnDate(todo, state.currentUserId, localDate),
    });
  }
  const visibleTodoIds = new Set(visibleTodos.map((todo) => todo.id));
  for (const reminder of state.calendarReminders ?? []) {
    if (
      reminder.groupId !== groupId ||
      !reminder.groupTodoId ||
      !visibleTodoIds.has(reminder.groupTodoId) ||
      !reminder.enabled ||
      !groupTodoReminderFeatureEnabled(state, reminder) ||
      !scheduleAppliesOnDate(
        reminder.schedule,
        reminder.schedule.anchorDate ?? localDate,
        localDate,
      )
    )
      continue;
    events.push({
      id: `reminder:${reminder.id}`,
      title: reminder.title,
      time: reminder.time,
      durationMinutes: reminder.durationMinutes,
      kind: "reminder",
      source: "reminder",
      groupId,
      groupTodoId: reminder.groupTodoId,
      calendarReminderId: reminder.id,
    });
  }
  return events.sort(
    (a, b) =>
      (a.time ?? "").localeCompare(b.time ?? "") ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}
