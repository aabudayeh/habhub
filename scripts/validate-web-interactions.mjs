import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isIosWebDevice,
  isStandaloneIosWebApp,
  resolveWebEditorFontSize,
  resolveScreenBottomPadding,
  resolveTabBarBottomInset,
} from "../src/domain/webSafeArea.ts";
import { resolveWebSoftwareKeyboardVisibility } from "../src/domain/webKeyboard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const guards = source("src/components/useWebBeforeUnload.ts");
const dismissGuard = guards.slice(
  guards.indexOf("export function useWebBackDismiss"),
  guards.indexOf("export function useWebBackNavigationGuard"),
);
const metricEditor = source("app/metric-editor.tsx");
const pager = source("src/components/HorizontalPager.tsx");
const fastingClock = source("src/components/FastingClockEditor.tsx");
const tabs = source("app/(tabs)/_layout.tsx");
const screen = source("src/components/ui.tsx");
const today = source("app/(tabs)/index.tsx");
const status = source("app/(tabs)/status.tsx");
const log = source("app/(tabs)/log.tsx");
const chat = source("app/(tabs)/chat.tsx");
const appText = source("src/components/AppText.tsx");
const html = source("app/+html.tsx");
const extensionPopup = source("browser-extension/popup.html");
const extensionPopupScript = source("browser-extension/popup.js");
const extensionManifest = source("browser-extension/manifest.json");
const extensionReadme = source("browser-extension/README.md");
const extensionRoute = source("app/extension.tsx");
const keyboardVisibility = source(
  "src/components/useSoftwareKeyboardVisibility.ts",
);

