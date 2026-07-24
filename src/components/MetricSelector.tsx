import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { palette, shadow, useAppColors, useGroupAccent } from "@/src/theme";

export type MetricSelectorItem = {
  id: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  sublabel?: string;
  group?: string;
};

export function MetricSelector({
  items,
  selectedIds,
  onChange,
  multiple = true,
  title = "Metrics",
  emptyLabel = "No logged metrics",
  collapsibleGroups = [],
}: {
  items: MetricSelectorItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  title?: string;
  emptyLabel?: string;
  collapsibleGroups?: string[];
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => new Set(collapsibleGroups),
  );
  const selected = items.filter((item) => selectedIds.includes(item.id));
  function choose(id: string) {
    if (!multiple) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(
      selectedIds.includes(id)
        ? selectedIds.length > 1
          ? selectedIds.filter((item) => item !== id)
          : selectedIds
        : [...selectedIds, id],
    );
  }
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((value) => !value)}
        style={[
          styles.button,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="options-outline" size={18} color={accent} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text
            numberOfLines={1}
            style={[styles.summary, { color: colors.muted }]}
          >
            {selected.length
              ? selected.map((item) => item.label).join(", ")
              : emptyLabel}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open ? (
        <View
          style={[
            styles.menu,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {multiple && items.length ? (
            <View style={[styles.bulk, { borderBottomColor: colors.border }]}>
              <Pressable
                onPress={() => onChange(items.map((item) => item.id))}
                style={styles.bulkButton}
              >
                <Text style={[styles.bulkText, { color: accent }]}>
                  Select all
                </Text>
              </Pressable>
              <Pressable onPress={() => onChange([])} style={styles.bulkButton}>
                <Text style={[styles.bulkText, { color: accent }]}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {items.length ? (
            items.map((item, index) => {
              const checked = selectedIds.includes(item.id);
              const groupStarts =
                Boolean(item.group) && item.group !== items[index - 1]?.group;
              const groupIsCollapsible = Boolean(
                item.group && collapsibleGroups.includes(item.group),
              );
              const groupIsCollapsed = Boolean(
                item.group && collapsed.has(item.group),
              );
              return (
                <React.Fragment key={item.id}>
                  {groupStarts ? (
                    groupIsCollapsible ? (
                      <Pressable
                        onPress={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(item.group!)) next.delete(item.group!);
                            else next.add(item.group!);
                            return next;
                          })
                        }
                        style={styles.groupToggle}
                      >
                        <Text
                          style={[styles.groupLabel, { color: colors.muted }]}
                        >
                          {item.group}
                        </Text>
                        <Ionicons
                          name={
                            groupIsCollapsed
                              ? "chevron-down"
                              : "chevron-up"
                          }
                          size={15}
                          color={colors.muted}
                        />
                      </Pressable>
                    ) : (
                      <Text
                        style={[styles.groupLabel, { color: colors.muted }]}
                      >
                        {item.group}
                      </Text>
                    )
                  ) : null}
                  {!groupIsCollapsed ? (
                  <Pressable
                    onPress={() => choose(item.id)}
                    style={[
                      styles.row,
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
                      name={item.icon ?? "analytics-outline"}
                      size={17}
                      color={item.color ?? accent}
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.itemLabel, { color: colors.ink }]}>
                      {item.label}
                    </Text>
                    {item.sublabel ? (
                      <Text style={[styles.sublabel, { color: colors.muted }]}>
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
                    size={20}
                    color={checked ? accent : colors.faint}
                  />
                  </Pressable>
                  ) : null}
                </React.Fragment>
              );
            })
          ) : (
            <Text style={[styles.empty, { color: colors.muted }]}>
              {emptyLabel}
            </Text>
          )}
          <Pressable onPress={() => setOpen(false)} style={styles.done}>
            <Text style={[styles.doneText, { color: accent }]}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 20 },
  button: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    borderRadius: 17,
    padding: 10,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  summary: { color: palette.muted, fontSize: 10, marginTop: 2 },
  menu: {
    marginTop: 7,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    borderRadius: 17,
    padding: 8,
    ...shadow,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    padding: 7,
  },
  rowSelected: { backgroundColor: palette.primarySoft },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  sublabel: { color: palette.muted, fontSize: 9, marginTop: 2 },
  empty: {
    color: palette.muted,
    fontSize: 11,
    textAlign: "center",
    padding: 15,
  },
  done: { alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8 },
  doneText: { color: palette.primary, fontSize: 11, fontWeight: "900" },
  bulk: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 4,
    borderBottomWidth: 1,
    marginBottom: 4,
    paddingBottom: 4,
  },
  bulkButton: { paddingHorizontal: 9, paddingVertical: 6 },
  bulkText: { fontSize: 9, fontWeight: "900" },
  groupLabel: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingTop: 9,
    paddingBottom: 3,
  },
  groupToggle: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 9,
  },
});
