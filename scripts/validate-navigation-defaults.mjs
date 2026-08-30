import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_TAB_ORDER,
  compactTabBarForCount,
  isFixedNavigationPage,
  navigationDefaultsForVersion,
  normalizeTabOrder,
} from "../src/domain/navigation.ts";
import {
  storedWorkoutDraftHasActiveTimer,
  WORKOUT_DRAFT_MAX_AGE_MS,
} from "../src/domain/workoutTimerPresence.ts";

assert.deepEqual(DEFAULT_TAB_ORDER, [
  "index",
  "status",
  "log",
  "group",
  "insights",
  "gym",
  "calendar",
  "journal",
  "performance",
  "recapfeed",
  "chat",
]);

assert.deepEqual(
  normalizeTabOrder([
    "chat",
    "gym",
    "status",
    "index",
    "gym",
    "group",
  ]),
  [
    "index",
    "status",
    "gym",
    "group",
    "log",
    "insights",
    "calendar",
    "journal",
    "performance",
    "recapfeed",
    "chat",
  ],
  "fixed tabs must be repaired without losing the user's middle-page order",
);

assert.deepEqual(
  normalizeTabOrder(undefined).filter((id) => id !== "status"),
  [
    "index",
    "log",
    "group",
    "insights",
    "gym",
    "calendar",
    "journal",
    "performance",
    "recapfeed",
    "chat",
  ],
  "hiding Status must leave Today first and Chat last",
);

assert.equal(navigationDefaultsForVersion({ showStatus: false }, 24).showStatus, true);
assert.equal(
  navigationDefaultsForVersion({ showStatus: false }, 25).showStatus,
  false,
  "a post-migration Status opt-out must remain disabled",
);
assert.equal(navigationDefaultsForVersion({}, 25).showStatus, true);
assert.equal(isFixedNavigationPage("index"), true);
assert.equal(isFixedNavigationPage("status"), true);
assert.equal(isFixedNavigationPage("chat"), true);
assert.equal(isFixedNavigationPage("group"), false);
assert.equal(
  compactTabBarForCount(6),
  false,
  "six visible tabs must retain the established spacing and typography",
);
assert.equal(
  compactTabBarForCount(7),
  true,
  "seven visible tabs must switch to the full-label compact treatment",
);
assert.equal(compactTabBarForCount(10), true);

const tabs = fs.readFileSync("app/(tabs)/_layout.tsx", "utf8");
const display = fs.readFileSync("app/display-settings.tsx", "utf8");
const onboarding = fs.readFileSync("app/onboarding.tsx", "utf8");
const seed = fs.readFileSync("src/data/seed.ts", "utf8");
const provider = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const cloudProvider = fs.readFileSync("src/cloud/CloudSyncProvider.tsx", "utf8");
const timerPage = fs.readFileSync("app/timer.tsx", "utf8");
const timersTab = fs.readFileSync("app/(tabs)/timers.tsx", "utf8");
const rootLayout = fs.readFileSync("app/_layout.tsx", "utf8");
const timerOverlay = fs.readFileSync(
  "src/components/ActiveTimerOverlay.tsx",
  "utf8",
);
const gym = fs.readFileSync("app/(tabs)/gym.tsx", "utf8");
const workoutTimerPresence = fs.readFileSync(
  "src/storage/workoutTimerPresence.ts",
  "utf8",
);

