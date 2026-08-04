import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Button, Card, Chip, SectionHeader } from "@/src/components/ui";
import {
  hasScreenTimeAccess,
  isScreenTimeSupported,
  requestScreenTimeAccess,
} from "@/src/screenTime";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export function ScreenTimeAccessCard() {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [status, setStatus] = useState<
    "checking" | "granted" | "missing" | "unsupported"
  >("checking");

  const refresh = useCallback(async () => {
    if (!isScreenTimeSupported()) {
      setStatus("unsupported");
      return;
    }
    setStatus((current) => (current === "granted" ? current : "checking"));
    setStatus((await hasScreenTimeAccess()) ? "granted" : "missing");
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  if (Platform.OS !== "android") return null;
  return (
    <>
      <SectionHeader title="Screen time" />
      <Card>
        <View style={styles.heading}>
          <View style={[styles.icon, { backgroundColor: colors.canvas }]}> 
            <Ionicons name="phone-portrait-outline" size={22} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>Device usage</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>Private on this device</Text>
          </View>
          <Chip
            label={
              status === "granted"
                ? "Connected"
                : status === "checking"
                  ? "Checking"
                  : "Off"
            }
            selected={status === "granted"}
          />
        </View>
        <Text style={[styles.text, { color: colors.muted }]}> 
          Android Usage Access provides approximate daily screen time and an
          app-by-app breakdown. HabHub stores the breakdown only on this device.
        </Text>
        {status === "unsupported" ? (
          <Text style={[styles.text, { color: palette.amber }]}> 
            Install the HabHub APK to use screen-time tracking; Expo Go cannot
            load this native feature.
          </Text>
        ) : (
          <Button
            label={status === "granted" ? "Review usage access" : "Enable usage access"}
            icon="settings-outline"
            variant={status === "granted" ? "ghost" : "primary"}
            onPress={() => void requestScreenTimeAccess()}
          />
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 2 },
  text: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
});
