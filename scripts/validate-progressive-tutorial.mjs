import assert from "node:assert/strict";
import fs from "node:fs";

import { tutorialPromptForPath } from "../src/tutorial/firstVisit.ts";
import { FULL_TUTORIAL_GUIDE, TUTORIAL_GUIDES } from "../src/tutorial/guides.ts";
import { dateKey } from "../src/domain/date.ts";
import {
  createTutorialSession,
  moveTutorialSession,
  sessionProgress,
} from "../src/tutorial/session.ts";

const spotlight = fs.readFileSync("src/components/TutorialSpotlight.tsx", "utf8");
const launcher = fs.readFileSync("app/quick-guide.tsx", "utf8");
const storage = fs.readFileSync("src/tutorial/storage.ts", "utf8");
const demo = fs.readFileSync("src/data/tutorialDemo.ts", "utf8");

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
