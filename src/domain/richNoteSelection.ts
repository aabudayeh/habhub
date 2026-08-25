export type RichNoteSelection = { start: number; end: number };

/**
 * Infer the collapsed selection produced by a text mutation. React Native can
 * deliver `onSelectionChange` one frame after `onChangeText`; keeping this
 * synchronous fallback prevents a formatting action in that frame from using
 * the caret position from the previous keystroke.
 */
export function selectionAfterRichNoteTextChange(
  previousText: string,
  nextText: string,
  previousSelection: RichNoteSelection,
): RichNoteSelection {
  if (previousText === nextText) {
    const start = Math.max(
      0,
      Math.min(previousSelection.start, nextText.length),
    );
    return {
      start,
      end: Math.max(start, Math.min(previousSelection.end, nextText.length)),
    };
  }

  let prefixLength = 0;
  const sharedLength = Math.min(previousText.length, nextText.length);
  while (
    prefixLength < sharedLength &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    previousText[previousText.length - suffixLength - 1] ===
      nextText[nextText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const caret = nextText.length - suffixLength;
  return { start: caret, end: caret };
}
