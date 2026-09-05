import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  createManagedLocalNotificationGate,
  executeLocalNotificationReconciliation,
  localNotificationScheduleKey,
  MAX_PENDING_LOCAL_NOTIFICATIONS,
  planLocalNotificationReconciliation,
} from "@/src/domain/notificationScheduling";
import {
  dateLocalNotificationTrigger,
  immediateLocalNotificationTrigger,
} from "@/src/notifications/localChannels";
import { getExactAlarmStatus } from "@/src/notifications/exactAlarm";

export type LocalNotificationPlan = {
  content: Notifications.NotificationContentInput;
  identifier: string;
  scheduledAt: number;
  scheduleKey: string;
  trigger: Notifications.NotificationTriggerInput;
};

const SCHEDULE_KEY_DATA = "habhubScheduleKey";
const managedLocalNotificationGate = createManagedLocalNotificationGate();

function parsedIds(raw: string | null) {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function dateLocalNotificationPlan({
  content,
  date,
  identifier,
}: {
  content: Notifications.NotificationContentInput;
  date: Date;
  identifier: string;
}): LocalNotificationPlan {
  const trigger = dateLocalNotificationTrigger(date);
  const scheduleKey = localNotificationScheduleKey([
    date.getTime(),
    content.title,
    content.subtitle,
    content.body,
    content.sound,
    content.data,
    "habhub-reminders-v1",
  ]);
  return {
    identifier,
    scheduledAt: date.getTime(),
    scheduleKey,
    content: {
      ...content,
      sound: content.sound === undefined ? "default" : content.sound,
      data: {
        ...(content.data ?? {}),
        [SCHEDULE_KEY_DATA]: scheduleKey,
      },
    },
    trigger,
  };
}

async function reconcileLocalNotificationsNow(
  storageKey: string,
  desired: readonly LocalNotificationPlan[],
  ownerId: string,
) {
  const previousIds = parsedIds(await AsyncStorage.getItem(storageKey));
  const deliveryMode = await getExactAlarmStatus().catch(() => "unsupported");
  const effectiveDesired = desired.map((plan) => {
    const scheduleKey = localNotificationScheduleKey([
      plan.scheduleKey,
      deliveryMode,
      ownerId,
    ]);
    return {
      ...plan,
      scheduleKey,
      content: {
        ...plan.content,
        data: {
          ...(plan.content.data ?? {}),
          accountId: ownerId,
          [SCHEDULE_KEY_DATA]: scheduleKey,
        },
      },
    };
  });
  let scheduled: Notifications.NotificationRequest[] = [];
  let enumerated = true;
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    enumerated = false;
    // Stable identifiers make a conservative re-upsert safe when an OEM fails
    // to enumerate alarms. Most importantly, old alarms remain untouched.
  }
  if (Platform.OS === "ios" && !enumerated) {
    // iOS's pending store is capped app-wide. Preserve its current alarms and
    // retry later instead of blindly scheduling enough to evict one of them.
    throw new Error("Could not inspect iOS pending notification capacity.");
  }
  const reconciliation = planLocalNotificationReconciliation({
    desired: effectiveDesired,
    existing: scheduled.map((request) => ({
      identifier: request.identifier,
      scheduleKey:
        typeof request.content.data?.[SCHEDULE_KEY_DATA] === "string"
          ? request.content.data[SCHEDULE_KEY_DATA]
          : undefined,
    })),
    previousIds,
  });
  const desiredById = new Map(
    effectiveDesired.map((plan) => [plan.identifier, plan] as const),
  );

  const existingIds = new Set(scheduled.map((request) => request.identifier));
  let capacity =
    Platform.OS === "ios"
      ? Math.max(0, MAX_PENDING_LOCAL_NOTIFICATIONS - scheduled.length)
      : Number.POSITIVE_INFINITY;
  const newAlarmCount = reconciliation.toSchedule.filter(
    (descriptor) => !existingIds.has(descriptor.identifier),
  ).length;
  const capacityNeeded = Math.max(0, newAlarmCount - capacity);
  const capacityCandidates = reconciliation.toCancel
    .filter((identifier) => existingIds.has(identifier))
    .slice(0, capacityNeeded);
  const preCancelled = new Set<string>();
  for (const identifier of capacityCandidates) {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      preCancelled.add(identifier);
      capacity += 1;
    } catch {
      // A failed stale cancellation cannot be treated as free iOS capacity.
    }
  }
  const skippedForCapacity = new Set<string>();
  const capacitySafeSchedules = reconciliation.toSchedule.filter(
    (descriptor) => {
      if (existingIds.has(descriptor.identifier)) return true;
      if (capacity > 0) {
        capacity -= 1;
        return true;
      }
      skippedForCapacity.add(descriptor.identifier);
      return false;
    },
  );

  // Never create a cancel-to-trigger gap for an unchanged alarm. The only
  // pre-cancellations above are stale IDs no longer present in the desired
  // category, and they are used solely to respect iOS's app-wide hard cap.
  const { cancellationRetries } =
    await executeLocalNotificationReconciliation({
      toSchedule: capacitySafeSchedules,
      toCancel: reconciliation.toCancel.filter(
        (identifier) => !preCancelled.has(identifier),
      ),
      schedule: async (descriptor) => {
        const plan = desiredById.get(descriptor.identifier);
        if (!plan) return;
        await Notifications.scheduleNotificationAsync({
          identifier: plan.identifier,
          content: plan.content,
          trigger: plan.trigger,
        });
      },
      cancel: (identifier) =>
        Notifications.cancelScheduledNotificationAsync(identifier),
    });
  await AsyncStorage.setItem(
    storageKey,
    JSON.stringify([
      ...reconciliation.nextIds.filter(
        (identifier) => !skippedForCapacity.has(identifier),
      ),
      ...cancellationRetries.filter(
        (identifier) => !reconciliation.nextIds.includes(identifier),
      ),
    ]),
  );
}