assert.match(tabs, /const showStatus = state\.settings\.showStatus !== false/);
assert.match(tabs, /normalizeTabOrder\(state\.settings\.tabOrder\)/);
assert.match(tabs, /const visibleTabCount = orderedTabs\.filter\(isVisible\)\.length/);
assert.match(tabs, /compactTabBarForCount\(visibleTabCount\)/);
assert.match(tabs, /fontSize: 7\.2/);
assert.match(tabs, /letterSpacing: -0\.25/);
assert.match(tabs, /compactTabBar \? 20 : 22/);
assert.match(tabs, /: \{ fontSize: 9, fontWeight: "700" \}/);
assert.match(display, /page\.id !== "status" \|\| state\.settings\.showStatus !== false/);
assert.match(display, /key === "showStatus"[\s\S]{0,100}state\.settings\.showStatus !== false/);
assert.match(display, /isFixedNavigationPage\(id\)/);
assert.match(onboarding, /landingPage === "status" \|\| state\.settings\.showStatus !== false/);
assert.match(seed, /version: 27/);
assert.match(seed, /showStatus: true/);
assert.match(seed, /showRecap: false/);
assert.match(provider, /const restoredState: AppState = \{[\s\S]{0,100}version: 27/);
assert.doesNotMatch(cloudProvider, /version: 24/);

const now = Date.UTC(2026, 7, 25, 12);
const activeWorkoutDraft = JSON.stringify({
  savedAt: now - 1_000,
  timer: { mode: "work", startedAt: now - 5_000 },
  exercises: [],
});
assert.equal(storedWorkoutDraftHasActiveTimer(activeWorkoutDraft, now), true);
assert.equal(
  storedWorkoutDraftHasActiveTimer(
    JSON.stringify({
      savedAt: now - WORKOUT_DRAFT_MAX_AGE_MS - 1,
      timer: { mode: "work" },
      exercises: [],
    }),
    now,
  ),
  false,
  "an abandoned workout draft must not leave a permanent navigation dot",
);
assert.equal(storedWorkoutDraftHasActiveTimer("not-json", now), false);
assert.equal(
  storedWorkoutDraftHasActiveTimer(
    JSON.stringify({ savedAt: now, timer: null, exercises: [] }),
    now,
  ),
  false,
);

assert.match(
  tabs,
  /state\.settings\.showActiveTimersTab === true && hasActiveActivityTimer/,
  "the optional Timers tab must exist only while an activity timer is active",
);
assert.match(tabs, /next\.indexOf\("gym"\)[\s\S]{0,120}next\.splice/);
assert.match(tabs, /route\.name === "gym" && hasActiveWorkoutTimer/);
assert.match(tabs, /route\.name === "timers" && hasActiveActivityTimer/);
assert.match(
  tabs,
  /\{orderedTabs\.map\(\(name\) => \([\s\S]{0,180}<Tabs\.Screen[\s\S]{0,100}name=\{name\}[\s\S]{0,100}options=\{tabOptions\[name\]\}/,
  "ordered navigation entries must render their matching tab configuration",
);
assert.match(
  tabs,
  /!orderedTabs\.includes\("timers"\)[\s\S]{0,180}<Tabs\.Screen[\s\S]{0,100}name="timers"[\s\S]{0,100}options=\{tabOptions\.timers\}/,
  "the conditional Timers route must remain registered while hidden",
);
assert.match(timersTab, /export \{ default \} from "\.\.\/timer"/);
assert.match(
  display.slice(display.indexOf('title="Advanced"')),
  /title="Show active Timers tab"/,
  "the off-by-default Timers-tab control belongs in Display > Advanced",
);
assert.match(seed, /showActiveTimersTab: false/);
assert.match(seed, /showActivityTimerOverlay: true/);
assert.match(seed, /activityTimerOverlayMinimized: false/);
assert.match(
  timerPage,
  /setActivityTimer\([\s\S]{0,220}showActivityTimerOverlay: true,[\s\S]{0,80}activityTimerOverlayMinimized: false/,
  "a newly started activity timer must restore its full floating overlay",
);
assert.match(timerOverlay, /const MINIMIZED_SIZE = 42/);
assert.match(
  timerOverlay,
  /updateSettings\(\{ activityTimerOverlayMinimized: true \}\)/,
);
assert.match(timerOverlay, /style=\{styles\.minimizedButton\}/);
assert.doesNotMatch(
  timerOverlay,
  /updateSettings\(\{ showActivityTimerOverlay: false \}\)/,
  "the floating overlay control must minimize instead of stopping or hiding",
);
assert.match(
  rootLayout,
  /rootSegment === "\(tabs\)" && tabSegment === "timers"/,
);
assert.match(gym, /setWorkoutTimerPresence\([\s\S]{0,100}Boolean\(workoutTimer\)/);
assert.match(workoutTimerPresence, /hydrateWorkoutTimerPresence/);
assert.match(
  workoutTimerPresence,
  /revision === presenceRevision/,
  "a stale disk read must not overwrite live Workout timer presence",
);

console.log(
  "Navigation defaults, transient timer tab, draggable activity overlay, and workout timer badge validated.",
);
