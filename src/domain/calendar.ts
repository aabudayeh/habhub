import {
  scheduleAppliesOnDate,
  todoAppearsOnDate,
  todoSkippedOnDate,
} from "./schedule";
import { AppState, TodoItem } from "@/src/types";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { gymSessionClockBounds } from "@/src/domain/gym";
import { scheduledGoalReached } from "@/src/domain/metrics";

export type ScheduleEvent = {
  id: string;
  title: string;
  time?: string;
  kind: "todo" | "tracker" | "reminder" | "log" | "gym" | "fasting";
  metricId?: string;
  todoId?: string;
  completed?: boolean;
  skipped?: boolean;
  failed?: boolean;
  overdue?: boolean;
  color?: string;
  /** Timed logs may span several visual hour slots. */
  durationMinutes?: number;
};

function clockMinutes(time: string | undefined) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const [hour, minute] = time.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    return undefined;
  return hour * 60 + minute;
}

/**
 * Returns whether an event belongs in an hourly Schedule slot.
 *
 * A duration's finishing boundary is intentionally discoverable from the next
 * slot (19:00-20:00 appears in both 19:00 and 20:00). Its starting boundary
 * is not copied into the preceding slot. Point events only belong to the hour
 * in which they start.
 */
export function scheduleEventTouchesHourSlot(
  event: ScheduleEvent,
  hour: number,
) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  const startsAt = clockMinutes(event.time);
  if (startsAt === undefined) return false;
  const slotStart = hour * 60;
  const slotEnd = slotStart + 60;
  const duration = event.durationMinutes;
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return startsAt >= slotStart && startsAt < slotEnd;
  const endsAt = startsAt + duration;
  return startsAt < slotEnd && endsAt >= slotStart;
}

/** Stable, de-duplicated events discoverable from one hourly slot. */
export function scheduleEventsForHourSlot(
  events: readonly ScheduleEvent[],
  hour: number,
) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id) || !scheduleEventTouchesHourSlot(event, hour))
      return false;
    seen.add(event.id);
    return true;
  });
}

