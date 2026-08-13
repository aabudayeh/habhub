import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const tabs = read("app", "(tabs)", "_layout.tsx");
const seed = read("src", "data", "seed.ts");
const log = read("app", "(tabs)", "log.tsx");
const today = read("app", "(tabs)", "index.tsx");
const ui = read("src", "components", "ui.tsx");

for (const [name, source] of [["tab fallback", tabs], ["new-user seed", seed]]) {
  const gym = source.indexOf('"gym"');
  const chat = source.indexOf('"chat"');
  assert.ok(chat >= 0 && gym > chat, `${name} must place Chat before Workout`);
}
assert.match(tabs, /enableFreeze\(true\)/);
assert.match(tabs, /freezeOnBlur: true/);

assert.match(log, /const \[privacyMenuOpen, setPrivacyMenuOpen\]/);
assert.match(log, /accessibilityState=\{\{ expanded: privacyMenuOpen \}\}/);
assert.match(log, /accessibilityRole="radio"/);
assert.doesNotMatch(
  log,
  /<View style=\{styles\.privacyRow\}>/,
  "sharing choices should not consume a permanent row of chips",
);

assert.match(ui, /subtitle,[\s\S]{0,300}translateSubtitle = true/);
assert.match(
  ui,
  /subtitle \? \([\s\S]{0,300}translate=\{translateSubtitle\}[\s\S]{0,300}\{subtitle\}/,
  "PageHeader guidance subtitles must be rendered instead of silently dropped",
);
assert.match(
  log,
  /value=\{label\}[\s\S]{0,350}enterKeyHint="search"[\s\S]{0,220}returnKeyType="search"[\s\S]{0,220}submitBehavior="submit"[\s\S]{0,700}onSubmitEditing=[\s\S]{0,700}pathname: "\/food-search"[\s\S]{0,250}params: \{ q: label \}/,
  "submitting the food-name field must open the same prefilled food search as its button",
);

assert.match(today, /import Svg, \{ Rect \} from "react-native-svg"/);
assert.match(today, /<Rect[\s\S]*?rx=\{radius\}[\s\S]*?strokeDasharray/);
assert.doesNotMatch(
  today,
  /heroOutlineSegment/,
  "the rounded card outline cannot be assembled from square edge segments",
);

console.log("Product navigation and compact UI validation passed.");
