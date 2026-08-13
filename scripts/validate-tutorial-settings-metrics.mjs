import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceCache = new Map();
const read = (file) => {
  if (!sourceCache.has(file)) {
    sourceCache.set(file, fs.readFileSync(path.join(root, file), "utf8"));
  }
  return sourceCache.get(file);
};

const targetSources = new Map([
  ["menu-button", "src/components/ui.tsx"],
  ["menu-profile", "app/menu.tsx"],
  ["menu-display", "app/menu.tsx"],
  ["menu-customize", "app/menu.tsx"],
  ["customize-tabs", "app/customize.tsx"],
  ["customize-add", "app/customize.tsx"],
  ["settings-cloud-account", "app/settings.tsx"],
  ["settings-health", "app/settings.tsx"],
  ["notifications-controls", "app/notifications.tsx"],
  ["battery-optimization", "app/notifications.tsx"],
  ["personal-theme", "app/display-settings.tsx"],
  ["display-layout", "app/display-settings.tsx"],
  ["metric-detail-summary", "app/metric-detail.tsx"],
  ["metric-detail-chart", "app/metric-detail.tsx"],
  ["screen-time-breakdown", "src/screenTime/ScreenTimeBreakdownCard.tsx"],
  ["screen-time-app-list", "src/screenTime/ScreenTimeBreakdownCard.tsx"],
  ["fasting-clock", "src/components/FastingClockEditor.tsx"],
  ["fasting-controls", "app/metric-detail.tsx"],
  ["metric-editor-basics", "app/metric-editor.tsx"],
  ["metric-editor-entry", "app/metric-editor.tsx"],
  ["metric-editor-goal", "app/metric-editor.tsx"],
  ["metric-editor-visuals", "app/metric-editor.tsx"],
  ["metric-editor-submetrics", "app/metric-editor.tsx"],
  ["metric-editor-behavior", "app/metric-editor.tsx"],
  ["metric-editor-formula", "app/metric-editor.tsx"],
  ["metric-editor-save", "app/metric-editor.tsx"],
]);

for (const [target, file] of targetSources) {
  const source = read(file);
  const literal = new RegExp(
    String.raw`<(?:TutorialTarget|OptionalTutorialTarget|PageHeader)[^>]*(?:id|tutorialId)=["']${target}["']`,
    "s",
  );
  assert.match(source, literal, `${target} must be registered on the real control in ${file}`);
}

const detail = read("app/metric-detail.tsx");
assert.match(detail, /enabled=\{isFasting\}\s+id="fasting-controls"/);
assert.match(detail, /if \(fastingProgress\?\.active\) endFast\(tracker\.id\);/);
assert.match(detail, /else startFast\(tracker\.id\);/);
assert.match(
  detail,
  /actionId:\s*"tutorial\.fasting\.toggle",\s*scope:\s*"isolated-preview"/s,
);

const editor = read("app/metric-editor.tsx");
for (const target of [
  "metric-editor-visuals",
  "metric-editor-submetrics",
  "metric-editor-behavior",
  "metric-editor-formula",
]) {
  assert.match(
    editor,
    new RegExp(String.raw`activeTutorialTarget === ["']${target}["']`),
    `${target} must reveal its collapsed advanced section`,
  );
}
assert.match(editor, /function validate\(reportTutorialAction = false\)/);
assert.match(editor, /setValidation\(`Looks good[^`]+`\);[\s\S]*?if \(reportTutorialAction\)/);
assert.match(
  editor,
  /actionId:\s*"tutorial\.metric\.validate-formula",\s*scope:\s*"isolated-preview"/s,
);
assert.match(editor, /label="Check calculation"[\s\S]*?onPress=\{\(\) => validate\(true\)\}/);

const screenTime = read("src/screenTime/ScreenTimeBreakdownCard.tsx");
assert.match(screenTime, /if \(Platform\.OS !== "android" && !tutorial\.active\) return null;/);
assert.match(screenTime, /tutorial\.bundle\.screenTimeReport/);

const display = read("app/display-settings.tsx");
assert.match(
  display,
  /activeStep\?\.target === "display-layout"\) setGeneralOpen\(true\)/,
);

const fastingClock = read("src/components/FastingClockEditor.tsx");
assert.match(
  fastingClock,
  /activeStep\?\.target === "fasting-clock"\) setOpen\(true\)/,
);

const notifications = read("app/notifications.tsx");
assert.match(notifications, /if \(tutorialSandbox\)[\s\S]*?Android settings were not opened/);
assert.match(notifications, /\(tutorialSandbox \|\| Platform\.OS === "android"\)/);

const guides = read("src/tutorial/guides.ts");
for (const actionId of [
  "tutorial.fasting.toggle",
  "tutorial.metric.validate-formula",
]) {
  assert.match(
    guides,
    new RegExp(String.raw`actionId:\s*["']${actionId.replaceAll(".", "\\.")}["']`),
    `${actionId} must remain declared by the curriculum`,
  );
}

console.log(
  `Tutorial settings and metric anchors validated: ${targetSources.size} targets and 2 observed actions.`,
);
