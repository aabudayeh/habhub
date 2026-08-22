import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function source(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n");
}

function requireTokens(relativePath, tokens) {
  const text = source(relativePath);
  for (const token of tokens) {
    if (!text.includes(token)) {
      failures.push(`${relativePath}: missing sandbox invariant ${JSON.stringify(token)}`);
    }
  }
}

// The route tree must use the real reducer with deterministic demo input, while
// persistence and every account/native provider are shadowed inside it.
requireTokens("src/tutorial/TutorialAppStateBoundary.tsx", [
  "createTutorialDemoState(anchorDate)",
  'persistence="ephemeral"',
  "TutorialSandboxProvider",
  "TutorialCloudSyncBoundary",
  "TutorialHealthSyncBoundary",
  "TutorialIsolatedPreviewBoundary",
]);
requireTokens("src/tutorial/TutorialSandboxContext.tsx", [
  "createContext<TutorialSandboxValue | null>(null)",
  "useTutorialSandboxActive",
]);
requireTokens("src/state/AppProvider.tsx", [
  'persistence?: "durable" | "ephemeral"',
  'const ephemeral = persistence === "ephemeral"',
  "initialState ?? createInitialState()",
  "if (ephemeral) return Promise.resolve()",
  "if (ephemeral) return;",
  "if (!hydrated || ephemeral) return;",
  "ephemeral ? Promise.resolve() : persistLatestState(true)",
]);
requireTokens("src/cloud/CloudSyncProvider.tsx", [
  "export function TutorialCloudSyncBoundary",
  "disabledCloudContext",
]);
requireTokens("src/health/HealthSyncProvider.tsx", [
  "export function TutorialHealthSyncBoundary",
  "disabledHealthContext",
]);

// Root-owned effects are the highest-risk escape hatch because they sit above
// the nested AppProvider. Keep each bridge absent and each notification effect
// explicitly gated whenever a tutorial session exists.
requireTokens("app/_layout.tsx", [
  "<TutorialProvider guides={TUTORIAL_GUIDES}>",
  "const tutorialActive = Boolean(tutorial.activeSession)",
  "{tutorialActive ? null : <ScreenTimeSyncBridge />}",
  "{tutorialActive ? null : <WidgetSnapshotBridge />}",
  "<TutorialRouteBoundary>",
  "anchorDate={tutorial.activeSession.demoAnchorDate}",
  "if (!localNotificationSchedulingEnabled || tutorialActive) return;",
  "tutorialActive ||",
]);

// The only writes above the ephemeral provider are account-scoped tutorial
// control metadata: resumable progress/session keys plus the four settings that
// request a guide or prevent replay. Tracker, group, message, journal, health,
// notification, widget, and cloud data are never part of this allowlist.
requireTokens("src/tutorial/storage.ts", [
  'const PROGRESS_PREFIX = "metric-rally-tutorial-progress-v1:"',
  'const ACTIVE_PREFIX = "metric-rally-active-tutorial-v1:"',
  "accountPart(accountId)",
]);
const tutorialContext = source("src/tutorial/TutorialContext.tsx");
const directSettingsWrites = [
  ...tutorialContext.matchAll(/updateSettings\(\{([\s\S]*?)\}\);/g),
];
const contractedWriteCount = [
  ...tutorialContext.matchAll(/updateSettings\(\s*tutorialCloseSettings\(/g),
].length;
if (directSettingsWrites.length !== 0 || contractedWriteCount !== 1) {
  failures.push(
    `src/tutorial/TutorialContext.tsx: expected exactly one contracted tutorial-metadata settings write, found ${directSettingsWrites.length + contractedWriteCount}`,
  );
} else {
  const allowedKeys = new Set([
    "tutorialComplete",
    "advancedTutorialComplete",
    "tutorialGuideId",
    "tutorialGuideRunId",
  ]);
  const tutorialSession = source("src/tutorial/session.ts");
  const closeContract = tutorialSession.match(
    /export function tutorialCloseSettings\([\s\S]*?\n\}\n\nexport function tutorialGuideTrigger/,
  )?.[0];
  const returnedObject = closeContract?.match(
    /return\s*\{([\s\S]*?)\n\s*\};/,
  )?.[1];
  if (!returnedObject || returnedObject.includes("...")) {
    failures.push(
      "src/tutorial/session.ts: tutorialCloseSettings must return one explicit allowlisted object",
    );
  }
  const writtenKeys = [
    ...(returnedObject ?? "").matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm),
  ].map((match) => match[1]);
  for (const key of writtenKeys) {
    if (!allowedKeys.has(key)) {
      failures.push(`src/tutorial/TutorialContext.tsx: non-allowlisted real setting ${key}`);
    }
  }
  for (const key of allowedKeys) {
    if (!writtenKeys.includes(key)) {
      failures.push(`src/tutorial/TutorialContext.tsx: expected control metadata ${key}`);
    }
  }
}

function tutorialFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory()
      ? tutorialFiles(absolute)
      : /\.tsx?$/.test(entry.name)
        ? [absolute]
        : [];
  });
}
for (const absolute of tutorialFiles(path.join(root, "src", "tutorial"))) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (
    relative !== "src/tutorial/storage.ts" &&
    fs.readFileSync(absolute, "utf8").includes("AsyncStorage")
  ) {
    failures.push(`${relative}: AsyncStorage is outside the tutorial metadata allowlist`);
  }
}

