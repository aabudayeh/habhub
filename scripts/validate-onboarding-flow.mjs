import assert from "node:assert/strict";
import fs from "node:fs";

import {
  selectedOnboardingHealthDataTypes,
  shouldWaitForOnboardingAuthority,
  syncOnboardingProfileBestEffort,
} from "../src/domain/onboarding.ts";

assert.deepEqual(
  selectedOnboardingHealthDataTypes(
    [
      { templateId: "steps", healthMapping: { dataType: "steps" } },
      { templateId: "weight", healthMapping: { dataType: "weight" } },
      {
        templateId: "blood_pressure_systolic",
        healthMapping: { dataType: "blood_pressure" },
        submetrics: [{ healthMapping: { dataType: "heart_rate" } }],
      },
      { templateId: "deficit" },
    ],
    ["steps", "blood_pressure_systolic", "deficit"],
  ),
  ["steps", "blood_pressure", "heart_rate", "total_energy"],
  "first-run health consent must include only selected tracker data and hidden formula dependencies",
);

const source = fs.readFileSync("app/onboarding.tsx", "utf8");
const settingsSource = fs.readFileSync("app/settings.tsx", "utf8");
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

assert.match(
  rootSource,
  /\(auth\.status === "signedIn" \|\| auth\.status === "demo"\) &&[\s\S]{0,80}onboardingDone &&[\s\S]{0,80}rootSegment === "onboarding"/,
  "Completed demo/no-cloud onboarding must leave /onboarding before the tutorial sandbox mounts.",
);

