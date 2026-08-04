import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { MetricSelectorItem } from "@/src/components/MetricSelector";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";

export function SelectionMenu({
  title,
  items,
  selectedIds,
  onChange,
  multiple = true,
  emptyLabel = "None selected",
  searchable = true,
  compactIcon = false,
  icon = "options-outline",
}: {
  title: string;
  items: MetricSelectorItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  emptyLabel?: string;
  searchable?: boolean;
  /** Render only the filter icon while retaining the same accessible modal. */
  compactIcon?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const localizedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        label: t(item.label),
        sublabel: item.sublabel ? t(item.sublabel) : item.sublabel,
        group: item.group ? t(item.group) : item.group,
      })),
    [items, t],
  );
  const selected = localizedItems.filter((item) => selectedIds.includes(item.id));
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? localizedItems.filter((item) =>
          `${item.label} ${item.sublabel ?? ""} ${item.group ?? ""}`
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : localizedItems;
    const grouped = new Map<string, MetricSelectorItem[]>();
    for (const item of filtered) {
      const group = item.group?.trim() || "Options";
      grouped.set(group, [...(grouped.get(group) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [localizedItems, query]);

  function choose(id: string) {
    if (!multiple) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(title)}
        accessibilityHint={t("Open selection")}
        onPress={() => setOpen(true)}
        style={[
          compactIcon ? styles.compactTrigger : styles.trigger,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {compactIcon ? (
          <Ionicons name={icon} size={17} color={accent} />
        ) : (
          <View style={[styles.triggerIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name={icon} size={17} color={accent} />
          </View>
        )}
        {!compactIcon ? <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text
            translate={!selected.length}
            numberOfLines={1}
            style={[styles.summary, { color: colors.muted }]}
          >
            {selected.length
              ? selected.map((item) => item.label).join(", ")
              : emptyLabel}
          </Text>
        </View> : null}
        {!compactIcon ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[styles.sheet, { backgroundColor: colors.card }]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.ink }]}>{title}</Text>
            {searchable && items.length > 7 ? (
              <View style={[styles.search, { borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={15} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={colors.faint}
                  style={[styles.searchInput, { color: colors.ink }]}
                />
              </View>
            ) : null}
            {multiple && items.length ? (
              <View style={styles.bulk}>
                <Pressable onPress={() => onChange(items.map((item) => item.id))}>
                  <Text style={[styles.bulkText, { color: accent }]}>Select all</Text>
                </Pressable>
                <Pressable onPress={() => onChange([])}>
                  <Text style={[styles.bulkText, { color: accent }]}>Clear</Text>
                </Pressable>
              </View>
            ) : null}
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {groups.map(([group, groupItems]) => (
                <View key={group}>
                  <Text style={[styles.group, { color: colors.muted }]}>
                    {group}
                  </Text>
                  {groupItems.map((item) => {
                    const checked = selectedIds.includes(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => choose(item.id)}
                        style={[
                          styles.row,
                          { borderColor: colors.border },
                          checked && { backgroundColor: colors.primarySoft },
                        ]}
                      >
                        <View
                          style={[
                            styles.itemIcon,
                            { backgroundColor: `${item.color ?? accent}18` },
                          ]}
                        >
                          <Ionicons
                            name={item.icon ?? "ellipse-outline"}
                            size={16}
                            color={item.color ?? accent}
                          />
                        </View>
                        <View style={styles.copy}>
                          <Text
                            translate={false}
                            style={[styles.name, { color: colors.ink }]}
                          >
                            {item.label}
                          </Text>
                          {item.sublabel ? (
                            <Text
                              translate={false}
                              style={[styles.meta, { color: colors.muted }]}
                            >
                              {item.sublabel}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons
                          name={
                            multiple
                              ? checked
                                ? "checkbox"
                                : "square-outline"
                              : checked
                                ? "radio-button-on"
                                : "radio-button-off"
                          }
                          size={19}
                          color={checked ? accent : colors.faint}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              {!groups.length ? (
                <Text style={[styles.empty, { color: colors.muted }]}>
                  No matching options
                </Text>
              ) : null}
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              style={[styles.done, { backgroundColor: accent }]}
            >
              <Text preserveColor style={styles.doneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 15,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  compactTrigger: {
    width: 34,
    height: 32,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 10, fontWeight: "900" },
  summary: { fontSize: 8, fontWeight: "700", marginTop: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.42)",
    justifyContent: "flex-end",
    padding: 12,
  },
  sheet: { maxHeight: "82%", borderRadius: 22, padding: 14, gap: 7 },
  handle: { width: 36, height: 4, borderRadius: 3, alignSelf: "center" },
  sheetTitle: { fontSize: 14, fontWeight: "900" },
  search: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  searchInput: { flex: 1, minHeight: 38, fontSize: 10 },
  bulk: {
    minHeight: 30,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 18,
  },
  bulkText: { fontSize: 9, fontWeight: "900" },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 4 },
  group: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    paddingHorizontal: 4,
    paddingTop: 9,
    paddingBottom: 4,
  },
  row: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 10, fontWeight: "800" },
  meta: { fontSize: 7, marginTop: 1 },
  empty: { padding: 16, textAlign: "center", fontSize: 9 },
  done: {
    minHeight: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
});
