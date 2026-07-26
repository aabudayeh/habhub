import React from "react";
import { Pressable, StyleProp, StyleSheet, TextStyle, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

function parts(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = Math.max(0, Math.min(23, Number(match?.[1] ?? 0)));
  const minute = Math.max(0, Math.min(59, Number(match?.[2] ?? 0)));
  return { hour, minute };
}

function stored(hour: number, minute: number) {
  return `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:${String(
    Math.max(0, Math.min(59, minute)),
  ).padStart(2, "0")}`;
}

export function TimeInput({
  value,
  onChange,
  style,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<TextStyle>;
  label?: string;
}) {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { hour, minute } = parts(value);
  const format = state.settings.timeFormat ?? "24h";
  if (format === "24h")
    return (
      <View style={styles.wrap}>
        {label ? (
          <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="19:00"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
            style,
          ]}
        />
      </View>
    );

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const setPeriod = (next: "AM" | "PM") =>
    onChange(stored((displayHour % 12) + (next === "PM" ? 12 : 0), minute));
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      ) : null}
      <View style={styles.row}>
        <View
          style={[
            styles.timeParts,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <TextInput
            value={String(displayHour)}
            onChangeText={(raw) => {
              if (!raw) return;
              const next = Math.max(1, Math.min(12, Number(raw) || 1));
              onChange(
                stored((next % 12) + (period === "PM" ? 12 : 0), minute),
              );
            }}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
            style={[styles.partInput, { color: colors.ink }]}
          />
          <Text style={[styles.colon, { color: colors.muted }]}>:</Text>
          <TextInput
            value={String(minute).padStart(2, "0")}
            onChangeText={(raw) => {
              if (!raw) return;
              onChange(stored(hour, Math.max(0, Math.min(59, Number(raw) || 0))));
            }}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
            style={[styles.partInput, { color: colors.ink }]}
          />
        </View>
        {(["AM", "PM"] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setPeriod(item)}
            style={[
              styles.period,
              {
                borderColor: item === period ? accent : colors.border,
                backgroundColor:
                  item === period ? colors.primarySoft : colors.card,
              },
            ]}
          >
            <Text
              style={[
                styles.periodText,
                { color: item === period ? accent : colors.muted },
              ]}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0, gap: 4 },
  label: { fontSize: 8, fontWeight: "900" },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    fontSize: 10,
    fontWeight: "800",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeParts: {
    minHeight: 42,
    flex: 1,
    minWidth: 70,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  partInput: {
    width: 25,
    minHeight: 40,
    paddingHorizontal: 2,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
  },
  colon: { fontSize: 11, fontWeight: "900" },
  period: {
    width: 32,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  periodText: { fontSize: 8, fontWeight: "900" },
});
