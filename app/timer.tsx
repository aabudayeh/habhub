import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { ActivityTimer } from "@/src/types";

function elapsedSeconds(timer: ActivityTimer, now = Date.now()) {
  return (
    timer.accumulatedSeconds +
    (timer.status === "running"
      ? Math.max(0, (now - new Date(timer.startedAt).getTime()) / 1000)
      : 0)
  );
}

function displaySeconds(timer: ActivityTimer, now: number) {
  const elapsed = elapsedSeconds(timer, now);
  return timer.mode === "countdown"
    ? Math.max(0, (timer.targetSeconds ?? 0) - elapsed)
    : elapsed;
}

function clock(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

async function cancelNotification(id?: string) {
  if (id)
    await Notifications.cancelScheduledNotificationAsync(id).catch(
      () => undefined,
    );
}

async function scheduleCountdown(title: string, seconds: number) {
  if (seconds < 1) return undefined;
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return undefined;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${title} complete`,
      body: "Your activity timer has finished.",
      sound: "default",
      data: { route: "/timer" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(seconds)),
    },
  });
}

export default function ActivityTimerPage() {
  const {
    state,
    setActivityTimer,
    logMetric,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const timer = state.activeTimer;
  const metrics = useMemo(
    () =>
      state.metrics.filter(
        (metric) =>
          metric.dataType === "number" &&
          metric.manualEntry !== false &&
          (/min|hour|hr|sec/i.test(metric.unit) ||
            metric.category === "mind" ||
            /study|read|meditat|practice/i.test(metric.name)),
      ),
    [state.metrics],
  );
  const [metricId, setMetricId] = useState(timer?.metricId ?? metrics[0]?.id ?? "");
  const [mode, setMode] = useState<ActivityTimer["mode"]>(
    timer?.mode ?? "stopwatch",
  );
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [autoLog, setAutoLog] = useState(timer?.autoLog ?? false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (
      timer?.mode === "countdown" &&
      timer.status === "running" &&
      displaySeconds(timer, now) <= 0
    )
      finish(timer);
    // finish is intentionally driven only when the persisted timer reaches 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, timer]);
  const metric = state.metrics.find((item) => item.id === (timer?.metricId ?? metricId));
  const start = async () => {
    if (!metric)
      return Alert.alert("Choose a timed tracker", "Add one first if needed.");
    const targetSeconds = mode === "countdown" ? targetMinutes * 60 : undefined;
    const notificationId =
      mode === "countdown"
        ? await scheduleCountdown(metric.name, targetSeconds!)
        : undefined;
    setActivityTimer({
      id: `timer-${Date.now().toString(36)}`,
      metricId: metric.id,
      mode,
      targetSeconds,
      autoLog,
      startedAt: new Date().toISOString(),
      status: "running",
      accumulatedSeconds: 0,
      laps: [],
      notificationId,
    });
  };
  const pause = async () => {
    if (!timer) return;
    await cancelNotification(timer.notificationId);
    setActivityTimer({
      ...timer,
      accumulatedSeconds: elapsedSeconds(timer),
      status: "paused",
      pausedAt: new Date().toISOString(),
      notificationId: undefined,
    });
  };
  const resume = async () => {
    if (!timer || !metric) return;
    const remaining =
      timer.mode === "countdown"
        ? Math.max(0, (timer.targetSeconds ?? 0) - timer.accumulatedSeconds)
        : 0;
    const notificationId =
      timer.mode === "countdown"
        ? await scheduleCountdown(metric.name, remaining)
        : undefined;
    setActivityTimer({
      ...timer,
      startedAt: new Date().toISOString(),
      status: "running",
      pausedAt: undefined,
      notificationId,
    });
  };
  const lap = () => {
    if (!timer) return;
    setActivityTimer({
      ...timer,
      laps: [
        ...timer.laps,
        {
          id: `lap-${Date.now().toString(36)}`,
          seconds: elapsedSeconds(timer),
          recordedAt: new Date().toISOString(),
        },
      ],
    });
  };
  const finish = async (target = timer) => {
    if (!target) return;
    await cancelNotification(target.notificationId);
    const seconds =
      target.mode === "countdown"
        ? Math.min(
            target.targetSeconds ?? 0,
            elapsedSeconds(target),
          )
        : elapsedSeconds(target);
    const targetMetric = state.metrics.find(
      (item) => item.id === target.metricId,
    );
    if (!targetMetric) {
      setActivityTimer(undefined);
      return;
    }
    const value = /hour|hr/i.test(targetMetric.unit)
      ? seconds / 3600
      : /sec/i.test(targetMetric.unit)
        ? seconds
        : seconds / 60;
    setActivityTimer(undefined);
    if (target.autoLog) {
      logMetric(target.metricId, value, targetMetric.defaultVisibility, "add", {
        localDate: dateKey(),
        label: "Activity timer",
        note: `${target.laps.length} lap${target.laps.length === 1 ? "" : "s"}`,
      });
      router.back();
    } else {
      router.replace({
        pathname: "/log",
        params: {
          metric: target.metricId,
          date: dateKey(),
          value: String(Math.round(value * 100) / 100),
          note: `${target.laps.length} timer lap${target.laps.length === 1 ? "" : "s"}`,
        },
      } as never);
    }
  };
  return (
    <Screen refreshEnabled={false}>
      <PageHeader
        title="Activity timer"
        subtitle="Stopwatch or countdown for timed trackers."
        showMenu={false}
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      {timer && metric ? (
        <>
          <Card style={styles.live}>
            <Text style={[styles.metric, { color: accent }]}>{metric.name}</Text>
            <Text style={[styles.clock, { color: colors.ink }]}>
              {clock(displaySeconds(timer, now))}
            </Text>
            <Text style={[styles.status, { color: colors.muted }]}>
              {timer.status === "paused"
                ? "Paused"
                : timer.mode === "countdown"
                  ? "Countdown running"
                  : "Stopwatch running"}
            </Text>
            <View style={styles.liveActions}>
              <Pressable
                onPress={timer.status === "running" ? pause : resume}
                style={[styles.round, { backgroundColor: colors.primarySoft }]}
              >
                <Ionicons
                  name={timer.status === "running" ? "pause" : "play"}
                  size={23}
                  color={accent}
                />
              </Pressable>
              <Pressable onPress={lap} style={[styles.round, { backgroundColor: colors.canvas }]}>
                <Ionicons name="flag-outline" size={22} color={colors.ink} />
              </Pressable>
              <Pressable onPress={() => finish()} style={[styles.round, { backgroundColor: "#D24B4B18" }]}>
                <Ionicons name="stop" size={23} color="#D24B4B" />
              </Pressable>
            </View>
          </Card>
          {timer.laps.length ? (
            <Card style={styles.laps}>
              {timer.laps.map((item, index) => (
                <View key={item.id} style={styles.lap}>
                  <Text style={[styles.lapText, { color: colors.muted }]}>
                    Lap {index + 1}
                  </Text>
                  <Text style={[styles.lapValue, { color: colors.ink }]}>
                    {clock(item.seconds)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card style={styles.setup}>
            <Text style={[styles.label, { color: colors.ink }]}>Tracker</Text>
            <View style={styles.wrap}>
              {metrics.map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  selected={metricId === item.id}
                  onPress={() => setMetricId(item.id)}
                />
              ))}
            </View>
            {!metrics.length ? (
              <Pressable
                onPress={() =>
                  router.navigate({
                    pathname: "/metric-editor",
                    params: { id: "new" },
                  } as never)
                }
              >
                <Text style={[styles.link, { color: accent }]}>
                  Create a duration tracker
                </Text>
              </Pressable>
            ) : null}
            <Text style={[styles.label, { color: colors.ink }]}>Mode</Text>
            <View style={styles.wrap}>
              <Chip label="Stopwatch" selected={mode === "stopwatch"} onPress={() => setMode("stopwatch")} />
              <Chip label="Countdown" selected={mode === "countdown"} onPress={() => setMode("countdown")} />
            </View>
            {mode === "countdown" ? (
              <View style={styles.wrap}>
                {[10, 25, 30, 45, 60].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes} min`}
                    selected={targetMinutes === minutes}
                    onPress={() => setTargetMinutes(minutes)}
                  />
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => setAutoLog((value) => !value)}
              style={styles.autoLog}
            >
              <Ionicons
                name={autoLog ? "checkbox" : "square-outline"}
                size={20}
                color={autoLog ? accent : colors.faint}
              />
              <Text style={[styles.autoLogText, { color: colors.ink }]}>
                Log automatically when finished
              </Text>
            </Pressable>
          </Card>
          <Pressable onPress={start} style={[styles.start, { backgroundColor: accent }]}>
            <Ionicons name="play" size={18} color="#FFFFFF" />
            <Text style={styles.startText}>Start timer</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  setup: { gap: 10 },
  label: { fontSize: 10, fontWeight: "900" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  link: { fontSize: 9, fontWeight: "900", textAlign: "center" },
  autoLog: { flexDirection: "row", alignItems: "center", gap: 7 },
  autoLogText: { fontSize: 9, fontWeight: "800" },
  start: {
    minHeight: 48,
    marginTop: 9,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  startText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  live: { alignItems: "center", gap: 6 },
  metric: { fontSize: 10, fontWeight: "900" },
  clock: { fontSize: 40, lineHeight: 48, fontWeight: "900", letterSpacing: 1 },
  status: { fontSize: 9, fontWeight: "800" },
  liveActions: { flexDirection: "row", gap: 13, marginTop: 9 },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  laps: { gap: 5, marginTop: 8 },
  lap: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lapText: { fontSize: 8, fontWeight: "800" },
  lapValue: { fontSize: 10, fontWeight: "900" },
});
