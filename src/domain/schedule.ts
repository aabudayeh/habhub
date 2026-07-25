import { dateWithOffsetFrom } from "@/src/domain/date";
import { GoalSchedule, TodoItem } from "@/src/types";

export function scheduleAppliesOnDate(
  schedule: GoalSchedule | undefined,
  anchorDate: string,
  localDate: string,
) {
  if (!schedule || schedule.mode === "daily") return localDate >= anchorDate;
  if (localDate < anchorDate) return false;
  const day = new Date(`${localDate}T12:00:00`).getDay();
  if (schedule.mode === "selected_days")
    return (schedule.daysOfWeek ?? []).includes(day);
  if (
    schedule.mode === "every_other_day" ||
    schedule.mode === "interval_days"
  ) {
    const anchor = schedule.anchorDate ?? anchorDate;
    const elapsed = Math.round(
      (new Date(`${localDate}T12:00:00`).getTime() -
        new Date(`${anchor}T12:00:00`).getTime()) /
        86400000,
    );
    const interval =
      schedule.mode === "every_other_day"
        ? 2
        : Math.max(1, Math.round(schedule.intervalDays ?? 1));
    return elapsed >= 0 && elapsed % interval === 0;
  }
  if (schedule.mode === "days_of_month")
    return (schedule.daysOfMonth ?? []).includes(Number(localDate.slice(-2)));
  // Minimum-per-period goals remain actionable until their period quota is
  // met; the caller evaluates completion across the period.
  return true;
}

export function todoAppearsOnDate(todo: TodoItem, localDate: string) {
  const createdDate = todo.createdAt.slice(0, 10);
  if (todo.recurrence)
    return scheduleAppliesOnDate(todo.recurrence, createdDate, localDate);
  if (todo.dueAt) return todo.dueAt.slice(0, 10) === localDate;
  return !todo.completedAt && localDate >= createdDate;
}

export function nextScheduledDate(
  schedule: GoalSchedule | undefined,
  anchorDate: string,
  fromDate: string,
  limitDays = 370,
) {
  for (let offset = 0; offset <= limitDays; offset += 1) {
    const candidate = dateWithOffsetFrom(fromDate, offset);
    if (scheduleAppliesOnDate(schedule, anchorDate, candidate))
      return candidate;
  }
  return undefined;
}
