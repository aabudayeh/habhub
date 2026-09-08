import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

import { tutorialPromptForPath } from "../src/tutorial/firstVisit.ts";
import { activeTutorialModalHost, registerTutorialModalHost, subscribeTutorialModalHost } from "../src/tutorial/modalHost.ts";
import { FULL_TUTORIAL_GUIDE, TUTORIAL_GUIDES } from "../src/tutorial/guides.ts";
import { dateKey } from "../src/domain/date.ts";
import { activeLiveSetupStep, nextLiveSetupStep, skipAllTutorialsSettings, tutorialPageAlreadyLearned, tutorialReadingTimeMs, tutorialWatchTiming } from "../src/domain/tutorialUsability.ts";
import {
  createTutorialSession,
  moveTutorialSession,
  sessionProgress,
  tutorialGuideTrigger,
} from "../src/tutorial/session.ts";

const spotlight = fs.readFileSync("src/components/TutorialSpotlight.tsx", "utf8").replaceAll("\r\n", "\n");
const launcher = fs.readFileSync("app/quick-guide.tsx", "utf8");
const storage = fs.readFileSync("src/tutorial/storage.ts", "utf8");
const demo = fs.readFileSync("src/data/tutorialDemo.ts", "utf8");
const tutorialModal = fs.readFileSync("src/components/TutorialModal.tsx", "utf8");
assert.equal(activeLiveSetupStep({ onboardingComplete: true, guidedSetupStep: "trackers" }), "trackers");
assert.equal(activeLiveSetupStep({ onboardingComplete: false, guidedSetupStep: "trackers" }), undefined);
assert.equal(activeLiveSetupStep({ onboardingComplete: true, guidedSetupStep: "complete" }), undefined);
assert.equal(activeLiveSetupStep({ onboardingComplete: true, guidedSetupStep: "layout", tutorialPromptsDisabled: true }), undefined);
assert.deepEqual(["trackers", "layout", "first-log", "explore", "complete"].map(nextLiveSetupStep), ["layout", "first-log", "explore", "complete", "complete"]);
const skippedSettings = skipAllTutorialsSettings();
assert.equal(skippedSettings.guidedSetupStep, "complete");
assert.equal(tutorialGuideTrigger({ tutorialComplete: false, tutorialGuideId: "essential", tutorialPromptsDisabled: true }), undefined);
assert.equal(tutorialGuideTrigger({ tutorialComplete: false }), "essential", "Classic opt-in tutorials remain supported");
const liveCoach = fs.readFileSync("src/components/LiveSetupCoach.tsx", "utf8");
assert.doesNotMatch(liveCoach, /\b(logMetric|deleteMetric|configurePersonalMetrics|startGuide)\s*\(/,
  "Live setup must not fabricate entries, delete history or start isolated preview automatically");
assert.match(liveCoach, /if \(!step \|\| sandbox \|\| tutorial\?\.activeSession\) return null/);
assert.match(liveCoach, /router.push\("\/metric-editor\?id=new" as never\)/,
  "Guided setup must use the real ready-made/custom tracker picker");
assert.match(liveCoach, /label="Edit Today"[\s\S]{0,80}onPress=\{onEditToday\}/,
  "Guided layout teaches the actual Today edit controls");
assert.doesNotMatch(liveCoach, /\b(addMetric|addMetrics|updateMetric)\s*\(|<Switch|live-setup-tracker-/,
  "The coach must not replicate the tracker picker or display settings");
assert.match(liveCoach, /live-setup-skip-all[\s\S]{0,200}finishGuidedSetup\(true\)/,
  "Skipping all tutorials applies empty-guide defaults through the same atomic finish action");
assert.match(launcher, /onPress=\{\(\) => launch\(guide, false, "practice"\)\}/,
  "Manual guide replay remains available after global automatic prompts are disabled");
assert.match(launcher, /guidedSetupStep: activeLiveSetupStep\(state.settings\) \?\? "trackers"/,
  "Existing accounts can resume real setup without rerunning the welcome/configuration replacement");
assert.match(launcher, /if \(!state\.settings\.onboardingComplete\) \{\s*router\.replace\("\/onboarding" as never\);\s*return;\s*\}\s*updateSettings/,
  "An unonboarded demo must enter welcome before live setup instead of silently setting a hidden coach stage");
assert.match(launcher, /Turn on tutorials and set up Today/,
  "Re-enabling automatic prompts requires an explicitly labelled user action");
assert.match(fs.readFileSync("app/(tabs)/log.tsx", "utf8"), /LiveSetupLogHint onContinue=.*requestDraftExitRef.current/,
  "Continuing live setup must respect Log's unsaved-input prompt");
let hostNotifications = 0;
const stopHostListener = subscribeTutorialModalHost(() => hostNotifications++);
assert.equal(activeTutorialModalHost(), undefined);
const closeEditorHost = registerTutorialModalHost("editor");
assert.equal(activeTutorialModalHost(), "editor");
const closePickerHost = registerTutorialModalHost("nested-picker");
assert.equal(activeTutorialModalHost(), "nested-picker");
closePickerHost();
assert.equal(activeTutorialModalHost(), "editor", "Closing a nested picker restores the editor's controls");
closeEditorHost();
assert.equal(activeTutorialModalHost(), undefined, "Closing the editor restores the root spotlight");
assert.equal(hostNotifications, 4);
stopHostListener();
assert.match(tutorialModal, /tutorial\?\.activeSession && tutorial.isolatedPreviewActive/,
  "Live-user modals must not register tutorial hosts");
assert.match(tutorialModal, /<TutorialSpotlight modalHostId=\{id\}/,
  "Modal tutorials must render in the same native window as the editor");
assert.match(spotlight, /if \(activeModalHost !== modalHostId\) return null/,
  "Only one modal/root host may own the active interactive controls");
for (const modalFile of [
  "app/(tabs)/calendar.tsx",
  "app/group-schedule.tsx",
  "src/components/StatusAvatarSimulator.tsx",
  "src/components/GroupChallengeEditor.tsx",
]) {
  assert.match(fs.readFileSync(modalFile, "utf8"), /import \{ TutorialModal as Modal \} from/,
    `The demonstrated modal must retain usable tutorial controls: ${modalFile}`);
}

const metricGuide = TUTORIAL_GUIDES.find((guide) => guide.id === "module:metric-detail");
const metricSession = createTutorialSession(metricGuide, { mode: "practice" });
const firstLessonDone = moveTutorialSession(metricGuide, metricSession, 1);
const basicsProgress = { essential: sessionProgress(firstLessonDone, false) };
assert.equal(tutorialPageAlreadyLearned(metricGuide, undefined, {}), false);
assert.equal(tutorialPageAlreadyLearned(metricGuide, undefined, basicsProgress), true,
  "A first lesson learned through another guide should not prompt again");
assert.equal(tutorialPageAlreadyLearned(metricGuide, "not-yet-learned", basicsProgress), false,
  "Learning a different lesson must not suppress an unseen page tour");
assert.equal(tutorialReadingTimeMs("A short lesson"), 4500);
assert.ok(tutorialReadingTimeMs("word ".repeat(40)) > tutorialReadingTimeMs("word ".repeat(15)),
  "Longer lessons need more reading time, including in reduced-motion mode");
assert.ok(tutorialReadingTimeMs("word ".repeat(400)) <= 18000,
  "Watch playback must retain a bounded per-step duration");
assert.deepEqual(tutorialWatchTiming(5000, false, false), {actionAtMs:undefined,advanceAtMs:5000},
  "A passive lesson must not schedule a pretend activation");
assert.deepEqual(tutorialWatchTiming(5000, true, true), {actionAtMs:5000,advanceAtMs:6600},
  "Navigation happens after reading its explanation");
const demonstrated = tutorialWatchTiming(5000, true, false);
assert.ok(demonstrated.advanceAtMs - demonstrated.actionAtMs >= 3600,
  "A real change needs visible settling time before the next lesson");
const watchEffect = spotlight.slice(spotlight.indexOf("const actionTimer ="), spotlight.indexOf("useEffect(() => {\n    if (!active) return;", spotlight.indexOf("const actionTimer =")));
assert.doesNotMatch(watchEffect, /reportPracticeAction\(/,
  "Watch must not fabricate observed application events");
assert.match(watchEffect, /isolatedPreviewActive/);
assert.match(watchEffect, /!practiceCompleteRef.current/,
  "Moving the spotlight into an opened modal must not repeat the completed mutation");
assert.match(spotlight, /!watchMode && realPracticeAvailable;/,
  "Watch wiring must not replace genuine Practice gestures");
assert.doesNotMatch(spotlight, /reduceMotion \? 2_000/,
  "Reducing motion must not halve the time available to read tutorial copy");
assert.match(spotlight, /if \(screenReaderEnabled\) setWatchPaused\(true\)/,
  "Screen-reader users should control when a Watch lesson advances");

assert.equal(tutorialPromptForPath("/"), undefined, "The essentials own Today's first-run navigation lesson.");
assert.deepEqual(tutorialPromptForPath("/status"), {
  pageId: "status",
  guideId: "module:status",
});
assert.equal(tutorialPromptForPath("/day/2042-03-09")?.guideId, "module:daily-detail");
assert.equal(tutorialPromptForPath("/member/tutorial-mina")?.guideId, "module:comparison");
assert.equal(tutorialPromptForPath("/privacy"), undefined);
const focusedPageRoutes = new Set([
  "/profile", "/group-settings", "/gym-exercise", "/timers",
  "/(tabs)/timers", "/recapfeed", "/(tabs)/recapfeed", "/alerts",
  "/quick-guide", "/note-editor", "/reminder-editor", "/view-filters",
  "/vacation", "/safety", "/legal-support",
]);
const pageRoutes = [
  "/group", "/recap", "/group-schedule", "/group-notes", "/log",
  "/insights", "/gym", "/chat", "/calendar", "/journal",
  "/performance", "/metric-detail", "/todo-editor", "/settings",
  "/notifications", "/display-settings", "/profile", "/group-settings",
  "/gym-exercise", "/timers", "/(tabs)/timers", "/recapfeed",
  "/(tabs)/recapfeed", "/alerts", "/quick-guide", "/note-editor",
  "/reminder-editor", "/view-filters", "/vacation", "/safety",
  "/legal-support",
];
for (const path of pageRoutes) {
  const prompt = tutorialPromptForPath(path);
  assert.ok(prompt, `Missing first-visit guide for ${path}`);
  const guide = TUTORIAL_GUIDES.find((candidate) => candidate.id === prompt.guideId);
  assert.ok(guide, `${path} references a guide that does not exist: ${prompt.guideId}`);
  if (focusedPageRoutes.has(path)) {
    assert.ok(prompt.stepId, `${path} must start at a concise page-specific lesson.`);
    assert.ok(prompt.title, `${path} must use its localized page name in the prompt.`);
  }
  if (!prompt.stepId) continue;
  assert.ok(
    guide.steps.some((step) => step.id === prompt.stepId),
    `${path} references a step outside ${prompt.guideId}: ${prompt.stepId}`,
  );
  let pageSession = createTutorialSession(guide, {
    mode: "watch",
    resume: false,
    stepId: prompt.stepId,
    returnPath: path,
  });
  assert.equal(pageSession.stepId, prompt.stepId, `${path} must open on its page lesson.`);
  assert.equal(pageSession.returnPath, path, `${path} must remain the page-tour return route.`);
  while (pageSession.stepIndex < guide.steps.length - 1)
    pageSession = moveTutorialSession(guide, pageSession, 1);
  assert.equal(
    pageSession.stepIndex,
    guide.steps.length - 1,
    `${path} page guide must traverse to completion.`,
  );
}

const watch = createTutorialSession(FULL_TUTORIAL_GUIDE, {
  now: "2042-03-09T10:00:00.000Z",
  runId: 42,
  demoAnchorDate: "2042-03-09",
  mode: "watch",
});
assert.equal(watch.experienceMode, "watch");
assert.equal(moveTutorialSession(FULL_TUTORIAL_GUIDE, watch, 1).experienceMode, "watch");

assert.equal(FULL_TUTORIAL_GUIDE.version, 4, "Curriculum changes must invalidate stale sessions.");
for (const sectionId of ["group-recap", "group-schedule", "group-notes"])
  assert.ok(
    FULL_TUTORIAL_GUIDE.sections?.some((section) => section.id === sectionId),
    `Complete guide is missing the ${sectionId} page curriculum.`,
  );
const filterIndex = FULL_TUTORIAL_GUIDE.steps.findIndex((step) => step.id === "full.today.filters");
assert.ok(filterIndex >= 0);
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex].interaction?.actionId, "tutorial.today.open-filter-sheet");
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex].interaction?.autoAdvance, true);
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex + 1].id, "full.today.filter-menu");
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex + 1].target, "today-filter-manage");
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex + 1].interaction?.actionId, "tutorial.today.open-filter-manager");
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex + 2].id, "full.today.filter-manager");
assert.equal(FULL_TUTORIAL_GUIDE.steps[filterIndex + 2].path, "/view-filters");

