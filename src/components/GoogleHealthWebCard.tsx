import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import { AppText as Text } from "@/src/components/AppText";
import { Button, Card, Chip } from "@/src/components/ui";
import {
  GOOGLE_HEALTH_ANDROID_HELP_URL,
  GOOGLE_HEALTH_ANDROID_STORE_URL,
  GOOGLE_HEALTH_IOS_HELP_URL,
  GOOGLE_HEALTH_IOS_STORE_URL,
  GoogleHealthSetupPlatform,
  googleHealthDisclosureAcknowledgementKey,
  googleHealthSetupAcknowledgementKey,
  googleHealthSetupPlatform,
} from "@/src/domain/googleHealthSetup";
import { LocalizedAlert as Alert, useLocale, useTranslation } from "@/src/i18n";
import {
  GoogleHealthClientError,
  GoogleHealthConnection,
  GoogleHealthSyncResult,
  googleHealthScopeLabel,
  invokeGoogleHealth,
} from "@/src/health/googleHealthWeb";
import {
  captureGoogleHealthCompletionFromBrowserUrl,
  clearCapturedGoogleHealthCompletion,
} from "@/src/health/googleHealthCompletionBrowser";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { useApp } from "@/src/state/AppProvider";

type Operation = "checking" | "connecting" | "syncing" | "disconnecting" | "deleting";
type CallbackOutcome = "connected" | "error";

const oauthMessageType = "habhub:google-health-oauth";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function detectedPhonePlatform(): GoogleHealthSetupPlatform {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return "desktop";
  return googleHealthSetupPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  );
}

function prefersOAuthPopup() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const touchLayout = window.matchMedia?.("(pointer: coarse)").matches;
  return !standalone && !touchLayout && window.innerWidth >= 720;
}

function safeCallbackReason(reason: string | undefined) {
  return [
    "denied",
    "invalid_state",
    "exchange_failed",
    "provider_error",
    "configuration",
    "access_denied",
    "invalid_completion",
  ].includes(reason ?? "")
    ? reason!
    : "unknown";
}

function reasonCopy(reason: string) {
  if (reason === "denied" || reason === "access_denied")
    return "Google access was declined, or this account is not eligible for the pilot. Contact HabHub support if access is denied.";
  if (reason === "invalid_state") return "That connection attempt expired. Please start again.";
  if (reason === "invalid_completion")
    return "That Google connection could not be confirmed. Please start again.";
  if (reason === "configuration") return "Google Health is not configured on the server yet.";
  if (reason === "exchange_failed" || reason === "provider_error")
    return "Google could not finish the connection. Please try again.";
  return "Google Health could not finish the connection.";
}

function clientErrorCopy(error: unknown) {
  const code = error instanceof GoogleHealthClientError ? error.code : "request_failed";
  if (code === "cloud_not_configured")
    return "Cloud accounts are not configured for this build.";
  if (code === "sign_in_required")
    return "Sign in to HabHub again before connecting Google Health.";
  if (code === "not_configured" || code === "configuration")
    return "Google Health is not configured on the server yet.";
  if (code === "access_denied")
    return "Google access was declined, or this account is not eligible for the pilot. Contact HabHub support if access is denied.";
  if (code === "invalid_completion")
    return "That Google connection could not be confirmed. Please start again.";
  if (code === "rate_limited")
    return "Google Health is busy. Please wait and try again.";
  if (code === "network_error")
    return "Could not reach Google Health. Check your connection and try again.";
  if (code === "connection_required")
    return "Connect Google Health before syncing.";
  if (code === "invalid_response" || code === "invalid_authorization_url")
    return "Google Health returned an unexpected response.";
  return "Google Health could not complete that request.";
}

function statusLabel(connection: GoogleHealthConnection | null, operation: Operation | null) {
  if (operation === "checking") return "Checking…";
  if (operation === "connecting") return "Waiting for Google…";
  if (operation === "syncing") return "Syncing…";
  if (operation === "disconnecting") return "Disconnecting…";
  if (operation === "deleting") return "Deleting…";
  if (connection?.state === "connected") return "Connected";
  if (connection?.state === "pending") return "Finish in Google";
  if (connection?.state === "error") return "Needs attention";
  return "Not connected";
}

