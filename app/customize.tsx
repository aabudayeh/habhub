import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  UIManager,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";
import { ReorderItem } from "@/src/components/ReorderItem";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { useSmoothReorderGesture } from "@/src/components/useSmoothReorderGesture";
import { setCloudSyncPaused } from "@/src/cloud/syncGate";

import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { formatMetricValue, isMetricTrackedOnDate } from "@/src/domain/metrics";
import { formulaIdentifiers } from "@/src/domain/formula";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { DashboardSection, MetricDefinition } from "@/src/types";

type Tab = "today" | "insights" | "trackers" | "goals";
const tabs: { id: Tab; label: string }[] = [
  { id: "trackers", label: "All Trackers" },
  { id: "goals", label: "Tracked goals" },
  { id: "today", label: "Today" },
  { id: "insights", label: "Progress" },
];

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Customize() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const {
    state,
    setMetricSection,
    setTrackedGoal,
    updateSettings,
    reorderMetric,
    deleteMetric,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const { language } = useLocalization();
  const initial = tabs.some((item) => item.id === params.tab)
    ? (params.tab as Tab)
    : "trackers";
  const [tab, setTab] = useState<Tab>(initial);
  const swipeGesture = usePageSwipeGesture({
    onPrevious: () => {
      const index = tabs.findIndex((item) => item.id === tab);
      setTab(tabs[Math.max(0, index - 1)].id);
    },
    onNext: () => {
      const index = tabs.findIndex((item) => item.id === tab);
      setTab(tabs[Math.min(tabs.length - 1, index + 1)].id);
    },
  });
  const [draggingMetricId, setDraggingMetricId] = useState<string | null>(null);
  useEffect(() => {
    setCloudSyncPaused("customize-reorder", Boolean(draggingMetricId));
    return () => setCloudSyncPaused("customize-reorder", false);
  }, [draggingMetricId]);
  const ordered = state.metrics
    .filter((metric) => !isInternalTracker(metric))
    .sort((a, b) => a.order - b.order);

  function changeTrackedGoal(metric: MetricDefinition, value: boolean) {
    const action = value ? "Start tracking" : "Stop tracking";
    Alert.alert(
      `${action} ${metric.name}?`,
      "Choose whether this change should alter earlier progress reports.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "From today",
          onPress: () => setTrackedGoal(metric.id, value, "today"),
        },
        {
          text: "Apply to history",
          onPress: () => setTrackedGoal(metric.id, value, "history"),
        },
      ],
    );
  }

  function changeAllTracked(value: boolean) {
    const applicable = ordered.filter((metric) => metric.dataType !== "text");
    Alert.alert(
      value ? "Track every configured goal?" : "Stop tracking every goal?",
      "Choose whether this should also change earlier progress reports.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "From today",
          onPress: () =>
            applicable.forEach((metric) =>
              setTrackedGoal(metric.id, value, "today"),
            ),
        },
        {
          text: "Apply to history",
          onPress: () =>
            applicable.forEach((metric) =>
              setTrackedGoal(metric.id, value, "history"),
            ),
        },
      ],
    );
  }

  function reorderForSection(metricId: string, target: number) {
    const next = [...ordered];
    const index = next.findIndex((metric) => metric.id === metricId);
    if (index < 0) return;
    const [moved] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
    reorderMetric(metricId, target);
    if (tab === "insights") {
      const selected = new Set(state.settings.progressMetricIds);
      updateSettings({
        progressMetricIds: [
          ...(selected.has("tracked_goals") ? ["tracked_goals"] : []),
          ...next
            .map((metric) => metric.id)
            .filter((id) => selected.has(id)),
        ],
      });
    }
  }

  function changeSection(metric: MetricDefinition) {
    const visible = !metric.sections[tab as DashboardSection];
    setMetricSection(metric.id, tab as DashboardSection, visible);
    if (tab === "insights") {
      const current = state.settings.progressMetricIds.filter(
        (id) => id !== metric.id,
      );
      updateSettings({
        progressMetricIds: visible ? [...current, metric.id] : current,
      });
    }
  }

  function setAllInSection(visible: boolean) {
    ordered.forEach((metric) =>
      setMetricSection(metric.id, tab as DashboardSection, visible),
    );
    if (tab === "insights") {
      const tracked = state.settings.progressMetricIds.includes("tracked_goals")
        ? ["tracked_goals"]
        : [];
      updateSettings({
        progressMetricIds: visible
          ? [...tracked, ...ordered.map((metric) => metric.id)]
          : tracked,
      });
    }
  }

  function removeTracker(metric: MetricDefinition) {
    const dependencies = ordered.filter(
      (item) =>
        item.formula &&
        formulaIdentifiers(item.formula).includes(metric.id),
    );
    if (dependencies.length) {
      Alert.alert(
        "Used by another tracker",
        `Remove it from ${dependencies.map((item) => item.name).join(", ")} first.`,
      );
      return;
    }
    Alert.alert(
      `Delete ${metric.name}?`,
      "This removes the tracker and its earlier entries. Blood pressure readings remove both linked values together.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete tracker",
          style: "destructive",
          onPress: () => deleteMetric(metric.id),
        },
      ],
    );
  }

  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={styles.pageGesture}>
    <Screen refreshEnabled={false}>
      <PageHeader
        title="Customize"
        subtitle="Only your selected trackers appear here. Group competition is managed in Group settings."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setTab(item.id)}
            style={[
              styles.tab,
              {
                borderColor: tab === item.id ? accent : "transparent",
                backgroundColor:
                  tab === item.id ? colors.primarySoft : "transparent",
              },
            ]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={[
                styles.tabText,
                { color: tab === item.id ? accent : colors.muted },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </Card>

      {tab === "trackers" ? (
        <>
          <SectionHeader
            title="Your trackers"
            action={
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/metric-editor" as never,
                    params: { id: "new" },
                  })
                }
              >
                <Text style={[styles.link, { color: accent }]}>+ Add</Text>
              </Pressable>
            }
          />
          <Card style={styles.list}>
            {ordered.map((metric, index) => (
              <Pressable
                key={metric.id}
                onPress={() =>
                  router.push({
                    pathname: "/metric-editor" as never,
                    params: { id: metric.id },
                  })
                }
                style={[
                  styles.row,
                  index < ordered.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <TrackerIcon metric={metric} />
                <View style={styles.copy}>
                  <Text translate={false} style={[styles.name, { color: colors.ink }]}>
                    {localizeMetricName(language, metric)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {metric.dataType === "calculated"
                      ? "Calculated automatically"
                      : metric.goalEnabled === false
                        ? "No target"
                        : `Target ${formatMetricValue(metric, metric.goal.target)}`}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={`Delete ${metric.name}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    removeTracker(metric);
                  }}
                  style={styles.deleteTracker}
                >
                  <Ionicons
                    name="trash-outline"
                    size={17}
                    color="#C84A45"
                  />
                </Pressable>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={colors.faint}
                />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {tab === "goals" ? (
        <>
          <SectionHeader
            title="Goals being counted"
            action={
              <BulkActions
                onAll={() => changeAllTracked(true)}
                onClear={() => changeAllTracked(false)}
              />
            }
          />
          <Card style={styles.list}>
            {ordered
              .filter((metric) => metric.dataType !== "text")
              .map((metric, index, list) => {
                const selected = isMetricTrackedOnDate(
                  state,
                  metric,
                  new Date().toISOString().slice(0, 10),
                );
                return (
                  <View
                    key={metric.id}
                    style={[
                      styles.row,
                      index < list.length - 1 && {
                        borderBottomColor: colors.border,
                        borderBottomWidth: 1,
                      },
                    ]}
                  >
                    <TrackerIcon metric={metric} />
                    <View style={styles.copy}>
                      <Text translate={false} style={[styles.name, { color: colors.ink }]}>
                        {localizeMetricName(language, metric)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {metric.goalEnabled === false
                          ? "Informational by default; selecting it enables its configured target"
                          : selected
                            ? `Included since ${new Date(`${(state.trackedGoalPeriods[metric.id]?.find((period) => !period.to)?.from ?? metric.activeFrom)}T12:00:00`).toLocaleDateString(locale)}`
                            : "Not counted"}
                      </Text>
                    </View>
                    {selected ? (
                      <Pressable
                        accessibilityLabel={`Change ${metric.name} goal start date`}
                        onPress={() =>
                          router.push({
                            pathname: "/metric-editor" as never,
                            params: { id: metric.id, focus: "goal-start" },
                          })
                        }
                        style={[styles.dateEdit, { borderColor: colors.border }]}
                      >
                        <Ionicons name="calendar-outline" size={15} color={accent} />
                      </Pressable>
                    ) : null}
                    <Switch
                      value={selected}
                      onValueChange={(value) =>
                        changeTrackedGoal(metric, value)
                      }
                      trackColor={{ false: colors.border, true: `${accent}88` }}
                      thumbColor={selected ? accent : colors.faint}
                    />
                  </View>
                );
              })}
          </Card>
        </>
      ) : null}

      {tab === "today" || tab === "insights" ? (
        <>
          {false ? <Card style={styles.quickPreferences}>
            <View style={styles.preferenceCopy}>
              <Text style={[styles.name, { color: colors.ink }]}>
                Untracked goals
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                Keep other trackers available or focus only on tracked goals.
              </Text>
            </View>
            <View style={styles.preferenceChoices}>
              <Chip
                label="Show"
                selected={
                  tab === "today"
                    ? state.settings.showUntrackedToday !== false
                    : state.settings.showUntrackedProgress !== false
                }
                onPress={() =>
                  updateSettings(
                    tab === "today"
                      ? { showUntrackedToday: true }
                      : { showUntrackedProgress: true },
                  )
                }
              />
              <Chip
                label="Hide"
                selected={
                  tab === "today"
                    ? state.settings.showUntrackedToday === false
                    : state.settings.showUntrackedProgress === false
                }
                onPress={() =>
                  updateSettings(
                    tab === "today"
                      ? { showUntrackedToday: false }
                      : { showUntrackedProgress: false },
                  )
                }
              />
            </View>
          </Card> : null}
          {false && tab === "today" ? (
            <Card style={styles.quickPreferences}>
              <View style={styles.preferenceCopy}>
                <Text style={[styles.name, { color: colors.ink }]}>
                  Completed goals
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  Keep completed goals in place, move them down, or hide them.
                </Text>
              </View>
              <View style={styles.preferenceChoices}>
                <Chip
                  label="Do nothing"
                  selected={state.settings.completedTodayBehavior === "stay"}
                  onPress={() =>
                    updateSettings({ completedTodayBehavior: "stay" })
                  }
                />
                <Chip
                  label="Move down"
                  selected={
                    (state.settings.completedTodayBehavior ?? "bottom") ===
                    "bottom"
                  }
                  onPress={() =>
                    updateSettings({ completedTodayBehavior: "bottom" })
                  }
                />
                <Chip
                  label="Hide"
                  selected={state.settings.completedTodayBehavior === "hide"}
                  onPress={() =>
                    updateSettings({ completedTodayBehavior: "hide" })
                  }
                />
              </View>
            </Card>
          ) : null}
          <Pressable
            onPress={() =>
              router.navigate({
                pathname: "/view-filters",
                params: { scope: tab === "today" ? "today" : "progress" },
              } as never)
            }
            style={[styles.filterManager, { borderColor: accent }]}
          >
            <Ionicons name="funnel-outline" size={16} color={accent} />
            <Text style={[styles.filterManagerText, { color: accent }]}>
              Manage saved views
            </Text>
          </Pressable>
          <SectionHeader
            title={tab === "today" ? "Today tiles" : "Progress items"}
            action={
              <BulkActions
                onAll={() => setAllInSection(true)}
                onClear={() => setAllInSection(false)}
              />
            }
          />
          <Card style={styles.list}>
            {ordered.map((metric, index) => (
              <ReorderItem
                key={metric.id}
                active={draggingMetricId === metric.id}
              >
                <VisibilityRow
                  metric={metric}
                  section={tab}
                  last={index === ordered.length - 1}
                  colors={colors}
                  accent={accent}
                  index={index}
                  count={ordered.length}
                  onMove={(target) => reorderForSection(metric.id, target)}
                  onChange={() => changeSection(metric)}
                  onDragStart={(step) => {
                    setDraggingMetricId(metric.id);
                  }}
                  onDragHover={() => {}}
                  onDragCancel={() => setDraggingMetricId(null)}
                  onDragEnd={() => {
                    setDraggingMetricId(null);
                  }}
                />
              </ReorderItem>
            ))}
          </Card>
        </>
      ) : null}

    </Screen>
    </View>
    </GestureDetector>
  );
}

function BulkActions({
  onAll,
  onClear,
}: {
  onAll: () => void;
  onClear: () => void;
}) {
  const accent = useGroupAccent();
  return (
    <View style={styles.bulkActions}>
      <Pressable onPress={onAll}>
        <Text style={[styles.bulkLink, { color: accent }]}>All</Text>
      </Pressable>
      <Text style={[styles.bulkDot, { color: accent }]}>•</Text>
      <Pressable onPress={onClear}>
        <Text style={[styles.bulkLink, { color: accent }]}>Clear</Text>
      </Pressable>
    </View>
  );
}

function TrackerIcon({ metric }: { metric: MetricDefinition }) {
  return (
    <View style={[styles.icon, { backgroundColor: `${metric.color}18` }]}>
      <Ionicons
        name={metric.icon as keyof typeof Ionicons.glyphMap}
        size={18}
        color={metric.color}
      />
    </View>
  );
}
function VisibilityRow({
  metric,
  section,
  last,
  colors,
  accent,
  onChange,
  index,
  count,
  onMove,
  onDragStart,
  onDragHover,
  onDragCancel,
  onDragEnd,
}: {
  metric: MetricDefinition;
  section: DashboardSection;
  last: boolean;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
  onChange: () => void;
  index: number;
  count: number;
  onMove: (target: number) => void;
  onDragStart: (step: number) => void;
  onDragHover: (target: number) => void;
  onDragCancel: () => void;
  onDragEnd: () => void;
}) {
  const { language, t } = useLocalization();
  const metricName = localizeMetricName(language, metric);
  const wiggle = useRef(new Animated.Value(0)).current;
  const dragStep = useRef(56);
  const smoothDrag = useSmoothReorderGesture({
    enabled: true,
    index,
    count,
    initialStep: dragStep.current,
    onMove,
    onStart: () => onDragStart(dragStep.current),
    onTargetChange: onDragHover,
    onCancel: onDragCancel,
    onEnd: onDragEnd,
  });
  useEffect(() => {
    if (!smoothDrag.dragging) {
      wiggle.stopAnimation();
      wiggle.setValue(0);
      return;
    }
    const animation = Animated.sequence([
      Animated.timing(wiggle, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(wiggle, {
        toValue: -1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(wiggle, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [smoothDrag.dragging, wiggle]);
  return (
    <Reanimated.View
      onLayout={(event) => {
        dragStep.current = event.nativeEvent.layout.height;
        smoothDrag.setStep(dragStep.current);
      }}
      style={[
        styles.row,
        !last && { borderBottomColor: colors.border, borderBottomWidth: 1 },
        smoothDrag.animatedStyle,
        {
          zIndex: smoothDrag.dragging ? 12 : 1,
          elevation: smoothDrag.dragging ? 8 : 0,
        },
      ]}
    >
      <Animated.View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          gap: 9,
          transform: [
            {
              rotate: wiggle.interpolate({
                inputRange: [-1, 1],
                outputRange: ["-0.15deg", "0.15deg"],
              }),
            },
          ],
        }}
      >
      <GestureDetector gesture={smoothDrag.gesture}>
      <View
        collapsable={false}
        accessibilityLabel={t(`Reorder ${metricName}`)}
        style={styles.dragHandle}
      >
        <Ionicons name="reorder-three-outline" size={22} color={accent} />
      </View>
      </GestureDetector>
      <TrackerIcon metric={metric} />
      <View style={styles.copy}>
        <Text translate={false} style={[styles.name, { color: colors.ink }]}>
          {metricName}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {metric.sections[section] ? "Visible" : "Hidden"}
        </Text>
      </View>
      <Switch
        value={metric.sections[section]}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: `${accent}88` }}
        thumbColor={metric.sections[section] ? accent : colors.faint}
      />
      </Animated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  bulkActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  bulkLink: { fontSize: 9, fontWeight: "900" },
  bulkDot: { fontSize: 9 },
  pageGesture: { flex: 1 },
  tabs: {
    minHeight: 42,
    padding: 4,
    flexDirection: "row",
    gap: 3,
    marginBottom: 6,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabText: { fontSize: 8, fontWeight: "900" },
  list: { paddingVertical: 2, paddingHorizontal: 11 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 2,
  },
  icon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  name: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  link: { fontSize: 11, fontWeight: "900" },
  deleteTracker: { padding: 7 },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderWidth: 1,
    borderRadius: 14,
  },
  dragHandle: {
    width: 26,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  noteText: { flex: 1, fontSize: 9, lineHeight: 14 },
  quickPreferences: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
  },
  preferenceCopy: { flex: 1, minWidth: 0 },
  preferenceChoices: { flexDirection: "row", gap: 4 },
  filterManager: {
    minHeight: 40,
    marginTop: 7,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  filterManagerText: { fontSize: 9, fontWeight: "900" },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  orderButtons: { alignItems: "center", justifyContent: "center", gap: 1 },
  dateEdit: { width: 32, height: 32, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
