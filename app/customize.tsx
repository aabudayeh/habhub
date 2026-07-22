import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import {
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { formatMetricValue, isMetricTrackedOnDate } from "@/src/domain/metrics";
import { messageLibrary } from "@/src/domain/social";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { BanterTone, DashboardSection, MetricDefinition } from "@/src/types";

type Tab = "trackers" | "goals" | "today" | "insights" | "social";
const tabs: { id: Tab; label: string }[] = [
  { id: "trackers", label: "Trackers" },
  { id: "goals", label: "Tracked goals" },
  { id: "today", label: "Today" },
  { id: "insights", label: "Progress" },
  { id: "social", label: "Social" },
];

export default function Customize() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { state, setMetricSection, setTrackedGoal, updateSettings, moveMetric } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const initial = tabs.some((item) => item.id === params.tab)
    ? (params.tab as Tab)
    : "trackers";
  const [tab, setTab] = useState<Tab>(initial);
  const ordered = [...state.metrics].sort((a, b) => a.order - b.order);

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

  return (
    <Screen>
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
      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            selected={tab === item.id}
            onPress={() => setTab(item.id)}
          />
        ))}
      </View>

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
                  <Text style={[styles.name, { color: colors.ink }]}>
                    {metric.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {metric.dataType === "calculated"
                      ? "Calculated automatically"
                      : metric.goalEnabled === false
                        ? "No target"
                        : `Target ${formatMetricValue(metric, metric.goal.target)}`}
                  </Text>
                </View>
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
          <Card
            style={[
              styles.note,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="checkmark-done-outline" size={19} color={accent} />
            <Text style={[styles.noteText, { color: colors.muted }]}>
              These are the goals counted in Today and historical completion.
              Showing a tracker on Today is a separate choice.
            </Text>
          </Card>
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
                      <Text style={[styles.name, { color: colors.ink }]}>
                        {metric.name}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {metric.goalEnabled === false
                          ? "Informational by default; selecting it enables its configured target"
                          : selected
                            ? "Included in daily completion"
                            : "Not counted"}
                      </Text>
                    </View>
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
          <Card
            style={[
              styles.note,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="eye-outline" size={19} color={accent} />
            <Text style={[styles.noteText, { color: colors.muted }]}>
              {tab === "today"
                ? "Choose the compact tiles visible on Today. Up to five fit before More appears."
                : "Choose what is available in your personal Progress view."}
            </Text>
          </Card>
          <SectionHeader
            title={tab === "today" ? "Today tiles" : "Progress items"}
            action={
              <BulkActions
                onAll={() =>
                  ordered.forEach((metric) =>
                    setMetricSection(metric.id, tab, true),
                  )
                }
                onClear={() =>
                  ordered.forEach((metric) =>
                    setMetricSection(metric.id, tab, false),
                  )
                }
              />
            }
          />
          <Card style={styles.list}>
            {ordered.map((metric, index) => (
              <VisibilityRow
                key={metric.id}
                metric={metric}
                section={tab}
                last={index === ordered.length - 1}
                colors={colors}
                accent={accent}
                onMoveUp={() => moveMetric(metric.id, -1)}
                onMoveDown={() => moveMetric(metric.id, 1)}
                onChange={() =>
                  setMetricSection(metric.id, tab, !metric.sections[tab])
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      {tab === "social" ? (
        <>
          <SectionHeader title="Message tone" />
          <Card style={styles.list}>
            {(
              ["supportive", "friendly", "ruthless", "off"] as BanterTone[]
            ).map((tone) => (
              <Pressable
                key={tone}
                onPress={() => updateSettings({ banterTone: tone })}
                style={[
                  styles.row,
                  state.settings.banterTone === tone && {
                    backgroundColor: colors.primarySoft,
                  },
                ]}
              >
                <Ionicons
                  name={
                    state.settings.banterTone === tone
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={20}
                  color={
                    state.settings.banterTone === tone ? accent : colors.faint
                  }
                />
                <View style={styles.copy}>
                  <Text style={[styles.name, { color: colors.ink }]}>
                    {tone[0].toUpperCase() + tone.slice(1)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {tone === "off"
                      ? "No automatic suggestions"
                      : `${messageLibrary("cheer", tone).length} cheers · ${messageLibrary("taunt", tone).length} taunts · ${messageLibrary("reminder", tone).length} reminders`}
                  </Text>
                </View>
              </Pressable>
            ))}
          </Card>
          <Card style={styles.switchCard}>
            <View style={styles.copy}>
              <Text style={[styles.name, { color: colors.ink }]}>
                Automatic goal messages
              </Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                Post a randomized group cheer when a shared goal is reached.
              </Text>
            </View>
            <Switch
              value={state.settings.autoMessages}
              onValueChange={(value) => updateSettings({ autoMessages: value })}
            />
          </Card>
        </>
      ) : null}
    </Screen>
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
  onMoveUp,
  onMoveDown,
}: {
  metric: MetricDefinition;
  section: DashboardSection;
  last: boolean;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
  onChange: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomColor: colors.border, borderBottomWidth: 1 },
      ]}
    >
      <TrackerIcon metric={metric} />
      <View style={styles.copy}>
        <Text style={[styles.name, { color: colors.ink }]}>{metric.name}</Text>
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
      <View style={styles.orderButtons}>
        <Pressable accessibilityLabel="Move up" onPress={onMoveUp} hitSlop={8}>
          <Ionicons name="chevron-up" size={17} color={accent} />
        </Pressable>
        <Pressable accessibilityLabel="Move down" onPress={onMoveDown} hitSlop={8}>
          <Ionicons name="chevron-down" size={17} color={accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bulkActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  bulkLink: { fontSize: 9, fontWeight: "900" },
  bulkDot: { fontSize: 9 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
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
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11 },
  noteText: { flex: 1, fontSize: 9, lineHeight: 14 },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  orderButtons: { alignItems: "center", justifyContent: "center", gap: 1 },
});
