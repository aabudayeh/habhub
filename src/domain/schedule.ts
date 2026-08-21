import { dateWithOffsetFrom } from "@/src/domain/date";
import { GoalSchedule, TodoItem, TodoReminder } from "@/src/types";

export function scheduleAppliesOnDate(
  schedule: GoalSchedule | undefined,
  anchorDate: string,
  localDate: string,
) {
  const effectiveAnchor = schedule?.anchorDate ?? anchorDate;
  if (schedule?.endDate && localDate > schedule.endDate) return false;
  if (schedule?.mode === "once")
    return localDate === effectiveAnchor;
  if (!schedule || schedule.mode === "daily")
    return localDate >= effectiveAnchor;
  if (localDate < effectiveAnchor) return false;
  const day = new Date(`${localDate}T12:00:00`).getDay();
  if (schedule.mode === "selected_days")
    return (schedule.daysOfWeek ?? []).includes(day);
  if (
    schedule.mode === "every_other_day" ||
    schedule.mode === "interval_days"
  ) {
    const elapsed = Math.round(
      (new Date(`${localDate}T12:00:00`).getTime() -
        new Date(`${effectiveAnchor}T12:00:00`).getTime()) /
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
  const completedDate =
    todo.completedDates.slice().sort().at(-1) ?? todo.completedAt?.slice(0, 10);
  const skippedDate = (todo.skippedDates ?? []).slice().sort().at(-1);
  const resolvedDate = [completedDate, skippedDate]
    .filter((date): date is string => Boolean(date))
    .sort()[0];
  if (
    todo.reminders.some(
      (reminder) =>
        reminder.at?.slice(0, 10) === localDate ||
        (reminder.schedule &&
          scheduleAppliesOnDate(
            reminder.schedule,
            reminder.schedule.anchorDate ??
              reminder.at?.slice(0, 10) ??
              createdDate,
            localDate,
          )) ||
        (reminder.repeatDailyUntilDue &&
          localDate >= createdDate &&
          (!todo.dueAt || localDate <= todo.dueAt.slice(0, 10))),
    )
  )
    return !resolvedDate || localDate <= resolvedDate;
  if (todo.recurrence) {
    // Older saved to-dos may not have an explicit recurrence anchor. Prefer
    // their scheduled/deadline date before falling back to creation time so a
    // future recurring item never appears early.
    const recurrenceAnchor =
      todo.recurrence.anchorDate ??
      todo.scheduledStartAt?.slice(0, 10) ??
      todo.dueAt?.slice(0, 10) ??
      createdDate;
    return scheduleAppliesOnDate(todo.recurrence, recurrenceAnchor, localDate);
  }
  const begins = todo.dueAt?.slice(0, 10) ?? createdDate;
  return localDate >= begins && (!resolvedDate || localDate <= resolvedDate);
}

/** Exact calendar dates on which one configured to-do reminder should fire. */
export function todoReminderAppliesOnDate(
  todo: TodoItem,
  reminder: TodoReminder,
  localDate: string,
) {
  const createdDate = todo.createdAt.slice(0, 10);
  if (reminder.repeatDailyUntilDue)
    return (
      localDate >= createdDate &&
      (!todo.dueAt || localDate <= todo.dueAt.slice(0, 10))
    );
  if (reminder.schedule)
    return scheduleAppliesOnDate(
      reminder.schedule,
      reminder.schedule.anchorDate ?? reminder.at?.slice(0, 10) ?? createdDate,
      localDate,
    );
  if (reminder.daysBeforeDue !== undefined && todo.dueAt)
    return (
      localDate ===
      dateWithOffsetFrom(
        todo.dueAt.slice(0, 10),
        -Math.max(0, Math.round(reminder.daysBeforeDue)),
      )
    );
  if (reminder.at) return reminder.at.slice(0, 10) === localDate;
  return Boolean(todo.dueAt && todo.dueAt.slice(0, 10) === localDate);
}

export function todoCompletedOnDate(todo: TodoItem, localDate: string) {
  return todo.completedDates.includes(localDate);
}

export function todoSkippedOnDate(todo: TodoItem, localDate: string) {
  return (todo.skippedDates ?? []).includes(localDate);
}

export function todoResolvedOnDate(todo: TodoItem, localDate: string) {
  return (
    todoCompletedOnDate(todo, localDate) || todoSkippedOnDate(todo, localDate)
  );
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
