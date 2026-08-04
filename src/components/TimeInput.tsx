import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
} from "react-native";

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
  wheelPicker = false,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<TextStyle>;
  label?: string;
  wheelPicker?: boolean;
}) {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { hour, minute } = parts(value);
  const format = state.settings.timeFormat ?? "24h";
  const [pickerOpen, setPickerOpen] = useState(false);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const setPeriod = (next: "AM" | "PM") =>
    onChange(stored((displayHour % 12) + (next === "PM" ? 12 : 0), minute));
  const pickerButton = wheelPicker ? (
    <Pressable
      accessibilityLabel="Time"
      onPress={() => setPickerOpen(true)}
      style={[
        styles.pickerButton,
        { borderColor: colors.border, backgroundColor: colors.primarySoft },
      ]}
    >
      <Ionicons name="chevron-expand" size={16} color={accent} />
    </Pressable>
  ) : null;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      ) : null}
      {format === "24h" ? (
        <View style={styles.row}>
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
          {pickerButton}
        </View>
      ) : (
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
                onChange(
                  stored(hour, Math.max(0, Math.min(59, Number(raw) || 0))),
                );
              }}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              style={[styles.partInput, { color: colors.ink }]}
            />
          </View>
          <Pressable
            accessibilityLabel={`Switch to ${period === "AM" ? "PM" : "AM"}`}
            onPress={() => setPeriod(period === "AM" ? "PM" : "AM")}
            style={[
              styles.period,
              { borderColor: accent, backgroundColor: colors.primarySoft },
            ]}
          >
            <Text style={[styles.periodText, { color: accent }]}>{period}</Text>
          </Pressable>
          {pickerButton}
        </View>
      )}
      {wheelPicker ? (
        <TimeWheelModal
          visible={pickerOpen}
          hour={hour}
          minute={minute}
          format={format}
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const WHEEL_ROW_HEIGHT = 38;
const HOURS_24 = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const HOURS_12 = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

function WheelColumn({
  items,
  selectedIndex,
  onSelect,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const colors = useAppColors();
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollTo({
        y: Math.max(0, selectedIndex) * WHEEL_ROW_HEIGHT,
        animated: false,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedIndex]);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(
      0,
      Math.min(
        items.length - 1,
        Math.round(event.nativeEvent.contentOffset.y / WHEEL_ROW_HEIGHT),
      ),
    );
    onSelect(index);
  };
  return (
    <View style={styles.wheelColumn}>
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={styles.wheelContent}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
      >
        {items.map((item, index) => (
          <Pressable
            key={item}
            onPress={() => {
              onSelect(index);
              ref.current?.scrollTo({
                y: index * WHEEL_ROW_HEIGHT,
                animated: true,
              });
            }}
            style={styles.wheelRow}
          >
            <Text
              translate={false}
              style={[
                styles.wheelText,
                { color: colors.muted },
                index === selectedIndex ? styles.wheelTextSelected : undefined,
                index === selectedIndex ? { color: colors.ink } : undefined,
              ]}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function TimeWheelModal({
  visible,
  hour,
  minute,
  format,
  onChange,
  onClose,
}: {
  visible: boolean;
  hour: number;
  minute: number;
  format: "12h" | "24h";
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const twelveHour = hour % 12 || 12;
  const period = hour >= 12 ? 1 : 0;
  const setTwelveHour = (index: number) =>
    onChange(stored(((index + 1) % 12) + period * 12, minute));
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          style={[styles.sheet, { backgroundColor: colors.card }]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>Time</Text>
            <Pressable
              onPress={onClose}
              style={[styles.doneButton, { backgroundColor: colors.primarySoft }]}
            >
              <Text style={[styles.doneText, { color: accent }]}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.wheels}>
            <View
              pointerEvents="none"
              style={[
                styles.selectionBand,
                { borderColor: accent, backgroundColor: colors.primarySoft },
              ]}
            />
            <WheelColumn
              items={format === "24h" ? HOURS_24 : HOURS_12}
              selectedIndex={format === "24h" ? hour : twelveHour - 1}
              onSelect={(index) =>
                format === "24h"
                  ? onChange(stored(index, minute))
                  : setTwelveHour(index)
              }
            />
            <Text style={[styles.wheelColon, { color: colors.ink }]}>:</Text>
            <WheelColumn
              items={MINUTES}
              selectedIndex={minute}
              onSelect={(index) => onChange(stored(hour, index))}
            />
            {format === "12h" ? (
              <WheelColumn
                items={["AM", "PM"]}
                selectedIndex={period}
                onSelect={(index) =>
                  onChange(stored((twelveHour % 12) + index * 12, minute))
                }
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0, gap: 4 },
  label: { fontSize: 8, fontWeight: "900" },
  input: {
    minHeight: 42,
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    fontSize: 10,
    fontWeight: "800",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeParts: {
    minHeight: 42,
    flex: 1,
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  partInput: {
    width: 23,
    minHeight: 40,
    paddingHorizontal: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
  },
  colon: { fontSize: 11, fontWeight: "900" },
  period: {
    width: 36,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  periodText: { fontSize: 8, fontWeight: "900" },
  pickerButton: {
    width: 34,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: 20,
    padding: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 15, fontWeight: "900" },
  doneButton: { borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  doneText: { fontSize: 10, fontWeight: "900" },
  wheels: {
    height: WHEEL_ROW_HEIGHT * 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    overflow: "hidden",
  },
  selectionBand: {
    position: "absolute",
    left: 0,
    right: 0,
    top: WHEEL_ROW_HEIGHT,
    height: WHEEL_ROW_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderRadius: 8,
  },
  wheelColumn: { width: 62, height: WHEEL_ROW_HEIGHT * 3 },
  wheelContent: { paddingVertical: WHEEL_ROW_HEIGHT },
  wheelRow: {
    height: WHEEL_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelText: { fontSize: 12, fontWeight: "700", opacity: 0.55 },
  wheelTextSelected: { fontSize: 15, fontWeight: "900", opacity: 1 },
  wheelColon: { fontSize: 18, fontWeight: "900" },
});
