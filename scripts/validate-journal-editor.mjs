import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/components/RichNoteComposer.tsx", "utf8");
const editor = fs.readFileSync("app/note-editor.tsx", "utf8");
const drawingCanvas = fs.readFileSync(
  "src/components/NoteDrawingCanvas.tsx",
  "utf8",
);
const drawingDomain = fs.readFileSync(
  "src/domain/journalDrawing.ts",
  "utf8",
);
const journal = fs.readFileSync("app/(tabs)/journal.tsx", "utf8");
const types = fs.readFileSync("src/types.ts", "utf8");

assert.match(
  source,
  /setSelectionRange\?\.\(selection\.start, selection\.end\)/,
  "Web note focus must use the textarea selection API when RN's native method is absent",
);
assert.match(
  source,
  /const parts = normalizedText\.split\("\\n"\)/,
  "A typed or pasted newline must be split into durable rich-note lines",
);
assert.match(
  source,
  /updated\.splice\(lineIndex, 1, \.\.\.inserted\)/,
  "A newline must replace the active serialized line instead of submitting the screen",
);
assert.match(source, /\r?\n\s+multiline(?:=\{true\})?\r?\n/);
assert.match(source, /enterKeyHint="enter"/);
assert.match(source, /submitBehavior="newline"/);
assert.doesNotMatch(
  source,
  /onSubmitEditing=/,
  "Journal Enter must never use the single-line submit path",
);
assert.doesNotMatch(
  source,
  /multiline=\{false\}/,
  "Journal body inputs must remain multiline on web and native",
);

assert.match(
  editor,
  /composer\.current\?\.setTextColor\(color\);\s*\}/,
  "Choosing a text color must not collapse the palette",
);
assert.doesNotMatch(
  editor,
  /setTextColor\(color\);\s*setTextColorOpen\(false\)/,
  "Text color selection must keep the palette open",
);
assert.match(
  source,
  /Keep the active native input mounted while key-repeat crosses styled/,
  "Held Backspace must cross formatting boundaries without remounting the input",
);
assert.match(
  source,
  /const currentRawLines = draftRef\.current\.split\("\\n"\)/,
  "Backspace repeats must read the latest committed draft instead of stale render state",
);
assert.match(
  source,
  /<NativeText[\s\S]*styles\.runMeasure[\s\S]*<TextInput[\s\S]*styles\.overlayRunInput/,
  "Mixed formatted runs must use one measured layout with exactly one visible editable layer",
);
assert.match(
  source,
  /<NativeText\s+allowFontScaling=\{false\}[\s\S]*?styles\.runMeasure/,
  "The invisible measurement text must use the same font-scaling policy as AppTextInput",
);
assert.match(
  source,
  /\{`\$\{run\.text\}\$\{EMPTY_RUN\}`\}/,
  "The measurement sentinel must follow the run text so trailing spaces contribute to layout",
);
assert.match(
  source,
  /multiline\s+scrollEnabled=\{false\}/,
  "Each formatted run must wrap in the note instead of independently scrolling",
);
assert.match(
  source,
  /run:\s*\{[\s\S]*?flexShrink:\s*1,[\s\S]*?maxWidth:\s*"100%"/,
  "Formatted runs must shrink within the wrapping row",
);
assert.match(
  source,
  /overlayRunInput:\s*\{[\s\S]*?width:\s*"100%",[\s\S]*?maxWidth:\s*"100%",[\s\S]*?overflow:\s*"hidden"/,
  "The editable overlay must stay inside its measured wrapping run",
);
assert.match(editor, /<NoteDrawingCanvas/);
assert.match(editor, /drawing: normalizeJournalDrawing\(drawing\)/);
assert.match(editor, /journalDrawingFingerprint\(drawing\)/);
assert.match(types, /drawing\?: JournalDrawing/);
assert.match(drawingDomain, /MAX_JOURNAL_DRAWING_POINTS = 6_000/);
assert.match(drawingDomain, /normalizeJournalDrawing/);
assert.match(drawingCanvas, /pointerEvents=\{enabled \? "auto" : "none"\}/);
assert.match(drawingCanvas, /requestAnimationFrame/);
assert.match(drawingCanvas, /strokeLinecap="round"/);
assert.match(drawingCanvas, /export const NoteDrawingPreview/);
assert.match(journal, /drawing: note\.drawing/);
assert.match(journal, /<NoteDrawingPreview drawing=\{item\.drawing\}/);
assert.match(journal, /drawingOnlyPreview/);

const drawingModule = await import(
  "../src/domain/journalDrawing.ts"
);
const first = drawingModule.createJournalDrawingStroke(
  "first",
  "#2877d4",
  4,
  [0.2, 0.3],
);
const extended = drawingModule.appendJournalDrawingPoint(first, [0.7, 1.8]);
const normalized = drawingModule.normalizeJournalDrawing({
  version: 1,
  strokes: [extended, { id: "bad", points: [[NaN, 0]] }],
});
assert.equal(normalized?.strokes.length, 1);
assert.deepEqual(normalized?.strokes[0].points.at(-1), [0.7, 1]);
assert.equal(normalized?.strokes[0].color, "#2877D4");
assert.equal(
  drawingModule.undoJournalDrawing(normalized),
  undefined,
  "Undoing the only stroke must produce an empty, backward-compatible layer",
);

console.log("Journal editor validation passed.");
