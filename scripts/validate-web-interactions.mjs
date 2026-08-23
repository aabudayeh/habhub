import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isStandaloneIosWebApp,
  resolveTabBarBottomInset,
} from "../src/domain/webSafeArea.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const guards = source("src/components/useWebBeforeUnload.ts");
const metricEditor = source("app/metric-editor.tsx");
const pager = source("src/components/HorizontalPager.tsx");
const fastingClock = source("src/components/FastingClockEditor.tsx");
const tabs = source("app/(tabs)/_layout.tsx");

assert.match(guards, /export function useWebBackNavigationGuard/);
assert.match(guards, /navigationApi\.addEventListener\("navigate", navigate\)/);
assert.match(guards, /event\.navigationType !== "traverse"/);
assert.match(guards, /event\.preventDefault\(\)/);
assert.match(guards, /__habhubEditorBackGuard/);
assert.match(guards, /window\.history\.pushState\(/);
assert.match(guards, /addEventListener\("popstate", popstate\)/);
assert.match(guards, /window\.history\.forward\(\)/);
assert.match(guards, /window\.history\.go\(-2\)/);
assert.match(metricEditor, /useWebBackNavigationGuard\(/);
assert.match(metricEditor, /requestCloseRef\.current\(continueBack\)/);

assert.match(
  pager,
  /onScroll=\{Platform\.OS === "web" \? updateActivePage : undefined\}/,
);
assert.match(pager, /onMomentumScrollEnd=\{updateActivePage\}/);
assert.match(pager, /onScrollEndDrag=\{updateActivePage\}/);

assert.match(fastingClock, /addEventListener\("pointerup", finishDrag, true\)/);
assert.match(fastingClock, /addEventListener\("pointercancel", finishDrag, true\)/);
assert.equal(
  (fastingClock.match(/onPanResponderRelease: finishDrag/g) ?? []).length,
  2,
);
assert.equal(
  (fastingClock.match(/onPanResponderTerminate: finishDrag/g) ?? []).length,
  2,
);

assert.equal(
  isStandaloneIosWebApp({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
    navigatorStandalone: true,
  }),
  true,
);
assert.equal(
  isStandaloneIosWebApp({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    platform: "MacIntel",
    maxTouchPoints: 5,
    displayModeStandalone: true,
  }),
  true,
);
assert.equal(
  resolveTabBarBottomInset(34, {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
    displayModeStandalone: true,
  }),
  10,
);
assert.equal(
  resolveTabBarBottomInset(34, {
    userAgent: "Mozilla/5.0 (Linux; Android 15)",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
    displayModeStandalone: true,
  }),
  34,
);
assert.equal(
  resolveTabBarBottomInset(34, {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
    displayModeStandalone: false,
    navigatorStandalone: false,
  }),
  34,
);
assert.equal(resolveTabBarBottomInset(34), 34);
assert.match(tabs, /height: 55 \+ tabBarBottomInset/);
assert.match(tabs, /paddingBottom: Math\.max\(1, tabBarBottomInset\)/);

console.log(
  "Web editor, pager, time-drag, and standalone iOS safe-area validation passed.",
);