let stepNine = watch;
for (let index = 0; index < 9; index += 1)
  stepNine = moveTutorialSession(FULL_TUTORIAL_GUIDE, stepNine, 1);
assert.equal(stepNine.stepIndex, 9);
const afterStepNine = moveTutorialSession(FULL_TUTORIAL_GUIDE, stepNine, 1);
assert.equal(afterStepNine.stepIndex, 10, "The complete guide must continue beyond step 9.");
assert.equal(afterStepNine.stepId, "full.today.filter-manager");
const restarted = createTutorialSession(FULL_TUTORIAL_GUIDE, {
  progress: {
    ...sessionProgress(stepNine, false),
    demoAnchorDate: "2001-01-01",
  },
  resume: false,
  mode: "practice",
});
assert.equal(restarted.stepIndex, 0, "Start over must reset progress to step one.");
assert.equal(restarted.stepId, FULL_TUTORIAL_GUIDE.steps[0].id);
assert.equal(
  restarted.demoAnchorDate,
  dateKey(),
  "Start over must use a fresh demo date rather than briefly routing through a stale saved anchor.",
);

let traversed = watch;
while (traversed.stepIndex < FULL_TUTORIAL_GUIDE.steps.length - 1)
  traversed = moveTutorialSession(FULL_TUTORIAL_GUIDE, traversed, 1);