assert.match(guards, /export function useWebBackNavigationGuard/);
assert.match(guards, /export function useWebBackDismiss/);
assert.match(guards, /__habhubDismissBackGuard/);
assert.match(guards, /typeof existingGuardId !== "string"/);
assert.match(dismissGuard, /window\.history\.pushState\(/);
assert.match(
  dismissGuard,
  /navigationApi\?\.addEventListener\("navigate", navigate\)/,
  "modern PWAs must cancel Back before Expo Router can close the app",
);
assert.match(dismissGuard, /event\.preventDefault\(\)/);
assert.match(dismissGuard, /dismiss\(true\)/);
assert.match(dismissGuard, /window\.history\.back\(\)/);
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
assert.match(pager, /PanResponder\.create\(/);
assert.match(pager, /onMoveShouldSetPanResponderCapture/);
assert.match(pager, /navigator\.maxTouchPoints \?\? 0/);
assert.match(
  pager,
  /\.\.\.\(webMouseDragEnabled \? webPointerDrag\.panHandlers : \{\}\)/,
  "touch-capable Web devices must keep compositor-driven ScrollView swiping",
);
assert.match(pager, /scrollRef\.current\?\.scrollTo\(\{ x: offset, animated: false \}\)/);
assert.match(pager, /Math\.abs\(gesture\.dx\) >= Math\.min\(52, pageWidth \* 0\.14\)/);
assert.match(pager, /moveToPage\(target\)/);
assert.match(pager, /onPress=\{\(\) => moveToPage\(index\)\}/);
assert.doesNotMatch(pager, /disabled=\{Platform\.OS !== "web"\}/);
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
  resolveWebSoftwareKeyboardVisibility({
    activeEditor: true,
    baselineHeight: 844,
    currentHeight: 480,
    documentVisible: true,
    editorInteractionActive: true,
    requireFreshEditorInteraction: true,
  }),
  true,
  "an actively focused iOS editor with an obstructed viewport hides navigation",
);
assert.equal(
  resolveWebSoftwareKeyboardVisibility({
    activeEditor: true,
    baselineHeight: 844,
    currentHeight: 480,
    documentVisible: true,
    editorInteractionActive: false,
    requireFreshEditorInteraction: true,
  }),
  false,
  "a restored iOS PWA's stale focused input must fail visible",
);
assert.equal(
  resolveWebSoftwareKeyboardVisibility({
    activeEditor: true,
    baselineHeight: 844,
    currentHeight: 480,
    documentVisible: false,
    editorInteractionActive: true,
    requireFreshEditorInteraction: true,
  }),
  false,
  "a backgrounded Web app must never keep navigation hidden",
);
assert.equal(
  resolveWebSoftwareKeyboardVisibility({
    activeEditor: true,
    baselineHeight: 844,
    currentHeight: 480,
    documentVisible: true,
    editorInteractionActive: false,
    requireFreshEditorInteraction: false,
  }),
  true,
  "non-iOS Web keyboard behavior remains independent from the iOS lifecycle gate",
);
assert.match(keyboardVisibility, /isIosWebDevice\(/);
assert.match(keyboardVisibility, /window\.addEventListener\("pagehide"/);
assert.match(keyboardVisibility, /window\.addEventListener\("pageshow"/);
assert.match(keyboardVisibility, /document\.addEventListener\("visibilitychange"/);
assert.match(
  keyboardVisibility,
  /document\.addEventListener\("pointerdown", handleEditorPointerDown, true\)/,
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
  resolveWebEditorFontSize(10, {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
  16,
  "every iPhone Web editor must prevent Safari's focus zoom by default",
);
assert.equal(
  resolveWebEditorFontSize(10, {
    userAgent: "Mozilla/5.0 (Linux; Android 15)",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }),
  10,
  "default focus protection must not resize Android Web editors",
);
assert.equal(
  resolveWebEditorFontSize(
    10,
    {
      userAgent: "Mozilla/5.0 (Linux; Android 15)",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    },
    true,
  ),
  16,
  "the existing explicit Web focus protection remains cross-platform",
);
assert.equal(
  resolveWebEditorFontSize(
    10,
    {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    },
    false,
  ),
  10,
  "an explicit opt-out remains available",
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
  10,
  "iOS Safari and installed iOS Web apps must use the same compact tab inset",
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
  16,
  "standalone iOS tab scenes keep content breathing room without repeating the safe area",
);
assert.equal(
  resolveScreenBottomPadding(120, 16, undefined, 34, true, standaloneIos),
  16,
  "explicit content padding remains independent from the navigator safe area",
);
assert.equal(
  resolveScreenBottomPadding(120, 16, 14, 34, true, {
    ...standaloneIos,
    displayModeStandalone: false,
  }),
  16,
  "iOS Web content padding must not depend on unreliable standalone reporting",
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
  16,
  "every Web tab scene keeps a small content gutter without duplicating the navigator inset",
);
assert.equal(
  resolveScreenBottomPadding(120, undefined, 14, 0, true, {
    ...standaloneIos,
    userAgent: "Mozilla/5.0 (Linux; Android 15)",
    platform: "Linux armv8l",
  }),
  16,
  "Web tab content padding must not depend on a device user agent or reported inset",
);
assert.match(tabs, /height: 55 \+ tabBarBottomInset/);
assert.match(tabs, /paddingBottom: Math\.max\(1, tabBarBottomInset\)/);
assert.match(screen, /resolveScreenBottomPadding\(/);
assert.doesNotMatch(
  screen,
  /removeWebTabGutter|paddingBottom: 0/,
  "content padding must not be globally erased to solve navigator safe-area ownership",
);
assert.match(screen, /segments\.join\("\/"\)\.includes\("\(tabs\)"\)/);
assert.match(today, /page: \{ flexGrow: 1, paddingHorizontal: 14, paddingBottom: 16 \}/);
assert.doesNotMatch(today, /styles\.webTabPage|webTabPage:/);
assert.match(today, /contentInsetAdjustmentBehavior=\{[\s\S]{0,80}Platform\.OS === "web" \? "never"/);
assert.match(today, /todayTileMaxHeight = iosWebDevice && todayUsesPages \? 96 : 88/);
assert.match(appText, /preventWebFocusZoom\?: boolean/);
assert.match(appText, /resolveWebEditorFontSize\(/);
assert.match(chat, /<TextInput[\s\S]{0,180}preventWebFocusZoom/);
assert.match(html, /viewport-fit=cover/);
assert.doesNotMatch(
  html,
  /maximum-scale|user-scalable\s*=\s*no/i,
  "focus zoom must be prevented by input sizing without disabling accessible page zoom",
);
assert.match(html, /@supports \(height: 100dvh\)/);
assert.doesNotMatch(
  html,
  /@media all and \(display-mode: standalone\)[\s\S]{0,240}height: 100vh;/,
  "standalone iOS must not repeat the shell height that moved navigation below the visible viewport",
);
assert.match(
  html,
  /apple-mobile-web-app-status-bar-style" content="black"/,
  "installed iOS Web apps must avoid WebKit's black-translucent bottom-positioning bug",
);
assert.doesNotMatch(
  html,
  /apple-mobile-web-app-status-bar-style" content="black-translucent"/,
);
assert.doesNotMatch(
  html,
  /body \{[\s\S]{0,120}position: fixed;/,
  "iOS standalone must not use WebKit's gap-producing fixed document body",
);
assert.match(html, /body \{[\s\S]{0,80}overscroll-behavior: none;/);
assert.match(chat, /followOutgoingMessageLayout/);
assert.match(chat, /onContentSizeChange=\{handleThreadContentSizeChange\}/);
assert.match(
  today,
  /useWebBackDismiss\(screenIsFocused && editing, finishEditing\)/,
);
assert.match(
  source("app/(tabs)/group.tsx"),
  /useWebBackDismiss\(\s*screenIsFocused && editing,\s*finishLeaderboardEditing,\s*\)/,
);
assert.match(
  today,
  /onPress=\{\(\) => setRequestedTodayPage\(index\)\}/,
);
assert.match(today, /requestedPage=\{requestedTodayPage\}/);
assert.match(today, /todosAfterPagedTrackers/);
assert.match(today, /refreshing=\{!editing && manualRefreshing\}/);
assert.doesNotMatch(today, /cloudStatus === "syncing"/);
assert.match(screen, /refreshing=\{manualRefreshing\}/);
assert.doesNotMatch(screen, /cloudStatus === "syncing" \|\| health\.status === "syncing"/);
assert.match(
  today,
  /\{!editing &&\s*\(item\.goalEnabled !== false \|\| progressSubmetrics\.length > 0\)/,
  "Today edit rows must reclaim progress-bar width for their edit controls",
);

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

assert.doesNotMatch(extensionPopup, /toolbar|quick-nav|data-companion-home|data-app-path|Active timers|schedule card/i);
assert.match(extensionPopup, /<iframe[\s\S]{0,180}class="ready"[\s\S]{0,180}title="HabHub"/);
assert.match(extensionPopup, /src="popup\.js"/);
assert.match(extensionPopupScript, /frame\.src = new URL\("\/", appUrl\)\.toString\(\)/);
assert.doesNotMatch(extensionPopupScript, /\/extension|timer|schedule|companionUrl/);
const parsedExtensionManifest = JSON.parse(extensionManifest);
assert.equal(parsedExtensionManifest.version, "0.3.4");
assert.equal(parsedExtensionManifest.name, "HabHub");
assert.deepEqual(parsedExtensionManifest.permissions, ["storage"]);
assert.equal(parsedExtensionManifest.action.default_popup, "popup.html");
assert.equal(parsedExtensionManifest.side_panel, undefined);
assert.equal(parsedExtensionManifest.background, undefined);
assert.doesNotMatch(extensionReadme, /side panel|companion surface|active timer|schedule card/i);
assert.match(extensionRoute, /<Redirect href=\{\"\/\" as never\} \/>/);
assert.doesNotMatch(
  extensionRoute,
  /TodayPage|ActiveTimer|scheduleEvents|floating|dock/i,
  "legacy extension URLs must redirect to the full app without a companion overlay",
);

console.log(
  "Web editor, pager, tracker gestures, and standalone iOS safe-area validation passed.",
);
