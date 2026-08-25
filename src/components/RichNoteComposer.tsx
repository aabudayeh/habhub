import { Ionicons } from "@expo/vector-icons";
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import {
  selectionAfterRichNoteTextChange,
  type RichNoteSelection,
} from "@/src/domain/richNoteSelection";
import { resolveWebEditorFontSize } from "@/src/domain/webSafeArea";
import { useAppColors, useFontScale, useGroupAccent } from "@/src/theme";

type Block = "text" | "h1" | "h2" | "bullet" | "check" | "quote";
type Inline = "bold" | "italic" | "strike" | "link";
type InlineRun = {
  text: string;
  inline: Set<Inline>;
  linkUrl?: string;
  textColor?: string;
};
type ParsedLine = {
  block: Block;
  checked?: boolean;
  runs: InlineRun[];
};
type TextSelection = RichNoteSelection;
const EMPTY_RUN = "\u200B";

function setInputSelection(
  input: NativeTextInput,
  selection: TextSelection,
) {
  // React Native mutates the native ref with `setSelection`, while
  // react-native-web exposes the underlying textarea's `setSelectionRange`.
  // Calling only the native method throws after Enter on web and unmounts the
  // editor, which appears to the user as a blank page.
  const selectionInput = input as unknown as {
    setSelection?: (start: number, end: number) => void;
    setSelectionRange?: (start: number, end: number) => void;
  };
  if (typeof selectionInput.setSelection === "function") {
    selectionInput.setSelection(selection.start, selection.end);
    return;
  }
  selectionInput.setSelectionRange?.(selection.start, selection.end);
}

function readInputSelection(
  input: NativeTextInput | null | undefined,
  fallback: TextSelection,
) {
  const webInput = input as unknown as {
    selectionStart?: number | null;
    selectionEnd?: number | null;
  };
  return typeof webInput?.selectionStart === "number" &&
    typeof webInput.selectionEnd === "number"
    ? { start: webInput.selectionStart, end: webInput.selectionEnd }
    : fallback;
}

export type RichNoteComposerHandle = {
  setBlock: (block: Block) => void;
  toggleInline: (style: Exclude<Inline, "link">) => void;
  setTextColor: (color?: string) => void;
  insertLink: (text: string, url: string) => void;
  replaceHashtag: (label: string) => void;
  replaceValue: (value: string) => void;
  getValue: () => string;
};

