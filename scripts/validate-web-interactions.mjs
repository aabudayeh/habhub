import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isIosWebDevice,
  isStandaloneIosWebApp,
  resolveScreenBottomPadding,
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
const screen = source("src/components/ui.tsx");
const today = source("app/(tabs)/index.tsx");
const status = source("app/(tabs)/status.tsx");
const log = source("app/(tabs)/log.tsx");

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
assert.match(pager, /const activePageRef = useRef\(0\)/);
assert.match(
  pager,
  /Platform\.OS === "web" \|\| Math\.abs\(index - activePage\) <= 1/,
);

assert.match(fastingClock, /addEventListener\("pointerup", finishDrag, true\)/);
assert.match(fastingClock, /addEventListener\("pointercancel", finishDrag, true\)/);
assert.equal(
  isIosWebDevice({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
  true,
);
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
const standaloneIos = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
  platform: "iPhone",
  maxTouchPoints: 5,
  displayModeStandalone: true,
};
assert.equal(
  resolveScreenBottomPadding(120, undefined, undefined, 34, true, standaloneIos),
  0,
  "standalone iOS tab scenes must not repeat navigator/tab safe-area clearance",
);
assert.equal(
  resolveScreenBottomPadding(120, 16, undefined, 34, true, standaloneIos),
  0,
  "iOS Web tab scenes must not leave an explicit gutter above navigation",
);
assert.equal(
  resolveScreenBottomPadding(120, 16, 14, 34, true, {
    ...standaloneIos,
    displayModeStandalone: false,
  }),
  0,
  "iOS Web tab clearance must not depend on unreliable standalone reporting",
);
assert.equal(
  resolveScreenBottomPadding(120, undefined, undefined, 34, false, standaloneIos),
  154,
  "standalone non-tab screens retain full bottom clearance",
);
assert.equal(
  resolveScreenBottomPadding(120, undefined, undefined, 34, true, {
    ...standaloneIos,
    userAgent: "Mozilla/5.0 (Linux; Android 15)",
    platform: "Linux armv8l",
  }),
  154,
  "other standalone platforms remain unchanged",
);
assert.equal(
  resolveScreenBottomPadding(120, undefined, 14, 0, true, {
    ...standaloneIos,
    userAgent: "Mozilla/5.0 (Linux; Android 15)",
    platform: "Linux armv8l",
  }),
  120,
  "non-iOS pages retain the navigator-safe minimum when their gutter is smaller",
);
assert.match(tabs, /height: 55 \+ tabBarBottomInset/);
assert.match(tabs, /paddingBottom: Math\.max\(1, tabBarBottomInset\)/);
assert.match(screen, /resolveScreenBottomPadding\(/);
assert.match(
  screen,
  /contentContainerStyle,[\s\S]{0,500}removeIosWebTabGutter && \{ paddingBottom: 0 \}/,
  "iOS Web tab padding removal must be the final style override",
);
assert.match(screen, /segments\.join\("\/"\)\.includes\("\(tabs\)"\)/);
assert.match(today, /iosWebDevice && styles\.standaloneIosPage/);
assert.match(today, /standaloneIosPage: \{ paddingBottom: 0 \}/);

assert.match(metricEditor, /fixedBottom=\{/);
assert.match(metricEditor, /label=\{saveActionLabel\}/);
assert.match(screen, /fixedBottom\?: ReactNode/);
assert.match(screen, /styles\.fixedBottom/);

for (const trackerScreen of [today, status]) {
  assert.match(trackerScreen, /const TRACKER_DOUBLE_TAP_MS = 210/);
  assert.match(trackerScreen, /pathname: "\/log"/);
  assert.match(trackerScreen, /params: \{ metric: .*\.id, date:/);
  assert.match(trackerScreen, /name: "log", label: "Open Log page"/);
  assert.match(trackerScreen, /actionName === "log"/);
  assert.match(
    trackerScreen,
    /if \(!canLog\) \{\s*openDetails\(\);\s*return;/,
    "non-loggable tracker cards must retain immediate detail navigation",
  );
}
assert.match(today, /onLongPress=\{\(\) => \{/);
assert.match(today, /opacity: tapPressed \? 0\.78 : 1/);
assert.match(status, /pressed && styles\.pressed/);
assert.match(
  log,
  /params\.metric && metrics\.some\(\(metric\) => metric\.id === params\.metric\)[\s\S]{0,80}setSelectedId\(params\.metric\)/,
  "Log deep links must focus the tracker requested by a double tap",
);

console.log(
  "Web editor, pager, tracker gestures, and standalone iOS safe-area validation passed.",
);
