export type GoalReminderIdentity = {
  localDate: string;
  metricId: string;
  reminderIndex: number;
  time: string;
  userId: string;
};

export type GoalReminderSemanticIdentity = {
  body: string;
  localDate: string;
  metricId: string;
  route: string;
  time: string;
  title: string;
  userId: string;
};

export type LocalNotificationIdentity = {
  kind: string;
  localDate: string;
  sourceId: string;
  time: string;
  userId: string;
};

export type LocalNotificationScheduleDescriptor = {
  identifier: string;
  scheduleKey: string;
};

export type ExistingLocalNotificationSchedule = {
  identifier: string;
  scheduleKey?: string;
};

export const LOCAL_NOTIFICATION_BUDGETS = {
  goals: 28,
  productivity: 24,
  cycle: 5,
  gym: 1,
  activityTimers: 6,
} as const;

export const MAX_PENDING_LOCAL_NOTIFICATIONS = 64;

export const WEB_REMINDER_LATE_GRACE_MS = 4 * 60 * 1000;

/** Keep just-due PWA reminders publishable across a short suspend/retry. */
export function webReminderTriggerCanStillPublish(
  triggerAt: number,
  nowAt: number,
) {
  return (
    Number.isFinite(triggerAt) &&
    Number.isFinite(nowAt) &&
    triggerAt >= nowAt - WEB_REMINDER_LATE_GRACE_MS
  );
}

export type ActivityTimerAlertCandidate = {
  completion: boolean;
  identifier: string;
  thresholdSeconds: number;
  triggerSeconds: number;
};

/**
 * Stable remaining alerts for a running activity timer. Stable identities let
 * foreground/master-on recovery replace a missing native alarm without ever
 * adding a second copy of an alarm that survived in Expo's store.
 */
export function activityTimerAlertCandidates({
  alertMinutes,
  elapsedSeconds,
  mode,
  ownerId,
  targetSeconds,
  timerId,
}: {
  alertMinutes: readonly number[];
  elapsedSeconds: number;
  mode: "stopwatch" | "countdown";
  ownerId: string;
  targetSeconds?: number;
  timerId: string;
}): ActivityTimerAlertCandidate[] {
  const elapsed = Math.max(0, elapsedSeconds);
  const prefix = ["habhub-activity-timer-alert-v2", ownerId, timerId]
    .map((part) => encodeURIComponent(part))
    .join(":");
  const elapsedAlerts = [...new Set(alertMinutes)]
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
    .map((minutes) => Math.round(minutes * 60))
    .filter((threshold) => threshold > elapsed)
    .filter(
      (threshold) =>
        mode !== "countdown" || !targetSeconds || threshold < targetSeconds,
    )
    .map((thresholdSeconds) => ({
      completion: false,
      identifier: `${prefix}:elapsed:${thresholdSeconds}`,
      thresholdSeconds,
      triggerSeconds: Math.max(1, Math.round(thresholdSeconds - elapsed)),
    }));
  const completion =
    mode === "countdown" &&
    Number.isFinite(targetSeconds) &&
    (targetSeconds ?? 0) - elapsed >= 1
      ? [
          {
            completion: true,
            identifier: `${prefix}:completion:${Math.round(targetSeconds ?? 0)}`,
            thresholdSeconds: Math.round(targetSeconds ?? 0),
            triggerSeconds: Math.max(
              1,
              Math.round((targetSeconds ?? 0) - elapsed),
            ),
          },
        ]
      : [];
  return [...elapsedAlerts, ...completion].sort(
    (left, right) =>
      left.triggerSeconds - right.triggerSeconds ||
      left.identifier.localeCompare(right.identifier),
  );
}

/** Mirrors the Android workout action receiver's persisted privacy fence. */
export function workoutActionMatchesActiveGeneration({
  actionGeneration,
  actionOwnerId,
  activeGeneration,
  activeOwnerId,
  disabled,
}: {
  actionGeneration: string | undefined;
  actionOwnerId: string | undefined;
  activeGeneration: string | undefined;
  activeOwnerId: string | undefined;
  disabled: boolean;
}) {
  return (
    !disabled &&
    Boolean(actionOwnerId) &&
    Boolean(actionGeneration) &&
    actionOwnerId === activeOwnerId &&
    actionGeneration === activeGeneration
  );
}

/**
 * Serializes native notification mutations and provides a synchronous privacy
 * fence. Once cleanup begins, work queued by the old account is rejected until
 * an explicitly authorized account/onboarding state resumes the gate.
 */
export function createManagedLocalNotificationGate() {
  let suspended = true;
  let activeScope: string | undefined;
  let operation = Promise.resolve<unknown>(undefined);
  const remember = <T>(next: Promise<T>) => {
    operation = next.catch(() => undefined);
    return next;
  };
  return {
    isSuspended: () => suspended,
    resume: (scope: string) => {
      suspended = false;
      activeScope = scope;
    },
    run<T>(scope: string, task: () => Promise<T>) {
      if (suspended || activeScope !== scope)
        return Promise.resolve<T | undefined>(undefined);
      return remember(
        operation.then(() =>
          suspended || activeScope !== scope ? undefined : task(),
        ),
      );
    },
    suspendAndRun<T>(task: () => Promise<T>) {
      suspended = true;
      activeScope = undefined;
      return remember(operation.then(task));
    },
  };
}

