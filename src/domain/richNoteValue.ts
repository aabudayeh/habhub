export const EMPTY_RICH_NOTE_RUN = "\u200B";

function normalizedRichNoteLines(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
}

function visibleRichNoteLine(rawLine: string) {
  return rawLine
    .replaceAll(EMPTY_RICH_NOTE_RUN, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?)/, "")
    .replace(/\[color=#[0-9a-f]{6}\]|\[\/color\]/gi, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(?:\*\*|__|~~|\*|_)/g, "")
    .trim();
}

/**
 * Normalizes line endings and removes the obsolete zero-width placeholder used
 * by the previous split-input editor. Markdown is otherwise preserved byte for
 * byte so nested or adjacent formatting is never flattened during typing.
 */
export function cleanRichNoteValue(value: string) {
  return normalizedRichNoteLines(value)
    .map((rawLine) => {
      const withoutPlaceholder = rawLine.replaceAll(EMPTY_RICH_NOTE_RUN, "");
      return visibleRichNoteLine(rawLine) ? withoutPlaceholder : "";
    })
    .join("\n");
}

/** True only when the note contains user-visible text, not formatting markup. */
export function richNoteHasText(value: string) {
  return normalizedRichNoteLines(value).some(
    (rawLine) => visibleRichNoteLine(rawLine).length > 0,
  );
}
