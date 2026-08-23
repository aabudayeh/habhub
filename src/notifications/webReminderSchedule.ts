import { activityTimerElapsedSeconds } from "@/src/domain/activityTimer";
import { cycleForecast } from "@/src/domain/cycle";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { automaticFastProgress } from "@/src/domain/fasting";
import {
  activityTimerAlertCandidates,
  notificationFallsAfterFastingTarget,
  notificationTitle,
  quietHoursAdjustedDateTime,
  WEB_REMINDER_LATE_GRACE_MS,
  webReminderTriggerCanStillPublish,
} from "@/src/domain/notificationScheduling";
import {
  isMetricTrackedOnDate,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import {
  scheduleAppliesOnDate,
  todoReminderAppliesOnDate,
  todoResolvedOnDate,
} from "@/src/domain/schedule";
import { translateUiText } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import type { AppState } from "@/src/types";

export type WebReminderCategory =
  | "tracker"
  | "todo"
  | "calendar"
  | "cycle"
  | "gym"
  | "timer"
  | "fasting";

export type WebReminderPlan = {
  scheduleKey: string;
  category: WebReminderCategory;
  scheduledAt: string;
  title: string;
  body: string;
  data: Record<string, string | number | boolean>;
};

const CATEGORY_LIMITS = {
  tracker: 28,
  productivity: 24,
  cycle: 5,
  gym: 1,
  timer: 6,
  fasting: 4,
} as const;
const MAX_WEB_REMINDERS = 68;
// A browser can suspend immediately after save and a transient network retry
// can cross the requested minute. Keep a short, server-matched grace window so
// a just-due reminder is published for the next minute worker run instead of
// disappearing from the plan. Stable schedule keys keep this idempotent.
function triggerCanStillPublish(trigger: Date, now: Date) {
  return webReminderTriggerCanStillPublish(trigger.getTime(), now.getTime());
}

function localized(state: AppState, value: string) {
  return translateUiText(state.settings.language ?? "en", value);
}

function triggerFor(
  state: AppState,
  localDate: string,
  configuredTime: string,
) {
  if (!/^\d{2}:\d{2}$/.test(configuredTime)) return undefined;
  const adjusted = quietHoursAdjustedDateTime({
    enabled: state.settings.notifications.quietHoursEnabled,
    start: state.settings.notifications.quietHoursStart,
    end: state.settings.notifications.quietHoursEnd,
    localDate,
    time: configuredTime,
  });
  const date = new Date(`${adjusted.localDate}T${adjusted.time}:00`);
  return Number.isFinite(date.getTime())
    ? { date, localDate: adjusted.localDate, time: adjusted.time }
    : undefined;
}

function scheduleKey(parts: readonly (string | number)[]) {
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

function plan(
  state: AppState,
  input: Omit<WebReminderPlan, "scheduledAt"> & { at: Date },
) {
  return {
    scheduleKey: input.scheduleKey,
    category: input.category,
    scheduledAt: input.at.toISOString(),
    title: notificationTitle(
      localized(state, input.title),
      localized(state, "HabHub reminder"),
    ).slice(0, 120),
    body: localized(state, input.body).slice(0, 500),
    data: input.data,
  } satisfies WebReminderPlan;
}

function nearestUnique(
  plans: readonly WebReminderPlan[],
  limit: number,
) {
  const unique = new Map<string, WebReminderPlan>();
  for (const item of plans) {
    const prior = unique.get(item.scheduleKey);
    if (!prior || item.scheduledAt < prior.scheduledAt)
      unique.set(item.scheduleKey, item);
  }
  return [...unique.values()]
    .sort(
      (left, right) =>
        left.scheduledAt.localeCompare(right.scheduledAt) ||
        left.scheduleKey.localeCompare(right.scheduleKey),
    )
    .slice(0, limit);
}

function trackerPlans(state: AppState, now: Date) {
  if (!state.settings.notifications.reminders) return [];
  const plans: WebReminderPlan[] = [];
  const today = dateKey(now);
  const metrics = state.metrics.filter(
    (metric) =>
      metric.reminders?.some((reminder) => reminder.enabled) ||
      metric.reminder?.enabled,
  );
  const fastingByMetric = new Map(
    state.metrics
      .filter((metric) => Boolean(metric.fastingSettings))
      .map((metric) => [
        metric.id,
        automaticFastProgress(state, state.currentUserId, now, metric.id),
      ] as const),
  );
  const semantic = new Set<string>();

  // Keep yesterday in the source window because an overnight quiet-hours
  // adjustment can legitimately move a late reminder into this morning. If
  // the PWA reopens before that adjusted time, the server schedule must retain
  // it instead of treating the source date as expired.
  for (let offset = -1; offset < 367; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const metric of metrics) {
      if (metric.activeFrom > localDate) continue;
      const configured = metric.reminders?.length
        ? metric.reminders
        : metric.reminder
          ? [metric.reminder]
          : [];
      for (const [index, reminder] of configured.entries()) {
        if (!reminder.enabled) continue;
        if (
          reminder.schedule &&
          !scheduleAppliesOnDate(
            reminder.schedule,
            reminder.schedule.anchorDate ?? metric.activeFrom,
            localDate,
          )
        )
          continue;
        if (
          !reminder.schedule &&
          metric.goalEnabled !== false &&
          !metric.fastingSettings &&
          !isMetricTrackedOnDate(state, metric, localDate)
        )
          continue;
        if (
          offset === 0 &&
          metric.goalEnabled !== false &&
          scheduledGoalReached(state, metric, state.currentUserId, localDate)
        )
          continue;
        const trigger = triggerFor(state, localDate, reminder.time);
        if (!trigger || !triggerCanStillPublish(trigger.date, now)) continue;
        const fast = fastingByMetric.get(metric.id);
        if (
          fast?.active &&
          notificationFallsAfterFastingTarget({
            startedAt: fast.startedAt,
            targetMinutes: fast.targetMinutes,
            triggerAt: trigger.date.getTime(),
          })
        )
          continue;
        const metricName = localizeMetricName(state.settings.language, metric);
        const route =
          reminder.durationMinutes && metric.timerEnabled
            ? `/timer?metric=${encodeURIComponent(metric.id)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`
            : `/metric-detail?metric=${encodeURIComponent(metric.id)}&date=${localDate}`;
        const title = notificationTitle(
          reminder.label,
          `${metricName} reminder`,
        );
        const body = metric.fastingSettings
          ? "Your fasting reminder is ready."
          : `Open HabHub to update today's ${metricName.toLowerCase()}.`;
        const semanticKey = JSON.stringify([
          metric.id,
          localDate,
          trigger.time,
          title,
          body,
          route,
        ]);
        if (semantic.has(semanticKey)) continue;
        semantic.add(semanticKey);
        plans.push(
          plan(state, {
            scheduleKey: scheduleKey([
              "tracker-v1",
              metric.id,
              index,
              localDate,
              trigger.time,
            ]),
            category: "tracker",
            at: trigger.date,
            title,
            body,
            data: {
              route,
              metric: metric.id,
              date: localDate,
              notificationKind: "goal-reminder",
            },
          }),
        );
      }
    }
    if (plans.length >= CATEGORY_LIMITS.tracker) break;
  }
  return nearestUnique(plans, CATEGORY_LIMITS.tracker);
}

function productivityPlans(state: AppState, now: Date) {
  const plans: WebReminderPlan[] = [];
  const today = dateKey(now);
  const add = ({
    category,
    localDate,
    time,
    title,
    body,
    route,
    kind,
    sourceId,
  }: {
    category: "todo" | "calendar";
    localDate: string;
    time: string;
    title: string;
    body: string;
    route: string;
    kind: string;
    sourceId: string;
  }) => {
    const trigger = triggerFor(state, localDate, time);
    if (!trigger || !triggerCanStillPublish(trigger.date, now)) return;
    plans.push(
      plan(state, {
        scheduleKey: scheduleKey([
          "productivity-v1",
          kind,
          sourceId,
          localDate,
          trigger.time,
        ]),
        category,
        at: trigger.date,
        title,
        body,
        data: {
          route,
          notificationKind: kind,
          date: localDate,
        },
      }),
    );
  };

  // To-do and calendar reminders can also roll over midnight through quiet
  // hours, so retain yesterday long enough to schedule today's adjusted fire.
  for (let offset = -1; offset < 367; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    if (state.settings.notifications.todoReminders !== false) {
      for (const todo of state.todos ?? []) {
        if (
          todoResolvedOnDate(todo, localDate) ||
          (!todo.recurrence && Boolean(todo.completedAt))
        )
          continue;
        const dueDate = todo.dueAt?.slice(0, 10);
        const dueTime = todo.dueAt?.slice(11, 16) ?? "09:00";
        const explicitDeadline = todo.reminders.some(
          (reminder) =>
            todoReminderAppliesOnDate(todo, reminder, localDate) &&
            (reminder.time ?? reminder.at?.slice(11, 16) ?? dueTime) ===
              dueTime,
        );
        if (dueDate === localDate && !explicitDeadline)
          add({
            category: "todo",
            localDate,
            time: dueTime,
            title: "To-do deadline",
            body: todo.title,
            route: `/todo-editor?id=${encodeURIComponent(todo.id)}`,
            kind: "todo-deadline",
            sourceId: todo.id,
          });
        for (const reminder of todo.reminders) {
          if (!todoReminderAppliesOnDate(todo, reminder, localDate)) continue;
          add({
            category: "todo",
            localDate,
            time:
              reminder.time ?? todo.dueAt?.slice(11, 16) ?? "09:00",
            title:
              todo.dueAt?.slice(0, 10) === localDate
                ? "To-do deadline"
                : "To-do reminder",
            body: todo.title,
            route: `/todo-editor?id=${encodeURIComponent(todo.id)}`,
            kind: "todo-reminder",
            sourceId: `${todo.id}:${reminder.id}`,
          });
        }
      }
    }
    for (const reminder of state.calendarReminders ?? []) {
      if (
        !reminder.enabled ||
        !scheduleAppliesOnDate(reminder.schedule, today, localDate)
      )
        continue;
      const route =
        reminder.kind === "tracker" &&
        reminder.metricId &&
        reminder.durationMinutes
          ? `/timer?metric=${encodeURIComponent(reminder.metricId)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`
          : "/calendar";
      add({
        category: "calendar",
        localDate,
        time: reminder.time,
        title: reminder.title,
        body:
          reminder.kind === "tracker"
            ? "A scheduled tracker reminder is ready."
            : reminder.kind === "todo"
              ? "A scheduled to-do reminder is ready."
              : "Scheduled reminder",
        route,
        kind: "calendar-reminder",
        sourceId: reminder.id,
      });
    }
    if (plans.length >= CATEGORY_LIMITS.productivity) break;
  }
  return nearestUnique(plans, CATEGORY_LIMITS.productivity);
}

function cyclePlans(state: AppState, now: Date) {
  const settings = state.settings.notifications;
  if (settings.cyclePredictions === false && settings.cyclePhaseUpdates !== true)
    return [];
  const forecast = cycleForecast(state, state.currentUserId, dateKey(now));
  if (!forecast.nextPeriodStart) return [];
  const today = dateKey(now);
  const candidates: { date: string; id: string; title: string; body: string }[] = [];
  if (settings.cyclePredictions !== false)
    candidates.push({
      date: dateWithOffsetFrom(
        forecast.nextPeriodStart,
        -(settings.cycleReminderDays ?? 2),
      ),
      id: "period-estimate",
      title: "Period estimate",
      body: `Your next period is estimated in ${settings.cycleReminderDays ?? 2} days. This may change as HabHub learns your cycle.`,
    });
  if (settings.cyclePhaseUpdates === true) {
    const currentStart = dateWithOffsetFrom(
      forecast.nextPeriodStart,
      -forecast.averageCycleDays,
    );
    const future = (candidate: string) => {
      let next = candidate;
      while (next <= today)
        next = dateWithOffsetFrom(next, forecast.averageCycleDays);
      return next;
    };
    candidates.push(
      {
        date: future(currentStart),
        id: "menstrual-phase",
        title: "Menstrual phase estimate",
        body: "Your next cycle is estimated to begin around today.",
      },
      {
        date: future(
          dateWithOffsetFrom(currentStart, forecast.averagePeriodDays),
        ),
        id: "follicular-phase",
        title: "Follicular phase estimate",
        body: "Your follicular phase is estimated to begin around today.",
      },
      {
        date: future(
          dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 15),
        ),
        id: "ovulation-phase",
        title: "Ovulation phase estimate",
        body: "Estimated ovulation phase begins around today. This is not a contraceptive prediction.",
      },
      {
        date: future(
          dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 12),
        ),
        id: "luteal-phase",
        title: "Luteal phase estimate",
        body: "Your luteal phase is estimated to begin around today.",
      },
    );
  }
  return nearestUnique(
    candidates.flatMap((candidate) => {
      const trigger = triggerFor(state, candidate.date, "09:00");
      return !trigger || !triggerCanStillPublish(trigger.date, now)
        ? []
        : [
            plan(state, {
              scheduleKey: scheduleKey([
                "cycle-v1",
                candidate.id,
                candidate.date,
                trigger.time,
              ]),
              category: "cycle",
              at: trigger.date,
              title: candidate.title,
              body: candidate.body,
              data: {
                route: "/metric-detail?metric=menstrual_cycle",
                metric: "menstrual_cycle",
                notificationKind: "cycle-reminder",
              },
            }),
          ];
    }),
    CATEGORY_LIMITS.cycle,
  );
}

