import assert from "node:assert/strict";
import fs from "node:fs";

import {
  calloutLayout,
  isRectVisible,
  relativeTargetRect,
  spotlightRect,
} from "../src/tutorial/geometry.ts";
import {
  createTutorialSession,
  moveTutorialSession,
  reanchorTutorialSession,
  recordTutorialPracticeAction,
  resolvedTutorialRoute,
  routeMatchesStep,
  safeTutorialRoute,
  sessionProgress,
  tutorialCloseSettings,
  tutorialGuideTrigger,
  tutorialRoutePath,
  tutorialSessionBlocksTrigger,
} from "../src/tutorial/session.ts";
import { BASIC_TUTORIAL_GUIDE } from "../src/tutorial/basicGuide.ts";

const contextSource = fs.readFileSync(
  "src/tutorial/TutorialContext.tsx",
  "utf8",
);
const spotlightSource = fs.readFileSync(
  "src/components/TutorialSpotlight.tsx",
  "utf8",
);
const storageSource = fs.readFileSync("src/tutorial/storage.ts", "utf8");
const quickGuideSource = fs.readFileSync("app/quick-guide.tsx", "utf8");
const uiSource = fs.readFileSync("src/components/ui.tsx", "utf8");
const rootLayoutSource = fs.readFileSync("app/_layout.tsx", "utf8");
const guideSource = fs.readFileSync("src/tutorial/guides.ts", "utf8");
const basicGuideSource = fs.readFileSync("src/tutorial/basicGuide.ts", "utf8");
const todaySource = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
const menuSource = fs.readFileSync("app/menu.tsx", "utf8");
const customizeSource = fs.readFileSync("app/customize.tsx", "utf8");

