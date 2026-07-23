import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";

export type AddTrackerItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  sublabel?: string;
};

export function AddTrackerModal({
  visible,
  items,
  onAdd,
  onClose,
}: {
  visible: boolean;
  items: AddTrackerItem[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.ink }]}>Add an existing tracker</Text>
          {items.length ? items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onAdd(item.id)}
              style={[styles.row, { borderColor: colors.border }]}
            >
              <Ionicons name={item.icon} size={18} color={item.color} />
              <View style={styles.copy}>
                <Text style={[styles.name, { color: colors.ink }]}>{item.label}</Text>
                {item.sublabel ? <Text style={[styles.meta, { color: colors.muted }]}>{item.sublabel}</Text> : null}
              </View>
              <Ionicons name="add-circle-outline" size={19} color={accent} />
            </Pressable>
          )) : (
            <Text style={[styles.empty, { color: colors.muted }]}>Every available tracker is already shown.</Text>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.46)", justifyContent: "flex-end", padding: 16 },
  sheet: { borderRadius: 22, padding: 16, maxHeight: "78%" },
  title: { fontSize: 15, fontWeight: "900", marginBottom: 8 },
  row: { minHeight: 51, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  name: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, marginTop: 2 },
  empty: { fontSize: 10, paddingVertical: 16 },
});
