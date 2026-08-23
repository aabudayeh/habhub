import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, TextStyle, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";

export function RichNoteText({
  body,
  numberOfLines,
  onToggleChecklist,
}: {
  body: string;
  numberOfLines?: number;
  onToggleChecklist?: (lineIndex: number) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const lines = body.split("\n");
  return (
    <View style={styles.root}>
      {lines.map((line, index) => {
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        const checklist = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        const quote = line.match(/^\s*>\s?(.*)$/);
        if (checklist)
          return (
            <Pressable
              key={index}
              disabled={!onToggleChecklist}
              onPress={() => onToggleChecklist?.(index)}
              style={styles.listRow}
            >
              <Ionicons
                name={
                  checklist[1].toLowerCase() === "x"
                    ? "checkbox"
                    : "square-outline"
                }
                size={14}
                color={
                  checklist[1].toLowerCase() === "x"
                    ? accent
                    : colors.faint
                }
              />
              <Inline
                value={checklist[2]}
                color={colors.ink}
                style={
                  checklist[1].toLowerCase() === "x"
                    ? styles.checked
                    : undefined
                }
              />
            </Pressable>
          );
        if (bullet || numbered)
          return (
            <View key={index} style={styles.listRow}>
              <Text selectable style={[styles.marker, { color: accent }]}>
                {numbered ? `${numbered[1]}.` : "•"}
              </Text>
              <Inline
                value={(bullet ?? numbered)![1 + Number(Boolean(numbered))]}
                color={colors.ink}
              />
            </View>
          );
        if (quote)
          return (
            <View
              key={index}
              style={[styles.quote, { borderLeftColor: accent }]}
            >
              <Inline value={quote[1]} color={colors.muted} />
            </View>
          );
        if (heading)
          return (
            <Inline
              key={index}
              value={heading[2]}
              color={colors.ink}
              style={[
                styles.heading,
                heading[1].length === 1
                  ? styles.h1
                  : heading[1].length === 2
                    ? styles.h2
                    : styles.h3,
              ]}
            />
          );
        return (
          <Inline
            key={index}
            value={line || " "}
            color={colors.ink}
            numberOfLines={numberOfLines}
          />
        );
      })}
    </View>
  );
}

function Inline({
  value,
  color,
  style,
  numberOfLines,
}: {
  value: string;
  color: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
}) {
  return (
    <Text
      translate={false}
      selectable
      numberOfLines={numberOfLines}
      style={[styles.text, { color }, style]}
    >
      {renderInlineParts(value)}
    </Text>
  );
}

function renderInlineParts(value: string): React.ReactNode[] {
  const parts = value.split(
    /(\[color=#[0-9a-fA-F]{6}\][^\n]*?\[\/color\]|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g,
  );
  return parts.map((part, index) => {
    const colored = part.match(
      /^\[color=(#[0-9a-fA-F]{6})\]([^\n]*?)\[\/color\]$/,
    );
    if (colored)
      return (
        <Text
          key={index}
          translate={false}
          selectable
          preserveColor
          style={{ color: colored[1] }}
        >
          {renderInlineParts(colored[2])}
        </Text>
      );
    if (/^\*\*.*\*\*$|^__.*__$/.test(part))
      return (
        <Text key={index} translate={false} selectable style={styles.bold}>
          {renderInlineParts(part.slice(2, -2))}
        </Text>
      );
    if (/^~~.*~~$/.test(part))
      return (
        <Text key={index} translate={false} selectable style={styles.strike}>
          {renderInlineParts(part.slice(2, -2))}
        </Text>
      );
    if (/^\*.*\*$|^_.*_$/.test(part))
      return (
        <Text key={index} translate={false} selectable style={styles.italic}>
          {renderInlineParts(part.slice(1, -1))}
        </Text>
      );
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <Text
          key={index}
          translate={false}
          selectable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(link[2])}
          style={styles.link}
        >
          {link[1]}
        </Text>
      );
    return part;
  });
}

const styles = StyleSheet.create({
  root: { gap: 3 },
  text: { flexShrink: 1, fontSize: 9, lineHeight: 14 },
  heading: { fontWeight: "900", marginTop: 2 },
  h1: { fontSize: 15, lineHeight: 20 },
  h2: { fontSize: 13, lineHeight: 18 },
  h3: { fontSize: 11, lineHeight: 16 },
  bold: { fontWeight: "900" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", opacity: 0.68 },
  link: {
    color: "#2877D4",
    textDecorationLine: "underline",
    fontWeight: "800",
  },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  marker: { width: 15, fontSize: 9, lineHeight: 14, fontWeight: "900" },
  checked: { textDecorationLine: "line-through", opacity: 0.62 },
  quote: { borderLeftWidth: 3, paddingLeft: 8, opacity: 0.86 },
});
