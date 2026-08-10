import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { AppText as Text } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { DateRangeNavigator } from "@/src/components/PeriodNavigator";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { Avatar, Card, PageHeader, Screen } from "@/src/components/ui";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import {
  effectiveGoalTarget,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
  trackedGoalSummary,
} from "@/src/domain/metrics";
import { localizeMetricName } from "@/src/i18n/domain";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition } from "@/src/types";

const SEGMENTS = 32;
const RING_SIZE = 76;

function ProgressRing({
  progress,
  color,
  unavailable,
}: {
  progress: number;
  color: string;
  unavailable: boolean;
}) {
  const colors = useAppColors();
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * SEGMENTS);
  const ringColor = unavailable ? palette.amber : color;
  return (
    <View style={styles.ring}>
      {Array.from({ length: SEGMENTS }, (_, index) => {
        const angle = (index / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
        const radius = RING_SIZE / 2 - 4;
        return (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                left: RING_SIZE / 2 + Math.cos(angle) * radius - 1.5,
                top: RING_SIZE / 2 + Math.sin(angle) * radius - 4,
                backgroundColor: index < filled ? ringColor : colors.border,
                transform: [{ rotate: `${(index / SEGMENTS) * 360}deg` }],
              },
            ]}
          />
        );
      })}
      <View style={styles.ringLabel}>
        <Text
          translate={false}
          numberOfLines={1}
          style={[styles.ringPercent, { color: unavailable ? palette.amber : colors.ink }]}
        >
          {unavailable ? "—" : `${Math.round(Math.max(0, progress) * 100)}%`}
        </Text>
      </View>
    </View>
  );
}

function GoalOrbit({
  metric,
  localDate,
}: {
  metric: MetricDefinition;
  localDate: string;
}) {
  const { state } = useApp();
  const colors = useAppColors();
  const { language } = useLocalization();
  const applicable = metricApplicableOnDate(
    state,
    metric,
    state.currentUserId,
    localDate,
  );
  const value = safeMetricValue(state, metric, state.currentUserId, localDate);
  const target = effectiveGoalTarget(
    state,
    metric,
    state.currentUserId,
    localDate,
  );
  const met = applicable && scheduledGoalReached(
    state,
    metric,
    state.currentUserId,
    localDate,
  );
  const progress = applicable
    ? metricVisualProgress(
        state,
        metric,
        state.currentUserId,
        localDate,
        value,
        target,
      )
    : 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.navigate({
          pathname: "/metric-detail",
          params: { metric: metric.id, date: localDate },
        } as never)
      }
      style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
    >
      <ProgressRing
        progress={progress}
        color={met ? GOAL_COMPLETE_COLOR : metric.color}
        unavailable={!applicable}
      />
      <Text
        translate={false}
        numberOfLines={2}
        style={[styles.goalName, { color: colors.ink }]}
      >
        {localizeMetricName(language, metric)}
      </Text>
    </Pressable>
  );
}

export default function StatusPage() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const [localDate, setLocalDate] = useState(dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const summary = trackedGoalSummary(state, state.currentUserId, localDate);
  const member = state.group.members.find(
    (item) => item.id === state.currentUserId,
  );
  const goals = useMemo(
    () =>
      state.metrics.filter(
        (metric) =>
          metric.goalEnabled !== false &&
          metric.dataType !== "text" &&
          isMetricTrackedOnDate(state, metric, localDate),
      ),
    [localDate, state],
  );
  const shift = (direction: -1 | 1) =>
    setLocalDate((current) => {
      const next = dateWithOffsetFrom(current, direction);
      return next <= dateKey() ? next : current;
    });
  const swipe = usePageSwipeGesture({
    onPrevious: () => shift(-1),
    onNext: () => shift(1),
  });

  return (
    <GestureDetector gesture={swipe}>
      <Screen>
        <PageHeader
          title="Status"
          showMenu
        />
        <DateRangeNavigator
          period="custom"
          anchor={localDate}
          dates={[localDate]}
          calendarOpen={calendarOpen}
          onToggleCalendar={() => setCalendarOpen((open) => !open)}
          onShift={shift}
        >
          <MonthCalendar
            monthDate={localDate}
            selectedDate={localDate}
            onSelect={(next) => {
              setLocalDate(next <= dateKey() ? next : dateKey());
              setCalendarOpen(false);
            }}
            onMonthChange={setLocalDate}
          />
        </DateRangeNavigator>

        <Card style={styles.statusCard}>
          <View style={styles.personWrap}>
            <View style={[styles.halo, { borderColor: `${accent}55` }]} />
            {member ? (
              <Avatar
                initials={member.initials}
                color={accent}
                size={90}
                uri={member.avatarUri}
              />
            ) : (
              <View style={[styles.fallbackAvatar, { backgroundColor: accent }]}>
                <Ionicons name="person" size={46} color={palette.white} />
              </View>
            )}
            {member ? (
              <Text
                translate={false}
                numberOfLines={1}
                style={[styles.personName, { color: colors.ink }]}
              >
                {memberDisplayName(state, member)}
              </Text>
            ) : null}
            <Text style={[styles.summary, { color: colors.muted }]}>
              {summary.total
                ? `${summary.met}/${summary.total} ${t("goals completed on this date")}`
                : t("No goals are currently tracked. Add one in customization.")}
            </Text>
          </View>

          {goals.length ? (
            <View style={styles.goalGrid}>
              {goals.map((metric) => (
                <GoalOrbit key={metric.id} metric={metric} localDate={localDate} />
              ))}
            </View>
          ) : null}
        </Card>
      </Screen>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  statusCard: { gap: 16, paddingVertical: 18 },
  personWrap: { alignItems: "center", justifyContent: "center", gap: 5 },
  halo: {
    position: "absolute",
    top: -9,
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
  },
  fallbackAvatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
  },
  personName: { marginTop: 8, maxWidth: "82%", fontSize: 16, fontWeight: "900" },
  summary: { fontSize: 12, fontWeight: "700" },
  goalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
  },
  goal: { width: 92, alignItems: "center", gap: 5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  ring: { width: RING_SIZE, height: RING_SIZE },
  segment: { position: "absolute", width: 3, height: 8, borderRadius: 2 },
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPercent: { fontSize: 13, fontWeight: "900" },
  goalName: { minHeight: 30, textAlign: "center", fontSize: 11, lineHeight: 14, fontWeight: "800" },
});
