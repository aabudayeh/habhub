import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import {
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  friendlyDate,
} from "@/src/domain/date";
import {
  deficitRealityCheckAtDate,
  displayGoalProgress,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  hasMetricData,
  metricAverageGoalOffsetLabel,
  metricApplicableOnDate,
  metricOverallAverage,
  metricPeriodStats,
  metricStreakStats,
  safeMetricValue,
  scheduledGoalReached,
  weeklyDeficitBalance,
  weightProgressStats,
} from "@/src/domain/metrics";
import {
  LeaderboardPeriod,
  periodDates,
  periodTitle,
} from "@/src/domain/leaderboard";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition } from "@/src/types";
import { cycleForecast } from "@/src/domain/cycle";

export default function TrackerDetail() {
  const { metric: trackerId, date } = useLocalSearchParams<{
    metric: string;
    date?: string;
  }>();
  const { state, deleteEntry, deletePhoto, skipGoal } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [day, setDay] = useState(date ?? dateKey());
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [photoCompareOpen, setPhotoCompareOpen] = useState(false);
  const [collapsedEntryDates, setCollapsedEntryDates] = useState<string[]>([]);
  const weekly =
    trackerId === "weekly_deficit_balance" || trackerId === "weekly_deficit";
  const tracker = state.metrics.find((item) => item.id === trackerId);
  const dates = useMemo(
    () =>
      period === "month"
        ? dateRangeEnding(day, 30)
        : periodDates(period, day),
    [day, period],
  );
  function shiftRange(direction: number) {
    const amount = period === "week" ? 7 : period === "month" ? 30 : 1;
    const next = dateWithOffsetFrom(day, direction * amount);
    if (next <= dateKey()) {
      if (period === "today" || period === "yesterday") setPeriod("custom");
      setDay(next);
    }
  }
  if (weekly)
    return (
      <WeeklyDetail
        state={state}
        day={day}
        setDay={setDay}
        colors={colors}
        accent={accent}
      />
    );
  if (!tracker)
    return (
      <Screen>
        <PageHeader
          title="Tracker not found"
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label="Close"
              onPress={() => router.back()}
            />
          }
        />
      </Screen>
    );
  const isBloodPressure =
    tracker.id === "blood_pressure_systolic" ||
    (tracker.healthMapping?.dataType === "blood_pressure" &&
      tracker.healthMapping.field === "systolic");
  const entries = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === tracker.id &&
        dates.includes(entry.localDate),
    )
    .sort(
      (a, b) =>
        b.localDate.localeCompare(a.localDate) ||
        b.recordedAt.localeCompare(a.recordedAt),
    );
  const pairedBloodPressure = (entry: (typeof entries)[number]) => {
    if (!isBloodPressure) return null;
    const diastolicId = state.metrics.find(
      (candidate) =>
        candidate.id === "blood_pressure_diastolic" ||
        (candidate.healthMapping?.dataType === "blood_pressure" &&
          candidate.healthMapping.field === "diastolic"),
    )?.id;
    const pulseId = state.metrics.find(
      (candidate) =>
        candidate.id === "pulse" ||
        candidate.healthMapping?.dataType === "heart_rate",
    )?.id;
    const companions = state.entries.filter(
      (candidate) =>
        candidate.userId === entry.userId &&
        candidate.localDate === entry.localDate &&
        [diastolicId, pulseId].includes(candidate.metricId),
    );
    const nearest = (metricId: string) =>
      companions
        .filter((candidate) => candidate.metricId === metricId)
        .sort(
          (a, b) =>
            Math.abs(new Date(a.recordedAt).getTime() - new Date(entry.recordedAt).getTime()) -
            Math.abs(new Date(b.recordedAt).getTime() - new Date(entry.recordedAt).getTime()),
        )[0];
    return {
      diastolic: diastolicId ? nearest(diastolicId) : undefined,
      pulse: pulseId ? nearest(pulseId) : undefined,
    };
  };
  const dayPhotos =
    tracker.dataType === "photo"
      ? state.photos.filter(
          (photo) =>
            photo.userId === state.currentUserId && dates.includes(photo.localDate),
        )
      : [];
  const olderPhoto =
    tracker.dataType === "photo"
      ? [...state.photos]
          .filter(
            (photo) =>
              photo.userId === state.currentUserId && photo.localDate < day,
          )
          .sort((a, b) => b.localDate.localeCompare(a.localDate))[0]
      : undefined;
  const periodStats = metricPeriodStats(
    state,
    tracker,
    state.currentUserId,
    dates,
  );
  const chartDates = periodStats.applicableDates;
  const loggedDates = periodStats.loggedDates;
  const values = periodStats.values;
  const diastolicTracker =
    isBloodPressure
      ? (state.metrics.find(
          (item) =>
            item.id === "blood_pressure_diastolic" ||
            (item.healthMapping?.dataType === "blood_pressure" &&
              item.healthMapping.field === "diastolic"),
        ) ?? {
          ...tracker,
          id: "blood_pressure_diastolic",
          name: "Diastolic pressure",
          color: "#C45B35",
          goal: { kind: "exact", target: 80 },
          goalRange: { min: 60, max: 80 },
          goalEnabled: true,
        })
      : undefined;
  const pulseTracker =
    isBloodPressure
      ? (state.metrics.find(
          (item) => item.id === "pulse" || item.healthMapping?.dataType === "heart_rate",
        ) ?? {
          ...tracker,
          id: "pulse",
          name: "Pulse",
          unit: "bpm",
          goalEnabled: false,
        })
      : undefined;
  const diastolicValues = diastolicTracker
    ? loggedDates.map((date) =>
        safeMetricValue(state, diastolicTracker, state.currentUserId, date),
      )
    : undefined;
  const average = periodStats.average;
  const streaks = metricStreakStats(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const overallAverage = metricOverallAverage(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const applicable = metricApplicableOnDate(
    state,
    tracker,
    state.currentUserId,
    day,
  );
  const current = safeMetricValue(state, tracker, state.currentUserId, day);
  const currentDiastolic = diastolicTracker
    ? safeMetricValue(state, diastolicTracker, state.currentUserId, day)
    : 0;
  const currentPulse = pulseTracker
    ? safeMetricValue(state, pulseTracker, state.currentUserId, day)
    : 0;
  const averageDiastolic = diastolicValues?.length
    ? diastolicValues.reduce((sum, value) => sum + value, 0) /
      diastolicValues.length
    : 0;
  const isPhoto = tracker.dataType === "photo";
  const displayAvailable =
    applicable &&
    (tracker.dataType === "calculated" ||
      (dates.length === 1 ? hasData(state, tracker, day) : loggedDates.length > 0));
  const highestEver = highestRecordedValue(state, tracker, day);
  const target = effectiveGoalTarget(state, tracker, state.currentUserId, day);
  const displayedTarget =
    dates.length === 1 ? target : periodStats.averageTarget;
  const displayedValue = dates.length === 1 ? current : average;
  const dayGoalMet =
    dates.length === 1 &&
    displayAvailable &&
    scheduledGoalReached(state, tracker, state.currentUserId, day);
  const diastolicTarget = diastolicTracker
    ? effectiveGoalTarget(
        state,
        diastolicTracker,
        state.currentUserId,
        day,
      )
    : 0;
  const systolicDayMet =
    displayAvailable && goalReached(tracker, current, target);
  const diastolicDayMet =
    Boolean(diastolicTracker) &&
    displayAvailable &&
    goalReached(diastolicTracker!, currentDiastolic, diastolicTarget);
  const latestWeightDate = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === "weight" &&
        entry.localDate <= day,
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate))[0]?.localDate;
  const reality =
    tracker.id === "weight" && latestWeightDate
      ? deficitRealityCheckAtDate(state, state.currentUserId, latestWeightDate)
      : null;
  const weightStats =
    tracker.id === "weight"
      ? weightProgressStats(state, state.currentUserId, day)
      : null;
  return (
    <Screen>
      <PageHeader
        eyebrow={tracker.category?.toUpperCase() ?? "YOUR TRACKER"}
        title={tracker.name}
        subtitle="Entries, trends, and progress in one place."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <View style={styles.controls}>
        <View style={styles.periods}>
          <Chip
            label="Today"
            selected={period === "today"}
            onPress={() => { setPeriod("today"); setDay(dateKey()); }}
          />
          <Chip
            label="Yesterday"
            selected={period === "yesterday"}
            onPress={() => { setPeriod("yesterday"); setDay(dateWithOffsetFrom(dateKey(), -1)); }}
          />
          <Chip
            label="7 days"
            selected={period === "week"}
            onPress={() => setPeriod("week")}
          />
          <Chip
            label="30 days"
            selected={period === "month"}
            onPress={() => setPeriod("month")}
          />
        </View>
        <Card style={styles.navigator}>
          <View style={styles.dateNav}>
            <IconButton
              icon="chevron-back"
              label="Previous"
              onPress={() => shiftRange(-1)}
            />
            <Pressable
              onPress={() => setCalendarOpen((open) => !open)}
              style={styles.navCopy}
            >
              <Text style={[styles.navTitle, { color: colors.ink }]}>
                {period === "month" ? "Last 30 days" : periodTitle(period, day)}
              </Text>
              <View style={styles.navDate}>
                <Ionicons name="calendar-outline" size={13} color={accent} />
                <Text style={[styles.navSub, { color: colors.muted }]}>
                  {dates.length > 1
                    ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])}`
                    : friendlyDate(day)}
                </Text>
                <Ionicons
                  name={calendarOpen ? "chevron-up" : "chevron-down"}
                  size={13}
                  color={colors.muted}
                />
              </View>
            </Pressable>
            <IconButton
              icon="chevron-forward"
              label="Next"
              onPress={() => shiftRange(1)}
            />
          </View>
          {calendarOpen ? (
            <View style={[styles.calendar, { borderTopColor: colors.border }]}>
              <MonthCalendar
                monthDate={day}
                selectedDate={day}
                onSelect={(selectedDay) => {
                  setDay(selectedDay);
                  setPeriod("custom");
                  setCalendarOpen(false);
                }}
                hasActivity={(localDate) =>
                  hasData(state, tracker, localDate)
                }
                dayVisuals={(localDate) => {
                  if (!hasData(state, tracker, localDate)) return [];
                  const localTarget = effectiveGoalTarget(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  );
                  const localValue = safeMetricValue(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  );
                  const visuals = [
                    {
                      color: tracker.color,
                      progress: displayGoalProgress(
                        tracker,
                        localValue,
                        localTarget,
                      ),
                      goalReached: scheduledGoalReached(
                        state,
                        tracker,
                        state.currentUserId,
                        localDate,
                      ),
                    },
                  ];
                  if (diastolicTracker) {
                    const localDiastolicTarget = effectiveGoalTarget(
                      state,
                      diastolicTracker,
                      state.currentUserId,
                      localDate,
                    );
                    const localDiastolicValue = safeMetricValue(
                      state,
                      diastolicTracker,
                      state.currentUserId,
                      localDate,
                    );
                    visuals.push({
                      color: diastolicTracker.color,
                      progress: displayGoalProgress(
                        diastolicTracker,
                        localDiastolicValue,
                        localDiastolicTarget,
                      ),
                      goalReached: goalReached(
                        diastolicTracker,
                        localDiastolicValue,
                        localDiastolicTarget,
                      ),
                    });
                  }
                  return visuals;
                }}
                allTrackedGoalsMet={(localDate) =>
                  hasData(state, tracker, localDate) &&
                  scheduledGoalReached(
                    state,
                    tracker,
                    state.currentUserId,
                    localDate,
                  )
                }
              />
            </View>
          ) : null}
        </Card>
      </View>
      {day === dateKey() && tracker.goalEnabled !== false ? (
        <Pressable
          onPress={() =>
            Alert.alert(
              `Skip ${tracker.name} today?`,
              "This counts today as complete and records a visible skip entry that you can delete later.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Skip today", onPress: () => skipGoal(tracker.id, day) },
              ],
            )
          }
          style={[styles.skipToday, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Ionicons name="play-skip-forward-outline" size={16} color={accent} />
          <Text style={[styles.skipTodayText, { color: accent }]}>Skip today · count complete</Text>
        </Pressable>
      ) : null}
      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <View>
            <Text style={[styles.label, { color: colors.faint }]}>
              {dates.length === 1
                ? day === dateKey()
                  ? "TODAY"
                  : friendlyDate(day).toUpperCase()
                : `${dates.length}-DAY AVERAGE`}
            </Text>
            <Text style={[styles.value, { color: colors.ink }]}>
              {isPhoto
                ? `${dayPhotos.length} photo${dayPhotos.length === 1 ? "" : "s"}`
                : !displayAvailable
                  ? "Not available"
                  : isBloodPressure
                    ? `${Math.round(dates.length === 1 ? current : average)}/${Math.round(dates.length === 1 ? currentDiastolic : averageDiastolic)} mmHg`
                  : formatMetricValue(
                      tracker,
                      dates.length === 1 ? current : average,
                    )}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {isBloodPressure && currentPulse > 0
                ? `Pulse ${Math.round(currentPulse)} bpm`
                : summaryLine(
                    state,
                    tracker,
                    day,
                    displayedValue,
                    displayedTarget,
                    applicable,
                  )}
            </Text>
          </View>
          <View
            style={[
              styles.largeIcon,
              { backgroundColor: `${tracker.color}18` },
            ]}
          >
            <Ionicons
              name={tracker.icon as keyof typeof Ionicons.glyphMap}
              size={23}
              color={tracker.color}
            />
          </View>
        </View>
        {dates.length === 1 &&
        displayAvailable &&
        tracker.goalEnabled !== false &&
        !isPhoto ? (
          <View style={styles.dayProgress}>
            <View style={styles.dayProgressHeading}>
              <Text style={[styles.dayProgressLabel, { color: colors.muted }]}>
                {isBloodPressure ? "Systolic" : "Goal progress"}
              </Text>
              <Ionicons
                name={
                  (isBloodPressure ? systolicDayMet : dayGoalMet)
                    ? "checkmark-circle"
                    : "ellipse-outline"
                }
                size={17}
                color={
                  (isBloodPressure ? systolicDayMet : dayGoalMet)
                    ? palette.lime
                    : colors.faint
                }
              />
            </View>
            <ProgressBar
              progress={goalProgress(tracker, current, target)}
              color={systolicDayMet ? palette.lime : tracker.color}
            />
            {diastolicTracker ? (
              <>
                <View style={styles.dayProgressHeading}>
                  <Text
                    style={[styles.dayProgressLabel, { color: colors.muted }]}
                  >
                    Diastolic
                  </Text>
                  <Ionicons
                    name={
                      diastolicDayMet
                        ? "checkmark-circle"
                        : "ellipse-outline"
                    }
                    size={17}
                    color={
                      diastolicDayMet ? palette.lime : colors.faint
                    }
                  />
                </View>
                <ProgressBar
                  progress={goalProgress(
                    diastolicTracker,
                    currentDiastolic,
                    diastolicTarget,
                  )}
                  color={
                    diastolicDayMet
                      ? palette.lime
                      : diastolicTracker.color
                  }
                />
              </>
            ) : null}
          </View>
        ) : null}
        {dates.length > 1 && values.length > 0 && !isPhoto ? (
          <Trend
            values={values}
            tracker={tracker}
            target={target}
            colors={colors}
            secondaryValues={diastolicValues}
            secondaryColor={diastolicTracker?.color}
            secondaryTarget={diastolicTracker?.goal.target}
            primaryRange={tracker.goalRange}
            secondaryRange={diastolicTracker?.goalRange}
          />
        ) : null}
        {!isPhoto ? (
          <View style={[styles.stats, { borderColor: colors.border }]}>
            <Stat
              label="Current streak"
              value={`${streaks.current} days`}
              colors={colors}
            />
            <Stat
              label="Best streak"
              value={`${streaks.best} days`}
              colors={colors}
            />
            {dates.length === 1 ? (
              <Stat
                label={isBloodPressure ? "Highest systolic" : "Highest day"}
                value={highestEver === null ? "—" : formatMetricValue(tracker, highestEver)}
                colors={colors}
              />
            ) : (
              <>
                <Stat
                  label="Goals reached"
                  value={`${periodStats.goalsReached}/${chartDates.length}`}
                  colors={colors}
                />
                <Stat
                  label="Average vs goal"
                  value={metricAverageGoalOffsetLabel(
                    tracker,
                    average,
                    periodStats.averageTarget,
                  )}
                  colors={colors}
                />
              </>
            )}
            {dates.length > 1 &&
            tracker.aggregation === "sum" &&
            tracker.dataType !== "boolean" ? (
              <Stat
                label="Period total"
                value={formatMetricValue(tracker, periodStats.total)}
                colors={colors}
              />
            ) : null}
            <Stat
              label="Overall average"
              value={formatMetricValue(tracker, overallAverage)}
              colors={colors}
            />
          </View>
        ) : null}
        {state.trackedGoalPeriods[tracker.id]?.length ? (
          <Text style={[styles.trackingSince, { color: colors.muted }]}>
            Goal tracked since {new Date(`${state.trackedGoalPeriods[tracker.id].find((period) => !period.to)?.from ?? state.trackedGoalPeriods[tracker.id][0].from}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </Text>
        ) : null}
      </Card>
      {["menstrual_cycle", "menstrual_flow", "cycle_day", "days_until_period"].includes(tracker.id) ? (
        <Card style={{ gap: 4 }}>
          {(() => {
            const forecast = cycleForecast(state, state.currentUserId, day);
            return <>
              <Text style={[styles.label, { color: tracker.color }]}>CYCLE ESTIMATE</Text>
              <Text style={[styles.value, { color: colors.ink }]}>Day {forecast.cycleDay || "–"} · {forecast.phase}</Text>
              <Text style={[styles.sub, { color: colors.muted }]}>
                {forecast.nextPeriodStart ? `Next period around ${friendlyDate(forecast.nextPeriodStart)} · ${forecast.averageCycleDays}-day rolling average` : "Log a period start to begin estimates."}
              </Text>
              <Text style={[styles.sub, { color: colors.faint }]}>Estimates learn from up to six recent cycles; personalized after three completed cycles. Not contraception or medical advice.</Text>
            </>;
          })()}
        </Card>
      ) : null}
      {weightStats ? (
        <Card style={styles.weightPlan}>
          <Stat
            label="Total change"
            value={`${Math.abs(weightStats.totalChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Weekly average"
            value={`${Math.abs(weightStats.averageWeeklyChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Last 7 days"
            value={`${Math.abs(weightStats.lastWeekChange).toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Plan per week"
            value={`${weightStats.expectedWeeklyChange.toFixed(1)} kg`}
            colors={colors}
          />
          <Stat
            label="Expected goal date"
            value={
              weightStats.expectedGoalDate
                ? new Date(`${weightStats.expectedGoalDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : "Maintaining"
            }
            colors={colors}
          />
        </Card>
      ) : null}
      {reality ? (
      <Card>
          <Text style={[styles.entryTitle, { color: colors.ink }]}>
            Reported vs scale-estimated energy
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {reality.status === "insufficient"
              ? "Add at least two weight entries and log food between them to compare reported deficit with scale-estimated change."
              : reality.status === "aligned"
                ? "Your measured change broadly matches your reported energy balance."
                : reality.status === "noise"
                  ? "Normal scale variation is larger than the current signal. Keep logging."
                  : `Measured change and reported energy differ across ${Math.round(reality.days)} days.`}
          </Text>
          {reality.status !== "insufficient" ? (
            <>
              <Text style={[styles.entryValue, { color: accent }]}>
                Logged {state.settings.weightDirection === "gain" ? "surplus" : "deficit"} {Math.round(reality.reportedDailyDeficit)} kcal/day ·
                scale-implied {state.settings.weightDirection === "gain" ? "surplus" : "deficit"} {Math.round(reality.actualDailyDeficit)} kcal/day ·{" "}
                {Math.abs(reality.weightChangeKg).toFixed(1)} kg change
              </Text>
              {reality.estimatedDays > 0 ? (
                <Text style={[styles.sub, { color: colors.muted }]}>
                  {reality.estimatedDays} unlogged day{reality.estimatedDays === 1 ? "" : "s"} used your logged-day average.
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}
      <View style={styles.logHeader}>
        <Text style={[styles.section, { color: colors.ink }]}>
          Entries
        </Text>
        {tracker.id !== "steps" && tracker.manualEntry !== false && tracker.dataType !== "calculated" ? (
          <Pressable
            onPress={() =>
              router.navigate({
                pathname: "/(tabs)/log",
                params: { metric: tracker.id },
              })
            }
            style={[styles.logButton, { backgroundColor: accent }]}
          >
            <Ionicons name="add" size={15} color={palette.white} />
            <Text style={styles.logButtonText}>Add</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.entries}>
        {entries.map((entry, index) => {
          const firstOnDate =
            index === 0 || entries[index - 1].localDate !== entry.localDate;
          const collapsed = collapsedEntryDates.includes(entry.localDate);
          return (
          <React.Fragment key={entry.id}>
          {dates.length > 1 && firstOnDate ? (
            <Pressable
              onPress={() =>
                setCollapsedEntryDates((current) =>
                  current.includes(entry.localDate)
                    ? current.filter((date) => date !== entry.localDate)
                    : [...current, entry.localDate],
                )
              }
              style={[styles.dateGroupHeader, { borderColor: colors.border }]}
            >
              <Text style={[styles.entryTitle, { color: colors.ink }]}>
                {friendlyDate(entry.localDate)}
              </Text>
              <View style={styles.dateGroupMeta}>
                <Text style={[styles.time, { color: colors.muted }]}>
                  {entries.filter((item) => item.localDate === entry.localDate).length}
                </Text>
                <Ionicons
                  name={collapsed ? "chevron-down" : "chevron-up"}
                  size={16}
                  color={accent}
                />
              </View>
            </Pressable>
          ) : null}
          {!collapsed ? (
          <Pressable
            delayLongPress={450}
            onLongPress={
              entry.source !== "calculated"
                ? () =>
                    Alert.alert(
                      entry.source === "imported" ? "Hide imported entry?" : "Delete entry?",
                      entry.source === "imported"
                        ? "This imported record will remain hidden after future health syncs."
                        : "This removes this manually logged item.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteEntry(entry.id),
                        },
                      ],
                    )
                : undefined
            }
          >
          <Card style={styles.entry}>
            <View style={styles.entryTop}>
              <View style={styles.grow}>
                <Text style={[styles.entryTitle, { color: colors.ink }]}>
                  {entry.nutrition?.mealType
                    ? `${entry.nutrition.mealType[0].toUpperCase()}${entry.nutrition.mealType.slice(1)} · ${entry.label || tracker.name}`
                    : entry.label || tracker.name}
                </Text>
                <Text style={[styles.time, { color: colors.faint }]}>
                  {new Date(entry.recordedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  ·{" "}
                  {entry.source === "imported"
                    ? entry.sourceOrigin || "Health import"
                    : "Manual entry"}
                </Text>
              </View>
              <Text style={[styles.entryValue, { color: tracker.color }]}>
                {(() => {
                  const pair = pairedBloodPressure(entry);
                  if (pair?.diastolic)
                    return `${Math.round(Number(entry.value))}/${Math.round(Number(pair.diastolic.value))} mmHg${pair.pulse ? ` · ${Math.round(Number(pair.pulse.value))} bpm` : ""}`;
                  return typeof entry.value === "number"
                    ? formatMetricValue(tracker, entry.value)
                    : String(entry.value);
                })()}
              </Text>
            </View>
            {entry.note ? (
              <Text style={[styles.note, { color: colors.muted }]}>
                {entry.note}
              </Text>
            ) : null}
            {entry.nutrition ? (
              <Text style={[styles.note, { color: colors.muted }]}>
                {nutritionLine(entry.nutrition)}
              </Text>
            ) : null}
            {entry.imageUri ? (
              <ExpandableImage
                uri={entry.imageUri}
                thumbnailStyle={styles.image}
              />
            ) : null}
          </Card>
          </Pressable>
          ) : null}
          </React.Fragment>
          );
        })}
        {dayPhotos.map((photo) => (
          <Pressable
            key={photo.id}
            delayLongPress={450}
            onLongPress={() =>
              Alert.alert(
                "Delete photo?",
                "This removes this progress-photo entry.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deletePhoto(photo.id),
                  },
                ],
              )
            }
          >
          <Card style={styles.entry}>
            <Text style={[styles.entryTitle, { color: colors.ink }]}>
              {photo.caption || "Progress photo"}
            </Text>
            <Text style={[styles.time, { color: colors.faint }]}>
              {friendlyDate(photo.localDate)}
            </Text>
            <ExpandableImage
              uri={photo.uri}
              containerStyle={styles.photoImageFrame}
              thumbnailStyle={styles.photoImage}
            />
            {olderPhoto ? (
              <>
                <Pressable
                  onPress={() => setPhotoCompareOpen((open) => !open)}
                  style={styles.photoToggle}
                >
                  <Text style={[styles.note, { color: colors.muted }]}>
                    Compare with {friendlyDate(olderPhoto.localDate)}
                  </Text>
                  <Ionicons
                    name={photoCompareOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={accent}
                  />
                </Pressable>
                {photoCompareOpen ? (
                  <>
                    <View style={styles.photoCompare}>
                      <ExpandableImage
                        uri={photo.uri}
                        containerStyle={styles.compareImageFrame}
                        thumbnailStyle={styles.compareImage}
                      />
                      <ExpandableImage
                        uri={olderPhoto.uri}
                        containerStyle={styles.compareImageFrame}
                        thumbnailStyle={styles.compareImage}
                      />
                    </View>
                    <Pressable
                      onPress={() =>
                        router.navigate({
                          pathname: "/day/[date]",
                          params: { date: day, metrics: tracker.id },
                        } as never)
                      }
                      style={[styles.compareButton, { borderColor: accent }]}
                    >
                      <Ionicons
                        name="download-outline"
                        size={16}
                        color={accent}
                      />
                      <Text style={[styles.compareText, { color: accent }]}>
                        Open comparison & export
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </Card>
          </Pressable>
        ))}
      </View>
      {!entries.length && !dayPhotos.length ? (
        <Card>
          <Text style={[styles.empty, { color: colors.muted }]}>
            {tracker.dataType === "calculated"
              ? "This value is calculated from the day’s inputs."
              : "Nothing recorded on this day."}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
function WeeklyDetail({
  state,
  day,
  setDay,
  colors,
  accent,
}: {
  state: ReturnType<typeof useApp>["state"];
  day: string;
  setDay: (day: string) => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  const balance = weeklyDeficitBalance(state, state.currentUserId, day);
  const days = Array.from({ length: 7 }, (_, i) =>
    dateWithOffsetFrom(balance.startDate, i),
  );
  return (
    <Screen>
      <PageHeader
        eyebrow="ENERGY PLAN"
        title="Weekly balance"
        subtitle="Only days with food recorded count. A non-negative balance means the weekly target is on plan."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.navigator}>
        <IconButton
          icon="chevron-back"
          label="Previous week"
          onPress={() => setDay(dateWithOffsetFrom(day, -7))}
        />
        <Text style={[styles.navTitle, { color: colors.ink }]}>
          Week of {balance.startDate}
        </Text>
        <IconButton
          icon="chevron-forward"
          label="Next week"
          onPress={() => setDay(dateWithOffsetFrom(day, 7))}
        />
      </Card>
      <Card style={styles.summary}>
        <Text style={[styles.label, { color: colors.faint }]}>
          WEEKLY RESULT
        </Text>
        <Text
          style={[
            styles.value,
            { color: balance.balance >= 0 ? accent : palette.red },
          ]}
        >
          {Math.abs(Math.round(balance.balance)).toLocaleString()} kcal{" "}
          {balance.balance >= 0 ? "ahead" : "behind"}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>
          {balance.days} valid day{balance.days === 1 ? "" : "s"} ·{" "}
          {Math.round(balance.actual)} actual / {Math.round(balance.target)}{" "}
          target
        </Text>
      </Card>
      <View style={styles.entries}>
        {days.map((date) => {
          const valid = state.entries.some(
            (entry) =>
              entry.userId === state.currentUserId &&
              entry.metricId === "food" &&
              entry.localDate === date,
          );
          const deficit = state.metrics.find((item) => item.id === "deficit");
          const value =
            valid && deficit
              ? safeMetricValue(state, deficit, state.currentUserId, date)
              : 0;
          return (
            <Card key={date} style={styles.weekRow}>
              <Text style={[styles.entryTitle, { color: colors.ink }]}>
                {date}
              </Text>
              <Text
                style={[
                  styles.entryValue,
                  { color: valid ? colors.ink : colors.faint },
                ]}
              >
                {valid ? `${Math.round(value)} kcal` : "Not counted"}
              </Text>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
function Trend({
  values,
  tracker,
  target,
  colors,
  secondaryValues,
  secondaryColor,
  secondaryTarget,
  primaryRange,
  secondaryRange,
}: {
  values: number[];
  tracker: MetricDefinition;
  target: number;
  colors: ReturnType<typeof useAppColors>;
  secondaryValues?: number[];
  secondaryColor?: string;
  secondaryTarget?: number;
  primaryRange?: { min: number; max: number };
  secondaryRange?: { min: number; max: number };
}) {
  if (secondaryValues)
    return (
      <BloodPressureTrend
        systolic={values}
        diastolic={secondaryValues}
        systolicColor={tracker.color}
        diastolicColor={secondaryColor ?? colors.muted}
        systolicRange={primaryRange ?? { min: 90, max: 120 }}
        diastolicRange={secondaryRange ?? { min: 60, max: 80 }}
      />
    );
  const max = Math.max(
    ...values,
    ...(secondaryValues ?? []),
    target,
    secondaryTarget ?? 0,
    1,
  );
  return (
    <View style={styles.chart}>
      <View
        style={[
          styles.goalLine,
          {
            bottom: `${Math.min(1, target / max) * 100}%`,
            borderColor: tracker.color,
          },
        ]}
      >
        <Text style={[styles.goalLabel, { color: tracker.color }]}>
          {secondaryValues ? "systolic goal" : "goal"}
        </Text>
      </View>
      {secondaryValues && secondaryTarget ? (
        <View
          style={[
            styles.goalLine,
            {
              bottom: `${Math.min(1, secondaryTarget / max) * 100}%`,
              borderColor: secondaryColor ?? colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.goalLabel,
              styles.secondaryGoalLabel,
              { color: secondaryColor ?? colors.muted },
            ]}
          >
            diastolic goal
          </Text>
        </View>
      ) : null}
      {values.map((value, index) => (
        <View key={index} style={styles.barSlot}>
          <View
            style={[
              styles.bar,
              {
                height: `${Math.max(3, (value / max) * 100)}%`,
                backgroundColor: tracker.color,
              },
            ]}
          />
          {secondaryValues ? (
            <View
              style={[
                styles.bar,
                {
                  height: `${Math.max(3, ((secondaryValues[index] ?? 0) / max) * 100)}%`,
                  backgroundColor: secondaryColor ?? colors.muted,
                },
              ]}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function BloodPressureTrend({
  systolic,
  diastolic,
  systolicColor,
  diastolicColor,
  systolicRange,
  diastolicRange,
}: {
  systolic: number[];
  diastolic: number[];
  systolicColor: string;
  diastolicColor: string;
  systolicRange: { min: number; max: number };
  diastolicRange: { min: number; max: number };
}) {
  const [width, setWidth] = useState(0);
  const height = 116;
  const all = [...systolic, ...diastolic, systolicRange.max, diastolicRange.max];
  const minValue = Math.max(
    0,
    Math.min(...all, systolicRange.min, diastolicRange.min) - 15,
  );
  const maxValue = Math.max(...all, 1) + 15;
  const y = (value: number) =>
    height - ((value - minValue) / (maxValue - minValue)) * height;
  const points = (values: number[]) =>
    values.map((value, index) => ({
      x:
        values.length === 1
          ? width / 2
          : (index / Math.max(1, values.length - 1)) * width,
      y: y(value),
    }));
  const draw = (values: number[], color: string) => {
    const series = points(values);
    return (
      <>
        {series.slice(1).map((point, index) => {
          const previous = series[index];
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          return (
            <View
              key={`line-${index}`}
              style={[
                styles.chartSegment,
                {
                  backgroundColor: color,
                  left: previous.x,
                  top: previous.y,
                  width: length,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          );
        })}
        {series.map((point, index) => (
          <View
            key={`dot-${index}`}
            style={[
              styles.chartDot,
              {
                backgroundColor: color,
                left: point.x - 4,
                top: point.y - 4,
              },
            ]}
          />
        ))}
      </>
    );
  };
  return (
    <View>
      <View style={styles.bpLegend}>
        <LegendDot label="Systolic" color={systolicColor} />
        <LegendDot label="Diastolic" color={diastolicColor} />
      </View>
      <View
        style={[styles.bpChart, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {[systolicRange, diastolicRange].map((range, index) => (
          <View
            key={index}
            style={[
              styles.bpGoalBand,
              {
                backgroundColor: `${index === 0 ? systolicColor : diastolicColor}12`,
                bottom: height - y(range.min),
                height: Math.max(2, y(range.min) - y(range.max)),
              },
            ]}
          />
        ))}
        {width > 0 ? draw(systolic, systolicColor) : null}
        {width > 0 ? draw(diastolic, diastolicColor) : null}
      </View>
    </View>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.time, { color }]}>{label}</Text>
    </View>
  );
}
function Stat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}
function hasData(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
) {
  return hasMetricData(state, tracker, state.currentUserId, day);
}
function highestRecordedValue(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  throughDate: string,
) {
  if (tracker.dataType === "photo" || tracker.dataType === "text") return null;
  const dates =
    tracker.dataType === "calculated"
      ? Array.from({ length: 365 }, (_, index) =>
          dateWithOffsetFrom(throughDate, -index),
        ).filter((date) => hasData(state, tracker, date))
      : Array.from(
          new Set(
            state.entries
              .filter(
                (entry) =>
                  entry.userId === state.currentUserId &&
                  entry.metricId === tracker.id &&
                  entry.localDate <= throughDate,
              )
              .map((entry) => entry.localDate),
          ),
        );
  if (!dates.length) return null;
  return Math.max(
    ...dates.map((date) =>
      safeMetricValue(state, tracker, state.currentUserId, date),
    ),
  );
}
function summaryLine(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
  value: number,
  target: number,
  applicable: boolean,
) {
  if (!applicable)
    return "Food has not been recorded, so no energy result is calculated.";
  if (tracker.goalEnabled === false)
    return "Informational reading · no target attached";
  if (tracker.id === "food")
    return `${Math.round(value)} consumed · ${Math.max(0, Math.round(target - value))} remaining`;
  if (tracker.id === "weight") {
    const first = state.entries
      .filter(
        (entry) =>
          entry.userId === state.currentUserId && entry.metricId === "weight",
      )
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))[0];
    const change = first ? value - Number(first.value) : 0;
    return first
      ? `${change > 0 ? "+" : ""}${change.toFixed(1)} kg from starting weight`
      : "Add a first weigh-in to establish your baseline";
  }
  if (tracker.goalRange)
    return `Preferred range ${tracker.goalRange.min}–${tracker.goalRange.max} ${tracker.unit}`;
  return `Target ${formatMetricValue(tracker, target)}`;
}
function nutritionLine(
  nutrition: NonNullable<
    ReturnType<typeof useApp>["state"]["entries"][number]["nutrition"]
  >,
) {
  const labels: Record<string, string> = {
    proteinG: "Protein",
    fatG: "Fat",
    carbsG: "Carbs",
    fiberG: "Fiber",
    sodiumMg: "Sodium",
    sugarG: "Sugar",
    saturatedFatG: "Saturated fat",
    cholesterolMg: "Cholesterol",
    potassiumMg: "Potassium",
    calciumMg: "Calcium",
    ironMg: "Iron",
    magnesiumMg: "Magnesium",
    vitaminCMg: "Vitamin C",
    vitaminDMcg: "Vitamin D",
    vitaminB12Mcg: "Vitamin B12",
  };
  return Object.entries(nutrition)
    .filter(([, value]) => Number(value) > 0)
    .map(
      ([key, value]) =>
        `${labels[key] ?? key} ${Math.round(Number(value) * 10) / 10}`,
    )
    .join(" · ");
}
const styles = StyleSheet.create({
  weightPlan: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  controls: {
    alignItems: "stretch",
    gap: 8,
    marginBottom: 10,
  },
  periods: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  navigator: {
    padding: 8,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navCopy: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navDate: { flexDirection: "row", alignItems: "center", gap: 5 },
  navTitle: { fontSize: 14, fontWeight: "900" },
  navSub: { fontSize: 9, marginTop: 2, textAlign: "center" },
  calendar: { borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  summary: { marginBottom: 9 },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  label: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  value: { fontSize: 25, fontWeight: "900", marginTop: 4 },
  sub: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  dayProgress: { gap: 6, marginTop: 12 },
  dayProgressHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayProgressLabel: { fontSize: 8, fontWeight: "900" },
  largeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chart: {
    height: 92,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    position: "relative",
  },
  bpLegend: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  bpChart: {
    marginTop: 9,
    position: "relative",
    overflow: "hidden",
  },
  bpGoalBand: { position: "absolute", left: 0, right: 0 },
  chartSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    transformOrigin: "left center",
    zIndex: 2,
  },
  chartDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 3,
  },
  barSlot: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
  },
  bar: {
    flex: 1,
    minHeight: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    opacity: 0.8,
  },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    zIndex: 2,
  },
  goalLabel: {
    position: "absolute",
    right: 0,
    top: -12,
    fontSize: 7,
    fontWeight: "900",
  },
  secondaryGoalLabel: { left: 0, right: undefined },
  trackingSince: { fontSize: 8, fontWeight: "800", marginTop: 8 },
  skipToday: { minHeight: 40, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  skipTodayText: { fontSize: 9, fontWeight: "900" },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
    borderTopWidth: 1,
    marginTop: 13,
    paddingTop: 11,
  },
  stat: { width: "33.333%", paddingRight: 6 },
  statValue: { fontSize: 12, fontWeight: "900" },
  statLabel: { fontSize: 7, marginTop: 2 },
  logHeader: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  section: { fontSize: 13, fontWeight: "900" },
  logButton: {
    height: 30,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logButtonText: { color: palette.white, fontSize: 9, fontWeight: "900" },
  entries: { gap: 7 },
  dateGroupHeader: {
    minHeight: 38,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateGroupMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  entry: { padding: 12 },
  entryTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  grow: { flex: 1 },
  entryTitle: { fontSize: 11, fontWeight: "900" },
  time: { fontSize: 8, marginTop: 3 },
  entryValue: { fontSize: 12, fontWeight: "900" },
  note: { fontSize: 9, lineHeight: 14, marginTop: 7 },
  image: { width: 92, height: 66, borderRadius: 10, marginTop: 8 },
  photoImageFrame: { width: "100%", height: 230, marginTop: 8 },
  photoImage: { width: "100%", height: "100%", borderRadius: 13 },
  photoToggle: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoCompare: { flexDirection: "row", gap: 7, marginTop: 7 },
  compareImageFrame: { flex: 1, height: 150 },
  compareImage: { width: "100%", height: "100%", borderRadius: 11 },
  compareButton: {
    height: 38,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  compareText: { fontSize: 9, fontWeight: "900" },
  empty: { fontSize: 10, textAlign: "center" },
  weekRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
