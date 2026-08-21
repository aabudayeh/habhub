import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { activityTimerElapsedSeconds } from "@/src/domain/activityTimer";
import {
  activityTimerAlertCandidates,
  localNotificationScheduleKey,
  LOCAL_NOTIFICATION_BUDGETS,
} from "@/src/domain/notificationScheduling";
import { translateUiText } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import {
  ensureLocalNotificationChannels,
  intervalLocalNotificationTrigger,
} from "@/src/notifications/localChannels";
import {
  reconcileLocalNotifications,
  type LocalNotificationPlan,
} from "@/src/notifications/localScheduling";
import { ActivityTimer, AppState } from "@/src/types";

export const ACTIVITY_TIMER_ALERT_IDS = "habhub-activity-timer-alert-ids-v2";

export type ActivityTimerAlertInstallation = {
  notificationId?: string;
  notificationIds: string[];
};

type PlannedTimerAlert = ReturnType<typeof activityTimerAlertCandidates>[number] & {
  body: string;
  timerId: string;
  title: string;
};

function accountTimers(state: AppState) {
  return state.activityTimers?.length
    ? state.activityTimers
    : state.activeTimer
      ? [state.activeTimer]
      : [];
}

function timerAlertPlans(state: AppState, now: number): PlannedTimerAlert[] {
  const alertMinutes = state.settings.activityTimerAlertMinutes ?? [30, 60];
  return accountTimers(state)
    .filter((timer) => timer.status === "running")
    .flatMap((timer) => {
      const metric = state.metrics.find((item) => item.id === timer.metricId);
      if (!metric) return [];
      const metricName = localizeMetricName(state.settings.language, metric);
      return activityTimerAlertCandidates({
        alertMinutes,
        elapsedSeconds: activityTimerElapsedSeconds(timer, now),
        mode: timer.mode,
        ownerId: state.currentUserId,
        targetSeconds: timer.targetSeconds,
        timerId: timer.id,
      }).map((candidate) => ({
        ...candidate,
        timerId: timer.id,
        title: candidate.completion
          ? `${metricName} ${translateUiText(state.settings.language, "complete")}`
          : `${metricName} · ${Math.round(candidate.thresholdSeconds / 60)} min`,
        body: translateUiText(
          state.settings.language,
          candidate.completion
            ? "Your activity timer has finished."
            : "Your timed activity is still running.",
        ),
      }));
    })
    .sort(
      (left, right) =>
        left.triggerSeconds - right.triggerSeconds ||
        left.identifier.localeCompare(right.identifier),
    )
    .slice(0, LOCAL_NOTIFICATION_BUDGETS.activityTimers);
}

function installationByTimer(plans: readonly PlannedTimerAlert[]) {
  const result: Record<string, ActivityTimerAlertInstallation> = {};
  plans.forEach((plan) => {
    const current = result[plan.timerId] ?? { notificationIds: [] };
    if (plan.completion) current.notificationId = plan.identifier;
    else current.notificationIds.push(plan.identifier);
    result[plan.timerId] = current;
  });
  return result;
}

/**
 * Reconcile the six app-wide timer alert slots from persisted account state.
 * This is used both when a timer starts/resumes and when master notifications
 * are re-enabled after their native alarms were deliberately cleared.
 */
export async function syncActivityTimerAlerts(
  state: AppState,
  options: { requestPermission?: boolean } = {},
) {
  if (Platform.OS === "web" || !state.settings.notifications.pushEnabled)
    return {} as Record<string, ActivityTimerAlertInstallation>;
  const permission = options.requestPermission
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  if (!permission.granted)
    return {} as Record<string, ActivityTimerAlertInstallation>;
  await ensureLocalNotificationChannels(state.settings.language);
  const now = Date.now();
  const plans = timerAlertPlans(state, now);
  const desired: LocalNotificationPlan[] = plans.map((plan) => {
    const scheduledAt = now + plan.triggerSeconds * 1000;
    return {
      identifier: plan.identifier,
      scheduledAt,
      scheduleKey: localNotificationScheduleKey([
        plan.identifier,
        Math.round(scheduledAt / 1000),
        plan.title,
        plan.body,
      ]),
      content: {
        title: plan.title,
        body: plan.body,
        sound: "default",
        data: {
          route: `/timer?timer=${encodeURIComponent(plan.timerId)}`,
          notificationKind: "activity-timer-alert",
          activityTimerId: plan.timerId,
          notificationOwnerId: state.currentUserId,
        },
      },
      trigger: intervalLocalNotificationTrigger(plan.triggerSeconds),
    };
  });
  // Reconciliation itself is inside the account gate. A rapid off→on pass is
  // therefore queued after cleanup and rebuilds the same stable identities.
  await reconcileLocalNotifications(
    ACTIVITY_TIMER_ALERT_IDS,
    desired,
    state.currentUserId,
  );
  return installationByTimer(plans);
}

/** Cancel stored and reconstructed alerts for one timer without touching peers. */
export async function cancelActivityTimerAlerts(
  timer: ActivityTimer | undefined,
  ownerId: string,
) {
  if (!timer || Platform.OS === "web") return;
  const ids = new Set(
    [timer.notificationId, ...(timer.notificationIds ?? [])].filter(
      (identifier): identifier is string => Boolean(identifier),
    ),
  );
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    pending.forEach((request) => {
      const data = request.content.data;
      if (
        data?.notificationKind === "activity-timer-alert" &&
        data?.activityTimerId === timer.id &&
        data?.notificationOwnerId === ownerId
      )
        ids.add(request.identifier);
    });
  } catch {
    // Persisted identifiers still provide the normal cancellation path.
  }
  await Promise.all(
    [...ids].map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier).catch(
        () => undefined,
      ),
    ),
  );
}
