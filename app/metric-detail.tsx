import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  deficitRealityCheckAtDate,
  effectiveGoalTarget,
  formatMetricValue,
  goalReached,
  safeMetricValue,
  weeklyDeficitBalance,
} from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { MetricDefinition } from "@/src/types";

type Period = "day" | "7" | "30";
export default function TrackerDetail() {
  const { metric: trackerId, date } = useLocalSearchParams<{
    metric: string;
    date?: string;
  }>();
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [day, setDay] = useState(date ?? dateKey());
  const [period, setPeriod] = useState<Period>("day");
  const weekly =
    trackerId === "weekly_deficit_balance" || trackerId === "weekly_deficit";
  const tracker = state.metrics.find((item) => item.id === trackerId);
  const dates = useMemo(
    () =>
      Array.from(
        { length: period === "30" ? 30 : period === "7" ? 7 : 1 },
        (_, index) =>
          dateWithOffsetFrom(
            day,
            index - (period === "30" ? 29 : period === "7" ? 6 : 0),
          ),
      ),
    [day, period],
  );
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
  const entries = state.entries
    .filter(
      (entry) =>
        entry.userId === state.currentUserId &&
        entry.metricId === tracker.id &&
        entry.localDate === day,
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const dayPhotos =
    tracker.dataType === "photo"
      ? state.photos.filter(
          (photo) =>
            photo.userId === state.currentUserId && photo.localDate === day,
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
  const values = dates.map((date) =>
    safeMetricValue(state, tracker, state.currentUserId, date),
  );
  const loggedDates = dates.filter((date) => hasData(state, tracker, date));
  const average = loggedDates.length
    ? loggedDates.reduce(
        (sum, date) =>
          sum + safeMetricValue(state, tracker, state.currentUserId, date),
        0,
      ) / loggedDates.length
    : 0;
  const streaks = streakStats(state, tracker, day);
  const applicable = tracker.id !== "deficit" || hasFood(state, day);
  const current = safeMetricValue(state, tracker, state.currentUserId, day);
  const target = effectiveGoalTarget(state, tracker, state.currentUserId, day);
  const reality =
    tracker.id === "weight"
      ? deficitRealityCheckAtDate(state, state.currentUserId, day)
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
            selected={period === "day"}
            onPress={() => setPeriod("day")}
          />
          <Chip
            label="7 days"
            selected={period === "7"}
            onPress={() => setPeriod("7")}
          />
          <Chip
            label="30 days"
            selected={period === "30"}
            onPress={() => setPeriod("30")}
          />
        </View>
        <View style={styles.dayNav}>
          <Pressable onPress={() => setDay(dateWithOffsetFrom(day, -1))} style={[styles.navButton,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <Ionicons name="chevron-back" size={25} color={accent} />
          </Pressable>
          <Text style={[styles.day, { color: colors.ink }]}>
            {day === dateKey() ? "Today" : day}
          </Text>
          <Pressable
            disabled={day >= dateKey()}
            onPress={() => setDay(dateWithOffsetFrom(day, 1))}
            style={[styles.navButton,{backgroundColor:colors.card,borderColor:colors.border}]}
          >
            <Ionicons
              name="chevron-forward"
              size={25}
              color={day >= dateKey() ? colors.faint : accent}
            />
          </Pressable>
        </View>
      </View>
      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <View>
            <Text style={[styles.label, { color: colors.faint }]}>
              {period === "day" ? "CURRENT" : `${period}-DAY AVERAGE`}
            </Text>
            <Text style={[styles.value, { color: colors.ink }]}>
              {!applicable
                ? "Not available"
                : formatMetricValue(
                    tracker,
                    period === "day" ? current : average,
                  )}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {summaryLine(state, tracker, day, current, target, applicable)}
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
        {period !== "day" ? (
          <Trend
            values={values}
            tracker={tracker}
            target={target}
            colors={colors}
          />
        ) : null}
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
          <Stat
            label="Goals reached"
            value={`${dates.filter((date) => goalReached(tracker, safeMetricValue(state, tracker, state.currentUserId, date), effectiveGoalTarget(state, tracker, state.currentUserId, date))).length}/${dates.length}`}
            colors={colors}
          />
        </View>
      </Card>
      {reality && reality.status !== "insufficient" ? (
        <Card>
          <Text style={[styles.entryTitle, { color: colors.ink }]}>
            Weight and reporting
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {reality.status === "aligned"
              ? "Your measured change broadly matches your reported energy balance."
              : reality.status === "noise"
                ? "Normal scale variation is larger than the current signal. Keep logging."
                : `Measured change and reported energy differ across ${Math.round(reality.days)} days.`}
          </Text>
          <Text style={[styles.entryValue, { color: accent }]}>
            {reality.weightChangeKg >= 0 ? "−" : "+"}
            {Math.abs(reality.weightChangeKg).toFixed(1)} kg ·{" "}
            {Math.round(reality.actualDailyDeficit)} kcal/day measured
          </Text>
        </Card>
      ) : null}
      <View style={styles.logHeader}>
        <Text style={[styles.section, { color: colors.ink }]}>
          {period === "day" ? "Entries" : "Selected day"}
        </Text>
        {tracker.manualEntry !== false && tracker.dataType !== "calculated" ? (
          <Pressable
            onPress={() =>
              router.push({
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
        {entries.map((entry) => (
          <Card key={entry.id} style={styles.entry}>
            <View style={styles.entryTop}>
              <View style={styles.grow}>
                <Text style={[styles.entryTitle, { color: colors.ink }]}>
                  {entry.label || tracker.name}
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
                {typeof entry.value === "number"
                  ? formatMetricValue(tracker, entry.value)
                  : String(entry.value)}
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
        ))}
        {dayPhotos.map((photo)=><Card key={photo.id} style={styles.entry}><Text style={[styles.entryTitle,{color:colors.ink}]}>{photo.caption||'Progress photo'}</Text><Text style={[styles.time,{color:colors.faint}]}>{photo.localDate}</Text><ExpandableImage uri={photo.uri} thumbnailStyle={styles.photoImage}/>{olderPhoto?<><Text style={[styles.note,{color:colors.muted}]}>Automatically compared with {olderPhoto.localDate}</Text><View style={styles.photoCompare}><ExpandableImage uri={photo.uri} thumbnailStyle={styles.compareImage}/><ExpandableImage uri={olderPhoto.uri} thumbnailStyle={styles.compareImage}/></View><Pressable onPress={()=>router.push({pathname:'/day/[date]',params:{date:day,metrics:tracker.id}} as never)} style={[styles.compareButton,{borderColor:accent}]}><Ionicons name="download-outline" size={16} color={accent}/><Text style={[styles.compareText,{color:accent}]}>Open comparison & export</Text></Pressable></>:null}</Card>)}
      </View>
      {!entries.length&&!dayPhotos.length ? (
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
      <View style={styles.dayNav}>
        <Pressable onPress={() => setDay(dateWithOffsetFrom(day, -7))}>
          <Ionicons name="chevron-back" size={19} color={accent} />
        </Pressable>
        <Text style={[styles.day, { color: colors.ink }]}>
          Week of {balance.startDate}
        </Text>
        <Pressable onPress={() => setDay(dateWithOffsetFrom(day, 7))}>
          <Ionicons name="chevron-forward" size={19} color={accent} />
        </Pressable>
      </View>
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
          const valid = hasFood(state, date);
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
}: {
  values: number[];
  tracker: MetricDefinition;
  target: number;
  colors: ReturnType<typeof useAppColors>;
}) {
  const max = Math.max(...values, target, 1);
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
        <Text style={[styles.goalLabel, { color: tracker.color }]}>goal</Text>
      </View>
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
        </View>
      ))}
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
function hasFood(state: ReturnType<typeof useApp>["state"], day: string) {
  return state.entries.some(
    (entry) =>
      entry.userId === state.currentUserId &&
      entry.metricId === "food" &&
      entry.localDate === day,
  );
}
function hasData(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
) {
  if(tracker.dataType==='photo')return state.photos.some((photo)=>photo.userId===state.currentUserId&&photo.localDate===day);
  return tracker.dataType === "calculated"
    ? tracker.id === "deficit"
      ? hasFood(state, day)
      : true
    : state.entries.some(
        (entry) =>
          entry.userId === state.currentUserId &&
          entry.metricId === tracker.id &&
          entry.localDate === day,
      );
}
function streakStats(
  state: ReturnType<typeof useApp>["state"],
  tracker: MetricDefinition,
  day: string,
) {
  let current = 0,
    best = 0,
    run = 0;
  for (let i = 89; i >= 0; i--) {
    const date = dateWithOffsetFrom(day, -i);
    const met =
      tracker.goalEnabled !== false &&
      goalReached(
        tracker,
        safeMetricValue(state, tracker, state.currentUserId, date),
        effectiveGoalTarget(state, tracker, state.currentUserId, date),
      );
    run = met ? run + 1 : 0;
    best = Math.max(best, run);
  }
  for (let i = 0; i < 90; i++) {
    const date = dateWithOffsetFrom(day, -i);
    if (
      goalReached(
        tracker,
        safeMetricValue(state, tracker, state.currentUserId, date),
        effectiveGoalTarget(state, tracker, state.currentUserId, date),
      )
    )
      current++;
    else break;
  }
  return { current, best };
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
  if(tracker.id==='weight'){
    const first=state.entries.filter((entry)=>entry.userId===state.currentUserId&&entry.metricId==='weight').sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt))[0];const change=first?value-Number(first.value):0;
    return first?`${change>0?'+':''}${change.toFixed(1)} kg from starting weight`:'Add a first weigh-in to establish your baseline';
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
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  periods: { flexDirection: "row", gap: 5 },
  dayNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  navButton:{width:42,height:42,borderWidth:1,borderRadius:14,alignItems:'center',justifyContent:'center'},
  day: { fontSize: 10, fontWeight: "900" },
  summary: { marginBottom: 9 },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  label: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  value: { fontSize: 25, fontWeight: "900", marginTop: 4 },
  sub: { fontSize: 9, lineHeight: 14, marginTop: 3 },
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
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: {
    width: "100%",
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
  stats: {
    flexDirection: "row",
    borderTopWidth: 1,
    marginTop: 13,
    paddingTop: 11,
  },
  stat: { flex: 1 },
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
  entry: { padding: 12 },
  entryTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  grow: { flex: 1 },
  entryTitle: { fontSize: 11, fontWeight: "900" },
  time: { fontSize: 8, marginTop: 3 },
  entryValue: { fontSize: 12, fontWeight: "900" },
  note: { fontSize: 9, lineHeight: 14, marginTop: 7 },
  image: { width: 92, height: 66, borderRadius: 10, marginTop: 8 },
  photoImage:{width:'100%',height:230,borderRadius:13,marginTop:8},photoCompare:{flexDirection:'row',gap:7,marginTop:7},compareImage:{flex:1,height:150,borderRadius:11},compareButton:{height:38,borderWidth:1,borderRadius:12,marginTop:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},compareText:{fontSize:9,fontWeight:'900'},
  empty: { fontSize: 10, textAlign: "center" },
  weekRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
