import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';
import { AppState, NotificationSettings } from '@/src/types';
import { cycleForecast } from '@/src/domain/cycle';
import { dateKey, dateWithOffsetFrom } from '@/src/domain/date';
import { effectiveGoalTarget, isMetricTrackedOnDate, safeMetricValue, scheduledGoalReached } from '@/src/domain/metrics';
import {
  averageGymRestSeconds,
  completedGymSets,
  estimatedOneRepMax,
  exerciseHistory,
  exerciseIdentity,
  trainingVolumeKg,
} from '@/src/domain/gym';
import {
  scheduleAppliesOnDate,
  todoAppearsOnDate,
} from '@/src/domain/schedule';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('paceboard', {
    name: 'MetricRally messages and updates',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    sound: 'default',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

function storedPreferences(preferences: NotificationSettings) {
  return { ...preferences, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}

async function registerPushToken(
  token: string,
  preferences: NotificationSettings,
) {
  if (!supabase) return;
  const { error } = await supabase.rpc('register_device_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_preferences: storedPreferences(preferences),
  });
  if (error) throw error;
}

export async function enablePushNotifications(userId: string, preferences: NotificationSettings) {
  if (Platform.OS === 'web') throw new Error('Push notifications are available in the installed iOS and Android app.');
  if (!Device.isDevice) throw new Error('Use a physical device to enable push notifications.');
  await ensureNotificationChannel();
  let permission = await Notifications.getPermissionsAsync();
  const granted = () => permission.granted || permission.status === Notifications.PermissionStatus.GRANTED;
  if (!granted()) permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  if (!granted()) throw new Error('Android/iOS has not granted notification permission. Enable it in system settings and retry.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build is missing its EAS project ID.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (supabase) {
    try {
      await registerPushToken(token, preferences);
    } catch (error) {
      throw new Error(
        `Permission is enabled, but cloud registration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return token;
}

export async function updatePushPreferences(userId: string, preferences: NotificationSettings) {
  if (!supabase || Platform.OS === 'web') return;
  await ensureNotificationChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await registerPushToken(token, preferences);
  } catch { /* The next foreground/settings visit retries registration. */ }
}

export async function disablePushNotifications(userId: string) {
  if (!supabase || Platform.OS === 'web') return;
  await supabase.from('device_push_tokens').delete().eq('user_id', userId);
}

const CYCLE_IDS = 'north-cycle-notification-ids-v1';
const GOAL_IDS = 'metric-rally-goal-reminder-ids-v1';
const GYM_IDS = 'metric-rally-gym-notification-ids-v1';
const GYM_ACHIEVEMENT = 'metric-rally-gym-achievement-v1';
const PRODUCTIVITY_IDS = 'metric-rally-productivity-notification-ids-v1';

function reminderTime(state: AppState, configured: string) {
  if (!state.settings.notifications.quietHoursEnabled) return configured;
  const start = state.settings.notifications.quietHoursStart;
  const end = state.settings.notifications.quietHoursEnd;
  const quiet = start <= end
    ? configured >= start && configured < end
    : configured >= start || configured < end;
  return quiet ? end : configured;
}

function goalReminderBody(state: AppState, metric: AppState['metrics'][number], localDate: string) {
  const value = safeMetricValue(state, metric, state.currentUserId, localDate);
  const target = effectiveGoalTarget(state, metric, state.currentUserId, localDate);
  const remaining = Math.max(0, target - value);
  if (metric.id === 'sleep') {
    if (value <= 0) return 'Your wind-down reminder: an earlier bedtime makes the 7–9 hour sleep range easier to reach.';
    if (metric.goalRange && value < metric.goalRange.min) return `${(metric.goalRange.min - value).toFixed(1)} more hours would reach your sleep range.`;
    if (metric.goalRange && value > metric.goalRange.max) return `Sleep is ${(value - metric.goalRange.max).toFixed(1)} hours above your selected range.`;
    return 'Your sleep duration is inside your selected range.';
  }
  if (metric.goalRange) {
    if (value < metric.goalRange.min) return `${metric.name} is ${Math.round(metric.goalRange.min - value)} ${metric.unit} below your range.`;
    if (value > metric.goalRange.max) return `${metric.name} is ${Math.round(value - metric.goalRange.max)} ${metric.unit} above your range.`;
    return `${metric.name} is inside your selected range.`;
  }
  if (metric.id === 'steps')
    return remaining > 0
      ? `${Math.round(remaining).toLocaleString()} steps remain. A short walk can move today forward.`
      : 'Your step goal is complete.';
  if (metric.id === 'food') {
    if (value <= 0) return 'Log your meal when you are ready so today’s energy plan stays accurate.';
    const lastMeal = state.entries
      .filter((entry) => entry.userId === state.currentUserId && entry.metricId === 'food' && entry.localDate === localDate)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.nutrition?.mealType;
    return value > target
      ? `You are ${Math.round(value - target)} kcal over today’s current food allowance. Activity can still improve the daily balance.`
      : `${lastMeal ? `${lastMeal[0].toUpperCase()}${lastMeal.slice(1)} logged. ` : ''}${Math.round(remaining)} kcal remain for today.`;
  }
  if (['exercise', 'workout_duration'].includes(metric.id)) {
    const deficit = state.metrics.find((item) => item.id === 'deficit');
    const needed = deficit
      ? Math.max(0, effectiveGoalTarget(state, deficit, state.currentUserId, localDate) - safeMetricValue(state, deficit, state.currentUserId, localDate))
      : remaining;
    const walkingKcalPerMinute = Math.max(3, state.settings.energyProfile.weightKg * 0.055);
    return needed > 0
      ? `About ${Math.round(needed)} active kcal—or roughly ${Math.ceil(needed / walkingKcalPerMinute)} minutes of walking—would close today’s energy gap.`
      : `You have ${Math.round(remaining)} ${metric.unit} left for this goal.`;
  }
  if (metric.goal.kind === 'at_most')
    return value > target
      ? `${metric.name} is ${Math.round(value - target)} ${metric.unit} over its target.`
      : `${Math.round(target - value)} ${metric.unit} remain within today’s target.`;
  return `${Math.round(remaining)} ${metric.unit} remain to reach today’s ${metric.name.toLowerCase()} goal.`;
}

export async function syncGoalNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse((await AsyncStorage.getItem(GOAL_IDS)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders) {
    await AsyncStorage.setItem(GOAL_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const now = new Date();
  const today = dateKey(now);
  const ids: string[] = [];
  for (let offset = 0; offset < 8 && ids.length < 64; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const metric of state.metrics) {
      if (
        !(metric.reminders?.some((item) => item.enabled) || metric.reminder?.enabled) ||
        metric.goalEnabled === false ||
        !isMetricTrackedOnDate(state, metric, localDate) ||
        (offset === 0 && scheduledGoalReached(state, metric, state.currentUserId, localDate))
      ) continue;
      const configured = metric.reminders?.length ? metric.reminders : metric.reminder ? [metric.reminder] : [];
      for (const reminder of configured.filter((item) => item.enabled)) {
        if (!/^\d{2}:\d{2}$/.test(reminder.time)) continue;
        const time = reminderTime(state, reminder.time);
        const trigger = new Date(`${localDate}T${time}:00`);
        if (trigger <= now) continue;
        ids.push(await Notifications.scheduleNotificationAsync({
          content: {
            title: `${metric.name} reminder`,
            body: goalReminderBody(state, metric, localDate),
            data: { route: '/metric-detail', metric: metric.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
        }));
        if (ids.length >= 64) break;
      }
      if (ids.length >= 64) break;
    }
  }
  await AsyncStorage.setItem(GOAL_IDS, JSON.stringify(ids));
}

export async function syncCycleNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse((await AsyncStorage.getItem(CYCLE_IDS)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || (settings.cyclePredictions === false && settings.cyclePhaseUpdates !== true)) {
    await AsyncStorage.setItem(CYCLE_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const today = dateKey();
  const forecast = cycleForecast(state, state.currentUserId, today);
  if (!forecast.nextPeriodStart) return;
  const schedule: { date: string; title: string; body: string }[] = [];
  if (settings.cyclePredictions !== false) {
    schedule.push({ date: dateWithOffsetFrom(forecast.nextPeriodStart, -(settings.cycleReminderDays ?? 2)), title: 'Period estimate', body: `Your next period is estimated in ${settings.cycleReminderDays ?? 2} days. This may change as MetricRally learns your cycle.` });
  }
  if (settings.cyclePhaseUpdates === true) {
    const currentStart = dateWithOffsetFrom(forecast.nextPeriodStart, -forecast.averageCycleDays);
    const future = (candidate: string) => {
      let next = candidate;
      while (next <= today) next = dateWithOffsetFrom(next, forecast.averageCycleDays);
      return next;
    };
    schedule.push(
      { date: future(currentStart), title: 'Menstrual phase estimate', body: 'Your next cycle is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averagePeriodDays)), title: 'Follicular phase estimate', body: 'Your follicular phase is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 15)), title: 'Ovulation phase estimate', body: 'Estimated ovulation phase begins around today. This is not a contraceptive prediction.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 12)), title: 'Luteal phase estimate', body: 'Your luteal phase is estimated to begin around today.' },
    );
  }
  const ids: string[] = [];
  for (const item of schedule.filter((item) => item.date > today)) {
    const trigger = new Date(`${item.date}T09:00:00`);
    ids.push(await Notifications.scheduleNotificationAsync({ content: { title: item.title, body: item.body, data: { route: '/metric-detail', metric: 'menstrual_cycle' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger } }));
  }
  await AsyncStorage.setItem(CYCLE_IDS, JSON.stringify(ids));
}

export async function syncProductivityNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse(
    (await AsyncStorage.getItem(PRODUCTIVITY_IDS)) ?? '[]',
  ) as string[];
  await Promise.all(
    previous.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(
        () => undefined,
      ),
    ),
  );
  if (!state.settings.notifications.pushEnabled) {
    await AsyncStorage.setItem(PRODUCTIVITY_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const now = new Date();
  const today = dateKey(now);
  const ids: string[] = [];
  const schedule = async (
    localDate: string,
    time: string,
    title: string,
    body: string,
    route: string,
  ) => {
    if (ids.length >= 64 || !/^\d{2}:\d{2}$/.test(time)) return;
    const trigger = new Date(
      `${localDate}T${reminderTime(state, time)}:00`,
    );
    if (trigger <= now) return;
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { route } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
        },
      }),
    );
  };
  for (let offset = 0; offset < 31 && ids.length < 64; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const todo of
      state.settings.notifications.todoReminders === false
        ? []
        : state.todos ?? []) {
      if (
        !todoAppearsOnDate(todo, localDate) ||
        todo.completedDates.includes(localDate) ||
        (!todo.recurrence && Boolean(todo.completedAt))
      )
        continue;
      for (const reminder of todo.reminders) {
        if (reminder.at && reminder.at.slice(0, 10) !== localDate) continue;
        await schedule(
          reminder.at?.slice(0, 10) ?? localDate,
          reminder.time ?? todo.dueAt?.slice(11, 16) ?? '09:00',
          todo.dueAt?.slice(0, 10) === localDate
            ? 'To-do deadline'
            : 'To-do reminder',
          todo.title,
          `/todo-editor?id=${todo.id}`,
        );
      }
    }
    for (const reminder of state.calendarReminders ?? []) {
      if (
        !reminder.enabled ||
        !scheduleAppliesOnDate(reminder.schedule, today, localDate)
      )
        continue;
      await schedule(
        localDate,
        reminder.time,
        reminder.title,
        reminder.kind === 'tracker'
          ? 'A scheduled tracker reminder is ready.'
          : reminder.kind === 'todo'
            ? 'A scheduled to-do reminder is ready.'
            : 'Scheduled reminder',
        '/calendar',
      );
    }
  }
  await AsyncStorage.setItem(PRODUCTIVITY_IDS, JSON.stringify(ids));
}

/**
 * Keeps gym prompts private and on-device. Group activity still uses the
 * regular shared tracker entries created from a completed session.
 */
export async function syncGymNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const settings = state.settings.notifications;
  const idsKey = `${GYM_IDS}:${state.currentUserId}`;
  const achievementKey = `${GYM_ACHIEVEMENT}:${state.currentUserId}`;
  const previous = JSON.parse((await AsyncStorage.getItem(idsKey)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  if (!settings.pushEnabled || state.settings.showGym === false) {
    await AsyncStorage.setItem(idsKey, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const sessions = (state.gymSessions ?? [])
    .filter(
      (session) =>
        session.userId === state.currentUserId &&
        completedGymSets(session.exercises) > 0,
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const latest = sessions[0];
  const ids: string[] = [];

  if (settings.gymAchievements !== false && latest) {
    const alreadyNotified = await AsyncStorage.getItem(achievementKey);
    if (alreadyNotified !== latest.id) {
      const records = latest.exercises.flatMap((exercise) => {
        const current = Math.max(
          0,
          ...exercise.sets
            .filter((set) => set.completed)
            .map((set) => estimatedOneRepMax(set.weightKg, set.reps)),
        );
        const previousHistory = exerciseHistory(
          sessions.filter((session) => session.id !== latest.id),
          state.currentUserId,
          exerciseIdentity(exercise),
        );
        const previousBest = Math.max(
          0,
          ...previousHistory.map((item) => item.estimatedOneRepMaxKg),
        );
        return current > 0 && previousBest > 0 && current >= previousBest * 1.005
          ? [exercise.name]
          : [];
      });
      const previousComparable =
        sessions
          .slice(1)
          .find(
            (session) =>
              (latest.planId && session.planId === latest.planId) ||
              session.name.trim().toLowerCase() ===
                latest.name.trim().toLowerCase(),
          ) ?? sessions[1];
      const latestRest = averageGymRestSeconds(latest.exercises);
      const priorRest = previousComparable
        ? averageGymRestSeconds(previousComparable.exercises)
        : 0;
      const restCopy =
        latestRest > 0 && priorRest > 0
          ? ` Average rest was ${Math.abs(latestRest - priorRest)}s ${latestRest > priorRest ? 'longer' : 'shorter'} than ${previousComparable.name}.`
          : '';
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: records.length ? 'New gym best' : 'Workout saved',
            body: records.length
              ? `${records.slice(0, 2).join(' and ')} moved above your prior estimated best.${restCopy}`
              : `${completedGymSets(latest.exercises)} sets and ${Math.round(trainingVolumeKg(latest.exercises)).toLocaleString()} kg of volume logged.${restCopy}`,
            data: { route: '/gym' },
          },
          trigger: null,
        }),
      );
      await AsyncStorage.setItem(achievementKey, latest.id);
    }
  }

  if (settings.gymReminders !== false) {
    const waitDays = Math.max(1, Math.min(14, settings.gymReminderDays ?? 3));
    const baseDate = latest?.localDate ?? dateKey();
    let reminderDate = dateWithOffsetFrom(baseDate, waitDays);
    const now = new Date();
    const time = reminderTime(state, '18:00');
    let trigger = new Date(`${reminderDate}T${time}:00`);
    if (trigger <= now) {
      reminderDate = dateWithOffsetFrom(dateKey(), 1);
      trigger = new Date(`${reminderDate}T${time}:00`);
    }
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Ready for your next gym day?',
          body: latest
            ? `It has been ${waitDays} days since ${latest.name}. Reuse it or choose another saved workout when you are ready.`
            : 'Start a workout to build your personal exercise baseline.',
          data: { route: '/gym' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
        },
      }),
    );
  }
  await AsyncStorage.setItem(idsKey, JSON.stringify(ids));
}
