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

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function storedPreferences(preferences: NotificationSettings) {
  return { ...preferences, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}

export async function enablePushNotifications(userId: string, preferences: NotificationSettings) {
  if (Platform.OS === 'web') throw new Error('Push notifications are available in the installed iOS and Android app.');
  if (!Device.isDevice) throw new Error('Use a physical device to enable push notifications.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('paceboard', { name: 'MetricRally', importance: Notifications.AndroidImportance.DEFAULT });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  if (!permission.granted) throw new Error('Notification permission was not granted. You can enable it in system settings.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build is missing its EAS project ID.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (supabase) {
    const { error } = await supabase.from('device_push_tokens').upsert({ token, user_id: userId, platform: Platform.OS, preferences: storedPreferences(preferences) });
    if (error) throw error;
  }
  return token;
}

export async function updatePushPreferences(userId: string, preferences: NotificationSettings) {
  if (!supabase || Platform.OS === 'web') return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await supabase.from('device_push_tokens').upsert({ token, user_id: userId, platform: Platform.OS, preferences: storedPreferences(preferences) });
  } catch { /* The next foreground/settings visit retries registration. */ }
}

export async function disablePushNotifications(userId: string) {
  if (!supabase || Platform.OS === 'web') return;
  await supabase.from('device_push_tokens').delete().eq('user_id', userId);
}

const CYCLE_IDS = 'north-cycle-notification-ids-v1';
const GOAL_IDS = 'metric-rally-goal-reminder-ids-v1';

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