assert.equal(traversed.stepIndex, FULL_TUTORIAL_GUIDE.steps.length - 1);
assert.equal(traversed.stepId, FULL_TUTORIAL_GUIDE.steps.at(-1)?.id);

assert.match(launcher, /router\.replace\(destination as never\)/, "Start over must leave Quick Guide immediately.");
assert.match(
  launcher,
  /const session = startGuide\(guide\.id, \{ resume, mode \}\)/,
  "Quick Guide must obtain the freshly created tutorial session before routing.",
);
assert.match(
  launcher,
  /routeForStep\(guide\.steps\[session\.stepIndex\], session\.demoAnchorDate\)/,
  "Start over must derive its destination from the newly stored session anchor.",
);
assert.match(launcher, /mode: TutorialExperienceMode/);
assert.match(launcher, /"Advanced customization"/);
assert.match(launcher, /"module:display", "module:custom-metric"/);
assert.match(launcher, /GUIDE_GROUPS\.map/);
assert.match(spotlight, /readPromptedTutorialPages\(accountId\)/);
assert.match(spotlight, /markTutorialPagePrompted\(accountId, pageId\)/);
assert.match(spotlight, /stepId: pageStepId/);
assert.match(spotlight, /returnPath: pathname/);
assert.match(spotlight, /activeSession\.returnPath \?\? activeGuide\.path/);
assert.match(spotlight, /activeSession\?\.returnPath \?\? activeGuide\?\.path/);
assert.match(spotlight, /activeSession\?\.experienceMode === "watch"/);
assert.match(spotlight, /styles\.watchPointer/);
assert.match(spotlight, /requestTargetActivation\(targetId\)/);
assert.match(spotlight, /Step \{current\} of \{total\}/);
assert.doesNotMatch(spotlight, /\$\{sectionTitle\} \/ /, "The tutorial header must not render stacked slash counters.");
assert.match(storage, /metric-rally-tutorial-first-visits-v1:/);
assert.match(storage, /experienceMode: value\.experienceMode === "watch" \? "watch" : "practice"/);
assert.match(storage, /safeTutorialRoute\(value\.returnPath\)/);

