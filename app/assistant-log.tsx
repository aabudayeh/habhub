import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  Button,
  Card,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import {
  AssistantCommandKind,
  AssistantCommandParams,
  assistantLoggableMetrics,
  buildAssistantLogDraft,
} from "@/src/domain/assistant";
import { dateKey } from "@/src/domain/date";
import { trackerGroupLabel } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type RouteParams = {
  [Key in keyof AssistantCommandParams]?: string | string[];
} & { auto?: string | string[] };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function commandParams(params: RouteParams): AssistantCommandParams {
  return {
    kind: first(params.kind),
    tracker: first(params.tracker),
    amount: first(params.amount),
    unit: first(params.unit),
    calories: first(params.calories),
    meal: first(params.meal),
    food: first(params.food),
    systolic: first(params.systolic),
    diastolic: first(params.diastolic),
    pulse: first(params.pulse),
    value: first(params.value),
  };
}

function kindForSelection(kind: string | undefined): AssistantCommandKind {
  if (kind === "complete" || kind === "text") return kind;
  return "number";
}

export default function AssistantLogScreen() {
  const routeParams = useLocalSearchParams<RouteParams>();
  const params = useMemo(() => commandParams(routeParams), [routeParams]);
  const auto = first(routeParams.auto) === "true";
  const { state, logMetric } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [selectedMetricId, setSelectedMetricId] = useState("");
  const [logged, setLogged] = useState(false);
  const autoLoggedSignature = useRef("");
  const selectable = useMemo(
    () => {
      const available = assistantLoggableMetrics(
        state.metrics,
        kindForSelection(params.kind),
      );
      if (params.kind === "food")
        return available.filter((metric) => metric.id === "food");
      if (params.kind === "blood_pressure")
        return available.filter(
          (metric) =>
            metric.id === "blood_pressure_systolic" ||
            (metric.submetrics ?? []).some(
              (submetric) => submetric.id === "diastolic",
            ),
        );
      return available;
    },
    [params.kind, state.metrics],
  );
  const override = state.metrics.find(
    (metric) => metric.id === selectedMetricId,
  );
  const draft = useMemo(
    () => buildAssistantLogDraft(state.metrics, params, override),
    [override, params, state.metrics],
  );
  const selectedIds = draft.metric ? [draft.metric.id] : [];

  const confirm = useCallback(() => {
    if (!draft.metric || draft.value === undefined || draft.error) return;
    const details = {
      localDate: dateKey(),
      note: draft.note,
      label: draft.label,
      nutrition:
        draft.kind === "food" && draft.mealType
          ? { mealType: draft.mealType }
          : undefined,
      submetricValues: draft.submetricValues,
    };
    logMetric(
      draft.metric.id,
      draft.value,
      draft.metric.defaultVisibility,
      draft.metric.dataType === "boolean" ? "replace" : "add",
      details,
    );
    if (draft.kind === "blood_pressure" && draft.submetricValues) {
      for (const submetric of draft.metric.submetrics ?? []) {
        if (!submetric.linkedMetricId) continue;
        const value = draft.submetricValues[submetric.id];
        const linked = state.metrics.find(
          (metric) => metric.id === submetric.linkedMetricId,
        );
        if (value === undefined || !linked) continue;
        logMetric(
          linked.id,
          value,
          linked.defaultVisibility,
          "add",
          {
            localDate: dateKey(),
            note: "Logged with Google Assistant",
            label: draft.label,
          },
        );
      }
    }
    setLogged(true);
  }, [draft, logMetric, state.metrics]);

  const commandSignature = JSON.stringify(params);
  useEffect(() => {
    if (
      !auto ||
      !draft.metric ||
      draft.value === undefined ||
      draft.error ||
      autoLoggedSignature.current === commandSignature
    )
      return;
    autoLoggedSignature.current = commandSignature;
    confirm();
  }, [auto, commandSignature, confirm, draft.error, draft.metric, draft.value]);

  return (
    <Screen>
      <PageHeader
        eyebrow="Google Assistant"
        title={logged ? "Log added" : "Review voice log"}
        subtitle={
          auto
            ? "Complete voice commands are saved automatically."
            : "Nothing is saved until you confirm it."
        }
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />

      {logged && draft.metric ? (
        <Card style={styles.result}>
          <View
            style={[
              styles.resultIcon,
              { backgroundColor: `${draft.metric.color}20` },
            ]}
          >
            <Ionicons
              name="checkmark"
              size={24}
              color={draft.metric.color}
            />
          </View>
          <Text style={[styles.resultTitle, { color: colors.ink }]}>
            {draft.displayValue} added to {draft.metric.name}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Saved for today using {draft.metric.defaultVisibility} visibility.
          </Text>
          <Button
            label="View tracker"
            icon="stats-chart-outline"
            onPress={() =>
              router.replace({
                pathname: "/metric-detail",
                params: { metric: draft.metric!.id, period: "today" },
              } as never)
            }
          />
        </Card>
      ) : (
        <>
          <Card style={styles.review}>
            <View style={styles.commandTop}>
              <View
                style={[
                  styles.assistantIcon,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Ionicons name="mic" size={20} color={accent} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.label, { color: colors.muted }]}>
                  Parsed voice command
                </Text>
                <Text style={[styles.command, { color: colors.ink }]}>
                  {draft.displayValue ?? "Incomplete command"}
                </Text>
              </View>
            </View>

            <SelectionMenu
              title="Tracker"
              items={selectable.map((metric) => ({
                id: metric.id,
                label: metric.name,
                icon: metric.icon as keyof typeof Ionicons.glyphMap,
                color: metric.color,
                group: trackerGroupLabel(metric),
              }))}
              selectedIds={selectedIds}
              onChange={(ids) => setSelectedMetricId(ids[0] ?? "")}
              multiple={false}
              emptyLabel="Choose the intended tracker"
            />

            {draft.metric && draft.value !== undefined && !draft.error ? (
              <View
                style={[
                  styles.preview,
                  {
                    backgroundColor: `${draft.metric.color}14`,
                    borderColor: `${draft.metric.color}45`,
                  },
                ]}
              >
                <Ionicons
                  name={draft.metric.icon as keyof typeof Ionicons.glyphMap}
                  size={21}
                  color={draft.metric.color}
                />
                <View style={styles.copy}>
                  <Text style={[styles.previewName, { color: colors.ink }]}>
                    {draft.metric.name}
                  </Text>
                  <Text style={[styles.previewValue, { color: colors.ink }]}>
                    {draft.displayValue}
                  </Text>
                  {draft.label ? (
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {draft.label}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <View
                style={[
                  styles.warning,
                  {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={accent}
                />
                <Text style={[styles.warningText, { color: colors.ink }]}>
                  {draft.error ?? "Choose a tracker to continue."}
                </Text>
              </View>
            )}
          </Card>

          {draft.metric && draft.value !== undefined && !draft.error ? (
            <Button
              label={`Confirm ${draft.metric.name} log`}
              icon="checkmark-circle-outline"
              onPress={confirm}
            />
          ) : (
            <Button
              label="Open manual logging"
              icon="add-circle-outline"
              variant="secondary"
              onPress={() => router.replace("/log" as never)}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  review: { gap: 12 },
  commandTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  assistantIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  command: { fontSize: 13, fontWeight: "900", marginTop: 2 },
  preview: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  previewName: { fontSize: 10, fontWeight: "800" },
  previewValue: { fontSize: 17, fontWeight: "900", marginTop: 2 },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 3 },
  warning: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  warningText: { flex: 1, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  result: { alignItems: "center", gap: 8, paddingVertical: 22 },
  resultIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: { fontSize: 15, fontWeight: "900", textAlign: "center" },
});
