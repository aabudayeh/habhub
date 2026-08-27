import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const nativeSource = read("plugins/habhub-android/java/HabHubNativeModule.kt");
const bridgeSource = read("src/notifications/batteryOptimization.ts");
const settingsSource = read("app/notifications.tsx");
const cloudSettingsSource = read("app/settings.tsx");
const promptSource = read("src/components/BatteryOptimizationPrompt.tsx");
const layoutSource = read("app/_layout.tsx");
const scheduleSource = read("src/health/schedule.ts");
const backgroundSource = read("src/health/background.native.ts");
const exactBridgeSource = read("src/notifications/exactAlarm.ts");
const appConfig = read("app.json");
const pluginConfig = read("plugins/withHabHubAndroid.js");

assert.match(nativeSource, /PowerManager/);
assert.match(nativeSource, /isIgnoringBatteryOptimizations/);
assert.match(
  nativeSource,
  /Settings\.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/,
  "The explicit settings action must open Android's user-managed exemption list",
);
assert.match(nativeSource, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
assert.match(nativeSource, /Settings\.ACTION_BATTERY_SAVER_SETTINGS/);
assert.doesNotMatch(nativeSource, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
assert.doesNotMatch(
  [appConfig, pluginConfig, nativeSource].join("\n"),
  /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/,
  "HabHub must not request the restricted direct-exemption permission",
);

assert.match(bridgeSource, /Platform\.OS === "android"/);
assert.match(bridgeSource, /getBatteryOptimizationStatus/);
assert.match(bridgeSource, /openBatteryOptimizationSettings/);
assert.match(settingsSource, /AppState\.addEventListener\("change"/);
assert.match(
  settingsSource,
  /async function reviewBatteryOptimization\(\)[\s\S]*await openBatteryOptimizationSettings\(\)/,
);
assert.match(settingsSource, /onPress=\{reviewBatteryOptimization\}/);

assert.match(layoutSource, /<BatteryOptimizationPrompt \/>/);
assert.match(promptSource, /Platform\.OS !== "android"/);
assert.match(promptSource, /getBatteryOptimizationStatus\(\)/);
assert.match(
  promptSource,
  /text: "Review settings"[\s\S]{0,180}onPress:[\s\S]{0,100}openBatteryOptimizationSettings\(\)/,
  "The onboarding prompt may open Android battery settings only after the user's Review settings tap",
);
assert.match(promptSource, /text: "Not now", style: "cancel"/);
assert.match(promptSource, /does not stay running between syncs/);
assert.doesNotMatch(
  promptSource,
  /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/,
);

assert.match(scheduleSource, /mode: 'custom'/);
assert.match(
  scheduleSource,
  /Math\.max\(1, Math\.min\(12, Math\.round\(numeric\)\)\)/,
  "Custom background health sync must stay inside the promised 1-12 hour range",
);
assert.match(cloudSettingsSource, /title: "Custom interval"/);
assert.match(cloudSettingsSource, /function BackgroundIntervalSlider/);
assert.match(cloudSettingsSource, /accessibilityRole="adjustable"/);
const configureBackgroundTask = backgroundSource.slice(
  backgroundSource.indexOf("export async function configureBackgroundHealthSync"),
);
assert.match(
  configureBackgroundTask,
  /healthSyncSchedule\([\s\S]{0,100}settings\.backgroundIntervalHours/,
  "Background task registration must resolve the user's custom interval",
);
assert.match(
  configureBackgroundTask,
  /registerTaskAsync\(TASK_NAME, \{ minimumInterval \}\)/,
  "The battery-safe Expo task must receive the resolved OS minimum interval",
);
assert.match(
  backgroundSource,
  /await pushCloudRecentActivity\([\s\S]{0,180}changedDates/,
  "A successful signed-in background import must publish its compact group freshness update",
);

const effectStart = settingsSource.indexOf(
  "useEffect(() => {",
  settingsSource.indexOf("const refreshExactAlarmStatus"),
);
const effectEnd = settingsSource.indexOf(
  "}, [refreshBatteryOptimization, refreshExactAlarmStatus]);",
  effectStart,
);
assert.ok(effectStart >= 0 && effectEnd > effectStart);
assert.doesNotMatch(
  settingsSource.slice(effectStart, effectEnd),
  /open(?:BatteryOptimization|ExactAlarm)Settings/,
  "Android timing and battery settings must never open automatically",
);

assert.match(nativeSource, /canScheduleExactAlarms/);
assert.match(nativeSource, /Settings\.ACTION_REQUEST_SCHEDULE_EXACT_ALARM/);
assert.match(exactBridgeSource, /getExactAlarmStatus/);
assert.match(exactBridgeSource, /openExactAlarmSettings/);
assert.match(appConfig, /android\.permission\.SCHEDULE_EXACT_ALARM/);
assert.match(pluginConfig, /android\.permission\.SCHEDULE_EXACT_ALARM/);
assert.match(settingsSource, /onPress=\{reviewExactAlarmTiming\}/);

console.log(
  "Android battery-optimization status and user-initiated settings route validated.",
);
