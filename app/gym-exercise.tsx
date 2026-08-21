import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useLocale, useLocalization } from "@/src/i18n";
import { localizeExerciseName, localizeMuscleLabel } from "@/src/i18n/domain";
import { DraftNumberInput } from "@/src/components/DraftNumberInput";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { dateKey, dateWithOffsetFrom, friendlyDate } from "@/src/domain/date";
import {
  averageGymRestSeconds,
  ExerciseObservation,
  exerciseHistory,
  exerciseIdentity,
  exerciseStats,
  formatGymDuration,
  totalGymRestSeconds,
} from "@/src/domain/gym";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

type Period = 7 | 30 | 0;

export default function GymExerciseScreen() {
  const params = useLocalSearchParams<{ key?: string; name?: string }>();
  const key = String(params.key ?? "");
  const fallbackName = String(params.name ?? "Exercise");
  const { state, setGymExerciseGoal } = useApp();
  const locale = useLocale();
  const { language } = useLocalization();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [period, setPeriod] = useState<Period>(30);
  const currentGoal = state.gymExerciseGoals?.[key];
  const [targetOneRepMax, setTargetOneRepMax] = useState(
    currentGoal?.targetOneRepMaxKg ?? 0,
  );
  const [targetWeight, setTargetWeight] = useState(
    currentGoal?.targetWeightKg ?? 0,
  );
  const [targetReps, setTargetReps] = useState(currentGoal?.targetReps ?? 0);
  const sessions = useMemo(() => state.gymSessions ?? [], [state.gymSessions]);
  const fullHistory = exerciseHistory(sessions, state.currentUserId, key);
  const cutoff =
    period === 0 ? "" : dateWithOffsetFrom(dateKey(), -(period - 1));
  const history = fullHistory.filter(
    (item) => !cutoff || item.localDate >= cutoff,
  );
  const stats = exerciseStats(
    sessions,
    state.currentUserId,
    key,
    state.gymExerciseGoals?.[key],
  );
  const name = fullHistory.at(-1)?.name ?? fallbackName;
  const localizedName = localizeExerciseName(language, { key, name });
  const muscles = [
    ...new Set(fullHistory.flatMap((item) => item.muscles)),
  ];
  const entries = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            session.userId === state.currentUserId &&
            (!cutoff || session.localDate >= cutoff),
        )
        .flatMap((session) =>
          session.exercises
            .filter((exercise) => exerciseIdentity(exercise) === key)
            .map((exercise) => ({ session, exercise })),
        )
        .sort(
          (a, b) =>
            b.session.localDate.localeCompare(a.session.localDate) ||
            b.session.recordedAt.localeCompare(a.session.recordedAt),
        ),
    [cutoff, key, sessions, state.currentUserId],
  );
  const trendCopy =
    stats.trend === "building"
      ? "Your recent estimated strength is at least 2% above the earlier best."
      : stats.trend === "steady"
        ? "No clear new estimated-strength best in at least four weeks."
        : stats.trend === "regressing"
          ? "Two recent estimates average at least 5% below the prior baseline. Recovery or technique may deserve attention."
          : "Complete at least four sessions across three weeks before HabHub labels a trend.";
  const trendColor =
    stats.trend === "building"
      ? palette.lime
      : stats.trend === "steady"
        ? palette.amber
        : stats.trend === "regressing"
          ? palette.red
          : colors.border;
  const averageRest = averageGymRestSeconds(
    entries.map(({ exercise }) => exercise),
  );

  function saveGoal() {
    setGymExerciseGoal(key, {
      targetOneRepMaxKg: targetOneRepMax || undefined,
      targetWeightKg: targetWeight || undefined,
      targetReps: targetReps || undefined,
    });
  }

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <PageHeader
        eyebrow="Workout progress"
        title={localizedName}
        translateTitle={false}
        subtitle={
          muscles.length
            ? muscles.map((muscle) => localizeMuscleLabel(language, muscle)).join(" · ")
            : "Personal training history"
        }
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />
      <View style={styles.periods}>
        <Chip label="7 days" selected={period === 7} onPress={() => setPeriod(7)} />
        <Chip label="30 days" selected={period === 30} onPress={() => setPeriod(30)} />
        <Chip label="All" selected={period === 0} onPress={() => setPeriod(0)} />
      </View>

      <TutorialTarget id="gym-exercise-progress">
      <Card style={[styles.trendCard, { borderColor: trendColor }]}>
        <View style={styles.trendHeading}>
          <View style={[styles.statusDot, { backgroundColor: trendColor }]} />
          <View style={styles.grow}>
            <Text style={[styles.trendTitle, { color: colors.ink }]}>
              {stats.trend === "learning"
                ? "Building your baseline"
                : stats.trend[0].toUpperCase() + stats.trend.slice(1)}
            </Text>
            <Text style={[styles.copy, { color: colors.muted }]}>{trendCopy}</Text>
          </View>
        </View>
        <ExerciseLineChart history={history} color={accent} locale={locale} />
      </Card>
      </TutorialTarget>

      <View style={styles.stats}>
        <Stat
          label="Best load"
          value={
            stats.bestWeight
              ? `${stats.bestWeight.toFixed(1)} kg × ${stats.repsAtBestWeight}`
              : "—"
          }
        />
        <Stat
          label="Est. 1RM"
          value={
            stats.bestOneRepMax
              ? `${stats.bestOneRepMax.toFixed(1)} kg`
              : "—"
          }
        />
        <Stat
          label="From baseline"
          value={
            stats.sessions > 1
              ? `${stats.improvement >= 0 ? "+" : ""}${stats.improvement.toFixed(1)}%`
              : "Learning"
          }
        />
        <Stat label="Sessions" value={String(stats.sessions)} />
        <Stat
          label={`Avg rest · ${period === 0 ? "all" : `${period}d`}`}
          value={averageRest ? formatGymDuration(averageRest) : "—"}
        />
      </View>

      <SectionHeader title="Your target" />
      <Card style={styles.goalCard}>
        <Text style={[styles.copy, { color: colors.muted }]}>
          Targets are motivational markers, not prescribed loads. Estimated 1RM
          is used only to compare your own trend.
        </Text>
        <View style={styles.goalFields}>
          <GoalField
            label="Est. 1RM kg"
            value={targetOneRepMax}
            onCommit={setTargetOneRepMax}
          />
          <GoalField
            label="Load kg"
            value={targetWeight}
            onCommit={setTargetWeight}
          />
          <GoalField
            label="Reps"
            value={targetReps}
            onCommit={(value) => setTargetReps(Math.round(value))}
          />
        </View>
        {targetOneRepMax > 0 ? (
          <View style={styles.goalProgress}>
            <View style={styles.goalProgressHeading}>
              <Text style={[styles.smallStrong, { color: colors.ink }]}>
                {Math.round(
                  Math.min(1, stats.bestOneRepMax / targetOneRepMax) * 100,
                )}
                %
              </Text>
              <Text style={[styles.small, { color: colors.muted }]}>
                {Math.max(0, targetOneRepMax - stats.bestOneRepMax).toFixed(1)} kg
                remaining
              </Text>
            </View>
            <ProgressBar
              progress={stats.bestOneRepMax / targetOneRepMax}
              color={accent}
            />
          </View>
        ) : null}
        <Button label="Save target" icon="checkmark" onPress={saveGoal} />
      </Card>

      <SectionHeader title="Entries" />
      <Card style={styles.entries}>
        {entries.length ? (
          entries.map(({ session, exercise }, index) => {
            const completed = exercise.sets.filter((set) => set.completed);
            return (
              <View
                key={`${session.id}:${exercise.id}`}
                style={[
                  styles.entry,
                  index > 0 && {
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={styles.entryHeading}>
                  <View style={styles.grow}>
                    <Text translate={false} style={[styles.entryDate, { color: colors.ink }]}>
                      {friendlyDate(session.localDate, locale)} · {session.name}
                    </Text>
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {completed.length} completed set
                      {completed.length === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Ionicons name="barbell-outline" size={17} color={accent} />
                </View>
                <Text style={[styles.setText, { color: colors.ink }]}>
                  {completed.length
                    ? completed
                        .map(
                          (set, setIndex) =>
                            `${set.weightKg} kg × ${set.reps}${
                              set.restSeconds
                                ? `\nSet ${setIndex + 1} rest · ${formatGymDuration(set.restSeconds)}`
                                : ""
                            }`,
                        )
                        .join("\n")
                    : "Planned — no completed sets"}
                </Text>
                {exercise.restAfterSeconds ? (
                  <View
                    style={[
                      styles.restEntry,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons
                      name="walk-outline"
                      size={13}
                      color={accent}
                    />
                    <Text style={[styles.smallStrong, { color: colors.ink }]}>
                      Between exercises ·{" "}
                      {formatGymDuration(exercise.restAfterSeconds)}
                    </Text>
                  </View>
                ) : null}
                {totalGymRestSeconds([exercise]) ? (
                  <Text style={[styles.small, { color: colors.muted }]}>
                    Total logged rest for this exercise ·{" "}
                    {formatGymDuration(totalGymRestSeconds([exercise]))}
                  </Text>
                ) : null}
                {exercise.notes ? (
                  <Text translate={false} style={[styles.copy, { color: colors.muted }]}>
                    {exercise.notes}
                  </Text>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No entries in this period.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

function ExerciseLineChart({
  history,
  color,
  locale,
}: {
  history: ExerciseObservation[];
  color: string;
  locale: string;
}) {
  const colors = useAppColors();
  const [width, setWidth] = useState(0);
  const height = 126;
  const values = history.map((item) => item.estimatedOneRepMaxKg);
  const min = Math.max(0, Math.min(...values, 0) * 0.9);
  const max = Math.max(...values, 1) * 1.08;
  const points = values.map((value, index) => ({
    x:
      values.length === 1
        ? width / 2
        : (index / Math.max(1, values.length - 1)) * width,
    y: height - ((value - min) / Math.max(1, max - min)) * height,
  }));
  return (
    <View>
      <View
        style={[
          styles.chart,
          { height, borderBottomColor: colors.border },
        ]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <View
            key={ratio}
            style={[
              styles.gridLine,
              { top: height * ratio, borderColor: colors.border },
            ]}
          />
        ))}
        {points.slice(1).map((point, index) => {
          const previous = points[index];
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          return (
            <View
              key={`line-${index}`}
              style={[
                styles.line,
                {
                  left: previous.x,
                  top: previous.y,
                  width: Math.sqrt(dx * dx + dy * dy),
                  backgroundColor: color,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          );
        })}
        {points.map((point, index) => (
          <View
            key={`dot-${index}`}
            style={[
              styles.dot,
              {
                left: point.x - 4,
                top: point.y - 4,
                backgroundColor: color,
                borderColor: colors.card,
              },
            ]}
          />
        ))}
        {!history.length ? (
          <Text style={[styles.chartEmpty, { color: colors.muted }]}>
            Complete sets to build this line.
          </Text>
        ) : null}
      </View>
      {history.length ? (
        <View style={styles.chartLabels}>
          <Text style={[styles.small, { color: colors.muted }]}>
            {friendlyDate(history[0].localDate, locale)}
          </Text>
          <Text style={[styles.smallStrong, { color }]}>
            {values.at(-1)?.toFixed(1)} kg estimated
          </Text>
          <Text style={[styles.small, { color: colors.muted }]}>
            {friendlyDate(history.at(-1)!.localDate, locale)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.small, { color: colors.muted }]}>{label}</Text>
    </Card>
  );
}

function GoalField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.goalField}>
      <Text style={[styles.small, { color: colors.muted }]}>{label}</Text>
      <DraftNumberInput
        value={value}
        onCommit={onCommit}
        keyboardType="decimal-pad"
        style={[
          styles.goalInput,
          { color: colors.ink, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: "row", gap: 6, marginBottom: 4 },
  grow: { flex: 1, minWidth: 0 },
  trendCard: { gap: 14 },
  trendHeading: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  trendTitle: { fontSize: 13, fontWeight: "900" },
  copy: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  chart: {
    position: "relative",
    overflow: "hidden",
    borderBottomWidth: 1,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  line: {
    position: "absolute",
    height: 2,
    borderRadius: 2,
    transformOrigin: "left center",
  },
  dot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
  },
  chartEmpty: {
    position: "absolute",
    alignSelf: "center",
    top: 50,
    fontSize: 9,
  },
  chartLabels: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
  },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  stat: { width: "48%", flexGrow: 1, padding: 10 },
  statValue: { fontSize: 15, fontWeight: "900" },
  small: { fontSize: 8, lineHeight: 12 },
  smallStrong: { fontSize: 8, fontWeight: "900" },
  goalCard: { gap: 10 },
  goalFields: { flexDirection: "row", gap: 7 },
  goalField: { flex: 1, gap: 4 },
  goalInput: {
    borderWidth: 1,
    borderRadius: 9,
    height: 38,
    paddingHorizontal: 8,
    fontSize: 10,
    fontWeight: "800",
  },
  goalProgress: { gap: 5 },
  goalProgressHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  entries: { paddingVertical: 2, paddingHorizontal: 11 },
  entry: { paddingVertical: 11, gap: 5 },
  entryHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryDate: { fontSize: 10, fontWeight: "900" },
  setText: { fontSize: 9, lineHeight: 14, fontWeight: "700" },
  restEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    minHeight: 26,
  },
  empty: { fontSize: 9, textAlign: "center", paddingVertical: 20 },
});
