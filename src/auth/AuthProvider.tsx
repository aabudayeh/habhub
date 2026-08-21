import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetInfo } from '@react-native-community/netinfo';
import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { readableAuthError } from '@/src/domain/authErrors';
import { networkReachability } from '@/src/domain/network';
import {
  cachedAuthIdentityPayload,
  parseCachedAuthIdentity,
  parseSupabaseStoredAuthUser,
  supabaseAuthStorageKey,
} from '@/src/domain/offlineAuth';
import { cloudConfigured, consumeAuthUrl, isAuthCallbackUrl, supabase } from '@/src/lib/supabase';
import {
  cancelAllManagedLocalNotifications,
  releasePushRegistrationFence,
  unregisterCurrentDevicePushToken,
  unregisterOrphanedDevicePushToken,
} from '@/src/notifications/push';

const DEMO_MODE_KEY = 'paceboard-explicit-demo-mode-v1';
const CACHED_AUTH_IDENTITY_KEY = 'habhub-cached-auth-identity-v1';
const NATIVE_SESSION_WAIT_MS = 1200;
const SUPABASE_SESSION_STORAGE_KEY = supabaseAuthStorageKey(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
);

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
  const network = useNetInfo();
  const [session, setSession] = useState<Session | null>(null);
  const [offlineUser, setOfflineUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(cloudConfigured ? 'loading' : 'demo');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const oauthAttemptRef = useRef<Promise<void> | null>(null);
  const reconnectSessionRef = useRef<Promise<void> | null>(null);
  const previousUserIdRef = useRef<string | null>(null);
  const networkUnavailableRef = useRef(false);
  const reachability = networkReachability(
    network.isConnected,
    network.isInternetReachable,
  );
  const networkConfirmedAvailable =
    reachability === 'online' ||
    (Platform.OS === 'web' && reachability === 'unknown');
  networkUnavailableRef.current = !networkConfirmedAvailable;

  useEffect(() => {
    if (!supabase) {
      setStatus('demo');
      return;
    }

    let mounted = true;
    let explicitDemoMode = false;
    let cachedBootstrapUser: User | null = null;
    const startedIdentityTransitions = new Set<string>();
    const beginIdentityTransitionCleanup = (
      previousUserId: string | null,
      nextUserId: string | null,
    ) => {
      if (!previousUserId || previousUserId === nextUserId) return;
      const transitionKey = `${previousUserId}:${nextUserId ?? 'signed-out'}`;
      if (startedIdentityTransitions.has(transitionKey)) return;
      startedIdentityTransitions.add(transitionKey);
      {
        // Append the native-token cleanup barrier synchronously, before the B
        // session is published below. Otherwise local alarm cleanup's first
        // await leaves a window where B can register and A then unregisters
        // that brand-new native identity.
        let pushCleanupError: unknown;
        const pushCleanup = unregisterCurrentDevicePushToken(
          previousUserId,
        ).catch((error) => {
          pushCleanupError = error;
        });
        // This also covers an unexpected session loss or an account switch.
        // Native alarm cleanup is serialized ahead of any schedules created
        // for the next account, so private reminders never cross identities.
        void (async () => {
          try {
            await cancelAllManagedLocalNotifications(previousUserId);
            await pushCleanup;
            if (pushCleanupError) throw pushCleanupError;
          } catch {
            // Native unregistration runs even when the prior RLS session is
            // already gone; Edge later removes its DeviceNotRegistered row.
          } finally {
            releasePushRegistrationFence(previousUserId);
          }
        })();
      }
    };
    const rememberSession = (nextSession: Session) => {
      const previousUserId = previousUserIdRef.current;
      beginIdentityTransitionCleanup(previousUserId, nextSession.user.id);
      previousUserIdRef.current = nextSession.user.id;
      cachedBootstrapUser = nextSession.user;
      setOfflineUser(null);
      setSession(nextSession);
      setAuthError(null);
      setStatus('signedIn');
      void Promise.all([
        AsyncStorage.removeItem(DEMO_MODE_KEY),
        AsyncStorage.setItem(
          CACHED_AUTH_IDENTITY_KEY,
          cachedAuthIdentityPayload(nextSession.user),
        ),
      ]).catch(() => undefined);
    };
    const confirmSignedOut = (demoMode: boolean) => {
      const previousUserId = previousUserIdRef.current;
      beginIdentityTransitionCleanup(previousUserId, null);
      previousUserIdRef.current = null;
      cachedBootstrapUser = null;
      setSession(null);
      setOfflineUser(null);
      void AsyncStorage.removeItem(CACHED_AUTH_IDENTITY_KEY).catch(
        () => undefined,
      );
      if (!previousUserId) {
        void cancelAllManagedLocalNotifications().catch(() => undefined);
        void unregisterOrphanedDevicePushToken().catch(() => undefined);
      }
      setStatus(demoMode ? 'demo' : 'signedOut');
    };

    // Restore a non-secret account identity from local storage first. This
    // lets an already-signed-in account render its own cached state in airplane
    // mode while Supabase's token refresh is stalled. The cached user never
    // authorizes network requests; CloudSync stays offline until a real session
    // and network are available.
    const localBootstrap = Promise.all([
      AsyncStorage.getItem(DEMO_MODE_KEY),
      AsyncStorage.getItem(CACHED_AUTH_IDENTITY_KEY),
      SUPABASE_SESSION_STORAGE_KEY
        ? AsyncStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)
        : Promise.resolve(null),
    ]).then(([demoMode, cachedIdentity, storedSupabaseSession]) => {
      explicitDemoMode = demoMode === 'true';
      const restored =
        parseCachedAuthIdentity(cachedIdentity) ??
        parseSupabaseStoredAuthUser(storedSupabaseSession);
      cachedBootstrapUser = restored as User | null;
      if (!mounted) return;
      if (explicitDemoMode) {
        setStatus('demo');
        return;
      }
      if (cachedBootstrapUser) {
        previousUserIdRef.current = cachedBootstrapUser.id;
        setOfflineUser(cachedBootstrapUser);
        setStatus('signedIn');
        if (!cachedIdentity)
          void AsyncStorage.setItem(
            CACHED_AUTH_IDENTITY_KEY,
            cachedAuthIdentityPayload(cachedBootstrapUser),
          ).catch(() => undefined);
      }
    });
    // Bound only the presentation wait. A late local/session result still wins.
    const startupFallback = setTimeout(() => {
      if (!mounted) return;
      if (cachedBootstrapUser && !explicitDemoMode) {
        setOfflineUser(cachedBootstrapUser);
        setStatus('signedIn');
      } else setStatus(explicitDemoMode ? 'demo' : 'signedOut');
    }, Platform.OS === 'web' ? 2500 : NATIVE_SESSION_WAIT_MS);
    const sessionRequest = supabase.auth.getSession();
    void Promise.all([localBootstrap, sessionRequest])
      .then(([, result]) => {
        if (!mounted) return;
        clearTimeout(startupFallback);
        if (result.error) {
          if (!cachedBootstrapUser && !explicitDemoMode)
            setStatus('signedOut');
          return;
        }
        if (result.data.session) rememberSession(result.data.session);
        else if (networkUnavailableRef.current && cachedBootstrapUser) {
          setOfflineUser(cachedBootstrapUser);
          setStatus('signedIn');
        } else confirmSignedOut(explicitDemoMode);
      })
      .catch(() => {
        clearTimeout(startupFallback);
        if (!mounted) return;
        if (cachedBootstrapUser && !explicitDemoMode) {
          setOfflineUser(cachedBootstrapUser);
          setStatus('signedIn');
        } else setStatus(explicitDemoMode ? 'demo' : 'signedOut');
      });

    const authSubscription = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (nextSession) {
        rememberSession(nextSession);
        return;
      }
      void localBootstrap.then(() => {
        if (!mounted) return;
        // A network failure or stalled INITIAL_SESSION is not a sign-out. Keep
        // the local account usable until Supabase confirms an explicit sign-out
        // or an online no-session result.
        if (
          event !== 'SIGNED_OUT' &&
          networkUnavailableRef.current &&
          cachedBootstrapUser &&
          !explicitDemoMode
        ) {
          setSession(null);
          setOfflineUser(cachedBootstrapUser);
          setStatus('signedIn');
          return;
        }
        confirmSignedOut(explicitDemoMode);
      });
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

  useEffect(() => {
    if (
      !supabase ||
      !networkConfirmedAvailable ||
      session ||
      !offlineUser ||
      reconnectSessionRef.current
    )
      return;

    let active = true;
    const cachedUserId = offlineUser.id;
    const queuePriorIdentityCleanup = () => {
      // Append the push identity barrier before publishing another account or
      // signed-out state. This mirrors the auth-event path above and prevents
      // an old account cleanup from unregistering a newly restored token.
      let pushCleanupError: unknown;
      const pushCleanup = unregisterCurrentDevicePushToken(cachedUserId).catch(
        (error) => {
          pushCleanupError = error;
        },
      );
      void (async () => {
        try {
          await cancelAllManagedLocalNotifications(cachedUserId);
          await pushCleanup;
          if (pushCleanupError) throw pushCleanupError;
        } catch {
          // The durable unregister marker is retained for the next authorized
          // reconnect if the previous account can no longer reach its row.
        } finally {
          releasePushRegistrationFence(cachedUserId);
        }
      })();
    };

    let attempt: Promise<void>;
    attempt = (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active || error) return;
      const restored = data.session;
      if (restored) {
        if (restored.user.id !== cachedUserId) queuePriorIdentityCleanup();
        previousUserIdRef.current = restored.user.id;
        setSession(restored);
        setOfflineUser(null);
        setAuthError(null);
        setStatus('signedIn');
        await Promise.all([
          AsyncStorage.removeItem(DEMO_MODE_KEY),
          AsyncStorage.setItem(
            CACHED_AUTH_IDENTITY_KEY,
            cachedAuthIdentityPayload(restored.user),
          ),
        ]).catch(() => undefined);
        return;
      }

      // A confirmed-online, successful no-session read is an authoritative
      // sign-out. A timeout/error above intentionally leaves cached UI intact.
      queuePriorIdentityCleanup();
      previousUserIdRef.current = null;
      setSession(null);
      setOfflineUser(null);
      setStatus('signedOut');
      await AsyncStorage.removeItem(CACHED_AUTH_IDENTITY_KEY).catch(
        () => undefined,
      );
    })();
    reconnectSessionRef.current = attempt;
    void attempt.finally(() => {
      if (reconnectSessionRef.current === attempt)
        reconnectSessionRef.current = null;
    });
    return () => {
      active = false;
    };
  }, [networkConfirmedAvailable, offlineUser, session]);
  const reportAuthError = useCallback(
    (error: unknown) => setAuthError(readableAuthError(error)),
    [],
  );

  const value = useMemo<AuthContextValue>(() => ({
    configured: cloudConfigured,
    status,
    session,
    user: session?.user ?? offlineUser,
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
      setOfflineUser(null);
      setStatus('demo');
    },
    useCloudAccount: async () => {
      await AsyncStorage.removeItem(DEMO_MODE_KEY);
      if (session || offlineUser) setStatus('signedIn');
      else setStatus('signedOut');
    },
    signOut: async () => {
      const client = requireClient();
      await AsyncStorage.multiRemove([
        DEMO_MODE_KEY,
        CACHED_AUTH_IDENTITY_KEY,
      ]);
      const userId = session?.user.id ?? offlineUser?.id;
      setOfflineUser(null);
      try {
        if (userId) {
          await cancelAllManagedLocalNotifications(userId);
          await unregisterCurrentDevicePushToken(userId).catch((error) => {
            console.warn(
              '[auth] Push-token cleanup will continue after sign-out:',
              readableAuthError(error),
            );
          });
        } else {
          await cancelAllManagedLocalNotifications();
        }
        const { error } = await client.auth.signOut();
        if (error) throw error;
        setSession(null);
        setStatus('signedOut');
      } finally {
        if (userId) releasePushRegistrationFence(userId);
      }
    },
  }), [authError, offlineUser, passwordRecovery, reportAuthError, requireClient, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