for (const hiddenSetting of ["showCalendar", "showJournal", "showPerformance"])
  assert.match(
    demo,
    new RegExp(`${hiddenSetting}: false`),
    `${hiddenSetting} must stay out of the tutorial tab bar.`,
  );

console.log(
  `Progressive tutorial validated: restart returns to step one, step 9 advances to step 10, all ${FULL_TUTORIAL_GUIDE.steps.length} complete-guide steps traverse, first-visit page prompts route, watch/practice modes persist, and demo navigation stays compact.`,
);

const watchTargetFiles = {
  "today-steps-tracker": "app/(tabs)/index.tsx",
  "metric-detail-week": "app/metric-detail.tsx",
  "menu-button": "app/(tabs)/index.tsx",
  "menu-display": "app/menu.tsx",
  "today-todo-list": "app/(tabs)/index.tsx",
  "today-edit": "app/(tabs)/index.tsx",
  "today-goal-flag": "app/(tabs)/index.tsx",
  "today-reorder": "app/(tabs)/index.tsx",
  "today-filter": "app/(tabs)/index.tsx",
  "today-filter-manage": "app/(tabs)/index.tsx",
  "status-avatar": "app/(tabs)/status.tsx",
  "log-visibility": "app/(tabs)/log.tsx",
  "timer-setup": "app/timer.tsx",
  "leaderboard-create-challenge": "app/(tabs)/group.tsx",
  "group-schedule-create": "app/group-schedule.tsx",
  "workout-templates": "app/(tabs)/gym.tsx",
  "workout-exercises": "app/(tabs)/gym.tsx",
  "note-formatting": "app/note-editor.tsx",
  "fasting-controls": "app/metric-detail.tsx",
  "metric-editor-formula": "app/metric-editor.tsx",
};
const indirectWatchTargets = {
  "schedule-all-slot": ["app/(tabs)/calendar.tsx", "id={tutorialId}", "onOpenSlot(slotEvents)"],
  "schedule-hour-slot": ["app/(tabs)/calendar.tsx", "id={tutorialId}", "onCreate(date)"],
  "progress-grid-cell": ["src/components/MonthCalendar.tsx", "id={tutorialDayTarget!}", "onSelect(day.key)"],
};
function targetHasActivator(file, target) {
  const parsed = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties;
      const id = attributes.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "id");
      if (id?.initializer && ts.isStringLiteral(id.initializer) && id.initializer.text === target)
        found ||= attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "onTutorialActivate");
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}
const allPracticeSteps = new Map(TUTORIAL_GUIDES.flatMap((guide) => guide.steps)
  .filter((step) => step.interaction?.actionId).map((step) => [step.id, step]));
