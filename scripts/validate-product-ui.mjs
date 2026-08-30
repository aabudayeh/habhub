import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const tabs = read("app", "(tabs)", "_layout.tsx");
const navigation = read("src", "domain", "navigation.ts");
const seed = read("src", "data", "seed.ts");
const log = read("app", "(tabs)", "log.tsx");
const today = read("app", "(tabs)", "index.tsx");
const ui = read("src", "components", "ui.tsx");
const status = read("app", "(tabs)", "status.tsx");
const metricEditor = read("app", "metric-editor.tsx");
const groupSettings = read("app", "group-settings.tsx");
const leaderboard = read("app", "(tabs)", "group.tsx");

const seededToday = seed.indexOf('"index"');
const seededStatus = seed.indexOf('"status"');
const seededGym = seed.indexOf('"gym"');
const seededChat = seed.indexOf('"chat"');
assert.ok(
  seededToday >= 0 &&
    seededStatus > seededToday &&
    seededChat > seededGym,
  "new-user navigation must place Status after Today and Chat after Workout",
);
assert.match(navigation, /return \["index", "status", \.\.\.middle, "chat"\]/);
assert.match(tabs, /normalizeTabOrder\(state\.settings\.tabOrder\)/);
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

assert.match(
  status,
  /<View style=\{styles\.compactHeaderSpacing\}>[\s\S]{0,180}<PageHeader[\s\S]{0,180}title="Status"/,
  "Status must opt into its compact header-to-content spacing without changing shared safe-area layout",
);
assert.match(
  status,
  /compactHeaderSpacing:\s*\{\s*marginBottom:\s*-[1-9]\d*\s*\}/,
  "Status compact spacing must bring the period controls closer to the title",
);

assert.match(metricEditor, /const promptOpen = useRef\(false\)/);
assert.match(
  metricEditor,
  /useWebBeforeUnload\([\s\S]{0,180}!tutorialSandbox[\s\S]{0,180}dirtyRef\.current[\s\S]{0,180}!allowExit\.current/,
  "Tracker drafts must warn before a browser refresh or tab close",
);
assert.match(
  metricEditor,
  /navigation\.addListener\("beforeRemove"[\s\S]{0,500}event\.preventDefault\(\)[\s\S]{0,500}navigation\.dispatch\(event\.data\.action\)/,
  "Tracker drafts must intercept native and in-app navigation before leaving",
);
for (const label of ["Keep editing", "Discard", "Save"])
  assert.match(
    metricEditor,
    new RegExp(`text: "${label}"`),
    `Unsaved tracker prompt must expose the ${label} action`,
  );
assert.match(
  metricEditor,
  /function markSavedAndLeave[\s\S]{0,220}initialDraftSignature\.current = draftSignature[\s\S]{0,120}dirtyRef\.current = false/,
  "A successful tracker save must mark the current draft clean before leaving",
);

assert.match(
  groupSettings,
  /<SectionHeader title="Visibility" \/>[\s\S]{0,900}accessibilityState=\{\{ expanded: visibilityOpen \}\}/,
  "Group settings must keep each member's tracker visibility compact and collapsible",
);
for (const visibility of ["group", "status", "private"])
  assert.match(
    groupSettings,
    new RegExp(`value: "${visibility}"`),
    `Group settings must expose the ${visibility} tracker privacy choice`,
  );
assert.match(
  groupSettings,
  /updateMetric\(metric\.id, \{[\s\S]{0,120}defaultVisibility: option\.value/,
  "Group settings visibility must reuse the authoritative personal tracker privacy action",
);
assert.match(
  groupSettings,
  /const visibilityMetrics = useMemo\([\s\S]{0,180}groupMetrics[\s\S]{0,180}personalMetricsById\.get\(metric\.id\)/,
  "Group settings visibility must include every configured tracker, including calculated trackers",
);
assert.match(
  groupSettings,
  /if \(!canEdit\) \{[\s\S]*?title="Tracker sharing"[\s\S]*?updateMetric\(metric\.id, \{ defaultVisibility: option\.value \}\)[\s\S]*?<\/Screen>/,
  "ordinary members must receive a dedicated personal tracker-sharing page rather than administrator controls",
);
const memberSettingsBranchAt = groupSettings.indexOf("if (!canEdit) {");
const memberSettingsTitleAt = groupSettings.indexOf('title="Tracker sharing"');
const memberSettingsCloseAt = groupSettings.indexOf("    );\n  }", memberSettingsTitleAt);
const adminSettingsTitleAt = groupSettings.indexOf('title="Group settings"');
assert.ok(
  memberSettingsBranchAt >= 0 &&
    memberSettingsTitleAt > memberSettingsBranchAt &&
    memberSettingsCloseAt > memberSettingsTitleAt &&
    adminSettingsTitleAt > memberSettingsCloseAt,
  "administrator settings must remain outside the ordinary-member render branch",
);
assert.match(
  leaderboard,
  /label=\{canManageGroup \? "Group settings" : "Tracker sharing"\}[\s\S]{0,120}router\.navigate\("\/group-settings"/,
  "every active group member must be able to open their authorized Group Settings surface",
);

console.log("Product navigation and compact UI validation passed.");
