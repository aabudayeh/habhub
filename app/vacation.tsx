import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import {
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { VACATION_COLOR } from "@/src/domain/vacation";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors } from "@/src/theme";

export default function VacationSettings() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const periods = state.settings.vacationPeriods ?? [];
  const active = periods.find((period) => !period.to);

  function start() {
    if (active) return;
    updateSettings({
      vacationPeriods: [...periods, { from: dateKey() }],
    });
  }

  function finish() {
    if (!active) return;
    updateSettings({
      vacationPeriods: periods.map((period) =>
        period === active ? { ...period, to: dateKey() } : period,
      ),
    });
  }

  function remove(index: number) {
    Alert.alert(
      "Remove this vacation period?",
      "Protected days will return to their normal goal and streak results.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            updateSettings({
              vacationPeriods: periods.filter((_, item) => item !== index),
            }),
        },
      ],
    );
  }

  return (
    <Screen>
      <PageHeader
        eyebrow="GOAL PAUSE"
        title="Vacation mode"
        subtitle="Protect streaks without inventing measurements."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={[styles.hero, { borderColor: active ? VACATION_COLOR : colors.border }]}>
        <View style={[styles.icon, { backgroundColor: `${VACATION_COLOR}1C` }]}>
          <Ionicons name="airplane" size={24} color={VACATION_COLOR} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>
            {active ? "Vacation mode is active" : "Goals are running normally"}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {active
              ? `Active since ${friendlyDate(active.from)}. Vacation days receive a pink marker and do not break streaks.`
              : "Start it on the day your break begins. Existing values and averages are never changed."}
          </Text>
        </View>
      </Card>
      <Button
        label={active ? "End vacation today" : "Start vacation today"}
        icon={active ? "checkmark-circle-outline" : "airplane-outline"}
        onPress={active ? finish : start}
      />
      <Text style={[styles.note, { color: colors.muted }]}>
        Vacation days count as protected completion days only. They are excluded
        from measurement averages, totals, and energy calculations.
      </Text>
      <SectionHeader title="Vacation history" />
      <View style={styles.list}>
        {periods.length ? (
          periods.map((period, index) => (
            <Card key={`${period.from}-${index}`} style={styles.period}>
              <Ionicons name="calendar-outline" size={18} color={VACATION_COLOR} />
              <View style={styles.copy}>
                <Text style={[styles.periodTitle, { color: colors.ink }]}>
                  {friendlyDate(period.from)}
                  {period.to ? ` – ${friendlyDate(period.to)}` : " – active"}
                </Text>
                <Text style={[styles.periodMeta, { color: colors.muted }]}>
                  Pink checks protect tracked-goal streaks
                </Text>
              </View>
              <Pressable onPress={() => remove(index)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color="#D95852" />
              </Pressable>
            </Card>
          ))
        ) : (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No vacation periods recorded.
          </Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    marginBottom: 10,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: "900" },
  meta: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  note: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  list: { gap: 7 },
  period: { flexDirection: "row", alignItems: "center", gap: 10 },
  periodTitle: { fontSize: 11, fontWeight: "900" },
  periodMeta: { fontSize: 8, marginTop: 2 },
  empty: { fontSize: 10, paddingVertical: 14, textAlign: "center" },
});
