import { Ionicons } from "@expo/vector-icons";
import React, {
  forwardRef,
  useCallback,
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
type InlineRun = {
  text: string;
  inline: Set<Inline>;
  linkUrl?: string;
};
type ParsedLine = {
  block: Block;
  checked?: boolean;
  runs: InlineRun[];
};
const EMPTY_RUN = "\u200B";

export type RichNoteComposerHandle = {
  setBlock: (block: Block) => void;
  toggleInline: (style: Exclude<Inline, "link">) => void;
  insertLink: (text: string, url: string) => void;
};

function parseRun(raw: string): InlineRun {
  const inline = new Set<Inline>();
  let text = raw;
  let linkUrl: string | undefined;
  let changed = true;
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
  return { text: text === EMPTY_RUN ? "" : text, inline, linkUrl };
}

function parseRuns(raw: string) {
  const tokens = raw
    .split(
      /(\*\*[^*\n]*\*\*|~~[^~\n]*~~|_[^_\n]*_|\[[^\]\n]+\]\([^)]+\))/g,
    )
    .filter((token) => token.length > 0);
  return tokens.length ? tokens.map(parseRun) : [parseRun("")];
}

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
  return { block, checked, runs: parseRuns(text) };
}

function serializeRun(run: InlineRun) {
  let text = run.text || EMPTY_RUN;
  if (run.inline.has("link"))
    text = `[${text}](${run.linkUrl ?? "https://"})`;
  if (run.inline.has("strike")) text = `~~${text}~~`;
  if (run.inline.has("italic")) text = `_${text}_`;
  if (run.inline.has("bold")) text = `**${text}**`;
  return text;
}

function serializeLine(line: ParsedLine) {
  const text = line.runs.map(serializeRun).join("");
  if (line.block === "h1") return `# ${text}`;
  if (line.block === "h2") return `## ${text}`;
  if (line.block === "bullet") return `- ${text}`;
  if (line.block === "check")
    return `- [${line.checked ? "x" : " "}] ${text}`;
  if (line.block === "quote") return `> ${text}`;
  return text;
}

function runWidth(text: string, block: Block) {
  const characterWidth = block === "h1" ? 9 : block === "h2" ? 7.5 : 5.8;
  return Math.max(18, Math.min(290, text.length * characterWidth + 8));
}

export const RichNoteComposer = forwardRef<
  RichNoteComposerHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onEditingChange?: (editing: boolean) => void;
  }
