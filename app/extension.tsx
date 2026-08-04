import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import TodayPage from "./(tabs)/index";
import { AppText as Text } from "@/src/components/AppText";
import {
  activityTimerDisplaySeconds,
  activityTimerElapsedSeconds,
  formatActivityTimer,
} from "@/src/domain/activityTimer";
import {
  scheduleEventsForDate,
  ScheduleEvent,
} from "@/src/domain/calendar";
import { dateKey } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { ActivityTimer } from "@/src/types";

type Panel = "timers" | "schedule" | null;

export default function ExtensionDashboard() {
  const { state, hydrated, setActivityTimer } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [panel, setPanel] = useState<Panel>(null);
  const [now, setNow] = useState(Date.now());
  const timers = state.activityTimers?.length
    ? state.activityTimers
    : state.activeTimer
      ? [state.activeTimer]
      : [];
  const hasRunningTimer = timers.some((timer) => timer.status === "running");

  useEffect(() => {
    if (!hasRunningTimer) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimer]);

  useEffect(() => {
    if (
      !hydrated ||
      typeof window === "undefined" ||
      window.parent === window
    )
      return;

    // The browser extension must distinguish this mounted dashboard from a
    // generic document load (including Expo's Unmatched Route page). The
    // message deliberately contains no account data and the parent validates
    // both this frame and the deployed HabHub origin before accepting it.
    const announceReady = () => {
      window.parent.postMessage(
        { type: "habhub:companion-ready", version: 1 },
        "*",
      );
    };
    const respondToProbe = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        event.data?.type === "habhub:companion-ping"
      )
        announceReady();
    };

    announceReady();
    window.addEventListener("message", respondToProbe);
    return () => window.removeEventListener("message", respondToProbe);
  }, [hydrated]);

  const events = useMemo(
    () =>
      scheduleEventsForDate(state, dateKey())
        .sort((left, right) =>
          (left.time ?? "99:99").localeCompare(right.time ?? "99:99"),
        )
        .slice(0, 12),
    [state],
  );

  const toggleTimer = (timer: ActivityTimer) => {
    const timestamp = new Date().toISOString();
    if (timer.status === "running") {
      setActivityTimer(
        {
          ...timer,
          status: "paused",
          accumulatedSeconds: activityTimerElapsedSeconds(timer),
          pausedAt: timestamp,
        },
        timer.id,
      );
      return;
    }
    setActivityTimer(
      {
        ...timer,
        status: "running",
        startedAt: timestamp,
        pausedAt: undefined,
      },
      timer.id,
    );
  };

  return (
    <View style={styles.root}>
      <TodayPage />
      <View
        style={[
          styles.dock,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <DockButton
          icon="timer-outline"
          label={timers.length ? t("Active timers") : t("Timer")}
          active={timers.length > 0}
          onPress={() => setPanel("timers")}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <DockButton
          icon="calendar-outline"
          label={t("Today’s schedule")}
          onPress={() => setPanel("schedule")}
        />
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={panel !== null}
        onRequestClose={() => setPanel(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPanel(null)}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.ink }]}>
                {panel === "timers" ? t("Active timers") : t("Today’s schedule")}
              </Text>
              <Pressable onPress={() => setPanel(null)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {panel === "timers" ? (
              <>
                {timers.map((timer) => {
                  const metric = state.metrics.find(
                    (item) => item.id === timer.metricId,
                  );
                  return (
                    <View
                      key={timer.id}
                      style={[styles.row, { borderColor: colors.border }]}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={[styles.rowTitle, { color: colors.ink }]}>
                          {metric?.name ?? "Activity"}
                        </Text>
                        <Text style={[styles.timerValue, { color: accent }]}>
                          {formatActivityTimer(
                            activityTimerDisplaySeconds(timer, now),
                          )}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => toggleTimer(timer)}
                        style={[styles.roundAction, { backgroundColor: accent }]}
                      >
                        <Ionicons
                          name={timer.status === "running" ? "pause" : "play"}
                          size={17}
                          color="#FFFFFF"
                        />
                      </Pressable>
                    </View>
                  );
                })}
                {!timers.length ? (
                  <Text style={[styles.empty, { color: colors.muted }]}>
                    {t("No timer is running.")}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    setPanel(null);
                    router.navigate("/timer" as never);
                  }}
                  style={[styles.primary, { backgroundColor: accent }]}
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                  <Text preserveColor style={styles.primaryText}>
                    {t("Start or manage timers")}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                {events.map((event) => (
                  <ScheduleRow
                    key={event.id}
                    event={event}
                    onPress={() => {
                      setPanel(null);
                      if (event.todoId)
                        router.navigate({
                          pathname: "/todo-editor",
                          params: { id: event.todoId },
                        } as never);
                      else if (event.metricId)
                        router.navigate({
                          pathname: "/metric-detail",
                          params: {
                            metric: event.metricId,
                            date: dateKey(),
                          },
                        } as never);
                      else router.navigate("/calendar" as never);
                    }}
                  />
                ))}
                {!events.length ? (
                  <Text style={[styles.empty, { color: colors.muted }]}>
                    {t("Nothing scheduled today.")}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    setPanel(null);
                    router.navigate("/calendar" as never);
                  }}
                  style={[styles.primary, { backgroundColor: accent }]}
                >
                  <Ionicons name="calendar-outline" size={17} color="#FFFFFF" />
                  <Text preserveColor style={styles.primaryText}>
                    {t("Open full schedule")}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function DockButton({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable onPress={onPress} style={styles.dockButton}>
      <Ionicons name={icon} size={17} color={active ? accent : colors.muted} />
      <Text
        numberOfLines={1}
        style={[styles.dockText, { color: active ? accent : colors.ink }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ScheduleRow({
  event,
  onPress,
}: {
  event: ScheduleEvent;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderColor: colors.border }]}
    >
      <Text style={[styles.time, { color: event.color ?? accent }]}>
        {event.time ?? "ALL"}
      </Text>
      <Text
        numberOfLines={2}
        style={[
          styles.rowTitle,
          event.completed && styles.completed,
          { color: colors.ink },
        ]}
      >
        {event.title}
      </Text>
      <Ionicons name="chevron-forward" size={15} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dock: {
    position: "absolute",
    right: 12,
    bottom: 12,
    minHeight: 44,
    maxWidth: 240,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  dockButton: {
    minWidth: 86,
    maxWidth: 112,
    minHeight: 42,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  dockText: { flexShrink: 1, fontSize: 9, fontWeight: "900" },
  divider: { width: 1, height: 24 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.42)",
    padding: 10,
  },
  sheet: {
    maxHeight: "78%",
    borderWidth: 1,
    borderRadius: 22,
    padding: 13,
    gap: 8,
  },
  sheetHeader: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 14, fontWeight: "900" },
  row: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { flex: 1, fontSize: 10, fontWeight: "800" },
  timerValue: { fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  roundAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  time: { width: 40, fontSize: 9, fontWeight: "900" },
  completed: { textDecorationLine: "line-through", opacity: 0.7 },
  empty: { paddingVertical: 15, textAlign: "center", fontSize: 10 },
  primary: {
    minHeight: 43,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
});
