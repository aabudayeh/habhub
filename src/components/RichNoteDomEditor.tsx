'use dom';

import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LinkNode, $createLinkNode } from "@lexical/link";
import {
  CHECK_LIST,
  TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  TextNode,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import {
  useDOMImperativeHandle,
  type DOMImperativeFactory,
  type DOMProps,
} from "expo/dom";
import { useEffect, useRef, type Ref } from "react";

import { cleanRichNoteValue } from "@/src/domain/richNoteValue";

export type RichNoteBlock = "text" | "h1" | "h2" | "bullet" | "check" | "quote";
export type RichNoteInline = "bold" | "italic" | "strike";

type DomJsonValue =
  | boolean
  | number
  | string
  | null
  | DomJsonValue[]
  | { [key: string]: DomJsonValue | undefined };

export interface RichNoteDomEditorRef extends DOMImperativeFactory {
  setBlock: (...args: DomJsonValue[]) => void;
  toggleInline: (...args: DomJsonValue[]) => void;
  setTextColor: (...args: DomJsonValue[]) => void;
  insertLink: (...args: DomJsonValue[]) => void;
  replaceHashtag: (...args: DomJsonValue[]) => void;
  replaceValue: (...args: DomJsonValue[]) => void;
  undo: (...args: DomJsonValue[]) => void;
  redo: (...args: DomJsonValue[]) => void;
}

type RichNoteDomEditorProps = {
  ref: Ref<RichNoteDomEditorRef>;
  value: string;
  inkColor: string;
  mutedColor: string;
  borderColor: string;
  cardColor: string;
  accentColor: string;
  fontSize: number;
  onChange: (value: string) => Promise<void>;
  onEditingChange: (editing: boolean) => Promise<void>;
  onHashtagQuery: (query: string | null) => Promise<void>;
  dom?: DOMProps;
};

const COLOR_TRANSFORMER: TextMatchTransformer = {
  dependencies: [TextNode],
  export: (node, _exportChildren, exportFormat) => {
    if (!$isTextNode(node)) return null;
    const color = node.getStyle().match(/(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i)?.[1];
    if (!color) return null;
    return `[color=${color.toUpperCase()}]${exportFormat(
      node,
      node.getTextContent(),
    )}[/color]`;
  },
  importRegExp:
    /\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/,
  regExp:
    /\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]$/,
  replace: (node, match) => {
    node.setTextContent(match[2]);
    node.setStyle(`color: ${match[1].toUpperCase()}`);
    return node;
  },
  trigger: "]",
  type: "text-match",
};

const RICH_NOTE_TRANSFORMERS: Transformer[] = [
  CHECK_LIST,
  COLOR_TRANSFORMER,
  ...TRANSFORMERS,
];

function hashtagAtSelection() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  if (!$isTextNode(node)) return null;
  const beforeCaret = node.getTextContent().slice(0, anchor.offset);
  return beforeCaret.match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u)?.[1] ?? null;
}

function serializeEditorState(editorState: EditorState) {
  return editorState.read(() =>
    cleanRichNoteValue(
      $convertToMarkdownString(RICH_NOTE_TRANSFORMERS),
    ),
  );
}

function focusWithSelection(
  editor: LexicalEditor,
  savedSelection: RangeSelection | null,
  action: () => void,
) {
  // The toolbar lives outside the DOM surface so it can stay native with the
  // rest of the note screen. Its press blurs ContentEditable before this bridge
  // receives the command. Restore the last real Lexical selection so formatting
  // applies exactly where the user selected instead of jumping to the note end.
  const selectionToRestore = savedSelection?.clone() ?? null;
  editor.focus(
    () => {
      editor.update(() => {
        if (selectionToRestore) $setSelection(selectionToRestore);
        action();
      });
    },
    { defaultSelection: "rootEnd" },
  );
}

