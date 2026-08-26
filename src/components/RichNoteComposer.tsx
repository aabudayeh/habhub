import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { StyleSheet, View } from "react-native";

import RichNoteDomEditor, {
  type RichNoteBlock,
  type RichNoteDomEditorRef,
  type RichNoteInline,
} from "@/src/components/RichNoteDomEditor";
import {
  cleanRichNoteValue,
  richNoteHasText,
} from "@/src/domain/richNoteValue";
import { useAppColors, useFontScale, useGroupAccent } from "@/src/theme";

export { cleanRichNoteValue, richNoteHasText };

export type RichNoteComposerHandle = {
  setBlock: (block: RichNoteBlock) => void;
  toggleInline: (style: RichNoteInline) => void;
  setTextColor: (color?: string) => void;
  insertLink: (text: string, url: string) => void;
  replaceHashtag: (label: string) => void;
  replaceValue: (value: string) => void;
  getValue: () => string;
  undo: () => void;
  redo: () => void;
};

/**
 * Hosts one DOM-backed rich-text surface on Android, iOS, and web. Keeping the
 * paragraph in one editor preserves native caret, IME, wrapping, and undo
 * behavior across inline formatting boundaries.
 */
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
  const editorRef = useRef<RichNoteDomEditorRef>(null);
  const latestValue = useRef(cleanRichNoteValue(value));

  useImperativeHandle(
    ref,
    () => ({
      setBlock: (block) => editorRef.current?.setBlock(block),
      toggleInline: (style) => editorRef.current?.toggleInline(style),
      setTextColor: (color) => editorRef.current?.setTextColor(color ?? null),
      insertLink: (text, url) => editorRef.current?.insertLink(text, url),
      replaceHashtag: (label) => editorRef.current?.replaceHashtag(label),
      replaceValue: (nextValue) => {
        const cleanValue = cleanRichNoteValue(nextValue);
        latestValue.current = cleanValue;
        editorRef.current?.replaceValue(cleanValue);
      },
      getValue: () => latestValue.current,
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
    }),
    [],
  );

  return (
    <View style={styles.host}>
      <RichNoteDomEditor
        ref={editorRef}
        value={latestValue.current}
        inkColor={colors.ink}
        mutedColor={colors.faint}
        borderColor={colors.border}
        cardColor={colors.card}
        accentColor={accent}
        fontSize={13 * fontScale}
        onChange={async (nextValue) => {
          const cleanValue = cleanRichNoteValue(nextValue);
          latestValue.current = cleanValue;
          onChange(cleanValue);
        }}
        onEditingChange={async (editing) => {
          onEditingChange?.(editing);
        }}
        onHashtagQuery={async (query) => {
          onHashtagQuery?.(query);
        }}
        dom={{
          matchContents: true,
          scrollEnabled: false,
          keyboardDisplayRequiresUserAction: false,
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  host: { minHeight: 260, width: "100%" },
});
