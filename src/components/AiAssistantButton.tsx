import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useGroupAccent } from "@/src/theme";

export function AiAssistantButton() {
  const accent = useGroupAccent();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open MetRal AI"
      onPress={() => router.navigate("/metral-ai" as never)}
      style={[styles.button, { backgroundColor: accent }]}
    >
      <View style={styles.icon}>
        <Ionicons name="sparkles" size={17} color="#FFFFFF" />
      </View>
      <Text style={styles.label}>MetRal AI</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 14,
    bottom: 82,
    minHeight: 42,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF20",
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
});