function EditorBridge({
  editorRef,
  onChange,
  onHashtagQuery,
}: {
  editorRef: Ref<RichNoteDomEditorRef>;
  onChange: RichNoteDomEditorProps["onChange"];
  onHashtagQuery: RichNoteDomEditorProps["onHashtagQuery"];
}) {
  const [editor] = useLexicalComposerContext();
  const lastRangeSelection = useRef<RangeSelection | null>(null);

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection))
            lastRangeSelection.current = selection.clone();
        });
      },
    );
    // Mouse/touch/keyboard selection can change without content changing, so
    // capture that command too; update listeners alone miss Ctrl+A and drags.
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection))
          lastRangeSelection.current = selection.clone();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregisterSelection();
      unregisterUpdate();
    };
  }, [editor]);

  const runAtLastSelection = (action: () => void) =>
    focusWithSelection(editor, lastRangeSelection.current, action);

  useDOMImperativeHandle(
    editorRef,
    () => ({
      setBlock: (block) => {
        if (
          typeof block !== "string" ||
          !["text", "h1", "h2", "bullet", "check", "quote"].includes(
            block,
          )
        )
          return;
        const nextBlock = block as RichNoteBlock;
        runAtLastSelection(() => {
          if (nextBlock === "bullet") {
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
            return;
          }
          if (nextBlock === "check") {
            editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
            return;
          }
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          if (nextBlock === "h1" || nextBlock === "h2") {
            $setBlocksType(selection, () => $createHeadingNode(nextBlock));
          } else if (nextBlock === "quote") {
            $setBlocksType(selection, () => $createQuoteNode());
          } else {
            $setBlocksType(selection, () => $createParagraphNode());
          }
        });
      },
      toggleInline: (style) => {
        if (
          typeof style !== "string" ||
          !["bold", "italic", "strike"].includes(style)
        )
          return;
        const nextStyle = style as RichNoteInline;
        const lexicalStyle: TextFormatType =
          nextStyle === "strike" ? "strikethrough" : nextStyle;
        runAtLastSelection(() =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, lexicalStyle),
        );
      },
      setTextColor: (color) => {
        const nextColor = typeof color === "string" ? color : null;
        runAtLastSelection(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          $patchStyleText(selection, { color: nextColor });
        });
      },
      insertLink: (text, url) => {
        if (typeof text !== "string" || typeof url !== "string") return;
        runAtLastSelection(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const link = $createLinkNode(url);
          link.append($createTextNode(text));
          selection.insertNodes([link]);
          const next = $createTextNode("");
          link.insertAfter(next);
          next.select(0, 0);
        });
      },
      replaceHashtag: (label) => {
        if (typeof label !== "string") return;
        const cleanLabel = label.trim().replace(/^#/, "").replace(/\s+/g, "_");
        if (!cleanLabel) return;
        runAtLastSelection(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed())
            return;
          const anchor = selection.anchor;
          const node = anchor.getNode();
          if (!$isTextNode(node)) return;
          const text = node.getTextContent();
          const before = text.slice(0, anchor.offset);
          const match = before.match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u);
          if (!match || match.index === undefined) return;
          const hashIndex = before.lastIndexOf("#");
          const nextText = `${text.slice(0, hashIndex)}#${cleanLabel}${text.slice(
            anchor.offset,
          )}`;
          node.setTextContent(nextText);
          const nextOffset = hashIndex + cleanLabel.length + 1;
          node.select(nextOffset, nextOffset);
        });
        void onHashtagQuery(null);
      },
      replaceValue: (nextValue) => {
        if (typeof nextValue !== "string") return;
        editor.update(() => {
          $convertFromMarkdownString(
            cleanRichNoteValue(nextValue),
            RICH_NOTE_TRANSFORMERS,
          );
        });
      },
      undo: () => {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
      },
      redo: () => {
        editor.dispatchCommand(REDO_COMMAND, undefined);
      },
    }),
    [editor, onHashtagQuery],
  );

  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        void onChange(serializeEditorState(editorState));
        const query = editorState.read(hashtagAtSelection);
        void onHashtagQuery(query);
      }}
    />
  );
}

