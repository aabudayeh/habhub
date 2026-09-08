import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { InfoPopover } from "@/src/components/InfoPopover";
import { Button } from "@/src/components/ui";
import {
  parseTodoBatch,
  ParsedTodoBatchItem,
  TODO_BATCH_MAX_ITEMS,
} from "@/src/domain/todoBatch";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";

export function TodoBatchImportSection({
  disabled = false,
  group = false,
  onImport,
}: {
  disabled?: boolean;
  group?: boolean;
  onImport: (items: readonly ParsedTodoBatchItem[]) => void | Promise<void>;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [outline, setOutline] = useState("");
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const parsed = useMemo(() => parseTodoBatch(outline), [outline]);
  const rootCount = parsed.items.filter((item) => item.depth === 0).length;
  const valid = parsed.items.length > 0 && parsed.errors.length === 0;
  const outlinePlaceholder = useMemo(
    () =>
      [
        `- ${t("Plan the week")} #planning`,
        `  - ${t("Choose workouts")} #fitness`,
        `    - ${t("Add two strength sessions")}`,
        `- ${t("Buy groceries")} #home`,
      ].join("\n"),
    [t],
  );
  const structureHelp = t(
    "Create one to-do per bullet. Indent a bullet beneath its parent to make a sub-to-do; indent again for another level. Use -, *, •, 1., or task-list bullets such as - [ ]. Blank lines are ignored. Add #labels anywhere in a title (for example #work or #meal-prep) to group and filter related to-dos. Double-tap a saved label chip to remove its #label text.",
  );

  async function importItems() {
    if (!valid || importing || disabled) return;
    setImporting(true);
    try {
      await onImport(parsed.items);
      setImportedCount(parsed.items.length);
      setOutline("");
      setExpanded(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.heading}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? "Close batch to-do import" : "Open batch to-do import"}
          onPress={() => setExpanded((current) => !current)}
          style={styles.headingToggle}
        >
          <View style={[styles.headingIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="list-outline" size={17} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>Batch outline</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {importedCount
                ? `${importedCount} staged · review, then save`
                : "Paste tasks, subtasks, and #labels together"}
            </Text>
          </View>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.faint}
          />
        </Pressable>
        <InfoPopover label={t("How batch to-dos and labels work")} message={structureHelp} />
      </View>

      {expanded ? (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          <TextInput
            accessibilityLabel="Batch to-do outline"
            value={outline}
            editable={!disabled && !importing}
            onChangeText={(value) => {
              setOutline(value);
              setImportedCount(0);
            }}
            multiline
            maxLength={12_001}
            placeholder={outlinePlaceholder}
            translate={false}
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              {
                color: colors.ink,
                borderColor: parsed.errors.length ? "#D24B4B" : colors.border,
                backgroundColor: colors.canvas,
              },
            ]}
          />
          <View style={styles.summary}>
            <Text style={[styles.summaryText, { color: colors.muted }]}>
              {parsed.items.length
                ? `${parsed.items.length}/${TODO_BATCH_MAX_ITEMS} to-dos · ${rootCount} top-level`
                : "Nothing ready yet"}
            </Text>
            <Text style={[styles.summaryText, { color: colors.faint }]}>Blank lines are ignored</Text>
          </View>

          {parsed.errors.length || parsed.warnings.length ? (
            <View style={styles.issues}>
              {[...parsed.errors, ...parsed.warnings].slice(0, 5).map((issue, index) => {
                const error = index < parsed.errors.length;
                return (
                  <View key={`${issue.line}-${issue.code}-${index}`} style={styles.issueRow}>
                    <Ionicons
                      name={error ? "alert-circle-outline" : "information-circle-outline"}
                      size={14}
                      color={error ? "#D24B4B" : accent}
                    />
                    <Text
                      translate={false}
                      style={[styles.issueText, { color: error ? "#D24B4B" : colors.muted }]}
                    >
                      Line {issue.line}: {issue.message}
                    </Text>
                  </View>
                );
              })}
              {parsed.errors.length + parsed.warnings.length > 5 ? (
                <Text style={[styles.moreIssues, { color: colors.faint }]}>
                  {parsed.errors.length + parsed.warnings.length - 5} more issue(s)
                </Text>
              ) : null}
            </View>
          ) : null}

          {parsed.items.length ? (
            <View style={[styles.preview, { borderColor: colors.border }]}>
              <Text style={[styles.previewHeading, { color: colors.ink }]}>Preview</Text>
              <ScrollView nestedScrollEnabled style={styles.previewScroll}>
                {parsed.items.map((item) => (
                  <View
                    key={item.key}
                    style={[styles.previewRow, { paddingLeft: 9 + item.depth * 14 }]}
                  >
                    <Ionicons
                      name={item.depth ? "return-down-forward-outline" : "ellipse-outline"}
                      size={12}
                      color={item.depth ? colors.faint : accent}
                    />
                    <View style={styles.copy}>
                      <Text
                        translate={false}
                        numberOfLines={2}
                        style={[styles.previewTitle, { color: colors.ink }]}
                      >
                        {item.title}
                      </Text>
                      {item.labels.length ? (
                        <Text
                          translate={false}
                          numberOfLines={1}
                          style={[styles.previewLabels, { color: accent }]}
                        >
                          {item.labels.map((label) => `#${label}`).join("  ")}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label="Clear"
                variant="ghost"
                size="small"
                disabled={!outline || importing}
                onPress={() => setOutline("")}
              />
            </View>
            <View style={styles.action}>
              <Button
                label={group ? "Stage group outline" : "Stage outline"}
                icon="git-branch-outline"
                size="small"
                disabled={!valid || disabled}
                loading={importing}
                onPress={() => void importItems()}
              />
            </View>
          </View>
          <Text style={[styles.footer, { color: colors.muted }]}>
            On a blank new page, root bullets become separate to-dos. Otherwise they are added beneath the open to-do. Nothing is saved until you use Save.
          </Text>
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
    minHeight: 50,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  headingToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headingIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 10, fontWeight: "900" },
  subtitle: { fontSize: 7.5, lineHeight: 11, fontWeight: "700", marginTop: 1 },
  body: { borderTopWidth: 1, padding: 10, gap: 8 },
  input: {
    minHeight: 150,
    maxHeight: 230,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 10,
    lineHeight: 16,
    textAlignVertical: "top",
  },
  summary: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  summaryText: { fontSize: 7.5, lineHeight: 11, fontWeight: "800" },
  issues: { gap: 4 },
  issueRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  issueText: { flex: 1, fontSize: 8, lineHeight: 12, fontWeight: "700" },
  moreIssues: { fontSize: 7.5, marginLeft: 19 },
  preview: { borderWidth: 1, borderRadius: 11, overflow: "hidden" },
  previewHeading: { fontSize: 8.5, fontWeight: "900", padding: 8, paddingBottom: 4 },
  previewScroll: { maxHeight: 220 },
  previewRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 9,
    paddingVertical: 5,
  },
  previewTitle: { fontSize: 8.5, lineHeight: 12, fontWeight: "800" },
  previewLabels: { fontSize: 7, lineHeight: 10, fontWeight: "800", marginTop: 1 },
  actions: { flexDirection: "row", gap: 7 },
  action: { flex: 1 },
  footer: { fontSize: 7.5, lineHeight: 11, textAlign: "center" },
});
