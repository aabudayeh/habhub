import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import type { RichNoteComposerHandle } from "@/src/components/RichNoteComposer";
import { useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";

/** The same editor commands and selection-preserving toolbar for both journals. */
export function RichNoteFormattingToolbar({
  composer,
  onColor,
  onLink,
  onDraw,
  onFormat,
  disabled = false,
}: {
  composer: React.RefObject<RichNoteComposerHandle | null>;
  onColor: () => void;
  onLink: () => void;
  onDraw?: () => void;
  onFormat?: () => void;
  disabled?: boolean;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const tools: { label: string; icon?: keyof typeof Ionicons.glyphMap; glyph?: string; action: () => void }[] = [
    { label: "Undo", icon: "arrow-undo", action: () => composer.current?.undo() },
    { label: "Redo", icon: "arrow-redo", action: () => composer.current?.redo() },
    { label: "Heading 1", glyph: "H1", action: () => composer.current?.setBlock("h1") },
    { label: "Heading 2", glyph: "H2", action: () => composer.current?.setBlock("h2") },
    { label: "Bold", glyph: "B", action: () => { composer.current?.toggleInline("bold"); onFormat?.(); } },
    { label: "Italic", glyph: "I", action: () => composer.current?.toggleInline("italic") },
    { label: "Strikethrough", glyph: "S", action: () => composer.current?.toggleInline("strike") },
    { label: "Text color", icon: "color-palette-outline", action: onColor },
    { label: "Bullet list", icon: "list", action: () => composer.current?.setBlock("bullet") },
    { label: "Checklist", icon: "checkbox-outline", action: () => composer.current?.setBlock("check") },
    { label: "Quote", icon: "chatbox-outline", action: () => composer.current?.setBlock("quote") },
    { label: "Insert hyperlink", icon: "link-outline", action: onLink },
    ...(onDraw ? [{ label: "Draw on note", icon: "brush-outline" as const, action: onDraw }] : []),
  ];
  return (
    <View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {tools.map((tool) => (
        <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={t(tool.label)}
          accessibilityState={{ disabled }} disabled={disabled} onPress={tool.action} hitSlop={2}
          style={[styles.tool, { backgroundColor: colors.canvas, opacity: disabled ? 0.4 : 1 }]}>
          {tool.icon ? <Ionicons name={tool.icon} size={17} color={accent} /> : (
            <Text translate={false} style={[styles.text, { color: colors.ink }, tool.glyph === "I" && styles.italic, tool.glyph === "S" && styles.strike]}>{tool.glyph}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { borderWidth: 1, borderRadius: 12, padding: 4, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  tool: { minWidth: 40, minHeight: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  text: { fontSize: 12, fontWeight: "800" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
});