>(function RichNoteComposer(
  { value, onChange, onEditingChange },
  ref,
) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [active, setActive] = useState({ line: 0, run: 0 });
  const inputs = useRef<Record<string, NativeTextInput | null>>({});
  const rawLines = useMemo(() => value.split("\n"), [value]);
  const lines = useMemo(() => rawLines.map(parseLine), [rawLines]);

  const replaceLine = useCallback(
    (index: number, next: ParsedLine) => {
      const updated = [...rawLines];
      updated[index] = serializeLine(next);
      onChange(updated.join("\n"));
    },
    [onChange, rawLines],
  );

  const focus = (line: number, run: number) =>
    setTimeout(() => inputs.current[`${line}:${run}`]?.focus(), 30);

  useImperativeHandle(
    ref,
    () => ({
      setBlock: (block) => {
        const line = lines[active.line] ?? parseLine("");
        replaceLine(active.line, { ...line, block });
      },
      toggleInline: (style) => {
        const line = lines[active.line] ?? parseLine("");
        const current = line.runs[active.run] ?? parseRun("");
        const inline = new Set(current.inline);
        if (inline.has(style)) inline.delete(style);
        else inline.add(style);
        if (!current.text) {
          const runs = [...line.runs];
          runs[active.run] = { ...current, inline };
          replaceLine(active.line, { ...line, runs });
          return;
        }
        const nextRun = { text: "", inline };
        const runs = [...line.runs];
        runs.splice(active.run + 1, 0, nextRun);
        replaceLine(active.line, { ...line, runs });
        setActive({ line: active.line, run: active.run + 1 });
        focus(active.line, active.run + 1);
      },
      insertLink: (text, url) => {
        const line = lines[active.line] ?? parseLine("");
        const current = line.runs[active.run] ?? parseRun("");
        const linked: InlineRun = {
          text,
          inline: new Set(["link"]),
          linkUrl: url,
        };
        const runs = [...line.runs];
        if (!current.text) runs[active.run] = linked;
        else runs.splice(active.run + 1, 0, linked);
        const nextIndex = !current.text ? active.run + 1 : active.run + 2;
        runs.splice(nextIndex, 0, { text: "", inline: new Set() });
        replaceLine(active.line, { ...line, runs });
        setActive({ line: active.line, run: nextIndex });
        focus(active.line, nextIndex);
      },
    }),
    [active, lines, replaceLine],
  );

  const insertAfter = (index: number, runIndex: number) => {
    const current = lines[index] ?? parseLine("");
    const activeRun = current.runs[runIndex] ?? parseRun("");
    const nextBlock: Block =
      current.block === "bullet" ||
      current.block === "check" ||
      current.block === "quote"
        ? current.block
        : "text";
    const next = serializeLine({
      block: nextBlock,
      checked: false,
      runs: [{ text: "", inline: new Set(activeRun.inline) }],
    });
    const updated = [...rawLines];
    updated.splice(index + 1, 0, next);
    onChange(updated.join("\n"));
    setActive({ line: index + 1, run: 0 });
    focus(index + 1, 0);
  };

  const backspace = (
    lineIndex: number,
    runIndex: number,
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (event.nativeEvent.key !== "Backspace") return;
    const line = lines[lineIndex];
    const run = line?.runs[runIndex];
    if (run?.text) return;
    if (line.runs.length > 1) {
      const runs = line.runs.filter((_, index) => index !== runIndex);
      replaceLine(lineIndex, { ...line, runs });
      const previous = Math.max(0, runIndex - 1);
      setActive({ line: lineIndex, run: previous });
      focus(lineIndex, previous);
      return;
    }
    if (line.block !== "text" || run.inline.size) {
      replaceLine(lineIndex, {
        block: "text",
        runs: [{ text: "", inline: new Set() }],
      });
      return;
    }
    if (lineIndex <= 0) return;
    const updated = [...rawLines];
    updated.splice(lineIndex, 1);
    onChange(updated.join("\n"));
    const previousRun = Math.max(0, lines[lineIndex - 1].runs.length - 1);
    setActive({ line: lineIndex - 1, run: previousRun });
    focus(lineIndex - 1, previousRun);
  };

  return (
    <View
      style={[
        styles.editor,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      {lines.map((line, lineIndex) => (
        <View
          key={`${lineIndex}-${rawLines.length}`}
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
                replaceLine(lineIndex, { ...line, checked: !line.checked })
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
          <View style={styles.runs}>
            {line.runs.map((run, runIndex) => (
              <TextInput
                key={`${lineIndex}:${runIndex}`}
                ref={(input) => {
                  inputs.current[`${lineIndex}:${runIndex}`] = input;
                }}
                value={run.text}
                onFocus={() => {
                  setActive({ line: lineIndex, run: runIndex });
                  onEditingChange?.(true);
                }}
                onChangeText={(text) => {
                  const runs = [...line.runs];
                  runs[runIndex] = { ...run, text };
                  replaceLine(lineIndex, { ...line, runs });
                }}
                onSubmitEditing={() => insertAfter(lineIndex, runIndex)}
                onKeyPress={(event) =>
                  backspace(lineIndex, runIndex, event)
                }
                blurOnSubmit={false}
                multiline={false}
                placeholder={
                  lineIndex === 0 && runIndex === 0
                    ? "Write anything…"
                    : undefined
                }
                placeholderTextColor={colors.faint}
                style={[
                  styles.input,
                  {
                    color: run.inline.has("link") ? "#2877D4" : colors.ink,
                    width:
                      line.runs.length === 1
                        ? undefined
                        : runWidth(run.text, line.block),
                    flex: line.runs.length === 1 ? 1 : undefined,
                  },
                  line.block === "h1" && styles.h1,
                  line.block === "h2" && styles.h2,
                  run.inline.has("bold") && styles.bold,
                  run.inline.has("italic") && styles.italic,
                  run.inline.has("strike") && styles.strike,
                  run.inline.has("link") && styles.link,
                  line.checked && styles.checked,
                ]}
              />
            ))}
          </View>
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
  },
  line: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  runs: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  marker: {
    width: 17,
    paddingTop: 3,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
  },
  check: {
    width: 23,
    minHeight: 24,
    paddingTop: 3,
  },
  input: {
    minHeight: 24,
    paddingVertical: 2,
    paddingHorizontal: 0,
    fontSize: 10,
    lineHeight: 16,
  },
  h1: { fontSize: 17, lineHeight: 21, fontWeight: "900" },
  h2: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  bold: { fontWeight: "900" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", opacity: 0.68 },
  link: { textDecorationLine: "underline", fontWeight: "800" },
  checked: { textDecorationLine: "line-through", opacity: 0.62 },
});
