import { Ionicons } from "@expo/vector-icons";
import { PropsWithChildren } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, IconButton } from "@/src/components/ui";
import { friendlyDate } from "@/src/domain/date";
import {
  LeaderboardPeriod,
  periodTitle,
} from "@/src/domain/leaderboard";
import { useAppColors, useGroupAccent } from "@/src/theme";

export const PERIOD_CHOICES: {
  id: Exclude<LeaderboardPeriod, "custom">;
  label: string;
}[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "overall", label: "All time" },
];

export function adjacentPeriod(
  period: LeaderboardPeriod,
  direction: -1 | 1,
) {
  const current =
    period === "custom"
      ? PERIOD_CHOICES.findIndex((item) => item.id === "yesterday")
      : PERIOD_CHOICES.findIndex((item) => item.id === period);
  return PERIOD_CHOICES[current + direction]?.id;
}

export function PeriodChoiceBar({
  period,
  onChange,
}: {
  period: LeaderboardPeriod;
  onChange: (period: Exclude<LeaderboardPeriod, "custom">) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Card style={styles.periodCard}>
      <View style={styles.periodBar}>
        {PERIOD_CHOICES.map((item) => {
          const selected = period === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => onChange(item.id)}
              style={[
                styles.periodChoice,
                {
                  backgroundColor: selected
                    ? colors.primarySoft
                    : "transparent",
                  borderColor: selected ? accent : "transparent",
                },
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.68}
                style={[
                  styles.periodText,
                  { color: selected ? accent : colors.muted },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export function DateRangeNavigator({
  period,
  anchor,
  dates,
  calendarOpen,
  onToggleCalendar,
  onShift,
  children,
}: PropsWithChildren<{
  period: LeaderboardPeriod;
  anchor: string;
  dates: string[];
  calendarOpen: boolean;
  onToggleCalendar: () => void;
  onShift: (direction: -1 | 1) => void;
}>) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const allTime = period === "overall";
  return (
    <Card style={styles.navigator}>
      <View style={styles.dateNav}>
        {allTime ? (
          <View style={styles.navSpacer} />
        ) : (
          <IconButton
            icon="chevron-back"
            label="Previous"
            onPress={() => onShift(-1)}
          />
        )}
        <Pressable onPress={onToggleCalendar} style={styles.navCopy}>
          <Text style={[styles.navTitle, { color: colors.ink }]}>
            {periodTitle(period, anchor)}
          </Text>
          <View style={styles.navDate}>
            <Ionicons name="calendar-outline" size={13} color={accent} />
            <Text
              numberOfLines={1}
              style={[styles.navSub, { color: colors.muted }]}
            >
              {dates.length > 1
                ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])}`
                : friendlyDate(anchor)}
            </Text>
            <Ionicons
              name={calendarOpen ? "chevron-up" : "chevron-down"}
              size={13}
              color={colors.muted}
            />
          </View>
        </Pressable>
        {allTime ? (
          <View style={styles.navSpacer} />
        ) : (
          <IconButton
            icon="chevron-forward"
            label="Next"
            onPress={() => onShift(1)}
          />
        )}
      </View>
      {calendarOpen ? (
        <View style={[styles.calendar, { borderTopColor: colors.border }]}>
          {children}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  periodCard: { padding: 5, marginBottom: 7 },
  periodBar: { flexDirection: "row", alignItems: "center", gap: 3 },
  periodChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 33,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  periodText: { fontSize: 9, fontWeight: "900" },
  navigator: { padding: 8, marginBottom: 10 },
  dateNav: { flexDirection: "row", alignItems: "center" },
  navSpacer: { width: 38, height: 38 },
  navCopy: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navDate: {
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  navTitle: { fontSize: 12, fontWeight: "900" },
  navSub: { flexShrink: 1, fontSize: 9, marginTop: 2 },
  calendar: { borderTopWidth: 1, marginTop: 8, paddingTop: 9 },
});
