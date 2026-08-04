import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { TrackerViewFilter } from "@/src/types";
import {
  activeTrackerViewId,
  ALL_AVAILABLE_TRACKERS_FILTER,
  ALL_TRACKERS_FILTER,
  TRACKED_ONLY_FILTER,
  TrackerViewScope,
  trackerViewSetting,
} from "@/src/domain/viewFilters";

export default function ViewFilters() {
  const { scope: rawScope } = useLocalSearchParams<{
    scope?: TrackerViewScope;
  }>();
  const scope: TrackerViewScope =
    rawScope === "progress" || rawScope === "performance"
      ? rawScope
      : "today";
  const activeSetting = trackerViewSetting(scope);
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const filters = state.settings.trackerViewFilters ?? [];
  const trackers = state.metrics
    .filter(
      (metric) =>
        !isInternalTracker(metric) &&
        (scope !== "performance" ||
          (metric.dataType !== "text" &&
            metric.dataType !== "photo" &&
            metric.id !== "tracked_goals")),
    )
    .sort((a, b) => a.order - b.order);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [includeTodos, setIncludeTodos] = useState(true);
  const [selectedTodoIds, setSelectedTodoIds] = useState<string[]>([]);
  const begin = (filter?: TrackerViewFilter) => {
    setEditingId(filter?.id ?? "new");
    setName(filter?.name ?? "");
    setSelected(filter?.metricIds ?? []);
    setIncludeTodos(scope === "today" ? filter?.includeTodos !== false : false);
    setSelectedTodoIds(
      scope === "today"
        ? filter?.todoIds ?? (state.todos ?? []).map((todo) => todo.id)
        : [],
    );
  };
  const close = () => {
    setEditingId(null);
    setName("");
    setSelected([]);
    setIncludeTodos(true);
    setSelectedTodoIds([]);
  };
  const save = () => {
    if (
      !name.trim() ||
      (!selected.length &&
        !(scope === "today" && includeTodos && selectedTodoIds.length))
    )
      return Alert.alert(
        "Complete this view",
        "Add a name and choose at least one tracker or To-Do.",
      );
    const id =
      editingId === "new"
        ? `view-${Date.now().toString(36)}`
        : editingId!;
    const existing = filters.find((filter) => filter.id === id);
    const next = [
      ...filters.filter((filter) => filter.id !== id),
      {
        id,
        name: name.trim(),
        metricIds: selected,
        includeTodos: scope === "today" ? includeTodos : existing?.includeTodos,
        todoIds:
          scope === "today" && includeTodos
            ? selectedTodoIds
            : existing?.todoIds,
        visible: existing?.visible ?? true,
      },
    ];
    updateSettings({
      trackerViewFilters: next,
      [activeSetting]: id,
    });
    close();
  };
  return (
    <Screen>
      <PageHeader
        title="Custom views"
        subtitle={`Reusable tracker lists · editing ${
          scope === "today"
            ? "Today"
            : scope === "progress"
              ? "Progress"
              : "Performance"
        }.`}
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />
      {editingId ? (
        <Card style={styles.editor}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="View name"
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              {
                color: colors.ink,
                borderColor: colors.border,
                backgroundColor: colors.canvas,
              },
            ]}
          />
          <View style={styles.actions}>
            <Pressable
              onPress={() =>
                setSelected(
                  selected.length === trackers.length
                    ? []
                    : trackers.map((metric) => metric.id),
                )
              }
            >
              <Text style={[styles.link, { color: accent }]}>
                {selected.length === trackers.length
                  ? "Deselect all"
                  : "Select all"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.trackerList}>
            {trackers.map((metric) => {
              const checked = selected.includes(metric.id);
              return (
                <Pressable
                  key={metric.id}
                  onPress={() =>
                    setSelected((current) =>
                      checked
                        ? current.filter((id) => id !== metric.id)
                        : [...current, metric.id],
                    )
                  }
                  style={[
                    styles.tracker,
                    {
                      borderColor: checked ? metric.color : colors.border,
                      backgroundColor: checked
                        ? `${metric.color}12`
                        : colors.card,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      checked
                        ? "checkmark-circle"
                        : (metric.icon as keyof typeof Ionicons.glyphMap)
                    }
                    size={16}
                    color={checked ? metric.color : colors.muted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.trackerName, { color: colors.ink }]}
                  >
                    {metric.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {scope === "today" ? (
            <View style={[styles.todoSection, { borderColor: colors.border }]}>
              <Pressable
                onPress={() => setIncludeTodos((current) => !current)}
                style={styles.todoHeading}
              >
                <Ionicons
                  name={includeTodos ? "checkbox" : "square-outline"}
                  size={17}
                  color={includeTodos ? accent : colors.faint}
                />
                <View style={styles.copy}>
                  <Text style={[styles.filterName, { color: colors.ink }]}>To-Dos</Text>
                  <Text style={[styles.filterMeta, { color: colors.muted }]}>
                    Show selected To-Dos in this view
                  </Text>
                </View>
              </Pressable>
              {includeTodos ? (
                <>
                  <Pressable
                    onPress={() =>
                      setSelectedTodoIds(
                        selectedTodoIds.length === (state.todos ?? []).length
                          ? []
                          : (state.todos ?? []).map((todo) => todo.id),
                      )
                    }
                    style={styles.todoSelectAll}
                  >
                    <Text style={[styles.link, { color: accent }]}>
                      {selectedTodoIds.length === (state.todos ?? []).length
                        ? "Deselect all"
                        : "Select all"}
                    </Text>
                  </Pressable>
                  <View style={styles.trackerList}>
                    {(state.todos ?? []).map((todo) => {
                      const checked = selectedTodoIds.includes(todo.id);
                      return (
                        <Pressable
                          key={todo.id}
                          onPress={() =>
                            setSelectedTodoIds((current) =>
                              checked
                                ? current.filter((id) => id !== todo.id)
                                : [...current, todo.id],
                            )
                          }
                          style={[
                            styles.tracker,
                            {
                              borderColor: checked ? accent : colors.border,
                              backgroundColor: checked ? colors.primarySoft : colors.card,
                            },
                          ]}
                        >
                          <Ionicons
                            name={checked ? "checkmark-circle" : "ellipse-outline"}
                            size={16}
                            color={checked ? accent : colors.muted}
                          />
                          <Text
                            translate={false}
                            numberOfLines={1}
                            style={[styles.trackerName, { color: colors.ink }]}
                          >
                            {todo.title}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>
          ) : null}
          <View style={styles.editorButtons}>
            <Pressable
              onPress={close}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.muted }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={save}
              style={[styles.primaryButton, { backgroundColor: accent }]}
            >
              <Text style={[styles.buttonText, { color: "#FFFFFF" }]}>Save</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <>
          {[
            [TRACKED_ONLY_FILTER, "Tracked goals only", "Updates automatically"],
            [ALL_AVAILABLE_TRACKERS_FILTER, "All trackers", "Every available tracker"],
            [ALL_TRACKERS_FILTER, "None", "Your page customization"],
          ].map(([id, label, meta]) => (
            <Card key={id} style={styles.filter}>
              <Pressable
                onPress={() =>
                  updateSettings({
                    [activeSetting]: id,
                  })
                }
                style={styles.filterMain}
              >
                <Ionicons
                  name={id === TRACKED_ONLY_FILTER ? "flag-outline" : "apps-outline"}
                  size={18}
                  color={accent}
                />
                <View style={styles.copy}>
                  <Text style={[styles.filterName, { color: colors.ink }]}>
                    {label}
                  </Text>
                  <Text style={[styles.filterMeta, { color: colors.muted }]}>
                    {meta}
                  </Text>
                </View>
                {activeTrackerViewId(state, scope) === id ? (
                  <Ionicons name="checkmark-circle" size={18} color={accent} />
                ) : null}
              </Pressable>
            </Card>
          ))}
          {filters.map((filter) => (
            <Card key={filter.id} style={styles.filter}>
              <Pressable
                onPress={() =>
                  updateSettings({
                    [activeSetting]: filter.id,
                  })
                }
                style={styles.filterMain}
              >
                <Ionicons name="funnel-outline" size={18} color={accent} />
                <View style={styles.copy}>
                  <Text style={[styles.filterName, { color: colors.ink }]}>
                    {filter.name}
                  </Text>
                  <Text style={[styles.filterMeta, { color: colors.muted }]}>
                    {filter.metricIds.length} trackers
                    {scope === "today" && filter.includeTodos !== false
                      ? ` · ${filter.todoIds?.length ?? (state.todos ?? []).length} to-dos`
                      : ""}
                  </Text>
                </View>
                {state.settings[activeSetting] === filter.id ? (
                  <Ionicons name="checkmark-circle" size={18} color={accent} />
                ) : null}
              </Pressable>
              <IconButton
                icon={filter.visible === false ? "eye-off-outline" : "eye-outline"}
                label={filter.visible === false ? "Show in quick views" : "Hide from quick views"}
                onPress={() =>
                  updateSettings({
                    trackerViewFilters: filters.map((candidate) =>
                      candidate.id === filter.id
                        ? { ...candidate, visible: candidate.visible === false }
                        : candidate,
                    ),
                  })
                }
              />
              <IconButton
                icon="create-outline"
                label="Edit"
                onPress={() => begin(filter)}
              />
              <IconButton
                icon="trash-outline"
                label="Delete"
                onPress={() =>
                  updateSettings({
                    trackerViewFilters: filters.filter(
                      (candidate) => candidate.id !== filter.id,
                    ),
                    [activeSetting]:
                      state.settings[activeSetting] === filter.id
                        ? "all"
                        : state.settings[activeSetting],
                  })
                }
              />
            </Card>
          ))}
          <Pressable
            onPress={() => begin()}
            style={[styles.add, { borderColor: accent }]}
          >
            <Ionicons name="add" size={18} color={accent} />
            <Text style={[styles.addText, { color: accent }]}>
              Create a custom view
            </Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 11,
    fontWeight: "800",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end" },
  link: { fontSize: 8, fontWeight: "900" },
  trackerList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tracker: {
    width: "48.8%",
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  trackerName: { flex: 1, fontSize: 8, fontWeight: "800" },
  todoSection: { borderTopWidth: 1, paddingTop: 9, gap: 7 },
  todoHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  todoSelectAll: { alignSelf: "flex-end" },
  editorButtons: { flexDirection: "row", gap: 8 },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 9, fontWeight: "900" },
  filter: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 7,
  },
  filterMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  copy: { flex: 1 },
  filterName: { fontSize: 10, fontWeight: "900" },
  filterMeta: { fontSize: 7, fontWeight: "700", marginTop: 2 },
  add: {
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addText: { fontSize: 9, fontWeight: "900" },
});