function localClock(timestamp: string) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return undefined;
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes(),
  ).padStart(2, "0")}`;
}

function entryDurationMinutes(unit: string, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (/^h(r|our)?s?$/i.test(unit.trim())) return value * 60;
  if (/^min(ute)?s?$/i.test(unit.trim())) return value;
  if (/^sec(ond)?s?$/i.test(unit.trim())) return value / 60;
  return undefined;
}

function isScheduleNoiseEntry(entry: AppState["entries"][number]) {
  const sourceId = entry.sourceRecordId?.toLocaleLowerCase() ?? "";
  const label = entry.label?.toLocaleLowerCase() ?? "";
  return (
    entry.id.startsWith("gym-sync:") ||
    sourceId.startsWith("step-fallback:") ||
    label.includes("estimated unrecorded walking from steps")
  );
}

function todoTimeBlocksForDate(
  todo: TodoItem,
  localDate: string,
): ScheduleEvent[] {
  if (!todo?.scheduledStartAt || !todo.scheduledEndAt) return [];
  const baseStart = new Date(todo.scheduledStartAt);
  const baseEnd = new Date(todo.scheduledEndAt);
  const durationMinutes = (baseEnd.getTime() - baseStart.getTime()) / 60000;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
  const startClock = todo.scheduledStartAt.slice(11, 16);
  const baseDate = todo.scheduledStartAt.slice(0, 10);
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(`${localDate}T24:00:00`);
  return [dateWithOffsetFrom(localDate, -1), localDate].flatMap((occurrenceDate) => {
    const scheduled = todo.recurrence
      ? scheduleAppliesOnDate(todo.recurrence, baseDate, occurrenceDate)
      : occurrenceDate === baseDate;
    if (!scheduled) return [];
    const occurrenceStart = new Date(`${occurrenceDate}T${startClock}:00`);
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMinutes * 60000);
    const visibleStart = new Date(Math.max(occurrenceStart.getTime(), dayStart.getTime()));
    const visibleEnd = new Date(Math.min(occurrenceEnd.getTime(), dayEnd.getTime()));
    if (visibleStart >= visibleEnd) return [];
    return [{
      id: `todo:${todo.id}:block:${occurrenceDate}:${localDate}`,
      title: todo.title,
      time: localClock(visibleStart.toISOString()),
      durationMinutes: (visibleEnd.getTime() - visibleStart.getTime()) / 60000,
      kind: "todo" as const,
      todoId: todo.id,
      completed: todo.completedDates.includes(occurrenceDate),
      skipped: (todo.skippedDates ?? []).includes(occurrenceDate),
    }];
  });
}

function fastingBlocksForDate(state: AppState, localDate: string): ScheduleEvent[] {
  return state.metrics
    .filter((metric) => Boolean(metric.fastingSettings))
    .flatMap((metric) => {
      const endpoint = (
        id: string,
        title: string,
        value: Date,
        color: string,
        completed = false,
      ): ScheduleEvent[] =>
        dateKey(value) === localDate
          ? [
              {
                id,
                title,
                time: localClock(value.toISOString()),
                kind: "fasting",
                metricId: metric.id,
                color,
                completed,
              },
            ]
          : [];
      const logged = state.entries
        .filter(
          (entry) =>
            entry.userId === state.currentUserId &&
            entry.metricId === metric.id,
        )
        .flatMap((entry) => {
          const startedAtMs = entry.submetricValues?.fast_started_at_ms;
          const endedAtMs = entry.submetricValues?.fast_ended_at_ms;
          if (!startedAtMs || !endedAtMs) return [];
          const startedAt = new Date(startedAtMs);
          const endedAt = new Date(endedAtMs);
          if (
            Number.isNaN(startedAt.getTime()) ||
            Number.isNaN(endedAt.getTime())
          )
            return [];
          return [
            ...endpoint(
              `fast:start:${entry.id}`,
              "Fast started",
              startedAt,
              metric.color,
              true,
            ),
            ...endpoint(
              `fast:end:${entry.id}`,
              "Fast ended",
              endedAt,
              "#E58A3B",
              true,
            ),
          ];
        });
      if (logged.length) return logged;
      const startTime = metric.fastingSettings?.startTime ?? "20:00";
      const fastingMinutes = Math.max(
        15,
        Math.min(1425, metric.fastingSettings?.fastingMinutes ?? 16 * 60),
      );
      return [dateWithOffsetFrom(localDate, -1), localDate].flatMap(
        (occurrenceDate) => {
          const fastStart = new Date(`${occurrenceDate}T${startTime}:00`);
          const fastEnd = new Date(
            fastStart.getTime() + fastingMinutes * 60000,
          );
          return [
            ...endpoint(
              `fast:planned:start:${metric.id}:${occurrenceDate}`,
              "Fast starts",
              fastStart,
              metric.color,
            ),
            ...endpoint(
              `fast:planned:end:${metric.id}:${occurrenceDate}`,
              "Fast ends",
              fastEnd,
              "#E58A3B",
            ),
          ];
        },
      );
    });
}

export function scheduleEventsForDate(
  state: AppState,
  localDate: string,
): ScheduleEvent[] {
  const todos = (state.todos ?? []).flatMap((todo) => {
    const timeBlocks = todoTimeBlocksForDate(todo, localDate);
    if (!todoAppearsOnDate(todo, localDate) && !timeBlocks.length) return [];
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
          reminder.repeatDailyUntilDue
            ? localDate >= todo.createdAt.slice(0, 10) &&
              (!todo.dueAt || localDate <= todo.dueAt.slice(0, 10))
            : reminder.schedule
              ? scheduleAppliesOnDate(
                  reminder.schedule,
                  reminder.schedule.anchorDate ??
                    reminder.at?.slice(0, 10) ??
                    todo.createdAt.slice(0, 10),
                  localDate,
                )
            : !reminder.at || reminder.at.slice(0, 10) === localDate,
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
    if (due.length || reminders.length || timeBlocks.length)
      return [...due, ...reminders, ...timeBlocks];
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
    const goalDue = scheduleAppliesOnDate(
      metric.goalSchedule,
      metric.activeFrom,
      localDate,
    );
    const reminders =
      metric.reminders?.filter(
        (reminder) =>
          reminder.enabled &&
          (reminder.schedule
            ? scheduleAppliesOnDate(
              reminder.schedule,
              reminder.schedule.anchorDate ?? metric.activeFrom,
              localDate,
            )
            : goalDue),
      ) ??
      (metric.reminder?.enabled && goalDue ? [metric.reminder] : []);
    const final = localDate < dateKey();
    const completed =
      final &&
      scheduledGoalReached(state, metric, state.currentUserId, localDate);
    return reminders.map((reminder, index) => ({
      id: `tracker:${metric.id}:${index}`,
      title: reminder.label
        ? `${metric.name} · ${reminder.label}`
        : metric.name,
      time: reminder.time,
      kind: "tracker" as const,
      metricId: metric.id,
      color: metric.color,
      durationMinutes: reminder.durationMinutes,
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
        durationMinutes: reminder.durationMinutes,
        completed,
        failed: Boolean(metric && final && !completed),
      };
    });
  const childNutritionIds = new Set([
    "protein", "fat", "carbs", "fiber", "sodium", "sugar",
    "saturated_fat", "cholesterol", "potassium", "calcium", "iron",
    "magnesium", "vitamin_c", "vitamin_d", "vitamin_b12",
  ]);
  const previousLocalDate = dateWithOffsetFrom(localDate, -1);
  const nextLocalDate = dateWithOffsetFrom(localDate, 1);
  const entryLogs: ScheduleEvent[] = state.entries.flatMap((entry) => {
    const metric = state.metrics.find((item) => item.id === entry.metricId);
    if (
      entry.userId !== state.currentUserId ||
      ![previousLocalDate, localDate, nextLocalDate].includes(entry.localDate) ||
      Boolean(metric?.fastingSettings) ||
      isScheduleNoiseEntry(entry)
    )
      return [];
    if (!metric || metric.dataType === "calculated") return [];
    if (
      childNutritionIds.has(metric.id) &&
      state.entries.some(
        (candidate) =>
          candidate.userId === entry.userId &&
          candidate.metricId === "food" &&
          candidate.recordedAt === entry.recordedAt,
      )
    )
      return [];
    if (
      ["blood_pressure_diastolic", "pulse"].includes(metric.id) &&
      state.entries.some(
        (candidate) =>
          candidate.userId === entry.userId &&
          candidate.metricId === "blood_pressure_systolic" &&
          candidate.recordedAt === entry.recordedAt,
      )
    )
      return [];
    const value = typeof entry.value === "number" ? entry.value : undefined;
    const durationMinutes = metric.timerEnabled
      ? entryDurationMinutes(metric.unit, value)
      : metric.id === "workout_duration"
        ? value
        : undefined;
    if (entry.localDate !== localDate && !durationMinutes) return [];
    if (durationMinutes && durationMinutes > 0) {
      const recordedAt = new Date(entry.recordedAt);
      if (Number.isNaN(recordedAt.getTime())) return [];
      // Activity timers are recorded when they stop. Imported workout-duration
      // rows use their source timestamp as the start of the exercise instead.
      const starts = metric.timerEnabled
        ? new Date(recordedAt.getTime() - durationMinutes * 60000)
        : recordedAt;
      const ends = metric.timerEnabled
        ? recordedAt
        : new Date(recordedAt.getTime() + durationMinutes * 60000);
      const dayStart = new Date(`${localDate}T00:00:00`);
      const dayEnd = new Date(`${localDate}T24:00:00`);
      const visibleStart = new Date(Math.max(starts.getTime(), dayStart.getTime()));
      const visibleEnd = new Date(Math.min(ends.getTime(), dayEnd.getTime()));
      if (visibleStart >= visibleEnd) return [];
      return [{
        id: `log:${entry.id}:${localDate}`,
        title: entry.label?.trim() || `${metric.name}${value !== undefined ? ` · ${value} ${metric.unit}` : ""}`,
        time: localClock(visibleStart.toISOString()),
        kind: "log" as const,
        metricId: metric.id,
        color: metric.color,
        durationMinutes: Math.max(
          1,
          (visibleEnd.getTime() - visibleStart.getTime()) / 60000,
        ),
        completed: false,
      }];
    }
    return [{
      id: `log:${entry.id}`,
      title: entry.label?.trim() || `${metric.name}${value !== undefined ? ` · ${value} ${metric.unit}` : ""}`,
      time: localClock(entry.recordedAt),
      kind: "log" as const,
      metricId: metric.id,
      color: metric.color,
      durationMinutes: durationMinutes ? Math.max(1, durationMinutes) : undefined,
      completed: false,
    }];
  });
  const gymLogs: ScheduleEvent[] = (state.gymSessions ?? []).flatMap((session) => {
    if (session.userId !== state.currentUserId) return [];
    const clock = gymSessionClockBounds(session);
    const startedAt = new Date(clock.startedAt ?? session.recordedAt);
    const completedAt = new Date(clock.completedAt ?? session.recordedAt);
    if (
      Number.isNaN(startedAt.getTime()) ||
      Number.isNaN(completedAt.getTime()) ||
      completedAt <= startedAt
    )
      return [];
    const dayStart = new Date(`${localDate}T00:00:00`);
    const dayEnd = new Date(`${localDate}T24:00:00`);
    const visibleStart = new Date(Math.max(startedAt.getTime(), dayStart.getTime()));
    const visibleEnd = new Date(Math.min(completedAt.getTime(), dayEnd.getTime()));
    if (visibleStart >= visibleEnd) return [];
    const actualMinutes = Math.max(
      1,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 60000),
    );
    return [{
      id: `gym:${session.id}:${localDate}`,
      title: `${session.name} · ${actualMinutes} min`,
      time: localClock(visibleStart.toISOString()),
      durationMinutes: Math.max(
        1,
        (visibleEnd.getTime() - visibleStart.getTime()) / 60000,
      ),
      kind: "gym" as const,
      metricId:
        state.metrics.find((metric) => metric.id === "workout")?.id ??
        state.metrics.find((metric) => metric.id === "workout_duration")?.id,
      color: "#8B5CF6",
      completed: true,
    }];
  });
  const fasting = fastingBlocksForDate(state, localDate);
  const preferred = state.settings.calendarEventOrder ?? [];
  const combined: ScheduleEvent[] = [
    ...todos,
    ...trackers,
    ...reminders,
    ...entryLogs,
    ...gymLogs,
    ...fasting,
  ];
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
