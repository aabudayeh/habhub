import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  TextInput as NativeTextInput,
  TextInputKeyPressEventData,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Block = "text" | "h1" | "h2" | "bullet" | "check" | "quote";
type Inline = "bold" | "italic" | "strike" | "link";
type ParsedLine = {
  block: Block;
  text: string;
  checked?: boolean;
  inline: Set<Inline>;
  linkUrl?: string;
};

export type RichNoteComposerHandle = {
  setBlock: (block: Block) => void;
  toggleInline: (style: Inline) => void;
};

function parseLine(raw: string): ParsedLine {
  let block: Block = "text";
  let checked = false;
  let text = raw;
  if (/^##\s/.test(text)) {
    block = "h2";
    text = text.replace(/^##\s/, "");
  } else if (/^#\s/.test(text)) {
    block = "h1";
    text = text.replace(/^#\s/, "");
  } else if (/^[-*]\s+\[[ xX]\]\s/.test(text)) {
    block = "check";
    checked = /^[-*]\s+\[[xX]\]/.test(text);
    text = text.replace(/^[-*]\s+\[[ xX]\]\s/, "");
  } else if (/^[-*+]\s/.test(text)) {
    block = "bullet";
    text = text.replace(/^[-*+]\s/, "");
  } else if (/^>\s?/.test(text)) {
    block = "quote";
    text = text.replace(/^>\s?/, "");
  }
  const inline = new Set<Inline>();
  let changed = true;
  let linkUrl: string | undefined;
  while (changed) {
    changed = false;
    if (/^\*\*[\s\S]*\*\*$/.test(text)) {
      inline.add("bold");
      text = text.slice(2, -2);
      changed = true;
    }
    if (/^_[\s\S]*_$/.test(text)) {
      inline.add("italic");
      text = text.slice(1, -1);
      changed = true;
    }
    if (/^~~[\s\S]*~~$/.test(text)) {
      inline.add("strike");
      text = text.slice(2, -2);
      changed = true;
    }
    const link = text.match(/^\[([\s\S]*)\]\(([^)]+)\)$/);
    if (link) {
      inline.add("link");
      text = link[1];
      linkUrl = link[2];
      changed = true;
    }
  }
  return { block, text, checked, inline, linkUrl };
}

function serializeLine(line: ParsedLine) {
  let text = line.text;
  if (line.inline.has("link"))
    text = `[${text}](${line.linkUrl ?? "https://"})`;
  if (line.inline.has("strike")) text = `~~${text}~~`;
  if (line.inline.has("italic")) text = `_${text}_`;
  if (line.inline.has("bold")) text = `**${text}**`;
  if (line.block === "h1") return `# ${text}`;
  if (line.block === "h2") return `## ${text}`;
  if (line.block === "bullet") return `- ${text}`;
  if (line.block === "check")
    return `- [${line.checked ? "x" : " "}] ${text}`;
  if (line.block === "quote") return `> ${text}`;
  return text;
}

export const RichNoteComposer = forwardRef<
  RichNoteComposerHandle,
  { value: string; onChange: (value: string) => void }
>(function RichNoteComposer({ value, onChange }, ref) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [activeLine, setActiveLine] = useState(0);
  const inputs = useRef<(NativeTextInput | null)[]>([]);
  const rawLines = useMemo(() => value.split("\n"), [value]);
  const lines = useMemo(() => rawLines.map(parseLine), [rawLines]);

  const replace = useCallback((index: number, next: ParsedLine) => {
    const updated = [...rawLines];
    updated[index] = serializeLine(next);
    onChange(updated.join("\n"));
  }, [onChange, rawLines]);

  useImperativeHandle(
    ref,
    () => ({
      setBlock: (block) => {
        const line = lines[activeLine] ?? parseLine("");
        replace(activeLine, { ...line, block });
      },
      toggleInline: (style) => {
        const line = lines[activeLine] ?? parseLine("");
        const inline = new Set(line.inline);
        if (inline.has(style)) inline.delete(style);
        else inline.add(style);
        replace(activeLine, { ...line, inline });
      },
    }),
    [activeLine, lines, replace],
  );

  const insertAfter = (index: number) => {
    const current = lines[index] ?? parseLine("");
    const nextBlock: Block =
      current.block === "bullet" ||
      current.block === "check" ||
      current.block === "quote"
        ? current.block
        : "text";
    const next = serializeLine({
      block: nextBlock,
      text: "",
      checked: false,
      inline: new Set(current.inline),
      linkUrl: current.linkUrl,
    });
    const updated = [...rawLines];
    updated.splice(index + 1, 0, next);
    onChange(updated.join("\n"));
    setActiveLine(index + 1);
    setTimeout(() => inputs.current[index + 1]?.focus(), 30);
  };

  const backspace = (
    index: number,
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (event.nativeEvent.key !== "Backspace") return;
    const current = lines[index];
    if (current?.text) return;
    if (current?.block !== "text" || current.inline.size) {
      replace(index, {
        block: "text",
        text: "",
        inline: new Set(),
      });
      return;
    }
    if (index <= 0) return;
    const updated = [...rawLines];
    updated.splice(index, 1);
    onChange(updated.join("\n"));
    setActiveLine(index - 1);
    setTimeout(() => inputs.current[index - 1]?.focus(), 30);
  };

  return (
    <View
      style={[
        styles.editor,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      {lines.map((line, index) => (
        <View
          key={`${index}-${rawLines.length}`}
          style={[
            styles.line,
            line.block === "quote" && {
              borderLeftColor: accent,
              borderLeftWidth: 3,
              paddingLeft: 7,
            },
          ]}
        >
          {line.block === "bullet" ? (
            <Text style={[styles.marker, { color: accent }]}>•</Text>
          ) : null}
          {line.block === "check" ? (
            <Pressable
              onPress={() =>
                replace(index, { ...line, checked: !line.checked })
              }
              style={styles.check}
            >
              <Ionicons
                name={line.checked ? "checkbox" : "square-outline"}
                size={16}
                color={line.checked ? accent : colors.faint}
              />
            </Pressable>
          ) : null}
          <TextInput
            ref={(input) => {
              inputs.current[index] = input;
            }}
            value={line.text}
            onFocus={() => setActiveLine(index)}
            onChangeText={(text) => replace(index, { ...line, text })}
            onSubmitEditing={() => insertAfter(index)}
            onKeyPress={(event) => backspace(index, event)}
            blurOnSubmit={false}
            multiline={false}
            placeholder={index === 0 ? "Write anything…" : undefined}
            placeholderTextColor={colors.faint}
            style={[
              styles.input,
              { color: line.inline.has("link") ? "#2877D4" : colors.ink },
              line.block === "h1" && styles.h1,
              line.block === "h2" && styles.h2,
              line.inline.has("bold") && styles.bold,
              line.inline.has("italic") && styles.italic,
              line.inline.has("strike") && styles.strike,
              line.inline.has("link") && styles.link,
              line.checked && styles.checked,
            ]}
          />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  editor: {
    minHeight: 260,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  line: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  marker: {
    width: 18,
    paddingTop: 5,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: "900",
  },
  check: {
    width: 24,
    minHeight: 28,
    paddingTop: 5,
  },
  input: {
    flex: 1,
    minHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 0,
    fontSize: 10,
    lineHeight: 18,
  },
  h1: { fontSize: 17, lineHeight: 23, fontWeight: "900" },
  h2: { fontSize: 14, lineHeight: 20, fontWeight: "900" },
  bold: { fontWeight: "900" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", opacity: 0.68 },
  link: { textDecorationLine: "underline", fontWeight: "800" },
  checked: { textDecorationLine: "line-through", opacity: 0.62 },
});
