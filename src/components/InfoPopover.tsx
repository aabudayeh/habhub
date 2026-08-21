import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";

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
  const { width, height } = useWindowDimensions();
  const bubbleWidth = Math.min(250, width - 24);
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
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={8}
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
            accessibilityLabel="Close information"
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
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.copy, { color: colors.ink }]}>{message}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "relative", zIndex: 20 },
  modal: { flex: 1 },
  bubble: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 12,
  },
  copy: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
});
