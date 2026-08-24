import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chunkIntoPages,
  clampPageIndex,
  configuredPageCapacity,
  pageIndexFromOffset,
  leaderboardPageCapacity,
  todayPageCapacity,
} from "../src/domain/pagedLayout.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

assert.deepEqual(chunkIntoPages([1, 2, 3, 4, 5], 2), [
  [1, 2],
  [3, 4],
  [5],
]);
assert.deepEqual(chunkIntoPages([], 4), []);
assert.deepEqual(chunkIntoPages([1, 2], 0), [[1], [2]]);
assert.equal(clampPageIndex(-2, 3), 0);
assert.equal(clampPageIndex(7, 3), 2);
assert.equal(pageIndexFromOffset(640, 320, 4), 2);
assert.equal(pageIndexFromOffset(470, 320, 4), 1);
assert.equal(pageIndexFromOffset(100, 0, 4), 0);
assert.equal(configuredPageCapacity(undefined, 4, 2, 6), 4);
assert.equal(configuredPageCapacity(8, 4, 2, 6), 6);
assert.equal(configuredPageCapacity(0, 4, 2, 6), 2);
assert.equal(configuredPageCapacity(4.9, 1, 1, 4), 4);
assert.equal(todayPageCapacity(568, false), 2);
assert.equal(todayPageCapacity(667, false), 4);
assert.equal(todayPageCapacity(900, false), 6);
assert.equal(leaderboardPageCapacity(720, 2, true), 2);
assert.equal(leaderboardPageCapacity(720, 4, true), 1);
assert.equal(leaderboardPageCapacity(900, 4, true), 2);
assert.equal(leaderboardPageCapacity(1200, 1, false), 4);
assert.equal(leaderboardPageCapacity(900, 2, false), 4);

const types = source("src/types.ts");
const seed = source("src/data/seed.ts");
const settings = source("app/display-settings.tsx");
const today = source("app/(tabs)/index.tsx");
const leaderboard = source("app/(tabs)/group.tsx");
const pager = source("src/components/HorizontalPager.tsx");

assert.match(
  today,
  /onMove=\{\(target\)[\s\S]{0,300}setDraggingMetricId\(null\)[\s\S]{0,300}reorderMetric/,
  "Today must release the pager before a cross-page reorder reparents its card",
);
assert.equal(
  (leaderboard.match(/onMove=\{\(target\)[\s\S]{0,300}setDraggingCardId\(null\)[\s\S]{0,220}move\(id, target\)/g) ?? []).length,
  2,
  "Leaderboard must release the pager for challenge and tracker cross-page moves",
);

for (const setting of ["todayLayoutMode", "leaderboardLayoutMode"]) {
  assert.match(types, new RegExp(`${setting}\\?: DashboardLayoutMode`));
  assert.match(seed, new RegExp(`${setting}: "pages"`));
}
assert.match(types, /todayTilesPerPage\?: number/);
assert.match(types, /leaderboardCardsPerPage\?: number/);
assert.match(seed, /todayTilesPerPage: 4/);
assert.match(seed, /leaderboardCardsPerPage: 2/);
assert.match(seed, /todosBelowGoals: true/);
assert.match(settings, /title="Today layout"/);
assert.match(settings, /title="Leaderboard layout"/);
assert.match(settings, /state\.settings\.todayTilesPerPage \?\? 4/);
assert.match(settings, /state\.settings\.leaderboardCardsPerPage \?\? 2/);
assert.match(settings, /label: "Scrolling list"/);
assert.match(settings, /label: "Swipeable pages"/);
assert.match(today, /\(state\.settings\.todayLayoutMode \?\? "pages"\) === "pages"/);
assert.doesNotMatch(today, /paged=\{todayUsesPages && !editing\}/);
assert.match(today, /paged=\{todayUsesPages\}/);
assert.match(today, /scrollEnabled=\{!draggingMetricId\}/);
assert.match(today, /configuredPageCapacity\(\s*state\.settings\.todayTilesPerPage/);
assert.match(today, /Math\.min\(fittingPageCapacity, preferredPageCapacity\)/);
assert.match(today, /state\.settings\.todosBelowGoals === false/);
assert.match(today, /state\.settings\.todosBelowGoals !== false/);
assert.match(today, /!todayUsesPages &&\s*!editing/);
assert.match(today, /todayUsesPages\s*\? \[\]/);
assert.match(today, /testID="today-tracker-pages"/);
assert.match(
  leaderboard,
  /\(state\.settings\.leaderboardLayoutMode \?\? "pages"\) === "pages"/,
);
assert.match(leaderboard, /!leaderboardUsesPages &&\s*!editing/);
assert.match(leaderboard, /if \(!leaderboardUsesPages\) return rankingCards/);
assert.match(leaderboard, /scrollEnabled=\{!draggingCardId\}/);
assert.match(settings, /\[1, 2, 3, 4\]\.map/);
assert.match(leaderboard, /testID="leaderboard-card-pages"/);
assert.match(leaderboard, /chunkIntoPages\(\s*rankingCards/);
assert.match(leaderboard, /return Math\.min\(fittingCapacity, preferredCapacity\)/);
assert.match(leaderboard, /requestedPage=\{requestedLeaderboardPage\}/);
assert.match(today, /style=\{styles\.sectionPageIndicator\}/);
assert.match(
  today,
  /onPress=\{\(\) => setRequestedTodayPage\(index\)\}/,
  "Today's compact page dots must remain interactive on native and Web",
);
assert.match(today, /requestedPage=\{requestedTodayPage\}/);
assert.match(today, /setTodayPageIndex\(page\)/);
assert.match(today, /showPageDots=\{false\}/);
assert.doesNotMatch(
  leaderboard,
  /if \(expandedGridRows\.length > 0\) return 1/,
  "expanded member calendars must not repaginate Leaderboard cards",
);
assert.match(pager, /pagingEnabled/);
assert.match(pager, /showPageDots && pages\.length > 1/);
assert.match(pager, /accessibilityRole="tablist"/);
assert.match(pager, /Page \{page\} of \{total\}/);
assert.match(pager, /const activePageRef = useRef\(0\)/);
assert.match(pager, /onPress=\{\(\) => moveToPage\(index\)\}/);
assert.doesNotMatch(pager, /disabled=\{Platform\.OS !== "web"\}/);
assert.match(pager, /navigator\.maxTouchPoints \?\? 0/);
assert.match(
  pager,
  /Platform\.OS === "web" \|\| Math\.abs\(index - activePage\) <= 1/,
  "Web pager content must stay mounted throughout a swipe to avoid compositor ghosts",
);
const viewportCorrection = pager.slice(
  pager.indexOf("Realign only when the viewport width"),
  pager.indexOf("useEffect(() => {\n    onPageChange"),
);
assert.doesNotMatch(
  viewportCorrection,
  /\[activePage,\s*pageWidth/,
  "Changing the active page must not trigger a competing non-animated scrollTo",
);

console.log("Paged Today and Leaderboard layout validation passed.");