function parseRun(raw: string): InlineRun {
  const inline = new Set<Inline>();
  let text = raw;
  let linkUrl: string | undefined;
  let textColor: string | undefined;
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
    const colored = text.match(
      /^\[color=(#[0-9a-f]{6})\]([\s\S]*)\[\/color\]$/i,
    );
    if (colored) {
      textColor = colored[1].toUpperCase();
      text = colored[2];
      changed = true;
    }
  }
  return {
    text: text === EMPTY_RUN ? "" : text,
    inline,
    linkUrl,
    textColor,
  };
}

function parseRuns(raw: string) {
  const tokens = raw
    .split(
      /(\[color=#[0-9a-fA-F]{6}\][^\n]*?\[\/color\]|\*\*[^*\n]*\*\*|~~[^~\n]*~~|_[^_\n]*_|\[[^\]\n]+\]\([^)]+\))/g,
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
  if (run.inline.has("link")) text = `[${text}](${run.linkUrl ?? "https://"})`;
  if (run.inline.has("strike")) text = `~~${text}~~`;
  if (run.inline.has("italic")) text = `_${text}_`;
  if (run.inline.has("bold")) text = `**${text}**`;
  if (run.textColor) text = `[color=${run.textColor}]${text}[/color]`;
  return text;
}

function serializeLine(line: ParsedLine) {
  const text = line.runs.map(serializeRun).join("");
  if (line.block === "h1") return `# ${text}`;
  if (line.block === "h2") return `## ${text}`;
  if (line.block === "bullet") return `- ${text}`;
  if (line.block === "check") return `- [${line.checked ? "x" : " "}] ${text}`;
  if (line.block === "quote") return `> ${text}`;
  return text;
}

function sameRunFormat(left: InlineRun, right: InlineRun) {
  return (
    left.textColor === right.textColor &&
    left.linkUrl === right.linkUrl &&
    left.inline.size === right.inline.size &&
    [...left.inline].every((style) => right.inline.has(style))
  );
}

function normalizeRuns(
  runs: InlineRun[],
  targetRun: number,
  targetSelection: TextSelection,
) {
  const normalized: InlineRun[] = [];
  let normalizedTarget = 0;
  let normalizedSelection = targetSelection;

  runs.forEach((run, index) => {
    const previous = normalized[normalized.length - 1];
    if (previous && sameRunFormat(previous, run)) {
      const offset = previous.text.length;
      previous.text += run.text;
      if (index === targetRun) {
        normalizedTarget = normalized.length - 1;
        normalizedSelection = {
          start: targetSelection.start + offset,
          end: targetSelection.end + offset,
        };
      }
      return;
    }
    normalized.push({ ...run, inline: new Set(run.inline) });
    if (index === targetRun) normalizedTarget = normalized.length - 1;
  });

  if (!normalized.length) normalized.push(parseRun(""));
  return {
    runs: normalized,
    run: normalizedTarget,
    selection: normalizedSelection,
  };
}

/** Removes editor-only empty runs without changing meaningful rich text. */
export function cleanRichNoteValue(value: string) {
  return value
    .split("\n")
    .map((rawLine) => {
      const line = parseLine(rawLine);
      const runs = line.runs
        .map((run) => ({
          ...run,
          inline: new Set(run.inline),
          text: run.text.replaceAll(EMPTY_RUN, ""),
        }))
        .filter((run) => run.text.length > 0);
      return runs.length ? serializeLine({ ...line, runs }) : "";
    })
    .join("\n");
}

/** True only when the note contains user-visible text, not formatting markup. */
export function richNoteHasText(value: string) {
  return value
    .split("\n")
    .some((rawLine) =>
      parseLine(rawLine).runs.some(
        (run) => run.text.replaceAll(EMPTY_RUN, "").trim().length > 0,
      ),
    );
}

function formatRunAtSelection(
  line: ParsedLine,
  runIndex: number,
  selection: TextSelection,
  format: (run: InlineRun) => InlineRun,
) {
  const current = line.runs[runIndex] ?? parseRun("");
  const start = Math.max(0, Math.min(selection.start, current.text.length));
  const end = Math.max(start, Math.min(selection.end, current.text.length));
  const before = current.text.slice(0, start);
  const selected = current.text.slice(start, end);
  const after = current.text.slice(end);
  const replacements: InlineRun[] = [];

  if (before) replacements.push({ ...current, text: before });
  const localTarget = replacements.length;
  replacements.push(format({ ...current, text: selected }));
  if (after) replacements.push({ ...current, text: after });

  return normalizeRuns(
    [
      ...line.runs.slice(0, runIndex),
      ...replacements,
      ...line.runs.slice(runIndex + 1),
    ],
    runIndex + localTarget,
    start === end ? { start: 0, end: 0 } : { start: 0, end: selected.length },
  );
}

export const RichNoteComposer = forwardRef<
  RichNoteComposerHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onEditingChange?: (editing: boolean) => void;
    onHashtagQuery?: (query: string | null) => void;
  }
>(function RichNoteComposer(
  { value, onChange, onEditingChange, onHashtagQuery },
  ref,
) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const fontScale = useFontScale();
  const webDisplayEnvironment = useMemo(
    () =>
      Platform.OS === "web" && typeof navigator !== "undefined"
        ? {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            maxTouchPoints: navigator.maxTouchPoints,
          }
        : undefined,
    [],
  );
  const [active, setActive] = useState({ line: 0, run: 0 });
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [focusRequest, setFocusRequest] = useState(0);
  const inputs = useRef<Record<string, NativeTextInput | null>>({});
  const selections = useRef<Record<string, TextSelection>>({});
  const pendingFocus = useRef<{
    line: number;
    run: number;
    selection: TextSelection;
  } | null>(null);
  const rawLines = useMemo(() => draft.split("\n"), [draft]);
  const lines = useMemo(() => rawLines.map(parseLine), [rawLines]);
  const commit = useCallback(
    (next: string) => {
      draftRef.current = next;
      setDraft(next);
      onChange(next);
    },
    [onChange],
  );

  const replaceLine = useCallback(
    (index: number, next: ParsedLine) => {
      const updated = draftRef.current.split("\n");
      updated[index] = serializeLine(next);
      commit(updated.join("\n"));
    },
    [commit],
  );

  const focus = useCallback(
    (
      line: number,
      run: number,
      selection: TextSelection = { start: 0, end: 0 },
    ) => {
      pendingFocus.current = { line, run, selection };
      setFocusRequest((request) => request + 1);
    },
    [],
  );

  // Move focus to a newly created formatting run before the frame is painted.
  // A delayed focus caused Android to briefly dismiss and reopen the keyboard
  // whenever styles changed or a run boundary was deleted.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const key = `${target.line}:${target.run}`;
    const moveFocus = (input: NativeTextInput | null | undefined) => {
      if (!input) return false;
      input.focus();
      setInputSelection(input, target.selection);
      selections.current[key] = target.selection;
      pendingFocus.current = null;
      return true;
    };
    if (moveFocus(inputs.current[key])) return;
    const frame = requestAnimationFrame(() => {
      if (!moveFocus(inputs.current[key])) pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  useImperativeHandle(
    ref,
    () => ({
      replaceValue: (nextValue) => {
        draftRef.current = nextValue;
        setDraft(nextValue);
        onChange(nextValue);
      },
      getValue: () => draft,
      setBlock: (block) => {
        const line = lines[active.line] ?? parseLine("");
        replaceLine(active.line, { ...line, block });
      },
      toggleInline: (style) => {
        const line = lines[active.line] ?? parseLine("");
        const current = line.runs[active.run] ?? parseRun("");
        const key = `${active.line}:${active.run}`;
        const selection = readInputSelection(
          inputs.current[key],
          selections.current[key] ?? {
            start: current.text.length,
            end: current.text.length,
          },
        );
        const result = formatRunAtSelection(
          line,
          active.run,
          selection,
          (run) => {
            const inline = new Set(run.inline);
            if (inline.has(style)) inline.delete(style);
            else inline.add(style);
            return { ...run, inline };
          },
        );
        replaceLine(active.line, { ...line, runs: result.runs });
        setActive({ line: active.line, run: result.run });
        focus(active.line, result.run, result.selection);
      },
      setTextColor: (textColor) => {
        const line = lines[active.line] ?? parseLine("");
        const current = line.runs[active.run] ?? parseRun("");
        const key = `${active.line}:${active.run}`;
        const selection = readInputSelection(
          inputs.current[key],
          selections.current[key] ?? {
            start: current.text.length,
            end: current.text.length,
          },
        );
        const result = formatRunAtSelection(
          line,
          active.run,
          selection,
          (run) => ({
            ...run,
            textColor,
          }),
        );
        replaceLine(active.line, { ...line, runs: result.runs });
        setActive({ line: active.line, run: result.run });
        focus(active.line, result.run, result.selection);
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
      replaceHashtag: (label) => {
        const line = lines[active.line] ?? parseLine("");
        const current = line.runs[active.run] ?? parseRun("");
        const cleanLabel = label.trim().replace(/^#/, "").replace(/\s+/g, "_");
        const match = current.text.match(/(^|\s)#([\p{L}\p{N}_-]*)$/u);
        if (!match || !cleanLabel) return;
        const prefix = current.text.slice(0, match.index ?? 0);
        const text = `${prefix}${match[1]}#${cleanLabel} `;
        const runs = [...line.runs];
        runs[active.run] = {
          ...current,
          text,
        };
        replaceLine(active.line, { ...line, runs });
        onHashtagQuery?.(null);
        focus(active.line, active.run, {
          start: text.length,
          end: text.length,
        });
      },
    }),
    [active, draft, focus, lines, onChange, onHashtagQuery, replaceLine],
  );

  const replaceRunText = (
    lineIndex: number,
    runIndex: number,
    nextText: string,
  ) => {
    const currentRawLines = draftRef.current.split("\n");
    const current = parseLine(currentRawLines[lineIndex] ?? "");
    const activeRun = current.runs[runIndex] ?? parseRun("");
    const normalizedText = nextText.replace(/\r\n?/g, "\n");
    const parts = normalizedText.split("\n");

    if (parts.length === 1) {
      const key = `${lineIndex}:${runIndex}`;
      selections.current[key] = selectionAfterRichNoteTextChange(
        activeRun.text,
        normalizedText,
        selections.current[key] ?? {
          start: activeRun.text.length,
          end: activeRun.text.length,
        },
      );
      const runs = [...current.runs];
      runs[runIndex] = { ...activeRun, text: normalizedText };
      replaceLine(lineIndex, { ...current, runs });
      const hashtag = normalizedText.match(
        /(?:^|\s)#([\p{L}\p{N}_-]*)$/u,
      );
      onHashtagQuery?.(hashtag ? hashtag[1] : null);
      return;
    }

    // Each visual row is stored as one serialized rich-note line. A multiline
    // input gives mobile keyboards a real newline action; split that newline
    // back into rows while preserving both surrounding formatted runs.
    const nextBlock: Block =
      current.block === "bullet" ||
      current.block === "check" ||
      current.block === "quote"
        ? current.block
        : "text";

    const firstRuns = [
      ...current.runs.slice(0, runIndex),
      { ...activeRun, text: parts[0] },
    ];
    const finalRuns = [
      { ...activeRun, text: parts[parts.length - 1] },
      ...current.runs.slice(runIndex + 1),
    ];
    const inserted = [
      serializeLine({ ...current, runs: firstRuns }),
      ...parts.slice(1, -1).map((text) =>
        serializeLine({
          block: nextBlock,
          checked: false,
          runs: [{ ...activeRun, text }],
        }),
      ),
      serializeLine({
        block: nextBlock,
        checked: false,
        runs: finalRuns,
      }),
    ];
    const updated = [...currentRawLines];
    updated.splice(lineIndex, 1, ...inserted);
    commit(updated.join("\n"));
    const destinationLine = lineIndex + parts.length - 1;
    setActive({ line: destinationLine, run: 0 });
    focus(destinationLine, 0);
    onHashtagQuery?.(null);
  };

  const backspace = (
    lineIndex: number,
    runIndex: number,
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (event.nativeEvent.key !== "Backspace") return;
    const currentRawLines = draftRef.current.split("\n");
    const line = parseLine(currentRawLines[lineIndex] ?? "");
    const run = line?.runs[runIndex];
    if (!run) return;
    const selection = selections.current[`${lineIndex}:${runIndex}`] ?? {
      start: run.text.length,
      end: run.text.length,
    };
    if (selection.start === 0 && selection.end === 0 && runIndex > 0) {
      // Keep the active native input mounted while key-repeat crosses styled
      // runs. Removing/refocusing that input makes Android pause a held
      // Backspace at every bold/italic/color boundary.
      const runs = [...line.runs];
      let previousIndex = runIndex - 1;
      while (previousIndex >= 0 && !runs[previousIndex].text) {
        previousIndex -= 1;
      }
      if (previousIndex < 0) return;
      const previous = runs[previousIndex];
      const characters = [...previous.text];
      characters.pop();
      runs[previousIndex] = { ...previous, text: characters.join("") };
      replaceLine(lineIndex, { ...line, runs });
      selections.current[`${lineIndex}:${runIndex}`] = { start: 0, end: 0 };
      return;
    }
    if (run.text) return;
    if (line.runs.length > 1) {
      const runs = line.runs.filter((_, index) => index !== runIndex);
      replaceLine(lineIndex, { ...line, runs });
      const previous = Math.max(0, runIndex - 1);
      setActive({ line: lineIndex, run: previous });
      const previousText = runs[previous]?.text ?? "";
      const caret = runIndex === 0 ? 0 : previousText.length;
      focus(lineIndex, previous, {
        start: caret,
        end: caret,
      });
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
    const updated = [...currentRawLines];
    updated.splice(lineIndex, 1);
    commit(updated.join("\n"));
    const previousLine = parseLine(currentRawLines[lineIndex - 1] ?? "");
    const previousRun = Math.max(0, previousLine.runs.length - 1);
    setActive({ line: lineIndex - 1, run: previousRun });
    const previousText = previousLine.runs[previousRun]?.text ?? "";
    focus(lineIndex - 1, previousRun, {
      start: previousText.length,
      end: previousText.length,
    });
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
          key={lineIndex}
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
            {line.runs.map((run, runIndex) => {
              const key = `${lineIndex}:${runIndex}`;
              const formattedStyles = [
                line.block === "h1" && styles.h1,
                line.block === "h2" && styles.h2,
                run.inline.has("bold") && styles.bold,
                run.inline.has("italic") && styles.italic,
                run.inline.has("strike") && styles.strike,
                run.inline.has("link") && styles.link,
                line.checked && styles.checked,
              ];
              const fontSize =
                line.block === "h1" ? 20 : line.block === "h2" ? 16 : 13;
              const lineHeight =
                line.block === "h1" ? 27 : line.block === "h2" ? 23 : 20;
              const measuredFontSize = resolveWebEditorFontSize(
                fontSize * fontScale,
                webDisplayEnvironment,
              );
              const isTailRun = runIndex === line.runs.length - 1;
              return (
                <View
                  key={key}
                  style={[
                    styles.run,
                    line.runs.length === 1 && styles.onlyRun,
                    isTailRun && styles.tailRun,
                  ]}
                >
                  <NativeText
                    allowFontScaling={false}
                    style={[
                      styles.input,
                      styles.runMeasure,
                      formattedStyles,
                      {
                        color: run.inline.has("link")
                          ? "#2877D4"
                          : (run.textColor ?? colors.ink),
                        fontSize: measuredFontSize,
                        lineHeight: lineHeight * fontScale,
                      },
                    ]}
                  >
                    {`${run.text}${EMPTY_RUN}`}
                  </NativeText>
                  <TextInput
                    ref={(input) => {
                      inputs.current[key] = input;
                    }}
                    value={run.text}
                    // Styled runs are separate native inputs. Treating every
                    // run as a sentence start makes Android capitalize the
                    // next word whenever formatting changes mid-line.
                    autoCapitalize={runIndex === 0 ? "sentences" : "none"}
                    onFocus={() => {
                      selections.current[key] ??= {
                        start: run.text.length,
                        end: run.text.length,
                      };
                      setActive({ line: lineIndex, run: runIndex });
                      onEditingChange?.(true);
                    }}
                    onSelectionChange={(
                      event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
                    ) => {
                      selections.current[key] = event.nativeEvent.selection;
                    }}
                    onChangeText={(text) =>
                      replaceRunText(lineIndex, runIndex, text)
                    }
                    onKeyPress={(event) =>
                      backspace(lineIndex, runIndex, event)
                    }
                    multiline
                    scrollEnabled={false}
                    enterKeyHint="enter"
                    submitBehavior="newline"
                    placeholder={
                      lineIndex === 0 && runIndex === 0
                        ? "Write anything…"
                        : undefined
                    }
                    placeholderTextColor={colors.faint}
                    style={[
                      styles.input,
                      styles.overlayRunInput,
                      formattedStyles,
                      {
                        color: run.inline.has("link")
                          ? "#2877D4"
                          : (run.textColor ?? colors.ink),
                        lineHeight: lineHeight * fontScale,
                      },
                    ]}
                  />
                </View>
              );
            })}
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
  run: {
    flexShrink: 1,
    minWidth: 1,
    maxWidth: "100%",
    minHeight: 24,
    position: "relative",
  },
  onlyRun: { flex: 1 },
  runMeasure: {
    opacity: 0,
  },
  // Keep the trailing run's width stable even after Enter moves focus to the
  // next logical line. Tying this width to the active input made the previous
  // line suddenly shrink and forced its absolute TextInput into narrow,
  // overlapping visual rows. flexGrow reserves only real remaining row space,
  // so adjacent formatting boundaries still have no artificial gap.
  tailRun: { flexGrow: 1 },
  overlayRunInput: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
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
    paddingVertical: 1,
    paddingHorizontal: 0,
    fontSize: 13,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  h1: { fontSize: 20, lineHeight: 27, fontWeight: "900" },
  h2: { fontSize: 16, lineHeight: 23, fontWeight: "900" },
  bold: { fontWeight: "900" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", opacity: 0.68 },
  link: { textDecorationLine: "underline", fontWeight: "800" },
  checked: { textDecorationLine: "line-through", opacity: 0.62 },
});
