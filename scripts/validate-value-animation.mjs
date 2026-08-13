import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  animatedMetricValueAtProgress,
  animatedMetricValueFormat,
  formatAnimatedMetricValue,
} from "../src/domain/animatedMetricValue.ts";

const root = process.cwd();
const component = fs.readFileSync(
  path.join(root, "src/components/ColdLaunchMetricValue.tsx"),
  "utf8",
);
const today = fs.readFileSync(path.join(root, "app/(tabs)/index.tsx"), "utf8");
const healthProvider = fs.readFileSync(
  path.join(root, "src/health/HealthSyncProvider.tsx"),
  "utf8",
);

assert.match(component, /useAnimatedProps/);
assert.match(component, /withTiming\(1/);
assert.match(component, /useReducedMotion/);
assert.match(
  component,
  /createAnimatedComponent\(AppTextInput\)/,
  "animated values must retain the localized app text-input wrapper",
);
assert.doesNotMatch(component, /import\s*\{[^}]*\bTextInput\b[^}]*\}\s*from\s*["']react-native["']/);
assert.match(
  component,
  /phase === "pending"[\s\S]{0,160}progress\.value = 0[\s\S]{0,180}phase === "consumed"[\s\S]{0,160}progress\.value = 1/,
  "the undecided launch frame must stay at zero instead of flashing its final value",
);
assert.equal(
  component.match(/<AnimatedTextInput[\s\S]*?allowFontScaling=\{false\}/g)
    ?.length,
  2,
  "animated values must apply only the app-controlled font scale",
);
assert.equal(
  component.match(/<AnimatedTextInput[\s\S]*?translate=\{false\}/g)?.length,
  2,
  "formatted metric values are dynamic data, not localization catalog keys",
);
assert.doesNotMatch(component, /requestAnimationFrame|setValue\s*\(/);
assert.doesNotMatch(today, /function useAnimatedNumber/);
assert.match(today, /<ColdLaunchMetricValue[\s\S]*progress=\{metricValueAnimationProgress\}/);
assert.match(today, /<ColdLaunchCountValue[\s\S]*progress=\{metricValueAnimationProgress\}/);
assert.match(
  component,
  /const resolvedStyle = resolveCountTextStyle\(style, sizingStyle\)/,
  "the featured-card count must use its resolved caller color",
);
assert.match(
  component,
  /WebkitTextFillColor: resolved\.color/,
  "the animated featured-card count must preserve its explicit input glyph color on web",
);
assert.match(
  component,
  /StyleSheet\.flatten\(\[\s*styles\.text,\s*style,\s*sizingStyle,?\s*\]\)/,
  "the animated count must flatten nested caller styles before Reanimated reaches AppTextInput",
);
assert.match(today, /health\.lastStepSyncedAt \?\? health\.lastSyncedAt/);
assert.match(healthProvider, /lastStepSyncedAt: persisted\.lastStepSyncedAt \?\? null/);

const metric = {
  id: "steps",
  name: "Steps",
  unit: "steps",
  dataType: "number",
};
const english = animatedMetricValueFormat(metric, 3_435, "en-US");
assert.equal(formatAnimatedMetricValue(3_435, english), "3,435 steps");
assert.equal(
  formatAnimatedMetricValue(
    animatedMetricValueAtProgress(0, 3_435, 0.5),
    english,
  ),
  "1,718 steps",
);
assert.equal(animatedMetricValueAtProgress(500, 250, 0.5), 375);

const liters = animatedMetricValueFormat(
  { ...metric, id: "water", unit: "L" },
  2.5,
  "de-DE",
);
assert.equal(formatAnimatedMetricValue(2.5, liters), "2,5 L");

const screenTime = animatedMetricValueFormat(
  { ...metric, id: "screen_time", unit: "min" },
  125,
  "en-US",
);
assert.equal(formatAnimatedMetricValue(125, screenTime), "2 hr 5 min");

async function freshController(processId) {
  const url = pathToFileURL(
    path.join(root, "src/animation/coldLaunchMetricAnimation.ts"),
  );
  url.searchParams.set("process", processId);
  return import(url.href);
}

const firstProcess = await freshController("first");
assert.equal(firstProcess.coldLaunchMetricAnimationSnapshot(), "pending");
assert.equal(firstProcess.configureColdLaunchMetricAnimation(true), "armed");
assert.equal(firstProcess.claimColdLaunchMetricAnimation("today"), true);
assert.equal(firstProcess.coldLaunchMetricAnimationSnapshot(), "consumed");
assert.equal(
  firstProcess.claimColdLaunchMetricAnimation("today"),
  false,
  "A Today remount or foreground resume must not replay the animation.",
);
assert.equal(
  firstProcess.claimColdLaunchMetricAnimation("metric-detail"),
  false,
  "A page first visited later in the process must not start the animation.",
);
assert.equal(firstProcess.configureColdLaunchMetricAnimation(true), "consumed");

const redirectedProcess = await freshController("redirected");
assert.equal(redirectedProcess.configureColdLaunchMetricAnimation(true), "armed");
redirectedProcess.sealColdLaunchMetricAnimation();
assert.equal(redirectedProcess.claimColdLaunchMetricAnimation("today"), false);

const secondProcess = await freshController("second");
assert.equal(secondProcess.coldLaunchMetricAnimationSnapshot(), "pending");
assert.equal(secondProcess.configureColdLaunchMetricAnimation(true), "armed");
assert.equal(
  secondProcess.claimColdLaunchMetricAnimation("today"),
  true,
  "A genuine new JS process receives one fresh animation.",
);

const nonTodayProcess = await freshController("non-today");
assert.equal(nonTodayProcess.configureColdLaunchMetricAnimation(false), "consumed");
assert.equal(nonTodayProcess.claimColdLaunchMetricAnimation("today"), false);
assert.equal(nonTodayProcess.isTodayPathname("/status"), false);
assert.equal(nonTodayProcess.isTodayPathname("/metric-detail"), false);
assert.equal(nonTodayProcess.isTodayPathname("/"), true);

console.log("Value animation validation passed.");
