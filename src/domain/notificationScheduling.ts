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