async function openOfficialLink(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  }
  await Linking.openURL(url);
}

function StoreLink({
  kind,
  onOpen,
}: {
  kind: "android" | "ios";
  onOpen: () => void;
}) {
  const accent = useGroupAccent();
  const colors = useAppColors();
  const label = kind === "ios" ? "Open in the App Store" : "Open in Google Play";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint="Opens the official Google Health store page"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.storeLink,
        { borderColor: colors.border, backgroundColor: colors.canvas },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={kind === "ios" ? "logo-apple" : "logo-google-playstore"}
        size={17}
        color={accent}
      />
      <Text style={[styles.storeLinkText, { color: colors.ink }]}>{label}</Text>
      <Ionicons name="open-outline" size={15} color={colors.muted} />
    </Pressable>
  );
}

export function GoogleHealthWebCard() {
  const auth = useAuth();
  const cloud = useCloudSync();
  const { purgeGoogleHealthData } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const t = useTranslation();
  const params = useLocalSearchParams<{
    google_health?: string | string[];
    reason?: string | string[];
  }>();
  const [connection, setConnection] = useState<GoogleHealthConnection | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<GoogleHealthSyncResult | null>(null);
  const [phoneReady, setPhoneReady] = useState(false);
  const [phoneReadyLoaded, setPhoneReadyLoaded] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [disclosureLoaded, setDisclosureLoaded] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbackHandledRef = useRef<string | null>(null);
  const pendingCompletionRef = useRef<ReturnType<
    typeof captureGoogleHealthCompletionFromBrowserUrl
  > | null>(null);
  const requestGenerationRef = useRef(0);
  const platform = useMemo(detectedPhonePlatform, []);
  const accountId = auth.user?.id ?? null;
  const hasLiveSession = Boolean(auth.session && accountId);

  const stopPopupPoll = useCallback(() => {
    if (popupPollRef.current) clearInterval(popupPollRef.current);
    popupPollRef.current = null;
  }, []);

  const refreshStatus = useCallback(async (quiet = false): Promise<GoogleHealthConnection | null> => {
    const requestGeneration = ++requestGenerationRef.current;
    if (!hasLiveSession || !accountId) {
      setConnection(null);
      setOperation(null);
      return null;
    }
    if (!quiet) setOperation("checking");
    try {
      const response = await invokeGoogleHealth("status");
      if (requestGenerationRef.current !== requestGeneration) return null;
      setConnection(response.connection);
      if (response.connection.state === "error" && response.connection.lastError) {
        setNotice(
          clientErrorCopy(new GoogleHealthClientError(response.connection.lastError)),
        );
      } else if (!quiet) setNotice(null);
      return response.connection;
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return null;
      setNotice(clientErrorCopy(error));
      return null;
    } finally {
      if (requestGenerationRef.current === requestGeneration)
        setOperation((current) => (current === "checking" ? null : current));
    }
  }, [accountId, hasLiveSession]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    stopPopupPoll();
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    popupRef.current = null;
    callbackHandledRef.current = null;
    setConnection(null);
    setNotice(null);
    setSyncResult(null);
    setOperation(null);
    setDisclosureAccepted(false);
    setDisclosureLoaded(false);
  }, [accountId, stopPopupPoll]);

  useEffect(() => {
    if (Platform.OS !== "web" || !accountId || typeof window === "undefined") {
      setPhoneReady(false);
      setPhoneReadyLoaded(true);
      setDisclosureAccepted(false);
      setDisclosureLoaded(true);
      return;
    }
    try {
      setPhoneReady(
        window.localStorage.getItem(
          googleHealthSetupAcknowledgementKey(accountId),
        ) === "true",
      );
      setDisclosureAccepted(
        window.localStorage.getItem(
          googleHealthDisclosureAcknowledgementKey(accountId),
        ) === "true",
      );
    } catch {
      setPhoneReady(false);
      setDisclosureAccepted(false);
    }
    setPhoneReadyLoaded(true);
    setDisclosureLoaded(true);
  }, [accountId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!popupRef.current || event.source !== popupRef.current) return;
      const payload = event.data as
        | { type?: string; outcome?: CallbackOutcome; reason?: string }
        | null;
      if (payload?.type !== oauthMessageType) return;
      stopPopupPoll();
      popupRef.current = null;
      setOperation(null);
      const failureNotice = reasonCopy(safeCallbackReason(payload.reason));
      void refreshStatus(true).then((confirmed) => {
        if (payload.outcome !== "connected") {
          setNotice(failureNotice);
          return;
        }
        if (confirmed?.state === "connected")
          setNotice("Google Health connected. Use Sync now to import available data.");
        else if (confirmed)
          setNotice("Google Health connection was not confirmed. Please start again.");
      });
      window.focus();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refreshStatus, stopPopupPoll]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    // RootLayout already removed this bearer credential before auth/route
    // guards. This fallback also covers isolated card rendering in tests.
    const completion =
      pendingCompletionRef.current ??
      captureGoogleHealthCompletionFromBrowserUrl();
    pendingCompletionRef.current = completion;
    if (!completion.present) return;
    if (!hasLiveSession || !accountId) return;
    pendingCompletionRef.current = { present: false, token: null };
    clearCapturedGoogleHealthCompletion();

    const requestGeneration = ++requestGenerationRef.current;
    setNotice(null);
    setSyncResult(null);
    setOperation("connecting");

    void invokeGoogleHealth("complete", {
      completionToken: completion.token ?? undefined,
    })
      .then((response) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        setConnection(response.connection);
        setOperation(null);
        if (response.connection.state !== "connected")
          throw new GoogleHealthClientError("invalid_completion");

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: oauthMessageType, outcome: "connected" },
            window.location.origin,
          );
          window.setTimeout(() => window.close(), 120);
          return;
        }
        setNotice("Google Health connected. Use Sync now to import available data.");
      })
      .catch((error) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        setOperation(null);
        const reason =
          error instanceof GoogleHealthClientError &&
          error.code === "invalid_completion"
            ? "invalid_completion"
            : "unknown";
        setNotice(clientErrorCopy(error));
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: oauthMessageType, outcome: "error", reason },
            window.location.origin,
          );
          window.setTimeout(() => window.close(), 120);
        }
      });
  }, [accountId, hasLiveSession]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const outcome = firstParam(params.google_health);
    if (outcome !== "connected" && outcome !== "error") return;
    const reason = safeCallbackReason(firstParam(params.reason));
    const callbackKey = `${outcome}:${reason}`;
    if (callbackHandledRef.current === callbackKey) return;
    callbackHandledRef.current = callbackKey;

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: oauthMessageType, outcome, reason },
        window.location.origin,
      );
      window.setTimeout(() => window.close(), 120);
    }

    setOperation(null);
    const failureNotice = reasonCopy(reason);
    void refreshStatus(true).then((confirmed) => {
      if (outcome !== "connected") {
        setNotice(failureNotice);
        return;
      }
      if (confirmed?.state === "connected")
        setNotice("Google Health connected. Use Sync now to import available data.");
      else if (confirmed)
        setNotice("Google Health connection was not confirmed. Please start again.");
    });
    router.replace("/settings" as never);
  }, [params.google_health, params.reason, refreshStatus]);

  useEffect(
    () => () => {
      stopPopupPoll();
    },
    [stopPopupPoll],
  );

  const updatePhoneReady = useCallback((ready: boolean) => {
    setPhoneReady(ready);
    if (!accountId || Platform.OS !== "web" || typeof window === "undefined") return;
    try {
      if (ready)
        window.localStorage.setItem(
          googleHealthSetupAcknowledgementKey(accountId),
          "true",
        );
      else
        window.localStorage.removeItem(
          googleHealthSetupAcknowledgementKey(accountId),
        );
    } catch {
      // Private browsing can deny localStorage; the in-memory choice still works.
    }
  }, [accountId]);

  const updateDisclosureAccepted = useCallback((accepted: boolean) => {
    setDisclosureAccepted(accepted);
    if (!accountId || Platform.OS !== "web" || typeof window === "undefined") return;
    try {
      if (accepted)
        window.localStorage.setItem(
          googleHealthDisclosureAcknowledgementKey(accountId),
          "true",
        );
      else
        window.localStorage.removeItem(
          googleHealthDisclosureAcknowledgementKey(accountId),
        );
    } catch {
      // The current view still honors the choice if storage is unavailable.
    }
  }, [accountId]);

  const connect = useCallback(async () => {
    if (
      !hasLiveSession ||
      !phoneReady ||
      !disclosureAccepted ||
      typeof window === "undefined"
    ) return;
    const requestGeneration = ++requestGenerationRef.current;
    setNotice(null);
    setSyncResult(null);
    setOperation("connecting");

    let popup: Window | null = null;
    if (prefersOAuthPopup()) {
      popup = window.open(
        "",
        "habhub-google-health-oauth",
        "popup=yes,width=540,height=720,resizable=yes,scrollbars=yes",
      );
      popupRef.current = popup;
    }

    try {
      const response = await invokeGoogleHealth("connect", {
        redirectUri: new URL("/settings", window.location.origin).toString(),
      });
      if (requestGenerationRef.current !== requestGeneration) {
        if (popup && !popup.closed) popup.close();
        return;
      }
      setConnection(response.connection);
      const authorizationUrl = response.authorizationUrl!;
      if (popup && !popup.closed) {
        popup.location.replace(authorizationUrl);
        stopPopupPoll();
        popupPollRef.current = setInterval(() => {
          if (popup?.closed) {
            stopPopupPoll();
            popupRef.current = null;
            setOperation(null);
            setNotice("The Google connection window was closed. Start again when you are ready.");
            void refreshStatus(true);
          }
        }, 750);
      } else if (popup) {
        setOperation(null);
        setNotice("The Google connection window was closed. Start again when you are ready.");
      } else {
        window.location.assign(authorizationUrl);
      }
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return;
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
      setOperation(null);
      setNotice(clientErrorCopy(error));
    }
  }, [disclosureAccepted, hasLiveSession, phoneReady, refreshStatus, stopPopupPoll]);

  const syncNow = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setNotice(null);
    setSyncResult(null);
    setOperation("syncing");
    try {
      const response = await invokeGoogleHealth("sync");
      if (requestGenerationRef.current !== requestGeneration) return;
      setConnection(response.connection);
      const result = response.sync ?? {
        imported: 0,
        deleted: 0,
        dataTypes: [],
        errors: [],
      };
      const partial = result.errors.length > 0;
      setSyncResult(result);
      try {
        await cloud.pullLatest();
        if (requestGenerationRef.current !== requestGeneration) return;
        setNotice(
          partial
            ? "Google Health synced the available categories, but one or more categories could not refresh. Try Sync now again."
            : "Google Health sync finished.",
        );
      } catch {
        if (requestGenerationRef.current !== requestGeneration) return;
        setNotice(
          partial
            ? "Some Google Health categories could not refresh. Successful data reached HabHub cloud, but this screen is still waiting for it. HabHub will retry the account refresh automatically; try Sync now again later."
            : "Google Health data reached HabHub cloud, but this screen could not refresh it yet. HabHub will retry the account refresh automatically.",
        );
      }
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return;
      setNotice(clientErrorCopy(error));
    } finally {
      if (requestGenerationRef.current === requestGeneration) setOperation(null);
    }
  }, [cloud]);

  const disconnect = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setNotice(null);
    setOperation("disconnecting");
    try {
      const response = await invokeGoogleHealth("disconnect");
      if (requestGenerationRef.current !== requestGeneration) return;
      setConnection(response.connection);
      setSyncResult(null);
      setNotice("Google Health disconnected. Previously imported entries remain in HabHub.");
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return;
      setNotice(clientErrorCopy(error));
    } finally {
      if (requestGenerationRef.current === requestGeneration) setOperation(null);
    }
  }, []);

  const deleteGoogleData = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setNotice(null);
    setOperation("deleting");
    try {
      const response = await invokeGoogleHealth("delete");
      if (requestGenerationRef.current !== requestGeneration) return;
      setConnection(response.connection);
      setSyncResult(null);
      await purgeGoogleHealthData();
      if (requestGenerationRef.current !== requestGeneration) return;
      setNotice("Google Health was disconnected and its imported HabHub entries were deleted.");
      await cloud.pullLatest().catch(() => undefined);
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return;
      setNotice(clientErrorCopy(error));
    } finally {
      if (requestGenerationRef.current === requestGeneration) setOperation(null);
    }
  }, [cloud, purgeGoogleHealthData]);

  const connected = connection?.state === "connected";
  const busy = operation !== null;
  const status = statusLabel(connection, operation);
  const healthScopes = (connection?.scopes
    .map(googleHealthScopeLabel)
    .filter(Boolean) ?? []) as string[];
  const lastSync = connection?.lastSyncedAt
    ? new Date(connection.lastSyncedAt).toLocaleString(locale)
    : null;

  return (
    <Card>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.canvas }]}>
          <Ionicons name="heart-outline" size={23} color={accent} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>Google Health for web</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>Phone health, synced to your HabHub account</Text>
        </View>
        <Chip label={status} selected={connected} />
      </View>

      <Text style={[styles.intro, { color: colors.muted }]}>
        The HabHub web app cannot read Apple Health or Health Connect directly. The Google Health phone app securely bridges that data to your Google account, then HabHub imports only the read-only categories you approve.
      </Text>

      <View
        style={[
          styles.step,
          { borderColor: phoneReady ? `${accent}66` : colors.border },
        ]}
      >
        <View style={styles.stepHeader}>
          <View
            style={[
              styles.stepBadge,
              { backgroundColor: phoneReady ? accent : colors.canvas },
            ]}
          >
            {phoneReady ? (
              <Ionicons name="checkmark" size={16} color={palette.white} />
            ) : (
              <Text translate={false} style={[styles.stepNumber, { color: accent }]}>1</Text>
            )}
          </View>
          <View style={styles.copy}>
            <Text style={[styles.stepTitle, { color: colors.ink }]}>Install or open Google Health</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>Complete the phone connection before authorizing HabHub.</Text>
          </View>
        </View>

        <View style={styles.storeLinks}>
          {platform !== "android" ? (
            <StoreLink
              kind="ios"
              onOpen={() => void openOfficialLink(GOOGLE_HEALTH_IOS_STORE_URL)}
            />
          ) : null}
          {platform !== "ios" ? (
            <StoreLink
              kind="android"
              onOpen={() => void openOfficialLink(GOOGLE_HEALTH_ANDROID_STORE_URL)}
            />
          ) : null}
        </View>

        <Text style={[styles.setupCopy, { color: colors.muted }]}>
          {platform === "ios"
            ? "In Google Health, open Connections, then Apps and services, then Apple Health. Grant the categories you want to sync."
            : platform === "android"
              ? "In Google Health, open Connections, then Partner apps, then Manage Health Connect. Allow the categories you want. In Samsung Health, also enable its health and wellness data processing consent and Health Connect sharing."
              : "Complete this on the phone that records your health data. On iPhone, connect Apple Health. On Android, connect Health Connect; Samsung Health shares through Health Connect."}
        </Text>
        <Text style={[styles.requirementsCopy, { color: colors.faint }]}>Google Health requires Android 11 or newer, or iOS and iPadOS 16.4 or newer.</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={
            platform === "ios"
              ? "Open official Apple Health setup help"
              : platform === "android"
                ? "Open official Health Connect setup help"
                : "Open official Google Health setup help"
          }
          onPress={() =>
            void openOfficialLink(
              platform === "ios"
                ? GOOGLE_HEALTH_IOS_HELP_URL
                : GOOGLE_HEALTH_ANDROID_HELP_URL,
            )
          }
          style={styles.helpLink}
        >
          <Text style={[styles.linkText, { color: accent }]}>Official setup help</Text>
          <Ionicons name="open-outline" size={14} color={accent} />
        </Pressable>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="I opened Google Health and shared my phone health data"
          accessibilityHint="Marks phone setup complete and unlocks the Google account connection step"
          accessibilityState={{ checked: phoneReady }}
          disabled={!phoneReadyLoaded || !accountId}
          onPress={() => updatePhoneReady(!phoneReady)}
          style={({ pressed }) => [
            styles.acknowledgement,
            { backgroundColor: colors.canvas, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={phoneReady ? "checkbox" : "square-outline"}
            size={21}
            color={phoneReady ? accent : colors.muted}
          />
          <Text style={[styles.acknowledgementText, { color: colors.ink }]}>I opened Google Health and shared my phone health data</Text>
        </Pressable>
        <Text style={[styles.detectionNote, { color: colors.faint }]}>HabHub cannot detect app installation from a browser. This check only remembers your confirmation on this device.</Text>
      </View>

      <View
        style={[
          styles.step,
          { borderColor: connected ? `${accent}66` : colors.border },
        ]}
      >
        <View style={styles.stepHeader}>
          <View
            style={[
              styles.stepBadge,
              { backgroundColor: connected ? accent : colors.canvas },
            ]}
          >
            {connected ? (
              <Ionicons name="checkmark" size={16} color={palette.white} />
            ) : (
              <Text translate={false} style={[styles.stepNumber, { color: accent }]}>2</Text>
            )}
          </View>
          <View style={styles.copy}>
            <Text style={[styles.stepTitle, { color: colors.ink }]}>Connect your Google account</Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.meta, { color: colors.muted }]}
            >
              {status}
              {connection?.email ? (
                <Text translate={false}> · {connection.email}</Text>
              ) : null}
            </Text>
          </View>
        </View>

        <Text style={[styles.accountHint, { color: colors.muted }]}>Use the same Google Account as in the Google Health phone app. Eligibility can vary for supervised or managed accounts.</Text>
        <View
          accessibilityRole="summary"
          style={[
            styles.disclosure,
            { borderColor: colors.border, backgroundColor: colors.canvas },
          ]}
        >
          <View style={styles.disclosureTitleRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={accent} />
            <Text style={[styles.stepTitle, { color: colors.ink }]}>Before you connect</Text>
          </View>
          <Text style={[styles.disclosureCopy, { color: colors.muted }]}>HabHub collects the activity and fitness, health measurement, nutrition, and sleep data you approve. It uses this data to populate your trackers, dashboards, and goals and to sync them across your devices.</Text>
          <Text style={[styles.disclosureCopy, { color: colors.muted }]}>{"Google Health imports follow each tracker's current configured visibility. Group, status, or leaderboard sharing follows that setting. You can change it in the tracker's settings."}</Text>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="I understand what HabHub imports and how visibility works"
          accessibilityHint="Accepts the Google Health data-use disclosure and unlocks account authorization"
          accessibilityState={{ checked: disclosureAccepted }}
          disabled={!disclosureLoaded || !accountId}
          onPress={() => updateDisclosureAccepted(!disclosureAccepted)}
          style={({ pressed }) => [
            styles.acknowledgement,
            styles.disclosureAcknowledgement,
            { backgroundColor: colors.canvas, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={disclosureAccepted ? "checkbox" : "square-outline"}
            size={21}
            color={disclosureAccepted ? accent : colors.muted}
          />
          <Text style={[styles.acknowledgementText, { color: colors.ink }]}>I understand what HabHub imports and how visibility works</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("Read Privacy & Health Data Policy")}
          onPress={() => router.push("/privacy" as never)}
          style={styles.policyLink}
        >
          <Text style={[styles.linkText, { color: accent }]}>{t("Read Privacy & Health Data Policy")}</Text>
          <Ionicons name="chevron-forward" size={14} color={accent} />
        </Pressable>
        <View style={[styles.pilotNotice, { backgroundColor: colors.canvas }]}>
          <Ionicons name="flask-outline" size={16} color={accent} />
          <Text style={[styles.noticeText, { color: colors.muted }]}>Pilot limited to 100 Google accounts. Google may block managed Workspace or Advanced Protection accounts, or show an unverified-app warning; contact support if access is denied.</Text>
        </View>
        <Text style={[styles.historyNote, { color: colors.faint }]}>First sync imports up to 90 days; heart-rate averages up to 14 days. Available phone-source history may be shorter. If data looks old, sync Google Health on your phone first, then use Sync now in HabHub.</Text>

        {!hasLiveSession ? (
          <View style={[styles.notice, { backgroundColor: colors.canvas }]}>
            <Ionicons name="cloud-offline-outline" size={17} color={accent} />
            <Text style={[styles.noticeText, { color: colors.muted }]}>A live HabHub cloud session is required. Sign in while online, then return here.</Text>
          </View>
        ) : null}

        {connected ? (
          <>
            <View style={styles.connectionDetails}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Last Google Health sync</Text>
                <Text translate={false} style={[styles.detailValue, { color: colors.ink }]}>{lastSync ?? t("Not synced yet")}</Text>
              </View>
              <Text style={[styles.detailLabel, { color: colors.muted }]}>Read-only access</Text>
              <View style={styles.scopeChips}>
                {(healthScopes.length
                  ? healthScopes
                  : ["No health categories granted"]
                ).map((scope) => (
                  <Chip key={scope} label={scope} size="small" selected={healthScopes.length > 0} />
                ))}
              </View>
            </View>
            <View style={styles.buttons}>
              <View style={styles.grow}>
                <Button
                  label="Sync now"
                  icon="refresh-outline"
                  loading={operation === "syncing"}
                  disabled={busy}
                  onPress={() => void syncNow()}
                />
              </View>
            </View>
            <Text style={[styles.backgroundCopy, { color: colors.muted }]}>When pilot webhooks are configured, they keep the connection updated in the background. Sync now checks immediately.</Text>
            <View style={styles.connectionLinks}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnect Google Health"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Disconnect Google Health?",
                    "This stops future Google Health sync. Already imported entries stay in HabHub.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Disconnect", onPress: () => void disconnect() },
                    ],
                  )
                }
              >
                <Text style={[styles.linkText, { color: accent }]}>Disconnect</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete imported Google Health data"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Delete Google Health data?",
                    "This revokes access and permanently removes entries imported through Google Health from HabHub. Manual entries and data imported by the HabHub phone app stay.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => void deleteGoogleData(),
                      },
                    ],
                  )
                }
              >
                <Text style={[styles.linkText, { color: palette.red }]}>Delete imported data</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.buttons}>
            <View style={styles.grow}>
              <Button
                label={
                  connection?.state === "pending"
                    ? "Continue Google connection"
                    : connection?.state === "error"
                      ? "Reconnect Google Health"
                      : "Connect Google account"
                }
                icon="logo-google"
                loading={operation === "connecting"}
                disabled={
                  busy ||
                  !phoneReady ||
                  !disclosureAccepted ||
                  !hasLiveSession
                }
                onPress={() => void connect()}
              />
            </View>
            {connection?.state === "pending" ? (
              <View style={styles.grow}>
                <Button
                  label="Refresh status"
                  variant="ghost"
                  icon="refresh-outline"
                  disabled={busy}
                  onPress={() => void refreshStatus()}
                />
              </View>
            ) : null}
          </View>
        )}

        {(!phoneReady || !disclosureAccepted) && hasLiveSession ? (
          <Text style={[styles.nextHint, { color: colors.muted }]}>
            {!phoneReady
              ? "Finish Step 1 to unlock Google account authorization."
              : "Accept the data-use disclosure to unlock Google account authorization."}
          </Text>
        ) : null}
      </View>

      {notice ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            {
              backgroundColor:
                connection?.state === "error" ? "#FCECEB" : colors.canvas,
            },
          ]}
        >
          <Ionicons
            name={connection?.state === "error" ? "warning-outline" : "information-circle-outline"}
            size={17}
            color={connection?.state === "error" ? palette.red : accent}
          />
          <Text style={[styles.noticeText, { color: colors.muted }]}>{t(notice)}</Text>
        </View>
      ) : null}

      {syncResult ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.syncSummary, { borderColor: colors.border }]}
        >
          <View style={styles.summaryItem}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Updated items</Text>
            <Text translate={false} style={[styles.summaryValue, { color: colors.ink }]}>{syncResult.imported}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Removed items</Text>
            <Text translate={false} style={[styles.summaryValue, { color: colors.ink }]}>{syncResult.deleted}</Text>
          </View>
        </View>
      ) : null}

      {!hasLiveSession && auth.configured ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to connect Google Health"
          onPress={() =>
            void auth
              .useCloudAccount()
              .then(() => router.replace("/sign-in" as never))
          }
          style={styles.signInLink}
        >
          <Text style={[styles.linkText, { color: accent }]}>Sign in to connect Google Health</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 11 },
  copy: { flex: 1 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontWeight: "900" },
  meta: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  intro: { fontSize: 11, lineHeight: 17, marginTop: 12 },
  step: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 12 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBadge: {
    width: 31,
    height: 31,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumber: { fontSize: 13, fontWeight: "900" },
  stepTitle: { fontSize: 12, fontWeight: "900" },
  storeLinks: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 },
  storeLink: {
    minHeight: 42,
    flexGrow: 1,
    flexBasis: 160,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  storeLinkText: { flex: 1, fontSize: 10, fontWeight: "900" },
  setupCopy: { fontSize: 10, lineHeight: 16, marginTop: 10 },
  requirementsCopy: { fontSize: 8, lineHeight: 13, marginTop: 6 },
  accountHint: { fontSize: 10, lineHeight: 16, marginTop: 10 },
  disclosure: { borderWidth: 1, borderRadius: 13, padding: 10, marginTop: 10 },
  disclosureTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  disclosureCopy: { fontSize: 9, lineHeight: 15, marginTop: 7 },
  disclosureAcknowledgement: { marginTop: 8 },
  policyLink: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 3, minHeight: 44, paddingVertical: 7 },
  helpLink: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 9 },
  linkText: { fontSize: 10, fontWeight: "900" },
  acknowledgement: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  acknowledgementText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  detectionNote: { fontSize: 8, lineHeight: 13, marginTop: 6 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, padding: 10, marginTop: 10 },
  pilotNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, padding: 9, marginTop: 9 },
  historyNote: { fontSize: 8, lineHeight: 13, marginTop: 7 },
  noticeText: { flex: 1, fontSize: 9, lineHeight: 14 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  grow: { flexGrow: 1, flexBasis: 150 },
  connectionDetails: { gap: 8, marginTop: 11 },
  detailRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  detailLabel: { fontSize: 9, lineHeight: 14, fontWeight: "800" },
  detailValue: { fontSize: 9, lineHeight: 14, fontWeight: "900" },
  scopeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  backgroundCopy: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  connectionLinks: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 12 },
  nextHint: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  syncSummary: { borderTopWidth: 1, flexDirection: "row", gap: 20, marginTop: 12, paddingTop: 10 },
  summaryItem: { flex: 1 },
  summaryValue: { fontSize: 15, lineHeight: 20, fontWeight: "900", marginTop: 2 },
  signInLink: { alignSelf: "center", padding: 10, marginTop: 3 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.99 }] },
});
