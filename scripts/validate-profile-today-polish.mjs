import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const typesSource = read("src/types.ts");
const seedSource = read("src/data/seed.ts");
const todaySource = read("app/(tabs)/index.tsx");
const profileSource = read("src/components/ProfileEditors.tsx");

assert.match(
  typesSource,
  /pinTodayHeaderAndFeaturedCard\?: boolean/,
  "The Today summary pin must remain an account-persisted UserSettings field.",
);
assert.match(
  seedSource,
  /pinTodayHeaderAndFeaturedCard:\s*false/,
  "The Today summary pin must default off.",
);
assert.match(
  todaySource,
  /stickyTodaySummary\s*=\s*[\s\S]{0,100}todaySummaryPinned\s*&&\s*!tutorial\.activeSession/,
  "Tutorial sessions must temporarily disable the sticky Today summary.",
);
assert.match(
  todaySource,
  /stickyHeaderIndices=\{stickyTodaySummary \? \[0\] : undefined\}/,
  "The header and featured card shell must be the ScrollView sticky child.",
);

const heroStart = todaySource.indexOf('testID="today-featured-card"');
const heroEnd = todaySource.indexOf("</AnimatedPressable>", heroStart);
assert.ok(heroStart >= 0 && heroEnd > heroStart, "Featured card source not found.");
const heroSource = todaySource.slice(heroStart, heroEnd);
assert.match(
  heroSource,
  /onLongPress=\{\(\) => \{[\s\S]{0,140}beginEditing\(\)/,
  "Long-pressing the featured card must enter the existing Today edit mode.",
);
assert.match(
  heroSource,
  /accessibilityActions=\{\[[\s\S]{0,100}name:\s*"longpress"/,
  "Assistive technology must expose the featured-card long-press action.",
);
assert.match(
  heroSource,
  /heroLongPressRef\.current[\s\S]{0,180}return/,
  "A completed long press must not also navigate to Status on release.",
);

const editMenuStart = todaySource.indexOf('<TutorialTarget id="today-edit-menu">');
const editMenuEnd = todaySource.indexOf("</ScrollView>", editMenuStart);
assert.ok(editMenuStart >= 0 && editMenuEnd > editMenuStart, "Today edit menu not found.");
const editMenuSource = todaySource.slice(editMenuStart, editMenuEnd);
assert.match(
  editMenuSource,
  /pinTodayHeaderAndFeaturedCard:\s*!todaySummaryPinned/,
  "Today edit mode must include the compact persisted pin toggle.",
);
assert.match(
  editMenuSource,
  /accessibilityState=\{\{ selected: todaySummaryPinned \}\}/,
  "The pin control must expose its selected state.",
);
assert.match(
  todaySource,
  /hero:\s*\{[^}]*minHeight:\s*135/,
  "The existing featured-card height contract must remain unchanged.",
);

assert.match(
  profileSource,
  /sectionTitle:\s*\{[\s\S]{0,90}fontSize:\s*11[\s\S]{0,90}fontWeight:\s*"900"/,
  "Profile subsection titles must match the compact settings typography.",
);
assert.match(
  profileSource,
  /sectionHeader:\s*\{[\s\S]{0,180}borderWidth:\s*1[\s\S]{0,120}borderRadius:\s*16/,
  "Profile subsection headers must retain the standard settings-card treatment.",
);
assert.match(
  profileSource,
  /PLANNED_WEIGHT_RATE_PRESETS\s*=\s*\[0\.25, 0\.5, 0\.75, 1\]/,
  "Planned weight-rate presets must remain explicit and auditable.",
);
assert.match(
  profileSource,
  /label="Custom"[\s\S]{0,100}selected=\{customRateSelected\}/,
  "Custom planned pace must be an explicit choice rather than a duplicate always-visible field.",
);
const customInputStart = profileSource.indexOf('accessibilityLabel="Custom rate"');
const customInputEnd = profileSource.indexOf("/>", customInputStart);
const customInputSource = profileSource.slice(
  customInputStart,
  customInputEnd >= 0 ? customInputEnd : customInputStart + 700,
);
assert.match(customInputSource, /minimum=\{0\.05\}/);
assert.match(customInputSource, /maximum=\{2\}/);
assert.doesNotMatch(
  customInputSource,
  /commitOnChange/,
  "The custom rate should commit a finished draft, not persist every partial keystroke.",
);
assert.match(
  profileSource,
  /input:\s*\{[\s\S]{0,80}flex:\s*1,[\s\S]{0,50}minWidth:\s*0/,
  "Paired body-profile inputs must shrink inside narrow two-column layouts.",
);
assert.match(
  profileSource,
  /rateInput:\s*\{[\s\S]{0,80}flex:\s*1,[\s\S]{0,50}minWidth:\s*0/,
  "The custom-rate input must stay inside its compact editor on web.",
);

console.log(
  "Profile and Today polish validation passed: settings typography, custom weight pace, long-press editing, and persisted sticky summary.",
);
