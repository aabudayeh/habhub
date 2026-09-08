import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useTranslation } from "@/src/i18n";

type Anchor = { x: number; y: number; width: number; height: number };

export function InfoPopover({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>();
  const [bubbleHeight, setBubbleHeight] = useState(88);
  const trigger = useRef<View>(null);
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const { width, height } = useWindowDimensions();
  const bubbleWidth = Math.min(340, width - 32);
  const maximumHeight = Math.max(120, height - 48);
  const left = anchor
    ? Math.max(
        12,
        Math.min(
          width - bubbleWidth - 12,
          anchor.x + anchor.width / 2 - bubbleWidth / 2,
        ),
      )
    : 12;
  const below = (anchor?.y ?? 0) + (anchor?.height ?? 0) + 8;
  const top =
    anchor && below + bubbleHeight <= height - 12
      ? below
      : Math.max(12, (anchor?.y ?? height / 2) - bubbleHeight - 8);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    trigger.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      setAnchor({
        x,
        y,
        width: measuredWidth,
        height: measuredHeight,
      });
      setOpen(true);
    });
  }

  return (
    <View ref={trigger} collapsable={false} style={styles.root}>
      <Pressable
        accessibilityLabel={t(label)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={2}
        style={styles.trigger}
        onPress={toggle}
      >
        <Ionicons
          name="information-circle-outline"
          size={17}
          color={accent}
        />
      </Pressable>
      <Modal
        visible={open}
        transparent
        statusBarTranslucent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modal}>
          <Pressable
            accessibilityLabel={t("Close information")}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            onLayout={(event) =>
              setBubbleHeight(event.nativeEvent.layout.height)
            }
            style={[
              styles.bubble,
              {
                left,
                top,
                width: bubbleWidth,
                maxHeight: maximumHeight,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.heading}>
              <Text style={[styles.title, { color: colors.ink }]}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("Close information")} onPress={() => setOpen(false)} style={styles.close}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={[styles.copy, { color: colors.muted }]}>{message}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "relative", zIndex: 20 },
  trigger: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  modal: { flex: 1 },
  bubble: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 12,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  title: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { flexGrow: 0, flexShrink: 1 },
  copy: { fontSize: 13, lineHeight: 20, fontWeight: "400" },
});
