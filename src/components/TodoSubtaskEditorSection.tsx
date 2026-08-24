import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { flattenTodoHierarchy } from "@/src/domain/todos";
import { useAppColors, useGroupAccent } from "@/src/theme";

type SubtaskSummary = {
  id: string;
  title: string;
  parentId?: string;
};

export function TodoSubtaskEditorSection({
  items,
  canManage = true,
  onAdd,
  onEdit,
  onRemove,
}: {
  items: SubtaskSummary[];
  canManage?: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [collapsed, setCollapsed] = useState(true);
  const flattened = useMemo(() => flattenTodoHierarchy(items), [items]);

  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={
          collapsed ? "Expand Sub-To-Dos" : "Collapse Sub-To-Dos"
        }
        onPress={() => setCollapsed((current) => !current)}
        style={styles.heading}
      >
        <Ionicons name="git-branch-outline" size={17} color={accent} />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>Sub-To-Dos</Text>
          <Text style={[styles.count, { color: colors.muted }]}>
            {items.length
              ? `Nested tasks: ${items.length}`
              : "Break this task into smaller steps"}
          </Text>
        </View>
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={16}
          color={colors.faint}
        />
      </Pressable>
      {!collapsed ? (
        <View style={styles.body}>
          {flattened.map(({ item, depth }) => (
            <Pressable
              key={item.id}
              accessibilityLabel={`Edit sub-to-do ${item.title}`}
              onPress={() => onEdit(item.id)}
              style={[
                styles.row,
                {
                  marginLeft: Math.min(depth, 8) * 12,
                  backgroundColor: colors.canvas,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="return-down-forward-outline"
                size={13}
                color={colors.faint}
              />
              <Text
                translate={false}
                numberOfLines={2}
                style={[styles.rowTitle, { color: colors.ink }]}
              >
                {item.title}
              </Text>
              <Ionicons name="create-outline" size={14} color={accent} />
              {canManage ? (
                <Pressable
                  accessibilityLabel={`Delete sub-to-do ${item.title}`}
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                  style={styles.remove}
                >
                  <Ionicons name="trash-outline" size={14} color="#C44949" />
                </Pressable>
              ) : null}
            </Pressable>
          ))}
          {!items.length ? (
            <Text style={[styles.empty, { color: colors.muted }]}>
              No sub-to-dos yet.
            </Text>
          ) : null}
          {canManage ? (
            <Pressable
              accessibilityLabel="Add sub-to-do"
              onPress={onAdd}
              style={[styles.add, { borderColor: accent }]}
            >
              <Ionicons name="add" size={16} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>
                Add sub-to-do
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    overflow: "hidden",
  },
  heading: {
    minHeight: 48,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 10, fontWeight: "900" },
  count: { fontSize: 7.5, lineHeight: 11, fontWeight: "700", marginTop: 1 },
  body: { paddingHorizontal: 8, paddingBottom: 8, gap: 5 },
  row: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "800",
  },
  remove: {
    width: 28,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    paddingVertical: 5,
    textAlign: "center",
    fontSize: 8,
    fontWeight: "700",
  },
  add: {
    minHeight: 38,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  addText: { fontSize: 8.5, fontWeight: "900" },
});