assert.match(source, /useState<0 \| 1 \| 2 \| 3 \| 4>\(0\)/);
assert.match(source, /useState<OnboardingMode \| null>\([\s\S]{0,40}null/);
assert.match(source, /WELCOME TO HABHUB/);
assert.match(source, /title="Guided setup"/);
assert.match(source, /title="Quick setup"/);
assert.match(source, /badge="RECOMMENDED"/);
assert.match(source, /chooseOnboardingMode\("guided"\)/);
assert.match(source, /chooseOnboardingMode\("classic"\)/);
assert.doesNotMatch(
  source,
  /if \(enabling\) \{\s*setLandingPage\("group"\)/,
  "Choosing the friends goal must not silently replace Today as the default landing page.",
);
assert.match(
  source,
  /function chooseOnboardingMode\(mode: OnboardingMode\)[\s\S]{0,120}setStartShortTour\(mode === "guided"\)/,
  "Guided setup must recommend the tutorial while classic setup keeps it optional.",
);
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
assert.match(connectionPage, /\[0, "Today only"\]/);
assert.match(
  connectionPage,
  /Today only always reads the current day[\s\S]{0,120}will not be imported later/,
  "onboarding must disclose that zero history cannot catch up a missed prior day",
);
assert.match(
  connectionPage,
  /if \(days === 0\) setStartHealthGoalsFromHistory\(false\)/,
  "Today-only must not offer to derive goal starts from nonexistent history",
);
assert.match(
  source,
  /if \(healthReady\)[\s\S]{0,100}health\.setHealthHistoryDays\(healthHistoryDays\)/,
  "finishing onboarding must apply a selection changed after native connection",
);
assert.match(settingsSource, /\[0, "Today only"\]/);
assert.match(
  settingsSource,
  /health\.setHealthHistoryDays\(days\)/,
  "native Settings must use the provider's atomic history-preference transition",
);
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
assert.match(source, /setOnboardingMode\(draft\.onboardingMode\)/);
assert.match(source, /setShowGoalsToday\(draft\.showGoalsToday\)/);
assert.match(source, /setShowTodosToday\(draft\.showTodosToday\)/);
assert.match(source, /What should Today show\?/);
assert.match(source, /value=\{showGoalsToday\}/);
assert.match(source, /value=\{showTodosToday\}/);
assert.match(
  source,
  /updateSettings\(\{[\s\S]*?showGoalsToday,[\s\S]*?showTodosToday,[\s\S]*?defaultLandingPage: landingPage/,
  "Today visibility choices must be committed with the rest of onboarding settings.",
);
assert.match(source, /tutorialGuideId: shortTour \? "essential" : undefined/);
assert.match(source, /tutorialComplete: !shortTour/);
assert.match(source, /onboardingVersion: ONBOARDING_FLOW_VERSION/);
assert.match(source, /const name = saveDisplayNameLocally\(\)/);
assert.match(
  source,
  /await syncDisplayNameBestEffort\(name\)/,
  "Auth metadata sync must be bounded and non-fatal after local onboarding persistence.",
);
assert.doesNotMatch(
  source,
  /await auth\.updateDisplayName/,
  "A remote profile request must never directly gate onboarding completion.",
);
assert.match(
  source,
  /isAccountCurrent: \(\) =>[\s\S]{0,100}onboardingMountedRef\.current[\s\S]{0,100}currentAuthUserIdRef\.current === expectedUserId/,
  "A best-effort retry must stop after unmount or an account boundary.",
);
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
assert.match(source, /dataTypes: onboardingHealthDataTypes/);
assert.match(
  fs.readFileSync("src/health/HealthSyncProvider.tsx", "utf8"),
  /options\?\.dataTypes[\s\S]{0,220}new Set\(options\.dataTypes\)[\s\S]{0,4000}dataTypes: options\?\.dataTypes[\s\S]{0,500}dataTypes\.includes\(type\)/,
  "native permissions and the persisted sync scope must use the onboarding selection",
);
assert.match(
  source,
  /configurePersonalMetrics\([\s\S]*?startHealthGoalsFromHistory \? "history" : "today"/,
  "declining imported goal history must start tracked goals today",
);
assert.match(
  source,
  /id === "friends"[\s\S]*?!enabling && landingPage === "group"[\s\S]*?setLandingPage\("index"\)/,
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
assert.match(source, /Review daily goals \(optional\)/);
assert.match(source, /expandedGoals\.includes\("tracker-targets"\)/);
assert.match(source, /goalTargets\[item\.templateId\] \?\? String\(item\.goal\.target\)/);
assert.match(source, /goal: \{ \.\.\.item\.goal, target: targetOverride \}/);
assert.match(storageSource, /goalTargets\?: Record<string, string>/);
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
const profileSyncIndex = source.indexOf("await syncDisplayNameBestEffort(name);");
const routeIndex = source.indexOf("setCompletionRoute(route);");
assert.ok(
  firstFlushIndex >= 0 &&
    firstFlushIndex < markerIndex &&
    markerIndex < completionIndex &&
    completionIndex < secondFlushIndex &&
    secondFlushIndex < clearDraftIndex &&
    clearDraftIndex < profileSyncIndex &&
    profileSyncIndex < routeIndex &&
    routeIndex >= 0,
  "Configured data, completion marker, and cleared draft must be durable before navigation",
);

assert.match(storageSource, /ONBOARDING_FLOW_VERSION = 4/);
assert.match(storageSource, /DRAFT_PREFIX = "metric-rally-onboarding-draft-v3:"/);
assert.match(storageSource, /export type OnboardingMode = "guided" \| "classic"/);
assert.match(storageSource, /onboardingMode: OnboardingMode/);
assert.match(storageSource, /showGoalsToday: boolean/);
assert.match(storageSource, /showTodosToday: boolean/);
assert.match(storageSource, /step: 0 \| 1 \| 2 \| 3 \| 4/);
assert.match(storageSource, /draft\.version === ONBOARDING_FLOW_VERSION/);
assert.match(
  storageSource,
  /draft\.version === 3[\s\S]*?onboardingMode: draft\.onboardingMode \?\? "classic"[\s\S]*?showGoalsToday: draft\.showGoalsToday \?\? true[\s\S]*?showTodosToday: draft\.showTodosToday \?\? true/,
  "Existing version-3 drafts must migrate into the classic path without losing setup progress.",
);
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

let retryAttempts = 0;
const retryResult = await syncOnboardingProfileBestEffort({
  sync: async () => {
    retryAttempts += 1;
    if (retryAttempts === 1) throw new Error("temporary network failure");
  },
  isAccountCurrent: () => true,
  attemptTimeoutMs: 100,
  retryDelayMs: 0,
});
assert.deepEqual(retryResult, { status: "synced", attempts: 2 });

let failedAttempts = 0;
const failedResult = await syncOnboardingProfileBestEffort({
  sync: async () => {
    failedAttempts += 1;
    throw new Error("offline");
  },
  isAccountCurrent: () => true,
  attemptTimeoutMs: 100,
  retryDelayMs: 0,
});
assert.equal(failedResult.status, "deferred");
assert.equal(failedResult.reason, "failed");
assert.equal(failedResult.attempts, 2);
assert.equal(failedAttempts, 2);

let accountCurrent = true;
const accountChangedResult = await syncOnboardingProfileBestEffort({
  sync: async () => {
    accountCurrent = false;
    throw new Error("session changed");
  },
  isAccountCurrent: () => accountCurrent,
  attemptTimeoutMs: 100,
  retryDelayMs: 0,
});
assert.equal(accountChangedResult.status, "deferred");
assert.equal(accountChangedResult.reason, "account_changed");
assert.equal(accountChangedResult.attempts, 1);

let timeoutAttempts = 0;
const timeoutResult = await syncOnboardingProfileBestEffort({
  sync: () => {
    timeoutAttempts += 1;
    return new Promise(() => undefined);
  },
  isAccountCurrent: () => true,
  attemptTimeoutMs: 5,
  retryDelayMs: 0,
});
assert.equal(timeoutResult.status, "deferred");
assert.equal(timeoutResult.reason, "timed_out");
assert.equal(timeoutResult.attempts, 1);
assert.equal(timeoutAttempts, 1, "A timed-out in-flight update must not be duplicated.");

assert.match(basicGuideSource, /export const BASIC_TUTORIAL_GUIDE/);
const basicSteps = basicGuideSource.slice(
  basicGuideSource.indexOf("steps: ["),
  basicGuideSource.indexOf("export const DEFAULT_TUTORIAL_GUIDES"),
);
assert.ok(
  [...basicSteps.matchAll(/\n      id: /g)].length === 10,
  "Onboarding must keep the essential guide to ten focused steps",
);
for (const target of [
  "today-hero",
  "today-tracker-list",
  "today-steps-tracker",
  "metric-detail-summary",
  "metric-detail-week",
  "metric-detail-chart",
  "menu-button",
  "menu-display",
  "display-layout",
])
  assert.match(basicSteps, new RegExp(`target: "${target}"`));
assert.match(basicSteps, /actionId: "tutorial\.today\.open-tracker"/);
assert.match(basicSteps, /actionId: "tutorial\.metric-detail\.open-week"/);
assert.match(basicSteps, /\/metric-detail\?metric=steps&period=week/);
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
  "Guided/classic durable onboarding and the ten-step non-mutating basic guide validated.",
);
