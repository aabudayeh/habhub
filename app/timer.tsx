import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import { Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { MetricSelector } from "@/src/components/MetricSelector";
import {
  TutorialTarget,
  useTutorial,
} from "@/src/components/TutorialSpotlight";
import {
  activityTimerDisplaySeconds,
  activityTimerElapsedSeconds,
  formatActivityTimer,
} from "@/src/domain/activityTimer";
import { dateKey } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { ActivityTimer } from "@/src/types";

async function cancelTimerNotifications(timer?: ActivityTimer) {
  if (!timer || Platform.OS === "web") return;
  const ids = [
    timer.notificationId,
    ...(timer.notificationIds ?? []),
  ].filter((id): id is string => Boolean(id));
  await Promise.all(
    ids.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(
        () => undefined,
      ),
    ),
  );
}

async function scheduleTimerNotifications({
  title,
  mode,
  targetSeconds,
  elapsedSeconds,
  alertMinutes,
  translate,
}: {
  title: string;
  mode: ActivityTimer["mode"];
  targetSeconds?: number;
  elapsedSeconds: number;
  alertMinutes: number[];
  translate: (source: string) => string;
}) {
  if (Platform.OS === "web")
    return { notificationId: undefined, notificationIds: [] };
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    return { notificationId: undefined, notificationIds: [] };
  const notificationIds = await Promise.all(
    [...new Set(alertMinutes)]
      .filter((minutes) => minutes > 0 && minutes * 60 > elapsedSeconds)
      .filter(
        (minutes) =>
          mode !== "countdown" ||
          !targetSeconds ||
          minutes * 60 < targetSeconds,
      )
      .map((minutes) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: translate(`${title} · ${minutes} min`),
            body: translate("Your timed activity is still running."),
            data: { route: "/timer" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.max(1, Math.round(minutes * 60 - elapsedSeconds)),
          },
        }),
      ),
  );
  const remaining =
    mode === "countdown"
      ? Math.max(0, (targetSeconds ?? 0) - elapsedSeconds)
      : 0;
  const notificationId =
    mode === "countdown" && remaining >= 1
      ? await Notifications.scheduleNotificationAsync({
          content: {
            title: translate(`${title} complete`),
            body: translate("Your activity timer has finished."),
            sound: "default",
            data: { route: "/timer" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.max(1, Math.round(remaining)),
          },
        })
      : undefined;
  return { notificationId, notificationIds };
}

