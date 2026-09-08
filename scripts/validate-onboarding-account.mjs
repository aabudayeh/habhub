import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import {
  beginPersonalGuidedSetup, canBeginEmptyGuidedSetup, changedOnboardingProfile, emptyAccountEnergyProfile, emptyPersonalAccountContent,
  finishPersonalGuidedSetup, hasPersonalOnboardingContent,
  shouldUseEmptyGuidedSetupDefaults, withoutUnchangedDemoAccountFixtures,
} from "../src/domain/onboardingAccount.ts";
import { activeLiveSetupStep } from "../src/domain/tutorialUsability.ts";
import { dateKey } from "../src/domain/date.ts";
import { suggestedAccountName } from "../src/domain/profileName.ts";

// Only Metro asset handles are stubbed. The real seed and calculation modules
// are loaded with the repository's validation-only TypeScript resolver.
globalThis.require = (source) => source;
const { createInitialState, DEFAULT_METRICS } = await import("../src/data/seed.ts");
const { createPersonalSetupGroup, DEFAULT_GROUP_THEME } = await import("../src/domain/groupSetup.ts");
const { upgradeStateV21 } = await import("../src/domain/stateMigration.ts");
const cloud = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
const parsedCloud = ts.createSourceFile("CloudSyncProvider.tsx", cloud, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function sourceFunction(name, parsed = parsedCloud) {
  const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing actual cloud boundary: ${name}`);
  return declaration.getText(parsed).replace(/^export\s+/, "");
}
// Execute the exact fresh-account and account-binding functions, without
// mounting React or opening a Supabase connection. Names and group creation
// remain real; the exercised current schema never enters the old BP branch.
const boundaryCode = ts.transpileModule([
  sourceFunction("accountName"), sourceFunction("isCloudGroupId", ts.createSourceFile("groupCloud.ts", fs.readFileSync("src/cloud/groupCloud.ts", "utf8"), ts.ScriptTarget.Latest, true)),
  sourceFunction("isDemoBoundState"), sourceFunction("createCleanAccountState"),
  sourceFunction("bindStateToAccount"),
  "globalThis.boundaries = { createCleanAccountState, bindStateToAccount };",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const context = vm.createContext({
  createInitialState, dateKey, suggestedAccountName, createPersonalSetupGroup,
  DEFAULT_GROUP_THEME, emptyAccountEnergyProfile, emptyPersonalAccountContent, withoutUnchangedDemoAccountFixtures,
  upgradeStateV21,
});
vm.runInContext(boundaryCode, context);
const { createCleanAccountState, bindStateToAccount } = context.boundaries;
const identity = { id: "00000000-0000-4000-8000-000000000091", user_metadata: { display_name: "Jordan" } };
const clone = (value) => JSON.parse(JSON.stringify(value));
const demo = createInitialState();
const clean = clone(createCleanAccountState(identity));
if (process.argv.includes("--emit-clean-fixture")) {
  // Used only by the localhost browser harness. No auth token or transport is
  // fabricated; UI runs offline under explicit-demo auth with this real account
  // boundary snapshot. Normal onboarding gestures perform all later changes.
  console.log(JSON.stringify(clean));
  process.exit(0);
}
let checks = 0;
const check = (name, work) => { work(); checks++; console.log(`PASS ${name}`); };
const personalArrays = ["entries", "photos", "messages", "dailyMetricStatuses", "todos", "journalNotes", "calendarReminders", "gymPlans", "gymSessions", "activityTimers"];

check("real signed-in fresh boundary has no sample personal activity", () => {
  for (const key of personalArrays) assert.deepEqual(clean[key], [], key);
  assert.deepEqual(clean.gymExerciseGoals, {});
  assert.equal(clean.activeTimer, undefined);
  assert.equal(clean.currentUserId, identity.id);
  assert.deepEqual(clean.group.members.map((member) => member.id), [identity.id]);
  assert.equal(clean.group.members[0].name, "Jordan");
  assert.equal(clean.settings.onboardingComplete, false);
  assert.ok(Object.values(clean.trackedGoalPeriods).every((periods) => periods.length === 0));
  assert.ok(demo.todos.length && demo.journalNotes.length && demo.gymPlans.length, "Fixture must actually contain the previously leaked content");
  assert.equal(clean.settings.energyProfile.bodyFatPercent, undefined);
  assert.equal(clean.settings.energyProfile.leanBodyMassKg, undefined);
});
check("actual hydration defaults never inject a demo body into a real account", () => {
  const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
  const ast = ts.createSourceFile("AppProvider.tsx", provider, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "restoredEnergyProfile") expression = node.initializer?.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, "Actual hydration profile initialization must be present");
  const hydrate = (restored, isDefaultDemo) => vm.runInNewContext(`(${expression})`, {
    restored, isDefaultDemo, defaults: demo, emptyAccountEnergyProfile,
    // Normalization is already covered by its domain suite; this capture proves
    // the exact pre-normalization profile never receives sample composition.
    normalizeEnergyProfile: (value) => value,
  });
  const fresh = hydrate(clean, false);
  assert.equal(fresh.bodyFatPercent, undefined); assert.equal(fresh.leanBodyMassKg, undefined);
  assert.equal(fresh.startingWeightKg, undefined);
  const real = { ...clean, settings: { ...clean.settings, energyProfile: { ...clean.settings.energyProfile, bodyFatPercent: 28.7, leanBodyMassKg: 59 } } };
  assert.equal(hydrate(real, false).bodyFatPercent, 28.7); assert.equal(hydrate(real, false).leanBodyMassKg, 59);
  assert.equal(hydrate({ settings: {} }, true).bodyFatPercent, demo.settings.energyProfile.bodyFatPercent);
  assert.equal((provider.match(/\.\.\.defaults.settings.energyProfile/g) ?? []).length, 0, "No unconditional demo profile spread may remain");
  assert.match(provider, /\.\.\.\(isDefaultDemo \? defaults.energyProfiles : \{\}\)/, "Peer demo profiles cannot appear in real account hydration");
});
check("Classic optional setup submits only deliberately changed form values", () => {
  const profile = emptyAccountEnergyProfile();
  assert.deepEqual(changedOnboardingProfile(profile, { ...profile, startingWeightKg: profile.weightKg }), {});
  assert.deepEqual(changedOnboardingProfile(profile, { ...profile, age: 42 }), { age: 42 });
  assert.deepEqual(changedOnboardingProfile(profile, { ...profile, weightKg: 82 }), { weightKg: 82, startingWeightKg: 82 });
  const recorded = { ...profile, startingWeightKg: 91, bodyFatPercent: 28.7, leanBodyMassKg: 59 };
  assert.deepEqual(changedOnboardingProfile(recorded, { ...recorded, weightKg: 82 }), { weightKg: 82 });
  const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
  assert.match(onboarding, /changedOnboardingProfile\(profile, nextProfile\)/);
  assert.match(onboarding, /if \(Object.keys\(profileChanges\).length\) updateEnergyProfile\(profileChanges\)/);
  assert.doesNotMatch(onboarding, /updateEnergyProfile\(nextProfile\)/);
});

check("account switch never imports another account or explicit-demo ledger", () => {
  const switched = clone(bindStateToAccount(demo, identity));
  for (const key of personalArrays) assert.deepEqual(switched[key], [], key);
  assert.deepEqual(switched.gymExerciseGoals, {});
  assert.equal(switched.currentUserId, identity.id);
});

check("empty real guided Today is eligible directly from actual account creation", () => {
  assert.equal(canBeginEmptyGuidedSetup(clean, DEFAULT_METRICS), true);
  const guided = beginPersonalGuidedSetup(clean, DEFAULT_METRICS);
  assert.deepEqual(guided.metrics, []);
  assert.deepEqual(guided.trackedGoalPeriods, {});
  assert.equal(guided.settings.guidedSetupStartedEmpty, true);
  assert.equal(guided.settings.guidedSetupStep, "trackers");
  for (const key of personalArrays) assert.deepEqual(guided[key], [], key);
  assert.notEqual(guided, clean);
  assert.equal(clean.metrics.length, DEFAULT_METRICS.length, "Reducer is immutable");
});
check("an untouched fresh account stays eligible after a cloud binding or refresh", () => {
  const rebound = clone(bindStateToAccount(clean, identity));
  const canonicalDiff = rebound.metrics.flatMap((metric) => {
    const original = DEFAULT_METRICS.find((candidate) => candidate.id === metric.id);
    return Object.keys(metric).filter((key) => key !== "activeFrom" && JSON.stringify(metric[key]) !== JSON.stringify(original?.[key]))
      .map((key) => ({ metric: metric.id, key, before: original?.[key], after: metric[key] }));
  });
  assert.equal(canBeginEmptyGuidedSetup(rebound, DEFAULT_METRICS), true, JSON.stringify(canonicalDiff));
});

const emptyGuide = { ...beginPersonalGuidedSetup(clean, DEFAULT_METRICS), settings: {
  ...beginPersonalGuidedSetup(clean, DEFAULT_METRICS).settings, onboardingComplete: true,
} };
check("empty guided setup survives current cloud schema migration", () => {
  const rebound = clone(bindStateToAccount(emptyGuide, identity));
  assert.deepEqual(rebound.metrics, []);
  assert.deepEqual(rebound.todos, []);
  assert.equal(rebound.settings.guidedSetupStartedEmpty, true);
  assert.equal(activeLiveSetupStep(rebound.settings), "trackers");
});

for (const skipAll of [false, true]) check(`empty-guide finish installs only ordinary defaults; skip-all=${skipAll}`, () => {
  const finished = finishPersonalGuidedSetup(emptyGuide, DEFAULT_METRICS, "2042-03-09", skipAll);
  assert.deepEqual(finished.metrics.map((metric) => metric.id), ["steps", "water", "todo_completion"]);
  assert.deepEqual(finished.trackedGoalPeriods, { steps: [{ from: "2042-03-09" }], water: [{ from: "2042-03-09" }], todo_completion: [] });
  assert.ok(finished.metrics.every((metric) => metric.activeFrom === "2042-03-09" && metric.sections.today && !metric.sections.group));
  for (const key of personalArrays) assert.deepEqual(finished[key], [], key);
  assert.equal(finished.settings.guidedSetupStartedEmpty, false);
  assert.equal(finished.settings.guidedSetupStep, "complete");
  if (skipAll) assert.equal(finished.settings.tutorialPromptsDisabled, true);
  assert.equal(activeLiveSetupStep(finished.settings), undefined);
  assert.deepEqual(finishPersonalGuidedSetup(finished, DEFAULT_METRICS, "2042-03-10", skipAll), finished, "Repeated finish cannot move goal starts or add trackers");
});

for (const [name, patch] of [
  ["prior completion", { settings: { ...clean.settings, onboardingComplete: true } }],
  ["real entry", { entries: [{ id: "real-entry", userId: identity.id, value: 4 }] }],
  ["real photo", { photos: [{ id: "real-photo", userId: identity.id }] }],
  ["real to-do", { todos: [{ id: "my-task", title: "Call a friend" }] }],
  ["real journal", { journalNotes: [{ id: "my-note", body: "My own note" }] }],
  ["real reminder", { calendarReminders: [{ id: "my-reminder" }] }],
  ["real workout plan", { gymPlans: [{ id: "my-plan" }] }],
  ["real workout session", { gymSessions: [{ id: "my-session" }] }],
  ["active timer", { activeTimer: { id: "my-timer" } }],
  ["activity timer", { activityTimers: [{ id: "my-timer" }] }],
  ["exercise goal", { gymExerciseGoals: { back_squat: { target: 20 } } }],
  ["completion status", { dailyMetricStatuses: [{ userId: identity.id, metricId: "steps", localDate: "2042-03-08" }] }],
  ["goal history", { trackedGoalPeriods: { water: [{ from: "2042-03-01" }] } }],
  ["custom tracker", { metrics: [{ ...clean.metrics[0], id: "my-study" }] }],
  ["edited tracker goal", { metrics: [{ ...clean.metrics[0], goal: { kind: "at_least", target: 7654 } }] }],
  ["reordered tracker", { metrics: [{ ...clean.metrics[0], order: 50 }] }],
]) check(`existing ${name} is preserved when live setup starts`, () => {
  const original = { ...clean, ...patch };
  assert.equal(canBeginEmptyGuidedSetup(original, DEFAULT_METRICS), false);
  const begun = beginPersonalGuidedSetup(original, DEFAULT_METRICS);
  assert.equal(begun.metrics, original.metrics);
  assert.equal(begun.settings.guidedSetupStartedEmpty, false);
  for (const key of personalArrays) assert.equal(begun[key], original[key], key);
  assert.equal(begun.trackedGoalPeriods, original.trackedGoalPeriods);
});

check("adding a real tracker before finish prevents default additions", () => {
  const chosen = { ...clean.metrics.find((metric) => metric.id === "reading"), sections: { today: true, insights: true, group: false } };
  const latest = { ...emptyGuide, metrics: [chosen] };
  assert.equal(shouldUseEmptyGuidedSetupDefaults(latest), false);
  const finished = finishPersonalGuidedSetup(latest, DEFAULT_METRICS, "2042-03-09", true);
  assert.deepEqual(finished.metrics, [chosen]);
  assert.deepEqual(finished.entries, []);
});
check("a changed default catalog is preserved even without a first entry", () => {
  for (const mutate of [
    (metrics) => { metrics[0].order = 999; },
    (metrics) => { metrics[0].goal.target += 123; },
    (metrics) => { metrics[0].color = "#112233"; },
    (metrics) => { metrics.pop(); },
  ]) {
    const metrics = clone(clean.metrics); mutate(metrics);
    const state = { ...clean, metrics };
    assert.equal(canBeginEmptyGuidedSetup(state, DEFAULT_METRICS), false);
    assert.equal(beginPersonalGuidedSetup(state, DEFAULT_METRICS).metrics, metrics);
  }
});
check("a concurrent real log or task prevents fallback against the latest reducer state", () => {
  for (const patch of [{ entries: [{ id: "import", userId: identity.id }] }, { todos: [{ id: "my-task" }] }]) {
    const latest = { ...emptyGuide, ...patch };
    assert.equal(hasPersonalOnboardingContent(latest), true);
    assert.equal(shouldUseEmptyGuidedSetupDefaults(latest), false);
    const finished = finishPersonalGuidedSetup(latest, DEFAULT_METRICS, "2042-03-09");
    assert.deepEqual(finished.metrics, []);
    assert.equal(finished.entries, latest.entries);
    assert.equal(finished.todos, latest.todos);
  }
});

const fixtureKeys = ["todos", "journalNotes", "calendarReminders", "gymPlans", "gymSessions"];
const leaked = { ...clean, ...Object.fromEntries(fixtureKeys.map((key) => [key, demo[key]])) };
check("only exact reserved demo records are removed from a real legacy account", () => {
  const repaired = withoutUnchangedDemoAccountFixtures(leaked, demo);
  for (const key of fixtureKeys) assert.deepEqual(repaired[key], [], key);
  assert.equal(repaired.entries, leaked.entries);
  assert.equal(withoutUnchangedDemoAccountFixtures(repaired, demo), repaired, "Repair is idempotent and allocation-free when unchanged");
  const rebound = clone(bindStateToAccount(leaked, identity));
  for (const key of fixtureKeys) assert.deepEqual(rebound[key], [], `Actual bind boundary ${key}`);
});
check("consistently date-shifted legacy fixture rows are recognized", () => {
  const shifted = JSON.parse(JSON.stringify(leaked).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => new Date(Date.parse(date + "T00:00:00Z") - 93 * 86400000).toISOString().slice(0, 10)));
  const repaired = withoutUnchangedDemoAccountFixtures(shifted, demo);
  for (const key of fixtureKeys) assert.deepEqual(repaired[key], [], key);
});
for (const [name, mutate] of [
  ["title", (row) => { row.title = "My edited task"; }],
  ["completion", (row) => { row.completedDates.push("2042-03-09"); }],
  ["reminder time", (row) => { row.reminders[0].time = "09:45"; }],
  ["subtask", (row) => { row.subtasks = [{ id: "mine", title: "Pack a snack" }]; }],
  ["schedule", (row) => { row.scheduledEndAt = "2042-03-09T08:45:00.000Z"; }],
  ["unknown reserved ID", (row) => { row.id = "demo-todo-created-by-user"; }],
  ["ordinary user ID", (row) => { row.id = "user-todo-1"; }],
]) check(`legacy fixture with changed ${name} survives`, () => {
  const row = clone(demo.todos[0]); mutate(row);
  const state = { ...leaked, todos: [row] };
  assert.deepEqual(withoutUnchangedDemoAccountFixtures(state, demo).todos, [row]);
});
check("changed record owner and user-owned scalar goals are not guessed at", () => {
  const note = { ...demo.journalNotes[0], userId: identity.id };
  const state = { ...leaked, journalNotes: [note], gymExerciseGoals: { back_squat: { target: 20 } } };
  const repaired = withoutUnchangedDemoAccountFixtures(state, demo);
  assert.deepEqual(repaired.journalNotes, [note]);
  assert.equal(repaired.gymExerciseGoals, state.gymExerciseGoals);
});
check("real subtasks preserve their unchanged demo parent and hierarchy", () => {
  const parent = demo.todos[0];
  const child = { id: "my-child", title: "Pack water", parentId: parent.id };
  const grandchild = { id: "my-grandchild", title: "Fill bottle", parentId: child.id };
  const state = { ...leaked, todos: [parent, child, grandchild, ...demo.todos.slice(1)] };
  assert.deepEqual(withoutUnchangedDemoAccountFixtures(state, demo).todos, [parent, child, grandchild]);
});
check("an edited duplicate ID and a personally used workout plan survive", () => {
  const edited = { ...demo.todos[0], title: "My task" };
  const session = { ...demo.gymSessions[0], id: "my-session", userId: identity.id };
  const state = { ...leaked, todos: [demo.todos[0], edited], gymSessions: [session, ...demo.gymSessions] };
  const repaired = withoutUnchangedDemoAccountFixtures(state, demo);
  assert.deepEqual(repaired.todos, state.todos);
  assert.deepEqual(repaired.gymSessions, [session]);
  assert.deepEqual(repaired.gymPlans, demo.gymPlans);
});
check("intentional credential-free demo remains populated and untouched", () => {
  assert.equal(withoutUnchangedDemoAccountFixtures(demo, demo), demo);
  assert.equal(canBeginEmptyGuidedSetup(demo, DEFAULT_METRICS), false);
  const begun = beginPersonalGuidedSetup(demo, DEFAULT_METRICS);
  assert.equal(begun.entries, demo.entries);
  assert.equal(begun.todos, demo.todos);
  assert.equal(begun.metrics, demo.metrics);
});

check("real setup uses standard picker and defers Google Health disclosure without dismissing it", () => {
  const coach = fs.readFileSync("src/components/LiveSetupCoach.tsx", "utf8");
  const disclosure = fs.readFileSync("src/components/GoogleHealthTodayDisclosure.tsx", "utf8");
  assert.match(coach, /router.push\("\/metric-editor\?id=new" as never\)/);
  assert.doesNotMatch(coach, /\b(addMetric|updateMetric|logMetric)\s*\(/);
  assert.match(disclosure, /!state\.settings\.onboardingComplete \|\| Boolean\(activeLiveSetupStep\(state\.settings\)\)/);
  assert.match(disclosure, /\[accountId, auth.status, hidden\]/);
  assert.match(disclosure, /const dismiss = \(\) => \{[\s\S]*?localStorage.setItem/);
  for (const step of ["trackers", "layout", "first-log", "explore"]) assert.ok(activeLiveSetupStep({ onboardingComplete: true, guidedSetupStep: step }));
  assert.equal(activeLiveSetupStep({ onboardingComplete: true, guidedSetupStep: "complete" }), undefined);
});
check("every current global skip entry uses the atomic finish contract", () => {
  for (const path of ["app/quick-guide.tsx", "src/components/TutorialSpotlight.tsx", "src/components/LiveSetupCoach.tsx"]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /finishGuidedSetup\(true\)/, path);
    assert.doesNotMatch(source, /updateSettings\(skipAllTutorialsSettings\(\)\)/, path);
  }
  assert.match(fs.readFileSync("app/quick-guide.tsx", "utf8"), /enabled \? updateSettings\(\{ tutorialPromptsDisabled: false \}\) : finishGuidedSetup\(true\)/,
    "Turning prompts on remains a preference-only change");
});
check("actual disclosure component defers signed-in health prompts until setup ends", () => {
  const source = fs.readFileSync("src/components/GoogleHealthTodayDisclosure.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const colors = { card: "white", ink: "black", muted: "gray", border: "gray" };
  let settings;
  let markerWrites = 0;
  const element = (type, props) => ({ type, props });
  const modules = {
    "react": { useEffect: (work) => work(), useState: () => [{ accountId: identity.id, dismissed: false }, () => {}] },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": { Platform: { OS: "web" }, Pressable: "button", View: "view", StyleSheet: { create: (styles) => styles } },
    "@expo/vector-icons": { Ionicons: "icon" }, "expo-router": { router: { push: () => {} } },
    "@/src/auth/AuthProvider": { useAuth: () => ({ status: "signedIn", user: identity }) },
    "@/src/components/AppText": { AppText: "text" },
    "@/src/domain/googleHealthSetup": { googleHealthNormalUseDisclosureKey: (id) => `disclosure:${id}` },
    "@/src/domain/tutorialUsability": { activeLiveSetupStep },
    "@/src/state/AppProvider": { useApp: () => ({ state: { settings } }) },
    "@/src/i18n": { useTranslation: () => (value) => value },
    "@/src/theme": { palette: colors, useAppColors: () => colors, useGroupAccent: () => "#081B49" },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    assert.ok(modules[id], `Unexpected disclosure dependency: ${id}`); return modules[id];
  }, window: { localStorage: { getItem: () => null, setItem: () => markerWrites++ } } });
  const render = module.exports.GoogleHealthTodayDisclosure;
  settings = { onboardingComplete: false };
  assert.equal(render({ hidden: false }), null, "Signed-in welcome cannot show the disclosure");
  for (const step of ["trackers", "layout", "first-log", "explore"]) {
    settings = { onboardingComplete: true, guidedSetupStep: step };
    assert.equal(render({ hidden: false }), null, `Signed-in ${step} must defer disclosure`);
  }
  settings = { onboardingComplete: true, guidedSetupStep: "complete" };
  assert.ok(render({ hidden: false }), "Normal signed-in use shows the undismissed disclosure after setup");
  assert.equal(render({ hidden: true }), null, "Other active modal/tutorial gates remain respected");
  assert.equal(markerWrites, 0, "Deferring does not mark the disclosure dismissed or imply permission");
});

console.log(`Clean-account boundaries, exact-provenance repair, empty live setup, skip defaults and preservation: ${checks} checks passed. No remote account or native permission flow was exercised.`);
