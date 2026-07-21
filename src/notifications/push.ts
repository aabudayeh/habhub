import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';
import { AppState, NotificationSettings } from '@/src/types';
import { cycleForecast } from '@/src/domain/cycle';
import { dateKey, dateWithOffsetFrom } from '@/src/domain/date';

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
