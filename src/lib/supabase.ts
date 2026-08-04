import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState as NativeAppState, Platform } from 'react-native';
import { createClient, processLock, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { AppState } from '@/src/types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const cloudConfigured = Boolean(url && publishableKey);

export const supabase = cloudConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        ...(Platform.OS !== 'web'
          ? { storage: AsyncStorage, lock: processLock }
          : {}),
        autoRefreshToken: true,
        persistSession: true,
        // Auth callback routes consume the URL exactly once. Leaving Supabase's
        // automatic URL detector enabled as well can race the explicit PKCE
        // exchange and intermittently discard a valid web login.
        detectSessionInUrl: false,
      },
    })
  : null;

if (supabase && Platform.OS !== 'web') {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  supabase.realtime.onHeartbeat((status) => {
    if (
      status !== 'disconnected' ||
      NativeAppState.currentState !== 'active' ||
      reconnectTimer
    ) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (
        NativeAppState.currentState === 'active' &&
        !supabase.realtime.isConnected()
      )
        supabase.realtime.connect();
    }, 1200);
  });
  NativeAppState.addEventListener('change', (status) => {
    if (status === 'active') {
      supabase.auth.startAutoRefresh();
      if (!supabase.realtime.isConnected()) supabase.realtime.connect();
    } else {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      supabase.auth.stopAutoRefresh();
      // Native background execution is suspended unpredictably. Push
      // notifications carry remote events while backgrounded; closing the
      // websocket avoids a stale connection and unnecessary radio wakeups.
      supabase.realtime.disconnect();
    }
  });
}

export async function getCloudSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error('Add Supabase environment variables first.');
  const redirectTo = Linking.createURL('/settings');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
}

export async function consumeAuthUrl(authUrl: string) {
  if (!supabase) return;
  const parsed = new URL(authUrl);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    return;
  }
  const code = parsed.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  }
}

export async function saveSnapshot(state: AppState) {
  if (!supabase) throw new Error('Cloud backup is not configured.');
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in before syncing.');
  const { error } = await supabase.from('user_snapshots').upsert({
    user_id: data.user.id,
    payload: { ...state, photos: [] },
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function loadSnapshot(): Promise<AppState | null> {
  if (!supabase) throw new Error('Cloud backup is not configured.');
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error('Sign in before syncing.');
  const { data, error } = await supabase
    .from('user_snapshots')
    .select('payload')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as AppState | undefined) ?? null;
}
