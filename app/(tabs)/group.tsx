import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { ReactNode, useCallback, useMemo, useState } from "react";
import { BackHandler, PanResponder, Pressable, Share, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { MetricSelector } from "@/src/components/MetricSelector";
import { AddTrackerModal } from "@/src/components/AddTrackerModal";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Avatar,
  Card,
  PageHeader,
  ProgressBar,
  Screen,
} from "@/src/components/ui";
import { dateKey, dateKeyWithOffset, relativeTime } from "@/src/domain/date";
import { groupInviteMessage } from "@/src/domain/invites";
import {
  LeaderboardPeriod,
  leaderboardRows,
  periodDates,
  periodTitle,
} from "@/src/domain/leaderboard";
import { memberDisplayName, memberOriginalLabel } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

const SCORE_ID = "__score";
export default function LeaderboardScreen() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const [anchor, setAnchor] = useState(dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const tracked = (state.group.metricConfiguration ?? []).filter(
    (metric) =>
      metric.scoreWeight > 0 &&
      metric.dataType !== "text" &&
      metric.dataType !== "photo" &&
      metric.sections.group,
  );
  const saved = state.settings.leaderboardMetricIdsByGroup?.[
    state.group.id
  ] ?? [state.selectedGroupMetricId || SCORE_ID];
  const validSaved = saved.filter(
    (id) => id === SCORE_ID || tracked.some((metric) => metric.id === id),
  );
  const initialSelected =
    validSaved.length >= 2
      ? validSaved
      : ([
          ...validSaved,
          tracked.find((metric) => !validSaved.includes(metric.id))?.id,
        ].filter(Boolean) as string[]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelected);
  const selected = selectedIds.length ? selectedIds : [SCORE_ID];
  const dates = useMemo(() => periodDates(period, anchor), [anchor, period]);
  function choosePeriod(next: LeaderboardPeriod) {
    setPeriod(next);
    if (next === "today") setAnchor(dateKey());
    if (next === "yesterday") setAnchor(dateKeyWithOffset(-1));
    setCalendarOpen(next === "custom");
  }
  async function invite() {
    await Share.share({
      message: groupInviteMessage(state.group.name, state.group.inviteCode),
    });
  }
  function saveSelection(ids: string[]) {
    const next = ids.length ? ids : [SCORE_ID];
    setSelectedIds(next);
    updateSettings({
      leaderboardMetricIdsByGroup: {
        ...state.settings.leaderboardMetricIdsByGroup,
        [state.group.id]: next,
      },
    });
  }
  function move(id: string, target: number) {
    const next = [...selected];
    const index = next.indexOf(id);
    if (index < 0) return;
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(target, next.length)), 0, item);
    saveSelection(next);
  }
  const options = [
    {
      id: SCORE_ID,
      label: "Overall score",
      icon: "speedometer-outline" as const,
      color: palette.purple,
    },
    ...tracked.map((metric) => ({
      id: metric.id,
      label: metric.name,
      icon: metric.icon as keyof typeof Ionicons.glyphMap,
      color: metric.color,
    })),
  ];
  const hiddenOptions = options.filter((item) => !selected.includes(item.id));
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!editing) return false;
        setEditing(false);
        setShowPicker(false);
        return true;
      });
      return () => subscription.remove();
    }, [editing]),
  );
  const periods = [
    { id: "today", label: "Today", icon: "today-outline" as const },
    { id: "yesterday", label: "Yesterday", icon: "play-back-outline" as const },
    { id: "week", label: "Last 7 days", icon: "calendar-outline" as const },
    {
      id: "month",
      label: "This month",
      icon: "calendar-number-outline" as const,
    },
    {
      id: "custom",
      label: "Pick a date",
      icon: "calendar-clear-outline" as const,
    },
  ];
  return (
    <Screen contentContainerStyle={{ paddingBottom: 14 }}>
      <PageHeader
        title="Leaderboard"
        action={
          editing ? (
            <Pressable
              onPress={() => {
                setEditing(false);
                setShowPicker(false);
              }}
              style={[styles.done, { backgroundColor: accent }]}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : undefined
        }
        subtitle={`${state.group.name} · ${state.group.members.length} friends`}
      />
      {selected.map((id, cardIndex) => {
        const metric = tracked.find((item) => item.id === id);
        const includeScore = id === SCORE_ID;
        const rows = leaderboardRows(
          state,
          metric ? [metric] : [],
          dates,
          state.currentUserId,
          includeScore,
        );
        return (
          <EditableRankingCard
            key={id}
            editing={editing}
            index={cardIndex}
            count={selected.length}
            colors={colors}
            onMove={(target) => move(id, target)}
            onRemove={() => saveSelection(selected.filter((item) => item !== id))}
          >
          <Card style={styles.ranking}>
            <Pressable
              onLongPress={() => setEditing(true)}
              onPress={() =>
                editing ? undefined : router.navigate({
                  pathname: "/leaderboard-detail",
                  params: { period, anchor, metrics: id },
                } as never)
              }
              style={styles.rankingHead}
            >
              <View>
                <Text style={[styles.eyebrow, { color: accent }]}>
                  {periodTitle(period, anchor).toUpperCase()}
                </Text>
                <Text style={[styles.title, { color: colors.ink }]}>
                  {includeScore ? "Overall score" : metric?.name}
                </Text>
              </View>
              {includeScore ? (
                <Text
                  style={[
                    styles.max,
                    { color: accent, backgroundColor: colors.primarySoft },
                  ]}
                >
                  MAX 100
                </Text>
              ) : (
                <Ionicons name="expand-outline" size={20} color={accent} />
              )}
            </Pressable>
            {rows.slice(0, 4).map((row, index) => {
              const result = row.metrics[0]?.result;
              const value = includeScore
                ? `${Math.round(row.score)} pts`
                : (result?.label ?? "No data");
              const details = [
                includeScore ? "Group-weighted score" : result?.averageLabel,
                result?.streak && result.streak > 1
                  ? `${result.streak}d streak`
                  : undefined,
                result?.lastRecordedAt
                  ? relativeTime(result.lastRecordedAt)
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Pressable
                  key={row.member.id}
                  onPress={() =>
                    editing ? undefined : router.navigate({
                      pathname: "/member/[id]",
                      params: {
                        id: row.member.id,
                        period,
                        anchor,
                        metrics: id,
                      },
                    } as never)
                  }
                  style={[
                    styles.row,
                    { borderTopColor: colors.border },
                    row.member.id === state.currentUserId && {
                      backgroundColor: colors.primarySoft,
                      borderRadius: 14,
                      borderTopColor: "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.rank,
                      { color: colors.faint },
                      index < 3 && styles.podium,
                    ]}
                  >
                    #{index + 1}
                  </Text>
                  <Avatar
                    initials={row.member.initials}
                    color={row.member.color}
                    uri={row.member.avatarUri}
                    size={31}
                  />
                  <View style={styles.copy}>
                    <Text style={[styles.name, { color: colors.ink }]}>
                      {memberDisplayName(state, row.member)}
                      {row.member.id === state.currentUserId ? " · You" : ""}
                    </Text>
                    {memberOriginalLabel(state, row.member) ? (
                      <Text style={[styles.original, { color: colors.faint }]}>
                        {memberOriginalLabel(state, row.member)}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        styles.detail,
                        { color: colors.muted },
                        result?.mode === "private" && styles.private,
                      ]}
                    >
                      {details}
                    </Text>
                  </View>
                  <View style={styles.bar}>
                    <Text style={[styles.score, { color: colors.ink }]}>
                      {value}
                    </Text>
                    <ProgressBar
                      progress={
                        includeScore
                          ? row.score / 100
                          : Math.min(row.score / 100, 1)
                      }
                      color={row.member.color}
                    />
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={15}
                    color={colors.faint}
                  />
                </Pressable>
              );
            })}
          </Card>
          </EditableRankingCard>
        );
      })}
      {editing ? (
        <>
          <Pressable
            onPress={() => setShowPicker((value) => !value)}
            style={[styles.addExisting, { borderColor: accent }]}
          >
            <Ionicons name="add" size={18} color={accent} />
            <Text style={[styles.addExistingText, { color: accent }]}>Add existing tracker</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => setEditing(true)} style={styles.editHint}>
          <Text style={[styles.hint, { color: colors.muted }]}>Hold a ranking card to edit what Leaderboard shows</Text>
        </Pressable>
      )}
      <Card style={styles.controls}>
        <MetricSelector
          title="Time range"
          items={periods}
          selectedIds={[period]}
          onChange={(ids) => choosePeriod(ids[0] as LeaderboardPeriod)}
          multiple={false}
        />
        {period === "custom" ? (
          <View style={[styles.calendar, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={() => setCalendarOpen((value) => !value)}
              style={styles.dateButton}
            >
              <Ionicons name="calendar-outline" size={18} color={accent} />
              <Text style={[styles.dateText, { color: colors.ink }]}>
                {periodTitle("custom", anchor)}
              </Text>
              <Ionicons
                name={calendarOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.muted}
              />
            </Pressable>
            {calendarOpen ? (
              <View
                style={[styles.calendarBody, { borderTopColor: colors.border }]}
              >
                <MonthCalendar
                  monthDate={anchor}
                  selectedDate={anchor}
                  onSelect={(date) => {
                    setAnchor(date);
                    setCalendarOpen(false);
                  }}
                  onMonthChange={setAnchor}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
      <View style={styles.actions}>
        <Pressable
          onPress={() => router.navigate("/groups" as never)}
          style={styles.inline}
        >
          <Ionicons name="swap-horizontal" size={17} color={accent} />
          <Text style={[styles.link, { color: accent }]}>Manage groups</Text>
        </Pressable>
        <Pressable onPress={invite} style={styles.inline}>
          <Ionicons name="person-add-outline" size={17} color={accent} />
          <Text style={[styles.link, { color: accent }]}>Invite</Text>
        </Pressable>
        <Text style={[styles.code, { color: colors.faint }]}>
          {state.group.inviteCode}
        </Text>
      </View>
      <AddTrackerModal
        visible={showPicker}
        items={hiddenOptions}
        onClose={() => setShowPicker(false)}
        onAdd={(id) => {
          saveSelection([...selected, id]);
          setShowPicker(false);
        }}
      />
    </Screen>
  );
}

function EditableRankingCard({
  children,
  editing,
  index,
  count,
  colors,
  onMove,
  onRemove,
}: {
  children: ReactNode;
  editing: boolean;
  index: number;
  count: number;
  colors: ReturnType<typeof useAppColors>;
  onMove: (target: number) => void;
  onRemove: () => void;
}) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          editing && Math.abs(gesture.dy) > 3,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) =>
          onMove(
            Math.max(
              0,
              Math.min(count - 1, index + Math.round(gesture.dy / 180)),
            ),
          ),
      }),
    [count, editing, index, onMove],
  );
  return (
    <View style={styles.rankingWrap}>
      {editing ? (
        <View style={[styles.editBar, { borderColor: colors.border }]}>
          <View {...responder.panHandlers} style={styles.drag}>
            <Ionicons name="reorder-three-outline" size={24} color={colors.faint} />
          </View>
          <Text style={[styles.dragText, { color: colors.muted }]}>Drag to reorder</Text>
          <Pressable onPress={onRemove} style={styles.remove} hitSlop={8}>
            <Ionicons name="remove" size={16} color={palette.white} />
          </Pressable>
        </View>
      ) : null}
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  done: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  doneText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  rankingWrap: { marginBottom: 6 },
  editBar: { height: 38, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  drag: { width: 34, alignItems: "center", justifyContent: "center" },
  dragText: { flex: 1, fontSize: 9, fontWeight: "800" },
  remove: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center" },
  addExisting: { minHeight: 42, borderWidth: 1, borderStyle: "dashed", borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 },
  addExistingText: { fontSize: 10, fontWeight: "900" },
  editHint: { alignItems: "center", paddingVertical: 7 },
  hint: { fontSize: 9, fontWeight: "700" },
  ranking: { padding: 7 },
  rankingHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 4,
  },
  eyebrow: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  title: { fontSize: 14, fontWeight: "900", marginTop: 1 },
  max: { fontSize: 8, fontWeight: "900", padding: 7, borderRadius: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 45,
    paddingHorizontal: 5,
    paddingVertical: 7,
    borderTopWidth: 1,
  },
  rank: { width: 26, fontSize: 11, fontWeight: "900" },
  podium: { color: palette.amber, fontSize: 14 },
  copy: { flex: 1 },
  name: { fontSize: 12, fontWeight: "900" },
  original: { fontSize: 8, marginTop: 1 },
  detail: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  private: { fontStyle: "italic" },
  bar: { width: 68, gap: 4 },
  score: { fontSize: 12, fontWeight: "900", textAlign: "right" },
  controls: { padding: 12, marginTop: 2, gap: 7 },
  calendar: { borderTopWidth: 1, paddingTop: 7 },
  dateButton: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateText: { flex: 1, fontSize: 11, fontWeight: "900" },
  calendarBody: { borderTopWidth: 1, paddingTop: 9 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 5 },
  link: { fontSize: 10, fontWeight: "900" },
  code: {
    marginLeft: "auto",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
