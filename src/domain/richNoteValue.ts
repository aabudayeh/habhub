export const EMPTY_RICH_NOTE_RUN = "\u200B";

/** Shared notes are untrusted content: never launch script or app-intent URLs. */
export function safeRichNoteLink(value: string, addScheme = false) {
  const raw = value.trim();
  if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return undefined;
  const candidate = addScheme && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password
      ? url.href : undefined;
  } catch { return undefined; }
}

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

/** Compact external-share/search excerpt, without editor formatting markers. */
export function richNotePlainText(value: string) {
  return normalizedRichNoteLines(value).map(visibleRichNoteLine).join("\n").trim();
}