assert.equal(allPracticeSteps.size, 23);
for (const step of allPracticeSteps.values()) {
  const target = step.target;
  if (indirectWatchTargets[target]) {
    const [file, identity, operation] = indirectWatchTargets[target];
    const source = fs.readFileSync(file, "utf8");
    assert.ok(source.includes(identity) && source.includes("onTutorialActivate=") && source.includes(operation), `Missing delegated Watch activation: ${target}`);
  } else {
    const file = watchTargetFiles[target];
    assert.ok(file && targetHasActivator(file, target), `No real Watch activator for ${step.interaction.actionId}: ${target}`);
    const source = fs.readFileSync(file, "utf8");
    assert.ok(/tutorialSandbox|tutorial\.active/.test(source), `${target} needs the isolated preview guard`);
    assert.ok(source.includes(`"${step.interaction.actionId}"`) && source.includes('scope: "isolated-preview"'), `${target} must report a real isolated event`);
  }
}
const noteEditor = fs.readFileSync("app/note-editor.tsx", "utf8");
assert.match(noteEditor, /watchFormatPending\.current && \/\\\*\\\*\[\^\*\]\+\\\*\\\*\//,
  "Journal demonstration must wait for real serialized bold content");
assert.match(noteEditor, /composer\.current\?\.formatAll\("bold"\)/);
const recorder = fs.readFileSync("scripts/capture-interactive-guide-web.mjs", "utf8");
assert.match(recorder, /document.elementFromPoint/,
  "Browser capture must detect tutorial controls hidden behind a real modal");
assert.match(recorder, /observedActions\.has\(previousAction\)/);
assert.match(recorder, /Unperformed Watch demonstrations/);
console.log("All 23 practice controls have explicit Watch activation paths; engine cannot fabricate observed completion and capture requires all 19 full-guide actions.");
