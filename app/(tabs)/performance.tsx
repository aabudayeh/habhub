import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { Card, Chip, PageHeader, Screen } from "@/src/components/ui";
import { formatMetricValue } from "@/src/domain/metrics";
import { performanceOverview } from "@/src/domain/performance";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export default function PerformancePage() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [days, setDays] = useState<7 | 30>(7);
  const overview = useMemo(
    () => performanceOverview(state, days),
    [days, state],
  );
  return (
    <Screen>
      <PageHeader
        title="Performance"
        subtitle="What improved, what held steady, and where your next win is."
        action={
          <Pressable
            onPress={() => router.push("/customize?tab=insights" as never)}
            style={styles.headerButton}
          >
            <Ionicons name="settings-outline" size={18} color={accent} />
          </Pressable>
        }
      />
      <View style={styles.range}>
        <Chip label="This week vs last" selected={days === 7} onPress={() => setDays(7)} />
        <Chip label="30 days vs prior" selected={days === 30} onPress={() => setDays(30)} />
      </View>
      {overview.strengths.length ? (
        <Card style={styles.callout}>
          <Ionicons name="sparkles" size={22} color={palette.lime} />
          <View style={styles.copy}>
            <Text style={[styles.calloutTitle, { color: colors.ink }]}>
              Strongest right now
            </Text>
            <Text style={[styles.calloutBody, { color: colors.muted }]}>
              {overview.strengths.map((row) => row.metric.name).join(", ")}
            </Text>
          </View>
        </Card>
      ) : null}
      <View style={styles.rows}>
        {overview.rows.map((row) => {
          const change = Math.round(Math.abs(row.changePercent));
          const color =
            row.direction === "steady"
              ? colors.muted
              : row.improving
                ? palette.lime
                : palette.red;
          return (
            <Pressable
              key={row.metric.id}
              onPress={() =>
                router.push({
                  pathname: "/metric-detail",
                  params: { metric: row.metric.id, period: days === 7 ? "week" : "month" },
                } as never)
              }
              onLongPress={() => router.push("/customize?tab=insights" as never)}
            >
              <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: `${row.metric.color}1F` }]}>
                  <Ionicons
                    name={row.metric.icon as keyof typeof Ionicons.glyphMap}
                    size={20}
                    color={row.metric.color}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.name, { color: colors.ink }]}>
                    {row.metric.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {formatMetricValue(row.metric, row.current)} avg ·{" "}
                    {Math.round(row.currentGoalRate * 100)}% goal rate
                  </Text>
                </View>
                <View style={styles.change}>
                  <Ionicons
                    name={
                      row.direction === "steady"
                        ? "remove"
                        : row.improving
                          ? "arrow-up"
                          : "arrow-down"
                    }
                    size={17}
                    color={color}
                  />
                  <Text style={[styles.changeText, { color }]}>
                    {row.direction === "steady" ? "Steady" : `${change}%`}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
      {overview.opportunities.length ? (
        <Card style={styles.callout}>
          <Ionicons name="trail-sign-outline" size={22} color={palette.amber} />
          <View style={styles.copy}>
            <Text style={[styles.calloutTitle, { color: colors.ink }]}>
              Best areas to improve
            </Text>
            <Text style={[styles.calloutBody, { color: colors.muted }]}>
              {overview.opportunities.map((row) => row.metric.name).join(", ")}
            </Text>
          </View>
        </Card>
      ) : null}
      {!overview.rows.length ? (
        <Card>
          <Text style={[styles.empty, { color: colors.muted }]}>
            Log a few days to unlock meaningful comparisons.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  range: { flexDirection: "row", gap: 6, marginBottom: 5 },
  rows: { gap: 7 },
  row: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9 },
  icon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 10, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 3 },
  change: { alignItems: "center", minWidth: 45 },
  changeText: { fontSize: 8, fontWeight: "900", marginTop: 1 },
  callout: { flexDirection: "row", alignItems: "center", gap: 10 },
  calloutTitle: { fontSize: 10, fontWeight: "900" },
  calloutBody: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  empty: { fontSize: 9, lineHeight: 14, textAlign: "center" },
});