/**
 * iOS retains at most 64 pending notifications for one app. Each scheduler has
 * a fixed share and keeps its nearest alarms first, so a long recurrence never
 * evicts today's reminder merely because it was enumerated later in state.
 */
export function earliestLocalNotificationSchedules<
  T extends { identifier: string; scheduledAt: number },
>(items: readonly T[], limit: number) {
  return [...items]
    .sort(
      (left, right) =>
        left.scheduledAt - right.scheduledAt ||
        left.identifier.localeCompare(right.identifier),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

/** Closed-app guard for reminders created while a fast is still running. */
export function notificationFallsAfterFastingTarget({
  startedAt,
  targetMinutes,
  triggerAt,
}: {
  startedAt: string | undefined;
  targetMinutes: number;
  triggerAt: number;
}) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(targetMinutes))
    return false;
  return triggerAt > startedAtMs + Math.max(0, targetMinutes) * 60 * 1000;
}

export function quietHoursAdjustedDateTime({
  enabled,
  end,
  localDate,
  start,
  time,
}: {
  enabled: boolean;
  end: string;
  localDate: string;
  start: string;
  time: string;
}) {
  if (!enabled || start === end) return { localDate, time };
  const quiet =
    start < end
      ? time >= start && time < end
      : time >= start || time < end;
  if (!quiet) return { localDate, time };
  if (start > end && time >= start) {
    const value = new Date(`${localDate}T12:00:00`);
    value.setDate(value.getDate() + 1);
    return {
      localDate: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
      time: end,
    };
  }
  return { localDate, time: end };
}

/**
 * Expo uses this identifier as the Android AlarmManager PendingIntent key.
 * Keeping it deterministic makes repeated hydration/resume passes replace the
 * same alarm instead of leaving two notifications scheduled for one reminder.
 */
export function goalReminderNotificationId({
  localDate,
  metricId,
  reminderIndex,
  time,
  userId,
}: GoalReminderIdentity) {
  return [
    "habhub-goal-v2",
    userId,
    metricId,
    String(reminderIndex),
    localDate,
    time,
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

/**
 * Identifies what the user will actually receive, independently of the source
 * array row. Two identical reminder rows (including rows restored by a cloud
 * merge) must not produce two alarms at the same effective quiet-hours time.
 * A different label/body or timer destination remains a distinct reminder.
 */
export function goalReminderSemanticKey({
  body,
  localDate,
  metricId,
  route,
  time,
  title,
  userId,
}: GoalReminderSemanticIdentity) {
  return JSON.stringify([
    userId,
    metricId,
    localDate,
    time,
    title,
    body,
    route,
  ]);
}

/**
 * Stable native identifier for every non-goal calendar alarm. A stable key is
 * what lets a sync pass leave an unchanged AlarmManager PendingIntent alone
 * instead of cancelling it immediately before it is due.
 */
export function localNotificationIdentifier({
  kind,
  localDate,
  sourceId,
  time,
  userId,
}: LocalNotificationIdentity) {
  return ["habhub-local-v3", userId, kind, sourceId, localDate, time]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

/** Payload/trigger signature persisted in notification data for no-op checks. */
export function localNotificationScheduleKey(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

/**
 * Pure half of native alarm reconciliation. Desired alarms are installed or
 * updated first; only after that succeeds may the caller cancel stale IDs.
 */
export function planLocalNotificationReconciliation({
  desired,
  existing,
  previousIds,
}: {
  desired: readonly LocalNotificationScheduleDescriptor[];
  existing: readonly ExistingLocalNotificationSchedule[];
  previousIds: readonly string[];
}) {
  const desiredById = new Map<string, LocalNotificationScheduleDescriptor>();
  for (const item of desired) {
    const prior = desiredById.get(item.identifier);
    if (prior && prior.scheduleKey !== item.scheduleKey)
      throw new Error(
        `Conflicting local notification plans for ${item.identifier}`,
      );
    desiredById.set(item.identifier, item);
  }
  const existingById = new Map(
    existing.map((item) => [item.identifier, item.scheduleKey] as const),
  );
  const toSchedule = [...desiredById.values()].filter(
    (item) => existingById.get(item.identifier) !== item.scheduleKey,
  );
  const toCancel = [...new Set(previousIds)].filter(
    (identifier) => !desiredById.has(identifier),
  );
  return {
    nextIds: [...desiredById.keys()],
    toCancel,
    toSchedule,
  };
}

/** Executable adapter contract: every upsert completes before any cancellation. */
export async function executeLocalNotificationReconciliation({
  cancel,
  schedule,
  toCancel,
  toSchedule,
}: {
  cancel: (identifier: string) => Promise<void>;
  schedule: (descriptor: LocalNotificationScheduleDescriptor) => Promise<void>;
  toCancel: readonly string[];
  toSchedule: readonly LocalNotificationScheduleDescriptor[];
}) {
  for (const descriptor of toSchedule) await schedule(descriptor);
  const results = await Promise.allSettled(toCancel.map(cancel));
  return {
    cancellationRetries: toCancel.filter(
      (_, index) => results[index]?.status === "rejected",
    ),
  };
}