export default function RichNoteDomEditor({
  ref,
  value,
  inkColor,
  mutedColor,
  borderColor,
  cardColor,
  accentColor,
  fontSize,
  onChange,
  onEditingChange,
  onHashtagQuery,
}: RichNoteDomEditorProps) {
  const initialConfig = {
    namespace: "MetricRallyJournal",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
    theme: {
      heading: { h1: "note-h1", h2: "note-h2" },
      link: "note-link",
      list: {
        listitem: "note-list-item",
        listitemChecked: "note-list-item-checked",
        listitemUnchecked: "note-list-item-unchecked",
        ul: "note-list",
      },
      paragraph: "note-paragraph",
      quote: "note-quote",
      text: {
        bold: "note-bold",
        italic: "note-italic",
        strikethrough: "note-strike",
      },
    },
    editorState: () =>
      $convertFromMarkdownString(
        cleanRichNoteValue(value),
        RICH_NOTE_TRANSFORMERS,
      ),
    onError: (error: Error) => {
      throw error;
    },
  };

  return (
    <div className="note-shell">
      <style>{`
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        html, body, #root { margin: 0; min-height: 100%; background: transparent; }
        body { overflow: hidden; }
        .note-shell {
          position: relative;
          min-height: 260px;
          width: 100%;
          overflow: hidden;
          border: 1px solid ${borderColor};
          border-radius: 12px;
          background: ${cardColor};
        }
        .note-input {
          min-height: 258px;
          width: 100%;
          padding: 11px;
          outline: none;
          color: ${inkColor};
          background: transparent;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: ${Math.max(16, fontSize)}px;
          line-height: 1.48;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          caret-color: ${accentColor};
          -webkit-user-select: text;
          user-select: text;
        }
        .note-placeholder {
          position: absolute;
          top: 11px;
          left: 11px;
          right: 11px;
          pointer-events: none;
          color: ${mutedColor};
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: ${Math.max(16, fontSize)}px;
          line-height: 1.48;
        }
        .note-paragraph { margin: 0 0 3px; min-height: 1.48em; }
        .note-h1 { margin: 3px 0; font-size: 1.5em; line-height: 1.3; font-weight: 900; }
        .note-h2 { margin: 3px 0; font-size: 1.22em; line-height: 1.35; font-weight: 900; }
        .note-bold { font-weight: 900; }
        .note-italic { font-style: italic; }
        .note-strike { text-decoration: line-through; opacity: 0.68; }
        .note-link { color: #2877D4; text-decoration: underline; font-weight: 700; }
        .note-quote {
          margin: 3px 0;
          padding-left: 9px;
          border-left: 3px solid ${accentColor};
          color: ${mutedColor};
        }
        .note-list { margin: 2px 0; padding-left: 24px; }
        .note-list-item { margin: 1px 0; }
        .note-list-item-checked,
        .note-list-item-unchecked {
          position: relative;
          list-style: none;
          padding-left: 5px;
        }
        .note-list-item-checked::before,
        .note-list-item-unchecked::before {
          position: absolute;
          left: -20px;
          top: 0.08em;
          width: 14px;
          height: 14px;
          border: 1.5px solid ${accentColor};
          border-radius: 4px;
          content: "";
        }
        .note-list-item-checked { text-decoration: line-through; opacity: 0.65; }
        .note-list-item-checked::before {
          content: "✓";
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${cardColor};
          background: ${accentColor};
          font-size: 11px;
          font-weight: 900;
        }
      `}</style>
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Note body"
              autoCapitalize="sentences"
              autoCorrect="on"
              className="note-input"
              dir="auto"
              onBlur={() => void onEditingChange(false)}
              onFocus={() => void onEditingChange(true)}
              spellCheck
            />
          }
          placeholder={<div className="note-placeholder">Write anything…</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <EditorBridge
          editorRef={ref}
          onChange={onChange}
          onHashtagQuery={onHashtagQuery}
        />
      </LexicalComposer>
    </div>
  );
}
