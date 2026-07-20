import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/src/lib/supabase';
import { NotificationSettings } from '@/src/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function storedPreferences(preferences: NotificationSettings) {
  return { ...preferences, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}

export async function enablePushNotifications(userId: string, preferences: NotificationSettings) {
  if (Platform.OS === 'web') throw new Error('Push notifications are available in the installed iOS and Android app.');
  if (!Device.isDevice) throw new Error('Use a physical device to enable push notifications.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('paceboard', { name: 'North', importance: Notifications.AndroidImportance.DEFAULT });
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
