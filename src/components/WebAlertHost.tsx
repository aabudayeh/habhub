import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  subscribeToWebAlerts,
  WebAlertRequest,
} from "@/src/components/webAlertStore";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { readableTextColor } from "@/src/domain/colors";

/** Renders multi-action alerts as real in-page dialogs on Expo web. */
export function WebAlertHost() {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [queue, setQueue] = useState<WebAlertRequest[]>([]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    return subscribeToWebAlerts((request) =>
      setQueue((current) => [...current, request]),
    );
  }, []);

  const active = queue[0];
  const buttons = useMemo(
    () =>
      active?.buttons?.length
        ? active.buttons
        : [{ text: t("OK") }],
    [active, t],
  );
  const close = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);
  const dismiss = useCallback(() => {
    if (!active?.options?.cancelable) return;
    active.options.onDismiss?.();
    close();
  }, [active, close]);

  if (Platform.OS !== "web" || !active) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Close dialog")}
          onPress={dismiss}
          style={styles.backdrop}
        />
        <View
          accessibilityRole="alert"
          style={[
            styles.dialog,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.ink }]}>
              {active.title}
            </Text>
            {active.options?.cancelable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Close")}
                onPress={dismiss}
                hitSlop={10}
              >
                <Ionicons name="close" size={21} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          {active.message ? (
            <Text style={[styles.message, { color: colors.muted }]}>
              {active.message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {buttons.map((button, index) => {
              const destructive = button.style === "destructive";
              const cancel = button.style === "cancel";
              const buttonBackground = destructive
                ? "#C93F49"
                : cancel
                  ? colors.canvas
                  : accent;
              return (
                <Pressable
                  key={`${button.text ?? "OK"}-${index}`}
                  accessibilityRole="button"
                  onPress={() => {
                    close();
                    button.onPress?.();
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    {
                      backgroundColor: buttonBackground,
                      borderColor: cancel ? colors.border : buttonBackground,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      {
                        color: destructive
                          ? readableTextColor(buttonBackground)
                          : cancel
                            ? colors.ink
                            : readableTextColor(buttonBackground),
                      },
                    ]}
                  >
                    {button.text ?? "OK"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 8, 23, 0.68)",
  },
  dialog: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { flex: 1, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  message: { fontSize: 15, lineHeight: 22 },
  actions: {
    marginTop: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 9,
  },
  button: {
    minWidth: 96,
    minHeight: 42,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 14, fontWeight: "800" },
});
