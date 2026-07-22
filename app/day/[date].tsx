import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
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
  deficitRealityCheckAtDate,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  safeMetricValue,
  trackedGoalSummary,
} from "@/src/domain/metrics";
import { imageSourceUri } from "@/src/domain/media";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  AppState,
  MetricDefinition,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

const TRACKED = "tracked_goals";

export default function DayDetail() {
  const params = useLocalSearchParams<{ date: string; metrics?: string }>();
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [day, setDay] = useState(params.date ?? dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const requested = (params.metrics ?? "").split(",").filter(Boolean);
  const explicit = requested.length > 0;
  const dayEntries = state.entries.filter(
    (entry) => entry.userId === state.currentUserId && entry.localDate === day,
  );
  const dayPhotos = state.photos.filter(
    (photo) => photo.userId === state.currentUserId && photo.localDate === day,
  );
  const loggedIds = [...new Set(dayEntries.map((entry) => entry.metricId))];
  if (dayPhotos.length) loggedIds.push("progress_photo");
  const trackedSummary = trackedGoalSummary(state, state.currentUserId, day);
  const expandedRequested = [
    ...new Set([
      ...requested.filter((id) => id !== TRACKED),
      ...(requested.includes(TRACKED)
        ? trackedSummary.metrics.map((metric) => metric.id)
        : []),
    ]),
  ];
  const initialIds = explicit
    ? expandedRequested.filter((id) => loggedIds.includes(id))
    : loggedIds;
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const available = state.metrics.filter((metric) =>
    loggedIds.includes(metric.id),
  );
  const selected = state.metrics
    .filter(
      (metric) =>
        selectedIds.includes(metric.id) && loggedIds.includes(metric.id),
    )
    .sort((a, b) => a.order - b.order);
  const showTracked = trackedSummary.total > 0;
  const alignment = deficitRealityCheckAtDate(state, state.currentUserId, day);
  const weightLogged = dayEntries.some((entry) => entry.metricId === "weight");
  const otherPhotoDates = [
    ...new Set(
      state.photos
        .filter(
          (photo) =>
            photo.userId === state.currentUserId && photo.localDate < day,
        )
        .map((photo) => photo.localDate),
    ),
  ]
    .sort()
    .reverse();
  const defaultPhotoDate = otherPhotoDates[0] ?? "";
  const [compareDate, setCompareDate] = useState<string[]>([]);
  const comparisonPhotos = compareDate.length
    ? state.photos.filter(
        (photo) =>
          photo.userId === state.currentUserId &&
          photo.localDate === compareDate[0],
      )
    : [];
  const collage = [dayPhotos[0], comparisonPhotos[0]].filter(
    Boolean,
  ) as PhotoUpdate[];
  const collageRef = useRef<ViewShot>(null);
  const Share = {
    share: async (_options: { message: string }) => {
      const uri = await collageRef.current?.capture?.();
      if (!uri) throw new Error("Could not create the comparison image.");
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Save or share progress comparison",
      });
    },
  };

  useEffect(
    () => setCompareDate(defaultPhotoDate ? [defaultPhotoDate] : []),
    [day, defaultPhotoDate],
  );

  function changeDay(next: string) {
    setDay(next);
    setCompareDate([]);
    const entries = state.entries.filter(
      (entry) =>
        entry.userId === state.currentUserId && entry.localDate === next,
    );
    const ids = [...new Set(entries.map((entry) => entry.metricId))];
    if (
      state.photos.some(
        (photo) =>
          photo.userId === state.currentUserId && photo.localDate === next,
      )
    )
      ids.push("progress_photo");
    setSelectedIds(ids);
  }

  function nearestWeight(photoDate: string) {
    const entries = state.entries
      .filter(
        (entry) =>
          entry.userId === state.currentUserId && entry.metricId === "weight",
      )
      .sort(
        (a, b) =>
          Math.abs(
            new Date(`${a.localDate}T12:00:00`).getTime() -
              new Date(`${photoDate}T12:00:00`).getTime(),
          ) -
          Math.abs(
            new Date(`${b.localDate}T12:00:00`).getTime() -
              new Date(`${photoDate}T12:00:00`).getTime(),
          ),
      );
    return entries[0]
      ? `${Number(entries[0].value).toFixed(1)} kg${entries[0].localDate === photoDate ? "" : " nearby"}`
      : "No weight log";
  }

  async function saveCollage() {
    if (collage.length < 2) return;
    if (Platform.OS !== "web") {
      await Share.share({
        message: `MetricRally comparison\n${collage.map((photo) => `${photo.localDate} · ${nearestWeight(photo.localDate)}`).join("\n")}`,
      });
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#F5F7F2";
      context.fillRect(0, 0, 1200, 850);
      context.fillStyle = "#17211B";
      context.font = "bold 36px sans-serif";
      context.fillText("MetricRally progress comparison", 45, 60);
      const images = await Promise.all(
        collage.map(
          (photo) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = document.createElement("img");
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error("Photo unavailable"));
              image.src = imageSourceUri(photo.uri);
            }),
        ),
      );
      images.forEach((image, index) => {
        const x = 45 + index * 565;
        context.drawImage(image, x, 95, 540, 620);
        context.textAlign = "center";
        context.fillStyle = "#17211B";
        context.font = "bold 24px sans-serif";
        context.fillText(collage[index].localDate, x + 270, 760);
        context.fillStyle = "#176B4D";
        context.font = "bold 19px sans-serif";
        context.fillText(nearestWeight(collage[index].localDate), x + 270, 795);
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `metric-rally-${day}-comparison.png`;
        link.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch (error) {
      Alert.alert(
        "Could not save collage",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <PageHeader
        eyebrow="Daily detail"
        title={friendlyDate(day)}
        subtitle="Only items logged on this day appear by default."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.dateCard}>
        <View style={styles.dateNav}>
          <Pressable
            onPress={() => changeDay(dateWithOffsetFrom(day, -1))}
            style={[styles.arrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-back" size={19} color={colors.ink} />
          </Pressable>
          <Pressable
            onPress={() => setCalendarOpen((value) => !value)}
            style={styles.dateButton}
          >
            <Ionicons
              name="calendar-outline"
              size={17}
              color={accent}
            />
            <Text style={[styles.dateText, { color: colors.ink }]}>
              {friendlyDate(day)}
            </Text>
            <Ionicons
              name={calendarOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.muted}
            />
          </Pressable>
          <Pressable
            onPress={() => changeDay(dateWithOffsetFrom(day, 1))}
            style={[styles.arrow, { backgroundColor: colors.canvas }]}
          >
            <Ionicons name="chevron-forward" size={19} color={colors.ink} />
          </Pressable>
        </View>
        {calendarOpen ? (
          <View style={[styles.calendar, { borderTopColor: colors.border }]}>
            <MonthCalendar
              monthDate={day}
              selectedDate={day}
              onMonthChange={setDay}
              onSelect={(date) => {
                changeDay(date);
                setCalendarOpen(false);
              }}
            />
          </View>
        ) : null}
      </Card>
      <MetricSelector
        items={available.map((metric) => ({
          id: metric.id,
          label: metric.name,
          icon: metric.icon as keyof typeof Ionicons.glyphMap,
          color: metric.color,
          sublabel: dayEntries.some((entry) => entry.metricId === metric.id)
            ? "Logged on this day"
            : "Selected goal",
        }))}
        selectedIds={selectedIds}
        onChange={setSelectedIds}
        title="What to show"
        emptyLabel="No logs on this day"
      />
      {showTracked ? <TrackedCard state={state} day={day} /> : null}
      <SectionHeader title="Selected logs" />
      <View style={styles.metrics}>
        {selected.map((metric) => {
          const value = safeMetricValue(
            state,
            metric,
            state.currentUserId,
            day,
          );
          const target = effectiveGoalTarget(
            state,
            metric,
            state.currentUserId,
            day,
          );
          const reached = goalReached(metric, value, target);
          const entries = dayEntries.filter(
            (entry) => entry.metricId === metric.id,
          );
          return (
            <DayTracker
              key={metric.id}
              metric={metric}
              value={value}
              target={target}
              reached={reached}
              entries={entries}
              day={day}
            />
          );
        })}
      </View>
      {weightLogged ? <AlignmentCard status={alignment} /> : null}
      {dayPhotos.length ? (
        <>
          <Pressable onPress={() => setPhotosOpen((open) => !open)}>
            <Card style={styles.photoToggle}>
              <Ionicons
                name="images-outline"
                size={18}
                color={accent}
              />
              <Text style={[styles.trackedTitle, { color: colors.ink }]}>
                Photos from this day · {dayPhotos.length}
              </Text>
              <Ionicons
                name={photosOpen ? "chevron-up" : "chevron-down"}
                size={17}
                color={colors.muted}
              />
            </Card>
          </Pressable>
          {photosOpen ? (
            <>
              <View style={styles.dayPhotos}>
                {dayPhotos.map((photo) => (
                  <Card key={photo.id} style={styles.photoCard}>
                    <ExpandableImage
                      uri={photo.uri}
                      caption={photo.caption}
                      thumbnailStyle={styles.dayPhoto}
                    />
                    <Text style={[styles.photoCaption, { color: colors.ink }]}>
                      {photo.caption || "Progress photo"}
                    </Text>
                    <Text style={[styles.weight, { color: accent }]}>
                      {photo.localDate} · {nearestWeight(photo.localDate)}
                    </Text>
                  </Card>
                ))}
              </View>
              {otherPhotoDates.length ? (
                <>
                  <SectionHeader title="Compare with another date" />
                  <MetricSelector
                    items={otherPhotoDates.map((date) => ({
                      id: date,
                      label: date,
                      icon: "calendar-outline",
                      sublabel: `${state.photos.filter((photo) => photo.userId === state.currentUserId && photo.localDate === date).length} photo(s)`,
                    }))}
                    selectedIds={compareDate}
                    onChange={setCompareDate}
                    multiple={false}
                    title="Older photo date"
                  />
                </>
              ) : null}
              {collage.length === 2 ? (
                <Card style={styles.comparison}>
                  <ViewShot
                    ref={collageRef}
                    options={{ format: "png", quality: 1 }}
                    style={styles.capture}
                  >
                    <Text preserveColor style={styles.captureTitle}>
                      MetricRally progress comparison
                    </Text>
                    <View style={styles.compareGrid}>
                      {collage.map((photo) => (
                        <View key={photo.id} style={styles.compareItem}>
                          <ExpandableImage
                            uri={photo.uri}
                            thumbnailStyle={styles.compareImage}
                          />
                          <Text preserveColor style={styles.photoCaption}>
                            {photo.localDate}
                          </Text>
                          <Text preserveColor style={styles.weight}>
                            {nearestWeight(photo.localDate)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ViewShot>
                  <Button
                    label={
                      Platform.OS === "web"
                        ? "Download collage"
                        : "Save or share collage"
                    }
                    icon={
                      Platform.OS === "web"
                        ? "download-outline"
                        : "share-outline"
                    }
                    variant="ghost"
                    onPress={saveCollage}
                  />
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function DayTracker({
  metric,
  value,
  target,
  reached,
  entries,
  day,
}: {
  metric: MetricDefinition;
  value: number;
  target: number;
  reached: boolean;
  entries: MetricEntry[];
  day: string;
}) {
  const [open, setOpen] = useState(false);
  const colors = useAppColors();
  return (
    <Card style={styles.metricCard}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.metricHeader}
      >
        <View
          style={[styles.metricIcon, { backgroundColor: `${metric.color}18` }]}
        >
          <Ionicons
            name={metric.icon as keyof typeof Ionicons.glyphMap}
            size={20}
            color={metric.color}
          />
        </View>
        <View style={styles.grow}>
          <Text style={[styles.metricName, { color: colors.muted }]}>
            {metric.name}
          </Text>
          <Text style={[styles.metricValue, { color: colors.ink }]}>
            {metric.dataType === "text"
              ? String(entries.at(-1)?.value ?? "No entry")
              : formatMetricValue(metric, value)}
          </Text>
        </View>
        {metric.goalEnabled !== false ? (
          <Chip label={reached ? "Goal met" : "Not met"} selected={reached} />
        ) : null}
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={17}
          color={colors.faint}
        />
      </Pressable>
      {open ? (
        <>
          {metric.dataType !== "text" && metric.goalEnabled !== false ? (
            <ProgressBar
              progress={goalProgress(metric, value, target)}
              color={metric.color}
            />
          ) : null}
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} metric={metric} />
          ))}
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/metric-detail" as never,
                params: { metric: metric.id, date: day },
              } as never)
            }
            style={styles.openTracker}
          >
            <Text style={[styles.nutrition, { color: metric.color }]}>
              Open history and trends
            </Text>
            <Ionicons name="arrow-forward" size={14} color={metric.color} />
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

function TrackedCard({ state, day }: { state: AppState; day: string }) {
  const summary = trackedGoalSummary(state, state.currentUserId, day);
  const [open, setOpen] = useState(false);
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Card style={[styles.tracked, { backgroundColor: colors.primarySoft }]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.trackedTop}
      >
        <Ionicons name="checkmark-done" size={22} color={accent} />
        <View style={styles.grow}>
          <Text style={[styles.trackedTitle, { color: colors.ink }]}>Tracked goals</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {summary.met}/{summary.total} goals completed on this date
          </Text>
        </View>
        <Text style={[styles.fraction, { color: accent }]}>
          {summary.met}/{summary.total}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.muted}
        />
      </Pressable>
      {open ? (
        <View style={styles.goalChips}>
          {summary.metrics.map((metric) => {
            const unavailable = summary.unavailable.some(
              (item) => item.id === metric.id,
            );
            const reached = goalReached(
              metric,
              safeMetricValue(state, metric, state.currentUserId, day),
              effectiveGoalTarget(state, metric, state.currentUserId, day),
            );
            return (
              <Chip
                key={metric.id}
                label={`${metric.name}: ${unavailable ? "not available" : reached ? "met" : "not met"}`}
                selected={!unavailable && reached}
              />
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function EntryRow({
  entry,
  metric,
}: {
  entry: MetricEntry;
  metric: MetricDefinition;
}) {
  const colors = useAppColors();
  const label =
    typeof entry.value === "string"
      ? entry.value
      : formatMetricValue(
          metric,
          entry.value === true
            ? 1
            : entry.value === false
              ? 0
              : Number(entry.value),
        );
  return (
    <View
      style={[
        styles.entry,
        { borderLeftColor: metric.color, backgroundColor: `${metric.color}0D` },
      ]}
    >
      <View style={styles.grow}>
        <View style={styles.entryMetric}>
          <Ionicons
            name={metric.icon as keyof typeof Ionicons.glyphMap}
            size={13}
            color={metric.color}
          />
          <Text style={[styles.entryMetricText, { color: metric.color }]}>
            {metric.name}
          </Text>
        </View>
        <View style={styles.entryTop}>
          <Text style={[styles.entryValue, { color: metric.color }]}>
            {label}
          </Text>
          <Text style={[styles.entryTime, { color: colors.faint }]}>
            {new Date(entry.recordedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
        {entry.label ? (
          <Text style={[styles.entryLabel, { color: colors.ink }]}>
            {entry.nutrition?.mealType
              ? `${entry.nutrition.mealType[0].toUpperCase()}${entry.nutrition.mealType.slice(1)} · `
              : ""}
            {entry.label}
          </Text>
        ) : null}
        {entry.note ? (
          <Text style={[styles.entryNote, { color: colors.muted }]}>
            {entry.note}
          </Text>
        ) : null}
        {entry.nutrition ? (
          <Text style={[styles.nutrition, { color: colors.primary }]}>
            {[
              ["Protein", entry.nutrition.proteinG, "g"],
              ["Fat", entry.nutrition.fatG, "g"],
              ["Carbs", entry.nutrition.carbsG, "g"],
              ["Fiber", entry.nutrition.fiberG, "g"],
              ["Sodium", entry.nutrition.sodiumMg, "mg"],
            ]
              .filter((item) => item[1])
              .map((item) => `${item[0]} ${Math.round(Number(item[1]) * 10) / 10}${item[2]}`)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
      {entry.imageUri ? (
        <ExpandableImage
          uri={entry.imageUri}
          thumbnailStyle={styles.entryImage}
        />
      ) : null}
    </View>
  );
}

function AlignmentCard({
  status,
}: {
  status: ReturnType<typeof deficitRealityCheckAtDate>;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const copy = {
    aligned: "Scale change roughly matches the reported deficit.",
    reported_ahead:
      "Reported deficit is ahead of the scale trend; water shifts or missing intake may explain it.",
    scale_ahead:
      "Scale change is ahead of the reported deficit; short-term water shifts are common.",
    noise: "Weight change is within the normal fluctuation margin.",
    insufficient: "A previous weight entry is needed for comparison.",
  }[status.status];
  return (
    <>
      <SectionHeader title="Reporting alignment" />
      <Card style={styles.alignment}>
        <Ionicons
          name={
            status.status === "aligned"
              ? "checkmark-circle"
              : "analytics-outline"
          }
          size={24}
          color={accent}
        />
        <View style={styles.grow}>
          <Text style={[styles.alignmentTitle, { color: colors.ink }]}>
            {status.status === "aligned"
              ? "Reported and scale trends align"
              : "Estimate from this weight entry"}
          </Text>
          <Text style={[styles.entryNote, { color: colors.muted }]}>
            {copy}
          </Text>
          {status.status !== "insufficient" ? (
            <Text style={[styles.nutrition, { color: accent }]}>
              Reported {Math.round(status.reportedDailyDeficit)} kcal/day ·
              scale estimate {Math.round(status.actualDailyDeficit)} kcal/day
            </Text>
          ) : null}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  photoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 10,
  },
  dateCard: { padding: 9, marginBottom: 9 },
  dateNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrow: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  dateButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 38,
  },
  dateText: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  calendar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 11,
    marginTop: 9,
  },
  tracked: { marginTop: 10, backgroundColor: "#F5FAF7" },
  trackedTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1 },
  trackedTitle: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  meta: { color: palette.muted, fontSize: 9, marginTop: 2 },
  fraction: { color: palette.primary, fontSize: 18, fontWeight: "900" },
  goalChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  metrics: { gap: 9 },
  metricCard: { padding: 14 },
  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 10,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  metricName: { color: palette.muted, fontSize: 9, fontWeight: "800" },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
  },
  openTracker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
  },
  entry: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 13,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
  },
  entryMetric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  entryMetricText: {
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  entryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  entryValue: { fontSize: 12, fontWeight: "900" },
  entryTime: { color: palette.faint, fontSize: 8 },
  entryLabel: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 4,
  },
  entryNote: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },
  nutrition: {
    color: palette.primary,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  entryImage: { width: 62, height: 62, borderRadius: 10 },
  alignment: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  alignmentTitle: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  dayPhotos: { gap: 9 },
  photoCard: { padding: 12 },
  dayPhoto: { width: 150, height: 150, borderRadius: 14 },
  photoCaption: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 6,
  },
  weight: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 2,
  },
  comparison: { marginTop: 10 },
  capture: {
    backgroundColor: "#F5F7F2",
    padding: 10,
    borderRadius: 12,
    marginBottom: 10,
  },
  captureTitle: {
    color: "#17211B",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  compareGrid: { flexDirection: "row", gap: 8, marginBottom: 11 },
  compareItem: { flex: 1 },
  compareImage: { width: 145, height: 180, borderRadius: 13 },
});