export default function ActivityTimerPage() {
  const tutorialSandbox = useTutorialSandboxActive();
  const tutorial = useTutorial();
  const params = useLocalSearchParams<{
    metric?: string;
    date?: string;
    duration?: string;
    timer?: string;
  }>();
  const {
    state,
    setActivityTimer,
    logMetric,
    updateSettings,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language, t } = useLocalization();
  const timers = useMemo(
    () =>
      state.activityTimers?.length
        ? state.activityTimers
        : state.activeTimer
          ? [state.activeTimer]
          : [],
    [state.activeTimer, state.activityTimers],
  );
  const [selectedTimerId, setSelectedTimerId] = useState(
    params.timer ?? state.activeTimer?.id ?? timers[0]?.id ?? "",
  );
  const [creatingNew, setCreatingNew] = useState(
    (tutorialSandbox && tutorial.activeStep?.target === "timer-setup") ||
      timers.length === 0,
  );
  const timer = creatingNew
    ? undefined
    : timers.find((item) => item.id === selectedTimerId) ?? timers[0];
  const metrics = useMemo(
    () =>
      state.metrics.filter(
        (metric) =>
          metric.dataType === "number" &&
          metric.manualEntry !== false &&
          metric.timerEnabled,
      ),
    [state.metrics],
  );
  const [metricId, setMetricId] = useState(
    timer?.metricId ??
      (tutorialSandbox && metrics.some((item) => item.id === "reading")
        ? "reading"
        : undefined) ??
      (params.metric && metrics.some((item) => item.id === params.metric)
        ? params.metric
        : metrics[0]?.id) ??
      "",
  );
  const [mode, setMode] = useState<ActivityTimer["mode"]>(
    timer?.mode ?? (tutorialSandbox ? "countdown" : "stopwatch"),
  );
  const plannedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : dateKey();
  const [targetMinutes, setTargetMinutes] = useState(
    Math.max(1, Math.round(Number(params.duration) || 25)),
  );
  const [autoLog, setAutoLog] = useState(timer?.autoLog ?? false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [customAlert, setCustomAlert] = useState("");
  const [now, setNow] = useState(Date.now());
  const alertMinutes = state.settings.activityTimerAlertMinutes ?? [30, 60];
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (tutorialSandbox && tutorial.activeStep?.target === "timer-setup")
      setCreatingNew(true);
  }, [tutorial.activeStep?.target, tutorialSandbox]);
  useEffect(() => {
    if (creatingNew || !timers.length) return;
    if (!timers.some((item) => item.id === selectedTimerId))
      setSelectedTimerId(timers[0].id);
  }, [creatingNew, selectedTimerId, timers]);
  useEffect(() => {
    const expired = timers.find(
      (item) =>
        item.mode === "countdown" &&
        item.status === "running" &&
        activityTimerDisplaySeconds(item, now) <= 0,
    );
    if (expired) void finish(expired);
    // finish is intentionally driven only when a persisted timer reaches 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, timers]);
  const metric = state.metrics.find((item) => item.id === (timer?.metricId ?? metricId));
  const start = async () => {
    if (!metric)
      return Alert.alert("Choose a timed tracker", "Add one first if needed.");
    const targetSeconds = mode === "countdown" ? targetMinutes * 60 : undefined;
    const notifications = tutorialSandbox
      ? { notificationId: undefined, notificationIds: [] }
      : await scheduleTimerNotifications({
      title: localizeMetricName(language, metric),
      mode,
      targetSeconds,
      elapsedSeconds: 0,
      alertMinutes,
      translate: t,
    });
    const id = `timer-${Date.now().toString(36)}`;
    setActivityTimer({
      id,
      metricId: metric.id,
      mode,
      targetSeconds,
      autoLog,
      startedAt: new Date().toISOString(),
      status: "running",
      accumulatedSeconds: 0,
      laps: [],
      ...notifications,
    });
    if (tutorialSandbox)
      tutorial.reportEvent({
        actionId: "tutorial.timer.start",
        scope: "isolated-preview",
      });
    setSelectedTimerId(id);
    setCreatingNew(false);
  };
  const pause = async () => {
    if (!timer) return;
    if (!tutorialSandbox) await cancelTimerNotifications(timer);
    setActivityTimer({
      ...timer,
      accumulatedSeconds: activityTimerElapsedSeconds(timer),
      status: "paused",
      pausedAt: new Date().toISOString(),
      notificationId: undefined,
      notificationIds: [],
    });
  };
  const resume = async () => {
    if (!timer || !metric) return;
    const notifications = tutorialSandbox
      ? { notificationId: undefined, notificationIds: [] }
      : await scheduleTimerNotifications({
      title: localizeMetricName(language, metric),
      mode: timer.mode,
      targetSeconds: timer.targetSeconds,
      elapsedSeconds: timer.accumulatedSeconds,
      alertMinutes,
      translate: t,
    });
    setActivityTimer({
      ...timer,
      startedAt: new Date().toISOString(),
      status: "running",
      pausedAt: undefined,
      ...notifications,
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
          seconds: activityTimerElapsedSeconds(timer),
          recordedAt: new Date().toISOString(),
        },
      ],
    });
  };
  const finish = async (target = timer) => {
    if (!target) return;
    if (!tutorialSandbox) await cancelTimerNotifications(target);
    const seconds =
      target.mode === "countdown"
        ? Math.min(
            target.targetSeconds ?? 0,
            activityTimerElapsedSeconds(target),
          )
        : activityTimerElapsedSeconds(target);
    const targetMetric = state.metrics.find(
      (item) => item.id === target.metricId,
    );
    if (!targetMetric) {
      setActivityTimer(undefined, target.id);
      return;
    }
    const value = /hour|hr/i.test(targetMetric.unit)
      ? seconds / 3600
      : /sec/i.test(targetMetric.unit)
        ? seconds
        : seconds / 60;
    setActivityTimer(undefined, target.id);
    if (target.autoLog) {
      logMetric(target.metricId, value, targetMetric.defaultVisibility, "add", {
        localDate: plannedDate,
        label: "Activity timer",
        note: `${target.laps.length} lap${target.laps.length === 1 ? "" : "s"}`,
      });
      router.back();
    } else {
      router.replace({
        pathname: "/log",
        params: {
          metric: target.metricId,
          date: plannedDate,
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
      {timers.length ? (
        <Card style={styles.timerList}>
          <View style={styles.timerListHeading}>
            <View style={styles.grow}>
              <Text style={[styles.label, { color: colors.ink }]}>Active timers</Text>
              <Text style={[styles.helper, { color: colors.muted }]}>
                {timers.length} running or paused
              </Text>
            </View>
            <IconButton
              icon={
                state.settings.showActivityTimerOverlay === false
                  ? "eye-off-outline"
                  : "eye-outline"
              }
              label={
                state.settings.showActivityTimerOverlay === false
                  ? "Show floating timer"
                  : "Hide floating timer"
              }
              onPress={() =>
                updateSettings({
                  showActivityTimerOverlay:
                    state.settings.showActivityTimerOverlay === false,
                })
              }
            />
            <IconButton
              icon="add"
              label="Start another timer"
              onPress={() => setCreatingNew(true)}
            />
          </View>
          <View style={styles.timerChoices}>
            {timers.map((item) => {
              const itemMetric = state.metrics.find(
                (metricItem) => metricItem.id === item.metricId,
              );
              if (!itemMetric) return null;
              const selected = !creatingNew && timer?.id === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setSelectedTimerId(item.id);
                    setCreatingNew(false);
                  }}
                  style={[
                    styles.timerChoice,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected
                        ? colors.primarySoft
                        : colors.canvas,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.status === "paused" ? "pause" : "timer-outline"}
                    size={15}
                    color={selected ? accent : colors.muted}
                  />
                  <View style={styles.grow}>
                    <Text
                      translate={false}
                      numberOfLines={1}
                      style={[styles.timerChoiceName, { color: colors.ink }]}
                    >
                      {localizeMetricName(language, itemMetric)}
                    </Text>
                    <Text style={[styles.timerChoiceTime, { color: colors.muted }]}>
                      {formatActivityTimer(activityTimerDisplaySeconds(item, now))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}
      {timer && metric ? (
        <>
          <TutorialTarget id="timer-active">
          <Card style={styles.live}>
            <Text translate={false} style={[styles.metric, { color: accent }]}>
              {localizeMetricName(language, metric)}
            </Text>
            <Text style={[styles.clock, { color: colors.ink }]}>
              {formatActivityTimer(
                activityTimerDisplaySeconds(timer, now),
              )}
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
          </TutorialTarget>
          {timer.laps.length ? (
            <Card style={styles.laps}>
              {timer.laps.map((item, index) => (
                <View key={item.id} style={styles.lap}>
                  <Text style={[styles.lapText, { color: colors.muted }]}>
                    Lap {index + 1}
                  </Text>
                  <Text style={[styles.lapValue, { color: colors.ink }]}>
                    {formatActivityTimer(item.seconds)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <TutorialTarget id="timer-setup">
          <Card style={styles.setup}>
            {params.date ? (
              <Text style={[styles.helper, { color: colors.muted }]}>Planned for {plannedDate}. Confirm Start when you are ready.</Text>
            ) : null}
            <MetricSelector
              title="Choose a timed tracker"
              items={metrics.map((item) => ({
                id: item.id,
                label: item.name,
                icon: item.icon as keyof typeof Ionicons.glyphMap,
                color: item.color,
                group:
                  item.grouping ||
                  (item.category === "mind"
                    ? "Mind & focus"
                    : "Other timed trackers"),
              }))}
              selectedIds={metricId ? [metricId] : []}
              onChange={(ids) => setMetricId(ids[0] ?? "")}
              multiple={false}
              collapsibleGroups={["Mind & focus", "Other timed trackers"]}
            />
            <Pressable
              onPress={() =>
                router.navigate({
                  pathname: "/metric-editor",
                  params: { id: "new", focus: "timer" },
                } as never)
              }
            >
              <Text style={[styles.link, { color: accent }]}>
                {metrics.length
                  ? "Create another timed tracker"
                  : "Create a duration tracker"}
              </Text>
            </Pressable>
            {!metrics.length ? (
              <Text style={[styles.helper, { color: colors.muted }]}>
                Create a number tracker and turn on “Timed activity”.
              </Text>
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
              onPress={() => setAlertsOpen((open) => !open)}
              style={[styles.alertHeading, { borderColor: colors.border }]}
            >
              <View style={styles.alertCopy}>
                <Text style={[styles.label, { color: colors.ink }]}>
                  Timer alerts
                </Text>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  {alertMinutes.length
                    ? alertMinutes.map((item) => `${item}m`).join(" · ")
                    : "Off"}
                </Text>
              </View>
              <Ionicons
                name={alertsOpen ? "chevron-up" : "chevron-down"}
                size={17}
                color={colors.faint}
              />
            </Pressable>
            {alertsOpen ? (
              <View style={styles.alertPanel}>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  Notify after these elapsed times. Countdown completion is
                  always scheduled separately.
                </Text>
                <View style={styles.wrap}>
                  {[5, 15, 30, 60, 120].map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes} min`}
                      selected={alertMinutes.includes(minutes)}
                      onPress={() =>
                        updateSettings({
                          activityTimerAlertMinutes: alertMinutes.includes(
                            minutes,
                          )
                            ? alertMinutes.filter((item) => item !== minutes)
                            : [...alertMinutes, minutes].sort((a, b) => a - b),
                        })
                      }
                    />
                  ))}
                </View>
                <View style={styles.customAlert}>
                  <TextInput
                    value={customAlert}
                    onChangeText={setCustomAlert}
                    keyboardType="numeric"
                    placeholder="Custom minutes"
                    placeholderTextColor={colors.faint}
                    style={[
                      styles.customAlertInput,
                      { color: colors.ink, borderColor: colors.border },
                    ]}
                  />
                  <Pressable
                    onPress={() => {
                      const minutes = Math.max(
                        1,
                        Math.round(Number(customAlert)),
                      );
                      if (!Number.isFinite(minutes)) return;
                      updateSettings({
                        activityTimerAlertMinutes: [
                          ...new Set([...alertMinutes, minutes]),
                        ].sort((a, b) => a - b),
                      });
                      setCustomAlert("");
                    }}
                    style={[styles.addAlert, { backgroundColor: accent }]}
                  >
                    <Ionicons name="add" size={17} color="#FFFFFF" />
                  </Pressable>
                </View>
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
          </TutorialTarget>
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
  grow: { flex: 1, minWidth: 0 },
  timerList: { gap: 8, marginBottom: 8 },
  timerListHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timerChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  timerChoice: {
    width: "48.8%",
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerChoiceName: { fontSize: 8, fontWeight: "900" },
  timerChoiceTime: { fontSize: 8, fontWeight: "800", marginTop: 1 },
  setup: { gap: 10 },
  label: { fontSize: 10, fontWeight: "900" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  link: { fontSize: 9, fontWeight: "900", textAlign: "center" },
  helper: { fontSize: 8, lineHeight: 12, textAlign: "center" },
  alertHeading: {
    minHeight: 42,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
  },
  alertCopy: { flex: 1, minWidth: 0 },
  alertPanel: { gap: 7 },
  customAlert: { flexDirection: "row", alignItems: "center", gap: 6 },
  customAlertInput: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 9,
  },
  addAlert: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
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
