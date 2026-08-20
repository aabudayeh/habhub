import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/src/lib/supabase";
import type { AppLanguage, NotificationSettings } from "@/src/types";

const SERVICE_WORKER_PATH = "/habhub-sw.js";
const WEB_PUSH_ACK_PREFIX = "habhub-web-push-registration-v1:";
const WEB_PUSH_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_PUSH_RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;
const vapidPublicKey = process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();

type WebPushAcknowledgement = {
  endpointHash: string;
  signature: string;
  registeredAt: number;
};

type SerializedWebPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

const recoveryAttemptAt = new Map<string, number>();
const registrationBySignature = new Map<string, Promise<void>>();

function webPushAckKey(userId: string) {
  return `${WEB_PUSH_ACK_PREFIX}${userId}`;
}

function webPushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function requireWebPushSupport() {
  if (!vapidPublicKey)
    throw new Error(
      "Web notifications are not configured on this HabHub deployment yet.",
    );
  if (typeof window === "undefined" || !window.isSecureContext)
    throw new Error("Web notifications require HabHub to be opened over HTTPS.");
  if (!webPushSupported())
    throw new Error(
      "This browser cannot enable Web Push here. On iPhone or iPad, add HabHub to the Home Screen, then open that installed app and try again.",
    );
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const decoded = window.atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function bytesBase64Url(value: ArrayBuffer | null) {
  if (!value) return "";
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesBase64Url(digest);
}

function sameBytes(left: ArrayBuffer | null, right: Uint8Array) {
  if (!left) return false;
  const leftBytes = new Uint8Array(left);
  return (
    leftBytes.length === right.length &&
    leftBytes.every((value, index) => value === right[index])
  );
}

function storedPreferences(
  preferences: NotificationSettings,
  language: AppLanguage,
) {
  return {
    ...preferences,
    language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function serializeSubscription(
  subscription: PushSubscription,
): SerializedWebPushSubscription {
  const p256dh = bytesBase64Url(subscription.getKey("p256dh"));
  const auth = bytesBase64Url(subscription.getKey("auth"));
  if (!p256dh || !auth)
    throw new Error("The browser returned an incomplete Web Push subscription.");
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
  };
}

async function activeServiceWorkerRegistration() {
  requireWebPushSupport();
  const registration = await navigator.serviceWorker.register(
    SERVICE_WORKER_PATH,
    {
      scope: "/",
      updateViaCache: "none",
    },
  );
  if (registration.active) return registration;
  return navigator.serviceWorker.ready;
}

async function existingServiceWorkerRegistration() {
  if (!webPushSupported()) return undefined;
  return navigator.serviceWorker.getRegistration("/");
}

async function ensureSubscription() {
  const registration = await activeServiceWorkerRegistration();
  const applicationServerKey = base64UrlBytes(vapidPublicKey!);
  if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4)
    throw new Error("HabHub's Web Push public key is invalid.");
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription &&
    !sameBytes(
      subscription.options.applicationServerKey,
      applicationServerKey,
    )
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  return subscription;
}

async function currentSubscription() {
  const registration = await existingServiceWorkerRegistration();
  return registration?.pushManager.getSubscription();
}

async function savedAcknowledgement(userId: string) {
  try {
    const raw = await AsyncStorage.getItem(webPushAckKey(userId));
    return raw ? (JSON.parse(raw) as WebPushAcknowledgement) : undefined;
  } catch {
    return undefined;
  }
}

async function registerSubscription(
  userId: string,
  subscription: PushSubscription,
  preferences: NotificationSettings,
  language: AppLanguage,
  force = false,
) {
  if (!supabase)
    throw new Error("Sign in to enable Web Push notifications.");
  const serialized = serializeSubscription(subscription);
  const preferencePayload = storedPreferences(preferences, language);
  const endpointHash = await sha256Base64Url(serialized.endpoint);
  const signature = await sha256Base64Url(
    JSON.stringify({
      userId,
      subscription: serialized,
      preferences: preferencePayload,
    }),
  );
  const operationKey = `${force ? "force" : "normal"}:${signature}`;
  const existing = registrationBySignature.get(operationKey);
  if (existing) return existing;
  const operation = (async () => {
    if (!force) {
      const prior = await savedAcknowledgement(userId);
      if (
        prior?.endpointHash === endpointHash &&
        prior.signature === signature &&
        Number.isFinite(prior.registeredAt) &&
        Date.now() - prior.registeredAt < WEB_PUSH_REGISTRATION_TTL_MS
      )
        return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== userId)
      throw new Error("The signed-in account changed during Web Push setup.");
    const { error } = await supabase.rpc("register_web_push_subscription", {
      p_endpoint: serialized.endpoint,
      p_p256dh: serialized.keys.p256dh,
      p_auth: serialized.keys.auth,
      p_expiration_time: serialized.expirationTime,
      p_preferences: preferencePayload,
    });
    if (error) throw error;
    await AsyncStorage.setItem(
      webPushAckKey(userId),
      JSON.stringify({
        endpointHash,
        signature,
        registeredAt: Date.now(),
      } satisfies WebPushAcknowledgement),
    );
  })();
  registrationBySignature.set(operationKey, operation);
  operation.finally(() => {
    if (registrationBySignature.get(operationKey) === operation)
      registrationBySignature.delete(operationKey);
  }).catch(() => undefined);
  return operation;
}

/** Registering the worker is permission-free and keeps the user-tap path short. */
export async function registerHabHubServiceWorker() {
  if (!webPushSupported() || !vapidPublicKey) return false;
  await activeServiceWorkerRegistration();
  return true;
}

export async function enableWebPushNotifications(
  userId: string | undefined,
  preferences: NotificationSettings,
  language: AppLanguage,
  identityBarrier: Promise<void> = Promise.resolve(),
  allowAccountRegistration: () => Promise<void> = async () => undefined,
) {
  requireWebPushSupport();
  if (!userId || !supabase)
    throw new Error("Sign in to enable Web Push notifications.");
  if (Notification.permission === "denied")
    throw new Error(
      "Web notifications are blocked. Allow HabHub in this device's notification settings, then retry.",
    );

  // This permission request intentionally happens before any awaited work so
  // iOS receives it inside the user's toggle/press activation.
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted")
    throw new Error("Notification permission was not granted.");

  await identityBarrier.catch(() => undefined);
  await allowAccountRegistration();
  const subscription = await ensureSubscription();
  await registerSubscription(userId, subscription, preferences, language, true);
  return subscription.endpoint;
}

export async function webPushPermissionGranted() {
  if (!webPushSupported() || Notification.permission !== "granted") return false;
  return Boolean(await currentSubscription());
}

export async function webPushSetupComplete(userId?: string) {
  if (!userId || !supabase || !(await webPushPermissionGranted())) return false;
  const subscription = await currentSubscription();
  if (!subscription) return false;
  const acknowledgement = await savedAcknowledgement(userId);
  const endpointHash = await sha256Base64Url(subscription.endpoint);
  const acknowledgementFresh = Boolean(
    acknowledgement?.endpointHash === endpointHash &&
      Number.isFinite(acknowledgement?.registeredAt) &&
      Date.now() - Number(acknowledgement?.registeredAt) <
        WEB_PUSH_REGISTRATION_TTL_MS,
  );
  try {
    const { data, error } = await supabase.rpc(
      "own_web_push_subscription_exists",
      { p_endpoint: subscription.endpoint },
    );
    return error ? acknowledgementFresh : data === true;
  } catch {
    return acknowledgementFresh;
  }
}

export async function updateWebPushPreferences(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage,
  shouldContinue: () => boolean = () => true,
) {
  if (
    !supabase ||
    !vapidPublicKey ||
    !webPushSupported() ||
    Notification.permission !== "granted" ||
    !shouldContinue()
  )
    return;
  const subscription = await ensureSubscription();
  if (!shouldContinue()) return;
  await registerSubscription(userId, subscription, preferences, language);
}

export async function recoverWebPushRegistration(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage,
  shouldContinue: () => boolean = () => true,
) {
  if (
    !supabase ||
    !vapidPublicKey ||
    !webPushSupported() ||
    Notification.permission !== "granted" ||
    !shouldContinue()
  )
    return;
  const previousAttempt = recoveryAttemptAt.get(userId) ?? 0;
  if (Date.now() - previousAttempt < WEB_PUSH_RECOVERY_COOLDOWN_MS) return;
  recoveryAttemptAt.set(userId, Date.now());
  const subscription = await ensureSubscription();
  if (!shouldContinue()) return;
  const { data, error } = await supabase.rpc(
    "own_web_push_subscription_exists",
    { p_endpoint: subscription.endpoint },
  );
  if (!shouldContinue()) return;
  await registerSubscription(
    userId,
    subscription,
    preferences,
    language,
    Boolean(error || data !== true),
  );
}

export async function unregisterCurrentWebPushSubscription(userId?: string) {
  if (!webPushSupported()) return;
  const subscription = await currentSubscription();
  let deletionError: unknown;
  if (subscription && userId && supabase) {
    const { error } = await supabase.rpc("delete_own_web_push_subscription", {
      p_expected_user_id: userId,
      p_endpoint: subscription.endpoint,
    });
    deletionError = error;
  }
  if (subscription) await subscription.unsubscribe().catch(() => undefined);
  if (userId)
    await AsyncStorage.removeItem(webPushAckKey(userId)).catch(() => undefined);
  recoveryAttemptAt.delete(userId ?? "");
  if (deletionError) throw deletionError;
}

export async function unregisterOrphanedWebPushSubscription() {
  if (!webPushSupported()) return;
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe().catch(() => undefined);
}

export async function clearCurrentWebPushIdentity(userId: string) {
  await unregisterOrphanedWebPushSubscription();
  await AsyncStorage.removeItem(webPushAckKey(userId)).catch(() => undefined);
  recoveryAttemptAt.delete(userId);
}

export function subscribeWebPushSubscriptionChanges(callback: () => void) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return () => undefined;
  const listener = (event: MessageEvent) => {
    if (event.data?.type === "habhub:web-push-subscription-changed") callback();
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