/** Serialize all local alarm categories around Expo's shared native store. */
export function reconcileLocalNotifications(
  storageKey: string,
  desired: readonly LocalNotificationPlan[],
  ownerId: string,
) {
  return managedLocalNotificationGate.run(ownerId, () =>
    reconcileLocalNotificationsNow(storageKey, desired, ownerId),
  );
}

/** Allows account-authorized scheduler effects to resume after a cleanup. */
export function resumeManagedLocalNotifications(ownerId: string) {
  managedLocalNotificationGate.resume(ownerId);
}

/** Serialize live personal alerts with sign-out/master-off cleanup. */
export function scheduleManagedLocalNotification(
  request: Notifications.NotificationRequestInput,
  ownerId: string,
) {
  return managedLocalNotificationGate.run(ownerId, () =>
    Notifications.scheduleNotificationAsync({
      ...request,
      content: {
        ...request.content,
        data: { ...(request.content.data ?? {}), accountId: ownerId },
      },
    }),
  );
}

export function scheduleImmediateManagedLocalNotification(
  content: Notifications.NotificationContentInput,
  ownerId: string,
) {
  return scheduleManagedLocalNotification(
    {
      content,
      trigger: immediateLocalNotificationTrigger(),
    },
    ownerId,
  );
}

/** Sign-out fence: remove every alarm/banner before another account can load. */
export function clearAllLocalNotifications(storageKeys: readonly string[]) {
  return managedLocalNotificationGate.suspendAndRun(async () => {
    // expo-notifications intentionally omits these native scheduling methods
    // on Web. Account cleanup must still clear HabHub's persisted schedule
    // ownership without turning a successful Supabase sign-out into an error.
    if (Platform.OS !== "web") {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.dismissAllNotificationsAsync();
    }
    await AsyncStorage.multiRemove([...new Set(storageKeys)]);
  });
}