// Known route-mounted direct side effects. Shadow providers alone cannot stop
// these, so the manifest intentionally fails when a guard is removed.
const guardedPaths = new Map([
  ["src/widgets/WidgetSnapshotBridge.tsx", ["useTutorialSandboxActive", "tutorialSandbox ||"]],
  ["src/screenTime/ScreenTimeSyncBridge.tsx", ["useTutorialSandboxActive", "tutorialSandbox ||"]],
  ["src/screenTime/ScreenTimeAccessCard.tsx", ["useTutorialSandboxActive", "if (tutorialSandbox)"]],
  ["src/screenTime/ScreenTimeBreakdownCard.tsx", ["useTutorialSandbox", "tutorial.active", "tutorial.bundle"]],
  ["src/cloud/useGroupChallenges.ts", ["useTutorialSandbox", "tutorial.active", "tutorial.bundle"]],
  ["src/cloud/useFocusedCloudSyncPause.ts", ["useTutorialSandboxActive", "if (tutorialSandbox) return"]],
  ["src/components/ActiveTimerOverlay.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["src/components/InAppChatBanner.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/(tabs)/index.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/(tabs)/gym.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/timer.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/notifications.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/metral-ai.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/food-search.tsx", ["useTutorialSandboxActive", "offlineOnly: tutorialSandbox"]],
  ["app/(tabs)/chat.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/(tabs)/log.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/note-editor.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/profile.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/settings.tsx", ["useTutorialSandboxActive", "if (tutorialSandbox)"]],
  ["app/member/[id].tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/leaderboard-detail.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/day/[date].tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/groups.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/(tabs)/group.tsx", ["useTutorialSandboxActive", "tutorialSandbox"]],
  ["app/(tabs)/insights.tsx", ["useTutorialSandboxActive", "holdProgressCloudSync(tutorialSandbox)"]],
]);
for (const [relativePath, tokens] of guardedPaths) requireTokens(relativePath, tokens);

requireTokens("app/note-editor.tsx", [
  "!tutorialSandbox &&",
  "if (tutorialSandbox) {",
  "leave(exit);",
]);

const insightsSource = source("app/(tabs)/insights.tsx");
const progressPauseCalls = [
  ...insightsSource.matchAll(/setCloudSyncPaused\("progress-edit", true\)/g),
].length;
if (
  progressPauseCalls !== 1 ||
  !/function holdProgressCloudSync\(tutorialSandbox: boolean\) \{\s*if \(tutorialSandbox\) return;\s*setCloudSyncPaused\("progress-edit", true\);\s*\}/.test(
    insightsSource,
  )
) {
  failures.push(
    "app/(tabs)/insights.tsx: every direct global progress-edit pause must pass through the tutorial sandbox guard",
  );
}

// Food search is allowed in practice, but it must terminate in bundled data
// before cache or network work. Camera/barcode lookup remains disabled by the UI.
requireTokens("src/food/openFoodFacts.ts", [
  "offlineOnly?: boolean",
  "if (options.offlineOnly) return rankFoods(OFFLINE, term, options)",
]);
requireTokens("app/food-search.tsx", [
  "tutorialSandbox ? null : await foodByBarcode(code)",
  'if (!tutorialSandbox) setMode("scan")',
]);

// Auth/account mutation routes are intentionally outside the curriculum. If a
// future guide adds one, this validator forces a deliberate sandbox design.
const guideSource = source("src/tutorial/guides.ts");
for (const forbidden of ["sign-out", "delete-account", "update-password", "auth-callback"]) {
  if (guideSource.includes(`route: \"/${forbidden}`)) {
    failures.push(`src/tutorial/guides.ts: account-mutation route /${forbidden} is not sandboxed`);
  }
}

if (failures.length) {
  console.error("Tutorial sandbox validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Tutorial sandbox validation passed (${guardedPaths.size} direct-effect paths).`);
