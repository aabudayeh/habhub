import {
  scheduleAppliesOnDate,
  todoAppearsOnDate,
  todoSkippedOnDate,
} from "./schedule";
import { AppState } from "@/src/types";
import { dateKey } from "@/src/domain/date";
import { scheduledGoalReached } from "@/src/domain/metrics";

export type ScheduleEvent = {
  id: string;
  title: string;
  time?: string;
  kind: "todo" | "tracker" | "reminder";
  metricId?: string;
  todoId?: string;
  completed?: boolean;
  skipped?: boolean;
  failed?: boolean;
  overdue?: boolean;
  color?: string;
};

export function scheduleEventsForDate(
  state: AppState,
  localDate: string,
): ScheduleEvent[] {
  const todos = (state.todos ?? []).flatMap((todo) => {
    if (!todoAppearsOnDate(todo, localDate)) return [];
    const completed = todo.completedDates.includes(localDate);
    const skipped = todoSkippedOnDate(todo, localDate);
    const overdue = Boolean(
      todo.dueAt &&
        localDate > todo.dueAt.slice(0, 10) &&
        !completed &&
        !skipped,
    );
    const due =
      todo.dueAt?.slice(0, 10) === localDate
        ? [
            {
              id: `todo:${todo.id}:due`,
              title: `Due · ${todo.title}`,
              time: todo.dueAt.slice(11, 16),
              kind: "todo" as const,
              todoId: todo.id,
              completed,
              skipped,
              overdue,
            },
          ]
        : [];
    const reminders = todo.reminders
      .map((reminder, index) => ({ reminder, index }))
      .filter(
        ({ reminder }) =>
          !reminder.at || reminder.at.slice(0, 10) === localDate,
      )
      .map(({ reminder, index }) => ({
        id: `todo:${todo.id}:reminder:${index}`,
        title: `Reminder · ${todo.title}`,
        time: reminder.time ?? reminder.at?.slice(11, 16),
        kind: "todo" as const,
        todoId: todo.id,
        completed,
        skipped,
        overdue,
      }));
    if (due.length || reminders.length) return [...due, ...reminders];
    return [
      {
        id: `todo:${todo.id}`,
        title: todo.title,
        kind: "todo" as const,
        todoId: todo.id,
        completed,
        skipped,
        overdue,
      },
    ];
  });
  const trackers = state.metrics.flatMap((metric) => {
    if (
      !scheduleAppliesOnDate(
        metric.goalSchedule,
        metric.activeFrom,
        localDate,
      )
    )
      return [];
    const reminders =
      metric.reminders?.filter((reminder) => reminder.enabled) ??
      (metric.reminder?.enabled ? [metric.reminder] : []);
    const final = localDate < dateKey();
    const completed =
      final &&
      scheduledGoalReached(state, metric, state.currentUserId, localDate);
    return reminders.map((reminder, index) => ({
      id: `tracker:${metric.id}:${index}`,
      title: metric.name,
      time: reminder.time,
      kind: "tracker" as const,
      metricId: metric.id,
      color: metric.color,
      completed,
      failed: final && !completed,
    }));
  });
  const reminders = (state.calendarReminders ?? [])
    .filter(
      (reminder) =>
        reminder.enabled &&
        scheduleAppliesOnDate(
          reminder.schedule,
          reminder.schedule.anchorDate ?? localDate,
          localDate,
        ),
    )
    .map((reminder) => {
      const metric = reminder.metricId
        ? state.metrics.find((item) => item.id === reminder.metricId)
        : undefined;
      const final = localDate < dateKey();
      const completed = Boolean(
        metric &&
          final &&
          scheduledGoalReached(state, metric, state.currentUserId, localDate),
      );
      return {
        id: `reminder:${reminder.id}`,
        title:
          reminder.kind === "tracker" && metric
            ? metric.name
            : reminder.title,
        time: reminder.time,
        kind: "reminder" as const,
        metricId: reminder.metricId,
        todoId: reminder.todoId,
        color: metric?.color,
        completed,
        failed: Boolean(metric && final && !completed),
      };
    });
  const preferred = state.settings.calendarEventOrder ?? [];
  const combined: ScheduleEvent[] = [...todos, ...trackers, ...reminders];
  return combined.sort((a, b) => {
    const aOrder = preferred.indexOf(a.id);
    const bOrder = preferred.indexOf(b.id);
    if (aOrder >= 0 || bOrder >= 0)
      return (
        (aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder) -
        (bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder)
      );
    return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
  });
}
