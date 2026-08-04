import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { ColorSpectrumPicker } from "@/src/components/ColorSpectrumPicker";
import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  DEFAULT_GROUP_THEME,
  newMetricFromDefinition,
} from "@/src/domain/groupSetup";
import {
  isInternalTracker,
  trackerPresets,
} from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { NewMetric } from "@/src/types";

export default function CreateGroup() {
  const { state, createGroup } = useApp();
  const auth = useAuth();
  const cloud = useCloudSyncActions();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [name, setName] = useState("");
  const [themeColor, setThemeColor] = useState<string>(DEFAULT_GROUP_THEME);
  const [allowImmediateJoin, setAllowImmediateJoin] = useState(true);
  const [selectedSuggested, setSelectedSuggested] = useState<string[]>([]);
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [metricSearch, setMetricSearch] = useState("");
  const [customMetrics, setCustomMetrics] = useState<NewMetric[]>([]);
  const [customName, setCustomName] = useState("");
  const [customType, setCustomType] = useState<"number" | "boolean">("number");
  const [customGoal, setCustomGoal] = useState("1");
  const [customUnit, setCustomUnit] = useState("");
  const [readyMadeOpen, setReadyMadeOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(
    () =>
      state.metrics
        .filter(
          (metric) =>
            !isInternalTracker(metric) &&
            metric.sections.today &&
            metric.activeFrom <= new Date().toISOString().slice(0, 10),
        )
        .sort((a, b) => a.order - b.order),
    [state.metrics],
  );
  const presets = useMemo(
    () =>
      trackerPresets(state).filter(
        (preset) =>
          !suggestions.some((metric) => metric.id === preset.templateId),
      ),
    [state, suggestions],
  );
  const visiblePresets = useMemo(() => {
    const query = metricSearch.trim().toLowerCase();
    const matches = query
      ? presets.filter((preset) =>
          `${preset.name} ${preset.category ?? ""} ${preset.description}`
            .toLowerCase()
            .includes(query),
        )
      : presets;
    return matches.slice(0, query ? 60 : 10);
  }, [metricSearch, presets]);
  const selectedCount =
    selectedSuggested.length + selectedPresets.length + customMetrics.length;

  function toggle(id: string, selected: string[], set: (ids: string[]) => void) {
    set(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  }

  function addCustomMetric() {
    const metricName = customName.trim();
    const target = customType === "boolean" ? 1 : Number(customGoal);
    if (
      !metricName ||
      (customType === "number" &&
        (!Number.isFinite(target) || target <= 0))
    ) {
      Alert.alert(
        "Finish the tracker",
        customType === "number"
          ? "Add a name and a goal above zero."
          : "Add a tracker name.",
      );
      return;
    }
    setCustomMetrics((current) => [
      ...current,
      {
        templateId: `group_custom_${Date.now().toString(36)}`,
        name: metricName,
        icon: "sparkles-outline",
        color: "#7756D9",
        unit: customType === "number" ? customUnit.trim() : "",
        dataType: customType,
        aggregation: customType === "number" ? "sum" : "max",
        goal:
          customType === "number"
            ? { kind: "at_least", target }
            : { kind: "complete", target: 1 },
        goalEnabled: true,
        rankingDirection: "higher",
        defaultVisibility: "group",
        category: "other",
        manualEntry: true,
      },
    ]);
    setCustomName("");
    setCustomGoal("1");
    setCustomUnit("");
    setCustomType("number");
  }

  async function submit() {
    if (!name.trim()) {
      Alert.alert("Name your group", "Enter a group name first.");
      return;
    }
    const requestedMetrics: NewMetric[] = [
      ...suggestions
        .filter((metric) => selectedSuggested.includes(metric.id))
        .map(newMetricFromDefinition),
      ...presets.filter((preset) =>
        selectedPresets.includes(preset.templateId),
      ),
      ...customMetrics,
    ];
    const options = {
      metrics: requestedMetrics,
      themeColor,
      requireMemberApproval: !allowImmediateJoin,
    };
    setBusy(true);
    try {
      if (auth.status === "signedIn")
        await cloud.createGroup(name.trim(), options);
      else createGroup(name.trim(), options);
      router.replace("/group-settings" as never);
    } catch (error) {
      Alert.alert(
        "Could not create group",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen keyboardShouldPersistTaps="handled" refreshEnabled={false}>
      <PageHeader
        eyebrow="New group"
        title="Set up your group"
        subtitle="Nothing is added until you select it here."
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />

      <SectionHeader title="Group name" />
      <Card>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder="e.g. Office Step League"
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
      </Card>

      <SectionHeader title="Suggested from your Today page" />
      <Card style={styles.list}>
        {suggestions.length ? (
          suggestions.map((metric, index) => (
            <MetricChoice
              key={metric.id}
              name={metric.name}
              icon={metric.icon as keyof typeof Ionicons.glyphMap}
              color={metric.color}
              selected={selectedSuggested.includes(metric.id)}
              last={index === suggestions.length - 1}
              onPress={() =>
                toggle(
                  metric.id,
                  selectedSuggested,
                  setSelectedSuggested,
                )
              }
              colors={colors}
              accent={accent}
            />
          ))
        ) : (
          <Text style={[styles.empty, { color: colors.muted }]}>
            Add trackers to Today first, or choose a ready-made tracker below.
          </Text>
        )}
      </Card>

      <Card>
        <Pressable
          onPress={() => setReadyMadeOpen((open) => !open)}
          style={styles.collapseHeader}
        >
          <View style={styles.copy}>
            <Text style={[styles.choiceName, { color: colors.ink }]}>
              More ready-made trackers
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Browse the complete tracker library.
            </Text>
          </View>
          <Ionicons
            name={readyMadeOpen ? "chevron-up" : "chevron-down"}
            size={19}
            color={colors.faint}
          />
        </Pressable>
        {readyMadeOpen ? (
          <>
            <View style={[styles.search, { borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={17} color={colors.muted} />
              <TextInput
                value={metricSearch}
                onChangeText={setMetricSearch}
                placeholder="Search default trackers"
                placeholderTextColor={colors.faint}
                style={[styles.searchInput, { color: colors.ink }]}
              />
              {metricSearch ? (
                <Pressable onPress={() => setMetricSearch("")}>
                  <Ionicons name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
            {visiblePresets.map((preset, index) => (
              <MetricChoice
                key={preset.templateId}
                name={preset.name}
                icon={preset.icon as keyof typeof Ionicons.glyphMap}
                color={preset.color}
                selected={selectedPresets.includes(preset.templateId)}
                last={index === visiblePresets.length - 1}
                onPress={() =>
                  toggle(
                    preset.templateId,
                    selectedPresets,
                    setSelectedPresets,
                  )
                }
                colors={colors}
                accent={accent}
              />
            ))}
            {!metricSearch && presets.length > visiblePresets.length ? (
              <Text style={[styles.searchHint, { color: colors.muted }]}>
                Search to browse all {presets.length} ready-made trackers.
              </Text>
            ) : null}
          </>
        ) : null}
      </Card>

      <Card>
        <Pressable
          onPress={() => setCustomOpen((open) => !open)}
          style={styles.collapseHeader}
        >
          <View style={styles.copy}>
            <Text style={[styles.choiceName, { color: colors.ink }]}>
              Create a custom tracker
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Add a simple number or yes/no tracker.
            </Text>
          </View>
          <Ionicons
            name={customOpen ? "chevron-up" : "chevron-down"}
            size={19}
            color={colors.faint}
          />
        </Pressable>
        {customOpen ? (
          <>
            <TextInput
              value={customName}
              onChangeText={setCustomName}
              placeholder="Tracker name"
              placeholderTextColor={colors.faint}
              style={[
                styles.input,
                { color: colors.ink, borderColor: colors.border },
              ]}
            />
            <View style={styles.typeChoices}>
              <View style={styles.typeChoice}>
                <Chip
                  label="A number"
                  icon="calculator-outline"
                  selected={customType === "number"}
                  onPress={() => setCustomType("number")}
                />
              </View>
              <View style={styles.typeChoice}>
                <Chip
                  label="Yes or no"
                  icon="checkmark-circle-outline"
                  selected={customType === "boolean"}
                  onPress={() => setCustomType("boolean")}
                />
              </View>
            </View>
            {customType === "number" ? (
              <View style={styles.customFields}>
                <TextInput
                  value={customGoal}
                  onChangeText={setCustomGoal}
                  keyboardType="decimal-pad"
                  placeholder="Daily goal"
                  placeholderTextColor={colors.faint}
                  style={[
                    styles.input,
                    styles.flexInput,
                    { color: colors.ink, borderColor: colors.border },
                  ]}
                />
                <TextInput
                  value={customUnit}
                  onChangeText={setCustomUnit}
                  placeholder="Unit (optional)"
                  placeholderTextColor={colors.faint}
                  style={[
                    styles.input,
                    styles.flexInput,
                    { color: colors.ink, borderColor: colors.border },
                  ]}
                />
              </View>
            ) : null}
            <Button
              label="Add custom tracker"
              icon="add-circle-outline"
              size="small"
              variant="secondary"
              onPress={addCustomMetric}
            />
            {customMetrics.map((metric) => (
              <View
                key={metric.templateId}
                style={[styles.customAdded, { borderColor: colors.border }]}
              >
                <Ionicons name="sparkles-outline" size={17} color={metric.color} />
                <Text style={[styles.choiceName, styles.copy, { color: colors.ink }]}>
                  {metric.name}
                </Text>
                <Pressable
                  accessibilityLabel={`Remove ${metric.name}`}
                  onPress={() =>
                    setCustomMetrics((current) =>
                      current.filter(
                        (item) => item.templateId !== metric.templateId,
                      ),
                    )
                  }
                >
                  <Ionicons name="trash-outline" size={18} color={palette.red} />
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
      </Card>

      <SectionHeader title="Group color" />
      <Card style={styles.colorPicker}>
        <ColorSpectrumPicker value={themeColor} onChange={setThemeColor} />
        <Text style={[styles.meta, { color: colors.muted }]}>
          Members can follow this group color or override it personally.
          Completion lime and gold are reserved.
        </Text>
      </Card>

      <SectionHeader title="Invites" />
      <Card style={styles.settingRow}>
        <View style={styles.copy}>
          <Text style={[styles.choiceName, { color: colors.ink }]}>
            Allow people to join immediately
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Turn off to approve each invite request first.
          </Text>
        </View>
        <Switch
          value={allowImmediateJoin}
          onValueChange={setAllowImmediateJoin}
          trackColor={{ false: colors.border, true: `${themeColor}88` }}
          thumbColor={allowImmediateJoin ? themeColor : colors.faint}
        />
      </Card>

      <View style={styles.submit}>
        <Text style={[styles.selectedCount, { color: colors.muted }]}>
          {selectedCount
            ? `${selectedCount} tracker${selectedCount === 1 ? "" : "s"} selected`
            : "No group trackers selected"}
        </Text>
        <Button
          label="Create group"
          icon="checkmark"
          loading={busy}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}

function MetricChoice({
  name,
  icon,
  color,
  selected,
  last,
  onPress,
  colors,
  accent,
}: {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  selected: boolean;
  last: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.choice,
        !last && { borderBottomColor: colors.border, borderBottomWidth: 1 },
      ]}
    >
      <View style={[styles.choiceIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[styles.choiceName, styles.copy, { color: colors.ink }]}>
        {name}
      </Text>
      <Ionicons
        name={selected ? "checkbox" : "square-outline"}
        size={21}
        color={selected ? accent : colors.faint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 11,
    marginBottom: 10,
  },
  list: { paddingVertical: 2, paddingHorizontal: 11 },
  choice: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  choiceIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceName: { fontSize: 11, fontWeight: "900" },
  collapseHeader: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  copy: { flex: 1 },
  meta: { fontSize: 9, lineHeight: 13, marginTop: 3 },
  empty: { fontSize: 10, lineHeight: 15, paddingVertical: 14 },
  search: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  searchInput: { flex: 1, minHeight: 40, fontSize: 11 },
  searchHint: { fontSize: 9, lineHeight: 13, marginTop: 7 },
  typeChoices: {
    flexDirection: "row",
    gap: 14,
    marginTop: 2,
    marginBottom: 14,
  },
  typeChoice: { flex: 1 },
  customFields: { flexDirection: "row", gap: 12 },
  flexInput: { flex: 1 },
  customAdded: {
    minHeight: 42,
    borderTopWidth: 1,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorPicker: { gap: 9 },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  submit: { marginTop: 16, gap: 8 },
  selectedCount: { fontSize: 10, textAlign: "center" },
});
