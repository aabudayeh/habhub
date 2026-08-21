import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/AuthProvider";
import { AppText as Text } from "@/src/components/AppText";
import { clearPendingInvite, pendingInvite } from "@/src/domain/invites";
import { consumeAuthUrl } from "@/src/lib/supabase";
import { palette } from "@/src/theme";

export default function AuthCallbackScreen() {
  const { status, reportAuthError } = useAuth();
  const [destination, setDestination] = useState<string | null>(null);
  const [processed, setProcessed] = useState(false);

  useEffect(() => {
    let active = true;
    // React Native exposes a `window` global, but it has no browser location.
    // Native callbacks are consumed by AuthProvider's Linking listener.
    if (Platform.OS !== "web") {
      setProcessed(true);
      return () => {
        active = false;
      };
    }
    void consumeAuthUrl(window.location.href)
      .catch((error: unknown) => reportAuthError(error))
      .finally(() => {
        if (active) setProcessed(true);
      });
    return () => {
      active = false;
    };
  }, [reportAuthError]);

  useEffect(() => {
    if (status !== "signedIn") return;
    pendingInvite()
      .then(async (code) => {
        if (code) {
          setDestination(`/join?code=${encodeURIComponent(code)}`);
          return;
        }
        await clearPendingInvite();
        setDestination("/");
      })
      .catch(() => setDestination("/"));
  }, [status]);

  if (status === "signedIn" && destination)
    return <Redirect href={destination as never} />;
  if (status === "demo" && processed)
    return <Redirect href={"/" as never} />;
  if (status === "signedOut" && processed)
    return <Redirect href={"/sign-in" as never} />;
  return (
    <View style={styles.root}>
      <ActivityIndicator color={palette.primary} />
      <Text style={styles.text}>Securing your session…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
    gap: 11,
  },
  text: { fontSize: 11, fontWeight: "800", color: palette.muted },
});
