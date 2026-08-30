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
const profilePageSource = read("app/profile.tsx");
const memberProfileSource = read("app/member-profile/[id].tsx");
const memberComparisonSource = read("app/member/[id].tsx");
const metricDetailSource = read("app/metric-detail.tsx");

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
  todaySource,
  /const heroVisualProgress\s*=\s*[\s\S]{0,160}Math\.round\([\s\S]{0,80}\* 100\) === 0[\s\S]{0,40}\? 0/,
  "A Featured value displayed as 0% must normalize to an exactly empty visual state.",
);
assert.match(
  heroSource,
  /heroVisualProgress > 0 \? \([\s\S]{0,100}styles\.heroProgressFill/,
  "The Featured progress bar must not mount a lime fill at 0%.",
);
const completionIndicatorStart = todaySource.indexOf(
  "function CompletionShapeIndicator",
);
const completionIndicatorEnd = todaySource.indexOf(
  "function ClockwiseIconReveal",
  completionIndicatorStart,
);
const completionIndicatorSource = todaySource.slice(
  completionIndicatorStart,
  completionIndicatorEnd,
);
assert.match(
  completionIndicatorSource,
  /normalized > 0 \? \(/,
  "The Featured completion icon must not mount a lime reveal layer at 0%.",
);
const goalDotStart = todaySource.indexOf("function GoalCompletionDot");
const goalDotSource = todaySource.slice(goalDotStart);
assert.match(
  goalDotSource,
  /Math\.round\(rawNormalized \* 100\) === 0 \? 0 : rawNormalized/,
  "Featured tracker squares must remain neutral while their displayed value is 0%.",
);
assert.match(
  goalDotSource,
  /normalized > 0 \? \([\s\S]{0,100}styles\.dotLiquid/,
  "Featured tracker squares must not mount a lime liquid layer at 0%.",
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
assert.match(
  profileSource,
  /title="Tracked goals"/,
  "The profile subsection must use the product's Tracked goals terminology.",
);
assert.match(
  profilePageSource,
  /subtitle="Your photo, body and energy profile, and tracked goals\."/,
  "The profile header must use the same Tracked goals terminology.",
);
assert.match(
  profilePageSource,
  /router\.push\(`\/member-profile\/\$\{me\.id\}` as never\)/,
  "The own-profile preview must continue opening the shared public-profile route.",
);
const publicProfileHeroStart = memberProfileSource.indexOf(
  "<Card style={styles.hero}>",
);
const publicProfileHeroEnd = memberProfileSource.indexOf(
  "</Card>",
  publicProfileHeroStart,
);
assert.ok(
  publicProfileHeroStart >= 0 && publicProfileHeroEnd > publicProfileHeroStart,
  "Public profile identity card not found.",
);
const publicProfileHeroSource = memberProfileSource.slice(
  publicProfileHeroStart,
  publicProfileHeroEnd,
);
assert.match(
  publicProfileHeroSource,
  /Joined group[\s\S]{0,420}Joined HabHub/,
  "Both joined dates must live as compact subtext in the public identity card.",
);
assert.match(
  memberProfileSource,
  /friendlyDate\(member\.joinedGroupAt\.slice\(0, 10\), locale\)/,
  "The public group-join date must use the selected app locale.",
);
assert.match(
  memberProfileSource,
  /friendlyDate\(member\.joinedAppAt\.slice\(0, 10\), locale\)/,
  "The public HabHub-join date must use the selected app locale.",
);
assert.doesNotMatch(
  memberProfileSource,
  /<JoinedCard|function JoinedCard|styles\.joinedCard/,
  "Joined dates must not return as standalone public-profile cards.",
);
assert.match(
  memberProfileSource,
  /hero:\s*\{[^}]*marginBottom:\s*12/,
  "The public identity card must retain visible compact section spacing.",
);
assert.match(
  memberProfileSource,
  /levelCard:\s*\{[^}]*marginBottom:\s*12/,
  "The public level card must retain visible compact section spacing.",
);
assert.match(
  memberProfileSource,
  /comparisonAction:\s*\{[^}]*marginBottom:\s*12/,
  "The public comparison action must not touch the badge showcase below it.",
);
assert.match(
  memberComparisonSource,
  /dateSection:\s*\{[^}]*marginTop:\s*2/,
  "Friend comparison must keep its date controls compact beneath the page title.",
);
assert.match(
  memberComparisonSource,
  /headToHeadTitle:\s*\{[\s\S]{0,140}marginTop:\s*7[\s\S]{0,80}marginBottom:\s*6/,
  "Friend comparison must keep balanced compact spacing around Head-to-head.",
);
assert.match(
  memberComparisonSource,
  /metricCards:\s*\{[^}]*marginTop:\s*8/,
  "Tracker statistics must remain visually related to Head-to-head without touching it.",
);
assert.match(
  memberComparisonSource,
  /selectors:\s*\{[^}]*marginTop:\s*12/,
  "What to show must retain visible space after the tracker cards.",
);
assert.match(
  metricDetailSource,
  /const canOpenWorkout = loggingDestination === "workout"/,
  "Workout-owned and workout-derived details must share the centralized Gym shortcut.",
);
assert.match(
  metricDetailSource,
  /accessibilityLabel="Open workout page"[\s\S]{0,180}router\.navigate\("\/gym" as never\)/,
  "The Workout detail quick-action row must open the Gym page accessibly.",
);

console.log(
  "Profile and Today polish validation passed: public-profile spacing and joined dates, settings typography, custom weight pace, long-press editing, and persisted sticky summary.",
);
