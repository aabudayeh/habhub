import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { readableAuthError } from '@/src/domain/authErrors';
import { cloudConfigured, consumeAuthUrl, isAuthCallbackUrl, supabase } from '@/src/lib/supabase';

const DEMO_MODE_KEY = 'paceboard-explicit-demo-mode-v1';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'demo';

type AuthContextValue = {
  configured: boolean;
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  passwordRecovery: boolean;
  authError: string | null;
  clearAuthError: () => void;
  reportAuthError: (error: unknown) => void;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<'confirmed' | 'verification-required'>;
  sendMagicLink: (email: string) => Promise<void>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  continueInDemo: () => Promise<void>;
  useCloudAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

WebBrowser.maybeCompleteAuthSession();

function callbackUrl() {
  if (Platform.OS !== 'web')
    return Linking.createURL('auth-callback', { scheme: 'paceboard' });
  const configuredOrigin = process.env.EXPO_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth-callback`;
  }
  return `${configuredOrigin || 'https://habhub.expo.app'}/auth-callback`;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(cloudConfigured ? 'loading' : 'demo');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const oauthAttemptRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!supabase) {
      setStatus('demo');
      return;
    }

    let mounted = true;
    // Never leave the app behind an indefinite auth splash if browser storage
    // or an OEM credential provider stalls. A late session result still wins.
    const startupFallback = setTimeout(
      () => mounted && setStatus('signedOut'),
      Platform.OS === 'web' ? 2500 : 8000,
    );
    Promise.all([supabase.auth.getSession(), AsyncStorage.getItem(DEMO_MODE_KEY)])
      .then(([result, demoMode]) => {
        if (!mounted) return;
        clearTimeout(startupFallback);
        const nextSession = result.data.session;
        setSession(nextSession);
        setStatus(nextSession ? 'signedIn' : demoMode === 'true' ? 'demo' : 'signedOut');
      })
      .catch(() => {
        clearTimeout(startupFallback);
        if (mounted) setStatus('signedOut');
      });

    const authSubscription = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(nextSession);
      if (nextSession) {
        setAuthError(null);
        AsyncStorage.removeItem(DEMO_MODE_KEY).catch(() => undefined);
        setStatus('signedIn');
      } else {
        AsyncStorage.getItem(DEMO_MODE_KEY)
          .then((demoMode) => setStatus(demoMode === 'true' ? 'demo' : 'signedOut'))
          .catch(() => setStatus('signedOut'));
      }
    });

    const acceptUrl = (url: string | null) => {
      if (!url || !isAuthCallbackUrl(url)) return;
      // openAuthSessionAsync owns its Android Custom Tab and installs its own
      // Linking listener. Do not call dismissBrowser here: that API is iOS-only
      // and can be undefined on Android, while Expo closes the tab after its
      // redirect listener resolves. consumeAuthUrl is single-flight, so this
      // cold-start fallback and WebBrowser can safely observe the same URL.
      consumeAuthUrl(url).catch((error: unknown) => {
        if (!oauthAttemptRef.current) {
          const message = readableAuthError(error);
          setAuthError(message);
          console.warn(
            '[auth] Could not restore a session from the OAuth callback:',
            message,
          );
        }
      });
    };
    if (Platform.OS !== 'web')
      Linking.getInitialURL().then(acceptUrl).catch(() => undefined);
    const linkSubscription =
      Platform.OS !== 'web'
        ? Linking.addEventListener('url', ({ url }) => acceptUrl(url))
        : null;

    return () => {
      mounted = false;
      clearTimeout(startupFallback);
      authSubscription.data.subscription.unsubscribe();
      linkSubscription?.remove();
    };
  }, []);

  const requireClient = useCallback(() => {
    if (!supabase) throw new Error('Cloud accounts are not configured for this build.');
    return supabase;
  }, []);
  const reportAuthError = useCallback(
    (error: unknown) => setAuthError(readableAuthError(error)),
    [],
  );

  const value = useMemo<AuthContextValue>(() => ({
    configured: cloudConfigured,
    status,
    session,
    user: session?.user ?? null,
    passwordRecovery,
    authError,
    clearAuthError: () => setAuthError(null),
    reportAuthError,
    signInWithPassword: async (email, password) => {
      const client = requireClient();
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    signUp: async (email, password) => {
      const client = requireClient();
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      return data.session ? 'confirmed' : 'verification-required';
    },
    sendMagicLink: async (email) => {
      const client = requireClient();
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
    },
    signInWithProvider: (provider) => {
      if (oauthAttemptRef.current) return oauthAttemptRef.current;
      setAuthError(null);
      const providerName = provider === 'google' ? 'Google' : 'Apple';
      const rawAttempt = (async () => {
        const client = requireClient();
        const redirectTo = callbackUrl();
        const { data, error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
        });
        if (error) throw error;
        if (Platform.OS === 'web') return;
        if (!data.url)
          throw new Error('The sign-in provider did not return a login URL.');

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          const consumed = await consumeAuthUrl(result.url);
          if (!consumed)
            throw new Error(
              'HabHub received an unexpected sign-in callback. Please try again.',
            );
        } else {
          // Some Android browsers report the Custom Tab as dismissed just
          // before their Linking event reaches JavaScript. Give that event a
          // short opportunity to finish before reporting a cancellation.
          await new Promise((resolve) => setTimeout(resolve, 400));
        }

        const { data: sessionData, error: sessionError } =
          await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session)
          throw new Error(
            result.type === 'success'
              ? `${providerName} sign-in completed, but no HabHub session was created. Please try again.`
              : `${providerName} sign-in was cancelled before HabHub received your account.`,
          );
      })();
      const attempt = rawAttempt.catch((error: unknown) => {
        const message = readableAuthError(error);
        setAuthError(message);
        console.warn(`[auth] ${providerName} sign-in failed:`, message);
        throw new Error(message);
      });
      oauthAttemptRef.current = attempt;
      const release = () => {
        if (oauthAttemptRef.current === attempt) oauthAttemptRef.current = null;
      };
      attempt.then(release, release);
      return attempt;
    },
    requestPasswordReset: async (email) => {
      const client = requireClient();
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl() });
      if (error) throw error;
    },
    updatePassword: async (password) => {
      const client = requireClient();
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      setPasswordRecovery(false);
    },
    updateDisplayName: async (name) => {
      const client = requireClient();
      const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!trimmed || !session?.user)
        throw new Error("Enter a display name before continuing.");
      const { error: authError } = await client.auth.updateUser({
        data: { display_name: trimmed, full_name: trimmed },
      });
      if (authError) throw authError;
      // App state is updated by the caller and published with the next private
      // snapshot revision. Writing profiles directly here could race another
      // device and bypass the causal workspace projection.
    },
    continueInDemo: async () => {
      await AsyncStorage.setItem(DEMO_MODE_KEY, 'true');
      setStatus('demo');
    },
    useCloudAccount: async () => {
      await AsyncStorage.removeItem(DEMO_MODE_KEY);
      if (!session) setStatus('signedOut');
    },
    signOut: async () => {
      const client = requireClient();
      await AsyncStorage.removeItem(DEMO_MODE_KEY);
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setSession(null);
      setStatus('signedOut');
    },
  }), [authError, passwordRecovery, reportAuthError, requireClient, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
