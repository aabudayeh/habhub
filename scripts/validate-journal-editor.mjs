import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/components/RichNoteComposer.tsx", "utf8");

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

console.log("Journal editor validation passed.");
