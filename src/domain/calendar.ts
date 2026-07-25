import { scheduleAppliesOnDate, todoAppearsOnDate } from "./schedule";
import { AppState } from "@/src/types";

export type ScheduleEvent = {
  id: string;
  title: string;
  time?: string;
  kind: "todo" | "tracker" | "reminder";
  metricId?: string;
  todoId?: string;
  completed?: boolean;
};

export function scheduleEventsForDate(
  state: AppState,
  localDate: string,
): ScheduleEvent[] {
  const todos = (state.todos ?? [])
    .filter((todo) => todoAppearsOnDate(todo, localDate))
    .map((todo) => ({
      id: `todo:${todo.id}`,
      title: todo.title,
      time: todo.dueAt?.slice(0, 10) === localDate
        ? todo.dueAt.slice(11, 16)
        : todo.reminders[0]?.time,
      kind: "todo" as const,
      todoId: todo.id,
      completed: todo.completedDates.includes(localDate),
    }));
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
    return reminders.map((reminder, index) => ({
      id: `tracker:${metric.id}:${index}`,
      title: `Work on ${metric.name}`,
      time: reminder.time,
      kind: "tracker" as const,
      metricId: metric.id,
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
    .map((reminder) => ({
      id: `reminder:${reminder.id}`,
      title: reminder.title,
      time: reminder.time,
      kind: "reminder" as const,
      metricId: reminder.metricId,
      todoId: reminder.todoId,
    }));
  const preferred = state.settings.calendarEventOrder ?? [];
  return [...todos, ...trackers, ...reminders].sort((a, b) => {
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
