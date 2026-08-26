import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/components/RichNoteComposer.tsx", "utf8");
const domEditor = fs.readFileSync(
  "src/components/RichNoteDomEditor.tsx",
  "utf8",
);
const valueDomain = fs.readFileSync("src/domain/richNoteValue.ts", "utf8");
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
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.match(
  source,
  /Hosts one DOM-backed rich-text surface on Android, iOS, and web/,
  "The note composer must use one cross-platform editing surface",
);
assert.match(source, /<RichNoteDomEditor/);
assert.doesNotMatch(
  source,
  /TextInput|NativeText|overlayRunInput|runMeasure|flexWrap/,
  "Rich text must not be split across independently wrapping native inputs",
);
assert.match(domEditor, /^'use dom';/);
assert.equal(
  domEditor.match(/<ContentEditable/g)?.length,
  1,
  "The body must have exactly one contenteditable caret and wrapping context",
);
for (const plugin of [
  "LexicalComposer",
  "RichTextPlugin",
  "HistoryPlugin",
  "OnChangePlugin",
  "ListPlugin",
  "CheckListPlugin",
  "LinkPlugin",
]) {
  assert.match(domEditor, new RegExp(plugin));
}
assert.match(domEditor, /useDOMImperativeHandle/);
assert.match(domEditor, /lastRangeSelection/);
assert.match(domEditor, /\$setSelection\(selectionToRestore\)/);
assert.match(domEditor, /SELECTION_CHANGE_COMMAND/);
assert.match(domEditor, /FORMAT_TEXT_COMMAND/);
assert.match(domEditor, /\$patchStyleText/);
assert.match(domEditor, /white-space: pre-wrap/);
assert.match(domEditor, /overflow-wrap: anywhere/);
assert.match(domEditor, /font-size: \$\{Math\.max\(16, fontSize\)\}px/);
assert.doesNotMatch(
  domEditor,
  /TextInput|split\("\\n"\)|setSelectionRange|tailRun/,
  "The editor must leave caret movement, new lines, and wrapping to one browser editing engine",
);
assert.match(
  valueDomain,
  /Markdown is otherwise preserved byte for\s+\* byte/,
  "Value cleanup must not flatten nested or adjacent formatting",
);
assert.ok(packageJson.dependencies["react-native-webview"]);
assert.ok(packageJson.dependencies.lexical);

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
  editor,
  /composer\.current\?\.undo\(\)/,
  "Toolbar undo must use the editor's own history",
);
assert.match(editor, /composer\.current\?\.redo\(\)/);
assert.match(editor, /handleComposerEditingChange/);
assert.match(
  editor,
  /Keep the native toolbar mounted through the press that blurred the DOM/,
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

const valueModule = await import("../src/domain/richNoteValue.ts");
for (const formatted of [
  "***bold italic***",
  "**bold *inside***",
  "[color=#FF0000]***colored and styled***[/color]",
  "First **bold** then *italic* without inserted spaces",
]) {
  assert.equal(
    valueModule.cleanRichNoteValue(formatted),
    formatted,
    "Cleaning must preserve valid combined and adjacent formatting exactly",
  );
  assert.equal(valueModule.richNoteHasText(formatted), true);
}
assert.equal(
  valueModule.cleanRichNoteValue(`**${valueModule.EMPTY_RICH_NOTE_RUN}**`),
  "",
  "Obsolete empty-run sentinels must be removed from stored notes",
);

const drawingModule = await import("../src/domain/journalDrawing.ts");
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
