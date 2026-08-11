import assert from "node:assert/strict";
import fs from "node:fs";
import { shouldWaitForOnboardingAuthority } from "../src/domain/onboarding.ts";

const source = fs.readFileSync("app/onboarding.tsx", "utf8");
const rootSource = fs.readFileSync("app/_layout.tsx", "utf8");
const seedSource = fs.readFileSync("src/data/seed.ts", "utf8");
const providerSource = fs.readFileSync("src/state/AppProvider.tsx", "utf8");

assert.match(source, /\{step \+ 1\}\/4/);
assert.match(source, /ProgressBar progress=\{\(step \+ 1\) \/ 4\}/);
assert.doesNotMatch(source, /step === 4/);
assert.doesNotMatch(
  source,
  /title="Your starting setup"/,
  "Tracker choices must not be stacked in a second global section",
);
assert.match(
  source,
  /goalSections\.map[\s\S]*?chosen && open[\s\S]*?OnboardingTrackerRow/,
  "Each selected goal must reveal its associated trackers in place",
);
assert.match(source, /accessibilityState=\{\{ expanded: open \}\}/);
assert.match(source, /const previousProposedIds = useRef/);
assert.match(source, /const added = previousIds/);
assert.match(source, /const removed = previousIds/);
assert.match(source, /setSelected\(\(current\) =>/);
assert.match(source, /accessibilityRole="checkbox"/);
assert.match(source, /<Text style=\{styles\.targetLabel\}>Target<\/Text>/);
assert.match(
  source,
  /A filled flag counts this tracker toward your daily tracked goals\. The checkbox only adds or removes the tracker\./,
);
assert.match(source, /if \(step === 1\) configure\(\)/);
assert.match(
  source,
  /async function finish\(\)[\s\S]*?configure\(\);[\s\S]*?await completeOnboarding/,
  "Finish must reapply the final tracker and tracked-goal picker state",
);
const flushIndex = source.indexOf("await flushLocalPersistence();");
const markerIndex = source.indexOf("await markOnboardingCompleted(");
const completionSettingIndex = source.indexOf(
  "updateSettings({ onboardingComplete: true });",
);
const routeIndex = source.indexOf("setCompletionRoute(route);");
assert.ok(
  flushIndex >= 0 &&
    flushIndex < markerIndex &&
    markerIndex < completionSettingIndex &&
    completionSettingIndex < routeIndex,
  "The configured snapshot and marker must be durable before completion can navigate",
);
assert.match(source, /\{step === 2 \? \([\s\S]*?title="Connect when you are ready"/);
assert.match(source, /\{step === 3 \? \([\s\S]*?title="You are ready"/);
assert.match(
  source,
  /metrics: \["body_fat", "lean_body_mass", "body_water_mass", "bone_mass"\]/,
);

assert.match(rootSource, /const cloudSyncStatus = useCloudSyncStatus\(\)/);
assert.match(
  rootSource,
  /const cloudAccountHydrating = shouldWaitForOnboardingAuthority\(\{[\s\S]*?authStatus: auth\.status,[\s\S]*?cloudSyncStatus,[\s\S]*?onboardingDone,/,
  "Signed-in routing must wait for the authoritative account snapshot",
);
assert.match(
  rootSource,
  /auth\.status === "loading" \|\| accountStateMismatch \|\| cloudAccountHydrating/,
);

for (const cloudSyncStatus of ["disabled", "initializing", "offline", "error"]) {
  assert.equal(
    shouldWaitForOnboardingAuthority({
      authStatus: "signedIn",
      cloudSyncStatus,
      onboardingDone: false,
    }),
    true,
    `${cloudSyncStatus} must not route an unknown account into onboarding`,
  );
}
for (const cloudSyncStatus of ["syncing", "synced", "conflict"]) {
  assert.equal(
    shouldWaitForOnboardingAuthority({
      authStatus: "signedIn",
      cloudSyncStatus,
      onboardingDone: false,
    }),
    false,
    `${cloudSyncStatus} means the first account read has settled`,
  );
}
assert.equal(
  shouldWaitForOnboardingAuthority({
    authStatus: "signedIn",
    cloudSyncStatus: "offline",
    onboardingDone: true,
  }),
  false,
  "A locally completed account must remain usable offline",
);
assert.equal(
  shouldWaitForOnboardingAuthority({
    authStatus: "demo",
    cloudSyncStatus: "disabled",
    onboardingDone: false,
  }),
  false,
  "Credential-free demo onboarding must not wait for cloud authority",
);

for (const setting of ["showCalendar", "showJournal", "showPerformance"]) {
  assert.match(
    seedSource,
    new RegExp(`${setting}: false`),
    `${setting} must stay opt-in for a new account`,
  );
}
assert.match(
  providerSource,
  /settings: \{\s*\.\.\.defaults\.settings,\s*\.\.\.restored\.settings,/,
  "Saved users must retain explicit page visibility preferences over new defaults",
);

console.log("Goal-led onboarding hydration and durable completion validated.");
