import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";

export function InfoPopover({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityLabel={label}
        hitSlop={8}
        onPress={() => setOpen((current) => !current)}
      >
        <Ionicons
          name="information-circle-outline"
          size={17}
          color={accent}
        />
      </Pressable>
      {open ? (
        <View
          style={[
            styles.bubble,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.copy, { color: colors.ink }]}>{message}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "relative", zIndex: 20 },
  bubble: {
    position: "absolute",
    right: 0,
    top: 22,
    width: 210,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 8,
  },
  copy: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
});