function gymPlans(state: AppState, now: Date) {
  const settings = state.settings.notifications;
  if (state.settings.showGym === false || settings.gymReminders === false)
    return [];
  const latest = (state.gymSessions ?? [])
    .filter(
      (session) =>
        session.userId === state.currentUserId &&
        session.exercises.some((exercise) =>
          exercise.sets.some((set) => set.completed),
        ),
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
  const waitDays = Math.max(1, Math.min(14, settings.gymReminderDays ?? 3));
  let reminderDate = dateWithOffsetFrom(latest?.localDate ?? dateKey(now), waitDays);
  let trigger = triggerFor(state, reminderDate, "18:00");
  if (!trigger || !triggerCanStillPublish(trigger.date, now)) {
    reminderDate = dateWithOffsetFrom(dateKey(now), 1);
    trigger = triggerFor(state, reminderDate, "18:00");
  }
  if (!trigger) return [];
  return [
    plan(state, {
      scheduleKey: scheduleKey([
        "gym-v1",
        latest?.id ?? "first-workout",
        reminderDate,
        trigger.time,
      ]),
      category: "gym",
      at: trigger.date,
      title: "Ready for your next workout?",
      body: latest
        ? `It has been ${waitDays} days since ${latest.name}. Reuse it or choose another saved workout when you are ready.`
        : "Start a workout to build your personal exercise baseline.",
      data: { route: "/gym", notificationKind: "gym-reminder" },
    }),
  ];
}

function timerPlans(state: AppState, now: Date) {
  const timers = state.activityTimers?.length
    ? state.activityTimers
    : state.activeTimer
      ? [state.activeTimer]
      : [];
  const alertMinutes = state.settings.activityTimerAlertMinutes ?? [30, 60];
  const plans = timers
    .filter((timer) => timer.status === "running")
    .flatMap((timer) => {
      const metric = state.metrics.find((item) => item.id === timer.metricId);
      if (!metric) return [];
      const metricName = localizeMetricName(state.settings.language, metric);
      return activityTimerAlertCandidates({
        alertMinutes,
        elapsedSeconds: activityTimerElapsedSeconds(timer, now.getTime()),
        mode: timer.mode,
        ownerId: state.currentUserId,
        targetSeconds: timer.targetSeconds,
        timerId: timer.id,
      }).map((candidate) =>
        plan(state, {
          scheduleKey: scheduleKey([
            "timer-v1",
            timer.id,
            candidate.thresholdSeconds,
          ]),
          category: "timer",
          at: new Date(now.getTime() + candidate.triggerSeconds * 1000),
          title: candidate.completion
            ? `${metricName} complete`
            : `${metricName} · ${Math.round(candidate.thresholdSeconds / 60)} min`,
          body: candidate.completion
            ? "Your activity timer has finished."
            : "Your timed activity is still running.",
          data: {
            route: `/timer?timer=${encodeURIComponent(timer.id)}`,
            notificationKind: "activity-timer-alert",
            activityTimerId: timer.id,
          },
        }),
      );
    });
  return nearestUnique(plans, CATEGORY_LIMITS.timer);
}

function fastingPlans(state: AppState, now: Date) {
  if (!state.settings.notifications.reminders) return [];
  return nearestUnique(
    state.metrics.flatMap((metric) => {
      if (!metric.fastingSettings) return [];
      const fast = automaticFastProgress(
        state,
        state.currentUserId,
        now,
        metric.id,
      );
      const startedAt = fast.startedAt
        ? new Date(fast.startedAt).getTime()
        : Number.NaN;
      const completion = startedAt + fast.targetMinutes * 60_000;
      if (
        !fast.active ||
        !Number.isFinite(completion) ||
        completion < now.getTime() - WEB_REMINDER_LATE_GRACE_MS
      )
        return [];
      const metricName = localizeMetricName(state.settings.language, metric);
      return [
        plan(state, {
          scheduleKey: scheduleKey([
            "fasting-v1",
            metric.id,
            Math.round(startedAt),
            fast.targetMinutes,
          ]),
          category: "fasting",
          at: new Date(completion),
          title: `${metricName} complete`,
          body: "Your fasting target is complete.",
          data: {
            route: `/metric-detail?metric=${encodeURIComponent(metric.id)}`,
            metric: metric.id,
            notificationKind: "fasting-complete",
          },
        }),
      ];
    }),
    CATEGORY_LIMITS.fasting,
  );
}

/**
 * Mirrors native local schedules into a private server queue so an installed
 * PWA can receive reminders after the browser has suspended JavaScript.
 */
export function planWebReminderSchedule(
  state: AppState,
  now = new Date(),
) {
  if (!state.settings.notifications.pushEnabled) return [];
  return nearestUnique(
    [
      ...trackerPlans(state, now),
      ...productivityPlans(state, now),
      ...cyclePlans(state, now),
      ...gymPlans(state, now),
      ...timerPlans(state, now),
      ...fastingPlans(state, now),
    ],
    MAX_WEB_REMINDERS,
  );
}
