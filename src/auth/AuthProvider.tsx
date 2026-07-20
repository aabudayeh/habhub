import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { cloudConfigured, consumeAuthUrl, supabase } from '@/src/lib/supabase';

const DEMO_MODE_KEY = 'paceboard-explicit-demo-mode-v1';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'demo';

type AuthContextValue = {
  configured: boolean;
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  passwordRecovery: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<'confirmed' | 'verification-required'>;
  sendMagicLink: (email: string) => Promise<void>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  continueInDemo: () => Promise<void>;
  useCloudAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

WebBrowser.maybeCompleteAuthSession();

function callbackUrl() {
  return Platform.OS === 'web' ? Linking.createURL('/auth-callback') : 'paceboard://auth-callback';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(cloudConfigured ? 'loading' : 'demo');
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setStatus('demo');
      return;
    }

    let mounted = true;
    Promise.all([supabase.auth.getSession(), AsyncStorage.getItem(DEMO_MODE_KEY)])
      .then(([result, demoMode]) => {
        if (!mounted) return;
        const nextSession = result.data.session;
        setSession(nextSession);
        setStatus(nextSession ? 'signedIn' : demoMode === 'true' ? 'demo' : 'signedOut');
      })
      .catch(() => mounted && setStatus('signedOut'));

    const authSubscription = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(nextSession);
      if (nextSession) {
        AsyncStorage.removeItem(DEMO_MODE_KEY).catch(() => undefined);
        setStatus('signedIn');
      } else {
        AsyncStorage.getItem(DEMO_MODE_KEY)
          .then((demoMode) => setStatus(demoMode === 'true' ? 'demo' : 'signedOut'))
          .catch(() => setStatus('signedOut'));
      }
    });

    const acceptUrl = (url: string | null) => {
      if (!url) return;
      consumeAuthUrl(url).catch(() => undefined);
    };
    Linking.getInitialURL().then(acceptUrl).catch(() => undefined);
    const linkSubscription = Linking.addEventListener('url', ({ url }) => acceptUrl(url));

    return () => {
      mounted = false;
      authSubscription.data.subscription.unsubscribe();
      linkSubscription.remove();
    };
  }, []);

  const requireClient = useCallback(() => {
    if (!supabase) throw new Error('Cloud accounts are not configured for this build.');
    return supabase;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: cloudConfigured,
    status,
    session,
    user: session?.user ?? null,
    passwordRecovery,
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
    signInWithProvider: async (provider) => {
      const client = requireClient();
      const redirectTo = callbackUrl();
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
      });
      if (error) throw error;
      if (Platform.OS !== 'web' && data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') await consumeAuthUrl(result.url);
      }
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
  }), [passwordRecovery, requireClient, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
