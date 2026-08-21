import assert from "node:assert/strict";
import fs from "node:fs";

import { shouldWaitForOnboardingAuthority } from "../src/domain/onboarding.ts";

const source = fs.readFileSync("app/onboarding.tsx", "utf8");
const rootSource = fs.readFileSync("app/_layout.tsx", "utf8");
const guideSource = fs.readFileSync("src/components/TutorialSpotlight.tsx", "utf8");
const basicGuideSource = fs.readFileSync("src/tutorial/basicGuide.ts", "utf8");
const tutorialContextSource = fs.readFileSync(
  "src/tutorial/TutorialContext.tsx",
  "utf8",
);
const quickGuideSource = fs.readFileSync("app/quick-guide.tsx", "utf8");
const storageSource = fs.readFileSync("src/storage/onboardingState.ts", "utf8");
const providerSource = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const cloudSource = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
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
assert.match(connectionPage, /Open HabHub on/);
assert.match(connectionPage, /Start in dark mode/);
assert.match(
  connectionPage,
  /label="Status"[\s\S]{0,180}landingPage === "status"[\s\S]{0,180}setLandingPage\("status"\)/,
  "Status must be available as an onboarding landing page.",
);
assert.match(
  source,
  /const OPTIONAL_ONBOARDING_TRACKER_IDS = \["screen_time"\]/,
  "Screen Time must be available in Mind without becoming a selected default",
);
assert.match(
  source,
  /const \[pushReady, setPushReady\] = useState\(false\)/,
  "a saved notification preference must not render as a connected device",
);
assert.match(source, /notificationSetupComplete\(auth\.user\?\.id\)/);
assert.match(
  source,
  /setHealthReady\(state\.settings\.healthSync\.enabled\)[\s\S]{0,80}\[state\.settings\.healthSync\.enabled\]/,
  "onboarding Health readiness must follow the provider's native permission reconciliation",
);
const pushSource = fs.readFileSync("src/notifications/push.ts", "utf8");
assert.match(pushSource, /signatureMatchesCurrentDevice/);
assert.match(pushSource, /signature\.userId === userId/);
assert.match(pushSource, /signature\.projectId === projectId/);
assert.match(pushSource, /signature\.token === token/);
assert.match(pushSource, /signature\.platform === Platform\.OS/);
assert.match(pushSource, /PUSH_REGISTRATION_TTL_MS/);
assert.match(pushSource, /from\('device_push_tokens'\)/);
assert.match(pushSource, /\.eq\('user_id', userId\)/);
assert.match(pushSource, /\.eq\('token', token\)/);
assert.match(pushSource, /\.eq\('platform', Platform\.OS\)/);
assert.match(pushSource, /return !error && Boolean\(data\)/);
assert.doesNotMatch(source, /notificationPermissionGranted\(/);
assert.match(
  source,
  /await enablePushNotifications\([\s\S]{0,500}?updateSettings\(\{[\s\S]{0,100}?notifications: preferences,[\s\S]{0,100}?setPushReady\(true\)/,
  "onboarding can mark notifications connected only after awaited token registration",
);
assert.doesNotMatch(finalPage, /Open HabHub on/);
assert.doesNotMatch(finalPage, /Start in dark mode/);
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
assert.match(
  source,
  /function compactOnboardingName[\s\S]*?normalized === generatedAlias[\s\S]*?firstDisplayName\(normalized\)[\s\S]*?setDisplayName\([\s\S]*?compactOnboardingName\(draft\.displayName, generatedAccountAlias\)[\s\S]*?const name =[\s\S]*?compactOnboardingName\(displayName, generatedAccountAlias\)/,
  "Onboarding must hydrate and save the compact first name instead of a provider full name",
);
assert.match(
  fs.readFileSync("src/domain/profileName.ts", "utf8"),
  /providerFirstDisplayName[\s\S]*?friendlyAccountAlias\(\{ id: identity\.id \}\)[\s\S]*?firstDisplayName\(normalized\)[\s\S]*?friendlyAccountAlias[\s\S]*?return `\$\{ADJECTIVES[\s\S]*?\$\{[\s\S]*?ANIMALS/,
  "Provider full names use the first name while generated friendly aliases keep both words",
);
assert.match(source, /startTrackedGoalsAtFirstData:[\s\S]*?startHealthGoalsFromHistory/);
assert.match(
  source,
  /configurePersonalMetrics\([\s\S]*?startHealthGoalsFromHistory \? "history" : "today"/,
  "declining imported goal history must start tracked goals today",
);
assert.match(
  source,
  /id === "friends"[\s\S]*?if \(enabling\)[\s\S]*?setLandingPage\("group"\)[\s\S]*?landingPage === "group"[\s\S]*?setLandingPage\("index"\)/,
  "Removing Friends must not preserve a hidden Leaderboard landing page",
);

assert.match(
  source,
  /const DEFAULT_STARTER_TRACKER_IDS = \[[\s\S]*?"steps"[\s\S]*?"exercise"[\s\S]*?"food"[\s\S]*?"deficit"[\s\S]*?"weekly_deficit_balance"[\s\S]*?"todo_completion"[\s\S]*?"workout"[\s\S]*?"water"[\s\S]*?"reading"[\s\S]*?"study"[\s\S]*?"work"/,
);
assert.doesNotMatch(source, /A balanced setup is already selected/);
assert.doesNotMatch(source, /Fine-tune a priority/);
assert.doesNotMatch(source, /Workout duration can stay visible without counting toward your day/);
assert.match(
  source,
  /Body weight as a tracker for its long-term trend, while Steps can be a tracked goal/,
  "The tracker explanation must use a concrete long-term tracker versus daily-goal example.",
);
assert.match(
  source,
  /copy=\{t\("Trackers record things you want to see over time\.[\s\S]{0,300}finish each day\."\)\}/,
  "Title copy props must call the keyed translator explicitly so i18n coverage cannot silently miss them.",
);
assert.match(
  onboardingTranslationSource,
  /\["Trackers record things you want to see over time\.[^\n]+"\],/,
  "The tracker explanation needs one English key plus all seven localized values.",
);
assert.match(source, /groupedRecommendations\.map/);
assert.match(source, /trackerGroupLabel\(item\)/);
assert.match(source, /Tap a tracker to learn what it records/);
assert.match(source, /onShowInfo=\{\(\) => showTrackerInfo\(item\)\}/);
assert.doesNotMatch(source, /numberOfLines=\{1\}[\s\S]{0,120}metricName/);
assert.match(source, /width < 360[\s\S]*?\? "100%"/);
assert.doesNotMatch(
  source.match(/gym: \[([^\]]+)\]/)?.[1] ?? "",
  /gym_completed|gym_duration|gym_total_volume/,
  "onboarding gym recommendations must use the canonical workout trackers without workout volume",
);

const summaryCard = source.slice(
  source.indexOf("function MetricSummaryCard"),
  source.indexOf("function Title"),
);
assert.match(summaryCard, /style=\{styles\.trackerActions\}/);
assert.match(summaryCard, /event\.stopPropagation\(\)/);
assert.ok(
  summaryCard.indexOf("styles.miniFlag") <
    summaryCard.indexOf("styles.metricCheck"),
  "the tracked-goal flag must sit left of the standard selection checkmark",
);
assert.match(summaryCard, /accessibilityRole="button"/);
assert.match(summaryCard, /accessibilityHint=\{t\(item\.description\)\}/);
assert.match(summaryCard, /accessibilityState=\{\{ checked: tracked \}\}/);

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
assert.match(rootSource, /<TutorialProvider guides=\{TUTORIAL_GUIDES\}>/);
assert.match(rootSource, /<TutorialSpotlight \/>/);

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

assert.match(basicGuideSource, /export const BASIC_TUTORIAL_GUIDE/);
const basicSteps = basicGuideSource.slice(
  basicGuideSource.indexOf("steps: ["),
  basicGuideSource.indexOf("export const DEFAULT_TUTORIAL_GUIDES"),
);
assert.ok(
  [...basicSteps.matchAll(/\n      target: /g)].length >= 9,
  "Onboarding must retain a basic walkthrough across the essential app pages",
);
for (const target of [
  "today-hero",
  "log-header",
  "progress-modes",
  "leaderboard-cards",
  "workout-modes",
  "chat-header",
  "menu-profile",
  "display-layout",
])
  assert.match(basicSteps, new RegExp(`target: "${target}"`));
assert.match(tutorialContextSource, /tutorialComplete:/);
assert.match(
  tutorialContextSource,
  /updateSettings\(\s*tutorialCloseSettings\(session\.guideId, completed/,
);
assert.match(guideSource, /accessibilityViewIsModal/);
assert.match(
  guideSource,
  /accessibilityLabel=\{t\("Skip \{name\}"\)\.replace\("\{name\}", displayGuide\.title\)\}/,
);

assert.match(quickGuideSource, /localizedGuides\.map\(\(guide\) =>/);
assert.match(quickGuideSource, /startGuide\(guide\.id, \{ resume \}\)/);
assert.match(quickGuideSource, /progressByGuide/);

assert.match(providerSource, /onboardingVersion: Math\.max/);
assert.match(cloudSource, /settings\.onboardingVersion = Math\.max/);
for (const setting of ["showCalendar", "showJournal", "showPerformance"])
  assert.match(seedSource, new RegExp(`${setting}: false`));
assert.match(
  source,
  /completeOnboarding\(true, "\/", \{[\s\S]{0,100}keepLeaderboardVisible: true/,
  "Skipping onboarding must retain the default Leaderboard page.",
);
assert.match(
  source,
  /showStatus:[\s\S]{0,100}landingPage === "status"/,
  "Choosing Status as the landing page must also make that page visible.",
);
assert.match(seedSource, /onboardingVersion: 3/);
const tabOrder = seedSource.match(/tabOrder: \[([\s\S]*?)\n      \]/)?.[1] ?? "";
assert.ok(
  tabOrder.indexOf('"status"') > tabOrder.indexOf('"index"') &&
    tabOrder.indexOf('"chat"') > tabOrder.indexOf('"gym"'),
  "New-user navigation must keep Status after Today and Chat at the right edge",
);

console.log(
  "Five-page durable onboarding and the single non-mutating basic guide validated.",
);
