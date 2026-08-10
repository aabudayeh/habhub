import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState as NativeAppState, Platform } from 'react-native';
import { createClient, processLock, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { createPathBoundedFetch } from '@/src/lib/boundedFetch';
import { AppState } from '@/src/types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const cloudConfigured = Boolean(url && publishableKey);

// PostgREST uses a finite database connection pool. A cold account restore can
// legitimately need snapshot, group shell, activity and preference requests at
// once, but allowing every screen/effect to add unbounded parallel REST work
// makes all of them fail together with PGRST003. Auth, Storage, Edge Functions
// and Realtime are intentionally not queued, so login, media and chat transport
// keep their independent latency/abort behaviour.
const MAX_CONCURRENT_REST_REQUESTS = 3;
const nativeFetch = globalThis.fetch.bind(globalThis);
const boundedSupabaseFetch = createPathBoundedFetch(
  nativeFetch,
  MAX_CONCURRENT_REST_REQUESTS,
  '/rest/v1/',
);

export const supabase = cloudConfigured
  ? createClient(url!, publishableKey!, {
      global: { fetch: boundedSupabaseFetch },
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

const authUrlExchanges = new Map<string, Promise<boolean>>();

type AuthCallbackPayload = {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  error: string | null;
  errorDescription: string | null;
};

function parseAuthCallback(authUrl: string): AuthCallbackPayload | null {
  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const route = [parsed.hostname, parsed.pathname]
    .filter(Boolean)
    .join('/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  const nativeCallback =
    scheme === 'paceboard' &&
    (route === 'auth-callback' || route === 'auth/callback');
  const webCallback =
    (scheme === 'http' || scheme === 'https') &&
    (parsed.pathname.replace(/\/+$/, '') === '/auth-callback' ||
      parsed.pathname.replace(/\/+$/, '') === '/auth/callback');
  if (!nativeCallback && !webCallback) return null;

  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const fromEither = (name: string) =>
    parsed.searchParams.get(name) ?? hash.get(name);
  return {
    accessToken: fromEither('access_token'),
    refreshToken: fromEither('refresh_token'),
    code: fromEither('code'),
    error: fromEither('error') ?? fromEither('error_code'),
    errorDescription: fromEither('error_description'),
  };
}

export function isAuthCallbackUrl(authUrl: string) {
  return parseAuthCallback(authUrl) !== null;
}

function authExchangeKey(authUrl: string) {
  const payload = parseAuthCallback(authUrl);
  return payload?.code
    ? `code:${payload.code}`
    : payload?.accessToken
      ? `token:${payload.accessToken}`
      : `url:${authUrl}`;
}

/**
 * Android delivers an OAuth callback both through Linking and through the
 * WebBrowser result. A PKCE code is single-use, so share the same exchange
 * promise instead of racing two exchangeCodeForSession calls.
 */
export async function consumeAuthUrl(authUrl: string): Promise<boolean> {
  if (!supabase) return false;
  const payload = parseAuthCallback(authUrl);
  if (!payload) return false;
  const key = authExchangeKey(authUrl);
  const existing = authUrlExchanges.get(key);
  if (existing) return existing;
  const exchange = (async () => {
    if (payload.error) {
      const detail = payload.errorDescription?.replace(/\+/g, ' ').trim();
      throw new Error(detail || `Authentication failed (${payload.error}).`);
    }
    if (payload.accessToken && payload.refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: payload.accessToken,
        refresh_token: payload.refreshToken,
      });
      if (error) throw error;
      return true;
    }
    if (payload.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(payload.code);
      if (error) throw error;
      return true;
    }
    throw new Error(
      'The sign-in provider returned to HabHub without a session. Please try again.',
    );
  })();
  authUrlExchanges.set(key, exchange);
  // Android can deliver the same callback through Expo WebBrowser and Linking.
  // Keep the shared promise briefly so both consumers observe one exchange,
  // then release the OAuth URL (which can contain tokens) from memory.
  const release = () => {
    setTimeout(() => {
      if (authUrlExchanges.get(key) === exchange) authUrlExchanges.delete(key);
    }, 60_000);
  };
  exchange.then(release, () => authUrlExchanges.delete(key));
  return exchange;
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
