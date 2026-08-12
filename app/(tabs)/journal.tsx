import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Card, PageHeader, Screen } from "@/src/components/ui";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { InfoPopover } from "@/src/components/InfoPopover";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  adjacentPeriod,
  DateRangeNavigator,
  PeriodChoiceBar,
} from "@/src/components/PeriodNavigator";
import { RichNoteText } from "@/src/components/RichNoteText";
import { NoteDrawingPreview } from "@/src/components/NoteDrawingCanvas";
import { useLocale } from "@/src/i18n";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { dateKey } from "@/src/domain/date";
import {
  LeaderboardPeriod,
  periodDates,
  shiftedPeriodAnchor,
} from "@/src/domain/leaderboard";
import { trackerGroupLabel } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { JournalDrawing } from "@/src/types";

type JournalItem = {
  id: string;
  title: string;
  body: string;
  localDate: string;
  createdAt: string;
  metricId?: string;
  filterIds: string[];
  imageUri?: string;
  drawing?: JournalDrawing;
  editable: boolean;
};

function JournalPage() {
  const params = useLocalSearchParams<{ metric?: string | string[] }>();
  const requestedMetric = Array.isArray(params.metric)
    ? params.metric[0]
    : params.metric;
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [filterIds, setFilterIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<LeaderboardPeriod>("month");
  const [anchor, setAnchor] = useState(dateKey());
  const [dateNavigatorOpen, setDateNavigatorOpen] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const choosePeriod = useCallback(
    (next: Exclude<LeaderboardPeriod, "custom">) => {
      setPeriod(next);
      if (next === "today") setAnchor(dateKey());
      setCalendarOpen(false);
    },
    [],
  );
  const toggleDateNavigator = useCallback(() => {
    if (dateNavigatorOpen) setCalendarOpen(false);
    setDateNavigatorOpen((open) => !open);
  }, [dateNavigatorOpen]);
  const shiftPeriod = useCallback(
    (direction: -1 | 1) => {
      const next = shiftedPeriodAnchor(period, anchor, direction);
      if (!next) return;
      if (period === "today" || period === "yesterday") setPeriod("custom");
      setAnchor(next);
      setCalendarOpen(false);
    },
    [anchor, period],
  );
  const swipeRange = useCallback(
    (direction: -1 | 1) => {
      const next = adjacentPeriod(period, direction);
      if (!next) return;
      setPeriod(next);
      if (next === "today") setAnchor(dateKey());
      setCalendarOpen(false);
    },
    [period],
  );
  const swipeGesture = usePageSwipeGesture({
    onPrevious: () => swipeRange(-1),
    onNext: () => swipeRange(1),
  });
  useEffect(() => {
    if (requestedMetric) setFilterIds([requestedMetric]);
  }, [requestedMetric]);
  const visibleDates = useMemo(
    () =>
      period === "overall"
        ? null
        : new Set(
            periodDates(
              period,
              anchor,
              state.settings.weekStartsOn ?? 1,
            ),
          ),
    [anchor, period, state.settings.weekStartsOn],
  );
  const allItems = useMemo<JournalItem[]>(() => {
    const authored = (state.journalNotes ?? []).map((note) => ({
      id: note.id,
      title: note.title || "Unlabelled note",
      body: note.body,
      localDate: note.localDate,
      createdAt: note.createdAt,
      metricId: note.metricId,
      filterIds: [
        ...(note.metricIds ?? (note.metricId ? [note.metricId] : [])),
        ...(note.labels ?? []).map((label) => `label:${label}`),
        ...(note.metricId || note.metricIds?.length || note.labels?.length
          ? []
          : ["unlabelled"]),
      ],
      imageUri: note.imageUri,
      drawing: note.drawing,
      editable: true,
    }));
    const entries = state.entries
      .filter(
        (entry) =>
          entry.userId === state.currentUserId &&
          Boolean(entry.note?.trim()),
      )
      .map((entry) => {
        const metric = state.metrics.find(
          (candidate) => candidate.id === entry.metricId,
        );
        return {
          id: `entry:${entry.id}`,
          title: metric?.name ?? "Tracker note",
          body: entry.note!,
          localDate: entry.localDate,
          createdAt: entry.recordedAt,
          metricId: entry.metricId,
          filterIds: [entry.metricId],
          imageUri: entry.imageUri,
          editable: false,
        };
      });
    const gym = (state.gymSessions ?? []).flatMap((session) => [
      ...(session.notes?.trim()
        ? [{
            id: `gym:${session.id}`,
            title: session.name,
            body: session.notes,
            localDate: session.localDate,
            createdAt: session.recordedAt,
            metricId: "gym_completed",
            filterIds: ["gym", "gym_completed"],
            editable: false,
          }]
        : []),
      ...session.exercises
        .filter((exercise) => Boolean(exercise.notes?.trim()))
        .map((exercise) => ({
          id: `gym:${session.id}:${exercise.id}`,
          title: exercise.name,
          body: exercise.notes!,
          localDate: session.localDate,
          createdAt: session.recordedAt,
          filterIds: ["gym", `exercise:${exercise.exerciseKey ?? exercise.name}`],
          editable: false,
        })),
    ]);
    return [...authored, ...entries, ...gym]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [
    state.entries,
    state.journalNotes,
    state.metrics,
    state.gymSessions,
    state.currentUserId,
  ]);
  const items = useMemo<JournalItem[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return allItems.filter(
      (item) =>
        (!filterIds.length ||
          filterIds.some((filter) => item.filterIds.includes(filter))) &&
        (!visibleDates || visibleDates.has(item.localDate)) &&
        (!normalized ||
          `${item.title} ${item.body} ${item.localDate}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [allItems, filterIds, query, visibleDates]);
  const filterItems = useMemo(() => {
    const metricIds = new Set(allItems.flatMap((item) => item.filterIds));
    const metrics = state.metrics
      .filter((metric) => metricIds.has(metric.id))
      .map((metric) => ({
        id: metric.id,
        label: metric.name,
        icon: metric.icon as keyof typeof Ionicons.glyphMap,
        color: metric.color,
        group: trackerGroupLabel(metric),
      }));
    const exerciseKeys = [...metricIds]
      .filter((id) => id.startsWith("exercise:"))
      .map((id) => ({
        id,
        label: id.slice("exercise:".length),
        icon: "barbell-outline" as const,
        group: "Workout exercises",
      }));
    const labels = [...metricIds]
      .filter((id) => id.startsWith("label:"))
      .map((id) => ({
        id,
        label: `#${id.slice("label:".length)}`,
        icon: "pricetag-outline" as const,
        group: "Labels",
      }));
    return [
      ...(metricIds.has("unlabelled")
        ? [{
            id: "unlabelled",
            label: "Journal notes",
            icon: "document-text-outline" as const,
            group: "Journal entries",
          }]
        : []),
      ...(metricIds.has("gym")
        ? [{
            id: "gym",
            label: "All workout notes",
            icon: "barbell-outline" as const,
            group: "Workout",
          }]
        : []),
      ...metrics,
      ...exerciseKeys,
      ...labels,
    ];
  }, [allItems, state.metrics]);
  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={styles.pageGesture}>
    <Screen>
      <PageHeader
        title="Journal"
        tutorialId="journal-header"
        action={
          <View style={styles.headerActions}>
            <InfoPopover
              label="Explain Journal"
              message="Journal collects authored notes, tracker logs, and workout or exercise notes. Select several labels at once, search all text, and tap a note to edit or open its source."
            />
            <Pressable
              onPress={() => router.navigate("/note-editor" as never)}
              style={[styles.add, { backgroundColor: accent }]}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        }
      />
      <PeriodChoiceBar
        period={period}
        onChange={choosePeriod}
        dateViewOpen={dateNavigatorOpen}
        onToggleDateView={toggleDateNavigator}
      />
      {period !== "overall" && dateNavigatorOpen ? (
        <DateRangeNavigator
          period={period}
          anchor={anchor}
          dates={periodDates(
            period,
            anchor,
            state.settings.weekStartsOn ?? 1,
          )}
          calendarOpen={calendarOpen}
          onToggleCalendar={() => setCalendarOpen((open) => !open)}
          onShift={shiftPeriod}
        >
          <MonthCalendar
            monthDate={anchor}
            selectedDate={anchor}
            onMonthChange={setAnchor}
            onSelect={(date) => {
              setAnchor(date);
              setPeriod("custom");
              setCalendarOpen(false);
            }}
            hasActivity={(date) =>
              items.some((item) => item.localDate === date)
            }
          />
        </DateRangeNavigator>
      ) : null}
      <View
        style={[
          styles.search,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search-outline" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search every note"
          placeholderTextColor={colors.faint}
          style={[styles.searchInput, { color: colors.ink }]}
        />
      </View>
      <SelectionMenu
        title="Filter notes"
        items={filterItems}
        selectedIds={filterIds}
        onChange={setFilterIds}
        emptyLabel="All notes"
      />
      <View style={styles.notes}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              item.editable
                ? router.navigate({
                    pathname: "/note-editor",
                    params: { id: item.id },
                  } as never)
                : router.navigate({
                    pathname: "/metric-detail",
                    params: { metric: item.metricId, date: item.localDate },
                  } as never)
            }
          >
            <Card style={styles.note}>
              <View style={styles.noteHeading}>
                <View style={styles.copy}>
                  <Text translate={false} style={[styles.noteTitle, { color: colors.ink }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.noteDate, { color: colors.muted }]}>
                    {new Date(`${item.localDate}T12:00:00`).toLocaleDateString(
                      locale,
                      { dateStyle: "medium" },
                    )}
                  </Text>
                </View>
                <Ionicons
                  name={item.editable ? "create-outline" : "open-outline"}
                  size={15}
                  color={accent}
                />
              </View>
              <View
                style={[
                  styles.notePreviewCanvas,
                  item.drawing && !item.body.trim() && !item.imageUri
                    ? styles.drawingOnlyPreview
                    : undefined,
                ]}
              >
                {item.body.trim() ? (
                  <RichNoteText body={item.body} numberOfLines={4} />
                ) : null}
                {item.imageUri ? (
                  <Image source={item.imageUri} style={styles.image} />
                ) : null}
                <NoteDrawingPreview drawing={item.drawing} />
              </View>
            </Card>
          </Pressable>
        ))}
        {!items.length ? (
          <Card>
            <Text style={[styles.empty, { color: colors.muted }]}>
              No matching notes yet.
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
    </View>
    </GestureDetector>
  );
}

export default JournalPage;

const styles = StyleSheet.create({
  pageGesture: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  help: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  searchInput: { flex: 1, fontSize: 10, fontWeight: "700" },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginVertical: 8,
  },
  notes: { gap: 7 },
  note: { gap: 7 },
  noteHeading: { flexDirection: "row", alignItems: "center" },
  copy: { flex: 1 },
  noteTitle: { fontSize: 10, fontWeight: "900" },
  noteDate: { fontSize: 7, marginTop: 2 },
  noteBody: { fontSize: 9, lineHeight: 14 },
  notePreviewCanvas: { position: "relative", gap: 7 },
  drawingOnlyPreview: { minHeight: 120 },
  image: { width: "100%", height: 120, borderRadius: 12 },
  empty: { textAlign: "center", fontSize: 9, fontWeight: "700" },
});
