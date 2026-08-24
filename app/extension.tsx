import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import TodayPage from "./(tabs)/index";
import { useAuth } from "@/src/auth/AuthProvider";
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
  const auth = useAuth();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const { height, width } = useWindowDimensions();
  const [panel, setPanel] = useState<Panel>(null);
  const [now, setNow] = useState(Date.now());
  const [dockHidden, setDockHidden] = useState(false);
  const [dockPosition, setDockPosition] = useState({ right: 12, bottom: 12 });
  const expandedDockWidth = Math.min(300, Math.max(220, width - 24));
  const dockPositionRef = React.useRef(dockPosition);
  dockPositionRef.current = dockPosition;
  const dockStorageKey = `habhub-extension-dock-v1:${state.currentUserId}`;
  const timers = state.activityTimers?.length
    ? state.activityTimers
    : state.activeTimer
      ? [state.activeTimer]
      : [];
  const hasRunningTimer = timers.some((timer) => timer.status === "running");
  const setupRequired =
    auth.status === "signedIn" && !state.settings.onboardingComplete;
  const dataReady =
    hydrated &&
    auth.status === "signedIn" &&
    !setupRequired &&
    state.group.members.some((member) => member.id === state.currentUserId);

  useEffect(() => {
    if (!hasRunningTimer) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(dockStorageKey) ?? "{}") as {
        right?: number;
        bottom?: number;
        hidden?: boolean;
      };
      const right = Number(saved.right);
      const bottom = Number(saved.bottom);
      const savedHidden = saved.hidden === true;
      const renderedWidth = savedHidden ? 56 : expandedDockWidth;
      setDockPosition({
        right: Number.isFinite(right)
          ? Math.max(4, Math.min(Math.max(4, width - renderedWidth - 4), right))
          : 12,
        bottom: Number.isFinite(bottom) ? Math.max(4, Math.min(height - 62, bottom)) : 12,
      });
      setDockHidden(savedHidden);
    } catch {
      setDockPosition({ right: 12, bottom: 12 });
      setDockHidden(false);
    }
  }, [dockStorageKey, expandedDockWidth, height, width]);

  function saveDock(next = dockPositionRef.current, hidden = dockHidden) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      dockStorageKey,
      JSON.stringify({ ...next, hidden }),
    );
  }

  const dockDrag = useMemo(() => {
    let start = { right: 12, bottom: 12 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) + Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        start = dockPositionRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const renderedWidth = dockHidden ? 56 : expandedDockWidth;
        const next = {
          right: Math.max(
            4,
            Math.min(
              Math.max(4, width - renderedWidth - 4),
              start.right - gesture.dx,
            ),
          ),
          bottom: Math.max(4, Math.min(height - 62, start.bottom - gesture.dy)),
        };
        dockPositionRef.current = next;
        setDockPosition(next);
      },
      onPanResponderRelease: () => saveDock(dockPositionRef.current),
      onPanResponderTerminate: () => saveDock(dockPositionRef.current),
    });
    // saveDock reads refs/current account values; recreating for viewport
    // changes keeps the draggable bounds correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, width, expandedDockWidth, dockStorageKey, dockHidden]);

  function setDockVisibility(hidden: boolean) {
    const nextPosition = hidden
      ? dockPositionRef.current
      : {
          ...dockPositionRef.current,
          right: Math.min(
            dockPositionRef.current.right,
            Math.max(4, width - expandedDockWidth - 4),
          ),
        };
    dockPositionRef.current = nextPosition;
    setDockPosition(nextPosition);
    setDockHidden(hidden);
    saveDock(nextPosition, hidden);
  }

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;

    // Do not announce readiness with a wildcard. The extension begins the
    // handshake with a one-time nonce; this frame only responds to its actual
    // chrome-extension parent and sends no account data across the boundary.
    const respondToProbe = (event: MessageEvent) => {
      const nonce = event.data?.nonce;
      if (
        event.source !== window.parent ||
        !event.origin.startsWith("chrome-extension://") ||
        event.data?.type !== "habhub:companion-ping" ||
        event.data?.version !== 2 ||
        typeof nonce !== "string" ||
        nonce.length < 8 ||
        nonce.length > 160
      ) return;

      window.parent.postMessage(
        {
          type: "habhub:companion-state",
          version: 2,
          nonce,
          authStatus: auth.status,
          hydrated,
          setupRequired,
          dataReady,
        },
        event.origin,
      );
    };

    window.addEventListener("message", respondToProbe);
    return () => window.removeEventListener("message", respondToProbe);
  }, [auth.status, dataReady, hydrated, setupRequired]);

  const events = useMemo(
    () =>
      scheduleEventsForDate(state, dateKey())
        .sort((left, right) =>
          (left.time ?? "99:99").localeCompare(right.time ?? "99:99"),
        )
        .slice(0, 12),
    [state],
  );
  const featuredTimer =
    timers.find((timer) => timer.status === "running") ?? timers[0];
  const featuredTimerMetric = featuredTimer
    ? state.metrics.find((metric) => metric.id === featuredTimer.metricId)
    : undefined;
  const nextScheduleEvent = events.find((event) => !event.completed) ?? events[0];
  const remainingScheduleCount = events.filter((event) => !event.completed).length;

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

  if (auth.status !== "signedIn") {
    return (
      <ExtensionState
        height={height}
        icon="person-circle-outline"
        title="Sign in to HabHub"
        copy="Use the same HabHub account as your phone to load your live Today view, to-dos, timers and schedule."
        action="Open sign in"
        onPress={() => router.navigate("/sign-in" as never)}
      />
    );
  }

  if (setupRequired) {
    return (
      <ExtensionState
        height={height}
        icon="sparkles-outline"
        title="Finish HabHub setup"
        copy="Complete onboarding once, then this companion will use your saved trackers and settings."
        action="Finish setup"
        onPress={() => router.navigate("/onboarding" as never)}
      />
    );
  }

  if (!dataReady) {
    return (
      <View
        style={[
          styles.stateRoot,
          { minHeight: height, backgroundColor: colors.canvas },
        ]}
      >
        <ActivityIndicator size="small" color={accent} />
        <Text style={[styles.stateCopy, { color: colors.muted }]}>
          Loading your HabHub data...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { minHeight: height }]}>
      <TodayPage />
      {dockHidden ? (
        <View
          style={[
            styles.dockCollapsed,
            {
              right: dockPosition.right,
              bottom: dockPosition.bottom,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View accessibilityLabel="Drag companion shortcuts" {...dockDrag.panHandlers} style={styles.dragHandle}>
            <Ionicons name="reorder-three" size={18} color={colors.faint} />
          </View>
          <Pressable accessibilityLabel="Show timer and schedule shortcuts" onPress={() => setDockVisibility(false)} hitSlop={6} style={styles.hideDockButton}>
            <Ionicons name="eye-outline" size={17} color={accent} />
          </Pressable>
        </View>
      ) : (
        <View
          style={[
            styles.dock,
            {
              width: expandedDockWidth,
              right: dockPosition.right,
              bottom: dockPosition.bottom,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View accessibilityLabel="Drag companion shortcuts" {...dockDrag.panHandlers} style={styles.dragHandle}>
            <Ionicons name="reorder-three" size={18} color={colors.faint} />
          </View>
          <DockButton
            icon="timer-outline"
            label={
              featuredTimer
                ? featuredTimerMetric?.name ?? t("Active timer")
                : t("Timer")
            }
            detail={
              featuredTimer
                ? `${formatActivityTimer(
                    activityTimerDisplaySeconds(featuredTimer, now),
                  )}${timers.length > 1 ? ` · +${timers.length - 1}` : ""}`
                : t("Start a timer")
            }
            active={timers.length > 0}
            onPress={() => setPanel("timers")}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <DockButton
            icon="calendar-outline"
            label={nextScheduleEvent?.title ?? t("Today’s schedule")}
            detail={
              nextScheduleEvent
                ? `${nextScheduleEvent.time ?? t("All day")}${
                    remainingScheduleCount > 1
                      ? ` · ${remainingScheduleCount} ${t("left")}`
                      : ""
                  }`
                : t("Clear today")
            }
            onPress={() => setPanel("schedule")}
          />
          <Pressable accessibilityLabel="Hide timer and schedule shortcuts" onPress={() => setDockVisibility(true)} hitSlop={6} style={styles.hideDockButton}>
            <Ionicons name="eye-off-outline" size={15} color={colors.faint} />
          </Pressable>
        </View>
      )}

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

function ExtensionState({
  height,
  icon,
  title,
  copy,
  action,
  onPress,
}: {
  height: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  action: string;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <View
      style={[
        styles.stateRoot,
        { minHeight: height, backgroundColor: colors.canvas },
      ]}
    >
      <View
        style={[
          styles.stateIcon,
          { backgroundColor: `${accent}1F`, borderColor: `${accent}66` },
        ]}
      >
        <Ionicons name={icon} size={27} color={accent} />
      </View>
      <Text style={[styles.stateTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.stateCopy, { color: colors.muted }]}>{copy}</Text>
      <Pressable
        onPress={onPress}
        style={[styles.stateAction, { backgroundColor: accent }]}
      >
        <Text preserveColor style={styles.stateActionText}>
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

function DockButton({
  icon,
  label,
  detail,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  active?: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <Pressable onPress={onPress} style={styles.dockButton}>
      <Ionicons name={icon} size={17} color={active ? accent : colors.muted} />
      <View style={styles.dockCopy}>
        <Text
          translate={false}
          numberOfLines={1}
          style={[styles.dockText, { color: active ? accent : colors.ink }]}
        >
          {label}
        </Text>
        <Text
          translate={false}
          numberOfLines={1}
          style={[styles.dockDetail, { color: colors.muted }]}
        >
          {detail}
        </Text>
      </View>
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
  root: { flex: 1, width: "100%" },
  stateRoot: {
    flex: 1,
    width: "100%",
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stateIcon: {
    width: 52,
    height: 52,
    marginBottom: 2,
    borderWidth: 1,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: { fontSize: 16, fontWeight: "900", textAlign: "center" },
  stateCopy: {
    maxWidth: 310,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  stateAction: {
    minWidth: 170,
    minHeight: 43,
    marginTop: 7,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stateActionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  dock: {
    position: "absolute",
    minHeight: 52,
    maxWidth: 310,
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
  dockCollapsed: {
    position: "absolute",
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  dragHandle: { width: 25, minHeight: 48, alignItems: "center", justifyContent: "center", cursor: "pointer" as const },
  hideDockButton: { width: 27, minHeight: 48, alignItems: "center", justifyContent: "center" },
  dockButton: {
    flex: 1,
    minWidth: 0,
    maxWidth: 126,
    minHeight: 50,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dockCopy: { flex: 1, minWidth: 0, gap: 1 },
  dockText: { fontSize: 9, lineHeight: 12, fontWeight: "900" },
  dockDetail: { fontSize: 7, lineHeight: 10, fontWeight: "700" },
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