assert.equal(tutorialRoutePath("/metric-detail?id=screen-time"), "/metric-detail");
assert.equal(tutorialRoutePath("/insights/#grid"), "/insights");
assert.equal(safeTutorialRoute("/metric-editor?id=new"), true);
assert.equal(safeTutorialRoute("https://example.com"), false);
assert.equal(safeTutorialRoute("//evil.example"), false);
assert.equal(safeTutorialRoute("javascript:alert(1)"), false);
assert.equal(
  routeMatchesStep("/metric-detail", {
    id: "route",
    sectionId: "test",
    path: "/metric-detail",
    title: "Route",
    copy: "Route",
    navigation: { before: "/metric-detail?id=screen-time" },
  }),
  true,
);
assert.equal(BASIC_TUTORIAL_GUIDE.steps[0].id, "essential.navigation");
assert.equal(BASIC_TUTORIAL_GUIDE.steps[0].target, "tab-index");
for (const actionId of [
  "tutorial.navigation.open-menu",
  "tutorial.navigation.open-customize",
  "tutorial.navigation.close-customize",
  "tutorial.today.open-filter-sheet",
  "tutorial.today.open-filter-manager",
  "tutorial.navigation.open-display",
]) {
  assert.match(basicGuideSource, new RegExp(actionId.replaceAll(".", "\\.")));
  assert.match(
    `${todaySource}\n${menuSource}\n${customizeSource}\n${uiSource}`,
    new RegExp(actionId.replaceAll(".", "\\.")),
    `${actionId} must be reported by a real, isolated control.`,
  );
}
assert.doesNotMatch(
  menuSource,
  /router\.replace\(item\.path/,
  "The transparent menu must close before presenting its destination modal.",
);
assert.match(
  menuSource,
  /InteractionManager\.runAfterInteractions\([\s\S]{0,180}openDestination/,
  "The next menu destination must wait until the outgoing native drawer transition is idle.",
);
assert.match(
  todaySource,
  /showViewFilters \? \([\s\S]{0,220}styles\.viewFilterOverlay/,
  "The Today filter practice surface must remain in-tree so the root tutorial spotlight stays above it.",
);
assert.doesNotMatch(
  todaySource,
  /<Modal[\s\S]{0,120}visible=\{showViewFilters\}/,
  "A native Modal would cover the tutorial callout for the filter-manager practice step.",
);
const anchoredDayStep = {
  id: "anchored-day",
  sectionId: "test",
  path: "/day/:tutorial-date",
  title: "Anchored day",
  copy: "Anchored day",
};
assert.equal(
  resolvedTutorialRoute(anchoredDayStep.path, "2042-03-09"),
  "/day/2042-03-09",
);
assert.equal(
  routeMatchesStep("/day/2042-03-09", anchoredDayStep, "2042-03-09"),
  true,
);
assert.equal(
  routeMatchesStep("/day/2026-08-12", anchoredDayStep, "2042-03-09"),
  false,
);

const started = createTutorialSession(BASIC_TUTORIAL_GUIDE, {
  now: "2026-08-12T10:00:00.000Z",
  runId: 12,
  demoAnchorDate: "2042-03-09",
});
assert.equal(started.stepIndex, 0);
assert.equal(started.stepId, BASIC_TUTORIAL_GUIDE.steps[0].id);
const advanced = moveTutorialSession(
  BASIC_TUTORIAL_GUIDE,
  started,
  1,
  "2026-08-12T10:01:00.000Z",
);
assert.equal(advanced.stepIndex, 1);
assert.deepEqual(advanced.completedStepIds, [BASIC_TUTORIAL_GUIDE.steps[0].id]);
const rehearsed = recordTutorialPracticeAction(
  BASIC_TUTORIAL_GUIDE,
  started,
  "tutorial.test.action",
  { now: "2026-08-12T10:00:30.000Z" },
);
assert.equal(rehearsed.stepIndex, 0);
assert.deepEqual(rehearsed.practiceActionIds, ["tutorial.test.action"]);
const actionAdvanced = recordTutorialPracticeAction(
  BASIC_TUTORIAL_GUIDE,
  started,
  "tutorial.test.navigate",
  { autoAdvance: true, now: "2026-08-12T10:00:40.000Z" },
);
assert.equal(actionAdvanced.stepIndex, 1);
assert.deepEqual(actionAdvanced.practiceActionIds, ["tutorial.test.navigate"]);
assert.deepEqual(actionAdvanced.completedStepIds, [BASIC_TUTORIAL_GUIDE.steps[0].id]);
const progress = sessionProgress(advanced, false);
const resumed = createTutorialSession(BASIC_TUTORIAL_GUIDE, {
  progress,
  resume: true,
  now: "2026-08-12T10:02:00.000Z",
  runId: 13,
});
assert.equal(resumed.stepIndex, 1);
assert.deepEqual(resumed.completedStepIds, progress.completedStepIds);
assert.notEqual(
  resumed.demoAnchorDate,
  "2042-03-09",
  "A resumed guide must re-anchor demo data to the current local day",
);
const reanchored = createTutorialSession(BASIC_TUTORIAL_GUIDE, {
  progress,
  resume: true,
  now: "2042-03-10T00:01:00.000Z",
  demoAnchorDate: "2042-03-10",
  runId: 14,
});
assert.equal(reanchored.demoAnchorDate, "2042-03-10");
assert.equal(reanchored.stepIndex, progress.stepIndex);
const storedReanchored = reanchorTutorialSession(
  { ...resumed, demoAnchorDate: "2042-03-09" },
  "2042-03-10",
  "2042-03-10T00:01:00.000Z",
);
assert.equal(storedReanchored.demoAnchorDate, "2042-03-10");
assert.equal(storedReanchored.stepId, resumed.stepId);
assert.equal(sessionProgress(resumed, true).completed, true);

const incomplete = {
  tutorialComplete: false,
  advancedTutorialComplete: false,
};
for (const completed of [false, true]) {
  const closed = tutorialCloseSettings("essential", completed, incomplete);
  assert.equal(closed.tutorialComplete, true);
  assert.equal(closed.advancedTutorialComplete, false);
  assert.equal(tutorialGuideTrigger(closed), undefined);
}
assert.equal(
  tutorialCloseSettings("full-app", false, {
    tutorialComplete: true,
    advancedTutorialComplete: false,
  }).advancedTutorialComplete,
  false,
);
assert.equal(
  tutorialCloseSettings("full-app", true, {
    tutorialComplete: true,
    advancedTutorialComplete: false,
  }).advancedTutorialComplete,
  true,
);
assert.equal(
  tutorialCloseSettings("today", true, {
    tutorialComplete: true,
    advancedTutorialComplete: false,
  }).advancedTutorialComplete,
  false,
);
assert.equal(tutorialSessionBlocksTrigger(undefined, undefined), false);
assert.equal(
  tutorialSessionBlocksTrigger(undefined, "essential"),
  true,
  "A stored session waiting behind the entry curtain must block the settings trigger",
);
assert.equal(tutorialSessionBlocksTrigger("full-app", undefined), true);

const relative = relativeTargetRect(
  { x: 42, y: 110, width: 90, height: 44 },
  { x: 10, y: 20 },
);
assert.deepEqual(relative, { x: 32, y: 90, width: 90, height: 44 });
assert.equal(isRectVisible(relative, { width: 320, height: 568 }), true);
const spot = spotlightRect(relative, { width: 320, height: 568 }, 7);
assert.deepEqual(spot, { x: 25, y: 83, width: 104, height: 58 });
assert.equal(
  spotlightRect(
    { x: 400, y: 700, width: 20, height: 20 },
    { width: 320, height: 568 },
  ),
  undefined,
);
const below = calloutLayout({
  screen: { width: 320, height: 568 },
  spotlight: { x: 20, y: 80, width: 100, height: 50 },
  calloutHeight: 200,
});
assert.equal(below.placement, "below");
const above = calloutLayout({
  screen: { width: 320, height: 568 },
  spotlight: { x: 20, y: 470, width: 100, height: 50 },
  calloutHeight: 200,
});
assert.equal(above.placement, "above");
for (const layout of [below, above]) {
  assert.ok(layout.left >= 0);
  assert.ok(layout.top >= 0);
  assert.ok(layout.left + layout.width <= 320);
}

assert.match(storageSource, /metric-rally-tutorial-progress-v1:/);
assert.match(storageSource, /metric-rally-active-tutorial-v1:/);
assert.match(storageSource, /accountPart\(accountId\)/);
assert.match(contextSource, /readTutorialProgress\(accountId, guide\)/);
assert.match(contextSource, /writeTutorialProgress\(accountId, progress\)/);
assert.match(
  contextSource,
  /tutorialCloseSettings\(session\.guideId, completed/,
  "Tutorial close behavior must use the executable, reload-tested contract",
);
assert.match(contextSource, /enqueueStorage\(\(\) => flushLocalPersistence\(\)\)/);
assert.match(contextSource, /activeSessionRef/);
assert.match(contextSource, /pendingSessionRef\.current\?\.guideId/);
assert.match(contextSource, /TutorialIsolatedPreviewBoundary/);
assert.match(contextSource, /scope !== "isolated-preview" \|\| !previewBoundary/);
assert.match(spotlightSource, /accessibilityViewIsModal/);
assert.match(spotlightSource, /AccessibilityInfo\.isReduceMotionEnabled/);
assert.match(spotlightSource, /accessibilityLabel=\{t\("Previous tutorial step"\)\}/);
assert.match(spotlightSource, /requestTargetReveal\(targetId\)/);
assert.match(
  spotlightSource,
  /if \(!active \|\| !pageSettled \|\| waitingForRoute \|\| !targetId\) return;/,
  "Every mounted tutorial target must request reveal after the page settles, even when its measured rect is below the viewport",
);
assert.doesNotMatch(
  spotlightSource,
  /if \(!active \|\| rect \|\| waitingForRoute \|\| !targetId\) return;/,
  "A positive off-screen rect must not suppress target reveal",
);
assert.match(
  spotlightSource,
  /outsideUsableViewport[\s\S]{0,240}windowHeight - 88[\s\S]{0,360}scrollContext\?\.reveal\(lastWindowY\.current\)/,
  "A target measured below the real scroll viewport must schedule its own reveal after the page preview beat",
);
assert.match(
  spotlightSource,
  /routeMatchesStep\([\s\S]{0,120}activeSession\.demoAnchorDate/,
  "Every spotlight route comparison must use the persisted demo anchor date",
);
assert.match(
  spotlightSource,
  /setTimeout\(\(\) => router\.navigate\(route as never\), 420\)/,
  "Route enforcement must wait for the real control before navigating.",
);
assert.match(spotlightSource, /settledPath\.current === pathname/);
assert.match(spotlightSource, /reduceMotion \? 0 : 950/);
assert.match(
  spotlightSource,
  /function back\(\)[\s\S]{0,180}previousStep\(\);/,
  "Back must let the previous step's route settle instead of replacing a modal immediately.",
);
assert.doesNotMatch(
  spotlightSource,
  /function advance\(\)[\s\S]{0,900}router\.replace/,
  "Advancing must not race React Navigation with an immediate route replacement.",
);
assert.match(
  spotlightSource,
  /if \(!activeGuide \|\| !activeSession \|\| !step \|\| !localizedGuide \|\| !localizedStep\)[\s\S]{0,220}styles\.transitionCurtain/,
  "Entering with no active session must still render an opaque transition curtain",
);
assert.match(spotlightSource, /localizedTutorialGuide\(activeGuide, language\)/);
assert.match(quickGuideSource, /localizedTutorialGuides\(guides, language\)/);
assert.match(
  uiSource,
  /<TutorialScrollProvider[\s\S]{0,120}reveal=\{revealTutorialTarget\}[\s\S]{0,120}setActiveTargetMeasurer=\{setTutorialTargetMeasurer\}/,
);
assert.match(uiSource, /scrollOffsetRef\.current \+ targetWindowY - scrollWindowY - 80/);
assert.match(uiSource, /onScroll\?\.\(event\)/, "Screen must preserve its caller's onScroll callback");
assert.match(
  uiSource,
  /onScroll=\{\(event\) => \{[\s\S]{0,180}scheduleTutorialTargetMeasure\(\);/,
  "Screen scrolls must keep the active spotlight aligned with its real control",
);
assert.match(
  uiSource,
  /onScrollEndDrag=\{\(event\) => \{[\s\S]{0,120}flushTutorialTargetMeasure\(\);[\s\S]{0,120}onScrollEndDrag\?\.\(event\)/,
  "Screen must remeasure at drag end and preserve the caller's handler",
);
assert.match(
  uiSource,
  /onMomentumScrollEnd=\{\(event\) => \{[\s\S]{0,120}flushTutorialTargetMeasure\(\);[\s\S]{0,120}onMomentumScrollEnd\?\.\(event\)/,
  "Screen must remeasure at momentum end and preserve the caller's handler",
);
assert.match(
  spotlightSource,
  /scrollContext\?\.setActiveTargetMeasurer\(instanceId, measureNow\)/,
  "An active target in a Screen must register a current-position measurer",
);
assert.match(
  spotlightSource,
  /scrollContext\?\.setActiveTargetMeasurer\(instanceId\);/,
  "A target must unregister its scroll measurer when its step ends",
);
assert.match(uiSource, /Math\.min\(scrollEventThrottle, 16\)/);
assert.match(spotlightSource, /pointerEvents=\{canPassThrough \? "none" : "auto"\}/);
assert.match(
  spotlightSource,
  /onTutorialActivate\?: \(\) => void/,
  "A real tutorial target may expose its existing action through the cutout",
);
assert.match(
  spotlightSource,
  /requestTargetActivation\(targetId\)/,
  "The cutout must activate an explicitly registered real control",
);
assert.match(
  contextSource,
  /const requestTargetActivation = useCallback[\s\S]{0,500}activate\(\);[\s\S]{0,80}return true/,
  "Target activation must run only a registered control callback",
);
assert.match(
  todaySource,
  /<TutorialTarget[\s\S]{0,120}id="today-filter"[\s\S]{0,120}onTutorialActivate=\{openViewFilters\}/,
  "The filter practice must expose the same action used by its real button",
);
assert.match(
  todaySource,
  /onPress=\{openViewFilters\}/,
  "Tutorial and ordinary filter activation must share one handler",
);
assert.match(
  spotlightSource,
  /accessibilityViewIsModal\s+aria-modal/,
  "The tutorial must remain an accessibility modal during real pointer practice",
);
assert.doesNotMatch(
  spotlightSource,
  /accessibilityViewIsModal=\{!canPassThrough\}/,
  "Pointer pass-through must never expose every routed control to assistive technology",
);
assert.match(spotlightSource, /trapTutorialFocus/);
assert.match(spotlightSource, /accessibilityIntroRef/);
assert.match(spotlightSource, /Complete simulated practice/);
assert.match(spotlightSource, /completePracticeAccessibly\(actionId\)/);
assert.match(contextSource, /completePracticeAccessibly/);
assert.match(
  contextSource,
  /return storePracticeAction\(guide, session, actionId, false\)/,
  "Accessible rehearsal must mark tutorial metadata without executing or auto-advancing the app action",
);
assert.match(
  rootLayoutSource,
  /aria-hidden=\{tutorialActive\}[\s\S]{0,180}accessibilityElementsHidden=\{tutorialActive\}[\s\S]{0,180}no-hide-descendants/,
  "The routed app tree must be hidden from assistive technology while the tutorial modal is active",
);
assert.match(
  contextSource,
  /scope === "isolated-preview" && interaction\.autoAdvance === true/,
  "Only a successfully reported isolated action may auto-advance",
);
assert.match(
  guideSource,
  /actionId: "tutorial\.progress\.open-day"[\s\S]{0,120}autoAdvance: true/,
  "The day-opening practice must advance before route enforcement can undo its navigation",
);
assert.match(spotlightSource, /realPracticeAvailable && !practiceComplete/);
assert.match(
  spotlightSource,
  /const enabled = activeTargetId === id;/,
  "Inactive tutorial targets must not measure or register during normal app use",
);
assert.match(spotlightSource, /if \(!enabled\) return;/);
assert.match(spotlightSource, /onLayout=\{enabled \? measure : undefined\}/);
assert.doesNotMatch(
  spotlightSource,
  /transitionDurationMs \* 2/,
  "Exit navigation must happen while the transition curtain is fully covered",
);
assert.match(quickGuideSource, /startGuide\(guide\.id, \{ resume \}\)/);
assert.match(quickGuideSource, /progressByGuide/);

const scanned = [
  contextSource,
  spotlightSource,
  storageSource,
  quickGuideSource,
];
for (const source of scanned) {
  assert.doesNotMatch(
    source,
    /[\u00c2\u00c3\u00e2\ufffd]/,
    "Tutorial UI must contain no mojibake",
  );
  assert.doesNotMatch(
    source,
    /updateMetric|addEntry|setTrackedGoal|scheduleNotification|syncNow/,
    "Tutorial engine must not mutate app, cloud, health, or native data",
  );
}

console.log(
  "Tutorial engine routes, resume storage, geometry, accessibility, reveal, and sandbox guards validated.",
);
