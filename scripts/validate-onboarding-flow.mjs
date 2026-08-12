import assert from "node:assert/strict";
import fs from "node:fs";

import { shouldWaitForOnboardingAuthority } from "../src/domain/onboarding.ts";

const source = fs.readFileSync("app/onboarding.tsx", "utf8");
const rootSource = fs.readFileSync("app/_layout.tsx", "utf8");
const guideSource = fs.readFileSync("src/components/TutorialSpotlight.tsx", "utf8");
const quickGuideSource = fs.readFileSync("app/quick-guide.tsx", "utf8");
const storageSource = fs.readFileSync("src/storage/onboardingState.ts", "utf8");
const providerSource = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const cloudSource = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
const typesSource = fs.readFileSync("src/types.ts", "utf8");
const seedSource = fs.readFileSync("src/data/seed.ts", "utf8");
const onboardingTranslationSource = fs.readFileSync(
  "src/i18n/onboardingBasic.ts",
  "utf8",
);

assert.match(source, /useState<0 \| 1 \| 2 \| 3 \| 4>\(0\)/);
assert.match(source, /\{step \+ 1\}\/5/);
assert.match(source, /ProgressBar progress=\{\(step \+ 1\) \/ 5\}/);
for (const [step, title] of [
  [0, "What matters to you?"],
  [1, "Your starter dashboard"],
  [2, "Optional personal setup"],
  [3, "Connect what helps"],
  [4, "Ready when you are"],
]) {
  assert.match(
    source,
    new RegExp(`step === ${step} \\?[\\s\\S]*?title="${title.replace("?", "\\?")}"`),
    `Onboarding page ${step + 1} must remain present`,
  );
}
assert.match(source, /if \(step === 4\)[\s\S]*?await finish\(\)/);
assert.match(source, /label=\{step === 4 \? "Start using HabHub" : "Continue"\}/);
assert.doesNotMatch(source, /label="Finish with this setup"/);
assert.match(
  source,
  /t\("\{selected\} of \{total\} suggested trackers added"\)[\s\S]{0,700}\.replace\([\s\S]{0,150}"\{selected\}"[\s\S]{0,700}\.replace\("\{total\}"/,
  "the tracker summary must localize and interpolate selected/total independently",
);
assert.match(
  onboardingTranslationSource,
  /"\{selected\} of \{total\} suggested trackers added"/,
  "the compact onboarding catalog must keep distinct selected and total placeholders",
);
assert.doesNotMatch(
  onboardingTranslationSource,
  /"\{value\} of \{value\} suggested trackers added"/,
  "duplicate placeholder names must not collapse selected/total values",
);
assert.match(
  source,
  /page: \{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center"/,
  "onboarding must stay centered and readable on wide web screens",
);

const personalPage = source.slice(
  source.indexOf("{step === 2 ?"),
  source.indexOf("{step === 3 ?"),
);
const connectionPage = source.slice(
  source.indexOf("{step === 3 ?"),
  source.indexOf("{step === 4 ?"),
);
const finalPage = source.slice(source.indexOf("{step === 4 ?"));
assert.doesNotMatch(personalPage, /title="Notifications"|Health history|Health Connect|Apple Health/);
assert.match(connectionPage, /title="Notifications"/);
assert.match(connectionPage, /Apple Health/);
assert.match(connectionPage, /Health Connect/);
assert.match(connectionPage, /Health history/);
assert.match(connectionPage, /healthHistoryDays === days/);
assert.match(connectionPage, /startHealthGoalsFromHistory/);
assert.match(finalPage, /Open HabHub on/);
assert.match(finalPage, /Start in dark mode/);
assert.match(finalPage, /Start the basic guide/);
assert.match(finalPage, /Finish without the guide/);

assert.match(source, /readOnboardingDraft\(accountId\)/);
assert.match(
  source,
  /writeOnboardingDraft\(accountId, draftSnapshot\(next\)\)[\s\S]*?setStep\(next\)/,
);
assert.match(source, /if \(!draftReady\)[\s\S]*?Restoring setup/);
assert.doesNotMatch(
  source,
  /if \(step === 0\) saveDisplayName/,
  "The first Next action must remain local and cannot trigger an auth/profile remount",
);
assert.match(source, /darkMode: state\.settings\.darkMode/);
assert.match(source, /updateSettings\(\{ darkMode: draft\.darkMode \}\)/);
assert.match(source, /tutorialGuideId: shortTour \? "essential" : undefined/);
assert.match(source, /tutorialComplete: !shortTour/);
assert.match(source, /onboardingVersion: ONBOARDING_FLOW_VERSION/);
assert.match(source, /await saveDisplayName\(\)/);
assert.match(source, /startTrackedGoalsAtFirstData:[\s\S]*?startHealthGoalsFromHistory/);
assert.match(
  source,
  /id === "friends"[\s\S]*?if \(enabling\)[\s\S]*?setLandingPage\("group"\)[\s\S]*?landingPage === "group"[\s\S]*?setLandingPage\("index"\)/,
  "Removing Friends must not preserve a hidden Leaderboard landing page",
);

assert.match(
  source,
  /const DEFAULT_STARTER_TRACKER_IDS = \[[\s\S]*?"steps"[\s\S]*?"exercise"[\s\S]*?"food"[\s\S]*?"deficit"[\s\S]*?"weekly_deficit_balance"[\s\S]*?"todo_completion"[\s\S]*?"workout"[\s\S]*?"water"[\s\S]*?"reading"[\s\S]*?"study"[\s\S]*?"work"/,
);
assert.match(source, /A filled flag makes the tracker part of daily completion/);
assert.match(source, /width < 360[\s\S]*?\? "100%"/);

const summaryCard = source.slice(
  source.indexOf("function MetricSummaryCard"),
  source.indexOf("function OnboardingTrackerRow"),
);
const trackerRow = source.slice(
  source.indexOf("function OnboardingTrackerRow"),
  source.indexOf("function Title"),
);
for (const [name, block, selectionIcon] of [
  ["summary card", summaryCard, '<Ionicons name={selected ? "checkmark-circle"'],
  ["expanded tracker row", trackerRow, '<Ionicons name={selected ? "checkbox"'],
]) {
  assert.match(block, /style=\{styles\.trackerActions\}/, `${name} needs one compact action group`);
  assert.match(block, /event\.stopPropagation\(\)/, `${name} flag must not toggle tracker selection`);
  const flagIndex = block.indexOf("styles.goalFlag") >= 0
    ? block.indexOf("styles.goalFlag")
    : block.indexOf("styles.miniFlag");
  const checkIndex = block.indexOf(selectionIcon);
  assert.ok(flagIndex >= 0 && checkIndex > flagIndex, `${name} flag must sit immediately left of the far-right selection mark`);
  assert.match(block, /accessibilityRole="checkbox"/);
  assert.match(block, /accessibilityState=\{\{ checked: tracked \}\}/);
}

const firstFlushIndex = source.indexOf("await flushLocalPersistence();");
const markerIndex = source.indexOf("await markOnboardingCompleted(accountId);");
const completionIndex = source.indexOf("updateSettings({ onboardingComplete: true });");
const secondFlushIndex = source.indexOf("await flushLocalPersistence();", firstFlushIndex + 1);
const clearDraftIndex = source.indexOf("await clearOnboardingDraft(accountId);");
const routeIndex = source.indexOf("setCompletionRoute(route);");
assert.ok(
  firstFlushIndex >= 0 &&
    firstFlushIndex < markerIndex &&
    markerIndex < completionIndex &&
    completionIndex < secondFlushIndex &&
    secondFlushIndex < clearDraftIndex &&
    clearDraftIndex < routeIndex,
  "Configured data, completion marker, and cleared draft must be durable before navigation",
);

assert.match(storageSource, /ONBOARDING_FLOW_VERSION = 3/);
assert.match(storageSource, /DRAFT_PREFIX = "metric-rally-onboarding-draft-v3:"/);
assert.match(storageSource, /step: 0 \| 1 \| 2 \| 3 \| 4/);
assert.match(storageSource, /draft\.version === ONBOARDING_FLOW_VERSION/);
assert.match(storageSource, /completedAt: new Date\(\)\.toISOString\(\)/);

assert.match(rootSource, /const cloudAccountHydrating = shouldWaitForOnboardingAuthority/);
assert.match(rootSource, /<TutorialProvider>[\s\S]*?<TutorialSpotlight \/>[\s\S]*?<\/TutorialProvider>/);
assert.doesNotMatch(rootSource, /TutorialDemoBoundary|AppStatePreviewProvider/);

for (const status of ["disabled", "initializing", "syncing", "offline", "error"])
  assert.equal(
    shouldWaitForOnboardingAuthority({
      authStatus: "signedIn",
      cloudSyncStatus: status,
      onboardingDone: false,
    }),
    true,
    `${status} must not route an account before its authoritative read settles`,
  );
for (const status of ["synced", "conflict"])
  assert.equal(
    shouldWaitForOnboardingAuthority({
      authStatus: "signedIn",
      cloudSyncStatus: status,
      onboardingDone: false,
    }),
    false,
  );
assert.equal(
  shouldWaitForOnboardingAuthority({
    authStatus: "signedIn",
    cloudSyncStatus: "offline",
    onboardingDone: true,
  }),
  false,
);

assert.match(guideSource, /export const BASIC_TUTORIAL_GUIDE/);
assert.match(guideSource, /const BASIC_STEPS: readonly TutorialStep\[\]/);
const basicSteps = guideSource.slice(
  guideSource.indexOf("const BASIC_STEPS"),
  guideSource.indexOf("function landingPath"),
);
assert.equal(
  [...basicSteps.matchAll(/\n    target: /g)].length,
  9,
  "The deferred release must contain only the nine-step basic walkthrough",
);
for (const target of [
  "today-hero",
  "tab-log",
  "log-header",
  "tab-insights",
  "progress-visual",
  "menu-button",
  "menu-display",
  "personal-theme",
  "display-layout",
])
  assert.match(basicSteps, new RegExp(`target: "${target}"`));
assert.match(guideSource, /tutorialComplete: true/);
assert.match(guideSource, /tutorialGuideId: undefined/);
assert.match(guideSource, /tutorialGuideRunId: undefined/);
assert.match(guideSource, /accessibilityViewIsModal/);
assert.match(guideSource, /accessibilityLabel="Skip basic guide"/);

assert.match(quickGuideSource, /BASIC_TUTORIAL_GUIDE/);
assert.match(quickGuideSource, /function startBasicGuide\(\)/);
assert.match(quickGuideSource, /tutorialGuideId: BASIC_TUTORIAL_GUIDE\.id/);
assert.match(quickGuideSource, /tutorialGuideRunId: Date\.now\(\)/);
assert.doesNotMatch(quickGuideSource, /modules|featured|TUTORIAL_GUIDES|completedGuide/i);

const extensiveTutorialTerms = /FULL_GUIDE|TUTORIAL_MODULE|pageGuide\(|createTutorialDemoState|tutorialVersion|tutorialCompletedGuideIds|Demo preview|temporary demo|safe demo/i;
for (const [name, text] of [
  ["onboarding", source],
  ["spotlight", guideSource],
  ["quick guide", quickGuideSource],
  ["root layout", rootSource],
  ["app provider", providerSource],
  ["cloud merge", cloudSource],
  ["settings type", typesSource],
])
  assert.doesNotMatch(text, extensiveTutorialTerms, `${name} must not retain deferred extensive/demo tutorial infrastructure`);
assert.equal(fs.existsSync("src/domain/tutorial.ts"), false);
assert.equal(fs.existsSync("src/i18n/onboardingTutorial.ts"), false);

assert.match(providerSource, /onboardingVersion: Math\.max/);
assert.match(cloudSource, /settings\.onboardingVersion = Math\.max/);
for (const setting of ["showCalendar", "showJournal", "showPerformance"])
  assert.match(seedSource, new RegExp(`${setting}: false`));
assert.match(seedSource, /onboardingVersion: 3/);
const tabOrder = seedSource.match(/tabOrder: \[([\s\S]*?)\n      \]/)?.[1] ?? "";
assert.ok(
  tabOrder.indexOf('"chat"') < tabOrder.indexOf('"gym"'),
  "New-user navigation must keep Chat immediately to the left of Workout",
);

console.log(
  "Five-page durable onboarding and the single non-mutating basic guide validated.",
);
