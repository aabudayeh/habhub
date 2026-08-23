import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chunkIntoPages,
  clampPageIndex,
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
assert.equal(todayPageCapacity(568, false), 2);
assert.equal(todayPageCapacity(667, false), 4);
assert.equal(todayPageCapacity(900, false), 5);
assert.equal(leaderboardPageCapacity(720, 2, true, false), 2);
assert.equal(leaderboardPageCapacity(720, 4, true, false), 1);
assert.equal(leaderboardPageCapacity(900, 4, true, false), 2);
assert.equal(leaderboardPageCapacity(900, 2, false, true), 1);

const types = source("src/types.ts");
const seed = source("src/data/seed.ts");
const settings = source("app/display-settings.tsx");
const today = source("app/(tabs)/index.tsx");
const leaderboard = source("app/(tabs)/group.tsx");
const pager = source("src/components/HorizontalPager.tsx");

for (const setting of ["todayLayoutMode", "leaderboardLayoutMode"]) {
  assert.match(types, new RegExp(`${setting}\\?: DashboardLayoutMode`));
  assert.match(seed, new RegExp(`${setting}: "pages"`));
}
assert.match(settings, /title="Today layout"/);
assert.match(settings, /title="Leaderboard layout"/);
assert.match(settings, /label: "Scrolling list"/);
assert.match(settings, /label: "Swipeable pages"/);
assert.match(today, /\(state\.settings\.todayLayoutMode \?\? "pages"\) === "pages"/);
assert.match(today, /todayUsesPages && !editing/);
assert.match(today, /!todayUsesPages &&\s*!editing/);
assert.match(today, /todayUsesPages\s*\? \[\]/);
assert.match(today, /testID="today-tracker-pages"/);
assert.match(
  leaderboard,
  /\(state\.settings\.leaderboardLayoutMode \?\? "pages"\) === "pages"/,
);
assert.match(leaderboard, /!leaderboardUsesPages &&\s*!editing/);
assert.match(leaderboard, /!leaderboardUsesPages \|\| editing/);
assert.match(leaderboard, /testID="leaderboard-card-pages"/);
assert.match(leaderboard, /chunkIntoPages\(\s*rankingCards/);
assert.match(leaderboard, /requestedPage=\{requestedLeaderboardPage\}/);
assert.match(today, /style=\{styles\.sectionPageIndicator\}/);
assert.match(today, /onPageChange=\{setTodayPageIndex\}/);
assert.match(pager, /pagingEnabled/);
assert.match(pager, /accessibilityRole="tablist"/);
assert.match(pager, /Page \{page\} of \{total\}/);
assert.match(pager, /const activePageRef = useRef\(0\)/);
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
